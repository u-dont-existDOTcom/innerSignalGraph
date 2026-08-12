export const GUIDE_GRAPH_CONTRACT = "guide-graph-v1";
export const GUIDE_GRAPH_BUNDLE_VERSION = "inner-child-somatic-pilot-2026-08-09-r5";

export const CASE_VARIABLE_ENUMS = Object.freeze({
  present_safety: ["safe", "unsafe", "unknown"],
  orientation: ["oriented", "disoriented", "unknown"],
  ability_to_stop: ["yes", "no", "unknown"],
  ability_to_return: ["yes", "no", "unknown"],
  activation: ["low", "moderate", "high", "unknown"],
  dissociation: ["none", "mild", "high", "unknown"],
  altered_state: ["sober", "altered", "unknown"],
  inner_adult_access: ["available", "partial", "low", "unknown"],
  witness_capacity: ["present", "partial", "absent", "unknown"],
  parent_imagery: ["safe", "critical", "frightening", "blank", "not_used", "unknown"],
  love_access: ["accessible", "limited", "absent", "unknown"],
  self_directed_love: ["safe", "unsafe", "inaccessible", "unknown"],
  solar_plexus_tension: ["present", "absent", "unknown"],
  protective_response: ["present", "absent", "unknown"],
  urge_to_escape: ["present", "absent", "unknown"],
  credibility_conflict: ["present", "absent", "unknown"],
  credibility_evidence_state: ["none", "adverse", "mixed", "positive", "unknown"],
  internal_speaker_relation: ["same", "distinct", "blend", "unresolved", "unknown"],
  age_agency_ambiguity: ["present", "absent", "unknown"],
  resentment_toward_younger_self: ["present", "absent", "unknown"],
  coherent_child_state: ["present", "unclear", "absent", "unknown"],
  identity_blur: ["present", "absent", "unknown"],
  belonging_pressure: ["present", "absent", "unknown"],
  self_criticism: ["present", "absent", "unknown"],
  current_intent: ["conversation", "gentle_practice", "deep_dialogue", "hypnosis", "memory_processing", "photo_work", "altered_state", "integration", "advanced_release", "unknown"],
  memory_source_risk: ["present", "absent", "unknown"],
  forgiveness_interest: ["present", "absent", "unknown"],
  support_available: ["present", "absent", "unknown"],
  body_capacity: ["low", "adequate", "high", "unknown"],
  target_type: ["discrete", "developmental", "diffuse", "none", "unknown"],
  trigger_loop: ["present", "absent", "unknown"],
  freeze_pattern: ["present", "absent", "unknown"],
  discharge_used: ["yes", "no", "unknown"],
  emdr_interest: ["present", "absent", "unknown"],
  advanced_release_interest: ["present", "absent", "unknown"],
  advanced_release_physical_risk: ["present", "absent", "unknown"],
  panic_instability: ["present", "absent", "unknown"],
  bypass_risk: ["present", "absent", "unknown"],
  guide_readiness: ["present", "absent", "unknown"],
  deep_work_readiness: ["yes", "no", "unknown"],
  basic_reparenting_capacity: ["yes", "no", "unknown"],
  stable_for_advanced_release: ["yes", "no", "unknown"]
});

export const CASE_VARIABLE_FIELDS = Object.freeze(Object.keys(CASE_VARIABLE_ENUMS));

export function blankCaseVariables() {
  return Object.fromEntries(CASE_VARIABLE_FIELDS.map((field) => [field, "unknown"]));
}
