import path from "node:path";
import { createStoredZip } from "../core/zip.mjs";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";
import { runGuideQualityAudit } from "../guide-packet/quality-audit.mjs";
import { GUIDE_PACKET_FORMAT, GUIDE_PACKET_SCHEMA_VERSION, canonicalJson, safePacketId } from "../guide-packet/contract.mjs";
import { sha256Bytes } from "./canonical-json.mjs";
import { assertNoSymlinkAncestors } from "./private-data-boundary.mjs";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha(data) {
  return sha256Bytes(Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"));
}

function certaintyPolicy() {
  return {
    contractVersion: "guide-certainty-v1",
    levels: ["external-evidence", "common-clinical-practice", "author-framework", "author-experience", "community-signal", "traditional-explanation", "provisional-mechanism", "product-only-operational"],
    rules: [
      "A source hash proves identity, not truth.",
      "Author experience, community signal, traditional explanation, provisional mechanism, and external evidence remain distinct.",
      "Product-only operational rules may constrain the app but must not be presented as therapeutic source claims.",
      "Model inference never becomes owner policy without an explicit owner decision."
    ]
  };
}

function buildProvenance(bundle, sourceManifest) {
  const sourceByFile = new Map(sourceManifest.sources.map((source) => [source.file, source]));
  const sourceRefs = {};
  for (const map of bundle.sourceMaps) {
    const source = sourceByFile.get(map.file);
    for (const section of map.sections) sourceRefs[section.id] = {
      role: source?.role ?? "current-source",
      guideId: map.guideId,
      certainty: map.guideId === "owner-amendments" ? "owner-approved" : "author-framework",
      sourceSha256: source?.sha256 ?? section.sha256,
      sectionSha256: section.sha256
    };
  }
  const nodes = {};
  for (const graph of bundle.graphs) for (const node of graph.nodes) {
    const roles = node.sourceRefs.map((id) => sourceRefs[id]?.role).filter(Boolean);
    nodes[node.id] = {
      sourceRefs: node.sourceRefs,
      role: roles.includes("owner-approved-extension") ? "owner-amendment" : roles.includes("advanced-release-source") ? "source-prose-plus-external-source" : "source-prose",
      certainty: node.authority,
      authority: node.authority
    };
  }
  return {
    contractVersion: "guide-provenance-v1",
    sourceFamilies: sourceManifest.sources.map((source) => ({ id: source.id, expectedSha256: source.sha256 ?? null, availableInWorker: true, packetPath: `sources/repository/${source.file}`, role: source.role })),
    sourceRefs,
    nodes
  };
}

function decisionCase(definition, affectedNodeIds) {
  const expected = definition.expected ?? {};
  return {
    contractVersion: "guide-decision-case-v1",
    id: definition.id,
    type: "planner",
    title: definition.description,
    affectedNodeIds,
    variables: definition.variables,
    unknowns: definition.unknowns,
    expectations: {
      ...(expected.primary ? { primaryJobId: expected.primary } : {}),
      ...(expected.selectedIncludes?.length ? { selectedNodeIds: expected.selectedIncludes } : {}),
      ...(expected.selectedExcludes?.length ? { excludedNodeIds: expected.selectedExcludes } : {}),
      ...(expected.deferredIncludes?.length ? { deferredNodeIds: expected.deferredIncludes } : {}),
      ...(expected.nextQuestion ? { nextQuestionIncludes: [expected.nextQuestion] } : {}),
      ...(expected.requiredNuancePatterns?.length ? { requiredNuanceIncludes: expected.requiredNuancePatterns } : {}),
      ...(expected.forbiddenOverclaimPatterns?.length ? { forbiddenOverclaimIncludes: expected.forbiddenOverclaimPatterns } : {})
    }
  };
}

function sourcePaths(source) {
  return {
    sourcePath: `sources/repository/${source.file}`,
    sourceMapPath: `sources/repository/${source.id}.source-map.json`
  };
}

export async function buildProposalGuidePacket({ proposal, authority, candidateGraphs, candidateBundle, diff, decisions, regressionCases, caseRows, provenanceImpact, evidence }) {
  const entries = new Map();
  const graphPaths = {
    "inner-child-directed-graph": "graphs/inner-child.graph.json",
    "somatic-directed-graph": "graphs/somatic.graph.json",
    "inner-child-somatic-cross-guide": "graphs/cross-guide-edges.json"
  };
  const candidatePaths = {
    "inner-child-directed-graph": "graphs/candidates/inner-child.graph.json",
    "somatic-directed-graph": "graphs/candidates/somatic.graph.json",
    "inner-child-somatic-cross-guide": "graphs/candidates/cross-guide.graph.json"
  };
  for (const graph of candidateBundle.graphs) entries.set(graphPaths[graph.graphId], Buffer.from(canonicalJson(graph)));
  for (const graph of candidateGraphs) entries.set(candidatePaths[graph.graphId], Buffer.from(`${JSON.stringify(graph, null, 2)}\n`));
  entries.set("graphs/bundle.json", Buffer.from(`${JSON.stringify(candidateBundle, null, 2)}\n`));

  const mapByGuide = new Map(candidateBundle.sourceMaps.map((map) => [map.guideId, map]));
  const repositorySources = [];
  for (const source of authority.manifest.sources) {
    const paths = sourcePaths(source);
    const relative = `guides/${source.file}`;
    assertNoSymlinkAncestors(authority.root, relative, { allowMissingLeaf: false });
    const data = await withOpenedRegularFile(path.join(authority.root, relative), (handle) => handle.readFile());
    const actual = sha(data);
    if (source.sha256 && actual !== source.sha256) throw new Error(`Current source hash changed while building proposal packet: ${source.file}.`);
    const map = mapByGuide.get(source.id);
    if (!map) throw new Error(`Current bundle lacks source map ${source.id}.`);
    entries.set(paths.sourcePath, data);
    entries.set(paths.sourceMapPath, Buffer.from(canonicalJson(map)));
    repositorySources.push({ id: source.id, format: source.format, sourcePath: paths.sourcePath, sourceMapPath: paths.sourceMapPath, sourceSha256: actual });
  }
  entries.set("policy/source-layout.json", Buffer.from(canonicalJson(authority.layout)));
  entries.set("policy/owner-amendments.json", Buffer.from(canonicalJson(authority.amendments)));
  const provenance = buildProvenance(candidateBundle, authority.manifest);
  entries.set("policy/provenance.json", Buffer.from(canonicalJson(provenance)));
  entries.set("policy/certainty-and-authority.json", Buffer.from(canonicalJson(certaintyPolicy())));

  const caseById = new Map(caseRows.map((row) => [row.id, row]));
  for (const definition of regressionCases) {
    const row = caseById.get(definition.id);
    entries.set(`tests/decision-cases/${definition.id}.json`, Buffer.from(canonicalJson(decisionCase(definition, row?.affectedNodeIds ?? []))));
  }
  const proposalEvidenceSha256 = sha(Buffer.from(canonicalJson(evidence)));
  const ownerDecisions = { contractVersion: "guide-owner-decisions-v1", status: "awaiting-owner", proposalEvidenceSha256, cards: decisions, allApproved: false };
  entries.set("audit/behavioral-diff.json", Buffer.from(canonicalJson(diff)));
  entries.set("audit/owner-decisions.json", Buffer.from(canonicalJson(ownerDecisions)));
  entries.set("audit/provenance-impact.json", Buffer.from(canonicalJson(provenanceImpact)));
  entries.set("audit/proposal-evidence.json", Buffer.from(canonicalJson(evidence)));

  const sectionsByGuide = Object.fromEntries(candidateBundle.sourceMaps.map((map) => [map.guideId, map.sections.map((section) => ({ ...section, guideId: map.guideId }))]));
  const qualityAudit = runGuideQualityAudit({ manifest: { createdAt: "1980-01-01T00:00:00.000Z" }, sectionsByGuide, graphs: candidateBundle.graphs, provenance, ownerAmendments: authority.amendments });
  if (qualityAudit.counts.block) throw new Error(`Proposal packet quality audit has ${qualityAudit.counts.block} blocking finding(s).`);
  entries.set("audit/guide-quality-findings.json", Buffer.from(canonicalJson(qualityAudit)));

  const graphData = Object.fromEntries(candidateBundle.graphs.map((graph) => [graph.graphId, entries.get(graphPaths[graph.graphId])]));
  const sourceById = new Map(authority.manifest.sources.map((source) => [source.id, source]));
  const packetId = safePacketId(`authoring-${proposal.id}`);
  const manifest = {
    format: GUIDE_PACKET_FORMAT,
    schemaVersion: GUIDE_PACKET_SCHEMA_VERSION,
    sourceMode: "repository-current-v1",
    packetId,
    packetVersion: `${candidateBundle.version}-${sha(Buffer.from(canonicalJson(diff))).slice(0, 12)}`,
    packetRevision: 1,
    status: "candidate",
    minimumRuntimeVersion: "0.15.2",
    graphContractVersion: "guide-graph-v1",
    graphBundleVersion: candidateBundle.version,
    candidateOnly: true,
    approvalRequired: diff.substantive,
    proposalId: proposal.id,
    baseProjectionInputSha256: proposal.manifest.base_projection_input_sha256,
    guides: [
      { id: "inner-child", revision: sourceById.get("inner-child-guide").version, ...sourcePaths(sourceById.get("inner-child-guide")), graphPath: graphPaths["inner-child-directed-graph"], sourceSha256: repositorySources.find((item) => item.id === "inner-child-guide").sourceSha256, graphSha256: sha(graphData["inner-child-directed-graph"]) },
      { id: "somatic", revision: sourceById.get("somatic-sequencing-guide").version, ...sourcePaths(sourceById.get("somatic-sequencing-guide")), graphPath: graphPaths["somatic-directed-graph"], sourceSha256: repositorySources.find((item) => item.id === "somatic-sequencing-guide").sourceSha256, graphSha256: sha(graphData["somatic-directed-graph"]) }
    ],
    repositorySources,
    candidateGraphs: candidateBundle.graphs.map((graph) => ({ graphId: graph.graphId, path: candidatePaths[graph.graphId], sha256: sha(entries.get(candidatePaths[graph.graphId])) })).sort((left, right) => compareText(left.graphId, right.graphId)),
    paths: { provenance: "policy/provenance.json", certainty: "policy/certainty-and-authority.json", ownerAmendments: "policy/owner-amendments.json", sourceLayout: "policy/source-layout.json", behavioralDiff: "audit/behavioral-diff.json", qualityAudit: "audit/guide-quality-findings.json", ownerDecisions: "audit/owner-decisions.json", provenanceImpact: "audit/provenance-impact.json", proposalEvidence: "audit/proposal-evidence.json" },
    proposalEvidenceSha256,
    sourceFamilyPackages: provenance.sourceFamilies,
    privateDataIncluded: false
  };
  entries.set("manifest.json", Buffer.from(canonicalJson(manifest)));
  entries.set("README.md", Buffer.from(`# Inner Signal authoring proposal packet\n\nProposal: ${proposal.id}\n\nStatus: candidate only. This packet preserves the current repository source family, exact candidate graph members, compiled graph bundle, provenance, regressions, and pending owner decisions. It cannot install without the existing owner-decision lifecycle.\n`));
  const sums = [...entries.entries()].sort(([left], [right]) => compareText(left, right)).map(([name, data]) => `${sha(data)}  ${name}`).join("\n") + "\n";
  entries.set("SHA256SUMS.txt", Buffer.from(sums));
  const buffer = createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), new Date("1980-01-01T00:00:00.000Z"));
  return { buffer, manifest, packetSha256: sha(buffer), qualityAudit, ownerDecisions, provenance };
}
