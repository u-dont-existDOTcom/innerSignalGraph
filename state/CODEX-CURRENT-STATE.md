# Inner Signal Codex current state

Updated: 2026-09-03

## Active development frontier

- DEV-R005 resumes from `tasks/dev-r005-encrypted-local-storage-20260903/CURRENT-STATE.md` and its exact decision ledger at `tasks/dev-r005-encrypted-local-storage-20260903/OWNER-DECISIONS.json`.
- All four currently defined owner decisions are resolved: `DEV-R005-D001` is `USER_HELD_RECOVERY_SECRET`, `DEV-R005-D002` is `OS_BACKED_REAUTH_WITH_USER_LOCK_POLICY`, `DEV-R005-D003` is `OPT_IN_PLUGIN_VAULT_MIGRATION`, and `DEV-R005-D004` is `PRESERVE_UNTIL_EXPLICIT_RESET`.
- `pendingDecisionIds` is empty for D001-D004 only; no additional product-policy decision is inferred.
- `DEV-R005-EXEC-S001-v1` separately authorizes only `VAULT_BOUNDARY_CONTRACT_ONLY` on canonical base `a11700547b48f77e7968b378eb57b8d184bd3ec4`; its durable receipt is `tasks/dev-r005-encrypted-local-storage-20260903/IMPLEMENTATION-AUTHORIZATION.json`.
- `implementationAuthorized` is `true` only for S001. No later slice is authorized, and a green review packet does not authorize merge.
- S001 is a pure, side-effect-free policy seam with no browser wiring, persistence, cryptography, OS integration, migration execution, recovery implementation, deletion, authentication, transport, dependency, or private-data effect.
- PR #36 merged the completed S001 vault boundary contract into `main` as `3dc7e50486eb54c1e946e56fc4b979061123ec50`.
- The Worker → Brave Pro governance protocol is the current active bounded repair; S002 remains unauthorized.
- This protocol repair has no runtime, storage, cryptography, application, plugin, or therapy effect.
- No keys, recovery secrets, credentials, private therapy transcripts, real therapy data, or private-derived hashes belong in repository evidence.
- The publication-transition material below is preserved as historical repository context; it does not override this active task checkpoint.

## Goal

Restore the canonical Worker → Brave Pro review protocol through a Draft PR and exact-head Pro review without changing runtime storage, DEV-R005 S002 authority, or any reserved architecture choice. Maintain the verified public repository baseline without changing therapy/hypnosis policy, model roles, privacy scope, owner decisions, transactional installation, or `stable` release authority.

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
- Public hosted evidence passed TDD, all final repository gates, two independent reviews, and the protected pull-request path through pull request [9](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9).
- The immutable PR 9 merge/check/ref evidence is recorded in the two reports routed below and in [PR 9 comment 5300990615](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9#issuecomment-5300990615), which supplies the self-referential post-merge receipt that tracked source cannot embed.
- All executable Tasks 1-10 completed through their protected paths. No transition task remains to be opened, reviewed, verified, or merged.

## Current checkpoint

- All executable Tasks 1-10 are completed through the protected GitHub path; public visibility and every verified control except installed-App permissions were reconciled in the final readback.
- Visible closeout receipt: pull request 9 is merged; its reviewed candidate tree equals the merged-main tree; every exact-head and merged-main required check succeeded; merged-main CodeQL analysis `1622858177` is associated with the verified baseline and had zero open alerts.
- The immutable Task 9/10 baseline, matching-tree receipt, exact successful check associations, final-main CodeQL analysis, protected refs, and non-effects are in `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` and `docs/CODEX-GITHUB-COMPLIANCE-REPORT-2026-08-14.md`.
- Treat current Git refs and hosted settings as live state: fetch and read them when needed rather than treating a tracked checkpoint SHA as permanently current. The tracked reports remain historical evidence for the verified transition baseline.
- `stable` remains the sole installation/release source and `runtime-diagnostics` remains separate generated data; neither was merged or advanced by the public-transition closeout.

## Remaining

- Issue 4 remains open solely because installed GitHub App permissions are `UNVERIFIED` without GitHub App-authorized authentication.
- All other executable public-transition and repository-compliance work is complete.
- Keep terminal status `BLOCKED` until the installed-App permission readback exists.

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
- Public hosted evidence: pull request [9](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9) and its [durable receipt](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/9#issuecomment-5300990615)
- Universal lesson: pull request 13 / merge `996d67ae9f8f44b0865cea6d88d169dbbadbbf41`
- Hosted hardening issue: [4](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4)

## Next safe action

Obtain GitHub App-authorized authentication, read repository-scoped installed-App permissions, and reconcile issue 4 and terminal status through a protected evidence update. Repeat read-only verification only if hosted evidence drifts. Preserve `stable`, keep `runtime-diagnostics` separate, and do not change therapy, model-role, privacy, or release policy without the applicable owner decision.

## Recovery rule

After interruption, inspect actual Git state, this checkpoint, `.github/codex-repository.json`, newer owner instructions, current PR/check/API state, and the final commits in each worktree. Never infer completion from chat or replay completed changes. Do not copy r03 therapy changes into this branch.
