import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

export const PROTECTIVE_COMPATIBILITY_VERSION = 1;
export const CHILD_CONTACT_GATES = Object.freeze(["NOT_BLOCKED", "HOLD", "BLOCKED"]);
export const COMPATIBILITY_ROUTES = Object.freeze([
  "ordinary", "clarify_intent", "help_seeking", "identity_inquiry", "sovereignty",
  "adult_action", "human_support", "goal_mismatch", "unknown"
]);
export const COMPATIBILITY_NODE_IDS = Object.freeze([
  "ROUTE.COMPATIBILITY_CLARIFY",
  "ROUTE.HELP_SEEKING",
  "ROUTE.IDENTITY_FUNCTION_OUTCOMES",
  "ROUTE.SOVEREIGN_AGENCY",
  "ROUTE.NONHARMFUL_ADULT_ACTION",
  "ROUTE.HUMAN_CARE_BRIDGE",
  "ROUTE.GOAL_MISMATCH"
]);

const ROUTE_NODE = Object.freeze({
  clarify_intent: "ROUTE.COMPATIBILITY_CLARIFY",
  help_seeking: "ROUTE.HELP_SEEKING",
  identity_inquiry: "ROUTE.IDENTITY_FUNCTION_OUTCOMES",
  sovereignty: "ROUTE.SOVEREIGN_AGENCY",
  adult_action: "ROUTE.NONHARMFUL_ADULT_ACTION",
  human_support: "ROUTE.HUMAN_CARE_BRIDGE",
  goal_mismatch: "ROUTE.GOAL_MISMATCH"
});

export const compatibilityAssessmentSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        version: { type: "integer", enum: [1] },
        issue: { type: "string" },
        assessment_basis: { type: "string", enum: ["CURRENT_TURN", "PRIOR_UNRESOLVED", "CURRENT_REASSESSMENT"] },
        subject_context: { type: "string", enum: ["current_client", "scoped_simulation", "quoted_other", "unresolved_attribution"] },
        harm_intent: { type: "string", enum: ["endorsed", "materially_unclear", "not_supported"] },
        harm_intent_observation_ids: { type: "array", items: { type: "string" } },
        help_goal: { type: "string", enum: ["safe", "harmful", "unclear", "declined"] },
        help_goal_text: { type: "string" },
        help_goal_observation_ids: { type: "array", items: { type: "string" } },
        nonharm_choice: { type: "string", enum: ["reported", "supported_by_specific_behavior", "declined", "unknown"] },
        nonharm_choice_observation_ids: { type: "array", items: { type: "string" } },
        identity_inquiry_consent: { type: "string", enum: ["accepted", "declined", "unknown"] },
        identity_inquiry_observation_ids: { type: "array", items: { type: "string" } },
        agreed_next_job: { type: "string", enum: COMPATIBILITY_ROUTES },
        agreed_next_job_observation_ids: { type: "array", items: { type: "string" } },
        prior_restriction: { type: "string", enum: ["none", "hold", "blocked"] },
        prior_restriction_observation_ids: { type: "array", items: { type: "string" } },
        correction_observation_ids: { type: "array", items: { type: "string" } },
        reentry_status: { type: "string", enum: ["not_required", "review_required", "reviewed"] },
        reentry_observation_ids: { type: "array", items: { type: "string" } },
        human_review_required: { type: "boolean" }
      },
      required: [
        "version", "issue", "assessment_basis", "subject_context", "harm_intent", "harm_intent_observation_ids",
        "help_goal", "help_goal_text", "help_goal_observation_ids", "nonharm_choice", "nonharm_choice_observation_ids",
        "identity_inquiry_consent", "identity_inquiry_observation_ids", "agreed_next_job", "agreed_next_job_observation_ids",
        "prior_restriction", "prior_restriction_observation_ids", "correction_observation_ids", "reentry_status",
        "reentry_observation_ids", "human_review_required"
      ]
    }
  ]
};

const EXACT_FIELDS = Object.freeze(Object.keys(compatibilityAssessmentSchema.anyOf[1].properties));
const enumFor = field => compatibilityAssessmentSchema.anyOf[1].properties[field]?.enum;
const fail = message => { throw new ValidationError(message); };
const unique = values => [...new Set(values)];

export function compatibilityObservationIds(value) {
  if (!value) return [];
  return unique(Object.entries(value)
    .filter(([key]) => key.endsWith("_observation_ids"))
    .flatMap(([, ids]) => ids));
}

