import { ValidationError } from "../core/errors.mjs";

// The measurement's reference step, its mechanical part (plan 2026-10-09-journal-quote-first.md, Part 3, "Questions
// that cover every sampled quote", "An independent check that the questions cover each quote" and "No unit drops
// out"). For each sampled unit the question writer writes one question for each thing a quote says; code checks that
// every quote has a question and every question names one of the unit's quotes; the coverage judge sees the quotes
// with their questions, 25 quotes to a call; and code, not the judge alone, decides which quotes are confirmed. A unit
// gets one writer retry in all, with the judge's notes when the check left a quote unconfirmed; a unit still
// incomplete after it is a nonresponse, which fails the recall floor. The model calls and the deadline are the
// runtime's. Nothing returned for a log or a report holds journal text: notes go only into the writer's retry packet.

/** Quotes to a coverage-judge call. */
export const POINTER_COVERAGE_QUOTES_PER_CALL = 25;
/** Why a sampled unit ended without its reference. */
export const POINTER_REFERENCE_NONRESPONSE_REASONS = Object.freeze(["questions_incomplete", "coverage_unconfirmed",
  "coverage_check_failed", "deadline"]);

const ID_PATTERN = /^[A-Za-z0-9:_-]+$/;
const isId = (value) => typeof value === "string" && value.length > 0 && value.length <= 160 && ID_PATTERN.test(value);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isDistinctIds = (values) => Array.isArray(values) && values.every(isId) && new Set(values).size === values.length;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

// Freezes plain data all the way down.
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Checks the question writer's answer for one sampled unit. `quoteIds` are the unit's quotes; `sampleIndex` is the
 * unit's place in the sample and `attempt` 0 or 1 (its retry), which together make each question's ID,
 * `question:<sampleIndex>:<attempt>:<n>` in the answer's order, unique across the reference and its retries. The set is
 * complete when every question names one of the unit's quotes and every quote has at least one question; only then are
 * its questions returned. Counts say what is wrong otherwise.
 */
export function checkQuestionSet({ sampleIndex, attempt, quoteIds, answer } = {}) {
  invariant(isCount(sampleIndex) && (attempt === 0 || attempt === 1) && isDistinctIds(quoteIds) && quoteIds.length > 0,
    "POINTER_QUESTION_SET_INPUT_INVALID");
  const shaped = isObject(answer) && Array.isArray(answer.questions) && answer.questions.length > 0
    && answer.questions.every((item) => isObject(item) && isId(item.unit_id) && typeof item.question === "string"
      && item.question.length > 0 && typeof item.critical === "boolean");
  if (!shaped) {
    return deepFreeze({ complete: false, answer_valid: false, questions: [], foreign_questions: 0,
      quotes_without_question: quoteIds.length });
  }
  const known = new Set(quoteIds);
  const asked = new Set(answer.questions.map((item) => item.unit_id));
  const foreign = answer.questions.filter((item) => !known.has(item.unit_id)).length;
  const without = quoteIds.filter((id) => !asked.has(id)).length;
  const complete = foreign === 0 && without === 0;
  return deepFreeze({
    complete,
    answer_valid: true,
    questions: complete ? answer.questions.map((item, index) => ({ question_id: `question:${sampleIndex}:${attempt}:${index}`,
      unit_id: item.unit_id, question: item.question, critical: item.critical })) : [],
    foreign_questions: foreign,
    quotes_without_question: without
  });
}

/**
 * The coverage judge's calls: every quote with its questions (`question_id`, `question` and the writer's `critical`
 * mark), in the order given, 25 quotes to a call. A quote's questions are never split across calls.
 */
export function coverageJudgeCalls({ quotes } = {}) {
  invariant(Array.isArray(quotes) && quotes.every((quote) => isObject(quote) && isId(quote.unit_id) && typeof quote.text === "string"
    && Array.isArray(quote.questions) && quote.questions.length > 0
    && quote.questions.every((item) => isObject(item) && isId(item.question_id) && typeof item.question === "string"
      && typeof item.critical === "boolean")), "POINTER_COVERAGE_CALLS_INPUT_INVALID");
  invariant(isDistinctIds(quotes.map((quote) => quote.unit_id))
    && isDistinctIds(quotes.flatMap((quote) => quote.questions.map((item) => item.question_id))), "POINTER_COVERAGE_CALLS_DUPLICATE");
  const calls = [];
  for (let start = 0; start < quotes.length; start += POINTER_COVERAGE_QUOTES_PER_CALL) {
    calls.push({ call_index: calls.length, quotes: quotes.slice(start, start + POINTER_COVERAGE_QUOTES_PER_CALL).map((quote) => ({
      unit_id: quote.unit_id, text: quote.text,
      questions: quote.questions.map(({ question_id: questionId, question, critical }) => ({ question_id: questionId, question, critical }))
    })) });
  }
  return deepFreeze(calls);
}

/**
 * Checks the coverage judge's answer for one call against the call's quotes. The answer is valid when it judges every
 * quote of the call once and nothing else, every question it lists is one of that quote's, and it says what is wrong
 * with every quote it doesn't confirm; an invalid answer gets the call's one retry. A quote is confirmed only when the
 * judge says it is covered and lists no question as repeating another or asking about two things. A question is
 * critical when the writer or the judge marks it so. `notes` are the judge's words for the writer's retry packet, and
 * never go into a log or a report.
 */
