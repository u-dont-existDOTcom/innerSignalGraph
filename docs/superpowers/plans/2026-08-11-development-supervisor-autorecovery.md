# Development Supervisor Auto-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible, structured development supervisor that accurately reports trajectory and automatically directs recoverable engineering failures back into the isolated repair loop without asking the user to supervise routine work.

**Architecture:** Deterministic runtime/job/roadmap state remains the source of truth. A new supervisor state module records current worker operation, builds a machine-verifiable trajectory snapshot, and permits only three executive actions: `AUTO_CONTINUE`, `AUTO_REPAIR`, or `ASK_HUMAN`. A read-only Codex trajectory analyst is used only for terminal engineering blockers; its proposed action is validated against deterministic state before the controller can requeue a repair. The web UI displays the deterministic snapshot continuously while the development worker is running.

**Tech Stack:** Node.js ESM, existing CLI providers, built-in `node:test`, vanilla browser JS/CSS, JSON state files under `.inner-signal-autopilot`.

## Global Constraints

- Use `~/Téléchargements` in user-facing Linux commands.
- Deterministic code establishes process facts, permissions, failure classes, and whether human input is legally permitted.
- Models may interpret blocked engineering state and propose a restorative repair directive, but may never edit the running runtime or self-promote a candidate.
- `AUTO_REPAIR` always creates/resumes an isolated candidate and still requires parent deterministic gates plus independent Codex review before promotion.
- `ASK_HUMAN` is allowed only for substantive therapy/safety/product policy, missing canonical source, authentication, or genuinely irreducible human action.
- Review timeout, live-regression timeout, worker tooling limitation, stale state, deterministic test failure, verifier defect, incomplete repair scope, and packaging integrity failure are not human-policy decisions.
- The supervisor must not create an unbounded repair loop. Each same-engine blocked task gets at most two supervisor-directed fresh recovery strategies, fingerprinted by blocker/required-change content.
- The overall development analysis is always visible while the development worker is running; when idle it collapses to a compact status.

---

### Task 1: Deterministic Supervisor State and Trajectory Snapshot

**Files:**
- Create: `src/dev/supervisor-state.mjs`
- Test: `tests/development-supervisor.test.mjs`

**Interfaces:**
- Consumes: `readDevelopmentJobs(config)`, `readAutonomousRoadmapState(config)`, `loadAutonomousDevelopmentRoadmap()`.
- Produces: `recordDevelopmentWorkerRuntime(config, patch)`, `recordDevelopmentProgress(config, event)`, `buildDevelopmentSupervisorSnapshot(config)`, `readDevelopmentSupervisorState(config)`.

- [ ] **Step 1: Write failing tests** proving active repair/review stages, all-tasks-blocked state, waiting-human state, and timeout-recovery labels are derived from structured state rather than log prose.
- [ ] **Step 2: Run** `node --test tests/development-supervisor.test.mjs` and confirm module-not-found / missing-export failure.
- [ ] **Step 3: Implement** atomic supervisor state persistence and deterministic snapshot derivation.
- [ ] **Step 4: Run** `node --test tests/development-supervisor.test.mjs` and confirm PASS.

### Task 2: Read-Only Trajectory Analyst and Validated Executive Action

**Files:**
- Create: `src/dev/supervisor.mjs`
- Modify: `src/core/config.mjs`
- Modify: `src/dev/roadmap-queue.mjs`
- Modify: `src/dev/roadmap-worker.mjs`
- Test: `tests/development-supervisor.test.mjs`

**Interfaces:**
- Consumes: deterministic snapshot from Task 1 and existing `CodexCliProvider`.
- Produces: `runDevelopmentSupervisorCycle({config, sourceRoot, onProgress})`; persisted analysis with `action`, `failure_class`, `repair_directive`, `evidence_refs`, `human_decision_required`.

- [ ] **Step 1: Add failing tests** for automatic restorative requeue of a current-engine `REVIEW_REJECTION` task, refusal to auto-repair `HUMAN_POLICY_REQUIRED`, bounded recovery fingerprinting, and supervisor repair directive propagation.
- [ ] **Step 2: Run targeted tests** and verify expected failures.
- [ ] **Step 3: Implement** the read-only analyst schema, deterministic action validator, two-strategy recovery budget, and roadmap requeue state `supervisor-repair`.
- [ ] **Step 4: Modify roadmap worker** so a supervisor repair directive is included in the coding audit/prior-failure evidence and the implementation-cycle budget resets only inside the separately counted supervisor recovery attempt.
- [ ] **Step 5: Run targeted tests** and confirm PASS.

### Task 3: Worker Ownership and Automatic Supervisor Invocation

**Files:**
- Modify: `src/cli/dev-worker.mjs`
- Modify: `src/dev/engine.mjs`
- Test: `tests/development-supervisor.test.mjs`
- Test: `tests/development-continuity.test.mjs`

**Interfaces:**
- Consumes: Task 1 progress recorder and Task 2 supervisor cycle.
- Produces: durable worker PID/runtime state; automatic supervisor cycle after each development iteration and when normal queues return idle.

- [ ] **Step 1: Add failing tests** for worker progress persistence and current-engine supervisor-repair eligibility.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement** worker start/stop state, progress persistence, supervisor invocation, and engine revision bump.
- [ ] **Step 4: Verify targeted tests GREEN.**

### Task 4: Always-Visible Overall Development Analysis UI

**Files:**
- Modify: `src/server/create-server.mjs`
- Modify: `apps/web/index.html`
- Modify: `apps/web/app.js`
- Modify: `apps/web/styles.css`
- Test: `tests/web-client.test.mjs`
- Test: `tests/server.test.mjs`

**Interfaces:**
- `GET /v1/dev/status` returns `supervisor` snapshot.
- Browser renders overall status, task, stage, model/detail, elapsed time, last meaningful event, blocker/root issue, next automatic action, and whether human input is required.

- [ ] **Step 1: Add failing browser/server assertions** for the new supervisor payload and required visible copy.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add endpoint payload and UI rendering.** Keep the panel expanded whenever `supervisor.worker.running` or an active/recovering state exists; compact it only after development is idle/complete.
- [ ] **Step 4: Verify targeted tests GREEN.**

### Task 5: Diagnostic Export, Versioning, Package Verification

**Files:**
- Modify: `src/export/diagnostic-bundle.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `AUTOPILOT.md`
- Modify: `BUILD-VERIFY.txt`
- Test: `tests/diagnostic-export.test.mjs`

**Interfaces:**
- Diagnostic ZIP includes supervisor truth, latest analysis, action history, worker runtime state, and recovery fingerprints.

- [ ] **Step 1: Add failing diagnostic export assertion.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Include supervisor files; bump runtime to `0.13.0`; document executive-action semantics.**
- [ ] **Step 4: Run full verification:** `npm test`, `npm run graph:test`, `INNER_SIGNAL_MODE=mock npm run verify`.
- [ ] **Step 5: Build final atomic installer ZIP, extract it fresh, and rerun all three verification commands on the extracted release tree.**
