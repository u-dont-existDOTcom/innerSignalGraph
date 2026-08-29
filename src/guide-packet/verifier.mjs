import { createHash } from "node:crypto";
import { readZipEntries } from "../core/zip.mjs";
import { validateGraph } from "../guide-graph/validate.mjs";
import { assertClassifiedGraphBundle } from "../guide-graph/semantic-diff.mjs";
import { GUIDE_PACKET_FORMAT, GUIDE_PACKET_SCHEMA_VERSION, REQUIRED_PACKET_PATHS, comparePacketRevision, canonicalJson, INNER_CHILD_SECTION_ALIASES, SOMATIC_SECTION_ALIASES } from "./contract.mjs";
import { extractEditorBody, extractHtmlSections, buildSourceMap } from "./source-html.mjs";
import { runGuideQualityAudit } from "./quality-audit.mjs";
import { runGuidePacketRegressionSuite } from "./regressions.mjs";
import { buildBehavioralDiff, buildDecisionCards, buildBehavioralDiffV2, buildDecisionCardsV2 } from "./diff.mjs";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function parseJson(entries, name, errors) {
  const data = entries.get(name);
  if (!data) return null;
  try { return JSON.parse(data.toString("utf8")); }
  catch (error) { errors.push(`${name} is not valid JSON: ${error.message}`); return null; }
}

