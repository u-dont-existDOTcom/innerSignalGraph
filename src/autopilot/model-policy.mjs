const PRIMARY_ANTHROPIC_MODEL = "claude-opus-5";
const ESCALATION_ANTHROPIC_MODEL = "claude-fable-5";
const RENDERER_ANTHROPIC_MODEL = "claude-sonnet-4-6";

function booleanLike(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function splitModels(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function isLegacyArtifactSelector(model) {
  return /^(?:claude-)?sonnet(?:-4-6)?$/i.test(model) || /claude-sonnet-4-6/i.test(model);
}

/**
 * The standalone runtime uses Opus 5 normally and Fable 5 only as an
 * escalation/fallback. This migrates preserved Artifact-era Sonnet settings
 * and the earlier no-Fable safety default without asking the user to edit .env.
 */
export function normalizeAutopilotModelPolicy(env = process.env) {
  const originalModel = String(env.ANTHROPIC_MODEL ?? "").trim();
  const originalEscalation = String(env.ANTHROPIC_ESCALATION_MODEL ?? "").trim();
  const originalRenderer = String(env.RESPONSE_RENDERER_MODEL ?? "").trim();
  const originalFallbacks = splitModels(env.ANTHROPIC_MODEL_FALLBACKS);
  const originalAllowFable = booleanLike(env.ALLOW_CLAUDE_FABLE_USAGE);
  const originalEscalate = booleanLike(env.AUTOPILOT_ESCALATE_TO_FABLE);

  const selectedModel = !originalModel || isLegacyArtifactSelector(originalModel) || /fable/i.test(originalModel)
    ? PRIMARY_ANTHROPIC_MODEL
    : originalModel;
  const escalationModel = originalEscalation || ESCALATION_ANTHROPIC_MODEL;
  const fallbacks = unique([
    selectedModel,
    ...originalFallbacks.filter((model) => !isLegacyArtifactSelector(model)),
    PRIMARY_ANTHROPIC_MODEL
  ]).filter((model) => model === PRIMARY_ANTHROPIC_MODEL);

  const updates = {
    ANTHROPIC_MODEL: selectedModel,
    ANTHROPIC_ESCALATION_MODEL: escalationModel,
    RESPONSE_RENDERER_MODEL: String(env.RESPONSE_RENDERER_MODEL ?? "").trim() || RENDERER_ANTHROPIC_MODEL,
    ANTHROPIC_MODEL_FALLBACKS: fallbacks.join(","),
    ALLOW_CLAUDE_FABLE_USAGE: "true",
    AUTOPILOT_ESCALATE_TO_FABLE: "true"
  };

  for (const [key, value] of Object.entries(updates)) env[key] = value;

  const changed =
    selectedModel !== originalModel ||
    escalationModel !== originalEscalation ||
    fallbacks.join(",") !== originalFallbacks.join(",") ||
    !originalAllowFable ||
    !originalEscalate ||
    originalRenderer !== updates.RESPONSE_RENDERER_MODEL;

  return {
    changed,
    reason: changed ? "standalone-opus-fable-policy-applied" : "standalone-policy-current",
    originalModel,
    selectedModel,
    escalationModel,
    rendererModel: updates.RESPONSE_RENDERER_MODEL,
    fallbacks,
    allowFable: true,
    escalateToFable: true,
    updates
  };
}
