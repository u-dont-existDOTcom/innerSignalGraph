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
- In the journal quote-first PR, `2026-10-09-teaching-points-for-map-changes.md` was deferred to its own separate change so that review of the journal importer stayed narrow.

## 2026-10-09: teaching-point-to-guide provenance and unsent-reply continuity

- `2026-10-09-teaching-points-for-map-changes.md`: ADOPTED in a separate proposal, pending verified merge and deployment. Reader-relevant changes include canonical AI-guide text and queue teaching points with cause, reader need, prior coverage, and placement; approved T1–T9 points from the October 4 map changes are backfilled without re-humanizing the article.
- The unsent-owner-revision rule is **app-only**: preserving a draft while its editor changes a passage is assistant execution, not a reader exercise. The PR documents that distinction separately from reader-facing changes.
- CI guard and synthetic regression tests are in this change; the public humanized guide is a downstream derivative and is not silently published.

## 2026-10-11: journal pointer pass

- Live lane read on 2026-10-11 (default branch of `u-dont-existDOTcom/universal-dev-architecture`, `ba6d902e`): `suggested-fixes/innerSignalGraph/` holds `2026-09-30-claim-integrity-checks.md`, deferred above until the polish and ship phase, and `2026-10-09-teaching-points-for-map-changes.md`, adopted above in its own change. This branch changes the journal importer only and adds no new disposition.

## 2026-10-14: gratitude map change (PR #159) and the r6 release item

