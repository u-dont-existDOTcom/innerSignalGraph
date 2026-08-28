import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createStoredZip, readZipEntries } from "../src/core/zip.mjs";
import * as therapyGovernance from "../scripts/verify-therapy-lessons.mjs";

const { loadPolicyDecisionPackages, loadTherapyGovernance, verifyTherapyGovernance, verifyTherapyLessons } = therapyGovernance;

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packetId = "fixture-guides-r02-candidate";
const createdAt = "2026-08-12T02:45:00.000Z";
let packetArchive;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  const canonicalize = (item) => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonicalize(item[key])]));
    }
    return item;
  };
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function cardDigest(card) {
  return sha256(canonicalJson(card));
}

let packetDigest;
const decisionCardDetails = {
  "decision-1": {
    title: "Add route: Reassess the dose immediately, next morning, and over two or three days",
    behavioralEffect: "Presentations matching this node can receive a distinct route rather than being folded into a neighboring intervention.",
    provenance: "source-prose",
    current: "No equivalent executable node is installed.",
    candidate: "SOM.DELAYED_RESPONSE_REASSESSMENT becomes available in somatic-directed-graph.",
    worstPlausibleFailure: "The new route could activate too broadly and add an unnecessary follow-up or delay a better-established intervention."
  },
  "decision-2": {
    title: "Change discriminating question: Separate developmental ages and responsibility",
    behavioralEffect: "The candidate asks a different question before resolving the route, which can change the interpretation and next intervention.",
    provenance: "source-prose",
    current: "Which age or version of you is the resentment actually directed toward, and what opportunity do you believe that version failed to use?",
    candidate: "Which age or version of you is the resentment actually directed toward, what opportunity do you believe that version failed to use, and what knowledge, support, safety, money, and freedom were actually available then?",
    worstPlausibleFailure: "The app may ask a more detailed question when the user would have benefited from immediate action."
  },
  "decision-3": {
    title: "Reprioritize route: Borrow one bounded adult function",
    behavioralEffect: "When several jobs match, this route may now appear earlier or later in the intervention plan.",
    provenance: "source-prose",
    current: "Priority 94",
    candidate: "Priority 95",
    worstPlausibleFailure: "The reprioritized route could crowd out another useful job in ambiguous cases."
  },
  "decision-4": {
    title: "Change prerequisite or deferral: Repair credibility through non-defensive follow-through",
    behavioralEffect: "A deeper or downstream route may now wait, remain available, or be blocked under different conditions.",
    provenance: "source-prose",
    current: '{"deferNodes":[],"blockNodes":[]}',
    candidate: '{"deferNodes":["IC.DEEP_CHILD_DIALOGUE"],"blockNodes":[]}',
    worstPlausibleFailure: "The app could postpone useful work or allow depth before sufficient capacity if the dependency is wrong."
  },
  "decision-5": {
    title: "Change prerequisite or deferral: Block advanced release when physical or regulatory safety is not established",
    behavioralEffect: "A deeper or downstream route may now wait, remain available, or be blocked under different conditions.",
    provenance: "author-experience-and-conditional-safety",
    current: '{"deferNodes":[],"blockNodes":[]}',
    candidate: '{"deferNodes":[],"blockNodes":["SOM.ADVANCED_RELEASE_OPTIONAL"]}',
    worstPlausibleFailure: "The app could postpone useful work or allow depth before sufficient capacity if the dependency is wrong."
  }
};

const decisions = Array.from({ length: 5 }, (_, index) => {
  const id = `decision-${index + 1}`;
  const affectedRegressions = {
    "decision-1": ["G-SOM-DELAYED"],
    "decision-2": ["A001"],
    "decision-3": ["A001", "H001"],
    "decision-4": ["A001"],
    "decision-5": ["G-SOM-DELAYED", "G-SOM-ADVANCED-BLOCK"]
  }[id];
  return {
    id,
    classification: "substantive",
    requiresHumanDecision: true,
    status: "pending",
    affectedRegressions,
    ...decisionCardDetails[id]
  };
});

function marker(kind, entry) {
  return `<!-- ${kind} ${JSON.stringify(entry)} -->`;
}

function mutateMarker(source, kind, idField, id, transform) {
  const pattern = new RegExp(`<!-- ${kind} (\\{[^\\r\\n]*\\}) -->`, "g");
  let found = false;
  const result = source.replace(pattern, (whole, raw) => {
    const metadata = JSON.parse(raw);
    if (metadata[idField] !== id) return whole;
    found = true;
    return marker(kind, transform(metadata));
  });
  assert.equal(found, true, `Expected ${kind} ${id} in fixture source.`);
  return result;
}

async function rewriteReviewDiagnostic({ rootDir, relativePath, eventId, transform, eventTransform = (metadata) => metadata }) {
  const diagnosticPath = path.join(rootDir, relativePath);
  const diagnostic = JSON.parse(await fs.readFile(diagnosticPath, "utf8"));
  const transformed = transform(diagnostic) ?? diagnostic;
  const diagnosticSource = `${JSON.stringify(transformed, null, 2)}\n`;
  await fs.writeFile(diagnosticPath, diagnosticSource);
  const historyPath = path.join(rootDir, "THERAPY-LESSONS");
  await fs.writeFile(historyPath, mutateMarker(
    await fs.readFile(historyPath, "utf8"),
    "therapy-review-event", "eventId", eventId,
    (metadata) => eventTransform({ ...metadata, reviewArtifactSha256: sha256(diagnosticSource) })
  ));
}

const regressionsByDecision = {
  "decision-1": ["G-SOM-DELAYED"],
  "decision-2": ["A001"],
  "decision-3": ["A001", "H001"],
  "decision-4": ["A001"],
  "decision-5": ["G-SOM-DELAYED", "G-SOM-ADVANCED-BLOCK"]
};

const affectedByDecision = {
  "decision-1": {
    guideIds: ["somatic"],
    graphNodeIds: ["SOM.DELAYED_RESPONSE_REASSESSMENT"],
    promptContractIds: [],
    policySafetyGateIds: [],
    regressionIds: ["G-SOM-DELAYED"]
  },
  "decision-2": {
    guideIds: ["inner-child"],
    graphNodeIds: ["IC.AGE_RESPONSIBILITY_CLARIFICATION"],
    promptContractIds: ["response-realization-v5"],
    policySafetyGateIds: [],
    regressionIds: ["A001"]
  },
  "decision-3": {
    guideIds: ["inner-child"],
    graphNodeIds: ["IC.BORROW_ONE_FUNCTION", "IC.NEUTRAL_WITNESS"],
    promptContractIds: ["response-realization-v5"],
    policySafetyGateIds: ["OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL"],
    regressionIds: ["A001", "H001"]
  },
  "decision-4": {
    guideIds: ["inner-child"],
    graphNodeIds: ["IC.CREDIBILITY_REPAIR", "IC.DEEP_CHILD_DIALOGUE"],
    promptContractIds: ["response-realization-v5"],
    policySafetyGateIds: [],
    regressionIds: ["A001"]
  },
  "decision-5": {
    guideIds: ["somatic"],
    graphNodeIds: ["SOM.ADVANCED_RELEASE_BLOCK", "SOM.ADVANCED_RELEASE_OPTIONAL"],
    promptContractIds: ["response-realization-v5"],
    policySafetyGateIds: ["VAGAL.SAFETY.P5"],
    regressionIds: ["G-SOM-DELAYED", "G-SOM-ADVANCED-BLOCK"]
  }
};

const reviewFindingsByDecision = {
  "decision-1": [],
  "decision-2": ["SRC-CITE-001"],
  "decision-3": ["PRIORITY-TIE-001"],
  "decision-4": ["REG-EVIDENCE-001"],
  "decision-5": ["SAFETY-ENCODE-001", "EXT-VALID-001"]
};

const packetLevelFindingIds = [
  "CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001"
];

const ownerProtocolRules = [
  "read-all-four-ledgers",
  "separate-deterministic-repairs-from-owner-choice",
  "ask-joel-directly-in-active-conversation",
  "one-substantive-decision-unless-joel-requests-bundling",
  "state-exact-decision-and-why-now",
  "classify-evidence-type-and-limitations",
  "present-viable-options-benefits-costs-worst-failure",
  "keep-recommendation-and-detailed-reasoning-distinct",
  "enumerate-guide-graph-prompt-safety-regression-effects",
  "no-answer-leaves-policy-unchanged",
  "record-explicit-answer-only-never-infer",
  "commit-git-transition-and-tests-before-durable-guidance",
  "never-store-private-therapy-transcript"
];

const ownerProtocolProse = `## Required therapy-governance context

Read all four ledgers before therapy governance work.

## Direct owner-decision protocol

Separate deterministic repairs from owner choice. Ask Joel directly in the active conversation, one substantive decision at a time unless Joel requests bundling. State the exact decision and why it is needed now. Classify evidence and limitations. Present viable options with benefits, costs, and worst plausible failure. Keep the recommendation and detailed reasoning distinct from Joel's decision. Enumerate effects on guides, graph nodes, prompt contracts, policy or safety gates, and regressions. No answer leaves policy unchanged. Record explicit answers only and never infer them. Commit the Git transition with passing tests before durable guidance.

## Privacy boundary

Never store a private therapy transcript.
`;

function ownerProtocol(overrides = {}) {
  return marker("therapy-owner-decision-protocol", {
    schemaVersion: 2,
    rules: ownerProtocolRules,
    ...overrides
  });
}

function emptyAffected(overrides = {}) {
  return {
    guideIds: [],
    graphNodeIds: [],
    promptContractIds: [],
    policySafetyGateIds: [],
    regressionIds: [],
    ...overrides
  };
}

function diagnosticFinding({ id, severity, disposition, summary = `${id} summary.`, requiredAction = `${id} action.` }) {
  return {
    id,
    severity,
    summary,
    requiredAction,
    disposition: {
      status: disposition,
      evidence: disposition === "resolved" || disposition === "verified" ? `${id} has review evidence.` : `${id} remains open.`
    }
  };
}

function reviewDiagnostic({
  reviewedPacketId = packetId,
  reviewedPacketDigest = packetDigest,
  eventId = "review-r02-live-rejection-20260813",
  outcome = "rejected-before-owner-gate",
  resolveBlockingFindings = false,
  findingsTransform = (findings) => findings,
  manifestSha256 = "0".repeat(64),
  decisionCardsSha256 = "0".repeat(64),
  nextPhase = outcome === "passed-owner-gate" ? "owner-decisions" : "repair-r03"
} = {}) {
  const disposition = resolveBlockingFindings ? "resolved" : "unresolved";
  const findings = [
    diagnosticFinding({ id: "SRC-CITE-001", severity: "review", disposition }),
    diagnosticFinding({ id: "PRIORITY-TIE-001", severity: "review", disposition }),
    diagnosticFinding({ id: "REG-EVIDENCE-001", severity: "review", disposition }),
    diagnosticFinding({ id: "SAFETY-ENCODE-001", severity: "blocking", disposition }),
    diagnosticFinding({ id: "EXT-VALID-001", severity: "review", disposition }),
    diagnosticFinding({ id: "CROSS-GUIDE-001", severity: "review", disposition }),
    diagnosticFinding({ id: "OWNER-POLICY-001", severity: "review", disposition }),
    diagnosticFinding({ id: "COVERAGE-001", severity: "informational", disposition: "deferred" }),
    diagnosticFinding({ id: "CERTAINTY-LAYER-001", severity: "positive", disposition: "verified" })
  ];
  const findingAffectedIds = {
    "SRC-CITE-001": affectedByDecision["decision-2"],
    "PRIORITY-TIE-001": affectedByDecision["decision-3"],
    "REG-EVIDENCE-001": affectedByDecision["decision-4"],
    "SAFETY-ENCODE-001": affectedByDecision["decision-5"],
    "EXT-VALID-001": affectedByDecision["decision-5"],
    "CROSS-GUIDE-001": emptyAffected({ guideIds: ["inner-child", "somatic"] }),
    "OWNER-POLICY-001": emptyAffected({ policySafetyGateIds: ["OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL"], regressionIds: ["H001"] }),
    "COVERAGE-001": emptyAffected({ guideIds: ["inner-child"], regressionIds: ["A001", "H001"] }),
    "CERTAINTY-LAYER-001": emptyAffected({ guideIds: ["inner-child", "somatic"] })
  };
  return {
    contractVersion: "therapy-review-diagnostic-v1",
    artifactId: `diagnostic-${eventId}`,
    reviewEventId: eventId,
    occurredAt: "2026-08-13T14:31:28.000Z",
    packet: {
      packetId: reviewedPacketId,
      packetRevision: reviewedPacketId.includes("r03") ? 3 : 2,
      packetSha256: reviewedPacketDigest,
      manifestSha256,
      decisionCardsPath: "audit/owner-decisions.json",
      decisionCardsSha256
    },
    outcome,
    nextPhase,
    migrationNote: "Severity and disposition were conservatively reconstructed from the retained live-review record.",
    findings: findingsTransform(findings),
    mappings: {
      suggestionFindings: reviewFindingsByDecision,
      packetLevelFindingIds,
      allowMultipleAssignmentsByFinding: {}
    },
    decisionAffectedIds: affectedByDecision,
    findingAffectedIds
  };
}

