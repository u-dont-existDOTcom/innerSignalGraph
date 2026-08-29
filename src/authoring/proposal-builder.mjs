import fs from "node:fs/promises";
import path from "node:path";
import { compileGuideGraphs } from "../guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../guide-graph/regressions.mjs";
import { buildCompleteDecisionCards, buildCompleteSemanticDiff } from "../guide-graph/semantic-diff.mjs";
import { verifyGuidePacket } from "../guide-packet/verifier.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { canonicalJson, sha256Bytes, sha256Canonical } from "./canonical-json.mjs";
import { renderCanvas } from "./canvas-generator.mjs";
import { AUTHORING_CONTRACTS, validateSchema } from "./contract.mjs";
import { renderMermaidMap } from "./mermaid-generator.mjs";
import { assertNoSymlinkAncestors, assertPublicAuthoringText, resolveInside } from "./private-data-boundary.mjs";
import { buildCurrentProjection, loadCurrentAuthority } from "./projection.mjs";
import { assertProjectionCurrent } from "./projection-check.mjs";
import { applyProposalOperations, loadProposal } from "./proposal.mjs";
import { buildProposalGuidePacket } from "./proposal-packet.mjs";

const GRAPH_PATHS = Object.freeze({
  "inner-child-directed-graph": "guide-graphs/candidates/inner-child.graph.json",
  "somatic-directed-graph": "guide-graphs/candidates/somatic.graph.json",
  "inner-child-somatic-cross-guide": "guide-graphs/candidates/cross-guide.graph.json"
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function exactJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function nodeIdsForCase(definition, ...results) {
  const expected = definition.expected ?? {};
  return [...new Set([
    expected.primary,
    ...(expected.selectedIncludes ?? []),
    ...(expected.selectedExcludes ?? []),
    ...(expected.matchedIncludes ?? []),
    ...(expected.deferredIncludes ?? []),
    ...(expected.blockedIncludes ?? []),
    ...results.flatMap((result) => [result?.primary, ...(result?.selected ?? []), ...(result?.matched ?? []), ...(result?.deferred ?? []), ...(result?.blocked ?? [])])
  ].filter(Boolean))].sort(compareText);
}

async function loadCandidateGraphs(root) {
  const rows = await Promise.all(Object.entries(GRAPH_PATHS).map(async ([graphId, relative]) => {
    assertNoSymlinkAncestors(root, relative, { allowMissingLeaf: false });
    const text = await withOpenedRegularFile(path.join(root, relative), (handle) => handle.readFile("utf8"));
    const graph = JSON.parse(text);
    if (graph.graphId !== graphId) fail("AUTHORING_GRAPH_ID_MISMATCH", `${relative} contains ${graph.graphId}.`);
    return { graphId, relative, text, graph, sha256: sha256Bytes(Buffer.from(text, "utf8")) };
  }));
  return rows;
}

function mergeRegressionCases(baseCases, proposedRows) {
  const byId = new Map(baseCases.map((item) => [item.id, structuredClone(item)]));
  for (const { value, file } of proposedRows) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !value.variables || !value.expected) fail("PROPOSAL_TEST_INVALID", `${file} does not use the existing graph-case contract.`);
    byId.set(value.id, structuredClone(value));
  }
  return [...byId.values()].sort((left, right) => compareText(left.id, right.id));
}

function changedNodeIds(change) {
  if (change.entityType === "node") return [change.entityId];
  if (change.entityType === "edge") return [...new Set([change.before?.from, change.before?.to, change.after?.from, change.after?.to].filter(Boolean))];
  return [];
}

