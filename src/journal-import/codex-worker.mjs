import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { assertJournalWorkExchangeRoot, createJournalWorkDispatchReader, createJournalWorkExchange,
  journalWorkExchangeSecret, journalWorkFileKey, resolveJournalWorkExchangeRoot } from "./work-exchange.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mcpCli = path.join(repositoryRoot, "src/cli/journal-work-mcp.mjs");
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/u;
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const THREAD = /^[0-9A-Za-z-]{8,64}$/u;
const MAX_LINE = 1024 * 1024;
const MAX_STREAM = 16 * 1024 * 1024;
const USAGE_FIELDS = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"];
const MAX_LIMIT_RETRIES = 12;

export const CODEX_DISABLED_FEATURES = Object.freeze([
  "apps", "auth_elicitation", "browser_use", "browser_use_external", "browser_use_full_cdp_access",
  "computer_use", "fast_mode", "goals", "hooks", "image_generation", "in_app_browser",
  "in_app_chat", "in_app_local_automation", "memories", "multi_agent", "multi_agent_v2",
  "plugins", "remote_plugin", "realtime_conversation", "shell_snapshot", "shell_tool",
  "skill_mcp_dependency_install", "skill_search", "sleep_tool", "tool_suggest", "unified_exec",
  "unified_exec_tty", "view_image", "workspace_dependencies", "worktrees", "tool_call_mcp_elicitation"
]);

function failure(code) { return Object.assign(new Error(code), { code }); }
function stringArg(value) { return JSON.stringify(value); }
function numberOption(argv, flag, fallback, min, max) {
  const at = argv.indexOf(flag);
  if (at < 0) return fallback;
  const value = Number(argv[at + 1]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  return value;
}

export function parseJournalCodexWorkerArgs(argv) {
  const known = new Set(["--config", "--codex-home", "--work-dir", "--codex-bin", "--concurrency", "--timeout-ms", "--poll-ms",
    "--limit-backoff-ms", "--log", "--once", "--max-items", "--import-command-json", "--import-env-names", "--import-timeout-ms"]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!known.has(flag) || Object.hasOwn(options, flag)) throw failure("JOURNAL_CODEX_OPTION_INVALID");
    options[flag] = flag === "--once" ? true : argv[++index];
    if (options[flag] === undefined) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  }
  for (const flag of ["--config", "--codex-home", "--work-dir"]) {
    if (typeof options[flag] !== "string" || !path.isAbsolute(options[flag])) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  }
  if (options["--log"] && !path.isAbsolute(options["--log"])) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  const codexBin = options["--codex-bin"] ?? "codex";
  if (!/^[A-Za-z0-9_./-]+$/u.test(codexBin)) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  let importCommand = null;
  if (options["--import-command-json"]) {
    try { importCommand = JSON.parse(options["--import-command-json"]); }
    catch { throw failure("JOURNAL_CODEX_IMPORT_COMMAND_INVALID"); }
    if (!Array.isArray(importCommand) || !importCommand.length
      || importCommand.some((value) => typeof value !== "string" || !value || value.includes("\0"))) {
      throw failure("JOURNAL_CODEX_IMPORT_COMMAND_INVALID");
    }
  }
  const importEnvNames = options["--import-env-names"] === undefined ? [] : options["--import-env-names"].split(",");
  if (importEnvNames.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  return Object.freeze({ configPath: options["--config"], codexHome: options["--codex-home"],
    workDir: options["--work-dir"], codexBin,
    concurrency: numberOption(argv, "--concurrency", 2, 1, 8),
    timeoutMs: numberOption(argv, "--timeout-ms", 1_800_000, 1, 3_600_000),
    pollMs: numberOption(argv, "--poll-ms", 5_000, 1, 60_000),
    limitBackoffMs: numberOption(argv, "--limit-backoff-ms", 1_800_000, 1, 86_400_000),
    maxItems: numberOption(argv, "--max-items", Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
    importTimeoutMs: options["--import-timeout-ms"] === undefined ? null
      : numberOption(argv, "--import-timeout-ms", null, 1, 86_400_000),
    importEnvNames: [...new Set(importEnvNames)],
    log: options["--log"] ?? null, once: Boolean(options["--once"]), importCommand });
}

export function codexExecArgs({ record, runDir, configPath, root, secretFile }) {
  const instruction = `Private InnerSignal journal work item ${record.work_id}. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.`;
  return ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--strict-config",
    "-s", "read-only", "-C", runDir, "-m", record.model,
    "-c", `model_reasoning_effort=${stringArg(record.effort)}`, "-c", 'web_search="disabled"',
    "-c", 'service_tier="default"', "-c", 'approval_policy="never"',
    "-c", "project_doc_max_bytes=0", "-c", "project_root_markers=[]",
    "-c", `mcp_servers.journal.command=${stringArg(process.execPath)}`,
    // The work server is scoped to this run's item, so a call naming another item reads and marks nothing of it.
    "-c", `mcp_servers.journal.args=${stringArg([mcpCli, "--config", configPath, "--principal", "codex-standard", "--tier", "standard",
      "--stage-dir", path.join(runDir, "stage"), "--work-id", record.work_id])}`,
    "-c", `mcp_servers.journal.env={INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT=${stringArg(root)},INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE=${stringArg(secretFile)}}`,
    "-c", 'mcp_servers.journal.default_tools_approval_mode="approve"',
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), instruction];
}

