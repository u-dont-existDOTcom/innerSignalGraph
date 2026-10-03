import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { buildJournalJobSnapshot, createCorpusJournalJobLedger,
  createJournalImportController, createMemoryJournalJobLedger,
  planJournalOperation } from "../src/journal-import/controller.mjs";
import { journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";
import { createDurableJournalInferencePort } from "../src/journal-import/durable-inference.mjs";
import { exchangeHarness } from "./fixtures/journal-lookahead-exchange.mjs";
import { createJournalLookahead } from "../src/journal-import/lookahead.mjs";
import { journalJobId, journalWorkPlan } from "../src/journal-import/private-runtime.mjs";
import { journalSemanticConcurrency } from "../src/journal-import/run-config.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const grant = { grant_id: "synthetic:grant", principal_id: "authorized-private-operator",
  purpose: "organize_search", allowed_roles: ["reference_reader"], revoked: false, expires_at: null };
const answer = { schema_version: "1.0", source_only_first_pass: true, reference_items: [],
  questions: [], unassessed_unit_ids: [] };
const unit = { unit_id: "unit:synthetic", representation_id: "representation:synthetic",
  start_byte: 0, end_byte: 17, page_number: null };
const packetInput = { source_windows: [{ unit_id: unit.unit_id, text: "Synthetic source." }],
  adjacent_context: { by_unit: [] }, visual_context: [], neutral_reading_instructions: [] };
const request = { id: "reference:final:unit:synthetic", role: "reference_reader",
  stage: "REFERENCE_AUDIT", unit, packetInput };
const jobId = journalJobId(request);
const secret = Buffer.alloc(32, 41);

function snapshotFor() {
  const prepared = journalWorkPlan(request);
  return buildJournalJobSnapshot({ jobId, caseId: "synthetic-case", corpusId: "synthetic-corpus",
    generation: "generation:synthetic", controllerSecret: secret, grant,
    promptVersion: `1.0:${digest(jobId).slice(0, 24)}`, modelProfile: "synthetic",
    workDefinitions: [{ key: request.role, stage: request.stage, role: request.role,
      identity: prepared.identity, assigned_core_ids: prepared.assignedCoreIds,
      source_locators: prepared.sourceLocators, packet_input: packetInput }] });
}


const tick = () => new Promise(resolve => setTimeout(resolve, 2));
async function until(predicate) {
  for (let i = 0; i < 200; i += 1) { if (await predicate()) return; await tick(); }
  assert.fail("synthetic exchange did not reach expected state");
}

test("semantic concurrency defaults to one and accepts only integers through eight", () => {
  assert.equal(journalSemanticConcurrency({}), 1);
  assert.equal(journalSemanticConcurrency({ semantic_concurrency: 8 }), 8);
  for (const value of [0, 1.5, 9, "4", null])
    assert.throws(() => journalSemanticConcurrency({ semantic_concurrency: value }),
      { code: "JOURNAL_SEMANTIC_CONCURRENCY_INVALID" });
});

test("legacy job ID and operation key remain byte for byte stable", async () => {
  const snapshot = snapshotFor();
  const planned = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  assert.equal(jobId, "job:471d8dd70ccc0a09ab1918704c78f961b8e63a78bd51f862f7fa9ef5a99e418b");
  assert.equal(planned.operationKey, "journal:287fa082f919114851268b61061d817805047c6a:2c6cf58e3318cc252d28d7173ad8229c");
  assert.equal(planned.packet.controller_provenance_tag, snapshot.work_items[0].work_id);
});

