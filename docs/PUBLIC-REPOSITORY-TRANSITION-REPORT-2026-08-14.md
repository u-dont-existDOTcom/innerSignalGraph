# Inner Signal public repository transition report — 2026-08-15

Publication state: `completed`; GitHub visibility is `public`.

Terminal status: `BLOCKED`.

This report is the bounded disclosure and hosted-control evidence for the existing `u-dont-existDOTcom/innerSignalGraph` repository. It does not claim that scanners prove the absence of every possible disclosure or that the public transition can retract copies. It does not claim full compliance because repository-scoped installed GitHub App permissions remain `UNVERIFIED`.

## Disclosure identity and recovery

- Private preparation branch: `codex/public-repository-transition-2026-08-14`
- Private readiness pull request: [6](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/6)
- Approved readiness head/tree: `b1f071ba6093e48ecb2b835cd8c6d54dea11e394` / `f2eb2c011b0b35c1dc21ad7a122fd7af2a582be6`
- Private readiness squash merge: `855bdfab0b18327d320e703daf82903de65817e3`, exact approved tree
- Fail-closed hosted-audit repair pull request: [7](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/7)
- Pre-disclosure exact `main`: `22179212afd26fc2cc3d89ac9cecdfeedfc8b4e0`, tree `c42df8d7612b9f094b6a27b1c731170522d69400`
- Public CodeQL repair pull request: [8](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/8)
- Current protected public `main`: `956b17cc008fe68b6d9f5e9c36f002066aa9732a`, tree `3c309fccfd3a66316fb95b66be654ad4b74b7449`
- Public hosted-evidence branch: `codex/public-hosted-evidence-2026-08-14`, based exactly on that protected public `main`
- Canonical recovery checkpoint: `state/CODEX-CURRENT-STATE.md`

The immutable commit/tree containing this report and the future squash-merge identity are recorded by Git, pull request 2, its exact-head checks, and the post-merge PR/issue comment. A commit cannot embed its own identity without changing it.

## Pre-disclosure gates and publication audits

The private readiness candidate passed:

- focused publication/repository/workflow policy tests, 100/100 after independent-review repair;
- real transactional dependency bootstrap, 4/4;
- `npm test`, 363/363 at the readiness candidate;
- graph regressions, 12/12;
- therapy-lesson verification, 5/5 with four active-runtime lessons;
- workflow and repository audits with zero errors;
- real-host `npm run verify` ending in `VERDICT PASS`; and
- local and hosted publication audits with zero findings.

Pull request 6 exact-head CI:

| Check | Run / job | Result |
|---|---|---|
| `deterministic-package` | `31860419297` / `94952726163` | success |
| `workflow-policy` | `31860419310` / `94952726069` | success |
| `codeql-javascript` | `31860419294` / `94952726518` | skipped as required while private |

The fresh detached merged-main preflight exposed a fail-open hosted-result boundary; visibility remained private while the defect received a causal regression, review, and pull request 7. Its exact-head deterministic and workflow checks passed, and CodeQL remained correctly skipped while private. Pull request 7 squash-merged as `22179212afd26fc2cc3d89ac9cecdfeedfc8b4e0` before disclosure.

Immediately before and after the public readback, the complete audits passed:

| Command | Result | Safe counts |
|---|---|---|
| `npm run audit:publication` | PASS | 46,785 records; refs 21; commits 130; objects 1,312; blobs 666; findings 0. |
| `npm run audit:publication:hosted` | PASS | 46,977 records; same Git counts plus branches 7; issues 1; pull requests 6; issue comments 6; review comments 0; reviews 0; Actions runs 38; logs 38; artifacts 0; findings 0. |

The hosted wrapper used official Gitleaks `8.29.1`, Linux x64 asset `gitleaks_8.29.1_linux_x64.tar.gz`, pinned SHA-256 `e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924`. Inputs/reports lived only in private disposable roots; final results retained safe counts and bounded locators, never matches or raw bodies/logs.

Scanner limits remain explicit: automated scanners reduce disclosure risk but cannot prove absence or legal ownership; authenticated hosted enumeration is required for completeness; and external copies are outside repository control.

## Visibility boundary

The existing repository—not a mirror, replacement, rename, or rewritten history—was changed to public.

- Visibility write invoked: `2026-08-15T03:51:54.954Z`
- Successful write plus immediate independent repository/ref readback completed: `2026-08-15T03:52:03.707Z`
- Exact GitHub server mutation timestamp: `UNVERIFIED`, bounded by the two observed timestamps above
- Readback: exact repository identity, `visibility=public`, `private=false`, default branch `main`, not archived or disabled

