# Therapy Lesson Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make therapy-prompt learning auditable and enforce the distinction between chronological history, guide-impacting suggestions, explicit owner decision receipts, and approval implementation views.

**Architecture:** Keep four human-readable root ledgers and validate their structured HTML-comment metadata against every retained suggestion's packet, card, review event, and authoritative review artifact, while separately enforcing latest-packet coverage. `THERAPY-DECISIONS` is the source of explicit approve/decline receipts; `APPROVED-THERAPY-LESSONS` is an approve-only implementation projection. Extend the Node.js verifier with strict marker parsing, immutable-evidence binding, state transitions, identifier resolution, and real Git implementation checks; a versioned structured root `AGENTS.md` contract enforces how agents must obtain decisions that static validation cannot prove occurred.

**Tech Stack:** Node.js 22 ESM, `node:test`, Markdown ledgers with JSON metadata comments, Bash package verification, Git.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-13-therapy-lesson-governance-design.md`.
- `THERAPY-LESSONS` is append-only chronological discovery, review, and implementation audit history; it is never approval authority.
- `SUGGESTED-THERAPY-LESSONS` contains exactly one current suggestion for each substantive human decision in the latest bundled Guide Packet.
- `THERAPY-DECISIONS` contains append-only structured receipts only for choices Joel explicitly made in direct active conversation: one exact approve receipt for an approval, or one exact decline receipt with no approval projection for a decline.
- `APPROVED-THERAPY-LESSONS` is an approve-only implementation view; every entry links to exactly one approving decision receipt.
- Technical supersession is receipt-free and requires structured transition metadata plus a compatible `supersededBy` replacement link.
- No existing r02 candidate lesson becomes approved, implemented, active, or installable through this work.
- No model verdict, packet recommendation, silence, elapsed time, ledger edit, or suggested default counts as owner approval.
- Ask one substantive owner decision at a time unless Joel explicitly asks to bundle decisions.
- Every decision brief must state evidence and uncertainty, viable options, benefits, costs, worst plausible failure, the recommendation and its reasoning, and downstream guide/graph/prompt-contract/policy-or-safety-gate/regression effects.
- Never store a private therapy transcript in Git; store only concise policy decisions and their evidence.
- Preserve the immutable r01 and r02 Guide Packet archives and all current active runtime behavior.
- Use deterministic tests; do not weaken coverage or merely increase timeouts.

## Owner-approved amendment history

- 2026-08-13: The original design and implementation plan were approved and implemented through `f47a0ca` before the decision-receipt amendment.
- 2026-08-13: Joel approved a fourth root ledger, `THERAPY-DECISIONS`, to separate durable approve/decline receipts from the approval-only implementation view. The governance-design approval does not create a therapy-policy receipt. Production remains at five blocked r02 suggestions with zero decision receipts, approvals, or implementations while this amendment is implemented.

## File Structure

- `scripts/verify-therapy-lessons.mjs`: the sole parser and invariant checker for all four ledgers, retained-packet decision cards and review artifacts, cross-file decision/approval/implementation state, authoritative identifiers derived from hashed packet ZIP members and actual source contracts, Git evidence, and the single versioned `AGENTS.md` protocol contract.
- `tests/therapy-lessons.test.mjs`: isolated temporary-repository fixtures plus negative mutation tests for every governance invariant and one real-checkout CLI test.
- `THERAPY-LESSONS`: existing entries plus one timestamped r02 review-rejection event and plain-language next step.
- `SUGGESTED-THERAPY-LESSONS`: five current r02 suggestions, their review mappings, detailed decision briefs, and blocked state.
- `THERAPY-DECISIONS`: contract header only; no r02 owner choice is fabricated.
- `APPROVED-THERAPY-LESSONS`: approve-only implementation-view contract header; no r02 approval is fabricated.
- `AGENTS.md`: durable direct-owner decision protocol read by future agents.

---

### Task 1: Parse and validate the four ledger formats

**Files:**
- Modify: `tests/therapy-lessons.test.mjs`
- Modify: `scripts/verify-therapy-lessons.mjs`

**Interfaces:**
- Consumes: UTF-8 ledger strings from the repository root.
- Produces: `parseLedgerEntries({ source, fileName, marker, idField, timestampField, validateMetadata }) -> Array<{ metadata: object, body: string }>`.
- Produces: `assertRequiredSections({ fileName, id, body, sections }) -> void`.
- Produces: `loadTherapyGovernance({ rootDir }) -> { historyLessons, reviewEvents, implementationEvents, suggestions, decisions, approvals }` without changing the existing CLI verifier until Task 4.
- Produces: globally unique event, suggestion, receipt, and approval ID validation.

- [ ] **Step 1: Add valid four-ledger fixtures alongside the existing one-file fixture**

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
    suggestionFindings: reviewFindingsByDecision,
    packetLevelFindingIds: [
      "CROSS-GUIDE-001", "OWNER-POLICY-001", "COVERAGE-001", "CERTAINTY-LAYER-001"
    ],
    reviewArtifactPath: "docs/diagnostics/fixture-r02-review.json",
    reviewArtifactSha256,
    nextPhase: "repair-r03",
    ...overrides
  };
  return `## r02 live review was rejected before owner approval\n\n${marker("therapy-review-event", event)}\n\n### Review outcome\n\nOutcome: rejected-before-owner-gate\n\nThe candidate packet was rejected.\n\n### Finding dispositions\n\nBlocking and review findings remain unresolved in the bound diagnostic artifact.\n\n### What this does not mean\n\nThe five suggestions were not all judged false.\n\n### Finding-to-suggestion mapping\n\nEvery lesson-specific finding is mapped below.\n\n### Packet-level findings\n\nCross-guide and owner-policy remediation remains.\n\n### Next phase\n\nRepair r03, review it, and only then ask Joel directly.\n`;
}

