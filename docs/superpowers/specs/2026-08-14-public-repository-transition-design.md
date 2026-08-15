# Public repository transition design

Status: accepted in direct owner conversation on 2026-08-14

Repository: `u-dont-existDOTcom/innerSignalGraph`

Task branch: `codex/public-repository-transition-2026-08-14`

Starting commit: `7d139f1ab4972fceabcae45529021eee71bc0c4f` (`origin/main`)

## Objective

Make the existing Inner Signal repository public under the MIT License, then use the public-repository GitHub controls to close the applicable gaps recorded in issue 4. The transition must preserve Inner Signal's critical-risk software controls, `main`/`stable`/`runtime-diagnostics` branch authority, transactional installation, diagnostic privacy, deterministic model-role enforcement, and owner-only therapy or framework policy decisions.

The result is not complete merely because the visibility field says `public`. Completion requires a publication-readiness audit before disclosure, verified hosted controls after disclosure, green final-commit repository and CI gates, durable evidence, a protected pull-request path, and an honest terminal classification.

## Owner decisions and accepted consequences

Joel explicitly decided that:

- the existing `u-dont-existDOTcom/innerSignalGraph` repository should become public rather than remain private or be replaced by a sanitized public mirror;
- the repository contains no sensitive, private, or copyrighted material that prevents publication;
- the repository should use the MIT License; and
- the standard copyright line is `Copyright (c) 2026 u-dont-existDOTcom`.

Publication will expose the repository's reachable source and history, public branches, issues and pull requests, and retained GitHub Actions logs. Other people may clone or fork it. Returning the repository to private visibility later cannot retract copies or public forks created while it was public. The owner accepted that consequence, but the transition still fails closed if the deterministic audit finds a credential, private material, or a publication-rights conflict.

These are repository publication and licensing decisions. They do not approve or alter therapy, hypnosis, guide, graph, prompt, safety, evidence, privacy-scope, model-role, owner-card, or stable-release policy. No therapy ledger transition is created by this work.

## Authority and invariants

The implementation follows this authority order:

1. the current owner mandate and the publication decisions above;
2. root and applicable nested `AGENTS.md` files;
3. `.github/codex-repository.json`, `state/CODEX-CURRENT-STATE.md`, `README.md`, `AUTOPILOT.md`, and `docs/INDEX.md`;
4. verified repository code, tests, Git history, GitHub API readback, and final CI;
5. the current universal Codex/GitHub operating-system pattern.

The following invariants remain unchanged:

- `main` is development authority.
- `stable` is the sole installation and release source.
- `runtime-diagnostics` contains generated allowlisted status only and never merges into a source branch.
- No unverified `main` commit may be installed or promoted as a release.
- A stable promotion still requires the complete deterministic, live-model when applicable, adversarial, psychological-safety, owner-decision, transactional-install, rollback, and sustained-health evidence in `docs/RELEASE-EVIDENCE.md`.
- Candidate validation remains detached and disposable, credentials remain absent from validation children, private bytes remain preserved, promotion remains atomic, and rollback remains available.
- Ordinary CI receives no live-model credentials and cannot substitute deterministic fixtures for real entitlement evidence.
- GitHub repository files never count as proof of a hosted setting; the final report uses API or settings readback.

## Chosen approach

Use two focused pull requests with the hosted visibility transition between them.

### Pull request 1: public-readiness changes while still private

The first pull request prepares and verifies the repository without disclosing it. It will:

- add the standard MIT `LICENSE` with the owner-approved copyright line;
- rewrite the private-only contribution and security language for a public, critical-risk repository while retaining private vulnerability reporting and strict excluded-data rules;
- add a least-privilege CodeQL workflow pinned to reviewed full commit SHAs, with a unique JavaScript check name, bounded timeout, concurrency, no live-model credentials, and an explicit visibility guard so unsupported private-repository analysis is skipped until publication;
- update repository policy tests and the machine-readable audit for the public posture and CodeQL workflow;
- add a deterministic publication audit that scans all reachable Git objects and current remote refs, tracked filenames/content, issues and pull requests, retained Actions logs, and available artifacts without printing suspected secret values;
- record bounded audit evidence, including exact ref/commit/run counts and finding categories, without copying raw logs or excluded content into the repository;
- update the canonical checkpoint and public-transition evidence while keeping `.github/codex-repository.json` truthful about the still-private hosted state; and
- run every applicable focused and full repository gate against the final pull-request commit and require an unchanged worktree afterward.

The publication audit is a hard gate. A possible credential, private transcript, provider token, private user material, or unresolved publication-rights conflict stops the transition before visibility changes. A finding is reported by type and bounded location only. Secret values and sensitive excerpts are never printed, committed, or pasted into GitHub.

