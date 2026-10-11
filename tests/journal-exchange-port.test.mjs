import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalWorkExchange, journalWorkFileKey } from "../src/journal-import/work-exchange.mjs";
import { createJournalWorkTools } from "../src/server/journal-work-tools.mjs";
import { createExchangeJournalInferencePort, journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";
import { createDurableJournalInferencePort } from "../src/journal-import/durable-inference.mjs";
import { isAuthenticatedTransportReceipt } from "../src/journal-import/audit.mjs";

const CASE_ID = "synthetic-journal-case";
const GENERATION = "generation:synthetic";
const KEY = "job:synthetic-reference-call";
const grant = Object.freeze({
  grant_id: "synthetic:grant",
  principal_id: "authorized-private-operator",
  purpose: "organize_search",
  allowed_roles: ["reference_reader", "extractor", "omission_checker", "fidelity_auditor", "reconciler", "visual_reader"],
  revoked: false,
  expires_at: null
});
const referenceAnswer = Object.freeze({ schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] });

function referenceCall({ text = "A synthetic sentence.", operationKey = KEY } = {}) {
  return {
    role: "reference_reader",
    outputSchema: "reference-result",
    operationKey,
    grant,
    packet: {
      protocol_version: "1.0",
      output_schema_id: "reference-result",
      assigned_core_ids: ["u1"],
      source_locators: [{ representation_id: "r1", page: null, start_byte: 0, end_byte: Buffer.byteLength(text) }],
      expected_generation: GENERATION,
      controller_provenance_tag: "job:synthetic",
      grant_purpose: "organize_search",
      source_windows: [{ unit_id: "u1", text }],
      adjacent_context: { by_unit: [] },
      visual_context: [],
      neutral_reading_instructions: []
    }
  };
}

