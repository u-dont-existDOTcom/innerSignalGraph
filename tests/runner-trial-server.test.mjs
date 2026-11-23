import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { listenInnerSignalLoopback } from "../src/server/listen-loopback.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { PRIVATE_CASE_SCOPES, createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { CLOSING_REASONS, EMERGENCY_LINE, PROVISIONAL_PREFIX, RUNNER_UNAVAILABLE_NOTICE, THINKING_LINE } from "../src/runner-trial/notices.mjs";
import { OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";
import { SealedClaudeWorker } from "../src/runner-trial/sealed-claude.mjs";
import { SealedCodexWorker } from "../src/runner-trial/sealed-codex.mjs";
import {
  DEFAULT_RUNNER_WORKERS,
  RUNNER_CLAUDE_CONFIG_DIR,
  RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING,
  RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING,
  RUNNER_NUMBER_NOW_SETTING,
  RUNNER_ROLES,
  RUNNER_TRIAL_CASE_ID_SETTING,
  RUNNER_TRIAL_SETTING,
  RUNNER_TRIAL_SETTINGS_FILE,
  createRunnerWorkerFactory,
  loadRunnerTrialSettings,
  readRunnerFixedMessageOnAnyFailureSwitch,
  readRunnerFixedMessageOnFailureSwitch,
  readRunnerNumberNowSwitch,
  readRunnerTrialSwitch,
  validateRunnerTrialSettings
} from "../src/runner-trial/settings.mjs";
import { createRunnerEventHub, createRunnerTrialController, runnerEventLine } from "../src/runner-trial/trial-controller.mjs";

// The runner trial wired into the local app (docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections 8, 10 and 11):
// the switch, the settings file and the worker factory, /health, the NDJSON stream of /v1/therapy/respond and the page's fixed
// words. Every conversation is synthetic and every worker is a stand-in: no model is called, and no test sends a therapy message
// to a server built with real workers.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serveEntry = fileURLToPath(new URL("../src/cli/serve.mjs", import.meta.url));
const parts = cutRuleParts(loadTherapyProtocol({ boxGuidance: true }));
const CASE_ID = "synthetic-runner-server-case";
// A case id of the form the start script makes (INNER_SIGNAL_RUNNER_TRIAL_CASE_ID), and one a fresh page might have made up.
const SYNTHETIC_TRIAL_CASE = "case-00000000-0000-4000-8000-000000000000";
const SYNTHETIC_PAGE_CASE = "case-11111111-1111-4111-8111-111111111111";
const OLD_ANSWER_FIELDS = ["answer", "mode", "processingTier", "routingReason", "graphBundleVersion", "caseFormulation", "interventionContract", "responseContract", "processingMs", "durableCaseState", "caseState", "caseStateDiff", "privateCaseStorage", "orchestration"];
// With the trial on, every answer also carries what its stored turn showed before the reply.
const STORED_TURN_FIELDS = ["provisional", "emergencyLineShown"];

async function withEnv(values, fn) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const trialConfig = (overrides = {}) => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, ...overrides });

async function makeStore(t) {
  const root = await tempDir(t, "runner-server");
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 91), recoverySecretBytes: Buffer.alloc(32, 92), developmentExternalCredentialAuthorized: true });
  await store.loadOrCreate(CASE_ID);
  return store;
}

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

// Stand-in workers: `script[role]` is a function (call number, request) -> value, or throws.
function fakeWorkers(script) {
  const calls = [];
  let session = 0;
  return {
    calls,
    workerFor: (role) => ({
      async call(request) {
        const count = calls.filter((entry) => entry.role === role).length + 1;
        calls.push({ role, request });
        const value = await script[role](count, request);
        session += 1;
        return { value, receipt: { provider: "fake", model: "fake", session_id: `fake-${role}-${session}` } };
      }
    })
  };
}

const quietReader = () => ({ level: "none", wish_or_intent: "not_applicable", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: "nothing of the kind", provisional_reply: null });
const passing = () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] });
const baseScript = (overrides = {}) => ({
  R1: quietReader,
  R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION"] }),
  R3: () => ({ compatibility_assessment: null }),
  W: () => ({ reply: "A synthetic reply.", answered_level: "none", quotes: [] }),
  "W-repair": (count) => ({ reply: `A repaired synthetic reply ${count}.`, answered_level: "none", quotes: [] }),
  C1: passing, C2: passing, C3: passing, C4: passing,
  C5: () => ({ findings: [], level: "none", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] }),
  CW: passing,
  ...overrides
});
const PROVISIONAL = "I'm here with you. Please call your local emergency number now: 112 in the EU, 911 in the US, 999 in the UK.";
const actedScript = () => baseScript({
  R1: () => ({ ...quietReader(), level: "acted_or_about_to", reason: "says they took pills", provisional_reply: PROVISIONAL }),
  W: () => ({ reply: "Is someone in the house who could sit with you while you call?", answered_level: "acted_or_about_to", quotes: [] }),
  C1: () => ({ findings: [], level: "acted_or_about_to", repair_induced_checks: [], missed_boxes: [] })
});

// ---- The switch --------------------------------------------------------------------------------------------------------------

const OFF_VALUES = [undefined, "", "   ", "off", "OFF", " Off ", "false", "0", "no"];
const ON_VALUES = ["on", "ON", " on ", "true", "1", "yes"];
const INVALID_VALUES = ["maybe", "2", "enabled", "synthetic-invalid-value"];

test("the switch is off when absent, blank or off, on when on, and any other value stops loadConfig with a message naming the setting and never the value", async () => {
  assert.equal(RUNNER_TRIAL_SETTING, "INNER_SIGNAL_RUNNER_TRIAL");
  const configReading = (value) => withEnv({ [RUNNER_TRIAL_SETTING]: value }, () => loadConfig({ mode: "mock" }).runnerTrialEnabled);
  for (const [values, expected] of [[OFF_VALUES, false], [ON_VALUES, true]]) {
    for (const value of values) {
      assert.equal(readRunnerTrialSwitch(value), expected, JSON.stringify(value));
      assert.equal(await configReading(value), expected, `${JSON.stringify(value)} through loadConfig`);
    }
  }
  for (const value of INVALID_VALUES) {
    const refused = (error) => error?.code === "BAD_CONFIG" && error.message === `${RUNNER_TRIAL_SETTING} must be on or off.` && !error.message.includes(value);
    assert.throws(() => readRunnerTrialSwitch(value), refused, value);
    await assert.rejects(async () => configReading(value), refused, value);
  }
  const defaults = await withEnv({ [RUNNER_TRIAL_SETTING]: undefined, [RUNNER_TRIAL_SETTINGS_FILE]: undefined, [RUNNER_CLAUDE_CONFIG_DIR]: undefined }, () => loadConfig({ mode: "mock" }));
  assert.deepEqual([defaults.runnerTrialEnabled, defaults.runnerTrialSettingsPath, defaults.runnerClaudeConfigDir], [false, null, null], "off by default, and no paths");
});

test("the number now's switch is off when absent, blank or off, on when on, and any other value stops loadConfig naming the setting, never the value", async () => {
  assert.equal(RUNNER_NUMBER_NOW_SETTING, "INNER_SIGNAL_RUNNER_NUMBER_NOW");
  const configReading = (value) => withEnv({ [RUNNER_NUMBER_NOW_SETTING]: value }, () => loadConfig({ mode: "mock" }).runnerNumberNowEnabled);
  for (const [values, expected] of [[OFF_VALUES, false], [ON_VALUES, true]]) {
    for (const value of values) {
      assert.equal(readRunnerNumberNowSwitch(value), expected, JSON.stringify(value));
      assert.equal(await configReading(value), expected, `${JSON.stringify(value)} through loadConfig`);
    }
  }
  for (const value of INVALID_VALUES) {
    const refused = (error) => error?.code === "BAD_CONFIG" && error.message === `${RUNNER_NUMBER_NOW_SETTING} must be on or off.` && !error.message.includes(value);
    assert.throws(() => readRunnerNumberNowSwitch(value), refused, value);
    await assert.rejects(async () => configReading(value), refused, value);
  }
});

test("the fixed message's switch for failures is off when absent, blank or off, on when on, and any other value stops loadConfig naming the setting, never the value", async () => {
  assert.equal(RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING, "INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE");
  const configReading = (value) => withEnv({ [RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING]: value }, () => loadConfig({ mode: "mock" }).runnerFixedMessageOnFailureEnabled);
  for (const [values, expected] of [[OFF_VALUES, false], [ON_VALUES, true]]) {
    for (const value of values) {
      assert.equal(readRunnerFixedMessageOnFailureSwitch(value), expected, JSON.stringify(value));
      assert.equal(await configReading(value), expected, `${JSON.stringify(value)} through loadConfig`);
    }
  }
  for (const value of INVALID_VALUES) {
    const refused = (error) => error?.code === "BAD_CONFIG" && error.message === `${RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING} must be on or off.` && !error.message.includes(value);
    assert.throws(() => readRunnerFixedMessageOnFailureSwitch(value), refused, value);
    await assert.rejects(async () => configReading(value), refused, value);
  }
});

test("the fixed message's switch for every failure is off when absent, blank or off, on when on, and any other value stops loadConfig naming the setting, never the value", async () => {
  assert.equal(RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING, "INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE");
  const configReading = (value) => withEnv({ [RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING]: value }, () => loadConfig({ mode: "mock" }).runnerFixedMessageOnAnyFailureEnabled);
  for (const [values, expected] of [[OFF_VALUES, false], [ON_VALUES, true]]) {
    for (const value of values) {
      assert.equal(readRunnerFixedMessageOnAnyFailureSwitch(value), expected, JSON.stringify(value));
      assert.equal(await configReading(value), expected, `${JSON.stringify(value)} through loadConfig`);
    }
  }
  for (const value of INVALID_VALUES) {
    const refused = (error) => error?.code === "BAD_CONFIG" && error.message === `${RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING} must be on or off.` && !error.message.includes(value);
    assert.throws(() => readRunnerFixedMessageOnAnyFailureSwitch(value), refused, value);
    await assert.rejects(async () => configReading(value), refused, value);
  }
});

test("an invalid switch value stops the server's startup before it listens, and the value is never printed", async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); });
  });
  const child = spawn(process.execPath, [serveEntry], {
    cwd: repositoryRoot,
    env: { ...process.env, INNER_SIGNAL_MODE: "mock", PORT: String(port), [RUNNER_TRIAL_SETTING]: "synthetic-invalid-value" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 60_000);
  const code = await new Promise((resolve) => child.once("exit", (exitCode) => resolve(exitCode)));
  clearTimeout(watchdog);
  assert.notEqual(code, 0, `the server must not start; stdout=${stdout}`);
  assert.match(stderr, /INNER_SIGNAL_RUNNER_TRIAL must be on or off\./u);
  assert.equal(stderr.includes("synthetic-invalid-value"), false);
  assert.equal(stdout.includes("listening"), false);
});

test("the trial's case id is none when absent or blank, the start script's form when set, and any other value stops loadConfig with a message naming the setting and never the value", async () => {
  assert.equal(RUNNER_TRIAL_CASE_ID_SETTING, "INNER_SIGNAL_RUNNER_TRIAL_CASE_ID");
  const reading = (value) => withEnv({ [RUNNER_TRIAL_CASE_ID_SETTING]: value }, () => loadConfig({ mode: "mock" }).runnerTrialCaseId);
  for (const value of [undefined, "", "   "]) assert.equal(await reading(value), null, JSON.stringify(value));
  assert.equal(await reading(SYNTHETIC_TRIAL_CASE), SYNTHETIC_TRIAL_CASE);
  assert.equal(await reading(` ${SYNTHETIC_TRIAL_CASE} `), SYNTHETIC_TRIAL_CASE, "surrounding spaces don't matter");
  for (const value of ["synthetic-invalid-value", "case-1", SYNTHETIC_TRIAL_CASE.toUpperCase(), `${SYNTHETIC_TRIAL_CASE}0`, "case-00000000-0000-1000-8000-000000000000", CASE_ID, "../case-00000000-0000-4000-8000-000000000000"]) {
    const refused = (error) => error?.code === "BAD_CONFIG" && error.message === `${RUNNER_TRIAL_CASE_ID_SETTING} must be a case id of the form case-<random UUID>, as scripts/runner-trial-start.mjs makes it.`;
    await assert.rejects(async () => reading(value), refused, value);
  }
});

// ---- The settings file -------------------------------------------------------------------------------------------------------

test("without a settings file: readers on Sonnet at low effort, writer and repair on Opus at medium, checkers on Opus at low, the runtime's own defaults for the rest", () => {
  const settings = loadRunnerTrialSettings();
  assert.deepEqual(settings.runtime, {}, "the runtime fills in its own defaults");
  assert.equal(settings.claudeConfigDir, null);
  assert.deepEqual(Object.keys(settings.workers).sort(), [...RUNNER_ROLES].sort());
  for (const role of ["R1", "R2", "R3"]) assert.deepEqual(settings.workers[role], { provider: "claude", model: "claude-sonnet-5-5", effort: "low" }, role);
  for (const role of ["W", "W-repair"]) assert.deepEqual(settings.workers[role], { provider: "claude", model: "claude-opus-5-5", effort: "medium" }, role);
  for (const role of ["C1", "C2", "C3", "C4", "C5", "CW"]) assert.deepEqual(settings.workers[role], { provider: "claude", model: "claude-opus-5-5", effort: "low" }, role);
  assert.deepEqual(settings.workers, DEFAULT_RUNNER_WORKERS);
});

