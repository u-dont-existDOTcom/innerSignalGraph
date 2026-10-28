import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { produceReadingFirstJournal } from "../src/journal-import/reading-first-source-producer.mjs";
import { verifiedReadingFirstSynthesis } from "../src/journal-import/reading-first-runtime-gate.mjs";
import { canonicalJson } from "../src/journal-import/reading-first-operator-review.mjs";

const sha = x => createHash("sha256").update(x).digest("hex");
const DOC = [
  "January 2. A neighbor offered help after the storm.",
  "February 3. The neighbor was distant; the storyteller felt disappointed.",
  "March 4. A note describes a boundary that felt appropriate."
];
const SOURCE = sha(DOC.join("\n"));
const GENERATION = "synthetic:story:v1";
const KEY = Buffer.alloc(32, 0x43);
const pages = DOC.map((text, i) => ({
  page: i + 1, required_modalities: "text", text, source_page_sha256: sha(text)
}));
// A page that also holds a picture (or only one) is never read by the model; its digest names the page, not its text.
const pictured = (n, text, required_modalities = "text+image") => ({
  page: n, text, required_modalities, source_page_sha256: sha("synthetic-placeholder:" + n)
});
const goodObservation = req => ({
  page: req.page, source_page_sha256: req.source_page_sha256,
  source_read_complete: true, reviewed_modalities: "text",
  source_specific_understanding: "One time-bounded account with uncertainty retained.",
  exact_source_anchors: [{ start: 0, end: req.text.length, exact_text: req.text }],
  source_findings: [{ statement:"A source-grounded dated observation",required_qualifiers:["synthetic reported event"],anchor_indices:[0] }]
});
const completed = (req, observation) => ({
  observation, provider_receipt: { completed: true, input_sha256: sha(req.text) }
});
function argumentsFor(overrides = {}) {
  const stored = new Map();
  const visited = [];
  const synthesized = [];
  const verified = [];
  let calls = 0;
  const params = {
    sourceSha256: SOURCE, generation: GENERATION, archiveReceiptRef: "synthetic:source-archive",
    pages, attestationKey: KEY,
    reader: async (req) => {
      visited.push(req.page);
      return completed(req, goodObservation(req));
    },
    verifyCompletion: async (req) => {
      verified.push(req.page);
      return req.provider_receipt?.completed === true && req.input_sha256 === req.provider_receipt.input_sha256;
    },
    persistEvidence: async (req) => {
      calls++;
      const ref = "private:evidence:" + calls;
      stored.set(ref, req);
      return { private_reference: ref };
    },
    synthesize: async (input) => {
      synthesized.push(input);
      return {
        provisional_longitudinal_summary:
          "Earlier help, later disappointment and a protective boundary are different episodes.",
        source_evidence_refs: input.persisted_source_evidence.map(x => x.private_reference),
        known_vs_new_reconciled: true, longitudinal_counterexamples_checked: true,
        provider_receipt: { complete: true }
      };
    },
    verifySynthesis: async (input) => input.provider_receipt?.complete === true
  };
  return { params: { ...params, ...overrides }, visited, stored, synthesized, verified };
}
const rowsOf = outcome => outcome.receipt_journal.transitions[1].receipt.page_dispositions;
const verify = (outcome, pageCount) => verifiedReadingFirstSynthesis({
  sourceSha256: SOURCE, generation: GENERATION, pageCount, receiptJournal: outcome.receipt_journal, attestationKey: KEY
});
const evidenceOf = (f, page) => [...f.stored.values()].find(x => x.page === page);

// An authorized reviewer's entry for a page, as the review bundle holds it.
const reviewOf = (page, extra = {}) => ({
  page: page.page, source_page_sha256: page.source_page_sha256, reviewed_modalities: page.required_modalities,
  source_read_complete: true,
  ...(page.required_modalities.includes("image") ? { image_content_reviewed: true } : {}),
  source_specific_understanding: "A reviewer read the whole page, the picture included, and kept what it says.",
  exact_source_anchors: page.text.trim() ? [{ exact_text: page.text.slice(0, 20), occurrence: null }] : [],
  source_findings: page.text.trim()
    ? [{ statement: "A reviewed, source-grounded observation", required_qualifiers: ["synthetic reviewer reading"], anchor_indices: [0] }] : [],
  ...extra
});
const bundleOf = (reviews, extra = {}) => ({
  schema_version: 1, source_sha256: SOURCE, reviewer: "synthetic-reviewer", authorization_ref: "synthetic:authorization:1",
  reviews, ...extra
});
const PICTURED = [pages[0], pictured(2, DOC[1]), pages[2]];

test("full synthetic reading is chronological, source-cited, persisted and attested before indexing", async () => {
  const f = argumentsFor();
  const outcome = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1,2,3]);
  assert.equal(outcome.status, "SOURCE_SYNTHESIZED");
  assert.deepEqual(outcome.counts, { source_pages: 3, read: 3, operator_reviewed: 0, pending: 0 });
  assert.equal(f.stored.size, 4, "three source observations and one synthesis were saved");
  const verified = verify(outcome, 3);
  assert.equal(verified.reviewed_pages, 3);
  assert.equal(verified.phase, "LONGITUDINAL_SYNTHESIZED");
  assert.deepEqual(outcome.receipt_journal.transitions.map(x => x.stage), [
    "SOURCE_INVENTORIED", "READING_DISPOSITIONED", "LONGITUDINAL_SYNTHESIZED"
  ]);
  assert.deepEqual(rowsOf(outcome).map(x => x.review_route), ["source_reader", "source_reader", "source_reader"]);
  assert.equal(evidenceOf(f, 1).observation.provenance, "source_bound_model_proposal");
  assert.equal(evidenceOf(f, 1).observation.review, undefined);
});

test("an image-only source stays pending without sending the picture to a text model, and nothing is synthesized or signed", async () => {
  const text = pages[0];
  const imgs = [{ page: 2, source_page_sha256: sha("image bytes"),
    text: "", required_modalities: "image" }];
  const f = argumentsFor({ pages: [text, ...imgs] });
  const out = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1]);
  assert.equal(out.status, "REVIEW_PENDING");
  assert.equal(out.receipt_journal, null, "no receipt is signed while a page is pending");
  assert.deepEqual(out.counts, { source_pages: 2, read: 1, operator_reviewed: 0, pending: 1 });
  assert.deepEqual(out.pending_pages, [{ page: 2, source_page_sha256: sha("image bytes"),
    required_modalities: "image", reason: "visual_pending" }]);
  assert.equal(f.synthesized.length, 0, "synthesis is never asked for with a page pending");
  assert.equal(f.stored.size, 1, "only the page that was read was kept");
});

