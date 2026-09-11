import { checkBoundedSchema } from "./bounded-schema.mjs";
import { ValidationError } from "../core/errors.mjs";

export const DEVELOPMENTAL_PREREQUISITE_VIOLATION = "DEVELOPMENTAL_PREREQUISITE_VIOLATION";

export const DEVELOPMENTAL_CAPACITY_STATUSES = Object.freeze([
  "UNKNOWN",
  "ABSENT_OR_INACCESSIBLE",
  "PARTIAL_INTERMITTENT_STATE_DEPENDENT",
  "AVAILABLE",
  "AVAILABLE_LOW_CREDIBILITY",
  "INCREASINGLY_RELIABLE_CREDIBLE"
]);

export const DEVELOPMENTAL_FUNCTIONS = Object.freeze([
  "NOTICING",
  "STAYING_PRESENT",
  "CARING",
  "SOOTHING",
  "PROTECTING",
  "ORIENTING",
  "DECIDING",
  "GUIDING",
  "TOLERATING_AFFECT",
  "FOLLOWING_THROUGH",
  "REPAIRING_AFTER_A_MISS"
]);

const FUNCTION_ACCESS = Object.freeze(["UNKNOWN", "ABSENT_OR_INACCESSIBLE", "PARTIAL", "AVAILABLE"]);
const ACCESS = Object.freeze(["UNKNOWN", "ABSENT_OR_INACCESSIBLE", "PARTIAL", "STATE_DEPENDENT", "AVAILABLE"]);
const RELIABILITY = Object.freeze(["UNKNOWN", "ABSENT", "STATE_DEPENDENT", "INTERMITTENT", "RELIABLE"]);
const TRUST = Object.freeze(["UNKNOWN", "UNTESTED", "LOW", "GROWING", "ESTABLISHED"]);
const APPROACHES = Object.freeze(["INNER_CHILD", "REPARENTING", "SELF_LOVE"]);
const HELPFULNESS = Object.freeze(["UNKNOWN", "NOT_HELPFUL", "NO_SUCCESSFUL_EXCEPTION", "HELPS_SOMETIMES", "RELIABLY_HELPFUL"]);
const CONSISTENCY = Object.freeze(["UNKNOWN", "DIFFICULT_OR_INCONSISTENT", "STEADY"]);
const INQUIRY_STATE = Object.freeze(["UNRESOLVED", "ESTABLISHED", "NOT_NEEDED"]);
const PAIR_TOLERANCE = Object.freeze(["YES", "NO", "UNKNOWN"]);
const QUESTION_ORDER = Object.freeze(["SUCCESS_FIRST", "BREAKDOWN_FIRST", "CONTEXT_UNRESOLVED"]);

const choice = values => ({ type: "string", enum: values });
const text = { type: "string", minLength: 1, maxLength: 1600 };
const ids = { type: "array", maxItems: 24, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 160 } };
const record = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const nullable = schema => ({ anyOf: [{ type: "null" }, schema] });

export const developmentalCapacitySchema = nullable(record({
  issue: text,
  language_mode: choice(["FUNCTIONAL", "CLIENT_PARTS_LANGUAGE"]),
  status: choice(DEVELOPMENTAL_CAPACITY_STATUSES),
  access: choice(ACCESS),
  reliability: choice(RELIABILITY),
  younger_state_trust: choice(TRUST),
  observation_ids: ids,
  practice: nullable(record({
    approaches: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: choice(APPROACHES) },
    helpfulness: choice(HELPFULNESS),
    consistency: choice(CONSISTENCY),
    observation_ids: ids
  })),
  contrast: nullable(record({
    successful_exception: choice(INQUIRY_STATE),
    breakdown_state: choice(INQUIRY_STATE),
    pair_tolerated: choice(PAIR_TOLERANCE),
    preferred_order: choice(QUESTION_ORDER),
    observation_ids: ids
  })),
  functions: {
    type: "array",
    maxItems: DEVELOPMENTAL_FUNCTIONS.length,
    items: record({
      kind: choice(DEVELOPMENTAL_FUNCTIONS),
      access: choice(FUNCTION_ACCESS),
      observation_ids: ids
    })
  }
}));

