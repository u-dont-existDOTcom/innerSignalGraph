import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ValidationError } from "../src/core/errors.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { createMockJournalInferencePort, JournalInferencePortError } from "../src/journal-import/provider-port.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { exchangeHarness } from "./fixtures/journal-lookahead-exchange.mjs";
import { createJournalLookahead } from "../src/journal-import/lookahead.mjs";
import { journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";
import { createDeterministicAuditSample } from "../src/journal-import/audit.mjs";

// A synthetic import driven from intake to a committed generation through the operator commands,
// with every role answered by a mock. Each test makes one role answer the way a real journal
// sometimes does, and checks that the run finishes with that counted instead of stopping for good.

const CASE_ID = "synthetic-case";
const WRITER = "synthetic-operator-token";
const READER = "synthetic-reader-token";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const randomObjectRef = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
async function corpusObjectIds(executionRoot) {
  const root = path.join(executionRoot, ".journal-corpora");
  let files;
  try { files = (await fs.readdir(root, { recursive: true })).filter(name => name.endsWith(".journal-object.json")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return (await Promise.all(files.map(async name => JSON.parse(await fs.readFile(path.join(root, name), "utf8")).object_id))).sort();
}
function assertSameCorpusObjects(actual, expected) {
  assert.equal(actual.length, expected.length, "lookahead changed the corpus object count");
  const stable = ids => ids.map(id => id.replace(randomObjectRef, "<random-ref>")).sort();
  assert.deepEqual(stable(actual), stable(expected), "lookahead changed the corpus object IDs");
}
const TEXTS = [
  "Synthetic Monday: I walked by the river and felt calm.",
  "Synthetic Wednesday: I walked by the river again and felt calm.",
  "Synthetic Friday: I stayed home and wrote a letter."
];

async function environment(t, entries = TEXTS) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-finish-synthetic-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  const text = entries.join("\n");
  await fs.writeFile(path.join(root, "private", "source.txt"), text, { mode: 0o600 });
  const credentialsPath = path.join(root, "credentials.json");
  await fs.writeFile(credentialsPath, `${JSON.stringify({ schema_version: 1, root_dir: path.join(root, "vaults"), grants: [
    { token_sha256: sha256(WRITER), principal_id: "journal-operator", case_ids: [CASE_ID], scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] },
    { token_sha256: sha256(READER), principal_id: "test-reader", case_ids: [CASE_ID], scopes: ["case:read"], purposes: ["organize_search"] }
  ], case_keys: { [CASE_ID]: { routine_kek_base64: Buffer.alloc(32, 7).toString("base64"), recovery_secret_base64: Buffer.alloc(32, 9).toString("base64") } } })}\n`, { mode: 0o600 });
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  await service.appendJournal(CASE_ID, { id: "legacy-synthetic", observed_at: "2026-01-01T00:00:00.000Z", kind: "journal", text: "Invented legacy entry" }, { bearerToken: WRITER });
  const config = { schema_version: 1, max_external_spend_usd: 0, execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(text), sha256: sha256(text) },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:grant",
    semantic_batching: { calibration_maximum_units: 3, maximum_units: 3 } };
  const configPath = path.join(root, "private", "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  // One page per entry, so each is its own unit.
  const sourceParser = async () => ({
    source: { sha256: config.source.sha256, byte_length: config.source.bytes, mime_type: "text/plain" }, parser: { version: "synthetic-finish" },
    pages: entries.map((_, index) => ({ page_number: index + 1, representation_id: `synthetic:page:${index}`, disposition: "readable", warnings: [], image_inventory: [] })),
    representations: entries.map((entry, index) => ({ representation_id: `synthetic:page:${index}`, text: entry, utf8_byte_length: Buffer.byteLength(entry) }))
  });
  return { root, config, configPath, service, sourceParser, environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER } };
}

const unknownTime = { raw: null, from: null, to: null, precision: "unknown", timezone: null, basis: "unresolved", evidence_ids: [] };
const review = (role, packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, review_role: role,
  assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });

function scannedParser(f, pages) {
  return async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "application/pdf" }, parser: { version: "synthetic-scan" },
    pages: pages.map(page => ({ page_number: page, representation_id: `scan:${page}`,
      disposition: "visual_pending", warnings: ["no_native_text"], image_inventory: [{ kind: "scan" }],
      geometry: { width: 100, height: 100 } })),
    representations: pages.map(page => ({ representation_id: `scan:${page}`, text: "", utf8_byte_length: 0 })) });
}

function oneUnitParser(f) {
  const text = TEXTS[0];
  return async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "text/plain" }, parser: { version: "synthetic-one" },
    pages: [{ page_number: 1, representation_id: "synthetic:one", disposition: "readable", warnings: [], image_inventory: [] }],
    representations: [{ representation_id: "synthetic:one", text, utf8_byte_length: Buffer.byteLength(text) }] });
}

function denseExtractor(count) {
  return packet => {
    const unit = packet.core_units[0];
    const assertions = Array.from({ length: count }, (_, index) => ({ local_id: `dense-${index}`,
      statement: `Synthetic dense statement ${index}: ${"detail ".repeat(28)}`, assertion_kind: "direct_report",
      narrative_mode: "waking", speaker_local_id: "self", subject_local_ids: ["self"], episode_local_id: null,
      polarity: "affirmed", qualifiers: [], authored_time: unknownTime, event_time: unknownTime,
      anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }],
      importance_reasons: ["synthetic"], extraction_confidence: "high" }));
    return { schema_version: "1.0", status: "complete", entities: [{ local_id: "self", label: "Synthetic diarist",
      entity_kind: "person", anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }] }], episodes: [], assertions,
      coverage: [{ unit_id: unit.unit_id, disposition: "extracted",
        assertion_local_ids: assertions.map(item => item.local_id), reason: null }], requested_context: [] };
  };
}

// Answers that let every stage finish cleanly; a test overrides the one it exercises.
function handlers(overrides = {}) {
  return {
    reference_reader: () => ({ schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] }),
    extractor: (packet) => {
      const units = packet.core_units;
      return {
        schema_version: "1.0", status: "complete",
        entities: [{ local_id: "self", label: "Synthetic diarist", entity_kind: "person", anchors: [{ unit_id: units[0].unit_id, quote: units[0].text, occurrence: null }] }],
        episodes: [],
        assertions: units.map((unit, index) => ({ local_id: `a${index}`, statement: `Synthetic report ${index}.`, assertion_kind: "direct_report",
          narrative_mode: "waking", speaker_local_id: "self", subject_local_ids: ["self"], episode_local_id: null, polarity: "affirmed", qualifiers: [],
          authored_time: unknownTime, event_time: unknownTime, anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }],
          importance_reasons: ["synthetic"], extraction_confidence: "high" })),
        coverage: units.map((unit, index) => ({ unit_id: unit.unit_id, disposition: "extracted", assertion_local_ids: [`a${index}`], reason: null })),
        requested_context: []
      };
    },
    omission_checker: (packet) => review("omission_checker", packet),
    // Preserves every reference item and every candidate it is asked to assess.
    fidelity_auditor: (packet) => ({ ...review("fidelity_auditor", packet),
      assessments: [...(packet.frozen_reference?.reference_items ?? []).map(({ id }) => id), ...(packet.imported_generation?.assessment_target_ids ?? [])]
        .map((id) => ({ target_id: id, outcome: "preserved", critical: false, finding_type: "none", explanation: "Synthetic check preserved it.", evidence_ids: [] })) }),
    reconciler: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, proposals: [], unresolved_ids: [], status: "proposals_complete" }),
    pattern_builder: (packet) => {
      const assertions = packet.validated_graph.nodes.filter((node) => node.kind === "assertion").map((node) => node.id);
      return { schema_version: "1.0", target_generation: packet.target_generation,
        patterns: [{ local_id: "river", data: {
          statement: "Synthetic walks by the river come with calm.", pattern_kind: "recurrent", scope: "Two invented entries.",
          support_assertion_ids: assertions.slice(0, 2), counter_assertion_ids: [], alternative_explanations: ["Coincidence."],
          observation_gaps: ["Unwritten days."], disconfirming_question: "Is there a walk without calm?",
          disconfirmation: { status: "pending", search_receipt_ref: null }, review_state: "provisional", independent_review_ref: null,
          producer_ref: "producer:synthetic" }, counterevidence_queries: ["river"] }],
        unclassified_assertion_ids: assertions.slice(2), coverage_note: "Synthetic.", status: "complete_for_stated_scope" };
    },
    pattern_reviewer: (packet) => ({ schema_version: "1.0", target_generation: packet.target_generation, review_role: "pattern_reviewer",
      assessments: packet.candidate_patterns.map((pattern) => ({ target_id: pattern.id, outcome: "preserved", critical: false, finding_type: "none",
        explanation: "Synthetic review preserved the scope.", evidence_ids: [] })),
      proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" }),
    ...overrides
  };
}

async function drive(f, roleHandlers, calls = [], portOptions = {}, runtimeOptions = {}) {
  const inferencePort = createMockJournalInferencePort({ ...portOptions,
    handlers: Object.fromEntries(Object.entries(roleHandlers)
      .map(([role, handler]) => [role, (packet) => { calls.push(role); return handler(packet); }])) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort, environment: f.environment, ...runtimeOptions });
  try {
    const summaries = {};
    for (const command of ["run", "audit", "patterns", "commit"]) summaries[command] = await runtime.execute(command);
    return summaries;
  } finally { await runtime.close(); }
}

test("unsupported inference ports report sequential fallback at requested concurrency", async (t) => {
  const f = await environment(t);
  f.config.semantic_concurrency = 4;
  const result = await drive(f, handlers());
  assert.equal(result.run.lookahead, "unsupported_port");
  assert.equal(result.commit.completion.profile_committed, "pass");
  await assert.rejects(openJournalExecutionRuntime({ config: { ...f.config, semantic_concurrency: 9 },
    configPath: f.configPath, service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: handlers() }), environment: f.environment }),
  { code: "JOURNAL_SEMANTIC_CONCURRENCY_INVALID" });
});

