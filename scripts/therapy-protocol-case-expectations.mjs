import { OPERATION_CLASSES, ROUTE_DISPOSITIONS } from "../src/therapy-protocol/contract.mjs";

const O = OPERATION_CLASSES;
const D = ROUTE_DISPOSITIONS;

export const BASE_VARIABLES = Object.freeze({
  present_safety: "safe",
  orientation: "oriented",
  ability_to_stop: "yes",
  ability_to_return: "yes",
  activation: "moderate",
  dissociation: "none",
  altered_state: "sober",
  inner_adult_access: "unknown",
  parent_imagery: "not_used",
  love_access: "unknown",
  self_directed_love: "unknown",
  solar_plexus_tension: "unknown",
  protective_response: "unknown",
  urge_to_escape: "unknown",
  credibility_conflict: "unknown",
  age_agency_ambiguity: "unknown",
  resentment_toward_younger_self: "unknown",
  coherent_child_state: "unclear",
  identity_blur: "unknown",
  belonging_pressure: "unknown",
  self_criticism: "unknown",
  current_intent: "conversation",
  memory_source_risk: "unknown",
  forgiveness_interest: "unknown",
  support_available: "unknown",
  deep_work_readiness: "unknown",
  basic_reparenting_capacity: "unknown"
});

export const BASE_PROFILE = Object.freeze({
  request_actor: "self",
  beneficiary_present: "yes",
  primary_problem_class: "external_relational_practical",
  current_external_danger: "absent",
  basic_needs_failure: "absent",
  condition_instability: "absent",
  dependent_danger: "absent",
  current_sobriety: "sober",
  requested_operation: O.CURRENT_REALITY,
  operation_consent: "not_applicable",
  consent_scope: "not_applicable",
  integration_load: "not_applicable",
  external_action_required: "yes",
  decision_impact: "private_reversible",
  third_party_rights_or_consent: "absent",
  bodily_decision_owner: "self",
  source_class: "not_applicable",
  factual_confidence: "not_applicable",
  action_authority: "reversible_only",
  change_target_endorsement: "not_applicable",
  decision_capacity_status: "presumed",
  capacity_concern: "absent",
  lawful_decision_maker_status: "self",
  supporter_role_boundary: "not_applicable",
  resource_required: "no",
  resource_access_status: "not_applicable",
  handoff_state: "none",
  unmet_external_need: "none",
  fallback_available: "not_applicable",
  original_concern_pending: "yes",
  repeated_referral: "no",
  adverse_trajectory: "none",
  user_rejects_current_frame: "no",
  user_wants_different_outcome: "yes",
  historical_provenance_stable: "yes",
  problem_portfolio_present: "absent",
  physical_cost: "low"
});

function entry({
  operation = O.CURRENT_REALITY,
  disposition = D.INNER_CHILD_NOT_RELEVANT,
  profile = {},
  variables = {},
  acceptableOperations = null,
  severity = "moderate",
  falseEscalationOperations = null,
  maps = [],
  requiredUnknowns = [],
  rationale
} = {}) {
  const defaultAcceptable = [operation];
  if ([O.PRACTICAL_SAFETY, O.EXTERNAL_HANDOFF].includes(operation)) defaultAcceptable.push(operation === O.PRACTICAL_SAFETY ? O.EXTERNAL_HANDOFF : O.PRACTICAL_SAFETY);
  const defaultFalseEscalations = operation === O.CURRENT_REALITY
    ? [O.DEPTH_ACCESS, O.HIGH_IMPACT_DECISION]
    : (operation === O.HIGH_IMPACT_DECISION ? [O.DEPTH_ACCESS, O.PRACTICAL_SAFETY, O.EXTERNAL_HANDOFF] : []);
  return {
    profile: { ...BASE_PROFILE, ...profile },
    variables: { ...BASE_VARIABLES, ...variables },
    expected: {
      operation,
      disposition,
      acceptableOperations: acceptableOperations ?? defaultAcceptable,
      requiredUnknowns,
      wrongRouteSeverity: severity,
      falseEscalationOperations: falseEscalationOperations ?? defaultFalseEscalations,
      rationale
    },
    ablationMaps: maps
  };
}

