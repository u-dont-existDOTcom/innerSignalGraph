import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReviewCard } from "../src/learning/reviewer.mjs";
import { candidateFingerprint } from "../src/learning/fingerprint.mjs";
import { evaluatePromotionEligibility } from "../src/learning/promotion-gate.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("../learning-system/fixtures/contradiction-set.json", import.meta.url), "utf8"));
const candidate = fixture.occurrences[0].candidate;
const fingerprint = candidateFingerprint(candidate);
const approvedReference = {
  format: "inner-signal-owner-decision-reference-v1",
  sourceLedger: "THERAPY-DECISIONS",
  decisionId: "SYNTHETIC-DECISION-APPROVE-001",
  candidateFingerprint: fingerprint,
  decision: "approved",
  receiptSha256: "a".repeat(64)
};
const completeRegression = { failedBeforeImplementation: true, passesAfterImplementation: true, implementationVerificationComplete: true };

test("Joel review card exposes recurrence and contradictions without deploy action", () => {
  const card = createReviewCard({
    candidate,
    candidateReceipt: `ISL-MOCK-${fingerprint.slice(0, 16)}`,
    occurrenceCount: 4,
    contradictionCounts: { benefit: 3, "no-change": 0, mixed: 0, worsening: 1, unclear: 0 }
  });
  assert.equal(card.occurrenceCount, 4);
  assert.equal(card.contradictionCounts.worsening, 1);
  assert.equal(card.runtimeAuthority, "none");
  assert.equal(card.therapyPolicyAuthority, "none");
  assert.equal(card.availableReviewActions.includes("approve-and-deploy"), false);
});

test("promotion gate fails closed without an owner-decision reference", () => {
  const result = evaluatePromotionEligibility({ candidate, regressionState: completeRegression });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("MISSING_OWNER_DECISION_REFERENCE"));
});

test("declined and insufficient-evidence references cannot pass", () => {
  for (const decision of ["declined", "insufficient-evidence"]) {
    const result = evaluatePromotionEligibility({ candidate, ownerDecisionReference: { ...approvedReference, decision }, regressionState: completeRegression });
    assert.equal(result.eligible, false, decision);
    assert.ok(result.reasons.includes("OWNER_DECISION_NOT_APPROVED"), decision);
  }
});

test("candidate fingerprint mismatch fails closed", () => {
  const result = evaluatePromotionEligibility({ candidate, ownerDecisionReference: { ...approvedReference, candidateFingerprint: "b".repeat(64) }, regressionState: completeRegression });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("CANDIDATE_FINGERPRINT_MISMATCH"));
});

test("regression-first requirements must all be satisfied", () => {
  for (const [field, reason] of [["failedBeforeImplementation", "REGRESSION_DID_NOT_FAIL_BEFORE"], ["passesAfterImplementation", "REGRESSION_DOES_NOT_PASS_AFTER"], ["implementationVerificationComplete", "IMPLEMENTATION_NOT_VERIFIED"]]) {
    const result = evaluatePromotionEligibility({ candidate, ownerDecisionReference: approvedReference, regressionState: { ...completeRegression, [field]: false } });
    assert.equal(result.eligible, false, field);
    assert.ok(result.reasons.includes(reason), field);
  }
});

test("synthetic complete prerequisites make only the pure predicate eligible", () => {
  const result = evaluatePromotionEligibility({ candidate, ownerDecisionReference: approvedReference, regressionState: completeRegression });
  assert.deepEqual(result, { eligible: true, reasons: [], writePerformed: false, activationPerformed: false, runtimeAuthority: "none", therapyPolicyAuthority: "none" });
});

test("review preview fixtures contain only allowed review actions", async () => {
  const cards = JSON.parse(await fs.readFile(new URL("../learning-system/reviewer-preview/review-cards.fixture.json", import.meta.url), "utf8"));
  assert.ok(cards.length >= 2);
  assert.equal(JSON.stringify(cards).includes("approve-and-deploy"), false);
  assert.ok(cards.every((card) => card.runtimeAuthority === "none" && card.therapyPolicyAuthority === "none"));
});
