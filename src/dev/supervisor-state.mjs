import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readDevelopmentJobs } from "./queue.mjs";
import { readAutonomousRoadmapState, loadAutonomousDevelopmentRoadmap } from "./roadmap-queue.mjs";
import { DEV_FAILURE } from "./failure-classification.mjs";
import { readGuidePacketStatus } from "../guide-packet/store.mjs";

const STATE_FILE = "development-supervisor.json";
const ACTIVE_PROGRESS = new Set(["started", "retrying", "running", "ready"]);
const TERMINAL_PROGRESS = new Set(["completed", "failed", "blocked", "stopped"]);
const HUMAN_FAILURES = new Set([DEV_FAILURE.HUMAN_POLICY_REQUIRED, DEV_FAILURE.AUTH_REQUIRED]);
const writeQueues = new Map();

function statePath(config) { return path.join(config.autopilotStateDir, STATE_FILE); }
async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return fallback; }
}
async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temp, filePath);
}
function initialState() {
  return {
    format: "inner-signal-development-supervisor-v2",
    worker: { running: false, pid: null, startedAt: null, stoppedAt: null },
    currentOperation: null,
    lastEvent: null,
    lastAnalysis: null,
    lastActionResult: null,
    lastAnalyzedFingerprint: null,
    suppressedFingerprint: null,
    suppressionReason: "",
    actionHistory: [],
    updatedAt: null
  };
}

async function updateState(config, updater) {
  const filePath = statePath(config);
  const priorQueue = writeQueues.get(filePath) ?? Promise.resolve();
  const operation = priorQueue.catch(() => {}).then(async () => {
    const prior = await readJson(filePath, initialState());
    const patch = await updater(prior) ?? {};
    const next = {
      ...prior,
      ...patch,
      format: "inner-signal-development-supervisor-v2",
      updatedAt: new Date().toISOString()
    };
    await atomicJson(filePath, next);
    return next;
  });
  const settled = operation.then(() => undefined, () => undefined);
  writeQueues.set(filePath, settled);
  settled.finally(() => {
    if (writeQueues.get(filePath) === settled) writeQueues.delete(filePath);
  });
  return await operation;
}

export async function readDevelopmentSupervisorState(config) {
  return await readJson(statePath(config), initialState());
}

export async function recordDevelopmentWorkerRuntime(config, patch) {
  return await updateState(config, (prior) => {
    const worker = { ...(prior.worker ?? {}), ...patch };
    if (patch.running === false && !patch.stoppedAt) worker.stoppedAt = new Date().toISOString();
    return { worker };
  });
}

export async function recordDevelopmentProgress(config, event = {}) {
  return await updateState(config, (prior) => {
    const at = event.at ?? new Date().toISOString();
    const taskId = event.taskId ?? (String(event.jobId ?? "").startsWith("roadmap-") ? String(event.jobId).slice("roadmap-".length) : null);
    const normalized = {
      at,
      jobId: event.jobId ?? null,
      taskId,
      stage: event.stage ?? "unknown",
      status: event.status ?? "unknown",
      detail: event.detail ?? "",
      model: event.model ?? (/(claude-|gpt-)[a-z0-9.-]+/i.exec(String(event.detail ?? ""))?.[0] ?? null)
    };
    let currentOperation = prior.currentOperation ?? null;
    if (ACTIVE_PROGRESS.has(normalized.status)) {
      const same = currentOperation && currentOperation.jobId === normalized.jobId && currentOperation.stage === normalized.stage;
      currentOperation = { ...normalized, startedAt: same ? currentOperation.startedAt : at };
    } else if (TERMINAL_PROGRESS.has(normalized.status)) {
      if (currentOperation?.jobId === normalized.jobId && currentOperation?.stage === normalized.stage) currentOperation = null;
    }
    return { currentOperation, lastEvent: normalized };
  });
}

