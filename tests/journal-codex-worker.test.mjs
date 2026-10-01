import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalWorkExchange, journalWorkExchangeSecret, journalWorkFileKey } from "../src/journal-import/work-exchange.mjs";
import { createExchangeJournalInferencePort, journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";
import { loadJournalInferencePortFromEnvironment } from "../src/journal-import/provider-runtime.mjs";
import { codexEventReader, codexExecArgs, CODEX_DISABLED_FEATURES, parseJournalCodexWorkerArgs,
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
  await fs.mkdir(root, { mode: 0o700 });
  await fs.mkdir(home, { mode: 0o700 });
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
  const args = (fake, extra = []) => ["--config", configPath, "--codex-home", home, "--codex-bin", fake,
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
const calls = ["get_journal_work_packet", "submit_journal_work_result"].map((name, index) => ({
  jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name, arguments: index ? { work_id: workId, output: answer } : { work_id: workId } }
}));
const mcp = spawnSync(process.execPath, mcpArgs, { env, input: calls.map(JSON.stringify).join(String.fromCharCode(10)) + String.fromCharCode(10), encoding: "utf8" });
if (mcp.error) process.exit(7);
if (mcp.stderr.includes(${JSON.stringify(SENTINEL)})) process.exit(11);
if (mcp.status !== 0) process.exit(7);
const replies = mcp.stdout.trim().split(String.fromCharCode(10)).map(JSON.parse);
if (replies[0].result.structuredContent.status !== "ready" || replies[1].result.structuredContent.stored !== true) process.exit(8);
if (scenario === "timeout") {
  setInterval(() => {}, 1000);
} else {
  if (scenario === "slow") await new Promise(resolve => setTimeout(resolve, 150));
  if (scenario !== "missing_thread") console.log(JSON.stringify({ type: "thread.started", thread_id: randomUUID() }));
  const itemType = ({ web_search: "web_search", command_execution: "command_execution", other_server: "mcp_tool_call", other_tool: "mcp_tool_call" })[scenario] || "mcp_tool_call";
  console.log(JSON.stringify({ type: "item.completed", item: { type: itemType,
    server: scenario === "other_server" ? "outside" : "journal",
    tool: scenario === "other_tool" ? "other_tool" : "submit_journal_work_result",
    text: ${JSON.stringify(SENTINEL)} } }));
  if (scenario === "turn_failed") console.log(JSON.stringify({ type: "turn.failed" }));
  else if (scenario.startsWith("limit")) console.log(JSON.stringify({ type: "error", message: scenario === "limit_reset" ? "HTTP 429; reset in 1 seconds" : "usage limit" }));
  else console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 2, reasoning_output_tokens: 1 } }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ${JSON.stringify(SENTINEL)} } }));
  fs.appendFileSync(trace, JSON.stringify({ phase: "end", at: Date.now() }) + String.fromCharCode(10));
  if (scenario === "nonzero") process.exit(9);
}
`;
    await fs.writeFile(filename, script, { mode: 0o700 });
    return filename;
  }
  const logs = async () => (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
  return { base, root, home, secret, secretFile, configPath, log, trace, exchange, environment, args, publish, fake, logs };
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
  const port = (executionAttestation) => createExchangeJournalInferencePort({
    exchange: { async removeStaleTemporaries() {} }, caseId: "synthetic-case", receiptKey: randomBytes(32),
    routeRef: "route:codex", allowanceEvidence, model: "gpt-6-sol", effort: "medium", executionAttestation
  });
  const codex = await configuredJournalDoctorReport(config, {}, { inferencePortLoader: () => port("codex_exec") });
  assert.equal(codex.capabilities.inference_route, "authorized");
  assert.equal(codex.blockers.includes("JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED"), false);
  const chat = await configuredJournalDoctorReport(config, {}, { inferencePortLoader: () => port(null) });
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
    "-c", 'approval_policy="never"', "-c", `mcp_servers.journal.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.journal.args=${JSON.stringify([mcpCli, "--config", "/tmp/config", "--principal", "codex-standard", "--stage-dir", "/tmp/run/stage"])}`,
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
  assert.equal(parseJournalCodexWorkerArgs(["--config", "/tmp/config", "--codex-home", "/tmp/home"]).limitBackoffMs, 1_800_000);
});

test("event admission keeps only metadata and rejects forbidden items and missing thread", () => {
  for (const type of ["web_search", "command_execution", "mcp_tool_call"]) {
    const reader = codexEventReader();
    reader.accept(JSON.stringify({ type: "item.completed", item: { type, server: "outside", tool: "other", text: SENTINEL } }));
    assert.equal(reader.state.bad, "ITEM_FORBIDDEN");
    assert.equal(JSON.stringify(reader.state).includes(SENTINEL), false);
  }
  const reader = codexEventReader();
  reader.accept(JSON.stringify({ type: "error", message: "HTTP 429; reset in 1 seconds " + SENTINEL }));
  assert.equal(reader.state.limited, true);
  assert.ok(reader.state.resetAt > Date.now());
  assert.equal(JSON.stringify(reader.state).includes(SENTINEL), false);
});

test("staging is sealed, first-write-wins, and rejects unsafe directories; execution receipt is tagged", async (t) => {
  const f = await setup(t);
  const stage = path.join(f.base, "stage"); await fs.mkdir(stage, { mode: 0o700 });
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
  await f.exchange.promoteStaged({ stageDir: stage, workId: "job:synthetic-stage", subject: "local:codex-standard", execution });
  const receipt = (await f.exchange.readResult("job:synthetic-stage")).receipt;
  assert.deepEqual(Object.fromEntries(Object.keys(execution).map((key) => [key, receipt[key]])), execution);
  await assert.rejects(fs.access(path.join(stage, `${journalWorkFileKey("job:synthetic-stage")}.json`)));
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
  const worker = spawnSync(process.execPath, [workerCli, ...f.args(fake, ["--once"])], {
    env: f.environment, encoding: "utf8", timeout: 20_000
  });
  assert.equal(worker.status, 0, worker.stderr);
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

test("worker rejects every disallowed execution without leaving an answer or stage", async (t) => {
  for (const scenario of ["web_search", "command_execution", "other_server", "other_tool", "nonzero", "missing_thread", "turn_failed", "timeout"]) {
    await t.test(scenario, async (subtest) => {
      const f = await setup(subtest);
      const workId = `job:synthetic-${scenario}`;
      await f.publish(workId);
      const fake = await f.fake(scenario);
      await runJournalCodexWorker(f.args(fake, ["--once", "--max-items", "1", "--timeout-ms", scenario === "timeout" ? "500" : "20000"]),
        { environment: f.environment });
      assert.equal(await f.exchange.readResult(workId), null);
      assert.equal((await f.logs())[0].outcome.startsWith("rejected:") || (await f.logs())[0].outcome === "timeout", true);
      const trace = await fs.readFile(f.trace, "utf8").catch(() => "");
      if (scenario === "timeout") assert.ok(trace, "the fake run must start before the timeout");
      if (trace) {
        const args = JSON.parse(trace.split("\n")[0]).args;
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
  for (const name of ["AGENTS.md", "config.toml"]) {
    await fs.writeFile(path.join(f.home, name), "synthetic", { mode: 0o600 });
    await assert.rejects(runJournalCodexWorker(f.args(fake, ["--once"]), { environment: f.environment }),
      { code: "JOURNAL_CODEX_HOME_CONTAMINATED" });
    await fs.unlink(path.join(f.home, name));
  }
});

test("worker honors concurrency three for five items", async (t) => {
  const f = await setup(t);
  for (let index = 0; index < 5; index += 1) await f.publish(`job:synthetic-parallel-${index}`);
  const fake = await f.fake("slow");
  await runJournalCodexWorker(f.args(fake, ["--once", "--concurrency", "3"]), { environment: f.environment });
  const entries = (await fs.readFile(f.trace, "utf8")).trim().split("\n").map(JSON.parse);
  let overlap = 0, maximum = 0;
  for (const item of entries.sort((a, b) => a.at - b.at || (a.phase === "end" ? -1 : 1))) {
    overlap += item.phase === "start" ? 1 : -1;
    maximum = Math.max(maximum, overlap);
  }
  assert.ok(maximum > 1 && maximum <= 3);
  assert.equal((await f.logs()).filter((item) => item.outcome === "answered").length, 5);
});

test("import command runs without a shell and records only exit code and duration", async (t) => {
  const f = await setup(t);
  await f.publish("job:synthetic-import");
  const fake = await f.fake();
  const marker = path.join(f.base, "import-count");
  const command = [process.execPath, "-e",
    "const fs=require('node:fs'); fs.appendFileSync(process.argv[1], 'x'); setTimeout(()=>{}, 500)", marker];
  await runJournalCodexWorker(f.args(fake, ["--once", "--import-command-json", JSON.stringify(command)]),
    { environment: f.environment });
  assert.ok((await fs.readFile(marker, "utf8")).startsWith("x"));
  const records = await f.logs();
  assert.equal(records.filter((item) => item.outcome === "answered").length, 1);
  const imports = records.filter((item) => item.kind === "import");
  assert.ok(imports.length >= 1);
  for (const item of imports) {
    assert.equal(item.exit_code, 0);
    assert.equal(typeof item.duration_ms, "number");
    assert.deepEqual(Object.keys(item).sort(), ["at", "duration_ms", "exit_code", "kind"]);
  }
});

test("usage limit pauses new runs until reset and uses bounded backoff without reset", async (t) => {
  for (const scenario of ["limit_reset", "limit_default"]) {
    await t.test(scenario, async (subtest) => {
      const f = await setup(subtest);
      await f.publish("job:synthetic-limit");
      const fake = await f.fake(scenario);
      const started = Date.now();
      await runJournalCodexWorker(f.args(fake, ["--max-items", "2", "--concurrency", "1", "--limit-backoff-ms", "150"]),
        { environment: f.environment });
      const trace = (await fs.readFile(f.trace, "utf8")).trim().split("\n").map(JSON.parse).filter((item) => item.phase === "start");
      assert.equal(trace.length, 2);
      assert.ok(trace[1].at - trace[0].at >= (scenario === "limit_reset" ? 850 : 100));
      assert.ok(Date.now() - started >= (scenario === "limit_reset" ? 850 : 100));
      assert.deepEqual((await f.logs()).map((item) => item.outcome), ["limited", "limited"]);
    });
  }
});
