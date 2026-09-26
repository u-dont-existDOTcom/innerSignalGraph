# Non-punitive review (D09) — integration ledger

Status: OWNER-APPROVED + RECONCILED ON TASK BRANCH; merge, installation, deployment and `stable` promotion not authorized by this ledger
Date: 2026-09-26
Branch: `claude/nonpunitive-review-map-20260926`
Integration base: proposal built and reconciled on `0c9445b` (after #80, music access, #54, #79, #86); branch then rebased onto `2a78556` (#84, MCP root endpoint only, no authoring input changed) and re-verified

## Owner outcome

On 2026-08-29 the owner approved D09: "Review is critical. Notice recognition, repair, missed and kept promises, and what should change next without turning review into a trial. No mandatory morning/evening cadence is established." The overlay `OVERLAY.IC.NONPUNITIVE_REVIEW` recorded it as owner-approved but uncompiled, so the engine never used it. Closed PR #14 built a candidate against the late-August map and stopped with nine pending decision cards after the owner revised their wording.

On 2026-09-26 the owner said "yes that is important" and asked (through the supervising session) for it to be built into the current map, with the pending sub-decisions resolved consistently with the approved lines and the current map, and each resolution listed in plain English for review.

Owner-approved user-facing lines:

- "After attempting improved care, protection, or guidance for the inner child, notice without harsh judgment what felt right and what you could do better next time."
- "When an effort at improvement doesn’t go as hoped, name what happened, repair what can be repaired, and make the next promise more credible."

## What was built

1. Provenance bridge: `AMEND.IC.NONPUNITIVE_REVIEW` carries the exact D09 statement (owner amendments `2026-09-26-nonpunitive-review-r1`).
2. Authoring proposal `nonpunitive-review-20260926` on the current map (after PR #80), built and checked with repository tooling: 12 decision cards, 33/33 candidate regressions.
3. Approval record `approval/OWNER-APPROVAL.json`, produced by `approval/record-owner-approval.mjs` from the exact candidate packet (SHA-256 `1d103cfd…9bc`); approved packet SHA-256 `0d05aa4e4c2b96895cd75f45ca58b30320af65a0b79fc663d472dc89d7d1ab0b`. Packets are rebuildable build artifacts and are not committed.
4. Reconciliation with `npm run authoring:proposal:reconcile`, which recompiled the graph, regenerated the projection and maps, reran regressions and the complete `npm run verify` gate: PASS. Receipt: `RECONCILIATION-RECEIPT.json`.
5. `OVERLAY.IC.NONPUNITIVE_REVIEW` is now `reconciled` into `IC.ADULT_APPRENTICE`, `IC.CREDIBILITY_REPAIR` and `IC.PROTECTOR_ACTION`.

## How each pending decision was resolved

The nine cards from PR #14, mapped onto the current node records (which PR #80 had since changed). Every new entry is appended; nothing existing is removed or reordered.

| # | Field | Resolution |
| --- | --- | --- |
| 1 | `IC.ADULT_APPRENTICE` recommendations | Add owner-approved line 1 verbatim. |
| 2 | `IC.CREDIBILITY_REPAIR` recommendations | Add owner-approved line 2 verbatim. |
| 3 | `IC.ADULT_APPRENTICE` avoid | Add the owner-revised text: review is never punitive, compulsive or mandatory; voluntary tracking is fine when it helps learning and does not become self-surveillance. |
| 4 | `IC.CREDIBILITY_REPAIR` avoid | Add the owner-revised text: a lapse or repeated pattern is never a verdict about worth; review may still conclude a commitment is too big right now or needs limits, support or a different plan. |
| 5 | `IC.ADULT_APPRENTICE` required nuance | Add the owner-revised text: accountability and learning are not punishment or a judgment of worth; accountability can still mean consequences, firmer boundaries and an honest look at present capacity. |
| 6 | `IC.CREDIBILITY_REPAIR` required nuance | Add the owner-revised text: a missed commitment matters but is not the whole picture; weigh what was actually agreed, capacity, circumstances, repair and kept commitments, without using the good to erase a serious lapse. |
| 7 | `IC.ADULT_APPRENTICE` success signals | Add the owner-revised text: review ends in clearer understanding and one bounded repair or adjustment, or a clear "no change needed", without more self-attack. |
| 8 | `IC.ADULT_APPRENTICE` source refs | Cite `AMEND.IC.NONPUNITIVE_REVIEW` (placement the owner approved). |
| 9 | `IC.CREDIBILITY_REPAIR` source refs | Cite `AMEND.IC.NONPUNITIVE_REVIEW` (placement the owner approved). |

Two further resolutions:

- The credibility success-signal the owner rejected on 2026-08-29 stays out.
- `IC.PROTECTOR_ACTION` is the overlay's third owner-approved anchor and the place where most everyday self-care attempts happen. It gets the same approved review line (card 1 wording) and the same avoid text (card 3 wording) plus the citation. No new wording was written, so review also reaches self-care without a helper or a credibility conflict.

No sub-decision needed a new safety-policy call. The D09 statement already rules out a fixed review cadence, and none was added.

## Non-effects

No change to activation, routing, tiers, priorities, default questions, defer/block effects, topology or case variables. Canonical guide prose is unchanged. Reconciliation reports `installed=false`, `stableChanged=false`. The reviewed-tier therapy-policy fingerprint changed because the A001 credibility plan now carries the new content; the fast-tier fingerprint is unchanged.

## Verification

- Proposal build/check: PASS, 33/33 candidate regressions, 12 cards.
- Reconciliation (includes the complete package gate): PASS, 30/30 canonical graph regressions.
- Post-reconciliation overlay/projection update: `authoring:validate`, `authoring:check`, `authoring:maps:check` PASS; focused suites PASS.
- Final complete gate on the final branch head: recorded in the pull request.

Tests and the reconciliation show the map is consistent and reachable. They do not show clinical usefulness.