function memoryStore() {
  const data = new Map();
  return {
    data,
    async readJsonObject({ objectId }) {
      if (!data.has(objectId)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return structuredClone(data.get(objectId));
    },
    async writeJsonObject({ objectId, value }) {
      assert.equal(data.has(objectId), false, "durable records are immutable");
      data.set(objectId, structuredClone(value));
    }
  };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-exchange-port-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const secret = randomBytes(32).toString("base64");
  // The connector and the runtime are separate processes sharing one exchange root and secret.
  const connector = createJournalWorkExchange({ root, secret });
  const runtimeExchange = createJournalWorkExchange({ root, secret });
  const tools = createJournalWorkTools({
    exchange: connector,
    caseId: CASE_ID,
    authorizeCase: async () => ({ principalId: "synthetic-chatgpt-account", scopes: ["case:read", "journal:submit"] })
  });
  const receiptKey = randomBytes(32);
  const makePort = ({ verifiedExecution = true, ...options } = {}) => createExchangeJournalInferencePort({
    // The deployed connector cannot produce these fields yet. Most port tests model the future
    // mechanically verified dispatcher receipt; the regression below uses the real receipt.
    exchange: verifiedExecution ? {
      ...runtimeExchange,
      async readResult(workId) {
        const result = await runtimeExchange.readResult(workId);
        if (!result?.receipt) return result;
        const dispatch = (await runtimeExchange.listDispatch()).find(record => record.work_id === workId);
        return {
          ...result,
          receipt: {
            ...result.receipt,
            request_context_id: `verified-chat:${workId}`,
            effective_model_profile: dispatch?.model,
            effective_effort: dispatch?.effort
          }
        };
      }
    } : runtimeExchange,
    caseId: CASE_ID,
    receiptKey,
    routeRef: "route:synthetic-exchange",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "GPT-5.6 Sol",
    effort: "Pro",
    waitMs: 5_000,
    pollMs: 5,
    ...options
  });
  // Stands in for Mission Control and a fresh ChatGPT chat: takes each open dispatch record, fetches
  // its packet through the connector tool and submits an answer through the other tool.
  async function answerOpenItems(answer = () => structuredClone(referenceAnswer)) {
    let answered = 0;
    for (const record of await connector.listDispatch()) {
      if (record.answered) continue;
      const fetched = await tools.call("get_journal_work_packet", { work_id: record.work_id }, {});
      if (fetched.toolError || fetched.value.status !== "ready") continue;
      const stored = await tools.call("submit_journal_work_result", { work_id: record.work_id, output: answer(fetched.value) }, {});
      assert.equal(stored.toolError, undefined, JSON.stringify(stored.toolError));
      answered += 1;
    }
    return answered;
  }
  function answerInBackground(answer) {
    let stop = false;
    const running = (async () => {
      while (!stop) {
        await answerOpenItems(answer);
        await delay(5);
      }
    })();
    return async () => { stop = true; await running; };
  }
  return { root, connector, runtimeExchange, tools, makePort, answerOpenItems, answerInBackground };
}

test("a role call goes out as a work item and comes back as an authenticated answer", async (t) => {
  const environment = await setup(t);
  const port = environment.makePort();
  const seen = [];
  const stop = environment.answerInBackground((fetched) => {
    seen.push(fetched);
    return structuredClone(referenceAnswer);
  });
  let result;
  try { result = await port.invoke(referenceCall()); } finally { await stop(); }

  assert.deepEqual(result.output, referenceAnswer);
  const { receipt } = result;
  assert.equal(receipt.transport, "chatgpt_connector_tool");
  assert.equal(receipt.completion_status, "completed");
  assert.equal(receipt.cost_usd, 0);
  assert.equal(receipt.configured_model_profile, "GPT-5.6 Sol");
  assert.equal(receipt.effective_model_profile, "GPT-5.6 Sol");
  assert.equal(receipt.effective_effort, "Pro");
  assert.equal(receipt.request_context_id, `verified-chat:${journalExchangeWorkId(KEY)}`);
  assert.equal(receipt.provider_route_receipt.work_id, journalExchangeWorkId(KEY));
  assert.ok(isAuthenticatedTransportReceipt(receipt, { generation: GENERATION, grantId: grant.grant_id }));

  // ChatGPT saw the role's instruction, the packet and the output schema, nothing else of the runtime.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].role, "reference_reader");
  assert.equal(seen[0].packet.source_windows[0].text, "A synthetic sentence.");
  assert.equal(seen[0].output_schema.$id, "urn:innersignal:journal:reference:1.0");
  assert.equal(Object.hasOwn(seen[0], "input_sha256"), false);

  // The dispatch record carries no content: an opaque ID, the role and the route's model and effort.
  const [record] = await environment.connector.listDispatch();
  assert.deepEqual(Object.keys(record).sort(), ["answered", "attempt_identity", "effort", "expires_at", "issued_at", "model", "output_schema_name", "role", "route_ref", "schema_version", "tier", "work_id"]);
  assert.match(record.attempt_identity, /^[0-9a-f]{48}$/u);
  assert.equal(record.tier, "standard");
  assert.equal(record.answered, true);
  const dispatchText = await fs.readFile(path.join(environment.root, "dispatch", `${journalWorkFileKey(record.work_id)}.json`), "utf8");
  assert.ok(!dispatchText.includes("synthetic sentence"));

  // Once the caller has stored the answer, releasing retires the item and its dispatch record.
  await port.release(KEY);
  assert.deepEqual(await environment.connector.listDispatch(), []);
  assert.equal(await environment.connector.readWork(journalExchangeWorkId(KEY)), null);
  assert.deepEqual(await port.getCompletion(KEY), { status: "unknown" });
});

test("an answer without mechanically verified execution profile is rejected and retired", async (t) => {
  const environment = await setup(t);
  let observedReceipt;
  const port = environment.makePort({
    verifiedExecution: false,
    exchange: {
      ...environment.runtimeExchange,
      async readResult(workId) {
        const result = await environment.runtimeExchange.readResult(workId);
        if (result?.receipt) observedReceipt = result.receipt;
        return result;
      }
    }
  });
  const durable = createDurableJournalInferencePort({ port, corpusStore: memoryStore() });
  const rejected = assert.rejects(durable.invoke(referenceCall()), (error) =>
    error.code === "INVALID_STRUCTURED_OUTPUT" && error.submissionStatus === "completed_invalid"
    && error.cause?.code === "JOURNAL_EXCHANGE_EXECUTION_PROFILE_UNVERIFIED");
  while ((await environment.connector.listDispatch()).length === 0) await delay(5);
  await environment.answerOpenItems();
  await rejected;

  assert.ok(observedReceipt, "the unverified answer receipt was observed before retirement");
  assert.equal(observedReceipt.request_context_id, undefined,
    "an answer receipt must not be promoted into a fresh-chat identifier");
  assert.equal(observedReceipt.effective_model_profile, undefined);
  assert.equal(observedReceipt.effective_effort, undefined);
  const stored = await environment.runtimeExchange.readResult(journalExchangeWorkId(KEY));
  assert.equal(stored.retired, true);
  assert.equal(stored.receipt, undefined, "retirement removes the answer receipt");
  assert.equal(await environment.connector.readWork(journalExchangeWorkId(KEY)), null);
  assert.deepEqual(await environment.connector.listDispatch(), []);
  assert.deepEqual(await durable.getCompletion(KEY), { status: "invalid_output" });
});

test("a delayed answer without execution profile is retired after durable rejection", async () => {
  let entry = null;
  let answered = false;
  let retired = false;
  const exchange = {
    async readResult() { return answered ? { output: structuredClone(referenceAnswer), receipt: {} } : null; },
    async readWork() { return entry; },
    async publishWork(work) { entry = work; return { created: true }; },
    async publishDispatch() {},
    async listDispatch() { return [{ work_id: entry.work_id, model: "GPT-5.6 Sol", effort: "Pro", tier: "standard" }]; },
    async retireWork() { retired = true; }
  };
  const port = createExchangeJournalInferencePort({ exchange, caseId: CASE_ID, receiptKey: randomBytes(32),
    routeRef: "route:synthetic-exchange", allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "GPT-5.6 Sol", effort: "Pro", waitMs: 0 });
  const durable = createDurableJournalInferencePort({ port, corpusStore: memoryStore() });
  await assert.rejects(durable.invoke(referenceCall()), { code: "COMPLETION_UNKNOWN" });
  answered = true;
  assert.deepEqual(await durable.getCompletion(KEY), { status: "invalid_output" });
  assert.equal(retired, true);
  await assert.rejects(durable.invoke(referenceCall()), (error) =>
    error.code === "INVALID_STRUCTURED_OUTPUT" && error.submissionStatus === "completed_invalid");
});

test("a hardest receipt uses the first dispatch profile after configuration changes", async () => {
  let entry = null, dispatch = null, answer = null;
  const exchange = {
    async readWork() { return entry; },
    async readResult() { return answer; },
    async publishWork(value) { entry ??= structuredClone(value); return { created: true }; },
    async publishDispatch(value) { dispatch ??= structuredClone(value); },
    async listDispatch() { return dispatch ? [{ ...dispatch, answered: answer !== null }] : []; }
  };
  const options = { exchange, caseId: CASE_ID, receiptKey: randomBytes(32),
    routeRef: "route:synthetic-exchange",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "GPT-5.6 Sol", effort: "Pro", waitMs: 0 };
  const operationKey = `${KEY}:hardest:persisted-profile`;
  const first = createExchangeJournalInferencePort({ ...options,
    hardestLane: { model: "claude-opus-original", effort: "original-effort", ttl_hours: 6 } });
  await assert.rejects(first.invoke({ ...referenceCall({ operationKey }), tier: "hardest" }),
    { code: "COMPLETION_UNKNOWN" });
  assert.deepEqual([dispatch.tier, dispatch.model, dispatch.effort],
    ["hardest", "claude-opus-original", "original-effort"]);
  answer = { output: structuredClone(referenceAnswer), receipt: {
    receipt_id: "synthetic-receipt", work_file_key: "synthetic-work-file",
    received_at: "2026-09-30T00:00:00.000Z", output_sha256: "synthetic-output-digest",
    subject_sha256: "synthetic-principal-digest", request_context_id: "verified-chat:synthetic",
    effective_model_profile: dispatch.model, effective_effort: dispatch.effort
  } };
  const restarted = createExchangeJournalInferencePort({ ...options,
    hardestLane: { model: "claude-opus-new", effort: "new-effort", ttl_hours: 6 } });
  const completion = await restarted.getCompletion(operationKey);
  assert.equal(completion.status, "completed");
  assert.equal(completion.receipt.configured_model_profile, dispatch.model);
  assert.equal(completion.receipt.configured_effort, dispatch.effort);
  assert.equal(completion.receipt.provider_route_receipt.tier, "hardest");
  assert.equal(completion.receipt.provider_route_receipt.subject, undefined);
});

test("Codex receipt refuses a dispatch profile that differs from the configured route", async () => {
  let entry = null, dispatch = null, answer = null;
  const exchange = {
    async readWork() { return entry; },
    async readResult() { return answer; },
    async publishWork(value) { entry ??= structuredClone(value); return { created: true }; },
    async publishDispatch(value) { dispatch ??= structuredClone(value); },
    async listDispatch() { return dispatch ? [{ ...dispatch, answered: answer !== null }] : []; }
  };
  const options = { exchange, caseId: CASE_ID, receiptKey: randomBytes(32), routeRef: "route:synthetic-codex",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "gpt-6-sol", effort: "medium", roleEffort: { reference_reader: "high" },
    executionAttestation: "codex_exec", waitMs: 0 };
  const port = createExchangeJournalInferencePort(options);
  await assert.rejects(port.invoke(referenceCall({ operationKey: `${KEY}:codex-config` })),
    { code: "COMPLETION_UNKNOWN" });
  assert.equal(dispatch.effort, "high");
  answer = { output: structuredClone(referenceAnswer), receipt: {
    receipt_id: "synthetic-receipt", work_file_key: "synthetic-work-file",
    received_at: "2026-10-01T00:00:00.000Z", output_sha256: "synthetic-output-digest",
    subject_sha256: "synthetic-principal-digest", request_context_id: "codex-thread:12345678",
    profile_evidence: "codex_exec_request_pinned", effective_model_profile: dispatch.model,
    effective_effort: dispatch.effort
  } };
  assert.equal((await port.getCompletion(`${KEY}:codex-config`)).status, "completed");
  const changed = createExchangeJournalInferencePort({ ...options, model: "gpt-6-astra" });
  const invalid = await changed.getCompletion(`${KEY}:codex-config`);
  assert.equal(invalid.status, "invalid_output");
  await assert.rejects(changed.invoke(referenceCall({ operationKey: `${KEY}:codex-config` })),
    { code: "INVALID_STRUCTURED_OUTPUT" });
});

test("Codex exchange admits reported Claude evidence only for hardest work", async () => {
  let entry = null, dispatch = null, answer = null;
  const exchange = {
    async readWork(workId) { return entry?.work_id === workId ? entry : null; },
    async readResult(workId) { return entry?.work_id === workId ? answer : null; },
    async publishWork(value) { entry = structuredClone(value); return { created: true }; },
    async publishDispatch(value) { dispatch = structuredClone(value); },
    async listDispatch() { return dispatch ? [{ ...dispatch, answered: answer !== null }] : []; }
  };
  const options = { exchange, caseId: CASE_ID, receiptKey: randomBytes(32), routeRef: "route:synthetic-codex",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "gpt-6-sol", effort: "medium", executionAttestation: "codex_exec", waitMs: 0,
    hardestLane: { model: "claude-opus-5-5", effort: "max" } };
  const port = createExchangeJournalInferencePort(options);
  const operationKey = `${KEY}:claude-hardest`;
  await assert.rejects(port.invoke({ ...referenceCall({ operationKey }), tier: "hardest" }), { code: "COMPLETION_UNKNOWN" });
  assert.deepEqual([dispatch.tier, dispatch.model, dispatch.effort], ["hardest", "claude-opus-5-5", "max"]);
  answer = { output: structuredClone(referenceAnswer), receipt: {
    receipt_id: "synthetic-receipt", work_file_key: "synthetic-work-file", received_at: "2026-10-02T00:00:00.000Z",
    output_sha256: "synthetic-output-digest", subject_sha256: "synthetic-principal-digest",
    request_context_id: "claude-session:12345678", profile_evidence: "claude_code_model_usage_reported",
    effective_model_profile: dispatch.model, effective_effort: dispatch.effort
  } };
  assert.equal((await port.getCompletion(operationKey)).status, "completed");
  const connector = createExchangeJournalInferencePort({ ...options, executionAttestation: null });
  assert.equal((await connector.getCompletion(operationKey)).status, "invalid_output");
  answer = { ...answer, receipt: { ...answer.receipt, profile_evidence: "codex_exec_request_pinned",
    request_context_id: "codex-thread:12345678" } };
  assert.equal((await port.getCompletion(operationKey)).status, "invalid_output",
    "request-pinned Codex evidence cannot answer hardest work");
  const standardKey = `${KEY}:claude-standard`;
  answer = null;
  await assert.rejects(port.invoke(referenceCall({ operationKey: standardKey })), { code: "COMPLETION_UNKNOWN" });
  assert.equal(dispatch.tier, "standard");
  answer = { output: structuredClone(referenceAnswer), receipt: {
    receipt_id: "synthetic-standard-receipt", work_file_key: "synthetic-standard-work-file",
    received_at: "2026-10-02T00:00:00.000Z", output_sha256: "synthetic-output-digest",
    subject_sha256: "synthetic-principal-digest", request_context_id: "claude-session:12345678",
    profile_evidence: "claude_code_model_usage_reported", effective_model_profile: dispatch.model,
    effective_effort: dispatch.effort
  } };
  assert.equal((await port.getCompletion(standardKey)).status, "invalid_output");
});

test("an invalid dispatcher context identifier is not promoted into an authenticated receipt", async (t) => {
  const environment = await setup(t);
  const port = environment.makePort({
    exchange: {
      ...environment.runtimeExchange,
      async readResult(workId) {
        const result = await environment.runtimeExchange.readResult(workId);
        if (!result?.receipt) return result;
        return {
          ...result,
          receipt: {
            ...result.receipt,
            request_context_id: "verified-chat:\nforged-field",
            effective_model_profile: "GPT-5.6 Sol",
            effective_effort: "Pro"
          }
        };
      }
    }
  });
  const invocation = port.invoke(referenceCall());
  while ((await environment.connector.listDispatch()).length === 0) await delay(5);
  await environment.answerOpenItems();
  const { receipt } = await invocation;
  assert.equal(receipt.request_context_id, null);
});

test("a call left open survives a restart and completes from the exchange, without a second send", async (t) => {
  const environment = await setup(t);
  const store = memoryStore();
  const first = createDurableJournalInferencePort({ port: environment.makePort({ waitMs: 0 }), corpusStore: store });
  await assert.rejects(first.invoke(referenceCall()), (error) => error.code === "COMPLETION_UNKNOWN" && error.submissionStatus === "unknown");
  assert.deepEqual((await environment.connector.listDispatch()).map((record) => record.answered), [false]);

  // A later run resumes the same submission and waits for it; the answer arrives meanwhile.
  const stop = environment.answerInBackground();
  const restarted = createDurableJournalInferencePort({ port: environment.makePort(), corpusStore: store });
  let resumed;
  try { resumed = await restarted.invoke(referenceCall()); } finally { await stop(); }
  assert.deepEqual(resumed.output, referenceAnswer);
  assert.equal((await fs.readdir(path.join(environment.root, "outbox"))).length, 0, "one item, retired after its answer was stored");
  assert.deepEqual(await environment.connector.listDispatch(), []);

  // The answer now comes from the durable store.
  const replay = await createDurableJournalInferencePort({ port: environment.makePort(), corpusStore: store }).invoke(referenceCall());
  assert.equal(replay.receipt.replay, true);
  assert.deepEqual(replay.output, referenceAnswer);
});

test("a controller's completion check reads an answer that arrived after the run ended", async (t) => {
  const environment = await setup(t);
  const store = memoryStore();
  const durable = createDurableJournalInferencePort({ port: environment.makePort({ waitMs: 0 }), corpusStore: store });
  await assert.rejects(durable.invoke(referenceCall()), { code: "COMPLETION_UNKNOWN" });
  assert.deepEqual(await durable.getCompletion(KEY), { status: "unknown" });
  assert.equal(await environment.answerOpenItems(), 1);
  const completed = await createDurableJournalInferencePort({ port: environment.makePort({ waitMs: 0 }), corpusStore: store }).getCompletion(KEY);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.output, referenceAnswer);
  assert.ok(isAuthenticatedTransportReceipt(completed.receipt, { generation: GENERATION, grantId: grant.grant_id }));
  assert.deepEqual(await environment.connector.listDispatch(), [], "released once stored");
});

