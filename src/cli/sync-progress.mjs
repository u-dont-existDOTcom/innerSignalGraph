import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { buildDevelopmentSupervisorSnapshot } from "../dev/supervisor-state.mjs";
import { readOrCreateMachineId } from "../diagnostics/remote-diagnostic.mjs";
import { queueRemoteProgressSnapshot, syncRemoteProgress } from "../diagnostics/github-sync.mjs";
import {
  buildRemoteProgressSnapshot,
  progressUploadDecision,
  readRuntimeProgress
} from "../diagnostics/remote-progress.mjs";
import { loadGitAutomationConfig } from "../git/automation-config.mjs";

const POLL_MS = 30_000;
const HEARTBEAT_MS = 300_000;
const SHA256 = /^[a-f0-9]{64}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseMode(args) {
  if (args.length !== 1 || !["--once", "--watch"].includes(args[0])) {
    throw new TypeError("Use exactly one of --once or --watch");
  }
  return args[0];
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function safeTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) || date.toISOString() !== value ? null : value;
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function pendingIncidentCount(stateDir) {
  try {
    return (await fs.readdir(path.join(stateDir, "diagnostic-outbox"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))
      .length;
  } catch (error) {
    return error?.code === "ENOENT" ? 0 : 0;
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function scheduleView(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    observedCoreHash: typeof source.observedCoreHash === "string" && SHA256.test(source.observedCoreHash)
      ? source.observedCoreHash
      : null,
    uploadedCoreHash: typeof source.uploadedCoreHash === "string" && SHA256.test(source.uploadedCoreHash)
      ? source.uploadedCoreHash
      : null,
    meaningfulProgressAt: safeTimestamp(source.meaningfulProgressAt),
    lastUploadAt: safeTimestamp(source.lastUploadAt)
  };
}

async function oneIteration({ now = new Date() } = {}) {
  const observedAt = now.toISOString();
  const gitConfig = loadGitAutomationConfig({ env: process.env, installRoot: projectRoot });
  const stateDir = gitConfig.stateDir;
  const progressPath = `progress/${await readOrCreateMachineId(stateDir)}/current.json`;

  if (!gitConfig.autoDiagnostics || process.env.INNER_SIGNAL_VALIDATION_SANDBOX === "1") {
    const sync = await syncRemoteProgress({
      stateDir,
      repository: gitConfig.repository,
      stableBranch: gitConfig.stableBranch,
      diagnosticsBranch: gitConfig.diagnosticsBranch,
      ghCommand: process.env.INNER_SIGNAL_GH_COMMAND ?? "gh",
      enabled: false
    });
    return { ...sync, path: sync.path ?? progressPath };
  }

  const config = loadConfig({ mode: "mock", ledgerMode: "off", autopilotStateDir: stateDir });
  const [runtimeProgress, supervisor, updateStatus, diagnosticStatus, scheduleRaw, pending] = await Promise.all([
    readRuntimeProgress(stateDir).catch(() => null),
    buildDevelopmentSupervisorSnapshot(config, { now: observedAt }).catch(() => null),
    readJson(path.join(stateDir, "git-update-status.json")),
    readJson(path.join(stateDir, "diagnostic-sync-status.json")),
    readJson(path.join(stateDir, "progress-schedule.json")),
    pendingIncidentCount(stateDir)
  ]);
  const schedule = scheduleView(scheduleRaw);
  const machineId = path.basename(path.dirname(progressPath));
  const snapshot = buildRemoteProgressSnapshot({
    machineId,
    observedAt,
    runtime: {
      version: RUNTIME_VERSION,
      installedCommit: updateStatus?.installedCommit ?? null,
      nodeVersion: process.version
    },
    runtimeProgress,
    supervisor,
    update: updateStatus,
    diagnostics: { status: diagnosticStatus?.status, pending },
    priorSync: {
      coreHash: schedule.observedCoreHash,
      meaningfulProgressAt: schedule.meaningfulProgressAt
    },
    isProcessAlive
  });
  await queueRemoteProgressSnapshot({ stateDir, payload: snapshot.payload });

  const lastUploadMs = schedule.lastUploadAt ? Date.parse(schedule.lastUploadAt) : null;
  const pendingMeaningfulChange = schedule.uploadedCoreHash !== snapshot.coreHash;
  const due = progressUploadDecision({
    nowMs: now.valueOf(),
    lastUploadMs,
    meaningfulChanged: pendingMeaningfulChange,
    minimumMs: POLL_MS,
    heartbeatMs: HEARTBEAT_MS
  });

  let sync = {
    status: "deferred",
    uploaded: false,
    branch: gitConfig.diagnosticsBranch,
    path: progressPath,
    commitSha: null
  };
  if (due) {
    sync = await syncRemoteProgress({
      stateDir,
      repository: gitConfig.repository,
      stableBranch: gitConfig.stableBranch,
      diagnosticsBranch: gitConfig.diagnosticsBranch,
      payload: null,
      ghCommand: process.env.INNER_SIGNAL_GH_COMMAND ?? "gh",
      enabled: true
    });
  }

  const uploaded = sync.status === "synced";
  await atomicJson(path.join(stateDir, "progress-schedule.json"), {
    format: "inner-signal-progress-schedule-v1",
    observedCoreHash: snapshot.coreHash,
    uploadedCoreHash: uploaded ? snapshot.coreHash : schedule.uploadedCoreHash,
    meaningfulProgressAt: snapshot.payload.progress.meaningfulProgressAt,
    lastUploadAt: uploaded ? observedAt : schedule.lastUploadAt,
    updatedAt: observedAt
  });
  return sync;
}

function print(value) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...value }, null, 2)}\n`);
}

const mode = parseMode(process.argv.slice(2));
if (mode === "--once") {
  try {
    print(await oneIteration());
  } catch (error) {
    print({ status: "queued-for-retry", uploaded: false, error: error?.code ?? "PROGRESS_SYNC_UNAVAILABLE" });
    process.exitCode = 1;
  }
} else {
  let stopping = false;
  let releaseWait = null;
  const stop = () => {
    stopping = true;
    releaseWait?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    try {
      await oneIteration();
    } catch (error) {
      process.stderr.write(`[progress-sync] retryable warning: ${error?.code ?? "PROGRESS_SYNC_UNAVAILABLE"}\n`);
    }
    if (stopping) break;
    await new Promise((resolve) => {
      releaseWait = resolve;
      const timer = setTimeout(resolve, POLL_MS);
      releaseWait = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    releaseWait = null;
  }
}
