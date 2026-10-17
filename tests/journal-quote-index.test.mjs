import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateJournalGraph } from "../src/journal-import/contracts.mjs";
import { adaptExtractionToGraph, journalLocalNodeId, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { partitionRepresentation } from "../src/journal-import/partition.mjs";
import { QUOTE_INDEX_VERSION, QUOTE_MONTHS_KEY, QUOTE_TERMS_STATS_KEY, QUOTE_UNDATED_KEY, QUOTE_UNIT_NAMESPACE, QUOTE_WIDE_KEY, buildQuoteGeneration, dateLineValue,
  entryDateLine, quoteCues, quoteDateOptions, quoteIndexVersionOf, splitQuoteUnits, timeOrderRun } from "../src/journal-import/quote-index.mjs";
import { buildQuoteTerms, buildQuoteTermsFromGraph } from "../src/journal-import/quote-terms.mjs";
import { formsReadingTerm } from "../src/journal-import/word-forms.mjs";
import { journalQuoteNumericDateOrder } from "../src/journal-import/run-config.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { listenPrivateCaseMcp } from "../src/server/private-case-mcp.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

// The quote index (plan 2026-10-09-journal-quote-first.md): exact paragraph quotes with the date line
// each was written under, found by their words. All text here is invented.

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const LONG = Array.from({ length: 40 }, (_, index) => `Sentence number ${index} about the long walk and the quiet harbour.`).join(" ");
const PAGES = [
  "Some undated opening words about the garden.\n\nMarch 3, 2019\n\nI dreamt that Mara left the house. It was only a dream.\n\nToday I didn't go to work. Maybe tomorrow.\n",
  "The bakery on Elm street smelled of cardamom.\n\nApril 10, 2019\n\nMara said she would visit in June. I wish she would stay longer.\n",
  `2020-01-05 New year. I'm going to start running again, slowly at first, then every morning before work.\n\n${LONG}\n\nShort.\nTiny.\n\nCafé ☕ visit with Jonás — überraschend schön.\n`
];
const representations = PAGES.map((text, index) => ({ representation_id: `test:page:${index}`, text, page_number: index + 1, parse_status: "readable" }));

test("a date line is read only where a line opens with it", () => {
  assert.deepEqual(dateLineValue("March 3, 2019"), { from: "2019-03-03", to: "2019-03-03", precision: "day" });
  assert.deepEqual(dateLineValue("Monday, March 3rd 2019 — late"), { from: "2019-03-03", to: "2019-03-03", precision: "day" });
  assert.deepEqual(dateLineValue("  Tues. 4 Feb. 2020"), { from: "2020-02-04", to: "2020-02-04", precision: "day" });
  assert.deepEqual(dateLineValue("3rd of March, 2019"), { from: "2019-03-03", to: "2019-03-03", precision: "day" });
  assert.deepEqual(dateLineValue("2020-01-05 New year."), { from: "2020-01-05", to: "2020-01-05", precision: "day" });
  assert.deepEqual(dateLineValue("3/4/19"), { from: "2019-03-04", to: "2019-03-04", precision: "day", ambiguous: true });
  assert.deepEqual(dateLineValue("25.12.2018"), { from: "2018-12-25", to: "2018-12-25", precision: "day", day_first: true });
  assert.deepEqual(dateLineValue("4/4/1999"), { from: "1999-04-04", to: "1999-04-04", precision: "day", ambiguous: false });
  assert.deepEqual(dateLineValue("September 2017"), { from: "2017-09", to: "2017-09", precision: "month" });
  assert.equal(dateLineValue("February 30, 2019"), null);
  assert.equal(dateLineValue("I saw her on March 3, 2019."), null);
  assert.equal(dateLineValue("September 2017 was a hard month"), null);
  assert.equal(dateLineValue("May I come in?"), null);
  assert.equal(dateLineValue("1.2.3 is a version"), null);
});

test("French, year-first and marked date lines are read, in the journal's numeric order", () => {
  const read = (line, order) => entryDateLine(line, order ? { numericOrder: order } : undefined);
  const day = (value, extra = {}) => ({ kind: "date", from: value, to: value, precision: "day", ...extra });
  assert.deepEqual(read("mardi 3 mars 2020"), day("2020-03-03"));
  assert.deepEqual(read("Le 1er août 2019"), day("2019-08-01"));
  assert.deepEqual(read("Le mardi 3 mars 2020 — matin"), day("2020-03-03"));
  assert.deepEqual(read("## 12 décembre 2018"), day("2018-12-12"));
  assert.deepEqual(read("• 5 févr. 2020"), day("2020-02-05"));
  assert.deepEqual(read("[3 mars 2020]"), day("2020-03-03"));
  assert.deepEqual(read("- Date: 2021/10/03"), day("2021-10-03"));
  assert.deepEqual(read("2021-10-03T21:40 soirée"), day("2021-10-03"));
  assert.deepEqual(read("Le 3 mars 2020, il pleuvait toute la journée."), day("2020-03-03"));
  assert.deepEqual(read("Février 2019"), { kind: "date", from: "2019-02", to: "2019-02", precision: "month" });
  assert.deepEqual(read("fe\u0301vrier 2019"), { kind: "date", from: "2019-02", to: "2019-02", precision: "month" }, "an accent written as a separate mark");
  // An all-numeric date both orders could read follows the journal's order and says it is ambiguous.
  assert.deepEqual(read("03/04/2019"), day("2019-03-04", { ambiguous: true }));
  assert.deepEqual(read("03/04/2019", "day_first"), day("2019-04-03", { ambiguous: true, day_first: true }));
  assert.deepEqual(read("25/12/2019", "month_first"), day("2019-12-25", { day_first: true }), "only one order can be a date");
  // Dates without a year, and the other lines that start an entry.
  assert.deepEqual(read("mardi 3 mars"), { kind: "yearless", month: 3, day: 3 });
  assert.deepEqual(read("3 mars :"), { kind: "yearless", month: 3, day: 3 });
  assert.deepEqual(read("3 mars 21h30"), { kind: "yearless", month: 3, day: 3 });
  assert.deepEqual(read("Tuesday, March 3, 9:40 pm"), { kind: "yearless", month: 3, day: 3 });
  assert.deepEqual(read("Tue 3/10"), { kind: "yearless", month: 3, day: 10, ambiguous: true });
  assert.deepEqual(read("mardi 3.10.", "day_first"), { kind: "yearless", month: 10, day: 3, ambiguous: true, day_first: true });
  assert.deepEqual(read("2019"), { kind: "year", year: 2019 });
  assert.deepEqual(read("Dimanche soir :"), { kind: "weekday" });
  assert.deepEqual(read("Sunday"), { kind: "weekday" });
  // Sentences, and things that only look like dates.
  for (const line of ["March 3 was hard", "May I come in?", "Mars 3 fois par semaine", "2019 a été dure", "1/2 tasse de farine",
    "Sam", "Lundi, je suis allé au marché.", "I saw her on 3 mars 2020.", "12.5 kg", "31 février", "1.2.3 is a version"]) {
    assert.equal(read(line), null, line);
    assert.equal(read(line, "day_first"), null, line);
  }
  assert.throws(() => entryDateLine("3/4/19", { numericOrder: "dmy" }), { code: "QUOTE_DATE_ORDER_INVALID" });
});

test("quote units are exact, trimmed, bounded spans that cover every non-space byte once", () => {
  for (const { representation_id: representationId, text } of representations) {
    const units = splitQuoteUnits({ representationId, text });
    const bytes = Buffer.from(text, "utf8");
    const covered = new Uint8Array(bytes.length);
    let previousEnd = 0;
    for (const unit of units) {
      const slice = bytes.subarray(unit.start_byte, unit.end_byte);
      assert.equal(slice.toString("utf8"), unit.text);
      assert.equal(sha256(slice), unit.sha256);
      assert.equal(unit.text, unit.text.trim());
      assert.ok(unit.utf8_byte_length <= 1600);
      assert.ok(unit.start_byte >= previousEnd);
      previousEnd = unit.end_byte;
      covered.fill(1, unit.start_byte, unit.end_byte);
    }
    const uncovered = Buffer.from(bytes.filter((_, index) => !covered[index])).toString("utf8");
    assert.equal(uncovered.trim(), "", "only whitespace sits between units");
  }
  const [first] = representations;
  const units = splitQuoteUnits({ representationId: first.representation_id, text: first.text });
  assert.deepEqual(units.map(({ text }) => text), [
    "Some undated opening words about the garden.",
    "March 3, 2019",
    "I dreamt that Mara left the house. It was only a dream.\n\nToday I didn't go to work. Maybe tomorrow."
  ]);
  assert.equal(units[1].heading, true);
  assert.deepEqual(units[1].entry_line, { kind: "date", from: "2019-03-03", to: "2019-03-03", precision: "day" });
  const third = splitQuoteUnits({ representationId: representations[2].representation_id, text: representations[2].text });
  assert.match(third[0].text, /^2020-01-05 New year\./u, "a long line opening with a date starts its own unit");
  assert.equal(third[0].heading, false);
  assert.equal(third[0].entry_line.from, "2020-01-05");
  assert.ok(third.filter(({ text }) => text.startsWith("Sentence")).length >= 2, "a long paragraph is cut");
  assert.ok(third.filter(({ text }) => text.startsWith("Sentence")).every(({ text }) => text.endsWith(".")), "cuts fall after sentences");
  assert.ok(third.some(({ text }) => text.includes("Café ☕ visit with Jonás")), "multibyte text stays exact");
});

test("wording cues are found mechanically, curly apostrophes included", () => {
  const kinds = (text) => [...new Set(quoteCues(text).map(({ kind }) => kind))].sort();
  assert.deepEqual(kinds("I dreamt that Mara left the house."), ["dream"]);
  assert.deepEqual(kinds("I didn’t go. Maybe tomorrow."), ["hedge", "negation"]);
  assert.deepEqual(kinds("Mara said she would visit. I wish she would stay."), ["reported_speech", "wish"]);
  assert.deepEqual(kinds("I'm going to start running. What if it rains?"), ["hypothetical", "plan"]);
  assert.deepEqual(kinds("We walked to the harbour."), []);
});

test("the quote generation validates, dates quotes from the line above across pages, and lists them by month", () => {
  const built = buildQuoteGeneration({ caseId: "quote-case", corpusId: "quote-corpus:quotes", generation: "quote-generation",
    originalObjectId: "original:test", mediaType: "application/pdf", representations });
  validateJournalGraph(built.graph, Object.fromEntries(representations.map((item) => [item.representation_id, item.text])));
  const passages = built.graph.nodes.filter((node) => node.kind === "passage");
  assert.equal(passages.length, built.stats.quotes);
  assert.equal(built.quoteMeta.size, passages.length);
  const metaFor = (fragment) => built.quoteMeta.get(passages.find((node) => node.data.quote.includes(fragment)).id)[0];
  assert.equal(metaFor("undated opening").written, null);
  assert.equal(metaFor("I dreamt").written.from, "2019-03-03");
  assert.equal(metaFor("bakery on Elm").written.from, "2019-03-03", "carried onto the next page");
  assert.equal(metaFor("Mara said").written.from, "2019-04-10");
  assert.equal(metaFor("Café").written.from, "2020-01-05");
  assert.equal(metaFor("Café").page, 3);
  assert.deepEqual(built.quoteMonths.get(QUOTE_MONTHS_KEY), ["2019-03", "2019-04", "2020-01"]);
  assert.equal(built.quoteMonths.get(QUOTE_UNDATED_KEY).length, 1);
  assert.equal(built.stats.date_lines, 3);
});

test("no date is carried into or past a page whose text wasn't fully read", () => {
  const pages = [
    { representation_id: "gap:1", text: "March 3, 2019\n\nA readable entry about the orchard.", page_number: 1, parse_status: "readable" },
    { representation_id: "gap:2", text: "Native words around a scanned picture.", page_number: 2, parse_status: "visual_pending" },
    { representation_id: "gap:3", text: "The next readable page about the orchard.\n\nApril 9, 2019\n\nA dated paragraph.", page_number: 3, parse_status: "readable" }
  ];
  const built = buildQuoteGeneration({ caseId: "quote-case", corpusId: "quote-corpus:quotes", generation: "gap-generation",
    originalObjectId: "original:test", mediaType: "application/pdf", representations: pages });
  const byText = new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.quote, built.quoteMeta.get(node.id)[0]]));
  assert.equal(byText.get("A readable entry about the orchard.").written.from, "2019-03-03");
  assert.equal(byText.get("Native words around a scanned picture.").written, null, "not carried into the unread page");
  assert.equal(byText.get("The next readable page about the orchard.").written, null, "not carried past it");
  assert.equal(byText.get("A dated paragraph.").written.from, "2019-04-09", "a date line read after the gap dates what follows");
});

// The meta of each quote in a generation, by the text of its quote.
function writtenByText(built) {
  return new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.quote, built.quoteMeta.get(node.id)[0].written]));
}
const page = (text, number, parseStatus = "readable") => ({ representation_id: `dates:${number}`, text, page_number: number, parse_status: parseStatus });
const build = (pages, dateOptions = {}, unitOptions = {}) => buildQuoteGeneration({ caseId: "quote-case", corpusId: "quote-corpus:quotes",
  generation: "dates-generation", originalObjectId: "original:test", mediaType: "application/pdf", representations: pages, dateOptions, unitOptions });

