import fs from "node:fs/promises";
import path from "node:path";
import { parseModelJson } from "../core/json.mjs";
import { CodexCliProvider } from "../providers/codex-cli.mjs";
import { createCandidateWorkspace, candidateChanges, manifestHash } from "./workspace.mjs";
import { runClaudeCodingAgent } from "./coding-agent.mjs";
import { runRoadmapCandidateReview, runReviewWithRecovery } from "./review.mjs";
import { nextAutonomousRoadmapTask, markRoadmapTask } from "./roadmap-queue.mjs";
import { runDeterministicDevelopmentGates } from "./verification.mjs";
import { runRelevantLiveRegressions } from "./live-regression.mjs";
import { DEV_FAILURE, classifyDevelopmentFailure, normalizeImplementerResult } from "./failure-classification.mjs";
import { loadResumableRoadmapCandidate } from "./resume.mjs";

const auditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["no-action", "implement", "human-decision", "blocked"] },
    findings: { type: "array", items: { type: "string" } },
    suggested_change: { type: "string" },
    proposed_regression: { type: "string" },
    policy_change: { type: "string", enum: ["none", "restorative", "substantive", "uncertain"] },
    human_decision_reason: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["verdict", "findings", "suggested_change", "proposed_regression", "policy_change", "human_decision_reason", "confidence"]
};

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function developmentCaseFor(task) {
  return {
    format: "inner-signal-roadmap-development-case-v1",
    at: new Date().toISOString(),
    origin: "autonomous-roadmap",
    feedback: {
      ledgerId: `roadmap-${task.id}`,
      rating: "needs-work",
      note: task.objective,
      processingTier: "",
      processingMs: null,
      graphBundleVersion: ""
    },
    roadmapTask: task,
    automationState: "autonomous-roadmap"
  };
}

async function roadmapAudit({ config, sourceRoot, task, timeoutMs }) {
  const reviewer = new CodexCliProvider({
    command: config.codexCommand,
    model: config.devReviewModel,
    reasoningEffort: "high",
    timeoutMs,
    cwd: sourceRoot,
    isolateConfig: true
  });
  const system = `You are the read-only Inner Signal autonomous roadmap auditor. Inspect the current repository and decide whether this engineering task is still applicable, already satisfied, blocked by missing source/input, or requires a substantive human product-policy decision. Prefer the narrowest implementation and regression strategy. Never propose weakening therapy, safety, epistemic, consent, or guide-graph contracts. A task may proceed automatically only when it is engineering/restorative rather than a substantive therapy-policy change.`;
  const user = JSON.stringify(task, null, 2);
  const raw = await reviewer.generate({ system, user, outputSchema: auditSchema, metadata: { stage: "roadmap_audit", taskId: task.id } });
  return { ...parseModelJson(raw.text, "roadmap audit"), model: reviewer.model, requestId: raw.requestId };
}

async function writePromotionMarker(config, { jobId, taskId, candidateRoot, reviewer, liveRegression }) {
  const marker = {
    format: "inner-signal-promotion-ready-v1",
    jobId,
    roadmapTaskId: taskId,
    candidateRoot,
    at: new Date().toISOString(),
    reviewer,
    replayReview: null,
    liveRegression: liveRegression ?? null
  };
  await writeJson(config.devPromotionMarker, marker);
  return marker;
}

function humanDecisionPacket(task, audit, review) {
  return {
    reason: review?.human_decision_reason || audit?.human_decision_reason || `Roadmap task ${task.name} requires a substantive product decision.`,
    behavioralEffect: review?.behavioral_effect || audit?.suggested_change || task.objective,
    worstPlausibleFailure: review?.worst_plausible_failure || "A substantive therapy or safety behavior could change beyond a purely engineering repair.",
    recommendedDefault: "Keep the current behavior until you agree with the policy change."
  };
}

function reviewRejects(review) {
  return review?.verdict === "reject" || review?.safety_guard_weakening || review?.test_weakening || !review?.promotion_safe;
}

