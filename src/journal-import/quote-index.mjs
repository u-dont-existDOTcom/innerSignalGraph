import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { ValidationError } from "../core/errors.mjs";
import { adaptExtractionToGraph } from "./graph.mjs";

// The quote index: the journal split into paragraph-sized exact quotes, searchable by their words and
// by the date line each was written under. Everything here is mechanical. No model reads or writes
// any of it, so nothing in it can paraphrase the person: an answer quotes these spans, and the
// meaning is read from them when they're used (plan 2026-10-09-journal-quote-first.md).

// v2 (10 Oct 2026): the dates of a journal written in French, day first. More date forms (French month
// and weekday names, marks before a date, year-first dates), a year taken from the entries before a date
// written without one, and a date that ends at the next entry's first line and is carried no further
// than a couple of pages.
export const QUOTE_INDEX_VERSION = "quote-index-v2";
// Keys of the `quote_months` index besides the periods themselves (a month, "2019-03", or a year, "2019",
// for quotes under a year written on a line of its own): the list of those periods, and the quotes with
// no date.
export const QUOTE_MONTHS_KEY = "months";
export const QUOTE_UNDATED_KEY = "undated";
export const QUOTE_UNIT_DEFAULTS = Object.freeze({ maximumBytes: 1600, minimumBytes: 160, headingMaximumBytes: 80 });
// How dates are read. An all-numeric date both ways could read (3/4) is month-first unless the journal's
// owner writes day-first. A date dates the quotes after it on its own page and the next `carryPages`
// pages, or, in a source without pages, the next `carryQuotes` quotes: an entry whose next date line
// went unread must not lend its date to the entries after it, and a wrong date is worse than none.
export const QUOTE_DATE_DEFAULTS = Object.freeze({ numericOrder: "month_first", carryPages: 2, carryQuotes: 24 });
export const QUOTE_NUMERIC_DATE_ORDERS = Object.freeze(["month_first", "day_first"]);

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const NEWLINE = 0x0a;

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

