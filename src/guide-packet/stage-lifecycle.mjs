import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  GUIDE_PACKET_FAILURE,
  classifyGuidePacketFailure,
  normalizeGuidePacketError
} from "./failure-classification.mjs";

const STATUS_FORMAT = "inner-signal-guide-packet-processing-v2";
const LEDGER_FORMAT = "inner-signal-guide-packet-stage-attempts-v1";
const MAX_ATTEMPTS = 100;
const writeQueues = new Map();

function rootFor(config) {
  return config.guidePacketRoot ?? path.join(config.autopilotStateDir, "guide-packets");
}

function statusPath(config) {
  return path.join(rootFor(config), "processing-status.json");
}

function attemptsPath(config) {
  return path.join(rootFor(config), "stage-attempts.json");
}

function iso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function defaultStatus() {
  return {
    format: STATUS_FORMAT,
    active: false,
    lifecycle: "completed",
    overall: "IDLE",
    stage: "none",
    stageId: "none",
    packetId: null,
    model: "none-deterministic",
    attemptId: null,
    workerPid: null,
    blocker: "",
    failureClass: null,
    normalizedError: null,
    recoveryAction: "",
    expectedNextStage: null,
    nextExpectedGate: null,
    nextAutomaticAction: "NONE",
    humanActionRequired: false,
    lastSuccessfulTransition: null,
    updatedAt: null
  };
}

function defaultLedger() {
  return { format: LEDGER_FORMAT, attempts: [], updatedAt: null };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

async function serialize(config, operation) {
  const key = rootFor(config);
  const prior = writeQueues.get(key) ?? Promise.resolve();
  const running = prior.catch(() => {}).then(operation);
  const settled = running.then(() => undefined, () => undefined);
  writeQueues.set(key, settled);
  settled.finally(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key);
  });
  return await running;
}

async function mutateState(config, updater) {
  return await serialize(config, async () => {
    const priorStatus = await readJson(statusPath(config), defaultStatus());
    const priorLedger = await readJson(attemptsPath(config), defaultLedger());
    const next = await updater(priorStatus, priorLedger) ?? {};
    const status = { ...defaultStatus(), ...priorStatus, ...(next.status ?? {}), format: STATUS_FORMAT };
    const ledger = {
      ...defaultLedger(),
      ...priorLedger,
      ...(next.ledger ?? {}),
      format: LEDGER_FORMAT,
      attempts: (next.ledger?.attempts ?? priorLedger.attempts ?? []).slice(-MAX_ATTEMPTS)
    };
    await atomicJson(statusPath(config), status);
    await atomicJson(attemptsPath(config), ledger);
    return { status, ledger };
  });
}

export async function writeGuidePacketProcessingStatus(config, patch = {}) {
  const now = patch.updatedAt ?? new Date().toISOString();
  const { status } = await mutateState(config, (priorStatus) => ({
    status: {
      ...patch,
      stage: patch.stageId ?? patch.stage ?? priorStatus.stage ?? "none",
      stageId: patch.stageId ?? patch.stage ?? priorStatus.stageId ?? "none",
      updatedAt: now,
      lastTransitionAt: patch.lastTransitionAt ?? priorStatus.lastTransitionAt ?? now
    },
    ledger: { updatedAt: now }
  }));
  return status;
}

export async function readGuidePacketStageAttempts(config) {
  return await readJson(attemptsPath(config), defaultLedger());
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isGuidePacketAttemptLive(status, {
  attempts = [],
  now = new Date(),
  staleMs = 30000,
  isProcessAlive = defaultIsProcessAlive
} = {}) {
  if (!(status?.lifecycle === "running" || (status?.active === true && !status?.lifecycle))) return false;
  const attempt = attempts.find((item) => item.attemptId && item.attemptId === status.attemptId);
  if (!attempt || attempt.lifecycle !== "running") return false;
  const heartbeat = Date.parse(status.heartbeatAt ?? attempt.heartbeatAt ?? "");
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(heartbeat) || !Number.isFinite(nowMs) || nowMs - heartbeat > staleMs) return false;
  return isProcessAlive(Number(status.workerPid ?? attempt.workerPid));
}

