#!/usr/bin/env node
// Starts InnerSignal's runner trial on this computer: the trial's page on loopback, in a vault of its own (docs/RUNNER-TRIAL.md;
// design: docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections 10 and 11).
//
//   node scripts/runner-trial-start.mjs --provider codex|claude [--port 8797] [--dir PATH]
//                                       [--kept-plan] [--feedback-link] [--owner-fallback] [--prepare-only]
//
// Everything the trial keeps is in one folder outside the checkout, never the app's usual vault (default
// $HOME/.local/share/inner-signal-runner-trial, or --dir), mode 0700:
//   vault/                    the trial's encrypted vault (one AES-256-GCM file per case, made and checked by the app's store)
//   credentials.json          the vault's development credentials, mode 0600, in the shape docs/PRIVATE-CASE-CONTINUITY.md gives:
//                             one grant for one case, with the case's keys made once from random bytes and never changed
//   settings-<provider>.json  the trial settings (INNER_SIGNAL_RUNNER_TRIAL_SETTINGS), mode 0600, written at every start
// A new random token is made at every start. Only its SHA-256 goes into credentials.json; the token itself goes to the server
// through its environment and nowhere else: never on a command line, into a file or into the output. Nothing here prints a key.
//
// The settings are the arrangement that measured best (tasks/runner-trial-20261121): the whole writer with one whole checker,
// readers and checkers at low effort and the writer at medium, every worker on the chosen provider.

