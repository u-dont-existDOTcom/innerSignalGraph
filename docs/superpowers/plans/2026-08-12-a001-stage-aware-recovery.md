# A001 Stage-Aware Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a failed `gpt-5.6-sol` A001 case audit from wasting Claude calls or escaping as `uncaught-error`, while preserving completed extraction work and surfacing a privacy-safe exact diagnosis automatically.

**Architecture:** Add a case-stage error boundary and a small A001 checkpoint/retry controller. The existing case-formulation and tiered-pipeline units keep their policy behavior; the controller supplies validated extraction reuse, one bounded retry for retryable audits, safe attempt evidence, and a role-aware terminal decision.

**Tech Stack:** Node.js 20+ ESM, `node:test`, filesystem JSON checkpoints, subscription-backed Codex and Claude CLIs, Bash launcher.

## Global Constraints

- Exact model roles remain `gpt-5.6-sol`, `claude-opus-5`, conditional `claude-fable-5`, and the already validated renderer.
- Do not change therapy policy, guide prose, graph routing, acceptance criteria, production revision r5, or owner-gated Guide Packet state.
- Never include prompts, transcripts, raw model output, provider stdout/stderr, credentials, or therapy snapshots in exported diagnostic evidence.
- Local extraction checkpoints may contain the already validated case snapshot, but the diagnostic exporter must include only their non-clinical metadata and attempt ledger.
- Retry only a classified transient transport/service failure or correctable structured-result failure, once per process run.
- Authentication, unavailable model, incompatible CLI, unsupported schema, bad configuration, and unknown failures are deterministic until contrary evidence exists.
- The untouched source baseline is 178/178 passing tests.
- The extracted source has no Git metadata. Do not fabricate commits; preserve design/plan/report files in the package and sync them to the resolved GitHub repository only if a repository can be identified without guessing.

---

### Task 1: Stage-attributed case-formulation failures

**Files:**
- Create: `src/case-formulation/stage-failure.mjs`
- Modify: `src/case-formulation/run.mjs`
- Create: `tests/case-stage-failure.test.mjs`

**Interfaces:**
- Produces: `CaseStageError`, `asCaseStageError(error, { stage, provider })`, `safeCaseStageFailure(error)`, and `isCaseAuditFailure(error)`.
- `safeCaseStageFailure` returns `{ stage, role, provider, model, classification, retryable, actionCode, message, code, exitStatus, occurredAt }` and no raw response fields.

- [ ] **Step 1: Write failing classification tests**

Create literal test cases for timeout/rate-limit (`TRANSIENT`, retryable), invalid structured result (`STRUCTURED_RESULT`, retryable), authentication (`AUTH_REQUIRED`, `CODEX_REAUTH`, not retryable), model access (`MODEL_UNAVAILABLE`, not retryable), CLI/schema incompatibility (`CLI_INCOMPATIBLE`, not retryable), and unknown provider exit (`PROVIDER_FAILURE`, not retryable). Assert that serialized output omits supplied `stdout`, `stderr`, prompt, transcript, token, and response text sentinels.

- [ ] **Step 2: Write a failing real-call boundary test**

Use a provider whose `generate()` throws a `ProviderError` with `details.stage = "case_audit"`. Call `runCaseAudit()` and assert the rejection is a `CaseStageError` whose safe form identifies `case_audit`, `openai`, and `gpt-5.6-sol`.

- [ ] **Step 3: Run RED**

Run: `node --test tests/case-stage-failure.test.mjs`

Expected: FAIL because the stage-failure module and wrapper do not exist.

- [ ] **Step 4: Implement the minimal stage boundary**

Wrap only provider generation, JSON parsing, and validation inside `structuredCall()`:

```js
try {
  const raw = await provider.generate({ ...prompt, metadata, outputSchema });
  const parsed = parseModelJson(raw.text, `${provider.id} ${metadata.stage}`);
  const value = validator(parsed);
  return { value, raw, durationMs: Date.now() - started };
} catch (error) {
  throw asCaseStageError(error, { stage: metadata.stage, provider });
}
```

