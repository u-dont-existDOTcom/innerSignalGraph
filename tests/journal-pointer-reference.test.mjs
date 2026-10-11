import test from "node:test";
import assert from "node:assert/strict";
import { POINTER_COVERAGE_QUOTES_PER_CALL, POINTER_REFERENCE_NONRESPONSE_REASONS, POINTER_REFERENCE_SAMPLE, checkCoverageJudgments,
  checkQuestionSet, checkSearchPlan, coverageJudgeCalls, pointerReferenceSample, referenceUnitStep } from "../src/journal-import/pointer-reference.mjs";

// The measurement's reference step, its mechanical part (plan 2026-10-09-journal-quote-first.md, Part 3). All text here
// is invented.

const QUOTES = ["unit:one", "unit:two"];
const writerAnswer = () => ({
  schema_version: "1.0",
  questions: [
    { unit_id: "unit:one", question: "Who came to stay for the weekend?", critical: false, event: true },
    { unit_id: "unit:one", question: "What was the weather like in the mountains that weekend?", critical: false, event: false },
    { unit_id: "unit:two", question: "Do I want to move back to the mountain village, or did I move?", critical: true, event: false }
  ]
});
const judgment = (unitId, change = {}) => ({ unit_id: unitId, covered: true, missing: "", critical_question_ids: [],
  event_question_ids: [], repeated_question_ids: [], combined_question_ids: [], copied_question_ids: [], ...change });

test("a question set is complete when every quote has a question and every question names one of the unit's quotes", () => {
  const set = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: writerAnswer() });
  assert.equal(set.complete, true);
  assert.deepEqual(set.questions.map((item) => [item.question_id, item.unit_id, item.critical, item.event]), [
    ["question:7:0:0", "unit:one", false, true], ["question:7:0:1", "unit:one", false, false], ["question:7:0:2", "unit:two", true, false]]);
  assert.ok(Object.isFrozen(set) && Object.isFrozen(set.questions[0]));
  // A retry's questions have their own IDs.
  assert.equal(checkQuestionSet({ sampleIndex: 7, attempt: 1, quoteIds: QUOTES, answer: writerAnswer() }).questions[0].question_id,
    "question:7:1:0");

  const withoutTwo = { ...writerAnswer(), questions: writerAnswer().questions.slice(0, 2) };
  assert.deepEqual(checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: withoutTwo }),
    { complete: false, answer_valid: true, questions: [], foreign_questions: 0, quotes_without_question: 1 });
  const foreign = { ...writerAnswer(), questions: [...writerAnswer().questions,
    { unit_id: "unit:three", question: "Where?", critical: false, event: false }] };
  const foreignSet = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: foreign });
  assert.deepEqual([foreignSet.complete, foreignSet.foreign_questions, foreignSet.questions.length], [false, 1, 0]);
  for (const answer of [null, {}, { questions: [] }, { questions: [{ unit_id: "unit:one", question: "", critical: false, event: false }] },
    { questions: [{ unit_id: "unit:one", question: "What happened?", critical: false }] }]) {
    const checked = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer });
    assert.deepEqual([checked.complete, checked.answer_valid, checked.quotes_without_question], [false, false, 2]);
  }
  for (const input of [{ sampleIndex: -1, attempt: 0, quoteIds: QUOTES }, { sampleIndex: 0, attempt: 2, quoteIds: QUOTES },
    { sampleIndex: 0, attempt: 0, quoteIds: [] }, { sampleIndex: 0, attempt: 0, quoteIds: ["unit:one", "unit:one"] }]) {
    assert.throws(() => checkQuestionSet({ ...input, answer: writerAnswer() }), { code: "POINTER_QUESTION_SET_INPUT_INVALID" });
  }
});

