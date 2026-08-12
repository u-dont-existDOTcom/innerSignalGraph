# Guide Packet Runtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Inner Signal v0.14.1 so Guide Packet stages are durable, resumable, exact-model enforced, supervisor-quiescent, diagnostically complete, and privacy-safe without installing the staged r01 candidate.

**Architecture:** A new deterministic lifecycle module owns atomic packet status, attempt history, heartbeats, failure classes, and stale-stage reconciliation. The existing packet store remains authoritative for content and owner decisions, while one shared processor drives both autopilot and server import. Stable packet facts join the supervisor fingerprint; exact live model evidence gates compilation/review.

**Tech Stack:** Node.js 20+ ESM, built-in `fs`, `crypto`, `process`, `node:test`, existing stored-ZIP utilities, Bash package verifier.

## Global Constraints

- Start from validated Inner Signal v0.14.0; do not use the Claude Artifact JSX or a pre-graph branch.
- Production remains `inner-child-somatic-pilot-2026-08-09-r5`.
- Candidate remains `inner-signal-guides-2026.08.11-r01-candidate` and must not install without Joel's owner decisions.
- Use subscription-backed CLIs, not APIs.
- Exact models are `claude-opus-5`, conditional `claude-fable-5`, and `gpt-5.6-sol`; no default or alias substitution.
- Preserve A001/H001, graph, provenance, owner-decision, rollback, and private-data contracts.
- French Zorin commands and install paths use `~/Téléchargements`.
- The extracted release source is not a Git checkout; use verified file/release checkpoints rather than pretending commits succeeded.

---

### Task 1: Durable stage lifecycle and failure taxonomy

**Files:**
- Create: `src/guide-packet/failure-classification.mjs`
- Create: `src/guide-packet/stage-lifecycle.mjs`
- Create: `tests/guide-packet-lifecycle.test.mjs`
- Modify: `src/core/config.mjs`

**Interfaces:**
- Produces `GUIDE_PACKET_FAILURE`, `classifyGuidePacketFailure(error, context)`, `runGuidePacketStage(options)`, `reconcileGuidePacketProcessingState(config, options)`, `readGuidePacketStageAttempts(config)`, `isGuidePacketAttemptLive(status, options)`, and `writeGuidePacketProcessingStatus(config, patch)`.
- `runGuidePacketStage` consumes `{ config, packetId, stageId, model, expectedNextStage, operation, persistResult, now, heartbeatMs }` and returns the operation result only after candidate output and the completed transition are durable.

- [ ] **Step 1: Write RED lifecycle tests**

Add tests that start a stage with a throwing Opus provider and assert:

```js
assert.equal(status.active, false);
assert.equal(status.lifecycle, "blocked");
assert.equal(status.overall, "BLOCKED_AUTO_RECOVERY");
assert.equal(status.failureClass, "MODEL_UNAVAILABLE");
assert.equal(status.normalizedError.message, "Opus compilation unavailable");
assert.equal(attempts.at(-1).lifecycle, "blocked");
```

Add a timeout test asserting `MODEL_TIMEOUT`, the unchanged candidate ZIP hash, and no installed manifest. Add a legacy orphan test with `active: true`, `overall: "WORKING"`, and `stage: "opus-source-role-compilation"`; reconciliation must return `recovered: true` and persist `RECOVERING / STALE_STAGE`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/guide-packet-lifecycle.test.mjs`

Expected: module-not-found or missing-export failure for the lifecycle API.

- [ ] **Step 3: Implement the taxonomy and atomic lifecycle**

Use an explicit frozen enum containing the nine handoff classes. Normalize only safe fields:

```js
export function normalizeGuidePacketError(error, failureClass) {
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || "GUIDE_PACKET_STAGE_FAILED"),
    message: String(error?.message || error || "Guide Packet stage failed."),
    failureClass,
    at: new Date().toISOString()
  };
}
```

Persist `processing-status.json` with one atomic rename and `stage-attempts.json` as a bounded v1 ledger. Serialize writes per store root so a heartbeat cannot overwrite a terminal state.

- [ ] **Step 4: Implement liveness and orphan reconciliation**

Treat a stage as live only when lifecycle is `running`, its attempt exists, its heartbeat is within `guidePacketStaleMs`, and `workerPid` passes `process.kill(pid, 0)`. Legacy running records without an attempt/PID reconcile immediately. Record `recoveryAction: "resume-from-staged-candidate"` and preserve all candidate/install files.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/guide-packet-lifecycle.test.mjs`

