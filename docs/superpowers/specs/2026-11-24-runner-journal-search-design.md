# Runner trial: the replies' journal search

Built 24 Nov 2026 on `claude/runner-journal-search-20261124`, from pull request 244 (merged the same day as `4216e56cc`). It changes how a client's
journal is searched for a reply, and when. Nothing here copies a journal or opens one that wasn't open before: the gate of the
[design for clients](2026-11-23-runner-client-cases-design.md) (consent, a published copy, a passing cold test) decides that as it did.

## Why

The replies' reader searched for passages holding **every** word of the message, so an ordinary message found nothing: on the seven
sentences of the synthetic journal, "help" found three passages, and "I find it hard to ask for help" none. Every test used one to three
words the journal holds. The evidence expansion's search (the checker's missing-history questions, joined) had the same fault. And the
search, up to four seconds, ran before anyone had read the message, so a provisional crisis reply waited for it, against the evidence
spec's "Current-message urgent support must not wait for optional journal retrieval", and quotations of old entries could come with a
message about wanting to die.

## 1. The search made for evidence

`findEvidenceQuotes({ query, limit })` in `src/journal-import/retrieval.mjs`, beside `findQuotes`, which the connector serves and which
stays as it is. A person's message is whole sentences, not chosen search words, so this search goes by how many quotes hold each word:

- **Words.** The message's distinct words, of the whole message (the app takes one of up to 40,000 characters), read as the generation's
  word list reads them (accents and English and French word forms, on a version 3 or 4 quote index; exactly elsewhere), without the English
  and French stop words (below). A word no quote holds is dropped. A word held by more than 5% of the quotes, and more than 20 of them, isn't
  ranked by; every other word is (cut to the rarest, a long message's subject, which many quotes hold, would lose to incidental words that
  few do). With none left there is no result: never a search by the words left out.
- **Order.** Okapi BM25 over those words, with the constants of the version 3 ranking, then the id. No quote goes first for holding more
  of the words: in a long message many weak words would beat the one that matters. Where the word index says only which records hold a
  word, a quote counts as one use at mean length, so BM25 goes by how rare the words are.
- **Kept.** A quote that holds a rare word (at most 1% of the quotes, or at most 10), or at least two and at least half of the words ranked
  by, three being enough however many there are.
- **Usable.** Of the kept quotes, in order, the first `limit` that may be used, among at most 40 looked at. Each is checked on its own
  record: a passage, active, a candidate or superseded, not restricted, its exact words the bytes stored for it. One that may not be used
  is counted with its reason and never fails the search. A record of another case still refuses it all.
- **Returned.** Each quote's record, words, span, lifecycle, when the quote index says it was written (never the date line's words), its
  wording cues and the words it matched; the words chosen and left out, with counts; how many quotes were kept, looked at and returned.

**Stop words** are left out as the message writes them (French also without its accents), never by how the word list reads them: it reads
"shoulder" as *should*, "care" as the French *car*, "toy" as *toi* and "mois" as *moi*. A word it reads like a stop word's is looked up as
written, with its plural or singular, since its quotes in the word list are mostly the stop word's. They are the quote search's English and
French ones, with the English negations, what is typed without its apostrophe where that isn't another word ("im", "dont", "jai", not "ill"
or "shed"), and what a French apostrophe leaves behind ("aujourd", "hui"), and without "été", which is also summer. An English negation
written as one word ("couldn't") is left out whole. A stop word of one language that is an ordinary word of the other
(`ALSO_ENGLISH`: "son", "car", "aura", "pendant" and others; `ALSO_FRENCH`: "but", "an", "or", "ours") is left out only in a message clearly
written in its own language (at least two other words of its list, and more than of the other list): "my son" is searched, the "son" of "il a
pris son vélo et le mien" isn't.

The numbers are in `EVIDENCE_QUOTE_SEARCH`, with why and a version. They are reasoned, not measured: the 3,207 test questions about one
real journal are on the server, so they can't be tuned on them from here. The result cache holds counts by a word's place and the kept
quotes' ids, never a word; its key holds the case, the corpus, the purpose, the publication, a digest of the words and the version.

## 2. The reader

`createSessionUseJournalEvidenceProvider` (`src/journal-import/response-evidence-journal.mjs`) uses it, and keeps its other rules: the
purpose checked before anything, the publication checked before and after, 8,000 tokens and 64,000 bytes, whole quotations or an omission
with its reason, a receipt, no retry by another route.

