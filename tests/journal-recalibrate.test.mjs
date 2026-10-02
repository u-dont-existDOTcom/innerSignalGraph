import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort, journalRoleInstruction } from "../src/journal-import/provider-port.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { extractionCycleDiagnostics, unresolvedExtractionDiagnostics, validateCalibrationDiagnostics } from "../src/journal-import/calibration-diagnostics.mjs";

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
      const text = `Synthetic page ${index + 1} has a blue cup. PRIVATE_SENTINEL_DO_NOT_RECORD_7`;
      return { representation_id: `synthetic:page:${index + 1}`, text, utf8_byte_length: Buffer.byteLength(text) };
    })
  });
  const service = { verifyCaseAccess: async () => ({}) };
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
  return { config, configPath, service, parser, image,
    open: (port, resumed = false) => openJournalExecutionRuntime({ config, configPath, service,
      sourceParser: resumed ? () => assert.fail("source must not be reparsed") : parser,
      renderVisualPage: resumed ? () => assert.fail("visual page must not be reread") : async () => image,
      inferencePort: port }) };
}

function mockPort({ fail = false, calls, extractor, omission, fidelity }) {
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
    extractor: extractor ?? ((packet) => ({ schema_version: "1.0", status: fail ? "incomplete" : "complete",
      assertions: [], entities: [], episodes: [],
      coverage: packet.core_units.map((unit) => ({ unit_id: unit.unit_id,
        disposition: fail ? "pending" : "no_assertion", assertion_local_ids: [],
        reason: "Synthetic calibration retry." })), requested_context: [] })),
    omission_checker: omission ?? ((packet) => review("omission_checker", packet)),
    fidelity_auditor: fidelity ?? ((packet) => review("fidelity_auditor", packet)),
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

test("failed calibration retains three content-free cycle snapshots in state, summary and status", async (t) => {
  const f = await fixture(t);
  const sentinel = "PRIVATE_SENTINEL_DO_NOT_RECORD_7";
  const time = { raw: sentinel, from: null, to: null, precision: "unknown", timezone: null,
    basis: "unresolved", evidence_ids: [] };
  let reviewCycle = 0;
  const outcomes = ["omitted", "distorted", "preserved"];
  const findingTypes = ["missing_evidence", "wrong_time", "lost_qualifier"];
  const port = mockPort({ calls: [],
    extractor: (packet) => {
      const unit = packet.core_units[0];
      const anchor = { unit_id: unit.unit_id, quote: unit.text, occurrence: null };
      return { schema_version: "1.0", status: "complete",
        entities: [{ local_id: sentinel, label: sentinel, entity_kind: "person", anchors: [anchor] }],
        episodes: [{ local_id: sentinel, label: sentinel, authored_time: time, event_time: time,
          anchors: [anchor] }],
        assertions: [{ local_id: sentinel, statement: sentinel, assertion_kind: "direct_report",
          narrative_mode: "waking", speaker_local_id: sentinel, subject_local_ids: [sentinel],
          episode_local_id: sentinel, polarity: "affirmed", qualifiers: [sentinel],
          authored_time: time, event_time: time, anchors: [anchor],
          importance_reasons: [sentinel], extraction_confidence: "low" }],
        coverage: [{ unit_id: unit.unit_id, disposition: "extracted",
          assertion_local_ids: [sentinel], reason: sentinel }],
        requested_context: [{ unit_id: unit.unit_id, direction: "before", reason: sentinel }] };
    },
    omission: (packet) => {
      const cycle = reviewCycle++;
      return { schema_version: "1.0", target_generation: packet.expected_generation,
        review_role: "omission_checker", status: "repair_required",
        assessments: [{ target_id: sentinel, outcome: outcomes[cycle], critical: true,
          finding_type: findingTypes[cycle], explanation: sentinel, evidence_ids: [sentinel] }],
        proposed_repairs: [{ target_id: sentinel, repair: sentinel, evidence_ids: [sentinel] }],
        unassessed_ids: cycle === 1 ? [] : [sentinel] };
    } });
  const runtime = await f.open(port);
  try {
    const summary = await runtime.execute("run");
    const status = await runtime.execute("status");
    const state = await checkpoint(f.config);
    const plan = await readPlan(f.config);
    const unitId = plan.calibration[0].unit_id;
    const record = await withStore(f.config, (store) => store.readJsonObject({ objectId: `unit:graph:${unitId}` }));
    const diagnostics = record.diagnostics;
    assert.equal(record.extraction, null);
    assert.equal(record.omission, null);
    assert.deepEqual(diagnostics.cycles.map((item) => item.cycle), [0, 1, 2]);
    assert.deepEqual(diagnostics.findings_per_cycle, [2, 1, 2]);
    assert.equal(diagnostics.hardest, null);
    assert.deepEqual(diagnostics.cycles.map((item) => item.extraction.status), ["complete", "complete", "complete"]);
    assert.deepEqual(diagnostics.cycles.map((item) => [item.extraction.assertions, item.extraction.entities,
      item.extraction.episodes, item.extraction.requested_context,
      item.extraction.coverage_by_disposition.extracted]), [[1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1]]);
    assert.deepEqual(diagnostics.cycles.map((item) =>
      item.omission.assessments_by_outcome_and_finding_type[outcomes[item.cycle]][findingTypes[item.cycle]]), [1, 1, 1]);
    assert.deepEqual(diagnostics.cycles.map((item) => item.omission.critical_assessments), [1, 1, 1]);
    assert.deepEqual(diagnostics.cycles.map((item) => item.omission.proposed_repairs), [1, 1, 1]);
    assert.deepEqual(diagnostics.cycles.map((item) => item.omission.unassessed), [1, 0, 1]);
    assert.deepEqual(state.calibration_failure.diagnostics, diagnostics);
    assert.deepEqual(summary.calibration_failure.diagnostics, diagnostics);
    assert.deepEqual(status.calibration_failure.diagnostics, diagnostics);
    for (const value of [diagnostics, state, summary, status])
      assert.equal(JSON.stringify(value).includes(sentinel), false);
    assert.equal(reviewCycle, 3);
  } finally { await runtime.close(); }
  assert.throws(() => validateCalibrationDiagnostics({ status: sentinel }), { code: "JOURNAL_DIAGNOSTICS_STRING_UNSAFE" });
  assert.throws(() => validateCalibrationDiagnostics({ [sentinel]: 1 }), { code: "JOURNAL_DIAGNOSTICS_STRING_UNSAFE" });
  assert.throws(() => validateCalibrationDiagnostics({ cycles: [{ status: { status: sentinel } }] }),
    { code: "JOURNAL_DIAGNOSTICS_STRING_UNSAFE" });
  assert.throws(() => validateCalibrationDiagnostics({ cycles: { 0: null } }),
    { code: "JOURNAL_DIAGNOSTICS_STRING_UNSAFE" });
  assert.deepEqual(unresolvedExtractionDiagnostics([{ cycle: 0, extraction: { status: sentinel }, omission: null }]),
    { invalid: true });
  assert.equal(extractionCycleDiagnostics(null, sentinel).binding_failure_code,
    "BINDING_FAILURE_CODE_UNRECOGNIZED");
});

test("failed hardest extraction has its own count snapshot", async (t) => {
  const f = await fixture(t);
  f.config.hardest_lane = { enabled: true };
  const runtime = await f.open(mockPort({ fail: true, calls: [] }));
  try {
    const failed = await runtime.execute("run");
    const diagnostics = failed.calibration_failure.diagnostics;
    assert.deepEqual(diagnostics.cycles.map((item) => item.cycle), [0, 1, 2]);
    assert.equal(diagnostics.hardest.extraction.status, "incomplete");
    assert.equal(diagnostics.hardest.extraction.coverage_by_disposition.pending, 1);
    assert.equal(diagnostics.hardest.omission, null);
    assert.deepEqual(diagnostics.findings_per_cycle, [null, null, null]);
    assert.deepEqual((await runtime.execute("status")).calibration_failure.diagnostics, diagnostics);
  } finally { await runtime.close(); }
});

test("mechanical binding failure is recorded as an allowlisted code", async (t) => {
  const f = await fixture(t);
  const port = mockPort({ calls: [], extractor: (packet) => ({
    schema_version: "1.0", status: "complete", assertions: [], episodes: [],
    entities: [{ local_id: "self", label: "Synthetic self", entity_kind: "person",
      anchors: [{ unit_id: packet.core_units[0].unit_id, quote: "Synthetic quote absent from source.", occurrence: null }] }],
    coverage: [{ unit_id: packet.core_units[0].unit_id, disposition: "no_assertion",
      assertion_local_ids: [], reason: null }], requested_context: []
  }) });
  const runtime = await f.open(port);
  try {
    const failed = await runtime.execute("run");
    assert.deepEqual(failed.calibration_failure.diagnostics.cycles.map((cycle) => cycle.binding_failure_code),
      ["QUOTE_NOT_FOUND", "QUOTE_NOT_FOUND", "QUOTE_NOT_FOUND"]);
    assert.deepEqual(failed.calibration_failure.diagnostics.findings_per_cycle, [null, null, null]);
  } finally { await runtime.close(); }
});

test("fidelity repairs retain every extraction, review and audit snapshot", async (t) => {
  const f = await fixture(t);
  const sentinel = "PRIVATE_SENTINEL_DO_NOT_RECORD_7";
  const port = mockPort({ calls: [],
    extractor: (packet) => {
      const unit = packet.core_units[0];
      const bad = packet.repair_request?.cycle === "fidelity-1";
      return { schema_version: "1.0", status: "complete", assertions: [], episodes: [],
        entities: bad ? [{ local_id: sentinel, label: sentinel, entity_kind: "person",
          anchors: [{ unit_id: unit.unit_id, quote: `${sentinel} absent`, occurrence: null }] }] : [],
        coverage: [{ unit_id: unit.unit_id, disposition: "no_assertion", assertion_local_ids: [], reason: sentinel }],
        requested_context: [] };
    },
    fidelity: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation,
      review_role: "fidelity_auditor", assessments: [], proposed_repairs: [], unassessed_ids: [],
      status: "repair_required" }) });
  const runtime = await f.open(port);
  try {
    const summary = await runtime.execute("run");
    const state = await checkpoint(f.config);
    const diagnostics = summary.calibration_failure.diagnostics;
    assert.equal(summary.calibration_failure.reason, "CALIBRATION_REPAIR_CYCLES_EXHAUSTED");
    assert.deepEqual(diagnostics.fidelity_cycles.map((cycle) => cycle.cycle), [0, 1, 2]);
    assert.deepEqual(diagnostics.fidelity_cycles.map((cycle) => cycle.extraction.entities), [0, 1, 0]);
    assert.deepEqual(diagnostics.fidelity_cycles.map((cycle) => cycle.omission.findings), [0, 0, 0]);
    assert.equal(diagnostics.fidelity_cycles[1].binding_failure_code, "QUOTE_NOT_FOUND");
    assert.deepEqual(diagnostics.fidelity_cycles.map((cycle) => cycle.fidelity?.target_met ?? null),
      [false, null, false]);
    assert.deepEqual(diagnostics.fidelity_cycles.filter((cycle) => cycle.fidelity).map((cycle) =>
      [cycle.fidelity.status, cycle.fidelity.critical_miss_count,
        cycle.fidelity.qualifier_error_count, cycle.fidelity.unassessed]),
    [["repair_required", 0, 0, 0], ["repair_required", 0, 0, 0]]);
    assert.deepEqual(diagnostics.findings_per_cycle, [0]);
    for (const value of [diagnostics, state, summary, await runtime.execute("status")])
      assert.equal(JSON.stringify(value).includes(sentinel), false);
  } finally { await runtime.close(); }
});

