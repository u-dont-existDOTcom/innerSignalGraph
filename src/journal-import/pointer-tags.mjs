import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { resolveUnitQuote } from "./anchors.mjs";
import { lexicalTerms } from "./graph.mjs";

// The pointer pass's mechanical core (plan 2026-10-09-journal-quote-first.md, Part 3). The quote generation's quotes
// are cut into batches of whole pages; a model (`pointer_tagger`) answers each batch with tags; code checks every tag
// and keeps only anchors that are exact and hold what the label names; the kept tags become a pointer-only extraction
// (entities and episodes, never statements) and two search indexes. A tag only helps find a quote: nothing here
// changes a quote, and no model call repairs a tag.

export const POINTER_TAG_KINDS = Object.freeze(["person", "place", "organization", "topic", "event"]);
// The kinds whose label is a name, which every anchor of the tag must hold.
export const POINTER_NAME_KINDS = Object.freeze(["person", "place", "organization"]);
export const POINTER_TAG_LIMITS = Object.freeze({
  labelMaxCharacters: 80,
  labelMaxWords: 8,
  anchorMaxCharacters: 400,
  anchorsMax: 20,
  tagsMax: 400,
  batchMaxBytes: 6144
});
// Why a tag or an anchor was dropped. Each drop is counted once, under the first rule it breaks.
export const POINTER_DROP_REASONS = Object.freeze(["answer_invalid", "kind_invalid", "label_invalid", "anchor_unit_outside_batch",
  "anchor_unresolved", "anchor_lacks_name", "anchor_lacks_label_word", "anchor_repeat", "too_many_anchors", "too_many_tags",
  "tag_without_anchor"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// The first 32 hex digits of the SHA-256 of the parts joined by NUL.
const digest = (parts) => sha256(Buffer.from(parts.join("\0"), "utf8")).slice(0, 32);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.length > 0;
// Zero-based, or null when the quote is found once, as resolveUnitQuote takes it.
const isOccurrence = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);
// Code-unit order, the same on every machine. Index keys are ordered with localeCompare instead, as the reader looks
// them up.
const byText = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

// Freezes plain data all the way down.
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A quote's page: its page number, or its representation when it has none.
const pageOf = (quote) => (quote.page === null ? quote.representation_id : quote.page);

// Quotes as batching and the untagged count read them: each with its unit, page (a number or null), representation
// and length in bytes, and each unit once.
function checkedQuotes(quotes, invalidCode, duplicateCode) {
  invariant(Array.isArray(quotes), invalidCode);
  const seen = new Set();
  for (const quote of quotes) {
    invariant(isObject(quote) && isText(quote.unit_id) && isText(quote.representation_id)
      && (quote.page === null || (Number.isSafeInteger(quote.page) && quote.page >= 0))
      && Number.isSafeInteger(quote.utf8_byte_length) && quote.utf8_byte_length > 0, invalidCode);
    invariant(!seen.has(quote.unit_id), duplicateCode);
    seen.add(quote.unit_id);
  }
  return quotes;
}

/**
 * Cuts the quotes, given in source order, into the tagger's batches: consecutive whole pages, while a batch holds at
 * most `maxBytes` of quote text. A page over the limit on its own is cut into consecutive groups of its quotes within
 * the limit, and a quote over the limit on its own is a batch by itself. Quotes without a page number are grouped by
 * representation. Every quote is in exactly one batch, in order. A batch's ID is a digest of its unit IDs, so the
 * same quotes always make the same batches.
 */
export function batchPointerQuotes({ quotes, maxBytes = POINTER_TAG_LIMITS.batchMaxBytes } = {}) {
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0, "POINTER_BATCH_INPUT_INVALID");
  checkedQuotes(quotes, "POINTER_BATCH_INPUT_INVALID", "POINTER_BATCH_UNIT_DUPLICATE");
  // Pages in order, each its run of quotes. A page that comes back after another couldn't be kept whole and in order.
  const pages = [];
  const started = new Set();
  for (const quote of quotes) {
    const page = pageOf(quote);
    if (pages.at(-1)?.page !== page) {
      invariant(!started.has(page), "POINTER_BATCH_INPUT_INVALID");
      started.add(page);
      pages.push({ page, quotes: [], bytes: 0 });
    }
    pages.at(-1).quotes.push(quote);
    pages.at(-1).bytes += quote.utf8_byte_length;
  }
  const batches = [];
  let open = null;
  const close = () => {
    if (open) batches.push(open);
    open = null;
  };
  const add = (page, quote) => {
    open ??= { quotes: [], pages: [], bytes: 0 };
    open.quotes.push(quote);
    if (open.pages.at(-1) !== page) open.pages.push(page);
    open.bytes += quote.utf8_byte_length;
  };
  for (const page of pages) {
    if (page.bytes <= maxBytes) {
      if (open && open.bytes + page.bytes > maxBytes) close();
      for (const quote of page.quotes) add(page.page, quote);
      continue;
    }
    // Too long for any batch: its quotes in consecutive groups within the limit, apart from the pages around it.
    close();
    for (const quote of page.quotes) {
      if (open && open.bytes + quote.utf8_byte_length > maxBytes) close();
      add(page.page, quote);
    }
    close();
  }
  close();
  return Object.freeze(batches.map((batch) => {
    const unitIds = batch.quotes.map((quote) => quote.unit_id);
    return Object.freeze({ batch_id: `pointer-batch:${digest(unitIds)}`, unit_ids: Object.freeze(unitIds),
      pages: Object.freeze(batch.pages), bytes: batch.bytes });
  }));
}

