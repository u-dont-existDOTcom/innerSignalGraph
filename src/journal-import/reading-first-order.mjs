import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

// New-generation candidate only. Live legacy quote/graph generations are untouched.
// Only a trusted private importer may hold the receipt attestation secret.
// The reader must issue signed receipts AFTER verifying source and reviewing
// all applicable modalities; this check cannot itself perform semantic reading.
export const JOURNAL_READING_FIRST_STAGES = Object.freeze([
  "SOURCE_STAGED", "SOURCE_INVENTORIED", "READING_DISPOSITIONED",
  "LONGITUDINAL_SYNTHESIZED", "INDEX_BUILT", "GRAPH_BUILT", "VERIFIED", "PUBLISHED"
]);

const DIGEST = /^[0-9a-f]{64}$/;
const MODALITIES = new Set(["text", "image", "text+image"]);
const PENDING_REASONS = new Set([
  "tool_refused", "visual_pending", "consent_pending",
  "qualified_review_pending", "source_unavailable",
  // A page the run config gives to an authorized reviewer, and a page the reader could not read as asked.
  "operator_review_requested", "reader_output_invalid", "reader_evidence_invalid", "reader_unavailable"
]);
// How a reviewed page was reviewed: by the source reader, or by an authorized operator review. Rows from before the
// route was recorded carry neither.
const REVIEW_ROUTES = new Set(["source_reader", "authorized_operator_review"]);

