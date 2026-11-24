import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "./errors.mjs";
import { readOnOffSetting, readResponseEvidenceSetting } from "./on-off-setting.mjs";
import { RUNNER_RULES_ROOT, RUNNER_TRIAL_DIR, RUNNER_CLAUDE_CONFIG_DIR, RUNNER_FEEDBACK_LINK_SETTING, RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING, RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING, RUNNER_KEPT_PLAN_SETTING, RUNNER_NUMBER_NOW_SETTING, RUNNER_TRIAL_CASE_ID_SETTING, RUNNER_TRIAL_SETTING, RUNNER_TRIAL_SETTINGS_FILE, readRunnerFeedbackLinkSwitch, readRunnerFixedMessageOnAnyFailureSwitch, readRunnerFixedMessageOnFailureSwitch, readRunnerKeptPlanSwitch, readRunnerNumberNowSwitch, readRunnerTrialCaseId, readRunnerTrialSwitch } from "../runner-trial/switch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "../..");

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new RuntimeError(`${name} must be true or false.`, { code: "BAD_CONFIG" });
}

// The fixed fallback message for the four risk routes (see src/supervisor/owner-fallback-message.mjs). Off unless this is turned on, and
// read exactly as INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS is: absent or blank is off, and a value that is not true or false stops startup.
export const OWNER_FALLBACK_SETTING = "INNER_SIGNAL_OWNER_FALLBACK";

function ownerFallbackEnabled() {
  const reading = readOnOffSetting(process.env[OWNER_FALLBACK_SETTING]);
  if (reading === null) throw new RuntimeError(`${OWNER_FALLBACK_SETTING} must be true or false.`, { code: "BAD_CONFIG" });
  return reading;
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

// `providers` names the model providers the caller will use (both by default): API mode needs only their keys, and the
// Fable gate applies only when Claude is among them, so a run that uses one provider isn't stopped by the other's setup.
export function loadConfig(overrides = {}, { providers = ["openai", "anthropic"] } = {}) {
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
    ledgerMode: process.env.LEDGER_MODE ?? "redacted",
    ledgerDir: path.resolve(projectRoot, process.env.LEDGER_DIR ?? "./ledgers"),
    requestTimeoutMs: integerEnv("REQUEST_TIMEOUT_MS", 900000, { min: 1000, max: 3600000 }),
    privateRuntimeInvocationAttempts: integerEnv("PRIVATE_RUNTIME_INVOCATION_ATTEMPTS", 2, { min: 1, max: 3 }),
    ownerFallbackEnabled: ownerFallbackEnabled(),
    // The runner trial (src/runner-trial/settings.mjs): off unless switched on. The two paths are passed on as given and checked
    // only when the trial is built, so they matter only while it is on.
    runnerTrialEnabled: readRunnerTrialSwitch(process.env[RUNNER_TRIAL_SETTING]),
    // The plan kept for next time (src/runner-trial/kept-plan.mjs): its own switch, off unless switched on, and meaningful only
    // while the runner trial is on.
    runnerKeptPlanEnabled: readRunnerKeptPlanSwitch(process.env[RUNNER_KEPT_PLAN_SETTING]),
    // The emergency number at once for what the crisis section sends there now though the person hasn't said they've acted
    // (src/runner-trial/runtime.mjs, design section 9b): its own switch, off unless switched on, and meaningful only while the
    // runner trial is on.
    runnerNumberNowEnabled: readRunnerNumberNowSwitch(process.env[RUNNER_NUMBER_NOW_SETTING]),
    // The owner's fixed message also when the plan's limit, a lapsed sign-in or the time ends a turn in a conversation about wanting
    // to die or getting safe (src/runner-trial/runtime.mjs, design section 7): its own switch, off unless switched on, and meaningful
    // only while the runner trial and INNER_SIGNAL_OWNER_FALLBACK are both on.
    runnerFixedMessageOnFailureEnabled: readRunnerFixedMessageOnFailureSwitch(process.env[RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING]),
    // The owner's fixed message after every failure in such a conversation (a refusal, any other failed call and an interruption
    // too; his question i68, part 2; design, section 7): its own switch, off unless switched on, and meaningful only while the runner
    // trial, INNER_SIGNAL_OWNER_FALLBACK and INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE are all on.
    runnerFixedMessageOnAnyFailureEnabled: readRunnerFixedMessageOnAnyFailureSwitch(process.env[RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING]),
    // The trial page's link to the feedback page: its own switch, off until that page is released.
    runnerFeedbackLinkEnabled: readRunnerFeedbackLinkSwitch(process.env[RUNNER_FEEDBACK_LINK_SETTING]),
    // The case the trial's page uses (the one the trial vault's credentials grant), or null; a value of another form stops startup.
    runnerTrialCaseId: readRunnerTrialCaseId(process.env[RUNNER_TRIAL_CASE_ID_SETTING]),
    runnerRulesRoot: nonBlankEnv(RUNNER_RULES_ROOT, null),
    runnerTrialDir: nonBlankEnv(RUNNER_TRIAL_DIR, null),
    runnerTrialSettingsPath: nonBlankEnv(RUNNER_TRIAL_SETTINGS_FILE, null),
    runnerClaudeConfigDir: nonBlankEnv(RUNNER_CLAUDE_CONFIG_DIR, null),
    responseEvidenceEnforced: readResponseEvidenceSetting(),
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
    // Null selects the current source from guideManifestPath; explicit paths remain overrides.
    guidePath: null,
    somaticGuidePath: null,
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

  if (typeof config.responseEvidenceEnforced !== "boolean") throw new RuntimeError("INNER_SIGNAL_RESPONSE_EVIDENCE must be true or false.", { code: "BAD_CONFIG" });
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
  if (config.mode === "cli" && providers.includes("anthropic") && /fable/i.test(config.anthropicModel) && !config.allowClaudeFableUsage) {
    throw new RuntimeError(
      "Fable CLI use is opt-in because it may consume paid Claude usage credits depending on the account plan. Verify the plan, then set ALLOW_CLAUDE_FABLE_USAGE=true.",
      { code: "FABLE_USAGE_ACK_REQUIRED" }
    );
  }
  if (config.mode === "api") {
    if (providers.includes("openai") && !config.openaiApiKey) throw new RuntimeError("OPENAI_API_KEY is required in api mode.", { code: "BAD_CONFIG" });
    if (providers.includes("anthropic") && !config.anthropicApiKey) throw new RuntimeError("ANTHROPIC_API_KEY is required in api mode.", { code: "BAD_CONFIG" });
    if (!config.acknowledgeProviderRetention) {
      throw new RuntimeError(
        "API mode requires ACKNOWLEDGE_PROVIDER_RETENTION=true after reviewing both providers’ current retention terms.",
        { code: "RETENTION_ACK_REQUIRED" }
      );
    }
  }
  return config;
}
