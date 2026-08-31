export const FEEDBACK_FORMAT = "inner-signal-feedback-evidence-v1";
export const PERSONALIZATION_FORMAT = "inner-signal-user-personalization-v1";
export const CANDIDATE_FORMAT = "inner-signal-generalized-lesson-candidate-v1";
export const REVIEW_CARD_FORMAT = "inner-signal-learning-review-card-v1";
export const OWNER_DECISION_REFERENCE_FORMAT = "inner-signal-owner-decision-reference-v1";

export const FEEDBACK_CLASSES = Object.freeze([
  "style-process-preference",
  "case-outcome-observation",
  "factual-correction",
  "therapy-policy-or-safety-signal",
  "unsupported-disagreement",
  "agreement-reassurance-diagnosis-dependency-request",
  "unresolved"
]);
export const EVIDENCE_CLASSES = Object.freeze([
  "self-authenticating-preference",
  "participant-reported",
  "independently-verified-fact",
  "existing-contract-violation",
  "therapy-policy-signal-unverified",
  "safety-signal-unverified",
  "unsupported-disagreement",
  "ineligible"
]);
export const CAUSAL_BOUNDARIES = Object.freeze([
  "not-applicable",
  "participant-report-only-no-causal-inference",
  "independently-verified-fact",
  "existing-contract-violation",
  "unresolved"
]);
export const OUTCOME_DIRECTIONS = Object.freeze(["benefit", "no-change", "mixed", "worsening", "unclear", "not-applicable"]);
export const CANDIDATE_KINDS = Object.freeze(["validated-defect", "participant-outcome", "therapy-policy-signal", "safety-signal", "style-process"]);
export const REVIEW_ACTIONS = Object.freeze(["reject", "insufficient-evidence", "duplicate", "personalization-process-only", "needs-external-evidence", "prepare-therapy-policy-decision"]);

const FEEDBACK_KEYS = Object.freeze(["format", "feedbackId", "feedbackClass", "validationStatus", "evidenceClass", "generalizedSignal", "expectedBehavior", "failureReason", "syntheticRegressionExample", "policySurface", "subjectKey", "outcomeDirection", "causalBoundary", "evidenceBasis", "versionContext", "runtimeAuthority", "therapyPolicyAuthority", "transmissionAuthority"]);
const MEMORY_KEYS = Object.freeze(["format", "memoryId", "memoryType", "generalizedValue", "provenance", "status", "consentStatus", "createdAt", "lastConfirmedAt", "reviewAfter", "authority", "overrideClass", "runtimeConsumerPresent"]);
const CANDIDATE_KEYS = Object.freeze(["format", "candidateKind", "subjectKey", "generalizedSignal", "proposedInvariant", "expectedBehavior", "failureReason", "syntheticRegressionExample", "evidenceClass", "validationBasis", "policySurface", "outcomeDirection", "causalBoundary", "contextTags", "versionIdentifiers", "runtimeAuthority", "therapyPolicyAuthority", "transmissionAuthority"]);
const REVIEW_CARD_KEYS = Object.freeze(["format", "candidateReceipt", "status", "candidateKind", "evidenceClass", "causalBoundary", "subjectKey", "generalizedObservation", "proposedInvariant", "proposedRegression", "occurrenceCount", "contradictionCounts", "runtimeAuthority", "therapyPolicyAuthority", "availableReviewActions"]);
const OWNER_REFERENCE_KEYS = Object.freeze(["format", "sourceLedger", "decisionId", "candidateFingerprint", "decision", "receiptSha256"]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function exactKeys(value, allowed, label) {
  const actual = Object.keys(value);
  const unexpected = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !actual.includes(key));
  if (unexpected.length || missing.length) throw new TypeError(`${label} has unsupported or missing fields.`);
}

function text(value, label, { allowEmpty = false, max = 500 } = {}) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.length === 0)) throw new TypeError(`${label} must be a bounded string.`);
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) throw new TypeError(`${label} must remain ${String(expected)}.`);
}

function stringArray(value, label, { min = 0, max = 12 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max || new Set(value).size !== value.length) throw new TypeError(`${label} must be a bounded unique array.`);
  value.forEach((item, index) => text(item, `${label}[${index}]`, { max: 160 }));
  return value;
}

function authorityNone(value) {
  exact(value.runtimeAuthority, "none", "runtimeAuthority");
  exact(value.therapyPolicyAuthority, "none", "therapyPolicyAuthority");
  exact(value.transmissionAuthority, "none", "transmissionAuthority");
}

