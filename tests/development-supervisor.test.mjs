import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  recordDevelopmentWorkerRuntime,
  recordDevelopmentProgress,
  buildDevelopmentSupervisorSnapshot,
  readDevelopmentSupervisorState
} from "../src/dev/supervisor-state.mjs";
import { applyValidatedSupervisorAction, validateSupervisorAction, runDevelopmentSupervisorCycle } from "../src/dev/supervisor.mjs";
import { markRoadmapTask, readAutonomousRoadmapState, nextAutonomousRoadmapTask } from "../src/dev/roadmap-queue.mjs";
import { DEV_FAILURE } from "../src/dev/failure-classification.mjs";
import { DEV_ENGINE_REVISION } from "../src/dev/engine.mjs";

async function tempConfig(prefix = "inner-signal-supervisor-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    autopilotStateDir: root,
    devJobRoot: path.join(root, "development-jobs"),
    devPromotionMarker: path.join(root, "promotion-ready.json"),
    devSupervisorMaxRecoveries: 2
  };
}

test("supervisor snapshot exposes current repair stage from structured progress", async () => {
  const config = await tempConfig();
  await recordDevelopmentWorkerRuntime(config, { running: true, pid: 4321, startedAt: "2026-08-11T04:00:00.000Z" });
  await markRoadmapTask(config, "DEV-R004", { status: "repairing", jobId: "roadmap-DEV-R004", cycle: 2, model: "claude-fable-5" });
  await recordDevelopmentProgress(config, {
    jobId: "roadmap-DEV-R004",
    taskId: "DEV-R004",
    stage: "roadmap-repair-2",
    status: "started",
    detail: "claude-fable-5",
    at: "2026-08-11T04:01:00.000Z"
  });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config, { now: "2026-08-11T04:11:00.000Z" });
  assert.equal(snapshot.overall, "REPAIRING");
  assert.equal(snapshot.worker.running, true);
  assert.equal(snapshot.current.taskId, "DEV-R004");
  assert.equal(snapshot.current.stage, "roadmap-repair-2");
  assert.equal(snapshot.current.elapsedMs, 600000);
  assert.equal(snapshot.humanActionRequired, false);
});

test("supervisor says blocked auto recovery when every runnable roadmap task is blocked", async () => {
  const config = await tempConfig();
  await recordDevelopmentWorkerRuntime(config, { running: true, pid: 99 });
  for (const id of ["DEV-R001", "DEV-R002", "DEV-R003", "DEV-R004"]) {
    await markRoadmapTask(config, id, { status: "blocked", failureClass: DEV_FAILURE.REVIEW_REJECTION, blocker: `${id} rejected` });
  }
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);
  assert.equal(snapshot.overall, "BLOCKED_AUTO_RECOVERY");
  assert.equal(snapshot.humanActionRequired, false);
  assert.equal(snapshot.blockedTasks.length, 4);
  assert.equal(snapshot.nextAutomaticAction, "AUTO_REPAIR");
});

test("supervisor never auto repairs a human policy decision", async () => {
  const config = await tempConfig();
  await markRoadmapTask(config, "DEV-R004", {
    status: "awaiting-human",
    failureClass: DEV_FAILURE.HUMAN_POLICY_REQUIRED,
    humanDecisionPacket: { reason: "Change trauma-routing policy" }
  });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);
  const proposed = {
    action: "AUTO_REPAIR",
    failure_class: DEV_FAILURE.HUMAN_POLICY_REQUIRED,
    trajectory: "blocked",
    root_issue: "Policy change",
    repair_directive: "Change it anyway",
    evidence_refs: ["roadmap:DEV-R004"],
    human_decision_required: false,
    human_decision_reason: "",
    worst_plausible_failure: "policy drift",
    confidence: "high"
  };
  const validated = validateSupervisorAction(snapshot, proposed);
  assert.equal(validated.action, "ASK_HUMAN");
  assert.equal(validated.human_decision_required, true);
});