export function parseCodexResetTime(message, nowMs) {
  if (typeof message !== "string") return null;
  const codexDate = message.match(/Try again at\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(20\d\d)\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/iu);
  if (codexDate) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .indexOf(codexDate[1].slice(0, 3).toLowerCase());
    const hour = Number(codexDate[4]) % 12 + (codexDate[6].toUpperCase() === "PM" ? 12 : 0);
    if (month >= 0 && Number(codexDate[4]) >= 1 && Number(codexDate[4]) <= 12
      && Number(codexDate[5]) < 60) {
      const target = new Date(Number(codexDate[3]), month, Number(codexDate[2]), hour, Number(codexDate[5]));
      if (target.getMonth() === month && target.getDate() === Number(codexDate[2]) && target.getTime() > nowMs) return target.getTime();
    }
  }
  const codexClock = message.match(/Try again at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/iu);
  if (codexClock && Number(codexClock[1]) >= 1 && Number(codexClock[1]) <= 12 && Number(codexClock[2]) < 60) {
    const target = new Date(nowMs);
    target.setHours(Number(codexClock[1]) % 12 + (codexClock[3].toUpperCase() === "PM" ? 12 : 0), Number(codexClock[2]), 0, 0);
    if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
    return target.getTime();
  }
  const iso = message.match(/(?:reset[^\n]{0,80}?)(20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d+)?Z)/iu);
  if (iso) return Date.parse(iso[1]);
  const seconds = message.match(/(?:reset|retry)[^\n]{0,40}?(?:in|after)\s+(\d+)\s*(?:seconds?|s)\b/iu);
  if (seconds) return nowMs + Number(seconds[1]) * 1000;
  const clock = message.match(/(?:reset|retry)[^\n]{0,40}?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:UTC|Z)\b/iu);
  if (clock) {
    const target = new Date(nowMs);
    target.setUTCHours(Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0), 0);
    if (target.getTime() <= nowMs) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime();
  }
  return null;
}

