# Therapy Lesson Governance and Owner Decision Design

Date: 2026-08-13
Status: owner-approved governance design, amended 2026-08-13 with a fourth decision-receipt ledger; lesson suggestions remain unapproved
Scope: Git-tracked therapy-prompt learning, guide-impacting suggestions, explicit owner approval/decline receipts, approval implementation views, review-rejection explanations, and direct-conversation decision briefs

## Design amendment history

- 2026-08-13: Joel approved the original therapy-governance design. That governance-design approval did not approve any therapy lesson.
- 2026-08-13: Joel approved an architecture amendment adding `THERAPY-DECISIONS` as the durable receipt ledger for explicit direct-conversation approvals and declines. This architecture approval is not itself a `therapy-decision` receipt; the five r02 suggestions remain blocked, with zero decision receipts, approvals, or implementations.

## Outcome

Inner Signal will keep four root-level, human-readable ledgers with non-overlapping meanings:

- `THERAPY-LESSONS` is append-only discovery, review, and implementation audit history; it is never approval authority.
- `SUGGESTED-THERAPY-LESSONS` is the current proposal and transition state for lessons that could or should change underlying guides, graphs, prompt contracts, safety policy, or therapy regressions.
- `THERAPY-DECISIONS` is the append-only source of structured receipts for Joel's explicit approvals and declines given in a direct active conversation.
- `APPROVED-THERAPY-LESSONS` is an approval-only implementation view, and every entry links to exactly one approving decision receipt.

All four files are committed to Git. Their history is part of the development evidence: future lesson development must read the accumulated record rather than repeatedly rediscovering, losing, or silently reversing earlier learning.

The repository will also gain a root `AGENTS.md` owner-decision protocol. Whenever a therapy or guide-policy decision is required, an agent must ask Joel directly in the active conversation. It must explain the evidence, uncertainty, options, pros and cons, recommendation, reasoning, and downstream effects. A model verdict, a recommendation in a packet, silence, elapsed time, or an edit to a ledger never counts as approval.

## Why four ledgers

One mixed file makes “learned,” “suggested,” “decided,” and “approved for implementation” too easy to confuse. In particular, an approval projection cannot also be the authoritative record of declines, and technical supersession must not be misrepresented as an owner choice. A generated database with four views would normalize state more strongly, but it adds machinery and makes the human-readable artifacts secondary. Four Git-tracked Markdown ledgers with small structured metadata comments preserve readability while allowing strict cross-file validation.

The original log remains the historical spine. Suggestions hold current transition state, decision receipts hold explicit owner choices, and approvals project only approved implementation state:

```text
THERAPY-LESSONS
  discovery/review/implementation events
                    |
                    v
SUGGESTED-THERAPY-LESSONS
  proposed -> blocked -> ready-for-owner -> technical supersession
                              |
                              v
THERAPY-DECISIONS
  explicit approve or decline receipt
                |
                | approve only
                v
APPROVED-THERAPY-LESSONS
  approval projection -> approved-not-implemented -> implemented
```

No item is deleted merely because its state changes. Stable IDs and Git history preserve the transition.

## Ledger contracts

### `THERAPY-LESSONS`: chronological audit

The current active-runtime and candidate discovery entries remain. A new timestamped review event will explain that the r02 Guide Packet was rejected as an activatable packet, not that every lesson was judged false. It will record:

- packet identity and review outcome;
- blocking and review finding IDs;
- which findings apply to which suggested lessons;
- packet-level findings that do not belong to one lesson;
- the distinction between technical repair and owner choice;
- the next phase: repair r03, review it, ask owner decisions, then install only if every gate passes.

Review events use a structured `therapy-review-event` comment with a stable event ID, UTC timestamp, packet ID, outcome, mapped finding IDs, next phase, and a repository-relative path plus raw SHA-256 binding to an authoritative machine-readable diagnostic under `docs/diagnostics/`. That artifact owns finding severity, explicit disposition, per-decision and packet-level assignments, typed affected IDs, and immutable packet/card source bindings. The readable `Outcome:` line must exactly agree with metadata; `passed-owner-gate` is valid only when every blocking/review finding is resolved, the next phase is owner decisions, and no rejection or repair residue remains.

This file answers “what did we learn and what happened?” It is not the source of owner choice or approval state.

### `SUGGESTED-THERAPY-LESSONS`: guide-impact queue

