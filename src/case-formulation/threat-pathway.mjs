import { ValidationError } from "../core/errors.mjs";

const text = { type: "string", maxLength: 1600 };
const ids = { type: "array", maxItems: 16, items: { type: "string", maxLength: 160 } };
const choice = values => ({ type: "string", enum: values });
const record = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

export const THREAT_PATHWAY_LEVELS = Object.freeze([
  "NO_CURRENT_VIOLENCE_EVIDENCE",
  "GRIEVANCE_IDEATION_MORAL_CONSIDERATION",
  "ESCALATING_MOBILIZING_RISK",
  "IMMINENT_OPERATIONAL_DANGER"
]);

export const THREAT_PATHWAY_SIGNAL_KINDS = Object.freeze([
  "GRIEVANCE",
  "VIOLENT_IDEATION",
  "VIOLENT_FANTASY",
  "MORAL_CONSIDERATION",
  "SYMBOLIC_TARGET",
  "IDENTIFICATION_WITH_VIOLENCE",
  "NAMED_TARGET",
  "TARGET_FIXATION",
  "RESEARCH_PLANNING",
  "MEANS_ACCESS",
  "MEANS_ACQUISITION_STAGING",
  "ACTIVE_PREPARATION",
  "REHEARSAL",
  "TARGET_SURVEILLANCE",
  "COMMUNICATED_INTENT",
  "NARROWING_ALTERNATIVES",
  "WILLINGNESS_TO_DIE",
  "LOSS_OF_INHIBITION",
  "CONCRETE_INTENT",
  "SELECTED_TIMEFRAME",
  "NEAR_TERM_OPPORTUNITY",
  "INABILITY_UNWILLINGNESS_CONTROL",
  "MAINTAINS_CONTROL",
  "PROTECTIVE_FACTORS",
  "HUMAN_SUPPORT_AVAILABLE"
]);

const SIGNAL_STATUSES = Object.freeze(["PRESENT", "DENIED", "UNKNOWN"]);
const ASSESSMENT_BASES = Object.freeze(["CURRENT_TURN", "PRIOR_UNRESOLVED", "CURRENT_REASSESSMENT"]);
const ROUTES = Object.freeze(["NONE", "ENGAGE_AND_MONITOR", "ASSESS_AND_STRENGTHEN_SUPPORT", "IMMEDIATE_SAFETY_ACTION"]);
const DOMAINS = Object.freeze(["none", "political", "religious", "sports", "ideological", "other"]);
const CAUSAL_FRAMES = Object.freeze(["not_applicable", "single_symbolic_target", "distributed_system", "mixed", "unknown"]);
const CAPTURE_STATES = Object.freeze(["not_assessed", "not_supported", "possible", "supported"]);

export const threatPathwaySchema = { anyOf: [{ type: "null" }, record({
  version: { type: "integer", enum: [1] },
  issue: text,
  assessment_basis: choice(ASSESSMENT_BASES),
  signals: { type: "array", maxItems: THREAT_PATHWAY_SIGNAL_KINDS.length, items: record({
    kind: choice(THREAT_PATHWAY_SIGNAL_KINDS),
    status: choice(SIGNAL_STATUSES),
    observation_ids: ids
  }) },
  claim_to_engage: text,
  problem_violence_is_supposed_to_solve: text,
  scale_context: record({
    domain: choice(DOMAINS),
    causal_frame: choice(CAUSAL_FRAMES),
    identity_capture: choice(CAPTURE_STATES),
    observation_ids: ids
  })
})] };

