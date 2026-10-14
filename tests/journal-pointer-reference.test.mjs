import test from "node:test";
import assert from "node:assert/strict";
import { POINTER_COPY_RUN_LIMITS, POINTER_COPY_RUN_WORDS, POINTER_COVERAGE_CALL_CHARS, POINTER_COVERAGE_QUOTES_PER_CALL,
  POINTER_REFERENCE_NONRESPONSE_REASONS, POINTER_REFERENCE_SAMPLE, checkCoverageJudgments, checkQuestionSet, checkSearchPlan, coverageJudgeCalls,
  longestSharedRun, pointerChallengeUnits, pointerReferenceSample, referenceUnitStep } from "../src/journal-import/pointer-reference.mjs";
import { POINTER_PAGELESS_STRETCH } from "../src/journal-import/pointer-tags.mjs";
import { MAX_HARDEST_PACKET_CHARS, hardestJournalPacketFits } from "../src/journal-import/packet-bounds.mjs";
import { JOURNAL_ROLE_DEFINITIONS, buildJournalRolePacket } from "../src/journal-import/provider-port.mjs";

// The measurement's reference step, its mechanical part (plan 2026-10-09-journal-quote-first.md, Part 3). All text here
// is invented.

const QUOTES = ["unit:one", "unit:two"];
const TEXTS = new Map([["unit:one", "My sister came for the weekend; it rained in the mountains."], ["unit:two", "I want to move back to the village."]]);
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
  const set = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, texts: TEXTS, answer: writerAnswer() });
  assert.equal(set.complete, true);
  assert.deepEqual(set.questions.map((item) => [item.question_id, item.unit_id, item.critical, item.event]), [
    ["question:7:0:0", "unit:one", false, true], ["question:7:0:1", "unit:one", false, false], ["question:7:0:2", "unit:two", true, false]]);
  assert.ok(Object.isFrozen(set) && Object.isFrozen(set.questions[0]));
  // A retry's questions have their own IDs.
  assert.equal(checkQuestionSet({ sampleIndex: 7, attempt: 1, quoteIds: QUOTES, texts: TEXTS, answer: writerAnswer() }).questions[0].question_id,
    "question:7:1:0");

  const withoutTwo = { ...writerAnswer(), questions: writerAnswer().questions.slice(0, 2) };
  assert.deepEqual(checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, texts: TEXTS, answer: withoutTwo }),
    { complete: false, answer_valid: true, questions: [], foreign_questions: 0, quotes_without_question: 1, quotes_too_long: 0,
      longest_runs: [], copied: [] });
  const foreign = { ...writerAnswer(), questions: [...writerAnswer().questions,
    { unit_id: "unit:three", question: "Where?", critical: false, event: false }] };
  const foreignSet = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, texts: TEXTS, answer: foreign });
  assert.deepEqual([foreignSet.complete, foreignSet.foreign_questions, foreignSet.questions.length], [false, 1, 0]);
  for (const answer of [null, {}, { questions: [] }, { questions: [{ unit_id: "unit:one", question: "", critical: false, event: false }] },
    { questions: [{ unit_id: "unit:one", question: "What happened?", critical: false }] }]) {
    const checked = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, texts: TEXTS, answer });
    assert.deepEqual([checked.complete, checked.answer_valid, checked.quotes_without_question], [false, false, 2]);
  }
  for (const input of [{ sampleIndex: -1, attempt: 0, quoteIds: QUOTES, texts: TEXTS }, { sampleIndex: 0, attempt: 2, quoteIds: QUOTES, texts: TEXTS },
    { sampleIndex: 0, attempt: 0, quoteIds: [], texts: TEXTS }, { sampleIndex: 0, attempt: 0, quoteIds: ["unit:one", "unit:one"], texts: TEXTS },
    { sampleIndex: 0, attempt: 0, quoteIds: QUOTES }, { sampleIndex: 0, attempt: 0, quoteIds: QUOTES, texts: new Map([["unit:one", "Text."]]) }]) {
    assert.throws(() => checkQuestionSet({ ...input, answer: writerAnswer() }), { code: "POINTER_QUESTION_SET_INPUT_INVALID" });
  }
});

