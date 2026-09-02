# InnerSignal Commons MVP implementation plan

**Date:** 2026-08-30  
**Design authority:** `docs/superpowers/specs/2026-08-30-opt-in-community-learning-design.md`  
**Scope:** Executable invitation-pilot workbench for the unique InnerSignal consent and learning layer. It is not a production social network and does not replace the planned Discourse substrate.

## Objective

Prove the complete non-authoritative path:

```text
pseudonymous peer conversation
→ deliberate Field Note
→ contribution-specific consent receipt
→ privacy-thresholded Learning Card
→ withdrawal and recomputation
→ hashed, proposal-only export
```

No path may write therapy lessons, prompts, guide graphs, Guide Packets, `stable`, or installed runtime policy.

## Build slices

1. **Contracts and storage**
   - versioned post, Field Note, consent, receipt, Learning Card, and proposal schemas;
   - first-party local JSON snapshot plus bounded append-only event ledger;
   - hashed session and recovery secrets;
   - atomic writes and serialized mutations.
2. **Commons interaction**
   - invitation-capable pseudonymous access;
   - adults-only participation acknowledgment;
   - rooms, response contracts, replies, and separate support/evidence reactions;
   - no direct messages, public indexing, followers, or engagement ranking.
3. **Safety and moderation**
   - deterministic holds rather than automatic adjudication;
   - key-protected human moderation queue and decisions;
   - network mode fails closed without invitation and moderation secrets;
   - CSRF protection, no-store/noindex headers, and login rate limiting.
4. **Learning Foundry MVP**
   - delayed outcome windows, confounders, downsides, and causal-confidence capture;
   - no raw conversation mining;
   - shared community-derived cards suppressed below three independent contributors;
   - no verbatim Field Note context, confounder, or adverse prose in shared cards;
   - proposal exports fixed to candidate-only, proposal-only, non-writable.
5. **Integration and verification**
   - ordinary local launcher starts Commons on separate loopback storage and port;
   - standalone Docker path for a later private pilot;
   - schema, boundary, store, HTTP, UI, moderation, withdrawal, and non-activation tests;
   - Git task state and continuation handoff.

## Acceptance criteria

- Ordinary Commons posts remain `conversationOnly: true`.
- No consent checkbox is preselected.
- Adults-only and participation acknowledgments are explicit.
- Field Notes without learning consent remain private drafts.
- External-researcher sharing is impossible without research-protocol consent.
- Community-derived shared cards require at least three independent contributors.
- Shared cards never echo raw Field Note prose.
- Withdrawal recomputes cards and marks affected proposal records stale.
- Network binding fails without invitation and moderator secrets.
- Human moderation can publish, remove, resolve, or escalate held material.
- Proposal schema structurally fixes `candidateOnly=true`, `activation=proposal-only`, and `runtimeWritable=false`.
- Community runtime contains no authority-path references.
- Existing private therapy and hypnosis state are not imported.

## Explicitly deferred

- production Discourse deployment and SSO;
- PostgreSQL, distributed locking, backups, and high availability;
- moderator accounts and graphical console;
- legal/privacy review and research ethics process;
- email/recovery operations;
- AI extraction, contributor verification of AI summaries, and external-evidence review;
- any route from community learning into active therapy policy.
