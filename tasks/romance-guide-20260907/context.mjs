/** Candidate-only, source-grounded content composition. Not a clinical risk classifier.
 * No network, persistence, model calls, graph mutation or installation occurs here.
 * Existing planner/app gates remain authoritative; a caller must honor canRealize.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = JSON.parse(readFileSync(new URL('./SOURCE.json', import.meta.url), 'utf8'));
const supplement = JSON.parse(readFileSync(new URL('./SUPPLEMENT.json', import.meta.url), 'utf8'));
const ownerLink = JSON.parse(readFileSync(new URL('./OWNER-LINK-CONFIRMATION.json', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const TOPICS = Object.freeze({
  none: [], readiness: ['RG01', 'RG03', 'RG06'],
  compatibility: ['RG02', 'RG03', 'RG04'], dependency: ['RG05', 'RG06', 'RG11'],
  community: ['RG06'], agreements: ['RG07'], coercion: ['RG08'],
  jealousy: ['RG09'], children: ['RG10'], progress: ['RG11'], ending: ['RG12'],
  polarity: ['RG02', 'RG07'], 'spiritual-romance': ['RG02', 'RG05', 'RG06'],
  'relationship-forms': ['RG07'], 'sexual-communication': ['RG07'],
  'medical-practice': [], 'unsafe-practice': []
});
const ENUMS = Object.freeze({
  topic: Object.keys(TOPICS),
  stage: ['not-applicable', 'considering', 'existing', 'ending', 'unknown'],
  readiness: ['unassessed', 'pause', 'no-pause-indicated', 'not-applicable'],
  audience: ['adult', 'minor', 'unknown'],
  interest: ['unspecified', 'curious', 'requested', 'declined']
});
const text = value => typeof value === 'string' && value.trim().length > 0;

export function validateRomanceSources(s = source, p = supplement, link = ownerLink) {
  if (s?.schemaVersion !== 1 || p?.schemaVersion !== 1 || p.sourceId !== s.id
      || p.status !== 'candidate-development-only' || s.pageCount !== 83
      || s.pdfSha256 !== 'b4bc13f8c0e02d2782cbe6b2f5aae65169e44ed482dc9e7085c72cf5016c342f'
      || s.canonicalUrl !== 'https://romance.u-dont-exist.com'
      || p.linkPolicy?.url !== s.canonicalUrl
      || p.linkPolicy?.automaticFetching !== false
      || p.linkPolicy?.personalDataInUrl !== false
      || link?.schemaVersion !== 1 || link.url !== s.canonicalUrl
      || link.ownerConfirmedReachability !== true
      || link.verificationKind !== 'owner-confirmed-not-independently-network-verified') throw new Error('Invalid romance source contract');
  if (!Array.isArray(s.excerpts) || !Array.isArray(p.rules)) throw new Error('Missing romance source arrays');
  const excerpts = new Map();
  for (const e of s.excerpts) {
    if (!text(e.id) || excerpts.has(e.id) || !Number.isInteger(e.page) || e.page < 1 || e.page > s.pageCount
        || !text(e.section) || !text(e.quote) || hash(e.quote) !== e.quoteSha256
        || hash(JSON.stringify([e.id, e.page, e.section, e.quote])) !== e.spanSha256) throw new Error('Invalid romance excerpt');
    excerpts.set(e.id, e);
  }
  const ids = new Set();
  for (const r of p.rules) {
    if (!text(r.id) || ids.has(r.id) || !text(r.title) || !text(r.guidance)
        || !text(r.scopeAdaptation) || !text(r.progressCheck)
        || !Array.isArray(r.excerptIds) || !r.excerptIds.length
        || r.excerptIds.some(id => !excerpts.has(id))
        || hash(JSON.stringify([r.id, r.title, r.excerptIds, r.guidance, r.scopeAdaptation, r.progressCheck])) !== r.ruleSha256) throw new Error('Invalid romance rule provenance');
    ids.add(r.id);
  }
  if (Object.values(TOPICS).flat().some(id => !ids.has(id))) throw new Error('Unbound romance topic');
  return { sourceId: s.id, supplementId: p.id, excerpts: excerpts.size, rules: ids.size,
    optionalReference: { url: link.url, reachability: 'owner-confirmed' } };
}
validateRomanceSources();

function options(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Expected romance options');
  const allowed = new Set([...Object.keys(ENUMS), 'enabled', 'alreadyOffered']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new TypeError('Unknown romance option');
  const result = { enabled: false, topic: 'none', stage: 'unknown', readiness: 'unassessed',
    audience: 'unknown', interest: 'unspecified', alreadyOffered: false, ...input };
  if (typeof result.enabled !== 'boolean' || typeof result.alreadyOffered !== 'boolean') throw new TypeError('Expected boolean options');
  for (const [key, values] of Object.entries(ENUMS)) if (!values.includes(result[key])) throw new TypeError(`Invalid ${key}`);
  return result;
}

function controlledRoute(plan) {
  const v = plan.variables ?? {};
  if (Number.isInteger(plan.primaryJob?.tier) && plan.primaryJob.tier <= 2
      || v.present_safety === 'unsafe' || ['ideation', 'intent'].includes(v.suicidal_state)) return 'safety';
  if (plan.primaryJob?.id === 'ROUTE.EXTERNAL_EMBODIMENT'
      || v.orientation === 'disoriented' || v.dissociation === 'high' || v.altered_state === 'altered') return 'stabilization';
  if (plan.primaryJob?.id === 'ROUTE.LEAVE_ALONE' || plan.executionContract?.task?.phase === 'close') return 'leave-alone';
  return 'ordinary';
}

/** The readiness directive must come from the separately evidenced case assessment.
 * This function never infers it from a diagnosis, loneliness, a warm interaction or
 * admission history. It supplies source context, not permission to date or to act.
 */