export function validateCompatibilityAssessment(value, { issue = null, observationIds = new Set() } = {}) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("compatibility_assessment must be an object or null.");
  const keys = Object.keys(value).sort();
  if (keys.join("\n") !== [...EXACT_FIELDS].sort().join("\n")) fail("compatibility_assessment has missing or undeclared fields.");
  if (value.version !== PROTECTIVE_COMPATIBILITY_VERSION) fail("compatibility_assessment.version is invalid.");
  if (typeof value.issue !== "string" || !value.issue.trim()) fail("compatibility_assessment.issue must be non-empty text.");
  if (issue && value.issue !== issue) fail("compatibility_assessment.issue must match current_issue.");
  for (const field of ["assessment_basis", "subject_context", "harm_intent", "help_goal", "nonharm_choice", "identity_inquiry_consent", "agreed_next_job", "prior_restriction", "reentry_status"]) {
    if (!enumFor(field).includes(value[field])) fail(`compatibility_assessment.${field} is invalid.`);
  }
  if (typeof value.help_goal_text !== "string") fail("compatibility_assessment.help_goal_text must be text.");
  if (typeof value.human_review_required !== "boolean") fail("compatibility_assessment.human_review_required must be boolean.");
  for (const field of EXACT_FIELDS.filter(item => item.endsWith("_observation_ids"))) {
    const ids = value[field];
    if (!Array.isArray(ids) || ids.length > 24 || ids.some(id => typeof id !== "string" || !id.trim())) fail(`compatibility_assessment.${field} must contain bounded observation IDs.`);
    if (new Set(ids).size !== ids.length) fail(`compatibility_assessment.${field} contains duplicate IDs.`);
    if (ids.some(id => !observationIds.has(id))) fail(`compatibility_assessment.${field} references an unknown observation.`);
  }
  if (["endorsed", "materially_unclear"].includes(value.harm_intent) && value.harm_intent_observation_ids.length === 0) fail("Supported or unclear harm intent requires current observation evidence.");
  if (["safe", "harmful"].includes(value.help_goal) && value.help_goal_observation_ids.length === 0) fail("A characterized help goal requires observation evidence.");
  if (value.nonharm_choice === "supported_by_specific_behavior" && value.nonharm_choice_observation_ids.length === 0) fail("Behavior-supported non-harm requires observation evidence.");
  if (value.reentry_status === "reviewed" && value.reentry_observation_ids.length === 0) fail("Reviewed re-entry requires observation evidence.");
  return value;
}

function chooseRoute(assessment, gate) {
  if (!assessment) return gate === "NOT_BLOCKED" ? "ordinary" : "clarify_intent";
  if (assessment.harm_intent === "materially_unclear" || assessment.subject_context === "unresolved_attribution") return "clarify_intent";
  if (["unclear", "declined"].includes(assessment.help_goal)) return "help_seeking";
  if (assessment.help_goal === "harmful" || assessment.nonharm_choice === "declined") return "goal_mismatch";
  if (assessment.human_review_required) return "human_support";
  if (assessment.agreed_next_job !== "unknown" && assessment.agreed_next_job !== "ordinary") return assessment.agreed_next_job;
  if (assessment.identity_inquiry_consent === "accepted") return "identity_inquiry";
  if (gate !== "NOT_BLOCKED") return "adult_action";
  return "ordinary";
}

export function protectiveCompatibilityDecision(assessment, priorState = null) {
  const priorGate = priorState?.current?.gate ?? "NOT_BLOCKED";
  const scoped = assessment?.subject_context === "scoped_simulation" || assessment?.subject_context === "quoted_other";
  let gate = "NOT_BLOCKED";
  let reason = "No supported harmful intent or unresolved compatibility restriction is present.";
  if (assessment?.harm_intent === "endorsed" || assessment?.help_goal === "harmful") {
    gate = "BLOCKED";
    reason = "Current evidence supports an intent or help goal directed toward deliberate harm, exploitation, coercion, abuse, or involuntary suffering.";
  } else if (assessment?.harm_intent === "materially_unclear" || assessment?.subject_context === "unresolved_attribution") {
    gate = "HOLD";
    reason = "Intent or actor attribution is materially unresolved.";
  } else if (!scoped && priorGate !== "NOT_BLOCKED") {
    const reentryReviewed = assessment?.assessment_basis === "CURRENT_REASSESSMENT"
      && assessment?.reentry_status === "reviewed"
      && assessment?.harm_intent === "not_supported"
      && assessment?.help_goal !== "harmful";
    if (reentryReviewed && (priorGate === "HOLD"
        || (priorGate === "BLOCKED" && priorState?.current?.human_review_required !== true))) {
      gate = "NOT_BLOCKED";
      reason = "A current evidence-bound reassessment resolved the prior hold.";
    } else {
      gate = "HOLD";
      reason = "A prior child-contact restriction survives until an evidence-bound re-entry review is complete.";
    }
  }
  const route = chooseRoute(assessment, gate);
  return Object.freeze({
    version: PROTECTIVE_COMPATIBILITY_VERSION,
    gate,
    route,
    routeNodeId: ROUTE_NODE[route] ?? null,
    reason,
    actorScope: scoped ? assessment.subject_context : "current_client",
    persists: !scoped && gate !== "NOT_BLOCKED",
    humanReviewRequired: Boolean(assessment?.human_review_required),
    evidenceObservationIds: compatibilityObservationIds(assessment),
    assessedIssue: assessment?.issue ?? priorState?.current?.issue ?? "",
    reentryStatus: assessment?.reentry_status ?? (priorGate === "NOT_BLOCKED" ? "not_required" : "review_required")
  });
}

