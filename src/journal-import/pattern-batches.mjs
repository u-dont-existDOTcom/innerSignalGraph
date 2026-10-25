import {createHash} from 'node:crypto';
import {ValidationError} from '../core/errors.mjs';
import {createAuditScopeIndex,createReconciledAuditScope} from './audit-scope.mjs';

/** Source-ordered bounded packets. Every unit is assigned; no fact quota or
 * prior pattern hypothesis controls what enters the neutral discovery pass. */
export function createJournalPatternBatches({graph,unitGraphs,maximumBytes=180000,onOversizedUnit=null}){
  const index=createAuditScopeIndex(graph),batches=[];
  let current={units:[],nodes:new Map(),edges:new Map(),bytes:128};
  const flush=()=>{
    if(!current.units.length)return;
    const result={unit_ids:current.units,graph:{...graph,nodes:[...current.nodes.values()],edges:[...current.edges.values()]}};
    result.id='pattern-batch:'+createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0,40);
    batches.push(result);current={units:[],nodes:new Map(),edges:new Map(),bytes:128};
  };
  for(const {unit_id,graph:part} of unitGraphs){
    const scope=createReconciledAuditScope({graph,unitGraph:part,index});
    const cost=(records,map)=>records.reduce((n,r)=>n+(map.has(r.id)?0:Buffer.byteLength(JSON.stringify(r))+1),0);
    let bytes=cost(scope.graph.nodes,current.nodes)+cost(scope.graph.edges,current.edges);
    if(current.units.length&&current.bytes+bytes>maximumBytes){flush();bytes=cost(scope.graph.nodes,current.nodes)+cost(scope.graph.edges,current.edges);}
    if(current.bytes+bytes>maximumBytes){
      if(!onOversizedUnit)throw new ValidationError('PATTERN_UNIT_CONTEXT_EXCEEDS_BOUND',{code:'PATTERN_UNIT_CONTEXT_EXCEEDS_BOUND',details:{unit_id}});
      onOversizedUnit(unit_id);
      continue;
    }
    current.units.push(unit_id);current.bytes+=bytes;
    for(const n of scope.graph.nodes)current.nodes.set(n.id,n);
    for(const e of scope.graph.edges)current.edges.set(e.id,e);
  }
  flush();return batches;
}