test("a date written without its year takes the year of the dates before it, into the next year after December", () => {
  const built = build([
    page("28 décembre 2019\n\nLe sapin est encore là.\n\n2 janvier\n\nPremière marche de l'année.", 1),
    page("15 janvier :\n\nLa neige tient.\n\nmardi 3.3.\n\nToujours froid.", 2)
  ], { numericOrder: "day_first" });
  const written = writtenByText(built);
  assert.deepEqual(written.get("Le sapin est encore là."), { from: "2019-12-28", to: "2019-12-28", precision: "day", ambiguous: false, year_inferred: false,
    line: written.get("Le sapin est encore là.").line });
  assert.equal(written.get("Première marche de l'année.").from, "2020-01-02");
  assert.equal(written.get("Première marche de l'année.").year_inferred, true);
  assert.equal(written.get("La neige tient.").from, "2020-01-15");
  assert.equal(written.get("Toujours froid.").from, "2020-03-03");
  assert.equal(written.get("Toujours froid.").ambiguous, false, "3.3. reads the same either way");
  assert.deepEqual(built.stats.date_line_kinds, { full: 1, year_inferred: 3, year_only: 0, no_year_known: 0, weekday_only: 0 });

  // A year alone dates what follows to that year, and gives later dates their year.
  const years = writtenByText(build([page("2018\n\nUne année entière, sans date précise.\n\n4 mai\n\nLe printemps.", 1)]));
  assert.deepEqual(years.get("Une année entière, sans date précise.").from, "2018");
  assert.equal(years.get("Une année entière, sans date précise.").precision, "year");
  assert.equal(years.get("Le printemps.").from, "2018-05-04");

  // Before any year is known, or on a day the year doesn't have, a date without a year dates nothing.
  const unknown = build([page("3 mars\n\nAvant toute année.\n\n3 février 2019\n\nUn jour.\n\n29 février\n\nUn jour qui n'existe pas.", 1)]);
  const lost = writtenByText(unknown);
  assert.equal(lost.get("Avant toute année."), null);
  assert.equal(lost.get("Un jour.").from, "2019-02-03");
  assert.equal(lost.get("Un jour qui n'existe pas."), null);
  assert.equal(unknown.stats.date_line_kinds.no_year_known, 2);

  // A page that wasn't fully read may hide a new year, so a date after it doesn't take its year from before it.
  const gap = build([page("28 décembre 2019\n\nAvant le dessin.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"),
    page("2 janvier\n\nAprès le dessin.\n\n5 janvier 2021\n\nDaté de nouveau.\n\n6 janvier\n\nLe lendemain.", 3)]);
  const afterGap = writtenByText(gap);
  assert.equal(afterGap.get("Avant le dessin.").from, "2019-12-28");
  assert.equal(afterGap.get("Après le dessin."), null);
  assert.equal(afterGap.get("Daté de nouveau.").from, "2021-01-05");
  assert.equal(afterGap.get("Le lendemain.").from, "2021-01-06", "a full date read after the gap gives later dates their year again");
  assert.equal(gap.stats.date_line_kinds.no_year_known, 1);
});

test("every line that starts an entry ends the date before it", () => {
  const built = build([page("3 mars 2020\n\nUne matinée calme.\n\nDimanche\n\nSans date écrite.\n\n5 mars\n\nDe nouveau daté.", 1)]);
  const written = writtenByText(built);
  assert.equal(written.get("Une matinée calme.").from, "2020-03-03");
  assert.equal(written.get("Dimanche"), null);
  assert.equal(written.get("Sans date écrite."), null, "a weekday alone ends the date before it");
  assert.equal(written.get("De nouveau daté.").from, "2020-03-05", "the year still comes from before the weekday");
  assert.equal(built.stats.date_line_kinds.weekday_only, 1);
  assert.equal(built.stats.date_lines, 2);
});

test("a date is carried over its own page and the next two, or the next quotes in a source without pages", () => {
  const pages = [page("1 avril 2020\n\nPage une.", 1), page("Page deux.", 2), page("Page trois.", 3), page("Page quatre.", 4), page("Page cinq.", 5)];
  const built = build(pages);
  const written = writtenByText(built);
  assert.deepEqual(["Page une.", "Page deux.", "Page trois.", "Page quatre.", "Page cinq."].map((text) => written.get(text)?.from ?? null),
    ["2020-04-01", "2020-04-01", "2020-04-01", null, null]);
  assert.equal(built.stats.carry_capped_quotes, 2);
  const tight = build(pages, { carryPages: 0 });
  assert.deepEqual(["Page une.", "Page deux."].map((text) => writtenByText(tight).get(text)?.from ?? null), ["2020-04-01", null]);
  assert.equal(tight.stats.carry_capped_quotes, 4);
  // A text source has no page numbers: the date is carried over a number of quotes instead.
  const text = ["1 avril 2020", ...Array.from({ length: 6 }, (_, index) => `Paragraphe ${index}.`)].join("\n\n");
  const unpaged = build([{ representation_id: "text:whole", text, page_number: null, parse_status: "readable" }], { carryQuotes: 3 }, { minimumBytes: 0 });
  const carried = writtenByText(unpaged);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => carried.get(`Paragraphe ${index}.`)?.from ?? null),
    ["2020-04-01", "2020-04-01", "2020-04-01", null, null, null]);
  assert.equal(unpaged.stats.carry_capped_quotes, 3);
  // A page that wasn't fully read still stops the carry, and its undated quotes aren't counted as capped.
  const gap = build([page("1 avril 2020\n\nPage une.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"), page("Après le dessin.", 3)]);
  assert.equal(writtenByText(gap).get("Après le dessin."), null);
  assert.equal(gap.stats.carry_capped_quotes, 0);
  assert.throws(() => build(pages, { carryPages: -1 }), { code: "QUOTE_DATE_OPTIONS_INVALID" });
  assert.throws(() => build(pages, { numericOrder: "dmy" }), { code: "QUOTE_DATE_OPTIONS_INVALID" });
  assert.throws(() => build(pages, { carry: 2 }), { code: "QUOTE_DATE_OPTIONS_INVALID" });
});

test("the counts describe the dates without any of the text", () => {
  const built = build([page(["Mars est une planète.", "Lundi, je suis allé au marché.", "12-13 heures de sommeil.", "10-11 heures.", "1.5 litres d'eau.",
    "3/4/2019", "Le rendez-vous.", "Vendredi", "Rien de daté."].join("\n\n"), 1)], { numericOrder: "day_first" });
  const { stats } = built;
  assert.equal(stats.numeric_date_order, "day_first");
  assert.equal(stats.date_lines, 1);
  assert.equal(stats.ambiguous_date_lines, 1);
  assert.equal(writtenByText(built).get("Le rendez-vous.").from, "2019-04-03");
  assert.deepEqual(stats.date_line_kinds, { full: 1, year_inferred: 0, year_only: 0, no_year_known: 0, weekday_only: 1 });
  assert.deepEqual(stats.unread_date_like, { month_led: 1, weekday_led: 1, shapes: [{ shape: "99-99", count: 2 }, { shape: "9.9", count: 1 }] });
  assert.equal(JSON.stringify(stats).match(/[\p{L}]{6,}/gu)?.some((word) => /planète|marché|sommeil|rendez/u.test(word)) ?? false, false);
});

test("the numeric date order is a run setting, month first unless the journal says otherwise", () => {
  assert.equal(journalQuoteNumericDateOrder({}), "month_first");
  assert.equal(journalQuoteNumericDateOrder({ quote_numeric_date_order: null }), "month_first");
  assert.equal(journalQuoteNumericDateOrder({ quote_numeric_date_order: "day_first" }), "day_first");
  for (const value of ["dmy", "DAY_FIRST", 1, true]) {
    assert.throws(() => journalQuoteNumericDateOrder({ quote_numeric_date_order: value }), { code: "JOURNAL_QUOTE_NUMERIC_DATE_ORDER_INVALID" });
  }
  assert.deepEqual(quoteDateOptions(), { numericOrder: "month_first", carryPages: 2, carryQuotes: 24, rangeMonthsMax: 12 });
});

// A small made-up journal for the version 2 and version 3 tests that follow: dates with and without a year, a year alone, a weekday alone, a page
// that wasn't fully read, and pages past the carry limit.
const GOLDEN_PAGES = [
  page("2018\n\nUne année au bord du lac.\n\n28 décembre\n\nLe sapin est encore là.\n\n2 janvier\n\nPremière marche de l'année.\n\nDimanche\n\nSans date écrite.", 1),
  page("March 3, 2019\n\nI dreamt that Mara left the house. It was only a dream.\n\nApril 10, 2019\n\nMara said she would visit in June.", 2),
  page("Native words around a scanned picture.", 3, "visual_pending"),
  page("The next readable page about the orchard.\n\n5/6/19\n\nAmbiguous numbers here.\n\n3 mars\n\nUne date sans année.", 4),
  page("Page cinq.", 5), page("Page six.", 6), page("Page sept.", 7), page("Page huit.", 8)
].map((item) => ({ ...item, representation_id: `golden:${item.page_number}` }));
const goldenInput = (extra = {}) => ({ caseId: "golden-case", corpusId: "golden-corpus:quotes", generation: "golden:quotes:quote-index-v2-month-first",
  originalObjectId: "original:golden", mediaType: "application/pdf", representations: GOLDEN_PAGES, ...extra });
// Everything a build makes, as one string: the graph, the units, the two indexes and the counts.
const builtJson = (built) => JSON.stringify({ graph: built.graph, units: built.units, quoteMeta: [...built.quoteMeta], quoteMonths: [...built.quoteMonths], stats: built.stats });

test("a version 2 generation is rebuilt exactly as it was: the same units, ids, indexes and counts", () => {
  // The digest was taken of the build made by the code before version 3 existed; the build must still give it, by default and as version 2.
  const DIGEST = "cc0d1b00bcaa6899829033b7648cb1a63b6aa2db049ad68dd4f4d99a8d207bf3";
  for (const options of [{}, { version: 2 }]) {
    const built = buildQuoteGeneration(goldenInput(options));
    assert.equal(sha256(builtJson(built)), DIGEST);
    assert.deepEqual(Object.keys(built.stats), ["pages", "quotes", "dated_quotes", "date_lines", "ambiguous_date_lines", "date_line_kinds", "carry_capped_quotes",
      "unread_date_like", "numeric_date_order"], "no count of version 3 appears");
    assert.equal(built.quoteMeta.size, built.stats.quotes);
    for (const [, [meta]] of built.quoteMeta) assert.equal(meta.written?.between ?? false, false, "no range");
  }
  assert.throws(() => buildQuoteGeneration(goldenInput({ version: 5 })), { code: "QUOTE_GENERATION_VERSION_INVALID" });
  assert.throws(() => buildQuoteGeneration(goldenInput({ version: "3" })), { code: "QUOTE_GENERATION_VERSION_INVALID" });
});

test("version 4 names new generations, version 3 names still read as 3: unit ids keep version 2's namespace, and passage ids change with the generation's name", () => {
  assert.equal(QUOTE_INDEX_VERSION, "quote-index-v4");
  assert.equal(QUOTE_UNIT_NAMESPACE, "quote-index-v2");
  assert.equal(quoteIndexVersionOf("case:quotes:quote-index-v4-month-first"), 4);
  assert.equal(quoteIndexVersionOf("case:quotes:quote-index-v4-day-first:pointer-0a1b2c3d"), 4);
  assert.equal(quoteIndexVersionOf("case:quotes:quote-index-v3-month-first"), 3);
  assert.equal(quoteIndexVersionOf("case:quotes:quote-index-v3-day-first:pointer-0a1b2c3d"), 3);
  assert.equal(quoteIndexVersionOf("case:quotes:quote-index-v2-month-first"), 2);
  assert.equal(quoteIndexVersionOf("case:quotes:quote-index-v2-day-first:pointer-0a1b2c3d"), 2);
  assert.equal(quoteIndexVersionOf("quote-generation"), 2);
  assert.equal(quoteIndexVersionOf(undefined), 2);
  const [unit] = splitQuoteUnits({ representationId: "ns:1", text: "A single quote of the journal." });
  assert.equal(unit.unit_id, `unit:${sha256(`quote-index-v2\0ns:1\0${unit.start_byte}\0${unit.end_byte}\0${unit.sha256}`).slice(0, 32)}`);
  // Built as the runtime builds them: each version under a name of its own, the version taken from the name.
  const v3Name = "golden:quotes:quote-index-v3-month-first";
  const v2 = buildQuoteGeneration(goldenInput());
  const v3 = buildQuoteGeneration(goldenInput({ generation: v3Name, version: quoteIndexVersionOf(v3Name) }));
  assert.deepEqual(v3.units.map(({ unit_id: id }) => id), v2.units.map(({ unit_id: id }) => id), "the same units, with the same ids");
  const byUnit = (built) => new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node]));
  const [older, newer] = [byUnit(v2), byUnit(v3)];
  assert.deepEqual([...newer.keys()], [...older.keys()]);
  for (const [unitId, node] of newer) {
    const before = older.get(unitId);
    assert.deepEqual(node.data, before.data, "the same quote, span and page");
    assert.notEqual(node.id, before.id, "a passage id hashes the generation's name, so the same quote has a new id");
    assert.equal(node.id, journalLocalNodeId({ caseId: "golden-case", corpusId: "golden-corpus:quotes", generation: v3Name, localIdNamespace: QUOTE_UNIT_NAMESPACE,
      kind: "passage", localId: `${node.data.representation_id}:${node.data.start_byte}:${node.data.end_byte}:${node.data.quote_sha256}` }));
    // Every date version 2 gave, version 3 gives the same; a quote version 2 left undated stays so or gets a range.
    const [{ written: was }] = v2.quoteMeta.get(before.id), [{ written: is }] = v3.quoteMeta.get(node.id);
    if (was) assert.deepEqual(is, was);
    else assert.ok(is === null || is.between === true);
  }
  // The version, not the name, decides what is built: a version 2 build under any name has no ranges and no count of them.
  assert.equal(Object.hasOwn(buildQuoteGeneration(goldenInput({ generation: v3Name, version: 2 })).stats, "ranged_quotes"), false);
});

