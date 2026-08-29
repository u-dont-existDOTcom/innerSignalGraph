# Inner Signal agent map

## Authority

1. Current owner and task requirements
2. `.github/codex-repository.json` for repository classification and exact commands
3. `state/CODEX-CURRENT-STATE.md` for the resumable current checkpoint
4. `README.md` for branch, release, privacy, recovery, and installation contracts
5. `AUTOPILOT.md` for autonomous development behavior
6. `docs/INDEX.md` for current specifications, plans, and evidence
7. `docs/superpowers/specs/2026-08-14-public-repository-transition-design.md` for the accepted visibility-transition contract
8. `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md` for bounded pre-public and hosted evidence when produced
9. Current code, tests, package verifier, and Git history
10. Relevant current guidance from `u-dont-existDOTcom/universal-dev-architecture`

## Validation

- Runtime: Node 24.18.0 (`.nvmrc`)
- Bootstrap: `npm ci --ignore-scripts`
- Repository audit: `npm run audit:repository`
- Local publication audit: `npm run audit:publication`
- Authenticated hosted publication audit: `npm run audit:publication:hosted`
- Targeted tests: `npm test`
- Complete package gate: `npm run verify`
- Graph gate when affected: `npm run graph:test`
- Lesson gate when affected: `npm run therapy-lessons:verify`
- Authoring gates when graph/Obsidian projection or maps are affected: `npm run authoring:validate`, `npm run authoring:check`, and `npm run authoring:maps:check`

Provider checks are explicit opt-in and are not hermetic CI.

## Workflow

Use an isolated worktree or task branch and a pull request. Keep accepted designs/plans under `docs/superpowers/`. The GitHub repository is public and the publication transition is complete. Public visibility does not grant release or product-policy authority; hosted controls remain claims only when supported by current GitHub API/settings evidence. Run targeted and complete gates, inspect the final diff and package artifacts, update `state/CODEX-CURRENT-STATE.md`, and complete lesson closeout. Release evidence follows `docs/RELEASE-EVIDENCE.md`.

For Obsidian authoring, `guide-graphs/candidates/*.graph.json` and the current guide/source family remain authority. `authoring/obsidian/current/`, Bases, Canvas, Mermaid, links, and proposal previews are non-authoritative. Semantic approval remains in the Guide Packet owner-decision artifact. Reconciliation requires an exact approved packet and hash on a task branch and never installs or writes to `stable`.

Integrity maintenance: any legitimate edit to `README.md`, `AGENTS.md`, `docs/INDEX.md`, `SECURITY.md`, or `CONTRIBUTING.md`—including Task 9 public/completed reconciliation—must update the reviewed SHA-256 bindings in `scripts/audit-repository.mjs` in the same reviewed change.

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
