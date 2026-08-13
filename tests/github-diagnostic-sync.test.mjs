import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { queueRemoteDiagnostic } from "../src/diagnostics/remote-diagnostic.mjs";
import { buildRemoteProgressSnapshot } from "../src/diagnostics/remote-progress.mjs";
import { syncDiagnosticOutbox, syncRemoteProgress } from "../src/diagnostics/github-sync.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const fakeGh = path.join(here, "fixtures/fake-gh-cli.mjs");
const repository = "u-dont-existDOTcom/innerSignalGraph";
const stableSha = "0123456789abcdef0123456789abcdef01234567";
const machineId = "123e4567-e89b-42d3-a456-426614174000";

function diagnosticInput() {
  return {
    runtime: {
      version: "0.14.4",
      installedCommit: stableSha,
      nodeVersion: "v22.18.0"
    },
    update: {
      status: "validation-failed",
      candidateCommit: "89abcdef0123456789abcdef0123456789abcdef"
    },
    failure: {
      stage: "package-tests",
      classification: "TEST_FAILURE",
      actionCode: "KEEP_CURRENT_RUNTIME",
      retryable: false,
      exitCode: 1
    },
    tests: {
      format: "inner-signal-test-failure-v1",
      command: "npm test",
      exitCode: 1,
      counts: { tests: 193, pass: 192, fail: 1 },
      failures: [{ name: "package contract stays deterministic", errorCode: "ERR_ASSERTION" }]
    },
    integrity: {
      runtimeTreeSha256: "a".repeat(64),
      graphBundleSha256: "b".repeat(64)
    }
  };
}

function progressPayload({
  observedAt = "2026-08-12T05:02:00.000Z",
  overall = "VERIFYING",
  stage = "package-tests"
} = {}) {
  return buildRemoteProgressSnapshot({
    machineId,
    observedAt,
    runtime: { version: "0.15.1", installedCommit: stableSha, nodeVersion: "v24.18.0" },
    supervisor: {
      overall,
      worker: { running: true, pid: 4242 },
      current: { stage, status: "running", startedAt: "2026-08-12T05:00:00.000Z" },
      lastEvent: { stage: "implementation", status: "completed", at: "2026-08-12T05:01:00.000Z" },
      pendingTasks: [{}],
      blockedTasks: [],
      nextAutomaticAction: "AUTO_CONTINUE",
      humanActionRequired: false
    },
    update: { status: "current", candidateCommit: stableSha },
    diagnostics: { status: "synced", pending: 0 },
    isProcessAlive: () => true
  }).payload;
}

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-github-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, ".inner-signal-autopilot");
  const fakeStatePath = path.join(root, "fake-gh-state.json");
  const fakeState = {
    repository,
    pushPermission: true,
    refs: { stable: stableSha },
    files: {},
    calls: [],
    ...overrides
  };
  await fs.writeFile(fakeStatePath, `${JSON.stringify(fakeState, null, 2)}\n`);
  const queued = await queueRemoteDiagnostic({
    stateDir,
    input: diagnosticInput(),
    now: () => new Date("2026-08-12T05:00:00.000Z"),
    randomUUID: () => machineId
  });
  const options = {
    stateDir,
    repository,
    stableBranch: "stable",
    diagnosticsBranch: "runtime-diagnostics",
    ghCommand: process.execPath,
    ghBaseArgs: [fakeGh],
    env: { ...process.env, FAKE_GH_STATE: fakeStatePath },
    now: () => new Date("2026-08-12T05:01:00.000Z")
  };
  return { root, stateDir, fakeStatePath, queued, options };
}