test("legacy batch extraction and dependent omission keys remain stable", async () => {
  const units = [{ unit_id: "u1", representation_id: "r1", start_byte: 0, end_byte: 10,
    page_number: null }, { unit_id: "u2", representation_id: "r2", start_byte: 10,
    end_byte: 20, page_number: null }];
  const core = units.map((item, index) => ({ unit_id: item.unit_id, text: `Synthetic ${index}` }));
  const adjacent = { by_unit: [] };
  const packetInput = { core_units: core, adjacent_context: adjacent, visual_transcriptions: [] };
  const preliminary = journalWorkPlan({ id: "extract:batch:synthetic:cycle:0", role: "extractor",
    stage: "EXTRACT", units, packetInput });
  const dependencies = [{ key: "omission", stage: "OMISSION_CHECK", role: "omission_checker",
    identity: preliminary.identity, assigned_core_ids: preliminary.assignedCoreIds,
    source_locators: preliminary.sourceLocators, packet_input: { core_units: core,
      adjacent_context: adjacent, candidate_extraction: { $work_output: "extractor" },
      target_generation: "generation:synthetic" } }];
  const batchRequest = { id: "extract:batch:synthetic:cycle:0", role: "extractor",
    stage: "EXTRACT", units, packetInput, dependencies };
  const batchJobId = journalJobId(batchRequest);
  const snapshot = buildJournalJobSnapshot({ jobId: batchJobId, caseId: "synthetic-case",
    corpusId: "synthetic-corpus", generation: "generation:synthetic",
    controllerSecret: secret, grant: { ...grant,
      allowed_roles: ["extractor", "omission_checker"] },
    promptVersion: `1.0:${digest(batchJobId).slice(0, 24)}`, modelProfile: "synthetic",
    workDefinitions: [{ key: "extractor", stage: "EXTRACT", role: "extractor",
      identity: preliminary.identity, assigned_core_ids: preliminary.assignedCoreIds,
      source_locators: preliminary.sourceLocators, packet_input: packetInput }, ...dependencies] });
  const batchGrant = { ...grant, allowed_roles: ["extractor", "omission_checker"] };
  const primary = await planJournalOperation({ work: snapshot.work_items[0], snapshot,
    grant: batchGrant });
  snapshot.work_items[0].status = "completed";
  snapshot.work_items[0].output = { schema_version: "1.0", status: "complete",
    entities: [], episodes: [], assertions: [], coverage: core.map(item => ({
      unit_id: item.unit_id, disposition: "no_assertion", assertion_local_ids: [],
      reason: "Synthetic." })), requested_context: [] };
  const omission = await planJournalOperation({ work: snapshot.work_items[1], snapshot,
    grant: batchGrant });
  // These values moved once, when the extractor and omission checker instructions (part of every job
  // ID) changed in #121; with those instructions as they were before, the shared plan reproduces the
  // earlier values exactly.
  assert.equal(batchJobId, "job:ffa099f34eb5d0c0f8ae6c859cbb7133fcd240403b16b9628cc9928f363116cb");
  assert.equal(primary.operationKey,
    "journal:4affefc729b17d2cf81b4d5117a0aff5801b09bc:78d064b11dc0fc7e109ad600c462dd45");
  assert.equal(omission.operationKey,
    "journal:cf2d3045dcbf53a9b70b9261f1fe8dedc0256c4d:4e69ed1d71bf12a33b1fabd70e866afe");
});

test("prefetch publishes once, peek is read only, and invoke consumes the same item", async () => {
  const h = exchangeHarness();
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  assert.deepEqual(await h.port.peek(operationKey), { status: "not_submitted" });
  assert.equal((await h.port.prefetch(input)).published, true);
  const id = journalExchangeWorkId(operationKey);
  assert.deepEqual(await h.port.peek(operationKey), { status: "pending" });
  const before = [h.work.size, h.results.size, h.dispatch.size];
  await h.port.peek(operationKey);
  assert.deepEqual([h.work.size, h.results.size, h.dispatch.size], before);
  assert.equal((await h.port.prefetch(input)).published, false);
  await assert.rejects(h.port.prefetch({ ...input, packet: { ...packet,
    source_windows: [{ unit_id: unit.unit_id, text: "Different synthetic source." }] } }),
    { code: "OPERATION_KEY_CONFLICT" });
  await assert.rejects(h.port.prefetch({ ...input, tier: "hardest" }),
    { code: "JOURNAL_PREFETCH_TIER_UNSUPPORTED" });
  h.answerWork(id);
  assert.deepEqual(await h.port.peek(operationKey), { status: "completed", output: answer });
  assert.deepEqual((await h.port.invoke(input)).output, answer);
  assert.equal(h.successful.get(id), 1);
  await h.port.release(operationKey);
  assert.deepEqual(await h.port.peek(operationKey), { status: "retired" });
  h.port.close();
});

test("peek reports invalid answers without retiring or dispatching", async () => {
  const h = exchangeHarness();
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  await h.port.prefetch({ role: "reference_reader", packet, outputSchema: "reference-result",
    operationKey, grant });
  const id = journalExchangeWorkId(operationKey);
  h.answerWork(id, { schema_version: "1.0", reference_items: "invalid" });
  const before = [h.work.size, h.results.size, h.dispatch.size];
  assert.deepEqual(await h.port.peek(operationKey), { status: "invalid_output" });
  assert.deepEqual([h.work.size, h.results.size, h.dispatch.size], before);
  assert.equal(h.results.get(id).retired, undefined);
  h.port.close();
});

