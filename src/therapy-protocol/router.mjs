import {
  INNER_PARENT_ONTOLOGY,
  INNER_WORK_OPERATIONS,
  OPERATION_CLASSES,
  OPERATION_CLASS_VALUES,
  OPTIONAL_INNER_OPERATIONS,
  ROUTE_DISPOSITIONS,
  THERAPY_PROTOCOL_VERSION,
  UNAVAILABLE_RESOURCE_STATES
} from "./contract.mjs";
import { deriveProtocolProfile } from "./validate.mjs";

export const THERAPY_PROTOCOL_ROUTER_VERSION = "creative-tail-inner-child-router-v9";

export const GRAPH_NODE_OPERATIONS = Object.freeze({
  "IC.SAFETY_ORIENTATION": OPERATION_CLASSES.PRACTICAL_SAFETY,
  "IC.NEUTRAL_WITNESS": OPERATION_CLASSES.BORROWED_CAPACITY,
  "IC.SOLAR_PLEXUS_RELAXATION": OPERATION_CLASSES.REGULATION,
  "IC.BORROW_LOVE": OPERATION_CLASSES.BORROWED_CAPACITY,
  "IC.BEST_FRIEND_PERSPECTIVE": OPERATION_CLASSES.BORROWED_CAPACITY,
  "IC.BORROW_ONE_FUNCTION": OPERATION_CLASSES.BORROWED_CAPACITY,
  "IC.ADULT_APPRENTICE": OPERATION_CLASSES.BORROWED_CAPACITY,
  "IC.MEET_GUARD": OPERATION_CLASSES.LIGHT_REPARENTING,
  "IC.CREDIBILITY_REPAIR": OPERATION_CLASSES.TRUST_BEHAVIOR,
  "IC.AGE_RESPONSIBILITY_CLARIFICATION": OPERATION_CLASSES.CURRENT_REALITY,
  "IC.PROTECTOR_ACTION": OPERATION_CLASSES.TRUST_BEHAVIOR,
  "IC.GENTLE_SELF_HYPNOSIS": OPERATION_CLASSES.DEPTH_ACCESS,
  "IC.DEEP_CHILD_DIALOGUE": OPERATION_CLASSES.DEPTH_ACCESS,
  "IC.IDENTITY_FORMATION": OPERATION_CLASSES.IDENTITY_DIFFERENTIATION,
  "IC.DIFFERENTIATION": OPERATION_CLASSES.IDENTITY_DIFFERENTIATION,
  "IC.GUIDE_LATER": OPERATION_CLASSES.BORROWED_CAPACITY,
  "IC.PHOTO_EPISTEMIC_CAUTION": OPERATION_CLASSES.DEPTH_ACCESS,
  "IC.ALTERED_STATE_GATE": OPERATION_CLASSES.DEPTH_ACCESS,
  "IC.FORGIVENESS_LATER": OPERATION_CLASSES.TRUST_BEHAVIOR,
  "SOM.SAFETY_STABILIZATION": OPERATION_CLASSES.REGULATION,
  "SOM.GENTLE_REGULATION": OPERATION_CLASSES.REGULATION,
  "SOM.EFT_PORTABLE": OPERATION_CLASSES.REGULATION,
  "SOM.GENTLE_SHAKING": OPERATION_CLASSES.REGULATION,
  "SOM.DISCHARGE_SETTLE_STACK": OPERATION_CLASSES.REGULATION,
  "SOM.RESOURCE_BRAINSPOTTING": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.DEEP_BRAINSPOTTING": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.EMDR_DISCRETE": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.EMDR_DEVELOPMENTAL": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.EMDR_DEVELOPMENTAL_DEFER": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.ADVANCED_RELEASE_BLOCK": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.ADVANCED_RELEASE_OPTIONAL": OPERATION_CLASSES.DEPTH_ACCESS,
  "SOM.BYPASS_AUDIT": OPERATION_CLASSES.REGULATION,
  "SOM.MEANING_INTEGRATION": OPERATION_CLASSES.TRUST_BEHAVIOR
});

