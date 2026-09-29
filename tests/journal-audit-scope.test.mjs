import test from 'node:test';
import assert from 'node:assert/strict';
import {createReconciledAuditScope,summarizeFidelityCoverage} from '../src/journal-import/audit-scope.mjs';
test('audit uses reconciled version and resolves cross-unit evidence without importing unrelated hub neighbors',()=>{
 const n=(id,kind,data)=>({id,kind,data});
 const original=n('a','assertion',{statement:'Synthetic early claim',evidence_ids:['p'],speaker_id:'person',subject_ids:['person']});
 const final={...original,version:2,data:{...original.data,support_group_id:'shared'}};
 const nodes=[final,n('b','assertion',{statement:'Synthetic later correction',evidence_ids:['q'],subject_ids:['person']}),n('unrelated','assertion',{evidence_ids:['r'],subject_ids:['person']}),n('person','entity',{evidence_ids:['p']}),n('p','passage',{unit_id:'u',quote:'Early',representation_id:'rep'}),n('q','passage',{unit_id:'v',quote:'Later',representation_id:'rep'}),n('r','passage',{unit_id:'w',quote:'Unrelated',representation_id:'rep'}),n('s','source',{representation_id:'rep'})];
 const edge={id:'correction',relation:'corrects',from:'b',to:'a',evidence_ids:['q'],derivation_ref:'receipt'};
 const scope=createReconciledAuditScope({graph:{generation:'g',nodes,edges:[edge]},unitGraph:{nodes:[original,nodes[4]],edges:[]}});
 assert.equal(scope.graph.nodes.find(n=>n.id==='a').data.support_group_id,'shared');
 assert.ok(scope.graph.nodes.some(n=>n.id==='b'));assert.ok(!scope.graph.nodes.some(n=>n.id==='unrelated'));
 assert.deepEqual(scope.assessment_target_ids,['a','correction']);
 assert.deepEqual(scope.exclusion_ids,['a','correction']);
 assert.deepEqual(scope.supporting_passages.map(p=>p.passage_id).sort(),['p','q']);
});
test('a failed unit excludes its semantic nodes without excluding source or another unit\'s matching entity',()=>{
 const n=(id,kind,data={})=>({id,kind,data});
 const failed=[n('failed-entity','entity',{label:'Same person'}),n('failed-episode','episode'),n('failed-assertion','assertion'),n('failed-passage','passage',{unit_id:'failed',representation_id:'rep'})];
 const passed=n('passed-entity','entity',{label:'Same person'}),source=n('source','source',{representation_id:'rep'});
 const relation={id:'possible-identity',relation:'possible_same_entity',from:'failed-entity',to:'passed-entity',evidence_ids:['failed-passage'],derivation_ref:'receipt'};
 const scope=createReconciledAuditScope({graph:{generation:'g',nodes:[...failed,passed,source],edges:[relation]},
  unitGraph:{nodes:failed,edges:[]},derivationRef:'receipt'});
 assert.deepEqual(new Set(scope.exclusion_ids),new Set(['failed-entity','failed-episode','failed-assertion','possible-identity']));
 assert.deepEqual(scope.assessment_target_ids,['failed-assertion','possible-identity']);
 assert.ok(!scope.exclusion_ids.includes('failed-passage'));
 assert.ok(!scope.exclusion_ids.includes('source'));
 assert.ok(!scope.exclusion_ids.includes('passed-entity'));
});
test('missing and distorted candidates remain outside trusted coverage even with a sufficient status',()=>{
 const reference={reference_items:[{id:'ref'}],unassessed_unit_ids:[]};
 const review={status:'sufficient_for_stated_scope',unassessed_ids:[],assessments:[{target_id:'ref',outcome:'preserved'},{target_id:'bad',outcome:'distorted',finding_type:'wrong_person'}]};
 const result=summarizeFidelityCoverage({reference,review,candidateIds:['bad','missing']});
 assert.equal(result.complete,false);assert.deepEqual(result.unassessed_ids,['missing']);assert.deepEqual(result.untrusted_candidate_ids,['bad','missing']);assert.equal(result.repair_required,true);
});
test('duplicate assessments cannot turn an omitted assertion into complete trusted coverage',()=>{
 const result=summarizeFidelityCoverage({reference:{reference_items:[],unassessed_unit_ids:[]},
  review:{status:'sufficient_for_stated_scope',unassessed_ids:[],assessments:[
   {target_id:'assertion',outcome:'omitted',finding_type:'missing_evidence'},
   {target_id:'assertion',outcome:'preserved',finding_type:'none'}]},candidateIds:['assertion']});
 assert.equal(result.complete,false);
 assert.deepEqual(result.untrusted_candidate_ids,['assertion']);
 assert.equal(result.repair_required,true);
});
test('an adverse finding remains unsafe when its outcome says preserved',()=>{
 const result=summarizeFidelityCoverage({reference:{reference_items:[],unassessed_unit_ids:[]},
  review:{status:'sufficient_for_stated_scope',unassessed_ids:[],assessments:[
   {target_id:'assertion',outcome:'preserved',finding_type:'wrong_identity'}]},candidateIds:['assertion']});
 assert.deepEqual(result.untrusted_candidate_ids,['assertion']);
 assert.equal(result.repair_required,true);
});
