import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateJournalGraph } from "../src/journal-import/contracts.mjs";
import { adaptExtractionToGraph, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { partitionRepresentation } from "../src/journal-import/partition.mjs";
import { QUOTE_MONTHS_KEY, QUOTE_UNDATED_KEY, buildQuoteGeneration, dateLineValue, quoteCues, splitQuoteUnits } from "../src/journal-import/quote-index.mjs";
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
  assert.deepEqual(units[1].date_line, { from: "2019-03-03", to: "2019-03-03", precision: "day" });
  const third = splitQuoteUnits({ representationId: representations[2].representation_id, text: representations[2].text });
  assert.match(third[0].text, /^2020-01-05 New year\./u, "a long line opening with a date starts its own unit");
  assert.equal(third[0].heading, false);
  assert.equal(third[0].date_line.from, "2020-01-05");
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
  return { open, service, stateFile: path.join(config.execution_root, "state.json") };
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
  assert.match(corpora[0].active_generation, /:quotes:quote-index-v1$/u);
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
