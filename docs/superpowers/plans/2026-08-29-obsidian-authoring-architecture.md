# Obsidian authoring architecture implementation plan

Status: active

Task: `obsidian-authoring-architecture-v1`

Branch: `codex/obsidian-authoring-architecture-20260829`

Baseline: `82b12b20c4a401b5e60999f981292c36fbaa8a53`

## Stage 0 — baseline and recovery controls

- Preserve the evidence commit.
- Record exact graph/source/map hashes and baseline gate results.
- Establish the exclusive active-task record, preflight, acceptance command, and task recovery state.
- Confirm no Obsidian importer exists and no work occurs on `stable`.

Exit evidence: baseline JSON, 12/12 graph cases, 387/387 tests, complete package `PASS`, zero publication findings.

## Stage 1 — contracts and parser tests

- Add exact-pinned Ajv and perform the official Mermaid parser Node 24 spike before retaining it.
- Add Draft 2020-12 schemas for manifest, current/proposal nodes and edges, proposal receipt, overlay, and Canvas subset.
- Implement canonical JSON, restricted YAML frontmatter, delimited payload parsing/rendering, exact identities/hashes, path/symlink rejection, and privacy boundary.
- Begin with positive fixtures and causal rejection tests.

Exit evidence: focused parser/security tests pass; schemas reject unknown/unclassified input.

## Stage 2 — read-only current projection

- Implement authoritative input discovery and `projection_input_sha256`.
- Generate current node, edge, source, regression, amendment, and decision notes; manifest; HOME/setup docs; and portable Base views.
- Add `project`, `validate`, and non-writing `check` commands.
- Prove two projections are byte-identical and authoritative input hashes remain baseline-identical.

Exit evidence: deterministic projection tests and drift mutation tests pass.

## Stage 3 — overlay migration and generated maps

- Inventory every semantic element in the old manual map.
- Create only source/owner-supported overlay items; stop on unproven authority.
- Generate the living Mermaid map from compiled graph plus overlays; parse and completeness-check it.
- Generate deterministic JSON Canvas with a visibly separate overlay group.
- Add `maps` and non-writing `maps-check`.

Exit evidence: complete classification, no silently lost graph/overlay material, exact two-run map/Canvas determinism.

## Stage 4 — proposal workflow

- Add proposal manifest and node/edge note parsing.
- Implement `proposal-new`, complete in-memory operations, stale-base checks, candidate compilation, graph regressions, coverage/provenance reports, deterministic receipts, and build/check output under ignored `.build`.
- Implement the complete field-policy table and `UNCLASSIFIED_SEMANTIC_CHANGE` guard.
- Test round-trip, source retention, stale-base, every field category, boundary coverage, exact questions, realization coverage, and private-data rejection.

Exit evidence: proposal build/check is deterministic and never writes canonical graphs.

## Stage 5 — Guide Packet adapter and reconciliation

- Add a narrow candidate-graph override to existing packet construction/verification.
- Build and verify a synthetic proposal packet while preserving exact canonical source bytes.
- Reuse existing owner-decision artifacts and prevent approval inference.
- Add exact approved-packet branch-only reconciliation with atomic writes and stale-base protection.
- Prove unapproved material cannot reconcile/install and no stable/install operation is invoked.

Exit evidence: focused Guide Packet integration tests and synthetic approved-fixture reconciliation pass.

## Stage 6 — integration, documentation, and acceptance

- Wire exact package commands and deterministic package gate sequence.
- Complete architecture, README, vault setup, repository index, task acceptance, final implementation report, and current-state checkpoint.
- Run focused/affected tests in the inner loop; run full gates only at durable integration/pre-PR checkpoints using test-efficiency telemetry.
- Run an independent blind review of the exact candidate against the accepted design, then reconcile findings without granting review authority.

Exit evidence: task acceptance has zero findings and final authoritative hashes equal baseline.

## Stage 7 — protected PR

- Inspect the final diff and runtime import graph.
- Commit coherent verified boundaries; push only the task branch.
- Open a PR to `main`; never merge, install, promote, or touch `stable` during this task.
- Wait for required checks and review. Record PR/check evidence and the exact next safe action.

Ready-for-merge is not complete. Completion requires protected integration and an immutable receipt, which remain outside this task unless separately authorized.
