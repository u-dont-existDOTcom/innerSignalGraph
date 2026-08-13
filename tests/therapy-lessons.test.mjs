import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadTherapyGovernance, verifyTherapyLessons } from "../scripts/verify-therapy-lessons.mjs";

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
    reviewFindingIds: [],
    ownerDecisionRequired: true,
    guideIds: ["inner-child"],
    graphNodeIds: [`NODE.${decision.id}`],
    promptIds: [],
    regressionIds: decision.affectedRegressions,
    ...overrides
  };
  return `## ${decision.id}\n\n${marker("therapy-suggestion", metadata)}\n\n### Proposal\n\nKeep this exact candidate change pending.\n\n### Guide impact\n\nGuide: inner-child. Graph node: NODE.${decision.id}. Prompt: none. Regression: ${decision.affectedRegressions.join(", ")}.\n\n### Evidence and uncertainty\n\nSource status: canonical packet evidence. Limitation: the packet has not passed review.\n\n### Review result\n\nThe enclosing r02 packet was rejected before the owner gate.\n\n### Why not active\n\nIt has neither a passing packet nor an explicit owner decision.\n\n### Technical next action\n\nCarry the corrected proposal into r03 and rerun its regression.\n\n### Decision needed\n\nAfter r03 passes review, Joel must explicitly approve or decline this proposal.\n\n### Options and trade-offs\n\nOption A — approve after repair. Benefits: gains the proposed behavior. Costs: changes routing. Worst plausible failure: the route activates incorrectly.\n\nOption B — retain current policy. Benefits: avoids an unverified change. Costs: forgoes the candidate behavior. Worst plausible failure: a useful route remains unavailable.\n\n### Recommendation and reasoning\n\nRecommendation: wait for r03. Reasoning: technical review must pass before an owner policy choice is actionable.\n`;
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
    .map((decision) => suggestionBlock(decision, {
      ...(decision.id === "decision-1" ? suggestionOverrides : {}),
      ...(suggestionOverridesByDecision[decision.id] ?? {})
    }));
  if (duplicateSuggestionDecisionId) {
    const decision = governanceDecisions.find((item) => item.id === duplicateSuggestionDecisionId);
    selectedSuggestions.push(suggestionBlock(decision, suggestionOverridesByDecision[decision.id] ?? {}));
  }
  const suggestionSource = suggestions ?? `# Suggested therapy lessons\n\n${reviewBlock(reviewOverrides)}\n${selectedSuggestions.join("\n")}`;
  await Promise.all([
    fs.writeFile(path.join(fixtureRoot, "THERAPY-LESSONS"), `# Therapy lessons\n\n${marker("therapy-lesson", validEntries()[0])}\n`),
    fs.writeFile(path.join(fixtureRoot, "SUGGESTED-THERAPY-LESSONS"), suggestionsTransform(suggestionSource)),
    fs.writeFile(path.join(fixtureRoot, "APPROVED-THERAPY-LESSONS"), approvals),
    fs.writeFile(path.join(fixtureRoot, "AGENTS.md"), agents)
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