export const questionEligibilityFindingSchema = record({
  variable: { type: "string", minLength: 1, maxLength: 160 },
  code: choice([DEVELOPMENTAL_PREREQUISITE_VIOLATION]),
  presupposed_functions: { type: "array", minItems: 1, maxItems: DEVELOPMENTAL_FUNCTIONS.length, uniqueItems: true, items: choice(DEVELOPMENTAL_FUNCTIONS) },
  observation_ids: ids
});

export function validateQuestionEligibilityFindings(value, { observationIds = null } = {}) {
  if (!Array.isArray(value) || value.length > 24) throw new ValidationError("Question eligibility findings must be a bounded array.");
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    checkBoundedSchema(item, questionEligibilityFindingSchema, `question_eligibility_findings[${index}]`);
    if (seen.has(item.variable)) throw new ValidationError(`Duplicate question eligibility finding for ${item.variable}.`);
    seen.add(item.variable);
    if (observationIds) requireReferences(item.observation_ids, observationIds, { label: `Question eligibility finding ${item.variable}` });
  }
  return structuredClone(value);
}

function requireReferences(values, observationIds, { required = false, label = "developmental capacity" } = {}) {
  if ((required && !values.length) || values.some(id => !observationIds.has(id))) {
    throw new ValidationError(`${label} requires current direct-observation references.`);
  }
}

function statusIsConsistent(value) {
  if (value.status === "UNKNOWN") return value.access === "UNKNOWN" && value.reliability === "UNKNOWN";
  if (value.status === "ABSENT_OR_INACCESSIBLE") {
    return value.access === "ABSENT_OR_INACCESSIBLE" && ["ABSENT", "UNKNOWN"].includes(value.reliability);
  }
  if (value.status === "PARTIAL_INTERMITTENT_STATE_DEPENDENT") {
    return ["PARTIAL", "STATE_DEPENDENT"].includes(value.access)
      || ["STATE_DEPENDENT", "INTERMITTENT"].includes(value.reliability);
  }
  if (value.status === "AVAILABLE") {
    return value.access === "AVAILABLE" && value.reliability === "RELIABLE"
      && ["UNKNOWN", "UNTESTED"].includes(value.younger_state_trust);
  }
  if (value.status === "AVAILABLE_LOW_CREDIBILITY") {
    return value.access === "AVAILABLE" && value.reliability === "RELIABLE" && value.younger_state_trust === "LOW";
  }
  return value.status === "INCREASINGLY_RELIABLE_CREDIBLE"
    && value.access === "AVAILABLE" && value.reliability === "RELIABLE"
    && ["GROWING", "ESTABLISHED"].includes(value.younger_state_trust);
}

export function developmentalCapacityObservationIds(value) {
  if (!value) return [];
  return [...new Set([
    ...value.observation_ids,
    ...(value.practice?.observation_ids ?? []),
    ...(value.contrast?.observation_ids ?? []),
    ...value.functions.flatMap(item => item.observation_ids)
  ])];
}

