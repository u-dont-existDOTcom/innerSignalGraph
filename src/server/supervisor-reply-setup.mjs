import { createPrivateSupervisorDraftService } from "../supervisor/private-supervisor-draft.mjs";
import { createSupervisorReviewRunner } from "../supervisor/private-supervisor-review-runner.mjs";
import { createSupervisorReplyTools } from "./supervisor-reply-tools.mjs";

// Turns the reply-draft connector tools on, from configuration. They are off unless INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS is set to
// true, and even then a caller needs the case:supervisor_draft scope, a case ACL grant for it, and the review needs model access.
// With the setting on and no model access, the tools are offered but say plainly that review is unavailable, and nothing is ever
// approved.
//
// Model access is the same configuration the rest of InnerSignal uses (INNER_SIGNAL_MODE and its provider settings), built with
// the existing provider factory. Only `api` and `cli` count: `mock` answers from a fixture whatever it is shown, so a review
// by it would mean nothing, and an unset mode reads as `mock`. The review runtime is a seam: a host-side worker that reviews a
// draft elsewhere could take its place without a change to the tools.
//
// The runtime, its provider factory and their configuration are loaded only when the tools are on and a real mode is set. The
// private-case connector therefore starts with exactly the modules it always did while the setting is off, which is how it is
// deployed today.

export const SUPERVISOR_REPLY_SETTING = "INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS";
const REAL_MODES = Object.freeze(["api", "cli"]);
const DEFAULT_INVOCATION_ATTEMPTS = 2;

export function supervisorRepliesEnabled(environment = process.env) {
  const raw = environment[SUPERVISOR_REPLY_SETTING];
  if (raw == null || raw.trim() === "") return false;
  const word = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(word)) return true;
  if (["0", "false", "no", "off"].includes(word)) return false;
  throw new Error(`${SUPERVISOR_REPLY_SETTING} must be true or false.`);
}

// The review runtime built from configuration, or null with a fixed-word reason (never a setting's value or a key).
export async function buildSupervisorReviewRuntime({ environment = process.env, source, loadConfigFn = null, createProvidersFn = null } = {}) {
  if (!REAL_MODES.includes(environment.INNER_SIGNAL_MODE)) return { runtime: null, reason: "NO_PROVIDER_MODE", maximumInvocationAttempts: DEFAULT_INVOCATION_ATTEMPTS };
  try {
    const loadConfig = loadConfigFn ?? (await import("../core/config.mjs")).loadConfig;
    const createProviders = createProvidersFn ?? (await import("../providers/factory.mjs")).createProviders;
    const { createPrivateTherapyModelRuntime } = await import("../supervisor/private-therapy-model-runtime.mjs");
    const config = loadConfig();
    const providers = createProviders(config);
    return {
      runtime: createPrivateTherapyModelRuntime({ privateCaseSource: source, providers, config }),
      reason: null,
      maximumInvocationAttempts: config.privateRuntimeInvocationAttempts ?? DEFAULT_INVOCATION_ATTEMPTS
    };
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code) ? error.code : "PROVIDER_SETUP_FAILED";
    return { runtime: null, reason: code, maximumInvocationAttempts: DEFAULT_INVOCATION_ATTEMPTS };
  }
}

// `modelRuntime` is for a host or a test that supplies the review runtime itself; leave it undefined to build one from
// configuration, or pass null for none. Resolves to null while the setting is off.
export async function createSupervisorReplyConnector({
  access,
  environment = process.env,
  modelRuntime = undefined,
  runnerOptions = {},
  loadConfigFn = null,
  createProvidersFn = null,
  log = () => {}
} = {}) {
  if (!supervisorRepliesEnabled(environment)) return null;
  const draftAccess = access?.supervisorDraftAccess;
  if (!draftAccess || typeof draftAccess.authorize !== "function" || !draftAccess.source) throw new TypeError("An access service with supervisorDraftAccess is required.");
  const built = modelRuntime === undefined
    ? await buildSupervisorReviewRuntime({ environment, source: draftAccess.source, loadConfigFn, createProvidersFn })
    : { runtime: modelRuntime, reason: modelRuntime ? null : "NO_PROVIDER_MODE", maximumInvocationAttempts: DEFAULT_INVOCATION_ATTEMPTS };
  try { log({ event: "supervisor_review", available: built.runtime !== null, reason: built.reason }); } catch { /* a log sink never breaks startup */ }
  const drafts = createPrivateSupervisorDraftService({
    privateCaseSource: draftAccess.source,
    modelRuntime: built.runtime,
    maximumInvocationAttempts: built.maximumInvocationAttempts
  });
  return createSupervisorReplyTools({
    draftAccess,
    drafts,
    runner: createSupervisorReviewRunner(runnerOptions),
    reviewAvailable: built.runtime !== null
  });
}
