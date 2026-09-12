export function replayReviewRequiresRetry(replayReview) {
  return replayReview?.verdict === "not-improved"
    || (replayReview?.verdict !== "human-decision" && replayReview?.addresses_feedback !== true)
    || replayReview?.preserves_prior_strengths !== true
    || replayReview?.introduces_new_overclaim === true;
}
