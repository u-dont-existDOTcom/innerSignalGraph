# Codex + GitHub Compliance Design

Date: 2026-08-14
Repository: `u-dont-existDOTcom/innerSignalGraph`
Target branch: `main`
Task branch: `codex/github-compliance-2026-08-14`

## Objective

Bring this private, active, critical-risk software repository to the applicable baseline in `u-dont-existDOTcom/universal-dev-architecture/patterns/codex-github-operating-system.md` without changing therapy or hypnosis policy, model roles, privacy boundaries, owner decisions, or the authority of `stable` as the sole release and installation source.

The work is additive consolidation. It preserves the existing Git and audit history, repairs verified gaps, validates every declared command against the final candidate, and distinguishes repository-visible controls from hosted GitHub controls.

## Recovered baseline

- `main` is development, `stable` is the sole release and installation source, and `runtime-diagnostics` is generated privacy-safe status data that must never merge into source.
- The prior `codex/github-baseline` work was squash-merged; its tree content is already present on `main`.
- `npm run verify` is the complete deterministic package gate. It restores two known generated files, but the workflow does not currently fail when the final worktree is dirty.
- `.nvmrc` pins Node `24.18.0`; `package.json` and installer/runtime checks currently permit broader Node versions.
- `.github/codex-repository.json` has no verified command map or canonical checkpoint.
- `docs/CURRENT-STATE.md` and `state/CODEX-CURRENT-STATE.md` compete as resumability checkpoints.
- the workflow-policy check fails because its raw-text detector treats a `pull_request_target` string inside its own implementation as a real workflow trigger.
- GitHub Actions default workflow permissions are read-only, but allowed Actions are unrestricted and hosted SHA-pinning enforcement is not enabled.
- GitHub’s current plan rejects private-repository rulesets and branch protection. Secret scanning, push protection, code scanning, vulnerability settings, and private reporting are either disabled or unavailable and must be tested individually rather than represented by files.
- Two open Dependabot pull requests update already-SHA-pinned `actions/checkout` and `actions/setup-node` revisions.
- Existing tests and documentation cover detached candidate validation, disposable state, credential removal, private-byte preservation, atomic swap, rollback, exact installed commits, readiness, model-role enforcement, therapy safety, and diagnostic/recovery privacy.

## Selected approach

Create one focused compliance branch from current `origin/main` and one pull request back to `main`. Consolidate existing mechanisms instead of replacing them. Include the two reviewed Action updates in this PR and close the now-superseded Dependabot PRs after the replacement PR is established.

Do not promote or merge to `stable`. Stable promotion remains a separate release event requiring deterministic package evidence, live-model evidence where applicable, adversarial review, owner policy decisions where applicable, installer/rollback evidence, and explicit stable release approval.

## Authority and resumability

`state/CODEX-CURRENT-STATE.md` becomes the sole mutable current-state checkpoint because the `state/AGENTS.md` contract already governs checkpoint updates. The repository profile, root `AGENTS.md`, `README.md`, and documentation index will point to it.

`docs/CURRENT-STATE.md` will remain in history but become a concise supersession notice. Historical implementation reports remain intact and will be labeled as historical when a stale claim could mislead a new worker.

The authoritative entry path will provide, in one short route:

1. root operating rules in `AGENTS.md`;
2. branch, release, privacy, and installation authority in `README.md` and `AUTOPILOT.md`;
3. the current implementation report and documentation index;
4. exact final-verified commands from `.github/codex-repository.json`;
5. the canonical current-state checkpoint.

## Runtime and command contract

Node `24.18.0` will be the single supported and CI-tested runtime. The exact value will agree across `.nvmrc`, package metadata, GitHub Actions, and installer/runtime preflight checks. A deterministic test will fail if these sources drift.

Because this is active software, the repository will gain a generated npm lockfile and a reproducible bootstrap command. No lint, typecheck, build, audit, or live-validation command will be invented. Each profile command will be selected from repository evidence, executed against the final commit, and recorded only with its exact outcome. Unsupported categories will be explicitly marked not applicable or unverified rather than populated with placeholders.

The profile will identify exact bootstrap/install, complete test, graph verification, package/build verification, full audit/verify, worktree/current-state, and any separately applicable security or release-evidence command.

## Hermetic verification

`npm run verify` remains the authoritative deterministic gate. Its wrapper will:

- preserve and restore known generated outputs even when a nested command fails;
- compare the complete pre-gate and post-gate Git status so unexpected tracked or untracked output fails deterministically;
- leave pre-existing caller changes byte-for-byte untouched;
- continue to validate immutable packet archives and release artifacts through the existing package verifier.

CI will run the same gate and then independently require a clean checkout. A test will reproduce generated-output drift and verify both restoration and detection behavior. No live model credential will be available to ordinary CI.

## Workflow policy and CI

Move the workflow audit into a repository script with regression tests. Its parser will distinguish YAML event/action/permission structure from string literals inside block scripts. The first regression will demonstrate the current self-detection failure; the minimal fix will reject an actual privileged `pull_request_target` checkout while accepting harmless mentions of that token.

