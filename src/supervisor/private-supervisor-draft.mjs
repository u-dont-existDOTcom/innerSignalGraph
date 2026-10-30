import { randomUUID } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "./private-candidate-audit.mjs";
import { MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES, createCandidateAuditEvidence } from "./private-candidate-lifecycle.mjs";
import { SUPERVISOR_INPUT_TYPES, SUPERVISOR_LIMITS, sha256Json, sha256Text, supervisorAuditId, supervisorCandidateId } from "../storage/private-case-supervisor.mjs";

// The controlled supervisor draft and export operations, on the same private backend the automatic runtime uses. A supervisor's
// draft, whether an external person or host wrote its bytes or the existing runtime writes them, goes through the same
// independent audit and bounded repair as any candidate, and the exact approved bytes leave only through the controlled export.
//
// The channel each call arrives on is decided by the server from how the request was authenticated, never from a field the
// caller sends: `owner_ui` is the owner's own app, `authenticated_agent` is everything else. Export is not sending, and nothing
// here sends a message to anyone.
//
// This service never writes a candidate's audit itself: a model runtime audits, the store persists, and the store refuses
// anything that is not independent, version-bound and from a context other than the producer's.

export const SUPERVISOR_REVIEW_STATUSES = Object.freeze(["approved", "blocked", "superseded", "committed"]);

const SAFE_KEY = /^[\x21-\x7e]{1,200}$/u;
const NON_RETRYABLE = new Set([
  "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE",
  "PRIVATE_CASE_ACCESS_DENIED",
  "PRIVATE_CASE_KEY_UNAVAILABLE"
]);

const normalizeChannel = (channel) => (channel === "owner_ui" ? "owner_ui" : "authenticated_agent");
const trustOptions = (channel) => ({ ownerChannel: normalizeChannel(channel) === "owner_ui" });
const operationKeyFor = (caseId, parts) => sha256Json(["inner-signal/supervisor-operation/v1", caseId, ...parts]).slice(0, 24);

function optionalKey(value, name) {
  if (value == null) return null;
  if (typeof value !== "string" || !SAFE_KEY.test(value)) throw new ValidationError(`${name} must be 1 to 200 visible characters.`);
  return value;
}

