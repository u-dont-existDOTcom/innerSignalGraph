import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { createDeterministicAuditSample } from "./audit.mjs";
import { POINTER_PAGELESS_STRETCH, pointerPagelessStretches } from "./pointer-tags.mjs";

// The measurement's reference step, its mechanical part (plan 2026-10-09-journal-quote-first.md, Part 3, "Questions
// that cover every sampled quote", "Two independent checks that the questions cover each quote" and "No unit drops
// out"). For each sampled unit the question writer writes one question for each thing a quote says; code checks that
// every quote has a question, every question names one of the unit's quotes, and each quote with its questions fits one
// coverage call; two coverage judges, one Codex and one Claude, each see the quotes with their questions, at most 25
// quotes to a call (fewer when the questions are long), and list questions that repeat or combine; code checks which
// questions copy a run of their quote's words; and code, not either judge alone, confirms a quote only when both judges
// do and no question of it copies. A unit gets one writer retry in all, with the judges' and the copy check's notes when
// a quote was left unconfirmed. A unit whose questions are complete but still unconfirmed after the retry counts in
// recall with every question missed (owner decision 30, 12 Oct 2026); any other unit still incomplete after it is a
// nonresponse, which fails the recall floor. A run from before that decision keeps the rules it started with (isCopyRun).
// The model calls and the deadline are the runtime's. Nothing returned for a log or a report holds journal text: notes go
// only into the writer's retry packet.

/** Quotes to a coverage-judge call, at most. */
export const POINTER_COVERAGE_QUOTES_PER_CALL = 25;
/**
 * Characters of quotes and questions to a coverage-judge call, at most, as the call sends them (their JSON): with the
 * role's instruction, schema and the packet's other fields (about 7,000 characters) the call stays within the 450,000
 * characters Claude's route takes (packet-bounds.mjs), whatever the questions' number or length.
 */
export const POINTER_COVERAGE_CALL_CHARS = 400_000;
/**
 * Why a sampled unit ended without its reference. `coverage_unconfirmed` is a reason only in a run from before owner
 * decision 30 (12 Oct 2026), whose rules made a unit still unconfirmed after its retry a nonresponse; in a later run such
 * a unit is `unconfirmed`, and counts in recall with every question missed.
 */
export const POINTER_REFERENCE_NONRESPONSE_REASONS = Object.freeze(["questions_incomplete", "coverage_unconfirmed",
  "coverage_check_failed", "searches_incomplete", "deadline"]);
/** The sample's design: the journal cut into 12 stretches in order, 8 units drawn from each. */
export const POINTER_REFERENCE_SAMPLE = Object.freeze({ strata: 12, units_per_stratum: 8 });
/**
 * The copy check (owner decision 30, 12 Oct 2026): a question copies its quote when it holds this many of the quote's
 * words or more in a row, in the quote's order (spaces, punctuation, accents and case aside: longestSharedRun), so word
 * search could find the quote by its own phrasing and recall would answer itself. A shorter shared run is the plain words anyone would use for what happened ("did I want to move
 * back to the village"), not copying. The run setting `pointer_copy_run_words` can change it, within the limits; the
 * reference step reports how long a run each question shares with its quote, so the setting can be checked against what
 * the question writer actually writes. In a script written without spaces between words (Chinese, Japanese, Thai, Lao,
 * Khmer, Burmese), each letter counts as a word.
 */
export const POINTER_COPY_RUN_WORDS = 8;
export const POINTER_COPY_RUN_LIMITS = Object.freeze({ min: 3, max: 20 });

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

// Scripts written without spaces between words: Chinese, Japanese, Thai, Lao, Khmer and Burmese. There each letter
// counts as a word, so a question that copies a clause still shares a long run with its quote.
const UNSPACED = String.raw`\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}`;
const COPY_WORD = new RegExp(String.raw`(?=[\p{L}\p{N}])[${UNSPACED}]|(?:(?![${UNSPACED}])[\p{L}\p{N}])+`, "gu");
// A text's words as the copy check counts them: runs of letters and digits (single letters, in a script written without
// spaces), lowercased and without accents.
const copyWords = (text) => text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().match(COPY_WORD) ?? [];

