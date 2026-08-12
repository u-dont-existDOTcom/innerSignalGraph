export const DEV_FAILURE = Object.freeze({
  IMPLEMENTATION_FAILURE: "IMPLEMENTATION_FAILURE",
  DETERMINISTIC_VERIFICATION_FAILURE: "DETERMINISTIC_VERIFICATION_FAILURE",
  REVIEW_REJECTION: "REVIEW_REJECTION",
  REVIEW_TIMEOUT: "REVIEW_TIMEOUT",
  WORKER_TOOLING_LIMITATION: "WORKER_TOOLING_LIMITATION",
  LIVE_REGRESSION_FAILURE: "LIVE_REGRESSION_FAILURE",
  LIVE_REGRESSION_TIMEOUT: "LIVE_REGRESSION_TIMEOUT",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  HUMAN_POLICY_REQUIRED: "HUMAN_POLICY_REQUIRED",
  MISSING_INPUT: "MISSING_INPUT"
});

const IMPLEMENTATION_BUDGET_CLASSES = new Set([
  DEV_FAILURE.IMPLEMENTATION_FAILURE,
  DEV_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE,
  DEV_FAILURE.REVIEW_REJECTION
]);

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const parts = [value.message, value.blocker, value.summary, value.code, value?.details?.stderr, value?.details?.stdout]
    .filter(Boolean)
    .map(String);
  return parts.join("\n");
}

export function isTimeoutFailure(value) {
  return /timed out|timeout/i.test(textOf(value));
}

export function isWorkerToolingLimitation(value) {
  return /(sandbox|permission|approval|tool(?:ing)? limitation|not permitted|could not run|cannot run|unable to run).{0,120}(npm|node|test|bash|command)|(?:npm|node|test|bash|command).{0,120}(sandbox|permission|approval|not permitted|could not run|cannot run|unable to run)/i.test(textOf(value));
}

export function isAuthFailure(value) {
  const text = textOf(value);
  return /oauth|refresh token|re-?auth|authentication|not logged in|login required/i.test(text) && /expired|failed|invalid|required|login|auth/i.test(text);
}

export function classifyDevelopmentFailure(value, { phase = "" } = {}) {
  if (value?.failureClass && Object.values(DEV_FAILURE).includes(value.failureClass)) return value.failureClass;
  if (isAuthFailure(value)) return DEV_FAILURE.AUTH_REQUIRED;
  if (phase.includes("review") && isTimeoutFailure(value)) return DEV_FAILURE.REVIEW_TIMEOUT;
  if (phase === "implementer" && isWorkerToolingLimitation(value)) return DEV_FAILURE.WORKER_TOOLING_LIMITATION;
  if (phase === "independent-review" && value?.verdict === "reject") return DEV_FAILURE.REVIEW_REJECTION;
  if (phase === "deterministic-verification" || phase === "deterministic-gates") return DEV_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE;
  if ((phase === "live-regression" || phase === "exact-case-replay") && isTimeoutFailure(value)) return DEV_FAILURE.LIVE_REGRESSION_TIMEOUT;
  if (phase === "live-regression" || phase === "exact-case-replay") return DEV_FAILURE.LIVE_REGRESSION_FAILURE;
  if (phase === "human-policy") return DEV_FAILURE.HUMAN_POLICY_REQUIRED;
  if (phase === "missing-input") return DEV_FAILURE.MISSING_INPUT;
  return DEV_FAILURE.IMPLEMENTATION_FAILURE;
}

export function consumesImplementationCycle(failureClass) {
  return IMPLEMENTATION_BUDGET_CLASSES.has(failureClass);
}

export function normalizeImplementerResult(result) {
  if (!result || typeof result !== "object") return result;
  if (result.status === "blocked" && Array.isArray(result.changed_files) && result.changed_files.length > 0 && isWorkerToolingLimitation(result)) {
    return {
      ...result,
      status: "implemented",
      controller_verification_required: true,
      original_status: "blocked",
      worker_tooling_limitation: result.blocker || result.summary || "Model-side tooling could not run verification."
    };
  }
  return { ...result, controller_verification_required: result.controller_verification_required ?? false };
}
