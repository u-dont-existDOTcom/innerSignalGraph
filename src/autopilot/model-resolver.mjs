import { entitlementSchema } from "../schemas/json-schemas.mjs";
import { parseModelJson } from "../core/json.mjs";
import { CodexCliProvider } from "../providers/codex-cli.mjs";
import { ClaudeCliProvider } from "../providers/claude-cli.mjs";
import { GUIDE_PACKET_MODELS } from "../guide-packet/model-policy.mjs";

function unique(items) {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))];
}

async function probe(provider) {
  const startedAt = new Date().toISOString();
  try {
    const response = await provider.generate({
      system: "This is a model-entitlement and structured-output check. Return only the requested schema.",
      user: 'Return {"ok": true}.',
      outputSchema: entitlementSchema,
      metadata: { stage: "autopilot-entitlement" }
    });
    const parsed = parseModelJson(response.text, `${provider.id} entitlement response`);
    return {
      ok: parsed.ok === true,
      requestId: response.requestId ?? null,
      responseId: response.responseId ?? response.requestId ?? null,
      startedAt,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      details: error.details,
      startedAt,
      completedAt: new Date().toISOString()
    };
  }
}

function defaultOpenAIFactory(options) {
  return new CodexCliProvider(options);
}

function defaultAnthropicFactory(options) {
  return new ClaudeCliProvider(options);
}

function attachEntitlementEvidence(provider, model, result) {
  const evidence = {
    contractVersion: "model-entitlement-evidence-v1",
    ok: true,
    provider: provider.id,
    requestedModel: model,
    resolvedModel: provider.model,
    requestId: result.requestId ?? null,
    responseId: result.responseId,
    probedAt: result.completedAt,
    source: "subscription-cli-live-probe"
  };
  provider.entitlementEvidence = evidence;
  return evidence;
}

async function resolveOpenAI(config, candidates, attempts, onProgress, providerFactory = defaultOpenAIFactory) {
  for (const model of candidates) {
    onProgress?.({ stage: "model-resolution:openai", status: "started", detail: model });
    const provider = providerFactory({
      command: config.codexCommand,
      model,
      reasoningEffort: config.codexReasoningEffort,
      timeoutMs: config.entitlementTimeoutMs,
      cwd: config.cliWorkingDirectory,
      isolateConfig: config.cliIsolateConfig
    });
    const result = await probe(provider);
    attempts.push({ provider: "openai", model, requestedModel: model, ...result });
    if (result.ok) {
      const evidence = attachEntitlementEvidence(provider, model, result);
      onProgress?.({ stage: "model-resolution:openai", status: "completed", detail: model });
      return { model, provider, responseId: result.responseId, evidence };
    }
    onProgress?.({ stage: "model-resolution:openai", status: "failed", detail: result.error || "not available" });
  }
  return null;
}

async function resolveAnthropic(config, candidates, attempts, onProgress, stage = "model-resolution:anthropic", providerFactory = defaultAnthropicFactory) {
  for (const model of candidates) {
    if (/fable/i.test(model) && !config.allowClaudeFableUsage) continue;
    onProgress?.({ stage, status: "started", detail: model });
    const provider = providerFactory({
      command: config.claudeCommand,
      model,
      effort: config.claudeEffort,
      timeoutMs: config.entitlementTimeoutMs,
      cwd: config.cliWorkingDirectory,
      isolateConfig: config.cliIsolateConfig
    });
    const result = await probe(provider);
    attempts.push({ provider: "anthropic", model, requestedModel: model, ...result });
    if (result.ok) {
      const evidence = attachEntitlementEvidence(provider, model, result);
      onProgress?.({ stage, status: "completed", detail: model });
      return { model, provider, responseId: result.responseId, evidence };
    }
    onProgress?.({ stage, status: "failed", detail: result.error || "not available" });
  }
  return null;
}

export async function resolveCliModels(config, { onProgress, providerFactories = {} } = {}) {
  const openaiCandidates = [GUIDE_PACKET_MODELS.reviewer];
  const anthropicCandidates = [GUIDE_PACKET_MODELS.compiler];

  const attempts = { openai: [], anthropic: [] };
  const openai = await resolveOpenAI(config, openaiCandidates, attempts.openai, onProgress, providerFactories.openai);
  const anthropic = await resolveAnthropic(config, anthropicCandidates, attempts.anthropic, onProgress, "model-resolution:anthropic", providerFactories.anthropic);

  return {
    ok: Boolean(openai && anthropic),
    openai,
    anthropic,
    attempts
  };
}

export async function resolveAnthropicEscalation(config, { onProgress, excludeModels = [], providerFactory } = {}) {
  if (!config.autopilotEscalateToFable || !config.allowClaudeFableUsage) {
    return { ok: false, skipped: true, reason: "fable-escalation-disabled", attempts: [] };
  }
  const excluded = new Set(excludeModels.filter(Boolean));
  const candidates = [GUIDE_PACKET_MODELS.adjudicator].filter((model) => !excluded.has(model));
  const attempts = [];
  const resolved = await resolveAnthropic(
    config,
    candidates,
    attempts,
    onProgress,
    "model-resolution:anthropic-escalation",
    providerFactory
  );
  return { ok: Boolean(resolved), resolved, attempts };
}

export async function resolveAnthropicRenderer(config, { onProgress, excludeModels = [], providerFactory } = {}) {
  if (!config.autopilotUseStructuredRenderer) {
    return { ok: false, skipped: true, reason: "structured-renderer-disabled", attempts: [] };
  }
  const excluded = new Set(excludeModels.filter(Boolean));
  const candidates = unique([
    config.responseRendererModel,
    "claude-sonnet-4-6"
  ]).filter((model) => model && !excluded.has(model));
  const attempts = [];
  const resolved = await resolveAnthropic(
    config,
    candidates,
    attempts,
    onProgress,
    "model-resolution:anthropic-renderer",
    providerFactory
  );
  return { ok: Boolean(resolved), resolved, attempts };
}
