import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";
import { buildReadingFirstFacetIndexes } from "../src/journal-import/reading-first-facets.mjs";

const sha=s=>createHash("sha256").update(s).digest("hex");
const page="June 1, 2025\n\nThey declined an extra shift despite guilt.\n\nLater they felt tired but proud of that choice.\n";
const quote="declined an extra shift";
const start=page.indexOf(quote);
const built=buildQuoteGeneration({
  caseId:"synthetic-case",corpusId:"synthetic-corpus",
  generation:"synthetic:quote-index-v4-month-first",
  originalObjectId:"synthetic:original",
  mediaType:"text/plain",version:4,
  representations:[{representation_id:"synthetic:page:1",page_number:1,text:page,parse_status:"readable"}]
});
const record={
  page:1,source_page_sha256:sha(page),private_reference:"private:synthetic:page:1",
  observation:{
    page:1,source_page_sha256:sha(page),
    exact_source_anchors:[{start,end:start+quote.length,exact_text:quote}],
    source_findings:[{statement:"The writer established a sustainable protective boundary",
      required_qualifiers:["one historical episode"],anchor_indices:[0]}]
  }
};

test("new generation's provisional terms point to exact original quote, not generated prose",()=>{
  const out=buildReadingFirstFacetIndexes({
    built,observations:[record],sourcePages:[{page:1,text:page}]
  });
  const postings=out.readingTerms.get("sustainable");
  assert.ok(postings && postings.length>0);
  const quotes=built.graph.nodes.filter(x=>postings.includes(x.id) && x.kind==="passage");
  assert.ok(quotes.some(x=>x.data.quote.includes(quote)));
  assert.ok(quotes.every(x=>!x.data.quote.includes("sustainable")));
  assert.equal(out.stats.unmapped,0);
  const info=out.readingMeta.get(postings[0]);
  assert.equal(info[0].status,"provisional_reading_interpretation");
  assert.equal(info[0].source_evidence_ref,"private:synthetic:page:1");
});

test("an invented anchor is rejected and cannot seed semantic lookup",()=>{
  const bad=structuredClone(record);
  bad.observation.exact_source_anchors[0].exact_text="a quote that was never written";
  assert.throws(()=>buildReadingFirstFacetIndexes({
    built,observations:[bad],sourcePages:[{page:1,text:page}]
  }),{code:"JOURNAL_READING_FACET_ANCHOR_MISMATCH"});
});

test("a finding without a matching passage never creates false source pointers",()=>{
  const across=structuredClone(record);
  across.observation.exact_source_anchors[0]={start:0,end:page.length,exact_text:page};
  const x=buildReadingFirstFacetIndexes({
    built,observations:[across],sourcePages:[{page:1,text:page}]
  });
  assert.equal(x.stats.unmapped,1);
  assert.equal(x.readingTerms.size,0);
});
