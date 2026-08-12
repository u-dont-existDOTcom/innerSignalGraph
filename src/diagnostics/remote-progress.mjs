import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const VERSION = /^v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9.-]+)?$/;
const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const STAGE = /^[A-Za-z][A-Za-z0-9:._-]{0,95}$/;
const PRIVATE_CODE = /(?:private|secret|token|credential|therapy|hypnosis|chat|prompt|reasoning|output)/i;
const CORE_HASH = /^[a-f0-9]{64}$/i;
const OVERALL = new Set([
  "IDLE",
  "WORKING",
  "REPAIRING",
  "REVIEWING",
  "VERIFYING",
  "LIVE_REGRESSION",
  "RECOVERING",
  "WAITING_FOR_HUMAN",
  "BLOCKED_INTERNAL",
  "BLOCKED_AUTO_RECOVERY",
  "COMPLETE"
]);
const ACTIONS = new Set(["NONE", "AUTO_CONTINUE", "AUTO_REPAIR", "ASK_HUMAN"]);
const DOMAINS = new Set(["runtime", "development", "idle"]);
const ASSESSMENTS = new Set([
  "COMPLETE",
  "IDLE",
  "WAITING_FOR_HUMAN",
  "BLOCKED",
  "WORKER_NOT_RUNNING",
  "LONG_RUNNING_STAGE",
  "ADVANCING"
]);
const EVENT_STATUS = new Set([
  "started", "running", "retrying", "ready", "completed", "failed", "blocked", "stopped",
  "PASS", "BLOCKED", "ACTION_REQUIRED", "DEFERRED", "FAILED_SAFE", "CURRENT", "UPDATED"
]);
const TERMINAL_STATUS = new Set(["PASS", "BLOCKED", "ACTION_REQUIRED", "DEFERRED", "FAILED_SAFE"]);
const DIAGNOSTIC_STATUS = new Set(["synced", "queued-for-retry", "disabled", "authentication-required", "unknown"]);
const writeQueues = new Map();
const PAYLOAD_KEYS = ["diagnostics", "format", "machineId", "observedAt", "privacy", "progress", "runtime", "update"];
const RUNTIME_KEYS = ["installedCommit", "nodeVersion", "version"];
const PROGRESS_KEYS = [
  "assessment", "blockedTaskCount", "currentStage", "currentStatus", "domain", "elapsedSeconds",
  "humanActionRequired", "lastCompletedStage", "meaningfulProgressAt", "nextAutomaticAction", "overall",
  "pendingTaskCount", "secondsSinceMeaningfulProgress", "workerAlive"
];
const UPDATE_KEYS = ["candidateCommit", "status"];
const DIAGNOSTIC_KEYS = ["pendingIncidentCount", "status"];
const PRIVACY_KEYS = [
  "identity", "includesChatContent", "includesCredentials", "includesModelOutput", "includesRawLogs", "includesTaskProse"
];

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().every((key, index) => key === keys[index])
    && Object.keys(value).length === keys.length;
}

function nullableMatch(value, pattern) {
  return value === null || (typeof value === "string" && pattern.test(value));
}

function boundedInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 31_536_000;
}

function safeTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : value;
}

function instant(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("Invalid progress timestamp");
  return date;
}

function safeInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function safeStage(value) {
  return typeof value === "string" && STAGE.test(value) && !PRIVATE_CODE.test(value) ? value : null;
}

function safeStatus(value) {
  return EVENT_STATUS.has(value) ? value : null;
}

function safeOverall(value) {
  return OVERALL.has(value) ? value : "IDLE";
}

function safeAction(value) {
  return ACTIONS.has(value) ? value : "NONE";
}

function boundedArrayCount(value) {
  return Array.isArray(value) ? Math.min(value.length, 100_000) : 0;
}

function elapsedSeconds(later, earlier) {
  const laterMs = Date.parse(later ?? "");
  const earlierMs = Date.parse(earlier ?? "");
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return 0;
  return Math.min(Math.max(0, Math.floor((laterMs - earlierMs) / 1000)), 31_536_000);
}

function processAlive(pid, checker) {
  if (!Number.isSafeInteger(pid) || pid < 1 || typeof checker !== "function") return false;
  try {
    return checker(pid) === true;
  } catch {
    return false;
  }
}

