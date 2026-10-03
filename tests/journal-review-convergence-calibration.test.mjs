// Calibration repairs judged on what a unit keeps after withholding (synthetic, one unit, one critical reference item).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { openJournalExecutionRuntime } = await import(`../src/journal-import/private-runtime.mjs`);
const { createMockJournalInferencePort } = await import(`../src/journal-import/provider-port.mjs`);
const { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } = await import(`../src/storage/private-case-access.mjs`);

const CASE_ID = "synthetic-case";
const WRITER = "synthetic-operator-token";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const TEXT = "Synthetic Monday: I walked by the river and felt calm.";

async function environment(t, hardest = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-convergence-calibration-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  await fs.writeFile(path.join(root, "private", "source.txt"), TEXT, { mode: 0o600 });
  const credentialsPath = path.join(root, "credentials.json");
  await fs.writeFile(credentialsPath, `${JSON.stringify({ schema_version: 1, root_dir: path.join(root, "vaults"), grants: [
    { token_sha256: sha256(WRITER), principal_id: "journal-operator", case_ids: [CASE_ID], scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] }
  ], case_keys: { [CASE_ID]: { routine_kek_base64: Buffer.alloc(32, 7).toString("base64"), recovery_secret_base64: Buffer.alloc(32, 9).toString("base64") } } })}\n`, { mode: 0o600 });
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  await service.appendJournal(CASE_ID, { id: "legacy-synthetic", observed_at: "2026-01-01T00:00:00.000Z", kind: "journal", text: "Invented legacy entry" }, { bearerToken: WRITER });
  const config = { schema_version: 1, max_external_spend_usd: 0, execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(TEXT), sha256: sha256(TEXT) },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:grant",
    semantic_batching: { calibration_maximum_units: 1, maximum_units: 1 }, hardest_lane: { enabled: hardest } };
  const configPath = path.join(root, "private", "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const sourceParser = async () => ({ source: { sha256: config.source.sha256, byte_length: config.source.bytes, mime_type: "text/plain" },
    parser: { version: "synthetic-one" },
    pages: [{ page_number: 1, representation_id: "synthetic:one", disposition: "readable", warnings: [], image_inventory: [] }],
    representations: [{ representation_id: "synthetic:one", text: TEXT, utf8_byte_length: Buffer.byteLength(TEXT) }] });
  return { config, configPath, service, sourceParser, environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER } };
}
const unknownTime = { raw: null, from: null, to: null, precision: "unknown", timezone: null, basis: "unresolved", evidence_ids: [] };
const review = (role, packet) => ({ schema_version: "1.0", target_generation: packet.expected_generation, review_role: role,
  assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });
const handlersFor = ({ failFirstFidelityRepair = false, citeCarrier = true } = {}) => ({
  reference_reader: (packet) => ({ schema_version: "1.0", source_only_first_pass: true,
    reference_items: [{ id: "reference:critical", statement: "Synthetic critical proposition.", required_qualifiers: [],
      anchors: [{ unit_id: packet.source_windows[0].unit_id, quote: packet.source_windows[0].text, occurrence: null }],
      importance_reason: "Synthetic critical item.", critical: true }], questions: [], unassessed_unit_ids: [] }),
  extractor: (packet) => { if (failFirstFidelityRepair && packet.repair_request?.cycle === "fidelity-1") return {};
    const unit = packet.core_units[0]; const anchors = [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }];
    return { schema_version: "1.0", status: "complete",
      entities: [{ local_id: "self", label: "Synthetic diarist", entity_kind: "person", anchors }], episodes: [],
      assertions: [{ local_id: "a0", statement: "Synthetic report 0.", assertion_kind: "direct_report", narrative_mode: "waking",
        speaker_local_id: "self", subject_local_ids: ["self"], episode_local_id: null, polarity: "affirmed", qualifiers: [],
        authored_time: unknownTime, event_time: unknownTime, anchors, importance_reasons: ["synthetic"], extraction_confidence: "high" }],
      coverage: [{ unit_id: unit.unit_id, disposition: "extracted", assertion_local_ids: ["a0"], reason: null }], requested_context: [] }; },
  omission_checker: (packet) => review("omission_checker", packet),
  // Like round 4's unit 2: the critical reference item is kept, carried by the saved assertion, and the same
  // assertion is called unsupported in the candidate sample.
  fidelity_auditor: (packet) => { const [node] = packet.imported_generation.assertions;
    return { ...review("fidelity_auditor", packet), status: "repair_required", assessments: [
      { target_id: "reference:critical", outcome: "preserved", critical: true, finding_type: "none", explanation: "Kept.", evidence_ids: citeCarrier ? [node.id] : [] },
      { target_id: node.id, outcome: "distorted", critical: false, finding_type: "unsupported_claim", explanation: "Addition.", evidence_ids: [] }] }; }
});

async function runOnce(t, { hardest, ...options }) {
  const f = await environment(t, hardest);
  const calls = [];
  const base = createMockJournalInferencePort({ handlers: handlersFor(options) });
  const port = { capabilities: base.capabilities, getCompletion: base.getCompletion,
    invoke(input) { calls.push(input); return base.invoke(input); }, close: base.close };
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort: port, environment: f.environment });
  try { return { run: await runtime.execute("run"), calls }; }
  finally { await runtime.close(); }
}

test("the hardest fidelity repair still runs when withholding the flagged carrier would miss a critical item", async (t) => {
  // Every audit keeps the critical item through assertion a0 and calls a0 unsupported. Before withholding the
  // reference score passes, after it the item is lost, so the hardest tier gets its repair before a miss counts.
  const { run, calls } = await runOnce(t, { hardest: true });
  assert.ok(calls.some((call) => call.tier === "hardest" && call.role === "extractor"), "the hardest fidelity repair ran");
  assert.equal(run.residuals.hardest_attempted, 1);
  assert.equal(run.calibration, "failed");
  assert.equal(run.calibration_failure.status, "CALIBRATION_REFERENCE_MISSED");
  assert.equal(run.calibration_gate.critical_miss_count, 1);
});

test("a standard fidelity repair that runs out of attempts keeps the unit's earlier audited attempt", async (t) => {
  // The first audit keeps the critical item without citing a carrier and flags a0; the first repair returns
  // invalid output until its attempts run out. The unit keeps the first attempt with a0 withheld.
  const { run, calls } = await runOnce(t, { hardest: false, failFirstFidelityRepair: true, citeCarrier: false });
  assert.equal(calls.filter((call) => call.role === "fidelity_auditor").length, 1);
  assert.equal(run.calibration, "pass");
  assert.equal(run.calibration_gate.preserved, 1);
  assert.equal(run.calibration_gate.withheld_assertions, 1);
  assert.equal(run.calibration_gate.failed_units, 0);
});