test("a settings file outside the repository sets the arms, the times and each role's worker; the rest keep their defaults", async (t) => {
  const dir = await tempDir(t, "runner-settings");
  const claudeHome = path.join(dir, "claude-home");
  const file = path.join(dir, "runner-settings.json");
  await fs.writeFile(file, JSON.stringify({
    writerMode: "whole",
    checkerMode: "whole",
    provisionalLevels: ["acted_or_about_to", "wants_to_die"],
    provisionalTurns: "every",
    deadlineMs: 240_000,
    roundMs: 90_000,
    limits: { reader: 20_000, checker: 60_000 },
    workers: {
      W: { provider: "codex", model: "gpt-5.6-sol", effort: "high" },
      CW: { provider: "codex", effort: "medium" },
      R1: { provider: "claude", model: "claude-opus-5-5", effort: "low" }
    },
    claudeConfigDir: claudeHome
  }));
  const settings = loadRunnerTrialSettings({ settingsPath: file });
  assert.deepEqual(settings.runtime, {
    writerMode: "whole",
    checkerMode: "whole",
    provisionalLevels: ["acted_or_about_to", "wants_to_die"],
    provisionalTurns: "every",
    deadlineMs: 240_000,
    roundMs: 90_000,
    limits: { reader: 20_000, checker: 60_000 }
  });
  assert.deepEqual(settings.workers.W, { provider: "codex", model: "gpt-5.6-sol", effort: "high" });
  assert.deepEqual(settings.workers.CW, { provider: "codex", model: null, effort: "medium" }, "a Codex worker may leave its model to Codex");
  assert.deepEqual(settings.workers.R1, { provider: "claude", model: "claude-opus-5-5", effort: "low" });
  assert.deepEqual(settings.workers.R2, DEFAULT_RUNNER_WORKERS.R2, "a role the file doesn't name keeps its default");
  assert.equal(settings.claudeConfigDir, claudeHome);
});

test("the settings file must be named by an absolute path outside the repository, judged on real locations", async (t) => {
  const refusedWith = (message) => (error) => error?.code === "RUNNER_SETTINGS_INVALID" && error.message === message;
  assert.throws(() => loadRunnerTrialSettings({ settingsPath: "runner-settings.json" }), refusedWith(`${RUNNER_TRIAL_SETTINGS_FILE} must be an absolute path.`));
  assert.throws(() => loadRunnerTrialSettings({ settingsPath: path.join(repositoryRoot, "runner-settings.synthetic.json") }), refusedWith(`${RUNNER_TRIAL_SETTINGS_FILE} must name a place outside the repository.`));
  assert.throws(() => loadRunnerTrialSettings({ settingsPath: path.join(repositoryRoot, "package.json") }), refusedWith(`${RUNNER_TRIAL_SETTINGS_FILE} must name a place outside the repository.`), "refused before it is read");
  const dir = await tempDir(t, "runner-settings-link");
  const link = path.join(dir, "linked-settings.json");
  await fs.symlink(path.join(repositoryRoot, "package.json"), link);
  assert.throws(() => loadRunnerTrialSettings({ settingsPath: link }), refusedWith(`${RUNNER_TRIAL_SETTINGS_FILE} must name a place outside the repository.`), "a link outside that leads inside is inside");
  assert.throws(() => loadRunnerTrialSettings({ settingsPath: path.join(dir, "missing.json") }), /must name a readable JSON file/u);
  const broken = path.join(dir, "broken.json");
  await fs.writeFile(broken, "{ not json");
  assert.throws(() => loadRunnerTrialSettings({ settingsPath: broken }), refusedWith("The runner trial settings file isn't valid JSON."));
});

test("every field is checked strictly, and an error names the field in fixed words, never the value it was given", () => {
  const BAD = "synthetic-invalid-value";
  const cases = [
    [[], "The runner trial settings must be a JSON object."],
    [{ fixedMessageOn: "any_failure" }, /may hold only writerMode, checkerMode/u],
    [{ [BAD]: 1 }, /may hold only/u],
    [{ writerMode: BAD }, "writerMode must be focused or whole."],
    [{ checkerMode: "focused" }, "checkerMode must be split or whole."],
    [{ provisionalLevels: ["wants_to_die"] }, /provisionalLevels must list acted_or_about_to/u],
    [{ provisionalLevels: [] }, /provisionalLevels/u],
    [{ provisionalLevels: ["acted_or_about_to", "acted_or_about_to"] }, /provisionalLevels/u],
    [{ provisionalLevels: ["acted_or_about_to", BAD] }, /provisionalLevels/u],
    [{ provisionalLevels: "acted_or_about_to" }, /provisionalLevels/u],
    [{ provisionalTurns: BAD }, "provisionalTurns must be first or every."],
    [{ provisionalTurns: "First" }, "provisionalTurns must be first or every."],
    [{ provisionalTurns: ["first"] }, /provisionalTurns/u],
    [{ provisionalTurns: null }, /provisionalTurns/u],
    [{ provisionalTurns: true }, /provisionalTurns/u],
    [{ deadlineMs: 300.5 }, /deadlineMs must be a whole number/u],
    [{ deadlineMs: 5_000 }, /deadlineMs/u],
    [{ deadlineMs: "300000" }, /deadlineMs/u],
    [{ roundMs: 400_000 }, /roundMs must be a whole number of milliseconds from 1000 to the turn's deadline\./u],
    [{ deadlineMs: 60_000, roundMs: 90_000 }, /roundMs/u],
    [{ limits: { reader: 0 } }, /limits may hold reader, writer, checker/u],
    [{ limits: { [BAD]: 1_000 } }, /limits/u],
    [{ limits: [] }, /limits/u],
    [{ workers: [] }, "workers must be an object that names roles."],
    [{ workers: { [BAD]: { provider: "claude", model: "claude-opus-5-5", effort: "low" } } }, /workers may name only R1, R2, R3, W, W-repair, C1, C2, C3, C4, C5, CW\./u],
    [{ workers: { W: { provider: BAD, model: "claude-opus-5-5", effort: "low" } } }, "workers.W.provider must be claude or codex."],
    [{ workers: { W: { provider: "claude", effort: "low" } } }, /workers\.W\.model must be a model name/u],
    [{ workers: { W: { provider: "claude", model: `Claude ${BAD}`, effort: "low" } } }, /workers\.W\.model/u],
    [{ workers: { W: { provider: "codex", model: "", effort: "low" } } }, /or be left out for Codex's own default/u],
    [{ workers: { W: { provider: "claude", model: "claude-opus-5-5", effort: BAD } } }, "workers.W.effort must be low, medium, high, xhigh, max."],
    [{ workers: { W: { provider: "claude", model: "claude-opus-5-5" } } }, /workers\.W\.effort/u],
    [{ workers: { W: { provider: "claude", model: "claude-opus-5-5", effort: "low", [BAD]: true } } }, "workers.W may hold only provider, model and effort."],
    [{ workers: { W: null } }, /workers\.W must be an object/u],
    [{ claudeConfigDir: "relative/claude-home" }, "claudeConfigDir must be an absolute path."],
    [{ claudeConfigDir: path.join(repositoryRoot, ".claude-runner") }, "claudeConfigDir must name a place outside the repository."]
  ];
  for (const [value, expected] of cases) {
    assert.throws(() => validateRunnerTrialSettings(value), (error) => {
      assert.equal(error.code, "RUNNER_SETTINGS_INVALID", JSON.stringify(value));
      if (typeof expected === "string") assert.equal(error.message, expected);
      else assert.match(error.message, expected);
      assert.equal(error.message.includes(BAD), false, `the value never shows: ${error.message}`);
      return true;
    }, JSON.stringify(value));
  }
});

// ---- The worker factory and the runner's Claude sign-in folder ----------------------------------------------------------------

test("the worker factory makes one sealed worker per role, Claude or Codex as set, and gives every Claude worker the runner's sign-in folder", async (t) => {
  const dir = await tempDir(t, "runner-factory");
  const fileHome = path.join(dir, "claude-home-from-file");
  const envHome = path.join(dir, "claude-home-from-setting");
  const file = path.join(dir, "runner-settings.json");
  await fs.writeFile(file, JSON.stringify({ claudeConfigDir: fileHome, workers: { C2: { provider: "codex", model: "gpt-5.6-sol", effort: "low" }, W: { provider: "codex", effort: "high" } } }));

  const fromFile = loadRunnerTrialSettings({ settingsPath: file });
  const workerFor = createRunnerWorkerFactory(fromFile);
  for (const role of RUNNER_ROLES) {
    const worker = workerFor(role);
    assert.equal(workerFor(role), worker, `${role} is made once and kept`);
    if (["C2", "W"].includes(role)) {
      assert.ok(worker instanceof SealedCodexWorker, role);
      assert.equal(worker.configDir, undefined, "a Codex worker has no Claude folder");
    } else {
      assert.ok(worker instanceof SealedClaudeWorker, role);
      assert.equal(worker.configDir, fileHome, `${role} uses the runner's sign-in folder`);
      assert.equal(worker.model, fromFile.workers[role].model);
      assert.equal(worker.effort, fromFile.workers[role].effort);
    }
  }
  assert.deepEqual([workerFor("C2").model, workerFor("C2").effort], ["gpt-5.6-sol", "low"]);
  assert.deepEqual([workerFor("W").model, workerFor("W").effort], ["", "high"], "Codex's own default model");
  assert.throws(() => workerFor("R4"), (error) => error.code === "RUNNER_SETTINGS_INVALID" && error.message === "The runner trial has no worker for that role.");
  assert.throws(() => createRunnerWorkerFactory({}), /needs the loaded trial settings/u);

  // INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR wins over the file's folder, and must itself be absolute and outside the repository.
  const overridden = createRunnerWorkerFactory(loadRunnerTrialSettings({ settingsPath: file, claudeConfigDir: envHome }));
  for (const role of ["R1", "R2", "R3", "W-repair", "C1", "C3", "C4", "C5", "CW"]) assert.equal(overridden(role).configDir, envHome, role);
  assert.throws(() => loadRunnerTrialSettings({ claudeConfigDir: "claude-home" }), (error) => error.message === `${RUNNER_CLAUDE_CONFIG_DIR} must be an absolute path.`);
  assert.throws(() => loadRunnerTrialSettings({ claudeConfigDir: path.join(repositoryRoot, ".claude-runner") }), (error) => error.message === `${RUNNER_CLAUDE_CONFIG_DIR} must name a place outside the repository.`);
  // Without a folder, a Claude worker uses the person's default sign-in.
  assert.equal(createRunnerWorkerFactory(loadRunnerTrialSettings())("R1").configDir, null);

  // From the environment through loadConfig into the trial the server builds.
  const config = await withEnv({ [RUNNER_CLAUDE_CONFIG_DIR]: envHome, [RUNNER_TRIAL_SETTINGS_FILE]: file }, () => loadConfig({ mode: "mock" }));
  assert.deepEqual([config.runnerClaudeConfigDir, config.runnerTrialSettingsPath], [envHome, file]);
  const store = await makeStore(t);
  const trial = createRunnerTrialController({ privateCaseSource: store, config: { ...config, runnerTrialEnabled: true } });
  assert.equal(trial.settings.claudeConfigDir, envHome);
  assert.equal(trial.settings.workers.C2.provider, "codex");
});

// ---- /health and startup -----------------------------------------------------------------------------------------------------

test("/health reports runnerTrial on or off, and the switch on with no vault stops startup", async (t) => {
  const offConfig = trialConfig({ runnerTrialEnabled: false });
  const off = await (await fetch(`${await listen(t, createInnerSignalServer({ config: offConfig, providers: createProviders(offConfig) }))}/health`)).json();
  assert.equal(off.runnerTrial, "off");

  // Built the real way: settings, rule parts and sealed workers are made, and nothing calls a model.
  const store = await makeStore(t);
  const onConfig = trialConfig();
  const on = await (await fetch(`${await listen(t, createInnerSignalServer({ config: onConfig, providers: createProviders(onConfig), privateCaseStore: store }))}/health`)).json();
  assert.equal(on.runnerTrial, "on");
  assert.equal(on.privateCaseStorage.automaticOrchestration, true);
  assert.deepEqual(Object.keys(on).filter((key) => key !== "runnerRules"), Object.keys(off), "only the trial gains the rules identity");
  assert.deepEqual(on.runnerRules, { version: parts.protocol.version, sha256: parts.protocol.sha256, source: "checkout" });

  const listener = await listenInnerSignalLoopback({ config: onConfig, providers: createProviders(onConfig), privateCaseStore: store, port: 0 });
  try {
    for (const base of [listener.url, listener.ipv4Url]) assert.equal((await (await fetch(`${base}/health`)).json()).runnerTrial, "on", base);
  } finally {
    await listener.close();
  }

  const noVault = (error) => error?.code === "BAD_CONFIG" && /^INNER_SIGNAL_RUNNER_TRIAL is on, but encrypted private case storage isn't configured/u.test(error.message);
  assert.throws(() => createInnerSignalServer({ config: onConfig, providers: createProviders(onConfig) }), noVault);
  await assert.rejects(() => listenInnerSignalLoopback({ config: onConfig, providers: createProviders(onConfig), port: 0 }), noVault);
  // A controller brought in for the trial must come with its hub, and must authorize a turn (the stream asks it before it listens).
  const { controller, events } = createRunnerTrialController({ privateCaseSource: store, config: onConfig, settings: validateRunnerTrialSettings({}), parts, workerFor: fakeWorkers(baseScript()).workerFor });
  assert.throws(() => createInnerSignalServer({ config: onConfig, providers: createProviders(onConfig), privateCaseStore: store, privateTherapyController: controller }), /needs its event hub/u);
  assert.equal(typeof controller.authorizeTurn, "function");
  assert.throws(() => createInnerSignalServer({ config: onConfig, providers: createProviders(onConfig), privateCaseStore: store, privateTherapyController: { async run() {} }, runnerTrialEvents: events }), /needs its turn authorization/u);
});

test("/health names the trial's case only with the trial on and the setting set, and the trial's arrangement (null with the trial off)", async (t) => {
  const store = await makeStore(t);
  const health = async (config, extra = {}) => (await fetch(`${await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, ...extra }))}/health`)).json();
  const off = await health(trialConfig({ runnerTrialEnabled: false, runnerTrialCaseId: SYNTHETIC_TRIAL_CASE }));
  assert.equal(Object.hasOwn(off, "runnerCaseId"), false, "not with the trial off");
  assert.equal(off.runnerArrangement, null);
  const unset = await health(trialConfig());
  assert.equal(Object.hasOwn(unset, "runnerCaseId"), false, "not without the setting");
  // Built the real way without a settings file: the runtime's own arms (focused writer, split checkers), Claude for every role.
  assert.deepEqual(unset.runnerArrangement, { writerMode: "focused", checkerMode: "split", readers: ["claude"], writer: ["claude"], checkers: ["claude"] });
  assert.equal((await health(trialConfig({ runnerTrialCaseId: SYNTHETIC_TRIAL_CASE }))).runnerCaseId, SYNTHETIC_TRIAL_CASE);

  // A controller brought in with its settings, as the loopback launcher brings it: the arrangement is read from them, and only the
  // providers of the roles the arms call count (no box picker for the whole writer, the whole checker alone).
  const config = trialConfig({ runnerTrialCaseId: SYNTHETIC_TRIAL_CASE });
  const settings = validateRunnerTrialSettings({ writerMode: "whole", checkerMode: "whole", workers: { W: { provider: "codex", effort: "medium" }, "W-repair": { provider: "codex", effort: "medium" }, R2: { provider: "codex", effort: "low" }, C1: { provider: "codex", effort: "low" } } });
  const trial = createRunnerTrialController({ privateCaseSource: store, config, settings, parts, workerFor: fakeWorkers(baseScript()).workerFor });
  const brought = await health(config, { privateTherapyController: trial.controller, runnerTrialEvents: trial.events, runnerTrialSettings: trial.settings });
  assert.deepEqual(brought.runnerArrangement, { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] });
  assert.equal(brought.runnerCaseId, SYNTHETIC_TRIAL_CASE);
  const unknown = await health(config, { privateTherapyController: trial.controller, runnerTrialEvents: trial.events });
  assert.equal(unknown.runnerArrangement, null, "a controller brought in without its settings shows no arrangement");

  // A value given to the server directly is checked as loadConfig checks it.
  assert.throws(() => createInnerSignalServer({ config: trialConfig({ runnerTrialCaseId: "synthetic-invalid-value" }), providers: createProviders(config), privateCaseStore: store }),
    (error) => error?.code === "BAD_CONFIG" && error.message.startsWith(`${RUNNER_TRIAL_CASE_ID_SETTING} must be a case id`) && !error.message.includes("synthetic-invalid-value"));
  // The loopback launcher passes its trial's settings to both listeners.
  const listener = await listenInnerSignalLoopback({ config, providers: createProviders(config), privateCaseStore: store, port: 0 });
  try {
    for (const base of [listener.url, listener.ipv4Url]) {
      const value = await (await fetch(`${base}/health`)).json();
      assert.deepEqual([value.runnerCaseId, value.runnerArrangement?.writerMode, value.runnerArrangement?.checkerMode], [SYNTHETIC_TRIAL_CASE, "focused", "split"], base);
    }
  } finally {
    await listener.close();
  }
});

test("/health says runnerNumberNow on only with the trial and the number now both on, and the switch reaches the crisis reader through the trial's controller", async (t) => {
  const store = await makeStore(t);
  const health = async (config) => (await (await fetch(`${await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store }))}/health`)).json()).runnerNumberNow;
  assert.equal(await health(trialConfig({ runnerTrialEnabled: false, runnerNumberNowEnabled: true })), "off", "it means nothing with the trial off");
  assert.equal(await health(trialConfig()), "off", "off unless switched on");
  // Built the real way: settings, rule parts and sealed workers are made, and nothing calls a model.
  const config = trialConfig({ runnerNumberNowEnabled: true });
  assert.equal(await health(config), "on");
  const listener = await listenInnerSignalLoopback({ config, providers: createProviders(config), privateCaseStore: store, port: 0 });
  try {
    for (const base of [listener.url, listener.ipv4Url]) assert.equal((await (await fetch(`${base}/health`)).json()).runnerNumberNow, "on", base);
  } finally {
    await listener.close();
  }
  // From the config to the crisis reader: the trial's controller gives its runtime the switch, so the reader's schema has number_now
  // only with it on.
  for (const on of [false, true]) {
    const workers = fakeWorkers(baseScript());
    const trial = createRunnerTrialController({ privateCaseSource: store, config: trialConfig({ runnerNumberNowEnabled: on }), settings: validateRunnerTrialSettings({}), parts, workerFor: workers.workerFor });
    const exchangeId = `exchange-number-now-${on}`;
    const result = await trial.controller.run({ caseId: CASE_ID, runtimeTurnId: `runtime:${exchangeId}`, exchangeId, userTurnId: `${exchangeId}-user`, assistantTurnId: `${exchangeId}-assistant`, userMessage: "Something synthetic.", userInput: {} });
    assert.equal(result.deliveryKind, "candidate");
    const reader = workers.calls.find((call) => call.role === "R1").request;
    assert.equal(Object.hasOwn(reader.schema.properties, "number_now"), on, `switch ${on ? "on" : "off"}`);
    assert.equal(reader.system.includes("number_now"), on);
  }
});

test("/health says runnerFixedMessageOnFailure on only with the trial, the owner's fixed message and this switch all on, and the switch reaches the closing through the trial's controller", async (t) => {
  const store = await makeStore(t);
  const health = async (config) => (await (await fetch(`${await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store }))}/health`)).json()).runnerFixedMessageOnFailure;
  assert.equal(await health(trialConfig({ runnerTrialEnabled: false, ownerFallbackEnabled: true, runnerFixedMessageOnFailureEnabled: true })), "off", "it means nothing with the trial off");
  assert.equal(await health(trialConfig({ ownerFallbackEnabled: false, runnerFixedMessageOnFailureEnabled: true })), "off", "nor with the owner's fixed message off: it extends that message");
  assert.equal(await health(trialConfig({ ownerFallbackEnabled: true })), "off", "off unless switched on");
  // Built the real way: settings, rule parts and sealed workers are made, and nothing calls a model.
  const config = trialConfig({ ownerFallbackEnabled: true, runnerFixedMessageOnFailureEnabled: true });
  assert.equal(await health(config), "on");
  const listener = await listenInnerSignalLoopback({ config, providers: createProviders(config), privateCaseStore: store, port: 0 });
  try {
    for (const base of [listener.url, listener.ipv4Url]) assert.equal((await (await fetch(`${base}/health`)).json()).runnerFixedMessageOnFailure, "on", base);
  } finally {
    await listener.close();
  }
  // From the config to the closing: the trial's controller gives its runtime the switch, so a plan limit in a conversation about
  // wanting to die closes with the owner's fixed message only with it on.
  const script = baseScript({
    R1: () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "says they want to die" }),
    W: () => { throw Object.assign(new Error("synthetic"), { code: "PLAN_LIMIT" }); }
  });
  for (const on of [false, true]) {
    const trial = createRunnerTrialController({ privateCaseSource: store, config: trialConfig({ ownerFallbackEnabled: true, runnerFixedMessageOnFailureEnabled: on }), settings: validateRunnerTrialSettings({}), parts, workerFor: fakeWorkers(script).workerFor });
    const exchangeId = `exchange-fixed-message-${on}`;
    const result = await trial.controller.run({ caseId: CASE_ID, runtimeTurnId: `runtime:${exchangeId}`, exchangeId, userTurnId: `${exchangeId}-user`, assistantTurnId: `${exchangeId}-assistant`, userMessage: "Synthetic: I want to die.", userInput: {} });
    assert.deepEqual([result.answer, result.closing], [on ? OWNER_FALLBACK_MESSAGE : RUNNER_UNAVAILABLE_NOTICE, { kind: on ? "owner_fallback" : "runner_unavailable", reason_code: "plan_limit" }], `switch ${on ? "on" : "off"}`);
  }
});

