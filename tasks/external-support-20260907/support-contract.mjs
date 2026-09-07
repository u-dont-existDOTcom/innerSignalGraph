// Candidate-only executable contract. Reuses shared pure assessment policy; no
// runtime entrypoint imports this task, and no I/O, inference or persistence occurs.
import Ajv from 'ajv';
import { assessDeliverySystem, assessOpportunityCost, deliveryAssessmentSchema, resourceSchema, validateDeliveryAssessment } from '../../src/case-formulation/delivery-system-assessment.mjs';

export const suitabilityChecks = ['acuity', 'selfCare', 'suicideViolenceSafety', 'substanceStability', 'realityTesting', 'hostRules', 'safeExit', 'financesTransport', 'conflictTolerance', 'fallbackSupport'];
export const hostChecks = ['workload', 'accommodation', 'hygiene', 'interpersonalClimate', 'privacy', 'substanceEnvironment', 'transportExit', 'medicalAccess', 'dailySchedule', 'reviews', 'disclosedNeedsPreparedness'];
export const highNeedSignals = ['substantialInstability', 'activeSubstanceRisk', 'activeDissociationRisk', 'repeatedCurrentHospitalUse', 'poorSelfCare', 'supervisionNeeded'];
export const scarcityOutcomes = ['NO_GOOD_MATCH', 'TOO_EXPENSIVE', 'ACCESS_BLOCKED', 'WAITLISTED', 'GEOGRAPHIC_MISMATCH', 'PHILOSOPHY_MISMATCH', 'ALLERGY/ENVIRONMENT_MISMATCH'];
export const trialStages = ['REMOTE_INTERVIEW_VIDEO', 'ENVIRONMENT_QUESTIONNAIRE', 'DAY_VISIT', 'TRIAL_1_3_DAYS', 'TRIAL_1_2_WEEKS', 'LONGER_PLACEMENT'];
export const practitionerQuestions = ['deliverables', 'sessionCountDuration', 'cancellationRefund', 'credentialsScope', 'adverseEventPlan', 'supervisionEscalation', 'referencesOutcomes', 'betweenSessionSupport', 'lowerCostOptions'];

const choice = values => ({ type: 'string', enum: values });
const text = { type: 'string', minLength: 1 };
const money = { type: ['number', 'null'], minimum: 0 };
const strings = { type: 'array', items: text, uniqueItems: true };
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const fact = object({ status: choice(['PASS', 'FAIL', 'UNKNOWN']), evidenceRef: text, checkedAt: text, current: { type: 'boolean' } });
const facts = keys => object(Object.fromEntries(keys.map(key => [key, fact])));
const factMap = { type: 'object', additionalProperties: fact };
const financial = resourceSchema;
// Missing remains compatible with older task-local fixtures, explicitly UNASSESSED.
// Once supplied, an assessment must be valid and its unknowns cannot clear fit.
const withDeliveryAssessment = schema => ({ ...schema, properties: { ...schema.properties, deliveryAssessment: deliveryAssessmentSchema } });

