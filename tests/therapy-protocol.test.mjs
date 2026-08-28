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

test("indirect end-of-rope language preserves an O3 personal-safety check without fabricating explicit suicide evidence", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      current_external_danger: "unknown",
      condition_instability: "present",
      resource_required: "unknown",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      bodily_decision_owner: "self",
      physical_cost: "high",
      original_concern: "Daily heart-rhythm symptoms feel like constant mental torture, treatments have not resolved them, and I feel out of options.",
      access_barrier: "Unknown"
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "Current medical care status", question: "Is current medical care in place?", importance: 5 },
      { variable: "Current acute cardiac warning signs", question: "Are acute cardiac warning signs present?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
  assert.ok(route.materialUnknowns.includes("current_personal_safety"));
  assert.ok(route.requiredNuance.some((line) => /current suicide, self-harm, or inability-to-stay-safe risk/i.test(line)));
});

test("self-requested medical triage stays O3 when bodily decision ownership is not applicable", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      current_external_danger: "unknown",
      condition_instability: "unknown",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      resource_required: "unknown",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      bodily_decision_owner: "not_applicable",
      original_concern: "Daily heart-rhythm symptoms have worsened, feel like constant mental torture, and I feel out of options.",
      access_barrier: "Unknown"
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "condition_instability / acute cardiac risk", question: "Is there an acute or urgently dangerous cardiac component?", importance: 5 },
      { variable: "acute_cardiorespiratory_warning_signs", question: "Are there fainting, chest pain, or breathing warning signs?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
  assert.ok(route.requiredNuance.some((line) => /triage current medical status.*heart-rhythm symptoms.*urgent or emergency medical evaluation/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /chronicity.*unsuccessful treatment.*medically safe/i.test(line)));
});

test("violent loss of control retains O1 before explanation even when immediate danger is unresolved", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "unknown",
      requested_operation: OPERATION_CLASSES.SUPPORT_ORIENT,
      insight_present: "yes",
      behavioral_control: "partial",
      original_concern: "Explosive episodes include throwing objects and destroying property; clear thinking is unavailable once one starts."
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [{ variable: "harm_to_people_risk", question: "Is anyone at risk now?", importance: 5 }]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.PRACTICAL_SAFETY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
  assert.ok(route.requiredNuance.some((line) => /environmental controls.*practiced exit.*repair/i.test(line)));
});

test("a completed high-impact bodily decision remains O9 during retrospective authority and conduct review", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      requested_operation: OPERATION_CLASSES.CURRENT_REALITY,
      decision_impact: "unknown",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "self",
      action_authority: "not_applicable",
      decision_subject: "The bodily decision is already made; the pending review separates authority, grief, disclosure, and each person's conduct."
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.HIGH_IMPACT_DECISION);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("non-bodily privacy containment stays O3 while preserving urgent external action", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "present",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "not_applicable",
      action_authority: "bounded",
      condition_instability: "unknown",
      dependent_danger: "unknown",
      resource_required: "yes",
      resource_access_status: "unknown",
      unmet_external_need: "unknown"
    }),
    variables: variables({ present_safety: "unsafe" }),
    unknowns: [
      { variable: "immediate_camera_exposure", question: "Could anyone else still be recorded?", importance: 5 },
      { variable: "imminent_recording_or_file_misuse", question: "Could the file be viewed or shared again?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
  assert.equal(route.resourceState.unmetNeed, "unknown");
  assert.equal(route.resourceState.unresolved, false);
});

test("recording and evidence containment stays O3 when an audit labels the rights owner as other", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "present",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      action_authority: "bounded",
      basic_needs_failure: "absent",
      condition_instability: "unknown",
      dependent_danger: "unknown"
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "cameras_still_active", question: "Could anyone still be recorded?", importance: 5 },
      { variable: "recording_distribution", question: "Was the recording distributed?", importance: 5 },
      { variable: "lawful_evidence_handling_authority", question: "What lawful handling is available?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
  assert.ok(route.requiredNuance.some((line) => /reversible access controls.*qualified local legal advice/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /deleting, destroying, altering.*jurisdiction-specific/i.test(line)));
});

