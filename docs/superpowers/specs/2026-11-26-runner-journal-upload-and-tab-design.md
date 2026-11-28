# Runner trial: a journal upload and a Journal tab on the page, with the tool that writes a copy's questions

Written 26 Nov 2026 by a helper of the InnerSignal lane, for the owner's answer `i80 1a 2a 3a` (26 Nov 2026) and the tool that his
`i77 3a` (24 Nov 2026) asks for; revised after read-only Codex reviews and a Claude review (appendix), and again for his answers `i81 1b 3a 4a 5b 6a`
(26 Nov 2026), `i83 1a` (by 27 Nov 2026, 00:58 UTC) and `i84 1c` (27 Nov 2026). A design: pull request 1 (section 10) is built with it, and each of the
build's merges comes to the owner (promise IS27, within IS24). It extends the runner trial
(`docs/superpowers/specs/2026-11-21-runner-trial-design.md`), its clients and journal copy
(`docs/superpowers/specs/2026-11-23-runner-client-cases-design.md`, "the clients design" below) and the replies' journal search
(`docs/superpowers/specs/2026-11-24-runner-journal-search-design.md`). No client name, journal text or conversation appears here, in
a test or in a log.

## What the owner decided

- **i81 `1b 3a 4a 5b 6a` (26 Nov), the choices this design put to him:**
  - **1b, reading first,** as his order of 18 Oct 2026 says (below): a model reads each uploaded journal whole before its copy is
    built (section 4.6). The import's reader is GPT, so the whole journal goes to OpenAI, and the consent step says so (4.3).
  - **3a:** while a copy is in use, Add more's new copy waits for its own cold test; the earlier copy stays in use until the new one
    passes (4.8).
  - **4a:** the Journal tab shows the newest copy, tested or not (5.1).
  - **5b:** the questions tool samples passages about dying like any other passage, and GPT writes questions and planted wrong
    answers about them too (3.1).
  - **6a:** the measured run (the real models on an invented journal, about 200 calls on his plans) comes after pull request 1 is
    merged, and the lane runs it; its numbers go back to him, with the choice to keep "not one wrong answer" (his `i77 2b`) or
    loosen it (section 10).
  - Its part 2, keeping writing about dying out of the Journal tab, had no answer. It was asked again as **i83**, and answered
    `1a` (next).
