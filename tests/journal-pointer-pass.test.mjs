import test from "node:test";
import assert from "node:assert/strict";
import { validateJournalGraph } from "../src/journal-import/contracts.mjs";
import { POINTER_BATCH_OUTCOMES, POINTER_EVENT_CHECK_PAIRS_PER_CALL, POINTER_UNTAGGED_REASONS, applyPointerEventCheck, buildPointerGeneration,
  checkPointerBatches, keepPointerPages, overlayPointerRepass, pointerCoverage, pointerEventCheckCalls, pointerEventPairs,
  pointerPassInput, pointerPassReport, pointerRepassBatches, pointerTaggerPacket } from "../src/journal-import/pointer-pass.mjs";
import { POINTER_DROP_REASONS } from "../src/journal-import/pointer-tags.mjs";
import { buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";

// The pointer pass between the tagger's answers and its generation (plan 2026-10-09-journal-quote-first.md, Part 3).
// All text here is invented.

const PAGE_COUNT = 40;
const pageText = (number) => {
  const second = number <= 3 ? "Nous avons dîné à Lyon."
    : number <= 6 ? "Le concert a eu lieu hier soir."
      : number === 7 ? "Je rêvais d'un concert sur la plage."
        : `Il a plu toute la journée ${number}.`;
  return `Jean est passé au marché ${number}.\n\n${second}`;
};
const PAGES = Array.from({ length: PAGE_COUNT }, (_, index) => ({ representation_id: `pass:page:${index + 1}`, text: pageText(index + 1),
  page_number: index + 1, parse_status: "readable" }));
const QUOTE_GENERATION = Object.freeze({ caseId: "pass-case", corpusId: "pass-corpus:quotes", generation: "pass-generation", originalObjectId: "original:pass",
  mediaType: "application/pdf", representations: PAGES, unitOptions: { minimumBytes: 0 } });
const BATCH_BYTES = 200;

function passInput() {
  return pointerPassInput({ built: buildQuoteGeneration(QUOTE_GENERATION), maxBytes: BATCH_BYTES });
}

// What a careful tagger would answer for a batch, by rule.
function taggerAnswer(packet) {
  const tags = [];
  for (const unit of packet.quote_units) {
    const anchor = (quote) => ({ unit_id: unit.unit_id, quote, occurrence: null });
    if (unit.text.includes("Jean")) tags.push({ kind: "person", label: "Jean", anchors: [anchor("Jean")] });
    if (unit.text.includes("marché")) tags.push({ kind: "topic", label: "marché", anchors: [anchor("marché")] });
    if (unit.text.includes("Lyon")) tags.push({ kind: "place", label: "Lyon", anchors: [anchor("Lyon")] });
    if (unit.text.includes("concert")) tags.push({ kind: "event", label: "concert", anchors: [anchor("concert")] });
    if (unit.text.includes("plu")) tags.push({ kind: "topic", label: "pluie", anchors: [anchor("plu")] });
  }
  return { schema_version: "1.0", tags };
}
const answered = (input) => new Map(input.batches.map((batch) => [batch.batch_id,
  { status: "answered", answer: taggerAnswer(pointerTaggerPacket({ batch, unitsById: input.unitsById })) }]));
const batchOfPage = (input, page) => input.batches.find((batch) => batch.pages.includes(page));
const unitOn = (input, page, fragment) => input.units.find((unit) => unit.page === page && unit.text.includes(fragment)).unit_id;

test("the pass reads every quote of the generation in journal order, in batches of whole pages, and packets hold only the quotes", () => {
  const input = passInput();
  assert.equal(input.units.length, PAGE_COUNT * 2);
  assert.deepEqual(input.units.map((unit) => unit.source_order), input.units.map((_, index) => index), "journal order");
  assert.deepEqual(input.quotes[0], { unit_id: input.units[0].unit_id, page: 1, representation_id: "pass:page:1",
    utf8_byte_length: input.units[0].utf8_byte_length });
  assert.ok(input.batches.length > 5, "several batches");
  assert.deepEqual(input.batches.flatMap((batch) => batch.unit_ids), input.units.map((unit) => unit.unit_id), "every quote once, in order");
  for (const batch of input.batches) assert.ok(batch.bytes <= BATCH_BYTES);
  const built = buildQuoteGeneration(QUOTE_GENERATION);
  for (const unit of input.units) assert.ok(built.quoteMeta.has(input.passageIdForUnit(unit.unit_id)), "the same passage IDs as a build with the same ID");
  assert.equal(input.passageIdForUnit("unit:none"), null);

  const packet = pointerTaggerPacket({ batch: input.batches[0], unitsById: input.unitsById });
  assert.deepEqual(Object.keys(packet), ["schema_version", "batch_id", "quote_units"]);
  assert.deepEqual(packet.quote_units, input.batches[0].unit_ids.map((unitId) => {
    const unit = input.unitsById.get(unitId);
    return { unit_id: unitId, page: unit.page, text: unit.text };
  }));
  assert.ok(Object.isFrozen(packet.quote_units[0]));
  assert.throws(() => pointerTaggerPacket({ batch: { batch_id: "b", unit_ids: ["unit:none"] }, unitsById: input.unitsById }), { code: "POINTER_PACKET_UNIT_MISSING" });
  assert.throws(() => pointerPassInput({ built: {} }), { code: "POINTER_PASS_INPUT_INVALID" });
});

test("each batch ends answered and checked, failed or out of time, and the pages it gave no tag are known", () => {
  const input = passInput();
  const outcomes = answered(input);
  const failed = batchOfPage(input, 10);
  const late = batchOfPage(input, 20);
  const empty = batchOfPage(input, 30);
  outcomes.set(failed.batch_id, { status: "failed" });
  outcomes.set(late.batch_id, { status: "deadline" });
  outcomes.set(empty.batch_id, { status: "answered", answer: { schema_version: "1.0", tags: [] } });
  const checked = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes });
  assert.equal(checked.length, input.batches.length);
  const resultOf = (batch) => checked.find((result) => result.batch_id === batch.batch_id);
  for (const [batch, status] of [[failed, "failed"], [late, "deadline"]]) {
    const result = resultOf(batch);
    assert.deepEqual(result.kept, []);
    assert.deepEqual(result.given_unit_ids, []);
    assert.deepEqual(Object.values(result.status_by_page), batch.pages.map(() => status));
    assert.deepEqual(result.dropped, Object.fromEntries(POINTER_DROP_REASONS.map((reason) => [reason, 0])));
  }
  assert.deepEqual(resultOf(empty).kept, []);
  assert.deepEqual(resultOf(empty).given_unit_ids, []);
  const first = resultOf(input.batches[0]);
  assert.ok(first.kept.length > 0);
  assert.deepEqual(first.given_unit_ids, input.batches[0].unit_ids, "every quote of the first batch was given a tag");
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.kept[0].anchors));

  // An answer that isn't the expected shape keeps nothing; one whose tags are all dropped still gave its quotes tags.
  const odd = new Map(outcomes);
  odd.set(input.batches[0].batch_id, { status: "answered", answer: { tags: "none" } });
  odd.set(input.batches[1].batch_id, { status: "answered", answer: { schema_version: "1.0", tags: [{ kind: "person", label: "Marie",
    anchors: [{ unit_id: input.batches[1].unit_ids[0], quote: "Jean", occurrence: null }] }] } });
  const oddChecked = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes: odd });
  assert.equal(oddChecked[0].dropped.answer_invalid, 1);
  assert.deepEqual(oddChecked[0].given_unit_ids, []);
  assert.deepEqual(oddChecked[1].kept, []);
  assert.equal(oddChecked[1].dropped.anchor_lacks_name, 1);
  assert.deepEqual(oddChecked[1].given_unit_ids, [input.batches[1].unit_ids[0]]);

  const missing = new Map(outcomes);
  missing.delete(input.batches[2].batch_id);
  assert.throws(() => checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes: missing }), { code: "POINTER_BATCH_OUTCOME_MISSING" });
  missing.set(input.batches[2].batch_id, { status: "late" });
  assert.throws(() => checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes: missing }), { code: "POINTER_BATCH_OUTCOME_MISSING" });
  assert.deepEqual(POINTER_BATCH_OUTCOMES, ["answered", "failed", "deadline"]);
});