test("a question set with a quote too long to judge in one call is held back before any call, so the unit gets its retry", () => {
  // One quote with 800 questions of 400 characters: plain, it fits a call; with 100 double quotes in each question,
  // which the call escapes, it doesn't.
  const text = new Map([["unit:one", "t".repeat(1600)]]);
  const answer = (question) => ({ schema_version: "1.0", questions: Array.from({ length: 800 }, () => ({ unit_id: "unit:one", question,
    critical: false, event: false })) });
  const plain = checkQuestionSet({ sampleIndex: 999, attempt: 1, quoteIds: ["unit:one"], texts: text, answer: answer("q".repeat(400)) });
  assert.deepEqual([plain.complete, plain.quotes_too_long, plain.questions.length], [true, 0, 800]);
  const escaped = checkQuestionSet({ sampleIndex: 999, attempt: 1, quoteIds: ["unit:one"], texts: text,
    answer: answer(`${"q".repeat(300)}${'"'.repeat(100)}`) });
  assert.deepEqual([escaped.complete, escaped.answer_valid, escaped.quotes_too_long, escaped.questions.length], [false, true, 1, 0]);
  // The plain set's quote fits one call, and that call fits Claude's packet limit; the escaped one, past both limits, is
  // refused rather than sent.
  const quote = (set) => ({ unit_id: "unit:one", text: text.get("unit:one"), questions: set.questions.map((item) => ({ question_id: item.question_id,
    question: item.question, critical: item.critical, event: item.event })) });
  const calls = coverageJudgeCalls({ quotes: [quote(plain)] });
  assert.equal(calls.length, 1);
  assert.equal(hardestJournalPacketFits("coverage_judge", coveragePacket(calls[0].quotes)), true);
  const escapedQuote = { ...quote(plain), questions: quote(plain).questions.map((item) => ({ ...item, question: `${"q".repeat(300)}${'"'.repeat(100)}` })) };
  assert.ok(JSON.stringify([escapedQuote]).length > POINTER_COVERAGE_CALL_CHARS);
  assert.equal(hardestJournalPacketFits("coverage_judge", coveragePacket([escapedQuote])), false);
  assert.throws(() => coverageJudgeCalls({ quotes: [escapedQuote] }), { code: "POINTER_COVERAGE_QUOTE_TOO_LARGE" });
  // A set held back this way is an incomplete set: the unit's one retry, then a nonresponse.
  assert.deepEqual(referenceUnitStep({ quoteIds: ["unit:one"], attempts: [{ set: escaped, coverage: null }] }), { step: "write", attempt: 1, notes: [] });
  assert.deepEqual(referenceUnitStep({ quoteIds: ["unit:one"], attempts: [{ set: escaped, coverage: null }, { set: escaped, coverage: null }] }),
    { step: "nonresponse", reason: "questions_incomplete" });
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

// A coverage call's packet as the reference step sends it (pointer-steps.mjs), with the longest IDs and names it can have.
const coveragePacket = (quotes) => buildJournalRolePacket("coverage_judge", { protocol_version: "1.0",
  output_schema_id: JOURNAL_ROLE_DEFINITIONS.coverage_judge.outputSchema, assigned_core_ids: quotes.map((quote) => quote.unit_id),
  source_locators: [], expected_generation: `generation:${"g".repeat(150)}`, controller_provenance_tag: `pointer:coverage_judge:${"s".repeat(120)}`,
  grant_purpose: "organize_search", quotes });
// `count` quotes of 1,600 characters, each with `questions` questions of 400 characters and the longest unit IDs.
const heavyQuotes = (count, questions) => Array.from({ length: count }, (_, index) => ({ unit_id: `unit:${String(index).padStart(155, "0")}`,
  text: "t".repeat(1600), questions: Array.from({ length: questions }, (_, item) => ({ question_id: `question:999:1:${index}:${item}`,
    question: "q".repeat(400), critical: false, event: false })) }));

test("a coverage call closes at 25 quotes or 400,000 characters, so every call fits Claude's packet limit", () => {
  assert.equal(POINTER_COVERAGE_CALL_CHARS, 400_000);
  // 24 quotes with 100 long questions each, about 50,000 characters a quote: by count alone one call, far past the limit.
  const dense = heavyQuotes(24, 100);
  assert.ok(JSON.stringify(dense).length > MAX_HARDEST_PACKET_CHARS);
  const calls = coverageJudgeCalls({ quotes: dense });
  assert.deepEqual(calls.map((call) => call.quotes.length), [7, 7, 7, 3]);
  assert.deepEqual(calls.flatMap((call) => call.quotes.map((quote) => quote.unit_id)), dense.map((quote) => quote.unit_id));
  for (const call of calls) {
    assert.ok(call.quotes.length <= 25 && JSON.stringify(call.quotes).length <= POINTER_COVERAGE_CALL_CHARS);
    assert.equal(hardestJournalPacketFits("coverage_judge", coveragePacket(call.quotes)), true);
  }
  // Each call is filled before the next opens: one more quote would have passed the limit.
  for (const [index, call] of calls.slice(0, -1).entries()) {
    assert.ok(JSON.stringify([...call.quotes, calls[index + 1].quotes[0]]).length > POINTER_COVERAGE_CALL_CHARS);
  }
  // One quote with as many questions as a unit may have, each as long as a question may be, fits a call of its own.
  const one = coverageJudgeCalls({ quotes: heavyQuotes(1, 800) });
  assert.equal(one.length, 1);
  assert.ok(JSON.stringify(one[0].quotes).length <= POINTER_COVERAGE_CALL_CHARS);
  assert.equal(hardestJournalPacketFits("coverage_judge", coveragePacket(one[0].quotes)), true);
  assert.ok(MAX_HARDEST_PACKET_CHARS - POINTER_COVERAGE_CALL_CHARS >= 20_000);
});

const callQuotes = () => [
  { unit_id: "unit:one", questions: [{ question_id: "question:7:0:0", critical: false, event: true },
    { question_id: "question:7:0:1", critical: false, event: false }] },
  { unit_id: "unit:two", questions: [{ question_id: "question:7:0:2", critical: true, event: false }] }
];

test("code confirms a quote only when the judge says it is covered and lists no repeated or combined question", () => {
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
  // Copying is the code's check now (owner decision 30): a question the judge lists as copied is counted and holds
  // nothing back, so the quote is confirmed and no note goes to the writer.
  const copied = checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one", { copied_question_ids: ["question:7:0:0"], missing: "one question copies the quote's turn of phrase" }),
    judgment("unit:two")] } });
  assert.deepEqual(copied.quotes.map((quote) => [quote.confirmed, quote.copied]), [[true, 1], [true, 0]]);
  assert.deepEqual(copied.notes, []);
  assert.equal(checkCoverageJudgments({ quotes: callQuotes(), answer: { judgments: [
    judgment("unit:one", { copied_question_ids: ["question:7:0:0"] }), judgment("unit:two")] } }).valid, true, "a confirmed quote needs no note");
  // In a run from before that decision (no copy-run setting), a copied question holds its quote back as it did then, so
  // a recount of such a run follows it: the note goes to the writer, and an answer without one is invalid.
  const before = checkCoverageJudgments({ quotes: callQuotes(), copyRunWords: null, answer: { judgments: [
    judgment("unit:one", { copied_question_ids: ["question:7:0:0"], missing: "one question copies the quote's turn of phrase" }),
    judgment("unit:two")] } });
  assert.deepEqual(before.quotes.map((quote) => [quote.confirmed, quote.copied]), [[false, 1], [true, 0]]);
  assert.deepEqual(before.notes, [{ unit_id: "unit:one", missing: "one question copies the quote's turn of phrase" }]);
  assert.equal(checkCoverageJudgments({ quotes: callQuotes(), copyRunWords: null, answer: { judgments: [
    judgment("unit:one", { copied_question_ids: ["question:7:0:0"] }), judgment("unit:two")] } }).reason, "unconfirmed_without_note");
  assert.throws(() => checkCoverageJudgments({ quotes: callQuotes(), copyRunWords: 2, answer: { judgments: [] } }),
    { code: "POINTER_COVERAGE_CHECK_INPUT_INVALID" });
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