export function codexEventReader(workId = null) {
  const state = { threads: [], completed: false, bad: null, errorSeen: false, hasErrorMessage: false,
    finalErrorLimited: false, resetAt: null, packetFetched: false, packetBeforeFirstSubmit: false, submitSeen: false,
    usage: Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0])) };
  function noteFailure(message) {
    if (typeof message !== "string") return;
    if (message) state.hasErrorMessage = true;
    state.finalErrorLimited = /\b429\b|usage[ -]?limit|rate[ -]?limit/iu.test(message);
    state.resetAt = state.finalErrorLimited ? parseCodexResetTime(message, Date.now()) : null;
  }
  function accept(line) {
    let event;
    try { event = JSON.parse(line); }
    catch { state.bad = "EVENT_JSON_INVALID"; return; }
    if (!event || typeof event !== "object" || typeof event.type !== "string") { state.bad = "EVENT_INVALID"; return; }
    if (event.type === "thread.started") {
      if (typeof event.thread_id !== "string" || !THREAD.test(event.thread_id)) state.bad = "THREAD_INVALID";
      else state.threads.push(event.thread_id);
    } else if (event.type === "turn.started") {
      // Codex emits this on every turn; it contains no execution evidence.
    } else if (event.type === "turn.completed") {
      state.completed = true;
      for (const field of USAGE_FIELDS) {
        const value = event.usage?.[field] ?? (field === "reasoning_output_tokens"
          ? event.usage?.output_tokens_details?.reasoning_tokens : undefined);
        if (Number.isSafeInteger(value) && value >= 0) state.usage[field] = value;
      }
    } else if (event.type === "turn.failed" || event.type === "error") {
      state.bad ??= event.type === "turn.failed" ? "TURN_FAILED" : "EVENT_ERROR";
      state.errorSeen = true;
      const message = event.error?.message ?? event.message ?? "";
      if (message) noteFailure(message);
    } else if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
      const item = event.item;
      if (!item || typeof item !== "object") { state.bad = "ITEM_INVALID"; return; }
      if (item.type === "error") { state.bad ??= "ITEM_ERROR"; state.errorSeen = true; noteFailure(item.message ?? ""); return; }
      if (["agent_message", "reasoning", "todo_list"].includes(item.type)) return;
      if (item.type === "mcp_tool_call" && item.server === "journal"
        && ["get_journal_work_packet", "submit_journal_work_result"].includes(item.tool)) {
        if (event.type === "item.completed" && item.status === "completed"
          && item.arguments?.work_id === workId && item.error == null && item.result?.isError !== true) {
          if (item.tool === "get_journal_work_packet") state.packetFetched = true;
          // The first accepted submit is the one the exchange keeps (first write wins), so the packet
          // must have been fetched before it; a later fetch or submit can't make up for it.
          else if (!state.submitSeen) { state.submitSeen = true; state.packetBeforeFirstSubmit = state.packetFetched; }
        }
        return;
      }
      state.bad ??= "ITEM_FORBIDDEN";
    } else state.bad = "EVENT_FORBIDDEN";
  }
  return { state, accept, noteFailure };
}

async function checkCodexHome(home) {
  const info = await fs.lstat(home);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid())
    || await fs.realpath(home) !== home) throw failure("JOURNAL_CODEX_HOME_INSECURE");
  for (const forbidden of ["AGENTS.md", "AGENTS.override.md", "config.toml"]) {
    if (await fs.lstat(path.join(home, forbidden)).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) {
      throw failure("JOURNAL_CODEX_HOME_CONTAMINATED");
    }
  }
  const skills = path.join(home, "skills");
  const skillsInfo = await fs.lstat(skills).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (skillsInfo && (!skillsInfo.isDirectory() || await fs.realpath(skills) !== skills
    || (await fs.readdir(skills)).some((name) => name !== ".system"))) {
    throw failure("JOURNAL_CODEX_HOME_CONTAMINATED");
  }
  if (skillsInfo && (await fs.readdir(skills)).includes(".system")) {
    const system = path.join(skills, ".system");
    const info = await fs.lstat(system);
    if (!info.isDirectory() || await fs.realpath(system) !== system) throw failure("JOURNAL_CODEX_HOME_CONTAMINATED");
  }
  await withOpenedRegularFile(path.join(home, "auth.json"), async (_handle, stat) => {
    if ((stat.mode & 0o077) !== 0) throw failure("JOURNAL_CODEX_HOME_INSECURE");
  });
}

