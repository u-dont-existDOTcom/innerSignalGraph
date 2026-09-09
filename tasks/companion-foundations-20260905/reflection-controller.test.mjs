import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReflectionController } from './reflection-controller.mjs';
import { createSyntheticSnapshotAdapter } from './synthetic-snapshot.mjs';

const initial = () => ({ scope: 'fictional-a', permitted: true, reports: ['earlier', 'recent'] });
const adapter = () => createSyntheticSnapshotAdapter(initial());
const eligible = snapshot => snapshot.permitted === true;
const draft = async () => 'Tentative fictional reflection.';
const approve = async ({ candidate, version, reviewBinding }) => ({ approved: true, candidate, version, reviewBinding });

async function run(overrides = {}) {
  const controller = overrides.controller || createReflectionController();
  const snapshots = overrides.snapshotAdapter || adapter();
  return controller.run({ snapshotAdapter: snapshots, eligible, draft, semanticReview: approve, ...overrides });
}

test('fresh snapshot plus separately bound semantic approval can reach display boundary', async () => {
  const result = await run();
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'READY_FOR_DISPLAY');
  assert.equal(result.candidate.text, 'Tentative fictional reflection.');
  assert.ok(Object.isFrozen(result.candidate));
});

test('semantic approval is denied by default even when freshness and eligibility pass', async () => {
  const result = await run({ semanticReview: undefined });
  assert.deepEqual(result, { allowed: false, reason: 'SEMANTIC_REVIEW_REQUIRED' });
});

for (const review of [undefined, null, false, true, {}, { approved: false }, { approved: 'true' }]) {
  test(`malformed or non-approved semantic result fails closed: ${JSON.stringify(review)}`, async () => {
    const result = await run({ semanticReview: async () => review });
    assert.deepEqual(result, { allowed: false, reason: 'SEMANTIC_REVIEW_DENIED' });
  });
}

test('an approved flag is insufficient unless bound to exact candidate, version and review boundary', async () => {
  const cases = [
    ctx => ({ approved: true, candidate: { text: ctx.candidate.text }, version: ctx.version, reviewBinding: ctx.reviewBinding }),
    ctx => ({ approved: true, candidate: ctx.candidate, version: {}, reviewBinding: ctx.reviewBinding }),
    ctx => ({ approved: true, candidate: ctx.candidate, version: ctx.version, reviewBinding: {} })
  ];
  for (const semanticReview of cases) {
    assert.deepEqual(await run({ semanticReview: async ctx => semanticReview(ctx) }),
      { allowed: false, reason: 'SEMANTIC_REVIEW_NOT_BOUND' });
  }
});

test('source or permission mutation during draft blocks the draft result', async () => {
  for (const next of [
    { scope: 'fictional-a', permitted: true, reports: ['corrected'] },
    { scope: 'fictional-a', permitted: false, reports: ['earlier', 'recent'] }
  ]) {
    const snapshots = adapter();
    const result = await run({ snapshotAdapter: snapshots, draft: async () => { snapshots.replace(next); return 'old'; } });
    assert.deepEqual(result, { allowed: false, reason: 'STALE_AFTER_DRAFT' });
  }
});

test('source or permission mutation during semantic review blocks approved prose', async () => {
  const snapshots = adapter();
  const result = await run({ snapshotAdapter: snapshots, semanticReview: async ctx => {
    snapshots.replace({ ...initial(), reports: ['corrected'] });
    return { approved: true, candidate: ctx.candidate, version: ctx.version, reviewBinding: ctx.reviewBinding };
  }});
  assert.deepEqual(result, { allowed: false, reason: 'STALE_AFTER_SEMANTIC_REVIEW' });
});

test('explicit controller invalidation during draft or review blocks older work', async () => {
  {
    const controller = createReflectionController();
    const result = await run({ controller, draft: async () => { controller.invalidate(); return 'old'; } });
    assert.deepEqual(result, { allowed: false, reason: 'STALE_AFTER_DRAFT' });
  }
  {
    const controller = createReflectionController();
    const result = await run({ controller, semanticReview: async ctx => {
      controller.invalidate();
      return { approved: true, candidate: ctx.candidate, version: ctx.version, reviewBinding: ctx.reviewBinding };
    }});
    assert.deepEqual(result, { allowed: false, reason: 'STALE_AFTER_SEMANTIC_REVIEW' });
  }
});

test('a newer run supersedes an older async draft without the old result erasing the new one', async () => {
  const controller = createReflectionController();
  const snapshots = adapter();
  let release;
  const oldDraft = () => new Promise(resolve => { release = resolve; });
  const oldRun = controller.run({ snapshotAdapter: snapshots, eligible, draft: oldDraft, semanticReview: approve });
  await new Promise(resolve => setImmediate(resolve));
  const newer = await controller.run({ snapshotAdapter: snapshots, eligible, draft, semanticReview: approve });
  release('old candidate');
  const older = await oldRun;
  assert.equal(newer.allowed, true);
  assert.deepEqual(older, { allowed: false, reason: 'STALE_AFTER_DRAFT' });
});

test('ineligible and throwing eligibility checks fail closed before drafting', async () => {
  let calls = 0;
  for (const check of [() => false, () => 'true', () => { throw new Error('private synthetic decoy'); }]) {
    const result = await run({ eligible: check, draft: async () => { calls += 1; return 'should not run'; } });
    assert.deepEqual(result, { allowed: false, reason: 'NOT_CURRENT_OR_ELIGIBLE' });
  }
  assert.equal(calls, 0);
});

test('draft and semantic-review failures do not expose draft text in denial result', async () => {
  assert.deepEqual(await run({ draft: async () => { throw new Error('synthetic text'); } }),
    { allowed: false, reason: 'DRAFT_FAILED' });
  const denied = await run({ semanticReview: async () => { throw new Error('synthetic draft details'); } });
  assert.deepEqual(denied, { allowed: false, reason: 'SEMANTIC_REVIEW_FAILED' });
  assert.equal(Object.hasOwn(denied, 'candidate'), false);
});

test('empty drafts cannot be semantically approved', async () => {
  for (const value of ['', '   ', null, {}, true]) {
    assert.deepEqual(await run({ draft: async () => value }), { allowed: false, reason: 'INVALID_DRAFT' });
  }
});

test('snapshot adapter freezes clones and invalidates old opaque versions without hashes', () => {
  const source = initial();
  const snapshots = createSyntheticSnapshotAdapter(source);
  const first = snapshots.capture();
  source.reports.push('mutated outside');
  assert.deepEqual(first.snapshot.reports, ['earlier', 'recent']);
  assert.ok(Object.isFrozen(first.snapshot) && Object.isFrozen(first.snapshot.reports));
  snapshots.replace({ ...initial(), reports: ['new'] });
  assert.equal(snapshots.isCurrent(first.version), false);
  assert.deepEqual(Reflect.ownKeys(first.version), []);
});

test('controller and synthetic adapter contain no model, network, persistence or hashing implementation', async () => {
  for (const file of ['./reflection-controller.mjs', './synthetic-snapshot.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^import |\b(?:fetch|createHash|localStorage|sessionStorage|indexedDB|setTimeout)\s*[.(]/m);
  }
});
