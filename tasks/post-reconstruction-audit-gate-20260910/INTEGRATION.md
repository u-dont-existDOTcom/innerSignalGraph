# Post-reconstruction audit gate

Status: implementation complete on draft PR #49, branch `codex/private-case-import-20260909`, starting at exact remote head `808bb113268136a15ecc325b849cfec7a5581b65` and preserved draft/open/unmerged.

## Binding boundary

`src/supervisor/private-candidate-lifecycle.mjs` is the runtime authority. A substantive repair creates a new immutable child candidate in `reconstructed_pending_audit`; it has an empty audit history, cannot inherit the parent's approval, and cannot be delivered until a fresh independent audit of its exact ID/version/bytes passes and is explicitly approved. The reconstruction producer cannot act as that independent auditor.

The encrypted record stores candidate lineage and version-bound audit history. The immutable handoff packet separately exposes continuation fidelity and the current candidate, audit, reconstruction-audit, and delivery-gate state. Existing pre-binding handoffs remain readable but cannot be treated as carrying current-version approval.

## Verification checkpoint

- Eight required lifecycle regressions: 8/8 pass.
- Focused private candidate/private continuity acceptance: 22/22 pass; the constitution/context and audit-harness set: 56/56 pass; therapy lesson verification: 5/5 pass.
- Complete Node 24.18.0 package verification: 1,047/1,047 tests pass, with graph, authoring, immutable archive, mock pipeline, web, autopilot, fingerprint, package-hygiene, autonomous-loop, workflow, repository, and publication checks green.
- Hosted CI gate: the exact current PR head must have `workflow-policy`, `deterministic-package`, `codeql-javascript`, and the nested `CodeQL` check green. Implementation head `41c0e0f07aa0c42086ca69ddb3bac1804f7b9b76` passed all four before this closeout record; the closeout head must independently pass the same gate.

No real candidate, private audit, provider call, merge, deployment, installation, stable promotion, or clinical claim is part of this task.
