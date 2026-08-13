import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as therapyGovernance from "../scripts/verify-therapy-lessons.mjs";

const { loadTherapyGovernance, verifyTherapyGovernance, verifyTherapyLessons } = therapyGovernance;

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packetId = "fixture-guides-r02-candidate";
const createdAt = "2026-08-12T02:45:00.000Z";
const decisions = Array.from({ length: 5 }, (_, index) => ({
  id: `decision-${index + 1}`,
  classification: "substantive",
  requiresHumanDecision: true,
  status: "pending"
}));

function metadata(entry) {
  return `<!-- therapy-lesson ${JSON.stringify(entry)} -->`;
}

function marker(kind, entry) {
  return `<!-- ${kind} ${JSON.stringify(entry)} -->`;
}

const regressionsByDecision = {
  "decision-1": ["G-SOM-DELAYED"],
  "decision-2": ["A001"],
  "decision-3": ["A001", "H001"],
  "decision-4": ["A001"],
  "decision-5": ["G-SOM-DELAYED", "G-SOM-ADVANCED-BLOCK"]
};

const reviewFindingsByDecision = {
  "decision-1": ["SAFETY-ENCODE-001", "EXT-VALID-001"],
  "decision-2": ["SRC-CITE-001"],
  "decision-3": ["REG-EVIDENCE-001"],
  "decision-4": ["PRIORITY-TIE-001"],
  "decision-5": []
};

function reviewBlock(overrides = {}) {
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
    packetLevelFindingIds: [
      "CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001"
    ],
    nextPhase: "repair-r03",
    ...overrides
  };
  return `## r02 live review was rejected before owner approval\n\n${marker("therapy-review-event", event)}\n\n### Review outcome\n\nThe candidate packet was rejected.\n\n### Why the packet was rejected\n\nSafety encoding and review evidence were incomplete.\n\n### What this does not mean\n\nThe five suggestions were not all judged false.\n\n### Finding-to-suggestion mapping\n\nEvery lesson-specific finding is mapped below.\n\n### Packet-level findings\n\nCross-guide and owner-policy remediation remains.\n\n### Next phase\n\nRepair r03, review it, and only then ask Joel directly.\n`;
}

function suggestionBlock(decision, overrides = {}) {
  const metadata = {
    suggestionId: `suggestion-r02-${decision.id}`,
    createdAt: "2026-08-13T14:31:28.000Z",
    packetId,
    decisionId: decision.id,
    status: "blocked-by-packet-review",
    reviewFindingIds: reviewFindingsByDecision[decision.id],
    ownerDecisionRequired: true,
    guideIds: ["inner-child"],
    graphNodeIds: [`NODE.${decision.id}`],
    promptIds: [],
    regressionIds: decision.affectedRegressions,
    ...overrides
  };
  return `## ${decision.id}\n\n${marker("therapy-suggestion", metadata)}\n\n### Proposal\n\nKeep this exact candidate change pending.\n\n### Guide impact\n\nGuide: inner-child. Graph node: NODE.${decision.id}. Prompt: none. Regression: ${decision.affectedRegressions.join(", ")}.\n\n### Evidence and uncertainty\n\nSource status: canonical packet evidence.\nLimitation: the packet has not passed review.\n\n### Review result\n\nThe enclosing r02 packet was rejected before the owner gate.\n\n### Why not active\n\nIt has neither a passing packet nor an explicit owner decision.\n\n### Technical next action\n\nCarry the corrected proposal into r03 and rerun its regression.\n\n### Decision needed\n\nAfter r03 passes review, Joel must explicitly approve or decline this proposal.\n\n### Options and trade-offs\n\nOption A — approve after repair.\nBenefits: gains the proposed behavior.\nCosts: changes routing.\nWorst plausible failure: the route activates incorrectly.\n\nOption B — retain current policy.\nBenefits: avoids an unverified change.\nCosts: forgoes the candidate behavior.\nWorst plausible failure: a useful route remains unavailable.\n\n### Recommendation and reasoning\n\nRecommendation: wait for r03.\nReasoning: technical review must pass before an owner policy choice is actionable.\n`;
}

