# Inner Signal Autonomous Development Engine Recovery Design

Date: 2026-08-10
Baseline: Inner Signal Runtime v0.12.1
Target release: v0.12.2
Scope: autonomous-development engine only; no therapy-policy or guide-graph changes

## Problem statement

The v0.12.1 autonomous developer can correctly diagnose and implement useful engineering repairs, but the July/August diagnostic state shows several valid candidates becoming terminally blocked for infrastructure reasons rather than demonstrated code defects.

Observed failure classes:

1. A Codex independent review timing out at 180 seconds consumed a repair cycle and ultimately blocked DEV-R001 even though deterministic gates passed.
2. Claude implementers were instructed to run tests inside their model tool sandbox; inability to execute those commands could trigger Fable escalation even though the parent controller can run the same deterministic gates itself.
3. Package verification inherited CLI-mode environment variables, so mock A001/H001 checks could become live stochastic model replays and incorrectly fail a deterministic package gate.
4. Repair-cycle accounting treated implementation defects, verification defects, reviewer/infrastructure timeouts, and model-tool limitations as the same kind of failure.
5. Current-engine `blocked` roadmap tasks are terminal, so viable blocked candidates cannot resume after the development engine learns how to recover from infrastructure failures.

The result is a system that can spend hours doing useful work and then stall with every roadmap item marked blocked even though some candidates are technically viable.

## Design goals

The autonomous engine must:

- reserve Opus/Fable escalation for implementation/judgment failures, not controller or sandbox limitations;
- make deterministic verification the responsibility of the parent controller;
- distinguish deterministic gates from live stochastic model regressions;
- make review timeouts recoverable without consuming implementation cycles;
- preserve and resume viable candidates rather than rebuilding them unnecessarily;
- reopen prior infrastructure-blocked tasks when the engine revision adds a recovery mechanism;
- stop for human input only when a substantive product/safety decision is genuinely required;
- preserve all existing therapy, safety, epistemic, hypnosis, and guide-graph contracts.

## Considered approaches

### A. Increase timeouts and repair-cycle count only

Pros: smallest code change.

Cons: hides the category error. A 10-minute timeout can still fail; a model sandbox still cannot own host verification; stochastic replay remains mislabeled deterministic; more repair cycles waste more credits.

Rejected.

### B. Add special-case retries to each observed failure

Pros: incremental and easy to patch.

Cons: creates a growing exception list and continues to couple infrastructure failures to implementation cycles.

Rejected.

### C. Separate implementation, deterministic verification, independent review, and live regression into controller-owned phases

Pros: directly matches the actual failure domains; allows resumability; prevents unnecessary Fable escalation; creates clear evidence and failure classification.

Cons: slightly larger orchestration change.

Recommended.

## Architecture

A roadmap candidate moves through an explicit controller-owned state machine:

1. `AUDIT`
2. `IMPLEMENT`
3. `DETERMINISTIC_VERIFY`
4. `INDEPENDENT_REVIEW`
5. `LIVE_REGRESSION` when applicable
6. `PROMOTION_READY` or `AWAITING_HUMAN`

Infrastructure/transient failures do not count as implementation repair cycles.

### Failure taxonomy

Every failed phase receives one of these machine-readable classes:

- `IMPLEMENTATION_FAILURE`: candidate code or implementation strategy is defective.
- `DETERMINISTIC_VERIFICATION_FAILURE`: deterministic gate fails because candidate behavior is wrong.
- `REVIEW_REJECTION`: reviewer identifies a substantive candidate defect.
- `REVIEW_TIMEOUT`: reviewer did not return before the review deadline.
- `WORKER_TOOLING_LIMITATION`: model-side tool/sandbox could not perform an operation the controller can own.
- `LIVE_REGRESSION_FAILURE`: stochastic live replay fails after deterministic release gates are green.
- `AUTH_REQUIRED`: provider authentication is invalid.
- `HUMAN_POLICY_REQUIRED`: proposed change is substantive or safety-sensitive.
- `MISSING_INPUT`: a required canonical guide/source is unavailable.

Only `IMPLEMENTATION_FAILURE`, `DETERMINISTIC_VERIFICATION_FAILURE`, or `REVIEW_REJECTION` may consume the bounded Opus→Fable implementation budget.

### Parent-owned deterministic verification

Claude implementers edit candidate code and add tests but are not responsible for proving the package green. Their prompt may ask them to run targeted checks opportunistically, but a sandbox denial cannot mark the implementation failed.

After each `implemented` result, the parent controller always runs:

- `npm test`
- `npm run graph:test`
- deterministic package verification

The controller records complete gate evidence in the job directory.

