import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeRomanceContext, validateRomanceSources } from '../tasks/romance-guide-20260907/context.mjs';

const source = () => JSON.parse(readFileSync(new URL('../tasks/romance-guide-20260907/SOURCE.json', import.meta.url)));
const policy = () => JSON.parse(readFileSync(new URL('../tasks/romance-guide-20260907/SUPPLEMENT.json', import.meta.url)));
const linkConfirmation = () => JSON.parse(readFileSync(new URL('../tasks/romance-guide-20260907/OWNER-LINK-CONFIRMATION.json', import.meta.url)));
function plan(id = 'IC.DEEP_CHILD_DIALOGUE', tier = 4) {
  return { contractVersion: 'case-plan-v5', primaryJob: { id, title: 'Synthetic test', tier },
    variables: { present_safety: 'safe', orientation: 'oriented', dissociation: 'low', altered_state: 'sober' },
    requiredNuance: ['Keep existing context'], forbiddenOverclaims: ['Keep existing prohibition'],
    nextQuestion: '', questionContract: { mode: 'none', question: '', source: null },
    executionContract: { version: 1, requiredNodeIds: [id], task: null },
    blockedNodes: [{ id: 'SOM.ADVANCED_RELEASE_OPTIONAL' }], deferredNodes: [] };
}
const enabled = extra => ({ enabled: true, topic: 'compatibility', audience: 'adult', stage: 'considering', ...extra });

