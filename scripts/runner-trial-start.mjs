#!/usr/bin/env node
// Starts InnerSignal's runner trial on this computer: the trial's page on loopback, in a vault of its own (docs/RUNNER-TRIAL.md;
// design: docs/superpowers/specs/2026-11-21-runner-trial-design.md, sections 10 and 11).
//
//   node scripts/runner-trial-start.mjs --provider mixed|codex|claude [--port 8797] [--dir PATH]
//                                       [--kept-plan] [--number-now] [--feedback-link] [--owner-fallback]
//                                       [--fixed-message-on-failure] [--fixed-message-on-any-failure] [--prepare-only]
//
// Everything the trial keeps is in one folder outside the checkout, never the app's usual vault (default
// $HOME/.local/share/inner-signal-runner-trial, or --dir), mode 0700:
//   vault/                    the trial's encrypted vault (one AES-256-GCM file per case, made and checked by the app's store)
//   credentials.json          the vault's development credentials, mode 0600, in the shape docs/PRIVATE-CASE-CONTINUITY.md gives:
//                             one grant for one case, with the case's keys made once from random bytes and never changed
//   settings-<provider>.json  the trial settings (INNER_SIGNAL_RUNNER_TRIAL_SETTINGS), mode 0600, written at every start
// A new random token is made at every start. Only its SHA-256 goes into credentials.json; the token itself goes to the server
// through its environment and nowhere else: never on a command line, into a file or into the output. Nothing here prints a key.
// The server is told the case the credentials grant (INNER_SIGNAL_RUNNER_TRIAL_CASE_ID), and the page takes it from /health.
//
// The settings are the arrangement that measured best (tasks/runner-trial-20261121): the whole writer with one whole checker,
// readers and checkers at low effort and the writer at medium. With --provider mixed (measured fastest: replies p50 19.8 s,
// p90 24.5 s, the provisional 5.1 s) the readers and the checker run on Claude and the writer and its repair on GPT; with codex
// or claude, every worker runs on that one.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
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
  RUNNER_RULES_ROOT,
  RUNNER_TRIAL_DIR,
  RUNNER_CLAUDE_CONFIG_DIR,
  RUNNER_FEEDBACK_LINK_SETTING,
  RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING,
  RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING,
  RUNNER_KEPT_PLAN_SETTING,
  RUNNER_NUMBER_NOW_SETTING,
  RUNNER_TRIAL_CASE_ID_PATTERN,
  RUNNER_TRIAL_CASE_ID_SETTING,
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
const PROVIDERS = Object.freeze(["mixed", "codex", "claude"]);
// The efforts of the measurement's arms ("normal" in tasks/runner-trial-20261121/measure.mjs), and its Claude models. A Codex
// worker leaves the model to Codex's own default, as the measurement did.
const EFFORT = Object.freeze({ reader: "low", writer: "medium", checker: "low" });
const CLAUDE_MODEL = Object.freeze({ reader: "claude-sonnet-5-5", writer: "claude-opus-5-5", checker: "claude-opus-5-5" });
const kindOf = (role) => (role.startsWith("R") ? "reader" : role.startsWith("W") ? "writer" : "checker");
// mixed: every reader and checker on Claude, the writer and its repair on GPT, so another company's model reads and checks what the
// writer wrote (tasks/runner-trial-20261121/measure.mjs, --provider mixed).
const workerProvider = (provider, role) => (provider === "mixed" ? (kindOf(role) === "writer" ? "codex" : "claude") : provider);
const usesClaude = (provider) => provider !== "codex";
const usesCodex = (provider) => provider !== "claude";