function suggestionBlock(decision, overrides = {}) {
  const metadata = {
    suggestionId: `suggestion-r02-${decision.id}`,
    createdAt: "2026-08-13T14:31:28.000Z",
    packetId,
    packetDigest,
    decisionId: decision.id,
    decisionCardDigest: cardDigest(decision),
    status: "blocked-by-packet-review",
    reviewFindingIds: [],
    ownerDecisionRequired: true,
    guideIds: ["inner-child"],
    graphNodeIds: [`NODE.${decision.id}`],
    promptContractIds: [],
    policySafetyGateIds: [],
    regressionIds: decision.affectedRegressions,
    ...overrides
  };
  return `## ${decision.id}\n\n${marker("therapy-suggestion", metadata)}\n\n### Proposal\n\nKeep this exact candidate change pending.\n\n### Guide impact\n\nGuide: inner-child. Graph node: NODE.${decision.id}. Prompt: none. Regression: ${decision.affectedRegressions.join(", ")}.\n\n### Evidence and uncertainty\n\nSource status: canonical packet evidence. Limitation: the packet has not passed review.\n\n### Review result\n\nThe enclosing r02 packet was rejected before the owner gate.\n\n### Why not active\n\nIt has neither a passing packet nor an explicit owner decision.\n\n### Technical next action\n\nCarry the corrected proposal into r03 and rerun its regression.\n\n### Decision needed\n\nAfter r03 passes review, Joel must explicitly approve or decline this proposal.\n\n### Options and trade-offs\n\nOption A — approve after repair. Benefits: gains the proposed behavior. Costs: changes routing. Worst plausible failure: the route activates incorrectly.\n\nOption B — retain current policy. Benefits: avoids an unverified change. Costs: forgoes the candidate behavior. Worst plausible failure: a useful route remains unavailable.\n\n### Recommendation and reasoning\n\nRecommendation: wait for r03. Reasoning: technical review must pass before an owner policy choice is actionable.\n`;
}
```

Make a new `governanceFixture()` write `THERAPY-LESSONS`, `SUGGESTED-THERAPY-LESSONS`, `THERAPY-DECISIONS`, `APPROVED-THERAPY-LESSONS`, and `AGENTS.md`. Include the existing active `therapy-lesson` entry, `reviewBlock()`, five `suggestionBlock()` values, header-only decision and approval ledgers, and the complete structured `therapy-owner-decision-protocol` schema version 2 contract. Give each temporary decision `affectedRegressions: regressionsByDecision[decision.id]`. Define `suggestionOverrides` to affect only `decision-1`, while `suggestionOverridesByDecision` applies keyed changes to other decisions; define `reviewOverrides`, `suggestionsTransform`, `omitSuggestionDecisionId`, and `duplicateSuggestionDecisionId` exactly as used below. Preserve the existing `fixture()` and its tests until Task 4 so every intermediate commit remains green.

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
  await assert.rejects(loadTherapyGovernance({ rootDir }), /AGENTS.md is missing therapy-owner-decision-protocol-v2/);
});
```