test("an expired lookahead item is replaced before the sequential send", async () => {
  let time = Date.parse("2026-10-01T00:00:00.000Z");
  const h = exchangeHarness({ now: () => new Date(time), ttlMs: 10 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  await h.port.prefetch({ role: "reference_reader", packet, outputSchema: "reference-result",
    operationKey, grant });
  const id = journalExchangeWorkId(operationKey);
  time += 11;
  assert.deepEqual(await h.port.peek(operationKey), { status: "expired" });
  assert.equal(h.results.has(id), false);
  assert.equal(h.dispatch.has(id), true);
  const waiting = h.port.invoke({ role: "reference_reader", packet,
    outputSchema: "reference-result", operationKey, grant });
  await until(() => h.dispatch.has(journalExchangeWorkId(operationKey, 1)));
  h.answerWork(journalExchangeWorkId(operationKey, 1));
  assert.deepEqual((await waiting).output, answer);
  assert.equal(h.results.get(id).retired, true);
  await assert.rejects(h.port.prefetch({ role: "reference_reader", packet,
    outputSchema: "reference-result", operationKey, grant }),
  { code: "JOURNAL_PREFETCH_RETRY_UNSUPPORTED" });
  assert.equal(h.work.has(journalExchangeWorkId(operationKey, 1)), true);
  h.port.close();
});

test("a changed grant replaces unanswered or answered speculative work without a key conflict", async () => {
  for (const answered of [false, true]) {
    const h = exchangeHarness();
    const snapshot = snapshotFor();
    const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
    const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
    await h.port.prefetch(input);
    if (answered) h.answerWork(journalExchangeWorkId(operationKey));
    const changed = { ...grant, grant_id: "synthetic:changed" };
    const waiting = h.port.invoke({ ...input, grant: changed });
    const successor = journalExchangeWorkId(operationKey, 1);
    await until(() => h.dispatch.has(successor));
    h.answerWork(successor);
    assert.deepEqual((await waiting).output, answer);
    assert.equal(h.results.get(journalExchangeWorkId(operationKey)).retired, true);
    assert.equal(h.results.get(journalExchangeWorkId(operationKey)).superseded ?? false, answered);
    h.port.close();
  }
});

test("a retired answer with a surviving work file conflicts without a close loop", async () => {
  const h = exchangeHarness({ maxCloseAttempts: 1 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  await h.port.prefetch(input);
  const id = journalExchangeWorkId(operationKey);
  // retireWork wrote its tombstone, then crashed before unlinking the speculative work file.
  h.results.set(id, { retired: true });
  await assert.rejects(h.port.invoke({ ...input, grant: { ...grant, grant_id: "synthetic:new-grant" } }),
    { code: "OPERATION_KEY_CONFLICT" });
  assert.equal(h.closeAttempts(), 0);
  assert.equal(h.work.size, 1);
  h.port.close();
});

test("a consumed answer whose work file is gone reports an unknown completion, as on main", async () => {
  const h = exchangeHarness({ maxCloseAttempts: 1 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  const id = journalExchangeWorkId(operationKey);
  // An earlier run's answer was used and retired: tombstone present, work file removed.
  h.results.set(id, { retired: true });
  for (const call of [input, { ...input, grant: { ...grant, grant_id: "synthetic:other-grant" } }]) {
    await assert.rejects(h.port.invoke(call), { code: "COMPLETION_UNKNOWN" });
  }
  assert.equal(h.work.size, 0);
  assert.equal(h.closeAttempts(), 0);
  h.port.close();
});

test("a failed close race cannot spin beyond the successor limit", async () => {
  const h = exchangeHarness({ closeNeverSucceeds: true, maxCloseAttempts: 8 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  await h.port.prefetch(input);
  await assert.rejects(h.port.invoke({ ...input, grant: { ...grant, grant_id: "synthetic:changed" } }),
    { code: "JOURNAL_EXCHANGE_RETRY_LIMIT" });
  assert.equal(h.closeAttempts(), 8);
  h.port.close();
});

test("an adopted speculative item keeps main's conflict and expiry behavior across port restart", async () => {
  let time = Date.parse("2026-10-01T00:00:00.000Z");
  const h = exchangeHarness({ waitMs: 0, now: () => new Date(time), ttlMs: 10 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  await h.port.prefetch(input);
  await assert.rejects(h.port.invoke(input), { code: "COMPLETION_UNKNOWN" });
  const id = journalExchangeWorkId(operationKey);
  assert.equal(h.adopted.has(id), true);
  const restarted = h.makePort();
  await assert.rejects(restarted.invoke({ ...input, grant: { ...grant, grant_id: "synthetic:changed" } }),
    { code: "OPERATION_KEY_CONFLICT" });
  time += 11;
  await assert.rejects(restarted.invoke(input), { code: "JOURNAL_WORK_EXPIRED", submissionStatus: "not_submitted" });
  assert.equal(h.results.get(id).unanswered, true);
  assert.equal(h.work.has(journalExchangeWorkId(operationKey, 1)), false,
    "the adopted invocation spends its attempt before a successor is sent");
  restarted.close(); h.port.close();
});

test("a sequential call that loses the publish race to a speculative item adopts it", async () => {
  let time = Date.parse("2026-10-01T00:00:00.000Z");
  const h = exchangeHarness({ waitMs: 0, now: () => new Date(time), ttlMs: 10,
    // The lookahead publishes the same item between the sequential call's read and its own publication.
    beforePublish: (entry, work) => {
      if (entry.origin !== "lookahead" && !work.has(entry.work_id))
        work.set(entry.work_id, { ...structuredClone(entry), origin: "lookahead" });
    } });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  await assert.rejects(h.port.invoke(input), { code: "COMPLETION_UNKNOWN" });
  const id = journalExchangeWorkId(operationKey);
  assert.equal(h.work.get(id).origin, "lookahead");
  assert.equal(h.adopted.has(id), true);
  time += 11;
  const restarted = h.makePort();
  await assert.rejects(restarted.invoke(input), { code: "JOURNAL_WORK_EXPIRED", submissionStatus: "not_submitted" });
  assert.equal(h.work.has(journalExchangeWorkId(operationKey, 1)), false,
    "the adopted item expires as the sequential call's own attempt; no successor is sent for it");
  restarted.close(); h.port.close();
});

test("a sequential call interrupted after its intent resumes on the speculative item", async (t) => {
  const h = exchangeHarness({ waitMs: 0 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  await h.port.prefetch({ role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant });
  const id = journalExchangeWorkId(operationKey);
  h.answerWork(id);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-resume-corpus-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const corpus = createPrivateJournalCorpusStore({ rootDir: root, caseId: "synthetic-case",
    corpusId: "synthetic-corpus", corpusKey: Buffer.alloc(32, 19) });
  t.after(() => corpus.close());
  const durable = createDurableJournalInferencePort({ port: h.port, corpusStore: corpus });
  const ledger = createMemoryJournalJobLedger();
  const definitions = [{ key: request.role, stage: request.stage, role: request.role,
    identity: journalWorkPlan(request).identity, assigned_core_ids: [unit.unit_id],
    source_locators: journalWorkPlan(request).sourceLocators, packet_input: packetInput }];
  // The first run records its intent, then stops before its call reaches the exchange.
  const interrupted = createJournalImportController({ ledger, controllerSecret: secret, grant,
    promptVersion: snapshot.prompt_version, modelProfile: "synthetic",
    inferencePort: { ...durable, invoke: () => new Promise(() => {}) } });
  await interrupted.initialize({ jobId, caseId: "synthetic-case", corpusId: "synthetic-corpus",
    generation: "generation:synthetic", workDefinitions: definitions });
  interrupted.runUntilBlocked();
  await until(async () => (await ledger.load()).snapshot.work_items[0].status === "intent_persisted");
  const resumed = [];
  const controller = createJournalImportController({ ledger, inferencePort: durable, controllerSecret: secret,
    grant, promptVersion: snapshot.prompt_version, modelProfile: "synthetic",
    beforeInvoke: async (call) => { resumed.push(call.resumed === true); } });
  const result = await controller.runUntilBlocked();
  const [work] = result.snapshot.work_items;
  assert.equal(work.status, "completed");
  assert.equal(work.attempts, 1);
  assert.equal(work.operation_key, operationKey);
  assert.deepEqual(resumed, [true], "the access check runs again before the resumed call");
  assert.equal(h.adopted.has(id), true);
  assert.equal(h.published.length, 1, "no second item is published for the interrupted call");
  controller.close(); h.port.close();
});

test("controller consumes expired or changed lookahead work on its first attempt", async () => {
  for (const variant of ["expired", "changed-grant"]) {
    let time = Date.parse("2026-10-01T00:00:00.000Z");
    const h = exchangeHarness({ now: () => new Date(time), ttlMs: 10 });
    const snapshot = snapshotFor();
    const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
    await h.port.prefetch({ role: "reference_reader", packet,
      outputSchema: "reference-result", operationKey, grant });
    if (variant === "expired") time += 11;
    const controllerGrant = variant === "changed-grant"
      ? { ...grant, grant_id: "synthetic:new-grant" } : grant;
    const ledger = createMemoryJournalJobLedger();
    const controller = createJournalImportController({ ledger, inferencePort: h.port,
      controllerSecret: secret, grant: controllerGrant, promptVersion: snapshot.prompt_version,
      modelProfile: "synthetic" });
    await controller.initialize({ jobId, caseId: "synthetic-case", corpusId: "synthetic-corpus",
      generation: "generation:synthetic", workDefinitions: [{ key: request.role,
        stage: request.stage, role: request.role, identity: journalWorkPlan(request).identity,
        assigned_core_ids: [unit.unit_id], source_locators: journalWorkPlan(request).sourceLocators,
        packet_input: packetInput }] });
    const running = controller.runUntilBlocked();
    await until(() => h.dispatch.has(journalExchangeWorkId(operationKey, 1)));
    h.answerWork(journalExchangeWorkId(operationKey, 1));
    const result = await running;
    assert.equal(result.snapshot.work_items[0].status, "completed", variant);
    assert.equal(result.snapshot.work_items[0].attempts, 1, variant);
    assert.equal(result.snapshot.work_items[0].operation_key, operationKey, variant);
    controller.close(); h.port.close();
  }
});

test("lookahead uses a pure snapshot and never persists controller or durable records", async (t) => {
  const h = exchangeHarness();
  const ledger = createMemoryJournalJobLedger();
  const snapshot = snapshotFor();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-lookahead-corpus-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const corpus = createPrivateJournalCorpusStore({ rootDir: root, caseId: "synthetic-case",
    corpusId: "synthetic-corpus", corpusKey: Buffer.alloc(32, 19) });
  t.after(() => corpus.close());
  const readOnlyLedger = createCorpusJournalJobLedger({ corpusStore: corpus, jobId });
  const filesBefore = await fs.readdir(root, { recursive: true });
  const lookahead = createJournalLookahead({ limit: 4, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: async () => ({ snapshot: (await readOnlyLedger.load())?.snapshot ?? snapshot }) });
  lookahead.ahead([{ jobId }]);
  const planned = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const id = journalExchangeWorkId(planned.operationKey);
  await until(() => h.dispatch.has(id));
  assert.equal(await ledger.load(), null);
  h.answerWork(id);
  await until(() => lookahead.summary().sent === 1);
  await lookahead.close();
  assert.deepEqual(await fs.readdir(root, { recursive: true }), filesBefore,
    "lookahead must not create ledger, durable intent/result or reference marker objects");
  const controller = createJournalImportController({ ledger, inferencePort: h.port,
    controllerSecret: secret, grant, promptVersion: snapshot.prompt_version,
    modelProfile: "synthetic" });
  await controller.initialize({ jobId, caseId: "synthetic-case", corpusId: "synthetic-corpus",
    generation: "generation:synthetic", workDefinitions: [{ key: request.role,
      stage: request.stage, role: request.role, identity: journalWorkPlan(request).identity,
      assigned_core_ids: [unit.unit_id], source_locators: journalWorkPlan(request).sourceLocators,
      packet_input: packetInput }] });
  const result = await controller.runUntilBlocked();
  lookahead.markUsed(result.snapshot.work_items[0].operation_key);
  assert.equal(result.snapshot.work_items[0].status, "completed");
  assert.equal(result.snapshot.work_items[0].operation_key, planned.operationKey);
  assert.equal(h.successful.get(id), 1);
  assert.equal(lookahead.summary().used, 1);
  controller.close(); h.port.close();
});

test("retry states, revocation, and capacity bound stop lookahead sends", async () => {
  const h = exchangeHarness();
  const blocked = snapshotFor();
  blocked.work_items[0].status = "blocked_authority";
  const invalid = snapshotFor();
  invalid.work_items[0].status = "invalid_output";
  const spent = snapshotFor();
  spent.work_items[0].attempts = 1;
  const epoch = snapshotFor();
  epoch.work_items[0].retry_epoch = 1;
  const keyed = snapshotFor();
  keyed.work_items[0].operation_key = "journal:prior";
  const lookahead = createJournalLookahead({ limit: 4, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: async descriptor => ({ snapshot: descriptor.snapshot }) });
  lookahead.ahead([{ jobId: "blocked", snapshot: blocked }, { jobId: "invalid", snapshot: invalid },
    { jobId: "spent", snapshot: spent }, { jobId: "epoch", snapshot: epoch },
    { jobId: "keyed", snapshot: keyed }]);
  await tick();
  lookahead.ahead([{ jobId: "epoch", snapshot: epoch }, { jobId: "keyed", snapshot: keyed }]);
  await tick();
  await lookahead.close();
  assert.equal(h.work.size, 0);
  const descriptors = Array.from({ length: 5 }, (_, index) => {
    const operationKey = `synthetic:direct:${index}`;
    return { jobId: operationKey, direct: { role: "reference_reader", packet: {
      ...packetInput, protocol_version: "1.0", output_schema_id: "reference-result",
      assigned_core_ids: [unit.unit_id], source_locators: journalWorkPlan(request).sourceLocators,
      expected_generation: "generation:synthetic", controller_provenance_tag: operationKey,
      grant_purpose: grant.purpose }, outputSchema: "reference-result", operationKey } };
  });
  const bounded = createJournalLookahead({ limit: 4, port: h.port, grant, pollMs: 1,
    authorize: async () => {}, prepare: async descriptor => ({ direct: descriptor.direct }) });
  bounded.ahead(descriptors);
  await until(() => h.dispatch.size === 3);
  assert.equal(h.dispatch.size, 3);
  await bounded.close();
  let checks = 0;
  const denied = createJournalLookahead({ limit: 4, port: h.port, grant, pollMs: 1,
    authorize: async () => { checks += 1; throw new Error("revoked"); },
    prepare: async descriptor => ({ direct: descriptor.direct }) });
  denied.ahead(descriptors.slice(3));
  await denied.close();
  assert.equal(h.dispatch.size, 3);
  assert.equal(denied.summary().sent, 0);
  assert.ok(checks <= 2);
  h.port.close();
});

test("a work item keeps its lookahead slot when dispatch publication fails", async () => {
  const h = exchangeHarness({ failDispatch: true });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const direct = { role: "reference_reader", packet, outputSchema: "reference-result",
    operationKey, grant };
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: async descriptor => ({ direct: descriptor.direct }) });
  lookahead.ahead([{ jobId: "first", direct }]);
  await until(() => h.work.size === 1);
  lookahead.ahead([{ jobId: "second", direct: { ...direct, operationKey: `${operationKey}:second` } }]);
  await tick();
  assert.equal(h.work.size, 1);
  assert.equal(lookahead.summary().sent, 1);
  assert.equal(lookahead.summary().errors, 1);
  await lookahead.close();
  h.port.close();
});

test("a speculative item gets its dispatch record once publication recovers, keeping its slot meanwhile", async (t) => {
  let dispatchFails = true;
  const h = exchangeHarness({ failDispatch: () => dispatchFails });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const direct = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant, authorize: async () => {}, pollMs: 1,
    prepare: async descriptor => ({ direct: descriptor.direct }) });
  t.after(() => lookahead.close());
  lookahead.ahead([{ jobId: "first", direct },
    { jobId: "second", direct: { ...direct, operationKey: `${operationKey}:second` } }]);
  const id = journalExchangeWorkId(operationKey);
  await until(() => h.work.size === 1);
  for (let index = 0; index < 20; index += 1) await tick();
  assert.equal(h.dispatch.has(id), false);
  assert.equal(h.work.size, 1, "the item without a dispatch record still holds the only slot");
  assert.equal(lookahead.summary().errors, 1, "one failing stretch counts once");
  dispatchFails = false;
  await until(() => h.dispatch.has(id));
  h.answerWork(id);
  await until(() => h.work.size === 2);
  assert.equal(lookahead.summary().sent, 2);
  await lookahead.close();
  h.port.close();
});

test("a published lookahead item keeps its slot while reading the exchange fails", async (t) => {
  const h = exchangeHarness();
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const direct = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  let readFails = true;
  const port = { ...h.port, peek: async (key) => {
    if (readFails) throw new Error("synthetic exchange read failure");
    return h.port.peek(key);
  } };
  const lookahead = createJournalLookahead({ limit: 2, port, grant, authorize: async () => {}, pollMs: 1,
    prepare: async descriptor => ({ direct: descriptor.direct }) });
  t.after(() => lookahead.close());
  lookahead.ahead([{ jobId: "first", direct },
    { jobId: "second", direct: { ...direct, operationKey: `${operationKey}:second` } }]);
  await until(() => h.work.size === 1);
  for (let index = 0; index < 20; index += 1) await tick();
  assert.equal(h.work.size, 1, "the unanswered item still holds the only slot");
  assert.equal(lookahead.summary().errors, 1, "one failing stretch counts once");
  readFails = false;
  h.answerWork(journalExchangeWorkId(operationKey));
  await until(() => h.work.size === 2);
  await lookahead.close();
  h.port.close();
});

test("an expired lookahead item frees its task slot", async () => {
  let time = Date.parse("2026-10-01T00:00:00.000Z");
  const h = exchangeHarness({ now: () => new Date(time), ttlMs: 10 });
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const direct = { role: "reference_reader", packet, outputSchema: "reference-result",
    operationKey, grant };
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: async descriptor => ({ direct: descriptor.direct }) });
  lookahead.ahead([{ jobId: "first", direct }]);
  await until(() => h.work.size === 1);
  time += 11;
  const second = { jobId: "second", direct: { ...direct, operationKey: `${operationKey}:second` } };
  await until(async () => {
    lookahead.ahead([second]);
    return h.work.size === 2;
  });
  await lookahead.close();
  h.port.close();
});

test("a future descriptor read error is counted inside lookahead", async () => {
  const h = exchangeHarness();
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: descriptor => descriptor.build() });
  assert.doesNotThrow(() => lookahead.ahead([{ jobId: "future",
    build: async () => { throw new Error("synthetic future read failed"); } }]));
  await until(() => lookahead.summary().errors === 1);
  assert.equal(h.work.size, 0);
  await lookahead.close();
  h.port.close();
});

test("empty descriptors leave slots for later work and hardest direct requests are skipped", async () => {
  const h = exchangeHarness();
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const direct = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey };
  const prepared = [];
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: async descriptor => {
      prepared.push(descriptor.jobId);
      return descriptor.jobId === "empty" ? null : { direct: descriptor.direct };
    } });
  lookahead.ahead([{ jobId: "empty" },
    { jobId: "hardest", direct: { ...direct, operationKey: `${operationKey}:hardest`, tier: "hardest" } },
    { jobId: "standard", direct }]);
  await until(() => h.dispatch.has(journalExchangeWorkId(operationKey)));
  assert.deepEqual(prepared, ["empty", "hardest", "standard"]);
  assert.equal(h.work.has(journalExchangeWorkId(`${operationKey}:hardest`)), false);
  h.answerWork(journalExchangeWorkId(operationKey));
  await lookahead.close();
  h.port.close();
});

test("a closed lookahead resumes the same pending exchange item on a new run", async () => {
  const h = exchangeHarness();
  const snapshot = snapshotFor();
  const { packet, operationKey } = await planJournalOperation({ work: snapshot.work_items[0], snapshot, grant });
  const input = { role: "reference_reader", packet, outputSchema: "reference-result", operationKey, grant };
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant,
    authorize: async () => {}, pollMs: 1,
    prepare: async () => ({ direct: input }) });
  lookahead.ahead([{ jobId }]);
  const id = journalExchangeWorkId(operationKey);
  await until(() => h.dispatch.has(id));
  await lookahead.close();
  const restarted = h.makePort();
  const waiting = restarted.invoke(input);
  await tick();
  h.answerWork(id);
  assert.deepEqual((await waiting).output, answer);
  assert.equal(h.successful.get(id), 1);
  restarted.close(); h.port.close();
});

