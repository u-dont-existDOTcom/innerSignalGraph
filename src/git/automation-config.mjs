import os from "node:os";
import path from "node:path";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;

function repository(value) {
  if (typeof value !== "string" || !REPOSITORY.test(value)) throw new TypeError("Invalid GitHub repository");
  return value;
}

function branch(value) {
  if (typeof value !== "string"
      || !BRANCH.test(value)
      || value.includes("..")
      || value.includes("//")
      || value.startsWith("/")
      || value.endsWith("/")) {
    throw new TypeError("Invalid Git branch");
  }
  return value;
}

function booleanValue(name, raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(String(raw).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(raw).toLowerCase())) return false;
  throw new TypeError(`${name} must be true or false`);
}

function expandPath(value, { homeDir, baseDir }) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("Git automation path must not be blank");
  const candidate = value.trim();
  if (candidate === "~") return path.resolve(homeDir);
  if (candidate.startsWith("~/")) return path.resolve(homeDir, candidate.slice(2));
  if (candidate.startsWith("~")) throw new TypeError("Git automation paths support only ~ or ~/ expansion");
  return path.resolve(baseDir, candidate);
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function pathsOverlap(left, right) {
  return containsPath(left, right) || containsPath(right, left);
}

export function validateGitAutomationRoots({ sourceRoot, installedRoot, stateDir }) {
  if (pathsOverlap(sourceRoot, installedRoot)) {
    throw new TypeError("sourceRoot and installedRoot must not overlap");
  }
  if (pathsOverlap(sourceRoot, stateDir)) {
    throw new TypeError("sourceRoot and stateDir must not overlap");
  }
  const stateRelative = path.relative(installedRoot, stateDir);
  const internalState = containsPath(installedRoot, stateDir) && stateRelative !== "";
  if (pathsOverlap(installedRoot, stateDir)
      && (!internalState || stateRelative.split(path.sep)[0] !== ".inner-signal-autopilot")) {
    throw new TypeError("An installed runtime stateDir must be inside .inner-signal-autopilot");
  }
  return { stateRelative, internalState };
}

export function loadGitAutomationConfig({
  env = process.env,
  homeDir = os.homedir(),
  installRoot
} = {}) {
  const defaultInstalledRoot = path.join(homeDir, "Téléchargements", "inner-signal-runtime");
  const installedRoot = expandPath(installRoot ?? defaultInstalledRoot, { homeDir, baseDir: process.cwd() });
  const sourceRoot = expandPath(
    env.INNER_SIGNAL_GIT_SOURCE ?? path.join(homeDir, "Téléchargements", "innerSignalGraph"),
    { homeDir, baseDir: installedRoot }
  );
  const stateDir = expandPath(
    env.AUTOPILOT_STATE_DIR ?? path.join(installedRoot, ".inner-signal-autopilot"),
    { homeDir, baseDir: installedRoot }
  );
  validateGitAutomationRoots({ sourceRoot, installedRoot, stateDir });

  return {
    repository: repository(env.INNER_SIGNAL_GITHUB_REPOSITORY ?? "u-dont-existDOTcom/innerSignalGraph"),
    stableBranch: branch(env.INNER_SIGNAL_GIT_STABLE_BRANCH ?? "stable"),
    diagnosticsBranch: branch(env.INNER_SIGNAL_GIT_DIAGNOSTICS_BRANCH ?? "runtime-diagnostics"),
    sourceRoot,
    installedRoot,
    stateDir,
    autoUpdate: booleanValue("INNER_SIGNAL_GIT_AUTO_UPDATE", env.INNER_SIGNAL_GIT_AUTO_UPDATE, true),
    autoDiagnostics: booleanValue("INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS", env.INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS, true)
  };
}
