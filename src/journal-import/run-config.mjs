import path from "node:path";
import { realLocation } from "../core/private-path.mjs";

/**
 * Whether a vault root is one this run's config names: its private runtime root, that root's
 * "vaults" directory, or its mount when it has one. Judged on real locations, so doctor and a run
 * accept the same vault however its path is spelled.
 */
export function vaultRootMatchesConfig(config, vaultRoot) {
  const root = config?.private_runtime_root;
  const named = [root, typeof root === "string" ? path.join(root, "vaults") : null, config?.private_runtime_mount]
    .filter((value) => typeof value === "string" && path.isAbsolute(value));
  if (typeof vaultRoot !== "string" || !path.isAbsolute(vaultRoot)) return false;
  const actual = realLocation(vaultRoot);
  return named.some((value) => realLocation(value) === actual);
}
