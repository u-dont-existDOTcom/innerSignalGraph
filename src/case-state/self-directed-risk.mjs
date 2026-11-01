import { ValidationError } from "../core/errors.mjs";

// A small record of what the extraction has said, turn after turn, about the person's own life. It exists so that the reply
// check can still see earlier self-directed risk after the case has moved to another route and the verbatim window no longer
// holds the turns where it was said. It is derived only from the two fields the extractor already returns
// (variables.suicidal_state and variables.suicidal_ideation_context); no model field or call was added for it.
//
// What it is not: it changes no routing, no reasoning tier and no reply text. Owner decision D1 (2026-09-26) stands: the
// state alone neither selects a safety tier nor appends a crisis script. Nothing here feeds the planner, and the writing and
// extraction prompts never show this record (see promptCaseState); only the reply check reads it, inside the audit packet.
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

const RANK = Object.freeze({ absent: 0, ideation: 1, intent: 2, imminent: 3 });
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
const appendHistory = (history, entry) => (entry ? [...history, entry] : [...history]).slice(-SELF_DIRECTED_RISK_HISTORY_LIMIT);

export function updateSelfDirectedRiskState(previous, variables, { turnId, recordedAt, observationIds = [] } = {}) {
  const { state, context } = readingOf(variables);
  const prior = previous?.current ?? null;
  // A case with no self-directed language never gets the record, so every such case stays byte-identical to before.
  if (!prior && (state == null || state === "absent")) return previous ?? null;
  checkText(turnId, "self-directed risk turn ID", 160);
  checkText(recordedAt, "self-directed risk recordedAt", 80);
  const observed = [...new Set(observationIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, SELF_DIRECTED_RISK_OBSERVATION_LIMIT);
  const history = previous?.history ?? [];
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
    lowering_readings: fields.lowering_readings ?? []
  });
  const raised = (level) => current({ level, context, assessed_turn_id: turnId, assessed_at: recordedAt, observation_ids: observed });

  if (!prior) {
    return { version: SELF_DIRECTED_RISK_VERSION, current: raised(state), history: appendHistory(history, event("raised", state, state, context, turnId, recordedAt)) };
  }

  // Nothing was learned this turn: keep the level, remember that the latest reading was unknown, and start any run of lower readings again.
  if (state == null) {
    return { version: SELF_DIRECTED_RISK_VERSION, current: { ...structuredClone(prior), latest_turn_id: turnId, denied: false, unknown: true, lowering_readings: [] }, history: [...history] };
  }

  const held = prior.level;
  if (state !== "absent" && RANK[state] > RANK[held]) {
    return { version: SELF_DIRECTED_RISK_VERSION, current: raised(state), history: appendHistory(history, event("raised", state, state, context, turnId, recordedAt)) };
  }
  if (state !== "absent" && state === held) {
    // The same level again. The turn that established it stays the one to retrieve; only the latest-reading marks move.
    return {
      version: SELF_DIRECTED_RISK_VERSION,
      current: { ...structuredClone(prior), context: context === "unknown" ? prior.context : context, latest_turn_id: turnId, denied: false, unknown: false, lowering_readings: [] },
      history: appendHistory(history, event("held", held, state, context, turnId, recordedAt))
    };
  }
  if (held === "absent") {
    // Already at absent and absent again.
    return { version: SELF_DIRECTED_RISK_VERSION, current: { ...structuredClone(prior), latest_turn_id: turnId, denied: true, unknown: false, lowering_readings: [] }, history: [...history] };
  }

  // A fresh reading below the held level. It counts toward lowering only together with the readings just before it.
  const reading = { turn_id: turnId, at: recordedAt, state, context, observation_ids: state === "absent" ? [] : observed };
  const run = [...prior.lowering_readings, reading];
  if (run.length < SELF_DIRECTED_RISK_LOWERING_READINGS) {
    return {
      version: SELF_DIRECTED_RISK_VERSION,
      current: { ...structuredClone(prior), latest_turn_id: turnId, denied: state === "absent", unknown: false, lowering_readings: run },
      history: state === "absent" ? [...history] : appendHistory(history, event("held", held, state, context, turnId, recordedAt))
    };
  }
  // Enough fresh readings in a row: lower to the highest of them (the latest if equal), anchored on the turn that reading came from.
  const chosen = run.reduce((best, item) => (RANK[item.state] >= RANK[best.state] ? item : best), run[0]);
  return {
    version: SELF_DIRECTED_RISK_VERSION,
    current: current({
      level: chosen.state,
      context: chosen.context,
      assessed_turn_id: chosen.turn_id,
      assessed_at: chosen.at,
      observation_ids: chosen.observation_ids,
      denied: state === "absent"
    }),
    history: appendHistory(history, event("lowered", chosen.state, state, context, turnId, recordedAt))
  };
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

// Held at ideation or above, with the turn that established it. The retrieval branch and the decision-relevant projection read this.
export function activeSelfDirectedRisk(state) {
  const current = state?.self_directed_risk?.current;
  return current && current.level !== "absent" ? current : null;
}
