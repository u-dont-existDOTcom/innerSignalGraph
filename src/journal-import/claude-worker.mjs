import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockWorkerDirectory, parseCodexResetTime, privateDirectory, removeStaleRuns, runProcess } from "./codex-worker.mjs";
import { MAX_HARDEST_PACKET_CHARS } from "./packet-bounds.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { writeAttemptMarker } from "./attempt-markers.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL = "claude-opus-5-5";
const SESSION = /^[0-9A-Za-z-]{8,64}$/u;
const HOST = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/u;
const BIN = /^[A-Za-z0-9_./-]+$/u;
const MAX_LIMIT_RETRIES = 12;
// Three copies of a serialized packet appear in a stream line. Its JSON quotes
// and escapes can double on embedding; UTF-8 costs up to 3 bytes per code unit.
export const MAX_CLAUDE_LINE_BYTES = 3 * 4 * MAX_HARDEST_PACKET_CHARS + 1024 * 1024;
export const CLAUDE_PROVIDER_BACKOFF_MS = 5 * 60_000;
export const CLAUDE_PAUSED_EXIT_CODE = 75;
// The run was refused at init (isolation) before reaching the model: the local Claude Code setup changed.
// The item keeps a clearable hold and stays open; an operator fixes the setup and runs attempt-clear.
export const CLAUDE_SETUP_REFUSED_EXIT_CODE = 78;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function providerFailure(event) {
  const errors = [event, event?.error, event?.error?.cause,
    ...(Array.isArray(event?.errors) ? event.errors : [])].filter(value => value && typeof value === "object");
  const statuses = errors.flatMap(value => [value.api_error_status, value.status, value.status_code]);
  const status = statuses.map(value => typeof value === "string" && /^[0-9]{3}$/u.test(value) ? Number(value) : value)
    .find(value => Number.isInteger(value) && ([401, 403, 429].includes(value) || (value >= 500 && value <= 599))) ?? null;
  return { status, connectionFailed: errors.some(value => ["ECONNREFUSED", "ENOTFOUND"].includes(value.code)) };
}

function number(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  return parsed;
}

export function parseJournalClaudeWorkerArgs(argv) {
  const flags = new Set(["--agent", "--config", "--work-dir", "--claude-bin", "--remote", "--remote-checkout",
    "--remote-config", "--ssh-bin", "--log", "--once", "--max-items", "--timeout-ms", "--poll-ms", "--limit-backoff-ms"]);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!flags.has(name) || Object.hasOwn(options, name)) fail("JOURNAL_CLAUDE_OPTION_INVALID");
    options[name] = name === "--once" ? true : argv[++i];
    if (options[name] === undefined) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  }
  if (options["--agent"] !== "claude" || !path.isAbsolute(options["--work-dir"] ?? "")
    || (options["--log"] && !path.isAbsolute(options["--log"]))) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  const remote = options["--remote"] ?? null;
  if (remote) {
    if (!HOST.test(remote) || !path.isAbsolute(options["--remote-checkout"] ?? "")
      || !path.isAbsolute(options["--remote-config"] ?? "") || options["--config"]) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  } else if (!path.isAbsolute(options["--config"] ?? "")
    || options["--remote-checkout"] || options["--remote-config"]) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  const claudeBin = options["--claude-bin"] ?? "claude";
  const sshBin = options["--ssh-bin"] ?? "ssh";
  if (!BIN.test(claudeBin) || !BIN.test(sshBin)) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  return { remote, checkout: options["--remote-checkout"] ?? repositoryRoot,
    configPath: options["--remote-config"] ?? options["--config"], workDir: options["--work-dir"],
    claudeBin, sshBin, log: options["--log"] ?? null, once: Boolean(options["--once"]),
    maxItems: number(options["--max-items"], Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
    timeoutMs: number(options["--timeout-ms"], 1_800_000, 1, 3_600_000),
    pollMs: number(options["--poll-ms"], 5_000, 1, 60_000),
    limitBackoffMs: number(options["--limit-backoff-ms"], 1_800_000, 1, 86_400_000) };
}

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const sshOptions = ["-o", "BatchMode=yes", "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-T"];
const TOOLS = ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"];

export function claudeMcpConfiguration(options, stageDir, environment) {
  const args = [path.join(options.checkout, "src/cli/journal-work-mcp.mjs"),
    "--config", options.configPath, "--principal", "claude-hardest", "--tier", "hardest", "--stage-dir", stageDir];
  return { mcpServers: { journal: options.remote
    ? { command: options.sshBin, args: [...sshOptions, options.remote, ["node", ...args].map(quote).join(" ")] }
    : { command: process.execPath, args,
      env: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT,
        INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE } } } };
}

