import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateJournalGraph } from "../src/journal-import/contracts.mjs";
import { adaptExtractionToGraph, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { partitionRepresentation } from "../src/journal-import/partition.mjs";
import { QUOTE_MONTHS_KEY, QUOTE_UNDATED_KEY, buildQuoteGeneration, dateLineValue, entryDateLine, quoteCues, quoteDateOptions,
  splitQuoteUnits } from "../src/journal-import/quote-index.mjs";
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
  assert.deepEqual(quoteDateOptions(), { numericOrder: "month_first", carryPages: 2, carryQuotes: 24 });
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
  assert.match(corpora[0].active_generation, /:quotes:quote-index-v2-month-first$/u);
  // The published quote corpus carries the archived original its locators name.
  await f.service.withJournalCorpus(CASE_ID, corpora[0].corpus_id, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore, reference }) => {
    const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
    assert.equal(manifest.archive_references.length, 1);
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
  const called = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_journal_quotes",
    arguments: { case_id: CASE_ID, corpus_id: corpora[0].corpus_id, query: "Mara cardamom", from: "2019-04", to: "2019-04", include_undated: false, purpose: "session_use" } } });
  assert.equal(called.result.isError, false);
  assert.deepEqual(called.result.structuredContent.quotes.map(({ text }) => text.slice(0, 9)), ["Mara said"]);

  // Publishing again is a no-op for the same quote generation.
  runtime = await f.open();
  try { await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const again = await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER });
  assert.deepEqual(again.journal_corpora.filter((item) => item.active_generation != null).map((item) => item.active_generation), [corpora[0].active_generation]);
});

test("a quote index built another way replaces exactly the one published before it, and a reply paging the old one isn't cut off", async (t) => {
  const f = await runtimeEnvironment(t);
  const reader = { bearerToken: READER };
  const quoteCorpus = async () => {
    const record = await f.service.loadPrivateRuntimeCase(CASE_ID, reader);
    const { corpus_id: corpusId } = record.journal_corpora.find((item) => item.corpus_id.endsWith(":quotes"));
    return (await f.service.getJournalCorpus(CASE_ID, corpusId, reader)).reference;
  };
  let runtime = await f.open();
  try { await runtime.execute("stage"); await runtime.execute("publish-quotes"); } finally { await runtime.close(); }
  const first = await quoteCorpus();
  assert.match(first.active_generation, /:quotes:quote-index-v2-month-first$/u);
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
  assert.match(built.quote_index.generation, /:quotes:quote-index-v2-day-first$/u);
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
