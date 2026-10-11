import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateJournalGraph, validateJournalSchema } from "../src/journal-import/contracts.mjs";
import { adaptExtractionToGraph, journalLocalNodeId, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { QUOTE_INDEX_VERSION, buildQuoteGeneration, splitQuoteUnits } from "../src/journal-import/quote-index.mjs";
import { POINTER_DROP_REASONS, POINTER_NAME_KINDS, POINTER_TAG_KINDS, POINTER_TAG_LIMITS, batchPointerQuotes, checkPointerTags,
  normalizeForMatch, pointerExtraction, pointerTagIndexes, untaggedPages } from "../src/journal-import/pointer-tags.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";

// The pointer pass's mechanical core (plan 2026-10-09-journal-quote-first.md, Part 3): batches of whole pages, every
// tag the tagger returns checked by code, and the kept tags as a pointer-only extraction and two indexes. All text here
// is invented.

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const anchor = (unitId, quote, occurrence = null) => ({ unit_id: unitId, quote, occurrence });
const tag = (kind, label, ...anchors) => ({ kind, label, anchors });
const answer = (...tags) => ({ schema_version: "1.0", tags });
const drops = (counts = {}) => ({ ...Object.fromEntries(POINTER_DROP_REASONS.map((reason) => [reason, 0])), ...counts });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the kinds and limits are fixed", () => {
  assert.deepEqual(POINTER_TAG_KINDS, ["person", "place", "organization", "topic", "event"]);
  assert.deepEqual(POINTER_NAME_KINDS, ["person", "place", "organization"]);
  assert.deepEqual(POINTER_TAG_LIMITS, { labelMaxCharacters: 80, labelMaxWords: 8, anchorMaxCharacters: 400, anchorsMax: 20, tagsMax: 400,
    batchMaxBytes: 6144 });
  for (const value of [POINTER_TAG_KINDS, POINTER_NAME_KINDS, POINTER_TAG_LIMITS, POINTER_DROP_REASONS]) assert.ok(Object.isFrozen(value));
});

// Batches.

const quote = (unitId, page, bytes, representationId = `rep:${page}`) => ({ unit_id: unitId, page, representation_id: representationId,
  utf8_byte_length: bytes });
const layout = (batches) => batches.map(({ unit_ids: unitIds, pages, bytes }) => ({ unit_ids: [...unitIds], pages: [...pages], bytes }));

test("batches hold consecutive whole pages within the limit", () => {
  const quotes = [quote("u1", 1, 300), quote("u2", 2, 200), quote("u3", 2, 200), quote("u4", 3, 150), quote("u5", 4, 300)];
  assert.deepEqual(layout(batchPointerQuotes({ quotes, maxBytes: 600 })), [
    { unit_ids: ["u1"], pages: [1], bytes: 300 },
    // Only part of page 2 would fit beside page 1, so the page starts the next batch whole.
    { unit_ids: ["u2", "u3", "u4"], pages: [2, 3], bytes: 550 },
    { unit_ids: ["u5"], pages: [4], bytes: 300 }
  ]);
  // The default limit is 6 KB of quote text.
  assert.deepEqual(layout(batchPointerQuotes({ quotes: [quote("v1", 1, 3000), quote("v2", 2, 3144), quote("v3", 3, 1)] })), [
    { unit_ids: ["v1", "v2"], pages: [1, 2], bytes: 6144 },
    { unit_ids: ["v3"], pages: [3], bytes: 1 }
  ]);
});

test("a page over the limit is cut into consecutive groups, and a quote over it is a batch of its own", () => {
  const quotes = [quote("a", 1, 100), quote("b", 2, 400), quote("c", 2, 300), quote("d", 2, 900), quote("e", 2, 200), quote("f", 2, 250),
    quote("g", 3, 100)];
  assert.deepEqual(layout(batchPointerQuotes({ quotes, maxBytes: 600 })), [
    { unit_ids: ["a"], pages: [1], bytes: 100 },
    { unit_ids: ["b"], pages: [2], bytes: 400 },
    { unit_ids: ["c"], pages: [2], bytes: 300 },
    { unit_ids: ["d"], pages: [2], bytes: 900 },
    { unit_ids: ["e", "f"], pages: [2], bytes: 450 },
    { unit_ids: ["g"], pages: [3], bytes: 100 }
  ]);
});

test("every quote is in exactly one batch, in order, and only a page too long by itself is cut", () => {
  // A stand-in for a journal, from a fixed seed: pages of a few quotes, one page longer than a batch, one quote longer
  // than a batch, and a representation without page numbers.
  let seed = 11;
  const next = (limit) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 1 + (seed % limit);
  };
  const quotes = [];
  for (let page = 1; page <= 120; page += 1) {
    const count = page === 40 ? 9 : next(6);
    for (let index = 0; index < count; index += 1) quotes.push(quote(`unit:${page}:${index}`, page, page === 40 ? 1500 : next(1600)));
  }
  quotes.push(quote("unit:huge", 121, 7000));
  for (let index = 0; index < 8; index += 1) quotes.push(quote(`unit:text:${index}`, null, next(1600), "rep:text"));
  const batches = batchPointerQuotes({ quotes });
  assert.deepEqual(batches.flatMap((batch) => batch.unit_ids), quotes.map((item) => item.unit_id), "each quote once, in order");
  const bytes = new Map(quotes.map((item) => [item.unit_id, item.utf8_byte_length]));
  const batchOf = new Map(batches.flatMap((batch, index) => batch.unit_ids.map((unitId) => [unitId, index])));
  for (const batch of batches) {
    assert.equal(batch.bytes, batch.unit_ids.reduce((total, unitId) => total + bytes.get(unitId), 0));
    if (batch.bytes > POINTER_TAG_LIMITS.batchMaxBytes) assert.deepEqual(batch.unit_ids, ["unit:huge"], "only a quote alone is over the limit");
  }
  const pageOf = (item) => item.page ?? item.representation_id;
  for (const page of new Set(quotes.map(pageOf))) {
    const members = quotes.filter((item) => pageOf(item) === page);
    const total = members.reduce((sum, item) => sum + item.utf8_byte_length, 0);
    const spread = new Set(members.map((item) => batchOf.get(item.unit_id))).size;
    if (total <= POINTER_TAG_LIMITS.batchMaxBytes) assert.equal(spread, 1, `page ${page} stays whole`);
  }
  const longPage = batches.filter((batch) => batch.pages.includes(40));
  assert.deepEqual(longPage.map((batch) => [batch.pages, batch.unit_ids.length]), [[[40], 4], [[40], 4], [[40], 1]], "the long page alone, cut");
  assert.equal(new Set(batches.map((batch) => batch.batch_id)).size, batches.length);
});

