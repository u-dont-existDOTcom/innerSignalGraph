import test from "node:test";
import assert from "node:assert/strict";
import {
  JOURNAL_READING_FIRST_STAGES, initializeReadingFirstJournal, advanceReadingFirstJournal
} from "../src/journal-import/reading-first-order.mjs";

// Invented coverage records only. No original journal content or case information.
const SOURCE = "a".repeat(64);
const start = () => initializeReadingFirstJournal({
  source_sha256: SOURCE, page_count: 3, generation: "synthetic:reading-first:v1",
  archive_receipt_ref: "synthetic:archive:1"
});
const receipt = (name, details = {}) => ({
  source_sha256: SOURCE, generation: "synthetic:reading-first:v1", receipt_ref: "synthetic:" + name,
  ...details
});
const inventory = (state) => advanceReadingFirstJournal(state, {
  to: "SOURCE_INVENTORIED", receipt: receipt("inventory", { page_count: 3, source_inventory_complete: true })
});
const reviewed = (page) => ({
  page, status: "REVIEWED_ALL_SOURCE_MODALITIES", source_read_receipt_ref: "synthetic:source-read:" + page
});
const pending = (page, reason) => ({ page, status: "REVIEW_PENDING", reason });
const read = (state, dispositions) => advanceReadingFirstJournal(state, {
  to: "READING_DISPOSITIONED",
  receipt: receipt("reading", { actual_source_reading: true, private_coverage_ref: "synthetic:coverage:1",
    page_dispositions: dispositions })
});
const synthesized = (state) => advanceReadingFirstJournal(state, {
  to: "LONGITUDINAL_SYNTHESIZED",
  receipt: receipt("synthesis", { synthesis_evidence_ref: "synthetic:evidence:1",
    reading_receipt_ref: "synthetic:reading", known_vs_new_reconciled: true,
    longitudinal_counterexamples_checked: true })
});
const indexed = (state) => advanceReadingFirstJournal(state, {
  to: "INDEX_BUILT", receipt: receipt("index", { synthesis_receipt_ref: "synthetic:synthesis",
    index_generation: "synthetic:index:1", original_source_pointers_preserved: true,
    read_derived_facets_included: true })
});

test("reading-first generation enforces source → actual read → synthesis → index → graph", () => {
  const source = start();
  assert.deepEqual(JOURNAL_READING_FIRST_STAGES, [
    "SOURCE_STAGED", "SOURCE_INVENTORIED", "READING_DISPOSITIONED",
    "LONGITUDINAL_SYNTHESIZED", "INDEX_BUILT", "GRAPH_BUILT", "VERIFIED", "PUBLISHED"
  ]);
  assert.throws(() => advanceReadingFirstJournal(source, {
    to: "INDEX_BUILT", receipt: receipt("index")
  }), { code: "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID" });
  const inv = inventory(source);
  assert.throws(() => advanceReadingFirstJournal(inv, {
    to: "LONGITUDINAL_SYNTHESIZED", receipt: receipt("fake-synthesis")
  }), { code: "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID" });
  const reading = read(inv, [reviewed(1), reviewed(2), reviewed(3)]);
  const synthesis = synthesized(reading);
  const index = indexed(synthesis);
  const graph = advanceReadingFirstJournal(index, {
    to: "GRAPH_BUILT", receipt: receipt("graph", {
      index_receipt_ref: "synthetic:index", graph_generation: "synthetic:graph:1",
      source_linked_events: true, uncertainty_and_actor_provenance_preserved: true
    })
  });
  const verified = advanceReadingFirstJournal(graph, {
    to: "VERIFIED", receipt: receipt("verified", {
      graph_receipt_ref: "synthetic:graph", retrieval_cross_span_passed: true,
      source_fidelity_passed: true, private_boundary_passed: true
    })
  });
  const published = advanceReadingFirstJournal(verified, {
    to: "PUBLISHED", receipt: receipt("publish", {
      verified_receipt_ref: "synthetic:verified",
      authorized_publication_ref: "synthetic:separately-confirmed-publication"
    })
  });
  assert.equal(published.phase, "PUBLISHED");
  assert.equal(published.publication_scope, "COMPLETE");
  assert.deepEqual(published.source_coverage, {
    reviewed: 3, pending: 0, private_coverage_ref: "synthetic:coverage:1"
  });
  assert.equal(source.phase, "SOURCE_STAGED", "state transitions never mutate prior snapshots");
});