Expected: all lifecycle, timeout, ledger, and orphan tests pass.

---

### Task 2: Shared resumable packet processor

**Files:**
- Modify: `src/guide-packet/autopilot.mjs`
- Modify: `src/guide-packet/store.mjs`
- Modify: `src/guide-packet/model-review.mjs`
- Modify: `src/server/create-server.mjs`
- Modify: `src/server/listen-loopback.mjs`
- Modify: `src/autopilot/launch-runtime.mjs`
- Modify: `tests/guide-packet-autopilot.test.mjs`
- Modify: `tests/server.test.mjs`

**Interfaces:**
- `ensureBundledGuidePacketCandidate` becomes the only compiler/reviewer orchestration path.
- Store writes accept an internal `updateProcessingStatus: false` option so lifecycle status is not duplicated.
- Candidate state may persist `reviewWork.independentAudit` and `reviewWork.escalationAudit` before final review assembly.

- [ ] **Step 1: Add RED exception/resume tests**

Add an autopilot test whose first compiler throws and whose second compiler succeeds. After the first run assert that candidate identity, packet hash, decision-card array, and absence of installation are unchanged. After the second run assert one compilation, one Codex audit, and `WAITING_FOR_HUMAN`.

- [ ] **Step 2: Add RED owner-decision preservation test**

Stage the candidate, set one decision-card status/note in candidate state, seed an orphaned running compilation, and resume. Assert the exact card status, note, and `decidedAt` survive recovery.

- [ ] **Step 3: Verify RED**

Run: `node --test tests/guide-packet-autopilot.test.mjs tests/server.test.mjs`

Expected: exception leaves legacy status or server/autopilot behavior diverges.

- [ ] **Step 4: Route every caller through the shared processor**

Replace the duplicated `/v1/guides/import` compilation/review block with staging plus `ensureBundledGuidePacketCandidate`. Run deterministic verification, Opus compilation, Codex audit, optional Fable adjudication, and final deterministic verification as named lifecycle stages. Persist each completed model output before advancing.

- [ ] **Step 5: Add startup reconciliation**

Before actual loopback/foreground serving, reconcile stale packet status. When exact entitled providers are present, resume the existing candidate; otherwise retain `BLOCKED_AUTO_RECOVERY` or `AUTH_REQUIRED` truthfully without rebuilding or installing.

- [ ] **Step 6: Verify GREEN**

Run: `node --test tests/guide-packet-autopilot.test.mjs tests/server.test.mjs`

Expected: both paths share terminal states and all existing endpoint behavior remains green.

---

### Task 3: Exact model entitlement and reviewer refusal

**Files:**
- Modify: `src/autopilot/model-resolver.mjs`
- Modify: `src/autopilot/model-policy.mjs`
- Modify: `src/core/config.mjs`
- Modify: `src/guide-packet/model-compiler.mjs`
- Modify: `src/guide-packet/model-review.mjs`
- Create: `tests/model-resolver.test.mjs`
- Modify: `tests/config.test.mjs`
- Modify: `tests/guide-packet-compilation.test.mjs`
- Modify: `tests/guide-packet-review.test.mjs`

**Interfaces:**
- Successful resolver results attach `provider.entitlementEvidence = { model, responseId, verifiedAt }`.
- Guide Packet model functions reject any provider whose exact `model` is not the required role identifier.

- [ ] **Step 1: Write RED resolver tests**

