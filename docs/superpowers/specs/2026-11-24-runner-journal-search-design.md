# Runner trial: the replies' journal search

Built 24 Nov 2026 on `claude/runner-journal-search-20261124`, from pull request 244's head `09f3de097`. It changes how a client's
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

- **Words.** The message's distinct words, read as the generation's word list reads them (accents and English and French word forms, on a
  version 3 or 4 quote index; exactly elsewhere), without the English and French stop words, read the same way. A word no quote holds is
  dropped. A word held by more than 5% of the quotes, and more than 20 of them, isn't ranked by. Of the rest, the 24 rarest; equally rare
  ones in the message's order. With none left there is no result: never a search by the words left out.
- **Order.** Okapi BM25 over those words, with the constants of the version 3 ranking, then the id. No quote goes first for holding more
  of the words: in a long message many weak words would beat the one that matters. Where the word index says only which records hold a
  word, a quote counts as one use at mean length, so BM25 goes by how rare the words are.
- **Kept.** A quote that holds a rare word (at most 1% of the quotes, or at most 10), or at least two and at least half of the chosen words.
- **Usable.** Of the kept quotes, in order, the first `limit` that may be used, among at most 40 looked at. Each is checked on its own
  record: a passage, active, a candidate or superseded, not restricted, its exact words the bytes stored for it. One that may not be used
  is counted with its reason and never fails the search. A record of another case still refuses it all.
- **Returned.** Each quote's record, words, span, lifecycle, when the quote index says it was written (never the date line's words), its
  wording cues and the words it matched; the words chosen and left out, with counts; how many quotes were kept, looked at and returned.

The numbers are in `EVIDENCE_QUOTE_SEARCH`, with why and a version. They are reasoned, not measured: the 3,207 test questions about one
real journal are on the server, so they can't be tuned on them from here. The result cache holds counts by a word's place and the kept
quotes' ids, never a word; its key holds the case, the corpus, the purpose, the publication, a digest of the words and the version.

## 2. The reader

`createSessionUseJournalEvidenceProvider` (`src/journal-import/response-evidence-journal.mjs`) uses it, and keeps its other rules: the
purpose checked before anything, the publication checked before and after, 8,000 tokens and 64,000 bytes, whole quotations or an omission
with its reason, a receipt, no retry by another route.

- A message gets at most six quotations. A message with no letters or digits is `no_match`, like one of common words only.
- The repair's evidence expansion searches each missing-history question on its own (at most four; a further one is an omission) and
  takes the best of each in turn, without repeats. It **adds to** the turn's part: the quotations the draft may rest on keep their ids,
  the receipts that returned them, the coverage and what was left out; the snapshot holds at most twelve. Before, an expansion replaced
  the turn's quotations and gave their ids to others.
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
written, never when something happened, and an interval or an inferred year is not a day; that a dream, plan, wish or denial stays one;
and what "superseded" means. A turn without a quotation, so every turn without a journal reader, gets the notes it always got.

## 4. No journal in a conversation about wanting to die

- **The readers first.** Before it freezes the evidence of a turn that has no candidate yet, the controller asks the runtime's
  optional hook `readBeforeEvidence`, only with a journal reader attached: the crisis, box and protection readers run and the provisional
  reply or the line goes out, and only then is anything searched. The readings are stored once, and `produceCandidate` and a turn that
  goes on after a restart use them: a reader whose reading is stored isn't called again, and first words a restart interrupted go out
  from the stored reading, once. What a reader's failure, the turn's time or a plan limit does is what it did. A case that has read its
  journal while its gate is closed is read by no one, and its turn closes as before.
- **No search.** The optional hook `journalWithheld` says why a turn gets no journal: the current message is read as wanting to die or as
  having acted or being about to, or isn't read, or its conversation has been read as one by any reader or checker. Every journal search
  of a turn, the message's own and the expansion's, is made in one place (`journalPart`), which asks it first: the part is then closed,
  `unavailable` and `not_attempted` with the reason `crisis_turn`, and no search is made. A decision that can't be made is a failed
  retrieval. A journal read earlier in the case still needs the open gate.
- With response evidence off, or with no journal reader (a trial without clients), nothing is read first and every packet, prompt, order
  of calls and stored record is as it was.

## Limits

- **The stop words take out words that matter.** Read as the word list reads words, the two lists also take out every word that reads
  like one of theirs: in English "care", "caring", "son", "car", "coming", "sure", "toy" and "queer" (the French *car*, *son*, *comme*,
  *sur*, *toi*, *que*), and "shoulder", "overeating", "bother" and "offer" (the English *should*, *over*, *both*, *off*, as in the version
  3 ranking); in French "mois" (*moi*). A message whose point is one of them alone doesn't find it. On an exact word index only the
  words of the lists themselves are lost, "son", "car", "pour" and "plus" among them.
- A message over 4,000 characters is still searched by its first 4,000 (`JOURNAL_QUERY_CHARACTERS` in the controller), whatever its point.
- A one-word message finds what holds that word when few quotes do: "yes" finds the few quotes of a journal that say yes.
- Words are runs of letters and digits, as in the quote search: a language written without spaces between words finds nothing. The stop
  words are English and French; in any other language only the common-words rule leaves everyday words out.
- The repair of a turn whose checker alone read someone who wants to die still has the quotations its draft was written with, unless it
  asked for more history; the next turns have none.
- Whether a quotation helps is the models' judgment; the search can't make it.

## Tests

`tests/journal-evidence-search.test.mjs` (the search), `tests/response-evidence-journal.test.mjs` (the reader),
`tests/response-evidence-contract.test.mjs` (the note), `tests/response-evidence-runtime.test.mjs` (the controller's hooks) and
`tests/runner-client-journal.test.mjs` (the trial), on invented journals only (`tests/helpers/invented-journal.mjs`: a few hundred
paragraphs, English and French, from a seeded generator).
