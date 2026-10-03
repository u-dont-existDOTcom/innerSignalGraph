import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockWorkerDirectory, parseCodexResetTime, privateDirectory, removeStaleRuns, runProcess } from "./codex-worker.mjs";
import { MAX_HARDEST_PACKET_CHARS } from "./packet-bounds.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { writeAttemptMarker } from "./attempt-markers.mjs";
import { assertJournalWorkId } from "./work-exchange.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL = "claude-opus-5-5";
const SESSION = /^[0-9A-Za-z-]{8,64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// Process states (from /proc/<pid>/stat) of a process that has exited: zombie, or dead while being reaped.
const DEAD_STATES = Object.freeze(["Z", "X", "x"]);
const PENDING_NAME = /^[0-9a-f-]{36}\.json$/u;
const HOST = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/u;
const BIN = /^[A-Za-z0-9_./-]+$/u;
const MAX_LIMIT_RETRIES = 12;
// Host commands are small; a slow one is cut off rather than allowed to hold the run's reservation.
const HOST_CALL_TIMEOUT_MS = 120_000;
// A sibling may reclaim an unspent reservation after twice the run timeout plus ten minutes, so a run whose
// preflight took longer than this gives up before starting Claude.
const PREFLIGHT_LIMIT_MS = 5 * 60_000;
// Three copies of a serialized packet appear in a stream line. Its JSON quotes
// and escapes can double on embedding; UTF-8 costs up to 3 bytes per code unit.
export const MAX_CLAUDE_LINE_BYTES = 3 * 4 * MAX_HARDEST_PACKET_CHARS + 1024 * 1024;
export const CLAUDE_PROVIDER_BACKOFF_MS = 5 * 60_000;
export const CLAUDE_PAUSED_EXIT_CODE = 75;
// The run was refused at init (isolation) before reaching the model: the local Claude Code setup changed.
// The item keeps a clearable hold and stays open; an operator fixes the setup and runs attempt-clear.
export const CLAUDE_SETUP_REFUSED_EXIT_CODE = 78;
export const CLAUDE_CLEANUP_FAILED_EXIT_CODE = 74;
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
    "--remote-config", "--remote-node", "--ssh-bin", "--log", "--once", "--max-items", "--timeout-ms", "--poll-ms", "--limit-backoff-ms"]);
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
    // A noninteractive SSH PATH can resolve a bare `node` to another runtime, so the host's Node executable (or a
    // host wrapper that also sets the exchange environment) is named explicitly.
    if (!HOST.test(remote) || !path.isAbsolute(options["--remote-checkout"] ?? "")
      || !path.isAbsolute(options["--remote-config"] ?? "") || !path.isAbsolute(options["--remote-node"] ?? "")
      || !BIN.test(options["--remote-node"]) || options["--config"]) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  } else if (!path.isAbsolute(options["--config"] ?? "")
    || options["--remote-checkout"] || options["--remote-config"] || options["--remote-node"]) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  const claudeBin = options["--claude-bin"] ?? "claude";
  const sshBin = options["--ssh-bin"] ?? "ssh";
  if (!BIN.test(claudeBin) || !BIN.test(sshBin)) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  return { remote, remoteNode: options["--remote-node"] ?? null, checkout: options["--remote-checkout"] ?? repositoryRoot,
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

export function claudeMcpConfiguration(options, stageDir, environment, workId) {
  if (typeof workId !== "string" || workId.length === 0) fail("JOURNAL_CLAUDE_OPTION_INVALID");
  // The server is scoped to this run's item, so a call naming another item reads and marks nothing of it.
  const args = [path.join(options.checkout, "src/cli/journal-work-mcp.mjs"),
    "--config", options.configPath, "--principal", "claude-hardest", "--tier", "hardest", "--stage-dir", stageDir,
    "--work-id", workId];
  return { mcpServers: { journal: options.remote
    ? { command: options.sshBin, args: [...sshOptions, options.remote, [options.remoteNode, ...args].map(quote).join(" ")] }
    : { command: process.execPath, args,
      env: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT,
        INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE } } } };
}

export function claudePrintArgs({ record, mcpConfig, sessionId }) {
  if (record.tier !== "hardest" || record.model !== MODEL || record.effort !== "max") fail("JOURNAL_CLAUDE_PROFILE_INVALID");
  if (!UUID.test(sessionId ?? "")) fail("JOURNAL_CLAUDE_SESSION_INVALID");
  const instruction = `Private InnerSignal journal work item ${record.work_id}. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done.`;
  return ["-p", instruction, "--model", "opus", "--effort", "max", "--output-format", "stream-json", "--verbose",
    "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--disable-slash-commands", "--include-hook-events",
    "--mcp-config", mcpConfig, "--strict-mcp-config", "--tools", "", "--session-id", sessionId,
    "--allowedTools", "mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result",
    "--permission-mode", "dontAsk", "--no-session-persistence"];
}

