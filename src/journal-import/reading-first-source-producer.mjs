import { createHash, createHmac } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { readingFirstAttestationPayload } from "./reading-first-order.mjs";
import { verifiedReadingFirstSynthesis } from "./reading-first-runtime-gate.mjs";
import { OPERATOR_REVIEW_ROUTE, validateOperatorReviewBundle } from "./reading-first-operator-review.mjs";

// Source pages must come from a separately authorized, hash-checked private
// archive. Model outputs cannot sign receipts or create private access.
const hash = x => createHash("sha256").update(x).digest("hex");
const invariant = (ok, code) => { if (!ok) throw new ValidationError(code, { code }); };
const nonempty = x => typeof x === "string" && x.trim().length > 0 && x.length <= 320;
const meaningfulProse = (x, max) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const HEX64 = /^[a-f0-9]{64}$/;

const READER_ROUTE = "source_reader";
// The checks a page's evidence can fail (see verifyTextEvidence). A reader's observation that fails one of them leaves its page
// pending for an authorized review; nothing from that observation is kept.
const EVIDENCE_CODES = new Set([
  "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED", "JOURNAL_READING_FIRST_SOURCE_ANCHOR_REQUIRED",
  "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID", "JOURNAL_READING_FIRST_SOURCE_FINDINGS_REQUIRED",
  "JOURNAL_READING_FIRST_SOURCE_FINDINGS_INVALID"
]);
// A reader that cannot answer a page (a page too large for one call, a call closed unanswered, a retry limit reached).
const READER_UNAVAILABLE_CODES = new Set([
  "INFERENCE_RETRY_LIMIT", "JOURNAL_EXCHANGE_RETRY_LIMIT", "JOURNAL_WORK_PACKET_TOO_LARGE", "JOURNAL_READING_FIRST_PAGE_TOO_LARGE"
]);

/**
 * Why a reader's failure leaves its page pending instead of ending the run, or null when it must end the run. Only failures
 * that say this page will not be read as the reader is asked to are here; a call whose outcome is unknown, a transport or
 * authorization failure, an untrusted completion and a persistence failure are never pending, since a rerun may still read
 * the page (or must not go on).
 */
function readerFailureReason(error) {
  const code = error?.code;
  if (code === "JOURNAL_SOURCE_TOOL_REFUSED") return "tool_refused";
  if (code === "INVALID_STRUCTURED_OUTPUT") return "reader_output_invalid";
  if (READER_UNAVAILABLE_CODES.has(code) || error?.submissionStatus === "exhausted") return "reader_unavailable";
  return null;
}

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

