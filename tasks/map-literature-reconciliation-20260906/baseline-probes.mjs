/** Read-only source-pinned probes; no model/network calls.
 * Run: node tasks/map-literature-reconciliation-20260906/baseline-probes.mjs /path/to/repo
 * Syntax checked in the supervisor environment; not executed against a full checkout there.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root=path.resolve(process.argv[2] || process.cwd());
const baseline='046614b045d4a15ea71b3b61e74b11d6b615a2ed';
const fingerprints={
 'src/guide-graph/planner.mjs':'f0202c3966e4a7a4af4ea7bfedc6c371f49dd9ff',
 'src/orchestrator/response-contract.mjs':'32e0c86f441fdc98b31251b4c4cb7287c630ff43',
 'guide-graphs/candidates/cross-guide.graph.json':'c48e40471aa78035d1f37c113c55196c9e4ccf19',
 'guide-graphs/candidates/inner-child.graph.json':'5803f39e8fd088845f19666166f26544d83399b1',
 'guide-graphs/candidates/somatic.graph.json':'5d56dd5745380661e354631f9726c5547db27cc2'
};
for(const [p,expected] of Object.entries(fingerprints)){
 const b=await fs.readFile(path.join(root,p));
 const actual=createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
 if(actual!==expected) throw new Error(`Baseline differs: ${p}; got ${actual}. Review new source before reusing these observations.`);
}
const {planFromGraphs}=await import(pathToFileURL(path.join(root,'src/guide-graph/planner.mjs')));
const {canonicalQuestion,requiredRealizationNodeIds}=await import(pathToFileURL(path.join(root,'src/orchestrator/response-contract.mjs')));
const graphs=await Promise.all(['inner-child','somatic','cross-guide'].map(async name=>JSON.parse(await fs.readFile(path.join(root,`guide-graphs/candidates/${name}.graph.json`),'utf8'))));
const steady={present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',suicidal_state:'absent',activation:'low',dissociation:'none',altered_state:'sober',inner_adult_access:'available',witness_capacity:'present',coherent_child_state:'present',body_capacity:'adequate',love_access:'accessible',self_directed_love:'safe',protective_response:'absent',urge_to_escape:'absent',credibility_conflict:'absent',self_criticism:'absent',identity_blur:'absent',belonging_pressure:'absent',current_intent:'conversation',spiritual_bypass_pattern:'not_applicable',existential_sufficiency:'sufficient',other_person_central:'no',influence_domain:'none',inward_attention_effect:'neutral',actionable_problem:'absent',unresolved_inner_material:'absent',attention_loop:'present',thinking_yield:'repetitive_no_new_output'};
const g025=JSON.parse(await fs.readFile(path.join(root,'corpus/graph-cases/G025.json'),'utf8'));
const fixtures=[
 ['loop_control',steady],
 ['loop_relationship',{...steady,other_person_central:'yes'}],
 ['loop_and_unfinished_grief',{...steady,unresolved_inner_material:'present'}],
 ['known_inward_worsening',{...steady,inward_attention_effect:'worsens',attention_loop:'absent',thinking_yield:'new_information_or_action',unresolved_inner_material:'present'}],
 ['G025',g025.variables],
 ['practical_task_unassessed_capacities',{...steady,actionable_problem:'present',attention_loop:'absent',thinking_yield:'new_information_or_action',inner_adult_access:'unknown',witness_capacity:'unknown',coherent_child_state:'unknown',body_capacity:'unknown'}],
 ['present_guard_after_reported_permission',{...steady,protective_response:'present',current_intent:'deep_dialogue',unresolved_inner_material:'present',attention_loop:'absent',thinking_yield:'new_information_or_action'}]
];
const results=fixtures.map(([id,variables])=>{
 const p=planFromGraphs({graphs,variables});
 return {id,primary:p.primaryJob,selected:p.selectedNodes.map(x=>x.id),deferred:p.deferredNodes.map(x=>x.id),requiredRealizations:requiredRealizationNodeIds(p),question:p.nextQuestion,questionSource:p.nextQuestionSource};
});
results.push({id:'explicit_none_question_with_stale_adjudication',question:canonicalQuestion({plan:{questionContract:{mode:'none',question:''},nextQuestion:''},adjudication:{next_question:'A stale question?'}})});
console.log(JSON.stringify({baseline,runtime:process.version,scope:'ACTUAL_REPOSITORY_PLANNER_ON_SYNTHETIC_VARIABLES',modelRuns:0,clinicalEvaluation:false,notes:['The guard case shows the current contract lacks an explicit permission state; no text extractor was run.','These are observations, not desired-policy acceptance passes.'],results},null,2));