Split the timestamp and invalid-status assertions into separate tests so both failure paths execute.

- [ ] **Step 3: Run the new structural tests and verify RED**

Run: `node --test --test-name-pattern="missing ledger|malformed suggestion|invalid timestamps|invalid status|duplicate IDs|missing readable section|root owner protocol" tests/therapy-lessons.test.mjs`

Expected: FAIL because the current verifier reads only `THERAPY-LESSONS` and has no four-ledger parser or root protocol check.

- [ ] **Step 4: Implement the generic ledger parser and structural validators**

In `scripts/verify-therapy-lessons.mjs`, retain `validInstant()` and add these exact constants:

```js
const LEDGER_FILES = {
  history: "THERAPY-LESSONS",
  suggestions: "SUGGESTED-THERAPY-LESSONS",
  decisions: "THERAPY-DECISIONS",
  approvals: "APPROVED-THERAPY-LESSONS"
};
const SUGGESTION_STATUSES = new Set([
  "blocked-by-packet-review", "needs-technical-repair", "ready-for-owner",
  "approved", "implemented", "declined", "superseded"
]);
const APPROVAL_STATUSES = new Set(["approved-not-implemented", "implemented"]);
const DECISION_CHOICES = new Set(["approve", "decline"]);
const SUGGESTION_SECTIONS = [
  "Proposal", "Guide impact", "Evidence and uncertainty", "Review result",
  "Why not active", "Technical next action", "Decision needed",
  "Options and trade-offs", "Recommendation and reasoning"
];
const APPROVAL_SECTIONS = [
  "Exact decision", "Owner reasoning or stated preference", "Scope and constraints",
  "Guide impact", "Implementation status", "Verification evidence"
];
const DECISION_SECTIONS = ["Explicit owner choice", "Evidence binding"];
const REVIEW_SECTIONS = [
  "Review outcome", "Finding dispositions", "What this does not mean",
  "Finding-to-suggestion mapping", "Packet-level findings", "Next phase"
];
```

Implement `readRequiredFile()` so `ENOENT` becomes `<filename> is required.` Pre-scan every governance-marker occurrence, then implement `parseLedgerEntries()` for complete, single-consumption structured comments, taking the body through the next level-two heading or end of file and returning `{ metadata, body }`. Reject truncated, dangling, unknown, multiply consumed, and wrong-ledger markers. Trim scalar and array IDs; reject whitespace-only values, duplicates, and foreign/conflicting identity or origin fields. `assertRequiredSections()` must require a non-empty `### <name>` body before the next level-three heading. Validate suggestion, decision-choice, and approval status sets; then validate global ID uniqueness and the complete versioned `AGENTS.md` rule contract. Export `loadTherapyGovernance()` for focused unit tests, but leave `verifyTherapyLessons()` on its existing history-only path until the real ledgers are created in Task 4.

- [ ] **Step 5: Run structural tests and the existing active-lesson tests**

Run: `node --test tests/therapy-lessons.test.mjs`

Expected: all current tests PASS. The new tests exercise `loadTherapyGovernance()` against temporary roots; the unchanged real-checkout CLI path remains green until Task 4 atomically installs the new root ledgers and integration.

- [ ] **Step 6: Commit the structural parser**

```bash
git add scripts/verify-therapy-lessons.mjs tests/therapy-lessons.test.mjs
git commit -m "Enforce therapy ledger structure"
```

### Task 2: Validate retained suggestions and enforce latest-packet coverage

**Files:**
- Modify: `tests/therapy-lessons.test.mjs`
- Modify: `scripts/verify-therapy-lessons.mjs`

