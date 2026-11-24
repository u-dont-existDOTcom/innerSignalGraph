import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_GRAPH_CONTRACT, isJournalTimeBound, timeBoundStartsByEndOf } from "./contracts.mjs";
import { compareSourceOrder, knownTimeIntervals, lexicalTerms, readGenerationDirectory } from "./graph.mjs";
import { QUOTE_MONTHS_KEY, QUOTE_STOPWORDS, QUOTE_TERMS_STATS_KEY, QUOTE_UNDATED_KEY, QUOTE_WIDE_KEY, quoteCues } from "./quote-index.mjs";
import { POINTER_TAG_KINDS } from "./pointer-tags.mjs";
import { foldAccents, FRENCH_STOPWORDS, formsQueryTerms, formsReadingTerm, formsReadingTokens } from "./word-forms.mjs";

export const QUOTE_SEARCH_LIMITS = Object.freeze({
  limitDefault: 24,
  limitMax: 40,
  byteBudgetDefault: 24_000,
  byteBudgetMin: 1_000,
  byteBudgetMax: 48_000,
  termsMax: 24,
  // How many ranked matches one call looks through at most. A call that stops here returns a cursor
  // past what it looked at, so paging always moves on.
  scanMax: 5_000
});

// Okapi BM25's constants, as the search check uses them (search-check.mjs): k1 limits how much using a word again adds, and b sets how
// much a quote's length counts against it.
export const QUOTE_BM25 = Object.freeze({ k1: 1.2, b: 0.75 });
// The name of the order version 3 of the quote index ranks in, which a cursor carries so one version's cursor can't page the other's.
const QUOTE_RANKING_V3 = "quotes-v3";

/**
 * The numbers of the search a reply's evidence makes (`findEvidenceQuotes`), in one place. A person's message is whole sentences, not
 * chosen search words, so most of its words say nothing about which quote matters, and how many quotes hold a word is what tells:
 * - `common`: a word over 5% of the quotes hold (and over 20 of them, so that a small journal has words left to go by) isn't ranked by.
 * - `termsMax`: of the rest, the rarest 24, as many as the quote search ranks by; the rarest, so that a long message's point counts
 *   wherever it stands.
 * - `rare`: a word at most 1% of the quotes hold (or at most 10, in a small journal) is enough by itself to keep a quote that holds it.
 * - `matched`: without such a word, a quote is kept for at least two of the chosen words that are at least half of them.
 * - `candidatesMax`: how many of the kept quotes' records one search looks at, at most, however many of them may not be used.
 * - `queryCharacters`: how long a message it takes, at most: a whole one, so that its point counts wherever it stands.
 * They are reasoned, not measured: the 3,207 test questions about one real journal are on the server, so these numbers can't be tuned
 * on them from here. `version` names the method with its numbers (QUOTE_BM25 and the stop words included): change it with any of them,
 * since a cached search and a retrieval's receipt go by it.
 */
export const EVIDENCE_QUOTE_SEARCH = Object.freeze({
  version: "evidence-quotes-v1",
  common: Object.freeze({ share: 0.05, quotes: 20 }),
  termsMax: 24,
  rare: Object.freeze({ share: 0.01, quotes: 10 }),
  matched: Object.freeze({ terms: 2, share: 0.5 }),
  candidatesMax: 40,
  queryCharacters: 40_000
});
// The lifecycles a quotation may be used in as evidence.
const EVIDENCE_LIFECYCLES = Object.freeze(["active", "candidate", "superseded"]);

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

