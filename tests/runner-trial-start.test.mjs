import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNNER_ROLES, loadRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { DEFAULT_PORT, nodeForServer, parseArguments, prepareTrialFolder, serverEnvironment, trialSettings } from "../scripts/runner-trial-start.mjs";

// The runner trial's start command (scripts/runner-trial-start.mjs, docs/RUNNER-TRIAL.md): its arguments, the settings and the
// environment it gives the server, the folder, vault and credentials it makes, and one real start on loopback. No model is called:
// no message is ever sent, and the one server started gets a stand-in for the Codex command.

const script = fileURLToPath(new URL("../scripts/runner-trial-start.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const SCOPES = ["case:read", "case:write", "case:audit"];
const SYNTHETIC_CASE = "case-00000000-0000-4000-8000-000000000000";

async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const mode = async (file) => (await fs.stat(file)).mode & 0o777;
const refusedWith = (exitCode, pattern) => (error) => error?.exitCode === exitCode && pattern.test(error.message);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

function run(args, { env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

async function authorize(credentialsPath, token, caseId, requiredScope) {
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  try { return (await providers.authorizationProvider.authorize({ caseId, authContext: { bearerToken: token }, requiredScope })).allowed; }
  finally { providers.close(); }
}

test("the provider must be chosen, as mixed, codex or claude; the port, the folder and the switches are checked strictly", () => {
  assert.throws(() => parseArguments([]), refusedWith(2, /Choose the provider: --provider mixed/u));
  assert.throws(() => parseArguments(["--provider", "gemini"]), refusedWith(2, /--provider must be mixed, codex or claude\./u));
  assert.throws(() => parseArguments(["--provider"]), refusedWith(2, /--provider needs a value\./u));
  assert.throws(() => parseArguments(["--provider", "codex", "--provider", "claude"]), refusedWith(2, /given twice/u));
  assert.throws(() => parseArguments(["--provider", "codex", "--port", "80"]), refusedWith(2, /--port must be a whole number from 1024 to 65535\./u));
  assert.throws(() => parseArguments(["--provider", "codex", "--port", "8797x"]), refusedWith(2, /--port/u));
  assert.throws(() => parseArguments(["--provider", "codex", "--dir", "relative/folder"]), refusedWith(2, /--dir must be an absolute path\./u));
  assert.throws(() => parseArguments(["--provider", "codex", "--kept-plan=yes"]), refusedWith(2, /takes no value/u));
  assert.throws(() => parseArguments(["--provider", "codex", "--number-now=on"]), refusedWith(2, /--number-now takes no value/u));
  assert.throws(() => parseArguments(["--provider", "codex", "--number-now", "--number-now"]), refusedWith(2, /--number-now is given twice/u));
  assert.throws(() => parseArguments(["--provider", "codex", "--synthetic-unknown"]), refusedWith(2, /Unknown argument: --synthetic-unknown/u));
  // The fixed message after the plan's limit, the sign-in or the time extends the owner's fixed message: refused without its flag.
  assert.throws(() => parseArguments(["--provider", "codex", "--fixed-message-on-failure"]), refusedWith(2, /--fixed-message-on-failure extends the owner's fixed message: give --owner-fallback too\./u));
  assert.throws(() => parseArguments(["--provider", "codex", "--owner-fallback", "--fixed-message-on-failure=on"]), refusedWith(2, /--fixed-message-on-failure takes no value/u));
  assert.throws(() => parseArguments(["--provider", "codex", "--owner-fallback", "--fixed-message-on-failure", "--fixed-message-on-failure"]), refusedWith(2, /--fixed-message-on-failure is given twice/u));
  assert.throws(() => parseArguments(["--help"]), refusedWith(0, /^Usage: node scripts\/runner-trial-start\.mjs/u));
  assert.deepEqual({ ...parseArguments(["--provider", "codex"]) }, { provider: "codex", port: DEFAULT_PORT, dir: null, keptPlan: false, numberNow: false, feedbackLink: false, ownerFallback: false, fixedMessageOnFailure: false, prepareOnly: false });
  assert.equal(parseArguments(["--provider", "mixed"]).provider, "mixed");
  assert.deepEqual({ ...parseArguments(["--provider=claude", "--port=9100", "--dir", "/synthetic/trial", "--kept-plan", "--number-now", "--feedback-link", "--owner-fallback", "--prepare-only"]) },
    { provider: "claude", port: 9100, dir: "/synthetic/trial", keptPlan: true, numberNow: true, feedbackLink: true, ownerFallback: true, fixedMessageOnFailure: false, prepareOnly: true });
  assert.deepEqual({ ...parseArguments(["--provider", "codex", "--fixed-message-on-failure", "--owner-fallback"]) },
    { provider: "codex", port: DEFAULT_PORT, dir: null, keptPlan: false, numberNow: false, feedbackLink: false, ownerFallback: true, fixedMessageOnFailure: true, prepareOnly: false }, "in either order");
});

test("the settings are the whole writer with one whole checker, and every role's worker is on the provider the choice gives it", () => {
  const effort = (role) => (role.startsWith("W") ? "medium" : "low");
  const codex = trialSettings("codex");
  assert.deepEqual([codex.writerMode, codex.checkerMode], ["whole", "whole"]);
  assert.deepEqual(Object.keys(codex.workers).sort(), [...RUNNER_ROLES].sort(), "no role is left to the app's default worker");
  for (const role of RUNNER_ROLES) assert.deepEqual(codex.workers[role], { provider: "codex", effort: effort(role) }, `${role}: Codex picks its own model`);
  const claude = trialSettings("claude");
  for (const role of RUNNER_ROLES) {
    const model = role.startsWith("R") ? "claude-sonnet-5-5" : "claude-opus-5-5";
    assert.deepEqual(claude.workers[role], { provider: "claude", model, effort: effort(role) }, role);
  }
  // mixed: every reader and checker on Claude (the models as for claude), the writer and its repair on GPT.
  const mixed = trialSettings("mixed");
  assert.deepEqual([mixed.writerMode, mixed.checkerMode], ["whole", "whole"]);
  for (const role of RUNNER_ROLES) {
    const expected = role.startsWith("W") ? { provider: "codex", effort: "medium" } : { provider: "claude", model: role.startsWith("R") ? "claude-sonnet-5-5" : "claude-opus-5-5", effort: "low" };
    assert.deepEqual(mixed.workers[role], expected, role);
  }
});

test("the server gets exactly the trial's settings: the shell's InnerSignal settings are dropped and every switch is off unless its flag is given", () => {
  const base = {
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    CODEX_COMMAND: "/synthetic/bin/codex",
    INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: "/synthetic/usual-app/credentials.json",
    INNER_SIGNAL_PRIVATE_ROOT: "/synthetic/usual-app/vault",
    INNER_SIGNAL_RUNNER_KEPT_PLAN: "on",
    INNER_SIGNAL_RUNNER_NUMBER_NOW: "on",
    INNER_SIGNAL_RUNNER_FEEDBACK_LINK: "on",
    INNER_SIGNAL_OWNER_FALLBACK: "true",
    INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE: "on",
    INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR: "/synthetic/inherited-claude",
    INNER_SIGNAL_MODE: "cli",
    LEDGER_MODE: "full"
  };
  const common = { base, port: 9123, credentialsPath: "/synthetic/trial/credentials.json", settingsPath: "/synthetic/trial/settings-codex.json", token: "synthetic-token", caseId: SYNTHETIC_CASE };
  const codex = serverEnvironment({ ...common, provider: "codex" });
  assert.deepEqual(Object.fromEntries(Object.entries(codex).filter(([key]) => key.startsWith("INNER_SIGNAL_"))), {
    INNER_SIGNAL_MODE: "mock",
    INNER_SIGNAL_PRIVATE_RUNTIME_MODE: "development",
    INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: "/synthetic/trial/credentials.json",
    INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: "synthetic-token",
    INNER_SIGNAL_RUNNER_TRIAL: "on",
    INNER_SIGNAL_RUNNER_TRIAL_SETTINGS: "/synthetic/trial/settings-codex.json",
    INNER_SIGNAL_RUNNER_TRIAL_CASE_ID: SYNTHETIC_CASE,
    INNER_SIGNAL_RUNNER_KEPT_PLAN: "off",
    INNER_SIGNAL_RUNNER_NUMBER_NOW: "off",
    INNER_SIGNAL_RUNNER_FEEDBACK_LINK: "off",
    INNER_SIGNAL_OWNER_FALLBACK: "off",
    INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE: "off"
  }, "the usual app's vault and the shell's switches never reach the trial's server, and a Codex run names no Claude folder");
  assert.deepEqual([codex.PORT, codex.LEDGER_MODE, codex.PATH, codex.HOME, codex.CODEX_COMMAND], ["9123", "off", "/synthetic/bin", "/synthetic/home", "/synthetic/bin/codex"]);
  const flagged = serverEnvironment({ ...common, provider: "codex", keptPlan: true, numberNow: true, feedbackLink: true, ownerFallback: true, fixedMessageOnFailure: true });
  assert.deepEqual([flagged.INNER_SIGNAL_RUNNER_KEPT_PLAN, flagged.INNER_SIGNAL_RUNNER_NUMBER_NOW, flagged.INNER_SIGNAL_RUNNER_FEEDBACK_LINK, flagged.INNER_SIGNAL_OWNER_FALLBACK, flagged.INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE], ["on", "on", "on", "on", "on"]);
  assert.equal(serverEnvironment({ ...common, provider: "codex", numberNow: true }).INNER_SIGNAL_RUNNER_KEPT_PLAN, "off", "each flag turns on only its own switch");
  assert.deepEqual(Object.fromEntries(Object.entries(serverEnvironment({ ...common, provider: "codex", ownerFallback: true })).filter(([key]) => key === "INNER_SIGNAL_OWNER_FALLBACK" || key === "INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE")),
    { INNER_SIGNAL_OWNER_FALLBACK: "on", INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE: "off" }, "the owner's fixed message alone leaves its failures switch off");
  assert.throws(() => serverEnvironment({ ...common, provider: "codex", fixedMessageOnFailure: true }), /needs the owner's fixed message on too/u, "never without the owner's fixed message");
  assert.equal(serverEnvironment({ ...common, provider: "claude", claudeConfigDir: "/synthetic/claude-innersignal" }).INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR, "/synthetic/claude-innersignal");
  assert.equal(serverEnvironment({ ...common, provider: "claude" }).INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR, path.join(os.homedir(), ".config", "claude-innersignal"), "Claude's sign-in folder defaults to the runner's own");
  assert.equal(serverEnvironment({ ...common, provider: "mixed", claudeConfigDir: "/synthetic/claude-innersignal" }).INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR, "/synthetic/claude-innersignal", "mixed runs Claude workers too");
  for (const caseId of [undefined, "case-1", SYNTHETIC_CASE.toUpperCase(), `${SYNTHETIC_CASE}\n`]) {
    assert.throws(() => serverEnvironment({ ...common, provider: "codex", caseId }), /isn't of the form the credentials hold/u, String(caseId));
  }
});

test("the folder, the vault and the credentials are private; the case keys are made once and the token is new at every start", async (t) => {
  const home = path.join(await tempDir(t, "runner-start"), "trial");
  const first = await prepareTrialFolder({ home, provider: "codex" });
  assert.deepEqual([await mode(home), await mode(first.vault), await mode(first.credentialsPath), await mode(first.settingsPath)], [0o700, 0o700, 0o600, 0o600]);
  const credentials = JSON.parse(await fs.readFile(first.credentialsPath, "utf8"));
  assert.deepEqual(Object.keys(credentials), ["schema_version", "root_dir", "grants", "case_keys"]);
  assert.equal(credentials.root_dir, first.vault);
  assert.equal(credentials.grants.length, 1);
  const [caseId] = credentials.grants[0].case_ids;
  assert.match(caseId, /^case-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "an id of the page's own form");
  assert.equal(first.caseId, caseId, "the case the server is told is the one the credentials grant");
  assert.deepEqual(credentials.grants[0].scopes, SCOPES);
  assert.equal(credentials.grants[0].token_sha256, createHash("sha256").update(first.token).digest("hex"), "only the token's digest is kept");
  assert.equal(JSON.stringify(credentials).includes(first.token), false);
  for (const scope of SCOPES) assert.equal(await authorize(first.credentialsPath, first.token, caseId, scope), true, scope);
  assert.equal(await authorize(first.credentialsPath, first.token, "case-synthetic-other", "case:read"), false, "only its own case");

  const settings = loadRunnerTrialSettings({ settingsPath: first.settingsPath });
  assert.deepEqual(settings.runtime, { writerMode: "whole", checkerMode: "whole" });
  assert.ok(RUNNER_ROLES.every((role) => settings.workers[role].provider === "codex"));

  const second = await prepareTrialFolder({ home, provider: "claude" });
  const after = JSON.parse(await fs.readFile(second.credentialsPath, "utf8"));
  assert.notEqual(second.token, first.token);
  assert.equal(second.caseId, caseId);
  assert.deepEqual(after.case_keys, credentials.case_keys, "the keys never change, so the vault stays readable");
  assert.deepEqual(after.grants[0].case_ids, [caseId]);
  assert.equal(await authorize(second.credentialsPath, first.token, caseId, "case:read"), false, "the last start's token no longer works");
  assert.equal(await authorize(second.credentialsPath, second.token, caseId, "case:read"), true);
  assert.equal(await mode(second.credentialsPath), 0o600);
  assert.ok(RUNNER_ROLES.every((role) => loadRunnerTrialSettings({ settingsPath: second.settingsPath }).workers[role].provider === "claude"));
  assert.deepEqual((await fs.readdir(home)).sort(), ["credentials.json", "settings-claude.json", "settings-codex.json", "vault"], "no temporary file is left");
});

test("it refuses a folder inside the checkout, credentials others can read or it didn't make, and new keys for a vault that holds files", async (t) => {
  await assert.rejects(prepareTrialFolder({ home: path.join(repositoryRoot, "synthetic-trial-folder"), provider: "codex" }), /must be outside the InnerSignal checkout/u);
  await assert.rejects(fs.stat(path.join(repositoryRoot, "synthetic-trial-folder")), { code: "ENOENT" }, "nothing was made in the checkout");

  const dir = await tempDir(t, "runner-start-refusals");
  const loose = path.join(dir, "loose");
  const prepared = await prepareTrialFolder({ home: loose, provider: "codex" });
  const before = await fs.readFile(prepared.credentialsPath, "utf8");
  await fs.chmod(prepared.credentialsPath, 0o644);
  await assert.rejects(prepareTrialFolder({ home: loose, provider: "codex" }), /can be read by others/u);
  assert.equal(await fs.readFile(prepared.credentialsPath, "utf8"), before, "left as it was");

  const foreign = path.join(dir, "foreign");
  await fs.mkdir(foreign, { mode: 0o700 });
  await fs.writeFile(path.join(foreign, "credentials.json"), JSON.stringify({ schema_version: 1, root_dir: "/synthetic/elsewhere", grants: [], case_keys: {} }), { mode: 0o600 });
  await assert.rejects(prepareTrialFolder({ home: foreign, provider: "codex" }), /wasn't made by this script/u);

  const orphan = path.join(dir, "orphan");
  const made = await prepareTrialFolder({ home: orphan, provider: "codex" });
  await fs.writeFile(path.join(made.vault, "case-synthetic.vault.json"), "{}", { mode: 0o600 });
  await fs.rm(made.credentialsPath);
  await assert.rejects(prepareTrialFolder({ home: orphan, provider: "codex" }), /holds files that only its keys can open/u);
  await assert.rejects(fs.stat(made.credentialsPath), { code: "ENOENT" }, "no new keys were written");
});

test("the server runs on Node 24: this Node when it is 24, otherwise nvm's copy of .nvmrc's version or another 24.x", async (t) => {
  assert.equal(nodeForServer({ current: "24.1.0", execPath: "/synthetic/node" }), "/synthetic/node");
  const nvm = await tempDir(t, "runner-start-nvm");
  assert.throws(() => nodeForServer({ current: "26.8.1", environment: { NVM_DIR: nvm } }), /needs Node\.js 24, and this is Node 26\.8\.1\. Install it with: nvm install 24\./u);
  const wanted = (await fs.readFile(path.join(repositoryRoot, ".nvmrc"), "utf8")).trim();
  const other = path.join(nvm, "versions", "node", "v24.1.0", "bin", "node");
  await fs.mkdir(path.dirname(other), { recursive: true });
  await fs.writeFile(other, "", { mode: 0o755 });
  assert.equal(nodeForServer({ current: "26.8.1", environment: { NVM_DIR: nvm } }), other, "another 24.x when .nvmrc's version isn't installed");
  const exact = path.join(nvm, "versions", "node", `v${wanted.replace(/^v/u, "")}`, "bin", "node");
  await fs.mkdir(path.dirname(exact), { recursive: true });
  await fs.writeFile(exact, "", { mode: 0o755 });
  assert.equal(nodeForServer({ current: "26.8.1", environment: { NVM_DIR: nvm } }), exact);
});

test("--prepare-only makes the folder and prints its place, never a key, the token or its digest", async (t) => {
  const home = path.join(await tempDir(t, "runner-start-cli"), "trial");
  const result = await run(["--provider", "codex", "--prepare-only", "--dir", home]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Runner trial folder ready, server not started: /u);
  const credentials = JSON.parse(await fs.readFile(path.join(home, "credentials.json"), "utf8"));
  const secrets = [credentials.grants[0].token_sha256, ...Object.values(Object.values(credentials.case_keys)[0])];
  for (const secret of secrets) assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
  const usage = await run(["--provider", "synthetic"]);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /--provider must be mixed, codex or claude\./u);
});

test("a real start serves the trial page on loopback in its own vault, names its case and arrangement, turns on only the switch a flag names, and stops on a stop signal", async (t) => {
  const dir = await tempDir(t, "runner-start-serve");
  const home = path.join(dir, "trial");
  const claudeHome = path.join(dir, "claude-home");
  await fs.mkdir(claudeHome, { mode: 0o700 });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // Stand-ins for the Codex and Claude commands: the start checks that they exist, and no message is sent, so nothing runs them.
  const env = { ...process.env, CODEX_COMMAND: process.execPath, CLAUDE_COMMAND: process.execPath, INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR: claudeHome, INNER_SIGNAL_RUNNER_KEPT_PLAN: "on", INNER_SIGNAL_RUNNER_TRIAL_CASE_ID: SYNTHETIC_CASE };
  const child = spawn(process.execPath, [script, "--provider", "mixed", "--port", String(port), "--dir", home, "--number-now", "--owner-fallback", "--fixed-message-on-failure"], { cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 90_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes(`Runner trial ready: ${base}`)) { clearTimeout(timer); resolve(true); }
    });
    exited.then(() => { clearTimeout(timer); resolve(false); });
  });
  assert.equal(ready, true, `stdout=${stdout} stderr=${stderr}`);
  const health = await (await fetch(`${base}/health`)).json();
  assert.deepEqual([health.runnerTrial, health.runnerKeptPlan, health.runnerNumberNow, health.runnerFeedbackLink, health.ownerFallback, health.runnerFixedMessageOnFailure, health.mode], ["on", "off", "on", "off", "on", "on", "mock"], "a switch the shell set stays off without its flag, and each flag turns on its own");
  assert.match(stdout, /Kept plan off, number now on, feedback link off, owner's fixed message on, also after a plan limit, sign-in or timeout on\./u);
  assert.deepEqual(health.privateCaseStorage, { available: true, plaintextFallback: false, automaticOrchestration: true });
  const credentials = JSON.parse(await fs.readFile(path.join(home, "credentials.json"), "utf8"));
  assert.equal(health.runnerCaseId, credentials.grants[0].case_ids[0], "/health names the case the credentials grant, not one the shell set");
  assert.deepEqual(health.runnerArrangement, { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] });
  assert.equal(stderr.includes("No Claude sign-in folder"), false, stderr);
  const post = (body) => fetch(`${base}/v1/runner/reconcile`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  const own = await post({ caseId: credentials.grants[0].case_ids[0], conversation: "current" });
  assert.equal(own.status, 200);
  assert.deepEqual((await own.json()).turns, []);
  assert.equal((await post({ caseId: "case-synthetic-not-granted", conversation: "current" })).status, 403, "a case the credentials don't name is refused");
  child.kill("SIGTERM");
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.equal(`${stdout}${stderr}`.includes(credentials.grants[0].token_sha256), false);
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
});