test("postpartum infant uncertainty forbids attachment certification and requires safety-functioning checks", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "certainty_reality_uncertainty",
      requested_operation: OPERATION_CLASSES.CURRENT_REALITY,
      parent_quality_context: "receiving_care",
      current_external_danger: "absent",
      basic_needs_failure: "unknown",
      condition_instability: "unknown",
      dependent_danger: "unknown",
      source_class: "direct_memory",
      factual_confidence: "medium",
      original_concern: "My newborn cries more with me after a NICU stay and I fear our bond is damaged."
    }),
    variables: variables(),
    unknowns: [
      { variable: "postpartum_mood_status", question: "Are there postpartum mood or anxiety symptoms?", importance: 5 },
      { variable: "infant_medical_warning_signs", question: "Does the baby have acute warning signs?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.ok(route.requiredNuance.some((line) => /parent and infant safety and functioning.*qualified postpartum and pediatric care/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /damaged or secure attachment bond.*attachment center/i.test(line)));
});

test("privacy containment cannot be re-promoted to O9 by an external-relational base route", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "external_relational_practical",
      current_external_danger: "unknown",
      requested_operation: OPERATION_CLASSES.CURRENT_REALITY,
      external_action_required: "yes",
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "not_applicable",
      action_authority: "bounded",
      basic_needs_failure: "absent",
      condition_instability: "unknown",
      dependent_danger: "absent"
    }),
    variables: variables(),
    unknowns: [
      { variable: "recording_distribution", question: "Was the recording distributed?", importance: 5 },
      { variable: "current_recording_risk", question: "Is there current recording risk?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("non-bodily rights containment stays O3 when a model requests O9", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "unknown",
      requested_operation: OPERATION_CLASSES.HIGH_IMPACT_DECISION,
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "not_applicable",
      action_authority: "reversible_only",
      basic_needs_failure: "unknown",
      condition_instability: "unknown",
      dependent_danger: "unknown"
    }),
    variables: variables(),
    unknowns: [
      { variable: "immediate_third_party_recording_risk", question: "Could anyone still be recorded?", importance: 5 },
      { variable: "authority_for_irreversible_handling", question: "What lawful handling is available?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("an absent person's suicide crisis routes an at-risk supporter to actionable O10", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "mixed",
      beneficiary_present: "no",
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "present",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      action_authority: "bounded",
      decision_capacity_status: "presumed",
      capacity_concern: "present",
      lawful_decision_maker_status: "unknown",
      supporter_role_boundary: "at_risk",
      resource_required: "yes",
      resource_access_status: "unknown",
      unmet_external_need: "present"
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [{
      variable: "immediate_suicide_danger",
      question: "Is there immediate suicide danger?",
      importance: 5
    }]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
});

test("an at-risk supporter's required crisis handoff outranks ambiguous beneficiary and authority labels", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "self",
      beneficiary_present: "yes",
      primary_problem_class: "mixed",
      current_external_danger: "present",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      external_action_required: "yes",
      decision_impact: "high_impact_third_party",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      action_authority: "bounded",
      decision_capacity_status: "unknown",
      lawful_decision_maker_status: "unknown",
      supporter_role_boundary: "at_risk",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "present"
    }),
    variables: variables({ present_safety: "unsafe" })
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
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

test("an audited O9 capacity decision outranks an inferred supporter handoff while retaining urgent medical action", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "supporter",
      beneficiary_present: "no",
      primary_problem_class: "mixed",
      current_external_danger: "present",
      basic_needs_failure: "present",
      condition_instability: "unknown",
      dependent_danger: "unknown",
      requested_operation: OPERATION_CLASSES.HIGH_IMPACT_DECISION,
      external_action_required: "yes",
      decision_impact: "high_impact_third_party",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      action_authority: "unknown",
      decision_capacity_status: "disputed",
      capacity_concern: "present",
      lawful_decision_maker_status: "unknown",
      supporter_role_boundary: "at_risk",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "present",
      decision_subject: "Whether and through what lawful clinical process caregivers can act on a disputed treatment refusal."
    }),
    variables: variables({ present_safety: "unsafe" }),
    unknowns: [
      { variable: "current_acute_neurological_or_metabolic_symptoms", question: "Is there an acute medical change?", importance: 5 },
      { variable: "existing_legal_authority", question: "Who has lawful authority?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.HIGH_IMPACT_DECISION);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
  assert.ok(route.requiredNuance.some((line) => /urgent medical reassessment/i.test(line)));
  assert.ok(route.forbiddenOverclaims.some((line) => /replace urgent medical reassessment/i.test(line)));
});

