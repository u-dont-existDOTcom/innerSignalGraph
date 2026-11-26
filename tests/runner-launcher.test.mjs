import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESKTOP_ENTRY_FILE, LAUNCHER_ICON, LAUNCHER_LOG_FILE, LAUNCHER_SCRIPT, LAUNCHER_SETTINGS_FILE, desktopEntry, installLauncher, openLauncherLog, readLauncherSettings, runLauncher, startFlags, uninstallLauncher, validateLauncherSettings } from "../scripts/runner-launcher.mjs";
import { DEFAULT_PORT, StartError, addClient, parseArguments, setJournalConsent } from "../scripts/runner-trial-start.mjs";
import { TRIAL_FOLDER_LOCK_FILE, acquireTrialFolderLock } from "../src/runner-trial/folder-lock.mjs";
import { launcherMessage } from "../src/runner-trial/launcher-link.mjs";

// The icon's launcher (scripts/runner-launcher.mjs; docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md,
// section 10, pull request 2): its install, launcher.json, the icon's desktop entry, its log, and what it does when the icon is clicked,
// first with stand-ins for the server, then once for real on loopback. No model is called, no browser opens (a stand-in records the
// address), no notification is shown, and nothing is written outside each test's own folder: every test names its trial folder
// (--dir), its applications folder (XDG_DATA_HOME) and, for the real runs, its HOME.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
// The owner's start, as his runner runs it from a terminal.
const OWNER_FLAGS = Object.freeze(["--provider", "mixed", "--kept-plan", "--number-now", "--owner-fallback", "--fixed-message-on-failure", "--fixed-message-on-any-failure", "--feedback-link"]);
// Planted where a person's words would be, and looked for in every log and output: a label may show only in the page's list of people.
const PLANTED_LABEL = "Quillborne Vexmarra";
const PLANTED_WORD = "Zantrophelia";
const VALID_SETTINGS = Object.freeze({ schema_version: 1, kind: "inner_signal_runner_launcher", start: startFlags(parseArguments(OWNER_FLAGS)), environment: { CODEX_COMMAND: "/synthetic/bin/codex", CLAUDE_COMMAND: "/synthetic/bin/claude" }, installed_at: "2026-11-26T12:00:00.000Z" });

async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const mode = async (file) => (await fs.stat(file)).mode & 0o777;

// A stand-in command: a shell script, executable.
async function standIn(folder, name, body = "exit 0") {
  const file = path.join(folder, name);
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

// Every file under a folder, as paths relative to it, sorted.
async function listTree(root) {
  const found = [];
  const walk = async (folder) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(path.relative(root, full));
    }
  };
  await walk(root);
  return found.sort();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// What `promise` gives within `ms`, or null; its timer never outlives it.
async function within(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}

