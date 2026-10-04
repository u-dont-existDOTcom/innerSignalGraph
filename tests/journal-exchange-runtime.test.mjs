import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createExchangeJournalInferencePort } from "../src/journal-import/exchange-port.mjs";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";
import { createJournalWorkTools } from "../src/server/journal-work-tools.mjs";

const CASE_ID = "synthetic-case";

// The same synthetic role behaviour the mock-port runtime tests use, answered here through the
// connector tools instead.
const review = (role, packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });
const handlers = {
  reference_reader: () => ({ schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] }),
  extractor: (packet) => ({ schema_version: "1.0", status: "complete", assertions: [], entities: [], episodes: [], coverage: packet.core_units.map((unit) => ({ unit_id: unit.unit_id, disposition: "no_assertion", assertion_local_ids: [], reason: "Synthetic pipeline fixture." })), requested_context: [] }),
  omission_checker: (packet) => review("omission_checker", packet),
  fidelity_auditor: (packet) => review("fidelity_auditor", packet),
  reconciler: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, proposals: [], unresolved_ids: [], status: "proposals_complete" })
};

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-exchange-runtime-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(path.join(base, "private"), { mode: 0o700 });
  await fs.mkdir(path.join(base, "exchange"), { mode: 0o700 });
  const text = "Synthetic entry, uncertain date. A blue cup is on the table.\n";
  await fs.writeFile(path.join(base, "private", "source.txt"), text, { mode: 0o600 });
  const config = {
    schema_version: 1,
    max_external_spend_usd: 0,
    execution_root: path.join(base, "execution"),
    private_runtime_root: base,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") },
    target_profile: { case_id: CASE_ID },
    existing_grant_ref: "synthetic:grant"
  };
  const configPath = path.join(base, "private", "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const secret = randomBytes(32).toString("base64");
  const exchangeRoot = path.join(base, "exchange");
  const connector = createJournalWorkExchange({ root: exchangeRoot, secret });
  const tools = createJournalWorkTools({
    exchange: connector,
    caseId: CASE_ID,
    authorizeCase: async () => ({ principalId: "synthetic-chatgpt-account", scopes: ["case:read", "journal:submit"] })
  });
  const receiptKey = randomBytes(32);
  const runtimeExchange = createJournalWorkExchange({ root: exchangeRoot, secret });
  const verifiedExchange = {
    ...runtimeExchange,
    async readResult(workId) {
      const result = await runtimeExchange.readResult(workId);
      if (!result?.receipt) return result;
      return {
        ...result,
        receipt: {
          ...result.receipt,
          request_context_id: `verified-chat:${workId}`,
          effective_model_profile: "GPT-5.6 Sol",
          effective_effort: "Pro"
        }
      };
    }
  };
  const makePort = (options = {}) => createExchangeJournalInferencePort({
    exchange: verifiedExchange,
    caseId: CASE_ID,
    receiptKey,
    routeRef: "route:synthetic-exchange",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "GPT-5.6 Sol",
    effort: "Pro",
    waitMs: 10_000,
    pollMs: 5,
    ...options
  });
  const roles = [];
  async function answerOpenItems() {
    for (const record of await connector.listDispatch()) {
      if (record.answered) continue;
      const fetched = await tools.call("get_journal_work_packet", { work_id: record.work_id }, {});
      if (fetched.toolError || fetched.value.status !== "ready") continue;
      roles.push(fetched.value.role);
      const output = handlers[fetched.value.role](fetched.value.packet);
      const stored = await tools.call("submit_journal_work_result", { work_id: record.work_id, output }, {});
      assert.equal(stored.toolError, undefined, JSON.stringify(stored.toolError));
    }
  }
  function answerInBackground() {
    let stop = false;
    const running = (async () => {
      while (!stop) {
        await answerOpenItems();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    })();
    return async () => { stop = true; await running; };
  }
  return { config, configPath, service: { verifyCaseAccess: async () => ({}) }, connector, makePort, roles, answerInBackground };
}

test("the runtime builds the graph with every role call answered through the connector", async (t) => {
  const f = await fixture(t);
  const stop = f.answerInBackground();
  let result;
  try {
    const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service, inferencePort: f.makePort() });
    try { result = await runtime.execute("run"); } finally { await runtime.close(); }
  } finally { await stop(); }
  assert.equal(result.completion.graph_built, "pass");
  assert.equal(result.blocker, null);
  assert.deepEqual(f.roles, ["reference_reader", "extractor", "omission_checker", "fidelity_auditor", "reconciler"]);
  // Every item was retired once its answer was stored.
  assert.deepEqual(await f.connector.listDispatch(), []);
});

test("an answer that arrives after a run gave up waiting is picked up by the next run", async (t) => {
  const f = await fixture(t);
  // First run: nobody answers, and the run stops at the source-first reference reading.
  let runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service, inferencePort: f.makePort({ waitMs: 0 }) });
  let result;
  try { result = await runtime.execute("run"); } finally { await runtime.close(); }
  assert.equal(result.stage, "REFERENCE_AUDIT");
  assert.equal(result.blocker, "COMPLETION_UNKNOWN");
  const open = await f.connector.listDispatch();
  assert.deepEqual(open.map((record) => [record.role, record.answered]), [["reference_reader", false]]);

  // Mission Control and ChatGPT answer it while no run is active; the next run reads that answer
  // instead of staying blocked, and finishes with answers arriving as it goes.
  const stop = f.answerInBackground();
  try {
    runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service, inferencePort: f.makePort() });
    try { result = await runtime.execute("run"); } finally { await runtime.close(); }
  } finally { await stop(); }
  assert.equal(result.completion.graph_built, "pass");
  assert.equal(result.blocker, null);
  assert.equal(f.roles.filter((role) => role === "reference_reader").length, 1, "the open reference call was answered once, not sent again");
});

test("a delayed invalid reference answer is recorded and retried once under a reserialization key", async (t) => {
  const f = await fixture(t);
  let runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service, inferencePort: f.makePort({ waitMs: 0 }) });
  let result;
  try { result = await runtime.execute("run"); } finally { await runtime.close(); }
  assert.equal(result.blocker, "COMPLETION_UNKNOWN");

  const [open] = await f.connector.listDispatch();
  await f.connector.submitResult({ workId: open.work_id, output: { unexpected: true }, subject: "synthetic-account" });
  runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service, inferencePort: f.makePort({ waitMs: 0 }) });
  try { result = await runtime.execute("run"); } finally { await runtime.close(); }
  assert.equal(result.stage, "REFERENCE_AUDIT");
  assert.equal(result.blocker, "INVALID_STRUCTURED_OUTPUT");
  assert.deepEqual(await f.connector.listDispatch(), [], "the invalid original item is retired");

  const stop = f.answerInBackground();
  try {
    runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service, inferencePort: f.makePort() });
    try { result = await runtime.execute("run"); } finally { await runtime.close(); }
  } finally { await stop(); }
  assert.equal(result.completion.graph_built, "pass");
  assert.equal(result.blocker, null);
  assert.equal(f.roles.filter((role) => role === "reference_reader").length, 1,
    "the bounded reserialization completes after the delayed invalid answer");
});
