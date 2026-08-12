import fs from "node:fs/promises";
import path from "node:path";
import { runSubprocess } from "../core/subprocess.mjs";
import { runDevelopmentAudit } from "./audit.mjs";
import { CodexCliProvider } from "../providers/codex-cli.mjs";
import { ClaudeCliProvider } from "../providers/claude-cli.mjs";
import { createCandidateWorkspace, candidateChanges } from "./workspace.mjs";
import { runClaudeCodingAgent } from "./coding-agent.mjs";
import { runCandidateCodeReview, runReplayComparisonReview, runReviewWithRecovery } from "./review.mjs";
import { listPendingDevelopmentCases, writeJobState, readHumanDecision, readDevelopmentJobs } from "./queue.mjs";
import { markRoadmapTask } from "./roadmap-queue.mjs";
import { runDeterministicDevelopmentGates } from "./verification.mjs";
import { DEV_FAILURE, classifyDevelopmentFailure, normalizeImplementerResult } from "./failure-classification.mjs";

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeId(value) {
  return String(value || "job").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "job";
}


async function replayCandidate({ candidateRoot, developmentCase, jobDir, cycle }) {
  const casePath = path.join(jobDir, "development-case.json");
  await writeJson(casePath, developmentCase);
  const run = await runSubprocess({
    command: process.execPath,
    args: ["src/cli/replay-development-case.mjs", casePath],
    cwd: candidateRoot,
    env: process.env,
    timeoutMs: 1800000,
    label: `development exact-case replay cycle ${cycle}`
  });
  if (run.code !== 0) return { ok: false, error: "candidate replay failed", stdoutTail: run.stdout.slice(-6000), stderrTail: run.stderr.slice(-12000) };
  try { return { ok: true, result: JSON.parse(run.stdout.trim()) }; }
  catch { return { ok: false, error: "candidate replay returned invalid JSON", stdoutTail: run.stdout.slice(-8000), stderrTail: run.stderr.slice(-8000) }; }
}

function humanDecisionPacket({ audit, review, replayReview, risk, reason }) {
  const behavior = replayReview?.behavioral_effect || review?.behavioral_effect || audit?.suggested_change || "Adopt the validated candidate behavior instead of the current runtime behavior.";
  const worst = replayReview?.worst_plausible_failure || review?.worst_plausible_failure || (risk?.highRiskFiles?.length
    ? "A therapy-routing or safety-sensitive rule could change more broadly than the reported case if the candidate's scope is misunderstood."
    : "The candidate could repair the reported case while introducing an unobserved behavioral regression elsewhere.");
  return {
    decision: "Promote this validated candidate into the local runtime?",
    reason: reason || "A substantive or uncertain product-policy difference remains after automated review.",
    behavioralEffect: behavior,
    worstPlausibleFailure: worst,
    recommendedDefault: "Keep the current runtime unless you agree with the behavioral change."
  };
}

function promotionRequiresHuman({ audit, review, replayReview, risk }) {
  if (audit?.human_decision_required) return { required: true, reason: audit.human_decision_reason || "Development audit identified a substantive policy choice." };
  if (risk?.highRiskFiles?.length) return { required: true, reason: `Candidate changes high-risk policy/graph files: ${risk.highRiskFiles.join(", ")}` };
  if (["substantive", "uncertain"].includes(review?.policy_change)) return { required: true, reason: review.human_decision_reason || "Independent review found a substantive or uncertain therapy-policy change." };
  if (review?.verdict === "human-decision" || replayReview?.verdict === "human-decision") return { required: true, reason: replayReview?.human_decision_reason || review?.human_decision_reason || "Independent review requires human judgment." };
  return { required: false, reason: "" };
}

async function writePromotionMarker(config, jobId, candidateRoot, reviewer, replayReview, extras = {}) {
  const marker = { format: "inner-signal-promotion-ready-v1", jobId, candidateRoot, at: new Date().toISOString(), reviewer, replayReview, ...extras };
  await writeJson(config.devPromotionMarker, marker);
  return marker;
}

