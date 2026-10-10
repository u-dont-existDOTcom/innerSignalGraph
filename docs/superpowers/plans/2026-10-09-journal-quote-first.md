# Journal quote-first: answer from the person's own words

Status: owner-requested on 9 Oct 2026, 22:32 UTC: "i'd rather have it now so we can actually test it now ... make sure
first this is actually scalable because you said it would take more time to search. if it takes like a few minutes to
do each reply that's not good". Part 1 is built here. Parts 2 and 3 follow once part 1 has been tried. Deploying the
change and publishing the quote corpus wait for the owner's explicit `deploy`.

## Why

The semantic import rewrites the journal into statements a model writes, then asks model judges whether each
statement is faithful to the source. Three things follow from that design:

- **It is slow.** Each unit passes through extraction, an omission check, a fidelity audit, repairs and sometimes the
  hardest tier. The calibration round has been completing roughly one to three units an hour. The journal has
  1,188 units.
- **It is fragile.** A paraphrase can drop a "maybe", turn a dream into an event, or move a remark to the wrong person.
  Catching that takes judges, and the judges disagree with each other and with themselves. The critical-miss gate in
  plan `2026-10-08-journal-calibration-critical-miss-limit.md` exists because of that.
- **The checks protect a copy, not the source.** The person's words are archived whole either way. Everything the
  judges check is a restatement whose errors the original never had.

Quote-first keeps the person's words as the record. The import only indexes them: it records where each paragraph is,
which words it holds and which date line it was written under. When InnerSignal needs the journal, it reads the exact
quotes and interprets them then, with the source in view. A paraphrase that never gets written can't be distorted, so
the fidelity checks have nothing left to guard.

## The design

1. **A quote index, mechanical (built here).**
   - Each page is split into exact, paragraph-sized quotes. A long paragraph is cut after a sentence. A short line
     that opens with a date is a quote of its own.
   - Every quote records the date line it was written under: the nearest line above it that opens with a date,
     carried across pages in source order. A page whose text wasn't fully read (one waiting for visual reading, say)
     may hide a newer date line, so no date is carried into or past it: those quotes stay undated until a date line
     that can be read.
   - The words index finds quotes by their words. Rare words count more. A time window keeps the quotes written in
     it.
   - No model reads or writes any of it, so the index can't paraphrase.
2. **Mechanical checks for the critical kinds (built here, at read time).** Every quote is shown with the wording
   found in it that changes what it says happened:
   - dream;
   - wish;
   - plan;
   - hypothetical;
   - negation;
   - hedge;
   - reported speech.

   These cues travel with the quote and never replace it. The tool's description tells the answering model how to use
   them: quote the exact words, keep the person's qualifiers, never treat a dream, wish, plan or hypothetical as an
   event, say who said reported speech, and give the date a quote was written.
3. **Model-written pointers, not records (next).** An index pass tags quotes with the people, places, topics and events
   they mention. Each tag is anchored to exact words in its quote, and a mechanical check drops any tag whose anchor
   isn't there. Tags only help find quotes: the answer still reads the quote, never the tag. A wrong tag costs a missed
   quote, not a distortion. The extraction the current import has already done can seed these tags.
4. **Measured judges and a random sample (next, for the pointer pass).**
   - The pass is checked on retrieval recall: for sampled questions, does search find the quotes a careful reader
     would cite?
   - The sample is drawn at random from a recorded seed and checked in random order, with hazard pages reported
     separately.
   - It stops as soon as a confidence bound settles pass or fail.
   - Before any gate rests on a model judge, two independent judges score the same items and their agreement is
     recorded. A gate uses a judge only at a measured agreement, and otherwise uses both judges or a person.

## Reply time

Measured with `scripts/journal-quote-benchmark.mjs`, which runs the code in this change on a synthetic journal. It uses
the import's storage, encryption and reader, and opens a fresh reader for every call, as the connector does. The
machine had 2 CPUs. Each call returned up to 12 quotes, about 11 KB or 2,700 tokens. A third of the queries had a
one-year time window. The ten-times run shared the machine with a full test suite, so its slow end is pessimistic.
At that size the slowest calls are those with very common words; leaving such words out of the ranking would cap
them, if a journal ever grows that large.

| Journal | Text | Quotes | Median call | 95th percentile | Slowest | Objects decrypted |
| --- | --- | --- | --- | --- | --- | --- |
| Synthetic, the owner's journal's size (1,122 pages) | 10.6 MB | 17,478 | 81 ms | 135 ms | 136 ms | 32 (median) |
| Synthetic, ten times larger (11,220 pages) | 106 MB | 174,982 | 254 ms | 1.6 s | 2.0 s | 46 (median) |

- **The real journal, on the server.** The import's own `verify` run recorded, without content, that resolving all 1,117
  native passages exactly, plus three searches, took 1.24 seconds in total.
- **Reading the quotes (an estimate, not measured).** 2,700 tokens is about four pages of text. Models read input
  at thousands of tokens a second, so this adds about a second to a reply.
- **Tool call overhead (an estimate).** Each tool call costs the chat a round trip of a second or two.
- **Altogether.** One quote search adds a few seconds to a reply, not minutes.
- **The import side.** No model calls at all. Building the index took about 20 seconds at the real journal's size and
  under five minutes at ten times it.

