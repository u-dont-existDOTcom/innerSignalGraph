import { createHash } from "node:crypto";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import { diffCaseStates, mergeRuntimeSnapshotIntoCaseState } from "../case-state/longitudinal-state.mjs";
import { buildTrajectoryDigest } from "../case-state/trajectory-digest.mjs";
import {
  childContactPatternHits,
  compatibilityStateBinding,
  protectiveCompatibilityDecision,
  validateCompatibilityAssessment
} from "../case-formulation/protective-compatibility.mjs";
import { RECORD_ONLY_AUDIT_CODES, REPAIR_INDUCED_ERROR_CHECKS, isSubstantiveAuditFinding } from "../supervisor/private-candidate-lifecycle.mjs";
import { isFinishedRuntimeTurn } from "../supervisor/private-runtime-turn-lifecycle.mjs";
import { OWNER_FALLBACK_KIND } from "../supervisor/owner-fallback-message.mjs";
import { selfDirectedRiskAuditRules } from "../prompts/self-directed-risk-audit.mjs";
import { focusedRules, rulesFrom, wholeRules } from "./rule-parts.mjs";
import { LEVELS, emergencyNumbersIn, isCrisisLevel, provisionalProblems, runProgramChecks, undeclaredQuotedSpans } from "./program-checks.mjs";
import { KEPT_PLAN_RULE } from "./notices.mjs";
import {
  KEPT_PLAN_LIMITS,
  crisisReadingOf,
  currentKeptPlan,
  earlierTurnsInConversation,
  hasExpiredKeptPlan,
  keepPlanBasis,
  keepPlanYesConfirmed,
  keptPlanExpired,
  keptPlanNeverAllowed,
  offeredToKeepPlan,
  planReachedOn
} from "./kept-plan.mjs";
import {
  BOX_PICKER_SCHEMA,
  CHECKERS,
  CHECKER_SCHEMA,
  CRISIS_READER_KEPT_PLAN_SCHEMA,
  CRISIS_READER_SCHEMA,
  LEVEL_CHECKER_KEPT_PLAN_SCHEMA,
  PROTECTION_READER_SCHEMA,
  WRITER_KEPT_PLAN_SCHEMA,
  WRITER_SCHEMA,
  boxPickerPrompt,
  checkerPrompt,
  crisisReaderKeptPlanNote,
  crisisReaderNumberShownNote,
  crisisReaderPrompt,
  crisisReaderWantsToDieNote,
  levelCheckerKeptPlanNote,
  protectionReaderPrompt,
  withNoteBeforeAnswerLine,
  writerKeptPlanNote,
  writerPrompt
} from "./worker-prompts.mjs";

// The runner trial's model runtime (docs/superpowers/specs/2026-11-21-runner-trial-design.md): the turn controller's four
// methods, plus the closing methods the controller uses on this path. Readers run at the same time, the provisional reply shows
// as soon as the crisis reader's passes its exact checks, the writer gets only the rules it needs, the checkers read the exact
// draft at the same time, the program's exact checks run on their readings, and every failure ends the turn with a closing.

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const contextIdOf = (receipts) => `context:${sha256(receipts.map((receipt) => `${receipt.provider}:${receipt.model}:${receipt.session_id}`).join("|"))}`;

// Which turns of a conversation may get a provisional reply (design, section 4): "first", for someone who has acted or is about to,
// the first such turn, and a later one only when the crisis reader, told that the conversation has shown an emergency number,
// reads something new and urgent in it; for someone who wants to die, the first turn read at that level; "every", each such turn.
export const PROVISIONAL_TURNS = Object.freeze(["first", "every"]);

// How long after a message arrives the highlighted emergency line goes in, on a turn the crisis reader read as acted or about to
// that has shown no number and has no reply yet (design, section 4; Fable's recheck of 22 Nov 2026, finding 3).
export const EMERGENCY_LINE_FALLBACK_MS = 30_000;
const FALLBACK_LINE_REASON = "no_reply_yet";

export const DEFAULT_RUNNER_SETTINGS = Object.freeze({
  writerMode: "focused",
  checkerMode: "split",
  provisionalLevels: Object.freeze(["acted_or_about_to"]),
  provisionalTurns: "first",
  deadlineMs: 300_000,
  // The caps and the round from the measured times (design, section 8; "Call limits, from the measured times" in
  // /home/joel/askrigor-releases/20261121-innersignal-runner-note/results-report.md): the slowest successful call took 20.0 s
  // (writer), 14.4 s (checker) and 14.3 s (reader); 9 of 10 writer-and-checker rounds finished within about 25 s.
  roundMs: 30_000,
  limits: Object.freeze({ reader: 30_000, writer: 60_000, checker: 45_000 }),
  backgroundTurns: 20,
  conversationGapMs: 12 * 60 * 60 * 1000,
  maxBoxes: 6
});

// The checkers whose own crisis level the program checks use: the crisis checker in the split arm, the whole checker in its arm.
const LEVEL_READERS = Object.freeze(["C1", "CW"]);
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

// A checker's findings as the runtime stores them (exported for the measurement harness, so its catch rate reads them the same way).
export function normalizeFindings(checkerId, findings) {
  if (!Array.isArray(findings)) throw new ValidationError(`${checkerId} returned no findings list.`, { code: "PROVIDER_MALFORMED" });
  return findings.slice(0, 24).map((finding, index) => {
    const reported = ["low", "medium", "substantive", "high"].includes(finding?.severity) ? finding.severity : "high";
    const code = /^[A-Z][A-Z0-9_]{2,79}$/u.test(finding?.code ?? "") ? finding.code : "UNSPECIFIED_FINDING";
    // STORAGE_DESCRIBED (the writer's storage line) is counted, never blocking, whatever severity a checker gives it (Codex's
    // review of 371a8f6f2): it is held at medium by program, and the summary says what the checker reported.
    const capped = code === "STORAGE_DESCRIBED" && (reported === "substantive" || reported === "high");
    const severity = capped ? "medium" : reported;
    const summary = `${String(finding?.summary ?? "").trim().slice(0, 560) || "No summary given."}${capped ? ` (reported as ${reported})` : ""}`;
    const evidence = Array.isArray(finding?.evidence_turn_ids) ? finding.evidence_turn_ids.filter((id) => typeof id === "string" && id.trim()).slice(0, 8) : [];
    return { id: `${checkerId}:${index + 1}`, code, severity, summary, evidence_turn_ids: evidence, checker: checkerId };
  });
}