export function claudePrintArgs({ record, mcpConfig }) {
  if (record.tier !== "hardest" || record.model !== MODEL || record.effort !== "max") fail("JOURNAL_CLAUDE_PROFILE_INVALID");
  const instruction = `Private InnerSignal journal work item ${record.work_id}. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.`;
  return ["-p", instruction, "--model", "opus", "--effort", "max", "--output-format", "stream-json", "--verbose",
    "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--disable-slash-commands", "--include-hook-events",
    "--mcp-config", mcpConfig, "--strict-mcp-config", "--tools", "",
    "--allowedTools", "mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result",
    "--permission-mode", "dontAsk", "--no-session-persistence"];
}

export function claudeResultReader(record, expectedPacketLength = null) {
  const state = { bad: null, initialized: false, reachedModel: false, claudeCodeVersion: null,
    resultSeen: false, session: null, reportedSession: null, model: null,
    packetFetched: false, packetBeforeFirstSubmit: false, submitSeen: false, hookCount: 0,
    servers: [], tools: [], skillCount: 0, slashCount: 0, pluginCount: 0, agentCount: 0,
    usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_cost_usd: 0 },
    packetLength: null, providerStatus: null, providerConnectionFailed: false, limitReset: null, limitSeen: false };
  const packetCalls = new Set();
  function resetTime(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
    return null;
  }
  function hasUsage(value) {
    if (!value || typeof value !== "object") return false;
    return [value.input_tokens, value.output_tokens, value.inputTokens, value.outputTokens]
      .some(item => Number.isFinite(item) && item > 0);
  }
  function accept(line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { state.bad ??= !state.initialized ? "ISOLATION" : "EVENT_JSON_INVALID"; return; }
    if (!event || typeof event !== "object" || Array.isArray(event)) { state.bad ??= !state.initialized ? "ISOLATION" : "EVENT_INVALID"; return; }
    const synthetic = event.message?.model === "<synthetic>";
    const model = event.message?.model ?? event.model;
    if (!synthetic && typeof model === "string" && model !== "<synthetic>"
      && (hasUsage(event.message?.usage) || hasUsage(event.usage))) state.reachedModel = true;
    if (event.modelUsage && typeof event.modelUsage === "object"
      && Object.entries(event.modelUsage).some(([name, usage]) => name !== "<synthetic>" && hasUsage(usage))) {
      state.reachedModel = true;
    }
    if (event.error || event.is_error === true) {
      const { status, connectionFailed } = providerFailure(event);
      if ([401, 403].includes(status) || (status >= 500 && status <= 599)) state.providerStatus = status;
      if (status === 429) state.limitSeen = true;
      state.providerConnectionFailed ||= connectionFailed;
      // Claude Code reports some failures only through a synthetic assistant event's error label.
      if (synthetic && typeof event.error === "string") {
        if (event.error === "authentication_failed") state.providerStatus ??= 401;
        else if (["server_error", "unknown"].includes(event.error)) state.providerConnectionFailed = true;
      }
    }
    if ((typeof event.type === "string" && event.type.startsWith("hook"))
      || (typeof event.subtype === "string" && event.subtype.startsWith("hook"))) {
      state.hookCount += 1; state.bad = "ISOLATION"; return;
    }
    if (event.type === "assistant" && event.error === "rate_limit") state.limitSeen = true;
    if (event.type === "rate_limit_event") {
      const status = event.status ?? event.rate_limit_info?.status;
      if (typeof status === "string" && (status === "rejected"
        || (/limited/iu.test(status) && !/^not[_ -]limited$/iu.test(status)))) {
        state.limitSeen = true;
        state.limitReset = resetTime(event.resetsAt ?? event.rate_limit_info?.resetsAt) ?? state.limitReset;
      }
    }
    if (event.type === "system" && event.subtype === "init") {
      if (state.initialized) { state.bad = "ISOLATION"; return; }
      state.initialized = true;
      if (/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(event.claude_code_version ?? "")) {
        state.claudeCodeVersion = event.claude_code_version;
      }
      state.servers = Array.isArray(event.mcp_servers) ? event.mcp_servers.map((server) =>
        ({ name: server?.name, status: server?.status })) : [];
      state.tools = Array.isArray(event.tools) ? event.tools : [];
      for (const [key, field] of [["skills", "skillCount"], ["slash_commands", "slashCount"],
        ["plugins", "pluginCount"], ["agents", "agentCount"]]) {
        state[field] = Array.isArray(event[key]) ? event[key].length : -1;
      }
      if (JSON.stringify(state.servers) !== JSON.stringify([{ name: "journal", status: "connected" }])
        || state.tools.length !== TOOLS.length || !state.tools.every((name) => typeof name === "string")
        || !TOOLS.every((name) => state.tools.includes(name))
        || state.skillCount !== 0 || state.slashCount !== 0) state.bad = "ISOLATION";
      return;
    }
    if (!state.initialized) {
      if (event.type === "system") {
        if (["message", "content", "text", "result"].some((key) => Object.hasOwn(event, key))) state.bad = "ISOLATION";
        return;
      }
      if (event.type === "assistant" || event.type === "user" || event.type === "tool_use") { state.bad = "ISOLATION"; return; }
    }
    if (state.resultSeen) { state.bad ??= "RESULT_NOT_LAST"; return; }
    const uses = event.type === "tool_use" ? [event] : event.type === "assistant"
      ? (Array.isArray(event.message?.content) ? event.message.content.filter((part) => part?.type === "tool_use") : []) : [];
    for (const use of uses) {
      if (!synthetic) state.reachedModel = true;
      const name = use.name;
      const workId = use.input?.work_id;
      if (!TOOLS.includes(name)) { state.bad = "ISOLATION"; continue; }
      if (workId !== record.work_id) { state.bad ??= "WORK_ID_MISMATCH"; continue; }
      // A fetch counts only once its successful tool_result arrives (below); a submit issued in the same
      // assistant event as the fetch, before the model could see the packet, is not packet-backed.
      if (name === TOOLS[0] && workId === record.work_id && typeof use.id === "string") packetCalls.add(use.id);
      if (name === TOOLS[1] && workId === record.work_id && !state.submitSeen) {
        state.submitSeen = true; state.packetBeforeFirstSubmit = state.packetFetched;
      }
    }
    if (event.type === "user" && Array.isArray(event.message?.content)) {
      for (const part of event.message.content) {
        if (part?.type !== "tool_result" || !packetCalls.has(part.tool_use_id)) continue;
        const textLength = typeof part.content === "string" ? part.content.length
          : Array.isArray(part.content) ? part.content.reduce((sum, item) =>
            sum + (item?.type === "text" && typeof item.text === "string" ? item.text.length : 0), 0) : 0;
        state.packetLength = textLength;
        packetCalls.delete(part.tool_use_id);
        if (expectedPacketLength !== null && textLength !== expectedPacketLength) state.bad ??= "PACKET_TRUNCATED";
        else if (part.is_error !== true) state.packetFetched = true;
      }
    }
    if (event.type !== "result") return;
    if (state.resultSeen) { state.bad ??= "RESULT_COUNT"; return; }
    state.resultSeen = true;
    if (SESSION.test(event.session_id ?? "")) state.reportedSession = event.session_id;
    const limitFields = [event.subtype, typeof event.error === "string" ? event.error : null,
      event.error?.code, event.error?.type, event.error?.message,
      ...(Array.isArray(event.errors) ? event.errors.flatMap((item) => [item?.code, item?.type, item?.message]) : [])];
    const limitMessage = limitFields.filter((item) => typeof item === "string").join(" ");
    if (event.is_error === true && (event.api_error_status === 429
      || /\b429\b|usage[_ -]?limit|rate[_ -]?limit/iu.test(limitMessage))) {
      state.limitSeen = true;
      state.limitReset = resetTime(event.resetsAt) ?? parseCodexResetTime(limitMessage, Date.now()) ?? state.limitReset;
    }
    if (event.is_error !== false || event.subtype !== "success") { state.bad ??= "RESULT_UNSUCCESSFUL"; return; }
    if (!SESSION.test(event.session_id ?? "")) { state.bad ??= "SESSION_INVALID"; return; }
    const usage = event.modelUsage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage) || !Object.hasOwn(usage, record.model)) {
      state.bad ??= "MODEL_USAGE_INVALID"; return;
    }
    for (const [model, item] of Object.entries(usage)) {
      const outputTokens = item?.outputTokens ?? item?.output_tokens ?? 0;
      if (!item || typeof item !== "object" || Array.isArray(item)
        || !Number.isSafeInteger(outputTokens) || outputTokens < 0
        || (model !== record.model && outputTokens > 0)
        || (model === record.model && outputTokens === 0)) {
        state.bad ??= "MODEL_USAGE_INVALID"; return;
      }
    }
    const selected = usage[record.model];
    for (const value of [selected.inputTokens ?? selected.input_tokens ?? event.usage?.input_tokens ?? 0,
      selected.cacheReadInputTokens ?? selected.cache_read_input_tokens ?? event.usage?.cache_read_input_tokens ?? 0,
      selected.outputTokens ?? selected.output_tokens ?? 0]) {
      if (!Number.isSafeInteger(value) || value < 0) { state.bad ??= "MODEL_USAGE_INVALID"; return; }
    }
    state.session = event.session_id;
    state.model = record.model;
    state.usage = { input_tokens: selected.inputTokens ?? selected.input_tokens ?? event.usage?.input_tokens ?? 0,
      cached_input_tokens: selected.cacheReadInputTokens ?? selected.cache_read_input_tokens ?? event.usage?.cache_read_input_tokens ?? 0,
      output_tokens: selected.outputTokens ?? selected.output_tokens ?? 0,
      total_cost_usd: Number.isFinite(event.total_cost_usd) && event.total_cost_usd >= 0
        ? event.total_cost_usd : 0 };
  }
  return { state, accept };
}

