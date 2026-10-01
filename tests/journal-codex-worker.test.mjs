import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalWorkExchange, journalWorkExchangeSecret, journalWorkFileKey } from "../src/journal-import/work-exchange.mjs";
import { createExchangeJournalInferencePort, journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";
import { loadJournalInferencePortFromEnvironment } from "../src/journal-import/provider-runtime.mjs";
import { codexEventReader, codexExecArgs, CODEX_DISABLED_FEATURES, parseCodexResetTime, parseJournalCodexWorkerArgs,
  runJournalCodexWorker } from "../src/journal-import/codex-worker.mjs";
import { parseJournalWorkMcpArgs } from "../src/cli/journal-work-mcp.mjs";
import { configuredJournalDoctorReport } from "../src/cli/journal-import.mjs";

const SENTINEL = "SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_LOG";
const ANSWER = { schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] };
const allowanceEvidence = { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 };
const grant = { grant_id: "synthetic:grant", principal_id: "authorized-private-operator", purpose: "organize_search",
  allowed_roles: ["reference_reader"], revoked: false, expires_at: null };

function referenceCall(operationKey = "job:synthetic-codex-reference") {
  return { role: "reference_reader", outputSchema: "reference-result", operationKey, grant,
    packet: { protocol_version: "1.0", output_schema_id: "reference-result", assigned_core_ids: ["u1"],
      source_locators: [{ representation_id: "r1", page: null, start_byte: 0, end_byte: Buffer.byteLength(SENTINEL) }],
      expected_generation: "generation:synthetic", controller_provenance_tag: "job:synthetic",
      grant_purpose: "organize_search", source_windows: [{ unit_id: "u1", text: SENTINEL }],
      adjacent_context: { by_unit: [] }, visual_context: [], neutral_reading_instructions: [] } };
}