export function unavailableCompatibilityDecision(issue = "Required compatibility evidence is unavailable.") {
  return Object.freeze({
    version: PROTECTIVE_COMPATIBILITY_VERSION,
    gate: "HOLD",
    route: "clarify_intent",
    routeNodeId: ROUTE_NODE.clarify_intent,
    reason: issue,
    actorScope: "current_client",
    persists: false,
    humanReviewRequired: false,
    evidenceObservationIds: [],
    assessedIssue: "",
    reentryStatus: "review_required"
  });
}

export function validateProtectiveCompatibilityState(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.history)) fail("caseState.protective_compatibility is invalid.");
  if (value.current != null) {
    if (!CHILD_CONTACT_GATES.includes(value.current.gate) || !COMPATIBILITY_ROUTES.includes(value.current.route)) fail("caseState.protective_compatibility.current contains an invalid decision.");
    if (typeof value.current.issue !== "string" || typeof value.current.assessed_turn_id !== "string" || typeof value.current.assessed_at !== "string") fail("caseState.protective_compatibility.current has invalid provenance.");
    if (!Array.isArray(value.current.evidence_observation_ids) || value.current.evidence_observation_ids.some(id => typeof id !== "string")) fail("caseState.protective_compatibility.current evidence is invalid.");
  }
  return value;
}

export function updateProtectiveCompatibilityState(previous, assessment, decision, { turnId, recordedAt }) {
  if (decision.actorScope !== "current_client") return previous ?? null;
  if (!assessment && previous?.current) return validateProtectiveCompatibilityState(structuredClone(previous));
  const priorCurrent = previous?.current ?? null;
  const preservePriorEvidence = decision.gate === "HOLD" && priorCurrent?.gate && priorCurrent.gate !== "NOT_BLOCKED";
  const current = {
    gate: decision.gate,
    route: decision.route,
    issue: assessment?.issue ?? decision.assessedIssue,
    reason: decision.reason,
    evidence_observation_ids: unique([
      ...(preservePriorEvidence ? priorCurrent.evidence_observation_ids ?? [] : []),
      ...decision.evidenceObservationIds
    ]),
    reentry_status: decision.reentryStatus,
    human_review_required: decision.humanReviewRequired,
    assessed_turn_id: turnId,
    assessed_at: recordedAt
  };
  const history = priorCurrent && JSON.stringify(priorCurrent) !== JSON.stringify(current)
    ? [...(previous?.history ?? []), priorCurrent].slice(-50)
    : [...(previous?.history ?? [])];
  return validateProtectiveCompatibilityState({ version: 1, current, history });
}

export function compatibilityStateBinding(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export const NEW_RESTRICTION_FALLBACK = "I won't guide an exercise involving a younger self while you are describing a purpose of harming or exploiting others. We can still discuss what you want help with, your present choices, and support for choosing not to harm.";
export const UNRESOLVED_RESTRICTION_FALLBACK = "Before any imagery exercise, let's clarify the concern and stay with your present goals and choices.";
export const ACTIVE_EXERCISE_EXIT = "End the exercise now. Open your eyes if they were closed, move your hands or feet, and look around the actual room. We will stay with your present choices rather than continue the scene. Take a moment to be fully alert before doing anything else.";

const CHILD_CONTACT_PATTERNS = Object.freeze([
  /\b(?:contact|meet|visit|find|summon|call|invite|approach|speak|talk|listen|write|send|ask|comfort|hold|hug|reparent|visuali[sz]e|imagine|picture|regress|return|go back)\b[^.!?\n]{0,90}\b(?:inner child|younger self|child self|child part|young part|little (?:you|one)|childhood self)\b/i,
  /\b(?:inner child|younger self|child self|child part|young part|little (?:you|one)|childhood self)\b[^.!?\n]{0,90}\b(?:contact|meet|visit|summon|call|invite|speak|talk|listen|write|ask|comfort|hold|hug|reparent|visuali[sz]e|imagine|picture|regress)\b/i,
  /\b(?:contacte|rencontre|imagine|visualise|parle|écoute|invite|console|serre)\b[^.!?\n]{0,100}\b(?:enfant intérieur|toi enfant|partie enfant|jeune toi)\b/i,
  /\b(?:enfant intérieur|toi enfant|partie enfant|jeune toi)\b[^.!?\n]{0,100}\b(?:contacte|rencontre|imagine|visualise|parle|écoute|invite|console|serre)\b/i,
  /\b(?:try|do|use|follow|read|open|visit|complete|practice)\b[^.!?\n]{0,100}\b(?:inner[- ]child|younger[- ]self|child[- ]part)\b[^.!?\n]{0,60}\b(?:exercise|guide|worksheet|homework|meditation|hypnosis|dialogue|journal)\b/i,
  /https?:\/\/[^\s)\]]*(?:innerchild|inner-child)[^\s)\]]*/i
]);

