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

The repository is still private while `.github/codex-repository.json` records `pre_publication_ready`. Neither the MIT license nor public-ready documentation proves that GitHub visibility or hosted controls have changed.

The transition report names the fully gated source candidate. Its containing evidence commit/tree must be read from Git and the later pull request because a commit cannot embed its own immutable identity without changing it.

## Current evidence

- `../BUILD-VERIFY.txt`: build verification evidence
- `../GRAPH-REPORT.md`: graph compilation and regression evidence
- `../IMPLEMENTATION-REPORT-v0.15.2.md`: current implementation report
- `CURRENT-STATE.md`: superseded checkpoint retained only for audit history

## Plans and specifications

- `superpowers/plans/`: implementation plans
- `superpowers/specs/`: accepted design specifications

## Branch authority

`main` is development. `stable` is the only installation/release source. `runtime-diagnostics` is generated status data and is never merged into runtime source.

Current owner requirements and verified code/tests outrank stale plans or reports.
