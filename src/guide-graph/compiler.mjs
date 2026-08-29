import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectRoot } from "../core/config.mjs";
import { ValidationError } from "../core/errors.mjs";
import { buildTextSourceMap } from "./source-map.mjs";
import { GUIDE_GRAPH_BUNDLE_VERSION, GUIDE_GRAPH_CONTRACT } from "./contract.mjs";
import { validateGraph } from "./validate.mjs";

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function sha256File(file) {
  const data = await fs.readFile(file);
  return createHash("sha256").update(data).digest("hex");
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, body);
  await fs.rename(tmp, file);
}

function buildOwnerSourceMap(amendments) {
  return {
    guideId: "owner-amendments",
    file: "owner-amendments.json",
    sections: amendments.items.map((item) => ({
      id: item.id,
      heading: item.id,
      lineStart: null,
      lineEnd: null,
      sha256: createHash("sha256").update(item.text).digest("hex"),
      excerpt: item.text,
      status: item.status,
      domain: item.domain
    }))
  };
}

function buildPdfSourceMap(layout, sourceById) {
  return {
    guideId: "vagal-blitz-source",
    file: sourceById.get("vagal-blitz-source")?.file,
    sections: layout.pdfSections.map((section) => ({
      id: section.id,
      sourceId: section.sourceId,
      pages: section.pages,
      sha256: sourceById.get(section.sourceId)?.sha256,
      excerpt: `PDF source pages ${section.pages.join(", ")}`
    }))
  };
}

