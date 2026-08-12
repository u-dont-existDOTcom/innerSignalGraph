# Inner Signal v0.15.1 implementation report

Date: 2026-08-12

## Outcome

v0.15.1 repairs the environment leak that made the v0.15.0 Git bootstrap fail on the configured machine, makes bootstrap failure truthful, and adds a bounded privacy-safe current-progress document on `runtime-diagnostics`. Therapy behavior, hypnosis contracts, guide graphs, Guide Packet owner gates, model roles, and installed production policy are unchanged.

## Root cause and reproduced failures

The package validator correctly supplied a disposable `AUTOPILOT_STATE_DIR`, but child tests inherited it. The updater CLI regression overrode its source and install roots without overriding that state root. It therefore wrote the synthetic `candidate contract fails` incident into the validator's ambient outbox. A launcher-liveness test inherited the same state and could invoke the real diagnostic flusher through the user's authenticated GitHub CLI.

The initial RED evidence was:

- updater isolation reproduction: missing fixture `git-update-status.json` (`ENOENT`) while the ambient external root received the synthetic failure payload;
- progress delivery tests: missing `syncRemoteProgress` and `queueRemoteProgressSnapshot` exports;
- watcher tests: missing `src/cli/sync-progress.mjs`;
- lifecycle/UI tests: no runtime-progress lifecycle record, companion ownership, or progress status surface;
- realistic candidate validation after the first isolation change: the fake transport test returned `disabled` instead of `synced`, exposing that the tests themselves still relied on inherited ambient automation state.

The final test-harness correction makes fake transports explicitly owned by their tests while the candidate sandbox keeps every real external transport and credential unavailable.

## Implemented contract

Candidate validation now receives disposable `HOME`, XDG, GitHub CLI, autopilot, Guide Packet, ledger, development-candidate, job, and promotion roots. GitHub, OpenAI, Anthropic, Claude Code, and Codex credential variables are removed; Git prompts, Git auto-update, and remote diagnostic/progress delivery are disabled; source/install defaults and the GitHub command point to unavailable paths. Validation runs on a disposable copy, and the installation staging tree is rebuilt from the exact detached commit after validation so test artifacts cannot enter the runtime.

`git-update.mjs --bootstrap` succeeds only for `CURRENT` or `UPDATED`. `DEFERRED` and `FAILED_SAFE` exit nonzero, and `install-from-git.sh` does not launch an older preserved runtime as though the requested release had installed.

The launcher owns one progress companion and terminates it during every cleanup/restart path. It maintains only:

```text
progress/<machineId>/current.json
```

The remote object has exactly `format`, `machineId`, `observedAt`, `runtime`, `progress`, `update`, `diagnostics`, and `privacy`. It is built field-by-field from generated codes, exact enums, validated stage/status/action codes, booleans, bounded integers, ISO timestamps, release versions, Git commit IDs, and the existing random local UUID. It excludes task names and IDs, blocker/analysis/directive prose, chat, therapy or hypnosis state, guide content, prompts, model output or reasoning, raw logs, credentials, host/user/network identity, absolute paths, PIDs, and hashes derived from excluded material.

Meaningful allowlisted changes are coalesced to at most one write per 30 seconds. Unchanged state refreshes every five minutes. GitHub Contents API replacement requires the current blob SHA. A failed write retains only the newest mode-`0600` `progress-outbox/current.json`; delivery never blocks the server, foreground validation, or development worker. The local browser API exposes only sanitized delivery status and assessment, never the remote payload body.

## Verification evidence

The implementation-review target before adding this report was local commit `d2680c360c9889d949563e93749cc8778ac420d1`, tree `7c5bdfd31691be521215d6b2ca17aec5e8090fda`. Its v0.15.0 base tree was `faf7b25bae601fa1c598743b817dab6df1659012`, identical to the live `main`/`stable` v0.15.0 tree checked immediately before release finalization.

Green results on the implementation tree:

- focused privacy/progress suite: 27/27 passed;
- focused isolation/bootstrap/launcher suite: 21/21 passed;
- candidate-sandbox fake-GitHub suite: 18/18 passed;
- candidate-sandbox launcher-liveness suite: 3/3 passed;
- `npm test`: 242/242 passed, 0 failed;
- `npm run graph:test`: 12/12 passed;
- `npm run verify`: `PASS`, including package hygiene and deterministic release gates;
- `git diff --check 155f24d..HEAD`: clean;
- direct release review: no blocking correctness, privacy, lifecycle, or delivery findings.

A full transactional simulation used a real local Git repository and bare remote under paths containing `Téléchargements`. It exercised clean install, current/no-op, a second stable update, and forced activation rollback through the default candidate validator. Result:

```json
{
  "ok": true,
  "cleanInstall": "UPDATED",
  "noOp": "CURRENT",
  "upgrade": "UPDATED",
  "activationFailure": "FAILED_SAFE:atomic-swap",
  "preservedSentinels": 8,
  "ambientStateUntouched": true,
  "poisonGitHubUntouched": true
}
```

Eight private sentinels remained byte-identical. A decoy ambient `AUTOPILOT_STATE_DIR`, decoy GitHub/model credentials, and a poison GitHub executable were untouched. The rollback preserved the prior installed runtime.

No live model-provider validation was run for this release gate: candidate validation intentionally removes model credentials and uses deterministic fake-model fixtures. This verifies isolation and release behavior without consuming accounts or exposing private state; it does not claim current live provider availability.

## Publication and cleanup method

The documentation-complete tree is reverified before publication. The GitHub release commit is created from exact local blobs and modes on top of the live v0.15.0 tree. Publication is allowed only if GitHub's returned tree SHA equals the final local `HEAD^{tree}` and both live refs still match the preflight commit. `main` is then fast-forwarded, followed by `stable`, with force disabled.

After publication, the exact known synthetic file

```text
diagnostics/a6e206af-036d-4343-8b64-0efea6212f23/1b4720fc2b8ce31dd27545cb6bef6261cebd94e07c08aca5f0cb730c01a6a237.json
```

is deleted in a normal commit on `runtime-diagnostics`; branch history is not rewritten. No synthetic progress snapshot is created. Final verification requires `main` and `stable` to share one commit whose recursive tree matches the final local tree blob-for-blob and mode-for-mode, and requires the diagnostics head to contain neither that synthetic incident nor any test progress file.
