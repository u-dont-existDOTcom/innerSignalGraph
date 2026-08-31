import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  CANDIDATE_FORMAT,
  validateFeedbackEvidence,
  validateLessonCandidate
} from "../src/learning/contracts.mjs";

const fixtureRoot = new URL("../learning-system/fixtures/", import.meta.url);
const load = async (name) => JSON.parse(await fs.readFile(new URL(name, fixtureRoot), "utf8"));

function participantCandidate(overrides = {}) {
  return {
    format: CANDIDATE_FORMAT,
    candidateKind: "participant-outcome",
    subjectKey: "paced-reflection-outcome",
    generalizedSignal: "Some participants report benefit after a paced reflection exercise.",
    proposedInvariant: "Keep the reported direction visible without causal inference.",
    expectedBehavior: "Retain the participant-report boundary.",
    failureReason: "Causal inference would overstate the report.",
    syntheticRegressionExample: "The participant-report causal boundary remains unchanged.",
    evidenceClass: "participant-reported",
    validationBasis: ["fabricated generalized outcome"],
    policySurface: "outcome",
    outcomeDirection: "benefit",
    causalBoundary: "participant-report-only-no-causal-inference",
    contextTags: ["synthetic"],
    versionIdentifiers: ["offline-groundwork-v1"],
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none",
    transmissionAuthority: "none",
    ...overrides
  };
}

test("all synthetic feedback fixtures pass the strict feedback contract", async () => {
  for (const name of ["style-preference.json", "outcome-benefit.json", "outcome-worsening.json", "factual-correction-verified.json", "unsupported-disagreement.json", "unsafe-validation-request.json"]) {
    const fixture = await load(name);
    assert.equal(validateFeedbackEvidence(fixture), fixture, name);
  }
});

test("feedback evidence rejects unknown and private-source fields", async () => {
  const base = await load("style-preference.json");
  for (const field of ["rawUserMessage", "rawAssistantMessage", "transcript", "userId", "conversationId", "sessionId", "therapyState", "embedding", "sourceHash", "unexpected"]) {
    assert.throws(() => validateFeedbackEvidence({ ...base, [field]: "PRIVATE" }), /unsupported or missing fields/, field);
  }
});

test("style preference is self-authenticating only as a preference", async () => {
  const style = await load("style-preference.json");
  assert.equal(style.evidenceClass, "self-authenticating-preference");
  assert.throws(() => validateFeedbackEvidence({ ...style, evidenceClass: "independently-verified-fact", causalBoundary: "independently-verified-fact" }), /self-authenticating only as a preference/);
});

test("participant-reported worsening remains explicitly noncausal", async () => {
  const worsening = await load("outcome-worsening.json");
  assert.equal(worsening.outcomeDirection, "worsening");
  assert.equal(worsening.causalBoundary, "participant-report-only-no-causal-inference");
  assert.throws(() => validateFeedbackEvidence({ ...worsening, causalBoundary: "independently-verified-fact" }), /explicitly noncausal/);
});

test("unsupported disagreement cannot become independently verified", async () => {
  const disagreement = await load("unsupported-disagreement.json");
  assert.throws(() => validateFeedbackEvidence({ ...disagreement, validationStatus: "validated", evidenceClass: "independently-verified-fact", causalBoundary: "independently-verified-fact" }), /cannot become verified/);
});

test("unsafe agreement, diagnosis, and dependency requests remain ineligible", async () => {
  const unsafe = await load("unsafe-validation-request.json");
  assert.equal(unsafe.evidenceClass, "ineligible");
  assert.throws(() => validateFeedbackEvidence({ ...unsafe, evidenceClass: "self-authenticating-preference" }), /ineligible/);
});

test("lesson candidates reject authority escalation and unknown fields", () => {
  const candidate = participantCandidate();
  assert.equal(validateLessonCandidate(candidate), candidate);
  assert.throws(() => validateLessonCandidate({ ...candidate, runtimeAuthority: "therapy" }), /must remain none/);
  assert.throws(() => validateLessonCandidate({ ...candidate, transcript: "PRIVATE" }), /unsupported or missing fields/);
});

test("unsupported or ineligible evidence cannot become a generalized candidate", () => {
  assert.throws(() => validateLessonCandidate(participantCandidate({ candidateKind: "validated-defect", evidenceClass: "unsupported-disagreement", causalBoundary: "unresolved" })), /cannot become a lesson candidate/);
  assert.throws(() => validateLessonCandidate(participantCandidate({ candidateKind: "safety-signal", evidenceClass: "ineligible", causalBoundary: "unresolved" })), /cannot become a lesson candidate/);
});