export async function recordSupervisorAnalysis(config, {
  analysis,
  actionResult = null,
  stateFingerprint = null,
  suppressUntilStateChange = false
} = {}) {
  return await updateState(config, (prior) => {
    const at = new Date().toISOString();
    const entry = { at, analysis, actionResult, stateFingerprint };
    const history = [...(prior.actionHistory ?? []), entry].slice(-50);
    return {
      lastAnalysis: analysis ? { ...analysis, at } : prior.lastAnalysis,
      lastActionResult: actionResult ?? prior.lastActionResult ?? null,
      lastAnalyzedFingerprint: stateFingerprint ?? prior.lastAnalyzedFingerprint ?? null,
      suppressedFingerprint: suppressUntilStateChange ? stateFingerprint : null,
      suppressionReason: suppressUntilStateChange ? (actionResult?.reason ?? "unchanged-blocked-state") : "",
      actionHistory: history
    };
  });
}

function stageOverall(stage = "", status = "") {
  const value = `${stage} ${status}`.toLowerCase();
  if (/repair|implement/.test(value)) return "REPAIRING";
  if (/review|audit/.test(value) && /retry|timeout/.test(value)) return "RECOVERING";
  if (/review|audit/.test(value)) return "REVIEWING";
  if (/verify|gate|test|package/.test(value)) return "VERIFYING";
  if (/live-regression|replay/.test(value)) return "LIVE_REGRESSION";
  if (/promotion/.test(value)) return "RECOVERING";
  return "WORKING";
}
function taskView(task, state) {
  return {
    id: task.id,
    name: task.name,
    priority: task.priority,
    automationClass: task.automationClass,
    status: state?.status ?? "queued",
    failureClass: state?.failureClass ?? null,
    blocker: state?.blocker ?? "",
    cycle: state?.cycle ?? null,
    model: state?.model ?? null,
    phase: state?.phase ?? null,
    updatedAt: state?.updatedAt ?? null,
    humanDecisionPacket: state?.humanDecisionPacket ?? null,
    supervisorRecoveryCount: Number(state?.supervisorRecoveryCount ?? 0),
    supervisorRecoveryFingerprints: state?.supervisorRecoveryFingerprints ?? [],
    supervisorRecoveryEngineRevision: state?.supervisorRecoveryEngineRevision ?? null,
    supervisorDirective: state?.supervisorDirective ?? null,
    supervisorDispatch: state?.supervisorDispatch ?? null,
    implementationCycleCount: Number(state?.implementationCycleCount ?? 0),
    lastFailure: state?.lastFailure ?? null,
    retryAfter: state?.retryAfter ?? null
  };
}
function isAutoEngineering(task) {
  return task.autoStart && ["engineering", "safety-sensitive-engineering"].includes(task.automationClass);
}
function isPendingStatus(status) {
  return ["audit-pending", "review-pending", "live-regression-pending", "tooling-pending", "authorized", "supervisor-repair", "auditing", "repairing", "reviewing", "verifying", "live-regression"].includes(status);
}
function stableTaskFact(task) {
  return {
    id: task.id,
    status: task.status,
    failureClass: task.failureClass,
    blocker: task.blocker,
    cycle: task.cycle,
    model: task.model,
    phase: task.phase,
    supervisorRecoveryCount: task.supervisorRecoveryCount,
    supervisorRecoveryFingerprints: task.supervisorRecoveryFingerprints,
    supervisorRecoveryEngineRevision: task.supervisorRecoveryEngineRevision,
    supervisorDirectiveFingerprint: task.supervisorDirective?.fingerprint ?? null,
    supervisorDispatch: task.supervisorDispatch ? {
      key: task.supervisorDispatch.key ?? null,
      state: task.supervisorDispatch.state ?? null,
      fingerprint: task.supervisorDispatch.fingerprint ?? null
    } : null,
    implementationCycleCount: task.implementationCycleCount,
    lastFailure: task.lastFailure,
    retryAfter: task.retryAfter
  };
}
function normalizedBlocker(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function stableGuidePacketFact(guideStatus) {
  const process = guideStatus?.process ?? {};
  const candidate = guideStatus?.candidate ?? null;
  const installed = guideStatus?.installed ?? null;
  return {
    process: {
      packetId: process.packetId ?? candidate?.packetId ?? null,
      stageId: process.stageId ?? process.stage ?? "none",
      lifecycle: process.lifecycle ?? (process.active ? "running" : "completed"),
      overall: process.overall ?? "IDLE",
      model: process.model ?? "none-deterministic",
      attemptId: process.attemptId ?? null,
      failureClass: process.failureClass ?? null,
      normalizedError: process.normalizedError ? {
        name: process.normalizedError.name ?? null,
        code: process.normalizedError.code ?? null,
        message: normalizedBlocker(process.normalizedError.message),
        failureClass: process.normalizedError.failureClass ?? process.failureClass ?? null
      } : null,
      blocker: normalizedBlocker(process.blocker),
      recoveryAction: process.recoveryAction ?? "",
      expectedNextStage: process.expectedNextStage ?? process.nextExpectedGate ?? null,
      nextAutomaticAction: process.nextAutomaticAction ?? "NONE",
      humanActionRequired: process.humanActionRequired === true,
      lastSuccessfulTransition: process.lastSuccessfulTransition ? {
        stageId: process.lastSuccessfulTransition.stageId ?? null,
        attemptId: process.lastSuccessfulTransition.attemptId ?? null,
        model: process.lastSuccessfulTransition.model ?? null
      } : null
    },
    candidate: candidate ? {
      packetId: candidate.packetId ?? null,
      packetSha256: candidate.packetSha256 ?? null,
      status: candidate.status ?? null,
      compilationStatus: candidate.compilation?.status ?? null,
      compilationModel: candidate.compilation?.compiler?.model ?? null,
      reviewStatus: candidate.independentReview?.status ?? null,
      reviewModel: candidate.independentReview?.reviewer?.model ?? null,
      escalationModel: candidate.independentReview?.escalation?.model ?? null,
      allApproved: candidate.allApproved === true,
      decisions: (candidate.decisionCards ?? []).map((card) => ({
        id: card.id,
        status: card.status ?? "pending",
        ownerNote: normalizedBlocker(card.ownerNote)
      }))
    } : null,
    installed: installed ? {
      packetId: installed.packetId ?? null,
      packetVersion: installed.packetVersion ?? null,
      packetRevision: installed.packetRevision ?? null,
      packetSha256: installed.packetSha256 ?? null
    } : null
  };
}
function stateFingerprintFor({ persisted, engineeringTasks, waitingHumanTask, waitingHumanJob, latestJob, guideStatus }) {
  const operation = persisted.currentOperation?.stage === "overall-analysis" ? null : persisted.currentOperation ?? null;
  const payload = {
    workerRunning: persisted.worker?.running === true,
    operation: operation ? {
      jobId: operation.jobId ?? null,
      taskId: operation.taskId ?? null,
      stage: operation.stage ?? null,
      status: operation.status ?? null,
      model: operation.model ?? null
    } : null,
    tasks: engineeringTasks.map(stableTaskFact),
    waitingHumanTask: waitingHumanTask?.id ?? null,
    waitingHumanJob: waitingHumanJob?.jobId ?? null,
    latestJob: latestJob ? {
      jobId: latestJob.jobId ?? null,
      status: latestJob.status ?? null,
      failureClass: latestJob.failureClass ?? null,
      blocker: latestJob.blocker ?? ""
    } : null,
    guidePacket: stableGuidePacketFact(guideStatus)
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export async function buildDevelopmentSupervisorSnapshot(config, { now = new Date().toISOString() } = {}) {
  const persisted = await readDevelopmentSupervisorState(config);
  const guideStatus = await readGuidePacketStatus(config).catch(() => ({ process: { active: false, overall: "IDLE", humanActionRequired: false }, candidate: null }));
  const jobs = await readDevelopmentJobs(config);
  const latestJob = jobs[0] ?? null;
  const roadmap = await loadAutonomousDevelopmentRoadmap();
  const roadmapState = await readAutonomousRoadmapState(config);
  const tasks = roadmap.tasks.map((task) => taskView(task, roadmapState.tasks?.[task.id] ?? null));
  const engineeringTasks = roadmap.tasks.filter(isAutoEngineering).map((task) => taskView(task, roadmapState.tasks?.[task.id] ?? null));
  const waitingHumanTask = tasks.find((task) => task.status === "awaiting-human") ?? null;
  const waitingHumanJob = jobs.find((job) => job.status === "awaiting-human") ?? null;
  const blockedTasks = engineeringTasks.filter((task) => task.status === "blocked").sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
  const pendingTasks = engineeringTasks.filter((task) => isPendingStatus(task.status)).sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
  const stateFingerprint = stateFingerprintFor({ persisted, engineeringTasks, waitingHumanTask, waitingHumanJob, latestJob, guideStatus });
  const activeOperation = persisted.worker?.running ? persisted.currentOperation : null;
  const currentTask = activeOperation?.taskId ? tasks.find((task) => task.id === activeOperation.taskId) ?? null : pendingTasks.find((task) => ["auditing", "repairing", "reviewing", "verifying", "live-regression", "supervisor-repair"].includes(task.status)) ?? null;
  let overall = "IDLE";
  let humanActionRequired = false;
  let nextAutomaticAction = "NONE";
  let humanDecision = null;
  if (waitingHumanTask || waitingHumanJob) {
    overall = "WAITING_FOR_HUMAN";
    humanActionRequired = true;
    nextAutomaticAction = "ASK_HUMAN";
    humanDecision = waitingHumanTask?.humanDecisionPacket ?? waitingHumanJob?.humanDecisionPacket ?? null;
  } else if (activeOperation && activeOperation.stage !== "overall-analysis") {
    overall = stageOverall(activeOperation.stage, activeOperation.status);
    nextAutomaticAction = "AUTO_CONTINUE";
  } else if (pendingTasks.length) {
    const top = pendingTasks[0];
    overall = ["review-pending", "live-regression-pending", "tooling-pending", "audit-pending"].includes(top.status) ? "RECOVERING" : "WORKING";
    nextAutomaticAction = "AUTO_CONTINUE";
  } else if (blockedTasks.length) {
    if (persisted.suppressedFingerprint && persisted.suppressedFingerprint === stateFingerprint) {
      overall = "BLOCKED_INTERNAL";
      nextAutomaticAction = "NONE";
    } else {
      overall = "BLOCKED_AUTO_RECOVERY";
      nextAutomaticAction = "AUTO_REPAIR";
    }
  } else if (engineeringTasks.every((task) => ["complete", "promotion-ready", "rejected"].includes(task.status))) {
    overall = "COMPLETE";
  } else if (persisted.worker?.running) {
    overall = "WORKING";
    nextAutomaticAction = "AUTO_CONTINUE";
  }
  const startedAt = activeOperation && activeOperation.stage !== "overall-analysis" ? activeOperation.startedAt ?? null : null;
  const elapsedMs = startedAt ? Math.max(0, Date.parse(now) - Date.parse(startedAt)) : null;
  let failureClass = currentTask?.failureClass ?? blockedTasks[0]?.failureClass ?? latestJob?.failureClass ?? null;
  let blocker = overall === "BLOCKED_INTERNAL"
    ? persisted.suppressionReason || currentTask?.blocker || blockedTasks[0]?.blocker || latestJob?.blocker || "Supervisor recovery is bounded until deterministic state changes."
    : currentTask?.blocker || blockedTasks[0]?.blocker || latestJob?.blocker || "";
  let currentView = activeOperation && activeOperation.stage !== "overall-analysis" ? { ...activeOperation, elapsedMs, task: currentTask } : currentTask ? { taskId: currentTask.id, stage: currentTask.phase ?? currentTask.status, status: currentTask.status, detail: currentTask.blocker ?? "", model: currentTask.model, startedAt: currentTask.updatedAt, elapsedMs: currentTask.updatedAt ? Math.max(0, Date.parse(now) - Date.parse(currentTask.updatedAt)) : null, task: currentTask } : null;
  const guideProcess = guideStatus.process ?? { active: false, overall: "IDLE", humanActionRequired: false };
  const foregroundGuidePacket = guideProcess.active
    || guideProcess.humanActionRequired
    || ["running", "recovering", "blocked", "waiting_for_owner"].includes(guideProcess.lifecycle);
  if (foregroundGuidePacket) {
    overall = guideProcess.overall || (guideProcess.humanActionRequired ? "WAITING_FOR_HUMAN" : "WORKING");
    humanActionRequired = guideProcess.humanActionRequired === true;
    nextAutomaticAction = guideProcess.nextAutomaticAction || (humanActionRequired ? "ASK_HUMAN" : "AUTO_CONTINUE");
    blocker = guideProcess.blocker || "";
    failureClass = guideProcess.failureClass ?? failureClass;
    const guideStartedAt = guideProcess.startedAt || guideProcess.updatedAt || now;
    currentView = {
      taskId: "GUIDE_PACKET",
      stage: guideProcess.stage || "packet-processing",
      status: overall,
      lifecycle: guideProcess.lifecycle ?? (guideProcess.active ? "running" : "completed"),
      attemptId: guideProcess.attemptId ?? null,
      failureClass: guideProcess.failureClass ?? null,
      detail: blocker,
      model: guideProcess.model || "none-deterministic",
      startedAt: guideStartedAt,
      elapsedMs: Math.max(0, Date.parse(now) - Date.parse(guideStartedAt)),
      lastSuccessfulTransition: guideProcess.lastSuccessfulTransition ?? null,
      recoveryAction: guideProcess.recoveryAction ?? "",
      nextExpectedGate: guideProcess.nextExpectedGate ?? guideProcess.expectedNextStage ?? null,
      task: { id: "GUIDE_PACKET", name: `Guide packet ${guideProcess.packetId || guideStatus.candidate?.packetVersion || "update"}`, status: overall, blocker }
    };
    humanDecision = humanActionRequired ? { reason: blocker || "Substantive guide decisions require owner approval.", packetId: guideProcess.packetId || guideStatus.candidate?.packetId || null } : null;
  }
  const statusDomain = foregroundGuidePacket ? "guide-packet" : "development";
  const nextAutomaticDetail = foregroundGuidePacket
    ? guideProcess.recoveryAction || guideProcess.expectedNextStage || guideProcess.nextExpectedGate || ""
    : persisted.lastAnalysis?.repair_directive ?? "";
  const nextAutomaticLabel = `${nextAutomaticAction || "NONE"}${nextAutomaticDetail ? ` — ${nextAutomaticDetail}` : ""}`;
  const statusSummary = foregroundGuidePacket
    ? "Guide Packet processing is the foreground automation domain."
    : persisted.lastAnalysis?.trajectory
      ? `Trajectory: ${persisted.lastAnalysis.trajectory}`
      : "Deterministic state is the source of truth.";
  const visibleLastEvent = foregroundGuidePacket
    ? {
        at: guideProcess.lastSuccessfulTransition?.completedAt ?? guideProcess.updatedAt ?? null,
        stage: guideProcess.lastSuccessfulTransition?.stageId ?? guideProcess.stageId ?? guideProcess.stage ?? "packet-processing",
        status: guideProcess.lastSuccessfulTransition ? "completed" : guideProcess.lifecycle ?? (guideProcess.active ? "running" : "blocked"),
        model: guideProcess.lastSuccessfulTransition?.model ?? guideProcess.model ?? null,
        domain: "guide-packet"
      }
    : persisted.lastEvent ?? null;
  return {
    format: "inner-signal-development-supervisor-snapshot-v2",
    at: now,
    stateFingerprint,
    overall,
    worker: persisted.worker ?? { running: false, pid: null },
    current: currentView,
    lastEvent: visibleLastEvent,
    lastAnalysis: persisted.lastAnalysis ?? null,
    lastActionResult: persisted.lastActionResult ?? null,
    failureClass,
    blocker,
    blockedTasks,
    pendingTasks,
    humanActionRequired,
    humanDecision,
    nextAutomaticAction,
    nextAutomaticDetail,
    nextAutomaticLabel,
    statusDomain,
    statusSummary,
    guidePacket: guideStatus,
    latestJob: latestJob ? { jobId: latestJob.jobId, status: latestJob.status, failureClass: latestJob.failureClass ?? null, blocker: latestJob.blocker ?? "", updatedAt: latestJob.updatedAt ?? null } : null
  };
}

export { statePath as developmentSupervisorStatePath };
