import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "./errors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "../..");

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new RuntimeError(`${name} must be true or false.`, { code: "BAD_CONFIG" });
}

function integerEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RuntimeError(`${name} must be an integer from ${min} to ${max}.`, { code: "BAD_CONFIG" });
  }
  return value;
}

function listEnv(name, fallback = []) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function nonBlankEnv(name, fallback) {
  const value = process.env[name];
  return value == null || value.trim() === "" ? fallback : value.trim();
}

export function loadConfig(overrides = {}) {
  const resolvedMode = overrides.mode ?? process.env.INNER_SIGNAL_MODE ?? "mock";
  const config = {
    mode: resolvedMode,

    codexCommand: process.env.CODEX_COMMAND ?? "codex",
    claudeCommand: process.env.CLAUDE_COMMAND ?? "claude",
    openaiModel: nonBlankEnv("OPENAI_MODEL", resolvedMode === "api" ? "gpt-5.6" : "gpt-5.6-sol"),
    anthropicModel: nonBlankEnv("ANTHROPIC_MODEL", resolvedMode === "api" ? "claude-fable-5" : "claude-opus-5"),
    anthropicEscalationModel: nonBlankEnv("ANTHROPIC_ESCALATION_MODEL", "claude-fable-5"),
    responseRendererModel: nonBlankEnv("RESPONSE_RENDERER_MODEL", resolvedMode === "api" ? nonBlankEnv("ANTHROPIC_MODEL", "claude-opus-5") : "claude-sonnet-4-6"),
    codexReasoningEffort: process.env.CODEX_REASONING_EFFORT ?? "high",
    claudeEffort: process.env.CLAUDE_EFFORT ?? "high",
    openaiModelFallbacks: listEnv("OPENAI_MODEL_FALLBACKS", []),
    anthropicModelFallbacks: listEnv("ANTHROPIC_MODEL_FALLBACKS", []),
    allowClaudeFableUsage: booleanEnv("ALLOW_CLAUDE_FABLE_USAGE", false),
    cliIsolateConfig: booleanEnv("CLI_ISOLATE_CONFIG", true),
    cliWorkingDirectory: path.resolve(projectRoot, process.env.CLI_WORKING_DIRECTORY ?? "."),

    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    acknowledgeProviderRetention: booleanEnv("ACKNOWLEDGE_PROVIDER_RETENTION", false),

    adjudicatorProvider: process.env.ADJUDICATOR_PROVIDER ?? "openai",
    hypnosisWriterProvider: process.env.HYPNOSIS_WRITER_PROVIDER ?? "anthropic",
    hypnosisReviewerProvider: process.env.HYPNOSIS_REVIEWER_PROVIDER ?? "openai",
    hypnosisRepairProvider: process.env.HYPNOSIS_REPAIR_PROVIDER ?? "anthropic",
    hypnosisFinalReviewerProvider: process.env.HYPNOSIS_FINAL_REVIEWER_PROVIDER ?? "openai",
    allowDegraded: booleanEnv("ALLOW_DEGRADED", false),
    ledgerMode: process.env.LEDGER_MODE ?? (resolvedMode === "cli" ? "full" : "redacted"),
    ledgerDir: path.resolve(projectRoot, process.env.LEDGER_DIR ?? "./ledgers"),
    requestTimeoutMs: integerEnv("REQUEST_TIMEOUT_MS", 900000, { min: 1000, max: 3600000 }),
    entitlementTimeoutMs: integerEnv("ENTITLEMENT_TIMEOUT_MS", 300000, { min: 1000, max: 3600000 }),
    guidePacketHeartbeatMs: integerEnv("GUIDE_PACKET_HEARTBEAT_MS", 5000, { min: 250, max: 60000 }),
    guidePacketStaleMs: integerEnv("GUIDE_PACKET_STALE_MS", 30000, { min: 1000, max: 3600000 }),
    maxOutputTokens: integerEnv("MAX_OUTPUT_TOKENS", 12000, { min: 256, max: 128000 }),
    guideExcerptMaxChars: integerEnv("GUIDE_EXCERPT_MAX_CHARS", 18000, { min: 2000, max: 100000 }),
    autopilotMaxHypnosisAttempts: integerEnv("AUTOPILOT_MAX_HYPNOSIS_ATTEMPTS", 3, { min: 1, max: 8 }),
    autopilotPrimaryHypnosisAttempts: integerEnv("AUTOPILOT_PRIMARY_HYPNOSIS_ATTEMPTS", 1, { min: 1, max: 8 }),
    autopilotEscalateToFable: booleanEnv("AUTOPILOT_ESCALATE_TO_FABLE", true),
    autopilotUseStructuredRenderer: booleanEnv("AUTOPILOT_USE_STRUCTURED_RENDERER", true),
    therapyProcessingMode: process.env.THERAPY_PROCESSING_MODE ?? "auto",
    autopilotRunA001: booleanEnv("AUTOPILOT_RUN_A001", true),
    autopilotRunRuntimeSmoke: booleanEnv("AUTOPILOT_RUN_RUNTIME_SMOKE", true),
    autopilotRunWebSmoke: booleanEnv("AUTOPILOT_RUN_WEB_SMOKE", true),
    autopilotLaunchApp: booleanEnv("AUTOPILOT_LAUNCH_APP", true),
    autopilotDiagnoseFailures: booleanEnv("AUTOPILOT_DIAGNOSE_FAILURES", true),
    autopilotReuseCheckpoints: booleanEnv("AUTOPILOT_REUSE_CHECKPOINTS", true),
    devAutomationEnabled: booleanEnv("DEV_AUTOMATION_ENABLED", resolvedMode === "cli"),
    devAutoRepair: booleanEnv("DEV_AUTO_REPAIR", true),
    devAutoPromoteRestorative: booleanEnv("DEV_AUTO_PROMOTE_RESTORATIVE", true),
    devRepairModel: process.env.DEV_REPAIR_MODEL ?? "claude-opus-5",
    devEscalationModel: process.env.DEV_ESCALATION_MODEL ?? "claude-fable-5",
    devReviewModel: nonBlankEnv("DEV_REVIEW_MODEL", nonBlankEnv("OPENAI_MODEL", "gpt-5.6-sol")),
    devReviewTimeoutMs: integerEnv("DEV_REVIEW_TIMEOUT_MS", 180000, { min: 1000, max: 3600000 }),
    devReviewExtendedTimeoutMs: integerEnv("DEV_REVIEW_EXTENDED_TIMEOUT_MS", 600000, { min: 1000, max: 3600000 }),
    devLiveRegressionAttempts: integerEnv("DEV_LIVE_REGRESSION_ATTEMPTS", 2, { min: 1, max: 5 }),
    devLiveRegressionTimeoutMs: integerEnv("DEV_LIVE_REGRESSION_TIMEOUT_MS", 900000, { min: 1000, max: 3600000 }),
    devMaxRepairCycles: integerEnv("DEV_MAX_REPAIR_CYCLES", 2, { min: 1, max: 4 }),
    devSupervisorMaxRecoveries: integerEnv("DEV_SUPERVISOR_MAX_RECOVERIES", 2, { min: 0, max: 6 }),
    devWorkerPollMs: integerEnv("DEV_WORKER_POLL_MS", 3000, { min: 500, max: 60000 }),
    devSlowResponseMs: integerEnv("DEV_SLOW_RESPONSE_MS", 180000, { min: 10000, max: 3600000 }),
    devCandidateRoot: path.resolve(projectRoot, process.env.DEV_CANDIDATE_ROOT ?? "./.inner-signal-autopilot/development-candidates"),
    devJobRoot: path.resolve(projectRoot, process.env.DEV_JOB_ROOT ?? "./.inner-signal-autopilot/development-jobs"),
    devPromotionMarker: path.resolve(projectRoot, process.env.DEV_PROMOTION_MARKER ?? "./.inner-signal-autopilot/promotion-ready.json"),
    autopilotStateDir: path.resolve(projectRoot, process.env.AUTOPILOT_STATE_DIR ?? "./.inner-signal-autopilot"),
    guidePath: path.join(projectRoot, "guides/inner-child-guide.txt"),
    somaticGuidePath: path.join(projectRoot, "guides/somatic-sequencing-guide.txt"),
    guideManifestPath: path.join(projectRoot, "guides/manifest.json"),
    guideGraphBundlePath: path.join(projectRoot, "guide-graphs/compiled/bundle.json"),
    guidePacketRoot: path.resolve(projectRoot, process.env.GUIDE_PACKET_ROOT ?? "./.inner-signal-autopilot/guide-packets"),
    port: integerEnv("PORT", 8787, { min: 1, max: 65535 }),
    ...overrides
  };

  if (Object.hasOwn(overrides, "autopilotStateDir")
      && !Object.hasOwn(overrides, "guidePacketRoot")
      && !String(process.env.GUIDE_PACKET_ROOT ?? "").trim()) {
    config.guidePacketRoot = path.join(config.autopilotStateDir, "guide-packets");
  }

  if (config.therapyProcessingMode === "adversarial") config.therapyProcessingMode = "deep";
  if (config.guidePacketStaleMs <= config.guidePacketHeartbeatMs) {
    throw new RuntimeError("GUIDE_PACKET_STALE_MS must be greater than GUIDE_PACKET_HEARTBEAT_MS.", { code: "BAD_CONFIG" });
  }
  if (!["auto", "fast", "reviewed", "deep", "forensic"].includes(config.therapyProcessingMode)) {
    throw new RuntimeError("THERAPY_PROCESSING_MODE must be auto, fast, reviewed, deep, or forensic.", { code: "BAD_CONFIG" });
  }
  if (!['mock', 'cli', 'api'].includes(config.mode)) {
    throw new RuntimeError("INNER_SIGNAL_MODE must be mock, cli, or api.", { code: "BAD_CONFIG" });
  }
  if (!["openai", "anthropic"].includes(config.adjudicatorProvider)) {
    throw new RuntimeError("ADJUDICATOR_PROVIDER must be openai or anthropic.", { code: "BAD_CONFIG" });
  }
  for (const [key, value] of Object.entries({
    HYPNOSIS_WRITER_PROVIDER: config.hypnosisWriterProvider,
    HYPNOSIS_REVIEWER_PROVIDER: config.hypnosisReviewerProvider,
    HYPNOSIS_REPAIR_PROVIDER: config.hypnosisRepairProvider,
    HYPNOSIS_FINAL_REVIEWER_PROVIDER: config.hypnosisFinalReviewerProvider
  })) {
    if (!["openai", "anthropic"].includes(value)) {
      throw new RuntimeError(`${key} must be openai or anthropic.`, { code: "BAD_CONFIG" });
    }
  }
  if (!["off", "redacted", "full"].includes(config.ledgerMode)) {
    throw new RuntimeError("LEDGER_MODE must be off, redacted, or full.", { code: "BAD_CONFIG" });
  }
  if (config.mode === "cli" && /fable/i.test(config.anthropicModel) && !config.allowClaudeFableUsage) {
    throw new RuntimeError(
      "Fable CLI use is opt-in because it may consume paid Claude usage credits depending on the account plan. Verify the plan, then set ALLOW_CLAUDE_FABLE_USAGE=true.",
      { code: "FABLE_USAGE_ACK_REQUIRED" }
    );
  }
  if (config.mode === "api") {
    if (!config.openaiApiKey) throw new RuntimeError("OPENAI_API_KEY is required in api mode.", { code: "BAD_CONFIG" });
    if (!config.anthropicApiKey) throw new RuntimeError("ANTHROPIC_API_KEY is required in api mode.", { code: "BAD_CONFIG" });
    if (!config.acknowledgeProviderRetention) {
      throw new RuntimeError(
        "API mode requires ACKNOWLEDGE_PROVIDER_RETENTION=true after reviewing both providers’ current retention terms.",
        { code: "RETENTION_ACK_REQUIRED" }
      );
    }
  }
  return config;
}
