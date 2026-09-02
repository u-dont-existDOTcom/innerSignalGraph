import test from "node:test";
import assert from "node:assert/strict";
import { PERSONALIZATION_FORMAT, validatePersonalizationMemory } from "../src/learning/contracts.mjs";
import { memoryPrecedenceClass, resolvePersonalizationPrecedence } from "../src/learning/personalization.mjs";
import { CURRENT_CONSENT_POLICY, modelConsentState } from "../src/learning/consent-model.mjs";

function memory(overrides = {}) {
  return {
    format: PERSONALIZATION_FORMAT,
    memoryId: "ISM-SYN-PREFERENCE-001",
    memoryType: "presentation-preference",
    generalizedValue: "Prefer one concrete step at a time.",
    provenance: "explicit-user-preference",
    status: "active",
    consentStatus: "local-only",
    createdAt: "2026-08-31T20:00:00.000Z",
    lastConfirmedAt: "2026-08-31T20:00:00.000Z",
    reviewAfter: "2026-09-30T20:00:00.000Z",
    authority: "user-scope-only",
    overrideClass: "soft",
    runtimeConsumerPresent: false,
    ...overrides
  };
}

test("personalization memory is inspectable, user-scoped, soft, and offline", () => {
  const value = memory();
  assert.equal(validatePersonalizationMemory(value), value);
  assert.equal(memoryPrecedenceClass(value), "style-process-framing-preference");
  assert.equal(value.runtimeConsumerPresent, false);
});

test("personalization rejects unknown fields and authority escalation", () => {
  assert.throws(() => validatePersonalizationMemory(memory({ diagnosis: "fabricated" })), /unsupported or missing fields/);
  assert.throws(() => validatePersonalizationMemory(memory({ authority: "global" })), /user-scope-only/);
  assert.throws(() => validatePersonalizationMemory(memory({ overrideClass: "hard" })), /soft/);
  assert.throws(() => validatePersonalizationMemory(memory({ runtimeConsumerPresent: true })), /false/);
});

test("diagnosis, global policy, causal overclaim, and sycophancy meanings are rejected", () => {
  for (const generalizedValue of [
    "Give the participant a diagnosis.",
    "This is a global therapy rule.",
    "The exercise caused this outcome.",
    "Infer a third-party character diagnosis.",
    "Always agree with me.",
    "Ignore safety.",
    "Ignore evidence.",
    "Validate recovered-memory certainty."
  ]) assert.throws(() => validatePersonalizationMemory(memory({ generalizedValue })), /prohibited personalization meaning/, generalizedValue);
});

test("user outcome cautions remain a soft memory class", () => {
  const caution = memory({ memoryId: "ISM-SYN-CAUTION-001", memoryType: "user-outcome-caution", generalizedValue: "A fabricated participant reports worsening with fast pacing.", provenance: "participant-reported-outcome" });
  assert.equal(memoryPrecedenceClass(caution), "user-outcome-caution");
  assert.equal(caution.overrideClass, "soft");
});

test("hard safety and current instruction outrank soft memory", () => {
  const resolved = resolvePersonalizationPrecedence([
    { precedenceClass: "style-process-framing-preference", value: "Use a long explanation", sourceId: "memory-1" },
    { precedenceClass: "current-explicit-user-instruction", value: "Use a short answer now", sourceId: "turn-1" },
    { precedenceClass: "hard-safety-and-epistemic-policy", value: "Do not make an unsupported diagnosis", sourceId: "policy-1" }
  ]);
  assert.deepEqual(resolved, { precedenceClass: "hard-safety-and-epistemic-policy", value: "Do not make an unsupported diagnosis", sourceId: "policy-1" });
});

test("current case evidence outranks outcome caution and style memory", () => {
  const resolved = resolvePersonalizationPrecedence([
    { precedenceClass: "user-outcome-caution", value: "Use slower pacing", sourceId: "caution-1" },
    { precedenceClass: "style-process-framing-preference", value: "Use imagery", sourceId: "memory-1" },
    { precedenceClass: "current-case-evidence", value: "The user currently reports confusion", sourceId: "case-1" }
  ]);
  assert.equal(resolved.precedenceClass, "current-case-evidence");
});

test("current consent policy is local-only and never transmittable", () => {
  assert.equal(CURRENT_CONSENT_POLICY, "local-only");
  for (const policy of ["local-only", "per-candidate", "conversation-standing"]) {
    const modeled = modelConsentState({ policy, state: "generalized-preview-ready" });
    assert.equal(modeled.canTransmit, false);
    assert.equal(modeled.transmissionAuthority, "none");
    assert.equal(modeled.standingConsentPersisted, false);
  }
  assert.equal(modelConsentState().state, "consent-not-authorized");
});
