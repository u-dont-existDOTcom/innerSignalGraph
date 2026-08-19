import { planFromGraphs } from "../guide-graph/planner.mjs";
import { OPERATION_CLASSES, ROUTE_DISPOSITIONS } from "./contract.mjs";
import { routeTherapyProtocolLongitudinal } from "./longitudinal.mjs";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function unknownQuestion(field) {
  const questions = {
    request_actor: "Is the help primarily for you, another adult, or someone who depends on you?",
    primary_problem_class: "What needs attention first right now: immediate safety, current external reality, or an internal developmental issue?",
    resource_access_status: "Is the needed support actually reachable now, later, waitlisted, unaffordable, unsafe, or otherwise blocked?",
    decision_impact: "How reversible is the decision, and who else would be materially affected?",
    third_party_rights_or_consent: "Does the next action affect another person's body, consent, privacy, safety, property, or legal interests?",
    action_authority: "What evidence or authority would justify acting on this conclusion, especially if the action is hard to reverse?",
    lawful_decision_maker_status: "Who actually has decision authority here, and is that authority established or disputed?",
    decision_capacity_status: "Has capacity for this specific decision and time been assessed by someone qualified, or is it still presumed or unknown?",
    integration_load: "Has ordinary functioning and recovery returned enough that more depth would not add unresolved integration load?",
    present_safety: "Are you presently safe enough for this kind of exercise?",
    orientation: "Are you oriented to the present and able to track what is happening?",
    ability_to_stop: "Can you stop the proposed exercise when you choose?",
    ability_to_return: "Can you return to ordinary present functioning afterward?",
    current_sobriety: "Are you currently sober and free of intoxication or withdrawal concerns?",
    operation_consent: "Do you presently want this specific operation, or is it a no or not-now?"
  };
  return questions[field] ?? `What information about ${String(field).replaceAll("_", " ")} would change the next safe operation?`;
}

function questionPriority(variable) {
  const value = String(variable ?? "");
  if (/(?:suicid|self[_\s-]?harm)/i.test(value)) return 300;
  if (/(?:safety|danger|injury|acute|crisis|recurrence[_\s-]?risk|safe[_\s-]?supervision)/i.test(value)) return 200;
  return 0;
}

function selectProtocolQuestion(route, unknowns = []) {
  const material = new Set(route.materialUnknowns);
  const candidates = unknowns
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => material.has(item?.variable) && typeof item?.question === "string" && item.question.trim())
    .sort((a, b) => questionPriority(b.item.variable) - questionPriority(a.item.variable) || a.index - b.index);
  const selected = candidates[0]?.item ?? null;
  const variable = selected?.variable ?? route.materialUnknowns[0] ?? null;
  return {
    variable,
    question: selected?.question?.trim() || (variable ? unknownQuestion(variable) : "")
  };
}

function serializableRoute(route) {
  return {
    contractVersion: route.contractVersion,
    routerVersion: route.routerVersion,
    ablationVariant: route.ablationVariant,
    ontology: route.ontology,
    compatibilityMode: route.compatibilityMode,
    disposition: route.disposition,
    primaryOperation: route.primaryOperation,
    runGuideGraph: route.runGuideGraph,
    allowedOperations: route.allowedOperations,
    blockedOperations: route.blockedOperations,
    materialUnknowns: route.materialUnknowns,
    resourceState: route.resourceState,
    longitudinalState: route.longitudinalState,
    profile: route.profile
  };
}

function protocolOnlyPlan({ variables, unknowns = [], route, graphBundleVersion }) {
  const selectedQuestion = selectProtocolQuestion(route, unknowns);
  const questionField = selectedQuestion.variable;
  const nextQuestion = selectedQuestion.question;
  const node = route.protocolJob;
  const questionSource = questionField ? { type: "protocol-material-unknown", variable: questionField } : null;
  return {
    contractVersion: "case-plan-v4",
    graphBundleVersion,
    variables,
    primaryJob: { id: node.id, title: node.title, tier: node.tier },
    secondaryJobs: [],
    selectedNodes: [{
      id: node.id,
      title: node.title,
      tier: node.tier,
      priority: node.priority,
      recommendations: node.recommendations,
      sourceRefs: []
    }],
    deferredNodes: [],
    blockedNodes: [],
    displayTrace: { secondaryJobs: [], deferredNodes: [], blockedNodes: [] },
    requiredNuance: route.requiredNuance,
    forbiddenOverclaims: route.forbiddenOverclaims,
    avoid: route.blockedOperations.map((item) => `${item.operation}: ${item.reason}`),
    nextQuestion,
    nextQuestionSource: questionSource,
    questionContract: { mode: nextQuestion ? "canonical" : "none", question: nextQuestion, source: questionSource },
    trace: [],
    graphTrace: { activeEdges: [], matchedEdges: [], sequencingNotes: [] },
    therapyProtocol: serializableRoute(route)
  };
}

