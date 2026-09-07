import test from 'node:test';
import assert from 'node:assert/strict';
import { DELIVERY_DIMENSIONS, assessOpportunityCost } from '../../src/case-formulation/delivery-system-assessment.mjs';
import { suitabilityChecks, hostChecks, highNeedSignals, practitionerQuestions, validateProgramAudit, assessFit, assessMethod, assessFinancialFit, assembleSupport } from './support-contract.mjs';

// Fictional programs and normalized financial units, with synthetic observations.
const fact = () => ({ status: 'PASS', evidenceRef: 'SYNTHETIC_SUPPORT_EVIDENCE', checkedAt: '2026-09-07', current: true });
const facts = keys => Object.fromEntries(keys.map(key => [key, fact()]));
const resources = () => ({ consentToIncome: false, monthlyIncome: null, monthlyDisposable: null, maxCommitment: 50 });
function profile() {
  return { version: 1, emergency: 'ABSENT', requiredFunctions: ['housing'], meaningfulActivity: { wanted: false, capacity: 'ABLE', groundingKinds: [], overwhelmingKinds: [] },
    highNeeds: Object.fromEntries(highNeedSignals.map(key => [key, { ...fact(), status: 'FAIL' }])), suitability: facts(suitabilityChecks), constraints: [], finances: resources() };
}
function delivery(overrides = {}) {
  const negative = ['premium_required_for_basic_safety', 'package_pressure', 'urgency_scarcity', 'unique_or_total_cure_claim', 'push_through_destabilization', 'independent_complaints_or_adverse_reports'];
  return { method_id: 'SYNTHETIC_METHOD', provider_id: 'SYNTHETIC_PROGRAM', observation_ids: ['SYNTHETIC_BINDING'],
    method: { benefit: 'OBSERVED_PARTIAL', durability: 'TEMPORARY', observation_ids: ['SYNTHETIC_BENEFIT'], basis: 'USER_REPORT', current: true },
    facts: DELIVERY_DIMENSIONS.map(dimension => ({ dimension, value: overrides[dimension] ?? (negative.includes(dimension) ? 'NO' : 'YES'), observation_ids: [`SYNTHETIC_${dimension}`], basis: 'DOCUMENTED_OFFER', current: true })), financial: null };
}
const highRiskDelivery = () => delivery({ ordinary_safety_support: 'NO', low_cost_safety_questions: 'NO', stop_criteria_accessible: 'NO', titration_guidance_accessible: 'NO', premium_required_for_basic_safety: 'YES', package_proportionate: 'NO' });
function program(assessment) {
  const result = { id: 'SYNTHETIC_PROGRAM', kind: 'SUPPORTED_PROGRAM', functions: facts(['housing']), compatibility: {}, host: facts(hostChecks), access: 'AVAILABLE', cost: { totalCommitment: 10, horizon: 'same_trial' }, workSafeguards: facts(['voluntary', 'safeLoad', 'titratable', 'careNotReplaced']) };
  if (assessment !== undefined) result.deliveryAssessment = assessment;
  return result;
}
const method = assessment => ({ benefitMagnitude: 'CLEAR', durability: 'BRIEF', doseResponse: 'MORE_IS_WORSE', adverseNow: false, adverseHistory: true, supervisionNeeded: true, supervisionAvailable: true, dailyFunction: 'FLAT', broaderNeeds: true, cureHypothesis: true, existingProtectiveStop: false, ...(assessment === undefined ? {} : { deliveryAssessment: assessment }) });
const offer = () => ({ totalCommitment: 10, disproportionateToResources: 'NO', redFlags: [], answers: facts(practitionerQuestions), independentFitQualityChecked: true, cheaperStagedAlternativesChecked: true, reversibleSmallPurchase: true });
const coordination = { responsibleNavigator: true, scheduleTransportCompatible: true, coverageConfirmed: true };

test('helpful method and excellent provider retain environment and method fit independently', () => {
  const fit = assessFit(profile(), program(delivery()));
  assert.equal(fit.outcome, 'FIT_TO_CONSIDER');
  assert.equal(fit.environmentFit.outcome, 'FIT_TO_CONSIDER');
  assert.equal(fit.deliveryStatus, 'TRUSTED_ENOUGH');
  const result = assessMethod(method(delivery()));
  assert.equal(result.benefitPreserved, 'CLEAR');
  assert.ok(result.actions.includes('KEEP_BUT_TITRATE'));
  assert.equal(result.deliveryAssessment.method.clinicalEfficacyEstablished, false);
});

test('optional overpriced coaching with accessible basic safeguards does not disqualify fit', () => {
  const fit = assessFit(profile(), program(delivery({ package_proportionate: 'NO' })));
  assert.equal(fit.outcome, 'FIT_TO_CONSIDER');
  assert.equal(fit.deliveryStatus, 'TRUSTED_ENOUGH');
  assert.ok(fit.deliveryAssessment.findings.some(f => f.code === 'PACKAGE_VALUE_CONCERN'));
});

