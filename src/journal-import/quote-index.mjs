import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { ValidationError } from "../core/errors.mjs";
import { adaptExtractionToGraph } from "./graph.mjs";

// The quote index: the journal split into paragraph-sized exact quotes, searchable by their words and
// by the date line each was written under. Everything here is mechanical. No model reads or writes
// any of it, so nothing in it can paraphrase the person: an answer quotes these spans, and the
// meaning is read from them when they're used (plan 2026-10-09-journal-quote-first.md).

export const QUOTE_INDEX_VERSION = "quote-index-v1";
// Keys of the `quote_months` index besides the months themselves ("2019-03"): the list of months
// that have quotes, and the quotes with no date line above them.
export const QUOTE_MONTHS_KEY = "months";
export const QUOTE_UNDATED_KEY = "undated";
export const QUOTE_UNIT_DEFAULTS = Object.freeze({ maximumBytes: 1600, minimumBytes: 160, headingMaximumBytes: 80 });

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const NEWLINE = 0x0a;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

const MONTHS = new Map(Object.entries({
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12
}));
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
const WEEKDAY = "(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+)?";
const ORDINAL = "(?:st|nd|rd|th)?";
const DATE_PATTERNS = [
  // Monday, March 3, 2019 / March 3rd 2019 / Mar. 3, 2019
  { pattern: new RegExp(`^\\s*${WEEKDAY}${MONTH}\\.?\\s+(\\d{1,2})${ORDINAL},?\\s+(\\d{4})(?![\\p{L}\\p{N}])`, "iu"), parts: (m) => [m[3], MONTHS.get(m[1].toLowerCase()), m[2]] },
  // Monday 3 March 2019 / 3rd of March, 2019
  { pattern: new RegExp(`^\\s*${WEEKDAY}(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+(\\d{4})(?![\\p{L}\\p{N}])`, "iu"), parts: (m) => [m[3], MONTHS.get(m[2].toLowerCase()), m[1]] },
  // 2019-03-03
  { pattern: /^\s*(\d{4})-(\d{2})-(\d{2})(?![\p{L}\p{N}])/u, parts: (m) => [m[1], m[2], m[3]] },
  // 3/3/2019, 03-03-19, 3.3.19 (month first unless only day-first can be a date)
  { pattern: new RegExp(`^\\s*${WEEKDAY}(\\d{1,2})([/.-])(\\d{1,2})\\2(\\d{4}|\\d{2})(?![\\p{L}\\p{N}])`, "iu"), parts: (m) => numericParts(m[1], m[3], m[4]) },
  // March 2019 on a line of its own
  { pattern: new RegExp(`^\\s*${MONTH}\\.?,?\\s+(\\d{4})\\s*$`, "iu"), parts: (m) => [m[2], MONTHS.get(m[1].toLowerCase()), null] }
];

function numericParts(first, second, year) {
  const a = Number(first), b = Number(second);
  const fullYear = year.length === 2 ? (Number(year) <= 49 ? 2000 + Number(year) : 1900 + Number(year)) : Number(year);
  if (a > 12 && b <= 12) return [fullYear, b, a, { day_first: true }];
  return [fullYear, a, b, { ambiguous: a <= 12 && b <= 12 && a !== b }];
}

const pad = (value) => String(value).padStart(2, "0");

/**
 * The calendar date a line opens with, or null. Only a date at the very start of a line counts: a
 * journal entry begins with its date, and a date in the middle of a sentence is something the entry
 * talks about, not when it was written. Month-first wins for an all-numeric date both ways could
 * read (3/4/19 is March 4) and says so with `ambiguous`.
 */
