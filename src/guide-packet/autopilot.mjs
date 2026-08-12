import fs from "node:fs/promises";
import path from "node:path";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { reviewGuidePacketCandidate } from "./model-review.mjs";
import { compileGuidePacketCandidate } from "./model-compiler.mjs";
import {
  reconcileGuidePacketProcessingState,
  runGuidePacketStage
} from "./stage-lifecycle.mjs";
import { assertGuidePacketEntitlementEvidence } from "./model-policy.mjs";
import { resolveCliModels, resolveAnthropicEscalation } from "../autopilot/model-resolver.mjs";
import { writeJson } from "../autopilot/status.mjs";
import {
  applyGuidePacketCompilation,
  applyGuidePacketReview,
  applyGuidePacketReviewProgress,
  carryForwardGuidePacketDecisions,
  readGuidePacketStatus,
  stageGuidePacket,
  updateGuidePacketProcessingStatus
} from "./store.mjs";
import { readZipEntries } from "../core/zip.mjs";

export const DEFAULT_BUNDLED_GUIDE_PACKET = path.resolve(
  "guide-packets/fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip"
);

function guidePacketRoot(config) {
  return config.guidePacketRoot ?? path.join(config.autopilotStateDir, "guide-packets");
}

async function activeCandidatePacket(config, candidate) {
  return fs.readFile(path.join(guidePacketRoot(config), "candidates", candidate.packetId, "original.zip"));
}

function packetManifest(buffer) {
  const data = readZipEntries(buffer).get("manifest.json");
  if (!data) throw new Error("Bundled Guide Packet fixture is missing manifest.json.");
  return JSON.parse(data.toString("utf8"));
}

async function publishCandidateState(config, candidate, {
  stageId = "candidate-staged",
  model = "none-deterministic",
  expectedNextStage = null
} = {}) {
  const waiting = candidate.status === "awaiting-owner";
  await updateGuidePacketProcessingStatus(config, {
    active: false,
    lifecycle: waiting ? "waiting_for_owner" : "completed",
    overall: waiting ? "WAITING_FOR_HUMAN" : expectedNextStage ? "WORKING" : "COMPLETE",
    stageId,
    packetId: candidate.packetId,
    model,
    blocker: waiting ? "Substantive guide decisions require owner approval." : "",
    failureClass: waiting ? "OWNER_DECISION_REQUIRED" : null,
    recoveryAction: "",
    expectedNextStage: waiting ? "owner-decision" : expectedNextStage,
    nextExpectedGate: waiting ? "owner-decision" : expectedNextStage,
    nextAutomaticAction: waiting ? "ASK_HUMAN" : expectedNextStage ? "AUTO_CONTINUE" : "NONE",
    humanActionRequired: waiting
  });
}