export function validateDevelopmentalCapacity(value, { issue, observationIds = new Set() } = {}) {
  if (value == null) return null;
  checkBoundedSchema(value, developmentalCapacitySchema.anyOf[1], "developmental_capacity");
  if (issue != null && value.issue !== issue) throw new ValidationError("Developmental capacity must be bound to the current issue.");
  if (!statusIsConsistent(value)) throw new ValidationError("Developmental capacity status is inconsistent with access, reliability, or trust evidence.");
  const knownState = value.status !== "UNKNOWN" || value.access !== "UNKNOWN" || value.reliability !== "UNKNOWN" || value.younger_state_trust !== "UNKNOWN";
  requireReferences(value.observation_ids, observationIds, { required: knownState, label: "Developmental capacity state" });
  if (value.practice) {
    const knownPractice = value.practice.helpfulness !== "UNKNOWN" || value.practice.consistency !== "UNKNOWN";
    requireReferences(value.practice.observation_ids, observationIds, { required: knownPractice, label: "Developmental practice" });
  }
  if (value.contrast) {
    const knownContrast = value.contrast.successful_exception !== "UNRESOLVED"
      || value.contrast.breakdown_state !== "UNRESOLVED"
      || value.contrast.pair_tolerated !== "UNKNOWN"
      || value.contrast.preferred_order !== "CONTEXT_UNRESOLVED";
    requireReferences(value.contrast.observation_ids, observationIds, { required: knownContrast, label: "Developmental contrast selection" });
  }
  const seen = new Set();
  for (const item of value.functions) {
    if (seen.has(item.kind)) throw new ValidationError(`Duplicate developmental function ${item.kind}.`);
    seen.add(item.kind);
    requireReferences(item.observation_ids, observationIds, {
      required: item.access !== "UNKNOWN",
      label: `Developmental function ${item.kind}`
    });
  }
  requireReferences(developmentalCapacityObservationIds(value), observationIds, { label: "Developmental capacity" });
  return structuredClone(value);
}

function roleDeficits(value) {
  const roles = {
    NURTURER: new Set(["STAYING_PRESENT", "CARING", "SOOTHING"]),
    PROTECTOR: new Set(["PROTECTING"]),
    LEADER: new Set(["ORIENTING", "DECIDING", "GUIDING"])
  };
  const deficient = new Set();
  for (const item of value.functions) {
    // Partial access is an access/generalization problem, not proof that the
    // whole role is missing. Reserve role-specific deficit routing for absence.
    if (item.access !== "ABSENT_OR_INACCESSIBLE") continue;
    for (const [role, kinds] of Object.entries(roles)) if (kinds.has(item.kind)) deficient.add(role);
  }
  return [...deficient];
}

function developmentalQuestionSelection(value) {
  const practice = value.practice;
  const mixedPractice = practice?.approaches.length > 0
    && ["HELPS_SOMETIMES", "RELIABLY_HELPFUL"].includes(practice.helpfulness)
    && practice.consistency === "DIFFICULT_OR_INCONSISTENT"
    && value.reliability !== "RELIABLE";
  if (!mixedPractice) return { mode: "none", questions: [], order: [] };
  const contrast = value.contrast;
  // Without explicit contrast state, prefer the single successful-exception
  // inquiry; never manufacture a mandatory pair from a global template.
  if (!contrast) return {
    mode: "single",
    questions: [DEVELOPMENTAL_SUCCESS_QUESTION],
    order: ["successful-exception"]
  };
  const successNeeded = contrast.successful_exception === "UNRESOLVED";
  const breakdownNeeded = contrast.breakdown_state === "UNRESOLVED";
  const preferred = contrast.preferred_order === "BREAKDOWN_FIRST" ? "breakdown-under-distress" : "successful-exception";
  if (successNeeded && breakdownNeeded && contrast.pair_tolerated === "YES") {
    const order = preferred === "breakdown-under-distress"
      ? ["breakdown-under-distress", "successful-exception"]
      : ["successful-exception", "breakdown-under-distress"];
    const byKind = {
      "successful-exception": DEVELOPMENTAL_SUCCESS_QUESTION,
      "breakdown-under-distress": DEVELOPMENTAL_BREAKDOWN_QUESTION
    };
    return { mode: "pair", order, questions: order.map(kind => byKind[kind]) };
  }
  if (successNeeded && breakdownNeeded) {
    return preferred === "breakdown-under-distress"
      ? { mode: "single", questions: [DEVELOPMENTAL_BREAKDOWN_QUESTION], order: [preferred] }
      : { mode: "single", questions: [DEVELOPMENTAL_SUCCESS_QUESTION], order: [preferred] };
  }
  if (successNeeded) return { mode: "single", questions: [DEVELOPMENTAL_SUCCESS_QUESTION], order: ["successful-exception"] };
  if (breakdownNeeded) return { mode: "single", questions: [DEVELOPMENTAL_BREAKDOWN_QUESTION], order: ["breakdown-under-distress"] };
  return { mode: "none", questions: [], order: [] };
}