### Deterministic package verification

`npm run verify` must be deterministic regardless of the parent process environment.

All bundled A001/H001 verification invoked by `verify-package.sh` must explicitly run with `INNER_SIGNAL_MODE=mock` and isolated deterministic fixture/ledger settings.

Live CLI model replays are moved out of deterministic package verification and are classified as `LIVE_REGRESSION`.

### Independent review recovery

Independent Codex review gets its own configurable timeout, separate from ordinary request timeout.

Default policy:

1. First review attempt: high reasoning, normal review timeout.
2. On `REVIEW_TIMEOUT`, persist the candidate and all green gates.
3. Retry the same candidate once with an extended timeout; do not re-run implementation.
4. If the second review times out, optionally retry with a fallback review profile/model if configured.
5. If no reviewer can produce a verdict, mark the candidate `review-pending`/infrastructure-blocked rather than implementation-blocked. It can resume later from `INDEPENDENT_REVIEW`.

Review timeout retries do not consume repair cycles.

### Live regression phase

After deterministic gates and independent review approve a candidate, the controller runs only the live cases relevant to the changed layer/task.

Examples:

- therapy pipeline change → affected therapy replay(s), optionally A001;
- hypnosis compiler change → affected hypnosis replay(s), optionally H001;
- packaging/browser-only change → no therapy-model replay unless behavior changed.

A single stochastic failure does not invalidate deterministic package integrity. It creates a `LIVE_REGRESSION_FAILURE`, retains the candidate, and applies the task's bounded retry/adjudication policy.

A repeated live failure that indicates a real behavioral defect can return to implementation with the exact replay evidence. A sampling-only failure can be rerun/adjudicated without rewriting code.

### Candidate resumability

Each job state stores:

- candidate root and baseline hash;
- changed-files hash;
- last completed phase;
- deterministic gate hashes/results;
- review attempts and verdicts;
- live-regression attempts;
- implementation-cycle count separately from infrastructure retry counts.

On restart, if candidate hashes are unchanged, the controller resumes from the first incomplete/untrusted phase instead of regenerating the candidate.

### Reopening existing v0.12.1 blocked roadmap tasks

Bump `DEV_ENGINE_REVISION` for v0.12.2. Existing terminal tasks from `continuous-dev-v2-2026-08-10` become eligible for recovery.

Recovery should prefer viable stored candidates when their source baseline and candidate hashes can be validated. If not safely resumable, start a fresh candidate from the approved runtime but carry forward prior audit/review evidence.

DEV-R001 specifically should be able to resume at independent review because its cycle-2 deterministic gates were green and its recorded blocker was a Codex timeout.

### Human decision boundary

Human approval remains mandatory for substantive therapy/product-policy or safety-sensitive behavior changes.

Infrastructure recovery must never turn a substantive candidate into automatic promotion.

High-risk-file rules and reviewer classifications remain in force.

## Testing strategy

Tests are written before production changes.

Required regressions:

1. Review timeout does not consume an implementation cycle or invoke Fable.
2. A green candidate survives review timeout and resumes at review without reimplementation.
3. Worker-reported inability to run tests does not trigger escalation; parent deterministic gates decide candidate status.
4. `npm run verify` runs A001/H001 in mock mode even when parent environment says `INNER_SIGNAL_MODE=cli`.
5. A live replay failure is reported separately from deterministic package verification.
6. Infrastructure retry counters and implementation-cycle counters are independent.
7. A v0.12.1 infrastructure-blocked roadmap task reopens under the new engine revision.
8. A current-engine true implementation rejection remains terminal/bounded according to the repair budget.
9. Resumable candidate hashes prevent replaying implementation when only review is pending.
10. Existing autonomous roadmap, guide graph, hypnosis, therapy, auth recovery, and promotion tests remain green.

## Non-goals

This release does not:

- change therapy recommendations;
- modify inner-child/somatic graph rules;
- weaken hypnosis consent or waking-return contracts;
- change the 180-second user-facing therapy latency policy;
- add new product features;
- automatically approve a substantive high-risk candidate.

## Acceptance criteria

v0.12.2 is acceptable when:

- all deterministic tests and graph regressions pass;
- package verification is provably mock/deterministic under an inherited CLI environment;
- reviewer timeouts are recoverable and candidate-resumable;
- sandbox/tooling limitations never cause automatic Fable escalation;
- live model regressions are a distinct post-review phase;
- prior v0.12.1 infrastructure-blocked roadmap state is revision-recoverable;
- dirty-install simulation preserves `.env`, ledgers, state, and user data while replacing stale source;
- no safety/therapy-policy behavior changes are introduced.
