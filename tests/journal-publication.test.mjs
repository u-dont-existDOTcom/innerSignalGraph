import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPrivateCaseAccessService,loadDevelopmentPrivateCaseProviders} from '../src/storage/private-case-access.mjs';
import {createPrivateJournalCorpusStore} from '../src/storage/private-journal-corpus.mjs';
import {persistGraphGeneration} from '../src/journal-import/graph.mjs';
import {publishJournalGenerationFromStaging} from '../src/journal-import/publication.mjs';
import {createPrivateCaseOrchestrator} from '../src/supervisor/private-case-orchestration.mjs';
import {createJournalPrivateApi} from '../src/journal-import/http.mjs';
import {transferJournalGeneration} from '../src/journal-import/generation-transfer.mjs';
import {createJournalContinuityProjection} from '../src/case-state/journal-continuity.mjs';

const CASE_ID='synthetic-case',CORPUS_ID='corpus:synthetic';
// The operator's documented grant: case:write only, for the import's three purposes.
const WRITER='synthetic-operator-token',ARCHIVE_ONLY='synthetic-archive-only-token',READER='synthetic-reader-token',CORRECTOR='synthetic-rollback-token';
const sha256=value=>createHash('sha256').update(value).digest('hex');

async function environment(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-publication-synthetic-'));await fs.chmod(root,0o700);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const credentialsPath=path.join(root,'credentials.json');
 await fs.writeFile(credentialsPath,`${JSON.stringify({schema_version:1,root_dir:path.join(root,'vaults'),grants:[
  {token_sha256:sha256(WRITER),principal_id:'journal-operator',case_ids:[CASE_ID],scopes:['case:write'],purposes:['archive','organize_search','session_use']},
  {token_sha256:sha256(ARCHIVE_ONLY),principal_id:'archive-only',case_ids:[CASE_ID],scopes:['case:write'],purposes:['archive']},
  {token_sha256:sha256(READER),principal_id:'test-reader',case_ids:[CASE_ID],scopes:['case:read'],purposes:['organize_search']},
  {token_sha256:sha256(CORRECTOR),principal_id:'journal-operator-rollback',case_ids:[CASE_ID],scopes:['case:write'],purposes:['correct']}
 ],case_keys:{[CASE_ID]:{routine_kek_base64:Buffer.alloc(32,7).toString('base64'),recovery_secret_base64:Buffer.alloc(32,9).toString('base64')}}})}\n`,{mode:0o600});
 const providers=await loadDevelopmentPrivateCaseProviders(credentialsPath);t.after(()=>providers.close());
 const service=createPrivateCaseAccessService({rootDir:providers.rootDir,authorizationProvider:providers.authorizationProvider,
  keyProvider:providers.keyProvider,allowDevelopmentFileProvider:true});
 const sourceStore=createPrivateJournalCorpusStore({rootDir:path.join(root,'staging'),caseId:CASE_ID,corpusId:CORPUS_ID,corpusKey:Buffer.alloc(32,11)});
 t.after(()=>sourceStore.close());
 const graph=JSON.parse(await fs.readFile(new URL('../schemas/journal-import/fixtures/synthetic-graph.json',import.meta.url),'utf8'));
 const representations=JSON.parse(await fs.readFile(new URL('../schemas/journal-import/fixtures/synthetic-sources.json',import.meta.url),'utf8'));
 graph.case_id=CASE_ID;graph.corpus_id=CORPUS_ID;
 for(const record of [...graph.nodes,...graph.edges]){record.case_id=CASE_ID;record.corpus_id=CORPUS_ID;}
 const original=await sourceStore.writeChunkedOriginal({objectId:'original:synthetic',bytes:Buffer.from(JSON.stringify(representations))});
 for(const node of graph.nodes){if(node.kind==='source')node.data.original_object_id=original.object_id;if(node.kind==='passage')node.data.locator.original_object_id=original.object_id;}
 const persisted=await persistGraphGeneration({corpusStore:sourceStore,graph,sourceRepresentations:representations,permittedUses:['archive','organize_search','session_use'],archiveReferences:[original]});
 await service.appendJournal(CASE_ID,{id:'legacy-synthetic',observed_at:'2026-01-01T00:00:00.000Z',kind:'journal',text:'Invented legacy entry'},{bearerToken:WRITER});
 return {service,sourceStore,graph,persisted,representations};
}

