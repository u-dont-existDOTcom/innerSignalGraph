import test from "node:test";
import assert from "node:assert/strict";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables } from "../src/guide-graph/planner.mjs";
import { planCaseSnapshot, applyCaseAudit } from "../src/case-formulation/run.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";

const issue = "Synthetic relationship decision";
const observations = [
  { id: "O1", statement: "The fictional adult describes a current relationship question.", evidence: "synthetic regression only" },
  { id: "O2", statement: "The fictional adult is curious about the fuller guide.", evidence: "synthetic regression only" },
  { id: "O3", statement: "A peak sexual or psychedelic closeness state did not change ordinary agreements.", evidence: "synthetic regression only" },
  { id: "O4", statement: "The fictional partner punishes refusal and the person fears leaving.", evidence: "synthetic regression only" },
  { id: "O5", statement: "The fictional person reported temporary relief and praised the experience.", evidence: "synthetic regression only" }
];

function variables(changes = {}) {
  return deriveCaseVariables({
    ...blankCaseVariables(),
    present_safety: "safe",
    orientation: "oriented",
    ability_to_stop: "yes",
    ability_to_return: "yes",
    suicidal_state: "absent",
    activation: "low",
    dissociation: "none",
    altered_state: "sober",
    current_intent: "conversation",
    actionable_problem: "absent",
    other_person_central: "yes",
    influence_domain: "none",
    inward_attention_effect: "neutral",
    inner_adult_access: "available",
    witness_capacity: "present",
    coherent_child_state: "present",
    body_capacity: "adequate",
    unresolved_inner_material: "present",
    ...changes
  });
}

function context(topic, changes = {}) {
  return {
    issue,
    topic,
    stage: "existing",
    audience: "adult",
    audience_observation_ids: ["O1"],
    interest: "unspecified",
    interest_observation_ids: [],
    deeper_exploration_outside_current_task: false,
    observation_ids: ["O1"],
    ...changes
  };
}

function strategy() {
  return {
    process_id: "synthetic-romance-intensity",
    target: "durable ordinary-life change",
    formulation: "A peak closeness state may transfer into reliable conduct",
    family: "inner_dialogue",
    node_id: "IC.DEEP_CHILD_DIALOGUE",
    selection_reason: "The fictional person is testing whether the state transferred",
    observation_ids: ["O3"],
    predictions: [{ id: "P1", sign: "durable_movement", description: "Agreements change in sober ordinary life", horizon: "durable" }],
    adverse_signs: ["dependency", "destabilization"]
  };
}

function snapshot(topic, changes = {}) {
  return {
    user_goal: "Make a responsible current decision",
    current_issue: issue,
    turn_task: null,
    path_update: null,
    relational_readiness: null,
    romance_guide_context: topic ? context(topic) : null,
    direct_observations: observations,
    variables: variables(),
    hypotheses: [],
    unknowns: [],
    ...changes
  };
}

function realized(plan, answer, extra = []) {
  return {
    answer,
    next_question: "",
    realized_nodes: [
      { id: plan.primaryJob.id, evidence_quote: answer },
      ...extra.map(({ id, quote = answer }) => ({ id, evidence_quote: quote }))
    ]
  };
}

test("ordinary candidate planning composes transferable source rules for the live romance topic", async () => {
  const expected = {
    compatibility: ["RG02", "RG03", "RG04"],
    dependency: ["RG05", "RG06", "RG11"],
    agreements: ["RG07"],
    jealousy: ["RG09"],
    children: ["RG10"],
    ending: ["RG12"]
  };
  for (const [topic, ruleIds] of Object.entries(expected)) {
    const { plan } = await planCaseSnapshot(snapshot(topic));
    assert.deepEqual(plan.romanceGuide.source.rule_ids, ruleIds);
    assert.deepEqual(plan.pathPerformanceContract.romanceGuide.sourceRuleIds, ruleIds);
    assert.ok(plan.requiredNuance.some(item => item.includes(`[${ruleIds[0]}; owner-guide adaptation]`)));
  }
});

