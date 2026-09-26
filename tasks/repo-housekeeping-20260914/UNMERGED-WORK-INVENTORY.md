# InnerSignal unmerged-work inventory — 2026-09-14

## Scope

Canonical comparison point: `main` at `964c491a2c83795714c25e61041f4379a00b99e1`.

This inventory distinguishes GitHub objects from actual unfinished product work. An open PR or surviving branch is not automatically an unmerged feature: several open PRs are historical checkpoints, report-only audits, stacked predecessors whose behavior later landed through another integration path, or superseded implementation experiments.

Observed at inventory start:

- 21 open pull requests.
- 67 remote branches across development, task, benchmark, dependency, diagnostics, and historical work.
- `tasks/ACTIVE-TASK.json` incorrectly still marked the already-merged wisdom-practices task as exclusive/active.

No branch is deleted by this cleanup. Closing a stale PR preserves its branch, commits, discussion, and recovery history.

## Disposition

| PR | Plain-language work | Disposition | Basis |
| --- | --- | --- | --- |
| #54 | Hypnosis r03 synchronization, source-linked knowledge, and session-control repair | **RETAIN_UNIQUE** | Current branch is 3 commits ahead of its merge base and contains new hypnosis session/knowledge runtime files not present on current `main`. Rebase/extract onto current `main` before any merge decision. |
| #53 | Report-only hypnosis graph fidelity audit | **CLOSE_SUPERSEDED** | Explicitly diagnostic/report-only; its findings are the input to the substantive repair in #54. Preserve as historical evidence, not an active delivery path. |
| #52 | Reparenting developmental-prerequisite/telos target gate | **RETAIN_UNIQUE** | Contains unique developmental-capacity/target-gate semantic work created after the relevant earlier merge base. Needs clean extraction/rebase before product review. |
| #48 | Longitudinal therapy-reasoning audit invariants | **CLOSE_INCORPORATED** | The longitudinal integration ledger and runtime rules now exist on `main`; this stacked PR is no longer the canonical delivery path. |
| #47 | Path-performance / relational-readiness gating | **CLOSE_INCORPORATED** | Current `main` contains the Path Performance controller and relational-readiness implementation. |
| #45 | Altered-state capacity-led routing refinement | **RETAIN_UNIQUE_STACKED** | Current `main` still has only the generic source-gated `GUIDE-R002`; this PR contains a distinct queue/policy refinement. It is stacked on #44 and should be extracted after #44 disposition rather than merged as-is. |
| #44 | Concise therapy reply presentation | **RETAIN_UNIQUE_STACKED** | Its dedicated response-presentation implementation is not present on current `main`. Preserve as a candidate, but restack/extract from the old branch chain. |
| #43 | DEV-R005 CBOR decision scan | **CLOSE_SUPERSEDED** | Decision-scan/checkpoint work predates the later encrypted private-store, handoff, and continuity architecture now on `main`; it is no longer the active storage implementation path. |
| #42 | Three-way therapy routing with somatic branches | **CLOSE_INCORPORATED** | Current canonical cross-guide graph explicitly contains three-way routing and the corresponding owner amendment. |
| #41 | Post-S003 encrypted-storage checkpoint | **CLOSE_SUPERSEDED** | Control-plane checkpoint only; later private storage/continuity implementation supersedes it. |
| #27 | Current InnerSignal Therapy ChatGPT plugin refresh | **RETAIN_UNIQUE** | This is the newest skills-only plugin packaging candidate. Do not conflate it with the older public-prep PR. |
| #23 | CodeQL `init` action 4.37.7 → 4.37.9 | **RETAIN_DEPENDENCY** | Current `main` is still pinned to 4.37.7, so this update has not been incorporated. |
| #22 | CodeQL `analyze` action 4.37.7 → 4.37.9 | **RETAIN_DEPENDENCY** | Current `main` is still pinned to 4.37.7, so this update has not been incorporated. |
| #20 | Older plugin public-preparation package | **CLOSE_SUPERSEDED** | Superseded by the later plugin refresh in #27. |
| #19 | Local release/browser compatibility matrix | **CLOSE_INCORPORATED** | Current `main` contains the release/browser matrix implementation and later-evolved release machinery. |
| #18 | Browser speech playback lifecycle | **CLOSE_INCORPORATED** | `apps/web/speech-playback.js` on this PR is byte-identical to the blob on current `main`; later code builds on it. |
| #17 | Therapy latency benchmark / avoidable-call optimization | **CLOSE_INCORPORATED** | Current `main` contains an evolved latency benchmark and later orchestration work; the old stacked PR is no longer canonical. |
| #16 | Historical stale Obsidian-task-lock retirement | **CLOSE_HISTORICAL** | Its purpose was an earlier lock closeout that already occurred. Keeping the PR open serves no active work queue function. |
| #15 | Consent-governed InnerSignal Commons MVP and private correction-learning slice | **RETAIN_DEFERRED** | Unique work with explicit later product/privacy/moderation gates; preserve as deferred, not merge-ready. |
| #14 | Non-punitive review semantic proposal | **RETAIN_OWNER_DECISION** | Current `main` still marks the non-punitive review overlay `owner-approved-uncompiled`; the proposal has not been fully reconciled into compiled authority. |
| #11 | Early Creative Tail / inner-child protocol comparison | **CLOSE_HISTORICAL** | The PR itself is marked incomplete and its old exclusive-task/acceptance architecture has been overtaken by the current canonical inner-child graph, Guide Packet, and runtime. Preserve history, not active queue status. |

## Resulting active queue

After closing only the clearly incorporated/superseded/historical PRs above, the meaningful open queue should be nine PRs:

- substantive unique candidates: #54, #52, #44, #45;
- current plugin packaging: #27;
- deferred product work: #15;
- unresolved owner semantic decision: #14;
- dependency maintenance: #22, #23.

This is intentionally conservative. No unique semantic candidate is discarded merely because its branch is old or diverged.

## Cleanup rules going forward

1. Treat `main` as development authority and classify work by semantic delta against current `main`, not by PR open/closed status alone.
2. When a stacked PR's behavior lands through a later integration path, close the predecessor PR and record `INCORPORATED_ELSEWHERE` rather than leaving it in the active queue.
3. Report-only audits may remain as closed evidence; they should not stay open after a repair path supersedes them.
4. Do not delete historical branches automatically. Branch deletion is a separate retention decision.
5. A completed exclusive task must leave `tasks/ACTIVE-TASK.json` with `status: complete`, `exclusive: false`, empty suspended sources, and terminal merge evidence so later work is not blocked by stale state.
6. Before new semantic InnerSignal work, review this inventory and current `main`; extract useful deltas from old stacked branches rather than merging stale stacks wholesale.
