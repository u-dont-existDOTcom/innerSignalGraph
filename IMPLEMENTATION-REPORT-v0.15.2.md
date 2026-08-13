# Inner Signal v0.15.2 implementation report

Date: 2026-08-13

## Outcome

v0.15.2 fixes the nondeterministic recovery-readiness regression that blocked the v0.15.1 transactional installation. The failure was in the test's observation timing: the production launcher did restart the preserved server, but the test treated “promotion attempted” plus a fixed 500-millisecond delay as proof that loopback HTTP was already ready. The release does not change production recovery behavior or increase a timeout.

The deterministic regression now holds the second server start, proves health is unavailable during that controlled transition, releases it, and waits on the public `/health` condition while asserting that the launcher remains alive. It then retains the complete development-status, Guide Packet status, and recovery-ZIP contract. Liveness fixtures own recording no-op desktop commands and exact process groups, so tests cannot open real browser tabs, must prove both open attempts occur after the launcher's health-established ready marker, and cannot leave launcher descendants behind.

Direct-checkout diagnostic CLI fixtures also receive disjoint synthetic source roots. The production root-overlap guard remains unchanged.

The root `THERAPY-LESSONS` log now records timestamped, evidence-linked improvements in therapy-prompt handling. It distinguishes four current runtime lessons from all five substantive lessons in the r02 Guide Packet, each of which is explicitly `candidate-awaiting-owner` and not active policy. A structural validator and seven regression cases make the log cumulative and require it to stay synchronized with the latest candidate's owner decisions. This documentation addition does not approve or install the candidate guides.

## Intake and retained evidence

No `AGENTS.md` exists in this checkout or its searched parent scope. The checkout was initially clean on local `stable` at candidate commit `62418292489cf5c764e767f8b010b98b3e14c71c`; `origin/stable` also pointed there. Local `origin/main` and `origin/runtime-diagnostics` were stale at `b3f82e31003c4669a6136695cd2174c09eda61b6`. Detached candidate worktree registrations under `/tmp/inner-signal-git-update-*` were inspected and left untouched. The installed runtime at `/home/joel/Téléchargements/inner-signal-runtime` was the preserved v0.14.4 runtime.

The installed runtime's `git-update-status.json` is the authoritative safe summary for the failed v0.15.1 candidate validation. It records:

- status `failed-safe`, stage `package-tests`, and action `KEEP_CURRENT_RUNTIME`;
- candidate and available commit `62418292489cf5c764e767f8b010b98b3e14c71c`;
- 242 tests, 241 passed, one failed;
- `tests/runtime-service-liveness.test.mjs:191`, “promotion failure restarts health, status, and recovery ZIP instead of abandoning the browser.”

The raw v0.15.1 candidate stdout/stderr was not retained by the updater; only its bounded safe summary was persisted. The complete logs that do remain under `.inner-signal-autopilot/run-20260812T183455Z/tests.stdout.log` and `tests.stderr.log` belong to an earlier installed-runtime v0.14.4 validation, not to the v0.15.1 candidate. They were read completely: stdout reports 193 tests, 191 passed, and two older marker-timeout liveness failures; stderr is zero bytes. This distinction prevents those older failures from being misattributed to incident `3a1e7d232f4c5b0fe8bd9391e4fade1a86d646786d79e13bd4145937f4654f31`.

The local diagnostic outbox was empty. Its receipt records that the incident was synced to `runtime-diagnostics` in commit `58ddaea6174d7a89761d2ac30b0f1a3c03a7b91b`; `diagnostic-sync-status.json` reports two synced and zero pending. The real incident is retained for audit.

## Reproduction and classification

The focused test could pass in isolation. Eight simultaneous focused reproductions produced six failures and two passes. Every failure was the same exact assertion:

```text
TypeError: fetch failed
tests/runtime-service-liveness.test.mjs:191
```

Line 191 was the first `fetch('/health')` after a fixed 500-millisecond sleep. The test had waited only for a marker written when promotion began. That marker did not cover server termination, failed promotion return, recovery-server start, or HTTP readiness.

The preserved incident-era temporary runtime provides independent timing evidence:

- promotion marker: `2026-08-12T20:07:19.649Z`;
- recovery server listening log: `2026-08-12T20:07:20.710Z`;
- ready URL record: `2026-08-12T20:07:20.933Z`.

The fixed probe could run around `20:07:20.149Z`, roughly 0.78 seconds before the public ready record. The server later listened on the same configured port. Its logs contain no `EADDRINUSE`, bind error, or crash. The exact classification is therefore a nondeterministic readiness race in the test, not a production recovery defect and not a process/port cleanup defect.

