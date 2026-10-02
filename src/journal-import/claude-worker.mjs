import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCodexResetTime, privateDirectory, runProcess } from "./codex-worker.mjs";

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
const sshOptions = ["-o", "BatchMode=yes", "-o", "ClearAllForwardings=yes", "-T"];

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
  return ["-p", instruction, "--model", "opus", "--effort", "max", "--output-format", "json",
    "--mcp-config", mcpConfig, "--strict-mcp-config", "--tools", "",
    "--allowedTools", "mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result",
    "--permission-mode", "dontAsk", "--no-session-persistence"];
}

export function claudeResultReader(record) {
  const state = { bad: null, session: null, model: null, usage: { input_tokens: 0, cached_input_tokens: 0,
    output_tokens: 0, total_cost_usd: 0 }, limitReset: null, limitSeen: false };
  let seen = false;
  function accept(line) {
    if (!line.trim()) return;
    if (seen) { state.bad = "RESULT_COUNT"; return; }
    seen = true;
    let result;
    try { result = JSON.parse(line); } catch { state.bad = "RESULT_JSON_INVALID"; return; }
    if (!result || typeof result !== "object") { state.bad = "RESULT_JSON_INVALID"; return; }
    if (typeof result.result === "string" && /\b429\b|usage[ -]?limit|rate[ -]?limit/iu.test(result.result)) {
      state.limitSeen = true;
      state.limitReset = parseCodexResetTime(result.result, Date.now());
    }
    if (result.is_error !== false || result.subtype !== "success") { state.bad = "RESULT_UNSUCCESSFUL"; return; }
    if (!SESSION.test(result.session_id ?? "")) { state.bad = "SESSION_INVALID"; return; }
    const usage = result.modelUsage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage) || !Object.hasOwn(usage, record.model)) {
      state.bad = "MODEL_USAGE_INVALID"; return;
    }
    for (const [model, item] of Object.entries(usage)) {
      const outputTokens = item?.outputTokens ?? item?.output_tokens ?? 0;
      if (!item || typeof item !== "object" || Array.isArray(item)
        || !Number.isSafeInteger(outputTokens) || outputTokens < 0
        || (model !== record.model && outputTokens > 0)) {
        state.bad = "MODEL_USAGE_INVALID"; return;
      }
    }
    const selected = usage[record.model];
    for (const value of [selected.inputTokens ?? selected.input_tokens ?? 0,
      selected.cacheReadInputTokens ?? selected.cache_read_input_tokens ?? 0,
      selected.outputTokens ?? selected.output_tokens ?? 0]) {
      if (!Number.isSafeInteger(value) || value < 0) { state.bad = "MODEL_USAGE_INVALID"; return; }
    }
    state.session = result.session_id;
    state.model = record.model;
    state.usage = { input_tokens: selected.inputTokens ?? selected.input_tokens ?? 0,
      cached_input_tokens: selected.cacheReadInputTokens ?? selected.cache_read_input_tokens ?? 0,
      output_tokens: selected.outputTokens ?? selected.output_tokens ?? 0,
      total_cost_usd: Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0
        ? result.total_cost_usd : 0 };
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
  const logHandle = options.log ? await fs.open(options.log, "a", 0o600) : null;
  const log = async (record) => {
    const bytes = `${JSON.stringify(record)}\n`;
    if (logHandle) await logHandle.writeFile(bytes); else stderr.write(bytes);
  };
  const processEnv = { PATH: environment.PATH ?? "", HOME: environment.HOME ?? "", LANG: environment.LANG ?? "C" };
  const activeGroups = new Set();
  let stopping = false, limitedUntil = 0, completed = 0;
  const attempts = new Map(), limits = new Map();
  const stop = () => { stopping = true; for (const kill of activeGroups) kill(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

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
    let stageDir = null, outcome = "error";
    let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_cost_usd: 0 };
    try {
      // Validate the profile before creating a stage or invoking the provider.
      claudePrintArgs({ record, mcpConfig: "/tmp/placeholder" });
      const created = await host("stage-create");
      stageDir = created[0]?.stage_dir;
      if (typeof stageDir !== "string" || !path.isAbsolute(stageDir)) fail("JOURNAL_CLAUDE_HOST_RESPONSE_INVALID");
      const runDir = await fs.mkdtemp(path.join(parent, "run-"));
      await fs.chmod(runDir, 0o700);
      const mcpConfig = path.join(runDir, "mcp.json");
      await fs.writeFile(mcpConfig, JSON.stringify(claudeMcpConfiguration(options, stageDir, environment)), { flag: "wx", mode: 0o600 });
      const reader = claudeResultReader(record);
      const result = await runProcess(options.claudeBin, claudePrintArgs({ record, mcpConfig }), {
        cwd: runDir, env: processEnv, timeoutMs: options.timeoutMs, onLine: reader.accept, activeGroups
      });
      usage = reader.state.usage;
      if (result.code !== 0 && !reader.state.limitSeen && /\b429\b|usage[ -]?limit|rate[ -]?limit/iu.test(result.stderrLast)) {
        reader.state.limitSeen = true;
        reader.state.limitReset = parseCodexResetTime(result.stderrLast, Date.now());
      }
      if (stopping) outcome = "stopped";
      else if (result.timedOut) outcome = "timeout";
      else if (reader.state.limitSeen && (result.code !== 0 || reader.state.bad)) {
        outcome = "limited";
        limitedUntil = Math.max(limitedUntil, reader.state.limitReset ?? Date.now() + options.limitBackoffMs);
      } else if (result.problem) outcome = `rejected:${result.problem}`;
      else if (result.code !== 0) outcome = "rejected:EXIT_NONZERO";
      else if (reader.state.bad) outcome = `rejected:${reader.state.bad}`;
      else if (!reader.state.session) outcome = "rejected:RESULT_MISSING";
      else {
        // The host checks both the staged encrypted answer and its earlier packet-fetch marker.
        const status = await host("stage-check", ["--work-id", record.work_id, "--stage-dir", stageDir]);
        if (status[0]?.staged !== true || status[0]?.packet_fetched !== true) outcome = "rejected:STAGE_MISSING";
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
      if (stageDir) await host("stage-remove", ["--stage-dir", stageDir]).catch(() => {});
      await log({ at: new Date().toISOString(), work_id: record.work_id, role: record.role,
        model: record.model, effort: record.effort, outcome, duration_ms: Date.now() - started,
        ...usage, cost_kind: "subscription_cost_equivalent_not_charged" });
    }
    return outcome;
  }

  try {
    const initial = options.once ? new Set((await host("dispatch", ["--json"])).map((record) => record.work_id)) : null;
    for (;;) {
      if (stopping || completed >= options.maxItems) break;
      if (Date.now() < limitedUntil) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollMs, limitedUntil - Date.now())));
        continue;
      }
      const records = await host("dispatch", ["--json"]);
      const record = records.find((item) => (!initial || initial.has(item.work_id)) && !item.answered
        && item.tier === "hardest" && item.model === MODEL && item.effort === "max"
        && Date.parse(item.expires_at) > Date.now()
        && (attempts.get(item.work_id) ?? 0) < 3 && (limits.get(item.work_id) ?? 0) < MAX_LIMIT_RETRIES);
      if (!record) {
        if (options.once) break;
        await new Promise((resolve) => setTimeout(resolve, options.pollMs));
        continue;
      }
      const outcome = await one(record);
      if (outcome === "limited") limits.set(record.work_id, (limits.get(record.work_id) ?? 0) + 1);
      else if (outcome !== "stopped") { attempts.set(record.work_id, (attempts.get(record.work_id) ?? 0) + 1); completed += 1; }
    }
    return stopping ? 143 : 0;
  } finally {
    stop();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await fs.rm(parent, { recursive: true, force: true });
    await logHandle?.close();
  }
}
