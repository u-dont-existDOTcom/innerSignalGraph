#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { partitionRepresentation, verifyRepresentationCoverage } from "../src/journal-import/partition.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

const MIB = 1024 * 1024;
const CASE_ID = "capacity-case";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rounded = (value) => Math.round(value * 1000) / 1000;

function exactTime(date, evidenceId) {
  return { raw: date, from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.999Z`, precision: "day", timezone: "UTC", basis: "explicit", evidence_ids: [evidenceId] };
}

export function createSyntheticCalendarGraph({ years, corpusId, generation, entriesPerYear = 12, reversedHistory = false, tombstoneIndexes = [] }) {
  if (!Number.isSafeInteger(years) || years < 1 || years > 100) throw new TypeError("years must be a bounded positive integer");
  if (!Number.isSafeInteger(entriesPerYear) || entriesPerYear < 1 || entriesPerYear > 366) throw new TypeError("entriesPerYear must be a bounded positive integer");
  const tombstones = new Set(tombstoneIndexes);
  const representationId = `representation:${generation}`;
  const sourceId = `source:${generation}`;
  const originalObjectId = `original:${generation}`;
  const lines = [];
  for (let index = 0; index < years * entriesPerYear; index += 1) {
    const sourceYear = 2000 + Math.floor(index / entriesPerYear);
    const sourceSlot = index % entriesPerYear;
    lines.push(`capacitymarker entry ${String(index).padStart(4, "0")} source-year ${sourceYear} slot ${String(sourceSlot).padStart(3, "0")} unique-${generation}-${index}\n`);
  }
  const text = lines.join("");
  const nodes = [{
    id: sourceId, case_id: CASE_ID, corpus_id: corpusId, version: 1, lifecycle: "active", kind: "source",
    data: { representation_id: representationId, original_object_id: originalObjectId, media_type: "text/plain", byte_length: Buffer.byteLength(text), parse_status: "readable" }
  }];
  const edges = [];
  let startByte = 0;
  for (const [index, quote] of lines.entries()) {
    const passageId = `passage:${generation}:${index}`;
    const episodeId = `episode:${generation}:${index}`;
    const endByte = startByte + Buffer.byteLength(quote);
    const lifecycle = tombstones.has(index) ? "deleted" : "active";
    const chronologicalIndex = reversedHistory ? lines.length - index - 1 : index;
    const year = 2000 + Math.floor(chronologicalIndex / entriesPerYear);
    const slot = chronologicalIndex % entriesPerYear;
    const dayOffset = Math.floor((slot * 364) / Math.max(1, entriesPerYear - 1));
    const date = new Date(Date.UTC(year, 0, 1 + dayOffset)).toISOString().slice(0, 10);
    nodes.push({
      id: passageId, case_id: CASE_ID, corpus_id: corpusId, version: 1, lifecycle, kind: "passage",
      data: {
        representation_id: representationId, unit_id: `unit:${generation}:${index}`, start_byte: startByte, end_byte: endByte,
        quote, quote_sha256: sha256(Buffer.from(quote)),
        locator: { kind: "native_text", page: null, bbox: null, original_object_id: originalObjectId, interpretation_status: "native" }
      }
    });
    nodes.push({
      id: episodeId, case_id: CASE_ID, corpus_id: corpusId, version: 1, lifecycle, kind: "episode",
      data: {
        label: `capacitymarker episode ${index}`, authored_time: exactTime(date, passageId), event_time: exactTime(date, passageId),
        source_order: index, evidence_ids: [passageId], support_group_id: `support:${generation}:${index}`
      }
    });
    edges.push({
      id: `edge:${generation}:${index}`, case_id: CASE_ID, corpus_id: corpusId, version: 1, lifecycle,
      relation: "contains", from: sourceId, to: passageId, evidence_ids: [passageId], basis: "direct_source", derivation_ref: null
    });
    startByte = endByte;
  }
  return Object.freeze({
    graph: { schema_version: "1.0", case_id: CASE_ID, corpus_id: corpusId, generation, nodes, edges },
    representations: { [representationId]: text },
    entries: lines.length
  });
}

async function directoryMetrics(directory) {
  let files = 0;
  let bytes = 0;
  const visit = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) { files += 1; bytes += (await fs.stat(target)).size; }
    }
  };
  await visit(directory);
  return { files, bytes };
}

async function calendarCase(rootDir, { years, entriesPerYear, density }) {
  const corpusId = `calendar:${years}y`;
  const generation = `calendar-${years}y-v1`;
  const corpusKey = randomBytes(32);
  const store = createPrivateJournalCorpusStore({ rootDir, caseId: CASE_ID, corpusId, corpusKey });
  const synthetic = createSyntheticCalendarGraph({ years, corpusId, generation, entriesPerYear, reversedHistory: years === 2 });
  const started = performance.now();
  const persisted = await persistGraphGeneration({
    corpusStore: store,
    graph: synthetic.graph,
    sourceRepresentations: synthetic.representations,
    permittedUses: ["archive", "organize_search"],
    shardTargetBytes: 4096
  });
  const persistMs = performance.now() - started;
  const reader = await openPrivateJournalGraph({
    corpusStore: store,
    manifestObjectId: persisted.manifest_object_id,
    caseId: CASE_ID,
    corpusId,
    generation,
    visibilityEpoch: 0,
    cursorSecret: Buffer.alloc(32, years)
  });
  const searchStarted = performance.now();
  const first = await reader.search({ query: "capacitymarker", filters: { kinds: ["passage"] }, pageSize: 200 });
  let page = first;
  let totalMatches = 0;
  let pages = 0;
  do {
    totalMatches += page.records.length;
    pages += 1;
    page = page.next_cursor
      ? await reader.search({ query: "capacitymarker", filters: { kinds: ["passage"] }, pageSize: 200, cursor: page.next_cursor })
      : null;
  } while (page);
  const searchMs = performance.now() - searchStarted;
  const timelineStarted = performance.now();
  const timeline = await reader.timeline();
  const timelineMs = performance.now() - timelineStarted;
  const storage = await directoryMetrics(store.rootDir);
  reader.close();
  store.close();
  corpusKey.fill(0);
  return Object.freeze({
    years,
    density,
    entries_per_year: entriesPerYear,
    entries: synthetic.entries,
    nodes: synthetic.graph.nodes.length,
    edges: synthetic.graph.edges.length,
    persisted_objects: storage.files,
    stored_bytes: storage.bytes,
    total_matches: totalMatches,
    result_pages: pages,
    paginated_after_200: first.more_available,
    timeline_records: timeline.records.length,
    reversed_history_exercised: years === 2,
    persist_ms: rounded(persistMs),
    search_ms: rounded(searchMs),
    timeline_ms: rounded(timelineMs)
  });
}

async function* deterministicVolume(byteLength, seed) {
  const blockBytes = 256 * 1024;
  let emitted = 0;
  let index = 0;
  while (emitted < byteLength) {
    const length = Math.min(blockBytes, byteLength - emitted);
    const block = Buffer.alloc(length, (seed + index) % 251);
    block.writeUInt32BE(index, 0);
    yield block;
    block.fill(0);
    emitted += length;
    index += 1;
  }
}

async function volumeCase(rootDir, mebibytes, seed) {
  const corpusId = `volume:${mebibytes}mib`;
  const corpusKey = randomBytes(32);
  const store = createPrivateJournalCorpusStore({ rootDir, caseId: CASE_ID, corpusId, corpusKey });
  const byteLength = mebibytes * MIB;
  const writeStarted = performance.now();
  const manifest = await store.writeChunkedOriginalStream({ objectId: `original:${mebibytes}mib`, chunks: deterministicVolume(byteLength, seed) });
  const writeMs = performance.now() - writeStarted;
  const openedDigest = createHash("sha256");
  let openedBytes = 0;
  const readStarted = performance.now();
  for await (const chunk of store.iterateOriginal(manifest)) {
    openedDigest.update(chunk);
    openedBytes += chunk.byteLength;
  }
  const readMs = performance.now() - readStarted;
  const storage = await directoryMetrics(store.rootDir);
  const result = Object.freeze({
    mebibytes,
    source_bytes: byteLength,
    chunks: manifest.chunks.length,
    digest_verified: openedDigest.digest("hex") === manifest.sha256,
    streamed_bytes: openedBytes,
    persisted_objects: storage.files,
    stored_bytes: storage.bytes,
    write_ms: rounded(writeMs),
    read_ms: rounded(readMs)
  });
  store.close();
  corpusKey.fill(0);
  return result;
}

export async function runCapacityEnvelope({ rootDir = null } = {}) {
  const ownedRoot = rootDir == null;
  const privateRoot = rootDir ?? await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-journal-capacity-"));
  await fs.chmod(privateRoot, 0o700);
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  try {
    const calendar_cases = [];
    for (const calendar of [
      { years: 2, entriesPerYear: 12, density: "monthly" },
      { years: 10, entriesPerYear: 12, density: "monthly" },
      { years: 20, entriesPerYear: 51, density: "dense" }
    ]) calendar_cases.push(await calendarCase(privateRoot, calendar));
    const volume_cases = [];
    for (const [index, mebibytes] of [1, 10, 50].entries()) volume_cases.push(await volumeCase(privateRoot, mebibytes, index + 17));
    const oversizedSource = `${"unique guard material é\n".repeat(Math.ceil((2 * MIB + 17) / 24))}`;
    const partitioned = partitionRepresentation({ representationId: "guard:over-2mib", text: oversizedSource });
    const coverage = verifyRepresentationCoverage(oversizedSource, partitioned);
    const longEntry = "x".repeat(40_001);
    const largest = calendar_cases.at(-1);
    return Object.freeze({
      schema_version: 1,
      claim: "measured_local_synthetic_envelope_not_universal",
      node: process.version,
      platform: process.platform,
      calendar_cases,
      volume_cases,
      guards: {
        matches_over_200: largest.total_matches > 200 && largest.paginated_after_200,
        matches_over_1000: largest.total_matches > 1000 && largest.result_pages > 5,
        files_over_100: largest.persisted_objects > 100,
        source_over_2mib: coverage.byte_length > 2 * MIB && coverage.complete,
        js_entry_over_40k: longEntry.length > 40_000,
        source_bytes: coverage.byte_length,
        source_units: coverage.unit_count,
        long_entry_js_units: longEntry.length
      },
      process: {
        rss_before_bytes: rssBefore,
        rss_after_bytes: process.memoryUsage().rss,
        max_rss_bytes: process.resourceUsage().maxRSS * 1024,
        elapsed_ms: rounded(performance.now() - started)
      }
    });
  } finally {
    if (ownedRoot) await fs.rm(privateRoot, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { process.stdout.write(`${JSON.stringify(await runCapacityEnvelope())}\n`); }
  catch (error) {
    process.stderr.write(`journal capacity measurement failed: ${error?.code ?? error?.name ?? "UNKNOWN"}\n`);
    process.exitCode = 1;
  }
}