The file contains exactly one current suggestion for every substantive human decision in the latest bundled Guide Packet. Historical suggestions remain with terminal status when a later packet supersedes them.

Each suggestion has a `therapy-suggestion` metadata comment containing:

- `suggestionId`;
- `createdAt` in UTC;
- `packetId`, `packetDigest`, `decisionId`, and `decisionCardDigest`;
- `status`;
- `reviewFindingIds`;
- `ownerDecisionRequired`;
- stable, complete affected guide, graph-node, prompt-contract, policy-or-safety-gate, and regression identifiers.

Every retained suggestion—not only the highest packet revision—is validated against its own raw packet ZIP digest, canonical substantive decision card, review event, and checksummed diagnostic. The validator derives the manifest, cards, graphs, policy metadata, and decision cases directly from those hashed ZIP bytes rather than trusting the mutable extracted mirror, and it cannot skip an archive-only newer candidate. The validator binds the exact card title, behavioral effect, provenance, current behavior, candidate behavior, worst plausible failure, and regression set. Guide IDs resolve in the archived manifest, graph-node IDs in archived graph data, prompt-contract IDs in actual exported/source contracts, policy or safety-gate IDs in archived packet/source policy data, and regression IDs in archived decision cases. Latest-packet validation is a separate completeness rule requiring exactly one current suggestion for every latest substantive card; a newer packet cannot make an older rejected proposal eligible. Candidate history and suggestion retention are checked in both directions so neither side of the transition record can be orphaned.

Allowed statuses are:

- `blocked-by-packet-review`: the enclosing packet cannot reach the owner gate;
- `needs-technical-repair`: a lesson-specific deterministic repair is outstanding;
- `ready-for-owner`: review permits a direct owner decision;
- `approved`: linked to exactly one explicit approving receipt and one approval projection, but not yet implemented;
- `implemented`: linked to an approving receipt and implemented approval projection, with real Git and regression evidence appended to audit history;
- `declined`: linked to exactly one explicit decline receipt and no approval projection;
- `superseded`: a newer compatible suggestion replaces the exact proposal through structured technical transition metadata, without a fabricated owner receipt.

Every entry includes these readable sections:

- Proposal
- Guide impact
- Evidence and uncertainty
- Review result
- Why not active
- Technical next action
- Decision needed
- Options and trade-offs
- Recommendation and reasoning

When no owner decision should be asked yet, “Decision needed” states what decision will become necessary after technical repair. It must not simulate or pre-record an answer.

### `THERAPY-DECISIONS`: explicit owner-choice receipts

This append-only ledger contains exactly the structured receipts for Joel's explicit approvals and declines in direct active conversation. It begins with a contract header and no retroactively invented decision. The governance-design approval and this architecture amendment do not create therapy-policy receipts.

Each future receipt uses a `therapy-decision` metadata comment containing:

- a globally unique `receiptId`;
- `suggestionId`, `packetId`, and the immutable packet digest;
- `decisionId` and the immutable substantive decision-card digest;
- the passed `reviewEventId` and authoritative review-artifact digest;
- `choice: "approve"` or `choice: "decline"`;
- `decisionSource: "direct-user-conversation"` and `decidedAt` in UTC;
- the exact complete affected guide, graph-node, prompt-contract, policy-or-safety-gate, and regression sets.

The receipt binds one atomic reviewed scope. It cannot infer an answer, broaden a partial scope, use a model or conflicting origin, or precede the passed review. A decline receipt produces no approval entry. Technical supersession is a validated suggestion transition, not an owner receipt.

### `APPROVED-THERAPY-LESSONS`: approval-only implementation view

This file begins with its contract and no retroactively invented approvals. Existing active runtime behavior is not relabelled as a direct owner decision unless a real approving receipt exists. It is a projection of approve receipts only; it never records declines or serves as the source of owner choice.

Each future approval uses a `therapy-approval` metadata comment containing:

- `approvalId`;
- `suggestionId` and the exact approving `decisionReceiptId`;
- `decidedAt` in UTC;
- `implementationStatus`: `approved-not-implemented` or `implemented`;
- the exact complete affected guide, graph-node, prompt-contract, policy-or-safety-gate, and regression sets copied from the receipt;
- a full, reachable implementation commit, exact changed paths, and structured passing regression evidence when implemented.

Each approval explains:

- Exact decision
- Owner reasoning or stated preference
- Scope and constraints
- Guide impact
- Implementation status
- Verification evidence

The ledger stores a concise implementation view, not a conversation transcript or private therapy material. Static validation verifies its exact link to an approve receipt; `AGENTS.md` supplies the active-conversation behavioral rule and Git review supplies accountability.

## r02 review outcome and mapping

The first enforceable update records the actual live r02 outcome. The packet was rejected before owner approval because activation was unsafe or insufficiently evidenced as a whole. The five lessons are not all substantively rejected.

### Decision 1: delayed somatic reassessment

The route itself did not receive a lesson-specific blocking finding. It remains blocked because r02 was rejected as a packet. It can carry into r03 with its existing affected regression, while any safety claims used around advanced practices remain carefully attributed.

### Decision 2: age, agency, and resources

Finding `SRC-CITE-001` says the candidate cites the wrong canonical antecedent. Canonical `IC.LOVE_UNSAFE` supports knowledge, support, freedom, and responsibility; “opportunity” is current installed/A001 wording whose separate provenance must be recorded, not canonical prose. The source-supported list does not include the proposed additions “safety” and “money.” r03 must repair the citation and provenance first, then later ask Joel whether those two additions should become guide policy.

### Decision 3: earlier bounded adult function

Finding `PRIORITY-TIE-001` says priority 95 creates an undocumented tie with neutral witness work. r03 must make ordering deterministic. Packet-level finding `OWNER-POLICY-001` also requires explicit owner confirmation of app-owned hypnosis routing and waking-return policy associated with H001; a model cannot approve it.

### Decision 4: credibility before deep dialogue

Finding `REG-EVIDENCE-001` says the packet claims that deep child dialogue is deferred, but A001 does not demonstrate the deferral firing. r03 must add a mutation-sensitive case that fails when the dependency is absent.

### Decision 5: advanced-release safety block

Finding `SAFETY-ENCODE-001` is the blocking safety issue. The optional advanced route omits the source-specific lying-down constraint, contraindications, and gentler alternative. Finding `EXT-VALID-001` says that material is author-provided and not independently validated; it must not be rendered as established medical fact. r03 needs both deterministic safety encoding and a direct owner decision about the exact language and scope.

### Packet-level findings

- `CROSS-GUIDE-001`: add missing cross-guide source references.
- `OWNER-POLICY-001`: expose and confirm product-owned hypnosis route and waking-return policy rather than allowing it to look like a therapeutic claim.
- `COVERAGE-001`: future coverage is suggested for memory epistemics and altered-state gates; this is informative, not the reason r02 was rejected.
- `CERTAINTY-LAYER-001`: the packet correctly preserved several source-certainty distinctions; this is a positive finding, not a blocker.

The review-event finding set and the union of suggestion and packet-level mappings must match. A blocking or review finding may not be dropped merely because it is inconvenient to assign.

## Direct owner-decision protocol

Root `AGENTS.md` carries exactly one versioned structured protocol contract and requires agents to read all four ledgers before any therapy-governance work. It requires the following behavior for any therapy, hypnosis, somatic, guide, graph, prompt, safety, or evidence-policy decision:

1. Complete safe deterministic repairs that do not require owner judgment, or clearly separate them from the owner choice.
2. Ask Joel directly in the active conversation. Ask one substantive decision at a time unless Joel explicitly asks to bundle them.
3. State the exact decision and why it is needed now.
4. Describe the evidence and its limitations, including whether a source is canonical, owner-authored, external, anecdotal, or independently validated.
5. Present each viable option with concrete benefits, costs, and worst plausible failure.
6. Give a recommendation and detailed reasoning. A recommendation must remain visibly distinct from the decision.
7. Explain the effect on guides, graph nodes, prompt contracts, policy or safety gates, and regression cases.
8. State that no answer means current policy remains unchanged.
9. Record only the explicit answer as a bound receipt in `THERAPY-DECISIONS`. Never infer approval or decline from silence, prior general enthusiasm, a model verdict, or the suggested default.
10. Commit the resulting ledger transition and its tests to Git before treating the decision as durable development guidance.

If direct conversation is unavailable, the suggestion remains pending and production policy remains unchanged.

The structured contract also makes the privacy boundary explicit: no private therapy transcript may be stored in any ledger or elsewhere in the repository.

