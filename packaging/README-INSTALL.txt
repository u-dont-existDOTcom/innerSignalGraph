Inner Signal Runtime v0.15.0 — Git-Native Updates and Safe Diagnostics

One-time French Zorin bootstrap:

  cd "$HOME/Téléchargements"
  gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
  gh auth setup-git
  gh repo clone u-dont-existDOTcom/innerSignalGraph innerSignalGraph -- --branch stable
  bash innerSignalGraph/packaging/install-from-git.sh

The source checkout and installed runtime remain separate. Future launches fetch and validate `stable`, preserve every pre-existing private file byte-for-byte while updating only Git automation metadata, install transactionally, and restart once only after success.

Failures are automatically reduced to a strict privacy-safe record and pushed to the separate `runtime-diagnostics` branch. GitHub outages keep the record queued privately for retry and never take down the local runtime. Routine release-ZIP downloads and diagnostic-ZIP uploads are unnecessary.

Guide Packet candidates, owner decisions, and production r5 policy remain unchanged and owner-gated.