test("/health says runnerFixedMessageOnAnyFailure on only with the trial, the owner's fixed message, the 3b switch and this switch all on, and the switch reaches the closing through the trial's controller", async (t) => {
  const store = await makeStore(t);
  const fieldsOf = async (config) => {
    const health = await (await fetch(`${await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store }))}/health`)).json();
    return [health.runnerFixedMessageOnFailure, health.runnerFixedMessageOnAnyFailure];
  };
  const all = { ownerFallbackEnabled: true, runnerFixedMessageOnFailureEnabled: true, runnerFixedMessageOnAnyFailureEnabled: true };
  assert.deepEqual(await fieldsOf(trialConfig({ ...all, runnerTrialEnabled: false })), ["off", "off"], "it means nothing with the trial off");
  assert.deepEqual(await fieldsOf(trialConfig({ ...all, ownerFallbackEnabled: false })), ["off", "off"], "nor with the owner's fixed message off");
  assert.deepEqual(await fieldsOf(trialConfig({ ...all, runnerFixedMessageOnFailureEnabled: false })), ["off", "off"], "nor with the 3b switch off: it extends that switch");
  assert.deepEqual(await fieldsOf(trialConfig({ ...all, runnerFixedMessageOnAnyFailureEnabled: false })), ["on", "off"], "off unless switched on");
  // Built the real way: settings, rule parts and sealed workers are made, and nothing calls a model.
  const config = trialConfig(all);
  assert.deepEqual(await fieldsOf(config), ["on", "on"]);
  const listener = await listenInnerSignalLoopback({ config, providers: createProviders(config), privateCaseStore: store, port: 0 });
  try {
    for (const base of [listener.url, listener.ipv4Url]) assert.equal((await (await fetch(`${base}/health`)).json()).runnerFixedMessageOnAnyFailure, "on", base);
  } finally {
    await listener.close();
  }
  // From the config to the closing: the trial's controller gives its runtime the switch, so a refusal in a conversation about wanting
  // to die closes with the owner's fixed message only with it on.
  const script = baseScript({
    R1: () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "says they want to die" }),
    W: () => { throw Object.assign(new Error("synthetic"), { code: "REFUSED" }); }
  });
  for (const on of [false, true]) {
    const trial = createRunnerTrialController({ privateCaseSource: store, config: trialConfig({ ...all, runnerFixedMessageOnAnyFailureEnabled: on }), settings: validateRunnerTrialSettings({}), parts, workerFor: fakeWorkers(script).workerFor });
    const exchangeId = `exchange-any-failure-${on}`;
    const result = await trial.controller.run({ caseId: CASE_ID, runtimeTurnId: `runtime:${exchangeId}`, exchangeId, userTurnId: `${exchangeId}-user`, assistantTurnId: `${exchangeId}-assistant`, userMessage: "Synthetic: I want to die.", userInput: {} });
    assert.deepEqual([result.answer, result.closing], [on ? OWNER_FALLBACK_MESSAGE : RUNNER_UNAVAILABLE_NOTICE, { kind: on ? "owner_fallback" : "runner_unavailable", reason_code: "refused" }], `switch ${on ? "on" : "off"}`);
  }
});

// ---- The stream --------------------------------------------------------------------------------------------------------------

async function trialServer(t, script, { ownerFallbackEnabled = false, settings = {} } = {}) {
  const store = await makeStore(t);
  const config = trialConfig({ ownerFallbackEnabled });
  const workers = fakeWorkers(script);
  const trial = createRunnerTrialController({ privateCaseSource: store, config, settings: validateRunnerTrialSettings(settings), parts, workerFor: workers.workerFor });
  const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: trial.controller, runnerTrialEvents: trial.events }));
  return { store, base, trial, calls: workers.calls };
}

async function respond(base, body, { stream = true } = {}) {
  const response = await fetch(`${base}/v1/therapy/respond`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(stream ? { accept: "application/x-ndjson" } : {}) },
    body: JSON.stringify({ caseId: CASE_ID, ...body })
  });
  const text = await response.text();
  return { status: response.status, type: response.headers.get("content-type"), text, lines: stream && /x-ndjson/u.test(response.headers.get("content-type") ?? "") ? text.trim().split("\n").map((line) => JSON.parse(line)) : null, json: stream ? null : JSON.parse(text) };
}

// The server and page tests below whose second turn read acted shows its own provisional reply (or, refused, the emergency line)
// run with provisionalTurns "every": since 22 Nov 2026 the default, "first", gives a later turn of a conversation one only when
// the crisis reader, told a number was shown, reads something new and urgent (tests/runner-trial.test.mjs), and these test what
// the server and the page carry, not which turns get one.
const EVERY_TURN = Object.freeze({ provisionalTurns: "every" });

