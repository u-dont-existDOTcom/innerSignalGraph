# v0.7.2 migration notes

`./run-autopilot.sh` preserves `.env`, creates a timestamped backup only when migration is needed, keeps Opus 5 primary, keeps Fable 5 authorized for escalation, and adds no API-key requirement.

The upgrade recompiles the guide graph on every run and invalidates incompatible v0.6 direct-therapy checkpoints. Browser-local v0.6 transcript and hypnosis data is migrated automatically to the v0.7 storage key.

- v0.7.2 adds `RESPONSE_RENDERER_MODEL=claude-sonnet-4-6` as a renderer-only experiment. Opus remains the normal reasoning model; Fable remains the escalation model.
- Existing v0.7.1 A001 reasoning can be re-rendered without repeating case extraction, candidate generation, critiques, or adjudication.