function restrictGraphPlan(base, route, graphs, unknowns) {
  const nodesById = new Map(graphs.flatMap((graph) => graph.nodes ?? []).map((node) => [node.id, node]));
  const selected = (base.selectedNodes ?? []).filter((node) => {
    const full = nodesById.get(node.id);
    return full ? route.graphNodeAllowed(full) : true;
  });
  if (!selected.length) {
    return protocolOnlyPlan({ variables: base.variables, unknowns, route, graphBundleVersion: base.graphBundleVersion });
  }
  const selectedIds = new Set(selected.map((node) => node.id));
  const primary = selected[0];
  const secondary = selected.slice(1, 5);
  return {
    ...base,
    contractVersion: "case-plan-v4",
    primaryJob: { id: primary.id, title: primary.title, tier: primary.tier },
    secondaryJobs: secondary.map((node) => ({ id: node.id, title: node.title, tier: node.tier })),
    selectedNodes: selected,
    displayTrace: {
      ...base.displayTrace,
      secondaryJobs: (base.displayTrace?.secondaryJobs ?? []).filter((node) => selectedIds.has(node.id))
    },
    requiredNuance: unique([...(base.requiredNuance ?? []), ...route.requiredNuance]),
    forbiddenOverclaims: unique([...(base.forbiddenOverclaims ?? []), ...route.forbiddenOverclaims]),
    avoid: unique([...(base.avoid ?? []), ...route.blockedOperations.map((item) => `${item.operation}: ${item.reason}`)]),
    therapyProtocol: serializableRoute(route)
  };
}

export function planTherapyFromGraphs({ variables, unknowns = [], graphs, protocolProfile = null, previousProtocolState = null, ablationVariant = "production" }) {
  const route = routeTherapyProtocolLongitudinal({ previousState: previousProtocolState, protocolProfile, variables, unknowns, ablationVariant });
  const graphBundleVersion = graphs[0]?.bundleVersion ?? null;
  if (!route.runGuideGraph) {
    return protocolOnlyPlan({ variables, unknowns, route, graphBundleVersion });
  }
  const base = planFromGraphs({ variables, unknowns, graphs });
  return restrictGraphPlan(base, route, graphs, unknowns);
}

export function protocolRequiresReviewedTier(snapshot = {}) {
  const p = snapshot.protocol_profile;
  if (!p) return null;
  const hard = p.current_external_danger === "present"
    || p.basic_needs_failure === "present"
    || p.condition_instability === "present"
    || p.dependent_danger === "present"
    || ["intoxicated", "withdrawal_possible", "altered"].includes(p.current_sobriety);
  if (hard) return { tier: "forensic", reason: "protocol safety or condition-specific override", forced: true };
  if ([
    "medical_condition",
    "certainty_reality_uncertainty",
    "actual_or_potential_harm",
    "refusal_capacity_ambivalence"
  ].includes(p.primary_problem_class)) {
    return { tier: "reviewed", reason: "protocol authority, epistemic, or condition-specific review", forced: false };
  }
  if (["high_impact_third_party", "hard_to_reverse"].includes(p.decision_impact)
      || p.capacity_concern === "present"
      || p.lawful_decision_maker_status === "disputed") {
    return { tier: "reviewed", reason: "protocol high-impact decision, capacity, or authority review", forced: false };
  }
  if (["unknown", "mixed"].includes(p.primary_problem_class)) {
    return { tier: "reviewed", reason: "protocol problem class remains materially unresolved", forced: false };
  }
  return null;
}

export function routeIsInnerWork(plan) {
  return [
    ROUTE_DISPOSITIONS.INNER_CHILD_PRIMARY,
    ROUTE_DISPOSITIONS.INNER_CHILD_ADJUNCTIVE
  ].includes(plan?.therapyProtocol?.disposition)
    && plan?.therapyProtocol?.primaryOperation !== OPERATION_CLASSES.CURRENT_REALITY;
}
