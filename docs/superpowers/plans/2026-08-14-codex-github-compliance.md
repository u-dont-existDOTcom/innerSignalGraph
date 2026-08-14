# Codex + GitHub Compliance Implementation Plan

> **Execution requirement:** Follow this plan sequentially in the isolated `codex/github-compliance-2026-08-14` worktree. Use test-driven development for behavioral changes and the verification-before-completion workflow before every passing or completion claim.

**Goal:** Establish the applicable Codex + GitHub operating baseline for Inner Signal while preserving therapy/hypnosis policy, model-role authority, privacy contracts, transactional installation, and `stable` release authority.

**Architecture:** Consolidate the existing governance layer rather than replacing product or release machinery. Repository scripts provide machine-readable local audits; CI runs those audits and the existing hermetic package gate with least privilege; GitHub API evidence records what hosted controls actually permit. One checkpoint routes future workers, one release-evidence contract defines promotion proof, and one PR targets `main`. The r03 Guide Packet remains on its separate blocked branch.

**Technology:** Node.js 24.18.0, npm 11.16.0, Node test runner, Bash, Git, GitHub Actions, GitHub CLI/API, Python 3.12 for the upstream universal audit.

**Accepted design:** `docs/superpowers/specs/2026-08-14-codex-github-compliance-design.md`

---

## Global constraints

- Work only in `.worktrees/codex-github-compliance-2026-08-14` for Inner Signal.
- Preserve the local `stable` checkout and `.worktrees/guide-packet-r03` byte-for-byte.
- Do not change guides, therapy/hypnosis policy, prompts, model-role policy, owner-decision cards, therapy ledgers, diagnostic privacy scope, or stable-release state.
- Do not run the installer against `main`. `stable` remains its only source.
- Do not provide live model credentials to GitHub Actions.
- Use `apply_patch` for hand-authored changes. Use npm only for the mechanical lockfile generation.
- Commit each green behavioral slice before beginning the next.
- Keep hosted mutations reversible, read back every changed setting, and record the prior and final state without tokens.
- A plan-limited applicable protection remains a blocker; documentation cannot substitute for enforcement.

## Task 1: Replace the self-triggering workflow scanner

**Files:**

- Create: `scripts/audit-workflows.mjs`
- Create: `tests/workflow-policy.test.mjs`
- Modify: `.github/workflows/repository-workflow-policy.yml`
- Modify: `package.json`

### Step 1: Write the causal failing tests

Create disposable workflow fixtures and invoke the proposed audit CLI with `--root <fixture>`.

Cover these exact cases:

```js
test("a pull_request_target token inside a block script is not an event", async () => {
  // A workflow containing the scanner's own token and actions/checkout must pass.
});

test("a real pull_request_target workflow that checks out code is rejected", async () => {
  // A top-level on.pull_request_target plus actions/checkout must fail.
});

test("unpinned remote Actions and write-all permissions are rejected", async () => {
  // Local actions and docker:// remain allowed; remote refs require 40 hex characters.
});
```

Also assert that missing top-level permissions fails and a safe `pull_request_target` metadata-only workflow without checkout is not mislabeled as code execution.

### Step 2: Run RED

Run:

```bash
node --test tests/workflow-policy.test.mjs
```

Expected: FAIL because `scripts/audit-workflows.mjs` does not exist and the current inline scanner accepts no fixture root.

### Step 3: Implement the minimal structural audit

Implement a standard-library-only module that:

- enumerates `.github/workflows/*.yml` and `*.yaml` beneath an explicit safe root;
- detects only physical YAML keys in the top-level `on` mapping, excluding block-scalar content;
- detects top-level permissions and `permissions: write-all`;
- detects physical `uses:` keys and requires remote references to be full 40-character SHAs;
- reports a `pull_request_target` checkout only when the event is structurally declared;
- emits deterministic JSON with `ok`, `checked`, and sorted findings;
- exits nonzero when findings exist.

Replace the inline Python block with:

```yaml
- name: Enforce workflow security baseline
  run: node scripts/audit-workflows.mjs
```

Add:

```json
"audit:workflows": "node scripts/audit-workflows.mjs"
```

### Step 4: Run GREEN and regression coverage

Run:

```bash
node --test tests/workflow-policy.test.mjs
npm run audit:workflows
```

Expected: all fixture tests pass; the real repository emits `ok: true` and exits 0.

### Step 5: Commit

```bash
git add scripts/audit-workflows.mjs tests/workflow-policy.test.mjs .github/workflows/repository-workflow-policy.yml package.json
git commit -m "ci: make workflow policy structurally deterministic"
```

## Task 2: Pin and enforce the supported runtime

**Files:**

- Create: `tests/runtime-baseline.test.mjs`
- Modify: `package.json`
- Create: `package-lock.json` (generated mechanically)
- Modify: `packaging/install-from-git.sh`
- Modify: `scripts/auto-cli.sh`
- Modify: `tests/git-launcher.test.mjs`

### Step 1: Write the runtime-drift regressions

Assert that:

- `.nvmrc`, `package.json#engines.node`, and `package.json#packageManager` describe Node `24.18.0` and npm `11.16.0` exactly;
- both shell preflights derive or declare the same exact supported Node version;
- GitHub Actions resolves Node through `.nvmrc`;
- the bootstrap accepts `24.18.0` and rejects both `20.0.0` and `24.18.1` with the exact supported-version message.

Update the fake `node -p process.versions.node` default in `tests/git-launcher.test.mjs` to `24.18.0` and add the wrong-patch rejection.

### Step 2: Run RED

```bash
node --test tests/runtime-baseline.test.mjs tests/git-launcher.test.mjs
```

Expected: the baseline test and wrong-patch test fail because package and shell checks still allow Node 20+.

### Step 3: Make the runtime contract exact

Set:

```json
"engines": { "node": "24.18.0" },
"packageManager": "npm@11.16.0"
```

Change both shell checks to compare `process.versions.node` with the exact `.nvmrc` value and emit a bounded non-secret error. Preserve the installer’s command-existence checks and its stable-only update path.

Generate the lockfile without lifecycle scripts:

```bash
npm install --package-lock-only --ignore-scripts
```

### Step 4: Run GREEN and bootstrap

```bash
node --test tests/runtime-baseline.test.mjs tests/git-launcher.test.mjs tests/auto-cli.test.mjs
npm ci --ignore-scripts
```

Expected: all tests pass; npm reports no dependency installation error and creates no source drift beyond the committed lockfile.

### Step 5: Commit

```bash
git add package.json package-lock.json packaging/install-from-git.sh scripts/auto-cli.sh tests/runtime-baseline.test.mjs tests/git-launcher.test.mjs
git commit -m "build: pin the supported Node toolchain"
```

## Task 3: Make `npm run verify` prove hermeticity

**Files:**

- Create: `tests/verify-clean.test.mjs`
- Modify: `scripts/verify-clean.sh`

### Step 1: Write causal disposable-repository tests

Create a temporary Git repository containing copied `scripts/verify-clean.sh`, fake `scripts/verify-package.sh`, `H001-MOCK-RESULT.json`, and `guide-graphs/compiled/bundle.json`.

Prove three behaviors:

1. mutations to the two declared generated files are restored byte-for-byte and the wrapper passes;
2. a new unexpected untracked artifact causes a deterministic nonzero result;
3. an unchanged pre-existing dirty file remains unchanged and does not become a false positive.

Also test that a failing package command still restores the generated files and preserves its nonzero result.

### Step 2: Run RED

```bash
node --test tests/verify-clean.test.mjs
```

Expected: unexpected generated drift is not rejected by the current wrapper.

### Step 3: Implement baseline-to-final status comparison

Before the package command, capture `git status --porcelain=v1 -z --untracked-files=all` outside the repository. In the exit trap:

- preserve the package exit status;
- restore the known generated outputs;
- capture final status with the same command;
- compare the NUL-delimited snapshots byte-for-byte;
- report only changed repository paths, never file contents;
- exit nonzero on newly introduced drift, otherwise preserve the package status.