test("the coverage judge gets 25 quotes to a call, each with all its questions", () => {
  const quotes = Array.from({ length: 53 }, (_, index) => ({ unit_id: `unit:${index}`, text: `Synthetic quote ${index}.`,
    questions: [{ question_id: `question:${index}:0:0`, question: "What happened?", critical: index % 2 === 0, event: true, extra: "dropped" }] }));
  const calls = coverageJudgeCalls({ quotes });
  assert.equal(POINTER_COVERAGE_QUOTES_PER_CALL, 25);
  assert.deepEqual(calls.map((call) => [call.call_index, call.quotes.length]), [[0, 25], [1, 25], [2, 3]]);
  assert.deepEqual(calls[2].quotes[2], { unit_id: "unit:52", text: "Synthetic quote 52.",
    questions: [{ question_id: "question:52:0:0", question: "What happened?", critical: true, event: true }] });
  assert.deepEqual(coverageJudgeCalls({ quotes: [] }), []);
  assert.throws(() => coverageJudgeCalls({ quotes: [quotes[0], quotes[0]] }), { code: "POINTER_COVERAGE_CALLS_DUPLICATE" });
  assert.throws(() => coverageJudgeCalls({ quotes: [{ ...quotes[0], questions: [] }] }), { code: "POINTER_COVERAGE_CALLS_INPUT_INVALID" });
});

const callQuotes = () => [
  { unit_id: "unit:one", questions: [{ question_id: "question:7:0:0", critical: false, event: true },
    { question_id: "question:7:0:1", critical: false, event: false }] },
  { unit_id: "unit:two", questions: [{ question_id: "question:7:0:2", critical: true, event: false }] }
];

test("code confirms a quote only when the judge says it is covered and lists no repeated, combined or copied question", () => {
  const checked = checkCoverageJudgments({ quotes: callQuotes(), answer: { schema_version: "1.0", judgments: [
    judgment("unit:one", { critical_question_ids: ["question:7:0:1"] }), judgment("unit:two", { event_question_ids: ["question:7:0:2"] })] } });
  assert.equal(checked.valid, true);
  // Marks are the writer's and the judge's together.
  assert.deepEqual(checked.quotes.map((quote) => [quote.unit_id, quote.confirmed, quote.critical_question_ids, quote.event_question_ids]), [
    ["unit:one", true, ["question:7:0:1"], ["question:7:0:0"]], ["unit:two", true, ["question:7:0:2"], ["question:7:0:2"]]]);
  assert.deepEqual(checked.notes, []);

  // Covered, but one question repeats another: not confirmed, and the note goes to the writer's retry.
  const repeated = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one", { repeated_question_ids: ["question:7:0:1"], missing: "two questions ask the same thing" }), judgment("unit:two")] } });
  assert.deepEqual(repeated.quotes.map((quote) => [quote.confirmed, quote.covered, quote.repeated]), [[false, true, 1], [true, true, 0]]);
  assert.deepEqual(repeated.notes, [{ unit_id: "unit:one", missing: "two questions ask the same thing" }]);
  const combined = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one"), judgment("unit:two", { combined_question_ids: ["question:7:0:2"], missing: "one question asks two things" })] } });
  assert.deepEqual(combined.quotes.map((quote) => quote.confirmed), [true, false]);
  // A question that copies its quote's wording would let word search find the quote by its own phrasing.
  const copied = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one", { copied_question_ids: ["question:7:0:0"], missing: "one question copies the quote's turn of phrase" }),
    judgment("unit:two")] } });
  assert.deepEqual(copied.quotes.map((quote) => [quote.confirmed, quote.copied]), [[false, 1], [true, 0]]);
  assert.deepEqual(copied.notes, [{ unit_id: "unit:one", missing: "one question copies the quote's turn of phrase" }]);
  const uncovered = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one", { covered: false, missing: "the call from the workshop" }), judgment("unit:two")] } });
  assert.deepEqual(uncovered.quotes.map((quote) => quote.confirmed), [false, true]);
  // A note on a confirmed quote is ignored.
  assert.equal(checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [judgment("unit:one", { missing: "nothing" }),
    judgment("unit:two")] } }).notes.length, 0);
});