// Waits, a turn of the event loop at a time, until `condition()` holds.
async function until(condition, { timeoutMs = 5_000, what = "the condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

// ---- The install and launcher.json -----------------------------------------------------------------------------------------------

test("the install keeps the owner's start in launcher.json (mode 0600), puts the icon in the given applications folder, and writes nothing else", async (t) => {
  const dir = await tempDir(t, "launcher-install");
  const home = path.join(dir, "trial");
  const dataHome = path.join(dir, "data");
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  const codex = await standIn(bin, "codex");
  const claude = await standIn(bin, "claude");
  const installed = await installLauncher({ argv: [...OWNER_FLAGS, "--dir", home], environment: { PATH: bin, HOME: path.join(dir, "home") }, dataHome, node: process.execPath, now: () => new Date("2026-11-26T12:00:00.000Z") });
  assert.deepEqual([installed.settingsFile, installed.entryFile], [path.join(home, LAUNCHER_SETTINGS_FILE), path.join(dataHome, "applications", DESKTOP_ENTRY_FILE)]);
  assert.deepEqual(JSON.parse(await fs.readFile(installed.settingsFile, "utf8")), {
    schema_version: 1,
    kind: "inner_signal_runner_launcher",
    start: ["--provider", "mixed", "--kept-plan", "--number-now", "--feedback-link", "--owner-fallback", "--fixed-message-on-failure", "--fixed-message-on-any-failure"],
    environment: { CODEX_COMMAND: codex, CLAUDE_COMMAND: claude },
    installed_at: "2026-11-26T12:00:00.000Z"
  }, "the owner's switches, and the workers' commands as the install found them");
  assert.deepEqual([await mode(home), await mode(installed.settingsFile), await mode(installed.entryFile)], [0o700, 0o600, 0o644]);
  assert.deepEqual({ ...(await readLauncherSettings(home)).options }, { ...parseArguments(OWNER_FLAGS) }, "the icon starts exactly the owner's start");
  assert.equal(await fs.readFile(installed.entryFile, "utf8"), [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.5",
    "Name=InnerSignal runner",
    "Comment=Start InnerSignal's runner trial and open its page",
    `Exec="${process.execPath}" "${LAUNCHER_SCRIPT}" "--dir" "${home}"`,
    `Icon=${LAUNCHER_ICON}`,
    "Terminal=false",
    "StartupNotify=false",
    "Categories=Utility;",
    ""
  ].join("\n"), "this checkout's launcher on Node 24, with no terminal");
  assert.match(await fs.readFile(LAUNCHER_ICON, "utf8"), /^<svg /u, "the icon's picture is in the checkout");
  const validator = spawnSync("desktop-file-validate", [installed.entryFile], { encoding: "utf8" });
  if (!validator.error) assert.deepEqual([validator.status, `${validator.stdout}${validator.stderr}`], [0, ""], "the desktop entry passes desktop-file-validate");
  assert.deepEqual(await listTree(dir), ["bin/claude", "bin/codex", "data/applications/inner-signal-runner.desktop", "trial/launcher.json"], "nothing else is written");
});

test("the install refuses what isn't a start, a worker's command it can't find, and paths a desktop entry can't carry, writing nothing", async (t) => {
  const dir = await tempDir(t, "launcher-install-refusals");
  const home = path.join(dir, "trial");
  const dataHome = path.join(dir, "data");
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  await standIn(bin, "codex");
  const environment = { PATH: bin };
  const install = (argv, extra = {}) => installLauncher({ argv: [...argv, "--dir", home], environment, dataHome, node: process.execPath, ...extra });
  const usage = (pattern) => (error) => error instanceof StartError && error.exitCode === 2 && pattern.test(error.message);
  await assert.rejects(install(["--add-client"]), usage(/--install takes a start's flags/u));
  await assert.rejects(install(["--provider", "codex", "--prepare-only"]), usage(/--install takes a start's flags/u));
  await assert.rejects(install([]), usage(/Choose the provider/u));
  await assert.rejects(install(["--provider", "codex", "--fixed-message-on-failure"]), usage(/give --owner-fallback too/u));
  await assert.rejects(install(["--provider", "mixed"]), /The Claude command \(claude\) isn't on PATH/u, "mixed needs Claude's command too");
  await assert.rejects(install(["--provider", "codex"], { environment: { PATH: "" } }), /The Codex command \(codex\) isn't on PATH/u);
  await assert.rejects(install(["--provider", "codex"], { dataHome: "relative/data" }), /must be an absolute path/u);
  await assert.rejects(installLauncher({ argv: ["--provider", "codex", "--dir", path.join(dir, "a$b")], environment, dataHome, node: process.execPath }), /can't carry/u);
  await assert.rejects(installLauncher({ argv: ["--provider", "codex", "--dir", path.join(repositoryRoot, "synthetic-trial")], environment, dataHome, node: process.execPath }), /outside the InnerSignal checkout/u);
  assert.deepEqual(await listTree(dir), ["bin/codex"], "nothing was written");
  // A space is carried inside the quotes; ", `, $, \, % and control characters are refused, never escaped.
  const spaced = desktopEntry({ node: "/synthetic/node 24/bin/node", launcher: "/synthetic/check out/scripts/runner-launcher.mjs", icon: "/synthetic/check out/scripts/runner-launcher-icon.svg", dir: "/synthetic/my trial" });
  assert.match(spaced, /^Exec="\/synthetic\/node 24\/bin\/node" "\/synthetic\/check out\/scripts\/runner-launcher\.mjs" "--dir" "\/synthetic\/my trial"$/mu);
  for (const bad of ['/synthetic/a"b', "/synthetic/a`b", "/synthetic/a$b", "/synthetic/a\\b", "/synthetic/a%b", "/synthetic/a\nb"]) {
    assert.throws(() => desktopEntry({ node: process.execPath, dir: bad }), /can't carry/u, JSON.stringify(bad));
  }
  assert.throws(() => desktopEntry({ node: "node" }), /absolute paths only/u);
  assert.doesNotMatch(desktopEntry({ node: process.execPath }), /--dir/u, "without --dir the launcher takes the default folder");
});

test("launcher.json is read strictly: mode 0600, never through a link, no other field, and a start of the install's own form; a refusal quotes nothing", async (t) => {
  const dir = await tempDir(t, "launcher-settings");
  const home = path.join(dir, "trial");
  await fs.mkdir(home, { mode: 0o700 });
  const file = path.join(home, LAUNCHER_SETTINGS_FILE);
  const write = async (value, fileMode = 0o600) => {
    await fs.rm(file, { force: true });
    await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value), { mode: fileMode });
    await fs.chmod(file, fileMode);
  };
  await assert.rejects(readLauncherSettings(home), /There's no launcher\.json in .*: install the icon first/u);
  await write(VALID_SETTINGS);
  const read = await readLauncherSettings(home);
  assert.deepEqual([read.options.provider, read.options.port, read.environment.CODEX_COMMAND, read.installedAt], ["mixed", DEFAULT_PORT, "/synthetic/bin/codex", "2026-11-26T12:00:00.000Z"]);
  await write(VALID_SETTINGS, 0o644);
  await assert.rejects(readLauncherSettings(home), /can be read by others \(it must be mode 0600\)/u);
  await fs.rm(file);
  const elsewhere = path.join(dir, "elsewhere.json");
  await fs.writeFile(elsewhere, JSON.stringify(VALID_SETTINGS), { mode: 0o600 });
  await fs.symlink(elsewhere, file);
  await assert.rejects(readLauncherSettings(home), /must be a file, not a link/u);
  const refusals = [
    [{ ...VALID_SETTINGS, planted: PLANTED_WORD }, /has unexpected fields/u],
    [{ ...VALID_SETTINGS, kind: "something_else" }, /isn't the launcher's settings/u],
    [{ ...VALID_SETTINGS, start: [...VALID_SETTINGS.start, "--dir", "/synthetic/elsewhere"] }, /other than a start's/u],
    [{ ...VALID_SETTINGS, start: [...VALID_SETTINGS.start, "--prepare-only"] }, /other than a start's/u],
    [{ ...VALID_SETTINGS, start: ["--kept-plan", "--provider", "mixed"] }, /other than a start's/u],
    [{ ...VALID_SETTINGS, start: ["--add-client"] }, /other than a start's/u],
    [{ ...VALID_SETTINGS, start: ["--provider", "mixed", "--fixed-message-on-failure"] }, /flags the start doesn't take/u],
    [{ ...VALID_SETTINGS, start: [PLANTED_WORD] }, /flags the start doesn't take/u],
    [{ ...VALID_SETTINGS, start: "--provider mixed" }, /no start flags of the start's form/u],
    [{ ...VALID_SETTINGS, environment: { PATH: "/synthetic/bin" } }, /environment of another form/u],
    [{ ...VALID_SETTINGS, environment: { CODEX_COMMAND: "codex" } }, /environment of another form/u],
    [{ ...VALID_SETTINGS, environment: { CODEX_COMMAND: `/synthetic/${PLANTED_WORD}\n` } }, /environment of another form/u],
    [{ ...VALID_SETTINGS, installed_at: "yesterday" }, /no time of its install/u],
    [`{"planted": "${PLANTED_WORD}"`, /isn't valid JSON/u]
  ];
  for (const [value, pattern] of refusals) {
    await write(value);
    await assert.rejects(readLauncherSettings(home), (error) => error instanceof StartError && pattern.test(error.message) && !error.message.includes(PLANTED_WORD), JSON.stringify(value).slice(0, 90));
  }
});

test("--uninstall takes away the icon and launcher.json, and leaves the trial folder and everything else in it", async (t) => {
  const dir = await tempDir(t, "launcher-uninstall");
  const home = path.join(dir, "trial");
  const dataHome = path.join(dir, "data");
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  await standIn(bin, "codex");
  const installed = await installLauncher({ argv: ["--provider", "codex", "--dir", home], environment: { PATH: bin }, dataHome, node: process.execPath });
  await fs.writeFile(path.join(home, "clients.json"), "{}", { mode: 0o600 });
  await fs.writeFile(path.join(dataHome, "applications", "another.desktop"), "[Desktop Entry]\n");
  assert.deepEqual(await uninstallLauncher({ home, dataHome }), [installed.entryFile, installed.settingsFile]);
  assert.deepEqual(await listTree(dir), ["bin/codex", "data/applications/another.desktop", "trial/clients.json"]);
  assert.deepEqual(await uninstallLauncher({ home, dataHome }), [], "once is enough");
});

test("the launcher's log is mode 0600 and puts the time on each line; it refuses a link and starts again past its size", async (t) => {
  const dir = await tempDir(t, "launcher-log");
  const file = path.join(dir, LAUNCHER_LOG_FILE);
  await fs.writeFile(file, "", { mode: 0o644 });
  await fs.chmod(file, 0o644);
  const log = openLauncherLog(dir);
  log.write("First line.\n\nSecond line.");
  log.close();
  log.write("After it was closed.");
  assert.equal(await mode(file), 0o600, "made only the owner's, whatever it was");
  const lines = (await fs.readFile(file, "utf8")).trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z First line\.$/u);
  assert.match(lines[1], /Z Second line\.$/u);
  await fs.writeFile(file, "x".repeat(600 * 1024));
  openLauncherLog(dir).close();
  assert.deepEqual([(await fs.stat(`${file}.1`)).size, (await fs.stat(file)).size], [600 * 1024, 0], "past 512 KiB the last log is kept beside the new one");
  await fs.rm(file);
  await fs.symlink(path.join(dir, "elsewhere.log"), file);
  assert.throws(() => openLauncherLog(dir), /must be a file, not a link/u);
  await assert.rejects(fs.stat(path.join(dir, "elsewhere.log")), { code: "ENOENT" }, "nothing is written through the link");
});

// ---- What the icon does, with stand-ins for the server ---------------------------------------------------------------------------

// A stand-in for the server's process: it hears messages like the real one's IPC channel, and ends when asked to stop (unless told not
// to), or when the test ends it.
function fakeServer({ stops = true } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = [];
  let finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  child.end = (code = 0, signal = null) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.exitCode = code;
    child.signalCode = signal;
    finish({ code, signal });
  };
  child.kill = (signal) => {
    child.killed.push(signal);
    if (stops || signal === "SIGKILL") setImmediate(() => child.end(signal === "SIGKILL" ? null : 0, signal === "SIGKILL" ? "SIGKILL" : null));
    return true;
  };
  return { child, exited };
}

const SYNTHETIC_RULES = Object.freeze({ rulesRoot: "/synthetic/released-rules/plugins/inner-signal-therapy", source: "stable 000000000" });

// runLauncher with stand-ins: `probes` are what the port answers, in turn (the last one again and again); `launch(call, n)` makes the
// n-th start (by default a stand-in server that answers, letting go of the folder's lock as the real start does); `prepare(home)` runs
// before the launcher does.
async function launcherRun(t, { probes = ["down"], launch = null, settings = VALID_SETTINGS, prepare = async () => {}, ...options } = {}) {
  const home = await tempDir(t, "launcher-run");
  await prepare(home);
  const logged = [];
  const log = Object.freeze({ file: path.join(home, LAUNCHER_LOG_FILE), write: (text) => logged.push(...String(text).split("\n").filter((line) => line.trim())), close: () => {} });
  const opened = [];
  const told = [];
  const launched = [];
  const handles = [];
  const signals = new EventEmitter();
  let probeCount = 0;
  const answering = async ({ startLock, released, onSpawn }) => {
    const server = fakeServer();
    onSpawn(server.child);
    await startLock.release();
    return Object.freeze({ ...server, released: released ?? SYNTHETIC_RULES, ready: { health: { ok: true, runnerTrial: "on", runnerLauncher: "on" } }, codes: () => Object.freeze([]) });
  };
  const run = runLauncher({
    home,
    settings: validateLauncherSettings(settings),
    log,
    signals,
    probe: async () => probes[Math.min(probeCount++, probes.length - 1)],
    open: async (url) => { opened.push(url); },
    tell: (words) => { told.push(words); },
    launch: async (call) => {
      launched.push(call);
      const handle = await (launch ?? answering)(call, launched.length);
      handles.push(handle);
      return handle;
    },
    stopWaitMs: 200,
    settleMs: 2_000,
    settlePauseMs: 1,
    lockAttempts: 3,
    lockWaitMs: 50,
    ...options
  });
  return { home, run, logged, opened, told, launched, handles, signals, text: () => logged.join("\n") };
}

const URL_8797 = `http://127.0.0.1:${DEFAULT_PORT}`;

test("clicking the icon while the runner runs only opens its page: nothing is started", { timeout: 10_000 }, async (t) => {
  const run = await launcherRun(t, { probes: ["open"] });
  assert.equal(await run.run, 0);
  assert.deepEqual([run.opened, run.launched.length, run.told], [[URL_8797], 0, []]);
  assert.match(run.text(), /The runner already answers on port 8797: opening its page\./u);
});

test("with nothing running the icon starts the runner and opens its page; a restart from the page is the same start again with the rules it runs, and Stop ends it", { timeout: 10_000 }, async (t) => {
  const run = await launcherRun(t);
  await until(() => run.opened.length === 1, { what: "the page" });
  assert.equal(run.launched.length, 1);
  assert.equal(run.launched[0].released, null, "the first start fetches the released rules");
  const [first] = run.handles;
  first.child.emit("message", launcherMessage("restart"));
  await until(() => run.logged.includes("Restarted."), { what: "the restart" });
  assert.deepEqual(first.child.killed, ["SIGTERM"], "the server is asked to stop, then started again");
  assert.equal(run.launched.length, 2);
  assert.equal(run.launched[1].released, SYNTHETIC_RULES, "a restart runs the released rules it already runs: a new release needs a start that fetches it");
  const second = run.handles[1];
  second.child.emit("message", launcherMessage("stop"));
  assert.equal(await run.run, 0);
  assert.deepEqual(second.child.killed, ["SIGTERM"]);
  assert.deepEqual([run.launched.length, run.opened.length, run.told], [2, 1, []], "Stop starts nothing, and a restart doesn't open the page again (the page reloads itself)");
  const text = run.text();
  for (const line of [/Restart asked on the page: stopping the server, to start it again with new grants and the rules it runs\./u, /The server stopped \(exit code 0\)\./u, /Stop asked on the page: stopping the server\./u, /Stopped \(exit code 0\): the icon starts it again\./u]) assert.match(text, line);
});

test("a restart or a stop the page asks for before the launcher has seen the server answer is kept, not lost", { timeout: 10_000 }, async (t) => {
  // The server is asked to stop while the launcher still waits for it to answer: its message comes before anyone listens for it.
  const early = await launcherRun(t, {
    launch: async ({ startLock, onSpawn }) => {
      const server = fakeServer();
      onSpawn(server.child);
      server.child.emit("message", launcherMessage("stop"));
      await startLock.release();
      return Object.freeze({ ...server, released: SYNTHETIC_RULES, ready: { health: { ok: true, runnerTrial: "on", runnerLauncher: "stopping" } }, codes: () => Object.freeze([]) });
    }
  });
  assert.equal(await early.run, 0);
  assert.deepEqual(early.handles[0].child.killed, ["SIGTERM"], "the kept Stop stopped it");
  assert.match(early.text(), /Stop asked on the page: stopping the server\./u);
  // A restart's new server asked to stop at once is stopped too.
  const restarted = await launcherRun(t, {
    launch: async ({ startLock, onSpawn }, n) => {
      const server = fakeServer();
      onSpawn(server.child);
      if (n === 2) server.child.emit("message", launcherMessage("stop"));
      await startLock.release();
      return Object.freeze({ ...server, released: SYNTHETIC_RULES, ready: { health: { ok: true, runnerTrial: "on", runnerLauncher: n === 2 ? "stopping" : "on" } }, codes: () => Object.freeze([]) });
    }
  });
  await until(() => restarted.opened.length === 1, { what: "the page" });
  restarted.handles[0].child.emit("message", launcherMessage("restart"));
  assert.equal(await restarted.run, 0);
  assert.deepEqual([restarted.launched.length, restarted.handles[1].child.killed], [2, ["SIGTERM"]]);
});

test("a runner another start brought up between a restart's stop and its start is left to run: the launcher ends without a notice", { timeout: 10_000 }, async (t) => {
  // The port answers "down" to the icon's first look and to its start's, then "open" once the restart has stopped its own server.
  const run = await launcherRun(t, { probes: ["down", "down", "open"] });
  await until(() => run.opened.length === 1, { what: "the page" });
  run.handles[0].child.emit("message", launcherMessage("restart"));
  assert.equal(await run.run, 0);
  assert.deepEqual([run.launched.length, run.handles[0].child.killed, run.told], [1, ["SIGTERM"], []], "nothing is started over it, and nothing failed");
  assert.match(run.text(), /Another start of the runner answers on port 8797 now: this launcher leaves it to run and ends\./u);
  await (await acquireTrialFolderLock(run.home)).release();
});

test("a server that stops by itself ends the launcher with a notice and the codes it named; a start that fails is told by its code, never its message's words", { timeout: 10_000 }, async (t) => {
  const named = await launcherRun(t, {
    launch: async ({ startLock }) => {
      const server = fakeServer();
      await startLock.release();
      return Object.freeze({ ...server, released: SYNTHETIC_RULES, ready: { health: { ok: true, runnerTrial: "on", runnerLauncher: "on" } }, codes: () => Object.freeze(["BAD_CONFIG"]) });
    }
  });
  await until(() => named.opened.length === 1, { what: "the page" });
  named.handles[0].child.end(1);
  assert.equal(await named.run, 1);
  assert.match(named.text(), /The server stopped by itself \(exit code 1; codes BAD_CONFIG\)\./u);
  assert.equal(named.told.length, 1);
  assert.match(named.told[0], new RegExp(`^The runner stopped\\. Start it again with the InnerSignal runner icon\\. What happened is in ${named.home.replaceAll("/", "\\/")}\\/launcher\\.log\\.$`, "u"));

  // The restart's start fails: an unexpected error is told by its code alone (its message could quote a file); the start's own refusal
  // by its fixed words.
  for (const [failure, expected] of [
    [Object.assign(new Error(`Something quoted ${PLANTED_WORD} from a file.`), { code: "EACCES" }), /The start failed \(code EACCES\)\./u],
    [new StartError("Port 8797 on 127.0.0.1 is in use: is the trial already running?"), /Port 8797 on 127\.0\.0\.1 is in use/u]
  ]) {
    const restarted = await launcherRun(t, {
      launch: async (call, n) => {
        if (n === 2) throw failure;
        const server = fakeServer();
        await call.startLock.release();
        return Object.freeze({ ...server, released: SYNTHETIC_RULES, ready: { health: { ok: true, runnerTrial: "on", runnerLauncher: "on" } }, codes: () => Object.freeze([]) });
      }
    });
    await until(() => restarted.opened.length === 1, { what: "the page" });
    restarted.handles[0].child.emit("message", launcherMessage("restart"));
    assert.equal(await restarted.run, 1);
    assert.match(restarted.text(), expected);
    assert.equal(restarted.text().includes(PLANTED_WORD), false);
    assert.deepEqual(restarted.told.map((words) => words.split(" What happened")[0]), ["The runner stopped for its restart and couldn't start again. Start it with the InnerSignal runner icon."]);
    await assert.doesNotReject(acquireTrialFolderLock(restarted.home).then((lock) => lock.release()), "the folder's lock was let go");
  }
});

test("a message that is neither a restart nor a stop is ignored; a stop signal to the launcher stops the server; one that doesn't stop in time is ended", { timeout: 10_000 }, async (t) => {
  const run = await launcherRun(t);
  await until(() => run.opened.length === 1, { what: "the page" });
  const [first] = run.handles;
  first.child.emit("message", { kind: "inner-signal-runner-launcher", action: "delete" });
  first.child.emit("message", { kind: "inner-signal-runner-launcher", action: "restart", label: PLANTED_LABEL });
  first.child.emit("message", "restart");
  run.signals.emit("SIGTERM");
  assert.equal(await run.run, 0);
  assert.deepEqual([first.child.killed, run.launched.length], [["SIGTERM"], 1]);
  assert.equal(run.logged.filter((line) => line === "A message from the server that is neither a restart nor a stop was ignored.").length, 3);
  assert.match(run.text(), /The launcher was asked to stop \(SIGTERM\): stopping the server\./u);
  assert.equal(run.text().includes(PLANTED_LABEL), false);

  const stuck = await launcherRun(t, {
    stopWaitMs: 30,
    launch: async ({ startLock }) => {
      const server = fakeServer({ stops: false });
      await startLock.release();
      return Object.freeze({ ...server, released: SYNTHETIC_RULES, ready: { health: { ok: true, runnerTrial: "on", runnerLauncher: "on" } }, codes: () => Object.freeze([]) });
    }
  });
  await until(() => stuck.opened.length === 1, { what: "the page" });
  stuck.handles[0].child.emit("message", launcherMessage("stop"));
  assert.equal(await stuck.run, 0);
  assert.deepEqual(stuck.handles[0].child.killed, ["SIGTERM", "SIGKILL"]);
  assert.match(stuck.text(), /The server didn't stop within 0 seconds of being asked: it was ended\./u);
});

test("a second click while another start holds the trial folder waits for it, then only opens the page", { timeout: 10_000 }, async (t) => {
  // The other start holds the folder's lock (until its server answers, which the second probe sees).
  let lock = null;
  const held = await launcherRun(t, { probes: ["down", "open"], prepare: async (home) => { lock = await acquireTrialFolderLock(home); } });
  assert.equal(await held.run, 0);
  await lock.release();
  assert.deepEqual([held.launched.length, held.opened], [0, [URL_8797]]);
  assert.match(held.text(), /Another start of the runner finished meanwhile on port 8797: opening its page\./u);

  // The folder is free, but the runner answers by the time the lock is had: the lock is let go and nothing is started.
  const finished = await launcherRun(t, { probes: ["down", "open"] });
  assert.equal(await finished.run, 0);
  assert.deepEqual([finished.launched.length, finished.opened], [0, [URL_8797]]);
  const again = await acquireTrialFolderLock(finished.home);
  await again.release();
});

test("a runner that is restarting is waited for before its page opens; another program on the port, or a lock left behind, stops the start with a notice", { timeout: 10_000 }, async (t) => {
  const restarting = await launcherRun(t, { probes: ["restarting", "restarting", "open"] });
  assert.equal(await restarting.run, 0);
  assert.deepEqual([restarting.opened, restarting.launched.length], [[URL_8797], 0]);

  const other = await launcherRun(t, { probes: ["other"] });
  assert.equal(await other.run, 1);
  assert.deepEqual([other.opened, other.launched.length], [[], 0]);
  assert.match(other.told[0], /^Another program uses port 8797, so the runner couldn't start\. What happened is in /u);

  // A start that ended without finishing left its lock (a pid that no longer runs): it is named, never taken over.
  const left = await launcherRun(t, { prepare: (home) => fs.writeFile(path.join(home, TRIAL_FOLDER_LOCK_FILE), "2147483646 synthetic\n", { mode: 0o600 }) });
  assert.equal(await left.run, 1);
  assert.equal(left.launched.length, 0);
  assert.match(left.text(), /A runner-trial command ended without finishing and left its lock\. If no other runner-trial command is running, remove .*\.trial-folder\.lock and try again\./u);
  assert.match(left.told[0], /^The runner couldn't start\. What happened is in /u);

  const early = await launcherRun(t, {
    launch: async ({ startLock }) => {
      const server = fakeServer();
      await startLock.release();
      server.child.end(1);
      return Object.freeze({ ...server, released: SYNTHETIC_RULES, ready: { stopped: true }, codes: () => Object.freeze(["BAD_CONFIG"]) });
    }
  });
  assert.equal(await early.run, 1);
  assert.match(early.text(), /The server stopped before it was ready \(exit code 1; codes BAD_CONFIG\)\./u);
  assert.equal(early.opened.length, 0, "no page opens on a runner that didn't start");
});

// ---- The icon, for real --------------------------------------------------------------------------------------------------------

// Stand-ins on PATH for what the icon touches outside the runner: the browser (the address goes to a file), the desktop's notification
// (its words go to a file), and git, whose fetch fails (offline, and counted) while the rest is the real git, so the released rules are
// extracted for real.
async function iconWorld(t, label) {
  const dir = await tempDir(t, label);
  const world = {
    dir,
    home: path.join(dir, "home"),
    dataHome: path.join(dir, "data"),
    trial: path.join(dir, "trial"),
    claude: path.join(dir, "claude-signed-in"),
    bin: path.join(dir, "bin"),
    opened: path.join(dir, "opened.txt"),
    told: path.join(dir, "told.txt"),
    fetches: path.join(dir, "fetches.txt")
  };
  for (const folder of [world.home, world.dataHome, world.claude, world.bin]) await fs.mkdir(folder, { mode: 0o700 });
  await standIn(world.bin, "xdg-open", `printf '%s\\n' "$*" >> '${world.opened}'`);
  await standIn(world.bin, "notify-send", `printf '%s\\n' "$*" >> '${world.told}'`);
  let gitCommand = null;
  for (const folder of String(process.env.PATH).split(path.delimiter)) {
    const candidate = path.join(folder, "git");
    try { await fs.access(candidate, 1); gitCommand = candidate; break; } catch { /* next PATH entry */ }
  }
  assert.ok(gitCommand, "git is on PATH");
  await fs.writeFile(path.join(world.bin, "git"), `#!${process.execPath}\nconst { spawnSync } = require("node:child_process");\nif (process.argv[2] === "fetch") { require("node:fs").appendFileSync(${JSON.stringify(world.fetches)}, "fetch\\n"); process.exit(1); }\nconst result = spawnSync(${JSON.stringify(gitCommand)}, process.argv.slice(2), { stdio: "inherit" });\nprocess.exit(result.status ?? 1);\n`, { mode: 0o755 });
  // The desktop's environment: a HOME and a short PATH of its own (no nvm, no terminal setup), and none of the shell's settings.
  world.desktop = { HOME: world.home, XDG_DATA_HOME: world.dataHome, PATH: `${world.bin}${path.delimiter}/usr/bin${path.delimiter}/bin`, LANG: "C" };
  return world;
}

const readOr = (file, fallback = "") => fs.readFile(file, "utf8").catch(() => fallback);

// Runs the command the icon's desktop entry names, as the desktop would: no terminal, the desktop's environment.
function runIcon(world, entry) {
  const exec = entry.split("\n").find((line) => line.startsWith("Exec="));
  const [command, ...args] = [...exec.slice("Exec=".length).matchAll(/"([^"]*)"/gu)].map((match) => match[1]);
  const child = spawn(command, args, { cwd: world.home, env: world.desktop, stdio: ["ignore", "pipe", "pipe"] });
  const output = { text: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output.text += chunk; });
  child.stderr.on("data", (chunk) => { output.text += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exited, output };
}

const pagePost = (base, route, body) => fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
const pageGet = async (base, route) => (await fetch(`${base}${route}`, { headers: { accept: "application/json", origin: base } })).json();

test("the icon starts the trial with the owner's switches and no terminal; a second click only opens the page; Restart brings in a client and their consent with the rules it runs; Stop ends it; no log holds a word", { timeout: 180_000 }, async (t) => {
  const world = await iconWorld(t, "launcher-real");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // The install, from a terminal: the owner's flags, and the workers' commands as found there (stand-ins: nothing is ever sent to them).
  const terminal = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("INNER_SIGNAL_"))), HOME: world.home, XDG_DATA_HOME: world.dataHome, PATH: `${world.bin}${path.delimiter}${process.env.PATH}`, CODEX_COMMAND: process.execPath, CLAUDE_COMMAND: process.execPath, INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR: world.claude };
  const install = spawnSync(process.execPath, [LAUNCHER_SCRIPT, "--install", ...OWNER_FLAGS, "--port", String(port), "--dir", world.trial], { cwd: repositoryRoot, env: terminal, encoding: "utf8" });
  assert.equal(install.status, 0, install.stderr);
  const entryFile = path.join(world.dataHome, "applications", DESKTOP_ENTRY_FILE);
  assert.match(install.stdout, new RegExp(`^  ${entryFile.replaceAll("/", "\\/")}: "InnerSignal runner" in your applications menu`, "mu"));
  const entry = await fs.readFile(entryFile, "utf8");
  const settingsBefore = await fs.readFile(path.join(world.trial, LAUNCHER_SETTINGS_FILE), "utf8");

  const icon = runIcon(world, entry);
  t.after(async () => {
    if (icon.child.exitCode === null && icon.child.signalCode === null) {
      icon.child.kill("SIGTERM");
      if (!(await within(icon.exited, 30_000))) icon.child.kill("SIGKILL");
    }
  });
  await until(async () => (await readOr(world.opened)).includes(base) || icon.child.exitCode !== null, { timeoutMs: 90_000, what: "the page to open" });
  assert.equal(icon.child.exitCode, null, `the launcher stays as the server's parent: ${await readOr(path.join(world.trial, LAUNCHER_LOG_FILE))}`);
  assert.deepEqual((await readOr(world.opened)).trim().split("\n"), [base], "the browser opened at the page");
  const health = await (await fetch(`${base}/health`)).json();
  assert.deepEqual([health.runnerTrial, health.runnerLauncher, health.runnerKeptPlan, health.runnerNumberNow, health.runnerFeedbackLink, health.ownerFallback, health.runnerFixedMessageOnFailure, health.runnerFixedMessageOnAnyFailure],
    ["on", "on", "on", "on", "on", "on", "on", "on"], "the owner's switches reach the server, and the page's Restart and Stop work");
  assert.equal(health.responseEvidence.runtime, "advisory", "the check of each reply stays off, as in the owner's start");
  assert.deepEqual(health.runnerArrangement, { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] });

  // A second click while it runs: only the page opens again; nothing starts, and no grant changes.
  const credentialsPath = path.join(world.trial, "credentials.json");
  const credentialsBefore = await fs.readFile(credentialsPath, "utf8");
  const second = runIcon(world, entry);
  const secondEnd = await second.exited;
  assert.deepEqual(secondEnd, { code: 0, signal: null }, `${second.output.text}\n${await readOr(path.join(world.trial, LAUNCHER_LOG_FILE))}`);
  assert.deepEqual((await readOr(world.opened)).trim().split("\n"), [base, base]);
  assert.equal(await fs.readFile(credentialsPath, "utf8"), credentialsBefore, "the second click made no start");

  // A client added and their consent recorded while it runs take effect at the restart the page asks for.
  assert.deepEqual(await addClient({ home: world.trial, label: PLANTED_LABEL }), { number: 1 });
  assert.deepEqual(await setJournalConsent({ home: world.trial, number: 1, action: "confirm" }), { changed: true, state: "confirmed" });
  const waiting = await pageGet(base, "/v1/runner/clients");
  assert.deepEqual([waiting.clientsAwaitingRestart, waiting.cases.map((entry) => entry.kind)], [1, ["own"]]);
  const restart = await pagePost(base, "/v1/runner/restart", { confirmed: true });
  assert.deepEqual([restart.status, await restart.json()], [202, { action: "restart", accepted: true }]);
  let clients = null;
  await until(async () => {
    try { clients = await pageGet(base, "/v1/runner/clients"); } catch { return false; }
    return clients.cases.some((entry) => entry.kind === "client");
  }, { timeoutMs: 60_000, what: "the restarted runner" });
  assert.deepEqual(clients.cases.map((entry) => [entry.kind, entry.label]), [["own", null], ["client", PLANTED_LABEL]], "the page's list of people is the one place a label shows");
  assert.equal(clients.cases[1].journal.consent, "confirmed");
  const credentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
  const clientGrant = credentials.grants.find((grant) => grant.case_ids[0] === clients.cases[1].caseId);
  assert.deepEqual(clientGrant.purposes, ["session_use"], "the restart took the recorded consent into the client's grant");
  const after = await (await fetch(`${base}/health`)).json();
  assert.deepEqual([after.runnerLauncher, after.runnerRules], ["on", health.runnerRules], "the restarted server runs the same rules");
  assert.equal((await readOr(world.fetches)).trim().split("\n").filter(Boolean).length, 1, "the restart fetched no release: only the first start did");
  assert.equal((await readOr(world.opened)).trim().split("\n").length, 2, "the restart opened no page (the page reloads itself)");

  // Stop ends the server and the launcher; the port is free again.
  const stop = await pagePost(base, "/v1/runner/stop", { confirmed: true });
  assert.deepEqual([stop.status, await stop.json()], [202, { action: "stop", accepted: true }]);
  const ended = await within(icon.exited, 60_000);
  assert.deepEqual(ended, { code: 0, signal: null }, `${icon.output.text}\n${await readOr(path.join(world.trial, LAUNCHER_LOG_FILE))}`);
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });

  const logFile = path.join(world.trial, LAUNCHER_LOG_FILE);
  assert.equal(await mode(logFile), 0o600);
  const log = await fs.readFile(logFile, "utf8");
  for (const line of [`Runner trial ready: ${base}`, "Kept plan on, number now on, feedback link on, owner's fixed message on, also after a plan limit, sign-in or timeout on.", "Stop it with the page's Stop button; the icon starts it again.", `Opened the page: ${base}`, `The runner already answers on port ${port}: opening its page.`, "Restart asked on the page", "Restarted.", "Stop asked on the page", "The launcher ends (exit code 0)."]) {
    assert.ok(log.includes(line), `the log says: ${line}`);
  }
  assert.ok(log.split("\n").filter(Boolean).every((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /u.test(line)), "every line has its time");
  assert.equal(log.includes("Ctrl+C"), false, "no terminal is named");
  assert.equal(log.includes("Inner Signal runtime listening"), false, "the server's own output stays out of the log");
  for (const text of [log, icon.output.text, second.output.text, install.stdout, install.stderr, await readOr(world.opened), await readOr(world.told)]) {
    assert.equal(text.includes(PLANTED_LABEL), false, "no label in a log or an output");
  }
  assert.equal(await readOr(world.told, null), null, "nothing failed, so nothing was told on the desktop");
  assert.equal(await fs.readFile(path.join(world.trial, LAUNCHER_SETTINGS_FILE), "utf8"), settingsBefore, "the launcher changed none of its settings");
});

test("an icon without launcher.json starts nothing: its log says to install it, and the desktop is told", { timeout: 10_000 }, async (t) => {
  const world = await iconWorld(t, "launcher-uninstalled");
  const icon = runIcon(world, `Exec="${process.execPath}" "${LAUNCHER_SCRIPT}" "--dir" "${world.trial}"\n`);
  assert.deepEqual(await icon.exited, { code: 1, signal: null });
  const log = await fs.readFile(path.join(world.trial, LAUNCHER_LOG_FILE), "utf8");
  assert.match(log, /There's no launcher\.json in .*: install the icon first/u);
  assert.match(await fs.readFile(world.told, "utf8"), /The runner couldn't start: its settings can't be read\. What happened is in .*launcher\.log\./u);
  assert.equal(await readOr(world.opened, null), null, "no page opens");
  assert.deepEqual((await fs.readdir(world.trial)).sort(), [LAUNCHER_LOG_FILE], "nothing but the log is made");
});
