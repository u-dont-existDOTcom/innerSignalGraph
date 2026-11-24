import path from "node:path";
import { readResponseEvidenceSetting } from "../core/on-off-setting.mjs";
import { RuntimeError } from "../core/errors.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "./private-case-access.mjs";
import { acquirePrivateRootWriterLock } from "./shared-case-coordinator.mjs";
import { RUNNER_TRIAL_CLIENT_TOKENS_SETTING, readRunnerTrialClientTokens } from "../runner-trial/switch.mjs";

function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve the private mutation boundary used by the ordinary therapy server.
 *
 * No configuration means "not configured", which lets mock/development
 * surfaces start without inventing a plaintext store. A configured runtime is
 * always backed by the same encrypted, authorization-first service used by the
 * backend mutation orchestrator. The read-only continuity MCP is not involved.
 */
export async function loadPrivateRuntimeAccessFromEnvironment(environment = process.env, { responseEvidenceEnforced = readResponseEvidenceSetting(environment) } = {}) {
  const mode = optionalText(environment.INNER_SIGNAL_PRIVATE_RUNTIME_MODE);
  const credentialsPath = optionalText(environment.INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS);
  if (mode && !["development", "hosted"].includes(mode)) {
    throw new RuntimeError("INNER_SIGNAL_PRIVATE_RUNTIME_MODE must be development or hosted.", { code: "BAD_CONFIG" });
  }
  if (!mode && !credentialsPath) return null;
  const resolvedMode = mode ?? "development";
  if (resolvedMode === "hosted" && credentialsPath) {
    throw new RuntimeError("Hosted private runtime cannot use a development credential file.", { code: "BAD_CONFIG" });
  }
  if (resolvedMode === "development" && !credentialsPath) {
    throw new RuntimeError("INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS is required in development private-runtime mode.", { code: "BAD_CONFIG" });
  }

  let providers;
  let writerLock = null;
  try {
    if (resolvedMode === "hosted") {
      const { loadHostedPrivateCaseProvidersFromEnvironment } = await import("./hosted-private-case-providers.mjs");
      providers = loadHostedPrivateCaseProvidersFromEnvironment(environment);
    } else {
      providers = await loadDevelopmentPrivateCaseProviders(path.resolve(credentialsPath));
    }
    let privateAuthContext = null;
    // The runner trial's clients: each client case's own token (scripts/runner-trial-start.mjs), used only for that case.
    let privateCaseAuthContexts = new Map();
    if (resolvedMode === "development") {
      const bearerToken = optionalText(environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN);
      if (!bearerToken) {
        throw new RuntimeError("INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN is required for the local private runtime.", { code: "BAD_CONFIG" });
      }
      privateAuthContext = Object.freeze({ bearerToken });
      privateCaseAuthContexts = readRunnerTrialClientTokens(environment[RUNNER_TRIAL_CLIENT_TOKENS_SETTING]);
      if ([...privateCaseAuthContexts.values()].some((context) => context.bearerToken === bearerToken)) {
        throw new RuntimeError(`${RUNNER_TRIAL_CLIENT_TOKENS_SETTING} isn't what scripts/runner-trial-start.mjs makes.`, { code: "BAD_CONFIG" });
      }
    } else if (optionalText(environment[RUNNER_TRIAL_CLIENT_TOKENS_SETTING])) {
      throw new RuntimeError(`${RUNNER_TRIAL_CLIENT_TOKENS_SETTING} is only for the runner trial's development vault.`, { code: "BAD_CONFIG" });
    }
    // This server writes the vault for as long as it runs, so it holds the vault's writer lock for
    // that long: the lock the one-shot operator and a journal publication take. Neither can change
    // the vault under it, and it doesn't start while one of them is writing.
    try { writerLock = await acquirePrivateRootWriterLock({ rootDir: providers.rootDir }); }
    catch (error) {
      if (error?.code !== "PRIVATE_ROOT_WRITER_ACTIVE") throw error;
      throw new RuntimeError("Another writer holds this private vault: a one-shot operator, a journal publication or another InnerSignal server. Start this server after it finishes.", { code: "PRIVATE_ROOT_WRITER_ACTIVE" });
    }
    const privateCaseAccessService = createPrivateCaseAccessService({
      rootDir: providers.rootDir,
      heldRootDir: writerLock.rootDir,
      authorizationProvider: providers.authorizationProvider,
      keyProvider: providers.keyProvider,
      responseEvidencePolicy: responseEvidenceEnforced ? "enforced" : "advisory",
      allowDevelopmentFileProvider: resolvedMode === "development"
    });
    const lock = writerLock;
    return Object.freeze({
      mode: resolvedMode,
      providerKind: providers.kind,
      productionReady: providers.productionReady,
      privateCaseAccessService,
      privateAuthContext,
      privateCaseAuthContexts,
      close() {
        providers.close();
        return lock.release();
      }
    });
  } catch (error) {
    await writerLock?.release();
    providers?.close();
    throw error;
  }
}
