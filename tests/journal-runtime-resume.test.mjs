import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {openJournalExecutionRuntime,renderJournalPdfPage} from '../src/journal-import/private-runtime.mjs';
import {createDisabledJournalInferencePort,createMockJournalInferencePort,JournalInferencePortError} from '../src/journal-import/provider-port.mjs';
import {createDurableJournalInferencePort} from '../src/journal-import/durable-inference.mjs';
import {createCorpusJournalJobLedger} from '../src/journal-import/controller.mjs';
import {journalRoleInstruction} from '../src/journal-import/provider-port.mjs';
import {runJournalImportCli} from '../src/cli/journal-import.mjs';
import {createPrivateJournalCorpusStore} from '../src/storage/private-journal-corpus.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-resume-synthetic-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'private'),{mode:0o700});
 const text='Synthetic entry, uncertain date. A blue cup is on the table.\n';
 await fs.writeFile(path.join(root,'private','source.txt'),text,{mode:0o600});
 const config={schema_version:1,max_external_spend_usd:0,execution_root:path.join(root,'execution'),private_runtime_root:root,source:{relative_path:'private/source.txt',bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')},target_profile:{case_id:'synthetic-case'},existing_grant_ref:'synthetic:grant'};
 const configPath=path.join(root,'private','config.json');
 await fs.writeFile(configPath,JSON.stringify(config),{mode:0o600});
 return {root,config,configPath,service:{verifyCaseAccess:async()=>({})},inferencePort:createDisabledJournalInferencePort()};
}

test('runtime reopens the encrypted source checkpoint without invoking the parser or inference',async t=>{
 const f=await fixture(t);let runtime=await openJournalExecutionRuntime(f);
 const first=await runtime.execute('stage');await runtime.close();
 assert.equal(first.completion.archive_verified,'pass');
 const before=await fs.readFile(path.join(f.config.execution_root,'state.json'));
 runtime=await openJournalExecutionRuntime({...f,sourceParser:()=>assert.fail('completed parse must be reused')});
 assert.deepEqual(await runtime.execute('stage'),first);
 assert.deepEqual(await fs.readFile(path.join(f.config.execution_root,'state.json')),before);
 await runtime.execute('verify');await runtime.close();
 const after=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
 const saved=JSON.parse(before);
 assert.deepEqual(after.parsed_ref,saved.parsed_ref);assert.deepEqual(after.original,saved.original);
 assert.equal(after.raw_verification.source_or_producer_history_used_by_reader,false);
});

test('publication is denied before reviewed semantic and pattern dependencies exist',async t=>{
 const f=await fixture(t);const runtime=await openJournalExecutionRuntime(f);
 try{await runtime.execute('stage');await assert.rejects(()=>runtime.execute('commit'),{code:'JOURNAL_REVIEWED_GENERATION_NOT_READY'});}finally{await runtime.close();}
});

test('CLI sends status to the authorized runtime and always closes it',async t=>{
 const f=await fixture(t);let closed=false,output='';
 assert.equal(await runJournalImportCli(['status','--config',f.configPath],{stdout:{write:s=>output+=s},stderr:{write:()=>assert.fail('unexpected CLI error')},runtimeFactory:async input=>{
 assert.equal(input.configPath,f.configPath);
 return {execute:async command=>{assert.equal(command,'status');return {stage:'PARTITION'};},close:async()=>{closed=true;}};
 }}),0);assert.equal(closed,true);assert.equal(JSON.parse(output).stage,'PARTITION');
});

test('newly declared parser hazards revise only the plan and keep completed parsing and original bytes',async t=>{
 const f=await fixture(t);
 const parser=async()=>({source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},parser:{version:'synthetic'},pages:[{page_number:1,representation_id:'synthetic:page',disposition:'readable',warnings:[],image_inventory:[]}],representations:[{representation_id:'synthetic:page',text:'Synthetic page.',utf8_byte_length:15}]});
 let runtime=await openJournalExecutionRuntime({...f,sourceParser:parser});await runtime.execute('stage');await runtime.close();
 const before=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
 runtime=await openJournalExecutionRuntime({...f,config:{...f.config,parser_hazard_pages:[1]},sourceParser:()=>assert.fail('must not reparse')});
 const result=await runtime.execute('stage');await runtime.close();assert.equal(result.required_visual_pages,1);
 const after=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
 assert.deepEqual(after.original,before.original);assert.deepEqual(after.plan_revisions,[before.parsed_ref]);assert.deepEqual(after.raw_persisted,before.raw_persisted);
 const key=await fs.readFile(path.join(f.config.execution_root,'staging.key'));
 const store=createPrivateJournalCorpusStore({rootDir:f.config.execution_root,caseId:after.case_id,corpusId:after.corpus_id,corpusKey:key});
 try{const plan=JSON.parse((await store.reassembleOriginal(after.parsed_ref)).toString());assert.deepEqual(plan.visual_pages,[1]);assert.ok(plan.units[0].hazard_types.includes('declared_source_hazard'));}finally{store.close();key.fill(0);}
});