- A message gets at most six quotations. A message with no letters or digits is `no_match`, like one of common words only.
- What the models are told when nothing comes back is why: no passage holds any of the words, every word is in too many passages to search
  by, so many passages share one, none specifically enough, or none of those found may be used. Why a passage may not be used (restricted,
  deleted, revoked) isn't told, only that some can't be, and one that was looked at counts neither as a match nor as more to be had.
- The repair's evidence expansion searches each missing-history question on its own (at most four; a further one, or one that can't be
  searched, is an omission), past the quotations the snapshot has, and takes the best of each in turn, without repeats. It **adds to** the turn's part: the quotations the draft may
  rest on keep their ids, the receipts that returned them, the coverage and what was left out; the snapshot holds at most twelve. Each kept
  quotation is checked again as a search checks one, and one that may no longer be used is left out, not the others; a new quotation never
  takes an id an earlier part or receipt gave. Before, an expansion replaced the turn's quotations and gave their ids to others. A retrieval
  that fails or is refused still gives none (the cause may be a withdrawn consent).
- The coverage says that the search went by the message's less common words, how many passages matched and how many quotations came
  back, that sharing words doesn't make one relevant, that wording cues are found for English wording only, and that this is no review
  of the whole journal.
- `time` stays unavailable: it carries one instant and sorts the sources, and a writing date is neither. A quotation's **`journal_note`**
  says when the entry was written (a range may be open at an end), its wording cues and its lifecycle. It is optional, strict
  (`responseEvidenceSourceItemSchema`), on journal quotations only, and passed on in the models' view beside the words. The reader gives
  it when it is constructed with `journalNotes`, as the trial's gate does: a record that holds a note can't be read by a build without
  the field (`main`'s, or an earlier build of the trial), and the trial's vault is opened by no other build. Stored snapshots without
  notes stay valid.
- `SESSION_USE_READER_VERSION` names what a message gets from a journal, so that a cold test's pass can be bound to it. It isn't yet.

## 3. The models' notes

When a turn's evidence holds a journal quotation, the writer's, the repair's and the checker's notes also say that a journal quotation was
found by shared words and may have nothing to do with the message; that it belongs in the reply only when it helps with what the person
says now, and is never a reason for crisis text and never raises or lowers the level; that `written` is when the entry says it was
written, never when something happened, and an interval or an inferred year is not a day; and that a dream, plan, wish or denial stays one.
A turn without a quotation, so every turn without a journal reader, gets the notes it always got.

## 4. No journal in a conversation about wanting to die

- **The readers first.** Before it freezes the evidence of a turn that has no candidate yet, the controller asks the runtime's
  optional hook `readBeforeEvidence`, only with a journal reader attached: the crisis, box and protection readers run and the provisional
  reply or the line goes out, and only then is anything searched. The readings are stored once, and `produceCandidate` and a turn that
  goes on after a restart use them: a reader whose reading is stored isn't called again, and first words a restart interrupted go out
  from the stored reading, once. What a reader's failure, the turn's time or a plan limit does is what it did. A case that has read its
  journal while its gate is closed is read by no one, and its turn closes as before.
- **No search, and no quotation.** The optional hook `journalWithheld` says why a turn gets no journal: the current message isn't read, or is
  read as anything but none (wanting to die, having acted or being about to, thoughts of death with no wish to act, or something that could
  mean either), or, with the number now on, as needing the emergency number now; or its conversation has been read as one about wanting to die
  by any reader or checker. **Every snapshot of a turn asks it as it is frozen** (`freezeSnapshot`), the message's own, the repair's expansion
  and a refresh alike: the part is then closed, `unavailable` and `not_attempted` with the reason `journal_withheld`, no search is made and
  nothing is carried over. The models read that reason, so it says nothing of the level: it also stands for a message read as thoughts of
  death, as unclear or not at all. **Every model call asks it of the snapshot it would go out with** (`prepareCall`), when that may hold the
  journal's words (`snapshotHoldsJournal`), whatever froze it and whatever was read since: a call that writes gets one frozen again without
  them (three snapshots a turn; with none left, the turn ends), and a check, which is bound to its draft's snapshot, isn't made and the turn
  ends. A decision that can't be made is a failed retrieval, and stops no check. A journal read earlier in the case still needs the open gate.
- **Earlier drafts.** A draft of an earlier turn that was written with a quotation in view, or any version of it, may hold the journal's
  words, so no snapshot has it as a source (`draft_written_with_the_journal`), unsent or only said to be sent by a report no one vouches for,
  whether its turn gets the journal or not, and the list of what was sent names no reference such a report gives: the journal's words are in a
  snapshot through its own retrieval, or not at all. A snapshot an earlier build froze with such a draft counts as one that holds a quotation.
- **When only the checker reads it.** A draft written with quotations in view, before anyone had read the conversation as one about wanting to
  die, isn't sent once this turn's checker does: the program adds `PROGRAM_JOURNAL_IN_CRISIS` (high), and the repair goes on with a snapshot
  frozen again without its quotations; where the turn ends instead, its fixed message or notice shows. The repair isn't shown the draft
  either, nor what was found of its words (it gets each finding's code, when it is a fixed one, its severity, and the program's own sentences),
  and neither is the check of the repaired reply: a reply written anew, from the conversation alone. The repair's stored result
  says so (`draftHidden`), so the reply doesn't count as one written from that draft. One that was written from such a draft, its own
  evidence holding no quotation (its expansion's search failed), counts as written with the journal in view.
- **Where each way is closed.** Journal words could reach a call or a reply of such a turn in these ways, each closed in one place (a new way
  is closed in its place, not by one more check): a search, for the message or a check's questions (`freezeSnapshot`); a snapshot frozen
  earlier that a call would go out with (`prepareCall`); earlier turns' drafts as sources (`buildResponseEvidenceSourceItems`); this turn's
  draft, what its check found and its evidence review (`ofDraft`, for the repair and its check alike); a declared quote's source
  (`evidenceQuoteSources`, the call's own evidence); the reply (`PROGRAM_JOURNAL_IN_CRISIS`, by `draftMayHoldJournal`); the conversation and
  the earlier ones (`conversationView`, what the person was sent or shown and nothing else); the readers and so the provisional reply
  (`readersPacket`, the conversation alone); the case's state (`stateAfterReadings`, the readings alone); the run log (`runnerLogFromRecord`,
  fixed codes and numbers).
- With response evidence off, or with no journal reader (a trial without clients), nothing is read first and every packet, prompt, order
  of calls and stored record is as it was.

## Limits

- A word that reads like a stop word's finds its exact form and its plural or singular, not its other forms ("sure" doesn't find "surely"),
  and "été" typed without its accent finds nothing. A word both languages have finds both ("son" also finds *son père* in a journal with
  French in it). A name that is a stop word ("Will") is left out, and so is a word like "down" where it's what the message is about.
- A message whose only word that isn't common is held by more than 1% of the quotes (and more than 10) returns nothing: which of them would be
  arbitrary. The models are told how many passages share it.
- In a very long message many everyday words can outrank a single rare one; several rare words, or a subject's words together, don't lose to
  them in the tests.
- In a journal of a few dozen quotes nearly every shared content word counts as rare, so most messages get six quotations.
- A one-word message finds what holds that word when few quotes do: "yes" finds the few quotes of a journal that say yes.
- Words are runs of letters and digits, as in the quote search: a language written without spaces between words finds nothing. The stop
  words are English and French; in any other language only the common-words rule leaves everyday words out, and words that are spelled alike
  in two languages find each other ("pain").
- A new conversation gets the journal again, also right after one about wanting to die, when its message is read as none.
- What the person has been sent stays what it is, a reply that quoted the journal included: in the conversation the models read, and among
  what was sent. The check that is the first to read someone who wants to die has the quotations in view, since nobody had read the message as
  one when it was searched for.
- A repair written anew has the rules, the conversation, what was found by its codes and the level the check read, not what the checker wrote
  of the draft.
- On an invented journal of 6,000 entries in the encrypted store a search takes about 0.4 s on the laptop, also for a message of 40,000
  characters; a real journal hasn't been timed.
- Whether a quotation helps is the models' judgment; the search can't make it.

## Tests

`tests/journal-evidence-search.test.mjs` (the search), `tests/response-evidence-journal.test.mjs` (the reader),
`tests/response-evidence-contract.test.mjs` (the note), `tests/response-evidence-runtime.test.mjs` (the controller's hooks) and
`tests/runner-client-journal.test.mjs` (the trial), on invented journals only (`tests/helpers/invented-journal.mjs`: a few hundred
paragraphs, English and French, from a seeded generator).