function reviewBlock(overrides = {}, {
  reviewArtifactPath = "docs/diagnostics/fixture-r02-review.json",
  reviewArtifactSha256 = "0".repeat(64)
} = {}) {
  const event = {
    eventId: "review-r02-live-rejection-20260813",
    occurredAt: "2026-08-13T14:31:28.000Z",
    packetId,
    outcome: "rejected-before-owner-gate",
    findingIds: [
      "SAFETY-ENCODE-001", "EXT-VALID-001", "SRC-CITE-001",
      "CROSS-GUIDE-001", "REG-EVIDENCE-001", "PRIORITY-TIE-001",
      "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001"
    ],
    suggestionFindings: reviewFindingsByDecision,
    packetLevelFindingIds,
    reviewArtifactPath,
    reviewArtifactSha256,
    nextPhase: "repair-r03",
    ...overrides
  };
  const passed = event.outcome === "passed-owner-gate";
  return `## ${passed ? "packet review passed the owner gate" : "r02 live review was rejected before owner approval"}\n\n${marker("therapy-review-event", event)}\n\n### Review outcome\n\nOutcome: ${event.outcome}\n\n${passed ? "Independent review passed the owner gate." : "The candidate packet was rejected."}\n\n### Finding dispositions\n\n${passed ? "All blocking and review findings have explicit resolved dispositions." : "Blocking and review findings remain unresolved in the bound diagnostic artifact."}\n\n### What this does not mean\n\n${passed ? "A passing technical review is not an owner choice." : "The five suggestions were not all judged false."}\n\n### Finding-to-suggestion mapping\n\nEvery lesson-specific finding is mapped below.\n\n### Packet-level findings\n\n${passed ? "All blocking and review remediation has a resolved disposition." : "Cross-guide and owner-policy remediation remains."}\n\n### Next phase\n\n${passed ? "Ask Joel directly, one decision at a time." : "Repair r03, review it, and only then ask Joel directly."}\n`;
}

function suggestionBlock(decision, overrides = {}, {
  suggestionPacketId = packetId,
  suggestionPacketDigest = packetDigest,
  suggestionPrefix = "suggestion-r02",
  reviewFindings = reviewFindingsByDecision
} = {}) {
  const affected = affectedByDecision[decision.id];
  const metadata = {
    suggestionId: `${suggestionPrefix}-${decision.id}`,
    createdAt: "2026-08-13T14:31:28.000Z",
    packetId: suggestionPacketId,
    packetDigest: suggestionPacketDigest,
    decisionId: decision.id,
    decisionCardDigest: cardDigest(decision),
    status: "blocked-by-packet-review",
    reviewFindingIds: reviewFindings[decision.id],
    ownerDecisionRequired: true,
    ...affected,
    ...overrides
  };
  return `## ${decision.id}\n\n${marker("therapy-suggestion", metadata)}\n\n### Proposal\n\nKeep this exact candidate change pending.\n\nDecision-card title: ${decision.title}\nBehavioral effect: ${decision.behavioralEffect}\nProvenance: ${decision.provenance}\nCurrent behavior: ${decision.current}\nCandidate behavior: ${decision.candidate}\n\n### Guide impact\n\nGuide: inner-child. Graph node: NODE.${decision.id}. Prompt: none. Regression: ${decision.affectedRegressions.join(", ")}.\n\n### Evidence and uncertainty\n\nSource status: canonical packet evidence.\nLimitation: the packet has not passed review.\n\n### Review result\n\nThe enclosing r02 packet was rejected before the owner gate.\n\n### Why not active\n\nIt has neither a passing packet nor an explicit owner decision.\n\n### Technical next action\n\nCarry the corrected proposal into r03 and rerun its regression.\n\n### Decision needed\n\nAfter r03 passes review, Joel must explicitly approve or decline this proposal.\n\n### Options and trade-offs\n\nOption A — approve after repair.\nBenefits: gains the proposed behavior.\nCosts: changes routing.\nWorst plausible failure: ${decision.worstPlausibleFailure}\n\nOption B — retain current policy.\nBenefits: avoids an unverified change.\nCosts: forgoes the candidate behavior.\nWorst plausible failure: a useful route remains unavailable.\n\n### Recommendation and reasoning\n\nRecommendation: wait for r03.\nReasoning: technical review must pass before an owner policy choice is actionable.\n`;
}

function approvalBlock(overrides = {}) {
  const affected = affectedByDecision["decision-1"];
  const metadata = {
    approvalId: "approval-r02-decision-1",
    suggestionId: "suggestion-r02-decision-1",
    decisionReceiptId: "decision-r02-decision-1",
    decidedAt: "2026-08-13T15:00:00.000Z",
    implementationStatus: "approved-not-implemented",
    ...affected,
    ...overrides
  };
  return `## Approve delayed reassessment\n\n${marker("therapy-approval", metadata)}\n\n### Exact decision\n\nApprove the bounded policy represented by the linked suggestion.\n\n### Owner reasoning or stated preference\n\nThe owner explicitly selected the proposed behavior.\n\n### Scope and constraints\n\nOnly the linked guide and reviewed regression scope.\n\n### Guide impact\n\nSomatic guide and delayed reassessment node.\n\n### Implementation status\n\nApproved but not implemented.\n\n### Verification evidence\n\nNo implementation evidence is claimed yet.\n`;
}

function decisionReceiptBlock(decision, overrides = {}) {
  const suggestionId = overrides.suggestionId ?? `suggestion-r02-${decision.id}`;
  const affected = affectedByDecision[decision.id];
  const metadata = {
    receiptId: `decision-r02-${decision.id}`,
    suggestionId,
    packetId,
    packetDigest,
    decisionId: decision.id,
    decisionCardDigest: cardDigest(decision),
    reviewEventId: "review-r02-live-rejection-20260813",
    reviewArtifactPath: "docs/diagnostics/fixture-r02-review.json",
    reviewArtifactSha256: "0".repeat(64),
    choice: "approve",
    decisionSource: "direct-user-conversation",
    decidedAt: "2026-08-13T15:00:00.000Z",
    ...affected,
    ...overrides
  };
  return `## Decision for ${decision.id}\n\n${marker("therapy-decision", metadata)}\n\n### Explicit owner choice\n\nJoel explicitly chose ${metadata.choice} in the active conversation.\n\n### Evidence binding\n\nThe receipt binds the exact packet, card, passed review, and complete affected scope.\n`;
}

function implementationEventBlock(overrides = {}) {
  const metadata = {
    eventId: "implementation-r03-decision-1",
    occurredAt: "2026-08-13T15:06:00.000Z",
    suggestionId: "suggestion-r03-decision-1",
    decisionReceiptId: "decision-r03-decision-1",
    approvalId: "approval-r03-decision-1",
    implementationCommit: "0".repeat(40),
    implementationPaths: ["src/therapy-change.txt"],
    regressionResults: [{ regressionId: "G-SOM-DELAYED", status: "PASS", evidence: "Focused regression passed." }],
    ...overrides
  };
  return `## Implement ${metadata.suggestionId}\n\n${marker("therapy-implementation-event", metadata)}\n\n### Implementation scope\n\nThe declared paths implement only the approved atomic suggestion.\n\n### Regression evidence\n\nEvery affected regression has a structured PASS result.\n`;
}

function validEntries() {
  return [
    { lessonId: "active-one", learnedAt: createdAt, activation: "active-runtime" },
    ...decisions.map((decision) => ({
      lessonId: `candidate-${decision.id}`,
      decisionId: decision.id,
      packetId,
      learnedAt: createdAt,
      activation: "candidate-awaiting-owner"
    }))
  ];
}

