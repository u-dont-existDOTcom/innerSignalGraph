# Supervisor Livelock Recovery Design

## Goal
Eliminate the v0.13.0 supervisor livelock without changing therapy, hypnosis, guide, or safety behavior.

## Root cause
The v0.13.0 supervisor successfully queued exactly two DEV-R001 repairs. After the per-revision recovery budget was exhausted, the deterministic state remained blocked, so every worker poll invoked Codex again on unchanged state. `applyValidatedSupervisorAction` converted the proposed repair to `AUTO_CONTINUE`, but the progress event still printed the proposed `AUTO_REPAIR`, making the UI/logs falsely imply dispatch. Concurrent un-awaited progress writes could also collide on the same temporary state filename and lose updates.

## Design
1. Supervisor recovery budget is truly per development-engine revision. Counts/fingerprints from an older engine revision do not consume the current revision's budget.
2. Each successful `AUTO_REPAIR` stores a stable dispatch key in the roadmap task and is considered applied only after `nextAutonomousRoadmapTask` confirms that exact task is worker-visible.
3. The roadmap worker marks a queued supervisor dispatch as claimed when it begins processing it. Existing task-state merging preserves the dispatch record through later stages.
4. Supervisor state stores a deterministic state fingerprint and suppression marker. If the same blocked state has already exhausted its recovery budget or repeated the same strategy, subsequent polls do not call Codex again. The snapshot reports `BLOCKED_INTERNAL` with no automatic action until the underlying deterministic state changes or the engine revision changes.
5. A previously recorded successful repair whose dispatch record is missing is reconciled idempotently before a new supervisor analysis.
6. Supervisor-state updates are serialized within the worker process and use collision-resistant temporary filenames.
7. Progress completion text reports the action actually applied, including failure/suppression reason, never merely the model's proposed action.

## Constraints
- No therapy/hypnosis/guide behavior changes.
- No weakening of deterministic verification, independent review, or live regression gates.
- No additional human decision for routine engineering failures.
- Preserve `.env`, local state, and autonomous roadmap state across atomic upgrade.
