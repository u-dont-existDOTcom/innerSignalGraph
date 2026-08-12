import { createHash } from "node:crypto";
import { parseModelJson } from "../core/json.mjs";
import { CodexCliProvider } from "../providers/codex-cli.mjs";
import { DEV_FAILURE } from "./failure-classification.mjs";
import {
  buildDevelopmentSupervisorSnapshot,
  readDevelopmentSupervisorState,
  recordSupervisorAnalysis
} from "./supervisor-state.mjs";
import {
  markRoadmapTask,
  nextAutonomousRoadmapTask,
  readAutonomousRoadmapState
} from "./roadmap-queue.mjs";
import { DEV_ENGINE_REVISION } from "./engine.mjs";

const HUMAN_FAILURES = new Set([DEV_FAILURE.HUMAN_POLICY_REQUIRED, DEV_FAILURE.AUTH_REQUIRED, DEV_FAILURE.MISSING_INPUT]);
const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["AUTO_CONTINUE", "AUTO_REPAIR", "ASK_HUMAN"] },
    target_task_id: { type: "string" },
    trajectory: { type: "string" },
    failure_class: { type: "string" },
    root_issue: { type: "string" },
    repair_directive: { type: "string" },
    evidence_refs: { type: "array", items: { type: "string" } },
    human_decision_required: { type: "boolean" },
    human_decision_reason: { type: "string" },
    worst_plausible_failure: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["action", "target_task_id", "trajectory", "failure_class", "root_issue", "repair_directive", "evidence_refs", "human_decision_required", "human_decision_reason", "worst_plausible_failure", "confidence"]
};

function fingerprint(text) { return createHash("sha256").update(String(text)).digest("hex").slice(0, 20); }
function firstBlocked(snapshot) { return snapshot.blockedTasks?.[0] ?? null; }
function fallbackAnalysis(snapshot) {
  const task = firstBlocked(snapshot);
  if (!task) return { action: "AUTO_CONTINUE", target_task_id: "", trajectory: snapshot.overall, failure_class: snapshot.failureClass ?? "", root_issue: snapshot.blocker || "No terminal engineering blocker is present.", repair_directive: "Continue the current validated development state machine.", evidence_refs: ["deterministic-snapshot"], human_decision_required: snapshot.humanActionRequired, human_decision_reason: snapshot.humanDecision?.reason ?? "", worst_plausible_failure: "An infrastructure state could be mistaken for a code defect.", confidence: "high" };
  const required = task.lastFailure?.review?.required_changes ?? task.lastFailure?.review?.requiredChanges ?? [];
  const directive = Array.isArray(required) && required.length ? required.join(" ") : task.blocker || "Reopen the blocked engineering task and address the last demonstrated failure without weakening existing contracts.";
  return { action: "AUTO_REPAIR", target_task_id: task.id, trajectory: "blocked-but-recoverable", failure_class: task.failureClass ?? snapshot.failureClass ?? DEV_FAILURE.IMPLEMENTATION_FAILURE, root_issue: task.blocker || "Engineering task exhausted its bounded implementation budget.", repair_directive: directive, evidence_refs: [`roadmap:${task.id}`, `roadmap:${task.id}:lastFailure`], human_decision_required: false, human_decision_reason: "", worst_plausible_failure: "A repeated repair strategy could loop or weaken a safety contract if independent review is bypassed.", confidence: "medium" };
}

function revisionRecoveryState(task) {
  const sameRevision = task?.supervisorRecoveryEngineRevision === DEV_ENGINE_REVISION;
  return {
    count: sameRevision ? Number(task?.supervisorRecoveryCount ?? 0) : 0,
    priorFingerprints: sameRevision && Array.isArray(task?.supervisorRecoveryFingerprints) ? task.supervisorRecoveryFingerprints : []
  };
}