The classifier may inspect nested error details internally, but the exported safe value must be built from an allowlist and must never copy arbitrary `details`.

- [ ] **Step 5: Run GREEN and the adjacent formulation suite**

Run: `node --test tests/case-stage-failure.test.mjs tests/case-formulation.test.mjs tests/tiered-pipeline.test.mjs`

Expected: all pass.

### Task 2: Durable extraction checkpoint and bounded audit-only retry

**Files:**
- Create: `src/autopilot/a001-stage-recovery.mjs`
- Modify: `src/case-formulation/run.mjs`
- Modify: `src/orchestrator/run-tiered-pipeline.mjs`
- Modify: `src/orchestrator/run-formulated-pipeline.mjs`
- Create: `tests/a001-stage-recovery.test.mjs`

**Interfaces:**
- Produces: `buildA001StageFingerprint(value)`, `createA001StageRecovery({ stateDir, lane, fingerprint, maxAuditAttempts })`.
- Recovery object methods: `loadExtraction({ provider })`, `saveExtraction({ value, providerMetadata })`, `recordAuditAttempt({ attempt, failure, completed })`, and `clearExtraction()`.
- Case formulation consumes optional `recovery`; defaults preserve all existing runtime behavior.

- [ ] **Step 1: Write the failing restart/reuse test**

Run one formulation with a counting Claude provider and a Codex provider that throws a retryable failure twice. Assert Claude is called once, the extraction checkpoint exists, and the attempt ledger contains two safe audit failures. Construct a new recovery object with the same fingerprint, use a succeeding Codex provider, and assert the second process-equivalent call performs zero additional Claude calls and completes audit from the checkpoint.

- [ ] **Step 2: Write the failing mismatch and privacy tests**

Assert a different fingerprint or extractor model ignores the checkpoint. Assert the checkpoint contains the validated snapshot but not `raw.text`, prompt, transcript, stdout, or stderr; assert the diagnostic attempt ledger contains no snapshot or clinical sentinels.

- [ ] **Step 3: Run RED**

Run: `node --test tests/a001-stage-recovery.test.mjs`

Expected: FAIL because recovery creation and the optional formulation contract do not exist.

- [ ] **Step 4: Implement atomic checkpoint storage**

Write temporary JSON next to the target and rename it atomically. Use lane-safe filenames under `<stateDir>/a001-stage/`. Store the exact fingerprint, validated `value`, extractor provider/model/request ID/duration, and timestamps. Store the safe audit attempt ledger separately as `<stateDir>/a001-stage-attempts.json`.

- [ ] **Step 5: Implement extraction resolution and audit retry**

Add helpers in `src/case-formulation/run.mjs`:

```js
export async function resolveCaseExtraction({ context, provider, onProgress, recovery })
export async function runCaseAuditWithRecovery({ context, snapshot, provider, onProgress, recovery })
```

`resolveCaseExtraction` loads a matching validated checkpoint or performs and immediately saves one extraction. `runCaseAuditWithRecovery` makes at most `recovery.maxAuditAttempts` calls, retries only when `safeCaseStageFailure(error).retryable === true`, records every attempt, and emits a `retrying` progress event that explicitly says the extraction is reused.

- [ ] **Step 6: Thread recovery through both pipeline shapes**

Add optional `caseRecovery` parameters to `runTieredTherapyPipeline()` and `runFormulatedPipeline()`. Replace their direct extraction/audit calls with the exported helpers. Default `undefined` must make one extraction and one audit exactly as v0.14.2 did.

- [ ] **Step 7: Run GREEN and mutation checks**

Run: `node --test tests/a001-stage-recovery.test.mjs tests/case-formulation.test.mjs tests/pipeline.test.mjs tests/tiered-pipeline.test.mjs`

Then temporarily reason through these mutations: remove fingerprint comparison, remove the retryability check, or call extraction inside the retry loop. At least one literal assertion must fail for each mutation.