Temporary files must be cleaned on every path. Do not erase unexpected artifacts; leave them available for diagnosis.

### Step 4: Run GREEN

```bash
node --test tests/verify-clean.test.mjs
```

Expected: all hermeticity cases pass.

### Step 5: Commit

```bash
git add scripts/verify-clean.sh tests/verify-clean.test.mjs
git commit -m "test: make package verification hermetic"
```

## Task 4: Add the repository compliance audit and authority map

**Files:**

- Create: `scripts/audit-repository.mjs`
- Create: `tests/repository-compliance.test.mjs`
- Modify: `package.json`
- Modify: `.github/codex-repository.json`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/CURRENT-STATE.md`
- Modify: `state/CODEX-CURRENT-STATE.md`
- Modify: `IMPLEMENTATION-REPORT-v0.15.2.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/RELEASE-EVIDENCE.md`
- Create: `.github/RELEASE-EVIDENCE-TEMPLATE.md`
- Modify: `.github/pull_request_template.md`

### Step 1: Write the governance regression

The test must fail unless:

- the profile classifies the repository exactly and contains nonempty exact commands for `bootstrap`, `test`, `graph`, `package`, `audit`, `verify`, and `current_state`;
- `current_state` is `state/CODEX-CURRENT-STATE.md` and that file contains all universal recovery headings;
- `README.md`, `AGENTS.md`, and `docs/INDEX.md` route to that checkpoint;
- `docs/CURRENT-STATE.md` clearly says it is superseded and does not claim to be current;
- the implementation report’s stale “no AGENTS” statement is labeled as historical evidence;
- security, private contribution/license posture, and release evidence exist;
- the release contract names deterministic gates, live entitlement, adversarial review, therapy safety, owner decisions, stable promotion, transactional installation, preservation, rollback, exact installed commit, and sustained health;
- deterministic evidence is explicitly forbidden from impersonating live entitlement.

### Step 2: Run RED

```bash
node --test tests/repository-compliance.test.mjs
```

Expected: fail on the empty command map, null checkpoint, competing state files, and missing security/release documents.

### Step 3: Implement a machine-readable local audit

`scripts/audit-repository.mjs` must import the workflow audit and validate the same repository-visible invariants as the regression. It emits deterministic JSON and exits nonzero on errors. It must not claim hosted controls from file presence.

Add:

```json
"audit:repository": "node scripts/audit-repository.mjs"
```

Populate the profile only with commands that will be run on the final candidate:

```json
{
  "bootstrap": "npm ci --ignore-scripts",
  "test": "npm test",
  "graph": "npm run graph:test",
  "package": "npm run verify",
  "audit": "npm run audit:repository",
  "verify": "npm run verify",
  "current_state": "bash scripts/report-worktree.sh"
}
```

Record hosted controls as verified, enabled, disabled, unverified, or not applicable only after API evidence. Use a separate evidence object for timestamps, HTTP outcomes, plan limitations, and impact.

### Step 4: Consolidate documentation

Make the beginning of `README.md` a concise start path rather than rewriting release history. Update root routing documents and preserve historical reports. Write:

- `SECURITY.md`: private security-advisory/contact route, no credentials/private therapy data in issues or artifacts;
- `CONTRIBUTING.md`: private, owner-controlled contribution and no-public-license posture;
- `docs/RELEASE-EVIDENCE.md`: authority and mandatory release evidence;
- `.github/RELEASE-EVIDENCE-TEMPLATE.md`: fillable exact-SHA evidence checklist.

Enhance the PR template with acceptance, focused/full commands, risk, rollback, current-state update, residual uncertainty, stable effects, privacy effects, and final diff.

### Step 5: Run GREEN

```bash
node --test tests/repository-compliance.test.mjs tests/workflow-policy.test.mjs tests/runtime-baseline.test.mjs
npm run audit:repository
```

Expected: repository-visible audit `ok: true`; hosted unavailable states remain truthfully noncompliant rather than omitted.

### Step 6: Commit

```bash
git add scripts/audit-repository.mjs tests/repository-compliance.test.mjs package.json .github/codex-repository.json AGENTS.md README.md docs/INDEX.md docs/CURRENT-STATE.md state/CODEX-CURRENT-STATE.md IMPLEMENTATION-REPORT-v0.15.2.md SECURITY.md CONTRIBUTING.md docs/RELEASE-EVIDENCE.md .github/RELEASE-EVIDENCE-TEMPLATE.md .github/pull_request_template.md
git commit -m "docs: consolidate repository authority and release evidence"
```

## Task 5: Harden ownership and CI without widening privilege

**Files:**

- Modify: `.github/CODEOWNERS`
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/repository-workflow-policy.yml`
- Modify: `.github/dependabot.yml` only if the final lockfile introduces an applicable npm dependency surface
- Modify: `tests/repository-compliance.test.mjs`

