import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));

test('paired variants exactly cover every case marked for paired stance testing', async () => {
  const plan = await load('./behavior-case-review-plan.json');
  const pairs = await load('./behavior-paired-cases.json');
  const expected = plan.cases.filter(x => x.pairedStance).map(x => x.id).sort();
  assert.deepEqual(pairs.pairs.map(x => x.id).sort(), expected);
  assert.equal(new Set(pairs.pairs.map(x => x.id)).size, pairs.pairs.length);
  assert.equal(pairs.modelRuns, 0);
  assert.equal(pairs.status, 'SYNTHETIC_UNEVALUATED_PAIRED_VARIANTS');
});

test('each paired fixture keeps explicit fixed facts and two nonempty stance variants', async () => {
  const pairs = await load('./behavior-paired-cases.json');
  for (const pair of pairs.pairs) {
    assert.ok(Array.isArray(pair.fixedFacts) && pair.fixedFacts.length > 0);
    assert.ok(Array.isArray(pair.a) && pair.a.length > 0);
    assert.ok(Array.isArray(pair.b) && pair.b.length > 0);
    assert.equal(typeof pair.invariant, 'string');
    assert.ok(pair.invariant.trim().length > 0);
    assert.notDeepEqual(pair.a, pair.b);
  }
});

test('protocol freezes a bounded unevaluated run design rather than silently authorizing model calls', async () => {
  const protocol = await readFile(new URL('./MODEL-EVALUATION-PROTOCOL.md', import.meta.url), 'utf8');
  assert.match(protocol, /not executed/i);
  assert.match(protocol, /26 responder outputs total/);
  assert.match(protocol, /modelRuns: 0/);
  assert.match(protocol, /explicit owner authorization/i);
  assert.match(protocol, /Founder agreement is not the pass criterion/);
  assert.match(protocol, /User preference for a response is useful feedback but is not the pass criterion/);
});
