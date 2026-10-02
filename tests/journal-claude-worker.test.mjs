import test from "node:test";
import assert from "node:assert/strict";
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
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(sshTrace)}, JSON.stringify({ args, env: Object.keys(process.env).sort() }) + "\\n");
if (args[0] !== "-o" || args[1] !== "BatchMode=yes" || args[2] !== "-o"
  || args[3] !== "ClearAllForwardings=yes" || args[4] !== "-T") process.exit(31);
const result = spawnSync("/bin/sh", ["-c", args.at(-1)], { encoding: "utf8", input: fs.readFileSync(0),
  env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: ${JSON.stringify(root)},
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: ${JSON.stringify(secretFile)} } });
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
if (${JSON.stringify(scenario)} === "limit_then_success") {
  const counter = ${JSON.stringify(path.join(laptop, "limit-count"))};
  if (!fs.existsSync(counter)) {
    fs.writeFileSync(counter, "1");
    console.log(JSON.stringify({ is_error: true, subtype: "error_during_execution",
      session_id: "12345678", modelUsage: {}, result: "usage limit reset in 1 seconds" }));
    process.exit(1);
  }
}
if (${JSON.stringify(scenario)} === "timeout") setInterval(() => {}, 1000);
else {
  const server = config.mcpServers.journal;
  const names = ${JSON.stringify(scenario)} === "packet_free"
    ? ["submit_journal_work_result"] : ["get_journal_work_packet", "submit_journal_work_result"];
  const requests = names.map((name, index) => ({ jsonrpc: "2.0", id: index + 1, method: "tools/call",
    params: { name, arguments: name === "submit_journal_work_result"
      ? { work_id: workId, output: ${JSON.stringify(ANSWER)} } : { work_id: workId } } }));
  const result = spawnSync(server.command, server.args, { encoding: "utf8",
    input: requests.map(JSON.stringify).join("\\n") + "\\n", env: process.env });
  if (result.status !== 0) process.exit(32);
  const replies = result.stdout.trim().split("\\n").map(JSON.parse);
  if (${JSON.stringify(scenario)} === "packet_free"
    && replies[0].result.structuredContent.code !== "JOURNAL_WORK_PACKET_NOT_FETCHED") process.exit(33);
  const usage = { "claude-opus-5-5": { inputTokens: 2, cacheReadInputTokens: 1, outputTokens: 3 } };
  if (${JSON.stringify(scenario)} === "second_model") usage["other-model"] = { outputTokens: 1 };
  console.log(JSON.stringify({ is_error: ${JSON.stringify(scenario)} === "is_error",
    subtype: "success", session_id: ${JSON.stringify(scenario)} === "missing_session" ? null : "12345678",
    modelUsage: usage, total_cost_usd: 0.25, result: ${JSON.stringify(SENTINEL)} }));
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
  return { base, host, laptop, root, secret, secretFile, config, trace, sshTrace, log, exchange, port, environment, args };
}

test("Claude arguments map only the pinned hardest profile and remote MCP holds no secret", () => {
  const record = { work_id: "job:synthetic", tier: "hardest", model: "claude-opus-5-5", effort: "max" };
  const args = claudePrintArgs({ record, mcpConfig: "/tmp/mcp.json" });
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 4), ["--model", "opus", "--effort", "max"]);
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--no-session-persistence"));
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.throws(() => claudePrintArgs({ record: { ...record, model: "claude-unmapped" }, mcpConfig: "/tmp/mcp.json" }),
    { code: "JOURNAL_CLAUDE_PROFILE_INVALID" });
  const options = parseJournalClaudeWorkerArgs(["--agent", "claude", "--remote", "host",
    "--remote-checkout", "/host/repo", "--remote-config", "/host/config", "--work-dir", "/tmp/work"]);
  const mcp = JSON.stringify(claudeMcpConfiguration(options, "/host/stage", {}));
  assert.ok(mcp.includes("BatchMode=yes") && mcp.includes("ClearAllForwardings=yes"));
  assert.ok(!mcp.includes("INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET"));
});

test("Claude result admission strips response text and rejects unverified profiles", () => {
  const record = { model: "claude-opus-5-5" };
  for (const [scenario, change, expected] of [
    ["error", { is_error: true }, "RESULT_UNSUCCESSFUL"],
    ["session", { session_id: null }, "SESSION_INVALID"],
    ["model", { modelUsage: { "claude-opus-5-5": { outputTokens: 1 }, other: { outputTokens: 1 } } }, "MODEL_USAGE_INVALID"]
  ]) {
    const reader = claudeResultReader(record);
    reader.accept(JSON.stringify({ is_error: false, subtype: "success", session_id: "12345678",
      modelUsage: { "claude-opus-5-5": { outputTokens: 1 } }, result: SENTINEL, ...change }));
    assert.equal(reader.state.bad, expected, scenario);
    assert.ok(!JSON.stringify(reader.state).includes(SENTINEL));
  }
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
    assert.ok(!channel.includes(SENTINEL));
  }
  assert.deepEqual(await fs.readdir(path.join(f.root, "stage")), []);
});

test("packet-free and failed Claude admissions never promote staged answers", async (t) => {
  for (const scenario of ["packet_free", "is_error", "second_model", "missing_session", "timeout"]) {
    await t.test(scenario, async (child) => {
      const f = await fixture(child, scenario);
      const operationKey = `job:synthetic-${scenario}`;
      await assert.rejects(f.port.invoke({ ...call(operationKey), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
      await runJournalClaudeWorker(f.args, { environment: f.environment });
      assert.equal((await f.port.getCompletion(operationKey)).status, "unknown");
      const log = await fs.readFile(f.log, "utf8");
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

test("host stage commands reject arbitrary paths and refuse packet-free promotion", async (t) => {
  const f = await fixture(t);
  const env = { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: f.root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: f.secretFile };
  let output = "";
  await runJournalWork(["stage-create"], { environment: env, stdout: { write: (value) => { output += value; } } });
  const stageDir = JSON.parse(output).stage_dir;
  await assert.rejects(runJournalWork(["stage-check", "--work-id", "job:synthetic", "--stage-dir", stageDir],
    { environment: env }), { code: "JOURNAL_WORK_PACKET_NOT_FETCHED" });
  await assert.rejects(runJournalWork(["stage-remove", "--stage-dir", f.laptop], { environment: env }),
    { code: "JOURNAL_WORK_STAGE_DIR_INVALID" });
  await runJournalWork(["stage-remove", "--stage-dir", stageDir], { environment: env, stdout: { write() {} } });
});
