/**
 * Offline companion-foundations prototype. Not imported by the application.
 * These functions check permissions and evidence shape, not clinical truth or
 * semantic non-sycophancy. They perform no I/O and never produce therapy prose.
 */
const record = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('Expected a plain record');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`Unexpected field: ${key}`);
  }
};
const oneOf = (value, values) => {
  if (!values.includes(value)) throw new TypeError('Invalid enum value');
};
const bool = value => {
  if (typeof value !== 'boolean') throw new TypeError('Expected a boolean');
};
const text = value => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Expected nonempty text');
};
const listOfIds = value => {
  if (!Array.isArray(value)) throw new TypeError('Expected an ID array');
  value.forEach(text);
  if (new Set(value).size !== value.length) throw new TypeError('Duplicate ID');
};
const result = (allowed, reason) => ({ allowed, reason });

/** A current explicit request permits this invitation, not a global preference change. */
export function invitationDecision(input) {
  record(input, ['preference', 'requestedNow', 'relevant', 'alreadyOffered', 'safetyClear']);
  const { preference, requestedNow, relevant, alreadyOffered, safetyClear } = input;
  oneOf(preference, ['unset', 'welcome', 'user_initiated', 'do_not_suggest']);
  [requestedNow, relevant, alreadyOffered, safetyClear].forEach(bool);
  if (!safetyClear) return result(false, 'DEFER_TO_EXISTING_SAFETY_ROUTE');
  if (requestedNow) return result(true, 'CURRENT_REQUEST_ONLY');
  if (preference !== 'welcome') return result(false, 'NO_UNSOLICITED_INVITATION');
  if (!relevant) return result(false, 'NO_CASE_SPECIFIC_RELEVANCE');
  if (alreadyOffered) return result(false, 'DO_NOT_REPEAT_INVITATION');
  return result(true, 'OPTIONAL_RELEVANT_INVITATION');
}

export const DIMENSIONS = Object.freeze([
  'care', 'protection', 'direction', 'flexibility', 'repair', 'connection',
  'vitality', 'everyday_participation'
]);

/**
 * Permission and provenance gate for a *tentative* cross-episode reflection.
 * The caller must supply all relevant retained observations for this dimension.
 * Their completeness, the assessment labels, and the prose need separate review.
 */