function selectedCaseRows({ proposal, cases, baselineResults, candidateResults }) {
  const declared = new Set([...proposal.manifest.declared_regression_ids, ...proposal.tests.map((item) => item.value.id)]);
  const unknown = [...declared].filter((id) => !cases.some((item) => item.id === id));
  if (unknown.length) fail("PROPOSAL_REGRESSION_UNKNOWN", `Declared regression cases do not exist: ${unknown.join(", ")}`);
  return cases.map((definition, index) => ({
    id: definition.id,
    title: definition.description,
    definition,
    declared: declared.has(definition.id),
    affectedNodeIds: nodeIdsForCase(definition, baselineResults.results[index], candidateResults.results[index]),
    baseline: baselineResults.results[index],
    candidate: candidateResults.results[index]
  }));
}

function hasNegativeSignal(row, nodeId) {
  const variables = Object.values(row.definition.variables ?? {});
  return (row.definition.expected?.selectedExcludes ?? []).includes(nodeId)
    || (row.candidate.blocked ?? []).includes(nodeId)
    || variables.some((value) => ["unsafe", "disoriented", "no", "high", "absent"].includes(value));
}

export function assessRegressionCoverage(diff, caseRows) {
  const declared = caseRows.filter((row) => row.declared);
  const gaps = [];
  for (const item of diff.changes) {
    if (["tags", "description"].includes(item.fieldPath)) continue;
    const ids = changedNodeIds(item);
    if (!ids.length) continue;
    const relevant = declared.filter((row) => row.affectedNodeIds.some((id) => ids.includes(id)));
    if (!relevant.length) {
      gaps.push({ change: `${item.entityId}.${item.fieldPath}`, requirement: "affected existing or proposed regression" });
      continue;
    }
    const subject = ids[0];
    if (["activation", "effects.deferNodes", "effects.blockNodes"].includes(item.fieldPath)) {
      const matches = relevant.some((row) => (row.candidate.matched ?? []).includes(subject));
      const nonMatches = relevant.some((row) => !(row.candidate.matched ?? []).includes(subject));
      if (!matches || !nonMatches) gaps.push({ change: `${item.entityId}.${item.fieldPath}`, requirement: "both matching and non-matching boundary cases" });
    }
    if (item.fieldPath === "defaultQuestion" && !relevant.some((row) => row.definition.expected?.nextQuestion === item.after)) {
      gaps.push({ change: `${item.entityId}.${item.fieldPath}`, requirement: "exact nextQuestion assertion" });
    }
    if (item.fieldPath === "effects.requiredNuance" && !relevant.some((row) => (row.definition.expected?.requiredNuancePatterns ?? []).length)) {
      gaps.push({ change: `${item.entityId}.${item.fieldPath}`, requirement: "requiredNuancePatterns realization assertion" });
    }
    if (item.fieldPath === "effects.forbiddenOverclaims" && !relevant.some((row) => (row.definition.expected?.forbiddenOverclaimPatterns ?? []).length)) {
      gaps.push({ change: `${item.entityId}.${item.fieldPath}`, requirement: "forbiddenOverclaimPatterns realization assertion" });
    }
    if (item.classification.includes("safety") && !relevant.some((row) => hasNegativeSignal(row, subject))) {
      gaps.push({ change: `${item.entityId}.${item.fieldPath}`, requirement: "explicit negative/safety case" });
    }
  }
  return { contractVersion: "inner-signal-regression-impact-v1", ok: gaps.length === 0, declaredCaseIds: declared.map((row) => row.id).sort(compareText), affectedCases: caseRows.filter((row) => row.affectedNodeIds.some((id) => diff.changedNodeIds.includes(id))).map((row) => ({ id: row.id, title: row.title, declared: row.declared, affectedNodeIds: row.affectedNodeIds, passed: row.candidate.ok })), gaps };
}

