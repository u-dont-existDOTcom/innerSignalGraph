# Inner Signal agent map

## Authority

1. Current owner and task requirements
2. `README.md` for branch, release, privacy, recovery, and installation contracts
3. `AUTOPILOT.md` for autonomous development behavior
4. `docs/INDEX.md` for current specifications, plans, and evidence
5. Current code, tests, package verifier, and Git history
6. Relevant current guidance from `u-dont-existDOTcom/universal-dev-architecture`

## Validation

- Runtime: Node 24.18.0 (`.nvmrc`)
- Targeted tests: `npm test`
- Complete package gate: `npm run verify`
- Graph gate when affected: `npm run graph:test`
- Lesson gate when affected: `npm run therapy-lessons:verify`

Provider checks are explicit opt-in and are not hermetic CI.

## Workflow

Use an isolated worktree or task branch and a pull request. Keep accepted designs/plans under `docs/superpowers/`. Run targeted and complete gates, inspect the final diff and package artifacts, update recovery/report documentation, and complete lesson closeout.

## Branch roles

- `main`: development authority
- `stable`: only installation and release authority
- `runtime-diagnostics`: generated allowlisted status records; never merge into runtime source
- task branches: proposed changes

## Safety

Never install from `main` or diagnostics. Keep private runtime data and local configuration out of Git. Promotion to `stable` requires the complete package gate and retained rollback.

## Code review rules

- Preserve `stable` as the sole installation source and retain the prior verified runtime after failed updates.
- Keep diagnostics constrained to their declared schema and paths.
- Product-policy decisions remain owner-gated; implementation review cannot silently approve them.

Treat chat as disposable working memory. A fresh worker must recover from Git.