### Task 3: Stop misrouting Codex failures to Fable

**Files:**
- Modify: `src/autopilot/a001-stage-recovery.mjs`
- Modify: `src/cli/autopilot.mjs`
- Create: `tests/a001-failure-routing.test.mjs`

**Interfaces:**
- Produces: `decideA001FailureRoute({ failure, result, acceptance, fableEnabled, primaryAnthropicModel })`.
- Returns either `{ kind: "TERMINAL_STAGE_FAILURE", failure }`, `{ kind: "FABLE_REASONING_ESCALATION" }`, or `{ kind: "NO_ESCALATION" }`.

- [ ] **Step 1: Write the exact observed-sequence RED test**

Feed an OpenAI `case_audit` stage failure into `decideA001FailureRoute()` with Fable enabled and no result. Assert the decision is `TERMINAL_STAGE_FAILURE`, never `FABLE_REASONING_ESCALATION`. Add a control proving a completed but acceptance-failing Claude reasoning result may still select Fable.

- [ ] **Step 2: Write a failing terminal-status test**

Exercise the exported terminal body builder with an exhausted retryable audit failure. Assert stage `A001-case-audit`, model `gpt-5.6-sol`, the normalized failure class, checkpoint reuse next action, and absence of `uncaught-error`. Exercise authentication and assert `ACTION_REQUIRED` plus `CODEX_REAUTH`.

- [ ] **Step 3: Run RED**

Run: `node --test tests/a001-failure-routing.test.mjs`

Expected: FAIL because the routing policy and terminal builder do not exist.

- [ ] **Step 4: Apply the routing policy in the live A001 block**

Create primary and Fable recovery objects with fingerprints covering A001 case/version, `A001_PIPELINE_REVISION`, guide version, lane, and exact provider models. After the primary catch, evaluate the policy before any `ensureFable()` call. Finalize a terminal audit failure immediately. Wrap the Fable pipeline itself so no stage exception can reach the package-level catch.

- [ ] **Step 5: Make terminal output self-explanatory**

When `finalize()` receives `details.failure`, include that allowlisted failure object in the printed JSON. Do not print arbitrary details. Write the same safe object to `A001-stage-failure.json` and final status.

- [ ] **Step 6: Run GREEN**

Run: `node --test tests/a001-failure-routing.test.mjs tests/autopilot.test.mjs tests/a001-stage-recovery.test.mjs`

Expected: all pass, and removing the audit-stage guard makes the observed-sequence test fail.

### Task 4: Automatic Codex authentication recovery and privacy-safe diagnostics

**Files:**
- Modify: `run-autopilot.sh`
- Modify: `src/export/diagnostic-bundle.mjs`
- Modify: `src/autopilot/status.mjs`
- Modify: `tests/auth-recovery.test.mjs`
- Modify: `tests/autopilot.test.mjs`
- Modify: `tests/diagnostic-export.test.mjs`

**Interfaces:**
- Launcher consumes `actionCode = "CODEX_REAUTH"`.
- Diagnostic export includes `runtime/latest-run/A001-stage-attempts.json` or the stable safe ledger, never the extraction checkpoint.

- [ ] **Step 1: Write failing authentication-launcher tests**

Execute the shell recovery helper through a fake Codex command that implements `login` and `login status`. Assert one login attempt, successful status check, and automatic resume with `INNER_SIGNAL_CODEX_REAUTH_ATTEMPTED=1`. Assert a second failure stops without a loop. Test behavior, not source text.

- [ ] **Step 2: Write the failing diagnostic test**

Seed an A001 attempt ledger with safe values and an extraction checkpoint containing a unique clinical sentinel. Export the recovery ZIP. Assert the ledger is present, the checkpoint file is absent, and the sentinel plus prompt/raw-output/credential sentinels are absent from every ZIP entry.

- [ ] **Step 3: Run RED**

Run: `node --test tests/auth-recovery.test.mjs tests/diagnostic-export.test.mjs`

