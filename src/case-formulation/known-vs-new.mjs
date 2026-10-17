import { ValidationError } from "../core/errors.mjs";
import { FRENCH_STOPWORDS, formsReadingStopwords, formsReadingTerm, formsReadingTokens } from "../journal-import/word-forms.mjs";
import { readCaseRoadmap } from "./case-roadmap.mjs";

// Where the case record already holds a point (issue #172): for each proposed point of a review, the record's entries that
// share the most word forms with it, ranked with BM25 over the journal search's reading of words (accents folded, English and
// French stems). Mechanical: it counts shared word forms and judges no meaning. The reviewer still says what each point is.
// It covers the case record; journal material has its own search tools.

export const KNOWN_VS_NEW_LIMITS = Object.freeze({ points: 12, point_text: 600, matches_default: 5, matches_max: 8, statement: 400, source_ids: 5 });
// A match sharing at least this share of a point's content words is reported as close; the share is shown either way.
export const KNOWN_VS_NEW_CLOSE_OVERLAP = 0.6;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

let stopwords = null;
function contentStopwords() {
  if (stopwords === null) stopwords = new Set([...formsReadingStopwords(), ...[...FRENCH_STOPWORDS].map((word) => formsReadingTerm(word))]);
  return stopwords;
}

function fail(message) {
  throw new ValidationError(message, { code: "KNOWN_VS_NEW_INPUT_INVALID" });
}

const clip = (value) => (value.length > KNOWN_VS_NEW_LIMITS.statement ? `${value.slice(0, KNOWN_VS_NEW_LIMITS.statement - 1)}…` : value);

// Where an item came from, as the case state records it: the kind of source, its reference and turn, and whether a model only
// interpreted it. These are bounded ids and labels, so a caller can tell the client's words from a model's extraction and
// find the evidence.
function provenance(source) {
  if (!source) return { source: null };
  return { source: { kind: source.kind ?? null, ref: source.ref ?? null, turn_id: source.turn_id ?? null, ...(source.assertion_scope ? { assertion_scope: source.assertion_scope } : {}) } };
}

// Every entry of the record a point can match, with the text it is read by and what a reader needs to place it.
function recordEntries(state) {
  const entries = [];
  // `current` is false for what the record no longer holds as current: an item or answer marked not current, an item another
  // item supersedes, a superseded goal or one the client declined. Such a match is shown, never counted as the record holding
  // the point.
  const superseded = new Set([...(state.items ?? []), ...(state.intervention_history ?? [])].flatMap((item) => item.supersedes ?? []));
  for (const item of state.items ?? []) {
    entries.push({ kind: "fact_or_hypothesis", id: item.id, text: item.statement, current: item.still_current !== false && !superseded.has(item.id),
      detail: { status: item.status, confidence: item.confidence, still_current: item.still_current, decision_relevance: item.decision_relevance, recorded_at: item.source?.recorded_at ?? null, ...provenance(item.source) } });
  }
  for (const item of state.answered_questions ?? []) {
    entries.push({ kind: "settled_answer", id: item.id, text: `${item.question} ${item.answer}`, current: item.still_current !== false, detail: { still_current: item.still_current, source_item_ids: (item.source_item_ids ?? []).slice(0, KNOWN_VS_NEW_LIMITS.source_ids) } });
  }
  for (const item of state.intervention_history ?? []) {
    entries.push({ kind: "intervention", id: item.id, text: item.statement, current: item.still_current !== false && !superseded.has(item.id), detail: { recorded_at: item.source?.recorded_at ?? null, ...provenance(item.source) } });
  }
  // The plan as this version reads it; a stored plan it can't read adds no goals (the store's answer says so).
  for (const goal of readCaseRoadmap(state.roadmap ?? null).roadmap?.goals ?? []) {
    entries.push({ kind: "roadmap_goal", id: goal.id, text: [goal.title, goal.review_condition, goal.expected_progress, goal.next_step_tests].filter(Boolean).join(" "),
      current: goal.status !== "superseded" && goal.client_agreement !== "declined",
      detail: { goal_kind: goal.kind, status: goal.status, priority_source: goal.priority_source, client_agreement: goal.client_agreement } });
  }
  if (state.current_episode) {
    entries.push({ kind: "current_episode", id: state.current_episode.id, text: `${state.current_episode.target} ${state.current_episode.route}`, current: true, detail: { started_turn_id: state.current_episode.started_turn_id } });
  }
  for (const thread of state.focus_discipline?.threads ?? []) {
    if (thread.status !== "parked") continue;
    entries.push({ kind: "parked_question", id: thread.id, text: `${thread.question} ${thread.why_it_matters}`, current: true, detail: { importance: thread.importance } });
  }
  return entries;
}

