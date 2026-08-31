# DEV-R001 latency benchmark task state

Task ID: `DEV-R001`

Status: `REVIEW_HANDOFF_BOUNDARY`

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

## Recovery rule

Inspect the task branch, this checkpoint, `BENCHMARK-RESULTS.json`, and the latest exact-head review receipt. If the branch is not yet committed, resume the first missing deterministic gate. If it is committed and pushed, do not repeat the optimization or full package gate; wait for the bounded Extra High review. Stop rather than changing therapy semantics, tier policy, provider calls, graph behavior, prompts, safety, release state, or `stable`.