export function claudeResultReader(record, expectedPacketLength = null, expectedSession = null) {
  const state = { bad: null, initialized: false, reachedModel: false, claudeCodeVersion: null,
    resultSeen: false, session: null, sessionMismatch: false, abort: false, model: null,
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
    // The worker chose and reserved this run's session before starting Claude. Init must report it, and so must any
    // event that carries a session_id at all: a missing, null, malformed or foreign value is an isolation failure, so
    // the run is killed before it can be served the packet (init precedes every assistant event).
    if (expectedSession !== null && event.session_id !== expectedSession
      && (Object.hasOwn(event, "session_id") || (event.type === "system" && event.subtype === "init"))) {
      state.sessionMismatch = true; state.bad = "ISOLATION";
    }
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
      // A call naming another item ends the run at once (its server is scoped to this item and refuses it anyway).
      if (workId !== record.work_id) { state.bad ??= "WORK_ID_MISMATCH"; state.abort = true; continue; }
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
    if (expectedSession !== null ? event.session_id !== expectedSession : !SESSION.test(event.session_id ?? "")) {
      state.bad ??= "SESSION_INVALID"; return;
    }
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

// Claude Code names a project folder by replacing every non-alphanumeric UTF-16 code unit of the cwd with "-", so a
// character outside the BMP (a surrogate pair) becomes two dashes. This must match it exactly; no "u" flag here.
// eslint-disable-next-line require-unicode-regexp
export const claudeRunSlug = (directory) => path.resolve(directory).replace(/[^A-Za-z0-9]/g, "-");
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

// Whether the worker that recorded a run is still running: same PID and start time, and not exited.
export const recordedOwnerAlive = (owner, record) =>
  owner !== null && owner?.start === record?.owner?.start && !DEAD_STATES.includes(owner.state);

async function linuxProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
    return { pid, start: fields[19], group: Number(fields[2]), state: fields[0] };
  } catch (error) { if (["ENOENT", "ESRCH"].includes(error?.code)) return null; throw error; }
}

// Kill a recorded process group and wait until no member remains, so nothing the run started can still
// write a persistence artifact after the scan. Returns false if the group outlives the deadline.
// True if any process in the group can still run. Zombies (and dead entries) can't do filesystem I/O; on
// hosts whose PID 1 or subreaper doesn't reap, killed helpers can stay zombies and keep the group "alive"
// for kill(2). If /proc can't be listed, assume a live member so the caller keeps waiting.
export async function processGroupHasLiveMember(pgid, procRoot = "/proc") {
  let names;
  try { names = await fs.readdir(procRoot); } catch { return true; }
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    let stat;
    try { stat = await fs.readFile(path.join(procRoot, name, "stat"), "utf8"); } catch { continue; }
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
    if (Number(fields[2]) === pgid && !DEAD_STATES.includes(fields[0])) return true;
  }
  return false;
}

export async function waitForProcessGroupGone(pgid, timeoutMs = 10_000) {
  if (!Number.isSafeInteger(pgid) || pgid < 2) return true;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { process.kill(-pgid, "SIGKILL"); }
    catch (error) { if (error?.code === "ESRCH") return true; throw error; }
    if (!(await processGroupHasLiveMember(pgid))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

// Whether a live worker holds the parent's lock (flock -n fails while it is held). Null when the lock is not the
// private regular file lockWorkerDirectory creates, so the caller can't tell and must fail closed.
async function workerLockHeld(parentDir) {
  const lock = path.join(parentDir, "worker.lock");
  let info;
  try { info = await fs.lstat(lock); } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  if (!info.isFile() || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) return null;
  return new Promise((resolve, reject) => {
    const child = spawn("flock", ["-n", lock, "true"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => resolve(code !== 0));
  });
}

// Process groups of live processes whose working directory is the run directory or inside it. Claude always
// runs with its run directory as cwd, so this finds an orphan even when its process record was never written.
// Returns null if /proc can't be listed.
export async function processGroupsWorkingIn(directory, procRoot = "/proc") {
  let names;
  try { names = await fs.readdir(procRoot); } catch { return null; }
  const groups = new Set();
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    let cwd, stat;
    try {
      cwd = await fs.readlink(path.join(procRoot, name, "cwd"));
      stat = await fs.readFile(path.join(procRoot, name, "stat"), "utf8");
    } catch { continue; }
    if (cwd !== directory && !cwd.startsWith(directory + path.sep)) continue;
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
    if (!DEAD_STATES.includes(fields[0])) groups.add(Number(fields[2]));
  }
  return groups;
}

// The release of a reservation the worker still owns must survive a worker restart: a failed one is kept as a
// 0600 file named by its claim under the work dir until the host confirms it or the reservation is reclaimable.
async function pendingDirectory(workDir, name) {
  const directory = path.join(workDir, name);
  await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (error?.code !== "EEXIST") throw error; });
  if (await privateDirectory(directory, "JOURNAL_CLAUDE_WORK_DIR_INSECURE") !== directory) fail("JOURNAL_CLAUDE_WORK_DIR_INSECURE");
  return directory;
}

const validWorkId = (value) => { try { assertJournalWorkId(value); return true; } catch { return false; } };
const plainObject = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const validPendingHold = (value) => plainObject(value, ["work_id", "attempt_identity", "claim"])
  && validWorkId(value.work_id) && /^[0-9a-f]{48}$/u.test(value.attempt_identity ?? "") && /^[0-9a-f-]{36}$/u.test(value.claim ?? "");
