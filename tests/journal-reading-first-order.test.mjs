import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  JOURNAL_READING_FIRST_STAGES,
  initializeReadingFirstJournal,
  advanceReadingFirstJournal,
  readingFirstAttestationPayload
} from "../src/journal-import/reading-first-order.mjs";

// Every identifier and document/page digest in these tests is synthetic.
// This local test signer represents an isolated authorized source-reading
// service; no model or user-controlled tool may receive this key in production.
const SOURCE = "a".repeat(64);
const SECRET = Buffer.alloc(32, 0x53);
const GEN = "synthetic:reading-first:v1";
const PAGE_HASHES = ["1", "2", "3"].map((s) => s.repeat(64));
const MODES = ["text", "text+image", "image"];

const start = () => initializeReadingFirstJournal({
  source_sha256: SOURCE, page_count: 3, generation: GEN,
  archive_receipt_ref: "synthetic:archive:1"
});
function signed(stage, data = {}) {
  const receipt = {
    source_sha256: SOURCE, generation: GEN, receipt_ref: "synthetic:" + stage, ...data
  };
  return {
    ...receipt,
    attestation_hmac_sha256: createHmac("sha256", SECRET)
      .update(readingFirstAttestationPayload(stage, receipt), "utf8").digest("hex")
  };
}
function transition(state, to, data = {}) {
  return advanceReadingFirstJournal(state, {
    to, receipt: signed(to, data)
  }, { attestationSecret: SECRET });
}
const inventoryRows = () => PAGE_HASHES.map((sha, i) => ({
  page: i + 1, source_page_sha256: sha, required_modalities: MODES[i]
}));
const inventory = (state) => transition(state, "SOURCE_INVENTORIED", {
  page_count: 3, source_inventory_complete: true, source_pages: inventoryRows()
});
const reviewed = (page) => ({
  page,
  status: "REVIEWED_ALL_SOURCE_MODALITIES",
  source_page_sha256: PAGE_HASHES[page - 1],
  source_read_receipt_ref: "synthetic:read:" + page,
  read_result_sha256: "f".repeat(64),
  reviewed_modalities: MODES[page - 1]
});
const pending = (page, reason) => ({
  page, status: "REVIEW_PENDING", source_page_sha256: PAGE_HASHES[page - 1], reason
});
const read = (state, page_dispositions) => transition(state, "READING_DISPOSITIONED", {
  private_coverage_ref: "synthetic:coverage:1", page_dispositions
});
const synthesized = (state) => transition(state, "LONGITUDINAL_SYNTHESIZED", {
  reading_receipt_ref: "synthetic:READING_DISPOSITIONED",
  synthesis_evidence_ref: "synthetic:evidence:1",
  known_vs_new_reconciled: true, longitudinal_counterexamples_checked: true
});
const indexed = (state) => transition(state, "INDEX_BUILT", {
  synthesis_receipt_ref: "synthetic:LONGITUDINAL_SYNTHESIZED",
  index_generation: "synthetic:index:1",
  original_source_pointers_preserved: true, read_derived_facets_included: true
});
const allRead = (state) => read(state, [reviewed(1), reviewed(2), reviewed(3)]);

test("stages require source → reading → synthesis → index → graph in that order", () => {
  const source = start();
  assert.deepEqual(JOURNAL_READING_FIRST_STAGES, [
    "SOURCE_STAGED", "SOURCE_INVENTORIED", "READING_DISPOSITIONED",
    "LONGITUDINAL_SYNTHESIZED", "INDEX_BUILT", "GRAPH_BUILT", "VERIFIED", "PUBLISHED"
  ]);
  assert.throws(() => transition(source, "INDEX_BUILT", {
    index_generation: "synthetic:index:early"
  }), { code: "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID" });
  const inv = inventory(source);
  assert.throws(() => transition(inv, "LONGITUDINAL_SYNTHESIZED"),
    { code: "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID" });
  assert.equal(source.phase, "SOURCE_STAGED", "no prior state mutated");
});

