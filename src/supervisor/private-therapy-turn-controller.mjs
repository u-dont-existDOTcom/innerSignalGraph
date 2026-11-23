import { createHash } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { createCandidateAuditEvidence, REPAIR_INDUCED_ERROR_CHECKS } from "./private-candidate-lifecycle.mjs";
import { privateRuntimeNextAction } from "./private-runtime-turn-lifecycle.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "./private-candidate-audit.mjs";
import { OWNER_FALLBACK_KIND } from "./owner-fallback-message.mjs";
import { buildEvidenceModelView, deriveEvidenceFindings, normalizeEvidenceReview, responseEvidenceSnapshotCurrent } from "./response-evidence-contract.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value) => sha256(JSON.stringify(value));

function requiredFunction(value, name) {
  if (typeof value !== "function") throw new ValidationError(`${name} must be a function.`);
  return value;
}

function safeInvocationFailure(error) {
  const details = error?.details && typeof error.details === "object" && !Array.isArray(error.details)
    ? structuredClone(error.details)
    : {};
  return {
    error_name: typeof error?.name === "string" ? error.name.slice(0, 120) : "Error",
    error_code: typeof error?.code === "string" ? error.code.slice(0, 160) : "PRIVATE_INFERENCE_OPERATIONAL_FAILURE",
    error_message: typeof error?.message === "string" ? error.message.slice(0, 4_000) : "Private inference failed.",
    raw_private_evidence: details
  };
}

function nonRetryable(error) {
  return new Set([
    "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE",
    "PRIVATE_DISCRIMINATOR_UNAVAILABLE",
    "PRIVATE_CASE_ACCESS_DENIED",
    "PRIVATE_CASE_KEY_UNAVAILABLE",
    "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED"
  ]).has(error?.code);
}

function runtimeEventId(operationKey, stage, inputSha256, attempt, suffix) {
  return `runtime-event:${operationKey}:${stage}:${inputSha256.slice(0, 12)}:${attempt}:${suffix}`;
}

function candidateId(operationKey, repairCycle) {
  return `candidate:runtime:${operationKey}:v${repairCycle + 1}`;
}

function auditId(operationKey, repairCycle) {
  return `audit:runtime:${operationKey}:v${repairCycle + 1}`;
}

function repairInputIdentity(parent, audit, journalEvidence, snapshot = null) {
  return { parent_candidate_id: parent.id, parent_version: parent.version, parent_sha256: sha256(parent.exact_text), audit_id: audit?.id,
    repair_cycle: parent.repair_cycle + 1, journal_evidence_sha256: journalEvidence?.sha256 ?? null,
    ...(snapshot ? { response_evidence_snapshot_sha256: snapshot.snapshot_sha256 } : {}) };
}

function exactCandidate(record, id) {
  const candidate = record.candidate_responses.find((entry) => entry.id === id);
  if (!candidate) throw new ValidationError(`Runtime candidate ${id} was not found.`);
  return candidate;
}

function normalizeInvocationOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Private inference invocation returned no structured result.");
  if (typeof value.contextId !== "string" || !value.contextId.trim() || value.contextId.length > 160) throw new ValidationError("Private inference invocation returned no bounded actual context identity.");
  return structuredClone(value);
}