function approvalBlock(overrides = {}) {
  const metadata = {
    approvalId: "approval-r02-decision-1",
    suggestionId: "suggestion-r02-decision-1",
    decidedAt: "2026-08-13T15:00:00.000Z",
    decisionSource: "direct-user-conversation",
    implementationStatus: "approved-not-implemented",
    guideIds: ["somatic"],
    ...overrides
  };
  return `## Approve delayed reassessment\n\n${marker("therapy-approval", metadata)}\n\n### Exact decision\n\nApprove the bounded policy represented by the linked suggestion.\n\n### Owner reasoning or stated preference\n\nThe owner explicitly selected the proposed behavior.\n\n### Scope and constraints\n\nOnly the linked guide and reviewed regression scope.\n\n### Guide impact\n\nSomatic guide and delayed reassessment node.\n\n### Implementation status\n\nApproved but not implemented.\n\n### Verification evidence\n\nNo implementation evidence is claimed yet.\n`;
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

async function fixture(t, { entries = validEntries(), raw = null } = {}) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-therapy-lessons-"));
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  const packetRoot = path.join(fixtureRoot, "guide-packets", "fixtures", "r02-candidate", "packet");
  await fs.mkdir(path.join(packetRoot, "audit"), { recursive: true });
  await fs.writeFile(path.join(packetRoot, "manifest.json"), `${JSON.stringify({
    status: "candidate",
    packetRevision: 2,
    packetId,
    createdAt,
    paths: { ownerDecisions: "audit/owner-decisions.json" }
  }, null, 2)}\n`);
  await fs.writeFile(path.join(packetRoot, "audit", "owner-decisions.json"), `${JSON.stringify({ cards: decisions }, null, 2)}\n`);
  await fs.writeFile(path.join(fixtureRoot, "THERAPY-LESSONS"), raw ?? `${entries.map(metadata).join("\n")}\n`);
  return fixtureRoot;
}

async function governanceFixture(t, {
  reviewOverrides = {},
  suggestionOverrides = {},
  suggestionOverridesByDecision = {},
  suggestions = null,
  suggestionsTransform = (source) => source,
  omitSuggestionDecisionId = null,
  duplicateSuggestionDecisionId = null,
  omitReviewEvent = false,
  duplicateReviewEvent = false,
  approvals = "# Approved therapy lessons\n",
  agents = "# Repository instructions\n\n<!-- therapy-owner-decision-protocol-v1 -->\n"
} = {}) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-therapy-governance-"));
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
  const governanceDecisions = decisions.map((decision) => ({
    ...decision,
    affectedRegressions: regressionsByDecision[decision.id]
  }));
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
  const reviewSource = omitReviewEvent ? "" : [
    reviewBlock(reviewOverrides),
    duplicateReviewEvent ? reviewBlock({ eventId: "review-r02-live-rejection-duplicate" }) : ""
  ].join("\n");
  const suggestionSource = suggestions ?? `# Suggested therapy lessons\n\n${reviewSource}\n${selectedSuggestions.join("\n")}`;
  const packetRoot = path.join(fixtureRoot, "guide-packets", "fixtures", "r02-candidate", "packet");
  await Promise.all([
    fs.mkdir(path.join(packetRoot, "audit"), { recursive: true }),
    fs.writeFile(path.join(fixtureRoot, "THERAPY-LESSONS"), `# Therapy lessons\n\n${marker("therapy-lesson", validEntries()[0])}\n`),
    fs.writeFile(path.join(fixtureRoot, "SUGGESTED-THERAPY-LESSONS"), suggestionsTransform(suggestionSource)),
    fs.writeFile(path.join(fixtureRoot, "APPROVED-THERAPY-LESSONS"), approvals),
    fs.writeFile(path.join(fixtureRoot, "AGENTS.md"), agents)
  ]);
  await Promise.all([
    fs.writeFile(path.join(packetRoot, "manifest.json"), `${JSON.stringify({
      status: "candidate",
      packetRevision: 2,
      packetId,
      createdAt,
      paths: { ownerDecisions: "audit/owner-decisions.json" }
    }, null, 2)}\n`),
    fs.writeFile(path.join(packetRoot, "audit", "owner-decisions.json"), `${JSON.stringify({ cards: governanceDecisions }, null, 2)}\n`)
  ]);
  return fixtureRoot;
}

test("therapy lesson log covers every substantive decision in the latest uploaded guide candidate", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/verify-therapy-lessons.mjs"], {
    cwd: root
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error?.code ?? 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? error?.message ?? "" })
  );
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^PASS 5\/5 substantive therapy prompt lessons tracked for /);
});

test("therapy lesson identity is scoped by packet as the cumulative log gains a new revision", async (t) => {
  const entries = validEntries();
  entries.push({
    lessonId: "older-packet-decision-one",
    decisionId: "decision-1",
    packetId: "fixture-guides-r01-candidate",
    learnedAt: createdAt,
    activation: "candidate-awaiting-owner"
  });
  const result = await verifyTherapyLessons({ rootDir: await fixture(t, { entries }) });
  assert.equal(result.tracked, 5);
});

test("therapy lesson validation rejects a missing substantive decision", async (t) => {
  const rootDir = await fixture(t, { entries: validEntries().filter((entry) => entry.decisionId !== "decision-2") });
  await assert.rejects(verifyTherapyLessons({ rootDir }), /decision-2; found 0/);
});