**Interfaces:**
- Consumes: every candidate manifest and immutable archive returned by `loadCandidatePackets()`, with each packet's substantive decision cards.
- Consumes: parsed review events, authoritative checksummed diagnostics, and retained suggestions from Task 1.
- Produces: per-suggestion packet/card/review/artifact validation plus `validateLatestPacket({ manifest, cards, reviewEvents, suggestions }) -> { reviewEvent, suggestionsByDecision }` for latest coverage only.
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

Load the complete candidate-packet catalog from every candidate ZIP first, including archive-only candidates. Parse the authoritative manifest, cards, graphs, policy metadata, and decision cases directly from the same bytes whose raw ZIP digest is bound; never trust an extracted mirror or an optional declaration-only prompt registry. For every retained suggestion, bind the raw ZIP digest, canonical decision-card digest, exact card title/effect/provenance/current/candidate/worst-failure/regressions, its packet's review event, and that event's checksummed authoritative diagnostic. Reject a declared candidate whose referenced card file or archive is missing. Require its finding mapping and complete typed affected-ID sets to match the artifact. Require every candidate history identity to retain exactly one suggestion, as well as every suggestion to retain exactly one candidate history identity. Then implement `validateLatestPacket()` for the separate latest-revision coverage rules:

```js
const cards = decisions.cards.filter(
  (card) => card.classification === "substantive" && card.requiresHumanDecision === true
);
```

- Require exactly one review event for `manifest.packetId`; allow only `rejected-before-owner-gate` or `passed-owner-gate` so a later r03 can progress without weakening the gate.
- Require exactly one suggestion for every substantive card and reject latest-packet suggestions with unknown decision IDs.
- Require `ownerDecisionRequired: true`. When the latest event is rejected, permit only `blocked-by-packet-review` or `needs-technical-repair`; when it passes, prohibit those two statuses and permit `ready-for-owner`, `approved`, `implemented`, `declined`, or `superseded` subject to Task 3's approval matrix.
- Require `createdAt >= manifest.createdAt`.
- Require `regressionIds` to exactly equal its decision card's `affectedRegressions` for every retained suggestion, not only the latest packet.
- Require at least one stable affected identifier across `guideIds`, `graphNodeIds`, `promptContractIds`, and `policySafetyGateIds`.
- Require `Source status:` and `Limitation:` in evidence, two option labels, `Benefits:`, `Costs:`, and `Worst plausible failure:` in trade-offs, plus distinct `Recommendation:` and `Reasoning:` labels.
- Compare sets so `reviewEvent.findingIds` exactly equals the union of every suggestion's `reviewFindingIds` and `reviewEvent.packetLevelFindingIds`; report the first missing or extra ID.

Return the latest selected event and decision-indexed suggestion map for approval validation. `verifyTherapyGovernance()` must validate every retained suggestion against its own packet/card/review/artifact before separately resolving the latest candidate and calling this coverage function. Add a two-revision regression proving rejected r02 remains ineligible after r03 becomes latest, plus mutations for historical regression/finding drift and for a newer manifest whose declared decision-card file is missing.

- [ ] **Step 4: Run the complete focused test file**

Run: `node --test tests/therapy-lessons.test.mjs`

Expected: all structural and latest-packet tests PASS, and the existing real-checkout CLI test remains PASS on its history-only verifier path.

- [ ] **Step 5: Commit packet and review enforcement**

```bash
git add scripts/verify-therapy-lessons.mjs tests/therapy-lessons.test.mjs
git commit -m "Validate therapy review decision coverage"
```

### Task 3: Enforce explicit owner receipts, approval projection, and implementation evidence

**Files:**
- Modify: `tests/therapy-lessons.test.mjs`
- Modify: `scripts/verify-therapy-lessons.mjs`

**Interfaces:**
- Consumes: parsed suggestions, decision receipts, approval projections, review events, immutable packet/card evidence, candidate history, and a real temporary Git repository for positive implementation tests.
- Produces: typed receipt and transition validation, `validateApprovalLinks({ suggestions, decisions, approvals, reviewEvents })`, and real implementation-evidence validation.
- Decision receipt contract: `{ receiptId, suggestionId, packetId, packetDigest, decisionId, decisionCardDigest, reviewEventId, reviewArtifactPath, reviewArtifactSha256, choice, decisionSource, decidedAt, guideIds, graphNodeIds, promptContractIds, policySafetyGateIds, regressionIds }`.
- Approval projection contract: `{ approvalId, suggestionId, decisionReceiptId, decidedAt, implementationStatus, exact affected ID sets, implementationCommit?, implementationPaths?, regressionResults? }`.

