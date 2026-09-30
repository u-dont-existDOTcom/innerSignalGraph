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

// A synthetic import driven from intake to a committed generation through the operator commands,
// with every role answered by a mock. Each test makes one role answer the way a real journal
// sometimes does, and checks that the run finishes with that counted instead of stopping for good.

const CASE_ID = "synthetic-case";
const WRITER = "synthetic-operator-token";
const READER = "synthetic-reader-token";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const TEXTS = [
  "Synthetic Monday: I walked by the river and felt calm.",
  "Synthetic Wednesday: I walked by the river again and felt calm.",
  "Synthetic Friday: I stayed home and wrote a letter."
];

async function environment(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-finish-synthetic-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  const text = TEXTS.join("\n");
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
    pages: TEXTS.map((_, index) => ({ page_number: index + 1, representation_id: `synthetic:page:${index}`, disposition: "readable", warnings: [], image_inventory: [] })),
    representations: TEXTS.map((entry, index) => ({ representation_id: `synthetic:page:${index}`, text: entry, utf8_byte_length: Buffer.byteLength(entry) }))
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
  const { run, audit } = await drive(f, handlers({ extractor: packet => {
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
  const report = await readAuditReport(f);
  assert.equal(report.unassessed_unit_count, 1);
  assert.ok(report.reports.some(unit => unit.source_only_unresolved && unit.unassessed === "SOURCE_ONLY_UNRESOLVED"));
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

test("duplicate calibration assessments exhaust bounded attempts and remain source-only on resume", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let fidelityCalls = 0;
  const baseline = handlers();
  const port = createMockJournalInferencePort({ handlers: handlers({
    fidelity_auditor: packet => {
      fidelityCalls += 1;
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
    const first = await runtime.execute("run");
    assert.equal(first.blocker, null);
    assert.equal(first.residuals.source_only_units, 1);
    assert.equal((await runtime.execute("run")).residuals.source_only_units, 1);
    assert.equal(fidelityCalls, 3);
  } finally { await runtime.close(); }
});

test("duplicate assessments during calibration repair also exhaust into source-only", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let fidelityCalls = 0;
  const baseline = handlers();
  const port = createMockJournalInferencePort({ handlers: handlers({
    fidelity_auditor: packet => {
      fidelityCalls += 1;
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
    assert.equal((await runtime.execute("run")).residuals.source_only_units, 1);
    assert.equal((await runtime.execute("run")).residuals.source_only_units, 1);
    assert.equal(fidelityCalls, 4);
  } finally { await runtime.close(); }
});

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

test("an exhausted single-unit calibration freeze leaves source-only evidence and resumes", async t => {
  const f = await environment(t);
  f.sourceParser = oneUnitParser(f);
  let references = 0;
  const port = createMockJournalInferencePort({ handlers: handlers({ reference_reader: packet => {
    references += 1;
    const unit = packet.source_windows[0];
    return { schema_version: "1.0", source_only_first_pass: true, reference_items: [{
      id: "bad-reference", statement: "Synthetic mismatch.", required_qualifiers: [],
      anchors: [{ unit_id: unit.unit_id, quote: "This quote never occurs.", occurrence: null }],
      importance_reason: "Synthetic.", critical: false }], questions: [], unassessed_unit_ids: [] };
  } }) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath,
    service: f.service, sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try {
    const first = await runtime.execute("run");
    assert.equal(first.blocker, null);
    assert.equal(first.residuals.source_only_units, 1);
    assert.equal((await runtime.execute("run")).residuals.source_only_units, 1);
    assert.equal(references, 3);
  } finally { await runtime.close(); }
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
      if (run.completion.graph_built === "partial") break;
    }
    assert.equal(run.blocker, null);
    assert.equal(run.residuals.source_only_units, 1);
    assert.equal(submissions, 3, "the resend cap must not open another automatic attempt");
    const before = submissions;
    assert.equal((await runtime.execute("run")).residuals.source_only_units, 1);
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

test("a single source packet above 180 KB stays source-only without a second attempt", async t => {
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
    assert.equal(first.blocker, null);
    assert.equal(first.residuals.source_only_units, first.total_units);
    assert.ok(first.total_units > 0);
    assert.equal(first.completion.graph_built, "partial");
    const second = await runtime.execute("run");
    assert.equal(second.residuals.source_only_units, first.total_units);
    assert.equal(reads, 1);
    assert.equal((await runtime.execute("audit")).completion.semantically_audited, "partial");
    await runtime.execute("patterns");
    assert.equal((await runtime.execute("commit")).completion.profile_committed, "pass");
  } finally { await runtime.close(); }
});

test("a unit above the configured semantic batch bound is recorded source-only", async t => {
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
    const run = await runtime.execute("run");
    assert.equal(run.blocker, null);
    assert.equal(run.residuals.source_only_units, 1);
    assert.equal((await runtime.execute("run")).residuals.source_only_units, 1);
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
