import { pathPerformanceGuidance, performanceQuestion } from "../case-formulation/path-performance.mjs";
import { blankCaseVariables, CASE_VARIABLE_ENUMS } from "./contract.mjs";
import { validateCaseVariables } from "./validate.mjs";
import { validateTurnTask, immediateProtectionNeeded, taskQuestion, guidanceForTask } from "../case-formulation/turn-task.mjs";

function conditionMatches(condition, variables) {
  const actual = variables[condition.field] ?? "unknown";
  if (condition.op === "eq") return actual === condition.value;
  if (condition.op === "notEq") return actual !== condition.value;
  if (condition.op === "in") return condition.value.includes(actual);
  if (condition.op === "notIn") return !condition.value.includes(actual);
  return false;
}

function activationMatches(activation = {}, variables) {
  const all = activation.all ?? [];
  const any = activation.any ?? [];
  const none = activation.none ?? [];
  if (all.length && !all.every((condition) => conditionMatches(condition, variables))) return false;
  if (any.length && !any.some((condition) => conditionMatches(condition, variables))) return false;
  if (none.some((condition) => conditionMatches(condition, variables))) return false;
  return all.length > 0 || any.length > 0 || none.length > 0;
}


// Deferred means relevant-but-postponed, not merely reachable later in the guide.
// These fields are capacity/safety gates; stripping them lets us test whether the
// route has a substantive case-specific reason to be relevant at all.
const DEFERRAL_PREREQUISITE_FIELDS = new Set([
  "present_safety",
  "orientation",
  "ability_to_stop",
  "ability_to_return",
  "activation",
  "dissociation",
  "altered_state",
  "body_capacity",
  "deep_work_readiness",
  "basic_reparenting_capacity",
  "stable_for_advanced_release",
  "advanced_release_physical_risk",
  "panic_instability"
]);

function activationMatchesForDeferral(activation = {}, variables) {
  const filtered = {};
  let substantiveCount = 0;
  for (const group of ["all", "any", "none"]) {
    const source = activation[group] ?? [];
    const kept = source.filter((condition) => !DEFERRAL_PREREQUISITE_FIELDS.has(condition.field));
    substantiveCount += kept.length;
    filtered[group] = kept;
  }
  if (!substantiveCount) return false;
  return activationMatches(filtered, variables);
}

function unknownIsStillUseful(unknown, variables) {
  const variable = String(unknown?.variable ?? "").trim();
  if (!variable) return false;
  if (Object.hasOwn(CASE_VARIABLE_ENUMS, variable)) {
    return (variables[variable] ?? "unknown") === "unknown";
  }
  return Number(unknown?.importance ?? 0) >= 4;
}

function definiteNo(values) {
  return values.some((value) => value === true);
}