const MONTHS = new Map(Object.entries({
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
  // French
  janvier: 1, janv: 1, "février": 2, fevrier: 2, "févr": 2, fevr: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12, "déc": 12
}));
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|janv|févr|fevr|juil|jan|feb|mar|apr|avr|jun|jul|aug|sept|sep|oct|nov|déc|dec)";
const SPACE = "[\\s\\p{Z}]";
const WEEKDAY_NAME = "(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lun|mer|jeu|ven|sam|dim)";
// An optional weekday before a date, with the French "le" before or after it: "Tuesday, ", "le mardi ",
// "mardi le ", "le ".
const WEEKDAY = `(?:le${SPACE}+)?(?:${WEEKDAY_NAME}\\.?,?${SPACE}+)?(?:le${SPACE}+)?`;
const ORDINAL = "(?:st|nd|rd|th|er)?";
// What may stand before an entry's date on its line: spaces, a run of bullet, heading or rule marks, an
// opening bracket, and a "Date:" label.
const LEAD = `^${SPACE}*(?:[#*>•·▪◦‣⁃=~_|\\-–—]+${SPACE}*)?[\\[(]?${SPACE}*(?:date${SPACE}*[:.\\-–—]${SPACE}*)?`;
const NOT_WORD = "(?![\\p{L}\\p{N}])";
// A time after a date written without its year: "9:40 pm", "at 21:40", "à 21h30", "21h".
const TIME = `(?:(?:at|à)${SPACE}+)?\\d{1,2}(?:[:.h]\\d{2}|h)(?:${SPACE}*[ap]\\.?m\\.?)?`;
// After a date written without its year: an optional time, then the end of the line or a separator, so
// "March 3 was the worst day" is a sentence, not a date line.
const TAIL = `(?:${SPACE}*,?${SPACE}*${TIME})?${SPACE}*(?:[,;:.!|)\\]\\-–—]|$)`;
const LINE_END = `${SPACE}*[:.)\\]]?${SPACE}*$`;
const FULL_DATE_PATTERNS = [
  // Monday, March 3, 2019 / March 3rd 2019 / Mar. 3, 2019
  { pattern: new RegExp(`${LEAD}${WEEKDAY}${MONTH}\\.?${SPACE}+(\\d{1,2})${ORDINAL},?${SPACE}+(\\d{4})${NOT_WORD}`, "iu"), parts: (m) => [m[3], MONTHS.get(m[1].toLowerCase()), m[2]] },
  // Monday 3 March 2019 / 3rd of March, 2019 / mardi 3 mars 2020 / le 1er août 2019
  { pattern: new RegExp(`${LEAD}${WEEKDAY}(\\d{1,2})${ORDINAL}${SPACE}+(?:of${SPACE}+)?${MONTH}\\.?,?${SPACE}+(\\d{4})${NOT_WORD}`, "iu"), parts: (m) => [m[3], MONTHS.get(m[2].toLowerCase()), m[1]] },
  // 2019-03-03, 2019/3/3, 2019.03.03, 2019-03-03T21:40
  { pattern: new RegExp(`${LEAD}${WEEKDAY}(\\d{4})([-/.])(\\d{1,2})\\2(\\d{1,2})(?:${NOT_WORD}|(?=T\\d))`, "iu"), parts: (m) => [m[1], m[3], m[4]] },
  // 3/3/2019, 03-03-19, 3.3.19 (in the journal's order, unless only one order can be a date)
  { pattern: new RegExp(`${LEAD}${WEEKDAY}(\\d{1,2})([/.-])(\\d{1,2})\\2(\\d{4}|\\d{2})${NOT_WORD}`, "iu"), parts: (m, order) => numericParts(m[1], m[3], m[4], order) },
  // March 2019 on a line of its own
  { pattern: new RegExp(`${LEAD}${MONTH}\\.?,?${SPACE}+(\\d{4})${LINE_END}`, "iu"), parts: (m) => [m[2], MONTHS.get(m[1].toLowerCase()), null] }
];
// Dates written without a year, which take the year from the dates before them.
const YEARLESS_DATE_PATTERNS = [
  // Tuesday, March 3 / Mar 3rd: / March 3, 9:40 pm
  { pattern: new RegExp(`${LEAD}${WEEKDAY}${MONTH}\\.?${SPACE}+(\\d{1,2})${ORDINAL}${TAIL}`, "iu"), parts: (m) => [MONTHS.get(m[1].toLowerCase()), m[2]] },
  // 3 March / Tues 3rd of March - / mardi 3 mars : / le 1er août, 21h
  { pattern: new RegExp(`${LEAD}${WEEKDAY}(\\d{1,2})${ORDINAL}${SPACE}+(?:of${SPACE}+)?${MONTH}\\.?${TAIL}`, "iu"), parts: (m) => [MONTHS.get(m[2].toLowerCase()), m[1]] },
  // Tue 3/10, mardi 3.10. (numbers after a weekday)
  { pattern: new RegExp(`${LEAD}(?:le${SPACE}+)?${WEEKDAY_NAME}\\.?,?${SPACE}+(\\d{1,2})[/.](\\d{1,2})\\.?${TAIL}`, "iu"), parts: (m, order) => numericParts(m[1], m[2], null, order) },
  // 3/10 alone, or 3.10. with its closing dot
  { pattern: new RegExp(`${LEAD}(\\d{1,2})/(\\d{1,2})${TAIL}`, "iu"), parts: (m, order) => numericParts(m[1], m[2], null, order) },
  { pattern: new RegExp(`${LEAD}(\\d{1,2})\\.(\\d{1,2})\\.${TAIL}`, "iu"), parts: (m, order) => numericParts(m[1], m[2], null, order) }
];
// A year on a line of its own heads the entries under it.
const YEAR_LINE = new RegExp(`${LEAD}((?:19|20)\\d{2})${LINE_END}`, "u");
// A weekday, written in full, on a line of its own ("Sunday", "Tuesday evening:", "Dimanche soir") starts
// an entry whose date isn't given. Abbreviations alone ("Sam") are too often something else.
const WEEKDAY_FULL = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)";
const DAY_PART = "(?:morning|afternoon|evening|night|matin|après-midi|apres-midi|soirée|soiree|soir|nuit)";
const WEEKDAY_LINE = new RegExp(`${LEAD}(?:le${SPACE}+)?${WEEKDAY_FULL}(?:${SPACE}+${DAY_PART})?${SPACE}*[:.\\-–—]?${SPACE}*$`, "iu");

