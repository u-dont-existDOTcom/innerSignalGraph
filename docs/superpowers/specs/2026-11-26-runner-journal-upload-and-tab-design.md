# Runner trial: a journal upload and a Journal tab on the page, with the tool that writes a copy's questions

Written 26 Nov 2026 by a helper of the InnerSignal lane, for the owner's answer `i80 1a 2a 3a` (26 Nov 2026) and the tool that his
`i77 3a` (24 Nov 2026) asks for; revised after read-only Codex reviews (appendix). A design only: nothing here is built, and each of
the build's merges comes to the owner (promise IS27, within IS24). It extends the runner trial
(`docs/superpowers/specs/2026-11-21-runner-trial-design.md`), its clients and journal copy
(`docs/superpowers/specs/2026-11-23-runner-client-cases-design.md`, "the clients design" below) and the replies' journal search
(`docs/superpowers/specs/2026-11-24-runner-journal-search-design.md`). No client name, journal text or conversation appears here, in
a test or in a log.

## What the owner decided

- **i80 `1a 2a 3a` (26 Nov):** a first slice on the runner's page, without the terminal (IS24): an upload button for PDF with text,
  `.txt`, Markdown and Word `.docx` (2a), with his consent step, the cold test and "Add more"; a Journal tab with a calendar of
  writing days and "their own words, then and now" (dated quotes for a theme that is picked); a client's tab shown to him only with
  that client's consent, asked in the consent step (3a).
- **i77 `1a 2b 3a 4a` (24 Nov):** no journal is used until its copy passes the cold test with not one wrong answer (2b, rule
  `journal-cold-test-rule-v4`); GPT writes a copy's questions and planted wrong answers from the journal's own quotes, part of the
  questions in other words than the journal's (3a: the tool of section 3); a withdrawn consent stops the client's whole case (4a).
- **i73 `1a` (24 Nov):** each client's own case in the runner's own encrypted vault on the laptop; the journal copy step; his
  consent step.
- **IS24 (24 Nov: "rather not use terminal can we make everything gui"):** an icon that starts the runner, and on its page: add a
  client, record or withdraw a consent, bring in a journal copy, run its cold test, the switches (IS23), restart and stop.
- **IS23 (24 Nov):** for each conversation, use this person's journal or not, and the check of each reply against its sources.

## Lines held

- Describe, never judge or score: no progress words, trends, streaks, arrows or scores.
- Nothing about wanting to die is charted or quoted in the Journal tab.
- Each person sees only their own; the owner sees a client's tab only with that client's consent.
- The copy stays encrypted on the laptop; no log holds words (no label, theme, file name, journal text, question or answer).
- The Journal tab makes no model call: everything in it is computed on the laptop.
- Every flow of journal text to a model is stated (section 6). GPT reading a copy to write its questions, and the cold test's
  workers reading passages, are decided; any other flow, and any other choice that is the owner's, is a question (section 11).

## 1. What exists, and what shapes this design

1. **Clients and consent are terminal commands.** `scripts/runner-trial-start.mjs --add-client` (a hidden prompt for the label) and
   `--journal-consent confirm|withdraw` write `clients.json` under the trial folder's lock. Grants are minted at each start from that
   list (`prepareCredentials`), and the server's key and authorization providers read `credentials.json` once, at start: a new
   client, or a consent's `session_use` purpose, takes effect only at the next start. A withdrawal holds at once, since the gate reads
   the list at every retrieval and before every output.
2. **The copy step needs the trial stopped.** The server export is sealed for the client's key; `scripts/runner-trial-journal.mjs
   --import` opens it on the laptop under the trial folder's lock and the vault's writer lock, which the running server holds. The
   page can't call it: whatever the page does to the vault has to run inside the server.
3. **The cold test takes a questions file.** `--cold-test FILE` reads a `journal_cold_questions` file (author `anthropic`, `openai`
   or `person`, never the judge's company) and runs `runJournalColdTest`; only a pass writes `journal/<case id>/cold-test-receipt.json`.
   No tool writes the file yet. The rule (`COLD_TEST_RULE`) needs at least 40 answerable questions that share a search word with all
   of their evidence, 20 unanswerable ones for which the search returns something, and 20 planted wrong answers, three of each of five
   kinds; each key quote is found in one to three usable passages, a passage is the evidence of at most two questions, and a file
   holds at most 100 questions. The rule sets no size for a journal.
4. **The gate.** A client's journal reaches a reply only through the session-use reader, with `--response-evidence` on, while the
   consent, the copy, the grant and a receipt for exactly the current publication, reader and rule hold (`journal-gate.mjs`). Once a
   case has read its journal, it makes no model call and delivers nothing while its gate is closed (`runtime.mjs`,
   `journalGateAllows`); a case that has never read it goes on. The owner's runner runs with `--response-evidence` off: switching it
   on is IS22's own question, so until then no reply uses any journal, whatever passes. The owner's own case has no journal path: the
   gate looks a case up on the client list.
5. **Parsers.** `src/journal-import/parsers/` reads a PDF's text by extension (pdfjs, in a child process under Node's permission
   model, allowed to read only the parsers' folder and `node_modules`, with network modules blocked) and anything else as UTF-8 text.
   There is no Word reader. `src/core/zip.mjs` has a bounded ZIP reader (entry count, total and per-entry size, CRC; no links, no
   encrypted entries).
6. **The quote index is mechanical.** `buildQuoteGeneration` (version 4) splits a text into paragraph-sized exact quotes and dates
   each by the date lines the journal itself has (all-numeric dates month-first or day-first), and `buildQuoteTerms` makes the word
   list the replies' search ranks by. No model reads or writes any of it. Rebuilt from source texts, every passage comes out active
   and unrestricted.
7. **The owner's reading-first order (18 Oct 2026)** makes a *new* journal import read the whole source (by the import's model reader,
   or by authorized page reviews) before any index is built (`src/journal-import/reading-first-runtime-gate.mjs`;
   `docs/superpowers/specs/2026-10-18-reading-first-journal-import-order.md`). The replies' search (`findEvidenceQuotes` in
   `src/journal-import/retrieval.mjs`) reads only `quote_terms`, `quote_meta`, the word index and the list of passages: never a
   reading's facets or the pointer tags. Building an upload's copy mechanically is what the runner needs, and it departs from that
   order: question 1 in section 11.
8. **Nothing reads journal text for wanting to die without a model.** The runner's crisis readings are model readings of
   conversation messages; the repository has no local word list for it (section 5.4, question 2).
9. **A corpus can be tombstoned** (`tombstoneJournalCorpus`: no generation published, so nothing can read it), not deleted: its
   encrypted objects stay until the case's Delete.

## 2. What the owner will see, step by step

1. **Start.** He clicks the InnerSignal runner icon (section 10, pull request 2). The runner starts in the background and the page
   opens at `http://127.0.0.1:8797`. Clicking it while the runner runs only opens the page.
2. **People.** A new People tab lists "You" and each client by number and label. "Add a client" takes a label (initials or a code
   word) and says when the client can be used: after a restart, which the page offers once no reply, copy or test is running.
3. **Consent.** For a client, "Record consent" shows the two questions to ask them, and records what they agreed to, with the time:
   that InnerSignal may use their journal in these sessions, with their words and journal excerpts going to Anthropic and OpenAI;
   and, separately and optionally, that he may see their Journal tab. For himself, "Use my journal" records the first part. Each can
   be withdrawn from the same place.
4. **Add journal.** He chooses a file, or drops it on the person's row. The kinds accepted are listed beside the button: PDF with
   text, `.txt`, Markdown, Word `.docx`. Nothing is kept yet.
5. **What it read.** The page shows numbers and dates only, never words: entries, the first and last date, days with writing,
   entries without a date, pages that had no text, dates that read two ways (with the choice of day first or month first), and whether
   the questions tool can write a cold test from it. Then "Copy it in" or "Cancel".