The audit must cover every currently hosted branch, including `runtime-diagnostics`, available pull-request refs, and all commits reachable from those refs rather than only the default branch tip. It must also inspect the available GitHub issue, pull-request, Actions-log, and artifact surfaces. If a high-confidence finding exists, the implementation does not delete it or rewrite shared history autonomously; it records the exact blocked remediation boundary and asks for the minimum required owner action.

After review and green checks, pull request 1 is squash-merged to `main` while the repository is still private. `stable` and `runtime-diagnostics` do not move.

### Hosted transition: visibility and security controls

Immediately before changing visibility, the worker will read back:

- the exact repository identity and current visibility;
- the merged `main` commit and tree;
- the completed publication-audit result for that exact tree and reachable hosted surfaces;
- the current branch heads and open pull requests;
- the current Actions, vulnerability, Dependabot, and access settings; and
- the absence of an unresolved publication blocker.

Only then will the existing repository be changed to public visibility. The same repository is used; no mirror, replacement repository, rename, or history rewrite is part of this design.

After the public readback succeeds, the worker will enable and independently read back every applicable public/high-risk control:

- secret scanning;
- push protection;
- code scanning through the committed CodeQL workflow;
- private vulnerability reporting;
- vulnerability and Dependabot alerts and automated fixes;
- least-privilege Actions defaults, GitHub-owned Actions restriction, and full-SHA enforcement; and
- the repository access inventory, including collaborators, deploy keys, webhooks, environments, and installed GitHub Apps to the extent the authenticated API/settings surface permits.

`main` will require pull requests, the unique `deterministic-package` and `workflow-policy` checks, strict/up-to-date status, conversation resolution, linear history, administrator enforcement, and force-push/deletion prevention. It will not require an impossible solo approval. The unique CodeQL check is added to the required set only after its successful public run establishes the real context name.

`stable` will receive the same mechanical protections and the proven CodeQL context. Its documented release authority remains stricter than `main`: it advances only through the established promotion process for the exact verified candidate. A new stable-release check is required only after a deterministic verifier exists and has produced a real successful check; no placeholder required check may make the branch impossible to advance correctly.

The CodeQL check becomes required only after a successful run has established its exact, unique check name on the protected branch. If CodeQL fails, it is diagnosed and repaired through an ordinary pull request; it is not waived or added as an impossible required context.

### Pull request 2: public hosted-evidence reconciliation

The second pull request records the actual public hosted state after API readback. It will:

- change `.github/codex-repository.json` from private to public and record exact hosted-control results and timestamps;
- update `README.md`, `AGENTS.md`, `docs/INDEX.md`, `state/CODEX-CURRENT-STATE.md`, and the compliance report so one entry path describes the public posture without weakening runtime or release authority;
- record the final workflow and check names with GitHub run links or IDs;
- record branch-protection/ruleset readback for `main` and `stable`;
- disposition issue 4 line by line and close it only if every applicable item is verified or supported by a precisely declared terminal exception;
- prove the protected pull-request path by passing and merging through the rules now applied to `main`; and
- complete lesson closeout without placing therapy-policy material in universal guidance.

Pull request 2 targets `main`, not `stable`. It is merged only after its final-head required checks pass and the hosted controls allow the documented merge strategy. `stable` remains unchanged unless Joel separately approves a release through the existing owner boundary.

## Components and responsibilities

### Publication auditor

One repository-owned command will orchestrate publication checks and produce a machine-safe result. It depends on Git for object/ref enumeration and authenticated GitHub read access for hosted surfaces. Its output contains counts, pass/fail state, finding categories, and bounded identifiers; it never emits matched secret values or raw log bodies.

The auditor distinguishes:

- high-confidence credential patterns;
- prohibited private-data filenames or content markers;
- excluded therapy-session/private-user material;
- publication-rights or license conflicts identified by repository policy; and
- unavailable hosted surfaces, which remain `UNVERIFIED` rather than silently passing.

Causal policy tests will use synthetic fixtures and synthetic tokens. They will prove detection across old commits, non-default refs, filenames, and downloaded log text, plus prove that redacted examples and harmless documentation do not create false positives.

### Public repository documents

`LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md` define the public legal, contribution, and reporting posture. They remain concise and point back to the existing authority map. Public contribution availability does not grant contributors authority over therapy/framework policy, privacy scope, model roles, or release promotion.

### CodeQL workflow

The CodeQL workflow analyzes the supported JavaScript/TypeScript surface on pull requests, pushes to `main` and `stable`, a bounded schedule, and manual dispatch. Its analysis job is visibility-gated while the repository remains private on an unsupported plan, then is manually dispatched immediately after public visibility is confirmed. It uses explicit permissions, normally `contents: read` plus only the job-scoped security-event permission CodeQL requires. Every remote Action is pinned to a reviewed full commit SHA. The workflow uses the exact repository Node declaration where setup is needed and does not run provider-backed or live-model paths.

### Hosted-control reconciler

