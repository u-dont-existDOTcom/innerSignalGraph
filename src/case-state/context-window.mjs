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

export function selectRecentVerbatimWindow(entries, {
  currentEpisodeId = null,
  currentEpisodeStartTurnId = null,
  maximumSelectedTurns = CONTEXT_WINDOW_LIMITS.selected_turns,
  requireCompleteEpisode = false
} = {}) {
  const maximumAllowed = requireCompleteEpisode ? CONTEXT_WINDOW_LIMITS.transcript_entries : CONTEXT_WINDOW_LIMITS.selected_turns;
  if (!Number.isInteger(maximumSelectedTurns) || maximumSelectedTurns < 1 || maximumSelectedTurns > maximumAllowed) throw new ValidationError("maximumSelectedTurns is outside the bounded context policy.");
  if (currentEpisodeId != null && (typeof currentEpisodeId !== "string" || !currentEpisodeId.trim())) throw new ValidationError("currentEpisodeId is invalid.");
  if (currentEpisodeStartTurnId != null && (typeof currentEpisodeStartTurnId !== "string" || !currentEpisodeStartTurnId.trim())) throw new ValidationError("currentEpisodeStartTurnId is invalid.");
  const transcript = structuredClone(validateTranscriptEntries(entries));
  const declaredStart = currentEpisodeStartTurnId == null
    ? -1
    : transcript.findIndex((turn) => turn.id === currentEpisodeStartTurnId);
  const firstEpisodeTurn = currentEpisodeId == null
    ? -1
    : transcript.findIndex((turn) => turn.episode_id === currentEpisodeId);
  const start = declaredStart >= 0
    ? declaredStart
    : firstEpisodeTurn >= 0
      ? firstEpisodeTurn
      : Math.max(0, transcript.length - maximumSelectedTurns);
  const episodeExtended = transcript.slice(start);
  const effectiveMaximum = requireCompleteEpisode && episodeExtended.length > maximumSelectedTurns
    ? Math.min(episodeExtended.length, CONTEXT_WINDOW_LIMITS.transcript_entries)
    : maximumSelectedTurns;
  const selected = episodeExtended.slice(-effectiveMaximum);
  const episodeFailures = [];
  if (requireCompleteEpisode) {
    if (!currentEpisodeId) episodeFailures.push("current episode identifier is missing");
    if (!currentEpisodeStartTurnId) episodeFailures.push("current episode start turn is missing");
    else if (declaredStart < 0) episodeFailures.push("current episode start turn is absent from the exact transcript");
    if (declaredStart >= 0 && transcript[declaredStart]?.episode_id !== currentEpisodeId) episodeFailures.push("current episode start turn has the wrong episode identifier");
    if (declaredStart >= 0 && transcript.slice(declaredStart).some((turn) => turn.episode_id !== currentEpisodeId)) episodeFailures.push("current episode turns are not a contiguous exact transcript suffix");
    if (selected.length !== episodeExtended.length || selected.some((turn, index) => turn.id !== episodeExtended[index]?.id)) episodeFailures.push("current episode was truncated or reordered");
    if (!selected.some((turn) => turn.role === "user")) episodeFailures.push("current episode has no exact user turn");
  }
  const episodeCompleteness = Object.freeze({
    required: requireCompleteEpisode,
    complete: requireCompleteEpisode ? episodeFailures.length === 0 : null,
    failures: Object.freeze(episodeFailures),
    episode_id: currentEpisodeId,
    started_turn_id: currentEpisodeStartTurnId,
    captured_turn_count: selected.length,
    expected_turn_count: episodeExtended.length,
    first_captured_turn_id: selected[0]?.id ?? null,
    last_captured_turn_id: selected.at(-1)?.id ?? null,
    pending_reply_tail: selected.at(-1)?.role === "user"
  });
  return Object.freeze({
    policy: requireCompleteEpisode
      ? "semantic-active-episode-from-declared-start-through-latest-turn"
      : "bounded-recent-context-extended-to-current-episode",
    maximum_selected_turns: maximumSelectedTurns,
    complete_episode_required: requireCompleteEpisode,
    episode_completeness: episodeCompleteness,
    extended_for_current_episode: Boolean(currentEpisodeId && firstEpisodeTurn >= 0 && firstEpisodeTurn < Math.max(0, transcript.length - maximumSelectedTurns)),
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
  const threat = state.threat_pathway?.current;
  if (threat?.assessed_turn_id && !recent.has(threat.assessed_turn_id)
      && threat.level !== "NO_CURRENT_VIOLENCE_EVIDENCE") {
    refs.push({
      reason: `current-threat-pathway-${threat.level.toLowerCase()}`,
      turn_id: threat.assessed_turn_id,
      item_id: "threat_pathway.current"
    });
  }
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
  const recent = selectRecentVerbatimWindow(transcriptEntries, {
    currentEpisodeId: state.current_episode?.id ?? null,
    currentEpisodeStartTurnId: state.current_episode?.started_turn_id ?? null,
    requireCompleteEpisode: Boolean(state.current_episode)
  });
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
    threat_pathway: state.threat_pathway?.current ? {
      issue: state.threat_pathway.current.issue,
      level: state.threat_pathway.current.level,
      route: state.threat_pathway.current.route,
      assessed_turn_id: state.threat_pathway.current.assessed_turn_id,
      present_signal_kinds: state.threat_pathway.current.present_signal_kinds,
      denied_signal_kinds: state.threat_pathway.current.denied_signal_kinds,
      unknown_signal_kinds: state.threat_pathway.current.unknown_signal_kinds
    } : null,
    retrieval_item_ids: context.targeted_retrieval_requests.map((item) => item.item_id)
  };
}