export const USAGE = `Usage: node scripts/runner-trial-start.mjs --provider mixed|codex|claude [--port N] [--dir PATH]
                                           [--kept-plan] [--number-now] [--feedback-link] [--owner-fallback]
                                           [--fixed-message-on-failure] [--fixed-message-on-any-failure] [--prepare-only]

  --provider mixed   the readers and the checker on Claude, the writer on GPT (measured fastest); each plan pays for its own
                     calls, and both companies see the conversation
  --provider codex   every worker on GPT, through \`codex exec\` on the ChatGPT plan Codex is signed into
  --provider claude  every worker on Claude, through \`claude -p\` signed in at ${RUNNER_CLAUDE_CONFIG_DIR}
                     (default $HOME/.config/claude-innersignal): readers on Sonnet 5.5, writer and checker on Opus 5.5
  --port N           the page's port on 127.0.0.1 (default ${DEFAULT_PORT}); keep it, so the page keeps its case
  --dir PATH         the trial's own folder, outside the checkout (default $HOME/.local/share/inner-signal-runner-trial)
  --kept-plan        turn on ${RUNNER_KEPT_PLAN_SETTING} (off unless given)
  --number-now       turn on ${RUNNER_NUMBER_NOW_SETTING} (off unless given)
  --feedback-link    turn on ${RUNNER_FEEDBACK_LINK_SETTING} (off unless given)
  --owner-fallback   turn on ${OWNER_FALLBACK_SETTING} (off unless given)
  --fixed-message-on-failure
                     turn on ${RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING} (off unless given; only with --owner-fallback):
                     the owner's fixed message also when the plan's limit, the sign-in or the time ends a turn in a
                     conversation about wanting to die or getting safe
  --fixed-message-on-any-failure
                     turn on ${RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING} (off unless given; only with
                     --fixed-message-on-failure and --owner-fallback): the owner's fixed message after every failure in
                     such a conversation, a refusal, a failed call and an interruption too
  --prepare-only     make or check the folder, the credentials and the settings, and stop without starting the server`;

class StartError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
const usageError = (message) => new StartError(`${message}\n\n${USAGE}`, 2);

const FLAGS = Object.freeze({ "--kept-plan": "keptPlan", "--number-now": "numberNow", "--feedback-link": "feedbackLink", "--owner-fallback": "ownerFallback", "--fixed-message-on-failure": "fixedMessageOnFailure", "--fixed-message-on-any-failure": "fixedMessageOnAnyFailure", "--prepare-only": "prepareOnly" });
const VALUED = Object.freeze({ "--provider": "provider", "--port": "port", "--dir": "dir" });

export function parseArguments(argv) {
  const options = { provider: null, port: DEFAULT_PORT, dir: null, keptPlan: false, numberNow: false, feedbackLink: false, ownerFallback: false, fixedMessageOnFailure: false, fixedMessageOnAnyFailure: false, prepareOnly: false };
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
  if (options.provider === null) throw usageError("Choose the provider: --provider mixed (Claude reads and checks, GPT writes), codex (GPT, through Codex) or claude.");
  if (!PROVIDERS.includes(options.provider)) throw usageError("--provider must be mixed, codex or claude.");
  if (typeof options.port === "string") {
    if (!/^[0-9]{1,5}$/u.test(options.port) || Number(options.port) < 1024 || Number(options.port) > 65535) throw usageError("--port must be a whole number from 1024 to 65535.");
    options.port = Number(options.port);
  }
  if (options.dir !== null && !path.isAbsolute(options.dir)) throw usageError("--dir must be an absolute path.");
  // Each extends the one before, so it is refused without the switches it extends (design, section 7): the fixed message after every
  // failure needs it after the plan's limit, the sign-in or the time, and that needs the owner's fixed message itself.
  if (options.fixedMessageOnAnyFailure && !(options.fixedMessageOnFailure && options.ownerFallback)) throw usageError("--fixed-message-on-any-failure extends the owner's fixed message after the plan's limit, the sign-in or the time: give --fixed-message-on-failure and --owner-fallback too.");
  if (options.fixedMessageOnFailure && !options.ownerFallback) throw usageError("--fixed-message-on-failure extends the owner's fixed message: give --owner-fallback too.");
  return Object.freeze(options);
}

