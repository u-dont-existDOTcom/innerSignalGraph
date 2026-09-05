# Companion foundations checkpoint

Date: 2026-09-05. Task: COMPANION-FOUNDATIONS-20260905.
Base: `main` commit `64863eefa9678c063ed5c5a48a3280fa507a4c95`.
Task branch: `companion/foundations-2026-09-05`.

## Completed in this slice

- Recorded the owner's secular/non-spiritual terminology convention in `docs/OWNER-TERMINOLOGY.md`.
- Preserved the clarified founder philosophy: capacities and integration matter, not compulsory therapy, app use, books, or terminology; informal growth through friends and life counts.
- Added the shared companion-foundations specification under `docs/superpowers/specs/2026-09-05-companion-foundations-design.md`.
- Recorded ten owner-approved principles separately from provisional interface fields, evidence thresholds, copy, and cadence in `OWNER-DECISIONS.json`.
- Implemented a pure, offline-only prototype for invitation permission, reflection provenance/permission, optional self-guidance, and stepping back from the app.
- Added 30 deterministic tests and 16 synthetic behavioral evaluation cases. The behavioral cases have NOT been run against any model.

## Verification actually performed

`node --test tasks/companion-foundations-20260905/policy.test.mjs`

All 30 tests passed in the isolated local prototype workspace on Node `v22.16.0`. Both JSON artifacts parse and their metadata is checked by the test suite. This is not the repository's required Node 24 verification. Direct repository cloning failed because the local environment could not resolve github.com; connected GitHub reads/writes remain available.

The full repository checkout, `npm test`, `npm run audit:repository`, `npm run audit:publication`, and `npm run verify` were not run locally. Exact-head hosted CI results and the pull request remain the authority for those checks; no passing result is inferred. No paid or subscription model call was made. No independent semantic review or clinical evaluation is claimed.

## Scope and non-effects

All executable additions are inside this task directory. Existing application code does not import this prototype. It has no persistence, HTTP, model call, telemetry, crypto, UI, plugin, live therapeutic-response, or production effect. No guide graph, Guide Packet, active prompt, model role, `stable`, or `runtime-diagnostics` is changed. PR #42 and DEV-R005 work remain separate. This task does not supersede the existing DEV-R005 frontier or authorize its later storage slices.

The root `state/CODEX-CURRENT-STATE.md` remains the unrelated development-frontier checkpoint. This task's durable entry is `state/COMPANION-FOUNDATIONS-2026-09-05.md`; do not overwrite another worker's frontier with this task.

## Next safe work

1. Read the specification, terminology convention, owner ledger, prototype, and tests; inspect the actual task branch and PR head before changing anything.
2. Run repository Node 24 checks and inspect exact-head hosted results. Review only this diff; do not weaken unrelated gates or modify CI workflows to obtain green status.
3. Perform a substantive review of invitation autonomy, mixed progress, evidence completeness, correction/deletion propagation, and founder/user non-sycophancy. Deterministic gates cannot validate the truth or meaning of evidence or generated language.
4. Prepare an opt-in non-persistent mock interface using synthetic data. Do not claim an app feature is active until actual integration and tests exist. Real-data wiring depends on separately approved privacy/vault boundaries and explicit review.
5. Keep the PR draft until the required checks and review complete. Do not merge, release, create a plugin, start a live pilot, or make a model-evaluation call as an automatic consequence of this checkpoint.

## Durable lesson

A founder's philosophy and a user's real growth are not competing authorities: state the philosophy honestly, then test case-specific claims without requiring agreement. App usage and named-method completion are not evidence of development. A passing structural test is not evidence that a model is non-sycophantic.
