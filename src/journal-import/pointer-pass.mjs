import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { POINTER_FLOORS } from "./pointer-measure.mjs";
import { POINTER_DROP_REASONS, POINTER_TAG_KINDS, batchPointerQuotes, checkPointerTags, pointerExtraction, pointerTagIndexes,
  untaggedPages } from "./pointer-tags.mjs";
import { buildQuoteGeneration } from "./quote-index.mjs";

// The pointer pass's steps between the tagger's answers and the generation it builds (plan
// 2026-10-09-journal-quote-first.md, Part 3): each batch's answer checked by code, the event check, a coverage pass
// laid over the first, and the generation built with its tag indexes and its untagged pages. Everything here is
// mechanical; the model calls are the runtime's. Nothing returned for a log or a report holds journal text: reports
// are counts and page numbers.

/** How a batch ended: answered (its answer then checked by code), failed after its retry, or out of time. */
export const POINTER_BATCH_OUTCOMES = Object.freeze(["answered", "failed", "deadline"]);
/** Why a page ends with no kept tag. */
export const POINTER_UNTAGGED_REASONS = Object.freeze(["batch_failed", "deadline", "answer_gave_none", "tags_dropped"]);
/** Event pairs to an event-check call, as for the measurement's judges. */
export const POINTER_EVENT_CHECK_PAIRS_PER_CALL = 50;

const BATCH_REASON = Object.freeze({ failed: "batch_failed", deadline: "deadline" });

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = (parts) => createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 32);
const zeroDrops = () => Object.fromEntries(POINTER_DROP_REASONS.map((reason) => [reason, 0]));

// Freezes plain data all the way down.
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// A quote's page: its page number, or its representation when it has none (as pointer-tags reads pages).
const pageOf = (unit) => (unit.page === null ? unit.representation_id : unit.page);

/**
 * The pass's input from the quote generation it tags (`buildQuoteGeneration`'s result): every quote with a passage,
 * in journal order, its batches, and how to find a quote's unit and passage. The generation the pass builds later
 * must have the same ID, so these passage IDs are the ones it builds.
 */
export function pointerPassInput({ built, maxBytes } = {}) {
  invariant(isObject(built) && Array.isArray(built.units) && isObject(built.graph) && Array.isArray(built.graph.nodes), "POINTER_PASS_INPUT_INVALID");
  const passageByUnit = new Map(built.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.data.unit_id, node.id]));
  const units = built.units.filter((unit) => passageByUnit.has(unit.unit_id));
  const quotes = units.map((unit) => ({ unit_id: unit.unit_id, page: unit.page ?? null, representation_id: unit.representation_id,
    utf8_byte_length: unit.utf8_byte_length }));
  const batches = batchPointerQuotes({ quotes, ...(maxBytes === undefined ? {} : { maxBytes }) });
  const unitsById = new Map(units.map((unit) => [unit.unit_id, unit]));
  return Object.freeze({
    generation: built.graph.generation,
    units: Object.freeze(units),
    quotes: Object.freeze(quotes.map(Object.freeze)),
    batches,
    unitsById,
    passageIdForUnit: (unitId) => passageByUnit.get(unitId) ?? null
  });
}

/** The tagger's packet for a batch: its quotes in journal order, each with its unit, page and exact text. */
export function pointerTaggerPacket({ batch, unitsById } = {}) {
  invariant(isObject(batch) && Array.isArray(batch.unit_ids) && unitsById instanceof Map, "POINTER_PACKET_INPUT_INVALID");
  return deepFreeze({
    schema_version: "1.0",
    batch_id: batch.batch_id,
    quote_units: batch.unit_ids.map((unitId) => {
      const unit = unitsById.get(unitId);
      invariant(unit, "POINTER_PACKET_UNIT_MISSING");
      return { unit_id: unit.unit_id, page: unit.page ?? null, text: unit.text };
    })
  });
}

// The units of a batch, in its order.
const batchUnits = (batch, unitsById) => batch.unit_ids.map((unitId) => {
  const unit = unitsById.get(unitId);
  invariant(unit, "POINTER_BATCH_UNIT_MISSING");
  return unit;
});

