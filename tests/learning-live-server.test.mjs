import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { buildLiveLearningEvidence } from "../src/learning/live-contracts.mjs";

const OCCURRENCE = "1".repeat(64);
const REVOCATION = "2".repeat(64);

function candidate() {
  return buildLiveLearningEvidence({
    feedbackCategory: "did-not-work",
    userAuthoredSummary: "",
    privacyAcknowledged: false,
    runtimeVersion: "0.15.2",
    detectorVersion: "private-correction-signal-v1"
  });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-live-server-"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: root, guidePacketRoot: path.join(root, "guide-packets") });
  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    root,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test("loopback preview, explicit default continuation, receipt, and revocation work end to end", async () => {
  const app = await fixture();
  try {
    const value = candidate();
    const previewResult = await post(app.base, "/v1/learning/preview", value);
    assert.equal(previewResult.response.status, 200);
    assert.equal(previewResult.response.headers.get("cache-control"), "no-store");
    assert.equal(previewResult.payload.diskWrite, false);
    assert.deepEqual(previewResult.payload.candidate, value);
    await assert.rejects(fs.access(path.join(app.root, "private-learning", "queue.json")), /ENOENT/);

    const submitted = await post(app.base, "/v1/learning/submit", {
      candidate: value,
      previewNonce: previewResult.payload.previewNonce,
      occurrenceToken: OCCURRENCE,
      revocationToken: REVOCATION
    });
    assert.equal(submitted.response.status, 200);
    assert.match(submitted.payload.candidateReceipt, /^ISL-LOCAL-/);
    assert.equal(submitted.payload.externalWrite, false);
    assert.equal(submitted.payload.status, "needs-review");

    const revoked = await post(app.base, "/v1/learning/revoke", { candidateReceipt: submitted.payload.candidateReceipt, revocationToken: REVOCATION });
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.payload.revoked, true);
    assert.equal(revoked.payload.deleted, true);
  } finally {
    await app.close();
  }
});

test("learning endpoints reject raw fields, privacy risks, oversized bodies, and submission without preview", async () => {
  const app = await fixture();
  try {
    const value = candidate();
    const raw = await post(app.base, "/v1/learning/preview", { ...value, transcript: "RAW_THERAPY_MARKER" });
    assert.equal(raw.response.status, 400);
    const risky = await post(app.base, "/v1/learning/preview", { ...value, userAuthoredSummary: "person@example.com", summaryAuthorship: "user", privacyAcknowledged: true });
    assert.equal(risky.response.status, 400);
    assert.deepEqual(risky.payload.details.riskCodes, ["EMAIL"]);
    const noPreview = await post(app.base, "/v1/learning/submit", { candidate: value, previewNonce: "z".repeat(43), occurrenceToken: OCCURRENCE, revocationToken: REVOCATION });
    assert.equal(noPreview.response.status, 400);
    const oversized = await fetch(`${app.base}/v1/learning/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) })
    });
    assert.equal(oversized.status, 400);
  } finally {
    await app.close();
  }
});

test("therapy behavior remains unchanged and raw therapy markers never enter the queue", async () => {
  const app = await fixture();
  try {
    const therapyInput = { userMessage: "RAW_THERAPY_MARKER That did not work.", recentTranscript: "", userFacts: [], processingMode: "fast" };
    const before = await post(app.base, "/v1/therapy/respond", therapyInput);
    assert.equal(before.response.status, 200);

    const value = candidate();
    const preview = await post(app.base, "/v1/learning/preview", value);
    await post(app.base, "/v1/learning/submit", { candidate: value, previewNonce: preview.payload.previewNonce, occurrenceToken: OCCURRENCE, revocationToken: REVOCATION });

    const after = await post(app.base, "/v1/therapy/respond", therapyInput);
    assert.equal(after.response.status, 200);
    assert.equal(after.payload.answer, before.payload.answer);
    assert.deepEqual(after.payload.responseContract, before.payload.responseContract);
    assert.doesNotMatch(await fs.readFile(path.join(app.root, "private-learning", "queue.json"), "utf8"), /RAW_THERAPY_MARKER/);
  } finally {
    await app.close();
  }
});

test("diagnostic ZIP excludes the private learning store", async () => {
  const app = await fixture();
  try {
    const value = buildLiveLearningEvidence({
      feedbackCategory: "correction",
      userAuthoredSummary: "LOCAL_LEARNING_DIAGNOSTIC_MARKER",
      privacyAcknowledged: true,
      runtimeVersion: "0.15.2",
      detectorVersion: "private-correction-signal-v1"
    });
    const preview = await post(app.base, "/v1/learning/preview", value);
    const submitted = await post(app.base, "/v1/learning/submit", { candidate: value, previewNonce: preview.payload.previewNonce, occurrenceToken: OCCURRENCE, revocationToken: REVOCATION });
    assert.equal(submitted.response.status, 200);
    const response = await fetch(`${app.base}/v1/debug/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: {} }) });
    const zip = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.doesNotMatch(zip.toString("utf8"), /LOCAL_LEARNING_DIAGNOSTIC_MARKER|private-learning|queue\.json/);
  } finally {
    await app.close();
  }
});