test("material financial and basic-needs decision unknowns retain O9 when the exact action is unresolved", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      requested_operation: OPERATION_CLASSES.CURRENT_REALITY,
      decision_impact: "unknown",
      bodily_decision_owner: "not_applicable",
      action_authority: "unknown",
      capacity_concern: "present",
      decision_subject: "How to respond to a consequential relationship and financial decision whose exact action is not yet named."
    }),
    variables: variables(),
    unknowns: [
      { variable: "immediate_basic_needs_exposure", question: "Are basic needs exposed?", importance: 5 },
      { variable: "decision_impact_and_timing", question: "What is the impact and timing?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.HIGH_IMPACT_DECISION);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("an explicit unresolved professional-support need keeps O10 despite a mixed problem class", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      requested_operation: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "suggested",
      unmet_external_need: "present"
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
});

test("a proposed therapy ending retains O10 when live extraction leaves resource enums unknown", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      current_external_danger: "unknown",
      requested_operation: OPERATION_CLASSES.HIGH_IMPACT_DECISION,
      external_action_required: "yes",
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      action_authority: "bounded",
      resource_required: "unknown",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "unknown",
      original_concern: "My therapist suggested that we might need to consider ending therapy.",
      provider_or_setting_condition: "The therapist raised a possible ending of the existing therapeutic relationship.",
      decision_subject: "Whether and how therapy will continue or end.",
      unmet_external_need_detail: "Whether continuity planning, referral, or replacement professional support will be available is unknown."
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "harm_ideation", question: "Is there any immediate harm risk?", importance: 5 },
      { variable: "therapy_termination_status", question: "Is termination decided or still open?", importance: 5 },
      { variable: "termination_reason_and_decision_authority", question: "Why was ending raised?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
  assert.equal(route.resourceState.required, "unknown");
  assert.equal(route.resourceState.handoffState, "unknown");
  assert.equal(route.resourceState.unresolved, true);
});

test("a negated continuity gap and unknown handling authority cannot promote privacy containment above O3", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "unknown",
      requested_operation: OPERATION_CLASSES.CURRENT_REALITY,
      external_action_required: "yes",
      decision_impact: "hard_to_reverse",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "not_applicable",
      action_authority: "unknown",
      resource_required: "unknown",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "unknown",
      original_concern: "The person fears that therapy or disclosure about a continuing privacy violation will ruin their life.",
      provider_or_setting_condition: "No provider or setting has been identified.",
      required_external_resource: "No required provider or legal service is established.",
      unmet_external_need_detail: "No unmet professional-resource need or continuity gap is established."
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "active_recording_status", question: "Is recording continuing?", importance: 5 },
      { variable: "recording_distribution_scope", question: "Were copies shared?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("unconfirmed medical monitoring and provider status stays O3 instead of inventing an O10 gap", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      current_external_danger: "unknown",
      basic_needs_failure: "unknown",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      external_action_required: "yes",
      decision_impact: "consequential_reversible",
      third_party_rights_or_consent: "absent",
      bodily_decision_owner: "self",
      action_authority: "unknown",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "present",
      original_concern: "Physical fullness, intense hunger, bloating, and uncertainty about continuing recovery.",
      required_external_resource: "Medical or eating-disorder professional assessment and recovery support.",
      access_barrier: "Unknown — no current treatment team or contact status confirmed",
      unmet_external_need_detail: "It is unknown whether a treatment team currently exists or knows about the symptoms."
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [
      { variable: "current_treatment_team", question: "Is there a current treatment team?", importance: 5 },
      { variable: "medical_monitoring_status", question: "Are these symptoms medically monitored?", importance: 5 },
      { variable: "immediate_medical_danger", question: "Are there acute warning signs?", importance: 5 },
      { variable: "active_recovery_interruption_intent", question: "Is there an active plan to stop recovery?", importance: 5 }
    ]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("explicit acute medical danger keeps O1 ahead of a required professional resource", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "medical_condition",
      current_external_danger: "present",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      external_action_required: "yes",
      third_party_rights_or_consent: "absent",
      bodily_decision_owner: "self",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "present",
      original_concern: "I am fainting and having chest pain during recovery.",
      required_external_resource: "Urgent medical assessment",
      access_barrier: "unknown"
    }),
    variables: variables({ present_safety: "unsafe" }),
    unknowns: [{ variable: "immediate_medical_danger", question: "Can urgent medical care be reached now?", importance: 5 }]
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.PRACTICAL_SAFETY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
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

