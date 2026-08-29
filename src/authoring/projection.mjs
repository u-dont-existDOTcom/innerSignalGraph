import fs from "node:fs/promises";
import path from "node:path";
import { compileGuideGraphs } from "../guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../guide-graph/regressions.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { canonicalJson, sha256Bytes, sha256Canonical } from "./canonical-json.mjs";
import { AUTHORING_CONTRACTS, assertUniquePortableIds, edgeDigest, edgeId, validateSchema } from "./contract.mjs";
import { renderCanvas } from "./canvas-generator.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";
import { parseAuthoringNote } from "./note-parser.mjs";
import { renderFrontmatterNote, renderNodeNote } from "./note-renderer.mjs";
import { loadOverlayRegistries } from "./overlay.mjs";
import { assertNoSymlinkAncestors, assertPublicAuthoringText } from "./private-data-boundary.mjs";

const GRAPH_FILES = [
  "guide-graphs/candidates/cross-guide.graph.json",
  "guide-graphs/candidates/inner-child.graph.json",
  "guide-graphs/candidates/somatic.graph.json"
];
const SEMANTIC_CODE_INPUTS = [
  "src/guide-graph/compiler.mjs",
  "src/guide-graph/contract.mjs",
  "src/guide-graph/planner.mjs",
  "src/guide-graph/regressions.mjs",
  "src/guide-graph/source-map.mjs",
  "src/guide-graph/validate.mjs"
];
const RESOLUTION_PATH = "authoring/migration/owner-map-resolution-2026-08-29.json";