// Apostrophes and hyphens as they get typed. Matching folds each set to one form, so "Jean’s" matches "Jean's".
const APOSTROPHES = "'\u2018\u2019\u02bc\uff07\u00b4\u0060\u2032";
const HYPHENS = "\\-\u2010\u2011";
const OTHER_APOSTROPHES = new RegExp(`[${APOSTROPHES.slice(1)}]`, "gu");
const OTHER_HYPHENS = /[\u2010\u2011]/gu;

/**
 * Text as every "ignoring case and accents" comparison here reads it: decomposed (NFD), without combining marks, in
 * lower case, with one form of apostrophe and of hyphen, and each run of whitespace one space.
 */
export function normalizeForMatch(text) {
  invariant(typeof text === "string", "POINTER_MATCH_TEXT_INVALID");
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("und")
    .replace(OTHER_APOSTROPHES, "'").replace(OTHER_HYPHENS, "-").replace(/\s+/gu, " ").trim();
}

// Letters that have case, and digits: a match can't run on into one, so "Jean" isn't found in "Jeanne". Letters of
// scripts without case, often written without spaces between words, don't stop it.
const WORD_EDGE = "[\\p{Lu}\\p{Ll}\\p{Lt}\\p{Nd}]";
const STARTS_WORD = new RegExp(`^${WORD_EDGE}`, "u");
const ENDS_WORD = new RegExp(`${WORD_EDGE}$`, "u");
const REGEXP_SYNTAX = /[\\^$.*+?()[\]{}|/]/gu;

// Whether normalized text holds normalized words, and not as part of a longer word.
function holds(text, words) {
  if (!words) return false;
  const before = STARTS_WORD.test(words) ? `(?<!${WORD_EDGE})` : "";
  const after = ENDS_WORD.test(words) ? `(?!${WORD_EDGE})` : "";
  return new RegExp(`${before}${words.replace(REGEXP_SYNTAX, "\\$&")}${after}`, "u").test(text);
}

// A label's words: runs of letters, marks and digits, split on whitespace and punctuation but not on an apostrophe or
// a hyphen inside a word ("Jean's", "d'Élodie", "Saint-Denis").
const PART = "[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}]*";
const WORDS = new RegExp(`${PART}(?:[${APOSTROPHES}${HYPHENS}]${PART})*`, "gu");
const INNER_APOSTROPHE = new RegExp(`[${APOSTROPHES}]`, "u");
const INNER_HYPHEN = new RegExp(`[${HYPHENS}]`, "u");
// A first letter in upper case, after any digits.
const CAPITALIZED = /^[^\p{L}]*[\p{Lu}\p{Lt}]/u;
const labelWords = (label) => label.match(WORDS) ?? [];