test('synthetic runtime completes the application reconciliation stage once and resumes its saved graph',async t=>{
 const f=await fixture(t);const calls=[];
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:p=>({schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]}),
  extractor:p=>({schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic pipeline fixture.'})),requested_context:[]}),
  omission_checker:p=>review('omission_checker',p),fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>{assert.ok(p.candidates.nodes.length);assert.equal(p.neighborhood_evidence.more_available,false);return {schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'};}
 };
 const port=createMockJournalInferencePort({handlers:Object.fromEntries(Object.entries(handlers).map(([role,fn])=>[role,p=>{calls.push(role);return fn(p)}]))});
 let runtime=await openJournalExecutionRuntime({...f,inferencePort:port});
 const result=await runtime.execute('run');await runtime.close();
 assert.equal(result.completion.graph_built,'pass');assert.equal(result.stage,'REFERENCE_AUDIT');
 assert.deepEqual(calls,['reference_reader','extractor','omission_checker','fidelity_auditor','reconciler']);
 runtime=await openJournalExecutionRuntime({...f,sourceParser:()=>assert.fail('completed source must not reparse')});
 assert.deepEqual(await runtime.execute('run'),result);await runtime.close();
});

test('authoritative reference recovery waits on the existing operation after an empty completion snapshot',async t=>{
 const f=await fixture(t);let answerReady=false,completionChecks=0;const referenceKeys=[];
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:()=>({schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]}),
  extractor:p=>({schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic pipeline fixture.'})),requested_context:[]}),
  omission_checker:p=>review('omission_checker',p),fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 const makePort=()=>{
  const base=createMockJournalInferencePort({handlers});
  return {
   capabilities:()=>({...base.capabilities(),authoritative_completion:true}),
   async invoke(input){
    if(input.role==='reference_reader'){
     referenceKeys.push(input.operationKey);
     if(!answerReady)throw new JournalInferencePortError('COMPLETION_UNKNOWN',{submissionStatus:'unknown'});
    }
    return base.invoke(input);
   },
   async getCompletion(){completionChecks++;return {status:'unknown'};},
   close:()=>base.close()
  };
 };
 let runtime=await openJournalExecutionRuntime({...f,inferencePort:makePort()});
 let result;
 try{result=await runtime.execute('run');}finally{await runtime.close();}
 assert.equal(result.blocker,'COMPLETION_UNKNOWN');
 answerReady=true;
 runtime=await openJournalExecutionRuntime({...f,inferencePort:makePort()});
 try{result=await runtime.execute('run');}finally{await runtime.close();}
 assert.equal(result.completion.graph_built,'pass');
 assert.equal(result.blocker,null);
 assert.equal(completionChecks,1);
 assert.equal(referenceKeys.length,2);
 assert.equal(referenceKeys[1],referenceKeys[0],'the resumed call waits on the existing operation instead of creating another');
});

test('revocation during a semantic call prevents completed-result admission and all dependent calls',async t=>{
 const f=await fixture(t);let revoked=false,calls=0;
 const service={verifyCaseAccess:async()=>{if(revoked)throw Object.assign(new Error('Synthetic revoked grant'),{code:'GRANT_REVOKED'});}};
 const port=createMockJournalInferencePort({handlers:{reference_reader:()=>{calls++;revoked=true;return {schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]};}}});
 const runtime=await openJournalExecutionRuntime({...f,service,inferencePort:port});
 await assert.rejects(()=>runtime.execute('run'),{code:'GRANT_REVOKED'});await runtime.close();assert.equal(calls,1);
 const state=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));assert.deepEqual(state.completed_units,[]);
 const directory=path.join(f.config.execution_root,'.journal-corpora');
 for(const bucket of await fs.readdir(directory))for(const file of await fs.readdir(path.join(directory,bucket))){
  const envelope=JSON.parse(await fs.readFile(path.join(directory,bucket,file),'utf8'));
  assert.equal(/^inference:.*:result$/.test(envelope.object_id),false,'revoked output must not become a completed durable inference result');
 }
});

test('revocation while an intent is written records not submitted before transport',async t=>{
 const f=await fixture(t);let revoked=false,calls=0,intentId;
 const service={verifyCaseAccess:async()=>{if(revoked)throw Object.assign(new Error('Synthetic revoked grant'),{code:'GRANT_REVOKED'});}};
 const port={capabilities:()=>({}),async invoke(){calls++;throw new Error('private packet escaped');},async getCompletion(){return {status:'not_submitted'};}};
 const rename=fs.rename;
 fs.rename=async(from,to)=>{
  const envelope=JSON.parse(await fs.readFile(from,'utf8'));
  await rename(from,to);
  if(/^inference:.*:intent$/.test(envelope.object_id)){intentId=envelope.object_id;revoked=true;}
 };
 try{
  const runtime=await openJournalExecutionRuntime({...f,service,inferencePort:port});
  try{await assert.rejects(()=>runtime.execute('run'),{code:'GRANT_REVOKED'});}finally{await runtime.close();}
 }finally{fs.rename=rename;}
 assert.ok(intentId);assert.equal(calls,0);
 const state=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json'),'utf8'));
 const key=await fs.readFile(path.join(f.config.execution_root,'staging.key'));
 const store=createPrivateJournalCorpusStore({rootDir:f.config.execution_root,caseId:state.case_id,corpusId:state.corpus_id,corpusKey:key});
 try{assert.equal((await store.readJsonObject({objectId:intentId.replace(/:intent$/,':result')})).status,'not_submitted');}
 finally{await store.close();key.fill(0);}
});

test('revocation after a reference completion probe prevents its private packet from being sent',async t=>{
 const f=await fixture(t);
 const firstPort={capabilities:()=>({authoritative_completion:true}),
  async invoke(){throw new JournalInferencePortError('COMPLETION_UNKNOWN',{submissionStatus:'unknown'});},
  async getCompletion(){return {status:'unknown'};}};
 let runtime=await openJournalExecutionRuntime({...f,inferencePort:firstPort});
 try{assert.equal((await runtime.execute('run')).blocker,'COMPLETION_UNKNOWN');}finally{await runtime.close();}

 let revoked=false,referenceCalls=0;
 const service={verifyCaseAccess:async()=>{
  if(revoked)throw Object.assign(new Error('Synthetic revoked grant'),{code:'GRANT_REVOKED'});
 }};
 const resumedPort={
  capabilities(){return {authoritative_completion:true};},
  // Access changes after the completion probe; the runtime must check it again before a send.
  async getCompletion(){revoked=true;return {status:'unknown'};},
  async invoke(){referenceCalls++;return {output:{schema_version:'1.0',source_only_first_pass:true,
   reference_items:[],questions:[],unassessed_unit_ids:[]},receipt:{request_id:'synthetic'}};}
 };
 runtime=await openJournalExecutionRuntime({...f,service,inferencePort:resumedPort});
 try{await assert.rejects(()=>runtime.execute('run'),{code:'GRANT_REVOKED'});}finally{await runtime.close();}
 assert.equal(revoked,true);
 assert.equal(referenceCalls,0,'the revoked reference packet must never reach the semantic port');
});

function memoryStore(){const data=new Map();return {data,readJsonObject:async({objectId})=>{if(!data.has(objectId))throw Object.assign(new Error(),{code:'ENOENT'});return structuredClone(data.get(objectId));},writeJsonObject:async({objectId,value})=>{assert.equal(data.has(objectId),false,'immutable record');data.set(objectId,structuredClone(value));}};}

test('unmatched source quotes return to bounded application repair before graph admission',async t=>{
 const f=await fixture(t);let extractions=0;
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:()=>({schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]}),
  extractor:p=>{
   extractions++;
   if(extractions===2)assert.equal(p.repair_request.mechanical_failure.code,'QUOTE_NOT_FOUND');
   return {schema_version:'1.0',status:'complete',entities:[{local_id:'object',label:'Synthetic cup',entity_kind:'object',anchors:[{unit_id:p.core_units[0].unit_id,quote:extractions===1?'Nonexistent quote':'A blue cup is on the table.',occurrence:null}]}],episodes:[],assertions:[],coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic mapping fixture.'})),requested_context:[]};
  },
  omission_checker:p=>review('omission_checker',p),fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 const runtime=await openJournalExecutionRuntime({...f,inferencePort:createMockJournalInferencePort({handlers})});
 try{assert.equal((await runtime.execute('run')).completion.graph_built,'pass');assert.equal(extractions,2);}finally{await runtime.close();}
});
const request={role:'extractor',packet:{grant_purpose:'organize_search'},operationKey:'synthetic:operation',grant:{purpose:'organize_search',allowed_roles:['extractor'],revoked:false}};

