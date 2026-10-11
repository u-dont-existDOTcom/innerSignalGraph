import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_GRAPH_CONTRACT, isJournalTimeBound, timeBoundStartsByEndOf } from "./contracts.mjs";
import { compareSourceOrder, knownTimeIntervals, lexicalTerms, readGenerationDirectory } from "./graph.mjs";
import { QUOTE_MONTHS_KEY, QUOTE_STOPWORDS, QUOTE_UNDATED_KEY, quoteCues } from "./quote-index.mjs";
import { POINTER_TAG_KINDS } from "./pointer-tags.mjs";

export const QUOTE_SEARCH_LIMITS = Object.freeze({
  limitDefault: 12,
  limitMax: 40,
  byteBudgetDefault: 12_000,
  byteBudgetMin: 1_000,
  byteBudgetMax: 48_000,
  termsMax: 24,
  // How many ranked matches one call looks through at most. A call that stops here returns a cursor
  // past what it looked at, so paging always moves on.
  scanMax: 5_000
});

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
  const from = filters?.from ?? null;
  const to = filters?.to ?? null;
  const includeUnknown = filters?.include_unknown ?? true;
  invariant((from === null || isJournalTimeBound(from)) && (to === null || isJournalTimeBound(to))
    && typeof includeUnknown === "boolean", "SEARCH_FILTERS_INVALID");
  return {
    kinds: Array.isArray(filters?.kinds) ? [...new Set(filters.kinds)].sort() : [],
    lifecycles: Array.isArray(filters?.lifecycles) ? [...new Set(filters.lifecycles)].sort() : ["active", "candidate", "superseded"],
    from,
    to,
    include_unknown: includeUnknown
  };
}

// Whether known time intervals place a record in a window: any interval overlapping it, each bound
// covering the whole of its period. An interval may be open at one end: a missing start is the
// unbounded past and a missing end the unbounded future. With no known time, a record is in the
// window only when unknown time is included; with no window, every record is.
function inTimeWindow(intervals, { from, to, include_unknown: includeUnknown }) {
  if (from === null && to === null) return true;
  if (!intervals.length) return includeUnknown;
  return intervals.some(([start, end]) => (from === null || end === null || timeBoundStartsByEndOf(from, end))
    && (to === null || start === null || timeBoundStartsByEndOf(start, to)));
}

function intersection(lists) {
  if (!lists.length) return [];
  const [first, ...rest] = [...lists].sort((left, right) => left.length - right.length);
  const sets = rest.map(list => new Set(list));
  return [...new Set(first)].filter((id) => sets.every((set) => set.has(id)));
}

/**
 * The ordered results of a search or timeline query, kept so the pages after the first slice them
 * instead of rebuilding the whole result on every cursor request. Keys name the exact snapshot,
 * purpose, query and filters, and entries hold record identifiers only, never content. A miss
 * (expired, evicted, another process) rebuilds the same order, so the cache changes cost, not
 * results.
 */
export function createJournalResultCache({ maximumEntries = 32, ttlMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  invariant(Number.isSafeInteger(maximumEntries) && maximumEntries > 0 && Number.isSafeInteger(ttlMs) && ttlMs > 0, "RESULT_CACHE_INVALID");
  const entries = new Map();
  return Object.freeze({
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      if (now() > entry.expiresAt) return null;
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      while (entries.size > maximumEntries) entries.delete(entries.keys().next().value);
    }
  });
}

// A cursor's body once its signature, scope and purpose check out. Cursors are signed with the
// corpus's cursor secret, so a valid one was issued by a reader of this corpus.
function verifiedCursorBody(cursor, secret, { caseId, corpusId, purpose }) {
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
  invariant(body && typeof body === "object" && !Array.isArray(body), "CURSOR_INVALID");
  invariant(body.case_id === caseId && body.corpus_id === corpusId, "CURSOR_SCOPE_MISMATCH");
  invariant(body.purpose === purpose, "CURSOR_PURPOSE_MISMATCH");
  return body;
}

