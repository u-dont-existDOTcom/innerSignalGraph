#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hash, loadSourcePacket, sourceForCase } from './source-packet.mjs';
import { graderPrompt, gradeSchema, validateGrade, combineGrades } from './judging.mjs';
import { validateSettings, publicSettings, makeOpenRouterProvider } from './openrouter-adapter.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { buildContext } from '../../src/orchestrator/context-builder.mjs';
import { runTieredTherapyPipeline } from '../../src/orchestrator/run-tiered-pipeline.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const root=path.resolve(here,'../..');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,obj)=>{
  const temp=`${p}.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify(obj,null,2)+'\n',{mode:0o600});
  await fs.rename(temp,p);
};
export const ARMS=['normal_bot','guide_reference','source_augmented'];
const REF_SYSTEM=`You are InnerSignal, providing one useful next response to this person's actual request. Work from the author's guide and approved amendments below, preserving the distinctions and individual choice. Do not force the entire guide into one reply. Do not introduce unsupported psychological assignments, treat imagery as historical proof, affirm literal nonordinary entities, guarantee treatment benefit, or turn founder philosophy into an individualized deficiency verdict. Respect practical safety, corrections and refusal. Answer naturally; ask at most one useful question, and no question when the next move is closure. The user need not learn therapeutic vocabulary. The guide is an intervention framework, not empirical proof of every interpretation. Return only the user-facing response.\n\n`;

// Records each call before sending it. Interrupted/failed requests do not silently retry.
// Re-running an identical run reuses completed calls; source/config drift is rejected.
export async function makeCaller(dir,maxCalls) {
  const file=path.join(dir,'calls.json');
  let state={version:1,records:[]};
  try {state=await read(file);} catch(e){if(e.code!=='ENOENT')throw e;}
  let scope='preflight',ordinal=0;
  // Forensic pipeline stages can run concurrently; serialize checkpoint writes.
  let writes=Promise.resolve();
  const persist=()=>{writes=writes.then(()=>write(file,state));return writes;};
  return {
    state,
    scope(value){scope=value;ordinal=0;},
    async execute(meta,requestFn) {
      const key=`${scope}:${++ordinal}`, digest=hash(meta);
      const old=state.records.find(r=>r.key===key);
      if(old){
        if(old.digest!==digest)throw new Error('RESUME_INPUT_DRIFT');
        if(old.status==='complete')return old.result;
        throw new Error('PREVIOUS_CALL_INCOMPLETE_REQUIRES_EXPLICIT_REVIEW');
      }
      if(state.records.length>=maxCalls)throw new Error('CALL_BUDGET_EXHAUSTED');
      const row={key,digest,role:meta.role,model:meta.model,stage:meta.stage,request:meta.request,status:'started',startedAt:new Date().toISOString()};
      state.records.push(row);await persist();
      try {row.result=await requestFn();row.status='complete';row.completedAt=new Date().toISOString();await persist();return row.result;}
      catch(e){row.status='failed';row.failure=String(e.code ?? e.message).slice(0,180);await persist();throw e;}
    }
  };
}

async function pinRun(out,manifest) {
  const file=path.join(out,'manifest.json');
  try {const old=await read(file);if(hash(old)!==hash(manifest))throw new Error('RUN_MANIFEST_DRIFT; use a new output directory for a new source/configuration.');}
  catch(e){if(e.code!=='ENOENT')throw e;await write(file,manifest);}
}

async function evaluateUnlocked({out,settings=null,live=false,smoke=false,repeat=1,fetchImpl=fetch}) {
  out=path.resolve(out);await fs.mkdir(out,{recursive:true,mode:0o700});
  const frozenSuite=await read(path.join(here,'cases.json'));
  const sourceBindings=await read(path.join(here,'case-source-bindings-2026-09-07.json'));
  const suite=structuredClone(frozenSuite);
  const controls=await read(path.join(here,'grader-controls.json'));
  const packet=await loadSourcePacket(root);
  if (packet.files[sourceBindings.sourceFile] !== sourceBindings.sourceSha256) throw new Error('FIDELITY_SOURCE_BINDINGS_STALE');
  if (JSON.stringify(Object.keys(sourceBindings.additionalSourceRefs).sort()) !== JSON.stringify(suite.cases.map(c=>c.id).sort())) throw new Error('FIDELITY_SOURCE_BINDING_CASE_MISMATCH');
  for (const c of suite.cases) c.sourceRefs=[...new Set([...c.sourceRefs,...sourceBindings.additionalSourceRefs[c.id]])];
  for(const c of suite.cases)sourceForCase(packet,c);
  if(!Number.isInteger(repeat)||repeat<1||repeat>3)throw new Error('repeat must be 1..3');
  const cases=smoke?suite.cases.filter(c=>['GF01','GF02','GF07','GF09'].includes(c.id)):suite.cases;
  const failures=validateSettings(settings);
  const preflight={version:1,status:failures.length?'BLOCKED_CONFIGURATION':live?'READY_FOR_LIVE_PROBES':'PREPARED_NOT_RUN',
    reasons:failures,sourceSha256:packet.sha256,sourceCharacters:packet.characters,sourceTruncated:false,
    scenarios:cases.length,userTurns:cases.reduce((n,c)=>n+c.turns.length,0),arms:ARMS,repeat,
    liveCalls:0,responderOutputs:0,independentGrades:0,clinicalEvaluation:false,
    note:'No response-quality result exists until real calls and independent source-grounded grades complete. No fallback model is selected.'};
  await write(path.join(out,'preflight.json'),preflight);
  if(!live||failures.length)return preflight;
  const files=execFileSync('git',['ls-files','-z','src','guides','guide-graphs/candidates',path.relative(root,here)],{cwd:root}).toString().split('\0').filter(Boolean);
  // Include untracked new modules too: necessary while reviewing an uncommitted candidate.
  const walk=async d=>(await fs.readdir(d,{withFileTypes:true})).flatMap(e=>e.isDirectory()?[]:[path.join(d,e.name)]);
  for(const d of [here,path.join(root,'src/case-formulation')])for(const p of await walk(d))files.push(path.relative(root,p));
  const bindings={};for(const p of [...new Set(files)].sort())bindings[p]=hash(await fs.readFile(path.join(root,p)));
  const manifest={version:2,gradeContractVersion:2,scope:'SYNTHETIC_SOURCE_FIDELITY_NOT_CLINICAL_EFFICACY',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),
    bindings,sourceSha256:packet.sha256,sourceBindingsSha256:hash(sourceBindings),frozenSuiteSha256:hash(frozenSuite),suiteSha256:hash(suite),controlsSha256:hash(controls),settings:publicSettings(settings),caseIds:cases.map(c=>c.id),arms:ARMS,repeat,
    replay:'Each arm has an independent assistant history; prerecorded user turns are synthetic, not observed client outcomes.',
    contamination:'Development set disclosed during implementation; not held out.',
    requestedResponder:'Owner-selected GPT-5.6 Sol xhigh; settings must bind its exact verified provider ID. No UI label establishes API entitlement.',
    sourceLimit:'Pinned complete owner article with adopted E01-E12 plus the unchanged somatic guide and approved amendments. Source receipt: tasks/guide-source-sync-20260907/SOURCE-SYNC.json. Original media destinations absent from the pasted source are not reconstructed.'};
  await pinRun(out,manifest);
  const caller=await makeCaller(out,settings.max_calls);
  const make=(r,id)=>makeOpenRouterProvider(r,{id,execute:(...args)=>caller.execute(...args),fetchImpl});
  const responder=make(settings.responder,'responder');
  const graders=settings.graders.map((g,i)=>make(g,`grader${i+1}`));
  const results=[];
  try {
    const probes=[];
    for(const [i,provider] of [responder,...graders].entries()) {
      caller.scope(`identity-${i}`);
      const result=await provider.generate({system:'Return a brief acknowledgment. Do not report your own model identity.',user:'Acknowledge this connectivity check.',metadata:{stage:'identity_preflight'}});
      probes.push({model:result.model,provider:result.provider,requestId:result.requestId,reasoningRequested:result.reasoningRequested,reasoningExecutionVerified:false});
    }
    await write(path.join(out,'identity-probes.json'),{probes,note:'API-returned model identity checked. Reasoning effort sent with required-parameter routing; hidden execution effort cannot be independently measured.'});
    const calibration=[];
    for(const [gi,grader] of graders.entries())for(const control of controls.controls) {
      const c=suite.cases.find(c=>c.id===control.caseId),sources=sourceForCase(packet,c);
      caller.scope(`calibration-${gi}-${control.id}`);
      const raw=await grader.generate({...graderPrompt({scenario:c,sources,transcript:c.turns.map(content=>({role:'user',content})),answer:control.response}),outputSchema:gradeSchema,metadata:{stage:'grader_calibration'}});
      const grade=validateGrade(JSON.parse(raw.text),{answer:control.response,sources});
      const passed=control.expect==='accept'?grade.verdict==='pass':['revise','block'].includes(grade.verdict);
      calibration.push({control:control.id,grader:gi,grade,passed});
      await write(path.join(out,'calibration.json'),calibration);
    }
    if(calibration.some(r=>!r.passed))throw new Error('GRADER_CALIBRATION_FAILED_NO_BOT_SCORE');
    for(let rep=0;rep<repeat;rep++)for(const scenario of cases) {
      // Rotating presentation order prevents all of one arm always being run first.
      const order=ARMS.map((_,i)=>ARMS[(i+rep+cases.indexOf(scenario))%ARMS.length]);
      for(const arm of order) {
        let history=[],prior=null;
        const config=loadConfig({mode:'mock',ledgerMode:'off',guidePacketRoot:path.join(out,'no-active-installed-packet'),autopilotStateDir:path.join(out,'state'),guideExcerptMaxChars:18000,allowDegraded:false});
        for(let turn=0;turn<scenario.turns.length;turn++) {
          const message=scenario.turns[turn];
          const id=`${scenario.id}-${rep}-${arm}-${turn}`;
          caller.scope(`response-${id}`);
          const transcript=[...history,{role:'user',content:message}];
          let result,context;
          if(arm==='guide_reference') {
            result=await responder.generate({system:REF_SYSTEM+packet.full,user:JSON.stringify({conversation:transcript}),metadata:{stage:'guide_reference'}});
            result={answer:result.text,raw:result,caseFormulation:null,interventionContract:null};
          } else {
            context=await buildContext({userMessage:message,recentTranscript:history.map(m=>`${m.role.toUpperCase()}: ${m.content}`).join('\n\n'),userFacts:[],priorCaseSnapshot:prior?.caseFormulation,priorInterventionContract:prior?.interventionContract,priorProcessingTier:prior?.processingTier},config);
            const pipelineProvider=(id)=>({id,model:responder.model,generate:request=>responder.generate({...request,system:request.system+(arm==='source_augmented'&&['realization','realization_retry'].includes(request.metadata?.stage)?`\n\nAUTHOR GUIDE AND APPROVED AMENDMENTS (additional context; do not ignore binding practical safety):\n${packet.full}`:'')})});
            result=await runTieredTherapyPipeline({context,providers:{renderer:pipelineProvider('renderer'),openai:pipelineProvider('openai'),anthropic:pipelineProvider('anthropic')},config,processingMode:'auto'});
          }
          if(typeof result.answer!=='string'||!result.answer.trim())throw new Error('EMPTY_BOT_RESPONSE');
          const sources=sourceForCase(packet,scenario),reviews=[];
          const row={id,scenario:scenario.id,repeat:rep,arm,turn,user:message,answer:result.answer,reviews,decision:combineGrades(reviews),
            extraction:result.caseFormulation??null,plan:result.interventionContract??null,responseContract:result.responseContract??null,
            extractionSourceHash:context?hash(context.guideExcerpts):null,referenceSourceHash:arm==='normal_bot'?null:packet.sha256};
          results.push(row);await write(path.join(out,'results.json'),results);
          for(const [gi,grader] of graders.entries()) {
            caller.scope(`grade-${id}-${gi}`);
            // Neither arm label, plan, expected route nor responder identity enters this prompt.
            const raw=await grader.generate({...graderPrompt({scenario,sources,transcript,answer:result.answer}),outputSchema:gradeSchema,metadata:{stage:'blind_source_grade'}});
            reviews.push(validateGrade(JSON.parse(raw.text),{answer:result.answer,sources}));
            row.decision=combineGrades(reviews);await write(path.join(out,'results.json'),results);
          }
          history=[...transcript,{role:'assistant',content:result.answer}];prior=result;
        }
      }
    }
    const summary={version:1,status:'COMPLETED_SOURCE_FIDELITY_REVIEW',liveCalls:caller.state.records.length,responderOutputs:results.length,independentGrades:results.reduce((n,r)=>n+r.reviews.length,0),
      cases:cases.length,repeat,perArm:Object.fromEntries(ARMS.map(arm=>[arm,results.filter(r=>r.arm===arm).reduce((acc,r)=>({...acc,[r.decision.verdict]:(acc[r.decision.verdict]??0)+1}),{})])),
      clinicalEvaluation:false,releaseApproved:false,interpretation:'Compare scene-level source grades and traces. Better guide-reference output is a clue to information/routing loss, not an automatic gold standard or causal proof. Inspect extraction, selected task, supplied guidance, raw realization and enforced response before assigning a cause.'};
    await write(path.join(out,'summary.json'),summary);return summary;
  } catch(e) {
    const summary={status:'BLOCKED_OR_INCOMPLETE',reason:String(e.code??e.message).slice(0,220),liveCalls:caller.state.records.length,
      completedCalls:caller.state.records.filter(r=>r.status==='complete').length,responderOutputs:results.length,independentGrades:results.reduce((n,r)=>n+r.reviews.length,0),
      clinicalEvaluation:false,releaseApproved:false,passRate:null};
    await write(path.join(out,'summary.json'),summary);return summary;
  }
}

// One process owns a live run directory. A crash leaves a lock for explicit review,
// rather than allowing two replays to bill duplicate requests concurrently.
export async function runEvaluation(options) {
  if (!options.live || validateSettings(options.settings).length) return evaluateUnlocked(options);
  const out=path.resolve(options.out);await fs.mkdir(out,{recursive:true,mode:0o700});
  const lock=path.join(out,'RUNNING.lock');
  let handle;
  try {handle=await fs.open(lock,'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw new Error('RUN_DIRECTORY_LOCKED_REVIEW_BEFORE_RESUME');throw e;}
  try {await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));return await evaluateUnlocked(options);}
  finally {await handle.close();await fs.unlink(lock);}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);const value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
  const out=value('--out');
  if(!out)throw new Error('Required: --out /private/evaluation-directory. No live calls without --live and --settings.');
  const settings=value('--settings')?await read(path.resolve(value('--settings'))):null;
  const result=await runEvaluation({out,settings,live:args.includes('--live'),smoke:args.includes('--smoke'),repeat:Number(value('--repeat')??1)});
  console.log(JSON.stringify(result,null,2));
  if(result.status.startsWith('BLOCKED'))process.exitCode=2;
}