export function dateLineValue(line) {
  if (typeof line !== "string" || line.length === 0) return null;
  for (const { pattern, parts } of DATE_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const [yearValue, monthValue, dayValue, flags = {}] = parts(match);
    const year = Number(yearValue), month = Number(monthValue);
    if (!Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return null;
    if (dayValue === null) return { from: `${year}-${pad(month)}`, to: `${year}-${pad(month)}`, precision: "month", ...flags };
    const day = Number(dayValue);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isInteger(day) || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    const value = `${year}-${pad(month)}-${pad(day)}`;
    return { from: value, to: value, precision: "day", ...flags };
  }
  return null;
}

// The lines of a text as byte ranges without their newline, with whether each is blank.
function lines(bytes) {
  const result = [];
  for (let start = 0; start <= bytes.length;) {
    let end = bytes.indexOf(NEWLINE, start);
    if (end < 0) end = bytes.length;
    const text = utf8.decode(bytes.subarray(start, end));
    result.push({ start, end, text, blank: /^\s*$/u.test(text) });
    if (end === bytes.length) break;
    start = end + 1;
  }
  return result;
}

// The byte range without leading and trailing whitespace (spaces, tabs, carriage returns, newlines,
// and Unicode spaces), or null when nothing is left.
function trimmed(bytes, start, end) {
  const text = utf8.decode(bytes.subarray(start, end));
  const lead = text.length - text.trimStart().length;
  const kept = text.trim();
  if (!kept) return null;
  const from = start + Buffer.byteLength(text.slice(0, lead), "utf8");
  return { start: from, end: from + Buffer.byteLength(kept, "utf8") };
}

// Where a long paragraph may be cut: after a sentence's closing punctuation and any closing quotes or
// brackets, before whitespace; or at a line end.
function sentenceBreaks(text) {
  const breaks = [];
  const pattern = /[.!?…]+["'”’)\]]*(?=\s)|\n/gu;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) breaks.push(match.index + match[0].length);
  return breaks;
}

// Splits one paragraph's byte range into pieces no longer than the maximum, cutting after a sentence
// where it can and on a character boundary otherwise. Each piece is trimmed, so pieces are exact
// spans with no whitespace at either end.
function splitLong(bytes, start, end, maximumBytes) {
  const pieces = [];
  let cursor = start;
  while (cursor < end) {
    const range = trimmed(bytes, cursor, end);
    if (!range) break;
    cursor = range.start;
    if (end - cursor <= maximumBytes) { pieces.push(trimmed(bytes, cursor, end)); break; }
    const text = utf8.decode(bytes.subarray(cursor, boundaryBefore(bytes, cursor + maximumBytes, cursor)));
    const breaks = sentenceBreaks(text).filter((offset) => offset >= Math.floor(text.length / 3));
    let cut;
    if (breaks.length) cut = cursor + Buffer.byteLength(text.slice(0, breaks.at(-1)), "utf8");
    else {
      const space = text.lastIndexOf(" ");
      cut = cursor + Buffer.byteLength(space > text.length / 3 ? text.slice(0, space) : text, "utf8");
    }
    const piece = trimmed(bytes, cursor, cut);
    if (piece) pieces.push(piece);
    cursor = cut;
  }
  return pieces.filter(Boolean);
}

function boundaryBefore(bytes, offset, lowerBound) {
  let cursor = Math.min(offset, bytes.length);
  while (cursor > lowerBound && cursor < bytes.length && (bytes[cursor] & 0xc0) === 0x80) cursor -= 1;
  return cursor;
}

/**
 * Splits one representation (a page) into quote units: exact, trimmed byte spans of about a
 * paragraph. A short line that opens with a date is its own unit, so the date an entry was written
 * under can be shown with any quote from it. A paragraph longer than the maximum is cut after a
 * sentence; a short paragraph joins the next one when both fit. Whitespace between units is not in
 * any unit; every other byte is in exactly one.
 */
export function splitQuoteUnits({ representationId, text, maximumBytes = QUOTE_UNIT_DEFAULTS.maximumBytes, minimumBytes = QUOTE_UNIT_DEFAULTS.minimumBytes,
  headingMaximumBytes = QUOTE_UNIT_DEFAULTS.headingMaximumBytes }) {
  invariant(typeof representationId === "string" && representationId.length > 0, "REPRESENTATION_ID_INVALID");
  invariant(typeof text === "string" && text.isWellFormed(), "REPRESENTATION_TEXT_INVALID");
  invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= 200 && Number.isSafeInteger(minimumBytes) && minimumBytes >= 0
    && minimumBytes < maximumBytes && Number.isSafeInteger(headingMaximumBytes) && headingMaximumBytes > 0, "QUOTE_UNIT_BOUNDS_INVALID");
  const bytes = Buffer.from(text, "utf8");
  // Paragraphs: runs of non-blank lines. A short date line stands alone.
  const paragraphs = [];
  let open = null;
  const close = () => { if (open) { paragraphs.push(open); open = null; } };
  for (const line of lines(bytes)) {
    if (line.blank) { close(); continue; }
    // A line that opens with a date starts a new entry, so it never continues the paragraph above.
    const date = dateLineValue(line.text);
    if (date) close();
    const range = trimmed(bytes, line.start, line.end);
    if (date && range.end - range.start <= headingMaximumBytes) {
      paragraphs.push({ start: range.start, end: range.end, date, heading: true });
      continue;
    }
    if (!open) open = { start: line.start, end: line.end, date, heading: false };
    else open.end = line.end;
  }
  close();
  // Exact pieces, long paragraphs cut, short ones joined to the next when both fit.
  const pieces = [];
  for (const paragraph of paragraphs) {
    if (paragraph.heading) { pieces.push(paragraph); continue; }
    const split = splitLong(bytes, paragraph.start, paragraph.end, maximumBytes);
    split.forEach((range, index) => pieces.push({ ...range, date: index === 0 ? paragraph.date : null, heading: false }));
  }
  const merged = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (previous && !previous.heading && !piece.heading && !piece.date && previous.end - previous.start < minimumBytes
      && piece.end - previous.start <= maximumBytes) {
      previous.end = piece.end;
      continue;
    }
    merged.push({ ...piece });
  }
  return Object.freeze(merged.map((piece) => {
    const core = bytes.subarray(piece.start, piece.end);
    const digest = sha256(core);
    return Object.freeze({
      unit_id: `unit:${sha256(Buffer.from(`${QUOTE_INDEX_VERSION}\0${representationId}\0${piece.start}\0${piece.end}\0${digest}`, "utf8")).slice(0, 32)}`,
      representation_id: representationId,
      start_byte: piece.start,
      end_byte: piece.end,
      utf8_byte_length: core.byteLength,
      sha256: digest,
      text: utf8.decode(core),
      date_line: piece.date ? Object.freeze({ ...piece.date }) : null,
      heading: piece.heading
    });
  }));
}

