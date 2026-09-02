import { createHash } from "node:crypto";
import { detectDeterministicPrivacyRisks } from "./privacy-screen.mjs";

export const LIVE_LEARNING_EVIDENCE_FORMAT = "inner-signal-live-learning-evidence-v1";
export const LIVE_LEARNING_STORE_FORMAT = "inner-signal-live-learning-store-v1";
export const LIVE_LEARNING_POLICY_SURFACE = "therapy-response-feedback";

export const LIVE_LEARNING_CATEGORIES = Object.freeze([
  "did-not-work",
  "did-not-make-sense",
  "disagreement",
  "correction",
  "other"
]);

export const LIVE_LEARNING_CATEGORY_MAPPING = Object.freeze({
  "did-not-work": Object.freeze({
    candidateKind: "outcome-signal",
    generalizedObservation: "A user reported that an InnerSignal response did not work for them.",
    evidenceClass: "participant-reported",
    causalBoundary: "participant-report-only-no-causal-inference",
    outcomeDirection: "unclear"
  }),
  "did-not-make-sense": Object.freeze({
    candidateKind: "comprehension-signal",
    generalizedObservation: "A user reported that an InnerSignal response did not make sense to them.",
    evidenceClass: "unresolved",
    causalBoundary: "unresolved",
    outcomeDirection: "not-applicable"
  }),
  disagreement: Object.freeze({
    candidateKind: "disagreement-signal",
    generalizedObservation: "A user explicitly disagreed with an InnerSignal response.",
    evidenceClass: "unsupported-disagreement",
    causalBoundary: "unresolved",
    outcomeDirection: "not-applicable"
  }),
  correction: Object.freeze({
    candidateKind: "correction-signal",
    generalizedObservation: "A user explicitly corrected an InnerSignal response.",
    evidenceClass: "unresolved",
    causalBoundary: "unresolved",
    outcomeDirection: "not-applicable"
  }),
  other: Object.freeze({
    candidateKind: "other-feedback-signal",
    generalizedObservation: "A user deliberately saved feedback as a potential InnerSignal lesson.",
    evidenceClass: "unresolved",
    causalBoundary: "unresolved",
    outcomeDirection: "not-applicable"
  })
});

const EVIDENCE_KEYS = Object.freeze([
  "format",
  "candidateKind",
  "feedbackCategory",
  "generalizedObservation",
  "userAuthoredSummary",
  "summaryAuthorship",
  "privacyAcknowledged",
  "evidenceClass",
  "causalBoundary",
  "outcomeDirection",
  "policySurface",
  "syntheticRegressionExample",
  "versionIdentifiers",
  "sourceContentRetained",
  "runtimeAuthority",
  "therapyPolicyAuthority",
  "externalTransmissionAuthority"
].sort());

const VERSION_KEYS = Object.freeze(["detectorVersion", "runtimeVersion"].sort());
const TOKEN = /^[a-f0-9]{64}$/;
const PREVIEW_NONCE = /^[A-Za-z0-9_-]{32,128}$/;