function actionDetail(result) {
  const task = result?.taskId ? ` ${result.taskId}` : "";
  if (result?.applied) return `${result.action}${task} queued`;
  return `${result?.action ?? "AUTO_CONTINUE"}${task}${result?.reason ? ` — ${result.reason}` : ""}`;
}

export function validateSupervisorAction(snapshot, proposed) {
  const task = proposed?.target_task_id ? snapshot.blockedTasks?.find((item) => item.id === proposed.target_task_id) : firstBlocked(snapshot);
  if (snapshot.humanActionRequired || HUMAN_FAILURES.has(task?.failureClass) || HUMAN_FAILURES.has(proposed?.failure_class)) {
    return { ...proposed, action: "ASK_HUMAN", target_task_id: task?.id ?? proposed?.target_task_id ?? "", human_decision_required: true, human_decision_reason: snapshot.humanDecision?.reason || proposed?.human_decision_reason || "A genuinely human-controlled decision or action is required." };
  }
  if (proposed?.action === "AUTO_REPAIR" && !task) return { ...proposed, action: "AUTO_CONTINUE", target_task_id: "", human_decision_required: false };
  return { ...proposed, target_task_id: task?.id ?? proposed?.target_task_id ?? "", human_decision_required: proposed?.action === "ASK_HUMAN" ? true : false };
}

async function persistSuppressedResult({ config, snapshot, analysis, task, reason }) {
  const result = { action: "AUTO_CONTINUE", taskId: task?.id ?? null, applied: false, reason };
  await recordSupervisorAnalysis(config, {
    analysis: { ...analysis, action: "AUTO_CONTINUE" },
    actionResult: result,
    stateFingerprint: snapshot.stateFingerprint,
    suppressUntilStateChange: true
  });
  return result;
}

export async function applyValidatedSupervisorAction({ config, snapshot, analysis }) {
  if (analysis.action !== "AUTO_REPAIR") {
    const result = { action: analysis.action, taskId: analysis.target_task_id || null, applied: false };
    await recordSupervisorAnalysis(config, { analysis, actionResult: result, stateFingerprint: snapshot.stateFingerprint });
    return result;
  }
  const task = snapshot.blockedTasks?.find((item) => item.id === analysis.target_task_id) ?? firstBlocked(snapshot);
  if (!task) {
    const result = { action: "AUTO_CONTINUE", taskId: null, applied: false, reason: "No blocked engineering task." };
    await recordSupervisorAnalysis(config, { analysis: { ...analysis, action: "AUTO_CONTINUE" }, actionResult: result, stateFingerprint: snapshot.stateFingerprint });
    return result;
  }

  const { count, priorFingerprints } = revisionRecoveryState(task);
  const max = Number(config.devSupervisorMaxRecoveries ?? 2);
  const repairFingerprint = fingerprint(`${task.id}\n${analysis.root_issue}\n${analysis.repair_directive}`);
  if (count >= max || priorFingerprints.includes(repairFingerprint)) {
    return await persistSuppressedResult({
      config,
      snapshot,
      analysis,
      task,
      reason: count >= max ? "supervisor-recovery-budget-exhausted" : "repeated-supervisor-strategy"
    });
  }

  const now = new Date().toISOString();
  const dispatchKey = fingerprint(`${DEV_ENGINE_REVISION}\n${task.id}\n${repairFingerprint}`);
  const directive = {
    at: now,
    trajectory: analysis.trajectory,
    rootIssue: analysis.root_issue,
    repairDirective: analysis.repair_directive,
    evidenceRefs: analysis.evidence_refs,
    worstPlausibleFailure: analysis.worst_plausible_failure,
    confidence: analysis.confidence,
    fingerprint: repairFingerprint
  };
  await markRoadmapTask(config, task.id, {
    status: "supervisor-repair",
    implementationCycleCount: 0,
    supervisorRecoveryCount: count + 1,
    supervisorRecoveryFingerprints: [...priorFingerprints, repairFingerprint],
    supervisorRecoveryEngineRevision: DEV_ENGINE_REVISION,
    supervisorDirective: directive,
    supervisorDispatch: {
      key: dispatchKey,
      state: "queued",
      fingerprint: repairFingerprint,
      queuedAt: now,
      claimedAt: null
    },
    supervisorReopenedAt: now,
    retryAfter: null
  });

  const queueView = await nextAutonomousRoadmapTask(config);
  const visible = queueView.task?.id === task.id;
  const result = visible
    ? { action: "AUTO_REPAIR", taskId: task.id, applied: true, fingerprint: repairFingerprint, dispatchKey }
    : { action: "AUTO_REPAIR", taskId: task.id, applied: false, fingerprint: repairFingerprint, dispatchKey, reason: "supervisor-dispatch-not-worker-visible" };
  await recordSupervisorAnalysis(config, { analysis, actionResult: result, stateFingerprint: snapshot.stateFingerprint });
  return result;
}