test("every stage requires a protected attestation key and authentic signed receipt", () => {
  const source = start();
  const receipt = signed("SOURCE_INVENTORIED", {
    page_count: 3, source_inventory_complete: true, source_pages: inventoryRows()
  });
  assert.throws(() => advanceReadingFirstJournal(source, {
    to: "SOURCE_INVENTORIED", receipt
  }), { code: "JOURNAL_READING_FIRST_ATTESTOR_UNAVAILABLE" });
  assert.throws(() => advanceReadingFirstJournal(source, {
    to: "SOURCE_INVENTORIED", receipt
  }, { attestationSecret: Buffer.alloc(32, 0x77) }),
  { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
  const falsified = { ...receipt, source_inventory_complete: false };
  assert.throws(() => advanceReadingFirstJournal(source, {
    to: "SOURCE_INVENTORIED", receipt: falsified
  }, { attestationSecret: SECRET }), { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
  assert.equal(inventory(source).phase, "SOURCE_INVENTORIED");
});

test("the actual source-page identity and media modalities are mandatory", () => {
  const inv = inventory(start());
  assert.throws(() => read(inv, [reviewed(1), reviewed(2)]), {
    code: "JOURNAL_READING_FIRST_COVERAGE_INCOMPLETE"
  });
  assert.throws(() => read(inv, [reviewed(1), reviewed(2), reviewed(2)]), {
    code: "JOURNAL_READING_FIRST_PAGE_BINDING_INVALID"
  });
  assert.throws(() => read(inv, [
    reviewed(1), reviewed(2), {
      ...reviewed(3), reviewed_modalities: "text"
    }
  ]), { code: "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED" });
  assert.throws(() => read(inv, [
    reviewed(1), reviewed(2), {
      ...reviewed(3), source_page_sha256: "0".repeat(64)
    }
  ]), { code: "JOURNAL_READING_FIRST_PAGE_BINDING_INVALID" });
  assert.throws(() => read(inv, [
    reviewed(1), reviewed(2), {
      ...reviewed(3), read_result_sha256: undefined
    }
  ]), { code: "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED" });
});

test("an untrusted unsigned claim that reading is complete cannot advance", () => {
  const inv = inventory(start());
  const claim = {
    source_sha256: SOURCE, generation: GEN, receipt_ref: "synthetic:READING_DISPOSITIONED",
    actual_source_reading: true, private_coverage_ref: "synthetic:coverage:1",
    page_dispositions: [reviewed(1), reviewed(2), reviewed(3)]
  };
  assert.throws(() => advanceReadingFirstJournal(inv, {
    to: "READING_DISPOSITIONED", receipt: claim
  }, { attestationSecret: SECRET }), { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
});

test("refused and image-pending source cannot be silently indexed as complete", () => {
  const inv = inventory(start());
  const r = read(inv, [reviewed(1), pending(2, "visual_pending"), pending(3, "tool_refused")]);
  assert.deepEqual(r.source_coverage, {
    reviewed: 1, pending: 2, private_coverage_ref: "synthetic:coverage:1"
  });
  const s = synthesized(r);
  assert.throws(() => indexed(s), { code: "JOURNAL_READING_FIRST_REVIEW_PENDING" });
  assert.equal(s.milestone_receipts.INDEX_BUILT, undefined);
});

test("a page waiting for an authorized review or the reader's failure is pending for its own reason and blocks the index", () => {
  const inv = inventory(start());
  for (const reason of ["operator_review_requested", "reader_output_invalid", "reader_evidence_invalid", "reader_unavailable"]) {
    const r = read(inv, [reviewed(1), pending(2, reason), reviewed(3)]);
    assert.equal(r.source_coverage.pending, 1, reason);
    assert.throws(() => indexed(synthesized(r)), { code: "JOURNAL_READING_FIRST_REVIEW_PENDING" }, reason);
  }
  // A reason the importer does not name is still no reason.
  assert.throws(() => read(inv, [reviewed(1), pending(2, "someone_said_so"), reviewed(3)]),
    { code: "JOURNAL_READING_FIRST_PENDING_REASON_REQUIRED" });
  assert.throws(() => read(inv, [reviewed(1), { ...pending(2, "visual_pending"), reason: undefined }, reviewed(3)]),
    { code: "JOURNAL_READING_FIRST_PENDING_REASON_REQUIRED" });
});

test("a reviewed page may name the route that reviewed it, only one of the two routes, and the route is signed with the receipt", () => {
  const inv = inventory(start());
  for (const route of ["source_reader", "authorized_operator_review", undefined]) {
    const r = read(inv, [reviewed(1), { ...reviewed(2), review_route: route }, reviewed(3)]);
    assert.deepEqual(r.source_coverage, { reviewed: 3, pending: 0, private_coverage_ref: "synthetic:coverage:1" }, String(route));
    assert.equal(indexed(synthesized(r)).phase, "INDEX_BUILT", String(route));
  }
  for (const route of ["operator", "", null, "SOURCE_READER", 3])
    assert.throws(() => read(inv, [reviewed(1), { ...reviewed(2), review_route: route }, reviewed(3)]),
      { code: "JOURNAL_READING_FIRST_COVERAGE_INVALID" }, String(route));
  // The route does not stand in for what a reviewed page must still carry.
  assert.throws(() => read(inv, [reviewed(1), { ...reviewed(2), review_route: "authorized_operator_review", reviewed_modalities: "text" }, reviewed(3)]),
    { code: "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED" });
  assert.throws(() => read(inv, [reviewed(1), { ...reviewed(2), review_route: "authorized_operator_review", read_result_sha256: undefined }, reviewed(3)]),
    { code: "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED" });
  // The route is signed with the rest of the receipt: relabelling a signed row breaks the signature.
  const receipt = signed("READING_DISPOSITIONED", { private_coverage_ref: "synthetic:coverage:1",
    page_dispositions: [reviewed(1), { ...reviewed(2), review_route: "source_reader" }, reviewed(3)] });
  const relabelled = structuredClone(receipt);
  relabelled.page_dispositions[1].review_route = "authorized_operator_review";
  assert.throws(() => advanceReadingFirstJournal(inv, { to: "READING_DISPOSITIONED", receipt: relabelled }, { attestationSecret: SECRET }),
    { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
  assert.equal(advanceReadingFirstJournal(inv, { to: "READING_DISPOSITIONED", receipt }, { attestationSecret: SECRET }).phase, "READING_DISPOSITIONED");
});

test("correctly attested chronological reading can yield index, graph, verification and publication", () => {
  const initial = start();
  const index = indexed(synthesized(allRead(inventory(initial))));
  const graph = transition(index, "GRAPH_BUILT", {
    index_receipt_ref: "synthetic:INDEX_BUILT", graph_generation: "synthetic:graph:1",
    source_linked_events: true, uncertainty_and_actor_provenance_preserved: true
  });
  const verified = transition(graph, "VERIFIED", {
    graph_receipt_ref: "synthetic:GRAPH_BUILT", retrieval_cross_span_passed: true,
    source_fidelity_passed: true, private_boundary_passed: true
  });
  const published = transition(verified, "PUBLISHED", {
    verified_receipt_ref: "synthetic:VERIFIED",
    authorized_publication_ref: "synthetic:private-authorization:1"
  });
  assert.equal(initial.phase, "SOURCE_STAGED");
  assert.equal(published.phase, "PUBLISHED");
  assert.equal(published.publication_scope, "COMPLETE");
  assert.equal(published.source_coverage.pending, 0);
  assert.equal(published.source_coverage.reviewed, 3);
});

test("read and synthesis receipts must bind to this source generation", () => {
  const inv = inventory(start());
  assert.throws(() => advanceReadingFirstJournal(inv, {
    to: "READING_DISPOSITIONED",
    receipt: signed("READING_DISPOSITIONED", {
      generation: "synthetic:wrong-generation", private_coverage_ref: "synthetic:coverage:1",
      page_dispositions: [reviewed(1), reviewed(2), reviewed(3)]
    })
  }, { attestationSecret: SECRET }), { code: "JOURNAL_READING_FIRST_SOURCE_BINDING_MISMATCH" });
  const s = synthesized(allRead(inv));
  assert.throws(() => transition(s, "INDEX_BUILT", {
    synthesis_receipt_ref: "synthetic:stale-synthesis",
    index_generation: "synthetic:index:1",
    original_source_pointers_preserved: true, read_derived_facets_included: true
  }), { code: "JOURNAL_READING_FIRST_INDEX_PRECONDITION_FAILED" });
  const index = indexed(s);
  assert.throws(() => transition(index, "GRAPH_BUILT", {
    index_receipt_ref: "synthetic:stale-index", graph_generation: "synthetic:graph:1",
    source_linked_events: true, uncertainty_and_actor_provenance_preserved: true
  }), { code: "JOURNAL_READING_FIRST_GRAPH_PRECONDITION_FAILED" });
});

test("generation verification and publication remain independent gates", () => {
  const index = indexed(synthesized(allRead(inventory(start()))));
  const graph = transition(index, "GRAPH_BUILT", {
    index_receipt_ref: "synthetic:INDEX_BUILT", graph_generation: "synthetic:graph:1",
    source_linked_events: true, uncertainty_and_actor_provenance_preserved: true
  });
  assert.throws(() => transition(graph, "VERIFIED", {
    graph_receipt_ref: "synthetic:GRAPH_BUILT", retrieval_cross_span_passed: false,
    source_fidelity_passed: true, private_boundary_passed: true
  }), { code: "JOURNAL_READING_FIRST_VERIFY_FAILED" });
  const verified = transition(graph, "VERIFIED", {
    graph_receipt_ref: "synthetic:GRAPH_BUILT", retrieval_cross_span_passed: true,
    source_fidelity_passed: true, private_boundary_passed: true
  });
  assert.throws(() => transition(verified, "PUBLISHED", {
    verified_receipt_ref: "synthetic:VERIFIED"
  }), { code: "JOURNAL_READING_FIRST_PUBLICATION_NOT_AUTHORIZED" });
});
