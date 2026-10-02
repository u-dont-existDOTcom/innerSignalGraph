import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockWorkerDirectory, parseCodexResetTime, privateDirectory, removeStaleRuns, runProcess } from "./codex-worker.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL = "claude-opus-5-5";
const SESSION = /^[0-9A-Za-z-]{8,64}$/u;
const HOST = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/u;
const BIN = /^[A-Za-z0-9_./-]+$/u;
const MAX_LIMIT_RETRIES = 12;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

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

export function claudeResultReader(record) {
  const state = { bad: null, initialized: false, resultSeen: false, session: null, reportedSession: null, model: null,
    packetFetched: false, packetBeforeFirstSubmit: false, submitSeen: false, hookCount: 0,
    servers: [], tools: [], skillCount: 0, slashCount: 0, pluginCount: 0, agentCount: 0,
    usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_cost_usd: 0 },
    limitReset: null, limitSeen: false };
  let first = true;
  function accept(line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { state.bad ??= first ? "ISOLATION" : "EVENT_JSON_INVALID"; first = false; return; }
    if (!event || typeof event !== "object") { state.bad ??= first ? "ISOLATION" : "EVENT_INVALID"; first = false; return; }
    if (first) {
      first = false;
      if (event.type !== "system" || event.subtype !== "init") {
        state.bad = "ISOLATION";
        if (event.type !== "result") return;
      } else {
        state.initialized = true;
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
    }
    if (event.type === "system" && event.subtype === "init") { state.bad ??= "ISOLATION"; return; }
    if ((typeof event.type === "string" && event.type.startsWith("hook"))
      || (typeof event.subtype === "string" && event.subtype.startsWith("hook"))) {
      state.hookCount += 1; state.bad = "ISOLATION"; return;
    }
    if (state.resultSeen) { state.bad ??= "RESULT_NOT_LAST"; return; }
    const uses = event.type === "tool_use" ? [event] : event.type === "assistant"
      ? (Array.isArray(event.message?.content) ? event.message.content.filter((part) => part?.type === "tool_use") : []) : [];
    for (const use of uses) {
      const name = use.name;
      const workId = use.input?.work_id;
      if (!TOOLS.includes(name)) { state.bad ??= "ISOLATION"; continue; }
      if (workId !== record.work_id) { state.bad ??= "WORK_ID_MISMATCH"; continue; }
      if (name === TOOLS[0] && workId === record.work_id) state.packetFetched = true;
      if (name === TOOLS[1] && workId === record.work_id && !state.submitSeen) {
        state.submitSeen = true; state.packetBeforeFirstSubmit = state.packetFetched;
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
    if (event.is_error === true && /\b429\b|usage[_ -]?limit|rate[_ -]?limit/iu.test(limitMessage)) {
      state.limitSeen = true;
      state.limitReset = parseCodexResetTime(limitMessage, Date.now());
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

export async function runJournalClaudeWorker(argv, { environment = process.env, stderr = process.stderr } = {}) {
  const options = parseJournalClaudeWorkerArgs(argv);
  const workDir = await privateDirectory(options.workDir, "JOURNAL_CLAUDE_WORK_DIR_INSECURE");
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
  let stopping = false, stopSignal = null, wake = null, limitedUntil = 0, completed = 0;
  const attempts = new Map(), limits = new Map(), seenSessions = new Set();
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
    if (result.code !== 0 || result.problem || result.timedOut) fail("JOURNAL_CLAUDE_HOST_UNAVAILABLE");
    try { return lines.map((line) => JSON.parse(line)); } catch { fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID"); }
  }

  async function one(record) {
    const started = Date.now();
    let stageDir = null, runDir = null, outcome = "error";
    let observed = null;
    const claim = randomUUID();
    let claimed = false, initialized = false;
    let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
    try {
      // Validate the profile before creating a stage or invoking the provider.
      claudePrintArgs({ record, mcpConfig: "/tmp/placeholder" });
      const reservation = await host("attempt-reserve", ["--work-id", record.work_id, "--claim", claim]);
      if (reservation[0]?.claimed !== true) { outcome = "already_attempted"; return outcome; }
      claimed = true;
      const created = await host("stage-create");
      stageDir = created[0]?.stage_dir;
      if (typeof stageDir !== "string" || !path.isAbsolute(stageDir)) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      runDir = await fs.mkdtemp(path.join(parent, "run-"));
      await fs.chmod(runDir, 0o700);
      const mcpConfig = path.join(runDir, "mcp.json");
      await fs.writeFile(mcpConfig, JSON.stringify(claudeMcpConfiguration(options, stageDir, environment)), { flag: "wx", mode: 0o600 });
      const reader = claudeResultReader(record);
      observed = reader.state;
      let marking = Promise.resolve();
      const result = await runProcess(options.claudeBin, claudePrintArgs({ record, mcpConfig }), {
        cwd: runDir, env: processEnv, timeoutMs: options.timeoutMs, onLine: (line) => {
          const before = reader.state.initialized;
          reader.accept(line);
          if (!before && reader.state.initialized) {
            initialized = true;
            marking = host("attempt-mark", ["--work-id", record.work_id, "--claim", claim]).then(() => null, (error) => error);
          }
        }, activeGroups
      });
      if (reader.state.reportedSession) {
        const reused = seenSessions.has(reader.state.reportedSession);
        seenSessions.add(reader.state.reportedSession);
        if (reused) reader.state.bad ??= "SESSION_REUSED";
      }
      const markError = await marking;
      if (markError) throw markError;
      usage = reader.state.usage;
      if (result.code !== 0 && !reader.state.resultSeen) {
        let error;
        try { error = JSON.parse(result.stderrLast); } catch { /* Unstructured stderr is never limit evidence. */ }
        const fields = [typeof error === "string" ? error : null, error?.code, error?.type, error?.message]
          .filter((value) => typeof value === "string").join(" ");
        if (/\b429\b|usage[_ -]?limit|rate[_ -]?limit/iu.test(fields)) {
          reader.state.limitSeen = true;
          reader.state.limitReset = parseCodexResetTime(fields, Date.now());
        }
      }
      if (stopping) outcome = "stopped";
      else if (result.timedOut) outcome = "timeout";
      else if (reader.state.initialized && (reader.state.bad === "ISOLATION" || reader.state.hookCount)) outcome = "rejected:ISOLATION";
      else if (reader.state.limitSeen) {
        outcome = "limited";
        limitedUntil = Math.max(limitedUntil, reader.state.limitReset ?? Date.now() + options.limitBackoffMs);
        if (claimed) {
          await host("attempt-release", ["--work-id", record.work_id, "--claim", claim]);
          claimed = false;
        }
      } else if (result.problem) outcome = `rejected:${result.problem}`;
      else if (reader.state.bad === "ISOLATION" || !reader.state.initialized || reader.state.hookCount) outcome = "rejected:ISOLATION";
      else if (result.code !== 0) outcome = "rejected:EXIT_NONZERO";
      else if (reader.state.bad) outcome = `rejected:${reader.state.bad}`;
      else if (!reader.state.session) outcome = "rejected:RESULT_MISSING";
      else if (!reader.state.packetBeforeFirstSubmit) outcome = "rejected:PACKET_NOT_FETCHED";
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
    } catch { outcome = stopping ? "stopped" : "error"; }
    finally {
      if (claimed && !initialized) {
        try { await host("attempt-release", ["--work-id", record.work_id, "--claim", claim]); claimed = false; }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "attempt_release_failed" }); }
      }
      if (runDir) {
        try { await fs.rm(runDir, { recursive: true, force: true }); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "run_remove_failed" }); }
      }
      if (stageDir) {
        try { await host("stage-remove", ["--stage-dir", stageDir]); }
        catch { await log({ at: new Date().toISOString(), work_id: record.work_id, outcome: "stage_remove_failed" }); }
      }
      await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
        model: record.model, effort: record.effort, outcome, duration_ms: Date.now() - started,
        mcp_servers: observed?.servers?.filter(({ name, status }) => name === "journal" && status === "connected") ?? [],
        server_count: observed?.servers?.length ?? 0,
        tools: observed?.tools?.filter((name) => TOOLS.includes(name)) ?? [], tool_count: observed?.tools?.length ?? 0,
        skill_count: observed?.skillCount ?? 0, slash_command_count: observed?.slashCount ?? 0,
        plugin_count: observed?.pluginCount ?? 0, agent_count: observed?.agentCount ?? 0,
        hook_event_count: observed?.hookCount ?? 0,
        ...usage, cost_kind: "subscription_cost_equivalent_not_charged" });
    }
    return outcome;
  }

  try {
    await removeStaleRuns(workDir, "inner-signal-claude-");
    await host("stage-sweep");
    const initial = options.once ? new Set((await host("dispatch", ["--json"])).map((record) => record.work_id)) : null;
    for (;;) {
      if (stopping || completed >= options.maxItems) break;
      if (Date.now() < limitedUntil) {
        await wait(Math.min(options.pollMs, limitedUntil - Date.now()));
        continue;
      }
      const records = await host("dispatch", ["--json"]);
      let record = records.find((item) => (!initial || initial.has(item.work_id)) && !item.answered
        && item.tier === "hardest" && item.model === MODEL && item.effort === "max"
        && Date.parse(item.expires_at) > Date.now()
        && (attempts.get(item.work_id) ?? 0) < 3 && (limits.get(item.work_id) ?? 0) < MAX_LIMIT_RETRIES);
      if (record && (await host("attempt-status", ["--work-id", record.work_id]))[0]?.attempted) {
        attempts.set(record.work_id, 3);
        await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
          model: record.model, effort: record.effort, outcome: "already_attempted", duration_ms: 0 });
        continue;
      }
      if (!record) {
        if (options.once) break;
        await wait(options.pollMs);
        continue;
      }
      const outcome = await one(record);
      if (outcome === "limited") limits.set(record.work_id, (limits.get(record.work_id) ?? 0) + 1);
      else if (outcome !== "stopped") {
        attempts.set(record.work_id, (attempts.get(record.work_id) ?? 0) + 1);
        if ((await host("attempt-status", ["--work-id", record.work_id]))[0]?.attempted) {
          attempts.set(record.work_id, 3); completed += 1;
        }
      }
    }
    return stopSignal === "SIGINT" ? 130 : stopSignal === "SIGTERM" ? 143 : 0;
  } finally {
    stop();
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    try { await fs.rm(parent, { recursive: true, force: true }); }
    finally { await unlockWorkerDirectory(); await logHandle?.close(); }
  }
}
