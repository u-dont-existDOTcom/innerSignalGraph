import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";
import { runJournalClaudeWorker } from "../src/journal-import/claude-worker.mjs";
import test from "node:test";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort, journalRoleInstruction } from "../src/journal-import/provider-port.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t, { pages = 1, visual = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-recalibrate-synthetic-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const privateDir = path.join(root, "private");
  await fs.mkdir(privateDir, { mode: 0o700 });
  const source = "Synthetic journal source for calibration retry.\n";
  await fs.writeFile(path.join(privateDir, "source.txt"), source, { mode: 0o600 });
  const config = { schema_version: 1, max_external_spend_usd: 0,
    execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(source), sha256: sha(source) },
    target_profile: { case_id: "synthetic-case" }, existing_grant_ref: "synthetic:grant",
    ...(visual ? { visual_hazard_pages: [1] } : {}) };
  const configPath = path.join(privateDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const parser = async () => ({
    source: { sha256: config.source.sha256, byte_length: config.source.bytes, mime_type: "text/plain" },
    parser: { version: "synthetic-recalibrate" },
    pages: Array.from({ length: pages }, (_, index) => ({ page_number: index + 1,
      representation_id: `synthetic:page:${index + 1}`, disposition: "readable", warnings: [],
      image_inventory: [], geometry: { width: 100, height: 100 } })),
    representations: Array.from({ length: pages }, (_, index) => {
      const text = `Synthetic page ${index + 1} has a blue cup.`;
      return { representation_id: `synthetic:page:${index + 1}`, text, utf8_byte_length: Buffer.byteLength(text) };
    })
  });
  const service = { verifyCaseAccess: async () => ({}) };
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
  return { config, configPath, service, parser, image,
    open: (port, resumed = false, environment = process.env) => openJournalExecutionRuntime({ config, configPath, service, environment,
      sourceParser: resumed ? () => assert.fail("source must not be reparsed") : parser,
      renderVisualPage: resumed ? () => assert.fail("visual page must not be reread") : async () => image,
      inferencePort: port }) };
}

function mockPort({ fail = false, calls }) {
  const review = (role, packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation,
    review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [],
    status: "sufficient_for_stated_scope" });
  const handlers = {
    visual_reader: (packet) => ({ schema_version: "1.0", source_page_id: packet.assigned_core_ids[0],
      regions: [{ region_id: "region:synthetic", bbox: [0, 0, 1, 1], kind: "text",
        transcription: "Synthetic image text.", non_graphic_description: null,
        interpretation_status: "readable", speaker_or_document_label: null, table_cells: [] }],
      page_complete: true, missing_or_uncertain_regions: [] }),
    reference_reader: () => ({ schema_version: "1.0", source_only_first_pass: true,
      reference_items: [], questions: [], unassessed_unit_ids: [] }),
    extractor: (packet) => ({ schema_version: "1.0", status: fail ? "incomplete" : "complete",
      assertions: [], entities: [], episodes: [],
      coverage: packet.core_units.map((unit) => ({ unit_id: unit.unit_id,
        disposition: fail ? "pending" : "no_assertion", assertion_local_ids: [],
        reason: "Synthetic calibration retry." })), requested_context: [] }),
    omission_checker: (packet) => review("omission_checker", packet),
    fidelity_auditor: (packet) => review("fidelity_auditor", packet),
    reconciler: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation,
      proposals: [], unresolved_ids: [], status: "proposals_complete" })
  };
  const base = createMockJournalInferencePort({ handlers });
  return { capabilities: base.capabilities, getCompletion: base.getCompletion,
    isAuthoritativeCompletion: base.isAuthoritativeCompletion, close: base.close,
    async invoke(input) {
      calls.push({ role: input.role, operationKey: input.operationKey, packet: input.packet });
      return base.invoke(input);
    } };
}

