# Inner Signal v0.15.2 Deterministic Recovery Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and install Inner Signal v0.15.2 with deterministic promotion-recovery readiness coverage, browser-safe liveness tests, and hermetic direct-checkout diagnostic CLI tests.

**Architecture:** Keep the production launcher recovery path unchanged because it already condition-waits on public loopback health and the incident-era runtime successfully recovered on the same port. Make the test control the recovery-server transition explicitly, synchronize assertions on `/health`, own desktop-open commands and process teardown, and give every diagnostic CLI fixture a disjoint synthetic source root. Release only after full local, transactional, remote-ref, and installed-health verification.

**Tech Stack:** Node.js 24 test runner, ECMAScript modules, Bash launcher/installer, Git/GitHub refs, local loopback HTTP, deterministic mock providers.

## Global Constraints

- Baseline commit is `62418292489cf5c764e767f8b010b98b3e14c71c`; target release is v0.15.2.
- Do not skip, delete, weaken, or merely increase the timeout of the failing liveness test.
- Do not change production launcher timeout values or recovery behavior unless new evidence disproves the approved readiness-race classification.
- No real `xdg-open` or `gio` call may occur during tests.
- Preserve Git update atomicity, rollback, private state, diagnostic privacy, progress delivery, therapy/hypnosis behavior, guide graphs, exact model roles, Guide Packet owner gates, and production policy.
- Publication is non-forced and atomic; `main` and `stable` must finish on the same verified commit and recursive tree.
- The real installer runs exactly once after publication, followed by sustained application health verification.

---

### Task 1: Deterministic promotion-recovery readiness and side-effect ownership

**Files:**
- Modify: `tests/runtime-service-liveness.test.mjs`

**Interfaces:**
- Consumes: the existing `run-autopilot.sh` promotion-failure branch and public `/health`, `/v1/dev/status`, `/v1/guides/status`, and `/v1/debug/export` endpoints.
- Produces: a delayed-recovery test command wrapper, browser-opener stubs, condition-based recovery readiness, verified process-group teardown, and temporary-root cleanup.

- [ ] **Step 1: Read the test-quality rules before changing the regression**

Read `superpowers:test-driven-development/writing-good-tests.md`. Name the production behavior that would break the test: removing the promotion-failure `start_server` call or returning from it before public health succeeds.

- [ ] **Step 2: Add a deterministic delayed-recovery harness while retaining the fixed 500-millisecond probe**

Add a promotion-specific command directory. Its `node` wrapper must:

```bash
if [[ "$*" == *"src/cli/promote-candidate.mjs"* ]]; then
  printf '%s\n' attempted > "$promotion_attempted"
  exit 17
fi
if [[ "$*" == *"src/cli/serve.mjs"* ]]; then
  count="$(cat "$serve_count" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s\n' "$count" > "$serve_count"
  if [[ "$count" -eq 2 ]]; then
    printf '%s\n' waiting > "$recovery_waiting"
    while [[ ! -f "$release_recovery" ]]; do sleep 0.05; done
  fi
fi
exec "$node_executable" "$@"
```

Place executable no-op `xdg-open` and `gio` files in every launcher test command directory:

```bash
#!/usr/bin/env bash
exit 0
```

Make the promotion test wait for `recovery_waiting` and then call the existing fixed-delay `assertRecoverySurface` without creating `release_recovery`.

- [ ] **Step 3: Run RED and record the exact failure**

Run outside network isolation:

```bash
node --test --test-isolation=none --test-reporter=tap --test-name-pattern='promotion failure restarts health, status, and recovery ZIP instead of abandoning the browser' tests/runtime-service-liveness.test.mjs
```

Expected RED: one failure with `TypeError: fetch failed` at the first `/health` request. Confirm no desktop tab opens and no matching temporary launcher process survives.

- [ ] **Step 4: Replace fixed-delay readiness with a condition assertion**

Change `assertRecoverySurface` so the first health request uses the existing `waitFor` helper and checks launcher liveness on every attempt:

```js
const health = await waitFor(async () => {
  assert.equal(child.exitCode, null, `launcher exited and took down recovery service:\n${output()}`);
  const response = await fetch(`${base}/health`).catch(() => null);
  return response?.status === 200 ? response : null;
}, "recovery health");
assert.equal(health.status, 200);
```

Keep all development-status, guide-status, ZIP content-type, ZIP size, and launcher-alive assertions. In the promotion test, assert health is unavailable while `recovery_waiting` exists, create `release_recovery`, and then call `assertRecoverySurface`.

