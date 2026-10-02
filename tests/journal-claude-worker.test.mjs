import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";
import { createExchangeJournalInferencePort } from "../src/journal-import/exchange-port.mjs";
import { claudeMcpConfiguration, claudePrintArgs, claudeResultReader, parseJournalClaudeWorkerArgs,
  runJournalClaudeWorker } from "../src/journal-import/claude-worker.mjs";
import { runJournalWork } from "../src/cli/journal-work.mjs";

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
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
const workId = args[args.indexOf("-p") + 1].match(/item ([^ .]+)/)[1];
fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args, env: Object.keys(process.env).sort(), config }));
const scenario = ${JSON.stringify(scenario)};
if (scenario === "no_init_then_success") {
  const marker = ${JSON.stringify(path.join(laptop, "no-init-count"))};
  if (!fs.existsSync(marker)) { fs.writeFileSync(marker, "1"); process.exit(36); }
}
const init = { type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }],
  tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"],
  skills: [], slash_commands: [], plugins: [{ name: "synthetic" }], agents: [{ name: "synthetic" }], session_id: "12345678" };
if (scenario === "init_missing") { console.log(JSON.stringify({ type: "result", is_error: false, subtype: "success" })); process.exit(0); }
if (scenario === "server_extra") init.mcp_servers.push({ name: "other", status: "connected" });
if (scenario === "server_disconnected") init.mcp_servers[0].status = "disconnected";
if (scenario === "tools_extra") init.tools.push("Bash");
if (scenario === "skills_present") init.skills.push("synthetic");
if (scenario === "slashes_present") init.slash_commands.push("synthetic");
console.log(JSON.stringify(init));
if (scenario === "hook_event") console.log(JSON.stringify({ type: "hook_started", hook_name: "synthetic" }));
if (${JSON.stringify(scenario)} === "limit_then_success") {
  const counter = ${JSON.stringify(path.join(laptop, "limit-count"))};
  if (!fs.existsSync(counter)) {
    fs.writeFileSync(counter, "1");
    console.log(JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution",
      error: { code: "usage_limit", message: "usage limit reset in 1 seconds" },
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
      : scenario === "limit_then_success" ? "87654321" : "12345678",
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
  assert.deepEqual(trace.env, ["HOME", "LANG", "PATH"]);
  assert.equal(trace.args[trace.args.indexOf("--model") + 1], "opus");
  const log = await fs.readFile(f.log, "utf8");
  assert.equal(stderr, "");
  assert.ok(log.includes('"total_cost_usd":0.25'));
  assert.ok(log.includes("subscription_cost_equivalent_not_charged"));
  assert.deepEqual(await fs.readdir(path.join(f.laptop, "work")), []);
  const sshTrace = await fs.readFile(f.sshTrace, "utf8");
  assert.ok(sshTrace.trim().split("\n").map(JSON.parse).every((entry) =>
    JSON.stringify(entry.env) === JSON.stringify(["HOME", "LANG", "PATH"])));
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

for (const scenario of ["reply_limit_words", "helper_zero"]) {
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
    init_missing: "rejected:ISOLATION", server_extra: "rejected:ISOLATION",
    server_disconnected: "rejected:ISOLATION", tools_extra: "rejected:ISOLATION",
    skills_present: "rejected:ISOLATION", slashes_present: "rejected:ISOLATION", hook_event: "rejected:ISOLATION" };
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