async function readState(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

test("progress sync creates then safely replaces one current document using the remote blob SHA", async (t) => {
  const context = await fixture(t);
  const firstPayload = progressPayload();
  const first = await syncRemoteProgress({ ...context.options, payload: firstPayload });
  assert.equal(first.status, "synced");
  assert.equal(first.uploaded, true);
  assert.equal(first.path, `progress/${machineId}/current.json`);

  const afterFirst = await readState(context.fakeStatePath);
  const key = `runtime-diagnostics:${first.path}`;
  const firstRemote = JSON.parse(Buffer.from(afterFirst.files[key].content, "base64").toString("utf8"));
  assert.deepEqual(firstRemote, firstPayload);

  const secondPayload = progressPayload({
    observedAt: "2026-08-12T05:03:00.000Z",
    overall: "REVIEWING",
    stage: "independent-review"
  });
  const second = await syncRemoteProgress({ ...context.options, payload: secondPayload });
  assert.equal(second.status, "synced");
  assert.equal(second.uploaded, true);
  const afterSecond = await readState(context.fakeStatePath);
  const secondRemote = JSON.parse(Buffer.from(afterSecond.files[key].content, "base64").toString("utf8"));
  assert.deepEqual(secondRemote, secondPayload);
  const progressPuts = afterSecond.calls.filter((args) => args.includes("PUT") && args.some((value) => value.includes("/progress/")));
  assert.equal(progressPuts.length, 2);
  assert.ok(progressPuts[1].includes("-f"));
  assert.ok(progressPuts[1].some((value) => value === `sha=${afterFirst.files[key].sha}`));
  await assert.rejects(fs.access(path.join(context.stateDir, "progress-outbox", "current.json")));
});

test("failed progress delivery retains only the newest snapshot and a later retry clears it", async (t) => {
  const context = await fixture(t, { failPutCount: 1 });
  const payload = progressPayload();
  const failed = await syncRemoteProgress({ ...context.options, payload });
  assert.equal(failed.status, "queued-for-retry");
  assert.equal(failed.uploaded, false);
  const pendingPath = path.join(context.stateDir, "progress-outbox", "current.json");
  assert.deepEqual(JSON.parse(await fs.readFile(pendingPath, "utf8")), payload);

  const retried = await syncRemoteProgress({ ...context.options, payload: null });
  assert.equal(retried.status, "synced");
  assert.equal(retried.uploaded, true);
  await assert.rejects(fs.access(pendingPath));
});

test("identical current progress is idempotent and does not create another commit", async (t) => {
  const context = await fixture(t);
  const payload = progressPayload();
  const first = await syncRemoteProgress({ ...context.options, payload });
  assert.equal(first.status, "synced");
  const before = await readState(context.fakeStatePath);
  const putCount = before.calls.filter((args) => args.includes("PUT")).length;

  const second = await syncRemoteProgress({ ...context.options, payload });
  assert.equal(second.status, "synced");
  assert.equal(second.uploaded, false);
  assert.equal(second.idempotent, true);
  const after = await readState(context.fakeStatePath);
  assert.equal(after.calls.filter((args) => args.includes("PUT")).length, putCount);
});

test("a progress replacement conflict retains the newest local snapshot for retry", async (t) => {
  const context = await fixture(t);
  const firstPayload = progressPayload();
  assert.equal((await syncRemoteProgress({ ...context.options, payload: firstPayload })).status, "synced");
  const state = await readState(context.fakeStatePath);
  const priorStatus = JSON.parse(await fs.readFile(path.join(context.stateDir, "progress-sync-status.json"), "utf8"));
  state.conflictPutCount = 1;
  await fs.writeFile(context.fakeStatePath, `${JSON.stringify(state, null, 2)}\n`);

  const newest = progressPayload({
    observedAt: "2026-08-12T05:04:00.000Z",
    overall: "REVIEWING",
    stage: "release-review"
  });
  const result = await syncRemoteProgress({ ...context.options, payload: newest });
  assert.equal(result.status, "queued-for-retry");
  assert.equal(result.uploaded, false);
  const failedStatus = JSON.parse(await fs.readFile(path.join(context.stateDir, "progress-sync-status.json"), "utf8"));
  assert.equal(failedStatus.lastSyncAt, priorStatus.lastSyncAt);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(context.stateDir, "progress-outbox", "current.json"), "utf8")),
    newest
  );
});