test("therapy lesson validation rejects a duplicate substantive decision", async (t) => {
  const entries = validEntries();
  entries.push({ ...entries[1], lessonId: "duplicate-decision-one" });
  await assert.rejects(verifyTherapyLessons({ rootDir: await fixture(t, { entries }) }), /decision-1; found 2/);
});

test("therapy lesson validation rejects malformed metadata", async (t) => {
  await assert.rejects(verifyTherapyLessons({
    rootDir: await fixture(t, { raw: '<!-- therapy-lesson {"lessonId":} -->\n' })
  }), /Malformed therapy lesson metadata/);
});

test("therapy lesson validation rejects a wrong packet identity", async (t) => {
  const entries = validEntries();
  entries[1] = { ...entries[1], packetId: "wrong-packet" };
  await assert.rejects(verifyTherapyLessons({ rootDir: await fixture(t, { entries }) }), /decision-1 names the wrong Guide Packet/);
});

test("therapy lesson validation rejects a pending decision marked active", async (t) => {
  const entries = validEntries();
  entries[1] = { ...entries[1], activation: "active-runtime" };
  await assert.rejects(verifyTherapyLessons({ rootDir: await fixture(t, { entries }) }), /decision-1 is falsely marked active-runtime/);
});

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

test("therapy governance rejects duplicate suggestion IDs despite extraneous approval IDs", async (t) => {
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
  await assert.rejects(loadTherapyGovernance({ rootDir }), /Duplicate therapy governance ID: suggestion-r02-decision-1/);
});

test("therapy governance rejects duplicate approval IDs despite extraneous event IDs", async (t) => {
  const rootDir = await governanceFixture(t, {
    approvals: `${approvalBlock({ eventId: "foreign-approval-original" })}\n${approvalBlock({ eventId: "foreign-approval-duplicate" })}`
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /Duplicate therapy governance ID: approval-r02-decision-1/);
});

test("therapy governance rejects a missing readable section", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionsTransform: (source) => source.replace("### Evidence and uncertainty", "### Evidence")
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /SUGGESTED-THERAPY-LESSONS suggestion-r02-decision-1 is missing section: Evidence and uncertainty/);
});

test("therapy governance requires the root owner protocol marker", async (t) => {
  const rootDir = await governanceFixture(t, { agents: "# Repository instructions\n" });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /AGENTS.md is missing therapy-owner-decision-protocol-v1/);
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
  { entry: "suggestion-r02-decision-1", field: "promptIds", fixtureOption: "suggestionOverrides" },
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
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Expected exactly one suggestion for decision-2; found 0/);
});

test("therapy governance rejects a duplicate latest-packet suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    duplicateSuggestionDecisionId: "decision-1"
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Expected exactly one suggestion for decision-1; found 2/);
});

test("therapy governance rejects an unknown latest-packet decision", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { decisionId: "decision-unknown" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Unknown latest-packet therapy decision: decision-unknown/);
});

test("therapy governance rejects a suggestion naming the wrong packet", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { packetId: "wrong-packet" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /decision-1 names the wrong Guide Packet/);
});

test("therapy governance requires one rejected review event for the latest packet", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "accepted" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /review event has invalid outcome: accepted/);
});

test("therapy governance rejects unmapped review findings", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { findingIds: ["UNMAPPED-001"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Review finding UNMAPPED-001 is not mapped to a suggestion or packet-level remediation/);
});

test("therapy governance rejects finding mappings absent from the review", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { reviewFindingIds: ["NOT-IN-REVIEW-001"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Suggestion finding NOT-IN-REVIEW-001 is absent from the latest review event/);
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
      new RegExp(`suggestion-r02-decision-1 is missing decision-brief element: ${label}`)
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

function implementedApprovalBlock(overrides = {}) {
  return approvalBlock({
    implementationStatus: "implemented",
    implementationCommit: "a1b2c3d",
    ...overrides
  })
    .replace("Approved but not implemented.", "Implemented in the linked revision.")
    .replace("No implementation evidence is claimed yet.", "The focused regression suite passed after the implementation change.");
}

test("therapy governance accepts passed-owner-gate suggestions that are ready for the owner", async (t) => {
  const passedOverrides = passedPacketSuggestionOverrides();
  const result = await verifyTherapyGovernance({ rootDir: await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: passedOverrides["decision-1"],
    suggestionOverridesByDecision: passedOverrides
  }) });
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
  const overrides = ownerApprovedSuggestionOverrides();
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: approvalBlock({ decisionSource: "model-review" })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /APPROVED-THERAPY-LESSONS approval-r02-decision-1 must use decisionSource direct-user-conversation/
  );
});

test("therapy governance rejects an approval for a packet-blocked suggestion", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { guideIds: ["somatic"] },
    approvals: approvalBlock()
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /SUGGESTED-THERAPY-LESSONS suggestion-r02-decision-1 with status blocked-by-packet-review must not have an approval/
  );
});