test("validated auto repair reopens a current-engine blocked task with a fresh bounded strategy", async () => {
  const config = await tempConfig();
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "review found manifest integrity defect",
    implementationCycleCount: 2,
    supervisorRecoveryCount: 0,
    lastFailure: { review: { required_changes: ["Hash after verification, not before."] } }
  });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);
  const proposed = validateSupervisorAction(snapshot, {
    action: "AUTO_REPAIR",
    failure_class: DEV_FAILURE.REVIEW_REJECTION,
    trajectory: "blocked-but-recoverable",
    root_issue: "Candidate hash is recorded before verification mutates generated files.",
    repair_directive: "Move final manifest/hash capture after all deterministic verification and review only the immutable final candidate.",
    evidence_refs: ["roadmap:DEV-R001:lastFailure"],
    human_decision_required: false,
    human_decision_reason: "",
    worst_plausible_failure: "promotion reviews a different tree",
    confidence: "high"
  });
  const result = await applyValidatedSupervisorAction({ config, snapshot, analysis: proposed });
  assert.equal(result.action, "AUTO_REPAIR");
  const state = await readAutonomousRoadmapState(config);
  const task = state.tasks["DEV-R001"];
  assert.equal(task.status, "supervisor-repair");
  assert.equal(task.implementationCycleCount, 0);
  assert.equal(task.supervisorRecoveryCount, 1);
  assert.match(task.supervisorDirective.repairDirective, /final manifest\/hash capture/);
  const next = await nextAutonomousRoadmapTask(config);
  assert.equal(next.task.id, "DEV-R001");
});

test("same supervisor repair fingerprint cannot create an unbounded repair loop", async () => {
  const config = await tempConfig();
  const directive = "Repair the same manifest integrity defect.";
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "same blocker",
    supervisorRecoveryCount: 2,
    supervisorRecoveryFingerprints: ["same-fingerprint"],
    supervisorRecoveryEngineRevision: DEV_ENGINE_REVISION,
    implementationCycleCount: 2
  });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);
  const proposed = validateSupervisorAction(snapshot, {
    action: "AUTO_REPAIR",
    failure_class: DEV_FAILURE.REVIEW_REJECTION,
    trajectory: "blocked-but-recoverable",
    root_issue: "same blocker",
    repair_directive: directive,
    evidence_refs: ["roadmap:DEV-R001"],
    human_decision_required: false,
    human_decision_reason: "",
    worst_plausible_failure: "loop",
    confidence: "high"
  });
  const result = await applyValidatedSupervisorAction({ config, snapshot, analysis: proposed });
  assert.notEqual(result.action, "AUTO_REPAIR");
  const state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R001"].status, "blocked");
});

test("supervisor state persists last analysis and action history", async () => {
  const config = await tempConfig();
  await recordDevelopmentWorkerRuntime(config, { running: true, pid: 1 });
  const state = await readDevelopmentSupervisorState(config);
  assert.equal(state.worker.running, true);
  assert.ok(Array.isArray(state.actionHistory));
});


test("supervisor recovery budget resets when the development engine revision changes", async () => {
  const config = await tempConfig();
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "new engine can repair old blocked state",
    supervisorRecoveryCount: 2,
    supervisorRecoveryFingerprints: ["old-a", "old-b"],
    supervisorRecoveryEngineRevision: "continuous-dev-v4-older"
  });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);
  const analysis = validateSupervisorAction(snapshot, {
    action: "AUTO_REPAIR",
    target_task_id: "DEV-R001",
    failure_class: DEV_FAILURE.REVIEW_REJECTION,
    trajectory: "blocked-but-recoverable",
    root_issue: "new engine fixes controller semantics",
    repair_directive: "Apply the current-engine controller repair.",
    evidence_refs: ["roadmap:DEV-R001"],
    human_decision_required: false,
    human_decision_reason: "",
    worst_plausible_failure: "stale budget prevents recovery",
    confidence: "high"
  });
  const result = await applyValidatedSupervisorAction({ config, snapshot, analysis });
  assert.equal(result.action, "AUTO_REPAIR");
  assert.equal(result.applied, true);
  const state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R001"].supervisorRecoveryCount, 1);
  assert.equal(state.tasks["DEV-R001"].supervisorRecoveryEngineRevision, DEV_ENGINE_REVISION);
});

