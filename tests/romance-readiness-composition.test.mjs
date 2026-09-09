import test from "node:test";
import assert from "node:assert/strict";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables } from "../src/guide-graph/planner.mjs";
import {
  relationalReadinessDecision,
  relationalReadinessGuidance,
  preparePathPriorForReadiness,
  applyRelationalReadinessToPath,
  validateRelationalEvidence
} from "../src/case-formulation/relational-readiness.mjs";
import { evaluatePathPerformance } from "../src/case-formulation/path-performance.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { planCaseSnapshot, applyCaseAudit } from "../src/case-formulation/run.mjs";

const issue = "Considering romance";
const observations = Array.from({ length: 20 }, (_, i) => ({ id: `O${i + 1}`, statement: `Synthetic observation ${i + 1}`, evidence: "fictional regression only" }));
const observationIds = new Set(observations.map(o => o.id));
const variables = deriveCaseVariables({
  ...blankCaseVariables(), present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes",
  suicidal_state: "absent", activation: "low", dissociation: "none", altered_state: "sober", current_intent: "conversation",
  actionable_problem: "absent", other_person_central: "no", influence_domain: "none", inward_attention_effect: "neutral",
  inner_adult_access: "available", witness_capacity: "present", coherent_child_state: "present", body_capacity: "adequate",
  unresolved_inner_material: "present"
});

const risk = (kind, timeframe = "current", observation_ids = ["O1"]) => ({ kind, timeframe, observation_ids });
const readiness = (changes = {}) => ({
  issue,
  scope: "romantic_sexual_pursuit",
  current_stability: "sufficient", stability_observation_ids: ["O1"],
  foreseeable_harm: "not_substantial", harm_observation_ids: ["O1"], harm_to: [],
  risk_signals: [], trajectory: "stable", trajectory_observation_ids: ["O1"],
  support_purpose: "nonromantic", support_observation_ids: ["O2"],
  supports: "A trusted friend and ordinary routines", supports_observation_ids: ["O2"],
  reasons: "Current functioning and boundaries are stable in this fictional control.",
  readiness_markers: ["Maintain self-care", "Keep support beyond a partner"],
  review_when: "Reassess if functioning, substance risk, dependency or boundaries materially change",
  ...changes
});
const unstable = (changes = {}) => readiness({
  current_stability: "insufficient",
  foreseeable_harm: "substantial",
  harm_to: ["self", "partner"],
  risk_signals: [risk("substance_dependence_relapse"), risk("dissociation")],
  trajectory: "worsening",
  reasons: "Current severe instability and relapse/dissociation risk make romantic escalation foreseeably harmful in this fictional case.",
  readiness_markers: ["Reality testing and self-care remain reliable", "Non-romantic regulation works in ordinary life"],
  ...changes
});
const task = (changes = {}) => ({
  version: 1, issue, node_id: "IC.DEEP_CHILD_DIALOGUE", kind: "emotion", phase: "practice", agreement: "accepted",
  observation_ids: ["O1", "O2", "O3", "O4", "O5"], marker: "Trying inward work", last_response: "No durable change yet",
  capacity: "adequate", question_focus: "none", action: null,
  emotion: { process: "unclear_feeling", response: "Trying to understand it", change_point: "" },
  ...changes
});
const strategy = () => ({
  process_id: "inward-self-regulation", target: "increase stable agency", formulation: "Inward processing may increase agency",
  family: "inner_dialogue", node_id: "IC.DEEP_CHILD_DIALOGUE", selection_reason: "The fictional person was already trying inward work",
  observation_ids: ["O1"], predictions: [{ id: "P1", sign: "agency", description: "The person can choose without needing a partner to regulate the state", horizon: "durable" }],
  adverse_signs: ["dependency", "destabilization"]
});
const pathUpdate = (signals = [], patch = {}) => ({ strategy: strategy(), response: "not_observed", signals, failure_hypotheses: [], probe: null, ...patch });
const signal = (kind, observation_id, patch = {}) => ({ observation_id, kind, prediction_id: "", timing: "immediate", severity: "ordinary", ...patch });

