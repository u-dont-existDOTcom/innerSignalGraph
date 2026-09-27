import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { timeBoundOrderKey, validateExtractionReferences, validateJournalGraph } from "./contracts.mjs";
import { resolveUnitQuote } from "./anchors.mjs";
import { JOURNAL_OBJECT_PAYLOAD_MAX_BYTES } from "../storage/private-journal-corpus.mjs";

const DEFAULT_SHARD_TARGET_BYTES = 1024 * 1024;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const active = (record) => !["deleted", "revoked"].includes(record.lifecycle);

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

export function lexicalTerms(value) {
  if (typeof value !== "string") return [];
  return [...new Set(value.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}]+/gu) ?? [])];
}

export function adaptExtractionToGraph({ caseId, corpusId, generation, source, units, extraction, producerRef = "mock-extractor", localIdNamespace = "" }) {
  const checked = validateExtractionReferences(extraction, units.map(({ unit_id: unitId }) => unitId));
  invariant(source && typeof source === "object" && typeof source.id === "string", "GRAPH_SOURCE_INVALID");
  const prefix = (kind, localId) => `${kind}:${sha256(Buffer.from(`${caseId}\0${corpusId}\0${generation}\0${localIdNamespace ? `${localIdNamespace}\0` : ""}${localId}`, "utf8")).slice(0, 32)}`;
  const common = (id, kind) => ({ id, case_id: caseId, corpus_id: corpusId, version: 1, lifecycle: "active", kind });
  const passageNodes = new Map();
  const passageIdsByUnit = new Map();
  const restrictedUnits = new Set([...checked.entities, ...checked.episodes, ...checked.assertions].flatMap((x) => x.anchors).filter((a) => a.anchor_kind === "restricted_source_pointer").map((a) => a.unit_id));
  const registerPassage = ({ representationId, unitId, startByte, endByte, quote, quoteSha256, restricted = false }) => {
    const id = prefix("passage", `${representationId}:${startByte}:${endByte}:${quoteSha256}${restricted ? ":restricted" : ""}`);
    if (!passageNodes.has(id)) {
      passageNodes.set(id, {
        ...common(id, "passage"),
        data: {
          representation_id: representationId,
          unit_id: unitId,
          start_byte: startByte,
          end_byte: endByte,
          quote: restricted ? null : quote,
          quote_sha256: quoteSha256,
          ...(restricted ? { disclosure: "restricted" } : {}),
          locator: {
            kind: source.locator_kind ?? "native_text",
            page: source.page ?? null,
            bbox: null,
            original_object_id: source.original_object_id,
            interpretation_status: source.interpretation_status ?? "native"
          }
        }
      });
      if (!passageIdsByUnit.has(unitId)) passageIdsByUnit.set(unitId, []);
      passageIdsByUnit.get(unitId).push(id);
    }
    return id;
  };
  for (const unit of units) {
    if (unit.text.length > 0) registerPassage({
      representationId: unit.representation_id,
      unitId: unit.unit_id,
      startByte: unit.start_byte,
      endByte: unit.end_byte,
      quote: unit.text,
      quoteSha256: unit.sha256,
      restricted: restrictedUnits.has(unit.unit_id)
    });
  }
  const passagesForAnchors = (anchors) => [...new Set(anchors.map((anchor) => {
    if (anchor.anchor_kind === "restricted_source_pointer") {
      const unit = units.find((u) => u.unit_id === anchor.unit_id);
      invariant(unit, "ANCHOR_UNIT_NOT_FOUND");
      return registerPassage({ representationId: unit.representation_id, unitId: unit.unit_id, startByte: unit.start_byte, endByte: unit.end_byte, quote: null, quoteSha256: unit.sha256, restricted: true });
    }
    invariant(!Object.hasOwn(anchor, "anchor_kind"), "VISUAL_ANCHOR_REQUIRES_VERIFIED_TRANSCRIPTION");
    const resolved = resolveUnitQuote(units, anchor);
    return registerPassage({
      representationId: resolved.representation_id,
      unitId: resolved.unit_id,
      startByte: resolved.start_byte,
      endByte: resolved.end_byte,
      quote: resolved.quote,
      quoteSha256: resolved.quote_sha256
    });
  }))];
  const entityId = new Map(checked.entities.map(({ local_id: localId }) => [localId, prefix("entity", localId)]));
  const episodeId = new Map(checked.episodes.map(({ local_id: localId }) => [localId, prefix("episode", localId)]));
  const assertionId = new Map(checked.assertions.map(({ local_id: localId }) => [localId, prefix("assertion", localId)]));

  for (const entity of checked.entities) passagesForAnchors(entity.anchors);
  for (const episode of checked.episodes) passagesForAnchors(episode.anchors);
  for (const assertion of checked.assertions) passagesForAnchors(assertion.anchors);
  const localEvidence = new Map([...checked.entities, ...checked.episodes, ...checked.assertions].map((item) => [item.local_id, passagesForAnchors(item.anchors)]));
  const resolveTime = (time) => ({
    ...structuredClone(time),
    evidence_ids: [...new Set(time.evidence_ids.flatMap((id) => {
      const resolved = passageNodes.has(id) ? [id] : (localEvidence.get(id) ?? passageIdsByUnit.get(id));
      invariant(resolved, "TIME_EVIDENCE_REFERENCE_UNRESOLVED");
      return resolved;
    }))]
  });
  const sourceOrder = (anchors) => Math.min(...anchors.map(({ unit_id: unitId }) => units.find((unit) => unit.unit_id === unitId)?.source_order ?? units.findIndex((unit) => unit.unit_id === unitId)).filter((index) => index >= 0));
  const nodes = [{
    ...common(source.id, "source"),
    data: {
      representation_id: source.representation_id,
      original_object_id: source.original_object_id,
      media_type: source.media_type,
      byte_length: source.byte_length,
      parse_status: source.parse_status
    }
  }];
  for (const passage of passageNodes.values()) nodes.push(passage);
  for (const entity of checked.entities) nodes.push({
    ...common(entityId.get(entity.local_id), "entity"),
    data: { label: entity.label, entity_kind: entity.entity_kind, aliases: [], evidence_ids: passagesForAnchors(entity.anchors) }
  });
  for (const episode of checked.episodes) nodes.push({
    ...common(episodeId.get(episode.local_id), "episode"),
    data: {
      label: episode.label,
      authored_time: resolveTime(episode.authored_time),
      event_time: resolveTime(episode.event_time),
      source_order: sourceOrder(episode.anchors),
      evidence_ids: passagesForAnchors(episode.anchors),
      support_group_id: prefix("support", episode.local_id)
    }
  });
  for (const assertion of checked.assertions) nodes.push({
    ...common(assertionId.get(assertion.local_id), "assertion"),
    data: {
      statement: assertion.statement,
      assertion_kind: assertion.assertion_kind,
      narrative_mode: assertion.narrative_mode,
      speaker_id: entityId.get(assertion.speaker_local_id),
      subject_ids: assertion.subject_local_ids.map((id) => entityId.get(id)),
      episode_id: assertion.episode_local_id === null ? null : episodeId.get(assertion.episode_local_id),
      polarity: assertion.polarity,
      qualifiers: structuredClone(assertion.qualifiers),
      authored_time: resolveTime(assertion.authored_time),
      event_time: resolveTime(assertion.event_time),
      still_current: null,
      evidence_ids: passagesForAnchors(assertion.anchors),
      review_state: "unreviewed",
      extraction_confidence: assertion.extraction_confidence,
      producer_ref: producerRef,
      support_group_id: assertion.episode_local_id === null ? prefix("support", assertion.local_id) : prefix("support", assertion.episode_local_id)
    }
  });
  const edges = [];
  const edge = (relation, from, to, evidence, suffix) => edges.push({
    id: prefix("edge", `${relation}:${from}:${to}:${suffix}`),
    case_id: caseId,
    corpus_id: corpusId,
    version: 1,
    lifecycle: "active",
    relation,
    from,
    to,
    evidence_ids: [...new Set(evidence)],
    basis: "direct_source",
    derivation_ref: null
  });
  for (const [index, passage] of [...passageNodes.values()].entries()) edge("contains", source.id, passage.id, [passage.id], index);
  for (const assertion of checked.assertions) {
    const from = assertionId.get(assertion.local_id);
    const evidence = passagesForAnchors(assertion.anchors);
    evidence.forEach((passageId, index) => edge("supported_by", from, passageId, [passageId], index));
    if (assertion.episode_local_id !== null) edge("in_episode", from, episodeId.get(assertion.episode_local_id), evidence, "episode");
  }
  const graph = { schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation, nodes, edges };
  return Object.freeze(graph);
}