function provenanceImpact(diff, sourceIds) {
  const changes = diff.changes.filter((item) => ["sourceRefs", "authority"].includes(item.fieldPath)).map((item) => ({
    nodeId: item.entityId,
    field: item.fieldPath,
    before: item.before,
    after: item.after,
    resolvedSourceRefs: item.fieldPath === "sourceRefs" ? item.after.map((id) => ({ id, resolved: sourceIds.has(id) })) : []
  }));
  const unresolved = changes.flatMap((item) => item.resolvedSourceRefs.filter((row) => !row.resolved).map((row) => ({ nodeId: item.nodeId, sourceRef: row.id })));
  if (unresolved.length) fail("PROPOSAL_PROVENANCE_UNRESOLVED", `Proposal contains unresolved source refs: ${unresolved.map((item) => `${item.nodeId}:${item.sourceRef}`).join(", ")}`);
  return { contractVersion: "inner-signal-provenance-impact-v1", ok: true, changes, unresolved };
}

function proposalEvidence(proposal) {
  return {
    contractVersion: "inner-signal-proposal-evidence-v1",
    proposalId: proposal.id,
    manifestBody: proposal.manifestBody,
    nodeEvidence: proposal.nodes.map((item) => ({ nodeId: item.data.node_id, operation: item.data.operation, body: item.body })).sort((left, right) => compareText(left.nodeId, right.nodeId)),
    edgeEvidence: proposal.edges.map((item) => ({ edgeId: item.data.edge_id, operation: item.data.operation, body: item.body })).sort((left, right) => compareText(left.edgeId, right.edgeId)),
    proposedTests: proposal.tests.map((item) => item.value).sort((left, right) => compareText(left.id, right.id))
  };
}

function buildOutputs({ proposal, authority, graphRows, candidateGraphs, candidateBundle, diff, decisions, regressionImpact, provenance, evidence, regressionResults }) {
  const output = new Map();
  const filenameByGraph = new Map(graphRows.map((row) => [row.graphId, path.basename(row.relative)]));
  for (const graph of candidateGraphs) output.set(`candidate/graphs/${filenameByGraph.get(graph.graphId)}`, exactJson(graph));
  output.set("candidate/bundle.json", exactJson(candidateBundle));
  output.set("audit/behavioral-diff.json", canonicalJson(diff));
  output.set("audit/owner-decisions.json", canonicalJson({ contractVersion: "guide-owner-decisions-v1", status: "awaiting-owner", proposalEvidenceSha256: sha256Canonical(evidence), cards: decisions, allApproved: false }));
  output.set("audit/proposal-evidence.json", canonicalJson(evidence));
  output.set("audit/regression-impact.json", canonicalJson(regressionImpact));
  output.set("audit/provenance-impact.json", canonicalJson(provenance));
  output.set("maps/candidate-map.md", renderMermaidMap({ bundle: candidateBundle, registries: authority.registries, mapId: "inner-child", projectionInputSha256: proposal.manifest.base_projection_input_sha256 }));
  output.set("maps/candidate.canvas", renderCanvas({ bundle: candidateBundle, registries: authority.registries }));
  for (const [relative, text] of output) assertPublicAuthoringText(text, { label: `${proposal.id}/${relative}` });
  const candidateGraphHashes = candidateGraphs.map((graph) => {
    const relative = `candidate/graphs/${filenameByGraph.get(graph.graphId)}`;
    return { graphId: graph.graphId, path: relative, sha256: sha256Bytes(Buffer.from(output.get(relative), "utf8")) };
  }).sort((left, right) => compareText(left.graphId, right.graphId));
  const receipt = {
    contractVersion: AUTHORING_CONTRACTS.receipt,
    proposalId: proposal.id,
    baseProjectionInputSha256: proposal.manifest.base_projection_input_sha256,
    proposalEvidenceSha256: sha256Canonical(evidence),
    candidateBundleSha256: sha256Bytes(Buffer.from(output.get("candidate/bundle.json"), "utf8")),
    candidateGraphHashes,
    semanticDiffSha256: sha256Bytes(Buffer.from(output.get("audit/behavioral-diff.json"), "utf8")),
    regressionImpactSha256: sha256Bytes(Buffer.from(output.get("audit/regression-impact.json"), "utf8")),
    provenanceImpactSha256: sha256Bytes(Buffer.from(output.get("audit/provenance-impact.json"), "utf8")),
    mapSha256: sha256Bytes(Buffer.from(output.get("maps/candidate-map.md"), "utf8")),
    canvasSha256: sha256Bytes(Buffer.from(output.get("maps/candidate.canvas"), "utf8")),
    regressionStatus: { ok: regressionResults.ok, count: regressionResults.count, passed: regressionResults.results.filter((item) => item.ok).length },
    ownerDecisionRequired: diff.substantive
  };
  validateSchema("proposalReceipt", receipt, { label: `${proposal.id} receipt` });
  output.set("receipt.json", canonicalJson(receipt));
  return { output, receipt };
}