test("model IDs, time strings and quoted anchors do not enter diagnostics", async (t) => {
  const f = await fixture(t);
  const sentinel = "PRIVATE_SENTINEL_DO_NOT_RECORD_7";
  const badTime = { raw: sentinel, from: sentinel, to: sentinel, timezone: sentinel,
    precision: "interval", basis: "explicit", evidence_ids: [sentinel] };
  const runtime = await f.open(mockPort({ calls: [], extractor: (packet) => {
    const unit = packet.core_units[0];
    const anchor = { unit_id: unit.unit_id, quote: unit.text, occurrence: null };
    return { schema_version: "1.0", status: "complete", assertions: [], entities: [],
      episodes: [{ local_id: sentinel, label: sentinel, authored_time: badTime,
        event_time: badTime, anchors: [anchor] }],
      coverage: [{ unit_id: unit.unit_id, disposition: "no_assertion", assertion_local_ids: [], reason: sentinel }],
      requested_context: [] };
  } }));
  try {
    const summary = await runtime.execute("run");
    const state = await checkpoint(f.config);
    assert.equal(summary.calibration, "failed");
    for (const value of [state.calibration_failure.diagnostics, state, summary, await runtime.execute("status")])
      assert.equal(JSON.stringify(value).includes(sentinel), false);
  } finally { await runtime.close(); }
});