export function boundedLineReader({ onLine, maxLineBytes = MAX_LINE, maxStreamBytes = MAX_STREAM }) {
  let fragments = [], lineBytes = 0, total = 0, refused = false;
  const state = { problem: null };
  const reject = code => { state.problem = code; refused = true; fragments = []; return false; };
  return { state, async accept(chunk) {
    if (refused) return false;
    total += Buffer.byteLength(chunk);
    if (total > maxStreamBytes) return reject("EVENT_STREAM_TOO_LARGE");
    // Scan only the new chunk, and join each completed line exactly once.
    let start = 0;
    while (start < chunk.length) {
      const at = chunk.indexOf("\n", start);
      const part = chunk.slice(start, at < 0 ? chunk.length : at);
      lineBytes += Buffer.byteLength(part);
      if (lineBytes > maxLineBytes) return reject("EVENT_LINE_TOO_LARGE");
      fragments.push(part);
      if (at < 0) break;
      const next = fragments.join(""); fragments = []; lineBytes = 0;
      if (await onLine(next) === false) { refused = true; return false; }
      start = at + 1;
    }
    return true;
  }, async finish() {
    if (!refused && fragments.length) await onLine(fragments.join(""));
    fragments = [];
  } };
}

// With gate, the command starts only after onSpawn has finished. A small Node process leads the new process group,
// waits for one line on stdin, and only then starts the command as its child in the same group, with the same
// environment and stdout/stderr, and exits with its status. If the parent dies or onSpawn fails first, the gate
// reads end-of-file or is killed, and the command never runs. No shell is involved: the command and its arguments
// are passed as argv.
const GATE_SOURCE = [
  'const { spawn } = require("node:child_process");',
  'let line = "", started = false;',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", (chunk) => { line += chunk; if (!started && line.includes("\\n")) start(); });',
  'process.stdin.on("end", () => { if (!started) process.exit(97); });',
  'function start() {',
  '  started = true; process.stdin.destroy();',
  '  const child = spawn(process.argv[1], process.argv.slice(2), { stdio: ["ignore", "inherit", "inherit"] });',
  '  child.once("error", () => process.exit(127));',
  '  child.once("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));',
  '}'
].join("\n");

export function runProcess(command, args, { cwd, env, timeoutMs, onLine, activeGroups,
  maxLineBytes = MAX_LINE, maxStreamBytes = MAX_STREAM, killOnClose = false, onSpawn = null, gate = false }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = gate
        ? spawn(process.execPath, ["-e", GATE_SOURCE, command, ...args], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"], shell: false })
        : spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
    }
    catch { resolve({ code: null, timedOut: false, problem: "SPAWN_FAILED", durationMs: Date.now() - started }); return; }
    let problem = null, timedOut = false, refused = false;
    let processing = Promise.resolve();
    const killGroup = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } };
    if (gate) child.stdin?.on("error", () => {}); // a shell killed before release closes the pipe
    if (onSpawn && child.pid) processing = Promise.resolve().then(() => onSpawn(child.pid))
      .then(() => { if (gate && !refused) child.stdin.end("\n"); })
      .catch(() => { problem = "PROCESS_RECORD_FAILED"; refused = true; killGroup(); });
    else if (gate) child.stdin?.end("\n");
    const reader = boundedLineReader({ onLine: line => onLine(line, killGroup), maxLineBytes, maxStreamBytes });
    activeGroups?.add(killGroup);
    const timer = timeoutMs === null ? null : setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.once("error", () => { problem = "SPAWN_FAILED"; });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (refused) return;
      child.stdout.pause();
      processing = processing.then(async () => {
        if (refused) return;
        if (await reader.accept(chunk) === false) { problem = reader.state.problem; refused = true; killGroup(); }
      }).catch(() => { problem = "EVENT_HANDLER_FAILED"; refused = true; killGroup(); })
        .finally(() => { child.stdout.resume(); });
    });
    let stderrTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-512);
    }); // Only transiently inspect for a limit; never retain or print packet or answer text.
    child.once("close", async (code) => { if (timer) clearTimeout(timer);
      if (killOnClose) killGroup();
      await processing;
      try { await reader.finish(); } catch { problem = "EVENT_HANDLER_FAILED"; }
      activeGroups?.delete(killGroup);
      resolve({ code, timedOut, problem, stderrLast: stderrTail.trim().split("\n").at(-1) ?? "",
        durationMs: Date.now() - started }); });
  });
}