// The quotes of the batch the answer's anchors name, whatever happens to the anchors later: what the answer gave.
function givenUnits(batch, answer) {
  const inBatch = new Set(batch.unit_ids);
  const given = new Set();
  if (isObject(answer) && Array.isArray(answer.tags)) {
    for (const tag of answer.tags) {
      if (!isObject(tag) || !Array.isArray(tag.anchors)) continue;
      for (const anchor of tag.anchors) if (isObject(anchor) && inBatch.has(anchor.unit_id)) given.add(anchor.unit_id);
    }
  }
  return batch.unit_ids.filter((unitId) => given.has(unitId));
}

/**
 * Each batch's result: its answer checked by code (`checkPointerTags`), or how it ended without one. `outcomes` maps
 * every batch ID to `{ status: "answered", answer }`, `{ status: "failed" }` or `{ status: "deadline" }`; an answer
 * stored after the deadline must already be the last of these. Each result keeps the batch's quotes, its kept tags,
 * its drops by reason, the quotes its answer gave any tag to, and how each of its pages ended (`status_by_page`).
 */
export function checkPointerBatches({ batches, unitsById, outcomes } = {}) {
  invariant(Array.isArray(batches) && unitsById instanceof Map && outcomes instanceof Map, "POINTER_CHECK_INPUT_INVALID");
  return Object.freeze(batches.map((batch) => {
    const outcome = outcomes.get(batch.batch_id);
    invariant(isObject(outcome) && POINTER_BATCH_OUTCOMES.includes(outcome.status), "POINTER_BATCH_OUTCOME_MISSING");
    const units = batchUnits(batch, unitsById);
    const statusByPage = Object.fromEntries(units.map((unit) => [String(pageOf(unit)), outcome.status]));
    if (outcome.status !== "answered") {
      return deepFreeze({ batch_id: batch.batch_id, unit_ids: [...batch.unit_ids], kept: [], dropped: zeroDrops(), given_unit_ids: [],
        status_by_page: statusByPage });
    }
    const { kept, dropped } = checkPointerTags({ units, answer: outcome.answer });
    return deepFreeze({ batch_id: batch.batch_id, unit_ids: [...batch.unit_ids], kept: structuredClone(kept), dropped: { ...dropped },
      given_unit_ids: givenUnits(batch, outcome.answer), status_by_page: statusByPage });
  }));
}

/**
 * The event check's pairs: one for each kept event tag and quote it has an anchor in, with a content-free ID, the
 * tag's label and the exact quote. A pair is the whole quote, as the measurement judges it.
 */
export function pointerEventPairs({ checked, unitsById } = {}) {
  invariant(Array.isArray(checked) && unitsById instanceof Map, "POINTER_EVENT_INPUT_INVALID");
  const pairs = [];
  for (const result of checked) {
    result.kept.forEach((tag, tagIndex) => {
      if (tag.kind !== "event") return;
      for (const unitId of [...new Set(tag.anchors.map((anchor) => anchor.unit_id))]) {
        const unit = unitsById.get(unitId);
        invariant(unit, "POINTER_EVENT_UNIT_MISSING");
        pairs.push(Object.freeze({ pair_id: `event-pair:${digest([result.batch_id, tagIndex, unitId])}`, batch_id: result.batch_id,
          tag_index: tagIndex, unit_id: unitId, kind: "event", label: tag.label, quote: unit.text }));
      }
    });
  }
  return Object.freeze(pairs);
}

/**
 * The event check's calls: the pairs in order, `POINTER_EVENT_CHECK_PAIRS_PER_CALL` to a call, each call's packet
 * holding only what the judge sees (the pair's ID, kind, label and quote) and a call ID that is a digest of its pairs.
 */
export function pointerEventCheckCalls(pairs, perCall = POINTER_EVENT_CHECK_PAIRS_PER_CALL) {
  invariant(Array.isArray(pairs) && Number.isSafeInteger(perCall) && perCall > 0, "POINTER_EVENT_INPUT_INVALID");
  const calls = [];
  for (let start = 0; start < pairs.length; start += perCall) {
    const slice = pairs.slice(start, start + perCall);
    calls.push(deepFreeze({
      call_id: `event-check:${digest(slice.map((pair) => pair.pair_id))}`,
      packet: { schema_version: "1.0", pairs: slice.map((pair) => ({ pair_id: pair.pair_id, kind: pair.kind, label: pair.label, quote: pair.quote })) }
    }));
  }
  return Object.freeze(calls);
}