- **i83 `1a`** (the lane's chat, between 26 Nov 2026, 23:22 and 27 Nov 2026, 00:58 UTC), **keeping writing about wanting to die
  out of the Journal tab:** the reading (4.6) marks the entries about dying or wanting to die, and the word list backs it up: an
  entry either one flags is left out whole, a theme with such a word shows the support line, there is a Hide button, and the tab
  says what may be missed (5.4).
- **i84 `1c`** (27 Nov 2026: his Inbox at 16:12 UTC, the lane's chat at 16:14 UTC), **the graph of his 18 Oct order:** the index
  first: copies are used with the index alone, once a copy passes its test; the graph becomes its own design and build right after
  the upload button works from the page (with Add more and the test on the page), compared with the index alone on invented
  questions about time and contradictions, and replies use it only if it does better (4.6, "What 1b covers"; section 10, row 4b).
- **i85 `1b`** (28 Nov 2026, the lane's chat, 00:19 UTC): pull request 1 merges with this design, and the measured run (i81 6a) is
  made at once, on the rest of GPT's week. Codex's review of its final commit came after his answer (appendix, review 11): its fixes
  are in pull request 1 before the merge.
- **The reading-first order (18 Oct 2026):** the index and graph built after the detailed reading, to make them more complete and
  useful (`docs/superpowers/specs/2026-10-18-reading-first-journal-import-order.md`, his words quoted there): a new journal import reads the
  whole source, by the import's model reader or by authorized page reviews, before any index is built; an incomplete reading yields a
  clearly named partial generation only by an explicit authorized decision; a refused passage is never sent again by another route.
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
- The Journal tab makes no model call: it reads only the copy on the laptop and the marks the reading left with it (i83 1a).
- Every flow of journal text to a model is stated (section 6). GPT reading the whole journal before its copy is built (i81 1b), GPT
  reading a copy's passages to write its questions, and the cold test's workers reading passages, are decided; any other flow, and
  any other choice that is the owner's, is a question (section 11).

## 1. What exists, and what shapes this design

1. **Clients and consent are terminal commands.** `scripts/runner-trial-start.mjs --add-client` (a hidden prompt for the label) and
   `--journal-consent confirm|withdraw` write `clients.json` under the trial folder's lock. Grants are minted at each start from that
   list (`prepareCredentials`), and the server's key and authorization providers read `credentials.json` once, at start: a new
   client, or a consent's `session_use` purpose, takes effect only at the next start (since pull request 254, the page's Restart makes
   that start for a runner the icon started). A withdrawal holds at once, since the gate reads the list at every retrieval and before
   every output.
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
   `docs/superpowers/specs/2026-10-18-reading-first-journal-import-order.md`), and he chose it for uploads (i81 1b). What the code
   has for it:
   - **Who reads.** The import's `read-source` step (`src/journal-import/private-runtime.mjs`) runs `produceReadingFirstJournal`
     (`reading-first-source-producer.mjs`) through `createReadingFirstPortAdapter` (`reading-first-port-adapter.mjs`), whose two roles,
     `source_reader` and `source_synthesizer`, run on the import's standard tier only (`JOURNAL_ROLE_DEFINITIONS` in
     `provider-port.mjs`), never on its hardest tier (Claude Opus). On the owner's plans that tier is GPT: through ChatGPT
     (`chatgpt_subscription_browser`, `chatgpt_connector_exchange`) or Codex (`codex_exec_exchange`), as `provider-runtime.mjs` routes
     it; the API routes there (OpenAI's or Anthropic's, paid apart from his plans) aren't what the runner uses. So the reader's company
     is OpenAI.
   - **What it produces.** One call a page, with the page's exact text and the role's fixed instruction
     (`provider-port-roles/source_reader.md`), answers with a `source-reading-result`: a short grounded overview of the page (at most
     2,500 characters), at most 25 short exact quotations of it, and at most 30 findings (statements with their qualifiers), each tied
     to its quotations. The program finds every quotation in the page's own text (a quotation it can't find, or an answer outside its
     schema, leaves the page unread) and keeps the page's reading encrypted, written once. Once every page is read or reviewed, the
     `source_synthesizer` sums the readings up, twelve pages at a time and then level by level, into a provisional summary (at most
     13,000 characters) with its changes over time, each tied to pages (a reported event, a dream, an unwanted thought, a
     hypothetical, another person's report, or unknown). Three receipts signed with a key derived from the store's (inventory,
     reading, summary) let `verifiedReadingFirstSynthesis` check, before any index is built, that every page was read or reviewed;
     while a page is pending nothing is summed up or signed. The findings also become reading facets (`reading_terms`,
     `reading_meta`) on the passages that hold their quotations (`reading-first-facets.mjs`).
   - **What the replies read of it: nothing.** The replies' search (`findEvidenceQuotes` in `src/journal-import/retrieval.mjs`) reads
     only `quote_terms`, `quote_meta`, the word index and the list of passages: never a reading's facets or the pointer tags. The quote
     index itself stays mechanical (6, above); the reading decides when it may be built, not what it holds.
   - **What it can't take as it is.** The reader reads text pages only: a page with a picture, or with no text, is pending for a
     reviewer (`visual_pending`, `source_unavailable`). A text file has no pages (the parser's `pages` is empty), and `read-source`
     refuses a source without them (`JOURNAL_READING_FIRST_INVENTORY_INCOMPLETE`); a page over 60,000 characters isn't sent
     (`JOURNAL_READING_FIRST_PAGE_TOO_LARGE`) and stays pending. The import's review route for pending pages is a file an authorized
     reviewer writes (section 6 of the order), which needs the owner's decision on who may see which page.
8. **Nothing reads journal text for wanting to die without a model.** The runner's crisis readings are model readings of
   conversation messages; the repository has no local word list for it, and the reader's schema has no place for it (section 5.4,
   the owner's i83 1a).
9. **A corpus can be tombstoned** (`tombstoneJournalCorpus`: no generation published, so nothing can read it), not deleted: its
   encrypted objects stay until the case's Delete.

## 2. What the owner will see, step by step

1. **Start.** He clicks the InnerSignal runner icon (built: pull request 254). The runner starts in the background and the page opens
   at `http://127.0.0.1:8797`. Clicking it while the runner runs only opens the page.
2. **People.** A new People tab lists "You" and each client by number and label. "Add a client" takes a label (initials or a code
   word) and says when the client can be used: after a restart, which the page offers once no reply, copy or test is running.
3. **Consent.** For a client, "Record consent" shows the two questions to ask them, and records what they agreed to, with the time:
   that InnerSignal may use their journal in these sessions (when it is added, the whole journal goes to OpenAI, whose model reads
   all of it before it is copied in; in the sessions and their tests, their words and journal excerpts go to Anthropic and OpenAI);
   and, separately and optionally, that he may see their Journal tab. For himself, "Use my journal" records the first part, in the
   same words. Each can be withdrawn from the same place. A consent recorded in the earlier words, which didn't name the reading, is
   shown as such, and Add journal asks for it again (4.3).
4. **Add journal.** He chooses a file, or drops it on the person's row. The kinds accepted are listed beside the button: PDF with
   text, `.txt`, Markdown, Word `.docx`. Nothing is kept yet.
5. **What it read.** The page shows numbers and dates only, never words: entries, the first and last date, days with writing,
   entries without a date, pages that have no text or hold a picture (which the reading can't read), dates that read two ways (with
   the choice of day first or month first), whether the questions tool can write a cold test from it, and the reading it takes: how
   many pages, about how many calls and roughly how long (4.5). Then "Read it and copy it in" or "Cancel". The first says once more
   what goes where before anything leaves: the whole journal, page by page, to OpenAI (GPT, through the runner's signed-in Codex, on
   his ChatGPT plan).
6. **Reading.** The row shows numbers only: "Reading: page 37 of 120; 36 read, 1 not read; 41 minutes so far, about 1 hour 20
   minutes left at this pace", with Stop. The page may be closed meanwhile: the reading runs in the runner. Restart and Stop at the
   top ask first, and pause it; "Go on reading" goes on from where it stopped, and no page already read is sent again (4.6).
7. **Pages not read.** A page that GPT refused or didn't answer in form, that holds a picture or no text, or whose answer didn't hold
   up is named by its number and reason. "Read again" sends again the pages whose reason allows it, never one GPT may have refused;
   otherwise "Cancel": no copy is made without every page (4.6).
8. **Copied in.** Once every page is read, the copy is built in the person's encrypted case. The row says: "Not tested yet: no reply
   uses it."
9. **The cold test.** "Run the cold test" first says what goes where (GPT writes the questions from passages of the copy and answers
   them; Claude judges the answers), about how many calls, and on whose plans. The row then shows its progress in numbers, and the
   result: passed, or not passed with the points of the rule not met, and how many tests have run on this copy.
10. **In use.** After a pass, replies use the journal once the consent's restart has happened, the check of each reply is on (IS22's
    question) and, later, the conversation's journal switch is on (IS23). The row names whichever of these is still missing.
11. **Add more.** A newer file of the same person shows what is new and what is already in; "Read it and copy it in" reads only the
    new entries, then makes a new copy holding both, tested again; until it passes, the earlier copy stays in use (i81 3a).
12. **Journal tab.** He picks "You", or a client whose tab consent stands: "Days with writing" (a calendar by month or by week), and
    "Their own words, then and now": he types a theme ("sleep", "my mother") and sees one short passage a month, in their own words
    with its date, without a verdict. It shows the newest copy, tested or not (i81 4a). It leaves out what is written about wanting to die, by
    the reading's marks and the word list together (i83 1a, section 5.4); the emergency line is at the tab's foot.
13. **Withdraw.** Withdrawing a client's journal consent stops a reading or a test before its next call, hides their tab and, once
    their case has read the journal, stops their whole case (4a); withdrawing only the tab consent hides the tab.
14. **Restart and Stop** are at the top of the trial's page (built: pull request 254); after Stop, the icon starts it again.

## 3. The tool that writes a copy's questions (i77 3a)

It turns a copy into a `journal_cold_questions` value with `author: "openai"`, for one cold-test run, written by GPT through the
trial's own signed-in Codex worker (sealed: no tools, an empty folder, no session kept), whatever the arrangement, since GPT writes
them as decided. With `--provider codex` the judge is GPT too, and the rule refuses a file written by the judge's company: the page
then says that the test needs the mixed or the Claude arrangement. The owner's runner is mixed. Pull request 1 builds it with the
test's job (4.9) and lets the command run it: `--cold-test --gpt-questions` in place of a questions file; the page's button comes with
pull request 4. Today's consent (version 1's words, 4.3) names "the companies running the workers", and its record doesn't say which
arrangement it was given under, so it can't show that OpenAI writing questions from sampled passages was named. So in pull request
1 the command runs GPT's questions only on an invented journal, checked twice before any call: the trial folder is set apart for
invented journals (it holds the file `invented-journals-only`, mode 0600, which no command writes and the lane puts in the measured
run's own folder, and it isn't the default trial folder, the one the owner's runner uses, nor a folder a runner starts from, one holding
the icon's `launcher.json` wherever it is, both refused even with the file); and the very copy under test, at the publication the test
reads, has as its first passage, in the copy's source order among all its passages whatever their lifecycle, a passage a reply may
quote whose stored words are exactly the code's sentence (`INVENTED_JOURNAL_SENTINEL`), byte for byte, with no normalization at all: GPT's
questions run only on a copy whose first passage is such a passage. A journal opens with that sentence only if someone put it there. A copy with a passage that has no place in the order, or two sharing the first place, has no first passage, and
is refused too, and so is one whose first passage holds the sentence but is one a reply may not quote (revoked, say). The check is of
the copy's first passage, not of the file it came from (section 12). The sentinel's passage is left out
of the questions. Elsewhere, a normal client's copy included, and in a set-apart folder a copy whose first passage isn't such a
passage, it refuses them before any call. From pull request 3 they also run for a person whose consent stands in version 2's words, which names
OpenAI and the questions whatever the arrangement. A questions file keeps working under either version, as today.

**3.1 Sampling (the program).** The passages it may use are all those a reply may quote (the reader's own rule, `evidenceCandidate`:
a passage in a lifecycle a reply may use, not restricted, its words verified against the stored bytes), short ones included.
Passages about dying are sampled like any other (i81 5b): no list leaves them out, and GPT writes questions and planted wrong
answers about them as about any passage. The program picks passages spread
over the copy's source order (an equal share of each quarter), at random from a seed of the run's own: 60 for answerable questions, in
four batches of 15, and 30 as context for unanswerable ones, from the passages not held back, in two batches of 15 (a context passage may be another question's
evidence too). A passage that holds nothing to ask about (a date line alone, say) may be skipped by GPT (3.2); a skipped one is
counted and replaced by another drawn from the same quarter. Each passage is the evidence of one question while there are enough (sixty, one for each place),
and of two (the rule's limit) when there aren't. With fewer than 24 passages to draw from the tool doesn't start, and the page says
that the questions tool can't write enough questions from this journal. That floor is the tool's, not the rule's: the 48 answerable
questions of 3.5, at two a passage, need 24. The report says how many passages were skipped and how many were in batches dropped
for their form (3.2), so a pass names the population it was drawn from. **One budget for a run:** at most 150 distinct passages go to GPT, the first 90, the
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
  French names and its common other names), each of which, in every one of those names and in their other forms (read as the search
  reads words, and as it reads them with a word list whatever the copy's own index), is in no
  usable passage of the whole copy. GPT then gives, for each subject, the parts of a question: a verb from the program's list of verbs
  of doing (visit, buy, cook, repair, ride, lose, borrow, give, meet, play and the like, in English and French; none of saying,
  writing, naming, mentioning, describing, thinking or remembering, which would make it a question about the journal's words, answered
  by the absence itself), and a phrase of at most eight words that holds a less common word of a passage of the batch, made of words
  alone: read with its white space trimmed and each run of it as one space (the question is put together from it so read), it holds
  letters, combining marks and decimal digits, an apostrophe or a hyphen only inside a word ("l'été", "rouge-gorge"), one space
  between words, and no other character at all, so that no other punctuation, in any script (a full stop, a dash, a colon, brackets),
  can start or join a second question; its words, what spaces separate, at most eight, and no part of one (an apostrophe or a hyphen
  parts it) a question word or "or", "and", "rather", "instead" or "besides" (nor their French words). The check is of the phrase's
  characters and words, not of its meaning (section 12). The program puts them into one of a few fixed
  shapes, in English or French as the journal's stop words show ("When did I {verb} {subject} {phrase}?", "Did I ever {verb}
  {subject} {phrase}?"), in which the subject is what is asked about, so that the question asks nothing else the journal could
  answer ("Did I ever visit the planetarium after riding my bicycle?", where a passage tells of a bicycle and none of a planetarium).
  The parts are GPT's and the shape the program's: a choice within the method of 3a, said here so it can be seen.
- Strict JSON schemas, as the trial's other workers have; an answer outside its schema is asked again at most twice, as the cold
  test's are (`RETRYABLE_WORKER_FAILURES`), and a passing failure (a timeout) at most twice too, the two counted apart so that their
  order changes nothing. A batch whose third answer is outside its schema is dropped whole, which is how a
  refusal by GPT would most likely come (Codex gives no sign of one): its passages are counted, and none of them goes to the questions
  tool's GPT calls again, in a later call of the run or of a later run on that person's copies, in another batch or another kind of call (the
  order's rule for a refused passage): their digests are kept in the person's journal folder (`questions-held-back.json`, digests
  only, mode 0600, under the trial folder's lock; their Delete removes it), read again right before each packet leaves in the same
  hold of that lock in which the consent and the copy are read (3.7): one hold a packet, so no other action under the lock comes between
  the two reads. A
  passage of the packet another run held back meanwhile stops this run before the packet goes (`COLD_QUESTIONS_HELD_BACK_MEANWHILE`),
  and so does, in a key check's packet, any passage holding the evidence quote of one of its questions (3.4); the sampling leaves them
  out and counts them. The packet leaves after the lock is released: a withdrawal, or another run's hold-back, committed in that
  instant doesn't stop that packet. A withdrawal stops the run at the next packet, of the tool or of the test, or before the receipt is
  written. A hold-back is read only before each of the tool's packets: a later packet that holds or guards that passage stops the run,
  the packets the tool prepares after reading it leave the passage out, and the test's packets and the receipt step don't read the
  list. Holding the lock through a call,
  which can take minutes, would stop every other action on the trial folder for that long, the consent's withdrawal included; the cold
  test's own packets have the same instant (section 12). A passage is known by its exact words: section 12 says what that misses. The
  tool's worker is pinned to Codex, which gives no sign of a refusal, so such a failure is always ambiguous; should a worker say that
  it refused (`REFUSED`, as Claude's can), the batch is dropped and held back at once and never asked again. The
  extra batches of 3.5 make up what is short. A third passing failure, and any other failure of the worker (a plan limit, a lapsed
  sign-in, an action taken), stops the tool with its code and holds nothing back. A passage GPT skips in its schema (nothing to ask
  about) isn't a refusal: it is replaced (3.1), not held back.

**3.3 The program's checks.** A candidate that fails one is dropped; nothing is mended by guessing.
- An evidence quote is found exactly in its passage (after Unicode normalization, with runs of white space as one) and in at most
  three usable passages of the whole copy, and no passage becomes the evidence of more than two questions (`resolveColdKey`'s rule).
- A `same` question shares a search word with all of its evidence, by the search's own rule (`evidenceWordsShared`); an `other` one
  that does is counted as `same`, and a `same` one that doesn't as `other` (the program's count, not GPT's label, is what 3.5 counts).
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
  doubts is dropped. It is never asked to answer the question. A question or a planted answer that carries six words in a row of another passage of
  its batch, words none of its own evidence passages holds, is dropped by the program before the check, which would send them with it
  (a planted answer alone goes, its question kept). Words of its own evidence passages may be carried: a quote held by two or three
  passages makes each of them its evidence, so a question may carry another of them whole. A question with any of its evidence passages
  held back, as the run knows them before the check, is dropped; and a check's packet is guarded against every evidence passage of
  every question in it, not only those it names, so that one another run held back meanwhile stops the run (3.2); those are guarded,
  not counted as sent. A check still without an answer in its schema after two more asks
  drops its questions, whose passages are held back as a dropped batch's are (3.2).
- *Unanswerable questions:* no model check. Their absence is the program's (3.2): a concrete subject that no usable passage of the
  whole copy names, in any of the names the list gives it or another form of one. What remains is a journal that tells of the subject
  without naming it
  (a planetarium as "the star show"); the subjects are chosen to make that rare, and the measured run (section 10), on an invented
  journal whose contents are known, shows how often it happens.
The run counts what each check drops. The checks lower the odds of a wrong key and can't remove them: a run failed by one is a failed
run all the same, counted on the copy.

**3.5 Enough, or not.** After the checks the file needs 40 answerable questions that share a word with their evidence, 20
unanswerable ones and 20 planted answers, three of each kind (the rule); and, as the tool's own requirement, eight answerable
questions in other words than their passages' (3a: the rule counts them and requires none). The tool aims at 48, 26, 28 and 12.
Short of that, one more batch of each kind that's short (at most three more calls); then it stops with counts and a code ("couldn't
write enough questions"), and the run has no test. The file keeps at most the aims of each wording, planted answers first; a wording
with more planted answers than its aim (GPT may word them in none of their passages' words, which makes them the other wording's)
takes them kind by kind, the kind with the fewest kept so far first, and the file itself, after that cut, is checked against the rule
again: short of it, no test, since a test that can't pass would still spend its calls (about 200).

**3.6 Kept nowhere.** The questions, their keys and what GPT returned live in the memory of the process that runs the test (the
server's, or the command's) for that run and go when it ends.
Each run writes new ones, so a wrong key fails one run, not every run of that copy. The report keeps numbers only (how many of each,
how many each check dropped, how many passages were sent and how many calls made), and the receipt is today's, with `author:
"openai"`; the seed isn't kept. Nothing is logged.

**3.7 Consent before each packet.** As in the cold test, the person's consent and copy are read again under the trial folder's lock
right before each packet is handed to the worker, in the same hold as the held-back list (3.2); a withdrawal, a Delete or another
publication stops the run, with no receipt.

**3.8 Calls.** At most 20 calls of the GPT worker a run for the questions, every call counted, each one asked again for its form or
a passing failure included: six batches, at most three extra batches, one of replacements and at most five checks of answerable keys
(which send only passages already sent), the rest for asking again. When the next call would be the 21st, the tool stops with counts
and a code, and the run has no test. Then the test's 160 to 200 or so (two a question, two more a planted answer, more when the judge
finds something wrong), one at a time, on the owner's ChatGPT and Claude plans. None of this is measured: the measured run on an
invented journal with the real models comes once pull request 1 is merged, before any person's journal (i81 6a, section 10).

## 4. The page's journal steps

**4.1 Where they run.** In the server, which holds the vault's writer lock: a new service of the trial controller
(`src/runner-trial/journal-steps.mjs`), behind owner-page routes with the Run log's checks (no bearer token, a loopback Host, a
matching Origin, no-store), each refusing a case that isn't one of the trial's. A change of the client list, of a receipt or of the
hidden passages takes the trial folder's lock (the one the commands, the gate's outputs and Delete take) for that moment only, waiting
up to ten seconds for it (otherwise the page says the runner is busy). The steps that change a case's record (creating a corpus,
publishing it, tombstoning one, naming or promoting a copy) run inside that case's queue in the turn controller (`queued`), as Delete
does, so they never interleave with a turn of that case; a step that also needs the folder's lock takes it inside the queue, never the
other way round, which is the order turns and Delete already keep. A corpus's own objects are written outside the queue, so a long
copy never holds up a reply. **Delete wins.** Delete first marks the case as being deleted, and while the mark stands no preview,
reading, copy, test or tab request of that case is admitted. It then raises the case's deletion count (which each piece of journal
work read when it was admitted), drops the case's previews, stops its reading and its test and waits for its copy to stop, all
before it takes the case's queue (a copy's own last step needs that queue); only then does it remove anything, and the mark goes once
the deletion is over (after it, the client starts afresh, as today). Every step of journal work inside the queue, every batch of
object writes and every call of the reading first checks the
count, and on a change stops at once and writes nothing more: the Delete removes whatever was written with the case. So nothing of a
deleted case is written again (the store's ordinary writes would recreate a missing case: `mutate` in `private-case-store.mjs`). What
a step writes to the vault it writes under a grant made in the process for that step and that case alone (the import's
`oneTimeGrant`), with the scopes and purposes the store asks: read and write, with `archive`, `organize_search` and `session_use`, for
a reading, a copy and its checks, as the command's import has; write with `delete` for a tombstone. The server's own grants stay as
they were minted at start. With the trial off, none of these routes or tabs exists.
The routes (`POST` with JSON unless said, and the preview with `application/octet-stream` alone, which a page of another site can't
send here without a preflight the server never answers; no label, theme or file name ever goes in a URL):

| Route | What it does |
|---|---|
| `/v1/runner/people/add` | adds a client (4.2) |
| `/v1/runner/consent` | records or withdraws a part of a consent (4.3) |
| `/v1/runner/journal/preview` | takes the file's bytes, reads them and answers with numbers (4.4, 4.5) |
| `/v1/runner/journal/read`, `/v1/runner/journal/read/stop` | starts a preview's reading, goes on with a stopped one, reads pending pages again, or stops it (4.6) |
| `/v1/runner/journal/copy`, `/v1/runner/journal/cancel` | builds the copy again after one that failed before its publication (a reading with every page read builds its copy by itself); drops a preview or a reading (4.6, 4.7) |
| `/v1/runner/journal/cold-test`, `/v1/runner/journal/cold-test/stop` | starts or stops a person's test (4.9) |
| `GET /v1/runner/journal/status?caseId=` | each person's journal state, in fixed words and numbers (4.6, 4.9) |
| `GET /v1/runner/journal/days?caseId=`, `/v1/runner/journal/then-and-now` | the Journal tab (section 5) |
| `/v1/runner/restart`, `/v1/runner/stop` | IS24's rest (built: pull request 254) |

**4.2 Add a client.** A text field and "Add", with `validateClientLabel`'s rule (one line of 1 to 80 characters; no two labels alike
but for capitals). The server does what `addClientLocked` does (the keys first, then the list), and the command and the page share
that one function. The label goes into `clients.json` alone (no log, URL or report), and the page shows it as text, as it shows
labels today. A new client has no grant, and no keys in the running server's providers, so nothing can be written to their case
before a restart: their row says "Ready after a restart", beside the Restart button.

**4.3 Consent, with the Journal-tab consent.** The list (`clients.json`, schema version 2) keeps two parts for each client:
`journal.consent` (the i73 consent, in words that now name the reading, i81 1b) and `journal.tab_consent` (new, i80 3a: the owner
may see their Journal tab on this page), each `{confirmed_at, withdrawn_at}`, and the journal consent also `words`, the version of the
words it was confirmed in. The journal consent's words, version 2: "InnerSignal may use my journal in these sessions. When it is
added, the whole journal goes to OpenAI, whose model (GPT) reads all of it before it is copied in; in the sessions and their tests,
my words and excerpts of my journal go to Anthropic and OpenAI, whose models answer, check and write the test's questions." Version
1 is today's ("their words and excerpts going to the companies running the workers"), which names neither the reading nor OpenAI
apart from the arrangement, and whose record doesn't say which arrangement it was given under: a consent confirmed in it (by the
command, before this build) still holds for what it named (the sessions, the cold test with a questions file, a copy from the
server), and not for GPT's questions or the reading; the page shows it as given in the earlier words. One Add journal button takes both kinds: a file only under a consent in
version 2's words, a sealed copy from the server under either. Under version 1 the page offers "Ask again in the new words", which
records a new confirmation in version 2's words over the standing one, after the owner has read them out and ticked them; from pull
request 3 the command's `--journal-consent confirm` does the same for a standing version 1 consent (today it changes nothing when a
consent stands), and changes nothing for a standing version 2 one. The page shows both questions
in the words the owner reads to the client; he ticks what they agreed to, and a confirmation repeats it before it is recorded. The tab
consent can be recorded only while the journal consent stands, and counts only while both do. A withdrawal of the journal consent
holds at once, as today: it stops a running reading or test before its next call, hides the tab and, once the case has read its
journal, stops the whole case.
That is the gate as built when the owner chose 4a ("This is how it's built"): earlier replies may hold the journal's words, and new
conversations get up to 20 turns of the earlier ones; a case that has never read its journal holds none of its words, and goes on,
as the page's note says today. A withdrawal of the tab consent hides the tab alone. A confirmation gives the client's grant
`session_use` at the next start, and the page says so; the upload, the reading and the test need no restart, since they use grants
of their own. The owner's own case gets an `own_journal` entry with the same fields but no tab consent; the gate and the start script
treat it as a client's (his grant holds `session_use` while his own consent stands, and his case, once it has read his journal, stops
while its gate is closed). The command `--journal-consent` keeps working on the first part; from pull request 3 it shows version 2's
words and records them.

**4.4 Add journal: the kinds and the limits.** Shown under a person whose journal consent stands (for a client, once restarted after
being added); a file needs it in version 2's words, a sealed copy from the server in either (4.3). One file at a time, up to 64 MB (the journal import's own limits are 128 MB and 20,000 pages). The
page sends the file's bytes as the body, with the person's case and the kind it read from the extension in headers; the file name
never leaves the browser. The server checks the kind by the bytes before parsing:
- `.pdf`: begins with `%PDF-`; read by the existing PDF reader. Its pages are the reading's pages (4.6). A page without text (a scan,
  a photo) or with a picture can't be read by the reading, which reads text: the preview counts it, and while any page stays unread
  the upload can't produce a copy (4.6).
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
export ("Key for a copy from the server"). So neither `--copy-key` nor `--import` needs a terminal. A copy from the server isn't read
again: 1b is about an uploaded file, and a server copy is the server's published generation as it was built there, which the order
leaves as it is; so it needs no reading, and a consent in version 1's words is enough for it, as today.

**4.5 What is shown before anything is kept.** The file is parsed in the child process (no network, no file read beyond its code, and
no write at all). In the server's memory its text is then cut by the quote index's own segmentation (`splitQuoteUnits`), its date
lines are read by the index's date reader (`entryDateLine`, `dateLineValue`, `timeOrderRun`), once each way for all-numeric dates,
and its reading pages are cut (4.6): the order allows segmentation and an inventory before the reading, and nothing more is made. No
generation, graph, word list or other index is built before the reading's receipts verify (4.7), and the counts below come from the
segments and date lines alone. Nothing is written to disk and nothing goes to a model. The preview is held in memory under a random id bound to its
person's case (a copy of it for another case is refused), for at most 15 minutes, one per person (a new one replaces it) and at most
three at once; it is dropped on Cancel, on Delete and on a restart, and becomes the person's reading on "Read it and copy it in" (4.6).
Its answer holds numbers and dates only:
- the kind and the size; for a PDF, its pages, the pages without text, the pages with a picture, and the pages whose reading order may
  be off (read, but no date is carried across them);
- entries (date lines, and the text before the first one), passages, and entries without a date of their own;
- the first and last date read, and the number of days with writing;
- the dates that read two ways (3/4/2020), counted, with the choice "day first" or "month first", preset to the order that leaves
  fewer dates out of the journal's order (as the date reader counts them, and as a generation's `stats.date_order` will);
- for Add more: the entries already in (left as they are), the new ones, and the new ones dated before the copy's last date (which the
  date reader may leave undated, as out of the journal's order);
- whether the questions tool can write a cold test from it (section 3.1's 24 passages);
- the reading it takes (4.6): its pages, those it can't read (no text, a picture) and those it won't send (4.6, "Held back"), the
  calls (one a page, and about one more for every twelve pages to sum them up) and roughly how long, at half a minute to a minute and
  a half a page (a guess, not a measure; the reading's progress shows its own pace);
- "Nothing is kept until you press Read it and copy it in. This step sends nothing anywhere."

**4.6 The reading (i81 1b).** "Read it and copy it in" starts it, once the page has said again what goes where, while the preview is
live and under a journal consent in version 2's words, read again under the trial folder's lock.
- **Its pages.** A PDF's pages, as the import reads them. A text, Markdown or Word file has none, so the program cuts its text into
  reading pages before anything leaves: whole passages as the quote index's segmentation cuts them, in order, at most 4 KB of text and 40 passages a page (the
  stretch the pointer pass counts as a page of a journal without pages), each ending before an entry line when one falls in the
  page's last quarter; a passage over 4 KB is a page of its own, and one over the reader's 60,000 characters is a page it can't take
  (`reader_unavailable`). Each reading page is one source text of the copy, so the copy's dates are read across them in order, as
  across a PDF's pages.
- **Stored before anything is sent.** The press makes the copy's corpus in the person's case (`journal-upload-` and 32 random
  hexadecimal characters, unpublished) and stores the reading pages' texts in it, encrypted, under the step's grant; inside the
  case's queue and then under the folder's lock, the list names it as the person's reading (`journal.reading`: the corpus, the file's
  digest, the date order chosen, the number of pages, when it started), so nothing is stored that the list doesn't name, and the
  preview leaves memory. Nothing of it is published until the copy is built (4.7), and nothing reads it but the reading.
- **Who reads, and how.** GPT, through the trial's own signed-in Codex worker, sealed as for the questions (no tools, an empty
  folder, no session kept), on the owner's ChatGPT plan, at the trial writer's effort (medium); one fresh call a page, one page at a
  time. GPT whatever the arrangement, since the import's reader is GPT (its two roles run on the standard tier alone); under
  `--provider claude`, which otherwise keeps every call with Anthropic, the page says so once more before the reading starts. The
  route is pinned: no setting sends the reading to another model or company. It is the import's own reading,
  `produceReadingFirstJournal` with `createReadingFirstPortAdapter`, over a port of the runner's (`src/runner-trial/journal-reading.mjs`)
  that hands each packet to the worker with the role's own instruction and checks each answer against the role's schema; the
  import's files are unchanged. A page's packet holds what the adapter puts in the import's: the page's number, its digest, its exact
  text and that it is text, with the adapter's own routing fields (a protocol version, the schema's name, an opaque work id, the
  page's locator in the reading, the reading's token as its `expected_generation`, and the grant's purpose); never a case, corpus id,
  label or file name. A summary packet has one of the adapter's two shapes: a batch's, with up to twelve pages' overviews and
  findings, each with its page number, digest and opaque reference; or a level's, with the summaries below it, each with an opaque
  reference and its meaningful changes (statements tied to pages, with their kind and uncertainty). Neither holds a page's quotation
  array (`exact_source_anchors`), though a finding or a change is free text and may repeat the journal's words. Both carry the
  import's `known_state`: the journal alone, with the comparison with the rest of the case left to a separate step that this design
  doesn't make, so nothing of the person's conversations goes with it. An answer outside its schema is
  asked again at most twice (`RETRYABLE_WORKER_FAILURES`), as the cold test's are; a refusal the worker can tell (Codex can't) isn't
  asked again. The pages' readings, the summary and the signed receipts are kept in the copy's corpus, encrypted and written once, as
  the import keeps them; the receipts are signed with a key of the person's own (32 random bytes made once,
  `journal/<case id>/reading-key.json`, mode 0600, removed by their Delete). The reading's token and source digest are the
  runner's: a random `reading-` and 32 hexadecimal characters, made when the reading starts and kept on the list (not the corpus id),
  and a digest of its pages' digests in order.
- **What is kept, and when.** Within a run the adapter checks every completion twice, by `invoke` and by `getCompletion`, against the
  same work id, token, receipt and answer digest; the port holds each answer in memory for that, with a receipt of its own (a random
  id, the token, the worker's company and model, the call's thread). What lasts across runs is only what the producer keeps: a page's
  reading, written once to the corpus after it passed the import's checks (`persistEvidence`). An answer that failed them is kept
  nowhere, so "Read again" gets a fresh one. When the reading goes on, the port answers a page whose reading is kept from that
  reading (the import's schema rebuilt from it, with a new receipt), and sends the others; a page whose answer came but wasn't kept
  yet when the run stopped is sent again, as one that had no answer.
- **Each run is an attempt.** Every start, every "Go on reading" and every "Copy it in" tried again (4.7) makes an attempt id, under
  the case's queue and the folder's lock, kept in the server's memory with the reading; a copy tried again after a restart sends no
  page, since every page's reading is kept. Stop, Cancel, a withdrawal, a Delete and a pause end the attempt first, then the call under way: the sealed worker gets an
  abort signal that ends its process (pull request 3 adds it to `SealedCodexWorker.call` and the subprocess helper under it). Right
  before keeping anything, the reading reads, under the folder's lock, that its attempt is still the current one, that the list still
  names this reading, that the deletion count hasn't moved and that the consent stands; otherwise it keeps nothing. So a late answer
  of an ended attempt is dropped, also when the same reading has gone on meanwhile.
- **The mark, for i83 1a.** Each page's call asks for an envelope of the runner's own: the import's `source-reading-result`, unchanged,
  and beside it a list of which of its quotations are words about dying, death, suicide, self-harm or not wanting to live. The
  reading result alone goes through the import's checks, and whether the page is read depends on those alone. The mark is checked
  apart: each entry must name one of the result's quotations, which the program has found in the page; it is kept with the page's
  reading as spans of the page. A missing or malformed mark is kept as "no mark for this page" and never fails the page. The mark
  costs no other call and sends nothing more. It decides nothing about the page, the copy, the questions or the test; only the
  Journal tab reads it (i83 1a; 5.4, where a page without a valid mark shows no passage). Every reading writes it.
- **The summary.** Once every page is read, the import's summary calls run over the kept readings (about one for every twelve pages, then the levels above), and the receipts are signed. A summary answer still outside its
  schema after two more asks stops the reading with its code, every page kept, and "Go on reading" asks again.
- **What he sees.** The status route gives numbers only: the pages read, not read and to read, the page it is on, the minutes so
  far, the time left at the mean of its own calls (shown from the third), the calls made, and each page not read by its number and
  reason. The row shows it; nothing in it is a word of the journal.
- **Pages not read.** The import's reasons, as it gives them: `visual_pending` (a picture), `source_unavailable` (no text),
  `tool_refused`, `reader_output_invalid` (an answer still outside its schema; Codex gives no sign of a refusal, so a refusal by GPT
  most likely comes as this), `reader_evidence_invalid` (a quotation not in the page, a finding without one) and `reader_unavailable`
  (the call didn't finish, or the page is too large). A page is sent once. "Read again" sends again only the pages left for
  `reader_evidence_invalid` or `reader_unavailable`: never one refused or answered outside its schema, and never a page by another
  route, encoding, cut or model (the order's rule). The runner has no review route in this slice: the import's needs a person who
  reads the page, and for a client's journal who may see which page is the owner's decision, not this design's.
- **No copy without every page.** The order makes a complete generation need every page read or reviewed, and a partial one an
  explicit authorized decision. This design makes no partial copy and decides none for the owner: a reading with a page not read
  builds nothing. The page names those pages by number and reason, offers "Read again" where the reason allows it, and otherwise
  only "Cancel". So in this slice a journal with a page GPT won't answer in form, or with a page that holds a picture or no text,
  can't be copied in from a file (section 12). A copy without such pages would be his decision, made when he asks for it.
- **What 1b covers.** He chose 1b as his page asked it: "Reading first, as your 18 Oct order: a model reads the whole journal before
  the copy is built (the whole journal goes to Anthropic or OpenAI; a long run on your plans)". (An earlier revision of this design
  quoted it with "and nothing the replies use today" added; his page never said that.) The copy is what the replies need, the quote
  index, built only after a complete reading, with the reading's facets beside it as the import adds them; no reply reads the facets.
  It holds no person, topic or event graph (the runner runs no pointer pass). Whether 1b also asks the runner for the order's later
  stages, the graph (which may only come after the index) and its checks (against an index-only baseline, on held-out chronology and
  contradiction questions), was the owner's to say, asked as i84: he chose **1c**. This design's copy is the index alone, used once a
  copy passes its test; the graph is its own design and build right after the upload button works from the page (section 10, row
  4b), compared with the index alone, and replies use it only if it does better.
- **Held back.** For every page left out for `tool_refused` or `reader_output_invalid`, the digests of its passages and of each of
  its sentences of four words or more (after Unicode normalization, with runs of white space as one) are kept in the person's journal
  folder (`reading-held-back.json`, digests only, mode 0600; their Delete removes it). A later reading page that holds one of them
  (Add more, the same journal uploaded again, cut into pages or paragraphs another way) isn't sent: it is left out at once, for its
  earlier reason, so that reading builds no copy either. Since no copy is built without every page, a page the reading couldn't read
  is in no copy made from a file, and so in no reply, test or tab. The runner's reader and its questions tool are both the sealed
  Codex worker, which gives no sign of a refusal, so every such failure is ambiguous (an answer outside its schema), and both treat
  it as a possible refusal: never sent again by that route. The questions tool's held-back passages (3.2) are kept apart: they come
  from a batch that failed for its form, of passages GPT had already read whole in the reading without failing; they are held back
  from the questions tool's own calls as a precaution, and a reply's search, and the cold test's consumer and judge, which get what a
  reply's search gets, go on as built (the replies' reader is unchanged). A copy from the server isn't read, so nothing of this list
  applies to it.
- **Stop, the runner's Restart and Stop, going on.** Stop ends the attempt and the call under way (its page goes again), keeps every
  page read, and offers "Go on reading" and "Cancel". Restart and Stop at the top of the page don't wait for a reading: they ask
  first ("A journal is being read: it pauses, and goes on from where it stopped"), then, in this order: stop admitting readings and
  other journal work (a request after that is refused, `RUNNER_CLOSING`); end every reading's attempt and wait until none runs, which
  takes seconds; then close the gate for replies and deletions as pull request 254 does, which refuses while a reply or a deletion
  runs. When that refuses, or the launcher can't be told, everything is admitted again and the readings stay paused. After a start
  the reading doesn't go on by itself: the row shows it stopped. "Go on reading" sends no page whose reading is kept.
- **Withdrawal, Delete, Cancel.** Before each call, under the folder's lock, the deletion count, the consent (in version 2's words)
  and the reading the list names are read again: a withdrawal or a Delete stops it before the next call. Cancel takes the reading off
  the list; what was stored (the pages and their readings, encrypted, never published) stays unused until the case's Delete, since the
  store deletes no single corpus (section 12).
- **Time.** Not measured. A call carries a page's text and answers with up to 25 quotations and 30 findings, much more than the
  trial's writer calls, which took up to 20 s. At a guess of half a minute to a minute and a half a page, a journal of 100 reading
  pages (400 KB of text at most) takes roughly one to three hours with its ten or so summary calls, and one of 1,000 pages a day or
  more. A plan's limit stops it (`PLAN_LIMIT`), and "Go on reading" goes on later.

**4.7 The copy.** Built by the server, with no other press, once every page is read and the receipts are signed. First the reading's
receipts are checked (`verifiedReadingFirstSynthesis`) for exactly the copy's source, reading and
number of pages, and each stored page's text against its digest in the signed inventory (the gate checks the digests it is given,
not the bytes); only then is any generation built, and the copy is made as `importJournalCopy` makes one, from a generation built
from the stored reading pages (in the date order the preview chose) in the corpus the reading made: a generation named for the quote
index's version and date order as the journal import names one (`…:quotes:quote-index-v4-day-first`), the quote index's own graph
(passages and their containment, as `buildQuoteGeneration` makes it), the source texts as extracted (the reading pages; the file's own bytes
are never stored: no archive), the indexes `quote_meta`, `quote_months` and `quote_terms`, and the reading's facets (`reading_terms`,
`reading_meta`), as the import adds them (no reply reads them), published for `organize_search` and `session_use`; then every usable
passage is resolved by the session-use reader against the stored bytes, and what is stored is compared with what was built. A person
has one copy in the making at a time: a second reading or copy is refused while one runs. Cancel, like this last step, runs inside
the case's queue and then under the trial folder's lock, so the two are ordered. Last, there, the deletion count, the consent, the
reading the list names (the same token) and its attempt (still the current one), and, for Add more, the copy it was built on (still
the newest, at the same publication) are read again: if all stand, the list names the copy (`journal.corpus_id` for a first copy,
`journal.pending_corpus_id` for Add more, i81 3a), takes off `journal.reading`, and keeps a digest of the file's bytes
(`journal.uploads`, so the same file is refused for another person). Whatever fails or
stops after the publication (the check, the consent, the copy it was built on, the list's write) tombstones the new corpus, with the
generation and epoch its publication returned, so no published copy is left that the list doesn't name; on a changed deletion count
it writes nothing more, since the Delete removes the case with it. And since the server may stop in between, the service's start
tombstones any published upload corpus of a trial case that the list doesn't name. A copy that fails before its publication leaves the
reading as it was, still named on the list: the copy can be tried again ("Copy it in"), or the reading cancelled.

**4.8 Add more.** Offered for a copy made from files. A copy from the server is brought up to date by a newer server copy, which
carries its own deleted, revoked and restricted passages; and Add more refuses any copy that holds a passage that isn't active and
unrestricted, since building again from its source texts would make such a passage usable again. The new file is read as in 4.5 and
cut into entries by the date reader's own rule (`entryDateLine`, across pages as in 5.4); an entry is already in when the copy holds
an entry with the same text (Unicode NFC, runs of white space as one). A PDF is checked on its whole page inventory first, before any
entry is compared: one with any page that holds a picture or no text is refused, with the count ("2 pages the reading can't read"),
whether or not the page holds a new entry, so no picture is ever flattened into text and nothing is dropped unseen. The new entries' exact text, in the file's order and
separated by blank lines, is cut into reading pages as in 4.6; the new copy holds the newest copy's source texts exactly as stored
(the pending copy's when there is one, so nothing added before is lost), then those pages, and its dates are read across all of them.
Its reading (4.6) sends only the new pages: each page of the copy it builds on keeps its reading, written into the new reading's
ledger under the new reading's work ids only after the page's digest is checked against the earlier kept reading's, with a note of
where it came from; the summary is made again over all of them, with new receipts. With nothing new, "Read it and copy it in" is off. One built on a copy that is no longer the newest when it finishes is refused (4.7), and the page says that the journal changed
meanwhile and the file is to be read again. A newer Add more replaces the pending copy, which is tombstoned without
ever having been used; a test running on it stops, as for another publication, and gives no receipt. Receipts are kept by corpus
(`cold-test-receipt-<corpus id>.json`; a receipt of today's single file is read as the receipt of the corpus it names, and no copy
has one yet; the command `--import` removes every receipt of the client, as it removes the one today), so the copy in use keeps its
receipt while the new one is tested. A pass promotes, inside the case's queue and then under the lock, only the pending copy it tested
(checked against the list), in one atomic write of the list, with no moment when the gate reads a list and a receipt that don't
match. The earlier copy is then tombstoned; its encrypted objects stay until Delete (i81 3a: the earlier copy stays in use until
then).

**4.9 The cold test and its status.** "Run the cold test" (one test per person at a time) first shows what goes where and how many
calls (section 3.8), then runs the questions tool and `runJournalColdTest` as a job in the server, with the attempt marker, the receipt
rule and the consent reads that `runClientColdTest` has. That function moves into a shared job (`src/runner-trial/cold-test-job.mjs`,
pull request 1), so the command and the page run one implementation: `--cold-test FILE` keeps reading a file, and `--cold-test
--gpt-questions` has the questions tool write them. It tests the pending copy when there is one. The status route gives, for each
person: the consent (none, confirmed in version 1's or 2's words, withdrawn) and the tab consent; whether a restart is due; the
reading (none; reading, with its numbers; stopped; done with pages not read, by number and reason); the copy (none, copied,
pending) with its counts; the test (not run; running, with its stage, question n of m and the calls made; passed, with its run; not passed,
with the points of the rule not met in fixed words; interrupted); how many tests have run on this copy, with the command's sentence
that a copy passing only after several tests may have passed by chance; and what still keeps the journal from replies (the restart,
the check of each reply, later the conversation's switch). A test stops on its Stop button, on a withdrawal or a Delete before its
next packet, and with the server; a stopped test gives no receipt. Restart and Stop are refused while a test, a copy or a reply runs:
pull request 254 refuses them during a reply or a deletion (`RUNNER_WORK_KINDS`), and the copy and the test join those kinds with the
pull requests that bring them into the server; a reading doesn't hold them up, and pauses instead (4.6).

**4.10 Withdraw and Delete.** A withdrawal holds at once (4.3). Delete this case first stops the case's journal work (4.1: no new work
admitted, the deletion count raised, the previews dropped, the reading and the test stopped, the copy waited for), then removes, as
today, the case with all its copies (a tombstoned one and a reading's included), its journal fields on the list (the copies, the
pending copy, the reading and the upload digests go; both consents stay as recorded) and its journal folder (the copy key, the reading
key, the held-back digests, the receipts, the marker and the hidden passages of 5.4).

## 5. The Journal tab

**5.1 Who can be shown, and when.** A Journal tab, only with the trial on, with a picker: "You" when the owner's own case has a copy,
and each client with a copy whose journal consent and tab consent both stand. It reads the newest copy, tested or not (i81 4a): the
pending copy of Add more when there is one, otherwise the copy in use; never a reading that isn't a copy yet. It reads through a
grant made in the process for that request (read, `organize_search`), never a reply's.
- **What it counts, and what it may show.** Two sets, each fixed by i83's answer (1a). The set it counts, from which the days, the month
  lines and the count of entries without a date are drawn: the passages a reply may quote (a passage in a lifecycle a reply may use,
  not restricted, its words checked against the stored bytes: the reader's own `evidenceCandidate` rule), less the hidden ones (5.4),
  and, under 1a or 1b, less every passage of an entry that 5.4 leaves out, so that such an entry is in no count and marks no day. The
  set it may show, for then and now: under 1a or 1b the very same set, so nothing is shown that isn't counted; under 1c, and for a
  copy without marks under 1a, none at all, while the counted set is the passages a reply may quote less the hidden ones (5.4 says
  why a day's mark may count them there).
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

**5.2 Days with writing.** The days named by the date lines over the passages the tab counts (5.1): a date with a day's precision
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

**5.4 Keeping content about wanting to die out (i83 1a).** The tab shows nothing written about wanting to die. How it finds such
writing was the owner's choice, i83: he chose **1a**. The two other options stay below for the record:
- **i83 1a (chosen):** the reading's mark (4.6) and the word list below, together: a passage the reading marked, or that holds a
  word or phrase of the list, is left out with its whole entry, by the rules below. The mark is a model's reading made when the copy
  was built; the tab itself makes no call. Where there is no mark, nothing falls back to the list alone: the passages of a page
  whose mark is missing or malformed are left out as a marked passage's are, and a copy the reading never read (a copy from the
  server) shows what 1c shows, its days with writing and never a passage.
- **i83 1b (not chosen):** the word list alone, by the same rules.
- **i83 1c (not chosen):** for now, only the days with writing: then and now isn't built, so no passage is shown. A day's mark is the same
  whatever was written and shows only that something was, so no list applies to the days, and a day whose only writing is about
  dying is marked like any other: nothing of it is charted or quoted.
These are how each option applies to the edge cases. None of them can promise what the line held says outright: under 1a and 1b a
passage about wanting to die that neither the mark nor the list catches can be quoted, and under 1c days whose only writing is about
it are marked (marked like any other day, showing nothing of it). Which of these limits to accept is what i83 asked; the owner's
answer, 1a, takes 1a's limit as the question put it: "A reading and a list can both miss things, and the tab will say so."
Under 1a and 1b the tab uses a fixed list (`src/runner-trial/dying-words.mjs`), in English and French, read in their forms: (a) direct
words and phrases of suicide, killing oneself, self-harm and overdose; (b) indirect phrases of not wanting to exist ("not wake up",
"better off without me", "ne plus être là", and the like); (c) any word of dying and death (die, dead, death, kill; mourir, mort,
tuer). Then:
- **A passage that holds one (or, under 1a, that the reading marked) is never shown, nor is any other passage of its entry.** An
  entry runs, in the journal's order and across pages, from one entry line (`entryDateLine`, by the quote index's own split of the
  copy's source texts, taken in order across all of them, so this holds for a copy from the server too) to the next. A page not fully read (a parse status other than readable) may hide
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
- The tab states its limit, in 1a's words: "Passages that mention dying, death or self-harm are left out by the journal's reading and a
  list of words; some can still get through."
The list leaves out too much on purpose (entries about grief and illness go too). It can't catch every indirect way of writing about
wanting to die; the reading's mark catches what a model reads as such, with misses of its own; neither checks a passage at the moment
it is shown. Of the three, the owner chose 1a (i83).

**5.5 Empty and limit states.** No copy: "No journal copied in yet." A client whose tab consent doesn't stand isn't in the picker. A
copy without date lines: "This journal has no dates the calendar can read: its entries don't start with a date." Entries without a
date: counted ("N entries have no date of their own"). A theme of stop words only, or too long: said so. A theme found nowhere, or only
in passages left out: "No passage holds it." More than 24 months: navigation. A copy that can't be read: "This journal can't be read
just now", with a code, never its words.

## 6. Data flows to models

| Step | What leaves the laptop | To | Decided |
|---|---|---|---|
| Add journal, the preview, building the copy, a server copy's import | nothing | | |
| The reading ("Read it and copy it in", "Go on reading", "Read again"; Add more's new pages) | the whole journal, page by page: each reading page's exact text, number and digest, with the reader's fixed instruction and the adapter's routing fields; then, to the summary calls, either up to twelve pages' overviews and findings with their page numbers, digests and opaque references, or, a level up, the summaries below with their opaque references and meaningful changes (never a quotation array; a finding, a summary or a change is free text and may repeat the journal's words), compared within the journal alone | OpenAI (GPT through the trial's Codex, on the owner's ChatGPT plan; pinned) | i81 1b (the order of 18 Oct) |
| The Journal tab | nothing | | the first slice: no model (it reads the reading's marks, kept with the copy: i83 1a) |
| The questions tool, writing | about 90 sampled passages a run, 150 at most with the extra batches and the replacements of skipped ones (exact words, entry dates), and the instructions | OpenAI (GPT through Codex, on the owner's ChatGPT plan; in pull request 1 only in a trial folder set apart for invented journals, on a copy holding the invented-journal sentinel, then under a consent in version 2's words, 3) | i77 3a |
| The questions tool, key checks | each answerable candidate with its evidence passage, which was sampled already | OpenAI | i77 3a (part of the writing) |
| The cold test, consumer | each question, with the at most six passages the replies' reader returns | the writer's worker (mixed: OpenAI) | i77, as built |
| The cold test, judge | the question, its key quotes, those passages, the answer and the planted answers | the checker's worker (mixed: Anthropic) | i77, as built |
| Replies | at most six quotations a turn (twelve after a repair's search), to the writer and the checker | mixed: OpenAI and Anthropic | i73, i75, i77; only with IS22's check on |
| Anything else | none in this design | | the owner's: say, a model checking the tab's passages as they are shown, or a person reviewing pages the reading couldn't read (4.6) |

The reading sends OpenAI the whole journal once, every page the reader can take, and Add more's new pages once more; nothing it sends
goes to Anthropic. Then, in each run, the questions tool sends GPT again only the passages it sampled (about 90, and 150 at most), and
the test what a reply's search returns for each question, as built. The person's consent, in version 2's words (4.3), names the
reading and both companies.

## 7. Where each part lives

- **New:** `src/journal-import/parsers/docx-adapter.mjs`; `src/journal-import/journal-upload.mjs` (the generation from a parsed file,
  the reading pages of a file without pages, the entries across pages and their comparison for Add more, the preview's counts, the
  copy's persistence and checks, and, on a copy, the days and the theme search over the passages the tab may show);
  `src/runner-trial/cold-questions.mjs` (section 3: sampling, the list of subjects for unanswerable questions with their names, the
  verbs, instructions, schemas, checks, the held-back passages, the file); `src/runner-trial/cold-test-job.mjs` (the test's job,
  shared by the command and the server: the attempt marker, the receipt rule, the consent reads, the questions tool when asked);
  `src/runner-trial/journal-reading.mjs` (4.6: the reading pages' storage, the port over the sealed Codex worker for the import's two
  roles, the mark, going on without sending a page again, the held-back passages, the reading key); `src/runner-trial/journal-steps.mjs`
  (the server's service: people, consent, previews, the reading, copies, the test's job, the status, the tab's reads and their moment
  of showing, each case's deletion count, and the start's sweep of published copies the list doesn't name);
  `src/runner-trial/dying-words.mjs`.
- **Changed:** `src/journal-import/parsers/index.mjs` and `parser-child.mjs` (the `docx` format by extension, and the child's leave to
  read `src/core/zip.mjs`); `src/core/zip.mjs` (a maximum output length for each entry); `src/journal-import/retrieval.mjs` (one new
  export, beside the search and changing nothing in it: which of a text's search words, read as `findEvidenceQuotes` reads them, any
  of many passages holds, for 3.2's subjects); `src/runner-trial/clients.mjs` (schema
  version 2: the tab consent, the journal consent's words, the reading, the pending copy, the upload digests, the owner's own entry, receipts by corpus, the page's view);
  `src/runner-trial/journal-gate.mjs` (the owner's own case, receipts by corpus; a pending copy is never read);
  `src/runner-trial/trial-controller.mjs` (the service, the gate also for the owner's own case, and Delete stopping the case's
  journal work before it removes anything);
  `src/supervisor/private-therapy-turn-controller.mjs` (the case's queue offered to the service); `src/server/create-server.mjs` (the
  routes, with a body limit of its own for the preview); `scripts/runner-trial-start.mjs` (`addClient` shared, grants for the owner's
  own journal); `scripts/runner-trial-journal.mjs` (the cold test from the shared job, with `--gpt-questions`; every receipt of the
  client removed by an import); `apps/web/index.html`, `app.js` and `styles.css` (the People and Journal tabs); `docs/RUNNER-TRIAL.md`.
- **Unchanged:** the replies' search and reader (`SESSION_USE_READER_VERSION` stays, and the test that holds it, `READS`, stays
  green), the pass rule (`COLD_TEST_RULE` stays version 4), the runtime's journal hold, the run log (it gains no field).

## 8. Failure states

Each has fixed words on the page and a code, never words, wherever it is recorded.

- **Add journal:** a kind not accepted; bytes that don't match the kind; text that isn't UTF-8 ("save it as UTF-8 text and try
  again"); a PDF with no text; a Word file that is damaged, encrypted, too large or holds a `DOCTYPE`; over the size or page limit; the
  parser's time (30 s) or memory limit; a file with no passage.
- **The preview:** expired, replaced, or of another person; a consent only in version 1's words (Add journal asks for version 2's);
  the folder's lock busy; the same file already copied for another person.
- **The reading (4.6):** the consent withdrawn or the person deleted meanwhile (it stops before its next call; what was stored stays
  unused until Delete, or goes with it); a plan limit or a lapsed sign-in (it stops, every page read kept: "Go on reading" later); a
  worker that takes an action or can't be made sealed (it stops); a page with a picture or no text (`visual_pending`,
  `source_unavailable`); a page answered outside its schema after two more asks, which is how GPT's refusal most likely comes
  (`reader_output_invalid`), or refused (`tool_refused`), neither sent again, here or by a later reading (held back); an answer
  whose quotations aren't in the page (`reader_evidence_invalid`) or a call that didn't finish or a page too large
  (`reader_unavailable`), which "Read again" may send again; each of these leaves the reading without a copy until every page is
  read, so the owner reads again or cancels; a summary answer still outside its schema (it stops, the pages kept); a receipt, or a
  stored page, that doesn't verify (`JOURNAL_READING_FIRST_*`: no copy is built); Stop, Restart or Stop of the runner (it pauses); a
  late answer of an ended attempt (dropped); the server stopped (it shows as stopped at the next start, its pages kept); a full disk.
- **The copy:** the consent withdrawn, or the person deleted, meanwhile (the new corpus is tombstoned, the list unchanged); a vault
  write that fails before the publication (the reading stays as it was, named on the list); anything that fails after it, the check
  included (the new corpus is tombstoned, and the list doesn't name it); the server stopping in between (the next start's sweep
  tombstones it); Delete during a copy (the copy stops before its next write, and nothing of the case is written again); a full disk;
  Add more on a copy from the server, or on a copy holding a passage that isn't active and unrestricted, or of a PDF with any page
  that holds a picture or no text.
- **The cold test:** too few passages for the questions tool (section 3.1); not enough questions written (3.5), a batch or a key
  check dropped for its form included (3.2, 3.4); a refusal a worker says it made (not asked again: its batch dropped and held back);
  GPT's questions asked for, in pull request 1, outside a trial folder set apart for invented journals, in the default trial folder or
  one a runner starts from, or on a copy whose first passage isn't a passage a reply may quote whose words are exactly the
  invented-journal sentinel, byte for byte (each refused before any call);
  the questions tool's budget spent (3.1, 3.8); a passage another run held back meanwhile, of the packet or holding the evidence of a
  key check's question (3.2: it stops before that packet goes); the judge's company as the author (the codex arrangement); a plan limit or a lapsed
  sign-in (it stops); a refusal in the test (Claude's is counted as left out; GPT's comes as a malformed
  answer, is asked twice more, and then stops the test); a withdrawal, a Delete, another publication or a newer Add more that replaces
  the copy under test (it stops before the next packet); a newer test started (the newer one decides); the server stopped
  (interrupted, no receipt: run it again).
- **The Journal tab:** a consent withdrawn before the moment of showing (nothing is sent) or after it (the page clears the tab); the
  status unreadable (the page clears the tab); a theme refused (section 5.4); a copy that can't be read.
- **Restart and Stop:** refused while a reply, a copy or a test runs; a reading pauses (4.6); a start that fails after a restart (the
  launcher's log holds the start script's own lines and codes, and the icon starts it again).

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
| R1 | No preview, reading or copy without the person's journal consent, and no reading without it in version 2's words; read again under the lock before each call of the reading and before the copy is named | a version 1 consent: no reading; a withdrawal during the reading (no next call) and during the copy (the corpus tombstoned, the list unchanged) |
| R2 | Only the accepted kinds, checked by their bytes | a PDF named `.txt`, a ZIP named `.docx` without `word/document.xml`, Latin-1 text: each refused |
| R3 | No plaintext is written anywhere before "Read it and copy it in" | the parser child can't write (Node's permission model); the server's preview path runs with every writing function of `node:fs`, in its callback and its promise forms, replaced by one that fails the test; a mutation that writes and removes a temporary file elsewhere must make it fail |
| R4 | The preview holds numbers and dates only | no planted word in its answer or any log |
| R5 | A preview expires, is bound to its case, one a person and three at most, dropped on Cancel, on Delete and on a restart | a copy of an expired, replaced, deleted or other person's preview is refused |
| R6 | A copy is published for `organize_search` and `session_use`, without archive or the file's bytes | the manifest's uses and objects |
| R7 | Every usable passage is resolved against the stored bytes after a copy | a store that changes one byte fails the copy, and the list doesn't name it |
| R8 | The same file is refused for another person | the second person's copy refused |
| R9 | Add more adds only the entries not already in, and reads dates across all | an invented journal with overlapping files: the counts and the dates |
| R10 | The copy in use keeps its receipt while the pending copy is tested; a pass moves the list in one write and tombstones the earlier copy; a failing test leaves the copy in use | stand-in turns during and after the test: the gate stays open on the earlier copy, then opens on the new one, and the earlier one can't be read |
| R11 | Word, through the real permission-restricted child: `word/document.xml` only; `DOCTYPE` and entities refused; deletions and moves away out, insertions and moves in kept; text boxes and fallbacks not read; the ZIP limits and the maximum output length | a valid file read as said; crafted hostile files refused |
| R12 | The date-order choice applies, preset to fewer dates out of order | 3/4 read each way |
| R13 | The questions tool samples all the passages a reply may quote, short ones included, spread over the quarters, each once while there are enough, a skipped one replaced from its quarter; passages about dying like any other (i81 5b), planted wrong answers assigned to them as to any | a sample from an invented journal with short passages and planted entries about dying: those entries are sampled, sent and given planted answers as any other, so a list that left them out, or withheld their plants, fails it |
| R14 | GPT's packet holds only its batch's passages, under opaque names, with their dates | the packet inspected: no case or corpus id, label or other passage |
| R15 | Each check of 3.3, and the program's drops before the key check (3.4) | a candidate made to fail each check is dropped; a phrase with any character but words and single spaces (a full stop that starts a second question, a dash, a colon, brackets, quotation marks, a slash, an ampersand, a hyphen between words, a symbol, a number that isn't a decimal digit, "½"), while French words with an apostrophe, accents, a hyphen inside a word or decimal digits pass, and a tab is read as a space; a question or a planted answer carrying nine words of another passage of its batch: dropped, and no key check carries them; a question carrying the words of another passage holding its evidence quote, once this run holds that passage back, before or after the question is written: dropped before its check, and no key check holds those words |
| R16 | The key checks of 3.4: answerable ones by GPT on the evidence passage alone; an unanswerable subject chosen by the program from its list and named by no usable passage in any of its names; unanswerable questions put together in the fixed shapes from parts that pass their checks | the stand-in doubts a key or says a planted answer is true: dropped; a subject one passage names in another of its names: never chosen, nor one a passage names in another form of a name, on a copy without a word list too ("camels"); parts with a question word, "or", "rather", "instead", "besides", a comma or more than eight words, or with a verb not on the list ("mention", "write about", "name"): dropped; the check's packet holds no passage the search returned |
| R17 | Too few passages, or too few questions of any kind (the eight in other words included): no test; the file, cut to its aims, keeps planted answers first, kind by kind, and is checked against the rule again | codes only, no call to the test's workers; GPT wording seventeen planted questions in none of their passages' words: each kind keeps its three in the file; a file short of the rule after its cut: no test |
| R18 | The author is `openai`, refused when the judge is OpenAI; in pull request 1, GPT's questions only in a trial folder set apart for invented journals, never the default one nor one a runner starts from (holding `launcher.json`), and only on a copy whose first passage at the tested publication, of all its passages, is a passage a reply may quote whose stored words are exactly the code's sentence, byte for byte (from pull request 3, also under a version 2 consent) | the codex arrangement, a normal trial folder's client copy, the default trial folder even with the file, a set-apart folder holding `launcher.json`, a copy without the sentinel inside a set-apart folder, and, cut as the import cuts a journal, copies whose first passage is anything else (the sentence inside other words, at the end of a first paragraph over 1,600 bytes, at the start of one, after another paragraph, under a date line, with more words on the next line, with a blank line inside it, after a passage a reply may not quote, or the sentence itself in a passage a reply may not quote): each refused before any call; copies whose first passage is exactly the sentence (from a file that opens with it as a paragraph, followed by a run of spaces and more words on its line, or with a date line right under it): run; a copy with a passage that has no place, or two sharing the first: no first passage; a questions file still runs |
| R19 | The consent and the copy are read under the lock before each packet of the tool and of the test, and before each of the tool's the held-back list in the same hold; a key check's packet is guarded against every passage holding its questions' evidence quotes | a withdrawal before each kind of packet stops the run, with no receipt; a lock that numbers its holds, through the job: for every packet of the tool, the consent check and the list in one hold; another run's hold-back of the next packet's passages, written while this run is under way, stops it before that packet leaves (in the tool and through the job), the ask not counted, a first ask's or an ask again's (calls made and asked again back to the first ask's, its passages still counted as sent); another run's hold-back of a passage a key check's question carries, which isn't one of the check's own: stopped before it leaves; such a passage, guarded only, isn't counted as sent |
| R20 | Of tests of one copy that overlap, the newest decides (the command's attempt marker, kept by the shared job; the page adds one test a person at a time with pull request 4); a receipt only for a pass; numbers only | the command's tests, run through the shared job; overlapping runs with GPT's questions; one wrong consumer answer in a run with GPT's questions: no receipt |
| R21 | Two consent parts; the tab consent needs the journal consent; each withdrawal's effect | every order of confirming and withdrawing |
| R22 | A client is in the tab's picker only with both consents; the owner's own journal needs no tab consent; the copy read is the newest, tested or not (i81 4a) | requests for a first copy and a pending copy without a receipt: both shown, the pending one when there is one; a reading that isn't a copy yet: nothing |
| R23 | Days with writing come only from the passages the tab counts (5.1, by i83's answer, 1a), apart from what it may show, with a day's date; one mark a day; undated entries counted | an invented journal with ranges, months, years, inferred years and excluded passages, under i83's answer, 1a: an excluded-only day unmarked; for a copy the reading never read (a server copy, shown as 1c would show it), marked with no passage shown |
| R24 | Then and now: whole sentences, one passage a month by the stated rule, at most 24 months, the entry's own date | crafted passages with a "not" beside the theme |
| R25 | By i83's answer, 1a: a passage holding a listed word, or one the reading marked, is never shown, nor its entry (across pages, past a page not fully read, two passages each side without entry lines); a theme holding one shows the support line; a month with only such passages shows nothing; for a copy the reading never read, no passage at all | planted entries in English and French, of each part of the list, one running onto the next page, and marked passages without a listed word |
| R26 | Hidden passages stay hidden across Add more; Delete removes them | the digest file before and after |
| R27 | No model call from Add journal, the preview, building the copy or the tab; before a copy, the reading is the only one, and only after "Read it and copy it in" | the failing worker factory everywhere but the reading's port |
| R28 | No words in any log: the run log, the server's console, the launcher's log, errors | the planted words |
| R29 | The owner-page checks, the case on the trial's list and the body limits on every new route | a bearer token, a foreign Origin or Host, no Origin, another content type, another case, a body over the limit |
| R30 | The page keeps no tab data and no label in local storage or a URL | JSDOM's storage and location read after each step |
| R31 | Restart and Stop are refused while a reply, a copy or a test runs, and pause a reading instead of waiting for it; a restart keeps the rules it runs and takes the list's consents into the grants (built for replies in pull request 254) | a stand-in launcher, during each kind of work |
| R32 | Add more is refused for a server copy, and for a copy holding a passage that isn't active and unrestricted | the sealed copy with excluded passages: refused, and none of its excluded passages shown by the tab or used in questions |
| R33 | The tab's moment of showing: the consents and the publication read again under the lock before an answer is sent; the page's clearing and its dropping of requests still out | a withdrawal ordered before (nothing sent) and after (the page clears the tab); an answer that arrives after the tab was cleared is dropped; a status that can't be read clears the tab; a tab left idle is cleared |
| R34 | No stale answer: requests and answers bound to the case and the choice number | two people's answers coming back in reverse order; a switch during a request |
| R35 | The tab reads only passages a reply may quote | deleted, revoked and restricted passages never shown, nor counted as days |
| R36 | Delete wins: no journal work admitted while a case is being deleted; each case's deletion count checked inside the queue, before each batch of object writes and before each call of the reading; Delete drains the case's journal work before it takes the queue | Delete between a preview and its reading, during the reading, during the copy's writes, and during a test; a request that arrives after the count rises and before the deletion ends: refused; nothing of the case is written again, and the case stays gone |
| R37 | The case's queue before the folder's lock, everywhere | a turn waiting to deliver while a copy's last step and a promotion run: neither waits out the other |
| R38 | Whatever fails after a publication tombstones that corpus; the start's sweep tombstones a published copy the list doesn't name; Cancel and the copy's last step are ordered by the case's queue and the lock | a failure of the check, of the consent and of the list's write after publication; a stop between publication and naming; a Cancel after the summary and before the publication, and one after the publication and before the naming: no copy named, the published one tombstoned |
| R39 | One counted set for the days, the lines and the counts, and the shown set never wider than it (5.1) | under i83's answer, 1a, a month with only excluded entries: no mark, no line, no count, no passage |
| R40 | Add more builds on the newest copy; one copy in the making a person; one whose base is no longer the newest is refused; a newer one replaces the pending copy; a pass promotes only the pending copy it tested | A, then pending A+B, then a file C: the new copy holds A, B and C; the test of A+B stops with no receipt; an old pass can't promote; two additions at once: the second refused, or refused at its end when the first changed the base |
| R41 | One budget a run: at most 150 distinct passages to GPT and 20 calls of its worker for the questions, every call asked again included; spent, the run stops with no test | a journal whose sampled passages are mostly skipped, and a worker that fails for its form near the end: the count of passages sent and of the worker's actual calls, and no test |
| R42 | A copy's grant holds read and write with the purposes the import asks; a tombstone's write with `delete` | the copy and its checks under the restricted one-time grant; a grant with write alone fails the check |
| R43 | A passage of fewer than four words may be its question's evidence whole; one that holds nothing to ask about is skipped | short passages with something to ask, and a date line alone |
| R44 | The questions tool's batch, or key check, without an answer in its schema after two more asks is dropped whole: its passages go to the tool's GPT calls in no later call of the run, nor of a later run on that person's copies (held back), and are counted | a stand-in that answers one writing batch, and then one key check, outside its schema three times, and one that says it refused a key check: none of their passages in a later packet of this run or the next, the refusal not asked again, and the report's counts; an answer outside its schema and a timeout in either order: only a third answer outside it drops the batch; three timeouts stop the tool, holding nothing back |
| R45 | The reading's pages: a PDF's pages; a text, Markdown or Word file cut into whole passages, at most 4 KB and 40 a page, ending before an entry line in a page's last quarter; each page one source text of the copy | invented files of each kind: the cut, the source texts and the dates read across them |
| R46 | A page's packet holds only the adapter's fields; a summary packet has the batch shape (overviews, findings, page numbers, digests, references) or the level shape (child summaries, their references and meaningful changes), with the journal-only scope, and never an `exact_source_anchors` array; all go to the sealed Codex worker whatever the arrangement, one call at a time | the packets of both summary shapes and of the pages inspected, under the claude arrangement too, and Add more's summaries over carried readings: no case or corpus id, label, file name, other page, quotation array or conversation |
| R47 | No copy without a reading of every page whose receipts verify for exactly its source and pages, and whose pages' stored texts match the signed inventory's digests; no partial copy | a missing, forged or stale receipt, a page still pending, and a stored page whose bytes changed with the page count the same: no copy, and no route builds one without the missing page |
| R48 | A page is sent once: "Read again" only for `reader_evidence_invalid` and `reader_unavailable`; a page left for `tool_refused` or `reader_output_invalid` never again, nor a passage or sentence of it in a later reading, however that reading cuts its pages | a stand-in that answers one page outside its schema three times: never sent again by "Read again", Add more, the same file uploaded again, or the same text cut into other pages and paragraphs; a page that timed out: sent again |
| R49 | Only a page's reading that passed the import's checks lasts, and it is replayed, never sent again, after a Stop, a pause, a start or a cut between the answer and its keeping; an answer that failed them is kept nowhere; each run is an attempt, and an answer of an ended attempt is dropped by the check made before keeping it, also when the reading has gone on; Restart and Stop stop admitting journal work, then pause the readings, then close the gate | a stand-in counting the calls of each page across a Stop and a stand-in restart; answers that arrive after Stop, Cancel, a withdrawal, a Delete and a "Go on reading" that followed a Stop: none kept; a stop between receiving and keeping: that page sent again once; "Read again" after an answer that failed the checks: a fresh call; a reading asked for while Restart pauses the others: refused |
| R50 | Add more's reading sends only the new pages; each earlier page's reading is written into the new ledger only when its page's digest matches; the summary and the receipts are made again; a PDF with any page holding a picture or no text is refused, on its page inventory, before entries are compared | the stand-in's calls: the new pages alone; a carried reading whose digest doesn't match: refused; a PDF with a new entry on a picture page, and one with a standalone page that holds only a picture: each refused, with the count, and nothing added |
| R51 | The mark is checked apart from the reading result: a missing, malformed or valid mark leaves the page's acceptance, the copy and the questions the same; a valid one is kept as spans found as the quotations are | the same journal answered with valid marks, with none and with malformed ones (one naming a quotation that isn't there): the same pages read, the same copy, the same sample; only the valid marks kept |
| R52 | The reading's evidence, ledger and receipts stay in the person's case, encrypted; the receipts are signed with the person's reading key, which their Delete removes; the progress and the log hold numbers only | the vault's objects, the journal folder before and after Delete, the planted words |
| R53 | No index before the reading: the preview and the reading build no generation, graph, word list or other index; the copy's are built only after the receipts and the pages' digests verify | the generation, graph and word-list builders replaced by ones that fail the test during the preview and the reading |
| R54 | Consent versions: a file needs version 2's words, a server copy either; "Ask again in the new words" records version 2 over a standing version 1 | a version 1 record, a withdrawn record and a version 2 record, with each kind of file; the re-confirmation recorded |

Beyond these: the shared cold-test job passes the command's existing tests unchanged, and the replies' reader's recorded results
(`READS`) are unchanged. Pull request 1 brings R13 to R20, R41, R43 and R44 (R19 and R20 through the command, the page's job coming
with pull request 4), with a test that fails when each is taken out.

## 10. How it ships

Six pull requests, then the graph's own design and build (4b, the owner's i84 1c), each with a second review (GPT's; for pull request
1, a separate Claude reviewer's, GPT's week being kept for the owner's daily news check), the full test gate and its table of rules
taken out, and each merge brought to the owner.
The reading (i81 1b) makes the journal steps too large for one, so they are split in two (3 and 4), and the tab and the switches
move down one:

| # | What | Waits for | Rough effort |
|---|---|---|---|
| 1 | The questions tool (section 3) and the cold test's job shared by the command and, later, the server (`cold-test-job.mjs`); the command runs a test with GPT's questions (`--cold-test --gpt-questions`), only in a trial folder set apart for invented journals (never the default one, nor one a runner starts from) and on a copy whose first passage is a passage a reply may quote whose words are exactly the invented-journal sentinel, until the consent in version 2's words comes with 3. Built in one pull request with this design, which it carries | the owner's yes to this design (i81, given) | 1.5 to 2 days |
| | **The measured run (i81 6a):** the tool and the test with the real models on an invented journal, about 200 calls on the owner's plans: how often a good copy passes, what the key check drops and how often an unanswerable question's subject is told of without being named (both against the journal's known contents), the calls and the minutes. The numbers come back to him, with the choice to keep 2b or loosen it (his i77 note) | 1 merged; the lane runs it | half a day, plus the calls |
| 2 | IS24's rest: a launcher and the icon, Restart and Stop on the page, the owner's switches kept in the launcher's settings | built and merged as pull request 254 (26 Nov) | done |
| 3 | The journal steps up to a first copy: the People tab, adding a client, both parts of the consent in version 2's words, Add journal (PDF, text, Markdown, Word, a server copy), the preview, the reading (4.6), the copy (4.7), withdraw; the owner's own journal | 1 | 3 to 3.5 days |
| 4 | Add more (4.8) and the cold test from the page, with its status (4.9) | 3 | 1.5 to 2 days |
| 4b | The graph of the 18 Oct order (i84 1c): its own design first; then the graph from the reading's findings, compared with the index alone on invented questions about time and contradictions; replies use it only if it does better | 3 and 4; its design | not estimated |
| 5 | The Journal tab: days with writing, then and now, what i83 1a chose (5.4), Hide, the moment of showing | 3 (and 4 for a pending copy) | 1.5 to 2 days |
| 6 | IS23's switches: the journal for each conversation, and the check of each reply, with the seconds each adds | IS22's run on invented cases | 1 day |

IS24's rest came first (merged as pull request 254): a consent and a new client take effect only at a start, and the page's Restart
makes it without a terminal. The reading is part of a first copy, so it comes with 3; the measured run of 6a measures the questions
tool and the test, not the reading, whose pace the reading's own progress shows (4.6). IS23 comes last: a journal is used only with
the check of each reply on, which is IS22's question, and the seconds each switch adds come from IS22's run. The efforts are rough
calendar days of a helper session with its reviews, not measured: about 9 to 11 days from here, the measured run included, plus the graph (4b), not estimated until its design.

**The launcher**, as built (pull request 254; `docs/RUNNER-TRIAL.md`, "Without a terminal"), refuses Restart and Stop while a reply or
a deletion runs (`RUNNER_WORK_KINDS`). The copy and the test join those kinds with pull requests 3 and 4. A reading doesn't: it is
long, so Restart and Stop pause it instead (4.6).

## 11. The owner's choices

Of the six choices this design first put to him (question i81), five were answered, `1b 3a 4a 5b 6a`; the second was asked again
as i83 and answered `1a`. Whether his 1b also asks the runner for the later stages of his 18 Oct order, the graph and its checks,
was asked as i84 and answered `1c` (see "What the owner decided"). No choice of this design is open.

## 12. Limits

- The copy is protected like the rest of the trial, by its development key file: whoever can read the owner's files can open the
  vault (and the digests of hidden passages, beside it).
- A preview's text stays in the server's memory until it is dropped (minutes); text in memory can't be wiped.
- A replaced or withdrawn copy is tombstoned, not deleted (the store deletes no single corpus): its encrypted objects stay until
  Delete, so each Add more adds a copy's size; so does a cancelled reading's stored text and readings.
- The reading sends the whole journal to OpenAI and is a long run on the owner's ChatGPT plan (4.6: roughly one to three hours for 100
  reading pages, not measured). Its findings and summary are GPT's provisional reading, kept encrypted with the copy and shown nowhere
  in this slice; no reply reads them.
- The reading reads text: a page with a picture, or without text, is never read, and with no review route and no partial copy in
  this slice, a journal with such a page, or with a page GPT won't answer in form, can't be copied in from a file (a copy from the
  server still can). Such a page is held back from later readings; after the person's Delete nothing of theirs is kept, the
  held-back digests included. A copy without those pages, or a person's review of them, would be the owner's decision. The held-back
  digests (of passages and sentences) can miss a refused sentence split across two pages of a later reading: they keep a refused page
  from being sent again, and are no guarantee across every cut.
- Dates are read from date lines at the start of a line, in English and French; a journal dated otherwise, or only by its file names
  (daily-note folders), has no days with writing and no months for then and now.
- Word's headers, footers, footnotes, comments and text boxes aren't read, nor PDF pages without text.
- The word list (5.4) can miss indirect wording, and the reading's mark has misses of its own. The key check (3.4) lowers the odds of a
  wrong key without removing them, and a journal may tell of an unanswerable question's subject without naming it. Each run writes new
  questions, and a pass after several runs may be by chance (the count is shown). A refusal by GPT in the questions tool drops a batch
  (3.2), so the passages GPT won't write about are the ones the test covers least, and the report counts them.
- The questions tool needs 24 passages a reply may quote (its floor, not the rule's); a shorter journal gets no cold test, so no reply
  ever uses it, while its Journal tab still works (i81 4a). Held-back passages stay held back until the person's Delete and count
  against that floor: a journal of 24 to 38 passages that loses one batch of 15 falls under it for every later run (a questions file
  can still test it).
- Held-back passages are kept only from the questions tool's GPT calls (and a page the reading couldn't read from later readings):
  the same passages still reach GPT and Claude through the cold test's consumer and judge, and through the replies, whose reader this
  design leaves unchanged; and a Claude judge's refusal in the test (`REFUSED`) is counted as left out and holds nothing back. Only
  the reading's and the questions tool's worker, Codex, can't say that it refused, so their ambiguous failures are what is held back.
  Only a failure of a whole batch is taken as a possible refusal: a passage GPT skips in its schema is replaced, not held back, and may
  be sent again in a later batch of the same run.
- The questions tool knows a held-back passage by the digest of its exact words (3.2). A later copy that cuts the journal into
  passages differently (an entry joined to the next, or split) makes passages with new digests, which may go to its GPT calls again.
  An import cuts the same text the same way under the same settings; a changed journal, added text joined to a short last passage, or a
  change to how the import cuts (its unit sizes, or the pages a reading makes of a file) can make new passages. Digests of shorter
  runs of words would catch such cuts, but would let whoever can read the folder test a guessed phrase against them.
- The invented-journal sentinel's check is of the copy's first passage, not of the file (3): GPT's questions run only on a copy whose
  first passage, in the copy's source order, is a passage a reply may quote whose stored words are exactly the code's sentence, byte for
  byte. Different files can give that passage: one that opens with the sentence as a paragraph; one whose first line holds the
  sentence, a run of spaces long enough for the import to cut in it, and more words; one with a date line right under the sentence.
  All of them open with the code's sentence, and a journal opens with it only if someone put it there.
- The consent, the copy and the held-back list are read in one hold of the folder's lock right before each of the questions tool's
  packets leaves (3.2, 3.7), and the packet leaves after the lock is released: a withdrawal, or another run's hold-back, committed in
  that instant doesn't stop that packet. A withdrawal stops the run at the next packet, of the tool or of the test, or before the
  receipt is written. A hold-back is read only before each of the tool's packets: a later packet that holds or guards that passage
  stops the run, the packets the tool prepares after reading it leave the passage out, and the test's packets and the receipt step
  don't read the list (held-back passages reach the test as any passage does, as said above). Holding the lock through a call, which can take minutes, would stop every other action on
  the trial folder for that long, the withdrawal itself included. The cold test's own packets have the same instant.
- A phrase of an unanswerable question is checked for its characters and words (3.2), not for its meaning: words alone, spaced or
  joined by hyphens, can still read as a second question ("after the abacus did I lend it"), which the key check doesn't see, since unanswerable questions have no model
  check (3.4).
- Once the owner's own case has read his journal, it stops like a client's while its gate is closed (a withdrawal, a lost receipt, a
  changed reader or rule): a new pass, or deleting that case, are the ways on.
- With `--provider codex` the cold test can't run with GPT's questions.
- The page's words (the consent questions, the support line, the tab's sentences) are shown to the owner with the build that adds
  them.
- Nothing here is measured or run on a real journal; of the build, pull request 1 is made with this design, and the rest is not
  built.

## Appendix: Codex's reviews, and Claude's

The tables name sections and questions as numbered in the revision each review read. The revision for i81 added 4.6 (the reading),
so the former 4.6 to 4.9 are now 4.7 to 4.10, and section 11's questions 1 and 3 to 6 are answered.

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

**Review 6** (27 Nov 2026, the same way, on the revision for i81 `1b 3a 4a 5b 6a`): eleven findings, eight blocking; "changes needed".

| # | Finding | What changed |
|---|---|---|
| 1 | Blocking: the preview built the quote generation before the reading | The preview uses the index's segmentation and date reader only; no generation, graph or index before the receipts and the pages' digests verify (4.5, 4.7; R53) |
| 2 | Blocking: the producer can't sign a partial set as written, and the gate doesn't see page bytes | The owner's decision is recorded first; the producer runs again over the pages read, numbered from one, replayed from the ledger, with receipts for that set; each stored page is checked against the signed inventory; an empty set is refused; the record goes on with Add more (4.6, "A copy without some pages"; 4.7; R47) |
| 3 | Blocking: a partial copy's use and the order's graph were unclear | A partial copy is a copy like any other, labelled, tested before use and counted on the tab; the click is the owner's explicit decision for that copy, which the order asks; the copy has no person, topic or event graph, so the order's graph isn't built (4.6; section 2, step 7) |
| 4 | Blocking: a bad mark could fail a page's reading | An envelope: the import's result checked alone, the mark apart; a missing or malformed mark never fails the page, and under i83 1a its page shows no passage (4.6, 5.4; R51) |
| 5 | Blocking: no completion contract for stops, going on and carried readings | The port's ledger: answers kept before a call counts as done, replayed, never resent; an abort signal for the sealed worker; late answers dropped by a check before keeping; carried readings rebound by digest under the new work ids; Restart and Stop pause in two steps (4.6, 4.8; R49, R50) |
| 6 | Blocking: held-back passages could leave by another route; Add more flattened PDF pictures | The held-back lists bind the calls that send passages to be read or written about; a reply's search and the test's consumer and judge go on as built; key checks hold back too; a refusal a worker can tell isn't retried; from a PDF, Add more takes no entry on a page with a picture or without text (3.2, 3.4, 4.6, 4.8; R44, R50) |
| 7 | Blocking: the tab's options didn't settle unmarked copies or 1c's days | Under 1a nothing falls back to the list: an unmarked page shows no passage, and a server copy shows what 1c shows; under 1c a day's mark is the same whatever was written; the tab waits for i83 (5.4) |
| 8 | Blocking: pull request 1 would send GPT's questions beyond what today's consent names | Under a consent in version 1's words GPT's questions run only with the mixed arrangement, whose writer is GPT; claude waits for version 2; refused before any call (3, 6; R18) |
| 9 | The provider and the packets needed pinning and a full description | The route is pinned; a page's packet and a summary packet are described field by field, journal only, without quotations in the summary (4.6, 6; R46) |
| 10 | The consent's versions gave contradictory instructions | A file needs version 2, a server copy either; "Ask again in the new words" records version 2 over version 1, and the command does from pull request 3 (4.3, 4.4; R54) |
| 11 | Pull request 1's tests left guarantees unchecked | Plants on passages about dying, key checks that fail for their form, overlapping runs and one wrong answer through `--gpt-questions` are tested (R13, R18, R20, R44) |

Also: a `same` question that shares no search word is counted as `other` (3.3).

**Review 7** (27 Nov 2026, the same way, narrowed to those eleven): 1, 4 and 10 fixed; the others partly; two new findings;
"changes needed".

| # | Finding | What changed |
|---|---|---|
| 2, 12, 13 | Blocking: the partial copy couldn't be signed as written (renumbered pages, lost date boundaries), and Add more could lose entries unseen | No partial copy in this slice: a reading with a page not read builds nothing, and the owner reads again or cancels; a copy without such pages is his decision, not made here; Add more refuses a PDF whose new entries touch an unreadable page (4.6, 4.8; R47, R50; section 12) |
| 3 | Blocking: the order's read-derived graph and its checks | 1b as it was asked: read the whole journal before the copy is built (the quotation this row first gave added words his page never had: see 4.6, "What 1b covers"); the copy builds no graph at all, so nothing graph-like precedes the reading, and the order's later stages are the import's (4.6, "What 1b covers") |
| 5 | Blocking: late answers after a stop, admission during the pause, replayed failures | Only a reading that passed the import's checks lasts; each run is an attempt, checked before keeping anything; Restart and Stop stop admitting journal work before they pause the readings; "Read again" gets a fresh answer (4.6; R49) |
| 6 | Blocking: refused text could cross routes | With no partial copy, a page the reading couldn't read is in no copy, reply, test or tab; the questions tool's held-back passages are an ambiguous precaution, kept apart, of passages GPT read whole in the reading (4.6, 3.2) |
| 7 | Blocking for pull request 5: the tab's days and residual misses | The one set of passages under each option of i83 (5.1; R23); 5.4 says plainly that no option can promise the line outright, and that i83 is the owner's choice of which limit to accept |
| 8 | Blocking: today's consent can't show that OpenAI's questions were named | In pull request 1, GPT's questions run only with `--invented-journal`; for a person they wait for the consent in version 2's words (3, 4.3, 6; R18) |
| 9 | The reading's `expected_generation` was the corpus id; the summary packet's description | A random reading token instead; the summary packet sends no quotation arrays, and its findings may repeat the journal's words (4.6, 6) |
| 11 | A refusal the worker can tell, in a key check | Not asked again; dropped and held back at once (3.2; R44) |

**Review 8** (27 Nov 2026, the same way, narrowed to those ten): 2, 11 and 13 fixed; the others partly; one new finding; "changes
needed".

| # | Finding | What changed |
|---|---|---|
| 3 | Blocking: 1b's words don't waive the order's graph and its checks | Said plainly as the owner's to decide: pull request 3 waits for his word on whether 1b also asks for them (4.6, "What 1b covers"; section 10) |
| 5 | Blocking: Cancel could fall between the summary and the copy's naming | Cancel runs in the case's queue and under the lock, like the copy's last step, which also checks the reading's token and attempt (4.7; R38) |
| 6 | Blocking: digests could miss refused text cut another way; refusals and ambiguous failures on one list | The reading holds back each sentence of four words or more too; both of the runner's workers are Codex, so every failure is ambiguous, and the reading's list and the questions tool's are kept apart (4.6, 3.2; R48) |
| 7 | Days were drawn from the passages shown | Two sets: the one counted for days, lines and counts, and the one shown, never wider (5.1, 5.2; R23, R39) |
| 8 | Blocking: a flag doesn't bind the run to an invented journal | Pull request 1 runs GPT's questions only in a trial folder set apart for invented journals (a file no command writes), never the default one (3, 6, 10; R18) |
| 9 | The summary packet's two shapes | Both shapes described and tested, without `exact_source_anchors` (4.6; R46) |
| 12 | Blocking: an image-only page could escape Add more's check | A PDF is checked on its whole page inventory before entries are compared (4.8; R50) |
| 14 | The PDF line still spoke of a copy without the unreadable page | While any page stays unread the upload can't produce a copy (4.4) |

**Review 9** (27 Nov 2026, the same way, the fourth and last of this revision): 3, 5, 7, 12 and 14 fixed; 6, 8 and 9 partly; one new
finding; "changes needed". With four rounds spent, the lane's limit, no further round was run; what changed after it is below, and
is reviewed with pull request 1's code.

| # | Finding | What changed after it |
|---|---|---|
| 8 | Blocking: a set-apart folder can still hold a normal copy | GPT's questions also need the invented-journal sentinel in the very publication under test, checked before any call; its passage is left out of the questions (3; R18) |
| 9 | The data-flow table named only the batch shape | Both summary shapes in the table (6) |
| 15 | "Copy it in" tried again after a restart had no attempt | It makes one, under the case's queue and the lock, and sends no page (4.6) |
| 6 | Blocking: a refused sentence split across a later reading's pages can escape the digests; confirmed refusals aren't enforced on every route | Not changed beyond a stated limit (section 12): with no partial copy, a page the reading couldn't read is in no copy, reply, test or tab; the reading's and the questions tool's worker is Codex, so none of their failures is a confirmed refusal. Enforcing refusals on the replies' and the test's routes would change the replies' reader, which this design keeps unchanged; that is for the owner or pull request 3's review (after review 10, section 12 states that half of the limit too) |

**Review 10** (27 Nov 2026, a separate Claude reviewer, Fable, read-only, of pull request 1's code and of this design's changes since
review 9, given the code and not the lane's conclusions; GPT's week was kept for the owner's daily news check): review 9's 8, 9 and 15
fixed and 6 partly; nine findings, one blocking; "changes needed". What changed after it:

| # | Finding | What changed after it |
|---|---|---|
| 1 | Blocking: the state file still said i84 was open and pull request 3 waited for it | `state/CODEX-CURRENT-STATE.md` names i83 1a and i84 1c, and no open choice |
| 2 | The file's cut to its aims came after the check of enough, blind to kinds: GPT wording planted questions in none of their passages' words could leave a kind with two, and a test that can't pass would still run | Planted answers taken kind by kind, the fewest kept first, and the file checked against the rule again (3.5; R17) |
| 3 | Review 9's 6: section 12 stated only half of the limit | Section 12 says that held-back passages still reach GPT and Claude through the test and the replies, and that a Claude refusal in the test holds nothing back; the table row names the reading's and the questions tool's worker |
| 4 | Without a word list, another form of a subject's name ("camels") didn't rule the subject out | Its other forms are read on every copy (3.2, 3.4; R16) |
| 5 | Answers outside the schema and passing failures shared one count, so their order decided | Counted apart, two more asks each; three passing failures stop the tool, holding nothing back (3.2; R44) |
| 6 | A skip is an in-schema way to decline, and isn't held back | Said in 3.2 and section 12 |
| 7 | Held-back passages are permanent and count against the floor | Said in section 12 |
| 8 | The guard's edges: the default folder is known by its path; the folder check is the command's, not the shared job's | A folder holding the icon's `launcher.json` is refused too, wherever it is (3; R18). The page's job (pull request 4) runs under the consent in version 2's words, not the set-apart folder |
| 9 | Stale text: "six pull requests", the tests under i83's other options, the sentinel missing from sections 8 and 10 | Section 10 names the graph's build and the reviews; R23, R25 and R39 test 1a; sections 8 and 10 name the sentinel and the runner's own folder |

**Review 11** (28 Nov 2026, Codex, read-only and offline, of pull request 1's final commit `da73b6757`, before its merge; the owner
had answered i85 `1b`): review 10's fixes checked; one P1, six P2s and one P3; "VERDICT: not ready". What changed after it:

| # | Finding | What changed after it |
|---|---|---|
| 1 | P1: the sentinel counted anywhere in a passage, so a journal quoting its sentence inside other words would pass in a set-apart folder | First each passage's own lines were read, the sentence alone on its line; review 12 found that the import's cut can still make such a line, so the rule is now one of place: the copy's first passage, of all its passages, is exactly the sentence, byte for byte since review 13 (3; R18) |
| 2 | P2: a test said the sentinel's passage "went to none" and checked only GPT's calls | It says GPT's question calls: the cold test reads an invented copy as any copy, and its sentinel passage holds nothing of anyone's |
| 3 | P2: a run read the held-back list once, so another run's hold-back, made meanwhile, didn't stop its later packets | Read again under the lock right before each packet leaves; a passage held back meanwhile stops the run before that packet; after review 12, in the same hold of the lock as the consent's check, one hold a packet, with the instant that remains stated (3.2, 12; R19) |
| 4 | P2: held back by the digest of its exact words, a passage cut otherwise in a later copy can go again, though 3.2 said "another form" | 3.2 says another batch or kind of call, and section 12 states the limit, with why shorter runs of words aren't digested |
| 5 | P2: a question or planted answer could carry another passage of its batch to the key check, which gets its evidence passage alone | Dropped when it carries six words in a row of another passage of its batch that none of its own evidence holds (3.4; R15); after review 12, a question with any of its evidence passages held back is dropped before its check too, and a check's packet is guarded against every one of them (3.4; R15, R19) |
| 6 | P2: a phrase could hold a second question after a full stop | First sentence punctuation in any script was refused; review 12 found that a dash still can start one, so a phrase is now words alone, on an allowlist of characters, and the limit of a check of characters rather than meaning is stated (3.2, 12; R15) |
| 7 | P2: a passage could be the evidence of two questions even with sixty passages or more | One while there are enough for the sixty places, two when not (3.1) |
| 8 | P3: the context was drawn before the held-back passages were left out, so it could fall short | Drawn from the passages not held back (3.1) |

**Review 12** (28 Nov 2026, Codex, read-only and offline, of the commit that answered review 11, `b476002e0`): review 11's 2, 4, 7 and
8 fixed, and 1, 3, 5 and 6 partly; one P1, three P2s and one P3; "VERDICT: not ready". What changed after it:

| # | Finding | What changed after it |
|---|---|---|
| 1 | P1: the import cuts a paragraph over 1,600 bytes and trims the pieces, so a sentence inside other words could still become a passage's own line, and a real journal pass in a set-apart folder | A rule of place instead of finding the sentence in text: the copy's first passage in source order, of all its passages whatever their lifecycle, is the sentence (compared after normalization here; byte for byte since review 13), and none when a passage has no place or two share the first (`openingPassageId`); the sentence is now 169 bytes; `holdsInventedJournalSentinel` is gone (3, 12; R18) |
| 3 | P2: the consent's check and the held-back list took the lock in two holds, and a withdrawal or a hold-back could land between them or after the second | One hold a packet: the job gives the writer its check unlocked (`check`), and the writer runs it and reads the list in one hold of the lock; the instant between the release of the lock and the hand-over to the worker is stated, with why the lock isn't held through a call (3.2, 3.7, 12; R19) |
| 4 | Section 12 said that only a changed journal or added text cuts passages differently, too strong | The same text is cut the same way under the same settings; a change to how the import cuts can make new passages too (12) |
| 5 | P2: a question may carry another of its evidence passages whole, which the guard before a key check didn't cover | A question with any of its evidence passages held back is dropped before its check, and a check's packet is guarded against every evidence passage of its questions, those not counted as sent (3.4; R15, R19) |
| 6 | P2: a dash could still start a second question ("after the abacus — did I lend it") | An allowlist: a phrase is letters, combining marks and digits, an apostrophe or a hyphen inside a word, single spaces, and nothing else; the worker's instruction says so; the limit, a check of characters and words and not of meaning, is stated (3.2, 12; R15) |
| 9 | P3: the rollback of an ask again was untested, and the test of the list read again used a lock that numbered nothing | A test of the rollback on an ask again (calls made and asked again back to the first ask's, its passages still counted as sent), and a lock that numbers its holds, through the job (R19) |

Three kinds of finding came back after review 11's fixes, each in a narrower form: the sentinel found in the text, the checks before a
packet leaves, and a phrase's punctuation. A local fix of each would have met the next narrower form, so the mechanism changed instead:
a rule of the opening passage's place instead of finding the sentence in the text; one hold of the lock for every check before a
packet, with the instant that remains stated, instead of more reads; and an allowlist of what a phrase may hold instead of more
banned marks.

**Review 13** (28 Nov 2026, Codex, read-only and offline, of `7e386f8d4`): review 12's P2s, its P3 and its finding 4 fixed, and its P1
partly; one P1 and three P3s; "VERDICT: not ready". What changed after it:

| # | Finding | What changed after it |
|---|---|---|
| 1 | P1: the claim that a journal passes only when it opens with the sentence as a paragraph of its own was false: a run of spaces after the sentence on its line, a blank line inside it, or a date line right under it give that first passage too | The first passage is compared with the sentence byte for byte, with no normalization, so the blank line inside it is refused; every claim now says only what is checked, that GPT's questions run only on a copy whose first passage is exactly the code's sentence; section 12 says that the check is of the copy's first passage, not of the file, and that the files that give it all open with the code's sentence, as the tests show (3, 8, 12; R18) |
| 6 | P3: "one space" and "digits" didn't match the code, which reads white space as single spaces before the check and took any Unicode number ("½") | Decimal digits only; the design says that white space is read as single spaces, and the question put together from the phrase so read (3.2; R15) |
| 3, 5 | P3: the stop words and the command's comment said more than the guard and the receipt step do | The stop words name a passage of the packet or one holding the evidence quote of one of its questions; the comment and 3.2 and section 12 say that a hold-back is read only before the questions tool's packets, the test's packets and the receipt step reading the consent and the copy, not the list |
| 5 | P3: no test failed if passages guarded only were counted as sent | A run with an evidence passage that is a key passage only, in no packet: the passages counted as sent are those its packets held (R19) |

The sentinel came back three times because each fix checked something the import makes (a passage's lines, then its first passage
read after normalization) and then claimed something about the file it came from. The import trims each piece, joins a short piece to
the next, cuts a paragraph over 1,600 bytes after a sentence or a line end or, failing one, at its last space, and starts a passage at
each date line, and the earlier comparison read white space as one: so different files gave the same passage, or one that compared as
the same, and each claim about the file's shape met a file it didn't describe. After review 13 the check is exact
(byte for byte) and the claims say only what it checks: the copy's first passage, whatever file gave it.

**Review 14** (28 Nov 2026, Codex, read-only and offline, of `4fe71b160`): review 13's P1, its P3 on a phrase's characters and its P3 on
the count of passages guarded only fixed, and its P3 on the stop words partly; three P3s; "VERDICT: not ready". What changed after it:

| # | Finding | What changed after it |
|---|---|---|
| 1 | P3: the refusal said the first passage "isn't exactly" the sentinel, false for an exact one a reply may not quote; and that "the copy has no cold-test receipt now", false when a newer test has given its own | The refusal names a passage a reply may quote whose words are exactly the sentinel, and says that this test gave no receipt and that the one the copy had before it started is gone; a test of the sentence in a revoked first passage, refused; the command's test reads the refusal's whole words (3, 12; R18) |
| 3, 5 | P3: "honoured at the tool's next packet" said more than a read of the held-back list does | The command's comment, 3.2 and section 12 say what it does: a later packet that holds or guards the passage stops the run, and the packets the tool prepares after the read leave it out |
| 13 | P3: the appendix said that the import reads white space as one and cuts at a paragraph's last space | The earlier comparison read white space as one; the import cuts after a sentence or a line end, and at the last space only failing one |

All three were statements saying more than the code does. So before this round's commit every claim this pull request added (in the
design, the guide, the code's comments, the command's words and the state file) was read against the code, and five more were brought
to what it checks: the sentinel's passage must be one a reply may quote; one hold of the lock keeps any other action under the lock
from coming between the two reads, not every change; a phrase's words are what spaces separate, each part read for question and
joining words; words joined by hyphens can still read as a second question; and a question is dropped for a held-back evidence passage
as the run knows them before its check, one held back meanwhile stopping the run at the check's guard.
