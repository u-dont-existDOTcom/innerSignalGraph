import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { candidateFingerprint, createOccurrenceToken, createRevocationToken } from "../src/learning/fingerprint.mjs";
import { createMockPrivateQueue } from "../src/learning/mock-private-queue.mjs";
import { aggregateCandidates } from "../src/learning/aggregation.mjs";

const contradictionFixture = JSON.parse(await fs.readFile(new URL("../learning-system/fixtures/contradiction-set.json", import.meta.url), "utf8"));
const benefit = contradictionFixture.occurrences[0].candidate;
const worsening = contradictionFixture.occurrences[1].candidate;
const SECRET_A = "synthetic-local-random-secret-a";
const SECRET_B = "synthetic-local-random-secret-b";

test("canonical fingerprints ignore object field order", () => {
  const reversed = Object.fromEntries(Object.entries(benefit).reverse());
  assert.equal(candidateFingerprint(benefit), candidateFingerprint(reversed));
});

test("material generalized candidate differences change the fingerprint", () => {
  const changed = { ...benefit, expectedBehavior: `${benefit.expectedBehavior} Material synthetic change.` };
  assert.notEqual(candidateFingerprint(benefit), candidateFingerprint(changed));
});

test("occurrence tokens are candidate-scoped and deterministic", () => {
  const firstFingerprint = candidateFingerprint(benefit);
  const secondFingerprint = candidateFingerprint(worsening);
  assert.equal(createOccurrenceToken(SECRET_A, firstFingerprint), createOccurrenceToken(SECRET_A, firstFingerprint));
  assert.notEqual(createOccurrenceToken(SECRET_A, firstFingerprint), createOccurrenceToken(SECRET_A, secondFingerprint));
  assert.notEqual(createOccurrenceToken(SECRET_A, firstFingerprint), createOccurrenceToken(SECRET_B, firstFingerprint));
});

test("serialized candidates and queue receipts contain no local occurrence secret", () => {
  const fingerprint = candidateFingerprint(benefit);
  const occurrenceToken = createOccurrenceToken(SECRET_A, fingerprint);
  const revocationToken = createRevocationToken(SECRET_A, occurrenceToken);
  const receipt = createMockPrivateQueue().submit({ candidate: benefit, occurrenceToken, revocationToken });
  assert.doesNotMatch(JSON.stringify({ benefit, receipt }), /synthetic-local-random-secret/);
  assert.equal(Object.hasOwn(receipt, "occurrenceToken"), false);
  assert.equal(Object.hasOwn(receipt, "revocationToken"), false);
});

test("identical mock queue retry converges on one receipt and recurrence", () => {
  const queue = createMockPrivateQueue();
  const fingerprint = candidateFingerprint(benefit);
  const occurrenceToken = createOccurrenceToken(SECRET_A, fingerprint);
  const revocationToken = createRevocationToken(SECRET_A, occurrenceToken);
  const first = queue.submit({ candidate: benefit, occurrenceToken, revocationToken });
  const retry = queue.submit({ candidate: structuredClone(benefit), occurrenceToken, revocationToken });
  assert.equal(first.status, "submitted");
  assert.equal(retry.status, "existing_candidate");
  assert.equal(retry.candidateReceipt, first.candidateReceipt);
  assert.equal(retry.occurrenceCount, 1);
});

test("a different occurrence token increments recurrence for the same candidate", () => {
  const queue = createMockPrivateQueue();
  const fingerprint = candidateFingerprint(benefit);
  for (const secret of [SECRET_A, SECRET_B]) {
    const occurrenceToken = createOccurrenceToken(secret, fingerprint);
    queue.submit({ candidate: benefit, occurrenceToken, revocationToken: createRevocationToken(secret, occurrenceToken) });
  }
  assert.equal(queue.inspect(benefit).occurrenceCount, 2);
});

test("opaque revocation removes only its matching mock occurrence", () => {
  const queue = createMockPrivateQueue();
  const fingerprint = candidateFingerprint(benefit);
  const firstOccurrence = createOccurrenceToken(SECRET_A, fingerprint);
  const secondOccurrence = createOccurrenceToken(SECRET_B, fingerprint);
  const firstRevocation = createRevocationToken(SECRET_A, firstOccurrence);
  queue.submit({ candidate: benefit, occurrenceToken: firstOccurrence, revocationToken: firstRevocation });
  queue.submit({ candidate: benefit, occurrenceToken: secondOccurrence, revocationToken: createRevocationToken(SECRET_B, secondOccurrence) });
  assert.deepEqual(queue.revoke({ candidate: benefit, revocationToken: firstRevocation }), { status: "existing_candidate", revoked: true, occurrenceCount: 1 });
  assert.equal(queue.inspect(benefit).occurrenceCount, 1);
});

test("unavailable mock queue reports null counts rather than invented zeros", () => {
  const queue = createMockPrivateQueue({ available: false, unavailableReason: "SYNTHETIC_OFFLINE" });
  assert.deepEqual(queue.status(), { availability: "unavailable", totalOpen: null, needsReview: null, acceptedNotIncorporated: null, incorporatedClosed: null, reasonCode: "SYNTHETIC_OFFLINE" });
});

test("contradiction aggregation preserves every direction and worsening minority", () => {
  const extraBenefit = { candidate: benefit, occurrenceToken: "3333333333333333333333333333333333333333333333333333333333333333" };
  const aggregate = aggregateCandidates([...contradictionFixture.occurrences, extraBenefit]);
  const counts = aggregate.contradictionSets[0].contradictionCounts;
  assert.deepEqual(counts, { benefit: 2, "no-change": 0, mixed: 0, worsening: 1, unclear: 0 });
  assert.equal(aggregate.candidates.find((item) => item.outcomeDirection === "worsening").causalBoundary, "participant-report-only-no-causal-inference");
});

test("duplicate recurrence changes count, not evidence class or causal boundary", () => {
  const aggregate = aggregateCandidates([contradictionFixture.occurrences[0], { candidate: benefit, occurrenceToken: "4444444444444444444444444444444444444444444444444444444444444444" }]);
  assert.equal(aggregate.candidates[0].occurrenceCount, 2);
  assert.equal(aggregate.candidates[0].evidenceClass, "participant-reported");
  assert.equal(aggregate.candidates[0].causalBoundary, "participant-report-only-no-causal-inference");
});