test("exchange lookahead preserves the synthetic import and sequential identities", async (t) => {
  const entries = Array.from({ length: 16 }, (_, index) =>
    `Synthetic journal entry ${index}: I walked by the river and observed a blue cup.`);
  const f = await environment(t, entries);
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  const stagePort = createMockJournalInferencePort({ handlers: handlers() });
  const staged = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, inferencePort: stagePort, sourceParser: f.sourceParser,
    environment: f.environment });
  try { await staged.execute("stage"); } finally { await staged.close(); }
  const executionRoots = [path.join(f.root, "sequential"), path.join(f.root, "parallel")];
  for (const executionRoot of executionRoots)
    await fs.cp(f.config.execution_root, executionRoot, { recursive: true });
  const runCase = async (semanticConcurrency, executionRoot) => {
    let maxOutstanding = 0;
    const h = exchangeHarness({ waitMs: 30_000,
      onDispatch: ({ dispatch, results }) => {
        maxOutstanding = Math.max(maxOutstanding,
          [...dispatch.keys()].filter(id => !results.has(id)).length);
      } });
    const roleHandlers = handlers();
    const invoked = [], prefetched = [];
    const port = { ...h.port,
      async invoke(input) { invoked.push({ role: input.role, key: input.operationKey });
        return h.port.invoke(input); },
      async prefetch(input) { prefetched.push({ role: input.role, key: input.operationKey,
        tier: input.tier });
        return h.port.prefetch(input); } };
    let stopped = false, rounds = 0, seed = 17;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const answering = (async () => {
      while (!stopped) {
        let pending = [...h.dispatch.keys()].filter(id => !h.results.has(id));
        if (pending.length) {
          // One fake transport round collects concurrent dispatches before answering them.
          await new Promise(resolve => setTimeout(resolve, 12));
          pending = [...h.dispatch.keys()].filter(id => !h.results.has(id))
            .sort(() => random() - 0.5);
          rounds += 1;
          await Promise.all(pending.map(async id => {
            await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(random() * 12)));
            const item = h.work.get(id);
            if (item && h.dispatch.has(id) && !h.results.has(id))
              h.answerWork(id, roleHandlers[item.role](item.packet));
          }));
        } else await new Promise(resolve => setTimeout(resolve, 15));
      }
    })();
    let runtime;
    try {
      runtime = await openJournalExecutionRuntime({ config: { ...f.config,
        semantic_concurrency: semanticConcurrency, execution_root: executionRoot },
      configPath: f.configPath, service: f.service, inferencePort: port,
      sourceParser: f.sourceParser, environment: f.environment });
      const run = await runtime.execute("run");
      const prefetchedInRun = prefetched.map((call) => call.role);
      // Both copies audit the same sampled units, even when the sample omits units.
      const beforeAudit = JSON.parse(await fs.readFile(path.join(executionRoot, "state.json"), "utf8"));
      const corpus = createPrivateJournalCorpusStore({ rootDir: executionRoot, caseId: CASE_ID,
        corpusId: beforeAudit.corpus_id,
        corpusKey: await fs.readFile(path.join(executionRoot, "staging.key")) });
      try {
        const bytes = await corpus.reassembleOriginal(beforeAudit.visual_plan_ref ?? beforeAudit.parsed_ref);
        let plan;
        try { plan = JSON.parse(bytes.toString("utf8")); } finally { bytes.fill(0); }
        const units = plan.units.map(unit => ({ ...unit,
          duplicate_group_id: `duplicate:${sha256(unit.text)}` }));
        const sample = createDeterministicAuditSample({ units, seed: "synthetic-fixed-audit-seed" });
        beforeAudit.audit_sample_ref = await corpus.writeChunkedOriginal({
          objectId: "audit:sample:fixed-lookahead", bytes: Buffer.from(JSON.stringify(sample)) });
      } finally { await corpus.close(); }
      await fs.writeFile(path.join(executionRoot, "state.json"), JSON.stringify(beforeAudit), { mode: 0o600 });
      const audit = await runtime.execute("audit");
      const patterns = await runtime.execute("patterns");
      const commit = await runtime.execute("commit");
      const state = JSON.parse(await fs.readFile(path.join(executionRoot, "state.json"), "utf8"));
      const graph = await readStoredReport({ ...f, config: { ...f.config,
        execution_root: executionRoot } }, "reviewed_graph_ref");
      const auditReport = await readStoredReport({ ...f, config: { ...f.config,
        execution_root: executionRoot } }, "audit_report_ref");
      const objectIds = await corpusObjectIds(executionRoot);
      return { run, audit, patterns, commit, state, graph, auditReport,
        objectIds, invoked, prefetched, prefetchedInRun, rounds,
        maxOutstanding,
        duplicatePublishes: [...h.successful.values()].filter(count => count > 1).length };
    } finally { stopped = true; await runtime?.close(); await answering; }
  };
  const sequential = await runCase(1, executionRoots[0]);
  const parallel = await runCase(4, executionRoots[1]);
  assert.equal(sequential.run.completion.graph_built, "pass");
  assert.equal(parallel.run.completion.graph_built, "pass");
  assert.deepEqual(parallel.graph, sequential.graph);
  assert.equal(parallel.commit.completion.profile_committed, "pass");
  assert.equal(sequential.commit.completion.profile_committed, "pass");
  assert.equal(parallel.state.reviewed_persisted.manifest.graph_sha256,
    sequential.state.reviewed_persisted.manifest.graph_sha256);
  assert.deepEqual(parallel.auditReport.probability_unweighted,
    sequential.auditReport.probability_unweighted);
  assert.deepEqual(parallel.auditReport.probability_weighted,
    sequential.auditReport.probability_weighted);
  assert.equal(parallel.auditReport.unassessed_unit_count,
    sequential.auditReport.unassessed_unit_count);
  assert.deepEqual(parallel.audit.residuals, sequential.audit.residuals);
  assert.deepEqual(parallel.patterns.residuals, sequential.patterns.residuals);
  assert.deepEqual(parallel.invoked, sequential.invoked);
  assertSameCorpusObjects(parallel.objectIds, sequential.objectIds);
  assert.equal(sequential.prefetched.length, 0);
  assert.ok(parallel.prefetched.length > 0);
  assert.ok(parallel.prefetched.every(call => call.tier === "standard"));
  // During the run only calibration sends reference readings, so these are calibration units sent ahead.
  assert.ok(parallel.prefetchedInRun.includes("reference_reader"), "calibration reference readings are sent ahead");
  assert.ok(parallel.prefetchedInRun.includes("extractor"));
  assert.ok(parallel.maxOutstanding <= 4);
  assert.equal(parallel.duplicatePublishes, 0);
  assert.ok(parallel.run.lookahead.sent > 0);
  assert.ok(parallel.run.lookahead.used > 0);
  assert.equal(parallel.run.lookahead.unused, 0);
  const invokedKeys = new Set(parallel.invoked.map(call => call.key));
  assert.ok(parallel.prefetched.every(call => invokedKeys.has(call.key)),
    "every prefetched operation must be invoked by the sequential run");
  assert.ok(parallel.run.lookahead.concurrency === 4);
  assert.ok(parallel.audit.lookahead.sent >= parallel.run.lookahead.sent);
  assert.ok(parallel.audit.lookahead.used >= parallel.run.lookahead.used);
  assert.ok(parallel.rounds < sequential.rounds,
    `expected parallel dispatch rounds ${parallel.rounds} < ${sequential.rounds}`);
});

test("audit lookahead reads the current epoch's record of a recalibrated unit", async (t) => {
  const entries = Array.from({ length: 16 }, (_, index) =>
    `Synthetic recalibrated entry ${index}: I walked by the river and observed a blue cup.`);
  const f = await environment(t, entries);
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  f.config.calibration_failure_limit = 1;
  const baseline = handlers();
  // Round 0: the third calibration unit fails extraction, so its epoch-zero record is source-only.
  const failingText = entries[3];
  const failing = createMockJournalInferencePort({ handlers: handlers({ extractor: (packet) =>
    packet.core_units.some((unit) => unit.text === failingText)
      ? { ...baseline.extractor(packet), status: "incomplete" } : baseline.extractor(packet) }) });
  let runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: failing, environment: f.environment });
  try {
    const failed = await runtime.execute("run");
    assert.equal(failed.calibration, "failed");
    assert.equal(failed.calibration_failure.failed_units, 1);
    assert.equal((await runtime.execute("recalibrate")).calibration_epoch, 1);
  } finally { await runtime.close(); }
  // Round 1 passes through the exchange with lookahead, then the audit runs with lookahead too.
  const h = exchangeHarness({ waitMs: 30_000 });
  const prefetched = [];
  const port = { ...h.port, async prefetch(input) {
    prefetched.push({ role: input.role, unit_id: input.packet.assigned_core_ids[0] });
    return h.port.prefetch(input);
  } };
  let stopped = false;
  const answering = (async () => {
    while (!stopped) {
      for (const id of [...h.dispatch.keys()].filter((key) => !h.results.has(key))) {
        const item = h.work.get(id);
        if (item) h.answerWork(id, baseline[item.role](item.packet));
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  })();
  try {
    runtime = await openJournalExecutionRuntime({ config: { ...f.config, semantic_concurrency: 4 }, configPath: f.configPath,
      service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const auditStart = prefetched.length;
    const audit = await runtime.execute("audit");
    const state = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
    const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
      corpusId: state.corpus_id, corpusKey: await fs.readFile(path.join(f.config.execution_root, "staging.key")) });
    let recalibrated;
    try {
      const bytes = await store.reassembleOriginal(state.visual_plan_ref ?? state.parsed_ref);
      try { recalibrated = JSON.parse(bytes.toString("utf8")).units.find((unit) => unit.text === failingText); }
      finally { bytes.fill(0); }
    } finally { await store.close(); }
    // The epoch-zero record of this unit is source-only; the audit reads its current, passing record, and so
    // does the lookahead, which therefore sends its reference reading ahead and leaves nothing unused.
    assert.ok(prefetched.slice(auditStart).some((call) => call.role === "reference_reader"
      && call.unit_id === recalibrated.unit_id));
    assert.equal(audit.lookahead.unused, 0);
  } finally { stopped = true; await runtime?.close(); await answering; }
});

test("corpus parity detects a prepare that writes an object", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-lookahead-mutation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const corpus = createPrivateJournalCorpusStore({ rootDir: root, caseId: CASE_ID,
    corpusId: "synthetic-corpus", corpusKey: Buffer.alloc(32, 19) });
  t.after(() => corpus.close());
  const before = await corpusObjectIds(root);
  const lookahead = createJournalLookahead({ limit: 2, port: { prefetch() {} },
    authorize: async () => {}, grant: {}, prepare: async () => {
      await corpus.writeJsonObject({ objectId: "synthetic:unexpected-lookahead-write", value: { synthetic: true } });
      return null;
  } });
  lookahead.ahead([{ jobId: "synthetic-mutation" }]);
  for (let attempts = 0; attempts < 100 && (await corpusObjectIds(root)).length === 0; attempts += 1)
    await new Promise(resolve => setTimeout(resolve, 2));
  await lookahead.close();
  const after = await corpusObjectIds(root);
  assert.throws(() => assertSameCorpusObjects(after, before), /lookahead changed the corpus object count/u);
});

test("reference audit replaces expired or changed speculative work on its original job key", async (t) => {
  for (const variant of ["expired", "changed-grant", "answered-changed-grant"]) {
    const f = await environment(t);
    let time = Date.parse("2026-10-01T00:00:00.000Z");
    let replaced = false;
    let staleId = null;
    const roleHandlers = handlers();
    let h;
    h = exchangeHarness({ now: () => new Date(time), ttlMs: 10_000,
      onDispatch: ({ work, dispatch, results }) => {
        for (const id of dispatch.keys()) if (!results.has(id) && id !== staleId
          && work.get(id).origin !== "lookahead") {
          const item = work.get(id);
          h.answerWork(id, roleHandlers[item.role](item.packet));
        }
      } });
    const port = { ...h.port, async invoke(input) {
      if (!replaced && input.role === "reference_reader") {
        replaced = true;
        await h.port.prefetch({ ...input, grant: variant !== "expired"
          ? { ...input.grant, grant_id: "synthetic:previous-grant" } : input.grant });
        staleId = [...h.work.keys()].at(-1);
        if (variant === "expired") time += 10_001;
        if (variant === "answered-changed-grant") h.answerWork(staleId);
      }
      return h.port.invoke(input);
    } };
    const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
      service: f.service, sourceParser: f.sourceParser, inferencePort: port,
      environment: f.environment });
    try {
      const run = await runtime.execute("run");
      assert.equal(run.blocker, null, variant);
      assert.equal(run.completion.graph_built, "pass", variant);
      assert.equal(h.results.get(staleId).retired, true, variant);
      assert.equal(h.successful.get(`${staleId}:r1`), 1, variant);
    } finally { await runtime.close(); }
  }
});

test("real lookahead prepare checks access and writes no corpus objects", async (t) => {
  const entries = Array.from({ length: 16 }, (_, index) => `Synthetic access entry ${index}: a blue cup.`);
  const f = await environment(t, entries);
  f.config.semantic_concurrency = 4;
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  let revoked = false;
  let h;
  const roleHandlers = handlers();
  h = exchangeHarness({ onDispatch: ({ work, dispatch, results }) => {
    for (const id of dispatch.keys()) if (!results.has(id) && work.get(id).origin !== "lookahead")
      h.answerWork(id, roleHandlers[work.get(id).role](work.get(id).packet));
  } });
  const objectCount = async () => {
    const root = path.join(f.config.execution_root, ".journal-corpora");
    try { return (await fs.readdir(root, { recursive: true })).filter(name => name.endsWith(".journal-object.json")).length; }
    catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  };
  const counts = [];
  const port = { ...h.port,
    async invoke(input) { await new Promise(resolve => setTimeout(resolve, 150)); return h.port.invoke(input); },
    async prefetch(input) {
      const before = await objectCount();
      const result = await h.port.prefetch(input);
      counts.push([before, await objectCount()]);
      revoked = true;
      return result;
    } };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port,
    environment: f.environment, authContextProvider: async () => ({ bearerToken: revoked ? "revoked-synthetic" : WRITER }) });
  try {
    // The first send ahead is now a calibration reference reading. A denial during a reference call is
    // recorded as unsent and stops the run with that blocker; one during a controller job throws. Either
    // way nothing further is sent.
    const outcome = await runtime.execute("run").then((summary) => summary.blocker, (error) => error.code);
    assert.equal(outcome, "PRIVATE_CASE_ACCESS_DENIED");
  } finally { await runtime.close(); }
  assert.equal(counts.length, 1);
  assert.equal(counts[0][1], counts[0][0]);
  assert.equal([...h.work.values()].filter(item => item.origin === "lookahead").length, 1);
});