function parseChecksums(data) {
  const map = new Map();
  for (const [index, line] of data.toString("utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64})  (.+)$/i);
    if (!match) throw new Error(`SHA256SUMS line ${index + 1} is malformed.`);
    if (map.has(match[2])) throw new Error(`SHA256SUMS contains duplicate path ${match[2]}.`);
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

function collectRegressionCases(entries, errors) {
  const values = [];
  for (const [name] of entries) {
    if (!name.startsWith("tests/decision-cases/") || !name.endsWith(".json")) continue;
    const value = parseJson(entries, name, errors);
    if (value) values.push(value);
  }
  return values.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function collectExternalSources(entries, manifest, provenance, errors) {
  const values = [];
  const seen = new Set();
  for (const source of manifest?.externalSources ?? []) {
    if (!source?.id || seen.has(source.id)) {
      errors.push(`External source id is missing or duplicated: ${source?.id ?? "missing"}.`);
      continue;
    }
    seen.add(source.id);
    const sourceData = entries.get(source.sourcePath);
    const excerptData = entries.get(source.excerptPath);
    if (!sourceData) errors.push(`External source ${source.id} is missing ${source.sourcePath}.`);
    if (!excerptData) errors.push(`External source ${source.id} is missing ${source.excerptPath}.`);
    if (!sourceData || !excerptData) continue;
    if (sha256(sourceData) !== source.sourceSha256) errors.push(`External source ${source.id} PDF hash does not match manifest.`);
    if (sha256(excerptData) !== source.excerptSha256) errors.push(`External source ${source.id} excerpt hash does not match manifest.`);
    if (!Number.isInteger(source.page) || source.page < 1) errors.push(`External source ${source.id} page must be a positive integer.`);
    if (source.availableInWorker !== true) errors.push(`External source ${source.id} must declare availableInWorker=true when attached.`);
    if (source.independentlyValidated !== false) errors.push(`External source ${source.id} must preserve independentlyValidated=false unless separately audited.`);
    const provenanceSource = provenance?.sourceRefs?.[source.id];
    if (!provenanceSource) errors.push(`External source ${source.id} lacks provenance.`);
    else if (provenanceSource.sourceSha256 !== source.sourceSha256 || provenanceSource.excerptSha256 !== source.excerptSha256) {
      errors.push(`External source ${source.id} provenance hashes do not match manifest.`);
    }
    values.push({ ...source, text: excerptData.toString("utf8") });
  }
  return values;
}

function privateDataErrors(entries) {
  const errors = [];
  const forbiddenPath = /(^|\/)(\.env|auth\.json|credentials?|secrets?|tokens?|ledgers?|therapy-transcripts?|runtime-state|development-jobs?)(\/|$)/i;
  const forbiddenContent = /(OPENAI_API_KEY\s*=|ANTHROPIC_API_KEY\s*=|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|"recentTranscript"\s*:|"therapy"\s*:\s*\[)/i;
  for (const [name, data] of entries) {
    if (forbiddenPath.test(name)) errors.push(`Private/runtime path is forbidden in guide packet: ${name}.`);
    if (data.length < 2_000_000 && forbiddenContent.test(data.toString("utf8"))) errors.push(`Credential or private transcript material detected in ${name}.`);
  }
  return errors;
}

function embeddedTextSourceMap(text, guide) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const starts = guide.sections.map((section) => {
    const index = lines.findIndex((line) => line.trim() === section.heading);
    if (index < 0) throw new Error(`Missing source heading ${section.heading}.`);
    return { ...section, index };
  });
  for (let index = 1; index < starts.length; index += 1) if (starts[index].index <= starts[index - 1].index) throw new Error(`Source headings are out of order for ${guide.guideId}.`);
  return {
    guideId: guide.guideId,
    file: guide.file,
    sections: starts.map((section, index) => {
      const endIndex = starts[index + 1] ? starts[index + 1].index - 1 : lines.length - 1;
      const sectionText = lines.slice(section.index, endIndex + 1).join("\n").trim();
      return { id: section.id, heading: section.heading, lineStart: section.index + 1, lineEnd: endIndex + 1, sha256: sha256(sectionText), excerpt: sectionText.slice(0, 500) };
    })
  };
}

function embeddedOwnerSourceMap(data) {
  const amendments = JSON.parse(data.toString("utf8"));
  return {
    guideId: "owner-amendments",
    file: "owner-amendments.json",
    sections: amendments.items.map((item) => ({ id: item.id, heading: item.id, lineStart: null, lineEnd: null, sha256: sha256(item.text), excerpt: item.text, status: item.status, domain: item.domain }))
  };
}

function embeddedPdfSourceMap(layout, source) {
  return {
    guideId: source.id,
    file: pathBasename(source.sourcePath),
    sections: layout.pdfSections.filter((section) => section.sourceId === source.id).map((section) => ({ id: section.id, sourceId: section.sourceId, pages: section.pages, sha256: source.sourceSha256, excerpt: `PDF source pages ${section.pages.join(", ")}` }))
  };
}

function pathBasename(value) {
  return String(value ?? "").split("/").pop();
}

function decisionContract(card) {
  const { status, ownerNote, decidedAt, ...contract } = card ?? {};
  return canonicalJson(contract);
}

const REPOSITORY_GRAPH_IDS = Object.freeze([
  "inner-child-directed-graph",
  "somatic-directed-graph",
  "inner-child-somatic-cross-guide"
]);

export function verifyGuidePacket(buffer, { installedRevision = null, installedBundle = null, mode = "candidate" } = {}) {
  const errors = [];
  const warnings = [];
  let entries;
  try { entries = readZipEntries(buffer); }
  catch (error) { return { ok: false, errors: [error.message], warnings, installable: false }; }

  for (const required of ["manifest.json", "SHA256SUMS.txt"]) if (!entries.has(required)) errors.push(`Required packet member is missing: ${required}.`);
  errors.push(...privateDataErrors(entries));

  let sums = new Map();
  if (entries.has("SHA256SUMS.txt")) {
    try { sums = parseChecksums(entries.get("SHA256SUMS.txt")); }
    catch (error) { errors.push(error.message); }
    for (const [name, data] of entries) {
      if (name === "SHA256SUMS.txt") continue;
      const expected = sums.get(name);
      if (!expected) errors.push(`SHA256SUMS omits ${name}.`);
      else if (sha256(data) !== expected) errors.push(`Checksum mismatch for ${name}.`);
    }
    for (const name of sums.keys()) if (!entries.has(name)) errors.push(`SHA256SUMS references missing member ${name}.`);
  }

  const manifest = parseJson(entries, "manifest.json", errors);
  const repositoryMode = manifest?.sourceMode === "repository-current-v1";
  const requiredPaths = repositoryMode
    ? [
        "manifest.json", "SHA256SUMS.txt", "graphs/inner-child.graph.json", "graphs/somatic.graph.json",
        "graphs/cross-guide-edges.json", "graphs/bundle.json", "policy/source-layout.json",
        "policy/owner-amendments.json", "policy/provenance.json", "policy/certainty-and-authority.json",
        "audit/behavioral-diff.json", "audit/guide-quality-findings.json", "audit/owner-decisions.json", manifest?.paths?.proposalEvidence, "README.md",
        ...(manifest?.guides ?? []).flatMap((guide) => [guide.sourcePath, guide.sourceMapPath, guide.graphPath]),
        ...(manifest?.repositorySources ?? []).flatMap((source) => [source.sourcePath, source.sourceMapPath]),
        ...(manifest?.candidateGraphs ?? []).map((graph) => graph.path)
      ]
    : REQUIRED_PACKET_PATHS;
  for (const required of new Set(requiredPaths.filter(Boolean))) if (!entries.has(required)) errors.push(`Required packet member is missing: ${required}.`);
  if (manifest) {
    if (manifest.format !== GUIDE_PACKET_FORMAT) errors.push(`Packet format must be ${GUIDE_PACKET_FORMAT}.`);
    if (manifest.schemaVersion !== GUIDE_PACKET_SCHEMA_VERSION) errors.push(`Packet schema version must be ${GUIDE_PACKET_SCHEMA_VERSION}.`);
    if (!Number.isInteger(manifest.packetRevision) || manifest.packetRevision < 1) errors.push("manifest.packetRevision must be a positive integer.");
    if (!Array.isArray(manifest.guides) || manifest.guides.length < 2) errors.push("manifest.guides must include inner-child and somatic guides.");
    if (manifest.privateDataIncluded !== false) errors.push("manifest must declare privateDataIncluded=false.");
  }

  const guideRecords = {};
  const repositorySourceMaps = [];
  if (repositoryMode) {
    const layout = parseJson(entries, manifest.paths?.sourceLayout ?? "policy/source-layout.json", errors);
    const sourceRecords = new Map();
    const ids = new Set();
    for (const source of manifest.repositorySources ?? []) {
      if (!source?.id || ids.has(source.id)) { errors.push(`Repository source id is missing or duplicated: ${source?.id ?? "missing"}.`); continue; }
      ids.add(source.id);
      const data = entries.get(source.sourcePath);
      const sourceMap = parseJson(entries, source.sourceMapPath, errors);
      if (!data || !sourceMap) continue;
      const actual = sha256(data);
      if (actual !== source.sourceSha256) errors.push(`Repository source ${source.id} hash does not match manifest.`);
      if (sourceMap.guideId !== source.id || sourceMap.file !== pathBasename(source.sourcePath)) errors.push(`Repository source map identity does not match ${source.id}.`);
      try {
        let expected = null;
        if (source.format === "text") {
          const guide = layout?.textGuides?.find((item) => item.guideId === source.id);
          if (!guide) throw new Error(`Source layout lacks ${source.id}.`);
          expected = embeddedTextSourceMap(data.toString("utf8"), guide);
        } else if (source.format === "json" && source.id === "owner-amendments") expected = embeddedOwnerSourceMap(data);
        else if (source.format === "pdf") expected = embeddedPdfSourceMap(layout, source);
        if (!expected || canonicalJson(sourceMap) !== canonicalJson(expected)) errors.push(`Repository source map is stale for ${source.id}.`);
      } catch (error) {
        errors.push(`Repository source ${source.id} could not be verified: ${error.message}`);
      }
      sourceRecords.set(source.id, { data, sourceMap });
      repositorySourceMaps.push(sourceMap);
    }
    for (const guide of manifest?.guides ?? []) {
      const sourceId = guide.id === "inner-child" ? "inner-child-guide" : guide.id === "somatic" ? "somatic-sequencing-guide" : guide.id;
      const sourceRecord = sourceRecords.get(sourceId);
      const graph = parseJson(entries, guide.graphPath, errors);
      if (!sourceRecord || !graph) continue;
      const guideSourceMap = parseJson(entries, guide.sourceMapPath, errors);
      if (!guideSourceMap || canonicalJson(sourceRecord.sourceMap) !== canonicalJson(guideSourceMap)) errors.push(`${guide.id} guide source map does not match repository source record.`);
      if (sha256(sourceRecord.data) !== guide.sourceSha256) errors.push(`${guide.id} source hash does not match manifest.`);
      if (sha256(entries.get(guide.graphPath)) !== guide.graphSha256) errors.push(`${guide.id} graph hash does not match manifest.`);
      guideRecords[guide.id] = { source: sourceRecord.data, body: sourceRecord.data, sourceMap: sourceRecord.sourceMap, sections: sourceRecord.sourceMap.sections.map((item) => ({ ...item, guideId: sourceRecord.sourceMap.guideId })), graph };
    }
  } else {
    for (const guide of manifest?.guides ?? []) {
      const source = entries.get(guide.sourcePath);
      const body = entries.get(guide.editorBodyPath);
      const sourceMap = parseJson(entries, guide.sourceMapPath, errors);
      const sections = parseJson(entries, guide.sectionsPath, errors);
      const graph = parseJson(entries, guide.graphPath, errors);
      if (!source || !body || !sourceMap || !Array.isArray(sections) || !graph) continue;
      const sourceHash = sha256(source);
      if (sourceHash !== guide.sourceSha256) errors.push(`${guide.id} source hash does not match manifest.`);
      let extracted;
      try { extracted = extractEditorBody(source.toString("utf8")); }
      catch (error) { errors.push(`${guide.id} canonical source is incomplete: ${error.message}`); }
      if (extracted) {
        if (extracted.sha256 !== guide.editorBodySha256) errors.push(`${guide.id} editor-body hash does not match manifest.`);
        if (body.toString("utf8") !== extracted.body) errors.push(`${guide.id} editor-body member is not the exact editor root body.`);
      }
      if (sourceMap.sourceSha256 !== sourceHash || sourceMap.editorBodySha256 !== guide.editorBodySha256) errors.push(`${guide.id} source map is stale relative to canonical source.`);
      const aliases = guide.id === "inner-child" ? INNER_CHILD_SECTION_ALIASES : guide.id === "somatic" ? SOMATIC_SECTION_ALIASES : {};
      const sourceText = source.toString("utf8");
      try {
        const expectedSourceMap = buildSourceMap({ guideId: guide.id, revision: guide.revision, sourcePath: guide.sourcePath, html: sourceText, aliases });
        if (canonicalJson(sourceMap) !== canonicalJson(expectedSourceMap)) errors.push(`${guide.id} source map is stale relative to the canonical source-derived map.`);
        const expectedSections = extractHtmlSections(sourceText, { guideId: guide.id, aliases }).map(({ rawHtml, ...item }) => ({ ...item, guideId: guide.id }));
        if (canonicalJson(sections) !== canonicalJson(expectedSections)) errors.push(`${guide.id} sections inventory is stale relative to the canonical source-derived sections.`);
      } catch (error) {
        errors.push(`${guide.id} derived source artifacts could not be verified: ${error.message}`);
      }
      if (graph.sourceRevision?.sourceSha256 !== sourceHash || guide.graphSourceSha256 !== sourceHash) errors.push(`${guide.id} graph is stale relative to the changed source hash.`);
      if (sha256(entries.get(guide.graphPath)) !== guide.graphSha256) errors.push(`${guide.id} graph hash does not match manifest.`);
      guideRecords[guide.id] = { source, body, sourceMap, sections, graph };
    }
  }

  const crossGraph = parseJson(entries, "graphs/cross-guide-edges.json", errors);
  const graphBundle = parseJson(entries, "graphs/bundle.json", errors);
  const ownerAmendments = parseJson(entries, "policy/owner-amendments.json", errors);
  const provenance = parseJson(entries, "policy/provenance.json", errors);
  const certainty = parseJson(entries, "policy/certainty-and-authority.json", errors);
  const embeddedAudit = parseJson(entries, "audit/guide-quality-findings.json", errors);
  const embeddedDecisions = parseJson(entries, "audit/owner-decisions.json", errors);
  const embeddedDiff = parseJson(entries, "audit/behavioral-diff.json", errors);
  if (repositoryMode) {
    const evidence = entries.get(manifest?.paths?.proposalEvidence ?? "");
    const evidenceHash = evidence ? sha256(evidence) : null;
    if (!evidence || evidenceHash !== manifest?.proposalEvidenceSha256 || evidenceHash !== embeddedDecisions?.proposalEvidenceSha256) errors.push("Proposal evidence hash does not match manifest and owner-decision evidence.");
  }
  const regressionCases = collectRegressionCases(entries, errors);
  const externalSources = collectExternalSources(entries, manifest, provenance, errors);
  if (repositoryMode) {
    const sourceAmendments = entries.get((manifest.repositorySources ?? []).find((item) => item.id === "owner-amendments")?.sourcePath ?? "");
    try {
      if (!sourceAmendments || !ownerAmendments || canonicalJson(JSON.parse(sourceAmendments.toString("utf8"))) !== canonicalJson(ownerAmendments)) errors.push("Repository owner-amendments source does not match packet policy.");
    } catch (error) { errors.push(`Repository owner-amendments source is invalid: ${error.message}`); }
  }

  const graphs = [guideRecords["inner-child"]?.graph, guideRecords.somatic?.graph, crossGraph].filter(Boolean);
  const sectionsByGuide = repositoryMode
    ? Object.fromEntries(repositorySourceMaps.map((map) => [map.guideId, map.sections.map((section) => ({ ...section, guideId: map.guideId }))]))
    : { "inner-child": guideRecords["inner-child"]?.sections ?? [], somatic: guideRecords.somatic?.sections ?? [] };
  const sourceRefs = new Set([
    ...Object.values(sectionsByGuide).flat().map((section) => section.id),
    ...(ownerAmendments?.items ?? []).map((item) => item.id),
    ...Object.keys(provenance?.sourceRefs ?? {})
  ]);
  const nodeIds = new Set(graphs.flatMap((graph) => graph.nodes ?? []).map((node) => node.id));
  for (const graph of graphs) {
    try { validateGraph(graph, { knownSourceRefs: sourceRefs, knownNodeIds: nodeIds }); }
    catch (error) { errors.push(`Graph validation failed: ${error.message}`); }
  }
  for (const graph of graphs) for (const node of graph.nodes ?? []) {
    const supported = (node.sourceRefs ?? []).some((ref) => sourceRefs.has(ref));
    if (!supported) errors.push(`Graph node ${node.id} lacks source support or an owner amendment.`);
    if (!provenance?.nodes?.[node.id]) errors.push(`Graph node ${node.id} lacks exact provenance.`);
    if (node.authority === "model-inference" && !(node.sourceRefs ?? []).some((ref) => (ownerAmendments?.items ?? []).some((item) => item.id === ref))) {
      errors.push(`Model-inferred graph node ${node.id} cannot become owner policy without an owner amendment.`);
    }
  }

  if (graphBundle) {
    if (repositoryMode) {
      try { assertClassifiedGraphBundle(graphBundle, { label: "packet graph bundle" }); }
      catch (error) { errors.push(`Repository graph bundle is not a complete classified bundle: ${error.message}`); }
    }
    const bundledById = new Map((graphBundle.graphs ?? []).map((graph) => [graph.graphId, graph]));
    for (const graph of graphs) {
      if (!bundledById.has(graph.graphId)) errors.push(`Graph bundle omits ${graph.graphId}.`);
      else if (canonicalJson(bundledById.get(graph.graphId)) !== canonicalJson(graph)) errors.push(`Graph bundle member ${graph.graphId} differs from its standalone packet member.`);
    }
    if (bundledById.size !== graphs.length) errors.push("Graph bundle contains graphs not represented by standalone packet members.");
    if (graphBundle.version !== manifest?.graphBundleVersion) errors.push("Graph bundle version does not match manifest.");
    if (repositoryMode) {
      const packetMaps = new Map();
      for (const map of repositorySourceMaps) {
        if (packetMaps.has(map.guideId)) errors.push(`Repository source maps duplicate ${map.guideId}.`);
        packetMaps.set(map.guideId, map);
      }
      const bundleMaps = new Map();
      for (const map of graphBundle.sourceMaps ?? []) {
        if (bundleMaps.has(map.guideId)) errors.push(`Graph bundle source maps duplicate ${map.guideId}.`);
        bundleMaps.set(map.guideId, map);
      }
      if (packetMaps.size !== bundleMaps.size) errors.push("Graph bundle source maps do not exactly match repository source members.");
      for (const [guideId, map] of packetMaps) {
        if (!bundleMaps.has(guideId) || canonicalJson(bundleMaps.get(guideId)) !== canonicalJson(map)) errors.push(`Graph bundle source map differs from repository source member ${guideId}.`);
      }
    }
  }
  const candidateGraphRecords = manifest?.candidateGraphs ?? [];
  const candidateIds = new Set();
  if (repositoryMode && (candidateGraphRecords.length !== REPOSITORY_GRAPH_IDS.length || candidateGraphRecords.some((record) => !REPOSITORY_GRAPH_IDS.includes(record?.graphId)))) {
    errors.push("Repository packet must declare exactly the three canonical candidate graph ids.");
  }
  for (const record of candidateGraphRecords) {
    if (!record?.graphId || candidateIds.has(record.graphId)) errors.push(`Candidate graph id is missing or duplicated: ${record?.graphId ?? "missing"}.`);
    candidateIds.add(record?.graphId);
    const data = entries.get(record?.path);
    if (!data || sha256(data) !== record?.sha256) {
      errors.push(`Candidate graph member hash does not match manifest: ${record?.graphId ?? record?.path}.`);
      continue;
    }
    if (repositoryMode) {
      try {
        const candidate = JSON.parse(data.toString("utf8"));
        if (candidate.graphId !== record.graphId) errors.push(`Candidate graph member identity does not match manifest: ${record.graphId}.`);
        const bundled = (graphBundle?.graphs ?? []).find((graph) => graph.graphId === record.graphId);
        const expectedCompiled = { ...candidate, bundleVersion: graphBundle?.version };
        if (!bundled || canonicalJson(expectedCompiled) !== canonicalJson(bundled)) errors.push(`Candidate graph member does not compile to packet bundle member ${record.graphId}.`);
      } catch (error) {
        errors.push(`Candidate graph member is invalid JSON: ${record.graphId}: ${error.message}`);
      }
    }
  }

  const regressionStatus = runGuidePacketRegressionSuite(buffer);
  if (!regressionStatus.ok) {
    for (const item of regressionStatus.results.filter((result) => result.status !== "pass")) {
      errors.push(`Affected-case regression ${item.id} failed: ${item.failures.join(" | ")}`);
    }
  }

  const qualityAudit = manifest && provenance && ownerAmendments
    ? runGuideQualityAudit({ manifest, sectionsByGuide, graphs, provenance, ownerAmendments })
    : { findings: [], counts: { block: 0, review: 0, info: 0 } };
  if (qualityAudit.counts.block > 0) errors.push(`Guide quality audit has ${qualityAudit.counts.block} blocking finding(s).`);
  if (embeddedAudit && JSON.stringify(embeddedAudit.findings?.map((item) => item.code).sort()) !== JSON.stringify(qualityAudit.findings.map((item) => item.code).sort())) {
    warnings.push("Embedded guide-quality audit differs from current deterministic audit output.");
  }

  let behavioralDiff = embeddedDiff ?? { substantive: true, affectedCases: [] };
  if (installedBundle && graphBundle) {
    try {
      behavioralDiff = repositoryMode
        ? buildBehavioralDiffV2(installedBundle, graphBundle, { regressionCases })
        : buildBehavioralDiff(installedBundle, graphBundle, { regressionCases });
    } catch (error) {
      errors.push(`Verified behavioral diff could not be built: ${error.message}`);
      behavioralDiff = { contractVersion: repositoryMode ? "guide-behavioral-diff-v2" : "guide-behavioral-diff-v1", substantive: true, affectedCases: [], changes: [] };
    }
  }
  let decisionCards = embeddedDecisions?.cards ?? [];
  if (installedBundle) {
    try { decisionCards = repositoryMode ? buildDecisionCardsV2(behavioralDiff) : buildDecisionCards(behavioralDiff, provenance); }
    catch (error) { errors.push(`Verified behavioral decision cards could not be built: ${error.message}`); decisionCards = []; }
  }
  if (repositoryMode && embeddedDiff?.contractVersion !== "guide-behavioral-diff-v2") errors.push("Repository packet must contain a complete guide-behavioral-diff-v2 audit.");
  if (repositoryMode && embeddedDiff?.contractVersion === "guide-behavioral-diff-v2") {
    let expectedCards = [];
    try { expectedCards = buildDecisionCardsV2(embeddedDiff); }
    catch (error) { errors.push(`Embedded semantic diff cannot produce decision cards: ${error.message}`); }
    const actualContracts = (embeddedDecisions?.cards ?? []).map(decisionContract).sort();
    const expectedContracts = expectedCards.map(decisionContract).sort();
    if (canonicalJson(actualContracts) !== canonicalJson(expectedContracts)) errors.push("Embedded owner-decision cards do not exactly match the complete semantic diff.");
    if (installedBundle && canonicalJson(embeddedDiff) !== canonicalJson(behavioralDiff)) errors.push("Embedded semantic diff does not match the verified baseline and packet bundle.");
  }
  if (behavioralDiff.substantive && decisionCards.length === 0) errors.push("Substantive graph change is missing behavioral decision cards.");

  let monotonic = true;
  if (installedRevision != null && manifest?.packetRevision != null) monotonic = comparePacketRevision(manifest.packetRevision, installedRevision) > 0;
  if (!monotonic) warnings.push("Packet revision is the same as or older than the installed packet and cannot replace it.");
  const manifestClaimsApproval = manifest?.status === "approved" || manifest?.candidateOnly === false;
  const decisionsClaimApproval = embeddedDecisions?.status === "approved" || embeddedDecisions?.allApproved === true;
  const cardsFullyApproved = (embeddedDecisions?.cards ?? []).length > 0 && embeddedDecisions.cards.every((card) => card.status === "approve");
  const decisionHashMatches = Boolean(manifest?.approvalDecisionHash) && manifest.approvalDecisionHash === sha256(Buffer.from(canonicalJson(embeddedDecisions)));
  const approved = manifestClaimsApproval && decisionsClaimApproval && cardsFullyApproved && decisionHashMatches;
  if (manifestClaimsApproval || decisionsClaimApproval) {
    if (!approved) errors.push("Guide packet approval claims are incomplete or inconsistent across manifest, decision cards, and approval hash.");
    if (manifest?.approvalRequired !== false) errors.push("Approved guide packet must declare approvalRequired=false.");
  }
  const installable = errors.length === 0 && monotonic && approved && mode === "install";
  if (mode === "install" && !approved) errors.push("Guide packet is not owner-approved and cannot be installed.");
  if (mode === "install" && !monotonic) errors.push("Same or older guide packet cannot replace the installed packet.");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    entries,
    manifest,
    graphs,
    packetGraphBundle: graphBundle,
    sectionsByGuide,
    sourceMapsByGuide: Object.fromEntries(Object.entries(guideRecords).map(([guideId, record]) => [guideId, record.sourceMap])),
    ownerAmendments,
    provenance,
    certainty,
    externalSources,
    regressionCases,
    regressionStatus,
    qualityAudit,
    behavioralDiff,
    decisionCards,
    monotonic,
    approved,
    installable,
    packetSha256: sha256(buffer)
  };
}
