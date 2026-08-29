import fs from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";
import { AUTHORING_CONTRACTS, assertProposalId, assertSafeNodeFilenameId, assertUniquePortableIds, edgeDigest, edgeId, validateSchema } from "./contract.mjs";
import { parseFrontmatter, readUtf8RegularFile } from "./frontmatter.mjs";
import { nodeRecordFromAuthoringNote, parseAuthoringNote } from "./note-parser.mjs";
import { renderFrontmatterNote, renderNodeNote } from "./note-renderer.mjs";
import { assertNoSymlinkAncestors, assertPublicAuthoringText, resolveInside } from "./private-data-boundary.mjs";
import { createCurrentProjection, projectionInputToken } from "./projection.mjs";
import { assertProjectionCurrent } from "./projection-check.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

async function writeNewFile(file, text) {
  assertPublicAuthoringText(text, { label: file });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
}

function proposalManifestText({ id, projectionInputSha256, targetGraphIds, regressionIds = [] }) {
  const frontmatter = {
    authoring_contract: AUTHORING_CONTRACTS.proposal,
    entity_type: "proposal",
    proposal_id: id,
    status: "draft",
    base_projection_input_sha256: projectionInputSha256,
    target_graph_ids: [...targetGraphIds].sort(compareText),
    declared_regression_ids: [...new Set(regressionIds)].sort(compareText),
    owner_decision_required: true,
    contains_therapy_semantic_change: true,
    contains_documentation_overlay_change: false
  };
  validateSchema("proposalManifest", frontmatter, { label: `${id} proposal manifest` });
  return renderFrontmatterNote({
    frontmatter,
    heading: id,
    body: "## Intent\n\nState the exact problem and intended behavioral effect.\n\n## Non-goals\n\nState what must not change.\n\n## Worst plausible failure\n\nState the strongest credible failure caused by this proposal.\n\n## Acceptance distinctions\n\nDescribe the cases that should route differently and the cases that must remain unchanged."
  });
}

function nodeProposalText({ currentText, id }) {
  const parsed = parseAuthoringNote(currentText, { label: `current node for ${id}` });
  const frontmatter = {
    authoring_contract: AUTHORING_CONTRACTS.nodeProposal,
    entity_type: "graph-node-proposal",
    proposal_id: id,
    operation: "replace",
    graph_id: parsed.data.graph_id,
    node_id: parsed.data.node_id,
    title: parsed.data.title,
    kind: parsed.data.kind,
    tier: parsed.data.tier,
    priority: parsed.data.priority,
    authority: parsed.data.authority,
    graph_tags: parsed.data.graph_tags,
    source_refs: parsed.data.source_refs,
    base_record_sha256: parsed.data.base_record_sha256,
    base_graph_sha256: parsed.data.base_graph_sha256,
    base_projection_input_sha256: parsed.data.projection_input_sha256
  };
  validateSchema("nodeProposal", frontmatter, { label: `${id}/${parsed.data.node_id}` });
  return renderNodeNote({
    frontmatter,
    payload: parsed.payload,
    heading: parsed.data.title,
    warning: "Editable proposal record. Building it never changes canonical graph files.",
    rationaleTemplate: true
  });
}

function edgeProposalText({ currentText, id }) {
  const parsed = parseAuthoringNote(currentText, { label: `current edge for ${id}` });
  const frontmatter = {
    authoring_contract: AUTHORING_CONTRACTS.edgeProposal,
    entity_type: "graph-edge-proposal",
    proposal_id: id,
    operation: "remove",
    edge_id: parsed.data.edge_id,
    edge_sha256: parsed.data.edge_sha256,
    graph_id: parsed.data.graph_id,
    from_node_id: parsed.data.from_node_id,
    to_node_id: parsed.data.to_node_id,
    relation: parsed.data.relation,
    base_graph_sha256: parsed.data.base_graph_sha256,
    base_projection_input_sha256: parsed.data.projection_input_sha256
  };
  validateSchema("edgeProposal", frontmatter, { label: `${id}/${parsed.data.edge_id}` });
  return renderFrontmatterNote({
    frontmatter,
    heading: `${frontmatter.from_node_id} ${frontmatter.relation} ${frontmatter.to_node_id}`,
    body: "> [!warning] This copied edge is initially a remove operation. Use a separate add record for a changed relation or endpoint."
  });
}