function failurePresentation(failureClass) {
  if (failureClass === GUIDE_PACKET_FAILURE.AUTH_REQUIRED) {
    return {
      lifecycle: "blocked",
      overall: "ACTION_REQUIRED",
      recoveryAction: "complete-cli-authentication-then-resume",
      nextAutomaticAction: "ASK_HUMAN",
      humanActionRequired: true
    };
  }
  return {
    lifecycle: "blocked",
    overall: "BLOCKED_AUTO_RECOVERY",
    recoveryAction: "resume-from-staged-candidate",
    nextAutomaticAction: "AUTO_REPAIR",
    humanActionRequired: false
  };
}

function transition(at, lifecycle) {
  return { at, lifecycle };
}

export async function runGuidePacketStage({
  config,
  packetId,
  stageId,
  model,
  expectedNextStage = null,
  operation,
  persistResult = async () => {},
  heartbeatMs = config.guidePacketHeartbeatMs ?? 5000
}) {
  const attemptId = randomUUID();
  const queuedAt = new Date().toISOString();
  const startedAt = queuedAt;
  const workerPid = process.pid;
  await mutateState(config, (priorStatus, priorLedger) => {
    const attempt = {
      attemptId,
      packetId,
      stageId,
      model,
      lifecycle: "running",
      workerPid,
      queuedAt,
      startedAt,
      heartbeatAt: startedAt,
      completedAt: null,
      expectedNextStage,
      failureClass: null,
      normalizedError: null,
      outputRef: null,
      transitions: [transition(queuedAt, "queued"), transition(startedAt, "running")]
    };
    return {
      status: {
        active: true,
        lifecycle: "running",
        overall: /review|audit|adjudication/i.test(stageId) ? "REVIEWING" : "WORKING",
        stage: stageId,
        stageId,
        packetId,
        model,
        attemptId,
        workerPid,
        queuedAt,
        startedAt,
        heartbeatAt: startedAt,
        lastTransitionAt: startedAt,
        expectedNextStage,
        nextExpectedGate: expectedNextStage,
        blocker: "",
        failureClass: null,
        normalizedError: null,
        recoveryAction: "",
        nextAutomaticAction: "AUTO_CONTINUE",
        humanActionRequired: false,
        updatedAt: startedAt,
        lastSuccessfulTransition: priorStatus.lastSuccessfulTransition ?? null
      },
      ledger: { attempts: [...(priorLedger.attempts ?? []), attempt], updatedAt: startedAt }
    };
  });

  let heartbeatRunning = true;
  const heartbeat = setInterval(() => {
    if (!heartbeatRunning) return;
    const at = new Date().toISOString();
    void mutateState(config, (status, ledger) => {
      if (status.attemptId !== attemptId || status.lifecycle !== "running") return {};
      const attempts = (ledger.attempts ?? []).map((item) => item.attemptId === attemptId ? { ...item, heartbeatAt: at } : item);
      return { status: { heartbeatAt: at, updatedAt: at }, ledger: { attempts, updatedAt: at } };
    }).catch(() => {});
  }, Math.max(1, heartbeatMs));
  heartbeat.unref?.();

  try {
    const result = await operation();
    await persistResult(result, { attemptId, stageId, packetId, model });
    heartbeatRunning = false;
    clearInterval(heartbeat);
    const completedAt = new Date().toISOString();
    await mutateState(config, (status, ledger) => {
      const attempts = (ledger.attempts ?? []).map((item) => item.attemptId === attemptId ? {
        ...item,
        lifecycle: "completed",
        completedAt,
        heartbeatAt: completedAt,
        outputRef: `candidate:${packetId}:${stageId}`,
        transitions: [...(item.transitions ?? []), transition(completedAt, "completed")]
      } : item);
      return {
        status: {
          active: false,
          lifecycle: "completed",
          overall: expectedNextStage ? "WORKING" : "COMPLETE",
          heartbeatAt: completedAt,
          completedAt,
          lastTransitionAt: completedAt,
          blocker: "",
          failureClass: null,
          normalizedError: null,
          recoveryAction: "",
          nextAutomaticAction: expectedNextStage ? "AUTO_CONTINUE" : "NONE",
          humanActionRequired: false,
          lastSuccessfulTransition: { stageId, attemptId, model, completedAt },
          updatedAt: completedAt
        },
        ledger: { attempts, updatedAt: completedAt }
      };
    });
    return result;
  } catch (error) {
    heartbeatRunning = false;
    clearInterval(heartbeat);
    const failedAt = new Date().toISOString();
    const failureClass = classifyGuidePacketFailure(error, { phase: stageId });
    const normalizedError = normalizeGuidePacketError(error, failureClass, { at: failedAt });
    const presentation = failurePresentation(failureClass);
    await mutateState(config, (status, ledger) => {
      const attempts = (ledger.attempts ?? []).map((item) => item.attemptId === attemptId ? {
        ...item,
        lifecycle: presentation.lifecycle,
        completedAt: failedAt,
        heartbeatAt: failedAt,
        failureClass,
        normalizedError,
        transitions: [...(item.transitions ?? []), transition(failedAt, presentation.lifecycle)]
      } : item);
      return {
        status: {
          ...presentation,
          active: false,
          heartbeatAt: failedAt,
          completedAt: failedAt,
          lastTransitionAt: failedAt,
          blocker: normalizedError.message,
          failureClass,
          normalizedError,
          updatedAt: failedAt,
          lastSuccessfulTransition: status.lastSuccessfulTransition ?? null
        },
        ledger: { attempts, updatedAt: failedAt }
      };
    });
    throw error;
  }
}

