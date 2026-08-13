# Therapy Lesson Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make therapy-prompt learning auditable and enforce the distinction between chronological lessons, guide-impacting suggestions, and explicit owner approvals.

**Architecture:** Keep three human-readable root ledgers and validate their structured HTML-comment metadata against the latest bundled Guide Packet. Extend the existing Node.js verifier with focused parsing, latest-packet coverage, review-finding mapping, and approval-link functions; a root `AGENTS.md` marker and prose protocol enforce how agents must obtain decisions that static validation cannot prove occurred.

**Tech Stack:** Node.js 22 ESM, `node:test`, Markdown ledgers with JSON metadata comments, Bash package verification, Git.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-13-therapy-lesson-governance-design.md`.
- `THERAPY-LESSONS` is append-only chronological discovery, review, decision, and implementation history; it is not an approval ledger.
- `SUGGESTED-THERAPY-LESSONS` contains exactly one current suggestion for each substantive human decision in the latest bundled Guide Packet.
- `APPROVED-THERAPY-LESSONS` contains only decisions Joel explicitly approved in direct user conversation.
- No existing r02 candidate lesson becomes approved, implemented, active, or installable through this work.
- No model verdict, packet recommendation, silence, elapsed time, ledger edit, or suggested default counts as owner approval.
- Ask one substantive owner decision at a time unless Joel explicitly asks to bundle decisions.
- Every decision brief must state evidence and uncertainty, viable options, benefits, costs, worst plausible failure, the recommendation and its reasoning, and downstream guide/graph/prompt/regression effects.
- Never store a private therapy transcript in Git; store only concise policy decisions and their evidence.
- Preserve the immutable r01 and r02 Guide Packet archives and all current active runtime behavior.
- Use deterministic tests; do not weaken coverage or merely increase timeouts.

## File Structure

- `scripts/verify-therapy-lessons.mjs`: the sole parser and invariant checker for all three ledgers, the latest packet decision cards, cross-file approval state, and the `AGENTS.md` protocol marker.
- `tests/therapy-lessons.test.mjs`: isolated temporary-repository fixtures plus negative mutation tests for every governance invariant and one real-checkout CLI test.
- `THERAPY-LESSONS`: existing entries plus one timestamped r02 review-rejection event and plain-language next step.
- `SUGGESTED-THERAPY-LESSONS`: five current r02 suggestions, their review mappings, detailed decision briefs, and blocked state.
- `APPROVED-THERAPY-LESSONS`: contract header only; no r02 approval is fabricated.
- `AGENTS.md`: durable direct-owner decision protocol read by future agents.

---

### Task 1: Parse and validate the three ledger formats

**Files:**
- Modify: `tests/therapy-lessons.test.mjs`
- Modify: `scripts/verify-therapy-lessons.mjs`

**Interfaces:**
- Consumes: UTF-8 ledger strings from the repository root.
- Produces: `parseLedgerEntries({ source, fileName, marker, idField, timestampField, validateMetadata }) -> Array<{ metadata: object, body: string }>`.
- Produces: `assertRequiredSections({ fileName, id, body, sections }) -> void`.
- Produces: `loadTherapyGovernance({ rootDir }) -> { historyLessons, reviewEvents, suggestions, approvals }` without changing the existing CLI verifier until Task 4.
- Produces: globally unique `eventId`, `suggestionId`, and `approvalId` validation.

- [ ] **Step 1: Add valid three-ledger fixtures alongside the existing one-file fixture**

Define exact marker helpers and readable blocks in `tests/therapy-lessons.test.mjs`:

```js
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
```

Make a new `governanceFixture()` write `THERAPY-LESSONS`, `SUGGESTED-THERAPY-LESSONS`, `APPROVED-THERAPY-LESSONS`, and `AGENTS.md`. Include the existing active `therapy-lesson` entry, `reviewBlock()`, five `suggestionBlock()` values, a header-only approval ledger, and `<!-- therapy-owner-decision-protocol-v1 -->`. Give each temporary decision `affectedRegressions: regressionsByDecision[decision.id]`. Define `suggestionOverrides` to affect only `decision-1`, while `suggestionOverridesByDecision` applies keyed changes to other decisions; define `reviewOverrides`, `suggestionsTransform`, `omitSuggestionDecisionId`, and `duplicateSuggestionDecisionId` exactly as used below. Preserve the existing `fixture()` and its tests until Task 4 so every intermediate commit remains green.

- [ ] **Step 2: Add structural negative tests**

Add tests that mutate one invariant at a time and assert the exact ledger and entry are named:

```js
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

