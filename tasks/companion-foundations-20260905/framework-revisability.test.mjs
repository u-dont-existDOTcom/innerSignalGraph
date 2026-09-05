import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONDITIONAL_SEMANTIC_CRITERIA } from './semantic-review-contract.mjs';

const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));

test('owner decision records a revisable framework rather than protected doctrine', async () => {
  const decisions = await load('./OWNER-DECISIONS.json');
  const decision = decisions.approvedPrinciples.find(item => item.id === 'CF-D011');
  assert.ok(decision);
  assert.match(decision.decision, /current best framework/i);
  assert.match(decision.decision, /alternative frameworks/i);
  assert.match(decision.decision, /novelty/i);
});

test('semantic contract separately gates philosophy fidelity and framework revisability', () => {
  assert.ok(CONDITIONAL_SEMANTIC_CRITERIA.includes('philosophy_fidelity'));
  assert.ok(CONDITIONAL_SEMANTIC_CRITERIA.includes('framework_revisability'));
  assert.notEqual(
    CONDITIONAL_SEMANTIC_CRITERIA.indexOf('philosophy_fidelity'),
    CONDITIONAL_SEMANTIC_CRITERIA.indexOf('framework_revisability')
  );
});

test('revisability supplement contains four unevaluated cases without rewriting v1 cases', async () => {
  const original = await load('./behavior-cases.json');
  const supplement = await load('./framework-revisability-cases.json');
  assert.equal(original.cases.length, 16);
  assert.equal(original.modelRuns, 0);
  assert.equal(supplement.cases.length, 4);
  assert.equal(supplement.modelRuns, 0);
  assert.equal(supplement.baseProtocolCommit, '0cc46be4aad204c28672cb93ce68597f198fc544');
  assert.equal(new Set(supplement.cases.map(item => item.id)).size, supplement.cases.length);
  for (const item of supplement.cases) {
    assert.ok(item.syntheticTurns.length > 0);
    assert.ok(item.must.length > 0);
    assert.ok(item.mustNot.length > 0);
    assert.ok(item.requiredConditional.includes('framework_revisability'));
  }
});

test('inner-alien cases distinguish functional usefulness from unsupported literal ontology', async () => {
  const supplement = await load('./framework-revisability-cases.json');
  const metaphor = supplement.cases.find(item => item.id === 'CF-R001');
  const literal = supplement.cases.find(item => item.id === 'CF-R002');
  assert.ok(metaphor.must.some(text => /metaphor/i.test(text)));
  assert.ok(metaphor.mustNot.some(text => /literal extraterrestrial/i.test(text)));
  assert.ok(literal.must.some(text => /unsupported literal claim/i.test(text)));
  assert.ok(literal.mustNot.some(text => /literal alien implantation/i.test(text)));
});

test('founder authority cannot veto alternatives and novelty cannot promote them automatically', async () => {
  const supplement = await load('./framework-revisability-cases.json');
  const founder = supplement.cases.find(item => item.id === 'CF-R003');
  const novelty = supplement.cases.find(item => item.id === 'CF-R004');
  assert.deepEqual(founder.requiredConditional, ['philosophy_fidelity', 'framework_revisability']);
  assert.ok(founder.mustNot.some(text => /founder instruction as sufficient evidence/i.test(text)));
  assert.ok(novelty.mustNot.some(text => /one anecdote/i.test(text)));
});

test('v2 protocol is an explicit successor with a bounded 30-conversation corpus', async () => {
  const protocol = await readFile(new URL('./MODEL-EVALUATION-PROTOCOL-v2.md', import.meta.url), 'utf8');
  assert.match(protocol, /not executed/i);
  assert.match(protocol, /30 isolated conversations/);
  assert.match(protocol, /43 listed user entries/);
  assert.match(protocol, /does not rewrite/i);
  assert.match(protocol, /modelRuns: 0/);
  assert.match(protocol, /anti-sycophancy is not automatic opposition/i);
});