- [ ] **Step 5: Make teardown complete and remove test roots**

After graceful process-group termination, send `SIGKILL` only if the exact group remains alive and await the child `exit` event. Register or perform `fs.rm(root, { recursive: true, force: true })` after each test. The progress-watcher test must still observe its `TERM` trap and prove exactly one watcher started.

- [ ] **Step 6: Run GREEN repeatedly and verify side effects**

Run the focused promotion test ten consecutive times, then the complete liveness file five consecutive times. Each command must exit zero. Before and after the runs, compare host browser process counts and confirm no new browser tab/process is launched; confirm no `/tmp/inner-signal-liveness-*` directory from the new runs and no matching launcher/server process survives.

- [ ] **Step 7: Commit Task 1**

```bash
git add tests/runtime-service-liveness.test.mjs
git commit -m "test: make recovery readiness deterministic"
```

---

### Task 1A: Isolate copied runtimes from the installed validation environment

**Files:**
- Modify: `tests/runtime-service-liveness.test.mjs`

**Interfaces:**
- Consumes: the installed autopilot process environment after `.env` has been loaded.
- Produces: launcher-copy processes whose five fixture-owned settings come only from the copied runtime's `.env`.

- [ ] **Step 1: Preserve the exact contaminated-environment RED**

Run the focused liveness file through Node with the installed `.env`. Require the observed validation-attempt and promotion-attempt marker timeouts, then run the same bytes without that environment and require 4/4 passing. Confirm `PORT` is the minimal setting that reproduces the difference.

- [ ] **Step 2: Add a deterministic poisoned-parent regression**

Pass an invalid parent `PORT` into the validation-failure liveness scenario. Before the fix, the copied server must fail before the synthetic validation marker. Do not change the 15-second condition deadline.

- [ ] **Step 3: Make the copied `.env` authoritative**

Before spawning `run-autopilot.sh`, remove only `INNER_SIGNAL_MODE`, `PORT`, `LEDGER_MODE`, `DEV_AUTOMATION_ENABLED`, and `GUIDE_PACKET_ROOT` from the inherited environment. Preserve all deliberate test controls and production precedence outside this test fixture.

- [ ] **Step 4: Verify the actual installed condition**

Run the contaminated focused file ten times, the complete package suite with the installed `.env`, and every release gate. The real transactional candidate validator must also pass while inheriting runtime configuration.

- [ ] **Step 5: Bound the self-update loop guard**

Reproduce the post-update installed failure in which `INNER_SIGNAL_UPDATE_APPLIED=1` reaches `npm test` and the nested launcher sees one update check instead of two. Unset the guard after the re-executed wrapper's second update check, and remove an outer guard from fresh launcher fixtures. Update the existing regression to inject a false parent guard, require exactly two update checks and one validation, and require the validation child to observe no guard.

---

### Task 2: Hermetic direct-checkout diagnostic CLI tests

**Files:**
- Modify: `tests/github-diagnostic-sync.test.mjs`

**Interfaces:**
- Consumes: `loadGitAutomationConfig({ env, installRoot: projectRoot })`, whose installed root is the source checkout for diagnostic CLI invocations.
- Produces: explicit fixture-local `INNER_SIGNAL_GIT_SOURCE` values that cannot overlap the checkout installed root.

- [ ] **Step 1: Re-run the focused file to preserve RED evidence**

```bash
node --test tests/github-diagnostic-sync.test.mjs
```

Expected RED: six CLI-path failures, including `sourceRoot and installedRoot must not overlap` and the progress CLI's normalized `PROGRESS_SYNC_UNAVAILABLE` result.

- [ ] **Step 2: Pin a disjoint source root in every CLI subprocess**

Add this field to each `execFileAsync` environment for `sync-progress.mjs` and `sync-diagnostics.mjs`, using that test's `context.root` or `root`:

```js
INNER_SIGNAL_GIT_SOURCE: path.join(context.root, "source-unavailable"),
```

For the standalone `--latest` fixture, use:

```js
INNER_SIGNAL_GIT_SOURCE: path.join(root, "source-unavailable"),
```

Do not change `validateGitAutomationRoots`, CLI production code, or its overlap assertions.

- [ ] **Step 3: Run GREEN in direct and candidate-style environments**