test("hardest lane run never prefetches a hardest work item", async (t) => {
  const entries = Array.from({ length: 16 }, (_, index) => `Synthetic hardest entry ${index}: a blue cup.`);
  const f = await environment(t, entries);
  f.config.semantic_concurrency = 4;
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  f.config.hardest_lane = { enabled: true, daily_limit: 8 };
  const normal = handlers();
  let h;
  h = exchangeHarness({ onDispatch: ({ work, dispatch, results }) => {
    for (const id of dispatch.keys()) if (!results.has(id)) {
      const item = work.get(id);
      let output = normal[item.role](item.packet);
      if (item.role === "extractor" && item.tier !== "hardest"
        && item.packet.core_units.some(unit => unit.text === entries[2]))
        output = { ...output, status: "needs_context", requested_context: [{
          unit_id: item.packet.core_units[0].unit_id, direction: "after", reason: "Synthetic context." }] };
      h.answerWork(id, output);
    }
  } });
  const port = { ...h.port,
    async invoke(input) { await new Promise(resolve => setTimeout(resolve, 150)); return h.port.invoke(input); } };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port,
    environment: f.environment });
  try { await runtime.execute("run"); } finally { await runtime.close(); }
  assert.ok(h.published.some(item => item.tier === "hardest"));
  assert.ok(h.published.some(item => item.origin === "lookahead"));
  assert.ok(h.published.every(item => item.origin !== "lookahead" || item.tier !== "hardest"));
});

test("runtime close and reopen reuses each published work item", async (t) => {
  const entries = Array.from({ length: 16 }, (_, index) => `Synthetic restart entry ${index}: a blue cup.`);
  const f = await environment(t, entries);
  f.config.semantic_concurrency = 4;
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  let hold = false, resumed = false;
  const roleHandlers = handlers();
  let h;
  h = exchangeHarness({ waitMs: 30, onDispatch: ({ work, dispatch, results }) => {
    if ([...work.values()].some(item => item.origin === "lookahead")) hold = true;
    if (hold && !resumed) return;
    for (const id of dispatch.keys()) if (!results.has(id))
      h.answerWork(id, roleHandlers[work.get(id).role](work.get(id).packet));
  } });
  const options = { config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, environment: f.environment };
  const logicalKeys = new Set();
  const delayed = base => ({ ...base,
    async invoke(input) { logicalKeys.add(input.operationKey);
      await new Promise(resolve => setTimeout(resolve, 150)); return base.invoke(input); },
    async prefetch(input) { logicalKeys.add(input.operationKey); return base.prefetch(input); } });
  let runtime = await openJournalExecutionRuntime({ ...options, inferencePort: delayed(h.port) });
  let firstSummary;
  try { firstSummary = await runtime.execute("run"); } finally { await runtime.close(); }
  assert.ok(hold, "the first runtime must close with speculative work pending");
  assert.equal(firstSummary.blocker, "COMPLETION_UNKNOWN");
  resumed = true;
  for (const id of h.dispatch.keys()) if (!h.results.has(id))
    h.answerWork(id, roleHandlers[h.work.get(id).role](h.work.get(id).packet));
  runtime = await openJournalExecutionRuntime({ ...options, inferencePort: delayed(h.makePort()) });
  try {
    const run = await runtime.execute("run");
    assert.equal(run.completion.graph_built, "pass");
  } finally { await runtime.close(); }
  assert.ok([...h.successful.values()].every(count => count === 1));
  for (const key of logicalKeys) {
    const baseId = journalExchangeWorkId(key);
    assert.equal([...h.successful].filter(([id]) => id === baseId || id.startsWith(`${baseId}:r`))
      .reduce((total, [, count]) => total + count, 0), 1, key);
  }
});

async function searchPublishedAssertions(f) {
  const published = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  const corpusId = published.journal_corpora[0].corpus_id;
  return createJournalPrivateApi({ caseAccessService: f.service }).search({
    caseId: CASE_ID, corpusId, query: "Synthetic report",
    purpose: "organize_search", filters: { kinds: ["assertion"] }
  }, { bearerToken: READER });
}

async function readStoredReport(f, refName) {
  const state = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
  const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
    corpusId: state.corpus_id, corpusKey: await fs.readFile(path.join(f.config.execution_root, "staging.key")) });
  try {
    const bytes = await store.reassembleOriginal(state[refName]);
    try { return JSON.parse(bytes.toString("utf8")); }
    finally { bytes.fill(0); }
  } finally { await store.close(); }
}

const readAuditReport = (f) => readStoredReport(f, "audit_report_ref");

async function assertCalibrationStopped(runtime, f, status, reason, calls) {
  const first = await runtime.execute("run");
  assert.equal(first.calibration, "failed");
  assert.equal(first.blocker, status);
  assert.equal(first.calibration_failure?.status, status);
  assert.equal(first.calibration_failure?.reason, reason);
  assert.equal(first.completion.graph_built, "not_run");
  assert.equal(first.completion.profile_committed, "not_run");
  const count = calls.length;
  assert.deepEqual(await runtime.execute("run"), first);
  assert.equal(calls.length, count, "resuming a terminal calibration must make no model calls");
  await assert.rejects(runtime.execute("audit"), { code: "JOURNAL_RECONCILIATION_NOT_READY" });
  await assert.rejects(runtime.execute("commit"), { code: "JOURNAL_REVIEWED_GENERATION_NOT_READY" });
  const published = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  assert.equal(published.journal_corpora?.length ?? 0, 0, "nothing is published for session use");
  return first;
}

async function readPublishedRecords(f) {
  const published = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  const corpusId = published.journal_corpora[0].corpus_id;
  return f.service.withJournalCorpus(CASE_ID, corpusId,
    { requiredScope: "case:read", requiredPurpose: "organize_search" },
    async ({ corpusStore, reference }) => {
      const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
      const shards = await Promise.all(manifest.record_shards.map(({ object_id }) => corpusStore.readJsonObject({ objectId: object_id })));
      return shards.flatMap((shard) => shard.records);
    }, { bearerToken: READER });
}

test("a clean synthetic import runs from intake to a committed generation", async (t) => {
  const f = await environment(t);
  const { run, audit, patterns, commit } = await drive(f, handlers());
  assert.deepEqual([run.completion.graph_built, run.blocker], ["pass", null]);
  assert.deepEqual([audit.stage, audit.completion.semantically_audited, audit.blocker], ["PATTERN_BUILD", "pass", null]);
  assert.deepEqual([patterns.stage, patterns.completion.patterns_reviewed, patterns.residuals.reviewed_patterns], ["COMMIT", "pass", 1]);
  assert.deepEqual([commit.stage, commit.completion.profile_committed], ["COLD_TEST", "pass"]);
});

test("commit refuses a saved partial calibration even when later stages are ready", async t => {
  const f = await environment(t);
  const port = createMockJournalInferencePort({ handlers: handlers() });
  const options = { config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: port, environment: f.environment };
  const runtime = await openJournalExecutionRuntime(options);
  try {
    await runtime.execute("run");
    await runtime.execute("audit");
    await runtime.execute("patterns");
  } finally { await runtime.close(); }
  const statePath = path.join(f.config.execution_root, "state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.calibration, "pass");
  assert.equal(state.stage, "COMMIT");
  state.calibration = "partial";
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const resumed = await openJournalExecutionRuntime(options);
  try {
    await assert.rejects(resumed.execute("commit"), { code: "JOURNAL_REVIEWED_GENERATION_NOT_READY" });
    const published = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
    assert.equal(published.journal_corpora?.length ?? 0, 0);
  } finally { await resumed.close(); }
});

test("the Codex route hardest daily limit counts each dependency invocation before it is sent", async (t) => {
  const f = await environment(t);
  f.config.hardest_lane = { enabled: true, daily_limit: 1 };
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  const ordinary = handlers({
    extractor: (packet) => ({ ...handlers().extractor(packet), status: "needs_context",
      requested_context: [{ unit_id: packet.core_units[0].unit_id, direction: "after", reason: "Synthetic bounded-context request." }] })
  });
  const standardPort = createMockJournalInferencePort({ handlers: ordinary });
  const hardestPort = createMockJournalInferencePort({ handlers: handlers() });
  const calls = [];
  const inferencePort = {
    capabilities: () => ({ ...hardestPort.capabilities(), transport: "codex_exec_exchange",
      hardest_fresh_context_per_generate: true,
      hardest_authenticated_execution_profile_per_generate: true }),
    getCompletion: (operationKey) => hardestPort.getCompletion(operationKey),
    invoke(input) {
      calls.push(`${input.tier}:${input.role}`);
      return (input.tier === "hardest" ? hardestPort : standardPort).invoke(input);
    },
    close() { standardPort.close(); hardestPort.close(); }
  };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort, environment: f.environment });
  try {
    const summary = await runtime.execute("run");
    assert.equal(summary.blocker, "HARDEST_DAILY_LIMIT");
    assert.equal(summary.hardest_lane.sent, 1);
    assert.deepEqual(calls.filter((call) => call.startsWith("hardest:")), ["hardest:extractor"]);
  } finally { await runtime.close(); }
});

test("a restarted hardest reference recovers its durable intent before charging the daily limit", async (t) => {
  const f = await environment(t);
  f.config.hardest_lane = { enabled: true, daily_limit: 1 };
  const invalidReference = (packet) => ({
    schema_version: "1.0",
    source_only_first_pass: true,
    reference_items: [{ id: "reference:synthetic", statement: "Synthetic invalid reference.", required_qualifiers: [],
      anchors: [{ unit_id: packet.source_windows[0].unit_id, quote: "Words absent from the source.", occurrence: null }],
      importance_reason: "Synthetic restart fixture.", critical: false }],
    questions: [],
    unassessed_unit_ids: []
  });
  let hardestInput = null;
  let hardestInvocations = 0;
  const firstMock = createMockJournalInferencePort({ handlers: handlers({ reference_reader: invalidReference }) });
  const firstPort = {
    capabilities: () => firstMock.capabilities(),
    getCompletion: (operationKey) => firstMock.getCompletion(operationKey),
    isAuthoritativeCompletion: (_operationKey, input) => input?.tier === "hardest",
    invoke(input) {
      if (input.role === "reference_reader" && input.tier === "hardest") {
        hardestInput = structuredClone(input);
        hardestInvocations += 1;
        throw new Error("synthetic crash after durable hardest intent");
      }
      return firstMock.invoke(input);
    },
    close: () => firstMock.close()
  };
  let runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: firstPort, environment: f.environment });
  try {
    await assert.rejects(runtime.execute("run"), /synthetic crash after durable hardest intent/);
  } finally { await runtime.close(); }
  assert.ok(hardestInput);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"))).hardest_lane.sent, 1);

  const resumedMock = createMockJournalInferencePort({ handlers: handlers() });
  const resumedPort = {
    capabilities: () => resumedMock.capabilities(),
    async getCompletion(operationKey) {
      if (operationKey === hardestInput.operationKey) {
        const completed = await resumedMock.invoke(hardestInput);
        return { status: "completed", ...completed };
      }
      return resumedMock.getCompletion(operationKey);
    },
    isAuthoritativeCompletion: (_operationKey, input) => input?.tier === "hardest",
    invoke(input) {
      if (input.role === "reference_reader" && input.tier === "hardest") hardestInvocations += 1;
      return resumedMock.invoke(input);
    },
    close: () => resumedMock.close()
  };
  runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: resumedPort, environment: f.environment });
  try {
    const summary = await runtime.execute("run");
    assert.equal(summary.blocker, null);
    assert.equal(summary.completion.graph_built, "pass");
    assert.equal(summary.hardest_lane.sent, 1);
    assert.equal(summary.residuals.hardest_resolved, 1);
  } finally { await runtime.close(); }
  assert.equal(hardestInvocations, 1, "the restart must recover rather than invoke the hardest reference again");
});

function invalidHardestPort(standardPort, shouldExhaust) {
  return {
    capabilities: () => standardPort.capabilities(),
    getCompletion: (operationKey) => standardPort.getCompletion(operationKey),
    invoke(input) {
      if (input.tier === "hardest" && shouldExhaust(input)) {
        throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" });
      }
      return standardPort.invoke(input);
    },
    close() { standardPort.close(); }
  };
}