test('a case:write-only operator publishes a generation and keeps the rest of the case unchanged across a retry',async t=>{
 const {service:real,sourceStore,graph,persisted}=await environment(t);
 const auth={bearerToken:WRITER},reader={bearerToken:READER};
 // The operator's grant has no case:read, so the ordinary read paths are closed to it.
 await assert.rejects(real.loadPrivateRuntimeCase(CASE_ID,auth),{code:'PRIVATE_CASE_ACCESS_DENIED'});
 const before=await real.loadPrivateRuntimeCase(CASE_ID,reader);
 let conflict=true,authorizationChecks=0;
 const service={...real,async publishJournalGeneration(id,args,context){
  if(conflict){conflict=false;throw Object.assign(new Error('Synthetic concurrent revision'),{code:'REVISION_CONFLICT'});}
  return real.publishJournalGeneration(id,args,context);
 }};
 const authorize=async()=>{
  authorizationChecks++;
  for(const purpose of ['archive','organize_search','session_use'])await real.verifyCaseAccess(CASE_ID,{requiredScope:'case:write',requiredPurpose:purpose},auth);
 };
 const args={service,sourceStore,persisted,auth,authorize};
 const first=await publishJournalGenerationFromStaging(args);
 assert.equal(first.profile_committed,true);assert.equal(first.cold_retrieval_verified,false);
 assert.equal(first.legacy_state_unchanged,true);assert.equal(first.legacy_before_sha256,first.legacy_after_sha256);
 assert.equal(first.prior_reference,null);assert.equal(first.reference.active_generation,graph.generation);
 assert.equal(conflict,false);assert.ok(authorizationChecks>5);
 const after=await real.loadPrivateRuntimeCase(CASE_ID,reader);
 assert.deepEqual(after.journal_entries,before.journal_entries);
 const again=await publishJournalGenerationFromStaging(args);
 assert.equal(again.transfer.copied_objects,0);assert.equal(again.legacy_state_unchanged,true);
 assert.equal((await real.getJournalCorpus(CASE_ID,CORPUS_ID,reader)).reference.active_generation,graph.generation);
});

test('a new generation replaces only the active generation it names, which stays among the previous ones',async t=>{
 const {service,sourceStore,graph,persisted,representations}=await environment(t);
 const auth={bearerToken:WRITER};
 const publish=(staged,supersedes)=>publishJournalGenerationFromStaging({service,sourceStore,persisted:staged,auth,authorize:async()=>{},
  ...(supersedes===undefined?{}:{supersedes})});
 const inspect=async()=>(await service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},auth)).reference;
 await publish(persisted);
 const next=structuredClone(graph);next.generation=`${graph.generation}-next`;
 const staged=await persistGraphGeneration({corpusStore:sourceStore,graph:next,sourceRepresentations:representations,
  permittedUses:['archive','organize_search','session_use'],archiveReferences:persisted.manifest.archive_references});
 await assert.rejects(publish(staged),{code:'JOURNAL_PUBLICATION_GENERATION_CONFLICT'});
 await assert.rejects(publish(staged,'generation-published-elsewhere'),{code:'JOURNAL_PUBLICATION_GENERATION_CONFLICT'});
 await assert.rejects(publish(staged,next.generation),{code:'JOURNAL_PUBLICATION_SUPERSEDES_INVALID'});
 await assert.rejects(publish(staged,''),{code:'JOURNAL_PUBLICATION_SUPERSEDES_INVALID'});
 assert.equal((await inspect()).active_generation,graph.generation);
 const receipt=await publish(staged,graph.generation);
 assert.equal(receipt.prior_reference.active_generation,graph.generation);
 assert.equal(receipt.legacy_state_unchanged,true);
 const reference=await inspect();
 assert.equal(reference.active_generation,next.generation);
 assert.deepEqual(reference.previous_generations.at(-1),{generation:graph.generation,manifest_object_id:persisted.manifest_object_id});
 // Publishing it again changes nothing, and the replaced generation can't come back through supersedes.
 await publish(staged,graph.generation);
 assert.equal((await inspect()).active_generation,next.generation);
 await assert.rejects(publish(persisted,graph.generation),{code:'JOURNAL_PUBLICATION_SUPERSEDES_INVALID'});
 await assert.rejects(publish(persisted),{code:'JOURNAL_PUBLICATION_GENERATION_CONFLICT'});
});

