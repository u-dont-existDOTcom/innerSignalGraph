import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";
import { createExchangeJournalInferencePort } from "../src/journal-import/exchange-port.mjs";
import { claudeMcpConfiguration, claudePrintArgs, claudeResultReader, parseJournalClaudeWorkerArgs,
  runJournalClaudeWorker } from "../src/journal-import/claude-worker.mjs";
import { journalAttemptIdentity, runJournalWork } from "../src/cli/journal-work.mjs";
import { journalWorkFileKey } from "../src/journal-import/work-exchange.mjs";
import { runJournalWorkMcp } from "../src/cli/journal-work-mcp.mjs";
import { JOURNAL_WORK_TOOL_DEFINITIONS, MAX_JOURNAL_TOOL_RESULT_CHARS } from "../src/server/journal-work-tools.mjs";

const SENTINEL = "SYNTHETIC_CLAUDE_PRIVATE_SENTINEL_DO_NOT_LOG";
const ANSWER = { schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] };
const GRANT = { grant_id: "grant:synthetic", principal_id: "synthetic-operator", purpose: "organize_search",
  allowed_roles: ["reference_reader"], revoked: false, expires_at: null };

function call(operationKey) {
  return { role: "reference_reader", outputSchema: "reference-result", operationKey, grant: GRANT,
    packet: { protocol_version: "1.0", output_schema_id: "reference-result", assigned_core_ids: ["u1"],
      source_locators: [{ representation_id: "r1", page: null, start_byte: 0, end_byte: Buffer.byteLength(SENTINEL) }],
      expected_generation: "generation:synthetic", controller_provenance_tag: "job:synthetic",
      grant_purpose: "organize_search", source_windows: [{ unit_id: "u1", text: SENTINEL }],
      adjacent_context: { by_unit: [] }, visual_context: [], neutral_reading_instructions: [] } };
}

