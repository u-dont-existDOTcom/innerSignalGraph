import { ValidationError } from "../core/errors.mjs";

// A small record of what the extraction has said, turn after turn, about the person's own life. It exists so that the reply
// check can still see earlier self-directed risk after the case has moved to another route and the verbatim window no longer
// holds the turns where it was said. It is derived only from the two fields the extractor already returns
// (variables.suicidal_state and variables.suicidal_ideation_context); no model field or call was added for it.
//
// What it is not: it changes no routing, no reasoning tier and no reply text. Owner decision D1 (2026-09-26) stands: the
// state alone neither selects a safety tier nor appends a crisis script. Nothing here feeds the planner. The extraction and
// writing prompts get neither the record (promptCaseState strips it) nor the retrieval request for the older turn it points to
// (buildDurableCaseContext leaves that request out unless it is built for the reply check). The reply check reads the record in
// the digest of its audit packet and receives up to two older turns in the audit packet and the repair packet: the turn of the
// highest reading and the turn of the first reading above absent (see selfDirectedRiskRetrievalTurns).
export const SELF_DIRECTED_RISK_VERSION = 1;
export const SELF_DIRECTED_RISK_LEVELS = Object.freeze(["absent", "ideation", "intent", "imminent"]);
export const SELF_DIRECTED_RISK_CONTEXTS = Object.freeze(["pain_episode", "other_or_unclear", "not_in_play", "unknown"]);
export const SELF_DIRECTED_RISK_CHANGES = Object.freeze(["raised", "held", "lowered"]);
export const SELF_DIRECTED_RISK_HISTORY_LIMIT = 20;
export const SELF_DIRECTED_RISK_OBSERVATION_LIMIT = 16;
// Flicker rule. The held level is lowered only by this many fresh readings in a row, each below the held level. A reading
// that is `unknown` (or missing) says nothing and starts the run again, and any reading at or above the held level cancels it.
// The extractor has no separate "explicit denial" value: a turn that does not mention the subject can also read `absent`.
// So one calm turn never lowers the record, and two do; the sentence in the audit text asks the reply check to weigh that.
export const SELF_DIRECTED_RISK_LOWERING_READINGS = 2;
// Once the level has been lowered to absent, the reply check keeps receiving the exact turn of the highest earlier reading for this
// many planned turns after the lowering turn (and on the lowering turn itself), then stops. Ten is a short stretch of ordinary work on
// a new topic: long enough for the check to see what was said while quiet turns may still be reading absent, short enough that old
// text does not ride along in every packet of a case that has settled. The one turn that does ride along for the rest of the case
// is the first reading above absent (the first time the person said it), because a person may refer back to it at any later point
// and the check needs their exact words to compare a reply with.
export const SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS = 10;
// How the retrieval requests for the turns above are named in targeted_retrieval_requests and targeted_older_evidence. Both turns
// (the highest reading's and the first reading's) share the one reason and the one item ID: each is a turn the current record points to.
export const SELF_DIRECTED_RISK_RETRIEVAL_REASON = "current-self-directed-risk-record";
export const SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID = "self_directed_risk.current";

const RANK = Object.freeze({ absent: 0, ideation: 1, intent: 2, imminent: 3 });
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (message) => { throw new ValidationError(message); };