test('the write inspection carries no case content and needs the named scope and purpose',async t=>{
 const {service}=await environment(t);
 const inspection=await service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},{bearerToken:WRITER});
 assert.deepEqual(Object.keys(inspection).sort(),['case_id','case_revision','non_journal_state_sha256','reference']);
 assert.equal(inspection.reference,null);assert.match(inspection.non_journal_state_sha256,/^[0-9a-f]{64}$/);
 assert.equal(JSON.stringify(inspection).includes('Invented legacy entry'),false);
 await assert.rejects(service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},{bearerToken:READER}),
  {code:'PRIVATE_CASE_ACCESS_DENIED'});
 await assert.rejects(service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'delete'},{bearerToken:WRITER}),
  {code:'PRIVATE_CASE_ACCESS_DENIED'});
 await assert.rejects(service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:audit',requiredPurpose:'session_use'},{bearerToken:WRITER}),
  /requiredScope is invalid/);
});

test('an operator without session_use is refused before any corpus is created or copied',async t=>{
 const {service,sourceStore,persisted}=await environment(t);
 const auth={bearerToken:ARCHIVE_ONLY};
 await assert.rejects(publishJournalGenerationFromStaging({service,sourceStore,persisted,auth,authorize:async()=>{}}),
  {code:'PRIVATE_CASE_ACCESS_DENIED'});
 const inspection=await service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},{bearerToken:WRITER});
 assert.equal(inspection.reference,null);
});

test('the documented import grant cannot roll back, and a run with a correct-purpose grant can',async t=>{
 const {service,sourceStore,persisted}=await environment(t);
 const operator=createPrivateCaseOrchestrator({caseAccessService:service});
 const probe=purpose=>({schema_version:1,operation:'probe_journal_write',case_id:CASE_ID,purpose});
 await assert.rejects(operator.execute(probe('correct'),{bearerToken:WRITER}),{code:'PRIVATE_CASE_ACCESS_DENIED'});
 assert.equal((await operator.execute(probe('correct'),{bearerToken:CORRECTOR})).operation_succeeded,true);
 await publishJournalGenerationFromStaging({service,sourceStore,persisted,auth:{bearerToken:WRITER},authorize:async()=>{}});
 const rollback={schema_version:1,operation:'rollback_journal_generation',case_id:CASE_ID,corpus_id:CORPUS_ID,
  target_generation:'generation:absent',expected_generation:persisted.manifest.generation};
 await assert.rejects(operator.execute(rollback,{bearerToken:WRITER}),{code:'PRIVATE_CASE_ACCESS_DENIED'});
 // Authorized: it now fails only because the synthetic target generation was never published.
 await assert.rejects(operator.execute(rollback,{bearerToken:CORRECTOR}),{code:'SOURCE_UNAVAILABLE'});
});