export async function materializeProposal({ root, id, enforceCoverage = true }) {
  const authority = await loadCurrentAuthority({ root });
  const proposal = await loadProposal({ root, id });
  if (proposal.manifest.contains_documentation_overlay_change || proposal.overlayFiles.length) fail("PROPOSAL_OVERLAY_UNSUPPORTED", "Documentation overlay changes require the explicit overlay registry workflow; they cannot be inferred from node/edge notes.");
  if (proposal.manifest.base_projection_input_sha256 !== authority.projectionInputSha256) {
    const previous = new Map(proposal.baseAuthority.authoritativeInputs.map((item) => [item.path, item.sha256]));
    const current = new Map(authority.authoritativeInputs.map((item) => [item.path, item.sha256]));
    const changedInputs = [...new Set([...previous.keys(), ...current.keys()])].sort(compareText).filter((inputPath) => previous.get(inputPath) !== current.get(inputPath)).map((inputPath) => ({ path: inputPath, previous: previous.get(inputPath) ?? null, current: current.get(inputPath) ?? null }));
    fail("STALE_AUTHORING_BASE", "Authoritative inputs changed after proposal creation.", { changedInputs });
  }
  await assertProjectionCurrent(buildCurrentProjection(authority), path.join(root, "authoring", "obsidian", "current"));
  for (const item of [...proposal.nodes, ...proposal.edges]) {
    if (item.data.base_projection_input_sha256 !== proposal.manifest.base_projection_input_sha256) fail("STALE_AUTHORING_BASE", `${path.basename(item.file)} is bound to a different projection input set.`);
  }
  const graphRows = await loadCandidateGraphs(root);
  const graphHashes = new Map(graphRows.map((row) => [row.graphId, row.sha256]));
  const operations = applyProposalOperations({ graphs: graphRows.map((row) => row.graph), proposal, graphHashes });
  const declaredTargets = [...proposal.manifest.target_graph_ids].sort(compareText);
  if (canonicalJson(declaredTargets) !== canonicalJson(operations.touchedGraphIds)) fail("PROPOSAL_TARGET_GRAPH_MISMATCH", "Manifest target_graph_ids must exactly match edited graph records.");
  const candidateBundle = await compileGuideGraphs({ root, write: false, candidateGraphs: operations.graphs });
  const cases = mergeRegressionCases(authority.regressionCases, proposal.tests);
  const baselineResults = await runGraphRegressionSuite({ root, bundle: authority.bundle, cases });
  const candidateResults = await runGraphRegressionSuite({ root, bundle: candidateBundle, cases });
  if (!candidateResults.ok) fail("PROPOSAL_REGRESSION_FAILURE", "Candidate graph fails one or more declared/canonical graph regressions.", { results: candidateResults.results.filter((item) => !item.ok) });
  const caseRows = selectedCaseRows({ proposal, cases, baselineResults, candidateResults });
  const diff = buildCompleteSemanticDiff(authority.bundle, candidateBundle, { affectedCases: caseRows });
  const decisions = buildCompleteDecisionCards(diff);
  const regressionImpact = assessRegressionCoverage(diff, caseRows);
  if (enforceCoverage && !regressionImpact.ok) fail("PROPOSAL_REGRESSION_COVERAGE_GAP", "Semantic changes lack required regression coverage.", { gaps: regressionImpact.gaps });
  const sourceIds = new Set(authority.bundle.sourceMaps.flatMap((map) => map.sections.map((section) => section.id)));
  const provenance = provenanceImpact(diff, sourceIds);
  const evidence = proposalEvidence(proposal);
  const built = buildOutputs({ proposal, authority, graphRows, candidateGraphs: operations.graphs, candidateBundle, diff, decisions, regressionImpact, provenance, evidence, regressionResults: candidateResults });
  const packet = await buildProposalGuidePacket({ proposal, authority, candidateGraphs: operations.graphs, candidateBundle, diff, decisions, regressionCases: cases, caseRows, provenanceImpact: provenance, evidence });
  const packetVerification = verifyGuidePacket(packet.buffer, { installedBundle: authority.bundle });
  if (!packetVerification.ok) fail("PROPOSAL_PACKET_VERIFICATION_FAILED", "Candidate Guide Packet adapter failed authoritative verification.", { errors: packetVerification.errors });
  built.output.set("packet/proposal.zip", packet.buffer);
  built.receipt.packetSha256 = packet.packetSha256;
  validateSchema("proposalReceipt", built.receipt, { label: `${proposal.id} receipt with packet` });
  built.output.set("receipt.json", canonicalJson(built.receipt));
  return { ...built, proposal, candidateGraphs: operations.graphs, candidateBundle, diff, decisions, regressionImpact, provenance, evidence, packetVerification };
}