// A quotation is located in the page's text by what it says, not by how the page lays it out: a run of whitespace in it
// (a line break the page has, a no-break or thin space) matches any run of whitespace, and an apostrophe matches any of the
// four a page can use. Nothing else is loosened. An exact match always wins; only a quotation with none is looked for loosely.
const SPACE = /[\s\u00A0\u202F\u2009]/u;
const SPACE_CLASS = "[\\s\\u00A0\\u202F\\u2009]+";
const APOSTROPHE = /['\u2018\u2019\u02BC]/u;
const APOSTROPHE_CLASS = "['\\u2018\\u2019\\u02BC]";
const SYNTAX = /[\\^$.*+?()[\]{}|]/gu;

/** Every place `exact` is found in `text` as {start, end}, overlapping places included, in order of position. */
function locations(text, exact) {
  const found = [];
  for (let from = 0, at; (at = text.indexOf(exact, from)) >= 0; from = at + 1) found.push({ start: at, end: at + exact.length });
  if (found.length > 0) return found;
  let source = "", inSpace = false;
  for (const character of exact) {
    if (SPACE.test(character)) {
      if (!inSpace) source += SPACE_CLASS;
      inSpace = true;
    } else {
      inSpace = false;
      source += APOSTROPHE.test(character) ? APOSTROPHE_CLASS : character.replace(SYNTAX, "\\$&");
    }
  }
  const pattern = new RegExp(source, "g");
  for (let from = 0; from < text.length;) {
    pattern.lastIndex = from;
    const match = pattern.exec(text);
    if (!match) break;
    found.push({ start: match.index, end: match.index + match[0].length });
    from = match.index + 1;
  }
  return found;
}

/**
 * The observation as it is kept, or an error naming the check it failed. `provenance` says who made it; a `review` (an
 * authorized reviewer's, not a reader's) is also kept, and lets a page with no text carry no anchors and no findings.
 */
function verifyTextEvidence(page, observation, { provenance = "source_bound_model_proposal", review = null } = {}) {
  invariant(observation?.page === page.page &&
    observation?.source_page_sha256 === page.source_page_sha256 &&
    observation?.source_read_complete === true &&
    observation?.reviewed_modalities === page.required_modalities &&
    meaningfulProse(observation?.source_specific_understanding, 2500) &&
    Array.isArray(observation.exact_source_anchors),
    "JOURNAL_READING_FIRST_SOURCE_READ_RECEIPT_REQUIRED");
  const noText = page.text.trim().length === 0;
  if (review && noText) {
    invariant(observation.exact_source_anchors.length === 0, "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID");
    invariant(Array.isArray(observation.source_findings) && observation.source_findings.length === 0,
      "JOURNAL_READING_FIRST_SOURCE_FINDINGS_INVALID");
  } else {
    if (!noText) invariant(observation.exact_source_anchors.length > 0, "JOURNAL_READING_FIRST_SOURCE_ANCHOR_REQUIRED");
    invariant(Array.isArray(observation.source_findings) && observation.source_findings.length > 0,
      "JOURNAL_READING_FIRST_SOURCE_FINDINGS_REQUIRED");
  }
  // The model need only reproduce exact quotations, never invent offsets.
  // The trusted source reader locates the correct occurrence deterministically.
  const anchors = observation.exact_source_anchors.map((e) => {
    invariant(e !== null && typeof e === "object" && typeof e.exact_text === "string" && e.exact_text.length > 0,
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
    const matches = locations(page.text, e.exact_text);
    invariant(matches.length > 0 &&
      (e.occurrence !== null || matches.length === 1) &&
      (e.occurrence === null || e.occurrence < matches.length),
      "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID");
    const { start, end } = matches[e.occurrence ?? 0];
    // What is kept is the source's own text, however the quotation was laid out.
    return { start, end, exact_text: page.text.slice(start, end) };
  });
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
    provenance,
    ...(review ? { review } : {})
  };
}

/**
 * A candidate trusted stage producer for new reading-first generations.
 * A private adapter owns the source bytes, actual model/human calls and
 * durable encrypted writes; only verified completions can be attested.
 *
 * The producer sends a page to the reader once and never re-encodes it. A page the reader cannot read
 * (an image, an empty page, a refusal, an answer that is invalid or does not match the page, a reader that cannot answer)
 * is not counted as read. It stays pending for an authorized review (`operatorReview`, the owner's separate authorized
 * channel; see reading-first-operator-review.mjs), and nothing is synthesized or signed while any page is pending. The
 * completion verifier and signer are independent of model outputs.
 *
 * `operatorReview` is the parsed review bundle (or null), `operatorReadPages` the pages given to a reviewer instead of the
 * reader, `readerConcurrency` how many pages may be with the reader at once (results are still handled in page order), and
 * `onProgress(record)` an optional, content-free progress callback.
 */
export async function produceReadingFirstJournal({
  sourceSha256, generation, archiveReceiptRef, pages, attestationKey,
  reader, verifyCompletion, persistEvidence, synthesize, verifySynthesis,
  operatorReview = null, operatorReadPages = [], readerConcurrency = 1, onProgress = null
}) {
  invariant(HEX64.test(sourceSha256) && nonempty(generation) && nonempty(archiveReceiptRef),
    "JOURNAL_READING_FIRST_SOURCE_INVALID");
  invariant(attestationKey instanceof Uint8Array && attestationKey.byteLength >= 32 &&
    typeof reader === "function" && typeof verifyCompletion === "function" &&
    typeof persistEvidence === "function" && typeof synthesize === "function" &&
    typeof verifySynthesis === "function", "JOURNAL_READING_FIRST_ATTESTOR_UNAVAILABLE");
  invariant(Number.isSafeInteger(readerConcurrency) && readerConcurrency >= 1 && readerConcurrency <= 8,
    "JOURNAL_READING_FIRST_READER_CONCURRENCY_INVALID");
  invariant(onProgress === null || typeof onProgress === "function", "JOURNAL_READING_FIRST_PROGRESS_INVALID");
  const inventory = verifiedInventory(pages);
  invariant(Array.isArray(operatorReadPages) && operatorReadPages.every(n => Number.isSafeInteger(n) && n >= 1 && n <= pages.length) &&
    new Set(operatorReadPages).size === operatorReadPages.length, "JOURNAL_OPERATOR_READ_PAGES_INVALID");
  const requested = new Set(operatorReadPages);
  const scope = { source_sha256: sourceSha256, generation };

  // Every review is checked against its page before any page is sent anywhere, so a bad review stops the run at once and
  // nothing is read for it.
  const reviews = new Map();
  if (operatorReview !== null) {
    const bundle = validateOperatorReviewBundle(operatorReview, { sourceSha256, pageCount: pages.length });
    for (const item of bundle.reviews) {
      const page = pages[item.page - 1];
      let observation;
      try {
        observation = verifyTextEvidence(page, item.entry, { provenance: OPERATOR_REVIEW_ROUTE, review: {
          route: OPERATOR_REVIEW_ROUTE, reviewer: item.reviewer, authorization_ref: bundle.authorization_ref,
          review_sha256: item.review_sha256 } });
      } catch (error) {
        if (!EVIDENCE_CODES.has(error?.code)) throw error;
        throw new ValidationError("JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID", { code: "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID" });
      }
      reviews.set(item.page, { observation, used: false });
    }
  }

  function r(stage, data) {
    return { ...scope, receipt_ref: "private:" + hash(JSON.stringify({ stage, scope, data })).slice(0,40), ...data };
  }
  const inv = r("SOURCE_INVENTORIED", {
    page_count: pages.length, source_inventory_complete: true, source_pages: inventory
  });
  const statuses = [], evidenceRefs = [];
  const counts = { read: 0, operator_reviewed: 0, pending: 0 };
  // A progress record is advisory and content-free; it never decides whether the run goes on.
  const notify = async (message) => {
    if (onProgress === null) return;
    try { await onProgress(message); } catch { /* progress is not evidence */ }
  };

  const pend = (page, reason) => {
    statuses.push({ page: page.page, source_page_sha256: page.source_page_sha256, status: "REVIEW_PENDING", reason });
    counts.pending += 1;
  };
  // Saves a page's verified observation through the caller's private store and records the page as reviewed.
  const record = async (page, observation, resultSha, route) => {
    const saved = await persistEvidence({ ...scope, page: page.page,
      source_page_sha256: page.source_page_sha256, observation });
    invariant(nonempty(saved?.private_reference), "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED");
    evidenceRefs.push({ page: page.page, private_reference: saved.private_reference,
      source_page_sha256: page.source_page_sha256,
      observation_sha256: resultSha });
    statuses.push({ page: page.page, source_page_sha256: page.source_page_sha256,
      status: "REVIEWED_ALL_SOURCE_MODALITIES", reviewed_modalities: page.required_modalities,
      source_read_receipt_ref: saved.private_reference, read_result_sha256: resultSha, review_route: route });
    counts[route === READER_ROUTE ? "read" : "operator_reviewed"] += 1;
  };
  // The page's authorized review, when it has one, else it stays pending for the reason given.
  const reviewOr = async (page, reason) => {
    const review = reviews.get(page.page);
    if (!review) return pend(page, reason);
    review.used = true;
    await record(page, review.observation, hash(JSON.stringify(review.observation)), OPERATOR_REVIEW_ROUTE);
  };

  // The pages the reader is asked about: text pages with text, none a reviewer was given. They are started in a window of
  // `readerConcurrency` pages from the first one not yet handled, and handled strictly in page order, so what is verified,
  // saved and left pending is the same as when they are read one at a time. A started call's outcome is always a value,
  // never a rejection, so a call still going when a page ends the run cannot leave an unhandled rejection behind; and a run
  // that ends on a page's error waits for the calls it had already started before the error leaves (see the `finally` below).
  const forReader = (page) => page.required_modalities === "text" && page.text.trim().length > 0 && !requested.has(page.page);
  const queue = pages.filter(forReader);
  const calls = new Map();
  let started = 0;
  const startThrough = (limit) => {
    for (; started < Math.min(queue.length, limit); started += 1) {
      const page = queue[started];
      calls.set(page.page, (async () => {
        try {
          return { ok: true, output: await reader({ ...scope, page: page.page,
            source_page_sha256: page.source_page_sha256, text: page.text,
            required_modalities: page.required_modalities }) };
        } catch (error) { return { ok: false, error }; }
      })());
    }
  };

  let handled = 0;
  try {
    for (const page of pages) {
      if (!forReader(page)) {
        // Empty extraction isn't source comprehension. It may be a blank page, image-only material, or an unrecognized non-text
        // PDF element. A page with an image needs a reviewer who looks at it. Nothing here goes to the reader.
        await reviewOr(page, requested.has(page.page) ? "operator_review_requested"
          : page.required_modalities !== "text" ? "visual_pending" : "source_unavailable");
      } else {
        startThrough(handled + readerConcurrency);
        handled += 1;
        await notify({ waiting_on_page: page.page });
        const outcome = await calls.get(page.page);
        calls.delete(page.page);
        if (!outcome.ok) {
          const reason = readerFailureReason(outcome.error);
          if (reason === null) throw outcome.error;
          await reviewOr(page, reason);
        } else {
          let observation = null;
          try { observation = verifyTextEvidence(page, outcome.output?.observation); }
          catch (error) {
            if (!EVIDENCE_CODES.has(error?.code)) throw error;
          }
          if (observation === null) {
            await reviewOr(page, "reader_evidence_invalid");
          } else {
            const resultSha = hash(JSON.stringify(observation));
            invariant(await verifyCompletion({ ...scope, page: page.page,
              source_page_sha256: page.source_page_sha256,
              input_sha256: hash(page.text), output_sha256: resultSha,
              provider_receipt: outcome.output?.provider_receipt }) === true,
            "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED");
            // A page the reader has read does not take a review, and the reader's evidence is not kept beside one.
            invariant(!reviews.has(page.page), "JOURNAL_READING_FIRST_OPERATOR_REVIEW_UNEXPECTED");
            await record(page, observation, resultSha, READER_ROUTE);
          }
        }
      }
      await notify({ through_page: page.page, read: counts.read, operator_reviewed: counts.operator_reviewed, pending: counts.pending });
    }
  } finally {
    // A page that ends the run does not stop the calls already started for the pages after it. They are waited for before the
    // error leaves this function: the caller closes the store and the port when a run ends, and a call still going would write
    // its answer into a closed store, or run beside the next run. Their answers are kept by the durable port for that run and
    // nothing from them is used here. A started call's outcome is always a value, so this wait cannot throw.
    await Promise.all(calls.values());
  }
  invariant(statuses.length === pages.length, "JOURNAL_READING_FIRST_COVERAGE_INCOMPLETE");
  invariant([...reviews.values()].every(review => review.used), "JOURNAL_READING_FIRST_OPERATOR_REVIEW_UNEXPECTED");
  const outcomeCounts = { source_pages: pages.length, read: counts.read,
    operator_reviewed: counts.operator_reviewed, pending: counts.pending };

  // A page still pending means nothing here is complete: no synthesis is asked for and nothing is signed. The caller keeps
  // the evidence already saved, and a later run with the missing reviews picks up from it.
  if (counts.pending > 0) {
    return { status: "REVIEW_PENDING", receipt_journal: null, counts: outcomeCounts,
      pending_pages: statuses.filter(x => x.status === "REVIEW_PENDING").map(x => ({
        page: x.page, source_page_sha256: x.source_page_sha256,
        required_modalities: inventory[x.page - 1].required_modalities, reason: x.reason
      })) };
  }

  const readReceipt = r("READING_DISPOSITIONED", {
    private_coverage_ref: "private:coverage:" + hash(JSON.stringify(statuses)),
    page_dispositions: statuses
  });
  const summary = await synthesize({ ...scope, page_count: pages.length,
    persisted_source_evidence: evidenceRefs,
    unresolved: [] });
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
  verifiedReadingFirstSynthesis({
    sourceSha256, generation, pageCount: pages.length,
    receiptJournal: manifest, attestationKey
  });
  return { status: "SOURCE_SYNTHESIZED", receipt_journal: manifest, counts: outcomeCounts, pending_pages: [],
    provisional_synthesis_ref: saved.private_reference };
}
