import { candidateFingerprint } from "./fingerprint.mjs";
import { validateLessonCandidate, validateOwnerDecisionReference } from "./contracts.mjs";

export function evaluatePromotionEligibility({ candidate, ownerDecisionReference, regressionState } = {}) {
  const reasons = [];
  try {
    validateLessonCandidate(candidate);
  } catch {
    reasons.push("INVALID_CANDIDATE");
  }
  let fingerprint = null;
  if (!reasons.includes("INVALID_CANDIDATE")) fingerprint = candidateFingerprint(candidate);
  if (!ownerDecisionReference) reasons.push("MISSING_OWNER_DECISION_REFERENCE");
  else {
    try {
      validateOwnerDecisionReference(ownerDecisionReference);
      if (ownerDecisionReference.decision !== "approved") reasons.push("OWNER_DECISION_NOT_APPROVED");
      if (fingerprint && ownerDecisionReference.candidateFingerprint !== fingerprint) reasons.push("CANDIDATE_FINGERPRINT_MISMATCH");
    } catch {
      reasons.push("INVALID_OWNER_DECISION_REFERENCE");
    }
  }
  if (!regressionState || typeof regressionState !== "object" || Array.isArray(regressionState)) reasons.push("MISSING_REGRESSION_STATE");
  else {
    if (regressionState.failedBeforeImplementation !== true) reasons.push("REGRESSION_DID_NOT_FAIL_BEFORE");
    if (regressionState.passesAfterImplementation !== true) reasons.push("REGRESSION_DOES_NOT_PASS_AFTER");
    if (regressionState.implementationVerificationComplete !== true) reasons.push("IMPLEMENTATION_NOT_VERIFIED");
  }
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
    writePerformed: false,
    activationPerformed: false,
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none"
  });
}