// The trial settings file's content: the whole writer with one whole checker, and every role's worker named, on the provider the
// choice gives it, so no role falls back to the app's default worker. Checked with the app's own validator before it is written.
export function trialSettings(provider) {
  if (!PROVIDERS.includes(provider)) throw new StartError("The provider must be mixed, codex or claude.");
  const workers = Object.fromEntries(RUNNER_ROLES.map((role) => {
    const kind = kindOf(role);
    const worker = workerProvider(provider, role);
    return [role, worker === "claude" ? { provider: worker, model: CLAUDE_MODEL[kind], effort: EFFORT[kind] } : { provider: worker, effort: EFFORT[kind] }];
  }));
  const settings = { writerMode: "whole", checkerMode: "whole", workers };
  validateRunnerTrialSettings(settings, { root: repositoryRoot });
  return settings;
}

// The server's environment: the shell's, without any InnerSignal setting it holds (the app's usual vault, another run's switches),
// and then exactly the trial's, with the case its credentials grant. The rest of the page runs in mock mode, so nothing but the
// trial's own workers calls a model, and no decision ledger is written into the checkout. The kept plan, the number now, the
// feedback link, the owner's fixed message, that message after the plan's limit, the sign-in or the time, and after every failure,
// are off unless their flag is given; the last two only with the ones they extend.
export function serverEnvironment({ base = process.env, provider, port, credentialsPath, settingsPath, token, caseId, rulesRoot = null, trialDir = path.dirname(settingsPath), claudeConfigDir = null, keptPlan = false, numberNow = false, feedbackLink = false, ownerFallback = false, fixedMessageOnFailure = false, fixedMessageOnAnyFailure = false }) {
  if (typeof caseId !== "string" || !RUNNER_TRIAL_CASE_ID_PATTERN.test(caseId)) throw new StartError("The trial's case id isn't of the form the credentials hold.");
  if (fixedMessageOnFailure && !ownerFallback) throw new StartError("The fixed message after the plan's limit, the sign-in or the time needs the owner's fixed message on too.");
  if (fixedMessageOnAnyFailure && !(fixedMessageOnFailure && ownerFallback)) throw new StartError("The fixed message after every failure needs the owner's fixed message on, and after the plan's limit, the sign-in or the time.");
  const environment = Object.fromEntries(Object.entries(base).filter(([key, value]) => !key.startsWith("INNER_SIGNAL_") && typeof value === "string"));
  Object.assign(environment, {
    INNER_SIGNAL_MODE: "mock",
    LEDGER_MODE: "off",
    PORT: String(port),
    INNER_SIGNAL_PRIVATE_RUNTIME_MODE: "development",
    INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: credentialsPath,
    INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: token,
    [RUNNER_TRIAL_SETTING]: "on",
    [RUNNER_TRIAL_DIR]: trialDir,
    [RUNNER_TRIAL_SETTINGS_FILE]: settingsPath,
    [RUNNER_TRIAL_CASE_ID_SETTING]: caseId,
    [RUNNER_KEPT_PLAN_SETTING]: keptPlan ? "on" : "off",
    [RUNNER_NUMBER_NOW_SETTING]: numberNow ? "on" : "off",
    [RUNNER_FEEDBACK_LINK_SETTING]: feedbackLink ? "on" : "off",
    [OWNER_FALLBACK_SETTING]: ownerFallback ? "on" : "off",
    [RUNNER_FIXED_MESSAGE_ON_FAILURE_SETTING]: fixedMessageOnFailure ? "on" : "off",
    [RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE_SETTING]: fixedMessageOnAnyFailure ? "on" : "off"
  });
  if (rulesRoot) environment[RUNNER_RULES_ROOT] = rulesRoot;
  if (usesClaude(provider)) environment[RUNNER_CLAUDE_CONFIG_DIR] = claudeConfigDir ?? defaultClaudeConfigDir();
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
// token is new each time and is never kept. Returns the token for the server's environment, and the case the grant names.
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
  const caseId = credentials.grants[0].case_ids[0];
  if (!RUNNER_TRIAL_CASE_ID_PATTERN.test(caseId)) throw new StartError(`${file} names a case of another form; it was left as it is.`);
  await writePrivateFile(file, `${JSON.stringify(credentials, null, 2)}\n`);
  return { token, caseId };
}

