# Git Self-Update and Automatic Diagnostic Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace routine release-ZIP and diagnostic-ZIP transfer with verified `stable`-branch updates and automatic privacy-safe failure records on `runtime-diagnostics`.

**Architecture:** Keep the Git checkout separate from the installed runtime. A transactional updater validates an exact `origin/stable` commit against an empty state root, overlays preserved private state only after validation, then atomically swaps the runtime. Failures are reduced to a newly constructed allowlisted payload, queued locally, and written idempotently through authenticated `gh api` calls to a separate branch.

**Tech Stack:** Node.js 20+ ESM, Node test runner, Bash, local Git CLI, GitHub CLI, GitHub Contents/Git Data APIs.

## Global Constraints

- Repository: `u-dont-existDOTcom/innerSignalGraph`.
- Update branch: `stable`.
- Diagnostic branch: `runtime-diagnostics`; it is never merged into `main` or `stable`.
- Default source checkout: `~/Téléchargements/innerSignalGraph`.
- Default installed runtime: `~/Téléchargements/inner-signal-runtime`.
- Preserve `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, `data`, Guide Packet candidate bytes, owner decisions, and production policy.
- Never upload browser chat, user messages, therapy or hypnosis content, model prompts/output/reasoning, guide prose or packet bodies, credentials, environment values, usernames, hostnames, IP addresses, absolute home paths, or raw test logs.
- Do not change guide prose, therapy graphs, hypnosis contracts, owner decisions, candidate approval, or production r5 policy.
- Every production behavior starts with a failing test and completes with a mutation-sensitive GREEN gate.

---

## File structure

- Create `src/diagnostics/test-failure-summary.mjs`: deterministic Node test-output parser.
- Create `src/diagnostics/remote-diagnostic.mjs`: strict payload construction, machine identity, incident identity, and atomic outbox writes.
- Create `src/diagnostics/github-sync.mjs`: branch creation, idempotent Contents API writes, receipts, and retry status.
- Create `src/cli/sync-diagnostics.mjs`: queue latest safe failure and flush pending incidents.
- Create `src/git/automation-config.mjs`: validated repository/branch/path configuration with `~/Téléchargements` defaults.
- Create `src/git/runtime-update.mjs`: fetch, detached-worktree staging, clean validation, state overlay, atomic swap, and rollback.
- Create `src/cli/git-update.mjs`: installed-runtime update command and machine-readable status.
- Create `packaging/install-from-git.sh`: one-time GitHub authentication/bootstrap and transactional installation.
- Modify `src/cli/autopilot.mjs`: persist a safe test-failure summary in final status.
- Modify `src/export/diagnostic-bundle.mjs`: include the already-safe test summary and Git automation status.
- Modify `run-autopilot.sh`: flush outbox, check `stable`, restart once after update, and sync failures without blocking the local service.
- Modify `src/server/create-server.mjs` and `apps/web/app.js`: expose concise update/diagnostic status.
- Modify `.env.cli.example`, `.env.example`, `README.md`, `START-HERE.md`, `AUTOPILOT.md`, and `package.json`: defaults, Git workflow, and runtime version.
- Create focused tests in `tests/test-failure-summary.test.mjs`, `tests/remote-diagnostic.test.mjs`, `tests/github-diagnostic-sync.test.mjs`, `tests/git-runtime-update.test.mjs`, and `tests/git-launcher.test.mjs`.

---

### Task 1: Safe test-failure summary

**Files:**
- Create: `src/diagnostics/test-failure-summary.mjs`
- Create: `tests/test-failure-summary.test.mjs`
- Modify: `src/cli/autopilot.mjs`

**Interfaces:**
- Consumes: `{ command, exitCode, stdout, stderr, projectRoot }` from the existing package-test subprocess.
- Produces: `summarizeTestFailure(input) -> inner-signal-test-failure-v1` with counts and allowlisted failures only.
- Produces: `runtime/latest-run/test-failure-summary.json` and `final-status.details.testSummary` on package-test failure.

- [ ] **Step 1: Write the observed-failure regression**

Use the exact Zorin failure shape, including private decoys outside allowlisted fields:

```js
const summary = summarizeTestFailure({
  command: "npm test",
  exitCode: 1,
  projectRoot: "/home/joel/Téléchargements/inner-signal-runtime",
  stdout: `
ℹ tests 192
ℹ pass 191
ℹ fail 1
✖ building r02 does not rewrite the preserved r01 candidate contract or bytes
test at tests/guide-packet-r02.test.mjs:97:1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
actual: d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738
expected: 9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263
PRIVATE_CHAT_MARKER sk-secret-do-not-copy
`,
  stderr: "/home/joel/private/therapy.json"
});
assert.deepEqual(summary.counts, { tests: 192, pass: 191, fail: 1 });
assert.equal(summary.failures[0].name, "building r02 does not rewrite the preserved r01 candidate contract or bytes");
assert.deepEqual(summary.failures[0].location, { file: "tests/guide-packet-r02.test.mjs", line: 97, column: 1 });
assert.equal(summary.failures[0].errorCode, "ERR_ASSERTION");
assert.equal(summary.failures[0].actual, "d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738");
assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_CHAT_MARKER|sk-secret|\/home\/joel/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/test-failure-summary.test.mjs`

Expected: FAIL because `src/diagnostics/test-failure-summary.mjs` does not exist.

- [ ] **Step 3: Implement the minimal allowlist parser**

Export:

```js
export function summarizeTestFailure({ command, exitCode, stdout = "", stderr = "", projectRoot }) {
  const text = `${stdout}\n${stderr}`;
  return {
    format: "inner-signal-test-failure-v1",
    command: command === "npm test" ? command : "package tests",
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    counts: parseCounts(text),
    failures: parseFailures(text, projectRoot).slice(0, 20)
  };
}
```

Only accept failure names from `✖`/`not ok` records, project-relative `tests/*.test.mjs:<line>:<column>` locations, uppercase error codes, and scalar actual/expected values matching boolean/null, bounded numbers, semantic versions, 40-character Git SHAs, or 64-character SHA-256 values. Drop all other lines.

- [ ] **Step 4: Verify GREEN and mutation sensitivity**

Run: `node --test tests/test-failure-summary.test.mjs`

Then temporarily allow arbitrary assertion text and confirm the private-marker assertion fails; restore the strict parser and rerun GREEN.

- [ ] **Step 5: Wire the parser into the package-test failure stage**

In `src/cli/autopilot.mjs`, after writing local raw logs:

```js
const testSummary = summarizeTestFailure({
  command: "npm test",
  exitCode: tests.code,
  stdout: tests.stdout,
  stderr: tests.stderr,
  projectRoot
});
await writeJson(path.join(runDir, "test-failure-summary.json"), testSummary);
```

Pass only `{ testExitCode: tests.code, testSummary }` into final status.

- [ ] **Step 6: Run focused and existing autopilot tests**

Run: `node --test tests/test-failure-summary.test.mjs tests/autopilot.test.mjs tests/runtime-service-liveness.test.mjs`

- [ ] **Step 7: Commit Task 1**

```bash
git add src/diagnostics/test-failure-summary.mjs src/cli/autopilot.mjs tests/test-failure-summary.test.mjs
git commit -m "Capture privacy-safe test failures"
```

---

### Task 2: Strict remote diagnostic and durable outbox

**Files:**
- Create: `src/diagnostics/remote-diagnostic.mjs`
- Create: `tests/remote-diagnostic.test.mjs`

**Interfaces:**
- Consumes: safe final-status fields, optional Task 1 test summary, runtime/update hashes, and private state directory.
- Produces: `buildRemoteDiagnosticPayload(input)` with exactly ten top-level keys.
- Produces: `queueRemoteDiagnostic({ stateDir, input, now, randomUUID }) -> { incidentId, path, payload }`.

- [ ] **Step 1: Write strict-schema and decoy tests**

Construct input containing `chat`, `prompt`, `reasoning`, `rawOutput`, `env`, `hostname`, `username`, and tokens alongside safe fields. Assert the output keys are exactly:

```js
[
  "createdAt", "failure", "format", "incidentId", "integrity",
  "machineId", "privacy", "runtime", "tests", "update"
]
```

Assert no decoy marker is present. Assert two calls with different `createdAt` values but identical stable fields have the same `incidentId`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/remote-diagnostic.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement allowlisted construction and stable identity**

Use `crypto.randomUUID()` only to create `.inner-signal-autopilot/machine-id.txt`. Build a new object field-by-field; do not clone or recursively sanitize input. Compute `incidentId` from canonical JSON containing `machineId`, runtime version/commit, update candidate commit, failure stage/class/action code, test summary, and integrity hashes, excluding timestamps.

Write queued payloads atomically through a sibling temporary file and `fs.rename()`:

```js
const outbox = path.join(stateDir, "diagnostic-outbox");
const target = path.join(outbox, `${payload.incidentId}.json`);
await fs.writeFile(`${target}.${process.pid}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
await fs.rename(`${target}.${process.pid}.tmp`, target);
```

- [ ] **Step 4: Verify GREEN and malformed-input rejection**

Run: `node --test tests/remote-diagnostic.test.mjs`

Add assertions that invalid repository-derived fields, arbitrary test objects, invalid hashes, and absolute paths become `null` or are omitted.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/diagnostics/remote-diagnostic.mjs tests/remote-diagnostic.test.mjs
git commit -m "Add strict diagnostic outbox"
```

---

### Task 3: Automatic GitHub diagnostic delivery

**Files:**
- Create: `src/diagnostics/github-sync.mjs`
- Create: `src/cli/sync-diagnostics.mjs`
- Create: `tests/github-diagnostic-sync.test.mjs`
- Create: `tests/fixtures/fake-gh-cli.mjs`
- Modify: `src/export/diagnostic-bundle.mjs`

**Interfaces:**
- Consumes: queued `inner-signal-remote-diagnostic-v1` files and validated repository/branch names.
- Produces: `syncDiagnosticOutbox(options) -> { status, synced, pending, branch, paths }`.
- Produces: `.inner-signal-autopilot/diagnostic-sync-status.json` and per-incident receipts.

- [ ] **Step 1: Write fake-GitHub integration tests**

The fake CLI must emulate these complete response shapes:

```json
{"permissions":{"push":true}}
{"ref":"refs/heads/stable","object":{"sha":"0123456789012345678901234567890123456789"}}
{"ref":"refs/heads/runtime-diagnostics","object":{"sha":"0123456789012345678901234567890123456789"}}
{"content":{"sha":"89abcdef0123456789abcdef0123456789abcdef"},"commit":{"sha":"fedcba9876543210fedcba9876543210fedcba98"}}
```

Cover branch creation, file creation, identical-existing-file success, remote mismatch rejection, failed delivery retaining the outbox, and later retry removing it only after a receipt is written.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/github-diagnostic-sync.test.mjs`

Expected: FAIL because the sync module and CLI do not exist.

- [ ] **Step 3: Implement bounded `gh api` operations**

Use `runSubprocess` with `shell: false`. Validate repository with `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/` and branches with `/^[A-Za-z0-9._/-]+$/`, rejecting `..`, leading `/`, trailing `/`, and `//`.

Call:

```text
gh api repos/<repo>
gh api repos/<repo>/git/ref/heads/<diagnostics-branch>
gh api repos/<repo>/git/ref/heads/<stable-branch>
gh api --method POST repos/<repo>/git/refs -f ref=refs/heads/<diagnostics-branch> -f sha=<stable-sha>
gh api repos/<repo>/contents/<path>?ref=<diagnostics-branch>
gh api --method PUT repos/<repo>/contents/<path> -f message=<bounded-message> -f content=<base64> -f branch=<diagnostics-branch>
```

Never pass an authentication token or environment dump in arguments.

- [ ] **Step 4: Implement CLI queue/flush behavior**

`src/cli/sync-diagnostics.mjs --latest` reads only `.inner-signal-autopilot/latest.json` and the explicitly referenced safe test summary, queues a strict payload, then flushes. `--flush-only` retries pending records. Exit zero when delivery is queued but unavailable so the local app remains usable.

- [ ] **Step 5: Extend the local recovery bundle with safe status only**

Add `runtime/latest-run/test-failure-summary.json`, `runtime/git-update-status.json`, and `runtime/diagnostic-sync-status.json` to the diagnostic bundle allowlist. Do not add outbox bodies or raw logs.

- [ ] **Step 6: Verify focused tests and privacy mutation**

Run: `node --test tests/github-diagnostic-sync.test.mjs tests/remote-diagnostic.test.mjs tests/diagnostic-export.test.mjs`

Temporarily pass arbitrary final-status `details` into the payload and confirm the decoy-marker test fails; restore field-by-field construction and rerun GREEN.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/diagnostics/github-sync.mjs src/cli/sync-diagnostics.mjs src/export/diagnostic-bundle.mjs tests/github-diagnostic-sync.test.mjs tests/fixtures/fake-gh-cli.mjs tests/diagnostic-export.test.mjs
git commit -m "Sync safe failures to diagnostics branch"
```

---

### Task 4: Transactional stable-branch updater

**Files:**
- Create: `src/git/automation-config.mjs`
- Create: `src/git/runtime-update.mjs`
- Create: `src/cli/git-update.mjs`
- Create: `tests/git-runtime-update.test.mjs`

**Interfaces:**
- Produces: `loadGitAutomationConfig({ env, homeDir, installRoot })`.
- Produces: `runGitUpdate({ sourceRoot, installedRoot, stableBranch, stateDir, run, validateCandidate, now })`.
- Returns: `CURRENT`, `UPDATED`, `DEFERRED`, or `FAILED_SAFE` with installed/available commit and optional safe test summary.

- [ ] **Step 1: Write a local bare-remote update integration test**

Create a temporary bare repository, a source checkout with `stable`, and an installed runtime with sentinel files in all preserved paths. Advance `stable`, then assert:

- managed `package.json` and source change to the new commit;
- all preserved sentinel hashes remain identical;
- validation receives empty `AUTOPILOT_STATE_DIR` and `GUIDE_PACKET_ROOT` paths;
- `.git` is absent from the installed runtime;
- `git-install.json` records the exact stable commit;
- a second update is `CURRENT` and changes no preserved bytes.

- [ ] **Step 2: Write rollback and failed-safe tests**

Make validation return a package-test failure summary. Assert the installed tree remains byte-identical, the candidate commit is reported, a safe incident is queued, and the source checkout remains intact. Simulate fetch/network failure and assert the current runtime remains launchable.

- [ ] **Step 3: Run and verify RED**

Run: `node --test tests/git-runtime-update.test.mjs`

Expected: FAIL because the Git update modules do not exist.

- [ ] **Step 4: Implement validated configuration**

Defaults:

```js
{
  repository: "u-dont-existDOTcom/innerSignalGraph",
  stableBranch: "stable",
  diagnosticsBranch: "runtime-diagnostics",
  sourceRoot: path.join(homeDir, "Téléchargements", "innerSignalGraph"),
  installedRoot: installRoot,
  autoUpdate: true,
  autoDiagnostics: true
}
```

Reject malformed repositories/branches and resolve `~` without shell expansion.

- [ ] **Step 5: Implement fetch, detached worktree, and clean validation**

Use explicit Git arguments:

```text
git -C <source> remote get-url origin
git -C <source> fetch --prune origin <stable>
git -C <source> rev-parse refs/remotes/origin/<stable>
git -C <source> worktree add --detach <temporary-candidate> <commit>
```

Copy managed source with an allowlist filter. Run `npm test` and `npm run graph:test` with temporary empty state directories. Parse a failed package test through Task 1.

- [ ] **Step 6: Implement state overlay and atomic swap**

Hash the preserved inventory before copy. Overlay only `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, and `data`. Re-hash and require equality except the newly written `git-install.json`. Rename the old runtime to a timestamped rollback path, rename staging to the installed path, and restore the old path if the second rename fails.

- [ ] **Step 7: Implement the CLI status contract**

`src/cli/git-update.mjs` writes `.inner-signal-autopilot/git-update-status.json`, queues validation failures through Task 2, and exits with code `10` only when a new runtime was installed and the launcher must restart. `CURRENT`, `DEFERRED`, and `FAILED_SAFE` exit zero.

- [ ] **Step 8: Verify GREEN and mutation sensitivity**

Run: `node --test tests/git-runtime-update.test.mjs`

Temporarily validate after private-state overlay and confirm the empty-state assertion fails; restore clean validation and rerun GREEN.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/git/automation-config.mjs src/git/runtime-update.mjs src/cli/git-update.mjs tests/git-runtime-update.test.mjs
git commit -m "Install verified stable commits transactionally"
```

---

### Task 5: Bootstrap, launcher, and visible status

**Files:**
- Create: `packaging/install-from-git.sh`
- Create: `tests/git-launcher.test.mjs`
- Modify: `run-autopilot.sh`
- Modify: `src/server/create-server.mjs`
- Modify: `apps/web/app.js`
- Modify: `tests/server.test.mjs`
- Modify: `tests/web-client.test.mjs`

**Interfaces:**
- Bootstrap installs from an exact `stable` commit and starts the installed runtime.
- Launcher retries queued diagnostics, checks for a stable update, restarts once on exit code 10, and never blocks the local service for remote outages.
- `/v1/dev/status` adds `gitAutomation` with safe update and sync status.

- [ ] **Step 1: Write bootstrap and launcher RED tests**

Use fake `git`, `gh`, and updater executables to prove:

- missing GitHub authentication triggers exactly one `gh auth login --web` in bootstrap;
- bootstrap runs `gh auth setup-git`, verifies the expected repository, and invokes the transactional updater;
- ordinary launch invokes `sync-diagnostics --flush-only` and `git-update` before model validation;
- exit code 10 restarts once with `INNER_SIGNAL_UPDATE_APPLIED=1`;
- fetch or sync failure still starts the current server;
- no launcher output asks for a ZIP or log upload.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/git-launcher.test.mjs tests/runtime-service-liveness.test.mjs`

- [ ] **Step 3: Implement `install-from-git.sh`**

The script verifies Node/npm/Git, installs `gh` through `apt-get` only when absent, runs one official web login if needed, calls `gh auth setup-git`, fetches `stable`, then invokes `src/cli/git-update.mjs --bootstrap`. It never reads or prints authentication storage.

- [ ] **Step 4: Add bounded launcher hooks**

Before server startup:

```bash
node src/cli/sync-diagnostics.mjs --flush-only || true
set +e
node src/cli/git-update.mjs
UPDATE_STATUS=$?
set -e
if [[ $UPDATE_STATUS -eq 10 && "${INNER_SIGNAL_UPDATE_APPLIED:-0}" != "1" ]]; then
  exec env INNER_SIGNAL_UPDATE_APPLIED=1 "$ROOT/run-autopilot.sh" "$@"
fi
```

After nonzero validation, run `sync-diagnostics.mjs --latest` before keeping the recovery service alive.

- [ ] **Step 5: Expose safe status**

Read `git-update-status.json` and `diagnostic-sync-status.json` into `/v1/dev/status.gitAutomation`. Render only status, abbreviated commits, branch, path, pending count, and last sync time in the Overall Development panel.

- [ ] **Step 6: Verify launcher, server, UI, and liveness GREEN**

Run: `node --test tests/git-launcher.test.mjs tests/runtime-service-liveness.test.mjs tests/server.test.mjs tests/web-client.test.mjs`

- [ ] **Step 7: Commit Task 5**

```bash
git add packaging/install-from-git.sh run-autopilot.sh src/server/create-server.mjs apps/web/app.js tests/git-launcher.test.mjs tests/server.test.mjs tests/web-client.test.mjs
git commit -m "Bootstrap and launch from Git"
```

---

### Task 6: Release metadata and exact migration documentation

**Files:**
- Modify: `package.json`
- Modify: `src/core/runtime-version.mjs`
- Modify: `.env.cli.example`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `AUTOPILOT.md`
- Create: `docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.0.md`

**Interfaces:**
- Runtime version becomes `0.15.0`.
- Documentation gives a Git-only one-time bootstrap command and states that subsequent updates/diagnostics are automatic.

- [ ] **Step 1: Update version and configuration examples**

Add the six Git automation variables from the design with automatic update and diagnostic sync enabled in CLI mode.

- [ ] **Step 2: Replace ZIP-first instructions**

Document the one-time sequence:

```bash
cd "$HOME/Téléchargements"
command -v gh >/dev/null 2>&1 || { sudo apt-get update && sudo apt-get install -y gh; }
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
gh auth setup-git
if [[ -d innerSignalGraph/.git ]]; then
  git -C innerSignalGraph fetch --prune origin
else
  gh repo clone u-dont-existDOTcom/innerSignalGraph innerSignalGraph
fi
bash innerSignalGraph/packaging/install-from-git.sh
```

State explicitly that future routine ZIP download/upload is unnecessary.

- [ ] **Step 3: Run metadata consistency checks**

Run:

```bash
node -p "require('./package.json').version"
node -e "import('./src/core/runtime-version.mjs').then(m => console.log(m.RUNTIME_VERSION))"
git diff --check
```

- [ ] **Step 4: Commit Task 6**

```bash
git add package.json src/core/runtime-version.mjs .env.cli.example .env.example README.md START-HERE.md AUTOPILOT.md docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.0.md
git commit -m "Release Git-native Inner Signal v0.15.0"
```

---

### Task 7: Full verification and publication

**Files:**
- Verify every file changed by Tasks 1-6.
- Create: `IMPLEMENTATION-REPORT-v0.15.0.md`
- Publish the exact verified commit to `main` and `stable`.
- Ensure `runtime-diagnostics` exists but receives no synthetic private test payload.

**Interfaces:**
- `main` and `stable` point to the same verified v0.15.0 commit.
- The runtime can write future safe incidents to `runtime-diagnostics`.

- [ ] **Step 1: Run the full source gates**

Run:

```bash
npm test
npm run graph:test
npm run verify
```

Require zero failures and read the complete output.

- [ ] **Step 2: Run the privacy audit**

Generate a synthetic queued incident containing decoy chat, prompt, reasoning, credential, home-path, hostname, and therapy markers in the source input. Flush through the fake GitHub integration and scan the exact uploaded bytes. Require every decoy absent and every allowed test/hash field present.

- [ ] **Step 3: Run clean bootstrap and two-pass update simulations**

Use a local bare remote. First bootstrap an empty install; then perform two stable updates over seeded private state. Hash every seeded preserved file before and after both passes and require byte identity.

- [ ] **Step 4: Verify repository scope and hygiene**

Run:

```bash
git status -sb
git diff main...HEAD --stat
git diff --check main...HEAD
git ls-files | rg '(^|/)(\.env|\.inner-signal-autopilot|\.inner-signal-dev|data|ledgers/.+\.json)$' && exit 1 || true
```

Inspect every changed path; exclude runtime state, credentials, raw diagnostics, and unrelated source changes.

- [ ] **Step 5: Write the implementation report from fresh evidence**

Record root cause, RED/GREEN evidence, privacy contract, exact test counts, graph results, bootstrap/update simulations, preserved-state inventory, and live-model limitation. Every success claim must cite output produced in Steps 1-4.

- [ ] **Step 6: Create the final local commit**

Stage only `IMPLEMENTATION-REPORT-v0.15.0.md` and any intended evidence corrections, then commit with `Finalize verified Git-native release`.

- [ ] **Step 7: Publish exact Git objects**

Create the remote commit on top of current `main`, verify its tree matches local `HEAD^{tree}` path-by-path, fast-forward `main`, then create or fast-forward `stable` to the same commit. Create `runtime-diagnostics` from that commit only if the branch is absent.

- [ ] **Step 8: Read back remote state**

Verify branch heads, commit tree, version files, bootstrap script, diagnostic allowlist module, updater module, and representative test blobs. Compare all remote blob SHAs and modes with local `HEAD`.
