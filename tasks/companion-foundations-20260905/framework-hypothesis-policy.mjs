/**
 * Offline policy for user-proposed explanatory/therapeutic frameworks.
 *
 * This module does not decide clinical truth, diagnose, call a model, persist
 * history, aggregate users, or promote product policy. It only keeps metaphor,
 * personal hypothesis, literal factual claim, and global-policy authority apart.
 */
const CLAIM_TYPES = Object.freeze(['metaphor', 'functional_hypothesis', 'literal_factual_claim']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const bool = value => typeof value === 'boolean';
const integer = value => Number.isInteger(value) && value >= 0;
const result = value => Object.freeze(value);

export function frameworkExplorationDecision(input) {
  const keys = ['wantsExplore', 'safetyClear', 'claimType', 'conflictsWithCurrentFramework'];
  if (!exact(input, keys) || !bool(input.wantsExplore) || !bool(input.safetyClear) ||
      !bool(input.conflictsWithCurrentFramework) || !CLAIM_TYPES.includes(input.claimType)) {
    return result({ allowed: false, mode: 'INVALID_INPUT' });
  }
  if (!input.safetyClear) return result({ allowed: false, mode: 'DEFER_TO_EXISTING_SAFETY_ROUTE' });
  if (!input.wantsExplore) return result({ allowed: false, mode: 'USER_NOT_REQUESTING_EXPLORATION' });

  // Conflict with the founder framework is deliberately not a veto.
  if (input.claimType === 'metaphor') return result({ allowed: true, mode: 'USE_AS_PERSONAL_METAPHOR' });
  if (input.claimType === 'functional_hypothesis') return result({ allowed: true, mode: 'TEST_AS_WORKING_HYPOTHESIS' });
  return result({ allowed: true, mode: 'EXPLORE_MEANING_WITHOUT_AUTHENTICATING_LITERAL_CLAIM' });
}

export function personalFrameworkStatus(input) {
  const keys = ['claimType', 'hasDiscriminatingPrediction', 'distinctSupportingEpisodes', 'hasMaterialCounterevidence'];
  if (!exact(input, keys) || !CLAIM_TYPES.includes(input.claimType) ||
      !bool(input.hasDiscriminatingPrediction) || !integer(input.distinctSupportingEpisodes) ||
      !bool(input.hasMaterialCounterevidence)) {
    return 'INVALID_INPUT';
  }

  if (input.claimType === 'literal_factual_claim') {
    // Repeated subjective fit can support usefulness without establishing ontology.
    return input.hasDiscriminatingPrediction
      ? 'FUNCTIONAL_USE_MAY_BE_TESTED_LITERAL_CLAIM_REMAINS_UNESTABLISHED'
      : 'LITERAL_CLAIM_REMAINS_UNESTABLISHED';
  }
  if (input.claimType === 'metaphor') return 'PERSONAL_METAPHOR';
  if (!input.hasDiscriminatingPrediction) return 'WORKING_HYPOTHESIS_NEEDS_DISCRIMINATING_PREDICTION';
  if (input.hasMaterialCounterevidence) return 'MIXED_PERSONAL_HYPOTHESIS';
  if (input.distinctSupportingEpisodes < 2) return 'TESTABLE_PERSONAL_HYPOTHESIS';
  return 'REPEATED_PERSONAL_PATTERN_NOT_GLOBAL_POLICY';
}

export function globalFrameworkPromotionDecision(input) {
  const keys = ['personalSupport', 'independentEvidence', 'privacyAuthorized', 'governanceReviewed'];
  if (!exact(input, keys) || keys.some(key => !bool(input[key]))) {
    return result({ allowed: false, reason: 'INVALID_INPUT' });
  }

  // This task has no authority to alter the canonical therapy map. Even strong
  // inputs only justify a separately governed proposal, never auto-promotion.
  if (input.personalSupport && input.independentEvidence && input.privacyAuthorized && input.governanceReviewed) {
    return result({ allowed: false, reason: 'SEPARATE_PRODUCT_POLICY_DECISION_REQUIRED' });
  }
  return result({ allowed: false, reason: 'INSUFFICIENT_FOR_PRODUCT_POLICY_PROPOSAL' });
}

export const FRAMEWORK_COMPARISON_QUESTIONS = Object.freeze([
  'What does this framework explain that the current one does not?',
  'What does it predict before the outcome is known?',
  'What observation would count against it?',
  'Does it suggest a different action or experiment?',
  'Does the useful pattern repeat across distinct situations?',
  'Which claims are metaphorical or functional, and which are literal factual claims needing separate evidence?'
]);
