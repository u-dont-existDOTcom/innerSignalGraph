# Journal import: reviews that settle (scoped re-review, withholding and a pooled calibration gate)

Owner outcome (unchanged): import the journal as a committed generation with nothing lost and no journal text
leaked, and fix the process so that a supervisor review is not needed. Owner decision, 3 Oct 2026, 19:58 UTC:
"i approve your rec" (options A, B and D below).

## Evidence (content-free counts from round 4)

Round 4 checked 4 of its 162 calibration units: 1 passed and 3 failed, which was the round's failure limit. A unit
passed only when a whole-unit review reported zero findings, and reviews vary from run to run. Each repair fixed
what one review flagged, and the next review flagged something else:

| Unit | Findings in each review, in order |
| --- | --- |
| 2 (about 27 assertions) | Standard 2, 3, 4. Hardest 5, then 0 after its own repair. The fidelity audit kept all 11 of 11 reference items but called 5 assertions unsupported; later reviews found 3 to 5 each. |
| 3 (about 21) | Standard 1, 1, 1. Hardest 3, then 3 after its own repair. |
| 4 (about 25) | Standard 5, 1, 3. The hardest tier asked for visual context that didn't exist, then 3 after its own repair. |

If a review flags each correct item with probability p independently, a correct n-item unit passes a zero-finding
gate with probability (1 - p)^n: p = 0.05 and n = 27 gives about 25%. Requiring every one of 162 units to pass
multiplies that: even 99% per unit gives 0.99^162, about 20%. The gate could not converge.

## Changes

1. **A. A re-review after a repair counts only for what the repair could affect.** The first extraction's
   omission review counts whole. After a repair (extraction cycles, the hardest extraction and its repair, and
   calibration fidelity repairs), `scopeReviewAfterRepair` keeps the new review's verdicts on: the targets of the
   earlier counted review's findings, unassessed IDs and proposed repairs; the entities, episodes and assertions
   the repair added or changed, matched by local ID and canonical content (identical content under a new local ID
   counts unchanged), together with every assertion or episode that points at a changed or removed item through its
   speaker, subjects, episode or time evidence; units that lost an item, including one rewritten to point elsewhere;
   and any target that is neither an item nor a unit, such as a frozen reference item. The review after newly
   supplied context counts whole, since the context can change what the reviewer sees. Every other verdict carries the earlier verdict forward, under the item's current ID. The status
   is recomputed from what is left. Repair requests carry the counted review. Calibration fidelity reviews are
   scoped the same way against the last audited extraction, with items mapped to their bound graph IDs
   (`journalLocalNodeId`, now exported from `graph.mjs`). The extractor instruction now asks a repair to return every
   item no review flagged exactly as it was, with the same local ID.
2. **B. When repairs run out, what is still flagged is withheld and the rest of the unit is kept.** A single regular
   unit unresolved after its passes and the hardest lane, whose final extraction is complete and binds, keeps
   everything except what the counted review still flags. `withholdFlaggedItems` withholds flagged assertions,
   drops flagged entities and episodes with the assertions that depend on them, repoints time evidence that named a
   withheld item to that item's unit, and marks each affected unit `needs_review` with a counts-only reason; the
   archived source stays searchable. The unit record holds `review_residuals` counts, and the assembled graph is
   marked partial with `review_residual_units`, `review_withheld_assertions` and `review_omission_gaps` in its
   residuals. A hardest answer that doesn't finish or bind never replaces a last standard pass that did. An extraction that isn't
   complete or doesn't bind, or a review that is incomplete without naming what it left, still makes the unit
   source-only. Several units unresolved after their passes are still split in halves.
