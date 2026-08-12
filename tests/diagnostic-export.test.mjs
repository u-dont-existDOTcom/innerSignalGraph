import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDiagnosticBundle } from "../src/export/diagnostic-bundle.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { readZipEntries } from "../src/core/zip.mjs";

function zipNames(buffer) {
  const names = [];
  for (let i = 0; i + 30 < buffer.length; i += 1) {
    if (buffer.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLength = buffer.readUInt16LE(i + 26);
    const extraLength = buffer.readUInt16LE(i + 28);
    const size = buffer.readUInt32LE(i + 18);
    const name = buffer.subarray(i + 30, i + 30 + nameLength).toString("utf8");
    names.push(name);
    i += 29 + nameLength + extraLength + size;
  }
  return names;
}

test("diagnostic bundle exports packet recovery evidence without private therapy content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-export-"));
  const ledgerDir = path.join(root, "ledgers");
  const stateDir = path.join(root, "state");
  await fs.mkdir(ledgerDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, "development-jobs", "job-1"), { recursive: true });
  const latestRunDir = path.join(stateDir, "run-20260812T050000Z");
  await fs.mkdir(latestRunDir, { recursive: true });
  await fs.writeFile(path.join(ledgerDir, "one.json"), JSON.stringify({ ledgerId: "abc-123", evidence: { candidate: "PRIVATE_REASONING_MARKER" } }));
  await fs.writeFile(path.join(stateDir, "resume-state.json"), JSON.stringify({ ok: true }));
  await fs.writeFile(path.join(stateDir, "development-supervisor.json"), JSON.stringify({ worker: { running: true }, lastAnalysis: { action: "AUTO_REPAIR" }, actionHistory: [] }));
  await fs.writeFile(path.join(stateDir, "development-jobs", "job-1", "state.json"), JSON.stringify({ jobId: "job-1", status: "auditing", privateCase: "PRIVATE_JOB_MARKER" }));
  await fs.mkdir(path.join(stateDir, "guide-packets"), { recursive: true });
  const packetId = "inner-signal-guides-2026.08.11-r01-candidate";
  const candidateDir = path.join(stateDir, "guide-packets", "candidates", packetId);
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "guide-packets", "processing-status.json"), JSON.stringify({ active: false, lifecycle: "blocked", stageId: "opus-source-role-compilation", packetId, failureClass: "MODEL_UNAVAILABLE", normalizedError: { message: "Opus unavailable" } }));
  await fs.writeFile(path.join(stateDir, "guide-packets", "stage-attempts.json"), JSON.stringify({ attempts: [{ attemptId: "a1", packetId, stageId: "opus-source-role-compilation", lifecycle: "blocked", failureClass: "MODEL_UNAVAILABLE" }] }));
  await fs.writeFile(path.join(stateDir, "guide-packets", "active-candidate.json"), JSON.stringify({ packetId }));
  await fs.writeFile(path.join(candidateDir, "state.json"), JSON.stringify({ packetId, packetSha256: "candidate-sha", status: "awaiting-owner", decisionCards: [{ id: "D1", status: "pending" }] }));
  await fs.copyFile(path.resolve("guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip"), path.join(candidateDir, "original.zip"));
  await fs.mkdir(path.join(stateDir, "guide-packets", "installed", "current", "contents"), { recursive: true });
  await fs.writeFile(path.join(stateDir, "guide-packets", "installed", "current", "contents", "manifest.json"), JSON.stringify({ packetId: "production-r5", packetRevision: 5 }));
  await fs.writeFile(path.join(stateDir, "model-resolution-latest.json"), JSON.stringify({ selected: { openai: "gpt-5.6-sol", anthropic: "claude-opus-5" }, evidence: { openai: { responseId: "codex-1" } } }));
  await fs.writeFile(path.join(stateDir, "a001-stage-attempts.json"), JSON.stringify({
    version: "a001-stage-attempts-v1",
    attempts: [{
      lane: "fable",
      stage: "case_audit",
      status: "FAILED",
      provider: "openai",
      model: "gpt-5.6-sol",
      failure: { classification: "TRANSIENT", retryable: true, message: "safe normalized cause" }
    }]
  }));
  await fs.mkdir(path.join(stateDir, "a001-stage"), { recursive: true });
  await fs.writeFile(path.join(stateDir, "a001-stage", "fable.json"), JSON.stringify({
    extraction: { current_issue: "PRIVATE_A001_CLINICAL_CHECKPOINT_MARKER" },
    raw: "PRIVATE_A001_RAW_OUTPUT_MARKER",
    prompt: "PRIVATE_A001_PROMPT_MARKER"
  }));
  await fs.writeFile(path.join(latestRunDir, "test-failure-summary.json"), JSON.stringify({
    format: "inner-signal-test-failure-v1",
    command: "npm test",
    exitCode: 1,
    counts: { tests: 193, pass: 192, fail: 1 },
    failures: [{
      name: "package contract stays deterministic",
      errorCode: "ERR_ASSERTION",
      rawOutput: "PRIVATE_REMOTE_TEST_LOG_MARKER"
    }],
    arbitrary: "PRIVATE_REMOTE_TEST_OBJECT_MARKER"
  }));
  await fs.writeFile(path.join(stateDir, "git-update-status.json"), JSON.stringify({
    format: "inner-signal-git-update-status-v1",
    status: "validation-failed",
    checkedAt: "2026-08-12T05:00:00.000Z",
    installedCommit: "0123456789abcdef0123456789abcdef01234567",
    availableCommit: "89abcdef0123456789abcdef0123456789abcdef",
    actionCode: "KEEP_CURRENT_RUNTIME",
    rawLog: "PRIVATE_GIT_UPDATE_LOG_MARKER"
  }));
  await fs.writeFile(path.join(stateDir, "diagnostic-sync-status.json"), JSON.stringify({
    format: "inner-signal-diagnostic-sync-status-v1",
    status: "synced",
    updatedAt: "2026-08-12T05:01:00.000Z",
    synced: 1,
    pending: 0,
    branch: "runtime-diagnostics",
    paths: ["diagnostics/123e4567-e89b-42d3-a456-426614174000/" + "a".repeat(64) + ".json"],
    error: "PRIVATE_GITHUB_ERROR_MARKER"
  }));
  const config = loadConfig({ mode: "mock", ledgerMode: "full", ledgerDir, autopilotStateDir: stateDir, guidePacketRoot: path.join(stateDir, "guide-packets") });
  config.devJobRoot = path.join(stateDir, "development-jobs");
  const providers = createProviders(config);
  const browserState = {
    therapy: [
      { role: "user", content: "PRIVATE_CHAT_MARKER" },
      { role: "assistant", content: "hi", ledgerId: "abc-123", processingTier: "reviewed" }
    ],
    caseSnapshot: { variables: { credibility_conflict: "present" } },
    interventionContract: { primaryJob: { id: "IC.CREDIBILITY_REPAIR" } }
  };
  const { buffer, manifest } = await buildDiagnosticBundle({ config, providers, browserState });
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  const names = zipNames(buffer);
  assert.ok(names.includes("manifest.json"));
  assert.ok(names.includes("graph/bundle.json"));
  assert.ok(names.includes("development/development-supervisor.json"));
  assert.ok(names.includes("guide-packets/processing-status.json"));
  assert.ok(names.includes("guide-packets/stage-attempts.json"));
  assert.ok(names.includes("guide-packets/active-candidate.json"));
  assert.ok(names.includes("guide-packets/candidate-state.json"));
  assert.ok(names.includes("guide-packets/candidate-manifest.json"));
  assert.ok(names.includes("guide-packets/installed-manifest.json"));
  assert.ok(names.includes("runtime/model-resolution-latest.json"));
  assert.ok(names.includes("runtime/a001-stage-attempts.json"));
  assert.ok(names.includes("runtime/latest-run/test-failure-summary.json"));
  assert.ok(names.includes("runtime/git-update-status.json"));
  assert.ok(names.includes("runtime/diagnostic-sync-status.json"));
  assert.equal(names.some((name) => name.includes("a001-stage/fable")), false);
  assert.equal(names.some((name) => name.startsWith("chat/") || name.startsWith("reasoning/") || name.startsWith("development-jobs/")), false);
  assert.equal(names.some((name) => /\.env|credential|token/i.test(name)), false);
  const entries = readZipEntries(buffer);
  const joined = Buffer.concat([...entries.values()]).toString("utf8");
  assert.match(joined, /package contract stays deterministic|runtime-diagnostics/);
  assert.doesNotMatch(joined, /PRIVATE_CHAT_MARKER|PRIVATE_REASONING_MARKER|PRIVATE_JOB_MARKER|PRIVATE_A001_CLINICAL_CHECKPOINT_MARKER|PRIVATE_A001_RAW_OUTPUT_MARKER|PRIVATE_A001_PROMPT_MARKER|PRIVATE_REMOTE_TEST_LOG_MARKER|PRIVATE_REMOTE_TEST_OBJECT_MARKER|PRIVATE_GIT_UPDATE_LOG_MARKER|PRIVATE_GITHUB_ERROR_MARKER/);
  assert.equal(manifest.format, "inner-signal-diagnostic-bundle-v2");
  assert.equal(manifest.privacy.includesChatContent, false);
  assert.equal(manifest.privacy.includesReasoningLedgers, false);
  assert.equal(manifest.privacy.browserStateIgnored, true);
});