6. **Copied in.** The copy is in the person's encrypted case. The row says: "Not tested yet: no reply uses it."
7. **The cold test.** "Run the cold test" first says what goes where (GPT writes the questions from passages of the copy and answers
   them; Claude judges the answers), about how many calls, and on whose plans. The row then shows its progress in numbers, and the
   result: passed, or not passed with the points of the rule not met, and how many tests have run on this copy.
8. **In use.** After a pass, replies use the journal once the consent's restart has happened, the check of each reply is on (IS22's
   question) and, later, the conversation's journal switch is on (IS23). The row names whichever of these is still missing.
9. **Add more.** A newer file of the same person shows what is new and what is already in; "Copy it in" makes a new copy holding
   both, tested again; until it passes, the earlier copy stays in use (question 3).
10. **Journal tab.** He picks "You", or a client whose tab consent stands: "Days with writing" (a calendar by month or by week), and
    "Their own words, then and now": he types a theme ("sleep", "my mother") and sees one short passage a month, in their own words
    with its date, without a verdict (which copy it reads is question 4). Nothing about wanting to die is shown (section 5.4); the
    emergency line is at the tab's foot.
11. **Withdraw.** Withdrawing a client's journal consent hides their tab and, once their case has read the journal, stops their whole
    case (4a); withdrawing only the tab consent hides the tab.
12. **Restart and Stop** are at the top of the trial's page; after Stop, the icon starts it again.

## 3. The tool that writes a copy's questions (i77 3a)

It turns a copy into a `journal_cold_questions` value with `author: "openai"`, for one cold-test run, written by GPT through the
trial's own signed-in Codex worker (sealed: no tools, an empty folder, no session kept), whatever the arrangement, since GPT writes
them as decided. With `--provider codex` the judge is GPT too, and the rule refuses a file written by the judge's company: the page
then says that the test needs the mixed or the Claude arrangement. The owner's runner is mixed.

**3.1 Sampling (the program).** The passages it may use are all those a reply may quote (the reader's own rule, `evidenceCandidate`:
a passage in a lifecycle a reply may use, not restricted, its words verified against the stored bytes), short ones included. Under
question 5's option a, the passages the word list of section 5.4 flags, with the other passages of their entries (5.4's rule), aren't
used for questions; they are still searched as in replies, and the run counts them. Of the rest the program picks passages spread
over the copy's source order (an equal share of each quarter), at random from a seed of the run's own: 60 for answerable questions, in
four batches of 15, and 30 as context for unanswerable ones, in two batches of 15 (a context passage may be another question's
evidence too). A passage that holds nothing to ask about (a date line alone, say) may be skipped by GPT (3.2); a skipped one is
counted and replaced by another drawn from the same quarter. Each passage is the evidence of one question while there are enough,
and of two (the rule's limit) when there aren't. With fewer than 24 passages to draw from the tool doesn't start, and the page says
that the questions tool can't write enough questions from this journal. That floor is the tool's, not the rule's: the 48 answerable
questions of 3.5, at two a passage, need 24. The report says how many passages were left out (question 5) and how many were skipped,
so a pass names the population it was drawn from. **One budget for a run:** at most 150 distinct passages go to GPT, the first 90, the
replacements of skipped ones (at most 15, sent in one more call) and the extra batches of 3.5 included, in at most 20 calls (3.8);
when it is spent before the file is complete, the tool stops with counts and a code, and the run has no test.

**3.2 What GPT gets and gives.** Each call gets a fixed instruction and its batch: passages under opaque names (`p1` to `p15`), each
with its exact words and the date its entry gives, or none. Nothing else: no case, corpus, label, file name or other passage.
- *Answerable batches:* for each passage, one question the passage answers; the evidence quote, exact words of that passage (4 to 40
  words, or the whole passage when it holds fewer than four); and `wording`: `same` (the question uses a less common word of the
  passage) for 12 of the 15, `other` (none of its words) for 3. For the passages the program names, with the kind it names, a planted
  wrong answer of that kind (`negation`, `person`, `time`, `happened`, `certainty`): seven a batch, so 28 a run, at least five of each
  kind. For a passage that holds nothing to ask about, it says so instead (`skip`).
- *Unanswerable batches:* the program first chooses what each question asks about, so that the absence is established by the program
  and not by GPT: 15 concrete subjects from a fixed list in the code (things, places, animals, activities, each with its English and
  French names and its common other names), each of which, in every one of those names and read as the search reads words, is in no
  usable passage of the whole copy. GPT then gives, for each subject, the parts of a question: a verb from the program's list of verbs
  of doing (visit, buy, cook, repair, ride, lose, borrow, give, meet, play and the like, in English and French; none of saying,
  writing, naming, mentioning, describing, thinking or remembering, which would make it a question about the journal's words, answered
  by the absence itself), and a phrase of at most eight words that holds a less common word of a passage of the batch, with no
  question word and no "or", "and", "rather", "instead", "besides" or a comma in it. The program puts them into one of a few fixed
  shapes, in English or French as the journal's stop words show ("When did I {verb} {subject} {phrase}?", "Did I ever {verb}
  {subject} {phrase}?"), in which the subject is what is asked about, so that the question asks nothing else the journal could
  answer ("Did I ever visit the planetarium after riding my bicycle?", where a passage tells of a bicycle and none of a planetarium).
  The parts are GPT's and the shape the program's: a choice within the method of 3a, said here so it can be seen.
- Strict JSON schemas, as the trial's other workers have; an answer outside its schema is asked again at most twice, as the cold
  test's are (`RETRYABLE_WORKER_FAILURES`).

**3.3 The program's checks.** A candidate that fails one is dropped; nothing is mended by guessing.
- An evidence quote is found exactly in its passage (after Unicode normalization, with runs of white space as one) and in at most
  three usable passages of the whole copy, and no passage becomes the evidence of more than two questions (`resolveColdKey`'s rule).
- A `same` question shares a search word with all of its evidence, by the search's own rule (`evidenceWordsShared`); an `other` one
  that does is counted as `same`.
- An unanswerable question is put together in one of the fixed shapes from parts that pass the shape's checks (its verb on the list,
  its phrase's words: 3.2); its subject is in no usable passage; and the replies' reader, asked with the question as the message,
  returns at least one passage.
- A planted answer is on an answerable question, is no copy of its evidence quote, holds at most 300 characters, and the kinds reach
  at least three each.
- No question repeats another (`validateColdQuestionsFile`), and at most 100 are kept.

**3.4 Checks of the key, apart from the answers.** An exact key can still be wrong: a quote that doesn't answer its question, a
planted answer that is true, an unanswerable question the journal answers in other words. A wrong key fails a good copy (the judge
trusts the key), and with not one wrong answer allowed, one is enough.
- *Answerable questions:* fresh GPT calls, on the same decided flow, 15 questions to a call, each with its evidence passage alone (never
  what the search returns, so the check is of the key and not of how GPT answers what a reply would find): whether the passage answers
  the question with the quoted words, and whether a planted answer is contradicted by the passage in the way its kind names. One it
  doubts is dropped. It is never asked to answer the question.
- *Unanswerable questions:* no model check. Their absence is the program's (3.2): a concrete subject that no usable passage of the
  whole copy names, in any of the names the list gives it. What remains is a journal that tells of the subject without naming it
  (a planetarium as "the star show"); the subjects are chosen to make that rare, and the measured run (section 10), on an invented
  journal whose contents are known, shows how often it happens.
The run counts what each check drops. The checks lower the odds of a wrong key and can't remove them: a run failed by one is a failed
run all the same, counted on the copy.

**3.5 Enough, or not.** After the checks the file needs 40 answerable questions that share a word with their evidence, 20
unanswerable ones and 20 planted answers, three of each kind (the rule); and, as the tool's own requirement, eight answerable
questions in other words than their passages' (3a: the rule counts them and requires none). The tool aims at 48, 26, 28 and 12.
Short of that, one more batch of each kind that's short (at most three more calls); then it stops with counts and a code ("couldn't
write enough questions"), and the run has no test.

**3.6 Kept nowhere.** The questions, their keys and what GPT returned live in the server's memory for that run and go when it ends.
Each run writes new ones, so a wrong key fails one run, not every run of that copy. The report and the receipt keep numbers only (how
many of each, how many each check dropped); the seed isn't kept. Nothing is logged.

**3.7 Consent before each packet.** As in the cold test, the person's consent and copy are read again under the trial folder's lock
right before each packet is handed to the worker; a withdrawal, a Delete or another publication stops the run, with no receipt.

**3.8 Calls.** At most 20 calls of the GPT worker a run for the questions, every call counted, each one asked again for its form or
a passing failure included: six batches, at most three extra batches, one of replacements and at most five checks of answerable keys
(which send only passages already sent), the rest for asking again. When the next call would be the 21st, the tool stops with counts
and a code, and the run has no test. Then the test's 160 to 200 or so (two a question, two more a planted answer, more when the judge
finds something wrong), one at a time, on the owner's ChatGPT and Claude plans. None of this is measured: a run on an invented journal
with the real models comes before any person's journal (section 10).

## 4. The page's journal steps

**4.1 Where they run.** In the server, which holds the vault's writer lock: a new service of the trial controller
(`src/runner-trial/journal-steps.mjs`), behind owner-page routes with the Run log's checks (no bearer token, a loopback Host, a
matching Origin, no-store), each refusing a case that isn't one of the trial's. A change of the client list, of a receipt or of the
hidden passages takes the trial folder's lock (the one the commands, the gate's outputs and Delete take) for that moment only, waiting
up to ten seconds for it (otherwise the page says the runner is busy). The steps that change a case's record (creating a corpus,
publishing it, tombstoning one, naming or promoting a copy) run inside that case's queue in the turn controller (`queued`), as Delete
does, so they never interleave with a turn of that case; a step that also needs the folder's lock takes it inside the queue, never the
other way round, which is the order turns and Delete already keep. A corpus's own objects are written outside the queue, so a long
copy never holds up a reply. **Delete wins.** Delete first marks the case as being deleted, and while the mark stands no preview, copy,
test or tab request of that case is admitted. It then raises the case's deletion count (which each piece of journal work read when it
was admitted), drops the case's previews, stops its test and waits for its copy to stop, all before it takes the case's queue (a
copy's own last step needs that queue); only then does it remove anything, and the mark goes once the deletion is over (after it,
the client starts afresh, as today). Every step of journal work inside the queue, and every batch of object writes, first checks the
count, and on a change stops at once and writes nothing more: the Delete removes whatever was written with the case. So nothing of a
deleted case is written again (the store's ordinary writes would recreate a missing case: `mutate` in `private-case-store.mjs`). What
a step writes to the vault it writes under a grant made in the process for that step and that case alone (the import's
`oneTimeGrant`), with the scopes and purposes the store asks: read and write, with `archive`, `organize_search` and `session_use`, for
a copy and its checks, as the command's import has; write with `delete` for a tombstone. The server's own grants stay as they were
minted at start. With the trial off, none of these routes or tabs exists.
The routes (`POST` with JSON unless said, and the preview with `application/octet-stream` alone, which a page of another site can't
send here without a preflight the server never answers; no label, theme or file name ever goes in a URL):

| Route | What it does |
|---|---|
| `/v1/runner/people/add` | adds a client (4.2) |
| `/v1/runner/consent` | records or withdraws a part of a consent (4.3) |
| `/v1/runner/journal/preview` | takes the file's bytes, reads them and answers with numbers (4.4, 4.5) |
| `/v1/runner/journal/copy`, `/v1/runner/journal/cancel` | copies a preview in, or drops it (4.6, 4.7) |
| `/v1/runner/journal/cold-test`, `/v1/runner/journal/cold-test/stop` | starts or stops a person's test (4.8) |
| `GET /v1/runner/journal/status?caseId=` | each person's journal state, in fixed words and numbers (4.8) |
| `GET /v1/runner/journal/days?caseId=`, `/v1/runner/journal/then-and-now` | the Journal tab (section 5) |
| `/v1/runner/restart`, `/v1/runner/stop` | IS24's rest (section 10, pull request 2) |

**4.2 Add a client.** A text field and "Add", with `validateClientLabel`'s rule (one line of 1 to 80 characters; no two labels alike
but for capitals). The server does what `addClientLocked` does (the keys first, then the list), and the command and the page share
that one function. The label goes into `clients.json` alone (no log, URL or report), and the page shows it as text, as it shows
labels today. A new client has no grant, and no keys in the running server's providers, so nothing can be written to their case
before a restart: their row says "Ready after a restart", beside the Restart button.