test("batch IDs are digests of their quotes, the same every time", () => {
  const quotes = [quote("u1", 1, 300), quote("u2", 2, 200), quote("u3", 3, 400)];
  const first = batchPointerQuotes({ quotes, maxBytes: 600 });
  assert.deepEqual(batchPointerQuotes({ quotes: quotes.map((item) => ({ ...item })), maxBytes: 600 }), first);
  for (const batch of first) {
    assert.equal(batch.batch_id, `pointer-batch:${sha256(Buffer.from(batch.unit_ids.join("\0"), "utf8")).slice(0, 32)}`);
  }
  const other = batchPointerQuotes({ quotes: [quote("u1", 1, 300), quote("u2b", 2, 200)], maxBytes: 600 });
  assert.notEqual(other[0].batch_id, first[0].batch_id);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first[0]) && Object.isFrozen(first[0].unit_ids) && Object.isFrozen(first[0].pages));
});

test("quotes without a page number are grouped by representation", () => {
  const quotes = [quote("t1", null, 200, "rep:a"), quote("t2", null, 200, "rep:a"), quote("t3", null, 300, "rep:b"), quote("t4", 7, 100, "rep:c"),
    quote("t5", null, 100, "rep:d")];
  assert.deepEqual(layout(batchPointerQuotes({ quotes, maxBytes: 500 })), [
    { unit_ids: ["t1", "t2"], pages: ["rep:a"], bytes: 400 },
    { unit_ids: ["t3", "t4", "t5"], pages: ["rep:b", 7, "rep:d"], bytes: 500 }
  ]);
  // A long text journal is one representation without pages: its quotes go in consecutive groups.
  const journal = Array.from({ length: 7 }, (_, index) => quote(`j${index}`, null, 200, "rep:journal"));
  assert.deepEqual(batchPointerQuotes({ quotes: journal, maxBytes: 500 }).map((batch) => [...batch.unit_ids]),
    [["j0", "j1"], ["j2", "j3"], ["j4", "j5"], ["j6"]]);
});

test("malformed batching input is refused", () => {
  const invalid = [undefined, null, "quotes", [null], [{ unit_id: "u", page: 1, representation_id: "r" }],
    [{ unit_id: "u", representation_id: "r", utf8_byte_length: 5 }], [quote("u", -1, 5)], [quote("u", 1.5, 5)], [quote("u", 1, 0)],
    [quote("", 1, 5)], [quote("u", 1, 5, "")]];
  for (const quotes of invalid) assert.throws(() => batchPointerQuotes({ quotes }), { code: "POINTER_BATCH_INPUT_INVALID" });
  assert.throws(() => batchPointerQuotes({ quotes: [quote("u", 1, 5)], maxBytes: 0 }), { code: "POINTER_BATCH_INPUT_INVALID" });
  assert.throws(() => batchPointerQuotes({ quotes: [quote("u1", 1, 5), quote("u2", 2, 5), quote("u3", 1, 5)] }),
    { code: "POINTER_BATCH_INPUT_INVALID" }, "a page that comes back after another can't stay whole in order");
  assert.throws(() => batchPointerQuotes({ quotes: [quote("u1", 1, 5), quote("u1", 2, 5)] }), { code: "POINTER_BATCH_UNIT_DUPLICATE" });
  assert.deepEqual(batchPointerQuotes({ quotes: [] }), []);
});

// Checks.

test("matching ignores case, accents, apostrophe and hyphen forms, and runs of whitespace", () => {
  assert.equal(normalizeForMatch("  ÉLODIE   est\nlà  "), "elodie est la");
  assert.equal(normalizeForMatch("Eléonore"), "eleonore", "an accent written as a separate mark");
  assert.equal(normalizeForMatch("Jean’s"), normalizeForMatch("Jean's"));
  assert.equal(normalizeForMatch("Jean‑Pierre"), "jean-pierre");
  assert.equal(normalizeForMatch("Ça déménage"), "ca demenage");
  assert.throws(() => normalizeForMatch(null), { code: "POINTER_MATCH_TEXT_INVALID" });
});

const UNITS = Object.freeze([
  { unit_id: "unit:a", representation_id: "rep:1", start_byte: 0, text: "Jean est venu dîner avec Élodie. Il a apporté du vin de Lyon." },
  { unit_id: "unit:b", representation_id: "rep:1", start_byte: 70,
    text: "He said the birthday party was too loud. Jean’s birthday is in May, and Jeanne came too." },
  { unit_id: "unit:c", representation_id: "rep:2", start_byte: 0,
    text: "L'anniversaire de Jean à Lyon : ÉLODIE a chanté, puis la fête d’Élodie a commencé." }
]);
// A quote naming Jean 21 times.
const MANY = Object.freeze({ unit_id: "unit:many", representation_id: "rep:4", start_byte: 0,
  text: Array.from({ length: 21 }, (_, index) => `Jean, jour ${index + 1}.`).join(" ") });

