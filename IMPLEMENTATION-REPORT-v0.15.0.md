# Inner Signal v0.15.0 implementation report

Date: 2026-08-12

## Outcome

Inner Signal now uses `u-dont-existDOTcom/innerSignalGraph` as its durable source, update, and repair-handoff system. A verified `stable` commit is installed transactionally, while a strictly allowlisted failure record is queued locally and synchronized to the separate `runtime-diagnostics` branch. Routine release-ZIP downloads and diagnostic-ZIP uploads are no longer part of the normal workflow.

This release changes orchestration only. Guide prose, therapy routing, hypnosis contracts, Guide Packet candidate bytes, owner decisions, and installed production r5 policy are unchanged.

## Root cause and architecture

The prior workflow had two coupled problems:

1. Source fixes were delivered as release ZIPs, leaving installation and repair dependent on manual file transfer.
2. Failure exports preserved local raw evidence but did not provide a remotely usable, privacy-safe failed-test summary. The user could therefore still become the transport layer for routine diagnosis.

v0.15.0 separates three repository roles:

- `main`: canonical development history.
- `stable`: the exact verified commit an installed runtime may adopt.
- `runtime-diagnostics`: privacy-safe incident records only; never merged into source branches.

The source checkout and installed runtime are separate. The updater fetches `origin/stable` noninteractively, validates a detached candidate against empty temporary state, moves preserved private state only during the atomic activation window, verifies its complete hash, writes the installed-commit marker only after activation, and restarts once after success. Any failed gate retains or restores the prior runtime.

## Implemented behavior

### Privacy-safe diagnostics

- Parses Node test failures into an allowlisted summary containing counts, failed test names, project-relative test locations, error codes, and bounded scalar/hash actual/expected values.
- Constructs a new ten-field remote object rather than sanitizing and forwarding an arbitrary diagnostic object.
- Excludes chat, therapy/hypnosis content, prompts, model output/reasoning, raw logs, credentials, environment values, usernames, hostnames, IP addresses, and absolute home paths.
- Uses a random local UUID for machine identity and a timestamp-independent incident hash for deduplication.
- Writes an atomic private outbox, confirms the remote write and local receipt, then removes the queued item.
- Treats repeated incidents on later dates as idempotent, processes at most three incidents per launch, and bounds all GitHub work to ten seconds total.
- Distinguishes confirmed authentication failures from ordinary network/GitHub outages.
- Honors `INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS=false` without queueing or calling GitHub.

### Transactional Git updates