function assessment({ overall, workerAlive, secondsSinceMeaningfulProgress, humanActionRequired }) {
  if (overall === "COMPLETE") return "COMPLETE";
  if (overall === "IDLE") return "IDLE";
  if (humanActionRequired || overall === "WAITING_FOR_HUMAN") return "WAITING_FOR_HUMAN";
  if (overall === "BLOCKED_INTERNAL" || overall === "BLOCKED_AUTO_RECOVERY") return "BLOCKED";
  if (!workerAlive) return "WORKER_NOT_RUNNING";
  return secondsSinceMeaningfulProgress >= 900 ? "LONG_RUNNING_STAGE" : "ADVANCING";
}

function sourceProgress({ runtimeProgress, supervisor, isProcessAlive }) {
  const runtime = runtimeProgress && typeof runtimeProgress === "object" && !Array.isArray(runtimeProgress)
    ? runtimeProgress
    : null;
  const development = supervisor && typeof supervisor === "object" && !Array.isArray(supervisor)
    ? supervisor
    : {};
  const runtimeAlive = runtime?.active === true && processAlive(runtime.processPid, isProcessAlive);
  const developmentAlive = development.worker?.running === true
    && processAlive(development.worker?.pid, isProcessAlive);
  const developmentOverall = safeOverall(development.overall);

  if (runtimeAlive) {
    return {
      domain: "runtime",
      overall: "WORKING",
      currentStage: safeStage(runtime.currentStage),
      currentStatus: safeStatus(runtime.currentStatus),
      lastCompletedStage: safeStage(runtime.lastCompletedStage),
      workerAlive: true,
      startedAt: safeTimestamp(runtime.startedAt),
      latestEventAt: safeTimestamp(runtime.updatedAt),
      pendingTaskCount: 0,
      blockedTaskCount: 0,
      nextAutomaticAction: "AUTO_CONTINUE",
      humanActionRequired: false
    };
  }

  if (developmentAlive || developmentOverall !== "IDLE") {
    const current = development.current && typeof development.current === "object" ? development.current : {};
    const lastEvent = development.lastEvent && typeof development.lastEvent === "object" ? development.lastEvent : {};
    return {
      domain: "development",
      overall: developmentOverall,
      currentStage: safeStage(current.stage),
      currentStatus: safeStatus(current.status),
      lastCompletedStage: lastEvent.status === "completed" ? safeStage(lastEvent.stage) : null,
      workerAlive: developmentAlive,
      startedAt: safeTimestamp(current.startedAt),
      latestEventAt: safeTimestamp(lastEvent.at) ?? safeTimestamp(current.startedAt),
      pendingTaskCount: boundedArrayCount(development.pendingTasks),
      blockedTaskCount: boundedArrayCount(development.blockedTasks),
      nextAutomaticAction: safeAction(development.nextAutomaticAction),
      humanActionRequired: development.humanActionRequired === true
    };
  }

  if (runtime?.terminalStatus) {
    return {
      domain: "runtime",
      overall: runtime.terminalStatus === "PASS" ? "COMPLETE" : "BLOCKED_INTERNAL",
      currentStage: safeStage(runtime.currentStage),
      currentStatus: safeStatus(runtime.currentStatus),
      lastCompletedStage: safeStage(runtime.lastCompletedStage),
      workerAlive: false,
      startedAt: safeTimestamp(runtime.startedAt),
      latestEventAt: safeTimestamp(runtime.updatedAt),
      pendingTaskCount: 0,
      blockedTaskCount: runtime.terminalStatus === "PASS" ? 0 : 1,
      nextAutomaticAction: runtime.terminalStatus === "PASS" ? "NONE" : "AUTO_REPAIR",
      humanActionRequired: runtime.terminalStatus === "ACTION_REQUIRED"
    };
  }

  return {
    domain: "idle",
    overall: "IDLE",
    currentStage: null,
    currentStatus: null,
    lastCompletedStage: null,
    workerAlive: false,
    startedAt: null,
    latestEventAt: null,
    pendingTaskCount: 0,
    blockedTaskCount: 0,
    nextAutomaticAction: "NONE",
    humanActionRequired: false
  };
}

function safeRuntime(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: typeof source.version === "string" && VERSION.test(source.version) ? source.version : null,
    installedCommit: typeof source.installedCommit === "string" && GIT_SHA.test(source.installedCommit) ? source.installedCommit : null,
    nodeVersion: typeof source.nodeVersion === "string" && VERSION.test(source.nodeVersion) ? source.nodeVersion : null
  };
}

function safeUpdate(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: typeof source.status === "string" && SLUG.test(source.status) ? source.status : null,
    candidateCommit: typeof source.candidateCommit === "string" && GIT_SHA.test(source.candidateCommit)
      ? source.candidateCommit
      : null
  };
}

