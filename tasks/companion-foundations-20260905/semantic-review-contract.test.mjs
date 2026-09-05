import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjudicateSemanticReview, UNIVERSAL_SEMANTIC_CRITERIA, CONDITIONAL_SEMANTIC_CRITERIA } from './semantic-review-contract.mjs';
import { createReflectionController } from './reflection-controller.mjs';
import { createSyntheticSnapshotAdapter } from './synthetic-snapshot.mjs';

const binding = () => ({
  candidate: Object.freeze({ text: 'Tentative fictional reflection.' }),
  version: Object.freeze(Object.create(null)),
  reviewBinding: Object.freeze(Object.create(null))
});
const review = (requiredConditional = [], overrides = {}) => ({
  criteria: [...UNIVERSAL_SEMANTIC_CRITERIA, ...requiredConditional].map(id => ({ id, verdict: overrides[id] || 'pass' }))
});

test('all universal criteria pass and deterministic adapter binds exact in-process objects', () => {
  const b = binding();
  const result = adjudicateSemanticReview({ review: review(), ...b });
  assert.equal(result.approved, true);
  assert.equal(result.candidate, b.candidate);
  assert.equal(result.version, b.version);
  assert.equal(result.reviewBinding, b.reviewBinding);
  assert.ok(Object.isFrozen(result));
});

test('caller-required conditional criteria must also pass', () => {
  const requiredConditional = ['progress_balance', 'spiritual_epistemic_humility'];
  const b = binding();
  assert.equal(adjudicateSemanticReview({ review: review(requiredConditional), requiredConditional, ...b }).approved, true);
  const denied = adjudicateSemanticReview({
    review: review(requiredConditional, { progress_balance: 'revise' }), requiredConditional, ...b
  });
  assert.deepEqual(denied, { approved: false, reason: 'SEMANTIC_REVISION_REQUIRED', criteria: ['progress_balance'] });
});

test('block outranks revise and returns criterion IDs without candidate prose', () => {
  const b = binding();
  const result = adjudicateSemanticReview({ review: review([], { non_sycophancy: 'revise', evidence_fidelity: 'block' }), ...b });
  assert.deepEqual(result, { approved: false, reason: 'SEMANTIC_BLOCK', criteria: ['evidence_fidelity'] });
  assert.equal(Object.hasOwn(result, 'candidate'), false);
});

test('missing, duplicate, unknown or extra criterion results fail closed', () => {
  const b = binding();
  const complete = review();
  assert.equal(adjudicateSemanticReview({ review: { criteria: complete.criteria.slice(1) }, ...b }).reason, 'INCOMPLETE_SEMANTIC_REVIEW');
  assert.equal(adjudicateSemanticReview({ review: { criteria: [...complete.criteria, complete.criteria[0]] }, ...b }).reason, 'INVALID_CRITERION_RESULT');
  assert.equal(adjudicateSemanticReview({ review: { criteria: [...complete.criteria, { id: 'made_up', verdict: 'pass' }] }, ...b }).reason, 'INVALID_CRITERION_RESULT');
  assert.equal(adjudicateSemanticReview({ review: { criteria: complete.criteria.map((x, i) => i ? x : { ...x, note: 'extra' }) }, ...b }).reason, 'INVALID_CRITERION_RESULT');
});

test('reviewer cannot opt itself out of conditional criteria', () => {
  const b = binding();
  const requiredConditional = ['progress_balance'];
  assert.equal(adjudicateSemanticReview({ review: review(), requiredConditional, ...b }).reason, 'INCOMPLETE_SEMANTIC_REVIEW');
  for (const bad of [['unknown'], ['progress_balance', 'progress_balance'], 'progress_balance']) {
    assert.equal(adjudicateSemanticReview({ review: review(), requiredConditional: bad, ...b }).reason, 'INVALID_REQUIRED_CRITERIA');
  }
});

test('malformed review or binding fails closed', () => {
  const b = binding();
  for (const bad of [undefined, null, true, [], {}, { criteria: 'pass' }, { criteria: [], extra: true }]) {
    assert.equal(adjudicateSemanticReview({ review: bad, ...b }).approved, false);
  }
  assert.equal(adjudicateSemanticReview({ review: review(), ...b, candidate: { text: '' } }).reason, 'INVALID_REVIEW_BINDING');
});

test('structured contract can supply controller exact approval binding without model object identity', async () => {
  const controller = createReflectionController();
  const snapshots = createSyntheticSnapshotAdapter({ permitted: true, reports: ['earlier', 'recent'] });
  const result = await controller.run({
    snapshotAdapter: snapshots,
    eligible: snapshot => snapshot.permitted === true,
    draft: async () => 'Tentative fictional reflection.',
    semanticReview: async ctx => adjudicateSemanticReview({ review: review(['progress_balance']), requiredConditional: ['progress_balance'], candidate: ctx.candidate, version: ctx.version, reviewBinding: ctx.reviewBinding })
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'READY_FOR_DISPLAY');
});

test('a revise verdict remains denied through the controller', async () => {
  const controller = createReflectionController();
  const snapshots = createSyntheticSnapshotAdapter({ permitted: true });
  const result = await controller.run({
    snapshotAdapter: snapshots,
    eligible: () => true,
    draft: async () => 'Candidate.',
    semanticReview: async ctx => adjudicateSemanticReview({ review: review([], { non_sycophancy: 'revise' }), candidate: ctx.candidate, version: ctx.version, reviewBinding: ctx.reviewBinding })
  });
  assert.deepEqual(result, { allowed: false, reason: 'SEMANTIC_REVIEW_DENIED' });
});

test('rubric and contract enumerate the same criteria and remain synthetic-only', async () => {
  const rubric = JSON.parse(await readFile(new URL('./semantic-review-rubric.json', import.meta.url), 'utf8'));
  assert.deepEqual(rubric.universalCriteria.map(x => x.id), [...UNIVERSAL_SEMANTIC_CRITERIA]);
  assert.deepEqual(rubric.conditionalCriteria.map(x => x.id), [...CONDITIONAL_SEMANTIC_CRITERIA]);
  assert.equal(rubric.status, 'PROVISIONAL_SYNTHETIC_CONTRACT');
  const source = await readFile(new URL('./semantic-review-contract.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import |\b(?:fetch|localStorage|sessionStorage|indexedDB|createHash|setTimeout)\s*[.(]/m);
});