async function fixture(t, scenario = "ok") {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-claude-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const host = path.join(base, "host"), laptop = path.join(base, "laptop");
  const root = path.join(host, "exchange"), workDir = path.join(laptop, "work");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("base64");
  const secretFile = path.join(host, "secret");
  await fs.writeFile(secretFile, secret, { mode: 0o600 });
  const config = path.join(host, "run.json");
  await fs.writeFile(config, JSON.stringify({ target_profile: { case_id: "synthetic-case" } }), { mode: 0o600 });
  const trace = path.join(laptop, "trace.json");
  const log = path.join(laptop, "log.jsonl");
  const ssh = path.join(laptop, "ssh-fake.mjs");
  const sshTrace = path.join(laptop, "ssh-trace.jsonl");
  const claude = path.join(laptop, "claude-fake.mjs");
  const checkout = path.resolve(new URL("..", import.meta.url).pathname);
  await fs.writeFile(ssh, `#!${process.execPath}
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(sshTrace)}, JSON.stringify({ args, env: Object.keys(process.env).sort() }) + "\\n");
if (${JSON.stringify(scenario)} === "stage_remove_failure" && args.at(-1).includes("stage-remove")) process.exit(34);
if (${JSON.stringify(scenario)} === "oversize_packet" && args.at(-1).includes("packet-check")) {
  console.log('{"allowed":false}'); process.exit(0);
}
if (${JSON.stringify(scenario)} === "release_failure" && args.at(-1).includes("attempt-release")) {
  const marker = ${JSON.stringify(path.join(laptop, "release-fail-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(37); }
}
if (${JSON.stringify(scenario)} === "already_answered" && args.at(-1).includes("'promote'")) {
  const { createJournalWorkExchange } = await import(${JSON.stringify(path.join(checkout, "src/journal-import/work-exchange.mjs"))});
  const workId = args.at(-1).match(/'--work-id' '([^']+)'/)[1];
  const exchange = createJournalWorkExchange({ root: ${JSON.stringify(root)},
    secret: fs.readFileSync(path.join(path.dirname(${JSON.stringify(config)}), "secret"), "utf8") });
  await exchange.submitResult({ workId, output: ${JSON.stringify(ANSWER)}, subject: "local:synthetic-first" });
}
if (${JSON.stringify(scenario)} === "ssh_prestart_retry" && args.at(-1).includes("stage-create")) {
  const marker = ${JSON.stringify(path.join(laptop, "ssh-prestart-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(35); }
}
if (args.slice(0, 9).join("|") !== ["-o", "BatchMode=yes", "-o", "ClearAllForwardings=yes",
  "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-T"].join("|")) process.exit(31);
const result = spawnSync("/bin/sh", ["-c", args.at(-1)], { encoding: "utf8", input: fs.readFileSync(0),
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: ${JSON.stringify(root)},
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: path.join(path.dirname(${JSON.stringify(config)}), "secret") } });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`, { mode: 0o700 });
  await fs.writeFile(claude, `#!${process.execPath}
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
const workId = args[args.indexOf("-p") + 1].match(/item ([^ .]+)/)[1];
fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args, env: Object.keys(process.env).sort(), config }));
let scenario = ${JSON.stringify(scenario)};
if (scenario === "isolation_then_success") {
  const marker = ${JSON.stringify(path.join(laptop, "isolation-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); scenario = "tools_extra"; }
  else scenario = "ok";
}
const slug = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
const project = path.join(process.env.HOME, ".claude", "projects", slug);
fs.mkdirSync(project, { recursive: true });
const cache = path.join(process.env.XDG_CACHE_HOME, "claude-cli-nodejs", slug, "mcp-logs-journal");
fs.mkdirSync(cache, { recursive: true });
fs.writeFileSync(path.join(cache, "synthetic.jsonl"), "synthetic metadata");
if (["project_file", "fallback_cache"].includes(scenario)) {
  const target = scenario === "project_file" ? path.join(project, "session", "tool-results")
    : path.join(process.env.HOME, ".cache", "claude-cli-nodejs", slug, "mcp-logs-journal");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "synthetic.txt"), ["SYNTHETIC", "CLAUDE", "PRIVATE", "SENTINEL", "DO", "NOT", "LOG"].join("_"));
}
if (scenario === "no_init_then_success") {
  const marker = ${JSON.stringify(path.join(laptop, "no-init-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(36); }
}
const init = { type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
  tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
  skills: [], slash_commands: [], plugins: [{ name: "synthetic" }], agents: [{ name: "synthetic" }],
  claude_code_version: "2.1.287", session_id: "12345678" };
if (scenario === "ui_invalidate") console.log(JSON.stringify({ type: "system", subtype: "ui_invalidate" }));
if (scenario === "init_missing") { console.log(JSON.stringify({ type: "result", is_error: false, subtype: "success" })); process.exit(0); }
if (scenario === "server_extra") init.mcp_servers.push({ name: "other", status: "connected" });
if (scenario === "server_disconnected") init.mcp_servers[0].status = "disconnected";
if (scenario === "tools_extra") init.tools.push("Bash");
if (scenario === "skills_present") init.skills.push("synthetic");
if (scenario === "slashes_present") init.slash_commands.push("synthetic");
console.log(JSON.stringify(init));
if (scenario === "hook_event") console.log(JSON.stringify({ type: "hook_started", hook_name: "synthetic" }));
// Give the parent a chance to kill the process group before any packet tool call.
if (["server_extra", "server_disconnected", "tools_extra", "skills_present", "slashes_present", "hook_event"].includes(scenario)) {
  await new Promise(resolve => setTimeout(resolve, 250));
  fs.writeFileSync(${JSON.stringify(path.join(laptop, "packet-called-after-refusal"))}, "bad");
}
if (scenario === "large_user_line") console.log(JSON.stringify({ type: "user", message: { content: "x".repeat(1_500_000) } }));
if (["limit_then_success", "assistant_limit", "http429", "rate_event_seconds", "rate_event_ms", "release_failure"].includes(scenario)) {
  const counter = ${JSON.stringify(path.join(laptop, "limit-count"))};
  if (!fs.existsSync(counter)) {
    fs.writeFileSync(counter, "1");
    if (["assistant_limit", "release_failure"].includes(scenario)) console.log(JSON.stringify({ type: "assistant", error: "rate_limit" }));
    if (scenario.startsWith("rate_event")) console.log(JSON.stringify({ type: "rate_limit_event", status: "limited",
      resetsAt: scenario === "rate_event_seconds" ? (Date.now() + 100) / 1000 : Date.now() + 100 }));
    console.log(JSON.stringify({ type: "result", is_error: true,
      subtype: scenario === "http429" ? "success" : "error_during_execution",
      api_error_status: scenario === "http429" ? 429 : undefined,
      error: scenario === "limit_then_success" ? { code: "usage_limit", message: "usage limit reset in 1 seconds" } : undefined,
      session_id: "12345678", modelUsage: {}, result: "synthetic reply" }));
    process.exit(1);
  }
}

if (${JSON.stringify(scenario)} === "timeout") setInterval(() => {}, 1000);
else {
  const server = config.mcpServers.journal;
  const names = scenario === "packet_free" ? ["submit_journal_work_result"]
    : scenario === "submit_before_fetch" ? ["submit_journal_work_result", "get_journal_work_packet"]
    : scenario === "nothing_staged" ? ["get_journal_work_packet"]
    : ["get_journal_work_packet", "submit_journal_work_result"];
  const requests = names.map((name, index) => ({ jsonrpc: "2.0", id: index + 1, method: "tools/call",
    params: { name, arguments: name === "submit_journal_work_result"
      ? { work_id: workId, output: ${JSON.stringify(ANSWER)} } : { work_id: workId } } }));
  for (const name of (scenario === "nothing_staged" ? [...names, "submit_journal_work_result"] : names)) console.log(JSON.stringify({ type: "assistant", message: { content: [
    { type: "tool_use", name: "mcp__journal__" + name, input: { work_id: workId } }] } }));
  const result = spawnSync(server.command, server.args, { encoding: "utf8",
    input: requests.map(JSON.stringify).join("\\n") + "\\n", env: process.env });
  if (result.status !== 0) process.exit(32);
  const replies = result.stdout.trim().split("\\n").map(JSON.parse);
  if (scenario === "packet_free"
    && replies[0].result.structuredContent.code !== "JOURNAL_WORK_PACKET_NOT_FETCHED") process.exit(33);
  const usage = { "claude-opus-5-5": { inputTokens: 2, cacheReadInputTokens: 1, outputTokens: 3 } };
  if (${JSON.stringify(scenario)} === "second_model") usage["other-model"] = { outputTokens: 1 };
  if (scenario === "zero_output") usage["claude-opus-5-5"].outputTokens = 0;
  if (scenario === "helper_zero") usage["helper-model"] = { outputTokens: 0 };
  console.log(JSON.stringify({ type: "result", is_error: scenario === "is_error",
    subtype: "success", session_id: scenario === "missing_session" ? null
      : ["limit_then_success", "assistant_limit", "http429", "rate_event_seconds", "rate_event_ms", "release_failure"].includes(scenario) ? "87654321" : "12345678",
    modelUsage: usage, total_cost_usd: 0.25, result: scenario === "reply_limit_words" ? "usage limit rate limit 429"
      : ["SYNTHETIC", "CLAUDE", "PRIVATE", "SENTINEL", "DO", "NOT", "LOG"].join("_") }));
}
`, { mode: 0o700 });
  const exchange = createJournalWorkExchange({ root, secret });
  const port = createExchangeJournalInferencePort({ exchange, caseId: "synthetic-case", receiptKey: randomBytes(32),
    routeRef: "route:synthetic", allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "gpt-6-sol", effort: "medium", executionAttestation: "codex_exec", waitMs: 0,
    hardestLane: { model: "claude-opus-5-5", effort: "max" } });
  const environment = { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    HOME: laptop, LANG: "C" };
  const args = ["--agent", "claude", "--remote", "synthetic-host", "--remote-checkout", checkout,
    "--remote-config", config, "--work-dir", workDir, "--ssh-bin", ssh, "--claude-bin", claude,
    "--log", log, "--once", "--max-items", "1", "--poll-ms", "10", "--timeout-ms", "2500"];
  return { base, host, laptop, root, workDir, secret, secretFile, config, trace, sshTrace, log, exchange, port, environment, args };
}