const commonGuidance = [
  "Treat Adult, inner parent, Nurturer, Protector, Leader and Guide as functional role labels, not proof that a coherent internal entity already exists.",
  "Reason from observable functions such as noticing, staying present, caring, soothing, protecting, orienting, deciding, guiding, tolerating affect, following through and repairing after a miss.",
  "Use the client's own parts language when it helps, but do not impose literal parts or infer capacity from vocabulary alone."
];

export function developmentalCapacityDecision(value) {
  if (!value) return null;
  const deficits = roleDeficits(value);
  const questionSelection = developmentalQuestionSelection(value);
  let route;
  let recommendedNodeId;
  const guidance = [...commonGuidance];

  if (questionSelection.mode === "pair") {
    route = "PAIRED_SUCCESS_BREAKDOWN_ASSESSMENT";
    recommendedNodeId = "IC.DEVELOPMENTAL_CAPACITY_CONTRAST";
    guidance.push(`Use one paired comparison in the same reply in the evidence-selected order (${questionSelection.order.join(" then ")}). The pair is one discriminating therapeutic comparison and overrides generic one-question minimization because both sides remain action-changing.`);
  } else if (questionSelection.mode === "single") {
    route = questionSelection.order[0] === "breakdown-under-distress"
      ? "ASSESS_BREAKDOWN_STATE" : "ASSESS_SUCCESSFUL_EXCEPTION";
    recommendedNodeId = "IC.DEVELOPMENTAL_CAPACITY_CONTRAST";
    guidance.push("Ask only the unresolved side of the developmental contrast; do not add the other question merely to complete a template.");
  } else if (value.status === "ABSENT_OR_INACCESSIBLE") {
    route = "BOOTSTRAP_SCAFFOLD";
    recommendedNodeId = "IC.BORROW_ONE_FUNCTION";
    guidance.push("Use temporary external modeling or scaffolding only to instantiate one small internal capacity; keep judgment returnable and move toward internal capacity rather than dependence.");
  } else if (value.status === "AVAILABLE_LOW_CREDIBILITY") {
    route = "CREDIBILITY_FOLLOW_THROUGH";
    recommendedNodeId = "IC.CREDIBILITY_REPAIR";
    guidance.push("The function is available but not yet credible to the younger state. Use small observable action, follow-through and repair after misses rather than another promise.");
  } else if (deficits.length === 1 && deficits[0] === "NURTURER") {
    route = "STRENGTHEN_NURTURER_NON_ABANDONMENT";
    recommendedNodeId = "IC.BORROW_LOVE";
    guidance.push("Strengthen caring, soothing and non-abandonment under load; do not substitute a fixed role hierarchy for the observed missing function.");
  } else if (deficits.length === 1 && deficits[0] === "PROTECTOR") {
    route = "STRENGTHEN_PROTECTOR";
    recommendedNodeId = "IC.PROTECTOR_ACTION";
    guidance.push("Strengthen protection and boundary action because that is the observed missing function.");
  } else if (deficits.length === 1 && deficits[0] === "LEADER") {
    route = "STRENGTHEN_LEADER_GUIDE";
    recommendedNodeId = "IC.GUIDE_LATER";
    guidance.push("Strengthen orienting, deciding and guiding under load because soothing or protection alone does not supply direction.");
  } else if (value.status === "PARTIAL_INTERMITTENT_STATE_DEPENDENT") {
    route = "STRENGTHEN_ACCESS_GENERALIZATION";
    recommendedNodeId = "IC.ADULT_APPRENTICE";
    guidance.push("Capacity exists in some states but disappears under load. Strengthen access and generalization rather than treating the function as absent or prematurely framing the problem as distrust.");
  } else if (["AVAILABLE", "INCREASINGLY_RELIABLE_CREDIBLE"].includes(value.status)) {
    route = "ROLE_SPECIFIC_ACTION_ALLOWED";
    recommendedNodeId = null;
    guidance.push("Current evidence establishes enough reliable capacity for a supported role-specific action; do not repeat a generic availability question.");
  } else {
    route = "ASSESS_DEVELOPMENTAL_PREREQUISITES";
    recommendedNodeId = "IC.DEVELOPMENTAL_CAPACITY_CONTRAST";
    guidance.push("Capacity remains unknown. Establish what currently happens toward the self and which functions remain accessible before assigning Adult action.");
  }

  return {
    version: 1,
    route,
    recommendedNodeId,
    status: value.status,
    languageMode: value.language_mode,
    deficits,
    requiresCapacityQuestion: ["PAIRED_SUCCESS_BREAKDOWN_ASSESSMENT", "ASSESS_SUCCESSFUL_EXCEPTION", "ASSESS_BREAKDOWN_STATE", "ASSESS_DEVELOPMENTAL_PREREQUISITES"].includes(route),
    pairedContrastRequired: route === "PAIRED_SUCCESS_BREAKDOWN_ASSESSMENT",
    questionMode: questionSelection.mode === "none" && route === "ASSESS_DEVELOPMENTAL_PREREQUISITES" ? "single" : questionSelection.mode,
    questions: questionSelection.mode === "none" && route === "ASSESS_DEVELOPMENTAL_PREREQUISITES"
      ? [DEVELOPMENTAL_BREAKDOWN_QUESTION] : questionSelection.questions,
    questionOrder: questionSelection.mode === "none" && route === "ASSESS_DEVELOPMENTAL_PREREQUISITES"
      ? ["breakdown-under-distress"] : questionSelection.order,
    observationIds: developmentalCapacityObservationIds(value),
    guidance
  };
}