test("an exhausted hardest checked-work attempt is counted and becomes a failed residual", async (t) => {
  const f = await environment(t);
  f.config.hardest_lane = { enabled: true };
  const standard = createMockJournalInferencePort({ handlers: handlers({
    reconciler: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation,
      proposals: [{ operation: "possible_identity", relation: "possible_same_entity",
        subject_ids: ["entity:missing:a", "entity:missing:b"], evidence_ids: [],
        explanation: "Synthetic invalid proposal.", automatic_retirement_allowed: false }],
      unresolved_ids: [], status: "proposals_complete" })
  }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: invalidHardestPort(standard, ({ role }) => role === "reconciler"), environment: f.environment });
  try {
    const summary = await runtime.execute("run");
    assert.equal(summary.blocker, null);
    assert.equal(summary.residuals.hardest_attempted, 1);
    assert.equal(summary.residuals.hardest_resolved, 0);
    assert.equal(summary.completion.graph_built, "pass");
  } finally { await runtime.close(); }
});

test("an exhausted hardest single-unit extraction continues as a source-only residual", async (t) => {
  const f = await environment(t);
  f.config.hardest_lane = { enabled: true };
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  const baseParser = f.sourceParser;
  f.sourceParser = async () => {
    const parsed = await baseParser();
    const additions = Array.from({ length: 10 }, (_, index) => {
      const page = index + 4;
      const text = page === 7 ? "Synthetic Sunday: one final unresolved entry." : `Synthetic extra page ${page}.`;
      return { page: { page_number: page, representation_id: `synthetic:page:${page - 1}`, disposition: "readable", warnings: [], image_inventory: [] },
        representation: { representation_id: `synthetic:page:${page - 1}`, text, utf8_byte_length: Buffer.byteLength(text) } };
    });
    return { ...parsed,
      pages: [...parsed.pages, ...additions.map(({ page }) => page)],
      representations: [...parsed.representations, ...additions.map(({ representation }) => representation)] };
  };
  const normal = handlers();
  const standard = createMockJournalInferencePort({ handlers: handlers({
    extractor: (packet) => !packet.core_units[0].text.includes("Sunday") ? normal.extractor(packet) : {
      ...normal.extractor(packet), status: "needs_context",
      requested_context: [{ unit_id: packet.core_units[0].unit_id, direction: "after", reason: "Synthetic unresolved unit." }]
    }
  }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: invalidHardestPort(standard,
      ({ role }) => role === "extractor"), environment: f.environment });
  try {
    const summary = await runtime.execute("run");
    assert.equal(summary.blocker, null);
    assert.equal(summary.completion.graph_built, "partial");
    assert.equal(summary.residuals.hardest_attempted, 1);
    assert.equal(summary.residuals.hardest_resolved, 0);
    assert.equal(summary.residuals.source_only_units, 1);
    const state = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
    const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
      corpusId: state.corpus_id, corpusKey: await fs.readFile(path.join(f.config.execution_root, "staging.key")) });
    try {
      const records = await Promise.all(state.completed_units.map((id) => store.readJsonObject({ objectId: `unit:graph:${id}` })));
      const unresolved = records.filter((record) => record.source_only_unresolved);
      assert.equal(unresolved.length, 1);
      // The window after the unit was supplied once, which earns one more pass; later asks are already answered.
      assert.deepEqual(unresolved[0].diagnostics.cycles.map((cycle) => cycle.cycle), [0, 1, 2, 3]);
      assert.deepEqual(unresolved[0].diagnostics.cycles.map((cycle) => cycle.context_answer),
        [{ supplied: 1, unavailable: 0, already_answered: 0 }, ...Array(3).fill({ supplied: 0, unavailable: 0, already_answered: 1 })]);
      assert.deepEqual(unresolved[0].diagnostics.cycles[0].extraction.requested_context_by_direction,
        { before: 0, after: 1, visual: 0, whole_entry: 0 });
      assert.equal(unresolved[0].diagnostics.hardest.extraction, null);
    } finally { await store.close(); }
  } finally { await runtime.close(); }
});

test("a hardest extraction whose omission packet grows too large still counts as an attempted hardest call", async (t) => {
  const f = await environment(t);
  f.config.hardest_lane = { enabled: true };
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  const normal = handlers();
  const unresolvedSunday = (packet) => !packet.core_units[0].text.includes("Synthetic Sunday") ? normal.extractor(packet) : {
    ...normal.extractor(packet), status: "needs_context",
    requested_context: [{ unit_id: packet.core_units[0].unit_id, direction: "after", reason: "Synthetic unresolved unit." }]
  };
  const baseParser = f.sourceParser;
  f.sourceParser = async () => {
    const parsed = await baseParser();
    const text = "Synthetic Sunday: one final unresolved entry.";
    return { ...parsed,
      pages: [...parsed.pages, { page_number: parsed.pages.length + 1, representation_id: "synthetic:page:sunday", disposition: "readable", warnings: [], image_inventory: [] }],
      representations: [...parsed.representations, { representation_id: "synthetic:page:sunday", text, utf8_byte_length: Buffer.byteLength(text) }] };
  };
  const standard = createMockJournalInferencePort({ handlers: handlers({ extractor: unresolvedSunday }) });
  // The hardest extractor completes, but its long (schema-valid) output makes the omission packet exceed the bound.
  const hardest = createMockJournalInferencePort({ handlers: handlers({ extractor: (packet) => ({
    ...normal.extractor(packet),
    coverage: normal.extractor(packet).coverage.map((item) => ({ ...item, reason: "x".repeat(460_000) })) }) }) });
  const port = {
    capabilities: () => standard.capabilities(),
    getCompletion: async (operationKey) => (await standard.getCompletion(operationKey)) ?? hardest.getCompletion(operationKey),
    invoke: (input) => (input.tier === "hardest" ? hardest : standard).invoke(input),
    close() { standard.close(); hardest.close(); }
  };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    const summary = await runtime.execute("run");
    // The unit is a calibration unit: calibration stops as unresolved (not as an unspent size refusal),
    // and the consumed hardest call is counted.
    assert.equal(summary.calibration, "failed");
    assert.equal(summary.calibration_failure.reason, "CALIBRATION_EXTRACTION_UNRESOLVED");
    assert.equal(summary.residuals.hardest_attempted, 1);
    assert.equal(summary.residuals.hardest_resolved, 0);
  } finally { await runtime.close(); }
});

test("identity questions a bounded neighborhood cannot settle are counted, not a reason to stop", async (t) => {
  const f = await environment(t);
  const { run, commit } = await drive(f, handlers({
    reconciler: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, proposals: [], unresolved_ids: [], status: "needs_context" })
  }));
  assert.deepEqual([run.completion.graph_built, run.blocker, run.residuals.reconciliation_needs_context_units], ["pass", null, 3]);
  assert.equal(commit.completion.profile_committed, "pass");
});

test("schema-valid reconciliation proposals deferred by graph rules remain visible as residuals", async (t) => {
  const f = await environment(t);
  const { run, commit } = await drive(f, handlers({
    reconciler: (packet) => {
      const assertions = packet.candidates.nodes.filter((node) => node.kind === "assertion");
      const passage = packet.candidates.nodes.find((node) => node.kind === "passage");
      return { schema_version: "1.0", target_generation: packet.expected_generation,
        proposals: [{ operation: "link", relation: "corrects", subject_ids: assertions.slice(0, 2).map(({ id }) => id),
          evidence_ids: [passage.id], explanation: "Synthetic invalid correction proposal.", automatic_retirement_allowed: false }],
        unresolved_ids: [], status: "proposals_complete" };
    }
  }));
  assert.equal(run.completion.graph_built, "pass");
  assert.equal(run.residuals.reconciliation_deferred_proposals, 1);
  assert.equal(commit.completion.profile_committed, "pass");
});

test("explicit unresolved reconciliation IDs are counted once across reports for a shared batch", async (t) => {
  const f = await environment(t);
  f.config.semantic_batching.reconciliation_maximum_units = 2;
  await fs.writeFile(f.configPath, JSON.stringify(f.config), { mode: 0o600 });
  const { run } = await drive(f, handlers({
    reconciler: (packet) => {
      const assertions = packet.candidates.nodes.filter((node) => node.kind === "assertion");
      return { schema_version: "1.0", target_generation: packet.expected_generation,
        proposals: [], unresolved_ids: assertions.length === 2 ? assertions.map((node) => node.id) : [],
        status: "proposals_complete" };
    }
  }));
  const reports = await readStoredReport(f, "reconciliation_report_ref");
  const shared = reports.filter((report) => report.batch_ref === reports[0].batch_ref);
  assert.equal(shared.length, 2);
  assert.equal(shared[0].status, "proposals_complete");
  assert.equal(shared[0].unresolved_ids.length, 2);
  assert.deepEqual(shared[0].unresolved_ids, shared[1].unresolved_ids);
  assert.equal(run.residuals.reconciliation_unresolved_units, 0);
  assert.equal(run.residuals.reconciliation_deferred_proposals, 0);
  assert.equal(run.residuals.reconciliation_unresolved_ids, 2);
});

test("a replayed reconciliation answer with an invalid receipt exhausts into an unreconciled residual", async t => {
  const f = await environment(t);
  const base = createMockJournalInferencePort({ handlers: handlers() });
  const reconcilerKeys = new Set();
  let calls = 0;
  const invalidate = result => ({ ...result, receipt: { ...result.receipt, target_generation: "stale" } });
  const port = {
    capabilities: base.capabilities,
    async invoke(request) {
      const result = await base.invoke(request);
      if (request.role !== "reconciler") return result;
      reconcilerKeys.add(request.operationKey); calls += 1;
      return invalidate(result);
    },
    async getCompletion(key) {
      const result = await base.getCompletion(key);
      return reconcilerKeys.has(key) && result.status === "completed" ? invalidate(result) : result;
    },
    close: () => base.close()
  };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    const first = await runtime.execute("run");
    assert.equal(first.blocker, null);
    assert.ok(first.residuals.reconciliation_unresolved_units > 0);
    assert.ok((await runtime.execute("run")).residuals.reconciliation_unresolved_units > 0);
    assert.equal(calls, 3);
  } finally { await runtime.close(); }
});