function baseEvaluate(signals = [], prior = null, patch = {}) {
  return evaluatePathPerformance({ prior, update: pathUpdate(signals, patch), variables, observationIds });
}
function evaluate(r, signals = [], prior = null, patch = {}) {
  return applyRelationalReadinessToPath(baseEvaluate(signals, prior, patch), relationalReadinessDecision(r));
}
function planForTrace(trace) {
  return {
    primaryJob: { id: "ROUTE.ACT_OUTWARD", title: "Synthetic outward action", tier: 2 },
    executionContract: { version: 1, requiredNodeIds: ["ROUTE.ACT_OUTWARD"] },
    pathPerformanceContract: { version: 1, prohibit_prior_exercise: true },
    pathPerformance: trace,
    questionContract: { mode: "none", question: "", source: null }
  };
}
function realization(answer, markers = []) {
  return { answer, next_question: "", realized_nodes: [
    { id: "ROUTE.ACT_OUTWARD", evidence_quote: answer },
    ...markers.map(id => ({ id, evidence_quote: answer }))
  ] };
}

function audit(overrides = {}) {
  return {
    corrected_turn_task: null, invalidate_turn_task: false,
    remove_observation_ids: [], remove_hypothesis_ids: [], variable_corrections: [], add_unknowns: [], safety_flags: [],
    verdict: "accept", summary: "Synthetic audit accepted.", ...overrides
  };
}
function snapshot(r = readiness()) {
  return {
    user_goal: "Stay stable", current_issue: issue, turn_task: task(), path_update: pathUpdate(), relational_readiness: r,
    direct_observations: observations, variables, hypotheses: [], unknowns: []
  };
}

test("stable lonely adult is not blocked merely for loneliness or history", () => {
  const r = readiness({ risk_signals: [risk("hospitalization", "historical")], reasons: "Past hospitalization is historical; current functioning, boundaries and support are stable." });
  const d = relationalReadinessDecision(r);
  assert.equal(d.status, "NOT_BLOCKED"); assert.equal(d.allowRomanceRecommendation, true); assert.equal(d.pauseRomance, false);
  assert.match(relationalReadinessGuidance(d).join(" "), /does not block dating/);
  const control = evaluate(r);
  assert.equal(control.latest.goal_substitution.romance_pause, false);
  assert.equal(control.latest.relational_readiness.status, "NOT_BLOCKED");
});

test("substantial current foreseeable harm pauses romance without requiring the narrow five-signal conjunction", () => {
  const control = evaluate(unstable());
  assert.equal(control.latest.goal_substitution.narrow_romance_pause, false);
  assert.equal(control.latest.goal_substitution.romance_pause, true);
  assert.equal(control.latest.relational_readiness.status, "PAUSE_ROMANCE");
  assert.equal(control.latest.readiness_conflict, "BROAD_FORESEEABLE_HARM_PAUSE_WITHOUT_NARROW_CONJUNCTION");
  assert.equal(control.latest.route, "action");
  assert.match(relationalReadinessGuidance(control.latest.relational_readiness).join(" "), /pausing active romance-seeking/);
  assert.ok(control.latest.goal_substitution.source_rule_ids.includes("RG01"));
  assert.ok(control.latest.goal_substitution.source_rule_ids.includes("RG08"));
  assert.equal(control.active.relational_constraint_only, true);
});

test("relationship-as-reality-anchor worsening dependency pauses and does not count relief as progress", () => {
  const r = readiness({ current_stability: "insufficient", foreseeable_harm: "unknown", harm_observation_ids: [],
    risk_signals: [risk("partner_as_regulator")], trajectory: "worsening",
    reasons: "The fictional person says a partner is the only thing keeping them sane and becomes less functional when unavailable." });
  const d = relationalReadinessDecision(r);
  assert.equal(d.status, "PAUSE_ROMANCE"); assert.equal(d.adverseTrajectory, true);
  assert.ok(d.sourceRuleIds.includes("RG05")); assert.ok(d.sourceRuleIds.includes("RG11"));
  const control = evaluate(r, [signal("relief", "O3"), signal("praise", "O4")]);
  assert.notEqual(control.latest.status, "MOVING"); assert.equal(control.latest.goal_substitution.romance_pause, true);
});

test("instrumental socializing does not become support progress and preserves the narrower target", () => {
  const r = readiness({ scope: "support_building", support_purpose: "partner_seeking", trajectory: "improving",
    reasons: "The fictional person attends groups mainly to obtain a partner; no separate friendship gain is yet established." });
  const d = relationalReadinessDecision(r);
  assert.equal(d.status, "NOT_BLOCKED"); assert.equal(d.pauseRomance, false);
  assert.equal(d.supportProgress, "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT");
  const control = evaluate(r, [signal("functional_change", "O3")]);
  assert.equal(control.latest.goal_substitution.instrumental_socializing, true);
  assert.equal(control.latest.route, "action"); assert.equal(control.latest.decision, "SWITCH");
  assert.match(control.latest.reason, /genuinely non-romantic support/);
});