Both workflows will have:

- explicit `contents: read` permissions;
- reviewed full-SHA Action pins;
- bounded timeouts;
- concurrency keyed by workflow and ref so unrelated branches do not block each other;
- pull-request and appropriate `main`/`stable` triggers;
- stable, unique check names suitable for future rulesets;
- no ordinary CI provider credentials or privileged untrusted-code path.

The updated Action SHAs from the two open Dependabot PRs will be reviewed and incorporated into the single compliance PR rather than creating overlapping merge chains.

## Ownership, security, and release evidence

CODEOWNERS will explicitly route review for:

- `.github/` and governance automation;
- installation, self-update, release packaging, and stable-promotion tooling;
- diagnostic, progress, recovery-export, and privacy-contract code;
- therapy/hypnosis policy, guide packets, prompts, graphs, and model-role enforcement;
- ledgers and owner-decision protocols.

`SECURITY.md` will state the private reporting path and prohibit secrets or private therapy data in issues, logs, or artifacts. Contribution and license posture will truthfully describe a private owner-controlled repository rather than imitating an open-source project.

A release-evidence document/template will require exact commit identity and evidence for deterministic gates, live-model entitlement and stages, adversarial review, therapy and psychological-safety regressions, owner policy decisions, stable promotion, transactional installation, private-byte preservation, rollback, exact installed marker, and sustained health. Deterministic substitutes will never be described as live entitlement evidence.

## Hosted GitHub controls

Hosted changes are applied only when the API proves the feature is supported and the resulting setting can be read back. Candidate reversible changes include enabling available vulnerability/dependency alerts, requiring immutable Action references when supported, tightening allowed Actions to the reviewed set when supported, and retaining read-only workflow defaults.

Branch protection and rulesets for `main` and `stable` will be attempted only through supported GitHub settings. Their desired contract is:

- `main`: pull request plus the unique deterministic verification check; force-push and deletion disabled;
- `stable`: the same safeguards plus advancement only through the documented release/promotion process after all required deterministic, live, adversarial, owner, installer, rollback, and health gates;
- `runtime-diagnostics`: never a source merge target.

If the private-repository plan continues to reject these settings, the report will quote the API status without credentials, mark the controls unverified/unavailable, and create one issue titled `Codex + GitHub hardening audit` containing the precise remaining actions and impact. Repository files will not claim that CODEOWNERS or documentation substitutes for enforcement.

Repository collaborators, deploy keys, webhooks, GitHub Apps, environments, Actions defaults, and security settings will be inventoried to the extent authorized by the current account. Inaccessible facts remain `UNVERIFIED`.

## Privacy and behavioral boundaries

Compliance work will not change:

- therapy or hypnosis prose, graphs, routing, or safety policy;
- guide-packet owner decisions or their ledgers;
- model roles, exact-model requirements, or entitlement semantics;
- the diagnostic/recovery allowlists or excluded-content scope;
- transactional installation semantics or `stable` authority.

Existing focused tests will be run to prove that diagnostics and recovery bundles continue to exclude browser chat, therapy/hypnosis content, prompts, model output/reasoning, raw logs, credentials, `.env`, identities, network information, absolute home paths, and hashes derived from excluded content.

The separate r03 candidate branch remains separate. Its real Opus compilation is currently blocked and must be recorded without converting model findings into owner policy or promoting the candidate.

## Verification and delivery

Behavioral changes follow RED-GREEN-refactor. Configuration and documentation changes receive policy/audit tests where useful. Final evidence will include:

- focused regression commands and outcomes;
- every applicable repository command from the final profile;
- the complete `npm test` and `npm run verify` results;
- final clean-worktree evidence;
- workflow/check names and GitHub run URLs or IDs;
- hosted-control API results;
- branch, commit, PR, and merge identity;
- current-state and release-evidence paths;
- residual risks and owner decisions;
- lesson disposition.

The PR will target `main`. It may be merged with the repository’s documented reversible strategy after all obtainable required checks pass. Stable will not be advanced by this task.

## Lesson closeout

Project-specific evidence remains in the checkpoint and compliance report. Therapy-content lessons remain in the project’s owner-governed therapy lesson stores.

Transferable findings about hermetic verification, generated-output cleanliness, transactional Git updates, condition-based readiness, privacy-safe diagnostics, and stage-specific recovery will be checked against the universal lesson index. The currently broken universal audit regular expression will receive its own failing test and minimal fix in the universal repository. Any genuinely new universal lesson will cite this repository, exact commit/path/hash, rationale, tests, limits, and supersession data in a separate universal pull request.

## Completion classification

The final report will use the mandated label literally. Repository-visible completion alone is insufficient. If an applicable hosted protection remains impossible because of the private-repository plan, the label will be `BLOCKED` unless the final verified facts meet the narrower definition of `COMPLIANT_WITH_DECLARED_EXCEPTIONS` without leaving an applicable requirement incomplete.