export function composeRomanceContext(plan, input = {}) {
  const o = options(input);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('Expected a case plan');
  const base = { status: 'CANDIDATE_CONTEXT_ONLY', plan, canRealize: true,
    action: 'UNCHANGED', ruleIds: [], sourceRefs: [], progressChecks: [], reference: null,
    referenceDecision: 'NOT_RELEVANT', sourceId: source.id, supplementId: supplement.id,
    readiness: o.readiness, provesReadiness: false, provesBenefit: false };
  if (!o.enabled || o.topic === 'none') return { ...base, status: 'DISABLED' };
  if (plan.contractVersion !== 'case-plan-v5') return { ...base, canRealize: false, action: 'UNSUPPORTED_PLAN_CONTRACT' };
  for (const key of ['requiredNuance', 'forbiddenOverclaims']) {
    if (!Array.isArray(plan[key]) || plan[key].some(value => typeof value !== 'string')) throw new TypeError(`Invalid plan ${key}`);
  }
  const route = controlledRoute(plan);
  if (route === 'safety') {
    const safetyPrimary = Number.isInteger(plan.primaryJob?.tier) && plan.primaryJob.tier <= 2;
    return { ...base, canRealize: safetyPrimary, action: safetyPrimary ? 'PRESERVE_SAFETY' : 'REPLAN_FOR_SAFETY', referenceDecision: 'SAFETY_FIRST' };
  }
  if (route === 'leave-alone') return { ...base, action: 'PRESERVE_CLOSE', referenceDecision: 'DO_NOT_REOPEN' };
  if (['medical-practice', 'unsafe-practice'].includes(o.topic)) return { ...base,
    canRealize: false, action: 'USE_APPROPRIATE_SAFETY_OR_MEDICAL_ROUTE', referenceDecision: 'NO_REFERENCE_BYPASS' };
  const pauseNewRomance = o.readiness === 'pause' && ['considering', 'unknown'].includes(o.stage);
  const ids = [...(route === 'stabilization' || pauseNewRomance ? ['RG01', 'RG06'] : TOPICS[o.topic])];
  if (o.stage === 'existing' && o.readiness === 'pause' && !ids.includes('RG12')) ids.push('RG12');
  const selected = ids.map(id => supplement.rules.find(rule => rule.id === id));
  const refs = [...new Set(selected.flatMap(rule => rule.excerptIds))].map(id => {
    const e = source.excerpts.find(excerpt => excerpt.id === id);
    return { id, page: e.page, section: e.section, quoteSha256: e.quoteSha256 };
  });
  const candidatePlan = {
    ...plan,
    requiredNuance: [...plan.requiredNuance,
      'Romance supplement is task-scoped context, not a checklist of interventions or a new question. Preserve the current question/consent contract.',
      ...selected.map(r => `[${r.id}; owner-guide adaptation] ${r.guidance}`),
      ...selected.map(r => `[${r.id}; integration scope] ${r.scopeAdaptation}`)],
    forbiddenOverclaims: [...plan.forbiddenOverclaims,
      'Do not equate supportive connection, romantic readiness, felt intimacy, compatibility and lasting benefit.',
      'Do not treat a diagnosis or past hospitalization as a permanent dating ban, or this supplement as a clinical clearance.',
      'Do not infer absent-person motives or manufacture a memory, risk fact, child, or source certainty.']
  };
  const stabilizationPrimary = ['ROUTE.EXTERNAL_EMBODIMENT', 'ROUTE.ACT_OUTWARD'].includes(plan.primaryJob?.id);
  const replanningRequired = (pauseNewRomance || route === 'stabilization') && !stabilizationPrimary;
  let referenceDecision = 'NOT_REQUESTED';
  const optional = Object.hasOwn(supplement.optionalTopics, o.topic);
  if (route === 'stabilization' || pauseNewRomance) referenceDecision = 'STABILIZATION_FIRST';
  else if (o.audience !== 'adult') referenceDecision = 'ADULT_GUIDE_BOUNDARY';
  else if (o.interest === 'declined') referenceDecision = 'DECLINED';
  else if (o.alreadyOffered && o.interest !== 'requested') referenceDecision = 'ALREADY_OFFERED';
  else if (o.interest === 'requested' || o.interest === 'curious' || optional) referenceDecision =
    (supplement.linkPolicy.reachabilityVerified === true || ownerLink.ownerConfirmedReachability === true)
      ? 'OFFER_OPTIONAL_REFERENCE' : 'LINK_VERIFICATION_REQUIRED';
  const reference = referenceDecision === 'OFFER_OPTIONAL_REFERENCE' ? {
    url: source.canonicalUrl,
    text: 'If you are curious about the broader relationship questions, Joel’s romance guide is at romance.u-dont-exist.com. Reading it is optional.',
    openAutomatically: false,
    reachabilityEvidence: supplement.linkPolicy.reachabilityVerified === true ? 'independently-verified' : 'owner-confirmed'
  } : null;
  return { ...base, plan: candidatePlan, canRealize: !replanningRequired,
    action: replanningRequired ? 'REPLAN_FOR_STABILIZATION' : route === 'stabilization' ? 'PRESERVE_STABILIZATION'
      : pauseNewRomance ? 'PAUSE_ROMANTIC_ESCALATION' : 'ADD_TASK_SCOPED_CONTEXT',
    ruleIds: ids, sourceRefs: refs, progressChecks: selected.map(r => ({ ruleId: r.id, criterion: r.progressCheck })),
    referenceDecision, reference,
    optionalTopicBoundary: optional ? supplement.optionalTopics[o.topic].boundary : null,
    existingRelationshipPauseIsNotBreakupOrder: o.stage === 'existing' && o.readiness === 'pause' };
}
