import test from 'node:test';
import assert from 'node:assert/strict';
import {applyReconciliationResult,validateReconciliationResult} from '../src/journal-import/reconcile.mjs';
const graph=()=>({case_id:'synthetic:case',corpus_id:'synthetic:corpus',generation:'synthetic:g',nodes:[
 {id:'passage:a',kind:'passage',data:{quote:'Invented source'}},
 ...['a','b','c'].map(id=>({id:'episode:'+id,kind:'episode',version:1,data:{support_group_id:'support:'+id}})),
 ...['a','b','c'].map(id=>({id:'assertion:'+id,kind:'assertion',version:1,data:{statement:'Synthetic report '+id,episode_id:'episode:'+id,support_group_id:'support:'+id,event_time:{precision:'unknown'}}})),
 ...['a','b'].map(id=>({id:'entity:'+id,kind:'entity',version:1,data:{label:'Shared synthetic label'}}))],edges:[]});
const proposal=(operation,relation,ids)=>({operation,relation,subject_ids:ids,evidence_ids:['passage:a'],explanation:'Invented source-backed proposal.',automatic_retirement_allowed:false});
const result=proposals=>({schema_version:'1.0',target_generation:'synthetic:g',proposals,unresolved_ids:[],status:'proposals_complete'});
const receipt={receipt_id:'receipt:synthetic',completion_status:'completed',target_generation:'synthetic:g'};
test('retelling groups share support without rewriting originals, identity, time, or occurrence nodes',()=>{
 const original=graph();const before=structuredClone(original);
 const proposals=[proposal('group_retelling','retells',['episode:a','episode:b']),proposal('group_retelling','retells',['episode:b','episode:c']),proposal('possible_identity','possible_same_entity',['entity:a','entity:b']),proposal('revise_time',null,['assertion:a'])];
 const applied=applyReconciliationResult({graph:original,result:result(proposals),receipt});
 assert.deepEqual(original,before);assert.equal(applied.graph.nodes.length,original.nodes.length);
 assert.equal(new Set(applied.graph.nodes.filter(n=>['assertion','episode'].includes(n.kind)).map(n=>n.data.support_group_id)).size,1);
 for(const n of applied.graph.nodes.filter(n=>n.kind==='assertion'))assert.equal(n.data.statement,original.nodes.find(o=>o.id===n.id).data.statement);
 assert.deepEqual(applied.graph.nodes.filter(n=>n.kind==='entity'),original.nodes.filter(n=>n.kind==='entity'));
 assert.equal(applied.deferred_proposals.length,1);assert.equal(applied.identities_merged,false);
 const replay=applyReconciliationResult({graph:applied.graph,result:result(proposals),receipt});assert.deepEqual(replay.graph,applied.graph);
});
test('untyped, unsupported, wrong-kind, stale-generation and self links cannot enter the graph',()=>{
 for(const p of [proposal('possible_identity','possible_same_entity',['episode:a','episode:b']),proposal('group_retelling','retells',['assertion:a','assertion:b']),proposal('link','causes',['assertion:a','assertion:b']),proposal('link','qualifies',['assertion:a','assertion:a']),{...proposal('link','qualifies',['assertion:a','assertion:b']),evidence_ids:[]}])assert.throws(()=>validateReconciliationResult(result([p]),graph()));
 assert.throws(()=>applyReconciliationResult({graph:graph(),result:result([]),receipt:{...receipt,target_generation:'stale'}}),{code:'RECONCILIATION_RECEIPT_INVALID'});
});
test('proposals the graph would reject are deferred with their reason, and valid ones still apply',()=>{
 const g=graph();
 g.nodes.find(n=>n.id==='assertion:a').data.assertion_kind='direct_report';
 g.nodes.find(n=>n.id==='assertion:b').data.assertion_kind='explicit_correction';
 g.nodes.find(n=>n.id==='assertion:c').data.assertion_kind='reported_action';
 const proposals=[
  proposal('link','corrects',['assertion:a','assertion:c']),
  proposal('link','corrects',['assertion:b','assertion:a']),
  proposal('link','reported_effect_of',['assertion:a','assertion:c']),
  proposal('link','supported_by',['assertion:a','passage:a'])
 ];
 const applied=applyReconciliationResult({graph:g,result:result(proposals),receipt});
 assert.deepEqual(applied.graph.edges.map(e=>[e.relation,e.from,e.to]),[['corrects','assertion:b','assertion:a']]);
 assert.deepEqual(applied.deferred_proposals.map(p=>p.deferred_reason),
  ['CORRECTION_WITHOUT_CORRECTION_ASSERTION','INTENTION_CONFUSED_WITH_EFFECTIVE_ACTION','RECONCILIATION_EVIDENCE_EDGE']);
});
