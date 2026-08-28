# Start here — parked PR #11 protocol comparison

This file is the human-readable entry point for the exclusive task in `tasks/ACTIVE-TASK.json`.

## Parked by owner directive

This task was parked on 2026-08-23 for an owner-directed outcome-first pivot to the original A001 question. Preserve this branch and PR as research, but do not resume the 49-query campaign, general trajectories, Map 15/16 work, PR completion, merge, or release work unless Joel makes a later explicit owner decision to resume it.

The last exact-head implementation checkpoint is commit `c6fc41e480215e24943b5d518b4777a4b3a53161`. The interrupted live campaign reached an `executed/blocked` temporary checkpoint but was not graded, accepted, or promoted into tracked evidence. The approved `live-remediation-contract-v1` therefore remains `approved-not-implemented`.

## Do not resume task selection from an old Codex conversation

A resumed conversation may retain an older objective even when the correct handoff was pasted previously. Start a fresh Codex conversation for this task, or explicitly reset the resumed worker to this exact worktree before any repository-wide reassessment.

## Required repository location

Repository:

```text
u-dont-existDOTcom/innerSignalGraph
```

Required branch:

```text
agent/merge-inner-child-protocol-20260818
```

Pull request:

```text
#11
```

Use `git worktree list` to locate an existing worktree for that branch. If none exists, fetch the branch and create an isolated worktree. Do not continue from S001, `guide-packet-r03`, `stable`, `runtime-diagnostics`, or the root checkout merely because one of them is already open.

## Historical first commands — do not run while parked

From the exact PR #11 worktree:

```bash
npm ci --ignore-scripts
npm run task:preflight
npm run therapy-protocol:acceptance
```

Expected initial state:

- `task:preflight` must pass;
- `therapy-protocol:acceptance` must fail with structured `INCOMPLETE` findings until the corpus, comparisons, live campaign, multi-turn campaign, documentation, and verification receipts exist.

Treat those acceptance findings as the remaining task list. Do not consult the global autonomous roadmap for a different task.

## Completion language

- ordinary package tests green: prerequisite only;
- acceptance fails: `INCOMPLETE`;
- genuine external execution boundary: `BLOCKED`, with durable evidence;
- acceptance passes: `READY_FOR_PROTECTED_MERGE`;
- protected merge plus immutable receipt: `COMPLETE`.

## Source contract

Read:

1. `tasks/ACTIVE-TASK.json`
2. `state/CODEX-CURRENT-STATE.md`
3. `docs/superpowers/specs/2026-08-18-inner-child-protocol-merge-design.md`
4. `docs/superpowers/plans/2026-08-18-inner-child-protocol-merge.md`
5. the current Creative Tail protocol and all 49 fixtures at the exact source SHA named in the task lock.

Continue automatically through the next unmet acceptance condition. Leave the article and `stable` unchanged.
