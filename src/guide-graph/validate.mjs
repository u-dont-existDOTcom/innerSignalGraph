import { CASE_VARIABLE_ENUMS, GUIDE_GRAPH_CONTRACT } from "./contract.mjs";
import { ValidationError } from "../core/errors.mjs";

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError(`${label} must be a non-empty string.`);
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be an array of strings.`);
  }
}

function validateCondition(condition, label) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new ValidationError(`${label} must be an object.`);
  requireString(condition.field, `${label}.field`);
  if (!Object.hasOwn(CASE_VARIABLE_ENUMS, condition.field)) throw new ValidationError(`${label}.field is unknown: ${condition.field}`);
  if (!["eq", "in", "notEq", "notIn"].includes(condition.op)) throw new ValidationError(`${label}.op is unsupported: ${condition.op}`);
  const allowed = CASE_VARIABLE_ENUMS[condition.field];
  const values = ["in", "notIn"].includes(condition.op) ? condition.value : [condition.value];
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !allowed.includes(value))) {
    throw new ValidationError(`${label}.value contains a value outside ${condition.field}'s enum.`);
  }
}

export function validateGraph(graph, { knownSourceRefs = null, knownNodeIds = null } = {}) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) throw new ValidationError("Graph must be an object.");
  if (graph.contractVersion !== GUIDE_GRAPH_CONTRACT) throw new ValidationError(`Graph contract must be ${GUIDE_GRAPH_CONTRACT}.`);
  for (const key of ["graphId", "guideId", "version", "description"]) requireString(graph[key], key);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new ValidationError("Graph nodes and edges must be arrays.");
  const ids = new Set();
  for (const [index, node] of graph.nodes.entries()) {
    const label = `${graph.graphId}.nodes[${index}]`;
    for (const key of ["id", "title", "kind", "authority"]) requireString(node[key], `${label}.${key}`);
    if (ids.has(node.id)) throw new ValidationError(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!Number.isInteger(node.tier) || node.tier < 1 || node.tier > 9) throw new ValidationError(`${label}.tier must be 1-9.`);
    if (!Number.isInteger(node.priority) || node.priority < 0 || node.priority > 100) throw new ValidationError(`${label}.priority must be 0-100.`);
    for (const key of ["sourceRefs", "recommendations", "avoid", "successSignals", "tags"]) requireStringArray(node[key], `${label}.${key}`);
    if (knownSourceRefs) {
      for (const ref of node.sourceRefs) if (!knownSourceRefs.has(ref)) throw new ValidationError(`${node.id} cites unknown source ref ${ref}.`);
    }
    const activation = node.activation ?? {};
    for (const group of ["all", "any", "none"]) {
      const list = activation[group] ?? [];
      if (!Array.isArray(list)) throw new ValidationError(`${label}.activation.${group} must be an array.`);
      list.forEach((condition, conditionIndex) => validateCondition(condition, `${label}.activation.${group}[${conditionIndex}]`));
    }
    const effects = node.effects ?? {};
    for (const key of ["deferNodes", "blockNodes", "requiredNuance", "forbiddenOverclaims"]) requireStringArray(effects[key] ?? [], `${label}.effects.${key}`);
    if (node.defaultQuestion != null && typeof node.defaultQuestion !== "string") throw new ValidationError(`${label}.defaultQuestion must be a string.`);
  }
  const allNodeIds = knownNodeIds ? new Set([...knownNodeIds, ...ids]) : ids;
  for (const node of graph.nodes) {
    for (const key of ["deferNodes", "blockNodes"]) {
      for (const target of node.effects?.[key] ?? []) {
        if (!allNodeIds.has(target)) throw new ValidationError(`${node.id}.effects.${key} references unknown node ${target}.`);
      }
    }
  }
  const edgeKeys = new Set();
  for (const [index, edge] of graph.edges.entries()) {
    const label = `${graph.graphId}.edges[${index}]`;
    for (const key of ["from", "to", "relation"]) requireString(edge[key], `${label}.${key}`);
    if (!allNodeIds.has(edge.from)) throw new ValidationError(`${label}.from references unknown node ${edge.from}.`);
    if (!allNodeIds.has(edge.to)) throw new ValidationError(`${label}.to references unknown node ${edge.to}.`);
    if (edge.from === edge.to) throw new ValidationError(`${label} cannot be a self-edge.`);
    const edgeKey = `${edge.from}|${edge.relation}|${edge.to}`;
    if (edgeKeys.has(edgeKey)) throw new ValidationError(`Duplicate edge ${edgeKey}.`);
    edgeKeys.add(edgeKey);
  }
  return graph;
}

export function validateCaseVariables(variables) {
  const normalized = {};
  for (const [field, allowed] of Object.entries(CASE_VARIABLE_ENUMS)) {
    const value = variables?.[field] ?? "unknown";
    if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}.`);
    normalized[field] = value;
  }
  return normalized;
}