Inject provider factories that record requested models. With `openaiModel: ""`, assert the first OpenAI factory call is exactly `gpt-5.6-sol`, the resolved model is `gpt-5.6-sol`, and the provider carries matching entitlement evidence. Assert no `"CLI default"` attempt exists.

- [ ] **Step 2: Write RED low-level refusal tests**

Call compilation with `claude-sonnet-4-6`, independent review with `""`, `gpt-5.6`, and `gpt-5.6-terra`, and escalation with non-Fable. Assert each rejects before `generate()` and reports the required exact identifier.

- [ ] **Step 3: Verify RED**

Run: `node --test tests/model-resolver.test.mjs tests/config.test.mjs tests/guide-packet-compilation.test.mjs tests/guide-packet-review.test.mjs`

Expected: blank/default is attempted first and wrong providers are currently called.

- [ ] **Step 4: Implement exact role resolution**

Normalize blank model environment values to exact defaults. Resolve primary OpenAI only as `gpt-5.6-sol`, primary Anthropic only as `claude-opus-5`, and Fable escalation only as `claude-fable-5`. Preserve Sonnet only in the renderer role.

- [ ] **Step 5: Persist proof**

Include exact model, response ID, and verification timestamp in `model-resolution.json`; Guide Packet processing must refuse a CLI provider lacking matching live evidence before starting independent review.

- [ ] **Step 6: Verify GREEN**

Run the four focused test files and confirm all exact-model assertions pass.

---

### Task 4: Supervisor fingerprint, truthful view, and quiescence

**Files:**
- Modify: `src/dev/supervisor-state.mjs`
- Modify: `src/dev/supervisor.mjs`
- Modify: `tests/development-supervisor.test.mjs`
- Modify: `tests/server.test.mjs`

**Interfaces:**
- `stateFingerprintFor` consumes stable Guide Packet state.
- Snapshot adds `packetStageLive`, `lastSuccessfulTransition`, `recoveryAction`, and `nextExpectedGate` to the current packet view.
- `runDevelopmentSupervisorCycle` may return `skippedAnalysis: true` without writing state when canonical state is unchanged and quiescent.

- [ ] **Step 1: Write RED fingerprint tests**

Write identical Guide Packet state twice with different heartbeat/update timestamps and assert equal fingerprints. Change only `stageId` and assert unequal fingerprints.

- [ ] **Step 2: Write RED no-churn test**

Run two supervisor cycles against unchanged recovering packet state with no live attempt. Capture `development-supervisor.json` after the first cycle and assert the second cycle leaves its bytes and `actionHistory.length` unchanged.

- [ ] **Step 3: Write RED truthful-view test**

Seed a recovered Opus stage and assert the snapshot reports packet ID, actual stage/model, elapsed time, last successful transition, `STALE_STAGE`, `resume-from-staged-candidate`, next expected gate, and `humanActionRequired: false`.

- [ ] **Step 4: Verify RED**

Run: `node --test tests/development-supervisor.test.mjs tests/server.test.mjs`

Expected: fingerprint is unchanged across stage changes or second cycle appends history.

- [ ] **Step 5: Implement stable packet fingerprint and quiescence**

Hash semantic packet fields and owner-decision statuses, excluding heartbeat/display timestamps. Before applying a fallback `AUTO_CONTINUE`, compare `lastAnalyzedFingerprint`; if unchanged with no live attempt or due retry, return the stored analysis/result without calling Codex or `recordSupervisorAnalysis`.

- [ ] **Step 6: Verify GREEN**

Run the two focused test files and confirm no history or file rewrite occurs.

---

### Task 5: Complete privacy-safe diagnostic

**Files:**
- Modify: `src/export/diagnostic-bundle.mjs`
- Modify: `tests/diagnostic-export.test.mjs`

**Interfaces:**
- Diagnostic uses `safePacketId` for candidate lookup.
- Diagnostic includes status, attempts, candidate manifest/state and stage outputs, model evidence, production manifest, affected regressions, owner decisions, quality audit, and supervisor history.
- Diagnostic omits browser/chat/therapy/development-case content and credentials.

- [ ] **Step 1: Write RED completeness/privacy test**

