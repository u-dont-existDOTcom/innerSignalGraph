# Validation Isolation and Remote Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Inner Signal v0.15.1 with hermetic candidate validation, truthful bootstrap failure semantics, and bounded privacy-safe remote progress inspection.

**Architecture:** Candidate tests run under a disposable home/config/state boundary with external automation disabled and credentials removed. Runtime and development-worker events are reduced to a strict progress core, scheduled locally, and written as one mutable `progress/<machineId>/current.json` file on `runtime-diagnostics`; failures retain only the newest local snapshot for retry.

**Tech Stack:** Node.js 20+ ESM, Node test runner, Bash, local Git/bare remotes, GitHub CLI Contents API, atomic JSON files.

## Global Constraints

- Release version: `0.15.1`.
- Repository: `u-dont-existDOTcom/innerSignalGraph`.
- Update branch: `stable`.
- Remote status branch: `runtime-diagnostics`; it is never merged into `main` or `stable`.
- Default French Zorin source checkout: `~/Téléchargements/innerSignalGraph`.
- Default installed runtime: `~/Téléchargements/inner-signal-runtime`.
- Candidate validation must not access real GitHub authentication, real source/runtime state, model credentials, or parent user-state roots.
- Never upload task names, job IDs, blocker/analysis/directive prose, chat, therapy or hypnosis state, guide content, model prompts/output/reasoning, raw logs, credentials, host/user/network identity, absolute paths, PIDs, or hashes derived from excluded content.
- Preserve `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, `data`, Guide Packet candidates, owner decisions, and installed production policy byte-for-byte across updates.
- Ordinary update failure keeps the installed runtime available; bootstrap failure returns nonzero and never claims the requested release was installed.
- Every behavior change begins with an observed failing test.

---

## File structure

- Modify `src/git/runtime-update.mjs`: construct the hermetic candidate-validation environment.
- Modify `tests/git-runtime-update.test.mjs`: make every child CLI fixture root explicit and add environment-boundary integration coverage.
- Modify `tests/runtime-service-liveness.test.mjs`: poison external GitHub access and isolate launcher roots.
- Modify `src/cli/git-update.mjs`: return a dedicated nonzero bootstrap failure code.
- Modify `packaging/install-from-git.sh`: reject every bootstrap result except verified current/updated state.
- Modify `tests/git-launcher.test.mjs`: execute the bootstrap failure path against an old preserved runtime.
- Create `src/diagnostics/remote-progress.mjs`: local event persistence, strict payload construction, deterministic assessment, and upload scheduling.
- Create `tests/remote-progress.test.mjs`: schema/privacy/liveness/scheduling tests.
- Extend `src/diagnostics/github-sync.mjs`: update the single current progress file through the existing validated GitHub transport.
- Create `src/cli/sync-progress.mjs`: one-shot and watch-mode snapshot/sync command.
- Extend `tests/github-diagnostic-sync.test.mjs` and `tests/fixtures/fake-gh-cli.mjs`: progress create/update/retry/conflict coverage.
- Modify `src/cli/autopilot.mjs`: persist safe foreground stage transitions and terminal state.
- Modify `run-autopilot.sh`: own and clean up the bounded progress-sync companion.
- Modify `src/server/create-server.mjs`, `apps/web/app.js`, and `apps/web/index.html`: expose last remote-progress delivery without exposing its body.
- Modify package/docs/examples and create `IMPLEMENTATION-REPORT-v0.15.1.md`.

---

### Task 1: Hermetic candidate-validation environment

**Files:**
- Modify: `src/git/runtime-update.mjs`
- Modify: `tests/git-runtime-update.test.mjs`

**Interfaces:**
- Produces: `buildCandidateValidationEnvironment({ parentEnv, validationRoot, validationState, validationGuides }) -> Record<string,string>`.
- Consumes: the returned object as the exact environment for candidate `npm test` and `npm run graph:test` subprocesses.

- [ ] **Step 1: Preserve the observed ambient-state RED reproduction**

Run the existing focused regression with an external state root:

```bash
probe_state="$(mktemp -d)/external-state"
mkdir -p "$probe_state"
AUTOPILOT_STATE_DIR="$probe_state" node --test \
  --test-name-pattern='git-update CLI queues a strict incident' \
  tests/git-runtime-update.test.mjs
