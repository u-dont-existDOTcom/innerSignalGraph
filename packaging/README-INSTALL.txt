Inner Signal Runtime v0.14.4 — Timezone-Stable ZIP Validation

Install on French Zorin:

  cd "$HOME/Téléchargements"
  unzip -o inner-signal-runtime-v0.14.4-timezone-stable-validation.zip
  ./install-and-run.sh

The atomic installer preserves .env, ledgers, browser/runtime data, exact Guide Packet candidate bytes, owner decisions, stage attempts, installed policy, rollback history, and autonomous-development state. It runs the complete runtime test suite and production guide-graph regressions before launching the normal one-command autopilot. Re-running it is safe.

v0.14.4 fixes the installation rollback caused by timezone-sensitive ZIP header timestamps. It also prevents tests from writing rebuilt packets into the immutable r01/r02 fixture directories. The original r01 and corrected r02 candidate archives remain byte-for-byte unchanged, and production remains on r5.

A001 stage-aware recovery from v0.14.3 remains intact: completed extraction is checkpointed, retryable Codex audit failure retries only Codex, restarts resume the audit without repeating Claude, Codex failure cannot trigger Fable, and safe local status replaces manual log collection.