**4.3 Consent, with the Journal-tab consent.** The list (`clients.json`, schema version 2) keeps two parts for each client:
`journal.consent` as today (the i73 consent: InnerSignal may use their journal in these sessions, with their words and journal
excerpts going to Anthropic and OpenAI, whose models run the workers and write the questions) and `journal.tab_consent` (new, i80 3a:
the owner may see their Journal tab on this page), each `{confirmed_at, withdrawn_at}`. The page shows both questions in the words the
owner reads to the client; he ticks what they agreed to, and a confirmation repeats it before it is recorded. The tab consent can be
recorded only while the journal consent stands, and counts only while both do. A withdrawal of the journal consent holds at once, as
today: it hides the tab, stops a running test before its next packet and, once the case has read its journal, stops the whole case.
That is the gate as built when the owner chose 4a ("This is how it's built"): earlier replies may hold the journal's words, and new
conversations get up to 20 turns of the earlier ones; a case that has never read its journal holds none of its words, and goes on,
as the page's note says today. A withdrawal of the tab consent hides the tab alone. A confirmation gives the client's grant
`session_use` at the next start, and the page says so; the upload and the test need no restart, since they use grants of their own.
The owner's own case gets an `own_journal` entry with the same fields but no tab consent; the gate and the start script treat it as a
client's (his grant holds `session_use` while his own consent stands, and his case, once it has read his journal, stops while its gate
is closed). The command `--journal-consent` keeps working on the first part.

**4.4 Add journal: the kinds and the limits.** Shown under a person whose journal consent stands (for a client, once restarted after
being added). One file at a time, up to 64 MB (the journal import's own limits are 128 MB and 20,000 pages). The page sends the file's
bytes as the body, with the person's case and the kind it read from the extension in headers; the file name never leaves the browser.
The server checks the kind by the bytes before parsing:
- `.pdf`: begins with `%PDF-`; read by the existing PDF reader. Pages without text (scans, photos) aren't read, and are counted.
- `.txt`, `.md`, `.markdown`: must be UTF-8 (a byte-order mark is kept, as today); read as text, Markdown marks and all, so a date in a
  heading (`## 3 March 2019`) or a `Date:` line opens an entry as the date reader allows.
- `.docx` (new: `src/journal-import/parsers/docx-adapter.mjs`, in the same child process, which is also allowed to read the one file
  `src/core/zip.mjs`, by its exact path, and nothing else beyond what it reads today): a ZIP read by `readZipEntries` under tighter
  limits (at most 1,000 entries, and a new maximum output length for each entry's inflation, so a lying size stops early), of which
  only `word/document.xml` is read. Its XML is read by a small tokenizer that refuses a `DOCTYPE` or an entity declaration (nothing is
  expanded). The text comes from `w:t` runs, with `w:tab` as a tab, `w:br` and `w:cr` as line breaks, each `w:p` as a paragraph (a blank
  line between paragraphs, so each can be a quote of its own) and table cells as paragraphs. Text deleted or moved away in tracked
  changes (`w:del`, `w:delText`, `w:moveFrom`) and field instructions are left out; inserted and moved-in text (`w:ins`, `w:moveTo`) is
  kept. Headers, footers, footnotes, comments, pictures, text boxes and the fallback copies Word keeps of them (`w:txbxContent`,
  `mc:Fallback`) aren't read, and the preview says so. The result is one text, of media type
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, of which every quote is a span.
- Anything else, or bytes that don't match the extension: refused in plain words, with nothing read. Not yet: ZIP exports with
  pictures, photos or scans of handwriting.
A sealed copy from the server (`*.sealed.json`) goes through the same button and the existing import's checks (`openJournalCopy`,
`importJournalCopy`, the tie to one server case), run inside the server; the person's row shows their key's public half for the server
export ("Key for a copy from the server"). So neither `--copy-key` nor `--import` needs a terminal.

**4.5 What is shown before anything is kept.** The file is parsed in the child process (no network, no file read beyond its code, and
no write at all), and the quote generation is built in the server's memory, once each way for all-numeric dates. Nothing is written to
disk and nothing goes to a model. The preview is held in memory under a random id bound to its person's case (a copy of it for another
case is refused), for at most 15 minutes, one per person (a new one replaces it) and at most three at once; it is dropped on Cancel,
on Delete and on a restart. Its answer holds numbers and dates only:
- the kind and the size; for a PDF, its pages, the pages without text, and the pages whose reading order may be off (read, but no date
  is carried across them);