test("a coverage answer that misses a quote, judges one twice or lists another quote's question is invalid", () => {
  const cases = [
    ["answer_invalid", null],
    ["answer_invalid", { judgments: "none" }],
    ["quote_not_judged", { judgments: [judgment("unit:one")] }],
    ["quote_judged_twice", { judgments: [judgment("unit:one"), judgment("unit:one"), judgment("unit:two")] }],
    ["quote_outside_call", { judgments: [judgment("unit:one"), judgment("unit:two"), judgment("unit:three")] }],
    ["question_outside_quote", { judgments: [judgment("unit:one", { critical_question_ids: ["question:7:0:2"] }), judgment("unit:two")] }],
    ["question_outside_quote", { judgments: [judgment("unit:one"), judgment("unit:two", { repeated_question_ids: ["question:7:0:0"] })] }],
    ["question_outside_quote", { judgments: [judgment("unit:one", { copied_question_ids: ["question:7:0:2"], missing: "copied" }), judgment("unit:two")] }],
    ["question_outside_quote", { judgments: [judgment("unit:one", { event_question_ids: ["question:7:0:2"] }), judgment("unit:two")] }],
    ["answer_invalid", { judgments: [judgment("unit:one", { copied_question_ids: undefined }), judgment("unit:two")] }],
    ["answer_invalid", { judgments: [judgment("unit:one", { combined_question_ids: ["question:7:0:0", "question:7:0:0"] }), judgment("unit:two")] }],
    ["answer_invalid", { judgments: [judgment("unit:one", { covered: "yes" }), judgment("unit:two")] }],
    ["unconfirmed_without_note", { judgments: [judgment("unit:one", { covered: false, missing: " " }), judgment("unit:two")] }]
  ];
  for (const [reason, answer] of cases) {
    const checked = checkCoverageJudgments({ quotes: callQuotes(), answer });
    assert.deepEqual([checked.valid, checked.reason, checked.quotes, checked.notes], [false, reason, [], []], reason);
  }
  assert.throws(() => checkCoverageJudgments({ quotes: [], answer: { judgments: [] } }), { code: "POINTER_COVERAGE_CHECK_INPUT_INVALID" });
});

