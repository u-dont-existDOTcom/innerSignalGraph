function nodeMap(bundle) {
  return new Map((bundle?.graphs ?? []).flatMap((graph) => (graph.nodes ?? []).map((node) => [node.id, { ...node, graphId: graph.graphId }])));
}

export { buildCompleteSemanticDiff as buildBehavioralDiffV2, buildCompleteDecisionCards as buildDecisionCardsV2 } from "../guide-graph/semantic-diff.mjs";

function edgeKey(edge) {
  return `${edge.from}→${edge.to}::${edge.relation ?? ""}`;
}

function sortedUnique(values = []) {
  return [...new Set(values)].sort();
}

function sameArray(a = [], b = []) {
  return JSON.stringify(sortedUnique(a)) === JSON.stringify(sortedUnique(b));
}

export function buildBehavioralDiff(installedBundle, candidateBundle, { regressionCases = [] } = {}) {
  const installedNodes = nodeMap(installedBundle);
  const candidateNodes = nodeMap(candidateBundle);
  const added = [];
  const removed = [];
  const changedQuestions = [];
  const changedPriorities = [];
  const changedBlockedOrDeferred = [];
  const changedRecommendations = [];

  for (const [id, node] of candidateNodes) {
    const prior = installedNodes.get(id);
    if (!prior) {
      added.push({ id, title: node.title, graphId: node.graphId, priority: node.priority });
      continue;
    }
    if ((prior.defaultQuestion ?? "") !== (node.defaultQuestion ?? "")) {
      changedQuestions.push({ id, title: node.title, current: prior.defaultQuestion ?? "", candidate: node.defaultQuestion ?? "" });
    }
    if (Number(prior.priority) !== Number(node.priority)) {
      changedPriorities.push({ id, title: node.title, current: prior.priority, candidate: node.priority });
    }
    const priorDefer = prior.effects?.deferNodes ?? [];
    const nextDefer = node.effects?.deferNodes ?? [];
    const priorBlock = prior.effects?.blockNodes ?? [];
    const nextBlock = node.effects?.blockNodes ?? [];
    if (!sameArray(priorDefer, nextDefer) || !sameArray(priorBlock, nextBlock)) {
      changedBlockedOrDeferred.push({
        id,
        title: node.title,
        current: { deferNodes: priorDefer, blockNodes: priorBlock },
        candidate: { deferNodes: nextDefer, blockNodes: nextBlock }
      });
    }
    if (JSON.stringify(prior.recommendations ?? []) !== JSON.stringify(node.recommendations ?? [])) {
      changedRecommendations.push({ id, title: node.title, current: prior.recommendations ?? [], candidate: node.recommendations ?? [] });
    }
  }
  for (const [id, node] of installedNodes) if (!candidateNodes.has(id)) removed.push({ id, title: node.title, graphId: node.graphId });

  const installedEdges = new Map((installedBundle?.graphs ?? []).flatMap((graph) => (graph.edges ?? []).map((edge) => [edgeKey(edge), { ...edge, graphId: graph.graphId }])));
  const candidateEdges = new Map((candidateBundle?.graphs ?? []).flatMap((graph) => (graph.edges ?? []).map((edge) => [edgeKey(edge), { ...edge, graphId: graph.graphId }])));
  const edgesAdded = [...candidateEdges.entries()].filter(([key]) => !installedEdges.has(key)).map(([, edge]) => edge);
  const edgesRemoved = [...installedEdges.entries()].filter(([key]) => !candidateEdges.has(key)).map(([, edge]) => edge);

  const changedNodeIds = new Set([
    ...added.map((item) => item.id),
    ...removed.map((item) => item.id),
    ...changedQuestions.map((item) => item.id),
    ...changedPriorities.map((item) => item.id),
    ...changedBlockedOrDeferred.map((item) => item.id),
    ...changedRecommendations.map((item) => item.id),
    ...edgesAdded.flatMap((item) => [item.from, item.to]),
    ...edgesRemoved.flatMap((item) => [item.from, item.to])
  ]);
  const affectedCases = regressionCases
    .filter((item) => (item.affectedNodeIds ?? []).some((id) => changedNodeIds.has(id)))
    .map((item) => ({ id: item.id, title: item.title, affectedNodeIds: item.affectedNodeIds.filter((id) => changedNodeIds.has(id)) }));

  return {
    contractVersion: "guide-behavioral-diff-v1",
    installedVersion: installedBundle?.version ?? "none",
    candidateVersion: candidateBundle?.version ?? "unknown",
    nodes: { added, removed },
    edges: { added: edgesAdded, removed: edgesRemoved },
    changedQuestions,
    changedPriorities,
    changedBlockedOrDeferred,
    changedRecommendations,
    affectedCases,
    substantive: Boolean(added.length || removed.length || edgesAdded.length || edgesRemoved.length || changedQuestions.length || changedPriorities.length || changedBlockedOrDeferred.length || changedRecommendations.length)
  };
}