async function scanFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await scanFiles(name));
    else if (entry.isFile()) result.push(await fs.readFile(name));
  }
  return result;
}

test("synthetic SSH and Claude executables parse without private text", async (t) => {
  const f = await fixture(t);
  for (const program of [path.join(f.laptop, "ssh-fake.mjs"), path.join(f.laptop, "claude-fake.mjs")]) {
    const checked = spawnSync(process.execPath, ["--check", program], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    const bytes = await fs.readFile(program);
    assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
    assert.ok(!bytes.includes(Buffer.from(f.secretFile)));
  }
});

test("Claude arguments map only the pinned hardest profile and remote MCP holds no secret", () => {
  const record = { work_id: "job:synthetic", tier: "hardest", model: "claude-opus-5-5", effort: "max" };
  const args = claudePrintArgs({ record, mcpConfig: "/tmp/mcp.json" });
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4), ["--model", "opus", "--effort", "max"]);
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
  for (const flag of ["--verbose", "--disable-slash-commands", "--include-hook-events"]) assert.ok(args.includes(flag));
  assert.deepEqual(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
  assert.deepEqual(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 4),
    ["--setting-sources", "", "--settings", '{"disableAllHooks":true}']);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.throws(() => claudePrintArgs({ record: { ...record, model: "claude-unmapped" }, mcpConfig: "/tmp/mcp.json" }),
    { code: "JOURNAL_CLAUDE_PROFILE_INVALID" });
  const options = parseJournalClaudeWorkerArgs(["--agent", "claude", "--remote", "host",
    "--remote-checkout", "/host/repo", "--remote-config", "/host/config", "--work-dir", "/tmp/work"]);
  assert.equal(options.limitBackoffMs, 30 * 60_000);
  const mcp = JSON.stringify(claudeMcpConfiguration(options, "/host/stage", {}));
  assert.ok(mcp.includes("BatchMode=yes") && mcp.includes("ClearAllForwardings=yes")
    && mcp.includes("ForwardAgent=no") && mcp.includes("ForwardX11=no"));
  assert.ok(!mcp.includes("INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET"));
});

