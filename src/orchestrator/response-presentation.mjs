import { ValidationError } from "../core/errors.mjs";

const RESPONSE_MODES = new Set(["default", "map-debug"]);
const FUNCTION_PATTERNS = Object.freeze({
  Protector: /\b(protect|guard|boundar|safety|safe|stop|credibil|authority|action)\w*/i,
  Nurturer: /\b(nurtur|love|care|warm|kind|sooth|compassion)\w*/i,
  Guide: /\b(guide|meaning|truth|learn|standard|sequence|curios|explor|decision)\w*/i
});
const ROUTE_CATALOG = Object.freeze([
  Object.freeze({ id: "ROUTE.LEAVE_ALONE", title: "Leave the loop alone and re-enter ordinary life" }),
  Object.freeze({ id: "ROUTE.ACT_OUTWARD", title: "Act on the concrete problem" }),
  Object.freeze({ id: "ROUTE.EXTERNAL_EMBODIMENT", title: "Shift from inward monitoring to external embodiment" }),
  Object.freeze({ id: "ROUTE.GO_INWARD", title: "Go inward only for material that is actually there" }),
  Object.freeze({ id: "ROUTE.THREE_WAY_GATE", title: "Discriminate processing, action, and non-engagement" })
]);

export function normalizeResponseMode(value = "default") {
  const mode = typeof value === "string" && value.trim() ? value.trim() : "default";
  if (!RESPONSE_MODES.has(mode)) {
    throw new ValidationError("responseMode must be default or map-debug.");
  }
  return mode;
}

export function hasSafetyPrecedence(variables = {}) {
  return variables.present_safety === "unsafe"
    || variables.orientation === "disoriented"
    || variables.ability_to_stop === "no"
    || variables.ability_to_return === "no"
    || variables.dissociation === "high"
    || variables.altered_state === "altered"
    || variables.memory_source_risk === "present"
    || ["ideation", "intent", "imminent"].includes(variables.suicidal_state);
}

function selectedAdultFunctions(plan = {}) {
  const selectedNodes = plan.selectedNodes ?? [];
  return Object.entries(FUNCTION_PATTERNS).map(([role, pattern]) => {
    const evidenceNodes = selectedNodes.filter((node) => pattern.test([
      node.id,
      node.title,
      ...(node.recommendations ?? [])
    ].join(" "))).map((node) => ({ id: node.id, title: node.title }));
    return { role, selected: evidenceNodes.length > 0, evidenceNodes };
  });
}

function somaticModifiers(snapshot = {}, plan = {}) {
  const variables = snapshot.variables ?? {};
  return {
    activation: variables.activation ?? "unknown",
    dissociation: variables.dissociation ?? "unknown",
    inwardAttentionEffect: variables.inward_attention_effect ?? "unknown",
    bodyCapacity: variables.body_capacity ?? "unknown",
    freezePattern: variables.freeze_pattern ?? "unknown",
    selectedNodes: (plan.selectedNodes ?? [])
      .filter((node) => node.id.startsWith("SOM."))
      .map((node) => ({ id: node.id, title: node.title }))
  };
}

function threeWayDecision(plan = {}, safetyPrecedence = false) {
  const titleById = new Map(ROUTE_CATALOG.map((item) => [item.id, item.title]));
  const matched = (plan.trace ?? [])
    .filter((item) => titleById.has(item.id) && item.matched === true)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((item) => ({ ...item, title: titleById.get(item.id) }));
  if (!matched.length && titleById.has(plan.primaryJob?.id)) {
    matched.push({ ...plan.primaryJob, matched: true, priority: null });
  }
  const winningRoute = safetyPrecedence ? null : (matched[0] ?? null);
  return {
    safetySuppressed: safetyPrecedence,
    winningRoute,
    rejectedRoutes: ROUTE_CATALOG
      .filter((route) => route.id !== winningRoute?.id)
      .map((route) => {
        const match = matched.find((item) => item.id === route.id);
        return {
          ...route,
          matched: Boolean(match),
          selected: false,
          reason: safetyPrecedence
            ? "Suppressed by safety precedence for this turn."
            : match
              ? `Matched, but ${winningRoute.id} had higher graph priority for this turn.`
              : "Not matched by the graph for the current case variables."
        };
      })
  };
}

export function buildInternalFormulationMap({ snapshot = {}, plan = {}, routing = {} } = {}) {
  const variables = snapshot.variables ?? plan.variables ?? {};
  const safetyPrecedence = hasSafetyPrecedence(variables);
  const threeWayRouting = threeWayDecision(plan, safetyPrecedence);
  return {
    version: "therapy-formulation-map-v1",
    caseVariables: variables,
    safetyRouting: {
      precedenceApplied: safetyPrecedence,
      processingTier: routing.tier ?? null,
      forced: routing.forced === true,
      flags: snapshot.audit?.safety_flags ?? []
    },
    fusionWitnessAssessment: {
      suicidalState: variables.suicidal_state ?? "unknown",
      witnessCapacity: variables.witness_capacity ?? "unknown",
      innerAdultAccess: variables.inner_adult_access ?? "unknown",
      internalSpeakerRelation: variables.internal_speaker_relation ?? "unknown"
    },
    threeWayRouting,
    adultFunctionSelection: selectedAdultFunctions(plan),
    somaticModifiers: somaticModifiers(snapshot, plan),
    interventionSelection: {
      primary: plan.primaryJob ?? null,
      secondary: plan.displayTrace?.secondaryJobs ?? [],
      deferred: plan.displayTrace?.deferredNodes ?? [],
      blocked: plan.displayTrace?.blockedNodes ?? []
    },
    rationale: {
      tierReason: routing.reason ?? "",
      directObservations: snapshot.direct_observations ?? [],
      requiredNuance: plan.requiredNuance ?? [],
      rejectedClaims: [...(plan.forbiddenOverclaims ?? []), ...(plan.avoid ?? [])]
    },
    nextQuestionLogic: {
      question: plan.questionContract?.question ?? plan.nextQuestion ?? "",
      source: plan.questionContract?.source ?? plan.nextQuestionSource ?? null
    }
  };
}

export function buildResponsePresentation({ responseMode = "default", internalMap } = {}) {
  const mode = normalizeResponseMode(responseMode);
  const safetyRequired = internalMap?.safetyRouting?.precedenceApplied === true;
  const leaveAlone = internalMap?.threeWayRouting?.winningRoute?.id === "ROUTE.LEAVE_ALONE";
  return {
    version: "therapy-response-presentation-v1",
    mode,
    exposeMapDebug: mode === "map-debug",
    maxAnswerParagraphs: safetyRequired ? 5 : leaveAlone ? 1 : 3,
    maxAnswerWords: safetyRequired ? 320 : leaveAlone ? 90 : 180,
    safetyOverride: safetyRequired,
    leaveAloneBrevity: leaveAlone
  };
}

export function mapDebugForMode(responseMode, internalMap) {
  return normalizeResponseMode(responseMode) === "map-debug" ? internalMap : undefined;
}