- [ ] **Step 1: Add typed receipt, transition, and real-Git fixtures**

Build a genuinely passed r03 fixture alongside unchanged rejected r02 history. A valid owner receipt must bind one r03 suggestion to the immutable packet ZIP digest, canonical decision-card digest, passed review event and diagnostic digest, explicit choice, `decisionSource: "direct-user-conversation"`, UTC decision time, and exact complete affected scope. A valid approval projection copies that scope and links `decisionReceiptId`; it does not repeat or replace the authoritative decision source.

For the implemented positive fixture, initialize an actual temporary Git repository, create a reachable full commit after the decision time, change the declared implementation paths in that commit, record structured `PASS` evidence for every affected regression, and append exactly one matching `therapy-implementation-event` to `THERAPY-LESSONS`. Do not use a fabricated abbreviated commit.

- [ ] **Step 2: Add causal receipt/state/implementation tests and verify RED**

Cover at least:

- approve or decline state without a typed decision receipt;
- blocked, repair, or ready state with any receipt or approval;
- receipt packet/card/review/digest/scope/time mismatch, partial scope, model/inferred/conflicting origin, duplicate, or orphan receipt;
- approval projection missing or mismatching its approve receipt;
- decline receipt with any approval projection;
- supersession with a fabricated receipt, missing transition metadata, wrong decision/scope, or invalid `supersededBy` replacement;
- false activation, deletion, or packet repointing of immutable candidate history;
- fake, unreachable, or ambiguous implementation commit; commit before decision; missing declared changed path; missing/non-PASS regression result; missing or mismatching appended implementation event.

Run the prescribed approval-focused filter and confirm these causal tests fail for the intended missing invariant before implementation. The malformed implementation-commit test name must contain `approval` so this filter selects it.

- [ ] **Step 3: Implement the receipt-aware state matrix**

| Suggestion status | Decision receipts | Approval projections | Additional invariant |
|---|---:|---:|---|
| `blocked-by-packet-review` | 0 | 0 | packet remains ineligible |
| `needs-technical-repair` | 0 | 0 | repair remains outstanding |
| `ready-for-owner` | 0 | 0 | no answer yet |
| `approved` | 1 `approve` | 1 `approved-not-implemented` | exact receipt/projection scope |
| `implemented` | 1 `approve` | 1 `implemented` | real Git, PASS regressions, one history event |
| `declined` | 1 `decline` | 0 | explicit owner choice only |
| `superseded` | 0 | 0 | compatible structured technical replacement |

Require suggestion creation <= passed review <= owner decision <= implementation commit. Every retained suggestion must have exactly one matching historical `candidate-awaiting-owner` entry with the same packet and decision; that discovery entry remains immutable. Implementation is represented only by the appended implementation event.

- [ ] **Step 4: Validate real implementation evidence**

Resolve `implementationCommit` as a full, unambiguous commit reachable from repository HEAD. Require its committer time to follow `decidedAt`, require every declared implementation path in that commit's diff, require exact structured `PASS` results for every affected regression, and require one matching history event bound to the suggestion, receipt, commit, paths, and regression results.

- [ ] **Step 5: Run all focused tests and commit the authorization gate**

Run: `node --test tests/therapy-lessons.test.mjs`

Expected: every test PASS; rejected r02 remains ineligible while the genuine passed r03 fixture can progress only through a matching receipt. Commit the complete receipt/state/implementation enforcement with its tests.

### Task 4: Record the r02 rejection and current suggestion queue

**Files:**
- Create: `AGENTS.md`
- Modify: `THERAPY-LESSONS`
- Create: `SUGGESTED-THERAPY-LESSONS`
- Create: `THERAPY-DECISIONS`
- Create: `APPROVED-THERAPY-LESSONS`
- Modify: `tests/therapy-lessons.test.mjs`