test("an item that expires unanswered is closed, refused to late answers and sent again as a successor", async (t) => {
  const environment = await setup(t);
  // The runtime and the connector share a host clock; this one only runs ahead of it.
  let clock = Date.now();
  const now = () => new Date(clock);
  const store = memoryStore();
  const port = environment.makePort({ waitMs: 0, ttlMs: 60_000, now });
  const durable = createDurableJournalInferencePort({ port, corpusStore: store });
  await assert.rejects(durable.invoke(referenceCall()), { code: "COMPLETION_UNKNOWN" });
  const firstId = journalExchangeWorkId(KEY);

  clock += 2 * 60 * 60 * 1000;
  assert.deepEqual(await durable.getCompletion(KEY), { status: "not_submitted" });
  const closed = await environment.connector.readResult(firstId);
  assert.equal(closed.retired, true);
  assert.equal(closed.unanswered, true);
  assert.deepEqual(await environment.connector.listDispatch(), []);
  // A chat that still holds the old ID can neither fetch nor answer it.
  const late = await environment.tools.call("submit_journal_work_result", { work_id: firstId, output: structuredClone(referenceAnswer) }, {});
  assert.equal(late.toolError.code, "JOURNAL_WORK_NOT_FOUND");

  // The caller's retry under the same key publishes the successor, which is answered.
  const stop = environment.answerInBackground();
  let resent;
  try {
    resent = await createDurableJournalInferencePort({ port: environment.makePort({ ttlMs: 60_000, now }), corpusStore: store }).invoke(referenceCall());
  } finally { await stop(); }
  assert.equal(resent.receipt.provider_route_receipt.work_id, journalExchangeWorkId(KEY, 1));
  assert.deepEqual(resent.output, referenceAnswer);
});