test("an anchor must be exact text in the unit it names, one of the batch's quotes", () => {
  const long = { unit_id: "unit:long", representation_id: "rep:3", start_byte: 0, text: `Jean ${"marchait longtemps au bord du canal. ".repeat(12)}`.trim() };
  const { kept, dropped } = checkPointerTags({ units: [...UNITS, long], answer: answer(
    tag("person", "Jean",
      anchor("unit:a", "Jean est venu"),
      anchor("unit:elsewhere", "Jean est venu"), // a unit outside the batch
      anchor("unit:a", "Jean’s birthday"), // text of another unit of the batch, not the one named
      anchor("unit:a", "Jean est venue"), // not the unit's text
      anchor("unit:a", "jean est venu"), // not exact
      anchor("unit:a", "Jean", 1), // no second occurrence
      anchor("unit:a", ""),
      anchor("unit:long", long.text)), // exact, but longer than an anchor may be
    tag("topic", "anniversaires", anchor("unit:b", "birthday"), anchor("unit:b", "birthday", 1)) // the first could be either
  ) });
  assert.deepEqual(plain(kept), [
    tag("person", "Jean", anchor("unit:a", "Jean est venu")),
    tag("topic", "anniversaires", anchor("unit:b", "birthday", 1))
  ]);
  assert.deepEqual(dropped, drops({ anchor_unit_outside_batch: 1, anchor_unresolved: 7 }));
  assert.ok(Object.isFrozen(kept) && Object.isFrozen(kept[0]) && Object.isFrozen(kept[0].anchors) && Object.isFrozen(kept[0].anchors[0]));
});

test("an anchor's length is counted in characters, as the schema counts it", () => {
  // 400 accented characters are 800 bytes: still within the limit. One more character is over it.
  const accented = "é".repeat(400);
  const unit = { unit_id: "unit:accents", representation_id: "rep:4", start_byte: 0, text: `Élodie ${accented} fin` };
  const { kept, dropped } = checkPointerTags({ units: [unit], answer: answer(
    tag("topic", "accents", anchor("unit:accents", accented)),
    tag("topic", "accents longs", anchor("unit:accents", `${accented} f`)) // exact, but 402 characters
  ) });
  assert.deepEqual(plain(kept), [tag("topic", "accents", anchor("unit:accents", accented))]);
  assert.deepEqual(dropped, drops({ anchor_unresolved: 1, tag_without_anchor: 1 }));
});

test("a name tag keeps only the anchors that hold its name, ignoring case and accents", () => {
  const { kept, dropped } = checkPointerTags({ units: UNITS, answer: answer(
    tag("person", "Jean", anchor("unit:a", "Il a apporté du vin"), anchor("unit:b", "He said"), anchor("unit:b", "Jeanne came"),
      anchor("unit:a", "Jean est venu")),
    tag("person", "Elodie", anchor("unit:c", "ÉLODIE a chanté")),
    tag("person", "élodie", anchor("unit:a", "avec Élodie")),
    tag("place", "Lyon", anchor("unit:a", "vin de Lyon"), anchor("unit:c", "Jean à Lyon")),
    tag("organization", "Mairie de Lyon", anchor("unit:c", "Jean à Lyon"))
  ) });
  assert.deepEqual(plain(kept), [
    tag("person", "Jean", anchor("unit:a", "Jean est venu")),
    tag("person", "Elodie", anchor("unit:c", "ÉLODIE a chanté")),
    tag("person", "élodie", anchor("unit:a", "avec Élodie")),
    tag("place", "Lyon", anchor("unit:a", "vin de Lyon"), anchor("unit:c", "Jean à Lyon"))
  ]);
  // "il", "he", and "Jeanne", which isn't "Jean"; and an organization its anchor doesn't name.
  assert.deepEqual(dropped, drops({ anchor_lacks_name: 4, tag_without_anchor: 1 }));
});

test("each capitalized word of a topic or event label, the first included, must be in each of its anchors", () => {
  const { kept, dropped } = checkPointerTags({ units: UNITS, answer: answer(
    tag("event", "Jean's birthday", anchor("unit:b", "the birthday party was too loud"), anchor("unit:b", "Jean’s birthday is in May")),
    tag("event", "anniversaire de Jean", anchor("unit:c", "la fête d’Élodie"), anchor("unit:c", "L'anniversaire de Jean")),
    tag("event", "Birthday party", anchor("unit:b", "was too loud"), anchor("unit:b", "the birthday party")),
    // A name after an elision is still a name.
    tag("event", "fête d'Élodie", anchor("unit:c", "L'anniversaire de Jean"), anchor("unit:c", "la fête d’Élodie")),
    tag("event", "visite de Jean", anchor("unit:b", "Jeanne came too")),
    // Lower-case words are the tagger's own and aren't looked for.
    tag("topic", "vin rouge", anchor("unit:a", "du vin"))
  ) });
  assert.deepEqual(plain(kept), [
    tag("event", "Jean's birthday", anchor("unit:b", "Jean’s birthday is in May")),
    tag("event", "anniversaire de Jean", anchor("unit:c", "L'anniversaire de Jean")),
    tag("event", "Birthday party", anchor("unit:b", "the birthday party")),
    tag("event", "fête d'Élodie", anchor("unit:c", "la fête d’Élodie")),
    tag("topic", "vin rouge", anchor("unit:a", "du vin"))
  ]);
  assert.deepEqual(dropped, drops({ anchor_lacks_label_word: 5, tag_without_anchor: 1 }));
});

