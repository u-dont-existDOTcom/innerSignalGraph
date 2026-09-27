import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createPrivateJournalCorpusStore} from '../src/storage/private-journal-corpus.mjs';
import {transferJournalGeneration} from '../src/journal-import/generation-transfer.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'journal-transfer-synthetic-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const make=(folder,key)=>createPrivateJournalCorpusStore({rootDir:path.join(root,folder),caseId:'synthetic',corpusId:'corpus:synthetic',corpusKey:Buffer.alloc(32,key)});
 const sourceStore=make('source',1),destinationStore=make('destination',2);t.after(()=>{sourceStore.close();destinationStore.close();});
 const record=await sourceStore.writeJsonObject({objectId:'record:one',value:{source:'Invented source'}});
 const archive=await sourceStore.writeChunkedOriginal({objectId:'original:one',bytes:Buffer.from('Invented original')});
 const manifest={case_id:'synthetic',corpus_id:'corpus:synthetic',record_shards:[record],indexes:{},source_representation_objects:{},archive_references:[archive]};
 const manifestRef=await sourceStore.writeJsonObject({objectId:'manifest:one',value:manifest});
 return {sourceStore,destinationStore,persisted:{manifest,manifest_reference:manifestRef,manifest_object_id:'manifest:one'}};
}
test('generation transfer re-encrypts, authenticates originals, and resumes identical objects without publishing',async t=>{
 const f=await fixture(t);const first=await transferJournalGeneration(f);
 assert.equal(first.objects_verified,3);assert.equal(first.copied_objects,3);assert.equal(first.profile_pointer_published,false);
 const second=await transferJournalGeneration(f);assert.equal(second.reused_objects,3);assert.equal(second.copied_objects,0);
 assert.equal((await f.destinationStore.reassembleOriginal(f.persisted.manifest.archive_references[0])).toString(),'Invented original');
});
test('transfer rejects a conflicting destination and stops immediately on revoked authorization',async t=>{
 const f=await fixture(t);await f.destinationStore.writeJsonObject({objectId:'record:one',value:{source:'Conflicting source'}});
 await assert.rejects(()=>transferJournalGeneration(f),{code:'JOURNAL_TRANSFER_DESTINATION_CONFLICT'});
 let sourceReads=0;const source={...f.sourceStore,readObject:async()=>{sourceReads++;assert.fail('revoked read');}};
 await assert.rejects(()=>transferJournalGeneration({...f,sourceStore:source,authorize:async()=>{throw Object.assign(new Error(),{code:'GRANT_REVOKED'});}}),{code:'GRANT_REVOKED'});
 assert.equal(sourceReads,0);
});
test('transfer validates source object digests before writing any destination bytes',async t=>{
 const f=await fixture(t);f.persisted.manifest.record_shards[0]={...f.persisted.manifest.record_shards[0],sha256:createHash('sha256').update('other').digest('hex')};
 await assert.rejects(()=>transferJournalGeneration(f),{code:'JOURNAL_TRANSFER_SOURCE_MISMATCH'});
 await assert.rejects(()=>f.destinationStore.readObject({objectId:'record:one'}),{code:'ENOENT'});
});