function manualWork(workId, role = "reference_reader") {
  return { schema_version: 1, work_id: workId, case_id: "synthetic-case", role, tier: "standard",
    instruction: "Use only the synthetic packet.", packet: { text: SENTINEL }, output_schema_name: "synthetic-result",
    output_schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
    expected_generation: "generation:synthetic", issued_at: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(), input_sha256: "a".repeat(64),
    grant_id: "grant:synthetic", grant_purpose: "organize_search", route_ref: "route:codex" };
}

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-codex-worker-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "exchange");
  const home = path.join(base, "codex-home");
  const workDir = path.join(base, "work");
  await fs.mkdir(root, { mode: 0o700 });
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(workDir, { mode: 0o700 });
  await fs.writeFile(path.join(home, "auth.json"), "{}", { mode: 0o600 });
  const secret = randomBytes(32).toString("base64");
  const secretFile = path.join(base, "secret.txt");
  await fs.writeFile(secretFile, `${secret}\n`, { mode: 0o600 });
  const configPath = path.join(base, "run.json");
  await fs.writeFile(configPath, JSON.stringify({ target_profile: { case_id: "synthetic-case" } }), { mode: 0o600 });
  const log = path.join(base, "worker.log");
  const trace = path.join(base, "trace.jsonl");
  const exchange = createJournalWorkExchange({ root, secret });
  const environment = { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, HOME: base, LANG: "C",
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: secretFile };
  const args = (fake, extra = []) => ["--config", configPath, "--codex-home", home, "--work-dir", workDir, "--codex-bin", fake,
    "--log", log, "--poll-ms", "10", ...extra];
  async function publish(workId, role = "reference_reader") {
    const entry = manualWork(workId, role);
    await exchange.publishWork(entry);
    await exchange.publishDispatch({ schema_version: 1, work_id: workId, role, tier: "standard",
      output_schema_name: entry.output_schema_name, model: "gpt-6-sol", effort: "medium", route_ref: "route:codex",
      issued_at: entry.issued_at, expires_at: entry.expires_at });
  }
  async function fake(scenario = "ok") {
    const filename = path.join(base, `fake-${scenario}.mjs`);
    const script = `#!/usr/bin/env node
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const args = process.argv.slice(2);
const scenario = ${JSON.stringify(scenario)};
const trace = ${JSON.stringify(trace)};
const configs = args.filter((arg, index) => args[index - 1] === "-c");
if (!configs.includes("project_doc_max_bytes=0") || !configs.includes("project_root_markers=[]")) process.exit(12);
const mcpArgs = JSON.parse(configs.find(value => value.startsWith("mcp_servers.journal.args=")).split("=").slice(1).join("="));
const envConfig = configs.find(value => value.startsWith("mcp_servers.journal.env="));
const fromConfig = (key) => JSON.parse(envConfig.match(new RegExp(key + '=("[^"]*")'))[1]);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
  INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: fromConfig("INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT"),
  INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: fromConfig("INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE") };
const workId = args.at(-1).match(/item ([^ .]+)/)[1];
fs.appendFileSync(trace, JSON.stringify({ phase: "start", at: Date.now(), args, keys: Object.keys(process.env).sort() }) + String.fromCharCode(10));
if (scenario === "timeout") {
  spawn(process.execPath, ["-e", "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'bad'), 1500)", ${JSON.stringify(path.join(base, "survived"))}], { stdio: "ignore" });
}
const answer = scenario === "reference" ? ${JSON.stringify(ANSWER)} : { ok: true };
const toolOrder = scenario === "submit_only" ? ["submit_journal_work_result"]
  : scenario === "fetch_after_submit" ? ["submit_journal_work_result", "get_journal_work_packet"]
  : ["get_journal_work_packet", "submit_journal_work_result"];
const calls = toolOrder.map((name, index) => ({
  jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name,
    arguments: name === "submit_journal_work_result" ? { work_id: workId, output: answer }
      : { work_id: scenario === "fetch_other" ? "job:synthetic-other-fetch" : scenario === "failed_fetch" ? "job:synthetic-absent" : workId } }
}));
const mcp = spawnSync(process.execPath, mcpArgs, { env, input: calls.map(JSON.stringify).join(String.fromCharCode(10)) + String.fromCharCode(10), encoding: "utf8" });
if (mcp.error) process.exit(7);
if (mcp.stderr.includes(${JSON.stringify(SENTINEL)})) process.exit(11);
if (mcp.status !== 0) process.exit(7);
const replies = mcp.stdout.trim().split(String.fromCharCode(10)).map(JSON.parse);
if (!["submit_only", "fetch_other", "failed_fetch", "fetch_after_submit"].includes(scenario)
  && (replies[0].result.structuredContent.status !== "ready" || replies[1].result.structuredContent.stored !== true)) process.exit(8);
const stageDir = mcpArgs[mcpArgs.indexOf("--stage-dir") + 1];
fs.appendFileSync(trace, JSON.stringify({ phase: "staged", exists: fs.readdirSync(stageDir).some(name => name.endsWith(".json")),
  replies: replies.map(reply => reply.result.structuredContent.code || reply.result.structuredContent.status || "stored") }) + String.fromCharCode(10));
if (scenario === "timeout") {
  setInterval(() => {}, 1000);
} else {
  if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 150));
  if (scenario !== "missing_thread") console.log(JSON.stringify({ type: "thread.started", thread_id: randomUUID() }));
  if (scenario === "two_threads") console.log(JSON.stringify({ type: "thread.started", thread_id: randomUUID() }));
  console.log(JSON.stringify({ type: "turn.started" }));
  for (const [index, call] of calls.entries()) {
    const itemType = ({ web_search: "web_search", command_execution: "command_execution", other_server: "mcp_tool_call", other_tool: "mcp_tool_call" })[scenario] || "mcp_tool_call";
    const item = { type: itemType, server: scenario === "other_server" ? "outside" : "journal",
      tool: scenario === "other_tool" ? "other_tool" : call.params.name,
      arguments: call.params.arguments, status: "in_progress", text: ${JSON.stringify(SENTINEL)} };
    console.log(JSON.stringify({ type: "item.started", item }));
    console.log(JSON.stringify({ type: "item.updated", item }));
    console.log(JSON.stringify({ type: "item.completed", item: { ...item,
      status: scenario === "failed_fetch" && index === 0 ? "failed" : "completed",
      error: replies[index].result.isError ? "synthetic tool error" : undefined } }));
  }
  if (scenario === "error_item") {
    const errorItem = { type: "error", message: "model rerouted" };
    console.log(JSON.stringify({ type: "item.started", item: errorItem }));
    console.log(JSON.stringify({ type: "item.completed", item: errorItem }));
  }
  if (scenario === "turn_failed") console.log(JSON.stringify({ type: "turn.failed" }));
  else if (scenario === "error_event") console.log(JSON.stringify({ type: "error", message: "synthetic failure" }));
  else if (scenario === "limit_default" || (scenario === "limit_then_success" && fs.readFileSync(trace, "utf8").split('"phase":"start"').length <= 4)) {
    console.log(JSON.stringify({ type: "error", message: "You've hit your usage limit. Try again later." }));
  } else if (scenario !== "missing_turn") console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 1, cache_write_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 } }));
  if (scenario === "transient429") process.stderr.write("HTTP 429 retried successfully" + String.fromCharCode(10));
  const message = { type: "agent_message", text: ${JSON.stringify(SENTINEL)} };
  console.log(JSON.stringify({ type: "item.started", item: message }));
  console.log(JSON.stringify({ type: "item.completed", item: message }));
  fs.appendFileSync(trace, JSON.stringify({ phase: "end", at: Date.now() }) + String.fromCharCode(10));
  if (scenario === "nonzero") process.exit(9);
}
`;
    await fs.writeFile(filename, script, { mode: 0o700 });
    return filename;
  }
  const logs = async () => (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  return { base, root, home, workDir, secret, secretFile, configPath, log, trace, exchange, environment, args, publish, fake, logs };
}

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error("Synthetic condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function spawnWorker(f, fake, extra = []) {
  const cli = path.resolve(new URL("../src/cli/journal-codex-worker.mjs", import.meta.url).pathname);
  const child = spawn(process.execPath, [cli, ...f.args(fake, extra)], { env: f.environment, stdio: "ignore" });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  return { child, closed };
}