test("the word list holds each term of the forms reading with the quotes that use it, and the totals under a key no term can be", () => {
  const texts = ["The cats chat with the cat.", "Chats et chat; déprimée déprimé", "", "Déprimé!  Le chat; 2019 2019."];
  const pages = texts.map((text, index) => ({ representation_id: `terms:${index}`, text, page_number: index + 1, parse_status: "readable" }));
  const built = buildQuoteGeneration({ caseId: "terms-case", corpusId: "terms-corpus:quotes", generation: "terms:quotes:quote-index-v3-month-first",
    originalObjectId: "original:terms", mediaType: "application/pdf", representations: pages, unitOptions: { minimumBytes: 0 }, version: 3 });
  const idOf = (fragment) => built.graph.nodes.find((node) => node.kind === "passage" && node.data.quote.includes(fragment)).id;
  const cats = idOf("cats"), french = idOf("et chat"), last = idOf("Le chat");
  const terms = buildQuoteTermsFromGraph(built.graph);
  assert.equal(built.stats.quotes, 3, "a blank page has no quote");
  assert.deepEqual(terms.get("cat"), [cats].map((id) => [id, 2, 6]), "cats and cat are one term, used twice in a quote of six tokens");
  const inIdOrder = (...entries) => entries.sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(terms.get("chat"), inIdOrder([cats, 1, 6], [french, 2, 5], [last, 1, 5]), "chats and chat; in passage id order");
  assert.deepEqual(terms.get("the"), [[cats, 2, 6]], "the stop words are in, as is");
  assert.deepEqual(terms.get("et"), [[french, 1, 5]]);
  assert.deepEqual(terms.get(formsReadingTerm("déprimée")), inIdOrder([french, 2, 5], [last, 1, 5]), "accents folded, French forms reduced");
  assert.equal(formsReadingTerm("déprimée"), "deprim");
  assert.deepEqual(terms.get("2019"), [[last, 2, 5]], "numbers are terms too");
  assert.deepEqual(terms.get(QUOTE_TERMS_STATS_KEY), [{ quotes: 3, mean_length: (6 + 5 + 5) / 3 }]);
  assert.equal(terms.has("déprimé"), false, "terms are read, not raw");
  // Keys are in order, and every posting list is in passage id order.
  const keys = [...terms.keys()];
  assert.deepEqual(keys, [...keys].sort((left, right) => left.localeCompare(right)));
  for (const [key, postings] of terms) {
    if (key === QUOTE_TERMS_STATS_KEY) continue;
    assert.match(key, /^[\p{L}\p{N}]+$/u);
    assert.deepEqual(postings.map(([id]) => id), postings.map(([id]) => id).sort((left, right) => left.localeCompare(right)));
  }
  // No journal text is kept: only stems, ids and counts.
  assert.equal(JSON.stringify([...terms]).includes("cats chat"), false);
  // Nothing to count.
  assert.deepEqual([...buildQuoteTerms([])], [[QUOTE_TERMS_STATS_KEY, [{ quotes: 0, mean_length: 1 }]]]);
  assert.deepEqual(buildQuoteTerms([{ id: "passage:a", quote: "" }]).get(QUOTE_TERMS_STATS_KEY), [{ quotes: 1, mean_length: 1 }], "empty quotes: a mean of 1");
  // A passage listed twice is read once, and the input is checked.
  assert.deepEqual(buildQuoteTerms([{ id: "passage:a", quote: "horse" }, { id: "passage:a", quote: "other words" }]).get(formsReadingTerm("horse")), [["passage:a", 1, 1]]);
  for (const bad of [null, [{ id: "a", quote: "x" }], [{ id: "passage:a", quote: null }], [null]]) assert.throws(() => buildQuoteTerms(bad), { code: "QUOTE_TERMS_INPUT_INVALID" });
});

// Version 3: the order of the dates and the ranges for the quotes left undated between two dates.
const V3_GENERATION = "dates-generation:quotes:quote-index-v3-month-first";
const build3 = (pages, dateOptions = {}, unitOptions = {}) => buildQuoteGeneration({ caseId: "quote-case", corpusId: "quote-corpus:quotes",
  generation: V3_GENERATION, originalObjectId: "original:test", mediaType: "application/pdf", representations: pages, dateOptions, unitOptions, version: 3 });
const metaByText = (built) => new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.quote, built.quoteMeta.get(node.id)[0]]));
const lineOf = (written) => ({ representation_id: written.line.representation_id, start_byte: written.line.start_byte, end_byte: written.line.end_byte, sha256: written.line.sha256 });

test("version 3 counts the steps of the dates in journal order that go backwards, and the largest in days; version 2 counts nothing", () => {
  const pages = [page("3 mars 2020\n\nUn.", 1), page("10 mars 2020\n\nDeux.\n\n1 mars 2020\n\nTrois.", 2), page("5 mars 2020\n\nQuatre.\n\n20 février 2020\n\nCinq.", 3),
    page("Mots autour d'un dessin.", 4, "visual_pending"), page("6 mars 2020\n\nSix.", 5)];
  const { stats } = build3(pages);
  assert.deepEqual(stats.date_order, { steps: 5, backward: 2, largest_backward_days: 14 }, "10 March to 1 March is 9 days, 5 March to 20 February is 14");
  assert.equal(stats.date_lines, 6);
  // A date written without a year, a month alone and a year alone count by their first day.
  const kinds = build3([page("Février 2019\n\nUn.\n\n3 janvier 2019\n\nDeux.\n\n2019\n\nTrois.\n\n4 mai\n\nQuatre.", 1)]).stats.date_order;
  assert.deepEqual(kinds, { steps: 3, backward: 2, largest_backward_days: 29 }, "1 February to 3 January is 29 days; 3 January to 1 January 2 days; then forward to 4 May");
  assert.deepEqual(build3([page("3 mars 2020\n\nUn.", 1)]).stats.date_order, { steps: 0, backward: 0, largest_backward_days: 0 });
  assert.deepEqual(build3([page("Rien de daté ici.", 1)]).stats.date_order, { steps: 0, backward: 0, largest_backward_days: 0 });
  assert.deepEqual(build3([page("3 mars 2020\n\nUn.\n\n3 mars 2020\n\nDeux.", 1)]).stats.date_order, { steps: 1, backward: 0, largest_backward_days: 0 }, "the same day twice is not backwards");
  assert.equal(Object.hasOwn(build(pages).stats, "date_order"), false);
});

test("a quote left undated between two dates that run forward gets a range from the first to the second, shown as a range", () => {
  const pages = [page("3 mars 2020\n\nEntrée un.", 1), page("Deux.", 2), page("Trois.", 3), page("Quatre sans date.", 4), page("Cinq sans date.", 5),
    page("10 mai 2020\n\nEntrée six.", 6)];
  const built = build3(pages);
  const meta = metaByText(built);
  const first = meta.get("Entrée un.").written, last = meta.get("Entrée six.").written;
  assert.equal(meta.get("Trois.").written.from, "2020-03-03", "a carried date is a date, not a range");
  for (const text of ["Quatre sans date.", "Cinq sans date."]) {
    assert.deepEqual(meta.get(text).written, { from: "2020-03-03", to: "2020-05-10", precision: "interval", between: true, ambiguous: false, year_inferred: false,
      line: lineOf(first), line_after: lineOf(last) });
  }
  assert.equal(first.line.sha256, sha256("3 mars 2020"), "the line before is the first date's line");
  assert.equal(last.line.sha256, sha256("10 mai 2020"));
  // The quote lists: under every month the range covers, once, and the months list names them.
  const ids = (text) => built.graph.nodes.find((node) => node.kind === "passage" && node.data.quote === text).id;
  for (const month of ["2020-03", "2020-04", "2020-05"]) {
    assert.ok(built.quoteMonths.get(month).includes(ids("Quatre sans date.")) && built.quoteMonths.get(month).includes(ids("Cinq sans date.")), month);
  }
  assert.deepEqual(built.quoteMonths.get(QUOTE_MONTHS_KEY), ["2020-03", "2020-04", "2020-05"]);
  assert.equal(built.quoteMonths.has(QUOTE_UNDATED_KEY), false, "no quote is left without a date");
  assert.deepEqual(built.quoteMonths.get("2020-04"), ["Quatre sans date.", "Cinq sans date."].map(ids).sort((left, right) => left.localeCompare(right)));
  assert.equal(built.quoteMonths.get("2020-03").includes(ids("Trois.")), true);
  assert.equal(built.quoteMonths.get("2020-05").includes(ids("Trois.")), false, "a day-precise date is under its own month only");
  // Counts: the ranged quotes and how wide they are, apart from the dated ones.
  assert.equal(built.stats.ranged_quotes, 2);
  assert.deepEqual(built.stats.range_widths, { up_to_1_month: 0, up_to_3_months: 2, up_to_12_months: 0 });
  assert.equal(built.stats.carry_capped_quotes, 2, "still counted as capped by the carry limit");
  assert.equal(built.stats.dated_quotes, 6, "the ranged are not counted as dated");
  // Version 2 leaves them undated, as it always did.
  const older = metaByText(build(pages));
  assert.equal(older.get("Quatre sans date.").written, null);
  assert.equal(older.get("Cinq sans date.").written, null);
});

test("a range carries both dates' flags, spans the year's end, and covers a quote under a weekday line", () => {
  const built = build3([page("28 novembre 2019\n\nPremier.\n\nDimanche\n\nSans date écrite.\n\n5/6/19\n\nSecond.", 1), page("Après.", 2), page("Encore.", 3),
    page("Loin.", 4), page("3 février\n\nFinal.", 5)], { numericOrder: "month_first" });
  const meta = metaByText(built);
  // The weekday line has no date: the quote under it lies between the November line and the line after it (5 June 2019 is earlier, so no range).
  assert.equal(meta.get("Sans date écrite.").written, null, "5/6/19 is earlier than 28 November 2019: the journal turns back");
  assert.equal(meta.get("Dimanche").written, null);
  assert.equal(built.stats.date_order.backward >= 1, true);
  const yearEnd = build3([page("28 novembre 2019\n\nPremier.", 1), page("Deux.", 2), page("Trois.", 3), page("Quatre.", 4),
    page("2 février\n\nFinal.", 5)]);
  const written = metaByText(yearEnd).get("Quatre.").written;
  assert.deepEqual([written.from, written.to, written.year_inferred, written.ambiguous], ["2019-11-28", "2020-02-02", true, false], "the later date took its year from before it");
  assert.deepEqual(yearEnd.quoteMonths.get(QUOTE_MONTHS_KEY), ["2019-11", "2019-12", "2020-01", "2020-02"]);
  assert.ok(["2019-11", "2019-12", "2020-01", "2020-02"].every((month) => yearEnd.quoteMonths.get(month).length > 0));
  assert.deepEqual(yearEnd.stats.range_widths, { up_to_1_month: 0, up_to_3_months: 1, up_to_12_months: 0 });
  // An ambiguous date line makes the range ambiguous.
  const ambiguous = metaByText(build3([page("3 mars 2020\n\nPremier.", 1), page("Deux.", 2), page("Trois.", 3), page("Quatre.", 4), page("3/4/20\n\nFinal.", 5)])).get("Quatre.").written;
  assert.deepEqual([ambiguous.from, ambiguous.to, ambiguous.ambiguous, ambiguous.year_inferred], ["2020-03-03", "2020-03-04", true, false]);
  // A weekday line between two dates leaves its own entry in the range, as the quote after the carry limit is.
  const weekday = metaByText(build3([page("3 mars 2020\n\nPremier.\n\nDimanche\n\nSans date écrite.", 1), page("Deux.", 2), page("12 mars 2020\n\nFinal.", 3)]));
  assert.equal(weekday.get("Dimanche").written.between, true);
  assert.equal(weekday.get("Sans date écrite.").written.to, "2020-03-12");
  assert.equal(weekday.get("Dimanche").written.from, "2020-03-03");
});

