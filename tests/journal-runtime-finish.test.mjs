import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";

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

async function drive(f, roleHandlers, calls = []) {
  const inferencePort = createMockJournalInferencePort({ handlers: Object.fromEntries(Object.entries(roleHandlers)
    .map(([role, handler]) => [role, (packet) => { calls.push(role); return handler(packet); }])) });
  const runtime = await openJournalExecutionRuntime({ config: f.config, configPath: f.configPath, service: f.service,
    sourceParser: f.sourceParser, inferencePort, environment: f.environment });
  try {
    const summaries = {};
    for (const command of ["run", "audit", "patterns", "commit"]) summaries[command] = await runtime.execute(command);
    return summaries;
  } finally { await runtime.close(); }
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

test("a reference that never quotes its source is asked again, and a unit no attempt can audit is counted", async (t) => {
  const f = await environment(t);
  const calls = [];
  let finalReferences = 0;
  const { run, audit, commit } = await drive(f, handlers({
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
    }
  }), calls);
  assert.deepEqual([run.calibration, run.completion.graph_built], ["pass", "pass"]);
  assert.deepEqual([audit.stage, audit.completion.semantically_audited, audit.blocker], ["PATTERN_BUILD", "partial", null]);
  assert.ok(audit.residuals.audit_unassessed_units > 0);
  assert.ok(finalReferences >= 3, "each audited unit is asked three times before it is recorded as unassessed");
  assert.equal(commit.completion.profile_committed, "pass");
});

test("a successful reference freeze remains in the unassessed denominator when fidelity exhausts its attempts", async (t) => {
  const f = await environment(t);
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
    await runtime.execute("patterns");
    commit = await runtime.execute("commit");
  } finally { await runtime.close(); }
  assert.equal(audit.completion.semantically_audited, "partial");
  assert.ok(failedFidelityAttempts >= 3);
  assert.ok(audit.residuals.audit_unassessed_reference_items > 0,
    "frozen reference items must contribute to the audit's unassessed denominator");
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
  const published = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  const corpusId = published.journal_corpora[0].corpus_id;
  const result = await createJournalPrivateApi({ caseAccessService: f.service }).search({
    caseId: CASE_ID, corpusId, query: "Synthetic report",
    purpose: "organize_search", filters: { kinds: ["assertion"] }
  }, { bearerToken: READER });
  assert.deepEqual(result.items, [], "an ordinary consumer must not retrieve audit-failed assertions");
});