// This bounded projection is NOT the full private interview or an admitted storage schema.
export const supportProfileSchema = object({
  version: { const: 1 }, emergency: choice(['ACTIVE', 'ABSENT', 'UNKNOWN']),
  requiredFunctions: strings,
  meaningfulActivity: object({ wanted: { type: 'boolean' }, capacity: choice(['ABLE', 'LIMITED', 'UNABLE', 'UNKNOWN']), groundingKinds: strings, overwhelmingKinds: strings }),
  highNeeds: facts(highNeedSignals), suitability: facts(suitabilityChecks),
  constraints: { type: 'array', items: object({ id: text, kind: choice(['NATURE', 'MEDICATION_PHILOSOPHY', 'ALLERGY_ASTHMA_MOLD_ANIMAL', 'SENSORY_ACCESS_PRIVACY', 'GEOGRAPHY_LEGAL', 'OTHER']), requirement: text, hard: { type: 'boolean' }, authority: choice(['USER', 'OWNER_AND_USER']) }) },
  finances: financial
});
export const programAuditSchema = withDeliveryAssessment(object({
  id: text, kind: choice(['ORDINARY_EXCHANGE', 'SUPPORTED_PROGRAM', 'MODULE']),
  functions: factMap, compatibility: factMap, host: facts(hostChecks),
  access: choice(['AVAILABLE', 'WAITLISTED', 'ACCESS_BLOCKED', 'UNKNOWN']),
  // All-in costs over an explicitly shared horizon, including travel and safe exit.
  cost: object({ totalCommitment: money, horizon: text }),
  workSafeguards: facts(['voluntary', 'safeLoad', 'titratable', 'careNotReplaced'])
}));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateProfile = ajv.compile(supportProfileSchema);
const validateProgram = ajv.compile(programAuditSchema);
function assertValid(validate, value) {
  if (!validate(value)) throw new TypeError(`Invalid candidate contract: ${ajv.errorsText(validate.errors)}`);
}
export function validateSupportProfile(value) {
  assertValid(validateProfile, value);
  if (new Set(value.constraints.map(c => c.id)).size !== value.constraints.length) throw new TypeError('Duplicate constraint ID');
  return true;
}
export function validateProgramAudit(value) {
  assertValid(validateProgram, value);
  if (Object.hasOwn(value, 'deliveryAssessment')) {
    validateDeliveryAssessment(value.deliveryAssessment);
    if (value.deliveryAssessment.provider_id !== value.id) throw new TypeError('Delivery assessment provider_id must match the audited program id');
  }
  return true;
}
function deliveryProjection(value) {
  const deliveryAssessment = Object.hasOwn(value, 'deliveryAssessment') ? assessDeliverySystem(value.deliveryAssessment) : null;
  return { deliveryStatus: deliveryAssessment?.trustStatus ?? 'UNASSESSED', deliveryAssessment };
}
const status = f => !f || !f.current ? 'UNKNOWN' : f.status;
const unique = values => [...new Set(values)];
const requiredFunctions = p => unique([...p.requiredFunctions, ...(p.meaningfulActivity.wanted && ['ABLE', 'LIMITED'].includes(p.meaningfulActivity.capacity) ? ['meaningful_activity'] : [])]);

export function assessOrdinaryPlacement(profile, program) {
  validateSupportProfile(profile); validateProgramAudit(program);
  if (program.kind !== 'ORDINARY_EXCHANGE') return { outcome: 'NOT_APPLICABLE', reasons: [] };
  // PASS on a high-need signal means it is affirmatively present, unlike a safety check.
  const needs = highNeedSignals.filter(key => status(profile.highNeeds[key]) === 'PASS');
  const failed = suitabilityChecks.filter(key => status(profile.suitability[key]) === 'FAIL');
  const hostFailed = hostChecks.filter(key => status(program.host[key]) === 'FAIL');
  if (profile.emergency === 'ACTIVE') return { outcome: 'EXISTING_SAFETY_ROUTE', reasons: ['current_safety'] };
  if (needs.length || failed.length || hostFailed.length) return { outcome: 'UNSUITABLE_ORDINARY_PLACEMENT', reasons: [...needs, ...failed, ...hostFailed] };
  const unknown = [...highNeedSignals.filter(key => status(profile.highNeeds[key]) === 'UNKNOWN'), ...suitabilityChecks.filter(key => status(profile.suitability[key]) === 'UNKNOWN'), ...hostChecks.filter(key => status(program.host[key]) === 'UNKNOWN')];
  if (profile.emergency === 'UNKNOWN' || unknown.length) return { outcome: 'VERIFICATION_PENDING', reasons: unique(['assessment', ...unknown]) };
  return { outcome: 'SUITABLE_TO_CONSIDER', reasons: [] };
}

