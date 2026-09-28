import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { validateJournalGraph } from "../src/journal-import/contracts.mjs";
import { adaptExtractionToGraph, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { transferJournalGeneration } from "../src/journal-import/generation-transfer.mjs";
import { partitionRepresentation } from "../src/journal-import/partition.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixture = (name) => JSON.parse(readFileSync(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-graph-"));
  await fs.chmod(root, 0o700);
  return root;
}

function corpusStore(rootDir, caseId, corpusId, corpusKey = randomBytes(32)) {
  return createPrivateJournalCorpusStore({ rootDir, caseId, corpusId, corpusKey });
}

function passageGraph({ caseId = "page-case", corpusId = "page-corpus", generation = "page-generation", count = 1001 } = {}) {
  let text = "";
  const passages = [];
  for (let index = 0; index < count; index += 1) {
    const quote = `needle synthetic record ${String(index).padStart(4, "0")}${index === 713 ? " uniqueterm" : ""}\n`;
    const start = Buffer.byteLength(text, "utf8");
    text += quote;
    const end = Buffer.byteLength(text, "utf8");
    passages.push({
      id: `passage:${String(index).padStart(6, "0")}`,
      case_id: caseId,
      corpus_id: corpusId,
      version: 1,
      lifecycle: "active",
      kind: "passage",
      data: {
        representation_id: "representation:paging",
        unit_id: `unit:${String(index).padStart(6, "0")}`,
        start_byte: start,
        end_byte: end,
        quote,
        quote_sha256: sha256(Buffer.from(quote, "utf8")),
        locator: { kind: "native_text", page: null, bbox: null, original_object_id: "original:paging", interpretation_status: "native" }
      }
    });
  }
  return {
    graph: {
      schema_version: "1.0",
      case_id: caseId,
      corpus_id: corpusId,
      generation,
      nodes: [{
        id: "source:paging",
        case_id: caseId,
        corpus_id: corpusId,
        version: 1,
        lifecycle: "active",
        kind: "source",
        data: {
          representation_id: "representation:paging",
          original_object_id: "original:paging",
          media_type: "text/plain",
          byte_length: Buffer.byteLength(text, "utf8"),
          parse_status: "readable"
        }
      }, ...passages],
      edges: []
    },
    representations: { "representation:paging": text }
  };
}

// One text representation larger than a single encrypted object, with a passage at its far end.
function largeTextGraph() {
  const caseId = "large-case";
  const corpusId = "large-corpus";
  const filler = "Synthetic filler line for a long invented text journal.\n".repeat(90_000);
  const quote = "needle at the far end\n";
  const text = filler + quote;
  const start = Buffer.byteLength(filler, "utf8");
  const common = { case_id: caseId, corpus_id: corpusId, version: 1, lifecycle: "active" };
  return {
    graph: {
      schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation: "large-generation",
      nodes: [
        { id: "source:large", ...common, kind: "source", data: { representation_id: "representation:large", original_object_id: "original:large",
          media_type: "text/plain", byte_length: Buffer.byteLength(text, "utf8"), parse_status: "readable" } },
        { id: "passage:far", ...common, kind: "passage", data: { representation_id: "representation:large", unit_id: "unit:far",
          start_byte: start, end_byte: start + Buffer.byteLength(quote, "utf8"), quote, quote_sha256: sha256(Buffer.from(quote, "utf8")),
          locator: { kind: "native_text", page: null, bbox: null, original_object_id: "original:large", interpretation_status: "native" } } }
      ],
      edges: []
    },
    representations: { "representation:large": text }
  };
}

test("a text source larger than one object is stored in chunks, and its exact spans resolve and transfer", async () => {
  const { graph, representations } = largeTextGraph();
  assert.ok(Buffer.byteLength(representations["representation:large"], "utf8") > 4 * 1024 * 1024);
  const store = corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 41));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations, shardTargetBytes: 8192 });
  const descriptor = persisted.manifest.source_representation_objects["representation:large"];
  assert.equal(descriptor.encoding, "utf8_chunks");
  assert.ok(descriptor.chunks.length >= 2);
  const open = (corpus) => openPrivateJournalGraph({ corpusStore: corpus, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id,
    corpusId: graph.corpus_id, generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 43) });
  const reader = await open(store);
  assert.equal((await reader.resolveEvidence(["passage:far"])).exact_spans[0].quote, "needle at the far end\n");
  reader.close();
  const destination = corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 45));
  const transfer = await transferJournalGeneration({ sourceStore: store, destinationStore: destination, persisted });
  assert.ok(transfer.copied_objects > descriptor.chunks.length);
  const copied = await open(destination);
  assert.equal((await copied.resolveEvidence(["passage:far"])).exact_spans[0].quote, "needle at the far end\n");
  copied.close();
  store.close();
  destination.close();
});

