import { randomUUID } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "./private-candidate-audit.mjs";
import { MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES, createCandidateAuditEvidence } from "./private-candidate-lifecycle.mjs";
import { assessResponseEvidenceAdmission, inspectGovernedModelCall, prepareGovernedModelCall, responseEvidenceRefreshJournal, supervisorInvocationInput, supervisorInvocationIdentity } from "./response-evidence-contract.mjs";
import {
  SUPERVISOR_INPUT_TYPES,
  SUPERVISOR_LIMITS,
  findSupervisorArtifact,
  sha256Json,
  sha256Text,
  supervisorAuditId,
  supervisorCandidateId,
  validateOperationKey
} from "../storage/private-case-supervisor.mjs";

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

// The operation a keyed submission is, found from its idempotency key alone, so a caller who has only the key can ask where its
// review stands before any draft handle exists.
export function supervisorOperationKeyForIdempotencyKey(caseId, idempotencyKey) {
  return operationKeyFor(caseId, ["key", optionalKey(idempotencyKey, "idempotencyKey")]);
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
  // Pre-check only; the store repeats admission inside its approval mutation.
  admissionCheck = async ({ record, candidate }) => {
    const assessment = assessResponseEvidenceAdmission(record, candidate, { policy: privateCaseSource.responseEvidencePolicy ?? "advisory", point: "approveSupervisorDraft" });
    if (!assessment.admissible) throw new ValidationError("Response evidence admission refused.", { code: assessment.code, details: { reasons: assessment.reasons } });
  }
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
  async function invoke(stage, operationKey, version, execute, governed = null) {
    if (governed?.completed) return { ...structuredClone(governed.completed.output), attemptContextId: governed.completed.attempt_context_id };
    let lastError = null;
    const previousAttempts = governed ? (await loadCase(governed.caseId, governed.authContext)).supervisor_invocations.filter(entry => entry.event_type === "STARTED"
      && entry.input.stage === stage && entry.input.candidate_id === governed.candidate.id && entry.input.snapshot_id === governed.evidence.snapshot.id).length : 0;
    for (let attempt = 1; attempt <= maximumInvocationAttempts; attempt += 1) {
      try {
        const attemptContextId = `attempt:supervisor:${operationKey}:${stage}:v${version}:${governed ? governed.evidence.snapshot.snapshot_sha256.slice(0, 12) + ":" : ""}${previousAttempts + attempt}`;
        const started = governed ? await call("startSupervisorInvocation", [governed.caseId, { operationKey, stage, candidateId: governed.candidate.id,
          snapshotId: governed.evidence.snapshot.id, attemptContextId }], governed.authContext) : null;
        const output = await execute(attemptContextId);
        if (!output || typeof output !== "object" || Array.isArray(output)) throw new ValidationError("Private inference returned no structured result.");
        if (typeof output.contextId !== "string" || !output.contextId.trim() || output.contextId.length > 160) {
          throw new ValidationError("Private inference returned no bounded actual context identity.");
        }
        if (started) {
          const completed = await call("completeSupervisorInvocation", [governed.caseId, { startedId: started.id, output }], governed.authContext);
          return { ...completed.output, attemptContextId: completed.attempt_context_id };
        }
        return output;
      } catch (error) {
        lastError = error;
        if (["RESPONSE_EVIDENCE_STALE", "RESPONSE_EVIDENCE_INVALID"].includes(error?.code)) throw error;
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
  const caseChanged = (record, head) => ({ status: "blocked", reason: "case_changed", record, head });
  const completedCall = (record, stage, candidate, snapshot) => snapshot ? [...record.supervisor_invocations].reverse().find(entry => entry.event_type === "COMPLETED"
    && sha256Json(supervisorInvocationIdentity(entry.input)) === sha256Json(supervisorInvocationInput({ operationKey: snapshot.owner.operation_key, stage, candidate, snapshot, viewSha256: entry.input.view_sha256 }))) : null;
  const selectPendingCall = ({ operationKey, record, head, stage, snapshot }) => {
    let completed = completedCall(record, stage, head, snapshot);
    if (!completed && stage !== "audit") {
      for (const prior of [...record.response_evidence_snapshots].reverse()) {
        if (prior.owner.kind !== "supervisor_draft" || prior.owner.operation_key !== operationKey) continue;
        completed = completedCall(record, stage, head, prior);
        if (completed) { snapshot = prior; break; }
      }
    }
    const rootCandidate = record.candidate_responses.find(entry => entry.id === head.root_candidate_id);
    if (!completed && stage === "audit" && !inspectGovernedModelCall({ record, snapshot, rootCandidate }).evidence) snapshot = record.response_evidence_snapshots
      .filter(entry => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey).at(-1);
    return { snapshot, completed, rootCandidate };
  };
  const prepareCall = async ({ caseId, operationKey, record, head, stage, snapshot: initialSnapshot, authContext }) => {
    const { snapshot, completed, rootCandidate } = selectPendingCall({ operationKey, record, head, stage, snapshot: initialSnapshot });
    return prepareGovernedModelCall({ record, snapshot, rootCandidate, completed,
      load: () => loadCase(caseId, authContext),
      freeze: async (reason, { record, snapshot }) => {
        const latest = (await call("getSupervisorSnapshot", [caseId], authContext)).latest_client_turn;
        if (!latest) throw new ValidationError("No client message for evidence refresh.", { code: "RESPONSE_EVIDENCE_INVALID" });
        return call("freezeResponseEvidence", [caseId, { snapshotId: `snapshot:supervisor:${operationKey}:r${(snapshot?.revision ?? 0) + 1}`,
          owner: { kind: "supervisor_draft", operation_key: operationKey }, candidateOrigin: snapshot.candidate_origin,
          inbound: { turn_id: latest.turn_id, exact_text_sha256: sha256Text(latest.text), audience: "client", source_kind: "exact_client_turn" },
          revision: (snapshot?.revision ?? 0) + 1, parentSnapshotId: snapshot?.id ?? null, revisionReason: reason,
          historyRequirements: snapshot.history_requirements, journal: responseEvidenceRefreshJournal(record, snapshot)
        }], authContext);
      }
    });
  };

  // Drives one draft lineage to a terminal result: approved, blocked at the repair limit, or replaced. Every step is a durable
  // write that a restart or a replayed request repeats safely, so the loop reads the stored lineage afresh each time.
  async function driveReview({ caseId, operationKey, authContext }) {
    for (let step = 0; step < 16; step += 1) {
      try {
      const record = await loadCase(caseId, authContext);
      const head = lineageHead(record, operationKey);
      if (!head) throw new ValidationError("The supervisor draft to review was not found.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
      const bound = head.metadata.response_evidence;
      switch (head.status) {
        case "pending_audit":
        case "reconstructed_pending_audit": {
          const prepared = bound ? await prepareCall({ caseId, operationKey, record, head, stage: "audit",
            snapshot: record.response_evidence_snapshots.find(entry => entry.id === bound.snapshot_id), authContext }) : null;
          if (prepared?.exhausted) return caseChanged(record, head);
          if (prepared && (prepared.refreshed || prepared.snapshot.id !== bound.snapshot_id)) {
            await call("recordSupervisorEvidenceStale", [caseId, head.id], authContext);
            break;
          }
          const evidence = prepared ? prepared.evidence ?? { snapshot: prepared.snapshot } : null;
          const audited = await invoke("audit", operationKey, head.version, (attemptContextId) => requireModelRuntime("auditCandidate")({
            caseId, candidateId: head.id, candidate: head, journalEvidence: null, ...(evidence ? { responseEvidence: evidence } : {}), authContext, attemptContextId
          }), prepared ? { caseId, candidate: head, evidence, completed: prepared.completed, authContext } : null);
          if (audited.contextId === head.producer_context_id) throw new ValidationError("Candidate producer cannot audit the exact text it produced.");
          const result = audited.value ?? audited.result;
          const auditEvidence = createCandidateAuditEvidence({
            auditId: supervisorAuditId(operationKey, head.repair_cycle + 1),
            candidate: head,
            auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
            auditorContext: { kind: "independent", context_id: audited.contextId },
            findings: result.findings,
            repairInducedChecks: result.repair_induced_checks ?? [],
            independentAuditorAvailable: true,
            ...(evidence ? { responseEvidence: { snapshotId: evidence.snapshot.id, snapshotSha256: evidence.snapshot.snapshot_sha256,
              auditorInclusionSha256: audited.responseEvidenceInclusion?.view_sha256, review: result.evidence_review, snapshot: evidence.snapshot } } : {})
          });
          await call("recordSupervisorAudit", [caseId, head.id, auditEvidence, { disclosureManifest: audited.disclosureManifest ?? null, providerReceipt: audited.providerReceipt ?? null }], authContext);
          break;
        }
        case "audited": {
          const audit = [...head.audit_history].reverse().find((entry) => entry.sufficient_for_approval);
          await admissionCheck({ point: "approval", caseId, record, candidate: head, audit });
          await call(typeof privateCaseSource.approveSupervisorDraft === "function" ? "approveSupervisorDraft" : "approveCandidateForDelivery", [caseId, head.id, audit.id], authContext);
          break;
        }
        case "audit_failed": {
          if (head.repair_cycle >= MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) return { status: "blocked", record, head };
          const newest = bound ? record.response_evidence_snapshots.filter((entry) => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey).at(-1) : null;
          const prepared = bound ? await prepareCall({ caseId, operationKey, record, head, stage: "repair", snapshot: newest, authContext }) : null;
          if (prepared?.exhausted) return caseChanged(record, head);
          const repairEvidence = prepared ? prepared.evidence ?? { snapshot: prepared.snapshot } : null;
          const repaired = await invoke("repair", operationKey, head.version, (attemptContextId) => requireModelRuntime("repairCandidate")({
            caseId, candidate: head, journalEvidence: null, ...(repairEvidence ? { responseEvidence: repairEvidence } : {}), authContext, attemptContextId
          }), prepared ? { caseId, candidate: head, evidence: repairEvidence, completed: prepared.completed, authContext } : null);
          await call("reconstructSupervisorDraft", [caseId, head.id, { exactText: repaired.exactText, producerContextId: repaired.contextId, ...(repairEvidence ? { writerInclusionSha256: repaired.responseEvidenceInclusion?.view_sha256 } : {}) }], authContext);
          break;
        }
        case "approved_for_delivery":
          return { status: "approved", record, head };
        case "superseded":
          return { status: "superseded", record, head };
        default:
          return { status: "committed", record, head };
      }
      } catch (error) {
        if (error?.code === "RESPONSE_EVIDENCE_STALE") continue;
        throw error;
      }
    }
    throw new RuntimeError("The supervisor review exceeded its bounded step ceiling.", { code: "SUPERVISOR_REVIEW_UNAVAILABLE" });
  }

  async function describeReview({ caseId, outcome, authContext, replayed }) {
    const snapshot = await call("getSupervisorSnapshot", [caseId], authContext);
    const headArtifact = snapshot.artifacts.find((artifact) => artifact.candidate_id === outcome.head.id) ?? null;
    return Object.freeze({
      case_id: caseId,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      replayed,
      exportable: headArtifact?.exportable === true,
      artifact: headArtifact,
      notice: outcome.status === "approved"
        ? (headArtifact?.exportable === true
          ? "The exact reviewed text is approved for controlled export. Export it from here; text edited or retyped elsewhere inherits no approval."
          : "This draft was approved, but the case has changed since, so it can no longer be exported. Prepare the case again and submit a new draft.")
        : (outcome.status === "blocked"
          ? (outcome.reason === "case_changed"
            ? "The case changed during review. Nothing is approved. Prepare the case again and submit a new draft."
            : "The bounded repair limit was reached and no text is approved. Nothing can be exported for this draft.")
          : (outcome.status === "reviewing"
            ? "The review of this draft is not finished. Nothing is approved yet."
            : "This draft no longer governs the case; use the newest draft."))
    });
  }

  async function reviewResult({ caseId, operationKey, authContext, replayed }) {
    const outcome = await driveReview({ caseId, operationKey, authContext });
    return describeReview({ caseId, outcome, authContext, replayed });
  }

  // The state of a draft lineage's newest version as the review loop reads it, without driving anything: `reviewing` is any state the
  // loop would still act on.
  const reviewStatusOf = (head) => {
    switch (head.status) {
      case "pending_audit":
      case "reconstructed_pending_audit":
      case "audited":
        return "reviewing";
      case "audit_failed":
        return head.repair_cycle >= MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES ? "blocked" : "reviewing";
      case "approved_for_delivery":
        return "approved";
      case "superseded":
        return "superseded";
      default:
        return "committed";
    }
  };

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
        const external = source === "external_draft";
        const changedSincePrepared = basisSha256 != null && basisSha256 !== snapshot.basis.sha256;
        // A keyless submission's identity is the case state, so the state it was prepared against is compared with the present one
        // first. A retry with the same key is the operation already done: it is recognised, and compared with what defined that
        // operation, before the present case state is looked at, because the case may have moved on since the answer that never
        // arrived and the stored review, with its present state, is still the right reply. A new keyed submission is compared too.
        if (!key && changedSincePrepared) {
          throw new ValidationError("The case changed after this draft was prepared; prepare the case again before submitting.", { code: "SUPERVISOR_BASIS_CHANGED" });
        }
        const operationKey = key
          ? operationKeyFor(caseId, ["key", key])
          : operationKeyFor(caseId, [source, external ? sha256Text(text) : "", companionInput ? sha256Json(companionInput) : "", snapshot.basis.sha256]);
        // The only way this service learns that a draft already exists. The store compares the retry with everything that defined
        // the stored draft (its source included) and refuses a retry that differs, so no replay is answered, and no generation
        // is skipped, on the strength of the key alone.
        const resolved = await call("resolveSupervisorSubmission", [caseId, {
          operationKey,
          source,
          exactText: external ? text : undefined,
          producerContextId: external ? `context:external:${operationKey}` : undefined,
          companion: companionInput,
          basisSha256
        }], authContext, trustOptions(channel));
        const existing = resolved.found;
        if (!existing && changedSincePrepared) {
          throw new ValidationError("The case changed after this draft was prepared; prepare the case again before submitting.", { code: "SUPERVISOR_BASIS_CHANGED" });
        }
        let replayed = existing;
        // Freeze once before storing external bytes or invoking the backend writer. A restart after the freeze but before
        // submission reuses the persisted input; a submission replay never freezes against the case's newer state.
        let responseEvidence = null, writerPrepared = null, writerCandidate = null;
        const record = await loadCase(caseId, authContext);
        if (privateCaseSource.responseEvidencePolicy === "enforced" || existing || record.response_evidence_snapshots.some(entry => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey)) {
          const snapshotId = `snapshot:supervisor:${operationKey}:r1`;
          const root = record.candidate_responses.find(entry => entry.id === supervisorCandidateId(operationKey, 1));
          let frozen = existing ? record.response_evidence_snapshots.find(entry => entry.id === root?.metadata.response_evidence?.snapshot_id)
            : record.response_evidence_snapshots.filter(entry => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey).at(-1);
          if (!frozen && !existing) {
            const latest = snapshot.latest_client_turn;
            if (!latest) throw new ValidationError("The runtime has no client message to bind.", { code: "SUPERVISOR_NO_PENDING_CLIENT_MESSAGE" });
            frozen = await call("freezeResponseEvidence", [caseId, {
              snapshotId, owner: { kind: "supervisor_draft", operation_key: operationKey }, candidateOrigin: source,
              inbound: { turn_id: latest.turn_id, exact_text_sha256: sha256Text(latest.text), audience: "client", source_kind: "exact_client_turn" },
              historyRequirements: [], journal: { availability: "not_configured" }
            }], authContext);
          }
          if (!frozen && privateCaseSource.responseEvidencePolicy === "enforced") throw new ValidationError("Response evidence required.", { code: "RESPONSE_EVIDENCE_REQUIRED" });
          // An existing external draft needs only its binding to replay; do not resolve stale transcript locators here.
          if (frozen) {
            if (existing) responseEvidence = { snapshot: frozen };
            else {
              writerCandidate = { id: supervisorCandidateId(operationKey, 1), version: null };
              writerPrepared = await prepareCall({ caseId, operationKey, record, head: writerCandidate, stage: "candidate", snapshot: frozen, authContext });
              if (writerPrepared.exhausted) return Object.freeze({ case_id: caseId, status: "blocked", reason: "case_changed", replayed: false, exportable: false, artifact: null,
                notice: "The case changed during review. Nothing is approved. Prepare the case again and submit a new draft." });
              responseEvidence = writerPrepared.evidence ?? { snapshot: writerPrepared.snapshot };
            }
          }
        }
        if (external) {
          const stored = await call("submitSupervisorDraft", [caseId, {
            operationKey,
            source,
            exactText: text,
            producerContextId: `context:external:${operationKey}`,
            ...(responseEvidence ? { responseEvidence: { snapshotId: responseEvidence.snapshot.id, writerInclusionSha256: null } } : {}),
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
            ...(responseEvidence ? { responseEvidence } : {}),
            authContext,
            attemptContextId,
            inboundAlreadyRecorded: true
          }).then((value) => ({ ...value, attemptContextId })), writerPrepared ? { caseId, candidate: writerCandidate,
            evidence: responseEvidence, completed: writerPrepared.completed, authContext } : null);
          await call("submitSupervisorDraft", [caseId, {
            operationKey,
            source,
            exactText: produced.exactText,
            producerContextId: produced.contextId,
            receipts: { producer_attempt_context_id: produced.attemptContextId ?? null, journal_evidence_sha256: null,
              ...(responseEvidence ? { response_evidence_view_sha256: produced.responseEvidenceInclusion?.view_sha256 } : {}) },
            ...(responseEvidence ? { responseEvidence: { snapshotId: responseEvidence.snapshot.id, writerInclusionSha256: produced.responseEvidenceInclusion?.view_sha256 } } : {}),
            expectedBasisSha256: responseEvidence ? null : snapshot.basis.sha256,
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

    // The operation a draft belongs to, found from the handle of any of its versions (the original, or a later repair), so a caller
    // that holds only a handle can follow the draft's review across repairs. Read-only; a handle from another case finds nothing.
    async findReviewLineage({ caseId, artifactId, authContext }) {
      const record = await loadCase(caseId, authContext);
      const operationKey = findSupervisorArtifact(record, artifactId)?.metadata?.supervisor_draft?.operation_key;
      if (typeof operationKey !== "string") throw new ValidationError("No such supervisor artifact in this case.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
      return operationKey;
    },

    // Where one draft's review stands, read from what is stored. It drives nothing and calls no model, so it can say a review is
    // unfinished without starting or finishing it; `resumeReview` is what continues one.
    async getReviewStatus({ caseId, operationKey, authContext }) {
      validateOperationKey(operationKey);
      const record = await loadCase(caseId, authContext);
      const head = lineageHead(record, operationKey);
      if (!head) throw new ValidationError("The supervisor draft to review was not found.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
      if (head.metadata.response_evidence && (["pending_audit", "reconstructed_pending_audit"].includes(head.status)
          || (head.status === "audit_failed" && head.repair_cycle < MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES))) {
        const snapshot = head.status === "audit_failed"
          ? record.response_evidence_snapshots.filter(entry => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey).at(-1)
          : record.response_evidence_snapshots.find(entry => entry.id === head.metadata.response_evidence.snapshot_id);
        const selected = selectPendingCall({ operationKey, record, head, stage: head.status === "audit_failed" ? "repair" : "audit", snapshot });
        if (inspectGovernedModelCall({ record, ...selected }).exhausted) return describeReview({ caseId, outcome: caseChanged(record, head), authContext, replayed: true });
      }
      return describeReview({ caseId, outcome: { status: reviewStatusOf(head), head }, authContext, replayed: true });
    },

    // Continues a stored draft's review from where its lineage stands: the same loop a submission runs, so a review that a restart
    // or a failure left unfinished picks up at the next step, and one that is finished answers without any model call. Taken one at
    // a time with every other call for the case.
    async resumeReview({ caseId, operationKey, authContext }) {
      validateOperationKey(operationKey);
      return serialized(caseId, () => reviewResult({ caseId, operationKey, authContext, replayed: true }));
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