test("a legacy unit record without diagnostics survives a resumed write", async (t) => {
  const f = await fixture(t);
  let runtime = await f.open(mockPort({ fail: true, calls: [] }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "failed");
    await runtime.execute("recalibrate");
  } finally { await runtime.close(); }
  const plan = await readPlan(f.config);
  const unitId = plan.calibration[0].unit_id;
  await withStore(f.config, async (store) => {
    const old = await store.readJsonObject({ objectId: `unit:graph:${unitId}` });
    delete old.diagnostics;
    await store.writeJsonObject({ objectId: `unit:graph:${unitId}:epoch:1`, value: old });
  });
  runtime = await f.open(mockPort({ fail: true, calls: [] }), true);
  try {
    assert.equal((await runtime.execute("run")).calibration, "failed");
  } finally { await runtime.close(); }
  await withStore(f.config, async (store) => {
    const saved = await store.readJsonObject({ objectId: `unit:graph:${unitId}:epoch:1` });
    assert.equal(Object.hasOwn(saved, "diagnostics"), false);
  });
  const legacyState = await checkpoint(f.config);
  legacyState.calibration = "partial";
  delete legacyState.calibration_failure;
  await fs.writeFile(path.join(f.config.execution_root, "state.json"), JSON.stringify(legacyState));
  runtime = await f.open(mockPort({ fail: true, calls: [] }), true);
  try {
    const recovered = await runtime.execute("run");
    assert.equal(recovered.calibration, "failed");
    assert.equal(Object.hasOwn(recovered.calibration_failure, "diagnostics"), false);
  } finally { await runtime.close(); }
});

