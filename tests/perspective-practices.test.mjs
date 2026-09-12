import test from 'node:test';
import assert from 'node:assert/strict';
import {PERSPECTIVE_NODE_BY_VALUE, perspectivePracticesEnabled, perspectivePracticeForTask, eligibleDraftEditorSupport} from '../src/guide-graph/perspective-practices.mjs';
const graph = [{taskPolicyVersion:1,nodes:Object.values(PERSPECTIVE_NODE_BY_VALUE).map(id => ({id}))}];
const task = (id, more={}) => ({node_id:id,phase:'practice',agreement:'accepted',observation_ids:['o1'],kind:'action',action:{step:'State my boundary in a message.'},...more});
for (const [value,id] of Object.entries(PERSPECTIVE_NODE_BY_VALUE)) {
  test('requested task routes: '+value,()=>assert.equal(perspectivePracticeForTask(task(id),graph),value));
  test('declined task does not route: '+value,()=>assert.equal(perspectivePracticeForTask(task(id,{agreement:'declined'}),graph),'unknown'));
}
test('legacy graph disabled',()=>assert.equal(perspectivePracticesEnabled([{nodes:graph[0].nodes}]),false));
test('partial installation disabled',()=>assert.equal(perspectivePracticesEnabled([{taskPolicyVersion:1,nodes:graph[0].nodes.slice(1)}]),false));
test('closed task does not route',()=>assert.equal(perspectivePracticeForTask(task(PERSPECTIVE_NODE_BY_VALUE.draft_editor,{phase:'close'}),graph),'unknown'));
test('no observation cannot select',()=>assert.equal(perspectivePracticeForTask(task(PERSPECTIVE_NODE_BY_VALUE.draft_editor,{observation_ids:[]}),graph),'unknown'));
test('offer is not unconsented practice',()=>assert.equal(perspectivePracticeForTask(task(PERSPECTIVE_NODE_BY_VALUE.draft_editor,{agreement:'unknown'}),graph),'unknown'));
test('grounded offer can route as offer',()=>assert.equal(perspectivePracticeForTask(task(PERSPECTIVE_NODE_BY_VALUE.draft_editor,{phase:'offer',agreement:'unknown'}),graph),'draft_editor'));
const edit={id:PERSPECTIVE_NODE_BY_VALUE.draft_editor};
const base={primary:{id:'ROUTE.ACT_OUTWARD'},eligible:[edit],task:task(edit.id),variables:{other_person_central:'yes',relational_check_status:'completed'}};
test('outward support admitted after assessment',()=>assert.equal(eligibleDraftEditorSupport(base),edit));
for (const [label,delta] of [
 ['not the outward job',{primary:{id:'ROUTE.RELATIONAL_REALITY_CHECK'}}],
 ['emergency',{emergency:true}], ['controller interruption',{interrupt:true}],
 ['pending relationship check',{variables:{other_person_central:'yes',relational_check_status:'pending'}}],
 ['missing safety',{variables:{present_safety:'unsafe'}}],
 ['no actionable step',{task:task(edit.id,{action:{step:''}})}],
 ['unaccepted',{task:task(edit.id,{agreement:'unknown'})}],
 ['not eligible',{eligible:[]}],
 ['loss of orientation',{variables:{orientation:'disoriented'}}],
 ['intense dissociation',{variables:{dissociation:'high'}}]
]) test('no composition: '+label,()=>assert.equal(eligibleDraftEditorSupport({...base,...delta}),null));
