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
   isn't there. Tags only help find quotes: the answer still reads the quote, never the tag. A missing tag costs a
   missed quote; a wrong one can bring up an off-topic quote, which is marked as found by a tag and checked against
   its own words before it's used. Neither changes what a quote says. Tags are made from the journal's text alone,
   never seeded from the current import's extraction, which its reviews against answer keys shaped (Part 3).
4. **Measured judges and a random sample (next, for the pointer pass).**
   - The pass is checked on retrieval recall: for sampled questions, does search find the quotes a careful reader
     would cite?
   - The sample is drawn at random from a recorded seed and checked in random order, with hazard pages reported
     separately.
   - It stops as soon as a confidence bound settles pass or fail. (Part 3 fixes the sample's size in advance
     instead, so its bound is computed once.)
   - Before any gate rests on a model judge, two independent judges score the same items and their agreement is
     recorded. A gate uses a judge only at a measured agreement, and otherwise uses both judges or a person. (Part 3
     has both judges score every sampled item.)

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
  - Version 2, below, reads the owner's journal's own dates.
- **No search by meaning yet.** Ranking is by rare words. Part 3's tags cover people and topics.
- **No unpublish command.** A visibility change hides every snapshot of the corpus from readers.

## Version 2: the journal's own dates (10 Oct 2026)

Owner's answer to question 17 on the owner page, 10 Oct, 01:49 UTC: "the dates are in euro format since he's french /
day first". Built here; it goes live with the owner's `deploy`.

**What went wrong in version 1.** It read only English month and weekday names, read all-numeric dates month-first,
and dated every quote by the nearest date line above it, however far back that was. In the owner's journal only one
line opened with a date it could read, an ambiguous one. So 1,349 of the 1,804 quotes were undated, and 455 carried
that one date, most of them probably wrongly.

**What version 2 reads at the start of a line:**

- French month and weekday names, with "le" and "1er", alongside the English ones: "mardi 3 mars 2020", "le 1er août
  2019", "5 févr. 2020".
- Marks before a date: heading marks, bullets, dashes, an opening bracket, a "Date:" label.
- Year-first dates: "2021/10/03", "2021.10.03", "2021-10-03T21:40".
- All-numeric dates in the journal's order. The run setting `quote_numeric_date_order` is `month_first` by default,
  and `day_first` for this journal. A date both orders could read stays marked `ambiguous`. One that only one order
  can read (25/12) is read that way whatever the setting.
- Dates written without a year: "mardi 3 mars", "3 mars :", "3/10", "3.10.". Such a date takes the year of the latest
  date read, or the next year when it would fall more than 31 days before that date, as January follows late
  December. It's marked `year_inferred`. Before any year is read, after a page that wasn't fully read (it may hide a
  new year), or on a day that year doesn't have, it gives no date.
- A year alone on a line. It dates the quotes under it to that year (precision `year`) and gives later dates their
  year.
- A weekday alone on a line, written in full: "Dimanche", "Sunday evening:". It starts an entry whose date isn't
  given.

Lines are compared in composed Unicode form, so an accent stored as a separate mark still reads.

**How far a date reaches.** Every line that starts an entry ends the date before it, and one that gives no date
leaves its entry undated. A date covers the quotes after its line on its own page and the next two pages
(`carryPages`), or, where pages aren't numbered, the next 24 quotes (`carryQuotes`). Past that, quotes are undated:
an entry whose date line went unread mustn't lend its date to the entries after it, and a wrong date is worse than
none. As before, no date is carried into or past a page whose text wasn't fully read.

**What a build reports, without content.** Under `quote_index` in the output of `build-quotes` and `publish-quotes`:

- `date_lines` and `ambiguous_date_lines`;
- `date_line_kinds`: full dates, years inferred, years alone, dates without a year that got none, weekdays alone;
- `carry_capped_quotes`: the quotes the carry limit left undated;
- `unread_date_like`: how many lines open with a month or weekday name without being read as a date, and the six
  commonest shapes of a number opening a line, with digits written as 9 ("99/99"). These show how the journal writes
  its dates without anyone reading it;
- `numeric_date_order`.

**Answers.** `find_journal_quotes` returns `year_inferred: true` in `written` when the year came from the entries
before. Its description says such a year is probable, not certain; that a date is only as precise as its
`precision`; to check the date line of an `ambiguous` date; and that a null `written` means the date is unknown.

