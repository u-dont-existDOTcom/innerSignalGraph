# Runner trial: a case per client, and a client's journal

Written 23 Nov 2026; revised the same day after two read-only Codex reviews (appendix). The owner chose option a on 24 Nov 2026
("i73 1a"); what is built is in "As built" at the end. It extends the
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
  journal is on record. The response-evidence design (26 Oct, section 6) keeps the journal provider unconfigured until a
  generation's source consent, publication, cold-test and release criteria are met, the controller's journal slot says so too,
  and the trial design (section 14) leaves the journal provider out of the trial.
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
   the corpus (trial design, section 6). (Superseded as built, part 2 below: nothing is staged, the sealed file stays outside the
   trial folder for the owner to delete, and the client's Delete removes the key that opens it.)
5. **The gate.** (a) The owner has confirmed the client's consent, recorded with its time in the trial folder: that InnerSignal may
   use their journal in these sessions, and that their words and journal excerpts go to the companies running the trial's workers
   (with `--provider mixed`, Anthropic and OpenAI, both accounts set not to train on chats: trial design, section 6). The runner
   reads that record at every retrieval and again at every delivery, because grants are read once at start: after a withdrawal
   nothing more is retrieved, no undelivered reply resting on the journal is delivered (its turn closes, also when found at a
   restart's reconcile), and the next start drops `session_use` from that client's grant. (b) The corpus's active generation is
   published for `session_use` (the reader's own check). (c) A passing
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
  released change that reads the trial's records: a much bigger change than this trial.

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
| 9 copies outside the case | Point 4, as built in part 2: no staging; the sealed file is the owner's to delete, and the client's Delete removes the key that opens it |
| 10 visual reading doesn't feed the quote index | Moot with the export route; the clause is gone |
| 11 option c overstated | Section 3: a released change that reads the trial's records |
| 12 section 1 overstated | Section 1: "no other vault is known", from the import's scripts and notes; the cold test "isn't wired", no pass on record |
| 13 the 8,000 tokens | Sections 1 and 4: quotes per retrieval, sent again at each repair; section 3: option a's further costs |
| New: a reading-first import needn't be all model | Section 1: the model reader or authorized page reviews |

## As built (24 Nov 2026, branch `claude/runner-client-cases-20261123`)

Built on the runner branch at `df4322317` with `main` at `343bec014` (pull request 241) merged in; the merge's resolutions are in its
commit message. Option a, the separate vault kept:

- **Points 1 to 3** as proposed. `--add-client` takes the label at a hidden prompt, so it never goes on the command line or the
  screen; `--journal-consent confirm|withdraw` asks for the client's number, which the page shows beside the label. The terminal
  never prints a label. Client tokens reach the server only through `INNER_SIGNAL_RUNNER_TRIAL_CLIENT_TOKENS`, read beside the
  owner's token, never into the config. `/health` still names the owner's own case, but the page takes its cases from
  `GET /v1/runner/clients`.
- **Point 5** as proposed, with the cold-test receipt's shape fixed here (`validateColdTestReceipt` in
  `src/runner-trial/clients.mjs`), since the cold test that will write it isn't built. The gate re-reads the consent after each
  read, and the delivery of an approved reply written with a journal in view reads it again.
- **Point 6** as proposed, with one change: an approved reply that may no longer be sent (response evidence no longer admits it, or
  the journal consent it was written with is withdrawn) closes as a failed check (`checks_failed`, "No reply passed its checks."),
  not under a new closing reason, so the trial's closing reasons, the owner's fixed message and its switches stay exactly as he
  decided them. The store checks the refusal again before it closes an approved turn, and refuses any other closing of one.
- **Point 7**: `tests/runner-client-cases.test.mjs` and `tests/runner-client-journal.test.mjs`, with invented clients, the journal
  import's synthetic journal fixture and a planted receipt.

Codex's first review of the build (24 Nov) found nine problems, all fixed: the gate is checked again right before every call that
would carry the journal, retries included, for the whole turn once it has read the journal (a later snapshot without quotations
doesn't hide a draft that quotes it), and fully (consent, the same copy, the receipt, the grant) before every delivery; the store
closes an approved reply that read the journal only with the trial's explicit journal hold, never for its quotations alone; the
page applies a deletion, a handoff or a saved entry to the case it was asked for, keeps what was typed with its case and empties
the case's forms on a switch; a start, `--add-client` and `--journal-consent` change the trial folder one at a time, under a lock,
with each rename synced to its folder; and the server takes the case tokens out of its environment once read, so no subprocess
(a model CLI's capability check included) inherits them. What a withdrawal doesn't undo is in `docs/RUNNER-TRIAL.md`: replies
already delivered stay in the conversation, which later turns' workers read.

Codex's second review (24 Nov) found that guarding one path at a time kept leaving another (an earlier turn's unsent draft in a later
turn's evidence, the worker's own preparation before its packet leaves, a changed publication). That class recurred, so the
mechanism changed instead of growing more exceptions: **a case that has read its client's journal is used only while that client's
journal gate is open now** (consent, the same copy, the grant with session_use, a receipt for exactly the current publication),
asked when a turn starts, before every worker call, by the worker at its last moment, and before delivery. While it is closed the
case makes no model call and delivers nothing; confirming the consent again or deleting the case are the ways on. The cost, a
tradeoff for the owner: after a withdrawal, a case that has used its journal gives no replies until one of the two. The same
review's other findings are fixed too: the store's journal hold needs a case that has read its journal (the gate itself stays the
trial's record, outside the case, so the store can't evaluate it; the hold only ever stops a reply); the folder lock is never
taken over by a command; a failed folder sync stops a command; and a deletion invalidates what the page had asked of the case.

Codex's third review (24 Nov) found the same stop needed for a provisional reply, and two timing gaps; all fixed: a provisional reply
in such a case is shown only while the gate is open (the fixed emergency line otherwise), the gate reads the consent again last,
after the copy and the receipt, and a start holds the folder's lock until its server has read the credentials. It found the store's
journal hold sound under the trial's trust boundary, since it can only ever stop a reply.

Codex's fourth review (24 Nov) found the timing class once more, between a check and the output to the person (a provisional reply,
a delivery), which wait for an encrypted write. A further check can't close that, so the output is serialized with consent changes:
in a case that has read its journal, the gate check, the record of the text as shown and the output itself happen under the trial
folder's lock (`src/runner-trial/folder-lock.mjs`), which `--journal-consent` takes too.

Codex's fifth review (24 Nov) found the class one stage later again: after the locked record, the reply still travels to the page
(the HTTP answer, a reconcile). That was the fourth recurrence, so the boundary is now a stated decision rather than a further
check: **an output is made when it is recorded in the case as shown or delivered**, under the lock, so a withdrawal is ordered
before or after that moment; sending an output already recorded to the page, or showing the conversation again, is not a new use
of the journal. Recalling an output already recorded would need the page and the HTTP layer inside the lock, for a gain the owner
can weigh (lane question). The same review's minor finding is fixed: a lock file is removed by its identity, so a failed first
write never leaves it behind.

Not built on this branch, each needed before any client's journal reaches a reply: **point 4, the copy step**, and **the
journal's cold test**. Both are on the next branch (below).

## As built, part 2 (24 Nov 2026, branch `claude/runner-journal-copy-20261124`, stacked on the first)

The lane's instruction after pull request 244: the copy step and the cold test, built and tested on made-up journals only, with no
server contact; each real copy runs only on the owner's say. An independent review (Claude) of the first three commits found nine
problems, GPT's review of the branch with those fixed found ten more (two blocking), and its review of the branch with those fixed
four; this is as built after all three, and what GPT's reviews changed is listed at the end.

- **The export** is the journal import's `export` command (no longer only planned), run where the journal lives. Its settings come
  from the import's private configuration (`runner_trial_export`: the corpus, one client's public key, a new file outside the
  checkout, the scope the operator's grant holds), checked before any env file is read or any sign-in is attempted. It asks the
  vault's `export` purpose (the journal leaves the vault), opens the active generation, published for session use, through the
  session-use reader's own snapshot checks, and reads it whole: the records, the source texts, the indexes its builder added (the
  quote index's `quote_meta`, `quote_terms` and the like), and the order of its sources. The bundle is sealed for that one key
  (X25519, HKDF-SHA-256, AES-256-GCM with a 16-byte tag); a change to the file fails the seal. It is written to a private temporary
  file (mode 0600), synced, and given its name by a hard link, never over another file, so an export killed part-way leaves nothing at
  that name and can be run again; on a filesystem without hard links it publishes nothing and fails. The seal keeps the copy
  confidential; it doesn't prove the sender, so only a file the owner carried from the export is imported. Code:
  `src/journal-import/journal-copy.mjs`, `src/cli/journal-import.mjs`.
- **Each client has a key of their own** (`journal/<case id>/copy-key.json`, mode 0600; `--copy-key`), so a copy sealed for
  another client can't be opened, and the client's Delete, which removes their folder, also removes the means to open any copy
  sealed for them.
- **The import** is `scripts/runner-trial-journal.mjs --import`, the adapter for the trial's development credentials. It takes a file
  outside the trial folder, reads it through one opened handle and leaves it there: point 4's removal once the copy is published is
  superseded. The owner deletes the file, and one that's left can't be opened once the client's Delete has removed their key.
- **A client's copies come from one server case until their Delete.** A copy of a journal already copied for another client is
  refused. Before the vault is touched, the client list names the server case the copy comes from (a digest of its id; a server case is
  one person's, whatever its corpora), and keeps it when a later step fails. So every copy the vault may hold, an unfinished import's
  included, has its one client on the list, and neither another server case for that client nor that server case for another client
  is imported. The client's Delete, made under the trial folder's lock, removes the case with its copies, then their place on the list,
  then their folder; without that lock nothing is deleted. Once the vault has deleted the case, each of the rest (those two, what the
  runtime remembers, the run log) is tried whatever became of the others; what couldn't be cleared comes back as fixed codes
  (`cleanup_left`), the page forgets the case all the same and names it, and Delete again clears it (the vault's deletion of a case
  that's gone finds nothing and goes on).
- **Under the trial folder's lock and the vault's writer lock** (so only while the trial is stopped), with a grant made in the process
  for that command and that case alone (write, and the archive, organize_search and session_use purposes the store asks), the import
  checks the whole bundle before anything is written to the vault (its digest, its graph, and its generation built once into a store
  that keeps nothing), rebuilds the graph under the client's runner case and a corpus the copy names, keeps the source order and the
  builder's own indexes, and publishes it for session use without archive. Then it checks what is stored against the export: every
  usable quotation against the stored bytes (200 at a time; a deleted or revoked passage is never resolved as evidence), every record
  (those included), every source text and every index of the builder; and the list names the corpus. The same file again is checked
  again; a copy an earlier import left unpublished is refused. Every import, the same file again included, drops the copy's receipt and its test's marker; the
  earlier copy stays in the case, unused, until the client's Delete (a limit).
- **The cold test** is `--cold-test` (`src/runner-trial/journal-cold-test.mjs`), on the journal import's cold-consumer runner: a
  fresh consumer gets the frozen questions and what the session-use reader retrieves, graph on and off, never the key; the
  controller scores what the consumer declares (its answerability, the passages it cites) exactly; and a judge checks what an answer
  says. The key names evidence by exact words of the journal, each found in one to three usable passages, so whoever writes the
  questions needs no internal ids; a right answer has words and cites a passage for each. The file's own question ids go nowhere: the
  consumer, the judge, the report and the errors name a question by its place in the file.
- **The judge** is one more fresh call of the same worker for each question whose graph-on answer passed the exact checks, with the
  question, whether the journal answers it, its key quotes (none when it doesn't) and that answer, and nothing else. For a question the
  journal answers it says whether the answer says what the quotes say about it and contradicts nothing in them; for one it doesn't
  (absent, false premise), whether the answer says so, or that the premise is wrong, and tells nothing as the journal's. A pass needs
  its yes for every question, and an answer of its own outside its strict schema stops the test. Its reason isn't kept. Limits: it is
  the consumer's own worker, not another company's model, and it knows only the key quotes, so it can't tell whether a detail they
  don't mention is in the journal; and a true correction of a false premise, which the consumer's own instruction asks for with
  evidence, is a no when it tells what the journal does say, so a faithful copy can fail on it.
- **A test that starts removes the copy's receipt; only a pass gives a new one.** So a wrong or malformed answer, a judge's no, a
  failed call, a key quote that doesn't fit, a withdrawal or a deleted case leaves none, and a wrong answer followed by an error can't
  leave an earlier pass standing. **Of tests that overlap, the one started last decides:** each writes a marker when it starts, next to
  removing the receipt (`cold-test-attempt.json` in the client's journal folder: a random id and the time), and a pass is recorded, or a
  receipt taken away by a test that doesn't pass, only while the marker, read again under the folder's lock, still names that test. So
  an earlier test gives no receipt once a newer one has started, also one that failed or was killed, and takes none of its away. The
  gate reads the receipt alone, as before. The worker is the trial's whole-reply checker, signed in (`claude -p` or `codex exec`), no
  API. It needs the client's confirmed consent, read again under the trial folder's lock (which `--journal-consent` takes) right before
  each packet is handed to the worker's process, the lock being released before that hand-over, and again under it before the receipt
  is written. **The boundary:** a withdrawal lands wholly before that reading, and the packet doesn't leave, or after it; one that lands
  after the hand-over is honoured at the next packet and before the receipt is written.
- **What the commands print:** numbers, scores, an opaque name for the snapshot tested (a digest's first 16 characters) and fixed
  texts. An unexpected error prints its code, never its own text, which can quote what a file holds.
- The journal import's own question freeze (`src/journal-import/cold-question-freeze.mjs`) needs the import's audit report, which the
  copy doesn't carry, so the questions come from a file.
- **Method choices left to the owner:** who writes each client's questions (the owner, or a separate question writer reading the
  journal, never the consumer), how many and of which kinds, whether to keep the judge (and with which worker), and the strict pass
  rule (every question right with the graph, evidence retrieved and cited for each key quote, the judge's yes, the graph at least as
  good as without it).
- **Tested** with made-up journals and stand-in workers only: the sealed export, refused without the export purpose or when the
  published reference isn't its manifest's, written whole or not at all (failures and kills part-way, no hard links, another file
  there); a copy refused for another key, after tampering or with a short tag; the import refused while the vault is held, for the
  wrong client, from inside the trial folder, for a link or another file, for a journal already copied for another client, or from
  another server case than the client's own, an import that fails before and after the vault is written, and Delete in between; a
  Delete whose later steps fail, each alone and all together, and through the server's route and the page's own code, pressed again
  each time; a bundle whose graph or index doesn't hold refused with nothing written to the vault, and an unpublished earlier import
  refused; a copy of 210 passages, one with a record larger than its usual shards, one with deleted and revoked passages, one with a
  source text stored in chunks, and a quote generation as the journal import builds it; the source order and the builder's indexes
  kept; the record-by-record and text-by-text check; the same file again; a cold test that passes, one that misses, claims a false
  premise, cites part of the evidence, cites a passage it wasn't given or has no words, one the judge refuses (an invented answer
  declared as none included), one with no judge, one stopped by an error at each kind of call, through the real port and a stand-in
  worker; tests that overlap, the newer one passing, failing, still running or killed; a consent withdrawn before each kind of packet,
  during a call and before the receipt; what each command prints, with malformed files; the private files' reader with links, loose
  modes, folders, pipes and sockets; and the receipt opening the gate under the client's own grant. Nothing here was run against a
  model or a real journal.

What GPT's review of 24 Nov changed (its findings, in its order): a client's server case is fixed on the list before the vault is
touched (1, blocking); the judge, and an answer needs words (2, blocking); a test that starts removes the receipt (3); the consent read
under the folder's lock before each packet (4); numbers and an opaque name in the report, and the file's ids sent nowhere (5); no
unexpected error's text printed (6); deleted and revoked passages copied and compared, never resolved (7); the sealed file left where
it is (8); the client list and the receipt read through one opened handle (9); the export published by a link (10). Found on the way:
Delete left a client's copy on the list, so "until their Delete" (1) and a cold test that stops for a deleted case wouldn't have been
true. It now takes both off the list, under the folder's lock.

What GPT's second review of the branch (24 Nov) changed: the attempt marker, since an older test could pass after a newer one had
started and been killed (1); the judge for every question, since an invented answer declared as not found passed (2); a deletion done
once the vault has done it, since a failure after that was told as "not deleted" and kept the page's and the runtime's state (3); and no
export where hard links can't be made, since the fallback could leave a partial file at the final name (4).