// The snapshot a page request's cursor was issued for, so the caller can open that snapshot rather
// than whichever generation is active now. Null when there is no cursor. The reader still checks
// the cursor in full (query, filters, offset, expiry) when it serves the page.
export function readJournalCursorSnapshot({ cursor, cursorSecret, caseId, corpusId, purpose = "organize_search" }) {
  if (cursor === null || cursor === undefined) return null;
  invariant(cursorSecret instanceof Uint8Array && cursorSecret.byteLength >= 32, "CURSOR_SECRET_INVALID");
  const body = verifiedCursorBody(cursor, Buffer.from(cursorSecret), { caseId, corpusId, purpose });
  invariant(typeof body.generation === "string" && Number.isSafeInteger(body.visibility_epoch), "CURSOR_INVALID");
  return { generation: body.generation, visibility_epoch: body.visibility_epoch };
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
  cursorTtlMs = 15 * 60 * 1000,
  resultCache = null
}) {
  invariant(corpusStore && typeof corpusStore.readJsonObject === "function", "CORPUS_STORE_INVALID");
  invariant(cursorSecret instanceof Uint8Array && cursorSecret.byteLength >= 32, "CURSOR_SECRET_INVALID");
  invariant(["organize_search", "session_use"].includes(purpose), "RETRIEVAL_PURPOSE_INVALID");
  invariant(typeof assertSnapshotCurrent === "function", "SNAPSHOT_GUARD_INVALID");
  invariant(resultCache === null || (typeof resultCache.get === "function" && typeof resultCache.set === "function"), "RESULT_CACHE_INVALID");
  // A cached result belongs to one snapshot, purpose and query: every part of that is in its key.
  const cacheKey = (...parts) => JSON.stringify([caseId, corpusId, purpose, generation, visibilityEpoch, manifestObjectId, ...parts]);
  const secret = Buffer.from(cursorSecret);
  const cache = new Map();
  const indexMaps = new Map();
  const recordMaps = new Map();
  const representationTexts = new Map();
  // Span reads: decoded single-object representations and checked chunks, zeroed when the reader closes.
  const representationBytes = new Map();
  const heldBuffers = [];
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

  // Read once per reader, from the manifest or from the directory object it references.
  const directoryCache = new Map();
  const representationDirectory = () => memoized(directoryCache, "directory", () => readGenerationDirectory(manifest, corpusStore));

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

  // A record's kind, lifecycle and order as the generation's lookup index records them, or null
  // for a generation built before the index carried them.
  const lookupFacts = async (id) => {
    const [location] = await readIndex("record_lookup", id);
    return location && typeof location.lifecycle === "string" && Object.hasOwn(location, "order") && Array.isArray(location.intervals) ? location : null;
  };

  const signCursor = (body) => {
    const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const mac = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${mac}`;
  };
  const parseCursor = (cursor, expected) => {
    const body = verifiedCursorBody(cursor, secret, { caseId, corpusId, purpose });
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
    // The first page builds the ordered result; later pages of the same query slice it from the
    // result cache when the reader has one.
    const key = cacheKey("search", querySha, filtersSha, sort);
    let ordered = resultCache?.get(key) ?? null;
    const decrypted = new Map();
    if (!ordered) {
      const ids = intersection(await Promise.all(terms.map((term) => readIndex("lexical", term))));
      // Kind, lifecycle and time filters are applied here, before paging, so every page holds only
      // matches and a filtered search never pages through empty results.
      const matches = (kind, lifecycle, intervals) => (!effectiveFilters.kinds.length || effectiveFilters.kinds.includes(kind))
        && effectiveFilters.lifecycles.includes(lifecycle) && inTimeWindow(intervals, effectiveFilters);
      const facts = await Promise.all(ids.map(lookupFacts));
      if (facts.every(Boolean)) {
        // Filter and order from the lookup index; only the page is decrypted.
        const rows = ids.map((id, index) => ({ id, ...facts[index] })).filter((row) => matches(row.kind, row.lifecycle, row.intervals));
        rows.sort((left, right) => (sort === "source_order" ? compareSourceOrder(left.order, right.order) : 0) || left.id.localeCompare(right.id));
        ordered = rows.map(({ id }) => id);
      } else {
        // A generation built before its lookup index carried these facts: decrypt every match.
        const records = [];
        for (const id of ids) {
          const record = await loadRecord(id);
          if (matches(record.kind, record.lifecycle, knownTimeIntervals(record))) records.push(record);
        }
        records.sort((left, right) => resultSort(left, right, sort));
        for (const record of records) decrypted.set(record.id, record);
        ordered = records.map(({ id }) => id);
      }
      resultCache?.set(key, ordered);
    }
    const total = ordered.length;
    const page = await Promise.all(ordered.slice(offset, offset + pageSize).map((id) => decrypted.get(id) ?? loadRecord(id)));
    const nextOffset = offset + page.length;
    const moreAvailable = nextOffset < total;
    const result = Object.freeze({
      generation,
      visibility_epoch: visibilityEpoch,
      records: page,
      total_matches: total,
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

  // Without a page size this returns the whole window. With one it returns a page and, when more
  // remain, a cursor bound like a search cursor to this snapshot and purpose, and to this window.
  // Its sort label keeps a timeline cursor from being replayed as a search cursor, or the reverse.
  const timeline = async ({ from = null, to = null, includeUnknown = true, pageSize = null, cursor = null } = {}) => {
    await assertCurrent();
    invariant((from === null || isJournalTimeBound(from)) && (to === null || isJournalTimeBound(to))
      && typeof includeUnknown === "boolean", "TIMELINE_QUERY_INVALID");
    invariant(pageSize === null || (Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 250), "TIMELINE_PAGE_SIZE_INVALID");
    invariant(cursor === null || pageSize !== null, "TIMELINE_CURSOR_REQUIRES_PAGE_SIZE");
    const querySha = sha256(Buffer.from(JSON.stringify({ from, to }), "utf8"));
    const filtersSha = sha256(Buffer.from(JSON.stringify({ includeUnknown }), "utf8"));
    const offset = cursor ? parseCursor(cursor, { query_sha256: querySha, filters_sha256: filtersSha, sort: "timeline" }).offset : 0;
    // The first page builds the ordered window; later pages of the same query slice it from the
    // result cache when the reader has one.
    const key = cacheKey("timeline", querySha, filtersSha);
    let live = resultCache?.get(key) ?? null;
    const loaded = new Map();
    if (!live) {
      const known = await readIndex("time_known", "known");
      const unknown = includeUnknown ? await readIndex("time_unknown", "unknown") : [];
      // An entry is in the window when their periods overlap, each bound covering the whole of its
      // precision: a window ending "2024-06-01" includes that day, and a record dated "2021-05" is in
      // a window starting May 10, 2021. A known interval may be open at one end: a missing start is
      // the unbounded past and a missing end the unbounded future, so a partly dated record stays
      // inside any window it overlaps.
      const selected = known.filter((entry) => inTimeWindow([[entry.from, entry.to]], { from, to, include_unknown: true }));
      // One entry per record and known time interval, labeled with the field or fields that place
      // it there: a record written on one date about an event on another appears at each, and one
      // whose two times are equal appears once. A record with no known time at all appears once in
      // the unknown lane. The index is sorted when the generation is built, so this order is the
      // same on every page.
      const entries = [];
      const knownEntries = new Map();
      for (const entry of selected) {
        const entryKey = JSON.stringify([entry.id, entry.from, entry.to]);
        const existing = knownEntries.get(entryKey);
        if (existing) { if (!existing.fields.includes(entry.field)) existing.fields.push(entry.field); continue; }
        const value = { id: entry.id, lane: "known", fields: [entry.field], from: entry.from, to: entry.to, lifecycle: entry.lifecycle };
        knownEntries.set(entryKey, value);
        entries.push(value);
      }
      const everKnown = new Set(known.map(({ id }) => id));
      const unknownEntries = new Map();
      for (const entry of unknown) {
        if (everKnown.has(entry.id)) continue;
        const existing = unknownEntries.get(entry.id);
        if (existing) { if (!existing.fields.includes(entry.field)) existing.fields.push(entry.field); continue; }
        const value = { id: entry.id, lane: "unknown", fields: [entry.field], from: null, to: null, lifecycle: entry.lifecycle };
        unknownEntries.set(entry.id, value);
        entries.push(value);
      }
      // Which entries are live comes from the time index itself, which records each entry's
      // lifecycle, so paging reads no record and makes no lookup per entry; only the page returned is
      // decrypted. A generation built before the index carried lifecycles falls back to the lookup
      // index for its entries, and to the records themselves before that.
      const legacyIds = [...new Set(entries.filter(({ lifecycle }) => typeof lifecycle !== "string").map(({ id }) => id))];
      const facts = new Map();
      await Promise.all(legacyIds.map(async (id) => { facts.set(id, await lookupFacts(id)); }));
      const unindexed = legacyIds.filter((id) => !facts.get(id));
      for (const record of await Promise.all(unindexed.map(loadRecord))) loaded.set(record.id, record);
      live = entries.filter(({ id, lifecycle }) => active(typeof lifecycle === "string" ? { lifecycle } : (facts.get(id) ?? loaded.get(id))))
        .map(({ lifecycle, ...entry }) => entry);
      resultCache?.set(key, live);
    }
    const unknownCount = live.filter(({ lane }) => lane === "unknown").length;
    const materialize = async (selection) => Promise.all(selection.map(async ({ id, lane, fields, from: entryFrom, to: entryTo }) =>
      ({ ...(loaded.get(id) ?? await loadRecord(id)), timeline_entry: { lane, fields: [...fields], from: entryFrom, to: entryTo } })));
    if (pageSize === null) {
      const records = await materialize(live);
      await assertCurrent();
      return Object.freeze({ records, unknown_count: unknownCount });
    }
    const page = await materialize(live.slice(offset, offset + pageSize));
    const nextOffset = offset + page.length;
    const moreAvailable = nextOffset < live.length;
    const result = Object.freeze({
      records: page,
      unknown_count: unknownCount,
      total_matches: live.length,
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
        sort: "timeline",
        offset: nextOffset,
        expires_at: now() + cursorTtlMs
      }) : null
    });
    await assertCurrent();
    return result;
  };

  // The closure is bounded in nodes and in edges: a dense neighborhood that exceeds either reports
  // insufficient context instead of returning an unbounded response.
  const evidenceGroup = async (seedIds, { maximumNodes = 100, maximumEdges = 200 } = {}) => {
    await assertCurrent();
    invariant(Array.isArray(seedIds) && seedIds.length > 0 && Number.isSafeInteger(maximumNodes) && maximumNodes > 0
      && Number.isSafeInteger(maximumEdges) && maximumEdges > 0, "EVIDENCE_GROUP_INPUT_INVALID");
    const mandatory = new Set(JOURNAL_GRAPH_CONTRACT.mandatory_closure_relations);
    const insufficientContext = Object.freeze({ status: "insufficient_context", nodes: [], edges: [], more_available: true });
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
      if (nodes.size > maximumNodes || edges.size > maximumEdges) return insufficientContext;
      for (const evidenceId of evidenceIds(record)) enqueue(evidenceId);
      // A source's only edges are the containment edges to every one of its passages, so the
      // closure reaches a source from its passages and does not fan out from it.
      if (!record.kind || record.kind === "source") continue;
      const adjacentEdgeIds = await readIndex("adjacency", record.id);
      for (const edgeId of adjacentEdgeIds) {
        const edge = await loadRecord(edgeId);
        if (!active(edge)) continue;
        // A passage's provenance: the containment edge from its source, within the same bounds.
        const containment = edge.relation === "contains" && record.kind === "passage" && edge.to === record.id;
        if (mandatory.has(edge.relation) || edge.relation === "supported_by" || containment) {
          edges.set(edge.id, edge);
          if (edges.size > maximumEdges) return insufficientContext;
          enqueue(edge.from);
          enqueue(edge.to);
          edge.evidence_ids.forEach(enqueue);
        }
      }
    }
    await assertCurrent();
    return Object.freeze({ status: "complete", nodes: [...nodes.values()], edges: [...edges.values()], more_available: false });
  };

  // A representation is one JSON object or, when too large for one, UTF-8 chunks checked against
  // the digest the manifest records for it.
  const representationText = (representationId, descriptor, digest = null) => memoized(representationTexts, descriptor.object_id, async () => {
    if (!Array.isArray(descriptor.chunks)) {
      const representation = await readJson(descriptor.object_id);
      invariant(representation.representation_id === representationId, "SOURCE_REPRESENTATION_MISMATCH");
      return representation.text;
    }
    invariant(descriptor.representation_id === representationId && descriptor.encoding === "utf8_chunks", "SOURCE_REPRESENTATION_MISMATCH");
    const bytes = await corpusStore.reassembleOriginal(descriptor);
    objectReads += descriptor.chunks.length;
    try {
      const expected = digest ?? (await representationDirectory()).digests[representationId];
      invariant(expected && bytes.length === expected.utf8_byte_length && sha256(bytes) === expected.sha256, "SOURCE_REPRESENTATION_MISMATCH");
      return bytes.toString("utf8");
    } finally { bytes.fill(0); }
  });

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
      const descriptor = (await representationDirectory()).objects[record.data.representation_id];
      invariant(descriptor?.object_id, "SOURCE_REPRESENTATION_UNAVAILABLE");
      const sourceBytes = Buffer.from(await representationText(record.data.representation_id, descriptor), "utf8");
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

  // A generation that indexes its representations opens one page by its key; others read the
  // directory of every page once.
  const representationLocation = async (representationId) => {
    if (Array.isArray(manifest.indexes.representation_objects)) {
      const [entry = null] = await readIndex("representation_objects", representationId);
      return entry ? { descriptor: entry.descriptor, digest: { utf8_byte_length: entry.utf8_byte_length, sha256: entry.sha256 } } : null;
    }
    const descriptor = (await representationDirectory()).objects[representationId];
    return descriptor ? { descriptor, digest: null } : null;
  };

  // The bytes of a span. A representation stored as one object is decoded once per reader. One
  // stored as UTF-8 chunks (a long text journal) is read only in the chunks the span touches, each
  // checked against the digest its descriptor records, so a quote never loads the whole source.
  const spanBytes = async (representationId, startByte, endByte) => {
    const location = await representationLocation(representationId);
    invariant(location?.descriptor?.object_id, "SOURCE_REPRESENTATION_UNAVAILABLE");
    const { descriptor } = location;
    invariant(Number.isSafeInteger(startByte) && Number.isSafeInteger(endByte) && startByte >= 0 && endByte > startByte, "SOURCE_SPAN_OUT_OF_RANGE");
    if (!Array.isArray(descriptor.chunks)) {
      const bytes = await memoized(representationBytes, descriptor.object_id, async () => {
        const decoded = Buffer.from(await representationText(representationId, descriptor, location.digest), "utf8");
        heldBuffers.push(decoded);
        return decoded;
      });
      return bytes.subarray(startByte, endByte);
    }
    invariant(descriptor.representation_id === representationId && descriptor.encoding === "utf8_chunks"
      && Number.isSafeInteger(descriptor.chunk_bytes) && descriptor.chunk_bytes > 0, "SOURCE_REPRESENTATION_MISMATCH");
    const pieces = [];
    for (let index = Math.floor(startByte / descriptor.chunk_bytes); index * descriptor.chunk_bytes < endByte; index += 1) {
      const ref = descriptor.chunks.find((chunk) => chunk.chunk_index === index);
      invariant(ref, "SOURCE_SPAN_OUT_OF_RANGE");
      const chunk = await memoized(representationBytes, `${descriptor.object_id}\0${index}`, async () => {
        const read = await corpusStore.readObject({ objectId: descriptor.object_id, objectVersion: descriptor.object_version, chunkIndex: index });
        objectReads += 1;
        invariant(read.byteLength === ref.byte_length && sha256(read) === ref.sha256, "SOURCE_REPRESENTATION_MISMATCH");
        heldBuffers.push(read);
        return read;
      });
      const offset = index * descriptor.chunk_bytes;
      pieces.push(chunk.subarray(Math.max(0, startByte - offset), Math.min(chunk.byteLength, endByte - offset)));
    }
    return pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
  };

  // A span's exact text, checked against the digest recorded for it, as resolveEvidence checks a
  // passage.
  const exactText = async ({ representationId, startByte, endByte, expectedSha256 }) => {
    const slice = await spanBytes(representationId, startByte, endByte);
    invariant(slice.byteLength === endByte - startByte, "SOURCE_SPAN_OUT_OF_RANGE");
    invariant(sha256(slice) === expectedSha256, "SOURCE_SPAN_DIGEST_MISMATCH");
    return slice.toString("utf8");
  };

  /**
   * The person's own words for a question: exact quotes ranked by how many of the query's words they
   * hold, rarer words counting more (each word adds the log of how rare it is), with ties in a fixed
   * order so the same query pages the same way. Common function words (`QUOTE_STOPWORDS`) are left out
   * of the ranking unless the query has nothing else. A time window keeps the quotes written under a
   * date line inside it, and undated ones only when asked to. A page stops at its quote limit or byte
   * budget, and always holds at least one quote when any match. Later pages come from a cursor bound,
   * like search's, to the snapshot, query and filters, holding the position in the ranking where the
   * next page starts. Each quote comes with its page, the date it was written under with that date's
   * line (`year_inferred` when the line gave no year and it came from the entries before; `ambiguous`
   * when the numbers could be read either way), and the wording cues found in it (`quoteCues`). Works on
   * any generation. On a
   * quote index, the `quote_meta` index gives each quote's span, page and date line, so no record is
   * decrypted; elsewhere the passage record supplies the span and there are no dates.
   *
   * On a generation the pointer pass tagged (plan Part 3), query words also match the words of topic and
   * event labels (`tag_terms`). Quotes that match by their own words keep exactly the order they have
   * without tags, and quotes found only through a tag come after all of them, so tags can't push a word
   * match down. Each quote says how it matched (`matched_by`: words, tag or both) and, when a tag
   * matched, which tags (`matched_tags`). `kinds` keeps only quotes with a tag of one of those kinds
   * (`quote_tags`). Tags never change a quote's text, date or cues.
   */
  const findQuotes = async ({ query, from = null, to = null, includeUndated = true, limit = QUOTE_SEARCH_LIMITS.limitDefault,
    byteBudget = QUOTE_SEARCH_LIMITS.byteBudgetDefault, cursor = null, kinds = null } = {}) => {
    await assertCurrent();
    invariant(typeof query === "string" && query.length > 0 && query.length <= 4_000, "QUOTE_QUERY_INVALID");
    invariant((from === null || isJournalTimeBound(from)) && (to === null || isJournalTimeBound(to)) && typeof includeUndated === "boolean", "QUOTE_FILTERS_INVALID");
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= QUOTE_SEARCH_LIMITS.limitMax, "QUOTE_LIMIT_INVALID");
    invariant(Number.isSafeInteger(byteBudget) && byteBudget >= QUOTE_SEARCH_LIMITS.byteBudgetMin && byteBudget <= QUOTE_SEARCH_LIMITS.byteBudgetMax, "QUOTE_BUDGET_INVALID");
    invariant(kinds === null || (Array.isArray(kinds) && kinds.length > 0 && new Set(kinds).size === kinds.length
      && kinds.every((kind) => POINTER_TAG_KINDS.includes(kind))), "QUOTE_KINDS_INVALID");
    const tagged = Array.isArray(manifest.indexes.tag_terms) && Array.isArray(manifest.indexes.quote_tags);
    invariant(kinds === null || tagged, "QUOTE_TAGS_NOT_AVAILABLE");
    const allTerms = lexicalTerms(query);
    invariant(allTerms.length > 0, "SEARCH_QUERY_HAS_NO_TERMS");
    const expected = {
      query_sha256: sha256(Buffer.from(allTerms.join("\0"), "utf8")),
      filters_sha256: sha256(Buffer.from(JSON.stringify(kinds === null ? { from, to, includeUndated }
        : { from, to, includeUndated, kinds: [...kinds].sort() }), "utf8")),
      sort: "quotes"
    };
    const start = cursor ? parseCursor(cursor, expected).offset : 0;
    const content = allTerms.filter((term) => !QUOTE_STOPWORDS.has(term));
    const terms = (content.length ? content : allTerms).slice(0, QUOTE_SEARCH_LIMITS.termsMax);
    const ignored = allTerms.filter((term) => !terms.includes(term));
    const beforeReads = objectReads;
    const postings = await Promise.all(terms.map((term) => readIndex("lexical", term)));
    const population = Math.max(1, manifest.node_count ?? 1);
    const scores = new Map();
    const matched = new Map();
    terms.forEach((term, index) => {
      const ids = [...new Set(postings[index])].filter((id) => id.startsWith("passage:"));
      if (!ids.length) return;
      const weight = Math.log(1 + population / ids.length);
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + weight);
        if (!matched.has(id)) matched.set(id, []);
        matched.get(id).push(term);
      }
    });
    const byScore = (scoreMap, termMap) => (left, right) => scoreMap.get(right) - scoreMap.get(left)
      || termMap.get(right).length - termMap.get(left).length || left.localeCompare(right);
    const wordRanked = [...scores.keys()].sort(byScore(scores, matched));
    // Tags: the same terms against topic and event labels, weighted the same way. A quote found only through a
    // tag ranks after every quote its own words match.
    const tagScores = new Map();
    const tagMatched = new Map();
    if (tagged) {
      const tagPostings = await Promise.all(terms.map((term) => readIndex("tag_terms", term)));
      terms.forEach((term, index) => {
        const ids = [...new Set(tagPostings[index])].filter((id) => id.startsWith("passage:"));
        if (!ids.length) return;
        const weight = Math.log(1 + population / ids.length);
        for (const id of ids) {
          tagScores.set(id, (tagScores.get(id) ?? 0) + weight);
          if (!tagMatched.has(id)) tagMatched.set(id, []);
          tagMatched.get(id).push(term);
        }
      });
    }
    const tagOnly = [...tagScores.keys()].filter((id) => !scores.has(id)).sort(byScore(tagScores, tagMatched));
    const ranked = [...wordRanked, ...tagOnly];
    const matchedBy = (id) => (scores.has(id) ? (tagScores.has(id) ? "both" : "words") : "tag");
    const quoteIndex = Array.isArray(manifest.indexes.quote_meta);
    const windowed = from !== null || to !== null;
    // A quote index lists its quotes by the month they were written, so a time window first keeps the
    // matches from overlapping months (and undated ones when asked), without reading each match.
    let candidates = ranked;
    if (windowed && Array.isArray(manifest.indexes.quote_months)) {
      const months = (await readIndex("quote_months", QUOTE_MONTHS_KEY)).filter((month) => inTimeWindow([[month, month]], { from, to, include_unknown: false }));
      const lists = await Promise.all([...months, ...(includeUndated ? [QUOTE_UNDATED_KEY] : [])].map((key) => readIndex("quote_months", key)));
      const allowed = new Set(lists.flat());
      candidates = ranked.filter((id) => allowed.has(id));
    }
    const quotes = [];
    let visited = 0, bytes = 0, scanCapped = false;
    // `position` ends at the first match this page didn't take: the next page starts there.
    let position = start;
    for (; position < candidates.length; position += 1) {
      if (quotes.length >= limit) break;
      if (visited >= QUOTE_SEARCH_LIMITS.scanMax) { scanCapped = true; break; }
      visited += 1;
      const id = candidates[position];
      const [meta = null] = quoteIndex ? await readIndex("quote_meta", id) : [];
      const date = meta?.written ?? null;
      if (windowed && !inTimeWindow(date ? [[date.from, date.to]] : [], { from, to, include_unknown: includeUndated })) continue;
      // The quote's tags, read only when a tag matched or a kind filter needs them.
      const quoteTags = tagged && (tagScores.has(id) || kinds !== null) ? await readIndex("quote_tags", id) : [];
      if (kinds !== null && !quoteTags.some((tag) => kinds.includes(tag.kind))) continue;
      let text, page;
      if (meta) {
        text = await exactText({ representationId: meta.representation_id, startByte: meta.start_byte, endByte: meta.end_byte, expectedSha256: meta.sha256 });
        page = meta.page;
      } else {
        const record = await loadRecord(id);
        if (!active(record) || record.kind !== "passage" || record.data.disclosure === "restricted") continue;
        text = await exactText({ representationId: record.data.representation_id, startByte: record.data.start_byte, endByte: record.data.end_byte,
          expectedSha256: record.data.quote_sha256 });
        if (record.data.quote != null) invariant(text === record.data.quote, "SOURCE_SPAN_QUOTE_MISMATCH");
        page = record.data.locator?.page ?? null;
      }
      const line = date?.line ? await exactText({ representationId: date.line.representation_id, startByte: date.line.start_byte,
        endByte: date.line.end_byte, expectedSha256: date.line.sha256 }) : null;
      const size = Buffer.byteLength(text, "utf8") + (line ? Buffer.byteLength(line, "utf8") : 0);
      if (quotes.length > 0 && bytes + size > byteBudget) break;
      bytes += size;
      quotes.push(Object.freeze({
        quote_id: id,
        text,
        page,
        written: date ? Object.freeze({
          from: date.from,
          to: date.to,
          precision: date.precision,
          date_line: line,
          ...(date.ambiguous ? { ambiguous: true } : {}),
          ...(date.year_inferred ? { year_inferred: true } : {})
        }) : null,
        cues: quoteCues(text),
        matched_by: matchedBy(id),
        matched_terms: Object.freeze([...(matched.get(id) ?? [])]),
        ...(tagScores.has(id) ? { matched_tags: Object.freeze(quoteTags
          .filter((tag) => ["topic", "event"].includes(tag.kind)
            && lexicalTerms(tag.label).some((term) => tagMatched.get(id).includes(term)))
          .map((tag) => Object.freeze({ kind: tag.kind, label: tag.label }))) } : {}),
        score: Math.round((scores.get(id) ?? tagScores.get(id)) * 1000) / 1000
      }));
    }
    const more = position < candidates.length;
    const result = Object.freeze({
      quotes: Object.freeze(quotes),
      more_available: more,
      next_cursor: more ? signCursor({
        schema_version: "1.0",
        case_id: caseId,
        corpus_id: corpusId,
        purpose,
        generation,
        visibility_epoch: visibilityEpoch,
        ...expected,
        offset: position,
        expires_at: now() + cursorTtlMs
      }) : null,
      coverage: Object.freeze({
        terms_ranked: Object.freeze([...terms]),
        terms_ignored: Object.freeze(ignored),
        matching_quotes: windowed ? null : ranked.length,
        tags: tagged,
        ...(tagged ? { matching_only_by_tag: windowed ? null : tagOnly.length } : {}),
        quotes_examined: visited,
        scan_capped: scanCapped,
        quote_index: quoteIndex,
        encrypted_objects_read: objectReads - beforeReads,
        full_archive_loaded: false
      })
    });
    await assertCurrent();
    return result;
  };

  return Object.freeze({
    manifest: structuredClone(manifest),
    search,
    findQuotes,
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
    close() {
      secret.fill(0); cache.clear(); indexMaps.clear(); recordMaps.clear(); representationTexts.clear();
      representationBytes.clear(); heldBuffers.splice(0).forEach((buffer) => buffer.fill(0));
    }
  });
}