export function assessFit(profile, program) {
  validateSupportProfile(profile); validateProgramAudit(program);
  const delivery = deliveryProjection(program);
  if (profile.emergency !== 'ABSENT') return { outcome: profile.emergency === 'ACTIVE' ? 'EXISTING_SAFETY_ROUTE' : 'VERIFICATION_PENDING', reasons: ['current_safety'], environmentFit: { outcome: 'NOT_ASSESSED_CURRENT_SAFETY' }, ...delivery };
  const ordinary = assessOrdinaryPlacement(profile, program);
  const reasons = [], unknown = [];
  if (profile.meaningfulActivity.wanted && profile.meaningfulActivity.capacity === 'UNKNOWN') unknown.push('activity_capacity');
  if (ordinary.outcome === 'UNSUITABLE_ORDINARY_PLACEMENT') reasons.push('NO_GOOD_MATCH');
  if (ordinary.outcome === 'VERIFICATION_PENDING') unknown.push('ordinary_suitability');
  for (const constraint of profile.constraints.filter(c => c.hard)) {
    const s = status(program.compatibility[constraint.id]);
    if (s === 'UNKNOWN') unknown.push(constraint.id);
    if (s === 'FAIL') reasons.push(({ MEDICATION_PHILOSOPHY: 'PHILOSOPHY_MISMATCH', ALLERGY_ASTHMA_MOLD_ANIMAL: 'ALLERGY/ENVIRONMENT_MISMATCH', SENSORY_ACCESS_PRIVACY: 'ALLERGY/ENVIRONMENT_MISMATCH', GEOGRAPHY_LEGAL: 'GEOGRAPHIC_MISMATCH' })[constraint.kind] ?? 'NO_GOOD_MATCH');
  }
  const missing = requiredFunctions(profile).filter(key => status(program.functions[key]) !== 'PASS');
  for (const key of missing) (status(program.functions[key]) === 'FAIL' ? reasons : unknown).push(status(program.functions[key]) === 'FAIL' ? 'NO_GOOD_MATCH' : key);
  if (program.kind === 'ORDINARY_EXCHANGE' || status(program.functions.meaningful_activity) === 'PASS') for (const [key, f] of Object.entries(program.workSafeguards)) {
    if (status(f) === 'FAIL') reasons.push('NO_GOOD_MATCH');
    if (status(f) === 'UNKNOWN') unknown.push(key);
  }
  if (['WAITLISTED', 'ACCESS_BLOCKED'].includes(program.access)) reasons.push(program.access);
  if (program.access === 'UNKNOWN') unknown.push('access');
  if (program.cost.totalCommitment === null || (program.cost.totalCommitment > 0 && profile.finances.maxCommitment === null)) unknown.push('affordability');
  else if (program.cost.totalCommitment > profile.finances.maxCommitment) reasons.push('TOO_EXPENSIVE');
  // Preserve environment/function evidence even when delivery disqualifies a program.
  const environmentFit = { outcome: reasons.length ? 'NO_GOOD_MATCH' : unknown.length ? 'VERIFICATION_PENDING' : 'FIT_TO_CONSIDER', reasons: unique(reasons), pending: unique(unknown), uncoveredFunctions: missing };
  if (delivery.deliveryStatus === 'HIGH_RISK_DELIVERY') reasons.push('HIGH_RISK_DELIVERY');
  if (delivery.deliveryStatus === 'UNCLEAR') unknown.push('delivery_safeguards');
  if (delivery.deliveryStatus === 'CAUTION') unknown.push('delivery_concerns');
  return { outcome: reasons.length ? 'NO_GOOD_MATCH' : unknown.length ? 'VERIFICATION_PENDING' : 'FIT_TO_CONSIDER', reasons: unique(reasons), pending: unique(unknown), uncoveredFunctions: missing, environmentFit, ...delivery };
}

