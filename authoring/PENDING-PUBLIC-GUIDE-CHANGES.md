# Pending public guide changes

Status: **EMPTY**
Queue version: 2026-11-04-r21
Guide family: `inner-child`

This is a downstream **humanization queue**, not therapy authority. Canonical guide/source files, owner amendments, and executable graphs remain upstream authority under `docs/PUBLIC-GUIDE-HUMANIZATION.md`.

A humanizer continuing the Inner Child public guide must reconcile every entry below against frozen current upstream authority. Preserve therapeutic meaning, but rewrite, combine, move, or compress freely for reader quality. If an item is already present semantically in the public draft, consume it without duplicating prose.

## Consumption contract

- Consume an entry only when its reader-facing meaning has actually been incorporated or deliberately dispositioned under the public-guide sync rules.
- After consuming a subset, remove only those entries and leave this file `PENDING`.
- After all entries are consumed and `authoring/public-guide-sync.json` is updated for the affected obligations, reset this file to the EMPTY sentinel at the bottom. Do not delete the file.
- A later approved map/source/rule change that affects reader-facing meaning must change the sentinel back to `PENDING` and append the new obligation in the same reviewed change.
- Runtime-only mechanics do not belong here.

No pending reader-facing semantic changes. Add the next approved reader-relevant map/source/rule change here in the same reviewed change that creates it.

## EMPTY sentinel

When every pending entry above has been consumed and the public-guide sync bookkeeping is updated, replace all pending bundles with exactly:

`Status: **EMPTY**`

`No pending reader-facing semantic changes. Add the next approved reader-relevant map/source/rule change here in the same reviewed change that creates it.`

## Last reset

Reset on 4 November 2026 at the owner's request (2026-11-04 10:02 UTC: "make sure you clear the humanization queue"). All 52 entries of queue version 2026-10-31-r20 (PGQ-001 to PGQ-055; there was no PGQ-044 to PGQ-046) were read against the owner's humanized Inner Child guide (`u-dont-existDOTcom/joel-articles`, `articles/inner-child-therapy/HUMANIZED-ARTICLE-SO-FAR.md`, SHA-256 `100c3c7685ef0c34d4230da912309ffd9542d9b4d2c047666d2f9c1012c4dae7`): 26 in, 25 with the core point in his own words and the rest left out as his call, and 1 left out (PGQ-036). Each entry's fate, with the guide's words that carry it, is in the humanized guide lane's record (`articles/inner-child-therapy/experiments/t120-queue/QUEUE-CLEARED.md` at `9e639bf19`) and in `authoring/public-guide-sync.json` under `inner-child`. The entries' text is in this file's history (`git show ca535c0e9:authoring/PENDING-PUBLIC-GUIDE-CHANGES.md`).