const ALL_OPERATIONS = OPERATION_CLASS_VALUES;
const HARD_SAFETY_ALLOWED = new Set([
  OPERATION_CLASSES.SUPPORT_ORIENT,
  OPERATION_CLASSES.PRACTICAL_SAFETY,
  OPERATION_CLASSES.REGULATION,
  OPERATION_CLASSES.CURRENT_REALITY,
  OPERATION_CLASSES.EXTERNAL_HANDOFF
]);
const OUTER_ALLOWED = new Set([
  OPERATION_CLASSES.SUPPORT_ORIENT,
  OPERATION_CLASSES.PRACTICAL_SAFETY,
  OPERATION_CLASSES.REGULATION,
  OPERATION_CLASSES.CURRENT_REALITY,
  OPERATION_CLASSES.HIGH_IMPACT_DECISION,
  OPERATION_CLASSES.EXTERNAL_HANDOFF
]);
const INNER_BASE_ALLOWED = new Set([
  OPERATION_CLASSES.SUPPORT_ORIENT,
  OPERATION_CLASSES.REGULATION,
  OPERATION_CLASSES.CURRENT_REALITY,
  OPERATION_CLASSES.BORROWED_CAPACITY,
  OPERATION_CLASSES.LIGHT_REPARENTING,
  OPERATION_CLASSES.TRUST_BEHAVIOR,
  OPERATION_CLASSES.IDENTITY_DIFFERENTIATION,
  OPERATION_CLASSES.HIGH_IMPACT_DECISION,
  OPERATION_CLASSES.EXTERNAL_HANDOFF
]);

