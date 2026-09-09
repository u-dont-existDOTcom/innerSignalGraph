import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import {
  decoratePlanWithThreatPathway,
  threatPathwayDecision,
  validateThreatPathwayAssessment
} from "../src/case-formulation/threat-pathway.mjs";
import { applyCaseAudit, planCaseSnapshot } from "../src/case-formulation/run.mjs";
import { caseAuditGenerationSchema, caseSnapshotGenerationSchema } from "../src/case-formulation/schemas.mjs";
import { createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState } from "../src/case-state/longitudinal-state.mjs";
import { buildDurableCaseContext, decisionRelevantProjection } from "../src/case-state/context-window.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { renderInnerSignalConstitution } from "../src/therapy/constitution.mjs";
import { threatPathwayAuditRules, threatPathwayExtractionRules } from "../src/prompts/threat-pathway.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { longitudinalClinicalRules } from "../src/prompts/common.mjs";

const signal = (kind, status = "PRESENT", observation = "O1") => ({
  kind,
  status,
  observation_ids: status === "UNKNOWN" ? [] : [observation]
});

function assessment(signals, overrides = {}) {
  return {
    version: 1,
    issue: "Violent political thought",
    assessment_basis: "CURRENT_TURN",
    signals,
    claim_to_engage: "Removing one symbolic leader might seem like a way to change a harmful system.",
    problem_violence_is_supposed_to_solve: "Stop a diffuse institutional harm.",
    scale_context: {
      domain: "political",
      causal_frame: "single_symbolic_target",
      identity_capture: "not_assessed",
      observation_ids: ["O1"]
    },
    ...overrides
  };
}

function snapshot(threatPathway, observations = [{ id: "O1", statement: "A synthetic direct report.", evidence: "synthetic evidence" }]) {
  return {
    user_goal: "Understand the thought and choose effective action.",
    current_issue: "Violent political thought",
    turn_task: null,
    path_update: null,
    relational_readiness: null,
    romance_guide_context: null,
    threat_pathway: threatPathway,
    direct_observations: observations,
    variables: blankCaseVariables(),
    hypotheses: [],
    unknowns: []
  };
}

const neutralAudit = {
  corrected_turn_task: null,
  invalidate_turn_task: false,
  corrected_path_representation: null,
  invalidate_path_representation: false,
  corrected_relational_readiness: null,
  invalidate_relational_readiness: false,
  corrected_romance_guide_context: null,
  invalidate_romance_guide_context: false,
  corrected_threat_pathway: null,
  invalidate_threat_pathway: false,
  remove_observation_ids: [],
  remove_hypothesis_ids: [],
  variable_corrections: [],
  add_unknowns: [],
  safety_flags: [],
  verdict: "accept",
  summary: "Synthetic audit."
};

test("violent ideation without operational progression stays in direct engagement", async () => {
  const low = assessment([
    signal("VIOLENT_IDEATION"), signal("MORAL_CONSIDERATION"), signal("NAMED_TARGET"), signal("SYMBOLIC_TARGET"),
    signal("CONCRETE_INTENT", "DENIED"), signal("RESEARCH_PLANNING", "DENIED"),
    signal("MEANS_ACCESS", "DENIED"), signal("SELECTED_TIMEFRAME", "DENIED"), signal("MAINTAINS_CONTROL")
  ]);
  validateThreatPathwayAssessment(low, { issue: low.issue, observationIds: new Set(["O1"]) });
  const decision = threatPathwayDecision(low);
  assert.equal(decision.level, "GRIEVANCE_IDEATION_MORAL_CONSIDERATION");
  assert.equal(decision.route, "ENGAGE_AND_MONITOR");
  assert.equal(decision.external_action_priority, false);
  assert.ok(!decision.present_signal_kinds.includes("CONCRETE_INTENT"));

  const { plan } = await planCaseSnapshot(snapshot(low));
  assert.equal(plan.threatPathwayContract.marker, "POLICY.THREAT_PATHWAY.ENGAGE");
  assert.notEqual(plan.variables.present_safety, "unsafe");
  assert.match(plan.requiredNuance.join(" "), /Do not call this a specific threat/);
  assert.equal(plan.nextQuestion, "What is helping you not act on this right now?");
});

test("mobilization supersedes ordinary therapeutic execution without claiming imminence", () => {
  const mobilizing = assessment([
    signal("VIOLENT_IDEATION"), signal("TARGET_FIXATION"), signal("RESEARCH_PLANNING"),
    signal("MEANS_ACCESS"), signal("CONCRETE_INTENT", "UNKNOWN")
  ]);
  const decision = threatPathwayDecision(mobilizing);
  assert.equal(decision.level, "ESCALATING_MOBILIZING_RISK");
  assert.equal(decision.external_action_priority, false);
  const plan = decoratePlanWithThreatPathway({
    primaryJob: { id: "IC.DEEP_CHILD_DIALOGUE", title: "Ordinary inward work", tier: 4 },
    selectedNodes: [], requiredNuance: [], forbiddenOverclaims: [],
    executionContract: { version: 1, requiredNodeIds: ["IC.DEEP_CHILD_DIALOGUE"], contextNodeIds: [], taskGuidance: [], task: null },
    questionContract: { mode: "none", question: "", source: null }, nextQuestion: ""
  }, mobilizing, decision);
  assert.equal(plan.primaryJob.id, "POLICY.THREAT_PATHWAY.ASSESS");
  assert.deepEqual(plan.executionContract.requiredNodeIds, ["POLICY.THREAT_PATHWAY.ASSESS"]);
  assert.ok(plan.executionContract.contextNodeIds.includes("IC.DEEP_CHILD_DIALOGUE"));
  assert.match(plan.executionContract.taskGuidance.join(" "), /Operational progression now outranks abstract/);
});