const trialSchema = object({
  completed: { type: 'array', items: choice(trialStages), uniqueItems: true }, consent: { type: 'boolean' },
  exposure: choice(['CLEARED_FOR_NEXT_STAGE', 'UNSAFE', 'UNKNOWN']), safeExit: { type: 'boolean' },
  supportCovered: { type: 'boolean' }, previousOutcome: choice(['NOT_STARTED', 'TOLERATED', 'ADVERSE', 'UNKNOWN']),
  skippedStageRequested: { type: 'boolean' }, largeUpfrontRequired: { type: 'boolean' }
});
const validateTrial = ajv.compile(trialSchema);
export function planTrial(input) {
  assertValid(validateTrial, input);
  if (!input.consent) return { outcome: 'CONSENT_PAUSED', next: null };
  if (input.previousOutcome === 'ADVERSE') return { outcome: 'STOP_AND_REVISE_FIT', next: null };
  if (input.skippedStageRequested || input.completed.some((stage, i) => stage !== trialStages[i])) return { outcome: 'REVIEW_ALTERNATIVE_SEQUENCE', next: null };
  if (input.largeUpfrontRequired) return { outcome: 'REVIEW_REVERSIBLE_ALTERNATIVES', next: null };
  const next = trialStages[input.completed.length] ?? null;
  if (input.completed.length && input.previousOutcome !== 'TOLERATED') return { outcome: 'REVIEW_PREVIOUS_STAGE', next: null };
  if (next && trialStages.indexOf(next) >= 2 && (input.exposure !== 'CLEARED_FOR_NEXT_STAGE' || !input.safeExit || !input.supportCovered)) return { outcome: 'DO_NOT_START_EXPOSURE', next: null };
  return { outcome: next ? 'NEXT_STAGE_TO_AGREE' : 'CONTINUE_REVIEW', next };
}
export function recordTrialOutcome(reason) {
  if (!['ALLERGY', 'ASTHMA', 'MOLD', 'ANIMALS', 'SENSORY', 'PEER_MIX', 'PERSONALITY_CULTURE', 'STAFF', 'WORKLOAD', 'GEOGRAPHY', 'LEGAL_ACCESS', 'UNKNOWN'].includes(reason)) throw new TypeError('Unknown fit-failure reason');
  return { attribution: 'FIT_EVIDENCE_NOT_CLIENT_FAILURE', reason, actions: ['ARRANGE_SAFE_EXIT_AND_SUPPORT', 'REVIEW_COST_REFUND', 'UPDATE_PROFILE_AND_AUDIT', 'REDISCOVER'] };
}

const offerSchema = object({
  totalCommitment: money, disproportionateToResources: choice(['YES', 'NO', 'UNKNOWN']),
  redFlags: { type: 'array', uniqueItems: true, items: choice(['PACKAGE_PRESSURE', 'SCARCITY_URGENCY', 'UNIQUE_CURE', 'INADEQUATE_ACCESSIBLE_SUPPORT', 'OPAQUE_ADVERSE_HANDLING']) },
  answers: facts(practitionerQuestions), independentFitQualityChecked: { type: 'boolean' }, cheaperStagedAlternativesChecked: { type: 'boolean' },
  reversibleSmallPurchase: { type: 'boolean' }
});
const validateFinance = ajv.compile(financial), validateOffer = ajv.compile(offerSchema);
export function assessFinancialFit(finances, offer) {
  assertValid(validateFinance, finances); assertValid(validateOffer, offer);
  const opportunityCost = assessOpportunityCost(finances, offer.totalCommitment);
  const { affordability } = opportunityCost;
  const questions = practitionerQuestions.filter(q => status(offer.answers[q]) !== 'PASS');
  const unresolved = questions.length || !offer.independentFitQualityChecked || !offer.cheaperStagedAlternativesChecked || !offer.reversibleSmallPurchase;
  return { ...opportunityCost, questions, redFlags: [...offer.redFlags],
    outcome: opportunityCost.stagedTrialRequired || affordability === 'TOO_EXPENSIVE' || offer.disproportionateToResources === 'YES' || offer.redFlags.length || unresolved || affordability === 'UNKNOWN' || offer.disproportionateToResources === 'UNKNOWN' ? 'DEFER_COMMITMENT_REVIEW_ALTERNATIVES' : 'SMALL_REVERSIBLE_OPTION_TO_CONSIDER',
    alternatives: ['DONATION_SLIDING_SCALE', 'GROUP_SUPPORT', 'ONE_OFF_CONSULT', 'SMALL_CANCELLABLE_PACKAGE'], treatmentChange: 'NO_ABRUPT_PRESCRIBED_TREATMENT_STOP' };
}