test("the event check sees each event pair whole, 50 to a call, and keeps a pair only when it accepts it", () => {
  const input = passInput();
  const checked = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes: answered(input) });
  const pairs = pointerEventPairs({ checked, unitsById: input.unitsById });
  // Pages 4 to 6 report a concert; page 7 only dreams of one, which the tagger above wrongly tagged as an event.
  assert.deepEqual(pairs.map((pair) => input.unitsById.get(pair.unit_id).page), [4, 5, 6, 7]);
  for (const pair of pairs) {
    assert.match(pair.pair_id, /^event-pair:[0-9a-f]{32}$/u);
    assert.equal(pair.quote, input.unitsById.get(pair.unit_id).text, "the whole quote");
    assert.equal(pair.label, "concert");
  }
  assert.equal(new Set(pairs.map((pair) => pair.pair_id)).size, pairs.length);
  assert.deepEqual(pointerEventPairs({ checked, unitsById: input.unitsById }), pairs, "the same every time");

  const many = Array.from({ length: 2 * POINTER_EVENT_CHECK_PAIRS_PER_CALL + 1 }, (_, index) => ({ ...pairs[0], pair_id: `event-pair:${index}` }));
  const calls = pointerEventCheckCalls(many);
  assert.deepEqual(calls.map((call) => call.packet.pairs.length), [50, 50, 1]);
  assert.deepEqual(Object.keys(calls[0].packet.pairs[0]), ["pair_id", "kind", "label", "quote"], "only what the judge sees");
  assert.match(calls[0].call_id, /^event-check:[0-9a-f]{32}$/u);
  assert.notEqual(calls[0].call_id, calls[1].call_id);
  assert.deepEqual(pointerEventCheckCalls([]), []);

  // Page 4 accepted, page 5 rejected for its kind, page 6 unanswered, page 7 rejected: not something that happened.
  const judgments = new Map([
    [pairs[0].pair_id, { mentions: true, kind_right: true }],
    [pairs[1].pair_id, { mentions: true, kind_right: false }],
    [pairs[3].pair_id, { mentions: false, kind_right: false }]
  ]);
  const { checked: after, counts, dropped } = applyPointerEventCheck({ checked, pairs, judgments });
  assert.deepEqual(counts, { pairs: 4, accepted: 1, rejected: 2, unanswered: 1, tags_dropped: 3 });
  // The pairs it dropped, rejected or unanswered, are what event-check recall samples.
  assert.deepEqual(dropped.map((pair) => pair.pair_id), [pairs[1], pairs[2], pairs[3]].map((pair) => pair.pair_id));
  assert.ok(Object.isFrozen(dropped));
  const events = after.flatMap((result) => result.kept.filter((tag) => tag.kind === "event"));
  assert.deepEqual(events.map((tag) => tag.anchors.map((anchor) => input.unitsById.get(anchor.unit_id).page)), [[4]]);
  // Nothing else changes.
  const others = (results) => results.flatMap((result) => result.kept.filter((tag) => tag.kind !== "event"));
  assert.deepEqual(others(after), others(checked));
  assert.ok(Object.isFrozen(after[0]));

  // A tag with anchors in two quotes keeps the one its check accepted.
  const wide = checked.map((result, index) => (index === 0 ? { ...result, kept: [...result.kept, { kind: "event", label: "marché",
    anchors: result.unit_ids.slice(0, 2).map((unitId) => ({ unit_id: unitId, quote: input.unitsById.get(unitId).text.slice(0, 4), occurrence: null })) }] } : result));
  const widePairs = pointerEventPairs({ checked: wide, unitsById: input.unitsById }).filter((pair) => pair.label === "marché");
  assert.equal(widePairs.length, 2);
  const kept = applyPointerEventCheck({ checked: wide, pairs: widePairs, judgments: new Map([[widePairs[1].pair_id, { mentions: true, kind_right: true }]]) });
  assert.deepEqual(kept.checked[0].kept.at(-1).anchors.map((anchor) => anchor.unit_id), [wide[0].unit_ids[1]]);
  assert.equal(kept.counts.tags_dropped, 0);
});