test("intent, target, capability and selected timeframe activate existing safety precedence", async () => {
  const imminent = assessment([
    signal("VIOLENT_IDEATION"), signal("NAMED_TARGET"), signal("TARGET_FIXATION"),
    signal("CONCRETE_INTENT"), signal("MEANS_ACQUISITION_STAGING"), signal("ACTIVE_PREPARATION"),
    signal("SELECTED_TIMEFRAME"), signal("NARROWING_ALTERNATIVES")
  ]);
  const decision = threatPathwayDecision(imminent);
  assert.equal(decision.level, "IMMINENT_OPERATIONAL_DANGER");
  assert.equal(decision.external_action_priority, true);
  const { plan } = await planCaseSnapshot(snapshot(imminent));
  assert.equal(plan.variables.present_safety, "unsafe");
  assert.equal(plan.primaryJob.id, "IC.SAFETY_ORIENTATION");
  assert.ok(plan.executionContract.requiredNodeIds.includes("POLICY.THREAT_PATHWAY.IMMINENT"));
  assert.match(plan.threatPathwayContract.guidance.join(" "), /least disruptive effective/);
});

test("unknown is distinct from denied and unsupported threat evidence cannot survive audit", () => {
  const low = assessment([signal("VIOLENT_IDEATION"), signal("CONCRETE_INTENT", "UNKNOWN")]);
  const decision = threatPathwayDecision(low);
  assert.ok(decision.unknown_signal_kinds.includes("CONCRETE_INTENT"));
  assert.ok(!decision.denied_signal_kinds.includes("CONCRETE_INTENT"));
  assert.equal(decision.next_question.kind, "CONCRETE_INTENT");
  assert.throws(() => validateThreatPathwayAssessment(
    assessment([signal("CONCRETE_INTENT", "PRESENT", "MISSING")]),
    { issue: low.issue, observationIds: new Set(["O1"]) }
  ), /unknown observation/);

  const audited = applyCaseAudit(snapshot(low), { ...neutralAudit, remove_observation_ids: ["O1"], verdict: "revise" });
  assert.equal(audited.threat_pathway, null);
  assert.equal(audited.audit.threat_pathway_reviewed, true);
});

test("durable threat state survives omission and can be lowered by fresh reassessment", () => {
  const imminent = assessment([
    signal("NAMED_TARGET"), signal("CONCRETE_INTENT"), signal("MEANS_ACCESS"), signal("SELECTED_TIMEFRAME")
  ]);
  const base = createEmptyCaseState({ caseId: "synthetic-risk-state" });
  const first = mergeRuntimeSnapshotIntoCaseState(base, snapshot(imminent), {
    turnId: "T1", recordedAt: "2026-09-09T10:00:00.000Z", interventionContract: { threatPathway: threatPathwayDecision(imminent) }
  });
  assert.equal(first.threat_pathway.current.level, "IMMINENT_OPERATIONAL_DANGER");
  const preserved = mergeRuntimeSnapshotIntoCaseState(first, { ...snapshot(null), threat_pathway: null }, {
    turnId: "T2", recordedAt: "2026-09-09T10:05:00.000Z"
  });
  assert.deepEqual(preserved.threat_pathway, first.threat_pathway);

  const resolved = assessment([
    signal("VIOLENT_IDEATION", "DENIED", "O2"), signal("CONCRETE_INTENT", "DENIED", "O2"),
    signal("RESEARCH_PLANNING", "DENIED", "O2"), signal("MEANS_ACCESS", "DENIED", "O2"),
    signal("SELECTED_TIMEFRAME", "DENIED", "O2"), signal("MAINTAINS_CONTROL", "PRESENT", "O2")
  ], {
    assessment_basis: "CURRENT_REASSESSMENT",
    claim_to_engage: "",
    problem_violence_is_supposed_to_solve: "",
    scale_context: { domain: "none", causal_frame: "not_applicable", identity_capture: "not_assessed", observation_ids: [] }
  });
  const lowered = mergeRuntimeSnapshotIntoCaseState(preserved, snapshot(resolved, [{ id: "O2", statement: "The earlier operational report is explicitly withdrawn and control is maintained.", evidence: "synthetic reassessment" }]), {
    turnId: "T3", recordedAt: "2026-09-09T10:10:00.000Z"
  });
  assert.equal(lowered.threat_pathway.current.level, "NO_CURRENT_VIOLENCE_EVIDENCE");
  assert.equal(lowered.threat_pathway.history.at(-1).level, "IMMINENT_OPERATIONAL_DANGER");
});

