# Journal calibration retry (2026-10-01)

## Why

A journal import stopped at the real calibration gate after three unresolved extraction cycles on its first calibration unit (`CALIBRATION_REPAIR_REQUIRED`, reason `CALIBRATION_EXTRACTION_UNRESOLVED`). A resumed `run` correctly preserves that failure, but changing effort cannot help while the old job identities replay its saved answers. The operator needs an explicit retry that keeps calibration mandatory.

## Plan

- Add `journal:import -- recalibrate --config <cfg> [--env-file ...]`. Apply the same run-config checks before loading env files or signing in. Accept only a failed calibration; otherwise return `JOURNAL_RECALIBRATE_NOT_FAILED`.
- Increment `calibration_epoch` from zero, record the prior status and reason with a timestamp in `calibration_history`, reset calibration and its blocker, and remove only calibration units from `completed_units`. Preserve the archive, visual results, frozen semantic batch plan, and all other units.
- Suffix calibration request and review identities with `:epoch:<n>` for n > 0, including bounded attempts and hardest attempts. Keep epoch-zero identities unchanged. Resolve every unit-record read and write through one current-epoch helper; prior records remain write-once and stored.
- Report only the epoch and history length in summary/status. Test a failed retry that succeeds, a second retry, epoch-zero identity compatibility, config/state refusals, visual reuse, and current calibration versus ordinary unit-record reads using synthetic data.

This is an implementation on a task branch. CI runs the complete package gate after the runner commits and pushes; no installation or product-policy decision is part of this retry.
