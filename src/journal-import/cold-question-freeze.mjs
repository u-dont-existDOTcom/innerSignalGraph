import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { lexicalTerms } from "./graph.mjs";

const categories = Object.freeze([
  "old", "rare", "correction", "chronology", "exception", "visual", "abstention"
]);
const digest = value => createHash("sha256").update(value).digest("hex");
const requireValue = (condition, code) => {
  if (!condition) throw new ValidationError(code, { code });
};
const wording = row => [row.question.question, ...row.question.expected_elements,
  ...row.items.flatMap(item => [item.statement, ...item.required_qualifiers])].join(" ");

/** Select held-out questions exclusively from certified source-first audit freezes. */
export function freezeColdQuestionSet({ auditReport, units, maximumQuestions = 32 }) {
  requireValue(auditReport?.generation && Array.isArray(auditReport.reports)
    && Array.isArray(units) && units.length > 0, "COLD_FREEZE_INPUT_INVALID");
  requireValue(Number.isSafeInteger(maximumQuestions) && maximumQuestions >= categories.length,
    "COLD_FREEZE_LIMIT_INVALID");
  const byId = new Map(units.map(unit => [unit.unit_id, unit]));
  requireValue(byId.size === units.length, "COLD_FREEZE_UNIT_DUPLICATE");
  const native = units.filter(unit => !unit.visual);
  const oldLimit = Math.floor(Math.max(0, native.length - 1) / 5);
  const documentFrequency = new Map();
  for (const unit of units) for (const term of new Set(lexicalTerms(unit.text))) {
    documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const candidates = [];
  for (const report of auditReport.reports) {
    if (report.calibration_overlap || report.certification?.semantically_audited !== "pass"
      || report.coverage?.complete !== true) continue;
    const unit = byId.get(report.unit_id), reference = report.freeze?.reference;
    requireValue(unit && report.freeze.generation === auditReport.generation
      && reference?.source_only_first_pass === true
      && Array.isArray(reference.unassessed_unit_ids)
      && reference.unassessed_unit_ids.length === 0,
    "COLD_FREEZE_SOURCE_FIRST_UNPROVEN");
    const items = new Map(reference.reference_items.map(item => [item.id, item]));
    requireValue(items.size === reference.reference_items.length,
      "COLD_FREEZE_REFERENCE_DUPLICATE");
    for (const question of reference.questions) {
      requireValue(question.evidence_item_ids.every(id => items.has(id)),
        "COLD_FREEZE_EVIDENCE_UNBOUND");
      const selected = question.evidence_item_ids.map(id => items.get(id));
      requireValue(selected.every(item => item.anchors.every(anchor => anchor.unit_id === unit.unit_id)),
        "COLD_FREEZE_ANCHOR_OUTSIDE_UNIT");
      const row = { unit, question, items: selected };
      const words = wording(row).toLowerCase();
      const terms = lexicalTerms(question.question).filter(term => term.length >= 5);
      const markers = [];
      if (!unit.visual && unit.source_order <= oldLimit) markers.push("old");
      if (terms.some(term => documentFrequency.get(term) === 1)) markers.push("rare");
      if (/\b(correct(?:ed|ion)?|revis(?:ed|ion)|mistak(?:e|en)|actually|later clarified)\b/u.test(words)) markers.push("correction");
      if (/\b(when|before|after|earlier|later|first|then|sequence|chronolog|year|month)\b/u.test(words)) markers.push("chronology");
      if (/\b(except|unless|however|although|sometimes|conditional|mixed|but|whereas)\b/u.test(words)) markers.push("exception");
      if (unit.visual) markers.push("visual");
      if (question.answerability === "unanswerable") markers.push("abstention");
      candidates.push({ id: `cold:${digest(`${unit.unit_id}\0${question.id}`).slice(0, 32)}`,
        unit_id: unit.unit_id, source_order: unit.source_order,
        question, items: selected, categories: markers });
    }
  }
  candidates.sort((a, b) => a.source_order - b.source_order || a.id.localeCompare(b.id));
  requireValue(new Set(candidates.map(item => item.id)).size === candidates.length,
    "COLD_FREEZE_QUESTION_DUPLICATE");
  const selected = [], seen = new Set();
  const add = row => { if (!seen.has(row.id) && selected.length < maximumQuestions) {
    seen.add(row.id); selected.push(row);
  } };
  for (const category of categories) {
    const matching = candidates.filter(row => row.categories.includes(category));
    if (matching.length) add(category === "old" ? matching[0] : matching.at(Math.floor(matching.length / 2)));
  }
  const remaining = candidates.filter(row => !seen.has(row.id));
  const buckets = Array.from({ length: 4 }, (_, bucket) => remaining.filter(item =>
    Math.min(3, Math.floor(4 * item.source_order / Math.max(1, units.length))) === bucket));
  for (let offset = 0; selected.length < maximumQuestions; offset++) {
    let found = false;
    for (const bucket of buckets) if (bucket[offset]) { add(bucket[offset]); found = true; }
    if (!found) break;
  }
  const covered = categories.filter(category => selected.some(row => row.categories.includes(category)));
  const missing = categories.filter(category => !covered.includes(category));
  return {
    schema_version: 1, generation: auditReport.generation,
    audit_graph_sha256: auditReport.graph_sha256,
    status: selected.length && missing.length === 0 ? "ready" : "coverage_incomplete",
    categories_covered: covered, categories_missing: missing,
    questions: selected.map(row => ({ id: row.id, question: row.question.question })),
    answer_key: selected.map(row => ({ id: row.id, unit_id: row.unit_id,
      source_order: row.source_order, categories: row.categories,
      expected_elements: row.question.expected_elements,
      answerability: row.question.answerability,
      reference_items: row.items }))
  };
}
