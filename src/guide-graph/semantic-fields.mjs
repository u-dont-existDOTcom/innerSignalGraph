export const GRAPH_SEMANTIC_FIELDS = Object.freeze({
  contractVersion: "immutable",
  graphId: "immutable",
  guideId: "provenance-policy",
  version: "generated-prohibited",
  description: "reviewed-metadata",
  bundleVersion: "generated-prohibited",
  sourceRevision: "generated-prohibited"
});

export const NODE_SEMANTIC_FIELDS = Object.freeze({
  id: "prohibited-direct-edit",
  title: "reviewed-substantive",
  kind: "substantive-structural",
  tier: "substantive-routing",
  priority: "substantive-routing",
  activation: "substantive-routing-safety",
  sourceRefs: "provenance-policy",
  authority: "provenance-policy",
  recommendations: "therapeutic-response",
  avoid: "therapeutic-safety",
  successSignals: "therapeutic-evaluation",
  tags: "reviewed-metadata",
  "effects.deferNodes": "substantive-gating",
  "effects.blockNodes": "substantive-gating-safety",
  "effects.requiredNuance": "response-semantics",
  "effects.forbiddenOverclaims": "response-safety",
  defaultQuestion: "substantive-response-routing"
});

export const EDGE_SEMANTIC_FIELDS = Object.freeze({
  from: "substantive-topology",
  relation: "substantive-topology",
  to: "substantive-topology"
});

export const BUNDLE_SEMANTIC_FIELDS = Object.freeze({
  contractVersion: "immutable",
  version: "generated-prohibited",
  sourceManifestVersion: "generated-prohibited",
  sourceMaps: "generated-prohibited"
});

export const GRAPH_KEYS = Object.freeze(["contractVersion", "graphId", "guideId", "version", "description", "nodes", "edges", "bundleVersion", "sourceRevision"]);
export const NODE_KEYS = Object.freeze(["id", "title", "kind", "tier", "priority", "activation", "sourceRefs", "authority", "recommendations", "avoid", "successSignals", "tags", "effects", "defaultQuestion"]);
export const ACTIVATION_KEYS = Object.freeze(["all", "any", "none"]);
export const CONDITION_KEYS = Object.freeze(["field", "op", "value"]);
export const EFFECT_KEYS = Object.freeze(["deferNodes", "blockNodes", "requiredNuance", "forbiddenOverclaims"]);
export const EDGE_KEYS = Object.freeze(["from", "relation", "to"]);
export const BUNDLE_KEYS = Object.freeze(["contractVersion", "version", "sourceManifestVersion", "sourceMaps", "graphs", "stats"]);
export const BUNDLE_STATS_KEYS = Object.freeze(["graphCount", "nodeCount", "edgeCount", "sourceSectionCount", "ownerAmendmentCount"]);

export function isSubstantiveClassification(classification) {
  return !["generated-prohibited", "immutable", "prohibited-direct-edit"].includes(classification);
}
