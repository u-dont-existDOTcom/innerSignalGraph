import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { buildLiveLearningEvidence } from "../src/learning/live-contracts.mjs";

const STATUS_FOR_DISPOSITION = Object.freeze({
  reject: "rejected",
  "insufficient-evidence": "insufficient-evidence",
  duplicate: "duplicate",
  "personalization-process-only": "personalization-process-only",
  "needs-external-evidence": "needs-external-evidence",
  "prepare-therapy-policy-decision": "needs-owner-therapy-decision"
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-live-review-api-"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    root,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(base, route, { method = "GET", body, rawBody } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined && rawBody === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function submitCandidate(app, index, category = "correction") {
  const candidate = buildLiveLearningEvidence({
    feedbackCategory: category,
    userAuthoredSummary: `Generalized user summary ${index}.`,
    privacyAcknowledged: true,
    runtimeVersion: "0.15.2",
    detectorVersion: "private-correction-signal-v1"
  });
  const preview = await request(app.base, "/v1/learning/preview", { method: "POST", body: candidate });
  assert.equal(preview.response.status, 200);
  const submitted = await request(app.base, "/v1/learning/submit", {
    method: "POST",
    body: {
      candidate,
      previewNonce: preview.payload.previewNonce,
      occurrenceToken: index.toString(16).padStart(64, "0"),
      revocationToken: (index + 1000).toString(16).padStart(64, "0")
    }
  });
  assert.equal(submitted.response.status, 200);
  return { candidate, receipt: submitted.payload.candidateReceipt };
}

test("review status, list, and detail expose only public generalized records", async () => {
  const app = await fixture();
  try {
    const first = await submitCandidate(app, 1, "correction");
    await submitCandidate(app, 2, "did-not-work");
    const decided = await request(app.base, `/v1/learning/review/records/${first.receipt}/decision`, {
      method: "POST",
      body: { disposition: "reject" }
    });
    assert.equal(decided.response.status, 200);

    const status = await request(app.base, "/v1/learning/review/status");
    assert.equal(status.response.status, 200);
    assert.equal(status.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(status.payload, {
      availability: "available",
      totalOpen: 2,
      needsReview: 1,
      acceptedNotIncorporated: 0,
      incorporatedClosed: 0,
      runtimeAuthority: "none",
      therapyPolicyAuthority: "none"
    });

    const listed = await request(app.base, "/v1/learning/review/records");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.length, 2);
    const publicKeys = [
      "candidate",
      "candidateFingerprint",
      "candidateReceipt",
      "createdAt",
      "externalTransmissionAuthority",
      "history",
      "occurrenceCount",
      "reviewDisposition",
      "reviewedAt",
      "runtimeAuthority",
      "status",
      "therapyPolicyAuthority",
      "updatedAt"
    ];
    for (const record of listed.payload) {
      assert.deepEqual(Object.keys(record).sort(), publicKeys);
      assert.equal(record.runtimeAuthority, "none");
      assert.equal(record.therapyPolicyAuthority, "none");
      assert.equal(record.externalTransmissionAuthority, "none");
      assert.equal(record.candidate.sourceContentRetained, false);
      assert.equal(record.candidate.userAuthoredSummary.startsWith("Generalized user summary"), true);
    }

    const detail = await request(app.base, `/v1/learning/review/records/${first.receipt}`);
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.payload.candidate, first.candidate);
    assert.deepEqual(Object.keys(detail.payload).sort(), publicKeys);

    const durable = JSON.parse(await fs.readFile(path.join(app.root, "private-learning", "queue.json"), "utf8"));
    const serializedPublic = JSON.stringify({ list: listed.payload, detail: detail.payload });
    for (const occurrence of durable.records.flatMap((record) => record.occurrences)) {
      assert.equal(serializedPublic.includes(occurrence.occurrenceHash), false);
      assert.equal(serializedPublic.includes(occurrence.revocationHash), false);
    }
    for (const forbidden of ["occurrences", "occurrenceHash", "revocationHash", "revocationToken", "occurrenceToken", "previewNonce", "private-learning", "rawUserMessage", "assistantAnswer", "transcript"]) {
      assert.equal(serializedPublic.includes(`\"${forbidden}\"`), false, forbidden);
    }
  } finally {
    await app.close();
  }
});