function checkText(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${name} must be bounded text.`);
  return value;
}

function checkIds(value, name) {
  if (!Array.isArray(value) || value.length > SELF_DIRECTED_RISK_OBSERVATION_LIMIT) fail(`${name} must be a bounded ID list.`);
  value.forEach((id, index) => checkText(id, `${name}[${index}]`, 160));
  return value;
}

// One reading per turn. `state` is null when the extraction did not give a usable value (unknown or missing).
function readingOf(variables) {
  const state = SELF_DIRECTED_RISK_LEVELS.includes(variables?.suicidal_state) ? variables.suicidal_state : null;
  const context = SELF_DIRECTED_RISK_CONTEXTS.includes(variables?.suicidal_ideation_context) ? variables.suicidal_ideation_context : "unknown";
  return { state, context };
}

const event = (change, level, reading, context, turnId, at) => ({ change, level, reading, context, assessed_turn_id: turnId, assessed_at: at });

// `plannedTurns` is the number of planned turns the case has once this turn is merged (the length of its intervention_history). It is
// kept only when the level goes to absent, to count the turns since the lowering for the retrieval window above.
export function updateSelfDirectedRiskState(previous, variables, { turnId, recordedAt, observationIds = [], plannedTurns = null } = {}) {
  const { state, context } = readingOf(variables);
  const prior = previous?.current ?? null;
  // A case with no self-directed language never gets the record, so every such case stays byte-identical to before.
  if (!prior && (state == null || state === "absent")) return previous ?? null;
  checkText(turnId, "self-directed risk turn ID", 160);
  checkText(recordedAt, "self-directed risk recordedAt", 80);
  const observed = [...new Set(observationIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, SELF_DIRECTED_RISK_OBSERVATION_LIMIT);
  const history = previous?.history ?? [];
  // The first reading above absent is set once, when the record is created, and carried unchanged after that. It lives outside the
  // history, which keeps only its latest events, so it can never fall off with them. A record written before this field existed gets
  // it here from its history while the history still holds that reading; when it no longer does, the first reading stays unknown and
  // nothing is invented (firstSelfDirectedRiskReading). It is read before any event is appended, because appending can cut the front.
  const firstReading = prior
    ? firstSelfDirectedRiskReading(previous)
    : { level: state, context, assessed_turn_id: turnId, assessed_at: recordedAt };
  // The history keeps only its latest SELF_DIRECTED_RISK_HISTORY_LIMIT events. The readings above absent that fall off its front are
  // counted, so the digest can say its counts of earlier risk turns are a lower bound instead of presenting them as the whole case.
  let dropped = previous?.risk_readings_dropped_from_history ?? 0;
  const appendHistory = (entry) => {
    const all = entry ? [...history, entry] : [...history];
    const cut = Math.max(0, all.length - SELF_DIRECTED_RISK_HISTORY_LIMIT);
    dropped += all.slice(0, cut).filter((item) => item.reading !== "absent").length;
    return all.slice(cut);
  };
  const result = (nextCurrent, nextHistory = [...history]) => ({
    version: SELF_DIRECTED_RISK_VERSION,
    current: nextCurrent,
    history: nextHistory,
    ...(firstReading ? { first_reading: firstReading } : {}),
    ...(dropped > 0 ? { risk_readings_dropped_from_history: dropped } : {})
  });
  // `denied` only says the latest reading was the extractor's `absent`. The extraction has no separate explicit-denial value, so it
  // is not evidence that the person denied anything; the reply check is told so in the digest and in its audit text.
  const current = (fields) => ({
    level: fields.level,
    context: fields.context,
    assessed_turn_id: fields.assessed_turn_id,
    assessed_at: fields.assessed_at,
    observation_ids: fields.observation_ids,
    latest_turn_id: turnId,
    denied: fields.denied ?? false,
    unknown: fields.unknown ?? false,
    lowering_readings: fields.lowering_readings ?? [],
    ...(fields.lowered_at_planned_turn != null ? { lowered_at_planned_turn: fields.lowered_at_planned_turn } : {})
  });
  const raised = (level) => current({ level, context, assessed_turn_id: turnId, assessed_at: recordedAt, observation_ids: observed });

  if (!prior) return result(raised(state), appendHistory(event("raised", state, state, context, turnId, recordedAt)));

  // Nothing was learned this turn: keep the level, remember that the latest reading was unknown, and start any run of lower readings again.
  if (state == null) return result({ ...structuredClone(prior), latest_turn_id: turnId, denied: false, unknown: true, lowering_readings: [] });

  const held = prior.level;
  if (state !== "absent" && RANK[state] > RANK[held]) return result(raised(state), appendHistory(event("raised", state, state, context, turnId, recordedAt)));
  if (state !== "absent" && state === held) {
    // The same level again. The turn that established it stays the one the lowering rule anchors on; only the latest-reading marks move.
    return result(
      { ...structuredClone(prior), context: context === "unknown" ? prior.context : context, latest_turn_id: turnId, denied: false, unknown: false, lowering_readings: [] },
      appendHistory(event("held", held, state, context, turnId, recordedAt))
    );
  }
  // Already at absent and absent again.
  if (held === "absent") return result({ ...structuredClone(prior), latest_turn_id: turnId, denied: true, unknown: false, lowering_readings: [] });

  // A fresh reading below the held level. It counts toward lowering only together with the readings just before it.
  const reading = { turn_id: turnId, at: recordedAt, state, context, observation_ids: state === "absent" ? [] : observed };
  const run = [...prior.lowering_readings, reading];
  if (run.length < SELF_DIRECTED_RISK_LOWERING_READINGS) {
    return result(
      { ...structuredClone(prior), latest_turn_id: turnId, denied: state === "absent", unknown: false, lowering_readings: run },
      state === "absent" ? [...history] : appendHistory(event("held", held, state, context, turnId, recordedAt))
    );
  }
  // Enough fresh readings in a row: lower to the highest of them (the latest if equal), anchored on the turn that reading came from.
  const chosen = run.reduce((best, item) => (RANK[item.state] >= RANK[best.state] ? item : best), run[0]);
  return result(
    current({
      level: chosen.state,
      context: chosen.context,
      assessed_turn_id: chosen.turn_id,
      assessed_at: chosen.at,
      observation_ids: chosen.observation_ids,
      denied: state === "absent",
      lowered_at_planned_turn: chosen.state === "absent" && Number.isSafeInteger(plannedTurns) && plannedTurns >= 0 ? plannedTurns : null
    }),
    appendHistory(event("lowered", chosen.state, state, context, turnId, recordedAt))
  );
}

export function validateSelfDirectedRiskState(value) {
  if (value == null) return null;
  if (!isRecord(value) || value.version !== SELF_DIRECTED_RISK_VERSION || !isRecord(value.current) || !Array.isArray(value.history) || value.history.length > SELF_DIRECTED_RISK_HISTORY_LIMIT) {
    fail("caseState.self_directed_risk is invalid.");
  }
  const current = value.current;
  if (!SELF_DIRECTED_RISK_LEVELS.includes(current.level) || !SELF_DIRECTED_RISK_CONTEXTS.includes(current.context)) fail("caseState.self_directed_risk.current has an invalid level or context.");
  checkText(current.assessed_turn_id, "caseState.self_directed_risk.current.assessed_turn_id", 160);
  checkText(current.assessed_at, "caseState.self_directed_risk.current.assessed_at", 80);
  checkText(current.latest_turn_id, "caseState.self_directed_risk.current.latest_turn_id", 160);
  checkIds(current.observation_ids, "caseState.self_directed_risk.current.observation_ids");
  if (typeof current.denied !== "boolean" || typeof current.unknown !== "boolean" || (current.denied && current.unknown)) fail("caseState.self_directed_risk.current flags are invalid.");
  if (!Array.isArray(current.lowering_readings) || current.lowering_readings.length > SELF_DIRECTED_RISK_LOWERING_READINGS) fail("caseState.self_directed_risk.current.lowering_readings is invalid.");
  if (Object.hasOwn(current, "lowered_at_planned_turn") && !isCount(current.lowered_at_planned_turn)) fail("caseState.self_directed_risk.current.lowered_at_planned_turn is invalid.");
  if (Object.hasOwn(value, "risk_readings_dropped_from_history") && !isCount(value.risk_readings_dropped_from_history)) fail("caseState.self_directed_risk.risk_readings_dropped_from_history is invalid.");
  // Optional, like the two fields above: a record written without it (by a build before it existed) stays valid.
  if (Object.hasOwn(value, "first_reading")) {
    const first = value.first_reading;
    const name = "caseState.self_directed_risk.first_reading";
    if (!isRecord(first) || !SELF_DIRECTED_RISK_LEVELS.includes(first.level) || first.level === "absent" || !SELF_DIRECTED_RISK_CONTEXTS.includes(first.context)) fail(`${name} is invalid.`);
    checkText(first.assessed_turn_id, `${name}.assessed_turn_id`, 160);
    checkText(first.assessed_at, `${name}.assessed_at`, 80);
  }
  current.lowering_readings.forEach((item, index) => {
    const name = `caseState.self_directed_risk.current.lowering_readings[${index}]`;
    if (!isRecord(item) || !SELF_DIRECTED_RISK_LEVELS.includes(item.state) || !SELF_DIRECTED_RISK_CONTEXTS.includes(item.context)) fail(`${name} is invalid.`);
    checkText(item.turn_id, `${name}.turn_id`, 160);
    checkText(item.at, `${name}.at`, 80);
    checkIds(item.observation_ids, `${name}.observation_ids`);
  });
  value.history.forEach((item, index) => {
    const name = `caseState.self_directed_risk.history[${index}]`;
    if (!isRecord(item) || !SELF_DIRECTED_RISK_CHANGES.includes(item.change) || !SELF_DIRECTED_RISK_LEVELS.includes(item.level)
        || !SELF_DIRECTED_RISK_LEVELS.includes(item.reading) || !SELF_DIRECTED_RISK_CONTEXTS.includes(item.context)) fail(`${name} is invalid.`);
    checkText(item.assessed_turn_id, `${name}.assessed_turn_id`, 160);
    checkText(item.assessed_at, `${name}.assessed_at`, 80);
  });
  return value;
}

// The highest reading above absent that is still in the record's history, the latest one when several are equal. This is the turn
// the person said the most, so it is the one the reply check should be able to read exactly, not whichever lower reading came last.
export function highestSelfDirectedRiskReading(record) {
  let best = null;
  for (const entry of Array.isArray(record?.history) ? record.history : []) {
    if (entry?.reading && entry.reading !== "absent" && (best === null || RANK[entry.reading] >= RANK[best.reading])) best = entry;
  }
  return best;
}

// The record's first reading above absent, or null when it is unknown: the turn the person first said it, whatever came after. It is the
// stored `first_reading` (set once, outside the history). A record written before that field existed has no such field, so the first
// reading is taken from the front of its history, which is the raise that created the record, but only while no reading above absent
// has left that history (risk_readings_dropped_from_history is absent or 0): once one has, the front is no longer the first reading.
// Never throws, so it is safe on any record a build has written.
export function firstSelfDirectedRiskReading(record) {
  const stored = record?.first_reading;
  if (isRecord(stored) && typeof stored.assessed_turn_id === "string" && stored.assessed_turn_id.trim()) {
    return { level: stored.level, context: stored.context, assessed_turn_id: stored.assessed_turn_id, assessed_at: stored.assessed_at };
  }
  const front = Array.isArray(record?.history) ? record.history[0] : null;
  const leftTheHistory = Number.isSafeInteger(record?.risk_readings_dropped_from_history) && record.risk_readings_dropped_from_history > 0;
  if (leftTheHistory || front?.change !== "raised" || !front.reading || front.reading === "absent"
      || typeof front.assessed_turn_id !== "string" || !front.assessed_turn_id.trim()) return null;
  return { level: front.reading, context: front.context, assessed_turn_id: front.assessed_turn_id, assessed_at: front.assessed_at };
}

// The turn whose exact text the reply check should receive for the highest reading, or null. While the level is above absent it is the
// turn of the highest reading still in the history, so lowering intent to ideation does not take the intent statement out of the
// packet. After a lowering to absent it is the same turn, on the lowering turn and for SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS
// planned turns after it, then null. A record with no marker for the lowering (nothing written by this build) retrieves nothing.
// This is the highest reading's turn only; selfDirectedRiskRetrievalTurns adds the first reading's, which has no window.
export function selfDirectedRiskRetrievalTurn(state) {
  const record = state?.self_directed_risk;
  const current = record?.current;
  if (!current) return null;
  const turnId = highestSelfDirectedRiskReading(record)?.assessed_turn_id ?? (current.level === "absent" ? null : current.assessed_turn_id);
  if (!turnId) return null;
  if (current.level !== "absent") return turnId;
  const planned = Array.isArray(state.intervention_history) ? state.intervention_history.length : 0;
  return isCount(current.lowered_at_planned_turn) && planned - current.lowered_at_planned_turn <= SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS ? turnId : null;
}

// Every turn whose exact text the reply check should receive for this case state: at most two, without duplicates, [] when there is no
// record. They are the turn of the highest reading (selfDirectedRiskRetrievalTurn: the latest when several are equal, and after a lowering
// to absent only for SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS planned turns) and the turn of the first reading above absent
// (firstSelfDirectedRiskReading), which is kept for the rest of the case, also after a lowering to absent. When the first reading is the
// highest one they are the same turn and it appears once. A first reading that is unknown adds nothing, so such a record retrieves what
// it did before the first reading was kept.
export function selfDirectedRiskRetrievalTurns(state) {
  const record = state?.self_directed_risk;
  if (!record?.current) return [];
  const turns = [selfDirectedRiskRetrievalTurn(state), firstSelfDirectedRiskReading(record)?.assessed_turn_id ?? null];
  return [...new Set(turns.filter((turnId) => typeof turnId === "string" && turnId.length > 0))];
}