```bash
node --test tests/github-diagnostic-sync.test.mjs
validation_root="$(mktemp -d)"
HOME="$validation_root/home" \
XDG_CONFIG_HOME="$validation_root/home/.config" \
XDG_DATA_HOME="$validation_root/home/.local/share" \
XDG_STATE_HOME="$validation_root/home/.local/state" \
XDG_CACHE_HOME="$validation_root/home/.cache" \
GH_CONFIG_DIR="$validation_root/home/.config/gh" \
AUTOPILOT_STATE_DIR="$validation_root/state" \
INNER_SIGNAL_GIT_SOURCE="$validation_root/source-unavailable" \
INNER_SIGNAL_GIT_INSTALL_ROOT="$validation_root/runtime-unavailable" \
INNER_SIGNAL_VALIDATION_SANDBOX=1 \
INNER_SIGNAL_GIT_AUTO_UPDATE=false \
INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS=false \
node --test tests/github-diagnostic-sync.test.mjs
```

Expected GREEN: all diagnostic/progress sync tests pass in both environments.

- [ ] **Step 4: Commit Task 2**

```bash
git add tests/github-diagnostic-sync.test.mjs
git commit -m "test: isolate diagnostic CLI source roots"
```

---

### Task 3: Version and architecture documentation

**Files:**
- Modify: `package.json`
- Verify unchanged implementation: `src/core/runtime-version.mjs`
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `AUTOPILOT.md`
- Modify: `packaging/README-INSTALL.txt`
- Modify: `packaging/install-and-run.sh`
- Create: `docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.2.md`

**Interfaces:**
- Consumes: the approved design and green Task 1/Task 2 evidence.
- Produces: package/runtime version v0.15.2 and user-facing architecture that accurately describes condition-based recovery verification without claiming a production behavior change.

- [ ] **Step 1: Update the release version consistently**

Set `package.json` version to `0.15.2`. `src/core/runtime-version.mjs` must continue deriving `RUNTIME_VERSION` from the package file. Update only current-release headings or installer messages in README, START-HERE, AUTOPILOT, packaging README, and `install-and-run.sh`; preserve historical v0.15.1 evidence and test fixture payload versions.

- [ ] **Step 2: Write the v0.15.2 architecture note**

Document:

- incident ID and exact `fetch failed` assertion;
- incident-era marker, server-log, and ready-file timestamps;
- classification as readiness race rather than production or port-cleanup failure;
- authoritative public `/health` synchronization;
- delayed-recovery deterministic regression;
- no-op browser command ownership and complete process teardown;
- direct-checkout diagnostic source-root isolation;
- unchanged privacy, transaction, rollback, therapy, guide, and owner-gate contracts;
- exact release and installed-health gates.

- [ ] **Step 3: Run documentation/version consistency checks**

```bash
node -e "const p=require('./package.json'); if (p.version !== '0.15.2') process.exit(1)"
node --input-type=module -e "import('./src/core/runtime-version.mjs').then(({RUNTIME_VERSION})=>{if(RUNTIME_VERSION!=='0.15.2')process.exit(1)})"
rg -n "v0\.15\.1|version.: .0\.15\.1" README.md START-HERE.md AUTOPILOT.md packaging/README-INSTALL.txt packaging/install-and-run.sh package.json
git diff --check
```

Expected: the first two commands exit zero; the search finds no stale current-release heading/message; diff check is clean.

- [ ] **Step 4: Commit Task 3**

```bash
git add package.json README.md START-HERE.md AUTOPILOT.md packaging/README-INSTALL.txt packaging/install-and-run.sh docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.2.md
git commit -m "Release deterministic Inner Signal v0.15.2"
```

---

### Task 4: Complete verification and real transactional bootstrap

**Files:**
- Verify: all tracked source, tests, fixtures, scripts, and package artifacts
- Create only under `/tmp`: transactional repositories, installs, sentinels, and gate logs

**Interfaces:**
- Consumes: the complete v0.15.2 candidate tree.
- Produces: fresh focused repetition counts, full-suite/package evidence, a real-Git transactional bootstrap result, and byte-preservation hashes.

- [ ] **Step 1: Run focused repetitions without desktop side effects**

Run the Task 1 ten/five repetition campaign and the Task 2 direct/candidate-style campaign again on the exact candidate tree. Record commands, counts, durations, and zero surviving processes.

- [ ] **Step 2: Run every repository verification gate**