test('durable port retries only proven non-submissions and reuses completed results after restart',async()=>{
 const store=memoryStore();let calls=0;
 const port={capabilities:()=>({}),invoke:async()=>{if(++calls===1)throw new JournalInferencePortError('UNAVAILABLE',{submissionStatus:'not_submitted'});return {output:{synthetic:true},receipt:{request_id:'synthetic'}};},getCompletion:async()=>({status:'not_submitted'})};
 let durable=createDurableJournalInferencePort({port,corpusStore:store});
 await assert.rejects(()=>durable.invoke(request),{code:'UNAVAILABLE'});
 durable=createDurableJournalInferencePort({port,corpusStore:store});
 await durable.invoke(request);await durable.invoke(request);assert.equal(calls,2);
 await assert.rejects(()=>durable.invoke({...request,packet:{...request.packet,extra:true}}),{code:'OPERATION_KEY_CONFLICT'});
});

test('a standard reference audit replays a legacy durable result whose input omitted the default tier',async t=>{
 const f=await fixture(t);let replayed=false;
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const reference={schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]};
 const base=createMockJournalInferencePort({handlers:{
  reference_reader:()=>assert.fail('the stored legacy reference result must be replayed'),
  extractor:p=>({schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic legacy replay fixture.'})),requested_context:[]}),
  omission_checker:p=>review('omission_checker',p),fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 }});
 const legacyStore=memoryStore();
 const legacyDurable=createDurableJournalInferencePort({corpusStore:legacyStore,port:{
  capabilities:()=>base.capabilities(),invoke:()=>assert.fail('the durable legacy result must prevent resubmission'),
  getCompletion:()=>assert.fail('the durable legacy result must be read directly')
 }});
 const port={
  capabilities:()=>base.capabilities(),getCompletion:key=>base.getCompletion(key),
  invoke(input){
   if(input.role!=='reference_reader'||replayed)return base.invoke(input);
   replayed=true;
   const legacyInput={role:input.role,packet:input.packet,outputSchema:input.outputSchema,operationKey:input.operationKey,grant:input.grant};
   const prefix=`inference:${createHash('sha256').update(input.operationKey).digest('hex')}:`;
   legacyStore.data.set(`${prefix}intent`,{operation_key:input.operationKey,input_sha256:createHash('sha256').update(JSON.stringify(legacyInput)).digest('hex'),authoritative_completion:false,recorded_at:'2026-09-27T00:00:00.000Z'});
   legacyStore.data.set(`${prefix}result`,{status:'completed',output:reference,receipt:{request_id:'legacy-standard-reference'}});
   return legacyDurable.invoke(input);
  },
  close(){legacyDurable.close();base.close();}
 };
 const runtime=await openJournalExecutionRuntime({...f,inferencePort:port});
 try{const result=await runtime.execute('run');assert.equal(result.completion.graph_built,'pass');assert.equal(replayed,true);}
 finally{await runtime.close();}
});

test('durable port refuses automatic resubmission after an unknown completion',async()=>{
 const store=memoryStore();let calls=0;
 const port={capabilities:()=>({}),invoke:async()=>{calls++;throw new JournalInferencePortError('COMPLETION_UNKNOWN',{submissionStatus:'unknown'});},getCompletion:async()=>({status:'not_submitted'})};
 await assert.rejects(()=>createDurableJournalInferencePort({port,corpusStore:store}).invoke(request));
 await assert.rejects(()=>createDurableJournalInferencePort({port,corpusStore:store}).invoke(request),{code:'COMPLETION_UNKNOWN'});assert.equal(calls,1);
});


test('three source units through one source-first batch reach the saved graph',async t=>{
 const f=await fixture(t);
 const texts=['Synthetic first event.','Synthetic second event.','Synthetic third event.'];
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-three'},
  pages:texts.map((_,i)=>({page_number:i+1,representation_id:'synthetic:page:'+i,disposition:'readable',warnings:[],image_inventory:[]})),
  representations:texts.map((text,i)=>({representation_id:'synthetic:page:'+i,text,utf8_byte_length:Buffer.byteLength(text)}))
 });
 const calls=[];
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:p=>({schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]}),
  extractor:p=>({schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic coverage.'})),requested_context:[]}),
  omission_checker:p=>review('omission_checker',p),
  fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 const port=createMockJournalInferencePort({handlers:Object.fromEntries(Object.entries(handlers).map(([role,fn])=>[role,p=>{calls.push(role);return fn(p)}]))});
 const runtime=await openJournalExecutionRuntime({...f,config:{...f.config,semantic_batching:{calibration_maximum_units:3}},sourceParser:parser,inferencePort:port});
 try{
  const result=await runtime.execute('run');
  assert.equal(result.completed_units,3);
  assert.equal(result.calibration,'pass');
  assert.equal(result.completion.graph_built,'pass');
  assert.deepEqual(calls,['reference_reader','extractor','omission_checker','fidelity_auditor','reconciler']);
 }finally{await runtime.close();}
});

test('completed semantic batch survives a known non-submission and restart', async t => {
 const f=await fixture(t);
 const texts=['Synthetic first event.','Synthetic second event.','Synthetic third event.'];
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-resume'},
  pages:texts.map((_,i)=>({page_number:i+1,representation_id:'synthetic:page:'+i,disposition:'readable',warnings:[],image_inventory:[]})),
  representations:texts.map((text,i)=>({representation_id:'synthetic:page:'+i,text,utf8_byte_length:Buffer.byteLength(text)}))
 });
 const config={...f.config,semantic_batching:{maximum_units:2,calibration_maximum_units:2,reconciliation_maximum_units:2}};
 const extracted=[];let referenceCalls=0,failOnce=true;
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:()=>{
   referenceCalls++;
   if(failOnce && referenceCalls===2){failOnce=false;throw new JournalInferencePortError('UNAVAILABLE',{submissionStatus:'not_submitted'});}
   return {schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]};
  },
  extractor:p=>{
   extracted.push(p.core_units.map(u=>u.unit_id));
   return {schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic coverage.'})),requested_context:[]};
  },
  omission_checker:p=>review('omission_checker',p),
  fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 let runtime=await openJournalExecutionRuntime({...f,config,sourceParser:parser,inferencePort:createMockJournalInferencePort({handlers})});
 try{await assert.rejects(()=>runtime.execute('run'),{code:'UNAVAILABLE'});}finally{await runtime.close();}
 const checkpoint=JSON.parse(await fs.readFile(path.join(config.execution_root,'state.json')));
 assert.equal(checkpoint.completed_units.length,2);
 runtime=await openJournalExecutionRuntime({...f,config,sourceParser:()=>assert.fail('completed parse must be reused'),inferencePort:createMockJournalInferencePort({handlers})});
 try{
  const result=await runtime.execute('run');
  assert.equal(result.completed_units,3);
  assert.equal(result.completion.graph_built,'pass');
  assert.deepEqual(extracted.map(batch=>batch.length),[2,1]);
 }finally{await runtime.close();}
});