```

Expected RED: exit 1 with missing fixture `git-update-status.json`; the external root contains the synthetic `candidate contract fails` outbox file.

- [ ] **Step 2: Add a real candidate-environment integration test**

Create a local bare-remote candidate whose `npm test` script executes a checked-in fixture script that fails unless all of these literals hold:

```js
assert.equal(process.env.INNER_SIGNAL_VALIDATION_SANDBOX, "1");
assert.equal(process.env.INNER_SIGNAL_GIT_AUTO_UPDATE, "false");
assert.equal(process.env.INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS, "false");
assert.equal(path.dirname(process.env.AUTOPILOT_STATE_DIR), path.dirname(process.env.HOME));
assert.equal(process.env.GH_CONFIG_DIR.startsWith(process.env.HOME), true);
assert.equal(process.env.GH_TOKEN, undefined);
assert.equal(process.env.GITHUB_TOKEN, undefined);
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
```

Pass decoy values for all four credentials in the parent environment. Run the focused test and verify RED because the current validator forwards the credentials and real home.

- [ ] **Step 3: Implement the minimal environment boundary**

Export a helper that copies ordinary process variables, deletes credential keys matching the explicit GitHub/OpenAI/Anthropic set, and overlays:

```js
{
  HOME: path.join(validationRoot, "home"),
  XDG_CONFIG_HOME: path.join(validationRoot, "home", ".config"),
  XDG_DATA_HOME: path.join(validationRoot, "home", ".local", "share"),
  XDG_STATE_HOME: path.join(validationRoot, "home", ".local", "state"),
  XDG_CACHE_HOME: path.join(validationRoot, "home", ".cache"),
  GH_CONFIG_DIR: path.join(validationRoot, "home", ".config", "gh"),
  AUTOPILOT_STATE_DIR: validationState,
  GUIDE_PACKET_ROOT: validationGuides,
  INNER_SIGNAL_VALIDATION_SANDBOX: "1",
  INNER_SIGNAL_GIT_AUTO_UPDATE: "false",
  INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "false"
}
```

Create every isolated directory mode `0700` before running validation.

- [ ] **Step 4: Make the updater CLI regression independent of ambient state**

In each child `git-update.mjs` invocation, explicitly set:

```js
AUTOPILOT_STATE_DIR: context.stateDir,
INNER_SIGNAL_GIT_INSTALL_ROOT: context.installedRoot,
INNER_SIGNAL_GIT_SOURCE: context.sourceRoot
```

Rerun the Step 1 command. Expected GREEN: one focused test passes and the external root remains empty.

- [ ] **Step 5: Run focused isolation tests**

```bash
node --test tests/git-runtime-update.test.mjs
```

Expected: every updater test passes with no external network access.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/git/runtime-update.mjs tests/git-runtime-update.test.mjs
git commit -m "Isolate candidate validation environment"
```

---

### Task 2: Launcher isolation and truthful bootstrap failure

**Files:**
- Modify: `tests/runtime-service-liveness.test.mjs`
- Modify: `src/cli/git-update.mjs`
- Modify: `packaging/install-from-git.sh`
- Modify: `tests/git-launcher.test.mjs`

**Interfaces:**
- `git-update.mjs --bootstrap`: exit `12` for `DEFERRED` or `FAILED_SAFE`, `10` for `UPDATED`, and `0` for `CURRENT`.
- Ordinary `git-update.mjs`: preserve the existing launch-safe exit behavior.

- [ ] **Step 1: Add poison-GitHub launcher RED**

Create a test-owned executable `gh` that writes `external-gh-called.txt` and exits 97. Start each copied launcher with an ambient external `AUTOPILOT_STATE_DIR` containing a queued decoy incident. Assert after shutdown:

```js
await assert.rejects(fs.access(poisonMarker));
assert.deepEqual(await fs.readdir(externalState), ["diagnostic-outbox"]);
```

Run `node --test tests/runtime-service-liveness.test.mjs`. Expected RED: the marker exists because the launcher inherits the parent automation environment.