// `keptPlanEnabled` is INNER_SIGNAL_RUNNER_KEPT_PLAN (design, section 9): off by default, and with it off every packet, prompt and
// schema is exactly what it was before the kept plan was built.
export function createRunnerTrialRuntime({ privateCaseSource, parts, settings = {}, workerFor, ownerFallbackEnabled = false, keptPlanEnabled = false, onEvent = () => {}, now = () => Date.now() } = {}) {
  if (!privateCaseSource || !parts || typeof workerFor !== "function") throw new ValidationError("The runner trial needs its case source, rule parts and workers.");
  const config = { ...DEFAULT_RUNNER_SETTINGS, ...settings, limits: { ...DEFAULT_RUNNER_SETTINGS.limits, ...(settings.limits ?? {}) } };
  if (!["focused", "whole"].includes(config.writerMode) || !["split", "whole"].includes(config.checkerMode)) throw new ValidationError("Runner trial modes are invalid.", { code: "RUNNER_SETTINGS_INVALID" });
  if (!config.provisionalLevels.every((level) => ["acted_or_about_to", "wants_to_die"].includes(level))) throw new ValidationError("provisionalLevels is invalid.", { code: "RUNNER_SETTINGS_INVALID" });
  if (!PROVISIONAL_TURNS.includes(config.provisionalTurns)) throw new ValidationError("provisionalTurns is invalid.", { code: "RUNNER_SETTINGS_INVALID" });
  // Events go to the page's stream by case and runtime turn: a turn id alone is the client's to choose and could be another case's.
  const emit = (caseId, runtimeTurnId, event) => { try { onEvent(caseId, runtimeTurnId, event); } catch { /* the page's stream never stops a turn */ } };

  const loadRecord = (caseId, authContext) => typeof privateCaseSource.loadPrivateRuntimeCase === "function"
    ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext)
    : privateCaseSource.loadOrCreate(caseId);
  const source = (method, args, authContext) => privateCaseSource[method](...args, authContext);
  // A kept plan is deleted 30 days after it was kept, checked whenever the runtime loads the case and when the page loads (the
  // controller's reconcile; design, section 9). Only a case that holds a kept plan has anything to check, so a case that never kept
  // one is read exactly as before; a plan kept while the switch was on is still deleted on time after it is turned off.
  async function deleteExpiredKeptPlans(caseId, record, authContext) {
    if (!record || !hasExpiredKeptPlan(record, now())) return record;
    await source("deleteRunnerKeptPlans", [caseId, { reason: "expired" }], authContext);
    return loadRecord(caseId, authContext);
  }
  const load = async (caseId, authContext) => deleteExpiredKeptPlans(caseId, await loadRecord(caseId, authContext), authContext);
  // A read that never creates a case or changes it, for the emergency line's timer below, which may fire after the case was deleted.
  const readRecord = async (caseId, authContext) => (typeof privateCaseSource.loadPrivateRuntimeCase === "function"
    ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext)
    : privateCaseSource.load(caseId));

  const deadlineOf = (runtimeTurn) => Date.parse(runtimeTurn.created_at) + config.deadlineMs;
  const limitFor = (runtimeTurn, kind, stage) => {
    const left = deadlineOf(runtimeTurn) - now();
    if (left <= 1_000) throw new RunnerDeadlineError(stage);
    return Math.min(config.limits[kind], left);
  };

  // One worker call, with one retry when it timed out or answered in the wrong shape and the turn's time allows; never for a
  // plan limit, a lapsed sign-in or a refusal. The crisis reader asks for one attempt only (design, section 4: R1 has 30 s and
  // no retry, so a slow reading can't hold up the writer twice). Returns { value, receipts }. `requestFor`, when given, builds the
  // request ({ system, user, schema }) again for every attempt, so a retry is given only what still holds when it starts (the kept
  // plan's 30 days are checked again); otherwise every attempt sends the request given.
  async function callWorker(role, { kind, runtimeTurn, system, user, schema, requestFor = null, validate = (value) => value, attempts = 2 }) {
    const receipts = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const timeoutMs = limitFor(runtimeTurn, kind, role);
      const started = now();
      const request = requestFor ? requestFor() : { system, user, schema };
      try {
        const result = await workerFor(role).call({ system: request.system, user: request.user, schema: request.schema, timeoutMs, stage: role });
        receipts.push({ ...result.receipt, role, attempt });
        return { value: validate(result.value), receipts };
      } catch (error) {
        receipts.push({ role, attempt, failed: error?.code ?? "PROVIDER_FAILED", duration_ms: now() - started });
        const retryable = ["TIMEOUT", "PROVIDER_MALFORMED", "CODEX_RECEIPT_INCOMPLETE"].includes(error?.code) || error instanceof ValidationError;
        if (attempt === attempts || !retryable || deadlineOf(runtimeTurn) - now() < config.limits[kind] / 2) {
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

  // Every crisis level stored for a turn by a checker: each audit attempt's (the runner reading's checker_levels, appended as the
  // level reader answers, even when another checker gave no reading) and each completed audit's.
  const checkerLevelsOf = (turn) => [
    ...(turn.runner_reading?.checker_levels ?? []).map((entry) => entry.level),
    ...turn.events.filter((event) => event.event_type === "INVOCATION_COMPLETED" && event.stage === "audit").map((event) => event.details?.output?.value?.checker_level)
  ].filter((level) => LEVELS.includes(level));

  // The crisis readings of this conversation's turns, by reader, for the exact checks and the closing. Every stored reading
  // counts: a later "none" never erases an earlier crisis reading (design, section 3: those rules only hold things back).
  function conversationReadings(record, conversationId) {
    return record.runtime_turns.filter((turn) => turn.runner_reading?.conversation_id === conversationId).map((turn) => ({
      turnId: turn.id,
      crisis: turn.runner_reading?.readers?.crisis ?? null,
      checkerLevels: checkerLevelsOf(turn),
      provisional: Boolean(turn.provisional),
      emergencyLine: Boolean(turn.emergency_line_shown_at)
    }));
  }
  const readCrisis = (entry) => isCrisisLevel(entry.crisis?.level) || entry.checkerLevels.some(isCrisisLevel);
  const isCrisisConversation = (readings) => readings.some(readCrisis);
  // "Getting safe" or "wanting to die" (design, section 7): the readings that stand in for the owner's four routes.
  const isFixedMessageConversation = (readings) => readings.some((entry) => readCrisis(entry)
    || entry.crisis?.in_danger_from_someone || entry.crisis?.danger_to_others || entry.crisis?.home_unsafe);
  // Whether an earlier turn of this conversation showed the person an emergency number: a provisional reply or a delivered reply
  // naming one (as the exact check reads numbers), or the highlighted line. The later-turn rules go by what was actually shown,
  // never by which levels were read or which provisional replies were offered (Codex's review of 371a8f6f2: a numberless
  // provisional reply for someone who wants to die had counted as the number shown).
  // showsNumber is the one test of "a number was shown" for every rule that depends on it, on the turn itself as on earlier ones
  // (Codex's review of ae9f09d62: a numberless provisional reply shown this turn still kept the crisis checker's line out).
  const showsNumber = (turn) => Boolean(turn.emergency_line_shown_at)
    || emergencyNumbersIn(turn.provisional?.exact_text ?? "").length > 0
    || emergencyNumbersIn(turn.delivery?.exact_text ?? "").length > 0;
  function numberShownEarlier(record, conversationId, turnId) {
    return record.runtime_turns.some((turn) => turn.id !== turnId && turn.runner_reading?.conversation_id === conversationId && showsNumber(turn));
  }
  // The levels a provisional reply may be given at on this turn (design, section 4). With provisionalTurns "first": for someone who
  // has acted or is about to, every turn read at that level, but once the conversation has shown a number the crisis reader is
  // told so and gives one only for something new and urgent (runCrisisReader); for someone who wants to die (only when
  // provisionalLevels allows it), until an earlier turn was read at that level. With "every": every level provisionalLevels allows.
  const provisionalLevelsNow = (readings) => config.provisionalLevels.filter((level) => config.provisionalTurns === "every"
    || level === "acted_or_about_to" || !readings.some((entry) => entry.crisis?.level === level));

  async function showEmergencyLine(caseId, runtimeTurn, reason, authContext) {
    const result = await source("recordRunnerEmergencyLine", [caseId, runtimeTurn.id, { reason }], authContext);
    // Once per turn: a call that stored nothing (the line was already shown) sends the page nothing.
    if (result?.inserted === false) return;
    emit(caseId, runtimeTurn.id, { type: "emergency_line", reason });
  }

  // The highlighted line for a turn the crisis reader read as acted or about to that has shown no number once the reader's stage
  // is done (a later turn whose message answers what was said before, so no provisional reply and no line at once): if the turn
  // still has no reply EMERGENCY_LINE_FALLBACK_MS after the message arrived, the line goes in (reason no_reply_yet), so a slow or
  // stalled reply never leaves the person with nothing new about getting help (design, section 4; Fable's recheck of 22 Nov
  // 2026, finding 3). The timer never holds the process open and never throws. Its write goes through the store, which runs each
  // write of a case in that case's queue on the record as it then stands (the store's mutate and shared coordinator), so it can't
  // undo the turn's own writes; and the store refuses a line for a finished turn, so a reply or closing that came after the
  // timer's read wins. One timer per turn, so the line is sent to the page once.
  const fallbackTimers = new Set();
  async function armFallbackLine(caseId, runtimeTurn, authContext) {
    const key = JSON.stringify([caseId, runtimeTurn.id]);
    if (fallbackTimers.has(key)) return;
    fallbackTimers.add(key);
    let armed = false;
    try {
      const turn = (await readRecord(caseId, authContext))?.runtime_turns?.find((entry) => entry.id === runtimeTurn.id);
      if (!turn || isFinishedRuntimeTurn(turn) || showsNumber(turn)) return;
      const arrived = Date.parse(runtimeTurn.created_at);
      const delay = Number.isFinite(arrived) ? Math.max(0, arrived + EMERGENCY_LINE_FALLBACK_MS - now()) : EMERGENCY_LINE_FALLBACK_MS;
      const timer = setTimeout(() => {
        fallbackLine(caseId, runtimeTurn.id, authContext).catch(() => {}).finally(() => fallbackTimers.delete(key));
      }, delay);
      timer?.unref?.();
      armed = true;
    } catch {
      // The fallback line never stops a turn; the closing still puts the line in if the turn ends without a reply.
    } finally {
      if (!armed) fallbackTimers.delete(key);
    }
  }
  async function fallbackLine(caseId, runtimeTurnId, authContext) {
    const turn = (await readRecord(caseId, authContext))?.runtime_turns?.find((entry) => entry.id === runtimeTurnId);
    if (!turn || isFinishedRuntimeTurn(turn) || showsNumber(turn)) return;
    const stored = await source("recordRunnerEmergencyLine", [caseId, runtimeTurnId, { reason: FALLBACK_LINE_REASON }], authContext);
    // Sent to the page only when this write put the line in (not when another path had just put it in): the store answers.
    if (stored?.inserted !== true) return;
    emit(caseId, runtimeTurnId, { type: "emergency_line", reason: FALLBACK_LINE_REASON });
  }

  function readersPacket(view, runtimeTurn) {
    return { conversation: view.turns, latest_message: { turn_id: runtimeTurn.user_turn_id, text: runtimeTurn.inbound.exact_text } };
  }

  // The crisis reader, and the provisional reply when its reading allows one (design, section 4). `levelsNow`: the levels a
  // provisional reply may still be given at on this turn (provisionalLevelsNow); `numberShown`: an earlier turn of this
  // conversation showed an emergency number. With provisionalTurns "first", once one was shown, the reader is told so and gives a
  // provisional reply for someone who has acted or is about to only when the latest message tells of something new and urgent.
  async function runCrisisReader({ caseId, runtimeTurn, view, conversationId, priorCrisisConversation, levelsNow = config.provisionalLevels, numberShown = false, authContext }) {
    const rules = rulesFrom([parts.crisis], ["the section on someone who may want to die, the chronic pain section and the harm-reduction paragraph of SKILL.md"]);
    const prompt = crisisReaderPrompt({ rules, packet: readersPacket(view, runtimeTurn) });
    const shown = levelsNow.includes("wants_to_die") ? prompt.system.replace("Answer only with the JSON", `${crisisReaderWantsToDieNote()}\nAnswer only with the JSON`) : prompt.system;
    const laterTurn = config.provisionalTurns === "first" && numberShown && levelsNow.includes("acted_or_about_to");
    const told = laterTurn ? withNoteBeforeAnswerLine(shown, crisisReaderNumberShownNote()) : shown;
    // With the kept plan on, the crisis reader also reads whether the person asks to keep the plan (or says yes to the offer) and
    // whether they ask to delete it, from this conversation's words.
    const system = keptPlanEnabled ? withNoteBeforeAnswerLine(told, crisisReaderKeptPlanNote()) : told;
    const keptPlanReading = (value) => (keptPlanEnabled ? { asks_to_keep_plan: value?.asks_to_keep_plan === true, asks_to_delete_plan: value?.asks_to_delete_plan === true } : {});
    let reading = null;
    let receipts = [];
    try {
      const result = await callWorker("R1", { kind: "reader", runtimeTurn, system, user: prompt.user, schema: keptPlanEnabled ? CRISIS_READER_KEPT_PLAN_SCHEMA : CRISIS_READER_SCHEMA, attempts: 1, validate: (value) => ({ ...value, level: validLevel(value?.level), reason: String(value?.reason ?? "").slice(0, 400), ...keptPlanReading(value) }) });
      reading = result.value;
      receipts = result.receipts;
    } catch (error) {
      receipts = error.receipts ?? [];
    }
    const stored = { ...(reading ?? { level: "unclear", unread: true }), receipts };
    await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { crisis: stored } }], authContext);
    const allowsProvisional = Boolean(reading) && config.provisionalLevels.includes(reading.level);
    // A level no longer given one on this turn (with provisionalTurns "first", wanting to die after an earlier turn read at that
    // level): nothing is shown or recorded as a provisional, whatever the reader returned, and the skip puts no emergency line into
    // the conversation (the line's other triggers are unchanged). A provisional reply for someone who has acted or is about to is
    // shown on a later turn too when the reader gives one and it passes its exact checks, a number included, as on a first turn.
    if (allowsProvisional && !levelsNow.includes(reading.level)) return stored;
    if (allowsProvisional && typeof reading.provisional_reply === "string") {
      const problems = provisionalProblems(reading.provisional_reply, { level: reading.level });
      if (problems.length === 0) {
        const checks = [...(reading.level === "acted_or_about_to" ? ["a_number"] : []), "numbers_known", "shape", "links", "detox"];
        await source("recordRunnerProvisional", [caseId, runtimeTurn.id, { exactText: reading.provisional_reply.trim(), checks }], authContext);
        emit(caseId, runtimeTurn.id, { type: "provisional", text: reading.provisional_reply.trim() });
      } else {
        await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { provisional_refused: { problems } } }], authContext);
        if (reading.level === "acted_or_about_to") await showEmergencyLine(caseId, runtimeTurn, "provisional_not_shown", authContext);
      }
    } else if (reading?.level === "acted_or_about_to" && !(config.provisionalTurns === "first" && numberShown)) {
      await showEmergencyLine(caseId, runtimeTurn, "no_provisional", authContext);
    } else if (!reading && priorCrisisConversation) {
      await showEmergencyLine(caseId, runtimeTurn, "no_reading_in_crisis_conversation", authContext);
    }
    // Read acted with nothing shown this turn (with provisionalTurns "first", a later turn whose message answers what was said
    // before): the highlighted line if the turn has no reply 30 s after the message arrived.
    if (reading?.level === "acted_or_about_to") await armFallbackLine(caseId, runtimeTurn, authContext);
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

  function writerPacket({ record, runtimeTurn, view, readers, journalEvidence, provisional, keptPlan = null }) {
    const gate = record.case_state?.protective_compatibility?.current ?? null;
    return {
      conversation: view.turns,
      latest_message: { turn_id: runtimeTurn.user_turn_id, text: runtimeTurn.inbound.exact_text },
      earlier_conversations: view.earlier,
      ...(provisional ? { provisional_reply_shown: provisional } : {}),
      crisis_reading: readers.crisis?.unread ? null : { level: readers.crisis?.level ?? "unclear", reason: readers.crisis?.reason ?? "" },
      ...(gate && gate.gate !== "NOT_BLOCKED" ? { child_contact_gate: { gate: gate.gate, route: gate.route ?? null } } : {}),
      ...(journalEvidence ? { journal_evidence: journalEvidence.packet } : {}),
      ...writerKeptPlanPacket(keptPlan)
    };
  }

  function validateWriter(value, keptPlan = null) {
    if (typeof value?.reply !== "string" || !value.reply.trim()) throw new ValidationError("The writer returned no reply.", { code: "PROVIDER_MALFORMED" });
    return {
      reply: value.reply.trim(),
      answered_level: validLevel(value.answered_level),
      quotes: (Array.isArray(value.quotes) ? value.quotes : []).filter((quote) => typeof quote?.text === "string" && quote.text.trim()).slice(0, 12)
        .map((quote) => ({ text: quote.text.slice(0, 1_000), source_id: String(quote.source_id ?? "").slice(0, 160) })),
      ...(keptPlan ? { keptPlan: writerKeptPlanResult(value, keptPlan) } : {})
    };
  }

  // ---- The plan kept for next time (design, section 9). Nothing here runs while keptPlanEnabled is off. ----------------------

  const conversationTurnsOf = (record, conversationId) => record.runtime_turns.filter((turn) => turn.runner_reading?.conversation_id === conversationId);

  // When this turn opens a conversation and an earlier one exists, the page asked "Pick up where we left off?": its answer (only
  // exactly true is a Yes) is stored with the turn's readings and holds for the whole conversation. Otherwise nothing is stored.
  function resumeReadingFor(record, runtimeTurn, conversationId, userInput) {
    const others = record.runtime_turns.filter((turn) => turn.id !== runtimeTurn.id && turn.runner_reading?.conversation_id);
    if (others.length === 0 || others.some((turn) => turn.runner_reading.conversation_id === conversationId)) return null;
    return { confirmed: userInput?.resumeConfirmed === true };
  }

  // The kept plan for this conversation's writer and crisis checker: only when the conversation opened with a Yes, never when a
  // stored reading of the case says the person may be under 18 or home isn't safe, and only a plan kept in an earlier conversation
  // that isn't deleted or past its 30 days. Its lines and the day it was kept; nothing else of it.
  function keptPlanForPackets(record, conversationId) {
    if (conversationTurnsOf(record, conversationId)[0]?.runner_reading?.readers?.resume?.confirmed !== true) return null;
    if (keptPlanNeverAllowed(record)) return null;
    const plan = currentKeptPlan(record, now());
    if (!plan || plan.conversation_id === conversationId) return null;
    return plan;
  }

  // Whether the writer may offer to keep the plan in this turn's reply: once per conversation, in a crisis conversation whose plan
  // for the next hours a delivered reply already reached (the writer or the crisis checker said so), with this turn's crisis
  // reading, never when a stored reading of the case says the person may be under 18 or home isn't safe, and not once a plan from
  // this conversation is kept.
  function mayOfferToKeepPlan(record, runtimeTurn, conversationId) {
    if (!crisisReadingOf(runtimeTurn) || keptPlanNeverAllowed(record)) return false;
    const earlier = conversationTurnsOf(record, conversationId).filter((turn) => turn.id !== runtimeTurn.id);
    if (earlier.some((turn) => turn.runner_reading?.readers?.kept_plan_offer)) return false;
    if (!isCrisisConversation(conversationReadings(record, conversationId)) || !earlier.some(planReachedOn)) return false;
    return !(record.runner_kept_plans ?? []).some((plan) => plan.conversation_id === conversationId && plan.deleted_at == null);
  }

  // What this turn's packets hold of the kept plan, from the stored records alone, so a repair and the checks see what the writer saw.
  function keptPlanContextOf(record, runtimeTurn, conversationId) {
    const basis = keepPlanBasis(record, runtimeTurn);
    const plan = keptPlanForPackets(record, conversationId);
    return Object.freeze({
      mayOffer: runtimeTurn.runner_reading?.readers?.kept_plan_offer?.may_offer === true,
      keepAsked: basis.allowed,
      previousOffered: offeredToKeepPlan(earlierTurnsInConversation(record, runtimeTurn).at(-1) ?? null),
      deletedOnRequest: Boolean(runtimeTurn.kept_plan_deleted_at),
      // What the packets show of it (its lines and the day), and when it was kept, so each call checks its 30 days again.
      plan: plan ? Object.freeze({ lines: [...plan.lines], kept_on: plan.kept_at.slice(0, 10) }) : null,
      planKeptAt: plan?.kept_at ?? null
    });
  }

  // The kept plan as it stands when a call starts: past its 30 days, a call (a retry included) gets neither the plan nor the rule.
  const keptPlanAsOfNow = (keptPlan) => (keptPlan?.plan && keptPlanExpired({ kept_at: keptPlan.planKeptAt, deleted_at: null }, now())
    ? Object.freeze({ ...keptPlan, plan: null, planKeptAt: null })
    : keptPlan);

  // The level reader's kept-plan part of its request, as it stands when the call starts.
  function levelReaderKeptPlanPart(keptPlan) {
    const current = keptPlanAsOfNow(keptPlan);
    return {
      packet: { ...(current.plan ? { kept_plan: current.plan } : {}), ...(current.previousOffered ? { kept_plan_offer: { offered_in_previous_reply: true } } : {}) },
      extra: levelCheckerKeptPlanNote({ rule: current.plan ? KEPT_PLAN_RULE : null })
    };
  }

  function writerKeptPlanPacket(keptPlan) {
    if (!keptPlan) return {};
    return {
      ...(keptPlan.mayOffer ? { may_offer_to_keep_plan: true } : {}),
      ...(keptPlan.keepAsked ? { keep_plan_asked: true } : {}),
      ...(keptPlan.deletedOnRequest ? { kept_plan_deleted_on_request: true } : {}),
      ...(keptPlan.plan ? { kept_plan: keptPlan.plan } : {})
    };
  }

  // The writer's prompt and schema with the kept plan's fields, and the runner-only rule only when its packet holds a kept plan.
  function keptPlanWriterPrompt(prompt, keptPlan) {
    if (!keptPlan) return { ...prompt, schema: WRITER_SCHEMA };
    return { ...prompt, system: withNoteBeforeAnswerLine(prompt.system, writerKeptPlanNote({ rule: keptPlan.plan ? KEPT_PLAN_RULE : null })), schema: WRITER_KEPT_PLAN_SCHEMA };
  }

  // What the writer declared: an offer only counts when it had leave to make one, and lines only when the person asked to keep
  // the plan; the program keeps only the lines it finds word for word in an earlier reply (the store checks them again).
  function writerKeptPlanResult(value, keptPlan) {
    const lines = keptPlan.keepAsked && Array.isArray(value?.kept_plan_lines) ? value.kept_plan_lines : [];
    return {
      planReached: value?.plan_reached === true,
      offered: keptPlan.mayOffer && value?.offered_to_keep_plan === true,
      lines: lines.filter((line) => typeof line === "string" && line.trim()).slice(0, KEPT_PLAN_LIMITS.lines).map((line) => line.slice(0, KEPT_PLAN_LIMITS.lineCharacters))
    };
  }

  // Keeps the plan when the store's rules allow it; a refusal (nothing found word for word, no confirmed yes, a reading that rules it
  // out) keeps nothing and never stops the turn. The page learns from the stored turn whether a plan was kept.
  async function tryKeepPlan(caseId, runtimeTurnId, lines, authContext) {
    if (!Array.isArray(lines) || lines.length === 0) return null;
    try { return await source("recordRunnerKeptPlan", [caseId, runtimeTurnId, { lines }], authContext); }
    catch { return null; }
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
      const earlierReadings = conversationReadings(record, conversationId).filter((entry) => entry.turnId !== runtimeTurn.id);
      const priorCrisisConversation = isCrisisConversation(earlierReadings);
      const numberShown = numberShownEarlier(record, conversationId, runtimeTurn.id);
      const levelsNow = provisionalLevelsNow(earlierReadings);
      emit(caseId, runtimeTurn.id, { type: "status", step: "reading" });
      const [crisis, boxes, protection] = await Promise.all([
        runCrisisReader({ caseId, runtimeTurn, view, conversationId, priorCrisisConversation, levelsNow, numberShown, authContext }),
        runBoxPicker({ runtimeTurn, view }),
        runProtectionReader({ runtimeTurn, view, record })
      ]);
      const resume = keptPlanEnabled ? resumeReadingFor(record, runtimeTurn, conversationId, userInput) : null;
      const stored = await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { boxes, protection, ...(resume ? { resume } : {}) } }], authContext);
      const readers = stored.readers;
      // The person asked in this message to delete the kept plan: it is deleted before the writer starts, so its packet holds none.
      if (keptPlanEnabled && readers.crisis?.unread !== true && readers.crisis?.asks_to_delete_plan === true) {
        await source("deleteRunnerKeptPlans", [caseId, { reason: "asked_in_conversation", runtimeTurnId: runtimeTurn.id }], authContext);
      }
      let fresh = await load(caseId, authContext);
      let freshTurn = fresh.runtime_turns.find((turn) => turn.id === runtimeTurn.id);
      // The writer's leave to offer to keep the plan is stored before it writes, so it is given once per conversation.
      if (keptPlanEnabled && !freshTurn.runner_reading.readers.kept_plan_offer && mayOfferToKeepPlan(fresh, freshTurn, conversationId)) {
        await source("recordRunnerReading", [caseId, runtimeTurn.id, { conversationId, readers: { kept_plan_offer: { may_offer: true } } }], authContext);
        fresh = await load(caseId, authContext);
        freshTurn = fresh.runtime_turns.find((turn) => turn.id === runtimeTurn.id);
      }
      const keptPlan = keptPlanEnabled ? keptPlanContextOf(fresh, freshTurn, conversationId) : null;
      const provisional = freshTurn?.provisional?.exact_text ?? null;
      const { caseState, stateDiff } = stateAfterReadings(fresh.case_state, runtimeTurn, readers);
      emit(caseId, runtimeTurn.id, { type: "status", step: "writing" });
      const rules = writerRules(readers.boxes?.boxes ?? null);
      const writerRequest = () => {
        const current = keptPlanAsOfNow(keptPlan);
        return keptPlanWriterPrompt(writerPrompt({ rules, packet: writerPacket({ record: { case_state: caseState }, runtimeTurn, view, readers, journalEvidence, provisional, keptPlan: current }) }), current);
      };
      const written = await callWorker("W", { kind: "writer", runtimeTurn, requestFor: writerRequest, validate: (value) => validateWriter(value, keptPlan) });
      // The person asked to keep the plan: kept now, unless the reply before offered it, when the crisis checker confirms the yes first.
      if (keptPlan?.keepAsked && !keptPlan.previousOffered) await tryKeepPlan(caseId, runtimeTurn.id, written.value.keptPlan.lines, authContext);
      return {
        exactText: written.value.reply,
        contextId: contextIdOf(written.receipts.filter((receipt) => receipt.session_id)),
        caseState,
        stateDiff,
        result: {
          mode: "runner-trial",
          processingTier: "runner-trial",
          routingReason: `runner trial: ${config.writerMode} writer, ${config.checkerMode === "whole" ? "one whole checker" : "split checkers"}`,
          answeredLevel: written.value.answered_level,
          quotes: written.value.quotes,
          rules: { parts: rules.parts, boxes: rules.boxIds },
          receipts: [...(readers.crisis?.receipts ?? []), ...(readers.boxes?.receipts ?? []), ...(readers.protection?.receipts ?? []), ...written.receipts],
          compatibilityBinding: compatibilityStateBinding(caseState.protective_compatibility ?? null),
          ...(keptPlan ? { keptPlan: written.value.keptPlan } : {})
        }
      };
    },

    async auditCandidate({ caseId, candidate, journalEvidence = null, authContext }) {
      const record = await load(caseId, authContext);
      const runtimeTurn = record.runtime_turns.find((turn) => turn.current_candidate_id === candidate.id);
      if (!runtimeTurn?.runner_reading) throw new ValidationError("The runner trial audits only its own turns.");
      emit(caseId, runtimeTurn.id, { type: "status", step: candidate.parent_candidate_id ? "checking the repair" : "checking" });
      const conversationId = runtimeTurn.runner_reading.conversation_id;
      const readers = runtimeTurn.runner_reading.readers ?? {};
      const view = conversationView(record, conversationId, runtimeTurn);
      const written = writerOutputOf(runtimeTurn, candidate.exact_text);
      const provisional = runtimeTurn.provisional?.exact_text ?? null;
      const repaired = candidate.parent_candidate_id != null;
      const parent = repaired ? record.candidate_responses.find((entry) => entry.id === candidate.parent_candidate_id) : null;
      const previousFindings = repaired ? (parent?.audit_history.at(-1)?.findings ?? []).filter((finding) => finding.record_only !== true && isSubstantiveAuditFinding(finding)) : [];
      const missedBoxes = missedBoxesOf(runtimeTurn);
      // The box advice the checkers read is the advice the writer had (design, section 3): in the focused arm with picks, the
      // picked boxes and any a checker said were missed (the repair writer gets those); every box when the writer had the whole
      // protocol, or when the picker gave no picks and the focused writer got the whole box file.
      const boxesInPlay = config.writerMode === "focused" && readers.boxes?.boxes != null
        ? [...new Set([...readers.boxes.boxes, ...missedBoxes])].filter((id) => parts.boxes[id])
        : Object.keys(parts.boxes);
      const readings = conversationReadings(record, conversationId);
      const crisisSoFar = isCrisisConversation(readings);
      // The child-contact gate as stored, for the box checker and the whole checker alike, and what the word patterns matched
      // while it is HOLD or BLOCKED: places for those checkers to look, never a block by themselves (design, section 5).
      const gate = record.case_state?.protective_compatibility?.current ?? null;
      const gateView = gate ? { gate: gate.gate, route: gate.route ?? null } : { gate: "NOT_BLOCKED" };
      const patternHits = gate && gate.gate !== "NOT_BLOCKED" ? childContactPatternHits(candidate.exact_text) : [];
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
      // With the kept plan on, the level reader also gets this conversation's kept plan (when the person chose Yes) with the
      // runner-only rule, and, after a reply that offered to keep the plan, the offer, to confirm whether the person's yes is about it.
      const keptPlan = keptPlanEnabled ? keptPlanContextOf(record, runtimeTurn, conversationId) : null;
      const levelReaderKeptPlan = keptPlan
        ? { keptPlanPart: () => levelReaderKeptPlanPart(keptPlan), schema: LEVEL_CHECKER_KEPT_PLAN_SCHEMA }
        : { keptPlanPart: null, schema: CHECKER_SCHEMA };
      // The level reader's reading (C1's, or the whole checker's) is stored and acted on the moment it arrives, while the other
      // checkers may still be reading: the closing and later turns see it even when another checker gives no reading, and someone
      // who has acted gets the emergency line at once (design, section 4), not after the slowest checker. With the kept plan on, its
      // two kept-plan readings are stored with it, and a confirmed yes keeps the plan the person agreed to at once.
      const actOnLevel = async (result) => {
        const level = validLevel(result.value?.level);
        const keptPlanReadings = keptPlan ? { planReached: result.value?.plan_reached === true, confirmsKeepPlanYes: keptPlan.previousOffered && result.value?.confirms_keep_plan_yes === true } : {};
        await source("recordRunnerCheckerLevel", [caseId, runtimeTurn.id, { candidateId: candidate.id, candidateVersion: candidate.version, checker: result.checker.id, level, ...keptPlanReadings }], authContext);
        // With provisionalTurns "first", only while nothing in this conversation has shown the number yet (no provisional reply and
        // no highlighted line on an earlier turn): on a later turn the full reply comes back to it, as the rules say, and the line
        // stays on the page; the line still shows if that turn ends without a reply (22 Nov 2026).
        const shownEarlier = config.provisionalTurns === "first" && numberShownEarlier(record, conversationId, runtimeTurn.id);
        if (level === "acted_or_about_to" && !showsNumber(runtimeTurn) && !shownEarlier) await showEmergencyLine(caseId, runtimeTurn, "checker_read_acted", authContext);
        if (keptPlanReadings.confirmsKeepPlanYes && keptPlan.keepAsked) await tryKeepPlan(caseId, runtimeTurn.id, written.keptPlan?.lines ?? [], authContext);
        return result;
      };
      const plan = [];
      if (config.checkerMode === "whole") {
        plan.push({ checker: CHECKERS.whole, rules: wholeRules(parts), packet: { ...base, ...repairPart, ...weigh, stored_risk_record: risk, undeclared_quoted_spans: undeclaredQuotedSpans(candidate.exact_text, written.quotes ?? []), child_contact_gate: gateView, child_contact_pattern_hits: patternHits }, extra: selfDirectedRiskAuditRules, ...levelReaderKeptPlan });
      } else {
        plan.push({ checker: CHECKERS.crisis, rules: rulesFrom([parts.crisis], ["the crisis, chronic pain and harm-reduction sections of SKILL.md"]), packet: { ...base, ...weigh, stored_risk_record: risk }, extra: selfDirectedRiskAuditRules, ...levelReaderKeptPlan });
        plan.push({ checker: CHECKERS.skill, rules: rulesFrom([parts.skill, parts.references["RESPONSE-FIDELITY"], parts.references["FOCUS-DISCIPLINE"], parts.references["LONGITUDINAL-SYNTHESIS"], parts.references["GUIDE-REFERRALS"]], ["SKILL.md", "RESPONSE-FIDELITY", "FOCUS-DISCIPLINE", "LONGITUDINAL-SYNTHESIS", "GUIDE-REFERRALS"]), packet: { ...base, undeclared_quoted_spans: undeclaredQuotedSpans(candidate.exact_text, written.quotes ?? []) } });
        const boxSections = [parts.map, parts.boxIndex, parts.references["PROTECTIVE-COMPATIBILITY"], parts.references["PROTOCOL-STATE-PROVENANCE"], ...(boxesInPlay.length ? [parts.boxPreamble, ...boxesInPlay.map((id) => parts.boxes[id])] : []), ...(crisisSoFar ? [parts.crisis] : [])];
        plan.push({ checker: CHECKERS.boxes, rules: rulesFrom(boxSections, boxSections.map((section) => section.label)), packet: { ...base, boxes_in_play: boxesInPlay, child_contact_gate: gateView, child_contact_pattern_hits: patternHits } });
        plan.push({ checker: CHECKERS.role, rules: rulesFrom([parts.references["ROLE-BELIEF-INTEGRITY"], parts.references["PHENOMENOLOGY-AND-REPRESENTATION"]], ["ROLE-BELIEF-INTEGRITY", "PHENOMENOLOGY-AND-REPRESENTATION"]), packet: base });
        if (repaired) plan.push({ checker: CHECKERS.repair, rules: rulesFrom([parts.skill], ["SKILL.md"]), packet: { ...base, ...repairPart } });
      }
      // Every checker runs to its end: one that gives no reading can't take away another's (design, section 4).
      // Each checker's request is built for every attempt: the level reader's kept-plan part (with the kept plan on) is what holds
      // when that attempt starts; every other part is the same each time.
      const settled = await Promise.allSettled(plan.map(async ({ checker, rules, packet, extra = "", schema = CHECKER_SCHEMA, keptPlanPart = null }) => {
        const requestFor = () => {
          const kept = keptPlanPart ? keptPlanPart() : { packet: {}, extra: "" };
          return { ...checkerPrompt({ checker, rules, packet: { ...packet, ...kept.packet }, extraRules: `${extra}${kept.extra}` }), schema };
        };
        const result = { checker, ...(await callWorker(checker.id, { kind: "checker", runtimeTurn, requestFor })) };
        return LEVEL_READERS.includes(checker.id) ? actOnLevel(result) : result;
      }));
      const results = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
      const levelReader = results.find((result) => LEVEL_READERS.includes(result.checker.id));
      const checkerLevel = levelReader ? validLevel(levelReader.value?.level) : null;
      // A checker that failed, timed out or refused is "no reading", never a pass: the draft can't be delivered (design, section 3).
      const failed = settled.find((entry) => entry.status === "rejected");
      if (failed) {
        const receipts = settled.flatMap((entry) => (entry.status === "fulfilled" ? entry.value.receipts : (entry.reason?.receipts ?? [])));
        throw Object.assign(failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason)), { receipts });
      }
      // The number check holds on every turn read acted until the conversation has actually shown a number (Codex's review of
      // 371a8f6f2), not only on the first turn read acted.
      const numberAlreadyShown = numberShownEarlier(record, conversationId, runtimeTurn.id);
      const earlierCrisisTurn = readings.some((entry) => entry.turnId !== runtimeTurn.id && (entry.checkerLevels.some(isCrisisLevel) || entry.provisional));
      const quoteSources = new Map(view.turns.filter((turn) => turn.turn_id).map((turn) => [turn.turn_id, turn.text]));
      const program = runProgramChecks({
        reply: candidate.exact_text,
        checkerLevel,
        firstActedTurn: checkerLevel === "acted_or_about_to" && !numberAlreadyShown,
        firstCrisisTurn: (isCrisisLevel(checkerLevel) || Boolean(provisional)) && !earlierCrisisTurn,
        crisisConversation: crisisSoFar || isCrisisLevel(checkerLevel),
        provisional,
        quotes: written.quotes ?? [],
        quoteSources,
        childContactPatternHits: patternHits
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
      // A turn read acted or about to that would be delivered with no emergency number anywhere in it (its provisional reply, the
      // reply or the line): on a later turn the number check no longer requires one in the reply (the conversation showed it
      // before) and the crisis reader may have read the message as an answer, so the program puts the highlighted line in before
      // delivery. It never asks the writer to repeat the number (Codex's review of e17c949a2).
      const passes = !findings.some((finding) => !RECORD_ONLY_AUDIT_CODES.includes(finding.code) && isSubstantiveAuditFinding(finding));
      const readActedThisTurn = readers.crisis?.level === "acted_or_about_to" || checkerLevel === "acted_or_about_to" || checkerLevelsOf(runtimeTurn).includes("acted_or_about_to");
      if (passes && readActedThisTurn && emergencyNumbersIn(candidate.exact_text).length === 0) {
        const fresh = (await load(caseId, authContext)).runtime_turns.find((turn) => turn.id === runtimeTurn.id);
        if (fresh && !isFinishedRuntimeTurn(fresh) && !showsNumber(fresh)) await showEmergencyLine(caseId, fresh, "reply_without_number", authContext);
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
      emit(caseId, runtimeTurn.id, { type: "status", step: "repairing" });
      const readers = runtimeTurn.runner_reading?.readers ?? {};
      const view = conversationView(record, runtimeTurn.runner_reading.conversation_id, runtimeTurn);
      const failedAudit = candidate.audit_history.at(-1);
      const blocking = (failedAudit?.findings ?? []).filter((finding) => finding.record_only !== true && isSubstantiveAuditFinding(finding));
      const rules = writerRules(readers.boxes?.boxes ?? null, missedBoxesOf(runtimeTurn));
      const keptPlan = keptPlanEnabled ? keptPlanContextOf(record, runtimeTurn, runtimeTurn.runner_reading.conversation_id) : null;
      const repairRequest = () => {
        const current = keptPlanAsOfNow(keptPlan);
        const packet = { ...writerPacket({ record, runtimeTurn, view, readers, journalEvidence, provisional: runtimeTurn.provisional?.exact_text ?? null, keptPlan: current }), previous_candidate: candidate.exact_text, findings: blocking };
        return keptPlanWriterPrompt(writerPrompt({ rules, packet, repair: true }), current);
      };
      const written = await callWorker("W-repair", { kind: "writer", runtimeTurn, requestFor: repairRequest, validate: (value) => validateWriter(value, keptPlan) });
      // A repair that changes nothing can't fix what the checks found: the turn ends as a failed check (the store would refuse
      // the same bytes as a new version, which would otherwise read as a failed model call).
      if (written.value.reply === candidate.exact_text) throw new RuntimeError("The repair returned the same reply.", { code: "REPAIR_UNCHANGED" });
      // A plan the person asked to keep and the first draft's lines didn't keep may be kept from the repaired draft's lines (after an
      // offer, only once the crisis checker has confirmed the yes on an earlier check of this turn).
      if (keptPlan?.keepAsked && (!keptPlan.previousOffered || keepPlanYesConfirmed(runtimeTurn))) await tryKeepPlan(caseId, runtimeTurn.id, written.value.keptPlan.lines, authContext);
      return {
        exactText: written.value.reply,
        contextId: contextIdOf(written.receipts.filter((receipt) => receipt.session_id)),
        providerReceipt: { provider: "runner-trial-writer", receipts: written.receipts },
        result: { answeredLevel: written.value.answered_level, quotes: written.value.quotes, receipts: written.receipts, ...(keptPlan ? { keptPlan: written.value.keptPlan } : {}) }
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

    // The turns of the case's current conversation, in order, for a page that shows none of them (a reload; design, section 8):
    // every turn from the first one stored with the latest conversation id on. A turn closed before it was read has no id; one
    // after that first turn counts as part of it.
    currentConversationTurnIds(record) {
      const turns = record?.runtime_turns ?? [];
      const latest = [...turns].reverse().find((turn) => turn.runner_reading?.conversation_id)?.runner_reading.conversation_id;
      if (!latest) return turns.map((turn) => turn.id);
      const first = turns.findIndex((turn) => turn.runner_reading?.conversation_id === latest);
      return turns.slice(first).filter((turn) => (turn.runner_reading?.conversation_id ?? latest) === latest).map((turn) => turn.id);
    },

    // The page's load deletes a kept plan past its 30 days whether or not the switch is on now (design, section 9): the controller's
    // reconcile calls this with the case's record and goes on with the record it returns. Nothing to do for a case with no plan.
    async expireKeptPlans({ caseId, record, authContext }) {
      return deleteExpiredKeptPlans(caseId, record, authContext);
    },

    // The kept plan's page methods, only while it is on (design, section 9): what the page needs to ask "Pick up where we left
    // off?" when it loads, and the page's "Delete the kept plan".
    ...(keptPlanEnabled ? {
      // Whether the case has a conversation, and whether the next message opens a new one (after the conversation gap). The page
      // asks from these alone, so its question tells no one whether a plan is kept. A kept plan past its 30 days is deleted here too.
      async resumeStatus({ caseId, record = null, authContext }) {
        const current = record ? await deleteExpiredKeptPlans(caseId, record, authContext) : null;
        const latest = [...(current?.runtime_turns ?? [])].reverse().find((turn) => turn.runner_reading?.conversation_id);
        return Object.freeze({
          hasConversation: Boolean(latest),
          nextStartsNewConversation: Boolean(latest) && now() - Date.parse(latest.created_at) > config.conversationGapMs
        });
      },
      async deleteKeptPlans({ caseId, authContext }) {
        await source("deleteRunnerKeptPlans", [caseId, { reason: "deleted_on_page" }], authContext);
        return Object.freeze({ keptPlanRemains: false });
      }
    } : {}),

    async closeUnfinishedTurns({ caseId, keepRuntimeTurnId, authContext }) {
      let record;
      try { record = await load(caseId, authContext); }
      catch (error) {
        // A case with no record yet (its first message, or the first after "Delete this case") has no turn to close: the access
        // service refuses to load a case that isn't there, where the store opened by this server would create it.
        if (error?.code === "PRIVATE_CASE_NOT_FOUND") return;
        throw error;
      }
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
      const crisisNow = isCrisisLevel(turn.runner_reading?.readers?.crisis?.level) || checkerLevelsOf(turn).some(isCrisisLevel);
      // The crisis reader gave no reading this turn: nothing says it isn't a crisis, so a closing shows the line as after a crisis
      // reading (Fable's recheck of 22 Nov 2026, finding 7: a first message with the reader out had closed with no line).
      // A turn closed before the crisis reader stored anything (an interruption, say) counts as unread too (Codex's review of
      // e17c949a2).
      const crisisReading = turn.runner_reading?.readers?.crisis;
      const crisisUnread = !crisisReading || crisisReading.unread === true;
      const kind = ownerFallbackEnabled && reasonCode === "checks_failed" && isFixedMessageConversation(readings) ? OWNER_FALLBACK_KIND : "runner_unavailable";
      let caseState = null;
      let stateDiff = null;
      if (!record.raw_transcript.some((entry) => entry.id === turn.user_turn_id)) {
        ({ caseState, stateDiff } = stateAfterReadings(record.case_state, turn, turn.runner_reading?.readers ?? {}));
      }
      if ((crisisNow || crisisUnread) && !turn.emergency_line_shown_at) await showEmergencyLine(caseId, turn, "turn_closed_without_reply", authContext);
      await source("closeRuntimeTurnUnanswered", [caseId, turn.id, { kind, reasonCode, assistantTurnId, caseState, stateDiff, diffId: `diff:runner:${sha256(turn.id).slice(0, 16)}`, eventId }], authContext);
      emit(caseId, turn.id, { type: "closed", kind, reason: reasonCode });
  }
}