async function processAwaitingHuman(config) {
  const jobs = await readDevelopmentJobs(config);
  for (const job of jobs.filter((item) => item.status === "awaiting-human")) {
    const decision = await readHumanDecision(config, job.jobId);
    if (!decision) continue;
    if (decision.decision === "reject") {
      await writeJobState(config, job.jobId, { status: "rejected", completedAt: new Date().toISOString(), humanDecision: decision });
      if (job.roadmapTaskId) await markRoadmapTask(config, job.roadmapTaskId, { status: "rejected", jobId: job.jobId, humanDecision: decision, completedAt: new Date().toISOString() });
      continue;
    }
    if (!job.candidateRoot || !(await exists(job.candidateRoot))) {
      await writeJobState(config, job.jobId, { status: "blocked", blocker: "Approved candidate workspace no longer exists.", humanDecision: decision });
      continue;
    }
    const marker = await writePromotionMarker(config, job.jobId, job.candidateRoot, job.review ?? null, job.replayReview ?? null, job.roadmapTaskId ? { roadmapTaskId: job.roadmapTaskId } : {});
    await writeJobState(config, job.jobId, { status: "promotion-ready", humanDecision: decision, promotionMarker: marker });
    if (job.roadmapTaskId) await markRoadmapTask(config, job.roadmapTaskId, { status: "promotion-ready", jobId: job.jobId, candidateRoot: job.candidateRoot, humanDecision: decision, promotionMarker: marker });
    return true;
  }
  return false;
}