const EMPTY_EXTRACTION = (units) => ({
  schema_version: "1.0",
  status: "incomplete",
  assertions: [],
  entities: [],
  episodes: [],
  coverage: units.map((unit) => ({ unit_id: unit.unit_id, disposition: "pending", assertion_local_ids: [], reason: "Quote index: no semantic processing." })),
  requested_context: []
});

/**
 * Builds the quote generation for a staged source: one source record per representation, one
 * passage per quote unit, and the `quote_meta` index. For each quote it holds the exact span and its
 * digest, the page, and the date line the quote was written under (the nearest one above it, carried
 * across pages in source order) with where that line is, so a search can show quotes without
 * decrypting their records. Representations must be in source order.
 */
export function buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId, mediaType, representations, unitOptions = {} }) {
  invariant(typeof caseId === "string" && typeof corpusId === "string" && typeof generation === "string", "QUOTE_GENERATION_IDENTITY_INVALID");
  invariant(typeof originalObjectId === "string" && originalObjectId.length > 0 && typeof mediaType === "string", "QUOTE_GENERATION_SOURCE_INVALID");
  invariant(Array.isArray(representations), "QUOTE_GENERATION_REPRESENTATIONS_INVALID");
  const nodes = [], edges = [];
  const quoteMeta = new Map();
  let current = null;
  let quotes = 0, dated = 0, dateLines = 0, ambiguousDates = 0;
  for (const representation of representations) {
    const { representation_id: representationId, text, page_number: page = null, parse_status: parseStatus = "readable" } = representation;
    const units = splitQuoteUnits({ representationId, text, ...unitOptions });
    const graph = adaptExtractionToGraph({
      caseId,
      corpusId,
      generation,
      source: {
        id: `source:${sha256(Buffer.from(representationId, "utf8")).slice(0, 32)}`,
        representation_id: representationId,
        original_object_id: originalObjectId,
        media_type: mediaType,
        byte_length: Buffer.byteLength(text, "utf8"),
        parse_status: parseStatus,
        page
      },
      units,
      extraction: EMPTY_EXTRACTION(units),
      producerRef: QUOTE_INDEX_VERSION,
      localIdNamespace: QUOTE_INDEX_VERSION
    });
    nodes.push(...graph.nodes);
    edges.push(...graph.edges);
    const passageByUnit = new Map(graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node.id]));
    for (const unit of units) {
      const passageId = passageByUnit.get(unit.unit_id);
      if (!passageId) continue;
      quotes += 1;
      if (unit.date_line) {
        current = {
          from: unit.date_line.from,
          to: unit.date_line.to,
          precision: unit.date_line.precision,
          ambiguous: unit.date_line.ambiguous === true,
          line: { representation_id: representationId, start_byte: unit.start_byte, end_byte: unit.heading ? unit.end_byte : unit.start_byte + lineLength(unit.text), sha256: null }
        };
        const lineBytes = Buffer.from(text, "utf8").subarray(current.line.start_byte, current.line.end_byte);
        current.line.sha256 = sha256(lineBytes);
        dateLines += 1;
        if (current.ambiguous) ambiguousDates += 1;
      }
      if (current) dated += 1;
      quoteMeta.set(passageId, [{
        representation_id: representationId,
        start_byte: unit.start_byte,
        end_byte: unit.end_byte,
        sha256: unit.sha256,
        page,
        written: current ? structuredClone(current) : null
      }]);
    }
  }
  const byKey = ([left], [right]) => left.localeCompare(right);
  const sorted = new Map([...quoteMeta.entries()].sort(byKey));
  // Quotes by the month of the date line they were written under, for time windows.
  const months = new Map();
  for (const [passageId, [meta]] of sorted) {
    const key = meta.written ? meta.written.from.slice(0, 7) : QUOTE_UNDATED_KEY;
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(passageId);
  }
  const monthKeys = [...months.keys()].filter((key) => key !== QUOTE_UNDATED_KEY).sort();
  const quoteMonths = new Map([...months.entries(), [QUOTE_MONTHS_KEY, monthKeys]].sort(byKey));
  return Object.freeze({
    graph: Object.freeze({ schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation, nodes, edges }),
    quoteMeta: sorted,
    quoteMonths,
    stats: Object.freeze({ pages: representations.length, quotes, dated_quotes: dated, date_lines: dateLines, ambiguous_date_lines: ambiguousDates })
  });
}

