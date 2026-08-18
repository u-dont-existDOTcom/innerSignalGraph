# Inner Signal Runtime Architecture — v0.15.2

## Live therapy

```text
user turn
  ↓
Sonnet incremental/full structured case extraction
  ↓
Deterministic therapy-protocol permission and longitudinal routing
  ↓
Auto reasoning-budget router
  ├─ Fast: deterministic graph → Sonnet realization
  ├─ Reviewed: GPT formulation audit → graph → Sonnet realization
  ├─ Deep: GPT audit → graph → Opus analysis → GPT critique → Sonnet realization
  └─ Forensic: GPT audit → graph → independent Opus/GPT candidates → cross-critiques → GPT adjudication → Sonnet realization
```

The browser carries the prior case snapshot and intervention contract into later turns. A follow-up updates existing state rather than conceptually rediscovering the whole person. Auto routing can step down from Deep to Reviewed when a previously reviewed problem receives only a narrow update.

## Therapy protocol permission layer

`src/therapy-protocol/` validates an optional protocol profile and routes O0–O10 before ordinary guide-node selection. Immediate safety, external reality, consent, actor/beneficiary, bodily and third-party rights, authority, provenance, decision-specific capacity concerns, resource availability, and integration load can constrain or bypass the graph. The one-parent ontology has nurturing, protecting, and guiding qualities; it does not create three autonomous internal agents.

Every compiled graph node has an explicit operation mapping. An unmapped node fails closed rather than inheriting a regex/default classification. The intervention contract carries exact router/variant identity, disposition, primary operation, permissions, material unknowns, resource/handoff state, normalized profile, and longitudinal state. Reviewed-case audit corrections are re-routed before final tier execution.

The longitudinal layer carries unresolved external needs and unstable provenance, detects repeated inaccessible referrals, and redirects vulnerability-amplifying loops. Actual-model regressions carry only prior actual state and transcript. The physical 49-case query/grader split, source hashes, production crosswalk, and Map 15/16 ablation limits are documented in `docs/therapy-protocol/`.

## Validation versus app launch

The local server starts before the validation campaign. A complete successful campaign writes a runtime fingerprint covering executable code, guide material, tests, and relevant model/runtime settings. If the fingerprint is unchanged on a later launch, H001, A001, and model-validation stages are skipped automatically.

## Hypnosis

The model writes structured bounded components. The application owns the consent gate, selected route, route isolation, and final waking return.
