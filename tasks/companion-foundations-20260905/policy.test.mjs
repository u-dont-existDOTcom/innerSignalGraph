import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationDecision, reflectionDecision, supportMode, stepBackDecision, DIMENSIONS } from './policy.mjs';

const invitation = overrides => ({ preference: 'welcome', requestedNow: false,
  relevant: true, alreadyOffered: false, safetyClear: true, ...overrides });
const observation = overrides => ({ id: 'early', scope: 'synthetic-local', episodeId: 'episode-a',
  period: 'earlier', dimension: 'vitality', source: 'user_report', status: 'active',
  assessment: 'supports', ...overrides });
const reflection = overrides => ({ scope: 'synthetic-local', preference: 'occasional',
  requestedNow: false, safetyClear: true, historyAllowed: true, alreadyReviewed: false,
  dimension: 'vitality', supportIds: ['early', 'recent'], counterIds: [],
  evidence: [observation({}), observation({ id: 'recent', episodeId: 'episode-b', period: 'recent' })],
  ...overrides });
const support = overrides => ({ safetyClear: true, wantsPractice: true, ready: true,
  needsConcreteHelp: false, alreadyAsked: false, ...overrides });
const stepping = overrides => ({ requestedNow: false, safetyClear: true,
  goalMetReported: true, workablePlanReported: true, wantsReview: true, ...overrides });