test("--once builds and uploads a safe snapshot, then coalesces an immediate repeat", async (t) => {
  const context = await fixture(t);
  await fs.mkdir(context.stateDir, { recursive: true });
  await fs.writeFile(path.join(context.stateDir, "runtime-progress.json"), `${JSON.stringify({
    format: "inner-signal-runtime-progress-v1",
    active: true,
    processPid: process.pid,
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 1_000).toISOString(),
    currentStage: "package-tests",
    currentStatus: "running",
    lastCompletedStage: "guide-graph-regressions",
    terminalStatus: null,
    detail: "PRIVATE_LOCAL_PROGRESS_DETAIL"
  }, null, 2)}\n`);
  await fs.writeFile(path.join(context.stateDir, "git-update-status.json"), `${JSON.stringify({
    status: "current",
    installedCommit: stableSha,
    candidateCommit: stableSha,
    rawLog: "PRIVATE_UPDATE_LOG"
  })}\n`);
  await fs.writeFile(path.join(context.stateDir, "diagnostic-sync-status.json"), `${JSON.stringify({
    status: "synced",
    pending: 1,
    rawLog: "PRIVATE_DIAGNOSTIC_LOG"
  })}\n`);

  const cliEnv = {
    ...process.env,
    INNER_SIGNAL_VALIDATION_SANDBOX: "0",
    AUTOPILOT_STATE_DIR: context.stateDir,
    GUIDE_PACKET_ROOT: path.join(context.stateDir, "guide-packets"),
    INNER_SIGNAL_GIT_SOURCE: path.join(context.root, "source-unavailable"),
    INNER_SIGNAL_GITHUB_REPOSITORY: repository,
    INNER_SIGNAL_GIT_STABLE_BRANCH: "stable",
    INNER_SIGNAL_GIT_DIAGNOSTICS_BRANCH: "runtime-diagnostics",
    INNER_SIGNAL_GH_COMMAND: fakeGh,
    INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true",
    FAKE_GH_STATE: context.fakeStatePath
  };
  const first = JSON.parse((await execFileAsync(process.execPath, ["src/cli/sync-progress.mjs", "--once"], {
    cwd: path.resolve(here, ".."),
    env: cliEnv
  })).stdout);
  assert.equal(first.status, "synced");
  assert.equal(first.uploaded, true);

  const afterFirst = await readState(context.fakeStatePath);
  const [[remoteKey, remoteValue]] = Object.entries(afterFirst.files).filter(([key]) => key.includes(":progress/"));
  assert.match(remoteKey, /^runtime-diagnostics:progress\/[0-9a-f-]{36}\/current\.json$/i);
  const body = Buffer.from(remoteValue.content, "base64").toString("utf8");
  assert.match(body, /"currentStage": "package-tests"/);
  assert.doesNotMatch(body, /PRIVATE_|processPid|detail/);
  const putCount = afterFirst.calls.filter((args) => args.includes("PUT")).length;

  const second = JSON.parse((await execFileAsync(process.execPath, ["src/cli/sync-progress.mjs", "--once"], {
    cwd: path.resolve(here, ".."),
    env: cliEnv
  })).stdout);
  assert.equal(second.status, "deferred");
  const afterSecond = await readState(context.fakeStatePath);
  assert.equal(afterSecond.calls.filter((args) => args.includes("PUT")).length, putCount);
  assert.equal((await fs.stat(path.join(context.stateDir, "progress-schedule.json"))).mode & 0o777, 0o600);
});