test("tags with the same kind and label stay two, and an anchor a kept one already holds is a repeat", () => {
  const { kept, dropped } = checkPointerTags({ units: UNITS, answer: answer(
    tag("person", "Jean", anchor("unit:a", "Jean est venu")),
    // Someone else named Jean, elsewhere: a second tag, never merged with the first.
    tag("person", "Jean", anchor("unit:c", "de Jean")),
    // The first tag's place, as the only occurrence and as occurrence 0: both repeats.
    tag("person", "Jean", anchor("unit:a", "Jean est venu"), anchor("unit:a", "Jean est venu", 0)),
    // A repeat inside one tag.
    tag("person", "Jean", anchor("unit:b", "Jean’s birthday"), anchor("unit:b", "Jean’s birthday")),
    // Another kind with the same words is another tag.
    tag("topic", "Jean", anchor("unit:a", "Jean est venu"))
  ) });
  assert.deepEqual(plain(kept), [
    tag("person", "Jean", anchor("unit:a", "Jean est venu")),
    tag("person", "Jean", anchor("unit:c", "de Jean")),
    tag("person", "Jean", anchor("unit:b", "Jean’s birthday")),
    tag("topic", "Jean", anchor("unit:a", "Jean est venu"))
  ]);
  assert.deepEqual(dropped, drops({ anchor_repeat: 3, tag_without_anchor: 1 }));
});

test("anchors past the limit on a tag, and tags past the limit in an answer, are dropped and counted", () => {
  const anchors = Array.from({ length: 21 }, (_, index) => anchor("unit:many", "Jean", index));
  const many = checkPointerTags({ units: [MANY], answer: answer(tag("person", "Jean", ...anchors)) });
  assert.deepEqual(plain(many.kept[0].anchors), anchors.slice(0, POINTER_TAG_LIMITS.anchorsMax));
  assert.deepEqual(many.dropped, drops({ too_many_anchors: 1 }));

  const tags = Array.from({ length: 401 }, (_, index) => tag("topic", `thème ${index + 1}`, anchor("unit:a", "du vin")));
  const crowded = checkPointerTags({ units: UNITS, answer: answer(...tags) });
  assert.equal(crowded.kept.length, POINTER_TAG_LIMITS.tagsMax);
  assert.equal(crowded.kept.at(-1).label, "thème 400");
  assert.deepEqual(crowded.dropped, drops({ too_many_tags: 1 }));
});

test("labels are trimmed and bounded: no line break, at most 80 characters and eight words", () => {
  const wine = anchor("unit:a", "du vin");
  const { kept, dropped } = checkPointerTags({ units: UNITS, answer: answer(
    tag("person", "  Jean  ", anchor("unit:a", "Jean est venu")),
    tag("topic", "un deux trois quatre cinq six sept huit", wine),
    tag("topic", "é".repeat(80), wine),
    tag("event", "fête\nde Jean", anchor("unit:c", "L'anniversaire de Jean")),
    tag("event", "fête\r\nde Jean", anchor("unit:c", "L'anniversaire de Jean")),
    tag("topic", "un deux trois quatre cinq six sept huit neuf", wine),
    tag("topic", "é".repeat(81), wine),
    tag("person", "   ", anchor("unit:a", "Jean est venu")),
    tag("topic", "— !", wine),
    tag("topic", "vin\u0000rouge", wine)
  ) });
  assert.deepEqual(kept.map(({ label }) => label), ["Jean", "un deux trois quatre cinq six sept huit", "é".repeat(80)]);
  assert.deepEqual(dropped, drops({ label_invalid: 7 }));
});

test("a kind outside the list drops its tag, and each drop counts once, under the first rule it breaks", () => {
  const { kept, dropped } = checkPointerTags({ units: UNITS, answer: answer(
    tag("thing", "vin", anchor("unit:a", "du vin")),
    tag("Person", "Jean", anchor("unit:a", "Jean est venu")),
    tag("", "Jean", anchor("unit:a", "Jean est venu")),
    // A wrong kind with a bad label and a bad anchor: counted as the kind.
    tag("relationship", "a\nb", anchor("unit:elsewhere", "x")),
    // Outside the batch and without the name: counted as outside the batch.
    tag("person", "Jean", anchor("unit:elsewhere", "Il a apporté")),
    // Not exact and without the name: counted as unresolved.
    tag("person", "Jean", anchor("unit:a", "Il a apporte"))
  ) });
  assert.deepEqual(kept, []);
  assert.deepEqual(dropped, drops({ kind_invalid: 4, anchor_unit_outside_batch: 1, anchor_unresolved: 1, tag_without_anchor: 2 }));
});

test("an answer that isn't the expected shape keeps nothing", () => {
  const good = tag("person", "Jean", anchor("unit:a", "Jean est venu"));
  const malformed = [
    undefined, null, "tags", [], {}, { schema_version: "2.0", tags: [good] }, { schema_version: "1.0" }, { schema_version: "1.0", tags: {} },
    answer(good, null),
    answer(good, { kind: "person", label: "Jean" }),
    answer(good, { kind: 1, label: "Jean", anchors: [] }),
    answer(good, { kind: "person", label: ["Jean"], anchors: [] }),
    answer(good, tag("person", "Jean", "Jean est venu")),
    answer(good, tag("person", "Jean", { unit_id: "unit:a", quote: "Jean est venu" })),
    answer(good, tag("person", "Jean", anchor("unit:a", "Jean est venu", -1))),
    answer(good, tag("person", "Jean", anchor("unit:a", "Jean est venu", 1.5))),
    answer(good, tag("person", "Jean", anchor("unit:a", "Jean est venu", "0"))),
    answer(good, tag("person", "Jean", anchor("unit:a", 42))),
    answer(good, tag("person", "Jean", anchor(7, "Jean est venu")))
  ];
  for (const value of malformed) {
    const result = checkPointerTags({ units: UNITS, answer: value });
    assert.deepEqual(result, { kept: [], dropped: drops({ answer_invalid: 1 }) });
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.dropped));
  }
  assert.deepEqual(checkPointerTags({ units: UNITS, answer: answer(good) }).dropped, drops());
  assert.deepEqual(checkPointerTags({ units: UNITS, answer: answer() }), { kept: [], dropped: drops() }, "no tag at all is a valid answer");
  assert.throws(() => checkPointerTags({ units: [{ unit_id: "unit:a" }], answer: answer(good) }), { code: "POINTER_CHECK_UNITS_INVALID" });
  assert.throws(() => checkPointerTags({ units: [UNITS[0], UNITS[0]], answer: answer(good) }), { code: "POINTER_CHECK_UNITS_INVALID" });
});