// The stop words of an evidence search are left out as the message writes them, never by how the word list reads them: it reads "shoulder"
// as it reads "should", and "care" as it reads the French "car". French is also typed without its accents, so a list's words count without
// them too; a word that has an accent counts only as it is ("même" is one, "sûr" isn't for "sur").
const withoutAccents = (words) => new Set([...words].flatMap((word) => [word, foldAccents(word)]));
const FRENCH_STOPWORDS_TYPED = withoutAccents(FRENCH_STOPWORDS);
// Stop words of one language that are ordinary words of the other, which a message may be about: a son, a car or an aura in English; a
// goal ("but"), a year or a bear ("ours") in French. Each is left out only in a message that holds more of its own list's other words
// than of the other list's; every other stop word always is. The two lists are fixed, so this is a fact about them, not a guess.
const ALSO_ENGLISH = new Set("ai aura car elle eu la ma par pendant plus pour sans sera son ton tout un".split(" "));
const ALSO_FRENCH = new Set("an but or ours".split(" "));
// An English negation written as one word would leave a word of its own behind when it's cut ("couldn" of "couldn't"): it's left out whole.
const withoutNegations = (text) => text.replace(/[\p{L}\p{N}]+(?:['\u2019]t(?![\p{L}\p{N}]))?/giu, (word) => (/n['\u2019]t$/iu.test(word) ? " " : word));

function withoutStopwords(words) {
  const votes = (list, ambiguous, other) => words.filter((word) => list.has(word) && !ambiguous.has(word) && !other.has(word)).length;
  const english = votes(QUOTE_STOPWORDS, ALSO_FRENCH, FRENCH_STOPWORDS_TYPED);
  const french = votes(FRENCH_STOPWORDS_TYPED, ALSO_ENGLISH, QUOTE_STOPWORDS);
  return words.filter((word) => {
    if (ALSO_ENGLISH.has(word)) return french <= english;
    if (ALSO_FRENCH.has(word)) return english <= french;
    return !QUOTE_STOPWORDS.has(word) && !FRENCH_STOPWORDS_TYPED.has(word);
  });
}

// The words of a message an evidence search may rank by, each once in the order they first appear, without the stop words. With a word list
// (`forms`) each is read as the list reads words, so it finds the quotes that hold it in another form, except a word the list reads as it
// reads a stop word: its quotes there are mostly the stop word's, so it's looked up as written, and with a final "s" more or less.
let stopwordReadings = null;
function evidenceTerms(query, forms) {
  const words = withoutStopwords(lexicalTerms(withoutNegations(query)));
  if (!forms) return words.map((word) => ({ term: word, exact: [word] }));
  stopwordReadings ??= new Set([...QUOTE_STOPWORDS, ...FRENCH_STOPWORDS_TYPED].map(formsReadingTerm));
  const terms = new Map();
  for (const word of words) {
    const read = formsReadingTerm(word);
    if (!stopwordReadings.has(read)) {
      terms.set(read, { term: read, exact: null });
      continue;
    }
    const other = word.endsWith("s") ? word.slice(0, -1) : `${word}s`;
    const exact = !other || QUOTE_STOPWORDS.has(other) || FRENCH_STOPWORDS_TYPED.has(other) ? [word] : [word, other];
    const key = `=${[...exact].sort().join(" ")}`;
    if (!terms.has(key)) terms.set(key, { term: word, exact });
  }
  return [...terms.values()];
}

// Which of those words are chosen, from how many quotes hold each (`counts`, in the words' order) and how many quotes there are: the
// places of the chosen ones, rarest first (equally rare ones as they stand in the message), and why each of the others is left out.
function chooseEvidenceTerms(counts, population) {
  const { common, termsMax } = EVIDENCE_QUOTE_SEARCH;
  const commonOver = Math.max(common.quotes, common.share * population);
  const dropped = new Map();
  const ranked = [];
  counts.forEach((count, place) => {
    if (count === 0) dropped.set(place, "in_no_quote");
    else if (count > commonOver) dropped.set(place, "common");
    else ranked.push(place);
  });
  ranked.sort((left, right) => counts[left] - counts[right] || left - right);
  for (const place of ranked.slice(termsMax)) dropped.set(place, "over_the_term_limit");
  return { chosen: ranked.slice(0, termsMax), dropped };
}

