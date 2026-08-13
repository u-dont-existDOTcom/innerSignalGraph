# Inner Signal v0.15.2 Deterministic Recovery Readiness Design

Date: 2026-08-13
Baseline commit: `62418292489cf5c764e767f8b010b98b3e14c71c`
Target release: Inner Signal v0.15.2
Scope: launcher recovery verification, test-environment isolation, and a source-grounded therapy-prompt lesson log; no therapy, hypnosis, guide, model-role, privacy, update-transaction, or owner-gate behavior changes

## Incident and exact failure

The v0.15.1 transactional candidate validation passed 241 of 242 tests. Incident `3a1e7d232f4c5b0fe8bd9391e4fade1a86d646786d79e13bd4145937f4654f31` identified:

```text
tests/runtime-service-liveness.test.mjs:191
promotion failure restarts health, status, and recovery ZIP instead of abandoning the browser
```

Load-amplified focused reproduction produced the exact failure:

```text
TypeError: fetch failed
```

The failed operation is the first `/health` request in `assertRecoverySurface`. The test waits for the promotion command's attempt marker, sleeps a fixed 500 milliseconds, and then performs a single request. The marker proves only that promotion began. It does not prove that promotion cleanup completed, the failed promotion returned, the preserved server restarted, and loopback health became ready.

The preserved incident-era temporary runtime proves the distinction. Its promotion marker was written at `20:07:19.649Z`; its restarted server log was written at `20:07:20.710Z`; and its ready URL file was written at `20:07:20.933Z`. The fixed probe could therefore run around `20:07:20.149Z`, before readiness. The same runtime subsequently listened successfully on the same port, and its boot log contains no `EADDRINUSE`, crash, or bind failure.

## Classification

This is a nondeterministic test readiness race, not a production recovery bug and not a stale process/port cleanup defect.

- Production `start_server` already polls both loopback health addresses and returns only after an HTTP-successful response.
- The promotion-failure branch calls `cleanup`, attempts promotion, records the failed signature, starts the preserved server, starts the progress watcher, opens the browser, and resumes the development supervisor.
- Incident-era evidence shows that sequence reached a healthy restarted server on the original port.
- Concurrent focused runs amplify the race and reproduce `fetch failed`; isolated runs pass.
- No reproduction or preserved log reports `EADDRINUSE` or a surviving competing server.

The previous test asserted the correct recovery surface but used the wrong readiness event.

## Considered approaches

### Increase the 500-millisecond delay or the test timeout

Rejected. Any fixed delay can fail on a loaded machine and does not establish readiness. A larger timeout would hide the causal mistake without improving the assertion.

### Add a production-only recovery-ready marker

Rejected. It would add a runtime interface solely for test coordination even though the public `/health` endpoint is already the authoritative readiness signal.

### Use condition-based readiness with a deliberately delayed recovery restart

Selected. The test will make the race deterministic by delaying only the post-promotion recovery server. It will then wait on the real public health condition while continuously checking that the launcher process remains alive. Once health is ready, it will assert the development status endpoint, guide status endpoint, and nontrivial recovery ZIP exactly as before.

## Test architecture

`tests/runtime-service-liveness.test.mjs` will own all external side effects of its launcher copies:

1. A test-local command directory will provide inert `xdg-open` and `gio` executables. The real desktop browser must never open during package validation.
2. The promotion wrapper will count `serve.mjs` starts and hold only the recovery start until an explicit test-controlled release file exists.
3. The test will wait until that delayed recovery start is observed, prove the launcher remains alive while recovery is unavailable, release the restart, and poll `/health` until it returns HTTP 200.
4. Connection-refused responses remain expected only during the bounded transition. A launcher exit, a non-transient endpoint error after readiness, a wrong status code, a missing status surface, or an undersized/non-ZIP recovery response remains a hard failure.
5. Test teardown will terminate the exact detached launcher process group, verify it exited, and remove its temporary runtime root. It will never target unrelated host processes.

The desktop stubs will record their calls. While the second server start is deliberately held, the regression must see exactly the initial browser-open call. A second call is allowed only after the recovery health condition has succeeded. Teardown will probe the complete process group, not merely the launcher leader, and will fail if any owned descendant survives.

This regression fails deterministically with the fixed-delay probe and passes only when the assertion synchronizes on real readiness. It does not weaken production checks or extend the test's 30-second ceiling.

## Hermetic direct-suite environment