test("therapy governance requires an approval for an approved suggestion", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides();
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /SUGGESTED-THERAPY-LESSONS suggestion-r02-decision-1 with status approved requires exactly one approval/
  );
});

test("therapy governance requires implemented suggestions to have implemented approvals", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ status: "implemented" });
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: approvalBlock()
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }),
    /SUGGESTED-THERAPY-LESSONS suggestion-r02-decision-1 with status implemented requires an implemented approval/
  );
});

test("therapy governance requires an implementation commit for implemented approvals", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ status: "implemented" });
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: implementedApprovalBlock({ implementationCommit: undefined })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }), /approval-r02-decision-1 must provide a valid implementationCommit/
  );
});

test("therapy governance rejects malformed implementation commit identifiers", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ status: "implemented" });
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: implementedApprovalBlock({ implementationCommit: "A1B2C3D" })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }), /approval-r02-decision-1 must provide a valid implementationCommit/
  );
});

test("therapy governance rejects implemented approvals that claim no verification evidence", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ status: "implemented" });
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: approvalBlock({ implementationStatus: "implemented", implementationCommit: "a1b2c3d" })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }), /approval-r02-decision-1 must include substantive implementation verification evidence/
  );
});

test("therapy governance requires implemented approvals to have nonempty verification evidence", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ status: "implemented" });
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: implementedApprovalBlock().replace("The focused regression suite passed after the implementation change.", "")
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }), /APPROVED-THERAPY-LESSONS approval-r02-decision-1 is missing section: Verification evidence/
  );
});

for (const status of ["declined", "superseded"]) {
  test(`therapy governance rejects an approval for a ${status} suggestion`, async (t) => {
    const overrides = ownerApprovedSuggestionOverrides({ status });
    const rootDir = await governanceFixture(t, {
      reviewOverrides: { outcome: "passed-owner-gate" },
      suggestionOverrides: overrides["decision-1"],
      suggestionOverridesByDecision: overrides,
      approvals: approvalBlock()
    });
    await assert.rejects(
      verifyTherapyGovernance({ rootDir }),
      new RegExp(`SUGGESTED-THERAPY-LESSONS suggestion-r02-decision-1 with status ${status} must not have an approval`)
    );
  });
}

test("therapy governance requires approval guide IDs to be a nonempty subset of the suggestion guide IDs", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ guideIds: ["somatic"] });
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: approvalBlock({ guideIds: ["inner-child"] })
  });
  await assert.rejects(
    verifyTherapyGovernance({ rootDir }), /approval-r02-decision-1 guideIds must be a nonempty subset of suggestion-r02-decision-1 guideIds/
  );
});

test("therapy governance accepts a direct owner approval for an approved suggestion", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides();
  const result = await verifyTherapyGovernance({ rootDir: await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: approvalBlock()
  }) });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "approved");
});

test("therapy governance accepts implemented suggestions with substantive implementation evidence", async (t) => {
  const overrides = ownerApprovedSuggestionOverrides({ status: "implemented" });
  const result = await verifyTherapyGovernance({ rootDir: await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: overrides["decision-1"],
    suggestionOverridesByDecision: overrides,
    approvals: implementedApprovalBlock()
  }) });
  assert.equal(result.suggestionsByDecision.get("decision-1").metadata.status, "implemented");
});

test("therapy governance rejects a ready-for-owner status while its packet remains rejected", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { status: "ready-for-owner" }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has invalid status for a rejected packet/);
});

test("therapy governance rejects a blocked status after its packet passes owner gate", async (t) => {
  const passedOverrides = passedPacketSuggestionOverrides();
  passedOverrides["decision-1"] = { status: "blocked-by-packet-review" };
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { outcome: "passed-owner-gate" },
    suggestionOverrides: passedOverrides["decision-1"],
    suggestionOverridesByDecision: passedOverrides
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has invalid status for a passed packet/);
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
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 is missing affected regression: G-SOM-DELAYED/);
});

test("therapy governance rejects a suggestion with no stable affected identifier", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { guideIds: [], graphNodeIds: [], promptIds: [] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has no stable affected identifier/);
});

test("therapy governance rejects packet-level findings absent from the review", async (t) => {
  const rootDir = await governanceFixture(t, {
    reviewOverrides: { packetLevelFindingIds: ["CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001", "PACKET-EXTRA-001"] }
  });
  await assert.rejects(verifyTherapyGovernance({ rootDir }), /Packet-level finding PACKET-EXTRA-001 is absent from the latest review event/);
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
  { option: "A", label: "Worst plausible failure:", content: "the route activates incorrectly." },
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
      new RegExp(`suggestion-r02-decision-1 Option ${option} has empty decision-brief element: ${label}`)
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