async function analyzeBlockedState({ config, sourceRoot, snapshot }) {
  const fallback = fallbackAnalysis(snapshot);
  const task = firstBlocked(snapshot);
  if (!task) return fallback;
  try {
    const reviewer = new CodexCliProvider({ command: config.codexCommand, model: config.devReviewModel, reasoningEffort: "high", timeoutMs: config.devReviewExtendedTimeoutMs, cwd: sourceRoot, isolateConfig: true });
    const system = `You are the read-only Overall Development Supervisor for Inner Signal. Deterministic state supplied by the controller is the source of truth. Diagnose trajectory, not therapy content. You may choose AUTO_REPAIR only for engineering/restorative work. Never ask the human to handle review timeouts, test execution, worker sandbox restrictions, verifier defects, packaging integrity, stale state, incomplete repair scope, or other routine engineering. ASK_HUMAN is reserved for substantive therapy/safety/product policy, authentication, permissions, or genuinely missing canonical source. Do not edit files. Give a narrow repair directive that a separate isolated Opus/Fable implementer can execute and that still must pass deterministic verification plus independent review.`;
    const raw = await reviewer.generate({ system, user: JSON.stringify({ snapshot, targetTask: task }, null, 2), outputSchema: analysisSchema, metadata: { stage: "development_supervisor", taskId: task.id } });
    return parseModelJson(raw.text, "development supervisor analysis");
  } catch {
    return fallback;
  }
}

async function reconcileAppliedSupervisorDispatch({ config }) {
  const supervisorState = await readDevelopmentSupervisorState(config);
  const history = Array.isArray(supervisorState.actionHistory) ? supervisorState.actionHistory : [];
  const applied = [...history].reverse().find((entry) => entry?.actionResult?.action === "AUTO_REPAIR" && entry?.actionResult?.applied === true && entry?.actionResult?.dispatchKey);
  if (!applied) return { reconciled: false };

  const { taskId, dispatchKey, fingerprint: repairFingerprint } = applied.actionResult;
  const roadmapState = await readAutonomousRoadmapState(config);
  const taskState = roadmapState.tasks?.[taskId] ?? null;
  if (taskState?.supervisorDispatch?.key === dispatchKey) return { reconciled: false, alreadyPresent: true };
  if (!taskState) return { reconciled: false, reason: "missing-roadmap-task-state" };

  const analysis = applied.analysis ?? {};
  const directive = taskState.supervisorDirective ?? {
    at: applied.at ?? new Date().toISOString(),
    trajectory: analysis.trajectory ?? "blocked-but-recoverable",
    rootIssue: analysis.root_issue ?? "Recovered supervisor dispatch",
    repairDirective: analysis.repair_directive ?? "Resume the previously approved restorative repair.",
    evidenceRefs: analysis.evidence_refs ?? [],
    worstPlausibleFailure: analysis.worst_plausible_failure ?? "A missing dispatch could leave validated recovery work idle.",
    confidence: analysis.confidence ?? "medium",
    fingerprint: repairFingerprint
  };
  await markRoadmapTask(config, taskId, {
    status: "supervisor-repair",
    supervisorDirective: directive,
    supervisorDispatch: {
      key: dispatchKey,
      state: "queued",
      fingerprint: repairFingerprint ?? directive.fingerprint ?? null,
      queuedAt: new Date().toISOString(),
      claimedAt: null,
      reconciled: true
    },
    retryAfter: null
  });
  return { reconciled: true, taskId, dispatchKey };
}

