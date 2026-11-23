# Runner trial: a case per client, and a client's journal

Written 23 Nov 2026; revised the same day after two read-only Codex reviews (appendix). A proposal, not built. It extends the
runner trial (`docs/superpowers/specs/2026-11-21-runner-trial-design.md`, "the trial design" below) so that the trial can serve
the people a practitioner works with ("clients"), with the client chosen for each conversation, and so that a client's imported
journal can inform that client's replies through the session-use journal reader of
[pull request 241](https://github.com/u-dont-existDOTcom/innerSignalGraph/pull/241)
(`createSessionUseJournalEvidenceProvider` in `src/journal-import/response-evidence-journal.mjs`). Its one open choice, whether the
trial keeps its separate vault, is the owner's (InnerSignal question i73). No client name, journal text or other private content
appears here, in a test or in a log.

## 1. What exists

- **One case in one vault of the trial's own.** The start script makes one folder holding `vault/` and `credentials.json`, with one
  grant (read, write, audit) for one case; the server is told that case, and `/health` makes the page adopt it
  (`docs/RUNNER-TRIAL.md`). The run log is one file, `runner-log.jsonl`.
- **The separate-vault rule** (trial design, sections 1 and 11). The trial writes records that a build without the trial can't read
  (its closings, readings, provisional replies and kept plans), so it keeps a vault of its own: it opens no other vault, and no
  other build opens its vault. Neither `main` nor `stable` holds the trial's code, so the rule protects every released build.
- **A client's real record and imported journal** are in the hosted vault on the server the journal import ran on, encrypted
  under the server's own case keys, and the hosted connector reads them. The import's scripts and notes say so (not checked on the
  server for this note), and no other vault is known on the laptop the trial runs on.
- **The journal reader** (pull request 241) is opt-in, and nothing constructs it. It needs a grant with `case:read` and the
  `session_use` purpose, opens the corpus's active published generation, refuses one whose manifest doesn't permit `session_use`,
  makes one lexical search, checks each quote against the stored bytes and keeps its quotes to about 8,000 tokens (estimated) and
  64 KB per retrieval. It reads a local vault.
- **The cold test isn't wired yet.** The journal import lists `cold-test` among its planned commands
  (`JOURNAL_IMPORT_PLANNED_COMMANDS` in `src/cli/journal-import.mjs`: question freezing, the separate consumer and scoring aren't
  joined yet, though pieces such as `src/journal-import/cold-profile-runner.mjs` exist), and no passing cold test of the imported
  journal is on record. The controller's journal slot is for a session-use generation that passed its cold test, and the trial
  design (section 14) leaves the journal provider out of the trial.
- **A new import reads before it indexes.** By the owner's default for new imports (`reading_first`,
  `src/journal-import/reading-first-runtime-gate.mjs`), a quote index can't be built from the source's text alone: `build-quotes`
  needs an authenticated reading of the whole source first (the import's model reader, or authorized page reviews), and
  `publish-quotes` is refused in that order. The import's `export` is planned, not built; moving a generation works only between
  stores of the same case and corpus (`src/journal-import/generation-transfer.mjs`); and the import loads the server's provider
  unless it is given another access service.

## 2. Proposal (option a: the separate vault kept)

1. **A case per client, in the trial's own vault.** The trial folder gets a client list (`clients.json`, mode 0600): one row per
   client with a label the owner chooses and a case id, beside the owner's own case as it is today. `--add-client` makes a client's
   case with keys of its own. Labels are shown only by the page on this laptop, through a route with the page's local-owner and
   same-origin checks; they go into no Git file, log, run log, worker packet or report.
2. **Each client's own grant.** One grant per client case (read, write, audit), with a new random token per grant at every start,
   of which only the SHA-256 is kept, as today. The server holds the tokens in its environment and uses the chosen client's token
   for every operation of that client's turn, so a turn can open no other client's case or journal. A client's grant holds
   `session_use` only after the owner has confirmed that client's consent (point 5).
3. **The client chosen per conversation, on the page.** A conversation starts only once the owner has picked who it is with (no
   default), and the page asks once more before its first message: a wrong pick can't be undone short of deleting that client's
   case, since the transcript is append-only. The label stays at the top of the conversation. `/health` no longer makes the page
   adopt a case. Every request names its case, and every answer (a stream line, a final reply, a reconcile) is tied to the request
   and the choice that sent it, so nothing that comes back for one client shows under another, also after switching away and
   back. Switching client clears the page's case state, as adopting a case does today, keeps the trial's own page state (the
   resume question, the new-conversation flag, a turn in flight) per client, and brings that client's conversation back through
   its reconcile. Each client has their own conversations, risk record, kept plan, Delete button and run log file, which is
   written and deleted only with that case. The server refuses a case that isn't on the list.
   Every message of a client's conversation is read as the client's own words, so the owner's own notes don't belong in it.
4. **The journal, copied into the client's runner case.** The server's published generation, exported once per client (and again
   after the journal there is updated) and published in the client's runner case on this laptop for `session_use`. Three things
   have to be built for it: the import's `export`, encrypting the generation for the trial alone; an import into another case,
   which binds the copy's manifest and objects to the client's runner case and corpus and checks every quote against the export
   (today a generation moves only within its own case and corpus); and an adapter that runs it against the trial's development
   credentials. It runs while the runner is stopped (the vault's writer lock), under a one-time grant for that case alone (write,
   with the `archive`, `organize_search` and `session_use` purposes the import checks). The export is a server step (the import's
   build put on the server and run there), only on the owner's go. Making the copy from the source on the laptop instead means a
   new reading-first import, which reads the whole journal again. The copy is protected like the rest of the trial by its
   development key file (whoever can read the owner's files can open it). The bundle and any staging stay in one folder per client
   inside the trial folder, removed once the copy is published and, finished or not, by that client's Delete, which also deletes
   the corpus (trial design, section 6).
5. **The gate.** (a) The owner has confirmed the client's consent, recorded with its time in the trial folder: that InnerSignal may
   use their journal in these sessions, and that their words and journal excerpts go to the companies running the trial's workers
   (with `--provider mixed`, Anthropic and OpenAI). The runner reads that record at every retrieval and again at every delivery,
   because grants are read once at start: after a withdrawal nothing more is retrieved, no undelivered reply resting on the
   journal is delivered (its turn closes, also when found at a restart's reconcile), and the next start drops `session_use` from
   that client's grant. (b) The corpus's active generation is published for `session_use` (the reader's own check). (c) A passing
   cold-test receipt names exactly that generation, its manifest and its visibility epoch, so a pass on the server's generation
   doesn't carry over to the copy by itself: the test runs on the copy, or the build binds the receipt to the quotes both share.
   A lost receipt counts like a withdrawal. Short of any of the three, no reader is attached for that client: their turns get no
   journal, and replies are made from the conversation alone, as today.
6. **Wiring.** Once pull request 241 is merged into `main`, and `main` into this branch (a trial merge of the two branches on
   23 Nov conflicts in `src/core/config.mjs`, `src/storage/private-case-store.mjs` and
   `src/supervisor/private-therapy-turn-controller.mjs`): one session-use reader for each client corpus that passes the gate,
   chosen by case id. The trial's writer, checker and repair take pull request 241's evidence snapshot with its inclusion receipts
   (today they take the older `journalEvidence` slot), the checker returns the evidence review it defines, and the shared admission
   check runs at the trial's delivery. The trial's exact-quote check learns the snapshot's journal sources: its quote map holds
   conversation turns only, so today a true journal quote would be blocked. A reply approved before its journal changed is no
   longer admissible, so the trial's reconcile closes such a turn instead of retrying its delivery: a guarded move from `APPROVED`
   to `UNANSWERED` in the lifecycle and the store, which today allow an approved turn only to be delivered.
   `--response-evidence` turns `INNER_SIGNAL_RESPONSE_EVIDENCE` on for the trial (off unless given); off, no reader is attached.
7. **Tests**, with invented clients, invented journals and a planted cold-test receipt: one client's token opens no other client's
   case or corpus; a reply or stream line for one client never shows under another; no journal without consent, without the
   receipt, with a receipt for another generation, or after a withdrawal; a client who passes the gate gets quotes from their own
   journal only, and they pass the exact-quote check; deleting a client's case removes its corpus and only its log; with the
   response-evidence setting off, every worker's packet is byte-identical to before.

## 3. How this squares with the separate-vault rule

Option a keeps the rule as it is: the runner opens only its own vault, and no client's real record is opened or written, so the
connector keeps reading every one of them. What it costs: the runner sees only its own conversations with a client, not what the
real record holds (earlier sessions through the connector, the plan); the journal exists twice, the laptop copy behind the server's
until the next export, with a bundle and staging on the laptop while a copy is made; and the export, the import into another case
with its check against the export, and the adapter have to be built first.

The two other options change the rule, so neither is built without the owner's words:

- **b. Read the real record and journal from the server, read-only.** The runner still writes only to its own vault, but every
  turn reads production from the laptop with a hosted sign-in kept on it, and the reader becomes a remote one (pull request 241's
  reads a local vault; the connector's journal tools, such as `find_journal_quotes`, could back it). One copy of the journal,
  always current, and the earlier sessions could be background. When the server can't be reached, a reply goes out without the
  journal.
- **c. Open the real record itself.** The runner reads and writes the record that the import and the connector use. That record is
  on the server, so the runner would run there (or the record move to the laptop), and the released connector would first need a
  released change that reads the trial's records: in effect the hosted runner, not a change to this trial.

## 4. Limits

- Until the cold test is wired and has passed on a client's generation, no client's journal reaches a reply, under any option.
- What the page shows is recorded as shown on the page; a reply the owner then sends to a client is his act, and isn't recorded.
- A reply with a journal part sends up to about 8,000 more tokens of quotes to the writer and the checker, again at each repair.
- Not here: the cold test itself, the phone, a public copy. Point 4's export is the one server step, only on the owner's go.

## Appendix: Codex's reviews (23 Nov) and what changed

Codex reviewed the first draft (13 findings), then checked the revision (7 fixed, 6 partly, one new); the table gives where each
now stands.

| Finding | Change |
|---|---|
| 1 a reply approved before its journal changed can't be delivered | Point 6: the reconcile closes it, through a guarded move from `APPROVED` to `UNANSWERED` |
| 2 switching client needs the page's state kept apart | Point 3: answers tied to their request and choice; the trial's page state per client; no adoption from `/health` |
| 3 the import loads the server's provider | Point 4: an adapter for the trial's development credentials; the grant's purposes |
| 4 a new import reads before it indexes | Section 1 and point 4: an export, an import into another case checked against the export, the cold-test receipt for the copy |
| 5 evidence wiring is more than a packet | Point 6: snapshot, receipts, review, admission; no reader with the setting off |
| 6 the exact-quote check knows turns only | Point 6: it learns the snapshot's journal sources |
| 7 withdrawal, and grants read once | Point 5: the consent record read at every retrieval and delivery; no journal-backed reply delivered after a withdrawal |
| 8 one run log file | Section 1 and point 3: one file per client case |
| 9 copies outside the case | Point 4: bundle and staging in one folder per client, removed after publication and by the client's Delete |
| 10 visual reading doesn't feed the quote index | Moot with the export route; the clause is gone |
| 11 option c overstated | Section 3: a released change that reads the trial's records |
| 12 section 1 overstated | Section 1: "no other vault is known", from the import's scripts and notes; the cold test "isn't wired", no pass on record |
| 13 the 8,000 tokens | Sections 1 and 4: quotes per retrieval, sent again at each repair; section 3: option a's further costs |
| New: a reading-first import needn't be all model | Section 1: the model reader or authorized page reviews |
