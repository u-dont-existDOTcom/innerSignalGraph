# Obsidian authoring architecture task state

Task ID: `obsidian-authoring-architecture-v1`

Task acceptance: `npm run authoring:task:acceptance`

## Goal

Implement the owner-supplied hybrid Obsidian architecture without changing therapy semantics, graph routing, canonical guide/source bytes, model-role policy, privacy policy, release policy, or installed runtime behavior.

## Authority and baseline

- Development authority: remote `main` at `82b12b20c4a401b5e60999f981292c36fbaa8a53`.
- Starting tree: `8a25d56d91b84946762418d0aead0c8d7670588e`.
- Evidence branch commit: `060a9e17d7a7094ffad96741e3c37e8ca2866cd7`.
- Implementation branch: `codex/obsidian-authoring-architecture-20260829`.
- Worktree: the branch-bound isolated Codex worktree; never use `stable` or an installed runtime for this task.
- Task contract: the owner-supplied “InnerSignal Obsidian Authoring and Mapping Architecture — Worker-ready implementation packet.”
- Durable evidence: `docs/OBSIDIAN-AUTHORING-ARCHITECTURE-EVIDENCE-2026-08-29.md` and `docs/implementation/obsidian-authoring-baseline-2026-08-29.json`.

## Completed

- Confirmed remote `main` is exactly the packet baseline; the unrelated local `stable` checkout and its untracked `handoff.md` were left untouched.
- Created the required isolated branch/worktree from current remote `main`.
- Preserved the evidence commit by cherry-picking it unchanged.
- Bootstrapped exact Node 24.18.0 / npm 11.16.0 dependencies.
- Recorded baseline graph/source hashes.
- Baseline repository audit passed with only the pre-existing installed-App warning.
- Baseline publication audit scanned 147,838 records with zero findings.
- Baseline graph regressions passed 12/12.
- Baseline automated tests passed 387/387.
- Baseline complete package gate passed.
- Started test-efficiency telemetry under Git metadata.

## Current checkpoint

The accepted design, branch-bound task lock, recovery state, and implementation plan are being committed before implementation code. Ordinary repository queues named in `tasks/ACTIVE-TASK.json` are suspended for this task only.

## Remaining

- Strict contracts, schemas, restricted frontmatter parser, and canonical JSON.
- Deterministic current-state projection, manifest, Bases, source/regression/governance notes, and drift checks.
- Living-map classification, overlay registry, generated Mermaid, and deterministic JSON Canvas.
- Proposal creation/build/check workflow, stale-base enforcement, semantic diff completeness, coverage/provenance receipts.
- Narrow Guide Packet candidate-bundle adapter and branch-only reconciliation path.
- Documentation, acceptance audit, independent review, final hash comparison, protected PR, and CI readback.

## Blockers and stop conditions

No current blocker. Stop rather than guess if canonical source bytes must change, old map authority cannot be proven, a graph field is unclassified, proposal provenance or regression coverage is missing, owner approval would have to be inferred, runtime imports authoring code, or any step would touch `stable` or install a release.

## Next safe action

Run `npm run authoring:task:preflight`, then implement schema/parser tests and the read-only projection stage.

## Recovery rule

After interruption, inspect Git status and recent commits, run `npm run authoring:task:preflight`, reconcile this file with actual artifacts, and resume the first incomplete stage. Do not consult suspended queues to select a different task.