The candidate validator supplies disjoint source and installed roots. Direct `npm test` from the source checkout does not. Six diagnostic CLI tests currently inherit the production default source root while passing the checkout itself as `installRoot`, triggering `sourceRoot and installedRoot must not overlap` before their intended assertions.

Every diagnostic CLI subprocess fixture will explicitly provide a nonexistent source root under its own temporary fixture directory. The CLI already passes the checkout as its installed root, so the two roots are then unambiguously disjoint. This matches the production safety invariant and makes direct checkout tests independent of ambient shell state. The production root-overlap guard remains unchanged.

The installed autopilot adds a second hermeticity requirement: it loads the installed `.env` before spawning `npm test`. Node does not replace an environment variable that is already present with a value from `--env-file`. Consequently, a launcher-copy fixture that writes an ephemeral `PORT` into its own `.env` can still inherit the installed runtime's port and never reach its synthetic validation or promotion boundary.

Launcher-copy subprocesses will therefore remove only the runtime configuration keys explicitly written by `copyRuntime` before starting `run-autopilot.sh`. The copied `.env` remains the single authority for mode, port, ledger mode, development automation, and Guide Packet root. The recovery test will inject a malformed parent `PORT` so this boundary is exercised in an ordinary focused run. This is test-environment isolation; production configuration precedence and all existing time ceilings remain unchanged.

The self-update recursion marker has an even narrower lifetime. `INNER_SIGNAL_UPDATE_APPLIED=1` must survive only through the re-executed wrapper's second Git update check; it must be absent from package validation, runtime servers, development workers, and nested launcher fixtures. The wrapper will unset it immediately after that check. The launcher regression will inject a false parent marker, require that a fresh fixture still restarts exactly once, and require the validation child to observe no marker.

## Therapy prompt lesson log

The user requires a visible root-level `THERAPY-LESSONS` log showing what has been learned about handling therapy prompts better since the corrected guides were uploaded. This is an audit artifact, not a change to active therapy policy.

Three representations were considered. Free-form prose alone is readable but can silently drift from Guide Packet decisions. Machine-only JSON is enforceable but poor for a human progress review. The selected form is readable timestamped prose with a small structured metadata comment per lesson. Each entry states its evidence source and activation status.

The first update will cover both the prompt-handling lessons already implemented in the current runtime and all five substantive r02 candidate decisions. Candidate entries must say `candidate-awaiting-owner`; they must not imply the unapproved packet is installed. A repository validator will load the latest bundled candidate manifest and owner-decision cards, parse the log metadata, and require exactly one matching timestamped pending entry for every substantive owner decision. Missing, duplicate, malformed, or falsely active entries fail. `npm run verify` will execute that validator so a future substantive Guide Packet update cannot pass the release gate without updating the lesson log.

## Release and documentation contract

v0.15.2 will include:

- this approved design specification;
- an implementation plan with exact RED/GREEN and release commands;
- an architecture/recovery note at `docs/GIT-UPDATE-AND-DIAGNOSTIC-SYNC-v0.15.2.md`;
- `IMPLEMENTATION-REPORT-v0.15.2.md` containing the local incident evidence, exact assertion, test counts, repeated-run results, transactional bootstrap results, release preflight refs, and the exact post-publication installer/health verification contract;
- a version update in `package.json`, derived-version verification through unchanged `src/core/runtime-version.mjs`, and consistent related user-facing release references;
- the root `THERAPY-LESSONS` prompt-handling log and its Guide Packet synchronization validator.

The release must not advance `main` or `stable` until all focused repetitions, the complete direct `npm test`, graph regressions, package verification, repository release gates, and the real local transactional bootstrap simulation pass. Publication must use non-forced compare-and-swap ref updates and finish with `main` and `stable` at the same verified commit and recursive tree.

After publication, the real installer will run once against `stable`. Verification requires the installed version and commit markers to identify v0.15.2, `/health` plus status and recovery endpoints to remain healthy after the installer returns, and no test browser tabs or leftover test launcher processes. Because those observations occur after the immutable release commit is published, their exact values belong in the final operator handoff rather than a second documentation commit that would move `stable` beyond the installed commit.

## Non-goals

- No change to launcher production timeout values.
- No increase to test deadlines as a substitute for fixture environment isolation.
- No suppression, deletion, skip, or weakening of the failing test.
- No change to Git update atomicity, rollback, state preservation, diagnostic privacy, or progress delivery.
- No therapy, hypnosis, guide graph, Guide Packet, model entitlement, or owner-decision changes; the lesson log distinguishes current behavior from unapproved candidate lessons.
