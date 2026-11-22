import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuntimeError } from "../core/errors.mjs";
import { readOnOffSetting } from "../core/on-off-setting.mjs";
import { isOutside } from "../core/private-path.mjs";
import { DEFAULT_RUNNER_SETTINGS, PROVISIONAL_TURNS } from "./runtime.mjs";
import { SealedClaudeWorker } from "./sealed-claude.mjs";
import { SealedCodexWorker } from "./sealed-codex.mjs";

// The runner trial's switch and settings (docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections 10 and 11).
//
// INNER_SIGNAL_RUNNER_TRIAL turns the trial on. It is read like the app's other on/off switches: absent, blank or off is off,
// and any value that is neither on nor off stops startup with a message that names the setting and never the value.
//
// INNER_SIGNAL_RUNNER_TRIAL_SETTINGS optionally names a JSON file outside the repository that sets the trial's arms and its
// workers: per role, the provider (claude or codex), the model and the effort. Without it the trial uses the defaults below and
// the runtime's own defaults. Every value is checked strictly, and an error names the field in fixed words, never its value.
//
// INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR (or claudeConfigDir in the file; the setting wins) optionally names a Claude sign-in
// folder of the runner's own, given to every Claude worker as CLAUDE_CONFIG_DIR. The folder is only named: nothing here reads,
// copies or checks what is in it.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export { RUNNER_TRIAL_SETTING, RUNNER_TRIAL_SETTINGS_FILE, RUNNER_CLAUDE_CONFIG_DIR, RUNNER_KEPT_PLAN_SETTING, RUNNER_NUMBER_NOW_SETTING, RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING, RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING, RUNNER_TRIAL_CASE_ID_SETTING, readRunnerTrialSwitch, readRunnerKeptPlanSwitch, readRunnerNumberNowSwitch, readRunnerFixedMessageOnFailureSwitch, readRunnerFixedMessageOnAnyFailureSwitch, readRunnerTrialCaseId } from "./switch.mjs";
import { RUNNER_TRIAL_SETTINGS_FILE, RUNNER_CLAUDE_CONFIG_DIR } from "./switch.mjs";

export const RUNNER_ROLES = Object.freeze(["R1", "R2", "R3", "W", "W-repair", "C1", "C2", "C3", "C4", "C5", "CW"]);

const READER = Object.freeze({ provider: "claude", model: "claude-sonnet-5-5", effort: "low" });
const WRITER = Object.freeze({ provider: "claude", model: "claude-opus-5-5", effort: "medium" });
const CHECKER = Object.freeze({ provider: "claude", model: "claude-opus-5-5", effort: "low" });
export const DEFAULT_RUNNER_WORKERS = Object.freeze({
  R1: READER, R2: READER, R3: READER,
  W: WRITER, "W-repair": WRITER,
  C1: CHECKER, C2: CHECKER, C3: CHECKER, C4: CHECKER, C5: CHECKER, CW: CHECKER
});

const SETTINGS_FIELDS = Object.freeze(["writerMode", "checkerMode", "provisionalLevels", "provisionalTurns", "deadlineMs", "roundMs", "limits", "workers", "claudeConfigDir"]);
const LIMIT_FIELDS = Object.freeze(["reader", "writer", "checker"]);
const WORKER_FIELDS = Object.freeze(["provider", "model", "effort"]);
const PROVIDERS = Object.freeze(["claude", "codex"]);
// The efforts and model names the app's other CLI workers accept (src/journal-import/codex-worker.mjs).
const EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/u;
const PROVISIONAL_LEVELS = Object.freeze(["acted_or_about_to", "wants_to_die"]);
const DEADLINE_MS = Object.freeze({ min: 10_000, max: 1_800_000 });
const CALL_MS = Object.freeze({ min: 1_000, max: 1_800_000 });
const MAX_FILE_BYTES = 64 * 1024;

const invalid = (message) => new RuntimeError(message, { code: "RUNNER_SETTINGS_INVALID" });
const plainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const wholeMs = (value, { min, max }) => Number.isSafeInteger(value) && value >= min && value <= max;

// An absolute path outside the repository, judged on real locations (a link back into the checkout is inside).
function outsidePath(value, name, root) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value.trim())) throw invalid(`${name} must be an absolute path.`);
  const resolved = path.resolve(value.trim());
  let outside;
  try { outside = isOutside(root, resolved); } catch { throw invalid(`${name} names a path that can't be checked.`); }
  if (!outside) throw invalid(`${name} must name a place outside the repository.`);
  return resolved;
}