const IDEATION_SIGNALS = new Set([
  "GRIEVANCE", "VIOLENT_IDEATION", "VIOLENT_FANTASY", "MORAL_CONSIDERATION",
  "SYMBOLIC_TARGET", "IDENTIFICATION_WITH_VIOLENCE", "NAMED_TARGET"
]);
const MOBILIZATION_SIGNALS = new Set([
  "TARGET_FIXATION", "RESEARCH_PLANNING", "MEANS_ACQUISITION_STAGING",
  "ACTIVE_PREPARATION", "REHEARSAL", "TARGET_SURVEILLANCE", "COMMUNICATED_INTENT",
  "NARROWING_ALTERNATIVES", "WILLINGNESS_TO_DIE", "LOSS_OF_INHIBITION", "CONCRETE_INTENT",
  "SELECTED_TIMEFRAME", "NEAR_TERM_OPPORTUNITY", "INABILITY_UNWILLINGNESS_CONTROL"
]);
const CAPABILITY_SIGNALS = new Set([
  "MEANS_ACCESS", "MEANS_ACQUISITION_STAGING", "ACTIVE_PREPARATION", "REHEARSAL", "TARGET_SURVEILLANCE"
]);

const QUESTIONS = Object.freeze({
  CONCRETE_INTENT: "Are you thinking about actually acting on this, or are you examining the thought without intending to act?",
  RESEARCH_PLANNING: "Have you taken any steps toward a plan, such as researching or preparing, or is this still only a thought?",
  MEANS_ACCESS: "Do you currently have access to anything you could use to carry it out?",
  SELECTED_TIMEFRAME: "Have you chosen a time or a near-term window?",
  INABILITY_UNWILLINGNESS_CONTROL: "Can you and will you keep yourself from acting while we work out the next safe step?",
  PROTECTIVE_FACTORS: "What is helping you not act on this right now?",
  HUMAN_SUPPORT_AVAILABLE: "Who can be with you or help you keep things safe right now?"
});