test("a revoked access check prevents further lookahead publication", async () => {
  const h = exchangeHarness();
  let authorized = true;
  const descriptors = ["one", "two"].map(label => ({ jobId: label,
    direct: { role: "reference_reader", outputSchema: "reference-result",
      operationKey: `synthetic:${label}`, packet: {
        ...packetInput, protocol_version: "1.0", output_schema_id: "reference-result",
        assigned_core_ids: [unit.unit_id], source_locators: journalWorkPlan(request).sourceLocators,
        expected_generation: "generation:synthetic", controller_provenance_tag: `synthetic:${label}`,
        grant_purpose: grant.purpose } } }));
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant, pollMs: 1,
    authorize: async () => { if (!authorized) throw new Error("revoked"); },
    prepare: async descriptor => ({ direct: descriptor.direct }) });
  lookahead.ahead(descriptors);
  await until(() => h.dispatch.size === 1);
  // Access is revoked while the first item is out; when its slot frees, the next descriptor is refused.
  authorized = false;
  h.answerWork(journalExchangeWorkId(descriptors[0].direct.operationKey));
  await until(() => lookahead.summary().errors === 1);
  await lookahead.close();
  assert.equal(h.dispatch.size, 1);
  assert.equal(lookahead.summary().sent, 1);
  h.port.close();
});