const JOBS = Object.freeze({
  [OPERATION_CLASSES.SUPPORT_ORIENT]: {
    id: "PROTO.O0_SUPPORT_ORIENT",
    title: "Clarify and orient before selecting a therapeutic operation",
    tier: 0,
    priority: 1000,
    recommendations: [
      "Use low-demand support and ask only the material question that changes the next safe operation.",
      "Preserve explicit unknowns rather than inferring state from tone.",
      "Use the person's language before offering framework vocabulary."
    ]
  },
  [OPERATION_CLASSES.PRACTICAL_SAFETY]: {
    id: "PROTO.O1_PRACTICAL_SAFETY",
    title: "Address immediate safety, basic needs, or dependent danger",
    tier: 0,
    priority: 1100,
    recommendations: [
      "Bypass ordinary inner-child operations while the urgent external condition remains active.",
      "Select the smallest actionable real-world safety step and preserve the original concern.",
      "Do not claim a handoff or contact that did not occur."
    ]
  },
  [OPERATION_CLASSES.REGULATION]: {
    id: "PROTO.O2_REGULATION",
    title: "Reduce demand and stabilize without increasing depth",
    tier: 0,
    priority: 900,
    recommendations: [
      "Use present-focused regulation or de-escalation without memory elicitation.",
      "A temporary drop in distress does not establish healing, readiness, or historical truth."
    ]
  },
  [OPERATION_CLASSES.CURRENT_REALITY]: {
    id: "PROTO.O3_CURRENT_REALITY",
    title: "Address current reality before inward formulation",
    tier: 0,
    priority: 950,
    recommendations: [
      "Clarify observable facts, disputed facts, rights, consent, obligations, structural load, physical cost, and available expertise.",
      "Do not translate a medical, practical, relational, capability, grief, or resource problem into an inner-parent deficit.",
      "Use inner work only as an adjunct when it does not replace necessary external action."
    ]
  },
  [OPERATION_CLASSES.BORROWED_CAPACITY]: {
    id: "PROTO.O4_BORROWED_CAPACITY",
    title: "Borrow one bounded quality of the one inner parent",
    tier: 1,
    priority: 800,
    recommendations: [
      "Borrow only the needed nurturing, protecting, or guiding quality while preserving the unity of one inner parent.",
      "Keep the helper's authority bounded and preserve disagreement, alternatives, and handback."
    ]
  },
  [OPERATION_CLASSES.LIGHT_REPARENTING]: {
    id: "PROTO.O5_LIGHT_REPARENTING",
    title: "Use present-focused light reparenting",
    tier: 1,
    priority: 780,
    recommendations: [
      "Keep contact present-focused, voluntary, non-suggestive, and stoppable.",
      "Nurturer, Protector, and Guide are qualities of one parent rather than separate internal agents."
    ]
  },
  [OPERATION_CLASSES.TRUST_BEHAVIOR]: {
    id: "PROTO.O6_TRUST_BEHAVIOR",
    title: "Build trust through observable behavior, promises, and repair",
    tier: 1,
    priority: 760,
    recommendations: [
      "Use concrete predictions and small observable tests rather than verbal persuasion.",
      "After a miss: acknowledge, assess impact, diagnose, resize or renegotiate, repair, and return without punitive arrears."
    ]
  },
  [OPERATION_CLASSES.IDENTITY_DIFFERENTIATION]: {
    id: "PROTO.O7_IDENTITY_DIFFERENTIATION",
    title: "Develop identity through reversible experiments and differentiation",
    tier: 1,
    priority: 740,
    recommendations: [
      "Use low-stakes experiments to discover preferences without declaring one intense feeling the authentic self.",
      "Do not pathologize a stated identity, disability accommodation, privacy limit, sensory need, or clear boundary as avoidance."
    ]
  },
  [OPERATION_CLASSES.DEPTH_ACCESS]: {
    id: "PROTO.O8_DEPTH_ACCESS",
    title: "Gate deliberate depth or altered-state access",
    tier: 2,
    priority: 700,
    recommendations: [
      "Require present consent, sober baseline, stopping and return capacity, provenance discipline, and acceptable integration load.",
      "Track access, intensity, depth, and integration separately.",
      "Meaning may be explored without converting imagery, felt sense, dreams, hypnosis, or altered-state content into historical proof."
    ]
  },
  [OPERATION_CLASSES.HIGH_IMPACT_DECISION]: {
    id: "PROTO.O9_HIGH_IMPACT_DECISION",
    title: "Review a high-impact decision through present-adult reality testing",
    tier: 0,
    priority: 920,
    recommendations: [
      "Separate internal reports from decision authority.",
      "Review facts, provenance, rights, consent, consequences, reversibility, coercion, and appropriate expertise.",
      "Do not infer legal capacity, surrogate authority, or permission for irreversible action from emotional intensity."
    ]
  },
  [OPERATION_CLASSES.EXTERNAL_HANDOFF]: {
    id: "PROTO.O10_EXTERNAL_HANDOFF",
    title: "Establish or revise an actionable external-support path",
    tier: 0,
    priority: 1050,
    recommendations: [
      "Distinguish suggested, reachable, attempted, response received, bridged, unavailable, and failed handoff states.",
      "When the ideal resource is unavailable, name the barrier, use the smallest reachable substitute, state its limits, preserve the unmet need, and define a retry or advocacy trigger.",
      "Do not repeat an inaccessible referral or convert access failure into motivation failure."
    ]
  }
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function acuteSafetyUnknown(unknowns = []) {
  return unknowns.some((item) => Number(item?.importance ?? 0) >= 5
    && /(?:suicid|self[_\s-]?harm|physical[_\s-]?(?:injury|danger|safety)|medical[_\s-]?(?:danger|crisis)|withdrawal|overdose|violence|weapon|(?:child|toddler|dependent)[_\s-].*safety|safe[_\s-]?supervision|ability.*remain.*safe)/i.test(String(item?.variable ?? "")));
}

function rightsContainmentWithoutAcuteDanger(profile, unknowns = []) {
  return profile.primary_problem_class === "actual_or_potential_harm"
    && profile.third_party_rights_or_consent === "present"
    && profile.bodily_decision_owner === "not_applicable"
    && ["reversible_only", "bounded"].includes(profile.action_authority)
    && profile.basic_needs_failure !== "present"
    && profile.condition_instability !== "present"
    && profile.dependent_danger !== "present"
    && !["intoxicated", "withdrawal_possible", "altered"].includes(profile.current_sobriety)
    && !acuteSafetyUnknown(unknowns);
}

function hardSafetyState(profile, variables, unknowns = []) {
  return (profile.current_external_danger === "present" && !rightsContainmentWithoutAcuteDanger(profile, unknowns))
    || profile.basic_needs_failure === "present"
    || profile.condition_instability === "present"
    || profile.dependent_danger === "present"
    || ["intoxicated", "withdrawal_possible", "altered"].includes(profile.current_sobriety)
    || (variables.present_safety === "unsafe" && !rightsContainmentWithoutAcuteDanger(profile, unknowns))
    || variables.orientation === "disoriented"
    || variables.ability_to_stop === "no"
    || variables.ability_to_return === "no"
    || variables.dissociation === "high"
    || variables.altered_state === "altered";
}

function resourceUnavailable(profile) {
  return profile.resource_required === "yes"
    && (UNAVAILABLE_RESOURCE_STATES.has(profile.resource_access_status)
      || profile.handoff_state === "unavailable"
      || profile.handoff_state === "failed");
}

function innerConsentBlocked(profile) {
  return OPTIONAL_INNER_OPERATIONS.has(profile.requested_operation)
    && ["no", "not_now"].includes(profile.operation_consent);
}

function explicitSuicideOrSelfHarmUnknown(unknowns = []) {
  return unknowns.some((item) => Number(item?.importance ?? 0) >= 5
    && /(?:suicid|self[_\s-]?harm)/i.test(String(item?.variable ?? "")));
}

function unresolvedConsequentialDecision(profile, unknowns = []) {
  if (profile.capacity_concern !== "present" || !String(profile.decision_subject ?? "").trim()) return false;
  return unknowns.some((item) => Number(item?.importance ?? 0) >= 5
    && /(?:decision.*(?:impact|consequence|authority|capacity|timing)|(?:financial|legal|basic[_\s-]?needs|dependent).*(?:exposure|impact|risk|decision|authority))/i.test(String(item?.variable ?? "")));
}

function urgentAuthorityDecision(profile) {
  return profile.bodily_decision_owner === "other"
    && ["high_impact_third_party", "hard_to_reverse"].includes(profile.decision_impact)
    && profile.third_party_rights_or_consent === "present"
    && (profile.requested_operation === OPERATION_CLASSES.HIGH_IMPACT_DECISION
      || ["unknown", "disputed"].includes(profile.decision_capacity_status)
      || profile.lawful_decision_maker_status === "disputed"
      || profile.action_authority === "unknown");
}

function supporterSafetyHandoff(profile) {
  return profile.supporter_role_boundary === "at_risk"
    && profile.resource_required === "yes"
    && profile.unmet_external_need === "present"
    && (profile.current_external_danger === "present" || profile.condition_instability === "present");
}

function decisiveOuterOperation(profile, unknowns) {
  if (supporterSafetyHandoff(profile)) return OPERATION_CLASSES.EXTERNAL_HANDOFF;
  if (explicitSuicideOrSelfHarmUnknown(unknowns)) return OPERATION_CLASSES.PRACTICAL_SAFETY;
  if (urgentAuthorityDecision(profile)) return OPERATION_CLASSES.HIGH_IMPACT_DECISION;
  if (unresolvedConsequentialDecision(profile, unknowns)) return OPERATION_CLASSES.HIGH_IMPACT_DECISION;
  if (profile.requested_operation === OPERATION_CLASSES.PRACTICAL_SAFETY
      && !rightsContainmentWithoutAcuteDanger(profile, unknowns)) {
    return OPERATION_CLASSES.PRACTICAL_SAFETY;
  }
  if (profile.requested_operation === OPERATION_CLASSES.EXTERNAL_HANDOFF
      || (profile.resource_required === "yes" && profile.unmet_external_need === "present")) {
    return OPERATION_CLASSES.EXTERNAL_HANDOFF;
  }
  if ((profile.requested_operation === OPERATION_CLASSES.HIGH_IMPACT_DECISION
      || ["high_impact_third_party", "hard_to_reverse"].includes(profile.decision_impact))
      && !rightsContainmentWithoutAcuteDanger(profile, unknowns)) {
    return OPERATION_CLASSES.HIGH_IMPACT_DECISION;
  }
  return null;
}

function depthPrerequisiteUnknowns(profile, variables) {
  const checks = [
    ["present_safety", variables.present_safety],
    ["orientation", variables.orientation],
    ["ability_to_stop", variables.ability_to_stop],
    ["ability_to_return", variables.ability_to_return],
    ["current_sobriety", profile.current_sobriety],
    ["operation_consent", profile.operation_consent],
    ["integration_load", profile.integration_load]
  ];
  return checks.filter(([, value]) => value === "unknown").map(([field]) => field);
}

function routeForProblemClass(profile, ablationVariant = "full") {
  switch (profile.primary_problem_class) {
    case "internal_developmental":
      return { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_PRIMARY, operation: profile.requested_operation === "unknown" ? OPERATION_CLASSES.LIGHT_REPARENTING : profile.requested_operation, runGuideGraph: true };
    case "external_relational_practical":
      return {
        disposition: profile.external_action_required === "no" ? ROUTE_DISPOSITIONS.INNER_CHILD_ADJUNCTIVE : ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT,
        operation: profile.resource_required === "yes"
          ? OPERATION_CLASSES.EXTERNAL_HANDOFF
          : (profile.decision_impact === "high_impact_third_party" || profile.decision_impact === "hard_to_reverse" ? OPERATION_CLASSES.HIGH_IMPACT_DECISION : OPERATION_CLASSES.CURRENT_REALITY),
        runGuideGraph: profile.external_action_required === "no" && profile.resource_required !== "yes"
      };
    case "medical_condition":
      return { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED, operation: profile.resource_required === "yes" ? OPERATION_CLASSES.EXTERNAL_HANDOFF : OPERATION_CLASSES.CURRENT_REALITY, runGuideGraph: false };
    case "capability_skill_scaffold": {
      const operation = ablationVariant === "map15-simple" ? simpleCapabilityRoute(profile) : OPERATION_CLASSES.CURRENT_REALITY;
      const inner = operation === OPERATION_CLASSES.LIGHT_REPARENTING;
      return {
        disposition: inner ? ROUTE_DISPOSITIONS.INNER_CHILD_PRIMARY : ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT,
        operation,
        runGuideGraph: inner
      };
    }
    case "refusal_capacity_ambivalence": {
      const operation = ["production", "map16-simple"].includes(ablationVariant) ? simpleSupportedChoiceRoute(profile) : OPERATION_CLASSES.HIGH_IMPACT_DECISION;
      return { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT, operation, runGuideGraph: false };
    }
    case "grief_transition":
    case "certainty_reality_uncertainty":
    case "actual_or_potential_harm":
    case "large_portfolio":
      return { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT, operation: OPERATION_CLASSES.CURRENT_REALITY, runGuideGraph: false };
    case "danger_basic_needs":
      return { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED, operation: OPERATION_CLASSES.PRACTICAL_SAFETY, runGuideGraph: false };
    case "mixed":
    case "unknown":
    default:
      return { disposition: ROUTE_DISPOSITIONS.INSUFFICIENT_INFORMATION, operation: OPERATION_CLASSES.SUPPORT_ORIENT, runGuideGraph: false };
  }
}

function graphNodeOperation(node = {}) {
  const operation = node.operationClass ?? GRAPH_NODE_OPERATIONS[node.id];
  if (node.operationClass && !OPERATION_CLASS_VALUES.includes(node.operationClass)) {
    throw new Error(`Graph node ${node.id ?? "<missing>"} declares invalid operationClass ${node.operationClass}.`);
  }
  if (!operation) throw new Error(`No explicit therapy-protocol operation mapping exists for graph node ${node.id ?? "<missing>"}.`);
  return operation;
}

function blockedOperationRecords(allowed, reasons = {}) {
  return ALL_OPERATIONS
    .filter((operation) => !allowed.has(operation))
    .map((operation) => ({ operation, reason: reasons[operation] ?? "Not permitted by the current protocol state." }));
}

function materialUnknowns(profile, explicit, route) {
  const unknowns = [];
  if (explicit && profile.request_actor === "unknown") unknowns.push("request_actor");
  if (explicit && profile.primary_problem_class === "unknown") unknowns.push("primary_problem_class");
  if (profile.resource_required === "yes" && profile.resource_access_status === "unknown") unknowns.push("resource_access_status");
  if (route.operation === OPERATION_CLASSES.HIGH_IMPACT_DECISION) {
    if (profile.decision_impact === "unknown") unknowns.push("decision_impact");
    if (profile.third_party_rights_or_consent === "unknown") unknowns.push("third_party_rights_or_consent");
    if (profile.action_authority === "unknown") unknowns.push("action_authority");
    if (profile.lawful_decision_maker_status === "unknown") unknowns.push("lawful_decision_maker_status");
    if (profile.decision_capacity_status === "unknown") unknowns.push("decision_capacity_status");
  }
  return unique(unknowns);
}

function routeNuance(profile, resourceIsUnavailable, operation) {
  const nuance = [
    "Nurturing, protecting, and guiding are qualities of one inner parent, not three autonomous internal people.",
    "Current external reality, rights, consent, medical facts, and material constraints cannot be settled by an inner-state vote."
  ];
  const forbidden = [
    "Do not reify Nurturer, Protector, and Guide as three separate inner parents.",
    "Do not infer historical truth, legal capacity, surrogate authority, diagnosis, or service availability from conversational tone."
  ];
  if (profile.insight_present === "yes" && ["absent", "partial", "unknown"].includes(profile.behavioral_control)) {
    nuance.push("The person may understand the pattern while lacking inhibitory control, a rehearsed alternative, or contextual generalization; repeating the explanation is not the intervention.");
    forbidden.push("Do not treat insight or witness capacity as proof of behavioral control.");
  }
  if (profile.skill_or_instruction_deficit === "present") {
    nuance.push("Missing instruction, education, practice, or accessibility support is not a missing Guide quality.");
    forbidden.push("Do not moralize a skill or access deficit as immaturity or absent inner adulthood.");
  }
  if (["changed", "lost"].includes(profile.scaffold_status)) {
    nuance.push("Identify what the external scaffold supplied and preserve internalized components; loss of performance does not prove failed internalization.");
  }
  if (profile.change_target_endorsement === "mixed" || profile.change_target_endorsement === "not_endorsed") {
    nuance.push("Keep the person's own goal, minimum safety, harm reduction, full change, provider conditions, and third-party safety distinct.");
    forbidden.push("Do not equate treatment ambivalence with incapacity or resistance.");
  }
  if (profile.decision_capacity_status === "unknown" || profile.decision_capacity_status === "presumed") {
    forbidden.push("Do not certify incapacity or appoint a surrogate; material concern routes to supported decision-making and qualified decision-specific review.");
  }
  if (profile.source_class === "felt_sense") {
    nuance.push("Felt sense may carry meaningful knowledge that conditioning obscured while remaining insufficient by itself as historical proof.");
  }
  if (profile.source_class !== "unknown" && profile.source_class !== "not_applicable") {
    nuance.push("Preserve source class separately from factual confidence, personal meaning, and action authority.");
  }
  if (resourceIsUnavailable) {
    nuance.push("The ideal resource is not currently reachable; use a constraint-aware fallback while preserving the unresolved external need and retry trigger.");
    forbidden.push("Do not repeat the same inaccessible referral, call a weaker substitute equivalent, or close the unmet need because coping improved.");
  }
  if (operation === OPERATION_CLASSES.HIGH_IMPACT_DECISION
      && (profile.current_external_danger === "present" || profile.condition_instability === "present")) {
    nuance.push("Keep urgent medical reassessment and immediate condition-specific safety action in the response while decision authority, consent, and capacity are reviewed.");
    forbidden.push("Do not let decision-authority review replace urgent medical reassessment or delay immediate condition-specific safety action.");
  }
  if (profile.user_rejects_current_frame === "yes") {
    nuance.push("The user rejected the current formulation; withdraw or revise it and reopen ordinary alternatives.");
    forbidden.push("Do not treat frame rejection as confirmation of a Protector or resistance hypothesis.");
  }
  if (profile.adverse_trajectory !== "none" && profile.adverse_trajectory !== "unknown") {
    nuance.push(`A longitudinal vulnerability-amplifying pattern is active: ${profile.adverse_trajectory}. Change the contributing operation rather than optimizing its wording.`);
  }
  if (profile.adverse_trajectory === "failure_debt_loop") {
    nuance.push("A missed promise creates a repair and resizing obligation, not punitive care arrears or proof that care must be withheld.");
    forbidden.push("Do not accumulate missed nurturing acts as debt, demand repayment, or erase external restitution owed to another person.");
  }
  if (profile.adverse_trajectory === "dependency_loop") {
    nuance.push("Reduce concentration of authority in the bot or helper; preserve alternatives, disagreement, human relationships, and deliberate handback.");
  }
  if (profile.supporter_role_boundary === "at_risk"
      && profile.dependent_danger === "unknown"
      && profile.physical_cost === "high") {
    nuance.push("Directly check both the caregiver's immediate safety and whether exhaustion is compromising the dependent person's essential care; do not infer either risk from exhaustion alone.");
  }
  return { nuance: unique(nuance), forbidden: unique(forbidden) };
}

export function routeTherapyProtocol({ protocolProfile = null, variables = {}, unknowns = [], ablationVariant = "production" } = {}) {
  if (!["production", "full", "map15-simple", "map16-simple"].includes(ablationVariant)) {
    throw new Error(`Unknown therapy-protocol ablation variant ${ablationVariant}.`);
  }
  const { profile, explicit } = deriveProtocolProfile({ protocolProfile, variables });
  const hardSafety = hardSafetyState(profile, variables, unknowns);
  const unavailable = resourceUnavailable(profile);
  const supporterHandoff = supporterSafetyHandoff(profile);
  const outerOperation = decisiveOuterOperation(profile, unknowns);
  const authorityDecision = urgentAuthorityDecision(profile);
  let route = routeForProblemClass(profile, ablationVariant);
  let allowed = new Set(route.runGuideGraph ? INNER_BASE_ALLOWED : OUTER_ALLOWED);
  const reasons = {};
  let requestedDepthUnknowns = [];

  if (profile.request_actor !== "self" && profile.beneficiary_present !== "yes" && !outerOperation) {
    route = {
      disposition: ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT,
      operation: profile.resource_required === "yes" ? OPERATION_CLASSES.EXTERNAL_HANDOFF : OPERATION_CLASSES.CURRENT_REALITY,
      runGuideGraph: false
    };
    allowed = new Set(OUTER_ALLOWED);
    for (const operation of INNER_WORK_OPERATIONS) reasons[operation] = "The person whose internal state would be treated is not the participating user.";
  }

  if (outerOperation) {
    route = {
      disposition: outerOperation === OPERATION_CLASSES.PRACTICAL_SAFETY
        ? ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED
        : ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT,
      operation: outerOperation,
      runGuideGraph: false
    };
    allowed = new Set(outerOperation === OPERATION_CLASSES.PRACTICAL_SAFETY ? HARD_SAFETY_ALLOWED : OUTER_ALLOWED);
    if (profile.request_actor !== "self" && profile.beneficiary_present !== "yes") {
      for (const operation of INNER_WORK_OPERATIONS) reasons[operation] = "The person whose internal state would be treated is not the participating user.";
    }
  }

  if (hardSafety) {
    route = {
      disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED,
      operation: supporterHandoff
        ? OPERATION_CLASSES.EXTERNAL_HANDOFF
        : (authorityDecision || outerOperation === OPERATION_CLASSES.HIGH_IMPACT_DECISION
          ? OPERATION_CLASSES.HIGH_IMPACT_DECISION
          : (outerOperation === OPERATION_CLASSES.PRACTICAL_SAFETY || profile.resource_required !== "yes"
          ? OPERATION_CLASSES.PRACTICAL_SAFETY
          : OPERATION_CLASSES.EXTERNAL_HANDOFF)),
      runGuideGraph: false
    };
    allowed = new Set(route.operation === OPERATION_CLASSES.HIGH_IMPACT_DECISION ? OUTER_ALLOWED : HARD_SAFETY_ALLOWED);
    for (const operation of INNER_WORK_OPERATIONS) reasons[operation] = "Immediate safety, basic needs, condition-specific instability, or dependent danger outranks ordinary inner work.";
  }

  if (unavailable && !authorityDecision && outerOperation !== OPERATION_CLASSES.PRACTICAL_SAFETY) {
    route = {
      disposition: hardSafety ? ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED : ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT,
      operation: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      runGuideGraph: false
    };
    allowed = new Set(HARD_SAFETY_ALLOWED);
  }

  if (!hardSafety && !unavailable && !outerOperation && profile.consent_scope === "all_engagement" && ["no", "not_now"].includes(profile.operation_consent)) {
    route = { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED, operation: OPERATION_CLASSES.SUPPORT_ORIENT, runGuideGraph: false };
    allowed = new Set([OPERATION_CLASSES.SUPPORT_ORIENT, OPERATION_CLASSES.PRACTICAL_SAFETY, OPERATION_CLASSES.EXTERNAL_HANDOFF]);
  } else if (innerConsentBlocked(profile)) {
    allowed.delete(profile.requested_operation);
    reasons[profile.requested_operation] = "The user declined this optional inward operation; no automatic retry debt is created.";
    if (route.operation === profile.requested_operation) {
      route = { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED, operation: OPERATION_CLASSES.SUPPORT_ORIENT, runGuideGraph: false };
    }
  }

  if (profile.requested_operation === OPERATION_CLASSES.DEPTH_ACCESS) {
    const missingDepth = depthPrerequisiteUnknowns(profile, variables);
    requestedDepthUnknowns = missingDepth;
    const depthUnsafe = hardSafety
      || variables.present_safety !== "safe"
      || variables.orientation !== "oriented"
      || variables.ability_to_stop !== "yes"
      || variables.ability_to_return !== "yes"
      || profile.current_sobriety !== "sober"
      || profile.integration_load === "high"
      || profile.historical_provenance_stable !== "yes"
      || profile.operation_consent !== "yes";
    if (missingDepth.length || depthUnsafe) {
      allowed.delete(OPERATION_CLASSES.DEPTH_ACCESS);
      reasons[OPERATION_CLASSES.DEPTH_ACCESS] = missingDepth.length
        ? `Depth prerequisites remain unknown: ${missingDepth.join(", ")}.`
        : "Depth access is not permitted in the current operation-specific state.";
      if (route.operation === OPERATION_CLASSES.DEPTH_ACCESS) {
        route = {
          disposition: missingDepth.length ? ROUTE_DISPOSITIONS.INSUFFICIENT_INFORMATION : ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED,
          operation: missingDepth.length ? OPERATION_CLASSES.SUPPORT_ORIENT : OPERATION_CLASSES.REGULATION,
          runGuideGraph: false
        };
      }
    } else {
      allowed.add(OPERATION_CLASSES.DEPTH_ACCESS);
    }
  }

  if (!hardSafety && !unavailable && !outerOperation && profile.user_rejects_current_frame === "yes") {
    route = { disposition: ROUTE_DISPOSITIONS.INNER_CHILD_DEFERRED, operation: OPERATION_CLASSES.SUPPORT_ORIENT, runGuideGraph: false };
    allowed = new Set([OPERATION_CLASSES.SUPPORT_ORIENT, OPERATION_CLASSES.PRACTICAL_SAFETY, OPERATION_CLASSES.CURRENT_REALITY, OPERATION_CLASSES.EXTERNAL_HANDOFF]);
  }

  if (!hardSafety && !unavailable && !outerOperation) {
    const redirect = {
      reassurance_loop: OPERATION_CLASSES.CURRENT_REALITY,
      dependency_loop: OPERATION_CLASSES.CURRENT_REALITY,
      memory_certainty_loop: OPERATION_CLASSES.CURRENT_REALITY,
      parts_reification_loop: OPERATION_CLASSES.SUPPORT_ORIENT,
      coercive_growth_loop: OPERATION_CLASSES.SUPPORT_ORIENT,
      intensity_chasing_loop: OPERATION_CLASSES.REGULATION,
      model_sealing_loop: OPERATION_CLASSES.SUPPORT_ORIENT,
      repeated_unavailable_referral: OPERATION_CLASSES.EXTERNAL_HANDOFF,
      failure_debt_loop: OPERATION_CLASSES.TRUST_BEHAVIOR
    }[profile.adverse_trajectory];
    if (redirect) {
      const inner = redirect === OPERATION_CLASSES.TRUST_BEHAVIOR;
      route = {
        disposition: inner ? ROUTE_DISPOSITIONS.INNER_CHILD_ADJUNCTIVE : ROUTE_DISPOSITIONS.INNER_CHILD_NOT_RELEVANT,
        operation: redirect,
        runGuideGraph: inner
      };
      allowed = new Set(inner ? INNER_BASE_ALLOWED : OUTER_ALLOWED);
    }
  }

  const routeUnknowns = unique([
    ...materialUnknowns(profile, explicit, route),
    ...requestedDepthUnknowns,
    ...unknowns.filter((item) => Number(item?.importance ?? 0) >= 5).map((item) => item.variable).filter(Boolean)
  ]);
  if (routeUnknowns.length && route.disposition === ROUTE_DISPOSITIONS.INNER_CHILD_PRIMARY && explicit) {
    route = { disposition: ROUTE_DISPOSITIONS.INSUFFICIENT_INFORMATION, operation: OPERATION_CLASSES.SUPPORT_ORIENT, runGuideGraph: false };
  }

  if (!route.runGuideGraph) {
    for (const operation of INNER_WORK_OPERATIONS) {
      if (operation !== route.operation) allowed.delete(operation);
    }
  }
  allowed.add(OPERATION_CLASSES.SUPPORT_ORIENT);
  allowed.add(route.operation);

  const { nuance, forbidden } = routeNuance(profile, unavailable, route.operation);
  const job = JOBS[route.operation] ?? JOBS[OPERATION_CLASSES.SUPPORT_ORIENT];
  const resourceState = {
    required: profile.resource_required,
    requiredResource: profile.required_external_resource,
    accessStatus: profile.resource_access_status,
    accessBarrier: profile.access_barrier,
    handoffState: profile.handoff_state,
    fallbackAvailable: profile.fallback_available,
    fallbackAction: profile.fallback_action,
    fallbackLimit: profile.fallback_limit,
    unmetNeed: profile.unmet_external_need,
    unmetNeedDetail: profile.unmet_external_need_detail,
    retryOrAdvocacyTrigger: profile.retry_or_advocacy_trigger,
    unresolved: profile.unmet_external_need === "present" || unavailable
  };

  return {
    contractVersion: THERAPY_PROTOCOL_VERSION,
    routerVersion: THERAPY_PROTOCOL_ROUTER_VERSION,
    ablationVariant,
    ontology: INNER_PARENT_ONTOLOGY,
    compatibilityMode: !explicit,
    profile,
    disposition: route.disposition,
    primaryOperation: route.operation,
    runGuideGraph: route.runGuideGraph,
    allowedOperations: ALL_OPERATIONS.filter((operation) => allowed.has(operation)),
    blockedOperations: blockedOperationRecords(allowed, reasons),
    materialUnknowns: routeUnknowns,
    protocolJob: { ...job, recommendations: [...job.recommendations] },
    requiredNuance: nuance,
    forbiddenOverclaims: forbidden,
    resourceState,
    graphNodeAllowed(node) {
      return allowed.has(graphNodeOperation(node));
    },
    graphNodeOperation
  };
}

export function simpleCapabilityRoute(profile = {}) {
  if (profile.skill_or_instruction_deficit === "present") return OPERATION_CLASSES.CURRENT_REALITY;
  if (["changed", "lost"].includes(profile.scaffold_status)) return OPERATION_CLASSES.CURRENT_REALITY;
  if (profile.insight_present === "yes" && profile.behavioral_control !== "available") return OPERATION_CLASSES.CURRENT_REALITY;
  return OPERATION_CLASSES.LIGHT_REPARENTING;
}

export function simpleSupportedChoiceRoute(profile = {}) {
  if (profile.current_external_danger === "present" || profile.condition_instability === "present" || profile.dependent_danger === "present") {
    return OPERATION_CLASSES.PRACTICAL_SAFETY;
  }
  if (profile.capacity_concern === "present" || profile.decision_impact === "high_impact_third_party" || profile.decision_impact === "hard_to_reverse") {
    return OPERATION_CLASSES.HIGH_IMPACT_DECISION;
  }
  if (profile.request_actor !== "self") return OPERATION_CLASSES.CURRENT_REALITY;
  return OPERATION_CLASSES.CURRENT_REALITY;
}
