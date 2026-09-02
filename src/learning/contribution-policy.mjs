export const CONTRIBUTION_POLICY_FORMAT = "inner-signal-contribution-policy-v1";
export const CURRENT_CONTRIBUTION_POLICY_ID = "default-on-per-candidate-refusal";
export const PAID_GLOBAL_CONTRIBUTION_SETTING = "UNSPECIFIED_PENDING_FUTURE_BILLING_UI_DECISION";

export const CURRENT_CONTRIBUTION_POLICY = Object.freeze({
  format: CONTRIBUTION_POLICY_FORMAT,
  policyId: CURRENT_CONTRIBUTION_POLICY_ID,
  candidateScope: "privacy-screened-generalized-candidates-only",
  rawTherapyChatEligible: false,
  freeUserProviderPath: "user-owned-chatgpt-account",
  freeContributionMode: "default-on-per-candidate-refusal",
  candidatePreviewRequired: true,
  refusalCost: "free",
  refusalScope: "current-candidate-only",
  refusalReducesAccess: false,
  freeGlobalContributionDisableAvailable: false,
  paidApiProviderPath: "innersignal-controlled-openai-api-account",
  paidApiRequiresPayment: true,
  paidGlobalContributionDisableAvailable: true,
  paidGlobalContributionSetting: PAID_GLOBAL_CONTRIBUTION_SETTING,
  candidateTransmissionEnabled: false,
  existingCandidateBackfillEnabled: false,
  runtimePersonalizationEnabled: false,
  therapyPolicyActivated: false,
  therapyPolicyAuthority: "none",
  releaseAuthorized: false
});

export function contributionAccessResult({ userTier, candidateRefused = false, paidGlobalDisable = undefined } = {}) {
  if (!['free', 'paid-api'].includes(userTier)) throw new TypeError('userTier must be free or paid-api.');
  if (typeof candidateRefused !== 'boolean') throw new TypeError('candidateRefused must be boolean.');
  if (paidGlobalDisable !== undefined && typeof paidGlobalDisable !== 'boolean') throw new TypeError('paidGlobalDisable must be boolean or unspecified.');
  if (userTier === 'free' && paidGlobalDisable !== undefined) throw new TypeError('Free-tier policy has no global contribution-disable control.');
  return Object.freeze({
    userTier,
    candidateRefused,
    paidGlobalDisable: userTier === 'paid-api' ? paidGlobalDisable ?? PAID_GLOBAL_CONTRIBUTION_SETTING : "not-available",
    accessReduced: false,
    candidateContributionEligible: !candidateRefused && !(userTier === 'paid-api' && paidGlobalDisable === true),
    candidateTransmissionEnabled: false,
    therapyPolicyAuthority: "none"
  });
}