3. **Calibration units are judged by their reference items.** A calibration unit whose omission review is still
   open after its passes, but whose extraction is complete and binds, now goes on to its reference audit with its
   whole extraction instead of failing. The hardest fidelity repair is skipped when an audited attempt already
   passes once what review still flags is withheld; the hardest tier's extra repair of its own answer runs only
   when that answer didn't complete or didn't bind. A standard repair, audit or re-audit that runs out of attempts
   ends the repairs instead of failing the unit. When the repairs end, the unit keeps the audited attempt that fares
   best once what its counted omission and fidelity reviews still flag is withheld (`reviewAfterWithholding` counts a
   reference item omitted when every saved assertion or entity the auditor tied it to was withheld): fewest
   critical misses, then most items kept, fewest lost qualifiers, fewest unassessed, fewest withheld, then the
   latest. Its record holds `calibration` counts (reference total, preserved, omitted, distorted,
   unassessed, critical misses, lost qualifiers) and a per-unit outcome. A source-only calibration unit with a frozen
   reference counts every reference item omitted; one without a reference (oversized, or a reference that never
   quoted its source) is unscored.
4. **D. The calibration gate pools the round.** Calibration passes when recall across the scored batches meets the
   unchanged reference target (0.95), no critical reference item is missed after repairs, and every unit was scored.
   A critical miss or an unscored unit ends the round at once, since it can't pass. Failed units, lost qualifiers,
   withheld assertions and omission gaps are counted and reported in `calibration_gate` (in the summary) and in the
   stop record. `calibration_failure_limit` becomes an optional cap with no default. The stop names the unit that
   decided it (the first critical miss, else the first unscored unit, else the first failure when a cap ended the
   round), or `CALIBRATION_RECALL_BELOW_TARGET` for the round. A unit admitted before calibration recorded counts
   passed the stricter per-unit audit, so a resumed round goes on without counting it. Regular batches still start
   only after calibration passes.
5. **Diagnostics** gain `review_scope` and `fidelity_scope` (`carried`, `changed`, `removed`, `earlier_findings`
   counts) and count the review that counted for each attempt. All are counts under the existing allowlist.

## Supervisor review

An independent Claude Opus review before deployment found one blocking issue (the hardest fidelity repair was
skipped on the score before withholding, so withholding the flagged carrier of a critical item could end the round
without the hardest tier trying) and four to fix (later failures discarding earlier audited work, a hardest answer
that didn't finish replacing a pass that did, scoping that missed dependents of a rewritten entity and verdicts
made before supplied context, and withholding that left no trace in the graph status). All are fixed above, each
with a regression test. It also flagged pacing: with the hardest tier at 20 calls a day, units that reach the tier
after their standard passes can slow a round; round 5's counts show how much.

## What doesn't change

The 95% reference target, the critical-miss rule, the reference reader and auditor roles, the packet bounds, the
privacy boundary (no journal text in Git, logs, diagnostics, PR text or status), the hardest-lane daily limit and
its accounting, and the split of multi-unit batches.

## Validation

`tests/journal-review-convergence.test.mjs` covers the pure rules: item changes (including renames, rewrites in
place, moves between units, and order independence), scoping, withholding (dependents, time evidence, coverage,
cross-kind ID collisions, units spanned by one item), rescoring after withholding, and the pooled gate. Runtime
tests cover the hardest fidelity repair still running when withholding would miss a critical item, a run-out
standard repair that keeps the earlier audited attempt, a carried finding that lets a unit resolve, an earlier finding that stays in scope, withholding through
the passes and the hardest lane, a flagged entity's dependents, an incomplete extraction that stays source-only,
the skipped hardest fidelity repair, a pooled pass with one failed unit, recall below the target, a critical miss
and an unscored unit that end the round, the optional cap, and a round resumed across the upgrade. Existing tests
were adapted where the intended behaviour changed: calibration scenarios that failed only through review findings
now need a critical reference item they can't keep, and extractor job IDs changed with the extractor instruction.

## Rollout

Round 5 starts a new calibration epoch with `journal-recalibrate.sh` after deployment, so no earlier record is
reused. Counts are reported as the round runs, and the owner page shows the import's status.
