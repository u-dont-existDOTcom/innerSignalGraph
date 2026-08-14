# Codex + GitHub compliance report — 2026-08-14

Terminal status: `BLOCKED`

The repository-visible implementation is in final verification. The terminal status is already `BLOCKED`, rather than compliant, because applicable hosted protection for `main` and `stable` remains unavailable on the current private-repository plan. This label will not be weakened if local and CI gates pass.

## Identity and scope

- Repository: `u-dont-existDOTcom/innerSignalGraph`
- Classification: private, active, critical-risk software
- Task branch: `codex/github-compliance-2026-08-14`
- Base commit: `690244617a1ff08ddc6cbddea461fd9f6f93f8b7` (`origin/main` at task isolation)
- Final verified candidate commit: recorded in the pull request and final handoff after final-head verification; a commit cannot embed its own hash in its contents.
- Canonical checkpoint: `state/CODEX-CURRENT-STATE.md`
- Branch authority preserved: `main` is development; `stable` is the sole install/release source; `runtime-diagnostics` is generated privacy-safe status and must never merge into source.
- Non-goals: no therapy/hypnosis/framework policy, owner decision, privacy scope, model-role assignment, r03 review result, or stable release changed.

## Repository changes and purpose

- `.github/codex-repository.json`, `AGENTS.md`, `README.md`, `docs/INDEX.md`, `docs/CURRENT-STATE.md`, `state/CODEX-CURRENT-STATE.md`: one authority path, exact command map, recovery checkpoint, and hosted evidence.
- `SECURITY.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md`, `.github/RELEASE-EVIDENCE-TEMPLATE.md`, `docs/RELEASE-EVIDENCE.md`: private contribution/security posture and exact stable-promotion evidence.
- `.github/CODEOWNERS`: explicit routing for CI, release/install/update, privacy, therapy/hypnosis, Guide Packet, prompt, ledger, and promotion-sensitive paths.
- `.github/workflows/verify.yml`, `.github/workflows/repository-workflow-policy.yml`: read-only permissions, full-SHA Actions, exact Node setup, scoped concurrency/timeouts, unique `deterministic-package` and `workflow-policy` checks, PR plus `main`/`stable` triggers, and weekly/manual drift audit without live-model credentials.
- `package.json`, `package-lock.json`, `.nvmrc`, `packaging/install-from-git.sh`, `scripts/auto-cli.sh`: exact Node 24.18.0/npm 11.16.0 bootstrap and runtime preflight.
- `scripts/audit-workflows.mjs`, `scripts/audit-repository.mjs`, `scripts/verify-clean.sh`: structural workflow policy, machine-readable repository audit, and generated-output-clean package verification.
- `tests/workflow-policy.test.mjs`, `tests/runtime-baseline.test.mjs`, `tests/verify-clean.test.mjs`, `tests/repository-compliance.test.mjs`, `tests/git-launcher.test.mjs`: deterministic causal coverage for those controls.
- `docs/superpowers/specs/2026-08-14-codex-github-compliance-design.md`, `docs/superpowers/plans/2026-08-14-codex-github-compliance.md`: accepted design and execution plan.

## Hosted GitHub controls

Read back at `2026-08-14T07:28:21Z` through the GitHub REST API. Repository files are not treated as proof of these states.

| Control | Verified result | Evidence / impact |
|---|---|---|
| Actions enabled | enabled | REST readback `enabled=true` |
| Allowed Actions | enabled | `selected`; GitHub-owned allowed; verified creators false; custom patterns empty |
| Full-SHA Action enforcement | enabled | `sha_pinning_required=true` |
| Workflow token | verified least privilege | `default_workflow_permissions=read`; PR approval false |
| Vulnerability/Dependabot alerts | enabled | vulnerability endpoint returns 204; Dependabot alert API accessible with zero current alerts |
| Automated security fixes | enabled | endpoint returns 204 |
| `main` protection | disabled / `BLOCKED` | protection write HTTP 403 plan limitation; branch reads `protected=false` |
| `stable` protection | disabled / `BLOCKED` | protection write HTTP 403 plan limitation; branch reads `protected=false` |
| Repository rulesets | disabled / `BLOCKED` | ruleset API HTTP 403 plan limitation |
| Secret scanning / push protection | disabled / `BLOCKED` | enable attempt HTTP 422: unavailable for this repository |
| Code scanning | disabled / `BLOCKED` | alert API HTTP 403: not enabled; private repository requires a supported Code Security entitlement |
| Private vulnerability reporting | not applicable | GET/PUT HTTP 404; GitHub documents this reporting toggle for public repositories; private `SECURITY.md` route exists |
| Environments | not applicable | zero; this repository releases through local transactional installation, not a GitHub-hosted deployment environment |
| Collaborators | verified | one admin, zero other collaborators |
| Deploy keys / webhooks | verified | zero / zero |
| GitHub App installation permissions | `UNVERIFIED` | available OAuth token cannot use the App-JWT-only repository-installation endpoint |