test("Claude result admission strips response text and rejects unverified profiles", () => {
  const record = { model: "claude-opus-5-5", work_id: "job:synthetic" };
  for (const [scenario, change, expected] of [
    ["error", { is_error: true }, "RESULT_UNSUCCESSFUL"],
    ["session", { session_id: null }, "SESSION_INVALID"],
    ["model", { modelUsage: { "claude-opus-5-5": { outputTokens: 1 }, other: { outputTokens: 1 } } }, "MODEL_USAGE_INVALID"]
  ]) {
    const reader = claudeResultReader(record);
    reader.accept(JSON.stringify({ type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
      tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
      skills: [], slash_commands: [], plugins: [], agents: [] }));
    reader.accept(JSON.stringify({ type: "result", is_error: false, subtype: "success", session_id: "12345678",
      modelUsage: { "claude-opus-5-5": { outputTokens: 1 } }, result: SENTINEL, ...change }));
    assert.equal(reader.state.bad, expected, scenario);
    assert.ok(!JSON.stringify(reader.state).includes(SENTINEL));
  }
});

test("usage-limit admission reads structured errors and ignores reply text", () => {
  const record = { model: "claude-opus-5-5", work_id: "job:synthetic" };
  const init = { type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
    tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
    skills: [], slash_commands: [], plugins: [], agents: [] };
  const limited = claudeResultReader(record);
  limited.accept(JSON.stringify(init));
  limited.accept(JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution",
    error: { code: "usage_limit" }, result: "private answer" }));
  assert.equal(limited.state.limitSeen, true);
  assert.equal(limited.state.limitReset, null);
  const success = claudeResultReader(record);
  success.accept(JSON.stringify(init));
  success.accept(JSON.stringify({ type: "result", is_error: false, subtype: "success", session_id: "12345678",
    modelUsage: { "claude-opus-5-5": { outputTokens: 1 }, helper: { outputTokens: 0 } },
    result: "usage limit rate limit 429" }));
  assert.equal(success.state.limitSeen, false);
  assert.equal(success.state.bad, null);
});

test("remote fake Claude answers hardest work; host keeps secret, laptop output stays content free", async (t) => {
  const f = await fixture(t);
  const operationKey = "job:synthetic-claude-hardest";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  let stderr = "";
  assert.equal(await runJournalClaudeWorker(f.args, { environment: f.environment,
    stderr: { write: (value) => { stderr += value; } } }), 0);
  const completed = await f.port.getCompletion(operationKey);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output, ANSWER);
  assert.equal(completed.receipt.execution_profile_evidence, "claude_code_model_usage_reported");
  const trace = JSON.parse(await fs.readFile(f.trace, "utf8"));
  assert.deepEqual(trace.env, ["HOME", "LANG", "PATH", "XDG_CACHE_HOME"]);
  assert.equal(trace.args[trace.args.indexOf("--model") + 1], "opus");
  const log = await fs.readFile(f.log, "utf8");
  assert.equal(stderr, "");
  assert.ok(log.includes('"total_cost_usd":0.25'));
  assert.ok(log.includes("subscription_cost_equivalent_not_charged"));
  assert.equal(JSON.parse(log.trim()).claude_code_version, "2.1.287");
  assert.deepEqual(await fs.readdir(path.join(f.laptop, "work")), []);
  const sshTrace = await fs.readFile(f.sshTrace, "utf8");
  // Worker-run ssh gets PATH, HOME and LANG only; the MCP ssh that Claude starts also inherits the run-local XDG_CACHE_HOME.
  assert.ok(sshTrace.trim().split("\n").map(JSON.parse).every((entry) =>
    ["HOME,LANG,PATH", "HOME,LANG,PATH,XDG_CACHE_HOME"].includes(entry.env.join(","))));
  for (const channel of [JSON.stringify(f.args), JSON.stringify(trace), sshTrace, log, stderr,
    await fs.readFile(path.join(f.laptop, "ssh-fake.mjs"), "utf8")]) {
    assert.ok(!channel.includes(f.secret));
    assert.ok(!channel.includes(f.secretFile));
    assert.ok(!channel.includes(SENTINEL));
  }
  for (const bytes of await scanFiles(f.laptop)) {
    assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
    assert.ok(!bytes.includes(Buffer.from(f.secretFile)));
  }
  assert.deepEqual(await fs.readdir(path.join(f.root, "stage")), []);
});