test("sync creates the diagnostics branch, uploads one safe incident, writes a receipt, then removes it", async (t) => {
  const context = await fixture(t);
  const result = await syncDiagnosticOutbox(context.options);

  assert.equal(result.status, "synced");
  assert.equal(result.synced, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.branch, "runtime-diagnostics");
  assert.deepEqual(result.paths, [`diagnostics/${machineId}/${context.queued.incidentId}.json`]);
  await assert.rejects(fs.access(context.queued.path));

  const receiptPath = path.join(context.stateDir, "diagnostic-receipts", `${context.queued.incidentId}.json`);
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  assert.equal(receipt.branch, "runtime-diagnostics");
  assert.equal(receipt.path, result.paths[0]);
  assert.match(receipt.commitSha, /^[a-f0-9]{40}$/);

  const remote = await readState(context.fakeStatePath);
  assert.equal(remote.refs["runtime-diagnostics"], receipt.commitSha);
  assert.ok(remote.files[`runtime-diagnostics:${result.paths[0]}`]);
  assert.ok(remote.calls.some((args) => args.includes("POST") && args.includes(`ref=refs/heads/runtime-diagnostics`)));
  assert.ok(remote.calls.some((args) => args.includes("PUT") && args.includes(`branch=runtime-diagnostics`)));
});

test("identical existing remote content is idempotent and does not issue a PUT", async (t) => {
  const context = await fixture(t, { refs: { stable: stableSha, "runtime-diagnostics": stableSha } });
  const content = (await fs.readFile(context.queued.path)).toString("base64");
  const remotePath = `diagnostics/${machineId}/${context.queued.incidentId}.json`;
  const state = await readState(context.fakeStatePath);
  state.files[`runtime-diagnostics:${remotePath}`] = {
    content,
    sha: "89abcdef0123456789abcdef0123456789abcdef",
    commitSha: stableSha
  };
  await fs.writeFile(context.fakeStatePath, `${JSON.stringify(state, null, 2)}\n`);

  const result = await syncDiagnosticOutbox(context.options);
  assert.equal(result.status, "synced");
  assert.equal(result.synced, 1);
  assert.equal(result.pending, 0);
  await assert.rejects(fs.access(context.queued.path));
  const after = await readState(context.fakeStatePath);
  assert.equal(after.calls.some((args) => args.includes("PUT")), false);
});

test("a mismatching occupied remote path is never overwritten and remains queued", async (t) => {
  const context = await fixture(t, { refs: { stable: stableSha, "runtime-diagnostics": stableSha } });
  const remotePath = `diagnostics/${machineId}/${context.queued.incidentId}.json`;
  const state = await readState(context.fakeStatePath);
  state.files[`runtime-diagnostics:${remotePath}`] = {
    content: Buffer.from("{\"different\":true}\n").toString("base64"),
    sha: "89abcdef0123456789abcdef0123456789abcdef",
    commitSha: stableSha
  };
  await fs.writeFile(context.fakeStatePath, `${JSON.stringify(state, null, 2)}\n`);

  const result = await syncDiagnosticOutbox(context.options);
  assert.equal(result.status, "queued-for-retry");
  assert.equal(result.synced, 0);
  assert.equal(result.pending, 1);
  await fs.access(context.queued.path);
  await assert.rejects(fs.access(path.join(context.stateDir, "diagnostic-receipts", `${context.queued.incidentId}.json`)));
  const after = await readState(context.fakeStatePath);
  assert.equal(after.calls.some((args) => args.includes("PUT")), false);
  assert.equal(after.files[`runtime-diagnostics:${remotePath}`].content, state.files[`runtime-diagnostics:${remotePath}`].content);
});

test("failed delivery retains the outbox and a later retry removes it only after its receipt exists", async (t) => {
  const context = await fixture(t, { failPutCount: 1 });
  const receiptPath = path.join(context.stateDir, "diagnostic-receipts", `${context.queued.incidentId}.json`);

  const failed = await syncDiagnosticOutbox(context.options);
  assert.equal(failed.status, "queued-for-retry");
  assert.equal(failed.pending, 1);
  await fs.access(context.queued.path);
  await assert.rejects(fs.access(receiptPath));

  const retried = await syncDiagnosticOutbox(context.options);
  assert.equal(retried.status, "synced");
  assert.equal(retried.synced, 1);
  assert.equal(retried.pending, 0);
  await fs.access(receiptPath);
  await assert.rejects(fs.access(context.queued.path));
});

