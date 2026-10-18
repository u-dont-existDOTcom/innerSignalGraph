import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { produceReadingFirstJournal } from "../src/journal-import/reading-first-source-producer.mjs";
import { verifiedReadingFirstSynthesis } from "../src/journal-import/reading-first-runtime-gate.mjs";

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
function argumentsFor(overrides = {}) {
  const stored = new Map();
  const visited = [];
  let calls = 0;
  const params = {
    sourceSha256: SOURCE, generation: GENERATION, archiveReceiptRef: "synthetic:source-archive",
    pages, attestationKey: KEY,
    reader: async (req) => {
      visited.push(req.page);
      return {
        observation: {
          page: req.page, source_page_sha256: req.source_page_sha256,
          source_read_complete: true, reviewed_modalities: "text",
          source_specific_understanding: "One time-bounded account with uncertainty retained.",
          exact_source_anchors: [{ start: 0, end: req.text.length, exact_text: req.text }],
          source_findings: [{ statement:"A source-grounded dated observation",required_qualifiers:["synthetic reported event"],anchor_indices:[0] }]
        },
        provider_receipt: { completed: true, input_sha256: sha(req.text) }
      };
    },
    verifyCompletion: async (req) => req.provider_receipt?.completed === true &&
      req.input_sha256 === req.provider_receipt.input_sha256,
    persistEvidence: async (req) => {
      calls++;
      const ref = "private:evidence:" + calls;
      stored.set(ref, req);
      return { private_reference: ref };
    },
    synthesize: async (input) => ({
      provisional_longitudinal_summary:
        "Earlier help, later disappointment and a protective boundary are different episodes.",
      source_evidence_refs: input.persisted_source_evidence.map(x => x.private_reference),
      known_vs_new_reconciled: true, longitudinal_counterexamples_checked: true,
      provider_receipt: { complete: true }
    }),
    verifySynthesis: async (input) => input.provider_receipt?.complete === true
  };
  return { params: { ...params, ...overrides }, visited, stored };
}

test("full synthetic reading is chronological, source-cited, persisted and attested before indexing", async () => {
  const f = argumentsFor();
  const outcome = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1,2,3]);
  assert.deepEqual(outcome.counts, { source_pages: 3, read: 3, pending: 0 });
  assert.equal(f.stored.size, 4, "three source observations and one synthesis were saved");
  const verified = verifiedReadingFirstSynthesis({
    sourceSha256: SOURCE, generation: GENERATION,
    pageCount: 3, receiptJournal: outcome.receipt_journal, attestationKey: KEY
  });
  assert.equal(verified.reviewed_pages, 3);
  assert.equal(verified.phase, "LONGITUDINAL_SYNTHESIZED");
  assert.deepEqual(outcome.receipt_journal.transitions.map(x => x.stage), [
    "SOURCE_INVENTORIED", "READING_DISPOSITIONED", "LONGITUDINAL_SYNTHESIZED"
  ]);
});

test("an image-only source remains pending without sending the picture to a text model", async () => {
  const text = pages[0];
  const imgs = [{ page: 2, source_page_sha256: sha("image bytes"),
    text: "", required_modalities: "image" }];
  const f = argumentsFor({ pages: [text, ...imgs] });
  const out = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited, [1]);
  assert.equal(out.counts.pending, 1);
  assert.deepEqual(out.receipt_journal.transitions[1].receipt.page_dispositions[1].reason,
    "visual_pending");
  assert.throws(() => verifiedReadingFirstSynthesis({
    sourceSha256: SOURCE, generation: GENERATION, pageCount: 2,
    receiptJournal: out.receipt_journal, attestationKey: KEY
  }), { code: "JOURNAL_READING_FIRST_REVIEW_PENDING" });
});

test("a model/tool refusal marks the original page unread without retrying it", async () => {
  const f = argumentsFor({
    reader: async req => {
      f.visited.push(req.page);
      if (req.page === 2)
        throw Object.assign(new Error("Model declined source"), { code: "JOURNAL_SOURCE_TOOL_REFUSED" });
      return {
        observation: {
          page:req.page,source_page_sha256:req.source_page_sha256,
          source_read_complete:true,reviewed_modalities:"text",
          source_specific_understanding:"Bounded source observation",
          exact_source_anchors:[{start:0,end:req.text.length,exact_text:req.text}],
          source_findings:[{statement:"A bounded original observation",required_qualifiers:[],anchor_indices:[0]}]
        }, provider_receipt:{completed:true,input_sha256:sha(req.text)}
      };
    }
  });
  const out = await produceReadingFirstJournal(f.params);
  assert.deepEqual(f.visited,[1,2,3],"declined page not reissued in a smaller or alternative call");
  assert.deepEqual(out.counts,{source_pages:3,read:2,pending:1});
  assert.equal(out.receipt_journal.transitions[1].receipt.page_dispositions[1].reason,
    "tool_refused");
});

test("hallucinated source quotation and forged page identity reject the read", async () => {
  const f = argumentsFor({
    reader: async req => ({
      observation: {
        page:req.page,source_page_sha256:req.source_page_sha256,
        source_read_complete:true,reviewed_modalities:"text",
        source_specific_understanding:"Unsupported fabricated quotation",
        exact_source_anchors:[{start:0,end:4,exact_text:"INVENTED"}],
        source_findings:[{statement:"False quote",required_qualifiers:[],anchor_indices:[0]}]
      },provider_receipt:{completed:true,input_sha256:sha(req.text)}
    })
  });
  await assert.rejects(produceReadingFirstJournal(f.params),
    { code: "JOURNAL_READING_FIRST_SOURCE_ANCHOR_INVALID" });
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