test("someone who has acted: the stream carries the steps and the provisional reply before the final line, which has the JSON answer's fields", async (t) => {
  const { base, trial } = await trialServer(t, actedScript(), { settings: EVERY_TURN });
  const streamed = await respond(base, { exchangeId: "exchange-acted", userMessage: "I took all my pills an hour ago." });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.type, "application/x-ndjson");
  const types = streamed.lines.map((line) => line.type);
  const provisional = types.indexOf("provisional");
  assert.ok(provisional >= 0, "a provisional line");
  assert.equal(types.at(-1), "final", "the final line comes last");
  assert.ok(provisional < types.indexOf("final"));
  assert.ok(provisional < streamed.lines.findIndex((line) => line.type === "status" && line.step === "writing"), "it comes before the writer starts");
  assert.deepEqual(streamed.lines[provisional], { type: "provisional", text: PROVISIONAL });
  assert.deepEqual(streamed.lines.filter((line) => line.type === "status").map((line) => line.step), ["reading", "writing", "checking"]);
  assert.equal(types.includes("emergency_line"), false, "a shown provisional needs no emergency line");
  const final = streamed.lines.at(-1);
  assert.equal(final.answer, "Is someone in the house who could sit with you while you call?");
  assert.deepEqual(final.orchestration, { state: "DELIVERED", deliveryKind: "candidate", repairCycle: 0, lifecycleOwner: "server" });
  assert.equal(Object.hasOwn(final, "closing"), false);
  assert.equal(trial.events.listenerCount(CASE_ID, "runtime:exchange-acted"), 0, "the subscription ended with the request");
  assert.equal(final.provisional, PROVISIONAL, "the final line carries the stored provisional reply, exactly");
  assert.equal(final.emergencyLineShown, false);

  // The same server answers a page that asks for JSON with one JSON answer, with the same fields as the final line.
  const plain = await respond(base, { exchangeId: "exchange-json", userMessage: "Still here." }, { stream: false });
  assert.equal(plain.status, 200);
  assert.match(plain.type, /^application\/json/u);
  assert.deepEqual(Object.keys(plain.json), [...OLD_ANSWER_FIELDS, ...STORED_TURN_FIELDS]);
  assert.deepEqual(Object.keys(final).filter((key) => key !== "type"), [...OLD_ANSWER_FIELDS, ...STORED_TURN_FIELDS]);
  assert.equal(plain.json.provisional, PROVISIONAL, "this turn's own provisional reply");

  // A replay of the finished acted turn, asked as JSON, carries its provisional reply too: the page shows it with its prefix.
  const replay = await respond(base, { exchangeId: "exchange-acted", userMessage: "I took all my pills an hour ago." }, { stream: false });
  assert.equal(replay.json.answer, final.answer);
  assert.equal(replay.json.provisional, PROVISIONAL);
  assert.equal(replay.json.emergencyLineShown, false);
});

test("a turn closed without a reply: the emergency line and the closing stream before a final line that carries the closing; the JSON answer carries it too", async (t) => {
  const failing = () => ({ findings: [{ code: "CRISIS_FIRST_REPLY_SHAPE", severity: "high", summary: "missing", evidence_turn_ids: [] }], level: "wants_to_die", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] });
  const wants = () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "says they want to die" });
  const { base } = await trialServer(t, baseScript({ R1: wants, C1: failing, C5: failing }));
  const streamed = await respond(base, { exchangeId: "exchange-closed", userMessage: "I want to die." });
  assert.equal(streamed.status, 200);
  const types = streamed.lines.map((line) => line.type);
  assert.ok(types.includes("emergency_line") && types.indexOf("emergency_line") < types.indexOf("final"), "the emergency line goes into the conversation");
  assert.deepEqual(streamed.lines.find((line) => line.type === "closed"), { type: "closed", kind: "runner_unavailable", reason: "checks_failed" });
  assert.ok(streamed.lines.some((line) => line.type === "status" && line.step === "repairing"), "the repairs were tried first");
  const final = streamed.lines.at(-1);
  assert.equal(final.type, "final");
  assert.equal(final.answer, RUNNER_UNAVAILABLE_NOTICE);
  assert.deepEqual(final.closing, { kind: "runner_unavailable", reason_code: "checks_failed" });
  assert.equal(final.orchestration.state, "UNANSWERED");
  assert.ok(Object.hasOwn(CLOSING_REASONS, final.closing.reason_code), "the page has plain words for the reason");
  assert.deepEqual([final.provisional, final.emergencyLineShown], [null, true]);

  // Asked again as JSON, the closed turn replays with its closing, its emergency line and no new model call.
  const replay = await respond(base, { exchangeId: "exchange-closed", userMessage: "I want to die." }, { stream: false });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.answer, RUNNER_UNAVAILABLE_NOTICE);
  assert.deepEqual(replay.json.closing, { kind: "runner_unavailable", reason_code: "checks_failed" });
  assert.deepEqual(Object.keys(replay.json), [...OLD_ANSWER_FIELDS, "closing", ...STORED_TURN_FIELDS]);
  assert.equal(replay.json.emergencyLineShown, true, "the page puts the emergency line in on a replay too");
});

test("the page's New conversation reaches the trial only as exactly true", async (t) => {
  const { base, store } = await trialServer(t, baseScript());
  await respond(base, { exchangeId: "exchange-c1", userMessage: "Synthetic message one." });
  await respond(base, { exchangeId: "exchange-c2", userMessage: "Synthetic message two.", newConversation: true });
  await respond(base, { exchangeId: "exchange-c3", userMessage: "Synthetic message three.", newConversation: "true" });
  const conversations = (await store.load(CASE_ID)).runtime_turns.map((turn) => turn.runner_reading.conversation_id);
  assert.equal(conversations.length, 3);
  assert.notEqual(conversations[1], conversations[0], "true starts a new conversation");
  assert.equal(conversations[2], conversations[1], "anything else continues it");
});

test("a failure streams one error line with a safe message, as the JSON path answers it", async (t) => {
  const config = trialConfig();
  const events = createRunnerEventHub();
  const failingController = { async authorizeTurn() {}, async run() { throw Object.assign(new Error("Synthetic private detail that must not show."), { code: "PRIVATE_CASE_ACCESS_DENIED" }); } };
  const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateTherapyController: failingController, runnerTrialEvents: events }));
  const streamed = await respond(base, { exchangeId: "exchange-error", userMessage: "Synthetic message." });
  assert.equal(streamed.status, 200);
  assert.deepEqual(streamed.lines, [{ type: "error", error: "InnerSignal could not safely complete this request.", code: "PRIVATE_CASE_ACCESS_DENIED" }]);
  assert.equal(streamed.text.includes("Synthetic private detail"), false);
  assert.equal(events.listenerCount(CASE_ID, "runtime:exchange-error"), 0);
  const plain = await respond(base, { exchangeId: "exchange-error", userMessage: "Synthetic message." }, { stream: false });
  assert.equal(plain.status, 403);
  assert.deepEqual(plain.json, { error: "InnerSignal could not safely complete this request.", code: "PRIVATE_CASE_ACCESS_DENIED" });
});

test("with the switch off, the respond route is unchanged: one JSON answer whatever the page accepts, the input passed on as sent, and a hub left alone", async (t) => {
  const config = trialConfig({ runnerTrialEnabled: false });
  const events = createRunnerEventHub();
  const seen = [];
  const controller = {
    async run(input) {
      seen.push(input);
      assert.equal(events.listenerCount(input.caseId, input.runtimeTurnId), 0, "nothing subscribes");
      return { answer: "A synthetic answer.", deliveryKind: "candidate", runtimeTurn: { state: "DELIVERED", repair_cycle: 0 }, runtimeMetadata: {}, durableCaseState: createEmptyCaseState({ caseId: CASE_ID }), caseStateDiff: null };
    }
  };
  const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateTherapyController: controller, runnerTrialEvents: events }));
  const body = { caseId: CASE_ID, exchangeId: "exchange-off", userMessage: "Synthetic message.", newConversation: "yes", processingMode: "fast" };
  const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/u);
  const value = await response.json();
  assert.deepEqual(Object.keys(value), OLD_ANSWER_FIELDS);
  assert.deepEqual(value.orchestration, { state: "DELIVERED", deliveryKind: "candidate", repairCycle: 0, lifecycleOwner: "server" });
  assert.deepEqual(seen[0].userInput, body, "the input is passed on exactly as sent");
  assert.equal((await (await fetch(`${base}/health`)).json()).runnerTrial, "off");
});

test("the reply's label names one whole checker in the whole arm and split checkers in the split arm", async (t) => {
  for (const [value, label] of [[{}, "runner trial: focused writer, split checkers"], [{ writerMode: "whole", checkerMode: "whole" }, "runner trial: whole writer, one whole checker"]]) {
    const store = await makeStore(t);
    const config = trialConfig();
    const trial = createRunnerTrialController({ privateCaseSource: store, config, settings: validateRunnerTrialSettings(value), parts, workerFor: fakeWorkers(baseScript()).workerFor });
    const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: trial.controller, runnerTrialEvents: trial.events }));
    const answer = await respond(base, { exchangeId: "exchange-label", userMessage: "A synthetic message." }, { stream: false });
    assert.equal(answer.status, 200, answer.text);
    assert.equal(answer.json.routingReason, label);
  }
});

test("events are keyed by case and turn: another case's stream with the same turn id hears nothing", async (t) => {
  const hub = createRunnerEventHub();
  const heard = { a: [], b: [] };
  const offA = hub.subscribe("synthetic-case-a", "runtime:shared", (event) => heard.a.push(event));
  hub.subscribe("synthetic-case-b", "runtime:shared", (event) => heard.b.push(event));
  hub.publish("synthetic-case-a", "runtime:shared", { type: "provisional", text: "Call 112 now." });
  assert.deepEqual([heard.a.length, heard.b.length], [1, 0]);
  offA();
  assert.deepEqual([hub.listenerCount("synthetic-case-a", "runtime:shared"), hub.listenerCount("synthetic-case-b", "runtime:shared")], [0, 1]);
  assert.throws(() => hub.subscribe(null, "runtime:shared", () => {}), /needs a case id/u);

  // Through the server: a page of another case listening on the same turn id hears none of this case's provisional reply.
  const { base, trial } = await trialServer(t, actedScript());
  const other = [];
  const off = trial.events.subscribe("synthetic-other-case", "runtime:exchange-shared", (event) => other.push(event));
  t.after(off);
  const streamed = await respond(base, { exchangeId: "exchange-shared", userMessage: "I took all my pills an hour ago." });
  assert.ok(streamed.lines.some((line) => line.type === "provisional"), "this case's stream got it");
  assert.deepEqual(other, [], "the other case's listener got nothing");
});

// The trial over the access service, as serve.mjs builds it: every request is authorized for its case by a bearer token, the
// owner's page by the server's own (privateAuthContext), an agent by the one it sends. The synthetic owner token holds the case's
// read, write and audit scopes; any other token holds nothing.
const OWNER_TOKEN = "synthetic-owner-token";
const accessKeys = () => ({ routineKek: Buffer.alloc(32, 95), recoverySecretBytes: Buffer.alloc(32, 96) });

async function accessTrialServer(t, script) {
  const rootDir = await tempDir(t, "runner-access");
  const access = createPrivateCaseAccessService({
    rootDir,
    allowDevelopmentFileProvider: true,
    authorizationProvider: {
      async authorize({ authContext }) {
        return authContext?.bearerToken === OWNER_TOKEN
          ? { allowed: true, principalId: "synthetic-owner", scopes: [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE, PRIVATE_CASE_SCOPES.AUDIT], purposes: [] }
          : { allowed: false };
      }
    },
    keyProvider: { async getCaseKeyMaterial() { return { ...accessKeys(), accessAssurance: "development_external_file", provider: "development-file-provider" }; } }
  });
  const config = trialConfig();
  const workers = fakeWorkers(script);
  const trial = createRunnerTrialController({ privateCaseSource: access, config, settings: validateRunnerTrialSettings({}), parts, workerFor: workers.workerFor });
  const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseAccessService: access, privateAuthContext: { bearerToken: OWNER_TOKEN }, privateTherapyController: trial.controller, runnerTrialEvents: trial.events }));
  // The same vault opened directly, to look at what the turns stored.
  const store = createEncryptedPrivateCaseStore({ rootDir, ...accessKeys(), developmentExternalCredentialAuthorized: true });
  return { base, store, trial, calls: workers.calls };
}

// A streamed turn as the owner's page asks for it (no token of its own), or as an agent with its own token.
async function respondWith(base, token, body) {
  const headers = { "content-type": "application/json", accept: "application/x-ndjson", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers, body: JSON.stringify({ caseId: CASE_ID, ...body }) });
  return { status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text() };
}
const streamLines = (answer) => answer.text.trim().split("\n").map((line) => JSON.parse(line));