test("the same operation key with different input is refused", async (t) => {
  const environment = await setup(t);
  const port = environment.makePort({ waitMs: 0 });
  await assert.rejects(port.invoke(referenceCall()), { code: "COMPLETION_UNKNOWN" });
  await assert.rejects(port.invoke(referenceCall({ text: "A different synthetic sentence." })), { code: "OPERATION_KEY_CONFLICT" });
  assert.equal((await environment.connector.listDispatch()).length, 1);
});

test("page images are not sent through the connector", async (t) => {
  const environment = await setup(t);
  const port = environment.makePort();
  assert.equal(port.capabilities().roles.visual_reader.available, false);
  assert.equal(port.capabilities().roles.extractor.available, true);
  assert.equal(port.capabilities().authoritative_completion, true);
  await assert.rejects(port.invoke({
    role: "visual_reader",
    outputSchema: "visual-result",
    operationKey: "job:synthetic-visual",
    grant,
    packet: {}
  }), (error) => error.code === "JOURNAL_EXCHANGE_ROLE_UNSUPPORTED" && error.submissionStatus === "not_submitted");
  assert.deepEqual(await environment.connector.listDispatch(), []);
});

test("a stored answer that fails the importer's schema is reported as invalid output", async (t) => {
  const environment = await setup(t);
  const store = memoryStore();
  const durable = createDurableJournalInferencePort({ port: environment.makePort({ waitMs: 0 }), corpusStore: store });
  await assert.rejects(durable.invoke(referenceCall()), { code: "COMPLETION_UNKNOWN" });
  // Written directly, past the connector's own schema check.
  await environment.runtimeExchange.submitResult({ workId: journalExchangeWorkId(KEY), output: { unexpected: true }, subject: "synthetic" });
  assert.deepEqual(await durable.getCompletion(KEY), { status: "invalid_output" });
  assert.deepEqual(await environment.connector.listDispatch(), [], "invalid answer retired after its durable failure was recorded");
  await assert.rejects(durable.invoke(referenceCall()), (error) => error.code === "INVALID_STRUCTURED_OUTPUT" && error.submissionStatus === "completed_invalid");
});