test("narrow current risk conjunction overrides a broad not-blocked assessment until fresh evidence resolves it", () => {
  const narrow = ["significant_instability", "external_regulation_dependency", "loneliness", "relapse_or_dissociation_risk", "romance_as_regulator"].map((kind, i) => signal(kind, `O${i + 3}`));
  const control = evaluate(readiness(), narrow);
  assert.equal(control.latest.relational_readiness.status, "NOT_BLOCKED");
  assert.equal(control.latest.goal_substitution.narrow_romance_pause, true);
  assert.equal(control.latest.goal_substitution.romance_pause, true);
  assert.equal(control.latest.readiness_conflict, "NARROW_CURRENT_RISK_OVERRIDES_GENERAL_NOT_BLOCKED");
});

test("unknown readiness creates a bounded assessment state, not clearance or prohibition", () => {
  const r = readiness({ current_stability: "unknown", stability_observation_ids: [], foreseeable_harm: "unknown", harm_observation_ids: [],
    trajectory: "unknown", trajectory_observation_ids: [], support_purpose: "unknown", support_observation_ids: [],
    reasons: "Current stability and foreseeable harm have not yet been established." });
  const control = evaluate(r);
  assert.equal(control.latest.relational_readiness.status, "ASSESS_BEFORE_ROMANCE");
  assert.equal(control.latest.decision, "PROBE"); assert.equal(control.latest.route, "reconsider");
});

test("fresh current improvement can reopen readiness without erasing path evidence", () => {
  const blocked = evaluate(unstable());
  assert.equal(blocked.latest.relational_readiness.status, "PAUSE_ROMANCE");
  const improved = readiness({ trajectory: "improving", risk_signals: [risk("hospitalization", "historical"), risk("substance_dependence_relapse", "historical")],
    reasons: "Current self-care, boundaries and support are reliable; prior crises remain historical context." });
  const decision = relationalReadinessDecision(improved);
  const prepared = preparePathPriorForReadiness(blocked, decision);
  assert.equal(prepared.active.switch_pending, false);
  assert.equal(prepared.readiness_reopened.retained_path_evidence, true);
  assert.equal(prepared.active.id, blocked.active.id);
  const reopenedBase = evaluatePathPerformance({ prior: prepared, update: { strategy: null, response: "not_observed", signals: [], failure_hypotheses: [], probe: null }, variables, observationIds });
  const reopened = applyRelationalReadinessToPath(reopenedBase, decision);
  assert.equal(reopened.latest.relational_readiness.status, "NOT_BLOCKED");
  assert.equal(reopened.latest.goal_substitution.romance_pause, false);
  assert.equal(reopened.active.id, blocked.active.id);
});

test("readiness reopening cannot erase actual path failure or the narrow persistent risk state", () => {
  const failed = evaluate(unstable());
  failed.active.misses = 1;
  const improved = readiness({ trajectory: "improving", reasons: "Current functioning improved." });
  assert.equal(preparePathPriorForReadiness(failed, relationalReadinessDecision(improved)).active.switch_pending, true);
  const narrow = evaluate(readiness(), ["significant_instability", "external_regulation_dependency", "loneliness", "relapse_or_dissociation_risk", "romance_as_regulator"].map((kind, i) => signal(kind, `O${i + 3}`)));
  assert.equal(preparePathPriorForReadiness(narrow, relationalReadinessDecision(improved)).active.switch_pending, true);
});

test("readiness objects fail closed on malformed structure, stale evidence, affected-party omissions and missing reopening markers", () => {
  assert.equal(validateRelationalEvidence(unstable(), { issue, observationIds }).foreseeable_harm, "substantial");
  for (const bad of [
    unstable({ harm_to: [] }),
    unstable({ readiness_markers: [] }),
    readiness({ current_stability: "sufficient", stability_observation_ids: [] }),
    readiness({ risk_signals: [risk("dissociation", "current", ["missing"]) ] }),
    readiness({ current_stability: "perfectly_fine" }),
    readiness({ unexpected: true }),
    readiness({ issue: "Different issue" })
  ]) assert.throws(() => validateRelationalEvidence(bad, { issue, observationIds }));
});