async function runRoadmapAuditRecovery({ config, sourceRoot, task, onProgress, jobId }) {
  const run = await runReviewWithRecovery({
    normalTimeoutMs: config.devReviewTimeoutMs,
    extendedTimeoutMs: config.devReviewExtendedTimeoutMs,
    onAttempt: ({ attemptNumber, timeoutMs }) => onProgress({ jobId, taskId: task.id, stage: "roadmap-audit", status: attemptNumber === 1 ? "started" : "retrying", detail: `${task.name}; timeout ${timeoutMs}ms` }),
    attempt: (timeoutMs) => roadmapAudit({ config, sourceRoot, task, timeoutMs })
  });
  return run;
}

async function runCandidateReviewRecovery({ config, candidateRoot, task, audit, gates, changeInfo, onProgress, jobId }) {
  return await runReviewWithRecovery({
    normalTimeoutMs: config.devReviewTimeoutMs,
    extendedTimeoutMs: config.devReviewExtendedTimeoutMs,
    onAttempt: ({ attemptNumber, timeoutMs }) => onProgress({ jobId, taskId: task.id, stage: "independent-review", status: attemptNumber === 1 ? "started" : "retrying", detail: `timeout ${timeoutMs}ms` }),
    attempt: (timeoutMs) => runRoadmapCandidateReview({ config, candidateRoot, roadmapTask: task, audit, gates, changes: changeInfo, timeoutMs })
  });
}