function recordText(record) {
  if (record.kind === "passage") return [record.data.quote];
  if (record.kind === "entity") return [record.data.label, ...record.data.aliases];
  if (record.kind === "episode" || record.kind === "theme") return [record.data.label];
  if (record.kind === "assertion") return [record.data.statement, ...record.data.qualifiers];
  if (record.kind === "pattern") return [record.data.statement, record.data.scope, ...record.data.alternative_explanations];
  return [];
}

function evidenceIds(record) {
  if (Array.isArray(record.evidence_ids)) return record.evidence_ids;
  if (Array.isArray(record.data?.evidence_ids)) return record.data.evidence_ids;
  if (record.kind === "pattern") return [...record.data.support_assertion_ids, ...record.data.counter_assertion_ids];
  return [];
}

function timeEntries(record) {
  if (!["episode", "assertion"].includes(record.kind)) return [];
  const result = [];
  for (const field of ["authored_time", "event_time"]) {
    const time = record.data[field];
    result.push({
      id: record.id,
      kind: record.kind,
      field,
      from: time.from,
      to: time.to,
      precision: time.precision,
      source_order: record.data.source_order ?? null
    });
  }
  return result;
}

export function buildGraphIndexes(graph) {
  const lexical = new Map();
  const aliases = new Map();
  const adjacency = new Map();
  const reverseDependencies = new Map();
  const kinds = new Map();
  const timeKnown = [];
  const timeUnknown = [];
  const records = [...graph.nodes, ...graph.edges];
  for (const record of records) {
    if (!active(record)) continue;
    add(kinds, record.kind ?? `edge:${record.relation}`, record.id);
    for (const text of recordText(record)) for (const term of lexicalTerms(text)) add(lexical, term, record.id);
    if (record.kind === "entity") {
      for (const alias of [record.data.label, ...record.data.aliases]) add(aliases, alias.normalize("NFKC").toLocaleLowerCase("und"), record.id);
    }
    for (const evidenceId of evidenceIds(record)) add(reverseDependencies, evidenceId, record.id);
    for (const entry of timeEntries(record)) {
      (entry.from === null && entry.to === null ? timeUnknown : timeKnown).push(entry);
    }
  }
  for (const edge of graph.edges.filter(active)) {
    add(adjacency, edge.from, edge.id);
    add(adjacency, edge.to, edge.id);
  }
  // Known intervals in order of their start, compared as text, which for validated bounds is time
  // order (a coarser bound, "2021-05", sorts before the finer ones it contains). One open at the
  // start ("before 2019") is placed at its end, the latest it can be, rather than wherever the
  // string "null" happens to sort.
  const position = (entry) => timeBoundOrderKey(entry.from ?? entry.to);
  const byText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
  timeKnown.sort((left, right) => byText(position(left), position(right)) || left.id.localeCompare(right.id) || left.field.localeCompare(right.field));
  timeUnknown.sort((left, right) => (left.source_order ?? Number.MAX_SAFE_INTEGER) - (right.source_order ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id) || left.field.localeCompare(right.field));
  const serializable = (map) => new Map([...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => [key, [...values].sort()]));
  return Object.freeze({
    lexical: serializable(lexical),
    aliases: serializable(aliases),
    adjacency: serializable(adjacency),
    reverse_dependencies: serializable(reverseDependencies),
    kinds: serializable(kinds),
    time_known: new Map([["known", timeKnown]]),
    time_unknown: new Map([["unknown", timeUnknown]])
  });
}