test("an invalid answer observed while invoking is retired after its durable failure is recorded", async (t) => {
  const environment = await setup(t);
  const store = memoryStore();
  const durable = createDurableJournalInferencePort({ port: environment.makePort(), corpusStore: store });
  const rejected = assert.rejects(durable.invoke(referenceCall()),
    (error) => error.code === "INVALID_STRUCTURED_OUTPUT" && error.submissionStatus === "completed_invalid");
  while ((await environment.connector.listDispatch()).length === 0) await delay(5);
  await environment.runtimeExchange.submitResult({
    workId: journalExchangeWorkId(KEY), output: { unexpected: true }, subject: "synthetic"
  });
  await rejected;
  assert.deepEqual(await environment.connector.listDispatch(), []);
});

test("starting the port clears stale temporary files, and open items are listed without content", async (t) => {
  const environment = await setup(t);
  const port = environment.makePort({ waitMs: 0 });
  await assert.rejects(port.invoke(referenceCall()), { code: "COMPLETION_UNKNOWN" });
  const stale = path.join(environment.root, "dispatch", ".tmp-stale");
  await fs.writeFile(stale, "partial", { mode: 0o600 });
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(stale, old, old);
  await port.prepare();
  await assert.rejects(fs.access(stale));
  const items = await port.openItems();
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0]).sort(), ["answered", "expires_at", "issued_at", "role", "tier", "work_file_key", "work_id"]);
  assert.equal(items[0].work_id, journalExchangeWorkId(KEY));
  assert.equal(items[0].tier, "standard");
  assert.equal(items[0].answered, false);
});

