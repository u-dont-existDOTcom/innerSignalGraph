# Journal calibration: critical misses that are defined, confirmed and survivable

Status: owner-approved on 9 Oct 2026 ("fix it", after the explanation of round 5's critical miss on the owner
page, question 15). Part 1 is the option the owner page recommended; part 2 fixes the design flaws behind it.
Deploying waits for the owner's explicit `deploy`.

## Why

Calibration round 5 (epoch 5) stopped on 8 Oct at about 04:23 UTC after 93 of its 162 units. Pooled recall was
864 of 872 reference items (99.1%, target 95%), and 6 units failed their own reference check. One critical reference
item in one unit was still distorted after every repair, including the hardest tier's. Under the pooled gate (plan
`2026-10-03-journal-review-convergence.md`, section D), a single critical miss ends the round, because a round with
one can't pass.

The content-free diagnostics show why that rule couldn't work:

- **"Critical" had no definition.** The reference reader marked items critical at its own discretion. Only the
  fidelity auditor's instructions named the critical distortions.
- **The verdicts moved.** In 4 of the 6 failed units, a critical miss appeared in one audited version and was gone
  in another. In two units the hardest repair brought back a critical miss that an earlier version didn't have.
- **A status overruled its own verdicts.** In the stopping unit, one version kept all 14 reference items with no
  finding. Its audit claimed `incomplete` while naming nothing it had left out, so the version couldn't pass.
- **Failure discarded work.** The only way on was `recalibrate`, which checks all 162 units again under the same
  rule. At round 5's rate, a new round would get through all 162 without a critical miss only about one time in six
  (a rough figure from a single miss).

A zero rule over many noisy single-judge verdicts is the pattern the convergence plan removed for ordinary findings.
It came back here as a hard floor on an undefined label.

## Part 1: a limit, and reopening a stopped round

1. **`calibration_critical_miss_limit` (run config, optional).** A safe integer, zero or more. Unset means 0, the
   earlier rule. An invalid value is refused when a run opens, and doctor reports it, the same way as
   `calibration_failure_limit`, with `JOURNAL_CALIBRATION_CRITICAL_MISS_LIMIT_INVALID`.
2. **The gate.** A round passes when all of these hold:
   - pooled recall meets the unchanged 0.95 target;
   - confirmed critical misses (part 2) are no more than the limit;
   - every unit was scored.

   A critical miss past the limit ends the round at once. With a limit above zero, the gate records
   `critical_miss_limit`; with none, the gate reads as before.
3. **The stop record** names the unit whose critical miss took the round past its limit. With no limit, that is the
   first critical miss. Otherwise it is the first unscored unit, or the first failure when a failure limit ended the
   round. A batch's counts sit on every unit record the batch wrote, so this count takes each batch once, as the
   pooled gate does (`firstFailurePastCriticalLimit`).
4. **`resume-calibration` (operator command).** Reopens a stopped round under the current run config instead of
   starting it over.
   - Units already checked keep their records. The rest are checked next in the same epoch, so answers already
     received are reused.
   - It is refused with `JOURNAL_RESUME_CALIBRATION_NOT_ALLOWED` unless the pooled gate stopped the round and the
     current config wouldn't have stopped it. That means: no unscored unit, critical misses within the limit,
     failures under any failure limit, and, for a round that checked every unit, recall at the target.
   - A round that isn't stopped is refused with `JOURNAL_RESUME_CALIBRATION_NOT_FAILED`. One whose graph already
     exists is refused with `JOURNAL_RESUME_CALIBRATION_AFTER_GRAPH`.
   - Each reopening appends an entry to `calibration_resumes` (epoch, time, limit, and the stop it replaced, with
     its gate counts). The summary shows `calibration_resume_count`.

## Part 2: the design fixes

5. **One definition of critical.** The reference reader now marks an item critical only when distorting or
   dropping it would mislead about one of these:
   - who did or said something;
   - whether it happened or was a dream, wish or plan;
   - whether it is still true;
   - a cause or treatment.

   These are the critical distortions the fidelity auditor already checks for. The reader names which one in
   `importance_reason`. The auditor's fifth kind, hidden source omission, concerns how an import reports what it
   left out, so it doesn't make an item critical by itself. This changes the reference reader's job identities, so
   only reference sets read after the deploy use it.