export const claudeRunSlug = (directory) => path.resolve(directory).replace(/[^A-Za-z0-9]/gu, "-");
function persistenceRoots(home) {
  return [path.join(home, ".claude", "projects"), path.join(home, ".cache", "claude-cli-nodejs")];
}
async function containsFile(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || await containsFile(path.join(directory, entry.name))) return true;
  }
  return false;
}
export function assertClaudeRunPath(workDir) {
  const longestRun = path.join(workDir, "inner-signal-claude-XXXXXX", "run-XXXXXX");
  if (claudeRunSlug(longestRun).length > 200) fail("JOURNAL_CLAUDE_RUN_PATH_TOO_LONG");
}
export async function cleanClaudePersistence(home, runDir) {
  let persisted = false, cleanupError = null;
  const slug = claudeRunSlug(runDir);
  for (const root of persistenceRoots(home)) {
    try {
      const names = await fs.readdir(root);
      for (const name of names) {
        if (name !== slug && !(slug.length > 200 && name.startsWith(slug.slice(0, 200))
          && /^[-_A-Za-z0-9]{1,80}$/u.test(name.slice(200)))) continue;
        const directory = path.join(root, name);
        try { persisted = await containsFile(directory) || persisted; }
        finally { await fs.rm(directory, { recursive: true, force: true }); }
      }
    } catch (error) { if (error?.code !== "ENOENT") cleanupError ??= error; }
  }
  if (cleanupError) throw cleanupError;
  return persisted;
}
export async function sweepClaudePersistence(home, workDir) {
  const prefix = claudeRunSlug(path.join(workDir, "inner-signal-claude-"));
  for (const root of persistenceRoots(home)) {
    let names;
    try { names = await fs.readdir(root); } catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const name of names) {
      const suffix = name.startsWith(prefix) ? /^([A-Za-z0-9]{6})-run-([A-Za-z0-9]{6})$/u.exec(name.slice(prefix.length)) : null;
      if (suffix) {
        const runDir = path.join(workDir, `inner-signal-claude-${suffix[1]}`, `run-${suffix[2]}`);
        try { await fs.lstat(runDir); continue; }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
        await fs.rm(path.join(root, name), { recursive: true, force: true });
      }
    }
  }
}