test("relational readiness forces reviewed audit even when fast mode was requested", () => {
  const s = snapshot(readiness());
  const routing = classifyTherapyTier(s, "fast");
  assert.equal(routing.tier, "reviewed"); assert.equal(routing.forced, true);
});

test("case audit can invalidate or replace readiness without touching the task schema", () => {
  const original = snapshot(unstable());
  const invalidated = applyCaseAudit(original, audit({ invalidate_relational_readiness: true }));
  assert.equal(invalidated.relational_readiness, null);
  assert.equal(invalidated.turn_task.issue, issue);
  const replacement = readiness({ reasons: "Fresh current functioning is stable in this fictional reassessment." });
  const revised = applyCaseAudit(original, audit({ corrected_relational_readiness: replacement, verdict: "revise" }));
  assert.equal(revised.relational_readiness.current_stability, "sufficient");
  assert.equal(revised.relational_readiness.foreseeable_harm, "not_substantial");
});

test("removing readiness evidence invalidates the readiness conclusion rather than leaving a stale ban", () => {
  const original = snapshot(unstable({ stability_observation_ids: ["O3"], harm_observation_ids: ["O3"], trajectory_observation_ids: ["O3"] }));
  const result = applyCaseAudit(original, audit({ remove_observation_ids: ["O3"], verdict: "revise" }));
  assert.equal(result.relational_readiness, null);
});

test("planner receives audited readiness through the existing path controller and routes a pause away from prior inward work", async () => {
  const s = snapshot(unstable());
  const { plan } = await planCaseSnapshot(s);
  assert.equal(plan.pathPerformance.relational_readiness.status, "PAUSE_ROMANCE");
  assert.equal(plan.pathPerformance.goal_substitution.romance_pause, true);
  assert.notEqual(plan.primaryJob.id, "IC.DEEP_CHILD_DIALOGUE");
  assert.ok(["ROUTE.ACT_OUTWARD", "ROUTE.THREE_WAY_GATE"].includes(plan.primaryJob.id));
  assert.match(plan.executionContract.taskGuidance.join(" "), /foreseeable serious harm/);
});

test("unknown readiness overrides the canonical next question with the bounded functional assessment", async () => {
  const r = readiness({ current_stability: "unknown", stability_observation_ids: [], foreseeable_harm: "unknown", harm_observation_ids: [],
    trajectory: "unknown", trajectory_observation_ids: [], support_purpose: "unknown", support_observation_ids: [],
    reasons: "Current stability and foreseeable harm have not yet been established." });
  const { plan } = await planCaseSnapshot(snapshot(r));
  assert.equal(plan.pathPerformance.relational_readiness.status, "ASSESS_BEFORE_ROMANCE");
  assert.match(plan.nextQuestion, /managing daily life and distress/);
  assert.equal(plan.nextQuestionSource.type, "relational-readiness");
});

test("response contract requires a verbatim relational policy marker on a pause", () => {
  const trace = evaluate(unstable()).latest;
  const plan = planForTrace(trace);
  const answer = "For now, pause active romance-seeking and build support that does not depend on finding a partner.";
  const missing = enforceResponseContract(realization(answer), { plan });
  assert.equal(missing.responseContract.pathPerformanceAdherencePassed, false);
  assert.deepEqual(missing.responseContract.missingRelationalPolicyMarkers, ["POLICY.RELATIONAL_PAUSE"]);
  const good = enforceResponseContract(realization(answer, ["POLICY.RELATIONAL_PAUSE"]), { plan });
  assert.equal(good.responseContract.pathPerformanceAdherencePassed, true);
});

test("response contract rejects the opposite policy marker for a stable not-blocked control", () => {
  const trace = evaluate(readiness()).latest;
  const plan = planForTrace(trace);
  const answer = "Nothing in the current evidence creates a full-healing prerequisite or a dating prohibition.";
  const wrong = enforceResponseContract(realization(answer, ["POLICY.RELATIONAL_PAUSE"]), { plan });
  assert.equal(wrong.responseContract.pathPerformanceAdherencePassed, false);
  assert.ok(wrong.responseContract.forbiddenRelationalPolicyMarkers.includes("POLICY.RELATIONAL_PAUSE"));
  const good = enforceResponseContract(realization(answer, ["POLICY.RELATIONAL_NOT_BLOCKED"]), { plan });
  assert.equal(good.responseContract.pathPerformanceAdherencePassed, true);
});