test('partial split resumes the original batch identity without repeating completed children', async t => {
 const f=await fixture(t);
 const texts=['Synthetic one.','Synthetic two.','Synthetic three.','Synthetic four.'];
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-split'},
  pages:texts.map((_,i)=>({page_number:i+1,representation_id:'synthetic:page:'+i,disposition:'readable',warnings:[],image_inventory:[]})),
  representations:texts.map((text,i)=>({representation_id:'synthetic:page:'+i,text,utf8_byte_length:Buffer.byteLength(text)}))
 });
 const config={...f.config,semantic_batching:{calibration_maximum_units:4}};
 const extracted=[];let references=0,failed=false;
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:()=>{
   references++;
   if(references===3 && !failed){failed=true;throw new JournalInferencePortError('UNAVAILABLE',{submissionStatus:'not_submitted'});}
   return {schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]};
  },
  extractor:p=>{
   const size=p.core_units.length;extracted.push(size);
   return {schema_version:'1.0',status:'complete',assertions:[],
    entities:size===4?[{local_id:'cross',label:'Synthetic object',entity_kind:'object',
      anchors:[{unit_id:p.core_units[0].unit_id,quote:'Synthetic one.',occurrence:null},
        {unit_id:p.core_units[3].unit_id,quote:'Synthetic four.',occurrence:null}]}]:[],episodes:[],
    coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic split coverage.'})),requested_context:[]};
  },
  omission_checker:p=>review('omission_checker',p),
  fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 let runtime=await openJournalExecutionRuntime({...f,config,sourceParser:parser,inferencePort:createMockJournalInferencePort({handlers})});
 try{await assert.rejects(()=>runtime.execute('run'),{code:'UNAVAILABLE'});}finally{await runtime.close();}
 const checkpoint=JSON.parse(await fs.readFile(path.join(config.execution_root,'state.json')));
 assert.equal(checkpoint.completed_units.length,2);
 assert.ok(checkpoint.semantic_batch_plan_ref);
 runtime=await openJournalExecutionRuntime({...f,
  config:{...config,semantic_batching:{calibration_maximum_units:1}},
  sourceParser:()=>assert.fail('parse must be reused'),inferencePort:createMockJournalInferencePort({handlers})});
 try{
  const result=await runtime.execute('run');
  assert.equal(result.completed_units,4);
  assert.equal(result.completion.graph_built,'pass');
  assert.deepEqual(extracted,[4,4,4,2,2]);
 }finally{await runtime.close();}
});

test('reconciliation keeps its frozen groups after a pre-submission revocation', async t => {
 const f=await fixture(t);
 const texts=['Synthetic first.','Synthetic second.','Synthetic third.'];
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-reconcile'},
  pages:texts.map((_,i)=>({page_number:i+1,representation_id:'synthetic:page:'+i,disposition:'readable',warnings:[],image_inventory:[]})),
  representations:texts.map((text,i)=>({representation_id:'synthetic:page:'+i,text,utf8_byte_length:Buffer.byteLength(text)}))
 });
 const config={...f.config,semantic_batching:{reconciliation_maximum_units:2}};
 const reconciled=[];let deny=true;
 const service={verifyCaseAccess:async()=>{
  let checkpoint;
  try{checkpoint=JSON.parse(await fs.readFile(path.join(config.execution_root,'state.json')));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(deny && checkpoint?.reconciliation_completed?.length===2)
   throw Object.assign(new Error('Synthetic grant revoked'),{code:'GRANT_REVOKED'});
 }};
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:()=>({schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]}),
  extractor:p=>({schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],
    coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],reason:'Synthetic coverage.'})),requested_context:[]}),
  omission_checker:p=>review('omission_checker',p),
  fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>{
   reconciled.push(p.assigned_core_ids.length);
   return {schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'};
  }
 };
 let runtime=await openJournalExecutionRuntime({...f,config,service,sourceParser:parser,inferencePort:createMockJournalInferencePort({handlers})});
 try{await assert.rejects(()=>runtime.execute('run'),{code:'GRANT_REVOKED'});}finally{await runtime.close();}
 const checkpoint=JSON.parse(await fs.readFile(path.join(config.execution_root,'state.json')));
 assert.equal(checkpoint.reconciliation_completed.length,2);
 deny=false;
 assert.ok(checkpoint.reconciliation_batch_plan_ref);
 runtime=await openJournalExecutionRuntime({...f,
  config:{...config,semantic_batching:{reconciliation_maximum_units:1}},
  sourceParser:()=>assert.fail('parse must be reused'),inferencePort:createMockJournalInferencePort({handlers})});
 try{
  const result=await runtime.execute('run');
  assert.equal(result.completion.graph_built,'pass');
  assert.deepEqual(reconciled,[2,1]);
 }finally{await runtime.close();}
});


