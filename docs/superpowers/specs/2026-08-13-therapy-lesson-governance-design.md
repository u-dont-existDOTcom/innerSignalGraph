# Therapy Lesson Governance and Owner Decision Design

Date: 2026-08-13  
Status: written from the approved design; awaiting written-spec review  
Scope: Git-tracked therapy-prompt learning, guide-impacting suggestions, explicit owner approvals, review-rejection explanations, and direct-conversation decision briefs

## Outcome

Inner Signal will keep three root-level, human-readable ledgers with non-overlapping meanings:

- `THERAPY-LESSONS` is the append-only chronological learning and review-history log.
- `SUGGESTED-THERAPY-LESSONS` is the current actionable queue of lessons that could or should change underlying guides, graphs, prompts, or therapy regressions.
- `APPROVED-THERAPY-LESSONS` contains only explicit owner-approved guide-impacting decisions.

All three files are committed to Git. Their history is part of the development evidence: future lesson development must read the accumulated record rather than repeatedly rediscovering, losing, or silently reversing earlier learning.

The repository will also gain a root `AGENTS.md` owner-decision protocol. Whenever a therapy or guide-policy decision is required, an agent must ask Joel directly in the active conversation. It must explain the evidence, uncertainty, options, pros and cons, recommendation, reasoning, and downstream effects. A model verdict, a recommendation in a packet, silence, elapsed time, or an edit to a ledger never counts as approval.

## Why three ledgers

One mixed file makes “learned,” “suggested,” and “approved” too easy to confuse. A generated database with three views would normalize state more strongly, but it adds machinery and makes the human-readable artifacts secondary. Three Git-tracked Markdown ledgers with small structured metadata comments preserve readability while allowing strict cross-file validation.

The original log remains the historical spine. Suggestions and approvals are state ledgers:

```text
THERAPY-LESSONS
  discovery/review/decision/implementation events
                    |
                    v
SUGGESTED-THERAPY-LESSONS
  proposed -> blocked -> ready-for-owner -> approved/declined/superseded
                                            |
                                            v
APPROVED-THERAPY-LESSONS
  explicit owner decision -> approved-not-implemented -> implemented
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

Review events use a structured `therapy-review-event` comment with a stable event ID, UTC timestamp, packet ID, outcome, mapped finding IDs, and next phase. The prose must explain the outcome and next action in ordinary language.

This file answers “what did we learn and what happened?” It is not the source of approval state.

### `SUGGESTED-THERAPY-LESSONS`: guide-impact queue

The file contains exactly one current suggestion for every substantive human decision in the latest bundled Guide Packet. Historical suggestions remain with terminal status when a later packet supersedes them.

Each suggestion has a `therapy-suggestion` metadata comment containing:

- `suggestionId`;
- `createdAt` in UTC;
- `packetId` and `decisionId`;
- `status`;
- `reviewFindingIds`;
- `ownerDecisionRequired`;
- stable affected guide, graph-node, prompt, and regression identifiers.

Allowed statuses are:

- `blocked-by-packet-review`: the enclosing packet cannot reach the owner gate;
- `needs-technical-repair`: a lesson-specific deterministic repair is outstanding;
- `ready-for-owner`: review permits a direct owner decision;
- `approved`: linked to exactly one explicit approval but not yet implemented;
- `implemented`: approved and verified in active policy;
- `declined`: owner explicitly chose current policy;
- `superseded`: a newer suggestion replaces the exact proposal.

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

### `APPROVED-THERAPY-LESSONS`: explicit decisions only

This file begins with its contract and no retroactively invented approvals. Existing active runtime behavior is not relabelled as a direct owner decision unless a real decision record exists.

Each future approval uses a `therapy-approval` metadata comment containing:

- `approvalId`;
- `suggestionId`;
- `decidedAt` in UTC;
- `decisionSource: "direct-user-conversation"`;
- `implementationStatus`: `approved-not-implemented` or `implemented`;
- affected guide identifiers;
- an implementation commit when implemented.

Each approval explains:

- Exact decision
- Owner reasoning or stated preference
- Scope and constraints
- Guide impact
- Implementation status
- Verification evidence

The ledger stores a concise policy decision, not a conversation transcript or private therapy material. Static validation can verify that the declared source is direct user conversation, but cannot prove that a conversation occurred; `AGENTS.md` supplies the behavioral rule and Git review supplies accountability.

## r02 review outcome and mapping

The first enforceable update records the actual live r02 outcome. The packet was rejected before owner approval because activation was unsafe or insufficiently evidenced as a whole. The five lessons are not all substantively rejected.

### Decision 1: delayed somatic reassessment

The route itself did not receive a lesson-specific blocking finding. It remains blocked because r02 was rejected as a packet. It can carry into r03 with its existing affected regression, while any safety claims used around advanced practices remain carefully attributed.

### Decision 2: age, agency, and resources

Finding `SRC-CITE-001` says the candidate cites the wrong canonical antecedent. The source-supported list does not clearly include the added words “safety” and “money.” r03 must repair the citation automatically, then ask Joel whether those two additions should become guide policy.

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

Root `AGENTS.md` will require the following behavior for any therapy, hypnosis, somatic, guide, graph, prompt, safety, or evidence-policy decision:

1. Complete safe deterministic repairs that do not require owner judgment, or clearly separate them from the owner choice.
2. Ask Joel directly in the active conversation. Ask one substantive decision at a time unless Joel explicitly asks to bundle them.
3. State the exact decision and why it is needed now.
4. Describe the evidence and its limitations, including whether a source is canonical, owner-authored, external, anecdotal, or independently validated.
5. Present each viable option with concrete benefits, costs, and worst plausible failure.
6. Give a recommendation and detailed reasoning. A recommendation must remain visibly distinct from the decision.
7. Explain the effect on guides, graph nodes, prompt routing, safety gates, and regression cases.
8. State that no answer means current policy remains unchanged.
9. Record only the explicit answer. Never infer approval from silence, prior general enthusiasm, a model verdict, or the suggested default.
10. Commit the resulting ledger transition and its tests to Git before treating the decision as durable development guidance.

If direct conversation is unavailable, the suggestion remains pending and production policy remains unchanged.

## r03 workflow

The next Guide Packet is not another review of unchanged r02. It follows this sequence:

1. Create the three-ledger governance implementation and commit it.
2. Record the r02 rejection and all five current suggestions.
3. Repair citations, cross-guide provenance, certainty labels, priority ordering, exposed product-policy provenance, and missing regression coverage without changing owner policy.
4. Build r03 from those repairs.
5. Run Opus compilation, independent Codex audit, and Fable adjudication only if material disagreement remains.
6. If r03 reaches the owner gate, ask Joel directly about every substantive decision card, one at a time, using the complete decision brief. The existing five cards all require an explicit owner answer unless r03 removes or materially replaces one.
7. Record approved decisions in `APPROVED-THERAPY-LESSONS`; record declined decisions as terminal suggestions without creating approval entries.
8. Modify active guides only within the approved scope, rerun affected regressions and full release gates, then mark approvals implemented with commit and verification evidence.

## Validation and failure behavior

`scripts/verify-therapy-lessons.mjs` will expand from one-file coverage to a three-ledger governance gate. It will require:

- valid structured metadata and UTC timestamps;
- globally unique event, suggestion, and approval IDs;
- exactly one suggestion for each latest substantive Guide Packet decision;
- correct packet and decision identity;
- required readable sections for every suggestion and approval;
- allowed state transitions and consistent cross-file links;
- a reason and next action for every non-active or review-blocked suggestion;
- every blocking/review finding mapped to a suggestion or explicit packet-level remediation;
- owner-facing options, pros, cons, evidence uncertainty, recommendation, and reasoning;
- no approval without one matching suggestion and `decisionSource: "direct-user-conversation"`;
- no model-originated, inferred, duplicate, or orphan approval;
- no `implemented` approval without a commit identifier and verification evidence;
- no suggestion marked implemented unless its approval is implemented;
- the root `AGENTS.md` decision-protocol marker.

The package verifier will continue to run this gate. Negative regression tests will cover missing suggestions, duplicate identities, unknown decisions, malformed timestamps, invalid status, missing rejection explanation, unmapped findings, missing trade-offs, approval without a suggestion, model-origin approval, implementation without evidence, and inconsistent cross-file state.

On failure, validation reports the exact ledger, entry ID, and violated invariant. It never repairs approval state automatically.

## Git and future learning

The design specification, ledgers, validator, tests, and root agent protocol are committed deliberately. Future agents must read the three ledgers before proposing guide changes. A later suggestion should cite prior suggestion and approval IDs when it extends, contradicts, or supersedes earlier learning.

Git provides authorship, ordering, reviewable diffs, and rollback. It does not replace the owner-decision gate. History can show what changed; only Joel's explicit direct-conversation decision can authorize therapy-policy approval.

## Non-goals

- No r02 lesson becomes active through this governance work.
- No rejected Guide Packet becomes installable through a ledger edit.
- No model receives authority to approve therapy or safety policy.
- No personal therapy conversation transcript is stored in Git.
- No owner decision is bundled, assumed, or manufactured to accelerate r03.
- No existing guide, graph, prompt, or runtime routing behavior changes until an approved suggestion is implemented and verified separately.