function intersection(lists) {
  if (!lists.length) return [];
  const [first, ...rest] = [...lists].sort((left, right) => left.length - right.length);
  const sets = rest.map(list => new Set(list));
  return [...new Set(first)].filter((id) => sets.every((set) => set.has(id)));
}

// Whether a quote holds a word of an evidence search (one of `evidenceTerms`): read as the generation's word list reads words, or exactly as
// written where it has none and for a word looked up as written.
function quoteHoldsTerm(text, forms) {
  const read = forms ? new Set(formsReadingTokens(text)) : null;
  const written = new Set(lexicalTerms(text));
  return ({ term, exact }) => (exact ? exact.some((word) => written.has(word)) : read.has(term));
}

/**
 * The words of a message that an evidence search goes by and that `quote` holds, read as `findEvidenceQuotes` reads both on a generation
 * with a word list (`wordList`) or without one. With none, no search by words can find the quote for that message. How many quotes hold a
 * word isn't asked here: one the search leaves out as common counts too.
 */
export function evidenceWordsShared(message, quote, { wordList }) {
  invariant(typeof message === "string" && typeof quote === "string" && typeof wordList === "boolean", "QUOTE_QUERY_INVALID");
  return Object.freeze(evidenceTerms(message, wordList).filter(quoteHoldsTerm(quote, wordList)).map(({ term }) => term));
}

