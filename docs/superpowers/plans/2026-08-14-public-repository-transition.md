# Public Repository Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing `u-dont-existDOTcom/innerSignalGraph` repository under MIT and close its applicable Codex/GitHub hardening gaps through a pre-disclosure audit, verified public security controls, and two sequential pull requests to `main`.

**Architecture:** Pull request 1 adds the publication audit, public-ready documents, and visibility-gated CodeQL while the repository remains private. After that exact merged tree and all hosted surfaces pass a redacted audit, change the existing repository to public, enable and read back hosted controls, and protect `main` and `stable`. Pull request 2 records the actual hosted state and proves the protected `main` workflow; `stable` and `runtime-diagnostics` never move.

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, native `node:test`, Git, GitHub CLI/REST API, YAML 2.9.0, Gitleaks 8.29.1, GitHub CodeQL Action 4.37.7.

## Global Constraints

- Work in `.worktrees/public-repository-transition-2026-08-14` on `codex/public-repository-transition-2026-08-14` until pull request 1 is merged.
- Base pull request 1 on `7d139f1ab4972fceabcae45529021eee71bc0c4f`; reconcile against newer `origin/main` before publishing if that ref changes.
- Use a new `codex/public-hosted-evidence-2026-08-14` branch from the merged public `origin/main` for pull request 2.
- The existing repository becomes public; do not create a mirror, replacement repository, rename, or history rewrite.
- License: standard MIT text with `Copyright (c) 2026 u-dont-existDOTcom`.
- Preserve Node `24.18.0`, npm `11.16.0`, `package-lock.json`, and `npm ci --ignore-scripts`.
- `main` remains development authority; `stable` remains the sole installation/release source; `runtime-diagnostics` remains generated allowlisted status and is never merged into source.
- Do not advance `stable`, install from `main`, change the installed runtime, or call a development merge a release.
- Do not change therapy/hypnosis/framework policy, Guide Packet decisions, privacy scope, model-role policy, or owner-card state. Do not create a therapy ledger receipt for this repository-publication decision.
- Never print or persist a suspected secret value, raw Actions log, raw issue/PR body, private transcript, username/hostname/IP, absolute home path, or a hash derived from excluded user content.
- Ordinary CI receives no live-model or provider credentials. No application, server, browser, or login flow is started by this plan.
- Remote Actions use full commit SHAs. CodeQL Action 4.37.7 is pinned to `ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd`.
- The host audit uses official Gitleaks 8.29.1 Linux x64 asset `gitleaks_8.29.1_linux_x64.tar.gz` with SHA-256 `e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924`. Do not use 8.30.1; its default-rule regression is unresolved in official issue 2170.
- The pre-public audit is a hard gate. Any high-confidence secret/private-data/publication-rights finding leaves visibility private and stops the hosted transition.
- Changing back to private cannot retract public clones or forks. Once visibility changes, do not describe privacy reversal as rollback.
- Repository files never prove hosted controls. Record GitHub API/settings readback and exact Actions run IDs/URLs.
- Every functional change follows RED, minimal GREEN, focused repeat, then a coherent commit.

## File and interface map

- `src/compliance/publication-audit.mjs`: pure record scanner, safe finding projection, Git-history enumeration, hosted-record collection, and Gitleaks result normalization.
- `scripts/audit-publication.mjs`: command-line orchestration; local mode is hermetic, `--github` requires authenticated hosted coverage, and `--gitleaks` adds the pinned external scanner.
- `scripts/run-publication-audit-hosted.sh`: downloads/verifies Gitleaks into a temporary tool root and runs the complete hosted audit without retaining raw inputs.
- `.gitleaks.toml`: extends the reviewed Gitleaks defaults without weakening or allowlisting actual credentials.
- `tests/publication-audit.test.mjs`: causal scanner, history/ref, redaction, hosted-coverage, and pinned-tool tests.
- `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`: public MIT, contribution, and private vulnerability-reporting posture.
- `.github/codex-repository.json`: truthful `pre_publication_ready` state in pull request 1 and truthful `public/completed` state in pull request 2.
- `scripts/audit-repository.mjs`, `tests/repository-compliance.test.mjs`: enforce both valid transition states, exact commands, public documents, and hosted evidence.
- `.github/workflows/codeql.yml`, `tests/workflow-policy.test.mjs`: immutable, least-privilege, visibility-gated CodeQL contract.
- `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md`: bounded pre-public and final hosted evidence.
- `state/CODEX-CURRENT-STATE.md`, `README.md`, `AGENTS.md`, `docs/INDEX.md`: resumable authority route and current public-transition state.
- Universal closeout: `u-dont-existDOTcom/universal-dev-architecture/patterns/codex-github-operating-system.md` and `audits/2026-08-14-inner-signal-publication-transition.md`.

---

### Task 1: Build the deterministic publication scanner