function validateWorker(role, spec) {
  if (!plainObject(spec)) throw invalid(`workers.${role} must be an object with provider, model and effort.`);
  if (Object.keys(spec).some((key) => !WORKER_FIELDS.includes(key))) throw invalid(`workers.${role} may hold only provider, model and effort.`);
  if (!PROVIDERS.includes(spec.provider)) throw invalid(`workers.${role}.provider must be claude or codex.`);
  // A Claude worker always names its model; a Codex worker may leave it out for Codex's own default.
  if (spec.provider === "claude" || Object.hasOwn(spec, "model")) {
    if (typeof spec.model !== "string" || !MODEL.test(spec.model)) {
      throw invalid(`workers.${role}.model must be a model name of lowercase letters, digits, dots and hyphens${spec.provider === "codex" ? ", or be left out for Codex's own default" : ""}.`);
    }
  }
  if (!EFFORTS.includes(spec.effort)) throw invalid(`workers.${role}.effort must be ${EFFORTS.join(", ")}.`);
  return Object.freeze({ provider: spec.provider, model: spec.model ?? null, effort: spec.effort });
}

// Checks a settings object (the parsed file) and returns what the trial uses: `runtime` holds only the fields the file set (the
// runtime fills in the rest from DEFAULT_RUNNER_SETTINGS), `workers` every role's worker, `claudeConfigDir` the file's folder.
export function validateRunnerTrialSettings(value, { root = repositoryRoot } = {}) {
  if (!plainObject(value)) throw invalid("The runner trial settings must be a JSON object.");
  if (Object.keys(value).some((key) => !SETTINGS_FIELDS.includes(key))) throw invalid(`The runner trial settings may hold only ${SETTINGS_FIELDS.join(", ")}.`);
  const runtime = {};
  if (Object.hasOwn(value, "writerMode")) {
    if (!["focused", "whole"].includes(value.writerMode)) throw invalid("writerMode must be focused or whole.");
    runtime.writerMode = value.writerMode;
  }
  if (Object.hasOwn(value, "checkerMode")) {
    if (!["split", "whole"].includes(value.checkerMode)) throw invalid("checkerMode must be split or whole.");
    runtime.checkerMode = value.checkerMode;
  }
  if (Object.hasOwn(value, "provisionalLevels")) {
    const levels = value.provisionalLevels;
    // The provisional reply is for someone who has acted or is about to (the owner's point 3); the setting can only add wants_to_die.
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > PROVISIONAL_LEVELS.length || new Set(levels).size !== levels.length
      || !levels.every((level) => PROVISIONAL_LEVELS.includes(level)) || !levels.includes("acted_or_about_to")) {
      throw invalid("provisionalLevels must list acted_or_about_to, and may also list wants_to_die.");
    }
    runtime.provisionalLevels = Object.freeze([...levels]);
  }
  if (Object.hasOwn(value, "provisionalTurns")) {
    // first: for someone who has acted or is about to, a conversation's first such turn gets a provisional reply, and a later one
    // only when the crisis reader reads something new and urgent after a number was shown; for wanting to die, the first turn read
    // at that level; every: each such turn.
    if (!PROVISIONAL_TURNS.includes(value.provisionalTurns)) throw invalid(`provisionalTurns must be ${PROVISIONAL_TURNS.join(" or ")}.`);
    runtime.provisionalTurns = value.provisionalTurns;
  }
  if (Object.hasOwn(value, "deadlineMs")) {
    if (!wholeMs(value.deadlineMs, DEADLINE_MS)) throw invalid(`deadlineMs must be a whole number of milliseconds from ${DEADLINE_MS.min} to ${DEADLINE_MS.max}.`);
    runtime.deadlineMs = value.deadlineMs;
  }
  if (Object.hasOwn(value, "roundMs")) {
    const deadline = runtime.deadlineMs ?? DEFAULT_RUNNER_SETTINGS.deadlineMs;
    // A round longer than the turn's time would mean no repair ever starts.
    if (!wholeMs(value.roundMs, { min: CALL_MS.min, max: deadline })) throw invalid(`roundMs must be a whole number of milliseconds from ${CALL_MS.min} to the turn's deadline.`);
    runtime.roundMs = value.roundMs;
  }
  if (Object.hasOwn(value, "limits")) {
    const limits = value.limits;
    if (!plainObject(limits) || Object.keys(limits).some((key) => !LIMIT_FIELDS.includes(key)) || !Object.values(limits).every((limit) => wholeMs(limit, CALL_MS))) {
      throw invalid(`limits may hold ${LIMIT_FIELDS.join(", ")}, each a whole number of milliseconds from ${CALL_MS.min} to ${CALL_MS.max}.`);
    }
    runtime.limits = Object.freeze({ ...limits });
  }
  const workers = { ...DEFAULT_RUNNER_WORKERS };
  if (Object.hasOwn(value, "workers")) {
    if (!plainObject(value.workers)) throw invalid("workers must be an object that names roles.");
    for (const [role, spec] of Object.entries(value.workers)) {
      if (!RUNNER_ROLES.includes(role)) throw invalid(`workers may name only ${RUNNER_ROLES.join(", ")}.`);
      workers[role] = validateWorker(role, spec);
    }
  }
  const claudeConfigDir = Object.hasOwn(value, "claudeConfigDir") ? outsidePath(value.claudeConfigDir, "claudeConfigDir", root) : null;
  return Object.freeze({ runtime: Object.freeze(runtime), workers: Object.freeze(workers), claudeConfigDir });
}

