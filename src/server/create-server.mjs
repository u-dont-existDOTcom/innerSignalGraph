import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContext, buildHypnosisContext } from "../orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";
import { runCaseFormulation } from "../case-formulation/run.mjs";
import { runHypnosisCompilerPipeline } from "../orchestrator/run-hypnosis-compiler.mjs";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { buildDiagnosticBundle } from "../export/diagnostic-bundle.mjs";
import { recordDevelopmentFeedback } from "../dev/feedback-store.mjs";
import { recordAutomaticDevelopmentIncident } from "../dev/incidents.mjs";
import { readDevelopmentJobs, writeHumanDecision } from "../dev/queue.mjs";
import { readAutonomousRoadmapState, loadAutonomousDevelopmentRoadmap, writeRoadmapHumanDecision } from "../dev/roadmap-queue.mjs";
import { buildDevelopmentSupervisorSnapshot } from "../dev/supervisor-state.mjs";
import {
  stageGuidePacket,
  readGuidePacketStatus,
  recordGuidePacketDecision,
  installApprovedGuidePacket,
  rollbackGuidePacket,
  exportInstalledGuidePacket
} from "../guide-packet/store.mjs";
import { recoverGuidePacketCandidateOnStartup } from "../guide-packet/autopilot.mjs";
import { getLiveLearningStore, LIVE_LEARNING_REVIEW_DISPOSITIONS } from "../learning/live-store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, "../../apps/web");
const STATIC = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/correction-learning.js": ["correction-learning.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"]
});
const SAFE_SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const DIAGNOSTIC_PATH = /^diagnostics\/[0-9a-f-]{36}\/[a-f0-9]{64}\.json$/i;
const PROGRESS_PATH = /^progress\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/current\.json$/i;
const PROGRESS_ASSESSMENT = /^(?:ADVANCING|LONG_RUNNING_STAGE|WAITING_FOR_HUMAN|BLOCKED|COMPLETE|IDLE|WORKER_NOT_RUNNING)$/;
const LIVE_LEARNING_RECEIPT = /^ISL-LOCAL-[A-F0-9]{24}$/;
const LIVE_LEARNING_ENDPOINTS = Object.freeze([
  "/v1/learning/preview",
  "/v1/learning/submit",
  "/v1/learning/revoke",
  "/v1/learning/review/status",
  "/v1/learning/review/records",
  "/v1/learning/review/records/:receipt",
  "/v1/learning/review/records/:receipt/decision"
]);

async function readStatusJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function safeText(value, expression) {
  return typeof value === "string" && expression.test(value) ? value : null;
}

function safeTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : value;
}

function shortCommit(value) {
  const commit = safeText(value, GIT_SHA);
  return commit ? commit.slice(0, 12) : null;
}

async function readGitAutomationStatus(config) {
  const [update, diagnostics, progress] = await Promise.all([
    readStatusJson(path.join(config.autopilotStateDir, "git-update-status.json")),
    readStatusJson(path.join(config.autopilotStateDir, "diagnostic-sync-status.json")),
    readStatusJson(path.join(config.autopilotStateDir, "progress-sync-status.json"))
  ]);
  const branch = safeText(diagnostics?.branch, SAFE_BRANCH);
  const safeBranch = branch && !branch.includes("..") && !branch.includes("//") && !branch.startsWith("/") && !branch.endsWith("/")
    ? branch
    : null;
  const paths = Array.isArray(diagnostics?.paths)
    ? diagnostics.paths.filter((value) => typeof value === "string" && DIAGNOSTIC_PATH.test(value))
    : [];
  const progressBranch = safeText(progress?.branch, SAFE_BRANCH);
  const safeProgressBranch = progressBranch
    && !progressBranch.includes("..")
    && !progressBranch.includes("//")
    && !progressBranch.startsWith("/")
    && !progressBranch.endsWith("/")
    ? progressBranch
    : null;
  return {
    update: {
      status: safeText(update?.status, SAFE_SLUG) ?? "not-checked",
      checkedAt: safeTimestamp(update?.checkedAt),
      stage: safeText(update?.stage, SAFE_SLUG),
      installedCommit: shortCommit(update?.installedCommit),
      availableCommit: shortCommit(update?.availableCommit)
    },
    diagnostics: {
      status: safeText(diagnostics?.status, SAFE_SLUG) ?? "not-synced",
      branch: safeBranch,
      path: paths.at(-1) ?? null,
      pending: Number.isSafeInteger(diagnostics?.pending) && diagnostics.pending >= 0 ? diagnostics.pending : null,
      lastSyncAt: safeTimestamp(diagnostics?.updatedAt)
    },
    progress: {
      status: safeText(progress?.status, SAFE_SLUG) ?? "not-synced",
      branch: safeProgressBranch,
      path: safeText(progress?.path, PROGRESS_PATH),
      lastSyncAt: safeTimestamp(progress?.lastSyncAt),
      assessment: safeText(progress?.assessment, PROGRESS_ASSESSMENT),
      observedAt: safeTimestamp(progress?.observedAt)
    }
  };
}

function securityHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...extra
  };
}

function send(res, status, payload) {
  res.writeHead(status, securityHeaders({ "content-type": "application/json; charset=utf-8" }));
  res.end(`${JSON.stringify(payload)}\n`);
}


function sendZip(res, buffer, filename) {
  res.writeHead(200, securityHeaders({
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${filename}"`,
    "content-length": String(buffer.length)
  }));
  res.end(buffer);
}

async function sendStatic(res, pathname) {
  const entry = STATIC[pathname];
  if (!entry) return false;
  const [filename, contentType] = entry;
  const body = await fs.readFile(path.join(WEB_ROOT, filename));
  res.writeHead(200, securityHeaders({ "content-type": contentType, "content-length": String(body.length) }));
  res.end(body);
  return true;
}

async function readBody(req, maxBytes = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`Request body exceeds ${maxBytes} bytes.`);
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req, maxBytes = 2_000_000) {
  const body = await readBody(req, maxBytes);
  return JSON.parse(body.toString("utf8"));
}

function requestValidation(message) {
  const error = new Error(message);
  error.code = "VALIDATION_ERROR";
  return error;
}

function validateLearningReceipt(receipt) {
  if (!LIVE_LEARNING_RECEIPT.test(receipt)) throw requestValidation("Learning receipt is invalid.");
  return receipt;
}