function inferredNextStage(stageId) {
  if (stageId === "opus-source-role-compilation") return "codex-independent-audit";
  if (stageId === "codex-independent-audit") return "fable-adjudication-or-deterministic-gates";
  if (stageId === "fable-adjudication") return "post-review-deterministic-gates";
  return null;
}

export async function reconcileGuidePacketProcessingState(config, {
  now = new Date(),
  isProcessAlive = defaultIsProcessAlive
} = {}) {
  const at = iso(now);
  const status = await readJson(statusPath(config), defaultStatus());
  const ledger = await readJson(attemptsPath(config), defaultLedger());
  const claimsRunning = status.lifecycle === "running" || (status.active === true && !status.lifecycle);
  if (!claimsRunning) return { recovered: false, reason: "no-running-stage", status };
  const live = isGuidePacketAttemptLive(status, {
    attempts: ledger.attempts ?? [],
    now,
    staleMs: config.guidePacketStaleMs ?? 30000,
    isProcessAlive
  });
  if (live) return { recovered: false, reason: "stage-still-live", status };

  const attemptId = status.attemptId || randomUUID();
  const stageId = status.stageId || status.stage || "packet-processing";
  const failureClass = GUIDE_PACKET_FAILURE.STALE_STAGE;
  const error = new Error("Guide Packet stage stopped without a terminal state.");
  error.code = "STALE_STAGE";
  const normalizedError = normalizeGuidePacketError(error, failureClass, { at });
  const existing = (ledger.attempts ?? []).find((item) => item.attemptId === attemptId);
  const attempts = existing
    ? (ledger.attempts ?? []).map((item) => item.attemptId === attemptId ? {
        ...item,
        lifecycle: "recovering",
        completedAt: at,
        heartbeatAt: item.heartbeatAt ?? status.heartbeatAt ?? status.updatedAt ?? at,
        failureClass,
        normalizedError,
        transitions: [...(item.transitions ?? []), transition(at, "recovering")]
      } : item)
    : [...(ledger.attempts ?? []), {
        attemptId,
        packetId: status.packetId ?? null,
        stageId,
        model: status.model ?? "unknown",
        lifecycle: "recovering",
        workerPid: status.workerPid ?? null,
        queuedAt: status.queuedAt ?? status.updatedAt ?? at,
        startedAt: status.startedAt ?? status.updatedAt ?? at,
        heartbeatAt: status.heartbeatAt ?? status.updatedAt ?? at,
        completedAt: at,
        expectedNextStage: status.expectedNextStage ?? inferredNextStage(stageId),
        failureClass,
        normalizedError,
        outputRef: null,
        transitions: [transition(at, "recovering")]
      }];

  const updated = await mutateState(config, (priorStatus) => ({
    status: {
      active: false,
      lifecycle: "recovering",
      overall: "RECOVERING",
      stage: stageId,
      stageId,
      attemptId,
      workerPid: null,
      expectedNextStage: priorStatus.expectedNextStage ?? inferredNextStage(stageId),
      nextExpectedGate: priorStatus.nextExpectedGate ?? priorStatus.expectedNextStage ?? inferredNextStage(stageId),
      blocker: normalizedError.message,
      failureClass,
      normalizedError,
      recoveryAction: "resume-from-staged-candidate",
      nextAutomaticAction: "AUTO_CONTINUE",
      humanActionRequired: false,
      lastTransitionAt: at,
      updatedAt: at
    },
    ledger: { attempts, updatedAt: at }
  }));
  return { recovered: true, reason: "orphaned-running-stage", status: updated.status };
}
