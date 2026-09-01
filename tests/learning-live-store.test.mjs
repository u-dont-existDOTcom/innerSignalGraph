import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildLiveLearningEvidence } from "../src/learning/live-contracts.mjs";
import { LiveLearningStore } from "../src/learning/live-store.mjs";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_C = "c".repeat(64);
const TOKEN_D = "d".repeat(64);

function candidate(summary = "") {
  return buildLiveLearningEvidence({
    feedbackCategory: "correction",
    userAuthoredSummary: summary,
    privacyAcknowledged: Boolean(summary),
    runtimeVersion: "0.15.2",
    detectorVersion: "private-correction-signal-v1"
  });
}

async function tempStore(options = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-live-learning-"));
  return { parent, store: new LiveLearningStore({ rootDir: path.join(parent, "private-learning"), ...options }) };
}

test("preview is exact, memory-only, expiring, and rejects privacy risks", async () => {
  let now = new Date("2026-09-01T01:00:00.000Z");
  const { parent, store } = await tempStore({ clock: () => now, previewTtlMs: 1_000 });
  const value = candidate();
  const preview = store.createPreview(value);
  assert.deepEqual(preview.candidate, value);
  assert.equal(preview.diskWrite, false);
  assert.equal(preview.externalWrite, false);
  await assert.rejects(fs.access(path.join(parent, "private-learning", "queue.json")), /ENOENT/);
  assert.throws(() => store.createPreview(candidate("person@example.com")), /privacy risk/);
  now = new Date("2026-09-01T01:00:02.000Z");
  await assert.rejects(store.submit({ candidate: value, previewNonce: preview.previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B }), /expired/);
});