export function validateFeedbackEvidence(value) {
  record(value, "feedback evidence");
  exactKeys(value, FEEDBACK_KEYS, "feedback evidence");
  exact(value.format, FEEDBACK_FORMAT, "format");
  text(value.feedbackId, "feedbackId", { max: 80 });
  oneOf(value.feedbackClass, FEEDBACK_CLASSES, "feedbackClass");
  oneOf(value.validationStatus, ["unreviewed", "participant-report", "validated", "ineligible"], "validationStatus");
  oneOf(value.evidenceClass, EVIDENCE_CLASSES, "evidenceClass");
  text(value.generalizedSignal, "generalizedSignal");
  text(value.expectedBehavior, "expectedBehavior");
  text(value.failureReason, "failureReason", { allowEmpty: true });
  text(value.syntheticRegressionExample, "syntheticRegressionExample");
  oneOf(value.policySurface, ["presentation", "process", "factual", "outcome", "therapy-policy", "safety"], "policySurface");
  text(value.subjectKey, "subjectKey", { max: 80 });
  oneOf(value.outcomeDirection, OUTCOME_DIRECTIONS, "outcomeDirection");
  oneOf(value.causalBoundary, CAUSAL_BOUNDARIES, "causalBoundary");
  stringArray(value.evidenceBasis, "evidenceBasis", { max: 8 });
  record(value.versionContext, "versionContext");
  exactKeys(value.versionContext, ["appVersion", "contractVersion"], "versionContext");
  text(value.versionContext.appVersion, "versionContext.appVersion", { max: 40 });
  exact(value.versionContext.contractVersion, "offline-groundwork-v1", "versionContext.contractVersion");
  authorityNone(value);
  if (value.evidenceClass === "participant-reported" && value.causalBoundary !== "participant-report-only-no-causal-inference") throw new TypeError("Participant-reported evidence must remain explicitly noncausal.");
  if (value.feedbackClass === "unsupported-disagreement" && value.evidenceClass !== "unsupported-disagreement") throw new TypeError("Unsupported disagreement cannot become verified evidence.");
  if (value.feedbackClass === "style-process-preference" && value.evidenceClass !== "self-authenticating-preference") throw new TypeError("Style/process feedback is self-authenticating only as a preference.");
  if (value.feedbackClass === "agreement-reassurance-diagnosis-dependency-request" && value.evidenceClass !== "ineligible") throw new TypeError("Agreement, diagnosis, and dependency requests are ineligible.");
  return value;
}

const PROHIBITED_MEMORY = [
  /diagnos(?:is|e)/i,
  /global therapy rule/i,
  /(?:caused|proves?) (?:this|that) (?:outcome|result)/i,
  /third[- ]party character/i,
  /always agree/i,
  /ignore safety/i,
  /ignore evidence/i,
  /recovered[- ]memory certainty/i
];

export function validatePersonalizationMemory(value) {
  record(value, "personalization memory");
  exactKeys(value, MEMORY_KEYS, "personalization memory");
  exact(value.format, PERSONALIZATION_FORMAT, "format");
  text(value.memoryId, "memoryId", { max: 80 });
  oneOf(value.memoryType, ["presentation-preference", "process-preference", "framing-preference", "user-outcome-caution"], "memoryType");
  text(value.generalizedValue, "generalizedValue", { max: 300 });
  if (PROHIBITED_MEMORY.some((pattern) => pattern.test(value.generalizedValue))) throw new TypeError("generalizedValue contains a prohibited personalization meaning.");
  oneOf(value.provenance, ["explicit-user-preference", "participant-reported-outcome"], "provenance");
  oneOf(value.status, ["active", "revoked", "needs-review"], "status");
  oneOf(value.consentStatus, ["local-only", "withdrawn"], "consentStatus");
  for (const field of ["createdAt", "lastConfirmedAt", "reviewAfter"]) {
    text(value[field], field, { max: 40 });
    if (Number.isNaN(new Date(value[field]).valueOf())) throw new TypeError(`${field} must be a date-time.`);
  }
  exact(value.authority, "user-scope-only", "authority");
  exact(value.overrideClass, "soft", "overrideClass");
  exact(value.runtimeConsumerPresent, false, "runtimeConsumerPresent");
  return value;
}

