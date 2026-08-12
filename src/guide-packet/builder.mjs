import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createStoredZip } from "../core/zip.mjs";
import { canonicalJson, GUIDE_PACKET_FORMAT, GUIDE_PACKET_SCHEMA_VERSION, INNER_CHILD_SECTION_ALIASES, SOMATIC_SECTION_ALIASES, safePacketId } from "./contract.mjs";
import { extractEditorBody, extractHtmlSections, buildSourceMap } from "./source-html.mjs";
import { buildBehavioralDiff, buildDecisionCards } from "./diff.mjs";
import { runGuideQualityAudit } from "./quality-audit.mjs";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rewriteSourceRefs(refs) {
  const replacements = {
    "AMEND.IC.EARLY_GENTLE_HYPNOSIS": "IC.ESCAPE_URGE",
    "AMEND.IC.BORROW_LOVE_EXTERNAL": "IC.BORROW_LOVE_PERSPECTIVE",
    "AMEND.IC.BEST_FRIEND_PROMPT": "IC.BORROW_LOVE_PERSPECTIVE",
    "AMEND.SOM.EARLY_INNER_CHILD_PARALLEL": "SOM.INNER_CHILD_PARALLEL",
    "AMEND.SOM.PREP_MODALITIES": "SOM.INNER_CHILD_PARALLEL",
    "AMEND.SOM.EMDR_AFTER_REPARENTING_CONDITIONAL": "SOM.INNER_CHILD_PARALLEL",
    "AMEND.SOM.ADVANCED_RELEASE_PARALLEL": "SOM.ADVANCED_RELEASE_SOURCE",
    "AMEND.SOM.ADVANCED_RELEASE_BYPASS": "SOM.ADVANCED_RELEASE_SOURCE",
    "AMEND.EVIDENCE.PROVENANCE": "SOM.MAP_NOT_LADDER"
  };
  return [...new Set((refs ?? []).map((ref) => replacements[ref] ?? ref))];
}

