# DEV-R001 latency benchmark task state

Task ID: `DEV-R001`

Status: `REASONING_ACCEPTED_COMPLETE`

## Terminal acceptance

- Extra High review `rr-innersignal-dev-r001-latency-repair-20260831-002` accepted DEV-R001 as complete at exact repaired head `1c4487c212a511822dd3836f5015b98ab7987af9`.
- Worker-to-contract alignment was `GREEN`; contract-to-owner alignment was `MATCH`; operational alignment was `ADEQUATE`.
- Scientific adequacy was not assessed and remained unchanged. Release adequacy was not authorized.
- Draft PR #17 remains the unmerged evidence boundary. Its description was reconciled mechanically to the accepted head and repair verification without changing its title, base, draft state, open state, or head.

## Goal

Build a repeatable mock Fast/Reviewed latency benchmark and remove only the discarded pre-audit deterministic graph-planning pass from non-Fast tier orchestration. Preserve every model/provider call, route, case formulation, graph plan, response contract, safety property, and user-facing semantic result.

## Authority and baseline

- Execution base: closeout head `d49321b8d35939858ca4f756bfebcdd36f48275c` on draft PR #16.
- Task branch: `codex/dev-r001-latency-benchmark-20260831`, stacked on `codex/retire-stale-obsidian-lock-20260831`.
- Baseline Reviewed orchestration: `runUnauditedCaseFormulation` extracted and planned once before tier routing; every non-Fast path then audited the snapshot and planned it a second time. The first plan was discarded.
- Provider-call boundary: Fast remains extraction plus realization; Reviewed remains extraction plus independent case audit plus realization.
- Therapy, graph, prompt, safety, epistemic, provider-role, roadmap, release, and stable policy are unchanged.

## Implemented

- Added a snapshot-only extraction primitive that preserves the prior unaudited snapshot and extractor metadata without loading or planning a graph.
- Kept `runUnauditedCaseFormulation` compatible for existing non-tiered callers by composing the new primitive with one planning pass.
- Routed the tiered pipeline from the extracted snapshot before planning.
- Timed and executed exactly one plan for Fast, or exactly one post-audit plan for Reviewed/Deep/Forensic.
- Made Fast `performance.planningMs` numeric instead of `null`.
- Added benchmark-only provider-call and planning-pass observation without modifying production provider behavior or result semantics.
- Added a mock-only three-iteration Fast/Reviewed benchmark and retained its non-private structural evidence in `BENCHMARK-RESULTS.json`.

## Benchmark result

- Fast semantic hash before and after: `f77f02c54295cc0c31c38e47f4670637335ad06c0c28a6f0a9f4dd31c6e7f286`.
- Fast provider stages: `case_extraction`, `realization`; calls `2`; planning passes `1`.
- Reviewed semantic hash before and after: `2b93a41441c91842590e8d1a99a4cd69862b640fd98e8d41d5b05d4d79d6d411`.
- Reviewed provider stages: `case_extraction`, `case_audit`, `realization`; calls `3`; planning passes reduced from `2` to `1`.
- Every required stage timing is retained and numeric. Wall-clock observations are evidence only, never a routing input or hard acceptance threshold.

## Verification boundary

The benchmark command and focused affected tests must be green before the final diff is frozen. The execution receipt and exact-head draft PR carry the one final package-gate result, repository audit, test-efficiency summary, and hosted-check readback; they are not inferred merely from this tracked checkpoint.

## Reasoning-review repair

- Extra High review classified head `11fa170b249a75188e84cc53f4f5b67aaa1f2463` as `PARTIAL`: successful Fast and Reviewed behavior was accepted, but a non-Fast graph-bundle failure could occur after the independent audit call instead of before it.
- The bounded repair adds a non-planning graph-availability preflight after non-Fast tier classification and before both the routing-completed progress event and case audit.
- The preflight does not derive or cache a plan. Successful non-Fast requests still perform their one normal post-audit graph load and planning pass; Fast does not run the extra preflight.
- Deterministic failure regression coverage requires a failing Reviewed preflight to record only `case_extraction`, zero planning passes, no routing-completed event, and propagation of the original graph error. A Fast regression proves the preflight is never invoked there.
- This repair does not modify the retained benchmark artifact, successful provider stages, therapy semantics, graph authority, prompts, safety policy, release state, or `stable`.

## Recovery rule

DEV-R001 is terminally accepted at `1c4487c212a511822dd3836f5015b98ab7987af9`. Do not repeat the optimization, repair, benchmark, or package gate. Read the exact review receipt before using this branch as the base for later stacked work. No merge, release, or `stable` promotion is implied.
