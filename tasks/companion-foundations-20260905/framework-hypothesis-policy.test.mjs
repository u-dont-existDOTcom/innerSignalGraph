import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameworkExplorationDecision,
  personalFrameworkStatus,
  globalFrameworkPromotionDecision,
  FRAMEWORK_COMPARISON_QUESTIONS
} from './framework-hypothesis-policy.mjs';

const explore = overrides => ({
  wantsExplore: true,
  safetyClear: true,
  claimType: 'functional_hypothesis',
  conflictsWithCurrentFramework: true,
  ...overrides
});

test('conflict with current founder framework is not an exploration veto', () => {
  const result = frameworkExplorationDecision(explore({}));
  assert.deepEqual(result, { allowed: true, mode: 'TEST_AS_WORKING_HYPOTHESIS' });
});

test('metaphor can be used without turning it into a factual ontology', () => {
  assert.deepEqual(
    frameworkExplorationDecision(explore({ claimType: 'metaphor' })),
    { allowed: true, mode: 'USE_AS_PERSONAL_METAPHOR' }
  );
});

test('literal extraordinary claim may be explored without authentication', () => {
  assert.deepEqual(
    frameworkExplorationDecision(explore({ claimType: 'literal_factual_claim' })),
    { allowed: true, mode: 'EXPLORE_MEANING_WITHOUT_AUTHENTICATING_LITERAL_CLAIM' }
  );
  assert.equal(
    personalFrameworkStatus({
      claimType: 'literal_factual_claim',
      hasDiscriminatingPrediction: true,
      distinctSupportingEpisodes: 10,
      hasMaterialCounterevidence: false
    }),
    'FUNCTIONAL_USE_MAY_BE_TESTED_LITERAL_CLAIM_REMAINS_UNESTABLISHED'
  );
});

test('functional hypothesis moves from testable to repeated personal pattern without becoming global policy', () => {
  const base = {
    claimType: 'functional_hypothesis',
    hasDiscriminatingPrediction: true,
    hasMaterialCounterevidence: false
  };
  assert.equal(personalFrameworkStatus({ ...base, distinctSupportingEpisodes: 1 }), 'TESTABLE_PERSONAL_HYPOTHESIS');
  assert.equal(personalFrameworkStatus({ ...base, distinctSupportingEpisodes: 3 }), 'REPEATED_PERSONAL_PATTERN_NOT_GLOBAL_POLICY');
});

test('counterevidence remains visible rather than being assimilated into a success story', () => {
  assert.equal(
    personalFrameworkStatus({
      claimType: 'functional_hypothesis',
      hasDiscriminatingPrediction: true,
      distinctSupportingEpisodes: 5,
      hasMaterialCounterevidence: true
    }),
    'MIXED_PERSONAL_HYPOTHESIS'
  );
});

test('a vague functional hypothesis needs a discriminating prediction before stronger status', () => {
  assert.equal(
    personalFrameworkStatus({
      claimType: 'functional_hypothesis',
      hasDiscriminatingPrediction: false,
      distinctSupportingEpisodes: 12,
      hasMaterialCounterevidence: false
    }),
    'WORKING_HYPOTHESIS_NEEDS_DISCRIMINATING_PREDICTION'
  );
});

test('no combination of task-local evidence automatically promotes global therapy policy', () => {
  assert.deepEqual(
    globalFrameworkPromotionDecision({
      personalSupport: true,
      independentEvidence: true,
      privacyAuthorized: true,
      governanceReviewed: true
    }),
    { allowed: false, reason: 'SEPARATE_PRODUCT_POLICY_DECISION_REQUIRED' }
  );
  assert.equal(
    globalFrameworkPromotionDecision({
      personalSupport: true,
      independentEvidence: false,
      privacyAuthorized: true,
      governanceReviewed: true
    }).allowed,
    false
  );
});

test('framework comparison uses questions rather than a pseudo-precise healing score', () => {
  assert.equal(FRAMEWORK_COMPARISON_QUESTIONS.length, 6);
  assert.ok(FRAMEWORK_COMPARISON_QUESTIONS.some(text => /predict/i.test(text)));
  assert.ok(FRAMEWORK_COMPARISON_QUESTIONS.some(text => /count against/i.test(text)));
  assert.ok(FRAMEWORK_COMPARISON_QUESTIONS.some(text => /literal factual/i.test(text)));
  assert.equal(FRAMEWORK_COMPARISON_QUESTIONS.some(text => /%|score|percent/i.test(text)), false);
});

test('invalid or unsafe exploration fails closed', () => {
  assert.equal(frameworkExplorationDecision(explore({ safetyClear: false })).allowed, false);
  assert.equal(frameworkExplorationDecision(explore({ wantsExplore: false })).allowed, false);
  assert.equal(frameworkExplorationDecision(explore({ claimType: 'mystery' })).allowed, false);
});