export function validateLessonCandidate(value) {
  record(value, "lesson candidate");
  exactKeys(value, CANDIDATE_KEYS, "lesson candidate");
  exact(value.format, CANDIDATE_FORMAT, "format");
  oneOf(value.candidateKind, CANDIDATE_KINDS, "candidateKind");
  text(value.subjectKey, "subjectKey", { max: 80 });
  text(value.generalizedSignal, "generalizedSignal");
  text(value.proposedInvariant, "proposedInvariant");
  text(value.expectedBehavior, "expectedBehavior");
  text(value.failureReason, "failureReason", { allowEmpty: true });
  text(value.syntheticRegressionExample, "syntheticRegressionExample");
  oneOf(value.evidenceClass, EVIDENCE_CLASSES, "evidenceClass");
  stringArray(value.validationBasis, "validationBasis", { max: 8 });
  oneOf(value.policySurface, ["presentation", "process", "factual", "outcome", "therapy-policy", "safety"], "policySurface");
  oneOf(value.outcomeDirection, OUTCOME_DIRECTIONS, "outcomeDirection");
  oneOf(value.causalBoundary, CAUSAL_BOUNDARIES, "causalBoundary");
  stringArray(value.contextTags, "contextTags", { max: 12 });
  stringArray(value.versionIdentifiers, "versionIdentifiers", { min: 1, max: 8 });
  authorityNone(value);
  if (value.candidateKind === "participant-outcome" && (value.evidenceClass !== "participant-reported" || value.causalBoundary !== "participant-report-only-no-causal-inference")) throw new TypeError("Participant outcome candidates must preserve a noncausal participant-report boundary.");
  if (value.evidenceClass === "unsupported-disagreement" || value.evidenceClass === "ineligible") throw new TypeError("Unsupported or ineligible evidence cannot become a lesson candidate.");
  return value;
}

export function validateReviewCard(value) {
  record(value, "review card");
  exactKeys(value, REVIEW_CARD_KEYS, "review card");
  exact(value.format, REVIEW_CARD_FORMAT, "format");
  text(value.candidateReceipt, "candidateReceipt", { max: 80 });
  oneOf(value.status, ["needs-review", "insufficient-evidence", "duplicate", "rejected", "decision-preparation"], "status");
  oneOf(value.candidateKind, CANDIDATE_KINDS, "candidateKind");
  oneOf(value.evidenceClass, EVIDENCE_CLASSES, "evidenceClass");
  oneOf(value.causalBoundary, CAUSAL_BOUNDARIES, "causalBoundary");
  for (const field of ["subjectKey", "generalizedObservation", "proposedInvariant", "proposedRegression"]) text(value[field], field);
  if (!Number.isSafeInteger(value.occurrenceCount) || value.occurrenceCount < 0) throw new TypeError("occurrenceCount must be nonnegative.");
  record(value.contradictionCounts, "contradictionCounts");
  exactKeys(value.contradictionCounts, ["benefit", "no-change", "mixed", "worsening", "unclear"], "contradictionCounts");
  for (const count of Object.values(value.contradictionCounts)) if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("Contradiction counts must be nonnegative integers.");
  exact(value.runtimeAuthority, "none", "runtimeAuthority");
  exact(value.therapyPolicyAuthority, "none", "therapyPolicyAuthority");
  stringArray(value.availableReviewActions, "availableReviewActions", { min: 1, max: REVIEW_ACTIONS.length });
  if (value.availableReviewActions.some((action) => !REVIEW_ACTIONS.includes(action)) || value.availableReviewActions.includes("approve-and-deploy")) throw new TypeError("review card contains a forbidden action.");
  return value;
}

export function validateQueueStatus(value) {
  record(value, "queue status");
  const available = value.availability === "available";
  exactKeys(value, available ? ["availability", "totalOpen", "needsReview", "acceptedNotIncorporated", "incorporatedClosed"] : ["availability", "totalOpen", "needsReview", "acceptedNotIncorporated", "incorporatedClosed", "reasonCode"], "queue status");
  oneOf(value.availability, ["available", "unavailable"], "availability");
  for (const field of ["totalOpen", "needsReview", "acceptedNotIncorporated", "incorporatedClosed"]) {
    if (available ? (!Number.isSafeInteger(value[field]) || value[field] < 0) : value[field] !== null) throw new TypeError(`${field} is inconsistent with availability.`);
  }
  if (!available) text(value.reasonCode, "reasonCode", { max: 64 });
  return value;
}

export function validateOwnerDecisionReference(value) {
  record(value, "owner decision reference");
  exactKeys(value, OWNER_REFERENCE_KEYS, "owner decision reference");
  exact(value.format, OWNER_DECISION_REFERENCE_FORMAT, "format");
  exact(value.sourceLedger, "THERAPY-DECISIONS", "sourceLedger");
  text(value.decisionId, "decisionId", { max: 96 });
  if (!/^[a-f0-9]{64}$/.test(value.candidateFingerprint) || !/^[a-f0-9]{64}$/.test(value.receiptSha256)) throw new TypeError("Owner decision hashes must be lowercase SHA-256 values.");
  oneOf(value.decision, ["approved", "declined", "insufficient-evidence"], "decision");
  return value;
}
