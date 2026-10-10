# Suggested fixes ledger

2026-10-01: The canonical `suggested-fixes/innerSignalGraph/` lane and `patterns/suggested-fix-queue.md` could not be fetched in this networkless sandbox. GitHub DNS resolution failed, and the web surface returned cache misses for both paths. No item contents were available to adopt, adapt, decline, defer, or route to the owner. Reconcile the live lane before disposition on the next connected review.

2026-10-02: Retried the live suggested-fix lane and queue method through the available web surface. Both direct paths returned errors and the GitHub listing was blocked, so no new item content was available for disposition. The earlier reconciliation remains pending for a connected review; this task did not infer or invent queue items.

2026-10-02 (third review round): The GitHub connector subsequently retrieved the live default-branch Universal root, queue method and this repository's lane, repairing the earlier access gap. The lane contained one item:

| Item | Outcome | Destination | Date | Note |
| --- | --- | --- | --- | --- |
| `2026-09-30-claim-integrity-checks.md` | Owner question OPEN | `OWNER-QUESTIONS.md`, question 1; separate proposal PR #96 | 2026-10-02 | Explicit owner request. Exact proposed wording is available for approval with warmth/length tradeoffs. This branch changes journal-worker infrastructure only; no therapy prompt or served-protocol edit, adoption, decline or deferral is implied. |

2026-10-02 (fourth review round): The available web surface returned a cached default-branch Universal root and selected rules, but the live lane listing, queue method, and known item path returned errors/cache misses. Live freshness and new queue items could not be verified. The previously recorded claim-integrity owner question remains OPEN; no new disposition or therapy change is inferred. Reconcile the current lane at the next connected review.

2026-10-03: 2026-09-30-claim-integrity-checks.md — DEFER. The item is an owner-requested served-protocol/prompt-policy change already represented by PR #96 and requires exact wording review before adoption. It is independent of the current state-dependent altered-state transfer map work, so this branch does not rebase, merge, or rewrite it. Trigger: the next dedicated claim-integrity prompt-policy review.

2026-10-03 (journal calibration branch): Read the live lane from a fresh clone of the Universal default branch (`e1f1ba7`). It holds only `2026-09-30-claim-integrity-checks.md`, already recorded above. This branch changes the journal importer only and adds no new disposition.
## 2026-10-01: Inner Signal Graph lane check

- Source requested: the live default branch of `u-dont-existDOTcom/universal-dev-architecture`, especially `suggested-fixes/innerSignalGraph/` and `patterns/suggested-fix-queue.md`.
- Result: unavailable in this sandbox. `git ls-remote https://github.com/u-dont-existDOTcom/universal-dev-architecture.git HEAD` failed with `Could not resolve host: github.com`. A web fetch returned an `AGENTS.md` copy marked as crawled six days earlier, and the lane page returned an internal error. Neither is a live default-branch read; the live queue method and lane items could not be read.
- Disposition: no item was adopted, declined, or deferred without seeing it. Recheck the live lane in a networked environment before the next repository fix; record each previously unlisted item here under this repository's authority. This does not claim the queue is empty.

## 2026-10-01: PR #110 review repair recheck

- The required live bootstrap still could not be completed: `git ls-remote https://github.com/u-dont-existDOTcom/universal-dev-architecture.git HEAD` failed because `github.com` could not be resolved. `gh api` reads of `AGENTS.md` and `suggested-fixes/innerSignalGraph/` were rejected by this sandbox's network policy.
- The current default-branch `AGENTS.md`, queue method, and lane items were therefore unavailable. No unseen item was assigned a disposition or treated as absent. Recheck the live lane and record each unlisted item's outcome when GitHub access is available.

## 2026-10-01: live lane read (Claude, journal migration session)

- Read live from the default branch of `u-dont-existDOTcom/universal-dev-architecture`: `suggested-fixes/innerSignalGraph/` holds one item, `2026-09-30-claim-integrity-checks.md` (owner request; existing pull request #96).
- `2026-09-30-claim-integrity-checks.md`: open, not declined or deferred. It concerns the therapy protocol and reply prompts, outside this journal-import change, and therapy prompt wording needs the owner's approval. The owner was told on 2026-10-01 that it waits for his decision; the next therapy-prompt change reviews #96 as the item asks (check newer prompt changes, rebase, recompute the served protocol hash, and show him the exact wording with what it prevents and what it could cost in warmth or length).

## 2026-10-04: claim-integrity item parked by the owner

- `2026-09-30-claim-integrity-checks.md`: DEFER until the polish and ship phase, by the owner's decision. He approved the exact wording on 2026-10-03 ("1 A"), and on 2026-10-04 chose not to ship it yet (owner page question 9: C) while he is still fixing the maps, rules and guide from his client sessions. PR #96 is a draft that keeps the approved wording, its fit with the current prompts and the served protocol, and the sample-reply test. Trigger: the owner starts the polish and ship phase. Then rebase PR #96 on the prompts current at that time, recompute the served protocol hash, and ask him to ship it. Details: `OWNER-QUESTIONS.md`, question 1.
- Live lane read on 2026-10-04 (default branch of `u-dont-existDOTcom/universal-dev-architecture`): `suggested-fixes/innerSignalGraph/` still holds only this item.

## 2026-10-08: journal calibration critical-miss limit

- Live lane read on 2026-10-08 (default branch of `u-dont-existDOTcom/universal-dev-architecture`): `suggested-fixes/innerSignalGraph/` still holds only `2026-09-30-claim-integrity-checks.md`, deferred above until the polish and ship phase. This branch changes the journal importer only and adds no new disposition.

## 2026-10-09: journal quote-first

- Live lane read on 2026-10-09 (default branch of `u-dont-existDOTcom/universal-dev-architecture`): `suggested-fixes/innerSignalGraph/` holds `2026-09-30-claim-integrity-checks.md`, deferred above until the polish and ship phase, and a new item, `2026-10-09-teaching-points-for-map-changes.md`.
- `2026-10-09-teaching-points-for-map-changes.md`: DEFER to its own change, the next one after this journal change. The owner asked for it (2026-10-08 and 2026-10-09), so it needs no owner question. It changes the map and guide workflow and its audit check, a separate surface from the journal importer. Keeping it out of this change keeps both reviews small. Trigger: this change is handed over for review.

## 2026-10-10: teaching points for map changes

- Live lane read on 2026-10-10 (default branch of `u-dont-existDOTcom/universal-dev-architecture`): `suggested-fixes/innerSignalGraph/` holds `2026-09-30-claim-integrity-checks.md`, deferred until the polish and ship phase, and `2026-10-09-teaching-points-for-map-changes.md`.
- `2026-10-09-teaching-points-for-map-changes.md`: ADOPT steps 1 to 4 in this change.
  - The teaching-point rule, its five fields and the app-only line are in `docs/PUBLIC-GUIDE-HUMANIZATION.md`, "Teaching points for map changes", and in the queue's contract.
  - The automatic check is `scripts/check-guide-impact.mjs`, run by the required `workflow-policy` check on every pull request. It reruns when a description is edited.
- Step 5, the backfill of the nine teaching points the owner approved for the October 4 change, stays open. They're in section 7 of the design file in `u-dont-existDOTcom/joel-articles`, and this session can't open that repository. Either the humanization lane adds the queue entries with their five fields, or the owner pastes them for this lane to add. Otherwise they're recorded as consumed once the humanized guide carries them.