/**
 * The longest run of a quote's words, in the quote's order, that a question holds: its length in words, and the run
 * itself as the copy check compares it (the quote's own words, for the writer's retry note only). Only letters and
 * digits are compared, lowercased and without accents: spaces and punctuation are skipped on both sides, so "don't",
 * "dont" and "don t" are the same, and a run counts the quote's words it holds whole.
 */
export function longestSharedRun(quoteText, questionText) {
  invariant(typeof quoteText === "string" && typeof questionText === "string", "POINTER_COPY_CHECK_INPUT_INVALID");
  const words = copyWords(quoteText);
  // The quote's letters in order, each with the word it belongs to, and each word's first and last letter.
  const wordOf = [];
  const first = [];
  const last = [];
  // Where each letter occurs in the quote.
  const places = new Map();
  for (const [word, text] of words.entries()) {
    for (const letter of text) {
      const at = wordOf.length;
      if (first[word] === undefined) first[word] = at;
      last[word] = at;
      wordOf.push(word);
      if (!places.has(letter)) places.set(letter, []);
      places.get(letter).push(at);
    }
  }
  let best = 0;
  let from = 0;
  // For each place in the quote, the length of the shared stretch of letters ending there and at the question's
  // previous letter (`previous`, whose set places are `set`) or at its current one (`current`).
  let previous = new Int32Array(wordOf.length);
  let current = new Int32Array(wordOf.length);
  let set = [];
  for (const letter of copyWords(questionText).join("")) {
    const now = [];
    for (const end of places.get(letter) ?? []) {
      const length = (end > 0 ? previous[end - 1] : 0) + 1;
      current[end] = length;
      now.push(end);
      // The quote's words this stretch holds whole.
      const start = end - length + 1;
      const opening = first[wordOf[start]] === start ? wordOf[start] : wordOf[start] + 1;
      const closing = last[wordOf[end]] === end ? wordOf[end] : wordOf[end] - 1;
      if (closing - opening + 1 > best) {
        best = closing - opening + 1;
        from = opening;
      }
    }
    for (const place of set) previous[place] = 0;
    [previous, current] = [current, previous];
    set = now;
  }
  return { words: best, run: words.slice(from, from + best).join(" ") };
}

// The copy-run setting a step runs under: a length within the limits, or null for a run from before owner decision 30,
// which has no setting and keeps the rules it started with, so that a recount follows it exactly: code flags no
// question, a question a judge lists as copied holds its quote back as a repeated or combined one does, and a unit still
// unconfirmed after its retry is a nonresponse (`coverage_unconfirmed`).
const isCopyRun = (value) => value === null
  || (Number.isSafeInteger(value) && value >= POINTER_COPY_RUN_LIMITS.min && value <= POINTER_COPY_RUN_LIMITS.max);

// The writer's retry note for a quote a question of it copies. It names the run, the quote's own words, and goes only
// into the writer's retry packet.
const copyNote = (copied) => ({ unit_id: copied.unit_id, missing: `Code check: a question repeats ${copied.words} of this quote's words `
  + `in a row ("${copied.run}"). Ask about the same thing in other words, the way a person might later ask.` });

// One quote as a coverage-judge call sends it, with its questions, and the characters it takes there (its JSON).
const sentQuote = (quote) => ({ unit_id: quote.unit_id, text: quote.text,
  questions: quote.questions.map(({ question_id: questionId, question, critical, event }) => ({ question_id: questionId,
    question, critical, event })) });
const sentChars = (sent) => JSON.stringify(sent).length;

