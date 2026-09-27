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
  assert.equal((await reader.evidenceGroup(["a3"], { maximumNodes: 2 })).status, "insufficient_context");

  const encryptedFiles = await fs.readdir(store.rootDir);
  const encryptedBodies = await Promise.all(encryptedFiles.map((name) => fs.readFile(path.join(store.rootDir, name), "utf8")));
  assert.equal(encryptedBodies.some((body) => body.includes("discomfort in my arm")), false);
  reader.close();
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