test("a text-empty page is pending rather than an invented quotation", async () => {
  const blank = { page: 2, source_page_sha256: sha("  \n"),
    text: "  \n", required_modalities: "text" };
  const f = argumentsFor({ pages: [pages[0], blank] });
  const result = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1], "No empty-content model call");
  assert.deepEqual(result.counts, { source_pages: 2, read: 1, operator_reviewed: 0, pending: 1 });
  assert.equal(result.pending_pages[0].reason, "source_unavailable");
  assert.equal(result.receipt_journal, null);
});

test("a model/tool refusal marks the original page unread without retrying it", async () => {
  const f = argumentsFor({
    reader: async req => {
      f.visited.push(req.page);
      if (req.page === 2)
        throw Object.assign(new Error("Model declined source"), { code: "JOURNAL_SOURCE_TOOL_REFUSED" });
      return completed(req, goodObservation(req));
    }
  });
  const out = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited,[1,2,3],"declined page not reissued in a smaller or alternative call");
  assert.deepEqual(out.counts,{source_pages:3,read:2,operator_reviewed:0,pending:1});
  assert.equal(out.pending_pages[0].reason, "tool_refused");
});

test("a hallucinated source quotation and a forged page identity are never counted as read", async () => {
  const hallucinated = argumentsFor({
    reader: async req => completed(req, { ...goodObservation(req), exact_source_anchors: [{ start: 0, end: 4, exact_text: "INVENTED" }],
      source_specific_understanding: "Unsupported fabricated quotation" })
  });
  const out = await produceReadingFirstJournal(hallucinated.params);
  assert.equal(out.status, "REVIEW_PENDING");
  assert.deepEqual(out.counts, { source_pages: 3, read: 0, operator_reviewed: 0, pending: 3 });
  assert.deepEqual(out.pending_pages.map(x => x.reason), ["reader_evidence_invalid", "reader_evidence_invalid", "reader_evidence_invalid"]);
  assert.equal(hallucinated.stored.size, 0, "nothing from an observation that failed its checks is kept");
  assert.deepEqual(hallucinated.verified, [], "an unchecked observation is not even offered for completion");
  const forged = argumentsFor({
    reader: async req => completed(req, { ...goodObservation(req), source_page_sha256: "f".repeat(64) })
  });
  const forgedOut = await produceReadingFirstJournal(forged.params);
  assert.equal(forgedOut.counts.read, 0);
  assert.equal(forgedOut.counts.pending, 3);
  assert.equal(forged.stored.size, 0);
});

test("unverified completion cannot create an attested reading checkpoint", async () => {
  const f = argumentsFor({ verifyCompletion: async () => false });
  await assert.rejects(produceReadingFirstJournal(f.params),
    { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
  assert.equal(f.stored.size,0);
});

test("private persistence failure does not sign a complete result", async () => {
  const f = argumentsFor({ persistEvidence: async () => ({}) });
  await assert.rejects(produceReadingFirstJournal(f.params),
    { code: "JOURNAL_READING_FIRST_SOURCE_PERSISTENCE_FAILED" });
});

test("synthesis cannot cite source evidence it has not been given", async () => {
  const f = argumentsFor({
    synthesize: async () => ({
      provisional_longitudinal_summary:"Supposed synthesis",
      source_evidence_refs:["private:foreign:unread"],
      known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
      provider_receipt:{complete:true}
    })
  });
  await assert.rejects(produceReadingFirstJournal(f.params),
    { code: "JOURNAL_READING_FIRST_SYNTHESIS_SOURCE_INVALID" });
});

test("incomplete or unverified synthesis does not authorize a new index", async () => {
  const f = argumentsFor({
    synthesize: async input => ({
      provisional_longitudinal_summary:"Source observations remain provisional",
      source_evidence_refs:input.persisted_source_evidence.map(x => x.private_reference),
      known_vs_new_reconciled:false,longitudinal_counterexamples_checked:true,
      provider_receipt:{complete:true}
    })
  });
  await assert.rejects(produceReadingFirstJournal(f.params),
    { code: "JOURNAL_READING_FIRST_SYNTHESIS_INCOMPLETE" });
});

test("an unsupported tool error is not silently downgraded into a content refusal", async () => {
  const f = argumentsFor({ reader:async () => {throw Object.assign(new Error("Transport down"),{code:"NETWORK_DOWN"});} });
  await assert.rejects(produceReadingFirstJournal(f.params),{code:"NETWORK_DOWN"});
});

test("valid schema-length source understanding and longitudinal prose are not limited to reference size",async()=>{
  const f=argumentsFor({
    reader:async req=>completed(req, { ...goodObservation(req), source_specific_understanding:"A".repeat(1400),
      source_findings:[{
        statement:"Synthetic source context with qualifications",
        required_qualifiers:["Invented case"],anchor_indices:[0]
      }] }),
    synthesize:async input=>({
      provisional_longitudinal_summary:"B".repeat(2100),
      source_evidence_refs:input.persisted_source_evidence.map(x=>x.private_reference),
      known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
      provider_receipt:{complete:true}
    })
  });
  const result=await produceReadingFirstJournal(f.params);
  assert.equal(result.counts.read,3);
  const stored=[...f.stored.values()];
  assert.ok(stored.some(x=>x.observation?.source_specific_understanding.length===1400));
  assert.ok(stored.some(x=>x.provisional_synthesis?.provisional_longitudinal_summary.length===2100));
});

test("a missing cited page is rejected instead of counted as fully synthesized",async()=>{
  const f=argumentsFor({
    synthesize:async input=>({
      provisional_longitudinal_summary:"Omitted an earlier synthetic event",
      source_evidence_refs:input.persisted_source_evidence.slice(1).map(x=>x.private_reference),
      known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
      provider_receipt:{complete:true}
    })
  });
  await assert.rejects(produceReadingFirstJournal(f.params),
    {code:"JOURNAL_READING_FIRST_SYNTHESIS_SOURCE_INVALID"});
});

// ---- Authorized review route ------------------------------------------------------------------------------------------

test("a page with a picture is completed by an authorized review: receipts verify, the row names the route, the reader never sees it", async () => {
  const noReview = argumentsFor({ pages: PICTURED });
  const pendingOutcome = await produceReadingFirstJournal(noReview.params);
  assert.equal(pendingOutcome.status, "REVIEW_PENDING");
  assert.equal(pendingOutcome.receipt_journal, null);
  assert.equal(noReview.synthesized.length, 0);
  assert.deepEqual(pendingOutcome.pending_pages.map(x => [x.page, x.required_modalities, x.reason]), [[2, "text+image", "visual_pending"]]);

  const entry = reviewOf(PICTURED[1]);
  const f = argumentsFor({ pages: PICTURED, operatorReview: bundleOf([entry]) });
  const outcome = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1, 3], "the pictured page is not offered to the text reader");
  assert.equal(outcome.status, "SOURCE_SYNTHESIZED");
  assert.deepEqual(outcome.counts, { source_pages: 3, read: 2, operator_reviewed: 1, pending: 0 });
  assert.equal(verify(outcome, 3).reviewed_pages, 3, "the runtime key's receipts pass the gate with the reviewed page counted");
  assert.deepEqual(rowsOf(outcome).map(x => [x.page, x.status, x.reviewed_modalities, x.review_route]), [
    [1, "REVIEWED_ALL_SOURCE_MODALITIES", "text", "source_reader"],
    [2, "REVIEWED_ALL_SOURCE_MODALITIES", "text+image", "authorized_operator_review"],
    [3, "REVIEWED_ALL_SOURCE_MODALITIES", "text", "source_reader"]
  ]);
  assert.equal(f.synthesized.length, 1);
  assert.deepEqual(f.synthesized[0].persisted_source_evidence.map(x => x.page), [1, 2, 3]);
  assert.deepEqual(f.synthesized[0].unresolved, []);
  // The review is kept through the same path and under the same shape as a reader's page, plus where it came from.
  const kept = evidenceOf(f, 2);
  assert.deepEqual(Object.keys(kept), ["source_sha256", "generation", "page", "source_page_sha256", "observation"]);
  assert.equal(kept.observation.provenance, "authorized_operator_review");
  assert.deepEqual(kept.observation.review, { route: "authorized_operator_review", reviewer: "synthetic-reviewer",
    authorization_ref: "synthetic:authorization:1", review_sha256: sha(canonicalJson(entry)) });
  assert.equal(kept.observation.reviewed_modalities, "text+image");
  assert.deepEqual(kept.observation.exact_source_anchors, [{ start: 0, end: 20, exact_text: DOC[1].slice(0, 20) }]);
});