export function childContactViolations(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return CHILD_CONTACT_PATTERNS.flatMap((pattern, index) => pattern.test(text) ? [`CHILD_CONTACT_PATTERN_${index + 1}`] : []);
}

export function isChildDirectedTarget(value) {
  return /\b(?:inner child|younger self|child self|child part|young part|little (?:you|one)|childhood self|enfant intérieur|toi enfant|partie enfant|jeune toi)\b/i.test(String(value ?? ""));
}

export function restrictedCompatibilityFallback(decision) {
  const answer = decision?.gate === "BLOCKED" ? NEW_RESTRICTION_FALLBACK : UNRESOLVED_RESTRICTION_FALLBACK;
  const question = decision?.route === "clarify_intent"
    ? "When you describe that aim, are you describing something you want to do, something you fear doing, or someone else's position?"
    : decision?.route === "help_seeking"
      ? "What are you hoping for from this conversation—what hurts, or what would you like to be different?"
      : "";
  return { answer, next_question: question };
}

export function decoratePlanWithProtectiveCompatibility(plan, decision, graphs = []) {
  if (!decision || decision.gate === "NOT_BLOCKED") return { ...plan, protectiveCompatibility: decision ?? null };
  const allowed = new Set(COMPATIBILITY_NODE_IDS);
  const node = graphs.flatMap(graph => graph.nodes ?? []).find(item => item.id === decision.routeNodeId) ?? null;
  const urgentSafety = plan?.threatPathway?.level === "IMMINENT_OPERATIONAL_DANGER"
    || plan?.variables?.present_safety === "unsafe"
    || plan?.pathPerformance?.route === "safety";
  const activeExerciseExitRequired = ["hypnosis", "memory_processing", "deep_dialogue"].includes(plan?.variables?.current_intent);
  const threatPrimary = String(plan?.primaryJob?.id ?? "").startsWith("POLICY.THREAT_PATHWAY.") || urgentSafety;
  if (threatPrimary && plan?.primaryJob?.id) allowed.add(plan.primaryJob.id);
  const selectedNodes = (plan.selectedNodes ?? []).filter(item => allowed.has(item.id));
  if (node && !selectedNodes.some(item => item.id === node.id)) selectedNodes.unshift(node);
  const primaryJob = threatPrimary ? plan.primaryJob : node ? { id: node.id, title: node.title } : null;
  const nextQuestion = threatPrimary ? plan.nextQuestion : node?.defaultQuestion ?? "";
  return {
    ...plan,
    primaryJob,
    selectedNodes,
    secondaryJobs: [],
    deferred: [],
    nextQuestion,
    questionContract: nextQuestion ? { mode: "canonical", question: nextQuestion } : { mode: "none", question: "" },
    executionContract: threatPrimary ? {
      version: 1,
      requiredNodeIds: [...new Set([...(plan.executionContract?.requiredNodeIds ?? []), ...(node ? [node.id] : [])])],
      contextNodeIds: [],
      taskGuidance: [...(plan.executionContract?.taskGuidance ?? [])]
    } : { version: 1, requiredNodeIds: node ? [node.id] : [], contextNodeIds: [], taskGuidance: [] },
    protectiveCompatibility: decision,
    protectiveCompatibilityContract: {
      version: 1,
      gate: decision.gate,
      route: decision.route,
      allowedNodeIds: [...allowed],
      selectedRouteNodeId: node?.id ?? null,
      forceFallback: !node && !threatPrimary,
      prohibitChildContact: true,
      activeExerciseExitRequired,
      stateBindingRequired: true
    }
  };
}