export const validPendingRelease = (value) => plainObject(value, ["work_id", "attempt_identity", "claim", "expires_at"])
  && validWorkId(value.work_id) && /^[0-9a-f]{48}$/u.test(value.attempt_identity ?? "")
  && /^[0-9a-f-]{36}$/u.test(value.claim ?? "") && Number.isSafeInteger(value.expires_at);

export async function readPendingEntries(directory, valid) {
  const entries = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name);
    if (name.endsWith(".tmp")) {
      // An atomic write interrupted before its rename leaves only a temporary file, never the entry itself.
      const info = await fs.lstat(file).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (info && info.mtimeMs < Date.now() - 600_000) await fs.rm(file, { force: true });
      continue;
    }
    if (!PENDING_NAME.test(name)) fail("JOURNAL_CLAUDE_PENDING_INVALID");
    let value;
    try {
      value = await withOpenedRegularFile(file, async (handle, info) => {
        if ((info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid()) || info.size > 131_072) {
          fail("JOURNAL_CLAUDE_PENDING_INVALID");
        }
        return JSON.parse(await handle.readFile("utf8"));
      });
    } catch (error) {
      if (error?.code === "ENOENT") continue; // another worker on this work dir finished it
      if (error instanceof SyntaxError) fail("JOURNAL_CLAUDE_PENDING_INVALID");
      throw error;
    }
    if (!valid(value)) fail("JOURNAL_CLAUDE_PENDING_INVALID");
    entries.push({ file, value });
  }
  return entries;
}

