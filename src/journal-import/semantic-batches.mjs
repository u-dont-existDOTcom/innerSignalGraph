import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { validateExtractionReferences } from "./contracts.mjs";

const invariant = (condition, code, details = undefined) => {
  if (!condition) throw new ValidationError(code, { code, details });
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function unitCost(unit) {
  return Buffer.byteLength(unit.text ?? "", "utf8")
    + Buffer.byteLength(JSON.stringify({
      unit_id: unit.unit_id,
      representation_id: unit.representation_id,
      page_number: unit.page_number ?? null
    }), "utf8") + 256;
}

export function createJournalSemanticBatches({
  units,
  selectedUnitIds = null,
  maximumBytes = 180_000,
  maximumUnits = 64
}) {
  invariant(Array.isArray(units) && units.length > 0, "SEMANTIC_BATCH_UNITS_INVALID");
  invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= 4096, "SEMANTIC_BATCH_BYTES_INVALID");
  invariant(Number.isSafeInteger(maximumUnits) && maximumUnits >= 1, "SEMANTIC_BATCH_COUNT_INVALID");
  const ids = new Set();
  for (const unit of units) {
    invariant(typeof unit?.unit_id === "string" && unit.unit_id.length > 0, "SEMANTIC_BATCH_UNIT_INVALID");
    invariant(!ids.has(unit.unit_id), "SEMANTIC_BATCH_UNIT_DUPLICATE", { unit_id: unit.unit_id });
    ids.add(unit.unit_id);
  }
  const selected = selectedUnitIds == null ? null : new Set(selectedUnitIds);
  if (selected) for (const id of selected) invariant(ids.has(id), "SEMANTIC_BATCH_SELECTED_UNIT_MISSING", { unit_id: id });
  const ordered = units.filter((unit) => !selected || selected.has(unit.unit_id));
  invariant(ordered.length > 0, "SEMANTIC_BATCH_SELECTION_EMPTY");
  const batches = [];
  let current = [], bytes = 0;
  const flush = () => {
    if (!current.length) return;
    const unit_ids = current.map((unit) => unit.unit_id);
    batches.push(Object.freeze({
      id: "semantic-batch:" + sha256(JSON.stringify(unit_ids)).slice(0, 40),
      unit_ids: Object.freeze(unit_ids),
      units: Object.freeze([...current]),
      estimated_bytes: bytes
    }));
    current = []; bytes = 0;
  };
  for (const unit of ordered) {
    const cost = unitCost(unit);
    invariant(cost <= maximumBytes, "SEMANTIC_BATCH_UNIT_EXCEEDS_BOUND", { unit_id: unit.unit_id });
    if (current.length && (current.length >= maximumUnits || bytes + cost > maximumBytes)) flush();
    current.push(unit); bytes += cost;
  }
  flush();
  return Object.freeze(batches);
}

function singleAnchorUnit(item) {
  const unitIds = new Set((item.anchors ?? []).map((anchor) => anchor.unit_id));
  invariant(unitIds.size === 1, "BATCH_EXTRACTION_CROSS_UNIT_PROPOSAL", { local_id: item.local_id });
  return [...unitIds][0];
}
export function splitBatchExtractionByUnit({ extraction, unitIds }) {
  invariant(Array.isArray(unitIds) && unitIds.length > 0, "BATCH_EXTRACTION_UNIT_IDS_INVALID");
  const checked = validateExtractionReferences(extraction, unitIds);
  const assigned = new Set(unitIds);
  const duplicateCheck = (items, code) => {
    const seen = new Set();
    for (const item of items) {
      invariant(!seen.has(item.local_id), code, { local_id: item.local_id });
      seen.add(item.local_id);
    }
  };
  duplicateCheck(checked.entities, "BATCH_EXTRACTION_ENTITY_ID_DUPLICATE");
  duplicateCheck(checked.episodes, "BATCH_EXTRACTION_EPISODE_ID_DUPLICATE");
  for (const item of [...checked.entities, ...checked.episodes, ...checked.assertions]) {
    invariant(assigned.has(singleAnchorUnit(item)), "BATCH_EXTRACTION_ANCHOR_OUTSIDE_BATCH");
  }
  for (const request of checked.requested_context) {
    invariant(assigned.has(request.unit_id), "BATCH_EXTRACTION_CONTEXT_OUTSIDE_BATCH");
  }
  const result = new Map();
  for (const unitId of unitIds) {
    const entities = checked.entities.filter((item) => singleAnchorUnit(item) === unitId);
    const episodes = checked.episodes.filter((item) => singleAnchorUnit(item) === unitId);
    const assertions = checked.assertions.filter((item) => singleAnchorUnit(item) === unitId);
    const coverage = checked.coverage.filter((item) => item.unit_id === unitId);
    invariant(coverage.length === 1, "BATCH_EXTRACTION_UNIT_COVERAGE_INVALID", { unit_id: unitId });
    const value = {
      schema_version: checked.schema_version,
      status: checked.status,
      assertions,
      entities,
      episodes,
      coverage,
      requested_context: checked.requested_context.filter((item) => item.unit_id === unitId)
    };
    validateExtractionReferences(value, [unitId]);
    result.set(unitId, Object.freeze(value));
  }
  return result;
}
