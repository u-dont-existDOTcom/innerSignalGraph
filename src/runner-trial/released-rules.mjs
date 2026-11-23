import fs from "node:fs";
import path from "node:path";
import { RuntimeError } from "../core/errors.mjs";
import { loadTherapyProtocol } from "../protocol/therapy-protocol.mjs";

export function runnerTrialDirectory(config) {
  return config.runnerTrialDir ?? (config.runnerTrialSettingsPath && path.dirname(config.runnerTrialSettingsPath)) ?? null;
}

function checkRulesTree(entry, home) {
  const info = fs.lstatSync(entry);
  if (info.isSymbolicLink()) throw new Error("The rules tree must not contain symlinks.");
  const relative = path.relative(home, fs.realpathSync(entry));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("The rules tree must stay inside the trial folder.");
  if (info.isDirectory()) for (const child of fs.readdirSync(entry)) checkRulesTree(path.join(entry, child), home);
}

// Check every entry before the protocol loader can follow a nested link.
export function loadRunnerRules(config = {}) {
  let pluginRoot;
  let source = "checkout";
  if (config.runnerRulesRoot != null) {
    const bad = () => new RuntimeError("INNER_SIGNAL_RUNNER_RULES_ROOT must be an absolute directory inside the trial folder.", { code: "BAD_CONFIG" });
    const home = runnerTrialDirectory(config);
    try {
      if (!home || !path.isAbsolute(home) || !path.isAbsolute(config.runnerRulesRoot)) throw bad();
      const relative = path.relative(fs.realpathSync(home), fs.realpathSync(config.runnerRulesRoot));
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(config.runnerRulesRoot).isDirectory()) throw bad();
      checkRulesTree(config.runnerRulesRoot, fs.realpathSync(home));
      pluginRoot = config.runnerRulesRoot;
      const match = /^released-rules\/(?:([a-f0-9]{40})|\.snapshot-([a-f0-9]{40})-[a-f0-9-]{36})\/plugins\/inner-signal-therapy$/u.exec(relative.split(path.sep).join("/"));
      const commit = match?.[1] ?? match?.[2];
      if (commit) source = `stable ${commit.slice(0, 9)}`;
    } catch { throw bad(); }
  }
  const protocol = loadTherapyProtocol({ ...(pluginRoot ? { pluginRoot } : {}), boxGuidance: true });
  return { protocol, runnerRules: Object.freeze({ version: protocol.version, sha256: protocol.protocolSha256, source }) };
}
