import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournalPatternBatches} from '../src/journal-import/pattern-batches.mjs';
test('neutral batches cover every unit and retain cross-unit relationship evidence within a bound',()=>{
 const graph={generation:'g',nodes:[],edges:[]},parts=[];
 for(let i=0;i<10;i++){
  const passage={id:'p'+i,kind:'passage',data:{unit_id:'u'+i,representation_id:'r',quote:'Synthetic source '.repeat(20)}};
  const assertion={id:'a'+i,kind:'assertion',data:{statement:'Synthetic assertion',evidence_ids:[passage.id]}};
  graph.nodes.push(passage,assertion);parts.push({unit_id:'u'+i,graph:{nodes:[passage,assertion],edges:[]}});
 }
 graph.nodes.push({id:'source',kind:'source',data:{representation_id:'r'}});
 graph.edges.push({id:'correction',from:'a9',to:'a0',evidence_ids:['p9'],derivation_ref:'receipt',relation:'corrects'});
 const batches=createJournalPatternBatches({graph,unitGraphs:parts,maximumBytes:2200});
 assert.ok(batches.length>1);assert.deepEqual(batches.flatMap(b=>b.unit_ids),parts.map(p=>p.unit_id));
 assert.ok(batches[0].graph.nodes.some(n=>n.id==='a9'));assert.ok(batches[0].graph.edges.some(e=>e.id==='correction'));
 assert.deepEqual(createJournalPatternBatches({graph,unitGraphs:parts,maximumBytes:2200}),batches);
 assert.throws(()=>createJournalPatternBatches({graph,unitGraphs:parts,maximumBytes:200}),{code:'PATTERN_UNIT_CONTEXT_EXCEEDS_BOUND'});
});