The one durable follow-up is [Codex + GitHub hardening audit](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4). It contains exact HTTP outcomes, risk, required plan/permission changes, desired rules for both authority branches, unique check names, stable release boundaries, and safe re-verification commands.

Official semantics were rechecked against GitHub’s documentation for [Actions permissions](https://docs.github.com/en/rest/actions/permissions), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets), [repository security settings](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository), and [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting).

## Verification evidence

Focused implementation evidence already obtained:

- workflow-policy causal suite: PASS, 6/6
- exact-runtime/launcher/auto-CLI set: PASS, 10/10
- hermetic package-wrapper suite: PASS, 4/4
- repository-compliance/workflow set before hosted evidence: PASS, 12/12
- `npm ci --ignore-scripts`: PASS
- `npm run audit:workflows`: PASS
- `npm run audit:repository`: PASS with zero errors before hosted readback

Final-candidate evidence will be filled from fresh final-head runs before the PR is opened:

- exact bootstrap: pending
- focused privacy/install/readiness matrix: pending
- complete `npm test`: pending
- `npm run graph:test`: pending
- `npm run therapy-lessons:verify`: pending
- `npm run verify`: pending
- repaired universal audit: pending
- independent read-only review: pending
- final diff, generated-output, secret, ref, and worktree checks: pending

## CI and merge evidence

- Intended checks: `deterministic-package` and `workflow-policy`.
- Pull request URL and final-head run IDs: pending publication.
- Merge result: pending; if final-head checks pass and repository policy permits, squash-merge to `main` only. Do not advance `stable`.
- Existing Dependabot Action-pin PRs 2 and 3 will be closed only after the compliance PR is merged and its newer pins are present on `main`.

## Release, privacy, and transactional boundaries

`docs/RELEASE-EVIDENCE.md` defines deterministic, live-model, adversarial, psychological-safety, owner-decision, exact-commit promotion, transactional install, private-byte preservation, rollback, and sustained-health evidence. Deterministic substitutes do not establish live-model entitlement. No compliance result authorizes policy for Joel or permits installing an unverified `main` commit.

Diagnostics/progress/recovery output remains allowlist-built and excludes browser chat, therapy/hypnosis content, prompts, model output/reasoning, raw logs, credentials, environment values, usernames, hostnames, IPs, absolute home paths, and hashes derived from excluded content. No browser, application server, or installer was started during hosted-control work.

## Owner decisions and residual risk

No owner decision is required for the remaining executable infrastructure work. No stable release was requested or authorized. Any future therapy/hypnosis/framework policy, owner card, privacy-scope, model-role, or stable-release decision remains owner-only.

Residual risk is material: direct or destructive pushes to `main`/`stable` are not mechanically blocked; secret/code scanning is absent; and installed App permissions are unverified. Issue 4 is the exact recovery point. Until the hosted limitations are removed and read back, the repository remains `BLOCKED` under the mandated terminal vocabulary.

## Lesson closeout

- `promoted`: universal lessons for structural workflow auditing, hermetic generated-output verification, transactional updates, condition-based readiness, privacy-safe diagnostics, and stage-specific recovery.
- Universal evidence: [universal-dev-architecture PR 6](https://github.com/u-dont-existDOTcom/universal-dev-architecture/pull/6), merged as `81265fd3592ee842bfe30c7d73a5c1f3dc01b2d0`; hosted checks `repo-policy` and `test` passed.
- `project-specific`: therapy/hypnosis prompt content, r03 findings, owner cards, Guide Packet state, and model-role assignments remain only in Inner Signal’s governed stores.
- `provisional`: automated hosted-control mutation remains permission/plan-sensitive; this task records readback and rollback scope rather than promoting it as a universal autonomous default.
- `no-new-lesson`: Node pinning, CODEOWNERS, evidence templates, and plan-limited status recording instantiate existing universal guidance.

## Recovery

Repository changes are reversible through the focused task commits/PR. Hosted Actions and vulnerability settings can be restored through the same documented APIs using the recorded before-state (`allowed_actions=all`, SHA pinning false, vulnerability alerts disabled); no rollback is currently indicated because final workflows use only reviewed GitHub-owned full-SHA Actions. Resume from `state/CODEX-CURRENT-STATE.md`, issue 4, the final PR, and current Git/API state—not this report alone.