async function linuxProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
    return { pid, start: fields[19], group: Number(fields[2]), state: fields[0] };
  } catch (error) { if (["ENOENT", "ESRCH"].includes(error?.code)) return null; throw error; }
}

export async function sweepClaudeProcessGroups(workDir, home) {
  for (const parent of await fs.readdir(workDir)) {
    if (!/^inner-signal-claude-[A-Za-z0-9]{6}$/u.test(parent)) continue;
    const directory = path.join(workDir, parent);
    const checked = await privateDirectory(directory, "JOURNAL_CLAUDE_WORK_DIR_INSECURE")
      .catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (checked !== directory) continue;
    const runs = await fs.readdir(directory).catch(error => error?.code === "ENOENT" ? [] : Promise.reject(error));
    for (const run of runs) {
      if (!/^run-[A-Za-z0-9]{6}$/u.test(run)) continue;
      const runDir = path.join(directory, run);
      const checkedRun = await privateDirectory(runDir, "JOURNAL_CLAUDE_WORK_DIR_INSECURE")
        .catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (checkedRun !== runDir) continue;
      let record;
      try {
        record = await withOpenedRegularFile(path.join(runDir, "process-group.json"), async (handle, info) => {
          if ((info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()) || info.size > 1024) {
            fail("JOURNAL_CLAUDE_PROCESS_RECORD_INVALID");
          }
          return JSON.parse(await handle.readFile("utf8"));
        });
      } catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      const owner = await linuxProcessIdentity(record.owner?.pid);
      if (owner?.start === record.owner?.start && owner.state !== "Z") continue;
      const child = await linuxProcessIdentity(record.child?.pid);
      // Linux start time prevents a stale record from killing a reused PID.
      if (child?.start === record.child?.start && child.group === child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error?.code !== "ESRCH") throw error; }
      }
      await cleanClaudePersistence(home, runDir);
      await fs.rm(runDir, { recursive: true, force: true });
    }
  }
}