test("no range is given across a step back in the dates, or past a page that wasn't fully read", () => {
  // The journal turns back: 10 May is followed by 3 March.
  const back = metaByText(build3([page("10 mai 2020\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Entre les deux.", 4), page("3 mars 2020\n\nFin.", 5)]));
  assert.equal(back.get("Entre les deux.").written, null);
  assert.equal(build3([page("10 mai 2020\n\nUn.", 1), page("Entre.", 4), page("3 mars 2020\n\nFin.", 5)]).stats.ranged_quotes, 0);
  // The same dates in order do give one.
  assert.equal(metaByText(build3([page("3 mars 2020\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Entre les deux.", 4), page("10 mai 2020\n\nFin.", 5)])).get("Entre les deux.").written.between, true);
  // A page between the lines that wasn't fully read may hide a date line, so nothing there or around it is ranged.
  const gap = metaByText(build3([page("3 mars 2020\n\nUn.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"), page("Après le dessin.", 3), page("Loin du dessin.", 4),
    page("Encore.", 5), page("10 mai 2020\n\nFin.", 6)]));
  for (const text of ["Mots autour d'un dessin.", "Après le dessin.", "Loin du dessin.", "Encore."]) assert.equal(gap.get(text).written, null, text);
  // A date line on a page that wasn't fully read can't begin or end a range either.
  const unreadLine = metaByText(build3([page("3 mars 2020\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Entre les deux.", 4),
    page("10 mai 2020\n\nFin.", 5, "visual_pending")]));
  assert.equal(unreadLine.get("Entre les deux.").written, null);
  // After a page that wasn't fully read, ranges between later dates still are.
  const after = metaByText(build3([page("1 mars 2020\n\nAvant.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"), page("2 mars 2020\n\nUn.", 3), page("Deux.", 4),
    page("Trois.", 5), page("Entre les deux.", 6), page("10 mai 2020\n\nFin.", 7)]));
  assert.deepEqual([after.get("Entre les deux.").written.from, after.get("Entre les deux.").written.to], ["2020-03-02", "2020-05-10"]);
  assert.equal(after.get("Mots autour d'un dessin.").written, null);
});

test("the stretch before the first date and after the last stays undated, and so does a range wider than the limit", () => {
  const edges = metaByText(build3([page("Avant toute date.", 1), page("Encore avant.", 2), page("3 mars 2020\n\nUn.", 3), page("Deux.", 4), page("Trois.", 5), page("Quatre.", 6),
    page("Cinq après la dernière.", 7), page("Six après la dernière.", 8)]));
  assert.equal(edges.get("Avant toute date.").written, null);
  assert.equal(edges.get("Encore avant.").written, null);
  assert.equal(edges.get("Quatre.").written, null, "past the carry limit, and nothing after to end a range");
  assert.equal(edges.get("Six après la dernière.").written, null);
  // The widest range is `rangeMonthsMax` calendar months (12 by default), counted between the two dates' months.
  const between = (from, to, options = {}) => metaByText(build3([page(`${from}\n\nUn.`, 1), page("Deux.", 2), page("Trois.", 3), page("Entre.", 4), page(`${to}\n\nFin.`, 5)], options)).get("Entre.").written;
  assert.equal(between("3 mars 2019", "3 mars 2020").to, "2020-03-03", "twelve months is allowed");
  assert.equal(between("3 mars 2019", "3 avril 2020"), null, "thirteen is not");
  assert.equal(between("3 mars 2019", "3 mars 2021"), null);
  assert.equal(between("3 mars 2019", "3 avril 2020", { rangeMonthsMax: 13 }).to, "2020-04-03");
  assert.equal(between("3 mars 2019", "20 mars 2019").to, "2019-03-20", "within a month");
  assert.equal(between("3 mars 2019", "3 mai 2019", { rangeMonthsMax: 1 }), null);
  assert.equal(between("3 mars 2019", "3 avril 2019", { rangeMonthsMax: 1 }).to, "2019-04-03");
  const wide = build3([page("3 mars 2019\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Entre.", 4), page("3 mars 2025\n\nFin.", 5)], { rangeMonthsMax: 120 });
  assert.equal(wide.stats.ranged_quotes, 1);
  assert.deepEqual(wide.stats.range_widths, { up_to_1_month: 0, up_to_3_months: 0, up_to_12_months: 0, over_12_months: 1 });
  assert.equal(wide.quoteMonths.get(QUOTE_MONTHS_KEY).length, 6 * 12 + 1);
  for (const rangeMonthsMax of [0, -1, 1.5, 121, "12", null]) {
    assert.throws(() => build3([page("3 mars 2020\n\nUn.", 1)], { rangeMonthsMax }), { code: "QUOTE_DATE_OPTIONS_INVALID" });
  }
  // The widths are counted by class, each range in the narrowest that fits (a month, three, twelve): the quote past the carry limit of one
  // date line, and the next after it, are in the range to the next date line.
  const classes = build3([page("1 janvier 2020\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Quatre, un mois.", 4), page("1 février 2020\n\nDeux.", 5),
    page("Cinq.", 6), page("Six.", 7), page("Sept.", 8), page("Huit, trois mois.", 9), page("1 mai 2020\n\nTrois.", 10),
    page("Onze.", 11), page("Douze.", 12), page("Treize.", 13), page("Quatorze, un an.", 14), page("1 mai 2021\n\nFin.", 15)]);
  assert.deepEqual(classes.stats.range_widths, { up_to_1_month: 1, up_to_3_months: 2, up_to_12_months: 2 });
  assert.equal(classes.stats.ranged_quotes, 5);
});

// The quote "Entre." past the carry limit of the date line `from`, before the date line `to`: its date, the months it is listed
// under, and the build's counts.
function rangedBetween(from, to, dateOptions = {}) {
  const built = build3([page(`${from}\n\nUn.`, 1), page("Deux.", 2), page("Trois.", 3), page("Entre.", 4), page(`${to}\n\nFin.`, 5)], dateOptions);
  const id = built.graph.nodes.find((node) => node.kind === "passage" && node.data.quote === "Entre.").id;
  const months = [...built.quoteMonths.entries()].filter(([key, ids]) => key !== QUOTE_MONTHS_KEY && ids.includes(id)).map(([key]) => key);
  return { written: built.quoteMeta.get(id)[0].written, months, stats: built.stats };
}

test("a later date that gives only a month or a year ends a range at the end of that month or year", () => {
  const month = rangedBetween("3 janvier 2019", "Mars 2019");
  assert.deepEqual([month.written.from, month.written.to, month.written.precision, month.written.between], ["2019-01-03", "2019-03", "interval", true],
    "to is the month, as on any date that gives a month: the end of March");
  assert.deepEqual(month.months, ["2019-01", "2019-02", "2019-03"]);
  assert.deepEqual(month.stats.range_widths, { up_to_1_month: 0, up_to_3_months: 1, up_to_12_months: 0 });
  // A year on a line of its own, at the turn of a year: the quote before it may be from any day up to the end of that year.
  const year = rangedBetween("28 décembre 2018", "2019");
  assert.deepEqual([year.written.from, year.written.to, year.written.between], ["2018-12-28", "2019", true]);
  assert.deepEqual(year.months, ["2018-12", ...Array.from({ length: 12 }, (_, index) => `2019-${String(index + 1).padStart(2, "0")}`)],
    "every month to December, so a time window anywhere in the year finds it");
  assert.deepEqual(year.stats.range_widths, { up_to_1_month: 0, up_to_3_months: 0, up_to_12_months: 1 });
  // The limit counts to the month the later date ends in: March 2018 to December 2019 is 21 months on.
  assert.equal(rangedBetween("3 mars 2018", "2019").written, null);
  assert.equal(rangedBetween("3 mars 2018", "2019", { rangeMonthsMax: 20 }).written, null);
  assert.equal(rangedBetween("3 mars 2018", "2019", { rangeMonthsMax: 21 }).written.to, "2019");
  // An earlier date that gives only a year starts the range on its first day.
  const fromYear = rangedBetween("2019", "3 mars 2019");
  assert.deepEqual([fromYear.written.from, fromYear.written.to], ["2019", "2019-03-03"]);
  assert.deepEqual(fromYear.months, ["2019-01", "2019-02", "2019-03"]);
});

test("a time window anywhere in the year a range ends in finds the quote, and none after that year or before its first day does", async (t) => {
  const pages = [page("28 décembre 2018\n\nLe lac en hiver.", 1), page("Deux.", 2), page("Trois.", 3), page("Le lac encore, avant l'année.", 4), page("2019\n\nFin.", 5)];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-year-ranges-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const built = build3(pages);
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: Object.fromEntries(pages.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_terms: buildQuoteTermsFromGraph(built.graph) }, indexRepresentations: true });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: V3_GENERATION, visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  try {
    const range = "Le lac encore, avant l'année.";
    const finds = async (from, to) => (await reader.findQuotes({ query: "lac", from, to, includeUndated: false })).quotes.some(({ text }) => text === range);
    assert.equal(await finds("2019-06", "2019-06"), true, "a month inside the year");
    assert.equal(await finds("2019-12-31", null), true, "the year's last day");
    assert.equal(await finds("2018-12-28", "2018-12-28"), true, "the first day");
    assert.equal(await finds("2020-01", null), false, "after the year");
    assert.equal(await finds(null, "2018-12-27"), false, "before the first day");
    const [found] = (await reader.findQuotes({ query: "avant" })).quotes;
    assert.deepEqual(found.written, { from: "2018-12-28", to: "2019", precision: "interval", date_line: "28 décembre 2018", between: true, date_line_after: "2019" });
  } finally { reader.close(); }
});

test("a time window finds a ranged quote by overlap, shows it as a range, and keeps it when undated quotes are left out", async (t) => {
  const pages = [page("3 mars 2020\n\nUne entrée du printemps.", 1), page("Au bord du lac.", 2), page("Le lac gelé.", 3), page("Le lac encore calme, un jour du printemps.", 4),
    page("10 mai 2020\n\nLe lac en fleurs.", 5), page("Un matin du lac, après tout.", 9)];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-ranges-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const built = build3(pages);
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: Object.fromEntries(pages.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_terms: buildQuoteTermsFromGraph(built.graph) }, indexRepresentations: true });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: V3_GENERATION, visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  try {
    const texts = async (from, to, includeUndated = false) => (await reader.findQuotes({ query: "lac", from, to, includeUndated })).quotes.map(({ text }) => text).sort();
    const range = "Le lac encore calme, un jour du printemps.";
    assert.deepEqual(await texts("2020-04", "2020-04"), [range], "a month inside the range");
    assert.ok((await texts("2020-03", "2020-03")).includes(range), "the first month overlaps");
    assert.ok((await texts("2020-05", "2020-05")).includes(range), "the last month overlaps");
    assert.ok((await texts("2020-05-11", "2020-05-20")).includes(range) === false, "after the later date's day");
    assert.ok((await texts("2020-04-15", "2020-04-16")).includes(range), "a day inside the range");
    assert.equal((await texts("2020-06", "2020-06")).includes(range), false);
    assert.equal((await texts("2020-02", "2020-02")).includes(range), false);
    assert.equal((await texts("2021", "2021")).includes(range), false);
    assert.ok((await texts(null, "2020-03-02")).includes(range) === false);
    assert.ok((await texts("2020-04", null)).includes(range));
    // It is shown as a range: both lines, a precision of interval, and no single day.
    const [found] = (await reader.findQuotes({ query: "calme" })).quotes;
    assert.equal(found.text, range);
    assert.deepEqual(found.written, { from: "2020-03-03", to: "2020-05-10", precision: "interval", date_line: "3 mars 2020", between: true, date_line_after: "10 mai 2020" });
    const day = (await reader.findQuotes({ query: "fleurs" })).quotes[0];
    assert.deepEqual(day.written, { from: "2020-05-10", to: "2020-05-10", precision: "day", date_line: "10 mai 2020" }, "an ordinary date has no between");
    // The stretch after the last date is undated.
    assert.equal((await reader.findQuotes({ query: "matin" })).quotes[0].written, null);
    // The byte budget counts both lines shown with a range.
    const size = Buffer.byteLength(range) + Buffer.byteLength("3 mars 2020") + Buffer.byteLength("10 mai 2020");
    const tight = await reader.findQuotes({ query: "calme lac", byteBudget: 1000, limit: 40 });
    assert.ok(tight.quotes.length >= 1 && size < 1000);
  } finally { reader.close(); }
});

async function persistedQuotes(t, { quoteIndexes = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-index-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes", key = randomBytes(32), cursorSecret = randomBytes(32);
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: key });
  const sources = Object.fromEntries(representations.map((item) => [item.representation_id, item.text]));
  let persisted;
  if (quoteIndexes) {
    const built = buildQuoteGeneration({ caseId, corpusId, generation: "quote-generation", originalObjectId: "original:test", mediaType: "application/pdf", representations });
    persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"],
      shardTargetBytes: 4096, extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths }, indexRepresentations: true });
  } else {
    // A generation without the quote indexes: whole partition units as passages, as the raw search index has.
    const nodes = [], edges = [];
    for (const item of representations) {
      const units = partitionRepresentation({ representationId: item.representation_id, text: item.text });
      const graph = adaptExtractionToGraph({ caseId, corpusId, generation: "raw-generation",
        source: { id: `source:${sha256(item.representation_id).slice(0, 32)}`, representation_id: item.representation_id, original_object_id: "original:test",
          media_type: "application/pdf", byte_length: Buffer.byteLength(item.text), parse_status: "readable", page: item.page_number },
        units, extraction: { schema_version: "1.0", status: "incomplete", assertions: [], entities: [], episodes: [],
          coverage: units.map((unit) => ({ unit_id: unit.unit_id, disposition: "pending", assertion_local_ids: [], reason: "test" })), requested_context: [] } });
      nodes.push(...graph.nodes); edges.push(...graph.edges);
    }
    persisted = await persistGraphGeneration({ corpusStore: store, graph: { schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation: "raw-generation", nodes, edges },
      sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096 });
  }
  const open = () => openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: persisted.manifest.generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret });
  const objects = (await fs.readdir(path.join(root, ".journal-corpora"), { recursive: true })).filter((name) => name.endsWith(".journal-object.json")).length;
  // A second generation in the same corpus, read with the same cursor secret.
  const openGeneration = async (generation) => {
    const built = buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId: "original:test", mediaType: "application/pdf", representations });
    const second = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"],
      shardTargetBytes: 4096, extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths }, indexRepresentations: true });
    return openPrivateJournalGraph({ corpusStore: store, manifestObjectId: second.manifest_object_id, caseId, corpusId,
      generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret });
  };
  return { open, objects, openGeneration };
}

