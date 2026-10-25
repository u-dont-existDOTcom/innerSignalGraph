import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { createReadingFirstPortAdapter } from "../src/journal-import/reading-first-port-adapter.mjs";
const digest=x=>createHash("sha256").update(x).digest("hex");
const grant={grant_id:"synthetic:synthesis",principal_id:"synthetic:reader",
  purpose:"organize_search",allowed_roles:["source_synthesizer"],expires_at:null};
function fixture(count,{dropChild=false,summaryLength=100}={}){
  const data=new Map(), persisted_source_evidence=[];
  for(let page=1;page<=count;page++){
    const private_reference="private:synthetic:page:"+page,source_page_sha256=digest("page:"+page);
    const observation={source_specific_understanding:"Synthetic understanding "+page,
      source_findings:[{statement:"Provisional page "+page,required_qualifiers:[],anchor_indices:[0]}]};
    data.set(private_reference,{page,source_page_sha256,observation});
    persisted_source_evidence.push({page,private_reference,source_page_sha256,
      observation_sha256:digest(JSON.stringify(observation))});
  }
  let calls=0,aggregates=0;
  const port=createMockJournalInferencePort({handlers:{source_synthesizer:packet=>{
    calls++;if(packet.prior_summaries.length)aggregates++;
    const refs=packet.observations.length
      ?packet.observations.map(x=>x.evidence_ref)
      :packet.prior_summaries.flatMap(x=>x.source_evidence_refs);
    return {schema_version:"1.0",provisional_longitudinal_summary:"A".repeat(summaryLength),
      source_evidence_refs:dropChild&&packet.prior_summaries.length?refs.slice(1):refs,
      known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
      meaningful_changes:[{statement:"A source-linked invented event",evidence_refs:[refs[0]],
        source_kind:"reported_event",uncertainty:"Synthetic only"}]};
  }}});
  const adapter=createReadingFirstPortAdapter({port,grant,generation:"synthetic:generation",
    sourceSha256:digest("synthetic source"),readEvidence:async ref=>data.get(ref),
    knownState:{source_scope:"journal_only",known_vs_new_scope:"imported_journal_only",
      case_history_comparison:"pending_separate_authorized_step"}});
  return {adapter,persisted_source_evidence,metrics:()=>({calls,aggregates})};
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
  const f=fixture(24,{summaryLength:12500});
  await assert.rejects(f.adapter.synthesize({persisted_source_evidence:f.persisted_source_evidence,
    unresolved:[]}),{code:"JOURNAL_READING_FIRST_SYNTHESIS_NONPROGRESS"});
  assert.equal(f.metrics().aggregates,0);
});