test("Codex route validates model and role effort, while ChatGPT connector admission remains blocked", () => {
  const route = { schema_version: 1, provider: "codex_exec_exchange", route_ref: "route:codex", model: "gpt-6-sol",
    effort: "medium", role_effort: { reference_reader: "high" }, timeout_ms: 60_000, max_external_spend_usd: 0,
    allowance_evidence: allowanceEvidence };
  const env = (settings) => ({ INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(settings),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: randomBytes(32).toString("base64"),
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: "/tmp/synthetic-exchange",
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: randomBytes(32).toString("base64") });
  const codex = loadJournalInferencePortFromEnvironment(env(route), { caseId: "synthetic-case" });
  assert.equal(codex.capabilities().transport, "codex_exec_exchange");
  assert.equal(codex.capabilities().fresh_context_per_generate, true);
  assert.equal(codex.capabilities().authenticated_execution_profile_per_generate, true);
  assert.equal(codex.capabilities().execution_profile_evidence, "codex_exec_request_pinned");
  assert.throws(() => loadJournalInferencePortFromEnvironment(env({ ...route, model: "GPT-6 Sol" }), { caseId: "synthetic-case" }),
    { code: "JOURNAL_CODEX_MODEL_INVALID" });
  assert.throws(() => loadJournalInferencePortFromEnvironment(env({ ...route, role_effort: { unknown_role: "high" } }), { caseId: "synthetic-case" }),
    { code: "JOURNAL_CODEX_ROLE_EFFORT_INVALID" });
  assert.throws(() => loadJournalInferencePortFromEnvironment(env(route), { caseId: "synthetic-case", hardestLane: { enabled: true } }),
    { code: "HARDEST_LANE_ROUTE_UNAVAILABLE" });
  const chat = loadJournalInferencePortFromEnvironment(env({ ...route, provider: "chatgpt_connector_exchange", model: "GPT-5.6 Sol", effort: "Pro" }), { caseId: "synthetic-case" });
  assert.equal(chat.capabilities().fresh_context_per_generate, false);
  assert.equal(chat.capabilities().authenticated_execution_profile_per_generate, false);
});

test("doctor authorizes Codex execution evidence without relaxing ChatGPT blockers", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-codex-doctor-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(path.join(base, "private", "source"), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from("Synthetic journal text.\n");
  await fs.writeFile(path.join(base, "private", "source", "journal.txt"), bytes, { mode: 0o600 });
  const config = path.join(base, "private", "run.json");
  await fs.writeFile(config, JSON.stringify({ schema_version: 1, mode: "synthetic_private_doctor",
    source: { relative_path: "private/source/journal.txt", sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length },
    target_profile: { case_id: "synthetic-case" }, private_runtime_root: path.join(base, "runtime"),
    execution_root: path.join(base, "execution"), existing_grant_ref: "synthetic:grant", max_external_spend_usd: 0 }), { mode: 0o600 });
  const root = path.join(base, "exchange");
  await fs.mkdir(root, { mode: 0o700 });
  const route = { schema_version: 1, provider: "codex_exec_exchange", route_ref: "route:codex", model: "gpt-6-sol",
    effort: "medium", timeout_ms: 60_000, max_external_spend_usd: 0, allowance_evidence: allowanceEvidence };
  const environment = { INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(route),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: randomBytes(32).toString("base64"),
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: randomBytes(32).toString("base64") };
  const codex = await configuredJournalDoctorReport(config, environment);
  assert.equal(codex.capabilities.inference_route, "authorized");
  assert.equal(codex.blockers.includes("JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED"), false);
  const chat = await configuredJournalDoctorReport(config, { ...environment,
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({ ...route, provider: "chatgpt_connector_exchange",
      model: "GPT-5.6 Sol", effort: "Pro" }) });
  assert.equal(chat.capabilities.inference_route, "unavailable");
  assert.ok(chat.blockers.includes("JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED"));
  assert.ok(chat.blockers.includes("INFERENCE_ISOLATION_UNAVAILABLE"));
});

test("exact Codex arguments disable all forbidden features and pass only secret file location", () => {
  const record = { work_id: "job:synthetic-codex", model: "gpt-6-sol", effort: "high" };
  const args = codexExecArgs({ record, runDir: "/tmp/run", configPath: "/tmp/config", root: "/tmp/exchange", secretFile: "/tmp/secret" });
  const mcpCli = path.resolve(new URL("../src/cli/journal-work-mcp.mjs", import.meta.url).pathname);
  assert.deepEqual(args, ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config",
    "--ignore-rules", "--strict-config", "-s", "read-only", "-C", "/tmp/run", "-m", "gpt-6-sol",
    "-c", 'model_reasoning_effort="high"', "-c", 'web_search="disabled"', "-c", 'service_tier="default"',
    "-c", 'approval_policy="never"', "-c", "project_doc_max_bytes=0", "-c", "project_root_markers=[]",
    "-c", `mcp_servers.journal.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.journal.args=${JSON.stringify([mcpCli, "--config", "/tmp/config", "--principal", "codex-standard", "--tier", "standard", "--stage-dir", "/tmp/run/stage"])}`,
    "-c", 'mcp_servers.journal.env={INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT="/tmp/exchange",INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE="/tmp/secret"}',
    "-c", 'mcp_servers.journal.default_tools_approval_mode="approve"',
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "Private InnerSignal journal work item job:synthetic-codex. Call get_journal_work_packet with this work_id, follow its instruction using only its packet, then submit your JSON answer with submit_journal_work_result. If it lists schema problems, fix them and submit again. Reply only: done."
  ]);
  assert.deepEqual(args.filter((item, index) => args[index - 1] === "--disable"), [...CODEX_DISABLED_FEATURES]);
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('service_tier="default"'));
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('mcp_servers.journal.default_tools_approval_mode="approve"'));
  assert.ok(args.at(-1).includes(record.work_id));
  assert.equal(args.join(" ").includes(SENTINEL), false);
  const defaults = parseJournalCodexWorkerArgs(["--config", "/tmp/config", "--codex-home", "/tmp/home",
    "--work-dir", "/tmp/work"]);
  assert.equal(defaults.limitBackoffMs, 1_800_000);
  assert.equal(defaults.importTimeoutMs, null);
  assert.deepEqual(defaults.importEnvNames, []);
  assert.throws(() => parseJournalCodexWorkerArgs(["--config", "/tmp/config", "--codex-home", "/tmp/home"]),
    { code: "JOURNAL_CODEX_OPTION_INVALID" });
});