/**
 * Applies the event check. An event tag keeps its anchors in a quote only when the check accepted that pair: the
 * quote mentions what the label names (`mentions`) and reports it as happening (`kind_right`). A pair it rejected or
 * left unanswered (no judgment in `judgments`, a map from pair ID) loses those anchors, and a tag left with none is
 * dropped. Returns the new results, the counts (the event-check floor reads `pairs` and `unanswered`) and the pairs it
 * dropped, rejected or unanswered, which event-check recall samples.
 */
export function applyPointerEventCheck({ checked, pairs, judgments } = {}) {
  invariant(Array.isArray(checked) && Array.isArray(pairs) && judgments instanceof Map, "POINTER_EVENT_INPUT_INVALID");
  const counts = { pairs: pairs.length, accepted: 0, rejected: 0, unanswered: 0, tags_dropped: 0 };
  const dropped = [];
  // The quotes each event tag loses, by batch and tag.
  const losing = new Map();
  for (const pair of pairs) {
    const judgment = judgments.get(pair.pair_id);
    if (!isObject(judgment)) counts.unanswered += 1;
    else if (judgment.mentions === true && judgment.kind_right === true) { counts.accepted += 1; continue; }
    else counts.rejected += 1;
    dropped.push(pair);
    const key = `${pair.batch_id}\0${pair.tag_index}`;
    if (!losing.has(key)) losing.set(key, new Set());
    losing.get(key).add(pair.unit_id);
  }
  const results = checked.map((result) => {
    const kept = [];
    result.kept.forEach((tag, tagIndex) => {
      const lost = losing.get(`${result.batch_id}\0${tagIndex}`);
      if (tag.kind !== "event" || !lost) { kept.push(tag); return; }
      const anchors = tag.anchors.filter((anchor) => !lost.has(anchor.unit_id));
      if (anchors.length) kept.push({ ...tag, anchors });
      else counts.tags_dropped += 1;
    });
    return deepFreeze({ ...structuredClone(result), kept: structuredClone(kept) });
  });
  return Object.freeze({ checked: Object.freeze(results), counts: Object.freeze(counts), dropped: Object.freeze(dropped) });
}

// The tag indexes of checked results.
const indexesOf = (checked, unitsById, passageIdForUnit) => pointerTagIndexes({
  batches: checked.map((result) => ({ units: result.unit_ids.map((unitId) => unitsById.get(unitId)), kept: result.kept, passageIdForUnit }))
});

const pairsByKind = (pairs) => Object.fromEntries(POINTER_TAG_KINDS.map((kind) => [kind, pairs.filter((pair) => pair.kind === kind).length]));

/**
 * The batches a coverage pass sends again: every batch with a page in `pages`, the untagged pages, whole and as they
 * were, so the tagger sees the same quotes.
 */
export function pointerRepassBatches({ batches, unitsById, pages } = {}) {
  invariant(Array.isArray(batches) && unitsById instanceof Map && Array.isArray(pages), "POINTER_REPASS_INPUT_INVALID");
  const wanted = new Set(pages.map(String));
  return Object.freeze(batches.filter((batch) => batchUnits(batch, unitsById).some((unit) => wanted.has(String(pageOf(unit))))));
}

/**
 * Results with each tag reduced to its anchors on `pages`, and a tag with none there dropped: a coverage pass's
 * results before its event check, so only the pairs it can add are checked.
 */