test("a long source keeps its representation maps and archive references in a chunked directory, and still resolves and transfers", async () => {
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  // Many more pages than the graph cites, as in a long PDF, with a manifest bound small enough that
  // their maps no longer fit in it.
  for (let page = 0; page < 200; page += 1) representations[`representation:page:${page}`] = `Synthetic page ${page}.`;
  const store = corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 51));
  // The original and its page images, as a scanned source's commit archives them.
  const archives = [await store.writeChunkedOriginal({ objectId: "original:synthetic", bytes: Buffer.from("Invented original bytes.") }),
    ...await Promise.all([0, 1, 2].map((page) => store.writeChunkedOriginal({ objectId: `visual:image:${page}`, bytes: Buffer.from(`Invented page image ${page}.`) })))];
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations,
    archiveReferences: archives, shardTargetBytes: 8192, manifestMaximumBytes: 16384 });
  assert.equal(Object.hasOwn(persisted.manifest, "source_representation_objects"), false);
  assert.equal(Object.hasOwn(persisted.manifest, "source_representations"), false);
  assert.equal(Object.hasOwn(persisted.manifest, "archive_references"), false);
  assert.equal(persisted.manifest.generation_directory.encoding, "json_chunks");
  assert.ok(Buffer.byteLength(JSON.stringify(persisted.manifest), "utf8") <= 16384);
  const open = (corpus) => openPrivateJournalGraph({ corpusStore: corpus, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id,
    corpusId: graph.corpus_id, generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 53) });
  const reader = await open(store);
  const span = (await reader.resolveEvidence(["p4"])).exact_spans[0];
  assert.equal(span.quote, graph.nodes.find(({ id }) => id === "p4").data.quote);
  reader.close();
  const destination = corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 55));
  const transfer = await transferJournalGeneration({ sourceStore: store, destinationStore: destination, persisted });
  assert.equal(transfer.archive_count, 4);
  assert.equal((await destination.reassembleOriginal(archives[3])).toString(), "Invented page image 2.");
  const copied = await open(destination);
  assert.equal((await copied.resolveEvidence(["p4"])).exact_spans[0].quote, span.quote);
  copied.close();
  // Below the bound the maps stay in the manifest, as before.
  const small = await persistGraphGeneration({ corpusStore: corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 57)),
    graph, sourceRepresentations: fixture("synthetic-sources.json"), shardTargetBytes: 8192 });
  assert.equal(Object.hasOwn(small.manifest, "generation_directory"), false);
  assert.ok(small.manifest.source_representation_objects);
  store.close();
  destination.close();
});

test("a timeline page reads its own records and index entries, not a lookup for every entry", async () => {
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const day = (date, evidence) => ({ raw: date, from: date, to: date, precision: "day", timezone: null, basis: "explicit", evidence_ids: [evidence] });
  for (const [index, id] of ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].entries()) {
    graph.nodes.find((node) => node.id === id).data.event_time = day(`2021-05-1${index}`, `p${index + 1}`);
  }
  // Records that sort between the first dated record and the rest, so their lookup entries fall in
  // different shards of the lookup index.
  const colleague = graph.nodes.find((node) => node.id === "colleague");
  for (let index = 0; index < 150; index += 1) {
    graph.nodes.push({ ...structuredClone(colleague), id: `a1:filler:${String(index).padStart(3, "0")}`,
      data: { ...structuredClone(colleague.data), label: `Invented filler ${index}` } });
  }
  const base = corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 61));
  const persisted = await persistGraphGeneration({ corpusStore: base, graph, sourceRepresentations: representations, shardTargetBytes: 4096 });
  const lookupShards = persisted.manifest.indexes.record_lookup.map(({ object_id: objectId }) => objectId);
  const shardOf = (id) => persisted.manifest.indexes.record_lookup.find((descriptor) =>
    id.localeCompare(descriptor.first_key) >= 0 && id.localeCompare(descriptor.last_key) <= 0).object_id;
  assert.notEqual(shardOf("a1"), shardOf("a7"));
  const reads = [];
  const counting = { ...base, readJsonObject: async (input) => { reads.push(input.objectId); return base.readJsonObject(input); } };
  const reader = await openPrivateJournalGraph({ corpusStore: counting, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id,
    corpusId: graph.corpus_id, generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 63) });
  const page = await reader.timeline({ pageSize: 1, includeUnknown: false });
  assert.equal(page.total_matches, 7);
  assert.deepEqual(page.records.map(({ id }) => id), ["a1"]);
  // One lookup shard, for the record on the page, however many entries the window holds.
  assert.equal(new Set(reads.filter((id) => lookupShards.includes(id))).size, 1);
  reader.close();
  base.close();
});

