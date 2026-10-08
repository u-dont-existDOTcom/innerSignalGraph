# Journal calibration: an optional critical-miss limit, and reopening a stopped round

Status: proposed for the owner's decision (owner page question 15, 8 Oct 2026). The default is unchanged, so this
changes nothing on a run until the private run config sets the limit and an operator reopens the round.

## Why

Calibration round 5 (epoch 5) stopped on 8 Oct at about 04:23 UTC after 93 of its 162 units. Pooled recall was
864 of 872 reference items (99.1%, target 95%), 6 units failed their own reference check, and one critical reference
item in one unit was still distorted after every repair, including the hardest tier's. Under the pooled gate (plan
`2026-10-03-journal-review-convergence.md`, section D) a single critical miss ends the round, because a round with
one can't pass.

Starting over (`recalibrate`) would check all 162 units again under the same rule. At round 5's rate, one critical
miss in 93 units, a new round would get through all 162 without one only about one time in six. That is a rough
figure from a single miss, but it is the same pattern the convergence plan removed for ordinary findings: a zero
rule applied to many noisy model judgements rejects a round of work that meets the target. And a clean round would
not show the import misses critical items less often; it would only show the sample was lucky.

## What changes

1. **`calibration_critical_miss_limit` (run config, optional).** A safe integer, zero or more. Unset means 0, the
   current rule. An invalid value is refused when a run opens and reported by doctor, like
   `calibration_failure_limit`, with `JOURNAL_CALIBRATION_CRITICAL_MISS_LIMIT_INVALID`.
2. **The gate.** A round passes when pooled recall meets the unchanged 0.95 target, the critical misses after repairs
   are no more than the limit, and every unit was scored. A critical miss past the limit ends the round at once, as
   a first critical miss does now. With a limit above zero the gate records `critical_miss_limit`; with none the
   gate reads exactly as before. Each critical miss stays in its unit's record (`calibration.critical_miss_count`,
   outcome `fail`), as every failed unit's counts do now.
3. **The stop record** names the unit whose critical miss took the round past its limit (with no limit, the first
   critical miss, as now), else the first unscored unit, else the first failure when a failure limit ended the round.
   A batch's counts sit on every unit record it wrote, so this count takes each batch once, as the pooled gate does
   (`firstFailurePastCriticalLimit`).
4. **`resume-calibration` (operator command).** Reopens a stopped round under the current run config instead of
   starting it over. The units it already checked keep their records, and the rest are checked next in the same
   epoch, so answers already received are reused. It is refused (`JOURNAL_RESUME_CALIBRATION_NOT_ALLOWED`) unless
   the pooled gate stopped the round and the current config would not have stopped it: no unscored unit, critical
   misses within the limit, failures under any failure limit, and, for a round that checked every unit, recall at
   the target. A round that isn't stopped is refused with `JOURNAL_RESUME_CALIBRATION_NOT_FAILED`, and one whose
   graph already exists with `JOURNAL_RESUME_CALIBRATION_AFTER_GRAPH`. Each reopening appends an entry to
   `calibration_resumes` (epoch, time, limit, and the stop it replaced, with its gate counts), and the summary shows
   `calibration_resume_count`.

The 95% target, the per-unit reference check, repairs, withholding, the hardest tier and the reference and
auditor roles are unchanged.

## What it means if the owner chooses it

With a limit of 3 (the recommendation on the owner page), round 5 continues from unit 94. On round 5's rate it would
very likely finish without stopping again. The cost is that a unit may keep a critical item wrong in its extraction
about one time in a hundred, and outside the calibration sample no reference audit checks for that. The journal text itself is
always archived whole and searchable.

## Operating it (after the owner's yes and a deploy)

1. Back up the private run config and set `calibration_critical_miss_limit`.
2. Deploy the merged commit and restart the import worker.
3. Run `journal-import resume-calibration` once with the usual config and env files. It prints the summary with
   `calibration: "not_run"`, `blocker: null` and the same `calibration_epoch`.
4. The next import run continues the round.

## Tests

`tests/journal-recalibrate.test.mjs`: a critical miss within the limit lets the round go on and pass on pooled
recall, with the gate recording the limit; a miss past the limit ends the round and names that unit, leaving later
units unread; `resume-calibration` is refused while the config would stop the round again, then reopens it once the
limit allows, keeping the checked unit's record (no call goes out for it again) and passing on the remaining units;
it is refused for an unscored stop, a failure-limit stop and a round that isn't stopped; an invalid limit is refused
before any provider call. `tests/journal-review-convergence.test.mjs`: `pooledCalibration` passes up to the limit,
never rescues recall below the target, and keeps its old shape without a limit; `firstFailurePastCriticalLimit`
counts each batch once and names the failure that goes past the limit. `tests/journal-contracts.test.mjs`:
doctor reports an invalid limit. Each new test fails without the source change.
