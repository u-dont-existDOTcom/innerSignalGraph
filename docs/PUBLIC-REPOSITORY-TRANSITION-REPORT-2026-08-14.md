# Inner Signal pre-public repository transition report — 2026-08-15

Publication state: `pre_publication_ready`; GitHub visibility remains `private`.

This report is the bounded evidence for preparing the existing `u-dont-existDOTcom/innerSignalGraph` repository for a public-visibility change. It does not claim that the repository is public, that CodeQL has run, or that hosted branch protection is enabled. The current compliance terminal state remains `BLOCKED` until the applicable public hosted controls are enabled and read back.

## Candidate identity and recovery

- Task branch: `codex/public-repository-transition-2026-08-14`
- Refreshed base: `origin/main` at `7d139f1ab4972fceabcae45529021eee71bc0c4f`
- Base tree: `1a993b479e446dee6f59490599a2515a80e2d35f`
- Fully gated source candidate before this evidence-only commit: `47e6d33078b9ca8bc3ddf2bed1a09a02b111c375`
- Source candidate tree: `c81a7b0f28e07abb7a77e6f89fcfe9522726824d`
- Relationship: the source candidate is a 15-commit direct descendant of the refreshed base.
- Canonical recovery checkpoint: `state/CODEX-CURRENT-STATE.md`

The immutable identity of the commit containing this report is recorded by Git and must be copied into the pull request after the commit exists. A commit cannot truthfully embed its own commit or recursive-tree hash in its contents because either value would change the commit. The later pull request must identify and verify that final evidence commit/tree exactly.

The exact fetch was:

```text
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' '+refs/pull/*/head:refs/remotes/pull/*'
```

The expected generated `runtime-diagnostics` branch advanced independently during verification, so the fetch and both publication audits were repeated. `origin/main` and `origin/stable` did not move.

## Complete changed-file list and purpose

The final evidence commit adds this report and checkpoint updates to the following source-candidate changes relative to `origin/main`:

| Path | Purpose |
|---|---|
| `.github/codex-repository.json` | Keep the machine profile private/pre-public and record exact current audit/control evidence. |
| `.github/workflows/codeql.yml` | Define public-only CodeQL with least privilege, immutable Action pins, timeout, and concurrency. |
| `.gitleaks.toml` | Provide the bounded Gitleaks audit configuration. |
| `AGENTS.md` | Route workers through the accepted transition, audits, report, and canonical checkpoint. |
| `CONTRIBUTING.md` | Establish MIT public-contribution posture without granting owner policy authority. |
| `LICENSE` | Add the unmodified MIT license selected by the owner. |
| `README.md` | Explain the public-transition state, exact audits, and private-until-readback boundary. |
| `SECURITY.md` | Define public vulnerability reporting with private fallbacks and excluded-data rules. |
| `docs/INDEX.md` | Replace the reserved report route with this exact pre-public evidence route. |
| `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` | Preserve this safe pre-public evidence and recovery record. |
| `docs/superpowers/plans/2026-08-14-public-repository-transition.md` | Preserve the accepted executable transition plan. |
| `docs/superpowers/specs/2026-08-14-public-repository-transition-design.md` | Preserve the accepted risk and architecture design. |
| `package.json` | Expose the exact local and hosted publication-audit commands. |
| `scripts/audit-publication.mjs` | Orchestrate Git, hosted, and Gitleaks audit adapters with bounded JSON output. |
| `scripts/audit-repository.mjs` | Enforce repository/public-posture contracts and reviewed integrity bindings. |
| `scripts/run-publication-audit-hosted.sh` | Download and verify the pinned Gitleaks binary in a private disposable root. |
| `src/compliance/publication-audit.mjs` | Scan every local Git object/ref and all enumerated hosted surfaces without exposing matches. |
| `state/CODEX-CURRENT-STATE.md` | Make this transition resumable without prior chat. |
| `tests/publication-audit.test.mjs` | Causally test scanner coverage, privacy, fail-closed parsing, pinning, and cleanup. |
| `tests/repository-compliance.test.mjs` | Enforce public-transition documents, state pairs, license, and posture integrity. |
| `tests/workflow-policy.test.mjs` | Enforce the private-skip/public-run CodeQL policy and immutable least-privilege workflow. |