test("an exhausted regular unit records a fixed blocker and no invented review findings", async (t) => {
  const f = await fixture(t, { pages: 16 });
  f.config.semantic_batching = { calibration_maximum_units: 1, maximum_units: 1 };
  let exhaustedUnitId = null;
  const port = mockPort({ calls: [], extractor: (packet) => {
    if (packet.core_units[0].unit_id === exhaustedUnitId) return {};
    return { schema_version: "1.0", status: "complete", assertions: [], entities: [], episodes: [],
      coverage: packet.core_units.map((unit) => ({ unit_id: unit.unit_id, disposition: "no_assertion",
        assertion_local_ids: [], reason: null })), requested_context: [] };
  } });
  const runtime = await f.open(port);
  try {
    await runtime.execute("stage");
    const plan = await readPlan(f.config);
    const calibrationIds = new Set(plan.calibration.map((unit) => unit.unit_id));
    exhaustedUnitId = plan.units.find((unit) => !calibrationIds.has(unit.unit_id)).unit_id;
    const summary = await runtime.execute("run");
    assert.equal(summary.calibration, "pass");
    const record = await withStore(f.config, (store) => store.readJsonObject({ objectId: `unit:graph:${exhaustedUnitId}` }));
    assert.equal(record.source_only_unresolved, true);
    assert.deepEqual(record.diagnostics.findings_per_cycle, [null]);
    assert.equal(record.diagnostics.cycles[0].blocker_code, "INVALID_STRUCTURED_OUTPUT");
    assert.equal(record.diagnostics.cycles[0].extraction, null);
  } finally { await runtime.close(); }
});