test("a unit gets one writer retry in all; still unconfirmed after it, its questions count as missed, and still incomplete, it is a nonresponse", () => {
  assert.deepEqual(POINTER_REFERENCE_NONRESPONSE_REASONS, ["questions_incomplete", "coverage_unconfirmed", "coverage_check_failed",
    "searches_incomplete", "deadline"]);
  const set = (attempt) => checkQuestionSet({ sampleIndex: 7, attempt, quoteIds: QUOTES, texts: TEXTS, answer: writerAnswer() });
  const incomplete = checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, texts: TEXTS, answer: { questions: writerAnswer().questions.slice(0, 1) } });
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
  // After the retry there is no other: incomplete again is a nonresponse; complete and judged but unconfirmed again, the
  // retry's questions count in recall with every one missed (owner decision 30), marked as a complete unit's would be.
  assert.deepEqual(step([{ set: incomplete, coverage: null }, { set: null, coverage: null }]), { step: "nonresponse", reason: "questions_incomplete" });
  const unconfirmed = step([{ set: set(0), coverage: coverage([true, false], notes) },
    { set: set(1), coverage: [judge([true, false], notes, { critical: ["question:7:1:2"], event: ["question:7:1:0"] }), judge([true, false])] }]);
  assert.deepEqual([unconfirmed.step, unconfirmed.attempt], ["unconfirmed", 1]);
  assert.deepEqual(unconfirmed.questions.map((item) => [item.question_id, item.unit_id, item.critical, item.event]), [
    ["question:7:1:0", "unit:one", false, true], ["question:7:1:1", "unit:one", false, false], ["question:7:1:2", "unit:two", true, false]]);
  // In a run from before that decision (no copy-run setting), the same unit is a nonresponse, as it was then.
  assert.deepEqual(referenceUnitStep({ quoteIds: QUOTES, copyRunWords: null, attempts: [{ set: set(0), coverage: coverage([true, false], notes) },
    { set: set(1), coverage: coverage([true, false], notes) }] }), { step: "nonresponse", reason: "coverage_unconfirmed" });
  assert.throws(() => referenceUnitStep({ quoteIds: QUOTES, attempts: [], copyRunWords: 21 }), { code: "POINTER_REFERENCE_STEP_INPUT_INVALID" });
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