test("a disputed pattern settles its review: it stays in the register as disputed and the import commits", async (t) => {
  const f = await environment(t);
  const { patterns, commit } = await drive(f, handlers({
    pattern_reviewer: (packet) => ({ schema_version: "1.0", target_generation: packet.target_generation, review_role: "pattern_reviewer",
      assessments: packet.candidate_patterns.map((pattern) => ({ target_id: pattern.id, outcome: "distorted", critical: false,
        finding_type: "unsupported_claim", explanation: "Synthetic review disputes the claim.", evidence_ids: [] })),
      proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" })
  }));
  assert.deepEqual([patterns.completion.patterns_reviewed, patterns.residuals.disputed_patterns, patterns.blocker], ["pass", 1, null]);
  assert.equal(commit.completion.profile_committed, "pass");
  const pattern = (await readPublishedRecords(f)).find(record => record.kind === "pattern");
  assert.equal(pattern?.lifecycle, "candidate");
  assert.equal(pattern?.data.review_state, "disputed");
});

test("a reference that never quotes its source is retried and its candidate scope is excluded", async (t) => {
  const f = await environment(t);
  const calls = [];
  let finalReferences = 0;
  const { run, audit, patterns, commit } = await drive(f, handlers({
    // Calibration's reference misquotes once, then quotes exactly; every final audit reference misquotes.
    reference_reader: (packet) => {
      const unit = packet.source_windows[0];
      const final = packet.source_windows.length === 1 && packet.assigned_core_ids.length === 1 && calls.includes("reconciler");
      if (final) finalReferences += 1;
      const misquote = final || calls.filter((role) => role === "reference_reader").length === 1;
      return { schema_version: "1.0", source_only_first_pass: true,
        reference_items: [{ id: "r1", statement: "Synthetic proposition.", required_qualifiers: [],
          anchors: [{ unit_id: unit.unit_id, quote: misquote ? "Words that are not in the source." : unit.text, occurrence: null }],
          importance_reason: "Synthetic.", critical: false }],
        questions: [], unassessed_unit_ids: [] };
    },
    pattern_builder: (packet) => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Failed-freeze assertions excluded.", status: "complete_for_stated_scope" })
  }), calls);
  assert.deepEqual([run.calibration, run.completion.graph_built], ["pass", "pass"]);
  assert.deepEqual([audit.stage, audit.completion.semantically_audited, audit.blocker], ["PATTERN_BUILD", "partial", null]);
  assert.ok(audit.residuals.audit_unassessed_units > 0);
  assert.ok(finalReferences >= 3, "each audited unit is asked three times before it is recorded as unassessed");
  assert.ok(patterns.residuals.audit_excluded_records > 0);
  assert.equal(commit.completion.profile_committed, "pass");
  const result = await searchPublishedAssertions(f);
  assert.deepEqual(result.items, [], "assertions from a unit whose reference freeze failed must not be published");
});

test("a source-declared unassessed audit unit is counted as unassessed", async (t) => {
  const f = await environment(t);
  const calls = [];
  const { audit, commit } = await drive(f, handlers({
    reference_reader: (packet) => {
      const unit = packet.source_windows[0];
      return { schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [],
        unassessed_unit_ids: calls.includes("reconciler") && unit.text === TEXTS[0] ? [unit.unit_id] : [] };
    }
  }), calls);
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.equal(audit.residuals.audit_unassessed_units, 1);
  assert.equal(commit.completion.profile_committed, "pass");
  const report = await readAuditReport(f);
  assert.equal(report.unassessed_unit_count, 1);
  assert.equal(report.reports.filter(unit => unit.freeze?.reference?.unassessed_unit_ids.includes(unit.unit_id)).length, 1);
});

test("an unresolved single-unit extraction without a reason is unassessed in the final audit", async t => {
  const f = await environment(t);
  const entries = Array.from({ length: 13 }, (_, index) => `Synthetic unit ${String(index).padStart(2, "0")} has unique text.`);
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  f.sourceParser = async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "text/plain" }, parser: { version: "synthetic-unresolved" },
    pages: entries.map((_, index) => ({ page_number: index + 1, representation_id: `synthetic:unit:${index}`,
      disposition: "readable", warnings: [], image_inventory: [] })),
    representations: entries.map((text, index) => ({ representation_id: `synthetic:unit:${index}`, text,
      utf8_byte_length: Buffer.byteLength(text) })) });
  const baseExtractor = handlers().extractor;
  const { run, audit, commit } = await drive(f, handlers({ extractor: packet => {
    const result = baseExtractor(packet);
    if (!packet.core_units[0].text.includes("unit 06")) return result;
    return { ...result, status: "incomplete", entities: [], assertions: [],
      coverage: packet.core_units.map(unit => ({ unit_id: unit.unit_id, disposition: "needs_review",
        assertion_local_ids: [], reason: "Synthetic unresolved extraction." })) };
  } }));
  assert.equal(run.residuals.source_only_units, 1);
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.equal(audit.residuals.audit_unassessed_units, 1);
  assert.equal(audit.residuals.audit_untrusted_units, 1);
  assert.equal(commit.completion.profile_committed, "pass", "resolved units may commit with this residual");
  const report = await readAuditReport(f);
  assert.equal(report.unassessed_unit_count, 1);
  assert.ok(report.reports.some(unit => unit.source_only_unresolved && unit.unassessed === "SOURCE_ONLY_UNRESOLVED"));
  const records = await readPublishedRecords(f);
  assert.ok(records.some(record => record.kind === "passage" && record.data.quote.includes("unit 06")),
    "unresolved source text remains available without publishing a semantic claim for it");
});

test("an unavailable independent-audit certification excludes the affected candidate scope", async (t) => {
  const f = await environment(t);
  const { audit, patterns, commit } = await drive(f, handlers({
    pattern_builder: (packet) => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Uncertified assertions excluded.", status: "complete_for_stated_scope" })
  }), [], { contextFactory: () => "mock-context:shared" });
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.ok(patterns.residuals.audit_excluded_records > 0);
  assert.equal(commit.completion.profile_committed, "pass");
  const result = await searchPublishedAssertions(f);
  assert.deepEqual(result.items, [], "assertions without an independent audit certification must not be published");
});

test("a failed audit withholds one unit's semantic nodes while preserving its passages and a matching audited entity", async (t) => {
  const f = await environment(t);
  let failedScope, passedScope;
  const roleHandlers = handlers({
    extractor: (packet) => {
      const extracted = handlers().extractor(packet);
      return { ...extracted,
        episodes: packet.core_units.map((unit, index) => ({ local_id: `episode${index}`, label: `Synthetic episode ${index}`,
          authored_time: unknownTime, event_time: unknownTime, anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }] })),
        assertions: extracted.assertions.map((assertion, index) => ({ ...assertion, episode_local_id: `episode${index}` })) };
    },
    fidelity_auditor: (packet) => {
      if (!packet.imported_generation?.assessment_target_ids) return handlers().fidelity_auditor(packet);
      const semantic = packet.imported_generation.graph.nodes.filter((node) => ["entity", "episode", "assertion"].includes(node.kind));
      if (packet.supporting_passages[0].text === TEXTS[0]) {
        failedScope = { semantic, passages: packet.imported_generation.graph.nodes.filter((node) => node.kind === "passage") };
        return { ...review("fidelity_auditor", packet), status: "not-a-valid-status" };
      }
      if (packet.supporting_passages[0].text === TEXTS[1]) passedScope = semantic;
      return handlers().fidelity_auditor(packet);
    }
  });
  const inferencePort = createMockJournalInferencePort({ handlers: roleHandlers });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort, environment: f.environment });
  try {
    await runtime.execute("run");
    let audit;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      audit = await runtime.execute("audit");
      if (audit.stage === "PATTERN_BUILD") break;
    }
    assert.equal(audit.stage, "PATTERN_BUILD");
    await runtime.execute("patterns");
    const commit = await runtime.execute("commit");
    assert.equal(commit.completion.profile_committed, "pass");
  } finally { await runtime.close(); }
  assert.deepEqual(failedScope.semantic.map((node) => node.kind).sort(), ["assertion", "entity", "episode"]);
  assert.equal(failedScope.passages.length, 1);
  assert.equal(passedScope.find((node) => node.kind === "entity").data.label,
    failedScope.semantic.find((node) => node.kind === "entity").data.label);
  const records = await readPublishedRecords(f);
  const publishedIds = new Set(records.map((record) => record.id));
  for (const node of failedScope.semantic) assert.ok(!publishedIds.has(node.id), `${node.kind} from failed unit was published`);
  for (const passage of failedScope.passages) assert.ok(publishedIds.has(passage.id), "verbatim passage must remain");
  assert.ok(publishedIds.has(passedScope.find((node) => node.kind === "entity").id), "matching audited entity must remain");
});

test("one failed audit keeps a passed pair relation from their shared reconciliation batch", async t => {
  const f = await environment(t);
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1,
    reconciliation_maximum_units: 3 };
  await fs.writeFile(f.configPath, JSON.stringify(f.config), { mode: 0o600 });
  let pairIds;
  const roleHandlers = handlers({
    reconciler: packet => {
      const nodes = packet.candidates.nodes;
      const passages = nodes.filter(node => node.kind === "passage");
      const entities = nodes.filter(node => node.kind === "entity");
      if (entities.length !== 3) return { schema_version: "1.0", target_generation: packet.expected_generation,
        proposals: [], unresolved_ids: [], status: "proposals_complete" };
      const members = TEXTS.map(text => {
        const passage = passages.find(node => node.data.quote === text);
        const entity = entities.find(node => node.data.evidence_ids.includes(passage.id));
        return { entity, passage };
      });
      pairIds = members.map(item => item.entity.id);
      const proposal = (left, right) => ({ operation: "possible_identity", relation: "possible_same_entity",
        subject_ids: [members[left].entity.id, members[right].entity.id],
        evidence_ids: [members[left].passage.id], explanation: "Synthetic possible identity.",
        automatic_retirement_allowed: false });
      return { schema_version: "1.0", target_generation: packet.expected_generation,
        proposals: [proposal(0, 1), proposal(1, 2)], unresolved_ids: [], status: "proposals_complete" };
    },
    fidelity_auditor: packet => packet.imported_generation?.assessment_target_ids
      && packet.supporting_passages[0].text === TEXTS[0]
      ? { ...review("fidelity_auditor", packet), status: "not-a-valid-status" }
      : handlers().fidelity_auditor(packet)
  });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: roleHandlers }), environment: f.environment });
  let commit;
  try {
    const run = await runtime.execute("run");
    assert.equal(run.stage, "REFERENCE_AUDIT", JSON.stringify(run));
    let audit;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      audit = await runtime.execute("audit");
      if (audit.stage === "PATTERN_BUILD") break;
    }
    assert.equal(audit.stage, "PATTERN_BUILD", JSON.stringify(audit));
    await runtime.execute("patterns");
    commit = await runtime.execute("commit");
  } finally { await runtime.close(); }
  assert.equal(commit.completion.profile_committed, "pass");
  assert.equal(pairIds?.length, 3, "one reconciliation batch must contain all three units");
  const graph = await readStoredReport(f, "reviewed_graph_ref");
  const pairs = graph.edges.filter(edge => edge.relation === "possible_same_entity")
    .map(edge => [edge.from, edge.to].sort().join(":"));
  assert.ok(!pairs.includes([pairIds[0], pairIds[1]].sort().join(":")));
  assert.ok(pairs.includes([pairIds[1], pairIds[2]].sort().join(":")));
});

test("a resumed pre-exclusion audit report withholds an incomplete unit's semantic nodes", async (t) => {
  const f = await environment(t);
  const calls = [];
  let incompleteScope, passedScope;
  const roleHandlers = handlers({
    extractor: (packet) => {
      const extracted = handlers().extractor(packet);
      return { ...extracted,
        episodes: packet.core_units.map((unit, index) => ({ local_id: `episode${index}`, label: `Synthetic episode ${index}`,
          authored_time: unknownTime, event_time: unknownTime, anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }] })),
        assertions: extracted.assertions.map((assertion, index) => ({ ...assertion, episode_local_id: `episode${index}` })) };
    },
    reference_reader: (packet) => {
      const unit = packet.source_windows[0];
      return { schema_version: "1.0", source_only_first_pass: true,
        reference_items: [{ id: "reference:synthetic", statement: "Synthetic proposition.", required_qualifiers: [],
          anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }], importance_reason: "Synthetic.", critical: false }],
        questions: [], unassessed_unit_ids: calls.includes("reconciler") && unit.text === TEXTS[0] ? [unit.unit_id] : [] };
    },
    fidelity_auditor: (packet) => {
      if (packet.imported_generation?.assessment_target_ids && packet.supporting_passages[0].text === TEXTS[0]) {
        incompleteScope = { unitId: packet.supporting_passages[0].unit_id,
          semantic: packet.imported_generation.graph.nodes.filter((node) => ["entity", "episode", "assertion"].includes(node.kind)),
          passages: packet.imported_generation.graph.nodes.filter((node) => node.kind === "passage") };
      }
      if (packet.imported_generation?.assessment_target_ids && packet.supporting_passages[0].text === TEXTS[1])
        passedScope = { unitId: packet.supporting_passages[0].unit_id,
          semantic: packet.imported_generation.graph.nodes.filter((node) => ["entity", "episode", "assertion"].includes(node.kind)) };
      return handlers().fidelity_auditor(packet);
    }
  });
  const inferencePort = createMockJournalInferencePort({ handlers: Object.fromEntries(Object.entries(roleHandlers)
    .map(([role, handler]) => [role, (packet) => { calls.push(role); return handler(packet); }])) });
  const openRuntime = () => openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort, environment: f.environment });
  const first = await openRuntime();
  let audit;
  try {
    await first.execute("run");
    audit = await first.execute("audit");
  } finally { await first.close(); }
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.deepEqual(incompleteScope.semantic.map((node) => node.kind).sort(), ["assertion", "entity", "episode"]);
  const auditReport = await readAuditReport(f);
  const report = auditReport.reports.find((item) => item.unit_id === incompleteScope.unitId);
  assert.equal(report.certification.semantically_audited, "pass");
  assert.equal(report.coverage.complete, false);
  assert.deepEqual(report.coverage.untrusted_candidate_ids, []);
  const passedReport = auditReport.reports.find((item) => item.unit_id === passedScope.unitId);
  assert.equal(passedReport.certification.semantically_audited, "pass");
  assert.equal(passedReport.coverage.complete, true);
  const { untrusted_candidate_ids, ...legacyReport } = report;
  assert.ok(untrusted_candidate_ids.length > 0);
  auditReport.reports = auditReport.reports.map((item) => item.unit_id === incompleteScope.unitId ? legacyReport : item);
  const statePath = path.join(f.config.execution_root, "state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
    corpusId: state.corpus_id, corpusKey: await fs.readFile(path.join(f.config.execution_root, "staging.key")) });
  try {
    state.audit_report_ref = await store.writeChunkedOriginal({ objectId: "audit:report:legacy-synthetic",
      bytes: Buffer.from(JSON.stringify(auditReport)) });
  } finally { await store.close(); }
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const resumed = await openRuntime();
  let commit;
  try {
    await resumed.execute("patterns");
    commit = await resumed.execute("commit");
  } finally { await resumed.close(); }
  assert.equal(commit.completion.profile_committed, "pass");
  const publishedIds = new Set((await readPublishedRecords(f)).map((record) => record.id));
  for (const node of incompleteScope.semantic) assert.ok(!publishedIds.has(node.id), `${node.kind} from incomplete audit was published`);
  for (const passage of incompleteScope.passages) assert.ok(publishedIds.has(passage.id), "verbatim passage must remain");
  for (const node of passedScope.semantic) assert.ok(publishedIds.has(node.id), `${node.kind} from passing audit was excluded`);
});