test("trace connects source and observations to judgment, route, progress checks, and realization policy", async () => {
  const { plan } = await planCaseSnapshot(snapshot("jealousy", {
    romance_guide_context: context("jealousy", { observation_ids: ["O1", "O2"] })
  }));
  assert.equal(plan.romanceGuide.source.source_id, "owner-romance-2026-08-27");
  assert.deepEqual(plan.romanceGuide.source.rule_ids, ["RG09"]);
  assert.deepEqual(plan.romanceGuide.case_variables.observation_ids, ["O1", "O2"]);
  assert.equal(plan.romanceGuide.judgment.route, plan.pathPerformance.route);
  assert.equal(plan.romanceGuide.realization.can_realize, true);
  assert.equal(plan.romanceGuide.progress_checks[0].ruleId, "RG09");
  assert.equal(plan.primaryJob.id, "ROUTE.RELATIONAL_REALITY_CHECK");
});

test("peak romantic, sexual, or psychedelic closeness is not durable progress without ordinary-life transfer", async () => {
  const path_update = {
    strategy: strategy(),
    response: "not_observed",
    signals: [
      { observation_id: "O5", kind: "relief", prediction_id: "", timing: "immediate", severity: "ordinary" },
      { observation_id: "O5", kind: "praise", prediction_id: "", timing: "immediate", severity: "ordinary" }
    ],
    failure_hypotheses: [],
    probe: null
  };
  const { plan } = await planCaseSnapshot(snapshot("progress", {
    path_update,
    romance_guide_context: context("progress", { observation_ids: ["O3", "O5"] })
  }));
  assert.notEqual(plan.pathPerformance.status, "MOVING");
  assert.deepEqual(plan.romanceGuide.source.rule_ids, ["RG11"]);
  assert.match(plan.pathPerformanceContract.guidance.join(" "), /ordinary-life check/);
  assert.match(plan.requiredNuance.join(" "), /everyday compatibility or durable change/);
});

test("coercion routes outward before inward or mutual processing", async () => {
  const { plan } = await planCaseSnapshot(snapshot("coercion", {
    romance_guide_context: context("coercion", { observation_ids: ["O4"] })
  }));
  assert.equal(plan.primaryJob.id, "ROUTE.ACT_OUTWARD");
  assert.equal(plan.pathPerformance.decision, "SWITCH");
  assert.equal(plan.pathPerformance.route, "action");
  assert.deepEqual(plan.pathPerformance.romance_guide_constraint.source_rule_ids, ["RG08"]);
  assert.match(plan.pathPerformance.reason, /outside support before inward or mutual processing/);
});

test("guide reference is permitted only by the current audited decision and requires a grounded marker", async () => {
  const referenceSentence = "If you're curious, my fuller romance guide is at romance.u-dont-exist.com.";
  const { plan } = await planCaseSnapshot(snapshot("polarity", {
    romance_guide_context: context("polarity", {
      interest: "curious",
      interest_observation_ids: ["O2"],
      observation_ids: ["O1", "O2"]
    })
  }));
  assert.equal(plan.romanceGuide.realization.reference_decision, "OFFER_OPTIONAL_REFERENCE");
  assert.equal(plan.romanceGuide.realization.reference.url, "https://romance.u-dont-exist.com");
  const missingMarker = enforceResponseContract(realized(plan, referenceSentence), { plan });
  assert.equal(missingMarker.responseContract.pathPerformanceAdherencePassed, false);
  assert.equal(missingMarker.responseContract.missingRomanceGuideReferenceMarker, true);
  const grounded = enforceResponseContract(realized(plan, referenceSentence, [
    { id: "POLICY.ROMANCE_GUIDE_REFERENCE", quote: referenceSentence }
  ]), { plan });
  assert.equal(grounded.responseContract.pathPerformanceAdherencePassed, true);
  const decorated = "If you're curious, my fuller romance guide is at romance.u-dont-exist.com.example.org/private.";
  const rejectedDecoration = enforceResponseContract(realized(plan, decorated, [
    { id: "POLICY.ROMANCE_GUIDE_REFERENCE", quote: decorated }
  ]), { plan });
  assert.equal(rejectedDecoration.responseContract.romanceGuideReferenceCanonical, false);
  assert.equal(rejectedDecoration.responseContract.forbiddenRomanceGuideReference, true);
  assert.equal(rejectedDecoration.responseContract.pathPerformanceAdherencePassed, false);
});