test("every drop is counted under its own reason, once", () => {
  const filler = Array.from({ length: 395 }, (_, index) => tag("topic", `thème ${index + 1}`, anchor("unit:a", "du vin")));
  const { kept, dropped } = checkPointerTags({ units: [...UNITS, MANY], answer: answer(
    tag("place", "Lyon", anchor("unit:a", "vin de Lyon"), anchor("unit:c", "Jean à Lyon")),
    tag("animal", "chat", anchor("unit:a", "du vin")),
    tag("topic", "vin\nrouge", anchor("unit:a", "du vin")),
    tag("person", "Élodie", anchor("unit:elsewhere", "Élodie"), anchor("unit:a", "avec Élodie")),
    tag("person", "Jean", anchor("unit:a", "Jean est parti"), anchor("unit:a", "Il a apporté"), anchor("unit:a", "Jean est venu")),
    tag("event", "anniversaire de Jean", anchor("unit:c", "la fête d’Élodie"), anchor("unit:c", "L'anniversaire de Jean")),
    tag("place", "Lyon", anchor("unit:a", "vin de Lyon")),
    tag("person", "Jean", ...Array.from({ length: 21 }, (_, index) => anchor("unit:many", "Jean", index))),
    ...filler,
    tag("topic", "un thème de trop", anchor("unit:a", "du vin"))
  ) });
  assert.equal(kept.length, POINTER_TAG_LIMITS.tagsMax);
  assert.deepEqual(dropped, { answer_invalid: 0, kind_invalid: 1, label_invalid: 1, anchor_unit_outside_batch: 1, anchor_unresolved: 1,
    anchor_lacks_name: 1, anchor_lacks_label_word: 1, anchor_repeat: 1, too_many_anchors: 1, too_many_tags: 1, tag_without_anchor: 1 });
  assert.deepEqual(Object.keys(dropped), POINTER_DROP_REASONS);
});

// Into the graph and the indexes, on a quote generation built from an invented journal.

const CASE = "pointer-case";
const CORPUS = "pointer-corpus:quotes";
const GENERATION = "pointer-generation";
const PAGES = [
  "Quelques mots sans date sur le jardin de Jean.\n\nmardi 3 mars 2020\n\nJean est venu dîner avec Élodie. Il a apporté du vin de Lyon.\n\n"
    + "L'anniversaire de Jean était bruyant ; Élodie a chanté.",
  "mardi 10 mars\n\nJean's birthday party in Lyon was loud. He left early.",
  "Dimanche\n\nPromenade au parc avec Élodie et Jean.",
  "Une journée calme, rien à signaler.",
  "Il a appelé ce soir."
].map((text, index) => ({ representation_id: `pointer:page:${index + 1}`, text, page_number: index + 1, parse_status: "readable" }));
// One quote per paragraph, so the example's quotes are easy to name.
const UNIT_OPTIONS = { minimumBytes: 0 };

function pointerJournal() {
  const built = buildQuoteGeneration({ caseId: CASE, corpusId: CORPUS, generation: GENERATION, originalObjectId: "original:pointer",
    mediaType: "application/pdf", representations: PAGES, unitOptions: UNIT_OPTIONS });
  const unitsByPage = PAGES.map((page) => splitQuoteUnits({ representationId: page.representation_id, text: page.text, ...UNIT_OPTIONS }));
  const units = unitsByPage.flat();
  const passageByUnit = new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node.id]));
  const passageIdForUnit = (unitId) => passageByUnit.get(unitId);
  const quotes = unitsByPage.flatMap((pageUnits, index) => pageUnits.map((unit) => ({ unit_id: unit.unit_id, page: index + 1,
    representation_id: unit.representation_id, utf8_byte_length: unit.utf8_byte_length })));
  const unitOf = (fragment) => {
    const found = units.filter((unit) => unit.text.includes(fragment));
    assert.equal(found.length, 1, fragment);
    return found[0].unit_id;
  };
  const passageOf = (fragment) => passageIdForUnit(unitOf(fragment));
  const tagged = answer(
    tag("person", "Jean", anchor(unitOf("jardin de Jean"), "jardin de Jean"), anchor(unitOf("Jean est venu"), "Jean est venu"),
      anchor(unitOf("L'anniversaire"), "L'anniversaire de Jean"), anchor(unitOf("birthday party"), "Jean's birthday"),
      anchor(unitOf("Promenade"), "et Jean")),
    // Another tag with the same name in the same quote: kept apart, never merged.
    tag("person", "Jean", anchor(unitOf("Jean est venu"), "Jean est venu dîner")),
    tag("person", "Élodie", anchor(unitOf("Jean est venu"), "avec Élodie"), anchor(unitOf("L'anniversaire"), "Élodie a chanté"),
      anchor(unitOf("Promenade"), "avec Élodie")),
    tag("place", "Lyon", anchor(unitOf("Jean est venu"), "vin de Lyon"), anchor(unitOf("birthday party"), "in Lyon")),
    tag("event", "anniversaire de Jean", anchor(unitOf("L'anniversaire"), "L'anniversaire de Jean")),
    tag("event", "Jean's birthday party", anchor(unitOf("birthday party"), "Jean's birthday party")),
    tag("event", "promenade au parc", anchor(unitOf("Promenade"), "Promenade au parc")),
    tag("topic", "vin", anchor(unitOf("Jean est venu"), "du vin")),
    tag("topic", "jardin", anchor(unitOf("jardin de Jean"), "le jardin")),
    // Its only anchor says "il", so the last page ends with no kept tag.
    tag("person", "Jean", anchor(unitOf("Il a appelé"), "Il a appelé"))
  );
  const batches = batchPointerQuotes({ quotes });
  assert.equal(batches.length, 1, "a short journal is one batch");
  assert.deepEqual(batches[0].unit_ids, units.map((unit) => unit.unit_id));
  const { kept, dropped } = checkPointerTags({ units, answer: tagged });
  return { built, unitsByPage, units, passageIdForUnit, quotes, unitOf, passageOf, kept, dropped };
}

