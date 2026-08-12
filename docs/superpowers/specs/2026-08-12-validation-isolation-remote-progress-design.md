# Validation Isolation and Remote Progress Design

Date: 2026-08-12
Release target: Inner Signal v0.15.1

## Decision and scope

Inner Signal v0.15.1 corrects the environment-dependent bootstrap failure discovered after v0.15.0 reached `stable`, and makes successful autonomous progress remotely inspectable without copying logs. The release has three bounded changes:

1. candidate validation and launcher tests are hermetic and cannot reach the real source checkout, runtime state, GitHub authentication, or model credentials;
2. bootstrap reports validation failure as failure instead of launching a preserved older runtime as though installation succeeded;
3. the installed runtime maintains one strictly allowlisted current-progress document on `runtime-diagnostics`, with bounded updates and no prose, prompts, outputs, or private state.

The existing transactional update, failure outbox, therapy behavior, guide graphs, hypnosis contracts, model policy, owner decisions, and Guide Packet approval rules remain unchanged.

## Confirmed v0.15.0 failure

The package validator exported its disposable `AUTOPILOT_STATE_DIR` to `npm test`. The updater CLI regression inherited that ambient path because it overrode its fixture install and source roots but not its state root. It therefore wrote the test fixture's `candidate contract fails` incident into the validator's shared state instead of its own fixture. A concurrent launcher-liveness test inherited the same state and invoked the real diagnostics flusher through the user's authenticated `gh`, uploading the synthetic record.

The same inheritance caused the updater regression to look for its status under the fixture runtime and fail with `ENOENT`, so a real candidate could not pass validation on the user's configured machine. The updater preserved the prior runtime correctly, but bootstrap accepted the updater CLI's ordinary failed-safe exit code and could continue with that older runtime.

## Hermetic candidate validation

Candidate validation receives a deliberately isolated environment rather than an unrestricted copy of the parent environment. It preserves only ordinary process execution requirements, then enforces these boundaries:

- `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and `GH_CONFIG_DIR` point inside the disposable validation root;
- `AUTOPILOT_STATE_DIR`, Guide Packet state, ledgers, development jobs, candidates, and promotion state point inside that root;
- automatic Git update and automatic diagnostic delivery are disabled for child launchers;
- GitHub and model credential environment variables are removed;
- a validation-sandbox marker lets the launcher skip Git update and remote synchronization even if a copied `.env` attempts to enable them;
- the real source checkout and installed runtime paths are not exposed as defaults.

Tests that intentionally exercise Git update or diagnostic delivery must set every relevant root explicitly and must use a local bare remote or fake GitHub CLI. No test is allowed to depend on an ambient `AUTOPILOT_STATE_DIR`, `HOME`, authenticated `gh`, or the user's default `~/Téléchargements/innerSignalGraph` checkout.

Launcher/liveness tests set update and diagnostic automation off, use a test-owned state root, and install a poison GitHub command. The tests fail if the poison command is invoked or if any file appears in an ambient external state directory.

## Truthful bootstrap result

The updater retains its launch-safe behavior: an ordinary installed-runtime update failure keeps the old runtime and does not prevent startup. Bootstrap is different because its purpose is to install the requested release. When `git-update.mjs --bootstrap` returns `DEFERRED` or `FAILED_SAFE`, it exits with a dedicated nonzero code. `packaging/install-from-git.sh` accepts only `CURRENT` or `UPDATED`; it never labels an older preserved runtime as the newly installed release.

The bootstrap test covers an already-present old runtime, a failing candidate, and the exact assertion that the old launcher is not executed after the failed install attempt.

## Local progress state

Autopilot stage events are written atomically to a private local runtime-progress record. The record contains stage/status codes, timestamps, process identity for local liveness checks, and the last completed stage; it never stores progress-line detail text. Finalization marks the foreground run complete, blocked, or action-required.

The development worker already persists structured supervisor state. A progress snapshot builder reads that state, the local runtime-progress record, update status, and diagnostic-sync counts. It constructs a new remote object from a fixed allowlist rather than sanitizing or copying the source objects.

## Remote progress contract

The current remote document uses format `inner-signal-remote-progress-v1` at:

```text
progress/<machineId>/current.json
```

It contains exactly these top-level fields:

- `format`
- `machineId`
- `observedAt`
- `runtime`
- `progress`
- `update`
- `diagnostics`
- `privacy`

Allowed progress fields are generated enums, booleans, bounded integers, timestamps, release versions, Git commit hashes, and validated stage/action codes:

- automation domain: `runtime`, `development`, or `idle`;
- overall state: existing generated supervisor states such as `WORKING`, `REPAIRING`, `VERIFYING`, `WAITING_FOR_HUMAN`, `BLOCKED_INTERNAL`, and `COMPLETE`;
- deterministic assessment: `ADVANCING`, `LONG_RUNNING_STAGE`, `WAITING_FOR_HUMAN`, `BLOCKED`, `COMPLETE`, `IDLE`, or `WORKER_NOT_RUNNING`;
- current stage/status and last completed stage;
- worker-alive flag;
- elapsed seconds and seconds since the last meaningful allowlisted state transition;
- pending and blocked engineering-task counts;
- next automatic action and whether human action is required.

The remote document excludes task names, job IDs, blocker prose, supervisor analysis prose, repair directives, user messages, therapy or hypnosis state, guide content, model prompts/output/reasoning, raw logs, credentials, host/user/network identity, absolute paths, PIDs, and hashes derived from excluded content.

`machineId` remains the random UUID already used by failure diagnostics. A local hash is computed only from the allowlisted progress core to determine whether meaningful state changed; that hash is not uploaded.

## Heartbeat scheduling and delivery

A companion process starts with the runtime and stops with it. It polls local state every 30 seconds, coalesces rapid stage changes, and updates the remote document when either:

- the allowlisted progress core changed and at least 30 seconds passed since the prior write; or
- five minutes passed since the prior successful write.

This limits a steady runtime to at most twelve heartbeat commits per hour while keeping remotely inspected progress at most five minutes stale. A failed write retains only the newest local progress document for retry; progress failures never block the app and never create an unbounded queue.

The existing incident outbox stays append-only. The `current.json` progress path is intentionally mutable, while Git commit history retains prior snapshots. GitHub branch conflicts or outages are retried on the next poll. Incident delivery and progress delivery use the same strict repository/branch validation and authenticated `gh api` transport, never command-line tokens.

## Deterministic overall assessment

Remote assessment is deterministic, not generated prose:

- a recent allowlisted transition with a live worker is `ADVANCING`;
- a live worker remaining in one legitimate stage beyond the recent-transition window is `LONG_RUNNING_STAGE`, not automatically called stuck;
- a non-live worker while work is active is `WORKER_NOT_RUNNING`;
- owner/account action states are `WAITING_FOR_HUMAN`;
- bounded internal or automatic-recovery blockers are `BLOCKED`;
- completed and idle states are `COMPLETE` and `IDLE`.

This makes remote checks honest without uploading enough content to judge the prose itself. Content-quality review remains local in the autonomous reviewer and supervisor.

## Synthetic-record cleanup

After v0.15.1 passes all release gates, the known synthetic `candidate contract fails` file is deleted from the current `runtime-diagnostics` tree in a normal recoverable Git commit. Its historical commit remains auditable. No branch history is rewritten.

## Verification requirements

`stable` cannot advance until all of these pass:

- focused reproduction with an ambient external `AUTOPILOT_STATE_DIR` now passes and leaves that directory unchanged;
- candidate validation proves isolated home/config/state roots, disabled external automation, and absent credential variables;
- launcher tests prove the poison GitHub command is never invoked;
- bootstrap refuses a failed-safe candidate and does not start a preserved old launcher;
- strict remote-progress schema and decoy-marker tests;
- meaningful-change, coalescing, periodic-heartbeat, offline-retry, and process-liveness tests;
- fake-GitHub create/update/idempotence/conflict tests for `current.json`;
- complete package and graph suites;
- the full package verifier;
- a realistic local-bare-remote clean install and two-step upgrade preserving all private sentinels;
- a remote privacy scan proving only the allowlisted progress and diagnostic paths differ on `runtime-diagnostics`.

The release report records the observed RED failures, GREEN evidence, exact test counts, and remote commit/tree verification.