**Interfaces:**
- Consumes: the four ledger contracts and invariant functions completed in Tasks 1–3.
- Produces: a real checkout that passes `node scripts/verify-therapy-lessons.mjs` with five blocked suggestions, four active runtime lessons, one rejected review event, zero decision receipts, zero approvals, and zero implementations.

- [ ] **Step 1: Make the real-checkout CLI assertion strict and verify RED**

Change the existing CLI test to require:

```js
assert.match(result.stdout, /^PASS 5\/5 substantive therapy suggestions tracked for /);
assert.match(result.stdout, /4 active runtime lessons/);
assert.match(result.stdout, /5 blocked suggestions/);
assert.match(result.stdout, /0 explicit owner decision receipts/);
assert.match(result.stdout, /0 explicit owner approvals/);
assert.match(result.stdout, /0 implementations/);
assert.match(result.stdout, /r02 rejection explained/);
```

Run: `node --test --test-name-pattern="covers every substantive decision" tests/therapy-lessons.test.mjs`

Expected: FAIL because the production root does not yet contain the complete suggestion, decision, and approval ledgers, structured protocol contract, or review event.

At the same time, replace the CLI-facing `verifyTherapyLessons()` history-only coverage logic with a call to `verifyTherapyGovernance({ rootDir })`, retaining the active-runtime count from parsed `therapy-lesson` history entries and returning `{ packetId, tracked, activeCount, suggestionCount, blockedCount, decisionCount, approvalCount, implementationCount, reviewEventId }`. This integration change is what makes the strict CLI test fail before Steps 2–5 add the production files.

- [ ] **Step 2: Add the root owner-decision protocol**

Create `AGENTS.md` beginning with:

```markdown
# Inner Signal Agent Instructions

<!-- therapy-owner-decision-protocol {"schemaVersion":2,"rules":["read-all-four-ledgers","separate-deterministic-repairs-from-owner-choice","ask-joel-directly-in-active-conversation","one-substantive-decision-unless-joel-requests-bundling","state-exact-decision-and-why-now","classify-evidence-type-and-limitations","present-viable-options-benefits-costs-worst-failure","keep-recommendation-and-detailed-reasoning-distinct","enumerate-guide-graph-prompt-safety-regression-effects","no-answer-leaves-policy-unchanged","record-explicit-answer-only-never-infer","commit-git-transition-and-tests-before-durable-guidance","never-store-private-therapy-transcript"]} -->
```

Require future agents to read all four root ledgers before therapy or guide work. The structured v2 rule set and prose must cover: read all four ledgers; perform or separate deterministic repairs; ask Joel directly in the active conversation and one decision at a time unless he requests bundling; state why the decision is needed; classify evidence type and limitations; give viable options with benefits, costs, and worst plausible failure; keep the recommendation and detailed reasoning distinct from Joel's choice; enumerate downstream guide, graph, prompt-contract, policy/safety-gate, and regression effects; state that no answer leaves policy unchanged; record explicit answers only; commit the Git transition and passing tests before durable guidance; and never store a private therapy transcript. State that unavailable conversation leaves the suggestion pending and policy unchanged.

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

| Suggestion ID | Decision | Guide IDs | Graph nodes | Prompt-contract IDs | Policy/safety-gate IDs | Regressions | Review findings |
|---|---|---|---|---|---|---|---|
| `suggestion-r02-decision-1` | `decision-1` | `somatic` | `SOM.DELAYED_RESPONSE_REASSESSMENT` | none | none | `G-SOM-DELAYED` | none |
| `suggestion-r02-decision-2` | `decision-2` | `inner-child` | `IC.AGE_RESPONSIBILITY_CLARIFICATION` | `response-realization-v5` | none | `A001` | `SRC-CITE-001` |
| `suggestion-r02-decision-3` | `decision-3` | `inner-child` | `IC.BORROW_ONE_FUNCTION`, `IC.NEUTRAL_WITNESS` | `response-realization-v5` | `OWNER.PRODUCT.APP_OWNED_HYPNOSIS_CONTROL` | `A001`, `H001` | `PRIORITY-TIE-001` |
| `suggestion-r02-decision-4` | `decision-4` | `inner-child` | `IC.CREDIBILITY_REPAIR`, `IC.DEEP_CHILD_DIALOGUE` | `response-realization-v5` | none | `A001` | `REG-EVIDENCE-001` |
| `suggestion-r02-decision-5` | `decision-5` | `somatic` | `SOM.ADVANCED_RELEASE_BLOCK`, `SOM.ADVANCED_RELEASE_OPTIONAL` | `response-realization-v5` | `VAGAL.SAFETY.P5` | `G-SOM-DELAYED`, `G-SOM-ADVANCED-BLOCK` | `SAFETY-ENCODE-001`, `EXT-VALID-001` |

