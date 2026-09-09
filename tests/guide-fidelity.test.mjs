import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {root, makeCaller, runEvaluation, ARMS} from '../tasks/guide-fidelity-20260906/run.mjs';
import {loadSourcePacket,sourceForCase} from '../tasks/guide-fidelity-20260906/source-packet.mjs';
import {CRITERIA,graderPrompt,validateGrade,combineGrades} from '../tasks/guide-fidelity-20260906/judging.mjs';
import {validateSettings,makeOpenRouterProvider} from '../tasks/guide-fidelity-20260906/openrouter-adapter.mjs';
const packet=await loadSourcePacket(root);
const suite=JSON.parse(await fs.readFile(path.join(root,'tasks/guide-fidelity-20260906/cases.json'),'utf8'));
const temporary=async t=>{const d=await fs.mkdtemp(path.join(os.tmpdir(),'is-fidelity-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;};
const grade=(over={})=>({criteria:CRITERIA.map(id=>({id,applicable:true,verdict:'pass',reason:'Synthetic contract fixture, not a semantic judgment',source_ids:['X'],answer_quote:'One useful response.'})),source_conflict:false,source_conflict_reason:'',...over});

test('fidelity suite cites actual source spans, not graph recommendation IDs',()=>{
 assert.equal(suite.cases.length,12);assert.equal(suite.cases.reduce((n,c)=>n+c.turns.length,0),23);
 for(const c of suite.cases){assert.ok(sourceForCase(packet,c).every(s=>s.text.length>20));assert.ok(c.requiredFunctions.length);}
 assert.ok(packet.full.length>30000);assert.equal(packet.truncated,false);
 assert.throws(()=>sourceForCase(packet,{sourceRefs:['invented']}));
});
test('blind grade input excludes arm identity, graph route and responder name',()=>{
 const prompt=graderPrompt({scenario:suite.cases[0],sources:sourceForCase(packet,suite.cases[0]),transcript:[{role:'user',content:'The same check again.'}],answer:'One useful response.'});
 for(const label of ARMS)assert.ok(!prompt.user.includes(label));
 assert.ok(!prompt.user.includes('primaryJob'));assert.ok(!prompt.user.includes('GF01'));
 assert.match(prompt.system,/multiple helpful moves/);assert.match(prompt.system,/not proof of competent delivery/);
});
test('review validation requires all criteria, real sources and exact answer quotes',()=>{
 const context={answer:'One useful response.',sources:[{id:'X'}]};
 assert.equal(validateGrade(grade(),context).verdict,'pass');
 const wrong=grade();wrong.criteria[0].answer_quote='Invented quotation';assert.throws(()=>validateGrade(wrong,context));
 const source=grade();source.criteria[0].source_ids=['wrong'];assert.throws(()=>validateGrade(source,context));
 assert.throws(()=>validateGrade(grade({criteria:grade().criteria.slice(1)}),context));
 assert.equal(validateGrade(grade({source_conflict:true,source_conflict_reason:'Two source rules conflict in this synthetic example'}),context).verdict,'uncertain');
});
test('independent disagreement or missing grades cannot become a pass',()=>{
 assert.equal(combineGrades([{verdict:'pass'}]).verdict,'ungraded');
 assert.equal(combineGrades([{verdict:'pass'},{verdict:'revise'}]).verdict,'review_required');
 assert.equal(combineGrades([{verdict:'pass'},{verdict:'block'}]).verdict,'block');
});
test('inapplicable judgments need an explicit explanation but no invented citation',()=>{
 const context={answer:'One useful response.',sources:[{id:'X'}]};
 const g=grade();
 const criterion=g.criteria.find(c=>c.id==='founder_independence');
 Object.assign(criterion,{applicable:false,reason:'No founder authority is invoked in this scene.',source_ids:[]});
 assert.equal(validateGrade(g,context).verdict,'pass');
 g.criteria.find(c=>c.id==='current_task_fit').verdict='block';
 assert.equal(validateGrade(g,context).verdict,'block','An inapplicable criterion cannot erase another criterion’s blocker');
 criterion.applicable=true;
 assert.throws(()=>validateGrade(g,context),/requires source evidence/);
 criterion.applicable=false;criterion.verdict='block';
 assert.throws(()=>validateGrade(g,context),/Inapplicable criterion/);
 criterion.verdict='pass';criterion.source_ids=['invented'];
 assert.throws(()=>validateGrade(g,context),/unavailable source/);
 criterion.source_ids=[];criterion.reason='';
 assert.throws(()=>validateGrade(g,context),/Incomplete/);
 criterion.reason='No founder authority is invoked.';delete criterion.applicable;
 assert.throws(()=>validateGrade(g,context),/applicability/);
});
test('preflight with no credential performs zero network calls and returns blocked, not a score',async t=>{
 let calls=0;const out=await temporary(t);
 const result=await runEvaluation({out,live:true,fetchImpl:async()=>{calls++;throw new Error('Must never run');}});
 assert.equal(result.status,'BLOCKED_CONFIGURATION');assert.equal(calls,0);assert.equal(result.responderOutputs,0);assert.equal(result.independentGrades,0);
});
test('checkpointed calls reserve before execution and resume without duplicate provider calls',async t=>{
 const dir=await temporary(t);let count=0;
 let caller=await makeCaller(dir,1);caller.scope('case');
 const meta={role:'fixture',model:'synthetic',stage:'test',request:{user:'x'}};
 await caller.execute(meta,async()=>{count++;return{text:'fixture result'};});
 caller=await makeCaller(dir,1);caller.scope('case');
 assert.equal((await caller.execute(meta,async()=>{count++;})).text,'fixture result');assert.equal(count,1);
 await assert.rejects(()=>caller.execute(meta,async()=>({})),/BUDGET/);
 caller.scope('case');await assert.rejects(()=>caller.execute({...meta,request:{user:'changed'}},async()=>({})),/DRIFT/);
});
test('failed/in-flight calls require review instead of unbounded automatic retries',async t=>{
 const dir=await temporary(t);const meta={role:'x',request:{user:'x'}};
 let c=await makeCaller(dir,3);c.scope('case');await assert.rejects(()=>c.execute(meta,async()=>{throw new Error('network failure');}));
 c=await makeCaller(dir,3);c.scope('case');await assert.rejects(()=>c.execute(meta,async()=>({})),/INCOMPLETE/);
});
test('OpenRouter test adapter refuses model substitution and truncated replies, excludes reasoning text',async()=>{
 const role={model:'explicit-model-id',expected_response_model:'pinned-id',provider:'Pinned Provider',api_key_env:'TEST_KEY',effort:'xhigh',max_tokens:256};
 let sent;
 const make=(data)=>makeOpenRouterProvider(role,{env:{TEST_KEY:'unit-test-placeholder'},execute:async(m,fn)=>{sent=m;return fn();},fetchImpl:async()=>({ok:true,json:async()=>data})});
 await assert.rejects(()=>make({model:'different',choices:[]}).generate({system:'s',user:'u'}),/identity/);
 await assert.rejects(()=>make({model:'pinned-id',choices:[{finish_reason:'length',message:{content:'partial'}}]}).generate({system:'s',user:'u'}),/truncated/);
 const result=await make({id:'req-fixture',model:'pinned-id',choices:[{finish_reason:'stop',message:{content:'ok',reasoning:'not stored'}}]}).generate({system:'s',user:'u'});
 assert.equal(result.text,'ok');assert.ok(!JSON.stringify(result).includes('not stored'));assert.equal(sent.request.provider.allow_fallbacks,false);assert.equal(sent.request.reasoning.effort,'xhigh');
});
test('unresolved responder ID, same-model graders or lower reasoning cannot silently use defaults',()=>{
 assert.ok(validateSettings(null,{}).length);
 const role={model:'x',expected_response_model:'x',provider:'P',api_key_env:'K',effort:'high',max_tokens:256};
 const errors=validateSettings({responder:role,graders:[role,role],max_calls:10,acknowledge_provider_retention:true},{K:'placeholder'});
 assert.ok(errors.some(e=>e.includes('xhigh')));assert.ok(errors.some(e=>e.includes('distinct')));
});


test('a blocker cannot be downgraded by uncertainty within the same grade',()=>{
 const g=grade({source_conflict:true,source_conflict_reason:'Some source ambiguity'});
 g.criteria[0].verdict='block';g.criteria[1].verdict='uncertain';
 assert.equal(validateGrade(g,{answer:'One useful response.',sources:[{id:'X'}]}).verdict,'block');
});

test('entire three-condition smoke and replay execute through fake transport only',async t=>{
 const out=await temporary(t);const key='INNER_SIGNAL_UNIT_TEST_TRANSPORT';
 const previous=process.env[key];process.env[key]='not-a-real-credential';
 t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
 const role=id=>({model:id,expected_response_model:id,provider:'SyntheticTransport',api_key_env:key,effort:'xhigh',max_tokens:2048});
 const settings={responder:role('fixture-responder'),graders:[role('fixture-grader-a'),role('fixture-grader-b')],max_calls:250,acknowledge_provider_retention:true};
 const controls=JSON.parse(await fs.readFile(path.join(root,'tasks/guide-fidelity-20260906/grader-controls.json'),'utf8'));
 const {blankCaseVariables}=await import('../src/guide-graph/contract.mjs');
 let calls=0;
 const fetchImpl=async(url,init)=>{
  calls++;const req=JSON.parse(init.body),system=req.messages[0].content,user=req.messages[1].content;
  let text='Synthetic connectivity acknowledgment.';
  if(system.startsWith('You independently review')){
   const packet=JSON.parse(user),control=controls.controls.find(c=>c.response===packet.candidate_response);
   const verdict=control?.expect==='reject'?'revise':'pass';
   text=JSON.stringify({criteria:CRITERIA.map(id=>({id,applicable:true,verdict,reason:'Deterministic fake transport fixture only; not a semantic grade.',source_ids:[packet.source_material[0].id],answer_quote:packet.candidate_response})),source_conflict:false,source_conflict_reason:''});
  }else if(system.includes('case-formulation extractor')){
   text=JSON.stringify({user_goal:'Fixture planning',current_issue:'transport test',turn_task:null,path_update:null,relational_readiness:null,romance_guide_context:null,threat_pathway:null,direct_observations:[],variables:{...blankCaseVariables(),present_safety:'safe',orientation:'oriented',ability_to_stop:'yes',ability_to_return:'yes',suicidal_state:'absent',altered_state:'sober',dissociation:'none',activation:'low',actionable_problem:'present',current_intent:'conversation'},hypotheses:[],unknowns:[]});
  }else if(system.includes('adversarial case-formulation auditor')){
   text=JSON.stringify({corrected_turn_task:null,invalidate_turn_task:false,corrected_path_representation:null,invalidate_path_representation:false,corrected_relational_readiness:null,invalidate_relational_readiness:false,corrected_romance_guide_context:null,invalidate_romance_guide_context:false,corrected_threat_pathway:null,invalidate_threat_pathway:false,remove_observation_ids:[],remove_hypothesis_ids:[],variable_corrections:[],add_unknowns:[],safety_flags:[],verdict:'accept',summary:'Synthetic transport only'});
  }else if(system.includes('response realizer')){
   const raw=user.split('DETERMINISTIC INTERVENTION CONTRACT:\n')[1].split('\n\nRESOLVED REASONING PACKET:')[0];
   const plan=JSON.parse(raw),answer='This is a synthetic transport fixture, not a therapeutic result.';
   text=JSON.stringify({answer,next_question:plan.nextQuestion,realized_nodes:(plan.executionContract?.requiredNodeIds??[]).map(id=>({id,evidence_quote:answer}))});
  }else if(system.startsWith('You are InnerSignal,'))text='Synthetic guide-reference fixture, not a therapeutic result.';
  else if(req.response_format)throw new Error('Unexpected fake pipeline stage: '+system.slice(0,100));
  return {ok:true,json:async()=>({id:`fixture-${calls}`,model:req.model,provider:'SyntheticTransport',choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:0,completion_tokens:0}})};
 };
 const result=await runEvaluation({out,settings,live:true,smoke:true,fetchImpl});
 assert.equal(result.status,'COMPLETED_SOURCE_FIDELITY_REVIEW',JSON.stringify(result));
 assert.equal(result.responderOutputs,21);assert.equal(result.independentGrades,42);
 const before=calls;
 const replay=await runEvaluation({out,settings,live:true,smoke:true,fetchImpl});
 assert.equal(replay.status,'COMPLETED_SOURCE_FIDELITY_REVIEW',JSON.stringify(replay));
 assert.equal(calls,before,'Identical replay must not duplicate even simulated provider calls');
});


test('parallel forensic-stage calls have durable serialized checkpoints',async t=>{
 const dir=await temporary(t),caller=await makeCaller(dir,5);caller.scope('parallel');
 const replies=await Promise.all([0,1,2,3].map(i=>caller.execute({role:'fixture',model:'x',stage:'parallel',request:{i}},async()=>{await new Promise(resolve=>setTimeout(resolve,4-i));return {text:String(i)};})));
 assert.equal(replies.length,4);
 const saved=JSON.parse(await fs.readFile(path.join(dir,'calls.json'),'utf8'));
 assert.equal(saved.records.length,4);assert.ok(saved.records.every(r=>r.status==='complete'));
});