test("code checks copying: the longest run of its quote's words a question holds, accents, case, punctuation and spaces aside", () => {
  assert.equal(POINTER_COPY_RUN_WORDS, 8);
  assert.deepEqual(POINTER_COPY_RUN_LIMITS, { min: 3, max: 20 });
  const quote = "Hier, je suis allé voir ma mère à l'hôpital de Thiès avec Awa.";
  assert.deepEqual(longestSharedRun(quote, "Avec qui suis-je allé voir ma mère à l'hôpital ?"), { words: 7, run: "alle voir ma mere a l hopital" });
  assert.equal(longestSharedRun(quote, "Qui ai-je vu à Thiès ?").words, 1);
  assert.deepEqual(longestSharedRun("I want to move back to the village.", "Did I WANT to move—back to the village?"),
    { words: 8, run: "i want to move back to the village" });
  assert.deepEqual(longestSharedRun("Nothing alike.", "Something else?"), { words: 0, run: "" }, "only whole words count");
  // Spaces and punctuation are skipped on both sides, so an apostrophe or a hyphen dropped, or turned into a space,
  // changes nothing.
  for (const question of ["Did I really dont want to leave right now?", "Did I really don t want to leave right now?"]) {
    assert.deepEqual(longestSharedRun("I really don't want to leave right now", question), { words: 9, run: "i really don t want to leave right now" });
  }
  assert.deepEqual(longestSharedRun("My mother-in-law came for the whole weekend", "Did my mother in law come for the whole weekend?"),
    { words: 4, run: "my mother in law" });
  assert.deepEqual([longestSharedRun("", "Anything?").words, longestSharedRun("Something.", "").words], [0, 0]);
  assert.throws(() => longestSharedRun(null, "q"), { code: "POINTER_COPY_CHECK_INPUT_INVALID" });

  // A complete set reports each question's longest run, and flags those that reach the run length.
  const check = (copyRunWords) => checkQuestionSet({ sampleIndex: 7, attempt: 0, quoteIds: QUOTES, texts: TEXTS, answer: writerAnswer(),
    ...(copyRunWords === undefined ? {} : { copyRunWords }) });
  assert.deepEqual([check().longest_runs, check().copied], [[3, 3, 7], []]);
  assert.deepEqual(check(7).copied, [{ question_id: "question:7:0:2", unit_id: "unit:two", words: 7, run: "i want to move back to the" }]);
  assert.equal(check(7).complete, true, "copying leaves the set complete: it holds its quote back from confirmation");
  // A run from before the check flags none, and still reports the runs.
  assert.deepEqual([check(null).longest_runs, check(null).copied], [[3, 3, 7], []]);
  for (const copyRunWords of [2, 21, 7.5, "8"]) {
    assert.throws(() => check(copyRunWords), { code: "POINTER_QUESTION_SET_INPUT_INVALID" });
  }
});