function packRecords(records, targetBytes) {
  const shards = [];
  let current = [];
  let estimated = 64;
  for (const record of records) {
    const itemBytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    invariant(itemBytes < targetBytes, "GRAPH_RECORD_EXCEEDS_SHARD_TARGET");
    if (current.length && estimated + itemBytes > targetBytes) {
      shards.push(current);
      current = [];
      estimated = 64;
    }
    current.push(record);
    estimated += itemBytes;
  }
  if (current.length) shards.push(current);
  return shards;
}

function postingPieces(index, targetBytes) {
  const pieces = [];
  for (const [key, values] of index.entries()) {
    let current = [];
    let size = Buffer.byteLength(JSON.stringify(key), "utf8") + 32;
    for (const value of values) {
      const itemBytes = Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
      invariant(itemBytes + 64 < targetBytes, "GRAPH_INDEX_VALUE_TOO_LARGE");
      if (current.length && size + itemBytes > targetBytes) {
        pieces.push([key, current]);
        current = [];
        size = Buffer.byteLength(JSON.stringify(key), "utf8") + 32;
      }
      current.push(value);
      size += itemBytes;
    }
    pieces.push([key, current]);
  }
  return pieces;
}

function packIndex(index, targetBytes) {
  const shards = [];
  let current = [];
  let estimated = 64;
  for (const piece of postingPieces(index, Math.floor(targetBytes * 0.8))) {
    const pieceBytes = Buffer.byteLength(JSON.stringify(piece), "utf8") + 1;
    if (current.length && estimated + pieceBytes > targetBytes) {
      shards.push(current);
      current = [];
      estimated = 64;
    }
    current.push(piece);
    estimated += pieceBytes;
  }
  if (current.length) shards.push(current);
  return shards;
}