import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OWNER_FALLBACK_SETTING } from "../src/core/config.mjs";
import { isOutside } from "../src/core/private-path.mjs";
import { RUNNER_ROLES, validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import {
  RUNNER_CLAUDE_CONFIG_DIR,
  RUNNER_FEEDBACK_LINK_SETTING,
  RUNNER_KEPT_PLAN_SETTING,
  RUNNER_TRIAL_SETTING,
  RUNNER_TRIAL_SETTINGS_FILE
} from "../src/runner-trial/switch.mjs";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serveEntry = path.join(repositoryRoot, "src/cli/serve.mjs");

export const DEFAULT_PORT = 8797;
export const defaultTrialHome = () => path.join(os.homedir(), ".local", "share", "inner-signal-runner-trial");
export const defaultClaudeConfigDir = () => path.join(os.homedir(), ".config", "claude-innersignal");
const PRINCIPAL = "runner-trial-local-owner";
// The runtime needs all three (docs/PRIVATE-CASE-CONTINUITY.md); "Delete this case" is a write.
const SCOPES = Object.freeze(["case:read", "case:write", "case:audit"]);
const PROVIDERS = Object.freeze(["codex", "claude"]);
// The efforts of the measurement's arms ("normal" in tasks/runner-trial-20261121/measure.mjs), and its Claude models. A Codex
// worker leaves the model to Codex's own default, as the measurement did.
const EFFORT = Object.freeze({ reader: "low", writer: "medium", checker: "low" });
const CLAUDE_MODEL = Object.freeze({ reader: "claude-sonnet-5-5", writer: "claude-opus-5-5", checker: "claude-opus-5-5" });
const kindOf = (role) => (role.startsWith("R") ? "reader" : role.startsWith("W") ? "writer" : "checker");

export const USAGE = `Usage: node scripts/runner-trial-start.mjs --provider codex|claude [--port N] [--dir PATH]
                                           [--kept-plan] [--feedback-link] [--owner-fallback] [--prepare-only]

  --provider codex   every worker on GPT, through \`codex exec\` on the ChatGPT plan Codex is signed into
  --provider claude  every worker on Claude, through \`claude -p\` signed in at ${RUNNER_CLAUDE_CONFIG_DIR}
                     (default $HOME/.config/claude-innersignal): readers on Sonnet 5.5, writer and checker on Opus 5.5
  --port N           the page's port on 127.0.0.1 (default ${DEFAULT_PORT}); keep it, so the page keeps its case
  --dir PATH         the trial's own folder, outside the checkout (default $HOME/.local/share/inner-signal-runner-trial)
  --kept-plan        turn on ${RUNNER_KEPT_PLAN_SETTING} (off unless given)
  --feedback-link    turn on ${RUNNER_FEEDBACK_LINK_SETTING} (off unless given)
  --owner-fallback   turn on ${OWNER_FALLBACK_SETTING} (off unless given)
  --prepare-only     make or check the folder, the credentials and the settings, and stop without starting the server`;

class StartError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
const usageError = (message) => new StartError(`${message}\n\n${USAGE}`, 2);

const FLAGS = Object.freeze({ "--kept-plan": "keptPlan", "--feedback-link": "feedbackLink", "--owner-fallback": "ownerFallback", "--prepare-only": "prepareOnly" });
const VALUED = Object.freeze({ "--provider": "provider", "--port": "port", "--dir": "dir" });

export function parseArguments(argv) {
  const options = { provider: null, port: DEFAULT_PORT, dir: null, keptPlan: false, feedbackLink: false, ownerFallback: false, prepareOnly: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") throw new StartError(USAGE, 0);
    const [name, inline] = argument.startsWith("--") && argument.includes("=") ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)] : [argument, null];
    if (!Object.hasOwn(FLAGS, name) && !Object.hasOwn(VALUED, name)) throw usageError(`Unknown argument: ${name.startsWith("-") ? name : "(a value without its option)"}`);
    if (seen.has(name)) throw usageError(`${name} is given twice.`);
    seen.add(name);
    if (Object.hasOwn(FLAGS, name)) {
      if (inline !== null) throw usageError(`${name} takes no value.`);
      options[FLAGS[name]] = true;
      continue;
    }
    const value = inline ?? argv[index + 1];
    if (inline === null) index += 1;
    if (typeof value !== "string" || value === "" || (inline === null && value.startsWith("--"))) throw usageError(`${name} needs a value.`);
    options[VALUED[name]] = value;
  }
  if (options.provider === null) throw usageError("Choose the provider: --provider codex (GPT, through Codex) or --provider claude.");
  if (!PROVIDERS.includes(options.provider)) throw usageError("--provider must be codex or claude.");
  if (typeof options.port === "string") {
    if (!/^[0-9]{1,5}$/u.test(options.port) || Number(options.port) < 1024 || Number(options.port) > 65535) throw usageError("--port must be a whole number from 1024 to 65535.");
    options.port = Number(options.port);
  }
  if (options.dir !== null && !path.isAbsolute(options.dir)) throw usageError("--dir must be an absolute path.");
  return Object.freeze(options);
}

// The trial settings file's content: the whole writer with one whole checker, and every role's worker on the chosen provider, so
// no role falls back to the app's default worker of another provider. Checked with the app's own validator before it is written.
export function trialSettings(provider) {
  if (!PROVIDERS.includes(provider)) throw new StartError("The provider must be codex or claude.");
  const workers = Object.fromEntries(RUNNER_ROLES.map((role) => {
    const kind = kindOf(role);
    return [role, provider === "claude" ? { provider, model: CLAUDE_MODEL[kind], effort: EFFORT[kind] } : { provider, effort: EFFORT[kind] }];
  }));
  const settings = { writerMode: "whole", checkerMode: "whole", workers };
  validateRunnerTrialSettings(settings, { root: repositoryRoot });
  return settings;
}

