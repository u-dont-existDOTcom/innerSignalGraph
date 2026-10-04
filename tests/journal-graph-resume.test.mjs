import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {adaptExtractionToGraph,persistGraphGeneration} from '../src/journal-import/graph.mjs';
import {openPrivateJournalGraph} from '../src/journal-import/retrieval.mjs';
import {validateJournalGraph} from '../src/journal-import/contracts.mjs';
import {partitionRepresentation} from '../src/journal-import/partition.mjs';
import {createPrivateJournalCorpusStore} from '../src/storage/private-journal-corpus.mjs';

function input(){
 const text='Synthetic entry: I enjoyed the blue garden.\n';
 const units=[...partitionRepresentation({representationId:'representation:synthetic',text})];
 units[0]={...units[0],source_order:731};
 const anchor={unit_id:units[0].unit_id,quote:'I enjoyed the blue garden.',occurrence:null};
 const unknown={raw:null,from:null,to:null,precision:'unknown',timezone:null,basis:'unresolved',evidence_ids:['a']};
 return {text,caseId:'synthetic-case',corpusId:'synthetic-corpus',generation:'synthetic-generation',
  source:{id:'source:synthetic',representation_id:'representation:synthetic',original_object_id:'original:synthetic',media_type:'text/plain',byte_length:Buffer.byteLength(text),parse_status:'readable'},units,
  extraction:{schema_version:'1.0',status:'complete',entities:[{local_id:'self',label:'Synthetic diarist',entity_kind:'person',anchors:[anchor]}],episodes:[{local_id:'episode',label:'Garden visit',authored_time:unknown,event_time:unknown,anchors:[anchor]}],assertions:[{local_id:'a',statement:'I enjoyed the blue garden.',assertion_kind:'direct_report',narrative_mode:'waking',speaker_local_id:'self',subject_local_ids:['self'],episode_local_id:'episode',polarity:'affirmed',qualifiers:[],authored_time:unknown,event_time:unknown,anchors:[anchor],importance_reasons:['synthetic'],extraction_confidence:'high'}],coverage:[{unit_id:units[0].unit_id,disposition:'extracted',assertion_local_ids:['a'],reason:null}],requested_context:[]}};
}

test('independent packet namespaces prevent collisions and keep legacy IDs stable',()=>{
 const args=input();const legacy=adaptExtractionToGraph(args);
 const expected=createHash('sha256').update('synthetic-case\0synthetic-corpus\0synthetic-generation\0a').digest('hex').slice(0,32);
 assert.equal(legacy.nodes.find(n=>n.kind==='assertion').id,`assertion:${expected}`);
 const a=adaptExtractionToGraph({...args,localIdNamespace:'window-a'});
 const b=adaptExtractionToGraph({...args,localIdNamespace:'window-b'});
 const aIds=new Set(a.nodes.filter(n=>n.kind!=='source').map(n=>n.id));
 assert.equal(b.nodes.filter(n=>n.kind!=='source').some(n=>aIds.has(n.id)),false);
 assert.equal(a.nodes.find(n=>n.kind==='episode').data.source_order,731);
 assert.doesNotThrow(()=>validateJournalGraph(a,{[args.source.representation_id]:args.text}));
 const assertion=a.nodes.find(n=>n.kind==='assertion');
 assert.deepEqual(assertion.data.event_time.evidence_ids,assertion.data.evidence_ids);
 args.extraction.assertions[0].event_time={...args.extraction.assertions[0].event_time,evidence_ids:['missing']};
 assert.throws(()=>adaptExtractionToGraph(args),{code:'TIME_EVIDENCE_REFERENCE_UNRESOLVED'});
});

test('restricted anchors bind exact private bytes without publishing a unit quote',()=>{
 const args=input();
 const anchor={anchor_kind:'restricted_source_pointer',unit_id:args.units[0].unit_id,region_id:null,disclosure:'restricted',non_graphic_statement:'Synthetic restricted entry',review_state:'unreviewed'};
 for(const item of [...args.extraction.entities,...args.extraction.episodes,...args.extraction.assertions])item.anchors=[anchor];
 const graph=adaptExtractionToGraph(args);
 const passages=graph.nodes.filter(n=>n.kind==='passage');
 assert.ok(passages.length);assert.ok(passages.every(n=>n.data.quote===null&&n.data.disclosure==='restricted'));
 assert.doesNotThrow(()=>validateJournalGraph(graph,{[args.source.representation_id]:args.text}));
});

test('visual transcript provenance is never silently relabelled native',()=>{
 const args=input();args.source.locator_kind='visual_transcript';args.source.interpretation_status='provisional';
 const graph=adaptExtractionToGraph(args);
 assert.ok(graph.nodes.filter(n=>n.kind==='passage').every(n=>n.data.locator.kind==='visual_transcript'&&n.data.locator.interpretation_status==='provisional'));
});

test('resume writes authenticate and reuse identical ciphertext but reject different bytes',async t=>{
 const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-immutable-resume-'));
 t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
 const args={rootDir,caseId:'synthetic-case',corpusId:'synthetic-corpus',corpusKey:Buffer.alloc(32,71)};
 let store=createPrivateJournalCorpusStore(args);
 const value={synthetic:'unchanged'};const first=await store.writeJsonObject({objectId:'object:resume',value});
 const file=path.join(store.rootDir,first.storage_id);const before=await fs.readFile(file);
 await assert.rejects(()=>store.writeJsonObject({objectId:'object:resume',value}),{code:'JOURNAL_OBJECT_EXISTS'});store.close();
 store=createPrivateJournalCorpusStore({...args,resumeMatchingObjects:true});
 t.after(()=>store.close());
 assert.deepEqual(await store.writeJsonObject({objectId:'object:resume',value}),first);
 assert.deepEqual(await fs.readFile(file),before);
 await assert.rejects(()=>store.writeJsonObject({objectId:'object:resume',value:{synthetic:'changed'}}),{code:'JOURNAL_OBJECT_EXISTS'});
 assert.deepEqual(await store.readJsonObject({objectId:'object:resume'}),value);
});

test('concurrent timeline and record reads decrypt each immutable shard once',async t=>{
 const rootDir=await fs.mkdtemp(path.join(os.tmpdir(),'journal-read-coalescing-'));
 t.after(()=>fs.rm(rootDir,{recursive:true,force:true}));
 const args=input();const graph=adaptExtractionToGraph(args);
 const store=createPrivateJournalCorpusStore({rootDir,caseId:args.caseId,corpusId:args.corpusId,corpusKey:Buffer.alloc(32,77)});
 t.after(()=>store.close());
 const persisted=await persistGraphGeneration({corpusStore:store,graph,sourceRepresentations:{[args.source.representation_id]:args.text}});
 const counts=new Map();
 const counted={readJsonObject:async input=>{counts.set(input.objectId,(counts.get(input.objectId)??0)+1);await new Promise(r=>setTimeout(r,5));return store.readJsonObject(input);}};
 const reader=await openPrivateJournalGraph({corpusStore:counted,manifestObjectId:persisted.manifest_object_id,caseId:args.caseId,corpusId:args.corpusId,generation:args.generation,visibilityEpoch:0,cursorSecret:Buffer.alloc(32,78)});
 t.after(()=>reader.close());
 await Promise.all([reader.timeline(),reader.timeline(),reader.resolveRecords(graph.nodes.map(n=>n.id))]);
 assert.ok([...counts.values()].every(n=>n===1));
});