test('a commit refuses a manifest staged before a visibility change instead of activating a dead generation',async t=>{
 const {service,sourceStore,persisted}=await environment(t);
 const auth={bearerToken:WRITER};
 await service.createJournalCorpus(CASE_ID,{corpusId:CORPUS_ID,manifestObjectId:persisted.manifest_object_id},auth);
 await service.withJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'archive'},
  ({corpusStore})=>transferJournalGeneration({sourceStore,destinationStore:corpusStore,persisted}),auth);
 await service.incrementJournalVisibilityEpoch(CASE_ID,{corpusId:CORPUS_ID,expectedEpoch:0},auth);
 await assert.rejects(createJournalPrivateApi({caseAccessService:service}).commit({caseId:CASE_ID,corpusId:CORPUS_ID,
  generation:persisted.manifest.generation,manifestObjectId:persisted.manifest_object_id,
  permittedUses:['archive','organize_search','session_use']},auth),{code:'GRANT_REVOKED'});
 const inspection=await service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},auth);
 assert.equal(inspection.reference.active_generation,null);
 assert.equal(inspection.reference.visibility_epoch,1);
});

test('a visibility change retires the active generation, so continuity no longer presents it as attached',async t=>{
 const {service,sourceStore,persisted}=await environment(t);
 const auth={bearerToken:WRITER};
 await publishJournalGenerationFromStaging({service,sourceStore,persisted,auth,authorize:async()=>{}});
 const inspect=async()=>(await service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},auth)).reference;
 assert.equal(createJournalContinuityProjection([await inspect()]).mode,'external_reference_only');
 await service.incrementJournalVisibilityEpoch(CASE_ID,{corpusId:CORPUS_ID,expectedEpoch:0},auth);
 const revoked=await inspect();
 assert.equal(revoked.active_generation,null);
 assert.deepEqual(revoked.previous_generations.at(-1),{generation:persisted.manifest.generation,manifest_object_id:persisted.manifest_object_id});
 assert.equal(createJournalContinuityProjection([revoked]).mode,'not_attached');
});

test('a rollback refuses a generation from a revoked visibility epoch and still rolls back within one',async t=>{
 const {service,sourceStore,graph,persisted,representations}=await environment(t);
 const auth={bearerToken:WRITER},corrector={bearerToken:CORRECTOR};
 const uses=['archive','organize_search','session_use'];
 await publishJournalGenerationFromStaging({service,sourceStore,persisted,auth,authorize:async()=>{}});
 await service.incrementJournalVisibilityEpoch(CASE_ID,{corpusId:CORPUS_ID,expectedEpoch:0},auth);
 const stage=generation=>{const next=structuredClone(graph);next.generation=generation;
  return persistGraphGeneration({corpusStore:sourceStore,graph:next,sourceRepresentations:representations,visibilityEpoch:1,
   permittedUses:uses,archiveReferences:persisted.manifest.archive_references});};
 const commit=async staged=>{
  await service.withJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'archive'},
   ({corpusStore})=>transferJournalGeneration({sourceStore,destinationStore:corpusStore,persisted:staged}),auth);
  return createJournalPrivateApi({caseAccessService:service}).commit({caseId:CASE_ID,corpusId:CORPUS_ID,
   generation:staged.manifest.generation,manifestObjectId:staged.manifest_object_id,permittedUses:uses},auth);
 };
 const first=persisted.manifest.generation,second=`${first}:second`,third=`${first}:third`;
 await commit(await stage(second));
 await assert.rejects(service.rollbackJournalGeneration(CASE_ID,{corpusId:CORPUS_ID,targetGeneration:first,expectedGeneration:second},corrector),
  {code:'GRANT_REVOKED'});
 const inspect=()=>service.inspectJournalCorpus(CASE_ID,CORPUS_ID,{requiredScope:'case:write',requiredPurpose:'session_use'},auth);
 assert.equal((await inspect()).reference.active_generation,second);
 await commit(await stage(third));
 await service.rollbackJournalGeneration(CASE_ID,{corpusId:CORPUS_ID,targetGeneration:second,expectedGeneration:third},corrector);
 assert.equal((await inspect()).reference.active_generation,second);
});