test("an image-only page with no text takes a review with no anchors and no findings", async () => {
  const blank = pictured(2, "", "image");
  const empty = { page: 3, source_page_sha256: sha(" \n"), text: " \n", required_modalities: "text" };
  const f = argumentsFor({ pages: [pages[0], blank, empty],
    operatorReview: bundleOf([reviewOf(blank), reviewOf(empty)]) });
  const outcome = await produceReadingFirstJournal(f.params);
  assert.equal(outcome.status, "SOURCE_SYNTHESIZED");
  assert.deepEqual(outcome.counts, { source_pages: 3, read: 1, operator_reviewed: 2, pending: 0 });
  assert.equal(verifiedReadingFirstSynthesis({ sourceSha256: SOURCE, generation: GENERATION, pageCount: 3,
    receiptJournal: outcome.receipt_journal, attestationKey: KEY }).reviewed_pages, 3);
  assert.deepEqual(rowsOf(outcome).map(x => [x.reviewed_modalities, x.review_route]),
    [["text", "source_reader"], ["image", "authorized_operator_review"], ["text", "authorized_operator_review"]]);
  assert.deepEqual(evidenceOf(f, 2).observation.exact_source_anchors, []);
  assert.deepEqual(evidenceOf(f, 2).observation.source_findings, []);
  // The importer still asks the synthesizer for a summary of all three pages' evidence.
  assert.equal(f.synthesized[0].persisted_source_evidence.length, 3);
});

test("a page given to a reviewer is never sent to the reader, and waits as operator_review_requested until it is reviewed", async () => {
  const waiting = argumentsFor({ operatorReadPages: [2] });
  const pendingOutcome = await produceReadingFirstJournal(waiting.params);
  assert.deepEqual(waiting.visited, [1, 3]);
  assert.equal(pendingOutcome.status, "REVIEW_PENDING");
  assert.deepEqual(pendingOutcome.pending_pages.map(x => [x.page, x.reason, x.required_modalities]), [[2, "operator_review_requested", "text"]]);
  assert.equal(waiting.synthesized.length, 0);

  const f = argumentsFor({ operatorReadPages: [2], operatorReview: bundleOf([reviewOf(pages[1])]) });
  const outcome = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1, 3], "still never offered to the reader");
  assert.deepEqual(outcome.counts, { source_pages: 3, read: 2, operator_reviewed: 1, pending: 0 });
  assert.equal(rowsOf(outcome)[1].review_route, "authorized_operator_review");
  assert.equal(rowsOf(outcome)[1].reviewed_modalities, "text");
  verify(outcome, 3);
  // A pictured page the config also names keeps waiting for its review under the request's reason.
  const both = argumentsFor({ pages: PICTURED, operatorReadPages: [2] });
  assert.equal((await produceReadingFirstJournal(both.params)).pending_pages[0].reason, "operator_review_requested");
  for (const bad of [[0], [4], [1, 1], [1.5], ["2"], "2"]) {
    await assert.rejects(produceReadingFirstJournal(argumentsFor({ operatorReadPages: bad }).params),
      { code: "JOURNAL_OPERATOR_READ_PAGES_INVALID" }, JSON.stringify(bad));
  }
});