function graphReport(bundle, amendments) {
  const graphRows = bundle.graphs.map((graph) => `- ${graph.graphId}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  const authorityCounts = {};
  for (const graph of bundle.graphs) {
    for (const node of graph.nodes) authorityCounts[node.authority] = (authorityCounts[node.authority] ?? 0) + 1;
  }
  const amendmentRows = amendments.items.map((item) => `- ${item.id}: ${item.text}`);
  return `# Inner Signal guide-graph pilot\n\n` +
    `Bundle: \`${bundle.version}\`\n\n` +
    `## Compiled graphs\n\n${graphRows.join("\n")}\n\n` +
    `## Authority labels\n\n${Object.entries(authorityCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n` +
    `## Owner-approved extensions applied\n\n${amendmentRows.join("\n")}\n\n` +
    `## Cross-guide decisions encoded\n\n` +
    `- Early reparenting can run alongside regulation when it stays present-focused.\n` +
    `- Gentle self-hypnosis may prepare but does not imply readiness for memories or immersive child dialogue.\n` +
    `- Love can be borrowed from an already-loved being without forcing immediate self-transfer.\n` +
    `- The best-friend question supplies one bounded Nurturer, Protector, or Guide function.\n` +
    `- Borrowed adulthood can support the part attempting the adult role when it needs a non-retaliatory response model, not only the younger state.\n` +
    `- Witness capacity is tracked separately from adult-role capacity; a person who can already observe several internal positions is not sent back through witness bootstrap.\n` +
    `- Credibility repair distinguishes an empty record from an adverse track record already being used as evidence against the adult promise.\n` +
    `- Resentful chronological-adult speech and the attempted Nurturer/Protector role remain separate unless the user establishes that they are the same speaker.\n` +
    `- Developmental EMDR may follow basic reparenting capacity; a stable discrete target is different.\n` +
    `- Advanced release is optional and parallel, not proof of readiness; bliss requires a bypass audit.\n` +
    `- Personal and community claims remain provenance-labelled rather than promoted to established medical fact.\n\n` +
    `## Deliberate constraints\n\n` +
    `- The planner routes by function, dose, target, and capacity rather than modality name alone.\n` +
    `- Safety, orientation, stopping, and return capacity outrank all therapeutic preferences.\n` +
    `- Source text remains unchanged; additions live in owner-amendments.json.\n` +
    `- The deterministic plan owns the substantive next question; response realization cannot replace it with a merely interesting question.\n` +
    `- Advanced-release nodes never coach syncope, substance potentiation, or standing lightheadedness.\n`;
}

export async function compileGuideGraphs({ root = projectRoot, write = true, candidateGraphs = null } = {}) {
  const guidesDir = path.join(root, "guides");
  const graphRoot = path.join(root, "guide-graphs");
  const manifest = await readJson(path.join(guidesDir, "manifest.json"));
  const layout = await readJson(path.join(guidesDir, "source-layout.json"));
  const amendments = await readJson(path.join(guidesDir, "owner-amendments.json"));
  if (manifest.graphContractVersion !== GUIDE_GRAPH_CONTRACT) throw new ValidationError("Guide manifest graph contract mismatch.");
  if (manifest.version !== GUIDE_GRAPH_BUNDLE_VERSION) throw new ValidationError("Guide manifest bundle version mismatch.");

  const sourceById = new Map(manifest.sources.map((source) => [source.id, source]));
  for (const source of manifest.sources.filter((entry) => entry.sha256)) {
    const actual = await sha256File(path.join(guidesDir, source.file));
    if (actual !== source.sha256) throw new ValidationError(`Source hash mismatch for ${source.file}.`);
  }

  const textMaps = [];
  for (const guide of layout.textGuides) textMaps.push(await buildTextSourceMap({ root, guide }));
  const ownerMap = buildOwnerSourceMap(amendments);
  const pdfMap = buildPdfSourceMap(layout, sourceById);
  const sourceMaps = [...textMaps, ownerMap, pdfMap];
  const sourceIndex = new Set(sourceMaps.flatMap((map) => map.sections.map((section) => section.id)));

  const graphFiles = ["inner-child.graph.json", "somatic.graph.json", "cross-guide.graph.json"];
  const graphs = candidateGraphs === null
    ? await Promise.all(graphFiles.map((file) => readJson(path.join(graphRoot, "candidates", file))))
    : structuredClone(candidateGraphs);
  if (!Array.isArray(graphs)) throw new ValidationError("Candidate graph override must be an array.");
  const expectedGraphIds = new Set(["inner-child-directed-graph", "somatic-directed-graph", "inner-child-somatic-cross-guide"]);
  if (candidateGraphs !== null && (graphs.length !== expectedGraphIds.size || graphs.some((graph) => !expectedGraphIds.has(graph.graphId)))) {
    throw new ValidationError("Candidate graph override must contain exactly the three canonical graph ids.");
  }
  const allNodeIds = new Set(graphs.flatMap((graph) => graph.nodes.map((node) => node.id)));
  graphs.forEach((graph) => validateGraph(graph, { knownSourceRefs: sourceIndex, knownNodeIds: allNodeIds }));
  const duplicateNodeIds = graphs.flatMap((graph) => graph.nodes.map((node) => node.id));
  if (new Set(duplicateNodeIds).size !== duplicateNodeIds.length) throw new ValidationError("Node ids must be unique across the graph bundle.");

  const compiledGraphs = graphs.map((graph) => ({ ...graph, bundleVersion: manifest.version }));
  const bundle = {
    contractVersion: GUIDE_GRAPH_CONTRACT,
    version: manifest.version,
    sourceManifestVersion: manifest.version,
    sourceMaps,
    graphs: compiledGraphs,
    stats: {
      graphCount: compiledGraphs.length,
      nodeCount: compiledGraphs.reduce((sum, graph) => sum + graph.nodes.length, 0),
      edgeCount: compiledGraphs.reduce((sum, graph) => sum + graph.edges.length, 0),
      sourceSectionCount: sourceMaps.reduce((sum, map) => sum + map.sections.length, 0),
      ownerAmendmentCount: amendments.items.length
    }
  };

  if (write) {
    if (candidateGraphs !== null) throw new ValidationError("Candidate graph overrides may only be compiled with write:false.");
    for (const map of sourceMaps) await atomicWrite(path.join(graphRoot, "source-maps", `${map.guideId}.json`), map);
    for (const graph of compiledGraphs) await atomicWrite(path.join(graphRoot, "compiled", `${graph.graphId}.json`), graph);
    await atomicWrite(path.join(graphRoot, "compiled", "bundle.json"), bundle);
    await atomicWrite(path.join(graphRoot, "reports", "inner-child-somatic-pilot.md"), graphReport(bundle, amendments));
  }
  return bundle;
}

export async function loadCompiledGuideGraphBundle({ root = projectRoot, packetRoot = null } = {}) {
  if (packetRoot) {
    const active = path.join(packetRoot, "installed", "current", "contents", "graphs", "bundle.json");
    try {
      const bundle = await readJson(active);
      if (bundle.contractVersion !== GUIDE_GRAPH_CONTRACT) throw new ValidationError("Installed guide packet graph contract mismatch.");
      const nodeIds = new Set(bundle.graphs.flatMap((graph) => (graph.nodes ?? []).map((node) => node.id)));
      for (const graph of bundle.graphs) validateGraph(graph, { knownSourceRefs: null, knownNodeIds: nodeIds });
      return bundle;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const file = path.join(root, "guide-graphs", "compiled", "bundle.json");
  const bundle = await readJson(file);
  if (bundle.contractVersion !== GUIDE_GRAPH_CONTRACT || bundle.version !== GUIDE_GRAPH_BUNDLE_VERSION) {
    throw new ValidationError("Compiled guide graph bundle is missing or stale. Run npm run graph:compile.");
  }
  return bundle;
}