test("review routes reject malformed inputs and report missing receipts truthfully", async () => {
  const app = await fixture();
  try {
    const invalidReceipt = await request(app.base, "/v1/learning/review/records/not-a-receipt");
    assert.equal(invalidReceipt.response.status, 400);
    assert.equal(invalidReceipt.payload.code, "VALIDATION_ERROR");

    const missingReceipt = `ISL-LOCAL-${"F".repeat(24)}`;
    const missing = await request(app.base, `/v1/learning/review/records/${missingReceipt}`);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.payload.code, "NOT_FOUND");

    const created = await submitCandidate(app, 3);
    const unknownField = await request(app.base, `/v1/learning/review/records/${created.receipt}/decision`, {
      method: "POST",
      body: { disposition: "reject", note: "not allowed" }
    });
    assert.equal(unknownField.response.status, 400);
    const unsupported = await request(app.base, `/v1/learning/review/records/${created.receipt}/decision`, {
      method: "POST",
      body: { disposition: "approve-and-deploy" }
    });
    assert.equal(unsupported.response.status, 400);
    const malformed = await request(app.base, `/v1/learning/review/records/${created.receipt}/decision`, {
      method: "POST",
      rawBody: "{"
    });
    assert.equal(malformed.response.status, 400);
    const oversized = await request(app.base, `/v1/learning/review/records/${created.receipt}/decision`, {
      method: "POST",
      rawBody: JSON.stringify({ disposition: "reject", padding: "x".repeat(5000) })
    });
    assert.equal(oversized.response.status, 400);
  } finally {
    await app.close();
  }
});

test("all six decisions preserve generalized evidence and map only to triage status", async () => {
  const app = await fixture();
  try {
    const created = await submitCandidate(app, 4, "did-not-work");
    const queueFile = path.join(app.root, "private-learning", "queue.json");
    const before = JSON.parse(await fs.readFile(queueFile, "utf8"));
    const candidateBefore = before.records[0].candidate;
    for (const [disposition, expectedStatus] of Object.entries(STATUS_FOR_DISPOSITION)) {
      const result = await request(app.base, `/v1/learning/review/records/${created.receipt}/decision`, {
        method: "POST",
        body: { disposition }
      });
      assert.equal(result.response.status, 200, disposition);
      assert.equal(result.payload.status, expectedStatus, disposition);
      assert.equal(result.payload.reviewDisposition, disposition);
      assert.equal(result.payload.runtimeAuthority, "none");
      assert.equal(result.payload.therapyPolicyAuthority, "none");
      assert.equal(result.payload.externalTransmissionAuthority, "none");
      assert.deepEqual(result.payload.candidate, candidateBefore);
    }
    const after = JSON.parse(await fs.readFile(queueFile, "utf8"));
    assert.deepEqual(after.records[0].candidate, candidateBefore);
    assert.equal(after.records[0].status, "needs-owner-therapy-decision");
    assert.equal(after.records[0].reviewDisposition, "prepare-therapy-policy-decision");
    const localEntries = await fs.readdir(app.root);
    assert.equal(localEntries.some((name) => /^THERAPY-|^APPROVED-THERAPY-/.test(name)), false);
  } finally {
    await app.close();
  }
});

test("corrupt local review state is unavailable and never projected as zero or leaked", async () => {
  const app = await fixture();
  try {
    await submitCandidate(app, 5);
    await fs.writeFile(path.join(app.root, "private-learning", "queue.json"), JSON.stringify({
      format: "broken",
      privatePath: "/private/owner/path",
      rawUserMessage: "PRIVATE_CORRUPT_STORE_MARKER"
    }));
    const status = await request(app.base, "/v1/learning/review/status");
    assert.equal(status.response.status, 503);
    assert.deepEqual({
      availability: status.payload.availability,
      totalOpen: status.payload.totalOpen,
      needsReview: status.payload.needsReview,
      acceptedNotIncorporated: status.payload.acceptedNotIncorporated,
      incorporatedClosed: status.payload.incorporatedClosed
    }, {
      availability: "unavailable",
      totalOpen: null,
      needsReview: null,
      acceptedNotIncorporated: null,
      incorporatedClosed: null
    });
    const listed = await request(app.base, "/v1/learning/review/records");
    assert.equal(listed.response.status, 503);
    for (const response of [status, listed]) {
      const serialized = JSON.stringify(response.payload);
      assert.doesNotMatch(serialized, /PRIVATE_CORRUPT_STORE_MARKER|private\/owner\/path|queue\.json/);
    }
  } finally {
    await app.close();
  }
});
