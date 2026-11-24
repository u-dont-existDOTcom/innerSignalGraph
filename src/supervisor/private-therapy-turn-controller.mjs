import { createHash } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { createCandidateAuditEvidence, REPAIR_INDUCED_ERROR_CHECKS } from "./private-candidate-lifecycle.mjs";
import { isFinishedRuntimeTurn, privateRuntimeNextAction } from "./private-runtime-turn-lifecycle.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "./private-candidate-audit.mjs";
import { OWNER_FALLBACK_KIND } from "./owner-fallback-message.mjs";
import { PRIVATE_CASE_SCOPES } from "../storage/private-case-access.mjs";
import { CONTEXT_WINDOW_LIMITS } from "../case-state/context-window.mjs";
import { deriveEvidenceFindings, normalizeEvidenceReview, normalizeRecordOnlyFinding, runtimeAuditInputIdentity,
  runtimeCandidateInputIdentity as candidateInputIdentity, runtimeRepairInputIdentity as repairInputIdentity,
  prepareGovernedModelCall, responseEvidenceRefreshJournal, responseEvidenceDependenciesCurrent } from "./response-evidence-contract.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value) => sha256(JSON.stringify(value));

// The most finished turns the runner trial page's reconcile returns at once: after the page's last one, or when it names none.
const RECONCILE_TURN_LIMIT = 10;
// What a runner trial turn does with its case: it reads the case, writes the turn and records the turn's audit.
const RUNNER_TURN_SCOPES = Object.freeze([PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE, PRIVATE_CASE_SCOPES.AUDIT]);

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
  runnerConfig = null,
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
  // The runner trial's runtime (src/runner-trial/runtime.mjs) closes a turn it can't answer instead of producing a discriminator,
  // and says whether a repair still fits in the turn's time; every other runtime leaves this path exactly as it was.
  const closesTurns = typeof modelRuntime.closeTurn === "function";
  if (closesTurns) for (const method of ["repairFits", "closingReason", "closeUnfinishedTurns", "currentConversationTurnIds"]) requiredFunction(modelRuntime[method], `modelRuntime.${method}`);
  // Two optional hooks of the same runtime for a turn's journal (docs/superpowers/specs/2026-11-24-runner-journal-search-design.md), used
  // only with a session-use journal reader attached: `readBeforeEvidence` reads the message, and shows its first words, before any
  // journal search; `journalWithheld` says why a turn gets no journal now, or null. A runtime without them is called exactly as before.
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
  // The case's record when it exists, without creating one (the runner trial page's reconcile, for a case with no turns yet).
  const loadExistingCase = async (caseId, authContext) => {
    if (typeof privateCaseSource.loadPrivateRuntimeCase === "function") {
      try { return await privateCaseSource.loadPrivateRuntimeCase(caseId, authContext); }
      catch (error) { if (error?.code === "PRIVATE_CASE_NOT_FOUND") return null; throw error; }
    }
    return typeof privateCaseSource.load === "function" ? privateCaseSource.load(caseId) : privateCaseSource.loadOrCreate(caseId);
  };

  // One case's work is taken one at a time, in arrival order: a turn, the trial page's reconcile after a reload, a deletion.
  async function queued(caseId, operation) {
    const previousTail = runTails.get(caseId) ?? Promise.resolve();
    let release;
    const currentTail = new Promise((resolve) => { release = resolve; });
    runTails.set(caseId, currentTail);
    await previousTail;
    try { return await operation(); }
    finally {
      release();
      if (runTails.get(caseId) === currentTail) runTails.delete(caseId);
    }
  }

  // The check a runner trial turn of this case needs, made before anything of a turn is shared: the case's read, write and audit
  // scopes, from a source that authorizes each request for its case (the access service); a source without that (the owner's own
  // store opened by this server) has nothing to check. The turn makes it first, and the page's stream makes the same check before
  // it listens for the case's events, so a request the turn would refuse hears nothing of another request's turn.
  async function authorizeTurn({ caseId, authContext }) {
    if (typeof privateCaseSource.authorizeCase !== "function") return;
    for (const scope of RUNNER_TURN_SCOPES) await privateCaseSource.authorizeCase(caseId, authContext, scope);
  }

  // The runner trial page's recovery when it loads (docs/superpowers/specs/2026-11-21-runner-trial-design.md, section 8). The store
  // can't list cases, so a restart can't find unfinished turns by itself: the page names its case. Inside the case's queue, so a
  // turn still running in this server is waited for, never closed under it. Every unfinished turn is closed as interrupted, except
  // an APPROVED one, which is delivered. Then a page that still shows its earlier turns gets the finished turns after the last one
  // it shows, so a reply that finished while the page was gone is shown (at most RECONCILE_TURN_LIMIT, the latest); a page that
  // shows none of them (a reload: the page keeps no transcript) gets every turn of the current conversation instead.
  async function reconcileCase({ caseId, afterExchangeId, currentConversation = false, authContext }) {
    let record = await loadExistingCase(caseId, authContext);
    if (!record) return [];
    // The runner trial's kept plan: one past its 30 days is deleted when the page loads, whether or not its switch is on now.
    if (typeof modelRuntime.expireKeptPlans === "function") record = await modelRuntime.expireKeptPlans({ caseId, record, authContext });
    if (record.runtime_turns.some((turn) => !isFinishedRuntimeTurn(turn))) {
      await modelRuntime.closeUnfinishedTurns({ caseId, keepRuntimeTurnId: null, authContext });
      record = await loadCase(caseId, authContext);
    }
    const finished = record.runtime_turns.filter(isFinishedRuntimeTurn);
    let turns;
    if (currentConversation) {
      const conversation = new Set(modelRuntime.currentConversationTurnIds(record));
      turns = finished.filter((turn) => conversation.has(turn.id));
    } else {
      const shownAt = afterExchangeId == null ? -1 : finished.findIndex((turn) => turn.exchange_id === afterExchangeId);
      turns = finished.slice(shownAt + 1).slice(-RECONCILE_TURN_LIMIT);
    }
    return turns.map((turn) => Object.freeze({
      exchangeId: turn.exchange_id,
      userMessage: turn.inbound.exact_text,
      answer: turn.delivery?.exact_text ?? turn.closure?.exact_text ?? null,
      deliveryKind: turn.delivery?.kind ?? turn.closure?.kind ?? null,
      closing: turn.closure ? Object.freeze({ kind: turn.closure.kind, reason_code: turn.closure.reason_code }) : null,
      provisional: turn.provisional?.exact_text ?? null,
      emergencyLineShown: Boolean(turn.emergency_line_shown_at)
    }));
  }

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
  const searchesJournal = typeof journalEvidenceProvider?.freezeResponseEvidenceJournal === "function";
  const holdsQuotation = (snapshot) => (snapshot?.source_items ?? []).some((entry) => entry.kind === "journal_quotation");
  // Why this turn gets no journal now, or null (journalWithheld). Every snapshot of a turn asks it as it is frozen, whatever made the
  // freeze, so a snapshot never holds a quotation the turn may not have; a repair asks it again for the snapshot it would go on with. With
  // no reader attached (any more), it is asked only where the snapshot before holds a quotation to carry over.
  const withheldNow = async ({ caseId, runtimeTurn, previous, authContext }) => ((searchesJournal || holdsQuotation(previous)) && typeof modelRuntime.journalWithheld === "function"
    ? await modelRuntime.journalWithheld({ caseId, runtimeTurn, authContext }) : null);
  // Every journal search of a turn is made here, the message's own and the repair's expansion. `expansion`, for the repair's: each
  // missing-history question, and the journal part of the snapshot it adds to.
  const journalPart = async ({ caseId, query, expansion = null, authContext }) => {
    if (!journalEvidenceProvider) return { availability: "not_configured" };
    if (!searchesJournal) return { availability: "unavailable", retrieval_status: "not_attempted", omissions: [{ reason: "legacy_provider_contract", count: 1 }] };
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => journalEvidenceProvider.freezeResponseEvidenceJournal({ caseId, query, ...(expansion ?? {}), maximumTokens: 8000, maximumBytes: 64000, authContext })),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Journal retrieval timed out.")), journalTimeoutMs); })
      ]);
    } catch (error) {
      return error?.code === "PRIVATE_CASE_ACCESS_DENIED" || error?.code === "JOURNAL_SESSION_USE_NOT_AUTHORIZED"
        ? { availability: "not_authorized", retrieval_status: "not_attempted" }
        : { availability: "unavailable", retrieval_status: "failed" };
    } finally { clearTimeout(timer); }
  };
  // A journal query is bounded text (the session-use adapter refuses more): as long as a message of the transcript may be, so that a whole
  // message is searched and its point counts wherever it stands.
  const JOURNAL_QUERY_CHARACTERS = CONTEXT_WINDOW_LIMITS.turn_text;
  const freezeSnapshot = async ({ caseId, runtimeTurn, operationKey, record, reason = "initial", query = runtimeTurn.inbound.exact_text.slice(0, JOURNAL_QUERY_CHARACTERS), questions = null, authContext }) => {
    const previous = snapshotsFor(record, runtimeTurn).at(-1);
    const revision = (previous?.revision ?? 0) + 1;
    let journal;
    try {
      const withheld = await withheldNow({ caseId, runtimeTurn, previous, authContext });
      if (withheld) journal = { availability: "unavailable", retrieval_status: "not_attempted", omissions: [{ reason: withheld, count: 1 }] };
    } catch {
      // A decision that can't be made is a failed retrieval: no search, and nothing carried over.
      journal = { availability: "unavailable", retrieval_status: "failed" };
    }
    if (!journal) {
      const expansion = questions ? { questions, addsTo: responseEvidenceRefreshJournal(record, previous) } : null;
      journal = reason === "dependency_refresh" ? responseEvidenceRefreshJournal(record, previous) : await journalPart({ caseId, query, expansion, authContext });
    }
    return call("freezeResponseEvidence", [caseId, {
      snapshotId: `snapshot:runtime:${operationKey}:r${revision}`, owner: { kind: "runtime_turn", runtime_turn_id: runtimeTurn.id },
      revision, parentSnapshotId: previous?.id ?? null, revisionReason: reason, candidateOrigin: "backend_produced",
      inbound: { turn_id: runtimeTurn.user_turn_id, exact_text_sha256: runtimeTurn.inbound.sha256, audience: "client", source_kind: "exact_client_turn" },
      historyRequirements: [], journal
    }], authContext);
  };
  const prepareCall = async ({ caseId, runtimeTurn, operationKey, record, snapshot, rootCandidate = null, completed = null, authContext }) => {
    const prepared = await prepareGovernedModelCall({ record, snapshot, rootCandidate, completed,
      load: () => loadCase(caseId, authContext),
      freeze: (reason, current) => freezeSnapshot({ caseId, runtimeTurn, operationKey, record: current.record, reason, authContext }) });
    if (prepared.exhausted && runtimeTurn.state !== "AUDITING") {
      throw new RuntimeError("InnerSignal could not safely complete this response. Nothing unaudited was delivered.", {
        code: "THERAPY_RUNTIME_UNAVAILABLE", details: { response_evidence_revisions_exhausted: true }
      });
    }
    return prepared;
  };

  async function invoke({ caseId, runtimeTurn, operationKey, stage, inputIdentity, authContext, execute }) {
    let lastError = null;
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
      const evidenceSha = inputIdentity.response_evidence_snapshot_sha256 ?? inputIdentity.snapshot_sha256;
      if (evidenceSha) {
        const record = await loadCase(caseId, authContext);
        const snapshot = stage === "audit" ? snapshotsFor(record, runtimeTurn).find(entry => entry.snapshot_sha256 === evidenceSha) : snapshotsFor(record, runtimeTurn).at(-1);
        if (snapshot?.snapshot_sha256 !== evidenceSha) throw new ValidationError("Model input changed.", { code: "RESPONSE_EVIDENCE_CALL_INPUT_CHANGED" });
        const candidate = record.candidate_responses.find(entry => entry.id === runtimeTurn.current_candidate_id);
        const rootCandidate = record.candidate_responses.find(entry => entry.id === candidate?.root_candidate_id);
        const prepared = await prepareCall({ caseId, runtimeTurn, operationKey, record, snapshot, rootCandidate, authContext });
        if (prepared.refreshed || prepared.exhausted) throw new ValidationError("Model input changed.", { code: "RESPONSE_EVIDENCE_CALL_INPUT_CHANGED" });
      }
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
        lastError = error;
        if (error?.code === "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED") throw error;
        if (nonRetryable(error)) break;
        attempt += 1;
      }
    }
    throw new RuntimeError("InnerSignal could not safely complete this response. Nothing unaudited was delivered.", {
      code: "THERAPY_RUNTIME_UNAVAILABLE",
      details: { stage, attempts_exhausted: true, last_error_code: typeof lastError?.code === "string" ? lastError.code.slice(0, 80) : null }
    });
  }

  async function executeRun({ caseId, runtimeTurnId, exchangeId, userTurnId, assistantTurnId, userMessage, userInput = {}, authContext }) {
    // A supervisor correction is not an inbound client therapy turn. Reject it before
    // private persistence or model inference; the explicit unsent edit path is separate.
    if (userInput && Object.hasOwn(userInput, "pendingReplyRevision")) {
      throw new ValidationError("Supervisor reply revision cannot be submitted to the private therapy response endpoint.");
    }
    // Inside the per-case queue (run below): on the runner trial's path the request is authorized for every scope the turn uses
    // before the turn does anything, then a turn of this case that a restart or a failure left unfinished is closed first, so the
    // new message isn't refused as busy. Only the runner trial's runtime does this.
    if (closesTurns) {
      await authorizeTurn({ caseId, authContext });
      await modelRuntime.closeUnfinishedTurns({ caseId, keepRuntimeTurnId: runtimeTurnId, authContext });
    }
    await call("beginPrivateRuntimeTurn", [caseId, { runtimeTurnId, exchangeId, userTurnId, exactText: userMessage, ...(closesTurns && runnerConfig ? { runnerConfig } : {}) }], authContext);
    const operationKey = sha256(`${caseId}\u0000${runtimeTurnId}`).slice(0, 24);

    const closeTurn = async (runtimeTurn, reasonCode) => {
      await modelRuntime.closeTurn({ caseId, runtimeTurn, reasonCode, assistantTurnId, eventId: `runtime-event:${operationKey}:closed`, authContext });
    };
    // One step of the turn's lifecycle, from its stored state. On the runner trial's path, a failed check with no time left for a
    // repair, and the end of the repairs, close the turn instead of producing a discriminator.
    const advance = async (runtimeTurn) => {
      if (runtimeTurn.state === "RECEIVED") {
        // A candidate that already completed keeps the evidence it was produced with. Freezing again
        // after a restart could pick up a newer snapshot, miss the completed call, produce a second
        // candidate, and leave the audit with a different packet from the one the producer saw.
        const record = await loadCase(caseId, authContext);
        const owned = snapshotsFor(record, runtimeTurn);
        const governed = evidenceEnforced || owned.length > 0;
        const candidateCompleted = [...runtimeTurn.events].reverse().find(event => {
          if (event.event_type !== "INVOCATION_COMPLETED" || event.stage !== "candidate") return false;
          const output = event.details?.output;
          const snapshot = owned.find(entry => entry.id === output?.responseEvidenceInclusion?.snapshot_id);
          return event.input_sha256 === jsonHash(candidateInputIdentity(runtimeTurn, output?.journalEvidence, snapshot));
        });
        const completedOutput = candidateCompleted?.details?.output;
        // The runner trial reads the message, and shows its first words, before anything is searched for it: an urgent message waits
        // for no journal, and a conversation about wanting to die gets none. What is read is stored once, so a turn that goes on after
        // a restart, and the writer below, go by the same readings. Without a journal reader to search, nothing is read here.
        const readFirst = governed && !candidateCompleted && searchesJournal && typeof modelRuntime.readBeforeEvidence === "function";
        if (readFirst) await modelRuntime.readBeforeEvidence({ caseId, runtimeTurn, userInput, authContext });
        let snapshot = governed ? (candidateCompleted
          ? owned.find((entry) => entry.id === completedOutput?.responseEvidenceInclusion?.snapshot_id)
          : owned.at(-1) ?? await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, authContext })) : null;
        // A sealed completion needs no current source view. Commit its original binding first; the store records
        // stale_at_commit and AUDITING takes the trusted stale-FAIL path if a source changed during the restart.
        const prepared = governed ? await prepareCall({ caseId, runtimeTurn, operationKey, record: await loadCase(caseId, authContext), snapshot, completed: candidateCompleted, authContext }) : null;
        if (prepared) snapshot = prepared.snapshot;
        const evidence = prepared?.evidence;
        const journalEvidence = governed ? null : candidateCompleted
          ? frozenJournalEvidence(runtimeTurn)
          : await freezeJournalEvidence({ caseId, runtimeTurn, userInput, authContext });
        const produced = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "candidate",
          inputIdentity: candidateInputIdentity(runtimeTurn, journalEvidence, snapshot),
          authContext,
          execute: async (attemptContextId) => ({
            ...(await modelRuntime.produceCandidate({ caseId, runtimeTurn, userInput, journalEvidence, ...(evidence ? { responseEvidence: evidence } : {}), ...(readFirst ? { turnRead: true } : {}), authContext, attemptContextId })),
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
          ...(snapshot ? { responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: produced.responseEvidenceInclusion?.view_sha256 } } : {}),
          metadata: {
            producer_attempt_context_id: produced.result?.producerAttemptContextId ?? null,
            journal_evidence_sha256: produced.journalEvidence?.sha256 ?? null,
            compatibility_state_binding: produced.result?.compatibilityBinding ?? null
          },
          eventId: `runtime-event:${operationKey}:candidate:v1:persisted`
        }], authContext);
        return;
      }

      if (runtimeTurn.state === "CANDIDATE_PENDING_AUDIT") {
        await call("transitionPrivateRuntimeTurn", [caseId, runtimeTurnId, {
          eventId: `runtime-event:${operationKey}:audit:v${runtimeTurn.repair_cycle + 1}:started`,
          toState: "AUDITING",
          details: { candidate_id: runtimeTurn.current_candidate_id, repair_cycle: runtimeTurn.repair_cycle }
        }], authContext);
        return;
      }

      if (runtimeTurn.state === "AUDITING") {
        const record = await loadCase(caseId, authContext);
        const candidate = exactCandidate(record, runtimeTurn.current_candidate_id);
        let responseEvidenceInput = null;
        if (candidate.metadata.response_evidence) {
          const snapshot = record.response_evidence_snapshots.find(entry => entry.id === candidate.metadata.response_evidence.snapshot_id);
          const completed = runtimeTurn.events.find(event => event.event_type === "INVOCATION_COMPLETED" && event.stage === "audit"
            && event.input_sha256 === jsonHash(runtimeAuditInputIdentity(candidate, null, snapshot)));
          const prepared = await prepareCall({ caseId, runtimeTurn, operationKey, record,
            snapshot: completed || responseEvidenceDependenciesCurrent(record, candidate, snapshot) ? snapshot : snapshotsFor(record, runtimeTurn).at(-1),
            rootCandidate: exactCandidate(record, candidate.root_candidate_id), completed, authContext });
          if (!completed && (prepared.exhausted || prepared.refreshed || prepared.snapshot.id !== snapshot.id || !responseEvidenceDependenciesCurrent(record, candidate, snapshot))) {
            await call("commitPrivateRuntimeEvidenceStale", [caseId, runtimeTurnId, {
              eventId: `runtime-event:${operationKey}:audit:v${candidate.repair_cycle + 1}:stale`
            }], authContext);
            return;
          }
          responseEvidenceInput = prepared.evidence ?? { snapshot };
        }
        const journalEvidence = responseEvidenceInput ? null : frozenJournalEvidence(runtimeTurn);
        const audited = await invoke({
          caseId,
          runtimeTurn,
          operationKey,
          stage: "audit",
          inputIdentity: runtimeAuditInputIdentity(candidate, journalEvidence, responseEvidenceInput?.snapshot),
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
        return;
      }

      if (runtimeTurn.state === "REPAIR_REQUIRED") {
        // The runner trial starts a repair only when a whole writer-and-checker round still fits in the turn's time.
        if (closesTurns && !(await modelRuntime.repairFits({ caseId, runtimeTurn }))) {
          await closeTurn(runtimeTurn, "checks_failed");
          return;
        }
        await call("transitionPrivateRuntimeTurn", [caseId, runtimeTurnId, {
          eventId: `runtime-event:${operationKey}:repair:v${runtimeTurn.repair_cycle + 2}:started`,
          toState: "RECONSTRUCTING",
          details: { parent_candidate_id: runtimeTurn.current_candidate_id, next_repair_cycle: runtimeTurn.repair_cycle + 1 }
        }], authContext);
        return;
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
        if (!snapshot && evidenceEnforced) snapshot = await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, authContext });
        if (repairCompleted) snapshot = owned.find((entry) => entry.id === repairCompleted.details.output.responseEvidenceInclusion.snapshot_id);
        else if (snapshot) {
          const missing = sourceAudit?.response_evidence?.review?.missing_material_history ?? [];
          const expand = owned.length < 3 && missing.length > 0 && searchesJournal && !owned.some((entry) => entry.revision_reason === "evidence_expansion");
          // A check that read the conversation as one that gets no journal leaves the repair none: the snapshot it would go on with is
          // frozen again without its quotations, and where no further snapshot may be frozen the turn closes.
          const closes = holdsQuotation(snapshot) && Boolean(await withheldNow({ caseId, runtimeTurn, previous: snapshot, authContext }));
          if (closes && owned.length >= 3) {
            throw new RuntimeError("InnerSignal could not safely complete this response. Nothing unaudited was delivered.", {
              code: "THERAPY_RUNTIME_UNAVAILABLE", details: { response_evidence_revisions_exhausted: true }
            });
          }
          if (expand) {
            const questions = missing.map((entry) => entry.question);
            snapshot = await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, authContext, reason: "evidence_expansion", query: questions.join("\n").slice(0, JOURNAL_QUERY_CHARACTERS), questions });
          } else if (closes) {
            snapshot = await freezeSnapshot({ caseId, runtimeTurn, operationKey, record, authContext, reason: "dependency_refresh" });
          }
        }
        const prepared = snapshot ? await prepareCall({ caseId, runtimeTurn, operationKey, record: await loadCase(caseId, authContext), snapshot,
          rootCandidate: exactCandidate(record, parent.root_candidate_id), completed: repairCompleted, authContext }) : null;
        if (prepared) snapshot = prepared.snapshot;
        const evidence = prepared?.evidence;
        const journalEvidence = snapshot ? null : frozenJournalEvidence(runtimeTurn);
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
          ...(snapshot ? { responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: repaired.responseEvidenceInclusion?.view_sha256 } } : {}),
          metadata: {
            repair_induced_error_checks_required: [...REPAIR_INDUCED_ERROR_CHECKS],
            compatibility_state_binding: parent.metadata?.compatibility_state_binding ?? null
          },
          eventId: `runtime-event:${operationKey}:candidate:v${parent.repair_cycle + 2}:persisted`
        }], authContext);
        return;
      }

      if (runtimeTurn.state === "APPROVED") {
        // The runner trial delivers an approved reply itself: one written with a client's journal in view only while that client's
        // consent stands, and one that response evidence no longer admits is closed instead (the design for clients, point 6).
        if (closesTurns && typeof modelRuntime.deliverApproved === "function") {
          await modelRuntime.deliverApproved({ caseId, runtimeTurn, assistantTurnId, eventId: `runtime-event:${operationKey}:candidate:delivered`, closeEventId: `runtime-event:${operationKey}:closed`, authContext });
          return;
        }
        await call("deliverPrivateRuntimeCandidate", [caseId, runtimeTurnId, {
          candidateId: runtimeTurn.current_candidate_id,
          assistantTurnId,
          eventId: `runtime-event:${operationKey}:candidate:delivered`
        }], authContext);
        return;
      }

      if (runtimeTurn.state === "DISCRIMINATING_QUESTION_REQUIRED") {
        if (closesTurns) {
          await closeTurn(runtimeTurn, "checks_failed");
          return;
        }
        const needsFirstReview = runtimeTurn.discriminator && runtimeTurn.discriminator.kind !== OWNER_FALLBACK_KIND
          && !runtimeTurn.discriminator_review && (evidenceEnforced || snapshotsFor(await loadCase(caseId, authContext), runtimeTurn).length > 0);
        if (!runtimeTurn.discriminator || needsFirstReview) {
          const before = await loadCase(caseId, authContext);
          const governed = evidenceEnforced || snapshotsFor(before, runtimeTurn).length > 0;
          const discriminatorIdentity = { candidate_id: runtimeTurn.current_candidate_id, repair_cycle: runtimeTurn.repair_cycle };
          const completedProduction = runtimeTurn.events.find(event => event.event_type === "INVOCATION_COMPLETED" && event.stage === "discriminator"
            && event.input_sha256 === jsonHash(discriminatorIdentity));
          if (governed && !runtimeTurn.discriminator && !completedProduction) await prepareCall({ caseId, runtimeTurn, operationKey, record: before,
            snapshot: snapshotsFor(before, runtimeTurn).at(-1), rootCandidate: exactCandidate(before, exactCandidate(before, runtimeTurn.current_candidate_id).root_candidate_id), authContext });
          let produced = runtimeTurn.discriminator ? {
            exactText: runtimeTurn.discriminator.exact_text, contextId: runtimeTurn.discriminator.producer_context_id
          } : await invoke({
            caseId,
            runtimeTurn,
            operationKey,
            stage: "discriminator",
            inputIdentity: discriminatorIdentity,
            authContext,
            execute: (attemptContextId) => modelRuntime.produceDiscriminator({ caseId, runtimeTurn, authContext, attemptContextId })
          });
          let review = null;
          const record = await loadCase(caseId, authContext);
          const owned = snapshotsFor(record, runtimeTurn);
          if ((evidenceEnforced || owned.length) && produced.kind !== OWNER_FALLBACK_KIND) {
            let snapshot = owned.at(-1);
            const candidate = exactCandidate(record, runtimeTurn.current_candidate_id);
            const rootCandidate = exactCandidate(record, candidate.root_candidate_id);
            const completedReview = runtimeTurn.events.find(event => event.stage === "discriminator_review" && event.event_type === "INVOCATION_COMPLETED"
              && owned.some(s => event.input_sha256 === jsonHash({ runtime_turn_id: runtimeTurn.id, sha256: sha256(produced.exactText), snapshot_sha256: s.snapshot_sha256 })));
            if (completedReview) snapshot = owned.find(s => s.id === completedReview.details.output.responseEvidenceInclusion?.snapshot_id);
            const prepared = await prepareCall({ caseId, runtimeTurn, operationKey, record, snapshot, rootCandidate, completed: completedReview, authContext });
            snapshot = prepared.snapshot;
            {
              const evidence = prepared.evidence;
              const reviewed = await invoke({
                caseId, runtimeTurn, operationKey, stage: "discriminator_review",
                inputIdentity: { runtime_turn_id: runtimeTurn.id, sha256: sha256(produced.exactText), snapshot_sha256: snapshot.snapshot_sha256 }, authContext,
                execute: (attemptContextId) => modelRuntime.reviewFallbackQuestion({ caseId, runtimeTurn, exactText: produced.exactText, responseEvidence: evidence, authContext, attemptContextId })
              });
              const normalized = normalizeEvidenceReview(reviewed.value.evidence_review, { candidateText: produced.exactText, snapshot });
              const findings = reviewed.value.findings.map(normalizeRecordOnlyFinding);
              if (!deriveEvidenceFindings(normalized).length && !findings.some((item) => ["substantive", "high"].includes(item.severity))) {
                review = { schema_version: 1, exact_text_sha256: sha256(produced.exactText), snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256,
                  auditor_context_id: reviewed.contextId, auditor_inclusion_sha256: reviewed.responseEvidenceInclusion?.view_sha256,
                  findings, review: normalized };
              }
            }
            if (!review) {
              if (runtimeTurn.discriminator) throw new RuntimeError("The stored discriminating question could not pass response evidence review. Nothing was delivered.", { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
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
        return;
      }

      throw new RuntimeError(`Private runtime has no executable action for ${runtimeTurn.state}.`, {
        code: "PRIVATE_RUNTIME_FRONTIER_INVALID",
        details: { next_action: privateRuntimeNextAction(runtimeTurn) }
      });
    };

    for (let step = 0; step < 40; step += 1) {
      const runtimeTurn = await call("getPrivateRuntimeTurn", [caseId, runtimeTurnId], authContext);
      if (runtimeTurn.state === "UNANSWERED") {
        const record = await loadCase(caseId, authContext);
        return Object.freeze({
          answer: runtimeTurn.closure.exact_text,
          deliveryKind: runtimeTurn.closure.kind,
          closing: Object.freeze({ kind: runtimeTurn.closure.kind, reason_code: runtimeTurn.closure.reason_code }),
          runtimeTurn: structuredClone(runtimeTurn),
          runtimeMetadata: {},
          durableCaseState: structuredClone(record.case_state),
          caseStateDiff: record.last_state_diff ? structuredClone(record.last_state_diff) : null
        });
      }
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

      try {
        await advance(runtimeTurn);
      } catch (error) {
        // A call whose response-evidence input changed under it is retried from the stored state.
        if (error?.code === "RESPONSE_EVIDENCE_CALL_INPUT_CHANGED") continue;
        if (!closesTurns) throw error;
        // The runner trial ends every failure with a closing, so the case is never left busy (design, section 7).
        const current = await call("getPrivateRuntimeTurn", [caseId, runtimeTurnId], authContext);
        if (isFinishedRuntimeTurn(current)) continue;
        if (current.state === "APPROVED") throw error;
        await closeTurn(current, modelRuntime.closingReason(error));
      }
    }
    throw new RuntimeError("Private runtime exceeded its bounded transition ceiling.", { code: "PRIVATE_RUNTIME_FRONTIER_INVALID" });
  }

  return Object.freeze({
    async run(input) {
      return queued(input?.caseId, () => executeRun(input));
    },
    // Only the runner trial's controller offers these: the turn's authorization, for the page's stream before it listens (it needs
    // no queue: it reads nothing of the case); its page's reconcile and "Delete this case", which wait for the case's queue.
    ...(closesTurns ? {
      authorizeTurn,
      async reconcile({ caseId, afterExchangeId = null, currentConversation = false, authContext } = {}) {
        return queued(caseId, () => reconcileCase({ caseId, afterExchangeId, currentConversation: currentConversation === true, authContext }));
      },
      async deleteCase({ caseId, authContext } = {}) {
        return queued(caseId, () => call("deletePrivateCase", [caseId], authContext));
      },
      // The plan kept for next time, only when the trial's runtime has it on (design, section 9): what the page needs to ask "Pick
      // up where we left off?" when it loads (read without creating a case), and its "Delete the kept plan". Both wait for the queue.
      ...(typeof modelRuntime.resumeStatus === "function" && typeof modelRuntime.deleteKeptPlans === "function" ? {
        async resumeStatus({ caseId, authContext } = {}) {
          return queued(caseId, async () => modelRuntime.resumeStatus({ caseId, record: await loadExistingCase(caseId, authContext), authContext }));
        },
        async deleteKeptPlan({ caseId, authContext } = {}) {
          return queued(caseId, () => modelRuntime.deleteKeptPlans({ caseId, authContext }));
        }
      } : {})
    } : {})
  });
}