function fail(message) {
  throw new ValidationError(message);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function checkText(value, label, { empty = true } = {}) {
  if (typeof value !== "string" || value.length > 1600 || (!empty && !value.trim())) fail(`${label} must be bounded text.`);
}

function checkIds(values, label, observationIds, required) {
  if (!Array.isArray(values) || values.length > 16 || values.some(id => typeof id !== "string" || !id.trim() || id.length > 160)) {
    fail(`${label} must contain bounded observation IDs.`);
  }
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicate IDs.`);
  if (required && !values.length) fail(`${label} needs current direct-observation evidence.`);
  if (observationIds && values.some(id => !observationIds.has(id))) fail(`${label} references an unknown observation.`);
}

export function validateThreatPathwayAssessment(value, { issue, observationIds } = {}) {
  if (value == null) return null;
  if (!isRecord(value)) fail("threat_pathway must be an object or null.");
  const required = threatPathwaySchema.anyOf[1].required;
  if (Object.keys(value).some(key => !required.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    fail("threat_pathway has missing or undeclared fields.");
  }
  if (value.version !== 1) fail("threat_pathway.version is invalid.");
  checkText(value.issue, "threat_pathway.issue", { empty: false });
  if (issue != null && value.assessment_basis === "CURRENT_TURN" && value.issue !== issue) {
    fail("A current-turn threat-pathway assessment must be bound to the current issue.");
  }
  if (!ASSESSMENT_BASES.includes(value.assessment_basis)) fail("threat_pathway.assessment_basis is invalid.");
  if (!Array.isArray(value.signals) || value.signals.length > THREAT_PATHWAY_SIGNAL_KINDS.length) fail("threat_pathway.signals must be bounded.");
  const seen = new Set();
  for (const [index, signal] of value.signals.entries()) {
    if (!isRecord(signal) || Object.keys(signal).some(key => !["kind", "status", "observation_ids"].includes(key))) fail(`threat_pathway.signals[${index}] is invalid.`);
    if (!THREAT_PATHWAY_SIGNAL_KINDS.includes(signal.kind) || seen.has(signal.kind)) fail(`threat_pathway.signals[${index}].kind is invalid or duplicated.`);
    if (!SIGNAL_STATUSES.includes(signal.status)) fail(`threat_pathway.signals[${index}].status is invalid.`);
    checkIds(signal.observation_ids, `threat_pathway.signals[${index}].observation_ids`, observationIds, signal.status !== "UNKNOWN");
    if (signal.status === "UNKNOWN" && signal.observation_ids.length) fail("Unknown threat signals cannot cite evidence as though established.");
    seen.add(signal.kind);
  }
  checkText(value.claim_to_engage, "threat_pathway.claim_to_engage");
  checkText(value.problem_violence_is_supposed_to_solve, "threat_pathway.problem_violence_is_supposed_to_solve");
  if (!isRecord(value.scale_context) || Object.keys(value.scale_context).some(key => !["domain", "causal_frame", "identity_capture", "observation_ids"].includes(key))) {
    fail("threat_pathway.scale_context is invalid.");
  }
  if (!DOMAINS.includes(value.scale_context.domain) || !CAUSAL_FRAMES.includes(value.scale_context.causal_frame)
      || !CAPTURE_STATES.includes(value.scale_context.identity_capture)) fail("threat_pathway.scale_context contains an invalid enum.");
  const scaleSupported = !["none"].includes(value.scale_context.domain)
    || !["not_applicable", "unknown"].includes(value.scale_context.causal_frame)
    || !["not_assessed"].includes(value.scale_context.identity_capture);
  checkIds(value.scale_context.observation_ids, "threat_pathway.scale_context.observation_ids", observationIds, scaleSupported);
  return structuredClone(value);
}

export function threatPathwayObservationIds(assessment) {
  if (!assessment) return [];
  return [...new Set([
    ...assessment.signals.flatMap(signal => signal.observation_ids),
    ...assessment.scale_context.observation_ids
  ])];
}

function statusMap(assessment) {
  return new Map((assessment?.signals ?? []).map(signal => [signal.kind, signal.status]));
}

function present(set, map) {
  return [...set].filter(kind => map.get(kind) === "PRESENT");
}

function assessed(map, kind) {
  if (kind === "INABILITY_UNWILLINGNESS_CONTROL" && map.get("MAINTAINS_CONTROL") === "PRESENT") return true;
  if (kind === "MAINTAINS_CONTROL" && map.get("INABILITY_UNWILLINGNESS_CONTROL") === "PRESENT") return true;
  return ["PRESENT", "DENIED"].includes(map.get(kind));
}

function firstQuestion(map, orderedKinds) {
  const kind = orderedKinds.find(candidate => !assessed(map, candidate));
  return kind ? { kind, question: QUESTIONS[kind] } : null;
}

export function threatPathwayDecision(assessment) {
  if (!assessment) return Object.freeze({
    version: 1,
    level: "NO_CURRENT_VIOLENCE_EVIDENCE",
    route: "NONE",
    reason_codes: ["NO_ASSESSMENT_REQUIRED"],
    present_signal_kinds: [],
    denied_signal_kinds: [],
    unknown_signal_kinds: [],
    next_question: null,
    external_action_priority: false,
    assessment_is_prediction: false
  });
  const map = statusMap(assessment);
  const presentKinds = [...map].filter(([, status]) => status === "PRESENT").map(([kind]) => kind);
  const deniedKinds = [...map].filter(([, status]) => status === "DENIED").map(([kind]) => kind);
  const unknownKinds = THREAT_PATHWAY_SIGNAL_KINDS.filter(kind => !assessed(map, kind));
  const ideation = present(IDEATION_SIGNALS, map);
  const mobilization = present(MOBILIZATION_SIGNALS, map);
  const target = map.get("NAMED_TARGET") === "PRESENT" || map.get("TARGET_FIXATION") === "PRESENT";
  const intent = map.get("CONCRETE_INTENT") === "PRESENT" || map.get("COMMUNICATED_INTENT") === "PRESENT";
  const capability = present(CAPABILITY_SIGNALS, map).length > 0;
  const nearTerm = map.get("SELECTED_TIMEFRAME") === "PRESENT" || map.get("NEAR_TERM_OPPORTUNITY") === "PRESENT";
  const lossOfControl = map.get("INABILITY_UNWILLINGNESS_CONTROL") === "PRESENT";
  const imminent = (intent && target && capability && nearTerm) || (lossOfControl && intent && capability && nearTerm);
  const level = imminent ? "IMMINENT_OPERATIONAL_DANGER"
    : mobilization.length ? "ESCALATING_MOBILIZING_RISK"
      : ideation.length ? "GRIEVANCE_IDEATION_MORAL_CONSIDERATION"
        : "NO_CURRENT_VIOLENCE_EVIDENCE";
  const route = level === "IMMINENT_OPERATIONAL_DANGER" ? "IMMEDIATE_SAFETY_ACTION"
    : level === "ESCALATING_MOBILIZING_RISK" ? "ASSESS_AND_STRENGTHEN_SUPPORT"
      : level === "GRIEVANCE_IDEATION_MORAL_CONSIDERATION" ? "ENGAGE_AND_MONITOR" : "NONE";
  const questionOrder = level === "IMMINENT_OPERATIONAL_DANGER"
    ? ["INABILITY_UNWILLINGNESS_CONTROL", "HUMAN_SUPPORT_AVAILABLE", "PROTECTIVE_FACTORS"]
    : ["CONCRETE_INTENT", "RESEARCH_PLANNING", "MEANS_ACCESS", "SELECTED_TIMEFRAME", "INABILITY_UNWILLINGNESS_CONTROL", "PROTECTIVE_FACTORS", "HUMAN_SUPPORT_AVAILABLE"];
  return Object.freeze({
    version: 1,
    level,
    route,
    reason_codes: [
      ...(ideation.length ? ["IDEATION_OR_GRIEVANCE_OBSERVED"] : []),
      ...(mobilization.length ? ["MOBILIZATION_INDICATOR_OBSERVED"] : []),
      ...(imminent ? ["INTENT_TARGET_CAPABILITY_AND_NEAR_TERM_OPPORTUNITY"] : []),
      ...(lossOfControl ? ["CONTROL_NOT_MAINTAINED"] : []),
      ...(map.get("MAINTAINS_CONTROL") === "PRESENT" ? ["CONTROL_CURRENTLY_MAINTAINED"] : []),
      ...(map.get("PROTECTIVE_FACTORS") === "PRESENT" ? ["PROTECTIVE_FACTORS_OBSERVED"] : []),
      ...(map.get("HUMAN_SUPPORT_AVAILABLE") === "PRESENT" ? ["HUMAN_SUPPORT_OBSERVED"] : [])
    ],
    present_signal_kinds: presentKinds,
    denied_signal_kinds: deniedKinds,
    unknown_signal_kinds: unknownKinds,
    next_question: level === "NO_CURRENT_VIOLENCE_EVIDENCE" ? null : firstQuestion(map, questionOrder),
    external_action_priority: level === "IMMINENT_OPERATIONAL_DANGER",
    assessment_is_prediction: false
  });
}

export function threatPathwayGuidance(assessment, decision) {
  if (!assessment || decision.route === "NONE") return [];
  const shared = [
    "Use only established behavior and direct-report evidence. Do not invent intent, planning, preparation, means, access, timing, target selection, or loss of control; unknown is not absent and is not present.",
    "Do not endorse, optimize, rehearse, or assist violent action. A disturbing thought alone does not prove psychosis, dangerousness, or moral depravity.",
    "Preserve rapport and the disclosure channel. Use the least disruptive effective intervention supported by the current evidence, and keep the threat-pathway judgment revisable as evidence changes.",
    "Do not claim a universal legal or reporting duty. Jurisdictional and professional obligations require actual applicable context. Do not invoke hidden guardrails unless the runtime supplies a real binding boundary.",
    "External explanations must not erase internal agency; internal agency must not erase external reality. Distinguish distributed incentives, institutions, beliefs, and coordination problems from a single symbolic target, then seek scale-appropriate nonviolent leverage.",
    "Identity capture is supported only when enemy-fixation or activism is functioning as a main regulator of identity, belonging, righteousness, anger, or meaning while the rest of life deteriorates. Politics, religion, sports, or ideology alone is not pathology."
  ];
  if (decision.level === "GRIEVANCE_IDEATION_MORAL_CONSIDERATION") return [
    ...shared,
    "Continue the therapeutic conversation. Engage the actual claim and what the imagined violence is supposed to solve, test the causal model, widen alternatives, and identify effective nonviolent leverage while asking only the next risk-discriminating question.",
    "Do not call this a specific threat or append canned emergency instructions when no operational progression is established."
  ];
  if (decision.level === "ESCALATING_MOBILIZING_RISK") return [
    ...shared,
    "Operational progression now outranks abstract or purely philosophical engagement. Directly assess immediacy, target selection, means/access, preparation, timeframe, ability and willingness to maintain control, protective factors, and available human support; strengthen intervention proportionately.",
    "Do not let an interesting political or moral argument delay concrete risk assessment and support."
  ];
  return [
    ...shared,
    "Concrete near-term operational danger controls this turn. External safety action may outrank ordinary therapy; seek immediate human help and separation from feasible means using the least disruptive effective step consistent with current app policy and actual jurisdictional constraints.",
    "Do not continue abstract debate while near-term intent, target, capability or preparation, and opportunity are established."
  ];
}

export function threatPathwayMarker(decision) {
  if (decision.level === "GRIEVANCE_IDEATION_MORAL_CONSIDERATION") return "POLICY.THREAT_PATHWAY.ENGAGE";
  if (decision.level === "ESCALATING_MOBILIZING_RISK") return "POLICY.THREAT_PATHWAY.ASSESS";
  if (decision.level === "IMMINENT_OPERATIONAL_DANGER") return "POLICY.THREAT_PATHWAY.IMMINENT";
  return null;
}

export function decoratePlanWithThreatPathway(plan, assessment, decision = threatPathwayDecision(assessment)) {
  if (!assessment || decision.route === "NONE") return plan;
  const result = structuredClone(plan);
  const guidance = threatPathwayGuidance(assessment, decision);
  const marker = threatPathwayMarker(decision);
  result.threatPathway = { ...decision, issue: assessment.issue, scale_context: structuredClone(assessment.scale_context) };
  result.threatPathwayContract = {
    version: 1,
    marker,
    level: decision.level,
    route: decision.route,
    guidance,
    actual_claim: assessment.claim_to_engage,
    claimed_problem: assessment.problem_violence_is_supposed_to_solve,
    least_disruptive_effective_intervention: true,
    preserve_disclosure_channel: true,
    current_evidence_only: true
  };
  result.requiredNuance = [...new Set([...(result.requiredNuance ?? []), ...guidance])];
  result.forbiddenOverclaims = [...new Set([...(result.forbiddenOverclaims ?? []),
    "Do not label ideation as a specific threat without operational evidence.",
    "Do not infer dangerousness, psychosis, or moral depravity from a disturbing thought alone.",
    "Do not replace supported engagement with canned crisis language, and do not continue abstraction through supported operational progression."
  ])];
  if (result.executionContract) {
    result.executionContract.taskGuidance = [...new Set([...(result.executionContract.taskGuidance ?? []), ...guidance])];
    if (decision.level === "ESCALATING_MOBILIZING_RISK") {
      result.executionContract.contextNodeIds = [...new Set([
        ...(result.executionContract.contextNodeIds ?? []),
        ...(result.executionContract.requiredNodeIds ?? []),
        result.primaryJob?.id
      ].filter(Boolean))];
      result.executionContract.requiredNodeIds = [marker];
      result.executionContract.task = null;
      result.executionContract.reason = "Current operational progression requires bounded threat assessment and proportionate support before ordinary therapeutic work.";
      result.primaryJob = { id: marker, title: "Assess operational threat progression", tier: 0 };
    } else if (marker && !result.executionContract.requiredNodeIds.includes(marker)) {
      result.executionContract.requiredNodeIds.push(marker);
    }
  }
  if (decision.next_question?.question) {
    result.nextQuestion = decision.next_question.question;
    result.nextQuestionSource = { type: "threat-pathway", issue: assessment.issue, signal: decision.next_question.kind };
    result.questionContract = { mode: "canonical", question: result.nextQuestion, source: result.nextQuestionSource };
  }
  return result;
}

export function decoratePlanWithAntiBypass(plan, variables = {}) {
  if (variables.bypass_risk !== "present") return plan;
  const result = structuredClone(plan);
  const guidance = [
    "External explanations must not erase internal agency; internal agency must not erase external reality. Preserve genuine systemic conditions while testing whether one symbolic target compresses distributed incentives, institutions, beliefs and coordination problems, then identify nonviolent leverage at the personal, relational, community, institutional, political, cultural, economic or ecological scale actually in play.",
    "Evaluate bypass or identity capture by function and trajectory, not category: politics, religion, sports, ideology, romance, work, spirituality, therapy and self-love can be healthy participation unless they displace reality contact, freedom, reciprocity, ordinary-life transfer or the rest of life."
  ];
  const forbidden = [
    "Do not reduce genuine structural harm to personal responsibility, and do not let an external enemy story erase internal agency or the fixed therapeutic ends.",
    "Do not pathologize politics, activism, religion, sports, ideology or another identity by category. Identity capture requires evidence of regulatory function and wider-life deterioration."
  ];
  result.requiredNuance = [...new Set([...(result.requiredNuance ?? []), ...guidance])];
  result.forbiddenOverclaims = [...new Set([...(result.forbiddenOverclaims ?? []), ...forbidden])];
  if (result.executionContract) {
    result.executionContract.taskGuidance = [...new Set([...(result.executionContract.taskGuidance ?? []), ...guidance])];
  }
  return result;
}

export function updateThreatPathwayState(previous, assessment, decision, { turnId, recordedAt } = {}) {
  if (!assessment) return previous ?? null;
  if (typeof turnId !== "string" || !turnId.trim()) fail("Threat-pathway state update needs a turn ID.");
  checkText(recordedAt, "threat-pathway recordedAt", { empty: false });
  const current = {
    issue: assessment.issue,
    level: decision.level,
    route: decision.route,
    assessed_turn_id: turnId,
    assessed_at: recordedAt,
    assessment: structuredClone(assessment),
    present_signal_kinds: [...decision.present_signal_kinds],
    denied_signal_kinds: [...decision.denied_signal_kinds],
    unknown_signal_kinds: [...decision.unknown_signal_kinds]
  };
  const priorHistory = previous?.history ?? [];
  const history = previous?.current
    ? [...priorHistory, {
        issue: previous.current.issue,
        level: previous.current.level,
        route: previous.current.route,
        assessed_turn_id: previous.current.assessed_turn_id,
        assessed_at: previous.current.assessed_at
      }].slice(-20)
    : priorHistory;
  return { version: 1, current, history };
}

export function validateThreatPathwayState(value) {
  if (value == null) return null;
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.current) || !Array.isArray(value.history) || value.history.length > 20) {
    fail("caseState.threat_pathway is invalid.");
  }
  const validateSummary = (summary, label) => {
    checkText(summary.issue, `${label}.issue`, { empty: false });
    if (!THREAT_PATHWAY_LEVELS.includes(summary.level) || !ROUTES.includes(summary.route)) fail(`${label} has an invalid level or route.`);
    checkText(summary.assessed_turn_id, `${label}.assessed_turn_id`, { empty: false });
    checkText(summary.assessed_at, `${label}.assessed_at`, { empty: false });
  };
  validateSummary(value.current, "caseState.threat_pathway.current");
  validateThreatPathwayAssessment(value.current.assessment, { issue: value.current.issue });
  for (const field of ["present_signal_kinds", "denied_signal_kinds", "unknown_signal_kinds"]) {
    if (!Array.isArray(value.current[field]) || value.current[field].some(kind => !THREAT_PATHWAY_SIGNAL_KINDS.includes(kind))) fail(`caseState.threat_pathway.current.${field} is invalid.`);
  }
  value.history.forEach((summary, index) => validateSummary(summary, `caseState.threat_pathway.history[${index}]`));
  return value;
}