export async function processOneAutonomousRoadmapTask({ config, sourceRoot, onProgress = () => {} }) {
  if (!config.devAutomationEnabled || !config.devAutoRepair) return { status: "disabled" };
  if (await exists(config.devPromotionMarker)) return { status: "promotion-pending" };

  const { task, state } = await nextAutonomousRoadmapTask(config);
  if (!task) return { status: "idle" };
  let priorTaskState = state.tasks?.[task.id] ?? null;
  if (priorTaskState?.supervisorDispatch?.state === "queued") {
    const claimedAt = new Date().toISOString();
    await markRoadmapTask(config, task.id, {
      supervisorDispatch: { ...priorTaskState.supervisorDispatch, state: "claimed", claimedAt }
    });
    priorTaskState = {
      ...priorTaskState,
      supervisorDispatch: { ...priorTaskState.supervisorDispatch, state: "claimed", claimedAt }
    };
  }
  const humanAuthorized = priorTaskState?.humanAuthorized === true;
  const jobId = `roadmap-${task.id}`;
  const developmentCase = developmentCaseFor(task);
  const jobDir = path.join(config.devJobRoot, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await writeJson(path.join(jobDir, "development-case.json"), developmentCase);

  let audit = priorTaskState?.audit ?? null;
  if (!audit || priorTaskState?.status === "audit-pending") {
    await markRoadmapTask(config, task.id, { status: "auditing", jobId, startedAt: priorTaskState?.startedAt ?? new Date().toISOString(), name: task.name, infrastructureRetryCount: priorTaskState?.infrastructureRetryCount ?? 0 });
    const auditRun = await runRoadmapAuditRecovery({ config, sourceRoot, task, onProgress, jobId });
    await writeJson(path.join(jobDir, "roadmap-audit-attempts.json"), auditRun);
    if (auditRun.status === "review-pending") {
      await markRoadmapTask(config, task.id, {
        status: "audit-pending",
        jobId,
        failureClass: DEV_FAILURE.REVIEW_TIMEOUT,
        blocker: "Roadmap audit reviewer timed out; candidate implementation has not started.",
        infrastructureRetryCount: (priorTaskState?.infrastructureRetryCount ?? 0) + auditRun.attempts.length,
        reviewAttempts: auditRun.attempts
      });
      return { status: "audit-pending", jobId, taskId: task.id };
    }
    audit = auditRun.result;
    await writeJson(path.join(jobDir, "roadmap-audit.json"), audit);
    onProgress({ jobId, taskId: task.id, stage: "roadmap-audit", status: "completed", detail: audit.verdict });
  }

  if (audit.verdict === "no-action") {
    await markRoadmapTask(config, task.id, { status: "complete", jobId, outcome: "already-satisfied", audit, completedAt: new Date().toISOString() });
    return { status: "complete", jobId, taskId: task.id, outcome: "already-satisfied" };
  }
  if (audit.verdict === "blocked") {
    await markRoadmapTask(config, task.id, { status: "blocked", jobId, blocker: audit.findings.join(" "), audit, failureClass: DEV_FAILURE.MISSING_INPUT });
    return { status: "blocked", jobId, taskId: task.id };
  }
  if (!humanAuthorized && (audit.verdict === "human-decision" || ["substantive", "uncertain"].includes(audit.policy_change))) {
    const packet = humanDecisionPacket(task, audit, null);
    await markRoadmapTask(config, task.id, { status: "awaiting-human", jobId, audit, failureClass: DEV_FAILURE.HUMAN_POLICY_REQUIRED, humanDecisionPacket: packet });
    return { status: "awaiting-human", jobId: `roadmap:${task.id}`, taskId: task.id };
  }

  let implementationCycleCount = Number(priorTaskState?.implementationCycleCount ?? 0);
  let infrastructureRetryCount = Number(priorTaskState?.infrastructureRetryCount ?? 0);
  let priorFailure = priorTaskState?.lastFailure ?? null;
  if (priorTaskState?.supervisorDirective) {
    priorFailure = {
      stage: "supervisor-directed-repair",
      failureClass: priorTaskState.failureClass ?? DEV_FAILURE.IMPLEMENTATION_FAILURE,
      supervisorDirective: priorTaskState.supervisorDirective,
      priorFailure
    };
  }
  let candidate = await loadResumableRoadmapCandidate({ config, sourceRoot, taskId: task.id, priorTaskState });

  while (implementationCycleCount < config.devMaxRepairCycles || candidate) {
    let cycle;
    let model;
    let candidateRoot;
    let changeInfo;
    let gates;
    let review = candidate?.review ?? null;

    if (!candidate) {
      cycle = implementationCycleCount + 1;
      model = cycle === 1 ? config.devRepairModel : config.devEscalationModel;
      candidateRoot = path.join(config.devCandidateRoot, `${jobId}-cycle-${cycle}`);
      await markRoadmapTask(config, task.id, { status: "repairing", jobId, cycle, model, audit, implementationCycleCount, infrastructureRetryCount, supervisorDirective: priorTaskState?.supervisorDirective ?? null });
      onProgress({ jobId, taskId: task.id, stage: `roadmap-repair-${cycle}`, status: "started", detail: model, model });
      const workspace = await createCandidateWorkspace({ sourceRoot, candidateRoot, jobId });
      const codingAudit = {
        verdict: "repair-candidate",
        likely_layer: task.layer || "unknown",
        findings: audit.findings,
        proposed_regression: audit.proposed_regression,
        suggested_change: priorTaskState?.supervisorDirective?.repairDirective || audit.suggested_change || task.objective,
        human_decision_required: false,
        human_decision_reason: "",
        confidence: audit.confidence
      };
      let implementer;
      try {
        implementer = normalizeImplementerResult(await runClaudeCodingAgent({ command: config.claudeCommand, model, candidateRoot, developmentCase, audit: codingAudit, cycle, priorFailure, timeoutMs: 1800000 }));
      } catch (error) {
        const failureClass = classifyDevelopmentFailure(error, { phase: "implementer" });
        if (failureClass === DEV_FAILURE.WORKER_TOOLING_LIMITATION) {
          infrastructureRetryCount += 1;
          await markRoadmapTask(config, task.id, { status: "tooling-pending", jobId, audit, failureClass, blocker: error.message, implementationCycleCount, infrastructureRetryCount });
          return { status: "tooling-pending", jobId, taskId: task.id };
        }
        implementationCycleCount += 1;
        priorFailure = { stage: "implementer", failureClass, message: error.message };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        candidate = null;
        continue;
      }
      await writeJson(path.join(jobDir, `cycle-${cycle}-implementer.json`), implementer);
      if (implementer.status !== "implemented") {
        const failureClass = classifyDevelopmentFailure(implementer, { phase: "implementer" });
        if (failureClass === DEV_FAILURE.WORKER_TOOLING_LIMITATION) {
          infrastructureRetryCount += 1;
          await markRoadmapTask(config, task.id, { status: "tooling-pending", jobId, audit, failureClass, blocker: implementer.blocker, implementationCycleCount, infrastructureRetryCount });
          return { status: "tooling-pending", jobId, taskId: task.id };
        }
        implementationCycleCount += 1;
        priorFailure = { stage: "implementer-blocked", failureClass, implementer };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        candidate = null;
        continue;
      }
      implementationCycleCount = cycle;
      changeInfo = await candidateChanges(candidateRoot, workspace.baseline);
      candidate = {
        phase: "DETERMINISTIC_VERIFY",
        candidateRoot,
        changeInfo,
        cycle,
        model,
        baselineHash: manifestHash(workspace.baseline),
        candidateHash: manifestHash(changeInfo.after)
      };
    } else {
      cycle = candidate.cycle ?? Math.max(1, implementationCycleCount);
      model = priorTaskState?.model ?? (cycle === 1 ? config.devRepairModel : config.devEscalationModel);
      candidateRoot = candidate.candidateRoot;
      changeInfo = candidate.changeInfo ?? await candidateChanges(candidateRoot, {});
      gates = candidate.gates ?? null;
    }

    await markRoadmapTask(config, task.id, {
      status: candidate.phase === "INDEPENDENT_REVIEW" ? "reviewing" : candidate.phase === "LIVE_REGRESSION" ? "live-regression" : "verifying",
      jobId,
      cycle,
      model,
      candidateRoot,
      audit,
      implementationCycleCount,
      infrastructureRetryCount,
      baselineHash: candidate.baselineHash ?? null,
      candidateHash: candidate.candidateHash ?? null,
      phase: candidate.phase
    });

    if (candidate.phase === "DETERMINISTIC_VERIFY") {
      gates = await runDeterministicDevelopmentGates(candidateRoot, { labelPrefix: "roadmap" });
      await writeJson(path.join(jobDir, `cycle-${cycle}-gates.json`), gates);
      if (!gates.ok) {
        priorFailure = { stage: "deterministic-gates", failureClass: DEV_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE, gates, changeInfo };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        candidate = null;
        if (implementationCycleCount >= config.devMaxRepairCycles) break;
        continue;
      }
      candidate = { ...candidate, phase: "INDEPENDENT_REVIEW", gates };
    } else {
      gates = candidate.gates;
    }

    if (candidate.phase === "INDEPENDENT_REVIEW") {
      const reviewRun = await runCandidateReviewRecovery({ config, candidateRoot, task, audit, gates, changeInfo, onProgress, jobId });
      await writeJson(path.join(jobDir, `cycle-${cycle}-review-attempts.json`), reviewRun);
      infrastructureRetryCount += reviewRun.attempts.filter((item) => !item.ok).length;
      if (reviewRun.status === "review-pending") {
        await markRoadmapTask(config, task.id, {
          status: "review-pending",
          jobId,
          audit,
          cycle,
          model,
          candidateRoot,
          gates,
          changes: changeInfo.changes,
          risk: changeInfo.risk,
          implementationCycleCount,
          infrastructureRetryCount,
          failureClass: DEV_FAILURE.REVIEW_TIMEOUT,
          blocker: "Independent reviewer timed out; validated candidate retained for review resume.",
          baselineHash: candidate.baselineHash ?? null,
          candidateHash: candidate.candidateHash ?? null,
          phase: "INDEPENDENT_REVIEW",
          reviewAttempts: reviewRun.attempts
        });
        return { status: "review-pending", jobId, taskId: task.id };
      }
      review = reviewRun.result;
      await writeJson(path.join(jobDir, `cycle-${cycle}-review.json`), review);
      if (reviewRejects(review)) {
        priorFailure = { stage: "independent-review", failureClass: DEV_FAILURE.REVIEW_REJECTION, review, gates, changeInfo };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        candidate = null;
        if (implementationCycleCount >= config.devMaxRepairCycles) break;
        continue;
      }
      if (!humanAuthorized && (review.verdict === "human-decision" || ["substantive", "uncertain"].includes(review.policy_change) || changeInfo.risk.highRiskFiles.length)) {
        const packet = humanDecisionPacket(task, audit, review);
        await markRoadmapTask(config, task.id, { status: "awaiting-human", jobId, audit, review, candidateRoot, changes: changeInfo.changes, risk: changeInfo.risk, humanDecisionPacket: packet, failureClass: DEV_FAILURE.HUMAN_POLICY_REQUIRED });
        return { status: "awaiting-human", jobId: `roadmap:${task.id}`, taskId: task.id };
      }
      candidate = { ...candidate, phase: "LIVE_REGRESSION", gates, review };
    }

    if (candidate.phase === "LIVE_REGRESSION") {
      const liveRegression = await runRelevantLiveRegressions({ config, candidateRoot, task, changes: changeInfo.changes });
      await writeJson(path.join(jobDir, `cycle-${cycle}-live-regression.json`), liveRegression);
      if (!liveRegression.ok) {
        const attempts = Number(priorTaskState?.liveRegressionAttempts ?? 0) + 1;
        const retryDelayMs = attempts >= config.devLiveRegressionAttempts ? 3600000 : 60000;
        await markRoadmapTask(config, task.id, {
          status: "live-regression-pending",
          jobId,
          audit,
          review,
          cycle,
          model,
          candidateRoot,
          gates,
          changes: changeInfo.changes,
          risk: changeInfo.risk,
          implementationCycleCount,
          infrastructureRetryCount,
          liveRegressionAttempts: attempts,
          failureClass: liveRegression.failureClass ?? DEV_FAILURE.LIVE_REGRESSION_FAILURE,
          blocker: liveRegression.timedOut
            ? "Live stochastic regression timed out; deterministic package gates remain green and the candidate is retained for delayed retry."
            : "Live stochastic regression failed; deterministic package gates remain green and the candidate is retained.",
          retryAfter: new Date(Date.now() + retryDelayMs).toISOString(),
          baselineHash: candidate.baselineHash ?? null,
          candidateHash: candidate.candidateHash ?? null,
          phase: "LIVE_REGRESSION"
        });
        return { status: "live-regression-pending", jobId, taskId: task.id };
      }

      const marker = await writePromotionMarker(config, { jobId, taskId: task.id, candidateRoot, reviewer: review, liveRegression });
      await markRoadmapTask(config, task.id, {
        status: "promotion-ready",
        jobId,
        candidateRoot,
        audit,
        review,
        liveRegression,
        changes: changeInfo.changes,
        risk: changeInfo.risk,
        implementationCycleCount,
        infrastructureRetryCount,
        promotionMarker: marker,
        completedAt: new Date().toISOString()
      });
      onProgress({ jobId, taskId: task.id, stage: "promotion", status: "ready", detail: "restorative roadmap repair validated automatically" });
      return { status: "promotion-ready", jobId, taskId: task.id };
    }
  }

  await markRoadmapTask(config, task.id, {
    status: "blocked",
    jobId,
    audit,
    failureClass: priorFailure?.failureClass ?? DEV_FAILURE.IMPLEMENTATION_FAILURE,
    blocker: "Autonomous roadmap implementation budget exhausted by substantive implementation/verification/review failures.",
    lastFailure: priorFailure,
    implementationCycleCount,
    infrastructureRetryCount
  });
  return { status: "blocked", jobId, taskId: task.id, lastFailure: priorFailure };
}