test("a hardest call uses its configured tier, model, effort and expiry and records its subject digest", async (t) => {
  const environment = await setup(t);
  const port = environment.makePort({ hardestLane: { model: "claude-opus-5-5", effort: "max", ttl_hours: 6 } });
  const stop = environment.answerInBackground();
  let result;
  try { result = await port.invoke({ ...referenceCall({ operationKey: `${KEY}:hardest` }), tier: "hardest" }); }
  finally { await stop(); }
  const [dispatch] = await environment.connector.listDispatch();
  assert.equal(dispatch.tier, "hardest");
  assert.equal(dispatch.model, "claude-opus-5-5");
  assert.equal(dispatch.effort, "max");
  assert.equal(Date.parse(dispatch.expires_at) - Date.parse(dispatch.issued_at), 6 * 60 * 60_000);
  const stored = await environment.runtimeExchange.readResult(journalExchangeWorkId(`${KEY}:hardest`));
  assert.equal(stored.receipt.subject_sha256,
    createHash("sha256").update("subject:synthetic-chatgpt-account").digest("hex"));
  assert.equal(result.receipt.provider_route_receipt.subject, undefined);
  assert.equal(result.receipt.provider_route_receipt.tier, "hardest");
  assert.equal(result.receipt.configured_model_profile, "claude-opus-5-5");
  assert.equal(result.receipt.configured_effort, "max");
});