## Implemented deterministic contract

The promotion-specific Node wrapper now fails the real promotion subprocess and counts real `serve.mjs` starts. It blocks the second start before Node can listen and publishes only a test-owned waiting marker. The regression requires the launcher to remain alive and the public health request to reject while held. After release, it polls `/health` and checks both `exitCode` and `signalCode` on every attempt. Only HTTP 200 establishes readiness.

After health, the regression still requires:

- `/v1/dev/status` HTTP 200;
- `/v1/guides/status` HTTP 200;
- `POST /v1/debug/export` HTTP 200;
- `application/zip` content type and a body larger than 1000 bytes.

Every liveness wrapper directory supplies executable no-op `xdg-open` and `gio` files. The stubs acknowledge each invocation and record whether `.inner-signal-autopilot/current-url.txt` exists. The promotion regression synchronizes on the initial open, removes that health-established marker while the second server is deliberately held, requires that no second open occurs in the held state, and then requires the recovery open to observe the marker rewritten after public health succeeds.

Teardown sends `SIGTERM` only to the test-owned detached process group, checks both the launcher leader and the negative-PID group, escalates only that group if either remains, and asserts that the complete group disappears. A deterministic regression covers a leader that has already exited while a descendant remains. Runtime fixture copies exclude exact top-level Git, Codex/agent workspace-control, dependency, runtime-state, and temporary roots; this fixes an observed `ENOENT` race when the environment replaced `.agents` during a concurrent copy. A final process scan found no matching `run-autopilot.sh`, `serve.mjs`, `sync-progress.mjs`, or new liveness-test process. Older retained `/tmp/inner-signal-liveness-*` evidence predates the green cleanup implementation; the incident-era directory was not deleted.

Six diagnostic/progress CLI tests had separately failed when run directly from the checkout because the CLI treated that checkout as its installed root while inheriting the same production source-root default. Each affected fixture now pins `INNER_SIGNAL_GIT_SOURCE` to a distinct nonexistent fixture-local path. Direct execution passes without weakening production overlap validation. The real updater's disposable candidate environment subsequently passed the same package tests during every transactional validation cycle.

## Installed validation follow-up

The first published v0.15.2 tree was installed by the real installer exactly once and then observed through one test-owned application launch. Eleven samples over five minutes all returned HTTP 200 for health, development status, Guide Packet status, and recovery ZIP export; the launcher was then stopped as one owned process group with no survivor. That health harness incorrectly exported four installer-only Git variables into the foreground launch. The background package validation inherited them and reported 247/250 even though the application remained healthy. Running the three affected installed tests with those four variables absent passed 9/9, isolating that harness contamination from the released production path.

A subsequent validation-only run used the supported `--no-launch` path with those Git variables absent. The Git-bootstrap regression became green, but the two launcher liveness scenarios reported 248/250 with exact marker assertions:

```text
validation attempt did not become true within 15000 ms
promotion attempt did not become true within 15000 ms
```

The installed autopilot loads `.env` before spawning `npm test`, so its child inherited `PORT=8787`. Node's environment-file handling does not replace an already-present variable, and the copied launchers therefore ignored the unique ephemeral ports in their own `.env` files. The identical installed liveness file passed 4/4 without the installed environment and failed 2/4 when invoked with it. Supplying only the inherited port reproduced the difference.

The corrected harness deletes only the five runtime settings written by `copyRuntime` before starting its copied launcher. A deterministic regression gives the parent an invalid port value and still requires public recovery health, both status surfaces, the recovery ZIP, browser-stub ordering, and complete process teardown. The 15-second condition deadline and all production configuration/recovery behavior remain unchanged. This finding is a deterministic test-process environment-isolation defect, not evidence of an unhealthy installed server.

On the corrected source tree, ten consecutive focused runs with the installed `.env` inherited passed 4/4 each, with durations from 8.23 to 10.47 seconds. The complete suite under that same installed environment then passed 250/250 in 26.242 seconds. These runs used only test-local `xdg-open`/`gio` stubs. The normal release gates and transactional update are repeated on the committed correction before the refs advance again.

## Therapy prompt lessons

`THERAPY-LESSONS` is intentionally about response quality rather than engineering activity. Its active entries record that prompts should preserve the user's exact distinctions before assigning internal roles; distinguish adverse credibility evidence from missing evidence and from arousal; use reviewed, deep, or forensic processing according to structure, ambiguity, and safety; and produce one focused next move without generic caution that the case variables did not trigger.