export async function privateDirectory(directory, code) {
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700
    || (process.getuid && info.uid !== process.getuid())) throw failure(code);
  return fs.realpath(directory);
}

export async function removeStaleRuns(workDir, prefix = "inner-signal-codex-", { keep = new Set() } = {}) {
  const before = Date.now() - 3_600_000;
  for (const name of await fs.readdir(workDir)) {
    if (!name.startsWith(prefix) || !/^[A-Za-z0-9]+$/u.test(name.slice(prefix.length))) continue;
    if (keep.has(name)) continue;
    const target = path.join(workDir, name);
    const info = await fs.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info?.isDirectory() && info.mtimeMs < before && (process.getuid === undefined || info.uid === process.getuid())) {
      const lock = path.join(target, "worker.lock");
      const lockInfo = await fs.lstat(lock).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (!lockInfo?.isFile() || (lockInfo.mode & 0o777) !== 0o600
        || (process.getuid && lockInfo.uid !== process.getuid())) continue;
      await new Promise((resolve, reject) => {
        const child = spawn("flock", ["-n", lock, "rm", "-rf", "--", target], { stdio: "ignore" });
        child.once("error", reject);
        child.once("close", () => resolve()); // A locked live sibling returns nonzero and is preserved.
      });
    }
  }
}

export async function lockWorkerDirectory(directory) {
  const lock = path.join(directory, "worker.lock");
  const handle = await fs.open(lock, "wx", 0o600);
  await handle.close();
  const child = spawn("flock", ["-n", lock, "sh", "-c", "printf 'ready\\n'; cat >/dev/null"],
    { stdio: ["pipe", "pipe", "ignore"] });
  try {
    await new Promise((resolve, reject) => {
      let ready = false, output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) {
          if (output.startsWith("ready\n")) { ready = true; resolve(); }
          else reject(failure("JOURNAL_CODEX_WORK_DIR_INSECURE"));
        } else if (output.length > 16) reject(failure("JOURNAL_CODEX_WORK_DIR_INSECURE"));
      });
      child.once("error", reject);
      child.once("close", () => { if (!ready) reject(failure("JOURNAL_CODEX_WORK_DIR_INSECURE")); });
    });
  } catch (error) { child.stdin.end(); child.kill(); throw error; }
  return async () => {
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("close", resolve);
    });
  };
}