test("a successful reference freeze remains in the unassessed denominator when fidelity exhausts its attempts", async (t) => {
  const f = await environment(t);
  const parse = f.sourceParser;
  f.sourceParser = async (...args) => {
    const result = await parse(...args);
    result.pages[0].warnings = ["synthetic targeted challenge"];
    return result;
  };
  let failedFidelityAttempts = 0;
  const roleHandlers = handlers({
    reference_reader: (packet) => {
      const unit = packet.source_windows[0];
      return { schema_version: "1.0", source_only_first_pass: true,
        reference_items: [{ id: `reference:${unit.unit_id}`, statement: "Synthetic proposition.", required_qualifiers: [],
          anchors: [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }], importance_reason: "Synthetic.", critical: false }],
        questions: [], unassessed_unit_ids: [] };
    },
    fidelity_auditor: (packet) => {
      if (!packet.imported_generation?.assessment_target_ids) return handlers().fidelity_auditor(packet);
      failedFidelityAttempts += 1;
      return { ...review("fidelity_auditor", packet), status: "not-a-valid-status" };
    },
    pattern_builder: (packet) => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "All failed-audit assertions excluded.", status: "complete_for_stated_scope" })
  });
  const inferencePort = createMockJournalInferencePort({ handlers: roleHandlers });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort, environment: f.environment });
  let audit;
  let commit;
  try {
    await runtime.execute("run");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      audit = await runtime.execute("audit");
      if (audit.stage === "PATTERN_BUILD") break;
    }
  } finally { await runtime.close(); }
  // Keep the targeted challenge while removing it from the probability sample. The first audit
  // has already saved the exhausted fidelity disposition; reopening must count that same record.
  const sample = await readStoredReport(f, "audit_sample_ref");
  assert.equal(sample.targeted_challenge.length, 1);
  sample.selected_units = [];
  sample.inclusion_ledger = [];
  const statePath = path.join(f.config.execution_root, "state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
    corpusId: state.corpus_id, corpusKey: await fs.readFile(path.join(f.config.execution_root, "staging.key")) });
  try {
    state.audit_sample_ref = await store.writeChunkedOriginal({ objectId: "audit:sample:targeted-only-synthetic",
      bytes: Buffer.from(JSON.stringify(sample)) });
  } finally { await store.close(); }
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const resumed = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: createMockJournalInferencePort({ handlers: roleHandlers }),
    environment: f.environment });
  try {
    audit = await resumed.execute("audit");
    await resumed.execute("patterns");
    commit = await resumed.execute("commit");
  } finally { await resumed.close(); }
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.ok(failedFidelityAttempts >= 3);
  assert.ok(audit.residuals.audit_unassessed_reference_items > 0,
    "frozen reference items must contribute to the audit's unassessed denominator");
  const report = await readAuditReport(f);
  assert.equal(report.probability_unweighted.unassessed, 0);
  assert.equal(report.targeted_unweighted.unassessed, 1,
    "a targeted unit with failed fidelity keeps its frozen reference item in targeted totals");
  assert.equal(commit.completion.profile_committed, "pass");
});

test("distorted assertions are excluded from the published session-use generation", async (t) => {
  const f = await environment(t);
  const { audit, patterns, commit } = await drive(f, handlers({
    fidelity_auditor: (packet) => {
      const ids = [...(packet.frozen_reference?.reference_items ?? []).map(({ id }) => id),
        ...(packet.imported_generation?.assessment_target_ids ?? [])];
      return { ...review("fidelity_auditor", packet), assessments: ids.map((id) => ({ target_id: id,
        outcome: packet.imported_generation?.assessment_target_ids?.includes(id) ? "distorted" : "preserved",
        critical: false, finding_type: "unsupported_claim", explanation: "Synthetic distortion.", evidence_ids: [] })) };
    },
    pattern_builder: (packet) => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Audit exclusions applied.", status: "complete_for_stated_scope" })
  }));
  assert.ok(["pass", "partial"].includes(audit.completion.semantically_audited));
  assert.ok(patterns.residuals.audit_excluded_records > 0);
  assert.equal(commit.completion.profile_committed, "pass");
  const result = await searchPublishedAssertions(f);
  assert.deepEqual(result.items, [], "an ordinary consumer must not retrieve audit-failed assertions");
});

test("duplicate final fidelity assessments leave an assertion unpublished", async t => {
  const f = await environment(t);
  const baseline = handlers();
  const { audit, commit } = await drive(f, handlers({
    fidelity_auditor: packet => {
      const answer = baseline.fidelity_auditor(packet);
      if (!packet.imported_generation?.assessment_target_ids?.length) return answer;
      const target = packet.imported_generation.assessment_target_ids[0];
      return { ...answer, assessments: [...answer.assessments,
        { target_id: target, outcome: "omitted", critical: false, finding_type: "missing_evidence",
          explanation: "Synthetic omission.", evidence_ids: [] }] };
    },
    pattern_builder: packet => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Synthetic audit exclusion.",
      status: "complete_for_stated_scope" })
  }));
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.equal(commit.completion.profile_committed, "pass");
  assert.deepEqual((await searchPublishedAssertions(f)).items, []);
});

test("duplicate calibration assessments exhaust bounded attempts and stop on resume", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let fidelityCalls = 0;
  const calls = [];
  const baseline = handlers();
  const port = createMockJournalInferencePort({ handlers: handlers({
    fidelity_auditor: packet => {
      fidelityCalls += 1;
      calls.push("fidelity_auditor");
      const answer = baseline.fidelity_auditor(packet);
      const id = packet.imported_generation?.assertions?.[0]?.id;
      return { ...answer, assessments: id ? [
        { target_id: id, outcome: "preserved", critical: false, finding_type: "none", explanation: "Synthetic check.", evidence_ids: [] },
        { target_id: id, outcome: "preserved", critical: false, finding_type: "none", explanation: "Duplicate check.", evidence_ids: [] }
      ] : answer.assessments };
    }
  }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    await assertCalibrationStopped(runtime, f, "CALIBRATION_FIDELITY_ATTEMPTS_EXHAUSTED",
      "FIDELITY_DUPLICATE_ASSESSMENT", calls);
    assert.equal(fidelityCalls, 3);
  } finally { await runtime.close(); }
});

test("duplicate assessments during calibration repair stop calibration", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let fidelityCalls = 0;
  const calls = [];
  const baseline = handlers();
  const port = createMockJournalInferencePort({ handlers: handlers({
    fidelity_auditor: packet => {
      fidelityCalls += 1;
      calls.push("fidelity_auditor");
      const answer = baseline.fidelity_auditor(packet);
      if (fidelityCalls === 1) return { ...answer, status: "repair_required" };
      const id = packet.imported_generation?.assertions?.[0]?.id;
      const assessment = { target_id: id, outcome: "preserved", critical: false,
        finding_type: "none", explanation: "Synthetic duplicate.", evidence_ids: [] };
      return { ...answer, assessments: [assessment, assessment] };
    }
  }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    await assertCalibrationStopped(runtime, f, "CALIBRATION_FIDELITY_ATTEMPTS_EXHAUSTED",
      "FIDELITY_DUPLICATE_ASSESSMENT", calls);
    assert.equal(fidelityCalls, 4);
  } finally { await runtime.close(); }
});

test("a calibration review still requiring repair after bounded cycles stops the run", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  const calls = [];
  const baseline = handlers();
  const port = createMockJournalInferencePort({ handlers: handlers({
    fidelity_auditor: packet => {
      calls.push("fidelity_auditor");
      return { ...baseline.fidelity_auditor(packet), status: "repair_required" };
    }
  }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    await assertCalibrationStopped(runtime, f, "CALIBRATION_REPAIR_REQUIRED", "CALIBRATION_REPAIR_CYCLES_EXHAUSTED", calls);
    assert.equal(calls.length, 3, "initial review plus two repair cycles");
  } finally { await runtime.close(); }
});

for (const [enabled, passes] of [[true, true], [true, false], [false, true]]) {
  test(`exhausted fidelity repairs: hardest ${enabled ? (passes ? "resolves" : "fails") : "disabled"}`, async t => {
    const f = await environment(t);
    f.sourceParser = oneUnitParser(f);
    f.config.hardest_lane = { enabled };
    const baseline = handlers();
    const calls = [];
    const base = createMockJournalInferencePort({ handlers: handlers({
      extractor: packet => {
        const output = baseline.extractor(packet);
        if (packet.repair_request?.cycle === "fidelity-hardest") {
          assert.equal(packet.repair_request.fidelity_review.status, "repair_required");
          assert.equal(packet.repair_request.omission_review.status, "sufficient_for_stated_scope");
          assert.deepEqual(packet.repair_request.previous_extraction, baseline.extractor(packet));
          output.assertions[0].statement = "Synthetic hardest repaired report.";
        }
        return output;
      },
      fidelity_auditor: packet => ({ ...baseline.fidelity_auditor(packet),
        status: passes && packet.imported_generation.assertions.some(node =>
          node.data.statement === "Synthetic hardest repaired report.")
          ? "sufficient_for_stated_scope" : "repair_required" })
    }) });
    const port = { capabilities: base.capabilities, getCompletion: base.getCompletion,
      invoke(input) { calls.push(input); return base.invoke(input); }, close: base.close };
    const options = { config: f.config, configPath: f.configPath, service: f.service,
      sourceParser: f.sourceParser, inferencePort: port, environment: f.environment };
    const runtime = await openJournalExecutionRuntime(options);
    try {
      const result = enabled && passes ? await runtime.execute("run")
        : await assertCalibrationStopped(runtime, f, "CALIBRATION_REPAIR_REQUIRED", "CALIBRATION_REPAIR_CYCLES_EXHAUSTED", calls);
      assert.equal(result.calibration, enabled && passes ? "pass" : "failed");
      assert.equal(result.residuals.hardest_attempted ?? 0, enabled ? 1 : 0);
      assert.equal(result.residuals.hardest_resolved ?? 0, enabled && passes ? 1 : 0);
      assert.equal(calls.filter(call => call.role === "extractor").length, enabled ? 4 : 3);
      assert.equal(calls.filter(call => call.role === "fidelity_auditor").length, enabled ? 4 : 3);
      assert.deepEqual(calls.filter(call => call.tier === "hardest").map(call => call.role),
        enabled ? ["extractor", "omission_checker"] : []);
      let diagnostics = result.calibration_failure?.diagnostics;
      if (enabled && passes) {
        assert.equal(result.completion.graph_built, "pass");
        const state = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
        const key = await fs.readFile(path.join(f.config.execution_root, "staging.key"));
        const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root,
          caseId: CASE_ID, corpusId: state.corpus_id, corpusKey: key });
        try { diagnostics = (await store.readJsonObject({ objectId: `unit:graph:${state.completed_units[0]}` })).diagnostics; }
        finally { store.close(); key.fill(0); }
        const count = calls.length;
        assert.equal((await runtime.execute("run")).calibration, "pass");
        assert.equal(calls.length, count, "passing hardest repair is replayed without a second send");
      }
      assert.deepEqual(diagnostics.fidelity_cycles.map(cycle => cycle.cycle), [0, 1, 2]);
      assert.deepEqual(diagnostics.fidelity_cycles.slice(1).map(cycle => cycle.extraction_changed), [false, false]);
      assert.equal(diagnostics.reaudit, null);
      if (enabled) {
        assert.equal(diagnostics.hardest_fidelity.extraction_changed, true);
        assert.equal(diagnostics.hardest_fidelity.fidelity.calibration_pass, passes);
      } else assert.equal(diagnostics.hardest_fidelity, null);
    } finally { await runtime.close(); }
  });
}

test("the Codex-route hardest fidelity repair pauses at its dependent daily limit and resumes", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  f.config.hardest_lane = { enabled: true, daily_limit: 1 };
  const baseline = handlers();
  let day = "2026-10-02T12:00:00Z";
  const calls = [];
  const base = createMockJournalInferencePort({ handlers: handlers({
    extractor: packet => {
      const output = baseline.extractor(packet);
      if (packet.repair_request?.cycle === "fidelity-hardest")
        output.assertions[0].statement = "Synthetic hardest repaired report.";
      return output;
    }, fidelity_auditor: packet => ({ ...baseline.fidelity_auditor(packet),
      status: packet.imported_generation.assertions.some(node => node.data.statement === "Synthetic hardest repaired report.")
        ? "sufficient_for_stated_scope" : "repair_required" })
  }) });
  const port = { capabilities: () => ({ ...base.capabilities(), transport: "codex_exec_exchange",
      hardest_fresh_context_per_generate: true, hardest_authenticated_execution_profile_per_generate: true }),
    getCompletion: base.getCompletion,
    invoke(input) { calls.push(input); return base.invoke(input); }, close: base.close };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: port, environment: f.environment, now: () => new Date(day) });
  try {
    const paused = await runtime.execute("run");
    assert.equal(paused.blocker, "HARDEST_DAILY_LIMIT");
    assert.equal(paused.calibration, "not_run");
    assert.equal(paused.calibration_failure, undefined);
    assert.equal(paused.residuals.hardest_attempted ?? 0, 0);
    assert.equal(paused.hardest_lane.sent, 1);
    assert.deepEqual(calls.filter(call => call.tier === "hardest").map(call => call.role), ["extractor"]);
    const count = calls.length;
    assert.equal((await runtime.execute("run")).blocker, "HARDEST_DAILY_LIMIT");
    assert.equal(calls.length, count);
    day = "2026-10-03T12:00:00Z";
    const resumed = await runtime.execute("run");
    assert.equal(resumed.calibration, "pass");
    assert.equal(resumed.residuals.hardest_attempted, 1);
    assert.equal(resumed.residuals.hardest_resolved, 1);
    assert.equal(resumed.hardest_lane.sent, 1);
    assert.deepEqual(calls.filter(call => call.tier === "hardest").map(call => call.role), ["extractor", "omission_checker"]);
  } finally { await runtime.close(); }
});

