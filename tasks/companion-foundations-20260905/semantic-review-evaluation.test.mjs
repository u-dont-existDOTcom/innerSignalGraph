import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { UNIVERSAL_SEMANTIC_CRITERIA, CONDITIONAL_SEMANTIC_CRITERIA } from './semantic-review-contract.mjs';

const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));

test('every unevaluated behavior case has exactly one semantic-review applicability plan', async () => {
  const cases = await load('./behavior-cases.json');
  const plan = await load('./behavior-case-review-plan.json');
  assert.equal(cases.status, 'SYNTHETIC_UNEVALUATED');
  assert.equal(cases.modelRuns, 0);
  assert.equal(plan.status, 'SYNTHETIC_UNEVALUATED_REVIEW_PLAN');
  assert.equal(plan.modelRuns, 0);
  assert.deepEqual(plan.cases.map(x => x.id).sort(), cases.cases.map(x => x.id).sort());
  assert.equal(new Set(plan.cases.map(x => x.id)).size, plan.cases.length);
});

test('case plan uses only known reviewer criteria and cannot delegate conditional applicability to reviewer', async () => {
  const plan = await load('./behavior-case-review-plan.json');
  for (const item of plan.cases) {
    assert.ok(Array.isArray(item.primaryUniversal) && item.primaryUniversal.length > 0);
    assert.ok(Array.isArray(item.requiredConditional));
    assert.equal(typeof item.pairedStance, 'boolean');
    assert.ok(item.primaryUniversal.every(id => UNIVERSAL_SEMANTIC_CRITERIA.includes(id)));
    assert.ok(item.requiredConditional.every(id => CONDITIONAL_SEMANTIC_CRITERIA.includes(id)));
    assert.equal(new Set(item.primaryUniversal).size, item.primaryUniversal.length);
    assert.equal(new Set(item.requiredConditional).size, item.requiredConditional.length);
  }
});

test('plan explicitly includes high-risk anti-sycophancy and autonomy contrasts', async () => {
  const plan = await load('./behavior-case-review-plan.json');
  const byId = new Map(plan.cases.map(x => [x.id, x]));
  assert.ok(byId.get('CF-B006').primaryUniversal.includes('non_sycophancy'));
  assert.ok(byId.get('CF-B007').primaryUniversal.includes('accountability_proportionality'));
  assert.ok(byId.get('CF-B008').requiredConditional.includes('safety_support_continuity'));
  assert.ok(byId.get('CF-B013').requiredConditional.includes('self_guidance_scrutiny'));
  assert.ok(byId.get('CF-B015').primaryUniversal.includes('founder_independence'));
  assert.ok(byId.get('CF-B014').primaryUniversal.includes('autonomy_non_dependency'));
  assert.ok([...byId.values()].some(x => x.pairedStance));
});