export function keepPointerPages({ checked, unitsById, pages } = {}) {
  invariant(Array.isArray(checked) && unitsById instanceof Map && Array.isArray(pages), "POINTER_REPASS_INPUT_INVALID");
  const wanted = new Set(pages.map(String));
  const onPages = (unitId) => {
    const unit = unitsById.get(unitId);
    invariant(unit, "POINTER_REPASS_UNIT_MISSING");
    return wanted.has(String(pageOf(unit)));
  };
  return Object.freeze(checked.map((result) => deepFreeze({ ...structuredClone(result),
    kept: result.kept.flatMap((tag) => {
      const anchors = tag.anchors.filter((anchor) => onPages(anchor.unit_id));
      return anchors.length ? [{ ...structuredClone(tag), anchors: structuredClone(anchors) }] : [];
    }) })));
}

/**
 * A coverage pass laid over the first pass: on the retried pages (`pages`), the coverage pass's results, and
 * everywhere else the first pass's, exactly. A batch both passes have keeps the first pass's tags anchored outside the
 * retried pages and takes the coverage pass's anchored on them; a tag with anchors on both sides keeps only its
 * anchors on its side (identity never crosses a quote, so nothing is lost). Each page ends with the outcome of the
 * pass its tags come from. Both inputs are checked results, the first as built (after its event check), the second
 * after its own event check.
 */
export function overlayPointerRepass({ first, second, unitsById, pages } = {}) {
  invariant(Array.isArray(first) && Array.isArray(second) && unitsById instanceof Map && Array.isArray(pages), "POINTER_REPASS_INPUT_INVALID");
  const retried = new Set(pages.map(String));
  const onRetried = (unitId) => {
    const unit = unitsById.get(unitId);
    invariant(unit, "POINTER_REPASS_UNIT_MISSING");
    return retried.has(String(pageOf(unit)));
  };
  // A tag reduced to its anchors on one side, or nothing.
  const side = (tags, wantRetried) => tags.flatMap((tag) => {
    const anchors = tag.anchors.filter((anchor) => onRetried(anchor.unit_id) === wantRetried);
    return anchors.length ? [{ ...tag, anchors }] : [];
  });
  const again = new Map(second.map((result) => [result.batch_id, result]));
  for (const result of second) invariant(first.some((candidate) => candidate.batch_id === result.batch_id), "POINTER_REPASS_BATCH_UNKNOWN");
  return Object.freeze(first.map((result) => {
    const coverage = again.get(result.batch_id);
    if (!coverage) return result;
    const statusByPage = Object.fromEntries(Object.entries(result.status_by_page)
      .map(([page, status]) => [page, retried.has(page) ? coverage.status_by_page[page] : status]));
    return deepFreeze({
      batch_id: result.batch_id,
      unit_ids: [...result.unit_ids],
      kept: structuredClone([...side(result.kept, false), ...side(coverage.kept, true)]),
      dropped: Object.fromEntries(POINTER_DROP_REASONS.map((reason) => [reason, result.dropped[reason] + coverage.dropped[reason]])),
      given_unit_ids: [...result.given_unit_ids.filter((unitId) => !onRetried(unitId)), ...coverage.given_unit_ids.filter(onRetried)]
        .sort((left, right) => result.unit_ids.indexOf(left) - result.unit_ids.indexOf(right)),
      status_by_page: statusByPage
    });
  }));
}

/**
 * Builds the pointer generation: the quote generation again, from the same input and with the same ID, so the
 * passage IDs the tags are indexed under are the ones built, each page taking its pointer extraction; and the two tag
 * indexes. `quoteGeneration` is buildQuoteGeneration's input for the generation the pass read.
 */
export function buildPointerGeneration({ quoteGeneration, input, checked } = {}) {
  invariant(isObject(quoteGeneration) && isObject(input) && Array.isArray(checked), "POINTER_BUILD_INPUT_INVALID");
  invariant(quoteGeneration.generation === input.generation, "POINTER_BUILD_GENERATION_MISMATCH");
  const kept = checked.flatMap((result) => result.kept);
  const built = buildQuoteGeneration({ ...quoteGeneration,
    extractionFor: ({ units, quoteMeta, passageIdForUnit }) => pointerExtraction({ units, kept, quoteMeta, passageIdForUnit }) });
  // The quotes the tags name are the quotes built, under the same passages.
  invariant(built.units.length === input.units.length && built.units.every((unit, index) => unit.unit_id === input.units[index].unit_id
    && built.quoteMeta.has(input.passageIdForUnit(unit.unit_id))), "POINTER_BUILD_QUOTES_CHANGED");
  const indexes = indexesOf(checked, input.unitsById, input.passageIdForUnit);
  return Object.freeze({ built, indexes });
}