test("a slot that frees up takes the next descriptor without another ahead call", async () => {
  const h = exchangeHarness();
  const descriptors = ["reference", "extraction", "later"].map(label => ({ jobId: label,
    direct: { role: "reference_reader", outputSchema: "reference-result",
      operationKey: `synthetic:${label}`, packet: {
        ...packetInput, protocol_version: "1.0", output_schema_id: "reference-result",
        assigned_core_ids: [unit.unit_id], source_locators: journalWorkPlan(request).sourceLocators,
        expected_generation: "generation:synthetic", controller_provenance_tag: `synthetic:${label}`,
        grant_purpose: grant.purpose } } }));
  const lookahead = createJournalLookahead({ limit: 2, port: h.port, grant, pollMs: 1,
    authorize: async () => {}, prepare: async descriptor => ({ direct: descriptor.direct }) });
  lookahead.ahead(descriptors);
  await until(() => h.dispatch.size === 1);
  assert.equal(h.dispatch.has(journalExchangeWorkId("synthetic:extraction")), false, "one slot at a time");
  h.answerWork(journalExchangeWorkId("synthetic:reference"));
  await until(() => h.dispatch.has(journalExchangeWorkId("synthetic:extraction")));
  // A newer view of upcoming work replaces descriptors that never started.
  lookahead.ahead([]);
  h.answerWork(journalExchangeWorkId("synthetic:extraction"));
  await until(() => lookahead.summary().sent === 2 && [...h.results.keys()].length === 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.dispatch.has(journalExchangeWorkId("synthetic:later")), false);
  await lookahead.close();
  assert.equal(lookahead.summary().sent, 2);
  h.port.close();
});