test("a request the turn would refuse hears nothing of another request's turn: the stream authorizes it for its case before it listens", async (t) => {
  let readerReached;
  const reached = new Promise((resolve) => { readerReached = resolve; });
  let releaseReader;
  const readerHeld = new Promise((resolve) => { releaseReader = resolve; });
  const { base, store, trial, calls } = await accessTrialServer(t, baseScript({
    R1: async () => {
      readerReached();
      await readerHeld;
      return { ...quietReader(), level: "acted_or_about_to", reason: "says they took pills", provisional_reply: PROVISIONAL };
    },
    W: () => ({ reply: "Is someone in the house who could sit with you while you call?", answered_level: "acted_or_about_to", quotes: [] }),
    C1: () => ({ findings: [], level: "acted_or_about_to", repair_induced_checks: [], missed_boxes: [] })
  }));
  await store.loadOrCreate(CASE_ID);
  // Both ask for the same case and the same turn id; only the owner's page may use the case.
  const body = { exchangeId: "exchange-shared-turn", userMessage: "I took all my pills an hour ago." };
  const owner = respondWith(base, null, body);
  let other = null;
  try {
    await Promise.race([reached, owner.then(() => { throw new Error("the owner's turn ended before its crisis reader"); })]);
    let otherAnswered = false;
    other = respondWith(base, "synthetic-other-token", body).finally(() => { otherAnswered = true; });
    // Until the other request has its answer, or (were it let listen first) it listens on the owner's turn too.
    for (let waited = 0; waited < 400 && !otherAnswered && trial.events.listenerCount(CASE_ID, "runtime:exchange-shared-turn") < 2; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    releaseReader();
  }
  const [ownerAnswer, otherAnswer] = await Promise.all([owner, other]);
  const ownerLines = streamLines(ownerAnswer);
  assert.deepEqual(ownerLines.find((line) => line.type === "provisional"), { type: "provisional", text: PROVISIONAL }, "the owner's stream has its provisional reply");
  assert.equal(ownerLines.at(-1).type, "final");
  assert.equal(otherAnswer.status, 403, "the other request is refused before it listens");
  assert.match(otherAnswer.type, /^application\/json/u, "its answer is the refusal, not a stream");
  assert.deepEqual(JSON.parse(otherAnswer.text), { error: "InnerSignal could not safely complete this request.", code: "PRIVATE_CASE_ACCESS_DENIED" });
  assert.equal(otherAnswer.text.includes(PROVISIONAL), false, "no line of the owner's turn");
  assert.equal(calls.filter((call) => call.role === "R1").length, 1, "the refused request ran no turn");
  assert.equal(trial.events.listenerCount(CASE_ID, "runtime:exchange-shared-turn"), 0);
});

test("over the access service a new case's first message is answered, and so is the first after Delete this case", async (t) => {
  const { base, store } = await accessTrialServer(t, baseScript());
  const first = await respondWith(base, null, { exchangeId: "exchange-new-1", userMessage: "Something synthetic." });
  assert.deepEqual([first.status, streamLines(first).at(-1).type, streamLines(first).at(-1).answer], [200, "final", "A synthetic reply."]);
  const deleted = await ownerPost(base, "/v1/case/delete", { caseId: CASE_ID, confirmation: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(await store.load(CASE_ID), null);
  const next = await respondWith(base, null, { exchangeId: "exchange-new-2", userMessage: "Something new and synthetic." });
  assert.equal(streamLines(next).at(-1).answer, "A synthetic reply.", "an empty case under the same id");
  assert.equal((await store.load(CASE_ID)).runtime_turns.length, 1);
});

test("only the four event kinds reach the page, each with its own fields", () => {
  assert.deepEqual(runnerEventLine({ type: "status", step: "writing", extra: "x" }), { type: "status", step: "writing" });
  assert.deepEqual(runnerEventLine({ type: "provisional", text: "Call 112 now." }), { type: "provisional", text: "Call 112 now." });
  assert.deepEqual(runnerEventLine({ type: "emergency_line", reason: "no_provisional" }), { type: "emergency_line", reason: "no_provisional" });
  assert.deepEqual(runnerEventLine({ type: "closed", kind: "runner_unavailable", reason: "timeout" }), { type: "closed", kind: "runner_unavailable", reason: "timeout" });
  for (const event of [null, {}, { type: "final" }, { type: "constructor" }, { type: "debug", text: "x" }]) assert.equal(runnerEventLine(event), null, JSON.stringify(event));
});

// ---- The page's reconcile and case deletion ------------------------------------------------------------------------------------

async function ownerPost(base, route, body, headers = {}) {
  const sent = Object.fromEntries(Object.entries({ "content-type": "application/json", origin: base, ...headers }).filter(([, value]) => value != null));
  const response = await fetch(`${base}${route}`, { method: "POST", headers: sent, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => null) };
}

test("the reconcile and delete routes answer only the owner's page on this machine, as JSON, with the trial on", async (t) => {
  const { base } = await trialServer(t, baseScript());
  for (const route of ["/v1/runner/reconcile", "/v1/case/delete"]) {
    const body = { caseId: CASE_ID, confirmation: "DELETE" };
    assert.equal((await ownerPost(base, route, body, { origin: null })).status, 403, `${route}: no Origin`);
    assert.equal((await ownerPost(base, route, body, { origin: "http://evil.example" })).status, 403, `${route}: another Origin`);
    assert.equal((await ownerPost(base, route, body, { authorization: "Bearer synthetic-agent-token" })).status, 403, `${route}: an agent's token`);
    const form = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: "caseId=x" });
    assert.equal(form.status, 415, `${route}: not JSON`);
  }
  assert.equal((await ownerPost(base, "/v1/case/delete", { caseId: CASE_ID })).status, 400, "deleting needs the typed DELETE");
  assert.equal((await ownerPost(base, "/v1/case/delete", { caseId: CASE_ID, confirmation: "delete" })).status, 400);
  const offConfig = trialConfig({ runnerTrialEnabled: false });
  const offBase = await listen(t, createInnerSignalServer({ config: offConfig, providers: createProviders(offConfig), privateCaseStore: await makeStore(t) }));
  for (const route of ["/v1/runner/reconcile", "/v1/case/delete"]) assert.equal((await ownerPost(offBase, route, { caseId: CASE_ID, confirmation: "DELETE" })).status, 404, `${route} with the trial off`);
});

test("the page's reconcile closes a turn a restart left unfinished and returns the turns after the page's last one, with what each showed", async (t) => {
  const { base, store } = await trialServer(t, actedScript());
  await respond(base, { exchangeId: "exchange-r1", userMessage: "I took all my pills an hour ago." });
  await respond(base, { exchangeId: "exchange-r2", userMessage: "Still here." });
  // A turn begun and never finished, as after a restart.
  await store.beginPrivateRuntimeTurn(CASE_ID, { runtimeTurnId: "runtime:exchange-r3", exchangeId: "exchange-r3", userTurnId: "exchange-r3-user", exactText: "A message whose turn was interrupted." });
  const reconciled = await ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID, afterExchangeId: "exchange-r1" });
  assert.equal(reconciled.status, 200);
  assert.deepEqual(reconciled.json.turns.map((turn) => turn.exchangeId), ["exchange-r2", "exchange-r3"], "only the turns after the page's last one");
  const closed = reconciled.json.turns[1];
  assert.deepEqual([closed.userMessage, closed.answer, closed.closing], ["A message whose turn was interrupted.", RUNNER_UNAVAILABLE_NOTICE, { kind: "runner_unavailable", reason_code: "interrupted" }]);
  assert.equal((await store.load(CASE_ID)).runtime_turns.find((turn) => turn.exchange_id === "exchange-r3").state, "UNANSWERED");
  const all = await ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID, afterExchangeId: null });
  assert.deepEqual(all.json.turns.map((turn) => turn.exchangeId), ["exchange-r1", "exchange-r2", "exchange-r3"], "a page that shows none gets the latest turns");
  assert.deepEqual([all.json.turns[0].provisional, all.json.turns[0].emergencyLineShown], [PROVISIONAL, false], "with the provisional reply the person saw");
  assert.deepEqual((await ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID, afterExchangeId: "exchange-r3" })).json.turns, []);
  assert.deepEqual((await ownerPost(base, "/v1/runner/reconcile", { caseId: "synthetic-case-with-no-turns" })).json.turns, [], "a case with no turns stays as it was");
});

test("the page's reconcile delivers an approved turn a failure left undelivered, and waits for a turn still running", async (t) => {
  const store = await makeStore(t);
  let failDelivery = true;
  const flaky = {
    ...store,
    async deliverPrivateRuntimeCandidate(...args) {
      if (failDelivery) { failDelivery = false; throw Object.assign(new Error("synthetic"), { code: "SYNTHETIC_DELIVERY_FAILURE" }); }
      return store.deliverPrivateRuntimeCandidate(...args);
    }
  };
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  const workers = fakeWorkers(baseScript({ W: async () => { writes += 1; if (writes === 2) await held; return { reply: `A synthetic reply ${writes}.`, answered_level: "none", quotes: [] }; } }));
  const config = trialConfig();
  const trial = createRunnerTrialController({ privateCaseSource: flaky, config, settings: validateRunnerTrialSettings({}), parts, workerFor: workers.workerFor });
  const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: trial.controller, runnerTrialEvents: trial.events }));
  const failed = await respond(base, { exchangeId: "exchange-a1", userMessage: "Something synthetic." }, { stream: false });
  assert.equal(failed.status, 500, "the delivery failed");
  assert.equal((await store.load(CASE_ID)).runtime_turns[0].state, "APPROVED");
  const delivered = await ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID });
  assert.deepEqual(delivered.json.turns.map((turn) => [turn.exchangeId, turn.answer, turn.deliveryKind]), [["exchange-a1", "A synthetic reply 1.", "candidate"]]);
  assert.equal((await store.load(CASE_ID)).runtime_turns[0].state, "DELIVERED", "delivered, not closed");

  // A turn still running in this server is waited for, never closed under it.
  const running = respond(base, { exchangeId: "exchange-a2", userMessage: "Something else synthetic." }, { stream: false });
  try {
    for (let waited = 0; waited < 1_000 && writes < 2; waited += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(writes, 2, "the second turn's writer is running");
    let reconciledEarly = false;
    const reconciling = ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID, afterExchangeId: "exchange-a1" }).then((value) => { reconciledEarly = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(reconciledEarly, false, "the reconcile waits for the running turn");
    release();
    assert.equal((await running).json.answer, "A synthetic reply 2.");
    const after = await reconciling;
    assert.deepEqual(after.json.turns.map((turn) => [turn.exchangeId, turn.answer]), [["exchange-a2", "A synthetic reply 2."]]);
  } finally {
    // A failed check must not leave the writer held, or the server could never close.
    release();
    await running.catch(() => {});
  }
});

// The page's own reconcile (reconcileRunnerCase and the runner-trial block), run on its own against a real server, as a page on
// that server would: the browser adds the page's Origin to every POST.
async function reconcilingPage(base, initialState) {
  const { app } = await pageSource();
  const block = app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end"));
  const start = app.indexOf("async function reconcileRunnerCase()");
  const end = app.indexOf("// One trial turn on the page", start);
  assert.ok(start > 0 && end > start, "the page has its reconcile");
  const state = structuredClone(initialState);
  const requests = [];
  const progress = { hidden: true, textContent: "" };
  // The exchanges of the turns the page is still receiving, as beginRunnerTurn records them.
  const runnerTrial = { on: true, newConversation: false, inFlight: new Set() };
  const context = vm.createContext({
    TextDecoder,
    state,
    runnerTrial,
    RUNNER_RECONCILE_LABEL: "Looking for a reply that finished while this page was closed…",
    $: (selector) => { assert.equal(selector, "#runner-progress"); return progress; },
    fetch: (url, init) => {
      requests.push(JSON.parse(init.body));
      return fetch(`${base}${url}`, { ...init, headers: { ...init.headers, origin: base } });
    },
    saveState: () => {},
    renderTherapy: () => {}
  });
  const reconcileRunnerCase = vm.runInContext(`${block}\n${app.slice(start, end)}\n;reconcileRunnerCase`, context);
  return { state, requests, runnerTrial, reconcileRunnerCase };
}

test("a reloaded page shows the current conversation again, every turn with its provisional reply and emergency line; a page that still shows its turns gets only newer ones", async (t) => {
  const acted = (provisional) => ({ ...quietReader(), level: "acted_or_about_to", reason: "says they took something", provisional_reply: provisional });
  const { base } = await trialServer(t, baseScript({
    // The new conversation's first message shows a provisional reply; its second's fails its checks, so the emergency line shows.
    R1: (count) => (count === 2 ? acted(PROVISIONAL) : count === 3 ? acted("Please get help now, call 0800 555 0100.") : quietReader()),
    W: (count) => ({ reply: `A synthetic reply ${count}.`, answered_level: "none", quotes: [] })
  }), { settings: EVERY_TURN });
  await respond(base, { exchangeId: "exchange-earlier", userMessage: "A synthetic message of an earlier conversation." });
  const exchanges = Array.from({ length: 11 }, (_, index) => `exchange-now-${index + 1}`);
  for (const [index, exchangeId] of exchanges.entries()) {
    const answer = await respond(base, { exchangeId, userMessage: `Synthetic message ${index + 1}.`, ...(index === 0 ? { newConversation: true } : {}) });
    assert.equal(answer.lines.at(-1).type, "final", exchangeId);
  }

  // The server: every turn of the current conversation (more than the ten a cursor gets), none of the earlier one.
  const current = await ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID, conversation: "current" });
  assert.deepEqual(current.json.turns.map((turn) => turn.exchangeId), exchanges);
  assert.deepEqual([current.json.turns[0].provisional, current.json.turns[1].provisional, current.json.turns[1].emergencyLineShown], [PROVISIONAL, null, true]);

  // The page after a reload: no transcript, and the cursor still at the last turn it showed.
  const page = await reconcilingPage(base, { caseId: CASE_ID, therapy: [], runnerShownThrough: exchanges.at(-1) });
  await page.reconcileRunnerCase();
  assert.deepEqual(page.requests, [{ caseId: CASE_ID, conversation: "current" }], "a page that shows none of its turns asks for the current conversation");
  const shown = JSON.parse(JSON.stringify(page.state.therapy));
  assert.deepEqual([...new Set(shown.map((entry) => entry.exchangeId))], exchanges, "the whole current conversation is shown again, in order");
  assert.deepEqual(shown.filter((entry) => entry.role === "user").map((entry) => entry.content), exchanges.map((_, index) => `Synthetic message ${index + 1}.`));
  assert.deepEqual(shown.filter((entry) => entry.kind === "provisional").map((entry) => [entry.exchangeId, entry.content]), [[exchanges[0], PROVISIONAL_PREFIX + PROVISIONAL]]);
  assert.deepEqual(shown.filter((entry) => entry.kind === "emergency_line").map((entry) => [entry.exchangeId, entry.content]), [[exchanges[1], EMERGENCY_LINE]]);
  assert.equal(shown.filter((entry) => entry.role === "assistant" && entry.kind !== "provisional").length, 11, "every reply");
  assert.equal(page.state.runnerShownThrough, exchanges.at(-1));

  // The page now shows its turns, so it asks only for what came after the last one, and nothing is shown twice.
  await page.reconcileRunnerCase();
  assert.deepEqual(page.requests[1], { caseId: CASE_ID, afterExchangeId: exchanges.at(-1) });
  assert.equal(page.state.therapy.length, shown.length);
  const { runnerReconcileRequest } = await pageBlock();
  assert.deepEqual(JSON.parse(JSON.stringify(runnerReconcileRequest(CASE_ID, [{ exchangeId: "exchange-x" }], "exchange-y"))), { caseId: CASE_ID, conversation: "current" }, "a cursor the page doesn't show isn't used");
});

