import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  certifyIndependentAudit,
  createDeterministicAuditSample,
  createJournalAuditPipeline,
  scoreReferenceReview,
  selectCalibrationWindows
} from "../src/journal-import/audit.mjs";
import {
  addProvisionalPatterns,
  buildEpisodeThemeMatrix,
  executeCounterevidenceSearch,
  reviewPatternRegister
} from "../src/journal-import/pattern.mjs";
import { createContentFreeAuditReport } from "../src/journal-import/report.mjs";
import { buildJournalRolePacket, createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { validateJournalGraph } from "../src/journal-import/contracts.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
const generation = "generation-1";
const auditGrant = Object.freeze({
  grant_id: "grant:audit",
  principal_id: "principal:audit",
  purpose: "organize_search",
  allowed_roles: ["reference_reader", "fidelity_auditor", "pattern_builder", "pattern_reviewer"],
  revoked: false,
  expires_at: null
});

function receipt(id, context, extra = {}) {
  return {
    receipt_id: `receipt:${id}`,
    transport: "mock",
    request_id: `request:${id}`,
    request_context_id: context,
    input_manifest_sha256: "a".repeat(64),
    role_instruction_sha256: "b".repeat(64),
    completion_status: "completed",
    target_generation: generation,
    grant_id: auditGrant.grant_id,
    grant_purpose: auditGrant.purpose,
    authentication_tag: "authenticated-synthetic-tag",
    ...extra
  };
}

const referenceOutput = () => ({
  schema_version: "1.0",
  source_only_first_pass: true,
  reference_items: [
    { id: "reference:one", statement: "An invented action was reported.", required_qualifiers: ["reported"], anchors: [{ unit_id: "unit:one", quote: "invented action", occurrence: null }], importance_reason: "synthetic coverage", critical: true },
    { id: "reference:two", statement: "An invented qualifier remains.", required_qualifiers: ["remains"], anchors: [{ unit_id: "unit:two", quote: "invented qualifier", occurrence: null }], importance_reason: "synthetic qualifier", critical: false }
  ],
  questions: [],
  unassessed_unit_ids: []
});

const fidelityOutput = () => ({
  schema_version: "1.0",
  target_generation: generation,
  review_role: "fidelity_auditor",
  assessments: [
    { target_id: "reference:one", outcome: "preserved", critical: false, finding_type: "none", explanation: "Synthetic item preserved.", evidence_ids: ["passage:one"] },
    { target_id: "reference:two", outcome: "unassessed", critical: false, finding_type: "lost_qualifier", explanation: "Synthetic qualifier not assessed.", evidence_ids: [] },
    { target_id: "candidate:one", outcome: "preserved", critical: false, finding_type: "none", explanation: "Synthetic candidate entailed.", evidence_ids: ["passage:one"] }
  ],
  proposed_repairs: [],
  unassessed_ids: ["reference:two"],
  status: "sufficient_for_stated_scope"
});

test("deterministic stratified sampling keeps duplicate groups distinct and challenge cases separate", () => {
  const units = Array.from({ length: 120 }, (_, index) => ({
    unit_id: `unit:${String(index).padStart(3, "0")}`,
    source_order: index,
    duplicate_group_id: `group:${String(Math.floor(index / 2)).padStart(3, "0")}`,
    hazard_types: index % 29 === 0 ? ["correction", "mode_crossing"] : []
  }));
  const first = createDeterministicAuditSample({ units, seed: "synthetic-seed" });
  const second = createDeterministicAuditSample({ units, seed: "synthetic-seed" });
  assert.deepEqual(first, second);
  assert.equal(new Set(first.inclusion_ledger.map(({ duplicate_group_id: id }) => id)).size, first.inclusion_ledger.length);
  assert.ok(first.inclusion_ledger.every(({ inclusion_probability: probability }) => probability > 0 && probability <= 1));
  assert.equal(first.targeted_is_population_estimate, false);
  assert.ok(first.targeted_challenge.length > 0);
  const calibration = selectCalibrationWindows(units);
  assert.ok(calibration.length >= 12);
  assert.ok(calibration.some(({ unit_id: id }) => id === "unit:116"));
});

test("source-first reference is frozen before candidate reveal and actual isolated receipts certify only stated coverage", async () => {
  let referenceSawCandidate = false;
  const port = createMockJournalInferencePort({ handlers: {
    reference_reader(packet) {
      referenceSawCandidate = Object.hasOwn(packet, "candidate_patterns") || Object.hasOwn(packet, "imported_generation");
      return referenceOutput();
    },
    fidelity_auditor(packet) {
      assert.equal(packet.frozen_reference.source_only_first_pass, true);
      assert.equal(packet.imported_generation, generation);
      return fidelityOutput();
    }
  } });
  const pipeline = createJournalAuditPipeline({ inferencePort: port, grant: auditGrant, auditSecret: Buffer.alloc(32, 61), generation });
  const frozen = await pipeline.freezeReference({
    assignedCoreIds: ["unit:one", "unit:two"],
    sourceLocators: [{ representation_id: "representation:synthetic" }],
    sourceWindows: [{ unit_id: "unit:one", text: "invented action" }, { unit_id: "unit:two", text: "invented qualifier" }]
  });
  assert.equal(referenceSawCandidate, false);
  const audited = await pipeline.auditCandidates({
    referenceFreeze: frozen,
    supportingPassages: [{ id: "passage:one", quote: "invented action" }],
    candidateIds: ["candidate:one", "candidate:missing"],
    assignedCoreIds: ["unit:one", "unit:two"],
    sourceLocators: [{ representation_id: "representation:synthetic" }],
    producerReceipt: receipt("producer", "producer-context")
  });
  assert.equal(audited.certification.semantically_audited, "pass");
  assert.equal(audited.score.reference_total, 2);
  assert.equal(audited.score.reference_counts.unassessed, 1);
  assert.equal(audited.score.reference_recall, 0.5);
  assert.equal(audited.score.candidate_precision, 0.5);
  assert.equal(audited.score.qualifier_error_count, 1);
  assert.equal(audited.score.global_recall_claim, false);
  pipeline.close();
  port.close();
});

test("same-context, stale-generation and model-authored receipt cannot certify review", () => {
  const frozen = { generation, reference: referenceOutput(), freeze_ref: "freeze:synthetic", receipt: receipt("reference", "shared-context") };
  const sameContext = certifyIndependentAudit({
    generation,
    referenceFreeze: frozen,
    fidelityOutput: fidelityOutput(),
    fidelityReceipt: receipt("fidelity", "shared-context"),
    producerReceipt: receipt("producer", "producer-context"),
    grantId: auditGrant.grant_id
  });
  assert.equal(sameContext.semantically_audited, "unavailable");
  assert.ok(sameContext.reasons.includes("INFERENCE_CONTEXT_NOT_INDEPENDENT"));

  const stale = certifyIndependentAudit({
    generation: "generation:new",
    referenceFreeze: frozen,
    fidelityOutput: fidelityOutput(),
    fidelityReceipt: receipt("fidelity", "fresh-context"),
    grantId: auditGrant.grant_id
  });
  assert.equal(stale.semantically_audited, "unavailable");
  assert.ok(stale.reasons.includes("REFERENCE_GENERATION_STALE"));

  const modelAuthored = certifyIndependentAudit({
    generation,
    referenceFreeze: { ...frozen, receipt: { transport: "model_output", completion_status: "completed" } },
    fidelityOutput: fidelityOutput(),
    fidelityReceipt: { transport: "model_output", completion_status: "completed" },
    grantId: auditGrant.grant_id
  });
  assert.equal(modelAuthored.semantically_audited, "unavailable");
  assert.ok(modelAuthored.reasons.includes("REFERENCE_RECEIPT_UNAUTHENTICATED"));
});

function graphWithoutPatterns() {
  const graph = fixture("synthetic-graph.json");
  graph.nodes = graph.nodes.filter(({ kind }) => kind !== "pattern");
  graph.edges = graph.edges.filter(({ from, to }) => from !== "pat" && to !== "pat");
  graph.edges.push({
    id: "about-assertion",
    case_id: graph.case_id,
    corpus_id: graph.corpus_id,
    version: 1,
    lifecycle: "active",
    relation: "about_theme",
    from: "a1",
    to: "theme",
    evidence_ids: ["p1"],
    basis: "direct_source",
    derivation_ref: null
  });
  return graph;
}

function patternOutput(supportIds = ["a1", "a3"]) {
  return {
    schema_version: "1.0",
    target_generation: generation,
    patterns: [{
      local_id: "candidate-pattern",
      data: {
        statement: "Synthetic reports sometimes move from hesitation to action.",
        pattern_kind: "recurrent",
        scope: "Only the two invented support groups.",
        support_assertion_ids: supportIds,
        counter_assertion_ids: ["a4"],
        alternative_explanations: ["Different invented contexts may explain the contrast."],
        observation_gaps: ["Unwritten periods remain unknown."],
        disconfirming_question: "Where did the invented action not follow?",
        disconfirmation: { status: "pending", search_receipt_ref: null },
        review_state: "provisional",
        independent_review_ref: null,
        producer_ref: "producer:synthetic"
      }
    }],
    unclassified_assertion_ids: ["a2", "a5", "a6", "a7"],
    coverage_note: "Invented pattern scope only.",
    status: "complete_for_stated_scope"
  };
}

function patternReview(patternId, { outcome = "preserved", critical = false, findingType = "none" } = {}) {
  return {
    schema_version: "1.0",
    target_generation: generation,
    review_role: "pattern_reviewer",
    assessments: [{ target_id: patternId, outcome, critical, finding_type: findingType, explanation: "Synthetic independent challenge.", evidence_ids: ["p1", "p3", "p4"] }],
    proposed_repairs: [],
    unassessed_ids: [],
    status: "sufficient_for_stated_scope"
  };
}

test('neutral theme proposals create source-linked matrix cells with independent batch identities',()=>{
  const graph=graphWithoutPatterns(),output=patternOutput();
  output.themes=[{local_id:'source-theme',label:'Invented action',origin:'source_term',assertion_ids:['a1','a3']}];
  output.patterns[0].counterevidence_queries=['invented hesitation','invented exception'];
  const first=addProvisionalPatterns({graph,patternResult:output,producerReceipt:receipt('theme-builder','fresh-theme'),localIdNamespace:'batch-one'});
  const second=addProvisionalPatterns({graph:first.graph,patternResult:output,producerReceipt:receipt('second-builder','fresh-second'),localIdNamespace:'batch-two'});
  assert.notEqual(first.created_pattern_ids[0],second.created_pattern_ids[0]);
  assert.notEqual(first.created_theme_ids[0],second.created_theme_ids[0]);
  const cells=buildEpisodeThemeMatrix(first.graph).cells.filter(c=>c.theme_id===first.created_theme_ids[0]);
  assert.deepEqual(cells.flatMap(c=>c.assertion_ids).sort(),['a1','a3']);
  assert.deepEqual(first.counterevidence_queries[first.created_pattern_ids[0]],output.patterns[0].counterevidence_queries);
  assert.doesNotThrow(()=>validateJournalGraph(second.graph,fixture('synthetic-sources.json')));
  const invalid=structuredClone(output);invalid.themes[0].assertion_ids=['foreign:assertion'];
  assert.throws(()=>addProvisionalPatterns({graph,patternResult:invalid,producerReceipt:receipt('invalid','fresh-invalid')}),{code:'THEME_SUPPORT_MISSING'});
  assert.throws(()=>addProvisionalPatterns({graph:first.graph,patternResult:output,producerReceipt:receipt('duplicate','fresh-duplicate'),localIdNamespace:'batch-one'}),{code:'THEME_LOCAL_ID_DUPLICATE'});
  const disputed=structuredClone(graph);disputed.nodes.find(n=>n.id==='a1').data.review_state='disputed';
  assert.throws(()=>addProvisionalPatterns({graph:disputed,patternResult:output,producerReceipt:receipt('unsafe','fresh-unsafe')}),{code:'THEME_SUPPORT_MISSING'});
});

test("matrix and pattern register require distinct support, counterevidence search and independent review", async () => {
  const graph = graphWithoutPatterns();
  const matrix = buildEpisodeThemeMatrix(graph);
  assert.ok(matrix.cells.some(({ episode_id, theme_id }) => episode_id === "ep1" && theme_id === "theme"));
  assert.ok(matrix.unclassified_assertion_ids.includes("a3"));
  assert.match(matrix.observation_note, /not life prevalence/i);

  assert.throws(() => addProvisionalPatterns({ graph, patternResult: patternOutput(["a2", "a3"]), producerReceipt: receipt("builder", "builder-context") }), /PATTERN_RECURRENCE_DUPLICATE_SUPPORT/);
  const provisional = addProvisionalPatterns({ graph, patternResult: patternOutput(), producerReceipt: receipt("builder", "builder-context") });
  const createdId = provisional.created_pattern_ids[0];
  const reader = {
    async search({ cursor }) {
      return cursor ? { records: [], next_cursor: null } : { records: [graph.nodes.find(({ id }) => id === "p4")], next_cursor: null };
    }
  };
  const counterSecret = Buffer.alloc(32, 63);
  const search = await executeCounterevidenceSearch({
    reader,
    patternId: createdId,
    queries: ["continued discomfort"],
    generation,
    receiptSecret: counterSecret
  });
  const reviewed = reviewPatternRegister({
    graph: provisional.graph,
    reviewResult: patternReview(createdId),
    reviewReceipt: receipt("review", "review-context"),
    builderReceipt: receipt("builder", "builder-context"),
    frozenSourceReceipt: receipt("freeze", "freeze-context"),
    counterevidenceReceipts: { [createdId]: search.receipt },
    counterReceiptSecret: counterSecret
  });
  const reviewedNode = reviewed.graph.nodes.find(({ id }) => id === createdId);
  assert.equal(reviewedNode.data.review_state, "reviewed");
  assert.equal(reviewedNode.data.disconfirmation.status, "complete");
  assert.equal(reviewed.patterns_reviewed, "pass");
  assert.doesNotThrow(() => validateJournalGraph(reviewed.graph, fixture("synthetic-sources.json")));

  const disputed = reviewPatternRegister({
    graph: provisional.graph,
    reviewResult: patternReview(createdId, { outcome: "distorted", critical: true, findingType: "unsupported_claim" }),
    reviewReceipt: receipt("review2", "review2-context"),
    builderReceipt: receipt("builder", "builder-context"),
    frozenSourceReceipt: receipt("freeze", "freeze-context"),
    counterevidenceReceipts: { [createdId]: search.receipt },
    counterReceiptSecret: counterSecret
  });
  const disputedNode = disputed.graph.nodes.find(({ id }) => id === createdId);
  assert.equal(disputedNode.data.review_state, "disputed");
  assert.equal(disputedNode.data.independent_review_ref, "receipt:review2");
  assert.deepEqual(disputedNode.data.disconfirmation,
    { status: "complete", search_receipt_ref: search.receipt.search_receipt_ref });
  assert.equal(disputed.patterns_reviewed, "partial");

  const sameContext = reviewPatternRegister({
    graph: provisional.graph,
    reviewResult: patternReview(createdId),
    reviewReceipt: receipt("review3", "same-context"),
    builderReceipt: receipt("builder3", "same-context"),
    frozenSourceReceipt: receipt("freeze3", "freeze-context"),
    counterevidenceReceipts: { [createdId]: search.receipt },
    counterReceiptSecret: counterSecret
  });
  assert.notEqual(sameContext.graph.nodes.find(({ id }) => id === createdId).data.review_state, "reviewed");
});

test("phase A candidate leakage is denied and reports do not turn targeted samples into population claims", () => {
  assert.throws(() => buildJournalRolePacket("reference_reader", {
    protocol_version: "1.0",
    output_schema_id: "reference-result",
    assigned_core_ids: [],
    source_locators: [],
    expected_generation: generation,
    controller_provenance_tag: "reference:synthetic",
    grant_purpose: "organize_search",
    source_windows: [],
    adjacent_context: {},
    visual_context: [],
    neutral_reading_instructions: [],
    candidate_patterns: []
  }), /JOURNAL_ROLE_PACKET_FIELD_NOT_ALLOWED/);
  assert.throws(() => buildJournalRolePacket("pattern_reviewer", {
    protocol_version: "1.0",
    output_schema_id: "review-result",
    assigned_core_ids: [],
    source_locators: [],
    expected_generation: generation,
    controller_provenance_tag: "pattern-review:synthetic",
    grant_purpose: "organize_search",
    phase: "A",
    candidate_patterns: [],
    frozen_observations: {},
    source_retrieval: [],
    target_generation: generation
  }), /PATTERN_SOURCE_FIRST_PHASE_MUST_USE_REFERENCE_READER/);
  const sample = createDeterministicAuditSample({ units: [{ unit_id: "unit:one", source_order: 0, hazard_types: ["visual"] }], seed: "report-seed" });
  const score = scoreReferenceReview({ referenceResult: referenceOutput(), reviewResult: fidelityOutput(), candidateIds: [] });
  const certification = { semantically_audited: "unavailable", reasons: ["SYNTHETIC_MISSING_RECEIPT"] };
  const report = createContentFreeAuditReport({ generation, sample, score, certification, patternReview: { patterns_reviewed: "partial" } });
  assert.equal(report.probability_sample.targeted_is_population_estimate, false);
  assert.equal(report.reference_review.global_recall_claim, false);
  assert.equal(report.semantic_audit, "unavailable");
});