// Each page's pointer extraction through adaptExtractionToGraph, with the source node the quote generation made for it.
function pointerGraph({ built, unitsByPage, kept, passageIdForUnit }) {
  const nodes = [];
  const edges = [];
  const extractions = PAGES.map((page, index) => {
    const extraction = pointerExtraction({ units: unitsByPage[index], kept, quoteMeta: built.quoteMeta, passageIdForUnit });
    const source = built.graph.nodes.find((node) => node.kind === "source" && node.data.representation_id === page.representation_id);
    const graph = adaptExtractionToGraph({ caseId: CASE, corpusId: CORPUS, generation: GENERATION, source: { id: source.id, ...source.data, page: index + 1 },
      units: unitsByPage[index], extraction, producerRef: QUOTE_INDEX_VERSION, localIdNamespace: QUOTE_INDEX_VERSION });
    nodes.push(...graph.nodes);
    edges.push(...graph.edges);
    return { extraction, graph, source };
  });
  return { extractions, graph: { schema_version: "1.0", case_id: CASE, corpus_id: CORPUS, generation: GENERATION, nodes, edges } };
}

const sources = () => Object.fromEntries(PAGES.map((page) => [page.representation_id, page.text]));
const UNKNOWN_TIME = { raw: null, from: null, to: null, precision: "unknown", timezone: null, basis: "unresolved", evidence_ids: [] };