// Each conversation item as [exchange, part, words], the part named by the test itself: the person's message, the provisional reply,
// the emergency line, the reply (a closing notice included) or the line a failed request left.
const pageParts = (therapy) => JSON.parse(JSON.stringify(therapy)).map((entry) => [
  entry.exchangeId ?? null,
  entry.error ? "failure" : entry.role === "user" ? "user" : ["provisional", "emergency_line"].includes(entry.kind) ? entry.kind : "reply",
  entry.content
]);

test("a page whose stream failed gets back what each turn missed, in its place and never twice, and its cursor passes only turns it shows whole", async (t) => {
  const acted = (provisional) => ({ ...quietReader(), level: "acted_or_about_to", reason: "says they took something", provisional_reply: provisional });
  const { base } = await trialServer(t, baseScript({
    // The second message shows a provisional reply; the third's names a number that isn't an emergency number, so the emergency
    // line shows instead.
    R1: (count) => (count === 2 ? acted(PROVISIONAL) : count === 3 ? acted("Please get help now, call 0800 555 0100.") : quietReader()),
    W: (count) => ({ reply: `A synthetic reply ${count}.`, answered_level: "none", quotes: [] })
  }), { settings: EVERY_TURN });
  const [m1, m2, m3] = ["exchange-m1", "exchange-m2", "exchange-m3"];
  for (const [index, exchangeId] of [m1, m2, m3].entries()) assert.equal((await respond(base, { exchangeId, userMessage: `Synthetic message ${index + 1}.` })).lines.at(-1).type, "final", exchangeId);
  const stored = (await ownerPost(base, "/v1/runner/reconcile", { caseId: CASE_ID, conversation: "current" })).json.turns;
  assert.deepEqual(stored.map((turn) => [turn.exchangeId, turn.provisional, turn.emergencyLineShown]), [[m1, null, false], [m2, PROVISIONAL, false], [m3, null, true]]);
  const answer = Object.fromEntries(stored.map((turn) => [turn.exchangeId, turn.answer]));
  assert.ok(Object.values(answer).every((text) => typeof text === "string" && text), "every turn has its answer");

  // The page as its streams left it: the first turn whole; the second's stream broke after its provisional reply came, leaving the
  // failure's line; the third's is still coming in, with only the person's message shown so far.
  const message = (exchangeId, index) => ({ id: `${exchangeId}-user`, exchangeId, role: "user", content: `Synthetic message ${index}.` });
  const FAILED = "Runtime error: The reply stream ended before the reply.";
  const failure = (exchangeId) => ({ role: "assistant", exchangeId, content: FAILED, error: true });
  const page = await reconcilingPage(base, {
    caseId: CASE_ID,
    runnerShownThrough: m1,
    therapy: [
      message(m1, 1), { id: `${m1}-assistant`, exchangeId: m1, role: "assistant", content: answer[m1] },
      message(m2, 2), { role: "assistant", kind: "provisional", exchangeId: m2, content: PROVISIONAL_PREFIX + PROVISIONAL, thinking: false }, failure(m2),
      message(m3, 3)
    ]
  });
  page.runnerTrial.inFlight.add(m3);
  await page.reconcileRunnerCase();
  assert.deepEqual(page.requests[0], { caseId: CASE_ID, afterExchangeId: m1 });
  const first = [
    [m1, "user", "Synthetic message 1."], [m1, "reply", answer[m1]],
    [m2, "user", "Synthetic message 2."], [m2, "provisional", PROVISIONAL_PREFIX + PROVISIONAL], [m2, "failure", FAILED], [m2, "reply", answer[m2]],
    [m3, "user", "Synthetic message 3."]
  ];
  assert.deepEqual(pageParts(page.state.therapy), first, "the second turn gets its reply after the failure's line and its provisional reply only once; the third is left to its stream");
  assert.equal(page.state.runnerShownThrough, m2, "the cursor stops before the turn still coming in");

  // The third turn's stream then failed before anything came: the next reconcile brings its emergency line and its reply.
  page.state.therapy.push(failure(m3));
  page.runnerTrial.inFlight.delete(m3);
  await page.reconcileRunnerCase();
  assert.deepEqual(page.requests[1], { caseId: CASE_ID, afterExchangeId: m2 }, "it asks again from the last turn shown whole");
  const whole = [...first, [m3, "failure", FAILED], [m3, "emergency_line", EMERGENCY_LINE], [m3, "reply", answer[m3]]];
  assert.deepEqual(pageParts(page.state.therapy), whole);
  assert.equal(page.state.runnerShownThrough, m3);

  // Sent back the whole conversation again, a page that shows every part of every turn adds nothing.
  page.state.runnerShownThrough = "exchange-not-on-this-page";
  await page.reconcileRunnerCase();
  assert.deepEqual(page.requests[2], { caseId: CASE_ID, conversation: "current" });
  assert.deepEqual(pageParts(page.state.therapy), whole, "no part is shown twice");
  assert.equal(page.state.runnerShownThrough, m3);
});

test("after a failed stream, the next turn shown whole moves the cursor only once the failed turn shows its reply", async () => {
  const page = await pageBlock();
  const message = (exchangeId) => ({ id: `${exchangeId}-user`, exchangeId, role: "user", content: `Synthetic ${exchangeId}.` });
  const reply = (exchangeId) => ({ id: `${exchangeId}-assistant`, exchangeId, role: "assistant", content: `Synthetic reply ${exchangeId}.` });
  const therapy = [
    message("exchange-a"), reply("exchange-a"),
    message("exchange-b"), { role: "assistant", exchangeId: "exchange-b", content: "Runtime error: synthetic.", error: true },
    message("exchange-c"), reply("exchange-c")
  ];
  assert.equal(page.runnerRepliesShownAfter(therapy, "exchange-a"), false, "the failed turn after the cursor holds it");
  assert.equal(page.runnerRepliesShownAfter(therapy, null), false, "a page without a cursor counts every turn it holds");
  assert.equal(page.runnerRepliesShownAfter(therapy, "exchange-c"), true, "nothing after the newest turn");
  assert.equal(page.mergeRunnerTurn(therapy, { exchangeId: "exchange-b", userMessage: "Synthetic exchange-b.", answer: "Synthetic reply exchange-b.", provisional: null, emergencyLineShown: false }, "2026-11-21T00:00:00.000Z"), true);
  assert.deepEqual(pageParts(therapy).map(([exchangeId, part]) => [exchangeId, part]), [
    ["exchange-a", "user"], ["exchange-a", "reply"],
    ["exchange-b", "user"], ["exchange-b", "failure"], ["exchange-b", "reply"],
    ["exchange-c", "user"], ["exchange-c", "reply"]
  ], "the recovered reply goes into its own turn, before the later one");
  assert.equal(page.runnerRepliesShownAfter(therapy, "exchange-a"), true, "once it shows its reply, the cursor may pass it");
  // The page's own stream: the cursor moves only under that rule, a failure's line belongs to its turn, and a turn coming in is
  // marked as such until it is finished, so a reconcile leaves it to its stream.
  const { app } = await pageSource();
  assert.match(app, /if \(runnerTurn && runnerRepliesShownAfter\(state\.therapy, state\.runnerShownThrough\)\) state\.runnerShownThrough = exchangeId;/u);
  assert.match(app, /state\.therapy\.push\(\{ role: "assistant", exchangeId, content: `Runtime error: \$\{error\.message\}`/u);
  assert.match(app, /runnerTrial\.inFlight\.add\(exchangeId\);/u);
  assert.match(app, /runnerTrial\.inFlight\.delete\(exchangeId\);/u);
  assert.match(app, /state\.runnerShownThrough = showRunnerTurns\(state\.therapy, payload\.turns, state\.runnerShownThrough, runnerTrial\.inFlight\);/u);
});

test("Delete this case removes the case through the route, and the next message starts an empty case", async (t) => {
  const { base, store } = await trialServer(t, baseScript());
  await respond(base, { exchangeId: "exchange-d1", userMessage: "Something synthetic." });
  assert.ok(await store.load(CASE_ID));
  const deleted = await ownerPost(base, "/v1/case/delete", { caseId: CASE_ID, confirmation: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { caseId: CASE_ID, deleted: true, caseFileRemoved: true, handoffsRemoved: 0, journalCorporaRemoved: 0, locatorFilesRemoved: 1, handoffsKept: 0 });
  assert.equal(await store.load(CASE_ID), null);
  const next = await respond(base, { exchangeId: "exchange-d2", userMessage: "Something new and synthetic." }, { stream: false });
  assert.equal(next.json.answer, "A synthetic reply.");
  assert.equal((await store.load(CASE_ID)).runtime_turns.length, 1, "an empty case under the same id");
});

// ---- The page ----------------------------------------------------------------------------------------------------------------

async function pageSource() {
  const [html, app] = await Promise.all(["apps/web/index.html", "apps/web/app.js"].map((relative) => fs.readFile(path.join(repositoryRoot, relative), "utf8")));
  return { html, app };
}

// The page's runner-trial block, run on its own with nothing from the browser but a TextDecoder.
async function pageBlock() {
  const { app } = await pageSource();
  const start = app.indexOf("// runner-trial-page:start");
  const end = app.indexOf("// runner-trial-page:end");
  assert.ok(start > 0 && end > start, "the page marks its runner-trial block");
  const block = app.slice(start, end);
  const exports = vm.runInNewContext(`${block}\n;({ EMERGENCY_LINE, PROVISIONAL_PREFIX, THINKING_LINE, CLOSING_REASONS, readRunnerStream, runnerEventEntry, runnerStoredEntries, runnerReplayEntries, mergeRunnerTurn, showRunnerTurns, runnerRepliesShownAfter, runnerClosingReason, runnerProgressText, runnerReconcileRequest, forgetDeletedCase, PAGE_STATE_KEPT_AFTER_DELETION, runnerCaseToAdopt, adoptRunnerCase, PAGE_STATE_KEPT_ON_ADOPTION, runnerArrangementText })`, { TextDecoder });
  return { block, ...exports };
}

test("the page's fixed words are byte-identical to the server's", async () => {
  const page = await pageBlock();
  const same = (a, b, name) => {
    assert.equal(typeof a, "string", name);
    assert.ok(Buffer.from(a, "utf8").equals(Buffer.from(b, "utf8")), name);
  };
  same(page.EMERGENCY_LINE, EMERGENCY_LINE, "EMERGENCY_LINE");
  same(page.PROVISIONAL_PREFIX, PROVISIONAL_PREFIX, "PROVISIONAL_PREFIX");
  same(page.THINKING_LINE, THINKING_LINE, "THINKING_LINE");
  assert.deepEqual(Object.keys(page.CLOSING_REASONS), Object.keys(CLOSING_REASONS));
  for (const [code, words] of Object.entries(CLOSING_REASONS)) same(page.CLOSING_REASONS[code], words, `CLOSING_REASONS.${code}`);
});

test("the page reads the stream line by line across chunks, and shows the provisional reply, the emergency line and a closing's reason in the fixed words", async () => {
  const page = await pageBlock();
  const encoder = new TextEncoder();
  const responseOf = (text, cuts) => {
    const bytes = encoder.encode(text);
    const chunks = [];
    let at = 0;
    for (const cut of [...cuts, bytes.length]) { chunks.push(bytes.slice(at, cut)); at = cut; }
    return { body: { getReader: () => ({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { value: undefined, done: true }) }) } };
  };
  const lines = [
    { type: "status", step: "reading" },
    { type: "provisional", text: "Ruf jetzt 112 an — ich bin da." },
    { type: "emergency_line", reason: "turn_closed_without_reply" },
    { type: "final", answer: "A synthetic reply.", closing: { kind: "runner_unavailable", reason_code: "timeout" } }
  ];
  const text = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  // Cut inside lines, and twice inside the three bytes of the dash.
  const dash = encoder.encode(text).findIndex((byte, index, all) => byte === 0xe2 && all[index + 1] === 0x80);
  const seen = [];
  const final = await page.readRunnerStream(responseOf(text, [7, dash + 1, dash + 2, 120]), (event) => seen.push(JSON.parse(JSON.stringify(event))));
  assert.deepEqual(seen, lines.slice(0, 3));
  assert.equal(final.answer, "A synthetic reply.");
  assert.equal(page.runnerClosingReason(final.closing), CLOSING_REASONS.timeout);
  assert.equal(page.runnerClosingReason({ reason_code: "constructor" }), "", "only the known reasons");

  const provisional = page.runnerEventEntry(seen[1], "exchange-x", "2026-11-21T00:00:00.000Z");
  assert.equal(provisional.content, PROVISIONAL_PREFIX + "Ruf jetzt 112 an — ich bin da.");
  assert.deepEqual([provisional.role, provisional.kind, provisional.thinking], ["assistant", "provisional", true]);
  const line = page.runnerEventEntry(seen[2], "exchange-x");
  assert.deepEqual([line.kind, line.content], ["emergency_line", EMERGENCY_LINE]);
  assert.equal(page.runnerEventEntry(seen[0], "exchange-x"), null, "a status line adds nothing to the conversation");
  assert.equal(page.runnerProgressText("checking", 1_000, 13_500), "Writing and checking a reply… checking · 12 s");

  // An error line is thrown with the server's safe message, and a stream with no last line is an error.
  await assert.rejects(page.readRunnerStream(responseOf(`${JSON.stringify({ type: "error", error: "InnerSignal could not safely complete this request.", code: "X" })}\n`, []), () => {}), (error) => error.message === "InnerSignal could not safely complete this request.");
  await assert.rejects(page.readRunnerStream(responseOf(`${JSON.stringify({ type: "status", step: "reading" })}\n`, []), () => {}), (error) => error.message === "The reply stream ended before the reply.");
});

test("a JSON answer, a replay or a reloaded page shows what the stored turn showed, as the live events would", async () => {
  const page = await pageBlock();
  const at = "2026-11-21T00:00:00.000Z";
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const stored = { provisional: "Ruf jetzt 112 an.", emergencyLineShown: true };
  const entries = plain(page.runnerStoredEntries(stored, "exchange-x", [], at));
  assert.deepEqual(entries, [
    { role: "assistant", kind: "provisional", exchangeId: "exchange-x", content: PROVISIONAL_PREFIX + "Ruf jetzt 112 an.", thinking: false, at },
    { role: "notice", kind: "emergency_line", exchangeId: "exchange-x", content: EMERGENCY_LINE, at }
  ]);
  assert.deepEqual(plain(page.runnerStoredEntries(stored, "exchange-x", ["provisional"], at)).map((entry) => entry.kind), ["emergency_line"], "what the live events added isn't added twice");
  assert.deepEqual(plain(page.runnerStoredEntries({ provisional: null, emergencyLineShown: false }, "exchange-x", [], at)), []);
  const replay = plain(page.runnerReplayEntries({ exchangeId: "exchange-y", userMessage: "A synthetic message.", answer: RUNNER_UNAVAILABLE_NOTICE, closing: { kind: "runner_unavailable", reason_code: "interrupted" }, provisional: null, emergencyLineShown: true }, at));
  assert.deepEqual(replay.map((entry) => [entry.role, entry.kind ?? null, entry.content]), [
    ["user", null, "A synthetic message."],
    ["notice", "emergency_line", EMERGENCY_LINE],
    ["assistant", "closing", RUNNER_UNAVAILABLE_NOTICE]
  ]);
  assert.equal(replay[2].closingReason, CLOSING_REASONS.interrupted);
  const { app } = await pageSource();
  assert.match(app, /runnerTurn\?\.finish\(result\)/u, "the answer's stored fields reach the page");
  assert.match(app, /"\/v1\/runner\/reconcile"/u);
  assert.match(app, /if \(runnerTrial\.on\) await reconcileRunnerCase\(\);/u, "the page reconciles when it loads");
  assert.match(app, /"\/v1\/case\/delete"/u);
  assert.match(app, /typed\.trim\(\) !== "DELETE"/u, "deleting needs the typed DELETE");
  assert.match(app, /confirmation: "DELETE"/u);
});

test("the page's trial parts are hidden until /health says on, send for the stream, and never set text as HTML", async () => {
  const { html, app } = await pageSource();
  assert.match(html, /id="runner-delete-case"[^>]*>Delete this case</u);
  for (const id of ["runner-trial-banner", "runner-emergency-line", "runner-new-conversation", "runner-progress", "runner-delete-case"]) {
    assert.match(html, new RegExp(`<[a-z]+ id="${id}"[^>]*\\shidden[\\s>]`, "u"), `${id} is hidden by default`);
  }
  assert.match(html, /id="runner-trial-banner"[^>]*>Runner trial</u);
  assert.match(html, /id="runner-new-conversation"[^>]*>New conversation</u);
  const form = html.slice(html.indexOf('<form id="therapy-form"'), html.indexOf("</form>", html.indexOf('<form id="therapy-form"')));
  assert.ok(form.indexOf('id="runner-emergency-line"') >= 0 && form.indexOf('id="runner-emergency-line"') > form.indexOf('id="therapy-send"'), "the line is below the message box and send button");
  assert.match(app, /applyRunnerTrial\(health\.runnerTrial === "on"\)/u);
  assert.match(app, /"accept": "application\/x-ndjson"/u);
  assert.match(app, /response\.body\.getReader\(\)/u);
  assert.match(app, /newConversation: true/u);
  const trialCode = app.slice(app.indexOf("// ---- Runner trial"), app.indexOf("function loadState()"));
  assert.ok(trialCode.length > 1_000);
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/u.test(trialCode), false, "text goes in with textContent");
});

test("a page holding another case than the trial's takes the trial's: its settings stay, and every other field is a fresh page's for that case", async () => {
  const page = await pageBlock();
  const health = { runnerTrial: "on", runnerCaseId: SYNTHETIC_TRIAL_CASE };
  assert.equal(page.runnerCaseToAdopt(health, SYNTHETIC_PAGE_CASE), SYNTHETIC_TRIAL_CASE);
  assert.equal(page.runnerCaseToAdopt(health, SYNTHETIC_TRIAL_CASE), null, "the page's own case stays");
  assert.equal(page.runnerCaseToAdopt({ ...health, runnerTrial: "off" }, SYNTHETIC_PAGE_CASE), null, "only with the trial on");
  assert.equal(page.runnerCaseToAdopt({ runnerTrial: "on" }, SYNTHETIC_PAGE_CASE), null, "only a case /health names");
  for (const named of ["synthetic-invalid-value", SYNTHETIC_TRIAL_CASE.toUpperCase(), "constructor", 42, null, [SYNTHETIC_TRIAL_CASE]]) {
    assert.equal(page.runnerCaseToAdopt({ runnerTrial: "on", runnerCaseId: named }, SYNTHETIC_PAGE_CASE), null, JSON.stringify(named));
  }
  assert.deepEqual([...page.PAGE_STATE_KEPT_ON_ADOPTION], ["settings", "legacyPrivateDataDetected"]);
  const empty = { therapy: [], settings: {}, caseId: "case-fresh", runnerShownThrough: null, privateStorageMode: "unknown", legacyPrivateDataDetected: false, trackerEntries: [], lastHandoffId: null };
  const state = { therapy: [{ role: "user", content: "A synthetic message." }], settings: { synthetic: "kept" }, caseId: SYNTHETIC_PAGE_CASE, runnerShownThrough: "exchange-old", privateStorageMode: "encrypted", legacyPrivateDataDetected: true, trackerEntries: [{ synthetic: true }], lastHandoffId: "handoff:synthetic", fieldAddedLater: "synthetic" };
  page.adoptRunnerCase(state, empty, SYNTHETIC_TRIAL_CASE);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), { ...empty, settings: { synthetic: "kept" }, legacyPrivateDataDetected: true, caseId: SYNTHETIC_TRIAL_CASE });
});

