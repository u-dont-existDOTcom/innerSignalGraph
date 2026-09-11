import path from "node:path";
import { RuntimeError } from "../core/errors.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "./private-case-access.mjs";
import { loadHostedPrivateCaseProvidersFromEnvironment } from "./hosted-private-case-providers.mjs";

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
export async function loadPrivateRuntimeAccessFromEnvironment(environment = process.env) {
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
  try {
    providers = resolvedMode === "hosted"
      ? loadHostedPrivateCaseProvidersFromEnvironment(environment)
      : await loadDevelopmentPrivateCaseProviders(path.resolve(credentialsPath));
    const privateCaseAccessService = createPrivateCaseAccessService({
      rootDir: providers.rootDir,
      authorizationProvider: providers.authorizationProvider,
      keyProvider: providers.keyProvider,
      allowDevelopmentFileProvider: resolvedMode === "development"
    });
    let privateAuthContext = null;
    if (resolvedMode === "development") {
      const bearerToken = optionalText(environment.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN);
      if (!bearerToken) {
        throw new RuntimeError("INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN is required for the local private runtime.", { code: "BAD_CONFIG" });
      }
      privateAuthContext = Object.freeze({ bearerToken });
    }
    return Object.freeze({
      mode: resolvedMode,
      providerKind: providers.kind,
      productionReady: providers.productionReady,
      privateCaseAccessService,
      privateAuthContext,
      close() { providers.close(); }
    });
  } catch (error) {
    providers?.close();
    throw error;
  }
}