test("every kind is kept whatever its count: no kind is left out for being small", () => {
  const input = passInput();
  const checked = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes: answered(input) });
  const { built, indexes } = buildPointerGeneration({ quoteGeneration: QUOTE_GENERATION, input, checked });
  // 40 Jean and 40 marché pairs, 33 pluie (topic, so 73 topic pairs), 3 Lyon, 4 concert: the 3 places stay.
  const counts = Object.fromEntries(["person", "place", "organization", "topic", "event"]
    .map((kind) => [kind, indexes.pairs.filter((pair) => pair.kind === kind).length]));
  assert.deepEqual(counts, { person: 40, place: 3, organization: 0, topic: 73, event: 4 });
  assert.equal(built.graph.nodes.filter((node) => node.kind === "entity" && node.data.entity_kind === "place").length, 3);
  const report = pointerPassReport({ checked, eventCheck: { pairs: 0, accepted: 0, rejected: 0, unanswered: 0, tags_dropped: 0 }, indexes,
    coverage: pointerCoverage({ input, checked, indexes }) });
  assert.deepEqual(report.pairs_by_kind, counts);
  assert.equal(Object.hasOwn(report, "kinds_left_out"), false);
});

test("the generation is built again under the same ID with each page's tags, and its untagged pages are listed with why", () => {
  const input = passInput();
  const outcomes = answered(input);
  const failed = batchOfPage(input, 10);
  const late = batchOfPage(input, 20);
  const empty = batchOfPage(input, 30);
  outcomes.set(failed.batch_id, { status: "failed" });
  outcomes.set(late.batch_id, { status: "deadline" });
  outcomes.set(empty.batch_id, { status: "answered", answer: { schema_version: "1.0", tags: [] } });
  // On page 35 every tag is dropped: the answer names someone the quotes don't.
  const dropping = batchOfPage(input, 35);
  const packet = pointerTaggerPacket({ batch: dropping, unitsById: input.unitsById });
  outcomes.set(dropping.batch_id, { status: "answered", answer: { schema_version: "1.0", tags: [
    ...taggerAnswer({ quote_units: packet.quote_units.filter((unit) => input.unitsById.get(unit.unit_id).page !== 35) }).tags,
    { kind: "person", label: "Marie", anchors: [{ unit_id: unitOn(input, 35, "Jean"), quote: "Jean", occurrence: null }] }
  ] } });
  const checked = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes });
  const { built, indexes } = buildPointerGeneration({ quoteGeneration: QUOTE_GENERATION, input, checked });
  validateJournalGraph(built.graph, Object.fromEntries(PAGES.map((page) => [page.representation_id, page.text])));
  const plain = buildQuoteGeneration(QUOTE_GENERATION);
  const passages = (graph) => graph.nodes.filter((node) => node.kind === "passage");
  assert.deepEqual(passages(built.graph), passages(plain.graph), "the same passages, under the same IDs");
  assert.deepEqual(built.quoteMeta, plain.quoteMeta);
  const people = built.graph.nodes.filter((node) => node.kind === "entity" && node.data.label === "Jean");
  assert.equal(people.length, indexes.pairs.filter((pair) => pair.kind === "person").length, "one node per tag and quote");
  for (const node of people) assert.ok(input.units.some((unit) => node.data.evidence_ids[0] === input.passageIdForUnit(unit.unit_id)));
  assert.equal(built.graph.nodes.filter((node) => node.kind === "episode").length, indexes.pairs.filter((pair) => pair.kind === "event").length,
    "one episode per event pair: no kind is left out");
  assert.deepEqual([...indexes.quote_tags.keys()].every((passageId) => built.quoteMeta.has(passageId)), true);

  const coverage = pointerCoverage({ input, checked, indexes });
  const pagesOf = (batch) => [...batch.pages];
  const expected = [
    ...pagesOf(failed).map((page) => ({ page, reason: "batch_failed" })),
    ...pagesOf(late).map((page) => ({ page, reason: "deadline" })),
    ...pagesOf(empty).map((page) => ({ page, reason: "answer_gave_none" })),
    { page: 35, reason: "tags_dropped" }
  ].sort((left, right) => left.page - right.page);
  assert.deepEqual(coverage.untagged, expected);
  assert.equal(coverage.pages_with_quotes, PAGE_COUNT);
  assert.equal(coverage.untagged_share, expected.length / PAGE_COUNT);
  assert.equal(coverage.holds, false, "more than 2% of the pages untagged");
  assert.deepEqual(Object.keys(coverage.untagged_by_reason), POINTER_UNTAGGED_REASONS);
  assert.equal(coverage.untagged_by_reason.tags_dropped, 1);

  // Every batch answered: coverage holds. No tag at all: it fails, however few pages there are.
  const full = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes: answered(input) });
  const fullBuild = buildPointerGeneration({ quoteGeneration: QUOTE_GENERATION, input, checked: full });
  assert.equal(pointerCoverage({ input, checked: full, indexes: fullBuild.indexes }).holds, true);
  const none = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById,
    outcomes: new Map(input.batches.map((batch) => [batch.batch_id, { status: "answered", answer: { schema_version: "1.0", tags: [] } }])) });
  const noneBuild = buildPointerGeneration({ quoteGeneration: QUOTE_GENERATION, input, checked: none });
  const noTags = pointerCoverage({ input, checked: none, indexes: noneBuild.indexes });
  assert.equal(noTags.holds, false);
  assert.equal(noTags.tag_pairs, 0);

  // A report of counts and page numbers, without a word of the journal.
  const report = pointerPassReport({ checked, eventCheck: { pairs: 0, accepted: 0, rejected: 0, unanswered: 0, tags_dropped: 0 },
    indexes, coverage });
  assert.equal(report.batches, input.batches.length);
  assert.equal(report.page_outcomes.failed, failed.pages.length);
  assert.equal(report.page_outcomes.deadline, late.pages.length);
  assert.equal(report.page_outcomes.answered, PAGE_COUNT - failed.pages.length - late.pages.length);
  assert.equal(report.tags_dropped.anchor_lacks_name, 1);
  const text = JSON.stringify(report);
  for (const word of ["Jean", "marché", "Lyon", "concert", "pluie", "Marie"]) assert.ok(!text.includes(word), word);

  assert.throws(() => buildPointerGeneration({ quoteGeneration: { ...QUOTE_GENERATION, generation: "other" }, input, checked }),
    { code: "POINTER_BUILD_GENERATION_MISMATCH" });
  assert.throws(() => buildPointerGeneration({ quoteGeneration: { ...QUOTE_GENERATION, representations: PAGES.slice(1) }, input, checked }),
    { code: "POINTER_BUILD_QUOTES_CHANGED" });
});

