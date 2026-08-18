# Inner Signal Codex current state

Updated: 2026-08-18

## Exclusive active task

- Task ID: `inner-child-protocol-comparison-v1`
- Required branch: `agent/merge-inner-child-protocol-20260818`
- Pull request: `#11`
- Machine authority: `tasks/ACTIVE-TASK.json`
- First command after any fresh start, resume, context compaction, or model switch: `npm run task:preflight`
- Task-specific completion command: `npm run therapy-protocol:acceptance`

This owner-authorized task supersedes the 2026-08-15 checkpoint instruction not to change therapy policy on this branch. The publication-transition baseline remains historical repository evidence; it is not the active development objective here.

## Scope lock

This task is exclusive. Do not select work from S001 handoffs, Guide Packet r03/r04 worktrees, the autonomous roadmap, GitHub App issue 4, unrelated `handoff.md` files, or `stable` release queues. Those sources remain valid in their own branches and worktrees but are suspended for this task.

A resumed Codex conversation must not infer the active objective from conversational memory. It must verify the exact branch and task lock from Git. A branch mismatch is a hard preflight failure, not permission to choose another repository task.

## Objective

Complete and falsify the Creative Tail inner-child/reparenting protocol integration in the existing InnerSignalGraph runtime. Import all 49 real, unprimed fixtures; enforce query/grader separation; run deterministic, actual-model, and adversarial multi-turn campaigns; execute genuine Map 15 and Map 16 ablations; simplify when the smaller competitor is equivalent; preserve A001/H001 and all current safety/repository boundaries; merge through protected `main`; leave `stable` unchanged.

## Current progress

PR #11 currently contains a preliminary deterministic protocol router, schema integration, and synthetic unit tests. That is useful partial implementation, not completion.

Still required:

- import and verify 49/49 real-query fixtures;
- deterministic full-corpus results;
- actual non-mock model results for all 49 or an explicit `BLOCKED` terminal state;
- per-case and aggregate Map 15/16 comparisons;
- multi-turn longitudinal safety campaign;
- provenance and runtime crosswalk documentation;
- exact-head verification receipt;
- protected-main merge and immutable post-merge receipt.

## Completion semantics

`npm test`, `npm run verify`, green CI, and focused synthetic tests are prerequisites. They do not mean the owner task is complete.

The worker may say:

- `INCOMPLETE` when `npm run therapy-protocol:acceptance` fails because artifacts or evidence are missing;
- `BLOCKED` when a genuine external boundary prevents required execution and the active task file plus durable evidence name the blocker;
- `READY_FOR_PROTECTED_MERGE` only when the acceptance command exits zero;
- `COMPLETE` only after protected merge and an immutable post-merge receipt.

## Canonical ontology and hard boundaries

- One inner parent / integrated adult with nurturing, protecting, and guiding qualities; never three autonomous parents.
- No parallel therapy engine and no Mermaid runtime executor.
- Model prompts may realize only deterministically permitted operations.
- Only each fixture's `query` may enter model input; expected routes and assertions remain grader-only.
- Article prose remains unchanged.
- `stable` is not advanced.
- No clinical, legal, live-referral, or provider-backed success claim without actual evidence.

## Recovery rule

After interruption, run `npm run task:preflight` before reading roadmaps or old handoffs. Then inspect `tasks/ACTIVE-TASK.json`, this file, PR #11, the exact branch head, and the last acceptance output. Continue with the next unmet acceptance condition. Do not ask “what is the repository's next task?” while this exclusive task lock exists.