Hosted mutations are applied one bounded setting at a time and read back after each write. Before-state and after-state are recorded as safe scalar configuration, not credentials. A failed write does not trigger a weaker substitute. Partial success is reflected truthfully in the checkpoint and issue 4, and the task remains `BLOCKED` when an applicable control or permission remains incomplete.

## Error handling and recovery

- If the pre-public audit fails, visibility remains private and no hosted public transition begins.
- If pull request 1 or its checks fail, repair occurs on the same focused branch; no overlapping PR chain is created.
- If visibility mutation fails, read back the actual visibility and stop before applying public-only assumptions.
- If visibility succeeds but a later hosted control fails, do not claim rollback has retracted publication. Preserve the public state, finish every safe control that remains possible, and record the exact blocker. Changing back to private is a separate consequential decision because public copies may already exist.
- If branch protection would create an impossible solo workflow or require a nonexistent check, reject that configuration before writing it.
- If GitHub App permissions cannot be enumerated with the available authentication, attempt the supported repository-settings/API route. If still inaccessible, keep the item `UNVERIFIED`, preserve one precise remaining action in issue 4, and use the mandated terminal label rather than claiming compliance.
- No publication-audit or hosted-control error path starts the app, opens a browser, performs an install, promotes `stable`, sends repository material to model providers, or changes therapy policy. The separately scheduled transactional-bootstrap verification uses only disposable roots.

## Verification design

Behavioral changes begin with causal failing tests. Documentation-only changes use repository policy and audit tests. The implementation plan must name exact commands only after confirming them from the final repository.

At minimum, verification covers:

- publication-audit positive and negative fixtures, including historical and non-default-ref cases;
- repository compliance and workflow-policy tests;
- CodeQL workflow structure, immutable pins, events, permissions, timeout, concurrency, and unique check name;
- `npm ci --ignore-scripts`;
- `npm test`;
- `npm run graph:test`;
- `npm run therapy-lessons:verify` when the unchanged therapy-governance contracts are inspected by the complete gate;
- `npm run audit:repository`;
- `npm run verify` on the real host with no generated or untracked worktree drift;
- the real transactional bootstrap path on this machine against disposable roots for the final public-readiness candidate, without launching the application or changing the installed runtime;
- GitHub Actions final-head runs for every required workflow;
- post-public CodeQL execution and alert/readback state;
- API readback of visibility, Actions defaults, scanning controls, vulnerability reporting, branch protection/rulesets, access inventory, and required checks; and
- final diffs against `origin/main` plus explicit confirmation that `stable` and `runtime-diagnostics` were not merged or advanced by this task.

The pre-public audit and final hosted readback are real evidence. A deterministic substitute cannot prove a hosted control, provider entitlement, or public visibility.

## Pull-request and merge discipline

Both pull requests are focused, sequential, and target `main`. Pull request 2 is not opened until pull request 1 is merged and the hosted transition has been read back. Each PR records its exact final commit, changed-file purpose, exact command results, CI run IDs/links, risk, rollback limits, current-state path, residual uncertainty, and lesson disposition.

The merge strategy is squash merge unless current repository policy establishes a different strategy before execution. Merge commits remain reachable through GitHub and reflog/refs. Remote publication and visibility writes use explicit task authority; force pushes and shared-history rewrites are outside this design.

## Lesson closeout

Project-specific publication evidence stays in this repository. Existing transferable lessons on hermetic verification, generated-output cleanliness, transactional Git updates, condition-based readiness, privacy-safe diagnostics, and stage-specific recovery are already promoted and are not duplicated.

Any genuinely new cross-project lesson from the public transition is promoted to `u-dont-existDOTcom/universal-dev-architecture` only with source repository, final commit/path/hash, rationale, causal tests, limits, and supersession metadata. Otherwise it is explicitly classified as `no-new-lesson`, `project-specific`, `provisional`, or `superseded`. Therapy content and policy lessons remain in the project-specific owner-governed stores.

## Completion criteria

The transition is complete only when:

1. pull request 1 is merged to `main` with the MIT license, public posture, CodeQL definition, deterministic publication audit, green final-head CI, and a passing complete pre-public audit;
2. the existing repository reads back `public`;
3. applicable security, Actions, and branch controls are enabled and read back, with CodeQL successfully run before its check is required;
4. pull request 2 passes through the protected `main` path and records exact final hosted evidence;
5. issue 4 is updated and closed only when its applicable findings are resolved or meet the mandate's exact declared-exception standard;
6. the canonical checkpoint and compliance report contain branch, commit, changed-file, command, CI, hosted-control, decision, risk, lesson, and merge evidence;
7. `stable` and `runtime-diagnostics` remain separate and unadvanced by the compliance transition; and
8. the final report uses exactly one mandated terminal label: `COMPLIANT`, `COMPLIANT_WITH_DECLARED_EXCEPTIONS`, `BLOCKED`, or `NOT_COMPLIANT`, supported by the actual evidence.