## r03 workflow

The next Guide Packet is not another review of unchanged r02. It follows this sequence:

1. Create the four-ledger governance implementation and commit it.
2. Record the r02 rejection and all five current suggestions.
3. Repair citations, cross-guide provenance, certainty labels, priority ordering, exposed product-policy provenance, and missing regression coverage without changing owner policy.
4. Build r03 from those repairs.
5. Run Opus compilation, independent Codex audit, and Fable adjudication only if material disagreement remains.
6. If r03 reaches the owner gate, ask Joel directly about every substantive decision card, one at a time, using the complete decision brief. The existing five cards all require an explicit owner answer unless r03 removes or materially replaces one.
7. Record every explicit approval or decline in `THERAPY-DECISIONS`. Project only approve receipts into `APPROVED-THERAPY-LESSONS`; a decline has no approval entry. Record compatible technical supersession as a receipt-free structured suggestion transition.
8. Modify active guides only within the approved scope, rerun affected regressions and full release gates, then mark approvals implemented with commit and verification evidence.

## Validation and failure behavior

`scripts/verify-therapy-lessons.mjs` will expand from one-file coverage to a four-ledger governance gate. It will require:

- valid structured metadata and UTC timestamps;
- globally unique event, suggestion, receipt, and approval IDs;
- a complete catalog of declared candidates, with missing referenced card files or archives rejected rather than silently skipped;
- every retained suggestion bound to its own immutable packet/card/review/artifact, with exact card-field and review-mapping fidelity;
- exactly one suggestion for each latest substantive Guide Packet decision;
- correct packet and decision identity;
- authoritative typed guide, graph-node, prompt-contract, policy-or-safety-gate, and regression identifier resolution;
- a checksummed review diagnostic whose finding dispositions, affected IDs, assignments, outcome, and readable review state agree exactly with the ledger;
- required readable sections for every suggestion and approval;
- allowed state transitions and consistent cross-file links;
- a reason and next action for every non-active or review-blocked suggestion;
- every blocking/review finding mapped to a suggestion or explicit packet-level remediation;
- owner-facing options, pros, cons, evidence uncertainty, recommendation, and reasoning;
- no approval without one exact matching approve receipt bound to a passed review and immutable packet/card evidence;
- no decline state without one exact decline receipt, and no approval for a declined suggestion;
- no receipt for blocked, repair, ready, or technically superseded state;
- no model-originated, inferred, conflicting-origin, duplicate, orphan, partial-scope, or chronologically invalid decision receipt;
- no `implemented` approval without an unambiguous commit reachable from repository HEAD, a commit time after the owner decision, declared paths present in that commit's diff, and structured PASS evidence for every affected regression;
- no suggestion marked implemented unless its approval is implemented;
- no candidate-history deletion, repointing, or false activation; implementation is an appended audit event;
- the complete root `AGENTS.md` versioned decision-protocol contract.

The package verifier will continue to run this gate. Negative regression tests cover missing suggestions, duplicate identities, unknown decisions, malformed timestamps, invalid status, missing rejection explanation, unmapped findings, missing trade-offs, approval or decline without a typed receipt, receipt/card/review/scope/time drift, invalid supersession, malformed governance markers, owner-protocol rule mutation, false candidate activation, and fake or incomplete implementation evidence.

On failure, validation reports the exact ledger, entry ID, and violated invariant. It never repairs approval state automatically.

## Git and future learning

The design specification, ledgers, validator, tests, and root agent protocol are committed deliberately. Future agents must read the four ledgers before proposing guide changes. A later suggestion should cite prior suggestion, decision-receipt, and approval IDs when it extends or contradicts earlier learning; a technical supersession cites its compatible replacement suggestion without manufacturing an owner receipt.

Git provides authorship, ordering, reviewable diffs, and rollback. It does not replace the owner-decision gate. History can show what changed; only Joel's explicit direct-conversation decision can authorize therapy-policy approval.

## Non-goals

- No r02 lesson becomes active through this governance work.
- No rejected Guide Packet becomes installable through a ledger edit.
- No model receives authority to approve therapy or safety policy.
- No personal therapy conversation transcript is stored in Git.
- No owner decision is bundled, assumed, or manufactured to accelerate r03.
- No existing guide, graph, prompt, or runtime routing behavior changes until an approved suggestion is implemented and verified separately.