/**
 * Checks the question writer's answer for one sampled unit. `quoteIds` are the unit's quotes and `texts` their text
 * (a Map from quote ID); `sampleIndex` is the unit's place in the sample and `attempt` 0 or 1 (its retry), which
 * together make each question's ID, `question:<sampleIndex>:<attempt>:<n>` in the answer's order, unique across the
 * reference and its retries. The set is complete when every question names one of the unit's quotes, every quote has
 * at least one question, and each quote with its questions, exactly as a coverage-judge call sends them (its JSON,
 * escapes and all), fits one call (POINTER_COVERAGE_CALL_CHARS), since a quote's questions are never split across
 * calls; only then are its questions returned, each with the writer's `critical` and `event` marks. Counts say what is
 * wrong otherwise. A set with a quote too long to judge is checked here, before any call, like a set that misses a
 * quote: the unit gets the writer's one retry, and a retry still too long leaves the unit a nonresponse.
 *
 * For a complete set, the copy check: for each question, the longest run of its quote's words it holds
 * (`longest_runs`, in the questions' order, counts only), and `copied`, the questions whose run reaches `copyRunWords`
 * (POINTER_COPY_RUN_WORDS unless the run says otherwise; null, for a run from before the check, flags none). A copying
 * question leaves its quote unconfirmed (referenceUnitStep); `copied` holds the runs for the writer's retry note alone.
 */
export function checkQuestionSet({ sampleIndex, attempt, quoteIds, texts, answer, copyRunWords = POINTER_COPY_RUN_WORDS } = {}) {
  invariant(isCount(sampleIndex) && (attempt === 0 || attempt === 1) && isDistinctIds(quoteIds) && quoteIds.length > 0
    && texts instanceof Map && quoteIds.every((id) => typeof texts.get(id) === "string") && isCopyRun(copyRunWords),
  "POINTER_QUESTION_SET_INPUT_INVALID");
  const shaped = isObject(answer) && Array.isArray(answer.questions) && answer.questions.length > 0
    && answer.questions.every((item) => isObject(item) && isId(item.unit_id) && typeof item.question === "string"
      && item.question.length > 0 && typeof item.critical === "boolean" && typeof item.event === "boolean");
  if (!shaped) {
    return deepFreeze({ complete: false, answer_valid: false, questions: [], foreign_questions: 0,
      quotes_without_question: quoteIds.length, quotes_too_long: 0, longest_runs: [], copied: [] });
  }
  const known = new Set(quoteIds);
  const asked = new Set(answer.questions.map((item) => item.unit_id));
  const foreign = answer.questions.filter((item) => !known.has(item.unit_id)).length;
  const without = quoteIds.filter((id) => !asked.has(id)).length;
  const questions = answer.questions.map((item, index) => ({ question_id: `question:${sampleIndex}:${attempt}:${index}`,
    unit_id: item.unit_id, question: item.question, critical: item.critical, event: item.event }));
  const tooLong = foreign === 0 && without === 0 ? quoteIds.filter((id) => 2 + sentChars(sentQuote({ unit_id: id, text: texts.get(id),
    questions: questions.filter((item) => item.unit_id === id) })) > POINTER_COVERAGE_CALL_CHARS).length : 0;
  const complete = foreign === 0 && without === 0 && tooLong === 0;
  const runs = complete ? questions.map((item) => ({ question_id: item.question_id, unit_id: item.unit_id,
    ...longestSharedRun(texts.get(item.unit_id), item.question) })) : [];
  return deepFreeze({
    complete,
    answer_valid: true,
    questions: complete ? questions : [],
    foreign_questions: foreign,
    quotes_without_question: without,
    quotes_too_long: tooLong,
    longest_runs: runs.map((item) => item.words),
    copied: copyRunWords === null ? [] : runs.filter((item) => item.words >= copyRunWords)
  });
}

const isMarkedQuestion = (item) => isObject(item) && isId(item.question_id) && typeof item.critical === "boolean"
  && typeof item.event === "boolean";

/**
 * A coverage judge's calls: every quote with its questions (`question_id`, `question` and the writer's `critical` and
 * `event` marks), in the order given. A call closes before a quote that would take it past 25 quotes or past
 * POINTER_COVERAGE_CALL_CHARS of quotes and questions as the call sends them. A quote's questions are never split across
 * calls, so each quote must fit a call of its own; checkQuestionSet holds back any set with a quote that doesn't, and a
 * quote that doesn't is refused here rather than sent to a route that would refuse it. Each of the two judges, the Codex
 * one in calls of its own and the Claude one, gets the same calls.
 */