for (const scenario of ["reply_limit_words", "helper_zero", "ui_invalidate", "large_user_line"]) {
  test(`Claude ${scenario} is admitted`, async (t) => {
    const f = await fixture(t, scenario);
    const operationKey = `job:synthetic-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker(f.args, { environment: f.environment });
    assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
    assert.equal(JSON.parse((await fs.readFile(f.log, "utf8")).trim()).outcome, "answered");
  });
}

for (const scenario of ["no_init_then_success", "ssh_prestart_retry"]) {
  test(`${scenario} retries before a model attempt`, async (t) => {
    const f = await fixture(t, scenario);
    const operationKey = `job:synthetic-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker(f.args, { environment: f.environment });
    assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
    const outcomes = (await fs.readFile(f.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line).outcome);
    assert.deepEqual(outcomes, [scenario === "no_init_then_success" ? "rejected:ISOLATION" : "error", "answered"]);
  });
}

test("packet-free and failed Claude admissions never promote staged answers", async (t) => {
  const outcomes = { packet_free: "rejected:PACKET_NOT_FETCHED", submit_before_fetch: "rejected:PACKET_NOT_FETCHED",
    nothing_staged: "rejected:STAGE_MISSING", is_error: "rejected:RESULT_UNSUCCESSFUL",
    second_model: "rejected:MODEL_USAGE_INVALID", zero_output: "rejected:MODEL_USAGE_INVALID",
    missing_session: "rejected:SESSION_INVALID", timeout: "timeout",
    init_missing: "rejected:ISOLATION", server_extra: "isolation_refused",
    server_disconnected: "isolation_refused", tools_extra: "isolation_refused",
    skills_present: "isolation_refused", slashes_present: "isolation_refused", hook_event: "isolation_refused",
    project_file: "rejected:LOCAL_PERSISTENCE", fallback_cache: "rejected:LOCAL_PERSISTENCE" };
  for (const [scenario, expected] of Object.entries(outcomes)) {
    await t.test(scenario, async (child) => {
      const f = await fixture(child, scenario);
      const operationKey = `job:synthetic-${scenario}`;
      await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
      await runJournalClaudeWorker(f.args, { environment: f.environment });
      assert.equal((await f.port.getCompletion(operationKey)).status, "unknown");
      const log = await fs.readFile(f.log, "utf8");
      assert.equal(JSON.parse(log.trim().split("\n").at(-1)).outcome, expected);
      assert.ok(!log.includes(SENTINEL) && !log.includes(f.secret));
      assert.deepEqual(await fs.readdir(path.join(f.root, "stage")), []);
      await assert.rejects(fs.access(path.join(f.laptop, "packet-called-after-refusal")));
      for (const bytes of await scanFiles(f.laptop)) assert.ok(!bytes.includes(Buffer.from(SENTINEL)));
      if (expected === "isolation_refused") {
        assert.equal(JSON.parse(log.trim().split("\n").at(-1)).model_reached, false);
        const before = await fs.readFile(f.trace, "utf8");
        await runJournalClaudeWorker(f.args, { environment: f.environment });
        assert.equal(await fs.readFile(f.trace, "utf8"), before);
      }
    });
  }
});

test("Claude usage limit waits for the reset without spending an item attempt", async (t) => {
  const f = await fixture(t, "limit_then_success");
  const operationKey = "job:synthetic-claude-limit";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker([...f.args, "--limit-backoff-ms", "1000"], { environment: f.environment });
  assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(({ outcome }) => outcome), ["limited", "answered"]);
  assert.ok(logs.every((record) => record.cost_kind === "subscription_cost_equivalent_not_charged"));
});

test("attempt marker survives a worker restart and prevents a second model run", async (t) => {
  const f = await fixture(t, "nothing_staged");
  const operationKey = "job:synthetic-restart-marker";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const before = await fs.readFile(f.trace, "utf8");
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  assert.equal(await fs.readFile(f.trace, "utf8"), before);
  assert.equal((await f.port.getCompletion(operationKey)).status, "unknown");
});