test("therapy governance rejects invalid timestamps and statuses", async (t) => {
  const rootDir = await governanceFixture(t, {
    suggestionOverrides: { createdAt: "2026-08-13", status: "almost-approved" }
  });
  await assert.rejects(loadTherapyGovernance({ rootDir }), /suggestion-r02-decision-1 has an invalid UTC createdAt/);
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
```

Split the timestamp and invalid-status assertions into separate tests so both failure paths execute.

- [ ] **Step 3: Run the new structural tests and verify RED**

Run: `node --test --test-name-pattern="missing ledger|malformed suggestion|invalid timestamps|invalid status|duplicate IDs|missing readable section|root owner protocol" tests/therapy-lessons.test.mjs`

Expected: FAIL because the current verifier reads only `THERAPY-LESSONS` and has no three-ledger parser or root protocol check.

- [ ] **Step 4: Implement the generic ledger parser and structural validators**

In `scripts/verify-therapy-lessons.mjs`, retain `validInstant()` and add these exact constants:

```js
const LEDGER_FILES = {
  history: "THERAPY-LESSONS",
  suggestions: "SUGGESTED-THERAPY-LESSONS",
  approvals: "APPROVED-THERAPY-LESSONS"
};
const SUGGESTION_STATUSES = new Set([
  "blocked-by-packet-review", "needs-technical-repair", "ready-for-owner",
  "approved", "implemented", "declined", "superseded"
]);
const APPROVAL_STATUSES = new Set(["approved-not-implemented", "implemented"]);
const SUGGESTION_SECTIONS = [
  "Proposal", "Guide impact", "Evidence and uncertainty", "Review result",
  "Why not active", "Technical next action", "Decision needed",
  "Options and trade-offs", "Recommendation and reasoning"
];
const APPROVAL_SECTIONS = [
  "Exact decision", "Owner reasoning or stated preference", "Scope and constraints",
  "Guide impact", "Implementation status", "Verification evidence"
];
const REVIEW_SECTIONS = [
  "Review outcome", "Why the packet was rejected", "What this does not mean",
  "Finding-to-suggestion mapping", "Packet-level findings", "Next phase"
];
```

Implement `readRequiredFile()` so `ENOENT` becomes `<filename> is required.` Implement `parseLedgerEntries()` by matching `<!-- <marker> {single-line JSON} -->`, taking the body through the next level-two heading or end of file, validating the configured ID and timestamp fields, and returning `{ metadata, body }`. `assertRequiredSections()` must require a non-empty `### <name>` body before the next level-three heading. Validate arrays of IDs as arrays of non-empty unique strings; validate suggestion and approval status sets; then validate global ID uniqueness and the `AGENTS.md` marker. Export `loadTherapyGovernance()` for focused unit tests, but leave `verifyTherapyLessons()` on its existing history-only path until the real ledgers are created in Task 4.

- [ ] **Step 5: Run structural tests and the existing active-lesson tests**

Run: `node --test tests/therapy-lessons.test.mjs`

Expected: all current tests PASS. The new tests exercise `loadTherapyGovernance()` against temporary roots; the unchanged real-checkout CLI path remains green until Task 4 atomically installs the new root ledgers and integration.

- [ ] **Step 6: Commit the structural parser**

```bash
git add scripts/verify-therapy-lessons.mjs tests/therapy-lessons.test.mjs
git commit -m "Enforce therapy ledger structure"
```

### Task 2: Enforce latest-packet suggestions and rejection mapping

**Files:**
- Modify: `tests/therapy-lessons.test.mjs`
- Modify: `scripts/verify-therapy-lessons.mjs`

**Interfaces:**
- Consumes: the latest candidate manifest and substantive decision cards returned by the existing `latestCandidate()` path.
- Consumes: parsed review events and suggestions from Task 1.
- Produces: `validateLatestPacket({ manifest, cards, reviewEvents, suggestions }) -> { reviewEvent, suggestionsByDecision }`.
- Produces: `verifyTherapyGovernance({ rootDir })` for temporary-root integration tests; Task 4 will call it from the CLI-facing `verifyTherapyLessons()`.

- [ ] **Step 1: Add packet-coverage and finding-mapping tests**

Add deterministic mutations for these exact failures:

```js
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
```

Also add separate negative tests for missing `Benefits:`, `Costs:`, `Worst plausible failure:`, `Recommendation:`, `Reasoning:`, `Source status:`, and `Limitation:` labels. Each assertion must identify the suggestion ID and the missing decision-brief element.

- [ ] **Step 2: Run packet-governance tests and verify RED**

Run: `node --test --test-name-pattern="latest-packet|rejected review|review findings|finding mappings|Benefits|Costs|Worst plausible|Recommendation|Reasoning|Source status|Limitation" tests/therapy-lessons.test.mjs`

Expected: FAIL because the structural parser does not yet connect suggestions and findings to the current packet.

- [ ] **Step 3: Implement latest-packet and decision-brief validation**

Implement `validateLatestPacket()` with these rules:

```js
const cards = decisions.cards.filter(
  (card) => card.classification === "substantive" && card.requiresHumanDecision === true
);
```

- Require exactly one review event for `manifest.packetId`; allow only `rejected-before-owner-gate` or `passed-owner-gate` so a later r03 can progress without weakening the gate.
- Require exactly one suggestion for every substantive card and reject latest-packet suggestions with unknown decision IDs.
- Require `ownerDecisionRequired: true`. When the latest event is rejected, permit only `blocked-by-packet-review` or `needs-technical-repair`; when it passes, prohibit those two statuses and permit `ready-for-owner`, `approved`, `implemented`, `declined`, or `superseded` subject to Task 3's approval matrix.
- Require `createdAt >= manifest.createdAt`.
- Require every `affectedRegressions` value from its decision card in `regressionIds`.
- Require at least one stable affected identifier across `guideIds`, `graphNodeIds`, and `promptIds`.
- Require `Source status:` and `Limitation:` in evidence, two option labels, `Benefits:`, `Costs:`, and `Worst plausible failure:` in trade-offs, plus distinct `Recommendation:` and `Reasoning:` labels.
- Compare sets so `reviewEvent.findingIds` exactly equals the union of every suggestion's `reviewFindingIds` and `reviewEvent.packetLevelFindingIds`; report the first missing or extra ID.

Return the selected event and a decision-indexed suggestion map for approval validation. `verifyTherapyGovernance()` must load the temporary-root ledgers, resolve the latest candidate, read its owner decisions, and call this function without yet replacing the CLI-facing history verifier.

- [ ] **Step 4: Run the complete focused test file**

Run: `node --test tests/therapy-lessons.test.mjs`

Expected: all structural and latest-packet tests PASS, and the existing real-checkout CLI test remains PASS on its history-only verifier path.

- [ ] **Step 5: Commit packet and review enforcement**

```bash
git add scripts/verify-therapy-lessons.mjs tests/therapy-lessons.test.mjs
git commit -m "Validate therapy review decision coverage"
```

### Task 3: Enforce explicit owner approvals and implementation evidence

**Files:**
- Modify: `tests/therapy-lessons.test.mjs`
- Modify: `scripts/verify-therapy-lessons.mjs`

**Interfaces:**
- Consumes: parsed suggestions and approvals plus the Task 2 decision-indexed suggestion map.
- Produces: `validateApprovalLinks({ suggestions, approvals }) -> void`.
- Approval metadata contract: `{ approvalId, suggestionId, decidedAt, decisionSource, implementationStatus, guideIds, implementationCommit? }`.

- [ ] **Step 1: Add approval fixtures and negative tests**

Use this exact valid approval block only inside temporary test fixtures; do not place it in the production approval ledger:

```js
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
```

Add tests for:

- orphan approval (`suggestionId: "missing-suggestion"`);
- duplicate approvals for one suggestion;
- `decisionSource: "model-review"`;
- approval linked to a `blocked-by-packet-review` suggestion;
- suggestion `approved` with no approval;
- approval `approved-not-implemented` paired with suggestion `implemented`;
- implemented approval missing `implementationCommit`;
- malformed commit identifier (accept only `/^[0-9a-f]{7,40}$/`);
- implemented approval whose `Verification evidence` is empty or says no evidence exists;
- suggestion `implemented` whose approval is not `implemented`;
- declined or superseded suggestion with an approval entry.

Assert messages such as:

```js
await assert.rejects(
  verifyTherapyGovernance({ rootDir }),
  /APPROVED-THERAPY-LESSONS approval-r02-decision-1 must use decisionSource direct-user-conversation/
);
```

- [ ] **Step 2: Run approval-link tests and verify RED**

Run: `node --test --test-name-pattern="approval|implemented|declined|superseded|decisionSource" tests/therapy-lessons.test.mjs`

Expected: FAIL because approval state is not linked to suggestion state.

- [ ] **Step 3: Implement cross-file approval invariants**

Implement this state matrix in `validateApprovalLinks()`:

| Suggestion status | Approval count | Required approval status |
|---|---:|---|
| `blocked-by-packet-review` | 0 | none |
| `needs-technical-repair` | 0 | none |
| `ready-for-owner` | 0 | none |
| `approved` | 1 | `approved-not-implemented` |
| `implemented` | 1 | `implemented` |
| `declined` | 0 | none |
| `superseded` | 0 | none |

Require `decisionSource === "direct-user-conversation"`. Require the approval's `guideIds` to be a non-empty subset of the suggestion's `guideIds`. For `implemented`, require a lowercase hexadecimal 7–40 character `implementationCommit` and substantive verification prose that does not match `/no (implementation )?evidence/i`. Reject orphan and duplicate links before applying the state matrix so failures identify the causal invariant.

- [ ] **Step 4: Run all focused tests**

Run: `node --test tests/therapy-lessons.test.mjs`

Expected: every test PASS; approval mutations run through `verifyTherapyGovernance()`, while the real-checkout CLI still uses the unchanged integration until Task 4.

- [ ] **Step 5: Commit approval enforcement**

```bash
git add scripts/verify-therapy-lessons.mjs tests/therapy-lessons.test.mjs
git commit -m "Require explicit therapy policy approvals"
```

### Task 4: Record the r02 rejection and current suggestion queue

**Files:**
- Create: `AGENTS.md`
- Modify: `THERAPY-LESSONS`
- Create: `SUGGESTED-THERAPY-LESSONS`
- Create: `APPROVED-THERAPY-LESSONS`
- Modify: `tests/therapy-lessons.test.mjs`

**Interfaces:**
- Consumes: the three metadata contracts and invariant functions completed in Tasks 1–3.
- Produces: a real checkout that passes `node scripts/verify-therapy-lessons.mjs` with five blocked suggestions, four active runtime lessons, one rejected review event, and zero approvals.

- [ ] **Step 1: Make the real-checkout CLI assertion strict and verify RED**

Change the existing CLI test to require:

```js
assert.match(result.stdout, /^PASS 5\/5 substantive therapy suggestions tracked for /);
assert.match(result.stdout, /4 active runtime lessons/);
assert.match(result.stdout, /5 blocked suggestions/);
assert.match(result.stdout, /0 explicit owner approvals/);
assert.match(result.stdout, /r02 rejection explained/);
```

Run: `node --test --test-name-pattern="covers every substantive decision" tests/therapy-lessons.test.mjs`

Expected: FAIL because the production root does not yet contain the suggestion and approval ledgers, protocol marker, or review event.

At the same time, replace the CLI-facing `verifyTherapyLessons()` history-only coverage logic with a call to `verifyTherapyGovernance({ rootDir })`, retaining the active-runtime count from parsed `therapy-lesson` history entries and returning `{ packetId, tracked, activeCount, suggestionCount, blockedCount, approvalCount, reviewEventId }`. This integration change is what makes the strict CLI test fail before Steps 2–5 add the production files.

- [ ] **Step 2: Add the root owner-decision protocol**

Create `AGENTS.md` beginning with:

```markdown
# Inner Signal Agent Instructions

<!-- therapy-owner-decision-protocol-v1 -->
```

Require future agents to read all three root ledgers before therapy or guide work. Encode the ten numbered direct-owner rules from the approved specification verbatim in substance: perform/separate deterministic repairs; ask Joel directly and one decision at a time; state why the decision is needed; classify evidence and limitations; give viable options with benefits, costs, and worst plausible failure; recommend with detailed reasoning; enumerate downstream guide/graph/prompt/safety/regression effects; state that no answer leaves policy unchanged; record only explicit answers; commit the ledger transition and tests. State that unavailable conversation leaves the suggestion pending and policy unchanged.

- [ ] **Step 3: Append the r02 review event to the history ledger**

Update the `THERAPY-LESSONS` introduction to say the file is chronological audit history, not approval state. Preserve every current `therapy-lesson` entry byte-for-byte below that introduction. Append `review-r02-live-rejection-20260813` at `2026-08-13T14:31:28.000Z` using all six review sections from Task 1 and this exact finding split:

```json
{
  "suggestionFindings": {
    "decision-1": [],
    "decision-2": ["SRC-CITE-001"],
    "decision-3": ["PRIORITY-TIE-001"],
    "decision-4": ["REG-EVIDENCE-001"],
    "decision-5": ["SAFETY-ENCODE-001", "EXT-VALID-001"]
  },
  "packetLevelFindingIds": [
    "CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001"
  ]
}
```

Explain plainly that r02 was rejected as an activatable packet, not that all five lessons were false. Separate deterministic r03 repairs (citation, cross-guide provenance, priority tie-break, regression evidence, certainty propagation, safety encoding) from later Joel decisions. State the next sequence: build repaired r03, independently review it, ask one decision at a time only after the owner gate, record explicit decisions, then implement and verify approved scope.

- [ ] **Step 4: Create the five blocked suggestion briefs**

Create `SUGGESTED-THERAPY-LESSONS` with one entry per row and every required readable section:

| Suggestion ID | Decision | Guide IDs | Graph nodes | Prompt IDs | Regressions | Review findings |
|---|---|---|---|---|---|---|
| `suggestion-r02-decision-1` | `decision-1` | `somatic` | `SOM.DELAYED_RESPONSE_REASSESSMENT` | none | `G-SOM-DELAYED` | none |
| `suggestion-r02-decision-2` | `decision-2` | `inner-child` | `IC.AGE_RESPONSIBILITY_CLARIFICATION` | `response-realization-v5` | `A001` | `SRC-CITE-001` |
| `suggestion-r02-decision-3` | `decision-3` | `inner-child` | `IC.BORROW_ONE_FUNCTION`, `IC.NEUTRAL_WITNESS` | `response-realization-v5`, `hypnosis-session-v3` | `A001`, `H001` | `PRIORITY-TIE-001` |
| `suggestion-r02-decision-4` | `decision-4` | `inner-child` | `IC.CREDIBILITY_REPAIR`, `IC.DEEP_CHILD_DIALOGUE` | `response-realization-v5` | `A001` | `REG-EVIDENCE-001` |
| `suggestion-r02-decision-5` | `decision-5` | `somatic` | `SOM.ADVANCED_RELEASE_BLOCK`, `SOM.ADVANCED_RELEASE_OPTIONAL` | `response-realization-v5` | `G-SOM-DELAYED`, `G-SOM-ADVANCED-BLOCK` | `SAFETY-ENCODE-001`, `EXT-VALID-001` |

Every metadata record uses `createdAt: "2026-08-13T14:31:28.000Z"`, `packetId: "inner-signal-guides-2026.08.12-r02-candidate"`, `status: "blocked-by-packet-review"`, and `ownerDecisionRequired: true`.

The prose must preserve these distinctions:

- Decision 1 had no lesson-specific finding; it is blocked only because the packet failed.
- Decision 2 must fix the wrong canonical citation before Joel decides whether “safety” and “money” should extend the source-supported list.
- Decision 3 must resolve the priority-95 tie deterministically; H001 app-owned hypnosis/waking-return policy remains a separate explicit owner-policy question.
- Decision 4 must add a mutation-sensitive A001 case proving that deep-child dialogue is actually deferred.
- Decision 5 must encode the lying-down-only constraint, contraindications, and gentler Bhramari alternative while labeling Vagal evidence author-provided and `independentlyValidated: false`; Joel later decides exact language and scope.
- `CROSS-GUIDE-001` and `OWNER-POLICY-001` are packet repairs; `COVERAGE-001` is future coverage information; `CERTAINTY-LAYER-001` is positive evidence, not a blocker.

Each options section presents “approve after a passing r03 review” and “retain current policy,” with concrete benefits, costs, and worst plausible failure. Each recommendation says to complete deterministic r03 repair first; it must not recommend pretending the owner already answered.

- [ ] **Step 5: Create an intentionally empty approval ledger**

Create `APPROVED-THERAPY-LESSONS` with the title, contract explanation, and this explicit statement:

```markdown
No therapy-policy suggestions are approved as of 2026-08-13T14:31:28.000Z. The governance design approval does not approve any r02 lesson. The first `therapy-approval` entry may be added only after Joel answers a specific decision brief directly in the active conversation.
```

Do not add a `therapy-approval` metadata comment.

- [ ] **Step 6: Run the focused verifier repeatedly**

Run three separate times:

```bash
node --test tests/therapy-lessons.test.mjs
node --test tests/therapy-lessons.test.mjs
node --test tests/therapy-lessons.test.mjs
```

Expected each time: all tests PASS, including the real-checkout CLI assertion. Then run `npm run therapy-lessons:verify`; expect `PASS 5/5`, four active runtime lessons, five blocked suggestions, zero explicit owner approvals, and an explained r02 rejection.

- [ ] **Step 7: Commit the ledgers and owner protocol**

```bash
git add AGENTS.md THERAPY-LESSONS SUGGESTED-THERAPY-LESSONS APPROVED-THERAPY-LESSONS tests/therapy-lessons.test.mjs
git commit -m "Record enforceable therapy lesson governance"
```

### Task 5: Run repository-wide verification and preserve the audit trail

**Files:**
- Verify only: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: the completed governance implementation.
- Produces: fresh local evidence that focused tests, the complete npm suite, all repository verification gates, immutable Guide Packet archives, and Git integrity pass together.

- [ ] **Step 1: Check formatting, syntax, and focused behavior**

Run:

```bash
git diff --check HEAD~4
node --check scripts/verify-therapy-lessons.mjs
node --test tests/therapy-lessons.test.mjs
npm run therapy-lessons:verify
```

Expected: every command exits 0; the verifier reports five blocked suggestions and zero approvals.

- [ ] **Step 2: Run the complete npm test suite**

Run: `npm test`

Expected: all tests PASS with zero skipped governance tests and no process/port leaks.

- [ ] **Step 3: Run every repository verification and release gate**

Run: `npm run verify`

Expected: the therapy governance gate, graph compile, graph regressions, both immutable Guide Packet builds/verifications, syntax checks, full automated tests, archive hashes, mock A001, mock H001, web smoke, autopilot dry run, and fake-CLI smoke all PASS.

- [ ] **Step 4: Verify the final Git state**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git diff --check origin/stable..HEAD
```

Expected: no uncommitted changes; the local `stable` branch contains the approved-spec commit, implementation-plan commit, and four governance implementation commits. Do not push or publish unless Joel separately requests it.

- [ ] **Step 5: Report the policy boundary and next work**

Report exact test counts and commit IDs. State that governance is implemented but r02 remains rejected and uninstalled, all five suggestions remain blocked, and `APPROVED-THERAPY-LESSONS` remains empty. The next separate project is deterministic r03 repair; after r03 passes review, ask Joel the first decision directly with its full pros/cons brief.
