import test from "node:test";
import assert from "node:assert/strict";
import { OPERATION_CLASSES, ROUTE_DISPOSITIONS } from "../src/therapy-protocol/contract.mjs";
import { planTherapyFromGraphs, protocolRequiresReviewedTier } from "../src/therapy-protocol/planner.mjs";

const graphs = [{
  graphId: "test",
  bundleVersion: "test-bundle",
  nodes: [
    {
      id: "IC.DEEP_CHILD_DIALOGUE",
      title: "Deep child dialogue",
      tier: 1,
      priority: 100,
      activation: { any: [{ field: "coherent_child_state", op: "eq", value: "present" }] },
      effects: {},
      recommendations: ["go deep"],
      sourceRefs: [],
      avoid: []
    },
    {
      id: "IC.LIGHT_CONTACT",
      title: "Light present child contact",
      operationClass: OPERATION_CLASSES.LIGHT_REPARENTING,
      tier: 1,
      priority: 90,
      activation: { any: [{ field: "coherent_child_state", op: "eq", value: "present" }] },
      effects: {},
      recommendations: ["stay present"],
      sourceRefs: [],
      avoid: []
    }
  ],
  edges: []
}];

const variables = {
  present_safety: "safe",
  orientation: "oriented",
  ability_to_stop: "yes",
  ability_to_return: "yes",
  activation: "low",
  dissociation: "none",
  altered_state: "sober",
  coherent_child_state: "present",
  current_intent: "gentle_practice"
};

function profile(overrides = {}) {
  return {
    request_actor: "self",
    beneficiary_present: "yes",
    primary_problem_class: "internal_developmental",
    current_external_danger: "absent",
    basic_needs_failure: "absent",
    condition_instability: "absent",
    dependent_danger: "absent",
    current_sobriety: "sober",
    requested_operation: OPERATION_CLASSES.LIGHT_REPARENTING,
    operation_consent: "yes",
    consent_scope: "none",
    integration_load: "low",
    resource_required: "no",
    resource_access_status: "not_applicable",
    handoff_state: "none",
    unmet_external_need: "none",
    fallback_available: "not_applicable",
    ...overrides
  };
}