async function governanceFixture(t, {
  reviewOverrides = {},
  reviewDiagnosticOverrides = {},
  reviewFindingsTransform = (findings) => findings,
  resolveReviewFindings = false,
  reviewArtifactTransform = (source) => source,
  reviewBodyTransform = (source) => source,
  suggestionOverrides = {},
  suggestionOverridesByDecision = {},
  suggestions = null,
  suggestionsTransform = (source) => source,
  omitSuggestionDecisionId = null,
  duplicateSuggestionDecisionId = null,
  omitReviewEvent = false,
  duplicateReviewEvent = false,
  decisionsLedger = "# Therapy decisions\n",
  approvals = "# Approved therapy lessons\n",
  agents = `# Repository instructions\n\n${ownerProtocol()}\n\n${ownerProtocolProse}`,
  historyTransform = (source) => source,
  fixtureTransform = async () => {}
} = {}) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-therapy-governance-"));
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  const governanceDecisions = decisions.map((decision) => ({
    ...decision,
    affectedRegressions: regressionsByDecision[decision.id]
  }));
  const reviewEventId = reviewOverrides.eventId ?? "review-r02-live-rejection-20260813";
  const diagnostic = {
    ...reviewDiagnostic({
      eventId: reviewEventId,
      outcome: reviewOverrides.outcome ?? "rejected-before-owner-gate",
      resolveBlockingFindings: resolveReviewFindings,
      findingsTransform: reviewFindingsTransform
    }),
    ...reviewDiagnosticOverrides
  };
  const diagnosticPath = "docs/diagnostics/fixture-r02-review.json";
  const candidateRoot = path.join(fixtureRoot, "guide-packets", "fixtures", "r02-candidate");
  const packetRoot = path.join(candidateRoot, "packet");
  const manifest = {
    status: "candidate",
    packetRevision: 2,
    packetId,
    createdAt,
    guides: [
      { id: "inner-child", graphPath: "graphs/inner-child.graph.json" },
      { id: "somatic", graphPath: "graphs/somatic.graph.json" }
    ],
    externalSources: [{ id: "VAGAL.SAFETY.P5" }],
    paths: {
      ownerDecisions: "audit/owner-decisions.json",
      ownerAmendments: "policy/owner-amendments.json"
    }
  };
  const decisionsSource = `${JSON.stringify({ cards: governanceDecisions }, null, 2)}\n`;
  const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`;
  const innerChildGraphSource = `${JSON.stringify({ nodes: governanceDecisions.flatMap((decision) => affectedByDecision[decision.id].graphNodeIds.filter((id) => id.startsWith("IC.")).map((id) => ({ id }))) })}\n`;
  const somaticGraphSource = `${JSON.stringify({ nodes: governanceDecisions.flatMap((decision) => affectedByDecision[decision.id].graphNodeIds.filter((id) => id.startsWith("SOM.")).map((id) => ({ id }))) })}\n`;
  const ownerAmendmentsSource = `${JSON.stringify({ items: [{ id: "OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL" }] })}\n`;
  const regressionSources = Object.fromEntries(
    ["A001", "H001", "G-SOM-DELAYED", "G-SOM-ADVANCED-BLOCK"].map((id) => [`tests/decision-cases/${id}.json`, `${JSON.stringify({ id })}\n`])
  );
  packetArchive = createStoredZip([
    { name: "manifest.json", data: manifestSource },
    { name: "audit/owner-decisions.json", data: decisionsSource },
    { name: "graphs/inner-child.graph.json", data: innerChildGraphSource },
    { name: "graphs/somatic.graph.json", data: somaticGraphSource },
    { name: "policy/owner-amendments.json", data: ownerAmendmentsSource },
    ...Object.entries(regressionSources).map(([name, data]) => ({ name, data }))
  ], new Date(createdAt));
  packetDigest = sha256(packetArchive);
  const selectedSuggestions = governanceDecisions
    .filter((decision) => decision.id !== omitSuggestionDecisionId)
    .map((decision) => {
      const overrides = {
        ...(decision.id === "decision-1" ? suggestionOverrides : {}),
        ...(suggestionOverridesByDecision[decision.id] ?? {})
      };
      if (Array.isArray(overrides.reviewFindingIds)) {
        overrides.reviewFindingIds = [...reviewFindingsByDecision[decision.id], ...overrides.reviewFindingIds];
      }
      return suggestionBlock(decision, overrides);
    });
  if (duplicateSuggestionDecisionId) {
    const decision = governanceDecisions.find((item) => item.id === duplicateSuggestionDecisionId);
    selectedSuggestions.push(suggestionBlock(decision, {
      suggestionId: `suggestion-r02-${decision.id}-duplicate`,
      ...(suggestionOverridesByDecision[decision.id] ?? {})
    }));
  }
  const suggestionSource = suggestions ?? `# Suggested therapy lessons\n\n${selectedSuggestions.join("\n")}`;
  diagnostic.packet.packetSha256 = packetDigest;
  diagnostic.packet.manifestSha256 = sha256(manifestSource);
  diagnostic.packet.decisionCardsSha256 = sha256(decisionsSource);
  const finalizedDiagnosticSource = `${JSON.stringify(diagnostic, null, 2)}\n`;
  const finalizedReviewSource = omitReviewEvent ? "" : [
    reviewBodyTransform(reviewBlock(reviewOverrides, {
      reviewArtifactPath: diagnosticPath,
      reviewArtifactSha256: sha256(finalizedDiagnosticSource)
    })),
    duplicateReviewEvent ? reviewBlock({ eventId: "review-r02-live-rejection-duplicate" }, {
      reviewArtifactPath: diagnosticPath,
      reviewArtifactSha256: sha256(finalizedDiagnosticSource)
    }) : ""
  ].join("\n");
  await Promise.all([
    fs.mkdir(path.join(packetRoot, "audit"), { recursive: true }),
    fs.mkdir(path.join(packetRoot, "graphs"), { recursive: true }),
    fs.mkdir(path.join(packetRoot, "policy"), { recursive: true }),
    fs.mkdir(path.join(packetRoot, "tests", "decision-cases"), { recursive: true }),
    fs.mkdir(path.join(fixtureRoot, "docs", "diagnostics"), { recursive: true }),
    fs.mkdir(path.join(fixtureRoot, "src", "orchestrator"), { recursive: true }),
    fs.writeFile(path.join(fixtureRoot, "THERAPY-LESSONS"), historyTransform(`# Therapy lessons\n\n${validEntries().map((entry) => `## ${entry.lessonId}\n\n${marker("therapy-lesson", entry)}\n`).join("\n")}\n${finalizedReviewSource}`)),
    fs.writeFile(path.join(fixtureRoot, "SUGGESTED-THERAPY-LESSONS"), suggestionsTransform(suggestionSource)),
    fs.writeFile(path.join(fixtureRoot, "THERAPY-DECISIONS"), decisionsLedger),
    fs.writeFile(path.join(fixtureRoot, "APPROVED-THERAPY-LESSONS"), approvals),
    fs.writeFile(path.join(fixtureRoot, "AGENTS.md"), agents)
  ]);
  await Promise.all([
    fs.writeFile(path.join(candidateRoot, "fixture-guides-r02-candidate.zip"), packetArchive),
    fs.writeFile(path.join(fixtureRoot, diagnosticPath), reviewArtifactTransform(finalizedDiagnosticSource)),
    fs.writeFile(path.join(packetRoot, "manifest.json"), manifestSource),
    fs.writeFile(path.join(packetRoot, "audit", "owner-decisions.json"), decisionsSource),
    fs.writeFile(path.join(packetRoot, "graphs", "inner-child.graph.json"), innerChildGraphSource),
    fs.writeFile(path.join(packetRoot, "graphs", "somatic.graph.json"), somaticGraphSource),
    fs.writeFile(path.join(packetRoot, "policy", "owner-amendments.json"), ownerAmendmentsSource),
    fs.writeFile(path.join(fixtureRoot, "src", "orchestrator", "run-pipeline.mjs"), 'export const realizationContractVersion = "response-realization-v5";\n'),
    ...Object.entries(regressionSources).map(([name, data]) => fs.writeFile(path.join(packetRoot, name), data))
  ]);
  await fixtureTransform({ fixtureRoot, candidateRoot, packetRoot, diagnostic, governanceDecisions });
  return fixtureRoot;
}

async function passedR03Fixture(t, {
  r02SuggestionOverrides = {},
  r03SuggestionOverrides = {},
  r03SuggestionOverridesByDecision = {},
  decisionsLedger = "# Therapy decisions\n",
  approvals = "# Approved therapy lessons\n",
  historyTransform = (source) => source
} = {}) {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: r02SuggestionOverrides,
    decisionsLedger,
    approvals
  });
  const r03PacketId = "fixture-guides-r03-candidate";
  const r03EventId = "review-r03-passed-20260813";
  const r03CreatedAt = "2026-08-13T14:32:00.000Z";
  const r03ReviewedAt = "2026-08-13T14:45:00.000Z";
  const r03CandidateRoot = path.join(rootDir, "guide-packets", "fixtures", "r03-candidate");
  const r03PacketRoot = path.join(r03CandidateRoot, "packet");
  const r03Manifest = {
    status: "candidate",
    packetRevision: 3,
    packetId: r03PacketId,
    createdAt: "2026-08-13T14:30:00.000Z",
    guides: [
      { id: "inner-child", graphPath: "graphs/inner-child.graph.json" },
      { id: "somatic", graphPath: "graphs/somatic.graph.json" }
    ],
    externalSources: [{ id: "VAGAL.SAFETY.P5" }],
    paths: {
      ownerDecisions: "audit/owner-decisions.json",
      ownerAmendments: "policy/owner-amendments.json"
    }
  };
  const repairedDecisions = decisions.map((decision) => {
    if (decision.id === "decision-2") return {
      ...decision,
      provenance: "canonical-source-prose-plus-installed-A001-language",
      provenanceDetails: {
        canonicalSourceRefs: ["IC.LOVE_UNSAFE"],
        installedWordingRefs: ["A001.INSTALLED.OPPORTUNITY"],
        proposedOwnerPolicyExtensions: ["safety", "money"],
        ownerDecisionTiming: "after-deterministic-repair"
      }
    };
    if (decision.id === "decision-3") return { ...decision, candidate: "Priority 96" };
    return { ...decision };
  });
  const decisionsSource = `${JSON.stringify({ cards: repairedDecisions }, null, 2)}\n`;
  const manifestSource = `${JSON.stringify(r03Manifest, null, 2)}\n`;
  const innerChildGraphSource = `${JSON.stringify({
    nodes: repairedDecisions.flatMap((decision) => affectedByDecision[decision.id].graphNodeIds
      .filter((id) => id.startsWith("IC."))
      .map((id) => ({ id, ...(id === "IC.BORROW_ONE_FUNCTION" ? { priority: 96 } : {}) })))
  })}\n`;
  const somaticGraphSource = `${JSON.stringify({
    nodes: repairedDecisions.flatMap((decision) => affectedByDecision[decision.id].graphNodeIds
      .filter((id) => id.startsWith("SOM."))
      .map((id) => ({ id })))
  })}\n`;
  const ownerAmendmentsSource = `${JSON.stringify({ items: [{ id: "OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL" }] })}\n`;
  const provenanceSource = `${JSON.stringify({
    nodes: {
      "IC.AGE_RESPONSIBILITY_CLARIFICATION": { sourceRefs: ["IC.LOVE_UNSAFE", "A001.INSTALLED.OPPORTUNITY"] },
      "IC.BORROW_ONE_FUNCTION": { sourceRefs: ["IC.BORROW_ONE_FUNCTION", "IC.ADULT_APPRENTICE", "SOM.EFT_PORTABLE"] },
      "SOM.ADVANCED_RELEASE_BLOCK": {
        sourceRefs: ["SOM.ADVANCED_RELEASE_SOURCE", "VAGAL.SAFETY.P5"],
        authority: "author-framework-and-unvalidated-external",
        certainty: "author-provided-not-independently-validated"
      }
    }
  })}\n`;
  const crossGuideSource = `${JSON.stringify({
    edges: [{
      from: "SOM.EFT_PORTABLE",
      relation: "parallel-preparation",
      to: "IC.BORROW_ONE_FUNCTION",
      sourceRefs: ["SOM.EFT_PORTABLE", "IC.BORROW_ONE_FUNCTION"]
    }]
  })}\n`;
  const safetySource = `${JSON.stringify({
    id: "VAGAL.SAFETY.P5",
    independentlyValidated: false,
    requiredEncoding: {
      position: "lying-down-only",
      claimedRisks: ["syncope", "fall", "airway"],
      namedContraindications: ["aneurysm", "severe-hypertension", "glaucoma", "pregnancy"],
      destabilizationRisks: ["high-anxiety", "panic-disorder", "cptsd-with-panic"],
      gentlerAlternative: "Bhramari"
    }
  })}\n`;
  const productPolicySource = `${JSON.stringify({
    id: "OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL",
    authority: "product-only-operational",
    consentRoute: "app-owned",
    wakingReturn: "app-owned",
    therapeuticClaim: false
  })}\n`;
  const regressionSources = {
    "tests/decision-cases/A001.json": `${JSON.stringify({
      id: "A001",
      assertions: [{ graphNodeId: "IC.CREDIBILITY_REPAIR", expectedDeferNodes: ["IC.DEEP_CHILD_DIALOGUE"] }]
    })}\n`,
    "tests/decision-cases/H001.json": `${JSON.stringify({ id: "H001", assertions: [{ policyId: "OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL", expected: "unchanged" }] })}\n`,
    "tests/decision-cases/G-SOM-DELAYED.json": `${JSON.stringify({ id: "G-SOM-DELAYED", assertions: [{ graphNodeId: "SOM.DELAYED_RESPONSE_REASSESSMENT", expected: "available" }] })}\n`,
    "tests/decision-cases/G-SOM-ADVANCED-BLOCK.json": `${JSON.stringify({ id: "G-SOM-ADVANCED-BLOCK", assertions: [{ graphNodeId: "SOM.ADVANCED_RELEASE_BLOCK", expectedBlockNode: "SOM.ADVANCED_RELEASE_OPTIONAL" }] })}\n`
  };
  const r03Archive = createStoredZip([
    { name: "manifest.json", data: manifestSource },
    { name: "audit/owner-decisions.json", data: decisionsSource },
    { name: "graphs/inner-child.graph.json", data: innerChildGraphSource },
    { name: "graphs/somatic.graph.json", data: somaticGraphSource },
    { name: "policy/owner-amendments.json", data: ownerAmendmentsSource },
    { name: "policy/provenance.json", data: provenanceSource },
    { name: "graphs/cross-guide-edges.json", data: crossGuideSource },
    { name: "policy/vagal-safety-p5.json", data: safetySource },
    { name: "policy/app-owned-hypnosis-control.json", data: productPolicySource },
    ...Object.entries(regressionSources).map(([name, data]) => ({ name, data }))
  ], new Date("2026-08-13T14:30:00.000Z"));
  const r03PacketDigest = sha256(r03Archive);
  const r03Diagnostic = reviewDiagnostic({
    reviewedPacketId: r03PacketId,
    reviewedPacketDigest: r03PacketDigest,
    eventId: r03EventId,
    outcome: "passed-owner-gate",
    resolveBlockingFindings: true,
    manifestSha256: sha256(manifestSource),
    decisionCardsSha256: sha256(decisionsSource),
    nextPhase: "owner-decisions"
  });
  r03Diagnostic.occurredAt = r03ReviewedAt;
  const diagnosticPath = "docs/diagnostics/fixture-r03-review.json";
  const diagnosticSource = `${JSON.stringify(r03Diagnostic, null, 2)}\n`;
  const r03Review = reviewBlock({
    eventId: r03EventId,
    occurredAt: r03ReviewedAt,
    packetId: r03PacketId,
    outcome: "passed-owner-gate",
    nextPhase: "owner-decisions"
  }, {
    reviewArtifactPath: diagnosticPath,
    reviewArtifactSha256: sha256(diagnosticSource)
  });
  const r03Suggestions = repairedDecisions.map((decision) => suggestionBlock(decision, {
    createdAt: r03CreatedAt,
    status: "ready-for-owner",
    ...(decision.id === "decision-1" ? r03SuggestionOverrides : {}),
    ...(r03SuggestionOverridesByDecision[decision.id] ?? {})
  }, {
    suggestionPacketId: r03PacketId,
    suggestionPacketDigest: r03PacketDigest,
    suggestionPrefix: "suggestion-r03"
  }).replaceAll("r02", "r03").replaceAll("the packet has not passed review", "the packet passed independent review"));
  const r03History = repairedDecisions.map((decision) => `## candidate-r03-${decision.id}\n\n${marker("therapy-lesson", {
    lessonId: `candidate-r03-${decision.id}`,
    decisionId: decision.id,
    packetId: r03PacketId,
    learnedAt: r03CreatedAt,
    activation: "candidate-awaiting-owner"
  })}\n`).join("\n");

  await Promise.all([
    fs.mkdir(path.join(r03PacketRoot, "audit"), { recursive: true }),
    fs.mkdir(path.join(r03PacketRoot, "graphs"), { recursive: true }),
    fs.mkdir(path.join(r03PacketRoot, "policy"), { recursive: true }),
    fs.mkdir(path.join(r03PacketRoot, "tests", "decision-cases"), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(r03CandidateRoot, "fixture-guides-r03-candidate.zip"), r03Archive),
    fs.writeFile(path.join(r03PacketRoot, "manifest.json"), manifestSource),
    fs.writeFile(path.join(r03PacketRoot, "audit", "owner-decisions.json"), decisionsSource),
    fs.writeFile(path.join(r03PacketRoot, "graphs", "inner-child.graph.json"), innerChildGraphSource),
    fs.writeFile(path.join(r03PacketRoot, "graphs", "somatic.graph.json"), somaticGraphSource),
    fs.writeFile(path.join(r03PacketRoot, "policy", "owner-amendments.json"), ownerAmendmentsSource),
    fs.writeFile(path.join(r03PacketRoot, "policy", "provenance.json"), provenanceSource),
    fs.writeFile(path.join(r03PacketRoot, "graphs", "cross-guide-edges.json"), crossGuideSource),
    fs.writeFile(path.join(r03PacketRoot, "policy", "vagal-safety-p5.json"), safetySource),
    fs.writeFile(path.join(r03PacketRoot, "policy", "app-owned-hypnosis-control.json"), productPolicySource),
    fs.writeFile(path.join(rootDir, diagnosticPath), diagnosticSource),
    ...Object.entries(regressionSources).map(([name, data]) => fs.writeFile(path.join(r03PacketRoot, name), data))
  ]);
  await fs.appendFile(path.join(rootDir, "THERAPY-LESSONS"), historyTransform(`\n${r03History}\n${r03Review}`));
  await fs.appendFile(path.join(rootDir, "SUGGESTED-THERAPY-LESSONS"), `\n${r03Suggestions.join("\n")}`);
  return { rootDir, r03PacketId, r03PacketDigest, r03EventId, reviewArtifactSha256: sha256(diagnosticSource), r03CreatedAt, r03ReviewedAt };
}