test("search applies its time window before paging, so every page holds only matches", async () => {
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const day = (date, evidence) => ({ raw: date, from: date, to: date, precision: "day", timezone: null, basis: "explicit", evidence_ids: [evidence] });
  // a1 was written in 2020 about 2024; a3 happened in May 2021; the other assertions are undated.
  const a1 = graph.nodes.find((node) => node.id === "a1");
  a1.data.authored_time = day("2020-01-01", "p1");
  a1.data.event_time = day("2024-06-01", "p1");
  graph.nodes.find((node) => node.id === "a3").data.event_time = { raw: "May 2021", from: "2021-05", to: "2021-05", precision: "month",
    timezone: null, basis: "explicit", evidence_ids: ["p3"] };
  const store = corpusStore(await temporaryRoot(), graph.case_id, graph.corpus_id, Buffer.alloc(32, 71));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations, shardTargetBytes: 4096 });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id,
    corpusId: graph.corpus_id, generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 73) });
  const query = "help";
  const ids = async (filters) => {
    const found = [];
    let cursor = null;
    do {
      const page = await reader.search({ query, filters: { kinds: ["assertion"], ...filters }, pageSize: 1, cursor, sort: "id" });
      found.push(...page.records.map(({ id }) => id));
      cursor = page.next_cursor;
    } while (cursor);
    return found;
  };
  const everything = await ids({});
  assert.deepEqual(everything, ["a1", "a2", "a3"]);
  // Either known time can place a record: a1 is in 2020 by its writing and in 2024 by its event.
  assert.deepEqual(await ids({ from: "2020-01-01", to: "2020-12-31", include_unknown: false }), ["a1"]);
  assert.deepEqual(await ids({ from: "2024-06", include_unknown: false }), ["a1"]);
  // A window inside May 2021 overlaps the record dated only "May 2021".
  assert.deepEqual(await ids({ from: "2021-05-10", to: "2021-05-12", include_unknown: false }), ["a3"]);
  // Undated records stay in a window unless unknown time is excluded.
  assert.equal((await ids({ from: "2021-05-10", to: "2021-05-12" })).length, everything.length - 1);
  await assert.rejects(() => reader.search({ query, filters: { from: "last summer" } }), /SEARCH_FILTERS_INVALID/);
  const first = await reader.search({ query, filters: { kinds: ["assertion"] }, pageSize: 1 });
  await assert.rejects(() => reader.search({ query, filters: { kinds: ["assertion"], from: "2021-05" }, pageSize: 1, cursor: first.next_cursor }),
    /CURSOR_QUERY_MISMATCH/);
  reader.close();
  store.close();
});

