import test from "node:test";
import assert from "node:assert/strict";
import {
  INNER_PARENT_ONTOLOGY,
  OPERATION_CLASSES,
  ROUTE_DISPOSITIONS
} from "../src/therapy-protocol/contract.mjs";
import { routeTherapyProtocol, simpleCapabilityRoute, simpleSupportedChoiceRoute } from "../src/therapy-protocol/router.mjs";
import { validateProtocolProfile } from "../src/therapy-protocol/validate.mjs";

function variables(overrides = {}) {
  return {
    present_safety: "safe",
    orientation: "oriented",
    ability_to_stop: "yes",
    ability_to_return: "yes",
    activation: "low",
    dissociation: "none",
    altered_state: "sober",
    witness_capacity: "present",
    current_intent: "conversation",
    credibility_conflict: "absent",
    coherent_child_state: "present",
    identity_blur: "absent",
    protective_response: "absent",
    self_criticism: "absent",
    ...overrides
  };
}

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
    decision_impact: "private_reversible",
    third_party_rights_or_consent: "absent",
    action_authority: "reversible_only",
    ...overrides
  };
}

test("canonical ontology is one parent with three qualities", () => {
  assert.equal(INNER_PARENT_ONTOLOGY.parentCount, 1);
  assert.deepEqual(INNER_PARENT_ONTOLOGY.qualities, ["nurturing", "protecting", "guiding"]);
  assert.equal(INNER_PARENT_ONTOLOGY.autonomousAgents, false);
});

test("legacy snapshots remain compatible without fabricating new profile values", () => {
  const route = routeTherapyProtocol({ variables: variables() });
  assert.equal(route.compatibilityMode, true);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_PRIMARY);
  assert.equal(route.runGuideGraph, true);
  assert.equal(route.profile.decision_capacity_status, "unknown");
  assert.equal(route.profile.resource_access_status, "unknown");
});

test("current external danger bypasses ordinary inner work", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ current_external_danger: "present", primary_problem_class: "danger_basic_needs" }),
    variables: variables({ present_safety: "unsafe" })
  });
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
  assert.equal(route.primaryOperation, OPERATION_CLASSES.PRACTICAL_SAFETY);
  assert.equal(route.runGuideGraph, false);
  assert.ok(route.blockedOperations.some((item) => item.operation === OPERATION_CLASSES.DEPTH_ACCESS));
});

test("explicit suicide or self-harm evidence keeps O1 ahead of resource uncertainty", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      resource_required: "yes",
      resource_access_status: "unknown",
      unmet_external_need: "present"
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "resource_access_status", question: "Can support be reached?", importance: 5 },
      { variable: "immediate_self_harm_or_suicide_risk", question: "Are there suicidal thoughts or an inability to remain safe right now?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.PRACTICAL_SAFETY);
  assert.equal(route.runGuideGraph, false);
});

test("an absent beneficiary cannot demote valid O1 O9 or O10 outer routes", () => {
  const safety = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "caregiver",
      beneficiary_present: "no",
      primary_problem_class: "actual_or_potential_harm",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      current_external_danger: "unknown"
    }),
    variables: variables({ present_safety: "unknown" })
  });
  const decision = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "supporter",
      beneficiary_present: "no",
      primary_problem_class: "refusal_capacity_ambivalence",
      requested_operation: OPERATION_CLASSES.HIGH_IMPACT_DECISION,
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      lawful_decision_maker_status: "unknown"
    }),
    variables: variables()
  });
  const handoff = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "supporter",
      beneficiary_present: "no",
      primary_problem_class: "mixed",
      requested_operation: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "suggested",
      unmet_external_need: "present"
    }),
    variables: variables()
  });
  assert.equal(safety.primaryOperation, OPERATION_CLASSES.PRACTICAL_SAFETY);
  assert.equal(decision.primaryOperation, OPERATION_CLASSES.HIGH_IMPACT_DECISION);
  assert.equal(handoff.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
});

test("a consequential authority decision remains O9 while urgent medical reassessment stays required", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "caregiver",
      beneficiary_present: "no",
      primary_problem_class: "mixed",
      current_external_danger: "present",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      external_action_required: "yes",
      decision_impact: "high_impact_third_party",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      action_authority: "unknown",
      decision_capacity_status: "disputed",
      capacity_concern: "present",
      lawful_decision_maker_status: "unknown",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "suggested",
      unmet_external_need: "present"
    }),
    variables: variables({ present_safety: "unsafe" })
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.HIGH_IMPACT_DECISION);
  assert.ok(route.requiredNuance.some((line) => /urgent medical reassessment/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /replace urgent medical reassessment/i.test(line)));
});

test("an explicit unresolved professional-support need keeps O10 despite a mixed problem class", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      requested_operation: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "suggested",
      unmet_external_need: "present"
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
});

test("supporter query cannot formulate an absent adult as the therapy subject", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ request_actor: "supporter", beneficiary_present: "no", primary_problem_class: "internal_developmental" }),
    variables: variables()
  });
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.runGuideGraph, false);
});

test("operation-scoped not-now blocks only the requested optional operation and creates no retry debt", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ requested_operation: OPERATION_CLASSES.LIGHT_REPARENTING, operation_consent: "not_now", consent_scope: "timing" }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.SUPPORT_ORIENT);
  assert.ok(route.blockedOperations.some((item) => item.operation === OPERATION_CLASSES.LIGHT_REPARENTING && /declined/i.test(item.reason)));
  assert.ok(route.allowedOperations.includes(OPERATION_CLASSES.CURRENT_REALITY));
});

