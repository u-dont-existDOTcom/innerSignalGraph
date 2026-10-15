import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkReviewDirectory, collectPointerExamples, renderPointerExamples, writeReviewFile } from "../src/journal-import/pointer-examples.mjs";

// The operator's view of the reference step's pieces that weren't confirmed (pointer-examples). All text here is invented.

const reference = { units: [
  { unit_id: "page:1", quote_ids: ["q:1"], status: "complete", reason: null, deadline_cause: null },
  { unit_id: "page:2", quote_ids: ["q:2", "q:3"], status: "unconfirmed", reason: null, deadline_cause: null },
  { unit_id: "page:3", quote_ids: ["q:4"], status: "nonresponse", reason: "deadline", deadline_cause: "unanswered" }
] };
const units = [
  { unit_id: "q:1", page: 1, text: "Confirmed passage." },
  { unit_id: "q:2", page: 2, text: "On Sunday I went to the market with Awa <to buy> mangoes & \"bread\"." },
  { unit_id: "q:3", page: 2, text: "In the evening Awa called." },
  { unit_id: "q:4", page: 3, text: "A passage nobody answered for in time." }
];
const set = (round) => ({ complete: true, answer_valid: true, copied: round === 0 ? [{ question_id: `question:1:${round}:1`, unit_id: "q:2", words: 9 }] : [],
  questions: [
    { question_id: `question:1:${round}:0`, unit_id: "q:2", question: "Where did I go on Sunday?", critical: true, event: true },
    { question_id: `question:1:${round}:1`, unit_id: "q:2", question: "Who went with me <script>alert(1)</script>?", critical: false, event: false },
    { question_id: `question:1:${round}:2`, unit_id: "q:3", question: "Who called in the evening?", critical: false, event: true }
  ] });
const judgment = (id, fields = {}) => ({ unit_id: id, covered: true, missing: "", critical_question_ids: [], event_question_ids: [],
  repeated_question_ids: [], combined_question_ids: [], copied_question_ids: [], ...fields });
const events = [
  { kind: "writer", unit_id: "page:2", round: 0, status: "answered", set: set(0), coverage_notes: [] },
  { kind: "judge", round: 0, tier: "standard", quote_ids: ["q:2", "q:3"], status: "answered", judgments: [
    judgment("q:2", { repeated_question_ids: ["question:1:0:1"], missing: "the companion is a detail of the outing" }), judgment("q:3")] },
  { kind: "judge", round: 0, tier: "hardest", quote_ids: ["q:2", "q:3"], status: "answered", judgments: [judgment("q:2"), judgment("q:3")] },
  { kind: "writer", unit_id: "page:2", round: 1, status: "answered", set: set(1),
    coverage_notes: [{ unit_id: "q:2", missing: "the companion is a detail of the outing" }] },
  { kind: "judge", round: 1, tier: "standard", quote_ids: ["q:2", "q:3"], status: "answered", judgments: [
    judgment("q:2", { covered: false, combined_question_ids: ["question:1:1:0"], missing: "why he went is left out" }), judgment("q:3")] },
  { kind: "judge", round: 1, tier: "hardest", quote_ids: ["q:2", "q:3"], status: "deadline", judgments: null },
  { kind: "writer", unit_id: "page:3", round: 0, status: "deadline", set: null, coverage_notes: [] }
];

test("the examples hold each piece that wasn't confirmed, with its quotes, questions and both judges' verdicts", () => {
  const collected = collectPointerExamples({ reference, units, events, copyRunWords: 8 });
  assert.deepEqual([collected.sampled, collected.pieces.map((piece) => piece.unit_id)], [3, ["page:2", "page:3"]]);
  const [piece, late] = collected.pieces;
  assert.deepEqual(piece.quotes.map((quote) => quote.text), [units[1].text, units[2].text]);
  assert.equal(piece.attempts.length, 2);
  const [first, rewrite] = piece.attempts;
  assert.equal(first.questions[1].copied_words, 9);
  const codexFirst = first.verdicts[0].judges[0];
  assert.deepEqual([codexFirst.judge, codexFirst.status, codexFirst.repeated], ["Codex", "held_back", ["question:1:0:1"]]);
  assert.equal(first.verdicts[0].judges[1].status, "confirmed");
  assert.equal(first.verdicts[1].judges[0].status, "confirmed");
  assert.deepEqual(rewrite.coverage_notes.map((note) => note.missing), ["the companion is a detail of the outing"]);
  assert.deepEqual([rewrite.verdicts[0].judges[0].covered, rewrite.verdicts[0].judges[0].combined], [false, ["question:1:1:0"]]);
  assert.equal(rewrite.verdicts[0].judges[1].status, "deadline");
  assert.deepEqual([late.reason, late.attempts.length, late.attempts[0].writer.status], ["deadline", 1, "deadline"]);
});