test("compacted context retains current risk projection and retrieves its evidence turn", () => {
  const low = assessment([signal("VIOLENT_IDEATION"), signal("CONCRETE_INTENT", "DENIED"), signal("MAINTAINS_CONTROL")]);
  const state = mergeRuntimeSnapshotIntoCaseState(createEmptyCaseState({ caseId: "risk-compaction" }), snapshot(low), {
    turnId: "T1", recordedAt: "2026-09-09T10:00:00.000Z"
  });
  const compacted = buildDurableCaseContext({ caseState: state, transcriptEntries: [] });
  assert.equal(decisionRelevantProjection(compacted).threat_pathway.level, "GRIEVANCE_IDEATION_MORAL_CONSIDERATION");
  assert.ok(compacted.targeted_retrieval_requests.some(item => item.turn_id === "T1" && item.item_id === "threat_pathway.current"));
});

test("response trace requires the level-specific grounded marker", () => {
  const low = assessment([signal("VIOLENT_IDEATION"), signal("CONCRETE_INTENT", "DENIED")]);
  const plan = decoratePlanWithThreatPathway({
    primaryJob: null, requiredNuance: [], forbiddenOverclaims: [],
    executionContract: { version: 1, requiredNodeIds: [], contextNodeIds: [], taskGuidance: [], task: null },
    questionContract: { mode: "none", question: "", source: null }, nextQuestion: ""
  }, low);
  const answer = "The thought deserves examination without pretending one person is the whole system; we can test what it is meant to change and find nonviolent leverage.";
  const missing = enforceResponseContract({ answer, next_question: "", realized_nodes: [] }, { plan });
  assert.equal(missing.responseContract.missingThreatPathwayMarker, true);
  const grounded = enforceResponseContract({ answer, next_question: "", realized_nodes: [{ id: "POLICY.THREAT_PATHWAY.ENGAGE", evidence_quote: answer }] }, { plan });
  assert.equal(grounded.responseContract.missingThreatPathwayMarker, false);
  assert.equal(grounded.responseContract.pathPerformanceAdherencePassed, true);
});

test("general bypass routing preserves systemic reality and rejects category-based pathology", async () => {
  const captured = snapshot(null);
  captured.variables.bypass_risk = "present";
  const { plan } = await planCaseSnapshot(captured);
  assert.match(plan.requiredNuance.join(" "), /External explanations must not erase internal agency/);
  assert.match(plan.requiredNuance.join(" "), /politics, religion, sports, ideology/);
  assert.match(plan.forbiddenOverclaims.join(" "), /Do not reduce genuine structural harm to personal responsibility/);
  assert.match(plan.forbiddenOverclaims.join(" "), /Do not pathologize politics/);

  const healthy = snapshot(null);
  healthy.variables.bypass_risk = "absent";
  const healthyPlan = (await planCaseSnapshot(healthy)).plan;
  assert.doesNotMatch(healthyPlan.requiredNuance.join(" "), /identity capture by function/);
});

test("schemas, prompts and constitution expose both overreaction and underreaction constraints", () => {
  const ajv = new Ajv({ strict: true });
  assert.doesNotThrow(() => ajv.compile(caseSnapshotGenerationSchema));
  assert.doesNotThrow(() => ajv.compile(caseAuditGenerationSchema));
  assert.ok(caseSnapshotGenerationSchema.required.includes("threat_pathway"));
  assert.ok(caseAuditGenerationSchema.required.includes("corrected_threat_pathway"));
  assert.match(threatPathwayExtractionRules, /named public figure alone is not target fixation/i);
  assert.match(threatPathwayAuditRules, /SAFETY_CAPTURE \/ CRISIS_SCRIPT_OVERREACH/);
  assert.match(threatPathwayAuditRules, /OPERATIONAL_RISK_UNDERREACTION/);
  const constitution = renderInnerSignalConstitution();
  assert.match(constitution, /External explanations must not erase internal agency; internal agency must not erase external reality/);
  assert.match(constitution, /GRIEVANCE \/ IDEATION \/ MORAL CONSIDERATION/);
  assert.match(constitution, /IMMINENT \/ OPERATIONAL DANGER/);
  assert.match(longitudinalClinicalRules, /identity capture by function rather than category/i);
  const extraction = caseExtractionPrompt({
    guideManifest: { version: "synthetic" }, guideExcerpts: "", pathPerformanceEnabled: false,
    priorCaseSnapshot: null, priorInterventionContract: null, recentTranscript: "", userMessage: "synthetic", userFacts: []
  });
  assert.match(extraction.system, /bypass_risk requires a transcript-supported functional mismatch/i);
  const prompt = realizationPrompt({ userMessage: "synthetic", interventionContract: decoratePlanWithThreatPathway({ variables: {}, requiredNuance: [], forbiddenOverclaims: [] }, assessment([signal("VIOLENT_IDEATION")])) }, {}, "test");
  assert.match(prompt.system, /do not call it a specific threat/i);
  assert.match(prompt.system, /Do not invoke hidden guardrails|claim hidden guardrails/i);
});