function buildCandidateGraphs({ innerGraph, somaticGraph, crossGraph, sourceHashes, graphVersion, graphOwnsAdvancedReleaseBlock = false }) {
  const inner = clone(innerGraph);
  const somatic = clone(somaticGraph);
  const cross = clone(crossGraph);
  for (const graph of [inner, somatic, cross]) {
    graph.version = graphVersion;
    graph.bundleVersion = graphVersion;
  }
  inner.description = "Candidate executable graph derived from the r01 inner-child article candidate and explicit product-only operational amendments.";
  somatic.description = "Candidate executable graph derived from the r01 five-job somatic article candidate and explicit provenance separation.";
  cross.description = "Candidate cross-guide dependencies for the r01 article candidates.";
  inner.sourceRevision = { guideId: "inner-child", revision: "r01-candidate", sourceSha256: sourceHashes.innerChild };
  somatic.sourceRevision = { guideId: "somatic", revision: "r01-candidate", sourceSha256: sourceHashes.somatic };
  cross.sourceRevision = { guideIds: ["inner-child", "somatic"], sourceSha256: sha256(`${sourceHashes.innerChild}:${sourceHashes.somatic}`) };

  for (const graph of [inner, somatic]) for (const node of graph.nodes) node.sourceRefs = rewriteSourceRefs(node.sourceRefs);

  const borrowed = inner.nodes.find((node) => node.id === "IC.BORROW_ONE_FUNCTION");
  if (borrowed) borrowed.priority = 95;
  const age = inner.nodes.find((node) => node.id === "IC.AGE_RESPONSIBILITY_CLARIFICATION");
  if (age) age.defaultQuestion = "Which age or version of you is the resentment actually directed toward, what opportunity do you believe that version failed to use, and what knowledge, support, safety, money, and freedom were actually available then?";
  const credibility = inner.nodes.find((node) => node.id === "IC.CREDIBILITY_REPAIR");
  if (credibility) {
    credibility.sourceRefs = [...new Set([...(credibility.sourceRefs ?? []), "IC.LOVE_UNSAFE"])] ;
    credibility.effects.deferNodes = [...new Set([...(credibility.effects?.deferNodes ?? []), "IC.DEEP_CHILD_DIALOGUE"])] ;
  }

  if (graphOwnsAdvancedReleaseBlock) {
    const advancedReleaseBlock = somatic.nodes.find((node) => node.id === "SOM.ADVANCED_RELEASE_BLOCK");
    if (!advancedReleaseBlock) throw new Error("Candidate somatic graph lacks SOM.ADVANCED_RELEASE_BLOCK.");
    advancedReleaseBlock.effects.blockNodes = [
      ...new Set([...(advancedReleaseBlock.effects?.blockNodes ?? []), "SOM.ADVANCED_RELEASE_OPTIONAL"])
    ];
  }

  if (!somatic.nodes.some((node) => node.id === "SOM.DELAYED_RESPONSE_REASSESSMENT")) {
    somatic.nodes.push({
      id: "SOM.DELAYED_RESPONSE_REASSESSMENT",
      title: "Reassess the dose immediately, next morning, and over two or three days",
      kind: "decision-node",
      tier: 6,
      priority: 67,
      activation: {
        any: [
          { field: "discharge_used", op: "eq", value: "yes" },
          { field: "advanced_release_interest", op: "eq", value: "present" },
          { field: "current_intent", op: "eq", value: "integration" }
        ]
      },
      sourceRefs: ["SOM.JUDGE_HELP", "SOM.ADVANCED_RELEASE_SOURCE"],
      authority: "author-framework",
      recommendations: [
        "Assess immediate regulation, then sleep, irritability, dissociation, pain, compulsive processing, relationships, and ordinary functioning the next morning and over the following two or three days.",
        "Use the delayed response to decide whether to repeat, reduce, stop, or intensify the practice."
      ],
      avoid: ["Do not treat a calm ending or dramatic session as sufficient evidence that the dose was right."],
      successSignals: ["Later functioning and recovery improve without delayed destabilization."],
      tags: ["response-history", "dose", "integration"],
      effects: { deferNodes: [], blockNodes: [], requiredNuance: ["Immediate relief and delayed response are different evidence."], forbiddenOverclaims: [] },
      defaultQuestion: "How were sleep, irritability, dissociation, pain, compulsive processing, relationships, and ordinary functioning later that day and over the next two or three days?"
    });
  }
  for (const from of ["SOM.GENTLE_SHAKING", "SOM.DEEP_BRAINSPOTTING", "SOM.EMDR_DISCRETE", "SOM.EMDR_DEVELOPMENTAL", "SOM.ADVANCED_RELEASE_OPTIONAL"]) {
    if (!somatic.edges.some((edge) => edge.from === from && edge.to === "SOM.DELAYED_RESPONSE_REASSESSMENT")) {
      somatic.edges.push({ from, to: "SOM.DELAYED_RESPONSE_REASSESSMENT", relation: "followed-by-delayed-reassessment" });
    }
  }
  return [inner, somatic, cross];
}

function buildOwnerAmendments(packetVersion) {
  return {
    version: packetVersion.replace(/^(\d{4})\.(\d{2})\.(\d{2})-/, "$1-$2-$3-"),
    status: "candidate",
    items: [
      {
        id: "OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL",
        domain: "product-only",
        status: "owner-approved-operational",
        sourceIntegrated: false,
        text: "The application, not the guide prose or model, owns formal hypnosis consent gates, route isolation, and the final waking return."
      },
      {
        id: "OWNER.PRODUCT.RENDERER_FIDELITY",
        domain: "product-only",
        status: "owner-approved-operational",
        sourceIntegrated: false,
        text: "The renderer must materially realize selected graph interventions and preserve the graph-owned substantive question."
      }
    ]
  };
}