export async function runJournalCodexWorker(argv, { environment = process.env, stderr = process.stderr,
} = {}) {
  if (argv.includes("--agent")) {
    const index = argv.indexOf("--agent");
    if (argv[index + 1] === "claude") {
      const { runJournalClaudeWorker } = await import("./claude-worker.mjs");
      return runJournalClaudeWorker(argv, { environment, stderr });
    }
    if (argv[index + 1] !== "codex") throw failure("JOURNAL_WORK_AGENT_INVALID");
    argv = [...argv.slice(0, index), ...argv.slice(index + 2)];
  }
  const options = parseJournalCodexWorkerArgs(argv);
  await checkCodexHome(options.codexHome);
  const workDir = await privateDirectory(options.workDir, "JOURNAL_CODEX_WORK_DIR_INSECURE");
  await withOpenedRegularFile(options.configPath, async (_handle, info) => {
    if ((info.mode & 0o077) !== 0) throw failure("JOURNAL_CODEX_CONFIG_INSECURE");
  });
  const configuredRoot = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT;
  const secretFile = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE;
  if (!configuredRoot || !secretFile || environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64 !== undefined) {
    throw failure("JOURNAL_CODEX_EXCHANGE_CONFIG_INVALID");
  }
  const root = await resolveJournalWorkExchangeRoot(configuredRoot, { outside: repositoryRoot });
  await assertJournalWorkExchangeRoot(root);
  const secret = await journalWorkExchangeSecret(environment);
  const exchange = createJournalWorkExchange({ root, secret });
  const dispatch = createJournalWorkDispatchReader({ root });
  const logHandle = options.log ? await fs.open(options.log, "a", 0o600) : null;
  const privateParent = await fs.realpath(await fs.mkdtemp(path.join(workDir, "inner-signal-codex-")));
  await fs.chmod(privateParent, 0o700);
  let unlockWorkerDirectory;
  try { unlockWorkerDirectory = await lockWorkerDirectory(privateParent); }
  catch (error) {
    await fs.rm(privateParent, { recursive: true, force: true });
    await logHandle?.close();
    throw error;
  }
  let logTail = Promise.resolve();
  const log = async (record) => {
    const bytes = `${JSON.stringify(record)}\n`;
    logTail = logTail.then(() => { if (logHandle) return logHandle.writeFile(bytes); stderr.write(bytes); });
    await logTail;
  };
  const activeGroups = new Set();
  let stopping = false, stopSignal = null, wake = null;
  const stop = (signal = null) => { stopping = true; stopSignal ??= signal;
    if (wake) { const resume = wake; wake = null; resume(); }
    for (const kill of activeGroups) kill(); };
  const wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  const onTerm = () => stop("SIGTERM");
  const onInt = () => stop("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  let importRun = null, importPending = false;
  function startImport() {
    if (!options.importCommand || stopping) return;
    if (importRun) { importPending = true; return; }
    const started = Date.now();
    const importEnv = { PATH: environment.PATH ?? "", HOME: environment.HOME ?? "", LANG: environment.LANG ?? "C" };
    for (const name of options.importEnvNames) if (environment[name] !== undefined) importEnv[name] = environment[name];
    importRun = runProcess(options.importCommand[0], options.importCommand.slice(1), {
      cwd: repositoryRoot, env: importEnv,
      timeoutMs: options.importTimeoutMs, onLine: () => {}, activeGroups
    }).then(async ({ code }) => {
      await log({ at: new Date().toISOString(), kind: "import", exit_code: code, duration_ms: Date.now() - started });
    }).catch(() => {}).finally(() => { importRun = null; if (importPending && !stopping) { importPending = false; startImport(); } });
  }
  const running = new Map(), attempts = new Map(), limits = new Map(), seenThreads = new Set();
  let completed = 0, limitedUntil = 0;
  let initial = null;

  async function one(record) {
    const started = Date.now();
    const events = codexEventReader(record.work_id);
    let outcome = "error";
    let runDir = null;
    try {
      runDir = await fs.realpath(await fs.mkdtemp(path.join(privateParent, "run-")));
      await fs.chmod(runDir, 0o700);
      const stageDir = path.join(runDir, "stage");
      await fs.mkdir(stageDir, { mode: 0o700 });
      if (stopping) { outcome = "stopped"; return outcome; }
      const result = await runProcess(options.codexBin, codexExecArgs({ record, runDir, configPath: options.configPath, root, secretFile }), {
        cwd: runDir, env: { PATH: environment.PATH ?? "", HOME: environment.HOME ?? "", LANG: environment.LANG ?? "C", CODEX_HOME: options.codexHome },
        timeoutMs: options.timeoutMs, onLine: events.accept, activeGroups
      });
      // Reserve every thread ID this run reported before any further await, whatever its outcome, so
      // one Codex thread can never back two answers, in concurrent runs or in a later retry.
      const threadReused = events.state.threads.some((id) => seenThreads.has(id));
      for (const id of events.state.threads) seenThreads.add(id);
      if (result.code !== 0 && !events.state.hasErrorMessage) events.noteFailure(result.stderrLast);
      if (stopping) outcome = "stopped";
      else if (result.problem) outcome = `rejected:${result.problem}`;
      else if (result.timedOut) outcome = "timeout";
      else if (!events.state.completed && events.state.finalErrorLimited
        && [null, "TURN_FAILED", "EVENT_ERROR", "ITEM_ERROR"].includes(events.state.bad)
        && (result.code !== 0 || events.state.errorSeen)) {
        outcome = "limited";
        limitedUntil = Math.max(limitedUntil, events.state.resetAt ?? Date.now() + options.limitBackoffMs);
      }
      else if (result.code !== 0) outcome = "rejected:EXIT_NONZERO";
      else if (events.state.bad) outcome = `rejected:${events.state.bad}`;
      else if (events.state.threads.length !== 1) outcome = "rejected:THREAD_COUNT";
      else if (threadReused) outcome = "rejected:THREAD_REUSED";
      else if (!events.state.completed) outcome = "rejected:TURN_INCOMPLETE";
      else if (!events.state.packetBeforeFirstSubmit) outcome = "rejected:PACKET_NOT_FETCHED";
      else if (!await fs.lstat(path.join(stageDir, `${journalWorkFileKey(record.work_id)}.json`)).then(() => true, () => false)) {
        outcome = "rejected:STAGE_MISSING";
      } else {
        const stored = await exchange.promoteStaged({ stageDir, workId: record.work_id, subject: "local:codex-standard",
          execution: { profile_evidence: "codex_exec_request_pinned", effective_model_profile: record.model,
            effective_effort: record.effort, request_context_id: `codex-thread:${events.state.threads[0]}` } });
        outcome = stored.already ? "already_answered" : "answered";
        if (outcome === "answered") startImport();
      }
    } catch { outcome = stopping ? "stopped" : "error"; }
    finally {
      if (runDir) await fs.rm(runDir, { recursive: true, force: true });
      await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role, model: record.model,
        effort: record.effort, outcome, duration_ms: Date.now() - started, ...events.state.usage });
    }
    return outcome;
  }

  try {
    await removeStaleRuns(workDir);
    initial = options.once ? new Set((await dispatch.listDispatch()).map((record) => record.work_id)) : null;
    startImport();
    for (;;) {
      if (stopping) break;
      const now = Date.now();
      if (now >= limitedUntil && completed < options.maxItems) {
        const records = await dispatch.listDispatch();
        for (const record of records) {
          if (stopping) break;
          if (running.size >= options.concurrency || completed + running.size >= options.maxItems) break;
          if (initial && !initial.has(record.work_id)) continue;
          if (record.answered || record.tier !== "standard" || Date.parse(record.expires_at) <= now
            || !MODEL.test(record.model) || !EFFORTS.has(record.effort)
            || running.has(record.work_id) || (attempts.get(record.work_id) ?? 0) >= 3
            || (limits.get(record.work_id) ?? 0) >= MAX_LIMIT_RETRIES) continue;
          const pending = one(record).catch(async () => {
            await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
              model: record.model, effort: record.effort, outcome: "error", duration_ms: 0,
              ...Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0])) }).catch(() => {});
            return "error";
          }).then((outcome) => {
            if (outcome === "limited") limits.set(record.work_id, (limits.get(record.work_id) ?? 0) + 1);
            else if (outcome !== "stopped") { attempts.set(record.work_id, (attempts.get(record.work_id) ?? 0) + 1); completed += 1; }
          }).finally(() => { running.delete(record.work_id); });
          running.set(record.work_id, pending);
        }
      }
      if (stopping || completed >= options.maxItems) { if (!running.size) break; await Promise.race(running.values()); continue; }
      if (running.size) { await Promise.race(running.values()); continue; }
      if (options.once) {
        const records = await dispatch.listDispatch();
        const remaining = records.some((record) => initial.has(record.work_id) && !record.answered
          && record.tier === "standard" && Date.parse(record.expires_at) > Date.now()
          && MODEL.test(record.model) && EFFORTS.has(record.effort)
          && (attempts.get(record.work_id) ?? 0) < 3 && (limits.get(record.work_id) ?? 0) < MAX_LIMIT_RETRIES);
        if (!remaining) break;
      }
      await wait(Math.max(options.pollMs, limitedUntil - Date.now(), 1));
    }
    while (importRun) await importRun;
    return stopSignal === "SIGINT" ? 130 : stopSignal === "SIGTERM" ? 143 : 0;
  } finally {
    try {
      stop();
      await Promise.allSettled(running.values());
      if (importRun) await importRun.catch(() => {});
      try { await fs.rm(privateParent, { recursive: true, force: true }); }
      finally { await unlockWorkerDirectory(); await logHandle?.close(); }
    } finally {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    }
  }
}