test("every kind of bad review stops the run before anything is read, and names no page or text", async () => {
  const okEntry = () => reviewOf(PICTURED[1]);
  const sourceText = DOC[1];
  const cases = {
    "a digest that is not the page's": [okEntry(), { source_page_sha256: "a".repeat(64) }],
    "modalities that are not the page's": [okEntry(), { reviewed_modalities: "text", image_content_reviewed: undefined }],
    "an image page without image_content_reviewed": [okEntry(), { image_content_reviewed: undefined }],
    "an image page with image_content_reviewed false": [okEntry(), { image_content_reviewed: false }],
    "image_content_reviewed on a text-only page": [reviewOf(pages[0]), { image_content_reviewed: true }],
    "a source_read_complete that is not true": [okEntry(), { source_read_complete: false }],
    "an invented quotation": [okEntry(), { exact_source_anchors: [{ exact_text: "INVENTED QUOTATION", occurrence: null }] }],
    "no anchor for a page with text": [okEntry(), { exact_source_anchors: [], source_findings: [] }],
    "no finding for a page with text": [okEntry(), { source_findings: [] }],
    "a finding that cites an anchor it does not have": [okEntry(), { source_findings: [{ statement: "x", required_qualifiers: [], anchor_indices: [3] }] }],
    "an ambiguous quotation": [okEntry(), { exact_source_anchors: [{ exact_text: "e", occurrence: null }] }],
    "no understanding": [okEntry(), { source_specific_understanding: "" }],
    "an understanding past its length": [okEntry(), { source_specific_understanding: "u".repeat(2501) }],
    "a key the review does not have": [okEntry(), { reviewer_note: "extra" }],
    "a key an anchor does not have": [okEntry(), { exact_source_anchors: [{ exact_text: sourceText.slice(0, 10), occurrence: null, note: 1 }] }],
    "a key a finding does not have": [okEntry(), { source_findings: [{ statement: "x", required_qualifiers: [], anchor_indices: [0], extra: true }] }],
    "a page past the last": [okEntry(), { page: 4 }],
    "a page below the first": [okEntry(), { page: 0 }],
    "a page that is not a number": [okEntry(), { page: "2" }],
    "a reviewer that is blank": [okEntry(), { reviewer: "  " }],
    "a reviewer past its length": [okEntry(), { reviewer: "r".repeat(201) }],
    "a reviewer that is not text": [okEntry(), { reviewer: 7 }]
  };
  for (const [name, [entry, change]] of Object.entries(cases)) {
    const review = { ...entry, ...change };
    for (const key of Object.keys(review)) if (review[key] === undefined) delete review[key];
    const f = argumentsFor({ pages: PICTURED, operatorReview: bundleOf([review]) });
    await assert.rejects(produceReadingFirstJournal(f.params), error => {
      assert.equal(error.code, "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID", name);
      assert.equal(error.message, "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID", name);
      assert.equal(error.details, undefined, name);
      return true;
    });
    assert.deepEqual(f.visited, [], `${name}: nothing was sent to the reader`);
    assert.equal(f.stored.size, 0, `${name}: nothing was kept`);
  }
  // Anchors on a page that has no text, and findings with none, are as wrong as none on a page that has some.
  const blank = pictured(2, "", "image");
  for (const extra of [{ exact_source_anchors: [{ exact_text: "x", occurrence: null }] },
    { source_findings: [{ statement: "x", required_qualifiers: [], anchor_indices: [0] }],
      exact_source_anchors: [{ exact_text: "x", occurrence: null }] }]) {
    const f = argumentsFor({ pages: [pages[0], blank, pages[2]], operatorReview: bundleOf([reviewOf(blank, extra)]) });
    await assert.rejects(produceReadingFirstJournal(f.params), { code: "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID" });
    assert.deepEqual(f.visited, []);
  }
  // The bundle itself: its source, version, reviewer, authorization and the pages it reviews.
  const entry = reviewOf(PICTURED[1]);
  const bundles = [
    bundleOf([entry], { source_sha256: "b".repeat(64) }), bundleOf([entry], { schema_version: 2 }),
    bundleOf([entry], { reviewer: "" }), bundleOf([entry], { reviewer: " " }), bundleOf([entry], { authorization_ref: "" }),
    bundleOf([entry], { authorization_ref: "a".repeat(321) }), bundleOf([entry], { note: "extra" }),
    bundleOf([entry, entry]), bundleOf([entry, entry, entry, entry]), bundleOf("not a list"), [entry], 7, "a bundle", {}
  ];
  for (const bundle of bundles) {
    const f = argumentsFor({ pages: PICTURED, operatorReview: bundle });
    await assert.rejects(produceReadingFirstJournal(f.params), { code: "JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID" }, JSON.stringify(bundle).slice(0, 80));
    assert.deepEqual(f.visited, []);
  }
});

test("a review for a page that was read, or one that needs none, is refused", async () => {
  // Page 1 is read by the reader, so a review for it has no place; the run stops at that page and keeps nothing for it.
  const f = argumentsFor({ operatorReview: bundleOf([reviewOf(pages[0])]) });
  await assert.rejects(produceReadingFirstJournal(f.params), { code: "JOURNAL_READING_FIRST_OPERATOR_REVIEW_UNEXPECTED" });
  assert.equal(f.stored.size, 0);
  // A review for the pictured page is used; one more for a page the reader reads makes the whole bundle wrong.
  const g = argumentsFor({ pages: PICTURED, operatorReview: bundleOf([reviewOf(PICTURED[1]), reviewOf(pages[2])]) });
  await assert.rejects(produceReadingFirstJournal(g.params), { code: "JOURNAL_READING_FIRST_OPERATOR_REVIEW_UNEXPECTED" });
  assert.equal(g.synthesized.length, 0);
  // A review whose page the reader fails, though, is used.
  const h = argumentsFor({ operatorReview: bundleOf([reviewOf(pages[1])]),
    reader: async req => { if (req.page === 2) throw Object.assign(new Error("x"), { code: "INVALID_STRUCTURED_OUTPUT" }); return completed(req, goodObservation(req)); } });
  assert.equal((await produceReadingFirstJournal(h.params)).status, "SOURCE_SYNTHESIZED");
});

test("each reader failure leaves its page pending for its reason, and a review then completes the page", async () => {
  const failing = [
    ["JOURNAL_SOURCE_TOOL_REFUSED", "tool_refused"],
    ["INVALID_STRUCTURED_OUTPUT", "reader_output_invalid"],
    ["INFERENCE_RETRY_LIMIT", "reader_unavailable"],
    ["JOURNAL_EXCHANGE_RETRY_LIMIT", "reader_unavailable"],
    ["JOURNAL_WORK_PACKET_TOO_LARGE", "reader_unavailable"],
    ["JOURNAL_READING_FIRST_PAGE_TOO_LARGE", "reader_unavailable"],
    ["SOME_OTHER_CODE", "reader_unavailable", "exhausted"]
  ];
  for (const [code, reason, submissionStatus] of failing) {
    const reader = async req => {
      if (req.page === 2) throw Object.assign(new Error("synthetic reader failure"), { code, ...(submissionStatus ? { submissionStatus } : {}) });
      return completed(req, goodObservation(req));
    };
    const waiting = argumentsFor({ reader });
    const outcome = await produceReadingFirstJournal(waiting.params);
    assert.equal(outcome.status, "REVIEW_PENDING", code);
    assert.deepEqual(outcome.pending_pages.map(x => [x.page, x.reason]), [[2, reason]], code);
    assert.equal(outcome.receipt_journal, null);
    assert.equal(waiting.synthesized.length, 0);
    assert.deepEqual(outcome.counts, { source_pages: 3, read: 2, operator_reviewed: 0, pending: 1 });

    const f = argumentsFor({ reader, operatorReview: bundleOf([reviewOf(pages[1])]) });
    const done = await produceReadingFirstJournal(f.params);
    assert.equal(done.status, "SOURCE_SYNTHESIZED", code);
    assert.deepEqual(done.counts, { source_pages: 3, read: 2, operator_reviewed: 1, pending: 0 });
    assert.deepEqual(rowsOf(done).map(x => x.review_route), ["source_reader", "authorized_operator_review", "source_reader"]);
    verify(done, 3);
  }
});

