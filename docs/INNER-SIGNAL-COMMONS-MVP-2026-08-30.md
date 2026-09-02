# InnerSignal Commons MVP implementation report

## Implemented

The branch contains a separate executable Commons service and browser client with:

- invitation-capable pseudonymous sessions and one-time recovery codes;
- adult and participation-boundary acknowledgment;
- rooms, response contracts, replies, and separate support/evidence reactions;
- deterministic safety holds and a key-protected human moderation API;
- structured Field Notes with immediate and delayed outcomes;
- granular per-contribution consent grants and Contribution Receipts;
- withdrawal, card recomputation, and stale-proposal marking;
- privacy-thresholded Community Learning Cards;
- schema-validated, hashed, proposal-only exports;
- participant data export;
- current-content removal and account deactivation with explicit disclosure that pseudonymous append-only event metadata may remain pending an approved production retention/deletion policy;
- loopback startup beside the existing private InnerSignal service;
- standalone container configuration for later private deployment.

## Preserved boundaries

- Private therapy and hypnosis browser state are not imported.
- Ordinary posts are conversation-only and are never used to build cards.
- Community-derived cards are not participant-visible until they meet the three-independent-contributor minimum and have been human-reviewed; this MVP intentionally provides no mechanism that can grant that review status.
- Shared cards use aggregate counts and generic disclosure counts, not verbatim Field Note prose.
- Product-improvement-only consent does not feed Commons aggregation or participant-facing Learning Cards.
- Learning Cards carry `runtimeAuthority: "none"`.
- Proposal exports cannot activate or write runtime behavior.
- No new therapy lesson, graph node, prompt, Guide Packet decision, or release authority is created.

## Verification completed

The original bounded local suite passed 11/11 contract, store, HTTP, moderation, privacy, withdrawal, proposal, launcher-integration, and UI tests available without repository dependencies. GitHub passed repository workflow policy, AJV schema/example verification, the complete test and deterministic package gate, clean-worktree enforcement, and the workflow CodeQL JavaScript job for executable commit `6c983eb93c1c0392c2f19fdc2c4ac3593a762f0f`. A later exact-head independent review of `e70ea3648f40163ce41ba8933f9d0f670b36a769` found that the separate GitHub Advanced Security CodeQL check still reported three new alerts; the task state records the bounded repair and exact-head re-verification status.

## Deployment status

Not production-ready. The local service is a workflow prototype for the bespoke consent/provenance layer. Production conversation should compose with a mature self-hosted Discourse deployment after privacy, moderation, recovery, operational, and legal gates are satisfied.
