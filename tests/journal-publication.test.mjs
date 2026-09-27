import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createEncryptedPrivateCaseStore} from '../src/storage/private-case-store.mjs';
import {createPrivateJournalCorpusStore} from '../src/storage/private-journal-corpus.mjs';
import {persistGraphGeneration} from '../src/journal-import/graph.mjs';
import {publishJournalGenerationFromStaging} from '../src/journal-import/publication.mjs';

test('backend publication transfers complete encrypted evidence and preserves legacy state across retry',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-publication-synthetic-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const vault=path.join(root,'vault'),staging=path.join(root,'staging');
 const caseStore=createEncryptedPrivateCaseStore({rootDir:vault,routineKek:Buffer.alloc(32,7),recoverySecretBytes:Buffer.alloc(32,9),osBackedReauthenticated:true});
 t.after(()=>caseStore.close?.());
 const caseId='synthetic-case',corpusId='corpus:synthetic';
 await caseStore.appendJournal(caseId,{id:'legacy-synthetic',observed_at:'2026-01-01T00:00:00.000Z',kind:'journal',text:'Invented legacy entry'});
 const before=await caseStore.load(caseId);
 const sourceStore=createPrivateJournalCorpusStore({rootDir:staging,caseId,corpusId,corpusKey:Buffer.alloc(32,11)});t.after(()=>sourceStore.close());
 const graph=JSON.parse(await fs.readFile(new URL('../schemas/journal-import/fixtures/synthetic-graph.json',import.meta.url),'utf8'));
 const representations=JSON.parse(await fs.readFile(new URL('../schemas/journal-import/fixtures/synthetic-sources.json',import.meta.url),'utf8'));
 graph.case_id=caseId;graph.corpus_id=corpusId;
 for(const record of [...graph.nodes,...graph.edges]){record.case_id=caseId;record.corpus_id=corpusId;}
 const original=await sourceStore.writeChunkedOriginal({objectId:'original:synthetic',bytes:Buffer.from(JSON.stringify(representations))});
 for(const node of graph.nodes){if(node.kind==='source')node.data.original_object_id=original.object_id;if(node.kind==='passage')node.data.locator.original_object_id=original.object_id;}
 const persisted=await persistGraphGeneration({corpusStore:sourceStore,graph,sourceRepresentations:representations,permittedUses:['archive','organize_search','session_use'],archiveReferences:[original]});
 let published=0,conflict=true,authorizationChecks=0;
 const service={loadPrivateRuntimeCase:id=>caseStore.load(id),createJournalCorpus:(id,args)=>caseStore.createJournalCorpus(id,args),getJournalCorpus:(id,corpus)=>caseStore.getJournalCorpus(id,corpus),
  async withJournalCorpus(id,corpus,permissions,operation){
   assert.deepEqual(permissions,{requiredScope:'case:write',requiredPurpose:'archive'});
   const key=await caseStore.getJournalCorpusKey(id,corpus),store=createPrivateJournalCorpusStore({rootDir:vault,caseId:id,corpusId:corpus,corpusKey:key});
   try{return await operation({corpusStore:store,reference:(await caseStore.getJournalCorpus(id,corpus)).reference});}finally{store.close();key.fill(0);}
  },
  async publishJournalGeneration(id,args){
   const current=(await caseStore.getJournalCorpus(id,corpusId)).reference;
   if(!published)assert.equal(current.active_generation,null);
   if(conflict){conflict=false;throw Object.assign(new Error('Synthetic concurrent revision'),{code:'REVISION_CONFLICT'});}
   published++;return caseStore.publishJournalGeneration(id,args);
  }
 };
 const args={service,sourceStore,persisted,auth:{synthetic:true},authorize:async()=>{authorizationChecks++;}};
 const first=await publishJournalGenerationFromStaging(args);
 assert.equal(first.profile_committed,true);assert.equal(first.cold_retrieval_verified,false);assert.equal(first.legacy_state_unchanged,true);
 const after=await caseStore.load(caseId);assert.deepEqual(after.journal_entries,before.journal_entries);assert.ok(authorizationChecks>5);
 const again=await publishJournalGenerationFromStaging(args);assert.equal(again.transfer.copied_objects,0);assert.equal(again.legacy_state_unchanged,true);
 assert.equal((await caseStore.getJournalCorpus(caseId,corpusId)).reference.active_generation,graph.generation);
});