async function initGitRepository(rootDir, {
  implementationPath = "src/therapy-change.txt",
  additionalImplementationPaths = [],
  commitDate = "2026-08-13T15:05:00.000Z"
} = {}) {
  await execFileAsync("git", ["init", "-q"], { cwd: rootDir });
  await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: rootDir });
  await execFileAsync("git", ["config", "user.email", "fixture@example.test"], { cwd: rootDir });
  await execFileAsync("git", ["add", "."], { cwd: rootDir });
  await execFileAsync("git", ["commit", "-q", "-m", "fixture baseline"], { cwd: rootDir, env: { ...process.env, GIT_AUTHOR_DATE: "2026-08-13T14:00:00Z", GIT_COMMITTER_DATE: "2026-08-13T14:00:00Z" } });
  const committedPaths = [implementationPath, ...additionalImplementationPaths];
  for (const committedPath of committedPaths) {
    await fs.mkdir(path.dirname(path.join(rootDir, committedPath)), { recursive: true });
    await fs.writeFile(path.join(rootDir, committedPath), "implemented approved therapy scope\n");
  }
  await execFileAsync("git", ["add", ...committedPaths], { cwd: rootDir });
  await execFileAsync("git", ["commit", "-q", "-m", "implement approved therapy scope"], { cwd: rootDir, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate } });
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: rootDir })).stdout.trim();
}

async function implementedR03Fixture(t, {
  implementationPath = "src/therapy-change.txt",
  additionalImplementationPaths = [],
  commitDate = "2026-08-13T15:05:00.000Z",
  approvalOverrides = {},
  eventOverrides = {},
  omitImplementationEvent = false
} = {}) {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "implemented" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  const commit = await initGitRepository(fixture.rootDir, { implementationPath, additionalImplementationPaths, commitDate });
  const approval = r03Approval({
    implementationStatus: "implemented",
    implementationCommit: commit,
    implementationPaths: [implementationPath],
    regressionResults: [{ regressionId: "G-SOM-DELAYED", status: "PASS", evidence: "Focused regression passed." }],
    ...approvalOverrides
  }).replace("Approved but not implemented.", "Implemented in the linked commit.").replace("No implementation evidence is claimed yet.", "Structured PASS evidence is recorded in metadata.");
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), approval);
  if (!omitImplementationEvent) {
    await fs.appendFile(path.join(fixture.rootDir, "THERAPY-LESSONS"), implementationEventBlock({
      implementationCommit: commit,
      implementationPaths: [implementationPath],
      ...eventOverrides
    }));
  }
  return { ...fixture, commit, implementationPath };
}

function r03DecisionReceipt(decision, fixture, overrides = {}) {
  return decisionReceiptBlock(decision, {
    receiptId: `decision-r03-${decision.id}`,
    suggestionId: `suggestion-r03-${decision.id}`,
    packetId: fixture.r03PacketId,
    packetDigest: fixture.r03PacketDigest,
    reviewEventId: fixture.r03EventId,
    reviewArtifactPath: "docs/diagnostics/fixture-r03-review.json",
    reviewArtifactSha256: fixture.reviewArtifactSha256,
    decidedAt: "2026-08-13T15:00:00.000Z",
    ...overrides
  });
}

function r03Approval(overrides = {}) {
  return approvalBlock({
    approvalId: "approval-r03-decision-1",
    suggestionId: "suggestion-r03-decision-1",
    decisionReceiptId: "decision-r03-decision-1",
    decidedAt: "2026-08-13T15:00:00.000Z",
    ...overrides
  });
}

test("therapy lesson log covers every substantive decision in the latest uploaded guide candidate", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/verify-therapy-lessons.mjs"], {
    cwd: root
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error?.code ?? 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? error?.message ?? "" })
  );
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^PASS 5\/5 substantive therapy suggestions tracked for /);
  assert.match(result.stdout, /6 active runtime lessons/);
  assert.match(result.stdout, /5 blocked suggestions/);
  assert.match(result.stdout, /1 explicit owner decision receipts/);
  assert.match(result.stdout, /1 explicit owner approvals/);
  assert.match(result.stdout, /0 implementations/);
  assert.match(result.stdout, /r02 rejection explained/);
});

test("therapy governance loads an immutable non-Guide policy-decision package", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-policy-decision-package-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const packageDir = path.join(rootDir, "docs", "therapy-policy", "decision-packages");
  await fs.mkdir(packageDir, { recursive: true });
  const evidencePath = path.join(rootDir, "analysis", "fixture-evidence.json");
  const evidenceSource = '{"status":"reviewed"}\n';
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, evidenceSource);
  const affectedIds = {
    guideIds: ["inner-child"],
    graphNodeIds: ["PROTO.O1_PRACTICAL_SAFETY"],
    promptContractIds: ["case-formulation-v2"],
    policySafetyGateIds: ["THERAPY.PROTOCOL.DIRECT_RISK_CHECK"],
    regressionIds: ["RQ8-01"]
  };
  const decisionPackage = {
    contractVersion: "therapy-policy-decision-package-v1",
    packetId: "fixture-live-remediation-v1",
    packetRevision: 1,
    createdAt: "2026-08-19T07:00:00.000Z",
    evidenceBindings: [{
      path: "analysis/fixture-evidence.json",
      sha256: sha256(evidenceSource),
      authority: "fixture-review"
    }],
    identifierCatalog: affectedIds,
    cards: [{
      id: "live-remediation-contract-v1",
      classification: "substantive",
      requiresHumanDecision: true,
      title: "Approve bounded live remediation",
      behavioralEffect: "Preserve decisive outer routes under conservative formulation.",
      provenance: "owner-authored-graders-plus-live-evaluation",
      current: "Material unknowns can demote decisive outer evidence.",
      candidate: "Decisive outer evidence retains O1, O9, or O10 precedence.",
      worstPlausibleFailure: "An outer route can activate too broadly.",
      affectedRegressions: ["RQ8-01"],
      affectedIds
    }]
  };
  await fs.writeFile(path.join(packageDir, "fixture.json"), `${JSON.stringify(decisionPackage, null, 2)}\n`);

  const packages = await loadPolicyDecisionPackages({ rootDir });
  assert.equal(packages.length, 1);
  assert.equal(packages[0].manifest.packetId, decisionPackage.packetId);
  assert.equal(packages[0].cardsById.get("live-remediation-contract-v1").candidate, decisionPackage.cards[0].candidate);
  assert.equal(packages[0].packetDigest, sha256(`${JSON.stringify(decisionPackage, null, 2)}\n`));
});

test("therapy governance rejects policy-decision scope outside its immutable catalog", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-policy-decision-scope-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const packageDir = path.join(rootDir, "docs", "therapy-policy", "decision-packages");
  await fs.mkdir(packageDir, { recursive: true });
  const evidencePath = path.join(rootDir, "analysis", "fixture-evidence.json");
  const evidenceSource = '{"status":"reviewed"}\n';
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, evidenceSource);
  const emptyScope = {
    guideIds: [],
    graphNodeIds: [],
    promptContractIds: [],
    policySafetyGateIds: [],
    regressionIds: []
  };
  await fs.writeFile(path.join(packageDir, "fixture.json"), `${JSON.stringify({
    contractVersion: "therapy-policy-decision-package-v1",
    packetId: "fixture-invalid-live-remediation-v1",
    packetRevision: 1,
    createdAt: "2026-08-19T07:00:00.000Z",
    evidenceBindings: [{
      path: "analysis/fixture-evidence.json",
      sha256: sha256(evidenceSource),
      authority: "fixture-review"
    }],
    identifierCatalog: emptyScope,
    cards: [{
      id: "live-remediation-contract-v1",
      classification: "substantive",
      requiresHumanDecision: true,
      title: "Approve bounded live remediation",
      behavioralEffect: "Preserve decisive outer routes under conservative formulation.",
      provenance: "owner-authored-graders-plus-live-evaluation",
      current: "Material unknowns can demote decisive outer evidence.",
      candidate: "Decisive outer evidence retains O1, O9, or O10 precedence.",
      worstPlausibleFailure: "An outer route can activate too broadly.",
      affectedRegressions: ["RQ8-01"],
      affectedIds: { ...emptyScope, regressionIds: ["RQ8-01"] }
    }]
  }, null, 2)}\n`);

  await assert.rejects(
    loadPolicyDecisionPackages({ rootDir }),
    /affected IDs exceed its identifierCatalog/
  );
});

test("production therapy governance preserves the exact r02 mapping", async () => {
  const governance = await loadTherapyGovernance({ rootDir: root });
  const actualSuggestions = Object.fromEntries(governance.suggestions
    .filter(({ metadata }) => metadata.packetId === "inner-signal-guides-2026.08.12-r02-candidate")
    .map(({ metadata }) => [metadata.decisionId, {
    guideIds: metadata.guideIds,
    graphNodeIds: metadata.graphNodeIds,
    promptContractIds: metadata.promptContractIds,
    policySafetyGateIds: metadata.policySafetyGateIds,
    regressionIds: metadata.regressionIds,
    reviewFindingIds: metadata.reviewFindingIds
  }]));
  assert.deepEqual(actualSuggestions, {
    "decision-1": {
      guideIds: ["somatic"],
      graphNodeIds: ["SOM.DELAYED_RESPONSE_REASSESSMENT"],
      promptContractIds: [],
      policySafetyGateIds: [],
      regressionIds: ["G-SOM-DELAYED"],
      reviewFindingIds: []
    },
    "decision-2": {
      guideIds: ["inner-child"],
      graphNodeIds: ["IC.AGE_RESPONSIBILITY_CLARIFICATION"],
      promptContractIds: ["response-realization-v5"],
      policySafetyGateIds: [],
      regressionIds: ["A001"],
      reviewFindingIds: ["SRC-CITE-001"]
    },
    "decision-3": {
      guideIds: ["inner-child"],
      graphNodeIds: ["IC.BORROW_ONE_FUNCTION", "IC.NEUTRAL_WITNESS"],
      promptContractIds: ["response-realization-v5"],
      policySafetyGateIds: ["OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL"],
      regressionIds: ["A001", "H001"],
      reviewFindingIds: ["PRIORITY-TIE-001"]
    },
    "decision-4": {
      guideIds: ["inner-child"],
      graphNodeIds: ["IC.CREDIBILITY_REPAIR", "IC.DEEP_CHILD_DIALOGUE"],
      promptContractIds: ["response-realization-v5"],
      policySafetyGateIds: [],
      regressionIds: ["A001"],
      reviewFindingIds: ["REG-EVIDENCE-001"]
    },
    "decision-5": {
      guideIds: ["somatic"],
      graphNodeIds: ["SOM.ADVANCED_RELEASE_BLOCK", "SOM.ADVANCED_RELEASE_OPTIONAL"],
      promptContractIds: ["response-realization-v5"],
      policySafetyGateIds: ["VAGAL.SAFETY.P5"],
      regressionIds: ["G-SOM-DELAYED", "G-SOM-ADVANCED-BLOCK"],
      reviewFindingIds: ["SAFETY-ENCODE-001", "EXT-VALID-001"]
    }
  });
  assert.deepEqual(governance.reviewEvents[0].metadata.suggestionFindings, reviewFindingsByDecision);
  assert.deepEqual(governance.reviewEvents[0].metadata.packetLevelFindingIds, [
    "CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001"
  ]);
});

test("production therapy governance binds Joel's explicit option-1 approval exactly once", async () => {
  const governance = await verifyTherapyGovernance({ rootDir: root });
  const suggestion = governance.suggestions.filter(({ metadata }) => metadata.suggestionId === "suggestion-live-remediation-contract-v1");
  const decisions = governance.decisions.filter(({ metadata }) => metadata.suggestionId === "suggestion-live-remediation-contract-v1");
  const approvals = governance.approvals.filter(({ metadata }) => metadata.suggestionId === "suggestion-live-remediation-contract-v1");
  assert.equal(governance.policyDecisionPackages.length, 1);
  assert.equal(suggestion.length, 1);
  assert.equal(suggestion[0].metadata.status, "approved");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].metadata.choice, "approve");
  assert.equal(decisions[0].metadata.decisionSource, "direct-user-conversation");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].metadata.decisionReceiptId, decisions[0].metadata.receiptId);
  assert.equal(approvals[0].metadata.implementationStatus, "approved-not-implemented");
});

