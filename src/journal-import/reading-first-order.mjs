import { ValidationError } from "../core/errors.mjs";

// Candidate for NEW journal generations only. The currently published quote/graph
// generations remain usable and are not retroactively restricted by this helper.
// The importer must bind receipts to real private source-reading operations;
// a marker or this deterministic check does not itself prove semantic reading.
export const JOURNAL_READING_FIRST_STAGES = Object.freeze([
  "SOURCE_STAGED",
  "SOURCE_INVENTORIED",
  "READING_DISPOSITIONED",
  "LONGITUDINAL_SYNTHESIZED",
  "INDEX_BUILT",
  "GRAPH_BUILT",
  "VERIFIED",
  "PUBLISHED"
]);

const DIGEST = /^[0-9a-f]{64}$/;
const PAGE_STATUSES = new Set(["REVIEWED_ALL_SOURCE_MODALITIES", "REVIEW_PENDING"]);
const PENDING_REASONS = new Set(["tool_refused", "visual_pending", "consent_pending", "qualified_review_pending", "source_unavailable"]);

function requireCondition(value, code) {
  if (!value) throw new ValidationError(code, { code });
}
function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 320;
}
function requireDigest(value) {
  requireCondition(typeof value === "string" && DIGEST.test(value), "JOURNAL_READING_FIRST_SOURCE_INVALID");
}
function validateCoverage(receipt, total) {
  const pages = receipt?.page_dispositions;
  requireCondition(Array.isArray(pages) && pages.length === total, "JOURNAL_READING_FIRST_COVERAGE_INCOMPLETE");
  let reviewed = 0;
  let pending = 0;
  for (let index = 0; index < total; index += 1) {
    const item = pages[index];
    requireCondition(item?.page === index + 1 && PAGE_STATUSES.has(item.status), "JOURNAL_READING_FIRST_COVERAGE_INVALID");
    if (item.status === "REVIEW_PENDING") {
      pending += 1;
      requireCondition(PENDING_REASONS.has(item.reason), "JOURNAL_READING_FIRST_PENDING_REASON_REQUIRED");
    } else {
      reviewed += 1;
      requireCondition(nonempty(item.source_read_receipt_ref), "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED");
    }
  }
  requireCondition(nonempty(receipt?.private_coverage_ref), "JOURNAL_READING_FIRST_COVERAGE_REF_REQUIRED");
  return { reviewed, pending, private_coverage_ref: receipt.private_coverage_ref };
}

export function initializeReadingFirstJournal({ source_sha256, page_count, generation, archive_receipt_ref }) {
  requireDigest(source_sha256);
  requireCondition(Number.isSafeInteger(page_count) && page_count > 0, "JOURNAL_READING_FIRST_PAGE_COUNT_INVALID");
  requireCondition(nonempty(generation) && nonempty(archive_receipt_ref), "JOURNAL_READING_FIRST_SOURCE_INVALID");
  return {
    schema_version: 1, generation, source_sha256, page_count, phase: "SOURCE_STAGED",
    archive_receipt_ref, milestone_receipts: {}, source_coverage: null, publication_scope: null
  };
}

export function advanceReadingFirstJournal(state, { to, receipt }) {
  requireCondition(state?.schema_version === 1 && JOURNAL_READING_FIRST_STAGES.includes(state?.phase), "JOURNAL_READING_FIRST_STATE_INVALID");
  const index = JOURNAL_READING_FIRST_STAGES.indexOf(state.phase);
  const next = JOURNAL_READING_FIRST_STAGES[index + 1];
  requireCondition(to === next, "JOURNAL_READING_FIRST_STAGE_ORDER_INVALID");
  requireCondition(receipt?.source_sha256 === state.source_sha256 && receipt?.generation === state.generation,
    "JOURNAL_READING_FIRST_SOURCE_BINDING_MISMATCH");
  requireCondition(nonempty(receipt?.receipt_ref), "JOURNAL_READING_FIRST_RECEIPT_REQUIRED");

  let coverage = state.source_coverage;
  if (to === "SOURCE_INVENTORIED") {
    requireCondition(receipt.page_count === state.page_count && receipt.source_inventory_complete === true,
      "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  }
  if (to === "READING_DISPOSITIONED") {
    coverage = validateCoverage(receipt, state.page_count);
    requireCondition(receipt.actual_source_reading === true,
      "JOURNAL_READING_FIRST_ACTUAL_READING_REQUIRED");
  }
  if (to === "LONGITUDINAL_SYNTHESIZED") {
    requireCondition(nonempty(receipt.synthesis_evidence_ref) &&
      receipt.reading_receipt_ref === state.milestone_receipts.READING_DISPOSITIONED &&
      receipt.known_vs_new_reconciled === true && receipt.longitudinal_counterexamples_checked === true,
      "JOURNAL_READING_FIRST_SYNTHESIS_INCOMPLETE");
  }
  if (to === "INDEX_BUILT") {
    // No user-visible COMPLETE new generation can be indexed from unread
    // content. Authorized partial publication requires a separately designed
    // owner-approved and authenticated scope; it is not implicit here.
    requireCondition(coverage?.pending === 0, "JOURNAL_READING_FIRST_REVIEW_PENDING");
    requireCondition(receipt.synthesis_receipt_ref === state.milestone_receipts.LONGITUDINAL_SYNTHESIZED &&
      nonempty(receipt.index_generation) && receipt.original_source_pointers_preserved === true &&
      receipt.read_derived_facets_included === true, "JOURNAL_READING_FIRST_INDEX_PRECONDITION_FAILED");
  }
  if (to === "GRAPH_BUILT") {
    requireCondition(receipt.index_receipt_ref === state.milestone_receipts.INDEX_BUILT &&
      nonempty(receipt.graph_generation) && receipt.source_linked_events === true &&
      receipt.uncertainty_and_actor_provenance_preserved === true,
      "JOURNAL_READING_FIRST_GRAPH_PRECONDITION_FAILED");
  }
  if (to === "VERIFIED") {
    requireCondition(receipt.graph_receipt_ref === state.milestone_receipts.GRAPH_BUILT &&
      receipt.retrieval_cross_span_passed === true && receipt.source_fidelity_passed === true &&
      receipt.private_boundary_passed === true, "JOURNAL_READING_FIRST_VERIFY_FAILED");
  }
  if (to === "PUBLISHED") {
    requireCondition(receipt.verified_receipt_ref === state.milestone_receipts.VERIFIED &&
      nonempty(receipt.authorized_publication_ref), "JOURNAL_READING_FIRST_PUBLICATION_NOT_AUTHORIZED");
  }
  const nextState = {
    ...state, phase: to, source_coverage: coverage,
    milestone_receipts: { ...state.milestone_receipts, [to]: receipt.receipt_ref },
    publication_scope: to === "PUBLISHED" ? "COMPLETE" : state.publication_scope
  };
  return nextState;
}
