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
    current_personal_safety: "Are you having thoughts of suicide or self-harm, or are you worried that you may not be able to keep yourself safe right now?",
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

function questionText(candidate) {
  return `${String(candidate?.item?.variable ?? "")} ${String(candidate?.item?.question ?? "")}`;
}

function pairedCareSafetyQuestion(candidates) {
  const caregiver = candidates.find((candidate) => /(?:personal|caregiver|self).*(?:safety|suicid|self[_\s-]?harm)|(?:suicid|self[_\s-]?harm).*(?:personal|caregiver|self)/i.test(questionText(candidate)));
  const dependent = candidates.find((candidate) => /(?:dependent|care[_\s-]?recipient|child|toddler).*(?:safety|essential[_\s-]?care)|(?:safety|essential[_\s-]?care).*(?:dependent|care[_\s-]?recipient|child|toddler)/i.test(questionText(candidate)));
  if (!caregiver || !dependent || caregiver === dependent) return null;
  return {
    variable: caregiver.item.variable,
    question: `${caregiver.item.question.trim()} ${dependent.item.question.trim()}`
  };
}

function pairedPersonalMedicalSafetyQuestion(candidates, route) {
  const personal = candidates.find((candidate) => /(?:personal|self).*(?:safety|suicid|self[_\s-]?harm)|(?:suicid|self[_\s-]?harm).*(?:personal|self)/i.test(questionText(candidate)));
  if (!personal) return null;
  const medical = candidates.find((candidate) => candidate !== personal
    && /(?:acute|urgent|warning|red[_\s-]?flag|faint|near[_\s-]?faint|chest[_\s-]?pain|shortness[_\s-]?of[_\s-]?breath|cardiac|heart[_\s-]?rhythm|medical.*(?:danger|risk|status)|condition.*instability)/i.test(questionText(candidate)));
  if (!medical) return null;
  const cardiac = /(?:cardiac|heart[_\s-]?rhythm|palpitation)/i.test(String(route.profile?.original_concern ?? ""));
  const medicalQuestion = cardiac
    ? "Are the heart-rhythm symptoms new or suddenly worse right now, or accompanied by fainting or near-fainting, chest pain, severe shortness of breath, or another major change—and if so, can you seek urgent medical evaluation now?"
    : medical.item.question.trim();
  return {
    variable: personal.item.variable,
    question: `${personal.item.question.trim()} ${medicalQuestion}`
  };
}

function pairedPostpartumInfantSafetyQuestion(candidates) {
  const postpartum = candidates.find((candidate) => /(?:postpartum|perinatal|maternal[_\s-]?(?:mood|anxiety|function))/i.test(questionText(candidate)));
  const infant = candidates.find((candidate) => candidate !== postpartum
    && /(?:infant|baby|newborn|pediatric).*(?:warning|medical|safety|feeding|hydration)|(?:warning|medical|safety|feeding|hydration).*(?:infant|baby|newborn|pediatric)/i.test(questionText(candidate)));
  if (!postpartum || !infant) return null;
  return {
    variable: postpartum.item.variable,
    question: "Are there immediate parent-safety or functioning concerns—thoughts of harming yourself or the baby, feeling unable to keep either of you safe, severe confusion, or being unable to manage basic care—and does the baby have warning signs such as fever, breathing difficulty, poor feeding, unusual lethargy, repeated vomiting, markedly fewer wet diapers, or being unusually inconsolable?"
  };
}

function selectProtocolQuestion(route, unknowns = []) {
  const material = new Set(route.materialUnknowns);
  const candidates = unknowns
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => material.has(item?.variable) && typeof item?.question === "string" && item.question.trim())
    .sort((a, b) => questionPriority(b.item.variable) - questionPriority(a.item.variable) || a.index - b.index);
  if (route.materialUnknowns.includes("current_personal_safety")
      && !candidates.some(({ item }) => item.variable === "current_personal_safety")) {
    candidates.unshift({
      item: {
        variable: "current_personal_safety",
        question: unknownQuestion("current_personal_safety")
      },
      index: -1
    });
  }
  const pairedSafety = pairedCareSafetyQuestion(candidates);
  if (pairedSafety) return pairedSafety;
  const pairedMedicalSafety = pairedPersonalMedicalSafetyQuestion(candidates, route);
  if (pairedMedicalSafety) return pairedMedicalSafety;
  const pairedPostpartumInfant = pairedPostpartumInfantSafetyQuestion(candidates);
  if (pairedPostpartumInfant) return pairedPostpartumInfant;
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

export function planTherapyFromGraphs({ variables, unknowns = [], graphs, protocolProfile = null, previousProtocolState = null, currentMessage = "", ablationVariant = "production" }) {
  const route = routeTherapyProtocolLongitudinal({ previousState: previousProtocolState, protocolProfile, variables, unknowns, currentMessage, ablationVariant });
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