**Publishing version 2 over version 1.** A generation is now named for the version and the numeric order:
`<generation>:quotes:quote-index-v2-day-first`. A new version or a changed setting therefore builds a new generation.
The run state keeps the generation this runtime last published (`quote_published`), apart from the latest build. A
build of any other generation records that one as `supersedes`, and `publish-quotes` passes it on; rebuilding the
published generation itself, after a setting was changed and changed back, replaces nothing. Publication then replaces
the active generation only when it is exactly the one named, and otherwise refuses with
`JOURNAL_PUBLICATION_GENERATION_CONFLICT`, so a generation someone else published in the meantime is never
overwritten. The replaced generation stays among the corpus's previous generations. A reply already paging it with a
cursor finishes on it, and a new search reads the new one.

**Operating version 2** (after the owner's `deploy`):

1. Set `"quote_numeric_date_order": "day_first"` in the private run config, keeping a backup.
2. Deploy the commit to the import server. `doctor` checks the setting.
3. Rebuild the hosted connector, since the search results and the tool's description change.
4. Stop the import worker, run `publish-quotes`, and start the worker again.
5. Read the new `quote_index` counts. If `unread_date_like` still shows many lines led by a month or weekday name, or
   a common number shape, the journal writes its dates in a form this version doesn't read yet, and the next version
   reads it.

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

Version 2, `tests/journal-quote-index.test.mjs`:

- French, year-first and marked date lines are read, in the journal's numeric order; sentences and things that only
  look like dates are refused, in either order.
- A date without a year takes the year before it, and the next one after December. A year alone dates what follows
  and gives later dates their year. Before any year, or on a day the year doesn't have, such a date dates nothing.
- Every line that starts an entry ends the date before it.
- A date reaches its own page and the next two, or 24 quotes without page numbers; an unread page still stops it.
- The counts describe the dates without any of the text.
- The numeric order is a run setting, and invalid values are refused.
- A year alone and an inferred year are found by time windows and say how precise they are.
- End to end: a changed setting builds a generation that records the one it replaces; publication refuses a
  different one; the new one replaces exactly the old, which stays among the previous generations; a reply paging
  the old one finishes on it; an invalid setting stops the run from opening.

`tests/journal-publication.test.mjs`: a new generation replaces only the active generation it names; a missing,
wrong or self-naming `supersedes` is refused; publishing again changes nothing.

`tests/journal-contracts.test.mjs`: `doctor` reports an invalid numeric date order.

`tests/journal-continuity.test.mjs`: the journal tools list includes `find_journal_quotes`.

Each new test fails without the source change.

## Part 3: the pointer pass, built to finish in hours (plan, 11 Oct 2026)

Owner request, 11 Oct 2026, 01:03 UTC: "i do want to make this journal import just happen in a few hours for the
public, not weeks. but i also don't want so many gaps and errors and failures..."

Outcome: a journal the size of the owner's is searchable by its words and by the people, places, topics and events
it mentions within a few hours of upload. Its errors are measured, and none of them can change what the journal says.

This part builds steps 3 and 4 of the design above. Nothing in it is built yet.

### Why the semantic import can't get there

Measured from the Codex worker's content-free log, 1 to 11 Oct:

- **It mostly waits.** Each day the Codex lane was busy between 0% and 10% of its three slots. Its best day answered
  503 jobs in 7 model-hours out of 72. The rest of the time the import waited: on one step at a time per unit, on the
  hardest lane's daily limit and on usage limits, and on stops that needed the owner.
- **Each unit costs many large answers.** Since round 5 began on 4 Oct, about 1,400 answers (each reading about
  99,000 input tokens) finished 116 units: about 12 per unit, counting the calibration's own reference reading.
- **Even without waiting it takes about a day.** The full run's roughly 1,100 units at about 11 answers each, the
  calibration's rate without its reference reading, is about 160 model-hours at 0.8 minutes an answer: 20 hours on
  all eight slots of one worker.
- **And its checks don't converge.** Its review loops are what stopped calibration and sent it back (plans
  `2026-10-03-journal-review-convergence.md` and `2026-10-08-journal-calibration-critical-miss-limit.md`).

### What the pass does

- **Input.** The quote generation's quotes in source order, cut into batches of consecutive pages of at most about
  6 KB of quote text. A page is never split across batches unless the page alone is over the limit. The tagger sees
  only the journal's text: no extraction, reference or review from the semantic import goes into a tag, so nothing
  that has seen an answer key shapes what is measured.
