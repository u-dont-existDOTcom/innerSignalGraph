import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_GRAPH_CONTRACT } from "./contracts.mjs";
import { lexicalTerms } from "./graph.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const active = (record) => !["deleted", "revoked"].includes(record.lifecycle);

function evidenceIds(record) {
  if (Array.isArray(record.evidence_ids)) return record.evidence_ids;
  if (Array.isArray(record.data?.evidence_ids)) return record.data.evidence_ids;
  if (record.kind === "pattern") return [...record.data.support_assertion_ids, ...record.data.counter_assertion_ids];
  return [];
}

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

function stableFilters(filters) {
  return {
    kinds: Array.isArray(filters?.kinds) ? [...new Set(filters.kinds)].sort() : [],
    lifecycles: Array.isArray(filters?.lifecycles) ? [...new Set(filters.lifecycles)].sort() : ["active", "candidate", "superseded"]
  };
}

function intersection(lists) {
  if (!lists.length) return [];
  const [first, ...rest] = [...lists].sort((left, right) => left.length - right.length);
  const sets = rest.map(list => new Set(list));
  return [...new Set(first)].filter((id) => sets.every((set) => set.has(id)));
}

export async function openPrivateJournalGraph({
  corpusStore,
  manifestObjectId,
  caseId,
  corpusId,
  generation,
  visibilityEpoch,
  purpose = "organize_search",
  cursorSecret,
  assertSnapshotCurrent = async () => true,
  now = () => Date.now(),
  cursorTtlMs = 15 * 60 * 1000
}) {
  invariant(corpusStore && typeof corpusStore.readJsonObject === "function", "CORPUS_STORE_INVALID");
  invariant(cursorSecret instanceof Uint8Array && cursorSecret.byteLength >= 32, "CURSOR_SECRET_INVALID");
  invariant(["organize_search", "session_use"].includes(purpose), "RETRIEVAL_PURPOSE_INVALID");
  invariant(typeof assertSnapshotCurrent === "function", "SNAPSHOT_GUARD_INVALID");
  const secret = Buffer.from(cursorSecret);
  const cache = new Map();
  const indexMaps = new Map();
  const recordMaps = new Map();
  let objectReads = 0;
  const assertCurrent = async () => invariant((await assertSnapshotCurrent()) !== false, "CURSOR_STALE");
  const memoized = (map, id, load) => {
    if (!map.has(id)) {
      const pending = Promise.resolve().then(load);
      map.set(id, pending);
      pending.catch(() => { if (map.get(id) === pending) map.delete(id); });
    }
    return map.get(id);
  };
  const readJson = (objectId) => memoized(cache, objectId, async () => {
    const value = await corpusStore.readJsonObject({ objectId });
    objectReads += 1;
    return value;
  });
  const manifest = await readJson(manifestObjectId);
  invariant(manifest.case_id === caseId && manifest.corpus_id === corpusId, "GRAPH_MANIFEST_SCOPE_MISMATCH");
  invariant(manifest.generation === generation && manifest.visibility_epoch === visibilityEpoch, "GRAPH_SNAPSHOT_MISMATCH");

  const readIndex = async (name, key) => {
    const directory = manifest.indexes[name];
    invariant(Array.isArray(directory), "GRAPH_INDEX_MISSING");
    const descriptors = directory.filter((descriptor) => key.localeCompare(descriptor.first_key) >= 0 && key.localeCompare(descriptor.last_key) <= 0);
    const values = [];
    for (const descriptor of descriptors) {
      const index = await memoized(indexMaps, descriptor.object_id, async () => {
        const shard = await readJson(descriptor.object_id);
        const entries = new Map();
        for (const [entryKey, entryValues] of shard.entries) {
          if (!entries.has(entryKey)) entries.set(entryKey, []);
          entries.get(entryKey).push(...entryValues);
        }
        return entries;
      });
      values.push(...(index.get(key) ?? []));
    }
    return values;
  };

  const loadRecord = async (id) => {
    const locations = await readIndex("record_lookup", id);
    invariant(locations.length === 1 && typeof locations[0]?.object_id === "string", "GRAPH_RECORD_LOOKUP_INVALID");
    const objectId = locations[0].object_id;
    const records = await memoized(recordMaps, objectId, async () => {
      const shard = await readJson(objectId);
      return new Map(shard.records.map(record => [record.id, record]));
    });
    const record = records.get(id);
    invariant(record, "GRAPH_RECORD_MISSING");
    invariant(record.case_id === caseId && record.corpus_id === corpusId, "GRAPH_RECORD_SCOPE_MISMATCH");
    return record;
  };

  const signCursor = (body) => {
    const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const mac = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${mac}`;
  };
  const parseCursor = (cursor, expected) => {
    const parts = typeof cursor === "string" ? cursor.split(".") : [];
    invariant(parts.length === 2, "CURSOR_INVALID");
    const expectedMac = createHmac("sha256", secret).update(parts[0]).digest();
    let actualMac;
    try { actualMac = Buffer.from(parts[1], "base64url"); }
    catch { throw new ValidationError("CURSOR_INVALID", { code: "CURSOR_INVALID" }); }
    invariant(actualMac.byteLength === expectedMac.byteLength && timingSafeEqual(actualMac, expectedMac), "CURSOR_MAC_INVALID");
    let body;
    try { body = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
    catch { throw new ValidationError("CURSOR_INVALID", { code: "CURSOR_INVALID" }); }
    invariant(body.case_id === caseId && body.corpus_id === corpusId, "CURSOR_SCOPE_MISMATCH");
    invariant(body.purpose === purpose, "CURSOR_PURPOSE_MISMATCH");
    invariant(body.generation === generation && body.visibility_epoch === visibilityEpoch, "CURSOR_SNAPSHOT_INVALID");
    invariant(body.query_sha256 === expected.query_sha256 && body.filters_sha256 === expected.filters_sha256 && body.sort === expected.sort, "CURSOR_QUERY_MISMATCH");
    invariant(Number.isSafeInteger(body.offset) && body.offset >= 0 && Number.isSafeInteger(body.expires_at) && now() <= body.expires_at, "CURSOR_EXPIRED_OR_INVALID");
    return body;
  };

  const resultSort = (left, right, sort) => {
    if (sort === "source_order") {
      const leftOrder = left.kind === "passage" ? left.data.start_byte : (left.data?.source_order ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = right.kind === "passage" ? right.data.start_byte : (right.data?.source_order ?? Number.MAX_SAFE_INTEGER);
      return leftOrder - rightOrder || left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  };

  const search = async ({ query, graphEnabled = true, filters = {}, pageSize = 100, cursor = null, sort = "source_order" }) => {
    await assertCurrent();
    invariant(typeof query === "string" && query.length > 0, "SEARCH_QUERY_INVALID");
    invariant(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 250, "SEARCH_PAGE_SIZE_INVALID");
    invariant(["source_order", "id"].includes(sort), "SEARCH_SORT_INVALID");
    const terms = lexicalTerms(query);
    invariant(terms.length > 0, "SEARCH_QUERY_HAS_NO_TERMS");
    const normalizedFilters = stableFilters(filters);
    const effectiveFilters = graphEnabled
      ? normalizedFilters
      : { ...normalizedFilters, kinds: ["passage"] };
    const querySha = sha256(Buffer.from(terms.join("\0"), "utf8"));
    const filtersSha = sha256(Buffer.from(JSON.stringify({ graphEnabled, ...effectiveFilters }), "utf8"));
    const expected = { query_sha256: querySha, filters_sha256: filtersSha, sort };
    const offset = cursor ? parseCursor(cursor, expected).offset : 0;
    const beforeReads = objectReads;
    const ids = intersection(await Promise.all(terms.map((term) => readIndex("lexical", term))));
    const records = [];
    for (const id of ids) {
      const record = await loadRecord(id);
      if (effectiveFilters.kinds.length && !effectiveFilters.kinds.includes(record.kind)) continue;
      if (!effectiveFilters.lifecycles.includes(record.lifecycle)) continue;
      records.push(record);
    }
    records.sort((left, right) => resultSort(left, right, sort));
    const page = records.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const moreAvailable = nextOffset < records.length;
    const result = Object.freeze({
      generation,
      visibility_epoch: visibilityEpoch,
      records: page,
      total_matches: records.length,
      more_available: moreAvailable,
      next_cursor: moreAvailable ? signCursor({
        schema_version: "1.0",
        case_id: caseId,
        corpus_id: corpusId,
        purpose,
        generation,
        visibility_epoch: visibilityEpoch,
        query_sha256: querySha,
        filters_sha256: filtersSha,
        sort,
        offset: nextOffset,
        expires_at: now() + cursorTtlMs
      }) : null,
      read_receipt: { encrypted_objects_read: objectReads - beforeReads, full_archive_loaded: false }
    });
    await assertCurrent();
    return result;
  };

  const findEntities = async (alias) => {
    await assertCurrent();
    invariant(typeof alias === "string" && alias.length > 0, "ALIAS_QUERY_INVALID");
    const ids = await readIndex("aliases", alias.normalize("NFKC").toLocaleLowerCase("und"));
    const records = (await Promise.all(ids.map(loadRecord))).filter(active);
    await assertCurrent();
    return records;
  };

  const timeline = async ({ from = null, to = null, includeUnknown = true } = {}) => {
    await assertCurrent();
    const known = await readIndex("time_known", "known");
    const unknown = includeUnknown ? await readIndex("time_unknown", "unknown") : [];
    const selected = known.filter((entry) => (from === null || entry.to >= from) && (to === null || entry.from <= to));
    const ids = [...new Set([...selected, ...unknown].map(({ id }) => id))];
    const records = (await Promise.all(ids.map(loadRecord))).filter(active);
    await assertCurrent();
    return Object.freeze({ records, unknown_count: new Set(unknown.filter(({ id }) => records.some((record) => record.id === id)).map(({ id }) => id)).size });
  };

  const evidenceGroup = async (seedIds, { maximumNodes = 100 } = {}) => {
    await assertCurrent();
    invariant(Array.isArray(seedIds) && seedIds.length > 0 && Number.isSafeInteger(maximumNodes) && maximumNodes > 0, "EVIDENCE_GROUP_INPUT_INVALID");
    const mandatory = new Set(JOURNAL_GRAPH_CONTRACT.mandatory_closure_relations);
    const nodes = new Map();
    const edges = new Map();
    const queue = [...new Set(seedIds)];
    const queued = new Set(queue);
    const enqueue = (id) => { if (!queued.has(id)) { queued.add(id); queue.push(id); } };
    while (queue.length) {
      const id = queue.shift();
      const record = await loadRecord(id);
      invariant(active(record), "GRAPH_RECORD_REVOKED");
      if (record.relation) edges.set(record.id, record);
      else nodes.set(record.id, record);
      if (nodes.size > maximumNodes) return Object.freeze({ status: "insufficient_context", nodes: [], edges: [], more_available: true });
      for (const evidenceId of evidenceIds(record)) enqueue(evidenceId);
      if (!record.kind) continue;
      const adjacentEdgeIds = await readIndex("adjacency", record.id);
      for (const edgeId of adjacentEdgeIds) {
        const edge = await loadRecord(edgeId);
        if (!active(edge)) continue;
        if (mandatory.has(edge.relation) || edge.relation === "supported_by") {
          edges.set(edge.id, edge);
          enqueue(edge.from);
          enqueue(edge.to);
          edge.evidence_ids.forEach(enqueue);
        }
      }
    }
    await assertCurrent();
    return Object.freeze({ status: "complete", nodes: [...nodes.values()], edges: [...edges.values()], more_available: false });
  };

  const resolveEvidence = async (ids) => {
    await assertCurrent();
    invariant(Array.isArray(ids) && ids.length > 0 && ids.length <= 200
      && ids.every((id) => typeof id === "string" && id.length > 0), "EVIDENCE_IDS_INVALID");
    const exactSpans = [];
    const sourceLocators = [];
    for (const id of [...new Set(ids)]) {
      const record = await loadRecord(id);
      invariant(record.kind === "passage", "EVIDENCE_RECORD_NOT_PASSAGE");
      invariant(active(record), "EVIDENCE_RECORD_REVOKED");
      const descriptor = manifest.source_representation_objects?.[record.data.representation_id];
      invariant(descriptor?.object_id, "SOURCE_REPRESENTATION_UNAVAILABLE");
      const representation = await readJson(descriptor.object_id);
      invariant(representation.representation_id === record.data.representation_id, "SOURCE_REPRESENTATION_MISMATCH");
      const sourceBytes = Buffer.from(representation.text, "utf8");
      const slice = sourceBytes.subarray(record.data.start_byte, record.data.end_byte);
      invariant(slice.byteLength === record.data.end_byte - record.data.start_byte, "SOURCE_SPAN_OUT_OF_RANGE");
      invariant(sha256(slice) === record.data.quote_sha256, "SOURCE_SPAN_DIGEST_MISMATCH");
      if (record.data.quote != null) invariant(slice.toString("utf8") === record.data.quote, "SOURCE_SPAN_QUOTE_MISMATCH");
      exactSpans.push({
        evidence_id: id,
        representation_id: record.data.representation_id,
        start_byte: record.data.start_byte,
        end_byte: record.data.end_byte,
        quote: record.data.quote,
        quote_sha256: record.data.quote_sha256,
        disclosure: record.data.disclosure ?? "exact"
      });
      sourceLocators.push({ evidence_id: id, ...structuredClone(record.data.locator) });
    }
    await assertCurrent();
    return Object.freeze({ exact_spans: exactSpans, source_locators: sourceLocators });
  };

  return Object.freeze({
    manifest: structuredClone(manifest),
    search,
    findEntities,
    timeline,
    evidenceGroup,
    resolveEvidence,
    async resolveRecords(ids) {
      await assertCurrent();
      invariant(Array.isArray(ids) && ids.length > 0 && ids.length <= 200, "RECORD_IDS_INVALID");
      const records = await Promise.all([...new Set(ids)].map(loadRecord));
      invariant(records.every(active), "GRAPH_RECORD_REVOKED");
      await assertCurrent();
      return records;
    },
    async reverseDependencies(evidenceId) {
      await assertCurrent();
      const records = (await Promise.all((await readIndex("reverse_dependencies", evidenceId)).map(loadRecord))).filter(active);
      await assertCurrent();
      return records;
    },
    close() { secret.fill(0); cache.clear(); indexMaps.clear(); recordMaps.clear(); }
  });
}
