# Git Self-Update and Automatic Diagnostic Sync Design

Date: 2026-08-12

## Decision and scope

Inner Signal will use `u-dont-existDOTcom/innerSignalGraph` as its durable source and repair-handoff system. Verified runtime source is installed from a `stable` branch. A failed runtime automatically sends a strictly allowlisted diagnostic record to a separate `runtime-diagnostics` branch. The diagnostics branch is never merged into `main` or `stable`.

This replaces routine release-ZIP downloads and diagnostic-ZIP uploads. One initial GitHub authentication and Git bootstrap may require a browser login; after that, source updates, validation, installation, diagnostic delivery, and retry are automatic.

The change is orchestration-only. It does not alter guide prose, therapy routing, hypnosis contracts, owner decisions, candidate packets, or installed production policy.

## Repository roles

- `main`: canonical development history.
- `stable`: the exact commit the installed runtime is allowed to adopt. It advances only after the full package, privacy, clean-install, and state-preserving upgrade gates pass.
- `runtime-diagnostics`: append-only incident records written by installed runtimes. It is not an update source and is never merged into source branches.
- `agent/*`: bounded development branches used before verified changes reach `main`.

The expected repository is fixed to `u-dont-existDOTcom/innerSignalGraph`. An override is permitted only through an explicit configuration value, and repository names are validated before any GitHub command runs.

## Local layout

The default French Zorin paths are:

- source checkout: `~/Téléchargements/innerSignalGraph`
- installed runtime: `~/Téléchargements/inner-signal-runtime`
- private preserved state: `~/Téléchargements/inner-signal-runtime/.inner-signal-autopilot`

The source checkout contains no runtime state or credentials. The installed runtime is a managed copy, not the update checkout. This prevents a Git update from overwriting a running file in place and keeps local autonomous-repair candidates separate from the remote source.

## Initial Git bootstrap

`packaging/install-from-git.sh` is the one-time entrypoint. It:

1. detects `git`, Node 20+, npm, and GitHub CLI;
2. installs GitHub CLI through the system package manager only when it is absent and the user can authorize the normal `sudo` prompt;
3. opens the official `gh auth login --web` flow only when GitHub authentication is missing;
4. configures Git credential access with `gh auth setup-git`;
5. clones or fetches the expected private repository;
6. resolves `origin/stable` to an exact commit;
7. validates and installs that commit transactionally;
8. starts Inner Signal.

Authentication state is never read, copied, logged, exported, or committed. The bootstrap reports only authenticated/not-authenticated and repository access success/failure.

## Automatic update transaction

Every ordinary `run-autopilot.sh` launch performs a bounded update check before model validation:

1. read the last installed Git commit from private local state;
2. authenticate non-interactively with the existing GitHub CLI session;
3. fetch `origin/stable` into the source checkout;
4. compare the remote commit with the installed commit;
5. if unchanged, continue immediately;
6. if changed, create a detached temporary worktree at the exact stable commit;
7. copy managed source into a sibling staging runtime while excluding `.git`, `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `data`, and ledgers;
8. run deterministic package tests and graph regressions against an explicitly empty temporary state root, so preserved user state cannot change the package-test result;
9. overlay the preserved private directories from the installed runtime only after clean-source validation passes;
10. verify the preserved-state inventory and candidate/production hashes without running tests against private state;
11. if every gate passes, atomically swap staging into place, record the installed commit, and restart once with an update-loop guard;
12. if a gate fails, retain the current runtime, write a safe incident, sync it automatically, and continue serving the current version.

The updater is fast-forward-by-source: it adopts only the commit currently named by `origin/stable`. It never runs `git reset --hard` against the installed runtime, never stages private state, and never deletes the working source checkout. A network, authentication, or GitHub outage cannot take down an already installed runtime.

## Test-failure capture

Package tests already preserve full stdout and stderr locally. A new deterministic parser creates a separate remote-safe summary with only:

- test command and numeric exit code;
- total/pass/fail/cancelled/skipped counts when present;
- failed test names;
- project-relative test file, line, and column;
- allowlisted error codes such as `ERR_ASSERTION`;
- bounded numeric, boolean, version, and SHA-1/SHA-256 actual/expected values;
- runtime version, installed commit, candidate update commit, stage, and timestamp.

The parser does not copy arbitrary assertion objects or surrounding output. Absolute home paths become project-relative paths. Text not matching an allowlisted field is dropped rather than broadly redacted.

## Remote diagnostic contract

Each failure creates `inner-signal-remote-diagnostic-v1`, containing only these top-level fields:

- `format`
- `incidentId`
- `machineId`
- `createdAt`
- `runtime`
- `update`
- `failure`
- `tests`
- `integrity`
- `privacy`

`machineId` is a random local UUID persisted in private state. It is not derived from the Linux username, hostname, home path, email, IP address, or hardware identifiers. `incidentId` is a deterministic hash of the stable safe failure fields and excludes `createdAt` and other volatile timestamps, so retries are idempotent and repeated launches do not create duplicate incidents.

The contract always excludes:

- browser chat and user messages;
- therapy case state, clinical extraction, prompts, reasoning, and model output;
- hypnosis content;
- development-case payloads;
- Guide Packet ZIP bodies and guide prose;
- `.env` values;
- API keys, OAuth material, cookies, GitHub tokens, credential stores, and command environments;
- absolute home paths, Linux usernames, hostnames, IP addresses, and process environment dumps;
- raw test stdout/stderr.

The implementation constructs a new object from the allowlist. It never sanitizes an arbitrary diagnostic object and then uploads the remainder.

## Outbox and GitHub delivery

Safe incidents are first written atomically to `.inner-signal-autopilot/diagnostic-outbox/<incidentId>.json`. Delivery uses the authenticated GitHub CLI API, never a token passed on the command line.

For each incident, the sync worker:

1. verifies repository identity and push permission;
2. ensures `runtime-diagnostics` exists, creating it from `stable` only if absent;
3. creates `diagnostics/<machineId>/<incidentId>.json` on that branch;
4. treats an identical existing path as success;
5. records a local receipt with the branch, path, commit SHA, and sync time;
6. removes the incident from the pending outbox only after a confirmed remote write.

If delivery fails, the runtime keeps the safe outbox record and retries on the next launch and after the next failure. It does not ask the user to find or upload logs. Authentication failure may open one official GitHub login flow during bootstrap; background runtime failures never create a repeated login loop.

## Local status

Terminal and development status expose only:

- update check: current, updated, deferred, or failed-safe;
- installed and available stable commit abbreviations;
- diagnostic sync: synced, queued for retry, disabled, or authentication required;
- remote branch/path after successful sync.

The local UI never displays GitHub credentials or the encoded diagnostic body.

## Configuration

Defaults:

```text
INNER_SIGNAL_GITHUB_REPOSITORY=u-dont-existDOTcom/innerSignalGraph
INNER_SIGNAL_GIT_STABLE_BRANCH=stable
INNER_SIGNAL_GIT_DIAGNOSTICS_BRANCH=runtime-diagnostics
INNER_SIGNAL_GIT_SOURCE=~/Téléchargements/innerSignalGraph
INNER_SIGNAL_GIT_AUTO_UPDATE=true
INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS=true
```

The two automatic behaviors default to enabled for CLI installations. They can be disabled locally without deleting queued diagnostics. Configuration files contain repository and branch names only, never credentials.

## Verification requirements

The release cannot advance `stable` unless all of the following pass:

- the existing complete test suite;
- focused RED-to-GREEN tests for failure parsing and strict allowlisting;
- mutation-sensitive tests proving raw markers cannot enter a remote payload;
- a fake-`gh` integration test for branch creation, upload, idempotence, failure retention, and retry;
- a local bare-remote update simulation covering no-op, successful update, validation failure, rollback, and state preservation;
- a clean Git bootstrap simulation;
- package verifier and graph regressions;
- a privacy scan of every file intended for `runtime-diagnostics`;
- two consecutive update/install passes preserving `.env`, both private state trees, ledgers, data, candidate bytes, owner decisions, and production policy.

Live subscription-backed model calls are outside this infrastructure change. The existing exact-model entitlement checks remain local and unchanged.
