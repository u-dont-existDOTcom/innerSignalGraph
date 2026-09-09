import test from 'node:test';
import assert from 'node:assert/strict';
import { suitabilityChecks, hostChecks, highNeedSignals, practitionerQuestions, trialStages, validateSupportProfile, assessOrdinaryPlacement, assessFit, planTrial, recordTrialOutcome, assessFinancialFit, assessMethod, assembleSupport, peerSupportActions } from './support-contract.mjs';

// Entirely fictional evidence IDs and normalized money units, not private-derived values.
const fact = (status = 'PASS', current = true) => ({ status, evidenceRef: 'SYNTHETIC_ASSESSMENT', checkedAt: '2026-09-07', current });
const facts = (keys, value = 'PASS') => Object.fromEntries(keys.map(key => [key, fact(value)]));
function profile() {
  return { version: 1, emergency: 'ABSENT', requiredFunctions: ['housing'],
    meaningfulActivity: { wanted: true, capacity: 'LIMITED', groundingKinds: ['gardening', 'repair'], overwhelmingKinds: ['heavy_lifting'] },
    highNeeds: facts(highNeedSignals, 'FAIL'), suitability: facts(suitabilityChecks),
    constraints: [
      { id: 'outdoors', kind: 'NATURE', requirement: 'Daily accessible nature', hard: true, authority: 'USER' },
      { id: 'environment', kind: 'ALLERGY_ASTHMA_MOLD_ANIMAL', requirement: 'Compatible breathing environment', hard: true, authority: 'USER' },
      { id: 'philosophy', kind: 'MEDICATION_PHILOSOPHY', requirement: 'Least-use shared decisions', hard: true, authority: 'OWNER_AND_USER' }
    ], finances: { consentToIncome: false, monthlyIncome: null, monthlyDisposable: null, maxCommitment: 50 } };
}
function program() {
  return { id: 'FICTIONAL_PROGRAM', kind: 'ORDINARY_EXCHANGE', functions: facts(['housing', 'meaningful_activity']), compatibility: facts(['outdoors', 'environment', 'philosophy']), host: facts(hostChecks), access: 'AVAILABLE', cost: { totalCommitment: 10, horizon: 'same_trial_period' }, workSafeguards: facts(['voluntary', 'safeLoad', 'titratable', 'careNotReplaced']) };
}
const trial = () => ({ completed: [], consent: true, exposure: 'UNKNOWN', safeExit: true, supportCovered: true, previousOutcome: 'NOT_STARTED', skippedStageRequested: false, largeUpfrontRequired: false });
const method = () => ({ benefitMagnitude: 'CLEAR', durability: 'BRIEF', doseResponse: 'MORE_IS_WORSE', adverseNow: false, adverseHistory: true, supervisionNeeded: true, supervisionAvailable: false, dailyFunction: 'FLAT', broaderNeeds: true, cureHypothesis: true, existingProtectiveStop: false });
const offer = () => ({ totalCommitment: 10, disproportionateToResources: 'NO', redFlags: [], answers: facts(practitionerQuestions), independentFitQualityChecked: true, cheaperStagedAlternativesChecked: true, reversibleSmallPurchase: true });

