import { createHash, createHmac } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { readingFirstAttestationPayload } from "./reading-first-order.mjs";
import { verifiedReadingFirstSynthesis } from "./reading-first-runtime-gate.mjs";

// Source pages must come from a separately authorized, hash-checked private
// archive. Model outputs cannot sign receipts or create private access.
const hash = x => createHash("sha256").update(x).digest("hex");
const invariant = (ok, code) => { if (!ok) throw new ValidationError(code, { code }); };
const nonempty = x => typeof x === "string" && x.trim().length > 0 && x.length <= 320;
const meaningfulProse = (x, max) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const HEX64 = /^[a-f0-9]{64}$/;

function attest(stage, receipt, key) {
  return {
    stage, receipt: { ...receipt,
      attestation_hmac_sha256: createHmac("sha256", key)
        .update(readingFirstAttestationPayload(stage, receipt)).digest("hex")
    }
  };
}
function verifiedInventory(pages) {
  invariant(Array.isArray(pages) && pages.length > 0, "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
  return pages.map((page, i) => {
    invariant(page?.page === i + 1 && typeof page.text === "string" &&
      HEX64.test(page.source_page_sha256) &&
      ["text", "image", "text+image"].includes(page.required_modalities),
      "JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE");
    if (page.required_modalities === "text") {
      invariant(hash(page.text) === page.source_page_sha256,
        "JOURNAL_READING_FIRST_PAGE_BINDING_INVALID");
    }
    return { page: page.page, source_page_sha256: page.source_page_sha256,
      required_modalities: page.required_modalities };
  });
}
function verifyTextEvidence(page, observation) {
  invariant(observation?.page === page.page &&
    observation?.source_page_sha256 === page.source_page_sha256 &&
    observation?.source_read_complete === true &&
    observation?.reviewed_modalities === page.required_modalities &&
    meaningfulProse(observation?.source_specific_understanding, 2500) &&
    Array.isArray(observation.exact_source_anchors),
    "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED");
  if (page.text.trim().length > 0)
    invariant(observation.exact_source_anchors.length > 0, "JOURNAL_READING_FIRST_SOURCE_ANCHOR_REQUIRED");
  // The model need only reproduce exact quotations, never invent offsets.
  // The trusted source reader locates the correct occurrence deterministically.
  const anchors = observation.exact_source_anchors.map((e) => {
    invariant(typeof e.exact_text === "string" && e.exact_text.length > 0,
      "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID");
    if (Number.isSafeInteger(e.start) && Number.isSafeInteger(e.end)) {
      invariant(e.start >= 0 && e.end > e.start && e.end <= page.text.length &&
        page.text.slice(e.start,e.end) === e.exact_text,
        "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID");
      return { start:e.start,end:e.end,exact_text:e.exact_text };
    }
    invariant(e.start === undefined && e.end === undefined &&
      (e.occurrence === null || Number.isSafeInteger(e.occurrence) && e.occurrence >= 0),
      "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID");
    const matches = [];
    for (let i = 0, at; (at = page.text.indexOf(e.exact_text, i)) >= 0; i = at + 1) matches.push(at);
    invariant(matches.length > 0 &&
      (e.occurrence !== null || matches.length === 1) &&
      (e.occurrence === null || e.occurrence < matches.length),
      "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID");
    const start = matches[e.occurrence ?? 0];
    return { start, end:start+e.exact_text.length,exact_text:e.exact_text };
  });
  invariant(Array.isArray(observation.source_findings) &&
    observation.source_findings.length > 0,
    "JOURNAL_READING_FIRST_SOURCE_FINDINGS_REQUIRED");
  const findings = observation.source_findings.map((item) => {
    invariant(typeof item?.statement === "string" &&
      item.statement.trim().length > 0 && item.statement.length <= 4000 &&
      Array.isArray(item.required_qualifiers) &&
      item.required_qualifiers.every(x => typeof x === "string" && x.length <= 1000) &&
      Array.isArray(item.anchor_indices) && item.anchor_indices.length > 0 &&
      item.anchor_indices.every(n => Number.isSafeInteger(n) &&
        n >= 0 && n < observation.exact_source_anchors.length),
      "JOURNAL_READING_FIRST_SOURCE_FINDINGS_INVALID");
    return {
      statement: item.statement,
      required_qualifiers: [...item.required_qualifiers],
      anchor_indices: [...item.anchor_indices]
    };
  });
  return {
    page: page.page,
    source_page_sha256: page.source_page_sha256,
    source_specific_understanding: observation.source_specific_understanding,
    exact_source_anchors: anchors,
    source_findings: findings,
    reviewed_modalities: observation.reviewed_modalities,
    provenance: "source_bound_model_proposal"
  };
}

/**
 * A candidate trusted stage producer for new reading-first generations.
 * A private adapter owns the source bytes, actual model/human calls and
 * durable encrypted writes; only verified completions can be attested.
 *
 * No automatic retry or alternate encoding of refused source material.
 * Caller must never pass prior tool-refused real source pages for reprocessing.
 * The completion verifier and signer are independent of model outputs.
 */
export async function produceReadingFirstJournal({
  sourceSha256, generation, archiveReceiptRef, pages, attestationKey,
  reader, verifyCompletion, persistEvidence, synthesize, verifySynthesis
}) {
  invariant(HEX64.test(sourceSha256) && nonempty(generation) && nonempty(archiveReceiptRef),
    "JOURNAL_READING_FIRST_SOURCE_INVALID");
  invariant(attestationKey instanceof Uint8Array && attestationKey.byteLength >= 32 &&
    typeof reader === "function" && typeof verifyCompletion === "function" &&
    typeof persistEvidence === "function" && typeof synthesize === "function" &&
    typeof verifySynthesis === "function", "JOURNAL_READING_FIRST_ATTESTOR_UNAVAILABLE");
  const inventory = verifiedInventory(pages);
  const scope = { source_sha256: sourceSha256, generation };
  function r(stage, data) {
    return { ...scope, receipt_ref: "private:" + hash(JSON.stringify({ stage, scope, data })).slice(0,40), ...data };
  }
  const inv = r("SOURCE_INVENTORIED", {
    page_count: pages.length, source_inventory_complete: true, source_pages: inventory
  });
  const statuses = [], evidenceRefs = [];
  for (const page of pages) {
    // Empty extraction isn't source comprehension. It may be a blank page,
    // image-only material, or an unrecognized non-text PDF element. Preserve
    // the page as pending until an authorized modality-aware reviewer checks it.
    if (page.required_modalities !== "text" || page.text.trim().length === 0) {
      statuses.push({ page: page.page, source_page_sha256: page.source_page_sha256,
        status: "REVIEW_PENDING",
        reason: page.required_modalities !== "text" ? "visual_pending" : "source_unavailable" });
      continue;
    }
    let output;
    try {
      output = await reader({ ...scope, page: page.page,
        source_page_sha256: page.source_page_sha256, text: page.text,
        required_modalities: page.required_modalities });
    } catch (error) {
      if (error?.code !== "JOURNAL_SOURCE_TOOL_REFUSED") throw error;
      statuses.push({ page: page.page, source_page_sha256: page.source_page_sha256,
        status: "REVIEW_PENDING", reason: "tool_refused" });
      continue;
    }
    const observation = verifyTextEvidence(page, output?.observation);
    const resultSha = hash(JSON.stringify(observation));
    invariant(await verifyCompletion({ ...scope, page: page.page,
      source_page_sha256: page.source_page_sha256,
      input_sha256: hash(page.text), output_sha256: resultSha,
      provider_receipt: output?.provider_receipt }) === true,
    "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED");
    const saved = await persistEvidence({ ...scope, page: page.page,
      source_page_sha256: page.source_page_sha256, observation });
    invariant(nonempty(saved?.private_reference), "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED");
    evidenceRefs.push({ page: page.page, private_reference: saved.private_reference,
      source_page_sha256: page.source_page_sha256,
      observation_sha256: resultSha });
    statuses.push({ page: page.page, source_page_sha256: page.source_page_sha256,
      status: "REVIEWED_ALL_SOURCE_MODALITIES", reviewed_modalities: "text",
      source_read_receipt_ref: saved.private_reference, read_result_sha256: resultSha });
  }
  invariant(statuses.length === pages.length, "JOURNAL_READING_FIRST_COVERAGE_INCOMPLETE");
  const readReceipt = r("READING_DISPOSITIONED", {
    private_coverage_ref: "private:coverage:" + hash(JSON.stringify(statuses)),
    page_dispositions: statuses
  });
  const summary = await synthesize({ ...scope, page_count: pages.length,
    persisted_source_evidence: evidenceRefs,
    unresolved: statuses.filter(x => x.status === "REVIEW_PENDING").map(x => ({
      page: x.page, reason: x.reason
    })) });
  invariant(summary && meaningfulProse(summary.provisional_longitudinal_summary, 13000) &&
    Array.isArray(summary.source_evidence_refs) &&
    summary.known_vs_new_reconciled === true &&
    summary.longitudinal_counterexamples_checked === true,
    "JOURNAL_READING_FIRST_SYNTHESIS_INCOMPLETE");
  const refs = new Set(evidenceRefs.map(x => x.private_reference));
  invariant(summary.source_evidence_refs.length === refs.size &&
    new Set(summary.source_evidence_refs).size === refs.size &&
    summary.source_evidence_refs.every(x => refs.has(x)),
    "JOURNAL_READING_FIRST_SYNTHESIS_SOURCE_INVALID");
  invariant(await verifySynthesis({ ...scope,
    evidence_refs: evidenceRefs.map(x => x.private_reference),
    output_sha256: hash(JSON.stringify(summary)),
    provider_receipt: summary.provider_receipt }) === true,
    "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED");
  const saved = await persistEvidence({ ...scope,
    phase: "LONGITUDINAL_SYNTHESIZED",
    provisional_synthesis: {
      provisional_longitudinal_summary: summary.provisional_longitudinal_summary,
      source_evidence_refs: summary.source_evidence_refs,
      known_vs_new_reconciled: true, longitudinal_counterexamples_checked: true
    } });
  invariant(nonempty(saved?.private_reference), "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED");
  const synthReceipt = r("LONGITUDINAL_SYNTHESIZED", {
    synthesis_evidence_ref: saved.private_reference,
    reading_receipt_ref: readReceipt.receipt_ref,
    known_vs_new_reconciled: true, longitudinal_counterexamples_checked: true
  });
  const manifest = {
    schema_version: 1, source_sha256: sourceSha256, generation,
    page_count: pages.length, archive_receipt_ref: archiveReceiptRef,
    transitions: [
      attest("SOURCE_INVENTORIED", inv, attestationKey),
      attest("READING_DISPOSITIONED", readReceipt, attestationKey),
      attest("LONGITUDINAL_SYNTHESIZED", synthReceipt, attestationKey)
    ]
  };
  if (!statuses.some(x => x.status === "REVIEW_PENDING")) {
    verifiedReadingFirstSynthesis({
      sourceSha256, generation, pageCount: pages.length,
      receiptJournal: manifest, attestationKey
    });
  }
  return { receipt_journal: manifest,
    counts: { source_pages: pages.length,
      read: statuses.filter(x => x.status === "REVIEWED_ALL_SOURCE_MODALITIES").length,
      pending: statuses.filter(x => x.status === "REVIEW_PENDING").length },
    provisional_synthesis_ref: saved.private_reference };
}