test('high-risk safety paywall excludes a good environment without erasing partial method value', () => {
  const fit = assessFit(profile(), program(highRiskDelivery()));
  assert.equal(fit.outcome, 'NO_GOOD_MATCH');
  assert.equal(fit.environmentFit.outcome, 'FIT_TO_CONSIDER');
  assert.deepEqual(fit.reasons, ['HIGH_RISK_DELIVERY']);
  assert.equal(fit.deliveryAssessment.practitionerDecision, 'METHOD_OK_PROVIDER_NOT_OK');
  assert.equal(fit.deliveryAssessment.method.benefit, 'OBSERVED_PARTIAL');
  assert.equal(fit.deliveryAssessment.motive, 'NOT_INFERRED');
  const result = assessMethod(method(highRiskDelivery()));
  assert.ok(result.actions.includes('KEEP_BUT_TITRATE'));
  assert.ok(result.providerActions.includes('SEEK_ALTERNATIVE_SUPERVISION'));
  assert.equal(result.currentPractice, 'REASSESS_SAFE_LIMITS_WITH_HUMAN');
  assert.equal(result.benefitPreserved, 'CLEAR');
});

test('unsafe delivery cannot supply modular coverage even when the environment has every function', () => {
  for (const kind of ['ORDINARY_EXCHANGE', 'SUPPORTED_PROGRAM', 'MODULE']) {
    const module = { ...program(highRiskDelivery()), kind };
    const result = assembleSupport(profile(), [module], coordination);
    assert.equal(result.outcome, 'INCOMPLETE_MODULAR_PLAN');
    assert.deepEqual(result.accepted, []);
    assert.deepEqual(result.uncoveredFunctions, ['housing']);
    assert.deepEqual(result.rejected, [module.id]);
    assert.equal(result.programAssessments[0].environmentFit.outcome, 'FIT_TO_CONSIDER');
    assert.equal(result.programAssessments[0].deliveryStatus, 'HIGH_RISK_DELIVERY');
  }
});

test('push-through framing de-escalates practice and distrusts supervision while preserving benefit', () => {
  const result = assessMethod(method(delivery({ push_through_destabilization: 'YES' })));
  assert.equal(result.deliveryStatus, 'HIGH_RISK_DELIVERY');
  assert.ok(result.actions.includes('DE_ESCALATE'));
  assert.ok(result.providerActions.includes('SEEK_ALTERNATIVE_PROVIDER'));
  assert.equal(result.benefitPreserved, 'CLEAR');
});

test('current adverse response and protective stop override keep/titrate despite useful method', () => {
  for (const key of ['adverseNow', 'existingProtectiveStop']) {
    const result = assessMethod({ ...method(highRiskDelivery()), [key]: true });
    assert.equal(result.currentPractice, 'PAUSE_NOW_EXISTING_SAFETY_GATES');
    assert.ok(result.actions.includes('PAUSE_IF_ADVERSE'));
    assert.ok(!result.actions.includes('KEEP_BUT_TITRATE'));
    assert.equal(result.benefitPreserved, 'CLEAR');
    assert.ok(result.providerActions.includes('SEEK_ALTERNATIVE_SUPERVISION'));
  }
});

test('current concrete safety repair and affordable access can reduce delivery concern', () => {
  const before = assessFit(profile(), program(highRiskDelivery()));
  const repaired = delivery({ responds_with_titration: 'YES', lower_cost_options: 'YES', adverse_escalation_transparent: 'YES' });
  repaired.facts.forEach(f => { f.observation_ids = [`RECHECK_${f.dimension}`]; });
  const after = assessFit(profile(), program(repaired));
  assert.equal(before.deliveryStatus, 'HIGH_RISK_DELIVERY');
  assert.equal(after.deliveryStatus, 'TRUSTED_ENOUGH');
  assert.equal(after.outcome, 'FIT_TO_CONSIDER');
});