/**
 * The pages with quotes that end with no kept tag, each with why: its batch failed or ran out of time, its answer
 * gave it no tag, or every tag it was given was dropped (by a check, the event check or its kind being left out).
 * `holds` is the coverage floor: at most `POINTER_FLOORS.max_untagged_share` of the pages untagged, and some tag kept.
 */
export function pointerCoverage({ input, checked, indexes } = {}) {
  invariant(isObject(input) && Array.isArray(checked) && isObject(indexes), "POINTER_COVERAGE_INPUT_INVALID");
  const pages = untaggedPages({ quotes: input.quotes, taggedUnitIds: indexes.tagged_unit_ids });
  // A page cut across batches ends as the worst of them: failed, then out of time, then answered.
  const rank = { answered: 0, deadline: 1, failed: 2 };
  const statusByPage = new Map();
  const givenPages = new Set();
  for (const result of checked) {
    for (const [page, status] of Object.entries(result.status_by_page)) {
      if (!statusByPage.has(page) || rank[status] > rank[statusByPage.get(page)]) statusByPage.set(page, status);
    }
    for (const unitId of result.given_unit_ids) givenPages.add(String(pageOf(input.unitsById.get(unitId))));
  }
  const untagged = pages.map((page) => {
    const status = statusByPage.get(String(page));
    invariant(POINTER_BATCH_OUTCOMES.includes(status), "POINTER_COVERAGE_PAGE_UNKNOWN");
    const reason = BATCH_REASON[status] ?? (givenPages.has(String(page)) ? "tags_dropped" : "answer_gave_none");
    return Object.freeze({ page, reason });
  });
  const pagesWithQuotes = new Set(input.quotes.map((quote) => String(pageOf(quote)))).size;
  const share = pagesWithQuotes ? untagged.length / pagesWithQuotes : 0;
  const reasons = Object.fromEntries(POINTER_UNTAGGED_REASONS.map((reason) => [reason, untagged.filter((item) => item.reason === reason).length]));
  return deepFreeze({
    pages_with_quotes: pagesWithQuotes,
    untagged: untagged.map((item) => ({ ...item })),
    untagged_by_reason: reasons,
    untagged_share: share,
    tag_pairs: indexes.pairs.length,
    holds: indexes.pairs.length > 0 && share <= POINTER_FLOORS.max_untagged_share
  });
}

/**
 * What a pass did, in counts and page numbers only: batches, pages by how their batch ended, tags kept and dropped by
 * reason, pairs by kind, the event check and the untagged pages.
 */
export function pointerPassReport({ checked, eventCheck, indexes, coverage } = {}) {
  invariant(Array.isArray(checked) && isObject(eventCheck) && isObject(indexes) && isObject(coverage), "POINTER_REPORT_INPUT_INVALID");
  const pageOutcomes = Object.fromEntries(POINTER_BATCH_OUTCOMES.map((outcome) => [outcome, 0]));
  for (const result of checked) for (const status of Object.values(result.status_by_page)) pageOutcomes[status] += 1;
  const dropped = zeroDrops();
  for (const result of checked) for (const reason of POINTER_DROP_REASONS) dropped[reason] += result.dropped[reason];
  return deepFreeze({
    batches: checked.length,
    page_outcomes: pageOutcomes,
    tags_kept: checked.reduce((total, result) => total + result.kept.length, 0),
    tags_dropped: dropped,
    pairs_by_kind: pairsByKind(indexes.pairs),
    event_check: Object.fromEntries(["pairs", "accepted", "rejected", "unanswered", "tags_dropped"].map((key) => [key, eventCheck[key]])),
    pages_with_quotes: coverage.pages_with_quotes,
    untagged_pages: coverage.untagged.map((item) => ({ ...item })),
    untagged_share: coverage.untagged_share,
    coverage_holds: coverage.holds
  });
}

