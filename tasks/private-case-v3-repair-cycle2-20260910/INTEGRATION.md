# Private v3 repair cycle 2

Status: complete on draft PR #49, branch `codex/private-case-import-20260909`, starting from exact head `a98f9f7d46ed8233cf638b76121d7b293ccef9b4`.

## Objective

Persist the externally supplied exact-v2 failure without fabricating unavailable auditor metadata, reconstruct the owner-supplied exact v3 as the maximum repair cycle, and publish a new immutable read-only handoff for a fresh independent audit.

The real candidate and audit material remains outside Git. This ledger may record only generic behavior, opaque identifiers after persistence, and non-content state facts.

## Implemented result

- The generic audit contract now represents an unavailable external auditor context and completion time explicitly, records when and by whom the result was supplied, and preserves the producer context from which independence was reported. This evidence form is restricted to a blocking substantive FAIL and is mechanically ineligible for approval.
- Candidate/audit immutability, exact-ID/version/text binding, producer/auditor separation, repair-induced-error coverage, separate approval and sent transitions, and the two-repair maximum remain enforced. `InnerSignal Private Continuity` remains the same ten-tool read-only MCP.
- The externally supplied fresh-independent FAIL is persisted as audit `audit:993b2180-c6e2-4dce-8e51-6d613fa731a2` against exact v2 `candidate:repair:f45e8a19-47b5-49fb-8a14-c5c66482875c`, version 2. V2 is superseded, not approved, and not sent.
- V3 `candidate:repair:abdd6d89-68fa-4e4e-bb89-96b7d206327b` is an immutable version-3 child of v2, rooted at v1, at maximum repair cycle 2 with status `reconstructed_pending_audit`. It has zero audits, no approval, and no sent marker.
- Private byte comparisons proved that v3 differs from v2 only by the authorized interpersonal-attunement safeguard. Separate assertions found no causal-calibration regression, rejection-prevention claim, leading of Q001, merged internal entities, prescription to pursue intimacy or touch, change to false-self uncertainty, or change to unresolved case/trajectory state.
- Immutable handoff `handoff:da297f25-1ae4-4494-b8e1-63591e438d88` is continuation-safe, exposes exact v3 as current pending through the authorized read-only loader, and closes delivery with next action `FRESH_INDEPENDENT_AUDIT`.
- A newly created ChatGPT conversation received only the new handoff ID, called the connected read-only Continuity tool, and reported the exact v3 ID, version 3, repair cycle 2, status, zero audits, not-approved/not-sent state, and fresh-audit next action without quoting candidate text or mutating the case.
- The hosted service was rebuilt from implementation checkpoint `978f586dc95d1fb8b7dd5cc0240fcb3faa623ba4`; production OAuth readiness and the read-only service remained healthy. Temporary write scope, operator client/token, request/receipt files, and private scripts were removed after verification.

## Verification

- Focused lifecycle/orchestration checks: 14/14 passed.
- Complete private-case acceptance: 27/27 passed.
- Complete Node 24.18.0 package verification: 1,052/1,052 tests plus graph, archive, runtime, package, repository, and workflow gates passed.
- Private persistence, immutable-lineage, narrow-delta, unchanged-state, continuation-safety, and delivery-gate assertions: passed.
- Hosted service health and production authentication readiness: passed.
- Fresh ChatGPT read-only retrieval: passed; no audit, approval, repair, sent transition, or private-content quotation occurred.
- Local publication audit: 41,463 records scanned with zero findings. The stricter hosted audit failed closed as incomplete because historical failed CodeQL run `34060739398` has no jobs and GitHub returns no log; this is a missing historical surface, not a private-material finding. The audit contract was not weakened or bypassed.
- Exact-final-head GitHub checks are recorded outside the commit that cannot name itself.

## Continuation boundary

Do not audit v3 from this public record or from its producer context. In a fresh authorized ChatGPT session, call `load_handoff` with `handoff:da297f25-1ae4-4494-b8e1-63591e438d88` and audit the exact returned v3 against the constitution and the complete repair-induced-error checklist. Persist any result only through the separate controller. Because v3 is repair cycle 2, a substantive failure cannot produce another repair candidate; route it to `DISCRIMINATE_OR_BLOCK`. Do not approve or send without a passing, approval-sufficient exact-version audit. Keep PR #49 draft/open/unmerged and keep all real case material and private-derived hashes outside GitHub.