test('visual-only handoff persists an admitted visual page and resumes semantic batches without rereading it', async t => {
 const f=await fixture(t);
 const config={...f.config,visual_hazard_pages:[1]};
 const text='Synthetic source page.';
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-visual'},
  pages:[{page_number:1,representation_id:'synthetic:page:1',disposition:'readable',
    warnings:[],image_inventory:[],geometry:{width:100,height:100}}],
  representations:[{representation_id:'synthetic:page:1',text,utf8_byte_length:Buffer.byteLength(text)}]
 });
 const image=Buffer.alloc((4 * 1024 * 1024) + 257, 73);
 const calls=[];
 let referenceAttempts=0;
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,
  assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  visual_reader:p=>({schema_version:'1.0',source_page_id:p.assigned_core_ids[0],regions:[{
   region_id:'region:synthetic',bbox:[0,0,1,1],kind:'text',transcription:'Synthetic image text.',
   non_graphic_description:null,interpretation_status:'readable',speaker_or_document_label:null,
   table_cells:[]}],page_complete:true,missing_or_uncertain_regions:[]}),
  reference_reader:()=>{
   referenceAttempts+=1;
   if(referenceAttempts===1) throw Object.assign(new Error('synthetic invalid structured output'),
    {code:'INVALID_STRUCTURED_OUTPUT',submissionStatus:'completed_invalid'});
   return {schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]};
  },
  extractor:p=>({schema_version:'1.0',status:'complete',assertions:[],entities:[],episodes:[],
   coverage:p.core_units.map(u=>({unit_id:u.unit_id,disposition:'no_assertion',assertion_local_ids:[],
    reason:'Synthetic visual handoff fixture.'})),requested_context:[]}),
  omission_checker:p=>review('omission_checker',p),
  fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,
   proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 const port=()=>createMockJournalInferencePort({handlers:Object.fromEntries(
  Object.entries(handlers).map(([role,fn])=>[role,p=>{calls.push(role);return fn(p)}]))});
 let runtime=await openJournalExecutionRuntime({...f,config,sourceParser:parser,renderVisualPage:async()=>image,inferencePort:port()});
 try {
  const result=await runtime.execute('visual-only');
  assert.equal(result.stage,'REFERENCE_AUDIT');
  assert.equal(result.calibration,'not_run');
  assert.equal(result.completed_visual_pages,1);
  assert.equal(result.completed_units,0);
  assert.deepEqual(calls,['visual_reader']);
 } finally { await runtime.close(); }
 const checkpoint=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
 assert.deepEqual(checkpoint.visual_handoff_ready.visual_plan_ref,checkpoint.visual_plan_ref);
 assert.equal(checkpoint.visual_handoff_ready.status,'ready');
 assert.equal(checkpoint.semantic_batch_plan_ref,undefined);
 assert.equal(checkpoint.blocker,null);
 const key=await fs.readFile(path.join(f.config.execution_root,'staging.key'));
 const store=createPrivateJournalCorpusStore({rootDir:f.config.execution_root,
  caseId:checkpoint.case_id,corpusId:checkpoint.corpus_id,corpusKey:key});
 try {
  assert.equal((await store.readJsonObject({objectId:'visual:result:1'})).output.page_complete,true);
  assert.ok(await store.readJsonObject({objectId:'visual:image-ref:1'}));
  const H=x=>createHash('sha256').update(x).digest('hex');
  const legacyPacket={page_image_ref:{kind:'inline_image',media_type:'image/png',
    data_base64:image.toString('base64'),sha256:H(image)},
    page_geometry:{width:100,height:100},native_text_rendering:text,neighbor_pages:[]};
  const legacyId='job:'+H(JSON.stringify({id:'visual:1',role:'visual_reader',
    stage:'VISUAL_READ',packetInput:legacyPacket,dependencies:[],
    instruction:journalRoleInstruction('visual_reader'),dependency_instructions:[]}));
  const legacyLedger=createCorpusJournalJobLedger({corpusStore:store,jobId:legacyId});
  const entry=await legacyLedger.load();
  assert.equal(entry?.snapshot?.work_items[0]?.status,'completed',
   'new visual runner must reuse the exact pre-batch job identity');
  assert.equal(entry.snapshot.work_items[0].packet_input.page_image_ref.kind,'chunked_image');
  assert.equal(Object.hasOwn(entry.snapshot.work_items[0].packet_input.page_image_ref,'data_base64'),false);
  assert.ok(JSON.stringify(entry.snapshot).length < 4 * 1024 * 1024);
  const plan=JSON.parse((await store.reassembleOriginal(checkpoint.visual_plan_ref)).toString());
  assert.equal(plan.units.filter(u=>u.visual).length,1);
 } finally { store.close();key.fill(0); }
 runtime=await openJournalExecutionRuntime({...f,config,sourceParser:()=>assert.fail('must not reparse'),
  renderVisualPage:()=>assert.fail('must not rerender'),inferencePort:port()});
 try {
  assert.equal((await runtime.execute('visual-only')).stage,'REFERENCE_AUDIT');
  assert.deepEqual(calls,['visual_reader']);
  const firstSemantic=await runtime.execute('run');
  assert.equal(firstSemantic.blocker,'INVALID_STRUCTURED_OUTPUT');
  const failed=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
  assert.equal(failed.stage,'REFERENCE_AUDIT');
  const result=await runtime.execute('run');
  assert.equal(result.completion.graph_built,'pass');
  assert.equal(result.completed_visual_pages,1);
  assert.equal(calls.filter(role=>role==='reference_reader').length,3,
   'one invalid calibration, one bounded retry, and one distinct later source-first audit');
  assert.ok(calls.includes('extractor'));
  assert.ok(calls.includes('omission_checker'));
  assert.ok(calls.includes('reconciler'));
  assert.equal(calls.filter(role=>role==='visual_reader').length,1);
  const corpusRoot=path.join(f.config.execution_root,'.journal-corpora');
  const objectFiles=(await fs.readdir(corpusRoot,{recursive:true})).filter(name=>name.endsWith('.journal-object.json'));
  const objectHeaders=await Promise.all(objectFiles.map(async name=>(await fs.readFile(path.join(corpusRoot,name),'utf8')).slice(0,512)));
  assert.ok(objectHeaders.some(header=>header.includes('"object_id":"reference:result:job:')),
   'source-first reference output must survive a runtime restart without resubmission');
  assert.equal(objectHeaders.filter(header=>header.includes('"object_id":"reference:failure:job:')).length,1,
   'the completed-invalid first attempt must be durable and must not create a third calibration attempt');
  const consumed=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
  assert.equal(consumed.visual_handoff_ready.status,'consumed');
  assert.deepEqual(consumed.visual_handoff_ready.semantic_batch_plan_ref,consumed.semantic_batch_plan_ref);
  await assert.rejects(()=>runtime.execute('visual-only'),{code:'JOURNAL_VISUAL_HANDOFF_ALREADY_PASSED'});
 } finally { await runtime.close(); }
});

test('the staging key and the source are checked and read through one no-follow handle',async t=>{
 const f=await fixture(t);
 let runtime=await openJournalExecutionRuntime(f);await runtime.close();
 const keyFile=path.join(f.config.execution_root,'staging.key');
 const sourceFile=path.join(f.root,'private','source.txt');
 await fs.chmod(keyFile,0o644);
 await assert.rejects(()=>openJournalExecutionRuntime(f),{code:'JOURNAL_STAGING_KEY_INVALID'});
 await fs.chmod(keyFile,0o600);
 const movedKey=path.join(f.root,'moved.key');
 await fs.rename(keyFile,movedKey);await fs.symlink(movedKey,keyFile);
 await assert.rejects(()=>openJournalExecutionRuntime(f),{code:'JOURNAL_STAGING_KEY_INVALID'});
 await fs.rm(keyFile);await fs.rename(movedKey,keyFile);
 await fs.chmod(sourceFile,0o644);
 await assert.rejects(()=>openJournalExecutionRuntime(f),{code:'JOURNAL_SOURCE_PRIVATE_REQUIRED'});
 await fs.chmod(sourceFile,0o600);
 const movedSource=path.join(f.root,'moved-source.txt');
 await fs.rename(sourceFile,movedSource);await fs.symlink(movedSource,sourceFile);
 await assert.rejects(()=>openJournalExecutionRuntime(f),{code:'JOURNAL_SOURCE_PRIVATE_REQUIRED'});
 await fs.rm(sourceFile);await fs.rename(movedSource,sourceFile);
 runtime=await openJournalExecutionRuntime(f);await runtime.close();
});

