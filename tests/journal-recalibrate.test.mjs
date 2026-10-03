import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalWorkExchange } from "../src/journal-import/work-exchange.mjs";
import { runJournalClaudeWorker } from "../src/journal-import/claude-worker.mjs";
import { createExchangeJournalInferencePort, journalExchangeWorkId } from "../src/journal-import/exchange-port.mjs";
import { runJournalWork } from "../src/cli/journal-work.mjs";
import test from "node:test";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort, journalRoleInstruction } from "../src/journal-import/provider-port.mjs";
import { computeJournalWorkId } from "../src/journal-import/controller.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { extractionCycleDiagnostics, fidelityCycleDiagnostics, unresolvedExtractionDiagnostics, validateCalibrationDiagnostics } from "../src/journal-import/calibration-diagnostics.mjs";

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
    open: (port, resumed = false, environment = process.env, now = undefined) => openJournalExecutionRuntime({ config, configPath, service, environment,
      sourceParser: resumed ? () => assert.fail("source must not be reparsed") : parser,
      renderVisualPage: resumed ? () => assert.fail("visual page must not be reread") : async () => image,
      inferencePort: port, ...(now ? { now } : {}) }) };
}

function invalidReferenceItems(packet) {
  return [{ id: "reference:synthetic-missing-quote", statement: "Synthetic unsupported quote.",
    required_qualifiers: [], anchors: [{ unit_id: packet.assigned_core_ids[0],
      quote: "SYNTHETIC_ABSENT_QUOTE_SENTINEL", occurrence: null }],
    importance_reason: "Synthetic calibration failure.", critical: false }];
}

