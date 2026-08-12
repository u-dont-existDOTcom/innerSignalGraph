function flattenSections(sectionsByGuide) {
  return Object.values(sectionsByGuide ?? {}).flat();
}

function detectCycle(graphs) {
  const adjacency = new Map();
  for (const graph of graphs ?? []) {
    for (const edge of graph.edges ?? []) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push(edge.to);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = (node) => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) if (walk(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...adjacency.keys()].some(walk);
}

export function runGuideQualityAudit({ manifest, sectionsByGuide, graphs, provenance, ownerAmendments }) {
  const findings = [];
  const sections = flattenSections(sectionsByGuide);
  const sectionIds = new Set(sections.map((item) => item.id));
  const amendments = ownerAmendments?.items ?? [];
  const amendmentIds = new Set(amendments.map((item) => item.id));
  const nodes = (graphs ?? []).flatMap((graph) => graph.nodes ?? []);
  const edges = (graphs ?? []).flatMap((graph) => graph.edges ?? []);
  const nodeIds = new Set(nodes.map((item) => item.id));
  const referencedSections = new Set(nodes.flatMap((item) => item.sourceRefs ?? []).filter((id) => sectionIds.has(id)));

  for (const amendment of amendments) {
    if (amendment.sourceIntegrated === false) {
      findings.push({
        code: "GRAPH_ONLY_OWNER_AMENDMENT",
        severity: amendment.domain === "product-only" ? "info" : "review",
        guideId: amendment.domain,
        sourceRef: amendment.id,
        summary: `Owner amendment ${amendment.id} is not present in canonical guide prose.`,
        recommendation: amendment.domain === "product-only" ? "Keep explicitly product-only." : "Decide whether to integrate it into the article or retain explicit graph-only provenance."
      });
    }
  }

  const categoricalPatterns = [
    /can only heal so far in isolation/i,
    /the harmful move was the only one/i,
    /you cannot safely process trauma/i
  ];
  for (const section of sections) {
    const text = `${section.heading ?? ""} ${section.excerpt ?? ""}`;
    if (categoricalPatterns.some((pattern) => pattern.test(text))) {
      findings.push({
        code: "CATEGORICAL_SOURCE_WORDING",
        severity: "review",
        guideId: section.guideId ?? manifest?.guides?.find((guide) => guide.sourceMapPath?.includes(section.id))?.id ?? "unknown",
        sourceRef: section.id,
        summary: `Source wording in “${section.heading}” may compile as a universal rule.`,
        recommendation: "Keep the executable graph conditional or revise the article wording after owner review."
      });
    }
  }

  for (const node of nodes) {
    const supported = (node.sourceRefs ?? []).some((id) => sectionIds.has(id) || amendmentIds.has(id));
    if (!supported) findings.push({ code: "NODE_WITHOUT_SOURCE_SUPPORT", severity: "block", nodeId: node.id, summary: `${node.id} has no source or owner-amendment support.` });
  }
  for (const section of sections) {
    if (!referencedSections.has(section.id) && section.level <= 2) {
      findings.push({ code: "SOURCE_SECTION_WITHOUT_GRAPH_REPRESENTATION", severity: "info", sourceRef: section.id, summary: `Section “${section.heading}” has no direct executable graph reference.` });
    }
  }

  const incoming = new Set(edges.map((edge) => edge.to));
  const outgoing = new Set(edges.map((edge) => edge.from));
  for (const node of nodes) {
    if (!incoming.has(node.id) && !outgoing.has(node.id) && Number(node.priority) < 95) {
      findings.push({ code: "ISOLATED_GRAPH_NODE", severity: "review", nodeId: node.id, summary: `${node.id} is isolated from graph sequencing.` });
    }
  }
  if (detectCycle(graphs)) findings.push({ code: "PREREQUISITE_CYCLE", severity: "block", summary: "The candidate graph contains a directed cycle." });

  for (const node of nodes) {
    const nodeProv = provenance?.nodes?.[node.id];
    if (!nodeProv) findings.push({ code: "MISSING_NODE_PROVENANCE", severity: "block", nodeId: node.id, summary: `${node.id} lacks provenance.` });
    if (nodeProv?.certainty === "established" && ["author-experience", "community-signal", "provisional-mechanism", "traditional-explanation"].includes(nodeProv.role)) {
      findings.push({ code: "CERTAINTY_EXCEEDS_PROVENANCE", severity: "block", nodeId: node.id, summary: `${node.id} claims established certainty from ${nodeProv.role}.` });
    }
  }

  return {
    contractVersion: "guide-quality-audit-v1",
    generatedAt: manifest?.createdAt ?? new Date().toISOString(),
    counts: {
      total: findings.length,
      block: findings.filter((item) => item.severity === "block").length,
      review: findings.filter((item) => item.severity === "review").length,
      info: findings.filter((item) => item.severity === "info").length
    },
    findings
  };
}
