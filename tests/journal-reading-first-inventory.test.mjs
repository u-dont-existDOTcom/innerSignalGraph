import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readingFirstSourceInventory} from "../src/journal-import/reading-first-inventory.mjs";
import {buildQuoteGeneration} from "../src/journal-import/quote-index.mjs";
import {buildReadingFirstFacetIndexes} from "../src/journal-import/reading-first-facets.mjs";
const sha=x=>createHash("sha256").update(x).digest("hex");

test("plain UTF-8 source produces bounded, byte-exact virtual units without fabricated physical pages",()=>{
  const source=("A long invented paragraph with é and 🌊 in memory.\n").repeat(1800);
  const plan={parsed:{source:{mime_type:"text/plain; charset=utf-8"},pages:[],
    representations:[{representation_id:"representation:text:1",text:source}]},visual_pages:[]};
  const parts=readingFirstSourceInventory(plan,{sourceSha256:sha(source)});
  assert.ok(parts.length>3);
  assert.equal(parts.map(p=>p.text).join(""),source);
  assert.ok(parts.every(p=>p.source_location_type==="virtual_text_chunk"&&p.required_modalities==="text" && Buffer.byteLength(p.text)<=24000));
  let expected=0;
  for(const [i,p] of parts.entries()){
    assert.equal(p.page,i+1);
    assert.equal(p.source_start_byte,expected);
    assert.equal(p.source_page_sha256,sha(p.text));
    expected+=Buffer.byteLength(p.text);
  }
  assert.equal(expected,Buffer.byteLength(source));
});

test("declared visual hazards remain pending even when PDF extraction is readable",()=>{
  const texts=["First original page","Second original page"];
  const plan={parsed:{source:{mime_type:"application/pdf"},
    pages:texts.map((text,i)=>({page_number:i+1,representation_id:"pdf:"+i,disposition:"readable",image_inventory:[]})),
    representations:texts.map((text,i)=>({representation_id:"pdf:"+i,text}))},visual_pages:[2]};
  const parts=readingFirstSourceInventory(plan,{sourceSha256:sha("synthetic pdf")});
  assert.equal(parts[0].required_modalities,"text");
  assert.equal(parts[1].required_modalities,"text+image");
  assert.notEqual(parts[1].source_page_sha256,sha(texts[1]));
  assert.equal(parts[1].source_location_type,"original_page");
});

test("virtual text source findings link to the original quote through absolute byte offsets",()=>{
  const text="January 1, 2025.\n\nA fully invented story names a kind and sustainable choice.\n\n";
  const original="representation:text:1";
  const plan={parsed:{source:{mime_type:"text/plain"},pages:[],
    representations:[{representation_id:original,text}]},visual_pages:[]};
  const [source]=readingFirstSourceInventory(plan,{sourceSha256:sha(text)});
  const built=buildQuoteGeneration({caseId:"synthetic-case",corpusId:"synthetic-corpus",
    generation:"synthetic:quote-index-v4-month-first",originalObjectId:"synthetic:original",
    mediaType:"text/plain",version:4,
    representations:[{representation_id:original,page_number:null,text,parse_status:"readable"}]});
  const anchor="kind and sustainable choice";
  const start=text.indexOf(anchor);
  const record={page:source.page,source_page_sha256:source.source_page_sha256,
    private_reference:"private:synthetic:chunk:1",
    observation:{page:source.page,source_page_sha256:source.source_page_sha256,
      exact_source_anchors:[{start,end:start+anchor.length,exact_text:anchor}],
      source_findings:[{statement:"The narrator acted with deliberate resilience",
        required_qualifiers:["fictional"],anchor_indices:[0]}]}};
  const facets=buildReadingFirstFacetIndexes({built,observations:[record],sourcePages:[source]});
  assert.ok(facets.readingTerms.get("resilience")?.length>0);
  assert.equal(facets.stats.unmapped,0);
  const meta=facets.readingMeta.get(facets.readingTerms.get("resilience")[0])[0];
  assert.equal(meta.source_page,null);
  assert.equal(meta.source_chunk,1);
  assert.equal(meta.representation_id,original);
});