// What every anchor of a topic or event tag must hold: each capitalized word of its label, the first one included.
// An apostrophe inside a word sets an elision or a possessive apart from the name it's attached to ("d'Élodie",
// "Jean's"), so the name is what's checked, and a lower-case first letter can't hide it; a hyphenated word is checked
// whole ("Saint-Denis").
function labelNames(label) {
  const names = new Set();
  for (const word of labelWords(label)) {
    for (const part of word.split(INNER_APOSTROPHE)) {
      if (part.split(INNER_HYPHEN).some((piece) => CAPITALIZED.test(piece))) names.add(normalizeForMatch(part));
    }
  }
  return [...names];
}

// A line break, or any other control character.
const CONTROL = /[\p{Cc}\u2028\u2029]/u;

// A trimmed label within the limits, with at least one word and no line break.
function labelValid(label) {
  const words = labelWords(label).length;
  return label.length > 0 && !CONTROL.test(label) && [...label].length <= POINTER_TAG_LIMITS.labelMaxCharacters
    && words > 0 && words <= POINTER_TAG_LIMITS.labelMaxWords;
}

// The answer's shape, checked here whatever checked it before: a list of tags, each with a kind, a label and a list of
// anchors, each naming a unit, a quote and an occurrence. Other fields are never read.
function answerShaped(answer) {
  return isObject(answer) && answer.schema_version === "1.0" && Array.isArray(answer.tags)
    && answer.tags.every((tag) => isObject(tag) && typeof tag.kind === "string" && typeof tag.label === "string"
      && Array.isArray(tag.anchors) && tag.anchors.every((anchor) => isObject(anchor) && typeof anchor.unit_id === "string"
        && typeof anchor.quote === "string" && isOccurrence(anchor.occurrence)));
}