The first version decrypted 1 MB index pieces and every quote's record, and took 691 ms per call at the real size.
Three changes brought it down to the figures above:

- **128 KB pieces**, so a search decrypts less of what it doesn't need;
- **a `quote_meta` index** holding each quote's span, page and date line, so no record is read;
- **a `quote_months` index and a `representation_objects` index**, so a time window doesn't read every match and a
  page opens without the directory of all pages.

## What this change builds

- **`src/journal-import/quote-index.mjs`:**
  - `splitQuoteUnits` and `dateLineValue` (part 1);
  - `quoteCues` (part 2);
  - `buildQuoteGeneration`, which makes the graph plus the `quote_meta` and `quote_months` indexes.
- **`persistGraphGeneration`:**
  - stores a builder's extra indexes;
  - optionally indexes where each representation is stored (`representation_objects`);
  - writes representations before indexes, so that index can name them.
- **`findQuotes` on the journal reader.** It works on any generation. Without the quote indexes, a whole partition
  unit is the quote and there are no dates. Later pages come from a signed cursor bound, like search's, to the snapshot,
  the query and the filters. The cursor holds the position in the ranking where the next page starts, so paging never
  skips or repeats a quote, even if a new generation is published between pages. One call looks through at most 5,000
  matches; one that stops there returns a cursor past them. A quote is read from only the part of the source it sits
  in: a page decoded once per call, or, for a long text journal stored in 4 MB chunks, just the chunks its span
  touches.
- **The connector tool `find_journal_quotes`.** It's read-only like the other journal tools, and its description carries
  the answering rules above.
- **Two import commands: `build-quotes` and `publish-quotes`.**
  - `build-quotes` stages the quote generation in the execution root.
  - `publish-quotes` builds it if needed, then publishes it to the case as its own corpus, `<corpus>:quotes`, with
    generation `<generation>:quotes:quote-index-v1`.
  - The quote corpus carries a copy of the archived original, which its locators name, so it's complete on its own.
  - The import's own corpus, generation and calibration are untouched, so its later commit can't conflict with this
    publication.

## Limits of part 1

- **Native text only.** Pages that need visual reading have quotes only for their native text. Their verified
  transcriptions join in part 3.
- **Exact words only.** There's no stemming and no synonyms. The tool asks the answering model to search with the
  variants the person might have written.
- **Date lines are read only where a line opens with a date.**
  - An all-numeric date that reads both ways is taken month-first and marked `ambiguous`.
  - A line that opens with an older date in the middle of an entry dates the paragraphs below it. The date line is
    shown with every quote, so the answering model sees it.
- **No search by meaning yet.** Ranking is by rare words. Part 3's tags cover people and topics.
- **No unpublish command.** A visibility change hides every snapshot of the corpus from readers.

## Operating it (after the owner's `deploy`)

The order matters. A case with a published journal corpus isn't continuation-safe for a connector that can't read
journal corpora, so the connector goes first.

1. Deploy the commit to the import server, and restart the import worker on it as before.
2. Rebuild and restart the hosted connector from this commit, with the journal read tools switched on for the owner's
   case. That means the journal purposes `organize_search` and `session_use` on the case's grant. Then check that
   `tools/list` advertises `find_journal_quotes`.
3. Stop the import worker. Run `journal-import publish-quotes` once, with the usual config and env files. Start the
   worker again. Like `resume-calibration`, the command holds the execution root's lock.
4. In a new InnerSignal conversation, ask about the journal.

## Tests

`tests/journal-quote-index.test.mjs`:

- Date lines are read only at the start of a line:
  - weekday, ordinal, day-first, ISO, numeric and month-only forms;
  - impossible dates and mid-sentence dates refused.
- Quote units are exact, trimmed and bounded, and cover every non-space byte once. A date line starts a new unit. Long
  paragraphs are cut after sentences, and multibyte text stays exact.
- Wording cues are found, curly apostrophes included.
- The quote generation validates. Its dates carry across pages, and its months index lists every quote.
- `findQuotes`:
  - ranks rarer words first;
  - finds a quote holding either word;
  - pages through the whole ranking with its cursor, each quote once;
  - refuses a cursor from another query, other filters or another snapshot;
  - keeps one quote under a small budget, and starts the next page with the quote that didn't fit;
  - still searches a query made only of common words;
  - returns exact text;
  - reads part of the index, not all of it.
- Time windows keep dated quotes inside them, and undated ones only when asked.
- No date is carried into or past a page whose text wasn't fully read.
- A long text journal stored in chunks is quoted from only the chunks a span touches, including a paragraph that
  crosses a chunk boundary, and is never reassembled whole.
- `findQuotes` works on a generation without the quote indexes.
- `build-quotes`:
  - refuses before staging;
  - stages without publishing;
  - keeps only the quote manifest's reference in the run state, which is rewritten on every save.
- `publish-quotes`:
  - publishes a corpus that holds the archived original;
  - publishes only the quote corpus;
  - leaves the import's run unchanged;
  - is a no-op the second time.

  The published corpus answers through the API and through the MCP tool.

`tests/journal-continuity.test.mjs`: the journal tools list includes `find_journal_quotes`.

Each new test fails without the source change.
