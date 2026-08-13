# Inner Signal v0.15.2 — Deterministic Recovery Readiness

## Outcome

v0.15.2 repairs the nondeterministic readiness assertion that blocked the v0.15.1 transactional installation. It also makes launcher copies and direct-checkout diagnostic CLI tests independent of ambient installed-runtime configuration. The production launcher, update transaction, rollback, diagnostic payload, progress heartbeat, therapy and hypnosis behavior, guide graphs, exact model roles, Guide Packet owner gates, and installed policy are unchanged.

## Incident evidence

Candidate commit `62418292489cf5c764e767f8b010b98b3e14c71c` passed 241 of 242 tests. Incident `3a1e7d232f4c5b0fe8bd9391e4fade1a86d646786d79e13bd4145937f4654f31` named:

```text
tests/runtime-service-liveness.test.mjs:191
promotion failure restarts health, status, and recovery ZIP instead of abandoning the browser
```

The exact load-amplified assertion was `TypeError: fetch failed` at the first `/health` request. The test waited for a promotion-attempt marker, slept 500 milliseconds, and made one request. That marker established that promotion began, not that cleanup, failed-promotion return, preserved-server restart, and HTTP readiness had completed.

The incident-era temporary runtime recorded its promotion marker at `20:07:19.649Z`, its restarted-server log at `20:07:20.710Z`, and its ready URL at `20:07:20.933Z`. The fixed probe could run around `20:07:20.149Z`. The same process later listened successfully on the same port, and the log contains no `EADDRINUSE`, bind failure, or crash. Concurrent focused reproduction failed 6 of 8 times with `fetch failed`; isolated and complete-suite runs could pass.

The incident is therefore a readiness race in the test, not a production recovery defect and not a stale process or port-cleanup defect.

## Deterministic liveness contract

The promotion-recovery regression now controls the transition explicitly:

1. The first server starts normally and proves the real launcher is usable.
2. The test wrapper fails the real promotion command at its subprocess boundary.
3. The second `serve.mjs` start is held before Node begins listening.
4. The test proves the launcher remains alive and loopback health is unavailable during the held transition.
5. The test releases the recovery start.
6. The assertion polls the public `/health` endpoint while continuously checking that the launcher has not exited or been signaled.
7. After health returns HTTP 200, the test requires development status, guide status, and a nontrivial `application/zip` recovery export.

This retains the 30-second test ceiling and all endpoint assertions. It does not replace the public condition with an internal marker, weaken a response check, or increase a production timeout. Removing the promotion-failure `start_server` call or returning before public health succeeds makes the regression fail.

## Desktop and process ownership

Every liveness-test command directory provides executable no-op `xdg-open` and `gio` commands. The real launcher still selects and invokes its normal desktop-open interface, but the test-owned boundary cannot create browser tabs.

Teardown addresses only the detached process group created by that test. It sends `SIGTERM`, waits for a real exit (including signal exit), uses `SIGKILL` only if that exact group does not stop, verifies termination, and removes the temporary runtime. The progress-watcher regression still requires one watcher start and its `TERM` cleanup trap.

## Direct-checkout diagnostic isolation

`sync-diagnostics.mjs` and `sync-progress.mjs` treat their own checkout as the installed root. Before v0.15.2, six CLI tests could inherit the production default source checkout at that same path, so `sourceRoot and installedRoot must not overlap` fired before the intended fake-GitHub behavior.

Each affected CLI fixture now supplies a distinct nonexistent `INNER_SIGNAL_GIT_SOURCE` below its own temporary root. Candidate validation retains its stronger disposable `HOME`, XDG, state, Guide Packet, source, install, credential, and external-automation boundary. The production overlap guard is unchanged.

## Installed-validation port isolation

The real installed autopilot loads `.env` before it invokes `npm test`. Node preserves an already-exported environment value instead of replacing it from a later `--env-file`, so launcher-copy tests could inherit the installed `PORT=8787` instead of using the unique ephemeral port written into each copied runtime's `.env`. The exact contaminated reproduction timed out waiting for the synthetic validation and promotion attempts; the same test bytes passed 4/4 when invoked without the installed `.env`.

The liveness harness now removes only the five keys owned by its copied `.env` (`INNER_SIGNAL_MODE`, `PORT`, `LEDGER_MODE`, `DEV_AUTOMATION_ENABLED`, and `GUIDE_PACKET_ROOT`) before it starts the copied launcher. A deterministic regression supplies an invalid parent `PORT` and still requires the complete validation-failure recovery surface to pass on the fixture port. No production environment loader, server port behavior, assertion deadline, or recovery endpoint changed.

## Release gates

`main` and `stable` may advance only together, without force, after:

- ten consecutive focused promotion-recovery passes;
- five consecutive complete liveness-file passes;
- contaminated-parent-port liveness repetitions and a complete suite run with the installed `.env` inherited;
- direct diagnostic/progress sync tests;
- the complete package test suite;
- 12/12 guide-graph regressions;
- `npm run verify` and immutable Guide Packet archive checks;
- whitespace and working-tree checks;
- a real-Git transactional bootstrap campaign covering empty install, current/no-op, stable upgrade, forced activation rollback, retry, and byte-identical private sentinels;
- independent review with no unresolved Critical or Important finding.

After matching remote commit/tree verification, the real installer runs once against `stable` with launch suppressed. The installed launcher is then started once with test-owned desktop stubs and must sustain loopback health, both status surfaces, and recovery ZIP export for five minutes without changing its installed version/commit or leaving children after controlled shutdown.