export async function processOneDevelopmentJob({ config, sourceRoot, onProgress = () => {} }) {
  if (!config.devAutomationEnabled) return { status: "disabled" };
  if (await exists(config.devPromotionMarker)) return { status: "promotion-pending" };
  if (await processAwaitingHuman(config)) return { status: "promotion-ready" };

  const pending = await listPendingDevelopmentCases(config);
  if (!pending.length) return { status: "idle" };
  const item = pending[0];
  const { jobId, sourceFile, developmentCase, existing = null, requeuedFromTerminal = null } = item;
  const jobDir = path.join(config.devJobRoot, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await writeJson(path.join(jobDir, "development-case.json"), developmentCase);

  let audit = existing?.audit ?? null;
  let infrastructureRetryCount = Number(existing?.infrastructureRetryCount ?? 0);
  let implementationCycleCount = Number(existing?.implementationCycleCount ?? 0);

  if (!audit || existing?.status === "audit-pending" || requeuedFromTerminal) {
    await writeJobState(config, jobId, {
      status: "auditing",
      sourceFile,
      feedback: developmentCase.feedback,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      infrastructureRetryCount,
      implementationCycleCount,
      ...(requeuedFromTerminal ? { requeuedAt: new Date().toISOString(), requeuedFromTerminal, blocker: null, completedAt: null } : {})
    });
    const auditRun = await runReviewWithRecovery({
      normalTimeoutMs: config.devReviewTimeoutMs,
      extendedTimeoutMs: config.devReviewExtendedTimeoutMs,
      onAttempt: ({ attemptNumber, timeoutMs }) => onProgress({ jobId, stage: "audit", status: attemptNumber === 1 ? "started" : "retrying", detail: `timeout ${timeoutMs}ms` }),
      attempt: async (timeoutMs) => {
        const auditor = new CodexCliProvider({ command: config.codexCommand, model: config.devReviewModel, reasoningEffort: "high", timeoutMs, cwd: sourceRoot, isolateConfig: true });
        return (await runDevelopmentAudit({ config, provider: auditor, developmentCase })).result;
      }
    });
    infrastructureRetryCount += auditRun.attempts.filter((entry) => !entry.ok).length;
    if (auditRun.status === "review-pending") {
      await writeJobState(config, jobId, { status: "audit-pending", sourceFile, feedback: developmentCase.feedback, failureClass: DEV_FAILURE.REVIEW_TIMEOUT, blocker: "Development audit reviewer timed out; no implementation cycle was consumed.", infrastructureRetryCount, implementationCycleCount, reviewAttempts: auditRun.attempts });
      return { status: "audit-pending", jobId };
    }
    audit = auditRun.result;
    await writeJson(path.join(jobDir, "audit.json"), audit);
    onProgress({ jobId, stage: "audit", status: "completed", detail: audit.verdict });
  }

  if (audit.verdict === "investigate" || audit.confidence === "low") {
    onProgress({ jobId, stage: "audit-escalation", status: "started", detail: config.devEscalationModel });
    try {
      const escalationProvider = new ClaudeCliProvider({ command: config.claudeCommand, model: config.devEscalationModel, effort: "high", timeoutMs: config.requestTimeoutMs, cwd: sourceRoot, isolateConfig: true });
      const escalated = (await runDevelopmentAudit({ config, provider: escalationProvider, developmentCase })).result;
      await writeJson(path.join(jobDir, "audit-escalated.json"), escalated);
      if (escalated.verdict !== "investigate" || escalated.confidence === "high") audit = escalated;
      onProgress({ jobId, stage: "audit-escalation", status: "completed", detail: audit.verdict });
    } catch (error) {
      await writeJson(path.join(jobDir, "audit-escalation-error.json"), { message: error.message, at: new Date().toISOString() });
    }
  }

  if (audit.verdict === "investigate") {
    await writeJobState(config, jobId, { status: "complete", outcome: "investigated-no-safe-repair", audit, completedAt: new Date().toISOString(), infrastructureRetryCount, implementationCycleCount });
    return { status: "complete", jobId, outcome: "investigated-no-safe-repair" };
  }
  if (audit.verdict === "no-action") {
    await writeJobState(config, jobId, { status: "complete", outcome: "no-action", audit, completedAt: new Date().toISOString(), infrastructureRetryCount, implementationCycleCount });
    return { status: "complete", jobId, outcome: "no-action" };
  }
  if (!config.devAutoRepair) {
    await writeJobState(config, jobId, { status: "blocked", phase: "before-repair", audit, blocker: "Autonomous repair is disabled by configuration.", infrastructureRetryCount, implementationCycleCount });
    return { status: "blocked", jobId };
  }

  let priorFailure = existing?.lastFailure ?? null;
  let latest = null;
  let resume = ["review-pending", "live-regression-pending"].includes(existing?.status) && existing?.candidateRoot && await exists(existing.candidateRoot)
    ? { phase: existing.phase || (existing.status === "live-regression-pending" ? "LIVE_REGRESSION" : "INDEPENDENT_REVIEW"), candidateRoot: existing.candidateRoot, cycle: existing.cycle, model: existing.model, changeInfo: { changes: existing.changes ?? [], risk: existing.risk ?? { highRiskFiles: [] } }, gates: existing.gates, review: existing.review ?? null, replay: existing.replay ?? null }
    : null;

  while (implementationCycleCount < config.devMaxRepairCycles || resume) {
    let cycle;
    let model;
    let candidateRoot;
    let changeInfo;
    let gates;
    let review;
    let replay;

    if (!resume) {
      cycle = implementationCycleCount + 1;
      model = cycle === 1 ? config.devRepairModel : config.devEscalationModel;
      candidateRoot = path.join(config.devCandidateRoot, `${safeId(jobId)}-cycle-${cycle}`);
      await writeJobState(config, jobId, { status: "repairing", cycle, model, candidateRoot, audit, implementationCycleCount, infrastructureRetryCount });
      onProgress({ jobId, stage: `repair-${cycle}`, status: "started", detail: model });
      const workspace = await createCandidateWorkspace({ sourceRoot, candidateRoot, jobId });
      let implementer;
      try {
        implementer = normalizeImplementerResult(await runClaudeCodingAgent({ command: config.claudeCommand, model, candidateRoot, developmentCase, audit, cycle, priorFailure, timeoutMs: 1800000 }));
      } catch (error) {
        const failureClass = classifyDevelopmentFailure(error, { phase: "implementer" });
        if (failureClass === DEV_FAILURE.WORKER_TOOLING_LIMITATION) {
          infrastructureRetryCount += 1;
          await writeJobState(config, jobId, { status: "tooling-pending", audit, failureClass, blocker: error.message, infrastructureRetryCount, implementationCycleCount });
          return { status: "tooling-pending", jobId };
        }
        implementationCycleCount += 1;
        priorFailure = { stage: "implementer", failureClass, message: error.message, details: error.details };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        continue;
      }
      await writeJson(path.join(jobDir, `cycle-${cycle}-implementer.json`), implementer);
      if (implementer.status !== "implemented") {
        const failureClass = classifyDevelopmentFailure(implementer, { phase: "implementer" });
        if (failureClass === DEV_FAILURE.WORKER_TOOLING_LIMITATION) {
          infrastructureRetryCount += 1;
          await writeJobState(config, jobId, { status: "tooling-pending", audit, failureClass, blocker: implementer.blocker, infrastructureRetryCount, implementationCycleCount });
          return { status: "tooling-pending", jobId };
        }
        implementationCycleCount += 1;
        priorFailure = { stage: "implementer-blocked", failureClass, implementer };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        continue;
      }
      implementationCycleCount = cycle;
      changeInfo = await candidateChanges(candidateRoot, workspace.baseline);
      gates = await runDeterministicDevelopmentGates(candidateRoot, { labelPrefix: "development" });
      await writeJson(path.join(jobDir, `cycle-${cycle}-gates.json`), gates);
      if (!gates.ok) {
        priorFailure = { stage: "deterministic-gates", failureClass: DEV_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE, gates, changeInfo, implementer };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        continue;
      }
      resume = { phase: "INDEPENDENT_REVIEW", candidateRoot, cycle, model, changeInfo, gates };
    }

    cycle = resume.cycle;
    model = resume.model;
    candidateRoot = resume.candidateRoot;
    changeInfo = resume.changeInfo;
    gates = resume.gates;
    review = resume.review ?? null;
    replay = resume.replay ?? null;

    if (resume.phase === "INDEPENDENT_REVIEW") {
      const reviewRun = await runReviewWithRecovery({
        normalTimeoutMs: config.devReviewTimeoutMs,
        extendedTimeoutMs: config.devReviewExtendedTimeoutMs,
        onAttempt: ({ attemptNumber, timeoutMs }) => onProgress({ jobId, stage: "independent-review", status: attemptNumber === 1 ? "started" : "retrying", detail: `timeout ${timeoutMs}ms` }),
        attempt: (timeoutMs) => runCandidateCodeReview({ config, candidateRoot, developmentCase, audit, gates, changes: changeInfo, timeoutMs })
      });
      infrastructureRetryCount += reviewRun.attempts.filter((entry) => !entry.ok).length;
      if (reviewRun.status === "review-pending") {
        await writeJobState(config, jobId, { status: "review-pending", phase: "INDEPENDENT_REVIEW", candidateRoot, cycle, model, audit, gates, changes: changeInfo.changes, risk: changeInfo.risk, implementationCycleCount, infrastructureRetryCount, failureClass: DEV_FAILURE.REVIEW_TIMEOUT, blocker: "Independent patch review timed out; green candidate retained for review resume.", reviewAttempts: reviewRun.attempts });
        return { status: "review-pending", jobId };
      }
      review = reviewRun.result;
      await writeJson(path.join(jobDir, `cycle-${cycle}-review.json`), review);
      if (review.verdict === "reject" || review.safety_guard_weakening || review.test_weakening || (review.verdict === "approve" && !review.promotion_safe)) {
        priorFailure = { stage: "independent-review", failureClass: DEV_FAILURE.REVIEW_REJECTION, review, changeInfo, gates };
        await writeJson(path.join(jobDir, `cycle-${cycle}-failure.json`), priorFailure);
        resume = null;
        continue;
      }
      resume = { ...resume, phase: "LIVE_REGRESSION", review };
    }

    if (resume.phase === "LIVE_REGRESSION") {
      review = resume.review;
      replay = await replayCandidate({ candidateRoot, developmentCase, jobDir, cycle });
      await writeJson(path.join(jobDir, `cycle-${cycle}-replay.json`), replay);
      if (!replay.ok) {
        await writeJobState(config, jobId, { status: "live-regression-pending", phase: "LIVE_REGRESSION", candidateRoot, cycle, model, audit, review, gates, changes: changeInfo.changes, risk: changeInfo.risk, replay, implementationCycleCount, infrastructureRetryCount, failureClass: DEV_FAILURE.LIVE_REGRESSION_FAILURE, blocker: "Exact live replay failed; deterministic gates remain green and candidate is retained." });
        return { status: "live-regression-pending", jobId };
      }
      resume = { ...resume, phase: "REPLAY_REVIEW", replay };
    }

    if (resume.phase === "REPLAY_REVIEW") {
      review = resume.review;
      replay = resume.replay;
      const replayReviewRun = await runReviewWithRecovery({
        normalTimeoutMs: config.devReviewTimeoutMs,
        extendedTimeoutMs: config.devReviewExtendedTimeoutMs,
        onAttempt: ({ attemptNumber, timeoutMs }) => onProgress({ jobId, stage: "replay-review", status: attemptNumber === 1 ? "started" : "retrying", detail: `timeout ${timeoutMs}ms` }),
        attempt: (timeoutMs) => runReplayComparisonReview({ config, candidateRoot, developmentCase, audit, candidateResult: replay.result, timeoutMs })
      });
      infrastructureRetryCount += replayReviewRun.attempts.filter((entry) => !entry.ok).length;
      if (replayReviewRun.status === "review-pending") {
        await writeJobState(config, jobId, { status: "review-pending", phase: "REPLAY_REVIEW", candidateRoot, cycle, model, audit, review, gates, replay, changes: changeInfo.changes, risk: changeInfo.risk, implementationCycleCount, infrastructureRetryCount, failureClass: DEV_FAILURE.REVIEW_TIMEOUT, blocker: "Replay reviewer timed out; live replay and green candidate retained.", reviewAttempts: replayReviewRun.attempts });
        return { status: "review-pending", jobId };
      }
      const replayReview = replayReviewRun.result;
      await writeJson(path.join(jobDir, `cycle-${cycle}-replay-review.json`), replayReview);
      latest = { cycle, model, candidateRoot, audit, changeInfo, gates, review, replay, replayReview };
      if (replayReview.verdict === "not-improved" || (replayReview.verdict !== "human-decision" && !replayReview.addresses_feedback) || replayReview.introduces_new_overclaim) {
        priorFailure = { stage: "replay-review", failureClass: DEV_FAILURE.REVIEW_REJECTION, ...latest };
        resume = null;
        continue;
      }

      const human = promotionRequiresHuman({ audit, review, replayReview, risk: changeInfo.risk });
      if (human.required || !config.devAutoPromoteRestorative) {
        const decisionPacket = humanDecisionPacket({ audit, review, replayReview, risk: changeInfo.risk, reason: human.reason || "Automatic promotion is disabled." });
        await writeJobState(config, jobId, { status: "awaiting-human", phase: "promotion", candidateRoot, audit, review, replayReview, changes: changeInfo.changes, risk: changeInfo.risk, humanDecisionReason: decisionPacket.reason, humanDecisionPacket: decisionPacket, implementationCycleCount, infrastructureRetryCount, failureClass: DEV_FAILURE.HUMAN_POLICY_REQUIRED });
        return { status: "awaiting-human", jobId, latest };
      }

      const marker = await writePromotionMarker(config, jobId, candidateRoot, review, replayReview);
      await writeJobState(config, jobId, { status: "promotion-ready", candidateRoot, audit, review, replayReview, changes: changeInfo.changes, risk: changeInfo.risk, promotionMarker: marker, completedAt: new Date().toISOString(), implementationCycleCount, infrastructureRetryCount });
      onProgress({ jobId, stage: "promotion", status: "ready", detail: "restorative repair validated automatically" });
      return { status: "promotion-ready", jobId, latest };
    }
  }

  await writeJobState(config, jobId, { status: "blocked", audit, failureClass: priorFailure?.failureClass ?? DEV_FAILURE.IMPLEMENTATION_FAILURE, blocker: "Autonomous implementation budget exhausted by substantive implementation/verification/review failures.", lastFailure: priorFailure, lastCandidate: latest, implementationCycleCount, infrastructureRetryCount });
  return { status: "blocked", jobId, lastFailure: priorFailure };
}
