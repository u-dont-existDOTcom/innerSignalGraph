#!/usr/bin/env node
// InnerSignal's runner without a terminal: the icon and its launcher (docs/RUNNER-TRIAL.md, "The icon, Restart and Stop"; design:
// docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, sections 2 and 10, pull request 2; the owner's IS24, and
// i80 1a, a first slice on the runner's page without the terminal).
//
//   node scripts/runner-launcher.mjs [--dir PATH]
//        what the icon runs
//   node scripts/runner-launcher.mjs --install --provider mixed|codex|claude [--port N] [--dir PATH] [the start's switches]
//        once, by the lane: launcher.json in the trial folder, and the icon in the applications menu
//   node scripts/runner-launcher.mjs --uninstall [--dir PATH]
//        takes both away again
//
// The icon: when the runner already answers on its port, the launcher only opens its page. Otherwise it does what a start does (the
// folder, this start's grants from the client list, the released rules, the server: launchTrialServer in scripts/runner-trial-start.mjs)
// with the owner's provider and switches from launcher.json, keeps no terminal, opens the browser at the page, and stays as the server's
// parent. The server asks it over its IPC channel to restart (the same start again, with new grants, so consents recorded and clients
// added since take effect, and with the released rules it already runs) or to stop. Its log, launcher.log in the trial folder (mode
// 0600), holds the start's own lines and codes: never a person's words, and not the server's own output.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RUNNER_CLAUDE_CONFIG_DIR } from "../src/runner-trial/switch.mjs";
import { TrialFolderLockError, acquireTrialFolderLock, folderLockLeftNotice, releaseAfterFailure } from "../src/runner-trial/folder-lock.mjs";
import { readLauncherMessage } from "../src/runner-trial/launcher-link.mjs";
import { COMMAND_LOCK_WAIT_MS, DEFAULT_PORT, StartError, checkTrialHome, claudeFolderFor, commandPath, defaultTrialHome, launchTrialServer, nodeForServer, parseArguments, privateFolder, repositoryRoot, workerCommands, writePrivateFile } from "./runner-trial-start.mjs";

export const LAUNCHER_SETTINGS_FILE = "launcher.json";
export const LAUNCHER_LOG_FILE = "launcher.log";
export const DESKTOP_ENTRY_FILE = "inner-signal-runner.desktop";
export const LAUNCHER_ICON = path.join(repositoryRoot, "scripts", "runner-launcher-icon.svg");
export const LAUNCHER_SCRIPT = fileURLToPath(import.meta.url);
export const LAUNCHER_STOP_HINT = "  Stop it with the page's Stop button; the icon starts it again.";
const SETTINGS_KIND = "inner_signal_runner_launcher";
// What a launch takes from the install's environment, so that it runs as the owner's terminal start did whatever the desktop session's
// PATH holds: the workers' commands as the install found them, and Claude's sign-in folder when the install named one.
const SETTINGS_ENVIRONMENT = Object.freeze(["CODEX_COMMAND", "CLAUDE_COMMAND", RUNNER_CLAUDE_CONFIG_DIR]);
// The start's switches, in the order launcher.json keeps them.
const SWITCH_FLAGS = Object.freeze([["keptPlan", "--kept-plan"], ["numberNow", "--number-now"], ["feedbackLink", "--feedback-link"], ["ownerFallback", "--owner-fallback"], ["fixedMessageOnFailure", "--fixed-message-on-failure"], ["fixedMessageOnAnyFailure", "--fixed-message-on-any-failure"], ["responseEvidence", "--response-evidence"]]);
// How long a server asked to stop has before it is ended; how long a runner that is restarting or stopping is waited for before the icon
// gives up; how many ten-second waits for the folder's lock a start makes (another start may hold it until its server answers).
const STOP_WAIT_MS = 20_000;
const SETTLE_MS = 180_000;
const LOCK_ATTEMPTS = 18;
const LOG_ROTATE_BYTES = 512 * 1024;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export const LAUNCHER_USAGE = `Usage: node scripts/runner-launcher.mjs [--dir PATH]
       node scripts/runner-launcher.mjs --install --provider mixed|codex|claude [--port N] [--dir PATH] [the start's switches]
       node scripts/runner-launcher.mjs --uninstall [--dir PATH]

  (no flag)    what the icon runs: opens the runner's page, starting the runner first when it isn't running
  --install    writes launcher.json in the trial folder (the provider, port and switches, as scripts/runner-trial-start.mjs takes
               them) and the icon, a desktop entry, in your applications menu; run it once, from the checkout the icon is to use
  --uninstall  takes the icon and launcher.json away again
  --dir PATH   the trial's own folder (default $HOME/.local/share/inner-signal-runner-trial)`;