test("guide reference is suppressed for irrelevance, safety, repetition, and stabilization", async () => {
  const domainSentence = "See romance.u-dont-exist.com.";
  const irrelevant = await planCaseSnapshot(snapshot(null));
  assert.equal(irrelevant.plan.romanceGuide.realization.reference_decision, "NOT_RELEVANT");
  assert.equal(enforceResponseContract(realized(irrelevant.plan, domainSentence), { plan: irrelevant.plan }).responseContract.forbiddenRomanceGuideReference, true);

  const safety = await planCaseSnapshot(snapshot("compatibility", {
    variables: variables({ present_safety: "unsafe" }),
    romance_guide_context: context("compatibility", { interest: "requested", interest_observation_ids: ["O2"], observation_ids: ["O1", "O2"] })
  }));
  assert.equal(safety.plan.romanceGuide.realization.reference_decision, "SAFETY_FIRST");
  assert.equal(safety.plan.romanceGuide.realization.reference, null);

  const repeated = await planCaseSnapshot(snapshot("polarity"), { romanceGuideAlreadyOffered: true });
  assert.equal(repeated.plan.romanceGuide.realization.reference_decision, "ALREADY_OFFERED");

  const stabilization = await planCaseSnapshot(snapshot("dependency", {
    variables: variables({ dissociation: "high" }),
    romance_guide_context: context("dependency", { interest: "requested", interest_observation_ids: ["O2"], observation_ids: ["O1", "O2"] })
  }));
  assert.ok(["SAFETY_FIRST", "STABILIZATION_FIRST"].includes(stabilization.plan.romanceGuide.realization.reference_decision));
});

test("medical and unsafe-practice contexts preserve the appropriate live route without a guide bypass", async () => {
  for (const topic of ["medical-practice", "unsafe-practice"]) {
    const { plan } = await planCaseSnapshot(snapshot(topic, {
      variables: variables({ actionable_problem: "present" }),
      romance_guide_context: context(topic, { interest: "requested", interest_observation_ids: ["O2"], observation_ids: ["O1", "O2"] })
    }));
    assert.equal(plan.primaryJob.id, "ROUTE.ACT_OUTWARD");
    assert.equal(plan.romanceGuide.realization.reference_decision, "NO_REFERENCE_BYPASS");
    assert.equal(plan.romanceGuide.realization.reference, null);
    assert.equal(plan.romanceGuide.realization.can_realize, true);
  }
});

test("romance context forces reviewed audit and is invalidated when its observation is withdrawn", () => {
  const original = snapshot("compatibility");
  const routing = classifyTherapyTier(original, "fast");
  assert.equal(routing.tier, "reviewed");
  assert.equal(routing.forced, true);
  const audited = applyCaseAudit(original, {
    corrected_turn_task: null,
    invalidate_turn_task: false,
    corrected_relational_readiness: null,
    invalidate_relational_readiness: false,
    corrected_romance_guide_context: null,
    invalidate_romance_guide_context: false,
    remove_observation_ids: ["O1"],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "revise",
    summary: "Synthetic source-context evidence was withdrawn."
  });
  assert.equal(audited.romance_guide_context, null);
  assert.equal(audited.audit.romance_guide_context_reviewed, true);
});