export function coverageJudgeCalls({ quotes } = {}) {
  invariant(Array.isArray(quotes) && quotes.every((quote) => isObject(quote) && isId(quote.unit_id) && typeof quote.text === "string"
    && Array.isArray(quote.questions) && quote.questions.length > 0
    && quote.questions.every((item) => isMarkedQuestion(item) && typeof item.question === "string")),
  "POINTER_COVERAGE_CALLS_INPUT_INVALID");
  invariant(isDistinctIds(quotes.map((quote) => quote.unit_id))
    && isDistinctIds(quotes.flatMap((quote) => quote.questions.map((item) => item.question_id))), "POINTER_COVERAGE_CALLS_DUPLICATE");
  const calls = [];
  let open = null;
  for (const quote of quotes) {
    const sent = sentQuote(quote);
    // The call's quotes as JSON: its brackets, each quote, and a comma between two.
    const chars = sentChars(sent);
    invariant(2 + chars <= POINTER_COVERAGE_CALL_CHARS, "POINTER_COVERAGE_QUOTE_TOO_LARGE");
    if (!open || open.quotes.length >= POINTER_COVERAGE_QUOTES_PER_CALL || open.chars + 1 + chars > POINTER_COVERAGE_CALL_CHARS) {
      open = { call_index: calls.length, quotes: [], chars: 1 };
      calls.push(open);
    }
    open.chars += 1 + chars;
    open.quotes.push(sent);
  }
  return deepFreeze(calls.map((call) => ({ call_index: call.call_index, quotes: call.quotes })));
}

// A quote is confirmed by a judge only when it is covered and no question is listed as repeated or combined. Copying is
// the code's check now (checkQuestionSet), so a question a judge lists as copied is counted but holds nothing back,
// except in a run from before owner decision 30 (copyRunWords null), where it holds the quote back as it did then.
const confirmedBy = (judgment, copyRunWords) => judgment.covered && judgment.repeated_question_ids.length === 0
  && judgment.combined_question_ids.length === 0 && (copyRunWords !== null || judgment.copied_question_ids.length === 0);

/**
 * Checks one coverage judge's answer for one call against the call's quotes. The answer is valid when it judges every
 * quote of the call once and nothing else, every question it lists is one of that quote's, and it says what is wrong
 * with every quote it doesn't confirm; an invalid answer gets the call's one retry. The judge confirms a quote only
 * when it says the quote is covered and lists no question as repeating another or asking about two things. A question
 * it lists as copying the quote's wording is counted (`copied`) and decides nothing: code checks copying (owner decision
 * 30). In a run from before that decision (`copyRunWords` null) it holds the quote back, as it did then. A question is
 * critical, or about an event, when the writer or the judge marks it so. `notes` are the judge's words for the writer's
 * retry packet, and never go into a log or a report.
 */
