# Start here — Inner Signal v0.15.1

On French Zorin, run this once:

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

Complete the official GitHub browser login if it opens. The bootstrap verifies access to the private repository, installs the exact `stable` commit at `~/Téléchargements/inner-signal-runtime`, and starts Inner Signal. If the requested candidate cannot be verified, bootstrap exits nonzero and does not launch an older preserved runtime as though installation succeeded. Leave the terminal running; `Ctrl+C` stops the local server, development worker, and progress companion safely.

From then on, launch `~/Téléchargements/inner-signal-runtime/run-autopilot.sh`. Inner Signal automatically retries queued diagnostics, checks `stable`, validates updates inside disposable home/config/state roots without real GitHub/model credentials or private state, preserves `.env`, both private state trees, ledgers, data, Guide Packet candidate bytes, owner decisions, and production policy, then restarts once only when an update was installed.

When a deterministic failure occurs, Inner Signal creates a new allowlisted record and pushes it automatically to `runtime-diagnostics`. The record contains safe version, commit, stage, count, test-location, error-code, and hash evidence only. It excludes chat, therapy and hypnosis content, prompts, model output/reasoning, raw logs, credentials, environment values, usernames, hostnames, IP addresses, and home paths. If GitHub is unavailable, the incident stays in the private local outbox and retries on the next launch. You do not need to download a new release ZIP or upload a diagnostic ZIP.

The browser opens automatically. The Overall Development panel shows concise update, diagnostic, and progress-delivery status. The remote current-progress document refreshes after meaningful changes (coalesced to 30 seconds) and at least every five minutes while steady. It contains only generated stage/status/assessment codes, counts, booleans, timestamps, versions, and commit IDs—not task prose, chats, therapy/hypnosis state, prompts, model output/reasoning, logs, credentials, host identity, absolute paths, or PIDs.

Guide Packet r02 remains a candidate whose guide prose is the unchanged r01 article revision. The original r01 candidate remains byte-identical, production remains on r5, and no candidate becomes therapy policy until every substantive behavioral decision is approved and installed through the existing owner gate.

The optional **Export recovery ZIP** remains a local support tool. Routine failure delivery no longer depends on it.