for (const { name, historyTransform, error } of [
  {
    name: "malformed metadata",
    historyTransform: (source) => source.replace(
      marker("therapy-lesson", validEntries()[0]),
      '<!-- therapy-lesson {"lessonId":} -->'
    ),
    error: /Malformed therapy lesson metadata/
  },
  {
    name: "duplicate lesson IDs",
    historyTransform: (source) => `${source}\n${marker("therapy-lesson", validEntries()[0])}\n`,
    error: /Duplicate therapy lesson ID: active-one/
  },
  {
    name: "invalid activation",
    historyTransform: (source) => source.replace('"activation":"active-runtime"', '"activation":"invalid"'),
    error: /Therapy lesson active-one has an invalid activation state/
  },
  {
    name: "invalid timestamp",
    historyTransform: (source) => source.replace(`"learnedAt":"${createdAt}"`, '"learnedAt":"2026-08-12"'),
    error: /Therapy lesson active-one has an invalid UTC timestamp/
  }
]) {
  test(`therapy history parser rejects ${name}`, async (t) => {
    await assert.rejects(
      verifyTherapyLessons({ rootDir: await governanceFixture(t, { historyTransform }) }),
      error
    );
  });
}

test("therapy governance rejects a missing ledger", async (t) => {
  const rootDir = await governanceFixture(t);
  await fs.rm(path.join(rootDir, "APPROVED-THERAPY-LESSONS"));
  await assert.rejects(loadTherapyGovernance({ rootDir }), /APPROVED-THERAPY-LESSONS is required/);
});

test("therapy governance rejects malformed suggestion metadata", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestions: '<!-- therapy-suggestion {"suggestionId":} -->\n'
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS: malformed therapy-suggestion metadata/);
});

test("therapy governance rejects invalid timestamps", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { createdAt: "2026-08-13" }
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has an invalid UTC createdAt/);
});

test("therapy governance rejects invalid status", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { status: "almost-approved" }
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has an invalid status/);
});

test("therapy governance rejects duplicate IDs across ledgers", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { suggestionId: "review-r02-live-rejection-20260813" }
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /Duplicate therapy governance ID: review-r02-live-rejection-20260813/);
});

test("therapy governance rejects foreign approval IDs on suggestions before identity ambiguity", async (t) => {
  const rootDir = await governanceFixture(t, {
    duplicateSuggestionDecisionId: "decision-1",
    suggestionsTransform: (source) => source
      .replace(
        '"suggestionId":"suggestion-r02-decision-1-duplicate"',
        '"suggestionId":"suggestion-r02-decision-1","approvalId":"foreign-suggestion-duplicate"'
      )
      .replace(
        '"suggestionId":"suggestion-r02-decision-1","createdAt"',
        '"suggestionId":"suggestion-r02-decision-1","approvalId":"foreign-suggestion-original","createdAt"'
      )
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 contains forbidden field approvalId/);
});

test("therapy governance rejects foreign event IDs on approvals before identity ambiguity", async (t) => {
  const rootDir = await governanceFixture(t, {
    approvals: `${approvalBlock({ eventId: "foreign-approval-original" })}\n${approvalBlock({ eventId: "foreign-approval-duplicate" })}`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /approval-r02-decision-1 contains forbidden field eventId/);
});

test("therapy governance rejects a missing readable section", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => source.replace("### Evidence and uncertainty", "### Evidence")
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS suggestion-r02-decision-1 is missing section: Evidence and uncertainty/);
});

test("therapy governance requires the root owner protocol marker", async (t) => {
  const rootDir = await governanceFixture(t, { agents: "# Repository instructions\n" });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /AGENTS.md is missing therapy-owner-decision-protocol-v2/);
});

test("therapy governance accepts an approval implementation status", async (t) => {
  const rootDir = await governanceFixture(t, { approvals: approvalBlock({ suggestionId: "linked-suggestion-r02-decision-1" }) });
  const governance = await loadTherapyGovernance({ rootDir });
  assert.equal(governance.approvals.length, 1);
});

test("therapy governance rejects an invalid approval implementation status", async (t) => {
  const rootDir = await governanceFixture(t, {
    approvals: approvalBlock({
      suggestionId: "linked-suggestion-r02-decision-1",
      implementationStatus: "almost-implemented",
      status: "approved-not-implemented"
    })
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /approval-r02-decision-1 has an invalid implementationStatus/);
});

for (const { entry, field, fixtureOption } of [
  { entry: "review-r02-live-rejection-20260813", field: "findingIds", fixtureOption: "reviewOverrides" },
  { entry: "review-r02-live-rejection-20260813", field: "packetLevelFindingIds", fixtureOption: "reviewOverrides" },
  { entry: "suggestion-r02-decision-1", field: "reviewFindingIds", fixtureOption: "suggestionOverrides" },
  { entry: "suggestion-r02-decision-1", field: "guideIds", fixtureOption: "suggestionOverrides" },
  { entry: "suggestion-r02-decision-1", field: "graphNodeIds", fixtureOption: "suggestionOverrides" },
  { entry: "suggestion-r02-decision-1", field: "promptContractIds", fixtureOption: "suggestionOverrides" },
  { entry: "suggestion-r02-decision-1", field: "policySafetyGateIds", fixtureOption: "suggestionOverrides" },
  { entry: "suggestion-r02-decision-1", field: "regressionIds", fixtureOption: "suggestionOverrides" }
]) {
  test(`therapy governance requires ${field} on ${entry}`, async (t) => {
    const rootDir = await governanceFixture(t, { [fixtureOption]: { [field]: undefined } });
    await assert.rejects(loadTherapyGovernance({ rootDir }), new RegExp(`${entry} has an invalid ${field}`));
  });
}

test("therapy governance rejects a missing latest-packet suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    omitSuggestionDecisionId: "decision-2"
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /candidate-decision-2 requires exactly one retained suggestion; found 0/);
});

test("therapy governance rejects a duplicate latest-packet suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    duplicateSuggestionDecisionId: "decision-1"
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /candidate-decision-1 requires exactly one retained suggestion; found 2/);
});

test("therapy governance rejects an unknown latest-packet decision", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { decisionId: "decision-unknown" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 references unknown decision decision-unknown/);
});

test("therapy governance rejects a suggestion naming the wrong packet", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { packetId: "wrong-packet" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 references unknown Guide Packet wrong-packet/);
});

test("therapy governance requires one rejected review event for the latest packet", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "accepted" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review artifact has invalid outcome accepted/);
});

test("therapy governance rejects unmapped review findings", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { findingIds: ["UNMAPPED-001"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 finding IDs do not match its artifact/);
});

test("therapy governance rejects finding mappings absent from the review", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { reviewFindingIds: ["NOT-IN-REVIEW-001"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 reviewFindingIds do not match its authoritative review artifact/);
});

test("therapy governance rejects swapped per-decision findings despite an unchanged overall union", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: {
      suggestionFindings: {
        ...reviewFindingsByDecision,
        "decision-2": ["PRIORITY-TIE-001"],
        "decision-3": ["SRC-CITE-001"]
      }
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 suggestion finding mapping does not match its artifact/
  );
});

test("therapy governance rejects a missing latest-decision suggestionFindings key", async (t) => {
  const { "decision-5": omitted, ...suggestionFindings } = reviewFindingsByDecision;
  const rootDir = await governanceFixture(t, { reviewOverrides: { suggestionFindings } });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 suggestion finding mapping does not match its artifact/
  );
});

test("therapy governance rejects an extra suggestionFindings decision key", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: {
      suggestionFindings: { ...reviewFindingsByDecision, "decision-extra": [] }
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 suggestion finding mapping does not match its artifact/
  );
});

for (const label of [
  "Benefits:", "Costs:", "Worst plausible failure:", "Recommendation:",
  "Reasoning:", "Source status:", "Limitation:"
]) {
  test(`therapy governance requires ${label} in each decision brief`, async (t) => {
    const rootDir = await governanceFixture(t, {
      suggestionsTransform: (source) => source.replaceAll(label, label.replace(":", ""))
    });
    await assert.rejects(
      verifyTherapyGovernance({ rootDir }),
      label === "Worst plausible failure:"
        ? /suggestion-r02-decision-1 Option A is missing decision-card field: Worst plausible failure:/
        : new RegExp(`suggestion-r02-decision-1 is missing decision-brief element: ${label}`)
    );
  });
}

test("therapy governance accepts a complete latest-packet governance result", async (t) => {
  const result = await verifyTherapyGovernance({ rootDir: await governanceFixture(t) });
  assert.equal(result.packetId, packetId);
  assert.equal(result.tracked, 5);
  assert.equal(result.reviewEvent.metadata.outcome, "rejected-before-owner-gate");
  assert.equal(result.suggestionsByDecision.size, 5);
});

function passedPacketSuggestionOverrides() {
  return Object.fromEntries(decisions.map((decision) => [decision.id, { status: "ready-for-owner" }]));
}

function ownerApprovedSuggestionOverrides(overrides = {}) {
  return {
    ...passedPacketSuggestionOverrides(),
    "decision-1": { status: "approved", guideIds: ["somatic"], ...overrides }
  };
}

test("therapy governance accepts passed-owner-gate suggestions that are ready for the owner", async (t) => {
  const fixture = await passedR03Fixture(t);
  const result = await verifyTherapyGovernance({ rootDir: fixture.rootDir });
  assert.equal(result.reviewEvent.metadata.outcome, "passed-owner-gate");
});

test("therapy governance rejects an approval whose suggestion is missing", async (t) => {
  const rootDir = await governanceFixture(t, {
    approvals: approvalBlock({ suggestionId: "missing-suggestion" })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /APPROVED-THERAPY-LESSONS approval-r02-decision-1 references missing suggestion missing-suggestion/
  );
});

test("therapy governance rejects duplicate approvals for a suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    approvals: `${approvalBlock()}\n${approvalBlock({ approvalId: "approval-r02-decision-1-duplicate" })}`
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /APPROVED-THERAPY-LESSONS has duplicate approvals for suggestion suggestion-r02-decision-1/
  );
});

test("therapy governance requires approvals to come from a direct user conversation", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture, { decisionSource: "model-review" }));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /decision-r03-decision-1 must use decisionSource direct-user-conversation/
  );
});

test("therapy governance rejects an approval for a packet-blocked suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { guideIds: ["somatic"] },
    approvals: approvalBlock()
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /approval-r02-decision-1 must link the approving decision receipt for suggestion-r02-decision-1/
  );
});

test("therapy governance requires an approval for an approved suggestion", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /SUGGESTED-THERAPY-LESSONS suggestion-r03-decision-1 with status approved requires exactly one approval/
  );
});

test("therapy governance requires implemented suggestions to have implemented approvals", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "implemented" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /SUGGESTED-THERAPY-LESSONS suggestion-r03-decision-1 with status implemented requires an implemented approval/
  );
});

test("therapy governance requires an implementation commit for implemented approvals", async (t) => {
  const fixture = await implementedR03Fixture(t, { approvalOverrides: { implementationCommit: undefined } });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 must provide a valid implementationCommit/
  );
});

test("therapy governance rejects an approval with malformed implementation commit identifiers", async (t) => {
  const fixture = await implementedR03Fixture(t, { approvalOverrides: { implementationCommit: "A".repeat(40) } });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 must provide a valid implementationCommit/
  );
});

test("therapy governance rejects implemented approvals that claim no verification evidence", async (t) => {
  const fixture = await implementedR03Fixture(t);
  const approvalPath = path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS");
  await fs.writeFile(approvalPath, (await fs.readFile(approvalPath, "utf8")).replace("Structured PASS evidence is recorded in metadata.", "No implementation evidence is claimed."));
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 must include substantive implementation verification evidence/
  );
});

test("therapy governance requires implemented approvals to have nonempty verification evidence", async (t) => {
  const fixture = await implementedR03Fixture(t);
  const approvalPath = path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS");
  await fs.writeFile(approvalPath, (await fs.readFile(approvalPath, "utf8")).replace("Structured PASS evidence is recorded in metadata.", "   "));
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }), /APPROVED-THERAPY-LESSONS approval-r03-decision-1 is missing section: Verification evidence/
  );
});

test("therapy governance rejects an approval for a declined suggestion", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "declined" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture, { choice: "decline" }));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /decision-r03-decision-1 decline receipt must not have an approval view/);
});

test("therapy governance rejects an approval for a superseded suggestion", async (t) => {
  const fixture = await passedR03Fixture(t, { r02SuggestionOverrides: { status: "superseded", supersededBy: "suggestion-r03-decision-1", supersessionReason: "technical-replacement" } });
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), approvalBlock());
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r02-decision-1 must link the approving decision receipt for suggestion-r02-decision-1/);
});

test("therapy governance requires approval guide IDs to exactly match the suggestion guide IDs", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval({ guideIds: ["inner-child"] }));
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 affected scope must exactly match suggestion-r03-decision-1/
  );
});