test("schema-valid mocked extraction becomes a persistent searchable graph without conflating source order and time", async () => {
  const rootDir = await temporaryRoot();
  const text = "On Monday I asked for help.\n";
  const representationId = "representation:mock";
  const units = partitionRepresentation({ representationId, text });
  const unknownTime = { raw: null, from: null, to: null, precision: "unknown", timezone: null, basis: "unresolved", evidence_ids: [] };
  const anchor = { unit_id: units[0].unit_id, quote: "I asked for help.", occurrence: null };
  const extraction = {
    schema_version: "1.0",
    status: "complete",
    assertions: [{
      local_id: "assertion_local",
      statement: "I asked for help.",
      assertion_kind: "reported_action",
      narrative_mode: "waking",
      speaker_local_id: "self_local",
      subject_local_ids: ["self_local"],
      episode_local_id: "episode_local",
      polarity: "affirmed",
      qualifiers: [],
      authored_time: unknownTime,
      event_time: unknownTime,
      anchors: [anchor],
      importance_reasons: ["synthetic vertical slice"],
      extraction_confidence: "high"
    }],
    entities: [{ local_id: "self_local", label: "Synthetic diarist", entity_kind: "person", anchors: [anchor] }],
    episodes: [{ local_id: "episode_local", label: "Synthetic request", authored_time: unknownTime, event_time: unknownTime, anchors: [anchor] }],
    coverage: [{ unit_id: units[0].unit_id, disposition: "extracted", assertion_local_ids: ["assertion_local"], reason: null }],
    requested_context: []
  };
  const graph = adaptExtractionToGraph({
    caseId: "mock-case",
    corpusId: "mock-corpus",
    generation: "mock-generation",
    source: {
      id: "source:mock",
      representation_id: representationId,
      original_object_id: "original:mock",
      media_type: "text/plain",
      byte_length: Buffer.byteLength(text, "utf8"),
      parse_status: "readable"
    },
    units,
    extraction
  });
  assert.equal(graph.nodes.find(({ kind }) => kind === "episode").data.source_order, 0);
  assert.equal(graph.nodes.find(({ kind }) => kind === "episode").data.event_time.precision, "unknown");
  assert.doesNotThrow(() => validateJournalGraph(graph, { [representationId]: text }));
  const store = corpusStore(rootDir, graph.case_id, graph.corpus_id, Buffer.alloc(32, 15));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: { [representationId]: text }, shardTargetBytes: 4096 });
  const reader = await openPrivateJournalGraph({
    corpusStore: store,
    manifestObjectId: persisted.manifest_object_id,
    caseId: graph.case_id,
    corpusId: graph.corpus_id,
    generation: graph.generation,
    visibilityEpoch: 0,
    cursorSecret: Buffer.alloc(32, 16)
  });
  const result = await reader.search({ query: "Monday", graphEnabled: false });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].kind, "passage");
  reader.close();
  store.close();
});

test("encrypted graph generation supports raw search, aliases, unknown time and mandatory closure", async () => {
  const rootDir = await temporaryRoot();
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const store = corpusStore(rootDir, graph.case_id, graph.corpus_id, Buffer.alloc(32, 17));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations, shardTargetBytes: 4096 });
  const reader = await openPrivateJournalGraph({
    corpusStore: store,
    manifestObjectId: persisted.manifest_object_id,
    caseId: graph.case_id,
    corpusId: graph.corpus_id,
    generation: graph.generation,
    visibilityEpoch: 0,
    cursorSecret: Buffer.alloc(32, 19)
  });

  const graphOn = await reader.search({ query: "discomfort", graphEnabled: true });
  const graphOff = await reader.search({ query: "discomfort", graphEnabled: false });
  assert.ok(graphOn.records.some(({ id }) => id === "p4"));
  assert.deepEqual(graphOff.records.map(({ id }) => id), ["p4"]);
  assert.equal(graphOff.read_receipt.full_archive_loaded, false);
  assert.deepEqual((await reader.findEntities("A colleague")).map(({ id }) => id), ["colleague"]);
  assert.ok((await reader.timeline({ includeUnknown: true })).unknown_count >= 2);

  const closure = await reader.evidenceGroup(["a3"], { maximumNodes: 20 });
  assert.equal(closure.status, "complete");
  assert.ok(["a1", "a3", "a4", "a5", "p1", "p3", "p4", "p5"].every((id) => closure.nodes.some((node) => node.id === id)));
  assert.ok(["exception", "qualifier", "correction", "support3"].every((id) => closure.edges.some((edge) => edge.id === id)));
  // Each passage's provenance comes with it: its source and the containment edge. The source does
  // not pull in its other passages.
  assert.ok(closure.nodes.some((node) => node.id === "src"));
  assert.ok(["contains1", "contains3", "contains4", "contains5"].every((id) => closure.edges.some((edge) => edge.id === id)));
  assert.equal(closure.nodes.some((node) => ["p2", "p6", "p7"].includes(node.id)), false);
  assert.equal((await reader.evidenceGroup(["a3"], { maximumNodes: 2 })).status, "insufficient_context");
  // The closure is bounded in edges too, not only in nodes.
  assert.equal(closure.edges.length > 2, true);
  const edgeBound = await reader.evidenceGroup(["a3"], { maximumNodes: 20, maximumEdges: 2 });
  assert.deepEqual([edgeBound.status, edgeBound.edges.length, edgeBound.more_available], ["insufficient_context", 0, true]);

  const encryptedFiles = await fs.readdir(store.rootDir);
  const encryptedBodies = await Promise.all(encryptedFiles.map((name) => fs.readFile(path.join(store.rootDir, name), "utf8")));
  assert.equal(encryptedBodies.some((body) => body.includes("discomfort in my arm")), false);
  reader.close();
  store.close();
});