Expected: FAIL because Codex reauthentication and A001 safe evidence export do not exist.

- [ ] **Step 4: Implement one-shot Codex login recovery**

Mirror the established Claude wrapper boundary using `codex login`, then `codex login status`, and automatic `exec ./run-autopilot.sh --force-validation`. Never read, print, copy, or package the Codex auth cache. Human browser interaction is requested only when authentication is actually required.

- [ ] **Step 5: Export only safe A001 evidence**

Add the safe attempt ledger and failure file to diagnostic evidence. Explicitly deny the `a001-stage/` extraction checkpoint directory. Extend `writeFinalStatus()` to render failure class/model/message in its local Markdown status without arbitrary nested details.

- [ ] **Step 6: Run GREEN**

Run: `node --test tests/auth-recovery.test.mjs tests/autopilot.test.mjs tests/diagnostic-export.test.mjs tests/web-client.test.mjs`

Expected: all pass.

### Task 5: Release metadata, full gates, and upgrade artifact

**Files:**
- Modify: `package.json`
- Modify: `src/core/runtime-version.mjs`
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `AUTOPILOT.md`
- Create: `docs/A001-STAGE-RECOVERY-v0.14.3.md`
- Create: `IMPLEMENTATION-REPORT-v0.14.3.md`
- Modify: `BUILD-VERIFY.txt`
- Modify the release-level `install-and-run.sh` during packaging.

**Interfaces:**
- Release version: `0.14.3`.
- Installer target remains `~/Téléchargements/inner-signal-runtime` and preserves `.env`, `.inner-signal-autopilot`, ledgers, data, production r5, r01/r02 candidate bytes, and owner decisions.

- [ ] **Step 1: Update release surfaces without changing policy claims**

Describe only orchestration, retry, checkpoint, diagnostics, and auth recovery. State that v0.14.3 cannot reconstruct the already completed v0.14.2 Fable extraction because v0.14.2 never checkpointed it; future completed extractions are reusable.

- [ ] **Step 2: Run focused and complete source gates**

Run:

```bash
node --test tests/case-stage-failure.test.mjs tests/a001-stage-recovery.test.mjs tests/a001-failure-routing.test.mjs tests/auth-recovery.test.mjs tests/diagnostic-export.test.mjs
npm test
npm run graph:test
npm run verify
```

Expected: every command exits 0; test count is greater than 178; graph production remains 12/12; r01 remains 4/4; r02 remains 5/5.

- [ ] **Step 3: Build the release ZIP and checksum**

Stage `inner-signal-runtime-v0.14.3/`, `install-and-run.sh`, and `README-INSTALL.txt` under a clean release root. Create `inner-signal-runtime-v0.14.3-a001-stage-aware-recovery.zip` and a SHA-256 sidecar. Reject absolute paths, traversal paths, symlinks, caches, `.env`, runtime state, and credentials.

- [ ] **Step 4: Verify the actual ZIP by clean extraction**

Extract to a new temporary directory and run `npm test`, `npm run graph:test`, and `npm run verify` from the extracted source.

- [ ] **Step 5: Verify two consecutive dirty upgrades**

Seed a v0.14.2-style installation with unique sentinels for `.env`, production r5, r01/r02 ZIP bytes, owner decisions, Guide Packet attempts/history, A001/H001 checkpoints, ledgers, data, rollback, and supervisor state. Run the packaged installer twice. Assert all state hashes are unchanged except explicitly versioned managed code and the new empty/safe A001 metadata files; assert no candidate is installed.

- [ ] **Step 6: Freeze evidence and preserve deliverables**

Record exact test counts, graph counts, packaged checks, upgrade checks, and SHA-256 in `IMPLEMENTATION-REPORT-v0.14.3.md`. Save the ZIP, checksum, design, plan, and report as durable deliverables. If the connected GitHub repository can be resolved unambiguously, commit the architecture files and release changes there; otherwise provide a precise GitHub handoff rather than guessing a repository.