test("metadata-only inventory cannot stand in for actual source reading", () => {
  const inv = inventory(start());
  assert.throws(() => advanceReadingFirstJournal(inv, {
    to: "READING_DISPOSITIONED",
    receipt: receipt("reading", {
      actual_source_reading: false, private_coverage_ref: "synthetic:coverage:1",
      page_dispositions: [reviewed(1), reviewed(2), reviewed(3)]
    })
  }), { code: "JOURNAL_READING_FIRST_ACTUAL_READING_REQUIRED" });
  assert.equal(inv.phase, "SOURCE_INVENTORIED");
});

test("page coverage rejects duplicates, gaps, and review without a source-reading receipt", () => {
  const inv = inventory(start());
  assert.throws(() => read(inv, [reviewed(1), reviewed(2)]), {
    code: "JOURNAL_READING_FIRST_COVERAGE_INCOMPLETE"
  });
  assert.throws(() => read(inv, [reviewed(1), reviewed(2), reviewed(2)]), {
    code: "JOURNAL_READING_FIRST_COVERAGE_INVALID"
  });
  assert.throws(() => read(inv, [reviewed(1), reviewed(2),
    { page: 3, status: "REVIEWED_ALL_SOURCE_MODALITIES" }]), {
    code: "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED"
  });
});

test("unreviewed image/refused segments cannot be silently made a complete index", () => {
  const inv = inventory(start());
  const reading = read(inv, [reviewed(1), pending(2, "visual_pending"), pending(3, "tool_refused")]);
  const synthesis = synthesized(reading);
  assert.throws(() => indexed(synthesis), { code: "JOURNAL_READING_FIRST_REVIEW_PENDING" });
  assert.equal(reading.source_coverage.pending, 2);
  assert.equal(synthesis.phase, "LONGITUDINAL_SYNTHESIZED");
  assert.equal(synthesis.milestone_receipts.INDEX_BUILT, undefined);
});

test("source or revision mismatch cannot certify a new index or graph", () => {
  const a = inventory(start());
  assert.throws(() => advanceReadingFirstJournal(a, {
    to: "READING_DISPOSITIONED",
    receipt: { ...receipt("reading"), source_sha256: "b".repeat(64),
      actual_source_reading: true, private_coverage_ref: "synthetic:coverage:1",
      page_dispositions: [reviewed(1), reviewed(2), reviewed(3)] }
  }), { code: "JOURNAL_READING_FIRST_SOURCE_BINDING_MISMATCH" });
  const synthesis = synthesized(read(a, [reviewed(1), reviewed(2), reviewed(3)]));
  assert.throws(() => advanceReadingFirstJournal(synthesis, {
    to: "INDEX_BUILT", receipt: receipt("index", {
      synthesis_receipt_ref: "wrong-revision", original_source_pointers_preserved: true,
      read_derived_facets_included: true, index_generation: "synthetic:index:1" })
  }), { code: "JOURNAL_READING_FIRST_INDEX_PRECONDITION_FAILED" });
  const index = indexed(synthesis);
  assert.throws(() => advanceReadingFirstJournal(index, {
    to: "GRAPH_BUILT", receipt: receipt("graph", {
      index_receipt_ref: "stale-index", graph_generation: "synthetic:graph:1",
      source_linked_events: true, uncertainty_and_actor_provenance_preserved: true
    })
  }), { code: "JOURNAL_READING_FIRST_GRAPH_PRECONDITION_FAILED" });
});

test("validation and publication require exact prior receipts", () => {
  const index = indexed(synthesized(read(inventory(start()), [reviewed(1), reviewed(2), reviewed(3)])));
  const graph = advanceReadingFirstJournal(index, { to: "GRAPH_BUILT",
    receipt: receipt("graph", { index_receipt_ref: "synthetic:index", graph_generation: "synthetic:graph",
      source_linked_events: true, uncertainty_and_actor_provenance_preserved: true }) });
  assert.throws(() => advanceReadingFirstJournal(graph, {
    to: "VERIFIED", receipt: receipt("verified", { graph_receipt_ref: "synthetic:graph",
      retrieval_cross_span_passed: false, source_fidelity_passed: true, private_boundary_passed: true })
  }), { code: "JOURNAL_READING_FIRST_VERIFY_FAILED" });
  const ok = advanceReadingFirstJournal(graph, {
    to: "VERIFIED", receipt: receipt("verified", {
      graph_receipt_ref: "synthetic:graph", retrieval_cross_span_passed: true,
      source_fidelity_passed: true, private_boundary_passed: true })
  });
  assert.throws(() => advanceReadingFirstJournal(ok, {
    to: "PUBLISHED", receipt: receipt("publish", { verified_receipt_ref: "synthetic:verified" })
  }), { code: "JOURNAL_READING_FIRST_PUBLICATION_NOT_AUTHORIZED" });
});