Create a dotted candidate ID, candidate state with compilation/review/error/owner/quality/regression fields, a candidate ZIP manifest, stage attempts, production manifest, and latest run model-resolution file. Pass browser therapy content and a development-case file containing a unique secret marker. Assert every required packet/system file is present and none of these names or bytes appear:

```js
assert.equal(names.some((name) => /^chat\//.test(name)), false);
assert.equal(names.some((name) => /^reasoning\//.test(name)), false);
assert.equal(names.some((name) => /development-case/i.test(name)), false);
assert.equal(buffer.includes(Buffer.from("PRIVATE_THERAPY_MARKER")), false);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/diagnostic-export.test.mjs`

Expected: candidate state/model evidence are missing and private chat/reasoning is included.

- [ ] **Step 3: Implement deterministic safe collection**

Read the active candidate via `safePacketId`, extract only `manifest.json` from `original.zip`, include the candidate state and lifecycle ledger, and select the newest `run-*` directory containing model-resolution evidence. Remove browser-state, transcript, therapy ledger, development feedback/audit/job payload collection. Keep supervisor/roadmap summaries and packet evidence.

- [ ] **Step 4: Verify GREEN**

Run the focused diagnostic test and inspect ZIP names and marker absence.

---

### Task 6: Version, documentation, release gates, and artifacts

**Files:**
- Modify: `package.json`
- Modify: `src/guide-packet/builder.mjs`
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `AUTOPILOT.md`
- Modify: `scripts/verify-package.sh`
- Modify: outer `install-and-run.sh`
- Create: `docs/GUIDE-PACKET-RUNTIME-RECOVERY-v0.14.1.md`
- Create: `IMPLEMENTATION-REPORT-v0.14.1.md`

**Interfaces:**
- Produces `inner-signal-runtime-v0.14.1-guide-packet-runtime-recovery.zip` and matching `.sha256`.

- [ ] **Step 1: Bump active version surfaces**

Change runtime/package/install documentation to `0.14.1` while leaving historical v0.14.0 docs and fixture provenance unchanged unless they declare an active minimum runtime.

- [ ] **Step 2: Extend package verification**

Require lifecycle/failure modules, exact-model assertions, diagnostic attempt/error evidence, private-data exclusion, stable fingerprint behavior, and candidate-not-installed status.

- [ ] **Step 3: Run focused and complete deterministic suites**

Run:

```bash
node --test tests/guide-packet-lifecycle.test.mjs tests/guide-packet-autopilot.test.mjs tests/model-resolver.test.mjs tests/development-supervisor.test.mjs tests/diagnostic-export.test.mjs tests/server.test.mjs
npm test
npm run graph:test
npm run verify
```

Expected: zero failures; A001/H001 and all pre-existing tests remain green.

- [ ] **Step 4: Build the standalone ZIP**

Create a clean staging directory containing `install-and-run.sh`, `README-INSTALL.txt`, and `inner-signal-runtime-v0.14.1/`; exclude `.env`, `.inner-signal-autopilot`, ledgers, Git metadata, temporary files, credentials, and private diagnostics.

- [ ] **Step 5: Verify clean extraction**

Extract into a fresh temporary directory, run `npm test`, `npm run graph:test`, and `npm run verify`, and confirm package version `0.14.1` plus the candidate-only manifest.

- [ ] **Step 6: Verify dirty upgrade**

Install v0.14.0 into a temporary `~/Téléchargements`-shaped destination with sentinel `.env`, candidate state, owner-decision state, rollback/history, and production manifest. Run the v0.14.1 installer twice. Assert sentinels and production r5 survive, r01 remains uninstalled, and the command is idempotent.

- [ ] **Step 7: Produce evidence and checksum**

Write the implementation report with baseline `152/152`, final test totals, exact commands, model-environment limitation, candidate/production identities, clean-extraction result, dirty-upgrade result, and SHA-256. Hash the final ZIP with `sha256sum` and verify it once with `sha256sum -c` using a release-relative checksum file.
