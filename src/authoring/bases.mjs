import fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";

const EXPECTED_BASES = ["Edges.base", "Nodes.base", "Overlays.base", "Proposals.base", "Regressions.base", "Sources.base"];
const ALLOWED_PROPERTIES = new Set([
  "file", "node_id", "title", "graph_id", "tier", "priority", "authority", "source_refs", "graph_tags", "regression_refs",
  "projection_mode", "proposal_id", "operation", "entity_type", "edge_id", "from_node_id", "relation", "to_node_id", "source_id",
  "guide_id", "heading", "source_role", "source_hash", "section_hash", "cited_by_node_ids", "case_id", "affected_node_ids",
  "expected_primary", "expected_question", "safety_relevance", "passed", "status", "target_graph_ids", "declared_regression_ids",
  "contains_therapy_semantic_change", "contains_documentation_overlay_change", "overlay_id", "anchors", "reconciled_nodes", "map_id"
]);

function fail(message) {
  const error = new Error(message);
  error.code = "AUTHORING_BASE_INVALID";
  throw error;
}

function validateProperty(value, label) {
  if (typeof value !== "string" || !ALLOWED_PROPERTIES.has(value)) fail(`${label} refers to disallowed property ${value}.`);
}

function validateFilter(value, label) {
  if (typeof value !== "string") fail(`${label} must be a string expression.`);
  const propertyPattern = /\b([a-z][a-z0-9_]*)(?=\.(?:inFolder|contains|isEmpty)\b|\s*(?:==|!=))/g;
  for (const match of value.matchAll(propertyPattern)) validateProperty(match[1], label);
}

export function validateBaseDefinition(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a mapping.`);
  if (!Array.isArray(value.views) || !value.views.length) fail(`${label} must contain views.`);
  const validateFilters = (filters, filterLabel) => {
    if (!filters) return;
    if (typeof filters === "string") return validateFilter(filters, filterLabel);
    if (filters && typeof filters === "object" && Array.isArray(filters.and)) {
      filters.and.forEach((item, index) => validateFilter(item, `${filterLabel}.and[${index}]`));
      return;
    }
    fail(`${filterLabel} has an unsupported filter shape.`);
  };
  validateFilters(value.filters, `${label}.filters`);
  for (const [index, view] of value.views.entries()) {
    if (!view || typeof view !== "object" || Array.isArray(view)) fail(`${label}.views[${index}] must be a mapping.`);
    if (view.type !== "table" || typeof view.name !== "string") fail(`${label}.views[${index}] must be a named table.`);
    if (!Array.isArray(view.order)) fail(`${label}.views[${index}].order must be a list.`);
    view.order.forEach((property) => validateProperty(property, `${label}.views[${index}].order`));
    if (view.groupBy) validateProperty(view.groupBy, `${label}.views[${index}].groupBy`);
    validateFilters(view.filters, `${label}.views[${index}].filters`);
  }
  return value;
}

export async function validateBases({ root }) {
  const baseRoot = path.join(root, "authoring", "obsidian", "bases");
  const files = (await fs.readdir(baseRoot)).filter((file) => file.endsWith(".base")).sort();
  if (JSON.stringify(files) !== JSON.stringify(EXPECTED_BASES)) fail(`Base inventory differs: ${files.join(", ")}`);
  for (const file of files) {
    const text = await fs.readFile(path.join(baseRoot, file), "utf8");
    const { data } = parseFrontmatter(`---\n${text}---\n`, { label: file });
    validateBaseDefinition(data, file);
  }
  return { ok: true, count: files.length, files };
}
