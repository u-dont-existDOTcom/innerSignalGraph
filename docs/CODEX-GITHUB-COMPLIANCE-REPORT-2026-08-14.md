# Codex + GitHub compliance report — 2026-08-15

Terminal status: `BLOCKED`

Every executable repository-visible and hosted-control task in the public transition is complete or in the final protected evidence pull-request path. The terminal label remains `BLOCKED` because GitHub App installation permissions are `UNVERIFIED`: the available OAuth token receives HTTP 403 from `GET /user/installations`, so repository-scoped installed-App permissions cannot be read back. Green local, CodeQL, and branch-protection evidence cannot substitute for that missing readback.

## Identity and scope

- Repository: `u-dont-existDOTcom/innerSignalGraph`
- Classification: public, active, critical-risk software
- Current Task 9 branch: `codex/public-hosted-evidence-2026-08-14`
- Exact Task 9 base: protected `main=956b17cc008fe68b6d9f5e9c36f002066aa9732a`, tree `3c309fccfd3a66316fb95b66be654ad4b74b7449`
- Canonical checkpoint: `state/CODEX-CURRENT-STATE.md`
- Branch authority preserved: `main` is development; `stable` is the sole installation/release source; `runtime-diagnostics` is generated allowlisted status and never merges into source.
- Non-effects: no therapy/hypnosis/framework policy, guide, graph, prompt, safety/evidence policy, owner decision, privacy scope, model role, installer/runtime, or stable release changed.

## Public transition and pull requests

| Stage | Exact evidence |
|---|---|
| Private readiness | Pull request [6](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/6), head `b1f071ba6093e48ecb2b835cd8c6d54dea11e394`, squash merge `855bdfab0b18327d320e703daf82903de65817e3`. |
| Fail-closed hosted audit repair | Pull request [7](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/7), head `ce2658570964329a3f95f2a919c2c55f8e91dc59`, squash merge `22179212afd26fc2cc3d89ac9cecdfeedfc8b4e0`. |
| Public CodeQL repair | Pull request [8](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/8), head `02bbf6d3f46ff15a1950b3ba4af38d7f69c9e8c9`, squash merge `956b17cc008fe68b6d9f5e9c36f002066aa9732a`. |
| Public hosted evidence | Branch `codex/public-hosted-evidence-2026-08-14`; pull-request URL, final head/tree, check IDs, merge SHA, and final `main` are recorded in the pull request and issue 4 after they exist. A containing commit cannot embed its own immutable identity. |

The existing repository became public. The visibility write was invoked at `2026-08-15T03:51:54.954Z`; the successful write plus independent `visibility=public`, `private=false`, unchanged-identity, and unchanged-ref readback completed at `2026-08-15T03:52:03.707Z`. GitHub's internal mutation instant is `UNVERIFIED` within that observed bound. A later private switch could not retract public clones, forks, caches, or mirrors.

## Task 9 changed files and purpose

| Path | Purpose |
|---|---|
| `.github/codex-repository.json` | Record public/completed state, exact API-backed controls, CodeQL, protection, audit counts, and the App-permission blocker. |
| `tests/repository-compliance.test.mjs` | Causally enforce the public profile, hosted evidence, protected contexts, and issue disposition. |
| `scripts/audit-repository.mjs` | Fail closed on stale private entry claims or missing exact CodeQL/protection evidence. |
| `README.md` | State the public posture without changing branch, release, privacy, model, or therapy authority. |
| `AGENTS.md` | Route future workers through verified public evidence and preserve integrity maintenance. |
| `docs/INDEX.md` | Make the completed transition report and checkpoint the obvious evidence route. |
| `state/CODEX-CURRENT-STATE.md` | Preserve a resumable Task 9/10 checkpoint and exact remaining blocker. |
| `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md` | Replace stale private-plan evidence with this public hosted-control report. |
| `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` | Preserve the full disclosure, audit, CI, protection, lesson, non-effect, and rollback limits. |