- entries (date lines, and the text before the first one), passages, and entries without a date of their own;
- the first and last date read, and the number of days with writing;
- the dates that read two ways (3/4/2020), counted, with the choice "day first" or "month first", preset to the order that leaves
  fewer dates out of the journal's order (the generation's `stats.date_order`);
- for Add more: the entries already in (left as they are), the new ones, and the new ones dated before the copy's last date (which the
  date reader may leave undated, as out of the journal's order);
- whether the questions tool can write a cold test from it (section 3.1's 24 passages);
- "Nothing is kept until you press Copy it in. This step sends nothing anywhere."

**4.6 Copy it in.** The copy is made as `importJournalCopy` makes one, from the generation built for the preview instead of an
export: a new corpus (`journal-upload-` and 32 random hexadecimal characters, so a copy that stops part-way never blocks the next), a
generation named for the quote index's version and date order as the journal import names one (`…:quotes:quote-index-v4-day-first`),
the graph, the source texts as extracted (the file's own bytes are never stored: no archive), the indexes `quote_meta`, `quote_months`
and `quote_terms`, published for `organize_search` and `session_use`; then every usable passage is resolved by the session-use reader
against the stored bytes, and what is stored is compared with what was built. A person has one copy in the making at a time: a
second "Copy it in" is refused while one runs. Last, inside the case's queue and then under the trial folder's lock, the deletion
count, the consent and, for Add more, the copy it was built on (still the newest, at the same publication) are read again: if all
stand, the list names the copy (`journal.corpus_id` for a first copy, `journal.pending_corpus_id` for Add more under question 3's
option a) and a digest of the file's bytes (`journal.uploads`, so the same file is refused for another person). Whatever fails or
stops after the publication (the check, the consent, the copy it was built on, the list's write) tombstones the new corpus, with the
generation and epoch its publication returned, so no published copy is left that the list doesn't name; on a changed deletion count
it writes nothing more, since the Delete removes the case with it. And since the server may stop in between, the service's start
tombstones any published upload corpus of a trial case that the list doesn't name. A copy that fails before its publication leaves an
unpublished corpus, named nowhere and unused, until Delete.

**4.7 Add more.** Offered for a copy made from files. A copy from the server is brought up to date by a newer server copy, which
carries its own deleted, revoked and restricted passages; and Add more refuses any copy that holds a passage that isn't active and
unrestricted, since building again from its source texts would make such a passage usable again. The new file is read as in 4.5 and
cut into entries by the date reader's own rule (`entryDateLine`, across pages as in 5.4); an entry is already in when the copy holds
an entry with the same text (Unicode NFC, runs of white space as one). The new entries' exact text, in the file's order and separated
by blank lines, becomes one more source text; the new copy holds the newest copy's source texts exactly as stored (the pending copy's
when there is one, so nothing added before is lost), then that one, and its dates are read across all of them. With nothing new,
"Copy it in" is off. One built on a copy that is no longer the newest when it finishes is refused (4.6), and the page says that the
journal changed meanwhile and the file is to be read again. A newer Add more replaces the pending copy, which is tombstoned without
ever having been used; a test running on it stops, as for another publication, and gives no receipt. Receipts are kept by corpus
(`cold-test-receipt-<corpus id>.json`; a receipt of today's single file is read as the receipt of the corpus it names, and no copy
has one yet; the command `--import` removes every receipt of the client, as it removes the one today), so the copy in use keeps its
receipt while the new one is tested. A pass promotes, inside the case's queue and then under the lock, only the pending copy it tested
(checked against the list), in one atomic write of the list, with no moment when the gate reads a list and a receipt that don't
match. The earlier copy is then tombstoned; its encrypted objects stay until Delete. Under question 3's option b instead, "Copy it
in" closes the journal at once, as `--import` does.

**4.8 The cold test and its status.** "Run the cold test" (one test per person at a time) first shows what goes where and how many
calls (section 3.8), then runs the questions tool and `runJournalColdTest` as a job in the server, with the attempt marker, the receipt
rule and the consent reads that `runClientColdTest` has; that function moves into the shared service, so the command and the page run
one implementation (`--cold-test FILE` keeps reading a file). It tests the pending copy when there is one. The status route gives, for
each person: the consent (none, confirmed, withdrawn) and the tab consent; whether a restart is due; the copy (none, copied, pending)
with its counts; the test (not run; running, with its stage, question n of m and the calls made; passed, with its run; not passed,
with the points of the rule not met in fixed words; interrupted); how many tests have run on this copy, with the command's sentence
that a copy passing only after several tests may have passed by chance; and what still keeps the journal from replies (the restart,
the check of each reply, later the conversation's switch). A test stops on its Stop button, on a withdrawal or a Delete before its
next packet, and with the server; a stopped test gives no receipt. Restart and Stop are refused while a test, a copy or a reply runs
(section 10, pull request 2).

**4.9 Withdraw and Delete.** A withdrawal holds at once (4.3). Delete this case first stops the case's journal work (4.1: no new work
admitted, the deletion count raised, the previews dropped, the test stopped, the copy waited for), then removes, as today, the case
with all its copies (a tombstoned one included), its journal fields on the list (the copies, the pending copy and the upload digests
go; both consents stay as recorded) and its journal folder (the key, the receipts, the marker and the hidden passages of 5.4).

## 5. The Journal tab

**5.1 Who can be shown, and when.** A Journal tab, only with the trial on, with a picker: "You" when the owner's own case has a copy,
and each client with a copy whose journal consent and tab consent both stand. Which copy it reads is question 4: the newest copy,
tested or not (it sends nothing anywhere, and i77's part 2 asked what a copy must pass "before replies use it"), or only a copy that
passed; until the owner answers, the build takes the second. It reads through a grant made in the process for that request (read,
`organize_search`), never a reply's.
- **What it may show** is one set of passages, from which every part of the tab is drawn (the days, the month lines, the count of
  entries without a date, then and now): the passages a reply may quote (a passage in a lifecycle a reply may use, not restricted, its
  words checked against the stored bytes: the reader's own `evidenceCandidate` rule), less every passage of an entry the word list of
  5.4 flags, less the hidden ones (5.4). So an entry left out is in no count and marks no day.
- **The moment of showing.** An answer is made when, under the trial folder's lock, both consents are read again and found standing
  and the copy's publication is the one that was read; only then is it sent. A withdrawal is ordered wholly before that moment
  (nothing is sent) or after it (that answer was shown, as a delivered reply is). The page then clears the tab, and drops every request
  still out by raising the tab's choice number: at once on a withdrawal or a Delete made on this page; within ten seconds for one made
  elsewhere (the command), since it asks the status every ten seconds while the tab is open and whenever it comes back into view; and
  whenever the status can't be read. It also clears the tab's passages after ten minutes without use, on a switch of person and on a
  reload.
- **No stale answer.** Every request carries the person's case and the tab's choice number, and every answer the consent revision
  (when the two consents were recorded) and the publication it was made from; the page drops an answer for another case, for an
  earlier choice, or with a revision or publication other than its latest status gives. So a slow answer never shows under another
  person, nor after a withdrawal has cleared the tab.
- Nothing the tab shows is stored by the server or kept by the page (no local storage), and every answer is no-store.

**5.2 Days with writing.** The days named by the date lines over the passages the tab may show (5.1): a date with a day's precision
that isn't a range between dates (in version 4, its anchors with a day; the same rule reads earlier index versions), not a month or a
year alone; entries without a date are counted, not placed. A month grid with navigation, or weeks as rows; a day is marked or not,
with the same mark whatever was written and however much; one line a month in words ("Wrote on 14 days in October 2026"); no count
per day, no colour by content, no streak, no trend. Days whose year was inferred, or whose date reads two ways, are named as such in
a note. A day's mark opens nothing.

**5.3 Their own words, then and now.** A theme of one to four words (stop words aside), at most 60 characters, typed and sent by
`POST`, and kept nowhere. The passages the tab may show (5.1) that hold all of its words, read as the replies' search reads words
(forms, accents, English and French stop words left out), dated by their own entry's date line (a day or a month, not a range); for
each month, the one in which the theme takes the most room (BM25 over the copy's word list; ties by journal order). Shown oldest
first, at most 24 months at a time: the date, and the sentences that hold the theme with the sentence before and the one after, never
cut inside a sentence (so a "not" stays with its words), with "Show the whole passage". The tab says: "Their own words, with their
dates. Nothing here is a judgment of progress." No summary, label, count chart or arrow.

**5.4 Keeping content about wanting to die out, on the laptop.** With no model, the tab uses a fixed list
(`src/runner-trial/dying-words.mjs`), in English and French, read in their forms: (a) direct words and phrases of suicide, killing
oneself, self-harm and overdose; (b) indirect phrases of not wanting to exist ("not wake up", "better off without me", "ne plus être
là", and the like); (c) any word of dying and death (die, dead, death, kill; mourir, mort, tuer). Then:
- **A passage that holds one is never shown, nor is any other passage of its entry.** An entry runs, in the journal's order and across
  pages, from one entry line (`entryDateLine`, by the quote index's own split of the copy's source texts, taken in order across all of
  them, so this holds for a copy from the server too) to the next. A page not fully read (a parse status other than readable) may hide
  an entry line, so an entry that reaches one runs on to the next entry line that could be read. In a stretch without entry lines, a
  flagged passage takes the two passages before it and the two after it with it.
- **A theme that holds one shows no passage,** only the line about getting support: "This tab leaves out what is written about dying.
  If you or they are thinking about it, talk to someone you trust. In danger right now? Call your local emergency number: 112 in the
  EU (and from mobiles in many other countries), 911 in the US and Canada, 999 in the UK."
- **A month whose passages were all left out looks like a month without a mention,** so the tab doesn't show where such passages were.
  (The brainstorm put the support line where a quote would have been; month by month, that would chart those months.)
- The emergency line is always at the tab's foot, as on the conversation page.
- "Hide this passage" keeps a passage out of that person's tab for good (a digest of its exact words, kept in their journal folder, so
  it holds across Add more; their Delete removes it).
- The tab states its limit: "Passages that mention dying, death or self-harm are left out by a list of words; indirect wording can
  still get through."
The list leaves out too much on purpose (entries about grief and illness go too). It can't catch every indirect way of writing about
wanting to die: whether that is good enough without a model is question 2.

**5.5 Empty and limit states.** No copy: "No journal copied in yet." A client whose tab consent doesn't stand isn't in the picker. A
copy without date lines: "This journal has no dates the calendar can read: its entries don't start with a date." Entries without a
date: counted ("N entries have no date of their own"). A theme of stop words only, or too long: said so. A theme found nowhere, or only
in passages left out: "No passage holds it." More than 24 months: navigation. A copy that can't be read: "This journal can't be read
just now", with a code, never its words. Under question 4's option b, a copy not yet passed: "Shown once this journal's cold test has
passed."

## 6. Data flows to models

| Step | What leaves the laptop | To | Decided |
|---|---|---|---|
| Add journal, the preview, Copy it in, Add more, a server copy's import | nothing | | |
| The Journal tab | nothing | | the first slice: no model |
| The questions tool, writing | about 90 sampled passages a run, 150 at most with the extra batches and the replacements of skipped ones (exact words, entry dates), and the instructions | OpenAI (GPT through Codex, on the owner's ChatGPT plan) | i77 3a |
| The questions tool, key checks | each answerable candidate with its evidence passage, which was sampled already | OpenAI | i77 3a (part of the writing) |
| The cold test, consumer | each question, with the at most six passages the replies' reader returns | the writer's worker (mixed: OpenAI) | i77, as built |
| The cold test, judge | the question, its key quotes, those passages, the answer and the planted answers | the checker's worker (mixed: Anthropic) | i77, as built |
| Replies | at most six quotations a turn (twelve after a repair's search), to the writer and the checker | mixed: OpenAI and Anthropic | i73, i75, i77; only with IS22's check on |
| Anything else | none in this design | | the owner's: say, a model reading the whole journal first (question 1) or checking the tab's passages (question 2) |

In one run the questions tool sends GPT only the passages it sampled: about 90, and 150 at most. For a journal of a few hundred
passages, that is a good part of it. The test then sends what a reply's search returns for each question, as built. Since GPT writes
the questions whatever the arrangement, the person's consent names both companies.

## 7. Where each part lives

- **New:** `src/journal-import/parsers/docx-adapter.mjs`; `src/journal-import/journal-upload.mjs` (the generation from a parsed file,
  the entries across pages and their comparison for Add more, the preview's counts, the copy's persistence and checks, and, on a
  copy, the days and the theme search over the passages the tab may show); `src/runner-trial/cold-questions.mjs` (section 3:
  sampling, the list of subjects for unanswerable questions with their names, instructions, schemas, checks, the file);
  `src/runner-trial/journal-steps.mjs` (the server's service: people, consent, previews, copies, the test's job shared with the
  command, the status, the tab's reads and their moment of showing, each case's deletion count, and the start's sweep of published
  copies the list doesn't name); `src/runner-trial/dying-words.mjs`.
- **Changed:** `src/journal-import/parsers/index.mjs` and `parser-child.mjs` (the `docx` format by extension, and the child's leave to
  read `src/core/zip.mjs`); `src/core/zip.mjs` (a maximum output length for each entry); `src/runner-trial/clients.mjs` (schema
  version 2: the tab consent, the pending copy, the upload digests, the owner's own entry, receipts by corpus, the page's view);
  `src/runner-trial/journal-gate.mjs` (the owner's own case, receipts by corpus; a pending copy is never read);
  `src/runner-trial/trial-controller.mjs` (the service, the gate also for the owner's own case, and Delete stopping the case's
  journal work before it removes anything);
  `src/supervisor/private-therapy-turn-controller.mjs` (the case's queue offered to the service); `src/server/create-server.mjs` (the
  routes, with a body limit of its own for the preview); `scripts/runner-trial-start.mjs` (`addClient` shared, grants for the owner's
  own journal); `scripts/runner-trial-journal.mjs` (the cold test from the shared service, every receipt of the client removed by an
  import); `apps/web/index.html`, `app.js` and `styles.css` (the People and Journal tabs); `docs/RUNNER-TRIAL.md`.
- **Unchanged:** the replies' search and reader (`SESSION_USE_READER_VERSION` stays, and the test that holds it, `READS`, stays
  green), the pass rule (`COLD_TEST_RULE` stays version 4), the runtime's journal hold, the run log (it gains no field).

## 8. Failure states

Each has fixed words on the page and a code, never words, wherever it is recorded.

- **Add journal:** a kind not accepted; bytes that don't match the kind; text that isn't UTF-8 ("save it as UTF-8 text and try
  again"); a PDF with no text; a Word file that is damaged, encrypted, too large or holds a `DOCTYPE`; over the size or page limit; the
  parser's time (30 s) or memory limit; a file with no passage.
- **The preview and the copy:** the preview expired, replaced, or of another person; the consent withdrawn, or the person deleted,
  meanwhile (the new corpus is tombstoned, the list unchanged); the folder's lock busy; the same file already copied for another
  person; a vault write that fails before the publication (an unpublished corpus is left, named nowhere); anything that fails after it,
  the check included (the new corpus is tombstoned, and the list doesn't name it); the server stopping in between (the next start's
  sweep tombstones it); Delete during a copy (the copy stops before its next write, and nothing of the case is written again); a full
  disk; Add more on a copy from the server, or on a copy holding a passage that isn't active and unrestricted.
- **The cold test:** too few passages for the questions tool (section 3.1); not enough questions written (3.5); the judge's company as
  the author (the codex arrangement); a plan limit or a lapsed sign-in (it stops); a refusal (Claude's is counted as left out; GPT's
  comes as a malformed answer, is asked twice more, and then stops the test); a withdrawal, a Delete, another publication or a newer
  Add more that replaces the copy under test (it stops before the next packet); a newer test started (the newer one decides); the
  server stopped (interrupted, no receipt: run it again).
- **The Journal tab:** a consent withdrawn before the moment of showing (nothing is sent) or after it (the page clears the tab); the
  status unreadable (the page clears the tab); a theme refused (section 5.4); a copy that can't be read; under question 4's option b, a
  copy not yet passed.
- **Restart and Stop:** refused while a reply, a copy or a test runs; a start that fails after a restart (the launcher's log holds the
  start script's own lines and codes, and the icon starts it again).

## 9. Tests

All with invented journals (`tests/helpers/invented-journal.mjs`, and invented PDF, Markdown and Word files made by the tests, and a
sealed server copy holding deleted, revoked and restricted passages), stand-in workers (`tests/helpers/cold-workers.mjs`), the server's
request listener in process and the page in JSDOM, as the runner's tests are now. Wherever no model may be called, the worker factory
is one that fails the test when called. Unique words are planted in every invented journal and label, and looked for in every answer,
error, the run log, the server's console output and the launcher's log: they may appear only in the Journal tab's passages and in the
page's own list of people.

Each rule below is taken out in turn on the build's final commit, and its test must fail; the build's pull request reports the table,
as pull request 245 did.

| # | Rule | The test that fails without it |
|---|---|---|
| R1 | No preview or copy without the person's journal consent; read again under the lock before the copy is named | a withdrawal during the copy: the corpus tombstoned, the list unchanged |
| R2 | Only the accepted kinds, checked by their bytes | a PDF named `.txt`, a ZIP named `.docx` without `word/document.xml`, Latin-1 text: each refused |
| R3 | No plaintext is written anywhere before Copy it in | the parser child can't write (Node's permission model); the server's preview path runs with every writing function of `node:fs`, in its callback and its promise forms, replaced by one that fails the test; a mutation that writes and removes a temporary file elsewhere must make it fail |
| R4 | The preview holds numbers and dates only | no planted word in its answer or any log |
| R5 | A preview expires, is bound to its case, one a person and three at most, dropped on Cancel, on Delete and on a restart | a copy of an expired, replaced, deleted or other person's preview is refused |
| R6 | A copy is published for `organize_search` and `session_use`, without archive or the file's bytes | the manifest's uses and objects |
| R7 | Every usable passage is resolved against the stored bytes after a copy | a store that changes one byte fails the copy, and the list doesn't name it |
| R8 | The same file is refused for another person | the second person's copy refused |
| R9 | Add more adds only the entries not already in, and reads dates across all | an invented journal with overlapping files: the counts and the dates |
| R10 | The copy in use keeps its receipt while the pending copy is tested; a pass moves the list in one write and tombstones the earlier copy; a failing test leaves the copy in use | stand-in turns during and after the test: the gate stays open on the earlier copy, then opens on the new one, and the earlier one can't be read |
| R11 | Word, through the real permission-restricted child: `word/document.xml` only; `DOCTYPE` and entities refused; deletions and moves away out, insertions and moves in kept; text boxes and fallbacks not read; the ZIP limits and the maximum output length | a valid file read as said; crafted hostile files refused |
| R12 | The date-order choice applies, preset to fewer dates out of order | 3/4 read each way |
| R13 | The questions tool samples all the passages a reply may quote, short ones included, spread over the quarters, each once while there are enough, a skipped one replaced from its quarter; under question 5's option a, flagged passages and their entries left out and counted | a sample from an invented journal with short passages and planted entries about dying |
| R14 | GPT's packet holds only its batch's passages, under opaque names, with their dates | the packet inspected: no case or corpus id, label or other passage |
| R15 | Each check of 3.3 | a candidate made to fail each check is dropped |
| R16 | The key checks of 3.4: answerable ones by GPT on the evidence passage alone; an unanswerable subject chosen by the program from its list and named by no usable passage in any of its names; unanswerable questions put together in the fixed shapes from parts that pass their checks | the stand-in doubts a key or says a planted answer is true: dropped; a subject one passage names in another of its names: never chosen; parts with a question word, "or", "rather", "instead", "besides", a comma or more than eight words, or with a verb not on the list ("mention", "write about", "name"): dropped; the check's packet holds no passage the search returned |
| R17 | Too few passages, or too few questions of any kind (the eight in other words included): no test | codes only, no call to the test's workers |
| R18 | The author is `openai`, refused when the judge is OpenAI | the codex arrangement refused before any call |
| R19 | The consent and the copy are read under the lock before each packet of the tool and of the test | a withdrawal before each kind of packet stops the run, with no receipt |
| R20 | One test a person; the newest decides; a receipt only for a pass; numbers only | the command's tests, run through the page's job |
| R21 | Two consent parts; the tab consent needs the journal consent; each withdrawal's effect | every order of confirming and withdrawing |
| R22 | A client is in the tab's picker only with both consents; the owner's own journal needs no tab consent; the copy read is question 4's (until answered, only a passed copy) | requests for a first copy and a pending copy without a receipt |
| R23 | Days with writing come only from the passages the tab may show, with a day's date; one mark a day; undated entries counted | an invented journal with ranges, months, years, inferred years and excluded passages |
| R24 | Then and now: whole sentences, one passage a month by the stated rule, at most 24 months, the entry's own date | crafted passages with a "not" beside the theme |
| R25 | A passage holding a listed word is never shown, nor its entry (across pages, past a page not fully read, two passages each side without entry lines); a theme holding one shows the support line; a month with only such passages shows nothing | planted entries in English and French, of each part of the list, one running onto the next page |
| R26 | Hidden passages stay hidden across Add more; Delete removes them | the digest file before and after |
| R27 | No model call from Add journal, the preview, the copy, Add more or the tab | the failing worker factory |
| R28 | No words in any log: the run log, the server's console, the launcher's log, errors | the planted words |
| R29 | The owner-page checks, the case on the trial's list and the body limits on every new route | a bearer token, a foreign Origin or Host, no Origin, another content type, another case, a body over the limit |
| R30 | The page keeps no tab data and no label in local storage or a URL | JSDOM's storage and location read after each step |
| R31 | Restart and Stop are refused while a reply, a copy or a test runs; a restart keeps the rules it runs and takes the list's consents into the grants (pull request 2) | a stand-in launcher |
| R32 | Add more is refused for a server copy, and for a copy holding a passage that isn't active and unrestricted | the sealed copy with excluded passages: refused, and none of its excluded passages shown by the tab or used in questions |
| R33 | The tab's moment of showing: the consents and the publication read again under the lock before an answer is sent; the page's clearing and its dropping of requests still out | a withdrawal ordered before (nothing sent) and after (the page clears the tab); an answer that arrives after the tab was cleared is dropped; a status that can't be read clears the tab; a tab left idle is cleared |
| R34 | No stale answer: requests and answers bound to the case and the choice number | two people's answers coming back in reverse order; a switch during a request |
| R35 | The tab reads only passages a reply may quote | deleted, revoked and restricted passages never shown, nor counted as days |
| R36 | Delete wins: no journal work admitted while a case is being deleted; each case's deletion count checked inside the queue and before each batch of object writes; Delete drains the case's journal work before it takes the queue | Delete between a preview and its copy, during the copy's writes, and during a test; a request that arrives after the count rises and before the deletion ends: refused; nothing of the case is written again, and the case stays gone |
| R37 | The case's queue before the folder's lock, everywhere | a turn waiting to deliver while a copy's last step and a promotion run: neither waits out the other |
| R38 | Whatever fails after a publication tombstones that corpus; the start's sweep tombstones a published copy the list doesn't name | a failure of the check, of the consent and of the list's write after publication; a stop between publication and naming |
| R39 | One set of passages for the whole tab | a month with only excluded entries: no mark, no line, no count, no passage |
| R40 | Add more builds on the newest copy; one copy in the making a person; one whose base is no longer the newest is refused; a newer one replaces the pending copy; a pass promotes only the pending copy it tested | A, then pending A+B, then a file C: the new copy holds A, B and C; the test of A+B stops with no receipt; an old pass can't promote; two additions at once: the second refused, or refused at its end when the first changed the base |
| R41 | One budget a run: at most 150 distinct passages to GPT and 20 calls of its worker for the questions, every call asked again included; spent, the run stops with no test | a journal whose sampled passages are mostly skipped, and a worker that fails for its form near the end: the count of passages sent and of the worker's actual calls, and no test |
| R42 | A copy's grant holds read and write with the purposes the import asks; a tombstone's write with `delete` | the copy and its checks under the restricted one-time grant; a grant with write alone fails the check |
| R43 | A passage of fewer than four words may be its question's evidence whole; one that holds nothing to ask about is skipped | short passages with something to ask, and a date line alone |

Beyond these: the shared cold-test service passes the command's existing tests unchanged, and the replies' reader's recorded results
(`READS`) are unchanged.

## 10. How it ships

Five pull requests, each with GPT's review, the full test gate and its table of rules taken out, and each merge brought to the owner:

| # | What | Waits for | Rough effort |
|---|---|---|---|
| 1 | The questions tool and the cold test's job in one shared service; the command can run a test with GPT's questions | the owner's yes to this design, and his answer to question 5 | 1.5 to 2 days |
| | **The measured run:** the tool and the test with the real models on an invented journal, about 200 calls on the owner's plans: how often a good copy passes, what the key check drops and how often an unanswerable question's subject is told of without being named (both against the journal's known contents), the calls and the minutes. The numbers come back to him, with the choice to keep 2b or loosen it (his i77 note) | his go, after 1 (question 6) | half a day, plus the calls |
| 2 | IS24's rest: a launcher and the icon (a desktop entry, installed once by the lane), Restart and Stop on the page, the owner's switches kept in the launcher's settings | | 1 to 1.5 days |
| 3 | The journal steps on the page: the People tab, adding a client, both parts of the consent, Add journal (PDF, text, Markdown, Word, a server copy), the preview, Copy it in, Add more, the cold test with its status, withdraw; the owner's own journal | 1 and 2; questions 1 and 3 | 2.5 to 3 days |
| 4 | The Journal tab: days with writing, then and now, the word list, Hide, the moment of showing | 3; questions 2 and 4 | 1.5 to 2 days |
| 5 | IS23's switches: the journal for each conversation, and the check of each reply, with the seconds each adds | IS22's run on invented cases | 1 day |

IS24's rest comes before the journal steps (2 before 3): a consent and a new client take effect only at a start, and without Restart
on the page they would need a terminal. IS23 comes after: a journal is used only with the check of each reply on, which is IS22's
question, and the seconds each switch adds come from IS22's run. The efforts are rough calendar days of a helper session with its
reviews, not measured.

**The launcher (pull request 2), in short.** The icon runs `scripts/runner-launcher.mjs` from the checkout it was installed from. It
does what a start does (the folder, the grants from the list, the released rules, the server), keeps no terminal, opens the browser at
the address, and keeps a log of the start script's own lines and codes in the trial folder (mode 0600; no words). The server tells it,
over its IPC channel, to restart or to stop. A restart is the same start again, with new grants (so recorded consents and new clients
take effect) and the released rules it already runs: a new release reaches the runner only by a start that fetches it, as today. The
owner's provider and switches (`--provider mixed` and the others he chose) are in `launcher.json` in the trial folder, written once
at the install from his answers. A runner started the old way, from a terminal, shows "Restart from the terminal" instead of the
buttons.

## 11. Choices for the owner

1. **An uploaded journal's copy: built from its exact text alone, or read first?** His order of 18 Oct 2026 has a new journal import
   read the whole source before its index is built.
   - **a:** Build the copy from the file's exact text, mechanically (the quote index, which is all the replies' search reads); nothing
     reads the whole journal. (recommended)
   - **b:** Reading first: a model reads the whole journal before the copy is built. A new flow (the whole journal to Anthropic or
     OpenAI), a long run on his plans, and nothing the replies use today.
2. **Keeping writing about wanting to die out of the Journal tab without a model** (section 5.4).
   - **a:** The word list as designed: any word of dying or death, and direct and indirect phrases, in English and French; the whole
     entry left out; a theme with such a word shows the support line; Hide; the limit said on the tab. (recommended: it leaves out
     every mention of dying or death with the entry around it, so what can get through names neither; the tab shows passages only to
     him or to the person themselves; anything stricter needs a model, with its own misses)
   - **b:** As a, but a client's tab shows only the days with writing until a better check exists; then and now for his own journal.
   - **c:** As a, and a model reads each passage before the tab shows it: a new flow (those passages to Anthropic or OpenAI), which the
     client's consent would have to name.
   - **d:** Only the days with writing for now.
3. **Add more while a copy is in use** (section 4.7).
   - **a:** The earlier copy stays in use until the new one passes its cold test; the new entries wait for theirs. (recommended)
   - **b:** Copy it in closes the journal until the new copy passes, as the terminal's import does; for a client whose case has read
     the journal, that stops their whole case meanwhile (4a), possibly over several test runs.
4. **Which copy the Journal tab reads** (section 5.1).
   - **a:** The newest copy, tested or not: the tab sends nothing anywhere and shows exact words with their dates, and his 2b was asked
     as what a copy must pass "before replies use it". (recommended)
   - **b:** Only a copy that has passed its cold test, so nothing of a journal is shown before then.
5. **The cold test's questions and passages about dying** (section 3.1).
   - **a:** No question or planted wrong answer is written about a passage the word list flags, nor about the rest of its entry;
     those passages are still searched, as in replies, and the run says how many were left out. The test then shows nothing of how
     such passages are answered; a conversation about wanting to die gets no journal anyway, and in any other the checker holds every
     claim to its source. (recommended)
   - **b:** They are sampled like any passage, so the test covers them too, and GPT writes questions and planted wrong answers about
     them.
6. **The measured run after pull request 1:** the questions tool and the cold test with the real models on an invented journal, about
   200 calls on his plans, before any person's journal.
   - **a:** Yes, once pull request 1 is merged; the numbers come back to him with the choice to keep 2b or loosen it. (recommended)
   - **b:** Not yet.

## 12. Limits

- The copy is protected like the rest of the trial, by its development key file: whoever can read the owner's files can open the
  vault (and the digests of hidden passages, beside it).
- A preview's text stays in the server's memory until it is dropped (minutes); text in memory can't be wiped.
- A replaced or withdrawn copy is tombstoned, not deleted (the store deletes no single corpus): its encrypted objects stay until
  Delete, so each Add more adds a copy's size.
- Dates are read from date lines at the start of a line, in English and French; a journal dated otherwise, or only by its file names
  (daily-note folders), has no days with writing and no months for then and now.
- Word's headers, footers, footnotes, comments and text boxes aren't read, nor PDF pages without text.
- The word list (5.4) can miss indirect wording. The key check (3.4) lowers the odds of a wrong key without removing them, and a
  journal may tell of an unanswerable question's subject without naming it. Each run writes new questions, and a pass after several
  runs may be by chance (the count is shown).
- The questions tool needs 24 passages a reply may quote (its floor, not the rule's); a shorter journal gets no cold test, so no reply
  ever uses it, while its Journal tab still works under question 4's option a.
- Once the owner's own case has read his journal, it stops like a client's while its gate is closed (a withdrawal, a lost receipt, a
  changed reader or rule): a new pass, or deleting that case, are the ways on.
- With `--provider codex` the cold test can't run with GPT's questions.
- The page's words (the consent questions, the support line, the tab's sentences) are shown to the owner with the build that adds
  them.
- Nothing here is built, measured or run on a real journal.

## Appendix: Codex's reviews

**Review 1** (26 Nov 2026, read-only, `codex exec` at medium effort, on the first draft): 12 findings, 3 blocking; "changes needed".

| # | Finding | What changed |
|---|---|---|
| 1 | Blocking: a withdrawal stops the whole case only once it has read its journal, narrower than "the whole case" | Kept, and now said in 4.3 with its reason: it is the gate as built when the owner chose 4a ("This is how it's built"; earlier replies may hold the journal's words), and a case that never read its journal holds none of them, as the page's note says today |
| 2 | The tab reads a copy that hasn't passed its cold test | Question 4; until the owner answers, only a passed copy (5.1, 5.5; R22) |
| 3 | Blocking: building again from source texts makes deleted, revoked or restricted passages usable again; the tab had no such filter | Add more only for copies made from files, refused for any copy holding a passage that isn't active and unrestricted (4.7; R32); the tab, the days and the questions read only passages a reply may quote (5.1, 3.1; R35) |
| 4 | Blocking: no moment of showing for the tab against a withdrawal; an idle tab kept its passages | The moment of showing under the folder's lock, the page's clearing on a withdrawal, and idle clearing (5.1; R33) |
| 5 | A slow answer could show under another person | Requests and answers bound to the case and the choice number; cleared on a switch and on Delete (5.1; R34) |
| 6 | Questions in other words could all be dropped | At least eight required by the tool (3.5; R17) |
| 7 | The journal size floor was put down to the owner's rule | It is the tool's, lowered to 24 passages at two questions each when needed; the rule sets none (1, 3.1, 12) |
| 8 | An exact quote doesn't make a correct key | Checks of the key apart from the answers: answerable ones on the evidence passage alone, unanswerable ones by other names and translations and by the returned passages; a wrong key still fails a run, as said (3.4; R16) |
| 9 | The questions drew an easier population than the reader serves | Short passages back (eight words); the key's validity checked apart from answers; leaving out passages about dying is question 5; the pull of the unanswerable check measured on an invented journal before use (3.1, 3.4, 10, 11) |
| 10 | Whole entries weren't defined across pages | An entry runs across pages from one entry line to the next, past a page not fully read; two passages each side without entry lines (5.4; R25) |
| 11 | The Word reader needs the parser child's leave to read the ZIP module | The child may read `src/core/zip.mjs` too, by its exact path; tests go through the real child (4.4; R11) |
| 12 | R3 couldn't show that no plaintext reaches disk | The child can't write; the server's preview path runs with writing functions that fail the test; a mutation writing a temporary file must fail it (R3) |

Found on the way, besides: a long copy no longer holds the folder's lock, and the steps that change a case's record go through its
queue (4.1, 4.6); a consent withdrawn during a copy tombstones it (4.6); the generation is named for its index version and date order
(4.6); the replaced copy is tombstoned (4.7); moved text and text boxes in Word (4.4); a restart keeps the released rules it runs (10);
the owner's own case stops like a client's (12).

**Review 2** (26 Nov 2026, the same way, on the revision): of the twelve, nine fixed (on 1 it judged the design's reading of 4a right,
"This is how it's built" being part of what he chose), and 4, 8 and 9 partly; five new findings, one blocking; "changes needed".

| # | Finding | What changed |
|---|---|---|
| 4 | An answer sent before a withdrawal could come back after the page had cleared the tab; a status that couldn't be read cleared nothing | A withdrawal or Delete on the page, and a status that can't be read, clear the tab and drop every request still out; answers carry the consent revision and the publication, and one that isn't the latest is dropped (5.1; R33) |
| 8 | An unanswerable key rested on GPT's absent words and six returned passages | The program chooses each unanswerable question's subject from a fixed list and checks every name of it against the whole copy; GPT only words the question; no model check reads the returned passages (3.2 to 3.4; R16) |
| 9 | Passages under eight words were left out though a reply may quote them | All of them are drawn from; GPT may skip one that holds nothing to ask, replaced from its quarter; the report names the population (3.1; R13) |
| 13 | Blocking: Delete didn't stop upload work, and the store's ordinary writes recreate a missing case | Each case's deletion count, checked inside the queue and before each batch of object writes; Delete raises it, drops previews, stops the test and waits for the copy before it removes anything (4.1, 4.5, 4.9; R36) |
| 14 | The folder's lock was taken before the case's queue, the other way round from turns and Delete | The queue first, then the lock, everywhere: naming, tombstoning, promoting (4.1, 4.6, 4.7; R37) |
| 15 | A failure after the publication left a published copy, though the design said unpublished | Whatever fails after it tombstones the corpus with the generation and epoch its publication returned, and the start's sweep tombstones a published copy the list doesn't name (4.6; R38) |
| 16 | Excluded entries could still mark the calendar or be counted | One set of passages the tab may show, after the reader's rule, the word list's entries and Hide, from which every part of the tab is drawn (5.1 to 5.3; R39) |
| 17 | A second Add more could rebuild from the copy in use and lose the pending one's entries | Add more builds on the newest copy and replaces the pending one; a pass promotes only the pending copy it tested (4.7; R40) |

Also: the tombstone's grant (write with the `delete` purpose) is named (4.1).

**Review 3** (26 Nov 2026, the same way, on the second revision): 4, 14, 15 and 16 fixed; 8, 9, 13 and 17 partly; two new findings;
"changes needed".

| # | Finding | What changed |
|---|---|---|
| 8 | A question naming the absent subject could still ask something the journal answers ("rather than", a second part) | GPT gives parts (a verb, a short phrase with no question word, "or", "rather", "instead", "besides" or comma); the program puts them into fixed shapes in which the subject is what is asked (3.2, 3.3; R16) |
| 9 | A meaningful passage of under four words couldn't be evidence | It may be its question's evidence whole; only a passage with nothing to ask about is skipped (3.2; R43) |
| 13 | Blocking: work admitted while a Delete ran could take the raised count and survive | Delete first marks the case as being deleted, and nothing of it is admitted until the deletion is over; it drains the case's work before it takes the queue; on a changed count work writes nothing more (4.1, 4.6, 4.9; R36) |
| 17 | Two additions built at once on the same copy could lose one's entries | One copy in the making a person; at its end the copy it was built on must still be the newest, at the same publication, or it is refused (4.6, 4.7; R40) |
| 18 | Replacements had no bound to match the promised 150 passages, nor the call count | One budget a run: 150 distinct passages and 15 calls, replacements and extra batches included; spent, no test (3.1, 3.8; R41) |
| 19 | The copy's grant named write only, though its checks read | Read and write with the purposes the import asks, as the command has; write with `delete` for a tombstone (4.1; R42) |

**Review 4** (26 Nov 2026, the same way, on the third revision): 9, 13, 17 and 19 fixed; 8 and 18 partly; nothing new; "changes
needed".

| # | Finding | What changed |
|---|---|---|
| 8 | A verb of mentioning or writing made the question one about the journal's words, answered by the absence itself | The verb comes from the program's list of verbs of doing, without verbs of saying, writing, naming, mentioning, describing, thinking or remembering (3.2, 3.3; R16) |
| 18 | The calls asked again were outside the budget of 15 | Every call of the worker counts, those asked again included, against one budget of 20; the 21st isn't made, and the run has no test (3.1, 3.8; R41) |

**Review 5** (26 Nov 2026, the same way, narrowed to those two changes): 8 and 18 fixed, nothing new found; "ready".