The five r02 candidate entries record delayed post-somatic reassessment, resource-aware age/agency clarification, earlier use of one bounded adult function, credibility repair before deep dialogue, and a hard block on optional advanced release when physical or regulatory risk is present. Each entry says it is awaiting owner approval and not active runtime policy.

`scripts/verify-therapy-lessons.mjs` discovers the latest bundled candidate by packet revision and matches each substantive owner card by `(packetId, decisionId)`. It rejects missing, duplicate, malformed, wrong-packet, predating, invalid-state, or falsely active entries. Packet-scoped identity allows older timestamped lessons to remain in the cumulative log when a later packet reuses names such as `decision-1`. The repository verifier runs this contract before compiling graphs.

## Verification evidence

The reviewed implementation before this report was commit `cb8114ee994217710f907d36526c8b5b934df5dd`, tree `33385ba1b67a905c103f2f76b78147b08b8c5e3c`.

Fresh green evidence on that tree:

- focused promotion-recovery regression: 10 consecutive passes;
- complete runtime-service-liveness file: five consecutive runs, 4/4 each;
- direct diagnostic/progress sync file: 18/18 passed;
- therapy lesson contract: seven focused tests passed and 5/5 substantive latest-candidate decisions tracked with four active runtime lessons;
- `npm test`: 250/250 passed, zero failed, 53.138 seconds;
- `npm run graph:test`: 12/12 cases passed;
- `npm run verify`: final `PASS`, including compilation, packet fixtures and hashes, syntax, package tests, immutable Guide Packet archives, deterministic A001/H001 campaigns, web smoke, dry and fake-CLI autopilot, fingerprint, hygiene, and autonomous-development checks;
- generated `H001-MOCK-RESULT.json` ledger UUID and guide-bundle compile timestamp were compared and restored exactly after verification; no semantic artifact change was retained;
- `git diff --check` passed;
- final process scan found no matching live runtime or test process.

The real transactional exercise cloned this exact candidate into a temporary bare origin and clean source checkout, and used `runGitUpdate` with its real subprocess runner and default candidate validator. Results:

```json
{
  "cleanInstall": "UPDATED:installed",
  "current": "CURRENT:current",
  "activationFailure": "FAILED_SAFE:atomic-swap",
  "retry": "UPDATED:installed",
  "preservedSentinels": 7,
  "poisonGitHubInvoked": false
}
```

The expanded pre-report transaction at commit `b66ac137c2208d7b16a41a8b361b05d3848e6aca` ran the then-current 244-test package validator and 12-case graph validator for each candidate transition. The injected activation failure restored the exact prior commit marker and omitted the candidate-B file; retry installed candidate B. Sentinels covering `.env`, autopilot and Guide Packet state, development state, ledgers, and data remained byte-identical. A poisoned ambient GitHub command was never called. The documentation-complete release tree is required to repeat this real transaction before publication; its exact observed commit and updated test count belong in the final operator handoff.

Independent review used base `62418292489cf5c764e767f8b010b98b3e14c71c`. The first review identified missing opener-order evidence, leader-only teardown verification, a contradictory transaction sequence, and incorrect derived-version wording. A second pass identified that opener readiness still needed invocation evidence, corrected one active tiering lesson, and requested packet-scoped decision identity plus negative validator coverage. All findings were addressed. The final read-only review at `cb8114ee994217710f907d36526c8b5b934df5dd` reported no Critical, Important, or Minor findings and assessed the release ready. Publication remains blocked until the exact documentation-complete tree passes the complete gates again.

## Publication and installed-health contract

The live preflight on 2026-08-13 found both `main` and `stable` at `62418292489cf5c764e767f8b010b98b3e14c71c`, with `runtime-diagnostics` at `b526efe471e1d94ad099046a9e6d22d1e51b70a7`. The final preflight must observe the same release refs. Publication is one non-forced atomic push of the exact verified local `HEAD` to both `main` and `stable`; a post-push fetch must prove equal commit IDs, recursive trees, and zero diffs. Diagnostic history is not rewritten.

Only after that proof, the real installer is invoked exactly once with `INNER_SIGNAL_INSTALL_ONLY=true`. It must install version `0.15.2`, record the published commit, and preserve private-state hashes. The installed launcher is then started once with test-owned no-op desktop commands. Public health, development status, Guide Packet status, and a nontrivial recovery ZIP must remain available for five minutes while version and commit remain unchanged. Controlled shutdown must leave no owned server or progress child. Exact post-publication commit, tree, installer, preservation, and sustained-health observations are reported in the final operator handoff so a documentation-only follow-up commit cannot move `stable` beyond the installed commit.