test("a hardest receipt keeps the persisted dispatch model and effort after restart config drift", async (t) => {
  const environment = await setup(t);
  const operationKey = `${KEY}:hardest:config-drift`;
  const first = environment.makePort({
    waitMs: 0,
    hardestLane: { model: "claude-opus-original", effort: "original-effort", ttl_hours: 6 }
  });
  await assert.rejects(
    first.invoke({ ...referenceCall({ operationKey }), tier: "hardest" }),
    { code: "COMPLETION_UNKNOWN" }
  );
  first.close();
  assert.equal(await environment.answerOpenItems(), 1);

  const restarted = environment.makePort({
    waitMs: 0,
    hardestLane: { model: "claude-opus-new", effort: "new-effort", ttl_hours: 6 }
  });
  t.after(() => restarted.close());
  const completed = await restarted.getCompletion(operationKey);
  assert.equal(completed.status, "completed");
  assert.equal(completed.receipt.configured_model_profile, "claude-opus-original");
  assert.equal(completed.receipt.configured_effort, "original-effort");
});

test("the exchange route loads from the environment and checks its root before any work", async (t) => {
  const { loadJournalInferencePortFromEnvironment } = await import("../src/journal-import/provider-runtime.mjs");
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "journal-exchange-route-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const exchangeRoot = path.join(base, "exchange");
  await fs.mkdir(exchangeRoot, { mode: 0o700 });
  const route = {
    schema_version: 1,
    provider: "chatgpt_connector_exchange",
    route_ref: "route:synthetic-exchange",
    model: "GPT-5.6 Sol",
    effort: "Pro",
    max_external_spend_usd: 0,
    allowance_evidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    timeout_ms: 60_000,
    exchange: { poll_ms: 1_000, ttl_ms: 3_600_000 }
  };
  const environment = (overrides = {}) => ({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify(route),
    INNER_SIGNAL_JOURNAL_INFERENCE_RECEIPT_KEY_BASE64: randomBytes(32).toString("base64"),
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: exchangeRoot,
    INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: randomBytes(32).toString("base64"),
    ...overrides
  });

  const port = loadJournalInferencePortFromEnvironment(environment(), { caseId: CASE_ID });
  const capabilities = port.capabilities();
  assert.equal(capabilities.transport, "chatgpt_connector_tool");
  assert.equal(capabilities.authoritative_completion, true);
  assert.equal(capabilities.packet_only, true);
  assert.equal(capabilities.fresh_context_per_generate, false,
    "an authenticated connector receipt does not prove the dispatcher created a fresh chat");
  assert.equal(capabilities.configured_model_profile, "GPT-5.6 Sol");
  assert.equal(capabilities.external_spend_authorized_usd, 0);
  await port.prepare();

  assert.throws(() => loadJournalInferencePortFromEnvironment(environment()), { code: "JOURNAL_EXCHANGE_CASE_INVALID" });
  assert.throws(() => loadJournalInferencePortFromEnvironment(environment({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({ ...route, max_external_spend_usd: 1 })
  }), { caseId: CASE_ID }), { code: "SUBSCRIPTION_ROUTE_REQUIRES_ZERO_EXTERNAL_SPEND" });
  assert.throws(() => loadJournalInferencePortFromEnvironment(environment({
    INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({ ...route, exchange: { ttl_ms: 5 } })
  }), { caseId: CASE_ID }), { code: "JOURNAL_EXCHANGE_CONFIG_INVALID" });
  assert.throws(() => loadJournalInferencePortFromEnvironment(environment({ INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64: "" }), { caseId: CASE_ID }),
    { code: "INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64_REQUIRED" });

  // A root inside this checkout is refused before anything is created there.
  const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const inside = path.join(repositoryRoot, "journal-exchange-must-not-exist");
  await assert.rejects(loadJournalInferencePortFromEnvironment(environment({ INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: inside }), { caseId: CASE_ID }).prepare(),
    { code: "JOURNAL_WORK_EXCHANGE_ROOT_INSIDE_REPOSITORY" });
  await assert.rejects(fs.access(inside));

  // So is a root other users can reach.
  await fs.chmod(exchangeRoot, 0o755);
  await assert.rejects(loadJournalInferencePortFromEnvironment(environment(), { caseId: CASE_ID }).prepare(), { code: "JOURNAL_WORK_EXCHANGE_ROOT_INSECURE" });
});

