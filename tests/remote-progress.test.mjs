import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildRemoteProgressSnapshot,
  finalizeRuntimeProgress,
  isRemoteProgressPayload,
  progressUploadDecision,
  readRuntimeProgress,
  recordRuntimeProgress
} from "../src/diagnostics/remote-progress.mjs";

const machineId = "123e4567-e89b-42d3-a456-426614174000";
const installedCommit = "0123456789abcdef0123456789abcdef01234567";
const candidateCommit = "89abcdef0123456789abcdef0123456789abcdef";

function input(overrides = {}) {
  return {
    machineId,
    observedAt: "2026-08-12T19:00:00.000Z",
    runtime: {
      version: "0.15.1",
      installedCommit,
      nodeVersion: "v24.18.0",
      chat: "PRIVATE_RUNTIME_CHAT"
    },
    runtimeProgress: null,
    supervisor: {
      overall: "VERIFYING",
      worker: { running: true, pid: 4321, hostname: "PRIVATE_HOST" },
      current: {
        stage: "package-tests",
        status: "running",
        startedAt: "2026-08-12T18:58:00.000Z",
        taskId: "PRIVATE_TASK_ID",
        detail: "PRIVATE_BLOCKER_PROSE",
        task: { name: "PRIVATE_TASK_NAME" }
      },
      lastEvent: {
        stage: "implementation",
        status: "completed",
        at: "2026-08-12T18:59:00.000Z",
        detail: "PRIVATE_LAST_EVENT"
      },
      pendingTasks: [{ id: "PRIVATE_PENDING_ONE" }, { id: "PRIVATE_PENDING_TWO" }],
      blockedTasks: [{ blocker: "PRIVATE_BLOCKED_TASK" }],
      nextAutomaticAction: "AUTO_CONTINUE",
      humanActionRequired: false,
      blocker: "/home/private-user/therapy.json",
      lastAnalysis: { trajectory: "PRIVATE_ANALYSIS", repair_directive: "PRIVATE_DIRECTIVE" },
      latestJob: { jobId: "PRIVATE_JOB", modelOutput: "PRIVATE_MODEL_OUTPUT" }
    },
    update: { status: "current", candidateCommit, rawLog: "PRIVATE_UPDATE_LOG" },
    diagnostics: { pending: 2, status: "synced", raw: "github_pat_PRIVATE" },
    priorSync: null,
    isProcessAlive: (pid) => pid === 4321,
    ...overrides
  };
}

test("remote progress is constructed from strict codes and excludes all source prose and identity", () => {
  const { payload, meaningfulChanged } = buildRemoteProgressSnapshot(input());
  assert.equal(isRemoteProgressPayload(payload), true);
  assert.deepEqual(Object.keys(payload).sort(), [
    "diagnostics",
    "format",
    "machineId",
    "observedAt",
    "privacy",
    "progress",
    "runtime",
    "update"
  ]);
  assert.equal(payload.format, "inner-signal-remote-progress-v1");
  assert.equal(payload.machineId, machineId);
  assert.deepEqual(payload.runtime, {
    version: "0.15.1",
    installedCommit,
    nodeVersion: "v24.18.0"
  });
  assert.deepEqual(payload.progress, {
    domain: "development",
    overall: "VERIFYING",
    assessment: "ADVANCING",
    currentStage: "package-tests",
    currentStatus: "running",
    lastCompletedStage: "implementation",
    workerAlive: true,
    elapsedSeconds: 120,
    meaningfulProgressAt: "2026-08-12T19:00:00.000Z",
    secondsSinceMeaningfulProgress: 0,
    pendingTaskCount: 2,
    blockedTaskCount: 1,
    nextAutomaticAction: "AUTO_CONTINUE",
    humanActionRequired: false
  });
  assert.deepEqual(payload.update, { status: "current", candidateCommit });
  assert.deepEqual(payload.diagnostics, { status: "synced", pendingIncidentCount: 2 });
  assert.equal(meaningfulChanged, true);
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_|github_pat_|\/home\/|therapy|model.output|task.name/i);
  assert.equal(isRemoteProgressPayload({ ...payload, rawLog: "PRIVATE_RAW_LOG" }), false);
});