test("resumed unsent and invalid epochs keep their sequential operation keys", async () => {
  const runEpoch = async (status, withLookahead) => {
    const ledger = createMemoryJournalJobLedger();
    const snapshot = snapshotFor();
    const work = snapshot.work_items[0];
    work.status = status;
    work.attempts = 1;
    work.operation_key = "journal:old-attempt";
    work.last_failure = { code: status === "blocked_authority" ? "RETRYABLE_TRANSPORT"
      : "INVALID_STRUCTURED_OUTPUT", submission_status: "not_submitted" };
    snapshot.checkpoint = { state: status === "blocked_authority" ? "blocked_authority"
      : "retryable_error", blocked_reason: work.last_failure.code };
    await ledger.append(snapshot, -1);
    const invoked = [];
    const port = { capabilities: () => ({ authoritative_completion: true }),
      async invoke(input) { invoked.push(input.operationKey); return { output: answer, receipt: null }; },
      async getCompletion() { return { status: "not_submitted" }; },
      async isAuthoritativeCompletion() { return true; } };
    const controller = createJournalImportController({ ledger, inferencePort: port,
      controllerSecret: secret, grant, promptVersion: snapshot.prompt_version,
      modelProfile: snapshot.model_profile });
    if (withLookahead) {
      const prefetched = [];
      const ahead = createJournalLookahead({ limit: 4, grant, port: {
        async prefetch(input) { prefetched.push(input.operationKey); },
        async peek() { return { status: "not_submitted" }; } },
        authorize: async () => {}, prepare: async () => ({ snapshot }) });
      ahead.ahead([{ jobId }]);
      await tick();
      await ahead.close();
      assert.deepEqual(prefetched, []);
      assert.equal(ahead.summary().sent, 0);
    }
    const result = await controller.runUntilBlocked();
    controller.close();
    assert.equal(result.snapshot.work_items[0].status, "completed");
    return invoked;
  };
  for (const status of ["blocked_authority", "invalid_output"]) {
    const sequential = await runEpoch(status, false);
    assert.deepEqual(await runEpoch(status, true), sequential);
    assert.equal(sequential.length, 1);
    assert.match(sequential[0], status === "blocked_authority"
      ? /:unsent-retry:1:0$/ : /:reserialize$/);
  }
});