test("therapy governance accepts a direct owner approval for an approved suggestion", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  const result = await verifyTherapyGovernance({ rootDir: fixture.rootDir });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "approved");
});

test("therapy governance accepts implemented suggestions with substantive implementation evidence", async (t) => {
  const fixture = await implementedR03Fixture(t);
  const result = await verifyTherapyGovernance({ rootDir: fixture.rootDir });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "implemented");
});

test("therapy governance rejects a ready-for-owner status while its packet remains rejected", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { status: "ready-for-owner" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has invalid status for a rejected packet/);
});

test("therapy governance rejects a blocked status after its packet passes owner gate", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "blocked-by-packet-review" } });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /suggestion-r03-decision-1 has invalid status for a passed packet/);
});

test("therapy governance rejects a suggestion that does not require an owner decision", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { ownerDecisionRequired: false }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 must require an owner decision/);
});

test("therapy governance rejects a suggestion created before its Guide Packet", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { createdAt: "2026-08-12T02:44:59.999Z" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 predates its Guide Packet/);
});

test("therapy governance rejects a suggestion missing a decision-card regression", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { regressionIds: [] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 affected IDs for decision-1 do not match suggestion-r02-decision-1/);
});

test("therapy governance rejects a suggestion with an extra decision-card regression", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { regressionIds: ["G-SOM-DELAYED", "EXTRA-001"] }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /suggestion-r02-decision-1 names unknown regression identifier EXTRA-001/
  );
});

for (const { field, original, replacement } of [
  {
    field: "Current behavior",
    original: `Current behavior: ${decisionCardDetails["decision-1"].current}`,
    replacement: "Current behavior: A different current state."
  },
  {
    field: "Candidate behavior",
    original: `Candidate behavior: ${decisionCardDetails["decision-1"].candidate}`,
    replacement: "Candidate behavior: A different candidate state."
  },
  {
    field: "Option A worst plausible failure",
    original: `Worst plausible failure: ${decisionCardDetails["decision-1"].worstPlausibleFailure}`,
    replacement: "Worst plausible failure: A different failure."
  }
]) {
  test(`therapy governance requires exact decision-card ${field}`, async (t) => {
    const rootDir = await governanceFixture(t, {
      suggestionsTransform: (source) => source.replace(original, replacement)
    });
    await assert.rejects(
      verifyTherapyGovernance({ rootDir }),
      new RegExp(`suggestion-r02-decision-1 ${field} does not match decision-1`)
    );
  });
}

test("therapy governance rejects approval without a typed decision receipt", async (t) => {
  const fixture = await passedR03Fixture(t, {
    r03SuggestionOverrides: { status: "approved" },
    approvals: r03Approval()
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /(suggestion-r03-decision-1 with status approved requires exactly one approve decision receipt|approval-r03-decision-1 must link the approving decision receipt)/);
});

test("therapy governance rejects decline without a typed decision receipt", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "declined" } });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /suggestion-r03-decision-1 with status declined requires exactly one decline decision receipt/);
});

test("therapy governance rejects a decline receipt paired with an approval view", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "declined" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture, { choice: "decline" }));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /decline receipt must not have an approval view/);
});

for (const { name, overrides, error } of [
  { name: "packet", overrides: { packetId: "wrong-packet" }, error: /decision-r03-decision-1 packet binding does not match suggestion-r03-decision-1/ },
  { name: "packet digest", overrides: { packetDigest: "f".repeat(64) }, error: /decision-r03-decision-1 packet binding does not match suggestion-r03-decision-1/ },
  { name: "card", overrides: { decisionId: "decision-2" }, error: /decision-r03-decision-1 decision-card binding does not match suggestion-r03-decision-1/ },
  { name: "card digest", overrides: { decisionCardDigest: "f".repeat(64) }, error: /decision-r03-decision-1 decision-card binding does not match suggestion-r03-decision-1/ },
  { name: "review event", overrides: { reviewEventId: "review-r02-live-rejection-20260813" }, error: /decision-r03-decision-1 review binding does not match the passed review/ },
  { name: "review artifact", overrides: { reviewArtifactSha256: "f".repeat(64) }, error: /decision-r03-decision-1 review binding does not match the passed review/ },
  { name: "source", overrides: { decisionSource: "model-review" }, error: /decision-r03-decision-1 must use decisionSource direct-user-conversation/ },
  { name: "chronology before review", overrides: { decidedAt: "2026-08-13T14:44:59.999Z" }, error: /decision-r03-decision-1 must follow its passed review/ },
  { name: "partial guide scope", overrides: { guideIds: [] }, error: /decision-r03-decision-1 affected scope must exactly match suggestion-r03-decision-1/ },
  { name: "partial regression scope", overrides: { regressionIds: [] }, error: /decision-r03-decision-1 affected scope must exactly match suggestion-r03-decision-1/ }
]) {
  test(`therapy governance rejects decision receipt ${name} mismatch`, async (t) => {
    const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
    await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture, overrides));
    await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval(name === "chronology before review" ? { decidedAt: overrides.decidedAt } : {}));
    await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), error);
  });
}

test("therapy governance accepts a complete typed approve receipt and approval projection", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  const result = await verifyTherapyGovernance({ rootDir: fixture.rootDir });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "approved");
});

test("therapy governance rejects approval projection time drift from its decision receipt", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval({ decidedAt: "2026-08-13T15:00:01.000Z" }));
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 decidedAt must match decision-r03-decision-1/);
});

test("therapy governance accepts a complete typed decline receipt without approval", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "declined" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture, { choice: "decline" }));
  const result = await verifyTherapyGovernance({ rootDir: fixture.rootDir });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "declined");
});

test("therapy governance rejects supersession without a valid compatible replacement link", async (t) => {
  const fixture = await passedR03Fixture(t, {
    r02SuggestionOverrides: { status: "superseded", supersededBy: "suggestion-r03-decision-2", supersessionReason: "technical-replacement" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /suggestion-r02-decision-1 supersededBy replacement is not scope-compatible/);
});

test("therapy governance rejects supersession that fabricates an owner decision", async (t) => {
  const fixture = await passedR03Fixture(t, {
    r02SuggestionOverrides: { status: "superseded", supersededBy: "suggestion-r03-decision-1", supersessionReason: "technical-replacement" }
  });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), r03DecisionReceipt(decisions[0], fixture, { suggestionId: "suggestion-r02-decision-1" }));
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /superseded suggestion-r02-decision-1 must not have a decision receipt/);
});

test("therapy governance rejects approval of rejected r02 after a newer r03 becomes latest", async (t) => {
  const fixture = await passedR03Fixture(t, { r02SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(path.join(fixture.rootDir, "THERAPY-DECISIONS"), decisionReceiptBlock(decisions[0]));
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), approvalBlock());
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /suggestion-r02-decision-1 has invalid status for a rejected packet/);
});

test("therapy governance rejects historical suggestion regression drift after a newer packet becomes latest", async (t) => {
  const fixture = await passedR03Fixture(t);
  const suggestionsPath = path.join(fixture.rootDir, "SUGGESTED-THERAPY-LESSONS");
  await fs.writeFile(suggestionsPath, mutateMarker(
    await fs.readFile(suggestionsPath, "utf8"),
    "therapy-suggestion", "suggestionId", "suggestion-r02-decision-1",
    (metadata) => ({ ...metadata, regressionIds: ["A001"] })
  ));

  const diagnosticPath = path.join(fixture.rootDir, "docs", "diagnostics", "fixture-r02-review.json");
  const diagnostic = JSON.parse(await fs.readFile(diagnosticPath, "utf8"));
  diagnostic.decisionAffectedIds["decision-1"].regressionIds = ["A001"];
  const diagnosticSource = `${JSON.stringify(diagnostic, null, 2)}\n`;
  await fs.writeFile(diagnosticPath, diagnosticSource);
  const historyPath = path.join(fixture.rootDir, "THERAPY-LESSONS");
  await fs.writeFile(historyPath, mutateMarker(
    await fs.readFile(historyPath, "utf8"),
    "therapy-review-event", "eventId", "review-r02-live-rejection-20260813",
    (metadata) => ({ ...metadata, reviewArtifactSha256: sha256(diagnosticSource) })
  ));

  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /suggestion-r02-decision-1 regressionIds must exactly match decision-1 affectedRegressions/
  );
});

test("therapy governance rejects historical suggestion finding drift after a newer packet becomes latest", async (t) => {
  const fixture = await passedR03Fixture(t);
  const suggestionsPath = path.join(fixture.rootDir, "SUGGESTED-THERAPY-LESSONS");
  await fs.writeFile(suggestionsPath, mutateMarker(
    await fs.readFile(suggestionsPath, "utf8"),
    "therapy-suggestion", "suggestionId", "suggestion-r02-decision-1",
    (metadata) => ({ ...metadata, reviewFindingIds: ["SRC-CITE-001"] })
  ));
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /suggestion-r02-decision-1 reviewFindingIds do not match its authoritative review artifact/
  );
});

test("therapy governance rejects an approval with a fake or unreachable implementation commit", async (t) => {
  const fixture = await implementedR03Fixture(t, { approvalOverrides: { implementationCommit: "f".repeat(40) } });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 implementationCommit is not an unambiguous reachable commit/);
});

test("therapy governance rejects an approval with an ambiguous abbreviated implementation commit", async (t) => {
  const fixture = await implementedR03Fixture(t);
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), mutateMarker(
    await fs.readFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), "utf8"),
    "therapy-approval", "approvalId", "approval-r03-decision-1",
    (metadata) => ({ ...metadata, implementationCommit: fixture.commit.slice(0, 7) })
  ));
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 implementationCommit must be a full 40-character commit ID/);
});

test("therapy governance rejects implementation commit chronology before the owner decision", async (t) => {
  const fixture = await implementedR03Fixture(t, { commitDate: "2026-08-13T14:59:00.000Z" });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 implementation commit must follow its owner decision/);
});

