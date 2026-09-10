# Private case mutation and audit orchestration

Status: active on draft PR #49, branch `codex/private-case-import-20260909`, starting from exact remote head `e544c1bc1089b144c0a3e6e36668e98fc0c06597`.

## Objective

Preserve the existing read-only Private Continuity MCP and add the complementary encrypted writer/controller required to append provenance-bearing transcript amendments, persist exact-version audits, create immutable repair candidates, enforce independent auditing and the two-cycle maximum, transition approval/sent states, and publish a new immutable read-only handoff.

The real operation is authorized but its source text, candidate text, audit prose, private manifests, and private-derived hashes remain outside Git. Public closeout may name only owner-authorized opaque IDs and non-content state facts.

## Recovery checkpoint

- Git baseline: `e544c1bc1089b144c0a3e6e36668e98fc0c06597`.
- Current step: implement the append-only amendment schema and separate mutation/controller surface with synthetic tests.
- Then: run focused gates, apply the private sequence outside the checkout, independently verify preservation and v2 read-only retrieval, update canonical handoff/current state, run the full gate, commit, push, and wait for exact-head hosted checks.
- Must remain true: Private Continuity is read-only; original raw turn and v1 are unchanged; v1 audit is failed; v2 is repair cycle 1, `reconstructed_pending_audit`, unapproved, unsent; a fresh independent session—not the v2 producer—must audit v2.

## Verification

Pending.
