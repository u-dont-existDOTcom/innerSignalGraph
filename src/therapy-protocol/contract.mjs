export const THERAPY_PROTOCOL_VERSION = "creative-tail-inner-child-2026-08-18-r1";

export const INNER_PARENT_ONTOLOGY = Object.freeze({
  parentCount: 1,
  kind: "one-inner-parent",
  qualities: Object.freeze(["nurturing", "protecting", "guiding"]),
  autonomousAgents: false
});

export const OPERATION_CLASSES = Object.freeze({
  SUPPORT_ORIENT: "O0_SUPPORT_ORIENT",
  PRACTICAL_SAFETY: "O1_PRACTICAL_SAFETY",
  REGULATION: "O2_REGULATION",
  CURRENT_REALITY: "O3_CURRENT_REALITY",
  BORROWED_CAPACITY: "O4_BORROWED_CAPACITY",
  LIGHT_REPARENTING: "O5_LIGHT_REPARENTING",
  TRUST_BEHAVIOR: "O6_TRUST_BEHAVIOR",
  IDENTITY_DIFFERENTIATION: "O7_IDENTITY_DIFFERENTIATION",
  DEPTH_ACCESS: "O8_DEPTH_ACCESS",
  HIGH_IMPACT_DECISION: "O9_HIGH_IMPACT_DECISION",
  EXTERNAL_HANDOFF: "O10_EXTERNAL_HANDOFF"
});

export const OPERATION_CLASS_VALUES = Object.freeze(Object.values(OPERATION_CLASSES));

export const ROUTE_DISPOSITIONS = Object.freeze({
  INNER_CHILD_PRIMARY: "INNER_CHILD_PRIMARY",
  INNER_CHILD_ADJUNCTIVE: "INNER_CHILD_ADJUNCTIVE",
  INNER_CHILD_DEFERRED: "INNER_CHILD_DEFERRED",
  INNER_CHILD_NOT_RELEVANT: "INNER_CHILD_NOT_RELEVANT_TO_NEXT_ACTION",
  INSUFFICIENT_INFORMATION: "INSUFFICIENT_INFORMATION_FOR_OPERATION"
});

const yesNoUnknown = ["yes", "no", "unknown"];
const presentAbsentUnknown = ["present", "absent", "unknown"];
const availability = ["available", "partial", "absent", "borrowed", "unknown"];

