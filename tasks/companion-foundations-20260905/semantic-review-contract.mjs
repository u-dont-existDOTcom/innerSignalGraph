/**
 * Deterministic adapter between a structured substantive review and the
 * reflection controller's in-process approval binding.
 *
 * It calls no model and stores no history. The reviewer supplies criterion
 * verdicts; the trusted caller supplies applicability and opaque bindings.
 */
export const UNIVERSAL_SEMANTIC_CRITERIA = Object.freeze([
  'evidence_fidelity',
  'uncertainty_calibration',
  'consent_correction_worldview',
  'non_sycophancy',
  'accountability_proportionality',
  'founder_independence',
  'autonomy_non_dependency'
]);

export const CONDITIONAL_SEMANTIC_CRITERIA = Object.freeze([
  'progress_balance',
  'spiritual_epistemic_humility',
  'self_guidance_scrutiny',
  'safety_support_continuity'
]);

const VERDICTS = Object.freeze(['pass', 'revise', 'block']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const frozen = value => Object.freeze(value);

const denial = (reason, criteria = []) => frozen({ approved: false, reason, criteria: frozen([...criteria]) });

export function adjudicateSemanticReview({ review, requiredConditional = [], candidate, version, reviewBinding } = {}) {
  if (!plain(review) || !exactKeys(review, ['criteria']) || !Array.isArray(review.criteria)) {
    return denial('INVALID_SEMANTIC_REVIEW');
  }
  if (!Array.isArray(requiredConditional) || new Set(requiredConditional).size !== requiredConditional.length ||
      requiredConditional.some(id => !CONDITIONAL_SEMANTIC_CRITERIA.includes(id))) {
    return denial('INVALID_REQUIRED_CRITERIA');
  }
  if (!plain(candidate) || typeof candidate.text !== 'string' || !candidate.text.trim() ||
      !version || typeof version !== 'object' || !reviewBinding || typeof reviewBinding !== 'object') {
    return denial('INVALID_REVIEW_BINDING');
  }

  const required = [...UNIVERSAL_SEMANTIC_CRITERIA, ...requiredConditional];
  const byId = new Map();
  for (const item of review.criteria) {
    if (!plain(item) || !exactKeys(item, ['id', 'verdict']) || typeof item.id !== 'string' ||
        !VERDICTS.includes(item.verdict) || byId.has(item.id) || !required.includes(item.id)) {
      return denial('INVALID_CRITERION_RESULT');
    }
    byId.set(item.id, item.verdict);
  }
  if (required.some(id => !byId.has(id)) || byId.size !== required.length) {
    return denial('INCOMPLETE_SEMANTIC_REVIEW');
  }

  const blocked = required.filter(id => byId.get(id) === 'block');
  if (blocked.length) return denial('SEMANTIC_BLOCK', blocked);
  const revise = required.filter(id => byId.get(id) === 'revise');
  if (revise.length) return denial('SEMANTIC_REVISION_REQUIRED', revise);

  // The model/reviewer never has to serialize or recreate object identity.
  // This deterministic adapter binds an all-pass review to the exact objects
  // supplied by the controller in the current process.
  return frozen({ approved: true, candidate, version, reviewBinding });
}
