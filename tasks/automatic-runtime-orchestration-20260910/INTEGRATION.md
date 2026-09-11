# Automatic private-turn runtime orchestration

Status: active on branch `codex/automatic-runtime-orchestration-20260910`. The generic implementation checkpoint `a2689b6` and completed Louka v3 checkpoint `5564a2d` were combined in the owner-approved two-parent merge `b97362d1b9948d0cbe7d07cfc443c73146b810d8`. The later content-free Louka receipt correction was integrated without runtime overlap, and implementation-containing PR head `49cacebff33bb99aa525a38bf8af6811991ac935` passed the complete local and hosted gates. PR #49 remains draft/open/unmerged.

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
- Pre-merge repository audit: zero errors and one pre-existing hosted-enforcement warning. Pre-merge Git publication audit: zero findings across 45,982 scanned records.
- Post-merge verification of exact commit `b97362d1b9948d0cbe7d07cfc443c73146b810d8`: complete package PASS with 1,074/1,074 tests and all subordinate gates; repository audit zero errors with the same pre-existing hosted-enforcement warning; Git publication audit zero findings across 47,126 scanned records (4 refs, 71 commits, 2,948 objects, 2,211 blobs).
- Content-free remote receipt reconciliation produced containing head `49cacebff33bb99aa525a38bf8af6811991ac935`; its repository audit had zero errors and publication audit had zero findings across 49,414 scanned records.
- Exact-head hosted checks passed on `49cacebff33bb99aa525a38bf8af6811991ac935`: workflow-policy run `34551551419` / job `103115344707`; deterministic-package run `34551551392` / job `103115344574`; codeql-javascript run `34551551480` / job `103115345084`; nested CodeQL check `103115634808`.
- The complete gate initially detected two regressions introduced at the runtime seam: producer session provenance was counted as therapeutic semantics, and an eager hosted-JWT import broke the dependency-free recovery copy when private runtime was disabled. Operational provenance is now excluded from the therapy-policy fingerprint and the hosted provider is imported only after explicit hosted-mode selection. Focused recovery/runtime/benchmark regressions pass 9/9 and the complete gate passes after both repairs.
- Synthetic coverage includes one-message approved delivery, automatic FAIL/repair/re-audit, unavailable-independent-auditor denial, exact-version binding, two-cycle cutoff and discriminator, transient retry and exhausted fail-closed behavior, restart recovery, concurrent replay idempotence, authorization before key/inference access, strict audit output, information-firewall inspection, ciphertext-at-rest, and no Git/GitHub dependency in the ordinary path.

## Remaining frontier

1. Keep the automatic-runtime task active with the completed Louka checkpoint nested beneath it, as explicitly approved by the owner.
2. Keep PR #49 draft/open/unmerged. GitHub is authoritative for the final documentation-only containing head and its checks.
3. The real v3 remains outside this task's audit/delivery scope and still requires a fresh independent audit before approval or delivery.
