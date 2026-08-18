# Real-query corpus and execution protocol

Pinned source: `u-dont-existDOTcom/creativeTailSampling@af36a51e44a65067a3d7703a78a004fdb8ad7693`  
Imported cases: 49 (`006=16`, `007=12`, `008=11`, `009=10`)  
Manifest SHA-256: `f8f73cb023e94e14c4724a670151215bf825f67616678e97e3d733a04a28857d`

## Mechanical isolation

Each case has two distinct, hash-bound regular files:

- `queries/<id>.json` contains only `id`, decoded `query`, public source locator/date, and batch;
- `graders/<id>.json` contains source provenance, the implementation-translated structured profile, expected disposition/operation, assertions, prohibited behavior, severity, false-escalation classes, and ablation tags.

The manifest requires unique paths and exact SHA-256 values. The executor-side `loadModelInputs` function resolves only the allowlisted query path, rejects traversal and symlinks, validates exact top-level keys, and returns the decoded query string rather than the file object. It never opens a grader path. All 49 executor outputs must be checkpointed before the distinct grader phase calls `loadGraders`. The acceptance gate independently reloads and validates every query and grader, recomputes membership and batch counts, and binds result IDs/query hashes to the exact corpus.

`npm run therapy-protocol:hermetic` routes all 49 grader-side profiles deterministically and writes the Map 15/16 full-versus-simple artifacts. Current deterministic evidence is 49/49 pass with zero severe routing errors and zero false escalation under the selected production variant.

## Genuine model campaign

`npm run therapy-protocol:live:execute` processes inputs serially through `buildContext` and `runTieredTherapyPipeline(processingMode: "auto")`. It checkpoints after every case and can resume without replaying completed calls. `npm run therapy-protocol:live:grade` becomes eligible only after all executor outputs exist; it then loads grader files and asks a separate exact `gpt-5.6-sol` CLI evaluation call to score preserved criteria. The answer, structured route, field/question burden, terminal status, and sanitized call telemetry remain reviewable.

The equivalent multi-turn commands run 13 exact trajectory IDs and 27 turns. Each next turn carries the actual previous formulation, intervention contract, processing tier, and actual assistant answer. No expected field, assertion, or grader text enters the model context. Any provider boundary recorded as `safely_blocked` forces campaign `blocked` and cannot pass acceptance. A missing provider mode, exact model, response ID, timestamp, clean execution head/tree, pipeline identity, corpus hash, or evaluator evidence also fails closed.

## Reproduction and limitations

The deterministic artifacts are reproducible locally from the pinned public/privacy-reduced fixture representation. The live campaign uses authenticated Codex and Claude subscription CLIs and may consume subscription quota or account credits. CLI isolation and no-session flags reduce local/session persistence but do not prove zero provider retention. API mode is a different billed and retention boundary and is not silently substituted.

These tests measure software routing and bounded response behavior on this corpus. Public anecdotes, conceptual graders, one independent model evaluator, and 49 finite examples are not clinical validation, legal advice, diagnostic evidence, or proof of generalization. Exact source, runtime, model, and execution-head identities are therefore part of every claim.