// [year, month, day, flags] of an all-numeric date. When only one order can be a date, that one;
// otherwise the journal's order, marked `ambiguous` unless both read the same.
function numericParts(first, second, year, order = QUOTE_DATE_DEFAULTS.numericOrder) {
  const a = Number(first), b = Number(second);
  const fullYear = year === null ? null : year.length === 2 ? (Number(year) <= 49 ? 2000 + Number(year) : 1900 + Number(year)) : Number(year);
  if (a > 12 && b <= 12) return [fullYear, b, a, { day_first: true }];
  if (b > 12 && a <= 12) return [fullYear, a, b, {}];
  if (order === "day_first") return [fullYear, b, a, { ambiguous: a !== b, day_first: true }];
  return [fullYear, a, b, { ambiguous: a <= 12 && b <= 12 && a !== b }];
}

const pad = (value) => String(value).padStart(2, "0");

// Whether a day exists in a month: in the given year, or in some year (a leap year) when there's none.
function realDay(year, month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1) return false;
  const probe = new Date(Date.UTC(year ?? 2000, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function checkedOrder(numericOrder) {
  invariant(QUOTE_NUMERIC_DATE_ORDERS.includes(numericOrder), "QUOTE_DATE_ORDER_INVALID");
  return numericOrder;
}

/** The date options with their defaults, checked: `numericOrder`, `carryPages` and `carryQuotes`. */
export function quoteDateOptions(options = {}) {
  invariant(options !== null && typeof options === "object" && !Array.isArray(options), "QUOTE_DATE_OPTIONS_INVALID");
  const { numericOrder = QUOTE_DATE_DEFAULTS.numericOrder, carryPages = QUOTE_DATE_DEFAULTS.carryPages,
    carryQuotes = QUOTE_DATE_DEFAULTS.carryQuotes, ...rest } = options;
  invariant(Object.keys(rest).length === 0 && QUOTE_NUMERIC_DATE_ORDERS.includes(numericOrder)
    && Number.isSafeInteger(carryPages) && carryPages >= 0 && carryPages <= 100
    && Number.isSafeInteger(carryQuotes) && carryQuotes >= 1 && carryQuotes <= 10_000, "QUOTE_DATE_OPTIONS_INVALID");
  return Object.freeze({ numericOrder, carryPages, carryQuotes });
}

/**
 * The calendar date a line opens with, or null. Only a date at the start of a line counts (after any
 * bullet, heading mark, bracket or "Date:" label): a journal entry begins with its date, and a date in
 * the middle of a sentence is something the entry talks about, not when it was written. An all-numeric
 * date both ways could read (3/4/19) follows `numericOrder`, month-first by default, and says so with
 * `ambiguous`.
 */
export function dateLineValue(line, { numericOrder = QUOTE_DATE_DEFAULTS.numericOrder } = {}) {
  if (typeof line !== "string" || line.length === 0) return null;
  const order = checkedOrder(numericOrder);
  // Composed form, so an accent written as a separate mark ("fe´vrier") still reads.
  const text = line.normalize("NFC");
  for (const { pattern, parts } of FULL_DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [yearValue, monthValue, dayValue, flags = {}] = parts(match, order);
    const year = Number(yearValue), month = Number(monthValue);
    if (!Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return null;
    if (dayValue === null) return { from: `${year}-${pad(month)}`, to: `${year}-${pad(month)}`, precision: "month", ...flags };
    const day = Number(dayValue);
    if (!realDay(year, month, day)) return null;
    const value = `${year}-${pad(month)}-${pad(day)}`;
    return { from: value, to: value, precision: "day", ...flags };
  }
  return null;
}

/**
 * What an entry's first line says about when it was written, or null when it doesn't start an entry:
 * - `{ kind: "date", from, to, precision, ... }`: a full date (`dateLineValue`);
 * - `{ kind: "yearless", month, day, ... }`: a date written without its year, which takes its year from
 *   the dates before it;
 * - `{ kind: "year", year }`: a year on a line of its own, heading the entries under it;
 * - `{ kind: "weekday" }`: a weekday on a line of its own, an entry whose date isn't given.
 * Each of them starts a new entry, so it ends the date of the entry before.
 */
export function entryDateLine(line, { numericOrder = QUOTE_DATE_DEFAULTS.numericOrder } = {}) {
  if (typeof line !== "string" || !line.trim()) return null;
  const order = checkedOrder(numericOrder);
  const full = dateLineValue(line, { numericOrder: order });
  if (full) return { kind: "date", ...full };
  const text = line.normalize("NFC");
  for (const { pattern, parts } of YEARLESS_DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const result = parts(match, order);
    // numericParts returns [year, month, day, flags]; the textual forms return [month, day].
    const [month, day, flags = {}] = result.length === 4 ? result.slice(1) : result;
    if (realDay(null, Number(month), Number(day))) return { kind: "yearless", month: Number(month), day: Number(day), ...flags };
    return null;
  }
  const year = YEAR_LINE.exec(text);
  if (year) return { kind: "year", year: Number(year[1]) };
  if (WEEKDAY_LINE.test(text)) return { kind: "weekday" };
  return null;
}

// The date an entry line gives once the entries before it are known (`context`: the year and day of the
// latest date read), and the context after it. A date without a year takes the context's year, or the
// next year when it would fall more than a month before the context's day: journals run forward, and
// late December is followed by January. With no year read yet, or a day the year doesn't have, such an
// entry has no date.
function resolveEntryDate(entry, context) {
  if (entry.kind === "date") {
    const { kind, ...date } = entry;
    return { date, context: { year: Number(date.from.slice(0, 4)), day: date.precision === "day" ? date.from : `${date.from}-01` } };
  }
  if (entry.kind === "year") {
    const value = String(entry.year);
    return { date: { from: value, to: value, precision: "year" }, context: { year: entry.year, day: `${value}-01-01` } };
  }
  if (entry.kind !== "yearless" || !context) return { date: null, context };
  let year = context.year;
  const monthBefore = Date.parse(`${context.day}T00:00:00Z`) - 31 * 86_400_000;
  if (Date.UTC(year, entry.month - 1, entry.day) < monthBefore) year += 1;
  if (year > 2100 || !realDay(year, entry.month, entry.day)) return { date: null, context };
  const value = `${year}-${pad(entry.month)}-${pad(entry.day)}`;
  return {
    date: { from: value, to: value, precision: "day", year_inferred: true, ...(entry.ambiguous ? { ambiguous: true } : {}) },
    context: { year, day: value }
  };
}

// Content-free counts of line openings that look like a date but weren't read as one, so a journal's
// own date form can be found without reading it: lines opening with a month or weekday name, and the
// shape of a leading number with separators ("99/99"), digits as 9.
const MONTH_LED = new RegExp(`${LEAD}${MONTH}${NOT_WORD}`, "iu");
const WEEKDAY_LED = new RegExp(`${LEAD}${WEEKDAY_NAME}${NOT_WORD}`, "iu");
const NUMBER_LED = new RegExp(`${LEAD}(\\d+(?:[/.\\-:]\\d+)+[/.]?)`, "u");
const UNREAD_SHAPES_SHOWN = 6;

function countUnreadDateShapes(text, numericOrder, counts) {
  for (const line of text.split("\n")) {
    if (!line.trim() || entryDateLine(line, { numericOrder })) continue;
    const composed = line.normalize("NFC");
    if (MONTH_LED.test(composed)) counts.month_led += 1;
    else if (WEEKDAY_LED.test(composed)) counts.weekday_led += 1;
    else {
      const number = NUMBER_LED.exec(composed);
      if (number) {
        const shape = number[1].replace(/\d/gu, "9");
        counts.shapes.set(shape, (counts.shapes.get(shape) ?? 0) + 1);
      }
    }
  }
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
 * paragraph. A line that opens an entry (`entryDateLine`: a date, a year or a weekday) starts a new
 * unit and is kept on it as `entry_line`; a short one is a unit of its own, so the line an entry was
 * written under can be shown with any quote from it. A paragraph longer than the maximum is cut after a
 * sentence; a short paragraph joins the next one when both fit. Whitespace between units is not in any
 * unit; every other byte is in exactly one.
 */
export function splitQuoteUnits({ representationId, text, maximumBytes = QUOTE_UNIT_DEFAULTS.maximumBytes, minimumBytes = QUOTE_UNIT_DEFAULTS.minimumBytes,
  headingMaximumBytes = QUOTE_UNIT_DEFAULTS.headingMaximumBytes, numericOrder = QUOTE_DATE_DEFAULTS.numericOrder }) {
  invariant(typeof representationId === "string" && representationId.length > 0, "REPRESENTATION_ID_INVALID");
  invariant(typeof text === "string" && text.isWellFormed(), "REPRESENTATION_TEXT_INVALID");
  invariant(Number.isSafeInteger(maximumBytes) && maximumBytes >= 200 && Number.isSafeInteger(minimumBytes) && minimumBytes >= 0
    && minimumBytes < maximumBytes && Number.isSafeInteger(headingMaximumBytes) && headingMaximumBytes > 0, "QUOTE_UNIT_BOUNDS_INVALID");
  const order = checkedOrder(numericOrder);
  const bytes = Buffer.from(text, "utf8");
  // Paragraphs: runs of non-blank lines. A short entry line stands alone.
  const paragraphs = [];
  let open = null;
  const close = () => { if (open) { paragraphs.push(open); open = null; } };
  for (const line of lines(bytes)) {
    if (line.blank) { close(); continue; }
    // A line that opens an entry starts a new one, so it never continues the paragraph above.
    const entry = entryDateLine(line.text, { numericOrder: order });
    if (entry) close();
    const range = trimmed(bytes, line.start, line.end);
    if (entry && range.end - range.start <= headingMaximumBytes) {
      paragraphs.push({ start: range.start, end: range.end, entry, heading: true });
      continue;
    }
    if (!open) open = { start: line.start, end: line.end, entry, heading: false };
    else open.end = line.end;
  }
  close();
  // Exact pieces, long paragraphs cut, short ones joined to the next when both fit.
  const pieces = [];
  for (const paragraph of paragraphs) {
    if (paragraph.heading) { pieces.push(paragraph); continue; }
    const split = splitLong(bytes, paragraph.start, paragraph.end, maximumBytes);
    split.forEach((range, index) => pieces.push({ ...range, entry: index === 0 ? paragraph.entry : null, heading: false }));
  }
  const merged = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (previous && !previous.heading && !piece.heading && !piece.entry && previous.end - previous.start < minimumBytes
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
      entry_line: piece.entry ? Object.freeze({ ...piece.entry }) : null,
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
 * digest, the page, and the date it was written under, with where that date's line is, so a search can
 * show quotes without decrypting their records. Representations must be in source order.
 *
 * Dates (`dateOptions`, `QUOTE_DATE_DEFAULTS`). Each entry line (`entryDateLine`) ends the date before
 * it. A full date dates the quotes after it; a year alone dates them to that year; a date without a year
 * takes one from the dates before it and says so with `year_inferred`; a weekday alone, or a date whose
 * year can't be known, leaves them undated. A date is carried over the quotes after its line on its own
 * page and the next `carryPages` pages (`carryQuotes` quotes when there are no page numbers), and no
 * further: past that, quotes are undated. A page whose text wasn't fully read (any parse status but
 * "readable") may hide a newer date line or a new year, so no date is carried into it or past it, and
 * no date without a year after it takes its year from before it: its quotes, and the ones after it,
 * are dated only by date lines that can be read.
 *
 * `stats` counts all of it without content: the entry lines of each kind, the quotes left undated by
 * the carry limit, and the line openings that look like a date but weren't read as one.
 *
 * Each quote unit carries its place in the whole journal (`source_order`), so anything an extraction
 * makes from it is ordered across pages. `extractionFor({ representation, units, quoteMeta,
 * passageIdForUnit })`, when given, supplies a page's extraction in place of the empty one, once the
 * page's quotes and their dates are known (the pointer pass's tags, plan Part 3). It may add entities
 * and episodes, but no passage: the page's passages stay exactly its quotes.
 */
export function buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId, mediaType, representations, unitOptions = {}, dateOptions = {},
  extractionFor = null }) {
  invariant(typeof caseId === "string" && typeof corpusId === "string" && typeof generation === "string", "QUOTE_GENERATION_IDENTITY_INVALID");
  invariant(typeof originalObjectId === "string" && originalObjectId.length > 0 && typeof mediaType === "string", "QUOTE_GENERATION_SOURCE_INVALID");
  invariant(Array.isArray(representations), "QUOTE_GENERATION_REPRESENTATIONS_INVALID");
  invariant(extractionFor === null || typeof extractionFor === "function", "QUOTE_GENERATION_EXTRACTION_INVALID");
  let sourceOrder = 0;
  const { numericOrder, carryPages, carryQuotes } = quoteDateOptions(dateOptions);
  const nodes = [], edges = [];
  const quoteMeta = new Map();
  // The date being carried: what it is, where its line is, where it began and how far it has gone.
  let current = null;
  // The year and day of the latest date read, for the dates written without a year.
  let context = null;
  let quotes = 0, dated = 0, dateLines = 0, ambiguousDates = 0, carryCapped = 0;
  const kinds = { full: 0, year_inferred: 0, year_only: 0, no_year_known: 0, weekday_only: 0 };
  const unread = { month_led: 0, weekday_led: 0, shapes: new Map() };
  for (const representation of representations) {
    const { representation_id: representationId, text, page_number: page = null, parse_status: parseStatus = "readable" } = representation;
    const complete = parseStatus === "readable";
    // A page not fully read may hide a date line or a new year: nothing carries into it, and no date
    // after it takes its year from before it.
    if (!complete) { current = null; context = null; }
    const units = splitQuoteUnits({ representationId, text, ...unitOptions, numericOrder })
      .map((unit) => Object.freeze({ ...unit, source_order: sourceOrder++ }));
    countUnreadDateShapes(text, numericOrder, unread);
    const adapt = (extraction) => adaptExtractionToGraph({
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
      extraction,
      producerRef: QUOTE_INDEX_VERSION,
      localIdNamespace: QUOTE_INDEX_VERSION
    });
    let graph = adapt(EMPTY_EXTRACTION(units));
    const passageByUnit = new Map(graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node.id]));
    const textBytes = Buffer.from(text, "utf8");
    for (const unit of units) {
      const passageId = passageByUnit.get(unit.unit_id);
      if (!passageId) continue;
      quotes += 1;
      if (unit.entry_line) {
        const resolved = resolveEntryDate(unit.entry_line, context);
        context = resolved.context;
        const kind = unit.entry_line.kind;
        if (kind === "date") kinds.full += 1;
        else if (kind === "year") kinds.year_only += 1;
        else if (kind === "weekday") kinds.weekday_only += 1;
        else if (resolved.date) kinds.year_inferred += 1;
        else kinds.no_year_known += 1;
        // Every entry line ends the date before it; one that gives no date leaves its entry undated.
        current = null;
        if (resolved.date) {
          const lineEnd = unit.heading ? unit.end_byte : unit.start_byte + lineLength(unit.text);
          current = {
            written: {
              from: resolved.date.from,
              to: resolved.date.to,
              precision: resolved.date.precision,
              ambiguous: resolved.date.ambiguous === true,
              year_inferred: resolved.date.year_inferred === true,
              line: { representation_id: representationId, start_byte: unit.start_byte, end_byte: lineEnd,
                sha256: sha256(textBytes.subarray(unit.start_byte, lineEnd)) }
            },
            page,
            carried: 0,
            capped: false
          };
          dateLines += 1;
          if (current.written.ambiguous) ambiguousDates += 1;
        }
      } else if (current) {
        // How far the date has been carried: by pages when both pages are numbered, else by quotes.
        current.carried += 1;
        const beyond = current.page !== null && page !== null ? page - current.page > carryPages : current.carried > carryQuotes;
        if (beyond) current.capped = true;
      }
      const written = current && !current.capped ? structuredClone(current.written) : null;
      if (current?.capped) carryCapped += 1;
      if (written) dated += 1;
      quoteMeta.set(passageId, [{
        representation_id: representationId,
        start_byte: unit.start_byte,
        end_byte: unit.end_byte,
        sha256: unit.sha256,
        page,
        written
      }]);
    }
    if (extractionFor) {
      const passages = (pageGraph) => pageGraph.nodes.filter((node) => node.kind === "passage").map((node) => node.id).sort();
      const quotePassages = passages(graph);
      graph = adapt(extractionFor({ representation, units, quoteMeta, passageIdForUnit: (unitId) => passageByUnit.get(unitId) ?? null }));
      const extracted = passages(graph);
      invariant(extracted.length === quotePassages.length && extracted.every((id, index) => id === quotePassages[index]), "QUOTE_GENERATION_EXTRACTION_ADDS_PASSAGE");
    }
    nodes.push(...graph.nodes);
    edges.push(...graph.edges);
    if (!complete) { current = null; context = null; }
  }
  const byKey = ([left], [right]) => left.localeCompare(right);
  const sorted = new Map([...quoteMeta.entries()].sort(byKey));
  // Quotes by the period of the date they were written under, for time windows: its month, or its year
  // for a year on its own.
  const periods = new Map();
  for (const [passageId, [meta]] of sorted) {
    const key = meta.written ? meta.written.from.slice(0, 7) : QUOTE_UNDATED_KEY;
    if (!periods.has(key)) periods.set(key, []);
    periods.get(key).push(passageId);
  }
  const periodKeys = [...periods.keys()].filter((key) => key !== QUOTE_UNDATED_KEY).sort();
  const quoteMonths = new Map([...periods.entries(), [QUOTE_MONTHS_KEY, periodKeys]].sort(byKey));
  const shapes = [...unread.shapes].sort(([left, a], [right, b]) => b - a || left.localeCompare(right))
    .slice(0, UNREAD_SHAPES_SHOWN).map(([shape, count]) => Object.freeze({ shape, count }));
  return Object.freeze({
    graph: Object.freeze({ schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation, nodes, edges }),
    quoteMeta: sorted,
    quoteMonths,
    stats: Object.freeze({
      pages: representations.length,
      quotes,
      dated_quotes: dated,
      date_lines: dateLines,
      ambiguous_date_lines: ambiguousDates,
      date_line_kinds: Object.freeze({ ...kinds }),
      carry_capped_quotes: carryCapped,
      unread_date_like: Object.freeze({ month_led: unread.month_led, weekday_led: unread.weekday_led, shapes: Object.freeze(shapes) }),
      numeric_date_order: numericOrder
    })
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