test("one worker refuses a session ID reused for a second hardest item", async (t) => {
  const f = await fixture(t);
  const keys = ["job:synthetic-session-first", "job:synthetic-session-second"];
  for (const operationKey of keys) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  await runJournalClaudeWorker(f.args.map((value) => value === "1" ? "2" : value), { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["answered", "rejected:SESSION_REUSED"]);
  assert.equal((await f.port.getCompletion(keys[0])).status, "completed");
  assert.equal((await f.port.getCompletion(keys[1])).status, "unknown");
});

test("stale worker directories are swept and opening the log cleans the new parent", async (t) => {
  const f = await fixture(t);
  const stale = path.join(f.workDir, "inner-signal-claude-AAAAAA");
  await fs.mkdir(path.join(stale, "run-leftover"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(stale, "worker.lock"), "", { mode: 0o600 });
  const old = new Date(Date.now() - 2 * 3_600_000);
  await fs.utimes(stale, old, old);
  const badLog = path.join(f.laptop, "missing", "log.jsonl");
  await assert.rejects(runJournalClaudeWorker(f.args.map((value) => value === f.log ? badLog : value),
    { environment: f.environment }));
  assert.deepEqual(await fs.readdir(f.workDir), ["inner-signal-claude-AAAAAA"]);
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  await assert.rejects(fs.access(stale));
  assert.deepEqual(await fs.readdir(f.workDir), []);
});

test("stage removal failure is logged without packet content", async (t) => {
  const f = await fixture(t, "stage_remove_failure");
  const operationKey = "job:synthetic-stage-remove-failure";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map((item) => item.outcome), ["stage_remove_failed", "answered"]);
  assert.ok(!JSON.stringify(logs).includes(SENTINEL));
});

test("an already answered promotion has its own content-free worker outcome", async (t) => {
  const f = await fixture(t, "already_answered");
  const operationKey = "job:synthetic-already-log";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs.at(-1).outcome, "already_answered");
  assert.ok(!JSON.stringify(logs).includes(SENTINEL));
});

test("SIGINT wakes the poll sleep and returns exit code 130", async (t) => {
  const f = await fixture(t);
  const args = f.args.filter((value) => value !== "--once");
  args.splice(args.indexOf("--poll-ms") + 1, 1, "60000");
  const started = Date.now();
  const pending = runJournalClaudeWorker(args, { environment: f.environment });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const trace = await fs.readFile(f.sshTrace, "utf8").catch(() => "");
    if (trace.includes("dispatch")) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.emit("SIGINT");
  assert.equal(await pending, 130);
  assert.ok(Date.now() - started < 5_000);
});

test("host stage commands reject arbitrary paths and refuse packet-free promotion", async (t) => {
  const f = await fixture(t);
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  let output = "";
  await runJournalWork(["stage-create"], { environment: env, stdout: { write: (value) => { output += value; } } });
  const stageDir = JSON.parse(output).stage_dir;
  let status = "";
  await runJournalWork(["stage-check", "--work-id", "job:synthetic", "--stage-dir", stageDir],
    { environment: env, stdout: { write: (value) => { status += value; } } });
  assert.deepEqual(JSON.parse(status), { staged: false, packet_fetched: false });
  await assert.rejects(runJournalWork(["stage-remove", "--stage-dir", f.laptop], { environment: env }),
    { code: "JOURNAL_WORK_STAGE_DIR_INVALID" });
  await runJournalWork(["stage-remove", "--stage-dir", stageDir], { environment: env, stdout: { write() {} } });
});

test("host sweeps only stages older than the dispatch TTL", async (t) => {
  const f = await fixture(t);
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  const create = async () => {
    let value = "";
    await runJournalWork(["stage-create"], { environment: env, stdout: { write: (text) => { value += text; } } });
    return JSON.parse(value).stage_dir;
  };
  const stale = await create();
  const fresh = await create();
  const old = new Date(Date.now() - 25 * 3_600_000);
  await fs.utimes(stale, old, old);
  await runJournalWork(["stage-sweep"], { environment: env, stdout: { write() {} } });
  await assert.rejects(fs.access(stale));
  await fs.access(fresh);
});

test("stage sweep tolerates a concurrent stage-remove after its directory listing", async (t) => {
  const f = await fixture(t);
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  let output = "";
  await runJournalWork(["stage-create"], { environment, stdout: { write: value => { output += value; } } });
  const stageDir = JSON.parse(output).stage_dir;
  const lstat = fs.lstat.bind(fs);
  let removed = false;
  t.mock.method(fs, "lstat", async (target, ...args) => {
    if (target === stageDir && !removed) {
      removed = true;
      await fs.rm(stageDir, { recursive: true });
    }
    return lstat(target, ...args);
  });
  await runJournalWork(["stage-sweep"], { environment, stdout: { write() {} } });
  assert.equal(removed, true);
});