export function checkCoverageJudgments({ quotes, answer, copyRunWords = POINTER_COPY_RUN_WORDS } = {}) {
  invariant(Array.isArray(quotes) && quotes.length > 0 && quotes.every((quote) => isObject(quote) && isId(quote.unit_id)
    && Array.isArray(quote.questions) && quote.questions.length > 0 && quote.questions.every(isMarkedQuestion))
    && isDistinctIds(quotes.map((quote) => quote.unit_id)) && isCopyRun(copyRunWords), "POINTER_COVERAGE_CHECK_INPUT_INVALID");
  const invalid = (reason) => deepFreeze({ valid: false, reason, quotes: [], notes: [] });
  if (!isObject(answer) || !Array.isArray(answer.judgments)) return invalid("answer_invalid");
  const byQuote = new Map(quotes.map((quote) => [quote.unit_id, quote]));
  const seen = new Set();
  for (const judgment of answer.judgments) {
    if (!isObject(judgment) || !byQuote.has(judgment.unit_id)) return invalid("quote_outside_call");
    if (seen.has(judgment.unit_id)) return invalid("quote_judged_twice");
    seen.add(judgment.unit_id);
    const own = new Set(byQuote.get(judgment.unit_id).questions.map((item) => item.question_id));
    const lists = [judgment.critical_question_ids, judgment.event_question_ids, judgment.repeated_question_ids,
      judgment.combined_question_ids, judgment.copied_question_ids];
    if (typeof judgment.covered !== "boolean" || typeof judgment.missing !== "string" || !lists.every(isDistinctIds)) {
      return invalid("answer_invalid");
    }
    if (!lists.every((list) => list.every((id) => own.has(id)))) return invalid("question_outside_quote");
    if (!confirmedBy(judgment, copyRunWords) && judgment.missing.trim().length === 0) return invalid("unconfirmed_without_note");
  }
  if (seen.size !== quotes.length) return invalid("quote_not_judged");
  const judgmentFor = new Map(answer.judgments.map((judgment) => [judgment.unit_id, judgment]));
  const results = quotes.map((quote) => {
    const judgment = judgmentFor.get(quote.unit_id);
    const judgeCritical = new Set(judgment.critical_question_ids);
    const judgeEvent = new Set(judgment.event_question_ids);
    return {
      unit_id: quote.unit_id,
      confirmed: confirmedBy(judgment, copyRunWords),
      covered: judgment.covered,
      repeated: judgment.repeated_question_ids.length,
      combined: judgment.combined_question_ids.length,
      copied: judgment.copied_question_ids.length,
      critical_question_ids: quote.questions.filter((item) => item.critical || judgeCritical.has(item.question_id))
        .map((item) => item.question_id),
      event_question_ids: quote.questions.filter((item) => item.event || judgeEvent.has(item.question_id))
        .map((item) => item.question_id)
    };
  });
  return deepFreeze({
    valid: true,
    reason: null,
    quotes: results,
    notes: results.filter((result) => !result.confirmed)
      .map((result) => ({ unit_id: result.unit_id, missing: judgmentFor.get(result.unit_id).missing }))
  });
}

/**
 * Where a sampled unit's reference stands, from its writer attempts so far, oldest first. Each attempt holds `set`, its
 * checkQuestionSet result (null when the writer's call failed after its own retry), and `coverage`, null until both
 * coverage judges have answered for all of the unit's quotes, then the two judges' results: each either
 * { failed: true } (a call failed after its retry) or { quotes, notes } gathered from checkCoverageJudgments for this
 * unit's quotes. A quote is confirmed only when both judges confirm it and the copy check finds no question of it that
 * copies (the set's `copied`). Returns the next step: `write` (attempt 0, or the unit's one retry, with both judges'
 * notes and the copy check's when a quote was left unconfirmed), `judge`, `complete` (with the questions, each critical
 * or about an event when the writer or either judge marked it so), `unconfirmed` (owner decision 30: the retry's
 * questions are complete and both judges answered, but a quote is still unconfirmed; the questions, marked the same way,
 * count in recall with every one missed; in a run from before that decision, `copyRunWords` null, such a unit is a
 * nonresponse, `coverage_unconfirmed`, as it was then) or `nonresponse` (with its reason).
 */