test("with the trial on, the badge shows who reads, writes and checks, from /health's arrangement, in fixed words", async () => {
  const page = await pageBlock();
  const mixed = { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] };
  assert.equal(page.runnerArrangementText(mixed), "Runner trial: readers on Claude · whole writer on GPT · one whole checker on Claude");
  assert.equal(page.runnerArrangementText({ writerMode: "focused", checkerMode: "split", readers: ["claude", "codex"], writer: ["claude"], checkers: ["codex"] }), "Runner trial: readers on Claude + GPT · focused writer on Claude · split checkers on GPT");
  for (const unreadable of [null, undefined, {}, { ...mixed, writerMode: "constructor" }, { ...mixed, checkerMode: "__proto__" }, { ...mixed, readers: ["<b>synthetic</b>"] }, { ...mixed, writer: [] }, { ...mixed, checkers: "claude" }]) {
    assert.equal(page.runnerArrangementText(unreadable), "Runner trial", JSON.stringify(unreadable));
  }
});

// The page's health check (checkHealth), run on its own with the runner-trial block and the page's empty state, and the rest of the
// page stood in for: what it shows on its badge, and whether it takes /health's case before its reconcile.
async function healthCheckingPage(health, initial) {
  const { app } = await pageSource();
  const block = app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end"));
  const emptyStart = app.indexOf("function emptyPageState()");
  const emptyEnd = app.indexOf("function loadState()", emptyStart);
  const start = app.indexOf("async function checkHealth()");
  const end = app.indexOf("for (const button of $$(\".tab\"))", start);
  assert.ok(emptyStart > 0 && emptyEnd > emptyStart && start > 0 && end > start, "the page has its empty state and its health check");
  const calls = [];
  const elements = { "#runtime-status": { className: "", textContent: "" }, "#runtime-version": { textContent: "" } };
  const runnerTrial = { on: false };
  const context = vm.createContext({
    TextDecoder,
    crypto: globalThis.crypto,
    state: {},
    runnerTrial,
    $: (selector) => elements[selector] ?? null,
    fetch: async (url) => ({ ok: true, json: async () => (url === "/health" ? structuredClone(health) : {}) }),
    applyRunnerTrial: (on) => { runnerTrial.on = on; },
    applyRunnerKeptPlan: () => {},
    applyRunnerFeedbackLink: () => {},
    reconcileRunnerCase: async () => { calls.push(["reconcile", context.state.caseId, JSON.stringify(context.state.settings), context.state.therapy.length, context.state.runnerShownThrough]); },
    supervisorPanel: { clear: () => calls.push(["supervisorPanel.clear"]) },
    saveState: () => calls.push(["saveState", context.state.caseId]),
    renderTherapy: () => calls.push(["renderTherapy"]),
    getJson: async (url) => { calls.push(["getJson", url]); return {}; },
    renderCaseState: () => {},
    renderHandoffStatus: () => {}
  });
  vm.runInContext(`${block}\n${app.slice(emptyStart, emptyEnd)}\n${app.slice(start, end)}`, context);
  Object.assign(context.state, vm.runInContext("emptyPageState()", context), initial);
  await vm.runInContext("checkHealth()", context);
  return { state: context.state, calls, badge: elements["#runtime-status"].textContent };
}

test("when it loads with the trial on, the page takes the case /health names before its reconcile, and its badge shows the arrangement", async () => {
  const arrangement = { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] };
  const health = { ok: true, version: "0.0.0", models: { anthropic: "mock-anthropic", openai: "mock-openai" }, therapy: { graphBundleVersion: "synthetic-graph" }, runnerTrial: "on", runnerKeptPlan: "off", runnerFeedbackLink: "off", runnerCaseId: SYNTHETIC_TRIAL_CASE, runnerArrangement: arrangement, privateCaseStorage: { available: true } };
  // A fresh browser: the page made up its own case; its settings stay.
  const fresh = await healthCheckingPage(health, { caseId: SYNTHETIC_PAGE_CASE, settings: { synthetic: "kept" }, runnerShownThrough: "exchange-of-another-case" });
  assert.equal(fresh.badge, "Runner trial: readers on Claude · whole writer on GPT · one whole checker on Claude");
  assert.deepEqual(fresh.calls.map(([name]) => name), ["supervisorPanel.clear", "saveState", "renderTherapy", "reconcile", "getJson"]);
  assert.deepEqual(fresh.calls.find(([name]) => name === "saveState"), ["saveState", SYNTHETIC_TRIAL_CASE], "the case is saved before the reconcile");
  assert.deepEqual(fresh.calls.find(([name]) => name === "reconcile"), ["reconcile", SYNTHETIC_TRIAL_CASE, JSON.stringify({ synthetic: "kept" }), 0, null], "the reconcile asks for the trial's case, with the settings and nothing of the other case");
  assert.deepEqual(fresh.calls.at(-1), ["getJson", `/v1/case/state?caseId=${SYNTHETIC_TRIAL_CASE}`]);
  // A page that already holds the trial's case keeps everything.
  const same = await healthCheckingPage(health, { caseId: SYNTHETIC_TRIAL_CASE, settings: { synthetic: "kept" }, runnerShownThrough: "exchange-shown" });
  assert.deepEqual(same.calls.map(([name]) => name), ["reconcile", "getJson"]);
  assert.equal(same.state.runnerShownThrough, "exchange-shown");
  // With the trial off, nothing is taken and the badge shows the usual app's models.
  const off = await healthCheckingPage({ ...health, runnerTrial: "off" }, { caseId: SYNTHETIC_PAGE_CASE });
  assert.equal(off.badge, "mock-anthropic + mock-openai · synthetic-graph");
  assert.deepEqual(off.calls.map(([name]) => name), ["getJson"]);
  assert.equal(off.state.caseId, SYNTHETIC_PAGE_CASE);
});