test("realistic Codex event sequence is admitted and error items are refused", () => {
  const accepted = codexEventReader("job:synthetic-events");
  const emit = (reader, event) => reader.accept(JSON.stringify(event));
  emit(accepted, { type: "thread.started", thread_id: "12345678" });
  emit(accepted, { type: "turn.started" });
  for (const item of [{ type: "mcp_tool_call", server: "journal", tool: "get_journal_work_packet",
    arguments: { work_id: "job:synthetic-events" }, status: "completed" },
    { type: "mcp_tool_call", server: "journal", tool: "submit_journal_work_result",
      arguments: { work_id: "job:synthetic-events", output: SENTINEL }, status: "completed" },
    { type: "agent_message", text: SENTINEL }]) {
    for (const type of ["item.started", "item.updated", "item.completed"]) emit(accepted, { type, item });
  }
  emit(accepted, { type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 1,
    cache_write_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 1 } });
  assert.equal(accepted.state.bad, null);
  assert.equal(accepted.state.completed, true);
  assert.equal(accepted.state.packetBeforeLastSubmit, true);
  assert.deepEqual(accepted.state.usage, { input_tokens: 3, cached_input_tokens: 1,
    output_tokens: 2, reasoning_output_tokens: 1 });
  assert.equal(JSON.stringify(accepted.state).includes(SENTINEL), false);
  for (const sequence of [
    [{ tool: "submit_journal_work_result", work_id: "job:synthetic-events" }],
    [{ tool: "get_journal_work_packet", work_id: "job:synthetic-other" },
      { tool: "submit_journal_work_result", work_id: "job:synthetic-events" }],
    [{ tool: "get_journal_work_packet", work_id: "job:synthetic-events", status: "failed" },
      { tool: "submit_journal_work_result", work_id: "job:synthetic-events" }],
    [{ tool: "submit_journal_work_result", work_id: "job:synthetic-events" },
      { tool: "get_journal_work_packet", work_id: "job:synthetic-events" }]
  ]) {
    const reader = codexEventReader("job:synthetic-events");
    for (const entry of sequence) emit(reader, { type: "item.completed", item: {
      type: "mcp_tool_call", server: "journal", tool: entry.tool,
      arguments: { work_id: entry.work_id, output: SENTINEL }, status: entry.status ?? "completed" } });
    assert.equal(reader.state.packetBeforeLastSubmit, false);
    assert.equal(JSON.stringify(reader.state).includes(SENTINEL), false);
  }
  const rerouted = codexEventReader();
  emit(rerouted, { type: "item.started", item: { type: "error", message: "model rerouted" } });
  assert.equal(rerouted.state.bad, "ITEM_ERROR");
  for (const type of ["web_search", "command_execution", "mcp_tool_call"]) {
    const reader = codexEventReader();
    reader.accept(JSON.stringify({ type: "item.completed", item: { type, server: "outside", tool: "other", text: SENTINEL } }));
    assert.equal(reader.state.bad, "ITEM_FORBIDDEN");
    assert.equal(JSON.stringify(reader.state).includes(SENTINEL), false);
  }
  const reader = codexEventReader();
  reader.accept(JSON.stringify({ type: "error", message: "HTTP 429; reset in 1 seconds " + SENTINEL }));
  assert.equal(reader.state.bad, "EVENT_ERROR");
  assert.equal(reader.state.finalErrorLimited, true);
  assert.ok(reader.state.resetAt > Date.now());
  assert.equal(JSON.stringify(reader.state).includes(SENTINEL), false);
});