// The server's environment: the shell's, without any InnerSignal setting it holds (the app's usual vault, another run's switches),
// and then exactly the trial's. The rest of the page runs in mock mode, so nothing but the trial's own workers calls a model, and
// no decision ledger is written into the checkout. The kept plan, the feedback link and the owner's fixed message are off unless
// their flag is given.
export function serverEnvironment({ base = process.env, provider, port, credentialsPath, settingsPath, token, claudeConfigDir = null, keptPlan = false, feedbackLink = false, ownerFallback = false }) {
  const environment = Object.fromEntries(Object.entries(base).filter(([key, value]) => !key.startsWith("INNER_SIGNAL_") && typeof value === "string"));
  Object.assign(environment, {
    INNER_SIGNAL_MODE: "mock",
    LEDGER_MODE: "off",
    PORT: String(port),
    INNER_SIGNAL_PRIVATE_RUNTIME_MODE: "development",
    INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: credentialsPath,
    INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: token,
    [RUNNER_TRIAL_SETTING]: "on",
    [RUNNER_TRIAL_SETTINGS_FILE]: settingsPath,
    [RUNNER_KEPT_PLAN_SETTING]: keptPlan ? "on" : "off",
    [RUNNER_FEEDBACK_LINK_SETTING]: feedbackLink ? "on" : "off",
    [OWNER_FALLBACK_SETTING]: ownerFallback ? "on" : "off"
  });
  if (provider === "claude") environment[RUNNER_CLAUDE_CONFIG_DIR] = claudeConfigDir ?? defaultClaudeConfigDir();
  return environment;
}