- **One answer per batch.** A new role, `pointer_tagger`, with the schema `schemas/journal-import/pointer-result.schema.json`.
  It lists the people, places, organizations, topics and events the quotes mention. Each tag has:
  - a kind from that fixed list;
  - a short label in the journal's own language;
  - one or more anchors: exact text from a named quote unit, as extraction anchors are now.
- **No statements.** The pass writes no assertions, so it can't restate what happened. An event tag's label names the
  event; the quote says what happened.
- **No coreference.** A tag never claims that "he", "she", "there" or a different name means a named person, place or
  organization. A pronoun-only mention isn't tagged, and this part has no aliases: telling that two names mean the
  same person is a later part with its own measurement. So every quote a name tag points at contains that name.
- **Topic and event labels are a model's words.** A wrong one can't change a quote, but it can bring up a quote that
  isn't about what was searched for. Search therefore says when a quote matched only through a tag and ranks such
  quotes after the ones that match by their own words, and the precision floor below covers these labels.
- **Code checks every tag.**
  - Each anchor must resolve exactly in the unit it names, which must be one of its batch's quotes
    (`resolveUnitQuote`, the check extraction anchors pass).
  - Every anchor of a person, place or organization tag must itself contain the tag's label, ignoring case and
    accents. An anchor that doesn't is dropped, so no quote is filed under a name it doesn't use, and a name can't be
    invented.
  - Event and topic labels are written in lower case except for names. Every capitalized word in a label, the first
    one included, must appear in each of the label's anchors, ignoring case and accents; an anchor that lacks one is
    dropped. So a label can't name someone its quotes don't. Who an event involves comes from the name tags on the
    same quotes, never from its label.
  - Labels have length limits; duplicate tags in a batch merge. Across batches, tags of the same kind and label stay
    separate, since two people can share a name, and search by label finds all of them.
  - A tag left with no anchor is dropped. Every drop is counted. No model call repairs a tag.
- **Failures stay small and visible.** A batch whose answer doesn't fit the schema gets one retry. A batch that fails
  twice stays untagged and is listed by page, without content, as is any page that ends with no kept tag. Word search
  still finds their quotes.

### Into the graph and the tools

- **A pointer-only extraction.** Tags go through `adaptExtractionToGraph` in place of today's empty extraction:
  entities for people, places and organizations, with that `entity_kind`; episodes for events; no assertions. A tag's
  evidence in the graph is the whole quote each anchor is in, the quote's existing passage, so no new passage is made
  and a search still returns each quote once; the exact anchors stay in the tag index. The quote generation then
  carries entity and episode nodes linked to the quotes that mention them.
- **Topics stay out of the graph.** The extraction schema has no topic kind, and a topic is neither someone nor
  something that happened, so topic tags live only in the tag index.
- **A tag index.** Two new indexes in the quote generation, stored like `quote_meta`: `quote_tags` gives each quote its
  tags (kind, label and anchors), and `tag_terms` maps each word of a topic or event label to the quotes those tags
  are on.
- **Dates come from the journal.** An episode's authored time is the date line of the first quote, in journal order,
  that its anchors are in, from `quote_meta`. Its event time stays unknown; no model guesses it.
  `get_journal_timeline` then lists events by the date they were first written about, and its description says so.
- **The graph tools work unchanged.** `search_journal_graph`, `get_journal_subgraph` and `resolve_journal_evidence`
  read the new nodes as they read any generation.
- **Quote search uses the tags.** `find_journal_quotes` also matches query words against topic and event labels
  (`tag_terms`), so a search can find a quote by what it's about in words the quote doesn't use, and a kind filter
  keeps, say, only the quotes that name a person. Each result says how it matched (`matched_by`: its words, a tag, or both). Tags never
  change a quote's text, date or cues.
- **The answering rules stay.** Tool descriptions say that tags and labels are pointers a model wrote, that a quote
  matched only by a tag must be checked against its own words before it's used, and that an answer quotes the
  journal, never a tag.
- **A new index version.** The pass builds a new quote generation that names the one it replaces (`supersedes`), as
  version 2 does.

### Running it in hours

- **All batches at once.** The pass puts every batch in the work exchange together. Batches don't depend on each
  other, so a batch waits only for a free slot.
- **Codex only, one tier.** Standard tier, at the model and effort the pilot picks. No hardest tier, no repair
  cycles, no review loops.
- **Full width.** The Codex worker runs at its maximum of eight slots. If the semantic import is running, it is paused
  for the pass, so the two don't compete for the subscription.