test('a run opens only the vault its config names, and never a source inside the checkout',async t=>{
 const f=await fixture(t);
 const other=await fs.mkdtemp(path.join(os.tmpdir(),'journal-other-vault-synthetic-'));
 t.after(()=>fs.rm(other,{recursive:true,force:true}));
 const operatorEnvironment=root=>({
  INNER_SIGNAL_PRIVATE_ROOT:root,
  INNER_SIGNAL_OAUTH_ISSUER:'https://identity.synthetic.example',
  INNER_SIGNAL_OAUTH_AUDIENCE:'https://private-mcp.synthetic.example',
  INNER_SIGNAL_OPERATOR_OAUTH_JWKS_JSON:JSON.stringify({keys:[]}),
  INNER_SIGNAL_OPERATOR_CASE_ACL_JSON:JSON.stringify([{subject:'operator-subject',case_ids:['synthetic-case'],scopes:['case:write'],purposes:['archive','organize_search','session_use']}]),
  INNER_SIGNAL_CASE_KEYS_JSON:JSON.stringify({'synthetic-case':{routine_kek_base64:Buffer.alloc(32,81).toString('base64'),recovery_secret_base64:Buffer.alloc(32,82).toString('base64')}}),
  INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN:'synthetic-token'
 });
 const {service,...direct}=f;
 // Started without doctor, against an operator environment naming a different vault: refused
 // before authorization, and nothing is staged.
 await assert.rejects(()=>openJournalExecutionRuntime({...direct,environment:operatorEnvironment(other)}),{code:'JOURNAL_PRIVATE_ROOT_MISMATCH'});
 assert.equal((await fs.readdir(f.config.execution_root)).includes('staging.key'),false);
 // The vault the config names (or its vaults directory) passes the binding and goes on to authorization.
 for(const root of [f.config.private_runtime_root,path.join(f.config.private_runtime_root,'vaults')]){
  await fs.mkdir(root,{recursive:true});
  await assert.rejects(()=>openJournalExecutionRuntime({...direct,environment:operatorEnvironment(root)}),error=>error.code!=='JOURNAL_PRIVATE_ROOT_MISMATCH');
 }
 // An empty source has nothing to import, so no run of it is opened.
 await assert.rejects(()=>openJournalExecutionRuntime({...f,config:{...f.config,source:{...f.config.source,bytes:0}}}),{code:'JOURNAL_SOURCE_EMPTY'});
 // A source path that climbs into the public checkout is refused before it is opened.
 const checkout=path.resolve(new URL('..',import.meta.url).pathname);
 const inside=path.relative(f.root,path.join(checkout,'package.json'));
 await assert.rejects(()=>openJournalExecutionRuntime({...f,config:{...f.config,source:{...f.config.source,relative_path:inside}}}),{code:'JOURNAL_SOURCE_LOCATION_INVALID'});
});

test('visual pages render in memory from the verified archive, and legacy page files are removed', async t => {
 const f=await fixture(t);
 const config={...f.config,visual_hazard_pages:[1]};
 const text='Synthetic source page.';
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-visual'},
  pages:[{page_number:1,representation_id:'synthetic:page:1',disposition:'readable',
    warnings:[],image_inventory:[],geometry:{width:100,height:100}}],
  representations:[{representation_id:'synthetic:page:1',text,utf8_byte_length:Buffer.byteLength(text)}]
 });
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
 // A page image an earlier version left in plaintext.
 const visualDirectory=path.join(f.config.execution_root,'visual');
 await fs.mkdir(visualDirectory,{recursive:true,mode:0o700});
 await fs.writeFile(path.join(visualDirectory,'page-1.png'),image,{mode:0o600});
 const renders=[];
 const port=createMockJournalInferencePort({handlers:{visual_reader:p=>({schema_version:'1.0',
  source_page_id:p.assigned_core_ids[0],regions:[{region_id:'region:synthetic',bbox:[0,0,1,1],kind:'text',
   transcription:'Synthetic image text.',non_graphic_description:null,interpretation_status:'readable',
   speaker_or_document_label:null,table_cells:[]}],page_complete:true,missing_or_uncertain_regions:[]})}});
 const runtime=await openJournalExecutionRuntime({...f,config,sourceParser:parser,inferencePort:port,
  renderVisualPage:async(bytes,page)=>{
   renders.push({page,isBuffer:Buffer.isBuffer(bytes),sha256:Buffer.isBuffer(bytes)?createHash('sha256').update(bytes).digest('hex'):null});
   return image;
  }});
 try {
  await assert.rejects(fs.access(path.join(visualDirectory,'page-1.png')));
  await runtime.execute('stage');
  // The source is replaced after intake; the page must still come from the archived original.
  const sourcePath=path.join(f.root,'private','source.txt');
  await fs.writeFile(sourcePath,'Replaced synthetic source, different bytes.\n',{mode:0o600});
  const result=await runtime.execute('visual-only');
  assert.equal(result.completed_visual_pages,1);
 } finally { await runtime.close(); }
 assert.deepEqual(renders,[{page:1,isBuffer:true,sha256:f.config.source.sha256}]);
 const left=await fs.readdir(visualDirectory).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));
 assert.deepEqual(left,[]);
});

test('an unfinished visual page reuses its persisted image after a renderer change', async t => {
 const f=await fixture(t);
 const config={...f.config,visual_hazard_pages:[1]};
 const text='Synthetic source page.';
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic-visual'},
  pages:[{page_number:1,representation_id:'synthetic:page:1',disposition:'readable',
   warnings:[],image_inventory:[],geometry:{width:100,height:100}}],
  representations:[{representation_id:'synthetic:page:1',text,utf8_byte_length:Buffer.byteLength(text)}]
 });
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
 let interrupt=false;
 const service={verifyCaseAccess:async()=>{
  if(interrupt) throw Object.assign(new Error('Synthetic interruption after image persistence.'),{code:'GRANT_REVOKED'});
  return {};
 }};
 let runtime=await openJournalExecutionRuntime({...f,config,service,sourceParser:parser,
  renderVisualPage:async()=>{interrupt=true;return image;}});
 try { await assert.rejects(()=>runtime.execute('visual-only'),{code:'GRANT_REVOKED'}); }
 finally { await runtime.close(); }
 const checkpoint=JSON.parse(await fs.readFile(path.join(config.execution_root,'state.json')));
 assert.deepEqual(checkpoint.completed_visual_pages,[]);
 const key=await fs.readFile(path.join(config.execution_root,'staging.key'));
 const store=createPrivateJournalCorpusStore({rootDir:config.execution_root,
  caseId:checkpoint.case_id,corpusId:checkpoint.corpus_id,corpusKey:key});
 try { assert.ok(await store.readJsonObject({objectId:'visual:image-ref:1'})); }
 finally { store.close();key.fill(0); }
 interrupt=false;
 let renders=0,receivedImage=null;
 const port=createMockJournalInferencePort({handlers:{visual_reader:p=>{
  receivedImage=Buffer.from(p.page_image_ref.data_base64,'base64');
  return {schema_version:'1.0',source_page_id:'page:1',regions:[],page_complete:true,
   missing_or_uncertain_regions:[]};
 }}});
 runtime=await openJournalExecutionRuntime({...f,config,service,sourceParser:()=>assert.fail('must not reparse'),
  renderVisualPage:async()=>{renders+=1;return Buffer.from('different renderer output');},inferencePort:port});
 try { assert.equal((await runtime.execute('visual-only')).completed_visual_pages,1); }
 finally { await runtime.close(); }
 assert.equal(renders,0);
 assert.deepEqual(receivedImage,image);
});

