export const CONSENT_POLICY_OPTIONS = Object.freeze(["local-only", "per-candidate", "conversation-standing"]);
export const CURRENT_CONSENT_POLICY = "local-only";
export const CONSENT_STATES = Object.freeze(["captured-local", "adjudicated-local", "generalized-preview-ready", "consent-not-authorized", "consent-denied", "future-consent-placeholder"]);

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