test("deterministic progress assessment distinguishes completion, blocking, long stages, and stopped workers", () => {
  const rows = [
    { overall: "COMPLETE", alive: false, age: 0, want: "COMPLETE" },
    { overall: "WAITING_FOR_HUMAN", alive: true, age: 5, want: "WAITING_FOR_HUMAN" },
    { overall: "BLOCKED_INTERNAL", alive: true, age: 5, want: "BLOCKED" },
    { overall: "VERIFYING", alive: true, age: 120, want: "ADVANCING" },
    { overall: "VERIFYING", alive: true, age: 1800, want: "LONG_RUNNING_STAGE" },
    { overall: "VERIFYING", alive: false, age: 120, want: "WORKER_NOT_RUNNING" },
    { overall: "IDLE", alive: false, age: 0, want: "IDLE" }
  ];
  for (const row of rows) {
    const observedAt = "2026-08-12T19:00:00.000Z";
    const meaningfulProgressAt = new Date(Date.parse(observedAt) - row.age * 1000).toISOString();
    const rowInput = input({
      observedAt,
      supervisor: {
        ...input().supervisor,
        overall: row.overall,
        worker: { running: row.alive, pid: 4321 },
        current: row.overall === "IDLE" || row.overall === "COMPLETE" ? null : input().supervisor.current,
        pendingTasks: [],
        blockedTasks: []
      },
      isProcessAlive: () => row.alive
    });
    const first = buildRemoteProgressSnapshot(rowInput);
    const { payload } = buildRemoteProgressSnapshot({
      ...rowInput,
      priorSync: { coreHash: first.coreHash, meaningfulProgressAt }
    });
    assert.equal(payload.progress.assessment, row.want, JSON.stringify(row));
  }
});

test("only changes to the allowlisted progress core reset meaningful progress time", () => {
  const first = buildRemoteProgressSnapshot(input());
  const unchanged = buildRemoteProgressSnapshot(input({
    observedAt: "2026-08-12T19:05:00.000Z",
    supervisor: { ...input().supervisor, blocker: "PRIVATE_CHANGED_PROSE_ONLY" },
    priorSync: {
      coreHash: first.coreHash,
      meaningfulProgressAt: first.payload.progress.meaningfulProgressAt
    }
  }));
  assert.equal(unchanged.meaningfulChanged, false);
  assert.equal(unchanged.payload.progress.meaningfulProgressAt, "2026-08-12T19:00:00.000Z");
  assert.equal(unchanged.payload.progress.secondsSinceMeaningfulProgress, 300);

  const changed = buildRemoteProgressSnapshot(input({
    observedAt: "2026-08-12T19:06:00.000Z",
    supervisor: { ...input().supervisor, overall: "REVIEWING" },
    priorSync: {
      coreHash: first.coreHash,
      meaningfulProgressAt: first.payload.progress.meaningfulProgressAt
    }
  }));
  assert.equal(changed.meaningfulChanged, true);
  assert.equal(changed.payload.progress.meaningfulProgressAt, "2026-08-12T19:06:00.000Z");
});

test("progress uploads coalesce rapid changes and refresh unchanged state every five minutes", () => {
  const options = { minimumMs: 30_000, heartbeatMs: 300_000 };
  assert.equal(progressUploadDecision({ ...options, nowMs: 10_000, lastUploadMs: 0, meaningfulChanged: true }), false);
  assert.equal(progressUploadDecision({ ...options, nowMs: 30_000, lastUploadMs: 0, meaningfulChanged: true }), true);
  assert.equal(progressUploadDecision({ ...options, nowMs: 299_000, lastUploadMs: 0, meaningfulChanged: false }), false);
  assert.equal(progressUploadDecision({ ...options, nowMs: 300_000, lastUploadMs: 0, meaningfulChanged: false }), true);
  assert.equal(progressUploadDecision({ ...options, nowMs: 1_000, lastUploadMs: null, meaningfulChanged: false }), true);
});

test("local runtime progress is atomic, excludes detail prose, and records terminal state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-progress-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await recordRuntimeProgress({
    stateDir: root,
    event: { stage: "guide-graph-compile", status: "started", detail: "PRIVATE_DETAIL_ONE" },
    pid: 2468,
    now: () => new Date("2026-08-12T19:00:00.000Z")
  });
  await recordRuntimeProgress({
    stateDir: root,
    event: { stage: "guide-graph-compile", status: "completed", detail: "PRIVATE_DETAIL_TWO" },
    pid: 2468,
    now: () => new Date("2026-08-12T19:01:00.000Z")
  });
  await finalizeRuntimeProgress({
    stateDir: root,
    status: "PASS",
    stage: "complete",
    now: () => new Date("2026-08-12T19:02:00.000Z")
  });
  const record = await readRuntimeProgress(root);
  assert.deepEqual(record, {
    format: "inner-signal-runtime-progress-v1",
    active: false,
    processPid: 2468,
    startedAt: "2026-08-12T19:00:00.000Z",
    updatedAt: "2026-08-12T19:02:00.000Z",
    currentStage: "complete",
    currentStatus: "PASS",
    lastCompletedStage: "guide-graph-compile",
    terminalStatus: "PASS"
  });
  const bytes = await fs.readFile(path.join(root, "runtime-progress.json"), "utf8");
  assert.doesNotMatch(bytes, /PRIVATE_DETAIL/);
  assert.equal((await fs.stat(path.join(root, "runtime-progress.json"))).mode & 0o777, 0o600);
});