test("find quotes ranks the person's exact words by rare words first and pages without overlap", async (t) => {
  const { open, objects } = await persistedQuotes(t);
  const reader = await open();
  try {
    const dream = await reader.findQuotes({ query: "what did I write about Mara and the dreamt house" });
    const [top] = dream.quotes;
    assert.match(top.text, /^I dreamt that Mara left the house\./u);
    assert.deepEqual(top.written, { from: "2019-03-03", to: "2019-03-03", precision: "day", date_line: "March 3, 2019" });
    assert.ok(top.cues.some(({ kind }) => kind === "dream"));
    assert.ok(top.cues.some(({ kind }) => kind === "negation"));
    assert.equal(top.page, 1);
    assert.deepEqual([...dream.coverage.terms_ignored].sort(), ["about", "and", "did", "i", "the", "what"].sort());
    assert.equal(dream.coverage.full_archive_loaded, false);
    assert.ok(dream.coverage.encrypted_objects_read < objects, "a search reads part of the index, not all of it");
    // Every quote is the exact source text.
    for (const quote of dream.quotes) assert.ok(PAGES.some((page) => page.includes(quote.text)));

    // Either word finds a quote; the rarer word ranks first.
    const either = await reader.findQuotes({ query: "Mara cardamom" });
    assert.match(either.quotes[0].text, /cardamom/u);
    assert.ok(either.quotes.some(({ text }) => text.startsWith("Mara said")));
    assert.ok(either.quotes.some(({ text }) => text.startsWith("I dreamt")));

    // Pages from the cursor concatenate to the whole ranking, each quote once.
    const query = "Mara cardamom running harbour sentence";
    const whole = await reader.findQuotes({ query, limit: 40, byteBudget: 48_000 });
    assert.equal(whole.more_available, false);
    assert.equal(whole.next_cursor, null);
    const paged = [];
    let cursor = null;
    do {
      const page = await reader.findQuotes({ query, limit: 1, cursor });
      assert.equal(page.quotes.length, 1);
      paged.push(page.quotes[0].quote_id);
      cursor = page.next_cursor;
      assert.equal(page.more_available, cursor !== null);
    } while (cursor);
    assert.deepEqual(paged, whole.quotes.map(({ quote_id: id }) => id));
    assert.equal(new Set(paged).size, paged.length);
    // A cursor belongs to its query and filters.
    const first = await reader.findQuotes({ query, limit: 1 });
    await assert.rejects(reader.findQuotes({ query: "cardamom", cursor: first.next_cursor }), { code: "CURSOR_QUERY_MISMATCH" });
    await assert.rejects(reader.findQuotes({ query, from: "2019", cursor: first.next_cursor }), { code: "CURSOR_QUERY_MISMATCH" });
    await assert.rejects(reader.findQuotes({ query, cursor: "not-a-cursor" }), { code: "CURSOR_INVALID" });

    // A small byte budget still returns one quote, and the next page starts with the quote that didn't fit.
    const budget = await reader.findQuotes({ query: "harbour", byteBudget: 1000 });
    assert.equal(budget.quotes.length, 1);
    assert.equal(budget.more_available, true);
    const afterBudget = await reader.findQuotes({ query: "harbour", byteBudget: 1000, cursor: budget.next_cursor });
    const harbour = await reader.findQuotes({ query: "harbour", byteBudget: 48_000 });
    assert.equal(afterBudget.quotes[0].quote_id, harbour.quotes[1].quote_id);

    // A query of only common words still searches by them.
    const common = await reader.findQuotes({ query: "the and of" });
    assert.deepEqual(common.coverage.terms_ranked, ["the", "and", "of"]);
    assert.ok(common.quotes.length > 0);
    assert.equal(common.coverage.ranking, "exact_words", "a generation without a word list matches words exactly");
  } finally { reader.close(); }
});

test("a time window keeps quotes written inside it, and undated ones only when asked", async (t) => {
  const { open } = await persistedQuotes(t);
  const reader = await open();
  try {
    const april = await reader.findQuotes({ query: "Mara garden", from: "2019-04", to: "2019-04" });
    assert.deepEqual(april.quotes.map(({ text }) => text.slice(0, 9)), ["Some unda", "Mara said"], "the rarer word first; undated kept by default");
    assert.ok(april.quotes.every(({ written }) => written === null || written.from === "2019-04-10"));
    const datedOnly = await reader.findQuotes({ query: "Mara garden", from: "2019-04", to: "2019-04", includeUndated: false });
    assert.deepEqual(datedOnly.quotes.map(({ text }) => text.slice(0, 9)), ["Mara said"]);
    const march = await reader.findQuotes({ query: "Mara bakery", from: "2019-03-02", to: "2019-03-04", includeUndated: false });
    assert.deepEqual(march.quotes.map(({ text }) => text.slice(0, 9)).sort(), ["I dreamt ", "The baker"]);
    await assert.rejects(reader.findQuotes({ query: "Mara", from: "March" }), { code: "QUOTE_FILTERS_INVALID" });
    await assert.rejects(reader.findQuotes({ query: "Mara", limit: 41 }), { code: "QUOTE_LIMIT_INVALID" });
    await assert.rejects(reader.findQuotes({ query: "...", limit: 1 }), { code: "SEARCH_QUERY_HAS_NO_TERMS" });
  } finally { reader.close(); }
});

test("a year alone and a year taken from the dates before are searchable by time, and say how precise they are", async (t) => {
  const pages = [
    page("2018\n\nUne année entière au bord du lac, sans date précise.", 1),
    page("28 décembre 2018\n\nLe lac gelé.\n\n2 janvier\n\nLe lac encore gelé.", 2)
  ];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-dates-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const built = buildQuoteGeneration({ caseId, corpusId, generation: "dates-generation", originalObjectId: "original:test", mediaType: "application/pdf", representations: pages });
  assert.deepEqual(built.quoteMonths.get(QUOTE_MONTHS_KEY), ["2018", "2018-12", "2019-01"]);
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: Object.fromEntries(pages.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths }, indexRepresentations: true });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: "dates-generation", visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  try {
    const texts = async (from, to) => (await reader.findQuotes({ query: "lac", from, to, includeUndated: false })).quotes.map(({ text }) => text).sort();
    assert.deepEqual(await texts("2018-04", "2018-04"), ["Une année entière au bord du lac, sans date précise."], "a year overlaps every month in it");
    assert.deepEqual(await texts("2018-12", "2018-12"), ["Le lac gelé.", "Une année entière au bord du lac, sans date précise."]);
    assert.deepEqual(await texts("2019", "2019"), ["Le lac encore gelé."]);
    const all = await reader.findQuotes({ query: "lac" });
    const byText = new Map(all.quotes.map((quote) => [quote.text, quote.written]));
    assert.deepEqual(byText.get("Une année entière au bord du lac, sans date précise."), { from: "2018", to: "2018", precision: "year", date_line: "2018" });
    assert.deepEqual(byText.get("Le lac encore gelé."), { from: "2019-01-02", to: "2019-01-02", precision: "day", date_line: "2 janvier", year_inferred: true });
    assert.deepEqual(byText.get("Le lac gelé."), { from: "2018-12-28", to: "2018-12-28", precision: "day", date_line: "28 décembre 2018" });
  } finally { reader.close(); }
});

test("a quote cursor is refused on a different snapshot", async (t) => {
  const quotes = await persistedQuotes(t);
  const reader = await quotes.open();
  let cursor;
  try { cursor = (await reader.findQuotes({ query: "Mara cardamom", limit: 1 })).next_cursor; } finally { reader.close(); }
  assert.ok(cursor);
  const other = await quotes.openGeneration("quote-generation-2");
  try { await assert.rejects(other.findQuotes({ query: "Mara cardamom", limit: 1, cursor }), { code: "CURSOR_SNAPSHOT_INVALID" }); }
  finally { other.close(); }
});

test("a long text journal stored in chunks is quoted from only the chunks a span touches", async (t) => {
  const boundary = 4 * 1024 * 1024; // the store's chunk size
  const filler = (index) => `Filler paragraph ${String(index).padStart(6, "0")} ${"about the long walk ".repeat(24)}`.slice(0, 500);
  const parts = [];
  let length = 0, index = 0;
  while (length + 502 < boundary - 200) { const piece = filler(index++); parts.push(piece); length += Buffer.byteLength(piece) + 2; }
  const straddle = `Straddleword ${"crosses the chunk boundary ".repeat(36)}`.slice(0, 1000).trim();
  parts.push(straddle);
  for (let more = 0; more < 400; more += 1) parts.push(filler(index++));
  parts.push("The very end holds the tailword.");
  const text = parts.join("\n\n");
  const start = Buffer.byteLength(text.slice(0, text.indexOf("Straddleword")));
  assert.ok(start < boundary && start + Buffer.byteLength(straddle) > boundary, "the test paragraph crosses the chunk boundary");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-chunked-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const representations = [{ representation_id: "text:whole", text, page_number: null, parse_status: "readable" }];
  const built = buildQuoteGeneration({ caseId, corpusId, generation: "chunked-generation", originalObjectId: "original:test", mediaType: "text/plain", representations });
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: { "text:whole": text },
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 128 * 1024,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths }, indexRepresentations: true });
  // Count how the reader opens the long representation: chunk by chunk, never whole.
  const representation = persisted.manifest.source_representation_objects["text:whole"];
  assert.equal(representation.encoding, "utf8_chunks");
  const chunkReads = [];
  let wholeReads = 0;
  const counted = {
    ...store,
    readObject: async (input) => { if (input.objectId === representation.object_id) chunkReads.push(input.chunkIndex); return store.readObject(input); },
    reassembleOriginal: async (descriptor) => { if (descriptor.object_id === representation.object_id) wholeReads += 1; return store.reassembleOriginal(descriptor); }
  };
  const open = () => openPrivateJournalGraph({ corpusStore: counted, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: "chunked-generation", visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  let reader = await open();
  try {
    const tail = await reader.findQuotes({ query: "tailword" });
    assert.equal(tail.quotes[0].text, "The very end holds the tailword.");
    assert.deepEqual(chunkReads, [1], "only the last chunk");
  } finally { reader.close(); }
  reader = await open();
  try {
    const crossing = await reader.findQuotes({ query: "straddleword" });
    assert.equal(crossing.quotes[0].text, straddle);
    assert.deepEqual(chunkReads, [1, 0, 1], "both chunks the paragraph crosses");
  } finally { reader.close(); }
  assert.equal(wholeReads, 0, "the whole journal is never reassembled for a quote");
});

test("find quotes also works on a generation without the quote indexes", async (t) => {
  const { open } = await persistedQuotes(t, { quoteIndexes: false });
  const reader = await open();
  try {
    const found = await reader.findQuotes({ query: "cardamom" });
    assert.equal(found.quotes.length, 1);
    assert.equal(found.quotes[0].text, PAGES[1], "a whole partition unit, exactly");
    assert.equal(found.quotes[0].written, null);
    assert.equal(found.coverage.quote_index, false);
    const windowed = await reader.findQuotes({ query: "cardamom", from: "2019", to: "2019", includeUndated: false });
    assert.equal(windowed.quotes.length, 0);
  } finally { reader.close(); }
});

const CASE_ID = "quote-case";
const WRITER = "quote-operator-token";
const READER = "quote-reader-token";

async function runtimeEnvironment(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-runtime-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  const text = PAGES.join("\n");
  await fs.writeFile(path.join(root, "private", "source.txt"), text, { mode: 0o600 });
  const credentialsPath = path.join(root, "credentials.json");
  await fs.writeFile(credentialsPath, `${JSON.stringify({ schema_version: 1, root_dir: path.join(root, "vaults"), grants: [
    { token_sha256: sha256(WRITER), principal_id: "journal-operator", case_ids: [CASE_ID], scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] },
    { token_sha256: sha256(READER), principal_id: "test-reader", case_ids: [CASE_ID], scopes: ["case:read"], purposes: ["organize_search", "session_use"] }
  ], case_keys: { [CASE_ID]: { routine_kek_base64: Buffer.alloc(32, 7).toString("base64"), recovery_secret_base64: Buffer.alloc(32, 9).toString("base64") } } })}\n`, { mode: 0o600 });
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  await service.appendJournal(CASE_ID, { id: "legacy-quote", observed_at: "2026-01-01T00:00:00.000Z", kind: "journal", text: "Invented legacy entry" }, { bearerToken: WRITER });
  const config = { schema_version: 1, max_external_spend_usd: 0, execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(text), sha256: sha256(text) },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:grant" };
  const configPath = path.join(root, "private", "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const sourceParser = async () => ({
    source: { sha256: config.source.sha256, byte_length: config.source.bytes, mime_type: "text/plain" }, parser: { version: "synthetic-quotes" },
    pages: PAGES.map((_, index) => ({ page_number: index + 1, representation_id: `synthetic:page:${index}`, disposition: "readable", warnings: [], image_inventory: [] })),
    representations: PAGES.map((page, index) => ({ representation_id: `synthetic:page:${index}`, text: page, utf8_byte_length: Buffer.byteLength(page) }))
  });
  const open = () => openJournalExecutionRuntime({ config, configPath, service, inferencePort: createMockJournalInferencePort({ handlers: {} }),
    sourceParser, environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER } });
  return { open, service, config, stateFile: path.join(config.execution_root, "state.json") };
}

