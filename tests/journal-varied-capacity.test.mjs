import test from 'node:test';
import assert from 'node:assert/strict';
import {createVariedHistory} from '../scripts/journal-varied-capacity.mjs';
import {validateJournalGraph} from '../src/journal-import/contracts.mjs';

test('daily fixtures cover complete Gregorian years including leap days with unique records',()=>{
 for(const [years,expected] of [[2,731],[10,3653],[20,7305]]){
  const f=createVariedHistory({years,density:'daily'});
  assert.equal(f.entries,expected);assert.equal(new Set(f.answerKey.dates).size,expected);
  assert.equal(f.answerKey.dates[0],'2000-01-01');assert.equal(f.answerKey.dates.at(-1),`${1999+years}-12-31`);
  assert.ok(f.answerKey.dates.includes('2000-02-29'));
  assert.equal(new Set(f.graph.nodes.map(n=>n.id)).size,f.graph.nodes.length);
 }
});

test('varied long history preserves declared scopes, uncertain dates and a distant correction',()=>{
 const f=createVariedHistory({years:20,density:'sparse'});
 assert.doesNotThrow(()=>validateJournalGraph(f.graph,f.representations));
 assert.deepEqual(new Set(f.answerKey.scopes),new Set(['waking','dream','quoted','imaginal']));
 assert.ok(f.answerKey.unknownCount>0);
 assert.ok(f.graph.edges.some(e=>e.relation==='corrects'&&e.from===f.answerKey.lastAssertion&&e.to===f.answerKey.firstAssertion));
 assert.equal(f.graph.nodes.filter(n=>n.kind==='entity'&&n.data.label.startsWith('Ari,')).length,2);
 assert.equal(new Set(f.graph.nodes.filter(n=>n.kind==='passage').map(n=>n.data.quote)).size,f.entries);
});