function fail(message) {
  const error = new Error(`Invalid live learning request: ${message}`);
  error.code = "VALIDATION_ERROR";
  throw error;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function exactKeys(value, expected, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains unsupported or missing fields`);
  }
}

function boundedString(value, label, { min = 0, max = 1_000 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) fail(`${label} has invalid length`);
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) fail(`${label} is invalid`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function canonicalLiveLearningJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function liveLearningHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function validateLiveLearningEvidence(value) {
  exactKeys(value, EVIDENCE_KEYS, "evidence");
  exact(value.format, LIVE_LEARNING_EVIDENCE_FORMAT, "format");
  if (!LIVE_LEARNING_CATEGORIES.includes(value.feedbackCategory)) fail("feedbackCategory is invalid");
  const mapping = LIVE_LEARNING_CATEGORY_MAPPING[value.feedbackCategory];
  for (const field of ["candidateKind", "generalizedObservation", "evidenceClass", "causalBoundary", "outcomeDirection"]) {
    exact(value[field], mapping[field], field);
  }
  boundedString(value.userAuthoredSummary, "userAuthoredSummary", { max: 1_000 });
  if (!['none', 'user'].includes(value.summaryAuthorship)) fail("summaryAuthorship is invalid");
  exact(value.summaryAuthorship, value.userAuthoredSummary ? "user" : "none", "summaryAuthorship");
  if (typeof value.privacyAcknowledged !== "boolean") fail("privacyAcknowledged must be boolean");
  if (value.userAuthoredSummary && !value.privacyAcknowledged) fail("a summary requires privacy acknowledgement");
  if (!value.userAuthoredSummary && value.privacyAcknowledged) fail("privacyAcknowledged must describe an actual summary");
  exact(value.policySurface, LIVE_LEARNING_POLICY_SURFACE, "policySurface");
  exact(value.syntheticRegressionExample, false, "syntheticRegressionExample");
  exactKeys(value.versionIdentifiers, VERSION_KEYS, "versionIdentifiers");
  boundedString(value.versionIdentifiers.runtimeVersion, "runtimeVersion", { min: 1, max: 100 });
  boundedString(value.versionIdentifiers.detectorVersion, "detectorVersion", { min: 1, max: 100 });
  exact(value.sourceContentRetained, false, "sourceContentRetained");
  exact(value.runtimeAuthority, "none", "runtimeAuthority");
  exact(value.therapyPolicyAuthority, "none", "therapyPolicyAuthority");
  exact(value.externalTransmissionAuthority, "none", "externalTransmissionAuthority");
  return value;
}

export function buildLiveLearningEvidence({ feedbackCategory, userAuthoredSummary = "", privacyAcknowledged = false, runtimeVersion, detectorVersion }) {
  if (!LIVE_LEARNING_CATEGORIES.includes(feedbackCategory)) fail("feedbackCategory is invalid");
  const summary = boundedString(userAuthoredSummary, "userAuthoredSummary", { max: 1_000 }).trim();
  const mapping = LIVE_LEARNING_CATEGORY_MAPPING[feedbackCategory];
  return validateLiveLearningEvidence({
    format: LIVE_LEARNING_EVIDENCE_FORMAT,
    candidateKind: mapping.candidateKind,
    feedbackCategory,
    generalizedObservation: mapping.generalizedObservation,
    userAuthoredSummary: summary,
    summaryAuthorship: summary ? "user" : "none",
    privacyAcknowledged: summary ? privacyAcknowledged === true : false,
    evidenceClass: mapping.evidenceClass,
    causalBoundary: mapping.causalBoundary,
    outcomeDirection: mapping.outcomeDirection,
    policySurface: LIVE_LEARNING_POLICY_SURFACE,
    syntheticRegressionExample: false,
    versionIdentifiers: { runtimeVersion, detectorVersion },
    sourceContentRetained: false,
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none",
    externalTransmissionAuthority: "none"
  });
}

export function liveLearningFingerprint(value) {
  validateLiveLearningEvidence(value);
  return liveLearningHash(canonicalLiveLearningJson(value));
}

export function screenLiveLearningEvidence(value) {
  validateLiveLearningEvidence(value);
  const riskCodes = detectDeterministicPrivacyRisks(value);
  return Object.freeze({
    candidate: structuredClone(value),
    candidateFingerprint: liveLearningFingerprint(value),
    riskCodes,
    structuralPass: riskCodes.length === 0,
    anonymous: false,
    deIdentified: false,
    identifiabilityWarningRequired: true,
    externalTransmissionApproved: false
  });
}

export function validateLiveLearningSubmission(value) {
  exactKeys(value, ["candidate", "occurrenceToken", "previewNonce", "revocationToken"].sort(), "submission");
  validateLiveLearningEvidence(value.candidate);
  if (typeof value.previewNonce !== "string" || !PREVIEW_NONCE.test(value.previewNonce)) fail("previewNonce is invalid");
  for (const field of ["occurrenceToken", "revocationToken"]) {
    if (typeof value[field] !== "string" || !TOKEN.test(value[field])) fail(`${field} is invalid`);
  }
  return value;
}

export function validateLiveLearningRevocation(value) {
  exactKeys(value, ["candidateReceipt", "revocationToken"].sort(), "revocation");
  if (typeof value.candidateReceipt !== "string" || !/^ISL-LOCAL-[A-F0-9]{24}$/.test(value.candidateReceipt)) fail("candidateReceipt is invalid");
  if (typeof value.revocationToken !== "string" || !TOKEN.test(value.revocationToken)) fail("revocationToken is invalid");
  return value;
}