function safeDiagnostics(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    status: DIAGNOSTIC_STATUS.has(source.status) ? source.status : "unknown",
    pendingIncidentCount: safeInteger(source.pending, 100_000) ?? 0
  };
}

export function buildRemoteProgressSnapshot({
  machineId,
  observedAt,
  runtime,
  runtimeProgress = null,
  supervisor = null,
  update = null,
  diagnostics = null,
  priorSync = null,
  isProcessAlive = () => false
} = {}) {
  if (typeof machineId !== "string" || !UUID.test(machineId)) throw new TypeError("Invalid progress machine ID");
  const at = safeTimestamp(observedAt);
  if (!at) throw new TypeError("Invalid progress observation timestamp");
  const source = sourceProgress({ runtimeProgress, supervisor, isProcessAlive });
  const runtimeSafe = safeRuntime(runtime);
  const updateSafe = safeUpdate(update);
  const diagnosticsSafe = safeDiagnostics(diagnostics);
  const core = {
    runtime: runtimeSafe,
    source: {
      domain: source.domain,
      overall: source.overall,
      currentStage: source.currentStage,
      currentStatus: source.currentStatus,
      lastCompletedStage: source.lastCompletedStage,
      workerAlive: source.workerAlive,
      pendingTaskCount: source.pendingTaskCount,
      blockedTaskCount: source.blockedTaskCount,
      nextAutomaticAction: source.nextAutomaticAction,
      humanActionRequired: source.humanActionRequired
    },
    update: updateSafe,
    diagnostics: diagnosticsSafe
  };
  const coreHash = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  const priorHash = typeof priorSync?.coreHash === "string" && CORE_HASH.test(priorSync.coreHash)
    ? priorSync.coreHash
    : null;
  const meaningfulChanged = priorHash !== coreHash;
  const priorMeaningful = safeTimestamp(priorSync?.meaningfulProgressAt);
  const meaningfulProgressAt = meaningfulChanged ? at : priorMeaningful ?? source.latestEventAt ?? at;
  const secondsSinceMeaningfulProgress = elapsedSeconds(at, meaningfulProgressAt);
  const elapsed = elapsedSeconds(at, source.startedAt);

  return {
    coreHash,
    meaningfulChanged,
    payload: {
      format: "inner-signal-remote-progress-v1",
      machineId,
      observedAt: at,
      runtime: runtimeSafe,
      progress: {
        domain: source.domain,
        overall: source.overall,
        assessment: assessment({
          overall: source.overall,
          workerAlive: source.workerAlive,
          secondsSinceMeaningfulProgress,
          humanActionRequired: source.humanActionRequired
        }),
        currentStage: source.currentStage,
        currentStatus: source.currentStatus,
        lastCompletedStage: source.lastCompletedStage,
        workerAlive: source.workerAlive,
        elapsedSeconds: elapsed,
        meaningfulProgressAt,
        secondsSinceMeaningfulProgress,
        pendingTaskCount: source.pendingTaskCount,
        blockedTaskCount: source.blockedTaskCount,
        nextAutomaticAction: source.nextAutomaticAction,
        humanActionRequired: source.humanActionRequired
      },
      update: updateSafe,
      diagnostics: diagnosticsSafe,
      privacy: {
        identity: "random-local-uuid",
        includesChatContent: false,
        includesCredentials: false,
        includesModelOutput: false,
        includesRawLogs: false,
        includesTaskProse: false
      }
    }
  };
}