const statusVariable = Object.freeze({
  UNKNOWN: "unknown",
  ABSENT_OR_INACCESSIBLE: "absent_inaccessible",
  PARTIAL_INTERMITTENT_STATE_DEPENDENT: "partial_intermittent_state_dependent",
  AVAILABLE: "available",
  AVAILABLE_LOW_CREDIBILITY: "available_low_credibility",
  INCREASINGLY_RELIABLE_CREDIBLE: "increasingly_reliable_credible"
});

const roleVariable = Object.freeze({
  NURTURER: "nurturer",
  PROTECTOR: "protector",
  LEADER: "leader"
});

export function applyDevelopmentalCapacityToVariables(variables, value, decision = developmentalCapacityDecision(value)) {
  if (!value || !decision) return { ...variables };
  const result = {
    ...variables,
    developmental_capacity_state: statusVariable[value.status],
    inner_adult_reliability: value.reliability.toLowerCase(),
    younger_state_trust: value.younger_state_trust.toLowerCase(),
    self_care_practice_helpfulness: value.practice?.helpfulness.toLowerCase() ?? "unknown",
    self_care_practice_consistency: value.practice?.consistency.toLowerCase() ?? "unknown",
    developmental_pair_route: decision.pairedContrastRequired ? "required" : "not_required",
    developmental_inquiry_route: decision.questionMode === "pair" ? "paired"
      : decision.questionOrder[0] === "successful-exception" ? "successful_exception"
        : decision.questionOrder[0] === "breakdown-under-distress" ? "breakdown_state" : "none",
    developmental_missing_function: decision.deficits.length === 1 ? roleVariable[decision.deficits[0]] : decision.deficits.length > 1 ? "mixed" : "none"
  };
  if (value.status === "ABSENT_OR_INACCESSIBLE") result.inner_adult_access = "low";
  else if (value.status === "PARTIAL_INTERMITTENT_STATE_DEPENDENT") result.inner_adult_access = "partial";
  else if (["AVAILABLE", "AVAILABLE_LOW_CREDIBILITY", "INCREASINGLY_RELIABLE_CREDIBLE"].includes(value.status)) result.inner_adult_access = "available";
  if (value.status === "AVAILABLE_LOW_CREDIBILITY") result.credibility_conflict = "present";
  return result;
}