for (const failure of ["packet-before-extractor", "packet-after-extractor", "spent", "binding", "omission"]) {
  test(`hardest fidelity repair retains ${failure} refusal and outcome accounting`, async t => {
    const f = await environment(t);
    f.sourceParser = oneUnitParser(f);
    f.config.hardest_lane = { enabled: true };
    const baseline = handlers();
    const calls = [];
    const base = createMockJournalInferencePort({ handlers: handlers({
      extractor: packet => {
        const output = baseline.extractor(packet);
        if (failure === "packet-before-extractor" && packet.repair_request?.cycle === "fidelity-2")
          output.coverage[0].reason = "PRIVATE_SYNTHETIC_SENTINEL".repeat(24_000);
        if (packet.repair_request?.cycle === "fidelity-hardest") {
          if (failure === "packet-after-extractor") output.coverage[0].reason = "PRIVATE_SYNTHETIC_SENTINEL".repeat(24_000);
          if (failure === "binding") output.assertions[0].anchors[0].quote = "PRIVATE_SYNTHETIC_SENTINEL_ABSENT";
          if (failure === "omission") output.coverage[0].reason = "hardest";
        }
        return output;
      },
      omission_checker: packet => ({ ...baseline.omission_checker(packet),
        status: failure === "omission" && packet.candidate_extraction.coverage[0].reason === "hardest"
          ? "repair_required" : "sufficient_for_stated_scope" }),
      fidelity_auditor: packet => ({ ...baseline.fidelity_auditor(packet), status: "repair_required" })
    }) });
    const port = { capabilities: base.capabilities, getCompletion: base.getCompletion,
      invoke(input) {
        calls.push(input);
        if (input.tier === "hardest" && input.role === "extractor") {
          if (failure === "spent") throw new JournalInferencePortError("JOURNAL_HARDEST_ATTEMPT_EXHAUSTED", { submissionStatus: "exhausted" });
        }
        return base.invoke(input);
      }, close: base.close };
    const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
      sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
    try {
      const stopped = await assertCalibrationStopped(runtime, f, "CALIBRATION_REPAIR_REQUIRED", "CALIBRATION_REPAIR_CYCLES_EXHAUSTED", calls);
      assert.equal(stopped.residuals.hardest_attempted ?? 0, failure === "packet-before-extractor" ? 0 : 1);
      assert.equal(stopped.residuals.hardest_resolved ?? 0, 0);
      // A hardest repair that its own binding or review leaves unresolved is repaired once more at the same
      // tier; here that repair passes its review and gets the fourth audit.
      const repairedAgain = ["binding", "omission"].includes(failure);
      assert.equal(calls.filter(call => call.role === "fidelity_auditor").length, repairedAgain ? 4 : 3);
      const snapshot = stopped.calibration_failure.diagnostics.hardest_fidelity;
      if (repairedAgain) {
        assert.equal(snapshot.repair.binding_failure_code, null);
        assert.equal(snapshot.repair.omission.status, "sufficient_for_stated_scope");
        assert.equal(snapshot.repair.extraction_changed, true);
        assert.equal(snapshot.fidelity.calibration_pass, false);
        assert.deepEqual(calls.filter(call => call.tier === "hardest").map(call => call.role),
          ["extractor", "omission_checker", "extractor", "omission_checker"]);
      } else assert.equal(Object.hasOwn(snapshot, "repair"), false);
      if (failure.startsWith("packet-")) assert.equal(snapshot.blocker_code, "JOURNAL_WORK_PACKET_TOO_LARGE");
      if (failure === "spent") assert.equal(snapshot.blocker_code, "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED");
      if (failure === "binding") assert.equal(snapshot.binding_failure_code, "QUOTE_NOT_FOUND");
      if (failure === "omission") assert.equal(snapshot.omission.status, "repair_required");
      assert.equal(snapshot.extraction_changed, failure === "packet-before-extractor" || failure === "spent" ? null : true);
      assert.equal(JSON.stringify(stopped).includes("PRIVATE_SYNTHETIC_SENTINEL"), false);
    } finally { await runtime.close(); }
  });
}

test("repair-required final audit with preserved targets withholds its unit and counts a residual", async t => {
  const f = await environment(t);
  const baseline = handlers();
  const { audit, patterns, commit } = await drive(f, handlers({
    fidelity_auditor: packet => {
      const answer = baseline.fidelity_auditor(packet);
      return packet.imported_generation?.assessment_target_ids?.length
        ? { ...answer, status: "repair_required" } : answer;
    },
    pattern_builder: packet => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Synthetic audit exclusion.",
      status: "complete_for_stated_scope" })
  }));
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.ok(audit.residuals.audit_repair_units > 0);
  assert.ok(audit.residuals.audit_untrusted_units > 0);
  assert.ok((await readAuditReport(f)).reports.some(report => report.coverage?.repair_required
    && report.untrusted_candidate_ids?.length > 0));
  assert.ok(patterns.residuals.audit_excluded_records > 0);
  assert.equal(commit.completion.profile_committed, "pass");
  assert.deepEqual((await searchPublishedAssertions(f)).items, []);
});

test("a preserved final fidelity outcome with wrong identity remains untrusted", async t => {
  const f = await environment(t);
  const baseline = handlers();
  const { commit } = await drive(f, handlers({
    fidelity_auditor: packet => {
      const answer = baseline.fidelity_auditor(packet);
      if (!packet.imported_generation?.assessment_target_ids?.length) return answer;
      const target = packet.imported_generation.assessment_target_ids[0];
      return { ...answer, assessments: answer.assessments.map(assessment =>
        assessment.target_id === target ? { ...assessment, finding_type: "wrong_identity" } : assessment) };
    },
    pattern_builder: packet => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Synthetic audit exclusion.",
      status: "complete_for_stated_scope" })
  }));
  assert.equal(commit.completion.profile_committed, "pass");
  const report = await readAuditReport(f);
  assert.ok(report.reports.some(unit => unit.coverage?.repair_required
    && unit.coverage.untrusted_candidate_ids.length > 0));
  assert.deepEqual((await searchPublishedAssertions(f)).items, []);
});

test("a PDF page with an excluded required visual check retains raw text but publishes no claims", async t => {
  const f = await environment(t);
  const text = TEXTS.join("\n");
  f.sourceParser = async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "application/pdf" }, parser: { version: "synthetic-table" },
    pages: [{ page_number: 1, representation_id: "synthetic:table:1", disposition: "review_required",
      warnings: ["structured_table_present"], image_inventory: [], geometry: { width: 100, height: 100 } }],
    representations: [{ representation_id: "synthetic:table:1", text, utf8_byte_length: Buffer.byteLength(text) }] });
  const { run, commit } = await drive(f, handlers({
    visual_reader: () => ({ schema_version: "1.0", source_page_id: "wrong-page", regions: [],
      page_complete: true, missing_or_uncertain_regions: [] }),
    pattern_builder: packet => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Invented table source.",
      status: "complete_for_stated_scope" })
  }), [], {}, { renderVisualPage: async () => Buffer.from("synthetic-image") });
  assert.equal(run.residuals.excluded_visual_pages, 1);
  assert.equal(commit.completion.profile_committed, "pass");
  const raw = await readStoredReport(f, "graph_ref");
  assert.equal(raw.nodes.find(node => node.kind === "source").data.parse_status, "review_required");
  assert.ok(raw.nodes.some(node => node.kind === "assertion"));
  const published = await readPublishedRecords(f);
  assert.equal(published.some(record => record.kind === "assertion"), false);
  assert.deepEqual((await searchPublishedAssertions(f)).items, []);
});

test("a readable PDF page with an image and failed visual reading keeps native claims out of session use", async t => {
  const f = await environment(t);
  const text = TEXTS.join("\n");
  f.sourceParser = async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "application/pdf" }, parser: { version: "synthetic-image" },
    pages: [{ page_number: 1, representation_id: "synthetic:image:1", disposition: "readable",
      warnings: [], image_inventory: [{ kind: "image" }], geometry: { width: 100, height: 100 } }],
    representations: [{ representation_id: "synthetic:image:1", text, utf8_byte_length: Buffer.byteLength(text) }] });
  const { run, commit } = await drive(f, handlers({
    visual_reader: () => ({ schema_version: "1.0", source_page_id: "wrong-page", regions: [],
      page_complete: true, missing_or_uncertain_regions: [] }),
    pattern_builder: packet => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Invented image source.",
      status: "complete_for_stated_scope" })
  }), [], {}, { renderVisualPage: async () => Buffer.from("synthetic-image") });
  assert.equal(run.required_visual_pages, 1);
  assert.equal(run.residuals.excluded_visual_pages, 1);
  assert.equal(commit.completion.profile_committed, "pass");
  const raw = await readStoredReport(f, "graph_ref");
  assert.ok(raw.nodes.some(node => node.kind === "assertion"));
  assert.equal((await readPublishedRecords(f)).some(record => record.kind === "assertion"), false);
  assert.deepEqual((await searchPublishedAssertions(f)).items, []);
});

test("a PDF representation without page evidence cannot default to readable", async t => {
  const f = await environment(t);
  const text = TEXTS.join("\n");
  f.sourceParser = async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "application/pdf" }, parser: { version: "synthetic-missing-page" },
    pages: [], representations: [{ representation_id: "synthetic:unmapped", text,
      utf8_byte_length: Buffer.byteLength(text) }] });
  const { commit } = await drive(f, handlers({
    pattern_builder: packet => ({ schema_version: "1.0", target_generation: packet.target_generation,
      patterns: [], unclassified_assertion_ids: [], coverage_note: "Missing page evidence.",
      status: "complete_for_stated_scope" })
  }));
  assert.equal(commit.completion.profile_committed, "pass");
  const graph = await readStoredReport(f, "graph_ref");
  assert.equal(graph.nodes.find(node => node.kind === "source").data.parse_status, "partial");
  assert.deepEqual((await searchPublishedAssertions(f)).items, []);
});