test("an unavailable omission review keeps its completed extraction counts", async (t) => {
  const f = await fixture(t);
  const runtime = await f.open(mockPort({ calls: [], omission: () => ({}) }));
  try {
    const summary = await runtime.execute("run");
    const diagnostics = summary.calibration_failure.diagnostics;
    assert.deepEqual(diagnostics.findings_per_cycle, [null]);
    assert.equal(diagnostics.cycles[0].extraction.status, "complete");
    assert.equal(diagnostics.cycles[0].extraction.coverage_by_disposition.no_assertion, 1);
    assert.equal(diagnostics.cycles[0].omission, null);
    assert.equal(diagnostics.cycles[0].blocker_code, "INVALID_STRUCTURED_OUTPUT");
  } finally { await runtime.close(); }
});

test("binding diagnostics cover every mechanical code emitted by the binding path", async () => {
  const sections = [
    ["contracts.mjs", "export function validateJournalSchema", "export function validateExtractionReferences"],
    ["contracts.mjs", "export function validateExtractionReferences", "export function splitUtf8"],
    ["contracts.mjs", "export function resolveExactQuote", "export function validateJournalGraph"],
    ["contracts.mjs", "export function validateJournalGraph", "export function correctionClosure"],
    ["semantic-batches.mjs", "function singleAnchorUnit", "export function splitBatchExtractionByUnit"],
    ["semantic-batches.mjs", "export function splitBatchExtractionByUnit", ""],
    ["graph.mjs", "export function adaptExtractionToGraph", "export function buildGraphIndexes"],
    ["anchors.mjs", "export function resolveUnitQuote", "export function createRestrictedSourcePointer"],
    ["private-runtime.mjs", "const bindUnitExtraction", "const recordSourceOnly"]
  ];
  for (const [file, start, end] of sections) {
    const source = await fs.readFile(new URL(`../src/journal-import/${file}`, import.meta.url), "utf8");
    const from = source.indexOf(start);
    const to = end ? source.indexOf(end, from + start.length) : source.length;
    assert.ok(from >= 0 && to > from, `${file}: ${start}`);
    for (const [, code] of source.slice(from, to).matchAll(/"([A-Z][A-Z0-9_]+)"/g)) {
      if (!code.includes("_")) continue;
      assert.equal(extractionCycleDiagnostics(null, code).binding_failure_code, code, `${file}: ${code}`);
    }
  }
});

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
    { status: "CALIBRATION_REPAIR_REQUIRED", reason: "CALIBRATION_EXTRACTION_UNRESOLVED",
      diagnostics: before.calibration_failure.diagnostics });
  assert.deepEqual(reset.previous_failure.diagnostics, before.calibration_failure.diagnostics);
  runtime = await f.open(mockPort({ calls: [] }), true);
  try { assert.deepEqual((await runtime.execute("status")).previous_failure.diagnostics,
    before.calibration_failure.diagnostics); }
  finally { await runtime.close(); }
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
    assert.equal(Object.hasOwn(current, "diagnostics"), false);
    assert.equal(regular.source_only_unresolved, false);
    assert.equal(Object.hasOwn(regular, "diagnostics"), false);
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