async function syntheticReader(rootDir) {
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const store = corpusStore(rootDir, graph.case_id, graph.corpus_id, Buffer.alloc(32, 17));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations, shardTargetBytes: 4096 });
  const reference = { active_generation: graph.generation, manifest_object_id: persisted.manifest_object_id, visibility_epoch: 0 };
  const reader = await openPrivateJournalGraph({
    corpusStore: store,
    manifestObjectId: persisted.manifest_object_id,
    caseId: graph.case_id,
    corpusId: graph.corpus_id,
    generation: graph.generation,
    visibilityEpoch: 0,
    cursorSecret: Buffer.alloc(32, 19)
  });
  return { graph, store, reader, reference };
}

test("timeline pages carry a snapshot-bound cursor that reaches every record once", async () => {
  const rootDir = await temporaryRoot();
  const { store, reader } = await syntheticReader(rootDir);
  const whole = await reader.timeline();
  assert.ok(whole.records.length > 4);
  const seen = [];
  let cursor = null;
  let first = null;
  let pages = 0;
  do {
    const page = await reader.timeline({ pageSize: 2, cursor });
    pages += 1;
    assert.equal(page.total_matches, whole.records.length);
    assert.equal(page.unknown_count, whole.unknown_count);
    assert.equal(page.more_available, page.next_cursor !== null);
    seen.push(...page.records.map(({ id }) => id));
    cursor = page.next_cursor;
    first ??= cursor;
  } while (cursor);
  assert.deepEqual(seen, whole.records.map(({ id }) => id));
  assert.equal(pages, Math.ceil(whole.records.length / 2));

  // A cursor continues only the window it was issued for, and never a search; a search cursor
  // never continues a timeline.
  await assert.rejects(() => reader.timeline({ pageSize: 2, cursor: first, includeUnknown: false }), /CURSOR_QUERY_MISMATCH/);
  await assert.rejects(() => reader.timeline({ pageSize: 2, cursor: first, from: "2026-01-01" }), /CURSOR_QUERY_MISMATCH/);
  await assert.rejects(() => reader.search({ query: "discomfort", pageSize: 2, cursor: first }), /CURSOR_QUERY_MISMATCH/);
  const search = await reader.search({ query: "discomfort", pageSize: 1 });
  assert.equal(typeof search.next_cursor, "string");
  await assert.rejects(() => reader.timeline({ pageSize: 2, cursor: search.next_cursor }), /CURSOR_QUERY_MISMATCH/);
  const [body] = first.split(".");
  await assert.rejects(() => reader.timeline({ pageSize: 2, cursor: `${body}.${Buffer.alloc(32).toString("base64url")}` }), /CURSOR_MAC_INVALID/);
  await assert.rejects(() => reader.timeline({ cursor: first }), /TIMELINE_CURSOR_REQUIRES_PAGE_SIZE/);
  await assert.rejects(() => reader.timeline({ pageSize: 0 }), /TIMELINE_PAGE_SIZE_INVALID/);
  reader.close();
  store.close();
});

