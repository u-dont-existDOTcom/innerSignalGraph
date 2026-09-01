import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runRuntimeSmoke } from "../src/autopilot/runtime-smoke.mjs";
import { RUNTIME_VERSION } from "../src/core/runtime-version.mjs";

test("local runtime health endpoint starts on an ephemeral port and reports planning, therapy, and hypnosis endpoints", async () => {
  const config = loadConfig({ mode: "mock" });
  const providers = createProviders(config);
  const result = await runRuntimeSmoke({ config, providers });
  assert.equal(result.ok, true);
  assert.equal(result.health.version, RUNTIME_VERSION);
  assert.deepEqual(result.health.endpoints, ["/v1/plan", "/v1/therapy/respond", "/v1/hypnosis/compile", "/v1/learning/preview", "/v1/learning/submit", "/v1/learning/revoke", "/v1/debug/export", "/v1/debug/feedback", "/v1/dev/status", "/v1/dev/decision", "/v1/guides/status", "/v1/guides/import", "/v1/guides/decision", "/v1/guides/install", "/v1/guides/rollback", "/v1/guides/export"]);
});

import { createInnerSignalServer } from "../src/server/create-server.mjs";

test("planning endpoint returns an audited case snapshot and deterministic graph contract", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/v1/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userMessage: "I can feel love, but it feels unsafe when I direct it to the younger me. Relaxation has not changed the credibility problem.",
        recentTranscript: "",
        userFacts: []
      })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.graphBundleVersion, "inner-child-somatic-pilot-2026-08-09-r5");
    assert.equal(result.plan.contractVersion, "case-plan-v4");
    assert.ok(result.plan.primaryJob);
    assert.ok(result.snapshot.audit);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

import { listenInnerSignalLoopback } from "../src/server/listen-loopback.mjs";

test("loopback launcher serves the same app through localhost and IPv4 without LAN binding", async () => {
  const config = loadConfig({ mode: "mock" });
  const providers = createProviders(config);
  const listener = await listenInnerSignalLoopback({ config, providers, port: 0 });
  try {
    const localhostHealth = await fetch(`${listener.url}/health`).then((r) => r.json());
    const ipv4Health = await fetch(`${listener.ipv4Url}/health`).then((r) => r.json());
    assert.equal(localhostHealth.ok, true);
    assert.equal(ipv4Health.ok, true);
    assert.equal(localhostHealth.version, RUNTIME_VERSION);
    assert.equal(ipv4Health.version, RUNTIME_VERSION);
  } finally {
    await listener.close();
  }
});