export async function runJournalClaudeWorker(argv, { environment = process.env, stderr = process.stderr,
  platform = process.platform } = {}) {
  if (platform !== "linux") fail("JOURNAL_CLAUDE_LINUX_REQUIRED");
  const options = parseJournalClaudeWorkerArgs(argv);
  if (!path.isAbsolute(environment.HOME ?? "")) fail("JOURNAL_CLAUDE_HOME_INVALID");
  const workDir = await privateDirectory(options.workDir, "JOURNAL_CLAUDE_WORK_DIR_INSECURE");
  assertClaudeRunPath(workDir);
  if (!options.remote) {
    if (!environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT || !environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE
      || environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64 !== undefined) fail("JOURNAL_CLAUDE_EXCHANGE_CONFIG_INVALID");
    const configInfo = await fs.lstat(options.configPath);
    if (!configInfo.isFile() || (configInfo.mode & 0o077) !== 0) fail("JOURNAL_CLAUDE_CONFIG_INSECURE");
  }
  const parent = await fs.mkdtemp(path.join(workDir, "inner-signal-claude-"));
  await fs.chmod(parent, 0o700);
  let logHandle, unlockWorkerDirectory;
  try {
    logHandle = options.log ? await fs.open(options.log, "a", 0o600) : null;
    unlockWorkerDirectory = await lockWorkerDirectory(parent);
  } catch (error) {
    await fs.rm(parent, { recursive: true, force: true });
    await logHandle?.close();
    throw error;
  }
  const log = async (record) => {
    const bytes = `${JSON.stringify(record)}\n`;
    if (logHandle) await logHandle.writeFile(bytes); else stderr.write(bytes);
  };
  const processEnv = { PATH: environment.PATH ?? "", HOME: environment.HOME ?? "", LANG: environment.LANG ?? "C" };
  const activeGroups = new Set();
  let stopping = false, stopSignal = null, wake = null, limitedUntil = 0, completed = 0, signInNeeded = false, setupRefused = false, heldOpen = false;
  const attempts = new Map(), limits = new Map(), seenSessions = new Set(), pendingReleases = new Map();
  const stop = (signal) => { stopping = true; stopSignal ??= signal;
    if (wake) { const resume = wake; wake = null; resume(); }
    for (const kill of activeGroups) kill(); };
  const wait = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  });
  const onInt = () => stop("SIGINT"), onTerm = () => stop("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);

  async function host(command, values = []) {
    const commandArgs = [options.remote ? "node" : process.execPath,
      path.join(options.checkout, "src/cli/journal-work.mjs"), command, ...values];
    const executable = options.remote ? options.sshBin : commandArgs.shift();
    const args = options.remote
      ? [...sshOptions, options.remote, commandArgs.map(quote).join(" ")] : commandArgs;
    const lines = [];
    const result = await runProcess(executable, args, { cwd: parent,
      env: options.remote ? processEnv : { ...processEnv,
        INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT,
        INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE },
      timeoutMs: options.timeoutMs, onLine: (line) => { if (line.trim()) lines.push(line); }, activeGroups });
    if (result.code !== 0 || result.problem || result.timedOut) {
      // A host call killed by a stop signal is a stop, not a host outage.
      fail(stopping ? "JOURNAL_CLAUDE_STOPPED" : "JOURNAL_CLAUDE_HOST_UNAVAILABLE");
    }
    try { return lines.map((line) => JSON.parse(line)); } catch { fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID"); }
  }

  async function one(record) {
    const started = Date.now();
    let stageDir = null, runDir = null, outcome = "error";
    let observed = null;
    const claim = randomUUID();
    let claimed = false, reachedModel = false, isolationRefused = false, persisted = false, persistenceChecked = false;
    let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
    try {
      // Validate the profile before creating a stage or invoking the provider.
      claudePrintArgs({ record, mcpConfig: "/tmp/placeholder" });
      if (!/^[0-9a-f]{48}$/u.test(record.attempt_identity ?? "")) fail("JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED");
      const reservation = await host("attempt-reserve", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim,
        "--timeout-ms", String(options.timeoutMs)]);
      if (reservation[0]?.claimed !== true) {
        const held = (await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0];
        outcome = held?.status === "reserved" ? "reserved" : held?.status === "isolation_refused" ? "isolation_refused" : "already_attempted";
        return outcome;
      }
      claimed = true;
      const packetCheck = (await host("packet-check", ["--work-id", record.work_id]))[0];
      if (packetCheck?.allowed !== true) {
        outcome = "rejected:PACKET_TOO_LARGE"; return outcome;
      }
      if (!Number.isSafeInteger(packetCheck.packet_length) || packetCheck.packet_length < 1
        || packetCheck.packet_length > MAX_HARDEST_PACKET_CHARS) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      const created = await host("stage-create");
      stageDir = created[0]?.stage_dir;
      if (typeof stageDir !== "string" || !path.isAbsolute(stageDir)) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      runDir = await fs.mkdtemp(path.join(parent, "run-"));
      await fs.chmod(runDir, 0o700);
      const mcpConfig = path.join(runDir, "mcp.json");
      await fs.writeFile(mcpConfig, JSON.stringify(claudeMcpConfiguration(options, stageDir, environment)), { flag: "wx", mode: 0o600 });
      const reader = claudeResultReader(record, packetCheck.packet_length);
      observed = reader.state;
      let result;
      try { result = await runProcess(options.claudeBin, claudePrintArgs({ record, mcpConfig }), {
        cwd: runDir, env: { ...processEnv, XDG_CACHE_HOME: path.join(runDir, "cache") },
        maxLineBytes: MAX_CLAUDE_LINE_BYTES, maxStreamBytes: 4 * MAX_CLAUDE_LINE_BYTES, killOnClose: true,
        onSpawn: async pid => {
          const owner = await linuxProcessIdentity(process.pid), child = await linuxProcessIdentity(pid);
          if (!owner || !child || child.group !== pid) fail("JOURNAL_CLAUDE_PROCESS_RECORD_INVALID");
          await writeAttemptMarker(path.join(runDir, "process-group.json"), { owner, child }, true);
        },
        timeoutMs: options.timeoutMs, onLine: async (line, kill) => {
          reader.accept(line);
          if (reader.state.bad === "ISOLATION") { isolationRefused = true; kill(); }
          if (!reachedModel && reader.state.reachedModel) {
            reachedModel = true;
            // Await the durable mark while stdout is paused, before accepting
            // further events or allowing the child result to be admitted.
            await host("attempt-mark", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim]);
          }
          if (isolationRefused) return false;
        }, activeGroups
      }); } finally {
        // This finally runs before admission/promotion, even when the child failed.
        try { persisted = await cleanClaudePersistence(processEnv.HOME, runDir); persistenceChecked = true; }
        catch { persisted = true; }
      }
      if (reader.state.reportedSession) {
        const reused = seenSessions.has(reader.state.reportedSession);
        seenSessions.add(reader.state.reportedSession);
        if (reused) reader.state.bad ??= "SESSION_REUSED";
      }
      usage = reader.state.usage;
      if (result.code !== 0 && !reader.state.resultSeen) {
        let error;
        try { error = JSON.parse(result.stderrLast); } catch { /* Unstructured stderr is never limit evidence. */ }
        const { status, connectionFailed } = providerFailure(error);
        if ([401, 403].includes(status) || (status >= 500 && status <= 599)) reader.state.providerStatus = status;
        reader.state.providerConnectionFailed ||= connectionFailed;
        if (status === 429) reader.state.limitSeen = true;
        const fields = [typeof error === "string" ? error : null, error?.code, error?.type, error?.message]
          .filter((value) => typeof value === "string").join(" ");
        if (/\b429\b|usage[_ -]?limit|rate[_ -]?limit/iu.test(fields)) {
          reader.state.limitSeen = true;
          reader.state.limitReset = parseCodexResetTime(fields, Date.now());
        }
      }
      if (isolationRefused) {
        outcome = "isolation_refused";
      } else if ((reader.state.providerStatus !== null || reader.state.providerConnectionFailed || reader.state.limitSeen) && !reachedModel) {
        const unavailable = reader.state.providerStatus !== null || reader.state.providerConnectionFailed;
        const needsSignIn = [401, 403].includes(reader.state.providerStatus);
        signInNeeded = needsSignIn;
        outcome = persisted ? "rejected:LOCAL_PERSISTENCE" : needsSignIn ? "sign_in_needed"
          : unavailable ? "provider_unavailable" : "limited";
        limitedUntil = Math.max(limitedUntil, unavailable ? Date.now() + CLAUDE_PROVIDER_BACKOFF_MS
          : reader.state.limitReset ?? Date.now() + options.limitBackoffMs);
        if (claimed) {
          try {
            await host("attempt-release", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim]);
            claimed = false;
          } catch {
            pendingReleases.set(record.work_id, { claim, identity: record.attempt_identity });
            await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "attempt_release_failed" });
          }
        }
      } else {
        if (reader.state.limitSeen || reader.state.providerStatus !== null || reader.state.providerConnectionFailed) {
          limitedUntil = Math.max(limitedUntil, Date.now() + (reader.state.providerStatus !== null || reader.state.providerConnectionFailed
            ? CLAUDE_PROVIDER_BACKOFF_MS : options.limitBackoffMs));
          signInNeeded = [401, 403].includes(reader.state.providerStatus);
        }
        if (reader.state.bad === "PACKET_TRUNCATED") outcome = "rejected:PACKET_TRUNCATED";
        else if (persisted) outcome = "rejected:LOCAL_PERSISTENCE";
        else if (stopping) outcome = "stopped";
        else if (result.timedOut) outcome = "timeout";
        else if (result.problem) outcome = `rejected:${result.problem}`;
        else if (!reader.state.initialized) outcome = "rejected:ISOLATION";
        else if (result.code !== 0) outcome = "rejected:EXIT_NONZERO";
        else if (reader.state.bad) outcome = `rejected:${reader.state.bad}`;
        else if (!reader.state.session) outcome = "rejected:RESULT_MISSING";
        else if (!reader.state.packetBeforeFirstSubmit) outcome = "rejected:PACKET_NOT_FETCHED";
        else if (reader.state.packetLength !== packetCheck.packet_length) outcome = "rejected:PACKET_TRUNCATED";
        else {
          const status = await host("stage-check", ["--work-id", record.work_id, "--stage-dir", stageDir]);
          if (status[0]?.packet_fetched !== true) outcome = "rejected:PACKET_NOT_FETCHED";
          else if (status[0]?.staged !== true) outcome = "rejected:STAGE_MISSING";
          else {
            const execution = { profile_evidence: "claude_code_model_usage_reported",
              effective_model_profile: reader.state.model, effective_effort: record.effort,
              request_context_id: `claude-session:${reader.state.session}` };
            const promoted = await host("promote", ["--work-id", record.work_id, "--stage-dir", stageDir,
              "--execution-json", JSON.stringify(execution), "--subject", "local:claude-hardest"]);
            outcome = promoted[0]?.answered ? "answered" : promoted[0]?.already ? "already_answered" : "error";
          }
        }
      }
    } catch {
      if (outcome !== "limited" && !isolationRefused) {
        outcome = persisted ? "rejected:LOCAL_PERSISTENCE" : stopping ? "stopped" : "error";
      }
    }
    finally {
      if (claimed && isolationRefused) {
        outcome = "isolation_refused";
        try { await host("attempt-refuse", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim]); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "attempt_refuse_failed" }); }
      } else if (claimed && !reachedModel && !observed?.limitSeen && outcome !== "limited") {
        try {
          await host("attempt-release", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim]); claimed = false;
          pendingReleases.delete(record.work_id);
        }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "attempt_release_failed" }); }
      }
      if (runDir) {
        if (!persistenceChecked) {
          try { if (await cleanClaudePersistence(processEnv.HOME, runDir)) outcome = "rejected:LOCAL_PERSISTENCE"; }
          catch { outcome = "rejected:LOCAL_PERSISTENCE"; }
        }
        try { await fs.rm(runDir, { recursive: true, force: true }); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "run_remove_failed" }); }
      }
      if (stageDir) {
        try { await host("stage-remove", ["--stage-dir", stageDir]); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "stage_remove_failed" }); }
      }
      const unreachedIsolation = outcome === "isolation_refused" && !reachedModel;
      if (unreachedIsolation) setupRefused = true;
      else if (["already_attempted", "isolation_refused", "rejected:PACKET_TOO_LARGE"].includes(outcome)
        || (reachedModel && !["answered", "already_answered"].includes(outcome))) {
        try { await host("close-unanswered", ["--work-id", record.work_id]); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "item_close_failed" }); }
      }
      await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
        model: record.model, effort: record.effort, outcome, duration_ms: Date.now() - started,
        mcp_servers: observed?.servers?.filter(({ name, status }) => name === "journal" && status === "connected") ?? [],
        server_count: observed?.servers?.length ?? 0,
        tools: observed?.tools?.filter((name) => TOOLS.includes(name)) ?? [], tool_count: observed?.tools?.length ?? 0,
        skill_count: observed?.skillCount ?? 0, slash_command_count: observed?.slashCount ?? 0,
        plugin_count: observed?.pluginCount ?? 0, agent_count: observed?.agentCount ?? 0,
        hook_event_count: observed?.hookCount ?? 0,
        claude_code_version: observed?.claudeCodeVersion ?? null, model_reached: reachedModel,
        ...usage, cost_kind: "subscription_cost_equivalent_not_charged" });
    }
    return outcome;
  }

  try {
    await sweepClaudeProcessGroups(workDir, processEnv.HOME);
    await removeStaleRuns(workDir, "inner-signal-claude-");
    await sweepClaudePersistence(processEnv.HOME, workDir);
    await host("stage-sweep");
    const initial = options.once ? new Set((await host("dispatch", ["--json"])).map((record) => record.work_id)) : null;
    for (;;) {
      if (stopping || completed >= options.maxItems) break;
      for (const [workId, { claim, identity }] of pendingReleases) {
        try {
          await host("attempt-release", ["--work-id", workId, "--attempt-identity", identity, "--claim", claim]);
          pendingReleases.delete(workId);
        } catch { /* Keep the limited outcome and reservation; retry on the next loop. */ }
      }
      if (signInNeeded) break;
      if (Date.now() < limitedUntil) {
        if (options.once) break;
        await wait(Math.min(options.pollMs, limitedUntil - Date.now()));
        continue;
      }
      const records = await host("dispatch", ["--json"]);
      let record = records.find((item) => (!initial || initial.has(item.work_id)) && !item.answered
        && item.tier === "hardest" && item.model === MODEL && item.effort === "max"
        && /^[0-9a-f]{48}$/u.test(item.attempt_identity ?? "")
        && Date.parse(item.expires_at) > Date.now()
        && !pendingReleases.has(item.work_id)
        && (attempts.get(item.work_id) ?? 0) < 3 && (limits.get(item.work_id) ?? 0) < MAX_LIMIT_RETRIES);
      const marker = record ? (await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0] : null;
      if (record && marker?.attempted) {
        attempts.set(record.work_id, 3);
        const spent = marker.packet_fetched === true || marker.model_reached === true;
        // A hold left by a run refused at init, before the model, stays open for an operator to clear.
        // The setup may still be broken, so stop without closing it or trying further items (exit 78).
        if (marker.status === "isolation_refused" && !spent) {
          heldOpen = true;
          await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
            model: record.model, effort: record.effort, outcome: "isolation_refused", duration_ms: 0 });
          break;
        }
        // A live sibling may own a reservation; a reservation whose packet was served and whose run is long
        // past its timeout belongs to a dead worker and has spent the attempt.
        const staleSpent = marker.status === "reserved" && marker.packet_fetched === true
          && (marker.age_seconds ?? 0) * 1000 >= (marker.timeout_ms ?? 1_800_000) + 600_000;
        if (marker.status !== "reserved" || staleSpent) {
          try { await host("close-unanswered", ["--work-id", record.work_id]); }
          catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "item_close_failed" }); }
        }
        await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
          model: record.model, effort: record.effort,
          outcome: marker.status === "reserved" ? (staleSpent ? "stale_reservation_closed" : "reserved")
            : marker.status === "isolation_refused" ? "isolation_refused" : "already_attempted", duration_ms: 0 });
        continue;
      }
      if (!record) {
        if (options.once && !pendingReleases.size) break;
        await wait(options.pollMs);
        continue;
      }
      const outcome = await one(record);
      if (setupRefused) break;
      if (["limited", "provider_unavailable", "sign_in_needed"].includes(outcome)) limits.set(record.work_id, (limits.get(record.work_id) ?? 0) + 1);
      else if (["reserved", "already_attempted", "isolation_refused", "rejected:PACKET_TOO_LARGE"].includes(outcome)) attempts.set(record.work_id, 3);
      else if (outcome !== "stopped") {
        attempts.set(record.work_id, (attempts.get(record.work_id) ?? 0) + 1);
        if ((await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0]?.attempted) {
          attempts.set(record.work_id, 3); completed += 1;
        }
      }
    }
    // 77 is the content-free sign-in-required exit status for the operator.
    return stopSignal === "SIGINT" ? 130 : stopSignal === "SIGTERM" ? 143 : signInNeeded ? 77
      : setupRefused || heldOpen ? CLAUDE_SETUP_REFUSED_EXIT_CODE
      : options.once && Date.now() < limitedUntil ? CLAUDE_PAUSED_EXIT_CODE : 0;
  } catch (error) {
    if (error?.code !== "JOURNAL_CLAUDE_STOPPED") throw error;
    return stopSignal === "SIGINT" ? 130 : 143;
  } finally {
    stop();
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    try { await fs.rm(parent, { recursive: true, force: true }); }
    finally { await unlockWorkerDirectory(); await logHandle?.close(); }
  }
}
