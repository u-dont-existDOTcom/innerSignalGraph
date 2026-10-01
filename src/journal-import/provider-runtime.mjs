import path from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../core/errors.mjs";
import { AnthropicProvider } from "../providers/anthropic.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import { createChatGptSubscriptionBrowserProvider } from "../providers/chatgpt-subscription-browser.mjs";
import { createChatGptSubscriptionCdpTransport } from "./chatgpt-subscription-cdp.mjs";
import { createChatGptSubscriptionDesktopCdpTransport } from "./chatgpt-subscription-desktop-cdp.mjs";
import { JOURNAL_ROLE_DEFINITIONS, createDisabledJournalInferencePort, createProviderJournalInferencePort } from "./provider-port.mjs";
import { JOURNAL_EXCHANGE_PROVIDER, JOURNAL_CODEX_EXCHANGE_PROVIDER, createExchangeJournalInferencePort } from "./exchange-port.mjs";
import {
  assertJournalWorkExchangeRoot,
  createJournalWorkExchange,
  deriveJournalWorkExchangeKeys,
  journalWorkExchangeSecret,
  resolveJournalWorkExchangeRoot
} from "./work-exchange.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
  const codexRoute = parsed.provider === JOURNAL_CODEX_EXCHANGE_PROVIDER;
  const exchangeRoute = parsed.provider === JOURNAL_EXCHANGE_PROVIDER || codexRoute;
  invariant(exchangeRoute || Object.hasOwn(PROVIDERS, parsed.provider), "JOURNAL_INFERENCE_PROVIDER_UNSUPPORTED");
  for (const field of ["route_ref", "model", "effort"]) invariant(typeof parsed[field] === "string" && parsed[field].length > 0, "JOURNAL_INFERENCE_ROUTE_CONFIG_INVALID");
  invariant(Number.isFinite(parsed.max_external_spend_usd) && parsed.max_external_spend_usd >= 0, "INFERENCE_SPEND_LIMIT_INVALID");
  // For the exchange route, timeout_ms is how long one call waits for its answer before the run
  // leaves it open for a later run.
  invariant(Number.isSafeInteger(parsed.timeout_ms) && parsed.timeout_ms >= 1_000 && parsed.timeout_ms <= 3_600_000, "JOURNAL_INFERENCE_TIMEOUT_INVALID");
  if (!exchangeRoute || parsed.max_output_tokens !== undefined) {
    invariant(Number.isSafeInteger(parsed.max_output_tokens) && parsed.max_output_tokens >= 1 && parsed.max_output_tokens <= 100_000, "JOURNAL_INFERENCE_OUTPUT_LIMIT_INVALID");
  }
  if (exchangeRoute) {
    invariant(parsed.max_external_spend_usd === 0, "SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND");
    invariant(parsed.allowance_evidence?.maximum_incremental_cost_usd === 0, "SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND");
    const exchange = parsed.exchange ?? {};
    invariant(exchange && typeof exchange === "object" && !Array.isArray(exchange), "JOURNAL_EXCHANGE_CONFIG_INVALID");
    if (exchange.poll_ms !== undefined) invariant(Number.isSafeInteger(exchange.poll_ms) && exchange.poll_ms >= 250 && exchange.poll_ms <= 60_000, "JOURNAL_EXCHANGE_CONFIG_INVALID");
    if (exchange.ttl_ms !== undefined) invariant(Number.isSafeInteger(exchange.ttl_ms) && exchange.ttl_ms >= 60_000 && exchange.ttl_ms <= 7 * 24 * 3_600_000, "JOURNAL_EXCHANGE_CONFIG_INVALID");
  }
  if (codexRoute) {
    invariant(/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(parsed.model), "JOURNAL_CODEX_MODEL_INVALID");
    const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
    invariant(efforts.has(parsed.effort), "JOURNAL_CODEX_EFFORT_INVALID");
    if (parsed.role_effort !== undefined) {
      invariant(parsed.role_effort && typeof parsed.role_effort === "object" && !Array.isArray(parsed.role_effort), "JOURNAL_CODEX_ROLE_EFFORT_INVALID");
      for (const [role, effort] of Object.entries(parsed.role_effort)) {
        invariant(Object.hasOwn(JOURNAL_ROLE_DEFINITIONS, role) && efforts.has(effort), "JOURNAL_CODEX_ROLE_EFFORT_INVALID");
      }
    }
  }
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

