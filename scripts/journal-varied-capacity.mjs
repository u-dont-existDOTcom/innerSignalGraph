#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {persistGraphGeneration} from '../src/journal-import/graph.mjs';
import {openPrivateJournalGraph} from '../src/journal-import/retrieval.mjs';
import {createPrivateJournalCorpusStore} from '../src/storage/private-journal-corpus.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const unknown={raw:null,from:null,to:null,precision:'unknown',timezone:null,basis:'unresolved',evidence_ids:[]};
const exact=(date,id)=>({raw:date,from:date+'T00:00:00.000Z',to:date+'T23:59:59.999Z',precision:'day',timezone:'UTC',basis:'explicit',evidence_ids:[id]});

// Every event is invented. The answer-key indexes stay outside retrieval packets.
export function createVariedHistory({years,density}){
 if(![2,10,20].includes(years)||!['sparse','daily'].includes(density))throw new TypeError('Unsupported synthetic envelope');
 const generation=`varied-${years}-${density}`,caseId='synthetic-history',corpusId=generation;
 const dates=[];
 for(let year=2000;year<2000+years;year++){
  const count=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
  for(let day=0;day<count;day++)if(density==='daily'||[0,31,90,181,273,364].includes(day))dates.push(new Date(Date.UTC(year,0,day+1)).toISOString().slice(0,10));
 }
 const stories=[
  i=>['direct_report','waking',`I enjoyed sketching the ${i+3} blue garden stones; this was a small pleasure.`],
  i=>['dream','dream',`I dreamed that the library had ${i+2} floating staircases; this was not a waking event.`],
  i=>['intention','waking',`I plan to ask about workshop P${i}; I have not made the call.`],
  i=>['reported_action','waking',`I called workshop P${i} and left a message; no reply is recorded.`],
  i=>['belief','waking',`I currently prefer route R${i}; this preference may change.`],
  i=>['uncertain_memory','waking',`I may remember visiting place V${i} earlier, but the date and sequence are uncertain.`],
  i=>['quoted_other','quoted',`My colleague Ari said, "The meeting for project P${i} is tentative." This is their statement.`],
  i=>['direct_report','waking',`Aujourd’hui, mon voisin Ari m’a aidé à réparer la boîte B${i}. Je me suis senti soutenu.`],
  i=>['reported_outcome','waking',`Heute wurde die Reparatur von Objekt G${i} fertig. Über die Ursache der Verbesserung weiß ich nichts.`],
  i=>['direct_report','waking',`After moving to address block A${i}, my role in team T${i} changed from helper to organizer.`],
  i=>['imaginal_experience','imaginal',`While imagining a future performance S${i}, I pictured applause; no actual performance is reported.`],
  i=>['direct_report','waking',`An ordinary quiet day: I sorted ${i+1} cards and heard a bird. No difficulty is recorded.`]
 ];
 const entries=dates.map((date,i)=>{
  let [kind,mode,body]=stories[i%stories.length](i);
  if(i===0){kind='direct_report';mode='waking';body='I recorded neighbor Ari as the workshop visitor.';}
  if(i===dates.length-1){kind='explicit_correction';mode='waking';body=`Correction of ${dates[0]}: the workshop visitor was colleague Ari, not neighbor Ari.`;}
  const dated=i%97!==96;
  return {date,kind,mode,dated,text:`capacitymarker entry ${String(i).padStart(5,'0')} ${dated?date:'date not recorded'}: ${body}\n`,body};
 });
 const text=entries.map(e=>e.text).join('');const representation='representation:history';
 const common=(id,kind)=>({id,kind,case_id:caseId,corpus_id:corpusId,version:1,lifecycle:'active'});
 const nodes=[{...common('source:history','source'),data:{representation_id:representation,original_object_id:'original:history',media_type:'text/plain',byte_length:Buffer.byteLength(text),parse_status:'readable'}}];
 const edges=[];let offset=0;
 const addEdge=(relation,from,to,evidence,id)=>edges.push({id:`edge:${id}`,case_id:caseId,corpus_id:corpusId,version:1,lifecycle:'active',relation,from,to,evidence_ids:evidence,basis:'direct_source',derivation_ref:null});
 for(const [i,e] of entries.entries()){
  const p=`passage:${String(i).padStart(5,'0')}`,a=`assertion:${String(i).padStart(5,'0')}`,ep=`episode:${String(i).padStart(5,'0')}`;
  const end=offset+Buffer.byteLength(e.text);const time=e.dated?exact(e.date,p):structuredClone(unknown);
  nodes.push({...common(p,'passage'),data:{representation_id:representation,unit_id:`unit:${i}`,start_byte:offset,end_byte:end,quote:e.text,quote_sha256:hash(e.text),locator:{kind:'native_text',page:null,bbox:null,original_object_id:'original:history',interpretation_status:'native'}}});
  nodes.push({...common(ep,'episode'),data:{label:`Synthetic event ${i}`,authored_time:time,event_time:e.kind==='uncertain_memory'?structuredClone(unknown):time,source_order:i,evidence_ids:[p],support_group_id:`support:${i}`}});
  nodes.push({...common(a,'assertion'),data:{statement:e.body,assertion_kind:e.kind,narrative_mode:e.mode,speaker_id:'entity:self',subject_ids:['entity:self'],episode_id:ep,polarity:'affirmed',qualifiers:[],authored_time:time,event_time:e.kind==='uncertain_memory'?structuredClone(unknown):time,still_current:null,evidence_ids:[p],review_state:'unreviewed',extraction_confidence:'high',producer_ref:'invented-fixture',support_group_id:`support:${i}`}});
  addEdge('contains','source:history',p,[p],`contains:${i}`);addEdge('supported_by',a,p,[p],`supports:${i}`);addEdge('in_episode',a,ep,[p],`episode:${i}`);offset=end;
 }
 for(const [id,label] of [['self','Invented diarist'],['neighbor','Ari, neighbor'],['colleague','Ari, colleague']])nodes.push({...common(`entity:${id}`,'entity'),data:{label,entity_kind:'person',aliases:[],evidence_ids:['passage:00000']}});
 const last=String(entries.length-1).padStart(5,'0');addEdge('corrects',`assertion:${last}`,'assertion:00000',[`passage:${last}`],'distant-correction');
 return {graph:{schema_version:'1.0',case_id:caseId,corpus_id:corpusId,generation,nodes,edges},representations:{[representation]:text},entries:entries.length,answerKey:{lastAssertion:`assertion:${last}`,firstAssertion:'assertion:00000',unknownCount:entries.filter(e=>!e.dated).length,dates,scopes:[...new Set(entries.map(e=>e.mode))]}};
}