test("a coverage pass sends the untagged pages' batches again and changes only those pages' tags", () => {
  const input = passInput();
  const outcomes = answered(input);
  const failed = batchOfPage(input, 10);
  outcomes.set(failed.batch_id, { status: "failed" });
  // A batch whose answer left one of its pages without a tag.
  const partial = batchOfPage(input, 25);
  const partialPacket = pointerTaggerPacket({ batch: partial, unitsById: input.unitsById });
  const skipped = partial.pages.at(-1);
  outcomes.set(partial.batch_id, { status: "answered", answer: taggerAnswer({ quote_units: partialPacket.quote_units
    .filter((unit) => input.unitsById.get(unit.unit_id).page !== skipped) }) });
  const first = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes });
  const firstBuild = buildPointerGeneration({ quoteGeneration: QUOTE_GENERATION, input, checked: first });
  const firstCoverage = pointerCoverage({ input, checked: first, indexes: firstBuild.indexes });
  const retried = firstCoverage.untagged.map((item) => item.page);
  assert.deepEqual(retried, [...failed.pages, skipped].sort((left, right) => left - right));

  const again = pointerRepassBatches({ batches: input.batches, unitsById: input.unitsById, pages: retried });
  assert.deepEqual(again.map((batch) => batch.batch_id), [failed.batch_id, partial.batch_id].sort((left, right) =>
    input.batches.findIndex((batch) => batch.batch_id === left) - input.batches.findIndex((batch) => batch.batch_id === right)), "whole batches, as they were");
  // The coverage pass answers both batches in full, with a tag spanning a retried page and one that isn't.
  const secondOutcomes = new Map(again.map((batch) => {
    const answer = taggerAnswer(pointerTaggerPacket({ batch, unitsById: input.unitsById }));
    if (batch.batch_id === partial.batch_id) {
      answer.tags.push({ kind: "topic", label: "journée", anchors: batch.unit_ids.filter((unitId) => input.unitsById.get(unitId).text.includes("journée"))
        .map((unitId) => ({ unit_id: unitId, quote: "journée", occurrence: null })) });
    }
    return [batch.batch_id, { status: "answered", answer }];
  }));
  const second = keepPointerPages({ checked: checkPointerBatches({ batches: again, unitsById: input.unitsById, outcomes: secondOutcomes }),
    unitsById: input.unitsById, pages: retried });
  for (const result of second) {
    for (const tag of result.kept) for (const anchor of tag.anchors) assert.ok(retried.includes(input.unitsById.get(anchor.unit_id).page));
  }
  const overlay = overlayPointerRepass({ first, second, unitsById: input.unitsById, pages: retried });
  const final = { checked: overlay };

  // Every tag the first pass kept stays exactly, on every page it didn't retry.
  const anchorsOff = (results) => results.flatMap((result) => result.kept.flatMap((tag) => tag.anchors
    .filter((anchor) => !retried.includes(input.unitsById.get(anchor.unit_id).page)).map((anchor) => JSON.stringify([tag.kind, tag.label, anchor])))).sort();
  assert.deepEqual(anchorsOff(final.checked), anchorsOff(first));
  const untouched = final.checked.filter((result) => !again.some((batch) => batch.batch_id === result.batch_id));
  assert.deepEqual(untouched, first.filter((result) => !again.some((batch) => batch.batch_id === result.batch_id)), "other batches are the same objects' data");
  // The spanning tag keeps only its anchor on the retried page.
  const journee = final.checked.flatMap((result) => result.kept).filter((tag) => tag.label === "journée");
  assert.equal(journee.length, 1);
  assert.deepEqual(journee[0].anchors.map((anchor) => input.unitsById.get(anchor.unit_id).page), [skipped]);
  // The retried pages now end as the coverage pass ended them.
  const failedResult = final.checked.find((result) => result.batch_id === failed.batch_id);
  assert.deepEqual(Object.values(failedResult.status_by_page), failed.pages.map(() => "answered"));
  const build = buildPointerGeneration({ quoteGeneration: QUOTE_GENERATION, input, checked: final.checked });
  const coverage = pointerCoverage({ input, checked: final.checked, indexes: build.indexes });
  assert.deepEqual(coverage.untagged, []);
  assert.equal(coverage.holds, true);

  assert.throws(() => overlayPointerRepass({ first, second: [{ ...second[0], batch_id: "pointer-batch:none" }], unitsById: input.unitsById, pages: retried }),
    { code: "POINTER_REPASS_BATCH_UNKNOWN" });
});

test("a page cut across batches ends as the worst of them", () => {
  const long = { representation_id: "pass:page:long", page_number: 1, parse_status: "readable",
    text: Array.from({ length: 12 }, (_, index) => `Paragraphe ${index} sur la longue marche de Jean au bord du lac.`).join("\n\n") };
  const generation = { ...QUOTE_GENERATION, representations: [long] };
  const input = pointerPassInput({ built: buildQuoteGeneration(generation), maxBytes: BATCH_BYTES });
  assert.ok(input.batches.length >= 2 && input.batches.every((batch) => batch.pages.length === 1 && batch.pages[0] === 1));
  const outcomes = new Map(input.batches.map((batch, index) => [batch.batch_id, index === 0 ? { status: "failed" }
    : { status: "answered", answer: { schema_version: "1.0", tags: [] } }]));
  const checked = checkPointerBatches({ batches: input.batches, unitsById: input.unitsById, outcomes });
  const { indexes } = buildPointerGeneration({ quoteGeneration: generation, input, checked });
  assert.deepEqual(pointerCoverage({ input, checked, indexes }).untagged, [{ page: 1, reason: "batch_failed" }]);
});