const methodSchema = withDeliveryAssessment(object({
  benefitMagnitude: choice(['CLEAR', 'SMALL', 'NONE', 'UNKNOWN']), durability: choice(['BRIEF', 'SUSTAINED', 'UNKNOWN']),
  doseResponse: choice(['MORE_IS_WORSE', 'NO_ADVERSE_PATTERN', 'UNKNOWN']), adverseNow: { type: 'boolean' }, adverseHistory: { type: 'boolean' },
  supervisionNeeded: { type: 'boolean' }, supervisionAvailable: { type: 'boolean' },
  dailyFunction: choice(['IMPROVING', 'FLAT', 'WORSENING', 'UNKNOWN']), broaderNeeds: { type: 'boolean' },
  cureHypothesis: { type: 'boolean' }, existingProtectiveStop: { type: 'boolean' }
}));
const validateMethod = ajv.compile(methodSchema);
export function assessMethod(input) {
  assertValid(validateMethod, input);
  const delivery = deliveryProjection(input);
  const sharedMethod = delivery.deliveryAssessment?.method;
  if (sharedMethod?.current) {
    const outerBenefit = ['CLEAR', 'SMALL'].includes(input.benefitMagnitude) ? 'USEFUL' : input.benefitMagnitude === 'NONE' ? 'NONE' : 'UNKNOWN';
    const innerBenefit = ['OBSERVED_PARTIAL', 'OBSERVED_USEFUL'].includes(sharedMethod.benefit) ? 'USEFUL' : sharedMethod.benefit === 'NO_BENEFIT' ? 'NONE' : 'UNKNOWN';
    const outerDurability = ({ BRIEF: 'TEMPORARY', SUSTAINED: 'SUSTAINED' })[input.durability] ?? 'UNKNOWN';
    if (outerBenefit !== 'UNKNOWN' && innerBenefit !== 'UNKNOWN' && outerBenefit !== innerBenefit) throw new TypeError('Conflicting known method benefit assessments require reconciliation');
    if (outerDurability !== 'UNKNOWN' && sharedMethod.durability !== 'UNKNOWN' && outerDurability !== sharedMethod.durability) throw new TypeError('Conflicting known method durability assessments require reconciliation');
  }
  const actions = [];
  const pause = input.adverseNow || input.existingProtectiveStop;
  if (pause) actions.push('PAUSE_IF_ADVERSE');
  else if (['CLEAR', 'SMALL'].includes(input.benefitMagnitude)) actions.push('KEEP_BUT_TITRATE');
  if (input.doseResponse === 'MORE_IS_WORSE' || input.adverseHistory) actions.push('REDUCE_DOSE');
  if (input.supervisionNeeded || input.adverseHistory) actions.push('SEEK_SUPERVISION');
  if (input.broaderNeeds || input.dailyFunction !== 'IMPROVING') actions.push('COMBINE_WITH_OTHER_SUPPORTS');
  const poorDelivery = delivery.deliveryStatus === 'HIGH_RISK_DELIVERY';
  const providerActions = delivery.deliveryAssessment?.actions.filter(action => action !== 'CONTINUE_IF_METHOD_AND_SAFETY_PERMIT') ?? [];
  if (poorDelivery && input.benefitMagnitude === 'NONE') actions.push('REASSESS_OR_SWITCH_METHOD');
  if (delivery.deliveryAssessment?.findings.some(f => f.code === 'DESTABILIZATION_DISMISSED_AS_RELEASE')) actions.push('DE_ESCALATE');
  const rejectTotalCure = providerActions.includes('REJECT_UNSUPPORTED_TOTAL_CURE_CLAIM');
  return { actions: unique([...actions, ...providerActions]), providerActions,
    currentPractice: pause ? 'PAUSE_NOW_EXISTING_SAFETY_GATES' : poorDelivery || input.supervisionNeeded && !input.supervisionAvailable ? 'REASSESS_SAFE_LIMITS_WITH_HUMAN' : 'REVIEW_TITRATION', benefitPreserved: input.benefitMagnitude,
    cureClaim: rejectTotalCure ? 'REJECT_UNSUPPORTED_TOTAL_CURE_CLAIM' : input.cureHypothesis ? 'HYPOTHESIS_COMPARE_PREDICTED_FUNCTION_WITH_TRAJECTORY' : 'NO_CURE_CLAIM', safeDoseEstablished: false, ...delivery };
}