test("failures that do not say the page cannot be read still end the run, with the reader's own error", async () => {
  const fatal = [
    { code: "COMPLETION_UNKNOWN", submissionStatus: "unknown" }, { code: "JOURNAL_EXCHANGE_UNAVAILABLE" },
    { code: "GRANT_REVOKED" }, { code: "GRANT_ROLE_DENIED" }, { code: "PRIVATE_CASE_ACCESS_DENIED" }, { code: "NETWORK_DOWN" },
    { code: "SOME_OTHER_CODE", submissionStatus: "not_submitted" }, { code: "SOME_OTHER_CODE", submissionStatus: "completed_invalid" },
    { code: undefined }
  ];
  for (const fields of fatal) {
    const error = Object.assign(new Error("synthetic fatal reader failure"), fields);
    const f = argumentsFor({ operatorReview: bundleOf([reviewOf(pages[1])]),
      reader: async req => { if (req.page === 2) throw error; return completed(req, goodObservation(req)); } });
    await assert.rejects(produceReadingFirstJournal(f.params), thrown => thrown === error, JSON.stringify(fields));
    assert.equal(f.synthesized.length, 0);
    assert.equal(f.stored.size, 1, "only the page before it was kept");
  }
  // A completion that cannot be verified is not turned into a review either: a review cannot stand in for it.
  for (const operatorReview of [null, bundleOf([reviewOf(pages[1])])]) {
    const f = argumentsFor({ operatorReview, verifyCompletion: async req => req.page !== 2 });
    await assert.rejects(produceReadingFirstJournal(f.params), { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
    assert.equal(f.synthesized.length, 0);
  }
});

test("each way an observation fails its checks leaves the page pending, keeps nothing and asks no completion", async () => {
  const wrongDigest = req => ({ ...goodObservation(req), source_page_sha256: "e".repeat(64) });
  const variants = [
    ["a digest that is not the page's", wrongDigest],
    ["modalities that are not the page's", req => ({ ...goodObservation(req), reviewed_modalities: "text+image" })],
    ["a read that is not complete", req => ({ ...goodObservation(req), source_read_complete: false })],
    ["no understanding", req => ({ ...goodObservation(req), source_specific_understanding: "  " })],
    ["anchors that are not a list", req => ({ ...goodObservation(req), exact_source_anchors: "none" })],
    ["no anchor", req => ({ ...goodObservation(req), exact_source_anchors: [] })],
    ["a quotation the page does not hold", req => ({ ...goodObservation(req), exact_source_anchors: [{ exact_text: "NOT ON THE PAGE", occurrence: null }] })],
    ["a null anchor", req => ({ ...goodObservation(req), exact_source_anchors: [null] })],
    ["an anchor with offsets that do not match", req => ({ ...goodObservation(req), exact_source_anchors: [{ start: 1, end: 9, exact_text: req.text.slice(0, 8) }] })],
    ["an anchor with no occurrence and no offsets", req => ({ ...goodObservation(req), exact_source_anchors: [{ exact_text: req.text.slice(0, 8) }] })],
    ["no finding", req => ({ ...goodObservation(req), source_findings: [] })],
    ["findings that are not a list", req => ({ ...goodObservation(req), source_findings: null })],
    ["a finding that cites an anchor it does not have", req => ({ ...goodObservation(req),
      source_findings: [{ statement: "x", required_qualifiers: [], anchor_indices: [5] }] })],
    ["a finding with no statement", req => ({ ...goodObservation(req), source_findings: [{ statement: "", required_qualifiers: [], anchor_indices: [0] }] })],
    ["no observation at all", () => undefined]
  ];
  for (const [name, make] of variants) {
    const f = argumentsFor({ reader: async req => { f.visited.push(req.page); return req.page === 2 ? completed(req, make(req)) : completed(req, goodObservation(req)); } });
    const out = await produceReadingFirstJournal(f.params);
    assert.equal(out.status, "REVIEW_PENDING", name);
    assert.deepEqual(out.pending_pages.map(x => [x.page, x.reason]), [[2, "reader_evidence_invalid"]], name);
    assert.deepEqual(f.verified, [1, 3], `${name}: no completion was asked for the page`);
    assert.deepEqual([...f.stored.values()].map(x => x.page), [1, 3], `${name}: nothing was kept for the page`);
    assert.equal(f.synthesized.length, 0);
  }
  // A review completes such a page.
  const f = argumentsFor({ operatorReview: bundleOf([reviewOf(pages[1])]),
    reader: async req => completed(req, req.page === 2 ? wrongDigest(req) : goodObservation(req)) });
  assert.equal((await produceReadingFirstJournal(f.params)).status, "SOURCE_SYNTHESIZED");
});

test("a quotation is located despite the page's line breaks, spaces and apostrophes, and what is kept is the page's own text", async () => {
  const TEXT = [
    "She said it wasn't easy.", "Then the", "  line broke here and the thing\u00A0went on.",
    "A thin\u2009space, a narrow\u202Fone, and Sam\u02BCs old coat."
  ].join("\n");
  const page = { page: 1, text: TEXT, required_modalities: "text", source_page_sha256: sha(TEXT) };
  const seek = async (anchor, extra = {}) => {
    const f = argumentsFor({ pages: [page], reader: async req => completed(req, { ...goodObservation(req), exact_source_anchors: [anchor] }), ...extra });
    return { f, outcome: await produceReadingFirstJournal(f.params) };
  };
  const kept = async anchor => {
    const { f, outcome } = await seek(anchor);
    assert.equal(outcome.status, "SOURCE_SYNTHESIZED", JSON.stringify(anchor));
    return evidenceOf(f, 1).observation.exact_source_anchors[0];
  };
  const slice = (from, to) => ({ start: TEXT.indexOf(from), end: TEXT.indexOf(to) + to.length, exact_text: TEXT.slice(TEXT.indexOf(from), TEXT.indexOf(to) + to.length) });
  assert.deepEqual(await kept({ exact_text: "Then the line broke here", occurrence: null }), slice("Then the", "broke here"));
  assert.deepEqual(await kept({ exact_text: "it wasn\u2019t easy", occurrence: null }), slice("it wasn't", "easy"));
  assert.deepEqual(await kept({ exact_text: "it wasn\u02BCt  easy", occurrence: null }), slice("it wasn't", "easy"));
  assert.deepEqual(await kept({ exact_text: "the thing went on", occurrence: null }), slice("the thing", "went on"));
  assert.deepEqual(await kept({ exact_text: "thin space, a narrow one", occurrence: null }), slice("thin\u2009space", "narrow\u202Fone"));
  assert.deepEqual(await kept({ exact_text: "Sam's old coat", occurrence: null }), slice("Sam\u02BCs", "coat"));
  assert.deepEqual(await kept({ exact_text: "Sam\u2018s old coat.", occurrence: 0 }), slice("Sam\u02BCs", "coat."));
  // An exact quotation is stored as it is, and an exact match always wins over a loose one.
  assert.deepEqual(await kept({ exact_text: "She said it wasn't easy.", occurrence: null }), slice("She said", "easy."));
  const two = "x y and x\ny";
  const doubled = { page: 1, text: two, required_modalities: "text", source_page_sha256: sha(two) };
  const exactFirst = argumentsFor({ pages: [doubled], reader: async req => completed(req, { ...goodObservation(req), exact_source_anchors: [{ exact_text: "x y", occurrence: null }] }) });
  await produceReadingFirstJournal(exactFirst.params);
  assert.deepEqual(evidenceOf(exactFirst, 1).observation.exact_source_anchors, [{ start: 0, end: 3, exact_text: "x y" }]);
  // Nothing else is loosened: other characters, case, and a missing space are still different text.
  for (const wrong of ["she said it wasn't easy", "Then theline broke here", "Then the line broke here!", "it wasn't, easy", "Sam s old coat"]) {
    const { outcome } = await seek({ exact_text: wrong, occurrence: null });
    assert.equal(outcome.status, "REVIEW_PENDING", wrong);
    assert.equal(outcome.pending_pages[0].reason, "reader_evidence_invalid");
  }
  // Characters the pattern language treats as syntax are literal.
  const SYNTAX = "Cost (about $4.50) [paid]\n{once} a|b? 1+1*2 ^ \\ ok";
  const syntaxPage = { page: 1, text: SYNTAX, required_modalities: "text", source_page_sha256: sha(SYNTAX) };
  const literal = argumentsFor({ pages: [syntaxPage], reader: async req => completed(req, { ...goodObservation(req), exact_source_anchors: [
    { exact_text: "Cost (about $4.50) [paid] {once} a|b? 1+1*2 ^ \\ ok", occurrence: null }] }) });
  assert.equal((await produceReadingFirstJournal(literal.params)).status, "SOURCE_SYNTHESIZED");
  const notLiteral = argumentsFor({ pages: [syntaxPage], reader: async req => completed(req, { ...goodObservation(req), exact_source_anchors: [
    { exact_text: "Cost (about $4x50) [paid] {once} a|b? 1+1*2 ^ \\ ok", occurrence: null }] }) });
  assert.equal((await produceReadingFirstJournal(notLiteral.params)).status, "REVIEW_PENDING");
});

test("a loose match that is ambiguous needs its occurrence, counted as the exact search counts, and offsets stay exact", async () => {
  const TEXT = "go\nnow and go  now. a  a  a";
  const page = { page: 1, text: TEXT, required_modalities: "text", source_page_sha256: sha(TEXT) };
  const run = async anchor => {
    const f = argumentsFor({ pages: [page], reader: async req => completed(req, { ...goodObservation(req), exact_source_anchors: [anchor] }) });
    const outcome = await produceReadingFirstJournal(f.params);
    return outcome.status === "SOURCE_SYNTHESIZED" ? evidenceOf(f, 1).observation.exact_source_anchors[0] : outcome.pending_pages[0].reason;
  };
  const span = text => ({ start: TEXT.indexOf(text), end: TEXT.indexOf(text) + text.length, exact_text: text });
  assert.equal(await run({ exact_text: "go now", occurrence: null }), "reader_evidence_invalid", "two loose matches and no occurrence");
  assert.deepEqual(await run({ exact_text: "go now", occurrence: 0 }), span("go\nnow"));
  assert.deepEqual(await run({ exact_text: "go now", occurrence: 1 }), span("go  now"));
  assert.equal(await run({ exact_text: "go now", occurrence: 2 }), "reader_evidence_invalid");
  // Overlapping loose matches count, as overlapping exact ones do: "a a" is found at the first a of "a  a  a" and again at the second.
  const third = TEXT.indexOf("a  a  a");
  assert.equal(await run({ exact_text: "a a", occurrence: null }), "reader_evidence_invalid");
  assert.deepEqual(await run({ exact_text: "a a", occurrence: 0 }), { start: third, end: third + 4, exact_text: "a  a" });
  assert.deepEqual(await run({ exact_text: "a a", occurrence: 1 }), { start: third + 3, end: third + 7, exact_text: "a  a" });
  assert.equal(await run({ exact_text: "a a", occurrence: 2 }), "reader_evidence_invalid");
  // Offsets are exact: the quotation must be the text between them, as it always was.
  assert.deepEqual(await run({ start: 0, end: 6, exact_text: "go\nnow" }), { start: 0, end: 6, exact_text: "go\nnow" });
  assert.equal(await run({ start: 0, end: 6, exact_text: "go now" }), "reader_evidence_invalid");
  assert.equal(await run({ start: 0, end: 5, exact_text: "go\nnow" }), "reader_evidence_invalid");
  assert.equal(await run({ start: 0, end: TEXT.length + 1, exact_text: TEXT }), "reader_evidence_invalid");
  // An exact quotation is counted exactly: "a  a" is exactly there twice, overlapping, so it needs its occurrence too.
  assert.deepEqual(await run({ exact_text: "a  a", occurrence: 1 }), { start: third + 3, end: third + 7, exact_text: "a  a" });
  assert.equal(await run({ exact_text: "a  a", occurrence: null }), "reader_evidence_invalid");
});

test("a reviewer's quotations are located the same way, and a review is bound to its own bytes", async () => {
  const TEXT = "The morning was\ncold, and she didn\u2019t go.";
  const page = pictured(1, TEXT);
  const entry = reviewOf(page, { exact_source_anchors: [{ exact_text: "was cold, and she didn't go", occurrence: null }] });
  const f = argumentsFor({ pages: [page], operatorReview: bundleOf([entry]) });
  const outcome = await produceReadingFirstJournal(f.params);
  assert.equal(outcome.status, "SOURCE_SYNTHESIZED");
  const start = TEXT.indexOf("was"), end = TEXT.length - 1;
  assert.deepEqual(evidenceOf(f, 1).observation.exact_source_anchors, [{ start, end, exact_text: TEXT.slice(start, end) }]);
  // The review's hash covers its own entry, in canonical key order, and nothing else of the bundle.
  const shuffled = Object.fromEntries(Object.entries(entry).reverse());
  assert.equal(canonicalJson(shuffled), canonicalJson(entry));
  assert.equal(evidenceOf(f, 1).observation.review.review_sha256, sha(canonicalJson(entry)));
});

test("a review's own reviewer overrides the bundle's for that page only, and its hash covers only its own entry", async () => {
  const pagesThree = [pages[0], pictured(2, DOC[1]), pictured(3, DOC[2])];
  const second = reviewOf(pagesThree[1], { reviewer: "page-two-reviewer" });
  const third = reviewOf(pagesThree[2]);
  const run = async (reviews, extra = {}) => {
    const f = argumentsFor({ pages: pagesThree, operatorReview: bundleOf(reviews, extra) });
    return { f, outcome: await produceReadingFirstJournal(f.params) };
  };
  const first = await run([second, third]);
  assert.equal(first.outcome.status, "SOURCE_SYNTHESIZED");
  assert.equal(evidenceOf(first.f, 2).observation.review.reviewer, "page-two-reviewer");
  assert.equal(evidenceOf(first.f, 3).observation.review.reviewer, "synthetic-reviewer");
  assert.equal(evidenceOf(first.f, 2).observation.review.review_sha256, sha(canonicalJson(second)));
  assert.equal(evidenceOf(first.f, 3).observation.review.review_sha256, sha(canonicalJson(third)));
  // A different bundle-level reviewer changes what is recorded for page 3, not for page 2, and neither review's hash.
  const renamed = await run([second, third], { reviewer: "another-bundle-reviewer" });
  assert.equal(evidenceOf(renamed.f, 2).observation.review.reviewer, "page-two-reviewer");
  assert.equal(evidenceOf(renamed.f, 3).observation.review.reviewer, "another-bundle-reviewer");
  assert.equal(evidenceOf(renamed.f, 3).observation.review.review_sha256, evidenceOf(first.f, 3).observation.review.review_sha256);
  // Reviewing another page later never changes a page already kept.
  const alone = await run([third]);
  assert.equal(alone.outcome.status, "REVIEW_PENDING");
  assert.deepEqual(alone.outcome.pending_pages.map(x => x.page), [2]);
  assert.deepEqual(evidenceOf(alone.f, 3), evidenceOf(first.f, 3));
  // Another reviewer for page 2 is another review (its own hash), and the pages' evidence differ only by it.
  const other = await run([reviewOf(pagesThree[1], { reviewer: "someone-else" }), third]);
  assert.notEqual(evidenceOf(other.f, 2).observation.review.review_sha256, evidenceOf(first.f, 2).observation.review.review_sha256);
});

test("pages are read in a sliding window, handled in page order, and the result is the same as one at a time", async () => {
  const six = Array.from({ length: 6 }, (_, i) => `Entry ${i + 1}. Synthetic text for page ${i + 1}, invented.`);
  const sixPages = six.map((text, i) => ({ page: i + 1, text, required_modalities: "text", source_page_sha256: sha(text) }));
  const sourceSha256 = sha(six.join("\n"));
  const gated = () => {
    const open = new Map(), done = new Set(), started = [];
    let active = 0, peak = 0;
    const reader = req => new Promise((resolve, reject) => {
      started.push(req.page); active += 1; peak = Math.max(peak, active);
      open.set(req.page, {
        resolve: () => { active -= 1; resolve(completed(req, goodObservation(req))); },
        reject: error => { active -= 1; reject(error); }
      });
    });
    return { reader, open, done, started, peak: () => peak };
  };
  // Pages answer in the opposite order from the one they were asked in (the highest open page first).
  const drive = async (g, running) => {
    let over = false;
    running.then(() => { over = true; }, () => { over = true; });
    while (!over) {
      const waiting = [...g.open.keys()].filter(page => !g.done.has(page)).sort((a, b) => b - a);
      if (waiting.length) { g.done.add(waiting[0]); g.open.get(waiting[0]).resolve(); }
      await new Promise(resolve => setImmediate(resolve));
    }
    return running;
  };
  const run = async readerConcurrency => {
    const g = gated();
    const f = argumentsFor({ sourceSha256, pages: sixPages, reader: g.reader, readerConcurrency });
    const outcome = await drive(g, produceReadingFirstJournal(f.params));
    return { g, f, outcome };
  };
  const sequential = await run(1);
  const windowed = await run(3);
  assert.equal(sequential.g.peak(), 1);
  assert.equal(windowed.g.peak(), 3, "three pages were with the reader at once, never more");
  assert.deepEqual(windowed.g.started, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...windowed.f.stored.values()].map(x => x.page ?? "synthesis"), [1, 2, 3, 4, 5, 6, "synthesis"],
    "saved in page order however the answers came");
  assert.deepEqual(windowed.f.verified, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(windowed.outcome, sequential.outcome, "same counts, rows, references and signed receipts");
  assert.deepEqual([...windowed.f.stored.entries()], [...sequential.f.stored.entries()]);
  assert.equal(windowed.outcome.counts.read, 6);
  // Every width runs, the window never exceeds it, and a window wider than the pages is fine.
  for (const width of [2, 4, 8]) {
    const wide = await run(width);
    assert.ok(wide.g.peak() <= width && wide.g.peak() >= Math.min(width, 6), `width ${width}: ${wide.g.peak()}`);
    assert.deepEqual(wide.outcome, sequential.outcome);
  }
  for (const bad of [0, 9, -1, 1.5, "2", null, NaN]) {
    await assert.rejects(produceReadingFirstJournal(argumentsFor({ readerConcurrency: bad }).params),
      { code: "JOURNAL_READING_FIRST_READER_CONCURRENCY_INVALID" }, String(bad));
  }
});

test("pending decisions, reviews and fatal errors do not depend on the window", async () => {
  const mixed = [pages[0], pictured(2, DOC[1]), pages[2], ...[4, 5].map(n => {
    const text = `Entry ${n}. Synthetic page ${n}.`;
    return { page: n, text, required_modalities: "text", source_page_sha256: sha(text) };
  })];
  const sourceSha256 = sha("mixed source");
  const reader = async req => {
    if (req.page === 3) throw Object.assign(new Error("declined"), { code: "JOURNAL_SOURCE_TOOL_REFUSED" });
    if (req.page === 4) throw Object.assign(new Error("invalid"), { code: "INVALID_STRUCTURED_OUTPUT" });
    return completed(req, goodObservation(req));
  };
  const outcomes = [];
  for (const readerConcurrency of [1, 2, 5]) {
    const f = argumentsFor({ sourceSha256, pages: mixed, reader, readerConcurrency, operatorReview: { ...bundleOf([reviewOf(mixed[1]), reviewOf(mixed[3])]), source_sha256: sourceSha256 } });
    const outcome = await produceReadingFirstJournal(f.params);
    assert.deepEqual(outcome.pending_pages.map(x => [x.page, x.reason]), [[3, "tool_refused"]]);
    outcomes.push([outcome, [...f.stored.entries()], f.verified]);
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.deepEqual(outcomes[2], outcomes[0]);
  // A fatal error stops at its page, even with later pages already asked.
  const boom = Object.assign(new Error("transport down"), { code: "NETWORK_DOWN" });
  for (const readerConcurrency of [1, 3]) {
    const f = argumentsFor({ sourceSha256, pages: mixed, readerConcurrency,
      reader: async req => { if (req.page === 3) throw boom; return completed(req, goodObservation(req)); } });
    await assert.rejects(produceReadingFirstJournal(f.params), error => error === boom);
    assert.deepEqual([...f.stored.values()].map(x => x.page), [1], "pages after the failing one were not handled");
  }
});

test("a fatal error waits for the calls already started, and leaves no unhandled rejection from them", async () => {
  const six = Array.from({ length: 6 }, (_, i) => `Entry ${i + 1}. Synthetic text for page ${i + 1}, invented.`);
  const sixPages = six.map((text, i) => ({ page: i + 1, text, required_modalities: "text", source_page_sha256: sha(text) }));
  const open = new Map(), started = [];
  const reader = req => new Promise((resolve, reject) => { started.push(req.page); open.set(req.page, { resolve, reject, req }); });
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const f = argumentsFor({ sourceSha256: sha(six.join("\n")), pages: sixPages, reader, readerConcurrency: 3 });
    const running = produceReadingFirstJournal(f.params);
    let over = false;
    const failure = running.then(() => { over = true; return null; }, error => { over = true; return error; });
    const tick = () => new Promise(resolve => setImmediate(resolve));
    await tick();
    assert.deepEqual(started, [1, 2, 3]);
    // Page 2 fails for good while 1 is still out and 3 is answered; 1 then answers and the run stops at page 2.
    open.get(3).resolve(completed(open.get(3).req, goodObservation(open.get(3).req)));
    open.get(2).reject(Object.assign(new Error("transport down"), { code: "NETWORK_DOWN" }));
    await tick();
    open.get(1).resolve(completed(open.get(1).req, goodObservation(open.get(1).req)));
    for (let i = 0; i < 5; i += 1) await tick();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(started, [1, 2, 3, 4], "no page past the window was ever asked");
    assert.deepEqual([...f.stored.values()].map(x => x.page), [1]);
    // The run has stopped at page 2, but the call for page 4 is still out. The caller closes the store and the port when
    // the run ends, so the error does not leave while that call can still write its answer.
    assert.equal(over, false, "the error waits for the call still going");
    // The call for page 4 fails now. Nothing may surface from that, and the run ends with the page's own error.
    open.get(4).reject(Object.assign(new Error("late transport failure"), { code: "LATE_FAILURE" }));
    const error = await failure;
    assert.equal(error.code, "NETWORK_DOWN", "the error is the page's own, not the late call's");
    for (let i = 0; i < 5; i += 1) await tick();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
    assert.deepEqual([...f.stored.values()].map(x => x.page), [1], "nothing from the calls that were waited for is kept");
  } finally { process.off("unhandledRejection", onUnhandled); }
});

test("progress is reported as content-free page numbers and counts, and never decides the run", async () => {
  const seen = [];
  const f = argumentsFor({ pages: PICTURED, operatorReview: bundleOf([reviewOf(PICTURED[1])]), onProgress: async record => { seen.push(record); } });
  await produceReadingFirstJournal(f.params);
  assert.deepEqual(seen, [
    { waiting_on_page: 1 }, { through_page: 1, read: 1, operator_reviewed: 0, pending: 0 },
    { through_page: 2, read: 1, operator_reviewed: 1, pending: 0 },
    { waiting_on_page: 3 }, { through_page: 3, read: 2, operator_reviewed: 1, pending: 0 }
  ]);
  assert.equal(JSON.stringify(seen).includes("neighbor"), false, "no journal text");
  const pendingSeen = [];
  const pendingRun = argumentsFor({ pages: PICTURED, onProgress: record => { pendingSeen.push(record); } });
  await produceReadingFirstJournal(pendingRun.params);
  assert.deepEqual(pendingSeen.at(-1), { through_page: 3, read: 2, operator_reviewed: 0, pending: 1 });
  // A callback that throws or rejects does not stop the run.
  for (const onProgress of [() => { throw new Error("disk full"); }, async () => { throw new Error("disk full"); }]) {
    const g = argumentsFor({ onProgress });
    assert.equal((await produceReadingFirstJournal(g.params)).status, "SOURCE_SYNTHESIZED");
  }
  await assert.rejects(produceReadingFirstJournal(argumentsFor({ onProgress: "not a function" }).params),
    { code: "JOURNAL_READING_FIRST_PROGRESS_INVALID" });
});