test("the copy check's work grows with the two texts' lengths added, however repetitive they are", () => {
  // 4,000 one-letter words against 800 questions of 400: matched place by place, that is over a billion steps; read once
  // against each question it takes a fraction of a second. The bound is generous, so a slow machine doesn't fail it.
  const quote = Array.from({ length: 4000 }, () => "a").join(" ");
  const question = Array.from({ length: 400 }, () => "a").join(" ");
  const started = performance.now();
  for (let index = 0; index < 800; index += 1) assert.equal(longestSharedRun(quote, question).words, 400);
  assert.ok(performance.now() - started < 10_000);
  assert.equal(longestSharedRun("a".repeat(50_000), "a".repeat(400)).words, 0, "a word longer than the question is never held whole");
});

test("in a script written without spaces between words, each letter counts as a word, so copying shows there too", () => {
  // Chinese: a question that repeats its quote shares all eleven characters; one in other words shares four.
  const quote = "我昨天去医院看我妈妈了。";
  assert.deepEqual(longestSharedRun(quote, "我昨天去医院看我妈妈了吗？"), { words: 11, run: "我 昨 天 去 医 院 看 我 妈 妈 了" });
  assert.equal(longestSharedRun(quote, "我去医院看过妈妈吗？").words, 4);
  // Japanese and Thai, their marks (kana's voicing marks, Thai's vowel and tone marks) aside like accents.
  assert.equal(longestSharedRun("昨日、駅前のカフェでコーヒーを飲んだ。", "昨日、駅前のカフェでコーヒーを飲んだか？").words, 17);
  assert.equal(longestSharedRun("เมื่อวานฉันไปโรงพยาบาลกับแม่", "เมื่อวานฉันไปโรงพยาบาลกับแม่ใช่ไหม").words, 23);
  // A word of another script beside them stays one word, and a script written with spaces is read in words.
  assert.deepEqual(longestSharedRun("I bought an iPhone手机 yesterday.", "Did I buy an iphone手机?"), { words: 4, run: "an iphone 手 机" });
  assert.equal(longestSharedRun("어제 엄마와 병원에 갔어요.", "어제 엄마와 병원에 갔어요?").words, 4);
  // So a question that copies a Chinese quote is held back, as one copying a French quote is.
  const set = checkQuestionSet({ sampleIndex: 1, attempt: 0, quoteIds: ["unit:zh"], texts: new Map([["unit:zh", quote]]), answer: {
    schema_version: "1.0", questions: [{ unit_id: "unit:zh", question: "我昨天去医院看我妈妈了吗？", critical: false, event: true }] } });
  assert.deepEqual([set.longest_runs, set.copied.length], [[11], 1]);
});