test("with the trial on, the page hides the usual app's pipeline sentences and its reasoning-depth menu, and keeps \"not emergency care\"", async (t) => {
  const { html, app } = await pageSource();
  const css = await fs.readFile(path.join(repositoryRoot, "apps/web/styles.css"), "utf8");
  assert.match(css, /\.therapy-controls label\[hidden\] \{ display: none; \}/u, "a hidden label stays hidden whatever .composer label sets");
  assert.match(css, /\.dev-automation\[hidden\] \{ display: none; \}/u, "the hidden development panel stays hidden whatever .dev-automation sets");
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const block = app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end"));
  const start = app.indexOf("const runnerTrial = {");
  const end = app.indexOf("// The trial page's link to InnerSignal's feedback page", start);
  assert.ok(start > 0 && end > start, "the page has its trial switch");
  const context = vm.createContext({ TextDecoder, $: (selector) => document.querySelector(selector) });
  vm.runInContext(`${block}\n${app.slice(start, end)}`, context);
  const description = document.querySelector("#therapy-pipeline-description");
  const depth = document.querySelector("#therapy-processing-mode-label");
  assert.match(description.textContent, /fast Sonnet/u);
  assert.ok(depth.contains(document.querySelector("#therapy-processing-mode")));
  const development = document.querySelector("#dev-automation");
  assert.deepEqual([description.hidden, depth.hidden, development.hidden], [false, false, false], "the usual app shows them");
  vm.runInContext("applyRunnerTrial(true)", context);
  assert.deepEqual([description.hidden, depth.hidden, development.hidden], [true, true, true], "the development panel too");
  assert.equal(description.parentElement.firstChild.textContent, "This is a reflective companion, not emergency care.", "that sentence stays");
  assert.equal(document.querySelector("#therapy-processing-mode").value, "auto", "a message still sends the default");
  vm.runInContext("applyRunnerTrial(false)", context);
  assert.deepEqual([description.hidden, depth.hidden, development.hidden], [false, false, false]);
});

test("after Delete this case the page holds nothing of the case: not in its state (so not in its backup export), not on screen, not in its forms", async (t) => {
  const { html, app } = await pageSource();
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const SECRET = "synthetic-private";
  const state = {
    therapy: [
      { id: "exchange-1-user", exchangeId: "exchange-1", role: "user", content: `${SECRET} message` },
      { id: "exchange-1-assistant", exchangeId: "exchange-1", role: "assistant", content: `${SECRET} reply`, feedback: { rating: "good", note: `${SECRET} feedback` } }
    ],
    hypnosisHistory: [{ target: `${SECRET} target`, selectedRouteText: `${SECRET} session` }],
    settings: { synthetic: "kept" },
    caseId: "case-synthetic-deleted",
    runnerShownThrough: "exchange-1",
    caseSnapshot: { note: `${SECRET} snapshot` },
    interventionContract: { note: `${SECRET} contract` },
    priorProcessingTier: "deep",
    durableCaseState: { note: `${SECRET} state` },
    caseStateView: { note: `${SECRET} view` },
    lastStateDiff: { note: `${SECRET} diff` },
    trackerEntries: [{ id: "tracker-1", stressors_events: [`${SECRET} tracker`] }],
    journalEntries: [{ id: "journal-1", text: `${SECRET} journal` }],
    lastHandoffId: "handoff:00000000-0000-4000-8000-0000000000d1",
    handoffStatus: { handoff_id: "handoff:00000000-0000-4000-8000-0000000000d1", note: `${SECRET} handoff` },
    privateStorageMode: "encrypted",
    legacyPrivateDataDetected: false,
    // A field a later change adds is the case's too.
    laterField: { note: `${SECRET} later field` }
  };
  // What the page shows of the case and what its forms hold.
  document.querySelector("#hypnosis-result").hidden = false;
  document.querySelector("#hypnosis-gate").hidden = false;
  document.querySelector("#hypnosis-route").hidden = false;
  for (const id of ["#hypnosis-pre-gate", "#gate-title", "#gate-intro", "#gate-note", "#hypnosis-route"]) document.querySelector(id).textContent = `${SECRET} ${id}`;
  const routeButton = document.createElement("button");
  routeButton.textContent = `${SECRET} route label`;
  document.querySelector("#gate-actions").append(routeButton);
  for (const id of ["#therapy-message", "#journal-text", "#tracker-note", "#hypnosis-context", "#supervisor-input-text", "#supervisor-draft-text", "#supervisor-companion-text"]) document.querySelector(id).value = `${SECRET} ${id}`;
  // The real supervisor panel, showing the case.
  const { initSupervisorPanel } = await import("../apps/web/supervisor-panel.js");
  const snapshot = {
    basis: { sha256: "a".repeat(64) },
    latest_client_turn: { text: `${SECRET} client message` },
    owner_supplied_inputs: [{ input_type: "client_message", text: `${SECRET} relayed input`, supplied_by: { actor_resolution: "owner_verified" } }],
    artifacts: []
  };
  const supervisorPanel = initSupervisorPanel({ document, getCaseId: () => state.caseId, fetchImpl: async () => new Response(JSON.stringify(snapshot), { status: 200 }), newKey: () => "synthetic-key" });
  await supervisorPanel.refresh();
  assert.ok(document.body.textContent.includes(`${SECRET} client message`), "the panel showed the case");

  // The page's deletion, as the page runs it, with the server answering that the case was deleted.
  const block = app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end"));
  const emptyStart = app.indexOf("function emptyPageState()");
  const emptyEnd = app.indexOf("function loadState()", emptyStart);
  const start = app.indexOf("function clearDeletedCase()");
  const end = app.indexOf('$("#clear-therapy").addEventListener', start);
  assert.ok(emptyStart > 0 && emptyEnd > emptyStart && start > 0 && end > start, "the page has its empty state and its deletion");
  let handler = null;
  const calls = [];
  const spy = (name) => () => { calls.push({ name, state: JSON.stringify(state) }); };
  const context = vm.createContext({
    TextDecoder,
    crypto: globalThis.crypto,
    state,
    runnerTrial: { on: true, newConversation: true },
    currentPlan: { target: `${SECRET} plan` },
    selectedRouteText: `${SECRET} selected route`,
    speechPlayback: { stop: spy("speechPlayback.stop") },
    supervisorPanel,
    $: (selector) => (selector === "#runner-delete-case" ? { addEventListener: (_type, listener) => { handler = listener; } } : document.querySelector(selector)),
    prompt: () => "DELETE",
    setBusy: () => {},
    fetch: async () => ({ ok: true, json: async () => ({ caseId: state.caseId, deleted: true, handoffsKept: 0 }) }),
    alert: spy("alert"),
    syncRunnerNewConversation: spy("syncRunnerNewConversation"),
    // The plan kept for next time: the page's question and its kept-plan line are cleared with the case.
    showRunnerResume: spy("showRunnerResume"),
    setRunnerKeptPlanStatus: spy("setRunnerKeptPlanStatus"),
    syncSpeechPlaybackControls: spy("syncSpeechPlaybackControls"),
    saveState: spy("saveState"),
    renderTherapy: spy("renderTherapy"),
    renderCaseState: spy("renderCaseState"),
    renderHandoffStatus: spy("renderHandoffStatus")
  });
  vm.runInContext(`${block}\n${app.slice(emptyStart, emptyEnd)}\n${app.slice(start, end)}`, context);
  assert.equal(typeof handler, "function");
  await handler();

  // The state: nothing of the case, so the backup export (the whole state) and the recovery ZIP hold none of it.
  const backup = JSON.stringify({ format: "inner-signal-backup-v1", exportedAt: "2026-11-21T00:00:00.000Z", state });
  assert.equal(backup.includes(SECRET), false, backup);
  assert.equal(backup.includes("exchange-1"), false);
  assert.equal(backup.includes("handoff:"), false);
  const empty = vm.runInContext("emptyPageState()", context);
  assert.deepEqual(Object.keys(state).sort(), Object.keys(empty).sort(), "every field the page uses, and no other");
  assert.deepEqual(JSON.parse(JSON.stringify(state.therapy)).map((entry) => [entry.kind, entry.content]), [["divider", "This case was deleted"]]);
  assert.deepEqual([state.caseId, JSON.stringify(state.settings), state.privateStorageMode], ["case-synthetic-deleted", JSON.stringify({ synthetic: "kept" }), "encrypted"], "the case id, the settings and the storage mode stay");
  assert.deepEqual([state.trackerEntries.length, state.journalEntries.length, state.hypnosisHistory.length, state.runnerShownThrough, state.lastHandoffId], [0, 0, 0, null, null]);
  // The page's own variables, its screen and its forms.
  assert.deepEqual([context.currentPlan, context.selectedRouteText, context.runnerTrial.newConversation], [null, "", false]);
  assert.equal(document.body.textContent.includes(SECRET), false, "nothing of the case on screen");
  const typed = [...document.querySelectorAll("input, textarea")].filter((field) => field.value.includes(SECRET)).map((field) => field.id);
  assert.deepEqual(typed, [], "nothing of the case in a form");
  assert.equal(document.querySelector("#supervisor-client-message").textContent, "Not loaded.");
  assert.deepEqual(["#hypnosis-result", "#hypnosis-gate", "#hypnosis-route"].map((id) => document.querySelector(id).hidden), [true, true, true]);
  // The transcript, the case views and the handoff status are drawn again from that state, and it is saved.
  for (const name of ["saveState", "renderTherapy", "renderCaseState", "renderHandoffStatus", "speechPlayback.stop", "showRunnerResume", "setRunnerKeptPlanStatus"]) {
    const call = calls.find((entry) => entry.name === name);
    assert.ok(call, `${name} ran`);
    assert.equal(call.state.includes(SECRET), false, `${name} ran on the cleared state`);
  }
  assert.equal(calls.some((entry) => entry.name === "alert"), false);
});

test("a request the supervisor panel made before Delete this case cleared it shows, keeps and copies nothing of the deleted case when it answers", async (t) => {
  const { html } = await pageSource();
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const SECRET = "synthetic-deleted";
  const artifact = { artifact_id: `art_${"3".repeat(40)}`, status: "approved_for_delivery", source: "external_draft", approved: true, fresh: true, exportable: true, stale_reasons: [], not_approved_reasons: [], delivery: { exported: { at: "2026-11-21T00:00:00.000Z" }, reported_sent: null }, companion: null };
  const snapshot = {
    basis: { sha256: "b".repeat(64) },
    latest_client_turn: { text: `${SECRET} client message` },
    owner_supplied_inputs: [{ input_type: "client_message", text: `${SECRET} relayed input`, supplied_by: { actor_resolution: "owner_verified" } }],
    artifacts: [artifact]
  };
  // Every request waits until the test answers it.
  const pending = [];
  const fetchImpl = (url, init) => new Promise((resolve) => { pending.push({ url, body: JSON.parse(init.body), resolve }); });
  const take = (url, predicate = () => true) => {
    const index = pending.findIndex((request) => request.url === url && predicate(request.body));
    assert.ok(index >= 0, `a request to ${url} on its way`);
    return pending.splice(index, 1)[0];
  };
  const answer = (request, payload) => request.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
  const settle = async () => { for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
  const written = [];
  globalThis.confirm = () => true;
  t.after(() => { delete globalThis.confirm; });
  const { initSupervisorPanel, SUPERVISOR_ENDPOINTS } = await import("../apps/web/supervisor-panel.js");
  const panel = initSupervisorPanel({ document, getCaseId: () => "case-synthetic-deleted", fetchImpl, clipboard: { async writeText(value) { written.push(value); } }, newKey: () => "synthetic-key" });
  const loaded = panel.refresh();
  answer(take(SUPERVISOR_ENDPOINTS.prepare), snapshot);
  await loaded;
  assert.ok(document.body.textContent.includes(`${SECRET} client message`), "the panel showed the case");

  // One request of every kind the panel makes, each still on its way when the case is deleted and the page clears the panel.
  const refreshing = panel.refresh();
  document.getElementById("supervisor-input-text").value = "Synthetic owner instruction.";
  document.getElementById("supervisor-input-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  document.getElementById("supervisor-draft-text").value = "Synthetic draft.";
  document.getElementById("supervisor-draft-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  const buttons = [...document.querySelectorAll("#supervisor-artifacts button")];
  buttons.find((button) => button.textContent === "Copy approved text").click();
  buttons.find((button) => button.textContent === "I sent this").click();
  assert.equal(pending.length, 5, "a refresh, a relayed input, a draft, a copy and a report on their way");
  panel.clear();

  // Each answers with the deleted case's words.
  answer(take(SUPERVISOR_ENDPOINTS.prepare, (body) => !body.inputs), snapshot);
  answer(take(SUPERVISOR_ENDPOINTS.prepare, (body) => Array.isArray(body.inputs)), snapshot);
  answer(take(SUPERVISOR_ENDPOINTS.submit), { notice: `${SECRET} notice`, exportable: true });
  answer(take(SUPERVISOR_ENDPOINTS.export), { client_text: `${SECRET} approved text`, companion: { language: "de", text: `${SECRET} companion` } });
  answer(take(SUPERVISOR_ENDPOINTS.report), { recorded: true });
  await refreshing;
  await settle();
  assert.equal(document.body.textContent.includes(SECRET), false, "nothing of the deleted case on screen");
  assert.equal(document.getElementById("supervisor-client-message").textContent, "Not loaded.");
  assert.equal(document.getElementById("supervisor-status").textContent, "Open this tab to load the case.");
  assert.deepEqual(written, [], "nothing on the clipboard");
  assert.equal(pending.length, 0, "no answer for the deleted case led to another request");

  // Nor was anything of it kept: a draft written next has no basis from the deleted case, and a draft with an old draft's id shows
  // no copied text or companion.
  document.getElementById("supervisor-write-draft").click();
  assert.equal(take(SUPERVISOR_ENDPOINTS.submit).body.basisSha256, null, "no basis of the deleted case");
  const next = panel.refresh();
  answer(take(SUPERVISOR_ENDPOINTS.prepare), { basis: { sha256: "c".repeat(64) }, latest_client_turn: null, owner_supplied_inputs: [], artifacts: [artifact] });
  await next;
  assert.equal(document.querySelectorAll("#supervisor-artifacts .supervisor-artifact").length, 1);
  assert.equal(document.body.textContent.includes(SECRET), false, "no copied text or companion of the deleted case was kept");
});