```bash
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm test
npm run graph:test
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm run verify
git diff --check 62418292489cf5c764e767f8b010b98b3e14c71c..HEAD
git status --short
```

Read every command's complete output and require exit zero, 242 or more package tests with zero failures, 12/12 graph cases, package `PASS`, clean diff whitespace, and no unintended working-tree changes. If the verifier intentionally regenerates `H001-MOCK-RESULT.json`, compare its semantic result and restore only exact nondeterministic formatting through `apply_patch` before rerunning the affected gate.

- [ ] **Step 3: Exercise the real transactional bootstrap engine with real Git repositories**

Create a temporary directory containing a source checkout, an installed runtime, a working repository, and a bare origin. Build two commits derived from the v0.15.2 candidate tree, point bare `stable` first at commit A and then at commit B, and call `runGitUpdate` with the real subprocess runner and default candidate validator for:

1. empty install → `UPDATED` at A;
2. unchanged stable → `CURRENT` at A;
3. stable advanced with an injected activation failure → `FAILED_SAFE` with A preserved;
4. retry after removing the injection → `UPDATED` at B.

Before the first update, create byte-recorded sentinels for `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, `data`, Guide Packet candidate state, owner decisions, and production manifest. Give candidate validation a decoy ambient state and poison GitHub command. After every transition, require all private sentinels byte-identical, no poison command call, and exact installed commit markers.

- [ ] **Step 4: Verify no real browser or test process leakage**

```bash
ps -eo pid,ppid,pgid,stat,etime,cmd | rg '/tmp/inner-signal-liveness-|run-autopilot\.sh|src/cli/serve\.mjs|src/cli/sync-progress\.mjs' || true
```

Expected: only the inspection command itself; no desktop opener invocation record outside test-local stubs.

---

### Task 4A: Source-grounded therapy-prompt lesson log

**Files:**
- Create: `THERAPY-LESSONS`
- Create: `scripts/verify-therapy-lessons.mjs`
- Create: `tests/therapy-lessons.test.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-package.sh`

**Interfaces:**
- Consumes: the current therapy-prompt contracts and the latest bundled Guide Packet manifest, behavioral diff, and substantive owner-decision cards.
- Produces: a readable timestamped prompt-handling lesson log whose candidate claims are structurally synchronized with the owner gate.

- [ ] **Step 1: Add a failing artifact-level contract test**

Run the lesson validator as a real CLI and require exit zero. Before the validator and log exist, record the expected RED failure. The break caught is a missing, duplicated, malformed, or falsely activated lesson for a substantive candidate decision.

- [ ] **Step 2: Create the log and validator**

Create root file `THERAPY-LESSONS`. Include timestamped active lessons grounded in current prompt/routing contracts and one readable `candidate-awaiting-owner` entry for each substantive r02 decision. Give each entry structured metadata containing its stable lesson or decision ID, timestamp, packet ID, and activation state.

The validator must discover the latest bundled candidate by manifest revision, parse real owner-decision cards and log metadata, and require exactly one pending entry for every substantive human decision. It must reject missing/duplicate entries, invalid timestamps, wrong packet IDs, and any active claim for a pending decision.

- [ ] **Step 3: Run GREEN and wire the release gate**

Add `therapy-lessons:verify` to package scripts and run it from `scripts/verify-package.sh`. Run the focused test and CLI directly, then include them in the final complete package and verifier runs.

- [ ] **Step 4: Commit the lesson contract**

```bash
git add THERAPY-LESSONS scripts/verify-therapy-lessons.mjs tests/therapy-lessons.test.mjs package.json scripts/verify-package.sh
git commit -m "Document verified therapy prompt lessons"
```

---

### Task 5: Independent review, diagnostic report, publication, and installed health

**Files:**
- Create: `IMPLEMENTATION-REPORT-v0.15.2.md`
- Verify: all files changed since `62418292489cf5c764e767f8b010b98b3e14c71c`

**Interfaces:**
- Consumes: Tasks 1–4 commits and fresh gate evidence.
- Produces: reviewed release documentation, one final verified commit, atomically matching remote `main`/`stable`, a real installed v0.15.2 runtime, and sustained health evidence.

- [ ] **Step 1: Request independent code review**

Dispatch the repository code reviewer with base `62418292489cf5c764e767f8b010b98b3e14c71c`, current `HEAD`, the approved design, and this plan. Resolve every Critical or Important finding and rerun the affected focused/full gates.

- [ ] **Step 2: Write the diagnostic implementation report**

Record:

- missing `AGENTS.md` search result and initial ref/worktree state;
- local outbox state, incident receipt, and safe diagnostic status;
- complete preserved stdout/stderr locations and candidate safe summary;
- exact RED `fetch failed` output and 6/8 load-amplified failure count;
- timestamp proof and classification;
- test/browser/process isolation changes;
- direct-suite root isolation;
- focused repetitions, full test count, graph and verifier results;
- transactional bootstrap states and sentinel hashes;
- review base/head and resolved findings;
- local commit/tree, remote preflight refs, published ref/tree equality;
- the exact real-installer and sustained-health verification contract; observed post-publication values are reported in the final operator handoff so no second release commit moves `stable` beyond the installed commit.

- [ ] **Step 3: Commit the final report and reverify the exact release tree**

```bash
git add IMPLEMENTATION-REPORT-v0.15.2.md
git commit -m "Finalize verified v0.15.2 release"
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm test
npm run graph:test
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm run verify
git diff --check 62418292489cf5c764e767f8b010b98b3e14c71c..HEAD
git status --short
```

No publication command may run unless every command is freshly green on this exact `HEAD`.

- [ ] **Step 4: Preflight and atomically publish `main` and `stable` without force**

```bash
remote_main="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
remote_stable="$(git ls-remote origin refs/heads/stable | awk '{print $1}')"
test "$remote_main" = "62418292489cf5c764e767f8b010b98b3e14c71c"
test "$remote_stable" = "62418292489cf5c764e767f8b010b98b3e14c71c"
git push --atomic origin HEAD:refs/heads/main HEAD:refs/heads/stable
```

Abort publication if either expected ref changed. Do not force push.

- [ ] **Step 5: Fetch and verify matching remote commits and trees**

```bash
git fetch origin main stable runtime-diagnostics
release_commit="$(git rev-parse HEAD)"
release_tree="$(git rev-parse HEAD^{tree})"
test "$(git rev-parse origin/main)" = "$release_commit"
test "$(git rev-parse origin/stable)" = "$release_commit"
test "$(git rev-parse origin/main^{tree})" = "$release_tree"
test "$(git rev-parse origin/stable^{tree})" = "$release_tree"
git diff --exit-code HEAD origin/main
git diff --exit-code HEAD origin/stable
```

Inspect the current `runtime-diagnostics` tree and confirm the incident is retained as an auditable real incident unless an explicit documented retention rule requires a normal deletion commit. Never rewrite diagnostic history.

- [ ] **Step 6: Run the real installer exactly once without opening a browser**

Use the published checkout and installed production paths with `INNER_SIGNAL_INSTALL_ONLY=true` so the transactional installer does not open the application itself:

```bash
INNER_SIGNAL_INSTALL_ONLY=true bash packaging/install-from-git.sh
```

Require exit zero, installed package version `0.15.2`, installed commit marker equal to the published release commit, preserved `.env` and private-state hashes, and no second installer invocation.

- [ ] **Step 7: Launch once with desktop openers stubbed and verify sustained health**

Create a temporary command directory containing no-op `xdg-open` and `gio`, prepend it to `PATH`, and start the installed `run-autopilot.sh` in one owned process group. Poll the configured loopback `/health` until HTTP 200, then require:

- `/health` → 200;
- `/v1/dev/status` → 200;
- `/v1/guides/status` → 200;
- `POST /v1/debug/export` → 200, `application/zip`, body over 1000 bytes;
- launcher and server still alive after a five-minute sustained-health window;
- installed version and commit unchanged during that window;
- no real browser tab opened.

Terminate only the owned launcher process group after the sustained-health observation, await exit, and confirm no child server/progress process remains.

---

### Task 5A: Correct a post-publication installed-validation finding

If the one real installer reveals a deterministic fixture-isolation defect after the first non-forced publication, retain its diagnostic receipt and do not rerun the installer. Complete Task 1A, update the architecture/spec/plan/report, repeat every source and transactional release gate, obtain independent review, and fast-forward `main` and `stable` together without force from the exact previously published commit.

Apply the corrected release to the installed runtime through the normal transactional Git updater, which is distinct from the one-shot installer. Then run `./run-autopilot.sh --no-launch --force-validation` with installer-only Git variables absent. Require a final `PASS`, zero diagnostic outbox entries, exact source/installed file identity, preserved private state, and no browser or foreground application launch.