There are no release/install/runtime behavior changes in the evidence commit.

## Publication audits

After the final ref refresh, both complete audits exited zero with no findings and no incomplete surface:

| Command | Result | Safe counts |
|---|---|---|
| `npm run audit:publication` | PASS | 43,725 records; refs 14; commits 122; objects 1,265; blobs 650; findings 0. |
| `npm run audit:publication:hosted` | PASS | 43,888 records; the same Git counts plus branches 5; issues 1; pull requests 4; issue comments 6; review comments 0; reviews 0; Actions runs 26; Actions logs 26; artifacts 0; findings 0. |

The hosted wrapper used official Gitleaks `8.29.1`, Linux x64 asset `gitleaks_8.29.1_linux_x64.tar.gz`, pinned SHA-256 `e4eb209d04e20339d77122a3bdf9cd41351255cfb27ebcb75e85325e04f88924`. The 99-case focused suite passed the synthetic pin/download/execution detector, wrong-digest non-execution and cleanup, unsupported-platform fail-closed behavior, safe normalization, historical/non-default-ref detection, hosted locator coverage, report-file invariants, and bounded finding projection. No raw match, private hosted body, downloaded archive, scanner report, or owned audit temp root was retained.

## Exact local gates

All commands ran in the transition worktree against the source candidate and exited zero:

| Command | Result |
|---|---|
| `node --test tests/publication-audit.test.mjs tests/repository-compliance.test.mjs tests/workflow-policy.test.mjs` | PASS, 99/99. |
| `node --test --test-name-pattern='transactional validation installs locked dependencies\|dependency bootstrap failures leave the installed runtime byte-identical' tests/git-runtime-update.test.mjs` | PASS, 4/4 including both failure points. |
| `npm ci --ignore-scripts` | PASS from the pinned lockfile. |
| `npm test` | PASS, 363/363. |
| `npm run graph:test` | PASS, 12/12. |
| `npm run therapy-lessons:verify` | PASS, 5/5 tracked and 4 active runtime lessons. |
| `npm run audit:workflows` | PASS, 3 workflows and 0 findings. |
| `npm run audit:repository` | PASS, 0 errors and 6 truthful private-hosted warnings. |
| `npm run verify` | PASS on the real host with all 363 tests and final `VERDICT PASS`. |
| `bash scripts/report-worktree.sh` | PASS with no reported drift. |
| `git status --short` | PASS with no tracked or untracked source path before evidence editing. |

An initial restricted-runner invocation of the package verifier produced 16 whole-file Node test-runner failures without assertion output. Reproduction showed the restricted boundary corrupting nested test-worker IPC: a child received Node's binary test protocol while its JSON-consuming parent received empty stdout. The same exact verifier passed on the real host, no Node process survived, and no production/default state or port was shared. No test, timeout, concurrency, or production code was changed to obtain the pass.

The verifier restored every declared generated graph path byte-for-byte and rejected worktree drift. Required `npm ci` created only the ignored `node_modules/`; repeated tests left uniquely named synthetic fixture roots under `/tmp`, which are not production state inputs and were not deleted as part of this evidence task.

## CI contract

- `deterministic-package`: required private pull-request check; runs the exact package gate.
- `workflow-policy`: required private pull-request check; verifies repository/workflow drift.
- `codeql-javascript`: defined now, but its job is intentionally skipped while the repository is private and must run successfully after public visibility is read back.

There is no pull request or CI run ID yet because this Phase A evidence is committed and independently reviewed before any push. Phase B must record the exact PR head/tree and final-head check URLs or IDs.

## Current hosted controls

Read-only GitHub REST/API evidence was refreshed at `2026-08-15T02:24:28Z`:

| Control | Current safe readback |
|---|---|
| Repository | Exact identity; `visibility=private`, `private=true`, default `main`, not archived or disabled. |
| Branch heads | `main=7d139f1ab4972fceabcae45529021eee71bc0c4f`; `stable=110ee5342e27d8f1bd3d11cc2be4d85926c255b1`; `runtime-diagnostics=3f2e692e283ab95d5ba6c4b961be6192245eb73b`. |
| Branch enforcement | `main` and `stable` read `protected=false`; rulesets and both protection endpoints return HTTP 403 on the private plan. |
| Actions | Enabled; selected set; GitHub-owned allowed; verified creators false; custom patterns empty; `sha_pinning_required=true`; default token `read`; PR approval false. |
| Dependency security | Vulnerability-alert endpoint HTTP 204; automated-security-fixes endpoint HTTP 200; Dependabot alerts readable with 0 current alerts. |
| Code/secret protection | Code-scanning alerts HTTP 403. Prior enable attempts for private secret scanning/push protection returned HTTP 422; these remain disabled until public enablement/readback. |
| Vulnerability reporting | Private-vulnerability-reporting endpoint HTTP 404 while private; use the documented private fallback until public enablement. |
| Access inventory | One collaborator; zero deploy keys, webhooks, environments; repository-scoped GitHub App permissions remain `UNVERIFIED`. |
| Durable follow-up | Issue [#4, Codex + GitHub hardening audit](https://github.com/u-dont-existDOTcom/innerSignalGraph/issues/4) remains open. |

Hosted files do not prove these controls. The final status must use new API readback after the visibility change and public security/protection tasks.

## Owner decisions and irreversible boundary

The owner explicitly chose the existing repository as the public target, selected the MIT license, and stated there is no sensitive, private, or copyright blocker for this repository. The all-history and hosted-surface audits independently support only the bounded technical conclusion that they found no configured publication finding; they cannot prove legal ownership or prevent later disclosure.

Changing a repository to public is not fully reversible: external clones, forks, caches, mirrors, and indexed history can persist after visibility is changed back. Therefore the visibility mutation must occur only after the exact private PR is merged and a fresh detached-`main` local plus hosted audit passes. Any finding, incomplete surface, unexpected ref/PR, or identity mismatch leaves visibility private.

## Release, diagnostics, privacy, and policy non-effects

- `stable` was not advanced or written; its current hosted head remains `110ee5342e27d8f1bd3d11cc2be4d85926c255b1`.
- `runtime-diagnostics` was not merged into source or written by this task. Its expected independent advance was fetched and included in the final audits.
- No application, browser, installer, release, live model, or hosted mutation was started.
- No therapy/hypnosis/framework policy, guide, graph behavior, prompt contract, safety/evidence policy, model role, privacy scope, owner card, receipt, approval projection, or stable-release decision changed.
- The latest governed r03 therapy state remains blocked before independent Codex review, with no owner decision receipt and no production policy advancement.
- Diagnostics/recovery exclusions remain unchanged: no browser chat, therapy/hypnosis content, prompt, model output/reasoning, raw sensitive log, credential, environment value, username, hostname, IP address, absolute home path, or hash derived from excluded content may enter publication or recovery evidence.

## Lesson closeout and next action

- `project-specific`: these exact audit counts, hosted-control readbacks, private/public state boundary, and non-effects are preserved here.
- `promoted`: previously transferable hermetic verification, transactional update, readiness, privacy-safe diagnostic, and stage-recovery lessons remain merged in `universal-dev-architecture` as `81265fd3592ee842bfe30c7d73a5c1f3dc01b2d0`.
- `provisional`: the reusable public-visibility transition sequence remains scheduled for the plan's Task 8 after hosted execution supplies complete evidence; this phase does not prematurely promote it.
- `no-new-lesson`: no new therapy-content lesson, suggestion, decision receipt, or approval projection arose from infrastructure publication work.

Next safe action: independently review this complete `origin/main...HEAD` candidate, then push one private task branch, open one focused pull request to `main`, require exact-head `deterministic-package` and `workflow-policy` success plus the expected private `codeql-javascript` skip, and merge only after verifying the PR head/tree. Keep visibility private throughout that pull request.