export async function runVariedCapacity({rootDir=null,onProgress=()=>{}}={}){
 const owned=rootDir===null;const root=rootDir??await fs.mkdtemp(path.join(os.tmpdir(),'journal-varied-capacity-'));
 await fs.chmod(root,0o700);const started=performance.now();const cases=[];
 try{
  for(const years of [2,10,20])for(const density of ['sparse','daily']){
   await onProgress({years,density,phase:'started'});
   const fixture=createVariedHistory({years,density});const g=fixture.graph;const key=randomBytes(32);
   const store=createPrivateJournalCorpusStore({rootDir:root,caseId:g.case_id,corpusId:g.corpus_id,corpusKey:key});
   let reader;const begin=performance.now();
   try{
    const original=await store.writeChunkedOriginal({objectId:'original:history',bytes:Buffer.from(Object.values(fixture.representations)[0])});
    const persisted=await persistGraphGeneration({corpusStore:store,graph:g,sourceRepresentations:fixture.representations,archiveReferences:[original]});
    const indexed=performance.now();
    reader=await openPrivateJournalGraph({corpusStore:store,manifestObjectId:persisted.manifest_object_id,caseId:g.case_id,corpusId:g.corpus_id,generation:g.generation,visibilityEpoch:0,cursorSecret:key});
    const ids=new Set();let cursor=null,pages=0;
    do{const page=await reader.search({query:'capacitymarker',graphEnabled:false,pageSize:200,cursor});for(const n of page.records){if(ids.has(n.id))throw new Error('DUPLICATE_PAGE_RESULT');ids.add(n.id);}cursor=page.next_cursor;pages++;}while(cursor);
    if(ids.size!==fixture.entries)throw new Error('INCOMPLETE_DAILY_READBACK');
    const closure=await reader.evidenceGroup([fixture.answerKey.firstAssertion],{maximumNodes:30});
    if(!closure.nodes.some(n=>n.id===fixture.answerKey.lastAssertion))throw new Error('DISTANT_CORRECTION_MISSING');
    const timeline=await reader.timeline({includeUnknown:true});
    if(timeline.unknown_count<fixture.answerKey.unknownCount)throw new Error('UNKNOWN_DATE_LANE_MISSING');
    let stored=0;for(const name of await fs.readdir(store.rootDir))stored+=(await fs.stat(path.join(store.rootDir,name))).size;
    cases.push({years,density,entries:fixture.entries,result_pages:pages,all_entries_retrieved:true,distant_correction_retrieved:true,unknown_dates:fixture.answerKey.unknownCount,narrative_scopes:fixture.answerKey.scopes,source_bytes:Buffer.byteLength(Object.values(fixture.representations)[0]),stored_bytes:stored,index_ms:Math.round(indexed-begin),readback_ms:Math.round(performance.now()-indexed)});
    await onProgress({years,density,phase:'complete',result:cases.at(-1)});
   }finally{reader?.close();store.close();key.fill(0);}
  }
  return {schema_version:1,claim:'invented_calendar_storage_and_retrieval_only',semantic_model_evaluation:false,incremental_usd:0,node:process.version,hardware:{platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,total_memory_bytes:os.totalmem()},cases,elapsed_ms:Math.round(performance.now()-started),max_rss_bytes:process.resourceUsage().maxRSS*1024};
 }finally{if(owned)await fs.rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await runVariedCapacity({onProgress:p=>{process.stderr.write(JSON.stringify(p)+'\n');}}))+'\n');}catch(e){process.stderr.write(`Varied history capacity failed: ${e.code??e.message}\n`);process.exitCode=1;}
}