test("explicit current-turn safety resolution and practical topic shifts release stale routes to O3", () => {
  const safetyResolved = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "actual_or_potential_harm",
      current_external_danger: "unknown",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [{ variable: "immediate_recurrence_or_return_risk", question: "Can the danger return?", importance: 5 }],
    currentMessage: "I am physically safe now. Please help me sort the practical situation that led up to it."
  });
  assert.equal(safetyResolved.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(safetyResolved.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);

  const changedSubject = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "external_relational_practical",
      requested_operation: OPERATION_CLASSES.CURRENT_REALITY,
      user_rejects_current_frame: "yes",
      external_action_required: "yes"
    }),
    variables: variables(),
    currentMessage: "Instead, help me prepare the three facts I need for a meeting about my workload."
  });
  assert.equal(changedSubject.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(changedSubject.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("a current no-threat boundary request does not inherit a permanent supporter safety route", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "caregiver",
      beneficiary_present: "no",
      primary_problem_class: "actual_or_potential_harm",
      requested_operation: OPERATION_CLASSES.PRACTICAL_SAFETY,
      supporter_role_boundary: "at_risk",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      unmet_external_need: "present"
    }),
    variables: variables({ present_safety: "unknown" }),
    unknowns: [{ variable: "current_direct_self_harm_indicators", question: "Is there suicidal intent now?", importance: 5 }],
    currentMessage: "There is no immediate threat this minute, but I am exhausted and need a boundary and backup plan."
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("model-requested O9 alone does not escalate a self-owned consequential reversible choice", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "refusal_capacity_ambivalence",
      requested_operation: OPERATION_CLASSES.HIGH_IMPACT_DECISION,
      decision_impact: "consequential_reversible",
      third_party_rights_or_consent: "absent",
      bodily_decision_owner: "self",
      capacity_concern: "absent",
      decision_capacity_status: "presumed",
      change_target_endorsement: "mixed"
    }),
    variables: variables()
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.CURRENT_REALITY);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);
});

test("acute unstable medical change requiring care outranks third-party authority review", () => {
  const route = routeTherapyProtocol({
    protocolProfile: profile({
      request_actor: "supporter",
      beneficiary_present: "no",
      primary_problem_class: "medical_condition",
      current_external_danger: "present",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.HIGH_IMPACT_DECISION,
      decision_impact: "high_impact_third_party",
      third_party_rights_or_consent: "present",
      bodily_decision_owner: "other",
      capacity_concern: "present",
      decision_capacity_status: "unknown",
      resource_required: "yes",
      resource_access_status: "unknown",
      handoff_state: "unknown",
      original_concern: "After a stroke she is suddenly confused and cannot follow the conversation."
    }),
    variables: variables({ present_safety: "unknown" })
  });
  assert.equal(route.primaryOperation, OPERATION_CLASSES.EXTERNAL_HANDOFF);
  assert.equal(route.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);
});

test("depth follows integration state across overload, persistent impairment, and restored readiness", () => {
  const overloaded = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      requested_operation: OPERATION_CLASSES.DEPTH_ACCESS,
      integration_load: "high",
      historical_provenance_stable: "unknown"
    }),
    variables: variables({ present_safety: "unknown", orientation: "unknown", ability_to_stop: "unknown", ability_to_return: "unknown", altered_state: "unknown" }),
    currentMessage: "A deep memory exercise left me unable to function for days, but I want to go deeper tonight."
  });
  assert.equal(overloaded.primaryOperation, OPERATION_CLASSES.REGULATION);
  assert.equal(overloaded.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT);

  const impaired = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      condition_instability: "present",
      requested_operation: OPERATION_CLASSES.DEPTH_ACCESS,
      integration_load: "high"
    }),
    variables: variables({ present_safety: "unknown", orientation: "unknown", ability_to_stop: "unknown", ability_to_return: "unknown", altered_state: "unknown" }),
    currentMessage: "I am calmer today but still cannot work or sleep normally. Can we do the depth exercise now?"
  });
  assert.equal(impaired.primaryOperation, OPERATION_CLASSES.REGULATION);
  assert.equal(impaired.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED);

  const restored = routeTherapyProtocol({
    protocolProfile: profile({
      primary_problem_class: "mixed",
      condition_instability: "unknown",
      requested_operation: OPERATION_CLASSES.DEPTH_ACCESS,
      consent_scope: "multiple",
      integration_load: "high",
      historical_provenance_stable: "unknown"
    }),
    variables: variables({ present_safety: "unknown", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", altered_state: "sober" }),
    unknowns: [{ variable: "recovery_stability_and_recurrence_controls", question: "How long has recovery held?", importance: 5 }],
    currentMessage: "My ordinary functioning has returned, I am sober and oriented, I can stop and return, and I consent to this specific depth exercise."
  });
  assert.equal(restored.primaryOperation, OPERATION_CLASSES.DEPTH_ACCESS);
  assert.equal(restored.disposition, ROUTE_DISPOSITIONS.INNER_CHILD_PRIMARY);
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