async function lstatOrNull(file) {
  try { return await fsp.lstat(file); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

// A folder only you can open (mode 0700), made if it's missing. A link or a file in its place is refused.
async function privateFolder(folder, name) {
  await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
  const info = await fsp.lstat(folder);
  if (!info.isDirectory()) throw new StartError(`${name} (${folder}) must be a folder, not a link or a file.`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new StartError(`${name} (${folder}) belongs to another user.`);
  await fsp.chmod(folder, 0o700);
}

// Writes a file only you can read (mode 0600) whole or not at all: a new file beside it, then renamed over it.
async function writePrivateFile(file, text) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fsp.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try { await fsp.rename(temporary, file); } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

function existingCredentials(text, file, vault) {
  let value;
  try { value = JSON.parse(text); } catch { throw new StartError(`${file} isn't valid JSON; it was left as it is.`); }
  const grant = Array.isArray(value?.grants) && value.grants.length === 1 ? value.grants[0] : null;
  const caseId = Array.isArray(grant?.case_ids) && grant.case_ids.length === 1 ? grant.case_ids[0] : null;
  const keys = typeof caseId === "string" && value?.case_keys && typeof value.case_keys === "object" ? value.case_keys[caseId] : null;
  if (value?.schema_version !== 1 || grant?.principal_id !== PRINCIPAL || typeof caseId !== "string" || !keys
    || typeof keys.routine_kek_base64 !== "string" || typeof keys.recovery_secret_base64 !== "string") {
    throw new StartError(`${file} wasn't made by this script; it was left as it is. Use another --dir for the trial.`);
  }
  if (value.root_dir !== vault) throw new StartError(`${file} names another vault folder; it was left as it is. Start with the --dir it was made for.`);
  return value;
}

// The trial's credentials (docs/PRIVATE-CASE-CONTINUITY.md, "Encryption and key-provider model"): made on the first start, with
// one case whose keys are random and never change afterwards; at every start only the grant's token digest is replaced, so the
// token is new each time and is never kept. Returns the token for the server's environment.
export async function prepareCredentials(file, vault) {
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  const info = await lstatOrNull(file);
  let credentials;
  if (info === null) {
    // New keys can't open cases made with lost ones, so a vault that already holds anything gets no new credentials.
    const held = (await fsp.readdir(vault)).filter((name) => name !== ".journal-writer.lock");
    if (held.length) throw new StartError(`${file} is missing, but the vault ${vault} holds files that only its keys can open; nothing was changed.`);
    const caseId = `case-${randomUUID()}`;
    credentials = {
      schema_version: 1,
      root_dir: vault,
      grants: [{ token_sha256: digest, principal_id: PRINCIPAL, case_ids: [caseId], scopes: [...SCOPES] }],
      case_keys: { [caseId]: { routine_kek_base64: randomBytes(32).toString("base64"), recovery_secret_base64: randomBytes(32).toString("base64") } }
    };
  } else {
    if (!info.isFile()) throw new StartError(`${file} must be a file, not a link or a folder.`);
    if ((info.mode & 0o077) !== 0) throw new StartError(`${file} can be read by others (it must be mode 0600); it was left as it is.`);
    credentials = existingCredentials(await fsp.readFile(file, "utf8"), file, vault);
    credentials.grants[0].token_sha256 = digest;
  }
  await writePrivateFile(file, `${JSON.stringify(credentials, null, 2)}\n`);
  return token;
}

// The trial's folder, its vault, its credentials and its settings file. Returns the paths and this start's token.
export async function prepareTrialFolder({ home, provider }) {
  const resolved = path.resolve(home);
  let outside;
  try { outside = isOutside(repositoryRoot, resolved); } catch { throw new StartError(`The trial folder ${resolved} can't be checked.`); }
  if (!outside) throw new StartError("The trial folder must be outside the InnerSignal checkout.");
  await privateFolder(resolved, "The trial folder");
  const vault = path.join(resolved, "vault");
  await privateFolder(vault, "The trial's vault");
  const credentialsPath = path.join(resolved, "credentials.json");
  const token = await prepareCredentials(credentialsPath, vault);
  const settingsPath = path.join(resolved, `settings-${provider}.json`);
  await writePrivateFile(settingsPath, `${JSON.stringify(trialSettings(provider), null, 2)}\n`);
  return { home: resolved, vault, credentialsPath, settingsPath, token };
}

const executable = (file) => {
  try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
};

function onPath(command, environment = process.env) {
  if (command.includes(path.sep)) return executable(command);
  return String(environment.PATH ?? "").split(path.delimiter).some((folder) => folder && executable(path.join(folder, command)));
}

// InnerSignal runs on Node 24 (.nvmrc). This script may run on another Node; it then starts the server with the nvm copy of
// .nvmrc's version, or the newest other 24.x nvm holds.
export function nodeForServer({ current = process.versions.node, execPath = process.execPath, environment = process.env } = {}) {
  if (Number(current.split(".")[0]) === 24) return execPath;
  const wanted = fs.readFileSync(path.join(repositoryRoot, ".nvmrc"), "utf8").trim().replace(/^v/u, "");
  const versions = path.join(environment.NVM_DIR || path.join(os.homedir(), ".nvm"), "versions", "node");
  const candidates = [`v${wanted}`];
  try {
    const numbers = (name) => name.slice(1).split(".").map(Number);
    const others = fs.readdirSync(versions).filter((name) => /^v24\.\d+\.\d+$/u.test(name) && name !== `v${wanted}`)
      .sort((a, b) => numbers(b)[1] - numbers(a)[1] || numbers(b)[2] - numbers(a)[2]);
    candidates.push(...others);
  } catch { /* no nvm folder */ }
  for (const name of candidates) {
    const node = path.join(versions, name, "bin", "node");
    if (executable(node)) return node;
  }
  throw new StartError(`InnerSignal needs Node.js 24, and this is Node ${current}. Install it with: nvm install ${wanted}`);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Waits until the server answers /health, or stops, or the time runs out.
async function untilReady(port, exited, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stopped = false;
  exited.then(() => { stopped = true; });
  while (!stopped && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return { health: await response.json() };
    } catch { /* not listening yet */ }
    await pause(400);
  }
  return stopped ? { stopped: true } : { timedOut: true };
}

const onOff = (value) => (value ? "on" : "off");

async function main(argv) {
  const options = parseArguments(argv);
  const home = options.dir ?? defaultTrialHome();
  const command = options.provider === "claude" ? process.env.CLAUDE_COMMAND || "claude" : process.env.CODEX_COMMAND || "codex";
  const claudeConfigDir = options.provider === "claude" ? process.env[RUNNER_CLAUDE_CONFIG_DIR]?.trim() || defaultClaudeConfigDir() : null;
  if (claudeConfigDir !== null && !path.isAbsolute(claudeConfigDir)) throw new StartError(`${RUNNER_CLAUDE_CONFIG_DIR} must be an absolute path.`);
  const prepared = await prepareTrialFolder({ home, provider: options.provider });
  if (options.prepareOnly) {
    console.log(`Runner trial folder ready, server not started: ${prepared.home}`);
    console.log(`  vault ${prepared.vault}, credentials.json and ${path.basename(prepared.settingsPath)} (only you can read them).`);
    return 0;
  }
  if (!onPath(command)) {
    throw new StartError(options.provider === "claude"
      ? `The Claude command (${command}) isn't on PATH, so the trial's workers couldn't run.`
      : `The Codex command (${command}) isn't on PATH, so the trial's workers couldn't run. Install Codex and sign in with \`codex login\`.`);
  }
  if (claudeConfigDir !== null && !fs.existsSync(claudeConfigDir)) {
    console.warn(`No Claude sign-in folder at ${claudeConfigDir}: sign in there first with  CLAUDE_CONFIG_DIR=${claudeConfigDir} claude  then /login.`);
  }
  const node = nodeForServer();
  if (!(await portIsFree(options.port))) {
    throw new StartError(`Port ${options.port} on 127.0.0.1 is in use: is the trial already running? Stop it, or start with --port and another number (the page then starts with a new case).`);
  }
  const environment = serverEnvironment({ provider: options.provider, port: options.port, credentialsPath: prepared.credentialsPath, settingsPath: prepared.settingsPath, token: prepared.token, claudeConfigDir, keptPlan: options.keptPlan, feedbackLink: options.feedbackLink, ownerFallback: options.ownerFallback });
  console.log(`Starting InnerSignal's runner trial on ${options.provider === "claude" ? "Claude" : "GPT (Codex)"}, with its own vault: ${prepared.vault}`);
  const child = spawn(node, [serveEntry], { cwd: repositoryRoot, env: environment, stdio: ["ignore", "inherit", "inherit"] });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: 1, signal: null }));
  });
  let stopping = false;
  // Ctrl+C reaches the server too (one process group); if it hasn't stopped a few seconds later, it is asked again.
  process.on("SIGINT", () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); }, 3_000).unref();
  });
  for (const signal of ["SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      stopping = true;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    });
  }
  const ready = await untilReady(options.port, exited, 120_000);
  if (ready.timedOut) {
    console.error(`The server didn't answer on port ${options.port} within two minutes; it was stopped.`);
    child.kill("SIGTERM");
    await exited;
    return 1;
  }
  if (ready.health && ready.health.runnerTrial !== "on") {
    child.kill("SIGTERM");
    await exited;
    throw new StartError("The server started without the runner trial; it was stopped.");
  }
  if (ready.health) {
    console.log("");
    console.log(`Runner trial ready: http://127.0.0.1:${options.port}`);
    console.log(`  Workers: ${options.provider === "claude" ? "Claude (readers Sonnet 5.5, writer and checker Opus 5.5)" : "GPT through Codex (Codex's own model)"}; the whole writer with one whole checker.`);
    console.log(`  Kept plan ${onOff(options.keptPlan)}, feedback link ${onOff(options.feedbackLink)}, owner's fixed message ${onOff(options.ownerFallback)}.`);
    console.log("  Stop with Ctrl+C.");
  }
  const { code } = await exited;
  // Stopped on request (Ctrl+C, or a stop signal to this script): the server closed its listener and released the vault.
  if (stopping) return code ?? 0;
  console.error(ready.health ? `The server stopped (exit code ${code ?? "none"}).` : "The server stopped before it was ready; its message is above.");
  return code || 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      if (error instanceof StartError) {
        (error.exitCode === 0 ? console.log : console.error)(error.message);
        process.exitCode = error.exitCode;
      } else {
        console.error(`The runner trial couldn't start: ${error?.message ?? error}`);
        process.exitCode = 1;
      }
    }
  );
}
