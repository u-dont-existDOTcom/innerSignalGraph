import { ValidationError } from "../core/errors.mjs";
import { constitutionReference } from "../therapy/constitution.mjs";
import { createEmptyCaseState, validateCaseState } from "./longitudinal-state.mjs";
import { summarizeTrackerWindow } from "./tracker.mjs";

export const CONTEXT_WINDOW_LIMITS = Object.freeze({
  transcript_entries: 20_000,
  turn_text: 40_000,
  selected_turns: 120,
  retrieval_requests: 24
});

function validateTurn(turn, index) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) throw new ValidationError(`transcript[${index}] must be an object.`);
  for (const field of ["id", "exchange_id", "role", "text", "at"]) {
    if (typeof turn[field] !== "string" || !turn[field].trim()) throw new ValidationError(`transcript[${index}].${field} is required.`);
  }
  if (turn.id.length > 160 || turn.exchange_id.length > 160 || turn.at.length > 80 || turn.text.length > CONTEXT_WINDOW_LIMITS.turn_text) throw new ValidationError(`transcript[${index}] exceeds a bounded field limit.`);
  if (!["user", "assistant"].includes(turn.role)) throw new ValidationError(`transcript[${index}].role is invalid.`);
  if (turn.episode_id != null && (typeof turn.episode_id !== "string" || !turn.episode_id.trim())) throw new ValidationError(`transcript[${index}].episode_id is invalid.`);
  return turn;
}

export function validateTranscriptEntries(entries) {
  if (!Array.isArray(entries)) throw new ValidationError("transcript must be an array.");
  if (entries.length > CONTEXT_WINDOW_LIMITS.transcript_entries) throw new ValidationError("transcript exceeds the private-record turn limit.");
  const ids = new Set();
  entries.forEach((turn, index) => {
    validateTurn(turn, index);
    if (ids.has(turn.id)) throw new ValidationError(`Duplicate transcript turn ${turn.id}.`);
    ids.add(turn.id);
  });
  return entries;
}

export function selectRecentVerbatimWindow(entries, { minimumCompleteExchanges = 3, currentEpisodeId = null, maximumSelectedTurns = CONTEXT_WINDOW_LIMITS.selected_turns } = {}) {
  if (!Number.isInteger(minimumCompleteExchanges) || minimumCompleteExchanges < 0 || minimumCompleteExchanges > 20) throw new ValidationError("minimumCompleteExchanges must be an integer from 0 to 20.");
  if (!Number.isInteger(maximumSelectedTurns) || maximumSelectedTurns < minimumCompleteExchanges * 2 || maximumSelectedTurns > CONTEXT_WINDOW_LIMITS.selected_turns) throw new ValidationError("maximumSelectedTurns is outside the bounded context policy.");
  const transcript = structuredClone(validateTranscriptEntries(entries));
  const exchanges = new Map();
  transcript.forEach((turn, index) => {
    const exchange = exchanges.get(turn.exchange_id) ?? { id: turn.exchange_id, indexes: [], roles: new Set() };
    exchange.indexes.push(index);
    exchange.roles.add(turn.role);
    exchanges.set(turn.exchange_id, exchange);
  });
  const complete = [...exchanges.values()].filter((exchange) => exchange.roles.has("user") && exchange.roles.has("assistant"));
  const required = complete.slice(-Math.max(0, minimumCompleteExchanges));
  let start = required.length ? Math.min(...required.flatMap((exchange) => exchange.indexes)) : transcript.length;
  if (currentEpisodeId) {
    const episodeIndexes = transcript.map((turn, index) => turn.episode_id === currentEpisodeId ? index : -1).filter((index) => index >= 0);
    if (episodeIndexes.length) start = Math.min(start, Math.min(...episodeIndexes));
  }
  const episodeExtended = transcript.slice(start);
  const selected = episodeExtended.slice(-maximumSelectedTurns);
  return Object.freeze({
    policy: "minimum-last-3-complete-exchanges-extended-to-current-episode-with-explicit-turn-bound",
    minimum_complete_exchanges: minimumCompleteExchanges,
    maximum_selected_turns: maximumSelectedTurns,
    selected_complete_exchange_ids: required.map((exchange) => exchange.id),
    extended_for_current_episode: Boolean(currentEpisodeId && selected.some((turn) => turn.episode_id === currentEpisodeId) && start < (required[0]?.indexes[0] ?? transcript.length)),
    truncated_for_bound: selected.length < episodeExtended.length,
    omitted_turn_count: episodeExtended.length - selected.length,
    turns: selected
  });
}