// Whether an anchor is exact text in its unit: not empty, not too long (counted in characters, as the schema counts
// them), and found by resolveUnitQuote.
function resolves(units, anchor) {
  const characters = [...anchor.quote].length;
  if (characters === 0 || characters > POINTER_TAG_LIMITS.anchorMaxCharacters) return false;
  try {
    resolveUnitQuote(units, anchor);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}

const unitShaped = (unit) => isObject(unit) && isText(unit.unit_id) && typeof unit.text === "string";
const distinctUnits = (units) => new Set(units.map((unit) => unit.unit_id)).size === units.length;

/**
 * Checks one batch's answer from the tagger by code. `units` are the batch's quotes (with `unit_id` and `text`).
 * Returns the kept tags, each anchor reduced to `{ unit_id, quote, occurrence }` and resolved exactly, and the count of
 * drops for every reason in POINTER_DROP_REASONS. Each drop is counted once, under the first rule it breaks: the
 * kind, the label (trimmed), then for each anchor its unit, whether it resolves, the name or label-word rule and
 * repeats, then the limits on anchors and tags. An answer that isn't the expected shape keeps nothing.
 *
 * - A person, place or organization anchor must hold the label, ignoring case and accents (`normalizeForMatch`), so a
 *   quote that says only "he" is never filed under a name.
 * - A topic or event anchor must hold every capitalized word of the label, so a label can't name someone its quotes
 *   don't.
 * - Tags are never merged: two tags with the same kind and label stay two, and an anchor is dropped as a repeat only
 *   when a kept tag of that kind and label already holds the same text at the same place.
 */
export function checkPointerTags({ units, answer } = {}) {
  invariant(Array.isArray(units) && units.every(unitShaped) && distinctUnits(units), "POINTER_CHECK_UNITS_INVALID");
  const dropped = Object.fromEntries(POINTER_DROP_REASONS.map((reason) => [reason, 0]));
  const kept = [];
  const done = () => Object.freeze({ kept: Object.freeze(kept), dropped: Object.freeze(dropped) });
  if (!answerShaped(answer)) {
    dropped.answer_invalid = 1;
    return done();
  }
  const inBatch = new Set(units.map((unit) => unit.unit_id));
  // The anchors of kept tags, by kind, label and place: the same text at the same occurrence is the same place, and
  // null means the only occurrence.
  const held = new Set();
  const placeOf = (kind, label, anchor) => JSON.stringify([kind, label, anchor.unit_id, anchor.quote, anchor.occurrence ?? 0]);
  for (const tag of answer.tags) {
    if (!POINTER_TAG_KINDS.includes(tag.kind)) {
      dropped.kind_invalid += 1;
      continue;
    }
    const label = tag.label.trim();
    if (!labelValid(label)) {
      dropped.label_invalid += 1;
      continue;
    }
    const nameKind = POINTER_NAME_KINDS.includes(tag.kind);
    const name = normalizeForMatch(label);
    const names = labelNames(label);
    const anchors = [];
    const places = new Set();
    for (const anchor of tag.anchors) {
      if (!inBatch.has(anchor.unit_id)) {
        dropped.anchor_unit_outside_batch += 1;
        continue;
      }
      if (!resolves(units, anchor)) {
        dropped.anchor_unresolved += 1;
        continue;
      }
      const text = normalizeForMatch(anchor.quote);
      if (nameKind && !holds(text, name)) {
        dropped.anchor_lacks_name += 1;
        continue;
      }
      if (!nameKind && !names.every((word) => holds(text, word))) {
        dropped.anchor_lacks_label_word += 1;
        continue;
      }
      const place = placeOf(tag.kind, label, anchor);
      if (held.has(place) || places.has(place)) {
        dropped.anchor_repeat += 1;
        continue;
      }
      if (anchors.length >= POINTER_TAG_LIMITS.anchorsMax) {
        dropped.too_many_anchors += 1;
        continue;
      }
      places.add(place);
      anchors.push(Object.freeze({ unit_id: anchor.unit_id, quote: anchor.quote, occurrence: anchor.occurrence }));
    }
    if (anchors.length === 0) {
      dropped.tag_without_anchor += 1;
      continue;
    }
    if (kept.length >= POINTER_TAG_LIMITS.tagsMax) {
      dropped.too_many_tags += 1;
      continue;
    }
    for (const place of places) held.add(place);
    kept.push(Object.freeze({ kind: tag.kind, label, anchors: Object.freeze(anchors) }));
  }
  return done();
}

// A kept tag as checkPointerTags returns it.
const keptShaped = (tag) => isObject(tag) && POINTER_TAG_KINDS.includes(tag.kind) && isText(tag.label)
  && Array.isArray(tag.anchors) && tag.anchors.length > 0
  && tag.anchors.every((anchor) => isObject(anchor) && isText(anchor.unit_id) && isText(anchor.quote) && isOccurrence(anchor.occurrence));

const unknownTime = () => ({ raw: null, from: null, to: null, precision: "unknown", timezone: null, basis: "unresolved", evidence_ids: [] });
// The precisions an extraction's time allows for a known date. Any other becomes the interval between its bounds.
const KNOWN_PRECISIONS = Object.freeze(["instant", "day", "month", "year", "interval"]);

// The date a quote was written under (`quote_meta`), as an episode's authored time, or the unknown time when it has
// none. A known time must name its evidence for the graph to accept it: the quote it dates. A date whose year was taken
// from the entries before it is `relative_supported`, not `explicit`.
function writtenTime(unitId, quoteMeta, passageIdForUnit) {
  const entries = quoteMeta.get(passageIdForUnit(unitId));
  const meta = Array.isArray(entries) ? entries[0] : undefined;
  invariant(isObject(meta) && (meta.written === null || isObject(meta.written)), "POINTER_QUOTE_META_MISSING");
  const { written } = meta;
  if (written === null) return unknownTime();
  invariant(isText(written.from) && isText(written.to), "POINTER_QUOTE_META_INVALID");
  return {
    raw: null,
    from: written.from,
    to: written.to,
    precision: KNOWN_PRECISIONS.includes(written.precision) ? written.precision : "interval",
    timezone: null,
    basis: written.year_inferred === true ? "relative_supported" : "explicit",
    evidence_ids: [unitId]
  };
}

/**
 * The pointer-only extraction of `units` from kept tags: no assertions, and identity never crosses a quote. Each kept
 * person, place or organization tag becomes one entity, and each event tag one episode, per quote it is anchored in;
 * topics stay out (they live only in the tag indexes). A node's one anchor is its whole quote, so
 * adaptExtractionToGraph links it to the quote's own passage and makes no new one. An episode's authored time is the
 * date its quote was written under, from `quoteMeta` (keyed by `passageIdForUnit(unit_id)`); its event time is
 * unknown. Local IDs are digests of kind, label and quote, with a count when the same tag is in a quote twice.
 *
 * Only quotes among `units` get nodes, so a page's extraction can be built from its batch's tags. No other journal
 * text is read.
 */
export function pointerExtraction({ units, kept, quoteMeta, passageIdForUnit } = {}) {
  invariant(Array.isArray(units) && units.every(unitShaped) && distinctUnits(units) && Array.isArray(kept) && kept.every(keptShaped)
    && quoteMeta instanceof Map && typeof passageIdForUnit === "function", "POINTER_EXTRACTION_INPUT_INVALID");
  const byId = new Map(units.map((unit) => [unit.unit_id, unit]));
  const entities = [];
  const episodes = [];
  // Nodes so far for each kind, label and quote.
  const counts = new Map();
  for (const tag of kept) {
    if (tag.kind === "topic") continue;
    for (const unitId of new Set(tag.anchors.map((anchor) => anchor.unit_id))) {
      const unit = byId.get(unitId);
      if (!unit) continue;
      const base = `pointer:${digest([tag.kind, tag.label, unitId])}`;
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      const localId = count === 1 ? base : `${base}:${count}`;
      const anchors = [{ unit_id: unitId, quote: unit.text, occurrence: null }];
      if (tag.kind === "event") {
        episodes.push({ local_id: localId, label: tag.label, authored_time: writtenTime(unitId, quoteMeta, passageIdForUnit),
          event_time: unknownTime(), anchors });
      } else {
        entities.push({ local_id: localId, label: tag.label, entity_kind: tag.kind, anchors });
      }
    }
  }
  return deepFreeze({
    schema_version: "1.0",
    status: "complete",
    assertions: [],
    entities,
    episodes,
    coverage: units.map((unit) => ({ unit_id: unit.unit_id, disposition: "no_assertion", assertion_local_ids: [], reason: "Pointer pass: tags only." })),
    requested_context: []
  });
}

/**
 * The tag indexes of a pass, from each batch's quotes, kept tags and passage IDs (`batches`: `{ units, kept,
 * passageIdForUnit }`):
 * - `quote_tags`: by quote passage ID, the tags anchored in that quote, each with only its anchors there, in order of
 *   kind, label and first anchor;
 * - `tag_terms`: each term of a topic or event label (`lexicalTerms`, as the words index reads text), to the quotes
 *   those tags are anchored in. Name labels aren't added: their quotes hold the name in their own words;
 * - `tagged_unit_ids`: the quotes with at least one kept tag;
 * - `pairs`: one per tag and quote, the units tag precision is measured on, with a content-free ID.
 * Both maps are sorted by key, as the reader looks keys up.
 */
export function pointerTagIndexes({ batches } = {}) {
  invariant(Array.isArray(batches), "POINTER_INDEX_INPUT_INVALID");
  const quoteTags = new Map();
  const tagTerms = new Map();
  const tagged = new Set();
  const pairs = [];
  batches.forEach((batch, batchIndex) => {
    invariant(isObject(batch) && Array.isArray(batch.units) && batch.units.every((unit) => isObject(unit) && isText(unit.unit_id))
      && Array.isArray(batch.kept) && batch.kept.every(keptShaped) && typeof batch.passageIdForUnit === "function", "POINTER_INDEX_INPUT_INVALID");
    const inBatch = new Set(batch.units.map((unit) => unit.unit_id));
    batch.kept.forEach((tag, tagIndex) => {
      // The tag's anchors by quote, in the order the tag gives them.
      const byUnit = new Map();
      for (const { unit_id: unitId, quote, occurrence } of tag.anchors) {
        invariant(inBatch.has(unitId), "POINTER_INDEX_ANCHOR_OUTSIDE_BATCH");
        if (!byUnit.has(unitId)) byUnit.set(unitId, []);
        byUnit.get(unitId).push(Object.freeze({ unit_id: unitId, quote, occurrence }));
      }
      for (const [unitId, anchors] of byUnit) {
        const passageId = batch.passageIdForUnit(unitId);
        invariant(isText(passageId), "POINTER_INDEX_PASSAGE_INVALID");
        if (!quoteTags.has(passageId)) quoteTags.set(passageId, []);
        quoteTags.get(passageId).push(Object.freeze({ kind: tag.kind, label: tag.label, anchors: Object.freeze(anchors) }));
        if (!POINTER_NAME_KINDS.includes(tag.kind)) {
          for (const term of lexicalTerms(tag.label)) {
            if (!tagTerms.has(term)) tagTerms.set(term, new Set());
            tagTerms.get(term).add(passageId);
          }
        }
        tagged.add(unitId);
        pairs.push(Object.freeze({ pair_id: `pair:${digest([tag.kind, tag.label, unitId, batchIndex, tagIndex])}`, kind: tag.kind,
          label: tag.label, unit_id: unitId, passage_id: passageId }));
      }
    });
  });
  const byKey = ([left], [right]) => left.localeCompare(right);
  const first = (tag) => tag.anchors[0];
  const tagOrder = (left, right) => byText(left.kind, right.kind) || byText(left.label, right.label)
    || byText(first(left).quote, first(right).quote) || (first(left).occurrence ?? -1) - (first(right).occurrence ?? -1);
  return Object.freeze({
    quote_tags: new Map([...quoteTags].sort(byKey).map(([passageId, tags]) => [passageId, Object.freeze(tags.sort(tagOrder))])),
    tag_terms: new Map([...tagTerms].sort(byKey).map(([term, passageIds]) => [term, Object.freeze([...passageIds].sort(byText))])),
    tagged_unit_ids: Object.freeze([...tagged].sort(byText)),
    pairs: Object.freeze(pairs)
  });
}

// Numbered pages in order, then pages known by their representation.
const pageOrder = (left, right) => {
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
  return typeof left === "number" ? left - right : byText(left, right);
};

/**
 * The pages none of whose quotes has a kept tag (a representation ID for a page without a number), in order: pages
 * whose batch failed or ran out of time, whose answer gave them no tag, or whose every tag was dropped. Their quotes
 * are still found by their words. `quotes` are as batchPointerQuotes takes them.
 */
export function untaggedPages({ quotes, taggedUnitIds } = {}) {
  checkedQuotes(quotes, "POINTER_PAGES_INPUT_INVALID", "POINTER_PAGES_INPUT_INVALID");
  invariant(Array.isArray(taggedUnitIds) || taggedUnitIds instanceof Set, "POINTER_PAGES_INPUT_INVALID");
  const tagged = new Set(taggedUnitIds);
  const pages = new Set();
  const taggedPages = new Set();
  for (const quote of quotes) {
    pages.add(pageOf(quote));
    if (tagged.has(quote.unit_id)) taggedPages.add(pageOf(quote));
  }
  return Object.freeze([...pages].filter((page) => !taggedPages.has(page)).sort(pageOrder));
}
