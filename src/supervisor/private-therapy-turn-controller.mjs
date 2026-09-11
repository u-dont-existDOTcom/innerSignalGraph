import { createHash } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { createCandidateAuditEvidence, REPAIR_INDUCED_ERROR_CHECKS } from "./private-candidate-lifecycle.mjs";
import { privateRuntimeNextAction } from "./private-runtime-turn-lifecycle.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "./private-candidate-audit.mjs";

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
    "PRIVATE_CASE_KEY_UNAVAILABLE"
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
  maximumInvocationAttempts = 2
} = {}) {
  if (!privateCaseSource || typeof privateCaseSource !== "object") throw new ValidationError("privateCaseSource is required.");
  if (!modelRuntime || typeof modelRuntime !== "object") throw new ValidationError("modelRuntime is required.");
  for (const method of ["produceCandidate", "auditCandidate", "repairCandidate", "produceDiscriminator"]) requiredFunction(modelRuntime[method], `modelRuntime.${method}`);
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

  async function invoke({ caseId, runtimeTurn, operationKey, stage, inputIdentity, authContext, execute }) {
    const inputSha256 = jsonHash(inputIdentity);
    const events = runtimeTurn.events.filter((event) => event.stage === stage && event.input_sha256 === inputSha256);
    const completed = [...events].reverse().find((event) => event.event_type === "INVOCATION_COMPLETED");
    if (completed) return normalizeInvocationOutput(completed.details.output);

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
    await call("beginPrivateRuntimeTurn", [caseId, { runtimeTurnId, exchangeId, userTurnId, exactText: userMessage }], authContext);
    const operationKey = sha256(runtimeTurnId).slice(0, 24);

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
        const produced = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "candidate",
          inputIdentity: { runtime_turn_id: runtimeTurn.id, inbound_sha256: runtimeTurn.inbound.sha256, repair_cycle: 0 },
          authContext,
          execute: (attemptContextId) => modelRuntime.produceCandidate({ caseId, runtimeTurn, userInput, authContext, attemptContextId })
        });
        await call("commitPrivateRuntimeCandidate", [caseId, {
          runtimeTurnId,
          candidateId: candidateId(operationKey, 0),
          exactText: produced.exactText,
          producerContextId: produced.contextId,
          caseState: produced.caseState,
          stateDiff: produced.stateDiff,
          diffId: `diff:runtime:${operationKey}`,
          metadata: { producer_attempt_context_id: produced.result?.producerAttemptContextId ?? null },
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
        const audited = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "audit",
          inputIdentity: { candidate_id: candidate.id, candidate_version: candidate.version, candidate_sha256: sha256(candidate.exact_text) },
          authContext,
          execute: (attemptContextId) => modelRuntime.auditCandidate({ caseId, candidateId: candidate.id, candidate, authContext, attemptContextId })
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
          independentAuditorAvailable: true
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
        const repaired = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "repair",
          inputIdentity: { parent_candidate_id: parent.id, parent_version: parent.version, parent_sha256: sha256(parent.exact_text), audit_id: sourceAudit?.id, repair_cycle: parent.repair_cycle + 1 },
          authContext,
          execute: (attemptContextId) => modelRuntime.repairCandidate({ caseId, candidate: parent, authContext, attemptContextId })
        });
        await call("commitPrivateRuntimeCandidate", [caseId, {
          runtimeTurnId,
          candidateId: candidateId(operationKey, parent.repair_cycle + 1),
          exactText: repaired.exactText,
          producerContextId: repaired.contextId,
          parentCandidateId: parent.id,
          basedOnAuditId: sourceAudit.id,
          metadata: { repair_induced_error_checks_required: [...REPAIR_INDUCED_ERROR_CHECKS] },
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
          const produced = await invoke({
            caseId,
            runtimeTurn,
            operationKey,
            stage: "discriminator",
            inputIdentity: { candidate_id: runtimeTurn.current_candidate_id, repair_cycle: runtimeTurn.repair_cycle },
            authContext,
            execute: (attemptContextId) => modelRuntime.produceDiscriminator({ caseId, runtimeTurn, authContext, attemptContextId })
          });
          await call("savePrivateRuntimeDiscriminator", [caseId, runtimeTurnId, { exactText: produced.exactText, producerContextId: produced.contextId }], authContext);
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