export function reflectionDecision(input) {
  record(input, ['scope', 'preference', 'requestedNow', 'safetyClear',
    'historyAllowed', 'alreadyReviewed', 'dimension', 'supportIds', 'counterIds', 'evidence']);
  const { scope, preference, requestedNow, safetyClear, historyAllowed,
    alreadyReviewed, dimension, supportIds, counterIds, evidence } = input;
  text(scope);
  oneOf(preference, ['off', 'on_request', 'occasional']);
  [requestedNow, safetyClear, historyAllowed, alreadyReviewed].forEach(bool);
  oneOf(dimension, DIMENSIONS);
  listOfIds(supportIds);
  listOfIds(counterIds);
  if (!Array.isArray(evidence)) throw new TypeError('Expected evidence array');
  if (supportIds.some(id => counterIds.includes(id))) throw new TypeError('Conflicting reference roles');
  const byId = new Map();
  for (const observation of evidence) {
    record(observation, ['id', 'scope', 'episodeId', 'period', 'dimension', 'source', 'status', 'assessment']);
    ['id', 'scope', 'episodeId'].forEach(key => text(observation[key]));
    oneOf(observation.period, ['earlier', 'recent']);
    oneOf(observation.dimension, DIMENSIONS);
    oneOf(observation.source, ['user_report', 'assistant_inference']);
    oneOf(observation.status, ['active', 'corrected', 'revoked']);
    oneOf(observation.assessment, ['supports', 'complicates', 'unclear']);
    if (byId.has(observation.id)) throw new TypeError('Duplicate evidence ID');
    byId.set(observation.id, observation);
  }
  if (!safetyClear) return result(false, 'DEFER_TO_EXISTING_SAFETY_ROUTE');
  if (!historyAllowed) return result(false, 'HISTORY_PERMISSION_REQUIRED');
  if (preference === 'off' || (preference === 'on_request' && !requestedNow)) {
    return result(false, 'REFLECTION_NOT_REQUESTED_OR_ENABLED');
  }
  if (alreadyReviewed && !requestedNow) return result(false, 'NO_REPEAT_PROGRESS_CHECK');
  if (evidence.some(item => item.scope !== scope)) return result(false, 'SCOPE_MISMATCH');
  const support = supportIds.map(id => byId.get(id));
  const counter = counterIds.map(id => byId.get(id));
  if ([...support, ...counter].some(item => !item || item.status !== 'active' ||
      item.source !== 'user_report' || item.dimension !== dimension)) {
    return result(false, 'REFERENCE_NOT_CURRENT_REPORTED_EVIDENCE');
  }
  if (support.some(item => item.assessment !== 'supports') ||
      counter.some(item => item.assessment === 'supports')) {
    return result(false, 'REFERENCE_ASSESSMENT_MISMATCH');
  }
  const omitted = evidence.some(item => item.status === 'active' && item.source === 'user_report' &&
    item.dimension === dimension && item.assessment !== 'supports' && !counterIds.includes(item.id));
  if (omitted) return result(false, 'COMPLICATING_EVIDENCE_MUST_BE_INCLUDED');
  const early = support.filter(item => item.period === 'earlier');
  const recent = support.filter(item => item.period === 'recent');
  if (!early.some(a => recent.some(b => a.episodeId !== b.episodeId))) {
    return result(false, 'DISTINCT_EARLIER_AND_RECENT_EPISODES_REQUIRED');
  }
  return result(true, counter.length ? 'TENTATIVE_MIXED_REFLECTION_ONLY' : 'TENTATIVE_REFLECTION_ONLY');
}

/** At most one optional judgment-practice question; concrete help is never withheld. */
export function supportMode(input) {
  record(input, ['safetyClear', 'wantsPractice', 'ready', 'needsConcreteHelp', 'alreadyAsked']);
  const { safetyClear, wantsPractice, ready, needsConcreteHelp, alreadyAsked } = input;
  [safetyClear, wantsPractice, ready, needsConcreteHelp, alreadyAsked].forEach(bool);
  if (!safetyClear) return 'EXISTING_SAFETY_SUPPORT';
  if (needsConcreteHelp || !wantsPractice || !ready || alreadyAsked) return 'DIRECT_SUPPORT';
  return 'ONE_OPTIONAL_SELF_GUIDANCE_QUESTION';
}

/**
 * Controls an optional suggestion, never permission to leave or end clinical care.
 * Treatment attendance, founder agreement, spiritual identity and modality use
 * are deliberately not accepted as prerequisites for stepping back from the app.
 */
export function stepBackDecision(input) {
  record(input, ['requestedNow', 'safetyClear', 'goalMetReported', 'workablePlanReported', 'wantsReview']);
  const { requestedNow, safetyClear, goalMetReported, workablePlanReported, wantsReview } = input;
  [requestedNow, safetyClear, goalMetReported, workablePlanReported, wantsReview].forEach(bool);
  if (requestedNow) return {
    mayLeave: true, suggest: false,
    reason: safetyClear ? 'RESPECT_EXIT' : 'RESPECT_EXIT_AND_OFFER_EXISTING_SAFETY_SUPPORT'
  };
  return {
    mayLeave: true,
    suggest: safetyClear && goalMetReported && workablePlanReported && wantsReview,
    reason: safetyClear && goalMetReported && workablePlanReported && wantsReview
      ? 'OPTIONAL_STEP_BACK_NOT_HEALING_CERTIFICATE' : 'NO_AUTOMATIC_EXIT_OR_RETENTION_JUDGMENT'
  };
}