function currentReality(rationale, options = {}) {
  return entry({ rationale, ...options });
}

function safety(rationale, options = {}) {
  return entry({
    operation: O.PRACTICAL_SAFETY,
    disposition: D.INNER_CHILD_DEFERRED,
    severity: "severe",
    rationale,
    profile: {
      primary_problem_class: "danger_basic_needs",
      current_external_danger: "present",
      requested_operation: O.PRACTICAL_SAFETY,
      ...options.profile
    },
    variables: { present_safety: "unsafe", ...options.variables },
    maps: options.maps ?? []
  });
}

function handoff(rationale, options = {}) {
  const hard = options.hard === true;
  return entry({
    operation: O.EXTERNAL_HANDOFF,
    disposition: hard ? D.INNER_CHILD_DEFERRED : D.INNER_CHILD_NOT_RELEVANT,
    severity: "severe",
    rationale,
    profile: {
      primary_problem_class: options.problemClass ?? "medical_condition",
      current_external_danger: hard ? "present" : "absent",
      requested_operation: O.EXTERNAL_HANDOFF,
      resource_required: "yes",
      required_external_resource: options.resource ?? "qualified human or professional support",
      resource_access_status: options.access ?? "reachable_now",
      handoff_state: options.handoffState ?? "reachable",
      unmet_external_need: options.unmetNeed ?? "present",
      fallback_available: options.fallbackAvailable ?? "not_applicable",
      ...options.profile
    },
    variables: { present_safety: hard ? "unsafe" : "safe", ...options.variables },
    maps: options.maps ?? []
  });
}

function decision(rationale, options = {}) {
  return entry({
    operation: O.HIGH_IMPACT_DECISION,
    disposition: D.INNER_CHILD_NOT_RELEVANT,
    rationale,
    profile: {
      primary_problem_class: options.problemClass ?? "refusal_capacity_ambivalence",
      requested_operation: O.HIGH_IMPACT_DECISION,
      decision_impact: options.impact ?? "hard_to_reverse",
      third_party_rights_or_consent: options.thirdParty ?? "present",
      action_authority: options.authority ?? "bounded",
      lawful_decision_maker_status: options.decisionMaker ?? "self",
      decision_capacity_status: options.capacity ?? "presumed",
      capacity_concern: options.capacityConcern ?? "absent",
      change_target_endorsement: options.endorsement ?? "mixed",
      ...options.profile
    },
    severity: options.severity ?? "severe",
    requiredUnknowns: options.requiredUnknowns ?? [],
    maps: options.maps ?? []
  });
}

