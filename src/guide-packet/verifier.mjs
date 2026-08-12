import { createHash } from "node:crypto";
import { readZipEntries } from "../core/zip.mjs";
import { validateGraph } from "../guide-graph/validate.mjs";
import { GUIDE_PACKET_FORMAT, GUIDE_PACKET_SCHEMA_VERSION, REQUIRED_PACKET_PATHS, comparePacketRevision, canonicalJson, INNER_CHILD_SECTION_ALIASES, SOMATIC_SECTION_ALIASES } from "./contract.mjs";
import { extractEditorBody, extractHtmlSections, buildSourceMap } from "./source-html.mjs";
import { runGuideQualityAudit } from "./quality-audit.mjs";
import { runGuidePacketRegressionSuite } from "./regressions.mjs";
import { buildBehavioralDiff, buildDecisionCards } from "./diff.mjs";

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

export function verifyGuidePacket(buffer, { installedRevision = null, installedBundle = null, mode = "candidate" } = {}) {
  const errors = [];
  const warnings = [];
  let entries;
  try { entries = readZipEntries(buffer); }
  catch (error) { return { ok: false, errors: [error.message], warnings, installable: false }; }

  for (const required of REQUIRED_PACKET_PATHS) if (!entries.has(required)) errors.push(`Required packet member is missing: ${required}.`);
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
  if (manifest) {
    if (manifest.format !== GUIDE_PACKET_FORMAT) errors.push(`Packet format must be ${GUIDE_PACKET_FORMAT}.`);
    if (manifest.schemaVersion !== GUIDE_PACKET_SCHEMA_VERSION) errors.push(`Packet schema version must be ${GUIDE_PACKET_SCHEMA_VERSION}.`);
    if (!Number.isInteger(manifest.packetRevision) || manifest.packetRevision < 1) errors.push("manifest.packetRevision must be a positive integer.");
    if (!Array.isArray(manifest.guides) || manifest.guides.length < 2) errors.push("manifest.guides must include inner-child and somatic guides.");
    if (manifest.privateDataIncluded !== false) errors.push("manifest must declare privateDataIncluded=false.");
  }

  const guideRecords = {};
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

  const crossGraph = parseJson(entries, "graphs/cross-guide-edges.json", errors);
  const graphBundle = parseJson(entries, "graphs/bundle.json", errors);
  const ownerAmendments = parseJson(entries, "policy/owner-amendments.json", errors);
  const provenance = parseJson(entries, "policy/provenance.json", errors);
  const certainty = parseJson(entries, "policy/certainty-and-authority.json", errors);
  const embeddedAudit = parseJson(entries, "audit/guide-quality-findings.json", errors);
  const embeddedDecisions = parseJson(entries, "audit/owner-decisions.json", errors);
  const embeddedDiff = parseJson(entries, "audit/behavioral-diff.json", errors);
  const regressionCases = collectRegressionCases(entries, errors);
  const externalSources = collectExternalSources(entries, manifest, provenance, errors);

  const graphs = [guideRecords["inner-child"]?.graph, guideRecords.somatic?.graph, crossGraph].filter(Boolean);
  const sectionsByGuide = {
    "inner-child": guideRecords["inner-child"]?.sections ?? [],
    somatic: guideRecords.somatic?.sections ?? []
  };
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
    const ids = new Set((graphBundle.graphs ?? []).map((graph) => graph.graphId));
    for (const graph of graphs) if (!ids.has(graph.graphId)) errors.push(`Graph bundle omits ${graph.graphId}.`);
    if (graphBundle.version !== manifest?.graphBundleVersion) errors.push("Graph bundle version does not match manifest.");
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

  const behavioralDiff = installedBundle && graphBundle
    ? buildBehavioralDiff(installedBundle, graphBundle, { regressionCases })
    : embeddedDiff ?? { substantive: true, affectedCases: [] };
  const decisionCards = installedBundle ? buildDecisionCards(behavioralDiff, provenance) : embeddedDecisions?.cards ?? [];
  if (behavioralDiff.substantive && decisionCards.length === 0) errors.push("Substantive graph change is missing behavioral decision cards.");

  let monotonic = true;
  if (installedRevision != null && manifest?.packetRevision != null) monotonic = comparePacketRevision(manifest.packetRevision, installedRevision) > 0;
  if (!monotonic) warnings.push("Packet revision is the same as or older than the installed packet and cannot replace it.");
  const approved = manifest?.status === "approved" || embeddedDecisions?.allApproved === true;
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