### Step 1: Extend the RED policy assertions

Require:

- explicit owners for `.github/`, packaging/installers, Git update/promotion, diagnostics/progress/recovery export, Guide Packets, prompts, therapy/hypnosis policy, ledgers, and release evidence;
- both workflows to use top-level `contents: read`, bounded timeouts, stable unique job names, and ref-scoped concurrency;
- both workflows to cover pull requests plus `main` and `stable` where appropriate;
- checkout to set `persist-credentials: false` because no job pushes;
- ordinary workflows to contain no model-provider secrets or live-model commands;
- remote Actions to use the reviewed Dependabot full SHAs.

Run:

```bash
node --test tests/repository-compliance.test.mjs
```

Expected: fail on incomplete ownership, global concurrency, old Action revisions, and incomplete stable workflow-policy coverage.

### Step 2: Apply the least-privilege CI contract

Use these reviewed Action revisions:

- `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`)
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`)

Key concurrency by `${{ github.workflow }}-${{ github.ref }}`. Allow cancellation only for superseded pull-request runs. Keep `main` and `stable` runs non-cancellable. Give every job a stable explicit `name` if needed so the future required check is unique.

Run `npm ci --ignore-scripts`, the repository audit, and `npm run verify`. Keep the final clean-worktree assertion independent from the verifier.

### Step 3: Run GREEN

```bash
node --test tests/repository-compliance.test.mjs tests/workflow-policy.test.mjs
npm run audit:workflows
npm run audit:repository
```

Expected: both audits pass with no workflow permission, pin, trigger, or ownership finding.

### Step 4: Commit

```bash
git add .github/CODEOWNERS .github/workflows/verify.yml .github/workflows/repository-workflow-policy.yml .github/dependabot.yml tests/repository-compliance.test.mjs
git commit -m "ci: harden verification and sensitive ownership"
```

Omit `.github/dependabot.yml` from the commit if no npm ecosystem update is justified.

## Task 6: Repair and promote the universal audit lesson

**Repository:** `u-dont-existDOTcom/universal-dev-architecture`

**Files:** exact paths selected after rereading its root/nested `AGENTS.md` and lesson routing.

- Modify: `scripts/audit_codex_github.py`
- Modify: `tests/test_audit_codex_github.py`
- Modify: `LESSON-INDEX.md` and the routed lesson/evidence file only when the lesson index says a new transferable entry is warranted
- Create: a dated spec/report if required by that repository’s protocol

### Step 1: Isolate the universal change

Create a separate worktree and branch from current universal `origin/main`. Preserve the temporary clone used for recovery as read-only evidence until the new worktree exists.

### Step 2: Reproduce the Python 3.12 import failure

Add a test that imports `scripts.audit_codex_github` and exercises both real and embedded `pull_request_target` examples. Run:

```bash
python3 -m unittest tests.test_audit_codex_github
```

Expected RED: `re.error: global flags not at the start` before the audit can parse arguments.

### Step 3: Apply the minimal regex fix

Move multiline mode to the start of the combined expression or use `re.MULTILINE` as the compile flag. Do not weaken detection. Run the complete universal test/audit commands found in that repository.

### Step 4: Record lesson provenance

Reference Inner Signal repository, this compliance branch commit/path, the false-positive CI run, the Python version, the causal test, limitations, and supersession. Classify existing Inner Signal lessons on hermetic verification, generated-output cleanliness, transactional Git updates, condition-based readiness, privacy-safe diagnostics, and stage-specific recovery as promoted, already-covered, provisional, project-specific, or no-new-lesson.

### Step 5: Publish one universal PR

Push the universal branch, open one focused PR, wait for exact checks, and merge only if its repository policy permits. Otherwise retain one ready-to-merge PR and record the blocker.

## Task 7: Verify and improve hosted GitHub controls

**Hosted state:** `u-dont-existDOTcom/innerSignalGraph`

**Repository files updated afterward:**

- Modify: `.github/codex-repository.json`
- Modify: `state/CODEX-CURRENT-STATE.md`
- Create: `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`

### Step 1: Read current official API semantics

Use current official GitHub documentation for Actions permissions/allowlists/SHA pinning, vulnerability alerts, security analysis, rulesets, branch protection, environments, and App installations. Do not infer support from UI appearance.

### Step 2: Capture a safe before-state

Through `gh api`, record status codes and bounded settings only for:

- repository visibility/default branch/merge methods;
- branch protection and rulesets for `main` and `stable`;
- Actions enabled state, default token permissions, allowed Actions, and SHA-pinning requirement;
- secret scanning, push protection, code scanning, vulnerability and Dependabot alerts, private vulnerability reporting;
- environments;
- collaborators by role count, deploy-key count, webhook count, and repository-scoped App permissions where accessible.

Never print tokens, credentials, webhook configuration secrets, deploy-key bodies, or unrelated account installations.

### Step 3: Apply only supported reversible improvements

Where the API permits, enable dependency/vulnerability alerts, retain read-only workflow defaults, require immutable Action references, and restrict Actions to the reviewed GitHub-owned set. Read each setting back immediately.

Attempt branch rules/protection only through the documented API. Do not fake a repository-level substitute if the plan returns 403.

### Step 4: Create the single hardening issue

If any applicable hosted control is unavailable, create or update exactly one open issue titled:

```text
Codex + GitHub hardening audit
```

Include the exact unavailable controls, API result, risk/impact, required plan/permission change, desired `main` and stricter `stable` rules, unique check names, force-push/deletion settings, and re-verification commands. Do not include credentials or raw private logs.

### Step 5: Persist the verified result

Update the profile, checkpoint, and compliance report with timestamps, states, issue URL, and explicit `UNVERIFIED` entries. Because branch protection is applicable, plan-unavailable protection remains a `BLOCKED` terminal condition unless the API result changes.

### Step 6: Run focused audit and commit

```bash
node --test tests/repository-compliance.test.mjs
npm run audit:repository
git diff --check
```

Then commit:

```bash
git add .github/codex-repository.json state/CODEX-CURRENT-STATE.md docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md
git commit -m "docs: record verified GitHub control state"
```

## Task 8: Run the final local verification matrix

### Step 1: Bootstrap the final candidate

```bash
npm ci --ignore-scripts
```

Expected: exit 0 under Node 24.18.0/npm 11.16.0 with lockfile unchanged.

### Step 2: Run focused governance and hermeticity tests

```bash
node --test tests/workflow-policy.test.mjs tests/runtime-baseline.test.mjs tests/verify-clean.test.mjs tests/repository-compliance.test.mjs
npm run audit:workflows
npm run audit:repository
```

Expected: all pass; both audit JSON documents report `ok: true`.

### Step 3: Run installation, readiness, and privacy contracts

```bash
node --test tests/git-launcher.test.mjs tests/git-runtime-update.test.mjs tests/runtime-service-liveness.test.mjs tests/remote-diagnostic.test.mjs tests/remote-progress.test.mjs tests/diagnostic-export.test.mjs tests/model-resolver.test.mjs tests/guide-packet-lifecycle.test.mjs tests/guide-packet-review.test.mjs tests/therapy-routing.test.mjs tests/hypnosis-compiler.test.mjs
```

Expected: all pass without browser launch, provider credentials, or external model calls.

### Step 4: Run every declared repository gate

```bash
npm test
npm run graph:test
npm run therapy-lessons:verify
npm run verify
bash scripts/report-worktree.sh
```

Expected: every command exits 0; `npm run verify` includes the complete package suite and leaves no new status entries.

### Step 5: Run the repaired universal audit

Use the exact fixed universal worktree path:

```bash
python3 <universal-worktree>/scripts/audit_codex_github.py --root "$PWD" --format json
```

Expected: no errors. Disposition each warning explicitly in the compliance report.

### Step 6: Review final integrity

```bash
git diff --check origin/main...HEAD
git status --short --branch
git diff --name-status origin/main...HEAD
git diff -- H001-MOCK-RESULT.json guide-graphs/compiled/bundle.json
sha256sum -c guide-packets/fixtures/r01-candidate/inner-signal-guide-packet-r01-candidate.zip.sha256
sha256sum -c guide-packets/fixtures/r02-candidate/inner-signal-guide-packet-r02-candidate.zip.sha256
```

Inspect the entire diff for accidental therapy/policy/model/privacy changes, secrets, private material, generated drift, debug output, and unrelated refactors.

### Step 7: Independent read-only review

Run a noninteractive read-only Codex review of `origin/main...HEAD` with browser launch disabled. Ask specifically for Critical/Important breakage in CI privilege, installer/runtime pinning, hermetic cleanup, branch authority, privacy boundaries, model-role boundaries, and recovery behavior. Persist only the safe verdict and finding summary in `/tmp`; do not commit raw model reasoning.

Any accepted behavioral finding returns to RED-GREEN and repeats the applicable full gates.

## Task 9: Final report, pull request, checks, and merge

**Files:**

- Modify: `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`
- Modify: `state/CODEX-CURRENT-STATE.md`

### Step 1: Finalize durable evidence

Record:

- task branch and exact head SHA;
- changed files and purpose;
- exact commands and exact counts/outcomes;
- universal audit/lesson PR or commit;
- hosted settings and API evidence;
- plan-limited/unverified controls and issue URL;
- current-state path;
- no stable promotion and no r03/therapy-policy change;
- residual risk and the literal terminal label.

The report can identify the PR as pending before merge; the final merged identity will be added to durable PR metadata after GitHub creates it.

### Step 2: Re-run the final affected gates and commit

```bash
node --test tests/repository-compliance.test.mjs
npm run audit:repository
npm run verify
git diff --check
```

Commit the report/checkpoint update, then verify the tree is clean.

### Step 3: Push and open one focused PR

Push `codex/github-compliance-2026-08-14` and open one PR to `main` with the required evidence. Do not target `stable` or `runtime-diagnostics`.

### Step 4: Verify final-head checks

Wait for and inspect the exact final-head check runs. Required check names are expected to be:

- `Verify / deterministic-package`
- `Repository workflow policy / workflow-policy`

Use the actual names returned by GitHub, not these expectations, in the final report and PR body. Diagnose any failure from its complete logs and fix it through TDD.

### Step 5: Merge reversibly when green

If all obtainable required checks pass and no repository policy blocks merge, squash-merge the PR to `main` without promoting `stable`. Record the merge commit and URL in the PR body and final response.

If a required executable check is red, leave the single PR open and report `NOT_COMPLIANT`. If permission or policy prevents merge, leave it ready and report `BLOCKED` with the exact reason.

### Step 6: Close superseded dependency PRs

After the compliance PR contains and merges the reviewed full-SHA Action updates, comment on and close the two superseded Dependabot PRs. Reference the merged compliance PR. Do not close either before its change is durably present on `main`.

### Step 7: Final reconciliation

Fetch `origin/main`, verify the merge identity and that `origin/stable` and `origin/runtime-diagnostics` did not move because of this task, and confirm no task worktree contains uncommitted changes.

The final response must use exactly one terminal label: `COMPLIANT`, `COMPLIANT_WITH_DECLARED_EXCEPTIONS`, `BLOCKED`, or `NOT_COMPLIANT`. Under the currently verified private-plan limitation, the expected truthful label is `BLOCKED` even when every executable repository change and check passes.