async function readLearningReviewDecision(req) {
  let input;
  try {
    input = await readJson(req, 4096);
  } catch (error) {
    if (error?.code === "VALIDATION_ERROR") throw error;
    throw requestValidation("Learning review decision body must be valid JSON.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || !("disposition" in input)) {
    throw requestValidation("Learning review decision body must contain only disposition.");
  }
  if (!LIVE_LEARNING_REVIEW_DISPOSITIONS.includes(input.disposition)) throw requestValidation("Learning review disposition is invalid.");
  return input.disposition;
}

async function sendLearningReview(res, operation, { counts = false, notFound = false } = {}) {
  try {
    const value = await operation();
    if (notFound && value === null) return send(res, 404, { error: "Learning receipt was not found.", code: "NOT_FOUND" });
    return send(res, 200, value);
  } catch {
    const unavailable = {
      error: "Local learning review is unavailable.",
      code: "LEARNING_REVIEW_UNAVAILABLE",
      availability: "unavailable",
      reasonCode: "LOCAL_REVIEW_STORE_UNAVAILABLE"
    };
    if (counts) Object.assign(unavailable, {
      totalOpen: null,
      needsReview: null,
      acceptedNotIncorporated: null,
      incorporatedClosed: null,
      runtimeAuthority: "none",
      therapyPolicyAuthority: "none"
    });
    return send(res, 503, unavailable);
  }
}

export function createInnerSignalServer({ config, providers }) {
  const liveLearningStore = getLiveLearningStore(config);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && await sendStatic(res, url.pathname)) return;
      if (req.method === "GET" && url.pathname === "/health") {
        const graphBundle = await loadCompiledGuideGraphBundle({ packetRoot: config.guidePacketRoot });
        let localRepair = null;
        try { localRepair = JSON.parse(await fs.readFile(path.join(config.autopilotStateDir, "local-repair-revision.json"), "utf8")); } catch {}
        return send(res, 200, {
          ok: true,
          mode: config.mode,
          version: RUNTIME_VERSION,
          localRepair: localRepair ? { jobId: localRepair.jobId, promotedAt: localRepair.promotedAt } : null,
          models: { openai: providers.openai.model, anthropic: providers.anthropic.model, renderer: providers.renderer?.model ?? providers.anthropic.model },
          therapy: { adjudicatorProvider: config.adjudicatorProvider, rendererModel: providers.renderer?.model ?? providers.anthropic.model, realizationContractVersion: "response-realization-v5", formulation: "case-formulation-v2", graphBundleVersion: graphBundle.version, routing: "auto-tiered-v3", tiers: ["fast", "reviewed", "deep", "forensic"] },
          hypnosis: {
            writerProvider: config.hypnosisWriterProvider,
            reviewerProvider: config.hypnosisReviewerProvider,
            repairProvider: config.hypnosisRepairProvider,
            finalReviewerProvider: config.hypnosisFinalReviewerProvider
          },
          guides: {
            packetFeature: true,
            installedPacketVersion: (await readGuidePacketStatus(config)).installed?.packetVersion ?? null,
            candidateStatus: (await readGuidePacketStatus(config)).candidate?.status ?? null
          },
          webClient: { available: true, path: "/", diagnosticExport: true },
          endpoints: ["/v1/plan", "/v1/therapy/respond", "/v1/hypnosis/compile", ...LIVE_LEARNING_ENDPOINTS, "/v1/debug/export", "/v1/debug/feedback", "/v1/dev/status", "/v1/dev/decision", "/v1/guides/status", "/v1/guides/import", "/v1/guides/decision", "/v1/guides/install", "/v1/guides/rollback", "/v1/guides/export"]
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/learning/preview") {
        const candidate = await readJson(req, 16 * 1024);
        return send(res, 200, liveLearningStore.createPreview(candidate));
      }
      if (req.method === "POST" && url.pathname === "/v1/learning/submit") {
        const input = await readJson(req, 16 * 1024);
        return send(res, 200, await liveLearningStore.submit(input));
      }
      if (req.method === "POST" && url.pathname === "/v1/learning/revoke") {
        const input = await readJson(req, 16 * 1024);
        return send(res, 200, await liveLearningStore.revoke(input));
      }
      if (req.method === "GET" && url.pathname === "/v1/learning/review/status") {
        return sendLearningReview(res, () => liveLearningStore.status(), { counts: true });
      }
      if (req.method === "GET" && url.pathname === "/v1/learning/review/records") {
        return sendLearningReview(res, () => liveLearningStore.list());
      }
      const reviewDecisionMatch = url.pathname.match(/^\/v1\/learning\/review\/records\/([^/]+)\/decision$/);
      if (req.method === "POST" && reviewDecisionMatch) {
        const receipt = validateLearningReceipt(reviewDecisionMatch[1]);
        const disposition = await readLearningReviewDecision(req);
        return sendLearningReview(res, async () => {
          if (!await liveLearningStore.show(receipt)) return null;
          return liveLearningStore.decide(receipt, disposition);
        }, { notFound: true });
      }
      const reviewDetailMatch = url.pathname.match(/^\/v1\/learning\/review\/records\/([^/]+)$/);
      if (req.method === "GET" && reviewDetailMatch) {
        const receipt = validateLearningReceipt(reviewDetailMatch[1]);
        return sendLearningReview(res, () => liveLearningStore.show(receipt), { notFound: true });
      }
      if (req.method === "POST" && url.pathname === "/v1/plan") {
        const input = await readJson(req);
        const context = await buildContext(input, config);
        const result = await runCaseFormulation({ context, providers });
        return send(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/v1/therapy/respond") {
        const input = await readJson(req);
        const context = await buildContext(input, config);
        const result = await runTieredTherapyPipeline({
          context,
          providers,
          config,
          processingMode: input.processingMode ?? config.therapyProcessingMode ?? "auto"
        });
        if (config.devAutomationEnabled && result.responseContract?.realizationCoveragePassed === false) {
          recordAutomaticDevelopmentIncident(config, {
            origin: "response-contract",
            ledgerId: result.decisionLedgerId,
            note: `Renderer failed selected-node coverage after retry: ${(result.responseContract.missingRealizationNodeIds ?? []).join(", ")}`,
            processingTier: result.processingTier,
            processingMs: result.processingMs,
            graphBundleVersion: result.graphBundleVersion,
            incident: { responseContract: result.responseContract }
          }).catch(() => {});
        }
        if (config.devAutomationEnabled && Number(result.processingMs) > config.devSlowResponseMs) {
          recordAutomaticDevelopmentIncident(config, {
            origin: "performance-threshold",
            ledgerId: result.decisionLedgerId,
            rating: "too-slow",
            note: `Automatic latency threshold exceeded: ${result.processingMs} ms > ${config.devSlowResponseMs} ms.`,
            processingTier: result.processingTier,
            processingMs: result.processingMs,
            graphBundleVersion: result.graphBundleVersion
          }).catch(() => {});
        }
        return send(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/v1/hypnosis/compile") {
        const input = await readJson(req);
        const context = await buildHypnosisContext(input, config);
        const result = await runHypnosisCompilerPipeline({ context, providers, config });
        if (config.devAutomationEnabled && !result.releaseable) {
          recordAutomaticDevelopmentIncident(config, {
            origin: "hypnosis-contract",
            ledgerId: result.decisionLedgerId,
            note: `Hypnosis compiler was not releaseable: ${result.finalReview?.verdict ?? result.status ?? "unknown"}.`,
            graphBundleVersion: result.graphBundleVersion ?? "",
            incident: { deterministicAudit: result.deterministicAudit, finalReview: result.finalReview }
          }).catch(() => {});
        }
        return send(res, result.releaseable ? 200 : 422, result);
      }
      if (req.method === "POST" && url.pathname === "/v1/debug/export") {
        const input = await readJson(req, 20_000_000);
        const { buffer } = await buildDiagnosticBundle({
          config,
          providers,
          browserState: input?.state && typeof input.state === "object" ? input.state : {}
        });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        return sendZip(res, buffer, `inner-signal-diagnostic-${stamp}.zip`);
      }
      if (req.method === "POST" && url.pathname === "/v1/debug/feedback") {
        const input = await readJson(req);
        const result = await recordDevelopmentFeedback(config, input);
        return send(res, 200, { ok: true, feedback: result.record.feedback, developmentCaseQueued: result.record.automationState, autonomousRepair: config.devAutomationEnabled });
      }
      if (req.method === "GET" && url.pathname === "/v1/guides/status") {
        return send(res, 200, await readGuidePacketStatus(config));
      }
      if (req.method === "POST" && url.pathname === "/v1/guides/import") {
        const packet = await readBody(req, 50_000_000);
        if (!packet.length) return send(res, 400, { error: "Guide packet ZIP is required." });
        const candidate = await stageGuidePacket(config, packet);
        if (config.mode === "cli") {
          try {
            await recoverGuidePacketCandidateOnStartup({
              config,
              providers
            });
          } catch (error) {
            if (config.devAutomationEnabled) {
              const status = await readGuidePacketStatus(config);
              const stageId = status.process?.stageId ?? status.process?.stage ?? "guide-packet-processing";
              recordAutomaticDevelopmentIncident(config, {
                origin: stageId.includes("review") || stageId.includes("audit") ? "guide-packet-review" : "guide-packet-compilation",
                note: `Guide Packet ${stageId} could not complete: ${error.message}`,
                incident: {
                  packetId: candidate.packetId,
                  stageId,
                  failureClass: status.process?.failureClass ?? null,
                  code: error.code ?? "GUIDE_PACKET_STAGE_FAILED"
                }
              }).catch(() => {});
            }
          }
        }
        return send(res, 200, await readGuidePacketStatus(config));
      }
      if (req.method === "POST" && url.pathname === "/v1/guides/decision") {
        const input = await readJson(req);
        await recordGuidePacketDecision(config, {
          candidateId: input.candidateId,
          cardId: input.cardId,
          decision: input.decision,
          note: input.note ?? ""
        });
        return send(res, 200, await readGuidePacketStatus(config));
      }
      if (req.method === "POST" && url.pathname === "/v1/guides/install") {
        const input = await readJson(req);
        await installApprovedGuidePacket(config, input.candidateId);
        return send(res, 200, await readGuidePacketStatus(config));
      }
      if (req.method === "POST" && url.pathname === "/v1/guides/rollback") {
        await rollbackGuidePacket(config);
        return send(res, 200, await readGuidePacketStatus(config));
      }
      if (req.method === "GET" && url.pathname === "/v1/guides/export") {
        const packet = await exportInstalledGuidePacket(config);
        const status = await readGuidePacketStatus(config);
        const version = status.installed?.packetVersion ?? "installed";
        return sendZip(res, packet, `inner-signal-guide-packet-${String(version).replace(/[^a-zA-Z0-9._-]/g, "-")}.zip`);
      }
      if (req.method === "GET" && url.pathname === "/v1/dev/status") {
        const jobs = await readDevelopmentJobs(config);
        const latest = jobs[0] ?? null;
        const roadmapState = await readAutonomousRoadmapState(config);
        const roadmap = await loadAutonomousDevelopmentRoadmap();
        const roadmapTasks = roadmap.tasks.map((task) => ({
          id: task.id, name: task.name, automationClass: task.automationClass, autoStart: task.autoStart, priority: task.priority,
          state: roadmapState.tasks?.[task.id] ?? null
        }));
        const activeRoadmap = roadmapTasks.find((task) => ["auditing", "repairing", "reviewing", "verifying", "live-regression", "review-pending", "live-regression-pending", "tooling-pending", "supervisor-repair", "promotion-ready", "awaiting-human"].includes(task.state?.status)) ?? null;
        const nextRoadmap = roadmapTasks
          .filter((task) => task.autoStart && ["engineering", "safety-sensitive-engineering"].includes(task.automationClass) && !["complete", "promotion-ready", "awaiting-human", "running"].includes(task.state?.status ?? ""))
          .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0))[0] ?? null;
        const supervisor = await buildDevelopmentSupervisorSnapshot(config);
        const gitAutomation = await readGitAutomationStatus(config);
        return send(res, 200, {
          enabled: config.devAutomationEnabled,
          autoRepair: config.devAutoRepair,
          autoPromoteRestorative: config.devAutoPromoteRestorative,
          latest,
          jobs: jobs.slice(0, 10),
          roadmap: { active: activeRoadmap, next: nextRoadmap, tasks: roadmapTasks },
          supervisor,
          gitAutomation
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/dev/decision") {
        const input = await readJson(req);
        const rawJobId = String(input.jobId ?? "");
        if (rawJobId.startsWith("roadmap:")) {
          const taskId = rawJobId.slice("roadmap:".length).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!taskId) return send(res, 400, { error: "roadmap task id is required" });
          const decision = await writeRoadmapHumanDecision(config, taskId, input.decision);
          return send(res, 200, { ok: true, decision: { taskId, decision: input.decision }, roadmapState: decision });
        }
        const jobId = rawJobId.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!jobId) return send(res, 400, { error: "jobId is required" });
        const decision = await writeHumanDecision(config, jobId, input.decision);
        return send(res, 200, { ok: true, decision });
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      return send(res, error.code === "VALIDATION_ERROR" ? 400 : 500, {
        error: error.message,
        code: error.code ?? "UNEXPECTED_ERROR",
        details: error.details
      });
    }
  });
}