test("successful AUTO_REPAIR persists a queue-visible dispatch key", async () => {
  const config = await tempConfig();
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "repair me",
    supervisorRecoveryCount: 0
  });
  const snapshot = await buildDevelopmentSupervisorSnapshot(config);
  const analysis = validateSupervisorAction(snapshot, {
    action: "AUTO_REPAIR",
    target_task_id: "DEV-R001",
    failure_class: DEV_FAILURE.REVIEW_REJECTION,
    trajectory: "blocked-but-recoverable",
    root_issue: "dispatch must be durable",
    repair_directive: "Queue one durable repair.",
    evidence_refs: ["roadmap:DEV-R001"],
    human_decision_required: false,
    human_decision_reason: "",
    worst_plausible_failure: "false success without runnable work",
    confidence: "high"
  });
  const result = await applyValidatedSupervisorAction({ config, snapshot, analysis });
  assert.equal(result.applied, true);
  assert.ok(result.dispatchKey);
  const state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R001"].supervisorDispatch.key, result.dispatchKey);
  assert.equal(state.tasks["DEV-R001"].supervisorDispatch.state, "queued");
  const next = await nextAutonomousRoadmapTask(config);
  assert.equal(next.task.id, "DEV-R001");
});

test("recovery-budget exhaustion suppresses unchanged blocked state instead of polling Codex forever", async () => {
  const config = { ...(await tempConfig()), codexCommand: "/bin/false", devReviewModel: "gpt-5.6-sol", devReviewExtendedTimeoutMs: 1000 };
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "same unchanged blocker",
    supervisorRecoveryCount: 2,
    supervisorRecoveryEngineRevision: DEV_ENGINE_REVISION,
    supervisorRecoveryFingerprints: ["one", "two"]
  });
  const first = await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd() });
  assert.equal(first.result.applied, false);
  assert.equal(first.result.reason, "supervisor-recovery-budget-exhausted");
  const suppressed = await buildDevelopmentSupervisorSnapshot(config);
  assert.equal(suppressed.overall, "BLOCKED_INTERNAL");
  assert.equal(suppressed.nextAutomaticAction, "NONE");
  const second = await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd() });
  assert.equal(second.skippedAnalysis, true);
  assert.equal(second.result.reason, "unchanged-blocked-state-suppressed");
});

test("completed supervisor progress reports the applied action and exhaustion reason", async () => {
  const config = { ...(await tempConfig()), codexCommand: "/bin/false", devReviewModel: "gpt-5.6-sol", devReviewExtendedTimeoutMs: 1000 };
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "same unchanged blocker",
    supervisorRecoveryCount: 2,
    supervisorRecoveryEngineRevision: DEV_ENGINE_REVISION
  });
  const events = [];
  await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd(), onProgress: (event) => events.push(event) });
  const completed = events.find((event) => event.stage === "overall-analysis" && event.status === "completed");
  assert.ok(completed);
  assert.match(completed.detail, /AUTO_CONTINUE/);
  assert.match(completed.detail, /supervisor-recovery-budget-exhausted/);
  assert.doesNotMatch(completed.detail, /^AUTO_REPAIR/);
});

test("concurrent supervisor-state writes serialize without losing action history", async () => {
  const config = await tempConfig();
  const { recordSupervisorAnalysis } = await import("../src/dev/supervisor-state.mjs");
  await Promise.all(Array.from({ length: 20 }, (_, index) => recordSupervisorAnalysis(config, {
    analysis: {
      action: "AUTO_CONTINUE",
      target_task_id: "",
      trajectory: `entry-${index}`,
      failure_class: "",
      root_issue: "",
      repair_directive: "",
      evidence_refs: [],
      human_decision_required: false,
      human_decision_reason: "",
      worst_plausible_failure: "",
      confidence: "high"
    },
    actionResult: { action: "AUTO_CONTINUE", applied: false }
  })));
  const state = await readDevelopmentSupervisorState(config);
  assert.equal(state.actionHistory.length, 20);
  assert.equal(new Set(state.actionHistory.map((entry) => entry.analysis.trajectory)).size, 20);
});


