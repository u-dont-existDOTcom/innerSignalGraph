# Supervisor Livelock Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make supervisor-directed recovery transactional, revision-bounded, state-change-driven, and non-livelocking.

**Architecture:** Keep roadmap task state as the durable worker queue. Add a stable supervisor dispatch record and verify queue visibility before reporting a repair as applied. Cache/suppress analysis by deterministic state fingerprint after bounded recovery exhaustion, serialize supervisor-state writes, and reconcile missing dispatch records from durable action history.

**Tech Stack:** Node.js >=20, ES modules, node:test, filesystem-backed JSON state.

## Global Constraints
- Do not change therapy, hypnosis, guides, routing, or safety policy.
- Opus/Fable remain implementers; deterministic parent verification and Codex independent review remain unchanged.
- Recovery budget is per `DEV_ENGINE_REVISION`.
- Exact user upgrade path remains `~/Téléchargements` + `./install-and-run.sh`.

---

### Task 1: Regression tests for livelock, per-revision budget, and durable dispatch

**Files:**
- Modify: `tests/development-supervisor.test.mjs`

**Interfaces:**
- Consumes: `applyValidatedSupervisorAction`, `runDevelopmentSupervisorCycle`, `buildDevelopmentSupervisorSnapshot`, `nextAutonomousRoadmapTask`.
- Produces: failing coverage for old-revision budget reset, queue-visible dispatch, unchanged-state suppression, actual progress result, and concurrent state writes.

- [ ] Write a test where a task has two recoveries from an older engine revision; current engine must allow a fresh recovery and reset the effective count to one.
- [ ] Write a test that successful AUTO_REPAIR persists `supervisorDispatch.key` and that `nextAutonomousRoadmapTask` returns the exact target.
- [ ] Write a test that budget exhaustion marks the deterministic state suppressed/`BLOCKED_INTERNAL`, and a second supervisor cycle on unchanged state performs no model analysis.
- [ ] Write a test that cycle completion progress reports `AUTO_CONTINUE ... supervisor-recovery-budget-exhausted`, not the proposed `AUTO_REPAIR`.
- [ ] Write a concurrent-write test proving all supervisor analysis history entries survive `Promise.all` writes without temp-file collisions.
- [ ] Run `node --test tests/development-supervisor.test.mjs` and confirm the new tests fail for the intended missing behavior.

### Task 2: Serialize supervisor state and add deterministic suppression metadata

**Files:**
- Modify: `src/dev/supervisor-state.mjs`

**Interfaces:**
- Produces: serialized `patchState`, collision-resistant atomic JSON writes, `stateFingerprint`, `lastActionResult`, `lastAnalyzedFingerprint`, `suppressedFingerprint`, and `BLOCKED_INTERNAL` snapshot state.

- [ ] Add a per-state-file in-process promise queue around read-modify-write operations.
- [ ] Use `randomUUID()` in temporary filenames.
- [ ] Extend `recordSupervisorAnalysis` to persist fingerprint/action result/suppression fields.
- [ ] Compute a stable fingerprint from worker/task/job facts excluding supervisor progress timestamps and analysis text.
- [ ] If a blocked state's fingerprint equals `suppressedFingerprint`, expose `overall=BLOCKED_INTERNAL`, `nextAutomaticAction=NONE`, and the persisted blocker/reason.
- [ ] Run the focused supervisor tests and confirm state/concurrency tests pass.

### Task 3: Revision-bounded transactional AUTO_REPAIR dispatch

**Files:**
- Modify: `src/dev/supervisor.mjs`
- Modify: `src/dev/roadmap-worker.mjs`
- Modify: `src/dev/engine.mjs`

**Interfaces:**
- Produces: revision-aware recovery counters, stable dispatch keys, queue visibility verification, claimed dispatch lifecycle, unchanged-state suppression, and startup reconciliation.

- [ ] Reset the effective recovery count/fingerprints when `supervisorRecoveryEngineRevision !== DEV_ENGINE_REVISION`.
- [ ] Persist `supervisorRecoveryEngineRevision` with every fresh supervisor repair.
- [ ] Derive a stable dispatch key from engine revision, task id, and repair fingerprint.
- [ ] Mark the task `supervisor-repair` with a queued dispatch record, reread via `nextAutonomousRoadmapTask`, and report applied only if the exact target is visible.
- [ ] On budget exhaustion/repeated strategy, persist suppression for the current deterministic state fingerprint instead of invoking another repair.
- [ ] Before analyzing, reconcile a durable `AUTO_REPAIR applied=true` record whose dispatch key is absent from the target task by idempotently reconstructing the queued task without incrementing recovery count.
- [ ] When roadmap processing starts, convert a queued matching supervisor dispatch to `claimed`.
- [ ] Change completed progress detail to the applied result/action reason.
- [ ] Bump `DEV_ENGINE_REVISION` to v6 and run focused tests to green.

### Task 4: Version/package assertions and full verification

**Files:**
- Modify: `package.json`
- Modify: `scripts/verify-package.sh`
- Modify: `.env.example`
- Modify: `.env.cli.example`
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `docs/DEVELOPMENT-AUTOMATION.md`

**Interfaces:**
- Produces: v0.13.1 package metadata and verifier assertions for engine v6 and anti-livelock architecture.

- [ ] Set runtime version to `0.13.1` and update release description/docs.
- [ ] Update package verifier from engine v5 to engine v6 and assert dispatch/suppression code is packaged.
- [ ] Run `npm test`.
- [ ] Run `npm run graph:test`.
- [ ] Run `INNER_SIGNAL_MODE=mock LEDGER_MODE=off npm run verify`.
- [ ] Build the exact atomic-install ZIP, checksum, and build verification report.
- [ ] Fresh-extract the ZIP and repeat all three gates.
- [ ] Run a dirty-upgrade simulation proving `.env` and state preservation and stale-source removal.