test("kept tags become a pointer-only extraction: one node per tag and quote, on the quote's own passage", () => {
  const journal = pointerJournal();
  const { built, unitsByPage, kept, dropped, passageIdForUnit, unitOf, passageOf } = journal;
  assert.equal(kept.length, 9);
  assert.deepEqual(dropped, drops({ anchor_lacks_name: 1, tag_without_anchor: 1 }));
  const { extractions, graph } = pointerGraph(journal);

  extractions.forEach(({ extraction, graph: pageGraph, source }, index) => {
    const pageUnits = unitsByPage[index];
    validateJournalSchema("extraction-result", extraction);
    assert.deepEqual(extraction, pointerExtraction({ units: pageUnits, kept, quoteMeta: built.quoteMeta, passageIdForUnit }), "the same every time");
    assert.ok(Object.isFrozen(extraction) && Object.isFrozen(extraction.entities) && Object.isFrozen(extraction.coverage[0]));
    assert.equal(extraction.status, "complete");
    assert.deepEqual(extraction.assertions, []);
    assert.deepEqual(extraction.requested_context, []);
    assert.deepEqual(extraction.coverage, pageUnits.map((unit) => ({ unit_id: unit.unit_id, disposition: "no_assertion", assertion_local_ids: [],
      reason: "Pointer pass: tags only." })));
    for (const item of [...extraction.entities, ...extraction.episodes]) {
      assert.match(item.local_id, /^pointer:[0-9a-f]{32}(?::\d+)?$/u, "local IDs are content-free");
      const unit = pageUnits.find((candidate) => candidate.unit_id === item.anchors[0].unit_id);
      assert.deepEqual(item.anchors, [{ unit_id: unit.unit_id, quote: unit.text, occurrence: null }], "the anchor is the whole quote");
    }
    // No passage beyond the page's quotes: the same passages and edges as the quote generation's.
    assert.deepEqual(pageGraph.nodes.filter((node) => node.kind === "passage"),
      built.graph.nodes.filter((node) => node.kind === "passage" && node.data.representation_id === PAGES[index].representation_id));
    assert.deepEqual(pageGraph.edges, built.graph.edges.filter((edge) => edge.from === source.id));
  });
  validateJournalGraph(graph, sources());
  const nodes = (kind) => graph.nodes.filter((node) => node.kind === kind);
  assert.deepEqual(nodes("passage"), built.graph.nodes.filter((node) => node.kind === "passage"), "every passage is a quote's");
  assert.equal(nodes("assertion").length, 0);
  assert.equal(nodes("entity").length, 11);
  assert.equal(nodes("episode").length, 3);
  assert.ok(!graph.nodes.some((node) => ["vin", "jardin"].includes(node.data?.label)), "topics stay out of the graph");

  // Each entity and episode rests on the whole quote it's tagged in: that quote's own passage.
  const nodeId = (kind, localId) => journalLocalNodeId({ caseId: CASE, corpusId: CORPUS, generation: GENERATION, localIdNamespace: QUOTE_INDEX_VERSION,
    kind, localId });
  for (const { extraction } of extractions) {
    for (const entity of extraction.entities) {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId("entity", entity.local_id));
      assert.deepEqual(node.data, { label: entity.label, entity_kind: entity.entity_kind, aliases: [],
        evidence_ids: [passageIdForUnit(entity.anchors[0].unit_id)] });
    }
    for (const episode of extraction.episodes) {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId("episode", episode.local_id));
      assert.deepEqual(node.data.evidence_ids, [passageIdForUnit(episode.anchors[0].unit_id)]);
    }
  }
  const labelled = (kind, label) => graph.nodes.filter((node) => node.kind === kind && node.data.label === label);
  assert.deepEqual(labelled("entity", "Lyon").map((node) => node.data.evidence_ids), [[passageOf("vin de Lyon")], [passageOf("in Lyon")]],
    "a tag anchored in two quotes is two nodes");
  assert.deepEqual(labelled("entity", "Lyon").map((node) => node.data.entity_kind), ["place", "place"]);
  assert.equal(labelled("entity", "Jean").length, 6);
  const dinner = extractions[0].extraction.entities.filter((entity) => entity.label === "Jean" && entity.anchors[0].unit_id === unitOf("Jean est venu"));
  assert.equal(dinner.length, 2, "two tags with one name in one quote stay two nodes");
  assert.equal(dinner[0].local_id, `pointer:${sha256(Buffer.from(["person", "Jean", unitOf("Jean est venu")].join("\0"), "utf8")).slice(0, 32)}`);
  assert.equal(dinner[1].local_id, `${dinner[0].local_id}:2`);

  // An episode's authored time is its quote's date line, from quote_meta; its event time stays unknown.
  const episode = (label) => labelled("episode", label)[0].data;
  assert.equal(built.quoteMeta.get(passageOf("L'anniversaire"))[0].written.from, "2020-03-03");
  assert.deepEqual(episode("anniversaire de Jean").authored_time, { raw: null, from: "2020-03-03", to: "2020-03-03", precision: "day", timezone: null,
    basis: "explicit", evidence_ids: [passageOf("L'anniversaire")] });
  assert.deepEqual(episode("anniversaire de Jean").event_time, UNKNOWN_TIME);
  assert.equal(built.quoteMeta.get(passageOf("birthday party"))[0].written.year_inferred, true);
  assert.deepEqual(episode("Jean's birthday party").authored_time, { raw: null, from: "2020-03-10", to: "2020-03-10", precision: "day", timezone: null,
    basis: "relative_supported", evidence_ids: [passageOf("birthday party")] }, "a year taken from the entry before isn't explicit");
  assert.equal(built.quoteMeta.get(passageOf("Promenade"))[0].written, null);
  assert.deepEqual(episode("promenade au parc").authored_time, UNKNOWN_TIME, "an undated quote leaves the time unknown");
  assert.deepEqual(episode("promenade au parc").event_time, UNKNOWN_TIME);

  // Only the quotes among the units passed get nodes, and an event needs its quote's meta.
  assert.deepEqual(extractions[3].extraction.entities, []);
  assert.deepEqual(extractions[3].extraction.episodes, []);
  assert.throws(() => pointerExtraction({ units: unitsByPage[0], kept, quoteMeta: new Map(), passageIdForUnit }), { code: "POINTER_QUOTE_META_MISSING" });
  assert.throws(() => pointerExtraction({ units: unitsByPage[0], kept, quoteMeta: new Map([[passageOf("L'anniversaire"), { written: null }]]),
    passageIdForUnit }), { code: "POINTER_QUOTE_META_MISSING" });
  for (const input of [{}, { units: unitsByPage[0], kept: [tag("person", "Jean")], quoteMeta: built.quoteMeta, passageIdForUnit },
    { units: unitsByPage[0], kept, quoteMeta: {}, passageIdForUnit }, { units: unitsByPage[0], kept, quoteMeta: built.quoteMeta }]) {
    assert.throws(() => pointerExtraction(input), { code: "POINTER_EXTRACTION_INPUT_INVALID" });
  }
});