test("staging is sealed, first-write-wins, and rejects unsafe directories; execution receipt is tagged", async (t) => {
  const f = await setup(t);
  const stage = path.join(f.base, "stage"); await fs.mkdir(stage, { mode: 0o700 });
  await assert.rejects(f.exchange.stageResult({ stageDir: stage, workId: "job:synthetic-stage", output: { ok: true } }),
    { code: "JOURNAL_WORK_PACKET_NOT_FETCHED" });
  await f.exchange.markPacketFetched({ stageDir: stage, workId: "job:synthetic-stage" });
  await f.exchange.stageResult({ stageDir: stage, workId: "job:synthetic-stage", output: { ok: true } });
  assert.deepEqual(await f.exchange.stageResult({ stageDir: stage, workId: "job:synthetic-stage", output: { ok: false } }),
    { stored: true, already: true });
  const staged = await fs.readFile(path.join(stage, `${journalWorkFileKey("job:synthetic-stage")}.json`), "utf8");
  assert.equal(staged.includes("ok"), false);
  await fs.mkdir(path.join(f.root, "inbox"), { mode: 0o700 });
  await fs.copyFile(path.join(stage, `${journalWorkFileKey("job:synthetic-stage")}.json`),
    path.join(f.root, "inbox", `${journalWorkFileKey("job:synthetic-stage")}.json`));
  await assert.rejects(f.exchange.readResult("job:synthetic-stage"), { code: "JOURNAL_WORK_ENTRY_INVALID" });
  await fs.unlink(path.join(f.root, "inbox", `${journalWorkFileKey("job:synthetic-stage")}.json`));
  const execution = { profile_evidence: "codex_exec_request_pinned", effective_model_profile: "gpt-6-sol",
    effective_effort: "high", request_context_id: "codex-thread:12345678" };
  await fs.unlink(path.join(stage, `${journalWorkFileKey("job:synthetic-stage")}.fetched`));
  await assert.rejects(f.exchange.promoteStaged({ stageDir: stage, workId: "job:synthetic-stage",
    subject: "local:codex-standard", execution }), { code: "JOURNAL_WORK_PACKET_NOT_FETCHED" });
  await f.exchange.markPacketFetched({ stageDir: stage, workId: "job:synthetic-stage" });
  await f.exchange.promoteStaged({ stageDir: stage, workId: "job:synthetic-stage", subject: "local:codex-standard", execution });
  const receipt = (await f.exchange.readResult("job:synthetic-stage")).receipt;
  assert.deepEqual(Object.fromEntries(Object.keys(execution).map((key) => [key, receipt[key]])), execution);
  await assert.rejects(fs.access(path.join(stage, `${journalWorkFileKey("job:synthetic-stage")}.json`)));
  await assert.rejects(fs.access(path.join(stage, `${journalWorkFileKey("job:synthetic-stage")}.fetched`)));
  const loose = path.join(f.base, "loose"); await fs.mkdir(loose, { mode: 0o750 });
  await assert.rejects(f.exchange.stageResult({ stageDir: loose, workId: "job:synthetic-other", output: {} }),
    { code: "JOURNAL_WORK_STAGE_DIR_INSECURE" });
  const link = path.join(f.base, "link"); await fs.symlink(stage, link);
  await assert.rejects(f.exchange.stageResult({ stageDir: link, workId: "job:synthetic-other", output: {} }),
    { code: "JOURNAL_WORK_STAGE_DIR_INSECURE" });
  assert.throws(() => parseJournalWorkMcpArgs(["--config", f.configPath, "--principal", "codex-standard", "--tier", "hardest", "--stage-dir", stage]));
});

test("secret file refuses links, loose modes, and competing inline settings", async (t) => {
  const f = await setup(t);
  assert.equal((await journalWorkExchangeSecret(f.environment)).trim(), f.secret);
  await fs.chmod(f.secretFile, 0o640);
  await assert.rejects(journalWorkExchangeSecret(f.environment), { code: "JOURNAL_WORK_EXCHANGE_SECRET_FILE_INSECURE" });
  await fs.chmod(f.secretFile, 0o600);
  const link = path.join(f.base, "secret-link"); await fs.symlink(f.secretFile, link);
  await assert.rejects(journalWorkExchangeSecret({ INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: link }),
    { code: "JOURNAL_WORK_EXCHANGE_SECRET_FILE_INVALID" });
  await assert.rejects(journalWorkExchangeSecret({ ...f.environment, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: f.secret }),
    { code: "JOURNAL_WORK_EXCHANGE_SECRET_CONFLICT" });
});

