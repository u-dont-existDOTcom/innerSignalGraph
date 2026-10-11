import test from "node:test";
import assert from "node:assert/strict";
import { POINTER_COVERAGE_QUOTES_PER_CALL, POINTER_REFERENCE_NONRESPONSE_REASONS, checkCoverageJudgments, checkQuestionSet,
  coverageJudgeCalls, referenceUnitStep } from "../src/journal-import/pointer-reference.mjs";

// The measurement's reference step, its mechanical part (plan 2026-10-09-journal-quote-first.md, Part 3). All text here
// is invented.

const QUOTES = ["unit:one", "unit:two"];
const writerAnswer = () => ({
  schema_version: "1.0",
  questions: [
    { unit_id: "unit:one", question: "Who came to stay for the weekend?", critical: false },
    { unit_id: "unit:one", question: "What was the weather like in the mountains that weekend?", critical: false },
    { unit_id: "unit:two", question: "Do I want to move back to the mountain village, or did I move?", critical: true }
  ]
});
const judgment = (unitId, change = {}) => ({ unit_id: unitId, covered: true, missing: "", critical_question_ids: [],
  repeated_question_ids: [], combined_question_ids: [], ...change });

test("a question set is complete when every quote has a question and every question names one of the unit's quotes", () => {
  const set = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: writerAnswer() });
  assert.equal(set.complete, true);
  assert.deepEqual(set.questions.map((item) => [item.question_id, item.unit_id, item.critical]), [
    ["question:7:0:0", "unit:one", false], ["question:7:0:1", "unit:one", false], ["question:7:0:2", "unit:two", true]]);
  assert.ok(Object.isFrozen(set) && Object.isFrozen(set.questions[0]));
  // A retry's questions have their own IDs.
  assert.equal(checkQuestionSet({ sampleIndex: 7, attempt: 1, quoteIds: QUOTES, answer: writerAnswer() }).questions[0].question_id,
    "question:7:1:0");

  const withoutTwo = { ...writerAnswer(), questions: writerAnswer().questions.slice(0, 2) };
  assert.deepEqual(checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: withoutTwo }),
    { complete: false, answer_valid: true, questions: [], foreign_questions: 0, quotes_without_question: 1 });
  const foreign = { ...writerAnswer(), questions: [...writerAnswer().questions, { unit_id: "unit:three", question: "Where?", critical: false }] };
  const foreignSet = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: foreign });
  assert.deepEqual([foreignSet.complete, foreignSet.foreign_questions, foreignSet.questions.length], [false, 1, 0]);
  for (const answer of [null, {}, { questions: [] }, { questions: [{ unit_id: "unit:one", question: "", critical: false }] }]) {
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
    questions: [{ question_id: `question:${index}:0:0`, question: "What happened?", critical: index % 2 === 0, extra: "dropped" }] }));
  const calls = coverageJudgeCalls({ quotes });
  assert.equal(POINTER_COVERAGE_QUOTES_PER_CALL, 25);
  assert.deepEqual(calls.map((call) => [call.call_index, call.quotes.length]), [[0, 25], [1, 25], [2, 3]]);
  assert.deepEqual(calls[2].quotes[2], { unit_id: "unit:52", text: "Synthetic quote 52.",
    questions: [{ question_id: "question:52:0:0", question: "What happened?", critical: true }] });
  assert.deepEqual(coverageJudgeCalls({ quotes: [] }), []);
  assert.throws(() => coverageJudgeCalls({ quotes: [quotes[0], quotes[0]] }), { code: "POINTER_COVERAGE_CALLS_DUPLICATE" });
  assert.throws(() => coverageJudgeCalls({ quotes: [{ ...quotes[0], questions: [] }] }), { code: "POINTER_COVERAGE_CALLS_INPUT_INVALID" });
});

const callQuotes = () => [
  { unit_id: "unit:one", questions: [{ question_id: "question:7:0:0", critical: false }, { question_id: "question:7:0:1", critical: false }] },
  { unit_id: "unit:two", questions: [{ question_id: "question:7:0:2", critical: true }] }
];

test("code confirms a quote only when the judge says it is covered and lists no repeated or combined question", () => {
  const checked = checkCoverageJudgments({ quotes: callQuotes(), answer: { schema_version: "1.0", judgments: [
    judgment("unit:one", { critical_question_ids: ["question:7:0:1"] }), judgment("unit:two")] } });
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.quotes.map((quote) => [quote.unit_id, quote.confirmed, quote.critical_question_ids]), [
    ["unit:one", true, ["question:7:0:1"]], ["unit:two", true, ["question:7:0:2"]]]);
  assert.deepEqual(checked.notes, []);

  // Covered, but one question repeats another: not confirmed, and the note goes to the writer's retry.
  const repeated = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one", { repeated_question_ids: ["question:7:0:1"], missing: "two questions ask the same thing" }), judgment("unit:two")] } });
  assert.deepEqual(repeated.quotes.map((quote) => [quote.confirmed, quote.covered, quote.repeated]), [[false, true, 1], [true, true, 0]]);
  assert.deepEqual(repeated.notes, [{ unit_id: "unit:one", missing: "two questions ask the same thing" }]);
  const combined = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one"), judgment("unit:two", { combined_question_ids: ["question:7:0:2"], missing: "one question asks two things" })] } });
  assert.deepEqual(combined.quotes.map((quote) => quote.confirmed), [true, false]);
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
  assert.deepEqual(POINTER_REFERENCE_NONRESPONSE_REASONS, ["questions_incomplete", "coverage_unconfirmed", "coverage_check_failed", "deadline"]);
  const set = (attempt) => checkQuestionSet({ sampleIndex: 7, attempt, quoteIds: QUOTES, answer: writerAnswer() });
  const incomplete = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, answer: { questions: writerAnswer().questions.slice(0, 1) } });
  const coverage = (confirmed, notes = []) => ({ quotes: [
    { unit_id: "unit:one", confirmed: confirmed[0], critical_question_ids: [] },
    { unit_id: "unit:two", confirmed: confirmed[1], critical_question_ids: ["question:7:0:2"] }], notes });
  const step = (attempts) => referenceUnitStep({ quoteIds: QUOTES, attempts });

  assert.deepEqual(step([]), { step: "write", attempt: 0, notes: [] });
  assert.deepEqual(step([{ set: set(0), coverage: null }]), { step: "judge", attempt: 0 });
  // Confirmed at once: the questions, critical when the writer or the judge marked them.
  const done = step([{ set: set(0), coverage: coverage([true, true]) }]);
  assert.equal(done.step, "complete");
  assert.deepEqual(done.questions.map((item) => [item.question_id, item.critical]), [["question:7:0:0", false], ["question:7:0:1", false],
    ["question:7:0:2", true]]);
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
  assert.deepEqual(step([{ set: set(0), coverage: { failed: true } }]), { step: "nonresponse", reason: "coverage_check_failed" });
  // The coverage must be for exactly the unit's quotes.
  assert.throws(() => step([{ set: set(0), coverage: { quotes: coverage([true, true]).quotes.slice(0, 1), notes: [] } }]),
    { code: "POINTER_REFERENCE_STEP_COVERAGE_MISMATCH" });
  assert.throws(() => step([{}, {}, {}]), { code: "POINTER_REFERENCE_STEP_INPUT_INVALID" });
});
