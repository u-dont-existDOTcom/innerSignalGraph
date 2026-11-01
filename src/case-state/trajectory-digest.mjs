import { SELF_DIRECTED_RISK_HISTORY_LIMIT, SELF_DIRECTED_RISK_LOWERING_READINGS, highestSelfDirectedRiskReading } from "./self-directed-risk.mjs";

// A small digest of how the whole case has run, worked out in code from the stored case state and the verbatim window. It makes no
// model call. The reply check reads only the current episode's exact turns, so after a route change the earlier turns are outside
// what it can see; the digest says how many there were, which of them were about the person's own life, and whether their exact
// text is in the packet. It is evidence for the check, not a verdict: it changes no routing, tier or reply text (owner decision D1).
export const TRAJECTORY_DIGEST_VERSION = 1;
// The three routes the planner picks for ideation, intent or imminent. The planner can send a first disclosure to the adult-seat
// route (it is chosen when adult access or a witness is low, absent or unknown), so it belongs in the digest's counting. That is
// all this list does: the owner-pending fallback message covers two routes, not this one (owner question 55 decides that).
export const SUICIDE_FAMILY_ROUTE_IDS = Object.freeze(["IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.PRECIOUS_HUMAN_OPPORTUNITY", "IC.SUICIDAL_ADULT_SEAT"]);
export const SAFETY_ORIENTATION_ROUTE_ID = "IC.SAFETY_ORIENTATION";
const MAXIMUM_ROUTE_RUNS = 30;
const MAXIMUM_LISTED_TURNS = 20;

const FAMILY_ROUTES = new Set(SUICIDE_FAMILY_ROUTE_IDS);
const asArray = (value) => (Array.isArray(value) ? value : []);

// The route chosen for a turn is stored only in the text of its intervention_history statement ("Selected <id>: <title>.").
export function routeOfHistoryItem(item) {
  return typeof item?.statement === "string" ? (item.statement.match(/^Selected (.+?): /u)?.[1] ?? null) : null;
}

function routeRuns(entries) {
  const runs = [];
  for (const entry of entries) {
    const last = runs.at(-1);
    if (last && last.route === entry.route) {
      last.to_turn = entry.number;
      last.turns += 1;
    } else {
      runs.push({ route: entry.route, from_turn: entry.number, to_turn: entry.number, turns: 1 });
    }
  }
  return { runs: runs.slice(-MAXIMUM_ROUTE_RUNS), earlier_runs_omitted: Math.max(0, runs.length - MAXIMUM_ROUTE_RUNS) };
}

function riskRecordSummary(record, numberOf) {
  const current = record?.current;
  if (!current) return null;
  const highest = highestSelfDirectedRiskReading(record);
  return {
    level: current.level,
    context: current.context,
    assessed_turn_id: current.assessed_turn_id,
    assessed_turn_number: numberOf(current.assessed_turn_id),
    assessed_at: current.assessed_at,
    observation_ids: asArray(current.observation_ids),
    latest_reading_turn_id: current.latest_turn_id,
    latest_reading_turn_number: numberOf(current.latest_turn_id),
    latest_reading_denied: current.denied === true,
    latest_reading_unknown: current.unknown === true,
    fresh_readings_below_held_level: asArray(current.lowering_readings).map((reading) => ({ turn_id: reading.turn_id, state: reading.state })),
    lowering_rule: `The held level is lowered only after ${SELF_DIRECTED_RISK_LOWERING_READINGS} fresh readings in a row below it; an unknown reading starts the run again. The extraction has no separate explicit-denial value.`,
    highest_reading_in_history: highest ? { reading: highest.reading, turn_id: highest.assessed_turn_id, turn_number: numberOf(highest.assessed_turn_id) } : null,
    history: asArray(record.history).map((entry) => ({ change: entry.change, level: entry.level, reading: entry.reading, turn_id: entry.assessed_turn_id, turn_number: numberOf(entry.assessed_turn_id) }))
  };
}