Returning the repository to private visibility would not retract public clones, forks, caches, mirrors, or indexed history and is not described as rollback of disclosure.

## Public security and Actions readback

Only GitHub API/settings results are called enabled:

- secret scanning: enabled;
- push protection: enabled;
- private vulnerability reporting: enabled;
- vulnerability alerts: enabled;
- Dependabot alerts and security updates: enabled, zero current alerts;
- automated security fixes: enabled;
- Actions: enabled with the selected GitHub-owned set, verified creators false, custom patterns empty, reviewed full-SHA enforcement, read-only default token, and PR approval false;
- access inventory: one collaborator, zero deploy keys, zero webhooks, and zero environments; and
- repository-scoped installed GitHub App permissions: `UNVERIFIED`, because `GET /user/installations` returns HTTP 403 requiring a GitHub App-authorized token.

No credential was requested, retrieved, printed, or stored to bypass that App endpoint.

## CodeQL, alert, and repair evidence

The first exact-public-main CodeQL dispatch `31863411008`, job `94960484793`, succeeded on `22179212afd26fc2cc3d89ac9cecdfeedfc8b4e0` and created analysis `1622620714` with eleven results. Findings were repaired or explicitly dispositioned through ordinary pull request 8; no test, timeout, query, or suppression was weakened.

Pull request 8 exact reviewed head/tree: `02bbf6d3f46ff15a1950b3ba4af38d7f69c9e8c9` / `3c309fccfd3a66316fb95b66be654ad4b74b7449`.

| Check | Run / job | Result |
|---|---|---|
| `deterministic-package` | `31865209059` / `94965049618` | success |
| `workflow-policy` | `31865209060` / `94965049573` | success |
| `codeql-javascript` | `31865209098` / `94965049683` | success |
| GitHub Advanced Security `CodeQL` | check `94965151294` | success, zero new alert |

