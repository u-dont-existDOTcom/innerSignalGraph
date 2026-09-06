import test from "node:test";
import assert from "node:assert/strict";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { canonicalQuestion, requiredRealizationNodeIds, enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { validateTurnTask, guidanceForTask, taskQuestion, reconcileIssueScope } from "../src/case-formulation/turn-task.mjs";
import { validateCaseSnapshot } from "../src/case-formulation/validators.mjs";
import { applyCaseAudit, planCaseSnapshot } from "../src/case-formulation/run.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
const bundle = await compileGuideGraphs({write:false});
const steady = {present_safety:"safe",orientation:"oriented",ability_to_stop:"yes",ability_to_return:"yes",suicidal_state:"absent",activation:"low",dissociation:"none",altered_state:"sober",inner_adult_access:"available",witness_capacity:"present",coherent_child_state:"present",body_capacity:"adequate",current_intent:"conversation",other_person_central:"no",influence_domain:"none",actionable_problem:"absent",unresolved_inner_material:"absent",attention_loop:"absent",inward_attention_effect:"neutral"};
const loop = {...steady, attention_loop:"present",thinking_yield:"repetitive_no_new_output"};
const plan=(v,t=null,unknowns=[])=>planFromGraphs({graphs:bundle.graphs,variables:v,turnTask:t,unknowns});
const task=(overrides={})=>({version:1,issue:"current",node_id:"ROUTE.ACT_OUTWARD",kind:"action",phase:"offer",agreement:"accepted",observation_ids:["O1"],marker:"A practical request",last_response:"",capacity:"unknown",question_focus:"none",action:null,emotion:null,...overrides});
const action=(overrides={})=>({step:"Ask a friend to walk",cue:"tomorrow after lunch",size:"ten minutes",barriers:"",purpose:"connection",outcome:"not_reported",result:"",adjustment:"",...overrides});

test("L01/L04: relationship completion and background grief do not prevent leaving distinct checking",()=>{
 for(const unresolved of ["absent","present"]) {
  const p=plan({...loop,other_person_central:"yes",unresolved_inner_material:unresolved,relational_check_status:"completed",loop_target_relation:"distinct_repetitive_process"});
  assert.equal(p.primaryJob.id,"ROUTE.LEAVE_ALONE");assert.equal(p.nextQuestion,"");
  assert.equal(p.variables.unresolved_inner_material,unresolved);
 }
});
test("L02/L03: unknown assessment, new threat, current action are not ignored",()=>{
 for(const status of ["pending","unknown","reopened"]) assert.equal(plan({...loop,other_person_central:"yes",relational_check_status:status}).primaryJob.id,"ROUTE.RELATIONAL_REALITY_CHECK");
 assert.equal(plan({...loop,other_person_central:"yes",relational_check_status:"completed",present_safety:"unsafe"}).primaryJob.id,"IC.SAFETY_ORIENTATION");
 assert.equal(plan({...loop,actionable_problem:"present"}).primaryJob.id,"ROUTE.ACT_OUTWARD");
});
test("derived eligibility cannot be forged and unknown action is not absent",()=>{
 assert.equal(deriveCaseVariables({...loop,present_safety:"unsafe",leave_alone_eligibility:"eligible"}).leave_alone_eligibility,"ineligible");
 assert.notEqual(plan({...loop,actionable_problem:"unknown"}).primaryJob?.id,"ROUTE.LEAVE_ALONE");
});
test("L05/L06: still-present willing guard does not block, refusal and unknown do",()=>{
 const v={...steady,protective_response:"present",current_intent:"deep_dialogue",unresolved_inner_material:"present"};
 const t=task({node_id:"IC.DEEP_CHILD_DIALOGUE",kind:"emotion",phase:"practice",capacity:"adequate"});
 const yes=plan({...v,guard_engagement:"willing_to_allow"},t);
 assert.ok(!yes.deferredNodes.some(n=>n.id==="IC.DEEP_CHILD_DIALOGUE"));
 for(const stance of ["unknown","blocking"]) assert.ok(plan({...v,guard_engagement:stance},t).deferredNodes.some(n=>n.id==="IC.DEEP_CHILD_DIALOGUE"));
 assert.ok(plan({...v,guard_engagement:"willing_to_allow",ability_to_stop:"no"},t).deferredNodes.some(n=>n.id==="IC.DEEP_CHILD_DIALOGUE"));
});
test("L07: unsafe plus borrowed spiritual support has no inward capacity question",()=>{
 const p=plan({...steady,present_safety:"unsafe",influence_domain:"experienced_other_than_self",metta_access:"inaccessible",spiritual_support_access:"accessible"});
 assert.equal(p.primaryJob.id,"IC.SAFETY_ORIENTATION");assert.equal(p.nextQuestion,"");
 assert.deepEqual(p.executionContract.requiredNodeIds,["IC.SAFETY_ORIENTATION"]);
 assert.ok(p.requiredNuance.some(s=>s.includes("not itself dependency")));
});
test("L08: known worsening does not trigger the same answered question",()=>{
 const p=plan({...steady,inward_attention_effect:"worsens"});
 assert.equal(p.primaryJob.id,"ROUTE.EXTERNAL_EMBODIMENT");assert.equal(p.nextQuestion,"");
});
test("L09: authoritative none survives stale adjudication, renderer and enforcement",()=>{
 const p={primaryJob:{id:"X"},questionContract:{mode:"none",question:""},nextQuestion:"Old?"};
 assert.equal(canonicalQuestion({plan:p,adjudication:{next_question:"Stale?"}}),"");
 const r=enforceResponseContract({answer:"Enough for today.\n\nRestart the practice?",next_question:"Restart?"},{plan:p,adjudication:{next_question:"Stale?"}});
 assert.equal(r.next_question,"");assert.doesNotMatch(r.answer,/Stale|Restart/);
});
test("L10: agreed action with known cue is not re-elicited",()=>{
 const t=task({action:action(),question_focus:"cue"});
 assert.equal(taskQuestion(t),"");
 const p=plan({...steady,actionable_problem:"present"},task({action:action()}));
 assert.equal(p.nextQuestion,"");assert.equal(p.executionContract.task.action.step,t.action.step);
});
test("L11: unknown capacity alone is not a witness/parent/regulation deficit",()=>{
 const p=plan({...steady,actionable_problem:"present",inner_adult_access:"unknown",coherent_child_state:"unknown",witness_capacity:"unknown",body_capacity:"unknown"});
 assert.equal(p.primaryJob.id,"ROUTE.ACT_OUTWARD");
 for(const id of ["IC.NEUTRAL_WITNESS","IC.BORROW_ONE_FUNCTION","SOM.GENTLE_REGULATION"]) assert.ok(!p.trace.some(n=>n.id===id));
});
test("L13: withdrawal of an observation invalidates its task, not only prose",()=>{
 const snapshot={user_goal:"act",current_issue:"current",direct_observations:[{id:"O1",statement:"asked to plan",evidence:"help plan"}],variables:steady,hypotheses:[],unknowns:[],turn_task:task()};
 validateCaseSnapshot(snapshot);
 const corrected=applyCaseAudit(snapshot,{remove_observation_ids:["O1"],remove_hypothesis_ids:[],variable_corrections:[],add_unknowns:[],verdict:"revise",summary:"unsupported",safety_flags:[]});
 assert.equal(corrected.turn_task,null);
});
test("task cannot silently cross issue boundary or use undeclared state",()=>{
 assert.equal(validateTurnTask(task(),{issue:"new issue"}),null);
 assert.throws(()=>validateTurnTask(task({hidden_diagnosis:"x"})),/not declared/);
 assert.throws(()=>validateTurnTask(task({observation_ids:[]})),/observation/);
});
test("audit can explicitly revoke or replace a task",()=>{
 const s={current_issue:"current",direct_observations:[{id:"O1"}],hypotheses:[],unknowns:[],variables:steady,turn_task:task()};
 const audit={remove_observation_ids:[],remove_hypothesis_ids:[],variable_corrections:[],add_unknowns:[],verdict:"revise",summary:"correct",safety_flags:[],invalidate_turn_task:true};
 assert.equal(applyCaseAudit(s,audit).turn_task,null);
 const replacement=task({agreement:"declined"});
 assert.equal(applyCaseAudit(s,{...audit,invalidate_turn_task:false,corrected_turn_task:replacement}).turn_task.agreement,"declined");
});
test("L15: context-only diagram secondaries do not force extra interventions",()=>{
 const p=plan({...steady,actionable_problem:"present",activation:"moderate",inner_adult_access:"partial",unresolved_inner_material:"present"});
 assert.ok(p.displayTrace.secondaryJobs.length>0);
 assert.deepEqual(requiredRealizationNodeIds(p),["ROUTE.ACT_OUTWARD"]);
 const r=enforceResponseContract({answer:"Choose one feasible action that changes the situation.",realized_nodes:[{id:"ROUTE.ACT_OUTWARD",evidence_quote:"Choose one feasible action that changes the situation."}]},{plan:p});
 assert.equal(r.responseContract.realizationCoveragePassed,true);
 assert.equal(requiredRealizationNodeIds({...p,executionContract:{version:1,requiredNodeIds:[]}})[0],"ROUTE.ACT_OUTWARD");
});
test("legacy coverage requirements and installed packet selection remain available",()=>{
 const p=planFromGraphs({graphs:bundle.graphs.map(({taskPolicyVersion,...g})=>g),variables:steady});
 assert.equal(p.contractVersion,"case-plan-v4");assert.equal(p.executionContract,undefined);
 assert.deepEqual(requiredRealizationNodeIds({primaryJob:{id:"A"},displayTrace:{secondaryJobs:[{id:"B"}]}}),["A","B"]);
});
test("L16/L17: action review reaches actual prompt rather than only source refs",async()=>{
 const t=task({phase:"review",action:action({outcome:"not_attempted",result:"Transport was cancelled"})});
 const snapshot={variables:{...steady,actionable_problem:"present"},unknowns:[],turn_task:t};
 const {plan:p}=await planCaseSnapshot(snapshot,{loadPlanningGraphBundle:async()=>bundle});
 assert.equal(p.executionContract.task.action.result,"Transport was cancelled");
 const prompt=realizationPrompt({userMessage:"The bus was cancelled",interventionContract:p},{},"test");
 assert.match(prompt.user,/Transport was cancelled/);assert.match(prompt.user,/resources, opportunity, skill/);
 assert.ok(p.selectedNodes.find(n=>n.id==="ROUTE.ACT_OUTWARD").successSignals.length);
});
test("L18/L19: current guidance preserves rest, connection and feasibility",()=>{
 const text=guidanceForTask(task()).join(" ");assert.match(text,/Rest, connection, flexibility/);assert.match(text,/feasible/);
});
test("L20: close suppresses stale unknown and new homework questions",()=>{
 const p=plan({...steady,actionable_problem:"present"},task({phase:"close"}),[{variable:"another_idea",importance:5,question:"More work?"}]);
 assert.equal(p.nextQuestion,"");assert.match(p.executionContract.taskGuidance.join(" "),/definite ending/);
});
test("L21/L22: emotional task guidance distinguishes justified emotion from self-treatment",()=>{
 const e=(process)=>task({kind:"emotion",emotion:{process,response:"",change_point:""}});
 assert.match(guidanceForTask(e("adaptive_emotion")).join(" "),/Do not presume all anger hides sadness/);
 assert.match(guidanceForTask(e("self_treatment")).join(" "),/not a default explanation/);
});
test("L23-L25: task includes partial change and responsive care, not automatic escalation",()=>{
 const t=task({kind:"emotion",emotion:{process:"anguish",response:"The hug was intrusive",change_point:"Space feels better"}});
 const text=guidanceForTask(t).join(" ");assert.match(text,/Adapt intrusive/);assert.match(text,/partial/);assert.match(text,/Loss of orientation/);
});
test("L26: emotional task is not the tapping node",()=>{
 const tapping=bundle.graphs.flatMap(g=>g.nodes).find(n=>n.id==="SOM.EFT_PORTABLE");
 assert.ok(tapping.recommendations.some(s=>/tapping/i.test(s)));
 assert.ok(!tapping.sourceRefs.includes("AMEND.IC.EMOTIONAL_TASK_GUIDANCE"));
});
test("L27: reported spiritual struggle has its own job without ontology certification",()=>{
 const p=plan({...steady,spiritual_struggle:"present"});
 assert.equal(p.primaryJob.id,"IC.SPIRITUAL_STRUGGLE");assert.ok(p.avoid.some(s=>/parent projection/.test(s)));
});
test("L28/L29: ongoing devotion and appropriate surrender retain capacity",()=>{
 const p=plan({...steady,influence_domain:"experienced_other_than_self",metta_access:"inaccessible",spiritual_support_access:"accessible"});
 assert.ok(p.selectedNodes.find(n=>n.id==="ROUTE.INFLUENCE_LOVE_CAPACITY").recommendations.some(s=>/relinquishing control/.test(s)));
 assert.ok(p.requiredNuance.some(s=>/not itself dependency/.test(s)));
});
test("L30: declined task cannot be required as a second exercise",()=>{
 const t=task({node_id:"ROUTE.INFLUENCE_LOVE_CAPACITY",kind:"spiritual_struggle",agreement:"declined"});
 const p=plan({...steady,influence_domain:"experienced_other_than_self",metta_access:"inaccessible"},t);
 assert.ok(!requiredRealizationNodeIds(p).includes(t.node_id));assert.match(p.executionContract.taskGuidance.join(" "),/Respect the refusal/);
});

test("scoped completion/permission reset when the issue changes, not on mere continued discussion",()=>{
 const prior={current_issue:"old",variables:{relational_check_status:"completed",guard_engagement:"willing_to_allow"}};
 const next={...prior,current_issue:"new"};
 assert.equal(reconcileIssueScope(next,prior).variables.relational_check_status,"unknown");
 assert.equal(reconcileIssueScope(next,prior).variables.guard_engagement,"unknown");
 assert.equal(reconcileIssueScope(prior,prior).variables.relational_check_status,"completed");
});


test('imminent danger remains protection-first even when location is classified safe',()=>{
 const p=plan({...steady,suicidal_state:'imminent',inner_adult_access:'available',witness_capacity:'present'});
 assert.equal(p.primaryJob.id,'IC.SAFETY_ORIENTATION');
 assert.equal(p.nextQuestion,'');
 assert.ok(p.deferredNodes.some(n=>n.id==='IC.SUICIDAL_SELF_DEATH_INQUIRY'));
});