test("every supported hardest role refuses an indivisible oversized complete packet before publication", async () => {
  const { JOURNAL_ROLE_DEFINITIONS } = await import("../src/journal-import/provider-port.mjs");
  const port = createExchangeJournalInferencePort({ exchange: {
    async readWork() { throw new Error("oversized hardest work reached the exchange"); },
    async publishWork() { throw new Error("oversized hardest work was published"); }
  }, caseId: CASE_ID, receiptKey: Buffer.alloc(32, 41), routeRef: "route:synthetic",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    model: "gpt-6-sol", effort: "medium", waitMs: 0, executionAttestation: "codex_exec" });
  // The hardest tier runs every role but visual_reader and the pointer pass's standard-tier tagger, search writer and
  // question writer.
  const roles = Object.keys(JOURNAL_ROLE_DEFINITIONS).filter(role => port.capabilities().hardest_roles[role].available);
  assert.deepEqual(roles, Object.keys(JOURNAL_ROLE_DEFINITIONS)
    .filter(role => !["visual_reader", "pointer_tagger", "search_writer", "question_writer"].includes(role)));
  for (const role of roles) {
    const definition = JOURNAL_ROLE_DEFINITIONS[role];
    const request = referenceCall();
    request.packet = Object.fromEntries(Object.entries(request.packet).filter(([key]) =>
      !JOURNAL_ROLE_DEFINITIONS.reference_reader.fields.includes(key)));
    request.packet.output_schema_id = definition.outputSchema;
    request.packet[definition.fields.find(field => field !== "phase")] = { text: "SYNTHETIC_PACKET_SENTINEL".repeat(25_000) };
    if (role === "pattern_reviewer") request.packet.phase = "B";
    await assert.rejects(port.invoke({ ...request, role, outputSchema: definition.outputSchema,
      grant: { ...grant, allowed_roles: roles }, tier: "hardest" }), { code: "JOURNAL_WORK_PACKET_TOO_LARGE" });
  }
});

test("a hardest dispatch without explicit attempt identity is refused", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-dispatch-identity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const exchange = createJournalWorkExchange({ root, secret: Buffer.alloc(32, 41).toString("base64") });
  await assert.rejects(exchange.publishDispatch({ schema_version: 1, work_id: "job:synthetic-missing-identity",
    role: "reference_reader", tier: "hardest", output_schema_name: "reference-result",
    model: "claude-opus-5-5", effort: "max", route_ref: "route:synthetic",
    issued_at: "2026-10-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" }),
  { code: "JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED" });
});

test("a worker's terminal unanswered tombstone immediately exhausts the durable port", async () => {
  let publications = 0, sleeps = 0;
  const exchange = {
    async readWork() { return null; },
    async readResult(workId) { return { work_id: workId, retired: true, unanswered: true, exhausted: true }; },
    async publishWork() { publications += 1; },
    async listDispatch() { return []; }
  };
  const port = createExchangeJournalInferencePort({ exchange, caseId: CASE_ID, receiptKey: Buffer.alloc(32, 41),
    routeRef: "route:synthetic", model: "gpt-6-sol", effort: "medium", executionAttestation: "codex_exec",
    allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 },
    waitMs: 86_400_000, sleep: async () => { sleeps += 1; assert.fail("terminal item waited"); } });
  const store = memoryStore();
  const durable = createDurableJournalInferencePort({ port, corpusStore: store });
  const request = { ...referenceCall(), tier: "hardest" };
  await assert.rejects(durable.invoke(request), { code: "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED", submissionStatus: "exhausted" });
  const restarted = createDurableJournalInferencePort({ port, corpusStore: store });
  assert.deepEqual(await restarted.getCompletion(KEY), { status: "exhausted", code: "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED" });
  await assert.rejects(restarted.invoke(request), { submissionStatus: "exhausted" });
  assert.equal(publications, 0);
  assert.equal(sleeps, 0);
});