/**
 * The ordered results of a search or timeline query, kept so the pages after the first slice them
 * instead of rebuilding the whole result on every cursor request. Keys name the exact snapshot,
 * purpose, query and filters, and entries hold record identifiers only, never content (an evidence
 * search's also how many quotes hold each of its words, never the words). A miss (expired, evicted,
 * another process) rebuilds the same order, so the cache changes cost, not results.
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
   * of the ranking unless the query has nothing else. On a generation with a word list (`quote_terms`, version 3 of the quote
   * index) the ranking is another: words are read across their forms (accents folded, English and French stems), the quotes
   * holding more of the query's terms come first, then Okapi BM25, then the id, exactly the order of the search check's
   * `forms_bm25_coordination`; the cursor's sort names it. `terms_ranked` and `matched_terms` still name the query's own words,
   * and `coverage.ranking` says which ranking a result has ("word_forms" here, "exact_words" otherwise).
   * A time window keeps the quotes written under a
   * date line inside it, or with a range that overlaps it, and undated ones only when asked to. A page stops at its quote limit or byte
   * budget, and always holds at least one quote when any match. Later pages come from a cursor bound,
   * like search's, to the snapshot, query and filters, holding the position in the ranking where the
   * next page starts. Each quote comes with its page, the date it was written under with that date's
   * line (`year_inferred` when the line gave no year and it came from the dated entries around it; `ambiguous`
   * when the numbers could be read either way; `between` with the `date_line_after` when the quote sits between two dates
   * and was written some time from the first to the second, precision `interval`), and the wording cues found in it (`quoteCues`). Works on
   * any generation. On a
   * quote index, the `quote_meta` index gives each quote's span, page and date line, so no record is
   * decrypted; elsewhere the passage record supplies the span and there are no dates.
   *
   * On a generation the pointer pass tagged (plan Part 3), query words also match the words of topic and
   * event labels (`tag_terms`). Quotes that match by their own words keep exactly the order they have
   * without tags, and quotes found only through a tag come after all of them, so tags can't push a word
   * match down. Each quote says how it matched (`matched_by`: words, tag or both) and, when a tag
   * matched, which tags (`matched_tags`). `kinds` keeps only quotes with a tag of one of those kinds
   * (`quote_tags`). Tags never change a quote's text, date or cues. `matchTags: false` searches the same
   * generation by words alone, the baseline the pass's measurement compares with; it isn't offered to tools.
   */
  const findQuotes = async ({ query, from = null, to = null, includeUndated = true, limit = QUOTE_SEARCH_LIMITS.limitDefault,
    byteBudget = QUOTE_SEARCH_LIMITS.byteBudgetDefault, cursor = null, kinds = null, matchTags = true } = {}) => {
    await assertCurrent();
    invariant(typeof query === "string" && query.length > 0 && query.length <= 4_000, "QUOTE_QUERY_INVALID");
    invariant((from === null || isJournalTimeBound(from)) && (to === null || isJournalTimeBound(to)) && typeof includeUndated === "boolean", "QUOTE_FILTERS_INVALID");
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= QUOTE_SEARCH_LIMITS.limitMax, "QUOTE_LIMIT_INVALID");
    invariant(Number.isSafeInteger(byteBudget) && byteBudget >= QUOTE_SEARCH_LIMITS.byteBudgetMin && byteBudget <= QUOTE_SEARCH_LIMITS.byteBudgetMax, "QUOTE_BUDGET_INVALID");
    invariant(kinds === null || (Array.isArray(kinds) && kinds.length > 0 && new Set(kinds).size === kinds.length
      && kinds.every((kind) => POINTER_TAG_KINDS.includes(kind))), "QUOTE_KINDS_INVALID");
    invariant(typeof matchTags === "boolean", "QUOTE_FILTERS_INVALID");
    const tagIndexes = Array.isArray(manifest.indexes.tag_terms) && Array.isArray(manifest.indexes.quote_tags);
    invariant(kinds === null || tagIndexes, "QUOTE_TAGS_NOT_AVAILABLE");
    // Whether query words also match tag labels in this search.
    const tagged = matchTags && tagIndexes;
    // New reading-first generations may contain provisional, source-anchored
    // interpretation facets. They are NEVER substituted for the original quote.
    const readingAvailable = matchTags && Array.isArray(manifest.indexes.reading_terms);
    // Version 3 of the quote index lists the quotes holding each term as the forms reading takes it (`quote_terms`).
    const wordList = Array.isArray(manifest.indexes.quote_terms);
    const allTerms = lexicalTerms(query);
    invariant(allTerms.length > 0, "SEARCH_QUERY_HAS_NO_TERMS");
    const expected = {
      query_sha256: sha256(Buffer.from(allTerms.join("\0"), "utf8")),
      filters_sha256: sha256(Buffer.from(JSON.stringify({ from, to, includeUndated, ...(kinds === null ? {} : { kinds: [...kinds].sort() }),
        ...(matchTags ? {} : { match_tags: false }) }), "utf8")),
      // A generation with a word list ranks another way, so its cursors say so.
      sort: readingAvailable ? QUOTE_RANKING_V3+":reading" : (wordList ? QUOTE_RANKING_V3 : "quotes")
    };
    const start = cursor ? parseCursor(cursor, expected).offset : 0;
    const content = allTerms.filter((term) => !QUOTE_STOPWORDS.has(term));
    const terms = (content.length ? content : allTerms).slice(0, QUOTE_SEARCH_LIMITS.termsMax);
    // The words the ranking goes by: the chosen ones, or, on a word list, the query's words that read as a term it ranks by.
    let rankedWords = terms;
    const beforeReads = objectReads;
    const population = Math.max(1, manifest.node_count ?? 1);
    const scores = new Map();
    const matched = new Map();
    const byScore = (scoreMap, termMap) => (left, right) => scoreMap.get(right) - scoreMap.get(left)
      || termMap.get(right).length - termMap.get(left).length || left.localeCompare(right);
    let wordRanked;
    if (wordList) {
      // Version 3: the quotes holding more of the query's terms first, then Okapi BM25, then the id, the order of the search check's
      // forms_bm25_coordination (search-check.mjs). The terms are chosen and read as it does, and the sums are made in its order,
      // so the two give the same ranking.
      const { terms: readTerms } = formsQueryTerms(query, QUOTE_SEARCH_LIMITS.termsMax);
      const [totals = null] = await readIndex("quote_terms", QUOTE_TERMS_STATS_KEY);
      invariant(totals !== null && Number.isSafeInteger(totals.quotes) && totals.quotes >= 0 && Number.isFinite(totals.mean_length) && totals.mean_length > 0,
        "QUOTE_TERMS_INVALID");
      const lists = await Promise.all(readTerms.map((term) => readIndex("quote_terms", term)));
      const wordsOf = new Map(readTerms.map((term) => [term, allTerms.filter((word) => formsReadingTerm(word) === term)]));
      const held = new Map();
      readTerms.forEach((term, index) => {
        const holders = lists[index];
        if (!holders.length) return;
        const weight = Math.log(1 + (totals.quotes - holders.length + 0.5) / (holders.length + 0.5));
        for (const [id, uses, length] of holders) {
          const factor = 1 - QUOTE_BM25.b + QUOTE_BM25.b * length / totals.mean_length;
          scores.set(id, (scores.get(id) ?? 0) + weight * uses * (QUOTE_BM25.k1 + 1) / (uses + QUOTE_BM25.k1 * factor));
          held.set(id, (held.get(id) ?? 0) + 1);
          if (!matched.has(id)) matched.set(id, []);
          matched.get(id).push(...wordsOf.get(term));
        }
      });
      wordRanked = [...scores.keys()].sort((left, right) => held.get(right) - held.get(left) || scores.get(right) - scores.get(left) || left.localeCompare(right));
      const ranking = new Set(readTerms);
      rankedWords = allTerms.filter((word) => ranking.has(formsReadingTerm(word)));
    } else {
      const postings = await Promise.all(terms.map((term) => readIndex("lexical", term)));
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
      wordRanked = [...scores.keys()].sort(byScore(scores, matched));
    }
    const ignored = allTerms.filter((term) => !rankedWords.includes(term));
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
    const readingScores = new Map();
    const readingMatched = new Map();
    if (readingAvailable) {
      const readingPostings = await Promise.all(terms.map((term) => readIndex("reading_terms", term)));
      terms.forEach((term,index) => {
        const ids=[...new Set(readingPostings[index])]
          .filter(id=>typeof id==="string" && id.startsWith("passage:"));
        if(!ids.length)return;
        const weight=Math.log(1+population/ids.length);
        for(const id of ids){
          readingScores.set(id,(readingScores.get(id)??0)+weight);
          if(!readingMatched.has(id))readingMatched.set(id,[]);
          readingMatched.get(id).push(term);
        }
      });
    }
    const readingOnly=[...readingScores.keys()]
      .filter(id=>!scores.has(id) && !tagScores.has(id))
      .sort(byScore(readingScores,readingMatched));
    // Original wording matches ALWAYS rank ahead of generated facets.
    const ranked=[...wordRanked,...tagOnly,...readingOnly];
    const matchedBy = id => scores.has(id)
      ? (tagScores.has(id) ? "both" : "words")
      : (tagScores.has(id) ? "tag" : "reading");
    const quoteIndex = Array.isArray(manifest.indexes.quote_meta);
    const windowed = from !== null || to !== null;
    // A quote index lists its quotes by the month they were written, so a time window first keeps the
    // matches from overlapping months (and undated ones when asked), without reading each match. A version 4 index lists
    // apart, with their bounds, the quotes whose range is open at one end or too wide to list by month: those whose range
    // overlaps the window are kept too. Each is checked below.
    let candidates = ranked;
    if (windowed && Array.isArray(manifest.indexes.quote_months)) {
      const window = { from, to, include_unknown: false };
      const months = (await readIndex("quote_months", QUOTE_MONTHS_KEY)).filter((month) => inTimeWindow([[month, month]], window));
      const lists = await Promise.all([...months, ...(includeUndated ? [QUOTE_UNDATED_KEY] : [])].map((key) => readIndex("quote_months", key)));
      const wide = (await readIndex("quote_months", QUOTE_WIDE_KEY)).filter(([, start, end]) => inTimeWindow([[start, end]], window)).map(([id]) => id);
      const allowed = new Set([...lists.flat(), ...wide]);
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
      const quoteTags = tagIndexes && (tagScores.has(id) || kinds !== null) ? await readIndex("quote_tags", id) : [];
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
      // A quote between two dates (version 3, `between`) also shows the line of the date after it.
      const lineAfter = date?.line_after ? await exactText({ representationId: date.line_after.representation_id, startByte: date.line_after.start_byte,
        endByte: date.line_after.end_byte, expectedSha256: date.line_after.sha256 }) : null;
      const size = Buffer.byteLength(text, "utf8") + (line ? Buffer.byteLength(line, "utf8") : 0) + (lineAfter ? Buffer.byteLength(lineAfter, "utf8") : 0);
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
          ...(date.between ? { between: true, date_line_after: lineAfter } : {}),
          ...(date.ambiguous ? { ambiguous: true } : {}),
          ...(date.year_inferred ? { year_inferred: true } : {})
        }) : null,
        cues: quoteCues(text),
        matched_by: matchedBy(id),
        matched_terms: Object.freeze([...(matched.get(id) ?? []),
          ...(readingMatched.get(id) ?? [])]),
        ...(tagScores.has(id) ? { matched_tags: Object.freeze(quoteTags
          .filter((tag) => ["topic", "event"].includes(tag.kind)
            && lexicalTerms(tag.label).some((term) => tagMatched.get(id).includes(term)))
          .map((tag) => Object.freeze({ kind: tag.kind, label: tag.label }))) } : {}),
        ...(readingScores.has(id) ? {
          reading_interpretation_provisional: true,
          matched_reading_terms: Object.freeze([...(readingMatched.get(id) ?? [])])
        } : {}),
        score: Math.round((scores.get(id) ?? tagScores.get(id) ?? readingScores.get(id) ?? 0) * 1000) / 1000
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
        terms_ranked: Object.freeze([...rankedWords]),
        terms_ignored: Object.freeze(ignored),
        // How the words matched, for the model reading the result (find_journal_quotes's description): across their forms
        // and accents, more of them first, on a generation with a word list (version 3); exactly, rarer ones counting more,
        // elsewhere.
        ranking: wordList ? "word_forms" : "exact_words",
        // Exact only when every match counts: a time window or a kind filter is checked quote by quote while scanning,
        // so with either the counts are unknown (null) rather than the unfiltered ones.
        matching_quotes: windowed || kinds !== null ? null : ranked.length,
        tags: tagged,
        reading_facets: readingAvailable,
        ...(readingAvailable ? { matching_only_by_reading: windowed || kinds !== null
          ? null : readingOnly.length } : {}),
        ...(tagged ? { matching_only_by_tag: windowed || kinds !== null ? null : tagOnly.length } : {}),
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

  // How many quotes there are, the mean of their lengths, and for each of the words the quotes that hold it as [id, uses, length]. A
  // word list (version 3 of the quote index) says how often a quote uses the word and how long the quote is. Elsewhere, and for a word
  // looked up as written, the word index says only which records hold the word: each passage among them counts as one use in a quote of
  // mean length, so BM25 goes by how rare the word is. Those passages are the ones the generation lists as such; its word list names
  // passages alone.
  const evidencePostings = async (terms, wordList) => {
    let population, meanLength = 1;
    if (wordList) {
      const [totals = null] = await readIndex("quote_terms", QUOTE_TERMS_STATS_KEY);
      invariant(totals !== null && Number.isSafeInteger(totals.quotes) && totals.quotes >= 0 && Number.isFinite(totals.mean_length) && totals.mean_length > 0,
        "QUOTE_TERMS_INVALID");
      population = totals.quotes;
      meanLength = totals.mean_length;
    }
    const passages = terms.some(({ exact }) => exact) || !wordList ? new Set(await readIndex("kinds", "passage")) : null;
    const holders = await Promise.all(terms.map(async ({ term, exact }) => (exact
      ? [...new Set((await Promise.all(exact.map((word) => readIndex("lexical", word)))).flat())].filter((id) => passages.has(id)).map((id) => [id, 1, meanLength])
      : readIndex("quote_terms", term))));
    return { population: population ?? passages.size, meanLength, holders };
  };

  // A candidate of an evidence search, checked on its own record: a passage, in a lifecycle that may be used, not restricted, whose exact
  // words are the bytes stored for it, as resolveEvidence checks them. What can't be used comes back with the reason instead. A record
  // of another case or corpus still refuses the whole search, and a failure that isn't this record's own still fails it.
  const evidenceCandidate = async (id) => {
    let record;
    try { record = await loadRecord(id); }
    catch (error) {
      if (!(error instanceof ValidationError) || error.code === "GRAPH_RECORD_SCOPE_MISMATCH") throw error;
      return { unusable: "record_unavailable" };
    }
    if (record.kind !== "passage") return { unusable: "not_a_quotation" };
    if (!EVIDENCE_LIFECYCLES.includes(record.lifecycle)) return { unusable: "deleted_or_revoked_quotation" };
    if (record.data.disclosure === "restricted") return { unusable: "restricted_quotation" };
    if (typeof record.data.quote !== "string" || !record.data.quote.length) return { unusable: "quotation_unavailable" };
    try {
      const text = await exactText({ representationId: record.data.representation_id, startByte: record.data.start_byte, endByte: record.data.end_byte,
        expectedSha256: record.data.quote_sha256 });
      invariant(text === record.data.quote, "SOURCE_SPAN_QUOTE_MISMATCH");
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      return { unusable: "words_not_verified" };
    }
    return { record };
  };

  /**
   * The quotes a whole message may be about, ranked, for a reply's evidence (EVIDENCE_QUOTE_SEARCH says how the numbers were chosen).
   * The message's words are read as the generation's word list reads them, or exactly where it has none, without the English and
   * French stop words (`evidenceTerms`). Of the words some quotes hold, the common ones are left out and the rarest chosen; with none
   * left there is no result, never a search by stop words. The order is Okapi BM25 over the chosen words, then the id: unlike `findQuotes`, no quote
   * goes first for holding more of them, since in a long message many weak words would beat the one that matters. A quote is kept for
   * a rare word, or for enough of the chosen ones. Of the kept quotes, in order, the first `limit` that may be used come back: each is
   * checked on its record (`evidenceCandidate`), and one that may not be used is counted in `omitted` with its reason and never fails
   * the search. Sharing words with the message doesn't make a quote relevant to it: that is for its reader to judge.
   *
   * Each quote has its record id, exact words and span, its lifecycle, when it was written as the quote index dates it (null without a
   * date or a quote index; an interval has `between`, open at an end where a bound is null), its wording cues (`quoteCues`) and the
   * chosen words it holds. `terms` says which words were chosen and which left out and why, with how many quotes hold each; `kept`,
   * `examined` and `returned` count the kept quotes, those looked at and those returned.
   *
   * The result cache holds, for these words in this snapshot, how many quotes there are, how many hold each word (by its place, never
   * the word) and the kept quotes' ids in order; each record is read and checked again on every call.
   */
  const findEvidenceQuotes = async ({ query, limit } = {}) => {
    await assertCurrent();
    invariant(typeof query === "string" && query.length <= EVIDENCE_QUOTE_SEARCH.queryCharacters, "QUOTE_QUERY_INVALID");
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= EVIDENCE_QUOTE_SEARCH.candidatesMax, "QUOTE_LIMIT_INVALID");
    const wordList = Array.isArray(manifest.indexes.quote_terms);
    const terms = evidenceTerms(query, wordList);
    const key = cacheKey("evidence-quotes", EVIDENCE_QUOTE_SEARCH.version, sha256(Buffer.from(JSON.stringify(terms), "utf8")));
    let entry = terms.length ? resultCache?.get(key) ?? null : [0];
    if (!entry) {
      const { population, meanLength, holders } = await evidencePostings(terms, wordList);
      const { rare, matched } = EVIDENCE_QUOTE_SEARCH;
      const rareUpTo = Math.max(rare.quotes, rare.share * population);
      const { chosen } = chooseEvidenceTerms(holders.map((list) => list.length), population);
      const scores = new Map(), held = new Map(), holdsRare = new Set();
      for (const place of chosen) {
        const list = holders[place];
        const weight = Math.log(1 + (population - list.length + 0.5) / (list.length + 0.5));
        for (const [id, uses, length] of list) {
          const factor = 1 - QUOTE_BM25.b + QUOTE_BM25.b * length / meanLength;
          scores.set(id, (scores.get(id) ?? 0) + weight * uses * (QUOTE_BM25.k1 + 1) / (uses + QUOTE_BM25.k1 * factor));
          held.set(id, (held.get(id) ?? 0) + 1);
          if (list.length <= rareUpTo) holdsRare.add(id);
        }
      }
      const enough = Math.max(matched.terms, matched.share * chosen.length);
      const kept = [...scores.keys()].filter((id) => holdsRare.has(id) || held.get(id) >= enough)
        .sort((left, right) => scores.get(right) - scores.get(left) || left.localeCompare(right));
      entry = [String(population), ...holders.map((list) => String(list.length)), ...kept];
      resultCache?.set(key, entry);
    }
    const population = Number(entry[0]);
    const counts = entry.slice(1, 1 + terms.length).map(Number);
    const kept = entry.slice(1 + terms.length);
    const { chosen, dropped } = chooseEvidenceTerms(counts, population);
    const quoteIndex = Array.isArray(manifest.indexes.quote_meta);
    const quotes = [], omitted = new Map();
    let examined = 0;
    for (const id of kept) {
      if (quotes.length >= limit || examined >= EVIDENCE_QUOTE_SEARCH.candidatesMax) break;
      examined += 1;
      const { record, unusable } = await evidenceCandidate(id);
      if (unusable) { omitted.set(unusable, (omitted.get(unusable) ?? 0) + 1); continue; }
      const text = record.data.quote;
      const date = (quoteIndex ? (await readIndex("quote_meta", id))[0] : null)?.written ?? null;
      quotes.push(Object.freeze({
        record_id: id,
        text,
        start_byte: record.data.start_byte,
        end_byte: record.data.end_byte,
        lifecycle: record.lifecycle,
        written: date ? Object.freeze({ from: date.from, to: date.to, precision: date.precision, between: date.between === true,
          ambiguous: date.ambiguous === true, year_inferred: date.year_inferred === true }) : null,
        cues: quoteCues(text),
        matched_terms: Object.freeze(chosen.map((place) => terms[place]).filter(quoteHoldsTerm(text, wordList)).map(({ term }) => term))
      }));
    }
    const result = Object.freeze({
      quotes: Object.freeze(quotes),
      kept: kept.length,
      examined,
      returned: quotes.length,
      omitted: Object.freeze([...omitted].map(([reason, count]) => Object.freeze({ reason, count }))),
      terms: Object.freeze({
        quotes: terms.length ? population : null,
        chosen: Object.freeze(chosen.map((place) => Object.freeze({ term: terms[place].term, quotes: counts[place] }))),
        dropped: Object.freeze([...dropped].sort(([left], [right]) => left - right)
          .map(([place, reason]) => Object.freeze({ term: terms[place].term, quotes: counts[place], reason })))
      })
    });
    await assertCurrent();
    return result;
  };

  return Object.freeze({
    manifest: structuredClone(manifest),
    search,
    findQuotes,
    findEvidenceQuotes,
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