test("host promotion reports an already answered hardest item", async (t) => {
  const f = await fixture(t);
  const operationKey = "job:synthetic-already-answered";
  await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  const [dispatch] = await f.exchange.listDispatch();
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  let created = "";
  await runJournalWork(["stage-create"], { environment: env, stdout: { write: (value) => { created += value; } } });
  const stageDir = JSON.parse(created).stage_dir;
  await f.exchange.markPacketFetched({ stageDir, workId: dispatch.work_id });
  await f.exchange.stageResult({ stageDir, workId: dispatch.work_id, output: ANSWER });
  await f.exchange.submitResult({ workId: dispatch.work_id, output: ANSWER, subject: "local:synthetic-first",
    execution: { profile_evidence: "claude_code_model_usage_reported", effective_model_profile: dispatch.model,
      effective_effort: dispatch.effort, request_context_id: "claude-session:first12345" } });
  let output = "";
  await runJournalWork(["promote", "--work-id", dispatch.work_id, "--stage-dir", stageDir,
    "--execution-json", JSON.stringify({ profile_evidence: "claude_code_model_usage_reported",
      effective_model_profile: dispatch.model, effective_effort: dispatch.effort,
      request_context_id: "claude-session:second12345" }), "--subject", "local:claude-hardest"],
  { environment: env, stdout: { write: (value) => { output += value; } } });
  assert.deepEqual(JSON.parse(output), { answered: false, already: true });
});

test("stdio tools/list adds the Claude limit without changing the tools' schemas or results", async (t) => {
  const f = await fixture(t);
  const stdin = new PassThrough();
  stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  let output = "";
  await runJournalWorkMcp(["--config", f.config, "--principal", "synthetic"], { stdin,
    stdout: { write: value => { output += value; } }, environment: {
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile } });
  const tools = JSON.parse(output).result.tools;
  for (const tool of tools) assert.equal(tool._meta["anthropic/maxResultSizeChars"], MAX_JOURNAL_TOOL_RESULT_CHARS);
  assert.deepEqual(tools.map(({ _meta, ...tool }) => tool), JOURNAL_WORK_TOOL_DEFINITIONS);
});

for (const scenario of ["assistant_limit", "http429", "rate_event_seconds", "rate_event_ms", "release_failure"]) {
  test(`${scenario} releases a limit reservation and retries without an attempted marker`, async (t) => {
    const f = await fixture(t, scenario);
    const operationKey = `job:synthetic-${scenario}`;
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
    await runJournalClaudeWorker([...f.args, "--limit-backoff-ms", "100"], { environment: f.environment });
    assert.equal((await f.port.getCompletion(operationKey)).status, "completed");
    const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(logs.filter(item => item.cost_kind).map(item => item.outcome), ["limited", "answered"]);
    if (scenario === "release_failure") {
      assert.equal(logs[0].outcome, "attempt_release_failed");
      // The next loop retries the release before launching the next Claude run.
      const commands = (await fs.readFile(f.sshTrace, "utf8")).trim().split("\n").map(JSON.parse)
        .map(entry => entry.args.at(-1));
      const releases = commands.map((command, index) => command.includes("'attempt-release'") ? index : -1)
        .filter(index => index >= 0);
      assert.equal(releases.length, 2);
      assert.ok(commands.slice(releases[0] + 1, releases[1]).every(command => !command.includes("'attempt-mark'")));
    }
    assert.ok(!JSON.stringify(logs).includes(SENTINEL));
  });
}