function affectedFor(diff, ids) {
  return diff.affectedCases.filter((item) => item.affectedNodeIds.some((id) => ids.includes(id))).map((item) => item.id);
}

export function buildDecisionCards(diff, provenance = {}) {
  const cards = [];
  let sequence = 1;
  for (const item of diff.nodes.added) {
    cards.push({
      id: `decision-${sequence++}`,
      title: `Add route: ${item.title}`,
      classification: "substantive",
      current: "No equivalent executable node is installed.",
      candidate: `${item.id} becomes available in ${item.graphId}.`,
      behavioralEffect: `Presentations matching this node can receive a distinct route rather than being folded into a neighboring intervention.`,
      affectedRegressions: affectedFor(diff, [item.id]),
      provenance: provenance.nodes?.[item.id]?.role ?? "source-prose",
      recommended: "approve",
      worstPlausibleFailure: "The new route could activate too broadly and add an unnecessary follow-up or delay a better-established intervention.",
      requiresHumanDecision: true,
      status: "pending"
    });
  }
  for (const item of diff.changedQuestions) {
    cards.push({
      id: `decision-${sequence++}`,
      title: `Change discriminating question: ${item.title}`,
      classification: "substantive",
      current: item.current || "No graph-owned question.",
      candidate: item.candidate || "No graph-owned question.",
      behavioralEffect: "The candidate asks a different question before resolving the route, which can change the interpretation and next intervention.",
      affectedRegressions: affectedFor(diff, [item.id]),
      provenance: provenance.nodes?.[item.id]?.role ?? "source-prose",
      recommended: "approve",
      worstPlausibleFailure: "The app may ask a more detailed question when the user would have benefited from immediate action.",
      requiresHumanDecision: true,
      status: "pending"
    });
  }
  for (const item of diff.changedPriorities) {
    cards.push({
      id: `decision-${sequence++}`,
      title: `Reprioritize route: ${item.title}`,
      classification: "substantive",
      current: `Priority ${item.current}`,
      candidate: `Priority ${item.candidate}`,
      behavioralEffect: "When several jobs match, this route may now appear earlier or later in the intervention plan.",
      affectedRegressions: affectedFor(diff, [item.id]),
      provenance: provenance.nodes?.[item.id]?.role ?? "source-prose",
      recommended: "approve",
      worstPlausibleFailure: "The reprioritized route could crowd out another useful job in ambiguous cases.",
      requiresHumanDecision: true,
      status: "pending"
    });
  }
  for (const item of diff.changedBlockedOrDeferred) {
    cards.push({
      id: `decision-${sequence++}`,
      title: `Change prerequisite or deferral: ${item.title}`,
      classification: "substantive",
      current: JSON.stringify(item.current),
      candidate: JSON.stringify(item.candidate),
      behavioralEffect: "A deeper or downstream route may now wait, remain available, or be blocked under different conditions.",
      affectedRegressions: affectedFor(diff, [item.id, ...(item.candidate.deferNodes ?? []), ...(item.candidate.blockNodes ?? [])]),
      provenance: provenance.nodes?.[item.id]?.role ?? "source-prose",
      recommended: "approve",
      worstPlausibleFailure: "The app could postpone useful work or allow depth before sufficient capacity if the dependency is wrong.",
      requiresHumanDecision: true,
      status: "pending"
    });
  }
  if (!cards.length) {
    cards.push({
      id: "decision-1",
      title: "Install source/provenance alignment",
      classification: "restorative",
      current: diff.installedVersion,
      candidate: diff.candidateVersion,
      behavioralEffect: "The source map and provenance become more faithful without intentionally changing routing.",
      affectedRegressions: [],
      provenance: "source-map",
      recommended: "approve",
      worstPlausibleFailure: "A supposedly editorial change may conceal an unrecognized routing difference.",
      requiresHumanDecision: true,
      status: "pending"
    });
  }
  return cards;
}
