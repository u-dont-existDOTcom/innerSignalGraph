import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_LEARNING_CATEGORY_MAPPING,
  buildLiveLearningEvidence,
  liveLearningFingerprint,
  screenLiveLearningEvidence,
  validateLiveLearningEvidence
} from "../src/learning/live-contracts.mjs";
import {
  buildLiveLearningEvidence as buildBrowserEvidence,
  createAutomaticPotentialLesson,
  createManualPotentialLesson,
  reviewPotentialLesson
} from "../apps/web/correction-learning.js";

const runtimeVersion = "0.15.2";
const detectorVersion = "private-correction-signal-v1";

function nodeCandidate(feedbackCategory, overrides = {}) {
  return buildLiveLearningEvidence({ feedbackCategory, userAuthoredSummary: "", privacyAcknowledged: false, runtimeVersion, detectorVersion, ...overrides });
}

test("every feedback category builds the exact conservative generalized evidence mapping", () => {
  for (const [feedbackCategory, mapping] of Object.entries(LIVE_LEARNING_CATEGORY_MAPPING)) {
    const candidate = nodeCandidate(feedbackCategory);
    assert.equal(candidate.candidateKind, mapping.candidateKind);
    assert.equal(candidate.generalizedObservation, mapping.generalizedObservation);
    assert.equal(candidate.evidenceClass, mapping.evidenceClass);
    assert.equal(candidate.causalBoundary, mapping.causalBoundary);
    assert.equal(candidate.outcomeDirection, mapping.outcomeDirection);
    assert.equal(candidate.sourceContentRetained, false);
    assert.equal(candidate.runtimeAuthority, "none");
    assert.equal(candidate.therapyPolicyAuthority, "none");
    assert.equal(candidate.externalTransmissionAuthority, "none");
  }
});

test("did-not-work remains participant-reported with no causal inference", () => {
  const candidate = nodeCandidate("did-not-work");
  assert.equal(candidate.evidenceClass, "participant-reported");
  assert.equal(candidate.causalBoundary, "participant-report-only-no-causal-inference");
  assert.equal(candidate.outcomeDirection, "unclear");
});

test("browser builder and server builder produce the same strict evidence", () => {
  const potential = createAutomaticPotentialLesson("That did not work", { id: "pl-live0001", now: "2026-09-01T01:00:00.000Z" });
  assert.deepEqual(buildBrowserEvidence(potential, { runtimeVersion }), nodeCandidate("did-not-work"));

  const reviewed = reviewPotentialLesson(potential, {
    category: "correction",
    summary: "The answer contradicted an explicit premise.",
    privacyAcknowledged: true,
    disposition: "keep-private-candidate",
    now: "2026-09-01T01:01:00.000Z"
  });
  assert.deepEqual(buildBrowserEvidence(reviewed, { runtimeVersion }), nodeCandidate("correction", {
    userAuthoredSummary: "The answer contradicted an explicit premise.",
    privacyAcknowledged: true
  }));

  const manual = createManualPotentialLesson({ id: "pl-live0002", now: "2026-09-01T01:00:00.000Z" });
  assert.equal(buildBrowserEvidence(manual, { runtimeVersion }).feedbackCategory, "other");
});

test("only user-authored acknowledged free text is accepted", () => {
  assert.throws(() => nodeCandidate("correction", { userAuthoredSummary: "Unacknowledged", privacyAcknowledged: false }), /privacy acknowledgement/);
  const candidate = nodeCandidate("correction", { userAuthoredSummary: "User-authored only.", privacyAcknowledged: true });
  assert.equal(candidate.summaryAuthorship, "user");
  assert.equal(candidate.userAuthoredSummary, "User-authored only.");
});

test("unknown raw transcript, answer, id, state, and authority fields fail closed", async (t) => {
  const candidate = nodeCandidate("correction");
  for (const field of ["rawUserMessage", "assistantAnswer", "transcript", "messageId", "conversationId", "sessionId", "ledgerId", "therapyState", "caseFormulation", "embedding", "sourceHash", "matchOffset", "generatedSummary"]) {
    await t.test(field, () => assert.throws(() => validateLiveLearningEvidence({ ...candidate, [field]: "PRIVATE_MARKER" }), /unsupported or missing fields/));
  }
  for (const [field, value] of [["runtimeAuthority", "therapy"], ["therapyPolicyAuthority", "active"], ["externalTransmissionAuthority", "allowed"], ["sourceContentRetained", true]]) {
    await t.test(`${field}-escalation`, () => assert.throws(() => validateLiveLearningEvidence({ ...candidate, [field]: value }), /invalid/));
  }
});

test("privacy risks block structurally while clean scans never claim anonymity", () => {
  const risky = nodeCandidate("correction", { userAuthoredSummary: "Contact me at person@example.com", privacyAcknowledged: true });
  const riskyScreen = screenLiveLearningEvidence(risky);
  assert.equal(riskyScreen.structuralPass, false);
  assert.deepEqual(riskyScreen.riskCodes, ["EMAIL"]);
  const clean = screenLiveLearningEvidence(nodeCandidate("correction"));
  assert.equal(clean.structuralPass, true);
  assert.equal(clean.anonymous, false);
  assert.equal(clean.deIdentified, false);
  assert.equal(clean.externalTransmissionApproved, false);
});

test("fingerprints are canonical, stable, and candidate scoped", () => {
  const first = nodeCandidate("correction");
  assert.equal(liveLearningFingerprint(first), liveLearningFingerprint(structuredClone(first)));
  assert.notEqual(liveLearningFingerprint(first), liveLearningFingerprint(nodeCandidate("disagreement")));
});