test("therapy governance rejects declared implementation paths absent from the implementation commit diff", async (t) => {
  const fixture = await implementedR03Fixture(t, {
    approvalOverrides: { implementationPaths: ["src/not-changed.txt"] },
    eventOverrides: { implementationPaths: ["src/not-changed.txt"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 implementation path src\/not-changed.txt is absent from the commit diff/);
});

test("therapy governance rejects implementation commits with undeclared changed paths", async (t) => {
  const fixture = await implementedR03Fixture(t, {
    additionalImplementationPaths: ["src/undeclared-therapy-change.txt"]
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /approval-r03-decision-1 implementationPaths must exactly match the commit diff/
  );
});

test("therapy governance rejects implemented scope with empty implementation paths", async (t) => {
  const fixture = await implementedR03Fixture(t, {
    approvalOverrides: { implementationPaths: [] },
    eventOverrides: { implementationPaths: [] }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /(approval-r03-decision-1|implementation-r03-decision-1) must declare at least one implementation path/
  );
});

test("therapy governance rejects missing structured PASS evidence for an affected regression", async (t) => {
  const fixture = await implementedR03Fixture(t, {
    approvalOverrides: { regressionResults: [] },
    eventOverrides: { regressionResults: [] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 must record exactly one PASS result for G-SOM-DELAYED/);
});

test("therapy governance rejects non-PASS structured regression evidence", async (t) => {
  const results = [{ regressionId: "G-SOM-DELAYED", status: "FAIL", evidence: "Failure output." }];
  const fixture = await implementedR03Fixture(t, {
    approvalOverrides: { regressionResults: results },
    eventOverrides: { regressionResults: results }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 regression G-SOM-DELAYED must be PASS/);
});

test("therapy governance rejects implemented approval without one history implementation event", async (t) => {
  const fixture = await implementedR03Fixture(t, { omitImplementationEvent: true });
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /approval-r03-decision-1 requires exactly one implementation history event; found 0/);
});

test("therapy governance rejects an orphan implementation history event", async (t) => {
  const fixture = await passedR03Fixture(t);
  await fs.appendFile(path.join(fixture.rootDir, "THERAPY-LESSONS"), implementationEventBlock({
    eventId: "implementation-orphan",
    suggestionId: "suggestion-r03-decision-1",
    approvalId: "approval-missing",
    decisionReceiptId: "decision-missing"
  }));
  await assert.rejects(verifyTherapyGovernance({ rootDir: fixture.rootDir }), /implementation-orphan does not link an implemented approval/);
});

test("therapy governance accepts implemented scope backed by a real reachable Git commit", async (t) => {
  const fixture = await implementedR03Fixture(t);
  const result = await verifyTherapyGovernance({ rootDir: fixture.rootDir });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "implemented");
});

test("therapy governance rejects a suggestion with no stable affected identifier", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { guideIds: [], graphNodeIds: [], promptContractIds: [], policySafetyGateIds: [] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 affected IDs for decision-1 do not match suggestion-r02-decision-1/);
});

test("therapy governance rejects packet-level findings absent from the review", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { packetLevelFindingIds: ["CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001", "PACKET-EXTRA-001"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 packet-level finding mapping does not match its artifact/);
});

test("therapy governance rejects a latest packet with no review event", async (t) => {
  const rootDir = await governanceFixture(t, { omitReviewEvent: true });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Expected exactly one review event for fixture-guides-r02-candidate; found 0/);
});

test("therapy governance rejects a latest packet with duplicate review events", async (t) => {
  const rootDir = await governanceFixture(t, { duplicateReviewEvent: true });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Expected exactly one review event for fixture-guides-r02-candidate; found 2/);
});

for (const { label, content } of [
  { label: "Source status:", content: "canonical packet evidence." },
  { label: "Limitation:", content: "the packet has not passed review." },
  { label: "Recommendation:", content: "wait for r03." },
  { label: "Reasoning:", content: "technical review must pass before an owner policy choice is actionable." }
]) {
  test(`therapy governance rejects empty ${label} content that would otherwise satisfy its decision-brief label`, async (t) => {
    const rootDir = await governanceFixture(t, {
      suggestionsTransform: (source) => source.replace(`${label} ${content}`, `${label}   `)
    });
    await assert.rejects(
      verifyTherapyGovernance({ rootDir }),
      new RegExp(`suggestion-r02-decision-1 has empty decision-brief element: ${label}`)
    );
  });
}

for (const { option, label, content } of [
  { option: "A", label: "Benefits:", content: "gains the proposed behavior." },
  { option: "A", label: "Costs:", content: "changes routing." },
  { option: "A", label: "Worst plausible failure:", content: decisionCardDetails["decision-1"].worstPlausibleFailure },
  { option: "B", label: "Benefits:", content: "avoids an unverified change." },
  { option: "B", label: "Costs:", content: "forgoes the candidate behavior." },
  { option: "B", label: "Worst plausible failure:", content: "a useful route remains unavailable." }
]) {
  test(`therapy governance rejects empty ${label} content in Option ${option}`, async (t) => {
    const rootDir = await governanceFixture(t, {
      suggestionsTransform: (source) => source.replace(`${label} ${content}`, `${label}   `)
    });
    await assert.rejects(
      verifyTherapyGovernance({ rootDir }),
      option === "A" && label === "Worst plausible failure:"
        ? /suggestion-r02-decision-1 Option A is missing decision-card field: Worst plausible failure:/
        : new RegExp(`suggestion-r02-decision-1 Option ${option} has empty decision-brief element: ${label}`)
    );
  });
}

test("therapy governance rejects an empty line-anchored Costs field despite Costs: prose in Benefits", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => source
      .replace("Benefits: gains the proposed behavior.", "Benefits: Mentioning Costs: here does not supply a cost.")
      .replace("Costs: changes routing.", "Costs:   ")
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /suggestion-r02-decision-1 Option A has empty decision-brief element: Costs:/
  );
});

test("therapy governance rejects an empty line-anchored Limitation field despite Limitation: prose in Source status", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => source
      .replace("Source status: canonical packet evidence.", "Source status: Mentioning Limitation: here does not supply a limitation.")
      .replace("Limitation: the packet has not passed review.", "Limitation:   ")
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /suggestion-r02-decision-1 has empty decision-brief element: Limitation:/
  );
});

test("therapy governance rejects a truncated governance marker instead of silently ignoring it", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => `${source}\n<!-- therapy-suggestion {"suggestionId":"truncated"`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS.*truncated therapy-suggestion marker/);
});

test("therapy governance rejects a dangling governance marker terminator", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => `${source}\n-->\n`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS.*dangling governance marker terminator/);
});

test("therapy governance rejects a multiply consumed nested governance marker", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => `${source}\n<!-- therapy-suggestion {"suggestionId":"outer"} <!-- therapy-suggestion {"suggestionId":"inner"} -->\n`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS.*multiply consumed governance marker/);
});

test("therapy governance rejects an unknown governance marker", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => `${source}\n${marker("therapy-owner-verdict", { id: "forbidden" })}\n`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS.*unknown governance marker therapy-owner-verdict/);
});

test("therapy governance rejects a whitespace-variant governance marker instead of silently ignoring it", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => `${source}\n<!--  therapy-suggestion {"suggestionId":"hidden"} -->\n`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS.*malformed therapy-suggestion marker/);
});

test("therapy governance rejects a valid marker in the wrong ledger", async (t) => {
  const rootDir = await governanceFixture(t, {
    decisionsLedger: `# Therapy decisions\n\n${suggestionBlock(decisions[0])}`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /THERAPY-DECISIONS.*therapy-suggestion marker is not allowed/);
});

test("therapy governance trims IDs before rejecting whitespace-only and duplicate values", async (t) => {
  const whitespaceRoot = await governanceFixture(t, { suggestionOverrides: { decisionId: "   " } });
  await assert.rejects(loadTherapyGovernance({ rootDir: whitespaceRoot }), /suggestion-r02-decision-1 has an invalid decisionId/);

  const duplicateRoot = await governanceFixture(t, {
    suggestionOverrides: { regressionIds: ["G-SOM-DELAYED", " G-SOM-DELAYED "] }
  });
  await assert.rejects(loadTherapyGovernance({ rootDir: duplicateRoot }), /suggestion-r02-decision-1 has duplicate regressionIds/);
});

test("therapy governance rejects foreign identity and decision-origin fields", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { approvalId: "foreign-approval", decisionSource: "model-review" }
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 contains forbidden field (approvalId|decisionSource)/);
});

test("therapy governance rejects inferred metadata on an explicit owner decision receipt", async (t) => {
  const fixture = await passedR03Fixture(t, { r03SuggestionOverrides: { status: "approved" } });
  await fs.writeFile(
    path.join(fixture.rootDir, "THERAPY-DECISIONS"),
    r03DecisionReceipt(decisions[0], fixture, { inferred: true, inferredFrom: "model-review" })
  );
  await fs.writeFile(path.join(fixture.rootDir, "APPROVED-THERAPY-LESSONS"), r03Approval());
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /decision-r03-decision-1 contains unsupported field (inferred|inferredFrom)/
  );
});