export const CASE_EXPECTATIONS = Object.freeze({
  "RQ6-01": currentReality("Repeated reassurance is a current certainty/accommodation loop, not a reparenting operation.", { profile: { primary_problem_class: "certainty_reality_uncertainty", adverse_trajectory: "reassurance_loop" } }),
  "RQ6-02": currentReality("Victim safety, retained material, evidence, and accountability precede shame relief.", { profile: { primary_problem_class: "actual_or_potential_harm", third_party_rights_or_consent: "present", action_authority: "bounded" }, severity: "severe" }),
  "RQ6-03": safety("A sober capable caregiver and dependent safety are the first operation.", { profile: { dependent_danger: "present", current_sobriety: "withdrawal_possible" } }),
  "RQ6-04": handoff("Possible dangerous mania requires urgent condition-specific human assessment.", { hard: true, resource: "urgent medical or psychiatric assessment", profile: { condition_instability: "present" } }),
  "RQ6-05": currentReality("Direct observations, disputed facts, and causal inference must remain separate.", { profile: { primary_problem_class: "certainty_reality_uncertainty", source_class: "inference", factual_confidence: "low", action_authority: "reversible_only" } }),
  "RQ6-06": currentReality("Perinatal and infant reality checks precede attachment interpretation.", { disposition: D.INNER_CHILD_DEFERRED, profile: { primary_problem_class: "medical_condition", physical_cost: "moderate" } }),
  "RQ6-07": currentReality("Birth-trauma grief and current perinatal recovery are not failed integration.", { profile: { primary_problem_class: "grief_transition", physical_cost: "moderate" } }),
  "RQ6-08": currentReality("Bereavement receives grief, functioning, and support routing without forced closure.", { profile: { primary_problem_class: "grief_transition" } }),
  "RQ6-09": currentReality("A memory-search request requires provenance and suggestibility limits before depth.", { profile: { primary_problem_class: "certainty_reality_uncertainty", requested_operation: O.DEPTH_ACCESS, operation_consent: "yes", consent_scope: "modality", source_class: "uncertainty", factual_confidence: "low", action_authority: "reversible_only", historical_provenance_stable: "no" }, severity: "severe" }),
  "RQ6-10": currentReality("A minor's family predictability and autonomy problem requires current family and access planning.", { profile: { request_actor: "self", primary_problem_class: "external_relational_practical", third_party_rights_or_consent: "present" } }),
  "RQ6-11": currentReality("A bounded factual medical question is not automatically a ritual or inner-child issue.", { disposition: D.INNER_CHILD_DEFERRED, profile: { primary_problem_class: "medical_condition" } }),
  "RQ6-12": handoff("Current domestic-violence danger requires a privacy-aware actionable external connection.", { hard: true, resource: "domestic-violence, emergency, or legal support", profile: { primary_problem_class: "danger_basic_needs", third_party_rights_or_consent: "present" } }),
  "RQ6-13": decision("Relationship, housing, and financial choices are high-impact present-adult decisions.", { problemClass: "external_relational_practical", impact: "high_impact_third_party" }),
  "RQ6-14": currentReality("Objective medical status, symptom burden, functional cost, and treatment burden remain distinct.", { disposition: D.INNER_CHILD_DEFERRED, profile: { primary_problem_class: "medical_condition", physical_cost: "high" } }),
  "RQ6-15": currentReality("Diagnostic uncertainty and consequential choices require proportional reversible current-reality review.", { profile: { decision_impact: "consequential_reversible", third_party_rights_or_consent: "present" } }),
  "RQ6-16": handoff("Possible alcohol withdrawal and medication interaction require medical assessment before regulation.", { hard: true, resource: "urgent withdrawal and medication assessment", profile: { current_sobriety: "withdrawal_possible", condition_instability: "present" } }),

  "RQ7-01": safety("Current suicide risk and basic safety precede educational capability work.", { profile: { basic_needs_failure: "present", skill_or_instruction_deficit: "present", instruction_access: "unavailable" }, maps: ["map15"] }),
  "RQ7-02": currentReality("Established deception and checking accommodation are simultaneous current-reality hypotheses.", { profile: { primary_problem_class: "certainty_reality_uncertainty", adverse_trajectory: "reassurance_loop" } }),
  "RQ7-03": currentReality("Insight without control requires a functional action-chain analysis.", { profile: { primary_problem_class: "capability_skill_scaffold", insight_present: "yes", behavioral_control: "absent" }, maps: ["map15"] }),
  "RQ7-04": handoff("A provider transition requires continuity, alternatives, transfer, and gap planning.", { resource: "continuity of care and provider transition support", problemClass: "external_relational_practical" }),
  "RQ7-05": currentReality("A major parenting transition requires workload, sleep, identity, and support review.", { profile: { primary_problem_class: "grief_transition", physical_cost: "high" } }),
  "RQ7-06": currentReality("Asexual identity and sexual boundaries are current consent facts, not exposure targets.", { profile: { primary_problem_class: "external_relational_practical", third_party_rights_or_consent: "present", bodily_decision_owner: "self" } }),
  "RQ7-07": currentReality("Loss of an app scaffold requires function transfer or replacement, not dependency diagnosis.", { profile: { primary_problem_class: "capability_skill_scaffold", scaffold_status: "lost" }, maps: ["map15"] }),
  "RQ7-08": currentReality("Positive care and reciprocal family obligations require a bounded practical agreement.", { profile: { primary_problem_class: "external_relational_practical", third_party_rights_or_consent: "present" } }),
  "RQ7-09": decision("Legitimate partner and infant interests do not transfer authority over the user's body.", { problemClass: "external_relational_practical", impact: "high_impact_third_party", profile: { bodily_decision_owner: "self" }, maps: ["map16"] }),
  "RQ7-10": currentReality("Dream content preserves meaning while remaining unauthenticated historical evidence.", { profile: { primary_problem_class: "certainty_reality_uncertainty", source_class: "dream", factual_confidence: "low", action_authority: "reversible_only", historical_provenance_stable: "no" } }),
  "RQ7-11": safety("Current suicide risk must be clarified while preserving system-distrust concerns.", { profile: { original_concern: "Fear of coercive or harmful crisis-system consequences" }, maps: [] }),
  "RQ7-12": safety("Current injury and continuing sexual-boundary danger precede moral equivalence or inner work.", { profile: { primary_problem_class: "actual_or_potential_harm", third_party_rights_or_consent: "present" } }),

  "RQ8-01": currentReality("When immediate medical danger is not established, ambivalence first needs supported choice and owned goals without a capacity escalation.", {
    profile: {
      primary_problem_class: "refusal_capacity_ambivalence",
      requested_operation: O.CURRENT_REALITY,
      decision_impact: "consequential_reversible",
      third_party_rights_or_consent: "absent",
      change_target_endorsement: "mixed"
    },
    acceptableOperations: [O.CURRENT_REALITY, O.HIGH_IMPACT_DECISION],
    maps: ["map16"]
  }),
  "RQ8-02": currentReality("Uncertain memory, confession relief, and another person's material rights require a disclosure differential.", { profile: { primary_problem_class: "certainty_reality_uncertainty", source_class: "uncertainty", factual_confidence: "low", action_authority: "reversible_only", adverse_trajectory: "reassurance_loop" } }),
  "RQ8-03": handoff("Concrete suicide/dependent danger needs an actionable handoff without making the supporter a guarantor.", { hard: true, resource: "suicide-risk, domestic-safety, and pregnancy support", profile: { request_actor: "supporter", beneficiary_present: "no", dependent_danger: "present", supporter_role_boundary: "at_risk" }, maps: ["map16"] }),
  "RQ8-04": decision("Post-stroke refusal requires supported choice and qualified decision-specific capacity review.", { impact: "hard_to_reverse", capacityConcern: "present", capacity: "disputed", decisionMaker: "disputed", maps: ["map16"] }),
  "RQ8-05": currentReality("A supporter may set a furniture/transport boundary without becoming an unauthorized controller.", { profile: { request_actor: "supporter", beneficiary_present: "no", supporter_role_boundary: "at_risk" }, maps: ["map16"] }),
  "RQ8-06": currentReality("Leaving a totalizing role requires practical independence, grief, and identity reconstruction.", { profile: { primary_problem_class: "large_portfolio", problem_portfolio_present: "present" } }),
  "RQ8-07": currentReality("Chronic illness and grief require physical-cost and accessible-support review before performance demands.", { disposition: D.INNER_CHILD_DEFERRED, profile: { primary_problem_class: "medical_condition", physical_cost: "high" } }),
  "RQ8-08": currentReality("A 24/7 care load is a structural and resource bottleneck, not absent Guide capacity.", { profile: { primary_problem_class: "capability_skill_scaffold", external_action_required: "yes", scaffold_status: "absent", physical_cost: "high" }, maps: ["map15", "map16"] }),
  "RQ8-09": safety("Violent loss of control requires current harm-risk and recurrence controls before more explanation.", { profile: { primary_problem_class: "actual_or_potential_harm", insight_present: "yes", behavioral_control: "absent" }, maps: ["map15"] }),
  "RQ8-10": handoff("Medication benefit, adverse effects, self-medication, and severe insomnia require coordinated medical review.", { hard: true, resource: "urgent prescriber, pharmacist, or medical review", profile: { condition_instability: "present" } }),
  "RQ8-11": safety("Suicide and basic-needs stability precede mindset or inner-parent interpretations of structural hardship.", { profile: { basic_needs_failure: "present", primary_problem_class: "danger_basic_needs" } }),

  "RQ9-01": handoff("A minor's lost time requires medical/mental-health differential assessment and reachable youth access.", { resource: "medical, mental-health, school, or youth assessment", profile: { resource_access_status: "blocked_by_guardian_or_authority", handoff_state: "unavailable", fallback_available: "yes", fallback_action: "safe school, primary-care, or youth channel", fallback_limit: "does not replace full assessment", retry_or_advocacy_trigger: "a safe adult or service becomes reachable", source_class: "testimony", factual_confidence: "low", historical_provenance_stable: "no" }, maps: ["map15", "map16"] }),
  "RQ9-02": decision("The patient's capacity, wishes, and actual authority govern hospice decisions rather than a family vote.", { impact: "hard_to_reverse", capacityConcern: "present", capacity: "unknown", decisionMaker: "unknown", requiredUnknowns: ["lawful_decision_maker_status", "decision_capacity_status"], maps: ["map16"] }),
  "RQ9-03": handoff("Food and medical access are unresolved basic needs when resources and family help are unavailable.", { hard: true, resource: "food, housing, medication, and medical access", access: "unavailable_other", handoffState: "unavailable", fallbackAvailable: "yes", unmetNeed: "present", profile: { basic_needs_failure: "present", fallback_action: "smallest reachable food or medical harm-reduction resource", fallback_limit: "does not resolve the full food and care deficit", retry_or_advocacy_trigger: "eligibility, family, or service access changes" }, maps: ["map16"] }),
  "RQ9-04": safety("The child's safety and recurrence prevention precede the parent's shame relief.", { profile: { dependent_danger: "present", primary_problem_class: "actual_or_potential_harm", insight_present: "yes", behavioral_control: "partial" }, maps: ["map15"] }),
  "RQ9-05": safety("A sober capable caregiver and separation from current violence protect the toddler first.", { profile: { dependent_danger: "present", current_sobriety: "intoxicated", primary_problem_class: "actual_or_potential_harm" } }),
  "RQ9-06": decision("Abortion authority remains with the pregnant person while grief, coercion, privacy, and conduct are reviewed separately.", { problemClass: "external_relational_practical", impact: "high_impact_third_party", profile: { bodily_decision_owner: "self" }, maps: ["map16"] }),
  "RQ9-07": handoff("Unaffordable recommended treatment requires a limited interim plan while the unmet need remains open.", { resource: "recommended treatment", access: "unaffordable", handoffState: "unavailable", fallbackAvailable: "yes", profile: { fallback_action: "reachable interim clinical support", fallback_limit: "not equivalent to the recommended treatment", retry_or_advocacy_trigger: "appeal, assistance, or cost status changes" } }),
  "RQ9-08": currentReality("Uncertain childhood-memory material must remain separate from current child-safety facts.", { profile: { primary_problem_class: "certainty_reality_uncertainty", source_class: "uncertainty", factual_confidence: "low", action_authority: "reversible_only", historical_provenance_stable: "no", third_party_rights_or_consent: "present" } }),
  "RQ9-09": handoff("A minor reporting current abuse needs a privacy-aware reachable safety and safeguarding route.", { hard: true, resource: "school, medical, youth, legal, or safeguarding support", profile: { resource_access_status: "unsafe_to_access", handoff_state: "unavailable", fallback_available: "yes", fallback_action: "smallest safe trusted-adult or emergency channel", fallback_limit: "cannot promise placement or legal outcome", retry_or_advocacy_trigger: "a safe private contact becomes possible", dependent_danger: "present" }, maps: ["map16"] }),
  "RQ9-10": handoff("Diagnosed celiac disease and safe food access are current medical/basic-needs facts.", { hard: true, resource: "safe food and medical or safeguarding support", profile: { basic_needs_failure: "present", resource_access_status: "blocked_by_guardian_or_authority", handoff_state: "unavailable", fallback_available: "yes", fallback_action: "safe school, clinician, trusted-adult, or youth channel", fallback_limit: "does not replace reliable safe-food access", retry_or_advocacy_trigger: "a safe adult or service becomes reachable" }, maps: ["map16"] })
});

export function expectationFor(id) {
  const value = CASE_EXPECTATIONS[id];
  if (!value) throw new Error(`No operation translation exists for ${id}.`);
  return structuredClone(value);
}