test('the page renderer reads the source on stdin and returns the image on stdout',
 {skip:spawnSync('pdftoppm',['-v']).error?'pdftoppm is not installed':false},async()=>{
 const pdf=await fs.readFile(new URL('../guides/vagal-blitz-source.pdf',import.meta.url));
 const image=await renderJournalPdfPage(pdf,1);
 assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 await assert.rejects(renderJournalPdfPage(Buffer.from('not a pdf'),1),{code:'VISUAL_RENDER_FAILED'});
});

test('a source replaced after startup is never archived, and restoring it lets intake continue', async t => {
 const f=await fixture(t);
 const sourcePath=path.join(f.root,'private','source.txt');
 const original=await fs.readFile(sourcePath);
 let runtime=await openJournalExecutionRuntime(f);
 try {
  await fs.writeFile(sourcePath,'Replaced synthetic source, different bytes.\n',{mode:0o600});
  await assert.rejects(runtime.execute('stage'),{code:'SOURCE_BINDING_MISMATCH'});
  await fs.rm(sourcePath);
  await fs.symlink(path.join(f.root,'private','config.json'),sourcePath);
  await assert.rejects(runtime.execute('stage'),{code:'JOURNAL_SOURCE_PRIVATE_REQUIRED'});
 } finally { await runtime.close(); }
 await fs.rm(sourcePath);
 await fs.writeFile(sourcePath,original,{mode:0o600});
 runtime=await openJournalExecutionRuntime(f);
 try { assert.equal((await runtime.execute('stage')).completion.archive_verified,'pass'); }
 finally { await runtime.close(); }
});

test('once the original is archived, the upload may go: status and a resumed parse read the archive', async t => {
 const f=await fixture(t);
 const sourcePath=path.join(f.root,'private','source.txt');
 const text=await fs.readFile(sourcePath,'utf8');
 const parsed={source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},
  parser:{version:'synthetic'},pages:[],representations:[{representation_id:'synthetic:text',text,utf8_byte_length:Buffer.byteLength(text)}]};
 // The first run archives the original and stops before its parse completes.
 let runtime=await openJournalExecutionRuntime({...f,sourceParser:async()=>{throw Object.assign(new Error('synthetic stop'),{code:'SYNTHETIC_STOP'});}});
 try { await assert.rejects(runtime.execute('stage'),{code:'SYNTHETIC_STOP'}); }
 finally { await runtime.close(); }
 await fs.rm(sourcePath);
 const inputs=[];
 runtime=await openJournalExecutionRuntime({...f,sourceParser:async input=>{
  inputs.push({inputPath:input.inputPath??null,sha256:createHash('sha256').update(input.inputBytes).digest('hex')});
  return parsed;
 }});
 try {
  assert.equal((await runtime.execute('status')).stage,'INTAKE');
  assert.equal((await runtime.execute('stage')).completion.archive_verified,'pass');
 } finally { await runtime.close(); }
 assert.deepEqual(inputs,[{inputPath:null,sha256:f.config.source.sha256}]);
});

test('a scanned source with no native text reaches its visual pages instead of failing calibration', async t => {
 const f=await fixture(t);
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'application/pdf'},
  parser:{version:'synthetic-scan'},
  pages:[{page_number:1,representation_id:'synthetic:scan:1',disposition:'visual_pending',
    warnings:['no_native_text'],image_inventory:[{kind:'scan'}],geometry:{width:100,height:100}}],
  representations:[{representation_id:'synthetic:scan:1',text:'',utf8_byte_length:0}]
 });
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
 const port=createMockJournalInferencePort({handlers:{visual_reader:p=>({schema_version:'1.0',
  source_page_id:p.assigned_core_ids[0],regions:[{region_id:'region:scan',bbox:[0,0,1,1],kind:'text',
   transcription:'Handwritten synthetic line.',non_graphic_description:null,interpretation_status:'readable',
   speaker_or_document_label:null,table_cells:[]}],page_complete:true,missing_or_uncertain_regions:[]})}});
 const runtime=await openJournalExecutionRuntime({...f,sourceParser:parser,renderVisualPage:async()=>image,inferencePort:port});
 try {
  const staged=await runtime.execute('stage');
  assert.equal(staged.completion.archive_verified,'pass');
  // With no native units there is nothing to probe, and verify still checks the raw index.
  const verified=await runtime.execute('verify');
  assert.equal(verified.completion.archive_verified,'pass');
  const result=await runtime.execute('visual-only');
  assert.equal(result.stage,'REFERENCE_AUDIT');
  assert.equal(result.completed_visual_pages,1);
 } finally { await runtime.close(); }
 const checkpoint=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
 const key=await fs.readFile(path.join(f.config.execution_root,'staging.key'));
 const store=createPrivateJournalCorpusStore({rootDir:f.config.execution_root,caseId:checkpoint.case_id,corpusId:checkpoint.corpus_id,corpusKey:key});
 try {
  const plan=JSON.parse((await store.reassembleOriginal(checkpoint.visual_plan_ref)).toString());
  assert.ok(plan.units.length>0&&plan.units.every(u=>u.visual));
  assert.ok(plan.calibration.length>0&&plan.calibration.every(w=>w.reason==='visual_hazard'));
 } finally { store.close();key.fill(0); }
});

test('a page whose reading order needs review is indexed as partly readable', async t => {
 const f=await fixture(t);
 const text='Synthetic page with a table.\n';
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'application/pdf'},
  parser:{version:'synthetic-review'},
  pages:[{page_number:1,representation_id:'synthetic:review:1',disposition:'review_required',
    warnings:['structured_table_present'],image_inventory:[],geometry:{width:100,height:100}}],
  representations:[{representation_id:'synthetic:review:1',text,utf8_byte_length:Buffer.byteLength(text)}]
 });
 const runtime=await openJournalExecutionRuntime({...f,sourceParser:parser});
 try { assert.equal((await runtime.execute('stage')).completion.raw_search_available,'pass'); }
 finally { await runtime.close(); }
});

