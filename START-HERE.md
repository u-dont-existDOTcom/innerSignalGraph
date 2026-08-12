# Start here — Inner Signal v0.14.4

On French Zorin:

```bash
cd "$HOME/Téléchargements"
unzip -o inner-signal-runtime-v0.14.4-timezone-stable-validation.zip
./install-and-run.sh
```

The installer preserves your `.env`, browser/runtime state, Guide Packet candidate bytes, owner decisions, installed packet, rollback history, ledgers, and autonomous-development state. It replaces stale managed source cleanly, runs deterministic tests, then resumes the local runtime. Running the installer again is safe.

The browser opens automatically. Leave the terminal running; `Ctrl+C` stops the local server and development worker safely.

v0.14.4 makes Guide Packet ZIP validation independent of the computer's timezone and prevents tests from writing into the preserved r01/r02 fixture directories. The r01 and r02 candidate archives remain byte-for-byte unchanged, and production remains on r5.

A001 validation is now stage-aware. A completed Claude extraction is checkpointed before the Codex audit. A retryable Codex failure retries only Codex once; a restart resumes the audit without repeating Claude. A Codex audit failure cannot trigger Fable, and authentication expiry opens the official Codex browser login once before automatic resume. The terminal and local status show the normalized cause without requiring a log upload.

The Fable extraction completed by the failed v0.14.2 run was never checkpointed by that version, so the first stage-aware validation on v0.14.3 or later may need to repeat it once. Future completed extractions are preserved for resume.

Open **Guide Packet** to review the corrected r02 candidate. Its guide prose is still the unchanged r01 article revision; r02 supplies complete model-readable canonical source, attached Vagal Blitz page-5 evidence, and an explicit graph-owned advanced-release safety block with five affected regressions. The original r01 candidate is retained unchanged. No candidate becomes production therapy policy until you approve every substantive behavioral decision and click **Install approved packet**. You can keep the current behavior or request an edit one decision at a time.

The Overall Development panel remains visible while packet verification, Opus compilation, Codex review, conditional Fable adjudication, recovery, install, rollback, or autonomous repair is running. Guide Packet status no longer inherits stale development-repair instructions. Interrupted model stages resume automatically from the staged packet, and status/export remain available if validation or promotion fails. Routine engineering proceeds automatically; only genuine therapy/safety/framework decisions or authentication/permission requirements stop for you.

Use **Export recovery ZIP** if troubleshooting is needed. It contains deterministic recovery evidence, including the safe A001 attempt ledger, but no A001 clinical checkpoint, browser chat, therapy reasoning, raw provider output, credentials, or API keys.
