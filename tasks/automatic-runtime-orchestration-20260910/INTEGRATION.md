# Automatic private-turn runtime orchestration

Status: active in isolated worktree `innerSignalGraph-runtime` on branch `codex/automatic-runtime-orchestration-20260910`, based on exact draft PR #49 head `a98f9f7d46ed8233cf638b76121d7b293ccef9b4`. The generic implementation checkpoint is `a2689b6`; completed Louka v3 commits through `5564a2d` are locally composed for final verification.

## Objective

Make an ordinary InnerSignal message automatically traverse private intake persistence, immutable candidate production, blind independent exact-version audit, at most two repair-and-re-audit cycles, approval and exact delivery, or a final smallest discriminating question. The owner does not move handoffs, audit prose, candidate text, or lifecycle state, and ordinary turns do not touch GitHub.

## Coordination boundary

The separate authorized Louka task completed and published only its public-safe state at `5564a2d`. This task did not read, write, audit, or reconstruct that case. It implements and tests only generic code with synthetic fixtures and preserves the separately completed v3 state: maximum repair cycle 2, pending a fresh independent audit, unapproved, and unsent.

## Current authority resolution

An older supplied note requested a 48-call A/B/C discovery experiment before making multi-model behavior mandatory. The owner's later direct instruction now explicitly requires this production runtime path. That newer instruction controls this task; the older experiment remains optional future evaluation and is neither a completion prerequisite nor authorization for paid calls or real-case development traffic.

## Recovery frontier

1. Inspect the existing private store, lifecycle controller, provider/session seam, and server route.
2. Write the architecture and persisted state contract.
3. Implement the restart-safe controller and provider adapters.
4. Wire the production therapy route while preserving the read-only continuity service.
5. Add the required synthetic end-to-end, failure, isolation, persistence, and no-GitHub tests.
6. Integrate the separately completed Louka v3 durable result without exposing private material.
7. Run focused and full verification, publication audit, update this handoff, commit, and update draft PR #49.

No completion claim is valid until all seven steps have evidence.

## Implemented boundary

- `src/supervisor/private-runtime-turn-lifecycle.mjs` validates the explicit state/event ledger and exact inbound/discriminator/delivery digests.
- `src/storage/private-case-store.mjs` migrates encrypted records to schema v6 and performs atomic intake, candidate/state, audit/decision, and exact-delivery mutations with append-only validation.
- `src/supervisor/private-therapy-turn-controller.mjs` resumes the persisted frontier, records bounded invocation attempts, prohibits context reuse, drives two repairs at most, and fails closed on operational exhaustion.
- `src/supervisor/private-therapy-model-runtime.mjs` composes the existing tiered producer with packet-only audit/repair requests. The audit allowlist excludes producer context, hidden reasoning, traces, rationale history, and prior verdicts.
- API providers declare fresh stateless request isolation; compatible Claude CLI invocations mechanically disable tools, filesystem-capable integrations, persistence, and additional turns. Codex CLI is explicitly ineligible for private auditing.
- The loopback server, CLI serve command, and foreground autopilot load the existing authorization-first private access service from external local credentials or hosted OAuth/ACL/managed secrets. Non-mock therapy without that boundary returns 503.
- `InnerSignal Private Continuity` is unchanged and still registers only its ten read-only tools.
- Redacted general ledgers no longer retain response prose or reasoning evidence, and the automatic private path forces the underlying pipeline ledger off.

## Verification

- Pre-composition focused runtime/storage/server suite: 58/58 on Node 24.18.0.
- Post-composition private continuity/runtime/server suite: 74/74 on Node 24.18.0.
- Final private-case acceptance: 47/47 on Node 24.18.0.
- Final graph regression gate: 29/29; therapy lesson verification: 5/5 substantive lessons and 4 active runtime lessons documented.
- Final complete package verification: PASS, including 1,074/1,074 automated tests, immutable packet checks, formulated A001 and H001 replay, web smoke, fake-CLI autopilot smoke, runtime fingerprint, package hygiene, and clean-tree restoration.
- Final repository audit: zero errors and one pre-existing hosted-enforcement warning. Final Git publication audit: zero findings across 45,982 scanned records (4 refs, 70 commits, 2,912 objects, 2,192 blobs).
- The complete gate initially detected two regressions introduced at the runtime seam: producer session provenance was counted as therapeutic semantics, and an eager hosted-JWT import broke the dependency-free recovery copy when private runtime was disabled. Operational provenance is now excluded from the therapy-policy fingerprint and the hosted provider is imported only after explicit hosted-mode selection. Focused recovery/runtime/benchmark regressions pass 9/9 and the complete gate passes after both repairs.
- Synthetic coverage includes one-message approved delivery, automatic FAIL/repair/re-audit, unavailable-independent-auditor denial, exact-version binding, two-cycle cutoff and discriminator, transient retry and exhausted fail-closed behavior, restart recovery, concurrent replay idempotence, authorization before key/inference access, strict audit output, information-firewall inspection, ciphertext-at-rest, and no Git/GitHub dependency in the ordinary path.

## Remaining frontier

1. Record the reviewed conflict resolution as a merge commit after the required owner approval. The resolution preserves externally supplied identity/time-unavailable evidence only as blocking FAIL evidence, requires a known and actually available independent auditor for PASS, and keeps this automatic-runtime task active while nesting the completed Louka checkpoint.
2. Update the draft PR branch without changing draft status, then verify the exact pushed head and hosted checks.
3. Close the active lesson contract/current checkpoint only after the pushed exact-head checks pass. The real v3 remains outside this task's audit/delivery scope.