6. **A second judge before a critical miss counts.** When the attempt a unit keeps still misses a critical reference
   item, the kept extraction gets one more fidelity audit:
   - from the hardest tier (Claude Opus) when that lane is on, under the usual daily limit and pause;
   - otherwise from a fresh standard audit under its own identity.

   A missed critical item counts as confirmed unless the second audit finds it preserved without a finding and
   leaves nothing open on it: no unassessed ID and no proposed repair.
   - Confirmed misses go into the unit's `calibration.critical_miss_count` and count toward the limit.
   - Unconfirmed ones are recorded as `unconfirmed_critical_miss_count`, on the unit and in the gate, and never count.
   - When no second audit can be had, the first judge's misses stand, so the second judge can never hide a miss.
   - The second judge only rules on items the first judge missed; it adds no new misses.
   - The unit's diagnostics record a `critical_confirmation` snapshot: tier, misses, confirmed, unconfirmed and
     blocker code.
   - A hardest-tier confirmation is recorded with the other hardest attempts (`residuals.hardest_attempted`): resolved
     when it answered, failed when it couldn't.
7. **A status is read from what the review names** (`reviewStatusFromContent`).
   - A review that names no finding, no unassessed ID and no proposed repair has nothing to repair. A claimed
     `repair_required` from it counts as `sufficient_for_stated_scope`, for omission and fidelity reviews alike.
   - A claimed `incomplete` counts as sufficient only when the coverage can be checked. That means a fidelity
     review that assessed every frozen reference item.
   - Otherwise it stays incomplete, as before, since it can't vouch for what it skipped. A review that names
     anything keeps its status.

The 95% target, the per-unit reference check, repairs, withholding and the hardest tier are unchanged.

## What it means

With a limit of 3, the recommendation on the owner page, round 5 continues from unit 94. Its one recorded critical
miss predates the second judge, so it stays counted. New critical misses count only when two judges agree.

The cost of the limit: at round 5's rate, a unit may keep a critical item wrong in its extraction about one time in a
hundred, and outside the calibration sample no reference audit checks for that. The journal text itself is always
archived whole and searchable.

## Operating it (after the owner's `deploy`)

1. Deploy the commit, and restart the import worker so its import runs use the new code.
2. Back up the private run config and the run state. Set `calibration_critical_miss_limit` in the config.
3. Run `journal-import resume-calibration` once, with the usual config and env files. It prints the summary with
   `calibration: "not_run"`, `blocker: null` and the same `calibration_epoch`.
4. The next import run continues the round.

Run step 3 only after step 1. A worker still on the old code would stop the reopened round again on its next run.

## Tests

`tests/journal-recalibrate.test.mjs`:

- A critical miss within the limit lets the round go on, and the round passes on pooled recall.
- A miss past the limit ends the round, names that unit and leaves later units unread.
- `resume-calibration`:
  - is refused while the config would stop the round again;
  - once the limit allows, reopens the round, keeps the checked unit's record and passes on the remaining units;
  - is refused for an unscored stop, a failure-limit stop and a round that isn't stopped.
- An invalid limit is refused before any provider call.
- A critical miss the second judge doesn't confirm doesn't count, and the round passes. One it confirms ends the
  round. Both record the snapshot. A second judge that keeps the item but leaves it open (an unassessed ID)
  confirms the miss.
- An audit claiming `incomplete` or `repair_required` that assessed every reference item and names nothing passes
  with one audit: no re-audit, no repair and no second judge.
- The reference reader's definition of critical matches the auditor's list.

`tests/journal-review-convergence.test.mjs`:

- `pooledCalibration`:
  - passes up to the limit;
  - never rescues recall below the target;
  - keeps its old shape with no limit.
- `firstFailurePastCriticalLimit` counts each batch once.
- `reviewStatusFromContent` reads status from what a review names.

`tests/journal-contracts.test.mjs`: doctor reports an invalid limit.

Updated expectations:

- The runtime-finish, recalibrate and convergence-calibration tests whose units end with a critical miss now see
  the second judge's audit: one more fidelity call, at the hardest tier when the lane is on, where it also adds one
  hardest attempt to the residuals.
- One test whose first audit claimed `repair_required` while naming nothing now names a finding, so it still
  exercises a repair.
- The pinned reference-reader job ID and operation key in `journal-lookahead` change only with the reader's text
  (checked by reverting that file alone).

Each new test fails without the source change.