// The trial's settings at startup: the file INNER_SIGNAL_RUNNER_TRIAL_SETTINGS names (or none), and the Claude sign-in folder
// INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR names, which wins over the file's. loadConfig passes both raw values in.
export function loadRunnerTrialSettings({ settingsPath = null, claudeConfigDir = null, root = repositoryRoot } = {}) {
  let value = {};
  if (settingsPath != null) {
    const file = outsidePath(settingsPath, RUNNER_TRIAL_SETTINGS_FILE, root);
    let text;
    try {
      const info = fs.statSync(file);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("not a small regular file");
      text = fs.readFileSync(file, "utf8");
    } catch {
      throw invalid(`${RUNNER_TRIAL_SETTINGS_FILE} must name a readable JSON file of at most ${MAX_FILE_BYTES} bytes.`);
    }
    try { value = JSON.parse(text); } catch { throw invalid("The runner trial settings file isn't valid JSON."); }
  }
  const settings = validateRunnerTrialSettings(value, { root });
  const override = claudeConfigDir == null ? null : outsidePath(claudeConfigDir, RUNNER_CLAUDE_CONFIG_DIR, root);
  return Object.freeze({ ...settings, claudeConfigDir: override ?? settings.claudeConfigDir });
}

// What the trial's page shows of its arrangement (/health's runnerArrangement): the writer's and the checkers' modes, and which
// providers run the readers, the writer and the checkers that the arms call. The box picker reads only for the focused writer,
// and the whole checker (CW) or the split checkers (C1 to C5) check, not both. Providers only: no model, effort or path.
export function runnerArrangement(settings) {
  if (!plainObject(settings?.runtime) || !plainObject(settings?.workers)) throw invalid("The runner's arrangement needs the loaded trial settings.");
  const writerMode = settings.runtime.writerMode ?? DEFAULT_RUNNER_SETTINGS.writerMode;
  const checkerMode = settings.runtime.checkerMode ?? DEFAULT_RUNNER_SETTINGS.checkerMode;
  const providersOf = (roles) => [...new Set(roles.map((role) => settings.workers[role]?.provider))].filter((provider) => PROVIDERS.includes(provider)).sort();
  return Object.freeze({
    writerMode,
    checkerMode,
    readers: providersOf(writerMode === "focused" ? ["R1", "R2", "R3"] : ["R1", "R3"]),
    writer: providersOf(["W", "W-repair"]),
    checkers: providersOf(checkerMode === "whole" ? ["CW"] : ["C1", "C2", "C3", "C4", "C5"])
  });
}

// One sealed worker per role, made on first use and kept: Claude workers through `claude -p`, Codex workers through `codex exec`
// (src/runner-trial/sealed-claude.mjs and sealed-codex.mjs). Making a worker calls nothing; a model is called only by `call`.
export function createRunnerWorkerFactory(settings, { environment = process.env, claudeCommand = "claude", codexCommand = "codex" } = {}) {
  if (!plainObject(settings?.workers) || !RUNNER_ROLES.every((role) => plainObject(settings.workers[role]))) {
    throw invalid("The runner's worker factory needs the loaded trial settings.");
  }
  const made = new Map();
  return function workerFor(role) {
    if (!RUNNER_ROLES.includes(role)) throw invalid("The runner trial has no worker for that role.");
    if (!made.has(role)) {
      const spec = settings.workers[role];
      made.set(role, spec.provider === "claude"
        ? new SealedClaudeWorker({ command: claudeCommand, model: spec.model, effort: spec.effort, environment, configDir: settings.claudeConfigDir ?? null })
        : new SealedCodexWorker({ command: codexCommand, model: spec.model ?? "", effort: spec.effort, environment }));
    }
    return made.get(role);
  };
}
