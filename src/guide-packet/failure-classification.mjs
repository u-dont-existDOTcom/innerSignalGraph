export const GUIDE_PACKET_FAILURE = Object.freeze({
  MODEL_TIMEOUT: "MODEL_TIMEOUT",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  MALFORMED_MODEL_RESULT: "MALFORMED_MODEL_RESULT",
  DETERMINISTIC_VERIFICATION_FAILURE: "DETERMINISTIC_VERIFICATION_FAILURE",
  PACKET_INTEGRITY_FAILURE: "PACKET_INTEGRITY_FAILURE",
  REVIEW_REJECTION: "REVIEW_REJECTION",
  STALE_STAGE: "STALE_STAGE",
  OWNER_DECISION_REQUIRED: "OWNER_DECISION_REQUIRED"
});

function errorText(error) {
  return [
    error?.name,
    error?.message,
    error?.code,
    error?.details?.message,
    error?.details?.stderr,
    error?.cause?.message
  ].filter(Boolean).map(String).join("\n");
}

export function classifyGuidePacketFailure(error, { phase = "" } = {}) {
  const normalizedPhase = String(phase).toLowerCase();
  const text = errorText(error);
  if (normalizedPhase.includes("owner-decision")) return GUIDE_PACKET_FAILURE.OWNER_DECISION_REQUIRED;
  if (normalizedPhase.includes("stale-stage")) return GUIDE_PACKET_FAILURE.STALE_STAGE;
  if (normalizedPhase.includes("review-rejection")) return GUIDE_PACKET_FAILURE.REVIEW_REJECTION;
  if (normalizedPhase.includes("packet-integrity")) return GUIDE_PACKET_FAILURE.PACKET_INTEGRITY_FAILURE;
  if (normalizedPhase.includes("deterministic-verification")) return GUIDE_PACKET_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE;
  if (/timed out|timeout/i.test(text)) return GUIDE_PACKET_FAILURE.MODEL_TIMEOUT;
  if (/oauth|refresh token|re-?auth|authentication|not logged in|login required/i.test(text)
    && /expired|failed|invalid|required|login|auth/i.test(text)) return GUIDE_PACKET_FAILURE.AUTH_REQUIRED;
  if (/malformed|invalid json|json envelope|structured output|output schema|empty final message|no structured output|parse/i.test(text)) {
    return GUIDE_PACKET_FAILURE.MALFORMED_MODEL_RESULT;
  }
  if (/unavailable|not available|could not start|command not found|no such file|required exact model|model.*(?:denied|unsupported)|exited with status/i.test(text)) {
    return GUIDE_PACKET_FAILURE.MODEL_UNAVAILABLE;
  }
  return GUIDE_PACKET_FAILURE.MODEL_UNAVAILABLE;
}

export function normalizeGuidePacketError(error, failureClass, { at = new Date().toISOString() } = {}) {
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || "GUIDE_PACKET_STAGE_FAILED"),
    message: String(error?.message || error || "Guide Packet stage failed."),
    failureClass,
    at
  };
}