test("packet preflight refuses before the Claude executable starts", async (t) => {
  const f = await fixture(t, "oversize_packet");
  await assert.rejects(f.port.invoke({ ...call("job:synthetic-oversize"), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  await assert.rejects(fs.access(f.trace));
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(logs.every(item => item.outcome === "rejected:PACKET_TOO_LARGE" && item.model_reached === false));
});

test("attempt status, exclusive reservations, corrupt markers, stale temps and operator clearing", async (t) => {
  const f = await fixture(t);
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  const workId = "journal-work:" + "a".repeat(48);
  const claim = "11111111-1111-4111-8111-111111111111";
  const command = async (name, args = []) => {
    let output = "";
    await runJournalWork([name, "--work-id", workId, ...args], { environment,
      stdout: { write: value => { output += value; } } });
    return JSON.parse(output);
  };
  assert.equal((await command("attempt-status")).status, "none");
  const results = await Promise.all([command("attempt-reserve", ["--claim", claim, "--timeout-ms", "60000"]),
    command("attempt-reserve", ["--claim", claim, "--timeout-ms", "60000"])]);
  assert.deepEqual(results.map(item => item.claimed).sort(), [false, true]);
  assert.equal((await command("attempt-status")).status, "reserved");
  const directory = path.join(f.root, "claude-attempts");
  const marker = path.join(directory, journalWorkFileKey(journalAttemptIdentity(workId)) + ".json");
  // A resend has the same stable operation identity encoded in its work ID.
  let resend = "";
  await runJournalWork(["attempt-status", "--work-id", workId + ":r1"], { environment,
    stdout: { write: value => { resend += value; } } });
  assert.equal(JSON.parse(resend).status, "reserved");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  const old = new Date(Date.now() - 3_601_000);
  await fs.utimes(marker, old, old);
  assert.ok((await command("attempt-status")).age_seconds > 3600);
  assert.equal((await command("attempt-clear")).cleared, true);
  await command("attempt-reserve", ["--claim", claim]);
  await command("attempt-refuse", ["--claim", claim]);
  assert.equal((await command("attempt-status")).status, "isolation_refused");
  await command("attempt-clear");
  await command("attempt-reserve", ["--claim", claim]);
  await command("attempt-mark", ["--claim", claim]);
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  await assert.rejects(command("attempt-refuse", ["--claim", claim]), { code: "JOURNAL_WORK_ATTEMPT_INVALID" });
  await fs.writeFile(marker, JSON.stringify({ work_id: workId, claim, status: "reserved", timeout_ms: -1 }));
  assert.equal((await command("attempt-status")).status, "attempted");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  await fs.writeFile(marker, "{");
  assert.equal((await command("attempt-status")).status, "attempted");
  await assert.rejects(command("attempt-clear"), { code: "JOURNAL_WORK_ATTEMPT_CLEAR_REFUSED" });
  const staleTemp = marker + "." + claim + ".tmp";
  await fs.writeFile(staleTemp, "synthetic");
  await fs.utimes(staleTemp, old, old);
  await command("attempt-status");
  await assert.rejects(fs.access(staleTemp));
  assert.deepEqual(await fs.readdir(directory), [path.basename(marker)]);
});

test("already attempted, corrupt and isolation-refused items do not consume max-items", async (t) => {
  const f = await fixture(t);
  const keys = ["job:synthetic-already", "job:synthetic-corrupt", "job:synthetic-isolation", "job:synthetic-next"];
  const claim = "11111111-1111-4111-8111-111111111111";
  for (const operationKey of keys) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  const records = await f.exchange.listDispatch();
  const environment = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root };
  for (const record of records.slice(0, 3)) {
    await runJournalWork(["attempt-reserve", "--work-id", record.work_id, "--claim", claim],
      { environment, stdout: { write() {} } });
  }
  await runJournalWork(["attempt-mark", "--work-id", records[0].work_id, "--claim", claim],
    { environment, stdout: { write() {} } });
  await fs.writeFile(path.join(f.root, "claude-attempts",
    journalWorkFileKey(journalAttemptIdentity(records[1].work_id)) + ".json"), "{");
  await runJournalWork(["attempt-refuse", "--work-id", records[2].work_id, "--claim", claim],
    { environment, stdout: { write() {} } });
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["already_attempted", "already_attempted", "isolation_refused", "answered"]);
  assert.equal(logs.at(-1).work_id, records[3].work_id);
});

test("a fresh isolation refusal does not consume max-items before the next item", async (t) => {
  const f = await fixture(t, "isolation_then_success");
  for (const operationKey of ["job:synthetic-isolation-first", "job:synthetic-isolation-second"]) {
    await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  }
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  const logs = (await fs.readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(logs.map(item => item.outcome), ["isolation_refused", "answered"]);
  assert.equal(logs[0].model_reached, false);
});

test("leftover project and fallback cache files for this worker prefix are swept", async (t) => {
  const f = await fixture(t);
  const slug = path.join(f.workDir, "inner-signal-claude-AAAAAA", "run-BBBBBB").replace(/[^A-Za-z0-9]/gu, "-");
  for (const root of [path.join(f.laptop, ".claude", "projects"), path.join(f.laptop, ".cache", "claude-cli-nodejs")]) {
    await fs.mkdir(path.join(root, slug), { recursive: true });
    await fs.writeFile(path.join(root, slug, "synthetic.txt"), SENTINEL);
    await fs.mkdir(path.join(root, "unrelated"), { recursive: true });
    await fs.writeFile(path.join(root, "unrelated", "keep.txt"), "keep");
  }
  await runJournalClaudeWorker(f.args, { environment: f.environment });
  for (const root of [path.join(f.laptop, ".claude", "projects"), path.join(f.laptop, ".cache", "claude-cli-nodejs")]) {
    await assert.rejects(fs.access(path.join(root, slug)));
    assert.equal(await fs.readFile(path.join(root, "unrelated", "keep.txt"), "utf8"), "keep");
  }
});