export const PROTOCOL_PROFILE_ENUMS = Object.freeze({
  request_actor: ["self", "supporter", "caregiver", "clinician_like_helper", "mixed", "unknown"],
  beneficiary_present: yesNoUnknown,
  primary_problem_class: [
    "danger_basic_needs",
    "medical_condition",
    "external_relational_practical",
    "grief_transition",
    "certainty_reality_uncertainty",
    "actual_or_potential_harm",
    "capability_skill_scaffold",
    "refusal_capacity_ambivalence",
    "internal_developmental",
    "large_portfolio",
    "mixed",
    "unknown"
  ],
  current_external_danger: presentAbsentUnknown,
  basic_needs_failure: presentAbsentUnknown,
  condition_instability: presentAbsentUnknown,
  dependent_danger: presentAbsentUnknown,
  current_sobriety: ["sober", "intoxicated", "withdrawal_possible", "altered", "unknown"],
  requested_operation: [...OPERATION_CLASS_VALUES, "unknown"],
  operation_consent: ["yes", "no", "not_now", "not_applicable", "unknown"],
  consent_scope: ["content", "modality", "intensity", "timing", "helper", "all_engagement", "multiple", "none", "not_applicable", "unknown"],
  parent_quality_context: ["calm", "task_pressure", "shame", "conflict", "attachment", "exhaustion", "receiving_care", "boundary", "post_failure", "altered_state_aftercare", "mixed", "unknown"],
  nurturing_quality: availability,
  protecting_quality: availability,
  guiding_quality: availability,
  witness_capacity: ["present", "partial", "absent", "unknown"],
  insight_present: yesNoUnknown,
  behavioral_control: availability,
  skill_or_instruction_deficit: presentAbsentUnknown,
  instruction_access: ["available", "limited", "unavailable", "unknown"],
  scaffold_status: ["stable", "changed", "lost", "absent", "unknown"],
  external_action_required: yesNoUnknown,
  decision_impact: ["private_reversible", "consequential_reversible", "high_impact_third_party", "hard_to_reverse", "unknown"],
  third_party_rights_or_consent: presentAbsentUnknown,
  bodily_decision_owner: ["self", "other", "shared_consequence_self_decision", "authorized_surrogate", "disputed", "not_applicable", "unknown"],
  source_class: ["direct_memory", "testimony", "inference", "photograph_video", "constructed_imagery", "felt_sense", "dream", "hypnosis", "meditation_vision", "altered_state", "metaphor", "uncertainty", "not_applicable", "unknown"],
  factual_confidence: ["low", "medium", "high", "not_applicable", "unknown"],
  action_authority: ["none", "reversible_only", "bounded", "high_impact_supported", "not_applicable", "unknown"],
  integration_load: ["low", "moderate", "high", "not_applicable", "unknown"],
  change_target_endorsement: ["endorsed", "mixed", "not_endorsed", "not_applicable", "unknown"],
  decision_capacity_status: ["presumed", "qualified_present", "qualified_absent", "fluctuating", "disputed", "not_applicable", "unknown"],
  capacity_concern: presentAbsentUnknown,
  lawful_decision_maker_status: ["self", "authorized_surrogate", "disputed", "not_applicable", "unknown"],
  supporter_role_boundary: ["intact", "at_risk", "violated", "not_applicable", "unknown"],
  resource_required: yesNoUnknown,
  resource_access_status: ["reachable_now", "reachable_later", "waitlisted", "unaffordable", "ineligible", "geographically_unavailable", "unsafe_to_access", "blocked_by_guardian_or_authority", "unavailable_other", "not_applicable", "unknown"],
  handoff_state: ["none", "suggested", "reachable", "attempted", "response_received", "bridged", "unavailable", "failed", "unknown"],
  unmet_external_need: ["present", "resolved", "none", "unknown"],
  fallback_available: ["yes", "no", "not_applicable", "unknown"],
  original_concern_pending: yesNoUnknown,
  repeated_referral: yesNoUnknown,
  adverse_trajectory: ["none", "reassurance_loop", "dependency_loop", "memory_certainty_loop", "parts_reification_loop", "coercive_growth_loop", "failure_debt_loop", "intensity_chasing_loop", "model_sealing_loop", "repeated_unavailable_referral", "mixed", "unknown"],
  user_rejects_current_frame: yesNoUnknown,
  user_wants_different_outcome: yesNoUnknown,
  historical_provenance_stable: yesNoUnknown,
  problem_portfolio_present: presentAbsentUnknown,
  physical_cost: ["low", "moderate", "high", "unknown"]
});

export const PROTOCOL_PROFILE_FIELDS = Object.freeze(Object.keys(PROTOCOL_PROFILE_ENUMS));

export const PROTOCOL_TEXT_FIELDS = Object.freeze([
  "original_concern",
  "person_owned_goal",
  "minimum_safety_goal",
  "harm_reduction_goal",
  "full_change_goal",
  "provider_or_setting_condition",
  "third_party_or_dependent_safety_goal",
  "smallest_endorsed_step",
  "decision_subject",
  "capacity_concern_basis",
  "required_external_resource",
  "access_barrier",
  "fallback_action",
  "fallback_limit",
  "unmet_external_need_detail",
  "retry_or_advocacy_trigger"
]);

export function blankProtocolProfile() {
  return {
    ...Object.fromEntries(PROTOCOL_PROFILE_FIELDS.map((field) => [field, "unknown"])),
    ...Object.fromEntries(PROTOCOL_TEXT_FIELDS.map((field) => [field, ""]))
  };
}

export const OPTIONAL_INNER_OPERATIONS = Object.freeze(new Set([
  OPERATION_CLASSES.BORROWED_CAPACITY,
  OPERATION_CLASSES.LIGHT_REPARENTING,
  OPERATION_CLASSES.TRUST_BEHAVIOR,
  OPERATION_CLASSES.IDENTITY_DIFFERENTIATION,
  OPERATION_CLASSES.DEPTH_ACCESS
]));

export const INNER_WORK_OPERATIONS = Object.freeze(new Set([
  OPERATION_CLASSES.BORROWED_CAPACITY,
  OPERATION_CLASSES.LIGHT_REPARENTING,
  OPERATION_CLASSES.TRUST_BEHAVIOR,
  OPERATION_CLASSES.IDENTITY_DIFFERENTIATION,
  OPERATION_CLASSES.DEPTH_ACCESS
]));

export const UNAVAILABLE_RESOURCE_STATES = Object.freeze(new Set([
  "waitlisted",
  "unaffordable",
  "ineligible",
  "geographically_unavailable",
  "unsafe_to_access",
  "blocked_by_guardian_or_authority",
  "unavailable_other"
]));
