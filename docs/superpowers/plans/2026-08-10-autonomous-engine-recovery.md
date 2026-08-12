# Autonomous Development Engine Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Inner Signal's autonomous development controller recover from reviewer timeouts, model-tool limitations, stochastic live regressions, and prior infrastructure-blocked roadmap tasks without consuming unnecessary Opus/Fable repair cycles or changing therapy/safety policy.

**Architecture:** Introduce explicit controller failure classification and resumable candidate phase state. Keep Claude responsible for isolated edits only; the parent Node controller owns deterministic gates, review retry/resume, and live-regression classification. Make package verification explicitly mock/deterministic regardless of inherited CLI environment.

**Tech Stack:** Node.js ESM, node:test, shell package verifier, Codex CLI review provider, Claude CLI coding agent.

## Global Constraints

- Baseline is v0.12.1; target release is v0.12.2.
- No therapy-policy, guide-graph, hypnosis consent/return, or safety behavior changes.
- `~/Téléchargements` remains the only user-facing Downloads path.
- Claude Opus 5 is primary implementer; Fable 5 is escalation only for real implementation/judgment failures.
- Parent controller owns deterministic verification.
- Review timeouts and worker-tooling limitations do not consume implementation cycles.
- `npm run verify` must stay deterministic even when `INNER_SIGNAL_MODE=cli` is inherited.
- Live model replays are a distinct post-review phase, not deterministic package integrity.

---

### Task 1: Failure taxonomy and independent counters

**Files:**
- Modify: `src/dev/engine.mjs`
- Create: `src/dev/failure-classification.mjs`
- Test: `tests/development-engine-recovery.test.mjs`

**Interfaces:**
- Produces `DEV_ENGINE_REVISION = "continuous-dev-v3-2026-08-10"`.
- Produces `classifyDevelopmentFailure(errorOrRecord)` and `consumesImplementationCycle(failureClass)`.
- Failure classes: `IMPLEMENTATION_FAILURE`, `DETERMINISTIC_VERIFICATION_FAILURE`, `REVIEW_REJECTION`, `REVIEW_TIMEOUT`, `WORKER_TOOLING_LIMITATION`, `LIVE_REGRESSION_FAILURE`, `AUTH_REQUIRED`, `HUMAN_POLICY_REQUIRED`, `MISSING_INPUT`.

- [ ] Write failing tests proving review timeout/tooling limitation do not consume implementation cycles while implementation/verifier/review rejection do.
- [ ] Run `node --test tests/development-engine-recovery.test.mjs` and verify RED.
- [ ] Implement the taxonomy and revision bump minimally.
- [ ] Re-run the focused test and verify GREEN.

### Task 2: Parent-owned deterministic gates and worker-tooling separation

**Files:**
- Modify: `src/dev/coding-agent.mjs`
- Modify: `src/dev/roadmap-worker.mjs`
- Modify: `src/dev/worker.mjs`
- Create: `src/dev/verification.mjs`
- Test: `tests/development-engine-recovery.test.mjs`

**Interfaces:**
- Produces `runDeterministicDevelopmentGates(candidateRoot, { packageVerifyEnv })` returning `{ ok, gates }`.
- Coding agent results may report inability to run tests without being treated as implementation failure when source edits exist and status is `implemented`.

- [ ] Add failing tests where implementer reports tool/sandbox test limitation but parent gates pass; assert no Fable escalation is requested.
- [ ] Verify RED.
- [ ] Move shared deterministic gate execution into `src/dev/verification.mjs` and call it from both development workers.
- [ ] Amend coding-agent prompt/result handling so model-side test execution is opportunistic evidence only; parent verification is authoritative.
- [ ] Verify focused tests GREEN.

### Task 3: Deterministic package verification under inherited CLI environment

**Files:**
- Modify: `scripts/verify-package.sh`
- Test: `tests/development-engine-recovery.test.mjs`

**Interfaces:**
- `npm run verify` invokes bundled A001/H001 checks with explicit `INNER_SIGNAL_MODE=mock`, `LEDGER_MODE=off` (or isolated deterministic ledger), and no live CLI model dependency.

- [ ] Add a failing test that runs `npm run verify` with `INNER_SIGNAL_MODE=cli` plus fake failing CLI commands and expects package verification to stay mock/deterministic.
- [ ] Verify RED.
- [ ] Prefix mock A001/H001 verification commands with explicit mock-mode environment and isolate any state output.
- [ ] Verify focused test GREEN.

### Task 4: Recoverable Codex review timeouts and resumable review phase

