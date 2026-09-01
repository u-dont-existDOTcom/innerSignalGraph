export const CONSENT_POLICY_OPTIONS = Object.freeze(["local-only", "per-candidate", "conversation-standing"]);
export const CURRENT_CONSENT_POLICY = "local-only";
export const CONSENT_STATES = Object.freeze(["captured-local", "adjudicated-local", "generalized-preview-ready", "consent-not-authorized", "consent-denied", "future-consent-placeholder"]);
export const CONTRIBUTION_STATES = Object.freeze([
  "generalized-candidate-ready",
  "preview-required",
  "default-contribution-pending-release",
  "candidate-refused",
  "blocked-live-transport-disabled"
]);

export function modelConsentState({ policy = CURRENT_CONSENT_POLICY, state = "captured-local", userDenied = false } = {}) {
  if (!CONSENT_POLICY_OPTIONS.includes(policy)) throw new TypeError("Unknown consent policy option.");
  if (!CONSENT_STATES.includes(state)) throw new TypeError("Unknown consent state.");
  const nextState = userDenied ? "consent-denied" : policy === CURRENT_CONSENT_POLICY ? "consent-not-authorized" : "future-consent-placeholder";
  return Object.freeze({
    policy,
    currentPolicy: CURRENT_CONSENT_POLICY,
    inputState: state,
    state: nextState,
    canTransmit: false,
    standingConsentPersisted: false,
    transmissionAuthority: "none"
  });
}

export function modelContributionState({ state = "generalized-candidate-ready", candidatePreviewed = false, candidateRefused = false } = {}) {
  if (!CONTRIBUTION_STATES.includes(state)) throw new TypeError("Unknown contribution state.");
  if (typeof candidatePreviewed !== "boolean" || typeof candidateRefused !== "boolean") throw new TypeError("Contribution state flags must be boolean.");
  if (candidateRefused && !candidatePreviewed) throw new TypeError("A candidate cannot be refused before its generalized preview is shown.");

  let nextState;
  if (state === "candidate-refused") nextState = "candidate-refused";
  else if (state === "blocked-live-transport-disabled") nextState = "blocked-live-transport-disabled";
  else if (!candidatePreviewed) nextState = "preview-required";
  else if (candidateRefused) nextState = "candidate-refused";
  else if (state === "default-contribution-pending-release") nextState = "blocked-live-transport-disabled";
  else nextState = "default-contribution-pending-release";

  return Object.freeze({
    policy: "default-on-per-candidate-refusal",
    inputState: state,
    state: nextState,
    previewRequired: true,
    previewShown: candidatePreviewed,
    candidateRefused,
    refusalCost: "free",
    accessReduced: false,
    standingFreeOptOutPersisted: false,
    canTransmit: false,
    candidateTransmissionEnabled: false,
    transmissionAuthority: "none",
    therapyPolicyAuthority: "none"
  });
}