// The trial's folder, its vault, its credentials and its settings file. Returns the paths, this start's token and the case.
export async function prepareTrialFolder({ home, provider }) {
  const resolved = path.resolve(home);
  let outside;
  try { outside = isOutside(repositoryRoot, resolved); } catch { throw new StartError(`The trial folder ${resolved} can't be checked.`); }
  if (!outside) throw new StartError("The trial folder must be outside the InnerSignal checkout.");
  await privateFolder(resolved, "The trial folder");
  const vault = path.join(resolved, "vault");
  await privateFolder(vault, "The trial's vault");
  const credentialsPath = path.join(resolved, "credentials.json");
  const { token, caseId } = await prepareCredentials(credentialsPath, vault);
  const settingsPath = path.join(resolved, `settings-${provider}.json`);
  await writePrivateFile(settingsPath, `${JSON.stringify(trialSettings(provider), null, 2)}\n`);
  return { home: resolved, vault, credentialsPath, settingsPath, token, caseId };
}

// The only network operation on startup. Tests inject git, including the fetch, and never contact a remote.
const execFileAsync = promisify(execFile);
export async function prepareReleasedRules(home, { git = (args, options = {}) => execFileAsync("git", args, { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024, ...options }) } = {}) {
  try { await git(["fetch", "--quiet", "origin", "stable"], { timeout: 30_000 }); } catch { /* use the last local release ref */ }
  let commit;
  try { commit = String((await git(["rev-parse", "--verify", "refs/remotes/origin/stable^{commit}"])).stdout).trim(); }
  catch { return { rulesRoot: null, source: "checkout" }; }
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new StartError("The local origin/stable ref could not be read.");
  const parent = path.join(home, "released-rules");
  await privateFolder(parent, "The released-rules folder");
  const target = path.join(parent, commit);
  // Publish a complete immutable snapshot through an atomically replaced commit-addressed link.
  const staging = await fsp.mkdtemp(path.join(parent, ".extract-"));
  const snapshot = path.join(parent, `.snapshot-${commit}-${randomUUID()}`);
  const pointer = path.join(parent, `.pointer-${randomUUID()}`);
  let published = false;
  try {
    await fsp.chmod(staging, 0o700);
    const archive = path.join(staging, "rules.tar");
    await git(["archive", "--format=tar", `--output=${archive}`, commit, "plugins/inner-signal-therapy"]);
    await execFileAsync("tar", ["-xf", archive, "-C", staging]);
    await fsp.unlink(archive);
    await fsp.rename(staging, snapshot);
    const existing = await lstatOrNull(target);
    if (existing && !existing.isSymbolicLink()) throw new StartError("The released-rules commit path must be a snapshot link; it was left as it is.");
    const prior = existing ? await fsp.readlink(target) : null;
    await fsp.symlink(path.basename(snapshot), pointer);
    await fsp.rename(pointer, target); // atomic replacement of the complete snapshot, never a partially extracted tree
    published = true;
    if (prior && new RegExp(`^\\.snapshot-${commit}-[a-f0-9-]{36}$`, "u").test(prior)) await fsp.rm(path.join(parent, prior), { recursive: true, force: true });
    return { rulesRoot: path.join(target, "plugins", "inner-signal-therapy"), source: `stable ${commit.slice(0, 9)}` };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rm(pointer, { force: true });
    if (!published) await fsp.rm(snapshot, { recursive: true, force: true });
  }
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
const PROVIDER_WORDS = Object.freeze({ mixed: "Claude and GPT", codex: "GPT (Codex)", claude: "Claude" });
const WORKER_WORDS = Object.freeze({
  mixed: "readers and checker on Claude (Sonnet 5.5 reads, Opus 5.5 checks), the writer on GPT through Codex (Codex's own model)",
  codex: "GPT through Codex (Codex's own model)",
  claude: "Claude (readers Sonnet 5.5, writer and checker Opus 5.5)"
});

async function main(argv) {
  const options = parseArguments(argv);
  const home = options.dir ?? defaultTrialHome();
  const commands = [
    ...(usesCodex(options.provider) ? [{ name: "Codex", command: process.env.CODEX_COMMAND || "codex", help: " Install Codex and sign in with `codex login`." }] : []),
    ...(usesClaude(options.provider) ? [{ name: "Claude", command: process.env.CLAUDE_COMMAND || "claude", help: "" }] : [])
  ];
  const claudeConfigDir = usesClaude(options.provider) ? process.env[RUNNER_CLAUDE_CONFIG_DIR]?.trim() || defaultClaudeConfigDir() : null;
  if (claudeConfigDir !== null && !path.isAbsolute(claudeConfigDir)) throw new StartError(`${RUNNER_CLAUDE_CONFIG_DIR} must be an absolute path.`);
  const prepared = await prepareTrialFolder({ home, provider: options.provider });
  if (options.prepareOnly) {
    console.log(`Runner trial folder ready, server not started: ${prepared.home}`);
    console.log(`  vault ${prepared.vault}, credentials.json and ${path.basename(prepared.settingsPath)} (only you can read them).`);
    return 0;
  }
  for (const { name, command, help } of commands) {
    if (!onPath(command)) throw new StartError(`The ${name} command (${command}) isn't on PATH, so the trial's workers couldn't run.${help}`);
  }
  if (claudeConfigDir !== null && !fs.existsSync(claudeConfigDir)) {
    console.warn(`No Claude sign-in folder at ${claudeConfigDir}: sign in there first with  CLAUDE_CONFIG_DIR=${claudeConfigDir} claude  then /login.`);
  }
  const node = nodeForServer();
  if (!(await portIsFree(options.port))) {
    throw new StartError(`Port ${options.port} on 127.0.0.1 is in use: is the trial already running? Stop it, or start with --port and another number (the page then starts with a new case).`);
  }
  const released = await prepareReleasedRules(prepared.home);
  console.log(released.rulesRoot ? `  Rules from ${released.source}.` : "  No local origin/stable ref: using rules from this checkout, not the release.");
  const environment = serverEnvironment({ rulesRoot: released.rulesRoot, trialDir: prepared.home, provider: options.provider, port: options.port, credentialsPath: prepared.credentialsPath, settingsPath: prepared.settingsPath, token: prepared.token, caseId: prepared.caseId, claudeConfigDir, keptPlan: options.keptPlan, numberNow: options.numberNow, feedbackLink: options.feedbackLink, ownerFallback: options.ownerFallback, fixedMessageOnFailure: options.fixedMessageOnFailure, fixedMessageOnAnyFailure: options.fixedMessageOnAnyFailure });
  console.log(`Starting InnerSignal's runner trial on ${PROVIDER_WORDS[options.provider]}, with its own vault: ${prepared.vault}`);
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
    console.log(`  Workers: ${WORKER_WORDS[options.provider]}; the whole writer with one whole checker.`);
    console.log(`  Kept plan ${onOff(options.keptPlan)}, number now ${onOff(options.numberNow)}, feedback link ${onOff(options.feedbackLink)}, owner's fixed message ${onOff(options.ownerFallback)}, also after a plan limit, sign-in or timeout ${onOff(options.fixedMessageOnFailure)}.`);
    console.log(`  The owner's fixed message after every other failure too (a refusal, a failed call, an interruption): ${onOff(options.fixedMessageOnAnyFailure)}.`);
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