// A code fit for the log: an error's own code when it has the form of one, never its message, which can quote a file.
const safeCode = (error) => (typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code) ? error.code : "unknown");

// ---- launcher.json ---------------------------------------------------------------------------------------------------------------

// The start's flags for its options, in one order: the provider, the port when it isn't the default, then each switch that is on.
export function startFlags(options) {
  return [
    "--provider", options.provider,
    ...(options.port !== DEFAULT_PORT ? ["--port", String(options.port)] : []),
    ...SWITCH_FLAGS.filter(([key]) => options[key] === true).map(([, flag]) => flag)
  ];
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

// launcher.json as the install writes it, checked strictly: a start the start script takes (never --prepare-only, --add-client,
// --journal-consent or --dir, since the folder is the one the file is in), in the install's own order, and the environment's allowed
// variables, each an absolute path. Anything else is refused, with fixed words that never repeat what the file holds.
export function validateLauncherSettings(value, file = LAUNCHER_SETTINGS_FILE) {
  const refuse = (what) => { throw new StartError(`${file} ${what}; install the icon again.`); };
  const keys = ["schema_version", "kind", "start", "environment", "installed_at"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) refuse("has unexpected fields");
  if (value.schema_version !== 1 || value.kind !== SETTINGS_KIND) refuse("isn't the launcher's settings");
  if (!Array.isArray(value.start) || value.start.length > 32 || !value.start.every((item) => typeof item === "string" && item.length > 0 && item.length <= 64)) refuse("holds no start flags of the start's form");
  let options;
  try { options = parseArguments(value.start); } catch { refuse("holds flags the start doesn't take"); }
  if (options.addClient || options.journalConsent !== null || options.prepareOnly || options.dir !== null
    || JSON.stringify(startFlags(options)) !== JSON.stringify(value.start)) refuse("holds flags other than a start's");
  const environment = value.environment;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) refuse("has an environment of another form");
  for (const [key, entry] of Object.entries(environment)) {
    if (!SETTINGS_ENVIRONMENT.includes(key) || typeof entry !== "string" || entry.length > 4096 || !path.isAbsolute(entry) || /\p{Cc}/u.test(entry)) refuse("has an environment of another form");
  }
  if (typeof value.installed_at !== "string" || !ISO_TIME.test(value.installed_at) || Number.isNaN(Date.parse(value.installed_at))) refuse("has no time of its install");
  return Object.freeze({ options, environment: Object.freeze({ ...environment }), installedAt: value.installed_at });
}