/**
 * For each point, the record entries that share the most word forms with it. `points` is a list of 1 to 12 texts of at most
 * 600 characters; `limit` how many matches to return for each (1 to 8). Returns, for each point, its matches (best first, each
 * with its kind, id, the share of the point's content words it holds and its text, clipped) and whether the best is close.
 * Takes a validated case state.
 */
export function rankKnownVersusNew(state, points, { limit = KNOWN_VS_NEW_LIMITS.matches_default } = {}) {
  if (!state || typeof state !== "object") fail("A case state is required.");
  if (!Array.isArray(points) || points.length < 1 || points.length > KNOWN_VS_NEW_LIMITS.points) fail("points must hold 1 to 12 texts.");
  points.forEach((point) => {
    if (typeof point !== "string" || !point.trim() || point.length > KNOWN_VS_NEW_LIMITS.point_text) fail("Each point must be non-empty text of at most 600 characters.");
  });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > KNOWN_VS_NEW_LIMITS.matches_max) fail("limit must be 1 to 8.");
  const memo = new Map();
  const skip = contentStopwords();
  const content = (text) => formsReadingTokens(text, memo).filter((term) => !skip.has(term));
  const entries = recordEntries(state).map((entry) => {
    const terms = content(entry.text);
    const counts = new Map();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    return { ...entry, counts, length: terms.length };
  });
  const documentFrequency = new Map();
  for (const entry of entries) for (const term of entry.counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const meanLength = entries.length ? Math.max(1, entries.reduce((sum, entry) => sum + entry.length, 0) / entries.length) : 1;
  return Object.freeze(points.map((point) => {
    const terms = [...new Set(content(point))];
    const scored = [];
    if (terms.length) {
      for (const entry of entries) {
        let score = 0;
        let shared = 0;
        for (const term of terms) {
          const frequency = entry.counts.get(term);
          if (!frequency) continue;
          shared += 1;
          const df = documentFrequency.get(term);
          const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5));
          score += idf * (frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * (1 - BM25_B + BM25_B * entry.length / meanLength));
        }
        if (shared) scored.push({ entry, score, shared, overlap: shared / terms.length });
      }
    }
    scored.sort((left, right) => right.score - left.score || right.overlap - left.overlap || (left.entry.id < right.entry.id ? -1 : 1));
    // Close: a current entry sharing at least two of the point's content words and the set share of them. A point of one
    // content word is never reported close: one shared word says too little.
    const current = scored.filter((match) => match.entry.current);
    const close = terms.length >= 2 ? current.filter((match) => match.shared >= 2 && match.overlap >= KNOWN_VS_NEW_CLOSE_OVERLAP) : [];
    // When the record holds the point closely, the matches returned include where: if better-scored entries that are no
    // longer current fill the list, the best close match takes its last place.
    let top = scored.slice(0, limit);
    if (close.length && !top.some((match) => close.includes(match))) top = [...top.slice(0, limit - 1), close[0]];
    const matches = top.map(({ entry, score, overlap }) => ({
      kind: entry.kind,
      id: entry.id,
      current: entry.current,
      overlap: Math.round(overlap * 100) / 100,
      score: Math.round(score * 1000) / 1000,
      text: clip(entry.text),
      ...entry.detail
    }));
    const closest = Math.round(current.reduce((best, match) => Math.max(best, match.overlap), 0) * 100) / 100;
    return Object.freeze({
      point,
      content_terms: terms.length,
      closest_overlap: closest,
      record_holds_close_match: close.length > 0,
      matches
    });
  }));
}