- [ ] **Step 2: Isolate copied launchers**

Give every `startWrapper` child a test-owned `AUTOPILOT_STATE_DIR`, a nonexistent sibling `INNER_SIGNAL_GIT_SOURCE`, and literal `false` values for automatic update and diagnostics. Preserve the poison command to make regressions observable. Rerun and expect GREEN.

- [ ] **Step 3: Add executable bootstrap-failure RED**

Extend the fake command fixture used by `tests/git-launcher.test.mjs` so `node ... git-update.mjs --bootstrap` returns a failed-safe JSON object with exit 0 while an old installed launcher writes `old-runtime-launched.txt` if executed. Run the real `packaging/install-from-git.sh` and assert nonzero plus no marker.

Expected RED: current bootstrap exits 0 and executes the old launcher.

- [ ] **Step 4: Implement bootstrap-specific exit semantics**

Parse the bootstrap flag once in `src/cli/git-update.mjs`. After writing status, set:

```js
if (result.status === "UPDATED") process.exitCode = 10;
else if (bootstrap && !["CURRENT"].includes(result.status)) process.exitCode = 12;
```

Make `install-from-git.sh` accept only updater exits 0 and 10, with exit 12 producing `BLOCKED: the verified stable runtime could not be installed.` It must not execute the installed launcher after that branch.

- [ ] **Step 5: Run launcher gates**

```bash
node --test tests/runtime-service-liveness.test.mjs tests/git-launcher.test.mjs
```

- [ ] **Step 6: Commit Task 2**

```bash
git add tests/runtime-service-liveness.test.mjs src/cli/git-update.mjs packaging/install-from-git.sh tests/git-launcher.test.mjs
git commit -m "Make bootstrap and launcher tests hermetic"
```

---

### Task 3: Strict local and remote progress contract

**Files:**
- Create: `src/diagnostics/remote-progress.mjs`
- Create: `tests/remote-progress.test.mjs`

**Interfaces:**
- `recordRuntimeProgress({ stateDir, event, now, pid }) -> Promise<localRecord>`.
- `finalizeRuntimeProgress({ stateDir, status, stage, now }) -> Promise<localRecord>`.
- `buildRemoteProgress({ machineId, runtime, runtimeProgress, supervisor, update, diagnostics, now, isProcessAlive, priorSync }) -> { payload, coreHash, meaningfulChanged }`.
- `progressUploadDecision({ nowMs, lastUploadMs, meaningfulChanged, minimumMs, heartbeatMs }) -> boolean`.

- [ ] **Step 1: Write strict schema/privacy RED**

Pass a supervisor snapshot containing task names, IDs, blocker text, analysis prose, model output, absolute paths, credentials, and decoy markers. Assert exact top-level keys:

```js
[
  "diagnostics", "format", "machineId", "observedAt",
  "privacy", "progress", "runtime", "update"
]
```

Assert the serialized payload contains none of the decoys and contains literal safe values such as `development`, `VERIFYING`, `ADVANCING`, numeric pending/blocked counts, and `AUTO_CONTINUE`.

Run `node --test tests/remote-progress.test.mjs`. Expected RED: module missing.

- [ ] **Step 2: Write liveness and assessment RED cases**

Use hand-derived table rows:

```js
[
  { overall: "COMPLETE", alive: false, age: 0, want: "COMPLETE" },
  { overall: "WAITING_FOR_HUMAN", alive: true, age: 5, want: "WAITING_FOR_HUMAN" },
  { overall: "BLOCKED_INTERNAL", alive: true, age: 5, want: "BLOCKED" },
  { overall: "VERIFYING", alive: true, age: 120, want: "ADVANCING" },
  { overall: "VERIFYING", alive: true, age: 1800, want: "LONG_RUNNING_STAGE" },
  { overall: "VERIFYING", alive: false, age: 120, want: "WORKER_NOT_RUNNING" },
  { overall: "IDLE", alive: false, age: 0, want: "IDLE" }
]
```

- [ ] **Step 3: Implement atomic local progress and strict construction**

Persist only stage/status/timestamps/local PID/last-completed-stage in mode `0600`. Build the remote payload field-by-field using enum sets, slug/code validators, bounded integers, ISO timestamps, semver, Git SHA, and the random UUID. Never spread a source object.