- **A deadline that holds.** The deadline is a run setting, `pointer_deadline_minutes` (default 180). When the pass
  starts it saves the deadline as a time in its own state, so a resumed pass keeps the same one. Every batch's
  exchange item expires at that time, so no worker starts a batch after it. At the deadline the pass stops waiting:
  every batch still unanswered is recorded as untagged with the reason `deadline`, an answer stored after it is
  ignored, and the pass builds from what it has. Sending those batches again is a new pass, not a resume. The pass
  doesn't rely on the worker's `--once` mode, which waits out usage-limit backoff.
- **No stops for a person.** Nothing in the pass waits for the owner. Publishing the result is still the owner's
  `deploy`.

### Time and cost

- **The owner's journal.** 1,122 pages, at most 2.9 MB of text: version 1 held it in 1,804 quotes of at most 1.6 KB
  each. At about 6 KB a batch that is at most about 500 batches, and fewer in practice.
- **Time.** At the Codex lane's current 0.8 minutes an answer on eight slots, 500 batches take under an hour.
  Subscription usage limits could slow that; the pilot measures it.
- **Tokens.** About 0.9 million input tokens of journal text at most, plus the instructions, which are cached after the
  first call; the tags and reasoning perhaps as much again. On pay-per-use API keys that is a few dollars to a few tens
  of dollars for a journal this size, depending on the model. The pilot measures tokens per page, and the provider's
  price list at that time gives the cost.
- **Measuring.** 96 reference answers and 96 search-writing answers on the same Codex slots, about half an hour,
  which can run while the pass does. The precision check is 12 calls for each judge; the Claude judge's 12, one at a
  time at the Claude lane's current seven minutes or so a call, take about an hour and a half and fit in a day's 40.
- **For the public.** The same pass on pay-per-use keys can run many more than eight calls at once, so a journal this
  size takes minutes to an hour. The provider, the model and who pays are owner decisions before any public run.

### Measuring it, with the floors fixed in advance

- **A random sample of the journal.** Before the full pass, the import's own probability sample
  (`createDeterministicAuditSample`) is drawn from every unit that has quotes (the import's pieces of the journal, about
  a page each), with a recorded seed: the journal is cut into 12 stretches in order, and 8 units are drawn at random
  from each, 96 in all, each with its inclusion probability recorded. Units with no quotes yet (pages that need visual
  reading) are counted and left out, and repeated units count once. Each sampled unit gets a new frozen reference from
  the reference reader: source-grounded questions with expected answers, and the items that answer them with exact
  anchors. Calibration's references aren't reused: the import's repairs were checked against them. No reader is ever
  shown a tag, so the references measure the pass independently. The measurement runs on the import
  server and reports counts only.
