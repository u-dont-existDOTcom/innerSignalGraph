# Runner trial: the journal steps up to a first copy (design pull request 3), plan, 28 Nov 2026

Design: `docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md`, section 10, row 3 (accepted; no choice of it is
open). One branch (`claude/runner-journal-steps-20261128`) and one pull request, built in three stages by helpers of the InnerSignal
lane, each stage ending at a clean commit with its own tests, the full gate and one GPT review. The pull request is merged only after
stage 3, with the design's table of rules taken out (section 9) on its final commit. Tests use invented data only, never the owner's
runner, its folder or its port, and no model is called by a test.

## Stage 1: people, consent in version 2's words, withdraw

What it holds (design 4.1, 4.2, 4.3, 4.10, the People tab):

1. **The journal steps' service** (`src/runner-trial/journal-steps.mjs`), built by the trial controller with the case's queue the turn
   controller now offers (`inCaseQueue`): the lock order (a step that needs the folder's lock takes it inside the case's queue), the
   ten seconds' wait for the lock, **Delete wins** (the deletion mark, the deletion count read at admission and checked inside the
   queue and before each later write or call, the registry of running journal work that Delete stops and waits for before it takes the
   queue) and the steps' one-time grants (a copy's: read and write with `archive`, `organize_search`, `session_use`; a tombstone's:
   write with `delete`), shared with the command's import. Delete in the trial controller stops the case's journal work first.
2. **The client list, schema version 2** (`src/runner-trial/clients.mjs`): `journal.consent` with `words` (1 or 2), `journal.tab_consent`,
   and `own_journal` for the owner's own case; a version 1 file is read as version 2 (its consents in version 1's words) and every write
   is version 2. The words of version 2 are the design's, exactly. Delete keeps both consents.
3. **Adding a client and recording consent, shared by the command and the page** (`src/runner-trial/people.mjs`): the keys first,
   then the list, under the folder's lock; a confirmation in version 2's words over a standing version 1 one ("Ask again in the new
   words"), a standing version 2 one unchanged; the tab consent only while the journal consent stands, counted only while both do; the
   owner's own consent without a tab consent. The command's `--journal-consent` shows version 2's words and records them. A start gives
   the owner's grant `session_use` while his own consent stands.
4. **The routes** `POST /v1/runner/people/add`, `POST /v1/runner/consent` and `GET /v1/runner/people`, with the Run log's checks, a
   1 KiB body, the case on the trial's list, and fixed words for a busy folder.
5. **The People tab** on the runner's page: "You" and each client by number and label (as text), "Add a client", "Record consent"
   with both questions and their ticks, "Use my journal", "Ask again in the new words", each withdrawal, and "Ready after a restart".
6. Docs: `docs/RUNNER-TRIAL.md` (people, consent, Delete) and `state/CODEX-CURRENT-STATE.md`.

Tests: `tests/runner-journal-steps.test.mjs` (R21, R29, R30 for the People tab, R36 and R37 for the machinery, R54's consent half and
the version 1 list), with the existing client, journal and start tests kept green.

## Stage 2: Add journal and the preview (design 4.4, 4.5)

The Word reader (`docx-adapter.mjs`, the parsers' child reading `src/core/zip.mjs`, a maximum output length per entry), the kinds and
their byte checks, the preview route with its own body limit and `application/octet-stream`, the preview's numbers in the server's
memory (one a person, three at most, dropped on Cancel, Delete and a restart: registered with Delete wins), the date-order choice,
and the page's Add journal under a person whose consent stands in version 2's words (a server copy under either). Rules R2 to R5, R8,
R11, R12, R45 and R53's preview half.

## Stage 3: the reading, the copy and the owner's own journal (design 4.6, 4.7)

The reading (`journal-reading.mjs`: the sealed Codex port, the ledger, the marks, the held-back pages, Stop and "Go on reading", the
reading key), the copy (`journal-upload.mjs`: the generation, the checks against the stored bytes, the start's sweep of published copies
the list doesn't name, tombstones), the list's new version 2 fields (the reading, the pending copy, the upload digests, receipts by
corpus), the copy joining `RUNNER_WORK_KINDS`, Restart and Stop pausing a reading, the gate for the owner's own case, the owner's case's
Delete clearing `own_journal`'s copy fields and his journal folder, and GPT's questions under a consent in version 2's words (R18's part
"from pull request 3"). Rules R1, R6, R7, R27, R38, R42, R46 to R53, and the table of rules taken out for the whole pull request.
