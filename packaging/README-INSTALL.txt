Inner Signal Runtime v0.15.2 — Deterministic Recovery, Isolated Updates, Safe Diagnostics, and Progress

One-time French Zorin bootstrap:

  cd "$HOME/Téléchargements"
  gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
  gh auth setup-git
  gh repo clone u-dont-existDOTcom/innerSignalGraph innerSignalGraph -- --branch stable
  bash innerSignalGraph/packaging/install-from-git.sh

The source checkout and installed runtime remain separate. Future launches fetch and validate `stable` inside disposable home/config/state roots without real credentials, preserve every pre-existing private file byte-for-byte, install transactionally, and restart once only after success. Failed bootstrap exits nonzero instead of launching an older runtime as the requested release.

Use Node.js 24. The repository recommends patch 24.18.0 through `.nvmrc`, while the runtime accepts compatible Node 24 patch releases and rejects other major versions before creating runtime state.

Browser opening is local-only and argument-safe. Set `INNER_SIGNAL_BROWSER_EXECUTABLE` to one executable name or path when automatic discovery is unsuitable; command strings, flags, and shell fragments are rejected.

Failures are automatically reduced to a strict privacy-safe record and pushed to the separate `runtime-diagnostics` branch. One strictly allowlisted current-progress document is refreshed at most every 30 seconds after change and every five minutes while steady. GitHub outages keep only private retry state and never take down the local runtime. Routine release-ZIP downloads and diagnostic-ZIP uploads are unnecessary.

Guide Packet candidates, owner decisions, and production r5 policy remain unchanged and owner-gated.