export async function createProposal({ root, id, nodeIds = [], edgeIds = [], regressionIds = [] }) {
  assertProposalId(id);
  if (!nodeIds.length && !edgeIds.length) fail("PROPOSAL_SELECTION_EMPTY", "Select at least one current node or edge.");
  const built = await createCurrentProjection({ root });
  await assertProjectionCurrent(built.output, path.join(root, "authoring", "obsidian", "current"));
  const proposalRelative = `authoring/obsidian/proposals/${id}`;
  assertNoSymlinkAncestors(root, proposalRelative);
  const proposalRoot = resolveInside(root, proposalRelative);
  await fs.mkdir(path.dirname(proposalRoot), { recursive: true });
  try {
    await fs.mkdir(proposalRoot, { recursive: false });
  } catch (error) {
    if (error.code === "EEXIST") fail("PROPOSAL_EXISTS", `Proposal already exists: ${id}`);
    throw error;
  }

  const selected = [];
  try {
    for (const nodeId of [...new Set(nodeIds)].sort(compareText)) {
      const matches = [...built.output.entries()].filter(([relative]) => relative.startsWith("current/nodes/") && relative.endsWith(`/${nodeId}.md`));
      if (matches.length !== 1) fail("PROPOSAL_NODE_UNKNOWN", `Current projection does not contain exactly one node ${nodeId}.`);
      const [relative, currentText] = matches[0];
      const parsed = parseAuthoringNote(currentText, { label: relative });
      selected.push({ graphId: parsed.data.graph_id, relative: `nodes/${nodeId}.md`, text: nodeProposalText({ currentText, id }) });
    }
    for (const requestedId of [...new Set(edgeIds)].sort(compareText)) {
      const matches = [...built.output.entries()].filter(([relative, text]) => relative.startsWith("current/edges/") && parseFrontmatter(text, { label: relative }).data.edge_id === requestedId);
      if (matches.length !== 1) fail("PROPOSAL_EDGE_UNKNOWN", `Current projection does not contain exactly one edge ${requestedId}.`);
      const [relative, currentText] = matches[0];
      const parsed = parseAuthoringNote(currentText, { label: relative });
      selected.push({ graphId: parsed.data.graph_id, relative: `edges/${requestedId}.md`, text: edgeProposalText({ currentText, id }) });
    }
    const targetGraphIds = [...new Set(selected.map((item) => item.graphId))];
    await writeNewFile(path.join(proposalRoot, "proposal.md"), proposalManifestText({ id, projectionInputSha256: built.authority.projectionInputSha256, targetGraphIds, regressionIds }));
    await writeNewFile(path.join(proposalRoot, "base-authority.json"), canonicalJson({
      contractVersion: "inner-signal-authoring-base-authority-v1",
      proposalId: id,
      projectionInputSha256: built.authority.projectionInputSha256,
      authoritativeInputs: built.authority.authoritativeInputs
    }));
    for (const item of selected) await writeNewFile(path.join(proposalRoot, item.relative), item.text);
  } catch (error) {
    await fs.rm(proposalRoot, { recursive: true, force: true });
    throw error;
  }
  return { id, path: proposalRelative, selectedRecords: selected.length, baseProjectionInputSha256: built.authority.projectionInputSha256 };
}

