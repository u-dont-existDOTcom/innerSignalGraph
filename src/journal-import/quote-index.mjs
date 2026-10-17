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
//
// v3 (15 Oct 2026): a word list of the forms reading (`quote_terms`) that the search ranks by, the order of the dates
// counted, and a range for the quotes left undated between two dates that run forward. The split into quotes is the
// same as v2's, so unit ids keep v2's namespace (`QUOTE_UNIT_NAMESPACE`) while the version names the generation. Passage
// ids, like every id of a graph, also hash the generation's name, so a v3 generation's passage ids are not its v2
// predecessor's: a quote id from a v2 search doesn't resolve in v3, and the same quote has a new id there. Everything v3
// adds is built only for a generation whose name holds the version (`quoteIndexVersionOf`); a v2 generation rebuilds
// exactly as it was.
//
// v4 (17 Oct 2026, the owner: the journal "was written in time order"): every quote gets the time the journal's order gives
// it. The date lines that agree with that order are the anchors; one that breaks it is taken as misread and dates nothing. A
// date without a year read before any year takes one from the date after it. A quote with no date of its own gets the range
// from the nearest anchor before it to the nearest after it, however wide and across pages not fully read, since the order
// holds through them; one before the first anchor or after the last gets a range open at that end. The quotes, their split
// and their unit ids are v3's; a v3 generation rebuilds exactly as it was.
export const QUOTE_INDEX_VERSION = "quote-index-v4";
// The versions after 2, by the name a generation of each holds.
const QUOTE_INDEX_VERSION_NAMES = Object.freeze([[4, "quote-index-v4"], [3, "quote-index-v3"]]);
// The namespace unit ids, and the local ids passage ids are made from, are made under. It is the version the split into
// quotes was made in, and it stays while the split does, so a later index version has the same units, and whatever goes by
// unit id (a pointer run's reference, the search check) maps onto the same quotes.
export const QUOTE_UNIT_NAMESPACE = "quote-index-v2";
// The version a pointer run's own generation is named for (owner decision 38: B): the pointer pass tags the v2 quotes and
// is not published, so it keeps v2's name and reads dates as v2 does.
export const QUOTE_POINTER_VERSION = "quote-index-v2";

/** The index version (2, 3 or 4) a generation is built as, from its name: the version whose name it holds, else 2. */
export function quoteIndexVersionOf(generation) {
  if (typeof generation !== "string") return 2;
  for (const [version, name] of QUOTE_INDEX_VERSION_NAMES) if (generation.includes(name)) return version;
  return 2;
}
// Keys of the `quote_months` index besides the periods themselves (a month, "2019-03", or a year, "2019",
// for quotes under a year written on a line of its own): the list of those periods, and the quotes with
// no date.
export const QUOTE_MONTHS_KEY = "months";
export const QUOTE_UNDATED_KEY = "undated";
// Version 4: the quotes whose range is open at one end (before the first anchor or after the last). A time window reads them
// all and keeps those whose range overlaps it.
export const QUOTE_OPEN_KEY = "open";
// The key of the `quote_terms` index that holds its totals instead of a term. No term can be it: terms are runs of letters and digits.
export const QUOTE_TERMS_STATS_KEY = "#stats";
export const QUOTE_UNIT_DEFAULTS = Object.freeze({ maximumBytes: 1600, minimumBytes: 160, headingMaximumBytes: 80 });
// How dates are read. An all-numeric date both ways could read (3/4) is month-first unless the journal's
// owner writes day-first. A date dates the quotes after it on its own page and the next `carryPages`
// pages, or, in a source without pages, the next `carryQuotes` quotes: an entry whose next date line
// went unread must not lend its date to the entries after it, and a wrong date is worse than none.
// Version 3 also gives a quote left undated between two dates that run forward a range from the first to the second, unless
// the range spans more than `rangeMonthsMax` calendar months. Version 4 has no such limit: the journal's order holds however
// far apart its dates are.
export const QUOTE_DATE_DEFAULTS = Object.freeze({ numericOrder: "month_first", carryPages: 2, carryQuotes: 24, rangeMonthsMax: 12 });
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