test('candidate source has twenty bound excerpts, twelve rules, and owner-confirmed optional reference', () => {
  assert.deepEqual(validateRomanceSources(), { sourceId: 'owner-romance-2026-08-27',
    supplementId: 'romance-2026-08-27-supplement-v1', excerpts: 20, rules: 12,
    optionalReference: { url: 'https://romance.u-dont-exist.com', reachability: 'owner-confirmed' } });
});
test('changed source wording fails integrity validation', () => {
  const s = source(); s.excerpts[0].quote += ' Altered wording.';
  assert.throws(() => validateRomanceSources(s, policy(), linkConfirmation()), /excerpt/);
});
test('changed page attribution fails even when quote is untouched', () => {
  const s = source(); s.excerpts[0].page = 11;
  assert.throws(() => validateRomanceSources(s, policy(), linkConfirmation()), /excerpt/);
});
test('changed behavioral policy fails its separate integrity binding', () => {
  const p = policy(); p.rules[0].guidance = 'Automatically approve romance.';
  assert.throws(() => validateRomanceSources(source(), p, linkConfirmation()), /provenance/);
});
test('source identity cannot silently drift to a different uploaded PDF', () => {
  const s = source(); s.pdfSha256 = '0'.repeat(64);
  assert.throws(() => validateRomanceSources(s, policy(), linkConfirmation()), /contract/);
});
test('unbound source references and changed URLs are rejected', () => {
  const p = policy(); p.rules[0].excerptIds = ['not-a-source'];
  assert.throws(() => validateRomanceSources(source(), p, linkConfirmation()), /provenance/);
  const q = policy(); q.linkPolicy.url += '?case=synthetic';
  assert.throws(() => validateRomanceSources(source(), q, linkConfirmation()), /contract/);
});
test('owner-confirmed URL evidence is bound separately and cannot silently change', () => {
  const l = linkConfirmation(); l.url += '/different';
  assert.throws(() => validateRomanceSources(source(), policy(), l), /contract/);
  const q = linkConfirmation(); q.ownerConfirmedReachability = false;
  assert.throws(() => validateRomanceSources(source(), policy(), q), /contract/);
});
test('default remains disabled and leaves installed behavior untouched', () => {
  const p = plan(); const result = composeRomanceContext(p);
  assert.equal(result.status, 'DISABLED'); assert.equal(result.plan, p); assert.equal(result.reference, null);
});
test('unrelated conversation gets no romance content or promotion', () => {
  const p = plan(); const result = composeRomanceContext(p, enabled({ topic: 'none', interest: 'requested' }));
  assert.equal(result.plan, p); assert.deepEqual(result.ruleIds, []); assert.equal(result.reference, null);
});
test('legacy plan requires explicit integration rather than silent injection', () => {
  const p = plan(); p.contractVersion = 'case-plan-v4';
  const result = composeRomanceContext(p, enabled());
  assert.equal(result.canRealize, false); assert.equal(result.action, 'UNSUPPORTED_PLAN_CONTRACT');
});
test('caller input fails closed rather than becoming private case storage', () => {
  assert.throws(() => composeRomanceContext(plan(), enabled({ unrecognized: 'not accepted' })), /Unknown/);
  assert.throws(() => composeRomanceContext(plan(), enabled({ readiness: 'diagnosis-proves-unready' })), /Invalid/);
  assert.throws(() => composeRomanceContext(plan(), enabled({ enabled: 'true' })), /boolean/);
});
test('annotation preserves primary, question, consent and blocked nodes without mutation', () => {
  const p = plan(); const before = structuredClone(p);
  const result = composeRomanceContext(p, enabled());
  assert.deepEqual(p, before);
  for (const field of ['primaryJob', 'questionContract', 'nextQuestion', 'executionContract', 'blockedNodes', 'deferredNodes']) {
    assert.deepEqual(result.plan[field], before[field]);
  }
  assert.deepEqual(result.ruleIds, ['RG02', 'RG03', 'RG04']);
  assert.ok(result.sourceRefs.every(ref => Number.isInteger(ref.page) && ref.quoteSha256.length === 64));
  assert.equal(result.provesReadiness, false); assert.equal(result.provesBenefit, false);
});
test('an evidenced pause requires a materially different route before realizing inward advice', () => {
  const result = composeRomanceContext(plan(), enabled({ readiness: 'pause' }));
  assert.equal(result.action, 'REPLAN_FOR_STABILIZATION'); assert.equal(result.canRealize, false);
  assert.deepEqual(result.ruleIds, ['RG01', 'RG06']); assert.equal(result.reference, null);
});
test('external action can carry pause plus support without prescribing isolation', () => {
  const result = composeRomanceContext(plan('ROUTE.ACT_OUTWARD'), enabled({ readiness: 'pause' }));
  assert.equal(result.action, 'PAUSE_ROMANTIC_ESCALATION'); assert.equal(result.canRealize, true);
  assert.match(result.plan.requiredNuance.join(' '), /non-romantic support/);
  assert.match(result.plan.requiredNuance.join(' '), /No forced disclosure or social isolation/);
});
test('a currently stable control is not paused just for loneliness or past illness', () => {
  const result = composeRomanceContext(plan(), enabled({ readiness: 'no-pause-indicated', topic: 'readiness' }));
  assert.equal(result.action, 'ADD_TASK_SCOPED_CONTEXT'); assert.equal(result.canRealize, true);
  assert.equal(result.provesReadiness, false);
});
test('unknown readiness is not converted to either a ban or a clearance', () => {
  const result = composeRomanceContext(plan(), enabled({ topic: 'readiness' }));
  assert.equal(result.readiness, 'unassessed'); assert.equal(result.action, 'ADD_TASK_SCOPED_CONTEXT');
  assert.equal(result.provesReadiness, false);
});
test('a reassessed pause is reversible; the adapter does not store a permanent label', () => {
  const p = plan();
  assert.equal(composeRomanceContext(p, enabled({ readiness: 'pause' })).canRealize, false);
  assert.equal(composeRomanceContext(p, enabled({ readiness: 'no-pause-indicated' })).canRealize, true);
});
test('new-dating caution does not become an automatic existing-relationship breakup order', () => {
  const result = composeRomanceContext(plan(), enabled({ stage: 'existing', readiness: 'pause', topic: 'dependency' }));
  assert.equal(result.existingRelationshipPauseIsNotBreakupOrder, true);
  assert.ok(result.ruleIds.includes('RG12')); assert.equal(result.action, 'ADD_TASK_SCOPED_CONTEXT');
});
test('safety-primary plan bypasses romance and reading even when requested', () => {
  const p = plan('IC.SAFETY', 1);
  const result = composeRomanceContext(p, enabled({ topic: 'spiritual-romance', interest: 'requested' }));
  assert.equal(result.action, 'PRESERVE_SAFETY'); assert.equal(result.plan, p);
  assert.deepEqual(result.ruleIds, []); assert.equal(result.referenceDecision, 'SAFETY_FIRST');
});
test('unsafe variables on an inconsistent inward plan require safety replanning', () => {
  const p = plan(); p.variables.suicidal_state = 'intent';
  const result = composeRomanceContext(p, enabled());
  assert.equal(result.canRealize, false); assert.equal(result.action, 'REPLAN_FOR_SAFETY');
});
test('destabilization cannot be overridden by a reassuring readiness directive', () => {
  const p = plan(); p.variables.dissociation = 'high';
  const result = composeRomanceContext(p, enabled({ readiness: 'no-pause-indicated', interest: 'requested' }));
  assert.equal(result.action, 'REPLAN_FOR_STABILIZATION'); assert.equal(result.canRealize, false);
  assert.equal(result.referenceDecision, 'STABILIZATION_FIRST');
});
test('stabilization primary is preserved without deeper optional content', () => {
  const result = composeRomanceContext(plan('ROUTE.EXTERNAL_EMBODIMENT'), enabled({ topic: 'spiritual-romance' }));
  assert.equal(result.action, 'PRESERVE_STABILIZATION'); assert.equal(result.canRealize, true);
  assert.deepEqual(result.ruleIds, ['RG01', 'RG06']); assert.equal(result.reference, null);
});
test('leave-alone and completed task cannot be reopened by the guide', () => {
  for (const p of [plan('ROUTE.LEAVE_ALONE'), { ...plan(), executionContract: { task: { phase: 'close' } } }]) {
    const result = composeRomanceContext(p, enabled({ topic: 'progress', interest: 'requested' }));
    assert.equal(result.action, 'PRESERVE_CLOSE'); assert.equal(result.plan, p); assert.equal(result.reference, null);
  }
});
test('ordinary progress, source insight and state relief are not conflated', () => {
  const result = composeRomanceContext(plan(), enabled({ topic: 'progress', stage: 'existing' }));
  assert.deepEqual(result.ruleIds, ['RG11']);
  assert.match(result.progressChecks[0].criterion, /Relief plus worsening dependency/);
  assert.equal(result.provesBenefit, false);
});
test('support-building includes a discriminating goal-substitution check, not mind-reading', () => {
  const result = composeRomanceContext(plan(), enabled({ topic: 'community' }));
  assert.match(result.progressChecks[0].criterion, /no romantic opportunity/);
  assert.match(result.plan.requiredNuance.join(' '), /Do not infer hidden romantic motives/);
});
test('optional philosophical content is bounded and can point to the owner-confirmed guide', () => {
  const result = composeRomanceContext(plan(), enabled({ topic: 'polarity', outsideCurrentTask: true }));
  assert.match(result.optionalTopicBoundary, /Do not install gender generalizations/);
  assert.equal(result.referenceDecision, 'OFFER_OPTIONAL_REFERENCE');
  assert.equal(result.reference.reachabilityEvidence, 'owner-confirmed');
  const reference = new URL(result.reference.url);
  const displayedHost = result.reference.text.match(/guide is at (\S+)\.$/)?.[1];
  assert.equal(reference.href, 'https://romance.u-dont-exist.com/');
  assert.equal(new URL(`https://${displayedHost}`).href, reference.href);
});
test('romance relevance alone does not turn the guide into an automatic footer', () => {
  const result = composeRomanceContext(plan(), enabled({ topic: 'polarity' }));
  assert.equal(result.referenceDecision, 'NOT_REQUESTED');
  assert.equal(result.reference, null);
});
test('full adult guide is not surfaced for minors or an unknown-age audience', () => {
  for (const audience of ['minor', 'unknown']) {
    const result = composeRomanceContext(plan(), enabled({ audience, interest: 'requested' }));
    assert.equal(result.referenceDecision, 'ADULT_GUIDE_BOUNDARY'); assert.equal(result.reference, null);
  }
});
test('decline and lack of renewed interest suppress repeated guide offers', () => {
  assert.equal(composeRomanceContext(plan(), enabled({ topic: 'polarity', interest: 'declined' })).referenceDecision, 'DECLINED');
  assert.equal(composeRomanceContext(plan(), enabled({ topic: 'polarity', alreadyOffered: true })).referenceDecision, 'ALREADY_OFFERED');
});
test('no link bypass for unsafe or medical practice requests', () => {
  for (const topic of ['medical-practice', 'unsafe-practice']) {
    const result = composeRomanceContext(plan(), enabled({ topic, interest: 'requested' }));
    assert.equal(result.canRealize, false); assert.equal(result.referenceDecision, 'NO_REFERENCE_BYPASS');
    assert.equal(result.reference, null);
  }
});
test('an appropriate primary route can answer a medical or unsafe-practice request directly without the guide', () => {
  for (const topic of ['medical-practice', 'unsafe-practice']) {
    const result = composeRomanceContext(plan('ROUTE.ACT_OUTWARD', 3), enabled({ topic, interest: 'requested' }));
    assert.equal(result.canRealize, true); assert.equal(result.action, 'PRESERVE_APPROPRIATE_PRIMARY_ROUTE');
    assert.equal(result.referenceDecision, 'NO_REFERENCE_BYPASS'); assert.equal(result.reference, null);
  }
});
test('owner confirmation enables the optional reference without being misreported as independent verification', () => {
  assert.equal(source().canonicalUrl, 'https://romance.u-dont-exist.com');
  assert.equal(policy().linkPolicy.ownerConfirmedReachability, true);
  assert.equal(policy().linkPolicy.independentReachabilityVerified, false);
  assert.equal(linkConfirmation().ownerConfirmedReachability, true);
  const result = composeRomanceContext(plan(), enabled({ interest: 'requested' }));
  assert.equal(result.referenceDecision, 'OFFER_OPTIONAL_REFERENCE');
  assert.equal(result.reference.reachabilityEvidence, 'owner-confirmed');
});
