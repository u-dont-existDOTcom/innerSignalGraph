import test from "node:test";
import assert from "node:assert/strict";
import {
  createJournalSemanticBatches,
  splitBatchExtractionByUnit
} from "../src/journal-import/semantic-batches.mjs";

function unit(id, order, text = "synthetic source") {
  return {
    unit_id: id,
    representation_id: "representation:" + id,
    source_order: order,
    page_number: order + 1,
    text
  };
}

const unknownTime = {
  raw: null,
  from: null,
  to: null,
  precision: "unknown",
  timezone: null,
  basis: "unresolved",
  evidence_ids: []
};

function entity(local_id, unit_id) {
  return { local_id, label: local_id, entity_kind: "person", anchors: [{ unit_id, quote: "synthetic", occurrence: 0 }] };
}

test("semantic batches cover selected units once in source order within byte/count bounds", () => {
  const units = Array.from({ length: 7 }, (_, i) => unit("u" + i, i, "x".repeat(1000)));
  const batches = createJournalSemanticBatches({ units, maximumBytes: 5000, maximumUnits: 3 });
  assert.deepEqual(batches.flatMap((batch) => batch.unit_ids), units.map((item) => item.unit_id));
  assert.ok(batches.every((batch) => batch.units.length <= 3 && batch.estimated_bytes <= 5000));
  const selected = createJournalSemanticBatches({ units, selectedUnitIds: ["u1", "u4"], maximumBytes: 5000, maximumUnits: 3 });
  assert.deepEqual(selected.flatMap((batch) => batch.unit_ids), ["u1", "u4"]);
});
test("batch extraction splits into independently valid unit-local outputs", () => {
  const extraction = {
    schema_version: "1.0",
    status: "complete",
    entities: [entity("speaker-u1", "u1"), entity("speaker-u2", "u2")],
    episodes: [],
    assertions: [],
    coverage: [
      { unit_id: "u1", disposition: "no_assertion", assertion_local_ids: [], reason: "synthetic" },
      { unit_id: "u2", disposition: "no_assertion", assertion_local_ids: [], reason: "synthetic" }
    ],
    requested_context: []
  };
  const split = splitBatchExtractionByUnit({ extraction, unitIds: ["u1", "u2"] });
  assert.deepEqual([...split.keys()], ["u1", "u2"]);
  assert.deepEqual(split.get("u1").entities.map((item) => item.local_id), ["speaker-u1"]);
  assert.deepEqual(split.get("u2").entities.map((item) => item.local_id), ["speaker-u2"]);
});

test("cross-unit proposals fail closed so the controller can split the batch", () => {
  const extraction = {
    schema_version: "1.0",
    status: "complete",
    entities: [{
      local_id: "cross",
      label: "cross",
      entity_kind: "person",
      anchors: [
        { unit_id: "u1", quote: "synthetic", occurrence: 0 },
        { unit_id: "u2", quote: "synthetic", occurrence: 0 }
      ]
    }],
    episodes: [],
    assertions: [],
    coverage: [
      { unit_id: "u1", disposition: "no_assertion", assertion_local_ids: [], reason: "synthetic" },
      { unit_id: "u2", disposition: "no_assertion", assertion_local_ids: [], reason: "synthetic" }
    ],
    requested_context: []
  };
  assert.throws(
    () => splitBatchExtractionByUnit({ extraction, unitIds: ["u1", "u2"] }),
    { code: "BATCH_EXTRACTION_CROSS_UNIT_PROPOSAL" }
  );
});