test('an extractor that asks for smaller windows gets its batch split instead of stopping the run', async t => {
 const f=await fixture(t);
 const texts=['Synthetic one.','Synthetic two.','Synthetic three.','Synthetic four.'];
 const config={...f.config,semantic_batching:{calibration_maximum_units:4}};
 const parser=async()=>({source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'text/plain'},parser:{version:'synthetic-split'},
  pages:texts.map((_,i)=>({page_number:i+1,representation_id:'synthetic:page:'+i,disposition:'readable',warnings:[],image_inventory:[]})),
  representations:texts.map((text,i)=>({representation_id:'synthetic:page:'+i,text,utf8_byte_length:Buffer.byteLength(text)}))});
 const sizes=[];
 const review=(role,p)=>({schema_version:'1.0',target_generation:p.expected_generation,review_role:role,assessments:[],proposed_repairs:[],unassessed_ids:[],status:'sufficient_for_stated_scope'});
 const handlers={
  reference_reader:()=>({schema_version:'1.0',source_only_first_pass:true,reference_items:[],questions:[],unassessed_unit_ids:[]}),
  // More than two units is "too long": the extractor reports incomplete, as its instructions ask.
  extractor:p=>{sizes.push(p.core_units.length);const tooLong=p.core_units.length>2;
   return {schema_version:'1.0',status:tooLong?'incomplete':'complete',assertions:[],entities:[],episodes:[],
    coverage:p.core_units.map((u,i)=>({unit_id:u.unit_id,disposition:tooLong&&i>1?'pending':'no_assertion',assertion_local_ids:[],reason:'Synthetic split fixture.'})),requested_context:[]};},
  omission_checker:p=>review('omission_checker',p),fidelity_auditor:p=>review('fidelity_auditor',p),
  reconciler:p=>({schema_version:'1.0',target_generation:p.expected_generation,proposals:[],unresolved_ids:[],status:'proposals_complete'})
 };
 const runtime=await openJournalExecutionRuntime({...f,config,sourceParser:parser,inferencePort:createMockJournalInferencePort({handlers})});
 try {
  const summary=await runtime.execute('run');
  assert.equal(summary.completed_units,4);
  assert.equal(summary.blocker,null);
  assert.equal(summary.completion.graph_built,'pass');
 } finally { await runtime.close(); }
 assert.deepEqual(sizes,[4,2,2]);
});

test('an incomplete visual inventory is retried while a complete inventory may retain unreadable regions',async t=>{
 const f=await fixture(t);
 const pages=[1,2,3];
 const parser=async()=>({
  source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'application/pdf'},
  parser:{version:'synthetic-scan'},
  pages:pages.map(n=>({page_number:n,representation_id:'synthetic:scan:'+n,disposition:'visual_pending',
   warnings:['no_native_text'],image_inventory:[{kind:'scan'}],geometry:{width:100,height:100}})),
  representations:pages.map(n=>({representation_id:'synthetic:scan:'+n,text:'',utf8_byte_length:0}))
 });
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
 const reads=[];
 // Page 1 reads fully. Page 2 omits a disposition twice, then completely inventories its unreadable
 // region. Page 3's reading always names the wrong page. Page 1's first reading also names the
 // wrong page, and its second is used.
 const port=createMockJournalInferencePort({handlers:{visual_reader:p=>{
  const page=p.assigned_core_ids[0];reads.push(page);
  const wrong=page==='page:3'||(page==='page:1'&&reads.filter(r=>r==='page:1').length===1);
  const pageTwoComplete=page!=='page:2'||reads.filter(r=>r==='page:2').length===3;
  return {schema_version:'1.0',source_page_id:wrong?'page:99':page,
   regions:[{region_id:'region:scan',bbox:[0,0,1,1],kind:page==='page:2'?'unreadable':'text',
    transcription:page==='page:2'?null:'Handwritten synthetic line.',non_graphic_description:null,
    interpretation_status:page==='page:2'?'unreadable':'readable',speaker_or_document_label:null,table_cells:[]}],
   page_complete:pageTwoComplete,missing_or_uncertain_regions:page==='page:2'?['region:scan']:[]};
 }}});
 const runtime=await openJournalExecutionRuntime({...f,sourceParser:parser,renderVisualPage:async()=>image,inferencePort:port});
 try {
  const result=await runtime.execute('visual-only');
  assert.deepEqual([result.stage,result.completed_visual_pages,result.blocker],['REFERENCE_AUDIT',3,null]);
  assert.deepEqual(result.residuals,{excluded_visual_pages:1,partial_visual_pages:1});
  assert.deepEqual(reads.filter(r=>r==='page:1').length,2);
  assert.deepEqual(reads.filter(r=>r==='page:2').length,3);
  assert.deepEqual(reads.filter(r=>r==='page:3').length,3);
 } finally { await runtime.close(); }
 const checkpoint=JSON.parse(await fs.readFile(path.join(f.config.execution_root,'state.json')));
 const key=await fs.readFile(path.join(f.config.execution_root,'staging.key'));
 const store=createPrivateJournalCorpusStore({rootDir:f.config.execution_root,caseId:checkpoint.case_id,corpusId:checkpoint.corpus_id,corpusKey:key});
 try {
  // The completely inventoried page keeps its explicitly unreadable region; the excluded page
  // has no visual representation in the plan.
  const plan=JSON.parse((await store.reassembleOriginal(checkpoint.visual_plan_ref)).toString());
  assert.deepEqual([...new Set(plan.units.filter(u=>u.visual).map(u=>u.page_number))].sort(),[1,2]);
 } finally { store.close();key.fill(0); }
});

test('a legacy completed visual page rebuilds its partial-page count on resume',async t=>{
 const f=await fixture(t);
 const parser=async()=>({source:{sha256:f.config.source.sha256,byte_length:f.config.source.bytes,mime_type:'application/pdf'},
  parser:{version:'synthetic-scan'},pages:[{page_number:1,representation_id:'scan:1',disposition:'visual_pending',
   warnings:['no_native_text'],image_inventory:[{kind:'scan'}],geometry:{width:100,height:100}}],
  representations:[{representation_id:'scan:1',text:'',utf8_byte_length:0}]});
 const port=createMockJournalInferencePort({handlers:{visual_reader:()=>({schema_version:'1.0',source_page_id:'page:1',
  regions:[{region_id:'uncertain',bbox:[0,0,1,1],kind:'unreadable',transcription:null,
   non_graphic_description:null,interpretation_status:'unreadable',speaker_or_document_label:null,table_cells:[]}],
  page_complete:true,missing_or_uncertain_regions:['uncertain']})}});
 let runtime=await openJournalExecutionRuntime({...f,sourceParser:parser,inferencePort:port,
  renderVisualPage:async()=>Buffer.from('synthetic-image')});
 try { await runtime.execute('visual-only'); } finally { await runtime.close(); }
 const statePath=path.join(f.config.execution_root,'state.json');
 const checkpoint=JSON.parse(await fs.readFile(statePath,'utf8'));
 delete checkpoint.partial_visual_pages;
 checkpoint.residuals.partial_visual_pages=0;
 await fs.writeFile(statePath,JSON.stringify(checkpoint),{mode:0o600});
 runtime=await openJournalExecutionRuntime({...f,sourceParser:()=>assert.fail('parse replayed'),
  inferencePort:createDisabledJournalInferencePort()});
 try {
  const resumed=await runtime.execute('visual-only');
  assert.equal(resumed.residuals.partial_visual_pages,1);
  assert.equal(resumed.stage,'REFERENCE_AUDIT');
 } finally { await runtime.close(); }
});