## Verified hosted GitHub controls

Read back through GitHub REST API and Actions results. Repository files are not treated as proof.

| Control | Verified result | Evidence / impact |
|---|---|---|
| Visibility | enabled | Existing repository reads `public`, `private=false`, default branch `main`, not archived/disabled. |
| Secret scanning / push protection | enabled | Repository security-and-analysis readback reports both enabled. |
| Private vulnerability reporting | enabled | Endpoint readback reports enabled. |
| Vulnerability and Dependabot alerts | enabled | Endpoints succeed; zero current Dependabot alerts. |
| Dependabot security updates / automated fixes | enabled | Repository readback and endpoint success. |
| Actions | verified least privilege | Enabled; selected GitHub-owned Actions; no verified-creator/custom patterns; default token `read`; PR approval false; reviewed full-SHA enforcement retained. |
| Code scanning | enabled | Exact-main CodeQL succeeded; analyses exist; open alerts zero. |
| `main` protection | enabled | Strict exact contexts, administrators, PR path, linear history, and conversation resolution enforced; approvals zero; force push/deletion disabled. |
| `stable` protection | enabled | Same mechanical protections; release/promotion authority remains separately stricter in `docs/RELEASE-EVIDENCE.md`. |
| Access inventory | verified except App permissions | One collaborator; zero deploy keys, webhooks, and environments. |
| Installed GitHub App permissions | `UNVERIFIED` / `BLOCKED` | `GET /user/installations` returns HTTP 403 requiring a GitHub App-authorized token. |

Both source branches require contexts exactly:

1. `deterministic-package`
2. `workflow-policy`
3. `codeql-javascript`

Both read back `protected=true`, strict status checks, administrators enforced, zero approvals, linear history and conversation resolution enabled, restrictions null, force pushes disabled, and deletions disabled.

## CodeQL evidence