export async function runDevelopmentSupervisorCycle({ config, sourceRoot, onProgress = () => {} }) {
  await reconcileAppliedSupervisorDispatch({ config });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);

  const persisted = await readDevelopmentSupervisorState(config);
  const now = Date.now();
  const retryDue = (snapshot.pendingTasks ?? []).some((task) => {
    const at = Date.parse(task.retryAfter ?? "");
    return Number.isFinite(at) && at <= now;
  });
  const guideAttemptLive = snapshot.guidePacket?.process?.active === true
    || snapshot.guidePacket?.process?.lifecycle === "running";
  const modelAttemptLive = snapshot.current?.taskId !== "GUIDE_PACKET"
    && Boolean(snapshot.current?.model)
    && ["WORKING", "REPAIRING", "REVIEWING", "VERIFYING", "LIVE_REGRESSION", "RECOVERING"].includes(snapshot.overall);
  if (snapshot.overall !== "BLOCKED_INTERNAL"
      && persisted.lastAnalyzedFingerprint === snapshot.stateFingerprint
      && !retryDue
      && !guideAttemptLive
      && !modelAttemptLive) {
    return {
      snapshot,
      analysis: persisted.lastAnalysis ?? fallbackAnalysis(snapshot),
      result: {
        action: persisted.lastActionResult?.action ?? (snapshot.humanActionRequired ? "ASK_HUMAN" : "AUTO_CONTINUE"),
        taskId: persisted.lastActionResult?.taskId ?? firstBlocked(snapshot)?.id ?? null,
        applied: false,
        reason: "unchanged-deterministic-state"
      },
      skippedAnalysis: true
    };
  }

  if (snapshot.overall === "BLOCKED_INTERNAL") {
    return {
      snapshot,
      analysis: snapshot.lastAnalysis ?? fallbackAnalysis(snapshot),
      result: { action: "AUTO_CONTINUE", taskId: firstBlocked(snapshot)?.id ?? null, applied: false, reason: "unchanged-blocked-state-suppressed" },
      skippedAnalysis: true
    };
  }

  if (snapshot.overall !== "BLOCKED_AUTO_RECOVERY") {
    const action = snapshot.humanActionRequired ? "ASK_HUMAN" : "AUTO_CONTINUE";
    const analysis = validateSupervisorAction(snapshot, { ...fallbackAnalysis(snapshot), action, human_decision_required: snapshot.humanActionRequired });
    const result = await applyValidatedSupervisorAction({ config, snapshot, analysis });
    return { snapshot, analysis, result };
  }

  const target = firstBlocked(snapshot);
  onProgress({ jobId: `supervisor-${target?.id ?? "development"}`, stage: "overall-analysis", status: "started", detail: target ? `Analyzing ${target.id}` : "Analyzing development trajectory" });

  let proposed;
  const revisionRecovery = revisionRecoveryState(target);
  if (revisionRecovery.count >= Number(config.devSupervisorMaxRecoveries ?? 2)) {
    proposed = fallbackAnalysis(snapshot);
  } else {
    proposed = await analyzeBlockedState({ config, sourceRoot, snapshot });
  }
  const analysis = validateSupervisorAction(snapshot, proposed);
  const result = await applyValidatedSupervisorAction({ config, snapshot, analysis });
  onProgress({ jobId: `supervisor-${target?.id ?? "development"}`, stage: "overall-analysis", status: "completed", detail: actionDetail(result) });
  return { snapshot, analysis, result };
}