test("loopback web server self-hosts the correction-learning module", async () => {
  const config = loadConfig({ mode: "mock" });
  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/correction-learning.js`);
    const source = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/javascript/);
    assert.match(source, /detectCorrectionSignal/);
    assert.match(source, /runtimeAuthority/);
    assert.doesNotMatch(source, /https?:\/\//);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("diagnostic recovery ZIP ignores private potential-lesson browser state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-lesson-diagnostic-"));
  const config = loadConfig({
    mode: "mock",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets")
  });
  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/debug/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: {
          therapy: [{ role: "user", content: "PRIVATE_CHAT_DIAGNOSTIC_MARKER" }],
          potentialLessons: [{ summary: "PRIVATE_LESSON_DIAGNOSTIC_MARKER" }]
        }
      })
    });
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/zip/);
    assert.doesNotMatch(body.toString("utf8"), /PRIVATE_CHAT_DIAGNOSTIC_MARKER|PRIVATE_LESSON_DIAGNOSTIC_MARKER/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("therapy response endpoint remains isolated from browser-local correction candidates", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const providers = createProviders(config);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/therapy/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userMessage: "That didn't work.", recentTranscript: "", userFacts: [], processingMode: "fast" })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof result.answer, "string");
    assert.equal(Object.hasOwn(result, "potentialLessons"), false);
    assert.equal(Object.hasOwn(result, "correctionCandidate"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordDevelopmentWorkerRuntime, recordDevelopmentProgress } from "../src/dev/supervisor-state.mjs";
import { markRoadmapTask } from "../src/dev/roadmap-queue.mjs";

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidatePacketPath = path.join(testRoot, "guide-packets", "fixtures", "r01-candidate", "inner-signal-guide-packet-r01-candidate.zip");

test("development status endpoint exposes deterministic overall supervisor analysis", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-dev-status-"));
  const config = loadConfig({
    mode: "mock",
    autopilotStateDir: root,
    devJobRoot: path.join(root, "development-jobs"),
    devPromotionMarker: path.join(root, "promotion-ready.json")
  });
  const providers = createProviders(config);
  await recordDevelopmentWorkerRuntime(config, { running: true, pid: 777, startedAt: new Date(Date.now() - 5000).toISOString() });
  await markRoadmapTask(config, "DEV-R004", { status: "repairing", jobId: "roadmap-DEV-R004", model: "claude-fable-5" });
  await recordDevelopmentProgress(config, { jobId: "roadmap-DEV-R004", taskId: "DEV-R004", stage: "roadmap-repair-2", status: "started", detail: "claude-fable-5" });
  await fs.writeFile(path.join(root, "git-update-status.json"), JSON.stringify({
    format: "inner-signal-git-update-status-v1",
    status: "failed-safe",
    checkedAt: "2026-08-12T06:00:00.000Z",
    stage: "package-tests",
    installedCommit: "0123456789abcdef0123456789abcdef01234567",
    availableCommit: "89abcdef0123456789abcdef0123456789abcdef",
    rawOutput: "PRIVATE_UPDATE_STATUS_MARKER"
  }));
  await fs.writeFile(path.join(root, "diagnostic-sync-status.json"), JSON.stringify({
    format: "inner-signal-diagnostic-sync-status-v1",
    status: "synced",
    updatedAt: "2026-08-12T06:01:00.000Z",
    pending: 0,
    branch: "runtime-diagnostics",
    paths: ["diagnostics/123e4567-e89b-42d3-a456-426614174000/" + "a".repeat(64) + ".json"],
    credential: "PRIVATE_SYNC_STATUS_MARKER"
  }));
  await fs.writeFile(path.join(root, "progress-sync-status.json"), JSON.stringify({
    format: "inner-signal-progress-sync-status-v1",
    status: "synced",
    updatedAt: "2026-08-12T06:02:00.000Z",
    lastSyncAt: "2026-08-12T06:02:00.000Z",
    branch: "runtime-diagnostics",
    path: "progress/123e4567-e89b-42d3-a456-426614174000/current.json",
    assessment: "ADVANCING",
    observedAt: "2026-08-12T06:01:30.000Z",
    commitSha: "c".repeat(40),
    payload: "PRIVATE_PROGRESS_BODY_MARKER"
  }));
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/dev/status`);
    const value = await response.json();
    assert.equal(response.status, 200);
    assert.equal(value.supervisor.overall, "REPAIRING");
    assert.equal(value.supervisor.worker.running, true);
    assert.equal(value.supervisor.current.taskId, "DEV-R004");
    assert.equal(value.supervisor.nextAutomaticAction, "AUTO_CONTINUE");
    assert.deepEqual(value.gitAutomation, {
      update: {
        status: "failed-safe",
        checkedAt: "2026-08-12T06:00:00.000Z",
        stage: "package-tests",
        installedCommit: "0123456789ab",
        availableCommit: "89abcdef0123"
      },
      diagnostics: {
        status: "synced",
        branch: "runtime-diagnostics",
        path: "diagnostics/123e4567-e89b-42d3-a456-426614174000/" + "a".repeat(64) + ".json",
        pending: 0,
        lastSyncAt: "2026-08-12T06:01:00.000Z"
      },
      progress: {
        status: "synced",
        branch: "runtime-diagnostics",
        path: "progress/123e4567-e89b-42d3-a456-426614174000/current.json",
        lastSyncAt: "2026-08-12T06:02:00.000Z",
        assessment: "ADVANCING",
        observedAt: "2026-08-12T06:01:30.000Z"
      }
    });
    assert.doesNotMatch(JSON.stringify(value.gitAutomation), /PRIVATE_|credential|rawOutput|payload|commitSha/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("guide packet endpoints stage a verified candidate, preserve installed policy until approval, install atomically, and export the installed packet", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-guide-api-"));
  const config = loadConfig({
    mode: "mock",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets")
  });
  const providers = createProviders(config);
  const packet = await fs.readFile(candidatePacketPath);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await fetch(`${base}/v1/guides/status`).then((r) => r.json());
    assert.equal(before.installed, null);

    const importedResponse = await fetch(`${base}/v1/guides/import`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: packet
    });
    const imported = await importedResponse.json();
    assert.equal(importedResponse.status, 200);
    assert.equal(imported.candidate.status, "awaiting-owner");
    assert.equal(imported.installed, null);
    assert.ok(imported.candidate.decisionCards.length > 0);

    for (const card of imported.candidate.decisionCards) {
      const response = await fetch(`${base}/v1/guides/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: imported.candidate.packetId, cardId: card.id, decision: "approve" })
      });
      assert.equal(response.status, 200);
    }

    const installResponse = await fetch(`${base}/v1/guides/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId: imported.candidate.packetId })
    });
    const installed = await installResponse.json();
    assert.equal(installResponse.status, 200);
    assert.equal(installed.installed.packetVersion, "2026.08.11-r01-candidate");

    const exported = await fetch(`${base}/v1/guides/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type"), /application\/zip/);
    const exportedBytes = Buffer.from(await exported.arrayBuffer());
    assert.equal(exportedBytes.length > 1000, true);

    const health = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(health.guides.installedPacketVersion, "2026.08.11-r01-candidate");
    assert.ok(health.endpoints.includes("/v1/guides/status"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("live Guide Packet import runs Opus source-role compilation before independent Codex audit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-guide-live-import-"));
  const config = loadConfig({
    mode: "cli",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets"),
    devAutomationEnabled: false
  });
  const order = [];
  const anthropic = {
    id: "anthropic",
    model: "claude-opus-5",
    entitlementEvidence: { ok: true, requestedModel: "claude-opus-5", responseId: "opus-entitlement", probedAt: new Date().toISOString() },
    async generate(request) {
      order.push(request.metadata?.stage);
      return {
        text: JSON.stringify({
          verdict: "compiled",
          summary: "Source roles compiled; owner decisions remain owner-gated.",
          unresolved_material_disagreement: false,
          source_roles: [],
          graph_changes: [],
          findings: [],
          worst_plausible_failure: "A source nuance could be compiled too broadly."
        }),
        requestId: "opus-compile-1"
      };
    }
  };
  const openai = {
    id: "openai",
    model: "gpt-5.6-sol",
    entitlementEvidence: { ok: true, requestedModel: "gpt-5.6-sol", responseId: "codex-entitlement", probedAt: new Date().toISOString() },
    async generate(request) {
      order.push(request.metadata?.stage);
      assert.match(request.user, /Source-role compilation report/i);
      return {
        text: JSON.stringify({
          verdict: "pass",
          summary: "The source-role compilation and deterministic packet diff are reviewable.",
          unresolved_material_disagreement: false,
          findings: [],
          recommended_owner_decisions: [],
          worst_plausible_failure: "A route could activate too broadly."
        }),
        requestId: "codex-audit-1"
      };
    }
  };
  const providers = { openai, anthropic, renderer: anthropic };
  const packet = await fs.readFile(candidatePacketPath);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/v1/guides/import`, {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: packet
    });
    const status = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(order, ["guide_packet_opus_compilation", "guide_packet_independent_audit"]);
    assert.equal(status.candidate.compilation.status, "compiled");
    assert.equal(status.candidate.independentReview.status, "reviewed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Guide Packet import classifies Opus compilation failure separately and never fabricates a Codex review", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-guide-compile-failure-"));
  const config = loadConfig({
    mode: "cli",
    ledgerMode: "off",
    autopilotStateDir: root,
    guidePacketRoot: path.join(root, "guide-packets"),
    devAutomationEnabled: false
  });
  let codexCalls = 0;
  const providers = {
    anthropic: { id: "anthropic", model: "claude-opus-5", entitlementEvidence: { ok: true, requestedModel: "claude-opus-5", responseId: "opus-entitlement", probedAt: new Date().toISOString() }, async generate() { throw new Error("Opus compilation unavailable"); } },
    openai: { id: "openai", model: "gpt-5.6-sol", entitlementEvidence: { ok: true, requestedModel: "gpt-5.6-sol", responseId: "codex-entitlement", probedAt: new Date().toISOString() }, async generate() { codexCalls += 1; throw new Error("should not be called"); } },
    renderer: { id: "anthropic", model: "claude-sonnet-4-6" }
  };
  const packet = await fs.readFile(candidatePacketPath);
  const server = createInnerSignalServer({ config, providers });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/guides/import`, { method: "POST", headers: { "content-type": "application/zip" }, body: packet });
    const status = await response.json();
    assert.equal(response.status, 200);
    assert.equal(codexCalls, 0);
    assert.equal(status.candidate.compilation, undefined);
    assert.equal(status.candidate.independentReview, undefined);
    assert.equal(status.process.stage, "opus-source-role-compilation");
    assert.equal(status.process.lifecycle, "blocked");
    assert.equal(status.process.failureClass, "MODEL_UNAVAILABLE");
    assert.equal(status.process.nextAutomaticAction, "AUTO_REPAIR");
    assert.match(status.process.blocker, /Opus compilation unavailable/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
