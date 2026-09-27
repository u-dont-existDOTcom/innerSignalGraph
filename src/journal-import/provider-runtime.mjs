import { ValidationError } from "../core/errors.mjs";
import { AnthropicProvider } from "../providers/anthropic.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import { createChatGptSubscriptionBrowserProvider } from "../providers/chatgpt-subscription-browser.mjs";
import { createChatGptSubscriptionCdpTransport } from "./chatgpt-subscription-cdp.mjs";
import { createChatGptSubscriptionDesktopCdpTransport } from "./chatgpt-subscription-desktop-cdp.mjs";
import { createDisabledJournalInferencePort, createProviderJournalInferencePort } from "./provider-port.mjs";

const PROVIDERS = Object.freeze({
  openai: (options) => new OpenAIProvider(options),
  anthropic: (options) => new AnthropicProvider(options),
  chatgpt_subscription_browser: (options) => createChatGptSubscriptionBrowserProvider({
    model: options.model,
    effort: options.effort,
    routeRef: options.routeRef,
    timeoutMs: options.timeoutMs,
    transport: options.browser?.surface === "desktop_app"
      ? createChatGptSubscriptionDesktopCdpTransport(options.browser)
      : createChatGptSubscriptionCdpTransport(options.browser)
  })
});

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function parseConfiguration(value) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { throw new ValidationError("JOURNAL_INFERENCE_ROUTE_CONFIG_INVALID", { code: "JOURNAL_INFERENCE_ROUTE_CONFIG_INVALID" }); }
  invariant(parsed && typeof parsed === "object" && !Array.isArray(parsed), "JOURNAL_INFERENCE_ROUTE_CONFIG_INVALID");
  invariant(parsed.schema_version === 1, "JOURNAL_INFERENCE_ROUTE_VERSION_UNSUPPORTED");
  invariant(Object.hasOwn(PROVIDERS, parsed.provider), "JOURNAL_INFERENCE_PROVIDER_UNSUPPORTED");
  for (const field of ["route_ref", "model", "effort"]) invariant(typeof parsed[field] === "string" && parsed[field].length > 0, "JOURNAL_INFERENCE_ROUTE_CONFIG_INVALID");
  invariant(Number.isFinite(parsed.max_external_spend_usd) && parsed.max_external_spend_usd >= 0, "INFERENCE_SPEND_LIMIT_INVALID");
  invariant(Number.isSafeInteger(parsed.timeout_ms) && parsed.timeout_ms >= 1_000 && parsed.timeout_ms <= 3_600_000, "JOURNAL_INFERENCE_TIMEOUT_INVALID");
  invariant(Number.isSafeInteger(parsed.max_output_tokens) && parsed.max_output_tokens >= 1 && parsed.max_output_tokens <= 100_000, "JOURNAL_INFERENCE_OUTPUT_LIMIT_INVALID");
  if (parsed.provider === "chatgpt_subscription_browser") {
    invariant(parsed.max_external_spend_usd === 0, "SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND");
    invariant(parsed.allowance_evidence?.maximum_incremental_cost_usd === 0, "SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND");
    invariant(parsed.browser && typeof parsed.browser === "object" && !Array.isArray(parsed.browser), "CHATGPT_BROWSER_CONFIG_REQUIRED");
    invariant(typeof parsed.browser.cdp_host === "string" && parsed.browser.cdp_host.length > 0, "CHATGPT_BROWSER_CONFIG_REQUIRED");
    invariant(Number.isSafeInteger(parsed.browser.cdp_port) && parsed.browser.cdp_port > 0 && parsed.browser.cdp_port <= 65535, "CHATGPT_BROWSER_CONFIG_REQUIRED");
  }
  return parsed;
}

function secret(environment, name) {
  const value = environment[name];
  invariant(typeof value === "string" && value.length > 0, `${name}_REQUIRED`);
  return value;
}

export function loadJournalInferencePortFromEnvironment(environment = process.env, { providerFactories = PROVIDERS, transportCheckpoint } = {}) {
  const raw = environment.INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON;
  if (raw == null || raw === "") return createDisabledJournalInferencePort();
  const config = parseConfiguration(raw);
  const receiptKey = Buffer.from(secret(environment, "INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64"), "base64");
  invariant(receiptKey.byteLength >= 32, "INFERENCE_RECEIPT_KEY_INVALID");
  const factory = providerFactories[config.provider];
  invariant(typeof factory === "function", "JOURNAL_INFERENCE_PROVIDER_UNSUPPORTED");
  const apiKeyName = config.provider === "openai"
    ? "OPENAI_API_KEY"
    : (config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : null);
  const apiKey = apiKeyName ? secret(environment, apiKeyName) : null;
  let provider;
  try {
    provider = factory({
      ...(apiKeyName ? { apiKey } : {}),
      model: config.model,
      effort: config.effort,
      routeRef: config.route_ref,
      timeoutMs: config.timeout_ms,
      maxOutputTokens: config.max_output_tokens,
      browser: config.provider === "chatgpt_subscription_browser" ? {
        host: config.browser.cdp_host,
        port: config.browser.cdp_port,
        surface: config.browser.surface ?? "web",
        targetId: config.browser.target_id ?? null,
        returnTargetId: config.browser.return_target_id ?? null,
        checkpoint: transportCheckpoint,
        temporaryLabels: config.browser.temporary_labels,
        unpersonalizedLabels: config.browser.unpersonalized_labels,
        uploadLabels: config.browser.upload_labels,
        pageReadyTimeoutMs: config.browser.page_ready_timeout_ms,
        generationTimeoutMs: config.timeout_ms
      } : undefined
    });
    return createProviderJournalInferencePort({
      provider,
      receiptKey,
      routeRef: config.route_ref,
      allowanceEvidence: config.allowance_evidence,
      maxExternalSpendUsd: config.max_external_spend_usd,
      configuredModelProfile: config.model,
      configuredEffort: config.effort
    });
  } finally {
    receiptKey.fill(0);
    if (environment === process.env) {
      delete process.env.INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64;
      if (apiKeyName) delete process.env[apiKeyName];
    }
  }
}
