# Inner Signal v0.15.0 — Git Update and Diagnostic Sync

## Outcome

Inner Signal no longer depends on routine release-ZIP downloads or diagnostic-ZIP uploads. One authenticated private GitHub repository carries three isolated workflows:

- `main` receives reviewed development commits;
- `stable` points at the exact fully verified commit an installed runtime may adopt;
- `runtime-diagnostics` receives append-only, privacy-safe incident JSON and is never merged into source.

The source checkout lives at `~/Téléchargements/innerSignalGraph`; the installed runtime lives at `~/Téléchargements/inner-signal-runtime`. Keeping them separate allows Git to fetch and stage safely while the current runtime continues serving locally.

## One-time bootstrap

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

The bootstrap opens at most one official browser login when authentication is absent, configures Git through `gh auth setup-git`, verifies push access to `u-dont-existDOTcom/innerSignalGraph`, fetches `stable`, and invokes the same transactional updater used by later launches. It never reads, copies, prints, or commits credential storage.

## Update transaction

1. Retry any queued safe incidents without blocking local startup.
2. Fetch `origin/stable` in the separate source checkout.
3. Resolve the exact candidate commit and create a detached temporary worktree.
4. Copy managed source while excluding `.git`, `.env`, `.inner-signal-autopilot`, `.inner-signal-dev`, `ledgers`, and `data`.
5. Run package tests and graph regressions with new empty temporary autopilot and Guide Packet roots.
6. If validation fails, retain the current runtime byte-for-byte and queue the safe test summary.
7. If validation passes, hash the preserved private inventory, overlay it into staging, and require the staged hash to match.
8. Record the exact installed commit and managed-tree integrity hashes.
9. Rename the current runtime aside, rename staging into place, restore the prior runtime if the second rename fails, and restart once.

The updater never runs `git reset --hard` against the installed runtime and never tests a candidate after private state has been overlaid.

## Remote diagnostic contract

Every uploaded `inner-signal-remote-diagnostic-v1` object has exactly these top-level keys:

```text
format
incidentId
machineId
createdAt
runtime
update
failure
tests
integrity
privacy
```

Allowed evidence is limited to runtime/version commits, update status, generated stage/class/action codes, numeric exit/count fields, bounded failed-test names, project-relative `tests/...` locations, uppercase error codes, safe scalar actual/expected values, and SHA-256 integrity fields.

The contract excludes browser chat and user messages; therapy case state; hypnosis content; Guide Packet bodies and prose; model prompts, output, or reasoning; development cases; raw stdout/stderr; `.env`; API keys, OAuth material, cookies, tokens, or credential stores; usernames, hostnames, IP addresses, hardware identity, and absolute home paths.

`machineId` is a random UUID stored mode `0600` in private runtime state. `incidentId` is a SHA-256 over stable allowlisted fields and excludes `createdAt`, making repeated failures and retries idempotent. Pending JSON is atomically written to `diagnostic-outbox`; confirmed delivery writes a local receipt before the pending file is removed. A collision with different remote bytes is never overwritten.

## Local status

The terminal and Overall Development panel expose only current/update/deferred/failed-safe state, abbreviated installed and available commits, diagnostic delivery state, branch/path, pending count, and last-sync time. Authentication material and encoded incident bodies are never rendered.

## Unchanged product policy

This infrastructure release does not alter guide prose, graph routing, therapy behavior, hypnosis contracts, owner decisions, candidate approval, or installed production r5 policy. Guide Packet candidates remain owner-gated.