test("protocol planner bypasses guide graph for current external reality", () => {
  const plan = planTherapyFromGraphs({
    variables,
    graphs,
    protocolProfile: profile({ primary_problem_class: "external_relational_practical", external_action_required: "yes" })
  });
  assert.equal(plan.primaryJob.id, "PROTO.O3_CURRENT_REALITY");
  assert.equal(plan.therapyProtocol.runGuideGraph, false);
  assert.equal(plan.therapyProtocol.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("protocol planner removes a deep node when only light reparenting is permitted", () => {
  const plan = planTherapyFromGraphs({ variables, graphs, protocolProfile: profile() });
  assert.equal(plan.primaryJob.id, "IC.LIGHT_CONTACT");
  assert.ok(!plan.selectedNodes.some((node) => node.id === "IC.DEEP_CHILD_DIALOGUE"));
  assert.equal(plan.therapyProtocol.primaryOperation, OPERATION_CLASSES.LIGHT_REPARENTING);
});

test("material protocol unknown becomes the canonical next question", () => {
  const plan = planTherapyFromGraphs({
    variables,
    graphs,
    protocolProfile: profile({
      primary_problem_class: "refusal_capacity_ambivalence",
      decision_impact: "unknown",
      third_party_rights_or_consent: "unknown",
      action_authority: "unknown",
      lawful_decision_maker_status: "unknown",
      decision_capacity_status: "unknown"
    }),
    ablationVariant: "full"
  });
  assert.equal(plan.primaryJob.id, "PROTO.O9_HIGH_IMPACT_DECISION");
  assert.equal(plan.nextQuestionSource.type, "protocol-material-unknown");
  assert.ok(plan.therapyProtocol.materialUnknowns.length >= 1);
});

test("a direct suicide-risk question outranks resource and formulation unknowns", () => {
  const question = "Beyond having no current plan, is there any current intent, preparation, access to means, or uncertainty about remaining safe?";
  const plan = planTherapyFromGraphs({
    variables: { ...variables, present_safety: "unknown" },
    graphs,
    protocolProfile: profile({
      primary_problem_class: "mixed",
      resource_required: "yes",
      resource_access_status: "unknown",
      unmet_external_need: "present"
    }),
    unknowns: [
      { variable: "resource_access_status", question: "Can support be reached?", importance: 5 },
      { variable: "current_self_harm_risk", question, importance: 5 },
      { variable: "conditions_making_life_unbearable", question: "What conditions feel unbearable?", importance: 5 }
    ]
  });
  assert.equal(plan.primaryJob.id, "PROTO.O1_PRACTICAL_SAFETY");
  assert.equal(plan.nextQuestion, question);
  assert.equal(plan.nextQuestionSource.variable, "current_self_harm_risk");
});

test("a safety question is preserved verbatim without falsely changing a medical O3 route to O1", () => {
  const question = "Does this include thoughts of self-harm, restricting to a medically dangerous level, or another immediate safety concern?";
  const plan = planTherapyFromGraphs({
    variables,
    graphs,
    protocolProfile: profile({ primary_problem_class: "medical_condition", resource_required: "unknown" }),
    unknowns: [{ variable: "safety_and_crisis_status", question, importance: 5 }]
  });
  assert.equal(plan.primaryJob.id, "PROTO.O3_CURRENT_REALITY");
  assert.equal(plan.nextQuestion, question);
});

test("combined indirect hopelessness receives the canonical direct safety question while retaining medical O3", () => {
  const plan = planTherapyFromGraphs({
    variables: { ...variables, present_safety: "unknown" },
    graphs,
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      current_external_danger: "unknown",
      resource_required: "unknown",
      original_concern: "The symptoms are constant mental torture and I feel out of options."
    })
  });
  assert.equal(plan.primaryJob.id, "PROTO.O3_CURRENT_REALITY");
  assert.equal(plan.nextQuestionSource.variable, "current_personal_safety");
  assert.match(plan.nextQuestion, /thoughts of suicide or self-harm/i);
});

test("caregiver depletion pairs caregiver and dependent essential-care safety checks", () => {
  const caregiverQuestion = "Are you currently thinking about suicide or self-harm, or worried that you may not be able to keep yourself safe?";
  const dependentQuestion = "Is exhaustion currently affecting the dependent person's safety or essential care?";
  const plan = planTherapyFromGraphs({
    variables,
    graphs,
    protocolProfile: profile({
      primary_problem_class: "external_relational_practical",
      external_action_required: "unknown",
      supporter_role_boundary: "at_risk",
      dependent_danger: "unknown",
      physical_cost: "high"
    }),
    unknowns: [
      { variable: "current_personal_safety", question: caregiverQuestion, importance: 5 },
      { variable: "dependent_essential_care_safety", question: dependentQuestion, importance: 5 }
    ]
  });
  assert.equal(plan.primaryJob.id, "PROTO.O3_CURRENT_REALITY");
  assert.equal(plan.nextQuestion, `${caregiverQuestion} ${dependentQuestion}`);
  assert.match(plan.requiredNuance.join("\n"), /both the caregiver's immediate safety.*dependent person's essential care/i);
});

test("resource state is carried in the intervention contract", () => {
  const plan = planTherapyFromGraphs({
    variables,
    graphs,
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      resource_required: "yes",
      resource_access_status: "waitlisted",
      handoff_state: "unavailable",
      unmet_external_need: "present",
      fallback_action: "interim primary care",
      fallback_limit: "not specialist treatment"
    })
  });
  assert.equal(plan.primaryJob.id, "PROTO.O10_EXTERNAL_HANDOFF");
  assert.equal(plan.therapyProtocol.resourceState.unresolved, true);
  assert.equal(plan.therapyProtocol.resourceState.accessStatus, "waitlisted");
});

test("high-risk protocol states force forensic review and authority cases force reviewed mode", () => {
  assert.equal(protocolRequiresReviewedTier({ protocol_profile: profile({ current_external_danger: "present" }) }).tier, "forensic");
  assert.equal(protocolRequiresReviewedTier({ protocol_profile: profile({ primary_problem_class: "refusal_capacity_ambivalence" }) }).tier, "reviewed");
});
