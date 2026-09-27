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

const CASE_ID='synthetic-case',CORPUS_ID='corpus:synthetic';
// The operator's documented grant: case:write only, for the import's three purposes.
const WRITER='synthetic-operator-token',ARCHIVE_ONLY='synthetic-archive-only-token',READER='synthetic-reader-token';
const sha256=value=>createHash('sha256').update(value).digest('hex');

async function environment(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-publication-synthetic-'));await fs.chmod(root,0o700);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const credentialsPath=path.join(root,'credentials.json');
 await fs.writeFile(credentialsPath,`${JSON.stringify({schema_version:1,root_dir:path.join(root,'vaults'),grants:[
  {token_sha256:sha256(WRITER),principal_id:'journal-operator',case_ids:[CASE_ID],scopes:['case:write'],purposes:['archive','organize_search','session_use']},
  {token_sha256:sha256(ARCHIVE_ONLY),principal_id:'archive-only',case_ids:[CASE_ID],scopes:['case:write'],purposes:['archive']},
  {token_sha256:sha256(READER),principal_id:'test-reader',case_ids:[CASE_ID],scopes:['case:read'],purposes:['organize_search']}
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
 return {service,sourceStore,graph,persisted};
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