// The length in bytes of a quote's first line, the date line of a paragraph that opens with a date.
function lineLength(text) {
  const end = text.indexOf("\n");
  return Buffer.byteLength((end < 0 ? text : text.slice(0, end)).trimEnd(), "utf8");
}

// Wording that changes what a quote says happened. Found mechanically in each quote shown, so an
// answer can't miss that a quote is a dream, a wish or a plan, or that it is negated or hedged. These
// are signals to keep, never a reading of the quote: the quote itself is always shown with them.
const CUE_PATTERNS = Object.freeze([
  ["dream", /\b(?:dream(?:s|t|ed|ing)?|nightmares?)\b/giu],
  ["wish", /\b(?:i wish|wish(?:ed)? (?:i|that|we|he|she|they|you)|if only|i hope|hoping|i want(?:ed)? to|i(?:'|’)d (?:like|love) to|would love to)\b/giu],
  ["plan", /\b(?:i(?:'|’)m going to|i am going to|i(?:'|’)ll|i will|we(?:'|’)ll|we will|plan(?:ning|ned)? to|intend(?:ing)? to|tomorrow i|next (?:week|month|year) i)\b/giu],
  ["hypothetical", /\b(?:what if|imagine[ds]?|imagining|pretend(?:ed|ing)?|as if|would have|could have|should have|if i (?:were|had|could))\b/giu],
  ["negation", /\b(?:not|never|no longer|nobody|nothing|none|neither|nor|without|(?:did|do|does|was|were|is|are|ca|could|wo|would|have|has|had|should|must)n(?:'|’)t|can(?:'|’)?t|cannot)\b/giu],
  ["hedge", /\b(?:maybe|perhaps|probably|possibly|i think|i guess|i suppose|i feel like|might|seem(?:s|ed)?|apparently|not sure|kind of|sort of)\b/giu],
  ["reported_speech", /\b(?:said|says|told me|tells me|asked me|according to|claims?|claimed)\b/giu]
]);

export function quoteCues(text) {
  invariant(typeof text === "string", "QUOTE_TEXT_INVALID");
  const found = [];
  const seen = new Set();
  for (const [kind, pattern] of CUE_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const words = match[0].toLocaleLowerCase("und");
      const key = `${kind}\0${words}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ kind, words, at: match.index });
    }
  }
  return Object.freeze(found.sort((left, right) => left.at - right.at || left.kind.localeCompare(right.kind))
    .map(({ kind, words }) => Object.freeze({ kind, words })));
}

// Words too common to rank by. A query made only of them still searches by them.
export const QUOTE_STOPWORDS = Object.freeze(new Set(("a about above after again against all am an and any are as at be because been before being "
  + "below between both but by can could d did do does doing down during each few for from further had has have having he her here hers "
  + "herself him himself his how i if in into is it its itself just ll m me more most my myself now o of off on once only or other our ours "
  + "ourselves out over own re s same she should so some such t than that the their theirs them themselves then there these they this those "
  + "through to too under until up ve very was we were what when where which while who whom why will with would you your yours yourself "
  + "yourselves").split(" ")));
