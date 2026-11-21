import { createHash } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { diffCaseStates, mergeRuntimeSnapshotIntoCaseState } from "../case-state/longitudinal-state.mjs";
import { buildTrajectoryDigest } from "../case-state/trajectory-digest.mjs";
import {
  childContactViolations,
  compatibilityStateBinding,
  protectiveCompatibilityDecision,
  validateCompatibilityAssessment
} from "../case-formulation/protective-compatibility.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS, isSubstantiveAuditFinding } from "../supervisor/private-candidate-lifecycle.mjs";
import { isFinishedRuntimeTurn } from "../supervisor/private-runtime-turn-lifecycle.mjs";
import { OWNER_FALLBACK_KIND } from "../supervisor/owner-fallback-message.mjs";
import { selfDirectedRiskAuditRules } from "../prompts/self-directed-risk-audit.mjs";
import { focusedRules, rulesFrom, wholeRules } from "./rule-parts.mjs";
import { LEVELS, isCrisisLevel, provisionalProblems, runProgramChecks, undeclaredQuotedSpans } from "./program-checks.mjs";
import {
  BOX_PICKER_SCHEMA,
  CHECKERS,
  CHECKER_SCHEMA,
  CRISIS_READER_SCHEMA,
  PROTECTION_READER_SCHEMA,
  WRITER_SCHEMA,
  boxPickerPrompt,
  checkerPrompt,
  crisisReaderPrompt,
  crisisReaderWantsToDieNote,
  protectionReaderPrompt,
  writerPrompt
} from "./worker-prompts.mjs";

// The runner trial's model runtime (docs/superpowers/specs/2026-11-21-runner-trial-design.md): the turn controller's four
// methods, plus the closing methods the controller uses on this path. Readers run at the same time, the provisional reply shows
// as soon as the crisis reader's passes its exact checks, the writer gets only the rules it needs, the checkers read the exact
// draft at the same time, the program's exact checks run on their readings, and every failure ends the turn with a closing.

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const contextIdOf = (receipts) => `context:${sha256(receipts.map((receipt) => `${receipt.provider}:${receipt.model}:${receipt.session_id}`).join("|"))}`;

export const DEFAULT_RUNNER_SETTINGS = Object.freeze({
  writerMode: "focused",
  checkerMode: "split",
  provisionalLevels: Object.freeze(["acted_or_about_to"]),
  fixedMessageOn: "failed_checks",
  deadlineMs: 300_000,
  roundMs: 100_000,
  limits: Object.freeze({ reader: 30_000, writer: 120_000, checker: 90_000 }),
  backgroundTurns: 20,
  conversationGapMs: 12 * 60 * 60 * 1000,
  maxBoxes: 6
});

const RISK_FROM_LEVEL = Object.freeze({ acted_or_about_to: "imminent", thoughts_no_intent: "ideation", none: "absent", unclear: "unknown" });
const ROUTE_FROM_LEVEL = Object.freeze({
  acted_or_about_to: ["RUNNER.ACTED_OR_ABOUT_TO", "Someone has acted or is about to"],
  wants_to_die: ["RUNNER.WANTS_TO_DIE", "Someone says they want to die"]
});

// What a stored crisis reading means for the records (design, section 6): the risk record's own words, derived by program.
export function riskVariablesFrom(crisis) {
  if (!crisis || !LEVELS.includes(crisis.level)) return { suicidal_state: "unknown", suicidal_ideation_context: "unknown" };
  const state = crisis.level === "wants_to_die" ? (crisis.wish_or_intent === "wish" ? "ideation" : "intent") : RISK_FROM_LEVEL[crisis.level];
  const context = state === "absent" ? "not_in_play" : state === "unknown" ? "unknown" : (crisis.pain_linked && crisis.level !== "acted_or_about_to" ? "pain_episode" : "other_or_unclear");
  return { suicidal_state: state, suicidal_ideation_context: context };
}

export class RunnerDeadlineError extends RuntimeError {
  constructor(stage) { super(`The turn's time ran out before ${stage}.`, { code: "TIMEOUT", details: { stage } }); }
}

function validLevel(value) { return LEVELS.includes(value) ? value : "unclear"; }

