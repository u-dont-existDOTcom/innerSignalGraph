# Inner Signal Runtime Architecture — v0.10.0

## Live therapy

```text
user turn
  ↓
Sonnet incremental/full structured case extraction
  ↓
Auto reasoning-budget router
  ├─ Fast: deterministic graph → Sonnet realization
  ├─ Reviewed: GPT formulation audit → graph → Sonnet realization
  ├─ Deep: GPT audit → graph → Opus analysis → GPT critique → Sonnet realization
  └─ Forensic: GPT audit → graph → independent Opus/GPT candidates → cross-critiques → GPT adjudication → Sonnet realization
```

The browser carries the prior case snapshot and intervention contract into later turns. A follow-up updates existing state rather than conceptually rediscovering the whole person. Auto routing can step down from Deep to Reviewed when a previously reviewed problem receives only a narrow update.

## Validation versus app launch

The local server starts before the validation campaign. A complete successful campaign writes a runtime fingerprint covering executable code, guide material, tests, and relevant model/runtime settings. If the fingerprint is unchanged on a later launch, H001, A001, and model-validation stages are skipped automatically.

## Hypnosis

The model writes structured bounded components. The application owns the consent gate, selected route, route isolation, and final waking return.