function buildProvenance(graphs, sourceMaps, ownerAmendments, externalSources) {
  const sourceRefIndex = {};
  for (const map of sourceMaps) for (const section of map.sections) {
    sourceRefIndex[section.id] = { role: "canonical-source-prose", guideId: map.guideId, certainty: "author-framework", sourceSha256: map.sourceSha256, sectionSha256: section.rawHtmlSha256 };
  }
  for (const source of externalSources) {
    sourceRefIndex[source.id] = {
      role: "external-source",
      guideId: "vagal-blitz-source",
      certainty: "author-provided-source-specific-safety-caution",
      sourcePath: source.sourcePath,
      excerptPath: source.excerptPath,
      sourceSha256: source.sourceSha256,
      excerptSha256: source.excerptSha256,
      page: source.page,
      availableInWorker: true,
      independentlyValidated: false
    };
  }
  if (!externalSources.length) {
    sourceRefIndex["VAGAL.SAFETY.P5"] = { role: "external-source", guideId: "vagal-blitz-source", certainty: "source-specific-safety-caution", source: "existing validated runtime provenance; source-family package not attached to this worker" };
  }
  for (const item of ownerAmendments.items) sourceRefIndex[item.id] = { role: item.domain === "product-only" ? "product-only-operational" : "owner-amendment", certainty: item.status, sourceIntegrated: item.sourceIntegrated };
  const nodes = {};
  for (const graph of graphs) for (const node of graph.nodes ?? []) {
    const refs = node.sourceRefs ?? [];
    const roles = refs.map((ref) => sourceRefIndex[ref]?.role).filter(Boolean);
    let role = roles.includes("owner-amendment") ? "owner-amendment" : roles.includes("external-source") ? "source-prose-plus-external-source" : "source-prose";
    if (node.id.includes("ADVANCED_RELEASE")) role = "author-experience-and-conditional-safety";
    nodes[node.id] = { sourceRefs: refs, role, certainty: node.authority === "author-framework" ? "author-framework" : "operational", authority: node.authority };
  }
  return {
    contractVersion: "guide-provenance-v1",
    sourceFamilies: externalSources.length ? [
      ...sourceMaps.map((map) => ({
        id: `${map.guideId}-canonical-source-html`,
        expectedSha256: map.sourceSha256,
        availableInWorker: true,
        packetPath: map.sourcePath,
        role: "canonical-source-prose"
      })),
      ...externalSources.map((source) => ({
        id: "vagal-blitz-source-pdf",
        expectedSha256: source.sourceSha256,
        availableInWorker: true,
        packetPath: source.sourcePath,
        excerptPath: source.excerptPath,
        role: "author-provided-external-source"
      }))
    ] : [
      { id: "somatic-guide-r01-candidate-package", expectedSha256: "f2c6d822d230a71fd3cd478b84afea4f44c4e291b38914a6709b5dbd58b2dc74", availableInWorker: false },
      { id: "inner-child-guide-r01-candidate-package", expectedSha256: "73e2bb6ae0c8f88737f0d78b4f032c8bb7e7c471cba9f075f6e6a948e54acb82", availableInWorker: false }
    ],
    sourceRefs: sourceRefIndex,
    nodes
  };
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

function buildRegressionCases({ includeAdvancedReleaseBlock = false } = {}) {
  const cases = [
    {
      contractVersion: "guide-decision-case-v1",
      id: "A001",
      type: "planner",
      title: "Love feels unsafe and adult credibility is disputed",
      affectedNodeIds: ["IC.CREDIBILITY_REPAIR", "IC.AGE_RESPONSIBILITY_CLARIFICATION", "IC.BORROW_ONE_FUNCTION", "IC.DEEP_CHILD_DIALOGUE"],
      variables: {
        present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes",
        activation: "moderate", dissociation: "none", altered_state: "sober", inner_adult_access: "partial",
        parent_imagery: "not_used", love_access: "accessible", self_directed_love: "unsafe",
        solar_plexus_tension: "absent", protective_response: "present", urge_to_escape: "absent",
        credibility_conflict: "present", age_agency_ambiguity: "present", resentment_toward_younger_self: "present",
        coherent_child_state: "present", identity_blur: "absent", belonging_pressure: "absent", self_criticism: "present",
        current_intent: "conversation", memory_source_risk: "absent", forgiveness_interest: "absent",
        support_available: "present", body_capacity: "adequate", target_type: "developmental", trigger_loop: "absent",
        freeze_pattern: "absent", discharge_used: "no", emdr_interest: "absent", advanced_release_interest: "absent",
        advanced_release_physical_risk: "unknown", panic_instability: "absent", bypass_risk: "absent",
        guide_readiness: "absent", deep_work_readiness: "unknown", basic_reparenting_capacity: "unknown",
        stable_for_advanced_release: "unknown", witness_capacity: "present", credibility_evidence_state: "adverse",
        internal_speaker_relation: "unresolved"
      },
      unknowns: [],
      expectations: {
        primaryJobId: "IC.CREDIBILITY_REPAIR",
        selectedNodeIds: ["IC.BORROW_ONE_FUNCTION", "IC.AGE_RESPONSIBILITY_CLARIFICATION"],
        excludedNodeIds: ["IC.NEUTRAL_WITNESS"],
        deferredNodeIds: [],
        nextQuestionIncludes: ["Which age or version of you", "opportunity", "knowledge, support, safety, money, and freedom"],
        requiredNuanceIncludes: ["adverse track record", "Chronological adulthood does not establish", "already demonstrates witness capacity"],
        forbiddenOverclaimIncludes: ["no track record yet", "Do not merge the resentful voice"]
      }
    },
    {
      contractVersion: "guide-decision-case-v1",
      id: "G-SOM-DELAYED",
      type: "graph-structure",
      title: "Calm session followed by delayed destabilization",
      affectedNodeIds: ["SOM.DELAYED_RESPONSE_REASSESSMENT", "SOM.GENTLE_SHAKING", "SOM.DEEP_BRAINSPOTTING", "SOM.EMDR_DISCRETE", "SOM.EMDR_DEVELOPMENTAL", "SOM.ADVANCED_RELEASE_OPTIONAL"],
      expectations: {
        nodeId: "SOM.DELAYED_RESPONSE_REASSESSMENT",
        recommendationIncludes: ["next morning", "following two or three days", "repeat, reduce, stop, or intensify"],
        defaultQuestionIncludes: ["next two or three days"],
        inboundEdgesFrom: ["SOM.GENTLE_SHAKING", "SOM.DEEP_BRAINSPOTTING", "SOM.EMDR_DISCRETE", "SOM.EMDR_DEVELOPMENTAL", "SOM.ADVANCED_RELEASE_OPTIONAL"]
      }
    },
    {
      contractVersion: "guide-decision-case-v1",
      id: "G-EMDR-DISCRETE",
      type: "graph-structure",
      title: "Stable discrete target may use EMDR earlier",
      affectedNodeIds: ["SOM.EMDR_DISCRETE", "SOM.EMDR_DEVELOPMENTAL", "SOM.EMDR_DEVELOPMENTAL_DEFER"],
      expectations: {
        nodeId: "SOM.EMDR_DISCRETE",
        activationIncludes: [
          { group: "all", field: "target_type", op: "eq", value: "discrete" },
          { group: "all", field: "deep_work_readiness", op: "eq", value: "yes" }
        ],
        recommendationIncludes: ["clear event or residual trigger"],
        relatedNodeIds: ["SOM.EMDR_DEVELOPMENTAL", "SOM.EMDR_DEVELOPMENTAL_DEFER"],
        relatedForbiddenOverclaimIncludes: ["Do not say everyone must finish inner-child therapy before EMDR"]
      }
    },
    {
      contractVersion: "guide-decision-case-v1",
      id: "H001",
      type: "hypnosis-contract",
      title: "Hypnosis consent, route isolation, and waking return remain app-owned",
      affectedNodeIds: ["IC.BORROW_ONE_FUNCTION", "IC.DEEP_CHILD_DIALOGUE"],
      expectations: {
        ownerAmendmentId: "OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL",
        routeIds: ["continue_inward", "stay_external", "end_session"],
        gateIncludes: ["Playback pauses here", "clear enough yes", "never count as a selection"],
        wakingReturnIncludes: ["fully awake", "clear", "present", "session is complete"]
      }
    }
  ];
  if (includeAdvancedReleaseBlock) {
    cases.splice(3, 0, {
      contractVersion: "guide-decision-case-v1",
      id: "G-SOM-ADVANCED-BLOCK",
      type: "graph-safety-block",
      title: "Physical or regulatory instability graph-blocks optional advanced release",
      affectedNodeIds: ["SOM.ADVANCED_RELEASE_BLOCK", "SOM.ADVANCED_RELEASE_OPTIONAL"],
      variables: {
        advanced_release_interest: "present",
        advanced_release_physical_risk: "present",
        panic_instability: "absent",
        present_safety: "safe",
        orientation: "oriented",
        ability_to_stop: "yes",
        ability_to_return: "yes",
        altered_state: "sober"
      },
      expectations: {
        blockingNodeId: "SOM.ADVANCED_RELEASE_BLOCK",
        blockedNodeIds: ["SOM.ADVANCED_RELEASE_OPTIONAL"]
      }
    });
  }
  return cases;
}

function shaLines(entries) {
  return [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => `${sha256(data)}  ${name}`).join("\n") + "\n";
}

async function writeTree(root, entries) {
  await fs.rm(root, { recursive: true, force: true });
  for (const [name, data] of entries) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
}

export async function buildGuidePacket({
  runtimeRoot,
  somaticHtmlPath,
  innerChildHtmlPath,
  vagalSourcePath = path.join(runtimeRoot, "guides/vagal-blitz-source.pdf"),
  vagalSafetyTextPath = path.join(runtimeRoot, "guide-packets/source-input/vagal-blitz-safety-p5.txt"),
  outputDir,
  packetVersion = "2026.08.11-r01-candidate",
  packetRevision = 1,
  status = "candidate",
  createdAt = "2026-08-11T19:30:00.000Z"
}) {
  const packetId = safePacketId(`inner-signal-guides-${packetVersion}`);
  const attachExternalEvidence = packetRevision >= 2;
  const [somaticHtml, innerHtml] = await Promise.all([
    fs.readFile(somaticHtmlPath, "utf8"),
    fs.readFile(innerChildHtmlPath, "utf8")
  ]);
  const [vagalSource, vagalSafetyText] = attachExternalEvidence
    ? await Promise.all([fs.readFile(vagalSourcePath), fs.readFile(vagalSafetyTextPath, "utf8")])
    : [null, null];
  if (attachExternalEvidence && (!/MANDATORY POSITIONING: Lying Down Only/i.test(vagalSafetyText)
      || !/High Anxiety, Panic Disorder, or CPTSD/i.test(vagalSafetyText))) {
    throw new Error("Vagal Blitz page-5 safety extract is incomplete or not the expected source passage.");
  }
  const somaticBody = extractEditorBody(somaticHtml);
  const innerBody = extractEditorBody(innerHtml);
  const somaticSectionsRaw = extractHtmlSections(somaticHtml, { guideId: "somatic", aliases: SOMATIC_SECTION_ALIASES });
  const innerSectionsRaw = extractHtmlSections(innerHtml, { guideId: "inner-child", aliases: INNER_CHILD_SECTION_ALIASES });
  const somaticSections = somaticSectionsRaw.map(({ rawHtml, ...item }) => ({ ...item, guideId: "somatic" }));
  const innerSections = innerSectionsRaw.map(({ rawHtml, ...item }) => ({ ...item, guideId: "inner-child" }));
  const sourceMaps = [
    buildSourceMap({ guideId: "inner-child", revision: "r01-candidate", sourcePath: "guides/inner-child/canonical-source.html", html: innerHtml, aliases: INNER_CHILD_SECTION_ALIASES }),
    buildSourceMap({ guideId: "somatic", revision: "r01-candidate", sourcePath: "guides/somatic/canonical-source.html", html: somaticHtml, aliases: SOMATIC_SECTION_ALIASES })
  ];
  const [innerGraph, somaticGraph, crossGraph, installedBundle] = await Promise.all([
    readJson(path.join(runtimeRoot, "guide-graphs/candidates/inner-child.graph.json")),
    readJson(path.join(runtimeRoot, "guide-graphs/candidates/somatic.graph.json")),
    readJson(path.join(runtimeRoot, "guide-graphs/candidates/cross-guide.graph.json")),
    readJson(path.join(runtimeRoot, "guide-graphs/compiled/bundle.json"))
  ]);
  const graphVersion = `inner-child-somatic-packet-${packetVersion}`;
  const graphs = buildCandidateGraphs({
    innerGraph,
    somaticGraph,
    crossGraph,
    sourceHashes: { innerChild: innerBody.sourceSha256, somatic: somaticBody.sourceSha256 },
    graphVersion,
    graphOwnsAdvancedReleaseBlock: attachExternalEvidence
  });
  const graphBundle = {
    contractVersion: "guide-graph-v1",
    version: graphVersion,
    sourceManifestVersion: packetVersion,
    compiledAt: createdAt,
    sourceMaps,
    graphs,
    stats: { graphCount: graphs.length, nodeCount: graphs.reduce((sum, graph) => sum + (graph.nodes?.length ?? 0), 0), edgeCount: graphs.reduce((sum, graph) => sum + (graph.edges?.length ?? 0), 0), sourceSectionCount: sourceMaps.reduce((sum, map) => sum + map.sections.length, 0), ownerAmendmentCount: 2 }
  };
  const externalSources = attachExternalEvidence ? [{
    id: "VAGAL.SAFETY.P5",
    title: "Vagal Blitz critical safety protocols",
    role: "author-provided-external-source-safety-caution",
    sourcePath: "sources/vagal-blitz-source.pdf",
    excerptPath: "sources/vagal-blitz-safety-p5.txt",
    sourceSha256: sha256(vagalSource),
    excerptSha256: sha256(vagalSafetyText),
    page: 5,
    availableInWorker: true,
    independentlyValidated: false,
    caveat: "This is attached author-provided source evidence. Packet verification proves identity and provenance, not empirical accuracy."
  }] : [];
  const ownerAmendments = buildOwnerAmendments(packetVersion);
  const provenance = buildProvenance(graphs, sourceMaps, ownerAmendments, externalSources);
  const regressionCases = buildRegressionCases({ includeAdvancedReleaseBlock: attachExternalEvidence });
  const sectionsByGuide = { "inner-child": innerSections, somatic: somaticSections };
  const qualityAudit = runGuideQualityAudit({ manifest: { createdAt }, sectionsByGuide, graphs, provenance, ownerAmendments });
  const behavioralDiff = buildBehavioralDiff(installedBundle, graphBundle, { regressionCases });
  const decisionCards = buildDecisionCards(behavioralDiff, provenance);
  const ownerDecisions = { contractVersion: "guide-owner-decisions-v1", status: "awaiting-owner", cards: decisionCards, allApproved: false };

  const graphData = {
    "graphs/inner-child.graph.json": canonicalJson(graphs.find((graph) => graph.graphId === "inner-child-directed-graph")),
    "graphs/somatic.graph.json": canonicalJson(graphs.find((graph) => graph.graphId === "somatic-directed-graph")),
    "graphs/cross-guide-edges.json": canonicalJson(graphs.find((graph) => graph.graphId === "inner-child-somatic-cross-guide")),
    "graphs/bundle.json": canonicalJson(graphBundle)
  };
  const manifest = {
    format: GUIDE_PACKET_FORMAT,
    schemaVersion: GUIDE_PACKET_SCHEMA_VERSION,
    packetId,
    packetVersion,
    packetRevision,
    status,
    createdAt,
    minimumRuntimeVersion: "0.14.0",
    graphContractVersion: "guide-graph-v1",
    graphBundleVersion: graphVersion,
    candidateOnly: status !== "approved",
    guides: [
      { id: "inner-child", revision: "r01-candidate", sourcePath: "guides/inner-child/canonical-source.html", editorBodyPath: "guides/inner-child/editor-body.txt", sourceMapPath: "guides/inner-child/source-map.json", sectionsPath: "guides/inner-child/sections.json", graphPath: "graphs/inner-child.graph.json", sourceSha256: innerBody.sourceSha256, editorBodySha256: innerBody.sha256, graphSourceSha256: innerBody.sourceSha256, graphSha256: sha256(graphData["graphs/inner-child.graph.json"]) },
      { id: "somatic", revision: "r01-candidate", sourcePath: "guides/somatic/canonical-source.html", editorBodyPath: "guides/somatic/editor-body.txt", sourceMapPath: "guides/somatic/source-map.json", sectionsPath: "guides/somatic/sections.json", graphPath: "graphs/somatic.graph.json", sourceSha256: somaticBody.sourceSha256, editorBodySha256: somaticBody.sha256, graphSourceSha256: somaticBody.sourceSha256, graphSha256: sha256(graphData["graphs/somatic.graph.json"]) }
    ],
    paths: { provenance: "policy/provenance.json", certainty: "policy/certainty-and-authority.json", ownerAmendments: "policy/owner-amendments.json", behavioralDiff: "audit/behavioral-diff.json", qualityAudit: "audit/guide-quality-findings.json", ownerDecisions: "audit/owner-decisions.json" },
    sourceFamilyPackages: provenance.sourceFamilies,
    ...(externalSources.length ? { externalSources } : {}),
    privateDataIncluded: false,
    approvalRequired: true
  };

  const entries = new Map(Object.entries({
    "manifest.json": canonicalJson(manifest),
    "guides/inner-child/canonical-source.html": innerHtml,
    "guides/inner-child/editor-body.txt": innerBody.body,
    "guides/inner-child/source-map.json": canonicalJson(sourceMaps[0]),
    "guides/inner-child/sections.json": canonicalJson(innerSections),
    "guides/somatic/canonical-source.html": somaticHtml,
    "guides/somatic/editor-body.txt": somaticBody.body,
    "guides/somatic/source-map.json": canonicalJson(sourceMaps[1]),
    "guides/somatic/sections.json": canonicalJson(somaticSections),
    ...(externalSources.length ? {
      "sources/vagal-blitz-source.pdf": vagalSource,
      "sources/vagal-blitz-safety-p5.txt": vagalSafetyText
    } : {}),
    ...graphData,
    "policy/owner-amendments.json": canonicalJson(ownerAmendments),
    "policy/provenance.json": canonicalJson(provenance),
    "policy/certainty-and-authority.json": canonicalJson(certaintyPolicy()),
    "tests/decision-cases/A001.json": canonicalJson(regressionCases[0]),
    "tests/decision-cases/G-SOM-DELAYED.json": canonicalJson(regressionCases[1]),
    "tests/decision-cases/G-EMDR-DISCRETE.json": canonicalJson(regressionCases[2]),
    ...(attachExternalEvidence ? {
      "tests/decision-cases/G-SOM-ADVANCED-BLOCK.json": canonicalJson(regressionCases[3]),
      "tests/decision-cases/H001.json": canonicalJson(regressionCases[4])
    } : {
      "tests/decision-cases/H001.json": canonicalJson(regressionCases[3])
    }),
    "audit/behavioral-diff.json": canonicalJson(behavioralDiff),
    "audit/guide-quality-findings.json": canonicalJson(qualityAudit),
    "audit/owner-decisions.json": canonicalJson(ownerDecisions),
    "README.md": externalSources.length
      ? `# Inner Signal Guide Packet ${packetVersion}\n\nStatus: candidate; not installed and not approved.\n\nThis packet preserves complete canonical source HTML, exact editor bodies, source maps, executable graphs, cross-guide edges, attached Vagal Blitz page-5 safety evidence, provenance, certainty, regression cases, a behavioral diff, a reverse guide-quality audit, and pending owner decisions. Source hashes prove identity and provenance, not factual accuracy.\n`
      : `# Inner Signal Guide Packet ${packetVersion}\n\nStatus: candidate; not installed and not approved.\n\nThis packet preserves canonical source HTML, exact editor bodies, source maps, executable graphs, cross-guide edges, provenance, certainty, regression cases, a behavioral diff, a reverse guide-quality audit, and pending owner decisions. The two original article-family package ZIPs named in the worker handoff were not present in this worker upload; their expected hashes remain recorded as provenance limitations.\n`
  }).map(([name, value]) => [name, Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8")]));
  entries.set("SHA256SUMS.txt", Buffer.from(shaLines(entries), "utf8"));
  const buffer = createStoredZip([...entries.entries()].map(([name, data]) => ({ name, data })), new Date(createdAt));
  await fs.mkdir(outputDir, { recursive: true });
  const treeRoot = path.join(outputDir, "packet");
  await writeTree(treeRoot, entries);
  const candidateTag = /(?:^|-)r\d+-candidate$/i.test(packetVersion)
    ? packetVersion.match(/r\d+-candidate$/i)[0]
    : "candidate";
  const zipPath = path.join(outputDir, `inner-signal-guide-packet-${candidateTag}.zip`);
  await fs.writeFile(zipPath, buffer);
  await fs.writeFile(`${zipPath}.sha256`, `${sha256(buffer)}  ${path.basename(zipPath)}\n`);
  return { buffer, zipPath, manifest, graphBundle, behavioralDiff, decisionCards, qualityAudit };
}