export function checkCoverageJudgments({ quotes, answer } = {}) {
  invariant(Array.isArray(quotes) && quotes.length > 0 && quotes.every((quote) => isObject(quote) && isId(quote.unit_id)
    && Array.isArray(quote.questions) && quote.questions.length > 0
    && quote.questions.every((item) => isObject(item) && isId(item.question_id) && typeof item.critical === "boolean"))
    && isDistinctIds(quotes.map((quote) => quote.unit_id)), "POINTER_COVERAGE_CHECK_INPUT_INVALID");
  const invalid = (reason) => deepFreeze({ valid: false, reason, quotes: [], notes: [] });
  if (!isObject(answer) || !Array.isArray(answer.judgments)) return invalid("answer_invalid");
  const byQuote = new Map(quotes.map((quote) => [quote.unit_id, quote]));
  const seen = new Set();
  for (const judgment of answer.judgments) {
    if (!isObject(judgment) || !byQuote.has(judgment.unit_id)) return invalid("quote_outside_call");
    if (seen.has(judgment.unit_id)) return invalid("quote_judged_twice");
    seen.add(judgment.unit_id);
    const own = new Set(byQuote.get(judgment.unit_id).questions.map((item) => item.question_id));
    const lists = [judgment.critical_question_ids, judgment.repeated_question_ids, judgment.combined_question_ids];
    if (typeof judgment.covered !== "boolean" || typeof judgment.missing !== "string" || !lists.every(isDistinctIds)) {
      return invalid("answer_invalid");
    }
    if (!lists.every((list) => list.every((id) => own.has(id)))) return invalid("question_outside_quote");
    const confirmed = judgment.covered && judgment.repeated_question_ids.length === 0 && judgment.combined_question_ids.length === 0;
    if (!confirmed && judgment.missing.trim().length === 0) return invalid("unconfirmed_without_note");
  }
  if (seen.size !== quotes.length) return invalid("quote_not_judged");
  const judgmentFor = new Map(answer.judgments.map((judgment) => [judgment.unit_id, judgment]));
  const results = quotes.map((quote) => {
    const judgment = judgmentFor.get(quote.unit_id);
    const judgeCritical = new Set(judgment.critical_question_ids);
    return {
      unit_id: quote.unit_id,
      confirmed: judgment.covered && judgment.repeated_question_ids.length === 0 && judgment.combined_question_ids.length === 0,
      covered: judgment.covered,
      repeated: judgment.repeated_question_ids.length,
      combined: judgment.combined_question_ids.length,
      critical_question_ids: quote.questions.filter((item) => item.critical || judgeCritical.has(item.question_id))
        .map((item) => item.question_id)
    };
  });
  return deepFreeze({
    valid: true,
    reason: null,
    quotes: results,
    notes: results.filter((result) => !result.confirmed).map((result) => ({ unit_id: result.unit_id, missing: judgmentFor.get(result.unit_id).missing }))
  });
}

/**
 * Where a sampled unit's reference stands, from its writer attempts so far, oldest first. Each attempt holds `set`, its
 * checkQuestionSet result (null when the writer's call failed after its own retry), and `coverage`, null until the
 * coverage check has answered for all of the unit's quotes, then either { failed: true } (a judge call failed after its
 * retry) or { quotes, notes } gathered from checkCoverageJudgments for this unit's quotes. Returns the next step:
 * `write` (attempt 0, or the unit's one retry, with the judge's notes when the check left quotes unconfirmed), `judge`,
 * `complete` (with the questions and their critical marks) or `nonresponse` (with its reason).
 */
export function referenceUnitStep({ quoteIds, attempts } = {}) {
  invariant(isDistinctIds(quoteIds) && quoteIds.length > 0 && Array.isArray(attempts) && attempts.length <= 2
    && attempts.every((attempt) => isObject(attempt)), "POINTER_REFERENCE_STEP_INPUT_INVALID");
  if (attempts.length === 0) return deepFreeze({ step: "write", attempt: 0, notes: [] });
  const index = attempts.length - 1;
  const last = attempts[index];
  // The unit's one retry, used by whichever falls short first: the writer's answer or the coverage check.
  const retry = (notes) => deepFreeze({ step: "write", attempt: 1, notes });
  if (last.set === null || last.set === undefined || !last.set.complete) {
    return index === 0 ? retry([]) : deepFreeze({ step: "nonresponse", reason: "questions_incomplete" });
  }
  if (last.coverage === null || last.coverage === undefined) return deepFreeze({ step: "judge", attempt: index });
  if (last.coverage.failed === true) return deepFreeze({ step: "nonresponse", reason: "coverage_check_failed" });
  invariant(Array.isArray(last.coverage.quotes) && Array.isArray(last.coverage.notes), "POINTER_REFERENCE_STEP_INPUT_INVALID");
  const byQuote = new Map(last.coverage.quotes.map((quote) => [quote.unit_id, quote]));
  invariant(quoteIds.every((id) => byQuote.has(id)) && byQuote.size === quoteIds.length, "POINTER_REFERENCE_STEP_COVERAGE_MISMATCH");
  if (quoteIds.every((id) => byQuote.get(id).confirmed)) {
    const critical = new Set(quoteIds.flatMap((id) => byQuote.get(id).critical_question_ids));
    return deepFreeze({ step: "complete", attempt: index, questions: last.set.questions.map((item) => ({
      question_id: item.question_id, unit_id: item.unit_id, question: item.question, critical: critical.has(item.question_id) })) });
  }
  if (index === 0) return retry(last.coverage.notes.filter((note) => byQuote.has(note.unit_id)));
  return deepFreeze({ step: "nonresponse", reason: "coverage_unconfirmed" });
}