async function checkpoint(config) {
  return JSON.parse(await fs.readFile(path.join(config.execution_root, "state.json"), "utf8"));
}

async function withStore(config, action) {
  const state = await checkpoint(config);
  const key = await fs.readFile(path.join(config.execution_root, "staging.key"));
  const store = createPrivateJournalCorpusStore({ rootDir: config.execution_root,
    caseId: state.case_id, corpusId: state.corpus_id, corpusKey: key });
  try { return await action(store, state); }
  finally { store.close(); key.fill(0); }
}

async function readPlan(config) {
  return withStore(config, async (store, state) => JSON.parse((await store.reassembleOriginal(
    state.visual_plan_ref ?? state.parsed_ref)).toString("utf8")));
}

test("failed calibration retries with fresh answers and continues without rereading visual pages", async (t) => {
  const f = await fixture(t, { visual: true });
  const failedCalls = [];
  let runtime = await f.open(mockPort({ fail: true, calls: failedCalls }));
  const failed = await runtime.execute("run");
  assert.equal(failed.calibration, "failed");
  assert.equal(failed.calibration_failure.reason, "CALIBRATION_EXTRACTION_UNRESOLVED");
  assert.equal(failed.completed_visual_pages, 1);
  const before = await checkpoint(f.config);
  const firstCount = failedCalls.filter((call) => call.role === "extractor").length;
  assert.equal(firstCount, 3);
  const reset = await runtime.execute("recalibrate");
  assert.equal(reset.calibration, "not_run");
  assert.equal(reset.calibration_epoch, 1);
  assert.equal(reset.calibration_history_length, 1);
  assert.equal(reset.blocker, null);
  await runtime.close();
  const after = await checkpoint(f.config);
  assert.deepEqual(after.visual_plan_ref, before.visual_plan_ref);
  assert.deepEqual(after.semantic_batch_plan_ref, before.semantic_batch_plan_ref);
  assert.deepEqual(after.original, before.original);
  assert.deepEqual(after.completed_visual_pages, before.completed_visual_pages);
  assert.deepEqual(after.calibration_history[0].previous_failure,
    { status: "CALIBRATION_REPAIR_REQUIRED", reason: "CALIBRATION_EXTRACTION_UNRESOLVED" });
  const passedCalls = [];
  runtime = await f.open(mockPort({ calls: passedCalls }), true);
  try {
    const passed = await runtime.execute("run");
    assert.equal(passed.calibration, "pass");
    assert.equal(passed.calibration_epoch, 1);
    assert.equal(passed.completion.graph_built, "pass");
    assert.equal(passed.stage, "REFERENCE_AUDIT");
    assert.equal(passedCalls.filter((call) => call.role === "visual_reader").length, 0);
    assert.ok(passedCalls.some((call) => call.role === "reference_reader"));
    assert.ok(passedCalls.some((call) => call.role === "extractor"));
    assert.ok(passedCalls.some((call) => call.role === "fidelity_auditor"));
    assert.ok(passedCalls.some((call) => call.role === "reconciler"));
    const oldKeys = new Set(failedCalls.map((call) => call.operationKey));
    assert.ok(passedCalls.filter((call) => call.role !== "visual_reader")
      .every((call) => !oldKeys.has(call.operationKey)));
    assert.deepEqual((await runtime.execute("status")), passed);
    await assert.rejects(runtime.execute("recalibrate"), { code: "JOURNAL_RECALIBRATE_NOT_FAILED" });
  } finally { await runtime.close(); }
});