// The reference of the case's quote corpus (its active and previous generations), as a reader sees it.
async function quoteCorpusReference(service) {
  const reader = { bearerToken: READER };
  const record = await service.loadPrivateRuntimeCase(CASE_ID, reader);
  const { corpus_id: corpusId } = record.journal_corpora.find((item) => item.corpus_id.endsWith(":quotes"));
  return (await service.getJournalCorpus(CASE_ID, corpusId, reader)).reference;
}

test("build-quotes stages the quote corpus and publish-quotes publishes it beside the untouched import corpus", async (t) => {
  const f = await runtimeEnvironment(t);
  let runtime = await f.open();
  try {
    await assert.rejects(runtime.execute("build-quotes"), { code: "JOURNAL_SOURCE_NOT_STAGED" });
    await runtime.execute("stage");
    const built = await runtime.execute("build-quotes");
    assert.equal(built.quote_index.pages, 3);
    assert.ok(built.quote_index.quotes >= 8);
    assert.equal(built.quote_index.date_lines, 3);
    assert.deepEqual(built.quote_index.date_order, { steps: 2, backward: 0, largest_backward_days: 0 }, "a build counts the order of the dates");
    assert.equal(built.quote_index.time_order.misread_lines, 0, "the dates run forward");
    assert.equal(built.quote_index.time_order.anchors, 3);
    assert.equal(built.quote_index.time_order.undated_quotes, 0, "version 4 dates every quote of a journal with a date");
    assert.equal(built.quote_index.ranged_quotes, built.quote_index.time_order.ranged_quotes);
    assert.equal(built.quote_index.published_at, null);
    assert.match(built.quote_index.corpus_id, /^corpus:[0-9a-f-]+:quotes$/u);
    // The run state names the quote manifest; the manifest itself stays in the store.
    const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
    assert.match(state.quote_index.manifest_object_id, /^graph:[0-9a-f]+:manifest$/u);
    assert.equal(state.quote_index.persisted, undefined);
    assert.equal(JSON.stringify(state.quote_index).includes("record_shards"), false);
    // Nothing is visible to InnerSignal before publication.
    const context = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
    assert.equal(context.journal_corpora?.length ?? 0, 0);
    const published = await runtime.execute("publish-quotes");
    assert.notEqual(published.quote_index.published_at, null);
    assert.equal(published.calibration, built.calibration, "the import's own run is unchanged");
    assert.equal(published.completion.profile_committed, "not_run");
  } finally { await runtime.close(); }
  const record = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  const corpora = record.journal_corpora.filter((item) => item.active_generation != null);
  assert.equal(corpora.length, 1, "only the quote corpus is active");
  assert.match(corpora[0].corpus_id, /:quotes$/u);
  assert.match(corpora[0].active_generation, /:quotes:quote-index-v4-month-first$/u);
  // The published quote corpus carries the archived original its locators name.
  await f.service.withJournalCorpus(CASE_ID, corpora[0].corpus_id, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore, reference }) => {
    const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
    assert.equal(manifest.archive_references.length, 1);
    assert.ok(Array.isArray(manifest.indexes.quote_terms), "a version 3 generation lists its word list");
    const original = await corpusStore.reassembleOriginal(manifest.archive_references[0]);
    try { assert.equal(original.toString("utf8"), PAGES.join("\n")); } finally { original.fill(0); }
  }, { bearerToken: WRITER });

  // A reader finds the person's words through the connector's API and through the MCP tool.
  const api = createJournalPrivateApi({ caseAccessService: f.service });
  const found = await api.findQuotes({ caseId: CASE_ID, corpusId: corpora[0].corpus_id, query: "Mara dreamt", purpose: "session_use" }, { bearerToken: READER });
  assert.match(found.quotes[0].text, /^I dreamt that Mara/u);
  assert.equal(found.quotes[0].written.date_line, "March 3, 2019");
  assert.equal(found.snapshot.generation, corpora[0].active_generation);
  const listener = await listenPrivateCaseMcp({ caseAccessService: f.service, journalApi: api });
  t.after(() => listener.close());
  const call = (body) => fetch(listener.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${READER}` }, body: JSON.stringify(body) })
    .then((response) => response.json());
  const listed = await call({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const tool = listed.result.tools.find(({ name }) => name === "find_journal_quotes");
  assert.ok(tool && tool.annotations.readOnlyHint === true && tool.annotations.destructiveHint === false);
  assert.match(tool.description, /never as something that happened/u);
  // The tool says how words match, and the result says which way it ranked: the published generation is version 3.
  assert.match(tool.description, /coverage\.ranking says how: "word_forms" matches a word in its other forms/u);
  assert.match(tool.inputSchema.properties.query.description, /"word_forms" a word's regular forms and accents match on their own/u);
  assert.doesNotMatch(tool.inputSchema.properties.query.description, /^Words the quotes should contain: names, places, topics, feelings\. Words match exactly/u);
  const called = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_journal_quotes",
    arguments: { case_id: CASE_ID, corpus_id: corpora[0].corpus_id, query: "Mara cardamom", from: "2019-04", to: "2019-04", include_undated: false, purpose: "session_use" } } });
  assert.equal(called.result.isError, false);
  assert.deepEqual(called.result.structuredContent.quotes.map(({ text }) => text.slice(0, 9)), ["Mara said"]);
  assert.equal(called.result.structuredContent.coverage.ranking, "word_forms");

  // Publishing again is a no-op for the same quote generation.
  runtime = await f.open();
  try { await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const again = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  assert.deepEqual(again.journal_corpora.filter((item) => item.active_generation != null).map((item) => item.active_generation), [corpora[0].active_generation]);
});

test("a quote index built another way replaces exactly the one published before it, and a reply paging the old one isn't cut off", async (t) => {
  const f = await runtimeEnvironment(t);
  const reader = { bearerToken: READER };
  const quoteCorpus = () => quoteCorpusReference(f.service);
  let runtime = await f.open();
  try { await runtime.execute("stage"); await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const first = await quoteCorpus();
  assert.match(first.active_generation, /:quotes:quote-index-v4-month-first$/u);
  const api = createJournalPrivateApi({ caseAccessService: f.service });
  const query = { caseId: CASE_ID, corpusId: first.corpus_id, query: "Mara cardamom running", limit: 1, purpose: "session_use" };
  const oldPage = await api.findQuotes(query, reader);
  assert.ok(oldPage.next_cursor);

  // An invalid setting is refused before anything runs.
  f.config.quote_numeric_date_order = "dmy";
  await assert.rejects(f.open(), { code: "JOURNAL_QUOTE_NUMERIC_DATE_ORDER_INVALID" });

  // The owner writes day first: the changed setting builds a new generation, which records the one it replaces.
  f.config.quote_numeric_date_order = "day_first";
  runtime = await f.open();
  let built;
  try { built = await runtime.execute("build-quotes"); } finally { await runtime.close(); }
  assert.match(built.quote_index.generation, /:quotes:quote-index-v4-day-first$/u);
  assert.equal(built.quote_index.supersedes, first.active_generation);
  assert.equal(built.quote_index.numeric_date_order, "day_first");
  assert.equal(built.quote_index.published_at, null);
  assert.equal((await quoteCorpus()).active_generation, first.active_generation, "readers see no change before publication");

  // Publication replaces only the generation recorded: one published by anyone else in the meantime stays.
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  await fs.writeFile(f.stateFile, JSON.stringify({ ...state, quote_index: { ...state.quote_index, supersedes: "generation:published-elsewhere" } }));
  runtime = await f.open();
  try { await assert.rejects(runtime.execute("publish-quotes"), { code: "JOURNAL_PUBLICATION_GENERATION_CONFLICT" }); } finally { await runtime.close(); }
  assert.equal((await quoteCorpus()).active_generation, first.active_generation);
  await fs.writeFile(f.stateFile, JSON.stringify(state));
  runtime = await f.open();
  let published;
  try { published = await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  assert.notEqual(published.quote_index.published_at, null);
  const second = await quoteCorpus();
  assert.equal(second.active_generation, built.quote_index.generation);
  assert.deepEqual(second.previous_generations.at(-1), { generation: first.active_generation, manifest_object_id: first.manifest_object_id });

  // A reply already paging the old generation finishes on it; a new search reads the new one.
  const next = await api.findQuotes({ ...query, cursor: oldPage.next_cursor }, reader);
  assert.equal(next.snapshot.generation, first.active_generation);
  assert.notEqual(next.quotes[0].quote_id, oldPage.quotes[0].quote_id);
  const fresh = await api.findQuotes({ ...query, query: "Mara dreamt", limit: 5 }, reader);
  assert.equal(fresh.snapshot.generation, second.active_generation);
  assert.match(fresh.quotes[0].text, /^I dreamt that Mara/u);
  await assert.rejects(api.findQuotes({ ...query, query: "Mara dreamt", cursor: oldPage.next_cursor }, reader), { code: "CURSOR_QUERY_MISMATCH" });

  // Building again with the same setting changes nothing.
  runtime = await f.open();
  try { assert.equal((await runtime.execute("build-quotes")).quote_index.built_at, published.quote_index.built_at); } finally { await runtime.close(); }
});

test("a setting changed and changed back before publishing returns to the published generation, which replaces nothing", async (t) => {
  const f = await runtimeEnvironment(t);
  let runtime = await f.open();
  try { await runtime.execute("stage"); await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const first = await quoteCorpusReference(f.service);
  f.config.quote_numeric_date_order = "day_first";
  runtime = await f.open();
  try { assert.equal((await runtime.execute("build-quotes")).quote_index.supersedes, first.active_generation); } finally { await runtime.close(); }
  f.config.quote_numeric_date_order = "month_first";
  runtime = await f.open();
  try {
    const back = await runtime.execute("build-quotes");
    assert.equal(back.quote_index.generation, first.active_generation);
    assert.equal(back.quote_index.supersedes, null);
    assert.notEqual((await runtime.execute("publish-quotes")).quote_index.published_at, null);
  } finally { await runtime.close(); }
  const after = await quoteCorpusReference(f.service);
  assert.equal(after.active_generation, first.active_generation);
  assert.equal(after.manifest_object_id, first.manifest_object_id);
  assert.deepEqual(after.previous_generations, first.previous_generations, "nothing was replaced");
});

test("switching the setting back and forth before publishing still replaces the generation the case reads", async (t) => {
  const f = await runtimeEnvironment(t);
  let runtime = await f.open();
  try { await runtime.execute("stage"); await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const first = await quoteCorpusReference(f.service);
  // A run state written before the published generation was kept on its own names it only in its build record.
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  assert.equal(state.quote_published.generation, first.active_generation);
  delete state.quote_published;
  await fs.writeFile(f.stateFile, JSON.stringify(state));
  const build = async (order) => {
    f.config.quote_numeric_date_order = order;
    runtime = await f.open();
    try { return (await runtime.execute("build-quotes")).quote_index; } finally { await runtime.close(); }
  };
  const dayFirst = await build("day_first");
  assert.equal(dayFirst.supersedes, first.active_generation);
  assert.equal((await build("month_first")).supersedes, null);
  const again = await build("day_first");
  assert.equal(again.generation, dayFirst.generation);
  assert.equal(again.supersedes, first.active_generation, "the published generation isn't lost between builds");
  runtime = await f.open();
  try { await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const after = await quoteCorpusReference(f.service);
  assert.equal(after.active_generation, dayFirst.generation);
  assert.deepEqual(after.previous_generations.at(-1), { generation: first.active_generation, manifest_object_id: first.manifest_object_id });
});

test("a run state from before the published record, caught between builds, still knows the generation the case reads", async (t) => {
  const f = await runtimeEnvironment(t);
  let runtime = await f.open();
  try { await runtime.execute("stage"); await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const first = await quoteCorpusReference(f.service);
  const build = async (order) => {
    f.config.quote_numeric_date_order = order;
    runtime = await f.open();
    try { return (await runtime.execute("build-quotes")).quote_index; } finally { await runtime.close(); }
  };
  const dayFirst = await build("day_first");
  // Its latest build is unpublished, and names the generation the case reads only as the one it replaces.
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  assert.equal(state.quote_index.supersedes, first.active_generation);
  delete state.quote_published;
  await fs.writeFile(f.stateFile, JSON.stringify(state));
  assert.equal((await build("month_first")).supersedes, null);
  assert.equal((await build("day_first")).supersedes, first.active_generation);
  runtime = await f.open();
  try { await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  assert.equal((await quoteCorpusReference(f.service)).active_generation, dayFirst.generation);
});

// Version 4: the dates by the journal's order (the owner, 17 Oct 2026: the journal "was written in time order").
const V4_GENERATION = "dates-generation:quotes:quote-index-v4-month-first";
const build4 = (pages, dateOptions = {}, unitOptions = {}) => buildQuoteGeneration({ caseId: "quote-case", corpusId: "quote-corpus:quotes",
  generation: V4_GENERATION, originalObjectId: "original:test", mediaType: "application/pdf", representations: pages, dateOptions, unitOptions, version: 4 });
const quoteId = (built, text) => built.graph.nodes.find((node) => node.kind === "passage" && node.data.quote === text).id;

test("version 4 gives a quote between two dates their range however wide, and across a page that wasn't fully read", () => {
  const pages = [page("3 mars 2019\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Loin.", 4), page("Mots autour d'un dessin.", 5, "visual_pending"),
    page("Après le dessin.", 6), page("3 mars 2021\n\nFin.", 7)];
  const built = build4(pages);
  const meta = metaByText(built);
  const first = meta.get("Un.").written, last = meta.get("Fin.").written;
  assert.equal(meta.get("Trois.").written.from, "2019-03-03", "a carried date stays a date");
  assert.equal(meta.get("Trois.").written.between, undefined);
  for (const text of ["Loin.", "Mots autour d'un dessin.", "Après le dessin."]) {
    assert.deepEqual(meta.get(text).written, { from: "2019-03-03", to: "2021-03-03", precision: "interval", between: true, ambiguous: false,
      year_inferred: false, line: lineOf(first), line_after: lineOf(last) }, text);
  }
  // Wider than twelve months (`rangeMonthsMax`), the range is listed apart with its bounds, not under each of its 25 months.
  assert.deepEqual(built.quoteMonths.get(QUOTE_WIDE_KEY), ["Loin.", "Mots autour d'un dessin.", "Après le dessin."]
    .map((text) => [quoteId(built, text), "2019-03-03", "2021-03-03"]).sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(built.quoteMonths.get(QUOTE_MONTHS_KEY), ["2019-03", "2021-03"], "the dated quotes' months only");
  assert.equal(built.quoteMonths.has("2020-06"), false);
  // Within twelve months it is listed under every month it covers, as in version 3.
  const near = build4([page("3 mars 2020\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Proche.", 4), page("3 juin 2020\n\nFin.", 5)]);
  assert.deepEqual(["2020-03", "2020-04", "2020-05", "2020-06"].map((month) => near.quoteMonths.get(month).includes(quoteId(near, "Proche."))), [true, true, true, true]);
  assert.equal(near.quoteMonths.has(QUOTE_WIDE_KEY), false);
  assert.deepEqual(built.stats.range_widths, { up_to_1_month: 0, up_to_3_months: 0, up_to_12_months: 0, over_12_months: 3 });
  assert.deepEqual(built.stats.time_order, { yearless_dated: 0, yearless_undated: 0, misread_lines: 0, anchors: 2, dated_quotes: 6, ranged_quotes: 3,
    open_start_quotes: 0, open_end_quotes: 0, undated_quotes: 0 }, "the two date lines are quotes too");
  assert.equal(built.stats.dated_quotes, 6);
  assert.equal(built.stats.ranged_quotes, 3);
  // Version 3 leaves them undated: the range is wider than twelve months, and a page between wasn't fully read.
  const v3 = metaByText(build3(pages));
  for (const text of ["Loin.", "Mots autour d'un dessin.", "Après le dessin."]) assert.equal(v3.get(text).written, null, text);
});

test("version 4 takes a date line that breaks the journal's order as misread: it dates nothing, and its quotes get the range around it", () => {
  const pages = [page("3 mars 2020\n\nUn.", 1), page("Deux.", 2), page("1925\n\nLu comme une date.", 3), page("Après.", 4), page("Encore.", 5),
    page("10 mai 2020\n\nFin.", 6)];
  const built = build4(pages);
  const meta = metaByText(built);
  assert.equal(built.stats.date_order.backward, 1, "the step to 1925 goes back");
  assert.deepEqual([built.stats.time_order.misread_lines, built.stats.time_order.anchors], [1, 2]);
  for (const text of ["1925", "Lu comme une date.", "Après.", "Encore."]) {
    const { from, to, between, line_after: after } = meta.get(text).written;
    assert.deepEqual([from, to, between, after.sha256], ["2020-03-03", "2020-05-10", true, sha256("10 mai 2020")], text);
  }
  assert.equal(meta.get("Deux.").written.from, "2020-03-03");
  // Version 3 dates the misread line's quotes 1925.
  const v3 = metaByText(build3(pages));
  assert.equal(v3.get("Lu comme une date.").written.from, "1925");
  assert.equal(v3.get("Encore.").written.from, "1925");
  // A year alone gives way before a full date: a year read too late in the journal is dropped, not the two dates around it.
  const late = build4([page("3 mars 2020\n\nUn.", 1), page("2045\n\nDeux.", 2), page("10 mai 2020\n\nFin.", 3)]);
  assert.deepEqual([late.stats.time_order.misread_lines, late.stats.time_order.anchors], [1, 2]);
  assert.deepEqual(metaByText(late).get("Deux.").written.to, "2020-05-10");
  // Of two full dates that disagree, the run with more of the journal's dates wins.
  const dates = build4([page("3 mars 2020\n\nUn.", 1), page("4 mars 2020\n\nDeux.", 2), page("1 janvier 2020\n\nTrois.", 3), page("5 mars 2020\n\nQuatre.", 4)]);
  assert.equal(metaByText(dates).get("Trois.").written.between, true, "1 January after 4 March is the odd one out");
  assert.deepEqual([metaByText(dates).get("Trois.").written.from, metaByText(dates).get("Trois.").written.to], ["2020-03-04", "2020-03-05"]);
});

test("version 4 gives a date without a year the year that keeps the journal's order, and says so", () => {
  // Before any year: 15 March can't come after 2 February 2020 in a journal that runs forward, so it is 15 March 2019.
  const start = build4([page("15 mars\n\nUn.", 1), page("Deux.", 2), page("2 février 2020\n\nFin.", 3)]);
  const meta = metaByText(start);
  assert.deepEqual(meta.get("Un.").written, { from: "2019-03-15", to: "2019-03-15", precision: "day", ambiguous: false, year_inferred: true,
    line: lineOf(meta.get("15 mars").written) }, "dated, and the year marked as inferred");
  assert.equal(meta.get("Deux.").written.from, "2019-03-15", "carried as any date");
  assert.deepEqual([start.stats.time_order.yearless_dated, start.stats.date_line_kinds.no_year_known], [1, 1]);
  assert.equal(metaByText(build3([page("15 mars\n\nUn.", 1), page("Deux.", 2), page("2 février 2020\n\nFin.", 3)])).get("Un.").written, null, "version 3 leaves it");
  // A chain of them goes back from the dated line: each is the latest day not after the next.
  const chain = metaByText(build4([page("28 décembre\n\nUn.", 1), page("3 janvier\n\nDeux.", 2), page("10 janvier 2021\n\nFin.", 3)]));
  assert.deepEqual([chain.get("Un.").written.from, chain.get("Deux.").written.from], ["2020-12-28", "2021-01-03"]);
  // After a page that wasn't fully read, a date without a year takes the next line's year too.
  const gap = metaByText(build4([page("3 mars 2020\n\nUn.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"), page("20 mars\n\nDeux.", 3),
    page("1 avril 2020\n\nFin.", 4)]));
  assert.equal(gap.get("Deux.").written.from, "2020-03-20");
  // With no dated line after it, it takes the earliest day not before the date before it.
  const none = build4([page("3 mars 2020\n\nUn.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"), page("20 mars\n\nDeux.", 3)]);
  assert.deepEqual([none.stats.time_order.yearless_dated, none.stats.time_order.yearless_undated], [1, 0]);
  assert.deepEqual([metaByText(none).get("Deux.").written.from, metaByText(none).get("Deux.").written.year_inferred], ["2020-03-20", true]);
  // With no date line at all, it can't take a year, and nothing is dated.
  const alone = build4([page("20 mars\n\nDeux.", 1), page("Encore.", 2)]);
  assert.deepEqual([alone.stats.time_order.yearless_undated, alone.stats.time_order.undated_quotes], [1, 3]);
  // A date without a year never takes its year from a line before it that breaks the order (Codex, P1): 1 January 2025
  // between 1 and 10 March 2020 is taken as misread, and 5 March lies between the two March dates.
  const misread = build4([page("1 mars 2020\n\nUn.", 1), page("1 janvier 2025\n\nDeux.", 2), page("5 mars\n\nTrois.", 3), page("10 mars 2020\n\nQuatre.", 4)]);
  const read = metaByText(misread);
  assert.equal(read.get("Trois.").written.from, "2020-03-05");
  assert.equal(read.get("Quatre.").written.from, "2020-03-10", "the date after it stays an anchor");
  assert.deepEqual([read.get("Deux.").written.from, read.get("Deux.").written.to], ["2020-03-01", "2020-03-05"], "the misread line's entry is ranged");
  assert.deepEqual([misread.stats.time_order.anchors, misread.stats.time_order.misread_lines], [3, 1]);
  // Several before the first dated line run back from it, each the latest day not after the one after it (Codex, P2): July
  // 2018, January 2019, July 2019, then June 2020.
  const leading = build4(["15 juillet", "15 janvier", "15 juillet", "1 juin 2020"].map((line, index) => page(`${line}\n\nCitation ${index + 1}.`, index + 1)));
  const led = metaByText(leading);
  assert.deepEqual([1, 2, 3, 4].map((number) => led.get(`Citation ${number}.`).written.from), ["2018-07-15", "2019-01-15", "2019-07-15", "2020-06-01"]);
  assert.deepEqual([leading.stats.time_order.anchors, leading.stats.time_order.misread_lines, leading.stats.time_order.yearless_dated], [4, 0, 3]);
  // The date lines and the yearless lines are weighed together, every year a yearless line could take with them (Codex, P2:
  // an early tie between the two date lines kept the January lines and settled on less weight). 1 July between 1 January
  // 2020 and 1 July 2021 is July 2020, the last 1 July is July 2021, and the second 1 January 2020 is taken as misread.
  const tied = build4(["1 janvier 2020", "1 juillet", "1 juillet 2021", "1 janvier 2020", "1 juillet"].map((line, index) => page(`${line}\n\nCitation ${index + 1}.`, index + 1)));
  const tiedMeta = metaByText(tied);
  assert.deepEqual([1, 2, 3, 5].map((number) => tiedMeta.get(`Citation ${number}.`).written.from), ["2020-01-01", "2020-07-01", "2021-07-01", "2021-07-01"]);
  assert.deepEqual(["anchors", "misread_lines", "yearless_dated", "yearless_undated"].map((name) => tied.stats.time_order[name]), [4, 1, 2, 0]);
  // Codex's example of reading the years again without end, in an earlier version: June 2020 has four yearless lines after
  // it that can't come before September 2020 with it, so it is taken as misread, and the six yearless lines before September
  // 2020 run back from it, each the latest day not after the next: January and September 2018, 31 December 2018, 15 January
  // 2019, 31 December 2019 twice; 1 December comes after September 2020.
  const between = build4(["1 janvier", "1 septembre", "Juin 2020", "31 décembre", "15 janvier", "31 décembre", "31 décembre", "Septembre 2020", "1 décembre"]
    .map((line, index) => page(`${line}\n\nCitation ${index + 1}.`, index + 1)));
  const inBetween = metaByText(between);
  assert.deepEqual(["anchors", "misread_lines", "yearless_dated", "yearless_undated"].map((name) => between.stats.time_order[name]), [8, 1, 7, 0]);
  assert.deepEqual([1, 2, 4, 5, 6, 7, 8, 9].map((number) => inBetween.get(`Citation ${number}.`).written.from),
    ["2018-01-01", "2018-09-01", "2018-12-31", "2019-01-15", "2019-12-31", "2019-12-31", "2020-09", "2020-12-01"]);
  assert.deepEqual([inBetween.get("Citation 3.").written.from, inBetween.get("Citation 3.").written.to], ["2018-09-01", "2018-12-31"], "June 2020's entry is ranged");
  // Two date lines that each let in a different yearless line, as rounds of reading the years did in turn: the heaviest
  // run is 2021, May 2021, 28 July and December 2021; January 2021 is taken as misread, and 1 April and 1 January date nothing.
  const turns = build4(["2021", "Mai 2021", "1 avril", "Janvier 2021", "28 juillet", "1 janvier", "Décembre 2021"]
    .map((line, index) => page(`${line}\n\nCitation ${index + 1}.`, index + 1)));
  const turned = metaByText(turns);
  assert.deepEqual(["anchors", "misread_lines", "yearless_dated", "yearless_undated"].map((name) => turns.stats.time_order[name]), [4, 1, 1, 2]);
  assert.deepEqual([1, 2, 5, 7].map((number) => turned.get(`Citation ${number}.`).written.from), ["2021", "2021-05", "2021-07-28", "2021-12"], "the anchors, in order");
  for (const [number, range] of [[3, ["2021-05", "2021-07-28"]], [4, ["2021-05", "2021-07-28"]], [6, ["2021-07-28", "2021-12"]]]) {
    assert.deepEqual([turned.get(`Citation ${number}.`).written.from, turned.get(`Citation ${number}.`).written.to], range, `Citation ${number}.`);
  }
  // A 29 February takes the latest leap year not after the next date.
  assert.equal(metaByText(build4([page("29 février\n\nUn.", 1), page("1 mars 2023\n\nFin.", 2)])).get("Un.").written.from, "2020-02-29");
  // Weighed with the date lines, a yearless line settles a tie between them (Codex, P2): 31 December 2020 and 30 December
  // 2020 tie on their own; with the yearless 30 December after the unread page, running back from 30 December 2020 to the
  // same day, the run of 30 December, 30 December 2020 and 2 January 2021 weighs most, so 31 December 2020 is taken as misread.
  const tie = build4([page("31 décembre 2020\n\nUn.", 1), page("Mots autour d'un dessin.", 2, "visual_pending"), page("30 décembre\n\nDeux.", 3),
    page("30 décembre 2020\n\nTrois.", 4), page("2 janvier 2021\n\nFin.", 5)]);
  const tieMeta = metaByText(tie);
  assert.deepEqual([tie.stats.time_order.anchors, tie.stats.time_order.misread_lines, tie.stats.time_order.yearless_dated], [3, 1, 1]);
  assert.deepEqual([tieMeta.get("Deux.").written.from, tieMeta.get("Deux.").written.year_inferred], ["2020-12-30", true]);
  assert.equal(tieMeta.get("Trois.").written.from, "2020-12-30");
  assert.deepEqual([tieMeta.get("Un.").written.from, tieMeta.get("Un.").written.to, tieMeta.get("Un.").written.between], [null, "2020-12-30", true],
    "the entry under the line taken as misread comes before the first anchor");
});

test("version 4's run of lines in time order is the heaviest there is, checked against every subset on a fixed run of random line lists", () => {
  // A subset is a run when, from its first date line on, each date line's day is not before the day of the line before it,
  // each yearless line taking the earliest day not before that day (which leaves the most room: any day a yearless line could
  // take there is no earlier); the yearless lines before its first date line can always run back from it.
  let seed = 11;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const pad2 = (value) => String(value).padStart(2, "0");
  const realDay = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
  const earliest = ({ month, day }, near) => {
    for (let year = Number(near.slice(0, 4)); ; year += 1) {
      const value = `${year}-${pad2(month)}-${pad2(day)}`;
      if (realDay(year, month, day) && value >= near) return value;
    }
  };
  const weightOf = (line) => (line.yearless ? 1 : line.written.precision === "year" ? 1 : line.written.precision === "month" ? 2 : 3);
  const dateLine = () => {
    const year = pick([2019, 2020, 2021]), month = 1 + Math.floor(random() * 12), kind = random();
    if (kind < 0.2) return { day: `${year}-01-01`, written: { from: String(year), to: String(year), precision: "year" } };
    if (kind < 0.5) return { day: `${year}-${pad2(month)}-01`, written: { from: `${year}-${pad2(month)}`, to: `${year}-${pad2(month)}`, precision: "month" } };
    const day = `${year}-${pad2(month)}-${pad2(pick([1, 15, 28]))}`;
    return { day, written: { from: day, to: day, precision: "day" } };
  };
  for (let list = 0; list < 300; list += 1) {
    const lines = Array.from({ length: 1 + Math.floor(random() * 10) }, () =>
      (random() < 0.45 ? { yearless: { month: 1 + Math.floor(random() * 12), day: pick([1, 15, 29, 31]) } } : dateLine()))
      .filter((line) => !line.yearless || realDay(2000, line.yearless.month, line.yearless.day));
    const { kept, days } = timeOrderRun(lines);
    let previous = null, weight = 0;
    lines.forEach((line, index) => {
      if (!kept.has(index)) return;
      const day = line.yearless ? days.get(index) : line.day;
      if (line.yearless) assert.equal(day.slice(5), `${pad2(line.yearless.month)}-${pad2(line.yearless.day)}`, `list ${list}: the yearless line's own day`);
      if (previous !== null) assert.ok(day >= previous, `list ${list}: ${day} after ${previous}`);
      previous = day;
      weight += weightOf(line);
    });
    let heaviest = 0;
    for (let mask = 1; mask < 1 << lines.length; mask += 1) {
      const chosen = lines.filter((_, index) => (mask & (1 << index)) !== 0);
      const first = chosen.findIndex((line) => !line.yearless);
      if (first === -1) continue;
      let day = chosen[first].day, inOrder = true;
      for (const line of chosen.slice(first + 1)) {
        if (line.yearless) day = earliest(line.yearless, day);
        else if (line.day < day) { inOrder = false; break; }
        else day = line.day;
      }
      if (inOrder) heaviest = Math.max(heaviest, chosen.reduce((total, line) => total + weightOf(line), 0));
    }
    assert.equal(weight, heaviest, `list ${list}: the run weighs the most a run can`);
  }
});