test("a unit gets one writer retry in all, and a unit still incomplete after it is a nonresponse", () => {
  assert.deepEqual(POINTER_REFERENCE_NONRESPONSE_REASONS, ["questions_incomplete", "coverage_unconfirmed", "coverage_check_failed",
    "searches_incomplete", "deadline"]);
  const set = (attempt) => checkQuestionSet({ sampleIndex: 7, attempt, quoteIds: QUOTES, answer: writerAnswer() });
  const incomplete = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: { questions: writerAnswer().questions.slice(0, 1) } });
  const judge = (confirmed, notes = [], marks = {}) => ({ quotes: [
    { unit_id: "unit:one", confirmed: confirmed[0], critical_question_ids: [], event_question_ids: marks.event ?? ["question:7:0:0"] },
    { unit_id: "unit:two", confirmed: confirmed[1], critical_question_ids: marks.critical ?? ["question:7:0:2"], event_question_ids: [] }], notes });
  // Both judges' results, the Codex one first.
  const coverage = (confirmed, notes = []) => [judge(confirmed, notes), judge(confirmed)];
  const step = (attempts) => referenceUnitStep({ quoteIds: QUOTES, attempts });

  assert.deepEqual(step([]), { step: "write", attempt: 0, notes: [] });
  assert.deepEqual(step([{ set: set(0), coverage: null }]), { step: "judge", attempt: 0 });
  // Confirmed at once: the questions, critical when the writer or the judge marked them.
  const done = step([{ set: set(0), coverage: coverage([true, true]) }]);
  assert.equal(done.step, "complete");
  assert.deepEqual(done.questions.map((item) => [item.question_id, item.critical, item.event]), [["question:7:0:0", false, true],
    ["question:7:0:1", false, false], ["question:7:0:2", true, false]]);
  // Either judge's mark counts.
  const marked = step([{ set: set(0), coverage: [judge([true, true], [], { critical: [], event: ["question:7:0:1"] }),
    judge([true, true], [], { event: [] })] }]);
  assert.deepEqual(marked.questions.map((item) => [item.critical, item.event]), [[false, false], [false, true], [true, false]]);
  // One judge's confirmation isn't enough, and the writer's retry gets both judges' notes.
  const codexNote = { unit_id: "unit:two", missing: "the call from the workshop" };
  const claudeNote = { unit_id: "unit:one", missing: "one question copies the quote's turn of phrase" };
  assert.deepEqual(step([{ set: set(0), coverage: [judge([true, false], [codexNote]), judge([false, true], [claudeNote])] }]),
    { step: "write", attempt: 1, notes: [codexNote, claudeNote] });
  assert.deepEqual(step([{ set: set(0), coverage: [judge([true, true]), judge([true, false], [codexNote])] }]).notes, [codexNote]);
  // An incomplete answer, or a failed call, uses the retry without notes.
  assert.deepEqual(step([{ set: incomplete, coverage: null }]), { step: "write", attempt: 1, notes: [] });
  assert.deepEqual(step([{ set: null, coverage: null }]), { step: "write", attempt: 1, notes: [] });
  // An unconfirmed quote uses it with the judge's notes.
  const notes = [{ unit_id: "unit:two", missing: "the call from the workshop" }];
  assert.deepEqual(step([{ set: set(0), coverage: coverage([true, false], notes) }]), { step: "write", attempt: 1, notes });
  // After the retry there is no other: incomplete again, or unconfirmed again, is a nonresponse.
  assert.deepEqual(step([{ set: incomplete, coverage: null }, { set: null, coverage: null }]), { step: "nonresponse", reason: "questions_incomplete" });
  assert.deepEqual(step([{ set: set(0), coverage: coverage([true, false], notes) }, { set: set(1), coverage: coverage([true, false], notes) }]),
    { step: "nonresponse", reason: "coverage_unconfirmed" });
  assert.deepEqual(step([{ set: incomplete, coverage: null }, { set: set(1), coverage: null }]), { step: "judge", attempt: 1 });
  assert.equal(step([{ set: set(0), coverage: coverage([false, true], notes) }, { set: set(1), coverage: coverage([true, true]) }]).step,
    "complete");
  // A judge call that failed after its retry ends the unit: a writer retry can't help it.
  assert.deepEqual(step([{ set: set(0), coverage: [judge([true, true]), { failed: true }] }]), { step: "nonresponse", reason: "coverage_check_failed" });
  // Both judges' results, each for exactly the unit's quotes.
  assert.throws(() => step([{ set: set(0), coverage: [judge([true, true])] }]), { code: "POINTER_REFERENCE_STEP_INPUT_INVALID" });
  assert.throws(() => step([{ set: set(0), coverage: [judge([true, true]), { quotes: judge([true, true]).quotes.slice(0, 1), notes: [] }] }]),
    { code: "POINTER_REFERENCE_STEP_COVERAGE_MISMATCH" });
  assert.throws(() => step([{}, {}, {}]), { code: "POINTER_REFERENCE_STEP_INPUT_INVALID" });
});

// Synthetic quote units: `pages` pages, page n holding (n % 3) + 1 quotes, in journal order.
function quoteUnits(pages, { pageNumbers = true } = {}) {
  const units = [];
  for (let page = 1; page <= pages; page += 1) {
    for (let quote = 0; quote <= page % 3; quote += 1) {
      units.push({ unit_id: `unit:p${page}q${quote}`, page: pageNumbers ? page : null, representation_id: pageNumbers ? "representation:pdf" : `representation:text-${page}`,
        text: `Synthetic paragraph ${quote} of page ${page}.`, source_order: units.length });
    }
  }
  return units;
}

test("the reference sample draws 8 pages from each of 12 stretches, with a recorded seed and each page's quotes", () => {
  assert.deepEqual(POINTER_REFERENCE_SAMPLE, { strata: 12, units_per_stratum: 8 });
  const units = quoteUnits(240);
  const sample = pointerReferenceSample({ units, seed: "synthetic-seed" });
  assert.equal(sample.candidate_units, 240);
  assert.equal(sample.units.length, 96);
  assert.equal(sample.seed_sha256.length, 64);
  assert.equal(JSON.stringify(sample).includes("synthetic-seed"), false, "the seed itself isn't recorded");
  assert.deepEqual([...new Set(sample.units.map((unit) => unit.stratum))].sort((a, b) => a - b), [...Array(12).keys()]);
  for (const unit of sample.units) {
    assert.equal(unit.inclusion_probability, 8 / 20);
    const page = Number(unit.unit_id.slice("page:".length));
    assert.deepEqual(unit.quote_ids, Array.from({ length: (page % 3) + 1 }, (_, quote) => `unit:p${page}q${quote}`));
  }
  // The same seed draws the same sample; another seed another one.
  assert.deepEqual(pointerReferenceSample({ units, seed: "synthetic-seed" }), sample);
  assert.notDeepEqual(pointerReferenceSample({ units, seed: "another-seed" }).units.map((unit) => unit.unit_id), sample.units.map((unit) => unit.unit_id));
  assert.equal(JSON.stringify(sample).includes("Synthetic paragraph"), false, "no quote text");
});