Pull request 8 squash-merged as `956b17cc008fe68b6d9f5e9c36f002066aa9732a` with the exact reviewed tree. Required merged-main dispatch [31865348513](https://github.com/u-dont-existDOTcom/innerSignalGraph/actions/runs/31865348513), job/check `94965480118`, succeeded on that exact SHA. Analyses `1622692668` and `1622690884` each contain five results. Open alert readback is zero: alerts 1–6 are fixed, 7–10 are dismissed as test-only with bounded evidence, and 11 is dismissed `won't fix` for intentional bounded local static-path persistence.

## Protected branch readback

`main` and `stable` both read `protected=true`. Both have:

- strict required status contexts exactly `deterministic-package`, `workflow-policy`, and `codeql-javascript`;
- administrators enforced;
- a pull-request review object with zero required approvals, no stale/code-owner/last-push approval requirement;
- linear history and conversation resolution enabled;
- restrictions null; and
- force pushes and deletions disabled.

The task did not perform a destructive force-push or deletion test. `stable` did not advance and its stricter release authority remains defined by `docs/RELEASE-EVIDENCE.md`, not branch protection alone.

At Task 9 recovery:

- `main=956b17cc008fe68b6d9f5e9c36f002066aa9732a`;
- `stable=110ee5342e27d8f1bd3d11cc2be4d85926c255b1`; and
- `runtime-diagnostics=ec11097253ad2fe1596c2e3fe8ca40b78470f64f`, separate and unmerged.

At the final precommit ref refresh, `main` and `stable` were unchanged. Generated `runtime-diagnostics` had independently advanced to `31d0a6140ae18a00884f987326caeb9064d65607`; the task fetched and audited that ref but did not merge it into source.

## Public hosted-evidence pull request

Task 9 changes exactly these ten paths. The tenth path, `.github/dependabot.yml`, is the bounded executable repair required by independent review after the initial nine-file candidate exposed missing production npm update coverage:

| Path | Purpose |
|---|---|
| `.github/codex-repository.json` | Public/completed profile and exact hosted evidence. |
| `.github/dependabot.yml` | Exact bounded monthly root schedules for npm and GitHub Actions dependencies. |
| `tests/repository-compliance.test.mjs` | Public-profile, protection, CodeQL, and blocker regressions. |
| `scripts/audit-repository.mjs` | Fail-closed final-state policy enforcement and reviewed entry-document digests. |
| `README.md` | Public authority route and unchanged runtime/release boundaries. |
| `AGENTS.md` | Public workflow route and integrity-maintenance contract. |
| `docs/INDEX.md` | Completed-transition evidence route. |
| `state/CODEX-CURRENT-STATE.md` | Resumable Task 9/10 state. |
| `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md` | Current compliance evidence and terminal label. |
| `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` | This disclosure/hosted-control report. |

The exact pull request URL, final head/tree, final-head `deterministic-package`, `workflow-policy`, and `codeql-javascript` run IDs, merge SHA, final `main`, and issue 4 result are recorded in the pull request body/top-level comment and issue after they exist. The protected pull request may merge only when all three exact contexts are green and conversations are resolved.

Task 9 baseline and TDD evidence:

- `npm ci --ignore-scripts`: PASS.
- Complete unmodified-base `npm test`: PASS 380/380.
- Initial final-profile command: expected RED, 0/2; exact failures were stale `private` visibility and six stale hosted control values.
- Expanded causal RED: 1/4 passed and 3/4 failed for stale private entry documents, stale compliance report/universal lesson evidence, and missing machine enforcement of CodeQL/protection evidence.
- Independent-review dependency-policy RED: the focused tests failed 0/2 because the existing Dependabot file covered only GitHub Actions and the repository audit did not enforce npm coverage. The same tests pass 2/2 after the exact monthly root npm schedule and mutation-sensitive audit were added.
- Focused final-profile/hosted-evidence GREEN: PASS 4/4. Full repository-compliance suite: PASS 22/22. Combined publication/repository/workflow suite: PASS 110/110.
- `npm run audit:repository`: PASS with zero errors and one warning solely for the installed-App readback. `npm test`: PASS 382/382. `npm run graph:test`: PASS 12/12. `npm run therapy-lessons:verify`: PASS 5/5 with four active-runtime lessons. Real-host `npm run verify`: final `VERDICT PASS`.
- After refreshing all hosted refs, `npm run audit:publication`: PASS, 49,780 records and zero findings; refs 26, commits 138, objects 1,367, blobs 686. `npm run audit:publication:hosted`: PASS, 49,999 records and zero findings; the same Git counts plus branches 8, issues 1, pull requests 7, issue comments 7, review comments 1, reviews 1, Actions runs 49, logs 49, and artifacts 0.
- Exact repaired containing-commit reruns and two independent approvals are recorded in the pull request before publication/merge; no future CI or merge success is inferred here.

## Policy, privacy, release, and runtime non-effects

- No browser, app, server, installer, live model, provider credential, deployment, or release was started by Task 9.
- `stable` was neither written nor advanced. No unverified `main` commit became an installation source.
- `runtime-diagnostics` remained a separate generated-data branch and was never merged into source.
- Diagnostics/recovery evidence continues to exclude browser chat, therapy/hypnosis content, prompts, model output/reasoning, raw sensitive logs, credentials, environment values, usernames, hostnames, IP addresses, absolute home paths, and hashes derived from excluded content.
- No therapy/hypnosis/framework policy, guide, graph behavior, prompt contract, safety/evidence policy, privacy scope, model role, owner card, decision receipt, approval projection, or stable-release decision changed.
- The latest governed therapy state remains unapproved and uninstalled; publication does not supply owner authority.

## Lesson closeout

- `promoted`: the transferable public-visibility lesson was merged through [universal-dev-architecture pull request 13](https://github.com/u-dont-existDOTcom/universal-dev-architecture/pull/13) as `996d67ae9f8f44b0865cea6d88d169dbbadbbf41`. Its deterministic repository-audit and CodeQL checks passed.
- `project-specific`: the exact Inner Signal counts, timestamps, PR/check identities, CodeQL dispositions, protection states, and non-effects remain in this report.
- `provisional`: installed-App permission enumeration remains dependent on a GitHub App-authorized authentication surface and is not promoted as verified.
- `no-new-lesson`: Task 9 reconciles existing transition evidence and creates no therapy lesson, suggestion, decision, or approval projection.

## Issue 4 and remaining action

Issue [4](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4) remains open. After the protected Task 9 merge, its durable disposition is reduced to one action:

> Use a GitHub App-authorized token to enumerate installations accessible to the user, select `u-dont-existDOTcom/innerSignalGraph`, and record only safe repository-scoped installed-App permission names.

Impact: until that readback exists, the available evidence cannot rule out a malicious or overprivileged installed App. No remaining owner policy decision blocks executable infrastructure work, but this applicable `UNVERIFIED` control requires the exact terminal label `BLOCKED`.