test("submission requires an exact single-use preview and persists only strict derived evidence", async () => {
  const { parent, store } = await tempStore();
  const value = candidate("PRIVATE_DERIVED_SUMMARY_MARKER");
  await assert.rejects(store.submit({ candidate: value, previewNonce: "x".repeat(43), occurrenceToken: TOKEN_A, revocationToken: TOKEN_B }), /missing, expired, or already used/);
  const preview = store.createPreview(value);
  const modified = candidate();
  await assert.rejects(store.submit({ candidate: modified, previewNonce: preview.previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B }), /changed after preview/);
  await assert.rejects(store.submit({ candidate: value, previewNonce: preview.previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B }), /already used/);

  const usable = store.createPreview(value);
  const result = await store.submit({ candidate: value, previewNonce: usable.previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  assert.match(result.candidateReceipt, /^ISL-LOCAL-[A-F0-9]{24}$/);
  assert.equal(result.occurrenceCount, 1);
  assert.equal(result.status, "needs-review");
  const queueText = await fs.readFile(path.join(parent, "private-learning", "queue.json"), "utf8");
  assert.match(queueText, /PRIVATE_DERIVED_SUMMARY_MARKER/);
  assert.doesNotMatch(queueText, new RegExp(`${TOKEN_A}|${TOKEN_B}`));
  assert.doesNotMatch(queueText, /rawUserMessage|assistantAnswer|transcript|therapyState/);
  assert.equal((await fs.stat(path.join(parent, "private-learning"))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(parent, "private-learning", "queue.json"))).mode & 0o777, 0o600);
});

test("occurrence retries deduplicate and distinct occurrences increment", async () => {
  const { store } = await tempStore();
  const value = candidate();
  const firstPreview = store.createPreview(value);
  const first = await store.submit({ candidate: value, previewNonce: firstPreview.previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  const retryPreview = store.createPreview(value);
  const retry = await store.submit({ candidate: value, previewNonce: retryPreview.previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  assert.equal(retry.submissionStatus, "idempotent-retry");
  assert.equal(retry.occurrenceCount, 1);
  assert.equal(retry.candidateReceipt, first.candidateReceipt);
  const secondPreview = store.createPreview(value);
  const second = await store.submit({ candidate: value, previewNonce: secondPreview.previewNonce, occurrenceToken: TOKEN_C, revocationToken: TOKEN_D });
  assert.equal(second.submissionStatus, "existing-candidate");
  assert.equal(second.occurrenceCount, 2);
});

test("ambiguous retry recovers the original receipt even if browser candidate fields changed", async () => {
  const { store } = await tempStore();
  const original = candidate();
  const first = await store.submit({ candidate: original, previewNonce: store.createPreview(original).previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  const edited = buildLiveLearningEvidence({
    feedbackCategory: "disagreement",
    userAuthoredSummary: "A later browser edit.",
    privacyAcknowledged: true,
    runtimeVersion: "0.15.2",
    detectorVersion: "private-correction-signal-v1"
  });
  const retry = await store.submit({ candidate: edited, previewNonce: store.createPreview(edited).previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  assert.equal(retry.submissionStatus, "idempotent-retry");
  assert.equal(retry.candidateReceipt, first.candidateReceipt);
  assert.equal((await store.list()).length, 1);
  await assert.rejects(store.submit({
    candidate: edited,
    previewNonce: store.createPreview(edited).previewNonce,
    occurrenceToken: TOKEN_A,
    revocationToken: TOKEN_D
  }), /conflicts with an existing revocation credential/);
});

test("revocation removes only the matching occurrence and final revocation deletes all review metadata", async () => {
  const { parent, store } = await tempStore();
  const value = candidate();
  const first = await store.submit({ candidate: value, previewNonce: store.createPreview(value).previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  await store.submit({ candidate: value, previewNonce: store.createPreview(value).previewNonce, occurrenceToken: TOKEN_C, revocationToken: TOKEN_D });
  const wrong = await store.revoke({ candidateReceipt: first.candidateReceipt, revocationToken: "e".repeat(64) });
  assert.equal(wrong.revoked, false);
  const partial = await store.revoke({ candidateReceipt: first.candidateReceipt, revocationToken: TOKEN_B });
  assert.deepEqual({ revoked: partial.revoked, deleted: partial.deleted, count: partial.occurrenceCount }, { revoked: true, deleted: false, count: 1 });
  await store.decide(first.candidateReceipt, "insufficient-evidence");
  const final = await store.revoke({ candidateReceipt: first.candidateReceipt, revocationToken: TOKEN_D });
  assert.deepEqual({ revoked: final.revoked, deleted: final.deleted, count: final.occurrenceCount }, { revoked: true, deleted: true, count: 0 });
  assert.equal(await store.show(first.candidateReceipt), null);
  const stored = JSON.parse(await fs.readFile(path.join(parent, "private-learning", "queue.json"), "utf8"));
  assert.deepEqual(stored.records, []);
});

test("maintainer dispositions change review status only and expose no token hashes", async () => {
  const { parent, store } = await tempStore();
  const value = candidate();
  const submitted = await store.submit({ candidate: value, previewNonce: store.createPreview(value).previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  const reviewed = await store.decide(submitted.candidateReceipt, "prepare-therapy-policy-decision");
  assert.equal(reviewed.status, "needs-owner-therapy-decision");
  assert.equal(reviewed.runtimeAuthority, "none");
  assert.equal(reviewed.therapyPolicyAuthority, "none");
  assert.doesNotMatch(JSON.stringify(reviewed), /occurrenceHash|revocationHash/);
  assert.deepEqual((await fs.readdir(parent)).sort(), ["private-learning"]);
  assert.deepEqual(await store.status(), {
    availability: "available",
    totalOpen: 1,
    needsReview: 0,
    acceptedNotIncorporated: 0,
    incorporatedClosed: 0,
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none"
  });
});

test("unreadable or corrupt store fails instead of inventing zero counts", async () => {
  const { parent, store } = await tempStore();
  await fs.mkdir(path.join(parent, "private-learning"), { recursive: true });
  await fs.writeFile(path.join(parent, "private-learning", "queue.json"), "not-json");
  await assert.rejects(store.status());
});

test("corrupt review-state correlation fails closed", async () => {
  const { parent, store } = await tempStore();
  const value = candidate();
  await store.submit({ candidate: value, previewNonce: store.createPreview(value).previewNonce, occurrenceToken: TOKEN_A, revocationToken: TOKEN_B });
  const file = path.join(parent, "private-learning", "queue.json");
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  state.records[0].status = "rejected";
  await fs.writeFile(file, JSON.stringify(state));
  await assert.rejects(store.status(), /status and disposition do not match/);
});