export async function ensureBundledGuidePacketCandidate({
  config,
  fixturePath = DEFAULT_BUNDLED_GUIDE_PACKET,
  compiler = null,
  reviewer = null,
  escalationReviewer = null,
  escalationReviewerFactory = null,
  onProgress
}) {
  const reconciliation = await reconcileGuidePacketProcessingState(config);
  if (reconciliation.reason === "stage-still-live") {
    return { skipped: true, reason: "guide-packet-stage-still-live", process: reconciliation.status };
  }

  const prior = await readGuidePacketStatus(config);
  let staged = prior.candidate;
  let packetBuffer;
  let resumed = false;
  let bundledBuffer = null;
  let bundledManifest = null;
  try {
    bundledBuffer = await fs.readFile(fixturePath);
    bundledManifest = packetManifest(bundledBuffer);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (staged) {
    const bundledIsNewer = bundledManifest
      && Number(bundledManifest.packetRevision ?? 0) > Number(staged.packetRevision ?? 0);
    if (bundledIsNewer) {
      const superseded = staged;
      packetBuffer = bundledBuffer;
      onProgress?.({ stage: "guide-packet-candidate-verification", status: "started", detail: path.basename(fixturePath) });
      staged = await runGuidePacketStage({
        config,
        packetId: bundledManifest.packetId,
        stageId: "deterministic-verification",
        model: "none-deterministic",
        expectedNextStage: compiler ? "opus-source-role-compilation" : reviewer ? "codex-independent-audit" : null,
        operation: async () => await stageGuidePacket(config, packetBuffer, { updateProcessingStatus: false })
      });
      staged = await carryForwardGuidePacketDecisions(config, {
        fromCandidateId: superseded.packetId,
        toCandidateId: staged.packetId
      });
      onProgress?.({ stage: "guide-packet-candidate-verification", status: "completed", detail: `${staged.packetId}; preserved ${superseded.packetId}` });
    } else {
      packetBuffer = await activeCandidatePacket(config, staged);
      resumed = true;
    }
  } else {
    if (bundledManifest && prior.installed?.packetRevision >= bundledManifest.packetRevision) {
      return { skipped: true, reason: "packet-already-installed", installed: prior.installed };
    }
    if (!bundledBuffer) return { skipped: true, reason: "bundled-candidate-missing" };
    packetBuffer = bundledBuffer;

    onProgress?.({ stage: "guide-packet-candidate-verification", status: "started", detail: path.basename(fixturePath) });
    staged = await runGuidePacketStage({
      config,
      packetId: "bundled-candidate",
      stageId: "deterministic-verification",
      model: "none-deterministic",
      expectedNextStage: compiler ? "opus-source-role-compilation" : reviewer ? "codex-independent-audit" : null,
      operation: async () => await stageGuidePacket(config, packetBuffer, { updateProcessingStatus: false })
    });
    onProgress?.({ stage: "guide-packet-candidate-verification", status: "completed", detail: staged.packetId });
  }

  const priorCompilation = staged.compilation ?? null;
  if (priorCompilation?.status === "blocked") {
    return { skipped: true, reason: "candidate-compilation-blocked", candidate: staged, compilation: priorCompilation };
  }
  const priorReview = staged.independentReview ?? null;
  if (priorReview?.status === "rejected" && priorCompilation) {
    return { skipped: true, reason: "candidate-review-rejected", candidate: staged, compilation: priorCompilation, review: priorReview };
  }

  let compilation = priorCompilation;
  let compilationRan = false;
  if (compiler && !compilation) {
    const installedBundle = await loadCompiledGuideGraphBundle({ root: path.resolve("."), packetRoot: config.guidePacketRoot });
    compilation = await runGuidePacketStage({
      config,
      packetId: staged.packetId,
      stageId: "opus-source-role-compilation",
      model: compiler.model,
      expectedNextStage: reviewer ? "codex-independent-audit" : null,
      operation: async () => {
        if (config.mode === "cli") assertGuidePacketEntitlementEvidence(compiler, "compiler");
        return await compileGuidePacketCandidate({
          packetBuffer,
          compiler,
          installedRevision: prior.installed?.packetRevision ?? 0,
          installedBundle,
          onProgress
        });
      },
      persistResult: async (result) => {
        staged = await applyGuidePacketCompilation(config, staged.packetId, result, { updateProcessingStatus: false });
      }
    });
    compilationRan = true;
    if (compilation.status === "blocked") {
      await applyGuidePacketCompilation(config, staged.packetId, compilation);
      throw new Error(`Opus Guide Packet compilation blocked: ${compilation.report.summary}`);
    }
  }

  if (!reviewer) {
    await publishCandidateState(config, staged, {
      stageId: compilation ? "opus-compilation-complete" : "candidate-staged",
      model: compilation?.compiler?.model ?? "none-deterministic"
    });
    if (resumed && !compilationRan) return { skipped: true, reason: "candidate-already-staged", candidate: staged, compilation };
    return { staged: true, resumed, compiled: Boolean(compilation), reviewed: false, candidate: staged, compilation };
  }

  const reviewComplete = priorReview?.status === "reviewed" && !compilationRan;
  if (reviewComplete) {
    const candidate = await applyGuidePacketReview(config, staged.packetId, priorReview);
    return { skipped: true, reason: "candidate-already-staged", candidate, compilation, review: priorReview };
  }

  const installedBundle = await loadCompiledGuideGraphBundle({ root: path.resolve("."), packetRoot: config.guidePacketRoot });
  let candidate = staged;
  const review = await reviewGuidePacketCandidate({
    packetBuffer,
    reviewer,
    escalationReviewer,
    escalationReviewerFactory,
    installedRevision: prior.installed?.packetRevision ?? 0,
    installedBundle,
    compilationReport: compilation?.report ?? null,
    priorReviewProgress: staged.reviewProgress ?? null,
    stageExecutor: async ({ stageId, provider, expectedNextStage, operation, persistResult }) => await runGuidePacketStage({
      config,
      packetId: staged.packetId,
      stageId,
      model: provider.model,
      expectedNextStage,
      operation: async () => {
        if (config.mode === "cli") {
          assertGuidePacketEntitlementEvidence(provider, stageId === "fable-adjudication" ? "adjudicator" : "reviewer");
        }
        return await operation();
      },
      persistResult
    }),
    onStageResult: async (stageId, progress) => {
      candidate = await applyGuidePacketReviewProgress(config, staged.packetId, stageId, progress);
    },
    onProgress
  });
  candidate = await applyGuidePacketReview(config, staged.packetId, review);
  return { staged: true, resumed, compiled: Boolean(compilation), reviewed: true, candidate, compilation, review };
}

function hasExactEvidence(provider, role) {
  try {
    assertGuidePacketEntitlementEvidence(provider, role);
    return true;
  } catch {
    return false;
  }
}

function modelResolutionRecord(resolution) {
  return {
    contractVersion: "inner-signal-model-resolution-v2",
    generatedAt: new Date().toISOString(),
    ok: resolution.ok,
    selected: {
      openai: resolution.openai?.model ?? null,
      anthropic: resolution.anthropic?.model ?? null
    },
    evidence: {
      openai: resolution.openai?.evidence ?? resolution.openai?.provider?.entitlementEvidence ?? null,
      anthropic: resolution.anthropic?.evidence ?? resolution.anthropic?.provider?.entitlementEvidence ?? null
    },
    attempts: resolution.attempts ?? { openai: [], anthropic: [] },
    source: "guide-packet-startup-recovery"
  };
}

async function persistLatestModelResolution(config, resolution) {
  const record = modelResolutionRecord(resolution);
  await writeJson(path.join(config.autopilotStateDir, "model-resolution-latest.json"), record);
  return record;
}

export async function recoverGuidePacketCandidateOnStartup({
  config,
  providers = null,
  onProgress,
  resolveModels = resolveCliModels,
  resolveEscalation = resolveAnthropicEscalation
}) {
  const reconciliation = await reconcileGuidePacketProcessingState(config);
  if (reconciliation.reason === "stage-still-live") {
    return { recovered: false, skipped: true, reason: "guide-packet-stage-still-live" };
  }
  const status = await readGuidePacketStatus(config);
  const candidate = status.candidate;
  if (!candidate) return { recovered: reconciliation.recovered, skipped: true, reason: "no-active-candidate" };
  if (candidate.compilation?.status === "blocked") {
    return { recovered: reconciliation.recovered, skipped: true, reason: "candidate-compilation-blocked", candidate };
  }
  if (candidate.independentReview?.status === "rejected") {
    return { recovered: reconciliation.recovered, skipped: true, reason: "candidate-review-rejected", candidate };
  }
  if (candidate.independentReview?.status === "reviewed") {
    const result = await ensureBundledGuidePacketCandidate({ config, compiler: null, reviewer: null, onProgress });
    return { recovered: reconciliation.recovered, skipped: true, reason: "candidate-already-reviewed", result };
  }
  if (config.mode !== "cli") {
    return { recovered: reconciliation.recovered, skipped: true, reason: "live-recovery-requires-cli-mode", candidate };
  }

  let compiler = providers?.anthropic ?? null;
  let reviewer = providers?.openai ?? null;
  if (!hasExactEvidence(compiler, "compiler") || !hasExactEvidence(reviewer, "reviewer")) {
    const resolution = await runGuidePacketStage({
      config,
      packetId: candidate.packetId,
      stageId: "model-entitlement-resolution",
      model: "gpt-5.6-sol + claude-opus-5",
      expectedNextStage: candidate.compilation ? "codex-independent-audit" : "opus-source-role-compilation",
      operation: async () => {
        const result = await resolveModels(config, { onProgress });
        await persistLatestModelResolution(config, result);
        if (!result.ok) {
          const errors = [...(result.attempts?.openai ?? []), ...(result.attempts?.anthropic ?? [])]
            .map((attempt) => attempt.error)
            .filter(Boolean)
            .join("; ");
          const error = new Error(`Required exact subscription models are unavailable.${errors ? ` ${errors}` : ""}`);
          error.code = "GUIDE_PACKET_MODEL_RESOLUTION_FAILED";
          throw error;
        }
        return result;
      }
    });
    compiler = resolution.anthropic.provider;
    reviewer = resolution.openai.provider;
  }

  let escalationResolution = null;
  const escalationReviewerFactory = async () => {
    if (!escalationResolution) {
      escalationResolution = await resolveEscalation(config, {
        onProgress,
        excludeModels: [compiler.model]
      });
      await writeJson(path.join(config.autopilotStateDir, "anthropic-escalation-resolution-latest.json"), {
        ...escalationResolution,
        generatedAt: new Date().toISOString(),
        source: "guide-packet-startup-recovery"
      });
    }
    return escalationResolution.ok ? escalationResolution.resolved.provider : null;
  };
  const result = await ensureBundledGuidePacketCandidate({
    config,
    compiler,
    reviewer,
    escalationReviewerFactory,
    onProgress
  });
  return {
    recovered: true,
    reconciliation,
    result
  };
}