test("the same stable incident on a later date is idempotent even though createdAt differs", async (t) => {
  const context = await fixture(t);
  const first = await syncDiagnosticOutbox(context.options);
  assert.equal(first.status, "synced");
  const remoteAfterFirst = await readState(context.fakeStatePath);
  const firstPutCount = remoteAfterFirst.calls.filter((args) => args.includes("PUT")).length;

  const repeated = await queueRemoteDiagnostic({
    stateDir: context.stateDir,
    input: diagnosticInput(),
    now: () => new Date("2026-08-13T05:00:00.000Z"),
    randomUUID: () => machineId
  });
  assert.equal(repeated.incidentId, context.queued.incidentId);
  assert.notEqual(repeated.payload.createdAt, context.queued.payload.createdAt);

  const second = await syncDiagnosticOutbox({
    ...context.options,
    now: () => new Date("2026-08-13T05:01:00.000Z")
  });
  assert.equal(second.status, "synced");
  assert.equal(second.synced, 1);
  assert.equal(second.pending, 0);
  await assert.rejects(fs.access(repeated.path));
  const remoteAfterSecond = await readState(context.fakeStatePath);
  assert.equal(remoteAfterSecond.calls.filter((args) => args.includes("PUT")).length, firstPutCount);
});

test("repository and branch values are validated before the GitHub CLI runs", async (t) => {
  const context = await fixture(t);
  await assert.rejects(
    syncDiagnosticOutbox({ ...context.options, repository: "u-dont-existDOTcom/innerSignalGraph;env" }),
    /Invalid GitHub repository/
  );
  await assert.rejects(
    syncDiagnosticOutbox({ ...context.options, diagnosticsBranch: "../runtime-diagnostics" }),
    /Invalid Git branch/
  );
  assert.equal((await readState(context.fakeStatePath)).calls.length, 0);
});

