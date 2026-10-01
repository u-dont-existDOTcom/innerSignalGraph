import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
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
  const known = new Set(["--config", "--codex-home", "--codex-bin", "--concurrency", "--timeout-ms", "--poll-ms",
    "--limit-backoff-ms", "--log", "--once", "--max-items", "--import-command-json"]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!known.has(flag) || Object.hasOwn(options, flag)) throw failure("JOURNAL_CODEX_OPTION_INVALID");
    options[flag] = flag === "--once" ? true : argv[++index];
    if (options[flag] === undefined) throw failure("JOURNAL_CODEX_OPTION_INVALID");
  }
  for (const flag of ["--config", "--codex-home"]) {
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
  return Object.freeze({ configPath: options["--config"], codexHome: options["--codex-home"], codexBin,
    concurrency: numberOption(argv, "--concurrency", 2, 1, 8),
    timeoutMs: numberOption(argv, "--timeout-ms", 1_800_000, 1, 3_600_000),
    pollMs: numberOption(argv, "--poll-ms", 5_000, 1, 60_000),
    limitBackoffMs: numberOption(argv, "--limit-backoff-ms", 1_800_000, 1, 86_400_000),
    maxItems: numberOption(argv, "--max-items", Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
    log: options["--log"] ?? null, once: Boolean(options["--once"]), importCommand });
}

export function codexExecArgs({ record, runDir, configPath, root, secretFile }) {
  const instruction = `Private InnerSignal journal work item ${record.work_id}. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.`;
  return ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--strict-config",
    "-s", "read-only", "-C", runDir, "-m", record.model,
    "-c", `model_reasoning_effort=${stringArg(record.effort)}`, "-c", 'web_search="disabled"',
    "-c", 'service_tier="default"', "-c", 'approval_policy="never"',
    "-c", `mcp_servers.journal.command=${stringArg(process.execPath)}`,
    "-c", `mcp_servers.journal.args=${stringArg([mcpCli, "--config", configPath, "--principal", "codex-standard", "--stage-dir", path.join(runDir, "stage")])}`,
    "-c", `mcp_servers.journal.env={INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT=${stringArg(root)},INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE=${stringArg(secretFile)}}`,
    "-c", 'mcp_servers.journal.default_tools_approval_mode="approve"',
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]), instruction];
}

function parseResetTime(message, nowMs) {
  if (typeof message !== "string") return null;
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

export function codexEventReader() {
  const state = { threads: [], completed: false, bad: null, limited: false, resetAt: null,
    usage: Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0])) };
  function noteLimit(message) {
    if (/\b429\b|usage[ -]?limit|rate[ -]?limit/iu.test(message)) {
      state.limited = true;
      state.resetAt = parseResetTime(message, Date.now());
    }
  }
  function accept(line) {
    let event;
    try { event = JSON.parse(line); }
    catch { state.bad = "EVENT_JSON_INVALID"; return; }
    if (!event || typeof event !== "object" || typeof event.type !== "string") { state.bad = "EVENT_INVALID"; return; }
    if (event.type === "thread.started") {
      if (typeof event.thread_id !== "string" || !THREAD.test(event.thread_id)) state.bad = "THREAD_INVALID";
      else state.threads.push(event.thread_id);
    } else if (event.type === "turn.completed") {
      state.completed = true;
      for (const field of USAGE_FIELDS) {
        const value = event.usage?.[field] ?? (field === "reasoning_output_tokens"
          ? event.usage?.output_tokens_details?.reasoning_tokens : undefined);
        if (Number.isSafeInteger(value) && value >= 0) state.usage[field] = value;
      }
    } else if (event.type === "turn.failed" || event.type === "error") {
      state.bad = event.type === "turn.failed" ? "TURN_FAILED" : "EVENT_ERROR";
      const message = event.error?.message ?? event.message ?? "";
      noteLimit(message);
    } else if (event.type.startsWith("item.")) {
      const item = event.item;
      if (!item || typeof item !== "object") { state.bad = "ITEM_INVALID"; return; }
      if (["agent_message", "reasoning", "todo_list"].includes(item.type)) return;
      if (item.type === "mcp_tool_call" && item.server === "journal"
        && ["get_journal_work_packet", "submit_journal_work_result"].includes(item.tool)) return;
      state.bad = "ITEM_FORBIDDEN";
    } else state.bad = "EVENT_FORBIDDEN";
  }
  return { state, accept, noteLimit };
}

async function checkCodexHome(home) {
  const info = await fs.lstat(home);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || (process.getuid && info.uid !== process.getuid())
    || await fs.realpath(home) !== home) throw failure("JOURNAL_CODEX_HOME_INSECURE");
  for (const forbidden of ["AGENTS.md", "config.toml"]) {
    if (await fs.lstat(path.join(home, forbidden)).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) {
      throw failure("JOURNAL_CODEX_HOME_CONTAMINATED");
    }
  }
  await withOpenedRegularFile(path.join(home, "auth.json"), async (_handle, stat) => {
    if ((stat.mode & 0o077) !== 0) throw failure("JOURNAL_CODEX_HOME_INSECURE");
  });
}