/** The date options with their defaults, checked: `numericOrder`, `carryPages`, `carryQuotes` and `rangeMonthsMax`. */
export function quoteDateOptions(options = {}) {
  invariant(options !== null && typeof options === "object" && !Array.isArray(options), "QUOTE_DATE_OPTIONS_INVALID");
  const { numericOrder = QUOTE_DATE_DEFAULTS.numericOrder, carryPages = QUOTE_DATE_DEFAULTS.carryPages,
    carryQuotes = QUOTE_DATE_DEFAULTS.carryQuotes, rangeMonthsMax = QUOTE_DATE_DEFAULTS.rangeMonthsMax, ...rest } = options;
  invariant(Object.keys(rest).length === 0 && QUOTE_NUMERIC_DATE_ORDERS.includes(numericOrder)
    && Number.isSafeInteger(carryPages) && carryPages >= 0 && carryPages <= 100
    && Number.isSafeInteger(carryQuotes) && carryQuotes >= 1 && carryQuotes <= 10_000
    && Number.isSafeInteger(rangeMonthsMax) && rangeMonthsMax >= 1 && rangeMonthsMax <= 120, "QUOTE_DATE_OPTIONS_INVALID");
  return Object.freeze({ numericOrder, carryPages, carryQuotes, rangeMonthsMax });
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

// A date's first day, as YYYY-MM-DD: a year alone starts on 1 January and a month on its first day.
function firstDayOf(date) {
  return date.from.length === 4 ? `${date.from}-01-01` : date.from.length === 7 ? `${date.from}-01` : date.from;
}

// The calendar month a date ends in, as YYYY-MM: a year alone ends in December, a month or a day in its own month.
function lastMonthOf(date) {
  return date.to.length === 4 ? `${date.to}-12` : date.to.slice(0, 7);
}

const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
// The calendar month of a day (YYYY-MM-DD) or a month (YYYY-MM), counted from year 0: months between two are the difference of these.
const monthNumber = (day) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;

// Version 4: the date a line with a day and a month only stands for, next to a day of the journal (`near`, YYYY-MM-DD): the
// earliest such date not before it (`after`), or the latest not after it. Years are tried up to eight from `near`'s (a
// 29 February needs a leap year); null when none fits.
function yearlessDay({ month, day }, near, after) {
  const year = Number(near.slice(0, 4));
  for (let step = 0; step <= 8; step += 1) {
    const candidate = after ? year + step : year - step;
    if (!realDay(candidate, month, day)) continue;
    const value = `${String(candidate).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
    if (after ? value >= near : value <= near) return value;
  }
  return null;
}

// Version 4: how much a dated line says, for the weighing of the journal's order: a day with its year written 3, a month with
// its year 2, and a year alone, or a day whose year was inferred (a yearless line among them), 1, so a line that only names a
// year (a year mentioned at a line's start reads as one) gives way before a full date does.
const lineWeight = ({ written }) => (written.year_inferred === true || written.precision === "year" ? 1 : written.precision === "month" ? 2 : 3);

/**
 * Version 4: which lines, in journal order, agree with the journal's order, and the day each yearless one among them stands
 * for. `lines` are in journal order: a date line with its first `day` (YYYY-MM-DD) and its `written` date, or a yearless line
 * with `yearless` ({ month, day }: an entry's day and month without a year). Of every run of these lines whose days never go
 * back, a yearless line taking its day and month in whatever year keeps the order, the one with the most weight
 * (`lineWeight`; a yearless line weighs 1) is kept. A run begins at a date line, and every yearless line before that line is
 * in it: a chain of them can always run back from it, each the latest day not after the line after it. After it, a yearless
 * line takes the earliest day not before the line before it, which leaves the most room for the lines after it. Of runs with
 * the same weight, each line follows the line before it with the latest day, the closest in time (a date line goes on from a
 * line before it rather than begin a run), and the run ending latest in the journal is kept. The result is the set of the
 * indexes in the run (`kept`) and the days of the yearless ones (`days`); with no date line, nothing.
 */
export function timeOrderRun(lines) {
  // Each run's last line, at the day it takes there: `best` is the run's weight, `previous` its line before (a state's index;
  // -1 where the run begins). A yearless line keeps a state at a later day only when it carries more weight.
  const states = [];
  const bestUpTo = (day, count) => {
    let found = -1;
    for (let index = 0; index < count; index += 1) {
      const state = states[index];
      if (state.day > day) continue;
      if (found === -1 || state.best > states[found].best || (state.best === states[found].best && state.day > states[found].day)) found = index;
    }
    return found;
  };
  let yearlessBefore = 0;
  lines.forEach((line, index) => {
    const count = states.length;
    if (line.yearless === undefined) {
      const weight = lineWeight(line), previous = bestUpTo(line.day, count);
      const begins = yearlessBefore + weight;
      if (previous !== -1 && states[previous].best + weight >= begins) states.push({ line: index, day: line.day, best: states[previous].best + weight, previous });
      else states.push({ line: index, day: line.day, best: begins, previous: -1 });
      return;
    }
    yearlessBefore += 1;
    const days = [...new Set(states.slice(0, count).map((state) => yearlessDay(line.yearless, state.day, true)).filter((day) => day !== null))].sort();
    let top = -1;
    for (const day of days) {
      const previous = bestUpTo(day, count);
      const best = states[previous].best + 1;
      if (best <= top) continue;
      top = best;
      states.push({ line: index, day, best, previous });
    }
  });
  const kept = new Set(), days = new Map();
  let end = -1;
  states.forEach((state, index) => { if (end === -1 || state.best >= states[end].best) end = index; });
  if (end === -1) return { kept, days };
  const path = [];
  for (let state = end; state !== -1; state = states[state].previous) path.unshift(states[state]);
  // The yearless lines before the run's first line (a date line), back from it.
  let next = lines[path[0].line].day;
  for (let index = path[0].line - 1; index >= 0; index -= 1) {
    if (lines[index].yearless === undefined) continue;
    const value = yearlessDay(lines[index].yearless, next, false);
    if (value === null) continue;
    kept.add(index);
    days.set(index, value);
    next = value;
  }
  // The run, each yearless line at the earliest day not before the line before it: never later than the day its state took,
  // so the order holds with the lines after it.
  let previous = null;
  for (const state of path) {
    kept.add(state.line);
    const line = lines[state.line];
    if (line.yearless === undefined) { previous = line.day; continue; }
    const value = yearlessDay(line.yearless, previous, true);
    invariant(value !== null && value <= state.day, "QUOTE_TIME_ORDER_INVALID");
    days.set(state.line, value);
    previous = value;
  }
  return { kept, days };
}
const monthKey = (number) => `${String(Math.floor(number / 12)).padStart(4, "0")}-${pad((number % 12) + 1)}`;

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
      unit_id: `unit:${sha256(Buffer.from(`${QUOTE_UNIT_NAMESPACE}\0${representationId}\0${piece.start}\0${piece.end}\0${digest}`, "utf8")).slice(0, 32)}`,
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
 * Version 3 (`version`) adds two things after the dates are read. `stats.date_order` counts the steps between one date and the
 * next in journal order (`steps`), how many go backwards, to an earlier first day (`backward`), and the largest of them in days
 * (`largest_backward_days`): version 2 assumes the journal runs forward and never checks it. And a quote left undated gets a
 * range when the nearest entry line before it that gave a date and the nearest one after it both exist, the later date's first
 * day is not earlier than the earlier date's, every page from the first line's to the second's was fully read, and the
 * earlier date's first month and the later date's last month are at most `rangeMonthsMax` calendar months apart: `written` is
 * then { from: the earlier date's from, to: the later date's to, precision: "interval", between: true, ambiguous and
 * year_inferred when either date is, line: the earlier date's line, line_after: the later date's line }. A later date that
 * gives only a month or a year ends the range at the end of that month or year (`to` is then that month or year, as on any
 * date). A quote before the first date or after the last stays undated. `quote_months` lists a ranged quote under every month
 * from the earlier date's first to the later date's last, and `stats` counts the ranged quotes and their widths in months.
 *
 * Version 4 reads the dates by the journal's order (the owner: it "was written in time order"), after the first pass reads the
 * lines as version 3 does. (1) The anchors are the heaviest run, in journal order, of the date lines and the entry lines
 * with a day and a month but no year, whose days (a date line's first day, `firstDayOf`) never go back (`timeOrderRun`): a
 * full date outweighs a month, and both a year alone or a yearless line; each yearless line in it takes its day and month in
 * the year that keeps the order, never from a line that may be misread: those before the run's first date line run back
 * from it, each the latest day not after the line after it, and the others take the earliest day not before the line
 * before them (`yearlessDay`). Such a line says so with `year_inferred`. A date line outside the run breaks the order, is
 * taken as misread and dates nothing, and a yearless line outside it dates nothing either: their quotes are dated as if
 * they weren't there. (2) A quote dated by an anchor keeps that date, carried as in version 3; any other quote gets a range
 * from the nearest anchor before it to the nearest anchor after it, however far apart they are and whatever pages between
 * them were read, written as in version 3 (`between`, `line`, `line_after`). A quote before the first anchor gets { from:
 * null, to: the first anchor's to, line: null, line_after: its line }, and one after the last { from: the last anchor's
 * from, to: null, line: its line, line_after: null }: a range open at that end, listed in `quote_months` under
 * `QUOTE_OPEN_KEY`. Only a journal with no anchor leaves quotes undated. In version 4 `date_lines` and `date_order` count
 * the date lines only, not the yearless ones; `stats.time_order` counts the yearless lines dated (anchors) and not, the date
 * lines taken as misread, the anchors, and the quotes with a date, a closed range, a range open at the start or at the
 * end, and none.
 *
 * `stats` counts all of it without content: the entry lines of each kind, the quotes left undated by
 * the carry limit, and the line openings that look like a date but weren't read as one.
 *
 * `version` (2 by default; `quoteIndexVersionOf(generation)` gives it from a generation's name) says which index version
 * the generation is built as. Version 3 adds, beyond what version 2 builds and leaving that exactly as it was, the count of
 * the dates' order and the ranges for the quotes left undated between two dates (below). The word list `quote_terms` is
 * built from the passages by quote-terms.mjs, which the runtime calls for a version 3 generation.
 *
 * Each quote unit carries its place in the whole journal (`source_order`), so anything an extraction
 * makes from it is ordered across pages; `units` lists them all, in that order, each with its page. `extractionFor({ representation, units, quoteMeta,
 * passageIdForUnit })`, when given, supplies a page's extraction in place of the empty one, once the
 * page's quotes and their dates are known (the pointer pass's tags, plan Part 3). It may add entities
 * and episodes, but no passage: the page's passages stay exactly its quotes.
 */
export function buildQuoteGeneration({ caseId, corpusId, generation, originalObjectId, mediaType, representations, unitOptions = {}, dateOptions = {},
  extractionFor = null, version = 2 }) {
  invariant(typeof caseId === "string" && typeof corpusId === "string" && typeof generation === "string", "QUOTE_GENERATION_IDENTITY_INVALID");
  invariant(version === 2 || version === 3 || version === 4, "QUOTE_GENERATION_VERSION_INVALID");
  invariant(typeof originalObjectId === "string" && originalObjectId.length > 0 && typeof mediaType === "string", "QUOTE_GENERATION_SOURCE_INVALID");
  invariant(Array.isArray(representations), "QUOTE_GENERATION_REPRESENTATIONS_INVALID");
  invariant(extractionFor === null || typeof extractionFor === "function", "QUOTE_GENERATION_EXTRACTION_INVALID");
  let sourceOrder = 0;
  // Every quote unit in journal order, with its page, for the passes that read the quotes (plan Part 3).
  const allUnits = [];
  const { numericOrder, carryPages, carryQuotes, rangeMonthsMax } = quoteDateOptions(dateOptions);
  // Version 3 only: every quote in journal order with its page's place, the entry lines that gave a date, which pages were fully
  // read, and the order of the dates.
  const timed = version >= 3;
  // Version 4: dates by the journal's order (above).
  const ordered = version >= 4;
  const journal = [], marks = [], readable = [];
  // Version 4: the entry lines with a day and a month whose year couldn't be read (`no_year_known`), and what dates each quote:
  // the date line or yearless line it is under, while the date is carried (`{ mark }` or `{ pending }`), else null.
  const pending = [];
  const carriers = new Map();
  const dateOrder = { steps: 0, backward: 0, largest_backward_days: 0 };
  let previousDay = null;
  const nodes = [], edges = [];
  // Version 4: each page's quote graph, kept until the dates are known.
  const pagesRead = [];
  // A page's extraction in place of its empty one: the page's passages stay exactly its quotes.
  const extractPage = ({ representation, units, adapt, graph, passageByUnit }) => {
    const passages = (pageGraph) => pageGraph.nodes.filter((node) => node.kind === "passage").map((node) => node.id).sort();
    const quotePassages = passages(graph);
    const extractedGraph = adapt(extractionFor({ representation, units, quoteMeta, passageIdForUnit: (unitId) => passageByUnit.get(unitId) ?? null }));
    const extracted = passages(extractedGraph);
    invariant(extracted.length === quotePassages.length && extracted.every((id, index) => id === quotePassages[index]), "QUOTE_GENERATION_EXTRACTION_ADDS_PASSAGE");
    return extractedGraph;
  };
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
    if (timed) readable.push(complete);
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
      producerRef: QUOTE_UNIT_NAMESPACE,
      localIdNamespace: QUOTE_UNIT_NAMESPACE
    });
    let graph = adapt(EMPTY_EXTRACTION(units));
    const passageByUnit = new Map(graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node.id]));
    for (const unit of units) if (passageByUnit.has(unit.unit_id)) allUnits.push(Object.freeze({ ...unit, page }));
    const textBytes = Buffer.from(text, "utf8");
    for (const unit of units) {
      const passageId = passageByUnit.get(unit.unit_id);
      if (!passageId) continue;
      quotes += 1;
      if (timed) journal.push(passageId);
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
        const lineEnd = unit.heading ? unit.end_byte : unit.start_byte + lineLength(unit.text);
        const line = () => ({ representation_id: representationId, start_byte: unit.start_byte, end_byte: lineEnd,
          sha256: sha256(textBytes.subarray(unit.start_byte, lineEnd)) });
        if (ordered && kind === "yearless") {
          // Version 4: every date without a year gets its year once every line is read, from the lines around it that agree
          // with the journal's order (below), never from a line before it that may be misread.
          pending.push({ at: journal.length - 1, month: unit.entry_line.month, day: unit.entry_line.day,
            ambiguous: unit.entry_line.ambiguous === true, line: line() });
          current = { pending: pending.length - 1, written: null, page, carried: 0, capped: false };
        } else if (resolved.date) {
          current = {
            written: {
              from: resolved.date.from,
              to: resolved.date.to,
              precision: resolved.date.precision,
              ambiguous: resolved.date.ambiguous === true,
              year_inferred: resolved.date.year_inferred === true,
              line: line()
            },
            page,
            carried: 0,
            capped: false
          };
          dateLines += 1;
          if (current.written.ambiguous) ambiguousDates += 1;
          if (timed) {
            const day = firstDayOf(current.written);
            marks.push({ at: journal.length - 1, rep: readable.length - 1, day, written: current.written });
            if (ordered) current.mark = marks.length - 1;
            if (previousDay !== null) {
              dateOrder.steps += 1;
              const back = dayNumber(previousDay) - dayNumber(day);
              if (back > 0) {
                dateOrder.backward += 1;
                dateOrder.largest_backward_days = Math.max(dateOrder.largest_backward_days, back);
              }
            }
            previousDay = day;
          }
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
      if (ordered) carriers.set(passageId, current && !current.capped ? (current.pending !== undefined ? { pending: current.pending } : { mark: current.mark }) : null);
      quoteMeta.set(passageId, [{
        representation_id: representationId,
        start_byte: unit.start_byte,
        end_byte: unit.end_byte,
        sha256: unit.sha256,
        page,
        written
      }]);
    }
    // Version 4 dates a quote only once every page is read (below), so the extraction, which gives an episode its quote's
    // date, runs then; earlier versions run it page by page, as they always have.
    if (ordered) pagesRead.push({ representation, units, adapt, graph, passageByUnit });
    else {
      if (extractionFor) graph = extractPage({ representation, units, adapt, graph, passageByUnit });
      nodes.push(...graph.nodes);
      edges.push(...graph.edges);
    }
    if (!complete) { current = null; context = null; }
  }
  // Version 3: a range for each quote left undated between two dates that run forward (see above). The months a range covers are
  // listed for the quote below, and the widths are counted in calendar months, each range in the narrowest class it fits.
  const rangeMonths = new Map();
  const widths = { up_to_1_month: 0, up_to_3_months: 0, up_to_12_months: 0, ...(ordered || rangeMonthsMax > 12 ? { over_12_months: 0 } : {}) };
  let ranged = 0;
  // Version 4: the quotes whose range is open at one end, and the counts of the time order.
  const openQuotes = new Set();
  const timeOrder = { yearless_dated: 0, yearless_undated: 0, misread_lines: 0, anchors: 0, dated_quotes: 0, ranged_quotes: 0,
    open_start_quotes: 0, open_end_quotes: 0, undated_quotes: 0 };
  if (ordered) {
    // (1) The anchors: the lines that agree with the journal's order, the date lines and the yearless ones together, each yearless
    // one with the day it stands for there (`timeOrderRun`).
    const lines = [...marks.map((mark, index) => ({ at: mark.at, mark: index, written: mark.written, day: mark.day })),
      ...pending.map((item, index) => ({ at: item.at, pending: index, yearless: { month: item.month, day: item.day } }))]
      .sort((left, right) => left.at - right.at);
    const { kept, days } = timeOrderRun(lines);
    const anchors = [];
    lines.forEach((line, index) => {
      if (!kept.has(index)) return;
      if (line.mark !== undefined) { anchors.push(line); return; }
      const item = pending[line.pending], value = days.get(index);
      anchors.push({ at: line.at, pending: line.pending, day: value,
        written: { from: value, to: value, precision: "day", ambiguous: item.ambiguous, year_inferred: true, line: item.line } });
    });
    const keptMarks = new Set(anchors.filter((line) => line.mark !== undefined).map((line) => line.mark));
    const keptPending = new Map(anchors.filter((line) => line.pending !== undefined).map((line) => [line.pending, line.written]));
    // Each date line is an anchor or taken as misread; each yearless line an anchor (dated) or not.
    timeOrder.anchors = anchors.length;
    timeOrder.misread_lines = marks.length - keptMarks.size;
    timeOrder.yearless_dated = keptPending.size;
    timeOrder.yearless_undated = pending.length - keptPending.size;
    // (2) Each quote's date: an anchor's while it is carried; else the range between the anchors around it.
    let next = 0;
    journal.forEach((passageId, at) => {
      const [meta] = quoteMeta.get(passageId);
      const carrier = carriers.get(passageId);
      if (carrier?.mark !== undefined && !keptMarks.has(carrier.mark)) meta.written = null;
      if (carrier?.pending !== undefined) meta.written = keptPending.has(carrier.pending) ? structuredClone(keptPending.get(carrier.pending)) : null;
      while (next < anchors.length && anchors[next].at <= at) next += 1;
      if (meta.written !== null) { timeOrder.dated_quotes += 1; return; }
      const earlier = anchors[next - 1] ?? null, later = anchors[next] ?? null;
      if (!earlier && !later) { timeOrder.undated_quotes += 1; return; }
      const flag = (name) => (earlier?.written[name] === true || later?.written[name] === true);
      meta.written = {
        from: earlier ? earlier.written.from : null,
        to: later ? later.written.to : null,
        precision: "interval",
        between: true,
        ambiguous: flag("ambiguous"),
        year_inferred: flag("year_inferred"),
        line: earlier ? structuredClone(earlier.written.line) : null,
        line_after: later ? structuredClone(later.written.line) : null
      };
      if (!earlier) { timeOrder.open_start_quotes += 1; openQuotes.add(passageId); return; }
      if (!later) { timeOrder.open_end_quotes += 1; openQuotes.add(passageId); return; }
      // From the earlier anchor's first month to the month the later one ends in, as in version 3.
      const first = monthNumber(earlier.day), last = monthNumber(lastMonthOf(later.written));
      rangeMonths.set(passageId, Array.from({ length: last - first + 1 }, (_, index) => monthKey(first + index)));
      ranged += 1;
      timeOrder.ranged_quotes += 1;
      const width = last - first;
      widths[width <= 1 ? "up_to_1_month" : width <= 3 ? "up_to_3_months" : width <= 12 ? "up_to_12_months" : "over_12_months"] += 1;
    });
    dated = timeOrder.dated_quotes;
  } else if (timed) {
    // How many pages were not fully read among the first n pages.
    const unreadUpTo = [0];
    readable.forEach((ok, index) => unreadUpTo.push(unreadUpTo[index] + (ok ? 0 : 1)));
    let next = 0;
    journal.forEach((passageId, at) => {
      // `next` is the first date line after this quote; the one before it is the one just behind.
      while (next < marks.length && marks[next].at < at) next += 1;
      const [meta] = quoteMeta.get(passageId);
      if (meta.written !== null) return;
      const earlier = marks[next - 1], later = marks[next];
      if (!earlier || !later || later.day < earlier.day) return;
      // A page that wasn't fully read may hide a date line, or turn the journal back, anywhere between the two lines.
      if (unreadUpTo[later.rep + 1] - unreadUpTo[earlier.rep] > 0) return;
      // From the earlier date's first month to the month the later date ends in: a year alone runs to December.
      const first = monthNumber(earlier.day), last = monthNumber(lastMonthOf(later.written));
      if (last - first > rangeMonthsMax) return;
      meta.written = {
        from: earlier.written.from,
        to: later.written.to,
        precision: "interval",
        between: true,
        ambiguous: earlier.written.ambiguous || later.written.ambiguous,
        year_inferred: earlier.written.year_inferred || later.written.year_inferred,
        line: structuredClone(earlier.written.line),
        line_after: structuredClone(later.written.line)
      };
      rangeMonths.set(passageId, Array.from({ length: last - first + 1 }, (_, index) => monthKey(first + index)));
      ranged += 1;
      const width = last - first;
      widths[width <= 1 ? "up_to_1_month" : width <= 3 ? "up_to_3_months" : width <= 12 ? "up_to_12_months" : "over_12_months"] += 1;
    });
  }
  // Version 4: the pages' graphs, extracted now that every quote has its date.
  for (const page of pagesRead) {
    const graph = extractionFor ? extractPage(page) : page.graph;
    nodes.push(...graph.nodes);
    edges.push(...graph.edges);
  }
  const byKey = ([left], [right]) => left.localeCompare(right);
  const sorted = new Map([...quoteMeta.entries()].sort(byKey));
  // Quotes by the period of the date they were written under, for time windows: its month, or its year
  // for a year on its own; a ranged quote is under every month its range covers, and one whose range is open at one end
  // (version 4) under `QUOTE_OPEN_KEY`.
  const periods = new Map();
  for (const [passageId, [meta]] of sorted) {
    const keys = openQuotes.has(passageId) ? [QUOTE_OPEN_KEY] : rangeMonths.get(passageId) ?? [meta.written ? meta.written.from.slice(0, 7) : QUOTE_UNDATED_KEY];
    for (const key of keys) {
      if (!periods.has(key)) periods.set(key, []);
      periods.get(key).push(passageId);
    }
  }
  const periodKeys = [...periods.keys()].filter((key) => key !== QUOTE_UNDATED_KEY && key !== QUOTE_OPEN_KEY).sort();
  const quoteMonths = new Map([...periods.entries(), [QUOTE_MONTHS_KEY, periodKeys]].sort(byKey));
  const shapes = [...unread.shapes].sort(([left, a], [right, b]) => b - a || left.localeCompare(right))
    .slice(0, UNREAD_SHAPES_SHOWN).map(([shape, count]) => Object.freeze({ shape, count }));
  return Object.freeze({
    graph: Object.freeze({ schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation, nodes, edges }),
    units: Object.freeze(allUnits),
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
      numeric_date_order: numericOrder,
      ...(timed ? { date_order: Object.freeze({ ...dateOrder }), ranged_quotes: ranged, range_widths: Object.freeze({ ...widths }) } : {}),
      ...(ordered ? { time_order: Object.freeze({ ...timeOrder }) } : {})
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
