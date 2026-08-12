import fs from "node:fs/promises";
import path from "node:path";
import { readEnvFile, setEnvValues } from "./env-file.mjs";
import { normalizeAutopilotModelPolicy } from "./model-policy.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";

const VALID_THERAPY_MODES = new Set(["auto", "fast", "reviewed", "deep", "forensic"]);
const VALID_LEDGER_MODES = new Set(["off", "redacted", "full"]);
const VALID_PROVIDERS = new Set(["openai", "anthropic"]);

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Normalize the persisted local runtime environment before any component loads
 * strict configuration. This exists specifically so the fast-start web server
 * cannot be killed by stale values left by older runtime versions.
 */
export async function prepareRuntimeEnvironment({
  envPath,
  defaultsPath,
  backupPrefix = `.env.before-v${RUNTIME_VERSION}`,
  makeBackup = true
}) {
  let current;
  try {
    current = await readEnvFile(envPath);
  } catch (error) {
    throw new Error(`Could not read ${envPath}: ${error.message}`);
  }

  if (!current.text) {
    const defaults = await fs.readFile(defaultsPath, "utf8");
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.writeFile(envPath, defaults, { mode: 0o600 });
    current = await readEnvFile(envPath);
  }

  const env = { ...current.values };
  const updates = {};

  // This package is the local subscription-backed runtime. Persist CLI mode
  // explicitly so a stale experimental value cannot kill serve.mjs before the
  // autopilot gets a chance to apply its own { mode: "cli" } override.
  if (env.INNER_SIGNAL_MODE !== "cli") {
    updates.INNER_SIGNAL_MODE = "cli";
    env.INNER_SIGNAL_MODE = "cli";
  }

  const modelPolicy = normalizeAutopilotModelPolicy(env);
  Object.assign(updates, modelPolicy.updates);

  if (String(env.THERAPY_PROCESSING_MODE ?? "").trim() === "adversarial") {
    updates.THERAPY_PROCESSING_MODE = "deep";
    env.THERAPY_PROCESSING_MODE = "deep";
  } else if (!VALID_THERAPY_MODES.has(String(env.THERAPY_PROCESSING_MODE ?? "").trim())) {
    updates.THERAPY_PROCESSING_MODE = "auto";
    env.THERAPY_PROCESSING_MODE = "auto";
  }
  // This is a local development runtime. Keep complete reasoning ledgers for
  // local continuity. Privacy-safe diagnostic bundles intentionally exclude
  // those ledgers, browser chat, credentials, and .env.
  if (String(env.LEDGER_MODE ?? "").trim() !== "full") {
    updates.LEDGER_MODE = "full";
    env.LEDGER_MODE = "full";
  }

  for (const key of [
    "ADJUDICATOR_PROVIDER",
    "HYPNOSIS_WRITER_PROVIDER",
    "HYPNOSIS_REVIEWER_PROVIDER",
    "HYPNOSIS_REPAIR_PROVIDER",
    "HYPNOSIS_FINAL_REVIEWER_PROVIDER"
  ]) {
    const fallback = key === "HYPNOSIS_WRITER_PROVIDER" || key === "HYPNOSIS_REPAIR_PROVIDER" ? "anthropic" : "openai";
    if (!VALID_PROVIDERS.has(String(env[key] ?? "").trim())) {
      updates[key] = fallback;
      env[key] = fallback;
    }
  }

  const port = Number.parseInt(String(env.PORT ?? ""), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    updates.PORT = "8787";
    env.PORT = "8787";
  }

  const changedKeys = Object.entries(updates)
    .filter(([key, value]) => current.values[key] !== value)
    .map(([key]) => key);

  let backupPath = null;
  if (changedKeys.length && makeBackup) {
    backupPath = path.join(path.dirname(envPath), `${backupPrefix}-${timestamp()}`);
    await fs.copyFile(envPath, backupPath);
  }
  if (changedKeys.length) {
    const selectedUpdates = Object.fromEntries(changedKeys.map((key) => [key, updates[key]]));
    await setEnvValues(envPath, selectedUpdates);
  }

  return {
    changed: changedKeys.length > 0,
    changedKeys,
    backupPath,
    mode: "cli",
    modelPolicy
  };
}