export function referenceUnitStep({ quoteIds, attempts, copyRunWords = POINTER_COPY_RUN_WORDS } = {}) {
  invariant(isDistinctIds(quoteIds) && quoteIds.length > 0 && Array.isArray(attempts) && attempts.length <= 2
    && attempts.every((attempt) => isObject(attempt)) && isCopyRun(copyRunWords), "POINTER_REFERENCE_STEP_INPUT_INVALID");
  if (attempts.length === 0) return deepFreeze({ step: "write", attempt: 0, notes: [] });
  const index = attempts.length - 1;
  const last = attempts[index];
  // The unit's one retry, used by whichever falls short first: the writer's answer or the coverage check.
  const retry = (notes) => deepFreeze({ step: "write", attempt: 1, notes });
  if (last.set === null || last.set === undefined || !last.set.complete) {
    return index === 0 ? retry([]) : deepFreeze({ step: "nonresponse", reason: "questions_incomplete" });
  }
  if (last.coverage === null || last.coverage === undefined) return deepFreeze({ step: "judge", attempt: index });
  invariant(Array.isArray(last.coverage) && last.coverage.length === 2 && last.coverage.every(isObject),
    "POINTER_REFERENCE_STEP_INPUT_INVALID");
  if (last.coverage.some((judge) => judge.failed === true)) return deepFreeze({ step: "nonresponse", reason: "coverage_check_failed" });
  const judges = last.coverage.map((judge) => {
    invariant(Array.isArray(judge.quotes) && Array.isArray(judge.notes), "POINTER_REFERENCE_STEP_INPUT_INVALID");
    const byQuote = new Map(judge.quotes.map((quote) => [quote.unit_id, quote]));
    invariant(quoteIds.every((id) => byQuote.has(id)) && byQuote.size === quoteIds.length, "POINTER_REFERENCE_STEP_COVERAGE_MISMATCH");
    return { byQuote, notes: judge.notes.filter((note) => byQuote.has(note.unit_id)) };
  });
  // The questions with their marks: critical, or about an event, when the writer or either judge marked them so.
  const marked = (field) => new Set(judges.flatMap((judge) => quoteIds.flatMap((id) => judge.byQuote.get(id)[field])));
  const critical = marked("critical_question_ids");
  const event = marked("event_question_ids");
  const questions = () => last.set.questions.map((item) => ({ question_id: item.question_id, unit_id: item.unit_id,
    question: item.question, critical: critical.has(item.question_id), event: event.has(item.question_id) }));
  // The copy check's first copying question for each quote that has one.
  const copied = new Map();
  for (const item of last.set.copied ?? []) if (quoteIds.includes(item.unit_id) && !copied.has(item.unit_id)) copied.set(item.unit_id, item);
  if (quoteIds.every((id) => judges.every((judge) => judge.byQuote.get(id).confirmed) && !copied.has(id))) {
    return deepFreeze({ step: "complete", attempt: index, questions: questions() });
  }
  if (index === 0) return retry([...judges.flatMap((judge) => judge.notes), ...[...copied.values()].map(copyNote)]);
  if (copyRunWords === null) return deepFreeze({ step: "nonresponse", reason: "coverage_unconfirmed" });
  return deepFreeze({ step: "unconfirmed", attempt: index, questions: questions() });
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// The units the sample is drawn from, each with its quotes in journal order, ordered by their first quote. A unit is a
// page; in a representation without page numbers (a plain-text journal is one) it is a stretch of consecutive quotes
// (pointerPagelessStretches, the pass's pages there too), so no unit holds more than about a page and no question
// writer's answer has to cover a whole journal. A page holding more than a stretch may, more than 40 quotes (a dense
// page of short date headings, say) or more than 4 KB of their text, is cut the same way, into parts of consecutive
// quotes. Every unit then holds at most 40 quotes and 4 KB of their text, or a single longer quote, so its questions,
// one for each thing each of its quotes says, fit one answer of at most 800, one for every five bytes of text. The
// challenge set names its units the same way.
function samplingUnits(quotes) {
  const units = new Map();
  const stretches = pointerPagelessStretches(quotes);
  const ordered = [...quotes].sort((left, right) => left.source_order - right.source_order);
  // Each page's parts, cut like stretches: a part closes before a quote that would take it past either bound.
  const parts = new Map();
  const open = new Map();
  for (const quote of ordered) {
    if (!Number.isSafeInteger(quote.page)) continue;
    const bytes = Number.isSafeInteger(quote.utf8_byte_length) ? quote.utf8_byte_length : Buffer.byteLength(quote.text, "utf8");
    let part = open.get(quote.page);
    if (!part || part.bytes + bytes > POINTER_PAGELESS_STRETCH.bytes || part.quotes >= POINTER_PAGELESS_STRETCH.quotes) {
      part = { index: part ? part.index + 1 : 0, bytes: 0, quotes: 0 };
      open.set(quote.page, part);
    }
    part.bytes += bytes;
    part.quotes += 1;
    parts.set(quote.unit_id, part.index);
  }
  const pageUnit = (quote) => (open.get(quote.page).index === 0 ? `page:${quote.page}` : `page:${quote.page}:${parts.get(quote.unit_id)}`);
  for (const quote of ordered) {
    const unitId = Number.isSafeInteger(quote.page) ? pageUnit(quote)
      : `representation:${sha256(quote.representation_id).slice(0, 32)}:${stretches.get(quote.unit_id)}`;
    if (!units.has(unitId)) units.set(unitId, { unit_id: unitId, source_order: quote.source_order, quotes: [] });
    units.get(unitId).quotes.push(quote);
  }
  return units;
}

/**
 * The reference sample (plan Part 3, "A random sample of the journal"): the import's probability sample
 * (`createDeterministicAuditSample`), drawn with a recorded seed from every unit that has quotes. A unit is a page, or
 * in a representation without page numbers a stretch of about a page (samplingUnits), and its quotes are the quote
 * units in it, in journal order; units are ordered by their first quote, and units with the same quotes count once. Returns the sample's record (the seed's
 * digest, never the seed) and the sampled units in draw order, each with its stretch, inclusion probability and quote
 * IDs. Quote text stays out of it.
 */
export function pointerReferenceSample({ units, seed, strata = POINTER_REFERENCE_SAMPLE.strata,
  unitsPerStratum = POINTER_REFERENCE_SAMPLE.units_per_stratum } = {}) {
  invariant(Array.isArray(units) && units.length > 0 && units.every((unit) => isObject(unit) && isId(unit.unit_id)
    && typeof unit.text === "string" && Number.isSafeInteger(unit.source_order)
    && (unit.page === null || unit.page === undefined || Number.isSafeInteger(unit.page))
    && typeof unit.representation_id === "string" && unit.representation_id.length > 0), "POINTER_REFERENCE_SAMPLE_INPUT_INVALID");
  invariant(typeof seed === "string" && seed.length > 0, "POINTER_REFERENCE_SAMPLE_INPUT_INVALID");
  const pages = samplingUnits(units);
  const candidates = [...pages.values()].map((page) => ({ unit_id: page.unit_id, source_order: page.source_order,
    duplicate_group_id: `duplicate:${sha256(page.quotes.map((quote) => quote.text).join("\u0000"))}` }));
  const sample = createDeterministicAuditSample({ units: candidates, seed, strata, unitsPerStratum });
  const sampled = sample.inclusion_ledger.map((entry) => Object.freeze({ unit_id: entry.unit_id, stratum: entry.stratum,
    inclusion_probability: entry.inclusion_probability, quote_ids: Object.freeze(pages.get(entry.unit_id).quotes.map((quote) => quote.unit_id)) }));
  return Object.freeze({
    seed_sha256: sample.seed_sha256,
    strata: sample.strata,
    units_per_stratum: sample.units_per_stratum,
    candidate_units: candidates.length,
    units: Object.freeze(sampled)
  });
}

/**
 * Calibration's units as a challenge set (plan Part 3, "Calibration as a challenge set"): the sampling units the
 * import's calibration units lie on, each once, with its quotes in journal order, the hazard types of the calibration
 * units on it, and an inclusion probability of 1, since they were chosen, not drawn. A calibration unit lies on the
 * quotes of its own representation: on its page where they have page numbers, and where they have none (a plain-text
 * journal, or a page's visual transcription, which has no page entry of its own whatever page it transcribes) on every
 * stretch (samplingUnits) holding a quote that overlaps its bytes. One whose representation has no quote there yet (a
 * page that needs visual reading) is counted and left out, as in the random sample, rather than taking another
 * representation's quotes. `calibration` gives each calibration unit's representation, page number or byte range, and
 * hazard types; nothing of its text. The result has the reference step's sample shape, so the same step writes and
 * checks its questions.
 */
export function pointerChallengeUnits({ units, calibration } = {}) {
  const isRange = (value) => Number.isSafeInteger(value.start_byte) && Number.isSafeInteger(value.end_byte)
    && value.start_byte >= 0 && value.start_byte < value.end_byte;
  invariant(Array.isArray(units) && units.every((unit) => isObject(unit) && isId(unit.unit_id) && Number.isSafeInteger(unit.source_order)
    && typeof unit.representation_id === "string" && unit.representation_id.length > 0
    && (Number.isSafeInteger(unit.page) ? typeof unit.text === "string" || Number.isSafeInteger(unit.utf8_byte_length)
      : typeof unit.text === "string" && isRange(unit))), "POINTER_CHALLENGE_INPUT_INVALID");
  invariant(Array.isArray(calibration) && calibration.every((item) => isObject(item) && typeof item.unit_id === "string"
    && typeof item.representation_id === "string" && item.representation_id.length > 0
    && (Number.isSafeInteger(item.page_number) || isRange(item))
    && (item.hazard_types === undefined || (Array.isArray(item.hazard_types) && item.hazard_types.every((hazard) => typeof hazard === "string")))),
  "POINTER_CHALLENGE_INPUT_INVALID");
  const sampling = samplingUnits(units);
  const unitOfQuote = new Map([...sampling.values()].flatMap((unit) => unit.quotes.map((quote) => [quote.unit_id, unit.unit_id])));
  const quotesOf = new Map();
  for (const quote of units) {
    if (!quotesOf.has(quote.representation_id)) quotesOf.set(quote.representation_id, []);
    quotesOf.get(quote.representation_id).push(quote);
  }
  const overlaps = (quote, item) => isRange(quote) && isRange(item) && quote.start_byte < item.end_byte && quote.end_byte > item.start_byte;
  const lies = (quote, item) => (Number.isSafeInteger(quote.page)
    ? (Number.isSafeInteger(item.page_number) ? quote.page === item.page_number : overlaps(quote, item))
    : (isRange(item) ? overlaps(quote, item) : true));
  const lyingOn = (item) => [...new Set((quotesOf.get(item.representation_id) ?? []).filter((quote) => lies(quote, item))
    .map((quote) => unitOfQuote.get(quote.unit_id)))];
  const chosen = new Map();
  let withoutQuotes = 0;
  for (const item of calibration) {
    const unitIds = lyingOn(item);
    if (unitIds.length === 0) {
      withoutQuotes += 1;
      continue;
    }
    for (const unitId of unitIds) {
      if (!chosen.has(unitId)) chosen.set(unitId, new Set());
      for (const hazard of item.hazard_types ?? []) chosen.get(unitId).add(hazard);
    }
  }
  const ordered = [...chosen.keys()].sort((left, right) => sampling.get(left).source_order - sampling.get(right).source_order);
  return deepFreeze({
    calibration_units: calibration.length,
    units_without_quotes: withoutQuotes,
    candidate_units: ordered.length,
    units: ordered.map((unitId) => ({ unit_id: unitId, stratum: 0, inclusion_probability: 1,
      quote_ids: sampling.get(unitId).quotes.map((quote) => quote.unit_id), hazards: [...chosen.get(unitId)].sort() }))
  });
}

/**
 * Checks the search writer's answer for one sampled unit: one entry for each of its questions, naming only its
 * questions, each with one to three searches. Only a complete plan's searches are returned.
 */
export function checkSearchPlan({ questionIds, answer } = {}) {
  invariant(isDistinctIds(questionIds) && questionIds.length > 0, "POINTER_SEARCH_PLAN_INPUT_INVALID");
  const shaped = isObject(answer) && Array.isArray(answer.searches) && answer.searches.every((item) => isObject(item)
    && isId(item.question_id) && Array.isArray(item.queries) && item.queries.length >= 1 && item.queries.length <= 3
    && item.queries.every((query) => typeof query === "string" && query.length > 0));
  if (!shaped) return deepFreeze({ complete: false, answer_valid: false, searches: [], questions_without_search: questionIds.length, foreign_or_repeated: 0 });
  const known = new Set(questionIds);
  const seen = new Set();
  let foreignOrRepeated = 0;
  for (const item of answer.searches) {
    if (!known.has(item.question_id) || seen.has(item.question_id)) foreignOrRepeated += 1;
    seen.add(item.question_id);
  }
  const without = questionIds.filter((id) => !seen.has(id)).length;
  const complete = without === 0 && foreignOrRepeated === 0;
  const byQuestion = new Map(answer.searches.map((item) => [item.question_id, item.queries]));
  return deepFreeze({
    complete,
    answer_valid: true,
    searches: complete ? questionIds.map((questionId) => ({ question_id: questionId, queries: [...byQuestion.get(questionId)] })) : [],
    questions_without_search: without,
    foreign_or_repeated: foreignOrRepeated
  });
}