// Reads launcher.json from the trial folder: a file only its owner can read (mode 0600), not a link.
export async function readLauncherSettings(home) {
  const file = path.join(home, LAUNCHER_SETTINGS_FILE);
  let text;
  let handle;
  try { handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch (error) {
    if (error?.code === "ENOENT") throw new StartError(`There's no ${LAUNCHER_SETTINGS_FILE} in ${home}: install the icon first (node scripts/runner-launcher.mjs --install ...).`);
    if (error?.code === "ELOOP") throw new StartError(`${file} must be a file, not a link; install the icon again.`);
    throw new StartError(`${file} can't be read (code ${safeCode(error)}).`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new StartError(`${file} must be a file; install the icon again.`);
    if ((info.mode & 0o077) !== 0) throw new StartError(`${file} can be read by others (it must be mode 0600); install the icon again.`);
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new StartError(`${file} belongs to another user.`);
    text = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new StartError(`${file} isn't valid JSON; install the icon again.`); }
  return validateLauncherSettings(value, file);
}

// ---- The icon ---------------------------------------------------------------------------------------------------------------------

// Where desktop entries go: $XDG_DATA_HOME, or $HOME/.local/share, then applications/.
export function defaultDataHome(environment = process.env) {
  const value = environment.XDG_DATA_HOME?.trim();
  return value && path.isAbsolute(value) ? value : path.join(environment.HOME?.trim() || os.homedir(), ".local", "share");
}

// A character a desktop entry's Exec or Icon can't carry as it is (the quoting and field codes of the Desktop Entry Specification), or a
// control character: a path holding one is refused rather than escaped.
const ENTRY_UNSAFE = /["`$\\%\p{Cc}]/u;

// The icon: a desktop entry that runs this checkout's launcher with Node 24, without a terminal. Every path is absolute and quoted.
export function desktopEntry({ node, launcher = LAUNCHER_SCRIPT, icon = LAUNCHER_ICON, dir = null }) {
  const paths = [node, launcher, icon, ...(dir === null ? [] : [dir])];
  for (const entry of paths) {
    if (typeof entry !== "string" || !path.isAbsolute(entry)) throw new StartError("The icon names absolute paths only.");
    if (ENTRY_UNSAFE.test(entry)) throw new StartError("A path the icon names holds a character a desktop entry can't carry (\", `, $, \\, % or a control character): install from a checkout, a Node and a trial folder whose paths have none.");
  }
  const exec = [node, launcher, ...(dir === null ? [] : ["--dir", dir])].map((argument) => `"${argument}"`).join(" ");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.5",
    "Name=InnerSignal runner",
    "Comment=Start InnerSignal's runner trial and open its page",
    `Exec=${exec}`,
    `Icon=${icon}`,
    "Terminal=false",
    "StartupNotify=false",
    "Categories=Utility;",
    ""
  ].join("\n");
}

// Written whole or not at all, with exactly this mode: a new file beside it, synced, then renamed over it.
async function writeWhole(file, text, mode) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fsp.open(temporary, "wx", mode);
  try {
    await handle.chmod(mode);
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

// --install: the start's flags (as scripts/runner-trial-start.mjs takes them, with --dir for the folder) go into launcher.json, with the
// workers' commands as found now (so the icon runs them whatever the desktop's PATH holds); the icon goes into the applications menu. It
// writes nothing else and starts nothing. Returns what it wrote.
export async function installLauncher({ argv, environment = process.env, dataHome = defaultDataHome(environment), node = nodeForServer(), now = () => new Date() }) {
  const options = parseArguments(argv);
  if (options.addClient || options.journalConsent !== null || options.prepareOnly) {
    throw new StartError(`--install takes a start's flags (--provider, --port, --dir and the switches), not --add-client, --journal-consent or --prepare-only.\n\n${LAUNCHER_USAGE}`, 2);
  }
  if (process.platform !== "linux") throw new StartError("The icon is a desktop entry for Linux desktops; elsewhere, start the runner with scripts/runner-trial-start.mjs.");
  if (typeof dataHome !== "string" || !path.isAbsolute(dataHome)) throw new StartError("The folder for the applications menu must be an absolute path.");
  const home = checkTrialHome(options.dir ?? defaultTrialHome());
  const found = {};
  for (const { name, setting, command, help } of workerCommands(options.provider, environment)) {
    const where = commandPath(command, environment);
    if (where === null) throw new StartError(`The ${name} command (${command}) isn't on PATH, so the trial's workers couldn't run.${help}`);
    found[setting] = where;
  }
  const claudeFolder = environment[RUNNER_CLAUDE_CONFIG_DIR]?.trim();
  if (claudeFolder) found[RUNNER_CLAUDE_CONFIG_DIR] = claudeFolder;
  const settings = { schema_version: 1, kind: SETTINGS_KIND, start: startFlags(options), environment: found, installed_at: now().toISOString() };
  validateLauncherSettings(settings);
  const entry = desktopEntry({ node, dir: options.dir === null ? null : home });
  await privateFolder(home, "The trial folder");
  const settingsFile = path.join(home, LAUNCHER_SETTINGS_FILE);
  await writePrivateFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  const applications = path.join(dataHome, "applications");
  await fsp.mkdir(applications, { recursive: true, mode: 0o755 });
  const entryFile = path.join(applications, DESKTOP_ENTRY_FILE);
  await writeWhole(entryFile, entry, 0o644);
  return Object.freeze({ settingsFile, entryFile, node, start: Object.freeze([...settings.start]) });
}

// --uninstall: the icon and launcher.json go; the trial folder and everything else in it stay. Returns what it removed.
export async function uninstallLauncher({ home, dataHome = defaultDataHome() }) {
  const removed = [];
  for (const file of [path.join(dataHome, "applications", DESKTOP_ENTRY_FILE), path.join(home, LAUNCHER_SETTINGS_FILE)]) {
    try { await fsp.rm(file); removed.push(file); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return Object.freeze(removed);
}

// ---- The launcher's log -----------------------------------------------------------------------------------------------------------

// launcher.log in the trial folder, mode 0600, not a link: each line the time and fixed words, with numbers, paths and codes, never a
// person's words. Past 512 KiB it starts again, the last one kept as launcher.log.1.
export function openLauncherLog(home) {
  const file = path.join(home, LAUNCHER_LOG_FILE);
  try {
    const info = fs.lstatSync(file);
    if (info.isFile() && info.size > LOG_ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
  } catch { /* none yet */ }
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) { throw new StartError(error?.code === "ELOOP" ? `${file} must be a file, not a link.` : `${file} can't be opened (code ${safeCode(error)}).`); }
  const info = fs.fstatSync(fd);
  if (!info.isFile()) {
    fs.closeSync(fd);
    throw new StartError(`${file} must be a file.`);
  }
  if ((info.mode & 0o777) !== 0o600) fs.fchmodSync(fd, 0o600);
  let open = true;
  return Object.freeze({
    file,
    write(text) {
      if (!open) return;
      for (const line of String(text).split("\n")) {
        if (!line.trim()) continue;
        try { fs.writeSync(fd, `${new Date().toISOString()} ${line}\n`); } catch { /* a log that can't be written never stops the runner */ }
      }
    },
    close() {
      if (!open) return;
      open = false;
      try { fs.closeSync(fd); } catch { /* closed already */ }
    }
  });
}

// ---- What the icon runs -----------------------------------------------------------------------------------------------------------

// What answers on the runner's port: "open" (the trial, taking work), "restarting" or "stopping" (the trial, closing for one of them),
// "down" (nothing listens), "silent" (no answer in time) or "other" (something that isn't the trial).
export async function probeRunner(port, { timeoutMs = 5_000 } = {}) {
  let response;
  try { response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }); }
  catch (error) { return error?.name === "TimeoutError" ? "silent" : "down"; }
  let health = null;
  try { health = await response.json(); } catch { /* not the trial's answer */ }
  if (!response.ok || health?.ok !== true || health.runnerTrial !== "on") return "other";
  return health.runnerLauncher === "restarting" || health.runnerLauncher === "stopping" ? health.runnerLauncher : "open";
}

// The page in the browser, as the desktop opens a link. A browser that can't be opened is logged, never fatal.
export function openPage(url, { log, platform = process.platform, spawnCommand = spawn }) {
  const command = platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve) => {
    const failed = (error) => {
      log.write(`The browser couldn't be opened (code ${safeCode(error)}): open ${url} yourself.`);
      resolve(false);
    };
    let child;
    try { child = spawnCommand(command, [url], { detached: true, stdio: "ignore" }); } catch (error) { failed(error); return; }
    child.once("error", failed);
    child.once("spawn", () => {
      child.unref();
      log.write(`Opened the page: ${url}`);
      resolve(true);
    });
  });
}

// A desktop notification in fixed words, where the desktop has notify-send: without a terminal the owner would otherwise see nothing of a
// start that failed. Best effort: none is shown where it can't be.
export function tellOwner(words, { spawnCommand = spawn } = {}) {
  try {
    const child = spawnCommand("notify-send", ["--app-name=InnerSignal", "InnerSignal runner", words], { detached: true, stdio: "ignore" });
    child.once("error", () => {});
    child.unref();
  } catch { /* no notification */ }
}

// The messages a server sends, kept from its spawn on: the page may ask for a restart or a stop before the launcher has seen the server
// answer, and a message no one listens for would be lost.
function listenTo(child) {
  const inbox = { messages: [], wake: () => {} };
  child.on("message", (message) => {
    inbox.messages.push(message);
    inbox.wake();
  });
  return inbox;
}

// The icon's whole run, with what it calls passed in (the tests pass stand-ins): `launch({ startLock, released, onSpawn })` makes one
// start (launchTrialServer with the owner's options), `probe(port)` says what answers on the port, `open(url)` opens the page,
// `tell(words)` notifies the owner. Returns the exit code: 0 once the page is open and the runner stopped on request (or was running
// already), 1 when a start failed or the server stopped by itself.
export async function runLauncher({ home, settings, log, launch, open, tell, probe = probeRunner, signals = process, stopWaitMs = STOP_WAIT_MS, settleMs = SETTLE_MS, settlePauseMs = 1_000, lockAttempts = LOCK_ATTEMPTS, lockWaitMs = COMMAND_LOCK_WAIT_MS }) {
  const { port } = settings.options;
  const url = `http://127.0.0.1:${port}`;
  const failed = (words) => { tell(`${words} What happened is in ${log.file}.`); return 1; };
  const startFailed = (error) => {
    log.write(error instanceof StartError || error instanceof TrialFolderLockError ? error.message : `The start failed (code ${safeCode(error)}).`);
    const left = folderLockLeftNotice(error);
    if (left) log.write(left);
  };
  const codesText = (launched) => {
    const codes = launched.codes?.() ?? [];
    return codes.length ? `; codes ${codes.join(", ")}` : "";
  };
  const endText = ({ code, signal }) => `exit code ${code ?? "none"}${signal ? `, signal ${signal}` : ""}`;

  let pendingSignal = null;
  let wake = () => {};
  const handlers = ["SIGTERM", "SIGINT", "SIGHUP"].map((name) => [name, () => { pendingSignal ??= name; wake(); }]);
  for (const [name, handler] of handlers) signals.on(name, handler);

  // What answers once a runner that is restarting or stopping (or slow to answer) has settled, or the time is up.
  const settle = async () => {
    const deadline = Date.now() + settleMs;
    for (;;) {
      const state = await probe(port);
      if (!["restarting", "stopping", "silent"].includes(state) || Date.now() >= deadline) return state;
      await pause(settlePauseMs);
    }
  };

  // One start, under the folder's lock. Another start may hold it until its server answers (the icon clicked twice, or a start from a
  // terminal): this one waits for it, and finding a runner answering then, starts nothing ("answering"). So for a restart too: a runner
  // another start brought up between its stop and its start is left to run.
  const startOnce = async (released) => {
    let lock = null;
    for (let attempt = 1; lock === null; attempt += 1) {
      try { lock = await acquireTrialFolderLock(home, { waitMs: lockWaitMs }); } catch (error) {
        if (error?.code !== "RUNNER_FOLDER_LOCKED" || attempt >= lockAttempts) throw error;
        if (await probe(port) === "open") return "answering";
      }
    }
    if (await probe(port) === "open") {
      await lock.release();
      return "answering";
    }
    let inbox = null;
    let launched;
    try { launched = await launch({ startLock: lock, released, onSpawn: (child) => { inbox = listenTo(child); } }); } catch (error) {
      await releaseAfterFailure(lock, home, error);
      throw error;
    }
    return Object.freeze({ ...launched, inbox: inbox ?? listenTo(launched.child) });
  };

  // A start's server that didn't answer: one that stopped first is logged with its exit code and the codes it named (a timeout the
  // start has logged already).
  const notReady = async (launched) => {
    if (launched.ready.timedOut) return;
    log.write(`The server stopped before it was ready (${endText(await launched.exited)}${codesText(launched)}).`);
  };

  // Asks the server to stop (it finishes what it is sending, closes its listeners and lets go of the vault), and ends it when it hasn't
  // stopped in time.
  const stopServer = async ({ child, exited }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    let timer;
    const ended = await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve(null), stopWaitMs); })]);
    clearTimeout(timer);
    if (ended) return ended;
    log.write(`The server didn't stop within ${Math.round(stopWaitMs / 1000)} seconds of being asked: it was ended.`);
    child.kill("SIGKILL");
    return exited;
  };

  // The next thing to act on: the server's restart or stop (the first kept since its spawn), the server's end, or a stop signal to the
  // launcher.
  const nextEvent = ({ inbox, exited }) => new Promise((resolve) => {
    let settled = false;
    const finish = (event) => {
      if (settled) return;
      settled = true;
      inbox.wake = () => {};
      wake = () => {};
      resolve(event);
    };
    const read = () => {
      while (!settled && inbox.messages.length) {
        const action = readLauncherMessage(inbox.messages.shift());
        if (action) finish({ type: "message", action });
        else log.write("A message from the server that is neither a restart nor a stop was ignored.");
      }
    };
    if (pendingSignal) {
      finish({ type: "signal", signal: pendingSignal });
      return;
    }
    inbox.wake = read;
    wake = () => finish({ type: "signal", signal: pendingSignal });
    exited.then((end) => finish({ type: "exit", ...end }));
    read();
  });

  const supervise = async (first) => {
    let current = first;
    for (;;) {
      const event = await nextEvent(current);
      if (event.type === "exit") {
        log.write(`The server stopped by itself (${endText(event)}${codesText(current)}).`);
        return failed("The runner stopped. Start it again with the InnerSignal runner icon.");
      }
      if (event.type === "signal") {
        log.write(`The launcher was asked to stop (${event.signal}): stopping the server.`);
        log.write(`The server stopped (${endText(await stopServer(current))}).`);
        return 0;
      }
      if (event.action === "stop") {
        log.write("Stop asked on the page: stopping the server.");
        log.write(`Stopped (${endText(await stopServer(current))}): the icon starts it again.`);
        return 0;
      }
      log.write("Restart asked on the page: stopping the server, to start it again with new grants and the rules it runs.");
      log.write(`The server stopped (${endText(await stopServer(current))}).`);
      if (pendingSignal) {
        log.write(`The launcher was asked to stop (${pendingSignal}): no restart.`);
        return 0;
      }
      let next;
      try { next = await startOnce(current.released); } catch (error) {
        startFailed(error);
        return failed("The runner stopped for its restart and couldn't start again. Start it with the InnerSignal runner icon.");
      }
      if (next === "answering") {
        log.write(`Another start of the runner answers on port ${port} now: this launcher leaves it to run and ends.`);
        return 0;
      }
      if (!next.ready.health) {
        await notReady(next);
        return failed("The runner stopped for its restart and couldn't start again. Start it with the InnerSignal runner icon.");
      }
      log.write("Restarted.");
      current = next;
    }
  };

  try {
    const state = await settle();
    if (state === "open") {
      log.write(`The runner already answers on port ${port}: opening its page.`);
      await open(url);
      return 0;
    }
    if (state !== "down") {
      log.write(state === "other" ? `Something that isn't the runner answers on port ${port}.` : `The runner on port ${port} didn't settle (${state}).`);
      return failed(state === "other" ? `Another program uses port ${port}, so the runner couldn't start.` : "The runner is busy restarting or stopping; try the icon again in a moment.");
    }
    let first;
    try { first = await startOnce(null); } catch (error) {
      startFailed(error);
      return failed("The runner couldn't start.");
    }
    if (first === "answering") {
      log.write(`Another start of the runner finished meanwhile on port ${port}: opening its page.`);
      await open(url);
      return 0;
    }
    if (!first.ready.health) {
      await notReady(first);
      return failed("The runner couldn't start.");
    }
    await open(url);
    return await supervise(first);
  } finally {
    for (const [name, handler] of handlers) signals.off(name, handler);
  }
}