test("a scan with every page excluded ends archive-only and reports each reason on resume", async t => {
  const f = await environment(t);
  f.sourceParser = scannedParser(f, [1, 2]);
  let reads = 0;
  const port = createMockJournalInferencePort({ handlers: handlers({ visual_reader: () => {
    reads += 1;
    return { schema_version: "1.0", source_page_id: "wrong-page", regions: [],
      page_complete: true, missing_or_uncertain_regions: [] };
  } }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment,
    renderVisualPage: async () => Buffer.from("synthetic-image") });
  try {
    const first = await runtime.execute("run");
    assert.equal(first.stage, "ARCHIVE_ONLY");
    assert.equal(first.semantic_disposition, "archive_only");
    assert.equal(first.residuals.excluded_visual_pages, 2);
    assert.deepEqual(first.excluded_visual_pages, [1, 2].map(page_number =>
      ({ page_number, reason: "VISUAL_PAGE_BINDING_MISMATCH" })));
    assert.equal(first.completion.profile_committed, "not_run");
    const second = await runtime.execute("run");
    assert.equal(second.stage, "ARCHIVE_ONLY");
    assert.equal(reads, 6);
  } finally { await runtime.close(); }
});

test("an older empty assembled graph resumes to archive-only instead of re-entering reconciliation", async t => {
  const f = await environment(t);
  f.sourceParser = scannedParser(f, [1]);
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: handlers({ visual_reader: () => ({
      schema_version: "1.0", source_page_id: "wrong-page", regions: [], page_complete: true,
      missing_or_uncertain_regions: [] }) }) }), environment: f.environment,
    renderVisualPage: async () => Buffer.from("synthetic-image") });
  try { await runtime.execute("run"); } finally { await runtime.close(); }
  const statePath = path.join(f.config.execution_root, "state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
    corpusId: state.corpus_id, corpusKey: await fs.readFile(path.join(f.config.execution_root, "staging.key")) });
  try {
    state.graph_ref = await store.writeChunkedOriginal({ objectId: "synthetic:legacy-empty-graph",
      bytes: Buffer.from(JSON.stringify({ schema_version: "1.0", case_id: CASE_ID,
        corpus_id: state.corpus_id, generation: state.generation, nodes: [], edges: [] })) });
  } finally { await store.close(); }
  delete state.semantic_disposition;
  state.stage = "RECONCILE";
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const resumed = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: handlers() }), environment: f.environment });
  try {
    const run = await resumed.execute("run");
    assert.equal(run.stage, "ARCHIVE_ONLY");
    assert.equal(run.blocker, null);
  } finally { await resumed.close(); }
});

test("a rendered page over the fixed image bound is excluded once", async t => {
  const f = await environment(t);
  f.sourceParser = scannedParser(f, [1]);
  let renders = 0;
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: handlers() }), environment: f.environment,
    renderVisualPage: async () => { renders += 1;
      throw new ValidationError("VISUAL_RENDER_TOO_LARGE", { code: "VISUAL_RENDER_TOO_LARGE" }); } });
  try {
    const first = await runtime.execute("run");
    assert.equal(first.stage, "ARCHIVE_ONLY");
    assert.deepEqual(first.excluded_visual_pages, [{ page_number: 1, reason: "VISUAL_RENDER_TOO_LARGE" }]);
    assert.equal((await runtime.execute("run")).stage, "ARCHIVE_ONLY");
    assert.equal(renders, 1);
  } finally { await runtime.close(); }
});

test("an exhausted single-unit calibration freeze stops the run and replays the stop", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let references = 0;
  const calls = [];
  const roleHandlers = handlers({ reference_reader: packet => {
    references += 1;
    calls.push("reference_reader");
    const unit = packet.source_windows[0];
    return { schema_version: "1.0", source_only_first_pass: true, reference_items: [{
      id: "bad-reference", statement: "Synthetic mismatch.", required_qualifiers: [],
      anchors: [{ unit_id: unit.unit_id, quote: "This quote never occurs.", occurrence: null }],
      importance_reason: "Synthetic.", critical: false }], questions: [], unassessed_unit_ids: [] };
  } });
  const port = createMockJournalInferencePort({ handlers: roleHandlers });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  let first;
  try {
    first = await assertCalibrationStopped(runtime, f, "CALIBRATION_REFERENCE_UNRESOLVED", "QUOTE_NOT_FOUND", calls);
    assert.equal(references, 3);
  } finally { await runtime.close(); }
  const statePath = path.join(f.config.execution_root, "state.json");
  const interrupted = JSON.parse(await fs.readFile(statePath, "utf8"));
  interrupted.calibration = "not_run";
  delete interrupted.calibration_failure;
  interrupted.blocker = null;
  await fs.writeFile(statePath, JSON.stringify(interrupted), { mode: 0o600 });
  const resumed = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: roleHandlers }), environment: f.environment });
  try {
    assert.deepEqual(await resumed.execute("run"), first,
      "a saved source-only calibration unit reconstructs the same terminal stop after restart");
    assert.equal(references, 3, "restart must not ask the model again");
  } finally { await resumed.close(); }
});

test("definitely unanswered reference submissions settle after the existing bounded attempts", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let submissions = 0;
  const port = { capabilities: () => ({ authoritative_completion: true }),
    async invoke() { submissions += 1;
      throw new JournalInferencePortError("UNAVAILABLE", { submissionStatus: "not_submitted" }); },
    async getCompletion() { return { status: "not_submitted" }; } };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    let run;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      run = await runtime.execute("run");
      if (run.calibration === "failed") break;
    }
    assert.equal(run.blocker, "CALIBRATION_REFERENCE_UNRESOLVED");
    assert.equal(run.calibration_failure.reason, "REFERENCE_RESEND_EXHAUSTED");
    assert.equal(submissions, 3, "the resend cap must not open another automatic attempt");
    const before = submissions;
    assert.equal((await runtime.execute("run")).blocker, "CALIBRATION_REFERENCE_UNRESOLVED");
    assert.equal(submissions, before);
  } finally { await runtime.close(); }
});

test("visual handoff counts admitted pages separately from excluded pages", async t => {
  const f = await environment(t);
  f.sourceParser = scannedParser(f, [1, 2]);
  const port = createMockJournalInferencePort({ handlers: handlers({ visual_reader: packet => ({
    schema_version: "1.0", source_page_id: packet.assigned_core_ids[0] === "page:1" ? "page:1" : "wrong-page",
    regions: [], page_complete: true, missing_or_uncertain_regions: []
  }) }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment,
    renderVisualPage: async () => Buffer.from("synthetic-image") });
  try { await runtime.execute("visual-only"); } finally { await runtime.close(); }
  const state = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
  assert.deepEqual([state.visual_handoff_ready.admitted, state.visual_handoff_ready.excluded], [1, 1]);
});

test("visual-only handoff with every scan page excluded ends archive-only immediately", async t => {
  const f = await environment(t);
  f.sourceParser = scannedParser(f, [1]);
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: handlers({ visual_reader: () => ({
      schema_version: "1.0", source_page_id: "wrong-page", regions: [], page_complete: true,
      missing_or_uncertain_regions: [] }) }) }), environment: f.environment,
    renderVisualPage: async () => Buffer.from("synthetic-image") });
  try {
    const handoff = await runtime.execute("visual-only");
    assert.equal(handoff.stage, "ARCHIVE_ONLY");
    assert.equal(handoff.semantic_disposition, "archive_only");
    assert.doesNotMatch(handoff.next_action, /Resume source-position calibration/);
    const saved = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
    assert.equal(saved.visual_handoff_ready?.status, undefined);
  } finally { await runtime.close(); }
});

test("a calibration source packet above 180 KB stops without a second attempt", async t => {
  const f = await environment(t);
  f.sourceParser = scannedParser(f, [1]);
  let reads = 0;
  const port = createMockJournalInferencePort({ handlers: handlers({ visual_reader: () => {
    reads += 1;
    return { schema_version: "1.0", source_page_id: "page:1", regions: [{ region_id: "region:1",
      bbox: [0, 0, 1, 1], kind: "text", transcription: "A".repeat(185_000),
      non_graphic_description: null, interpretation_status: "readable", speaker_or_document_label: null,
      table_cells: [] }], page_complete: true, missing_or_uncertain_regions: [] };
  } }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment,
    renderVisualPage: async () => Buffer.from("synthetic-image") });
  try {
    const first = await runtime.execute("run");
    assert.equal(first.blocker, "CALIBRATION_SIZE_BOUND_EXCEEDED");
    assert.equal(first.calibration_failure.reason, "SEMANTIC_PACKET_OVERSIZE");
    assert.ok(first.total_units > 0);
    assert.equal(first.completion.graph_built, "not_run");
    const second = await runtime.execute("run");
    assert.deepEqual(second, first);
    assert.equal(reads, 1);
    await assert.rejects(runtime.execute("commit"), { code: "JOURNAL_REVIEWED_GENERATION_NOT_READY" });
  } finally { await runtime.close(); }
});

test("a calibration unit above its configured semantic batch bound stops the run", async t => {
  const f = await environment(t);
  f.config.semantic_batching = { maximum_bytes: 4096, calibration_maximum_bytes: 4096 };
  const text = "Synthetic long unit. ".repeat(350);
  f.sourceParser = async () => ({ source: { sha256: f.config.source.sha256,
    byte_length: f.config.source.bytes, mime_type: "text/plain" }, parser: { version: "synthetic-long-unit" },
    pages: [{ page_number: 1, representation_id: "synthetic:long", disposition: "readable", warnings: [], image_inventory: [] }],
    representations: [{ representation_id: "synthetic:long", text, utf8_byte_length: Buffer.byteLength(text) }] });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser,
    inferencePort: createMockJournalInferencePort({ handlers: handlers() }), environment: f.environment });
  try {
    const first = await runtime.execute("run");
    assert.equal(first.blocker, "CALIBRATION_SIZE_BOUND_EXCEEDED");
    assert.equal(first.calibration_failure.reason, "SEMANTIC_BATCH_UNIT_EXCEEDS_BOUND");
    assert.equal(first.completion.graph_built, "not_run");
    assert.deepEqual(await runtime.execute("run"), first);
    await assert.rejects(runtime.execute("commit"), { code: "JOURNAL_REVIEWED_GENERATION_NOT_READY" });
    const published = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
    assert.equal(published.journal_corpora?.length ?? 0, 0);
  } finally { await runtime.close(); }
});

for (const [label, count, field] of [
  ["reconciliation packet over 180 KB", 170, "reconciliation_unresolved_units"],
  ["pattern context over 50 KB", 32, "unresolved_batches"]
]) test(`a single ${label} settles with a counted residual`, async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let reconcilerCalls = 0, patternCalls = 0;
  const roleHandlers = handlers({ extractor: denseExtractor(count),
    reconciler: packet => { reconcilerCalls += 1; return handlers().reconciler(packet); },
    pattern_builder: packet => { patternCalls += 1; return { schema_version: "1.0",
      target_generation: packet.target_generation, patterns: [], unclassified_assertion_ids: [],
      coverage_note: "Synthetic dense source.", status: "complete_for_stated_scope" }; } });
  const port = createMockJournalInferencePort({ handlers: roleHandlers });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    const run = await runtime.execute("run");
    assert.equal(run.blocker, null);
    if (field === "reconciliation_unresolved_units") {
      assert.equal(run.residuals[field], 1);
      assert.equal(reconcilerCalls, 0);
    }
    const again = await runtime.execute("run");
    assert.equal(again.blocker, null);
    assert.equal(reconcilerCalls, field === "reconciliation_unresolved_units" ? 0 : 1);
    await runtime.execute("audit");
    const patterns = await runtime.execute("patterns");
    if (field === "unresolved_batches") {
      assert.equal(patterns.residuals[field], 1);
      assert.equal(patternCalls, 0);
      const second = await runtime.execute("patterns");
      assert.equal(second.residuals[field], 1);
      assert.equal(patternCalls, 0);
    }
    assert.equal((await runtime.execute("commit")).completion.profile_committed, "pass");
  } finally { await runtime.close(); }
});
