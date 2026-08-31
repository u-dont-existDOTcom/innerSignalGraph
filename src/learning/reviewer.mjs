import { REVIEW_ACTIONS, REVIEW_CARD_FORMAT, validateLessonCandidate, validateReviewCard } from "./contracts.mjs";

export function createReviewCard({ candidate, candidateReceipt, occurrenceCount, contradictionCounts }) {
  validateLessonCandidate(candidate);
  return validateReviewCard({
    format: REVIEW_CARD_FORMAT,
    candidateReceipt,
    status: "needs-review",
    candidateKind: candidate.candidateKind,
    evidenceClass: candidate.evidenceClass,
    causalBoundary: candidate.causalBoundary,
    subjectKey: candidate.subjectKey,
    generalizedObservation: candidate.generalizedSignal,
    proposedInvariant: candidate.proposedInvariant,
    proposedRegression: candidate.syntheticRegressionExample,
    occurrenceCount,
    contradictionCounts: structuredClone(contradictionCounts),
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none",
    availableReviewActions: [...REVIEW_ACTIONS]
  });
}