test("a short journal's stretches are taken whole, pages without numbers are their own units, and repeats count once", () => {
  const short = pointerReferenceSample({ units: quoteUnits(30), seed: "synthetic-seed" });
  assert.equal(short.units.length, 30);
  assert.ok(short.units.every((unit) => unit.inclusion_probability === 1));
  const text = pointerReferenceSample({ units: quoteUnits(5, { pageNumbers: false }), seed: "synthetic-seed" });
  assert.equal(text.units.length, 5);
  assert.ok(text.units.every((unit) => /^representation:[0-9a-f]{32}$/.test(unit.unit_id)));
  const units = quoteUnits(4);
  // Page 4's two quotes repeat page 1's two, word for word: the two pages count once.
  const repeated = units.map((unit) => (unit.page === 4 ? { ...unit, text: unit.text.replace("of page 4", "of page 1") } : unit));
  assert.equal(pointerReferenceSample({ units: repeated, seed: "s" }).units.length, 3);
  assert.equal(pointerReferenceSample({ units, seed: "s" }).units.length, 4);
  assert.throws(() => pointerReferenceSample({ units: [], seed: "s" }), { code: "POINTER_REFERENCE_SAMPLE_INPUT_INVALID" });
  assert.throws(() => pointerReferenceSample({ units, seed: "" }), { code: "POINTER_REFERENCE_SAMPLE_INPUT_INVALID" });
});

test("a search plan is complete when every question has one to three searches and nothing else is named", () => {
  const questionIds = ["question:7:0:0", "question:7:0:1"];
  const plan = (searches) => ({ schema_version: "1.0", searches });
  const complete = checkSearchPlan({ questionIds, answer: plan([{ question_id: "question:7:0:1", queries: ["weekend weather"] },
    { question_id: "question:7:0:0", queries: ["visit weekend", "came to stay"] }]) });
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.searches.map((item) => [item.question_id, item.queries.length]), [["question:7:0:0", 2], ["question:7:0:1", 1]]);
  const missing = checkSearchPlan({ questionIds, answer: plan([{ question_id: "question:7:0:0", queries: ["visit"] }]) });
  assert.deepEqual([missing.complete, missing.questions_without_search, missing.searches], [false, 1, []]);
  const foreign = checkSearchPlan({ questionIds, answer: plan([{ question_id: "question:7:0:0", queries: ["visit"] },
    { question_id: "question:7:0:1", queries: ["weather"] }, { question_id: "question:8:0:0", queries: ["other"] }]) });
  assert.deepEqual([foreign.complete, foreign.foreign_or_repeated], [false, 1]);
  const repeated = checkSearchPlan({ questionIds, answer: plan([{ question_id: "question:7:0:0", queries: ["visit"] },
    { question_id: "question:7:0:0", queries: ["stay"] }, { question_id: "question:7:0:1", queries: ["weather"] }]) });
  assert.deepEqual([repeated.complete, repeated.foreign_or_repeated], [false, 1]);
  for (const answer of [null, plan("none"), plan([{ question_id: "question:7:0:0", queries: [] }])]) {
    assert.deepEqual([checkSearchPlan({ questionIds, answer }).answer_valid, checkSearchPlan({ questionIds, answer }).complete], [false, false]);
  }
  assert.throws(() => checkSearchPlan({ questionIds: [], answer: plan([]) }), { code: "POINTER_SEARCH_PLAN_INPUT_INVALID" });
});