export function formatVerbatimWindow(window) {
  return window.turns.map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`).join("\n\n");
}

export function targetedRetrievalRequests(caseState, recentTurnIds = []) {
  const state = validateCaseState(structuredClone(caseState));
  const recent = new Set(recentTurnIds);
  const refs = [];
  for (const cluster of state.contradiction_clusters) {
    if (cluster.status !== "open" || cluster.decision_relevance !== "high") continue;
    for (const itemId of cluster.item_ids) {
      const item = state.items.find((candidate) => candidate.id === itemId);
      if (item?.source.turn_id && !recent.has(item.source.turn_id)) refs.push({ reason: `open-contradiction-${cluster.id}`, turn_id: item.source.turn_id, item_id: item.id });
    }
  }
  for (const item of [...state.items, ...state.intervention_history]) {
    if (item.decision_relevance !== "high" || !item.source.turn_id || recent.has(item.source.turn_id)) continue;
    refs.push({ reason: `decision-relevant-${item.domain}`, turn_id: item.source.turn_id, item_id: item.id });
  }
  return [...new Map(refs.map((item) => [`${item.turn_id}:${item.item_id}`, item])).values()].slice(0, CONTEXT_WINDOW_LIMITS.retrieval_requests);
}

export function buildDurableCaseContext({ caseId = "local-case", caseState = null, transcriptEntries = [], trackerEntries = [], currentUserMessage = "" } = {}) {
  const state = caseState ? validateCaseState(structuredClone(caseState)) : createEmptyCaseState({ caseId });
  const recent = selectRecentVerbatimWindow(transcriptEntries, { currentEpisodeId: state.current_episode?.id ?? null });
  const retrieval = targetedRetrievalRequests(state, recent.turns.map((turn) => turn.id));
  const transcriptById = new Map(validateTranscriptEntries(transcriptEntries).map((turn) => [turn.id, turn]));
  const requestsByTurn = new Map();
  for (const request of retrieval) {
    const group = requestsByTurn.get(request.turn_id) ?? { turn_id: request.turn_id, reasons: [], item_ids: [] };
    group.reasons.push(request.reason);
    group.item_ids.push(request.item_id);
    requestsByTurn.set(request.turn_id, group);
  }
  const targetedOlderEvidence = [...requestsByTurn.values()].map((request) => ({
    ...request,
    reasons: [...new Set(request.reasons)],
    item_ids: [...new Set(request.item_ids)],
    turn: transcriptById.has(request.turn_id) ? structuredClone(transcriptById.get(request.turn_id)) : null
  }));
  return Object.freeze({
    constitution_ref: constitutionReference(),
    case_state: state,
    current_episode: state.current_episode,
    recent_verbatim_window: recent,
    recent_transcript_text: formatVerbatimWindow(recent),
    targeted_retrieval_requests: retrieval,
    targeted_older_evidence: targetedOlderEvidence,
    tracker_window: summarizeTrackerWindow(trackerEntries),
    current_user_message: currentUserMessage,
    lossy_summary_is_authority: false
  });
}

export function decisionRelevantProjection(context) {
  const state = context.case_state;
  return {
    constitution_version: context.constitution_ref.version,
    high_relevance_items: state.items.filter((item) => item.decision_relevance === "high" && item.still_current !== false).map((item) => ({ id: item.id, status: item.status, statement: item.statement })),
    open_high_relevance_contradictions: state.contradiction_clusters.filter((item) => item.status === "open" && item.decision_relevance === "high").map((item) => item.id),
    answered_questions: state.answered_questions.filter((item) => item.still_current !== false).map((item) => item.id),
    current_episode: state.current_episode ? { id: state.current_episode.id, target: state.current_episode.target, route: state.current_episode.route, next_question: state.current_episode.next_question } : null,
    retrieval_item_ids: context.targeted_retrieval_requests.map((item) => item.item_id)
  };
}