test("version 4 never dates a quote earlier than the quotes above it, and counts every line and quote once, on a fixed run of random journals", () => {
  // Date lines of every kind, yearless dates (29 February among them) and pages not fully read, in journals of 4 to 17 pages.
  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const line = () => {
    const kind = random(), month = pick(months), year = pick([2018, 2019, 2020, 2021]), day = pick([1, 15, 28, 29]);
    if (kind < 0.45) return `${day} ${month}`;
    if (kind < 0.8) return `${month[0].toUpperCase()}${month.slice(1)} ${year}`;
    if (kind < 0.95) return `${day} ${month} ${year}`;
    return `${year}`;
  };
  const firstDay = (value) => (value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value);
  for (let journal = 0; journal < 50; journal += 1) {
    const pages = Array.from({ length: 4 + Math.floor(random() * 14) }, (_, index) =>
      page(random() < 0.8 ? `${line()}\n\nCitation ${index + 1}.` : `Citation ${index + 1}.`, index + 1, random() < 0.1 ? "visual_pending" : "readable"));
    const built = build4(pages);
    const order = built.stats.time_order, kinds = built.stats.date_line_kinds;
    assert.equal(order.anchors, built.stats.date_lines - order.misread_lines + order.yearless_dated, `journal ${journal}: anchors`);
    assert.equal(order.yearless_dated + order.yearless_undated, kinds.year_inferred + kinds.no_year_known, `journal ${journal}: yearless lines`);
    assert.equal(order.dated_quotes + order.ranged_quotes + order.open_start_quotes + order.open_end_quotes + order.undated_quotes, built.stats.quotes,
      `journal ${journal}: quotes`);
    const byUnit = new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node.id]));
    let previous = null;
    for (const unit of built.units) {
      const { written } = built.quoteMeta.get(byUnit.get(unit.unit_id))[0];
      if (written === null) continue;
      const first = written.from === null ? null : firstDay(written.from);
      if (first !== null && written.to !== null) assert.ok(first <= firstDay(written.to), `journal ${journal}: a range that ends before it starts`);
      if (first !== null && previous !== null) assert.ok(first >= previous, `journal ${journal}: ${first} after ${previous}`);
      if (first !== null) previous = first;
      else assert.equal(previous, null, `journal ${journal}: a range open at the start after a dated quote`);
    }
  }
});