test("the timeline places a record at each of its known times and says which field put it there", async () => {
  const rootDir = await temporaryRoot();
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const day = (date, evidence) => ({ raw: date, from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.999Z`, precision: "day", timezone: "UTC", basis: "explicit", evidence_ids: [evidence] });
  const a1 = graph.nodes.find(({ id }) => id === "a1");
  const a2 = graph.nodes.find(({ id }) => id === "a2");
  // Written in 2020 about an event in 2024; and one written on the day it describes.
  a1.data.authored_time = day("2020-01-01", "p1");
  a1.data.event_time = day("2024-06-01", "p1");
  a2.data.authored_time = day("2022-03-03", "p2");
  a2.data.event_time = day("2022-03-03", "p2");
  // Open at one end: after a date, and before one.
  const a3 = graph.nodes.find(({ id }) => id === "a3");
  const a4 = graph.nodes.find(({ id }) => id === "a4");
  a3.data.event_time = { raw: "after May 2021", from: "2021-05-01T00:00:00.000Z", to: null, precision: "interval", timezone: "UTC", basis: "explicit", evidence_ids: ["p3"] };
  a4.data.event_time = { raw: "before 2019", from: null, to: "2018-12-31T23:59:59.999Z", precision: "interval", timezone: "UTC", basis: "explicit", evidence_ids: ["p4"] };
  const store = corpusStore(rootDir, graph.case_id, graph.corpus_id, Buffer.alloc(32, 17));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations, shardTargetBytes: 4096 });
  const reader = await openPrivateJournalGraph({
    corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id, corpusId: graph.corpus_id,
    generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 19)
  });
  const describe = (records) => records.map(({ id, timeline_entry }) => [id, timeline_entry.lane, timeline_entry.fields.join("+"), timeline_entry.from?.slice(0, 10) ?? null]);
  const whole = await reader.timeline();
  // An interval open at its start ("before 2019") sits at its end, the latest it can be.
  assert.deepEqual(describe(whole.records.filter(({ timeline_entry }) => timeline_entry.lane === "known")), [
    ["a4", "known", "event_time", null],
    ["a1", "known", "authored_time", "2020-01-01"],
    ["a3", "known", "event_time", "2021-05-01"],
    ["a2", "known", "authored_time+event_time", "2022-03-03"],
    ["a1", "known", "event_time", "2024-06-01"]
  ]);
  // Records with a known time never also sit in the unknown lane.
  assert.deepEqual(whole.records.filter(({ timeline_entry }) => timeline_entry.lane === "unknown").map(({ id }) => id).sort(),
    ["a5", "a6", "a7", "ep1", "ep2"]);
  assert.equal(whole.unknown_count, 5);
  // An interval open at its end stays in every later window, and one open at its start in every earlier one.
  const window = await reader.timeline({ from: "2024-01-01T00:00:00.000Z", includeUnknown: false });
  assert.deepEqual(describe(window.records), [["a3", "known", "event_time", "2021-05-01"], ["a1", "known", "event_time", "2024-06-01"]]);
  const early = await reader.timeline({ to: "2019-06-01", includeUnknown: false });
  assert.deepEqual(describe(early.records), [["a4", "known", "event_time", null]]);
  // Date-only bounds, as the web page sends them, include the whole of their days.
  const oneDay = await reader.timeline({ from: "2024-06-01", to: "2024-06-01", includeUnknown: false });
  assert.deepEqual(describe(oneDay.records), [["a3", "known", "event_time", "2021-05-01"], ["a1", "known", "event_time", "2024-06-01"]]);
  reader.close();
  store.close();
});

test("timeline bounds cover their whole period, and a query bound must be one", async () => {
  const rootDir = await temporaryRoot();
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const time = (from, to, evidence) => ({ raw: "synthetic", from, to, precision: "interval", timezone: null, basis: "explicit", evidence_ids: [evidence] });
  // A month, a day inside it, a time on that day, and a year.
  graph.nodes.find(({ id }) => id === "a1").data.event_time = time("2021-05", "2021-05", "p1");
  graph.nodes.find(({ id }) => id === "a2").data.event_time = time("2021-05-14", "2021-05-14", "p2");
  graph.nodes.find(({ id }) => id === "a3").data.event_time = time("2021-05-14T09:30Z", "2021-05-14T10:00Z", "p3");
  graph.nodes.find(({ id }) => id === "a4").data.event_time = time("2020", "2020", "p4");
  const store = corpusStore(rootDir, graph.case_id, graph.corpus_id, Buffer.alloc(32, 17));
  const persisted = await persistGraphGeneration({ corpusStore: store, graph, sourceRepresentations: representations, shardTargetBytes: 4096 });
  const reader = await openPrivateJournalGraph({
    corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id, corpusId: graph.corpus_id,
    generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 19)
  });
  const ids = async (query) => (await reader.timeline({ ...query, includeUnknown: false })).records.map(({ id }) => id);
  // Ordered by start, a coarser period before the finer ones it contains.
  assert.deepEqual(await ids({}), ["a4", "a1", "a2", "a3"]);
  // A window inside May 2021 still overlaps the record dated only "May 2021".
  assert.deepEqual(await ids({ from: "2021-05-10", to: "2021-05-12" }), ["a1"]);
  assert.deepEqual(await ids({ from: "2021-05-14", to: "2021-05-14" }), ["a1", "a2", "a3"]);
  // A coarse query bound covers its whole period too: "to 2021-05" includes May 14.
  assert.deepEqual(await ids({ from: "2021-01", to: "2021-05" }), ["a1", "a2", "a3"]);
  assert.deepEqual(await ids({ from: "2021-05-14T10:01" }), ["a1", "a2"]);
  assert.deepEqual(await ids({ to: "2020-12-31" }), ["a4"]);
  for (const bad of ["last summer", "2021-02-30", "2021-05-14T09:30+02:00"]) {
    await assert.rejects(() => reader.timeline({ from: bad }), /TIMELINE_QUERY_INVALID/);
    await assert.rejects(() => reader.timeline({ to: bad }), /TIMELINE_QUERY_INVALID/);
  }
  reader.close();
  store.close();
});

test("the timeline tool returns the cursor for its next page", async () => {
  const rootDir = await temporaryRoot();
  const { graph, store, reader, reference } = await syntheticReader(rootDir);
  const whole = (await reader.timeline()).records.map(({ id }) => id);
  reader.close();
  const api = createJournalPrivateApi({ caseAccessService: {
    async withJournalCorpus(caseId, corpusId, request, operation) {
      assert.deepEqual([caseId, corpusId, request.requiredScope], [graph.case_id, graph.corpus_id, "case:read"]);
      return operation({
        caseStore: { async getJournalCorpus() { return { reference }; } },
        corpusStore: store,
        cursorSecret: Buffer.alloc(32, 19),
        reference
      });
    }
  } });
  const input = { caseId: graph.case_id, corpusId: graph.corpus_id, pageSize: 4 };
  const seen = [];
  let cursor = null;
  do {
    const page = await api.timeline({ ...input, cursor }, {});
    assert.equal(page.more_available, page.next_cursor !== null);
    seen.push(...page.items.map(({ id }) => id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, whole);
  store.close();
});

test("snapshot cursors traverse 1001 matches without gaps or duplicates and reject another case", async () => {
  const rootDir = await temporaryRoot();
  const first = passageGraph();
  const firstStore = corpusStore(rootDir, first.graph.case_id, first.graph.corpus_id, Buffer.alloc(32, 21));
  const persisted = await persistGraphGeneration({ corpusStore: firstStore, graph: first.graph, sourceRepresentations: first.representations, shardTargetBytes: 8192 });
  const cursorSecret = Buffer.alloc(32, 23);
  const reader = await openPrivateJournalGraph({
    corpusStore: firstStore,
    manifestObjectId: persisted.manifest_object_id,
    caseId: first.graph.case_id,
    corpusId: first.graph.corpus_id,
    generation: first.graph.generation,
    visibilityEpoch: 0,
    cursorSecret
  });

  const narrow = await reader.search({ query: "uniqueterm", graphEnabled: false });
  assert.deepEqual(narrow.records.map(({ id }) => id), ["passage:000713"]);
  assert.ok(narrow.read_receipt.encrypted_objects_read < persisted.manifest.record_shards.length);
  // A broad query is filtered and ordered from the lookup index: one page decrypts only its own records.
  const broadPage = await reader.search({ query: "needle", graphEnabled: false, pageSize: 10 });
  assert.equal(broadPage.total_matches, 1001);
  assert.ok(broadPage.read_receipt.encrypted_objects_read < persisted.manifest.record_shards.length / 2);

  const seen = [];
  let cursor = null;
  let firstCursor = null;
  do {
    const page = await reader.search({ query: "needle", graphEnabled: false, pageSize: 73, cursor });
    seen.push(...page.records.map(({ id }) => id));
    cursor = page.next_cursor;
    firstCursor ??= cursor;
  } while (cursor);
  assert.equal(seen.length, 1001);
  assert.equal(new Set(seen).size, 1001);
  assert.deepEqual(seen, [...seen].sort());

  const second = passageGraph({ caseId: "other-case", corpusId: "other-corpus", count: 1 });
  const secondStore = corpusStore(rootDir, second.graph.case_id, second.graph.corpus_id, Buffer.alloc(32, 25));
  const secondPersisted = await persistGraphGeneration({ corpusStore: secondStore, graph: second.graph, sourceRepresentations: second.representations, shardTargetBytes: 8192 });
  const secondReader = await openPrivateJournalGraph({
    corpusStore: secondStore,
    manifestObjectId: secondPersisted.manifest_object_id,
    caseId: second.graph.case_id,
    corpusId: second.graph.corpus_id,
    generation: second.graph.generation,
    visibilityEpoch: 0,
    cursorSecret
  });
  await assert.rejects(() => secondReader.search({ query: "needle", graphEnabled: false, pageSize: 73, cursor: firstCursor }), /CURSOR_SCOPE_MISMATCH/);
  reader.close();
  secondReader.close();
  firstStore.close();
  secondStore.close();
});

test("a generation whose lookup index predates record facts is still searched and paged the same way", async () => {
  const rootDir = await temporaryRoot();
  const { graph, representations } = passageGraph({ count: 120 });
  const store = corpusStore(rootDir, graph.case_id, graph.corpus_id, Buffer.alloc(32, 47));
  // Write the lookup index as earlier generations did: object locations only.
  const legacyStore = Object.create(store, { writeJsonObject: { value: ({ objectId, value }) => store.writeJsonObject({ objectId,
    value: value?.name === "record_lookup" ? { ...value, entries: value.entries.map(([key, locations]) => [key, locations.map(({ object_id }) => ({ object_id }))]) } : value }) } });
  const persisted = await persistGraphGeneration({ corpusStore: legacyStore, graph, sourceRepresentations: representations, shardTargetBytes: 8192 });
  const reader = await openPrivateJournalGraph({ corpusStore: store, manifestObjectId: persisted.manifest_object_id, caseId: graph.case_id,
    corpusId: graph.corpus_id, generation: graph.generation, visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 49) });
  const seen = [];
  let cursor = null;
  do {
    const page = await reader.search({ query: "needle", graphEnabled: false, pageSize: 25, cursor });
    assert.equal(page.total_matches, 120);
    seen.push(...page.records.map(({ id }) => id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, graph.nodes.filter(({ kind }) => kind === "passage").map(({ id }) => id));
  reader.close();
  store.close();
});

test("graph validation rejects vanished qualifiers, duplicate support and unsupported causation", () => {
  const graph = fixture("synthetic-graph.json");
  const representations = fixture("synthetic-sources.json");
  const vanished = structuredClone(graph);
  vanished.nodes = vanished.nodes.filter(({ id }) => id !== "a4");
  assert.throws(() => validateJournalGraph(vanished, representations), /DANGLING_OR_WRONG_KIND|ACTIVE_DEPENDS_ON_REVOKED/);

  const duplicate = structuredClone(graph);
  duplicate.edges.push({ ...structuredClone(duplicate.edges.find(({ id }) => id === "support1")), id: "support1duplicate" });
  assert.throws(() => validateJournalGraph(duplicate, representations), /EVIDENCE_EDGE_MISMATCH/);

  const unsupported = structuredClone(graph);
  unsupported.edges.push({
    id: "unsupportedcause",
    case_id: graph.case_id,
    corpus_id: graph.corpus_id,
    version: 1,
    lifecycle: "active",
    relation: "causes",
    from: "a4",
    to: "a3",
    evidence_ids: ["p4"],
    basis: "derived_proposal",
    derivation_ref: "invented"
  });
  assert.throws(() => validateJournalGraph(unsupported, representations), /Journal payload does not satisfy|JOURNAL_SCHEMA_INVALID/);
});