export function createPrivateTherapyTurnController({
  privateCaseSource,
  modelRuntime,
  // Off by default. No production provider exists yet, and the servers build this controller
  // without one, so therapy turns read no journal evidence. Supplying one is a separate change,
  // made once the import has published a session-use generation that passed its cold test.
  journalEvidenceProvider = null,
  responseEvidence = { enforced: false, journalTimeoutMs: 4000 },
  maximumInvocationAttempts = 2
} = {}) {
  if (!privateCaseSource || typeof privateCaseSource !== "object") throw new ValidationError("privateCaseSource is required.");
  if (!modelRuntime || typeof modelRuntime !== "object") throw new ValidationError("modelRuntime is required.");
  for (const method of ["produceCandidate", "auditCandidate", "repairCandidate", "produceDiscriminator"]) requiredFunction(modelRuntime[method], `modelRuntime.${method}`);
  const evidenceEnforced = responseEvidence.enforced === true;
  const journalTimeoutMs = responseEvidence.journalTimeoutMs ?? 4000;
  if (!Number.isSafeInteger(journalTimeoutMs) || journalTimeoutMs < 1) throw new ValidationError("Response evidence timeout invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
  if (journalEvidenceProvider != null && !evidenceEnforced) requiredFunction(journalEvidenceProvider.freezeForTurn, "journalEvidenceProvider.freezeForTurn");
  if (!Number.isSafeInteger(maximumInvocationAttempts) || maximumInvocationAttempts < 1 || maximumInvocationAttempts > 3) {
    throw new ValidationError("maximumInvocationAttempts must be from one to three.");
  }
  const runTails = new Map();

  const call = (method, args, authContext) => {
    requiredFunction(privateCaseSource[method], `privateCaseSource.${method}`);
    return privateCaseSource[method](...args, authContext);
  };
  const loadCase = (caseId, authContext) => typeof privateCaseSource.loadPrivateRuntimeCase === "function"
    ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext)
    : privateCaseSource.loadOrCreate(caseId);

  const freezeJournalEvidence = async ({ caseId, runtimeTurn, userInput, authContext }) => {
    if (!journalEvidenceProvider) return null;
    const value = await journalEvidenceProvider.freezeForTurn({
      caseId,
      runtimeTurn: structuredClone(runtimeTurn),
      authContext,
      query: userInput.journalQuery ?? runtimeTurn.inbound.exact_text,
      maximumTokens: Math.min(userInput.journalMaximumTokens ?? 8_000, 8_000),
      reserveCompleteActiveEpisode: true,
      reserveMandatoryAuditContext: true
    });
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Journal evidence provider returned no bounded packet.");
    const packet = structuredClone(value.packet ?? value);
    const serialized = JSON.stringify(packet);
    if (Buffer.byteLength(serialized, "utf8") > 64_000) throw new ValidationError("Journal evidence packet exceeds the bounded runtime allowance.", { code: "INSUFFICIENT_CONTEXT" });
    return Object.freeze({ packet, sha256: sha256(serialized) });
  };

  const frozenJournalEvidence = (runtimeTurn) => runtimeTurn.events
    .find((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "candidate")
    ?.details?.output?.journalEvidence ?? null;

  const snapshotsFor = (record, runtimeTurn) => (record.response_evidence_snapshots ?? []).filter((entry) => entry.owner.kind === "runtime_turn" && entry.owner.runtime_turn_id === runtimeTurn.id);
  const modelEvidence = (record, snapshot) => {
    if (!snapshot) throw new ValidationError("Response evidence snapshot missing.", { code: "RESPONSE_EVIDENCE_INVALID" });
    const { view, view_sha256 } = buildEvidenceModelView(record, snapshot);
    return { snapshot, view, viewSha256: view_sha256 };
  };
  const journalPart = async ({ caseId, query, authContext }) => {
    if (!journalEvidenceProvider) return { availability: "not_configured" };
    if (typeof journalEvidenceProvider.freezeResponseEvidenceJournal !== "function") return { availability: "unavailable", retrieval_status: "not_attempted", omissions: [{ reason: "legacy_provider_contract", count: 1 }] };
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => journalEvidenceProvider.freezeResponseEvidenceJournal({ caseId, query, maximumTokens: 8000, maximumBytes: 64000, authContext })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Journal retrieval timed out.")), journalTimeoutMs); })
      ]);
    } catch (error) {
      return error?.code === "PRIVATE_CASE_ACCESS_DENIED" || error?.code === "JOURNAL_SESSION_USE_NOT_AUTHORIZED"
        ? { availability: "not_authorized", retrieval_status: "not_attempted" }
        : { availability: "unavailable", retrieval_status: "failed" };
    } finally { clearTimeout(timer); }
  };
  const freezeSnapshot = async ({ caseId, runtimeTurn, operationKey, record, reason = "initial", query = runtimeTurn.inbound.exact_text, authContext }) => {
    const previous = snapshotsFor(record, runtimeTurn).at(-1);
    const revision = (previous?.revision ?? 0) + 1;
    const journal = reason === "dependency_refresh" ? {
      ...structuredClone(previous.journal),
      source_items: previous.source_items.filter((entry) => entry.kind === "journal_quotation")
    } : await journalPart({ caseId, query, authContext });
    // Refreshes preserve authorized excerpts only while their corpus binding still exists.
    if (reason === "dependency_refresh") {
      journal.source_items = journal.source_items.filter((item) => record.journal_corpora?.some((corpus) => corpus.corpus_id === item.locator.corpus_id && corpus.active_generation === item.locator.generation && corpus.visibility_epoch === item.locator.visibility_epoch));
      if (journal.source_items.length !== previous.source_items.filter((entry) => entry.kind === "journal_quotation").length) {
        journal.availability = "unavailable"; journal.retrieval_status = "not_attempted";
        journal.omissions.push({ reason: "journal_binding_changed", count: 1 });
      }
    }
    return call("freezeResponseEvidence", [caseId, {
      snapshotId: `snapshot:runtime:${operationKey}:r${revision}`, owner: { kind: "runtime_turn", runtime_turn_id: runtimeTurn.id },
      revision, parentSnapshotId: previous?.id ?? null, revisionReason: reason, candidateOrigin: "backend_produced",
      inbound: { turn_id: runtimeTurn.user_turn_id, exact_text_sha256: runtimeTurn.inbound.sha256, audience: "client", source_kind: "exact_client_turn" },
      historyRequirements: [], journal
    }], authContext);
  };

  async function invoke({ caseId, runtimeTurn, operationKey, stage, inputIdentity, authContext, execute }) {
    const inputSha256 = jsonHash(inputIdentity);
    const events = runtimeTurn.events.filter((event) => event.stage === stage && event.input_sha256 === inputSha256);
    const completed = [...events].reverse().find((event) => event.event_type === "INVOCATION_COMPLETED");
    if (completed) return normalizeInvocationOutput(completed.details.output);
    if (events.some((event) => event.event_type === "INVOCATION_FAILED" && event.details?.error_code === "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED")) {
      throw new RuntimeError("The discriminating question could not pass response evidence review. Nothing was delivered.", { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
    }

    const started = events.filter((event) => event.event_type === "INVOCATION_STARTED");
    for (const orphan of started) {
      const terminated = events.some((event) => event.context_id === orphan.context_id && ["INVOCATION_COMPLETED", "INVOCATION_FAILED", "INVOCATION_ABANDONED"].includes(event.event_type));
      if (!terminated) {
        await call("recordPrivateRuntimeInvocationEvent", [caseId, runtimeTurn.id, {
          eventId: runtimeEventId(operationKey, stage, inputSha256, orphan.attempt, "abandoned"),
          eventType: "INVOCATION_ABANDONED",
          stage,
          contextId: orphan.context_id,
          attempt: orphan.attempt,
          inputSha256,
          details: { reason: "controller_restart_before_durable_result" }
        }], authContext);
      }
    }

    let attempt = started.length + 1;
    while (attempt <= maximumInvocationAttempts) {
      const attemptContextId = `attempt:${operationKey}:${stage}:${inputSha256.slice(0, 12)}:${attempt}`;
      await call("recordPrivateRuntimeInvocationEvent", [caseId, runtimeTurn.id, {
        eventId: runtimeEventId(operationKey, stage, inputSha256, attempt, "started"),
        eventType: "INVOCATION_STARTED",
        stage,
        contextId: attemptContextId,
        attempt,
        inputSha256,
        details: { maximum_attempts: maximumInvocationAttempts }
      }], authContext);
      try {
        const output = normalizeInvocationOutput(await execute(attemptContextId));
        const refreshed = await call("getPrivateRuntimeTurn", [caseId, runtimeTurn.id], authContext);
        const usedContexts = refreshed.events
          .filter((event) => event.event_type === "INVOCATION_COMPLETED")
          .map((event) => event.details?.output?.contextId)
          .filter(Boolean);
        if (usedContexts.includes(output.contextId)) throw new ValidationError("Private inference context identity was reused across lifecycle roles.", { code: "PRIVATE_INFERENCE_CONTEXT_REUSED" });
        await call("recordPrivateRuntimeInvocationEvent", [caseId, runtimeTurn.id, {
          eventId: runtimeEventId(operationKey, stage, inputSha256, attempt, "completed"),
          eventType: "INVOCATION_COMPLETED",
          stage,
          contextId: attemptContextId,
          attempt,
          inputSha256,
          details: { actual_context_id: output.contextId, output }
        }], authContext);
        return output;
      } catch (error) {
        await call("recordPrivateRuntimeInvocationEvent", [caseId, runtimeTurn.id, {
          eventId: runtimeEventId(operationKey, stage, inputSha256, attempt, "failed"),
          eventType: "INVOCATION_FAILED",
          stage,
          contextId: attemptContextId,
          attempt,
          inputSha256,
          details: safeInvocationFailure(error)
        }], authContext);
        if (error?.code === "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED") throw error;
        if (nonRetryable(error)) break;
        attempt += 1;
      }
    }
    throw new RuntimeError("InnerSignal could not safely complete this response. Nothing unaudited was delivered.", {
      code: "THERAPY_RUNTIME_UNAVAILABLE",
      details: { stage, attempts_exhausted: true }
    });
  }

  async function executeRun({ caseId, runtimeTurnId, exchangeId, userTurnId, assistantTurnId, userMessage, userInput = {}, authContext }) {
    // A supervisor correction is not an inbound client therapy turn. Reject it before
    // private persistence or model inference; the explicit unsent edit path is separate.
    if (userInput && Object.hasOwn(userInput, "pendingReplyRevision")) {
      throw new ValidationError("Supervisor reply revision cannot be submitted to the private therapy response endpoint.");
    }
    await call("beginPrivateRuntimeTurn", [caseId, { runtimeTurnId, exchangeId, userTurnId, exactText: userMessage }], authContext);
    const operationKey = sha256(`${caseId}\u0000${runtimeTurnId}`).slice(0, 24);

    for (let step = 0; step < 40; step += 1) {
      const runtimeTurn = await call("getPrivateRuntimeTurn", [caseId, runtimeTurnId], authContext);
      if (runtimeTurn.state === "DELIVERED") {
        const record = await loadCase(caseId, authContext);
        const productionResult = runtimeTurn.events.find((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "candidate")?.details?.output?.result ?? {};
        return Object.freeze({
          answer: runtimeTurn.delivery.exact_text,
          deliveryKind: runtimeTurn.delivery.kind,
          runtimeTurn: structuredClone(runtimeTurn),
          runtimeMetadata: structuredClone(productionResult),
          durableCaseState: structuredClone(record.case_state),
          caseStateDiff: record.last_state_diff ? structuredClone(record.last_state_diff) : null
        });
      }

      if (runtimeTurn.state === "RECEIVED") {
        // A candidate that already completed keeps the evidence it was produced with. Freezing again
        // after a restart could pick up a newer snapshot, miss the completed call, produce a second
        // candidate, and leave the audit with a different packet from the one the producer saw.
        const candidateCompleted = runtimeTurn.events.some((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "candidate");
        const record = await loadCase(caseId, authContext);
        const owned = snapshotsFor(record, runtimeTurn);
        const governed = evidenceEnforced || owned.length > 0;
        const completedOutput = runtimeTurn.events.find((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "candidate")?.details?.output;
        const snapshot = governed ? (candidateCompleted
          ? owned.find((entry) => entry.id === completedOutput?.responseEvidenceInclusion?.snapshot_id)
          : owned.at(-1) ?? await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, authContext })) : null;
        const evidence = governed ? modelEvidence(await loadCase(caseId, authContext), snapshot) : null;
        const journalEvidence = governed ? null : candidateCompleted
          ? frozenJournalEvidence(runtimeTurn)
          : await freezeJournalEvidence({ caseId, runtimeTurn, userInput, authContext });
        const produced = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "candidate",
          inputIdentity: { runtime_turn_id: runtimeTurn.id, inbound_sha256: runtimeTurn.inbound.sha256, repair_cycle: 0, journal_evidence_sha256: journalEvidence?.sha256 ?? null, ...(evidence ? { response_evidence_snapshot_sha256: snapshot.snapshot_sha256 } : {}) },
          authContext,
          execute: async (attemptContextId) => ({
            ...(await modelRuntime.produceCandidate({ caseId, runtimeTurn, userInput, journalEvidence, ...(evidence ? { responseEvidence: evidence } : {}), authContext, attemptContextId })),
            journalEvidence
          })
        });
        await call("commitPrivateRuntimeCandidate", [caseId, {
          runtimeTurnId,
          candidateId: candidateId(operationKey, 0),
          exactText: produced.exactText,
          producerContextId: produced.contextId,
          caseState: produced.caseState,
          stateDiff: produced.stateDiff,
          diffId: `diff:runtime:${operationKey}`,
          ...(evidence ? { responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: produced.responseEvidenceInclusion?.view_sha256 } } : {}),
          metadata: {
            producer_attempt_context_id: produced.result?.producerAttemptContextId ?? null,
            journal_evidence_sha256: produced.journalEvidence?.sha256 ?? null,
            compatibility_state_binding: produced.result?.compatibilityBinding ?? null
          },
          eventId: `runtime-event:${operationKey}:candidate:v1:persisted`
        }], authContext);
        continue;
      }

      if (runtimeTurn.state === "CANDIDATE_PENDING_AUDIT") {
        await call("transitionPrivateRuntimeTurn", [caseId, runtimeTurnId, {
          eventId: `runtime-event:${operationKey}:audit:v${runtimeTurn.repair_cycle + 1}:started`,
          toState: "AUDITING",
          details: { candidate_id: runtimeTurn.current_candidate_id, repair_cycle: runtimeTurn.repair_cycle }
        }], authContext);
        continue;
      }

      if (runtimeTurn.state === "AUDITING") {
        const record = await loadCase(caseId, authContext);
        const candidate = exactCandidate(record, runtimeTurn.current_candidate_id);
        const responseEvidenceInput = candidate.metadata.response_evidence ? modelEvidence(record, record.response_evidence_snapshots.find((entry) => entry.id === candidate.metadata.response_evidence.snapshot_id)) : null;
        const journalEvidence = responseEvidenceInput ? null : frozenJournalEvidence(runtimeTurn);
        const audited = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "audit",
          inputIdentity: { candidate_id: candidate.id, candidate_version: candidate.version, candidate_sha256: sha256(candidate.exact_text), journal_evidence_sha256: journalEvidence?.sha256 ?? null, ...(responseEvidenceInput ? { response_evidence_snapshot_sha256: responseEvidenceInput.snapshot.snapshot_sha256 } : {}) },
          authContext,
          execute: (attemptContextId) => modelRuntime.auditCandidate({ caseId, candidateId: candidate.id, candidate, journalEvidence, ...(responseEvidenceInput ? { responseEvidence: responseEvidenceInput } : {}), authContext, attemptContextId })
        });
        if (audited.contextId === candidate.producer_context_id) throw new ValidationError("Candidate producer cannot audit the exact text it produced.");
        const auditResult = audited.value ?? audited.result;
        const evidence = createCandidateAuditEvidence({
          auditId: auditId(operationKey, candidate.repair_cycle),
          candidate,
          auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
          auditorContext: { kind: "independent", context_id: audited.contextId },
          findings: auditResult.findings,
          repairInducedChecks: auditResult.repair_induced_checks ?? [],
          independentAuditorAvailable: true,
          ...(responseEvidenceInput ? { responseEvidence: { snapshotId: responseEvidenceInput.snapshot.id, snapshotSha256: responseEvidenceInput.snapshot.snapshot_sha256, auditorInclusionSha256: audited.responseEvidenceInclusion?.view_sha256, review: auditResult.evidence_review, snapshot: responseEvidenceInput.snapshot } } : {})
        });
        await call("commitPrivateRuntimeAudit", [caseId, runtimeTurnId, evidence, {
          eventId: `runtime-event:${operationKey}:audit:v${candidate.repair_cycle + 1}:persisted`
        }], authContext);
        continue;
      }

      if (runtimeTurn.state === "REPAIR_REQUIRED") {
        await call("transitionPrivateRuntimeTurn", [caseId, runtimeTurnId, {
          eventId: `runtime-event:${operationKey}:repair:v${runtimeTurn.repair_cycle + 2}:started`,
          toState: "RECONSTRUCTING",
          details: { parent_candidate_id: runtimeTurn.current_candidate_id, next_repair_cycle: runtimeTurn.repair_cycle + 1 }
        }], authContext);
        continue;
      }

      if (runtimeTurn.state === "RECONSTRUCTING") {
        const record = await loadCase(caseId, authContext);
        const parent = exactCandidate(record, runtimeTurn.current_candidate_id);
        const sourceAudit = parent.audit_history.at(-1);
        const owned = snapshotsFor(record, runtimeTurn);
        let snapshot = owned.at(-1);
        const repairCompleted = [...runtimeTurn.events].reverse().find((event) => {
          if (event.stage !== "repair" || event.event_type !== "INVOCATION_COMPLETED") return false;
          const completedSnapshot = owned.find((entry) => entry.id === event.details?.output?.responseEvidenceInclusion?.snapshot_id);
          return completedSnapshot && event.input_sha256 === jsonHash(repairInputIdentity(parent, sourceAudit, null, completedSnapshot));
        });
        if (repairCompleted) snapshot = owned.find((entry) => entry.id === repairCompleted.details.output.responseEvidenceInclusion.snapshot_id);
        else if (snapshot && owned.length < 3) {
          const missing = sourceAudit?.response_evidence?.review?.missing_material_history ?? [];
          const expand = missing.length > 0 && typeof journalEvidenceProvider?.freezeResponseEvidenceJournal === "function" && !owned.some((entry) => entry.revision_reason === "evidence_expansion");
          const rootCandidate = exactCandidate(record, parent.root_candidate_id);
          if (expand || !responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate })) snapshot = await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, authContext, reason: expand ? "evidence_expansion" : "dependency_refresh", ...(expand ? { query: missing.map((entry) => entry.question).join("\n").slice(0, 8000) } : {}) });
        }
        const evidence = snapshot ? modelEvidence(await loadCase(caseId, authContext), snapshot) : null;
        const journalEvidence = evidence ? null : frozenJournalEvidence(runtimeTurn);
        const repaired = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "repair",
          inputIdentity: repairInputIdentity(parent, sourceAudit, journalEvidence, snapshot),
          authContext,
          execute: (attemptContextId) => modelRuntime.repairCandidate({ caseId, candidate: parent, journalEvidence, ...(evidence ? { responseEvidence: evidence } : {}), authContext, attemptContextId })
        });
        await call("commitPrivateRuntimeCandidate", [caseId, {
          runtimeTurnId,
          candidateId: candidateId(operationKey, parent.repair_cycle + 1),
          exactText: repaired.exactText,
          producerContextId: repaired.contextId,
          parentCandidateId: parent.id,
          basedOnAuditId: sourceAudit.id,
          ...(evidence ? { responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: repaired.responseEvidenceInclusion?.view_sha256 } } : {}),
          metadata: {
            repair_induced_error_checks_required: [...REPAIR_INDUCED_ERROR_CHECKS],
            compatibility_state_binding: parent.metadata?.compatibility_state_binding ?? null
          },
          eventId: `runtime-event:${operationKey}:candidate:v${parent.repair_cycle + 2}:persisted`
        }], authContext);
        continue;
      }

      if (runtimeTurn.state === "APPROVED") {
        await call("deliverPrivateRuntimeCandidate", [caseId, runtimeTurnId, {
          candidateId: runtimeTurn.current_candidate_id,
          assistantTurnId,
          eventId: `runtime-event:${operationKey}:candidate:delivered`
        }], authContext);
        continue;
      }

      if (runtimeTurn.state === "DISCRIMINATING_QUESTION_REQUIRED") {
        if (!runtimeTurn.discriminator) {
          let produced = await invoke({
            caseId,
            runtimeTurn,
            operationKey,
            stage: "discriminator",
            inputIdentity: { candidate_id: runtimeTurn.current_candidate_id, repair_cycle: runtimeTurn.repair_cycle },
            authContext,
            execute: (attemptContextId) => modelRuntime.produceDiscriminator({ caseId, runtimeTurn, authContext, attemptContextId })
          });
          let review = null;
          const record = await loadCase(caseId, authContext);
          const owned = snapshotsFor(record, runtimeTurn);
          if (owned.length && produced.kind !== OWNER_FALLBACK_KIND) {
            let snapshot = owned.at(-1);
            const candidate = exactCandidate(record, runtimeTurn.current_candidate_id);
            const rootCandidate = exactCandidate(record, candidate.root_candidate_id);
            const completedReview = runtimeTurn.events.find((event) => event.stage === "discriminator_review" && event.event_type === "INVOCATION_COMPLETED");
            let current = responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate });
            if (completedReview && completedReview.details?.output?.responseEvidenceInclusion?.snapshot_id !== snapshot.id) current = false;
            if (!current && !completedReview && owned.length < 3) {
              snapshot = await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, reason: "dependency_refresh", authContext });
              current = true;
            }
            if (current) {
              const evidence = modelEvidence(await loadCase(caseId, authContext), snapshot);
              const reviewed = await invoke({
                caseId, runtimeTurn, operationKey, stage: "discriminator_review",
                inputIdentity: { runtime_turn_id: runtimeTurn.id, sha256: sha256(produced.exactText), snapshot_sha256: snapshot.snapshot_sha256 }, authContext,
                execute: (attemptContextId) => modelRuntime.reviewFallbackQuestion({ caseId, runtimeTurn, exactText: produced.exactText, responseEvidence: evidence, authContext, attemptContextId })
              });
              const normalized = normalizeEvidenceReview(reviewed.value.evidence_review, { candidateText: produced.exactText, snapshot });
              if (!deriveEvidenceFindings(normalized).length && !reviewed.value.findings.some((item) => ["substantive", "high"].includes(item.severity))) {
                review = { schema_version: 1, exact_text_sha256: sha256(produced.exactText), snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256,
                  auditor_context_id: reviewed.contextId, auditor_inclusion_sha256: reviewed.responseEvidenceInclusion?.view_sha256,
                  findings: reviewed.value.findings, review: normalized };
              }
            }
            if (!review) {
              produced = await invoke({
                caseId, runtimeTurn, operationKey, stage: "discriminator",
                inputIdentity: { candidate_id: runtimeTurn.current_candidate_id, repair_cycle: runtimeTurn.repair_cycle, evidence_review_failed: true }, authContext,
                execute: (attemptContextId) => modelRuntime.produceDiscriminator({ caseId, runtimeTurn, authContext, attemptContextId, evidenceReviewFailed: true })
              });
              if (produced.kind !== OWNER_FALLBACK_KIND) throw new RuntimeError("The discriminating question could not pass response evidence review. Nothing was delivered.", { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
            }
          }
          // The owner fallback is saved and delivered as its own kind, so it is never mistaken for a question or an approved candidate.
          await call("savePrivateRuntimeDiscriminator", [caseId, runtimeTurnId, {
            exactText: produced.exactText,
            producerContextId: produced.contextId,
            ...(review ? { review } : {}),
            ...(produced.kind === OWNER_FALLBACK_KIND ? { kind: OWNER_FALLBACK_KIND } : {})
          }], authContext);
        }
        await call("deliverPrivateRuntimeDiscriminator", [caseId, runtimeTurnId, {
          assistantTurnId,
          eventId: `runtime-event:${operationKey}:discriminator:delivered`
        }], authContext);
        continue;
      }

      throw new RuntimeError(`Private runtime has no executable action for ${runtimeTurn.state}.`, {
        code: "PRIVATE_RUNTIME_FRONTIER_INVALID",
        details: { next_action: privateRuntimeNextAction(runtimeTurn) }
      });
    }
    throw new RuntimeError("Private runtime exceeded its bounded transition ceiling.", { code: "PRIVATE_RUNTIME_FRONTIER_INVALID" });
  }

  return Object.freeze({
    async run(input) {
      const caseId = input?.caseId;
      const previousTail = runTails.get(caseId) ?? Promise.resolve();
      let release;
      const currentTail = new Promise((resolve) => { release = resolve; });
      runTails.set(caseId, currentTail);
      await previousTail;
      try { return await executeRun(input); }
      finally {
        release();
        if (runTails.get(caseId) === currentTail) runTails.delete(caseId);
      }
    }
  });
}
