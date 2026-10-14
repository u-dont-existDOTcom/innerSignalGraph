import test from "node:test";
import assert from "node:assert/strict";
import { collectPointerExamples, renderPointerExamples } from "../src/journal-import/pointer-examples.mjs";

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
  assert.deepEqual([collected.sampled, collected.confirmed, collected.pieces.map((piece) => piece.unit_id)], [3, 1, ["page:2", "page:3"]]);
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
  assert.match(html, /Piece 2: no answer before the step&#39;s time ran out/u);
  assert.match(html, /The question writer gave no answer before the time ran out\./u);
  assert.match(html, /Of the 3 pieces in the sample, 2 weren't confirmed by both judges, and all of them are below\./u);
  assert.doesNotMatch(html, /Confirmed passage/u, "a confirmed piece isn't shown");
});
