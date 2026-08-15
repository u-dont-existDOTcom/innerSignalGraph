# Inner Signal Codex current state

Updated: 2026-08-15

## Goal

Complete final exact-main verification and handoff for the public repository transition without changing therapy/hypnosis policy, model roles, privacy scope, owner decisions, transactional installation, or `stable` release authority. The repository is public; the only compliance blocker is installed GitHub App permission readback.

## Authority / baseline

- Repository: `u-dont-existDOTcom/innerSignalGraph`
- Development authority: `main`
- Sole installation/release source: `stable`
- Generated privacy-safe status branch: `runtime-diagnostics`; never merge it into source
- Exact repository commands and hosted-control states: `.github/codex-repository.json`
- Runtime automation: `AUTOPILOT.md`
- Documentation/evidence map: `docs/INDEX.md`
- Stable-promotion evidence: `docs/RELEASE-EVIDENCE.md`
- Current owner requirements and verified source/tests outrank checkpoints and historical reports.

## Completed

- Pull request [6](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/6) prepared the private repository and squash-merged as `855bdfab0b18327d320e703daf82903de65817e3` after exact-head deterministic/workflow success and the required private CodeQL skip.
- Pull request [7](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/7) repaired the fail-open hosted-audit boundary and squash-merged as `22179212afd26fc2cc3d89ac9cecdfeedfc8b4e0` before disclosure.
- The existing repository—not a mirror or replacement—became public. The write was invoked at `2026-08-15T03:51:54.954Z`; successful write plus independent public/unchanged-ref readback completed at `2026-08-15T03:52:03.707Z`. GitHub's internal mutation instant remains `UNVERIFIED` within that bound.
- Pull request [8](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/8) repaired the initial public CodeQL findings and squash-merged as `956b17cc008fe68b6d9f5e9c36f002066aa9732a`; the required merged-main CodeQL dispatch succeeded and open-alert readback was zero.
- `main` and `stable` are protected with strict contexts exactly `deterministic-package`, `workflow-policy`, and `codeql-javascript`; administrators, linear history, pull requests, and conversation resolution are enforced; approvals remain zero; force pushes and deletion are disabled.
- Universal publication-transition guidance was promoted through `u-dont-existDOTcom/universal-dev-architecture` pull request 13 and merged as `996d67ae9f8f44b0865cea6d88d169dbbadbbf41` after its deterministic audit and CodeQL checks passed.
- Public hosted evidence passed TDD, full repository gates, two independent reviews, and the protected pull-request path. Pull request [9](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9) used reviewed head `7bf2b1a706aab6a7d9c36070b15590153c652e2a`, tree `4ff2a229a628bf0f9dc1a11abb23a88cd6068e18`, and squash-merged as `0ccb120442292653a11676ad312f18092944b5a1` with that exact tree.
- Pull request 9 exact-head checks succeeded: `deterministic-package` run `31869840311` / job `94976658513`; `workflow-policy` run `31869840270` / job `94976658502`; `codeql-javascript` run `31869840222` / job `94976658119`; GitHub Advanced Security `CodeQL` check `94976762584`.
- The durable Task 9 merge receipt is [PR 9 comment 5300990615](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9#issuecomment-5300990615). It records the self-referential merge/check/ref evidence that the containing commit could not embed.

## Current checkpoint

- Last repository-contained protected baseline before this closeout repair: `main=0ccb120442292653a11676ad312f18092944b5a1`, tree `4ff2a229a628bf0f9dc1a11abb23a88cd6068e18`.
- Task 9 source head: `7bf2b1a706aab6a7d9c36070b15590153c652e2a`; its reviewed tree exactly matches the Task 9 squash-merge tree.
- Source refs at the Task 10 reconciliation readback: `stable=110ee5342e27d8f1bd3d11cc2be4d85926c255b1`; `runtime-diagnostics=0480876c5dffe38f19a00711efd3df89c3cf6419`, separate and unmerged.
- Exact baseline-main CodeQL analysis `1622858177` exists for `0ccb120442292653a11676ad312f18092944b5a1`; open CodeQL, Dependabot, and secret-scanning alert counts read zero.
- The public visibility, security controls, Actions policy, access inventory, exact required contexts, and both source-branch protections matched the tracked evidence at the Task 10 reconciliation readback.
- Exact reports: `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` and `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`.

## Remaining

- Run Task 10's complete exact-main local and hosted verification from a fresh detached worktree after this protected closeout repair is merged.
- If GitHub App-authorized authentication becomes available, enumerate accessible installations, select this repository, and record only safe repository-scoped permission names through a protected evidence update.
- Keep terminal status `BLOCKED` until that installed-App readback exists; all other executable public-transition work is complete.

## Blockers / unresolved

- `GET /user/installations` returns HTTP 403 because the available OAuth token is not authorized to a GitHub App. `GET /installation/repositories` also returns HTTP 403 because the token is not an installation token. Repository-scoped installed GitHub App permissions remain `UNVERIFIED`.
- Exact remaining action: use a GitHub App-authorized token to enumerate installations accessible to the user, select this repository, record only safe repository-scoped permission names, and update the evidence through the protected path.
- Issue 4 [remains OPEN](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4) solely for installed GitHub App permission readback.
- No owner decision is required for that infrastructure readback. No stable release is requested or authorized.

## Evidence / artifacts

- Exact machine profile: `.github/codex-repository.json`
- Accepted design and plan: `docs/superpowers/specs/2026-08-14-public-repository-transition-design.md`, `docs/superpowers/plans/2026-08-14-public-repository-transition.md`
- Transition report: `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md`
- Compliance report: `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`
- Public hosted evidence: pull request [9](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9), exact head `7bf2b1a706aab6a7d9c36070b15590153c652e2a`, tree `4ff2a229a628bf0f9dc1a11abb23a88cd6068e18`, squash merge `0ccb120442292653a11676ad312f18092944b5a1`, and [durable receipt](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9#issuecomment-5300990615)
- Exact-head checks: `31869840311` / `94976658513`, `31869840270` / `94976658502`, `31869840222` / `94976658119`, and Advanced Security check `94976762584`
- Universal lesson: pull request 13 / merge `996d67ae9f8f44b0865cea6d88d169dbbadbbf41`
- Hosted hardening issue: [4](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4)

## Next safe action

Fetch every hosted ref and use a fresh detached worktree at exact `origin/main` for the complete Task 10 verification and hosted readback. Preserve `stable`, keep `runtime-diagnostics` separate, do not start the app/browser/installer, and do not change therapy, model-role, privacy, or release policy.

## Recovery rule

After interruption, inspect actual Git state, this checkpoint, `.github/codex-repository.json`, newer owner instructions, current PR/check/API state, and the final commits in each worktree. Never infer completion from chat or replay completed changes. Do not copy r03 therapy changes into this branch.
