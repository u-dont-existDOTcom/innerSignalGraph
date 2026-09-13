import test from "node:test";
import assert from "node:assert/strict";
import { assembleCanonicalCandidateText } from "../src/supervisor/canonical-candidate-text.mjs";

test("preserves an answer that already ends in the exact standalone canonical question", () => {
  const answer = "A complete therapeutic response.\n\nWhat changed?";
  assert.equal(assembleCanonicalCandidateText({ answer, next_question: "What changed?" }), answer);
});

test("preserves an answer that is exactly the canonical question", () => {
  assert.equal(assembleCanonicalCandidateText({ answer: "What changed?", next_question: "What changed?" }), "What changed?");
});

test("appends a genuinely separate canonical question for a legacy body", () => {
  assert.equal(assembleCanonicalCandidateText({ answer: "A legacy response body.", next_question: "  What changed?  " }), "A legacy response body.\n\nWhat changed?");
});

test("does not fuzzy-match an inline or quoted earlier occurrence", () => {
  const answer = "You previously asked, ‘What changed?’ That remains useful context.";
  assert.equal(assembleCanonicalCandidateText({ answer, next_question: "What changed?" }), `${answer}\n\nWhat changed?`);
});

test("does not rewrite answer bytes when no canonical question exists", () => {
  const answer = "  Preserve deliberate leading and trailing space.  ";
  assert.equal(assembleCanonicalCandidateText({ answer, next_question: "" }), answer);
  assert.equal(assembleCanonicalCandidateText({ answer }), answer);
});

test("requires nonblank candidate response text", () => {
  for (const answer of [undefined, null, "", "  \n "]) {
    assert.throws(() => assembleCanonicalCandidateText({ answer, next_question: "What changed?" }), /did not return candidate response text/u);
  }
});