export async function sweepClaudeProcessGroups(workDir, home) {
  // Parents holding a run whose group could not be confirmed gone; callers must not delete them.
  const unresolved = new Set();
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
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        // No process record: Claude is started only after its record is written (runProcess gate), so it never
        // ran here; at most the waiting gate shell is left. A live worker's run (lock held) is left alone.
        // Otherwise any process still working in the run directory is killed and its group confirmed gone; if
        // that can't be confirmed, the run is kept and startup fails closed.
        const held = await workerLockHeld(directory);
        if (held === null) { unresolved.add(parent); continue; }
        if (held) continue;
        const groups = await processGroupsWorkingIn(await fs.realpath(runDir));
        if (groups === null) { unresolved.add(parent); continue; }
        let gone = true;
        for (const group of groups) gone = (await waitForProcessGroupGone(group)) && gone;
        if (!gone) { unresolved.add(parent); continue; }
        await cleanClaudePersistence(home, runDir);
        await fs.rm(runDir, { recursive: true, force: true });
        continue;
      }
      const owner = await linuxProcessIdentity(record.owner?.pid);
      if (recordedOwnerAlive(owner, record)) continue;
      const child = await linuxProcessIdentity(record.child?.pid);
      // Linux start time prevents a stale record from killing a reused PID. If the leader is gone, the
      // recorded PGID can only still exist as the original group (a PID isn't reused while its group has
      // members), so surviving helpers are killed too. Leave the run for a later start if the group can't
      // be confirmed gone before scanning.
      const leaderGone = child === null;
      const leaderIsOurs = child?.start === record.child?.start && child?.group === child?.pid;
      if ((leaderGone || leaderIsOurs) && Number.isSafeInteger(record.child?.pid)) {
        if (!(await waitForProcessGroupGone(record.child.pid))) { unresolved.add(parent); continue; }
      }
      await cleanClaudePersistence(home, runDir);
      await fs.rm(runDir, { recursive: true, force: true });
    }
  }
  return unresolved;
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
  const pendingReleasesDir = await pendingDirectory(workDir, "pending-releases");
  const pendingRefusalsDir = await pendingDirectory(workDir, "pending-refusals");
  const pendingSpendsDir = await pendingDirectory(workDir, "pending-spends");
  // One record per isolation refusal, before or after model reach. While any exists, the worker won't start; an
  // operator removes it after fixing the Claude setup (and clears a held item on the host with attempt-clear).
  const setupRefusalsDir = await pendingDirectory(workDir, "setup-refusals");
  const holdDirectories = { refuse: pendingRefusalsDir, spend: pendingSpendsDir, setup: setupRefusalsDir };
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
  let stopping = false, stopSignal = null, wake = null, limitedUntil = 0, completed = 0, signInNeeded = false, setupRefused = false, heldOpen = false, cleanupFailed = false,
    preserveParent = false;
  // Items whose reservation belongs to a live sibling are skipped until the worker has next waited one poll
  // (not given up on, and not re-checked in a tight loop); each such reservation is logged once.
  const skipped = new Set(), reservedLogged = new Set();
  const attempts = new Map(), limits = new Map(), pendingReleases = new Map(), unrecordedHolds = [], closeRetries = new Set();
  let holdsPending = false;
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
    const commandArgs = [options.remote ? options.remoteNode : process.execPath,
      path.join(options.checkout, "src/cli/journal-work.mjs"), command, ...values];
    const executable = options.remote ? options.sshBin : commandArgs.shift();
    const args = options.remote
      ? [...sshOptions, options.remote, commandArgs.map(quote).join(" ")] : commandArgs;
    const lines = [];
    const result = await runProcess(executable, args, { cwd: parent,
      env: options.remote ? processEnv : { ...processEnv,
        INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT,
        INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE },
      timeoutMs: Math.min(options.timeoutMs, HOST_CALL_TIMEOUT_MS), onLine: (line) => { if (line.trim()) lines.push(line); }, activeGroups });
    if (result.code !== 0 || result.problem || result.timedOut) {
      // A host call killed by a stop signal is a stop, not a host outage.
      fail(stopping ? "JOURNAL_CLAUDE_STOPPED" : "JOURNAL_CLAUDE_HOST_UNAVAILABLE");
    }
    try { return lines.map((line) => JSON.parse(line)); } catch { fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID"); }
  }

  // A release that failed is retried from the main loop, and kept on disk until its reservation could be
  // reclaimed anyway, so a later worker can finish it with the same claim. While a claim is neither released nor
  // saved, the worker neither exits (except on a stop signal) nor takes new work.
  async function persistRelease(workId, entry) {
    try {
      await writeAttemptMarker(path.join(pendingReleasesDir, `${entry.claim}.json`),
        { work_id: workId, attempt_identity: entry.identity, claim: entry.claim, expires_at: entry.expiresAt });
      entry.saved = true;
    } catch { entry.saved = false; }
  }
  async function queueRelease(workId, identity, claim) {
    const entry = { claim, identity, expiresAt: Date.now() + 2 * options.timeoutMs + 600_000, saved: false };
    pendingReleases.set(workId, entry);
    await persistRelease(workId, entry);
    if (!entry.saved) await log({ at: new Date().toISOString(), work_id: workId, outcome: "pending_release_unsaved" });
  }
  // Host records a run's reservation must not lose: "refuse" is the hold for an isolation refusal before the
  // model; "spend" records that the model was reached (and closes the item), so the attempt can't be reclaimed as
  // unspent. Either is kept on disk if the host didn't take it. True once the host has it, or has nothing to apply.
  async function applyHold(kind, hold) {
    if (kind === "setup") return false; // kept on this computer only, so it must reach the disk
    const ids = ["--work-id", hold.work_id, "--attempt-identity", hold.attempt_identity];
    try { await host(kind === "refuse" ? "attempt-refuse" : "attempt-mark", [...ids, "--claim", hold.claim]); }
    catch {
      const status = (await host("attempt-status", ids))[0];
      const recorded = kind === "refuse" ? status?.status === "isolation_refused" : status?.model_reached === true;
      if (status?.status !== "none" && !recorded) return false;
    }
    // The item's exhausted tombstone is part of a spend: a failed close keeps the hold for another try (closing an
    // item that already has an answer or tombstone succeeds without change).
    if (kind === "spend") await host("close-unanswered", ["--work-id", hold.work_id]);
    return true;
  }
  async function keepHold(kind, hold) {
    try { await writeAttemptMarker(path.join(holdDirectories[kind], `${hold.claim}.json`), hold); }
    catch {
      // Neither the host nor the disk has it: retried before the worker stops or takes another item.
      unrecordedHolds.push({ kind, hold });
      await log({ at: new Date().toISOString(), work_id: hold.work_id,
        outcome: { refuse: "isolation_refusal_unsaved", spend: "attempt_spend_unsaved", setup: "setup_refusal_unsaved" }[kind] });
    }
  }
  // A hold that neither the host nor the disk took is retried, on both, until one succeeds. Until then the worker
  // neither takes another item nor exits; a graceful stop waits here too (only a forced kill can lose it).
  async function settleUnrecordedHolds() {
    while (unrecordedHolds.length > 0) {
      for (const entry of [...unrecordedHolds]) {
        let settled = false;
        try { settled = await applyHold(entry.kind, entry.hold); } catch { settled = false; }
        if (!settled) {
          try { await writeAttemptMarker(path.join(holdDirectories[entry.kind], `${entry.hold.claim}.json`), entry.hold); settled = true; }
          catch { /* retry after the next poll */ }
        }
        if (settled) unrecordedHolds.splice(unrecordedHolds.indexOf(entry), 1);
      }
      if (unrecordedHolds.length > 0) await wait(options.pollMs);
    }
  }
  // Before the worker exits, a stop signal included, a release whose claim is neither saved nor released is retried
  // until one of them succeeds, so its reservation isn't stranded.
  async function drainUnsavedReleases() {
    const unsaved = () => [...pendingReleases.values()].some((entry) => !entry.saved);
    while (unsaved()) {
      for (const [workId, entry] of pendingReleases) {
        if (entry.saved) continue;
        try {
          await host("attempt-release", ["--work-id", workId, "--attempt-identity", entry.identity, "--claim", entry.claim]);
          await releaseSettled(workId, entry.claim);
        } catch { await persistRelease(workId, entry); }
      }
      if (unsaved()) await wait(options.pollMs);
    }
  }
  async function releaseSettled(workId, claim) {
    pendingReleases.delete(workId);
    await fs.rm(path.join(pendingReleasesDir, `${claim}.json`), { force: true });
  }

  async function one(record) {
    const started = Date.now();
    let stageDir = null, runDir = null, outcome = "error";
    let observed = null;
    const claim = randomUUID();
    let claimed = false, reachedModel = false, markFailed = false, isolationRefused = false, persisted = false, persistenceChecked = false;
    let childGroup = null, groupAlive = false;
    let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
    try {
      // Validate the profile before creating a stage or invoking the provider.
      claudePrintArgs({ record, mcpConfig: "/tmp/placeholder", sessionId: randomUUID() });
      if (!/^[0-9a-f]{48}$/u.test(record.attempt_identity ?? "")) fail("JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED");
      const reservation = await host("attempt-reserve", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim,
        "--timeout-ms", String(options.timeoutMs)]);
      if (reservation[0]?.claimed !== true) {
        const held = (await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0];
        outcome = held?.status === "reserved" ? "reserved" : held?.status === "isolation_refused" ? "isolation_refused" : "already_attempted";
        return outcome;
      }
      claimed = true;
      const reservedAt = Date.now();
      const packetCheck = (await host("packet-check", ["--work-id", record.work_id]))[0];
      if (packetCheck?.allowed !== true) {
        outcome = packetCheck?.reason === "too_large" ? "rejected:PACKET_TOO_LARGE" : "rejected:PACKET_UNAVAILABLE";
        return outcome;
      }
      if (!Number.isSafeInteger(packetCheck.packet_length) || packetCheck.packet_length < 1
        || packetCheck.packet_length > MAX_HARDEST_PACKET_CHARS) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      const created = await host("stage-create");
      stageDir = created[0]?.stage_dir;
      if (typeof stageDir !== "string" || !path.isAbsolute(stageDir)) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      runDir = await fs.mkdtemp(path.join(parent, "run-"));
      await fs.chmod(runDir, 0o700);
      const mcpConfig = path.join(runDir, "mcp.json");
      await fs.writeFile(mcpConfig, JSON.stringify(claudeMcpConfiguration(options, stageDir, environment, record.work_id)), { flag: "wx", mode: 0o600 });
      // A fresh session, reserved on the host before Claude starts, so it can back no other item; every event of
      // the run must report it. Claude Code honours --session-id with --no-session-persistence.
      const sessionId = randomUUID();
      const sessionReservation = (await host("session-reserve", ["--work-id", record.work_id,
        "--session-context", `claude-session:${sessionId}`]))[0];
      if (sessionReservation?.reserved !== true) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      const reader = claudeResultReader(record, packetCheck.packet_length, sessionId);
      observed = reader.state;
      // A stop requested after the last host call must not start Claude: its group could not be signalled.
      if (stopping) { outcome = "stopped"; return outcome; }
      // Nor may a run whose preflight was slow enough that a sibling could soon reclaim its reservation.
      if (Date.now() - reservedAt >= Math.min(PREFLIGHT_LIMIT_MS, options.timeoutMs)) { outcome = "preflight_expired"; return outcome; }
      let result;
      try { result = await runProcess(options.claudeBin, claudePrintArgs({ record, mcpConfig, sessionId }), {
        cwd: runDir, env: { ...processEnv, XDG_CACHE_HOME: path.join(runDir, "cache") },
        // Claude starts only once its process record is on disk, so a run without one never started Claude.
        maxLineBytes: MAX_CLAUDE_LINE_BYTES, maxStreamBytes: 4 * MAX_CLAUDE_LINE_BYTES, killOnClose: true, gate: true,
        onSpawn: async pid => {
          // Retain the group first, so a failure below still leads to the confirmed-group-gone path.
          childGroup = pid;
          const owner = await linuxProcessIdentity(process.pid), child = await linuxProcessIdentity(pid);
          if (!owner || !child || child.group !== pid) fail("JOURNAL_CLAUDE_PROCESS_RECORD_INVALID");
          await writeAttemptMarker(path.join(runDir, "process-group.json"), { owner, child }, true);
        },
        timeoutMs: options.timeoutMs, onLine: async (line, kill) => {
          reader.accept(line);
          if (reader.state.bad === "ISOLATION") { isolationRefused = true; kill(); }
          // The group is killed at once; model reach is still recorded below before the run stops being read.
          if (reader.state.abort) kill();
          if (!reachedModel && reader.state.reachedModel) {
            reachedModel = true;
            // Await the durable mark while stdout is paused, before accepting
            // further events or allowing the child result to be admitted.
            try { await host("attempt-mark", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim]); }
            catch (error) { markFailed = true; throw error; }
          }
          if (isolationRefused || reader.state.abort) return false;
        }, activeGroups
      }); } finally {
        // This finally runs before admission/promotion, even when the child failed. The whole process group
        // must be gone first, so a lingering helper can't write after the scan; if it isn't, refuse admission.
        let groupGone = false;
        try { groupGone = await waitForProcessGroupGone(childGroup); } catch { groupGone = false; }
        // Leave the evidence for startup recovery and stop the worker once this item is refused.
        if (!groupGone) { persisted = true; groupAlive = true; cleanupFailed = true; preserveParent = true; }
        else {
          // A cleanup that can't inspect or remove an artifact may leave plaintext behind: refuse and stop.
          try { persisted = await cleanClaudePersistence(processEnv.HOME, runDir); persistenceChecked = true; }
          catch { persisted = true; cleanupFailed = true; }
          // The run dir holds Claude's redirected cache and session files; remove it before admission. If it
          // can't be removed, refuse the result and stop the worker rather than leave it behind and carry on.
          try { await fs.rm(runDir, { recursive: true, force: true }); }
          catch { persisted = true; cleanupFailed = true; }
        }
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
      // Claude ran but never emitted its mandatory init (a crash before it, an empty stream, or a changed stream
      // format): the setup is unverified, so this goes the isolation-refusal way and nothing more runs on it.
      // (A stop, a timeout, or our own failure to record the process before release are not this.)
      if (!isolationRefused && !reader.state.initialized && !stopping && !result.timedOut
        && result.problem !== "PROCESS_RECORD_FAILED") isolationRefused = true;
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
            await queueRelease(record.work_id, record.attempt_identity, claim);
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
        else if (!reader.state.initialized) outcome = "rejected:ISOLATION"; // a timeout or our own record failure
        else if (reader.state.abort) outcome = `rejected:${reader.state.bad}`; // the worker ended the run itself
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
            outcome = promoted[0]?.answered ? "answered" : promoted[0]?.already ? "already_answered"
              : promoted[0]?.session_reused ? "rejected:SESSION_REUSED" : "error";
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
        catch {
          await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "attempt_refuse_failed" });
          if (!reachedModel) await keepHold("refuse", { work_id: record.work_id, attempt_identity: record.attempt_identity, claim });
        }
      } else if (claimed && !reachedModel && !observed?.limitSeen && outcome !== "limited") {
        try {
          await host("attempt-release", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity, "--claim", claim]); claimed = false;
          await releaseSettled(record.work_id, claim);
        }
        catch {
          // Retry it from the main loop, as after a provider outage, rather than leave a fresh reservation
          // that later workers would treat as a live sibling's.
          await queueRelease(record.work_id, record.attempt_identity, claim);
          await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "attempt_release_failed" });
        }
      }
      // The model was reached but the host may not have recorded it (the mark failed or was cut off by a stop): unless
      // the host confirms model reach, keep that, so the attempt can't be reclaimed as unspent.
      if (claimed && markFailed) {
        let recorded = false;
        try {
          recorded = (await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0]
            ?.model_reached === true;
        } catch { recorded = false; }
        // Confirmed on the host (only the reply was lost): the mark stands, and a failed close below is kept.
        if (recorded) markFailed = false;
        else await keepHold("spend", { work_id: record.work_id, attempt_identity: record.attempt_identity, claim });
      }
      if (runDir && !groupAlive) {
        if (!persistenceChecked) {
          try { if (await cleanClaudePersistence(processEnv.HOME, runDir)) outcome = "rejected:LOCAL_PERSISTENCE"; }
          catch { outcome = "rejected:LOCAL_PERSISTENCE"; cleanupFailed = true; }
        }
        try { await fs.rm(runDir, { recursive: true, force: true }); }
        catch { cleanupFailed = true; await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "run_remove_failed" }); }
      }
      if (stageDir) {
        try { await host("stage-remove", ["--stage-dir", stageDir]); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "stage_remove_failed" }); }
      }
      // Any isolation violation stops the worker. Whether the model was reached decides only the item's fate: a
      // refusal before the model keeps a clearable hold, one after it closes the item as spent.
      const isolation = outcome === "isolation_refused";
      if (isolation) {
        setupRefused = true;
        // Kept across restarts: no later start may run another item under this setup until an operator clears it.
        await keepHold("setup", { work_id: record.work_id, attempt_identity: record.attempt_identity, claim });
      }
      if (!(isolation && !reachedModel) && (["already_attempted", "isolation_refused", "rejected:PACKET_TOO_LARGE"].includes(outcome)
        || (reachedModel && !["answered", "already_answered"].includes(outcome)))) {
        try { await host("close-unanswered", ["--work-id", record.work_id]); }
        catch {
          await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "item_close_failed" });
          // A spent attempt's close is retried (with its mark) before the worker takes another item.
          if (claimed && reachedModel && !markFailed) {
            await keepHold("spend", { work_id: record.work_id, attempt_identity: record.attempt_identity, claim });
          }
        }
      }
      await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
        model: record.model, effort: record.effort, outcome, duration_ms: Date.now() - started,
        mcp_servers: observed?.servers?.filter(({ name, status }) => name === "journal" && status === "connected") ?? [],
        server_count: observed?.servers?.length ?? 0,
        tools: observed?.tools?.filter((name) => TOOLS.includes(name)) ?? [], tool_count: observed?.tools?.length ?? 0,
        skill_count: observed?.skillCount ?? 0, slash_command_count: observed?.slashCount ?? 0,
        plugin_count: observed?.pluginCount ?? 0, agent_count: observed?.agentCount ?? 0,
        hook_event_count: observed?.hookCount ?? 0,
        claude_code_version: observed?.claudeCodeVersion ?? null, model_reached: reachedModel, process_group_alive: groupAlive,
        session_mismatch: observed?.sessionMismatch === true,
        ...usage, cost_kind: "subscription_cost_equivalent_not_charged" });
    }
    return outcome;
  }

  try {
    const unresolved = await sweepClaudeProcessGroups(workDir, processEnv.HOME);
    await removeStaleRuns(workDir, "inner-signal-claude-", { keep: unresolved });
    if (unresolved.size > 0) { cleanupFailed = true; preserveParent = false; return CLAUDE_CLEANUP_FAILED_EXIT_CODE; }
    await sweepClaudePersistence(processEnv.HOME, workDir);
    const refusals = await readPendingEntries(pendingRefusalsDir, validPendingHold);
    if (refusals.length > 0) {
      for (const { file, value } of refusals) {
        try { if (await applyHold("refuse", value)) await fs.rm(file, { force: true }); }
        catch { /* The host is unavailable: keep it for the next start. */ }
      }
      heldOpen = true;
      await log({ at: new Date().toISOString(), outcome: "isolation_refusal_pending", count: refusals.length });
      return CLAUDE_SETUP_REFUSED_EXIT_CODE;
    }
    const setupRefusals = await readPendingEntries(setupRefusalsDir, validPendingHold);
    if (setupRefusals.length > 0) {
      // Record any kept spend on the host first (best effort); then stop until an operator clears the refusal.
      for (const { file, value } of await readPendingEntries(pendingSpendsDir, validPendingHold)) {
        try { if (await applyHold("spend", value)) await fs.rm(file, { force: true }); } catch { /* kept for later */ }
      }
      heldOpen = true;
      await log({ at: new Date().toISOString(), outcome: "setup_refused", count: setupRefusals.length });
      return CLAUDE_SETUP_REFUSED_EXIT_CODE;
    }
    for (const { file, value } of await readPendingEntries(pendingReleasesDir, validPendingRelease)) {
      if (value.expires_at <= Date.now()) await fs.rm(file, { force: true });
      else pendingReleases.set(value.work_id, { claim: value.claim, identity: value.attempt_identity, expiresAt: value.expires_at, saved: true });
    }
    await host("stage-sweep");
    const initial = options.once ? new Set((await host("dispatch", ["--json"])).map((record) => record.work_id)) : null;
    for (;;) {
      if (stopping) break;
      // Failed releases are retried first, including once more before the worker stops at its item limit. One
      // past the time its reservation becomes reclaimable is dropped.
      for (const [workId, entry] of pendingReleases) {
        try {
          if (entry.expiresAt <= Date.now()) { await releaseSettled(workId, entry.claim); continue; }
          if (!entry.saved) await persistRelease(workId, entry);
          await host("attempt-release", ["--work-id", workId, "--attempt-identity", entry.identity, "--claim", entry.claim]);
          await releaseSettled(workId, entry.claim);
        } catch { /* Keep the reservation; retry on the next loop. */ }
      }
      // A claim that is neither released nor saved would be lost on exit: wait and retry rather than exit or work.
      if (!stopping && [...pendingReleases.values()].some((entry) => !entry.saved)) { await wait(options.pollMs); continue; }
      // A kept "spend" must reach the host before any new item (fail closed); retried each poll.
      holdsPending = false;
      for (const { file, value } of await readPendingEntries(pendingSpendsDir, validPendingHold)) {
        let applied = false;
        try { applied = await applyHold("spend", value); } catch { applied = false; }
        if (applied) await fs.rm(file, { force: true }); else holdsPending = true;
      }
      if (holdsPending && !stopping && completed < options.maxItems) {
        if (options.once) break;
        await wait(options.pollMs);
        continue;
      }
      if (stopping || completed >= options.maxItems) break;
      if (signInNeeded) break;
      if (Date.now() < limitedUntil) {
        if (options.once) break;
        await wait(Math.min(options.pollMs, limitedUntil - Date.now()));
        continue;
      }
      const records = await host("dispatch", ["--json"]);
      // A close retry ends once its item is gone or answered (closed by this or another worker).
      for (const workId of closeRetries) {
        if (!records.some((item) => item.work_id === workId && !item.answered)) closeRetries.delete(workId);
      }
      let record = records.find((item) => (!initial || initial.has(item.work_id)) && !item.answered
        && item.tier === "hardest" && item.model === MODEL && item.effort === "max"
        && /^[0-9a-f]{48}$/u.test(item.attempt_identity ?? "")
        && Date.parse(item.expires_at) > Date.now()
        && !pendingReleases.has(item.work_id) && !skipped.has(item.work_id)
        && (attempts.get(item.work_id) ?? 0) < 3 && (limits.get(item.work_id) ?? 0) < MAX_LIMIT_RETRIES);
      const marker = record ? (await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0] : null;
      if (record && marker?.attempted) {
        const spent = marker.packet_fetched === true || marker.model_reached === true;
        const staleSpentReservation = marker.status === "reserved" && marker.packet_fetched === true
          && (marker.age_seconds ?? 0) * 1000 >= (marker.timeout_ms ?? 1_800_000) + 600_000;
        if (marker.status === "reserved" && !staleSpentReservation) {
          // An unspent reservation (no packet served, no model reached) older than twice its run timeout
          // plus ten minutes belongs to a dead worker: reclaim it, so successors of the same identity can run.
          const staleUnspent = !spent
            && (marker.age_seconds ?? 0) * 1000 >= 2 * (marker.timeout_ms ?? 1_800_000) + 600_000;
          let reclaimed = false;
          if (staleUnspent) {
            try {
              reclaimed = (await host("attempt-clear", ["--work-id", record.work_id,
                "--attempt-identity", record.attempt_identity]))[0]?.cleared === true;
            } catch { reclaimed = false; }
          }
          // Otherwise a live sibling owns it; it may still release the reservation after a pre-model outage.
          if (!reclaimed) skipped.add(record.work_id);
          const outcome = reclaimed ? "stale_reservation_reclaimed" : staleUnspent ? "stale_reservation_reclaim_failed" : "reserved";
          if (outcome !== "reserved" || !reservedLogged.has(record.work_id)) {
            if (outcome === "reserved") reservedLogged.add(record.work_id);
            await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
              model: record.model, effort: record.effort, outcome, duration_ms: 0 });
          }
          continue;
        }
        // An attempted marker younger than its run timeout plus ten minutes may belong to a sibling that is
        // still fetching or answering: leave the item open until the next poll and close it only once stale.
        if (marker.status === "attempted"
          && (marker.age_seconds ?? 0) * 1000 < (marker.timeout_ms ?? 1_800_000) + 600_000) {
          skipped.add(record.work_id);
          if (!reservedLogged.has(record.work_id)) {
            reservedLogged.add(record.work_id);
            await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
              model: record.model, effort: record.effort, outcome: "attempt_in_progress", duration_ms: 0 });
          }
          continue;
        }
        attempts.set(record.work_id, 3);
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
          try { await host("close-unanswered", ["--work-id", record.work_id]); closeRetries.delete(record.work_id); }
          catch {
            // Its marker and open item stay on the host, so the close is retried after the next poll (and by any
            // later start); a --once worker waits for it.
            attempts.delete(record.work_id);
            skipped.add(record.work_id);
            closeRetries.add(record.work_id);
            await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "item_close_failed" });
          }
        }
        await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
          model: record.model, effort: record.effort,
          outcome: marker.status === "reserved" ? (staleSpent ? "stale_reservation_closed" : "reserved")
            : marker.status === "isolation_refused" ? "isolation_refused" : "already_attempted", duration_ms: 0 });
        continue;
      }
      if (!record) {
        if (options.once && !pendingReleases.size && !closeRetries.size) break;
        await wait(options.pollMs);
        skipped.clear();
        continue;
      }
      if (stopping) break;
      const outcome = await one(record);
      await settleUnrecordedHolds();
      if (setupRefused || cleanupFailed) break;
      if (["limited", "provider_unavailable", "sign_in_needed"].includes(outcome)) limits.set(record.work_id, (limits.get(record.work_id) ?? 0) + 1);
      else if (outcome === "reserved") skipped.add(record.work_id);
      else if (["already_attempted", "isolation_refused", "rejected:PACKET_TOO_LARGE", "rejected:PACKET_UNAVAILABLE"].includes(outcome)) {
        attempts.set(record.work_id, 3);
      }
      else if (outcome !== "stopped") {
        attempts.set(record.work_id, (attempts.get(record.work_id) ?? 0) + 1);
        // A reservation still waiting for its release is this worker's own, not a spent attempt.
        if (!pendingReleases.has(record.work_id)
          && (await host("attempt-status", ["--work-id", record.work_id, "--attempt-identity", record.attempt_identity]))[0]?.attempted) {
          attempts.set(record.work_id, 3); completed += 1;
        }
      }
    }
    await settleUnrecordedHolds();
    await drainUnsavedReleases();
    // 77 is the content-free sign-in-required exit status for the operator.
    // 74 is the content-free status for a run directory the worker could not remove.
    return stopSignal === "SIGINT" ? 130 : stopSignal === "SIGTERM" ? 143 : cleanupFailed ? CLAUDE_CLEANUP_FAILED_EXIT_CODE
      : signInNeeded ? 77
      : setupRefused || heldOpen ? CLAUDE_SETUP_REFUSED_EXIT_CODE
      : options.once && (Date.now() < limitedUntil || holdsPending) ? CLAUDE_PAUSED_EXIT_CODE : 0;
  } catch (error) {
    if (error?.code !== "JOURNAL_CLAUDE_STOPPED") throw error;
    await settleUnrecordedHolds();
    await drainUnsavedReleases();
    return stopSignal === "SIGINT" ? 130 : 143;
  } finally {
    stop();
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    // A surviving process group keeps its run directory (with process-group.json) for startup recovery.
    try { if (!preserveParent) await fs.rm(parent, { recursive: true, force: true }); }
    finally { await unlockWorkerDirectory(); await logHandle?.close(); }
  }
}