Compute the local core hash from the allowlisted fields excluding `observedAt`, elapsed counters, and `secondsSinceMeaningfulProgress`. Do not include the hash in the payload.

- [ ] **Step 4: Write and implement scheduling RED→GREEN**

Assert these literal decisions with `minimumMs=30000` and `heartbeatMs=300000`:

- changed at 10 seconds: false;
- changed at 30 seconds: true;
- unchanged at 299 seconds: false;
- unchanged at 300 seconds: true;
- never uploaded: true.

- [ ] **Step 5: Run mutation-sensitive privacy checks**

Temporarily spread `supervisor.current` into the payload and confirm the decoy test fails; restore strict construction and rerun GREEN.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/diagnostics/remote-progress.mjs tests/remote-progress.test.mjs
git commit -m "Add strict remote progress contract"
```

---

### Task 4: GitHub current-progress delivery and bounded watcher

**Files:**
- Modify: `src/diagnostics/github-sync.mjs`
- Create: `src/cli/sync-progress.mjs`
- Modify: `tests/github-diagnostic-sync.test.mjs`
- Modify: `tests/fixtures/fake-gh-cli.mjs`

**Interfaces:**
- `syncRemoteProgress(options) -> { status, uploaded, branch, path, commitSha }`.
- CLI: `sync-progress.mjs --once` and `sync-progress.mjs --watch`.

- [ ] **Step 1: Add fake-GitHub progress create/update RED**

Queue a strict payload and assert the real sync boundary creates `progress/<machineId>/current.json`. Change only a safe stage, sync again, and assert the fake Contents API receives the existing blob `sha` and replaces the file. Assert the remote bytes exactly equal the strict payload.

- [ ] **Step 2: Add retry/conflict RED**

Make the first PUT fail and assert the newest local snapshot remains. Make the next call succeed and assert a receipt/status is written. Return different occupied bytes under the same requested version and assert the sync does not treat them as success.

- [ ] **Step 3: Implement `syncRemoteProgress` with existing transport primitives**

Reuse repository/branch validation, authenticated `gh api`, branch creation, and bounded subprocess timeouts from incident sync. GET the current path; PUT without `sha` when absent and with the exact current `sha` when replacing. Never add tokens to arguments.

- [ ] **Step 4: Implement one-shot and watch CLI behavior**

`--once` builds local safe state, applies the schedule, writes the newest local snapshot atomically, and attempts one remote update. `--watch` repeats every 30 seconds with an unref-safe signal handler, retains only the newest snapshot, and exits cleanly on `SIGINT`/`SIGTERM`. Delivery failure returns a retry status but never terminates the app.

- [ ] **Step 5: Run focused sync suites**

```bash
node --test tests/remote-progress.test.mjs tests/github-diagnostic-sync.test.mjs
```

- [ ] **Step 6: Commit Task 4**

```bash
git add src/diagnostics/github-sync.mjs src/cli/sync-progress.mjs tests/github-diagnostic-sync.test.mjs tests/fixtures/fake-gh-cli.mjs
git commit -m "Sync bounded progress heartbeats"
```

---

### Task 5: Runtime lifecycle wiring and v0.15.1 surfaces

**Files:**
- Modify: `src/cli/autopilot.mjs`
- Modify: `run-autopilot.sh`
- Modify: `src/server/create-server.mjs`
- Modify: `apps/web/app.js`
- Modify: `apps/web/index.html`
- Modify: `tests/autopilot.test.mjs`
- Modify: `tests/server.test.mjs`
- Modify: `tests/web-client.test.mjs`
- Modify: `package.json`
- Modify: `src/core/runtime-version.mjs`
- Modify: `.env.cli.example`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `AUTOPILOT.md`
- Create: `docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.1.md`

**Interfaces:**
- Launcher owns `PROGRESS_PID` and stops it in the existing cleanup trap.
- Local status API returns progress delivery status only, never the remote payload body.

- [ ] **Step 1: Add runtime persistence RED**

Run a mock autopilot and assert `.inner-signal-autopilot/runtime-progress.json` records safe stage codes and ends terminal `PASS/complete`, without any event detail prose.

- [ ] **Step 2: Wire safe foreground events**

Wrap the existing stderr reporter so every event also calls `recordRuntimeProgress`; set the state root immediately after config load. Await `finalizeRuntimeProgress` inside `finalize()` before writing final status.

- [ ] **Step 3: Add launcher lifecycle RED**

Use a test node wrapper to identify `sync-progress.mjs --watch`, record its PID, and assert it starts once, survives while the server runs, and is terminated by launcher cleanup. Verify update-restart does not leave an orphan watcher.

- [ ] **Step 4: Wire the watcher and local status**

Start the watcher after the update transaction and before long validation. Add it to cleanup. Expose only `{ status, branch, path, lastSyncAt, assessment, observedAt }` from the local server status route and Overall Development panel.

- [ ] **Step 5: Bump metadata and document behavior**

Set both runtime version sources to `0.15.1`. Document five-minute maximum remote staleness, generated assessment meanings, strict exclusions, bootstrap failure behavior, and the unchanged one-time Git installation command.

- [ ] **Step 6: Run focused UI/runtime gates**

```bash
node --test tests/autopilot.test.mjs tests/runtime-service-liveness.test.mjs tests/server.test.mjs tests/web-client.test.mjs
```

- [ ] **Step 7: Commit Task 5**

```bash
git add src/cli/autopilot.mjs run-autopilot.sh src/server/create-server.mjs apps/web/app.js apps/web/index.html tests/autopilot.test.mjs tests/server.test.mjs tests/web-client.test.mjs package.json src/core/runtime-version.mjs .env.cli.example .env.example README.md START-HERE.md AUTOPILOT.md docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.1.md
git commit -m "Release observable Inner Signal v0.15.1"
```

---

### Task 6: Release verification, report, and remote cleanup

**Files:**
- Create: `IMPLEMENTATION-REPORT-v0.15.1.md`

- [ ] **Step 1: Run exact focused privacy and isolation gates**

```bash
node --test tests/remote-diagnostic.test.mjs tests/remote-progress.test.mjs tests/github-diagnostic-sync.test.mjs
AUTOPILOT_STATE_DIR="$(mktemp -d)/external-state" node --test tests/git-runtime-update.test.mjs tests/runtime-service-liveness.test.mjs tests/git-launcher.test.mjs
```

- [ ] **Step 2: Run complete gates**

```bash
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm test
npm run graph:test
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm run verify
git diff --check main...HEAD
```

Restore only known nondeterministic verifier fixtures through `apply_patch`, then confirm `git status --short` is empty.

- [ ] **Step 3: Run realistic clean-install and upgrade simulation**

Use a temporary bare remote and paths containing `Téléchargements`. Verify clean v0.15.1 installation, current/no-op, a second stable update, activation rollback, and byte-identical private sentinels. Give the candidate an ambient external state and poison GitHub command; both must remain untouched.

- [ ] **Step 4: Write and commit the release report**

Record root cause, RED output, GREEN counts, privacy contract, exact commands, preserved sentinels, known live-model limitation, local commit/tree SHAs, and remote verification method.

```bash
git add IMPLEMENTATION-REPORT-v0.15.1.md
git commit -m "Finalize verified v0.15.1 release"
```

- [ ] **Step 5: Publish without force**

Confirm remote `main` and `stable` still point at the v0.15.0 release. Create the remote commit from the exact verified local tree, fast-forward `main`, then fast-forward `stable` to the same commit. Abort if either expected ref moved.

- [ ] **Step 6: Clean the current diagnostic tree recoverably**

Delete only:

```text
diagnostics/a6e206af-036d-4343-8b64-0efea6212f23/1b4720fc2b8ce31dd27545cb6bef6261cebd94e07c08aca5f0cb730c01a6a237.json
```

Commit the deletion normally on `runtime-diagnostics`; do not rewrite branch history. Do not create a synthetic progress snapshot.

- [ ] **Step 7: Verify remote release**

Require `main` and `stable` to share the new commit, require its tree SHA and every recursive blob/mode to match local HEAD, and require the current diagnostics tree to contain neither the synthetic incident nor any test progress file.