- **No unit drops out.** A sampled unit's reference is complete when the reader doesn't list the unit as unassessed;
  every answerable or partly answerable question names at least one evidence item; every item named exists in the
  reference and every one of its anchors resolves exactly in the unit; every critical item is named by at least one
  such question, so no critical item goes unmeasured (the reader's instructions ask for this); and the unit has at
  least one such question. An incomplete or failed reference gets one retry, and so does a search-writing answer that fails or leaves
  a question without a search. A unit still without a complete reference or its searches is a nonresponse: recall is
  then unknown, the recall floor fails, and the report lists the unit. So a hard page can't leave the sample and lift
  the bound.
- **Calibration as a challenge set.** Calibration's units were chosen by their place in the journal plus every hazard
  (dreams, wishes, plans, hypotheticals), so they aren't a random sample. Recall on them is reported on its own, with
  hazards apart, and never stands in for a floor.
- **What is measured.** The generation the full pass built, the same one that would be published, never a separate
  trial run: the tagger's answers vary from run to run.
- **Retrieval recall.** It counts the sampled questions whose reference names items to find; a question is critical
  when one of those items is. A question the reference marks unanswerable has no quote to find, so those are left out
  of recall and reported on their own: how many there are, and how many tag-only results their searches bring back.
  - One call per sampled unit writes, once for each of its questions, up to three searches an answering model would
    run. It sees only the questions, never the unit's text or the expected answers, as an answering model would.
  - Code runs the searches with `find_journal_quotes` on that generation. A reference item's anchors are all needed
    (one may hold the event and another its negation or qualifier), so a question is found only when every quote
    holding an anchor of any of its evidence items comes back in the first 12 results of one of its searches.
  - Recall is reported with words only (the same generation searched with tag matching switched off, which is how
    the live index searches) and with words and tags, and critical questions on their own line.
  - A unit's questions move together and the sample is drawn by stretch, so each one-sided 95% lower bound follows
    the design. Recall is the weighted ratio of questions found to questions asked, with weights from the inclusion
    probabilities; its standard error comes from how the sampled units vary within each stretch (linearized); and
    Student's t has as many degrees of freedom as there are sampled units less the number of stretches, counted in the
    sample as drawn (84 for the owner's journal: 96 units in 12 stretches). A shorter journal can have stretches with
    fewer than 8 units; a stretch with a single sampled unit is merged with its neighbor for the variance, which can
    overstate it but never understates it, and with fewer than two sampled units in all the bound can't be computed
    and the recall floor fails.
  - No loss and gain use the same weights as recall.
- **Tag precision.** It is measured on tag–quote pairs, the way search uses tags: each quote a kept tag is anchored in
  makes one pair, so a tag on a hundred quotes is a hundred pairs, and a wrong one weighs as much as the wrong hits it
  causes.
  - A fixed sample of 300 pairs (all of them, if there are fewer), drawn from that generation with a recorded seed, is
    scored by two independent judges, one Codex and one Claude. Each judge is shown the exact quote, the tag's label
    and kind, and asked whether that quote really mentions or concerns what the label names, and whether the kind is
    right. Pairs go 25 to a call.
  - Both judges score every sampled pair, and a pair counts as correct only when both say so. A judge call that fails
    gets one retry, and a pair still unscored by either judge counts as wrong, which can only lower the bound. Their
    agreement (raw agreement and Cohen's kappa, reported as undefined when the judges give one answer throughout) and
    the number of disagreements are reported; agreement is never a gate.
  - The sample's size is fixed before scoring and the sample is scored once, so its one-sided 95% Clopper-Pearson
    bound is computed once, with no stopping early. With no pairs at all, the bound is 0.
- **Floors** (stated now; the owner approves them by merging this plan, and only the owner can change them). The pass
  is published only when every one holds. A pass with no tags fails, and so does one that leaves more than 2% of the
  pages without a kept tag:
  - **recall:** the one-sided 95% lower bound of recall with words and tags, on the random sample, is at least 85%;
  - **no loss:** recall with words and tags is at least recall with words only, on the same sampled questions, all of
    them and the critical ones (point estimates). If the sample has no critical question, the report says so and this
    floor is judged on all questions alone;
  - **gain:** of the sampled questions word search alone misses, words and tags find at least a quarter. This floor
    is on the point estimate, with its lower bound reported: it is there to stop a pass that adds nothing, and a pass
    with no tags finds none of them. If word search misses no sampled question, there is nothing to gain, and the
    report says so in place of this floor;
  - **precision:** the one-sided 95% lower bound of pair precision is at least 90%, each kind also reported on its
    own;
  - **coverage:** at most 2% of the pages with quotes are untagged, each one listed with its reason. A page is
    untagged when it ends with no kept tag, whatever the reason: its batch failed twice or ran out of time, the answer
    gave it no tag, or every tag on it was dropped. So a pass whose answers are valid but nearly empty fails here.
    Above 2%, the untagged pages' batches go into one new pass, and the whole measurement runs again on the generation
    it builds before anything is published; the reference sample and its references stay as they are. If coverage
    still fails after that pass, the generation is discarded like any other that fails a floor;
  - **anchors:** no kept tag whose anchor doesn't resolve or breaks a name rule above, which holds by construction
    and is checked anyway.

### Steps

1. **Build** the role, schema, batching, checks, graph adaptation, search on tags and the measurement command, with
   the tests below. Codex review; the owner merges.
2. **Reference sample:** draw the 96 units with a recorded seed and give each a new frozen reference.
3. **Pilot** on 20 pages drawn from a recorded seed outside the reference sample: seconds per batch, tokens, tags kept
   and dropped, failed batches. It never looks at a reference, and nothing is published.
4. **Full pass** on the whole journal, timed. Built, not published.
5. **Measure** that generation against every floor: recall on the random sample, precision on a sample of its own
   tag–quote pairs, coverage of its pages, with calibration's set reported apart. Nothing published. If coverage
   fails, one new pass tags the untagged pages and this step runs again on its generation. If any floor fails after
   that, the generation is discarded and the counts go on the owner page.
6. **Publish** on the owner's `deploy` exactly the measured generation, identified by its digest, and only when every
   floor holds, with the connector rebuild that ships the tool descriptions.

### Out of this part

- **Public runs.** Provider, model, spend per journal, and a queue that runs many journals at once with per-journal
  limits.
- **Pictures and handwriting.** Pages that need visual reading have no quotes until their transcription is verified.
  Their reading pass uses the same design: one call per page, all at once, checked by code.
- **The semantic import.** It stopped on 11 Oct at 01:41 UTC, when calibration round 5 went past its limit of
  critical misses (5 confirmed, 3 allowed). Whether it starts again is an owner decision (question 21). This pass
  doesn't depend on it.

### Tests

- **Anchors.** A tag whose anchor isn't in the named unit, or names a unit outside its batch, is dropped; one whose
  anchor is there is kept; kinds and length limits hold; duplicates in a batch merge.
- **Names.** An anchor of a person, place or organization tag that lacks the name, case and accents ignored, is
  dropped, so a quote that says only "he" is never filed under a name; an event or topic label with a capitalized
  word, the first one included ("Jean's birthday"), loses each anchor that lacks it; a tag left with no anchor is
  dropped; every drop is counted.
- **Failures.** A malformed answer gets one retry; a second failure leaves its batch untagged and listed, and the run
  finishes.
- **Deadline.** The deadline is saved when the pass starts and kept on resume; batch items expire at it; a batch
  unanswered at the deadline ends untagged with the reason `deadline`; an answer stored after it is ignored; the pass
  then builds, and no resume sends the batch again.
- **Batches.** Every quote is in exactly one batch, pages stay whole, and no batch is over the limit except a single
  page that is.
- **Graph.** A pointer-only extraction yields entity and episode nodes linked to their quotes' existing passages, with
  no new passage, authored times from `quote_meta` and no assertions; topic tags appear only in the tag index; tags of
  the same kind and label in two batches stay two nodes.
- **Search.** A query word in a topic or event label (`tag_terms`) finds the tagged quote and reports `matched_by`; a
  quote that matches only through a tag ranks after quotes that match by their own words; a kind filter keeps only
  the quotes with a tag of that kind; the quote's text, date and cues are unchanged.
- **Supersede.** The pointer generation replaces version 2 exactly as version 2 replaced version 1.
- **Measurement.** Recall and precision on synthetic data with known answers. The unit sample is the import's
  probability sample (12 stretches, 8 units each) from a recorded seed, only from units with quotes, and every sampled
  unit gets a new reference. A reference that lists the unit as unassessed, has an answerable question with no
  evidence item, names an item that doesn't exist or has an anchor that doesn't resolve in the unit, leaves a critical
  item out of every question, or has no evidence-backed question gets one retry and then makes recall unknown and the
  recall floor fail; so does a search-writing answer that leaves a question without a search. The pilot's pages never
  overlap the sample; the search-writing packet holds the questions and nothing of the unit's text or expected
  answers, and the tagger's packet holds journal text and nothing from the semantic import. Recall's weighted estimate
  and design-based bound match a hand-worked example; units whose questions all fail together widen the bound; degrees
  of freedom come from the sample as drawn, a single-unit stretch is merged with its neighbor, and fewer than two
  units fail the floor. A question is found only when every quote holding an anchor of its evidence items is in the
  first 12 results of one of its searches, so an item whose second anchor holds its negation isn't found from the
  first alone; unanswerable questions stay out of recall and are reported; a sample with no critical question is
  reported and judged for no loss on all questions alone. Precision samples tag–quote pairs, so a wrong tag on many
  quotes counts once for each; the Clopper-Pearson arithmetic, with a bound of 0 for no pairs; the sample's size is
  fixed before scoring and its bound computed once; a pair counts as correct only when both judges say so, and a pair
  left unscored after a retry counts as wrong; kappa is reported as undefined when the judges give one answer
  throughout. A pass with no tags fails the precision floor, and the gain floor whenever word search misses a
  question; the gain floor is reported as not applicable when word search misses nothing; a page whose valid answer
  gave it no tag, or whose tags were all dropped, counts as untagged; an untagged share over 2% blocks publication,
  and the generation a new pass builds is measured again from the start; the words-only baseline is the same
  generation with tag matching off; publishing refuses a generation whose digest isn't the measured one.

All test data is synthetic. Journal text, packets and answers never enter Git, logs or pull request text.