function invariant(ok, code) {
  if (!ok) throw new ValidationError(code, { code });
}
function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 320;
}
function digest(value) {
  return typeof value === "string" && DIGEST.test(value);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

// Canonical payload for a source-stage attestation by a separately trusted
// private reader/archiver. This module VERIFYs signatures; it does not sign
// arbitrary source/model replies or grant access to the source or to the key.
export function readingFirstAttestationPayload(to, receipt) {
  invariant(JOURNAL_READING_FIRST_STAGES.includes(to), "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID");
  invariant(receipt && typeof receipt === "object" && !Array.isArray(receipt),
    "JOURNAL_READING_FIRST_RECEIPT_REQUIRED");
  const { attestation_hmac_sha256, ...payload } = receipt;
  return JSON.stringify(stable({ domain: "inner-signal-reading-first-stage-v1", stage: to, receipt: payload }));
}

function authenticateReceipt(to, receipt, key) {
  invariant(key instanceof Uint8Array && key.byteLength >= 32,
    "JOURNAL_READING_FIRST_ATTESTOR_UNAVAILABLE");
  invariant(digest(receipt?.attestation_hmac_sha256),
    "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED");
  const expected = createHmac("sha256", key).update(readingFirstAttestationPayload(to, receipt), "utf8").digest();
  const actual = Buffer.from(receipt.attestation_hmac_sha256, "hex");
  invariant(actual.length === 32 && timingSafeEqual(expected, actual),
    "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED");
}
function requirePageIdentity(entry, page) {
  invariant(entry?.page === page && digest(entry?.source_page_sha256),
    "JOURNAL_READING_FIRST_PAGE_BINDING_INVALID");
}
function checkInventory(receipt, pages) {
  invariant(receipt?.page_count === pages && receipt?.source_inventory_complete === true,
    "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  invariant(Array.isArray(receipt?.source_pages) && receipt.source_pages.length === pages,
    "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  for (let n = 1; n <= pages; n += 1) {
    const e = receipt.source_pages[n - 1];
    requirePageIdentity(e, n);
    invariant(MODALITIES.has(e.required_modalities), "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  }
  // Store only verified source identities and required modalities, not text.
  return receipt.source_pages.map((e) => ({
    page: e.page, source_page_sha256: e.source_page_sha256,
    required_modalities: e.required_modalities
  }));
}
function checkCoverage(receipt, sourcePages) {
  const rows = receipt?.page_dispositions;
  invariant(Array.isArray(rows) && rows.length === sourcePages.length,
    "JOURNAL_READING_FIRST_COVERAGE_INCOMPLETE");
  invariant(nonempty(receipt?.private_coverage_ref),
    "JOURNAL_READING_FIRST_COVERAGE_REF_REQUIRED");
  let reviewed = 0;
  let pending = 0;
  for (let i = 0; i < sourcePages.length; i += 1) {
    const entry = rows[i];
    const original = sourcePages[i];
    requirePageIdentity(entry, i + 1);
    invariant(entry.source_page_sha256 === original.source_page_sha256,
      "JOURNAL_READING_FIRST_PAGE_BINDING_INVALID");
    if (entry.status === "REVIEW_PENDING") {
      pending += 1;
      invariant(PENDING_REASONS.has(entry.reason),
        "JOURNAL_READING_FIRST_PENDING_REASON_REQUIRED");
    } else {
      invariant(entry.status === "REVIEWED_ALL_SOURCE_MODALITIES",
        "JOURNAL_READING_FIRST_COVERAGE_INVALID");
      reviewed += 1;
      invariant(nonempty(entry.source_read_receipt_ref) &&
        digest(entry.read_result_sha256) &&
        entry.reviewed_modalities === original.required_modalities,
        "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED");
      invariant(entry.review_route === undefined || REVIEW_ROUTES.has(entry.review_route),
        "JOURNAL_READING_FIRST_COVERAGE_INVALID");
    }
  }
  return { reviewed, pending, private_coverage_ref: receipt.private_coverage_ref };
}

export function initializeReadingFirstJournal({ source_sha256, page_count, generation, archive_receipt_ref }) {
  invariant(digest(source_sha256) && Number.isSafeInteger(page_count) && page_count > 0 &&
    nonempty(generation) && nonempty(archive_receipt_ref),
    "JOURNAL_READING_FIRST_SOURCE_INVALID");
  return {
    schema_version: 1, generation, source_sha256, page_count, phase: "SOURCE_STAGED",
    archive_receipt_ref, source_inventory: null,
    source_coverage: null, milestone_receipts: {}, publication_scope: null
  };
}

export function advanceReadingFirstJournal(state, { to, receipt }, { attestationSecret } = {}) {
  invariant(state?.schema_version === 1 && JOURNAL_READING_FIRST_STAGES.includes(state?.phase),
    "JOURNAL_READING_FIRST_STATE_INVALID");
  const next = JOURNAL_READING_FIRST_STAGES[JOURNAL_READING_FIRST_STAGES.indexOf(state.phase) + 1];
  invariant(next === to, "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID");
  invariant(receipt?.source_sha256 === state.source_sha256 && receipt?.generation === state.generation,
    "JOURNAL_READING_FIRST_SOURCE_BINDING_MISMATCH");
  invariant(nonempty(receipt?.receipt_ref), "JOURNAL_READING_FIRST_RECEIPT_REQUIRED");
  authenticateReceipt(to, receipt, attestationSecret);

  let sourceInventory = state.source_inventory;
  let sourceCoverage = state.source_coverage;
  if (to === "SOURCE_INVENTORIED") {
    sourceInventory = checkInventory(receipt, state.page_count);
  }
  if (to === "READING_DISPOSITIONED") {
    invariant(Array.isArray(sourceInventory) && sourceInventory.length === state.page_count,
      "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
    // This stage's signature is supplied only by an authorized private reading
    // adapter AFTER its input and output were actually delivered and persisted.
    sourceCoverage = checkCoverage(receipt, sourceInventory);
  }
  if (to === "LONGITUDINAL_SYNTHESIZED") {
    invariant(nonempty(receipt.synthesis_evidence_ref) &&
      receipt.reading_receipt_ref === state.milestone_receipts.READING_DISPOSITIONED &&
      receipt.known_vs_new_reconciled === true &&
      receipt.longitudinal_counterexamples_checked === true,
      "JOURNAL_READING_FIRST_SYNTHESIS_INCOMPLETE");
  }
  if (to === "INDEX_BUILT") {
    // Complete new index/graph cannot be built with unread original material.
    // Partial generation requires an independently approved, explicitly
    // scoped contract; this candidate does NOT provide a partial bypass.
    invariant(sourceCoverage?.pending === 0, "JOURNAL_READING_FIRST_REVIEW_PENDING");
    invariant(receipt.synthesis_receipt_ref === state.milestone_receipts.LONGITUDINAL_SYNTHESIZED &&
      nonempty(receipt.index_generation) &&
      receipt.original_source_pointers_preserved === true &&
      receipt.read_derived_facets_included === true,
      "JOURNAL_READING_FIRST_INDEX_PRECONDITION_FAILED");
  }
  if (to === "GRAPH_BUILT") {
    invariant(receipt.index_receipt_ref === state.milestone_receipts.INDEX_BUILT &&
      nonempty(receipt.graph_generation) &&
      receipt.source_linked_events === true &&
      receipt.uncertainty_and_actor_provenance_preserved === true,
      "JOURNAL_READING_FIRST_GRAPH_PRECONDITION_FAILED");
  }
  if (to === "VERIFIED") {
    invariant(receipt.graph_receipt_ref === state.milestone_receipts.GRAPH_BUILT &&
      receipt.retrieval_cross_span_passed === true &&
      receipt.source_fidelity_passed === true &&
      receipt.private_boundary_passed === true,
      "JOURNAL_READING_FIRST_VERIFY_FAILED");
  }
  if (to === "PUBLISHED") {
    invariant(receipt.verified_receipt_ref === state.milestone_receipts.VERIFIED &&
      nonempty(receipt.authorized_publication_ref),
      "JOURNAL_READING_FIRST_PUBLICATION_NOT_AUTHORIZED");
  }
  return {
    ...state, phase: to, source_inventory: sourceInventory,
    source_coverage: sourceCoverage,
    milestone_receipts: { ...state.milestone_receipts, [to]: receipt.receipt_ref },
    publication_scope: to === "PUBLISHED" ? "COMPLETE" : state.publication_scope
  };
}
