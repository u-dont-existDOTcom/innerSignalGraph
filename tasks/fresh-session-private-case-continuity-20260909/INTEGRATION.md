# Fresh-session private case continuity

Status: HISTORICAL LOCAL IMPLEMENTATION SLICE; its external blocker was resolved by the follow-on real import and hosted acceptance on draft PR #49. Starting head: `b4eee54e6ed3b8e0b18fa5ca8f1cfb365362dbc1`.

Supersession, 2026-09-10: `tasks/real-private-case-import-20260909/INTEGRATION.md` and `tasks/universal-handoff-binding-20260909/INTEGRATION.md` are current. They record the real encrypted import, semantic episode completeness, hosted OAuth/ACL/key boundary, connected ChatGPT plugin, and actual new-conversation `load_handoff` result. The historical local-only evidence below remains accurate for its earlier slice but is not the current availability status.

## Outcome boundary

Implement exact encrypted private continuity behind explicit authorization and key-provider interfaces, plus a minimal MCP/read-service adapter for fresh supervisors. Public Git may contain only code, schemas, documentation, and synthetic fixtures. Real private case bytes, private-derived hashes, keys, tokens, and credentials remain outside Git.

Local fresh-process continuity and direct MCP-client execution are necessary but do not prove that a fresh ChatGPT conversation can execute the tool. A truthful ChatGPT availability claim additionally requires a reachable HTTPS endpoint or approved secure tunnel, conforming user authentication, plugin registration, and an actual read-only tool call from a newly created post-registration chat.

## Current gap

The starting store encrypts one record and can preserve transcript/state/tracker/journal/diff, but it requires raw key bytes and a caller-supplied boolean at construction. It has no first-class candidate artifact, no explicit state/diff/evidence/bootstrap interface, no independent request authorization, no MCP tool boundary, and no fresh-process acceptance gate. The canonical handoff therefore names an action that no new conversation can actually call.

## Required closeout evidence

- RO-01 through RO-09 artifact/evidence matrix.
- Focused storage, auth, MCP, audit, context, UI, and leak tests.
- Complete package and publication gates on the final changed state.
- Fresh remote-head reconciliation before push.
- Exact pushed head and exact-head hosted Verify, workflow-policy, and CodeQL readback.
- Explicit status for real private-case import, deployment, OAuth/registration, and a post-registration fresh-ChatGPT tool call.

No deploy, install, stable promotion, provider spend, merge, clinical claim, or autonomous re-summarization of the real case is authorized.

## Implementation result

The private record is now a versioned encrypted envelope containing separate structured state, diff history, append-only exact transcript turns, journal/tracker data, current episode, and immutable versioned candidate responses. Explicit read/write operations and an all-in-one `loadCaseContext` bootstrap are authorization-gated. The bootstrap fails with `CASE_NOT_CONTINUATION_SAFE` unless it can recover state, the last diff, the constitution reference, a pending exact candidate, and the complete contiguous active episode from its declared semantic start through the latest turn.

Authorization and key acquisition are injected. The repository-provided development provider reads an external mode-0600 JSON credential file, compares SHA-256 bearer-token digests in constant time, grants case-scoped capabilities, and supplies per-case base64 encryption material only after authorization. It is deliberately marked `productionReady: false` and uses an explicit, opt-in `development_external_file` assurance rather than claiming OS-backed reauthentication. Repository or symlinked credential paths are rejected; no raw key or token is committed.

A separate read-only MCP endpoint exposes `load_case_context`, `get_recent_verbatim`, `retrieve_case_evidence`, and `get_candidate_response`. A fresh MCP client process recovered the exact synthetic private case using only the stable case ID and authorized transport. This proves the repository-native bridge, not public ChatGPT availability.

## Verification result

- Fresh-session acceptance: 10/10 passed under Node 24.18.0, including process restart, unauthorized/wrong-key denial, ciphertext-at-rest, exact candidate audit, complete-episode context, historical provenance retrieval, handoff validation, separate MCP client/server processes, and non-vacuous public/private scanning.
- Affected storage/context/audit/config/server suite: 99/99 passed.
- Complete package: PASS under Node 24.18.0; 1,017/1,017 automated tests, 29/29 graph regressions, 5/5 therapy lessons, deterministic authoring, immutable packet checks, syntax, mock replays, web smoke, runtime fingerprint, package hygiene, and autonomous-development gates all passed.
- `git diff --check`: PASS.
- One earlier complete-suite attempt exposed execution-environment Node 26 inheritance, a five-second loaded-process readiness budget, and two reviewed posture digests. Those were repaired; the authoritative Node 24 package run above is green. The later app context rollover lost a completed process handle, so the authoritative package was run again rather than treating incomplete output as evidence.

## Historical blocking obligations — resolved by the PR #49 follow-on

At this earlier checkpoint the real private case was not imported and no stable real case/candidate IDs had been created because that repository slice did not contain an authorized canonical private source or production credential boundary. The local development MCP had not yet been deployed over reachable HTTPS, protected by production OAuth/resource metadata/PKCE, registered in ChatGPT, or executed from a newly created authorized ChatGPT conversation. Those obligations are now resolved by the current PR #49 ledgers named above; a fresh authorized ChatGPT session is genuinely able to retrieve the real handoff.

The completed follow-on order was: provision the hosted key provider and case-scoped authorization; import the real record and compile the immutable handoff; deploy the read-only MCP over HTTPS; configure and verify OAuth; register/connect it in ChatGPT; then create a new chat and execute `load_handoff` with only the stable handoff ID. The pending-response audit is now the next task.

The final all-history publication audit, reconciled pushed head, hosted workflow/CodeQL readback, and public-safe PR receipt are recorded externally against the containing commit so adding the receipt cannot change the head it attests to.