test("a quote the copy check holds back gets the writer's retry with a note naming the run, though both judges confirm it", () => {
  const confirmAll = () => ({ quotes: QUOTES.map((id) => ({ unit_id: id, confirmed: true, critical_question_ids: [], event_question_ids: [] })), notes: [] });
  const both = () => [confirmAll(), confirmAll()];
  const set = (attempt, answer = writerAnswer()) => checkQuestionSet({ sampleIndex: 7, attempt, quoteIds: QUOTES, texts: TEXTS, answer, copyRunWords: 7 });
  const step = (attempts) => referenceUnitStep({ quoteIds: QUOTES, attempts });
  assert.deepEqual(step([{ set: set(0), coverage: both() }]), { step: "write", attempt: 1, notes: [{ unit_id: "unit:two",
    missing: "Code check: a question repeats 7 of this quote's words in a row (\"i want to move back to the\"). Ask about the same thing in other "
      + "words, the way a person might later ask." }] });
  // The judges' notes come first, then the copy check's.
  const judgeNote = { unit_id: "unit:one", missing: "the rain is left out" };
  const holding = { ...confirmAll(), quotes: confirmAll().quotes.map((quote) => (quote.unit_id === "unit:one" ? { ...quote, confirmed: false } : quote)),
    notes: [judgeNote] };
  assert.deepEqual(step([{ set: set(0), coverage: [holding, confirmAll()] }]).notes.map((note) => note.unit_id), ["unit:one", "unit:two"]);
  // Copying again after the retry: the unit's questions count as missed. Asked in other words, the unit is complete.
  assert.equal(step([{ set: set(0), coverage: both() }, { set: set(1), coverage: both() }]).step, "unconfirmed");
  const reworded = { ...writerAnswer(), questions: writerAnswer().questions.map((item, index) => (index === 2
    ? { ...item, question: "Do I hope to return to live in the village where I grew up?" } : item)) };
  assert.deepEqual(set(1, reworded).copied, []);
  assert.equal(step([{ set: set(0), coverage: both() }, { set: set(1, reworded), coverage: both() }]).step, "complete");
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
  assert.ok(text.units.every((unit) => /^representation:[0-9a-f]{32}:0$/.test(unit.unit_id)));
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

// A journal without pages: one representation holding `count` quotes of `bytes` bytes each, in journal order.
function pagelessQuotes(count, bytes) {
  return Array.from({ length: count }, (_, index) => ({ unit_id: `unit:t${index}`, page: null, representation_id: "representation:plain-text",
    text: `${String(index).padStart(4, "0")} ${"w".repeat(bytes - 5)}`, start_byte: index * (bytes + 2), end_byte: index * (bytes + 2) + bytes,
    source_order: index }));
}

test("a journal without pages is drawn in stretches of about a page, so no question writer gets the whole journal", () => {
  assert.deepEqual(POINTER_PAGELESS_STRETCH, { bytes: 4096, quotes: 40 });
  const quotes = pagelessQuotes(40, 1000);
  const sample = pointerReferenceSample({ units: quotes, seed: "synthetic-seed" });
  // Four quotes of 1,000 bytes fit in 4,096; a fifth starts the next stretch.
  assert.equal(sample.candidate_units, 10);
  const stretches = [...sample.units].sort((left, right) => Number(left.unit_id.split(":")[2]) - Number(right.unit_id.split(":")[2]));
  stretches.forEach((unit, index) => {
    assert.match(unit.unit_id, new RegExp(`^representation:[0-9a-f]{32}:${index}$`, "u"));
    assert.deepEqual(unit.quote_ids, [0, 1, 2, 3].map((offset) => `unit:t${index * 4 + offset}`));
  });
  // A quote longer than a stretch stands alone, and a stretch of short quotes closes at 40, so its question writer's
  // answer, one question or more for each quote and 800 at most, always fits.
  const long = pagelessQuotes(3, 1000).map((quote, index) => (index === 1 ? { ...quote, text: "l".repeat(5000) } : quote));
  assert.deepEqual(pointerReferenceSample({ units: long, seed: "s" }).units.map((unit) => unit.quote_ids.length).sort(), [1, 1, 1]);
  const headings = pagelessQuotes(100, 20);
  assert.deepEqual(pointerReferenceSample({ units: headings, seed: "s" }).units.map((unit) => unit.quote_ids.length).sort((a, b) => a - b), [20, 40, 40]);

  // A calibration unit without a page lies on every stretch holding a quote that overlaps its bytes.
  const challenge = pointerChallengeUnits({ units: quotes, calibration: [
    { unit_id: "calibration:a", representation_id: "representation:plain-text", page_number: null, start_byte: 8 * 1002 + 10, end_byte: 12 * 1002 + 10,
      hazard_types: ["declared_source_hazard"] },
    { unit_id: "calibration:b", representation_id: "representation:other", page_number: null, start_byte: 0, end_byte: 100, hazard_types: [] }
  ] });
  assert.deepEqual(challenge.units.map((unit) => [unit.unit_id.split(":")[2], unit.quote_ids.length, unit.hazards]),
    [["2", 4, ["declared_source_hazard"]], ["3", 4, ["declared_source_hazard"]]]);
  assert.deepEqual([challenge.calibration_units, challenge.units_without_quotes, challenge.candidate_units], [2, 1, 2]);
  assert.throws(() => pointerChallengeUnits({ units: quotes, calibration: [{ unit_id: "c", representation_id: "representation:plain-text",
    page_number: null }] }), { code: "POINTER_CHALLENGE_INPUT_INVALID" });
});

test("a page denser than a stretch is sampled in parts of at most 40 quotes and 4 KB, and its calibration unit lies on every part", () => {
  // Page 2 holds 90 short date headings; pages 1 and 3 one paragraph each.
  const units = [{ page: 1, count: 1 }, { page: 2, count: 90 }, { page: 3, count: 1 }].flatMap(({ page, count }) => Array.from({ length: count },
    (_, index) => ({ page, index }))).map(({ page, index }, order) => ({ unit_id: `unit:p${page}h${index}`, page, representation_id: `pdf:page:${page}`,
    text: `Heading ${index} of page ${page}.`, source_order: order }));
  const sample = pointerReferenceSample({ units, seed: "s" });
  assert.deepEqual(sample.units.map((unit) => [unit.unit_id, unit.quote_ids.length]).sort(),
    [["page:1", 1], ["page:2:0", 40], ["page:2:1", 40], ["page:2:2", 10], ["page:3", 1]]);
  const challenge = pointerChallengeUnits({ units, calibration: [{ unit_id: "calibration:dense", representation_id: "pdf:page:2", page_number: 2,
    hazard_types: ["parser_warning"] }] });
  assert.deepEqual(challenge.units.map((unit) => [unit.unit_id, unit.hazards]),
    [["page:2:0", ["parser_warning"]], ["page:2:1", ["parser_warning"]], ["page:2:2", ["parser_warning"]]]);

  // A page of long paragraphs is cut by their bytes: two of 1,500 bytes fit in 4,096, a third starts the next part,
  // so no question writer gets more of a page's facts than a stretch holds. A page within both bounds stays whole.
  const long = [1, 2, 3, 4].map((index) => ({ unit_id: `unit:long${index}`, page: 7, representation_id: "pdf:page:7",
    text: `${index} ${"w".repeat(1498)}`, source_order: index }));
  assert.deepEqual(pointerReferenceSample({ units: long, seed: "s" }).units.map((unit) => [unit.unit_id, unit.quote_ids]).sort(),
    [["page:7:0", ["unit:long1", "unit:long2"]], ["page:7:1", ["unit:long3", "unit:long4"]]]);
  assert.deepEqual(pointerReferenceSample({ units: long.slice(0, 2), seed: "s" }).units.map((unit) => unit.unit_id), ["page:7"]);
  // A paged quote needs its text, or its length, to be placed in a part.
  assert.throws(() => pointerChallengeUnits({ units: [{ unit_id: "unit:x", page: 7, representation_id: "pdf:page:7", source_order: 0 }],
    calibration: [] }), { code: "POINTER_CHALLENGE_INPUT_INVALID" });
  assert.equal(pointerChallengeUnits({ units: [{ unit_id: "unit:x", page: 7, representation_id: "pdf:page:7", source_order: 0,
    utf8_byte_length: 12 }], calibration: [{ unit_id: "c", representation_id: "pdf:page:7", page_number: 7 }] }).units[0].unit_id, "page:7");
});

test("a calibration unit read from a page's visual transcription lies on that transcription's quotes, never on the native page's", () => {
  // Page 3's native text, and its visual transcription, which has no page entry of its own, so its quotes have no page.
  const native = [0, 1].map((index) => ({ unit_id: `unit:n${index}`, page: 3, representation_id: "pdf:page:3", text: `Native paragraph ${index}.`,
    start_byte: index * 30, end_byte: index * 30 + 20, source_order: index }));
  const visual = [0, 1, 2].map((index) => ({ unit_id: `unit:v${index}`, page: null, representation_id: "visual:page:3",
    text: `Transcribed paragraph ${index}.`, start_byte: index * 40, end_byte: index * 40 + 30, source_order: 2 + index }));
  const challenge = pointerChallengeUnits({ units: [...native, ...visual], calibration: [
    { unit_id: "calibration:visual", representation_id: "visual:page:3", page_number: 3, start_byte: 0, end_byte: 120,
      hazard_types: ["visual_representation"] },
    { unit_id: "calibration:native", representation_id: "pdf:page:3", page_number: 3, start_byte: 0, end_byte: 50, hazard_types: [] },
    // A transcription with no quotes yet is counted, and takes no other representation's quotes.
    { unit_id: "calibration:unread", representation_id: "visual:page:4", page_number: 3, start_byte: 0, end_byte: 50, hazard_types: ["visual_representation"] }
  ] });
  assert.deepEqual(challenge.units.map((unit) => [unit.unit_id.startsWith("representation:") ? "visual stretch" : unit.unit_id, unit.quote_ids, unit.hazards]), [
    ["page:3", ["unit:n0", "unit:n1"], []],
    ["visual stretch", ["unit:v0", "unit:v1", "unit:v2"], ["visual_representation"]]
  ]);
  assert.deepEqual([challenge.calibration_units, challenge.units_without_quotes, challenge.candidate_units], [3, 1, 2]);
});