function mockPort({ fail = false, failReference = false, calls, extractor, omission, fidelity, reference, visual }) {
  const review = (role, packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation,
    review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [],
    status: "sufficient_for_stated_scope" });
  const handlers = {
    visual_reader: visual ?? ((packet) => ({ schema_version: "1.0", source_page_id: packet.assigned_core_ids[0],
      regions: [{ region_id: "region:synthetic", bbox: [0, 0, 1, 1], kind: "text",
        transcription: "Synthetic image text.", non_graphic_description: null,
        interpretation_status: "readable", speaker_or_document_label: null, table_cells: [] }],
      page_complete: true, missing_or_uncertain_regions: [] })),
    reference_reader: reference ?? (packet => ({ schema_version: "1.0", source_only_first_pass: true,
      reference_items: failReference ? invalidReferenceItems(packet) : [], questions: [], unassessed_unit_ids: [] })),
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
      calls.push({ role: input.role, operationKey: input.operationKey, packet: input.packet, tier: input.tier });
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

const fidelitySentinel = "PRIVATE_SENTINEL_DO_NOT_RECORD_7";
function syntheticReference(packet) {
  return { schema_version: "1.0", source_only_first_pass: true,
    reference_items: [{ id: fidelitySentinel, statement: fidelitySentinel,
      required_qualifiers: [fidelitySentinel], critical: false,
      anchors: [{ unit_id: packet.source_windows[0].unit_id, quote: fidelitySentinel, occurrence: null }],
      importance_reason: fidelitySentinel }], questions: [], unassessed_unit_ids: [] };
}
function syntheticFidelity(packet, outcome, findingType = "none", status = null) {
  return { schema_version: "1.0", target_generation: packet.expected_generation,
    review_role: "fidelity_auditor",
    status: status ?? (outcome === "preserved" ? "sufficient_for_stated_scope"
      : outcome === "unassessed" ? "incomplete" : "repair_required"),
    assessments: [{ target_id: fidelitySentinel, outcome, critical: false, finding_type: findingType,
      explanation: fidelitySentinel, evidence_ids: [fidelitySentinel] }],
    proposed_repairs: outcome === "distorted" ? [{ target_id: fidelitySentinel,
      repair: fidelitySentinel, evidence_ids: [fidelitySentinel] }] : [],
    unassessed_ids: outcome === "unassessed" ? [fidelitySentinel] : [] };
}
async function calibrationRecord(config, epoch = 0) {
  const plan = await readPlan(config);
  return withStore(config, (store) => store.readJsonObject({
    objectId: `unit:graph:${plan.calibration[0].unit_id}${epoch ? `:epoch:${epoch}` : ""}` }));
}

for (const status of ["incomplete", "repair_required"]) {
  test(`an unassessed-only ${status} audit re-audits once and passes without extraction repair`, async t => {
    const f = await fixture(t);
    const calls = [];
    let audits = 0;
    const runtime = await f.open(mockPort({ calls, reference: syntheticReference,
      fidelity: packet => ++audits === 1 ? syntheticFidelity(packet, "unassessed", "none", status)
        : syntheticFidelity(packet, "preserved") }));
    try {
      const result = await runtime.execute("run");
      assert.equal(result.calibration, "pass");
      assert.equal(result.completion.graph_built, "pass");
      assert.equal(calls.filter(call => call.role === "extractor").length, 1);
      const fidelityCalls = calls.filter(call => call.role === "fidelity_auditor");
      assert.equal(fidelityCalls.length, 2);
      assert.deepEqual(fidelityCalls[1].packet.imported_generation, fidelityCalls[0].packet.imported_generation);
      assert.notEqual(fidelityCalls[1].operationKey, fidelityCalls[0].operationKey);
      const diagnostics = (await calibrationRecord(f.config)).diagnostics;
      assert.equal(diagnostics.reaudit.fidelity.calibration_pass, true);
      assert.equal(diagnostics.reaudit.fidelity.reference_counts.preserved, 1);
      assert.deepEqual(diagnostics.fidelity_cycles.map(cycle => cycle.cycle), [0]);
      assert.equal(JSON.stringify(diagnostics).includes(fidelitySentinel), false);
      const count = calls.length;
      assert.equal((await runtime.execute("run")).calibration, "pass");
      assert.equal(calls.length, count);
    } finally { await runtime.close(); }
  });
}

test("a re-audit distortion feeds one ordinary extraction repair that passes", async t => {
  const f = await fixture(t);
  const calls = [];
  let audits = 0;
  const runtime = await f.open(mockPort({ calls, reference: syntheticReference,
    fidelity: packet => syntheticFidelity(packet, ["unassessed", "distorted", "preserved"][audits++],
      audits === 2 ? "wrong_time" : "none") }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const extractions = calls.filter(call => call.role === "extractor");
    assert.equal(extractions.length, 2);
    assert.equal(extractions[1].packet.repair_request.cycle, "fidelity-1");
    assert.equal(extractions[1].packet.repair_request.fidelity_review.assessments[0].finding_type, "wrong_time");
    const diagnostics = (await calibrationRecord(f.config)).diagnostics;
    assert.equal(diagnostics.reaudit.fidelity.reference_counts.distorted, 1);
    assert.equal(diagnostics.reaudit.fidelity.assessments_by_outcome_and_finding_type.distorted.wrong_time, 1);
    assert.equal(diagnostics.fidelity_cycles[1].fidelity.calibration_pass, true);
    assert.equal(diagnostics.fidelity_cycles[1].extraction_changed, false);
    assert.equal(JSON.stringify(diagnostics).includes(fidelitySentinel), false);
  } finally { await runtime.close(); }
});

test("an unassessed-only audit after a repair takes the one re-audit before another repair", async t => {
  const f = await fixture(t);
  const calls = [];
  let audits = 0;
  const runtime = await f.open(mockPort({ calls, reference: syntheticReference,
    fidelity: packet => syntheticFidelity(packet, ["distorted", "unassessed", "preserved"][audits++],
      audits === 1 ? "wrong_time" : "none") }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    // The initial distortion spends repair 1; its unassessed-only audit is re-audited and passes, so repair 2 never runs.
    assert.equal(calls.filter(call => call.role === "extractor").length, 2);
    assert.equal(calls.filter(call => call.role === "fidelity_auditor").length, 3);
    const diagnostics = (await calibrationRecord(f.config)).diagnostics;
    assert.equal(diagnostics.reaudit.cycle, 1);
    assert.equal(diagnostics.reaudit.fidelity.calibration_pass, true);
    assert.deepEqual(diagnostics.fidelity_cycles.map(cycle => cycle.cycle), [0, 1]);
    assert.equal(JSON.stringify(diagnostics).includes(fidelitySentinel), false);
  } finally { await runtime.close(); }
});

test("a failed re-audit of a multi-unit calibration batch splits it and retries each half", async t => {
  const f = await fixture(t, { pages: 2 });
  f.config.semantic_batching = { calibration_maximum_units: 2, maximum_units: 2 };
  const calls = [];
  let batchUnits = null;
  const runtime = await f.open(mockPort({ calls, reference: syntheticReference,
    fidelity: packet => {
      const units = packet.assigned_core_ids.length;
      // The whole batch is first unassessed-only, then every checked attempt of its re-audit is invalid. Halves pass.
      if (batchUnits === null) { batchUnits = units; return syntheticFidelity(packet, "unassessed"); }
      if (units === batchUnits) return { ...syntheticFidelity(packet, "preserved"), status: "not-a-valid-status" };
      return syntheticFidelity(packet, "preserved");
    } }));
  try {
    // Each invalid re-audit attempt pauses the run; resuming retries it until its checked attempts are spent.
    let result = await runtime.execute("run");
    for (let resume = 0; resume < 8 && result.blocker === "INVALID_STRUCTURED_OUTPUT"; resume += 1) result = await runtime.execute("run");
    assert.equal(batchUnits, 2, "the calibration batch had two units");
    assert.equal(result.calibration, "pass");
    assert.ok(calls.some(call => call.role === "fidelity_auditor" && call.packet.assigned_core_ids.length === 1),
      "each half was audited on its own");
  } finally { await runtime.close(); }
});

test("a still-unassessed re-audit spends no repair cycle and comparisons use canonical output only", async t => {
  const f = await fixture(t);
  const calls = [];
  const runtime = await f.open(mockPort({ calls, reference: syntheticReference,
    extractor: packet => {
      const output = { schema_version: "1.0", status: "complete", assertions: [], entities: [], episodes: [],
        coverage: packet.core_units.map(unit => ({ unit_id: unit.unit_id, disposition: "no_assertion",
          assertion_local_ids: [], reason: fidelitySentinel })), requested_context: [] };
      if (packet.repair_request?.cycle === "fidelity-2") output.coverage[0].reason += " changed";
      // Reordering object keys is not an extraction change.
      if (packet.repair_request?.cycle === "fidelity-1")
        return Object.fromEntries(Object.entries(output).reverse().map(([key, value]) => [key,
          key === "coverage" ? value.map(item => Object.fromEntries(Object.entries(item).reverse())) : value]));
      return output;
    }, fidelity: packet => syntheticFidelity(packet, "unassessed") }));
  try {
    const result = await runtime.execute("run");
    assert.equal(result.calibration_failure.reason, "CALIBRATION_REPAIR_CYCLES_EXHAUSTED");
    assert.equal(calls.filter(call => call.role === "extractor").length, 3);
    assert.equal(calls.filter(call => call.role === "fidelity_auditor").length, 4);
    const diagnostics = result.calibration_failure.diagnostics;
    assert.equal(diagnostics.reaudit.fidelity.unassessed, 1);
    assert.deepEqual(diagnostics.fidelity_cycles.slice(1).map(cycle => cycle.extraction_changed), [false, true]);
    assert.equal(diagnostics.hardest_fidelity, null);
    for (const value of [diagnostics, await checkpoint(f.config), result, await runtime.execute("status")])
      assert.equal(JSON.stringify(value).includes(fidelitySentinel), false);
  } finally { await runtime.close(); }
});

for (const finding of ["omitted", "distorted", "critical_miss", "qualifier_error"]) {
  test(`an incomplete audit with ${finding} findings repairs immediately without re-auditing`, async t => {
    const f = await fixture(t);
    const calls = [];
    const runtime = await f.open(mockPort({ calls,
      reference: packet => {
        const reference = syntheticReference(packet);
        if (finding === "critical_miss") reference.reference_items[0].critical = true;
        return reference;
      }, fidelity: packet => syntheticFidelity(packet, finding === "critical_miss" ? "unassessed"
        : finding === "qualifier_error" ? "preserved" : finding,
        finding === "qualifier_error" ? "lost_qualifier" : "none", "incomplete") }));
    try {
      const result = await runtime.execute("run");
      assert.equal(result.calibration_failure.reason, "CALIBRATION_REPAIR_CYCLES_EXHAUSTED");
      assert.equal(calls.filter(call => call.role === "fidelity_auditor").length, 3);
      assert.equal(calls.filter(call => call.role === "extractor").length, 3);
      assert.equal(result.calibration_failure.diagnostics.reaudit, null);
    } finally { await runtime.close(); }
  });
}

test("fidelity diagnostics count the complete outcome-by-finding matrix without any free text", () => {
  const outcomes = ["preserved", "omitted", "distorted", "unassessed"];
  const findingTypes = ["none", "missing_evidence", "wrong_identity", "wrong_time", "wrong_mode",
    "lost_qualifier", "unsupported_claim", "causal_promotion", "duplicate_support", "other"];
  const review = { schema_version: "1.0", target_generation: fidelitySentinel, review_role: "fidelity_auditor",
    status: "repair_required", assessments: outcomes.flatMap(outcome => findingTypes.flatMap(finding_type =>
      Array.from({ length: outcome === "distorted" ? 2 : 1 }, () => ({ target_id: fidelitySentinel, outcome,
        finding_type, critical: true, explanation: fidelitySentinel, evidence_ids: [fidelitySentinel] })))),
    proposed_repairs: [{ target_id: fidelitySentinel, repair: fidelitySentinel, evidence_ids: [fidelitySentinel] }],
    unassessed_ids: [fidelitySentinel] };
  const snapshot = fidelityCycleDiagnostics(review, { reference_total: 4,
    reference_counts: { preserved: 1, omitted: 1, distorted: 1, unassessed: 1 },
    critical_miss_count: 3, qualifier_error_count: 1, provisional_target_met: false }, false);
  validateCalibrationDiagnostics({ reaudit: { fidelity: snapshot }, hardest_fidelity: { fidelity: snapshot,
    extraction_changed: null } });
  for (const outcome of outcomes) for (const findingType of findingTypes)
    assert.equal(snapshot.assessments_by_outcome_and_finding_type[outcome][findingType], outcome === "distorted" ? 2 : 1);
  assert.equal(JSON.stringify(snapshot).includes(fidelitySentinel), false);
});

test("re-audits and hardest fidelity repairs have fresh append-only identities after recalibration", async t => {
  const f = await fixture(t);
  f.config.hardest_lane = { enabled: true };
  const calls = [];
  let audits = 0;
  const open = resumed => f.open(mockPort({ calls, reference: syntheticReference,
    fidelity: packet => syntheticFidelity(packet, ++audits <= 2 ? "unassessed" : "distorted", audits <= 2 ? "none" : "wrong_time") }), resumed);
  let runtime = await open(false);
  try {
    const first = await runtime.execute("run");
    assert.equal(first.calibration, "failed");
    assert.equal(first.residuals.hardest_attempted, 1);
    await runtime.execute("recalibrate");
  } finally { await runtime.close(); }
  const previousKeys = new Set(calls.map(call => call.operationKey));
  const boundary = calls.length;
  audits = 0;
  runtime = await open(true);
  try {
    const second = await runtime.execute("run");
    assert.equal(second.calibration_epoch, 1);
    assert.equal(second.calibration, "failed");
    assert.equal(second.residuals.hardest_attempted, 2);
    assert.equal(second.residuals.hardest_resolved, 0);
    assert.equal(calls.slice(boundary).some(call => previousKeys.has(call.operationKey)), false);
    const plan = await readPlan(f.config);
    const keyId = sha(plan.calibration[0].unit_id).slice(0, 40);
    await withStore(f.config, async store => {
      for (const epoch of ["", ":epoch:1"]) {
        const reaudit = await store.readJsonObject({ objectId: `calibration:reaudit-review:batch:${keyId}${epoch}` });
        const hardest = await store.readJsonObject({ objectId: `calibration:repair-review:batch:${keyId}:hardest${epoch}` });
        assert.equal(reaudit.fidelity.output.status, "incomplete");
        assert.equal(hardest.fidelity.output.status, "repair_required");
      }
    });
  } finally { await runtime.close(); }
});

test("epoch-zero work identities and passing record shape stay unchanged without recovery", async t => {
  const f = await fixture(t);
  const calls = [];
  const runtime = await f.open(mockPort({ calls }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const plan = await readPlan(f.config);
    const unit = plan.units.find(item => item.unit_id === plan.calibration[0].unit_id);
    const keyId = sha(unit.unit_id).slice(0, 40);
    const core = [{ unit_id: unit.unit_id, text: unit.text }];
    const extraction = calls.find(call => call.role === "extractor");
    const identity = { source_representation: unit.representation_id,
      core_range: { start_byte: unit.start_byte, end_byte: unit.end_byte } };
    const dependencies = [{ key: "omission", stage: "OMISSION_CHECK", role: "omission_checker", identity,
      assigned_core_ids: extraction.packet.assigned_core_ids, source_locators: extraction.packet.source_locators,
      packet_input: { core_units: core, adjacent_context: extraction.packet.adjacent_context,
        candidate_extraction: { $work_output: "extractor" }, target_generation: extraction.packet.expected_generation } }];
    for (const call of calls.filter(call => ["reference_reader", "extractor", "fidelity_auditor"].includes(call.role))) {
      const { protocol_version, output_schema_id, assigned_core_ids, source_locators, expected_generation,
        controller_provenance_tag, grant_purpose, ...packetInput } = call.packet;
      const prefix = call.role === "reference_reader" ? "reference:calibration" : call.role === "extractor"
        ? "extract" : "fidelity:calibration";
      const id = `${prefix}:batch:${keyId}${call.role === "extractor" ? ":cycle:0" : ""}`;
      const oldJobId = `job:${sha(JSON.stringify({ id, role: call.role,
        stage: call.role === "extractor" ? "EXTRACT" : "REFERENCE_AUDIT", packetInput,
        assigned_core_ids, source_locators, dependencies: call.role === "extractor" ? dependencies : [],
        instruction: journalRoleInstruction(call.role),
        dependency_instructions: call.role === "extractor" ? [journalRoleInstruction("omission_checker")] : [] }))}`;
      if (call.role !== "extractor") assert.equal(call.operationKey, oldJobId);
      else {
        const state = await checkpoint(f.config);
        const secret = await fs.readFile(path.join(f.config.execution_root, "staging.key"));
        try {
          const oldWorkId = computeJournalWorkId({ case_id: state.case_id, corpus_id: state.corpus_id,
            ...identity, role: "extractor", prompt_version: `1.0:${sha(oldJobId).slice(0, 24)}`,
            model_profile: "synthetic", grant_purpose }, secret);
          assert.equal(controller_provenance_tag, oldWorkId);
          assert.equal(call.operationKey, `journal:${oldWorkId.slice(5, 45)}:${sha(JSON.stringify(call.packet)).slice(0, 32)}`);
        } finally { secret.fill(0); }
      }
    }
    assert.deepEqual(calls.map(call => call.role), ["reference_reader", "extractor", "omission_checker", "fidelity_auditor", "reconciler"]);
    assert.equal(Object.hasOwn(await calibrationRecord(f.config), "diagnostics"), false);
  } finally { await runtime.close(); }
});

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
  for (const unsafe of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, 1n, new Date(0), () => 1, undefined]) {
    assert.throws(() => validateCalibrationDiagnostics({ cycles: [{ assertions: unsafe }] }),
      { code: "JOURNAL_DIAGNOSTICS_VALUE_UNSAFE" });
  }
  const recallMet = fidelityCycleDiagnostics({ status: "repair_required", assessments: [] }, { critical_miss_count: 0, qualifier_error_count: 0,
    reference_total: 2, reference_counts: { preserved: 2, omitted: 0, distorted: 0, unassessed: 0 },
    provisional_target_met: true, reference_recall: 1 }, false);
  assert.deepEqual(validateCalibrationDiagnostics({ fidelity_cycles: [{ cycle: 0, fidelity: recallMet }] })
    .fidelity_cycles[0].fidelity, { status: "repair_required",
    assessments_by_outcome_and_finding_type: extractionCycleDiagnostics([null, { output: {
      status: "repair_required", assessments: [], proposed_repairs: [], unassessed_ids: [] } }])
      .omission.assessments_by_outcome_and_finding_type,
    critical_miss_count: 0, qualifier_error_count: 0,
    unassessed: 0, reference_total: 2, reference_counts: { preserved: 2, omitted: 0, distorted: 0, unassessed: 0 },
    recall_target_met: true, calibration_pass: false });
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
    assert.deepEqual(diagnostics.fidelity_cycles.map((cycle) => cycle.fidelity?.calibration_pass ?? null),
      [false, null, false]);
    assert.deepEqual(diagnostics.fidelity_cycles.filter((cycle) => cycle.fidelity).map((cycle) =>
      [cycle.fidelity.reference_total, cycle.fidelity.recall_target_met]), [[0, null], [0, null]]);
    assert.deepEqual(diagnostics.fidelity_cycles.map((cycle) => cycle.blocker_code), [null, null, null]);
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
  // Both calibration units (the native window and the visual page) are tried before the gate closes.
  const firstCount = failedCalls.filter((call) => call.role === "extractor").length;
  assert.equal(firstCount, 6);
  assert.deepEqual([failed.calibration_failure.failed_units, failed.calibration_failure.completed_calibration_units,
    failed.calibration_failure.calibration_units], [2, 2, 2]);
  assert.deepEqual(failed.calibration_failure.failures.map((item) => item.reason),
    ["CALIBRATION_EXTRACTION_UNRESOLVED", "CALIBRATION_EXTRACTION_UNRESOLVED"]);
  assert.equal(failed.calibration_failure.failures[0].unit_id, failed.calibration_failure.unit_id);
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
      diagnostics: before.calibration_failure.diagnostics, failed_units: 2, completed_calibration_units: 2,
      calibration_units: 2, failures: before.calibration_failure.failures });
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

for (const role of ["reference_reader", "extractor"]) {
  test(`exhausted hardest ${role} preflight stops calibration with zero new slots`, async t => {
    const f = await fixture(t);
    f.config.hardest_lane = { enabled: true, daily_limit: 20 };
    const calls = [];
    const base = mockPort({ fail: role === "extractor", failReference: role === "reference_reader", calls });
    const port = { ...base, isAuthoritativeCompletion: async () => true,
      async getCompletion(key, options) {
        if (options?.tier === "hardest") return { status: "exhausted", code: "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED" };
        return base.getCompletion(key);
      } };
    const runtime = await f.open(port);
    try {
      const result = await runtime.execute("run");
      assert.equal(result.calibration, "failed");
      assert.equal(result.hardest_lane.sent, 0);
      assert.equal(calls.filter(call => call.role === role).length, 3);
      assert.equal(result.residuals.hardest_attempted, 1);
      assert.equal(result.residuals.hardest_resolved, 0);
    } finally { await runtime.close(); }
  });
}

for (const heldStatus of ["attempted", "isolation_refused"]) {
  test(`reference-audit recovery of an ${heldStatus} hardest identity consumes no resend slots`, async t => {
    const f = await fixture(t);
    f.config.hardest_lane = { enabled: true, daily_limit: 20 };
    const root = path.join(path.dirname(f.configPath), "exchange");
    await fs.mkdir(root, { mode: 0o700 });
    const exchange = createJournalWorkExchange({ root, secret: randomBytes(32) });
    const raw = createExchangeJournalInferencePort({ exchange, caseId: "synthetic-case", receiptKey: randomBytes(32),
      routeRef: "route:synthetic", model: "gpt-6-sol", effort: "medium", executionAttestation: "codex_exec", waitMs: 0,
      allowanceEvidence: { authorization_ref: "allowance:synthetic", maximum_incremental_cost_usd: 0 } });
    const makePort = () => ({ ...raw, close() {}, async invoke(input) {
      try { return await raw.invoke(input); }
      catch (error) {
        if (error.code !== "COMPLETION_UNKNOWN" || input.tier === "hardest") throw error;
        const workId = journalExchangeWorkId(input.operationKey);
        const entry = await exchange.readWork(workId);
        const output = exchangeAnswer(entry);
        if (entry.role === "reference_reader") output.reference_items = invalidReferenceItems(entry.packet);
        await exchange.submitResult({ workId, output, subject: "local:synthetic-codex",
          execution: { profile_evidence: "codex_exec_request_pinned", effective_model_profile: "gpt-6-sol",
            effective_effort: "medium", request_context_id: "codex-thread:synthetic12345678" } });
        return raw.invoke(input);
      }
    } });
    let runtime = await f.open(makePort());
    const first = await runtime.execute("run");
    assert.equal(first.blocker, "COMPLETION_UNKNOWN");
    assert.equal(first.hardest_lane.sent, 1);
    const [record] = await exchange.listDispatch();
    assert.equal(record.tier, "hardest");
    assert.equal(record.role, "reference_reader");
    const claim = "11111111-1111-4111-8111-111111111111";
    for (const command of ["attempt-reserve", heldStatus === "attempted" ? "attempt-mark" : "attempt-refuse"]) {
      await runJournalWork([command, "--work-id", record.work_id, "--claim", claim],
        { environment: { INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: root }, stdout: { write() {} } });
    }
    // Model an older expired unanswered item, rather than the new terminal close.
    await exchange.closeUnanswered(record.work_id);
    await runtime.close();
    runtime = await f.open(makePort(), true);
    try {
      const started = Date.now();
      const resumed = await runtime.execute("run");
      assert.equal(resumed.calibration, "failed");
      assert.equal(resumed.calibration_failure.reason, "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED");
      assert.equal(resumed.hardest_lane.sent, 1, "a refused resend charged a daily slot");
      assert.ok(Date.now() - started < 5000, "resend waited for expiry");
      assert.deepEqual(await exchange.listDispatch(), []);
    } finally { await runtime.close(); raw.close(); }
  });
}

for (const outcome of ["resolves", "fails", "refused", "rejected"]) {
  const resolves = outcome === "resolves", refused = outcome === "refused", rejected = outcome === "rejected";
  test(`environment-loaded Codex exchange and fake SSH Claude hardest extraction (${outcome})`, async (t) => {
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
    await fs.writeFile(path.join(home, "fixture.json"), JSON.stringify({ root, secretFile, resolves, refused, rejected }), { mode: 0o600 });
    await fs.writeFile(ssh, `#!${process.execPath}\nimport fs from "node:fs";\nimport { spawnSync } from "node:child_process";\nconst fixture = JSON.parse(fs.readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));\nconst args = process.argv.slice(2);\nif (!args.includes("ForwardAgent=no") || !args.includes("ForwardX11=no")) process.exit(31);\nconst result = spawnSync("/bin/sh", ["-c", args.at(-1)], { encoding: "utf8", input: fs.readFileSync(0), env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_ROOT: fixture.root, INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE: fixture.secretFile } });\nprocess.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? ""); process.exit(result.status ?? 1);\n`, { mode: 0o700 });
    await fs.writeFile(claude, `#!${process.execPath}\nimport fs from "node:fs";\nimport { randomUUID } from "node:crypto";\nimport { spawnSync } from "node:child_process";\nconst { resolves, refused, rejected } = JSON.parse(fs.readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));\nconst args = process.argv.slice(2);\nconst config = JSON.parse(fs.readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));\nconst workId = args[args.indexOf("-p") + 1].match(/item ([^ .]+)/)[1];\nconsole.log(JSON.stringify({ type: "system", subtype: "init", mcp_servers: [{ name: "journal", status: "connected" }], tools: ["mcp__journal__get_journal_work_packet", "mcp__journal__submit_journal_work_result"], skills: [], slash_commands: [], plugins: [], agents: [], session_id: args[args.indexOf("--session-id") + 1] }));\nif (refused) { console.log(JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "bash-call", name: "Bash", input: { command: "true" } }] } })); setInterval(() => {}, 1000); }\nconst server = config.mcpServers.journal;\nconst call = (name, arguments_) => { const result = spawnSync(server.command, server.args, { encoding: "utf8", env: process.env, input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } }) + "\\n" }); if (result.status !== 0) process.exit(32); return JSON.parse(result.stdout.trim()).result.structuredContent; };\nconsole.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "packet-call", name: "mcp__journal__get_journal_work_packet", input: { work_id: workId } }] } }));\nconst fetched = call("get_journal_work_packet", { work_id: workId });\nconsole.log(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "packet-call", content: JSON.stringify(fetched) }] } }));\nconst review = (role) => ({ schema_version: "1.0", target_generation: fetched.packet.expected_generation, review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });\nconst output = ["omission_checker", "fidelity_auditor"].includes(fetched.role) ? review(fetched.role) : { schema_version: "1.0", status: resolves ? "complete" : "incomplete", assertions: [], entities: [], episodes: [], requested_context: [], coverage: fetched.packet.core_units.map((unit) => ({ unit_id: unit.unit_id, disposition: resolves ? "no_assertion" : "pending", assertion_local_ids: [], reason: "Synthetic hardest extraction." })) };\nconsole.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__journal__submit_journal_work_result", input: { work_id: workId } }] } }));\nconst submitted = call("submit_journal_work_result", { work_id: workId, output });\nif (submitted.code) process.exit(33);\nconsole.log(JSON.stringify({ type: "result", is_error: false, subtype: "success", session_id: args[args.indexOf("--session-id") + 1], modelUsage: { [rejected ? "claude-other-synthetic" : "claude-opus-5-5"]: { inputTokens: 1, outputTokens: 2 } }, usage: { input_tokens: 1, output_tokens: 2 } }));\n`, { mode: 0o700 });
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
      "--remote-checkout", checkout, "--remote-config", f.configPath, "--remote-node", process.execPath, "--work-dir", workDir,
      "--ssh-bin", ssh, "--claude-bin", claude, "--once", "--max-items", "1", "--timeout-ms", "5000", "--log", path.join(home, "worker-log.jsonl")];
    let completed = false, summary, failure, refusedAt = null;
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
            // An isolation violation, here a Bash call after model reach, closes the item and stops the worker (78).
            assert.equal(await runJournalClaudeWorker(workerArgs, { environment: laptopEnvironment }), refused ? 78 : 0);
            if (refused || rejected) refusedAt = Date.now();
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
      // An unresolved hardest answer gets one repair at the same tier; a refused one does not.
      assert.equal(tiers.filter(([role, tier]) => role === "extractor" && tier === "hardest").length,
        outcome === "fails" ? 2 : 1);
      assert.equal(summary.calibration, resolves ? "pass" : "failed");
      assert.equal(summary.calibration_failure?.reason, resolves ? undefined : "CALIBRATION_EXTRACTION_UNRESOLVED");
      assert.ok(summary.hardest_lane.sent >= 1);
      const outcomes = (await fs.readFile(path.join(home, "worker-log.jsonl"), "utf8")).trim().split("\n")
        .map((line) => JSON.parse(line).outcome);
      assert.ok(outcomes.length >= 1);
      assert.deepEqual(outcomes, outcomes.map(() => refused ? "isolation_refused" : rejected ? "rejected:MODEL_USAGE_INVALID" : "answered"));
      if (refused || rejected) {
        assert.ok(Date.now() - refusedAt < 5000, "closed hardest item waited for its TTL");
        assert.equal(summary.hardest_lane.sent, 1, "refusal never charges a resend slot");
        assert.deepEqual(await exchange.listDispatch(), []);
        const resumed = await runtime.execute("run");
        assert.equal(resumed.calibration, "failed");
        assert.equal(resumed.hardest_lane.sent, 1);
      }
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
      // Three of the twelve calibration units fail (three extractions each), which reaches the default limit.
      assert.equal(calls.filter((call) => call.role === "extractor").length, 9);
      assert.deepEqual([failed.calibration_failure.failed_units, failed.calibration_failure.completed_calibration_units,
        failed.calibration_failure.calibration_units], [3, 3, 12]);
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

const noAssertions = (packet, status, reason = "Synthetic.", requested = []) => ({ schema_version: "1.0", status,
  assertions: [], entities: [], episodes: [],
  coverage: packet.core_units.map((unit) => ({ unit_id: unit.unit_id,
    disposition: status === "complete" ? "no_assertion" : "pending", assertion_local_ids: [], reason })),
  requested_context: requested });
const pageUnit = (plan, page) => plan.units.find((unit) => !unit.visual && unit.text.startsWith(`Synthetic page ${page} `));
const noAnswer = { supplied: 0, unavailable: 0, already_answered: 0 };

test("a request for the earlier text is answered with a wider window and the next pass completes", async t => {
  const f = await fixture(t, { pages: 3 });
  const calls = [];
  const runtime = await f.open(mockPort({ calls, extractor: (packet) => {
    const unit = packet.core_units[0];
    return unit.text.startsWith("Synthetic page 3 ") && !packet.repair_request
      ? noAssertions(packet, "needs_context", "Synthetic.", [{ unit_id: unit.unit_id, direction: "before", reason: "Synthetic earlier entry." }])
      : noAssertions(packet, "complete");
  } }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const plan = await readPlan(f.config);
    const [first, second, third] = [1, 2, 3].map((page) => pageUnit(plan, page));
    const extractions = calls.filter((call) => call.role === "extractor" && call.packet.assigned_core_ids[0] === third.unit_id)
      .map((call) => call.packet);
    assert.equal(extractions.length, 2);
    assert.equal(extractions[0].adjacent_context.by_unit[0].before, second.text);
    assert.equal(extractions[1].adjacent_context.by_unit[0].before, `${first.text}\n\n${second.text}`);
    assert.equal(extractions[1].adjacent_context.by_unit[0].after, extractions[0].adjacent_context.by_unit[0].after);
    assert.deepEqual(extractions[1].repair_request.context_response,
      [{ unit_id: third.unit_id, direction: "before", status: "supplied" }]);
    assert.equal(extractions[1].repair_request.cycle, 1);
    assert.equal(extractions[1].repair_request.omission_review, null);
    // The review sees the same wider window the extractor used.
    const review = calls.find((call) => call.role === "omission_checker" && call.packet.assigned_core_ids[0] === third.unit_id);
    assert.deepEqual(review.packet.adjacent_context, extractions[1].adjacent_context);
    const record = await withStore(f.config, (store) => store.readJsonObject({ objectId: `unit:graph:${third.unit_id}` }));
    assert.equal(record.source_only_unresolved, false);
    assert.deepEqual(record.diagnostics.cycles.map((cycle) => cycle.context_answer ?? null),
      [{ ...noAnswer, supplied: 1 }, null]);
    assert.deepEqual(record.diagnostics.cycles[0].extraction.requested_context_by_direction,
      { before: 1, after: 0, visual: 0, whole_entry: 0 });
    assert.equal(JSON.stringify(record.diagnostics).includes(fidelitySentinel), false);
  } finally { await runtime.close(); }
});

test("context that does not exist is answered as unavailable, then as already answered, with no extra pass", async t => {
  const f = await fixture(t);
  const calls = [];
  const runtime = await f.open(mockPort({ calls, extractor: (packet) => noAssertions(packet, "needs_context", "Synthetic.",
    ["before", "visual", "before"].map((direction) => ({ unit_id: packet.core_units[0].unit_id, direction, reason: "Synthetic." }))) }));
  try {
    const failed = await runtime.execute("run");
    assert.equal(failed.calibration_failure.reason, "CALIBRATION_EXTRACTION_UNRESOLVED");
    const unitId = failed.calibration_failure.unit_id;
    const responses = calls.filter((call) => call.role === "extractor")
      .map((call) => call.packet.repair_request?.context_response ?? null);
    assert.deepEqual(responses, [null,
      [{ unit_id: unitId, direction: "before", status: "unavailable" }, { unit_id: unitId, direction: "visual", status: "unavailable" }],
      [{ unit_id: unitId, direction: "before", status: "already_answered" }, { unit_id: unitId, direction: "visual", status: "already_answered" }]]);
    assert.deepEqual(failed.calibration_failure.diagnostics.cycles.map((cycle) => cycle.context_answer),
      [{ ...noAnswer, unavailable: 2 }, { ...noAnswer, already_answered: 2 }, { ...noAnswer, already_answered: 2 }]);
    assert.deepEqual(failed.calibration_failure.diagnostics.cycles[0].extraction.requested_context_by_direction,
      { before: 2, after: 0, visual: 1, whole_entry: 0 });
  } finally { await runtime.close(); }
});

test("a visual request adds the neighbouring pages' transcriptions that exist", async t => {
  const f = await fixture(t, { pages: 2, visual: true });
  const calls = [];
  const runtime = await f.open(mockPort({ calls, extractor: (packet) => {
    const unit = packet.core_units[0];
    return unit.text.startsWith("Synthetic page 2 ") && !packet.repair_request
      ? noAssertions(packet, "needs_context", "Synthetic.", [{ unit_id: unit.unit_id, direction: "visual", reason: "Synthetic drawing." }])
      : noAssertions(packet, "complete");
  } }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const plan = await readPlan(f.config);
    const second = pageUnit(plan, 2);
    const extractions = calls.filter((call) => call.role === "extractor" && call.packet.assigned_core_ids[0] === second.unit_id)
      .map((call) => call.packet);
    assert.deepEqual(extractions.map((packet) => packet.visual_transcriptions.map((item) => item.source_page_id)), [[], ["page:1"]]);
    assert.deepEqual(extractions[1].repair_request.context_response,
      [{ unit_id: second.unit_id, direction: "visual", status: "supplied" }]);
    // The omission check sees the transcriptions the extractor saw; a unit without any gets no such field.
    const reviewOf = (unitId) => calls.find((call) => call.role === "omission_checker"
      && call.packet.assigned_core_ids[0] === unitId).packet;
    assert.deepEqual(reviewOf(second.unit_id).visual_transcriptions, extractions[1].visual_transcriptions);
    const first = pageUnit(plan, 1);
    assert.deepEqual(reviewOf(first.unit_id).visual_transcriptions.map((item) => item.source_page_id), ["page:1"]);
  } finally { await runtime.close(); }
});

test("a visual answer that would push the packet over its bound is refused and reported unavailable", async t => {
  const f = await fixture(t, { pages: 3 });
  f.config.visual_hazard_pages = [1, 3];
  const calls = [];
  const runtime = await f.open(mockPort({ calls,
    visual: (packet) => ({ schema_version: "1.0", source_page_id: packet.assigned_core_ids[0],
      regions: [{ region_id: "region:synthetic", bbox: [0, 0, 1, 1], kind: "text",
        transcription: `Synthetic long transcription.\n${"Synthetic line of handwriting.\n".repeat(3_000)}`,
        non_graphic_description: null, interpretation_status: "readable", speaker_or_document_label: null, table_cells: [] }],
      page_complete: true, missing_or_uncertain_regions: [] }),
    extractor: (packet) => {
      const unit = packet.core_units[0];
      return unit.text.startsWith("Synthetic page 2 ") && !packet.repair_request
        ? noAssertions(packet, "needs_context", "Synthetic.", [{ unit_id: unit.unit_id, direction: "visual", reason: "Synthetic drawing." }])
        : noAssertions(packet, "complete");
    } }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const second = pageUnit(await readPlan(f.config), 2);
    const extractions = calls.filter((call) => call.role === "extractor" && call.packet.assigned_core_ids[0] === second.unit_id)
      .map((call) => call.packet);
    assert.equal(extractions.length, 2);
    assert.deepEqual(extractions[1].visual_transcriptions, []);
    assert.deepEqual(extractions[1].repair_request.context_response,
      [{ unit_id: second.unit_id, direction: "visual", status: "unavailable" }]);
  } finally { await runtime.close(); }
});

test("a batch of several units that names the context it needs is answered instead of split", async t => {
  const f = await fixture(t, { pages: 3 });
  f.config.semantic_batching = { calibration_maximum_units: 2, maximum_units: 2 };
  const calls = [];
  const runtime = await f.open(mockPort({ calls, extractor: (packet) => packet.core_units.length === 2 && !packet.repair_request
    ? noAssertions(packet, "needs_context", "Synthetic.", [{ unit_id: packet.core_units[0].unit_id, direction: "whole_entry", reason: "Synthetic." }])
    : noAssertions(packet, "complete") }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const plan = await readPlan(f.config);
    const [first, second, third] = [1, 2, 3].map((page) => pageUnit(plan, page));
    const batch = calls.filter((call) => call.role === "extractor" && call.packet.assigned_core_ids.length === 2).map((call) => call.packet);
    assert.equal(batch.length, 2);
    assert.equal(calls.filter((call) => call.role === "extractor" && [first.unit_id, second.unit_id]
      .includes(call.packet.assigned_core_ids[0]) && call.packet.assigned_core_ids.length === 1).length, 0, "no split");
    assert.equal(batch[1].adjacent_context.by_unit[0].after, `${second.text}\n\n${third.text}`);
    assert.equal(batch[1].adjacent_context.by_unit[0].before, "");
    assert.deepEqual(batch[1].repair_request.context_response,
      [{ unit_id: first.unit_id, direction: "whole_entry", status: "supplied" }]);
    assert.deepEqual(batch[1].adjacent_context.by_unit[1], batch[0].adjacent_context.by_unit[1]);
  } finally { await runtime.close(); }
});

test("an unresolved hardest extraction gets one repair at the same tier, which resolves the unit", async t => {
  const f = await fixture(t);
  f.config.hardest_lane = { enabled: true };
  const calls = [];
  let tier = "standard";
  const base = mockPort({ calls,
    extractor: (packet) => tier !== "hardest" ? noAssertions(packet, "incomplete", "Synthetic standard.")
      : noAssertions(packet, "complete", packet.repair_request?.cycle === "hardest-repair" ? "Synthetic hardest repair." : "Synthetic hardest."),
    omission: (packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, review_role: "omission_checker",
      ...(packet.candidate_extraction.coverage[0].reason === "Synthetic hardest."
        ? { status: "repair_required", proposed_repairs: [{ target_id: "synthetic-target", repair: "Synthetic.", evidence_ids: [] }],
          assessments: [{ target_id: "synthetic-target", outcome: "distorted", critical: false, finding_type: "wrong_mode",
            explanation: "Synthetic.", evidence_ids: [] }] }
        : { status: "sufficient_for_stated_scope", assessments: [], proposed_repairs: [] }), unassessed_ids: [] }) });
  const port = { ...base, invoke(input) { tier = input.tier ?? "standard"; return base.invoke(input); } };
  const runtime = await f.open(port);
  try {
    const summary = await runtime.execute("run");
    assert.equal(summary.calibration, "pass");
    assert.deepEqual([summary.residuals.hardest_attempted, summary.residuals.hardest_resolved], [1, 1]);
    assert.equal(summary.hardest_lane.sent, 4);
    assert.deepEqual(calls.filter((call) => call.tier === "hardest").map((call) => call.role),
      ["extractor", "omission_checker", "extractor", "omission_checker"]);
    const repair = calls.filter((call) => call.tier === "hardest" && call.role === "extractor")[1].packet.repair_request;
    assert.equal(repair.cycle, "hardest-repair");
    assert.equal(repair.previous_extraction.coverage[0].reason, "Synthetic hardest.");
    assert.equal(repair.omission_review.status, "repair_required");
    assert.equal(repair.mechanical_failure, null);
    assert.equal(Object.hasOwn(repair, "context_response"), false);
    const record = await calibrationRecord(f.config);
    assert.equal(record.source_only_unresolved, false);
    assert.equal(record.diagnostics.hardest.omission.status, "repair_required");
    assert.equal(record.diagnostics.hardest.repair.omission.status, "sufficient_for_stated_scope");
    assert.equal(record.diagnostics.hardest.repair.extraction_changed, true);
    const count = calls.length;
    assert.equal((await runtime.execute("run")).calibration, "pass");
    assert.equal(calls.length, count, "the hardest repair is replayed without a second send");
  } finally { await runtime.close(); }
});

test("a calibration failure limit of one stops at the first failing unit, and an invalid limit is refused", async t => {
  const f = await fixture(t, { pages: 3 });
  f.config.calibration_failure_limit = 1;
  const calls = [];
  const runtime = await f.open(mockPort({ fail: true, calls }));
  try {
    const failed = await runtime.execute("run");
    assert.deepEqual([failed.calibration_failure.failed_units, failed.calibration_failure.completed_calibration_units,
      failed.calibration_failure.calibration_units], [1, 1, 3]);
    assert.equal(calls.filter((call) => call.role === "extractor").length, 3);
  } finally { await runtime.close(); }
  const g = await fixture(t);
  g.config.calibration_failure_limit = 0;
  const refused = await g.open(mockPort({ calls: [] }));
  try { await assert.rejects(refused.execute("run"), { code: "JOURNAL_CALIBRATION_FAILURE_LIMIT_INVALID" }); }
  finally { await refused.close(); }
});

test("the failure limit also stops the rest of a split calibration batch", async t => {
  const f = await fixture(t, { pages: 3 });
  f.config.semantic_batching = { calibration_maximum_units: 3, maximum_units: 3 };
  f.config.calibration_failure_limit = 1;
  const calls = [];
  const runtime = await f.open(mockPort({ fail: true, calls }));
  try {
    const failed = await runtime.execute("run");
    assert.deepEqual([failed.calibration_failure.failed_units, failed.calibration_failure.completed_calibration_units,
      failed.calibration_failure.calibration_units], [1, 1, 3]);
    // One pass of the whole batch, one of its first half, then three passes of the first unit; nothing after it.
    assert.deepEqual(calls.filter((call) => call.role === "extractor").map((call) => call.packet.assigned_core_ids.length),
      [3, 2, 1, 1, 1]);
    assert.equal(new Set(calls.filter((call) => call.role === "extractor" && call.packet.assigned_core_ids.length === 1)
      .map((call) => call.packet.assigned_core_ids[0])).size, 1);
  } finally { await runtime.close(); }
});

test("failures recorded before a pause count toward the limit after the restart", async t => {
  const f = await fixture(t, { pages: 3 });
  f.config.hardest_lane = { enabled: true, daily_limit: 2 };
  f.config.calibration_failure_limit = 2;
  let day = "2026-10-03T12:00:00Z";
  const now = () => new Date(day);
  const calls = [];
  let runtime = await f.open(mockPort({ fail: true, calls }), false, process.env, now);
  try {
    const paused = await runtime.execute("run");
    assert.equal(paused.blocker, "HARDEST_DAILY_LIMIT");
    assert.equal(paused.calibration, "not_run");
    assert.equal(paused.completed_units, 1);
    // The round's failure so far is visible in the checkpoint while the run is paused.
    const midRound = (await checkpoint(f.config)).calibration_round_failures;
    assert.deepEqual(midRound.map((item) => [item.status, item.reason]),
      [["CALIBRATION_REPAIR_REQUIRED", "CALIBRATION_EXTRACTION_UNRESOLVED"]]);
    assert.equal(midRound[0].diagnostics.hardest.repair.extraction.status, "incomplete");
  } finally { await runtime.close(); }
  day = "2026-10-04T12:00:00Z";
  runtime = await f.open(mockPort({ fail: true, calls }), true, process.env, now);
  try {
    const failed = await runtime.execute("run");
    assert.equal(failed.calibration, "failed");
    assert.deepEqual([failed.calibration_failure.failed_units, failed.calibration_failure.completed_calibration_units,
      failed.calibration_failure.calibration_units], [2, 2, 3]);
    const third = pageUnit(await readPlan(f.config), 3);
    assert.equal(calls.some((call) => call.packet.assigned_core_ids?.[0] === third.unit_id && call.role === "extractor"), false);
    assert.deepEqual(failed.calibration_failure.failures.map((item) => Object.hasOwn(item.diagnostics.hardest, "repair")), [true, true]);
    assert.equal(Object.hasOwn(await checkpoint(f.config), "calibration_round_failures"), false);
  } finally { await runtime.close(); }
});

test("a later chunk of a long page transcription gets the earlier chunks of the same page first", async t => {
  const f = await fixture(t, { pages: 2, visual: true });
  const calls = [];
  const runtime = await f.open(mockPort({ calls,
    visual: (packet) => ({ schema_version: "1.0", source_page_id: packet.assigned_core_ids[0],
      regions: [{ region_id: "region:synthetic", bbox: [0, 0, 1, 1], kind: "text",
        transcription: "Synthetic line of handwriting.\n".repeat(1_400),
        non_graphic_description: null, interpretation_status: "readable", speaker_or_document_label: null, table_cells: [] }],
      page_complete: true, missing_or_uncertain_regions: [] }),
    extractor: (packet) => {
      const unit = packet.core_units[0], locator = packet.source_locators[0];
      return locator.representation_id.startsWith("visual:") && locator.start_byte > 0 && !packet.repair_request
        ? noAssertions(packet, "needs_context", "Synthetic.", [{ unit_id: unit.unit_id, direction: "before", reason: "Synthetic." }])
        : noAssertions(packet, "complete");
    } }));
  try {
    assert.equal((await runtime.execute("run")).calibration, "pass");
    const chunks = (await readPlan(f.config)).units.filter((unit) => unit.visual);
    assert.ok(chunks.length >= 3);
    const packets = calls.filter((call) => call.role === "extractor" && call.packet.assigned_core_ids[0] === chunks[1].unit_id)
      .map((call) => call.packet);
    assert.equal(packets.length, 2);
    assert.equal(packets[0].adjacent_context.by_unit[0].before, chunks[1].context.before);
    assert.equal(packets[1].adjacent_context.by_unit[0].before, chunks[0].text);
    assert.deepEqual(packets[1].repair_request.context_response,
      [{ unit_id: chunks[1].unit_id, direction: "before", status: "supplied" }]);
  } finally { await runtime.close(); }
});