test('relevant, welcomed invitation is optional', () => {
  assert.equal(invitationDecision(invitation({})).reason, 'OPTIONAL_RELEVANT_INVITATION');
});
for (const preference of ['unset', 'user_initiated', 'do_not_suggest']) {
  test(`no unsolicited invitation under ${preference}`, () => {
    assert.equal(invitationDecision(invitation({ preference })).allowed, false);
  });
}
test('explicit current request does not mutate previous preference', () => {
  const input = invitation({ preference: 'do_not_suggest', requestedNow: true });
  assert.equal(invitationDecision(input).reason, 'CURRENT_REQUEST_ONLY');
  assert.equal(input.preference, 'do_not_suggest');
});
for (const overrides of [{ relevant: false }, { alreadyOffered: true }, { safetyClear: false }]) {
  test(`invitation constraint ${JSON.stringify(overrides)}`, () => {
    assert.equal(invitationDecision(invitation(overrides)).allowed, false);
  });
}
test('readiness or safety cannot be asserted with truthy strings', () => {
  assert.throws(() => invitationDecision(invitation({ safetyClear: 'true' })), TypeError);
});
test('adult capacity and child vitality are both represented without a healing score', () => {
  for (const dimension of ['care', 'protection', 'direction', 'vitality', 'connection']) {
    assert.ok(DIMENSIONS.includes(dimension));
  }
});
test('bounded comparison allows tentative language only', () => {
  assert.deepEqual(reflectionDecision(reflection({})), { allowed: true, reason: 'TENTATIVE_REFLECTION_ONLY' });
});
for (const overrides of [{ historyAllowed: false }, { preference: 'off' },
  { preference: 'on_request' }, { alreadyReviewed: true }, { safetyClear: false }]) {
  test(`reflection permission ${JSON.stringify(overrides)}`, () => {
    assert.equal(reflectionDecision(reflection(overrides)).allowed, false);
  });
}
test('explicit review can revisit a previously reviewed comparison', () => {
  assert.equal(reflectionDecision(reflection({ preference: 'on_request', requestedNow: true,
    alreadyReviewed: true })).allowed, true);
});
test('revoked, corrected and inferred material cannot become reported progress', () => {
  for (const change of [{ status: 'revoked' }, { status: 'corrected' }, { source: 'assistant_inference' }]) {
    const input = reflection({});
    Object.assign(input.evidence[1], change);
    assert.equal(reflectionDecision(input).reason, 'REFERENCE_NOT_CURRENT_REPORTED_EVIDENCE');
  }
});
test('missing, cross-user and wrong-dimension references fail closed', () => {
  assert.equal(reflectionDecision(reflection({ supportIds: ['early', 'missing'] })).allowed, false);
  for (const change of [{ scope: 'other-local' }, { dimension: 'care' }]) {
    const input = reflection({});
    Object.assign(input.evidence[1], change);
    assert.equal(reflectionDecision(input).allowed, false);
  }
});
test('the same event retold twice does not establish longitudinal improvement', () => {
  const input = reflection({});
  input.evidence[1].episodeId = 'episode-a';
  assert.equal(reflectionDecision(input).reason, 'DISTINCT_EARLIER_AND_RECENT_EPISODES_REQUIRED');
});
test('a comparison requires earlier and recent evidence', () => {
  const input = reflection({});
  input.evidence[1].period = 'earlier';
  assert.equal(reflectionDecision(input).allowed, false);
});
test('complicating or unclear evidence cannot be silently omitted', () => {
  for (const assessment of ['complicates', 'unclear']) {
    const input = reflection({});
    input.evidence.push(observation({ id: 'mixed', episodeId: 'episode-c', period: 'recent', assessment }));
    assert.equal(reflectionDecision(input).reason, 'COMPLICATING_EVIDENCE_MUST_BE_INCLUDED');
    input.counterIds = ['mixed'];
    assert.equal(reflectionDecision(input).reason, 'TENTATIVE_MIXED_REFLECTION_ONLY');
  }
});
test('references cannot be duplicated or placed on both sides', () => {
  assert.throws(() => reflectionDecision(reflection({ supportIds: ['early', 'early'] })), TypeError);
  assert.throws(() => reflectionDecision(reflection({ counterIds: ['early'] })), TypeError);
  const input = reflection({});
  input.evidence.push(observation({}));
  assert.throws(() => reflectionDecision(input), TypeError);
});
test('the evidence gate does not modify input history', () => {
  const input = reflection({});
  const before = structuredClone(input);
  reflectionDecision(input);
  assert.deepEqual(input, before);
});
test('optional self-guidance never withholds requested concrete help', () => {
  assert.equal(supportMode(support({})), 'ONE_OPTIONAL_SELF_GUIDANCE_QUESTION');
  for (const overrides of [{ wantsPractice: false }, { ready: false },
    { needsConcreteHelp: true }, { alreadyAsked: true }]) {
    assert.equal(supportMode(support(overrides)), 'DIRECT_SUPPORT');
  }
  assert.equal(supportMode(support({ safetyClear: false })), 'EXISTING_SAFETY_SUPPORT');
});
test('stepping back is possible without modality or spiritual prerequisites', () => {
  assert.equal(stepBackDecision(stepping({})).suggest, true);
  assert.throws(() => stepBackDecision(stepping({ innerChildCompleted: false })), TypeError);
  assert.throws(() => stepBackDecision(stepping({ spiritualConnection: false })), TypeError);
});
test('exiting the app does not require completed goals or a healing certificate', () => {
  for (const safetyClear of [true, false]) {
    const answer = stepBackDecision(stepping({ requestedNow: true, safetyClear,
      goalMetReported: false, workablePlanReported: false, wantsReview: false }));
    assert.equal(answer.mayLeave, true);
    assert.equal(answer.suggest, false);
  }
});
test('the app cannot manufacture a graduation or retention judgment', () => {
  for (const overrides of [{ goalMetReported: false }, { workablePlanReported: false },
    { wantsReview: false }, { safetyClear: false }]) {
    assert.equal(stepBackDecision(stepping(overrides)).suggest, false);
    assert.equal(stepBackDecision(stepping(overrides)).mayLeave, true);
  }
});

test('owner ledger separates approved direction from deployment and unresolved choices', async () => {
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('./OWNER-DECISIONS.json', import.meta.url), 'utf8'));
  assert.equal(data.directionApproved, true);
  assert.equal(data.prototypeStatus, 'OFFLINE_ONLY_NOT_IMPORTED_BY_APP');
  assert.equal(new Set(data.approvedPrinciples.map(item => item.id)).size, data.approvedPrinciples.length);
  assert.ok(data.provisionalImplementationChoices.length > 0);
  assert.ok(data.notAuthorizedByThisSlice.includes('real history storage'));
  assert.ok(data.notAuthorizedByThisSlice.includes('stable promotion'));
});
test('semantic fixtures are explicitly synthetic and not falsely reported as evaluated', async () => {
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('./behavior-cases.json', import.meta.url), 'utf8'));
  assert.equal(data.status, 'SYNTHETIC_UNEVALUATED');
  assert.equal(data.modelRuns, 0);
  assert.equal(new Set(data.cases.map(item => item.id)).size, data.cases.length);
  assert.equal(data.cases.length, 16);
  for (const item of data.cases) {
    assert.ok(item.syntheticTurns.length > 0 && item.must.length > 0 && item.mustNot.length > 0);
  }
});
