# Private case mutation and audit orchestration

Status: complete on draft PR #49, branch `codex/private-case-import-20260909`, starting from exact remote head `e544c1bc1089b144c0a3e6e36668e98fc0c06597`.

## Objective

Preserve the existing read-only Private Continuity MCP and add the complementary encrypted writer/controller required to append provenance-bearing transcript amendments, persist exact-version audits, create immutable repair candidates, enforce independent auditing and the two-cycle maximum, transition approval/sent states, and publish a new immutable read-only handoff.

The real operation is authorized but its source text, candidate text, audit prose, private manifests, and private-derived hashes remain outside Git. Public closeout may name only owner-authorized opaque IDs and non-content state facts.

## Implemented result

- `InnerSignal Private Continuity` remains a ten-tool read-only MCP. No mutation operation is registered there.
- Transcript completion is an append-only operation that atomically stores an immutable exact source artifact and a provenance-bearing amendment. The raw target turn remains unchanged; handoff packet v2 carries raw, amendment, and effective views separately.
- Candidate audit evidence is bound to immutable candidate ID, version, and exact bytes. Reconstruction creates a new child, preserves the failed parent audit, supersedes the parent, and starts with an empty audit history and a closed delivery gate.
- Reconstructed candidates require a fresh context distinct from the producer and explicit coverage of all repair-induced-error checks. The third reconstruction is rejected after repair cycle 2.
- Approval and sent transitions are separate, exact-version-bound backend operations. The operator transport uses mode-`0600` files outside the checkout and an environment-owned bearer token; receipts expose no private text or private-derived hashes.
- The owner-authorized private sequence completed against the encrypted host record. The original raw target and candidate v1 were independently digest-compared before and after; the completion amendment and exact source range are present; the failed v1 audit is persisted; and candidate v2 is immutable version 2, repair cycle 1, `reconstructed_pending_audit`, with zero audits, no approval, and no sent marker.
- New immutable handoff `handoff:e9338ec6-94de-49a7-9179-208684ca2cf9` is schema v2, continuation-safe, and returns the exact v2 through the authorized read-only loader. Its next action is `FRESH_INDEPENDENT_AUDIT` and delivery remains blocked.
- A newly created ChatGPT conversation received only the new handoff ID, invoked the connected `InnerSignal Private Continuity` tool, and confirmed continuation safety, exact-text retrievability, version 2, repair cycle 1, `reconstructed_pending_audit`, zero v2 audits, and the fresh-audit next action without quoting private content or performing a mutation.
- The hosted read-only service was rebuilt from implementation checkpoint `c70224714fa3d53164fe03f1bf674813c0582c7f`; its health endpoint reports runtime `0.15.2` and production authentication ready.
- Temporary operator credentials, token, requests, private receipts, and private migration scripts were removed after verification. The encrypted vault and immutable handoff remain.

## Verification

- Focused private acceptance: 25/25 tests passed.
- Complete Node 24.18.0 package gate: 1,050/1,050 tests plus graph, archive, runtime, repository, workflow-policy, and package checks passed at implementation checkpoint `c70224714fa3d53164fe03f1bf674813c0582c7f` and again on the final documentation tree.
- Therapy lesson verification: 5/5 passed.
- Local publication audit on the final documentation tree: 39,215 scanned records, zero findings.
- Private preservation/retrieval assertions: all passed; the content-free evidence is `PRIVATE-OPERATION-RECEIPT.json`.
- Fresh ChatGPT read-only retrieval: passed against the newly deployed handoff; no audit, approval, repair, sent transition, or private-content quotation occurred.
- Exact-final-head hosted checks are recorded in the PR closeout rather than embedded in a commit that cannot name itself.

## Continuation boundary

Do not audit candidate v2 from this public record, and do not approve, send, or reconstruct it yet. Start a fresh authorized ChatGPT session, call `load_handoff` with `handoff:e9338ec6-94de-49a7-9179-208684ca2cf9`, audit the exact returned v2 including every repair-induced-error check, and persist that audit only through the separate mutation/controller path. The auditor context must differ from the v2 producer context. Keep PR #49 draft/open/unmerged; no public-app deployment, installation, stable promotion, or clinical claim is authorized.