export function projectionInputToken(records) {
  return sha256Canonical([...records].sort((left, right) => compareText(left.path, right.path)));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readRegular(root, relative) {
  assertNoSymlinkAncestors(root, relative, { allowMissingLeaf: false });
  const absolute = path.join(root, relative);
  return withOpenedRegularFile(absolute, (handle) => handle.readFile());
}

async function readJson(root, relative) {
  return JSON.parse((await readRegular(root, relative)).toString("utf8"));
}

async function fileHashRecord(root, relative) {
  return { path: relative.split(path.sep).join("/"), sha256: sha256Bytes(await readRegular(root, relative)) };
}

async function listJsonFiles(root, relative) {
  assertNoSymlinkAncestors(root, relative, { allowMissingLeaf: false });
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const invalid = entries.filter((entry) => entry.isSymbolicLink() || entry.name.endsWith(".json") && !entry.isFile());
  if (invalid.length) throw Object.assign(new Error(`${relative} contains non-regular JSON inputs: ${invalid.map((entry) => entry.name).join(", ")}`), { code: "AUTHORING_SYMLINK_FORBIDDEN" });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .map((file) => `${relative}/${file}`);
}

function exactCompiledBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function verifyCommittedCompilation(root, bundle) {
  const expected = new Map([["guide-graphs/compiled/bundle.json", exactCompiledBytes(bundle)]]);
  for (const graph of bundle.graphs) expected.set(`guide-graphs/compiled/${graph.graphId}.json`, exactCompiledBytes(graph));
  for (const [relative, bytes] of expected) {
    const actual = await readRegular(root, relative);
    if (!actual.equals(bytes)) {
      const error = new Error(`${relative} differs from a fresh read-only compile.`);
      error.code = "COMPILED_GRAPH_DRIFT";
      throw error;
    }
  }
}

function graphCandidatePath(graphId) {
  const paths = {
    "inner-child-directed-graph": "guide-graphs/candidates/inner-child.graph.json",
    "somatic-directed-graph": "guide-graphs/candidates/somatic.graph.json",
    "inner-child-somatic-cross-guide": "guide-graphs/candidates/cross-guide.graph.json"
  };
  return paths[graphId];
}

function sourceRoleByGuide(manifest) {
  return new Map(manifest.sources.map((source) => [source.id, source.role]));
}

function sourcePath(guideId, sourceId) {
  return `current/sources/${guideId}/${sourceId}.md`;
}

function nodePath(graphId, nodeId) {
  return `current/nodes/${graphId}/${nodeId}.md`;
}

function edgePath(graphId, edge) {
  return `current/edges/${graphId}/${edgeId({ graphId, ...edge })}.md`;
}

function notePayload(node) {
  return {
    activation: structuredClone(node.activation),
    recommendations: structuredClone(node.recommendations),
    avoid: structuredClone(node.avoid),
    successSignals: structuredClone(node.successSignals),
    effects: structuredClone(node.effects),
    defaultQuestion: node.defaultQuestion
  };
}

function regressionNodeIds(definition, result) {
  const expected = definition.expected ?? {};
  return [...new Set([
    expected.primary,
    ...(expected.selectedIncludes ?? []),
    ...(expected.selectedExcludes ?? []),
    ...(expected.matchedIncludes ?? []),
    ...(expected.deferredIncludes ?? []),
    ...(expected.blockedIncludes ?? []),
    ...(result.selected ?? []),
    ...(result.deferred ?? []),
    ...(result.blocked ?? [])
  ].filter(Boolean))].sort(compareText);
}

function renderStructuredNote({ frontmatter, heading, warning, value, prose = "" }) {
  return renderFrontmatterNote({
    frontmatter,
    heading,
    body: `${warning ? `> [!warning] ${warning}\n\n` : ""}${prose}${prose ? "\n\n" : ""}\`\`\`json\n${canonicalJson(value).trimEnd()}\n\`\`\``
  });
}

export async function loadCurrentAuthority({ root }) {
  const manifest = await readJson(root, "guides/manifest.json");
  const layout = await readJson(root, "guides/source-layout.json");
  const amendments = await readJson(root, "guides/owner-amendments.json");
  const ownerResolution = await readJson(root, RESOLUTION_PATH);
  const sourceFiles = manifest.sources.filter((source) => source.file).map((source) => `guides/${source.file}`);
  await Promise.all([...GRAPH_FILES, ...sourceFiles, ...SEMANTIC_CODE_INPUTS].map((relative) => readRegular(root, relative)));
  const bundle = await compileGuideGraphs({ root, write: false });
  await verifyCommittedCompilation(root, bundle);
  const regressionPaths = await listJsonFiles(root, "corpus/graph-cases");
  const regressionCases = await Promise.all(regressionPaths.map((relative) => readJson(root, relative)));
  const regressionResults = await runGraphRegressionSuite({ root, bundle, cases: regressionCases });
  if (!regressionResults.ok) throw Object.assign(new Error("Current graph regressions fail; projection stopped."), { code: "AUTHORING_BASE_REGRESSION_FAILURE" });

  const overlayPaths = (await listJsonFiles(root, "authoring/overlays")).filter((file) => file.endsWith(".overlay.json"));
  const compiledPaths = ["guide-graphs/compiled/bundle.json", ...bundle.graphs.map((graph) => `guide-graphs/compiled/${graph.graphId}.json`)];
  const inputPaths = [...new Set([
    ...GRAPH_FILES,
    ...compiledPaths,
    "guides/manifest.json",
    "guides/source-layout.json",
    "guides/owner-amendments.json",
    ...sourceFiles,
    ...regressionPaths,
    ...overlayPaths,
    RESOLUTION_PATH,
    ...SEMANTIC_CODE_INPUTS
  ])].sort(compareText);
  const authoritativeInputs = await Promise.all(inputPaths.map((relative) => fileHashRecord(root, relative)));
  authoritativeInputs.sort((left, right) => compareText(left.path, right.path));
  const projectionInputSha256 = projectionInputToken(authoritativeInputs);
  const graphHashes = new Map((await Promise.all(GRAPH_FILES.map((relative) => fileHashRecord(root, relative)))).map((record) => [record.path, record.sha256]));
  const additionalSourceIds = ownerResolution.decisions.map((decision) => decision.id);
  const registries = await loadOverlayRegistries({ root, bundle, additionalSourceIds });
  return {
    root,
    bundle,
    manifest,
    layout,
    amendments,
    ownerResolution,
    regressionPaths,
    regressionCases,
    regressionResults,
    overlayPaths,
    registries,
    authoritativeInputs,
    projectionInputSha256,
    graphHashes
  };
}

export function buildCurrentProjection(authority) {
  const output = new Map();
  const { bundle, manifest, amendments, ownerResolution, regressionCases, regressionResults, projectionInputSha256, registries, graphHashes } = authority;
  const sourceById = new Map();
  const roleByGuide = sourceRoleByGuide(manifest);
  for (const sourceMap of bundle.sourceMaps) {
    assertUniquePortableIds(sourceMap.sections.map((section) => section.id), { label: `${sourceMap.guideId} source ids` });
    for (const section of sourceMap.sections) {
      if (sourceById.has(section.id)) throw Object.assign(new Error(`Duplicate source id: ${section.id}`), { code: "SOURCE_ID_DUPLICATE" });
      sourceById.set(section.id, { ...section, guideId: sourceMap.guideId, file: sourceMap.file });
    }
  }
  const regressionByNode = new Map();
  for (const [index, definition] of regressionCases.entries()) {
    const ids = regressionNodeIds(definition, regressionResults.results[index]);
    for (const nodeId of ids) regressionByNode.set(nodeId, [...(regressionByNode.get(nodeId) ?? []), definition.id]);
  }

  const allNodeIds = bundle.graphs.flatMap((graph) => graph.nodes.map((node) => node.id));
  const nodeOwnerGraph = new Map(bundle.graphs.flatMap((graph) => graph.nodes.map((node) => [node.id, graph.graphId])));
  assertUniquePortableIds(allNodeIds, { label: "graph node ids" });
  const edgePrefixes = new Map();
  for (const graph of bundle.graphs) {
    const candidatePath = graphCandidatePath(graph.graphId);
    const baseGraphSha256 = graphHashes.get(candidatePath);
    for (const node of graph.nodes) {
      const frontmatter = {
        authoring_contract: AUTHORING_CONTRACTS.nodeCurrent,
        entity_type: "graph-node",
        projection_mode: "current",
        generated: true,
        graph_id: graph.graphId,
        node_id: node.id,
        title: node.title,
        kind: node.kind,
        tier: node.tier,
        priority: node.priority,
        authority: node.authority,
        graph_tags: node.tags,
        source_refs: node.sourceRefs,
        regression_refs: [...(regressionByNode.get(node.id) ?? [])].sort(compareText),
        base_record_sha256: sha256Canonical(node),
        base_graph_sha256: baseGraphSha256,
        projection_input_sha256: projectionInputSha256
      };
      validateSchema("nodeCurrent", frontmatter, { label: node.id });
      const navigation = node.sourceRefs.map((sourceId) => {
        const source = sourceById.get(sourceId);
        if (!source) throw Object.assign(new Error(`${node.id} cites unknown source ${sourceId}.`), { code: "SOURCE_REF_UNKNOWN" });
        return source.guideId === "owner-amendments"
          ? `current/governance/amendments/${sourceId}`
          : `current/sources/${source.guideId}/${sourceId}`;
      });
      output.set(nodePath(graph.graphId, node.id), renderNodeNote({
        frontmatter,
        payload: notePayload(node),
        heading: node.title,
        warning: "Generated current-state projection — do not edit. Create a proposal from this node.",
        navigation
      }));
    }
    for (const edge of graph.edges) {
      const digest = edgeDigest({ graphId: graph.graphId, ...edge });
      const prefix = digest.slice(0, 16);
      if (edgePrefixes.has(prefix) && edgePrefixes.get(prefix) !== digest) throw Object.assign(new Error(`Edge digest prefix collision: ${prefix}`), { code: "EDGE_PREFIX_COLLISION" });
      edgePrefixes.set(prefix, digest);
      const frontmatter = {
        authoring_contract: AUTHORING_CONTRACTS.edgeCurrent,
        entity_type: "graph-edge",
        projection_mode: "current",
        generated: true,
        edge_id: `edge-${prefix}`,
        edge_sha256: digest,
        graph_id: graph.graphId,
        from_node_id: edge.from,
        to_node_id: edge.to,
        relation: edge.relation,
        base_graph_sha256: baseGraphSha256,
        projection_input_sha256: projectionInputSha256
      };
      validateSchema("edgeCurrent", frontmatter, { label: `${graph.graphId}/${prefix}` });
      output.set(edgePath(graph.graphId, edge), renderFrontmatterNote({
        frontmatter,
        heading: `${edge.from} ${edge.relation} ${edge.to}`,
        body: `> [!warning] Generated current-state projection — do not edit.\n\nFrom: [[current/nodes/${nodeOwnerGraph.get(edge.from)}/${edge.from}]]\n\nTo: [[current/nodes/${nodeOwnerGraph.get(edge.to)}/${edge.to}]]`
      }));
    }
  }

  for (const source of [...sourceById.values()].sort((left, right) => compareText(left.id, right.id))) {
    const citingNodeIds = bundle.graphs.flatMap((graph) => graph.nodes).filter((node) => node.sourceRefs.includes(source.id)).map((node) => node.id).sort(compareText);
    const sourceFileHash = authority.authoritativeInputs.find((record) => record.path === `guides/${source.file}`)?.sha256 ?? source.sha256;
    const locatorKind = source.pages ? "pdf-pages" : source.lineStart ? "text-lines" : "amendment-record";
    const frontmatter = {
      authoring_contract: AUTHORING_CONTRACTS.projection,
      entity_type: "source-section",
      projection_mode: "current",
      generated: true,
      source_id: source.id,
      guide_id: source.guideId,
      heading: source.heading ?? source.id,
      source_role: roleByGuide.get(source.guideId) ?? "source",
      source_hash: sourceFileHash,
      section_hash: source.sha256,
      locator_kind: locatorKind,
      cited_by_node_ids: citingNodeIds,
      projection_input_sha256: projectionInputSha256
    };
    validateSchema("projectionIndex", frontmatter, { label: source.id });
    const locator = source.pages ? `Pages ${source.pages.join(", ")}` : source.lineStart ? `Lines ${source.lineStart}–${source.lineEnd}` : "Structured owner-amendment record";
    output.set(sourcePath(source.guideId, source.id), renderFrontmatterNote({
      frontmatter,
      heading: source.heading ?? source.id,
      body: `> [!warning] Generated source-section excerpt — the referenced current-source bytes remain authoritative for the compiled graph.\n\nAuthority path: \`guides/${source.file}\`\n\nLocator: ${locator}\n\n\`\`\`text\n${String(source.excerpt ?? "").trim()}\n\`\`\``
    }));
  }

  for (const item of amendments.items) {
    const record = { approvedAt: amendments.approvedAt, item, version: amendments.version };
    const frontmatter = {
        authoring_contract: AUTHORING_CONTRACTS.projection,
        entity_type: "owner-amendment",
        projection_mode: "current",
        generated: true,
        amendment_id: item.id,
        status: item.status,
        domain: item.domain,
        base_record_sha256: sha256Canonical(record),
        source_file_sha256: authority.authoritativeInputs.find((entry) => entry.path === "guides/owner-amendments.json").sha256,
        projection_input_sha256: projectionInputSha256
      };
    validateSchema("projectionIndex", frontmatter, { label: item.id });
    output.set(`current/governance/amendments/${item.id}.md`, renderStructuredNote({
      frontmatter,
      heading: item.id,
      warning: "Generated owner-amendment projection — do not edit.",
      value: record
    }));
  }

  for (const decision of ownerResolution.decisions) {
    const frontmatter = {
        authoring_contract: AUTHORING_CONTRACTS.projection,
        entity_type: "map-owner-decision",
        projection_mode: "current",
        generated: true,
        decision_id: decision.id,
        status: decision.status,
        future_guide_proposal_required: decision.futureGuideProposalRequired ?? false,
        base_record_sha256: sha256Canonical(decision),
        projection_input_sha256: projectionInputSha256
      };
    validateSchema("projectionIndex", frontmatter, { label: decision.id });
    output.set(`current/governance/decisions/${decision.id}.md`, renderStructuredNote({
      frontmatter,
      heading: decision.id,
      warning: "Generated owner-decision projection — not executable graph authority.",
      value: decision
    }));
  }

  for (const registry of registries) {
    for (const item of registry.items) {
      const frontmatter = {
          authoring_contract: AUTHORING_CONTRACTS.overlay,
          entity_type: "documentation-overlay",
          projection_mode: "current",
          generated: true,
          overlay_id: item.id,
          map_id: registry.mapId,
          status: item.status,
          authority: item.authority,
          anchors: item.anchorNodeIds,
          reconciled_nodes: item.reconciledNodeIds,
          base_record_sha256: sha256Canonical(item),
          projection_input_sha256: projectionInputSha256
        };
      validateSchema("projectionIndex", frontmatter, { label: item.id });
      output.set(`current/governance/overlays/${item.id}.md`, renderStructuredNote({
        frontmatter,
        heading: item.title,
        warning: item.status === "owner-approved-uncompiled" ? "Owner-approved documentation overlay — not compiled and not executable." : "Generated overlay reconciliation record.",
        value: item
      }));
    }
  }

  for (const [index, definition] of regressionCases.entries()) {
    const result = regressionResults.results[index];
    const affectedNodeIds = regressionNodeIds(definition, result);
    const frontmatter = {
        authoring_contract: AUTHORING_CONTRACTS.projection,
        entity_type: "graph-regression",
        projection_mode: "current",
        generated: true,
        case_id: definition.id,
        affected_node_ids: affectedNodeIds,
        expected_primary: definition.expected?.primary ?? null,
        expected_question: definition.expected?.nextQuestion ?? null,
        safety_relevance: ["unsafe", "disoriented", "no", "high"].some((value) => Object.values(definition.variables ?? {}).includes(value)),
        passed: result.ok,
        base_record_sha256: sha256Canonical(definition),
        projection_input_sha256: projectionInputSha256
      };
    validateSchema("projectionIndex", frontmatter, { label: definition.id });
    output.set(`current/regressions/${definition.id}.md`, renderStructuredNote({
      frontmatter,
      heading: `${definition.id} — ${definition.description}`,
      warning: "Generated regression index — canonical JSON case remains authoritative.",
      value: { definition, result }
    }));
  }

  output.set("current/maps/development-graph.canvas", renderCanvas({ bundle, registries }));
  for (const [relative, text] of output) {
    if (relative.includes("\\") || relative.startsWith("/") || relative.split("/").includes("..")) throw new Error(`Unsafe projection output path: ${relative}`);
    assertPublicAuthoringText(text, { label: relative });
  }

  const generatedFiles = [...output.entries()].map(([relative, text]) => {
    const entity = projectionEntity(relative, text);
    return {
      path: `authoring/obsidian/${relative}`,
      entityType: entity.entityType,
      entityId: entity.entityId,
      sha256: sha256Bytes(Buffer.from(text, "utf8"))
    };
  }).sort((left, right) => compareText(left.path, right.path));
  const recordFor = (relative) => authority.authoritativeInputs.find((record) => record.path === relative);
  const projectionManifest = {
    contractVersion: AUTHORING_CONTRACTS.projection,
    graphContractVersion: "guide-graph-v1",
    projectionInputSha256,
    sourceGraphs: GRAPH_FILES.map((relative) => recordFor(relative)),
    compiledBundle: { ...recordFor("guide-graphs/compiled/bundle.json"), version: bundle.version },
    authoritativeInputs: authority.authoritativeInputs,
    sourceLayout: recordFor("guides/source-layout.json"),
    ownerAmendments: recordFor("guides/owner-amendments.json"),
    regressionInputs: authority.regressionPaths.map((relative) => recordFor(relative)),
    overlays: authority.overlayPaths.map((relative) => recordFor(relative)),
    generatedFiles
  };
  validateSchema("projectionManifest", projectionManifest, { label: "projection manifest" });
  output.set("current/manifest.json", canonicalJson(projectionManifest));
  return output;
}

function projectionEntity(relative, text) {
  if (relative.endsWith(".canvas")) return { entityType: "json-canvas", entityId: path.basename(relative, ".canvas") };
  const { data } = parseFrontmatter(text, { label: relative });
  return {
    entityType: data.entity_type,
    entityId: data.node_id ?? data.edge_id ?? data.source_id ?? data.amendment_id ?? data.decision_id ?? data.overlay_id ?? data.case_id
  };
}

export function validateCurrentProjection(output) {
  for (const [relative, text] of output) {
    if (relative.endsWith(".canvas") || relative.endsWith(".json")) continue;
    if (relative.includes("/nodes/") || relative.includes("/edges/")) parseAuthoringNote(text, { label: relative });
    else {
      const parsed = parseFrontmatter(text, { label: relative });
      validateSchema("projectionIndex", parsed.data, { label: relative });
    }
  }
  return output;
}

export async function createCurrentProjection({ root }) {
  const authority = await loadCurrentAuthority({ root });
  const output = buildCurrentProjection(authority);
  validateCurrentProjection(output);
  return { authority, output };
}