test("worker round trip admits a request-pinned Codex receipt and keeps content out of output", async (t) => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.base, "AGENTS.md"), "synthetic planted instruction");
  await fs.mkdir(path.join(f.base, ".git"));
  const alias = path.join(f.base, "alias");
  await fs.symlink(f.base, alias);
  const stale = path.join(f.workDir, "inner-signal-codex-OLD");
  await fs.mkdir(stale, { mode: 0o700 });
  await fs.writeFile(path.join(stale, "worker.lock"), "", { mode: 0o600 });
  const old = new Date(Date.now() - 2 * 3_600_000);
  await fs.utimes(stale, old, old);
  const port = createExchangeJournalInferencePort({ exchange: f.exchange, caseId: "synthetic-case", receiptKey: randomBytes(32),
    routeRef: "route:codex", allowanceEvidence, model: "gpt-6-sol", effort: "medium", roleEffort: { reference_reader: "high" },
    executionAttestation: "codex_exec", waitMs: 1, pollMs: 1 });
  const call = referenceCall();
  await assert.rejects(port.invoke(call), { code: "COMPLETION_UNKNOWN" });
  const dispatch = await f.exchange.listDispatch();
  assert.equal(dispatch[0].effort, "high");
  assert.equal(dispatch[0].work_id, journalExchangeWorkId(call.operationKey));
  const fake = await f.fake("reference");
  const workerCli = path.resolve(new URL("../src/cli/journal-codex-worker.mjs", import.meta.url).pathname);
  const workerArgs = f.args(fake, ["--once"]);
  workerArgs[workerArgs.indexOf("--work-dir") + 1] = path.join(alias, "work");
  const worker = spawnSync(process.execPath, [workerCli, ...workerArgs], {
    env: f.environment, encoding: "utf8", timeout: 20_000
  });
  assert.equal(worker.status, 0, worker.stderr);
  await assert.rejects(fs.access(stale));
  assert.equal(worker.stdout.includes(SENTINEL), false);
  assert.equal(worker.stderr.includes(SENTINEL), false);
  const completed = await port.getCompletion(call.operationKey);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output, ANSWER);
  assert.equal(completed.receipt.execution_profile_evidence, "codex_exec_request_pinned");
  assert.match(completed.receipt.request_context_id, /^codex-thread:[0-9a-f-]{36}$/u);
  const trace = JSON.parse((await fs.readFile(f.trace, "utf8")).split("\n")[0]);
  assert.deepEqual(trace.keys, ["CODEX_HOME", "HOME", "LANG", "PATH"]);
  assert.ok(trace.args.includes('model_reasoning_effort="high"'));
  assert.equal(JSON.stringify(trace.args).includes(f.secret), false);
  const output = await fs.readFile(f.log, "utf8");
  assert.equal(output.includes(SENTINEL), false);
  assert.equal(output.includes(f.secret), false);
  assert.equal((await f.logs())[0].outcome, "answered");
  const unverified = referenceCall("job:synthetic-codex-no-execution");
  await assert.rejects(port.invoke(unverified), { code: "COMPLETION_UNKNOWN" });
  await f.exchange.submitResult({ workId: journalExchangeWorkId(unverified.operationKey), output: ANSWER, subject: "synthetic" });
  assert.equal((await port.getCompletion(unverified.operationKey)).status, "invalid_output");
});

test("a completed turn with a transient 429 in stderr is admitted and default logs stay content free", async (t) => {
  const f = await setup(t);
  await f.publish("job:synthetic-transient");
  const fake = await f.fake("transient429");
  const captured = [];
  const args = f.args(fake, ["--once"]);
  args.splice(args.indexOf("--log"), 2);
  await runJournalCodexWorker(args, { environment: f.environment, stderr: { write: (chunk) => captured.push(chunk) } });
  const lines = captured.join("");
  assert.equal(lines.includes(SENTINEL), false);
  assert.equal(JSON.parse(lines.trim()).outcome, "answered");
  assert.ok(await f.exchange.readResult("job:synthetic-transient"));
});

test("worker rejects every disallowed execution without leaving an answer or stage", async (t) => {
  const reasons = { submit_only: "rejected:PACKET_NOT_FETCHED", fetch_other: "rejected:PACKET_NOT_FETCHED",
    failed_fetch: "rejected:PACKET_NOT_FETCHED", fetch_after_submit: "rejected:PACKET_NOT_FETCHED",
    web_search: "rejected:ITEM_FORBIDDEN", command_execution: "rejected:ITEM_FORBIDDEN",
    other_server: "rejected:ITEM_FORBIDDEN", other_tool: "rejected:ITEM_FORBIDDEN",
    nonzero: "rejected:EXIT_NONZERO", missing_thread: "rejected:THREAD_COUNT",
    two_threads: "rejected:THREAD_COUNT", missing_turn: "rejected:TURN_INCOMPLETE",
    turn_failed: "rejected:TURN_FAILED", error_event: "rejected:EVENT_ERROR",
    error_item: "rejected:ITEM_ERROR", timeout: "timeout" };
  for (const [scenario, reason] of Object.entries(reasons)) {
    await t.test(scenario, async (subtest) => {
      const f = await setup(subtest);
      const workId = `job:synthetic-${scenario}`;
      await f.publish(workId);
      if (scenario === "fetch_other") await f.exchange.publishWork(manualWork("job:synthetic-other-fetch"));
      const fake = await f.fake(scenario);
      await runJournalCodexWorker(f.args(fake, ["--once", "--max-items", "1", "--timeout-ms", scenario === "timeout" ? "500" : "20000"]),
        { environment: f.environment });
      assert.equal(await f.exchange.readResult(workId), null);
      const logText = await fs.readFile(f.log, "utf8");
      assert.equal(logText.includes(SENTINEL), false);
      assert.equal((await f.logs())[0].outcome, reason);
      const trace = await fs.readFile(f.trace, "utf8").catch(() => "");
      if (scenario === "timeout") assert.ok(trace, "the fake run must start before the timeout");
      if (trace) {
        const entries = trace.trim().split("\n").map(JSON.parse);
        assert.equal(entries.find((entry) => entry.phase === "staged")?.exists,
          !["submit_only", "fetch_other", "failed_fetch", "fetch_after_submit"].includes(scenario),
          "only fetched packets can yield sealed answers");
        if (["submit_only", "fetch_other", "failed_fetch", "fetch_after_submit"].includes(scenario)) {
          assert.ok(entries.find((entry) => entry.phase === "staged")?.replies.includes("JOURNAL_WORK_PACKET_NOT_FETCHED"));
        }
        const args = entries[0].args;
        await assert.rejects(fs.access(args[args.indexOf("-C") + 1]));
      }
      if (scenario === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, 1600));
        await assert.rejects(fs.access(path.join(f.base, "survived")));
      }
    });
  }
});