// The connector exchange route: work items go to ChatGPT through the private connector tools, and
// the exchange root and secret are the same ones the connector uses.
function loadExchangePort(environment, config, receiptKey, caseId, hardestLane) {
  const configuredRoot = secret(environment, "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT");
  invariant(path.isAbsolute(configuredRoot), "JOURNAL_EXCHANGE_ROOT_INVALID");
  invariant(!(environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64 !== undefined
    && environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE !== undefined), "JOURNAL_WORK_EXCHANGE_SECRET_CONFLICT");
  invariant(Boolean(environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64 || environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE), "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64_REQUIRED");
  const keys = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64
    ? deriveJournalWorkExchangeKeys(environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64) : null;
  if (environment === process.env) delete process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64;
  return createExchangeJournalInferencePort({
    caseId,
    receiptKey,
    routeRef: config.route_ref,
    allowanceEvidence: config.allowance_evidence,
    model: config.model,
    effort: config.effort,
    waitMs: config.timeout_ms,
    hardestLane,
    ...(config.provider === JOURNAL_CODEX_EXCHANGE_PROVIDER ? { executionAttestation: "codex_exec", roleEffort: config.role_effort ?? {} } : {}),
    ...(config.exchange?.poll_ms !== undefined ? { pollMs: config.exchange.poll_ms } : {}),
    ...(config.exchange?.ttl_ms !== undefined ? { ttlMs: config.exchange.ttl_ms } : {}),
    // Canonical, private and outside this checkout, checked when the runtime starts.
    prepareExchange: async () => {
      const root = await resolveJournalWorkExchangeRoot(configuredRoot, { outside: repositoryRoot });
      await assertJournalWorkExchangeRoot(root);
      return createJournalWorkExchange({ root, keys: keys ?? deriveJournalWorkExchangeKeys(await journalWorkExchangeSecret(environment)) });
    }
  });
}

export function loadJournalInferencePortFromEnvironment(environment = process.env, { providerFactories = PROVIDERS, transportCheckpoint, caseId = null, hardestLane = {} } = {}) {
  const raw = environment.INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON;
  if (raw == null || raw === "") return createDisabledJournalInferencePort();
  const config = parseConfiguration(raw);
  invariant(!hardestLane.enabled || ["chatgpt_subscription_browser", JOURNAL_EXCHANGE_PROVIDER].includes(config.provider),
    "HARDEST_LANE_ROUTE_UNAVAILABLE");
  // A browser route remains necessary for ordinary image-bearing visual_reader work. The local
  // hardest exchange cannot carry attachments, so its tier-specific capabilities say that a hardest
  // visual attempt is unavailable; no hardest call may silently fall through to the standard model.
  const receiptKey = Buffer.from(secret(environment, "INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64"), "base64");
  invariant(receiptKey.byteLength >= 32, "INFERENCE_RECEIPT_KEY_INVALID");
  if (config.provider === JOURNAL_EXCHANGE_PROVIDER || config.provider === JOURNAL_CODEX_EXCHANGE_PROVIDER) {
    try {
      invariant(typeof caseId === "string" && caseId.length > 0, "JOURNAL_EXCHANGE_CASE_INVALID");
      return loadExchangePort(environment, config, receiptKey, caseId, hardestLane);
    } finally {
      receiptKey.fill(0);
      if (environment === process.env) delete process.env.INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64;
    }
  }
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
    const providerPort = createProviderJournalInferencePort({
      provider,
      receiptKey: Buffer.from(receiptKey),
      routeRef: config.route_ref,
      allowanceEvidence: config.allowance_evidence,
      maxExternalSpendUsd: config.max_external_spend_usd,
      configuredModelProfile: config.model,
      configuredEffort: config.effort
    });
    if (!(hardestLane.enabled === true && config.provider === "chatgpt_subscription_browser")) return providerPort;
    const exchangePort = loadExchangePort(environment, config, Buffer.from(receiptKey), caseId, hardestLane);
    const operations = new Map();
    const portFor = (input) => input.tier === "hardest" ? exchangePort : providerPort;
    return Object.freeze({
      capabilities() {
        const hardest = exchangePort.capabilities();
        return Object.freeze({
          ...providerPort.capabilities(),
          hardest_roles: hardest.roles,
          hardest_fresh_context_per_generate: hardest.fresh_context_per_generate,
          hardest_authenticated_execution_profile_per_generate: hardest.authenticated_execution_profile_per_generate
        });
      },
      async prepare() { await exchangePort.prepare?.(); },
      async invoke(input) {
        const selected = portFor(input);
        operations.set(input.operationKey, selected);
        return selected.invoke(input);
      },
      async getCompletion(operationKey, { authoritativeCompletion } = {}) {
        const selected = operations.get(operationKey)
          ?? (typeof authoritativeCompletion === "boolean" ? (authoritativeCompletion ? exchangePort : providerPort) : null);
        if (selected) return selected.getCompletion(operationKey);
        const [exchange, browser] = await Promise.all([
          exchangePort.getCompletion(operationKey), providerPort.getCompletion(operationKey)
        ]);
        return exchange.status !== "not_submitted" ? exchange : browser;
      },
      async isAuthoritativeCompletion(operationKey, input = null) {
        if (input) return portFor(input) === exchangePort;
        const selected = operations.get(operationKey);
        if (selected) return selected === exchangePort;
        return exchangePort.hasOperation(operationKey);
      },
      async release(operationKey) {
        operations.delete(operationKey);
        await Promise.all([exchangePort.release?.(operationKey), providerPort.release?.(operationKey)]);
      },
      close() { operations.clear(); exchangePort.close?.(); providerPort.close(); }
    });
  } finally {
    receiptKey.fill(0);
    if (environment === process.env) {
      delete process.env.INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64;
      if (apiKeyName) delete process.env[apiKeyName];
    }
  }
}