function exchangeAnswer(entry) {
  const packet = entry.packet;
  const review = (role) => ({ schema_version: "1.0", target_generation: packet.expected_generation,
    review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });
  if (entry.role === "reference_reader") return { schema_version: "1.0", source_only_first_pass: true,
    reference_items: [], questions: [], unassessed_unit_ids: [] };
  if (entry.role === "extractor") return { schema_version: "1.0", status: "incomplete",
    assertions: [], entities: [], episodes: [], requested_context: [],
    coverage: packet.core_units.map((unit) => ({ unit_id: unit.unit_id,
      disposition: "pending", assertion_local_ids: [], reason: "Synthetic failed standard cycle." })) };
  if (entry.role === "omission_checker" || entry.role === "fidelity_auditor") return review(entry.role);
  if (entry.role === "reconciler") return { schema_version: "1.0", target_generation: packet.expected_generation,
    proposals: [], unresolved_ids: [], status: "proposals_complete" };
  assert.fail(`unexpected synthetic role ${entry.role}`);
}

for (const resolves of [true, false]) {
  test(`environment-loaded Codex exchange and fake SSH Claude hardest extraction (${resolves ? "resolves" : "fails"})`, async (t) => {
    const f = await fixture(t);
    f.config.hardest_lane = { enabled: true, daily_limit: 20 };
    f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
    const root = path.join(path.dirname(f.configPath), "exchange");
    await fs.mkdir(root, { mode: 0o700 });
    const secret = randomBytes(32).toString("base64");
    const secretFile = path.join(path.dirname(f.configPath), "secret");
    await fs.writeFile(secretFile, secret, { mode: 0o600 });
    const home = path.join(path.dirname(f.configPath), "laptop");
    const workDir = path.join(home, "work");
    await fs.mkdir(workDir, { recursive: true, mode: 0o700 });
    const ssh = path.join(home, "ssh.mjs"), claude = path.join(home, "claude.mjs");
    const checkout = path.resolve(new URL("..", import.meta.url).pathname);
    await fs.writeFile(path.join(home, "fixture.json"), JSON.stringify({ root, secretFile, resolves }), { mode: 0o600 });
    await fs.writeFile(ssh, `#!${process.execPath}\nimport fs from "node:fs";\nimport { spawnSync } from "node:child_process";\nconst fixture = JSON.parse(fs.readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));\nconst args = process.argv.slice(2);\nif (!args.includes("ForwardAgent=no") || !args.includes("ForwardX11=no")) process.exit(31);\nconst result = spawnSync("/bin/sh", ["-c", args.at(-1)], { encoding: "utf8", input: fs.readFileSync(0), env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: fixture.root, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: fixture.secretFile } });\nprocess.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? ""); process.exit(result.status ?? 1);\n`, { mode: 0o700 });
    await fs.writeFile(claude, `#!${process.execPath}\nimport fs from "node:fs";\nimport { spawnSync } from "node:child_process";\nconst { resolves } = JSON.parse(fs.readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));\nconst args = process.argv.slice(2);\nconst config = JSON.parse(fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));\nconst workId = args[args.indexOf("-p") + 1].match(/item ([^ .]+)/)[1];\nconsole.log(JSON.stringify({ type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }], tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"], skills: [], slash_commands: [], plugins: [], agents: [] }));\nconst server = config.mcpServers.journal;\nconst call = (name, arguments_) => { const result = spawnSync(server.command, server.args, { encoding: "utf8", env: process.env, input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } }) + "\\n" }); if (result.status !== 0) process.exit(32); return JSON.parse(result.stdout.trim()).result.structuredContent; };\nconsole.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "packet-call", name: "mcp__journal__get_journal_work_packet", input: { work_id: workId } }] } }));\nconst fetched = call("get_journal_work_packet", { work_id: workId });\nconsole.log(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "packet-call", content: JSON.stringify(fetched) }] } }));\nconst review = (role) => ({ schema_version: "1.0", target_generation: fetched.packet.expected_generation, review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });\nconst output = ["omission_checker", "fidelity_auditor"].includes(fetched.role) ? review(fetched.role) : { schema_version: "1.0", status: resolves ? "complete" : "incomplete", assertions: [], entities: [], episodes: [], requested_context: [], coverage: fetched.packet.core_units.map((unit) => ({ unit_id: unit.unit_id, disposition: resolves ? "no_assertion" : "pending", assertion_local_ids: [], reason: "Synthetic hardest extraction." })) };\nconsole.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__journal__submit_journal_work_result", input: { work_id: workId } }] } }));\nconst submitted = call("submit_journal_work_result", { work_id: workId, output });\nif (submitted.code) process.exit(33);\nconsole.log(JSON.stringify({ type: "result", is_error: false, subtype: "success", session_id: "synthetic12345678", modelUsage: { "claude-opus-5-5": { inputTokens: 1, outputTokens: 2 } }, usage: { input_tokens: 1, output_tokens: 2 } }));\n`, { mode: 0o700 });
    for (const program of [ssh, claude]) {
      const checked = spawnSync(process.execPath, ["--check", program], { encoding: "utf8" });
      assert.equal(checked.status, 0, checked.stderr);
    }
    const environment = { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, HOME: home, LANG: "C",
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root,
      INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: secretFile,
      INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: randomBytes(32).toString("base64"),
      INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({ schema_version: 1,
        provider: "codex_exec_exchange", route_ref: "route:synthetic-codex", model: "gpt-6-sol", effort: "medium",
        max_external_spend_usd: 0, allowance_evidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
        timeout_ms: 60_000, exchange: { poll_ms: 250, ttl_ms: 60_000 } }) };
    const laptopEnvironment = { PATH: environment.PATH, HOME: home, LANG: "C" };
    const exchange = createJournalWorkExchange({ root, secret });
    const runtime = await f.open(undefined, false, environment);
    const seen = new Set(), tiers = [], workerArgs = ["--agent", "claude", "--remote", "synthetic-host",
      "--remote-checkout", checkout, "--remote-config", f.configPath, "--work-dir", workDir,
      "--ssh-bin", ssh, "--claude-bin", claude, "--once", "--max-items", "1", "--timeout-ms", "5000", "--log", path.join(home, "worker-log.jsonl")];
    let completed = false, summary, failure;
    const running = runtime.execute("run").then((value) => { summary = value; completed = true; },
      (error) => { failure = error; completed = true; });
    try {
      const deadline = Date.now() + 90_000;
      while (!completed && Date.now() < deadline) {
        for (const record of await exchange.listDispatch()) {
          if (record.answered || seen.has(record.work_id)) continue;
          seen.add(record.work_id);
          tiers.push([record.role, record.tier]);
          if (record.tier === "hardest") {
            assert.equal(await runJournalClaudeWorker(workerArgs, { environment: laptopEnvironment }), 0);
          } else {
            const entry = await exchange.readWork(record.work_id);
            await exchange.submitResult({ workId: record.work_id, output: exchangeAnswer(entry), subject: "local:synthetic-codex",
              execution: { profile_evidence: "codex_exec_request_pinned", effective_model_profile: record.model,
                effective_effort: record.effort, request_context_id: `codex-thread:synthetic${seen.size}00000000` } });
          }
        }
        if (!completed) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(completed, true, "synthetic exchange run timed out");
      if (failure) throw failure;
      assert.equal(tiers.filter(([role, tier]) => role === "extractor" && tier === "standard").length, 3);
      assert.equal(tiers.filter(([role, tier]) => role === "extractor" && tier === "hardest").length, 1);
      assert.equal(summary.calibration, resolves ? "pass" : "failed");
      assert.equal(summary.calibration_failure?.reason, resolves ? undefined : "CALIBRATION_EXTRACTION_UNRESOLVED");
      assert.ok(summary.hardest_lane.sent >= 1);
      const outcomes = (await fs.readFile(path.join(home, "worker-log.jsonl"), "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line).outcome);
      assert.ok(outcomes.length >= 1);
      assert.deepEqual(outcomes, outcomes.map(() => "answered"), "every hardest item is admitted from the Claude worker");
    } finally { await runtime.close(); await running; }
  });
}

test("a second failed calibration can advance to epoch two, and readers use current calibration records", async (t) => {
  const f = await fixture(t, { pages: 16 });
  const attempts = [];
  for (let epoch = 0; epoch < 2; epoch += 1) {
    const calls = [];
    const runtime = await f.open(mockPort({ fail: true, calls }), epoch > 0);
    try {
      const failed = await runtime.execute("run");
      assert.equal(failed.calibration, "failed");
      assert.equal(failed.calibration_epoch, epoch);
      assert.equal(calls.filter((call) => call.role === "extractor").length, 3);
      attempts.push(calls);
      assert.equal((await runtime.execute("recalibrate")).calibration_epoch, epoch + 1);
    } finally { await runtime.close(); }
  }
  const calls = [];
  const runtime = await f.open(mockPort({ calls }), true);
  try {
    const result = await runtime.execute("run");
    assert.equal(result.calibration, "pass");
    assert.equal(result.calibration_epoch, 2);
    assert.equal(result.calibration_history_length, 2);
    assert.equal(result.completion.graph_built, "pass");
    assert.equal(result.completed_units, 16);
    assert.ok(calls.some((call) => call.role === "reconciler"));
    const oldKeys = new Set(attempts.flat().map((call) => call.operationKey));
    assert.ok(calls.filter((call) => call.role === "extractor")
      .every((call) => !oldKeys.has(call.operationKey)));
  } finally { await runtime.close(); }
  const plan = await readPlan(f.config);
  const calibrationIds = new Set(plan.calibration.map((item) => item.unit_id));
  const calibrationUnit = plan.units.find((unit) => calibrationIds.has(unit.unit_id));
  const regularUnit = plan.units.find((unit) => !calibrationIds.has(unit.unit_id));
  assert.ok(regularUnit);
  await withStore(f.config, async (store) => {
    const old = await store.readJsonObject({ objectId: `unit:graph:${calibrationUnit.unit_id}` });
    const firstRetry = await store.readJsonObject({ objectId: `unit:graph:${calibrationUnit.unit_id}:epoch:1` });
    const current = await store.readJsonObject({ objectId: `unit:graph:${calibrationUnit.unit_id}:epoch:2` });
    const regular = await store.readJsonObject({ objectId: `unit:graph:${regularUnit.unit_id}` });
    assert.equal(old.source_only_unresolved, true);
    assert.equal(firstRetry.source_only_unresolved, true);
    assert.equal(current.source_only_unresolved, false);
    assert.equal(regular.source_only_unresolved, false);
    await assert.rejects(store.readJsonObject({ objectId: `unit:graph:${regularUnit.unit_id}:epoch:2` }), { code: "ENOENT" });
  });
});

test("epoch zero preserves the existing job, operation and object identities", async (t) => {
  const f = await fixture(t);
  const calls = [];
  let runtime = await f.open(mockPort({ calls: [] }));
  try { await runtime.execute("stage"); }
  finally { await runtime.close(); }
  const statePath = path.join(f.config.execution_root, "state.json");
  const legacyState = await checkpoint(f.config);
  delete legacyState.calibration_epoch;
  delete legacyState.calibration_history;
  await fs.writeFile(statePath, JSON.stringify(legacyState));
  runtime = await f.open(mockPort({ calls }), true);
  try { assert.equal((await runtime.execute("run")).calibration_epoch, 0); }
  finally { await runtime.close(); }
  const plan = await readPlan(f.config);
  const unit = plan.units[0];
  const batchKey = sha(unit.unit_id).slice(0, 40);
  const reference = calls.find((call) => call.role === "reference_reader");
  const packet = reference.packet;
  const packetInput = { source_windows: packet.source_windows,
    adjacent_context: packet.adjacent_context, visual_context: packet.visual_context,
    neutral_reading_instructions: packet.neutral_reading_instructions };
  const expectedJob = `job:${sha(JSON.stringify({ id: `reference:calibration:batch:${batchKey}`,
    role: "reference_reader", stage: "REFERENCE_AUDIT", packetInput,
    assigned_core_ids: packet.assigned_core_ids, source_locators: packet.source_locators,
    dependencies: [], instruction: journalRoleInstruction("reference_reader"),
    dependency_instructions: [] }))}`;
  assert.equal(packet.controller_provenance_tag, expectedJob);
  assert.equal(reference.operationKey, expectedJob);
  const extraction = calls.find((call) => call.role === "extractor");
  assert.equal(extraction.operationKey,
    `journal:${extraction.packet.controller_provenance_tag.slice(5, 45)}:${sha(JSON.stringify(extraction.packet)).slice(0, 32)}`);
  await withStore(f.config, async (store) => {
    assert.ok(await store.readJsonObject({ objectId: `reference:result:${expectedJob}` }));
    assert.ok(await store.readJsonObject({ objectId: `calibration:review:batch:${batchKey}` }));
    assert.ok(await store.readJsonObject({ objectId: `unit:graph:${unit.unit_id}` }));
  });
});

test("recalibrate is refused once a graph exists, so a gate later stages assume passed is never reopened", async (t) => {
  const f = await fixture(t);
  let runtime = await f.open(mockPort({ fail: true, calls: [] }));
  try { assert.equal((await runtime.execute("run")).calibration, "failed"); }
  finally { await runtime.close(); }
  // An older checkpoint could carry a built graph alongside a calibration that was closed afterwards.
  const stateFile = path.join(f.config.execution_root, "state.json");
  const state = await checkpoint(f.config);
  await fs.writeFile(stateFile, JSON.stringify({ ...state, graph_ref: { synthetic: true } }), { mode: 0o600 });
  runtime = await f.open(mockPort({ calls: [] }));
  try { await assert.rejects(runtime.execute("recalibrate"), { code: "JOURNAL_RECALIBRATE_AFTER_GRAPH" }); }
  finally { await runtime.close(); }
  const after = await checkpoint(f.config);
  assert.equal(after.calibration, "failed");
  assert.equal(after.calibration_epoch ?? 0, 0);
});

test("recalibrate refuses other states and bad configs before env-file loading or sign-in", async (t) => {
  const f = await fixture(t);
  const runtime = await f.open(mockPort({ calls: [] }));
  try { await assert.rejects(runtime.execute("recalibrate"), { code: "JOURNAL_RECALIBRATE_NOT_FAILED" }); }
  finally { await runtime.close(); }
  const badConfig = path.join(path.dirname(f.configPath), "bad-config.json");
  await fs.writeFile(badConfig, JSON.stringify({ ...f.config, max_external_spend_usd: 1 }), { mode: 0o600 });
  const missingEnv = path.join(path.dirname(f.configPath), "missing.env");
  let errors = "";
  const code = await runJournalImportCli(["recalibrate", "--config", badConfig, "--env-file", missingEnv], {
    environment: {}, stdout: { write: () => assert.fail("bad config must not open a runtime") },
    stderr: { write: (text) => { errors += text; } },
    runtimeFactory: () => assert.fail("bad config must be refused before runtime/sign-in")
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(errors).error, "JOURNAL_ZERO_SPEND_REQUIRED");
  let dispatched = null;
  let closed = false;
  let output = "";
  assert.equal(await runJournalImportCli(["recalibrate", "--config", f.configPath], {
    environment: {}, stdout: { write: (text) => { output += text; } },
    stderr: { write: () => assert.fail("valid command must dispatch") },
    runtimeFactory: async () => ({ execute: async (command) => {
      dispatched = command;
      return { calibration_epoch: 1 };
    }, close: async () => { closed = true; } })
  }), 0);
  assert.equal(dispatched, "recalibrate");
  assert.equal(closed, true);
  assert.equal(JSON.parse(output).calibration_epoch, 1);
});