**Files:**
- Modify: `src/dev/review.mjs`
- Modify: `src/dev/roadmap-worker.mjs`
- Modify: `src/dev/worker.mjs`
- Modify: `src/core/config.mjs`
- Modify: `.env.cli.example`
- Modify: `.env.example`
- Test: `tests/development-engine-recovery.test.mjs`

**Interfaces:**
- Adds `DEV_REVIEW_TIMEOUT_MS` and `DEV_REVIEW_EXTENDED_TIMEOUT_MS` config.
- Adds `run*ReviewWithRecovery(...)` behavior: normal attempt, one extended-timeout retry on timeout, preserve candidate/gates, never reimplement solely because review timed out.
- Persist review attempt metadata and phase state.

- [ ] Add failing test simulating first Codex timeout then approval; assert coding agent called once, deterministic gates called once, review called twice, implementation cycle remains 1.
- [ ] Add failing test for repeated review timeout; assert candidate becomes `review-pending`/infrastructure-blocked and remains resumable.
- [ ] Verify RED.
- [ ] Implement configurable review timeout/retry and persisted phase metadata.
- [ ] Verify focused tests GREEN.

### Task 5: Candidate phase resumability and reopening v0.12.1 infrastructure blocks

**Files:**
- Modify: `src/dev/engine.mjs`
- Modify: `src/dev/roadmap-queue.mjs`
- Modify: `src/dev/queue.mjs`
- Modify: `src/dev/roadmap-worker.mjs`
- Modify: `src/dev/worker.mjs`
- Test: `tests/development-continuity.test.mjs`
- Test: `tests/development-engine-recovery.test.mjs`

**Interfaces:**
- Job state stores baseline hash, candidate root, candidate/change hash, completed phase, deterministic gate result/hash, review attempts, live-regression attempts, `implementationCycleCount`, and `infrastructureRetryCount` separately.
- Older-engine blocked states with infrastructure blockers reopen under v3.
- Valid unchanged candidate resumes at the first incomplete phase.

- [ ] Add failing regression for a v0.12.1 `REVIEW_TIMEOUT` roadmap job with green gates resuming directly at review.
- [ ] Add failing regression proving current-engine true `REVIEW_REJECTION` remains bounded/terminal under repair budget.
- [ ] Verify RED.
- [ ] Implement resume state/hash validation and v2→v3 recovery mapping.
- [ ] Verify focused tests GREEN.

### Task 6: Separate live regression from deterministic release gates

**Files:**
- Create: `src/dev/live-regression.mjs`
- Modify: `src/dev/roadmap-worker.mjs`
- Modify: `src/dev/worker.mjs`
- Test: `tests/development-engine-recovery.test.mjs`

**Interfaces:**
- Produces `runRelevantLiveRegressions({ task/developmentCase, candidateRoot, config })`.
- Returns `LIVE_REGRESSION_FAILURE` separately from deterministic gate failure.
- Packaging/browser-only changes may run zero therapy live replays.

- [ ] Add failing tests that a stochastic replay failure leaves deterministic gates green and does not relabel package verification failed.
- [ ] Add failing test that packaging-only roadmap changes skip A001/H001 live replay.
- [ ] Verify RED.
- [ ] Implement task/layer-based live regression selection and state recording.
- [ ] Verify focused tests GREEN.

### Task 7: Controller integration and regression coverage

**Files:**
- Modify: `tests/development-automation.test.mjs`
- Modify: `tests/development-continuity.test.mjs`
- Modify: `AUTOPILOT.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Package version becomes `0.12.2`.
- User-visible docs describe automatic infrastructure recovery without asking for logs.

- [ ] Add integration regressions for review retry, parent verification, independent counters, old blocked task recovery, and live-regression separation.
- [ ] Run focused tests.
- [ ] Run `npm test`.
- [ ] Run `npm run graph:test`.
- [ ] Run `INNER_SIGNAL_MODE=cli npm run verify` and confirm deterministic mock verification.

### Task 8: Release verification and atomic package

**Files:**
- Modify: `BUILD-VERIFY.txt`
- Create release ZIP and SHA-256 outside source tree.

**Interfaces:**
- Release name: `inner-signal-runtime-v0.12.2-autonomous-engine-recovery.zip`.
- Atomic `install-and-run.sh` remains the supported install path.

- [ ] Run package verifier from a clean extracted copy.
- [ ] Simulate dirty old install preserving `.env`, `.inner-signal-autopilot`, ledgers, and local data while removing stale source.
- [ ] Verify no `.env`, auth, key, or PEM files are packaged.
- [ ] Record exact test/gate counts and results in `BUILD-VERIFY.txt`.
- [ ] Generate SHA-256 checksum.