export const DEVELOPMENTAL_SUCCESS_QUESTION = "You've said the inner-child, reparenting, or self-love work helps at least sometimes even though it is hard. Can you think of a recent moment when it helped and tell me what you actually did differently toward yourself?";
export const DEVELOPMENTAL_BREAKDOWN_QUESTION = "When you feel lost, ashamed, rejected, or out of control, what happens inside toward you—can anything in you stay with you and help, even a little, or do you mostly feel alone with it?";

const PROHIBITED_TANGENT_TOPICS = Object.freeze([
  "rejection-investigation",
  "shame-function-investigation",
  "false-self-theory",
  "substance-discussion",
  "shaking-discussion",
  "generic-consent-boundary-teaching"
]);

function higherPriorityRoute(plan) {
  const variables = plan.variables ?? {};
  const pathRoute = plan.pathPerformance?.route;
  const primaryId = plan.primaryJob?.id ?? "";
  const threatLevel = plan.threatPathwayContract?.level ?? plan.threatPathway?.level;
  return plan.primaryJob?.tier === 1
    || variables.present_safety === "unsafe"
    || variables.orientation === "disoriented"
    || variables.ability_to_stop === "no"
    || variables.ability_to_return === "no"
    || variables.dissociation === "high"
    || variables.altered_state === "altered"
    || ["safety", "external", "protective", "action", "leave"].includes(pathRoute)
    || ["ESCALATING_MOBILIZING_RISK", "IMMINENT_OPERATIONAL_DANGER"].includes(threatLevel)
    || ["ROUTE.ACT_OUTWARD", "ROUTE.EXTERNAL_EMBODIMENT", "ROUTE.RELATIONAL_REALITY_CHECK", "ROUTE.LEAVE_ALONE"].includes(primaryId);
}

export function decoratePlanWithDevelopmentalCapacity(plan, decision) {
  if (!decision) return plan;
  const result = structuredClone(plan);
  const contract = {
    version: 1,
    route: decision.route,
    status: decision.status,
    observationIds: decision.observationIds,
    languageMode: decision.languageMode,
    recommendedNodeId: decision.recommendedNodeId,
    oneDiscriminatingComparison: decision.pairedContrastRequired,
    pairedContrastRequired: decision.pairedContrastRequired,
    questionMode: decision.questionMode,
    questionOrder: decision.questionOrder,
    requiredPolicyMarker: decision.pairedContrastRequired ? "POLICY.DEVELOPMENTAL_PAIRED_CONTRAST" : null,
    prohibitedTangentTopics: decision.questions.length ? [...PROHIBITED_TANGENT_TOPICS] : [],
    guidance: decision.guidance
  };
  result.developmentalCapacityContract = contract;
  result.requiredNuance = [...new Set([...(result.requiredNuance ?? []), ...decision.guidance])];
  result.forbiddenOverclaims = [...new Set([...(result.forbiddenOverclaims ?? []),
    "Do not infer that a coherent, accessible, sufficiently capable Adult exists merely because the client uses Adult, inner-parent, Nurturer, Protector, Leader, Guide, self-love, or reparenting language.",
    "Do not route to younger-state distrust or credibility repair before the relevant caregiving or leadership capacity itself has been established."] )];
  if (result.executionContract) {
    result.executionContract.taskGuidance = [...new Set([...(result.executionContract.taskGuidance ?? []), ...decision.guidance])];
  }
  if (decision.questions.length && !higherPriorityRoute(result)) {
    const questions = [...decision.questions];
    const source = { type: "developmental-capacity", route: decision.route };
    result.nextQuestion = questions.join("\n\n");
    result.nextQuestionSource = source;
    result.questionContract = {
      mode: decision.questionMode === "pair" ? "canonical-pair" : "canonical",
      question: result.nextQuestion,
      ...(decision.questionMode === "pair" ? { questions } : {}),
      order: [...decision.questionOrder],
      source
    };
  }
  return result;
}