export function isRemoteProgressPayload(value) {
  if (!exactKeys(value, PAYLOAD_KEYS)
      || value.format !== "inner-signal-remote-progress-v1"
      || !UUID.test(value.machineId ?? "")
      || !safeTimestamp(value.observedAt)) return false;

  if (!exactKeys(value.runtime, RUNTIME_KEYS)
      || !nullableMatch(value.runtime.version, VERSION)
      || !nullableMatch(value.runtime.installedCommit, GIT_SHA)
      || !nullableMatch(value.runtime.nodeVersion, VERSION)) return false;

  const progress = value.progress;
  if (!exactKeys(progress, PROGRESS_KEYS)
      || !DOMAINS.has(progress.domain)
      || !OVERALL.has(progress.overall)
      || !ASSESSMENTS.has(progress.assessment)
      || !(progress.currentStage === null || safeStage(progress.currentStage) === progress.currentStage)
      || !(progress.currentStatus === null || safeStatus(progress.currentStatus) === progress.currentStatus)
      || !(progress.lastCompletedStage === null || safeStage(progress.lastCompletedStage) === progress.lastCompletedStage)
      || typeof progress.workerAlive !== "boolean"
      || !boundedInteger(progress.elapsedSeconds)
      || !safeTimestamp(progress.meaningfulProgressAt)
      || !boundedInteger(progress.secondsSinceMeaningfulProgress)
      || safeInteger(progress.pendingTaskCount, 100_000) === null
      || safeInteger(progress.blockedTaskCount, 100_000) === null
      || !ACTIONS.has(progress.nextAutomaticAction)
      || typeof progress.humanActionRequired !== "boolean") return false;

  if (!exactKeys(value.update, UPDATE_KEYS)
      || !(value.update.status === null || (typeof value.update.status === "string" && SLUG.test(value.update.status)))
      || !nullableMatch(value.update.candidateCommit, GIT_SHA)) return false;

  if (!exactKeys(value.diagnostics, DIAGNOSTIC_KEYS)
      || !DIAGNOSTIC_STATUS.has(value.diagnostics.status)
      || safeInteger(value.diagnostics.pendingIncidentCount, 100_000) === null) return false;

  return exactKeys(value.privacy, PRIVACY_KEYS)
    && value.privacy.identity === "random-local-uuid"
    && value.privacy.includesChatContent === false
    && value.privacy.includesCredentials === false
    && value.privacy.includesModelOutput === false
    && value.privacy.includesRawLogs === false
    && value.privacy.includesTaskProse === false;
}

export function progressUploadDecision({
  nowMs,
  lastUploadMs,
  meaningfulChanged,
  minimumMs = 30_000,
  heartbeatMs = 300_000
}) {
  if (!Number.isFinite(nowMs)) throw new TypeError("nowMs must be finite");
  if (!Number.isSafeInteger(minimumMs) || minimumMs < 1) throw new TypeError("minimumMs must be positive");
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < minimumMs) throw new TypeError("heartbeatMs must not be below minimumMs");
  if (lastUploadMs === null || lastUploadMs === undefined) return true;
  if (!Number.isFinite(lastUploadMs) || lastUploadMs < 0 || lastUploadMs > nowMs) return false;
  const elapsed = nowMs - lastUploadMs;
  return elapsed >= heartbeatMs || (meaningfulChanged === true && elapsed >= minimumMs);
}

function progressPath(stateDir) {
  return path.join(stateDir, "runtime-progress.json");
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

export async function readRuntimeProgress(stateDir) {
  try {
    return JSON.parse(await fs.readFile(progressPath(stateDir), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function updateRuntimeProgress(stateDir, updater) {
  if (typeof stateDir !== "string" || stateDir.length === 0) throw new TypeError("stateDir is required");
  const file = progressPath(stateDir);
  const prior = writeQueues.get(file) ?? Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    const current = await readRuntimeProgress(stateDir);
    const next = await updater(current);
    await atomicJson(file, next);
    return next;
  });
  const settled = operation.then(() => undefined, () => undefined);
  writeQueues.set(file, settled);
  settled.finally(() => {
    if (writeQueues.get(file) === settled) writeQueues.delete(file);
  });
  return await operation;
}

export async function recordRuntimeProgress({ stateDir, event = {}, now = () => new Date(), pid = process.pid }) {
  const at = instant(now).toISOString();
  const stage = safeStage(event.stage) ?? "unknown";
  const status = safeStatus(event.status) ?? "running";
  return await updateRuntimeProgress(stateDir, (prior) => ({
    format: "inner-signal-runtime-progress-v1",
    active: true,
    processPid: safeInteger(pid, 2_147_483_647),
    startedAt: safeTimestamp(prior?.startedAt) ?? at,
    updatedAt: at,
    currentStage: stage,
    currentStatus: status,
    lastCompletedStage: status === "completed" ? stage : safeStage(prior?.lastCompletedStage),
    terminalStatus: null
  }));
}

export async function finalizeRuntimeProgress({ stateDir, status, stage, now = () => new Date() }) {
  const at = instant(now).toISOString();
  const terminalStatus = TERMINAL_STATUS.has(status) ? status : "BLOCKED";
  return await updateRuntimeProgress(stateDir, (prior) => ({
    format: "inner-signal-runtime-progress-v1",
    active: false,
    processPid: safeInteger(prior?.processPid, 2_147_483_647),
    startedAt: safeTimestamp(prior?.startedAt) ?? at,
    updatedAt: at,
    currentStage: safeStage(stage) ?? "complete",
    currentStatus: terminalStatus,
    lastCompletedStage: safeStage(prior?.lastCompletedStage),
    terminalStatus
  }));
}