function normalizeFindings(checkerId, findings) {
  if (!Array.isArray(findings)) throw new ValidationError(`${checkerId} returned no findings list.`, { code: "PROVIDER_MALFORMED" });
  return findings.slice(0, 24).map((finding, index) => {
    const severity = ["low", "medium", "substantive", "high"].includes(finding?.severity) ? finding.severity : "high";
    const code = /^[A-Z][A-Z0-9_]{2,79}$/u.test(finding?.code ?? "") ? finding.code : "UNSPECIFIED_FINDING";
    const summary = String(finding?.summary ?? "").trim().slice(0, 600) || "No summary given.";
    const evidence = Array.isArray(finding?.evidence_turn_ids) ? finding.evidence_turn_ids.filter((id) => typeof id === "string" && id.trim()).slice(0, 8) : [];
    return { id: `${checkerId}:${index + 1}`, code, severity, summary, evidence_turn_ids: evidence, checker: checkerId };
  });
}

export function createRunnerTrialRuntime({ privateCaseSource, parts, settings = {}, workerFor, ownerFallbackEnabled = false, onEvent = () => {}, now = () => Date.now() } = {}) {
  if (!privateCaseSource || !parts || typeof workerFor !== "function") throw new ValidationError("The runner trial needs its case source, rule parts and workers.");
  const config = { ...DEFAULT_RUNNER_SETTINGS, ...settings, limits: { ...DEFAULT_RUNNER_SETTINGS.limits, ...(settings.limits ?? {}) } };
  if (!["focused", "whole"].includes(config.writerMode) || !["split", "whole"].includes(config.checkerMode)) throw new ValidationError("Runner trial modes are invalid.", { code: "RUNNER_SETTINGS_INVALID" });
  if (!config.provisionalLevels.every((level) => ["acted_or_about_to", "wants_to_die"].includes(level))) throw new ValidationError("provisionalLevels is invalid.", { code: "RUNNER_SETTINGS_INVALID" });
  const emit = (runtimeTurnId, event) => { try { onEvent(runtimeTurnId, event); } catch { /* the page's stream never stops a turn */ } };

  const load = (caseId, authContext) => typeof privateCaseSource.loadPrivateRuntimeCase === "function"
    ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext)
    : privateCaseSource.loadOrCreate(caseId);
  const source = (method, args, authContext) => privateCaseSource[method](...args, authContext);

  const deadlineOf = (runtimeTurn) => Date.parse(runtimeTurn.created_at) + config.deadlineMs;
  const limitFor = (runtimeTurn, kind, stage) => {
    const left = deadlineOf(runtimeTurn) - now();
    if (left <= 1_000) throw new RunnerDeadlineError(stage);
    return Math.min(config.limits[kind], left);
  };

  // One worker call, with one retry when it timed out or answered in the wrong shape and the turn's time allows; never for a
  // plan limit, a lapsed sign-in or a refusal. Returns { value, receipts }.
  async function callWorker(role, { kind, runtimeTurn, system, user, schema, validate = (value) => value }) {
    const receipts = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const timeoutMs = limitFor(runtimeTurn, kind, role);
      const started = now();
      try {
        const result = await workerFor(role).call({ system, user, schema, timeoutMs, stage: role });
        receipts.push({ ...result.receipt, role, attempt });
        return { value: validate(result.value), receipts };
      } catch (error) {
        receipts.push({ role, attempt, failed: error?.code ?? "PROVIDER_FAILED", duration_ms: now() - started });
        const retryable = ["TIMEOUT", "PROVIDER_MALFORMED", "CODEX_RECEIPT_INCOMPLETE"].includes(error?.code) || error instanceof ValidationError;
        if (attempt === 2 || !retryable || deadlineOf(runtimeTurn) - now() < config.limits[kind] / 2) {
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), { receipts });
        }
      }
    }
    throw new RuntimeError(`${role} gave no answer.`, { code: "PROVIDER_FAILED" });
  }

  // This conversation, from the stored turns (design, section 6): each turn's person message, any provisional reply and
  // highlighted line shown, and what InnerSignal sent.
  function conversationView(record, conversationId, currentTurn) {
    const turns = [];
    const earlier = [];
    for (const turn of record.runtime_turns) {
      const into = turn.runner_reading?.conversation_id === conversationId || turn.id === currentTurn.id ? turns : earlier;
      into.push({ turn_id: turn.user_turn_id, role: "person", text: turn.inbound.exact_text });
      if (turn.provisional && turn.id !== currentTurn.id) into.push({ role: "InnerSignal", kind: "provisional reply", text: turn.provisional.exact_text });
      if (turn.emergency_line_shown_at && turn.id !== currentTurn.id) into.push({ role: "InnerSignal app", kind: "emergency line shown", text: "(the always-visible emergency line was shown in the conversation)" });
      const sent = turn.delivery?.exact_text ?? turn.closure?.exact_text;
      if (sent && turn.id !== currentTurn.id) into.push({ role: "InnerSignal", ...(turn.closure ? { kind: "notice" } : {}), text: sent });
    }
    return { turns, earlier: earlier.slice(-config.backgroundTurns) };
  }

  function conversationIdFor(record, runtimeTurn, userInput) {
    if (runtimeTurn.runner_reading?.conversation_id) return runtimeTurn.runner_reading.conversation_id;
    const previous = [...record.runtime_turns].reverse().find((turn) => turn.id !== runtimeTurn.id && turn.runner_reading?.conversation_id);
    const gap = previous ? Date.parse(runtimeTurn.created_at) - Date.parse(previous.created_at) : Infinity;
    if (!previous || userInput?.newConversation === true || gap > config.conversationGapMs) return `conversation:${sha256(runtimeTurn.id).slice(0, 24)}`;
    return previous.runner_reading.conversation_id;
  }

  // The crisis readings of this conversation's turns, by reader, for the exact checks and the closing.
  function conversationReadings(record, conversationId) {
    return record.runtime_turns.filter((turn) => turn.runner_reading?.conversation_id === conversationId).map((turn) => {
      const audits = turn.events.filter((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "audit");
      const checkerLevel = audits.at(-1)?.details?.output?.value?.checker_level ?? null;
      return { turnId: turn.id, crisis: turn.runner_reading?.readers?.crisis ?? null, checkerLevel, provisional: Boolean(turn.provisional) };
    });
  }
  const isCrisisConversation = (readings) => readings.some((entry) => isCrisisLevel(entry.crisis?.level) || isCrisisLevel(entry.checkerLevel));
  // "Getting safe" or "wanting to die" (design, section 7): the readings that stand in for the owner's four routes.
  const isFixedMessageConversation = (readings) => readings.some((entry) => isCrisisLevel(entry.crisis?.level) || isCrisisLevel(entry.checkerLevel)
    || entry.crisis?.in_danger_from_someone || entry.crisis?.danger_to_others || entry.crisis?.home_unsafe);

  async function showEmergencyLine(caseId, runtimeTurn, reason, authContext) {
    await source("recordRunnerEmergencyLine", [caseId, runtimeTurn.id, { reason }], authContext);
    emit(runtimeTurn.id, { type: "emergency_line", reason });
  }

  function readersPacket(view, runtimeTurn) {
    return { conversation: view.turns, latest_message: { turn_id: runtimeTurn.user_turn_id, text: runtimeTurn.inbound.exact_text } };
  }

  // The crisis reader, and the provisional reply when its reading allows one (design, section 4).
  async function runCrisisReader({ caseId, runtimeTurn, view, conversationId, priorCrisisConversation, authContext }) {
    const rules = rulesFrom([parts.crisis], ["the section on someone who may want to die, the chronic pain section and the harm-reduction paragraph of SKILL.md"]);
    const prompt = crisisReaderPrompt({ rules, packet: readersPacket(view, runtimeTurn) });
    const system = config.provisionalLevels.includes("wants_to_die") ? prompt.system.replace("Answer only with the JSON", `${crisisReaderWantsToDieNote()}\nAnswer only with the JSON`) : prompt.system;
    let reading = null;
    let receipts = [];
    try {
      const result = await callWorker("R1", { kind: "reader", runtimeTurn, system, user: prompt.user, schema: CRISIS_READER_SCHEMA, validate: (value) => ({ ...value, level: validLevel(value?.level), reason: String(value?.reason ?? "").slice(0, 400) }) });
      reading = result.value;
      receipts = result.receipts;
    } catch (error) {
      receipts = error.receipts ?? [];
    }
    const stored = { ...(reading ?? { level: "unclear", unread: true }), receipts };
    await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { crisis: stored } }], authContext);
    if (reading && config.provisionalLevels.includes(reading.level) && typeof reading.provisional_reply === "string") {
      const problems = provisionalProblems(reading.provisional_reply);
      if (problems.length === 0) {
        await source("recordRunnerProvisional", [caseId, runtimeTurn.id, { exactText: reading.provisional_reply.trim(), checks: ["a_number", "numbers_known", "shape", "links", "detox"] }], authContext);
        emit(runtimeTurn.id, { type: "provisional", text: reading.provisional_reply.trim() });
      } else {
        await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { provisional_refused: { problems } } }], authContext);
        if (reading.level === "acted_or_about_to") await showEmergencyLine(caseId, runtimeTurn, "provisional_not_shown", authContext);
      }
    } else if (reading?.level === "acted_or_about_to") {
      await showEmergencyLine(caseId, runtimeTurn, "no_provisional", authContext);
    } else if (!reading && priorCrisisConversation) {
      await showEmergencyLine(caseId, runtimeTurn, "no_reading_in_crisis_conversation", authContext);
    }
    return stored;
  }

  async function runBoxPicker({ runtimeTurn, view }) {
    if (config.writerMode !== "focused") return { boxes: [], receipts: [] };
    const rules = rulesFrom([parts.map, parts.boxPreamble, parts.boxIndex], ["the therapy map", "the box file's opening", "the box index"]);
    const prompt = boxPickerPrompt({ rules, packet: readersPacket(view, runtimeTurn) });
    try {
      const result = await callWorker("R2", { kind: "reader", runtimeTurn, ...prompt, schema: BOX_PICKER_SCHEMA, validate: (value) => ({ boxes: (Array.isArray(value?.boxes) ? value.boxes : []).filter((id) => typeof id === "string" && parts.boxes[id]).slice(0, config.maxBoxes) }) });
      return { boxes: result.value.boxes, receipts: result.receipts };
    } catch (error) {
      // No picks: the writer gets every box (the whole box file), never fewer rules.
      return { boxes: null, receipts: error.receipts ?? [] };
    }
  }

  async function runProtectionReader({ runtimeTurn, view, record }) {
    const rules = rulesFrom([parts.references["PROTECTIVE-COMPATIBILITY"]], ["the protective-compatibility boundary"]);
    const current = record.case_state?.protective_compatibility?.current ?? null;
    const prompt = protectionReaderPrompt({ rules, packet: { ...readersPacket(view, runtimeTurn), current_gate: current ? { gate: current.gate, issue: current.issue ?? "", reentry_status: current.reentry_status ?? null } : { gate: "NOT_BLOCKED" } } });
    const turnIds = new Set(view.turns.filter((turn) => turn.turn_id).map((turn) => turn.turn_id));
    try {
      const result = await callWorker("R3", { kind: "reader", runtimeTurn, ...prompt, schema: PROTECTION_READER_SCHEMA, validate: (value) => ({ assessment: validateCompatibilityAssessment(value?.compatibility_assessment ?? null, { observationIds: turnIds }) }) });
      return { assessment: result.value.assessment, receipts: result.receipts };
    } catch (error) {
      // No reading keeps the stored gate (a prior restriction survives).
      return { assessment: null, unread: true, receipts: error.receipts ?? [] };
    }
  }

  // The case state after this turn's readings: the risk record from the crisis reading, the compatibility record from the
  // protection reading, one history item per turn (design, section 6).
  function stateAfterReadings(previous, runtimeTurn, readers) {
    const crisis = readers.crisis ?? null;
    const [routeId, routeTitle] = ROUTE_FROM_LEVEL[crisis?.level] ?? ["RUNNER.CONVERSATION", "A runner trial conversation turn"];
    const snapshot = {
      variables: riskVariablesFrom(crisis?.unread ? null : crisis),
      compatibility_assessment: readers.protection?.assessment ?? null,
      direct_observations: [],
      hypotheses: []
    };
    const caseState = mergeRuntimeSnapshotIntoCaseState(previous, snapshot, {
      turnId: runtimeTurn.user_turn_id,
      recordedAt: runtimeTurn.inbound.received_at,
      interventionContract: { primaryJob: { id: routeId, title: routeTitle }, nextQuestion: "", selectedNodes: [], variables: {} }
    });
    return { caseState, stateDiff: diffCaseStates(previous, caseState) };
  }

  function writerRules(picks, extraBoxes = []) {
    if (config.writerMode === "whole") return wholeRules(parts);
    if (picks == null) return focusedRules(parts, Object.keys(parts.boxes));
    return focusedRules(parts, [...new Set([...picks, ...extraBoxes])]);
  }

  function writerPacket({ record, runtimeTurn, view, readers, journalEvidence, provisional }) {
    const gate = record.case_state?.protective_compatibility?.current ?? null;
    return {
      conversation: view.turns,
      latest_message: { turn_id: runtimeTurn.user_turn_id, text: runtimeTurn.inbound.exact_text },
      earlier_conversations: view.earlier,
      ...(provisional ? { provisional_reply_shown: provisional } : {}),
      crisis_reading: readers.crisis?.unread ? null : { level: readers.crisis?.level ?? "unclear", reason: readers.crisis?.reason ?? "" },
      ...(gate && gate.gate !== "NOT_BLOCKED" ? { child_contact_gate: { gate: gate.gate, route: gate.route ?? null } } : {}),
      ...(journalEvidence ? { journal_evidence: journalEvidence.packet } : {})
    };
  }

  function validateWriter(value) {
    if (typeof value?.reply !== "string" || !value.reply.trim()) throw new ValidationError("The writer returned no reply.", { code: "PROVIDER_MALFORMED" });
    return {
      reply: value.reply.trim(),
      answered_level: validLevel(value.answered_level),
      quotes: (Array.isArray(value.quotes) ? value.quotes : []).filter((quote) => typeof quote?.text === "string" && quote.text.trim()).slice(0, 12)
        .map((quote) => ({ text: quote.text.slice(0, 1_000), source_id: String(quote.source_id ?? "").slice(0, 160) }))
    };
  }

  // Boxes a box checker said were missed on an earlier draft of this turn; the repair writer and the next check get them.
  const missedBoxesOf = (runtimeTurn) => runtimeTurn.events
    .filter((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "audit")
    .flatMap((event) => event.details?.output?.value?.missed_boxes ?? [])
    .filter((id) => parts.boxes[id]);

  const writerOutputOf = (runtimeTurn, exactText) => [...runtimeTurn.events].reverse()
    .find((event) => event.event_type === "INVOCATION_COMPLETED" && ["candidate", "repair"].includes(event.stage) && event.details?.output?.exactText === exactText)
    ?.details?.output?.result ?? {};

  async function loadRiskContext(caseId, authContext) {
    const options = { candidateId: "current_pending", forReplyCheck: true, requireAuditScope: true, requireContinuationSafe: false };
    try {
      const context = typeof privateCaseSource.loadPrivateRuntimeCase === "function"
        ? await privateCaseSource.loadCaseContext(caseId, authContext, options)
        : await privateCaseSource.loadCaseContext(caseId, options);
      return { trajectory_digest: buildTrajectoryDigest(context), targeted_older_evidence: context.targeted_older_evidence ?? [] };
    } catch {
      return { unavailable: true };
    }
  }

  return Object.freeze({
    settings: Object.freeze(structuredClone(config)),

    async produceCandidate({ caseId, runtimeTurn, userInput = {}, journalEvidence = null, authContext }) {
      const record = await load(caseId, authContext);
      const conversationId = conversationIdFor(record, runtimeTurn, userInput);
      const view = conversationView(record, conversationId, runtimeTurn);
      const priorCrisisConversation = isCrisisConversation(conversationReadings(record, conversationId).filter((entry) => entry.turnId !== runtimeTurn.id));
      emit(runtimeTurn.id, { type: "status", step: "reading" });
      const [crisis, boxes, protection] = await Promise.all([
        runCrisisReader({ caseId, runtimeTurn, view, conversationId, priorCrisisConversation, authContext }),
        runBoxPicker({ runtimeTurn, view }),
        runProtectionReader({ runtimeTurn, view, record })
      ]);
      const stored = await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { boxes, protection } }], authContext);
      const readers = stored.readers;
      const fresh = await load(caseId, authContext);
      const freshTurn = fresh.runtime_turns.find((turn) => turn.id === runtimeTurn.id);
      const provisional = freshTurn?.provisional?.exact_text ?? null;
      const { caseState, stateDiff } = stateAfterReadings(fresh.case_state, runtimeTurn, readers);
      emit(runtimeTurn.id, { type: "status", step: "writing" });
      const rules = writerRules(readers.boxes?.boxes ?? null);
      const prompt = writerPrompt({ rules, packet: writerPacket({ record: { case_state: caseState }, runtimeTurn, view, readers, journalEvidence, provisional }) });
      const written = await callWorker("W", { kind: "writer", runtimeTurn, ...prompt, schema: WRITER_SCHEMA, validate: validateWriter });
      return {
        exactText: written.value.reply,
        contextId: contextIdOf(written.receipts.filter((receipt) => receipt.session_id)),
        caseState,
        stateDiff,
        result: {
          mode: "runner-trial",
          processingTier: "runner-trial",
          routingReason: `runner trial: ${config.writerMode} writer, ${config.checkerMode} checkers`,
          answeredLevel: written.value.answered_level,
          quotes: written.value.quotes,
          rules: { parts: rules.parts, boxes: rules.boxIds },
          receipts: [...(readers.crisis?.receipts ?? []), ...(readers.boxes?.receipts ?? []), ...(readers.protection?.receipts ?? []), ...written.receipts],
          compatibilityBinding: compatibilityStateBinding(caseState.protective_compatibility ?? null)
        }
      };
    },

    async auditCandidate({ caseId, candidate, journalEvidence = null, authContext }) {
      const record = await load(caseId, authContext);
      const runtimeTurn = record.runtime_turns.find((turn) => turn.current_candidate_id === candidate.id);
      if (!runtimeTurn?.runner_reading) throw new ValidationError("The runner trial audits only its own turns.");
      emit(runtimeTurn.id, { type: "status", step: candidate.parent_candidate_id ? "checking the repair" : "checking" });
      const conversationId = runtimeTurn.runner_reading.conversation_id;
      const readers = runtimeTurn.runner_reading.readers ?? {};
      const view = conversationView(record, conversationId, runtimeTurn);
      const written = writerOutputOf(runtimeTurn, candidate.exact_text);
      const provisional = runtimeTurn.provisional?.exact_text ?? null;
      const repaired = candidate.parent_candidate_id != null;
      const parent = repaired ? record.candidate_responses.find((entry) => entry.id === candidate.parent_candidate_id) : null;
      const previousFindings = repaired ? (parent?.audit_history.at(-1)?.findings ?? []).filter((finding) => finding.record_only !== true && isSubstantiveAuditFinding(finding)) : [];
      const missedBoxes = missedBoxesOf(runtimeTurn);
      const boxesInPlay = config.writerMode === "focused" && readers.boxes?.boxes != null ? [...new Set([...(readers.boxes.boxes ?? []), ...missedBoxes])] : [];
      const readings = conversationReadings(record, conversationId);
      const crisisSoFar = isCrisisConversation(readings);
      const base = {
        conversation: view.turns,
        latest_message: { turn_id: runtimeTurn.user_turn_id, text: runtimeTurn.inbound.exact_text },
        earlier_conversations: view.earlier,
        candidate_reply: candidate.exact_text,
        ...(provisional ? { provisional_reply_shown: provisional } : {}),
        ...(journalEvidence ? { journal_evidence: journalEvidence.packet } : {})
      };
      const repairPart = repaired ? { previous_candidate: parent?.exact_text ?? null, findings_that_caused_the_repair: previousFindings, repair_induced_error_checks: [...REPAIR_INDUCED_ERROR_CHECKS] } : {};
      const weigh = [readers.crisis?.level, written.answeredLevel].includes("acted_or_about_to") ? { readings_to_weigh: { crisis_reader: readers.crisis?.level ?? "unclear", writer: written.answeredLevel ?? "unclear" } } : {};
      const risk = await loadRiskContext(caseId, authContext);
      const plan = [];
      if (config.checkerMode === "whole") {
        plan.push({ checker: CHECKERS.whole, rules: wholeRules(parts), packet: { ...base, ...repairPart, ...weigh, stored_risk_record: risk, undeclared_quoted_spans: undeclaredQuotedSpans(candidate.exact_text, written.quotes ?? []) }, extra: selfDirectedRiskAuditRules });
      } else {
        plan.push({ checker: CHECKERS.crisis, rules: rulesFrom([parts.crisis], ["the crisis, chronic pain and harm-reduction sections of SKILL.md"]), packet: { ...base, ...weigh, stored_risk_record: risk }, extra: selfDirectedRiskAuditRules });
        plan.push({ checker: CHECKERS.skill, rules: rulesFrom([parts.skill, parts.references["RESPONSE-FIDELITY"], parts.references["FOCUS-DISCIPLINE"], parts.references["LONGITUDINAL-SYNTHESIS"], parts.references["GUIDE-REFERRALS"]], ["SKILL.md", "RESPONSE-FIDELITY", "FOCUS-DISCIPLINE", "LONGITUDINAL-SYNTHESIS", "GUIDE-REFERRALS"]), packet: { ...base, undeclared_quoted_spans: undeclaredQuotedSpans(candidate.exact_text, written.quotes ?? []) } });
        const boxSections = [parts.map, parts.boxIndex, parts.references["PROTECTIVE-COMPATIBILITY"], parts.references["PROTOCOL-STATE-PROVENANCE"], ...(boxesInPlay.length ? [parts.boxPreamble, ...boxesInPlay.map((id) => parts.boxes[id]).filter(Boolean)] : []), ...(crisisSoFar ? [parts.crisis] : [])];
        const gate = record.case_state?.protective_compatibility?.current ?? null;
        plan.push({ checker: CHECKERS.boxes, rules: rulesFrom(boxSections, boxSections.map((section) => section.label)), packet: { ...base, boxes_in_play: boxesInPlay, child_contact_gate: gate ? { gate: gate.gate, route: gate.route ?? null } : { gate: "NOT_BLOCKED" } } });
        plan.push({ checker: CHECKERS.role, rules: rulesFrom([parts.references["ROLE-BELIEF-INTEGRITY"], parts.references["PHENOMENOLOGY-AND-REPRESENTATION"]], ["ROLE-BELIEF-INTEGRITY", "PHENOMENOLOGY-AND-REPRESENTATION"]), packet: base });
        if (repaired) plan.push({ checker: CHECKERS.repair, rules: rulesFrom([parts.skill], ["SKILL.md"]), packet: { ...base, ...repairPart } });
      }
      const results = await Promise.all(plan.map(async ({ checker, rules, packet, extra = "" }) => {
        const prompt = checkerPrompt({ checker, rules, packet, extraRules: extra });
        const result = await callWorker(checker.id, { kind: "checker", runtimeTurn, ...prompt, schema: CHECKER_SCHEMA });
        return { checker, ...result };
      }));
      const levelReader = results.find((result) => ["C1", "CW"].includes(result.checker.id));
      const checkerLevel = validLevel(levelReader?.value?.level);
      if (checkerLevel === "acted_or_about_to" && !runtimeTurn.provisional && !runtimeTurn.emergency_line_shown_at) await showEmergencyLine(caseId, runtimeTurn, "checker_read_acted", authContext);
      const earlierActed = readings.some((entry) => entry.turnId !== runtimeTurn.id && entry.checkerLevel === "acted_or_about_to");
      const earlierCrisisTurn = readings.some((entry) => entry.turnId !== runtimeTurn.id && (isCrisisLevel(entry.checkerLevel) || entry.provisional));
      const quoteSources = new Map(view.turns.filter((turn) => turn.turn_id).map((turn) => [turn.turn_id, turn.text]));
      const gate = record.case_state?.protective_compatibility?.current ?? null;
      const program = runProgramChecks({
        reply: candidate.exact_text,
        checkerLevel,
        firstActedTurn: checkerLevel === "acted_or_about_to" && !earlierActed,
        firstCrisisTurn: (isCrisisLevel(checkerLevel) || Boolean(provisional)) && !earlierCrisisTurn,
        crisisConversation: crisisSoFar || isCrisisLevel(checkerLevel),
        provisional,
        quotes: written.quotes ?? [],
        quoteSources,
        compatibilityViolations: gate && gate.gate !== "NOT_BLOCKED" ? childContactViolations(candidate.exact_text) : []
      });
      const findings = [...results.flatMap((result) => normalizeFindings(result.checker.id, result.value.findings)), ...program.map((finding, index) => ({ ...finding, id: `P:${index + 1}`, checker: "program" }))];
      let repairInducedChecks = [];
      if (repaired) {
        const comparer = results.find((result) => ["C5", "CW"].includes(result.checker.id));
        if (JSON.stringify(comparer?.value?.repair_induced_checks) !== JSON.stringify(REPAIR_INDUCED_ERROR_CHECKS)) {
          throw new ValidationError("The repair comparer did not check every repair item.", { code: "PROVIDER_MALFORMED" });
        }
        repairInducedChecks = [...REPAIR_INDUCED_ERROR_CHECKS];
      }
      const receipts = results.flatMap((result) => result.receipts);
      return {
        value: {
          findings: findings.map(({ checker, ...finding }) => finding),
          repair_induced_checks: repairInducedChecks,
          checker_level: checkerLevel,
          missed_boxes: [...new Set(results.flatMap((result) => (result.value.missed_boxes ?? []).filter((id) => parts.boxes[id])))].slice(0, config.maxBoxes),
          findings_by_checker: Object.fromEntries(results.map((result) => [result.checker.id, (result.value.findings ?? []).length]).concat([["program", program.length]]))
        },
        contextId: contextIdOf(receipts.filter((receipt) => receipt.session_id)),
        providerReceipt: { provider: "runner-trial-checkers", receipts }
      };
    },

    async repairCandidate({ caseId, candidate, journalEvidence = null, authContext }) {
      const record = await load(caseId, authContext);
      const runtimeTurn = record.runtime_turns.find((turn) => turn.current_candidate_id === candidate.id);
      emit(runtimeTurn.id, { type: "status", step: "repairing" });
      const readers = runtimeTurn.runner_reading?.readers ?? {};
      const view = conversationView(record, runtimeTurn.runner_reading.conversation_id, runtimeTurn);
      const failedAudit = candidate.audit_history.at(-1);
      const blocking = (failedAudit?.findings ?? []).filter((finding) => finding.record_only !== true && isSubstantiveAuditFinding(finding));
      const rules = writerRules(readers.boxes?.boxes ?? null, missedBoxesOf(runtimeTurn));
      const packet = { ...writerPacket({ record, runtimeTurn, view, readers, journalEvidence, provisional: runtimeTurn.provisional?.exact_text ?? null }), previous_candidate: candidate.exact_text, findings: blocking };
      const prompt = writerPrompt({ rules, packet, repair: true });
      const written = await callWorker("W-repair", { kind: "writer", runtimeTurn, ...prompt, schema: WRITER_SCHEMA, validate: validateWriter });
      // A repair that changes nothing can't fix what the checks found: the turn ends as a failed check (the store would refuse
      // the same bytes as a new version, which would otherwise read as a failed model call).
      if (written.value.reply === candidate.exact_text) throw new RuntimeError("The repair returned the same reply.", { code: "REPAIR_UNCHANGED" });
      return {
        exactText: written.value.reply,
        contextId: contextIdOf(written.receipts.filter((receipt) => receipt.session_id)),
        providerReceipt: { provider: "runner-trial-writer", receipts: written.receipts },
        result: { answeredLevel: written.value.answered_level, quotes: written.value.quotes, receipts: written.receipts }
      };
    },

    async produceDiscriminator() {
      throw new ValidationError("The runner trial closes a turn instead of producing a discriminator.", { code: "PRIVATE_DISCRIMINATOR_UNAVAILABLE" });
    },

    repairFits({ runtimeTurn }) {
      return deadlineOf(runtimeTurn) - now() >= config.roundMs;
    },

    closingReason(error) {
      const code = error?.details?.last_error_code ?? error?.code;
      return { PLAN_LIMIT: "plan_limit", SIGN_IN_NEEDED: "sign_in_needed", TIMEOUT: "timeout", REFUSED: "refused", REPAIR_UNCHANGED: "checks_failed" }[code] ?? "provider_failed";
    },

    closeTurn,

    async closeUnfinishedTurns({ caseId, keepRuntimeTurnId, authContext }) {
      const record = await load(caseId, authContext);
      for (const turn of record.runtime_turns) {
        if (turn.id === keepRuntimeTurnId || isFinishedRuntimeTurn(turn)) continue;
        const assistantTurnId = `${turn.exchange_id}-assistant`;
        if (turn.state === "APPROVED") {
          await source("deliverPrivateRuntimeCandidate", [caseId, turn.id, { candidateId: turn.current_candidate_id, assistantTurnId, eventId: `runtime-event:${sha256(turn.id).slice(0, 24)}:candidate:delivered-after-interruption` }], authContext);
          continue;
        }
        await closeTurn({ caseId, runtimeTurn: turn, reasonCode: "interrupted", assistantTurnId, eventId: `runtime-event:${sha256(turn.id).slice(0, 24)}:closed-after-interruption`, authContext });
      }
    }
  });

  async function closeTurn({ caseId, runtimeTurn, reasonCode, assistantTurnId, eventId, authContext }) {
      const record = await load(caseId, authContext);
      const turn = record.runtime_turns.find((entry) => entry.id === runtimeTurn.id);
      if (isFinishedRuntimeTurn(turn)) return;
      const conversationId = turn.runner_reading?.conversation_id ?? null;
      const readings = conversationId ? conversationReadings(record, conversationId) : [];
      const crisisNow = isCrisisLevel(turn.runner_reading?.readers?.crisis?.level) || readings.some((entry) => entry.turnId === turn.id && isCrisisLevel(entry.checkerLevel));
      const kind = ownerFallbackEnabled && reasonCode === "checks_failed" && isFixedMessageConversation(readings) ? OWNER_FALLBACK_KIND : "runner_unavailable";
      let caseState = null;
      let stateDiff = null;
      if (!record.raw_transcript.some((entry) => entry.id === turn.user_turn_id)) {
        ({ caseState, stateDiff } = stateAfterReadings(record.case_state, turn, turn.runner_reading?.readers ?? {}));
      }
      if (crisisNow && !turn.emergency_line_shown_at) await showEmergencyLine(caseId, turn, "turn_closed_without_reply", authContext);
      await source("closeRuntimeTurnUnanswered", [caseId, turn.id, { kind, reasonCode, assistantTurnId, caseState, stateDiff, diffId: `diff:runner:${sha256(turn.id).slice(0, 16)}`, eventId }], authContext);
      emit(turn.id, { type: "closed", kind, reason: reasonCode });
  }
}