export function assembleSupport(profile, modules, coordination) {
  validateSupportProfile(profile);
  if (profile.emergency !== 'ABSENT') return { outcome: profile.emergency === 'ACTIVE' ? 'EXISTING_SAFETY_ROUTE' : 'VERIFICATION_PENDING', accepted: [], rejected: [], uncoveredFunctions: requiredFunctions(profile), reasons: ['current_safety'], hardConstraintsRelaxed: false };
  if (!Array.isArray(modules)) throw new TypeError('Modules must be an array');
  const validateCoordination = ajv.compile(object({ responsibleNavigator: { type: 'boolean' }, scheduleTransportCompatible: { type: 'boolean' }, coverageConfirmed: { type: 'boolean' } }));
  assertValid(validateCoordination, coordination);
  const accepted = [], rejected = [], reasons = [], pending = [], programAssessments = [];
  const activityCapacityPending = profile.meaningfulActivity.wanted && profile.meaningfulActivity.capacity === 'UNKNOWN';
  if (activityCapacityPending) pending.push('activity_capacity');
  for (const module of modules) {
    // Evaluate each module against its own functions, while preserving all personal hard constraints.
    validateProgramAudit(module);
    const subprofile = { ...profile, requiredFunctions: [], meaningfulActivity: { ...profile.meaningfulActivity, wanted: false } };
    const fit = assessFit(subprofile, module);
    programAssessments.push({ id: module.id, environmentFit: fit.environmentFit, deliveryStatus: fit.deliveryStatus, deliveryAssessment: fit.deliveryAssessment });
    if (fit.outcome === 'FIT_TO_CONSIDER') accepted.push(module);
    else { rejected.push(module.id); reasons.push(...(fit.reasons ?? [])); pending.push(...(fit.pending ?? [])); }
  }
  const uncoveredFunctions = requiredFunctions(profile).filter(fn => !accepted.some(m => status(m.functions[fn]) === 'PASS'));
  const totalCommitment = accepted.reduce((sum, m) => sum + m.cost.totalCommitment, 0);
  const sameHorizon = new Set(accepted.map(m => m.cost.horizon)).size <= 1;
  const affordable = totalCommitment === 0 || (profile.finances.maxCommitment !== null && totalCommitment <= profile.finances.maxCommitment);
  if (!affordable && profile.finances.maxCommitment !== null) reasons.push('TOO_EXPENSIVE');
  if (!modules.length) reasons.push('NO_GOOD_MATCH');
  return { outcome: !activityCapacityPending && !uncoveredFunctions.length && accepted.length && affordable && sameHorizon && Object.values(coordination).every(Boolean) ? 'MODULAR_PLAN_TO_VERIFY_WITH_PERSON' : 'INCOMPLETE_MODULAR_PLAN',
    accepted: accepted.map(m => m.id), rejected, uncoveredFunctions, totalCommitment, comparableCostHorizon: sameHorizon, coordination, reasons: unique(reasons), pending: unique(pending), programAssessments,
    rediscoverOn: ['CONSTRAINT_CHANGE', 'RESOURCE_FUNDING_CHANGE', 'WAITLIST_AVAILABILITY_CHANGE', 'FIT_FAILURE', 'FACT_EXPIRY'], hardConstraintsRelaxed: false };
}

export function peerSupportActions({ burdenReported, ownRecoveryDisplaced }) {
  if (typeof burdenReported !== 'boolean' || typeof ownRecoveryDisplaced !== 'boolean') throw new TypeError('Peer inputs require assessed booleans');
  return { actions: burdenReported || ownRecoveryDisplaced ? ['CLARIFY_CHOSEN_CONTRIBUTION_VS_PRESSURE_OR_AVOIDANCE', 'SET_RESPONSIBILITY_BOUNDARIES', 'ADD_STABLE_PEERS_MENTORS', 'PRESERVE_VALUED_FRIENDSHIPS'] : ['PRESERVE_SUPPORTIVE_FRIENDSHIPS', 'REVIEW_RECIPROCITY_IF_NEEDED'], abandonIllFriends: false, avoidanceAssumed: false };
}
