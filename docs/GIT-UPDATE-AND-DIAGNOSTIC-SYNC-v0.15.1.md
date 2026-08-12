# Inner Signal v0.15.1 — Isolated Validation and Remote Progress

## Outcome

v0.15.1 closes the environment leak that prevented v0.15.0 from validating on the configured machine, makes bootstrap failure truthful, and adds one bounded privacy-safe progress document to `runtime-diagnostics`. Therapy behavior, hypnosis contracts, guide graphs, Guide Packet owner gates, model roles, and installed production policy are unchanged.

## Candidate-validation boundary

Each candidate receives disposable `HOME`, XDG, GitHub CLI, autopilot, Guide Packet, ledger, development-job, candidate, and promotion roots. Candidate children see `INNER_SIGNAL_VALIDATION_SANDBOX=1`; automatic Git update and diagnostic delivery are forced off; real source/install defaults are replaced; Git prompts are disabled; and GitHub, OpenAI, and Anthropic credential environment variables are removed.

Tests that intentionally exercise update or delivery set every root explicitly and use a local bare remote or fake GitHub command. They cannot inherit an ambient `AUTOPILOT_STATE_DIR`, authenticated `gh`, or the default French Zorin checkout.

## Bootstrap semantics

Ordinary launch remains fail-safe: a fetch, authentication, or validation problem preserves and starts the last verified installed runtime. Bootstrap has a stronger contract. Only `CURRENT` and `UPDATED` are successful; `DEFERRED` and `FAILED_SAFE` exit nonzero, and `packaging/install-from-git.sh` does not launch a preserved older runtime as the requested release.

The one-time installation command remains unchanged:

```bash
cd "$HOME/Téléchargements"
command -v gh >/dev/null 2>&1 || { sudo apt-get update && sudo apt-get install -y gh; }
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
gh auth setup-git
if [[ -d innerSignalGraph/.git ]]; then
  git -C innerSignalGraph fetch --prune origin stable
  git -C innerSignalGraph merge --ff-only origin/stable
else
  gh repo clone u-dont-existDOTcom/innerSignalGraph innerSignalGraph -- --branch stable
fi
bash innerSignalGraph/packaging/install-from-git.sh
```

## Remote current-progress contract

The launcher starts and owns a companion process that stops during launcher cleanup. It builds `inner-signal-remote-progress-v1` field-by-field and updates:

```text
progress/<machineId>/current.json
```

The document has exactly `format`, `machineId`, `observedAt`, `runtime`, `progress`, `update`, `diagnostics`, and `privacy`. Allowed values are generated stage/status/action/assessment codes, booleans, bounded counts and elapsed seconds, ISO timestamps, release versions, and Git commit IDs.

It excludes task names and IDs, blocker/analysis/repair prose, browser chat, therapy or hypnosis state, guide content, prompts, model output/reasoning, raw logs, credentials, host/user/network identity, absolute paths, PIDs, and hashes derived from excluded material. `machineId` is the existing random local UUID.

## Scheduling and assessment

The companion polls every 30 seconds. Meaningful allowlisted changes are uploaded after at least 30 seconds from the prior successful write; unchanged state is refreshed every five minutes. Failed delivery retains only the newest mode-`0600` local snapshot for retry. It never blocks the server, foreground validation, or development worker.

- `ADVANCING`: live worker with recent allowlisted movement.
- `LONG_RUNNING_STAGE`: live legitimate stage with no allowlisted transition for at least 15 minutes; this does not by itself mean stuck.
- `WORKER_NOT_RUNNING`: work state says active but its local process is absent.
- `WAITING_FOR_HUMAN`: owner, authentication, permission, or canonical-input action is required.
- `BLOCKED`: bounded internal or automatic-recovery blocker.
- `COMPLETE` / `IDLE`: literal terminal or quiescent states.

GitHub updates use the Contents API with the current blob SHA. Incidents remain append-only; current progress is intentionally mutable while Git history retains earlier snapshots. The Overall Development panel exposes delivery status and assessment only, never the remote body.