test("declining all engagement leaves only support, safety, and handoff operations", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ operation_consent: "not_now", consent_scope: "all_engagement" }),
    variables: variables()
  });
  assert.deepEqual(route.allowedOperations.sort(), [
    OPERATION_CLASSES.EXTERNAL_HANDOFF,
    OPERATION_CLASSES.PRACTICAL_SAFETY,
    OPERATION_CLASSES.SUPPORT_ORIENT
  ].sort());
});

test("depth requires known sober stopping and integration prerequisites", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ requested_operation: OPERATION_CLASSES.DEPTH_ACCESS, integration_load: "unknown" }),
    variables: variables()
  });
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INSUFFICIENT_INFORMATION);
  assert.equal(route.primaryOperation, OPERATION_CLASSES.SUPPORT_ORIENT);
  assert.ok(route.materialUnknowns.includes("integration_load"));
  assert.ok(route.blockedOperations.some((item) => item.operation === OPERATION_CLASSES.DEPTH_ACCESS));
});

test("safe depth becomes available without equating it to integration", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      requested_operation: OPERATION_CLASSES.DEPTH_ACCESS,
      integration_load: "low",
      source_class: "felt_sense",
      factual_confidence: "medium",
      historical_provenance_stable: "yes"
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.DEPTH_ACCESS);
  assert.ok(route.allowedOperations.includes(OPERATION_CLASSES.DEPTH_ACCESS));
  assert.ok(route.requiredNuance.some((line) => /felt sense may/i.test(line)));
  assert.ok(route.protocolJob.recommendations.some((line) => /depth, and integration separately/i.test(line)));
});

test("awareness does not become behavioral control", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ primary_problem_class: "capability_skill_scaffold", insight_present: "yes", behavioral_control: "absent" }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.ok(route.requiredNuance.some((line) => /understand the pattern while lacking inhibitory control/i.test(line)));
  assert.equal(simpleCapabilityRoute(route.profile), OPERATION_CLASSES.CURRENT_REALITY);
});

test("missing instruction is not missing Guide", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ primary_problem_class: "capability_skill_scaffold", skill_or_instruction_deficit: "present", guiding_quality: "available" }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.ok(route.forbiddenOverclaims.some((line) => /skill or access deficit/i.test(line)));
});

test("external scaffold loss is not failed internalization", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ primary_problem_class: "capability_skill_scaffold", scaffold_status: "lost" }),
    variables: variables()
  });
  assert.ok(route.requiredNuance.some((line) => /does not prove failed internalization/i.test(line)));
});

test("treatment ambivalence remains separate from incapacity", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "refusal_capacity_ambivalence",
      change_target_endorsement: "mixed",
      decision_capacity_status: "presumed",
      capacity_concern: "absent",
      decision_impact: "consequential_reversible"
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.ok(route.forbiddenOverclaims.some((line) => /ambivalence with incapacity/i.test(line)));
  assert.equal(simpleSupportedChoiceRoute(route.profile), OPERATION_CLASSES.CURRENT_REALITY);
});

test("unknown capacity or authority never becomes a chatbot incapacity verdict", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "refusal_capacity_ambivalence",
      decision_capacity_status: "unknown",
      capacity_concern: "present",
      lawful_decision_maker_status: "unknown",
      action_authority: "unknown",
      decision_impact: "hard_to_reverse"
    }),
    variables: variables()
  });
  assert.ok(route.forbiddenOverclaims.some((line) => /do not certify incapacity/i.test(line)));
  assert.ok(route.materialUnknowns.includes("action_authority"));
});

test("unavailable resource is explicit and unresolved rather than motivation failure", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      resource_required: "yes",
      required_external_resource: "specialist care",
      resource_access_status: "unaffordable",
      access_barrier: "cost",
      handoff_state: "unavailable",
      fallback_available: "yes",
      fallback_action: "primary-care monitoring",
      fallback_limit: "does not replace specialist treatment",
      unmet_external_need: "present",
      unmet_external_need_detail: "specialist assessment",
      retry_or_advocacy_trigger: "insurance appeal decision"
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
  assert.equal(route.resourceState.unresolved, true);
  assert.equal(route.resourceState.accessStatus, "unaffordable");
  assert.match(route.resourceState.fallbackLimit, /does not replace/);
  assert.ok(route.forbiddenOverclaims.some((line) => /same inaccessible referral/i.test(line)));
});

test("improved coping cannot close an unresolved external need", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "external_relational_practical",
      resource_required: "yes",
      resource_access_status: "waitlisted",
      handoff_state: "unavailable",
      unmet_external_need: "present",
      nurturing_quality: "available",
      protecting_quality: "available",
      guiding_quality: "available"
    }),
    variables: variables()
  });
  assert.equal(route.resourceState.unresolved, true);
  assert.equal(route.runGuideGraph, false);
});

test("felt sense meaning and historical proof remain separate", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ source_class: "felt_sense", factual_confidence: "high", action_authority: "reversible_only" }),
    variables: variables()
  });
  assert.ok(route.requiredNuance.some((line) => /historical proof/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /historical truth/i.test(line)));
});

test("frame rejection reduces formulation authority instead of confirming resistance", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({ user_rejects_current_frame: "yes" }),
    variables: variables()
  });
  assert.ok(route.requiredNuance.some((line) => /rejected the current formulation/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /frame rejection as confirmation/i.test(line)));
});

test("validator rejects unknown fields and illegal enum values", () => {
  assert.throws(() => validateProtocolProfile({ made_up: "yes" }), /not allowed/);
  assert.throws(() => validateProtocolProfile({ request_actor: "wizard" }), /invalid value/);
});
