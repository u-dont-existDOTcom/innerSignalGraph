import {
  ROMANCE_GUIDE_CONTEXT_ENUMS,
  composeRomanceContext,
  validateRomanceSources
} from "../../tasks/romance-guide-20260907/context.mjs";

const text = { type: "string", maxLength: 1600 };
const ids = { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } };
const choice = values => ({ type: "string", enum: values });
const record = properties => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties)
});

// Current-turn selector for the source-bound candidate supplement. This is not a
// private relationship profile, readiness score, diagnosis, or persistent memory.
export const romanceGuideContextSchema = {
  anyOf: [{ type: "null" }, record({
    issue: text,
    topic: choice(ROMANCE_GUIDE_CONTEXT_ENUMS.topic),
    stage: choice(ROMANCE_GUIDE_CONTEXT_ENUMS.stage),
    audience: choice(ROMANCE_GUIDE_CONTEXT_ENUMS.audience),
    audience_observation_ids: ids,
    interest: choice(ROMANCE_GUIDE_CONTEXT_ENUMS.interest),
    interest_observation_ids: ids,
    deeper_exploration_outside_current_task: { type: "boolean" },
    observation_ids: ids
  })]
};

function failDefault(message) {
  throw new TypeError(message);
}

export function validateRomanceGuideContext(value, {
  issue,
  observationIds = new Set()
} = {}, fail = failDefault) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("romance_guide_context must be an object or null.");
  const schema = romanceGuideContextSchema.anyOf[1];
  if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return fail("romance_guide_context has undeclared fields.");
  for (const key of schema.required) if (!Object.hasOwn(value, key)) return fail(`romance_guide_context.${key} is required.`);
  if (typeof value.issue !== "string" || !value.issue.trim() || value.issue.length > 1600
      || (issue != null && value.issue !== issue)) return fail("Romance guide context must be bound to the current issue.");
  for (const key of ["topic", "stage", "audience", "interest"]) {
    if (!schema.properties[key].enum.includes(value[key])) return fail(`romance_guide_context.${key} is invalid.`);
  }
  if (typeof value.deeper_exploration_outside_current_task !== "boolean") return fail("romance_guide_context.deeper_exploration_outside_current_task must be boolean.");
  const references = (values, required, label) => {
    if (!Array.isArray(values) || values.length > 12 || new Set(values).size !== values.length
        || values.some(id => typeof id !== "string" || id.length > 160 || !observationIds.has(id))
        || (required && values.length === 0)) return fail(`${label} needs current direct-observation references.`);
  };
  references(value.observation_ids, true, "romance_guide_context");
  references(value.audience_observation_ids, value.audience !== "unknown", "romance_guide_context.audience");
  references(value.interest_observation_ids, value.interest !== "unspecified", "romance_guide_context.interest");
  return structuredClone(value);
}

// Coercion/terror is an outward-safety constraint, not a mutual inward exercise.
// This clone is used for the current plan only, so it cannot fabricate a failed
// method episode or leave a stale relationship constraint in future session state.
export function applyRomanceGuideRouteConstraint(control, context) {
  if (!control || context?.topic !== "coercion") return control;
  const state = structuredClone(control);
  const trace = state.latest;
  const highPriority = ["safety", "external", "protective", "leave"].includes(trace.route)
    || trace.decision === "STOP_DEESCALATE" || trace.status === "ADVERSE";
  trace.romance_guide_constraint = {
    topic: context.topic,
    source_rule_ids: ["RG08"],
    observation_ids: [...context.observation_ids]
  };
  if (highPriority) return state;
  trace.status = "UNCLEAR";
  trace.decision = "SWITCH";
  trace.route = "action";
  trace.reason = "Reported fear of refusal, truth-telling or leaving routes to practical safety and suitable outside support before inward or mutual processing.";
  if (state.active) {
    state.active.status = trace.status;
    state.active.decision = trace.decision;
    state.active.switch_pending = true;
  }
  return state;
}

function readinessOption(decision) {
  if (decision?.status === "PAUSE_ROMANCE") return "pause";
  if (decision?.status === "NOT_BLOCKED") return "no-pause-indicated";
  if (decision) return "unassessed";
  return "not-applicable";
}

export function composeRomanceGuidePlan(plan, context, {
  readinessDecision = null,
  alreadyOffered = false
} = {}) {
  const input = context ? {
    enabled: true,
    topic: context.topic,
    stage: context.stage,
    audience: context.audience,
    interest: context.interest,
    outsideCurrentTask: context.deeper_exploration_outside_current_task,
    alreadyOffered,
    readiness: readinessOption(readinessDecision)
  } : {};
  const composition = composeRomanceContext(plan, input);
  const performance = plan.pathPerformance ?? null;
  const trace = {
    version: 1,
    status: composition.status,
    source: {
      source_id: composition.sourceId,
      supplement_id: composition.supplementId,
      rule_ids: composition.ruleIds,
      excerpt_refs: composition.sourceRefs
    },
    case_variables: context ? {
      issue: context.issue,
      topic: context.topic,
      stage: context.stage,
      audience: context.audience,
      interest: context.interest,
      deeper_exploration_outside_current_task: context.deeper_exploration_outside_current_task,
      observation_ids: context.observation_ids,
      audience_observation_ids: context.audience_observation_ids,
      interest_observation_ids: context.interest_observation_ids
    } : null,
    judgment: {
      readiness: readinessDecision?.status ?? "NOT_ASSESSED",
      trajectory: performance?.status ?? "UNTRACKED",
      decision: performance?.decision ?? "UNTRACKED",
      route: performance?.route ?? "UNTRACKED"
    },
    realization: {
      action: composition.action,
      can_realize: composition.canRealize,
      reference_decision: composition.referenceDecision,
      reference: composition.reference
    },
    progress_checks: composition.progressChecks,
    optional_topic_boundary: composition.optionalTopicBoundary ?? null
  };
  const result = structuredClone(composition.plan);
  result.romanceGuide = trace;
  if (result.pathPerformanceContract && composition.progressChecks.length) {
    result.pathPerformanceContract.romanceGuide = {
      sourceRuleIds: [...composition.ruleIds],
      progressChecks: structuredClone(composition.progressChecks)
    };
    result.pathPerformanceContract.guidance = [...new Set([
      ...(result.pathPerformanceContract.guidance ?? []),
      ...composition.progressChecks.map(item => `[${item.ruleId} ordinary-life check] ${item.criterion}`)
    ])];
  }
  return { plan: result, composition, trace };
}

export { validateRomanceSources };