test("startup reconciliation reconstructs a missing durable dispatch without incrementing recovery count", async () => {
  const config = await tempConfig();
  const { recordSupervisorAnalysis } = await import("../src/dev/supervisor-state.mjs");
  await markRoadmapTask(config, "DEV-R001", {
    status: "blocked",
    failureClass: DEV_FAILURE.REVIEW_REJECTION,
    blocker: "dispatch disappeared",
    supervisorRecoveryCount: 1,
    supervisorRecoveryEngineRevision: DEV_ENGINE_REVISION,
    supervisorRecoveryFingerprints: ["repair-fp"],
    supervisorDirective: {
      fingerprint: "repair-fp",
      repairDirective: "Resume exact repair."
    }
  });
  await recordSupervisorAnalysis(config, {
    analysis: {
      action: "AUTO_REPAIR",
      target_task_id: "DEV-R001",
      trajectory: "blocked-but-recoverable",
      failure_class: DEV_FAILURE.REVIEW_REJECTION,
      root_issue: "dispatch disappeared",
      repair_directive: "Resume exact repair.",
      evidence_refs: ["roadmap:DEV-R001"],
      human_decision_required: false,
      human_decision_reason: "",
      worst_plausible_failure: "idle repair",
      confidence: "high"
    },
    actionResult: {
      action: "AUTO_REPAIR",
      taskId: "DEV-R001",
      applied: true,
      fingerprint: "repair-fp",
      dispatchKey: "stable-dispatch-key"
    }
  });
  const result = await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd() });
  assert.equal(result.snapshot.pendingTasks[0].id, "DEV-R001");
  const state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R001"].status, "supervisor-repair");
  assert.equal(state.tasks["DEV-R001"].supervisorDispatch.key, "stable-dispatch-key");
  assert.equal(state.tasks["DEV-R001"].supervisorDispatch.state, "queued");
  assert.equal(state.tasks["DEV-R001"].supervisorRecoveryCount, 1);
});

test("overall supervisor foregrounds guide packet processing and owner decisions", async () => {
  const config = await tempConfig();
  config.guidePacketRoot = path.join(config.autopilotStateDir, "guide-packets");
  await fs.mkdir(config.guidePacketRoot, { recursive: true });
  await fs.writeFile(path.join(config.guidePacketRoot, "processing-status.json"), JSON.stringify({
    active: true,
    overall: "REVIEWING",
    stage: "codex-independent-audit",
    packetId: "candidate-r01",
    model: "gpt-5.6-sol",
    blocker: "",
    nextAutomaticAction: "AUTO_CONTINUE",
    humanActionRequired: false,
    updatedAt: "2026-08-11T20:00:00.000Z"
  }));
  const reviewing = await buildDevelopmentSupervisorSnapshot(config, { now: "2026-08-11T20:05:00.000Z" });
  assert.equal(reviewing.overall, "REVIEWING");
  assert.equal(reviewing.current.taskId, "GUIDE_PACKET");
  assert.equal(reviewing.current.model, "gpt-5.6-sol");
  assert.equal(reviewing.nextAutomaticAction, "AUTO_CONTINUE");

  await fs.writeFile(path.join(config.guidePacketRoot, "processing-status.json"), JSON.stringify({
    active: false,
    overall: "WAITING_FOR_HUMAN",
    stage: "owner-decision",
    packetId: "candidate-r01",
    model: "none-deterministic",
    blocker: "Substantive guide decisions require owner approval.",
    nextAutomaticAction: "ASK_HUMAN",
    humanActionRequired: true,
    updatedAt: "2026-08-11T20:06:00.000Z"
  }));
  const waiting = await buildDevelopmentSupervisorSnapshot(config, { now: "2026-08-11T20:07:00.000Z" });
  assert.equal(waiting.overall, "WAITING_FOR_HUMAN");
  assert.equal(waiting.humanActionRequired, true);
  assert.equal(waiting.current.taskId, "GUIDE_PACKET");
  assert.equal(waiting.blocker, "Substantive guide decisions require owner approval.");
});