async function listFilesIfPresent(directory, suffix) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const invalid = entries.filter((entry) => !entry.isFile() || !entry.name.endsWith(suffix));
    if (invalid.length) fail("PROPOSAL_PATH_UNEXPECTED", `${directory} contains unsupported entries: ${invalid.map((entry) => entry.name).join(", ")}`);
    return entries.map((entry) => path.join(directory, entry.name)).sort(compareText);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadProposal({ root, id }) {
  assertProposalId(id);
  const relative = `authoring/obsidian/proposals/${id}`;
  assertNoSymlinkAncestors(root, relative, { allowMissingLeaf: false });
  const proposalRoot = resolveInside(root, relative);
  const allowedRoot = new Set(["proposal.md", "base-authority.json", "nodes", "edges", "tests", "overlays"]);
  const unexpectedRoot = (await fs.readdir(proposalRoot, { withFileTypes: true })).filter((entry) => !allowedRoot.has(entry.name) || entry.isSymbolicLink() || (entry.name.endsWith(".json") || entry.name.endsWith(".md")) && !entry.isFile() || !entry.name.includes(".") && !entry.isDirectory());
  if (unexpectedRoot.length) fail("PROPOSAL_PATH_UNEXPECTED", `${id} contains unsupported root entries: ${unexpectedRoot.map((entry) => entry.name).join(", ")}`);
  const manifestText = await readUtf8RegularFile(path.join(proposalRoot, "proposal.md"));
  assertPublicAuthoringText(manifestText, { label: `${id}/proposal.md` });
  const manifestParsed = parseAuthoringNote(manifestText, { label: `${id}/proposal.md` });
  if (manifestParsed.data.proposal_id !== id) fail("PROPOSAL_ID_MISMATCH", `Proposal directory ${id} contains manifest ${manifestParsed.data.proposal_id}.`);
  let baseAuthority;
  let baseAuthorityText;
  try { baseAuthorityText = await readUtf8RegularFile(path.join(proposalRoot, "base-authority.json")); baseAuthority = JSON.parse(baseAuthorityText); }
  catch (error) { fail("PROPOSAL_BASE_AUTHORITY_INVALID", `${id}/base-authority.json is missing or invalid: ${error.message}`); }
  assertPublicAuthoringText(baseAuthorityText, { label: `${id}/base-authority.json` });
  if (baseAuthority?.contractVersion !== "inner-signal-authoring-base-authority-v1" || baseAuthority.proposalId !== id || baseAuthority.projectionInputSha256 !== manifestParsed.data.base_projection_input_sha256 || !Array.isArray(baseAuthority.authoritativeInputs)) fail("PROPOSAL_BASE_AUTHORITY_INVALID", `${id}/base-authority.json does not match the proposal manifest.`);
  if (baseAuthority.authoritativeInputs.some((item) => !item || Object.keys(item).sort().join(",") !== "path,sha256" || typeof item.path !== "string" || item.path.startsWith("/") || item.path.includes("\\") || item.path.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(item.sha256))) fail("PROPOSAL_BASE_AUTHORITY_INVALID", `${id}/base-authority.json contains an invalid input record.`);
  if (projectionInputToken(baseAuthority.authoritativeInputs) !== baseAuthority.projectionInputSha256) fail("PROPOSAL_BASE_AUTHORITY_INVALID", `${id}/base-authority.json input records do not match their projection hash.`);

  const nodeFiles = await listFilesIfPresent(path.join(proposalRoot, "nodes"), ".md");
  const edgeFiles = await listFilesIfPresent(path.join(proposalRoot, "edges"), ".md");
  const testFiles = await listFilesIfPresent(path.join(proposalRoot, "tests"), ".json");
  const overlayFiles = await listFilesIfPresent(path.join(proposalRoot, "overlays"), ".json");
  const nodes = [];
  for (const file of nodeFiles) {
    const text = await readUtf8RegularFile(file);
    assertPublicAuthoringText(text, { label: file });
    const parsed = parseAuthoringNote(text, { label: file });
    if (parsed.data.proposal_id !== id) fail("PROPOSAL_ID_MISMATCH", `${file} belongs to another proposal.`);
    assertSafeNodeFilenameId(parsed.data.node_id);
    if (path.basename(file) !== `${parsed.data.node_id}.md`) fail("PROPOSAL_FILENAME_ID_MISMATCH", `${file} does not match node identity ${parsed.data.node_id}.`);
    nodes.push({ file, ...parsed, record: nodeRecordFromAuthoringNote(text, { label: file }) });
  }
  const edges = [];
  for (const file of edgeFiles) {
    const text = await readUtf8RegularFile(file);
    assertPublicAuthoringText(text, { label: file });
    const parsed = parseAuthoringNote(text, { label: file });
    if (parsed.data.proposal_id !== id) fail("PROPOSAL_ID_MISMATCH", `${file} belongs to another proposal.`);
    const tuple = { graphId: parsed.data.graph_id, from: parsed.data.from_node_id, relation: parsed.data.relation, to: parsed.data.to_node_id };
    const full = edgeDigest(tuple);
    if (full !== parsed.data.edge_sha256 || edgeId(tuple) !== parsed.data.edge_id || path.basename(file) !== `${parsed.data.edge_id}.md`) fail("PROPOSAL_EDGE_IDENTITY_MISMATCH", `${file} has inconsistent edge identity.`);
    edges.push({ file, ...parsed, tuple });
  }
  const tests = [];
  for (const file of testFiles) {
    const text = await readUtf8RegularFile(file);
    assertPublicAuthoringText(text, { label: file });
    let value;
    try { value = JSON.parse(text); } catch (error) { fail("PROPOSAL_TEST_INVALID", `${file} is invalid JSON: ${error.message}`); }
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string") fail("PROPOSAL_TEST_INVALID", `${file} lacks a valid regression id.`);
    if (path.basename(file) !== `${value.id}.json`) fail("PROPOSAL_FILENAME_ID_MISMATCH", `${file} does not match regression identity ${value.id}.`);
    tests.push({ file, value });
  }
  if (new Set(tests.map((item) => item.value.id)).size !== tests.length) fail("PROPOSAL_TEST_DUPLICATE", `${id} contains duplicate regression ids.`);
  return { id, root: proposalRoot, manifest: manifestParsed.data, manifestBody: manifestParsed.body, baseAuthority, nodes, edges, tests, overlayFiles };
}