// ---- The command ------------------------------------------------------------------------------------------------------------------

// What the icon and --uninstall take: --dir PATH alone.
function parseFolderArgument(argv) {
  let dir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") throw new StartError(LAUNCHER_USAGE, 0);
    if (argument === "--dir" || argument.startsWith("--dir=")) {
      if (dir !== null) throw new StartError(`--dir is given twice.\n\n${LAUNCHER_USAGE}`, 2);
      dir = argument === "--dir" ? argv[++index] : argument.slice("--dir=".length);
      if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new StartError(`--dir must be an absolute path.\n\n${LAUNCHER_USAGE}`, 2);
      continue;
    }
    throw new StartError(`Unknown argument: ${argument.startsWith("-") ? argument : "(a value without its option)"}\n\n${LAUNCHER_USAGE}`, 2);
  }
  return dir;
}

async function runInstall(argv) {
  const installed = await installLauncher({ argv });
  console.log("Installed the InnerSignal runner icon:");
  console.log(`  ${installed.entryFile}: "InnerSignal runner" in your applications menu (you can pin it to the dock).`);
  console.log(`  ${installed.settingsFile}: it starts the runner with ${installed.start.join(" ")}.`);
  console.log(`  It runs ${LAUNCHER_SCRIPT} with ${installed.node}.`);
  console.log("A runner started from a terminal keeps running: stop it there once (Ctrl+C), then start it with the icon.");
  return 0;
}