export function deriveCaseVariables(input = {}) {
  const variables = validateCaseVariables({ ...blankCaseVariables(), ...input });

  const unsafeForDeep = definiteNo([
    variables.present_safety === "unsafe",
    variables.orientation === "disoriented",
    variables.ability_to_stop === "no",
    variables.ability_to_return === "no",
    variables.activation === "high",
    variables.dissociation === "high",
    variables.altered_state === "altered"
  ]);
  const clearlyReadyForDeep = [
    variables.present_safety === "safe",
    variables.orientation === "oriented",
    variables.ability_to_stop === "yes",
    variables.ability_to_return === "yes",
    variables.activation !== "high" && variables.activation !== "unknown",
    variables.dissociation !== "high" && variables.dissociation !== "unknown",
    variables.altered_state === "sober"
  ].every(Boolean);
  variables.deep_work_readiness = unsafeForDeep ? "no" : clearlyReadyForDeep ? "yes" : "unknown";

  if (["available", "partial"].includes(variables.inner_adult_access)) {
    variables.basic_reparenting_capacity = "yes";
  } else if (variables.inner_adult_access === "low" && variables.support_available === "absent") {
    variables.basic_reparenting_capacity = "no";
  } else {
    variables.basic_reparenting_capacity = "unknown";
  }

  const advancedUnsafe = definiteNo([
    variables.present_safety === "unsafe",
    variables.orientation === "disoriented",
    variables.ability_to_stop === "no",
    variables.ability_to_return === "no",
    variables.advanced_release_physical_risk === "present",
    variables.panic_instability === "present",
    variables.altered_state === "altered"
  ]);
  const advancedReady = [
    variables.present_safety === "safe",
    variables.orientation === "oriented",
    variables.ability_to_stop === "yes",
    variables.ability_to_return === "yes",
    variables.advanced_release_physical_risk === "absent",
    variables.panic_instability === "absent",
    variables.altered_state === "sober"
  ].every(Boolean);
  variables.stable_for_advanced_release = advancedUnsafe ? "no" : advancedReady ? "yes" : "unknown";
  const relational = variables.other_person_central === "yes" || variables.influence_domain === "ordinary_social";
  const relationalCleared = !relational || ["completed", "not_needed"].includes(variables.relational_check_status);
  const loopSeparated = variables.loop_target_relation === "distinct_repetitive_process" || (variables.unresolved_inner_material === "absent" && variables.loop_target_relation !== "live_work");
  const loopReady = variables.attention_loop === "present" && variables.thinking_yield === "repetitive_no_new_output"
    && variables.actionable_problem === "absent" && relationalCleared && loopSeparated;
  const danger = immediateProtectionNeeded(variables) || ["ideation", "intent"].includes(variables.suicidal_state);
  variables.leave_alone_eligibility = danger ? "ineligible" : loopReady ? "eligible" : "ineligible";
  return variables;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function planFromGraphs({ variables: rawVariables, unknowns = [], graphs, turnTask = null, pathPerformance = null }) {
  const variables = deriveCaseVariables(rawVariables);
  const taskPolicy = graphs.every(graph => graph.taskPolicyVersion === 1);
  const control = graphs.length > 0 && graphs.every(g => g.pathPerformancePolicyVersion === 1) ? pathPerformance : null;
  let interrupt = control && control.latest.route !== "continue";
  let task = taskPolicy && !interrupt ? validateTurnTask(turnTask) : null;
  const emergency = immediateProtectionNeeded(variables);
  const deferTargets = (node) => {
    if (taskPolicy && (node.effects?.deferralUnless ?? []).some(c => conditionMatches(c, variables))) return [];
    if (taskPolicy && task?.agreement === "accepted" && task.capacity === "adequate" && task.phase === "practice"
        && task.node_id === "IC.DEEP_CHILD_DIALOGUE" && variables.deep_work_readiness === "yes"
        && ["IC.BORROW_ONE_FUNCTION", "IC.SOLAR_PLEXUS_RELAXATION"].includes(node.id)) return [];
    return node.effects?.deferNodes ?? [];
  };
  const nodes = graphs.flatMap((graph) => graph.nodes ?? []);
  const edges = graphs.flatMap((graph) => (graph.edges ?? []).map((edge) => ({ ...edge, graphId: graph.graphId })));
  const matched = nodes
    .filter((node) => activationMatches(node.activation, variables))
    .sort((a, b) => a.tier - b.tier || b.priority - a.priority || a.id.localeCompare(b.id));

  const matchedIds = new Set(matched.map((node) => node.id));
  const deferredIds = new Set(matched.flatMap(deferTargets));
  const blockedIds = new Set(matched.flatMap((node) => node.effects?.blockNodes ?? []));

  // Backward-compatible fallback for installed r5 and preserved r01 packets.
  // Corrected packets own this suppression through the block node's effects.
  if (matchedIds.has("SOM.ADVANCED_RELEASE_BLOCK") && !blockedIds.has("SOM.ADVANCED_RELEASE_OPTIONAL")) {
    blockedIds.add("SOM.ADVANCED_RELEASE_OPTIONAL");
    deferredIds.delete("SOM.ADVANCED_RELEASE_OPTIONAL");
  }
  if (variables.deep_work_readiness !== "yes") {
    for (const id of ["IC.DEEP_CHILD_DIALOGUE", "SOM.DEEP_BRAINSPOTTING", "SOM.EMDR_DISCRETE", "SOM.EMDR_DEVELOPMENTAL"]) deferredIds.add(id);
  }
  if (matchedIds.has("SOM.EMDR_DEVELOPMENTAL_DEFER")) deferredIds.add("SOM.EMDR_DEVELOPMENTAL");

  let eligible = matched.filter((node) => !blockedIds.has(node.id) && !deferredIds.has(node.id));

  // A stable discrete memory target is the explicit exception to the broad developmental
  // preparation sequence: do not let generic bootstrap nodes turn capacity-building into
  // an endless waiting room when the graph has already established readiness.
  if (variables.current_intent === "memory_processing"
      && variables.target_type === "discrete"
      && variables.deep_work_readiness === "yes") {
    eligible = [...eligible].sort((a, b) => {
      if (a.id === "SOM.EMDR_DISCRETE") return -1;
      if (b.id === "SOM.EMDR_DISCRETE") return 1;
      return a.tier - b.tier || b.priority - a.priority || a.id.localeCompare(b.id);
    });
  }

  if (taskPolicy && task?.agreement === "declined" && task.node_id) {
    eligible = eligible.filter(node => node.id !== task.node_id || node.tier <= 2);
  }
  // An evidenced current task can outrank generic preparation, but never protective
  // constraints, a live external problem or an uncompleted relational reality check.
  if (taskPolicy && task?.agreement === "accepted" && task.node_id && !emergency
      && !eligible.some(node => node.tier <= 2)
      && !eligible.some(node => ["ROUTE.RELATIONAL_REALITY_CHECK", "ROUTE.ACT_OUTWARD", "ROUTE.LEAVE_ALONE", "ROUTE.EXTERNAL_EMBODIMENT"].includes(node.id) && node.id !== task.node_id)) {
    eligible = [...eligible].sort((a,b) => Number(b.id === task.node_id) - Number(a.id === task.node_id));
  }
  // A controller switch is a causal routing decision, never adjacency traversal.
  // Keep graph safety and concrete external action ahead of the reconsideration route.
  const safetyIds = new Set(["IC.SAFETY_ORIENTATION", "IC.ALTERED_STATE_GATE", "IC.PHOTO_EPISTEMIC_CAUTION"]);
  const higherRoutes = new Set([...safetyIds, "ROUTE.ACT_OUTWARD", "ROUTE.EXTERNAL_EMBODIMENT", "ROUTE.RELATIONAL_REALITY_CHECK", "ROUTE.LEAVE_ALONE"]);
  if (control && !interrupt) {
    const wanted = eligible.find(n => n.id === control.active?.strategy.node_id);
    const precedence = eligible.find(n => (higherRoutes.has(n.id) || n.tier === 1) && n.id !== wanted?.id);
    if (wanted && !precedence && task?.agreement !== "declined") eligible = [wanted, ...eligible.filter(n => n.id !== wanted.id)];
    else if (eligible[0]?.id !== wanted?.id || !wanted) {
      control.latest.status = "UNCLEAR"; control.latest.decision = "PROBE";
      control.latest.route = precedence?.id === "ROUTE.ACT_OUTWARD" ? "action" : precedence?.id === "ROUTE.EXTERNAL_EMBODIMENT" ? "external" : (safetyIds.has(precedence?.id) || precedence?.tier === 1) ? "protective" : "reconsider";
      control.latest.reason = "The proposed strategy is not the permitted executed route; clarify/reselect before attributing outcomes.";
      control.active.status = control.latest.status; control.active.decision = control.latest.decision; control.active.switch_pending = true;
      interrupt = true; task = null;
    }
  }
  let controlNode = null;
  if (interrupt) {
    const route = control.latest.route;
    const protective = eligible.find(n => (safetyIds.has(n.id) || n.tier === 1) && n.id !== control.active?.strategy.node_id);
    const action = eligible.find(n => n.id === "ROUTE.ACT_OUTWARD" && n.id !== control.active?.strategy.node_id);
    const relational = eligible.find(n => n.id === "ROUTE.RELATIONAL_REALITY_CHECK" && n.id !== control.active?.strategy.node_id);
    const forcedId = route === "safety" ? "IC.SAFETY_ORIENTATION"
      : route === "action" ? "ROUTE.ACT_OUTWARD"
      : route === "external" ? "ROUTE.EXTERNAL_EMBODIMENT"
      : route === "leave" ? "ROUTE.LEAVE_ALONE" : "ROUTE.THREE_WAY_GATE";
    controlNode = route === "safety" ? nodes.find(n => n.id === "IC.SAFETY_ORIENTATION")
      : protective ?? action ?? (route === "reconsider" ? relational : null) ?? nodes.find(n => n.id === forcedId);
    if (!controlNode || blockedIds.has(controlNode.id)) throw new TypeError("Path controller requires an available permitted routing node.");
    if (controlNode.id === control.active?.strategy.node_id && route !== "safety") {
      const exhaustedProbe = control.active.strategy.node_id === "ROUTE.THREE_WAY_GATE";
      controlNode = nodes.find(n => n.id === (exhaustedProbe ? "ROUTE.EXTERNAL_EMBODIMENT" : "ROUTE.THREE_WAY_GATE"));
      control.latest.route = exhaustedProbe ? "external" : "reconsider";
    }
    // Prior task, secondary jobs and their questions cannot smuggle the old exercise back in.
    eligible = [controlNode];
  }
  const primary = eligible[0] ?? null;
  const secondary = eligible.slice(1, 5);
  const deferredNodes = nodes
    .filter((node) => deferredIds.has(node.id))
    .filter((node) => !blockedIds.has(node.id))
    .filter((node) => activationMatchesForDeferral(node.activation, variables))
    .map((node) => ({ id: node.id, title: node.title }));
  const blockedNodes = nodes.filter((node) => blockedIds.has(node.id)).map((node) => ({ id: node.id, title: node.title }));
  const selected = [primary, ...secondary].filter(Boolean);
  const selectedIds = new Set(selected.map((node) => node.id));
  const matchedEdges = edges.filter((edge) => matchedIds.has(edge.from) || matchedIds.has(edge.to));
  const activeEdges = matchedEdges.filter((edge) => selectedIds.has(edge.from) || selectedIds.has(edge.to));
  const adjacentToPrimary = primary
    ? activeEdges
        .filter((edge) => edge.from === primary.id || edge.to === primary.id)
        .flatMap((edge) => [edge.from, edge.to])
        .filter((id) => id !== primary.id)
    : [];
  const eligibleById = new Map(eligible.map((node) => [node.id, node]));
  const displaySecondary = unique([
    ...adjacentToPrimary,
    ...secondary.map((node) => node.id)
  ]).map((id) => eligibleById.get(id)).filter(Boolean).slice(0, 3);
  const directlyDeferred = new Set([
    ...deferTargets(primary ?? {}),
    ...displaySecondary.flatMap(deferTargets)
  ]);
  const directlyBlocked = new Set([
    ...(primary?.effects?.blockNodes ?? []),
    ...displaySecondary.flatMap((node) => node.effects?.blockNodes ?? [])
  ]);
  // A question authored on a selected graph node outranks model-generated curiosity.
  // Such a question exists because its answer changes a live route or interpretation.
  // Model unknowns are fallback-only, and known case variables are never re-asked.
  const questionEligible = (node) => {
    if (!node?.defaultQuestion?.trim()) return false;
    if (!taskPolicy) return true;
    if (emergency) return node.questionPolicy?.purpose === "safety";
    if (task?.phase === "close" || task?.agreement === "declined" || primary?.id === "ROUTE.LEAVE_ALONE") return false;
    return !(node.questionPolicy?.unresolvedFields ?? []).length || node.questionPolicy.unresolvedFields.some(field => variables[field] === "unknown");
  };
  const questionNode = selected.filter(questionEligible).sort((a,b) => b.priority - a.priority)[0]
    ?? eligible.find(questionEligible);
  const usefulUnknowns = [...unknowns].filter(item => unknownIsStillUseful(item, variables))
    .filter(item => !taskPolicy || !emergency || ["present_safety", "orientation", "ability_to_stop", "ability_to_return", "support_available"].includes(item.variable))
    .sort((a,b) => (b.importance ?? 0) - (a.importance ?? 0));
  const currentTaskQuestion = !emergency && task && task.node_id === primary?.id ? taskQuestion(task) : "";
  const noQuestion = taskPolicy && ((!emergency && (task?.phase === "close" || task?.agreement === "declined" || primary?.id === "ROUTE.LEAVE_ALONE"))
    || (task?.question_focus === "none" && task.node_id === primary?.id && !emergency));
  let nextQuestion = noQuestion ? "" : currentTaskQuestion || questionNode?.defaultQuestion || usefulUnknowns[0]?.question || "";
  let nextQuestionSource = !nextQuestion ? null : currentTaskQuestion
    ? { type: "turn-task", phase: task.phase, focus: task.question_focus }
    : questionNode ? { type: "graph-node", id: questionNode.id }
    : { type: "case-unknown", variable: usefulUnknowns[0].variable };
  if (!emergency && control?.latest?.decision === "PROBE" && control.latest.route === "continue"
      && control.latest.failure_sources?.some(f => f.kind === "REPRESENTATION_MISMATCH")) {
    nextQuestion = performanceQuestion(control);
    nextQuestionSource = nextQuestion ? { type: "path-performance-representation", episode: control.latest.episode_id } : null;
  }
  if (interrupt && (primary?.tier > 2 || control.latest.route === "safety")) {
    nextQuestion = primary.id === "ROUTE.THREE_WAY_GATE" ? performanceQuestion(control) : "";
    nextQuestionSource = nextQuestion ? { type: "path-performance", episode: control.latest.episode_id } : null;
  }
  const requiredNodeIds = primary ? [primary.id] : [];
  if (taskPolicy && !emergency && primary?.id === "ROUTE.INFLUENCE_NONORDINARY_METTA"
      && selectedIds.has("ROUTE.INFLUENCE_LOVE_CAPACITY")) requiredNodeIds.push("ROUTE.INFLUENCE_LOVE_CAPACITY");
  const taskApplies = task && (task.node_id === primary?.id || task.kind === "relationship_repair" || task.agreement === "declined" || task.phase === "close");
  const execution = taskPolicy ? {
    version: 1, requiredNodeIds,
    contextNodeIds: selected.filter(n => !requiredNodeIds.includes(n.id)).map(n => n.id),
    task: taskApplies ? task : null,
    taskGuidance: [...(taskApplies && !emergency ? guidanceForTask(task) : []), ...(control ? pathPerformanceGuidance(control) : [])],
    reason: emergency ? "Immediate protection controls this turn; other selected nodes are context only."
      : "Perform the primary and explicitly necessary support, not every diagram secondary."
  } : null;

  const dynamicNuance = [];
  const dynamicForbidden = [];
  if (variables.credibility_conflict === "present" && variables.credibility_evidence_state === "adverse") {
    dynamicNuance.push("The younger position is not evaluating an empty record; it is treating the observable adult-life outcome as adverse evidence against the promise. Repair therefore requires credible counterevidence, not merely establishing a first track record.");
    dynamicForbidden.push("Do not say this source of love simply has no track record yet when the user has already described a negative track record.");
    dynamicForbidden.push("Do not upgrade the younger position's adverse assessment into an independently established objective verdict about the whole life. Attribute the assessment to the part or position that is making it.");
  }

  if (variables.credibility_conflict === "present") {
    dynamicNuance.push("Credibility repair can be the blocking job while regulation remains a supporting job. Do not turn this into an either/or claim that activation is irrelevant merely because relaxation has not resolved the credibility dispute.");
    dynamicForbidden.push("Do not say 'the problem is not activation' or otherwise exclude regulation categorically when the evidence only shows that regulation has not resolved the relational credibility conflict.");
  }
  if (variables.resentment_toward_younger_self === "present") {
    dynamicNuance.push("Treat both the younger position's distrust and the resentful position's accusation as data to examine. Neither side automatically adjudicates the case, and the resentful position may contain information about perceived lost opportunities or present consequences.");
    dynamicForbidden.push("Do not privilege the younger position as the uniquely credible witness while treating the resentful position merely as contamination or pathology.");
  }

  if (variables.internal_speaker_relation === "unresolved" || variables.internal_speaker_relation === "unknown") {
    dynamicNuance.push("Chronological adulthood does not establish that the resentful voice and the vow-making adult function are the same speaker. Preserve their relationship as unresolved unless the user identifies it.");
    dynamicForbidden.push("Do not merge the resentful voice with the vow-making or nurturing adult position merely because both occur in the chronological adult.");
  }
  if (variables.witness_capacity === "present") {
    dynamicNuance.push("The user already demonstrates witness capacity by observing and distinguishing internal positions; do not prescribe witness bootstrap as though observation itself were unavailable.");
  }

  return {
    contractVersion: taskPolicy ? "case-plan-v5" : "case-plan-v4",
    ...(execution ? { executionContract: execution } : {}),
    ...(control ? { pathPerformance: { ...control.latest, selected_node: primary?.id ?? null },
      pathPerformanceContract: { version: 2, decision: control.latest.decision,
        strategy: control.active?.strategy ?? null,
        representation: control.latest.representation ?? null,
        delivery_assessment: control.latest.delivery_assessment ?? null,
        delivery_actions: control.latest.delivery_actions ?? [],
        prior_node: control.active?.strategy.node_id ?? null,
        prohibit_prior_exercise: Boolean(interrupt), guidance: pathPerformanceGuidance(control),
        humanUsefulnessEstablished: false,
        humanHarmEvaluation: "SEPARATE_REVIEW_REQUIRED" } } : {}),
    graphBundleVersion: graphs[0]?.bundleVersion ?? null,
    variables,
    primaryJob: primary ? { id: primary.id, title: primary.title, tier: primary.tier } : null,
    secondaryJobs: secondary.map((node) => ({ id: node.id, title: node.title, tier: node.tier })),
    selectedNodes: selected.map((node) => ({
      id: node.id,
      title: node.title,
      tier: node.tier,
      priority: node.priority,
      recommendations: node.recommendations,
      sourceRefs: node.sourceRefs,
      ...(taskPolicy ? { successSignals: node.successSignals, avoid: node.avoid } : {})
    })),
    deferredNodes,
    blockedNodes,
    displayTrace: {
      secondaryJobs: displaySecondary.map((node) => ({ id: node.id, title: node.title, tier: node.tier })),
      deferredNodes: deferredNodes.filter((node) => directlyDeferred.has(node.id)),
      blockedNodes: blockedNodes.filter((node) => directlyBlocked.has(node.id))
    },
    requiredNuance: unique([...(taskPolicy ? matched : selected).flatMap((node) => node.effects?.requiredNuance ?? []), ...dynamicNuance]),
    forbiddenOverclaims: unique([...(taskPolicy ? matched : selected).flatMap((node) => node.effects?.forbiddenOverclaims ?? []), ...dynamicForbidden]),
    avoid: unique((taskPolicy ? matched : selected).flatMap((node) => node.avoid ?? [])),
    nextQuestion,
    nextQuestionSource,
    questionContract: {
      mode: nextQuestion ? "canonical" : "none",
      question: nextQuestion,
      source: nextQuestionSource
    },
    trace: matched.map((node) => ({ id: node.id, matched: true, tier: node.tier, priority: node.priority })),
    graphTrace: {
      activeEdges,
      matchedEdges,
      sequencingNotes: unique(activeEdges.map((edge) => `${edge.from} ${edge.relation} ${edge.to}`))
    }
  };
}