export function applyProposalOperations({ graphs, proposal, graphHashes }) {
  const output = structuredClone(graphs);
  const byGraph = new Map(output.map((graph) => [graph.graphId, graph]));
  const touched = new Set();
  for (const item of proposal.nodes) {
    const data = item.data;
    const graph = byGraph.get(data.graph_id);
    if (!graph) fail("PROPOSAL_GRAPH_UNKNOWN", `Unknown target graph ${data.graph_id}.`);
    if (graphHashes.get(data.graph_id) !== data.base_graph_sha256) fail("STALE_AUTHORING_BASE", `Base graph changed for ${data.graph_id}.`);
    const index = graph.nodes.findIndex((node) => node.id === data.node_id);
    if (data.operation === "add") {
      if (index !== -1 || !item.record) fail("PROPOSAL_NODE_ADD_INVALID", `Node add must be new and complete: ${data.node_id}.`);
      graph.nodes.push(item.record);
    } else {
      if (index === -1) fail("STALE_AUTHORING_RECORD", `Base node no longer exists: ${data.node_id}.`);
      if (!data.base_record_sha256) fail("STALE_AUTHORING_RECORD", `Missing base record hash for ${data.node_id}.`);
      if (sha256Canonical(graph.nodes[index]) !== data.base_record_sha256) fail("STALE_AUTHORING_RECORD", `Base node changed for ${data.node_id}.`);
      if (data.operation === "replace") {
        if (!item.record) fail("PROPOSAL_NODE_REPLACE_INVALID", `Replacement is incomplete: ${data.node_id}.`);
        graph.nodes[index] = item.record;
      } else if (data.operation === "remove") graph.nodes.splice(index, 1);
    }
    touched.add(data.graph_id);
  }
  for (const item of proposal.edges) {
    const data = item.data;
    const graph = byGraph.get(data.graph_id);
    if (!graph) fail("PROPOSAL_GRAPH_UNKNOWN", `Unknown target graph ${data.graph_id}.`);
    if (graphHashes.get(data.graph_id) !== data.base_graph_sha256) fail("STALE_AUTHORING_BASE", `Base graph changed for ${data.graph_id}.`);
    const index = graph.edges.findIndex((edge) => edge.from === item.tuple.from && edge.relation === item.tuple.relation && edge.to === item.tuple.to);
    if (data.operation === "add") {
      if (index !== -1) fail("PROPOSAL_EDGE_ADD_INVALID", `Edge already exists: ${data.edge_id}.`);
      graph.edges.push({ from: item.tuple.from, relation: item.tuple.relation, to: item.tuple.to });
    } else {
      if (index === -1) fail("STALE_AUTHORING_RECORD", `Base edge no longer exists: ${data.edge_id}.`);
      graph.edges.splice(index, 1);
    }
    touched.add(data.graph_id);
  }
  assertUniquePortableIds(output.flatMap((graph) => graph.nodes.map((node) => node.id)), { label: "candidate graph node ids" });
  const edgePrefixes = new Map();
  for (const graph of output) for (const edge of graph.edges) {
    const full = edgeDigest({ graphId: graph.graphId, ...edge });
    const prefix = full.slice(0, 16);
    if (edgePrefixes.has(prefix) && edgePrefixes.get(prefix) !== full) fail("EDGE_PREFIX_COLLISION", `Candidate edge digest prefix collision: ${prefix}.`);
    edgePrefixes.set(prefix, full);
  }
  return { graphs: output, touchedGraphIds: [...touched].sort(compareText) };
}
