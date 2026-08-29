# Inner Signal documentation index

## Current authority

- `../README.md`: branch roles, installation, release, privacy, recovery, and model-role contracts
- `../AUTOPILOT.md`: autonomous development, diagnosis, repair, and escalation behavior
- `../.github/codex-repository.json`: repository classification and exact verified command map
- `../state/CODEX-CURRENT-STATE.md`: sole canonical resumable checkpoint
- `../scripts/verify-package.sh`: complete deterministic package gate
- `../package.json`: supported commands
- `RELEASE-EVIDENCE.md`: stable-promotion evidence contract

## Public repository transition

- `docs/superpowers/specs/2026-08-14-public-repository-transition-design.md`: accepted publication and hosted-control design
- `docs/PUBLIC-REPOSITORY-TRANSITION-REPORT-2026-08-14.md`: exact bounded pre-public audit, gate, hosted-control, non-effect, and recovery evidence
- `../state/CODEX-CURRENT-STATE.md`: canonical checkpoint and truthful current transition state
- `npm run audit:publication`: local all-ref/all-object publication audit
- `npm run audit:publication:hosted`: authenticated hosted-surface publication audit

The GitHub repository is public and `.github/codex-repository.json` records the completed publication transition. Public visibility and every enabled hosted control are supported by GitHub API or Actions evidence in the transition report; repository files alone are not proof. Repository-scoped installed GitHub App permissions remain `UNVERIFIED`, issue 4 remains open, and the terminal label is `BLOCKED`.

The transition report names the fully gated private candidate, the public visibility boundary, protected-branch and CodeQL evidence, prior pull requests, and the universal lesson. The containing evidence commit/tree and self-referential pull-request merge identity must be read from Git and the pull request because a commit cannot embed its own immutable identity without changing it.

## Current evidence

- `../BUILD-VERIFY.txt`: build verification evidence
- `../GRAPH-REPORT.md`: graph compilation and regression evidence
- `../IMPLEMENTATION-REPORT-v0.15.2.md`: current implementation report
- `CURRENT-STATE.md`: superseded checkpoint retained only for audit history

## Plans and specifications

- `superpowers/plans/`: implementation plans
- `superpowers/specs/`: accepted design specifications

## Obsidian graph authoring

- `AUTHORING-ARCHITECTURE.md`: authoritative development workflow, source boundaries, exact proposal/decision gates, Guide Packet adapter, and task-branch reconciliation
- `OBSIDIAN-AUTHORING-IMPLEMENTATION-REPORT-2026-08-29.md`: implementation and non-effect evidence
- `INNER-CHILD-THERAPY-MAP.md`: generated compiled-plus-overlay audit view; never graph authority
- `../authoring/README.md`: workbench commands and operator boundary
- `../authoring/migration/owner-map-resolution-2026-08-29.json`: exact owner resolution of the 15 migrated map decisions

## Branch authority

`main` is development. `stable` is the only installation/release source. `runtime-diagnostics` is generated status data and is never merged into runtime source.

Current owner requirements and verified code/tests outrank stale plans or reports.