- Verifies repository identity and rejects tracked source modifications before candidate work begins.
- Rejects overlapping source, installed-runtime, and private-state roots at both configuration and updater boundaries.
- Fetches `stable` with credential prompts disabled and a 15-second maximum.
- Validates package tests and graph regressions against empty temporary state, never the preserved user state.
- Rebuilds staging from the exact detached commit after validation so test artifacts cannot be installed.
- Preserves `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, and `data` as complete trees.
- Detects a private-state write during the handoff window and aborts without losing the write.
- Writes `git-install.json` only after runtime activation; activation failure restores both old source and the old commit marker.
- Handles clean bootstrap, current/no-op, verified update, validation failure, network failure, and rollback.

### Bootstrap, launcher, and status

- The one-time bootstrap verifies Node.js 20+, Git, npm, GitHub authentication, repository identity, and push access.
- The bootstrap delegates its network refresh to the bounded transactional updater instead of running a second unbounded fetch.
- The launcher retries queued diagnostics, checks `stable`, restarts once on an installed update, and continues the existing runtime after remote failure.
- Helper JSON is suppressed so noninteractive autopilot stdout remains a single machine-readable result.
- The development status endpoint and UI expose only bounded update/sync status, abbreviated commits, safe branch/path, timestamps, and pending count.

## RED-to-GREEN evidence

The following regressions failed against the prior implementation for the intended reasons before production changes were made:

- A GitHub outage was reported as `authentication-required`.
- A startup sync processed the entire outbox instead of a three-incident batch.
- GitHub subprocess calls retained independent 30-second timeouts instead of one ten-second budget.
- Startup `git fetch` retained a five-minute timeout and allowed credential prompting.
- Disabling diagnostics still allowed queue/sync behavior.
- A repeated incident with a later `createdAt` did not match the existing safe incident.
- A private-state write between hashing and transfer was not safely detected.
- Nested source/runtime/state paths were accepted.
- A failed runtime activation could leave the old runtime carrying the new installed-commit marker.
- The bootstrap did not reject Node.js 18 and ran a redundant shell-level fetch.

Each regression passed after the corresponding bounded change. Focused Git automation, launcher, and diagnostic integration finished at 33/33 before the final release gate.

## Fresh verification evidence

All commands below were run against the final source tree on 2026-08-12.

### Complete source suite

Command:

```bash
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm test
```

Result: 229 tests, 229 passed, 0 failed, 0 skipped, 0 cancelled.

### Production guide graphs

Command:

```bash
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm run graph:test
```

Result: 12/12 authored graph cases passed.

### Complete package verifier

Command:

```bash
env -u npm_config_http_proxy -u NPM_CONFIG_HTTP_PROXY npm run verify
```

Result: `PASS`, including:

- 229/229 automated tests;
- 12/12 graph regressions;
- r01 byte preservation at 4/4 and r02 verification at 5/5;
- syntax checks for runtime and test modules;
- immutable r01/r02 archive sidecars;
- mock A001 formulated replay;
- mock H001 app-owned gate and waking return;
- fake exact-model CLI resolution for `gpt-5.6-sol`, `claude-opus-5`, and `claude-sonnet-4-6`;
- web-client smoke, runtime fingerprint, package hygiene, and autonomous-development gates.

The verifier intentionally regenerates one mock ledger UUID and one graph compilation timestamp. Those two generated fields were restored to the committed values after the verifier; no source, guide, packet, or policy bytes changed.

### Exact privacy audit

Command:

```bash
node --test tests/remote-diagnostic.test.mjs tests/github-diagnostic-sync.test.mjs
```

Result: 17/17 passed. The exact fake-GitHub upload retained allowed test/hash evidence and excluded injected chat, prompts, reasoning, credentials, environment data, home paths, host/user identity, therapy markers, and raw output.

### Clean bootstrap and state-preserving updates

Command:

```bash
node --test --test-name-pattern='stable update validates|empty install bootstraps|activation failure restores' tests/git-runtime-update.test.mjs
```

Result: 3/3 passed. A local bare remote exercised:

- a clean install of the exact stable commit;
- update from v1 to v2;
- a current/no-op pass;
- a second update from v2 to v3;
- rollback after simulated activation failure.

The complete preserved-tree hash stayed equal across updates. Representative byte sentinels covered `.env`, private autopilot state, original Guide Packet candidate bytes, owner decisions, installed production policy, autonomous-development state, ledgers, and data. The immutable package verifier separately confirmed both bundled r01 and r02 archives.

### Bootstrap and launcher

Command:

```bash
node --test tests/git-launcher.test.mjs
```

Result: 4/4 passed: one official login, Git setup/repository verification, Node-version enforcement, update restart guard, outage-safe current-runtime launch, and no ZIP/log-transfer request.

### Repository scope and hygiene

- `git diff --check main...HEAD`: clean.
- 336 tracked files before this report; no `.env`, runtime state, development state, ledgers, or data files tracked.
- No tracked symlinks.
- `package.json` and `src/core/runtime-version.mjs`: both `0.15.0`.
- The post-verification worktree was clean before this report was added.

## Live-model boundary

Live subscription-backed model calls were not available in this build environment. This infrastructure release does not change therapeutic model behavior. The package verifier used deterministic CLI substitutes to verify exact model selection, role separation, checkpointing, and failure routing. The installed runtime continues to perform real local entitlement probes before live model work.