test("worker refuses contaminated Codex homes", async (t) => {
  const f = await setup(t);
  const fake = await f.fake();
  for (const name of ["AGENTS.md", "AGENTS.override.md", "config.toml"]) {
    await fs.writeFile(path.join(f.home, name), "synthetic", { mode: 0o600 });
    await assert.rejects(runJournalCodexWorker(f.args(fake, ["--once"]), { environment: f.environment }),
      { code: "JOURNAL_CODEX_HOME_CONTAMINATED" });
    await fs.unlink(path.join(f.home, name));
  }
  await fs.mkdir(path.join(f.home, "skills"), { mode: 0o700 });
  await fs.mkdir(path.join(f.home, "skills", ".system"), { mode: 0o700 });
  await fs.writeFile(path.join(f.home, "skills", ".system", ".codex-system-skills.marker"), "synthetic");
  await runJournalCodexWorker(f.args(fake, ["--once"]), { environment: f.environment });
  await fs.writeFile(path.join(f.home, "skills", "synthetic.txt"), "synthetic");
  await assert.rejects(runJournalCodexWorker(f.args(fake, ["--once"]), { environment: f.environment }),
    { code: "JOURNAL_CODEX_HOME_CONTAMINATED" });
});

test("worker honors concurrency three for five items", async (t) => {
  const f = await setup(t);
  for (let index = 0; index < 5; index += 1) await f.publish(`job:synthetic-parallel-${index}`);
  const fake = await f.fake("slow");
  await runJournalCodexWorker(f.args(fake, ["--once", "--concurrency", "3"]), { environment: f.environment });
  const entries = (await fs.readFile(f.trace, "utf8")).trim().split("\n").map(JSON.parse);
  let overlap = 0, maximum = 0;
  for (const item of entries.filter((entry) => ["start", "end"].includes(entry.phase))
    .sort((a, b) => a.at - b.at || (a.phase === "end" ? -1 : 1))) {
    overlap += item.phase === "start" ? 1 : -1;
    maximum = Math.max(maximum, overlap);
  }
  assert.ok(maximum > 1 && maximum <= 3);
  assert.equal((await f.logs()).filter((item) => item.outcome === "answered").length, 5);
});

test("import command runs without a shell and records only exit code and duration", async (t) => {
  const f = await setup(t);
  f.environment.SYNTHETIC_IMPORT_TOKEN = "allowed";
  await f.publish("job:synthetic-import");
  const fake = await f.fake();
  const marker = path.join(f.base, "import-count");
  const release = path.join(f.base, "release-import");
  const command = [process.execPath, "-e",
    "const fs=require('node:fs'); if(process.env.SYNTHETIC_IMPORT_TOKEN!=='allowed'||process.env.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE)process.exit(2); const first=!fs.existsSync(process.argv[1]); fs.appendFileSync(process.argv[1], 'x'); if(first){const poll=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(poll);process.exit(0)}},10)}", marker, release];
  const worker = runJournalCodexWorker(f.args(fake, ["--once", "--import-command-json", JSON.stringify(command),
    "--import-env-names", "SYNTHETIC_IMPORT_TOKEN", "--import-timeout-ms", "20000"]),
    { environment: f.environment });
  let waitingError;
  try {
    await until(async () => (await fs.readFile(f.log, "utf8").catch(() => "")).includes('"outcome":"answered"'));
  } catch (error) { waitingError = error; }
  await fs.writeFile(release, "synthetic");
  await worker;
  if (waitingError) throw waitingError;
  assert.equal(await fs.readFile(marker, "utf8"), "xx");
  const records = await f.logs();
  assert.equal(records.filter((item) => item.outcome === "answered").length, 1);
  const imports = records.filter((item) => item.kind === "import");
  assert.equal(imports.length, 2);
  for (const item of imports) {
    assert.equal(item.exit_code, 0);
    assert.equal(typeof item.duration_ms, "number");
    assert.deepEqual(Object.keys(item).sort(), ["at", "duration_ms", "exit_code", "kind"]);
  }
});