async function runUninstall(argv) {
  const dir = parseFolderArgument(argv);
  const removed = await uninstallLauncher({ home: checkTrialHome(dir ?? defaultTrialHome()) });
  console.log(removed.length ? `Removed: ${removed.join(", ")}.` : "Nothing to remove: the icon wasn't installed.");
  return 0;
}

// What the icon runs. Everything it says goes to its log; a failure is also told on the desktop.
async function runIcon(argv) {
  const home = checkTrialHome(parseFolderArgument(argv) ?? defaultTrialHome());
  await privateFolder(home, "The trial folder");
  const log = openLauncherLog(home);
  try {
    log.write(`The launcher started (pid ${process.pid}) from ${repositoryRoot}.`);
    let settings;
    let commands;
    let claudeConfigDir;
    try {
      settings = await readLauncherSettings(home);
      for (const [key, value] of Object.entries(settings.environment)) process.env[key] = value;
      commands = workerCommands(settings.options.provider);
      claudeConfigDir = claudeFolderFor(settings.options.provider);
    } catch (error) {
      log.write(error instanceof StartError ? error.message : `The launcher's settings can't be read (code ${safeCode(error)}).`);
      tellOwner(`The runner couldn't start: its settings can't be read. What happened is in ${log.file}.`);
      return 1;
    }
    const { options } = settings;
    const output = Object.freeze({ say: (line) => log.write(line), warn: (line) => log.write(line), fail: (line) => log.write(line) });
    const code = await runLauncher({
      home,
      settings,
      log,
      launch: ({ startLock, released, onSpawn }) => launchTrialServer({ options, home, commands, claudeConfigDir, startLock, released, launcher: true, output, stopHint: LAUNCHER_STOP_HINT, onSpawn }),
      open: (url) => openPage(url, { log }),
      tell: (words) => tellOwner(words)
    });
    log.write(`The launcher ends (exit code ${code}).`);
    return code;
  } finally {
    log.close();
  }
}

async function main(argv) {
  if (argv[0] === "--install") return runInstall(argv.slice(1));
  if (argv[0] === "--uninstall") return runUninstall(argv.slice(1));
  return runIcon(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = process.argv[2];
  main(process.argv.slice(2)).then(
    (code) => { process.exit(code); },
    (error) => {
      if (error instanceof StartError) (error.exitCode === 0 ? console.log : console.error)(error.message);
      else console.error(`The runner launcher failed (code ${safeCode(error)}).`);
      const lockLeft = folderLockLeftNotice(error);
      if (lockLeft) console.error(lockLeft);
      // Without a terminal, the icon tells the owner on the desktop too.
      if (command !== "--install" && command !== "--uninstall" && command !== "--help" && command !== "-h") tellOwner("The runner couldn't start. Start it again with the InnerSignal runner icon.");
      process.exit(error instanceof StartError ? error.exitCode : 1);
    }
  );
}