- Live lane read on 2026-10-14 (default branch of `u-dont-existDOTcom/universal-dev-architecture`): `suggested-fixes/innerSignalGraph/` holds `2026-09-30-claim-integrity-checks.md`, deferred above until the polish and ship phase; `2026-10-09-teaching-points-for-map-changes.md`, adopted above; and a new item, `2026-10-11-therapy-r6-coordinated-journal-release.md` (owner request; issue #154).
- `2026-10-11-therapy-r6-coordinated-journal-release.md`: ADOPTED, and already live. The journal lane's coordinated deploy on the owner's question 24 answer A (12 Oct, 01:03 to 01:11 UTC) rebuilt the hosted connector from `main` `f5fccf3f`, which contains PR #152 (`d0fb8c72`) in full. Read on 14 Oct: the connector's source checkout is at `f5fccf3f` with no local changes, its container started 12 Oct at 01:07:31 UTC, and `/health` serves therapy protocol 0.2.1 with `protocolSha256` `14c77194…`, no longer the `d10e6338…` recorded when the item was filed. The owner's instruction (release it with the journal worker's release, without disturbing the import) is met. Not done: the `stable` promotion and the `docs/RELEASE-EVIDENCE.md` record the item asked for; whether to backfill them is the owner's call. Evidence: issue #154, comment of 14 Oct.

## 2026-10-16: journal quote index version 3

- Live lane read on 2026-10-16 (default branch of `u-dont-existDOTcom/universal-dev-architecture`, `0331d252`): `suggested-fixes/innerSignalGraph/` holds the same three items recorded above (`2026-09-30-claim-integrity-checks.md`, deferred; `2026-10-09-teaching-points-for-map-changes.md` and `2026-10-11-therapy-r6-coordinated-journal-release.md`, adopted). This branch changes the journal quote index and its search only and adds no new disposition.

## 2026-10-16: the journal graph on quote index version 3 (issue #168, part B)

- Live lane read on 2026-10-16 (default branch of `u-dont-existDOTcom/universal-dev-architecture`, `fd93d883`): `suggested-fixes/innerSignalGraph/` holds the same three items recorded above, unchanged since 12 Oct. This branch changes the journal pointer run's publication and adds no new disposition.

## 2026-10-17: journal dates by the journal's order (quote index version 4)

- Live lane read on 2026-10-17 (default branch of `u-dont-existDOTcom/universal-dev-architecture`, `6629d489`): `suggested-fixes/innerSignalGraph/` holds the same three items recorded above (`2026-09-30-claim-integrity-checks.md`, `2026-10-09-teaching-points-for-map-changes.md`, `2026-10-11-therapy-r6-coordinated-journal-release.md`), unchanged since 12 Oct. This branch changes how the journal's quotes are dated and adds no new disposition.

## 2026-10-17: known versus new, and the rules with every opened case (issue #172, change A)

- Live lane read on 2026-10-17 (default branch of `u-dont-existDOTcom/universal-dev-architecture`, `6629d489`): `suggested-fixes/innerSignalGraph/` holds the same three items recorded above, unchanged since 12 Oct. This branch changes the served protocol and the shared prompt rules. `2026-09-30-claim-integrity-checks.md` stays deferred by the owner's decision (question 9: C); nothing here adopts it. `2026-10-09-teaching-points-for-map-changes.md` is followed: the reader-facing part of the change is queued as PGQ-038 with its cause, reader need, prior coverage and placement, and the known-versus-new rule is recorded as not reader-facing. No new disposition.

## 2026-10-17: the plan in the case record (issue #172, change B)

- Live lane read on 2026-10-17 (default branch of `u-dont-existDOTcom/universal-dev-architecture`, `6629d489`): `suggested-fixes/innerSignalGraph/` holds the same three items recorded above, unchanged since 12 Oct. This branch adds the case plan to the encrypted case state, its view and a read-only check tool to the connector, and two sentences to the skills; nothing here is reader-facing (`2026-10-09-teaching-points-for-map-changes.md`: declared app-only), and `2026-09-30-claim-integrity-checks.md` stays deferred. No new disposition.

## 2026-10-17: the second independent review of change B (issue #172)

- Live lane: the Universal default branch is still `6629d489` (`git ls-remote`), the commit read above, so `suggested-fixes/innerSignalGraph/` holds the same three items; no new disposition. The review's findings, each with its outcome (tests in `tests/case-roadmap.test.mjs` unless named):
- P1, other goals became the client's when she moved, parked or declined them (the take-over rule): fixed. `priority_source` is whose goal it is and changes only by her agreement or an authorized `adopt: true`; test "a goal stays whose it is when the client moves, parks or declines it".
- P1, a swap put a goal ahead of the client's without changing her goal's number: fixed. Another source keeps the goals ahead of each goal it may not move, and the view lists the client's goals first; test "no other source slips a goal ahead of one it may not move".
- Design question, whether an authorized step linked to the episode may take the current step from hers: answered no by the coordinator; `linked_elsewhere` and `episode_serves` show it; same test.
- P2, a parent goal parked, superseded or moved out from under her step: fixed; test "no other source parks, supersedes or moves a goal that holds an active goal of the client's".
- P2, her notes erased or overwritten by an authorized plan: fixed (lists only grow, notes are written only while empty); test "on a goal the client chose, another source keeps her notes".
- P2, one date up to a day ahead held up every later decision: fixed (five minutes); the time-order test and the store test.
- P2, a declined goal offered again by retitling another goal or adding an article: fixed; test "a goal the client declined isn't offered again".
- P3, the audit and repair prompts carried the stored plan: fixed; test "the private audit and repair prompts show a stored plan as its view".
- P3, the check tool failed on a plan it couldn't read and counted superseded items as current: fixed (`plan_problem`); the known-versus-new test and the store test.
- P3, client references: goal references unchecked, any artifact accepted, journal entries refused: fixed for the first two; journal entries stay refused (a decision cites what the client said in a session; a journal entry is material), written in the operator doc; the store test.
- P3, a plan decision found by its turn in place of the turn's own diff, and the `roadmap:` prefix open to other writers: fixed; the store test.
- P3, no way to record on a plan another version wrote, and a whole-state write without a state threw a TypeError: the message now says another version wrote it and records decisions on it, a carried plan is ignored by design (documented), and a missing state is a validation error again; the store test.
- P3, `proposals_only` counted finished and declined goals: fixed; test "a plan reads as proposals only while some goal is active".
- P3, her review condition and episode link on a proposal could be undone, and were logged as notes: fixed; test "what the client decided last about a goal stays as she decided it".
- P3, impossible dates such as 30 February passed: fixed (a time must round-trip); the time-order test.
- The full verify of `c769d642` failed two liveness tests: the case store reached `ajv` through the known-versus-new check. Fixed with `src/journal-import/lexical.mjs`; `tests/private-case-store-imports.test.mjs` and `tests/runtime-service-liveness.test.mjs`.
