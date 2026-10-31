import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { createReadingFirstPortAdapter } from "../src/journal-import/reading-first-port-adapter.mjs";
const digest=x=>createHash("sha256").update(x).digest("hex");
const grant={grant_id:"synthetic:synthesis",principal_id:"synthetic:reader",
  purpose:"organize_search",allowed_roles:["source_synthesizer"],expires_at:null};
function fixture(count,{dropChild=false,summaryLength=100,extraChanges=0,changeLength=40,summaryFor=null}={}){
  const data=new Map(), persisted_source_evidence=[];
  for(let page=1;page<=count;page++){
    const private_reference="private:synthetic:page:"+page,source_page_sha256=digest("page:"+page);
    const observation={source_specific_understanding:"Synthetic understanding "+page,
      source_findings:[{statement:"Provisional page "+page,required_qualifiers:[],anchor_indices:[0]}]};
    data.set(private_reference,{page,source_page_sha256,observation});
    persisted_source_evidence.push({page,private_reference,source_page_sha256,
      observation_sha256:digest(JSON.stringify(observation))});
  }
  let calls=0,aggregates=0,largestRequest=0;const operationKeys=[];
  const port=createMockJournalInferencePort({handlers:{source_synthesizer:packet=>{
    calls++;if(packet.prior_summaries.length)aggregates++;
    operationKeys.push(packet.controller_provenance_tag);
    largestRequest=Math.max(largestRequest,Buffer.byteLength(JSON.stringify({
      observations:packet.observations,prior_summaries:packet.prior_summaries,
      known_state:packet.known_state,review_scope:packet.review_scope}),"utf8"));
    const refs=packet.observations.length
      ?packet.observations.map(x=>x.evidence_ref)
      :packet.prior_summaries.flatMap(x=>x.source_evidence_refs);
    const extra=Array.from({length:extraChanges},(_,i)=>({statement:"B".repeat(changeLength)+i,
      evidence_refs:[refs[0]],source_kind:"reported_event",uncertainty:"Synthetic only"}));
    return {schema_version:"1.0",
      provisional_longitudinal_summary:summaryFor?summaryFor(calls-1):"A".repeat(summaryLength),
      source_evidence_refs:dropChild&&packet.prior_summaries.length?refs.slice(1):refs,
      known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
      meaningful_changes:[{statement:"A source-linked invented event",evidence_refs:[refs[0]],
        source_kind:"reported_event",uncertainty:"Synthetic only"},...extra]};
  }}});
  const adapter=createReadingFirstPortAdapter({port,grant,generation:"synthetic:generation",
    sourceSha256:digest("synthetic source"),readEvidence:async ref=>data.get(ref),
    knownState:{source_scope:"journal_only",known_vs_new_scope:"imported_journal_only",
      case_history_comparison:"pending_separate_authorized_step"}});
  return {adapter,persisted_source_evidence,
    metrics:()=>({calls,aggregates,largestRequest,
      requestSequence:digest(operationKeys.join("\n"))})};
}
test("1,000 synthetic pages retain all original page provenance without aggregation stalls",async()=>{
  const f=fixture(1000),out=await f.adapter.synthesize({
    persisted_source_evidence:f.persisted_source_evidence,unresolved:[]});
  const refs=f.persisted_source_evidence.map(x=>x.private_reference),allowed=new Set(refs);
  assert.deepEqual(out.source_evidence_refs,refs);
  assert.ok(f.metrics().aggregates>1 && f.metrics().calls<160);
  assert.ok(out.meaningful_changes.length>=80);
  assert.ok(out.meaningful_changes.every(c=>c.evidence_refs.every(ref=>allowed.has(ref))));
  assert.equal(await f.adapter.verifySynthesis({provider_receipt:out.provider_receipt,
    output_sha256:digest(JSON.stringify(out))}),true);
  assert.equal(await f.adapter.verifySynthesis({provider_receipt:out.provider_receipt,
    output_sha256:digest(JSON.stringify({...out,source_evidence_refs:refs.slice(1)}))}),false);
});
test("aggregation cannot drop one of its verified child summaries",async()=>{
  const f=fixture(45,{dropChild:true});
  await assert.rejects(f.adapter.synthesize({persisted_source_evidence:f.persisted_source_evidence,
    unresolved:[]}),{code:"JOURNAL_READING_FIRST_SYNTHESIS_SOURCE_INVALID"});
});
test("non-progress is detected before extra provider calls",async()=>{
  // Each child summary is too large for even two to share one request's real room.
  const f=fixture(24,{summaryLength:12500,extraChanges:6,changeLength:2000});
  await assert.rejects(f.adapter.synthesize({persisted_source_evidence:f.persisted_source_evidence,
    unresolved:[]}),{code:"JOURNAL_READING_FIRST_SYNTHESIS_NONPROGRESS"});
  assert.equal(f.metrics().aggregates,0);
});
test("summaries too long for the half-size grouping still merge within the real request room",async()=>{
  // Child summaries of about 12.6 KB: no two fit in half of the 42,000-byte limit,
  // which stopped a real import; three fit in the room a request actually has.
  const f=fixture(60,{summaryLength:12500}),out=await f.adapter.synthesize({
    persisted_source_evidence:f.persisted_source_evidence,unresolved:[]});
  const refs=f.persisted_source_evidence.map(x=>x.private_reference);
  assert.deepEqual(out.source_evidence_refs,refs);
  assert.deepEqual({calls:f.metrics().calls,aggregates:f.metrics().aggregates},{calls:8,aggregates:3});
  assert.ok(f.metrics().largestRequest<=42000);
  assert.equal(await f.adapter.verifySynthesis({provider_receipt:out.provider_receipt,
    output_sha256:digest(JSON.stringify(out))}),true);
});
test("the fallback uses the real request room to the byte and stops one character beyond it",async()=>{
  // Two child summaries of three-byte characters: 6,809 each still share one request
  // within the 42,000-byte limit; 6,810 each cannot, so the import stops before any
  // further provider call rather than sending an oversized request.
  const fits=fixture(24,{summaryFor:()=>"€".repeat(6809)});
  const out=await fits.adapter.synthesize({persisted_source_evidence:fits.persisted_source_evidence,unresolved:[]});
  assert.equal(out.source_evidence_refs.length,24);
  assert.equal(fits.metrics().aggregates,1);
  assert.ok(fits.metrics().largestRequest<=42000);
  const over=fixture(24,{summaryFor:()=>"€".repeat(6810)});
  await assert.rejects(over.adapter.synthesize({persisted_source_evidence:over.persisted_source_evidence,
    unresolved:[]}),{code:"JOURNAL_READING_FIRST_SYNTHESIS_NONPROGRESS"});
  assert.equal(over.metrics().aggregates,0);
});
test("levels the half-size grouping can reduce keep exactly the same requests",async()=>{
  // Stored provider answers are keyed by these requests, so a restarted import
  // reuses every answer it already has. Digests were taken from the grouping
  // before the real-room fallback existed.
  const expected=[
    [1000,{},92,8,"f2d3a87842d65579f7b549677e479ccc47884e918f3115ffcdf8b89ae976f6a6"],
    [300,{summaryLength:6000},38,13,"6f3b126ba2fcf7fff97dd993fa157f92a9c8a17ce68ea2e497b1fcc5b4d6182b"],
    // Three child summaries of 5,000, 5,000 and 11,000 characters: the half-size
    // grouping shrinks this level by one pair only, which must not trigger the fallback.
    [36,{summaryFor:i=>"A".repeat(i<3?[5000,5000,11000][i]:100)},6,3,
      "3a07488c2c14803add65cc2931d221e5c5df84cd75907553f8a040a463731848"]];
  for(const [count,options,calls,aggregates,requestSequence] of expected){
    const f=fixture(count,options);
    await f.adapter.synthesize({persisted_source_evidence:f.persisted_source_evidence,unresolved:[]});
    const m=f.metrics();
    assert.deepEqual({calls:m.calls,aggregates:m.aggregates,requestSequence:m.requestSequence},
      {calls,aggregates,requestSequence});
  }
});