test("usage limit parses Codex's local reset messages and does not consume item attempts", async (t) => {
  const now = new Date(2026, 9, 3, 15, 44, 0).getTime();
  assert.equal(parseCodexResetTime("You've hit your usage limit. Try again at 3:45 PM.", now),
    new Date(2026, 9, 3, 15, 45, 0).getTime());
  assert.equal(parseCodexResetTime("You've hit your usage limit. Try again at Oct 3rd, 2026 9:00 AM.", now), null);
  assert.equal(parseCodexResetTime("You've hit your usage limit. Try again at Oct 4th, 2026 9:00 AM.", now),
    new Date(2026, 9, 4, 9, 0).getTime());
  const f = await setup(t);
  await f.publish("job:synthetic-limit");
  const fake = await f.fake("limit_then_success");
  await runJournalCodexWorker(f.args(fake, ["--once", "--max-items", "4", "--concurrency", "1", "--limit-backoff-ms", "150"]),
    { environment: f.environment });
  const trace = (await fs.readFile(f.trace, "utf8")).trim().split("\n").map(JSON.parse).filter((item) => item.phase === "start");
  assert.equal(trace.length, 4);
  assert.ok(trace[1].at - trace[0].at >= 100);
  assert.deepEqual((await f.logs()).filter((item) => item.work_id).map((item) => item.outcome),
    ["limited", "limited", "limited", "answered"]);
});

test("once waits through a limit and finishes its initial items without counting limited runs", async (t) => {
  const f = await setup(t);
  await f.publish("job:synthetic-once-a");
  await f.publish("job:synthetic-once-b");
  const fake = await f.fake("limit_then_success");
  await runJournalCodexWorker(f.args(fake, ["--once", "--max-items", "2", "--concurrency", "1",
    "--limit-backoff-ms", "40"]), { environment: f.environment });
  const logs = (await f.logs()).filter((item) => item.work_id);
  assert.equal(logs.filter((item) => item.outcome === "limited").length, 3);
  assert.equal(logs.filter((item) => item.outcome === "answered").length, 2);
  assert.ok(await f.exchange.readResult("job:synthetic-once-a"));
  assert.ok(await f.exchange.readResult("job:synthetic-once-b"));
});

test("usage limits stop after twelve retries for one item", async (t) => {
  const f = await setup(t);
  await f.publish("job:synthetic-limit-cap");
  const fake = await f.fake("limit_default");
  await runJournalCodexWorker(f.args(fake, ["--once", "--limit-backoff-ms", "1"]), { environment: f.environment });
  assert.equal((await f.logs()).filter((item) => item.outcome === "limited").length, 12);
  assert.equal(await f.exchange.readResult("job:synthetic-limit-cap"), null);
});

test("SIGTERM stops scheduling, wakes backoff, and records stopped without charging an attempt", async (t) => {
  const f = await setup(t);
  await f.publish("job:synthetic-signal-a");
  await f.publish("job:synthetic-signal-b");
  const slow = await f.fake("timeout");
  const running = spawnWorker(f, slow, ["--concurrency", "1", "--timeout-ms", "20000"]);
  t.after(() => { if (running.child.exitCode === null) running.child.kill("SIGKILL"); });
  await until(async () => (await fs.readFile(f.trace, "utf8").catch(() => "")).includes('"phase":"start"'));
  running.child.kill("SIGTERM");
  assert.equal(await running.closed, 143);
  const starts = (await fs.readFile(f.trace, "utf8")).match(/"phase":"start"/gu) ?? [];
  assert.equal(starts.length, 1);
  assert.equal((await f.logs()).filter((item) => item.work_id)[0].outcome, "stopped");
  assert.equal((await fs.readdir(f.workDir)).length, 0);

  const limited = await f.fake("limit_default");
  const backedOff = spawnWorker(f, limited, ["--concurrency", "1", "--limit-backoff-ms", "60000"]);
  t.after(() => { if (backedOff.child.exitCode === null) backedOff.child.kill("SIGKILL"); });
  await until(async () => (await f.logs()).some((item) => item.outcome === "limited"));
  const at = Date.now();
  backedOff.child.kill("SIGTERM");
  assert.equal(await backedOff.closed, 143);
  assert.ok(Date.now() - at < 3000);
  assert.equal((await fs.readdir(f.workDir)).length, 0);
});

test("stale sweep preserves a locked sibling and removes it after the lock releases", async (t) => {
  const f = await setup(t);
  const sibling = path.join(f.workDir, "inner-signal-codex-LIVE");
  await fs.mkdir(sibling, { mode: 0o700 });
  const lock = path.join(sibling, "worker.lock");
  await fs.writeFile(lock, "", { mode: 0o600 });
  const holder = spawn("flock", ["-n", lock, "sh", "-c", "printf 'ready\\n'; cat >/dev/null"],
    { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => { holder.stdin.end(); if (holder.exitCode === null) holder.kill("SIGKILL"); });
  await new Promise((resolve, reject) => {
    holder.stdout.once("data", resolve);
    holder.once("error", reject);
    holder.once("close", () => reject(new Error("Synthetic lock was not acquired")));
  });
  const old = new Date(Date.now() - 2 * 3_600_000);
  await fs.utimes(sibling, old, old);
  const fake = await f.fake();
  await runJournalCodexWorker(f.args(fake, ["--once"]), { environment: f.environment });
  assert.ok((await fs.stat(sibling)).isDirectory());
  holder.stdin.end();
  await new Promise((resolve) => holder.once("close", resolve));
  await runJournalCodexWorker(f.args(fake, ["--once"]), { environment: f.environment });
  await assert.rejects(fs.access(sibling));
});