function requiredText(value, name, maximum) {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${name} must be non-empty text.`);
  if (value.length > maximum) throw new ValidationError(`${name} exceeds ${maximum} characters.`);
  return value;
}

export function createPrivateSupervisorDraftService({
  privateCaseSource,
  modelRuntime = null,
  maximumInvocationAttempts = 2,
  // The point where slice 3's shared source-support validator is called. It receives the case record and the exact candidate at
  // the approval point and may refuse by throwing; the default admits whatever the independent audit already admitted.
  admissionCheck = async () => {}
} = {}) {
  if (!privateCaseSource || typeof privateCaseSource !== "object") throw new ValidationError("privateCaseSource is required.");
  if (modelRuntime != null) {
    for (const method of ["auditCandidate", "repairCandidate"]) {
      if (typeof modelRuntime[method] !== "function") throw new ValidationError(`modelRuntime.${method} must be a function.`);
    }
  }
  if (!Number.isSafeInteger(maximumInvocationAttempts) || maximumInvocationAttempts < 1 || maximumInvocationAttempts > 3) {
    throw new ValidationError("maximumInvocationAttempts must be from one to three.");
  }
  const runTails = new Map();

  const call = (method, args, authContext, options = {}) => {
    if (typeof privateCaseSource[method] !== "function") throw new ValidationError(`privateCaseSource.${method} is required.`);
    return privateCaseSource[method](...args, authContext, options);
  };
  const loadCase = async (caseId, authContext) => {
    const record = typeof privateCaseSource.loadPrivateRuntimeCase === "function"
      ? await privateCaseSource.loadPrivateRuntimeCase(caseId, authContext)
      : await privateCaseSource.load(caseId);
    if (!record) throw new ValidationError(`Private case ${caseId} was not found.`, { code: "PRIVATE_CASE_NOT_FOUND" });
    return record;
  };
  const serialized = async (caseId, work) => {
    const previous = runTails.get(caseId) ?? Promise.resolve();
    let release;
    const tail = new Promise((resolve) => { release = resolve; });
    runTails.set(caseId, tail);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (runTails.get(caseId) === tail) runTails.delete(caseId);
    }
  };
  const requireModelRuntime = (method) => {
    if (!modelRuntime || typeof modelRuntime[method] !== "function") {
      throw new RuntimeError("InnerSignal cannot review a draft right now. Nothing was approved.", { code: "SUPERVISOR_REVIEW_UNAVAILABLE" });
    }
    return modelRuntime[method].bind(modelRuntime);
  };

  // One model invocation with a bounded number of attempts. A transient failure retries; an authorization or isolation failure
  // does not. When attempts run out the draft stays exactly where it was, and the same request resumes from there.
  async function invoke(stage, operationKey, version, execute) {
    let lastError = null;
    for (let attempt = 1; attempt <= maximumInvocationAttempts; attempt += 1) {
      try {
        const output = await execute(`attempt:supervisor:${operationKey}:${stage}:v${version}:${attempt}`);
        if (!output || typeof output !== "object" || Array.isArray(output)) throw new ValidationError("Private inference returned no structured result.");
        if (typeof output.contextId !== "string" || !output.contextId.trim() || output.contextId.length > 160) {
          throw new ValidationError("Private inference returned no bounded actual context identity.");
        }
        return output;
      } catch (error) {
        lastError = error;
        if (NON_RETRYABLE.has(error?.code)) break;
      }
    }
    if (NON_RETRYABLE.has(lastError?.code)) throw lastError;
    throw new RuntimeError("InnerSignal could not finish reviewing this draft. Nothing was approved.", {
      code: "SUPERVISOR_REVIEW_UNAVAILABLE",
      cause: lastError,
      details: { stage }
    });
  }

  const lineageHead = (record, operationKey) => {
    const prefix = `candidate:supervisor:${operationKey}:`;
    return record.candidate_responses.filter((candidate) => candidate.id.startsWith(prefix)).at(-1) ?? null;
  };

  // Drives one draft lineage to a terminal result: approved, blocked at the repair limit, or replaced. Every step is a durable
  // write that a restart or a replayed request repeats safely, so the loop reads the stored lineage afresh each time.
  async function driveReview({ caseId, operationKey, authContext }) {
    for (let step = 0; step < 16; step += 1) {
      const record = await loadCase(caseId, authContext);
      const head = lineageHead(record, operationKey);
      if (!head) throw new ValidationError("The supervisor draft to review was not found.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
      switch (head.status) {
        case "pending_audit":
        case "reconstructed_pending_audit": {
          const audited = await invoke("audit", operationKey, head.version, (attemptContextId) => requireModelRuntime("auditCandidate")({
            caseId, candidateId: head.id, candidate: head, journalEvidence: null, authContext, attemptContextId
          }));
          if (audited.contextId === head.producer_context_id) throw new ValidationError("Candidate producer cannot audit the exact text it produced.");
          const result = audited.value ?? audited.result;
          const evidence = createCandidateAuditEvidence({
            auditId: supervisorAuditId(operationKey, head.repair_cycle + 1),
            candidate: head,
            auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
            auditorContext: { kind: "independent", context_id: audited.contextId },
            findings: result.findings,
            repairInducedChecks: result.repair_induced_checks ?? [],
            independentAuditorAvailable: true
          });
          await call("recordSupervisorAudit", [caseId, head.id, evidence, { disclosureManifest: audited.disclosureManifest ?? null, providerReceipt: audited.providerReceipt ?? null }], authContext);
          break;
        }
        case "audited": {
          const audit = [...head.audit_history].reverse().find((entry) => entry.sufficient_for_approval);
          await admissionCheck({ point: "approval", caseId, record, candidate: head, audit });
          await call("approveCandidateForDelivery", [caseId, head.id, audit.id], authContext);
          break;
        }
        case "audit_failed": {
          if (head.repair_cycle >= MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) return { status: "blocked", record, head };
          const repaired = await invoke("repair", operationKey, head.version, (attemptContextId) => requireModelRuntime("repairCandidate")({
            caseId, candidate: head, journalEvidence: null, authContext, attemptContextId
          }));
          await call("reconstructSupervisorDraft", [caseId, head.id, { exactText: repaired.exactText, producerContextId: repaired.contextId }], authContext);
          break;
        }
        case "approved_for_delivery":
          return { status: "approved", record, head };
        case "superseded":
          return { status: "superseded", record, head };
        default:
          return { status: "committed", record, head };
      }
    }
    throw new RuntimeError("The supervisor review exceeded its bounded step ceiling.", { code: "SUPERVISOR_REVIEW_UNAVAILABLE" });
  }

  async function reviewResult({ caseId, operationKey, authContext, replayed }) {
    const outcome = await driveReview({ caseId, operationKey, authContext });
    const snapshot = await call("getSupervisorSnapshot", [caseId], authContext);
    const headArtifact = snapshot.artifacts.find((artifact) => artifact.candidate_id === outcome.head.id) ?? null;
    return Object.freeze({
      case_id: caseId,
      status: outcome.status,
      replayed,
      exportable: headArtifact?.exportable === true,
      artifact: headArtifact,
      notice: outcome.status === "approved"
        ? (headArtifact?.exportable === true
          ? "The exact reviewed text is approved for controlled export. Export it from here; text edited or retyped elsewhere inherits no approval."
          : "This draft was approved, but the case has changed since, so it can no longer be exported. Prepare the case again and submit a new draft.")
        : (outcome.status === "blocked"
          ? "The bounded repair limit was reached and no text is approved. Nothing can be exported for this draft."
          : "This draft no longer governs the case; use the newest draft.")
    });
  }

  return Object.freeze({
    // A case-authorized snapshot to draft against, after recording any current messages the owner supplied. A client message the
    // owner relays and a supervisor's own revision instruction are different input types, and who supplied each is read from the
    // authenticated channel, not from the request.
    async prepareResponseContext({ caseId, inputs = [], authContext, channel }) {
      if (!Array.isArray(inputs) || inputs.length > SUPERVISOR_LIMITS.inputs_per_request) {
        throw new ValidationError(`At most ${SUPERVISOR_LIMITS.inputs_per_request} inputs can be recorded at once.`);
      }
      let recorded = [];
      if (inputs.length) {
        const prepared = inputs.map((input) => {
          if (!SUPERVISOR_INPUT_TYPES.includes(input?.type)) throw new ValidationError("Each input needs a type of client_message or supervisor_revision.");
          const key = optionalKey(input.idempotencyKey, "idempotencyKey");
          return {
            inputId: key ? `input:${sha256Json(["inner-signal/supervisor-input/v1", caseId, key]).slice(0, 40)}` : `input:${randomUUID()}`,
            inputType: input.type,
            text: requiredText(input.text, "Input text", SUPERVISOR_LIMITS.input_characters)
          };
        });
        recorded = (await call("recordSupervisorInputs", [caseId, { inputs: prepared, channel: normalizeChannel(channel) }], authContext, trustOptions(channel))).inputs;
      }
      const snapshot = await call("getSupervisorSnapshot", [caseId], authContext);
      return Object.freeze({ ...snapshot, recorded_inputs: recorded });
    },

    // Admits one draft for the existing independent audit and bounded repair. `external_draft` stores the exact bytes the caller
    // sent and marks the original writer as not attested; `backend_produced` has the existing runtime write the draft. Either
    // way nothing is approved until the independent audit passes the exact stored bytes, and a client-language edit is simply a
    // new submission with no inherited approval.
    async submitCandidateForReview({ caseId, source, text = null, companion = null, basisSha256 = null, idempotencyKey = null, authContext, channel }) {
      if (!["external_draft", "backend_produced"].includes(source)) throw new ValidationError("source must be external_draft or backend_produced.");
      const key = optionalKey(idempotencyKey, "idempotencyKey");
      if (basisSha256 != null && (typeof basisSha256 !== "string" || !/^[a-f0-9]{64}$/.test(basisSha256))) throw new ValidationError("basisSha256 is invalid.");
      let companionInput = null;
      if (companion != null) {
        if (typeof companion !== "object" || Array.isArray(companion)) throw new ValidationError("companion must be an object.");
        companionInput = { language: companion.language, text: requiredText(companion.text, "Companion text", 100_000) };
      }
      if (source === "external_draft") requiredText(text, "Draft text", 100_000);
      else if (text != null || companionInput) throw new ValidationError("A backend-produced draft takes no text or companion from the caller.");
      return serialized(caseId, async () => {
        const snapshot = await call("getSupervisorSnapshot", [caseId], authContext);
        // A retry with the same key is the operation already done, so it is recognised before the case state the caller prepared
        // against is compared with the present one: the case may have moved on since the answer that never arrived, and the
        // stored review, with its present state, is still the right reply. A new submission is always compared.
        const keyedOperation = key ? operationKeyFor(caseId, ["key", key]) : null;
        const keyedExisting = keyedOperation ? await call("getCandidateResponse", [caseId, supervisorCandidateId(keyedOperation, 1)], authContext) : null;
        if (!keyedExisting && basisSha256 != null && basisSha256 !== snapshot.basis.sha256) {
          throw new ValidationError("The case changed after this draft was prepared; prepare the case again before submitting.", { code: "SUPERVISOR_BASIS_CHANGED" });
        }
        const operationKey = keyedOperation
          ?? operationKeyFor(caseId, [source, source === "external_draft" ? sha256Text(text) : "", companionInput ? sha256Json(companionInput) : "", snapshot.basis.sha256]);
        const existing = keyedExisting ?? await call("getCandidateResponse", [caseId, supervisorCandidateId(operationKey, 1)], authContext);
        let replayed = Boolean(existing);
        if (source === "external_draft") {
          const stored = await call("submitSupervisorDraft", [caseId, {
            operationKey,
            source,
            exactText: text,
            producerContextId: `context:external:${operationKey}`,
            expectedBasisSha256: existing ? null : snapshot.basis.sha256,
            companion: companionInput,
            channel: normalizeChannel(channel)
          }], authContext, trustOptions(channel));
          replayed = stored.replayed;
        } else if (!existing) {
          const latest = snapshot.latest_client_turn;
          if (!latest || snapshot.last_transcript_role !== "user") {
            throw new ValidationError("The runtime has no unanswered client message to write a reply to.", { code: "SUPERVISOR_NO_PENDING_CLIENT_MESSAGE" });
          }
          const produced = await invoke("candidate", operationKey, 1, (attemptContextId) => requireModelRuntime("produceCandidate")({
            caseId,
            runtimeTurn: { id: `supervisor:${operationKey}`, user_turn_id: latest.turn_id, inbound: { exact_text: latest.text, received_at: latest.at } },
            userInput: {},
            journalEvidence: null,
            authContext,
            attemptContextId,
            inboundAlreadyRecorded: true
          }).then((value) => ({ ...value, attemptContextId })));
          await call("submitSupervisorDraft", [caseId, {
            operationKey,
            source,
            exactText: produced.exactText,
            producerContextId: produced.contextId,
            receipts: { producer_attempt_context_id: produced.attemptContextId, journal_evidence_sha256: null },
            expectedBasisSha256: snapshot.basis.sha256,
            channel: normalizeChannel(channel)
          }], authContext, trustOptions(channel));
        }
        return reviewResult({ caseId, operationKey, authContext, replayed });
      });
    },

    // The exact approved client text from the controlled export, with the supervisor's English companion kept apart and marked
    // as supervisor-only. The store re-checks bytes, audit, approval and staleness in the same write that records the export, and
    // the access service has already checked that the caller's authorization is current.
    async getApprovedResponseArtifact({ caseId, artifactId, authContext, channel }) {
      return call("exportSupervisorArtifact", [caseId, { artifactId, channel: normalizeChannel(channel) }], authContext, trustOptions(channel));
    },

    // Records that the owner reported sending a draft. Only the owner's own channel yields an owner-verified report; an agent
    // that merely asserts it keeps the weaker origin. The time stays unknown unless supplied.
    async recordReportedDelivery({ caseId, artifactId = null, sentAt = null, quote = null, sourceRef = null, idempotencyKey = null, authContext, channel }) {
      const origin = normalizeChannel(channel) === "owner_ui" ? "owner_action" : "agent_relayed";
      return call("recordSupervisorReport", [caseId, {
        artifactId,
        sentAt,
        quote,
        sourceRef,
        idempotencyKey: optionalKey(idempotencyKey, "idempotencyKey"),
        origin
      }], authContext, trustOptions(channel));
    }
  });
}