test('several months of consented income requires staging even if offer says affordable and reversible', () => {
  const finances = { consentToIncome: true, monthlyIncome: 100, monthlyDisposable: 50, maxCommitment: 500 };
  const candidate = { ...offer(), totalCommitment: 300 };
  const result = assessFinancialFit(finances, candidate);
  const shared = assessOpportunityCost(finances, candidate.totalCommitment);
  for (const key of Object.keys(shared)) assert.deepEqual(result[key], shared[key]);
  assert.equal(result.ratios.monthsOfIncome, 3);
  assert.equal(result.strongOpportunityCostWarning, true);
  assert.equal(result.stagedTrialRequired, true);
  assert.equal(result.outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
  assert.deepEqual(result.redFlags, []);
  assert.equal(result.treatmentChange, 'NO_ABRUPT_PRESCRIBED_TREATMENT_STOP');
});

test('financial consent withdrawal preserves unknown income and independent purchase checks', () => {
  const finances = { consentToIncome: false, monthlyIncome: null, monthlyDisposable: null, maxCommitment: null };
  const result = assessFinancialFit(finances, offer());
  assert.equal(result.ratios, null);
  assert.equal(result.affordability, 'UNKNOWN');
  assert.equal(result.strongOpportunityCostWarning, false);
  assert.equal(result.outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
  for (const key of ['independentFitQualityChecked', 'cheaperStagedAlternativesChecked', 'reversibleSmallPurchase']) {
    assert.equal(assessFinancialFit(resources(), { ...offer(), [key]: false }).outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
  }
});

test('total-cure marketing is rejected without erasing temporary anxiety benefit', () => {
  const result = assessMethod(method(delivery({ unique_or_total_cure_claim: 'YES' })));
  assert.equal(result.cureClaim, 'REJECT_UNSUPPORTED_TOTAL_CURE_CLAIM');
  assert.equal(result.benefitPreserved, 'CLEAR');
  assert.equal(result.deliveryAssessment.method.durability, 'TEMPORARY');
  assert.ok(result.actions.includes('COMBINE_WITH_OTHER_SUPPORTS'));
});

test('both ineffective method and high-risk delivery trigger method reassessment', () => {
  const assessment = highRiskDelivery(); assessment.method.benefit = 'NO_BENEFIT';
  const result = assessMethod({ ...method(assessment), benefitMagnitude: 'NONE' });
  assert.ok(result.actions.includes('REASSESS_OR_SWITCH_METHOD'));
  assert.ok(!result.actions.includes('KEEP_BUT_TITRATE'));
  assert.equal(result.benefitPreserved, 'NONE');
});

test('legacy absent assessment is clearly unassessed; explicit unknown and caution stay pending', () => {
  const absent = assessFit(profile(), program());
  assert.equal(absent.outcome, 'FIT_TO_CONSIDER');
  assert.equal(absent.deliveryStatus, 'UNASSESSED');
  assert.equal(absent.deliveryAssessment, null);
  const legacyAssembly = assembleSupport(profile(), [program()], coordination);
  assert.equal(legacyAssembly.programAssessments[0].deliveryStatus, 'UNASSESSED');
  assert.equal(assessMethod(method()).deliveryStatus, 'UNASSESSED');
  for (const value of ['UNKNOWN', 'NO']) {
    const candidate = program(delivery({ credentials_transparent: value }));
    const fit = assessFit(profile(), candidate);
    assert.equal(fit.outcome, 'VERIFICATION_PENDING');
    assert.equal(fit.environmentFit.outcome, 'FIT_TO_CONSIDER');
    assert.deepEqual(assembleSupport(profile(), [candidate], coordination).accepted, []);
  }
});

test('explicit invalid, duplicate or differently scoped delivery evidence cannot clear an audit', () => {
  const other = delivery(); other.provider_id = 'UNRELATED_PROGRAM';
  assert.throws(() => validateProgramAudit(program(other)), /provider_id must match/);
  assert.throws(() => assembleSupport(profile(), [program(other)], coordination), /provider_id must match/);
  for (const invalid of [null, {}, { ...delivery(), trustStatus: 'TRUSTED_ENOUGH' }]) {
    assert.throws(() => assessFit(profile(), program(invalid)), /Invalid candidate contract/);
    assert.throws(() => assessMethod(method(invalid)), /Invalid candidate contract/);
  }
  const duplicate = delivery(); duplicate.facts = [duplicate.facts[0], duplicate.facts[0]];
  assert.throws(() => assessFit(profile(), program(duplicate)), /must be unique/);
  assert.throws(() => assessMethod(method(duplicate)), /must be unique/);
});

test('current emergency routing remains prior to any environment or provider recommendation', () => {
  const p = { ...profile(), emergency: 'ACTIVE' };
  const fit = assessFit(p, program(highRiskDelivery()));
  assert.equal(fit.outcome, 'EXISTING_SAFETY_ROUTE');
  assert.equal(fit.environmentFit.outcome, 'NOT_ASSESSED_CURRENT_SAFETY');
  assert.equal(assembleSupport(p, [program(delivery())], coordination).outcome, 'EXISTING_SAFETY_ROUTE');
});

test('conflicting known method judgments cannot produce opposing recommendations', () => {
  assert.throws(() => assessMethod({ ...method(highRiskDelivery()), benefitMagnitude: 'NONE' }), /Conflicting known method benefit/);
  const a = highRiskDelivery(); a.method.benefit = 'NO_BENEFIT';
  assert.throws(() => assessMethod(method(a)), /Conflicting known method benefit/);
  const b = delivery(); b.method.durability = 'SUSTAINED';
  assert.throws(() => assessMethod(method(b)), /Conflicting known method durability/);
});