test("a judge's copying flag holds a quote back only in a run from before owner decision 30", () => {
  const flagged = [{ kind: "writer", unit_id: "page:2", round: 0, status: "answered", set: set(0), coverage_notes: [] },
    { kind: "judge", round: 0, tier: "standard", quote_ids: ["q:2", "q:3"], status: "answered",
      judgments: [judgment("q:2", { copied_question_ids: ["question:1:0:1"] }), judgment("q:3")] }];
  const now = collectPointerExamples({ reference, units, events: flagged, copyRunWords: 8 }).pieces[0].attempts[0].verdicts[0].judges[0];
  const before = collectPointerExamples({ reference, units, events: flagged, copyRunWords: null }).pieces[0].attempts[0].verdicts[0].judges[0];
  assert.deepEqual([now.status, before.status], ["confirmed", "held_back"]);
});

test("the page escapes everything it shows, loads nothing from elsewhere, and says why each judge held a quote back", () => {
  const html = renderPointerExamples(collectPointerExamples({ reference, units, events, copyRunWords: 8 }), { runId: "run-1", generatedAt: "2026-10-14T22:30:00.000Z" });
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /Who went with me &lt;script&gt;alert\(1\)&lt;\/script&gt;\?/u);
  assert.match(html, /market with Awa &lt;to buy&gt; mangoes &amp; &quot;bread&quot;\./u);
  assert.doesNotMatch(html, /(?:src|href)=|@import|url\(/u);
  assert.match(html, /<strong>Codex<\/strong>: held back \(repeated: Q2\)\.<div class="note">Its note: “the companion is a detail of the outing”<\/div>/u);
  assert.match(html, /<strong>Codex<\/strong>: held back \(something left out; two things in one: Q1\)\./u);
  assert.match(html, /<strong>Claude<\/strong>: no usable answer \(deadline\)\./u);
  assert.match(html, /<span class="tag warn">code: copies 9 words in a row<\/span>/u);
  assert.match(html, /Piece 2: the step&#39;s time ran out before its questions were confirmed/u);
  assert.match(html, /The question writer gave no answer before the time ran out\./u);
  assert.match(html, /Of the 3 pieces in the sample, 2 didn't get their questions confirmed, and all of them are below\./u);
  assert.doesNotMatch(html, /Confirmed passage/u, "a confirmed piece isn't shown");
});

test("the review file is written only through its own handle, into the directory checked before the work", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-review-bind-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const make = async (name) => { const dir = path.join(parent, name); await fs.mkdir(dir); await fs.chmod(dir, 0o700); return dir; };
  const dir = await make("review");
  const other = await make("other");
  const verified = await checkReviewDirectory(dir);
  await writeReviewFile({ dir, name: "first.html", verified, content: "invented journal text" });
  const handle = await fs.open(path.join(dir, "first.html"), "r");
  try {
    assert.equal((await handle.stat()).mode & 0o777, 0o600);
    assert.equal(await handle.readFile("utf8"), "invented journal text");
  } finally { await handle.close(); }
  // A name that exists is never written over.
  await assert.rejects(writeReviewFile({ dir, name: "first.html", verified, content: "other text" }), { code: "EEXIST" });
  // The checked directory swapped for another before the write: nothing is written, and the empty file goes.
  const moved = path.join(parent, "moved");
  await fs.rename(dir, moved);
  await fs.rename(other, dir);
  await assert.rejects(writeReviewFile({ dir, name: "second.html", verified, content: "invented journal text" }), { code: "POINTER_EXAMPLES_DIR_UNSAFE" });
  assert.deepEqual(await fs.readdir(dir), []);
  // A link to the checked directory in its place: the same.
  await fs.rm(dir, { recursive: true });
  await fs.symlink(moved, dir);
  await assert.rejects(writeReviewFile({ dir, name: "third.html", verified, content: "invented journal text" }), { code: "POINTER_EXAMPLES_DIR_UNSAFE" });
  assert.deepEqual(await fs.readdir(moved), ["first.html"]);
  // The check itself refuses a link, a directory others can open, and one that isn't there.
  await assert.rejects(checkReviewDirectory(dir), { code: "POINTER_EXAMPLES_DIR_UNSAFE" });
  const open = await make("open");
  await fs.chmod(open, 0o750);
  await assert.rejects(checkReviewDirectory(open), { code: "POINTER_EXAMPLES_DIR_UNSAFE" });
  await assert.rejects(checkReviewDirectory(path.join(parent, "missing")), { code: "POINTER_EXAMPLES_DIR_UNSAFE" });
});

test("a piece whose questions were confirmed but whose searches fell short isn't an example; one the copy check held back is", () => {
  const units2 = [...units, { unit_id: "q:5", page: 5, text: "Searches ran out." }, { unit_id: "q:6", page: 6, text: "Copied passage." }];
  const reference2 = { units: [
    { unit_id: "page:4", quote_ids: ["q:5"], status: "nonresponse", reason: "searches_incomplete", deadline_cause: null },
    { unit_id: "page:5", quote_ids: ["q:5"], status: "nonresponse", reason: "deadline", deadline_cause: "unanswered" },
    { unit_id: "page:6", quote_ids: ["q:6"], status: "unconfirmed", reason: null, deadline_cause: null }
  ] };
  const one = (unitId, quoteId, copied) => ({ complete: true, answer_valid: true,
    copied: copied ? [{ question_id: `question:${unitId}:0:0`, unit_id: quoteId, words: 10 }] : [],
    questions: [{ question_id: `question:${unitId}:0:0`, unit_id: quoteId, question: "What happened?", critical: false, event: false }] });
  const confirmedBy = (unitId, quoteId, copied) => [
    { kind: "writer", unit_id: unitId, round: 0, status: "answered", set: one(unitId, quoteId, copied), coverage_notes: [] },
    ...["standard", "hardest"].map((tier) => ({ kind: "judge", round: 0, tier, quote_ids: [quoteId], status: "answered", judgments: [judgment(quoteId)] }))];
  const collected = collectPointerExamples({ reference: reference2, units: units2, copyRunWords: 8,
    events: [...confirmedBy("page:4", "q:5", false), ...confirmedBy("page:5", "q:5", false), ...confirmedBy("page:6", "q:6", true)] });
  assert.deepEqual(collected.pieces.map((piece) => piece.unit_id), ["page:6"]);
  assert.equal(collected.pieces[0].attempts[0].questions[0].copied_words, 10);
});

test("a writer's incomplete answer still shows the questions it wrote", () => {
  const reference3 = { units: [{ unit_id: "page:2", quote_ids: ["q:2", "q:3"], status: "nonresponse", reason: "questions_incomplete", deadline_cause: null }] };
  const incomplete = { complete: false, answer_valid: true, questions: [], foreign_questions: 0, quotes_without_question: 1, quotes_too_long: 0, longest_runs: [], copied: [] };
  const written = [{ unit_id: "q:2", question: "Where did I go on Sunday?", critical: false, event: true }];
  const collected = collectPointerExamples({ reference: reference3, units, copyRunWords: 8, events: [
    { kind: "writer", unit_id: "page:2", round: 0, status: "answered", set: incomplete, raw_questions: written, coverage_notes: [] },
    { kind: "writer", unit_id: "page:2", round: 1, status: "answered", set: incomplete, raw_questions: written, coverage_notes: [] }] });
  const [first] = collected.pieces[0].attempts;
  assert.deepEqual(first.questions.map((item) => [item.quote_id, item.question]), [["q:2", "Where did I go on Sunday?"]]);
  const html = renderPointerExamples(collected, { runId: "run-1", generatedAt: "2026-10-14T22:50:00.000Z" });
  assert.match(html, /The question writer&#39;s questions fell short: 1 quote\(s\) got no question\./u);
  assert.match(html, /<span class="q">Q1<\/span> Where did I go on Sunday\?/u);
  assert.match(html, /Piece 1: the question writer&#39;s questions fell short twice/u);
});

test("under owner decision 32's rules the examples are the pieces marked as not understood, with Codex's verdict alone", () => {
  const units3 = [
    { unit_id: "q:1", page: 1, text: "A covered passage." },
    { unit_id: "q:2", page: 2, text: "A passage left uncovered." },
    { unit_id: "q:3", page: 3, text: "Marked, and then its searches ran out." },
    { unit_id: "q:4", page: 4, text: "Covered, but its searches ran out." },
    { unit_id: "q:5", page: 5, text: "The judge gave no usable answer." }
  ];
  const reference3 = { units: [
    { unit_id: "page:1", quote_ids: ["q:1"], status: "complete", reason: null, deadline_cause: null },
    { unit_id: "page:2", quote_ids: ["q:2"], status: "marked", reason: "coverage_unconfirmed", deadline_cause: null },
    { unit_id: "page:3", quote_ids: ["q:3"], status: "nonresponse", reason: "searches_incomplete", deadline_cause: null },
    { unit_id: "page:4", quote_ids: ["q:4"], status: "nonresponse", reason: "searches_incomplete", deadline_cause: null },
    { unit_id: "page:5", quote_ids: ["q:5"], status: "marked", reason: "coverage_check_failed", deadline_cause: null }
  ] };
  const two = (unitId, quoteId, copied) => ({ complete: true, answer_valid: true,
    copied: copied ? [{ question_id: `question:${unitId}:0`, unit_id: quoteId, words: 9 }] : [],
    questions: [{ question_id: `question:${unitId}:0`, unit_id: quoteId, question: "What happened?", critical: false, event: false },
      { question_id: `question:${unitId}:1`, unit_id: quoteId, question: "What happened, said again?", critical: false, event: false }] });
  const writer = (unitId, quoteId, round, copied = false) => ({ kind: "writer", unit_id: unitId, round, status: "answered",
    set: two(unitId, quoteId, copied), coverage_notes: [] });
  const codex = (quoteId, round, fields) => ({ kind: "judge", round, tier: "standard", quote_ids: [quoteId], status: "answered",
    judgments: [judgment(quoteId, fields)] });
  const events3 = [
    writer("page:2", "q:2", 0), codex("q:2", 0, { covered: false, missing: "where it happened" }),
    writer("page:2", "q:2", 1, true), codex("q:2", 1, { covered: false, repeated_question_ids: ["question:page:2:1"], missing: "where it happened" }),
    writer("page:3", "q:3", 0), codex("q:3", 0, { covered: false, missing: "who was there" }),
    writer("page:3", "q:3", 1), codex("q:3", 1, { covered: false, missing: "who was there" }),
    // Covered, with a repeated question and a copying one: confirmed under these rules, so only its searches fell short.
    writer("page:4", "q:4", 0, true), codex("q:4", 0, { repeated_question_ids: ["question:page:4:1"] }),
    writer("page:5", "q:5", 0), { kind: "judge", round: 0, tier: "standard", quote_ids: ["q:5"], status: "deadline", judgments: null }
  ];
  const collected = collectPointerExamples({ reference: reference3, units: units3, events: events3, copyRunWords: 8, rules: 3 });
  assert.equal(collected.rules, 3);
  assert.deepEqual(collected.pieces.map((piece) => [piece.unit_id, piece.marked]),
    [["page:2", "coverage_unconfirmed"], ["page:3", "coverage_unconfirmed"], ["page:5", "coverage_check_failed"]]);
  const rewrite = collected.pieces[0].attempts[1];
  assert.deepEqual(rewrite.verdicts[0].judges.map((item) => [item.judge, item.status]), [["Codex", "held_back"]]);
  assert.equal(rewrite.questions[0].copied_words, 9);
  // Any split is fine: a covered quote with a repeated question is confirmed, so its try isn't an example; under owner
  // decision 30's rules the same try is held back.
  const covered = [writer("page:2", "q:2", 0), codex("q:2", 0, { repeated_question_ids: ["question:page:2:1"] })];
  const shown = (rules, unit) => collectPointerExamples({ reference: { units: [unit] }, units: units3, events: covered, copyRunWords: 8, rules }).pieces;
  assert.equal(shown(2, { ...reference3.units[1], status: "unconfirmed", reason: null })[0].attempts[0].verdicts[0].judges[0].status, "held_back");
  assert.deepEqual(shown(3, reference3.units[1]), []);
  // These rules always have a copy setting.
  assert.throws(() => collectPointerExamples({ reference: reference3, units: units3, events: events3, copyRunWords: null, rules: 3 }),
    { code: "POINTER_EXAMPLES_INPUT_INVALID" });
  const html = renderPointerExamples(collected, { runId: "run-3", generatedAt: "2026-10-15T10:30:00.000Z" });
  assert.match(html, /<title>Journal pieces marked as not understood<\/title>/u);
  assert.match(html, /<h1>Journal pieces marked as not understood<\/h1>/u);
  assert.match(html, /what Codex, this run&#39;s one judge, decided|what Codex, this run's one judge, decided/u);
  assert.match(html, /Piece 1: marked as not understood: not covered, even after the rewrite<\/h2>/u);
  assert.match(html, /Piece 2: marked as not understood: not covered, even after the rewrite; its searches didn&#39;t finish either<\/h2>/u);
  assert.match(html, /Piece 3: marked as not understood: the judge gave no usable answer<\/h2>/u);
  assert.match(html, /<strong>Codex<\/strong>: held back \(something left out\)\.<div class="note">Its note: “where it happened”<\/div>/u);
  assert.match(html, /<strong>Codex<\/strong>: no usable answer \(deadline\)\./u);
  assert.doesNotMatch(html, /<strong>Claude<\/strong>/u);
  assert.doesNotMatch(html, /repeated: Q2|<dt>Repeated<\/dt>|<dt>Two things in one<\/dt>/u);
  assert.match(html, /code: copies 9 words in a row; flagged, left out of recall/u);
  assert.match(html, /the question is flagged and left out of the recall measure, and holds nothing back\./u);
  assert.doesNotMatch(html, /A covered passage|Covered, but its searches ran out/u, "confirmed pieces aren't shown");
  // Out of time: a piece marked and then late with its searches keeps its mark (Codex, d7476fa9); one whose rewrite
  // never came, or whose judge ran out of time, is the deadline's.
  const late = (unitId) => ({ unit_id: unitId, quote_ids: [`q:${unitId}`], status: "nonresponse", reason: "deadline", deadline_cause: "unanswered" });
  const lateUnits = ["a", "b", "c"].map((id) => ({ unit_id: `q:page:${id}`, page: 10, text: `Late passage ${id}.` }));
  const lateEvents = [
    writer("page:a", "q:page:a", 0), codex("q:page:a", 0, { covered: false, missing: "when" }),
    writer("page:a", "q:page:a", 1), codex("q:page:a", 1, { covered: false, missing: "when" }),
    writer("page:b", "q:page:b", 0), codex("q:page:b", 0, { covered: false, missing: "when" }),
    writer("page:c", "q:page:c", 0), { kind: "judge", round: 0, tier: "standard", quote_ids: ["q:page:c"], status: "deadline", judgments: null }
  ];
  const lateCollected = collectPointerExamples({ reference: { units: ["page:a", "page:b", "page:c"].map(late) }, units: lateUnits,
    events: lateEvents, copyRunWords: 8, rules: 3 });
  assert.deepEqual(lateCollected.pieces.map((piece) => [piece.unit_id, piece.marked]), [["page:a", "coverage_unconfirmed"], ["page:b", null], ["page:c", null]]);
  const lateHtml = renderPointerExamples(lateCollected, { runId: "run-3", generatedAt: "2026-10-15T10:30:00.000Z" });
  assert.match(lateHtml, /Piece 1: marked as not understood: not covered, even after the rewrite; then the step&#39;s time ran out<\/h2>/u);
  assert.equal((lateHtml.match(/the step&#39;s time ran out before its questions were confirmed/gu) ?? []).length, 2);
});