test("therapy governance rejects a newer candidate manifest whose decision-card file is missing", async (t) => {
  const rootDir = await governanceFixture(t, {
    fixtureTransform: async ({ fixtureRoot }) => {
      const candidateRoot = path.join(fixtureRoot, "guide-packets", "fixtures", "r03-broken");
      await fs.mkdir(candidateRoot, { recursive: true });
      const manifest = {
        status: "candidate",
        packetRevision: 3,
        packetId: "fixture-guides-r03-broken-candidate",
        createdAt: "2026-08-13T14:30:00.000Z",
        guides: [],
        paths: { ownerDecisions: "audit/owner-decisions.json" }
      };
      await fs.writeFile(path.join(candidateRoot, "fixture-guides-r03-broken-candidate.zip"), createStoredZip([
        { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` }
      ], new Date("2026-08-13T14:30:00.000Z")));
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /r03-broken.*missing audit\/owner-decisions\.json/
  );
});

test("therapy governance derives authoritative packet content from the hashed archive, not its mutable mirror", async (t) => {
  const forgedNodeId = "SOM.FORGED_MIRROR_ONLY";
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { graphNodeIds: [forgedNodeId] },
    reviewDiagnosticOverrides: {
      decisionAffectedIds: {
        ...affectedByDecision,
        "decision-1": { ...affectedByDecision["decision-1"], graphNodeIds: [forgedNodeId] }
      }
    },
    fixtureTransform: async ({ packetRoot }) => {
      const graphPath = path.join(packetRoot, "graphs", "somatic.graph.json");
      const graph = JSON.parse(await fs.readFile(graphPath, "utf8"));
      graph.nodes.push({ id: forgedNodeId });
      await fs.writeFile(graphPath, `${JSON.stringify(graph)}\n`);
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /unknown graph node identifier SOM\.FORGED_MIRROR_ONLY/
  );
});

test("therapy governance does not ignore an archive-only newer candidate", async (t) => {
  const rootDir = await governanceFixture(t, {
    fixtureTransform: async ({ fixtureRoot }) => {
      const candidateRoot = path.join(fixtureRoot, "guide-packets", "fixtures", "r99-archive-only");
      await fs.mkdir(candidateRoot, { recursive: true });
      const manifest = {
        status: "candidate",
        packetRevision: 99,
        packetId: "fixture-guides-r99-archive-only-candidate",
        createdAt: "2026-08-13T14:30:00.000Z",
        guides: [],
        paths: { ownerDecisions: "audit/owner-decisions.json" }
      };
      const archive = createStoredZip([
        { name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
        { name: "audit/owner-decisions.json", data: '{"cards":[]}\n' }
      ], new Date("2026-08-13T14:30:00.000Z"));
      await fs.writeFile(path.join(candidateRoot, "fixture-guides-r99-archive-only-candidate.zip"), archive);
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /Expected exactly one review event for fixture-guides-r99-archive-only-candidate; found 0/
  );
});

test("passed r03 fixture is a distinct archive with repaired cards, graph, provenance, and regression evidence", async (t) => {
  const fixture = await passedR03Fixture(t);
  const archive = await fs.readFile(path.join(
    fixture.rootDir,
    "guide-packets",
    "fixtures",
    "r03-candidate",
    "fixture-guides-r03-candidate.zip"
  ));
  const entries = readZipEntries(archive);
  const manifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  const cards = JSON.parse(entries.get("audit/owner-decisions.json").toString("utf8")).cards;
  const innerChildGraph = JSON.parse(entries.get("graphs/inner-child.graph.json").toString("utf8"));
  const provenance = JSON.parse(entries.get("policy/provenance.json").toString("utf8"));
  const crossGuide = JSON.parse(entries.get("graphs/cross-guide-edges.json").toString("utf8"));
  const safety = JSON.parse(entries.get("policy/vagal-safety-p5.json").toString("utf8"));
  const productPolicy = JSON.parse(entries.get("policy/app-owned-hypnosis-control.json").toString("utf8"));
  const a001 = JSON.parse(entries.get("tests/decision-cases/A001.json").toString("utf8"));
  const h001 = JSON.parse(entries.get("tests/decision-cases/H001.json").toString("utf8"));
  const advancedBlock = JSON.parse(entries.get("tests/decision-cases/G-SOM-ADVANCED-BLOCK.json").toString("utf8"));

  assert.equal(manifest.packetRevision, 3);
  const decision2 = cards.find(({ id }) => id === "decision-2");
  assert.equal(decision2.provenance, "canonical-source-prose-plus-installed-A001-language");
  assert.deepEqual(decision2.provenanceDetails.canonicalSourceRefs, ["IC.LOVE_UNSAFE"]);
  assert.deepEqual(decision2.provenanceDetails.installedWordingRefs, ["A001.INSTALLED.OPPORTUNITY"]);
  assert.deepEqual(decision2.provenanceDetails.proposedOwnerPolicyExtensions, ["safety", "money"]);
  assert.equal(decision2.provenanceDetails.ownerDecisionTiming, "after-deterministic-repair");
  assert.equal(cards.find(({ id }) => id === "decision-3").candidate, "Priority 96");
  assert.equal(innerChildGraph.nodes.find(({ id }) => id === "IC.BORROW_ONE_FUNCTION").priority, 96);
  assert.deepEqual(provenance.nodes["IC.AGE_RESPONSIBILITY_CLARIFICATION"].sourceRefs, ["IC.LOVE_UNSAFE", "A001.INSTALLED.OPPORTUNITY"]);
  assert.equal(provenance.nodes["SOM.ADVANCED_RELEASE_BLOCK"].certainty, "author-provided-not-independently-validated");
  assert.ok(crossGuide.edges.every(({ sourceRefs }) => sourceRefs.length >= 2));
  assert.equal(safety.independentlyValidated, false);
  assert.equal(safety.requiredEncoding.position, "lying-down-only");
  assert.deepEqual(safety.requiredEncoding.claimedRisks, ["syncope", "fall", "airway"]);
  assert.equal(safety.requiredEncoding.gentlerAlternative, "Bhramari");
  assert.equal(productPolicy.authority, "product-only-operational");
  assert.equal(productPolicy.therapeuticClaim, false);
  assert.ok(a001.assertions.some(({ expectedDeferNodes }) => expectedDeferNodes?.includes("IC.DEEP_CHILD_DIALOGUE")));
  assert.ok(h001.assertions.some(({ expected }) => expected === "unchanged"));
  assert.ok(advancedBlock.assertions.some(({ expectedBlockNode }) => expectedBlockNode === "SOM.ADVANCED_RELEASE_OPTIONAL"));
  assert.equal(await verifyTherapyGovernance({ rootDir: fixture.rootDir }).then(({ packetId: id }) => id), fixture.r03PacketId);
});

test("therapy governance does not accept a prompt contract declared only by an optional registry", async (t) => {
  const forgedContractId = "forged-contract-v9";
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { promptContractIds: [forgedContractId] },
    reviewDiagnosticOverrides: {
      decisionAffectedIds: {
        ...affectedByDecision,
        "decision-1": { ...affectedByDecision["decision-1"], promptContractIds: [forgedContractId] }
      }
    },
    fixtureTransform: async ({ fixtureRoot }) => {
      await fs.writeFile(
        path.join(fixtureRoot, "src", "contract-identifiers.json"),
        `${JSON.stringify({ promptContractIds: ["response-realization-v5", forgedContractId] })}\n`
      );
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /unknown prompt-contract identifier forged-contract-v9/
  );
});

test("therapy governance rejects orphan candidate history after a historical suggestion is deleted", async (t) => {
  const fixture = await passedR03Fixture(t);
  const suggestionsPath = path.join(fixture.rootDir, "SUGGESTED-THERAPY-LESSONS");
  const source = await fs.readFile(suggestionsPath, "utf8");
  await fs.writeFile(suggestionsPath, source.replace(/## decision-1[\s\S]*?(?=## decision-2)/, ""));
  await assert.rejects(
    verifyTherapyGovernance({ rootDir: fixture.rootDir }),
    /candidate-decision-1 requires exactly one retained suggestion; found 0/
  );
});

test("therapy governance rejects multiple owner protocol contracts", async (t) => {
  const rootDir = await governanceFixture(t, {
    agents: `# Repository instructions\n\n${ownerProtocol()}\n\n${ownerProtocolProse}\n\n${ownerProtocol({ schemaVersion: 999, rules: [] })}`
  });
  await assert.rejects(
    loadTherapyGovernance({ rootDir }),
    /AGENTS\.md must contain exactly one therapy-owner-decision-protocol contract; found 2/
  );
});

for (const rule of ownerProtocolRules) {
  test(`therapy governance rejects deletion of owner protocol rule ${rule}`, async (t) => {
    const rootDir = await governanceFixture(t, {
      agents: `# Repository instructions\n\n${ownerProtocol({ rules: ownerProtocolRules.filter((item) => item !== rule) })}\n\n${ownerProtocolProse}`
    });
    await assert.rejects(loadTherapyGovernance({ rootDir }), /does not contain the complete required rule set/);
  });
}

test("therapy governance rejects a changed owner protocol version", async (t) => {
  const rootDir = await governanceFixture(t, {
    agents: `# Repository instructions\n\n${ownerProtocol({ schemaVersion: 3 })}\n\n${ownerProtocolProse}`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /does not contain the complete required rule set/);
});

test("therapy governance rejects a review artifact checksum mismatch", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewArtifactTransform: (source) => source.replace("SRC-CITE-001 summary.", "Drifted summary.")
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 review artifact checksum mismatch/);
});

test("therapy governance rejects review artifact identity and chronology drift", async (t) => {
  const rootDir = await governanceFixture(t);
  await rewriteReviewDiagnostic({
    rootDir,
    relativePath: "docs/diagnostics/fixture-r02-review.json",
    eventId: "review-r02-live-rejection-20260813",
    transform: (diagnostic) => ({ ...diagnostic, occurredAt: "2026-08-13T14:31:27.000Z" })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 review artifact occurredAt does not match its event/
  );
});

test("therapy governance rejects review artifact packet revision and decision-card path drift", async (t) => {
  const rootDir = await governanceFixture(t);
  await rewriteReviewDiagnostic({
    rootDir,
    relativePath: "docs/diagnostics/fixture-r02-review.json",
    eventId: "review-r02-live-rejection-20260813",
    transform: (diagnostic) => ({
      ...diagnostic,
      packet: { ...diagnostic.packet, packetRevision: 99, decisionCardsPath: "audit/wrong.json" }
    })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 review artifact packet identity mismatch/
  );
});

test("therapy governance rejects incomplete authoritative affected-ID keys", async (t) => {
  const rootDir = await governanceFixture(t);
  await rewriteReviewDiagnostic({
    rootDir,
    relativePath: "docs/diagnostics/fixture-r02-review.json",
    eventId: "review-r02-live-rejection-20260813",
    transform: (diagnostic) => {
      const { "SRC-CITE-001": omitted, ...findingAffectedIds } = diagnostic.findingAffectedIds;
      return { ...diagnostic, findingAffectedIds };
    }
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 findingAffectedIds must contain exactly the artifact finding IDs/
  );
});

test("therapy governance rejects unresolved authoritative finding affected IDs", async (t) => {
  const rootDir = await governanceFixture(t);
  await rewriteReviewDiagnostic({
    rootDir,
    relativePath: "docs/diagnostics/fixture-r02-review.json",
    eventId: "review-r02-live-rejection-20260813",
    transform: (diagnostic) => ({
      ...diagnostic,
      findingAffectedIds: {
        ...diagnostic.findingAffectedIds,
        "SRC-CITE-001": { ...diagnostic.findingAffectedIds["SRC-CITE-001"], graphNodeIds: ["IC.DOES_NOT_EXIST"] }
      }
    })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 finding SRC-CITE-001 names unknown graph node identifier IC\.DOES_NOT_EXIST/
  );
});

test("therapy governance rejects authoritative single-decision finding scope outside its suggestion", async (t) => {
  const rootDir = await governanceFixture(t);
  await rewriteReviewDiagnostic({
    rootDir,
    relativePath: "docs/diagnostics/fixture-r02-review.json",
    eventId: "review-r02-live-rejection-20260813",
    transform: (diagnostic) => ({
      ...diagnostic,
      findingAffectedIds: {
        ...diagnostic.findingAffectedIds,
        "SRC-CITE-001": { ...diagnostic.findingAffectedIds["SRC-CITE-001"], graphNodeIds: ["IC.BORROW_ONE_FUNCTION"] }
      }
    })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /review-r02-live-rejection-20260813 finding SRC-CITE-001 affected scope exceeds decision-2/
  );
});

test("therapy governance rejects review mapping drift from the authoritative artifact", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewDiagnosticOverrides: {
      mappings: {
        suggestionFindings: { ...reviewFindingsByDecision, "decision-2": ["PRIORITY-TIE-001"] },
        packetLevelFindingIds,
        allowMultipleAssignmentsByFinding: {}
      }
    }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 suggestion finding mapping does not match its artifact/);
});

test("therapy governance rejects incompatible duplicate finding assignments", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { packetLevelFindingIds: [...packetLevelFindingIds, "SRC-CITE-001"] },
    reviewDiagnosticOverrides: {
      mappings: {
        suggestionFindings: reviewFindingsByDecision,
        packetLevelFindingIds: [...packetLevelFindingIds, "SRC-CITE-001"],
        allowMultipleAssignmentsByFinding: {}
      }
    }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Finding SRC-CITE-001 has incompatible duplicate assignments/);
});

test("therapy governance rejects passed-owner-gate with unresolved blockers", async (t) => {
  const passedOverrides = passedPacketSuggestionOverrides();
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate", nextPhase: "owner-decisions" },
    suggestionOverrides: passedOverrides["decision-1"],
    suggestionOverridesByDecision: passedOverrides
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /passed-owner-gate while (SRC-CITE-001|SAFETY-ENCODE-001) is unresolved/);
});

test("therapy governance rejects a rejected review whose material findings are all resolved", async (t) => {
  const rootDir = await governanceFixture(t, {
    resolveReviewFindings: true
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /rejected-before-owner-gate must retain at least one unresolved blocking or review finding/);
});

test("therapy governance rejects malformed authoritative finding disposition metadata", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewFindingsTransform: (findings) => findings.map((finding, index) => index === 0 ? { ...finding, severity: undefined } : finding)
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /SRC-CITE-001 has invalid severity/);
});

test("therapy governance rejects authoritative affected-ID drift from a suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewDiagnosticOverrides: {
      decisionAffectedIds: {
        ...affectedByDecision,
        "decision-1": { ...affectedByDecision["decision-1"], guideIds: ["inner-child"] }
      }
    }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 affected IDs for decision-1 do not match suggestion-r02-decision-1/);
});

test("therapy governance rejects a review event that predates suggestion creation", async (t) => {
  const rootDir = await governanceFixture(t);
  await rewriteReviewDiagnostic({
    rootDir,
    relativePath: "docs/diagnostics/fixture-r02-review.json",
    eventId: "review-r02-live-rejection-20260813",
    transform: (diagnostic) => ({ ...diagnostic, occurredAt: "2026-08-13T14:31:27.999Z" }),
    eventTransform: (metadata) => ({ ...metadata, occurredAt: "2026-08-13T14:31:27.999Z" })
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 predates suggestion-r02-decision-1/);
});

test("therapy governance rejects review outcome and readable body mismatch", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewBodyTransform: (source) => source.replace("Outcome: rejected-before-owner-gate", "Outcome: passed-owner-gate")
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review-r02-live-rejection-20260813 readable outcome does not match metadata/);
});

test("therapy governance rejects passed review bodies that retain rejection prose", async (t) => {
  const passedOverrides = passedPacketSuggestionOverrides();
  const rootDir = await governanceFixture(t, {
    resolveReviewFindings: true,
    reviewOverrides: { outcome: "passed-owner-gate", nextPhase: "owner-decisions" },
    reviewDiagnosticOverrides: { outcome: "passed-owner-gate", nextPhase: "owner-decisions" },
    reviewBodyTransform: (source) => `${source}\nThe packet remains rejected.\n`,
    suggestionOverrides: passedOverrides["decision-1"],
    suggestionOverridesByDecision: passedOverrides
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /passed-owner-gate review body retains rejection or repair state/);
});

for (const { name, transform, error } of [
  {
    name: "false activation",
    transform: (source) => source.replace('"lessonId":"candidate-decision-1"', '"lessonId":"candidate-decision-1"').replace('"activation":"candidate-awaiting-owner"', '"activation":"active-runtime"'),
    error: /candidate-decision-1 cannot activate candidate decision history/
  },
  {
    name: "candidate deletion",
    transform: (source) => source.replace(/## candidate-decision-1[\s\S]*?(?=## candidate-decision-2)/, ""),
    error: /suggestion-r02-decision-1 requires exactly one candidate history entry; found 0/
  },
  {
    name: "wrong packet candidate history",
    transform: (source) => source.replace('"packetId":"fixture-guides-r02-candidate"', '"packetId":"wrong-packet"'),
    error: /candidate-decision-1 requires exactly one retained suggestion; found 0/
  }
]) {
  test(`therapy governance rejects ${name} in immutable candidate history`, async (t) => {
    const rootDir = await governanceFixture(t, { historyTransform: transform });
    await assert.rejects(verifyTherapyGovernance({ rootDir }), error);
  });
}

test("therapy governance rejects any active history entry carrying candidate decision identity", async (t) => {
  const rootDir = await governanceFixture(t, {
    historyTransform: (source) => source.replace(
      '"lessonId":"active-one","learnedAt"',
      `"lessonId":"active-one","packetId":"${packetId}","decisionId":"decision-legacy","learnedAt"`
    )
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /active-one cannot activate candidate decision history/);
});

for (const { field, replacement, error } of [
  { field: "guideIds", replacement: ["missing-guide"], error: /unknown guide identifier missing-guide/ },
  { field: "graphNodeIds", replacement: ["MISSING.NODE"], error: /unknown graph node identifier MISSING.NODE/ },
  { field: "promptContractIds", replacement: ["missing-contract-v1"], error: /unknown prompt-contract identifier missing-contract-v1/ },
  { field: "policySafetyGateIds", replacement: ["MISSING.POLICY"], error: /unknown policy or safety-gate identifier MISSING.POLICY/ },
  { field: "regressionIds", replacement: ["MISSING-REGRESSION"], error: /unknown regression identifier MISSING-REGRESSION/ }
]) {
  test(`therapy governance rejects a nonexistent ${field} value against authoritative sources`, async (t) => {
    const rootDir = await governanceFixture(t, { suggestionOverrides: { [field]: replacement } });
    await assert.rejects(verifyTherapyGovernance({ rootDir }), error);
  });
}

for (const { name, override, error } of [
  { name: "packet digest", override: { packetDigest: "f".repeat(64) }, error: /packet digest does not match its immutable archive/ },
  { name: "decision-card digest", override: { decisionCardDigest: "f".repeat(64) }, error: /decision-card digest does not match decision-1/ }
]) {
  test(`therapy governance rejects ${name} drift`, async (t) => {
    const rootDir = await governanceFixture(t, { suggestionOverrides: override });
    await assert.rejects(verifyTherapyGovernance({ rootDir }), error);
  });
}

for (const { field, original, replacement } of [
  { field: "Decision-card title", original: decisionCardDetails["decision-1"].title, replacement: "Different title" },
  { field: "Behavioral effect", original: decisionCardDetails["decision-1"].behavioralEffect, replacement: "Different effect" },
  { field: "Provenance", original: decisionCardDetails["decision-1"].provenance, replacement: "model-inference" }
]) {
  test(`therapy governance requires exact decision-card ${field}`, async (t) => {
    const rootDir = await governanceFixture(t, {
      suggestionsTransform: (source) => source.replace(`${field}: ${original}`, `${field}: ${replacement}`)
    });
    await assert.rejects(verifyTherapyGovernance({ rootDir }), new RegExp(`${field} does not match decision-1`));
  });
}
