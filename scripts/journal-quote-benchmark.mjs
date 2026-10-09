#!/usr/bin/env node
// Reply-time cost of finding quotes, measured on a synthetic journal of a chosen size with the import's
// own storage, encryption, index and reader: the same code the hosted connector runs per request.
// Synthetic text only, generated from a seed; prints numbers only.
//
//   node scripts/journal-quote-benchmark.mjs [--pages 1122] [--page-bytes 9000] [--queries 60] [--seed 7]
//
// Each query opens a fresh reader, as the connector does for every tool call, so nothing is reused
// between queries except the operating system's file cache.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";

const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
};
const pages = option("pages", 1122);
const pageBytes = option("page-bytes", 9000);
const queryCount = option("queries", 60);
const seed = option("seed", 7);
const shardBytes = option("shard-bytes", 128 * 1024);

// mulberry32: a small seeded generator, so a run is reproducible.
function generator(value) {
  let state = value >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = generator(seed);
const pick = (items) => items[Math.floor(random() * items.length)];
const syllables = ["ka", "lo", "mi", "ren", "sa", "tu", "vel", "dor", "ia", "en", "ost", "ul", "bra", "che", "fin", "gra", "hol", "jun", "mar", "nel", "pra", "quo", "rid", "sil", "tam", "ver", "wex", "yor", "zan"];
const word = () => Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(syllables)).join("");
// A Zipf-shaped vocabulary like English: a few words very common, most rare.
const vocabulary = [...new Set(Array.from({ length: 30_000 }, word))];
const zipf = (() => {
  const weights = vocabulary.map((_, rank) => 1 / (rank + 1) ** 1.05);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let running = 0;
  const cumulative = weights.map((weight) => (running += weight / total));
  return () => {
    const target = random();
    let low = 0, high = cumulative.length - 1;
    while (low < high) { const middle = (low + high) >> 1; if (cumulative[middle] < target) low = middle + 1; else high = middle; }
    return vocabulary[low];
  };
})();
const function_words = ["i", "the", "and", "to", "a", "of", "it", "was", "that", "my", "in", "me", "he", "she", "we", "but", "so", "with", "for", "had", "not", "just", "about", "like", "when"];
const names = Array.from({ length: 150 }, () => { const value = word(); return value[0].toUpperCase() + value.slice(1); });
const cues = ["I dreamt", "I wish", "I didn't", "maybe", "I'm going to", "she said", "never", "I think"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function sentence() {
  const length = 8 + Math.floor(random() * 18);
  const parts = [];
  if (random() < 0.12) parts.push(pick(cues));
  for (let index = 0; index < length; index += 1) {
    const roll = random();
    parts.push(roll < 0.45 ? pick(function_words) : roll < 0.5 ? pick(names) : zipf());
  }
  const text = parts.join(" ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
function paragraph() {
  const target = 200 + Math.floor(random() * 1000);
  let text = "";
  while (text.length < target) text += (text ? " " : "") + sentence();
  return text;
}
let day = Date.UTC(2009, 0, 1);
const DAYS_PER_ENTRY = (20 * 365) / (pages * Math.max(1, pageBytes / 2800));
function journalPages() {
  const result = [];
  for (let page = 0; page < pages; page += 1) {
    let text = "";
    while (Buffer.byteLength(text, "utf8") < pageBytes) {
      if (random() < 0.25) {
        // Entries spread over about twenty years whatever the size, so a larger journal has more
        // entries a day rather than dates past the calendar's end.
        day += (0.5 + random()) * DAYS_PER_ENTRY * 86_400_000;
        const date = new Date(day);
        text += `${text ? "\n\n" : ""}${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}\n\n`;
      }
      text += `${text && !text.endsWith("\n\n") ? "\n\n" : ""}${paragraph()}`;
    }
    result.push({ representation_id: `rep:${String(page).padStart(6, "0")}`, text, page_number: page + 1, parse_status: "readable" });
  }
  return result;
}
// Questions the way a person would ask them: a name or two and some topic words, sometimes a year.
function queries(firstYear, lastYear) {
  return Array.from({ length: queryCount }, (_, index) => {
    const topic = Array.from({ length: 2 + Math.floor(random() * 4) }, () => vocabulary[50 + Math.floor(random() * 5_000)]);
    const query = `what did I write about ${pick(names)} and ${topic.join(" ")}`;
    if (index % 3 !== 2) return { query };
    const year = firstYear + Math.floor(random() * (lastYear - firstYear + 1));
    return { query, from: String(year), to: String(year) };
  });
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};
const round = (value) => Math.round(value * 10) / 10;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "quote-benchmark-"));
const caseId = "benchmark-case";
const corpusId = "benchmark-corpus-quotes";
const key = randomBytes(32);
const cursorSecret = randomBytes(32);
try {
  const representations = journalPages();
  const textBytes = representations.reduce((sum, item) => sum + Buffer.byteLength(item.text, "utf8"), 0);
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: key });
  let started = performance.now();
  const built = buildQuoteGeneration({ caseId, corpusId, generation: "benchmark:quotes:v1", originalObjectId: "original:benchmark", mediaType: "application/pdf", representations });
  const buildMs = performance.now() - started;
  started = performance.now();
  const persisted = await persistGraphGeneration({
    corpusStore: store,
    graph: built.graph,
    sourceRepresentations: Object.fromEntries(representations.map((item) => [item.representation_id, item.text])),
    permittedUses: ["archive", "organize_search", "session_use"],
    shardTargetBytes: shardBytes,
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths },
    indexRepresentations: true
  });
  const persistMs = performance.now() - started;
  store.close();
  const firstYear = 2009, lastYear = new Date(day).getUTCFullYear();
  const timings = [], openings = [], sizes = [], counts = [], reads = [], windowedTimings = [], plainTimings = [];
  for (const input of queries(firstYear, lastYear)) {
    const opened = performance.now();
    const queryStore = createPrivateJournalCorpusStore({ rootDir: root, caseId, corpusId, corpusKey: key });
    const reader = await openPrivateJournalGraph({ corpusStore: queryStore, manifestObjectId: persisted.manifest_object_id, caseId, corpusId,
      generation: persisted.manifest.generation, visibilityEpoch: 0, purpose: "session_use", cursorSecret });
    const ready = performance.now();
    const result = await reader.findQuotes(input);
    const finished = performance.now();
    reader.close();
    queryStore.close();
    openings.push(ready - opened);
    timings.push(finished - opened);
    (input.from ? windowedTimings : plainTimings).push(finished - opened);
    sizes.push(result.quotes.reduce((sum, quote) => sum + Buffer.byteLength(quote.text, "utf8") + Buffer.byteLength(quote.written?.date_line ?? "", "utf8"), 0));
    counts.push(result.quotes.length);
    reads.push(result.coverage.encrypted_objects_read);
  }
  const files = await fs.readdir(path.join(root, ".journal-corpora"), { recursive: true, withFileTypes: true });
  let storedBytes = 0, storedObjects = 0;
  for (const file of files) if (file.isFile()) { storedObjects += 1; storedBytes += (await fs.stat(path.join(file.parentPath ?? file.path, file.name))).size; }
  console.log(JSON.stringify({
    synthetic_journal: { pages, text_mb: round(textBytes / 1e6), quotes: built.stats.quotes, dated_quotes: built.stats.dated_quotes, date_lines: built.stats.date_lines },
    index_build: { split_and_graph_s: round(buildMs / 1000), encrypt_and_store_s: round(persistMs / 1000), stored_objects: storedObjects, stored_mb: round(storedBytes / 1e6), shard_bytes: shardBytes },
    per_call: {
      queries: timings.length,
      open_reader_ms_p50: round(percentile(openings, 0.5)),
      total_ms_p50: round(percentile(timings, 0.5)),
      total_ms_p90: round(percentile(timings, 0.9)),
      total_ms_p95: round(percentile(timings, 0.95)),
      total_ms_max: round(Math.max(...timings)),
      without_time_window_ms_p50: round(percentile(plainTimings, 0.5)),
      without_time_window_ms_p95: round(percentile(plainTimings, 0.95)),
      with_time_window_ms_p50: round(percentile(windowedTimings, 0.5)),
      with_time_window_ms_p95: round(percentile(windowedTimings, 0.95)),
      quotes_returned_mean: round(counts.reduce((sum, value) => sum + value, 0) / counts.length),
      quote_kb_mean: round(sizes.reduce((sum, value) => sum + value, 0) / sizes.length / 1000),
      quote_kb_max: round(Math.max(...sizes) / 1000),
      approx_tokens_mean: Math.round(sizes.reduce((sum, value) => sum + value, 0) / sizes.length / 4),
      encrypted_objects_read_p50: percentile(reads, 0.5),
      encrypted_objects_read_max: Math.max(...reads)
    },
    machine: { cpus: os.cpus().length, node: process.version }
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