function runProcess(command, args, { cwd, env, timeoutMs, onLine, onStderr = () => {} }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try { child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"], shell: false }); }
    catch { resolve({ code: null, timedOut: false, problem: "SPAWN_FAILED", durationMs: Date.now() - started }); return; }
    let line = "", total = 0, problem = null, timedOut = false;
    const killGroup = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.once("error", () => { problem = "SPAWN_FAILED"; });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_STREAM) { problem = "EVENT_STREAM_TOO_LARGE"; killGroup(); return; }
      line += chunk;
      for (;;) {
        const at = line.indexOf("\n");
        if (at < 0) break;
        const next = line.slice(0, at); line = line.slice(at + 1);
        if (Buffer.byteLength(next) > MAX_LINE) { problem = "EVENT_LINE_TOO_LARGE"; killGroup(); return; }
        onLine(next);
      }
      if (Buffer.byteLength(line) > MAX_LINE) { problem = "EVENT_LINE_TOO_LARGE"; killGroup(); }
    });
    let stderrTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-512);
      onStderr(stderrTail);
    }); // Only transiently inspect for a limit; never retain or print packet or answer text.
    child.once("close", (code) => { clearTimeout(timer); if (line.length) onLine(line); resolve({ code, timedOut, problem,
      durationMs: Date.now() - started }); });
  });
}

export async function runJournalCodexWorker(argv, { environment = process.env, stderr = process.stderr,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const options = parseJournalCodexWorkerArgs(argv);
  await checkCodexHome(options.codexHome);
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
  let logTail = Promise.resolve();
  const log = async (record) => {
    const bytes = `${JSON.stringify(record)}\n`;
    logTail = logTail.then(() => { if (logHandle) return logHandle.writeFile(bytes); stderr.write(bytes); });
    await logTail;
  };
  let importRun = null;
  function startImport() {
    if (!options.importCommand || importRun) return;
    const started = Date.now();
    importRun = runProcess(options.importCommand[0], options.importCommand.slice(1), {
      cwd: repositoryRoot, env: { PATH: environment.PATH ?? "", HOME: environment.HOME ?? "", LANG: environment.LANG ?? "C" },
      timeoutMs: options.timeoutMs, onLine: () => {}
    }).then(async ({ code }) => {
      await log({ at: new Date().toISOString(), kind: "import", exit_code: code, duration_ms: Date.now() - started });
    }).finally(() => { importRun = null; });
  }
  const running = new Map(), attempts = new Map(), seenThreads = new Set();
  let completed = 0, limitedUntil = 0;
  const initial = options.once ? new Set((await dispatch.listDispatch()).map((record) => record.work_id)) : null;
  startImport();

  async function one(record) {
    const started = Date.now();
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-codex-"));
    await fs.chmod(runDir, 0o700);
    const stageDir = path.join(runDir, "stage");
    await fs.mkdir(stageDir, { mode: 0o700 });
    const events = codexEventReader();
    let outcome = "error";
    try {
      const result = await runProcess(options.codexBin, codexExecArgs({ record, runDir, configPath: options.configPath, root, secretFile }), {
        cwd: runDir, env: { PATH: environment.PATH ?? "", HOME: environment.HOME ?? "", LANG: environment.LANG ?? "C", CODEX_HOME: options.codexHome },
        timeoutMs: options.timeoutMs, onLine: events.accept, onStderr: events.noteLimit
      });
      if (result.timedOut) outcome = "timeout";
      else if (events.state.limited && (result.code !== 0 || events.state.bad)) {
        outcome = "limited";
        limitedUntil = Math.max(limitedUntil, events.state.resetAt ?? Date.now() + options.limitBackoffMs);
      } else if (result.problem) outcome = `rejected:${result.problem}`;
      else if (result.code !== 0) outcome = "rejected:EXIT_NONZERO";
      else if (events.state.bad) outcome = `rejected:${events.state.bad}`;
      else if (events.state.threads.length !== 1) outcome = "rejected:THREAD_COUNT";
      else if (seenThreads.has(events.state.threads[0])) outcome = "rejected:THREAD_REUSED";
      else if (!events.state.completed) outcome = "rejected:TURN_INCOMPLETE";
      else if (!await fs.lstat(path.join(stageDir, `${journalWorkFileKey(record.work_id)}.json`)).then(() => true, () => false)) {
        outcome = "rejected:STAGE_MISSING";
      } else {
        seenThreads.add(events.state.threads[0]);
        const stored = await exchange.promoteStaged({ stageDir, workId: record.work_id, subject: "local:codex-standard",
          execution: { profile_evidence: "codex_exec_request_pinned", effective_model_profile: record.model,
            effective_effort: record.effort, request_context_id: `codex-thread:${events.state.threads[0]}` } });
        outcome = stored.already ? "already_answered" : "answered";
        if (outcome === "answered") startImport();
      }
    } catch { outcome = "error"; }
    finally {
      await fs.rm(runDir, { recursive: true, force: true });
      await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role, model: record.model,
        effort: record.effort, outcome, duration_ms: Date.now() - started, ...events.state.usage });
    }
    return outcome;
  }

  try {
    for (;;) {
      const now = Date.now();
      if (now >= limitedUntil && completed < options.maxItems) {
        const records = await dispatch.listDispatch();
        for (const record of records) {
          if (running.size >= options.concurrency || completed + running.size >= options.maxItems) break;
          if (initial && !initial.has(record.work_id)) continue;
          if (record.answered || record.tier !== "standard" || Date.parse(record.expires_at) <= now
            || !MODEL.test(record.model) || !EFFORTS.has(record.effort)
            || running.has(record.work_id) || (attempts.get(record.work_id) ?? 0) >= 3) continue;
          attempts.set(record.work_id, (attempts.get(record.work_id) ?? 0) + 1);
          const pending = one(record).finally(() => { running.delete(record.work_id); completed += 1; });
          running.set(record.work_id, pending);
        }
      }
      if (options.once || completed >= options.maxItems) {
        if (!running.size) break;
        await Promise.race(running.values());
      } else {
        await sleep(Math.max(options.pollMs, limitedUntil - Date.now(), 1));
      }
    }
    if (importRun) await importRun;
    return 0;
  } finally { await logHandle?.close(); }
}