test("version 4 lists a journal whose dates are two centuries apart in about one entry per quote, not one per quote and month (Codex, P1)", () => {
  // Every quote between 1 January 1900 and 31 December 2100 has a range of 2,412 months: listed by month, 300 quotes would make
  // 723,600 entries; apart, they make one each.
  const pages = [page("1 janvier 1900\n\nDébut.", 1), ...Array.from({ length: 300 }, (_, index) => page(`Texte ${index + 1}.`, index + 2)),
    page("31 décembre 2100\n\nFin.", 302)];
  const built = build4(pages);
  const entries = [...built.quoteMonths].reduce((total, [key, values]) => total + (key === QUOTE_MONTHS_KEY ? 0 : values.length), 0);
  assert.equal(entries, built.stats.quotes, "one entry per quote");
  assert.deepEqual(built.quoteMonths.get(QUOTE_MONTHS_KEY), ["1900-01", "2100-12"]);
  assert.equal(built.quoteMonths.get(QUOTE_WIDE_KEY).length, built.stats.time_order.ranged_quotes);
  assert.deepEqual(built.quoteMonths.get(QUOTE_WIDE_KEY)[0].slice(1), ["1900-01-01", "2100-12-31"]);
});

test("version 4 gives the quotes before the first date and after the last a range open at that end, listed apart, and leaves only a journal without dates undated", () => {
  const pages = [page("Avant toute date.", 1), page("3 mars 2020\n\nUn.", 2), page("Deux.", 3), page("Trois.", 4), page("Quatre après la dernière.", 5)];
  const built = build4(pages);
  const meta = metaByText(built);
  const first = meta.get("Un.").written;
  assert.deepEqual(meta.get("Avant toute date.").written, { from: null, to: "2020-03-03", precision: "interval", between: true, ambiguous: false,
    year_inferred: false, line: null, line_after: lineOf(first) });
  assert.deepEqual(meta.get("Quatre après la dernière.").written, { from: "2020-03-03", to: null, precision: "interval", between: true, ambiguous: false,
    year_inferred: false, line: lineOf(first), line_after: null });
  assert.deepEqual(built.quoteMonths.get(QUOTE_WIDE_KEY), [[quoteId(built, "Avant toute date."), null, "2020-03-03"],
    [quoteId(built, "Quatre après la dernière."), "2020-03-03", null]].sort(([left], [right]) => left.localeCompare(right)));
  assert.deepEqual(built.quoteMonths.get(QUOTE_MONTHS_KEY), ["2020-03"], "the key of the ranges listed apart isn't a month");
  assert.equal(built.quoteMonths.has(QUOTE_UNDATED_KEY), false);
  assert.deepEqual([built.stats.time_order.open_start_quotes, built.stats.time_order.open_end_quotes, built.stats.time_order.undated_quotes], [1, 1, 0]);
  const plain = build4([page("Rien de daté.", 1), page("Toujours rien.", 2)]);
  assert.deepEqual([plain.stats.time_order.undated_quotes, plain.stats.time_order.anchors], [2, 0]);
  assert.equal(plain.quoteMonths.get(QUOTE_UNDATED_KEY).length, 2);
});

test("a time window keeps a quote whose range is too wide to list by month when the window overlaps it, and no other", async (t) => {
  const pages = [page("3 mars 2019\n\nUn.", 1), page("Deux.", 2), page("Trois.", 3), page("Le lac loin des dates.", 4), page("3 mars 2021\n\nFin.", 5)];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-wide-ranges-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const built = build4(pages);
  assert.equal(built.quoteMonths.get(QUOTE_WIDE_KEY).length, 1, "listed apart");
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: Object.fromEntries(pages.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_terms: buildQuoteTermsFromGraph(built.graph) }, indexRepresentations: true });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: V4_GENERATION, visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  try {
    const found = async (from, to) => (await reader.findQuotes({ query: "lac", from, to, includeUndated: false })).quotes.length === 1;
    assert.deepEqual(await Promise.all([["2020", "2020"], ["2019-06", "2019-06"], ["2021-03-03", null], [null, "2019-03-03"]].map(([from, to]) => found(from, to))),
      [true, true, true, true], "windows inside or reaching its range");
    assert.deepEqual(await Promise.all([["2018", "2018"], ["2022", "2022"], ["2021-03-04", null], [null, "2019-03-02"]].map(([from, to]) => found(from, to))),
      [false, false, false, false], "windows outside it");
  } finally { reader.close(); }
});

test("a time window keeps a quote whose range is open at one end when the window reaches that side of its date", async (t) => {
  const pages = [page("Le lac avant toute date.", 1), page("3 mars 2020\n\nLe lac au printemps.", 2), page("Deux.", 3), page("Trois.", 4),
    page("Le lac après la dernière date.", 5)];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-open-ranges-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseId = "quote-case", corpusId = "quote-corpus:quotes";
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: randomBytes(32) });
  const built = build4(pages);
  const persisted = await persistGraphGeneration({ corpusStore: store, graph: built.graph, sourceRepresentations: Object.fromEntries(pages.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_terms: buildQuoteTermsFromGraph(built.graph) }, indexRepresentations: true });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
    generation: V4_GENERATION, visibilityEpoch: 0, purpose: "session_use", cursorSecret: randomBytes(32) });
  try {
    const texts = async (from, to) => (await reader.findQuotes({ query: "lac", from, to, includeUndated: false })).quotes.map(({ text }) => text);
    const before = "Le lac avant toute date.", after = "Le lac après la dernière date.";
    assert.ok((await texts("2019", "2019")).includes(before), "a year before the first date");
    assert.ok((await texts(null, "2020-03-03")).includes(before), "up to the first date's day");
    assert.equal((await texts("2020-03-04", null)).includes(before), false, "after the first date");
    assert.ok((await texts("2024", "2024")).includes(after), "a year after the last date");
    assert.equal((await texts(null, "2020-03-02")).includes(after), false, "before the last date");
    const [found] = (await reader.findQuotes({ query: "avant" })).quotes;
    assert.deepEqual(found.written, { from: null, to: "2020-03-03", precision: "interval", date_line: null, between: true, date_line_after: "3 mars 2020" });
    const [later] = (await reader.findQuotes({ query: "après" })).quotes;
    assert.deepEqual(later.written, { from: "2020-03-03", to: null, precision: "interval", date_line: "3 mars 2020", between: true, date_line_after: null });
  } finally { reader.close(); }
});
