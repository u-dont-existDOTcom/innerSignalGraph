import path from "node:path";
import { realLocation } from "../core/private-path.mjs";

import { ValidationError } from "../core/errors.mjs";

export function journalSemanticConcurrency(config) {
  const value = config.semantic_concurrency === undefined ? 1 : config.semantic_concurrency;
  if (!Number.isSafeInteger(value) || value < 1 || value > 8)
    throw new ValidationError("JOURNAL_SEMANTIC_CONCURRENCY_INVALID", { code: "JOURNAL_SEMANTIC_CONCURRENCY_INVALID" });
  return value;
}

// How many failed units end a calibration round early. Checked when a run opens and by doctor, before
// any import step or inference.
export function journalCalibrationFailureLimit(config) {
  const value = config.calibration_failure_limit === undefined ? 3 : config.calibration_failure_limit;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ValidationError("JOURNAL_CALIBRATION_FAILURE_LIMIT_INVALID", { code: "JOURNAL_CALIBRATION_FAILURE_LIMIT_INVALID" });
  return value;
}

export function normalizeJournalHardestLaneConfig(config) {
  return Object.freeze({
    enabled: config?.hardest_lane?.enabled === true,
    model: config?.hardest_lane?.model ?? "claude-opus-5-5",
    effort: config?.hardest_lane?.effort ?? "max",
    ttl_hours: config?.hardest_lane?.ttl_hours ?? 24,
    daily_limit: config?.hardest_lane?.daily_limit ?? 20
  });
}

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