async function writeOutputTree({ root, id, output }) {
  const buildBase = resolveInside(root, "authoring/.build");
  await fs.mkdir(buildBase, { recursive: true });
  assertNoSymlinkAncestors(root, `authoring/.build/${id}`);
  const target = path.join(buildBase, id);
  const temporary = await fs.mkdtemp(path.join(buildBase, `.${id}.tmp-`));
  let backup = null;
  try {
    for (const [relative, data] of output) {
      const file = resolveInside(temporary, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data, { flag: "wx" });
    }
    try {
      await fs.lstat(target);
      backup = path.join(buildBase, `.${id}.previous-${process.pid}`);
      await fs.rename(target, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(temporary, target);
    if (backup) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    if (backup) {
      try { await fs.rename(backup, target); } catch { /* preserve original failure */ }
    }
    throw error;
  }
}

export async function buildProposal({ root, id }) {
  const built = await materializeProposal({ root, id });
  await writeOutputTree({ root, id, output: built.output });
  return { id, receipt: built.receipt, files: built.output.size, changes: built.diff.changes.length, decisions: built.decisions.length };
}

async function listTree(root) {
  const output = new Map();
  async function visit(directory, relative = "") {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name))) {
      if (entry.isSymbolicLink()) fail("AUTHORING_SYMLINK_FORBIDDEN", `Build output contains a symlink: ${path.join(relative, entry.name)}`);
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), next);
      else if (entry.isFile()) output.set(next.split(path.sep).join("/"), await fs.readFile(path.join(directory, entry.name)));
    }
  }
  await visit(root);
  return output;
}

export async function checkProposal({ root, id }) {
  const built = await materializeProposal({ root, id });
  const target = resolveInside(root, `authoring/.build/${id}`);
  const actual = await listTree(target);
  const expectedKeys = [...built.output.keys()].sort(compareText);
  const actualKeys = [...actual.keys()].sort(compareText);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  const unexpected = actualKeys.filter((key) => !built.output.has(key));
  const differing = expectedKeys.filter((key) => {
    if (!actual.has(key)) return false;
    const expected = Buffer.isBuffer(built.output.get(key)) ? built.output.get(key) : Buffer.from(built.output.get(key), "utf8");
    return !actual.get(key).equals(expected);
  });
  if (differing.length || missing.length || unexpected.length) fail("PROPOSAL_BUILD_DRIFT", "Committed proposal build differs from a fresh deterministic build.", { differing, missing, unexpected });
  return { id, ok: true, files: built.output.size, receiptSha256: sha256Canonical(built.receipt) };
}