test("--latest queues only the referenced safe summary, flushes it, and exits zero", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-sync-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, ".inner-signal-autopilot");
  const runDir = path.join(stateDir, "run-20260812T050000Z");
  const fakeStatePath = path.join(root, "fake-gh-state.json");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "test-failure-summary.json"), `${JSON.stringify({
    format: "inner-signal-test-failure-v1",
    command: "npm test",
    exitCode: 1,
    counts: { tests: 193, pass: 192, fail: 1 },
    failures: [{ name: "package contract stays deterministic", errorCode: "ERR_ASSERTION", rawOutput: "PRIVATE_RAW_TEST_MARKER" }],
    rawOutput: "PRIVATE_RAW_SUMMARY_MARKER"
  }, null, 2)}\n`);
  await fs.writeFile(path.join(stateDir, "latest.json"), `${JSON.stringify({
    status: "BLOCKED",
    stage: "tests",
    runDir,
    summary: "PRIVATE_FINAL_STATUS_SUMMARY",
    nextAction: "PRIVATE_FINAL_STATUS_ACTION",
    details: { rawOutput: "PRIVATE_FINAL_STATUS_DETAILS", token: "github_pat_PRIVATE_TOKEN" },
    chat: "PRIVATE_CHAT_MARKER",
    prompt: "PRIVATE_PROMPT_MARKER",
    reasoning: "PRIVATE_REASONING_MARKER",
    therapy: "PRIVATE_THERAPY_MARKER",
    hostname: "PRIVATE_HOSTNAME_MARKER",
    username: "PRIVATE_USERNAME_MARKER",
    homePath: "/home/private-user/PRIVATE_HOME_MARKER",
    env: { GH_TOKEN: "PRIVATE_CREDENTIAL_MARKER" }
  }, null, 2)}\n`);
  await fs.writeFile(path.join(stateDir, "git-update-status.json"), `${JSON.stringify({
    status: "validation-failed",
    installedCommit: stableSha,
    candidateCommit: "89abcdef0123456789abcdef0123456789abcdef",
    integrity: {
      runtimeTreeSha256: "a".repeat(64),
      graphBundleSha256: "b".repeat(64),
      privateState: "PRIVATE_UPDATE_STATE"
    },
    rawLog: "PRIVATE_UPDATE_LOG"
  }, null, 2)}\n`);
  await fs.writeFile(fakeStatePath, `${JSON.stringify({
    repository,
    pushPermission: true,
    refs: { stable: stableSha },
    files: {},
    calls: []
  }, null, 2)}\n`);

  const { stdout } = await execFileAsync(process.execPath, ["src/cli/sync-diagnostics.mjs", "--latest"], {
    cwd: path.resolve(here, ".."),
    env: {
      ...process.env,
      INNER_SIGNAL_VALIDATION_SANDBOX: "0",
      AUTOPILOT_STATE_DIR: stateDir,
      INNER_SIGNAL_GIT_SOURCE: path.join(root, "source-unavailable"),
      INNER_SIGNAL_GITHUB_REPOSITORY: repository,
      INNER_SIGNAL_GIT_STABLE_BRANCH: "stable",
      INNER_SIGNAL_GIT_DIAGNOSTICS_BRANCH: "runtime-diagnostics",
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true",
      INNER_SIGNAL_GH_COMMAND: fakeGh,
      FAKE_GH_STATE: fakeStatePath
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.queued, 1);
  assert.equal(result.status, "synced");
  assert.equal(result.pending, 0);
  const remote = await readState(fakeStatePath);
  const [[, uploaded]] = Object.entries(remote.files);
  const body = Buffer.from(uploaded.content, "base64").toString("utf8");
  assert.match(body, /package contract stays deterministic/);
  assert.match(body, /ERR_ASSERTION|"tests": 193|0123456789abcdef0123456789abcdef01234567|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.doesNotMatch(body, /PRIVATE_|github_pat_|\/home\/private-user/);
});

test("--flush-only treats a GitHub outage as queued retry rather than an authentication failure", async (t) => {
  const context = await fixture(t, { repositoryFailure: true });
  const { stdout } = await execFileAsync(process.execPath, ["src/cli/sync-diagnostics.mjs", "--flush-only"], {
    cwd: path.resolve(here, ".."),
    env: {
      ...process.env,
      INNER_SIGNAL_VALIDATION_SANDBOX: "0",
      AUTOPILOT_STATE_DIR: context.stateDir,
      INNER_SIGNAL_GIT_SOURCE: path.join(context.root, "source-unavailable"),
      INNER_SIGNAL_GITHUB_REPOSITORY: repository,
      INNER_SIGNAL_GIT_STABLE_BRANCH: "stable",
      INNER_SIGNAL_GIT_DIAGNOSTICS_BRANCH: "runtime-diagnostics",
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true",
      INNER_SIGNAL_GH_COMMAND: fakeGh,
      FAKE_GH_STATE: context.fakeStatePath
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.status, "queued-for-retry");
  assert.equal(result.pending, 1);
  await fs.access(context.queued.path);
});

test("--flush-only reports authentication-required only for a confirmed credential failure", async (t) => {
  const context = await fixture(t, { repositoryAuthFailure: true });
  const { stdout } = await execFileAsync(process.execPath, ["src/cli/sync-diagnostics.mjs", "--flush-only"], {
    cwd: path.resolve(here, ".."),
    env: {
      ...process.env,
      INNER_SIGNAL_VALIDATION_SANDBOX: "0",
      AUTOPILOT_STATE_DIR: context.stateDir,
      INNER_SIGNAL_GIT_SOURCE: path.join(context.root, "source-unavailable"),
      INNER_SIGNAL_GITHUB_REPOSITORY: repository,
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true",
      INNER_SIGNAL_GH_COMMAND: fakeGh,
      FAKE_GH_STATE: context.fakeStatePath
    }
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, "authentication-required");
  assert.equal(result.pending, 1);
  await fs.access(context.queued.path);
});

test("one startup sync processes at most three pending incidents", async (t) => {
  const context = await fixture(t);
  for (let index = 1; index < 5; index += 1) {
    const input = diagnosticInput();
    input.failure.stage = `package-tests-${index}`;
    await queueRemoteDiagnostic({
      stateDir: context.stateDir,
      input,
      now: () => new Date(`2026-08-12T05:0${index}:00.000Z`),
      randomUUID: () => machineId
    });
  }

  const result = await syncDiagnosticOutbox(context.options);
  assert.equal(result.status, "queued-for-retry");
  assert.equal(result.synced, 3);
  assert.equal(result.pending, 2);
  const state = await readState(context.fakeStatePath);
  assert.equal(state.calls.filter((args) => args.includes("PUT")).length, 3);
});

test("GitHub subprocess timeouts cannot exceed the total startup sync budget", async (t) => {
  const context = await fixture(t);
  const observedTimeouts = [];
  let clockValue = 1_000;
  const result = await syncDiagnosticOutbox({
    ...context.options,
    totalTimeoutMs: 50,
    requestTimeoutMs: 40,
    clock: () => {
      clockValue += 15;
      return clockValue;
    },
    runner: async ({ timeoutMs }) => {
      observedTimeouts.push(timeoutMs);
      return { code: 1, signal: null, stdout: "", stderr: "network unavailable" };
    }
  });
  assert.equal(result.status, "queued-for-retry");
  assert.deepEqual(observedTimeouts, [35]);
  await fs.access(context.queued.path);
});

test("disabled automatic diagnostics neither queues nor calls GitHub and keeps an existing outbox intact", async (t) => {
  const context = await fixture(t);
  const { stdout } = await execFileAsync(process.execPath, ["src/cli/sync-diagnostics.mjs", "--flush-only"], {
    cwd: path.resolve(here, ".."),
    env: {
      ...process.env,
      INNER_SIGNAL_VALIDATION_SANDBOX: "0",
      AUTOPILOT_STATE_DIR: context.stateDir,
      INNER_SIGNAL_GIT_SOURCE: path.join(context.root, "source-unavailable"),
      INNER_SIGNAL_GITHUB_REPOSITORY: repository,
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "false",
      INNER_SIGNAL_GH_COMMAND: fakeGh,
      FAKE_GH_STATE: context.fakeStatePath
    }
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, "disabled");
  assert.equal(result.pending, 1);
  await fs.access(context.queued.path);
  assert.equal((await readState(context.fakeStatePath)).calls.length, 0);
});

test("disabled --latest does not create a new incident", async (t) => {
  const context = await fixture(t);
  await fs.rm(context.queued.path);
  await fs.writeFile(path.join(context.stateDir, "latest.json"), `${JSON.stringify({
    status: "BLOCKED",
    stage: "tests",
    runDir: null
  })}\n`);
  const { stdout } = await execFileAsync(process.execPath, ["src/cli/sync-diagnostics.mjs", "--latest"], {
    cwd: path.resolve(here, ".."),
    env: {
      ...process.env,
      INNER_SIGNAL_VALIDATION_SANDBOX: "0",
      AUTOPILOT_STATE_DIR: context.stateDir,
      INNER_SIGNAL_GIT_SOURCE: path.join(context.root, "source-unavailable"),
      INNER_SIGNAL_GITHUB_REPOSITORY: repository,
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "false",
      INNER_SIGNAL_GH_COMMAND: fakeGh,
      FAKE_GH_STATE: context.fakeStatePath
    }
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, "disabled");
  assert.equal(result.queued, 0);
  assert.equal(result.pending, 0);
  assert.deepEqual(await fs.readdir(path.join(context.stateDir, "diagnostic-outbox")), []);
  assert.equal((await readState(context.fakeStatePath)).calls.length, 0);
});