**Files:**
- Create: `src/compliance/publication-audit.mjs`
- Create: `scripts/audit-publication.mjs`
- Create: `tests/publication-audit.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `scanPublicationRecords(records) -> PublicationScanResult`.
- Produces: `auditGitPublication({ root, runCommand }) -> Promise<PublicationScanResult>`.
- Produces: `mergePublicationResults(...results) -> PublicationAuditResult`.
- `PublicationRecord` is `{ surface: string, identifier: string, path?: string, text: string }`.
- Findings expose only `{ severity, code, surface, identifier }`; they never include input text or matched substrings.
- The CLI accepts `--root "$PWD"`; hosted execution adds `--github u-dont-existDOTcom/innerSignalGraph --gitleaks "$tool_root/gitleaks"`.

- [ ] **Step 1: Write pure-scanner RED tests**

Add tests that pass a synthetic GitHub token, private-key header, real `.env` filename, safe `.env.example`, redacted documentation, a browser cookie-database filename, and a private therapy-session transcript filename to `scanPublicationRecords`:

```js
test("publication findings never expose matched values", () => {
  const secret = `ghp_${"a".repeat(36)}`;
  const result = scanPublicationRecords([
    { surface: "issue", identifier: "issue:7", path: "body.md", text: `token=${secret}` },
    { surface: "git", identifier: "blob:clean", path: ".env.example", text: "TOKEN=replace-me" }
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(({ code }) => code), ["credential-pattern"]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});
```

Also assert exact rejection codes for `.env`, PEM private keys, browser cookie databases, and explicit private therapy-session transcript markers. Assert that `.env.example`, synthetic test fixtures, the words “secret scanning,” and policy prose do not fail.

- [ ] **Step 2: Run the pure-scanner tests and capture RED**

Run:

```bash
node --test --test-name-pattern='publication findings|publication path policy' tests/publication-audit.test.mjs
```

Expected: FAIL because `src/compliance/publication-audit.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure scanner**

Implement immutable pattern tables and safe projection:

```js
const CONTENT_RULES = [
  ["credential-pattern", /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/],
  ["credential-pattern", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["credential-pattern", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];

export function scanPublicationRecords(records) {
  const findings = [];
  for (const record of records) {
    for (const [code, pattern] of CONTENT_RULES) {
      if (pattern.test(record.text)) findings.push({ severity: "error", code, surface: record.surface, identifier: record.identifier });
    }
    const normalized = (record.path ?? "").replaceAll("\\", "/");
    if (/(^|\/)\.env$/.test(normalized)) findings.push({ severity: "error", code: "secret-file", surface: record.surface, identifier: record.identifier });
    if (/(^|\/)(Cookies|Login Data|id_rsa|\.netrc|\.npmrc)$/.test(normalized)) findings.push({ severity: "error", code: "private-file", surface: record.surface, identifier: record.identifier });
    if (/(^|\/)(private-)?therapy-session-transcript\.(txt|json|md)$/i.test(normalized)) findings.push({ severity: "error", code: "private-session-material", surface: record.surface, identifier: record.identifier });
  }
  findings.sort((a, b) => `${a.surface}:${a.identifier}:${a.code}`.localeCompare(`${b.surface}:${b.identifier}:${b.code}`));
  return { schemaVersion: 1, ok: findings.length === 0, scannedRecords: records.length, findings };
}
```

Do not add a global allowlist. Any repository-specific false positive must be narrowed by a causal safe example, not suppressed by matched value.

- [ ] **Step 4: Run the pure-scanner tests and capture GREEN**

Run the Step 2 command.

Expected: PASS with the credential omitted from stdout/stderr and result JSON.

- [ ] **Step 5: Write Git-history and non-default-ref RED tests**

Create a temporary real Git repository. Commit a synthetic credential on `main`, remove it in a later commit, and add a second synthetic credential only on `diagnostics-test`. Call `auditGitPublication` from `main` and assert both historical commits are found. Assert identifiers contain only commit SHA, repository-relative path, line or rule code—not matched text.

Use:

```js
await git(root, "init", "-b", "main");
await git(root, "config", "user.email", "publication-test@example.invalid");
await git(root, "config", "user.name", "Publication Test");
```

Keep both branches reachable. Add a separate case where only `.env.example` exists and the audit passes.

- [ ] **Step 6: Run history tests and capture RED**

Run:

```bash
node --test --test-name-pattern='historical commit|non-default ref|safe example history' tests/publication-audit.test.mjs
```

Expected: FAIL because `auditGitPublication` is undefined.

- [ ] **Step 7: Implement Git enumeration and the CLI**

Use argument arrays with `execFile`, never shell interpolation. Enumerate refs and objects with:

```js
await runCommand("git", ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"]);
await runCommand("git", ["rev-list", "--objects", "--all"]);
```

Resolve each unique object type with `git cat-file -t`, read only blobs with `git cat-file blob`, and map each blob to bounded identifiers. Reject an unreadable object or a blob larger than the explicit 20 MiB scanner ceiling with `audit-incomplete`; do not silently skip it. Deduplicate blob IDs while preserving every ref/commit count.

The CLI emits one JSON result and exits `0` only when `ok=true`, `1` for findings/incomplete coverage, and `2` for invalid arguments or tool failure.

Add this exact package command:

```json
"audit:publication": "node scripts/audit-publication.mjs"
```

Add `publication: "npm run audit:publication"` to the exact command maps in `.github/codex-repository.json`, `scripts/audit-repository.mjs`, and `tests/repository-compliance.test.mjs` when Task 3 creates the transition profile.

- [ ] **Step 8: Run focused history/CLI tests and repository tests**

Run:

```bash
node --test tests/publication-audit.test.mjs tests/repository-compliance.test.mjs
npm run audit:publication
```

Expected: all tests PASS; the real local audit either passes or returns bounded finding codes without matched content. If the real audit finds anything, stop this task after recording safe identifiers; do not commit a suppression.

- [ ] **Step 9: Commit the deterministic scanner**

```bash
git add src/compliance/publication-audit.mjs scripts/audit-publication.mjs tests/publication-audit.test.mjs package.json
git commit -m "feat: add deterministic publication audit"
```

---

### Task 2: Add pinned Gitleaks and complete hosted-surface collection

**Files:**
- Create: `scripts/run-publication-audit-hosted.sh`
- Create: `.gitleaks.toml`
- Modify: `src/compliance/publication-audit.mjs`
- Modify: `scripts/audit-publication.mjs`
- Modify: `tests/publication-audit.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `collectHostedPublicationRecords({ repository, runCommand, tempRoot }) -> Promise<{ records, counts }>`.
- Produces: `runGitleaks({ binary, root, hostedRoot, runCommand }) -> Promise<PublicationScanResult>`.
- Hosted coverage is complete only when repository metadata, branches, issues/PRs/comments/reviews, every Actions run log, and every artifact are enumerated or explicitly counted as zero.

- [ ] **Step 1: Write hosted-coverage and redaction RED tests**

Inject a fake `runCommand` that returns two branches, one issue, one PR review, two Actions runs, and zero artifacts. Put a synthetic token in one fake log. Assert:

```js
assert.deepEqual(result.counts, {
  branches: 2,
  issues: 1,
  pullRequests: 1,
  issueComments: 1,
  reviewComments: 1,
  reviews: 1,
  actionRuns: 2,
  actionLogs: 2,
  artifacts: 0
});
assert.equal(scanPublicationRecords(result.records).ok, false);
assert.doesNotMatch(JSON.stringify(scanPublicationRecords(result.records)), /ghp_/);
```

Add failures for a missing run log, an artifact that cannot be downloaded/scanned, malformed pagination JSON, and a repository identity other than `u-dont-existDOTcom/innerSignalGraph`.

- [ ] **Step 2: Run hosted tests and capture RED**

```bash
node --test --test-name-pattern='hosted coverage|missing action log|artifact coverage|repository identity' tests/publication-audit.test.mjs
```

Expected: FAIL because hosted collection is undefined.

- [ ] **Step 3: Implement hosted collection into a private temporary root**

Create the temp root with mode `0700`; create raw files with `0600`; delete the complete root in `finally`. Use `gh api --paginate` or `gh run view --log` with argument arrays. Enumerate these endpoints:

```text
repos/{owner}/{repo}
repos/{owner}/{repo}/branches?per_page=100
repos/{owner}/{repo}/issues?state=all&per_page=100
repos/{owner}/{repo}/issues/comments?per_page=100
repos/{owner}/{repo}/pulls?state=all&per_page=100
repos/{owner}/{repo}/pulls/comments?per_page=100
repos/{owner}/{repo}/actions/runs?per_page=100
repos/{owner}/{repo}/actions/artifacts?per_page=100
```

Filter issue responses with a `pull_request` field out of the issue count because PRs are counted through the pulls endpoint. For each parsed PR number, fetch `repos/u-dont-existDOTcom/innerSignalGraph/pulls/${number}/reviews?per_page=100`. For each parsed Actions run ID, call `gh run view "$runId" --repo u-dont-existDOTcom/innerSignalGraph --log`. For each artifact, call `gh run download "$artifactRunId" --repo u-dont-existDOTcom/innerSignalGraph --name "$artifactName" --dir "$artifactDirectory"` and require every expanded regular member to be scanned. Any unavailable page/log/artifact is `audit-incomplete`, not a warning.

Only return record bodies to the scanner in memory/private temp storage. The final JSON includes counts and safe identifiers, never raw bodies or logs.

- [ ] **Step 4: Write pinned-tool RED tests**

Test the shell script as text and through a fake `curl`/`sha256sum`/`tar` tool path. Require these exact constants:

```bash
GITLEAKS_VERSION=8.29.1
GITLEAKS_SHA256=e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924
GITLEAKS_URL=https://github.com/gitleaks/gitleaks/releases/download/v8.29.1/gitleaks_8.29.1_linux_x64.tar.gz
```

Assert a wrong digest prevents execution. Assert the script supports Linux `x86_64` only and exits with a named unsupported-platform error elsewhere.

- [ ] **Step 5: Run pinned-tool tests and capture RED**

```bash
node --test --test-name-pattern='pinned Gitleaks|wrong Gitleaks digest|unsupported scanner platform' tests/publication-audit.test.mjs
```

Expected: FAIL because the host wrapper does not exist.

- [ ] **Step 6: Implement the checksum-pinned wrapper and Gitleaks adapter**

The wrapper must use `mktemp -d`, `umask 077`, and a trap that removes only the exact created temp directory. It downloads with `curl --fail --location --silent --show-error`, verifies the literal digest before extraction, and executes:

```bash
node scripts/audit-publication.mjs --root "$PWD" --github "$repository" --gitleaks "$tool_root/gitleaks"
```

Add the now-valid package command:

```json
"audit:publication:hosted": "bash scripts/run-publication-audit-hosted.sh --github u-dont-existDOTcom/innerSignalGraph"
```

`runGitleaks` runs both:

```js
[binary, "git", root, `--config=${path.join(root, ".gitleaks.toml")}`, "--log-opts=--all", "--redact=100", "--no-banner", "--report-format=json", `--report-path=${gitReportPath}`]
[binary, "dir", hostedRoot, `--config=${path.join(root, ".gitleaks.toml")}`, "--redact=100", "--no-banner", "--report-format=json", `--report-path=${hostedReportPath}`]
```

Treat Gitleaks exit `0` as clear, exit `1` as findings, and every other exit as `audit-incomplete`. Parse only `RuleID`, `Commit`, repository-relative `File`, and `StartLine`. Explicitly discard `Secret`, `Match`, entropy, and raw messages before merging results.

Use `.gitleaks.toml` only to extend defaults:

```toml
[extend]
useDefault = true
```

- [ ] **Step 7: Run the complete focused audit suite**

```bash
node --test tests/publication-audit.test.mjs
npm run audit:publication
```

Expected: PASS with no raw token or log text in output.

- [ ] **Step 8: Commit hosted auditing**

```bash
git add scripts/run-publication-audit-hosted.sh .gitleaks.toml src/compliance/publication-audit.mjs scripts/audit-publication.mjs tests/publication-audit.test.mjs
git commit -m "feat: audit hosted publication surfaces"
```

---

### Task 3: Establish the public-ready legal and repository contract

**Files:**
- Create: `LICENSE`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/INDEX.md`
- Modify: `.github/codex-repository.json`
- Modify: `scripts/audit-repository.mjs`
- Modify: `tests/repository-compliance.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Pull request 1 profile state is `visibility: "private"` plus `publication_transition.status: "pre_publication_ready"`.
- `publication_transition` is `{ target_visibility: "public", license: "MIT", status: "pre_publication_ready" | "completed", design: string, audit_command: "npm run audit:publication:hosted" }`.
- Pull request 2 changes only the state pair to `visibility: "public"` and `status: "completed"` after hosted readback.

- [ ] **Step 1: Write public-contract RED tests**

Replace the old private-posture test with exact transition assertions:

```js
assert.equal(profile.visibility, "private");
assert.deepEqual(profile.publication_transition, {
  target_visibility: "public",
  license: "MIT",
  status: "pre_publication_ready",
  design: "docs/superpowers/specs/2026-08-14-public-repository-transition-design.md",
  audit_command: "npm run audit:publication:hosted"
});
assert.equal(profile.commands.publication, "npm run audit:publication");
```

Require the standard MIT grant/disclaimer, the exact copyright line, a public contribution posture, GitHub private vulnerability reporting, the excluded-data list, and explicit owner boundaries for therapy policy/model roles/stable release.

- [ ] **Step 2: Run contract tests and capture RED**

```bash
node --test --test-name-pattern='publication transition|MIT|public security|public contribution' tests/repository-compliance.test.mjs
```

Expected: FAIL on missing `LICENSE` and transition metadata.

- [ ] **Step 3: Add the exact MIT license and public documents**

Use the standard MIT text beginning:

```text
MIT License

Copyright (c) 2026 u-dont-existDOTcom

Permission is hereby granted, free of charge, to any person obtaining a copy
```

`CONTRIBUTING.md` must say public contributions use focused branches/PRs, MIT applies to accepted contributions, and contribution does not grant authority over owner-gated therapy/framework policy, model roles, privacy scope, or stable release.

`SECURITY.md` must route reports to GitHub private vulnerability reporting once enabled, retain the existing draft-advisory/private-contact fallback, require synthetic/redacted reproduction, and preserve the complete excluded-data list.

`README.md`, `AGENTS.md`, and `docs/INDEX.md` must route to the transition design, audit commands, checkpoint, and report without stating that hosted visibility is public before the API transition.

- [ ] **Step 4: Implement transition-aware repository validation**

Replace the fixed private classification with:

```js
const validTransition =
  (profile.visibility === "private" && profile.publication_transition?.status === "pre_publication_ready") ||
  (profile.visibility === "public" && profile.publication_transition?.status === "completed");
```

Require `target_visibility`, `license`, `design`, and `audit_command` exactly as defined above. Add `publication: "npm run audit:publication"` to every exact command map. Require `LICENSE`, public contribution text, and private-reporting text in both transition states.

- [ ] **Step 5: Run repository compliance and audit**

```bash
node --test tests/repository-compliance.test.mjs
npm run audit:repository
```

Expected: PASS with the profile still truthfully private/pre-publication-ready.

- [ ] **Step 6: Commit the legal and policy contract**

```bash
git add LICENSE CONTRIBUTING.md SECURITY.md README.md AGENTS.md docs/INDEX.md .github/codex-repository.json scripts/audit-repository.mjs tests/repository-compliance.test.mjs package.json
git commit -m "docs: prepare public MIT repository posture"
```

---

### Task 4: Add visibility-gated CodeQL with immutable least privilege

**Files:**
- Create: `.github/workflows/codeql.yml`
- Modify: `tests/workflow-policy.test.mjs`
- Modify: `scripts/audit-repository.mjs`
- Modify: `.github/dependabot.yml` only if its existing GitHub Actions coverage is absent

**Interfaces:**
- Workflow name: `CodeQL`.
- Job/check name: `codeql-javascript`.
- Action pin: `github/codeql-action/{init,analyze}@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd` (`v4.37.7`).
- Private state skips the analysis job through `github.event.repository.private == false`; public state runs it.

- [ ] **Step 1: Write CodeQL policy RED tests**

Require:

```js
assert.match(codeql, /name:\s*codeql-javascript/);
assert.match(codeql, /if:\s*github\.event\.repository\.private == false/);
assert.match(codeql, /security-events:\s*write/);
assert.match(codeql, /github\/codeql-action\/init@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd/);
assert.match(codeql, /github\/codeql-action\/analyze@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd/);
assert.doesNotMatch(codeql, /pull_request_target|write-all|OPENAI|ANTHROPIC|CLAUDE|FABLE/);
```

Also require pull requests, pushes to `[main, stable]`, weekly schedule, manual dispatch, top-level `contents: read`, job timeout, workflow/ref concurrency, and `persist-credentials: false`.

- [ ] **Step 2: Run workflow tests and capture RED**

```bash
node --test --test-name-pattern='CodeQL' tests/workflow-policy.test.mjs
```

Expected: FAIL because `.github/workflows/codeql.yml` is missing.

- [ ] **Step 3: Add the minimal workflow**

Create:

```yaml
name: CodeQL

on:
  pull_request:
  push:
    branches: [main, stable]
  schedule:
    - cron: "23 5 * * 3"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  analyze:
    if: github.event.repository.private == false
    name: codeql-javascript
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      security-events: write
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - name: Initialize CodeQL
        uses: github/codeql-action/init@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd # v4.37.7
        with:
          languages: javascript-typescript
          queries: security-extended
      - name: Analyze
        uses: github/codeql-action/analyze@ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd # v4.37.7
```

Do not add `packages: read` unless a real failed run proves it is required.

- [ ] **Step 4: Run workflow and repository audits**

```bash
node --test tests/workflow-policy.test.mjs tests/repository-compliance.test.mjs
npm run audit:workflows
npm run audit:repository
```

Expected: PASS; CodeQL is present and policy-valid but its job remains skipped while the repository is private.

- [ ] **Step 5: Commit CodeQL**

```bash
git add .github/workflows/codeql.yml tests/workflow-policy.test.mjs scripts/audit-repository.mjs .github/dependabot.yml
git commit -m "ci: add public CodeQL analysis"
```

Omit `.github/dependabot.yml` from `git add` if the existing `github-actions` ecosystem already covers all workflows and the file is unchanged.

---

### Task 5: Produce exact pre-public evidence and merge pull request 1

**Files:**
- Create: `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md`
- Modify: `state/CODEX-CURRENT-STATE.md`
- Modify: `.github/codex-repository.json`
- Modify: `docs/INDEX.md`

**Interfaces:**
- Report records only safe counts, commit/tree IDs, commands, outcomes, run IDs/links, bounded finding codes, and terminal state.
- Profile remains `visibility: "private"`, `status: "pre_publication_ready"` through pull request 1.

- [ ] **Step 1: Refresh all hosted refs before scanning**

Confirm `origin` identifies the exact repository, then run:

```bash
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/pull/*'
git status --short --branch
git log --oneline --decorate -8 --all
```

Expected: all hosted heads/PR refs available; unrelated worktrees and branches unchanged.

- [ ] **Step 2: Run the complete real pre-public audit**

```bash
npm run audit:publication
npm run audit:publication:hosted
```

Expected: both PASS. Record exact commit count, hosted branch count, issue/PR/comment/review counts, Actions run/log count, artifact count, and zero blocking findings. If either fails or any hosted surface is incomplete, stop with visibility private.

- [ ] **Step 3: Run focused policy and transactional bootstrap gates**

```bash
node --test tests/publication-audit.test.mjs tests/repository-compliance.test.mjs tests/workflow-policy.test.mjs
node --test --test-name-pattern='transactional validation installs locked dependencies|dependency bootstrap failures leave the installed runtime byte-identical' tests/git-runtime-update.test.mjs
```

Expected: PASS; the bootstrap regression uses disposable roots and leaves the real installed runtime untouched.

- [ ] **Step 4: Run every final repository gate**

```bash
npm ci --ignore-scripts
npm test
npm run graph:test
npm run therapy-lessons:verify
npm run audit:workflows
npm run audit:repository
npm run verify
bash scripts/report-worktree.sh
git status --short
```

Expected: every command PASS and final status contains no new path. Restore only canonical generated outputs through the existing verifier; do not discard unrelated work.

- [ ] **Step 5: Write the pre-public report and checkpoint**

Record:

- branch, base, candidate commit/tree;
- changed-file list and purpose;
- exact audit counts without raw content;
- Gitleaks version, asset digest, and successful synthetic detector test;
- exact commands and pass counts;
- CI names `deterministic-package`, `workflow-policy`, and skipped-until-public `codeql-javascript`;
- current hosted controls and issue 4;
- owner decisions: existing repo public, MIT, no sensitive/copyright blocker;
- irreversible publication risk;
- `stable`/`runtime-diagnostics` non-change;
- lesson status; and
- next action: publish and merge pull request 1 while private.

- [ ] **Step 6: Commit final pull request 1 evidence and repeat affected gates**

```bash
git add docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md state/CODEX-CURRENT-STATE.md .github/codex-repository.json docs/INDEX.md
git commit -m "docs: record pre-publication evidence"
node --test tests/publication-audit.test.mjs tests/repository-compliance.test.mjs tests/workflow-policy.test.mjs
npm run audit:publication
npm run audit:repository
git diff --check origin/main...HEAD
git status --short
```

Expected: PASS and clean worktree.

- [ ] **Step 7: Push and open one focused pull request to `main`**

Push `codex/public-repository-transition-2026-08-14`, then open a PR titled `Prepare Inner Signal for verified public visibility`. Its body must include exact final commit/tree, commands/results, audit counts, CodeQL private skip/public activation behavior, risk/rollback limit, checkpoint path, lesson status, and the explicit non-effects on therapy policy and `stable`.

- [ ] **Step 8: Verify final-head CI and merge pull request 1**

Require `deterministic-package` and `workflow-policy` green on the exact PR head. Confirm `codeql-javascript` is skipped because the repository is still private. Save the current `origin/main` commit as the rollback point, then squash-merge the PR without deleting `stable` or any unrelated branch.

After merge:

```bash
git fetch --prune origin
git rev-parse origin/main
test "$verified_tree" = "$(git rev-parse origin/main^{tree})"
```

Here `verified_tree` was captured immediately before push with `verified_tree="$(git rev-parse HEAD^{tree})"`. Expected: merged `main` tree matches the verified PR tree exactly; visibility remains private.

---

### Task 6: Change visibility only after exact preflight and enable public security

**Files:**
- Hosted settings only; no repository file changes in this task.
- Temporary safe JSON: `/tmp/inner-signal-public-security.json` with mode `0600`.

**Interfaces:**
- Consumes: exact merged pull request 1 tree and passing hosted publication audit.
- Produces: public visibility plus readback evidence for security scanning, push protection, vulnerability reporting, Actions, dependency security, and access inventory.

- [ ] **Step 1: Create a fresh exact-main preflight worktree**

Fetch `origin/main`, set `preflight_root="$(mktemp -d /tmp/inner-signal-public-preflight.XXXXXX)"`, add a detached worktree there with `git worktree add --detach "$preflight_root" origin/main`, run `npm ci --ignore-scripts`, and rerun:

```bash
npm run audit:publication
npm run audit:publication:hosted
git status --short
```

Expected: PASS and clean. Confirm the reported merged tree matches pull request 1's verified tree. If not, stop private.

- [ ] **Step 2: Read back the irreversible mutation target**

```bash
gh api repos/u-dont-existDOTcom/innerSignalGraph --jq '{full_name,visibility,private,default_branch,archived,disabled}'
gh pr list --repo u-dont-existDOTcom/innerSignalGraph --state open
gh api repos/u-dont-existDOTcom/innerSignalGraph/branches --paginate --jq '.[] | {name,commit:.commit.sha,protected}'
```

Expected: exact repository, `visibility=private`, default branch `main`, not archived/disabled, no unexpected open PR, and the recorded branch heads.

- [ ] **Step 3: Change the existing repository to public and immediately read it back**

```bash
gh api --method PATCH repos/u-dont-existDOTcom/innerSignalGraph -f visibility=public
gh api repos/u-dont-existDOTcom/innerSignalGraph --jq '{full_name,visibility,private,default_branch}'
```

Expected: `visibility=public`, `private=false`, same repository identity and default branch. Do not continue on ambiguous output.

- [ ] **Step 4: Enable secret scanning and push protection**

Create `/tmp/inner-signal-public-security.json` containing exactly:

```json
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
```

Then run:

```bash
gh api --method PATCH repos/u-dont-existDOTcom/innerSignalGraph --input /tmp/inner-signal-public-security.json
gh api repos/u-dont-existDOTcom/innerSignalGraph --jq '{visibility,security_and_analysis}'
```

Expected: both statuses read back `enabled`. Remove only the exact temp file after readback.

- [ ] **Step 5: Enable private vulnerability reporting and dependency security**

```bash
gh api --method PUT repos/u-dont-existDOTcom/innerSignalGraph/private-vulnerability-reporting
gh api --method PUT repos/u-dont-existDOTcom/innerSignalGraph/vulnerability-alerts
gh api --method PUT repos/u-dont-existDOTcom/innerSignalGraph/automated-security-fixes
gh api repos/u-dont-existDOTcom/innerSignalGraph/private-vulnerability-reporting
gh api --silent repos/u-dont-existDOTcom/innerSignalGraph/vulnerability-alerts
gh api --silent repos/u-dont-existDOTcom/innerSignalGraph/automated-security-fixes
gh api repos/u-dont-existDOTcom/innerSignalGraph/dependabot/alerts --jq 'length'
```

Expected: vulnerability reporting `enabled`, both silent endpoints exit 0, and Dependabot alerts are readable.

- [ ] **Step 6: Re-verify Actions restrictions and access inventory**

```bash
gh api repos/u-dont-existDOTcom/innerSignalGraph/actions/permissions
gh api repos/u-dont-existDOTcom/innerSignalGraph/actions/permissions/selected-actions
gh api repos/u-dont-existDOTcom/innerSignalGraph/actions/permissions/workflow
gh api repos/u-dont-existDOTcom/innerSignalGraph/collaborators --jq 'map({login,permissions})'
gh api repos/u-dont-existDOTcom/innerSignalGraph/keys --jq 'length'
gh api repos/u-dont-existDOTcom/innerSignalGraph/hooks --jq 'length'
gh api repos/u-dont-existDOTcom/innerSignalGraph/environments --jq '.total_count'
gh api --paginate user/installations --jq '.installations[] | {id,app_slug,permissions}'
```

Expected: Actions remain enabled/selected/GitHub-owned/full-SHA, workflow token remains read-only and cannot approve PRs, and the known one-admin/zero-key/zero-hook/zero-environment inventory is either confirmed or any change is safely explained. For each returned installation, set `installation_id` to its numeric ID and run `gh api --paginate "user/installations/$installation_id/repositories" --jq '.repositories[] | select(.full_name=="u-dont-existDOTcom/innerSignalGraph") | {full_name,permissions}'`. Record retained repository permissions only when the repository is present. If installed-App permissions remain inaccessible, keep issue 4 open and terminal status `BLOCKED`; do not infer a pass.

---

### Task 7: Run public CodeQL, then protect `main` and `stable`

**Files:**
- Hosted settings only.
- Temporary safe JSON: `/tmp/inner-signal-branch-protection.json` with mode `0600`.

**Interfaces:**
- Produces successful check context `codeql-javascript` on exact public `main`.
- Produces branch protection requiring `deterministic-package`, `workflow-policy`, and `codeql-javascript` with zero required approvals.

- [ ] **Step 1: Dispatch CodeQL on the exact public `main`**

```bash
gh workflow run codeql.yml --repo u-dont-existDOTcom/innerSignalGraph --ref main
gh run list --repo u-dont-existDOTcom/innerSignalGraph --workflow codeql.yml --branch main --event workflow_dispatch --limit 1 --json databaseId,headSha,status,conclusion,url
```

Confirm `headSha` is the merged pull request 1 commit. Set `codeql_run_id` to the returned `databaseId`, then run `gh run watch "$codeql_run_id" --repo u-dont-existDOTcom/innerSignalGraph --exit-status`.

Expected: job/check `codeql-javascript` succeeds. If it fails, inspect its logs directly and repair through a focused PR before adding it as a required context.

Set `main_sha="$(git rev-parse origin/main)"`, read `gh api "repos/u-dont-existDOTcom/innerSignalGraph/commits/$main_sha/check-runs"`, and confirm the successful context is spelled exactly `codeql-javascript` before using it in protection.

- [ ] **Step 2: Read back CodeQL state and alerts**

```bash
gh api 'repos/u-dont-existDOTcom/innerSignalGraph/code-scanning/alerts?state=open&per_page=100'
gh api 'repos/u-dont-existDOTcom/innerSignalGraph/code-scanning/analyses?per_page=10'
```

Expected: analysis for exact `main` SHA exists. Any open alert is dispositioned or repaired before protection/compliance claims.

- [ ] **Step 3: Prepare exact branch-protection payload**

Create `/tmp/inner-signal-branch-protection.json` containing:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["deterministic-package", "workflow-policy", "codeql-javascript"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```

- [ ] **Step 4: Protect `main` and read back every field**

```bash
gh api --method PUT repos/u-dont-existDOTcom/innerSignalGraph/branches/main/protection --input /tmp/inner-signal-branch-protection.json
gh api repos/u-dont-existDOTcom/innerSignalGraph/branches/main/protection
gh api repos/u-dont-existDOTcom/innerSignalGraph/branches/main --jq '{name,protected}'
```

Expected: protected true; strict checks are exactly the three proven contexts; admins enforced; PR review object exists with count 0; conversation resolution and linear history enabled; force pushes/deletion disabled.

- [ ] **Step 5: Protect `stable` with the same mechanics**

```bash
gh api --method PUT repos/u-dont-existDOTcom/innerSignalGraph/branches/stable/protection --input /tmp/inner-signal-branch-protection.json
gh api repos/u-dont-existDOTcom/innerSignalGraph/branches/stable/protection
gh api repos/u-dont-existDOTcom/innerSignalGraph/branches/stable --jq '{name,protected}'
```

Expected: protected true with the same contexts and no impossible review requirement. This does not advance `stable` or weaken the release-evidence contract. Remove only the exact temp payload after both readbacks.

- [ ] **Step 6: Prove force-push/deletion and diagnostics boundaries from readback**

Record scalar readback only. Confirm `runtime-diagnostics` remains a separate branch and is not included in either source branch history. Do not attempt a destructive force-push or deletion as a test.

---

### Task 8: Promote the transferable publication-transition lesson

**Files (universal repository):**
- Modify: `patterns/codex-github-operating-system.md`
- Create: `audits/2026-08-14-inner-signal-publication-transition.md`
- Create: `tests/test_public_visibility_transition_pattern.py`

**Interfaces:**
- Lesson: public visibility is an irreversible disclosure boundary requiring pre-disclosure full-history/hosted-surface audit, a prepared private PR, hosted readback after mutation, and a second protected evidence PR.
- Provenance includes the Inner Signal repository, pull request 1 merge commit/URL, source report path and blob SHA-256, hosted-transition readback timestamp, causal test paths/results, rationale, limitations, and supersession status. Pull request 2 later records the universal lesson result; the universal lesson does not depend on that future commit.

- [ ] **Step 1: Recover the universal repository before editing**

Read its root/nested `AGENTS.md`, `LESSON-INDEX.md`, operating-system pattern, current state, open PRs/issues, recent commits, and exact test commands. Create a separate isolated lesson branch from current universal `origin/main`; preserve unrelated work.

- [ ] **Step 2: Write a causal RED policy test**

Require the operating-system pattern to contain a `Public visibility transitions` section with these concepts:

```text
pre-disclosure audit
all reachable refs and retained hosted surfaces
visibility readback
public copies cannot be retracted
post-transition protected evidence pull request
```

Create a `unittest.TestCase` that reads `patterns/codex-github-operating-system.md` and `audits/2026-08-14-inner-signal-publication-transition.md`, then run:

```bash
python3 -m unittest tests.test_public_visibility_transition_pattern -v
```

Expected: FAIL because the section is missing.

- [ ] **Step 3: Add the bounded universal guidance and evidence record**

The new section must distinguish public transitions from ordinary reversible settings, require secrets/private-data/license audit before mutation, and forbid calling a later private switch rollback of disclosure. The audit record must name:

- `u-dont-existDOTcom/innerSignalGraph`;
- the public-transition report path and current blob SHA-256;
- pull request 1 merge commit/URL and the bounded hosted-transition readback timestamp;
- `tests/publication-audit.test.mjs` and exact pass count;
- Gitleaks version/digest and CodeQL pin;
- limitations: scanners reduce but cannot prove absence, hosted surfaces require authenticated completeness, and public copies remain outside repository control; and
- supersession: extends, does not replace, the current public/high-risk baseline.

- [ ] **Step 4: Run universal focused and full gates**

Run:

```bash
python3 -m unittest tests.test_public_visibility_transition_pattern -v
python3 -m unittest discover -s tests -v
python3 scripts/audit_codex_github.py --root . --fail-on error
git status --short
```

Expected: all PASS and no generated drift.

- [ ] **Step 5: Commit, publish, verify, and merge the universal lesson PR**

Commit coherently, push one focused branch, open one PR, require its final-head checks, and merge with the documented strategy. Record the universal PR URL, merge commit, and checks in the Inner Signal public-evidence branch before pull request 2's final verification and merge.

---

### Task 9: Reconcile public hosted evidence through pull request 2

**Files:**
- Modify: `.github/codex-repository.json`
- Modify: `tests/repository-compliance.test.mjs`
- Modify: `scripts/audit-repository.mjs`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/INDEX.md`
- Modify: `state/CODEX-CURRENT-STATE.md`
- Modify: `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`
- Modify: `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md`

**Interfaces:**
- Final profile state: `visibility: "public"`, `publication_transition.status: "completed"`.
- Hosted control values are exact API states: `enabled`, `verified`, `not_applicable`, or `unverified`; no file-derived claim.

- [ ] **Step 1: Create the protected-evidence branch from exact public `origin/main`**

Use a new isolated worktree/branch `codex/public-hosted-evidence-2026-08-14`. Confirm its base is the pull request 1 squash merge, install with `npm ci --ignore-scripts`, and run the complete `npm test` baseline before edits.

- [ ] **Step 2: Write final-profile RED tests**

Change assertions to:

```js
assert.equal(profile.visibility, "public");
assert.equal(profile.publication_transition.status, "completed");
assert.equal(profile.github_controls.default_branch_rules, "enabled");
assert.equal(profile.github_controls.stable_branch_rules, "enabled");
assert.equal(profile.github_controls.secret_scanning, "enabled");
assert.equal(profile.github_controls.push_protection, "enabled");
assert.equal(profile.github_controls.code_scanning, "enabled");
assert.equal(profile.github_controls.private_vulnerability_reporting, "enabled");
```

Require readback timestamp/source, exact CodeQL run URL/ID/SHA, exact required contexts for both branches, and issue 4 disposition.

- [ ] **Step 3: Run final-profile tests and capture RED**

```bash
node --test --test-name-pattern='public profile|hosted-control evidence' tests/repository-compliance.test.mjs
```

Expected: FAIL because the profile still describes the truthful pre-public state.

- [ ] **Step 4: Update profile, authority documents, checkpoint, and reports**

Set only API-verified controls to enabled/verified. If App permissions remain inaccessible, keep `github_app_permissions: "unverified"`, explain impact and exact remaining action, and retain terminal `BLOCKED`. Otherwise record the verified minimal permissions and allow `COMPLIANT` if every other requirement passes.

Reports must include:

- both PR branches and final commits;
- changed-file purposes;
- exact local commands/results;
- all final CI names, run IDs, URLs, and SHAs;
- public visibility and hosted control readback;
- main/stable protection payload and readback;
- remaining decisions and residual risk;
- checkpoint path;
- lesson disposition/universal PR;
- pull request 1 merge result plus pull request 2 URL and exact candidate tree; the pull request 2 body and issue 4 are updated with its merge SHA immediately after merge because a commit cannot contain its own future merge identity; and
- one exact terminal label.

- [ ] **Step 5: Run final local gates on pull request 2**

```bash
node --test tests/publication-audit.test.mjs tests/repository-compliance.test.mjs tests/workflow-policy.test.mjs
npm run audit:publication
npm run audit:repository
npm test
npm run graph:test
npm run therapy-lessons:verify
npm run verify
bash scripts/report-worktree.sh
git diff --check origin/main...HEAD
git status --short
```

Expected: all PASS and no new worktree drift.

- [ ] **Step 6: Commit, push, and open pull request 2**

```bash
git add .github/codex-repository.json tests/repository-compliance.test.mjs scripts/audit-repository.mjs README.md AGENTS.md docs/INDEX.md state/CODEX-CURRENT-STATE.md docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md
git commit -m "docs: record verified public repository controls"
```

Push and open `Record verified public repository controls` to `main` with the complete required evidence.

- [ ] **Step 7: Prove protected PR execution and merge**

Require exact-head `deterministic-package`, `workflow-policy`, and `codeql-javascript` green. Confirm branch protection blocks merge readiness until those contexts succeed. With all required contexts green and no unresolved review conversation, squash-merge through GitHub. Do not advance `stable`.

- [ ] **Step 8: Read back merged refs and reconcile issue 4**

Fetch and confirm the merged `main` tree equals the verified pull request 2 tree. Read every hosted control again. Comment on issue 4 with exact PRs, commits, run links, and control results.

Close issue 4 only if every applicable finding is verified resolved or qualifies for the mandate's exact unavailable/not-applicable exception. If GitHub App permissions remain unverified, keep the issue open with that single precise action and report `BLOCKED`.

After merge, update the merged pull request 2 body or add a top-level PR comment with its merge commit, final `main` SHA, final check run IDs, and issue 4 result. This is the durable self-referential merge evidence and avoids a third overlapping evidence PR.

---

### Task 10: Final verification and handoff

**Files:**
- Modify only if evidence changed: `state/CODEX-CURRENT-STATE.md`, `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md`, `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`

**Interfaces:**
- Produces the mandatory final evidence and one terminal label.

- [ ] **Step 1: Reconcile all durable state**

Read current GitHub visibility, `origin/main`, `origin/stable`, `origin/runtime-diagnostics`, both PRs, issue 4, all required check runs, security settings, branch protections, and the universal lesson PR. Compare them with the checkpoint and reports; fix stale evidence through the protected PR path.

- [ ] **Step 2: Run final exact-main read-only verification**

From a clean worktree at merged `origin/main`:

```bash
npm ci --ignore-scripts
npm run audit:publication
npm run audit:repository
npm test
npm run graph:test
npm run therapy-lessons:verify
npm run verify
bash scripts/report-worktree.sh
git status --short
```

Expected: all PASS and clean. Do not rely on pre-merge output for the merged commit.

- [ ] **Step 3: Verify hosted controls one final time**

Read back visibility, secret scanning, push protection, vulnerability reporting, dependency security, code-scanning analyses/alerts, Actions permissions, access inventory, and both branch protections. Confirm the required contexts exactly match real green check names.

- [ ] **Step 4: Deliver the required final evidence**

Report:

- public repository URL;
- both task branches, PRs, merge commits, and final `main` SHA;
- unchanged `stable` and separate `runtime-diagnostics` refs;
- changed-file list/purpose;
- every exact command and result;
- final CI names and links/IDs;
- every verified hosted setting and every inaccessible/unsupported setting marked `UNVERIFIED`;
- remaining owner decisions and residual risk;
- `state/CODEX-CURRENT-STATE.md`;
- universal lesson PR/commit and disposition;
- issue 4 result; and
- exactly one of `COMPLIANT`, `COMPLIANT_WITH_DECLARED_EXCEPTIONS`, `BLOCKED`, or `NOT_COMPLIANT`.

Do not say `COMPLIANT` if GitHub App permissions or any other applicable hosted control remains unverified.