- Required exact-main dispatch: run [31865348513](https://github.com/u-dont-existDOTcom/innerSignalGraph/actions/runs/31865348513), job/check `codeql-javascript` `94965480118`, success on `956b17cc008fe68b6d9f5e9c36f002066aa9732a`.
- Exact-main analyses: `1622692668` and `1622690884`, each with five results.
- Initial public exact-main analysis: `1622620714`, eleven results before repair.
- Final open-alert readback: zero. Alerts 1–6 are fixed; 7–10 are dismissed as test-only with bounded evidence; 11 is dismissed `won't fix` for intentional bounded local static-path persistence. No source suppression was added.

## CI evidence

Pull request 6 exact-head checks:

- `deterministic-package`: run `31860419297`, job `94952726163`, success.
- `workflow-policy`: run `31860419310`, job `94952726069`, success.
- `codeql-javascript`: run `31860419294`, job `94952726518`, skipped exactly because the repository was still private.

Pull request 7 exact-head checks:

- `deterministic-package`: run `31862639727`, job `94958556374`, success.
- `workflow-policy`: run `31862639731`, job `94958556285`, success.
- `codeql-javascript`: run `31862639756`, job `94958557482`, skipped before public visibility.

Pull request 8 exact-head checks:

- `deterministic-package`: run `31865209059`, job `94965049618`, success.
- `workflow-policy`: run `31865209060`, job `94965049573`, success.
- `codeql-javascript`: run `31865209098`, job `94965049683`, success.
- GitHub Advanced Security `CodeQL`: check `94965151294`, success with zero new alert.

Task 9's protected pull-request URL and exact-head check/run IDs are recorded in that pull request and its post-merge comment because they do not exist before the containing evidence branch is published.

## Verification evidence

- Immediate post-public local audit: PASS, 46,785 records, zero findings; 21 refs, 130 commits, 1,312 objects, 666 blobs.
- Immediate post-public hosted audit: PASS, 46,977 records, zero findings; same Git counts plus 7 branches, 1 issue, 6 pull requests, 6 issue comments, 0 review comments, 0 reviews, 38 Actions runs/logs, and 0 artifacts.
- Pull request 8 exact candidate: affected suites PASS 121/121; `npm test` PASS 380/380; real-host `npm run verify` ended in `VERDICT PASS`; workflows and repository audits had zero errors; local publication audit passed 48,296 records with zero findings.
- Task 9 clean baseline: `npm ci --ignore-scripts` PASS; complete `npm test` PASS 380/380.
- Task 9 TDD RED: `node --test --test-name-pattern='public profile|hosted-control evidence' tests/repository-compliance.test.mjs` failed 0/2 on the exact stale private visibility and six stale hosted-control states before implementation.
- Task 9 causal GREEN: focused final-profile/hosted-evidence tests PASS 4/4; full repository-compliance tests PASS 22/22; combined publication/repository/workflow tests PASS 110/110.
- Task 9 precommit candidate: `npm run audit:repository` PASS with zero errors and one warning solely for the installed-App readback; `npm test` PASS 382/382; `npm run graph:test` PASS 12/12; `npm run therapy-lessons:verify` PASS 5/5 with four active-runtime lessons; real-host `npm run verify` ended in `VERDICT PASS`.
- After all hosted refs were refreshed, Task 9 publication audits passed with zero findings: local 49,780 records and hosted 49,999 records. Both covered 26 refs, 138 commits, 1,367 objects, and 686 blobs; hosted coverage added 8 branches, 1 issue, 7 pull requests, 7 issue comments, 1 review comment, 1 review, 49 Actions runs/logs, and zero artifacts.
- The exact containing-commit rerun, independent review, and hosted CI are recorded in the protected pull request before merge; the containing commit and CI, rather than self-referential prose, establish its immutable identity.

## Release, privacy, and policy boundaries

`docs/RELEASE-EVIDENCE.md` remains authoritative for exact-candidate deterministic, live-model entitlement, adversarial, psychological-safety, owner-decision, transactional install, private-byte preservation, rollback, installed-commit, and sustained-health evidence. Deterministic fixtures do not establish live entitlement. This transition does not authorize installing `main` or advancing `stable`.

Diagnostics/progress/recovery exclusions remain unchanged: no browser chat, therapy/hypnosis content, prompt, model output/reasoning, raw sensitive log, credential, environment value, username, hostname, IP address, absolute home path, or hash derived from excluded content may enter durable evidence. No app, browser, server, installer, live model, or release was started by Task 9.

The current therapy-governance state remains unchanged. No therapy-decision receipt or approved suggestion exists, and no publication task can approve policy for Joel.

## Lesson closeout

- `promoted`: the transferable visibility-transition lesson was merged through [universal-dev-architecture pull request 13](https://github.com/u-dont-existDOTcom/universal-dev-architecture/pull/13) as `996d67ae9f8f44b0865cea6d88d169dbbadbbf41`; its CodeQL and deterministic repository-audit checks passed.
- `project-specific`: exact Inner Signal audit counts, visibility times, CodeQL alert dispositions, branch-protection readbacks, PR/check identities, and non-effects remain here.
- `provisional`: installed-App permission enumeration remains authentication-surface dependent and is not generalized as a pass.
- `no-new-lesson`: Task 9 is durable reconciliation of already-reviewed evidence; it creates no therapy lesson, suggestion, decision receipt, or approval projection.

## Remaining action and residual risk

Issue [4](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4) remains open. After Task 9 merge, it must contain only this action: use a GitHub App-authorized token to enumerate accessible installations, select this repository, and record safe repository-scoped installed-App permission names. Until that readback exists, a malicious or overprivileged installed App cannot be ruled out through the available evidence and the exact terminal label remains `BLOCKED`.

No owner decision is required for that executable infrastructure readback. Any therapy/hypnosis/framework, privacy-scope, model-role, owner-card, or stable-release change remains a separate direct owner decision.