test("the tag indexes give each quote its tags and each topic or event word its quotes, and list the untagged pages", async (t) => {
  const journal = pointerJournal();
  const { built, units, kept, passageIdForUnit, quotes, unitOf, passageOf } = journal;
  const indexes = pointerTagIndexes({ batches: [{ units, kept, passageIdForUnit }] });
  const byKey = (left, right) => left.localeCompare(right);
  const taggedQuotes = ["jardin de Jean", "Jean est venu", "L'anniversaire", "birthday party", "Promenade"];
  assert.deepEqual([...indexes.quote_tags.keys()], taggedQuotes.map(passageOf).sort(byKey));
  // A quote's tags, each with only its anchors in that quote, by kind, label and first anchor.
  const dinner = unitOf("Jean est venu");
  assert.deepEqual(plain(indexes.quote_tags.get(passageOf("Jean est venu"))), [
    tag("person", "Jean", anchor(dinner, "Jean est venu")),
    tag("person", "Jean", anchor(dinner, "Jean est venu dîner")),
    tag("person", "Élodie", anchor(dinner, "avec Élodie")),
    tag("place", "Lyon", anchor(dinner, "vin de Lyon")),
    tag("topic", "vin", anchor(dinner, "du vin"))
  ]);
  const party = unitOf("L'anniversaire");
  assert.deepEqual(plain(indexes.quote_tags.get(passageOf("L'anniversaire"))), [
    tag("event", "anniversaire de Jean", anchor(party, "L'anniversaire de Jean")),
    tag("person", "Jean", anchor(party, "L'anniversaire de Jean")),
    tag("person", "Élodie", anchor(party, "Élodie a chanté"))
  ]);
  // The words of topic and event labels only: a name tag's quotes hold the name in their own words.
  const terms = { anniversaire: ["L'anniversaire"], au: ["Promenade"], birthday: ["birthday party"], de: ["L'anniversaire"],
    jardin: ["jardin de Jean"], jean: ["L'anniversaire", "birthday party"], parc: ["Promenade"], party: ["birthday party"],
    promenade: ["Promenade"], s: ["birthday party"], vin: ["Jean est venu"] };
  assert.deepEqual([...indexes.tag_terms], Object.entries(terms).sort(([left], [right]) => byKey(left, right))
    .map(([term, fragments]) => [term, fragments.map(passageOf).sort()]));
  assert.ok(!indexes.tag_terms.has("lyon") && !indexes.tag_terms.has("élodie"));
  assert.deepEqual(indexes.tagged_unit_ids, taggedQuotes.map(unitOf).sort());

  // One pair per tag and quote, with a content-free ID that is the same for the same input.
  assert.equal(indexes.pairs.length, 16);
  assert.deepEqual(Object.fromEntries(POINTER_TAG_KINDS.map((kind) => [kind, indexes.pairs.filter((pair) => pair.kind === kind).length])),
    { person: 9, place: 2, organization: 0, topic: 2, event: 3 });
  assert.equal(new Set(indexes.pairs.map((pair) => pair.pair_id)).size, indexes.pairs.length);
  for (const pair of indexes.pairs) {
    assert.match(pair.pair_id, /^pair:[0-9a-f]{32}$/u);
    assert.equal(pair.passage_id, passageIdForUnit(pair.unit_id));
  }
  assert.deepEqual(pointerTagIndexes({ batches: [{ units, kept, passageIdForUnit }] }).pairs, indexes.pairs);
  assert.ok(Object.isFrozen(indexes) && Object.isFrozen(indexes.pairs[0]) && Object.isFrozen(indexes.quote_tags.get(passageOf("Promenade"))));

  // A page whose answer gave it no tag, and one whose every tag was dropped. A page without a number is named by its
  // representation.
  assert.deepEqual(untaggedPages({ quotes, taggedUnitIds: indexes.tagged_unit_ids }), [4, 5]);
  const notes = { unit_id: "unit:notes", page: null, representation_id: "rep:notes", utf8_byte_length: 12 };
  assert.deepEqual(untaggedPages({ quotes: [...quotes, notes], taggedUnitIds: new Set(indexes.tagged_unit_ids) }), [4, 5, "rep:notes"]);
  assert.deepEqual(untaggedPages({ quotes: [...quotes, notes], taggedUnitIds: [...indexes.tagged_unit_ids, "unit:notes"] }), [4, 5]);
  assert.throws(() => untaggedPages({ quotes, taggedUnitIds: "unit:notes" }), { code: "POINTER_PAGES_INPUT_INVALID" });
  assert.throws(() => untaggedPages({ quotes: [notes, notes], taggedUnitIds: [] }), { code: "POINTER_PAGES_INPUT_INVALID" });

  // Both indexes are stored beside quote_meta with the pointer generation.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-tags-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createPrivateJournalCorpusStore({ rootDir: root, caseId: CASE, corpusId: CORPUS, corpusKey: randomBytes(32) });
  try {
    const persisted = await persistGraphGeneration({ corpusStore: store, graph: pointerGraph(journal).graph, sourceRepresentations: sources(),
      permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096,
      extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_tags: indexes.quote_tags, tag_terms: indexes.tag_terms } });
    assert.ok(persisted.manifest.indexes.quote_tags.length > 0 && persisted.manifest.indexes.tag_terms.length > 0);
  } finally {
    store.close();
  }
});

test("tags in different batches stay apart in the indexes, and each anchor must be in its own batch", () => {
  const passageIdForUnit = (unitId) => `passage:${unitId.slice("unit:".length)}`;
  const first = { units: [UNITS[0]], kept: [tag("person", "Jean", anchor("unit:a", "Jean est venu")), tag("topic", "vin", anchor("unit:a", "du vin"))],
    passageIdForUnit };
  const second = { units: [UNITS[2]], kept: [tag("person", "Jean", anchor("unit:c", "de Jean")), tag("topic", "vin", anchor("unit:c", "Jean à Lyon"))],
    passageIdForUnit };
  const indexes = pointerTagIndexes({ batches: [first, second] });
  assert.deepEqual(indexes.pairs.map(({ kind, label, passage_id: passageId }) => [kind, label, passageId]), [
    ["person", "Jean", "passage:a"], ["topic", "vin", "passage:a"], ["person", "Jean", "passage:c"], ["topic", "vin", "passage:c"]
  ]);
  assert.deepEqual([...indexes.tag_terms], [["vin", ["passage:a", "passage:c"]]]);
  assert.deepEqual(indexes.tagged_unit_ids, ["unit:a", "unit:c"]);
  assert.deepEqual(pointerTagIndexes({ batches: [] }), { quote_tags: new Map(), tag_terms: new Map(), tagged_unit_ids: [], pairs: [] });
  assert.throws(() => pointerTagIndexes({ batches: [{ ...first, units: [UNITS[2]] }] }), { code: "POINTER_INDEX_ANCHOR_OUTSIDE_BATCH" });
  assert.throws(() => pointerTagIndexes({ batches: [{ ...first, passageIdForUnit: () => undefined }] }), { code: "POINTER_INDEX_PASSAGE_INVALID" });
  assert.throws(() => pointerTagIndexes({ batches: [{ ...first, kept: [{ kind: "mood", label: "calme", anchors: [] }] }] }),
    { code: "POINTER_INDEX_INPUT_INVALID" });
  assert.throws(() => pointerTagIndexes({}), { code: "POINTER_INDEX_INPUT_INVALID" });
});