export function buildTrajectoryDigest(context = {}) {
  const state = context?.case_state ?? {};
  const history = asArray(state.intervention_history);
  const windowTurns = asArray(context?.recent_verbatim?.turns);
  const windowIds = new Set(windowTurns.map((turn) => turn?.id));
  const retrievedIds = new Set(asArray(context?.targeted_older_evidence).filter((item) => item?.turn != null).map((item) => item.turn_id));
  const entries = history.map((item, index) => ({ number: index + 1, turn_id: item?.source?.turn_id ?? null, route: routeOfHistoryItem(item) }));
  const numbers = new Map(entries.filter((entry) => entry.turn_id != null).map((entry) => [entry.turn_id, entry.number]));
  const numberOf = (turnId) => numbers.get(turnId) ?? null;

  const userTurnsInWindow = windowTurns.filter((turn) => turn?.role === "user").length;
  const userTurnCount = Number.isSafeInteger(context?.user_turn_count) && context.user_turn_count >= 0 ? context.user_turn_count : null;

  const episode = state.current_episode ?? null;
  const startIndex = episode?.started_turn_id ? entries.findIndex((entry) => entry.turn_id === episode.started_turn_id) : -1;
  const episodeSummary = episode ? {
    id: episode.id ?? null,
    route: episode.route ?? null,
    active_step: episode.active_step ?? null,
    started_turn_number: startIndex >= 0 ? startIndex + 1 : null,
    started_by: startIndex < 0 ? "unknown" : (startIndex === 0 ? "case_start" : "route_change"),
    previous_selected_route: startIndex > 0 ? entries[startIndex - 1].route : null,
    user_turns_in_verbatim_window: userTurnsInWindow
  } : null;

  // Turns the reply check cannot see in the window. A turn counts as self-directed risk when its route was one of the suicide routes,
  // or when the risk record has a reading above absent for it: in its history, or as the turn it currently holds. The second rule is
  // what brings in IC.SAFETY_ORIENTATION only when it was chosen for that reason, and any other route chosen while the person said it.
  // The route part is exact for the whole case. The record part is not: its history keeps only the latest events, so readings that
  // fell off its front are counted in risk_readings_dropped_from_history and the digest says its counts are a lower bound.
  const riskRecord = state.self_directed_risk ?? null;
  const droppedReadings = Number.isSafeInteger(riskRecord?.risk_readings_dropped_from_history) && riskRecord.risk_readings_dropped_from_history > 0 ? riskRecord.risk_readings_dropped_from_history : 0;
  const riskReadingTurns = new Set(asArray(riskRecord?.history).filter((entry) => entry?.reading && entry.reading !== "absent").map((entry) => entry.assessed_turn_id));
  if (riskRecord?.current && riskRecord.current.level !== "absent") riskReadingTurns.add(riskRecord.current.assessed_turn_id);
  const outside = entries.filter((entry) => !windowIds.has(entry.turn_id));
  const family = outside.filter((entry) => FAMILY_ROUTES.has(entry.route) || riskReadingTurns.has(entry.turn_id));
  const familyWithText = family.filter((entry) => retrievedIds.has(entry.turn_id));
  const unclassifiedSafety = outside.filter((entry) => entry.route === SAFETY_ORIENTATION_ROUTE_ID && !family.includes(entry));

  return Object.freeze({
    schema_version: TRAJECTORY_DIGEST_VERSION,
    computed_in_code: true,
    model_calls: 0,
    turn_numbering: "Turn numbers are positions in the case's route history, one entry for each planned user turn, counted from 1.",
    whole_case: {
      user_turn_count: userTurnCount,
      planned_turn_count: entries.length,
      user_turns_in_verbatim_window: userTurnsInWindow,
      user_turns_outside_verbatim_window: userTurnCount == null ? null : Math.max(0, userTurnCount - userTurnsInWindow)
    },
    current_episode: episodeSummary,
    route_sequence: routeRuns(entries),
    suicide_family: {
      counted: [...SUICIDE_FAMILY_ROUTE_IDS, `any turn with a risk reading above absent that is still in the risk record's history (its latest ${SELF_DIRECTED_RISK_HISTORY_LIMIT} events), or that the record currently holds (this includes ${SAFETY_ORIENTATION_ROUTE_ID} when it was chosen for that reason)`],
      earlier_user_turns_outside_verbatim_window: family.length,
      turn_numbers: family.slice(-MAXIMUM_LISTED_TURNS).map((entry) => entry.number),
      with_exact_text_in_targeted_older_evidence: familyWithText.length,
      without_exact_text_in_this_packet: family.length - familyWithText.length,
      risk_readings_dropped_from_record_history: droppedReadings,
      counts_are_a_lower_bound: droppedReadings > 0,
      safety_orientation_turns_without_a_risk_reading_still_in_the_records_history: unclassifiedSafety.length
    },
    self_directed_risk: riskRecordSummary(state.self_directed_risk, numberOf)
  });
}