Every metadata record uses `createdAt: "2026-08-13T14:31:28.000Z"`, `packetId: "inner-signal-guides-2026.08.12-r02-candidate"`, `status: "blocked-by-packet-review"`, and `ownerDecisionRequired: true`.

The prose must preserve these distinctions:

- Decision 1 had no lesson-specific finding; it is blocked only because the packet failed.
- Decision 2 must cite `IC.LOVE_UNSAFE` for knowledge, support, freedom, and responsibility, separately establish that “opportunity” comes from current installed/A001 wording rather than canonical prose, and only then ask Joel whether “safety” and “money” should extend policy.
- Decision 3 must resolve the priority-95 tie deterministically; H001 app-owned hypnosis/waking-return policy remains a separate explicit owner-policy question.
- Decision 4 must add a mutation-sensitive A001 case proving that deep-child dialogue is actually deferred.
- Decision 5 must encode the lying-down-only constraint, contraindications, and gentler Bhramari alternative while labeling Vagal evidence author-provided and `independentlyValidated: false`; Joel later decides exact language and scope.
- `CROSS-GUIDE-001` and `OWNER-POLICY-001` are packet repairs; `COVERAGE-001` is future coverage information; `CERTAINTY-LAYER-001` is positive evidence, not a blocker.

Each options section presents “approve after a passing r03 review” and “retain current policy,” with concrete benefits, costs, and worst plausible failure. Each recommendation says to complete deterministic r03 repair first; it must not recommend pretending the owner already answered.

- [ ] **Step 5: Create intentionally empty decision and approval ledgers**

Create `THERAPY-DECISIONS` with a title and contract explaining that it is append-only, stores only Joel's explicit direct-conversation approve/decline receipts, and binds immutable packet/card/review evidence plus exact complete affected scope. State that the governance-design approval is not a therapy-policy receipt and that no receipt exists. Do not add a `therapy-decision` metadata comment.

Create `APPROVED-THERAPY-LESSONS` with the title, contract explanation, and this explicit statement:

```markdown
No therapy-policy suggestions are approved as of 2026-08-13T14:31:28.000Z. The governance design approval does not approve any r02 lesson. The first `therapy-approval` entry may be added only after a specific suggestion has a passed review and exactly one linked `therapy-decision` receipt recording Joel's explicit `approve` choice from the active conversation.
```

Do not add a `therapy-approval` metadata comment.

- [ ] **Step 6: Run the focused verifier repeatedly**

Run three separate times:

```bash
node --test tests/therapy-lessons.test.mjs
node --test tests/therapy-lessons.test.mjs
node --test tests/therapy-lessons.test.mjs
```

Expected each time: all tests PASS, including the real-checkout CLI assertion. Then run `npm run therapy-lessons:verify`; expect `PASS 5/5`, four active runtime lessons, five blocked suggestions, zero explicit owner decisions, zero explicit owner approvals, and an explained r02 rejection.

- [ ] **Step 7: Commit the ledgers and owner protocol**

```bash
git add AGENTS.md THERAPY-LESSONS SUGGESTED-THERAPY-LESSONS THERAPY-DECISIONS APPROVED-THERAPY-LESSONS tests/therapy-lessons.test.mjs
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

Expected: every command exits 0; the verifier reports five blocked suggestions, zero decision receipts, and zero approvals.

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

Report exact test counts and commit IDs. State that governance is implemented but r02 remains rejected and uninstalled, all five suggestions remain blocked, and both `THERAPY-DECISIONS` and `APPROVED-THERAPY-LESSONS` remain header-only with zero entries. The next separate project is deterministic r03 repair; after r03 passes review, ask Joel the first decision directly with its full pros/cons brief.
