import test from "node:test";
import assert from "node:assert/strict";
import { freezeColdQuestionSet } from "../src/journal-import/cold-question-freeze.mjs";

function auditedUnit({ id, order, text, question, answerability = "answerable", visual = false }) {
  const unit = { unit_id: id, source_order: order, text, visual };
  const item = { id: `reference:${id}`, statement: text,
    required_qualifiers: [], anchors: [{ unit_id: id, quote: text, occurrence: 0 }],
    importance_reason: "Synthetic fixture", critical: false };
  const report = { unit_id: id, calibration_overlap: false,
    certification: { semantically_audited: "pass" }, coverage: { complete: true },
    freeze: { generation: "generation:synthetic", reference: {
      source_only_first_pass: true, reference_items: [item], unassessed_unit_ids: [],
      questions: [{ id: `question:${id}`, question, expected_elements: [text],
        evidence_item_ids: [item.id], answerability }]
    } } };
  return { unit, report };
}

test("source-first cold freeze separates consumer questions from the held-out answer key", () => {
  const fixtures = [
    auditedUnit({ id: "a", order: 0, text: "UniqueCitadel appeared early.",
      question: "What happened with UniqueCitadel?" }),
    auditedUnit({ id: "b", order: 1, text: "A correction changed the account.",
      question: "What correction was made?" }),
    auditedUnit({ id: "c", order: 2, text: "The later event followed the first.",
      question: "What happened after the first event?" }),
    auditedUnit({ id: "d", order: 3, text: "The result held except on one day.",
      question: "What was the exception?" }),
    auditedUnit({ id: "e", order: 4, text: "A figure contained a route.",
      question: "Which route appeared in the figure?", visual: true }),
    auditedUnit({ id: "f", order: 5, text: "The source did not establish an outcome.",
      question: "What outcome was established?", answerability: "unanswerable" })
  ];
  const frozen = freezeColdQuestionSet({
    auditReport: { generation: "generation:synthetic", graph_sha256: "synthetic",
      reports: fixtures.map(row => row.report) },
    units: fixtures.map(row => row.unit)
  });
  assert.equal(frozen.status, "ready");
  assert.deepEqual(frozen.categories_missing, []);
  assert.ok(frozen.questions.length >= 6);
  assert.ok(frozen.questions.every(row => Object.keys(row).sort().join(",") === "id,question"));
  assert.ok(!JSON.stringify(frozen.questions).includes("A figure contained a route."));
  assert.ok(frozen.answer_key.some(row => row.categories.includes("visual")));
  assert.ok(frozen.answer_key.some(row => row.categories.includes("abstention")));
});

test("uncertified source-first freeze cannot seed the cold consumer", () => {
  const row = auditedUnit({ id: "a", order: 0, text: "Synthetic detail.",
    question: "Which detail?" });
  row.report.freeze.reference.source_only_first_pass = false;
  assert.throws(() => freezeColdQuestionSet({
    auditReport: { generation: "generation:synthetic", reports: [row.report] },
    units: [row.unit]
  }), { code: "COLD_FREEZE_SOURCE_FIRST_UNPROVEN" });
});