// What search and the timeline need to filter and order a record without decrypting it: its
// kind, lifecycle and source order, the same order the reader sorts by.
function recordLookupFacts(record) {
  return {
    kind: record.kind ?? null,
    lifecycle: record.lifecycle ?? null,
    order: record.kind === "passage" ? record.data.start_byte : (record.data?.source_order ?? null)
  };
}

function contentRef(reference, extra = {}) {
  return {
    object_id: reference.object_id,
    object_version: reference.object_version,
    byte_length: reference.byte_length,
    sha256: reference.sha256,
    ...extra
  };
}

export async function persistGraphGeneration({
  corpusStore,
  graph,
  sourceRepresentations,
  visibilityEpoch = 0,
  permittedUses = ["archive", "organize_search"],
  archiveReferences = [],
  shardTargetBytes = DEFAULT_SHARD_TARGET_BYTES
}) {
  invariant(corpusStore && typeof corpusStore.writeJsonObject === "function", "CORPUS_STORE_INVALID");
  invariant(Number.isSafeInteger(visibilityEpoch) && visibilityEpoch >= 0, "VISIBILITY_EPOCH_INVALID");
  invariant(Number.isSafeInteger(shardTargetBytes) && shardTargetBytes >= 4096, "SHARD_TARGET_INVALID");
  const allowedUses = new Set(["archive", "organize_search", "session_use"]);
  invariant(Array.isArray(permittedUses) && permittedUses.length > 0
    && permittedUses.every((use) => allowedUses.has(use)), "PERMITTED_USES_INVALID");
  const normalizedPermittedUses = [...new Set(permittedUses)].sort();
  validateJournalGraph(graph, sourceRepresentations);
  const generationTag = sha256(Buffer.from(graph.generation, "utf8")).slice(0, 20);
  const records = [...graph.nodes, ...graph.edges].sort((left, right) => left.id.localeCompare(right.id));
  const recordShards = [];
  const recordLookup = new Map();
  for (const [index, shard] of packRecords(records, shardTargetBytes).entries()) {
    const objectId = `graph:${generationTag}:records:${String(index).padStart(6, "0")}`;
    const reference = await corpusStore.writeJsonObject({ objectId, value: { schema_version: "1.0", records: shard } });
    recordShards.push(contentRef(reference, { record_count: shard.length }));
    for (const record of shard) recordLookup.set(record.id, [{ object_id: objectId, ...recordLookupFacts(record) }]);
  }
  const indexes = { ...buildGraphIndexes(graph), record_lookup: recordLookup };
  const indexDirectories = {};
  for (const [name, index] of Object.entries(indexes)) {
    const descriptors = [];
    for (const [shardIndex, entries] of packIndex(index, shardTargetBytes).entries()) {
      const objectId = `graph:${generationTag}:index:${name}:${String(shardIndex).padStart(6, "0")}`;
      const reference = await corpusStore.writeJsonObject({ objectId, value: { schema_version: "1.0", name, entries } });
      const keys = entries.map(([key]) => key).sort((left, right) => left.localeCompare(right));
      descriptors.push(contentRef(reference, { first_key: keys[0], last_key: keys.at(-1), entry_count: entries.length }));
    }
    indexDirectories[name] = descriptors;
  }
  const sourceRepresentationObjects = {};
  for (const [index, [representationId, text]] of Object.entries(sourceRepresentations).sort(([left], [right]) => left.localeCompare(right)).entries()) {
    const objectId = `graph:${generationTag}:representation:${String(index).padStart(6, "0")}`;
    const value = {
      schema_version: "1.0",
      representation_id: representationId,
      text,
      utf8_byte_length: Buffer.byteLength(text, "utf8"),
      sha256: sha256(Buffer.from(text, "utf8"))
    };
    // A representation that fits one object is stored as one, as before. A larger one, such as a
    // long text journal, is stored as UTF-8 chunks, so no source that intake accepts fails here.
    if (Buffer.byteLength(JSON.stringify(value), "utf8") <= JOURNAL_OBJECT_PAYLOAD_MAX_BYTES) {
      sourceRepresentationObjects[representationId] = contentRef(await corpusStore.writeJsonObject({ objectId, value }));
      continue;
    }
    invariant(typeof corpusStore.writeChunkedOriginal === "function", "CORPUS_STORE_INVALID");
    const chunked = await corpusStore.writeChunkedOriginal({ objectId, bytes: Buffer.from(text, "utf8") });
    sourceRepresentationObjects[representationId] = { ...structuredClone(chunked), representation_id: representationId, encoding: "utf8_chunks" };
  }
  const manifestObjectId = `graph:${generationTag}:manifest`;
  const manifest = {
    schema_version: "1.0",
    case_id: graph.case_id,
    corpus_id: graph.corpus_id,
    generation: graph.generation,
    visibility_epoch: visibilityEpoch,
    graph_sha256: sha256(Buffer.from(JSON.stringify(graph), "utf8")),
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    permitted_uses: normalizedPermittedUses,
    archive_references: structuredClone(archiveReferences),
    record_shards: recordShards,
    indexes: indexDirectories,
    source_representation_objects: sourceRepresentationObjects,
    source_representations: Object.fromEntries(Object.entries(sourceRepresentations).map(([id, text]) => [id, {
      utf8_byte_length: Buffer.byteLength(text, "utf8"),
      sha256: sha256(Buffer.from(text, "utf8"))
    }]))
  };
  const manifestReference = await corpusStore.writeJsonObject({ objectId: manifestObjectId, value: manifest });
  return Object.freeze({ manifest, manifest_reference: contentRef(manifestReference), manifest_object_id: manifestObjectId });
}
