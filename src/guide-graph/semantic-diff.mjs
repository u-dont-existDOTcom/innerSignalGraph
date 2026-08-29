import { createHash } from "node:crypto";
import {
  ACTIVATION_KEYS,
  BUNDLE_KEYS,
  BUNDLE_SEMANTIC_FIELDS,
  BUNDLE_STATS_KEYS,
  CONDITION_KEYS,
  EDGE_KEYS,
  EFFECT_KEYS,
  GRAPH_KEYS,
  GRAPH_SEMANTIC_FIELDS,
  NODE_KEYS,
  NODE_SEMANTIC_FIELDS,
  isSubstantiveClassification
} from "./semantic-fields.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("UNCLASSIFIED_SEMANTIC_CHANGE", `${label} is not an object.`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail("UNCLASSIFIED_SEMANTIC_CHANGE", `${label} contains unclassified fields: ${unknown.join(", ")}`);
}

export function assertClassifiedGraphBundle(bundle, { label = "graph bundle" } = {}) {
  assertKeys(bundle, BUNDLE_KEYS, label);
  if (!Array.isArray(bundle.graphs)) fail("UNCLASSIFIED_SEMANTIC_CHANGE", `${label} must contain graphs.`);
  assertKeys(bundle.stats, BUNDLE_STATS_KEYS, `${label}.stats`);
  for (const graph of bundle.graphs) {
    assertKeys(graph, GRAPH_KEYS, `${label}.${graph.graphId ?? "unknown"}`);
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail("UNCLASSIFIED_SEMANTIC_CHANGE", `${graph.graphId} nodes and edges must be arrays.`);
    for (const node of graph.nodes) {
      assertKeys(node, NODE_KEYS, `${graph.graphId}.${node.id ?? "unknown"}`);
      assertKeys(node.activation, ACTIVATION_KEYS, `${node.id}.activation`);
      for (const group of ACTIVATION_KEYS) for (const [index, condition] of (node.activation[group] ?? []).entries()) assertKeys(condition, CONDITION_KEYS, `${node.id}.activation.${group}[${index}]`);
      assertKeys(node.effects, EFFECT_KEYS, `${node.id}.effects`);
    }
    for (const [index, edge] of graph.edges.entries()) assertKeys(edge, EDGE_KEYS, `${graph.graphId}.edges[${index}]`);
  }
  const expectedStats = {
    graphCount: bundle.graphs.length,
    nodeCount: bundle.graphs.reduce((sum, graph) => sum + graph.nodes.length, 0),
    edgeCount: bundle.graphs.reduce((sum, graph) => sum + graph.edges.length, 0),
    sourceSectionCount: (bundle.sourceMaps ?? []).reduce((sum, map) => sum + (map.sections?.length ?? 0), 0),
    ownerAmendmentCount: bundle.stats.ownerAmendmentCount
  };
  for (const field of ["graphCount", "nodeCount", "edgeCount", "sourceSectionCount"]) if (bundle.stats[field] !== expectedStats[field]) fail("UNCLASSIFIED_SEMANTIC_CHANGE", `${label}.stats.${field} is not the deterministic derived value.`);
  return bundle;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function graphMap(bundle) {
  return new Map(bundle.graphs.map((graph) => [graph.graphId, graph]));
}

function nodeMap(bundle) {
  return new Map(bundle.graphs.flatMap((graph) => graph.nodes.map((node) => [node.id, { graphId: graph.graphId, node }])));
}

function edgeKey(graphId, edge) {
  return `${graphId}\0${edge.from}\0${edge.relation}\0${edge.to}`;
}

function change({ graphId, entityType, entityId, fieldPath, before, after, classification }) {
  if (!classification) fail("UNCLASSIFIED_SEMANTIC_CHANGE", `No semantic classification for ${entityType} ${entityId} ${fieldPath}.`);
  return { graphId, entityType, entityId, fieldPath, before, after, classification, substantive: isSubstantiveClassification(classification) };
}

function compareNodeFields(prior, next, graphId) {
  const changes = [];
  const simple = ["title", "kind", "tier", "priority", "activation", "sourceRefs", "authority", "recommendations", "avoid", "successSignals", "tags", "defaultQuestion"];
  for (const field of simple) {
    if (!same(prior[field], next[field])) changes.push(change({ graphId, entityType: "node", entityId: next.id, fieldPath: field, before: prior[field], after: next[field], classification: NODE_SEMANTIC_FIELDS[field] }));
  }
  for (const field of EFFECT_KEYS) {
    if (!same(prior.effects[field], next.effects[field])) {
      const fieldPath = `effects.${field}`;
      changes.push(change({ graphId, entityType: "node", entityId: next.id, fieldPath, before: prior.effects[field], after: next.effects[field], classification: NODE_SEMANTIC_FIELDS[fieldPath] }));
    }
  }
  return changes;
}

export function buildCompleteSemanticDiff(baselineBundle, candidateBundle, { affectedCases = [], regressionCases = [] } = {}) {
  assertClassifiedGraphBundle(baselineBundle, { label: "baseline bundle" });
  assertClassifiedGraphBundle(candidateBundle, { label: "candidate bundle" });
  const cases = affectedCases.length ? affectedCases : regressionCases;
  const changes = [];
  for (const [field, classification] of Object.entries(BUNDLE_SEMANTIC_FIELDS)) {
    if (!same(baselineBundle[field], candidateBundle[field])) changes.push(change({ graphId: "$bundle", entityType: "bundle", entityId: "$bundle", fieldPath: field, before: baselineBundle[field], after: candidateBundle[field], classification }));
  }
  if (baselineBundle.stats.ownerAmendmentCount !== candidateBundle.stats.ownerAmendmentCount) changes.push(change({ graphId: "$bundle", entityType: "bundle", entityId: "$bundle", fieldPath: "stats.ownerAmendmentCount", before: baselineBundle.stats.ownerAmendmentCount, after: candidateBundle.stats.ownerAmendmentCount, classification: "generated-prohibited" }));
  const baselineGraphs = graphMap(baselineBundle);
  const candidateGraphs = graphMap(candidateBundle);
  for (const [graphId, graph] of candidateGraphs) {
    const prior = baselineGraphs.get(graphId);
    if (!prior) {
      changes.push(change({ graphId, entityType: "graph", entityId: graphId, fieldPath: "$add", before: null, after: graphId, classification: "substantive-graph-membership" }));
      continue;
    }
    for (const field of Object.keys(GRAPH_SEMANTIC_FIELDS)) {
      if (!same(prior[field], graph[field])) changes.push(change({ graphId, entityType: "graph", entityId: graphId, fieldPath: field, before: prior[field], after: graph[field], classification: GRAPH_SEMANTIC_FIELDS[field] }));
    }
  }
  for (const graphId of baselineGraphs.keys()) if (!candidateGraphs.has(graphId)) changes.push(change({ graphId, entityType: "graph", entityId: graphId, fieldPath: "$remove", before: graphId, after: null, classification: "substantive-graph-membership" }));

  const baselineNodes = nodeMap(baselineBundle);
  const candidateNodes = nodeMap(candidateBundle);
  for (const [id, entry] of candidateNodes) {
    const prior = baselineNodes.get(id);
    if (!prior) {
      changes.push(change({ graphId: entry.graphId, entityType: "node", entityId: id, fieldPath: "$add", before: null, after: entry.node, classification: "substantive-node-membership" }));
      continue;
    }
    if (prior.graphId !== entry.graphId) changes.push(change({ graphId: entry.graphId, entityType: "node", entityId: id, fieldPath: "graphMembership", before: prior.graphId, after: entry.graphId, classification: "substantive-graph-membership" }));
    changes.push(...compareNodeFields(prior.node, entry.node, entry.graphId));
  }
  for (const [id, prior] of baselineNodes) if (!candidateNodes.has(id)) changes.push(change({ graphId: prior.graphId, entityType: "node", entityId: id, fieldPath: "$remove", before: prior.node, after: null, classification: "substantive-node-membership" }));

  const baselineEdges = new Map(baselineBundle.graphs.flatMap((graph) => graph.edges.map((edge) => [edgeKey(graph.graphId, edge), { graphId: graph.graphId, edge }])));
  const candidateEdges = new Map(candidateBundle.graphs.flatMap((graph) => graph.edges.map((edge) => [edgeKey(graph.graphId, edge), { graphId: graph.graphId, edge }])));
  for (const [key, entry] of candidateEdges) if (!baselineEdges.has(key)) changes.push(change({ graphId: entry.graphId, entityType: "edge", entityId: digest({ graphId: entry.graphId, ...entry.edge }), fieldPath: "$add", before: null, after: entry.edge, classification: "substantive-topology" }));
  for (const [key, entry] of baselineEdges) if (!candidateEdges.has(key)) changes.push(change({ graphId: entry.graphId, entityType: "edge", entityId: digest({ graphId: entry.graphId, ...entry.edge }), fieldPath: "$remove", before: entry.edge, after: null, classification: "substantive-topology" }));

  changes.sort((left, right) => compareText(canonicalJson([left.graphId, left.entityType, left.entityId, left.fieldPath]), canonicalJson([right.graphId, right.entityType, right.entityId, right.fieldPath])));
  const prohibited = changes.filter((item) => ["immutable", "generated-prohibited", "prohibited-direct-edit"].includes(item.classification));
  if (prohibited.length) fail("PROHIBITED_SEMANTIC_CHANGE", `Proposal changes immutable/generated fields: ${prohibited.map((item) => `${item.entityId}.${item.fieldPath}`).join(", ")}`);
  const changedNodeIds = [...new Set(changes.flatMap((item) => item.entityType === "edge" ? [item.before?.from, item.before?.to, item.after?.from, item.after?.to] : item.entityType === "node" ? [item.entityId] : []).filter(Boolean))].sort(compareText);
  const caseRows = cases.filter((item) => (item.affectedNodeIds ?? []).some((id) => changedNodeIds.includes(id))).map((item) => ({ id: item.id, title: item.title, affectedNodeIds: item.affectedNodeIds.filter((id) => changedNodeIds.includes(id)).sort(compareText) })).sort((left, right) => compareText(left.id, right.id));
  return {
    contractVersion: "guide-behavioral-diff-v2",
    installedVersion: baselineBundle.version,
    baselineVersion: baselineBundle.version,
    candidateVersion: candidateBundle.version,
    changes,
    changedNodeIds,
    affectedCases: caseRows,
    substantive: changes.some((item) => item.substantive)
  };
}

export function buildCompleteDecisionCards(diff) {
  return diff.changes.filter((item) => item.substantive).map((item) => ({
    id: `decision-${digest({ graphId: item.graphId, entityType: item.entityType, entityId: item.entityId, fieldPath: item.fieldPath, before: item.before, after: item.after }).slice(0, 16)}`,
    title: `${item.entityType} ${item.entityId}: ${item.fieldPath}`,
    classification: item.classification,
    current: item.before === null ? "Not present." : canonicalJson(item.before).trim(),
    candidate: item.after === null ? "Removed." : canonicalJson(item.after).trim(),
    behavioralEffect: `Changes ${item.fieldPath} under the explicit ${item.classification} policy.`,
    pros: [approvalBenefit(item)],
    cons: [approvalCost(item)],
    affectedRegressions: diff.affectedCases.filter((row) => row.affectedNodeIds.includes(item.entityId) || item.entityType === "edge" && row.affectedNodeIds.some((id) => [item.before?.from, item.before?.to, item.after?.from, item.after?.to].includes(id))).map((row) => row.id),
    provenance: item.classification.includes("provenance") ? "source-and-authority-review" : "graph-proposal",
    recommended: "review",
    worstPlausibleFailure: worstFailure(item.classification),
    requiresHumanDecision: true,
    status: "pending"
  })).sort((left, right) => compareText(left.id, right.id));
}

function approvalBenefit(item) {
  if (item.fieldPath === "$add") return `Approving adds the exact ${item.entityType} shown in the candidate value, allowing the candidate route or relationship to exist.`;
  if (item.fieldPath === "$remove") return `Approving removes the exact ${item.entityType} shown in the current value, preventing that route or relationship from continuing to affect planning.`;
  if (item.fieldPath === "activation") return "Approving makes the candidate activation boundary explicit, so matching presentations can route according to the proposed conditions.";
  if (["tier", "priority", "graphMembership", "defaultQuestion"].includes(item.fieldPath)) return `Approving lets the candidate ${item.fieldPath} control routing or questioning exactly as shown.`;
  if (item.fieldPath.startsWith("effects.")) return `Approving makes the candidate ${item.fieldPath.slice(8)} constraint available to the planner or response realization exactly as shown.`;
  if (["sourceRefs", "authority"].includes(item.fieldPath)) return `Approving records the candidate ${item.fieldPath} as the explicit provenance/authority basis instead of leaving the current basis in place.`;
  if (["recommendations", "avoid", "successSignals"].includes(item.fieldPath)) return `Approving lets responses use the exact candidate ${item.fieldPath} rather than the current value.`;
  return `Approving records the exact candidate ${item.fieldPath} value and makes the public graph description match that reviewed choice.`;
}

function approvalCost(item) {
  if (item.classification.includes("safety")) return "The proposed new value could weaken or misplace a safety boundary if its conditions or wording are incomplete.";
  if (item.classification.includes("routing") || item.classification.includes("gating") || item.classification.includes("topology")) return "The proposed new value could select, delay, block, or sequence an intervention incorrectly in cases outside the reviewed examples.";
  if (item.classification.includes("provenance")) return "The proposed new provenance/authority value could overstate support or attach the behavior to the wrong source if approved without exact source review.";
  if (item.classification.includes("therapeutic") || item.classification.includes("response")) return "The proposed new response value could be unhelpful, overconfident, or too broad for people whose presentation differs from the tested cases.";
  if (item.classification === "reviewed-metadata") return "The proposed new metadata could misdescribe the graph or create misleading review/search results even if planner behavior is unchanged.";
  return "The proposed new value could encode an unintended semantic distinction that is not represented in the reviewed regressions.";
}

function worstFailure(classification) {
  if (classification.includes("safety")) return "The change could weaken a safety boundary or produce an unsafe response under an untested condition.";
  if (classification.includes("routing") || classification.includes("gating") || classification.includes("topology")) return "The change could select, defer, or sequence the wrong intervention for an affected case.";
  if (classification.includes("provenance")) return "The change could present unsupported material with stronger authority than its source permits.";
  if (classification.includes("therapeutic") || classification.includes("response")) return "The change could realize guidance that is unhelpful, overconfident, or inconsistent with the intended therapy distinction.";
  return "The change could conceal an unintended semantic difference or make the public development record misleading.";
}