test('stable lower-need person may consider vetted ordinary work exchange', () => {
  assert.equal(assessOrdinaryPlacement(profile(), program()).outcome, 'SUITABLE_TO_CONSIDER');
  assert.equal(assessFit(profile(), program()).outcome, 'FIT_TO_CONSIDER');
});
for (const key of highNeedSignals) test(`current ${key} cannot be replaced by ordinary exchange`, () => {
  const p = profile(); p.highNeeds[key] = fact();
  assert.equal(assessOrdinaryPlacement(p, program()).outcome, 'UNSUITABLE_ORDINARY_PLACEMENT');
  assert.equal(assessFit(p, program()).outcome, 'NO_GOOD_MATCH');
});
for (const key of suitabilityChecks) test(`ordinary suitability requires ${key}`, () => {
  const p = profile(); p.suitability[key] = fact('UNKNOWN');
  assert.equal(assessFit(p, program()).outcome, 'VERIFICATION_PENDING');
  p.suitability[key] = fact('FAIL');
  assert.equal(assessFit(p, program()).outcome, 'NO_GOOD_MATCH');
});
test('every host dimension must be current and checked', () => {
  for (const key of hostChecks) {
    const a = program(); a.host[key] = fact('PASS', false);
    assert.equal(assessFit(profile(), a).outcome, 'VERIFICATION_PENDING', key);
  }
});
test('supervised employment is not subject to ordinary-exchange readiness exclusion', () => {
  const p = profile(); p.highNeeds.activeSubstanceRisk = fact();
  const a = program(); a.kind = 'SUPPORTED_PROGRAM';
  assert.equal(assessOrdinaryPlacement(p, a).outcome, 'NOT_APPLICABLE');
  assert.equal(assessFit(p, a).outcome, 'FIT_TO_CONSIDER');
});
test('stale high-need absence is unknown and cannot clear suitability', () => {
  const p = profile(); p.highNeeds.activeDissociationRisk = fact('FAIL', false);
  assert.equal(assessFit(p, program()).outcome, 'VERIFICATION_PENDING');
});
test('meaningful activity is required for wanted capable contribution, but not compulsory for care', () => {
  const p = profile(), a = program(); delete a.functions.meaningful_activity;
  assert.deepEqual(assessFit(p, a).uncoveredFunctions, ['meaningful_activity']);
  p.meaningfulActivity.capacity = 'UNABLE';
  assert.equal(assessFit(p, a).outcome, 'FIT_TO_CONSIDER');
  p.meaningfulActivity.capacity = 'ABLE'; p.meaningfulActivity.wanted = false;
  assert.equal(assessFit(p, a).outcome, 'FIT_TO_CONSIDER');
});
test('wanted contribution with unknown capacity remains an interview question', () => {
  const p = profile(); p.meaningfulActivity.capacity = 'UNKNOWN';
  assert.equal(assessFit(p, program()).outcome, 'VERIFICATION_PENDING');
});
test('work with coercion, unsafe load, fixed intensity or replacement of care cannot pass', () => {
  for (const key of ['voluntary', 'safeLoad', 'titratable', 'careNotReplaced']) {
    const a = program(); a.workSafeguards[key] = fact('FAIL');
    assert.equal(assessFit(profile(), a).outcome, 'NO_GOOD_MATCH', key);
  }
});
test('ordinary exchange workload safeguards cannot disappear with the activity label', () => {
  const p = profile(); p.meaningfulActivity.wanted = false;
  const a = program(); delete a.functions.meaningful_activity; a.workSafeguards.voluntary = fact('FAIL');
  assert.equal(assessFit(p, a).outcome, 'NO_GOOD_MATCH');
});
test('duplicate constraint IDs cannot launder unrelated hard requirements into one fact', () => {
  const p = profile(); p.constraints[1].id = p.constraints[0].id;
  assert.throws(() => assessFit(p, program()), /Duplicate constraint ID/);
});
test('hard nature and medication preferences remain hard despite other fit', () => {
  const a = program(); a.compatibility.outdoors = fact('FAIL');
  assert.equal(assessFit(profile(), a).outcome, 'NO_GOOD_MATCH');
  a.compatibility.outdoors = fact(); a.compatibility.philosophy = fact('FAIL');
  assert.deepEqual(assessFit(profile(), a).reasons, ['PHILOSOPHY_MISMATCH']);
});
test('unknown, expired and incompatible allergen evidence are not approval', () => {
  const a = program(); delete a.compatibility.environment;
  assert.equal(assessFit(profile(), a).outcome, 'VERIFICATION_PENDING');
  a.compatibility.environment = fact('PASS', false);
  assert.equal(assessFit(profile(), a).outcome, 'VERIFICATION_PENDING');
  a.compatibility.environment = fact('FAIL');
  assert.deepEqual(assessFit(profile(), a).reasons, ['ALLERGY/ENVIRONMENT_MISMATCH']);
});
test('multiple scarcity reasons survive instead of returning an unsuitable cheap option', () => {
  const p = profile(), a = program(); a.access = 'WAITLISTED'; a.cost.totalCommitment = 100; a.compatibility.philosophy = fact('FAIL');
  assert.deepEqual(assessFit(p, a).reasons.sort(), ['PHILOSOPHY_MISMATCH', 'TOO_EXPENSIVE', 'WAITLISTED']);
  a.access = 'ACCESS_BLOCKED'; assert.ok(assessFit(p, a).reasons.includes('ACCESS_BLOCKED'));
  p.constraints.push({ id: 'travel', kind: 'GEOGRAPHY_LEGAL', requirement: 'Reachable legally', hard: true, authority: 'USER' });
  a.compatibility.travel = fact('FAIL'); assert.ok(assessFit(p, a).reasons.includes('GEOGRAPHIC_MISMATCH'));
});
test('current safety takes precedence over fitting services', () => {
  const p = profile(); p.emergency = 'ACTIVE';
  assert.equal(assessFit(p, program()).outcome, 'EXISTING_SAFETY_ROUTE');
  p.emergency = 'UNKNOWN'; assert.equal(assessFit(p, program()).outcome, 'VERIFICATION_PENDING');
});
test('trial begins remotely with no physical exposure clearance assumed', () => {
  assert.deepEqual(planTrial(trial()), { outcome: 'NEXT_STAGE_TO_AGREE', next: 'REMOTE_INTERVIEW_VIDEO' });
  const t = trial(); t.completed = [trialStages[0]]; t.previousOutcome = 'TOLERATED';
  assert.equal(planTrial(t).next, 'ENVIRONMENT_QUESTIONNAIRE');
});
test('unknown or unsafe exposure cannot advance to a visit', () => {
  for (const exposure of ['UNKNOWN', 'UNSAFE']) {
    const t = trial(); Object.assign(t, { completed: trialStages.slice(0, 2), previousOutcome: 'TOLERATED', exposure });
    assert.equal(planTrial(t).outcome, 'DO_NOT_START_EXPOSURE');
  }
});
test('trial stages require safe exit, adequate support and reviewed outcomes', () => {
  const t = trial(); Object.assign(t, { completed: trialStages.slice(0, 2), previousOutcome: 'TOLERATED', exposure: 'CLEARED_FOR_NEXT_STAGE' });
  assert.equal(planTrial(t).next, 'DAY_VISIT');
  for (const key of ['safeExit', 'supportCovered']) assert.equal(planTrial({ ...t, [key]: false }).outcome, 'DO_NOT_START_EXPOSURE');
  assert.equal(planTrial({ ...t, previousOutcome: 'UNKNOWN' }).outcome, 'REVIEW_PREVIOUS_STAGE');
  assert.equal(planTrial({ ...t, previousOutcome: 'ADVERSE' }).outcome, 'STOP_AND_REVISE_FIT');
});
test('consent, skip requests and large upfront costs cannot silently advance trials', () => {
  assert.equal(planTrial({ ...trial(), consent: false }).outcome, 'CONSENT_PAUSED');
  assert.equal(planTrial({ ...trial(), completed: ['DAY_VISIT'] }).outcome, 'REVIEW_ALTERNATIVE_SEQUENCE');
  assert.equal(planTrial({ ...trial(), skippedStageRequested: true }).outcome, 'REVIEW_ALTERNATIVE_SEQUENCE');
  assert.equal(planTrial({ ...trial(), largeUpfrontRequired: true }).outcome, 'REVIEW_REVERSIBLE_ALTERNATIVES');
});
test('allergy, mold and cultural fit failure revise environment rather than blame the person', () => {
  for (const reason of ['ALLERGY', 'MOLD', 'ANIMALS', 'PERSONALITY_CULTURE', 'WORKLOAD']) {
    const r = recordTrialOutcome(reason);
    assert.equal(r.attribution, 'FIT_EVIDENCE_NOT_CLIENT_FAILURE'); assert.ok(r.actions.includes('REDISCOVER'));
  }
});
test('financial schema rejects storing income without consent and after withdrawal', () => {
  const p = profile(); p.finances.monthlyIncome = 100;
  assert.throws(() => validateSupportProfile(p), /Invalid candidate contract/);
  p.finances.consentToIncome = true; assert.equal(validateSupportProfile(p), true);
  p.finances.consentToIncome = false; p.finances.monthlyIncome = null;
  assert.equal(assessFinancialFit(p.finances, offer()).ratios, null);
});
test('normalized income ratio exposes opportunity cost without a moral verdict', () => {
  const f = { consentToIncome: true, monthlyIncome: 100, monthlyDisposable: 10, maxCommitment: 20 };
  const o = { ...offer(), totalCommitment: 400, disproportionateToResources: 'YES' };
  const r = assessFinancialFit(f, o);
  assert.equal(r.ratios.monthsOfIncome, 4); assert.equal(r.ratios.fractionOfAnnualIncome, 1 / 3);
  assert.equal(r.disposableMonths, 40); assert.equal(r.affordability, 'TOO_EXPENSIVE');
  assert.equal(r.outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES'); assert.deepEqual(r.redFlags, []);
  assert.equal(r.treatmentChange, 'NO_ABRUPT_PRESCRIBED_TREATMENT_STOP');
});
test('zero income never creates an infinite ratio; declined budget remains unknown', () => {
  const p = profile(); p.finances.consentToIncome = true; p.finances.monthlyIncome = 0;
  assert.equal(assessFinancialFit(p.finances, offer()).ratios, null);
  p.finances.maxCommitment = null;
  assert.equal(assessFinancialFit(p.finances, offer()).affordability, 'UNKNOWN');
});
test('zero-cost support does not require income or a financial ceiling', () => {
  const p = profile(); p.finances.maxCommitment = null;
  const a = program(); a.cost.totalCommitment = 0;
  assert.equal(assessFit(p, a).outcome, 'FIT_TO_CONSIDER');
  assert.equal(assessFinancialFit(p.finances, { ...offer(), totalCommitment: 0 }).affordability, 'WITHIN_USER_CAP');
});
test('high cost alone is not poor care and transparent affordable small option remains consider-able', () => {
  const p = profile(), o = offer(); p.finances.maxCommitment = 1000; o.totalCommitment = 500;
  const r = assessFinancialFit(p.finances, o); assert.deepEqual(r.redFlags, []);
  assert.equal(r.outcome, 'SMALL_REVERSIBLE_OPTION_TO_CONSIDER');
});
test('all practitioner questions, independent review and smaller alternatives matter', () => {
  for (const key of practitionerQuestions) {
    const o = offer(); o.answers[key] = fact('UNKNOWN');
    const r = assessFinancialFit(profile().finances, o); assert.ok(r.questions.includes(key));
    assert.equal(r.outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
  }
  for (const key of ['independentFitQualityChecked', 'cheaperStagedAlternativesChecked', 'reversibleSmallPurchase']) assert.equal(assessFinancialFit(profile().finances, { ...offer(), [key]: false }).outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
  assert.equal(assessFinancialFit(profile().finances, { ...offer(), redFlags: ['UNIQUE_CURE'] }).outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
});
test('helpful method with adverse dose pattern remains a partial tool', () => {
  const r = assessMethod(method());
  assert.deepEqual(r.actions, ['KEEP_BUT_TITRATE', 'REDUCE_DOSE', 'SEEK_SUPERVISION', 'COMBINE_WITH_OTHER_SUPPORTS']);
  assert.equal(r.benefitPreserved, 'CLEAR'); assert.equal(r.safeDoseEstablished, false);
  assert.equal(r.cureClaim, 'HYPOTHESIS_COMPARE_PREDICTED_FUNCTION_WITH_TRAJECTORY');
});
test('present fragmentation and existing protective stops override keep/titrate', () => {
  for (const key of ['adverseNow', 'existingProtectiveStop']) {
    const r = assessMethod({ ...method(), [key]: true });
    assert.equal(r.currentPractice, 'PAUSE_NOW_EXISTING_SAFETY_GATES');
    assert.ok(r.actions.includes('PAUSE_IF_ADVERSE')); assert.ok(!r.actions.includes('KEEP_BUT_TITRATE'));
    assert.equal(r.benefitPreserved, 'CLEAR');
  }
});
test('integrated program absence creates explicit modular gaps; check-ins do not satisfy supervision', () => {
  const p = profile(); p.requiredFunctions.push('continuous_supervision', 'substance_support');
  const a = program(); a.kind = 'MODULE'; a.functions.check_ins = fact();
  const r = assembleSupport(p, [a], { responsibleNavigator: true, scheduleTransportCompatible: true, coverageConfirmed: false });
  assert.equal(r.outcome, 'INCOMPLETE_MODULAR_PLAN');
  assert.deepEqual(r.uncoveredFunctions, ['continuous_supervision', 'substance_support']);
  assert.equal(r.hardConstraintsRelaxed, false);
  assert.ok(r.rediscoverOn.includes('FIT_FAILURE'));
});
test('incompatible modules cannot cover gaps even if their feature list fits', () => {
  const a = program(); a.kind = 'MODULE'; a.compatibility.environment = fact('FAIL');
  const r = assembleSupport(profile(), [a], { responsibleNavigator: true, scheduleTransportCompatible: true, coverageConfirmed: true });
  assert.deepEqual(r.accepted, []); assert.deepEqual(r.uncoveredFunctions, ['housing', 'meaningful_activity']);
  assert.ok(r.reasons.includes('ALLERGY/ENVIRONMENT_MISMATCH'));
});
test('modular costs are added and need the same time horizon plus coordination', () => {
  const a = program(); a.kind = 'MODULE'; a.cost.totalCommitment = 30;
  const b = structuredClone(a); b.id = 'SECOND_MODULE';
  const c = { responsibleNavigator: true, scheduleTransportCompatible: true, coverageConfirmed: true };
  const r = assembleSupport(profile(), [a, b], c);
  assert.equal(r.totalCommitment, 60); assert.ok(r.reasons.includes('TOO_EXPENSIVE')); assert.equal(r.outcome, 'INCOMPLETE_MODULAR_PLAN');
  b.cost.totalCommitment = 10; b.cost.horizon = 'different_period';
  assert.equal(assembleSupport(profile(), [a, b], c).comparableCostHorizon, false);
  b.cost.horizon = a.cost.horizon;
  assert.equal(assembleSupport(profile(), [a, b], c).outcome, 'MODULAR_PLAN_TO_VERIFY_WITH_PERSON');
  assert.equal(assembleSupport(profile(), [a, b], { ...c, coverageConfirmed: false }).outcome, 'INCOMPLETE_MODULAR_PLAN');
});
test('no candidates preserves NO_GOOD_MATCH and all uncovered functions', () => {
  const r = assembleSupport(profile(), [], { responsibleNavigator: false, scheduleTransportCompatible: false, coverageConfirmed: false });
  assert.ok(r.reasons.includes('NO_GOOD_MATCH')); assert.equal(r.outcome, 'INCOMPLETE_MODULAR_PLAN');
  assert.deepEqual(r.uncoveredFunctions, ['housing', 'meaningful_activity']);
});
test('modular assembly retains wanted activity capacity as unresolved while accepting housing', () => {
  const p = profile(); p.meaningfulActivity.capacity = 'UNKNOWN';
  const a = program(); a.kind = 'MODULE'; delete a.functions.meaningful_activity;
  const r = assembleSupport(p, [a], { responsibleNavigator: true, scheduleTransportCompatible: true, coverageConfirmed: true });
  assert.equal(r.outcome, 'INCOMPLETE_MODULAR_PLAN'); assert.deepEqual(r.accepted, [a.id]);
  assert.ok(r.pending.includes('activity_capacity'));
});
test('modular assembly preserves current safety precedence and unknown clearance', () => {
  const p = profile(); p.emergency = 'ACTIVE';
  const c = { responsibleNavigator: true, scheduleTransportCompatible: true, coverageConfirmed: true };
  assert.equal(assembleSupport(p, [program()], c).outcome, 'EXISTING_SAFETY_ROUTE');
  p.emergency = 'UNKNOWN'; assert.equal(assembleSupport(p, [], c).outcome, 'VERIFICATION_PENDING');
});
test('peer burden adds boundaries and stable support without categorical abandonment or assumed avoidance', () => {
  for (const burdenReported of [true, false]) {
    const r = peerSupportActions({ burdenReported, ownRecoveryDisplaced: burdenReported });
    assert.equal(r.abandonIllFriends, false); assert.equal(r.avoidanceAssumed, false);
    if (burdenReported) assert.ok(r.actions.includes('ADD_STABLE_PEERS_MENTORS'));
    else assert.ok(r.actions.includes('PRESERVE_SUPPORTIVE_FRIENDSHIPS'));
  }
});
test('combined synthetic support case preserves partial benefit, cost, fit and scarcity boundaries', () => {
  const p = profile(); p.requiredFunctions.push('supervision', 'pain_support', 'substance_support');
  for (const key of ['substantialInstability', 'activeDissociationRisk', 'repeatedCurrentHospitalUse', 'supervisionNeeded']) p.highNeeds[key] = fact();
  const before = structuredClone(p);
  assert.equal(assessFit(p, program()).outcome, 'NO_GOOD_MATCH');
  const a = program(); a.kind = 'SUPPORTED_PROGRAM'; a.functions = facts([...p.requiredFunctions, 'meaningful_activity']); a.compatibility.environment = fact('UNKNOWN');
  assert.equal(assessFit(p, a).outcome, 'VERIFICATION_PENDING');
  a.compatibility.environment = fact(); a.cost.totalCommitment = 400;
  assert.ok(assessFit(p, a).reasons.includes('TOO_EXPENSIVE'));
  assert.ok(assessMethod(method()).actions.includes('KEEP_BUT_TITRATE'));
  assert.equal(assessFinancialFit(p.finances, { ...offer(), totalCommitment: 400, disproportionateToResources: 'YES' }).outcome, 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES');
  const t = { ...trial(), completed: trialStages.slice(0, 2), previousOutcome: 'TOLERATED' };
  assert.equal(planTrial(t).outcome, 'DO_NOT_START_EXPOSURE');
  assert.equal(assembleSupport(p, [], { responsibleNavigator: false, scheduleTransportCompatible: false, coverageConfirmed: false }).outcome, 'INCOMPLETE_MODULAR_PLAN');
  assert.deepEqual(p, before, 'contract never mutates or persists the profile');
});