test("Guide Packet fingerprint ignores heartbeats but changes for stage and owner-decision state", async () => {
  const config = await tempConfig();
  config.guidePacketRoot = path.join(config.autopilotStateDir, "guide-packets");
  const candidateRoot = path.join(config.guidePacketRoot, "candidates", "candidate-r01");
  await fs.mkdir(candidateRoot, { recursive: true });
  await fs.writeFile(path.join(config.guidePacketRoot, "active-candidate.json"), JSON.stringify({ packetId: "candidate-r01" }));
  await fs.writeFile(path.join(candidateRoot, "state.json"), JSON.stringify({
    packetId: "candidate-r01",
    status: "compilation-complete",
    compilation: { status: "compiled" },
    decisionCards: [{ id: "D1", status: "pending" }]
  }));
  const processFile = path.join(config.guidePacketRoot, "processing-status.json");
  await fs.writeFile(processFile, JSON.stringify({
    active: true,
    lifecycle: "running",
    overall: "WORKING",
    stageId: "opus-source-role-compilation",
    packetId: "candidate-r01",
    attemptId: "attempt-1",
    model: "claude-opus-5",
    heartbeatAt: "2026-08-11T20:00:00.000Z",
    updatedAt: "2026-08-11T20:00:00.000Z",
    humanActionRequired: false
  }));
  const first = await buildDevelopmentSupervisorSnapshot(config);

  await fs.writeFile(processFile, JSON.stringify({
    active: true,
    lifecycle: "running",
    overall: "WORKING",
    stageId: "opus-source-role-compilation",
    packetId: "candidate-r01",
    attemptId: "attempt-1",
    model: "claude-opus-5",
    heartbeatAt: "2026-08-11T20:00:20.000Z",
    updatedAt: "2026-08-11T20:00:20.000Z",
    humanActionRequired: false
  }));
  const heartbeatOnly = await buildDevelopmentSupervisorSnapshot(config);
  assert.equal(heartbeatOnly.stateFingerprint, first.stateFingerprint);

  await fs.writeFile(processFile, JSON.stringify({
    active: true,
    lifecycle: "running",
    overall: "REVIEWING",
    stageId: "codex-independent-audit",
    packetId: "candidate-r01",
    attemptId: "attempt-2",
    model: "gpt-5.6-sol",
    heartbeatAt: "2026-08-11T20:00:21.000Z",
    updatedAt: "2026-08-11T20:00:21.000Z",
    humanActionRequired: false
  }));
  const nextStage = await buildDevelopmentSupervisorSnapshot(config);
  assert.notEqual(nextStage.stateFingerprint, first.stateFingerprint);

  const candidate = JSON.parse(await fs.readFile(path.join(candidateRoot, "state.json"), "utf8"));
  candidate.decisionCards[0].status = "keep-current";
  await fs.writeFile(path.join(candidateRoot, "state.json"), JSON.stringify(candidate));
  const decisionChanged = await buildDevelopmentSupervisorSnapshot(config);
  assert.notEqual(decisionChanged.stateFingerprint, nextStage.stateFingerprint);
});

test("unchanged Guide Packet owner state reuses analysis without rewriting supervisor history", async () => {
  const config = await tempConfig();
  config.guidePacketRoot = path.join(config.autopilotStateDir, "guide-packets");
  await fs.mkdir(config.guidePacketRoot, { recursive: true });
  const processFile = path.join(config.guidePacketRoot, "processing-status.json");
  await fs.writeFile(processFile, JSON.stringify({
    active: false,
    lifecycle: "waiting_for_owner",
    overall: "WAITING_FOR_HUMAN",
    stageId: "owner-decision",
    packetId: "candidate-r01",
    model: "none-deterministic",
    blocker: "Owner decision required.",
    failureClass: "OWNER_DECISION_REQUIRED",
    nextAutomaticAction: "ASK_HUMAN",
    humanActionRequired: true
  }));

  const first = await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd() });
  assert.equal(first.result.action, "ASK_HUMAN");
  const stateFile = path.join(config.autopilotStateDir, "development-supervisor.json");
  const afterFirst = await fs.readFile(stateFile, "utf8");
  const second = await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd() });
  const afterSecond = await fs.readFile(stateFile, "utf8");
  assert.equal(second.skippedAnalysis, true);
  assert.equal(second.result.reason, "unchanged-deterministic-state");
  assert.equal(afterSecond, afterFirst);
  assert.equal((await readDevelopmentSupervisorState(config)).actionHistory.length, 1);

  await fs.writeFile(processFile, JSON.stringify({
    active: false,
    lifecycle: "completed",
    overall: "COMPLETE",
    stageId: "owner-approved",
    packetId: "candidate-r01",
    model: "none-deterministic",
    blocker: "",
    nextAutomaticAction: "INSTALL_READY",
    humanActionRequired: false
  }));
  const changed = await runDevelopmentSupervisorCycle({ config, sourceRoot: process.cwd() });
  assert.equal(changed.skippedAnalysis, undefined);
  assert.equal((await readDevelopmentSupervisorState(config)).actionHistory.length, 2);
});
