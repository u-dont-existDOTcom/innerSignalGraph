import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { responseEvidenceReadback } from "../core/on-off-setting.mjs";
import { buildContext, buildHypnosisContext } from "../orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";
import { runCaseFormulation } from "../case-formulation/run.mjs";
import { runHypnosisCompilerPipeline } from "../orchestrator/run-hypnosis-compiler.mjs";
import { loadCompiledGuideGraphBundle } from "../guide-graph/compiler.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { RuntimeError } from "../core/errors.mjs";
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
import {
  createEmptyCaseState,
  diffCaseStates,
  mergeRuntimeSnapshotIntoCaseState,
  caseStateForClient,
  projectCaseStateForInspection,
  validateCaseState
} from "../case-state/longitudinal-state.mjs";
import { summarizeTrackerWindow } from "../case-state/tracker.mjs";
import { createPrivateTherapyModelRuntime } from "../supervisor/private-therapy-model-runtime.mjs";
import { createPrivateTherapyTurnController } from "../supervisor/private-therapy-turn-controller.mjs";
import { createPrivateSupervisorDraftService } from "../supervisor/private-supervisor-draft.mjs";
import { createRunnerTrialController, isRunnerEventHub, runnerEventLine } from "../runner-trial/trial-controller.mjs";
import { loadRunnerRules } from "../runner-trial/released-rules.mjs";
import { runnerLogFromRecord } from "../runner-trial/run-log.mjs";
import { runnerTurnDetailsFromRecord } from "../runner-trial/turn-details.mjs";
import { runnerArrangement } from "../runner-trial/settings.mjs";
import { RUNNER_TRIAL_CASE_ID_PATTERN, RUNNER_TRIAL_CASE_ID_SETTING } from "../runner-trial/switch.mjs";
import { FEEDBACK_PAGE_URL } from "../feedback/address.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, "../../apps/web");
const STATIC = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/speech-playback.js": ["speech-playback.js", "text/javascript; charset=utf-8"],
  "/supervisor-panel.js": ["supervisor-panel.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"]
});
const SAFE_SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const DIAGNOSTIC_PATH = /^diagnostics\/[0-9a-f-]{36}\/[a-f0-9]{64}\.json$/i;
const PROGRESS_PATH = /^progress\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/current\.json$/i;
const PROGRESS_ASSESSMENT = /^(?:ADVANCING|LONG_RUNNING_STAGE|WAITING_FOR_HUMAN|BLOCKED|COMPLETE|IDLE|WORKER_NOT_RUNNING)$/;
const SAFE_CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const SAFE_HANDOFF_ID = /^handoff:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function readCaseId(value) {
  const caseId = typeof value === "string" && SAFE_CASE_ID.test(value) ? value : null;
  if (!caseId) {
    const error = new Error("caseId must use lowercase letters, digits, underscores, or hyphens.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return caseId;
}

function readHandoffId(value) {
  if (typeof value !== "string" || !SAFE_HANDOFF_ID.test(value)) {
    const error = new Error("handoffId is invalid.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return value;
}

function safeEntryId(value, fallback) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(value) ? value : fallback;
}

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

function sendEncryptedHandoff(res, buffer, handoffId) {
  const filename = `${handoffId.replace(/[^A-Za-z0-9._-]/g, "-")}.handoff.vault.json`;
  res.writeHead(200, securityHeaders({
    "content-type": "application/vnd.inner-signal.private-handoff+json",
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
    if (size > maxBytes) throw new Error(`Request body exceeds ${Math.round(maxBytes / 1_000_000)} MB.`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req, maxBytes = 2_000_000) {
  const body = await readBody(req, maxBytes);
  return JSON.parse(body.toString("utf8"));
}

// --- Controlled supervisor drafts -------------------------------------------------------------------------------------------
// Who is calling decides what a report or an input is worth, so the server decides it from how the request was authenticated and
// never from a field the caller sends. The owner's own app sends no credential of its own, because the server holds the owner's
// authorization; a request that carries its own bearer token is an authenticated agent acting for someone, which does not make
// it the owner.
const SUPERVISOR_PATH = /^\/v1\/case\/supervisor\/(prepare|submit|export|report-sent)$/u;
const RUNNER_PAGE_ROUTES = new Set(["/v1/runner/log", "/v1/runner/turn-details", "/v1/runner/reconcile", "/v1/case/delete", "/v1/runner/kept-plan/delete"]);
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/iu;
const SUPERVISOR_STATUS = Object.freeze({
  SUPERVISOR_ARTIFACT_NOT_FOUND: 404,
  SUPERVISOR_ARTIFACT_STALE: 409,
  SUPERVISOR_ARTIFACT_NOT_APPROVED: 409,
  SUPERVISOR_IDEMPOTENCY_CONFLICT: 409,
  SUPERVISOR_BASIS_CHANGED: 409,
  SUPERVISOR_NO_PENDING_CLIENT_MESSAGE: 409,
  SUPERVISOR_NO_REPORTABLE_DRAFT: 409,
  SUPERVISOR_REVIEW_UNAVAILABLE: 503,
  SUPERVISOR_ORIGIN_REFUSED: 403,
  SUPERVISOR_UNSUPPORTED_MEDIA_TYPE: 415
});

function supervisorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const supervisorChannelFor = (req) => (typeof req.headers.authorization === "string" ? "authenticated_agent" : "owner_ui");

// A request that rides on the server's own authorization must look like the owner's page on this machine. A browser attaches an
// Origin to every POST it makes, same-origin ones included, and sends a Host that names the attacker's page under DNS rebinding, so
// the Host must be a loopback name and the Origin must be present and name that same host over http. A request with no Origin did
// not come from a page, so it is refused too. This is all the owner channel can check: a process on this machine that deliberately
// sends these headers looks the same as the owner's page (see "Who is calling" in docs/PRIVATE-CASE-CONTINUITY.md).
function assertOwnerChannelRequest(req, { pageGet = false } = {}) {
  const refused = () => supervisorError("SUPERVISOR_ORIGIN_REFUSED", "This action is only available from the application on this machine.");
  if (!LOOPBACK_HOST.test(String(req.headers.host ?? ""))) throw refused();
  let origin = null;
  if (typeof req.headers.origin === "string") {
    try { origin = new URL(req.headers.origin); } catch { /* an unreadable Origin is refused below, like an absent one */ }
  }
  // Browsers omit Origin on a same-origin GET and forbid scripts from setting it. For this read-only page route,
  // require both the browser's same-origin fetch marker and a matching Referer when Origin is absent.
  if (!origin && req.headers.origin === undefined && pageGet && req.headers["sec-fetch-site"] === "same-origin" && typeof req.headers.referer === "string") {
    try { origin = new URL(req.headers.referer); } catch { /* refused below */ }
  }
  if (!origin || origin.protocol !== "http:" || origin.host.toLowerCase() !== String(req.headers.host).toLowerCase()) throw refused();
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && !["same-origin", "none"].includes(site)) throw refused();
}

// What an error answers: its status and a body with a safe message. A private failure's message is fixed words, never case content.
function failureResponse(error) {
  const code = error?.code ?? "UNEXPECTED_ERROR";
  const status = SUPERVISOR_STATUS[code]
    ?? (code === "VALIDATION_ERROR" ? 400
      : code === "PRIVATE_CASE_ACCESS_DENIED" ? 403
        : code === "PRIVATE_CASE_NOT_FOUND" ? 404
        : ["THERAPY_RUNTIME_UNAVAILABLE", "PRIVATE_THERAPY_RUNTIME_UNAVAILABLE", "PRIVATE_CASE_KEY_UNAVAILABLE"].includes(code) ? 503
          : 500);
  const privateFailure = /^(?:PRIVATE_|THERAPY_RUNTIME_|PROVIDER_)/u.test(code);
  // The reasons a supervisor draft was refused are fixed words, never case content, so they are safe to return.
  const reasons = Object.hasOwn(SUPERVISOR_STATUS, code) && Array.isArray(error?.details?.reasons)
    && error.details.reasons.every((reason) => typeof reason === "string" && /^[a-z_]{1,60}$/u.test(reason))
    ? { reasons: error.details.reasons }
    : {};
  return {
    status,
    body: {
      error: privateFailure ? "InnerSignal could not safely complete this request." : error?.message,
      code,
      ...reasons
    }
  };
}

// The answer to one private therapy turn, as JSON or as the stream's final line. A turn the runner trial closed without a reply
// also carries its closing: the kind (the notice or the owner's fixed message) and the reason, in fixed words. With the trial on,
// every answer also carries what the stored turn showed before its reply: the provisional reply's exact text (or null) and whether
// the emergency line was put into the conversation, so a page that got no live events (a JSON answer, or a replay of a finished
// turn) shows them as the stream would have. With the kept plan on too, it says whether the turn kept a plan or deleted the kept
// plan ("kept", "deleted" or null), so the page can say so outside the reply: the writer can't know what the program keeps.
function therapyAnswer(result, { runnerTrial = false, keptPlan = false } = {}) {
  const metadata = result.runtimeMetadata ?? {};
  return {
    answer: result.answer,
    mode: metadata.mode ?? "private-runtime",
    processingTier: metadata.processingTier ?? metadata.mode ?? "private-runtime",
    routingReason: metadata.routingReason ?? "automatic exact-version audit lifecycle",
    graphBundleVersion: metadata.graphBundleVersion ?? null,
    caseFormulation: metadata.caseFormulation ?? null,
    interventionContract: metadata.interventionContract ?? null,
    responseContract: metadata.responseContract ?? null,
    processingMs: metadata.processingMs ?? null,
    durableCaseState: caseStateForClient(result.durableCaseState),
    caseState: projectCaseStateForInspection(result.durableCaseState),
    caseStateDiff: result.caseStateDiff,
    privateCaseStorage: "encrypted",
    orchestration: {
      state: result.runtimeTurn.state,
      deliveryKind: result.deliveryKind,
      repairCycle: result.runtimeTurn.repair_cycle,
      lifecycleOwner: "server"
    },
    ...(result.closing ? { closing: { kind: result.closing.kind, reason_code: result.closing.reason_code } } : {}),
    ...(runnerTrial ? {
      provisional: typeof result.runtimeTurn?.provisional?.exact_text === "string" ? result.runtimeTurn.provisional.exact_text : null,
      emergencyLineShown: Boolean(result.runtimeTurn?.emergency_line_shown_at)
    } : {}),
    ...(runnerTrial && keptPlan ? { keptPlan: result.runtimeTurn?.kept_plan_kept_at ? "kept" : result.runtimeTurn?.kept_plan_deleted_at ? "deleted" : null } : {})
  };
}

const acceptsNdjson = (req) => /(?:^|,)\s*application\/x-ndjson\s*(?:[;,]|$)/iu.test(String(req.headers.accept ?? ""));

// The runner trial's page asks for newline-delimited JSON: one line per event of this request's turn as it happens (status,
// provisional, emergency_line, closed), then one final line with the same fields as the JSON answer, or an error line. Nothing
// is logged, and the subscription (to this case's turn, never another case's turn of the same id) ends with the request. The
// request is authorized for its case first, with the check the turn itself makes (`authorize`): a request the turn would refuse
// gets that refusal as its answer (thrown before anything is written) and never listens, so it hears no line of another
// request's turn of the same case and turn id.
async function streamRunnerTurn(res, { events, caseId, runtimeTurnId, authorize, run, keptPlan = false }) {
  await authorize();
  res.writeHead(200, securityHeaders({ "content-type": "application/x-ndjson" }));
  const write = (line) => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`${JSON.stringify(line)}\n`); } catch { /* a page that went away never stops the turn */ }
  };
  const unsubscribe = events.subscribe(caseId, runtimeTurnId, (event) => {
    const line = runnerEventLine(event);
    if (line) write(line);
  });
  try {
    write({ type: "final", ...therapyAnswer(await run(), { runnerTrial: true, keptPlan }) });
  } catch (error) {
    const { body } = failureResponse(error);
    write({ type: "error", error: body.error, code: body.code });
  } finally {
    unsubscribe();
    if (!res.writableEnded) res.end();
  }
}

async function readSupervisorBody(req) {
  if (!/^application\/json(?:\s*;|$)/iu.test(String(req.headers["content-type"] ?? ""))) {
    throw supervisorError("SUPERVISOR_UNSUPPORTED_MEDIA_TYPE", "Supervisor requests must be sent as application/json.");
  }
  let input;
  try { input = await readJson(req); }
  catch { throw Object.assign(new Error("The request body must be valid JSON."), { code: "VALIDATION_ERROR" }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("The request body must be a JSON object."), { code: "VALIDATION_ERROR" });
  return input;
}

export function createInnerSignalServer({ config, providers, privateCaseStore = null, privateCaseAccessService = null, privateAuthContext = null, privateTherapyController = null, privateSupervisorService = null, runnerTrialEvents = null, runnerTrialSettings = null }) {
  const privateCaseSource = privateCaseAccessService ?? privateCaseStore;
  // The runner trial (INNER_SIGNAL_RUNNER_TRIAL): its controller and the hub that carries its events to the page. A caller that
  // brings its own controller (the loopback launcher, which shares one between its listeners, or a test) brings the hub too.
  // With the switch off, everything below is as it was, and a hub passed in is ignored.
  let runnerTrial = null;
  if (config.runnerTrialEnabled === true) {
    if (privateTherapyController) {
      if (!isRunnerEventHub(runnerTrialEvents)) throw new RuntimeError("A runner trial controller needs its event hub.", { code: "BAD_CONFIG" });
      // The stream authorizes a request for its case before it listens for the case's events, with the turn's own check.
      if (typeof privateTherapyController.authorizeTurn !== "function") throw new RuntimeError("A runner trial controller needs its turn authorization.", { code: "BAD_CONFIG" });
      runnerTrial = { controller: privateTherapyController, events: runnerTrialEvents };
    } else {
      runnerTrial = createRunnerTrialController({ privateCaseSource, config });
    }
  }
  const automaticPrivateTherapy = runnerTrial?.controller ?? privateTherapyController ?? (privateCaseSource
    ? createPrivateTherapyTurnController({
        privateCaseSource,
        modelRuntime: createPrivateTherapyModelRuntime({ privateCaseSource, providers, config }),
        responseEvidence: { enforced: config.responseEvidenceEnforced === true },
        maximumInvocationAttempts: config.privateRuntimeInvocationAttempts ?? 2
      })
    : null);
  const runnerEvents = runnerTrial?.events ?? null;
  const runnerRules = runnerTrial ? runnerTrial.runnerRules ?? loadRunnerRules(config).runnerRules : null;
  if (runnerTrial) automaticPrivateTherapy.startRunLog?.(privateAuthContext);
  // With the trial on: what the page's badge shows of its arrangement (from the settings of the trial built here, or those a caller
  // that brings its own controller passes along), and the case its page uses (INNER_SIGNAL_RUNNER_TRIAL_CASE_ID), checked again
  // here so a value given to the server directly can't bypass the form loadConfig requires.
  const trialSettings = runnerTrial ? runnerTrial.settings ?? runnerTrialSettings : null;
  const runnerArrangementView = trialSettings ? runnerArrangement(trialSettings) : null;
  const runnerCaseId = runnerTrial && config.runnerTrialCaseId != null ? config.runnerTrialCaseId : null;
  if (runnerCaseId !== null && (typeof runnerCaseId !== "string" || !RUNNER_TRIAL_CASE_ID_PATTERN.test(runnerCaseId))) {
    throw new RuntimeError(`${RUNNER_TRIAL_CASE_ID_SETTING} must be a case id of the form case-<random UUID>, as scripts/runner-trial-start.mjs makes it.`, { code: "BAD_CONFIG" });
  }
  // The plan kept for next time (INNER_SIGNAL_RUNNER_KEPT_PLAN; design, section 9): on only with the trial on. A controller brought in
  // with it on must offer the page's two kept-plan methods; the trial built here offers them exactly when the switch is on.
  let runnerKeptPlan = false;
  const controllerKeepsPlans = runnerTrial && (typeof runnerTrial.controller.resumeStatus === "function" || typeof runnerTrial.controller.deleteKeptPlan === "function");
  if (runnerTrial && config.runnerKeptPlanEnabled === true) {
    if (typeof runnerTrial.controller.resumeStatus !== "function" || typeof runnerTrial.controller.deleteKeptPlan !== "function") {
      throw new RuntimeError("A runner trial controller with the kept plan on needs its resume status and its kept-plan deletion.", { code: "BAD_CONFIG" });
    }
    runnerKeptPlan = true;
  } else if (controllerKeepsPlans) {
    // The switch has one state: a controller built with the kept plan on can't serve a server whose switch is off.
    throw new RuntimeError("The kept plan is off, but the runner trial controller brought in has it on.", { code: "BAD_CONFIG" });
  }
  // Built on first use, so a server that never serves a supervisor request never builds a second model runtime.
  let supervisorDrafts = privateSupervisorService;
  const supervisorDraftService = () => {
    if (!supervisorDrafts && privateCaseSource) {
      supervisorDrafts = createPrivateSupervisorDraftService({
        privateCaseSource,
        modelRuntime: createPrivateTherapyModelRuntime({ privateCaseSource, providers, config }),
        maximumInvocationAttempts: config.privateRuntimeInvocationAttempts ?? 2
      });
    }
    return supervisorDrafts;
  };
  const requestAuthContext = (req) => ({
    ...(privateAuthContext ?? {}),
    ...(typeof req.headers.authorization === "string" ? { bearerToken: req.headers.authorization.replace(/^Bearer\s+/iu, "") } : {})
  });
  const loadPrivateRecord = (caseId, authContext) => typeof privateCaseSource?.loadPrivateRuntimeCase === "function"
    ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext)
    : privateCaseSource.loadOrCreate(caseId);
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
          privateCaseStorage: { available: Boolean(privateCaseSource), plaintextFallback: false, automaticOrchestration: Boolean(automaticPrivateTherapy) },
          // Whether this runtime writes the fixed fallback message (INNER_SIGNAL_OWNER_FALLBACK). It names the state and never a setting's value,
          // so a deploy can check it before and after the owner turns it on. Reading a saved fallback does not depend on it.
          responseEvidence: responseEvidenceReadback(config.responseEvidenceEnforced === true),
          ownerFallback: config.ownerFallbackEnabled === true ? "on" : "off",
          // Whether therapy turns run through the runner trial. It is on exactly when INNER_SIGNAL_RUNNER_TRIAL is on: with the switch
          // on, a server that can't build the trial doesn't start. The page shows the trial's banner, line and stream from it.
          runnerTrial: runnerEvents ? "on" : "off",
          ...(runnerEvents ? { runnerRules } : {}),
          // Whether the trial keeps a plan for next time (INNER_SIGNAL_RUNNER_KEPT_PLAN): on only with the trial on. The page shows the
          // "Pick up where we left off?" question and the "Delete the kept plan" button from it.
          runnerKeptPlan: runnerKeptPlan ? "on" : "off",
          // Whether the trial gives the emergency number at once for what the crisis section sends there now though the person
          // hasn't said they've acted (INNER_SIGNAL_RUNNER_NUMBER_NOW; design, section 9b): on only with the trial on. The trial built
          // here, or by the loopback launcher, reads it from the same config; the page needs nothing new for it.
          runnerNumberNow: runnerEvents && config.runnerNumberNowEnabled === true ? "on" : "off",
          // Whether a turn the plan's limit, a lapsed sign-in or the time ends, in a conversation about wanting to die or getting safe,
          // closes with the owner's fixed message instead of the notice (INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE; design, section 7):
          // on only with the trial on and INNER_SIGNAL_OWNER_FALLBACK on, since it extends that message. The trial built here, or by
          // the loopback launcher, reads it from the same config; the page shows the closing it gets as before.
          runnerFixedMessageOnFailure: runnerEvents && config.ownerFallbackEnabled === true && config.runnerFixedMessageOnFailureEnabled === true ? "on" : "off",
          // Whether every other failure there (a refusal, any other failed call, an interruption) closes with the owner's fixed message
          // too (INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE; design, section 7): on only when runnerFixedMessageOnFailure is on as
          // well, since it extends that switch. The trial reads it from the same config; the page shows the closing it gets as before.
          runnerFixedMessageOnAnyFailure: runnerEvents && config.ownerFallbackEnabled === true && config.runnerFixedMessageOnFailureEnabled === true && config.runnerFixedMessageOnAnyFailureEnabled === true ? "on" : "off",
          // Whether the trial page shows its "Send feedback about InnerSignal" link (INNER_SIGNAL_RUNNER_FEEDBACK_LINK): on only with
          // the trial on, and then with the page's one address (src/feedback/address.mjs), so the link and the served rules agree.
          runnerFeedbackLink: runnerEvents && config.runnerFeedbackLinkEnabled === true ? "on" : "off",
          ...(runnerEvents && config.runnerFeedbackLinkEnabled === true ? { feedbackPageUrl: FEEDBACK_PAGE_URL } : {}),
          // The trial's arrangement, for the page's badge: the writer's and the checkers' modes and the providers of the readers, the
          // writer and the checkers. Null with the trial off, or when a controller was brought in without its settings.
          runnerArrangement: runnerEvents ? runnerArrangementView : null,
          // The case the trial's page uses, only with the trial on and INNER_SIGNAL_RUNNER_TRIAL_CASE_ID set: a page that holds another
          // case (a fresh browser makes up its own) takes this one before its reconcile.
          ...(runnerEvents && runnerCaseId ? { runnerCaseId } : {}),
          endpoints: ["/v1/plan", "/v1/therapy/respond", "/v1/case/state", "/v1/case/tracker", "/v1/case/journal", "/v1/case/handoff", "/v1/case/handoff/export", "/v1/case/supervisor/prepare", "/v1/case/supervisor/submit", "/v1/case/supervisor/export", "/v1/case/supervisor/report-sent", "/v1/hypnosis/compile", "/v1/debug/export", "/v1/debug/feedback", "/v1/dev/status", "/v1/dev/decision", "/v1/guides/status", "/v1/guides/import", "/v1/guides/decision", "/v1/guides/install", "/v1/guides/rollback", "/v1/guides/export"]
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/plan") {
        const input = await readJson(req);
        const context = await buildContext(input, config, { currentTurnAt: new Date().toISOString() });
        const result = await runCaseFormulation({ context, providers });
        return send(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/v1/therapy/respond") {
        const input = await readJson(req);
        const caseId = readCaseId(input.caseId ?? "local-case");
        const exchangeId = safeEntryId(input.exchangeId, `exchange-${randomUUID()}`);
        const userTurnId = safeEntryId(input.userTurnId, `${exchangeId}-user`);
        const assistantTurnId = safeEntryId(input.assistantTurnId, `${exchangeId}-assistant`);
        if (automaticPrivateTherapy) {
          const runtimeTurnId = safeEntryId(input.runtimeTurnId, `runtime:${exchangeId}`);
          const authContext = requestAuthContext(req);
          const run = () => automaticPrivateTherapy.run({
            caseId,
            runtimeTurnId,
            exchangeId,
            userTurnId,
            assistantTurnId,
            userMessage: input.userMessage,
            // The trial starts a new conversation only on exactly true (the page's "New conversation" button). With the kept plan on, the
            // answer to "Pick up where we left off?" is a Yes only on exactly true too.
            userInput: runnerEvents ? { ...input, newConversation: input.newConversation === true, ...(runnerKeptPlan ? { resumeConfirmed: input.resumeConfirmed === true } : {}) } : input,
            authContext
          });
          if (runnerEvents && acceptsNdjson(req)) {
            const authorize = () => automaticPrivateTherapy.authorizeTurn({ caseId, authContext });
            return await streamRunnerTurn(res, { events: runnerEvents, caseId, runtimeTurnId, authorize, run, keptPlan: runnerKeptPlan });
          }
          return send(res, 200, therapyAnswer(await run(), { runnerTrial: Boolean(runnerEvents), keptPlan: runnerKeptPlan }));
        }
        if (config.mode !== "mock") {
          return send(res, 503, { error: "Encrypted automatic therapy orchestration is not configured.", code: "PRIVATE_THERAPY_RUNTIME_UNAVAILABLE" });
        }
        const stored = privateCaseStore ? await privateCaseStore.loadOrCreate(caseId) : null;
        const previousCaseState = stored?.case_state
          ?? (input.durableCaseState ? validateCaseState(structuredClone(input.durableCaseState)) : createEmptyCaseState({ caseId }));
        const priorTranscriptEntries = stored?.raw_transcript ?? input.recentTranscriptEntries ?? [];
        const trackerEntries = stored?.tracker_entries ?? input.trackerEntries ?? [];
        const context = await buildContext({
          ...input,
          caseId,
          recentTranscriptEntries: priorTranscriptEntries,
          durableCaseState: previousCaseState,
          trackerEntries
        }, config, { currentTurnAt: new Date().toISOString() });
        const result = await runTieredTherapyPipeline({
          context,
          providers,
          config,
          processingMode: input.processingMode ?? config.therapyProcessingMode ?? "auto"
        });
        const timestamp = new Date().toISOString();
        const nextCaseState = mergeRuntimeSnapshotIntoCaseState(previousCaseState, result.caseFormulation, {
          turnId: userTurnId,
          recordedAt: timestamp,
          interventionContract: result.interventionContract
        });
        const caseStateDiff = diffCaseStates(previousCaseState, nextCaseState);
        const episodeId = nextCaseState.current_episode?.id ?? null;
        if (privateCaseStore) {
          await privateCaseStore.commitTurn(caseId, {
            transcript_entries: [
              { id: userTurnId, exchange_id: exchangeId, role: "user", text: input.userMessage, at: timestamp, episode_id: episodeId },
              { id: assistantTurnId, exchange_id: exchangeId, role: "assistant", text: result.answer, at: timestamp, episode_id: episodeId }
            ],
            case_state: nextCaseState,
            state_diff: caseStateDiff
          });
        }
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
        return send(res, 200, {
          ...result,
          durableCaseState: caseStateForClient(nextCaseState),
          caseState: projectCaseStateForInspection(nextCaseState),
          caseStateDiff,
          privateCaseStorage: privateCaseStore ? "encrypted" : "session_only"
        });
      }
      // The runner trial page's own routes (docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections 6, 8 and 9): its
      // reconcile when it loads, "Delete this case" and, with the kept plan on, "Delete the kept plan". Only with the trial on (the
      // last only with the kept plan on too), only from the owner's page on this machine (no agent's bearer token, a loopback Host and
      // a matching Origin), and only as JSON; anything else is refused.
      const runnerPageGet = ["/v1/runner/log", "/v1/runner/turn-details"].includes(url.pathname);
      if ((req.method === "POST" || (req.method === "GET" && runnerPageGet)) && RUNNER_PAGE_ROUTES.has(url.pathname)) {
        if (!runnerEvents || typeof automaticPrivateTherapy?.reconcile !== "function" || typeof automaticPrivateTherapy?.deleteCase !== "function") return send(res, 404, { error: "Not found" });
        if (url.pathname === "/v1/runner/kept-plan/delete" && !runnerKeptPlan) return send(res, 404, { error: "Not found" });
        if (supervisorChannelFor(req) !== "owner_ui") throw supervisorError("SUPERVISOR_ORIGIN_REFUSED", "This action is only available from the application on this machine.");
        assertOwnerChannelRequest(req, { pageGet: req.method === "GET" && runnerPageGet });
        if (runnerPageGet && req.method !== "GET") return send(res, 404, { error: "Not found" });
        const input = req.method === "GET" ? { caseId: url.searchParams.get("caseId") } : await readSupervisorBody(req);
        // A malformed or missing case id on the Details route gets the same fixed not-found as a malformed turn (Codex's review 5).
        const detailsRoute = url.pathname === "/v1/runner/turn-details";
        const unavailable = () => send(res, 404, { error: "Turn details unavailable.", code: "RUNNER_TURN_NOT_FOUND" });
        let caseId;
        try { caseId = readCaseId(input.caseId); } catch (error) { if (detailsRoute && error?.code === "VALIDATION_ERROR") return unavailable(); throw error; }
        const authContext = requestAuthContext(req);
        if (detailsRoute) {
          const value = url.searchParams.get("turn");
          if (url.searchParams.getAll("caseId").length !== 1 || url.searchParams.getAll("turn").length !== 1 || !/^[1-9][0-9]{0,15}$/u.test(value ?? "") || !Number.isSafeInteger(Number(value))) return unavailable();
          let details;
          try {
            details = typeof automaticPrivateTherapy.turnDetails === "function"
              ? await automaticPrivateTherapy.turnDetails({ caseId, turn: Number(value), authContext })
              : runnerTurnDetailsFromRecord(await (typeof privateCaseSource?.loadPrivateRuntimeCase === "function" ? privateCaseSource.loadPrivateRuntimeCase(caseId, authContext) : privateCaseSource?.load(caseId)), Number(value));
          } catch (error) { if (error?.code === "PRIVATE_CASE_NOT_FOUND") return unavailable(); throw error; }
          return details ? send(res, 200, details) : unavailable();
        }
        if (url.pathname === "/v1/runner/log") {
          const log = typeof automaticPrivateTherapy.runLog === "function"
            ? await automaticPrivateTherapy.runLog({ caseId, authContext })
            : runnerLogFromRecord(await loadPrivateRecord(caseId, authContext));
          return send(res, 200, log);
        }
        if (url.pathname === "/v1/runner/reconcile") {
          // A page that shows none of the case's turns (a reload) asks for the current conversation, all of it; a page that still
          // shows its earlier turns asks for those after the last one it shows.
          const currentConversation = input.conversation === "current";
          const afterExchangeId = currentConversation || input.afterExchangeId == null ? null : safeEntryId(input.afterExchangeId, null);
          const turns = await automaticPrivateTherapy.reconcile({ caseId, afterExchangeId, currentConversation, authContext });
          // With the kept plan on, whether to ask "Pick up where we left off?": the case has a conversation and the next message opens
          // a new one. Nothing in it says whether a plan is kept.
          const resume = runnerKeptPlan ? await automaticPrivateTherapy.resumeStatus({ caseId, authContext }) : null;
          return send(res, 200, { caseId, turns, ...(resume ? { resume: { hasConversation: resume.hasConversation === true, nextStartsNewConversation: resume.nextStartsNewConversation === true } } : {}) });
        }
        if (url.pathname === "/v1/runner/kept-plan/delete") {
          // The page's "Delete the kept plan", after the person confirmed its plain words. The answer is the same whether or not a
          // plan was kept: none remains.
          if (input.confirmed !== true) return send(res, 400, { error: "Confirm to delete the kept plan.", code: "VALIDATION_ERROR" });
          await automaticPrivateTherapy.deleteKeptPlan({ caseId, authContext });
          return send(res, 200, { caseId, keptPlanRemains: false });
        }
        if (input.confirmation !== "DELETE") return send(res, 400, { error: "Type DELETE to delete this case.", code: "VALIDATION_ERROR" });
        const deleted = await automaticPrivateTherapy.deleteCase({ caseId, authContext });
        return send(res, 200, {
          caseId,
          deleted: true,
          caseFileRemoved: deleted.case_file_removed === true,
          handoffsRemoved: deleted.handoffs_removed ?? 0,
          journalCorporaRemoved: deleted.journal_corpora_removed ?? 0,
          locatorFilesRemoved: (deleted.locator_files_removed ?? 0) + (deleted.alias_locator_files_removed ?? 0),
          handoffsKept: Array.isArray(deleted.handoffs_kept) ? deleted.handoffs_kept.length : 0
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/case/state") {
        if (!privateCaseSource) return send(res, 503, { error: "Encrypted private case storage is not configured; state remains session-only.", code: "PRIVATE_CASE_STORAGE_UNAVAILABLE" });
        const caseId = readCaseId(url.searchParams.get("caseId"));
        const record = await loadPrivateRecord(caseId, requestAuthContext(req));
        return send(res, 200, {
          caseId,
          durableCaseState: caseStateForClient(record.case_state),
          caseState: projectCaseStateForInspection(record.case_state),
          caseStateDiff: record.last_state_diff,
          trackerWindow: summarizeTrackerWindow(record.tracker_entries),
          transcriptTurnCount: record.raw_transcript.length,
          rawTranscriptIncluded: false,
          hiddenReasoningIncluded: false
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/case/tracker") {
        if (!privateCaseSource) return send(res, 503, { error: "Encrypted private case storage is not configured; tracker entry was not persisted.", code: "PRIVATE_CASE_STORAGE_UNAVAILABLE" });
        const input = await readJson(req);
        const caseId = readCaseId(input.caseId);
        const record = await privateCaseSource.appendTracker(caseId, input.entry, requestAuthContext(req));
        return send(res, 200, { caseId, trackerWindow: summarizeTrackerWindow(record.tracker_entries), persisted: "encrypted" });
      }
      if (req.method === "POST" && url.pathname === "/v1/case/journal") {
        if (!privateCaseSource) return send(res, 503, { error: "Encrypted private case storage is not configured; journal entry was not persisted.", code: "PRIVATE_CASE_STORAGE_UNAVAILABLE" });
        const input = await readJson(req);
        const caseId = readCaseId(input.caseId);
        const record = await privateCaseSource.appendJournal(caseId, input.entry, requestAuthContext(req));
        return send(res, 200, { caseId, journalEntryCount: record.journal_entries.length, persisted: "encrypted" });
      }
      if (req.method === "POST" && url.pathname === "/v1/case/handoff") {
        if (!privateCaseSource) return send(res, 503, { error: "Encrypted private case storage is not configured; a handoff cannot be created.", code: "PRIVATE_CASE_STORAGE_UNAVAILABLE" });
        const input = await readJson(req);
        const caseId = readCaseId(input.caseId);
        const result = await privateCaseSource.createHandoff(caseId, {}, requestAuthContext(req));
        return send(res, 200, result);
      }
      if (req.method === "GET" && url.pathname === "/v1/case/handoff/export") {
        if (!privateCaseSource) return send(res, 503, { error: "Encrypted private case storage is not configured; a handoff cannot be exported.", code: "PRIVATE_CASE_STORAGE_UNAVAILABLE" });
        const caseId = readCaseId(url.searchParams.get("caseId"));
        const handoffId = readHandoffId(url.searchParams.get("handoffId"));
        const payload = typeof privateCaseSource.loadPrivateRuntimeCase === "function"
          ? await privateCaseSource.exportHandoff(handoffId, requestAuthContext(req))
          : await privateCaseSource.exportHandoff(caseId, handoffId);
        return sendEncryptedHandoff(res, payload, handoffId);
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
      const supervisorRoute = req.method === "POST" ? SUPERVISOR_PATH.exec(url.pathname) : null;
      if (supervisorRoute) {
        const drafts = supervisorDraftService();
        if (!drafts) return send(res, 503, { error: "Encrypted private case storage is not configured; supervisor drafts are unavailable.", code: "PRIVATE_CASE_STORAGE_UNAVAILABLE" });
        const channel = supervisorChannelFor(req);
        if (channel === "owner_ui") assertOwnerChannelRequest(req);
        const input = await readSupervisorBody(req);
        const caseId = readCaseId(input.caseId);
        const authContext = requestAuthContext(req);
        switch (supervisorRoute[1]) {
          case "prepare":
            return send(res, 200, await drafts.prepareResponseContext({ caseId, inputs: input.inputs ?? [], authContext, channel }));
          case "submit":
            return send(res, 200, await drafts.submitCandidateForReview({
              caseId,
              source: input.source,
              text: input.text ?? null,
              companion: input.companion ?? null,
              basisSha256: input.basisSha256 ?? null,
              idempotencyKey: input.idempotencyKey ?? null,
              authContext,
              channel
            }));
          case "export":
            return send(res, 200, await drafts.getApprovedResponseArtifact({ caseId, artifactId: input.artifactId, authContext, channel }));
          default:
            return send(res, 200, await drafts.recordReportedDelivery({
              caseId,
              artifactId: input.artifactId ?? null,
              sentAt: input.sentAt ?? null,
              quote: input.quote ?? null,
              sourceRef: input.sourceRef ?? null,
              idempotencyKey: input.idempotencyKey ?? null,
              authContext,
              channel
            }));
        }
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      const { status, body } = failureResponse(error);
      // A stream that already began has said everything it can in its own error line.
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      return send(res, status, body);
    }
  });
}
