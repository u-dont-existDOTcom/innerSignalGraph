## Goal

State the acceptance criteria, intended result, and non-goals.

## Change

Summarize affected code, tests, artifacts, and branch roles.

## Verification

List exact focused checks, `npm test`, audits/evaluations, and `npm run verify` results for this final head.

## Risk and rollback

State the worst plausible failure, rollback/revert path, and evidence that owner/private state remains preserved.

## Release

State effects on `stable`, installation, diagnostics, recovery, privacy, model roles, and owner-gated policy. Link release evidence when `stable` may move.

## Continuity and lessons

Link the updated `state/CODEX-CURRENT-STATE.md`, record residual uncertainty, and disposition project/universal lessons.

- [ ] Final diff reviewed
- [ ] Acceptance criteria and non-goals satisfied
- [ ] Privacy, model-role, owner-decision, and `stable` boundaries reviewed
- [ ] Current-state checkpoint updated
- [ ] Residual risk and rollback recorded
- [ ] `npm run verify` passes
- [ ] Working tree remains clean
- [ ] Final-head CI passes
