import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_ROLE_DEFINITIONS } from "./provider-port.mjs";
import { pointerCallCounts, runDeadlineCalls } from "./pointer-calls.mjs";
import { applyPointerEventCheck, buildPointerGeneration, checkPointerBatches, keepPointerPages, overlayPointerRepass, pointerCoverage,
  pointerEventCheckCalls, pointerEventPairs, pointerPassInput, pointerPassReport, pointerRepassBatches, pointerTaggerPacket } from "./pointer-pass.mjs";
import { POINTER_FLOORS, POINTER_PRECISION_SAMPLES, cohenKappa, designRatioBound, pointerFloors } from "./pointer-measure.mjs";
import { batchPointerQuotes, checkPointerTags, pointerTagIndexes } from "./pointer-tags.mjs";
import { POINTER_REFERENCE_NONRESPONSE_REASONS, checkCoverageJudgments, checkQuestionSet, checkSearchPlan, coverageJudgeCalls,
  pointerReferenceSample, referenceUnitStep } from "./pointer-reference.mjs";
import { buildQuoteGeneration } from "./quote-index.mjs";

// The pointer pass's steps as sequences of deadline-bound call rounds (plan 2026-10-09-journal-quote-first.md, Part
// 3). Each step is deterministic given its inputs and the answers the durable port has stored, so a resumed step runs
// again from the start, with the same deadline and the same keys, and sends only what was never sent. The model calls
// go through the port; checking, sampling and bookkeeping are the pure functions of pointer-reference.mjs. What a step
// returns holds journal-derived text (questions and searches) for the private store alone; its counts are content-free.

// The coverage check's two judges: the Codex one, in calls of its own, and the Claude one.
const COVERAGE_TIERS = Object.freeze(["standard", "hardest"]);

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

// A role packet with the common fields the exchange checks; `fields` are the role's own.
function rolePacket(role, { generation, grantPurpose, assigned, tag, fields }) {
  return { protocol_version: "1.0", output_schema_id: JOURNAL_ROLE_DEFINITIONS[role].outputSchema, assigned_core_ids: assigned,
    source_locators: [], expected_generation: generation, controller_provenance_tag: tag, grant_purpose: grantPurpose, ...fields };
}

/**
 * The reference step (plan Part 3, "Questions that cover every sampled quote", "Two independent checks that the
 * questions cover each quote", "No unit drops out" and "Retrieval recall"). It draws the sample from `units` (the
 * quote generation's quote units: unit_id, page, representation_id, text, source_order) with `seed`, and then, in
 * rounds of calls that each go out at once: the question writer for every sampled unit; both coverage judges for every
 * unit whose questions are complete; the writer's one retry, with both judges' notes, for every unit that fell short,
 * and both judges again; and the search writer, with one retry, for every unit whose quotes are all confirmed. Every
 * call is keyed under `stepId` and expires at `deadline`. A unit without confirmed questions or complete searches is a
 * nonresponse, with its reason; one that ran out of time is a nonresponse for the deadline. Returns the frozen
 * reference: the sample's record, and for each sampled unit its stretch, inclusion probability, quotes and, when
 * complete, its questions with their critical and event marks and their searches.
 */
export async function runPointerReference({ units, seed, stepId, deadline, port, grant, generation, now = () => new Date(),
  beforeHardestSend = null } = {}) {
  invariant(typeof stepId === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(stepId), "POINTER_STEP_ID_INVALID");
  invariant(grant && typeof grant.purpose === "string" && typeof generation === "string" && generation.length > 0, "POINTER_STEP_INPUT_INVALID");
  const sample = pointerReferenceSample({ units, seed });
  const quoteById = new Map(units.map((unit) => [unit.unit_id, unit]));
  // `late` records how time ran out for a unit: a call of its own left unanswered, or one never sent because the
  // deadline had passed (another call's wait used the time up).
  const sampled = sample.units.map((unit, index) => ({ ...unit, index, attempts: [], late: null }));
  const noteLate = (unit, outcome) => {
    if (outcome.status !== "deadline") return;
    unit.late = outcome.reason === "deadline_unsent" && unit.late !== "unanswered" ? "unsent" : "unanswered";
  };
  const call = (role, tier, key, assigned, fields) => ({ key, role, tier, grant, outputSchema: JOURNAL_ROLE_DEFINITIONS[role].outputSchema,
    packet: rolePacket(role, { generation, grantPurpose: grant.purpose, assigned, tag: `pointer:${role}:${stepId}`, fields }) });
  const next = (unit) => referenceUnitStep({ quoteIds: unit.quote_ids, attempts: unit.attempts });
  const quoteFor = (id) => ({ unit_id: id, text: quoteById.get(id).text });

  for (let round = 0; round < 2; round += 1) {
    // The question writer: each unit's first answer, and the one retry of those that fell short.
    const writing = sampled.filter((unit) => { const step = next(unit); return step.step === "write" && step.attempt === round; });
    if (writing.length > 0) {
      const calls = writing.map((unit) => {
        const { notes } = next(unit);
        return call("question_writer", "standard", `${stepId}:writer:${unit.index}:${round}`, [...unit.quote_ids], {
          quote_units: unit.quote_ids.map(quoteFor),
          ...(notes.length > 0 ? { coverage_notes: notes.map(({ unit_id: unitId, missing }) => ({ unit_id: unitId, missing })) } : {})
        });
      });
      const outcomes = await runDeadlineCalls({ calls, port, deadline, now, retries: 0 });
      writing.forEach((unit, position) => {
        const outcome = outcomes[position];
        noteLate(unit, outcome);
        unit.attempts.push({ set: outcome.status === "answered"
          ? checkQuestionSet({ sampleIndex: unit.index, attempt: round, quoteIds: unit.quote_ids, answer: outcome.output }) : null, coverage: null });
      });
    }
    // Both coverage judges, on every quote whose unit's questions are complete, 25 quotes to a call.
    const judging = sampled.filter((unit) => { const step = next(unit); return step.step === "judge" && step.attempt === round; });
    if (judging.length > 0) {
      const quotes = judging.flatMap((unit) => {
        const { set } = unit.attempts[round];
        return unit.quote_ids.map((id) => ({ ...quoteFor(id), questions: set.questions.filter((item) => item.unit_id === id)
          .map(({ question_id: questionId, question, critical, event }) => ({ question_id: questionId, question, critical, event })) }));
      });
      const groups = coverageJudgeCalls({ quotes });
      const calls = COVERAGE_TIERS.flatMap((tier) => groups.map((group) => call("coverage_judge", tier,
        `${stepId}:coverage:${round}:${tier}:${group.call_index}`, group.quotes.map((quote) => quote.unit_id), { quotes: group.quotes })));
      // An answer that fails the code's check (a quote missed or judged twice, another quote's question listed, an
      // unconfirmed quote without a note) uses its call's retry, like an answer that fails the schema.
      const check = (spec, output) => {
        const checked = checkCoverageJudgments({ quotes: spec.packet.quotes, answer: output });
        return checked.valid ? null : `COVERAGE_ANSWER_${checked.reason.toUpperCase()}`;
      };
      const outcomes = await runDeadlineCalls({ calls, port, deadline, now, retries: 1, beforeHardestSend, check });
      const judges = COVERAGE_TIERS.map((tier, tierIndex) => {
        const results = new Map();
        const notes = new Map();
        const failed = new Set();
        const late = new Map();
        groups.forEach((group, groupIndex) => {
          const outcome = outcomes[tierIndex * groups.length + groupIndex];
          if (outcome.status !== "answered") {
            for (const quote of group.quotes) {
              failed.add(quote.unit_id);
              if (outcome.status === "deadline") late.set(quote.unit_id, outcome);
            }
            return;
          }
          const checked = checkCoverageJudgments({ quotes: group.quotes, answer: outcome.output });
          for (const result of checked.quotes) results.set(result.unit_id, result);
          for (const note of checked.notes) notes.set(note.unit_id, note);
        });
        return { results, notes, failed, late };
      });
      for (const unit of judging) {
        for (const judge of judges) for (const id of unit.quote_ids) if (judge.late.has(id)) noteLate(unit, judge.late.get(id));
        unit.attempts[round].coverage = judges.map((judge) => (unit.quote_ids.some((id) => judge.failed.has(id))
          ? { failed: true }
          : { quotes: unit.quote_ids.map((id) => judge.results.get(id)), notes: unit.quote_ids.filter((id) => judge.notes.has(id))
            .map((id) => judge.notes.get(id)) }));
      }
    }
  }

  // The searches, for the units whose questions are confirmed; one retry for an answer that leaves a question without
  // a search or names another.
  const confirmed = sampled.map((unit) => ({ unit, step: next(unit) })).filter(({ step }) => step.step === "complete");
  const searchCalls = confirmed.map(({ unit, step }) => call("search_writer", "standard", `${stepId}:search:${unit.index}`,
    [...unit.quote_ids], { questions: step.questions.map(({ question_id: questionId, question }) => ({ question_id: questionId, question })) }));
  const searchCheck = (spec, output) => (checkSearchPlan({ questionIds: spec.packet.questions.map((item) => item.question_id), answer: output }).complete
    ? null : "SEARCH_PLAN_INCOMPLETE");
  const searchOutcomes = searchCalls.length > 0
    ? await runDeadlineCalls({ calls: searchCalls, port, deadline, now, retries: 1, check: searchCheck }) : [];
  const searches = new Map();
  confirmed.forEach(({ unit, step }, position) => {
    const outcome = searchOutcomes[position];
    noteLate(unit, outcome);
    if (outcome.status === "answered") {
      searches.set(unit.index, checkSearchPlan({ questionIds: step.questions.map((item) => item.question_id), answer: outcome.output }).searches);
    }
  });

  const reference = sampled.map((unit) => {
    const step = next(unit);
    const plan = searches.get(unit.index);
    const base = { unit_id: unit.unit_id, stratum: unit.stratum, inclusion_probability: unit.inclusion_probability,
      quote_ids: [...unit.quote_ids], writer_attempts: unit.attempts.length };
    if (step.step === "complete" && plan) {
      const queries = new Map(plan.map((item) => [item.question_id, item.queries]));
      return { ...base, status: "complete", reason: null, deadline_cause: null, questions: step.questions.map((question) => ({ ...question,
        queries: [...queries.get(question.question_id)] })) };
    }
    // Out of time, or short in a way the rounds can't mend: a nonresponse, which fails the recall floor.
    const reason = unit.late ? "deadline" : (step.step === "nonresponse" ? step.reason
      : (step.step === "complete" ? "searches_incomplete" : "deadline"));
    return { ...base, status: "nonresponse", reason, deadline_cause: reason === "deadline" ? unit.late ?? "unsent" : null, questions: [] };
  });
  return deepFreeze({
    step_id: stepId,
    deadline,
    sample: { seed_sha256: sample.seed_sha256, strata: sample.strata, units_per_stratum: sample.units_per_stratum,
      candidate_units: sample.candidate_units },
    units: reference
  });
}

/** Content-free counts of a reference, for reports and the owner page. */
export function pointerReferenceCounts(reference) {
  invariant(reference && Array.isArray(reference.units), "POINTER_REFERENCE_INVALID");
  const reasons = Object.fromEntries(POINTER_REFERENCE_NONRESPONSE_REASONS.map((reason) => [reason, 0]));
  let complete = 0;
  let questions = 0;
  let critical = 0;
  let events = 0;
  let retried = 0;
  let unanswered = 0;
  for (const unit of reference.units) {
    if (unit.deadline_cause === "unanswered") unanswered += 1;
    if (unit.writer_attempts > 1) retried += 1;
    if (unit.status === "complete") {
      complete += 1;
      questions += unit.questions.length;
      critical += unit.questions.filter((question) => question.critical).length;
      events += unit.questions.filter((question) => question.event).length;
    } else {
      invariant(Object.hasOwn(reasons, unit.reason), "POINTER_REFERENCE_INVALID");
      reasons[unit.reason] += 1;
    }
  }
  return Object.freeze({ sampled_units: reference.units.length, complete_units: complete, nonresponse_units: reference.units.length - complete,
    nonresponse_by_reason: Object.freeze(reasons), deadline_units_with_a_call_unanswered: unanswered, units_retried: retried, questions,
    critical_questions: critical, event_questions: events });
}


/** Pages a pilot tags (plan Part 3, "Steps"). */
export const POINTER_PILOT_PAGES = 20;

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
// A quote's page: its page number, or its representation when it has none (as pointer-pass reads pages).
const pageOf = (unit) => (unit.page === null || unit.page === undefined ? unit.representation_id : unit.page);

// A pair judge's answer must judge every pair of its call once and nothing else; otherwise its call uses its retry.
function pairAnswerCheck(spec, output) {
  const wanted = new Set(spec.packet.pairs.map((pair) => pair.pair_id));
  const seen = new Set();
  for (const judgment of output.judgments) {
    if (!wanted.has(judgment.pair_id) || seen.has(judgment.pair_id)) return "PAIR_ANSWER_INVALID";
    seen.add(judgment.pair_id);
  }
  return seen.size === wanted.size ? null : "PAIR_ANSWER_INCOMPLETE";
}

// The event check's counts over a ledger: its pairs by how they ended, and the event tags left with no accepted pair
// (a tag is its pass, batch and place in the tagger's answer).
function eventCheckCounts(ledger) {
  const counts = { pairs: ledger.length, accepted: 0, rejected: 0, unanswered: 0, tags_dropped: 0 };
  const kept = new Map();
  for (const entry of ledger) {
    counts[entry.status] += 1;
    const tag = `${entry.pass}\0${entry.batch_id}\0${entry.tag_index}`;
    kept.set(tag, kept.get(tag) === true || entry.status === "accepted");
  }
  counts.tags_dropped = [...kept.values()].filter((value) => !value).length;
  return Object.freeze(counts);
}

// The times the answers used came in, sorted, for the runtime's timings; content-free.
const answeredAt = (outcomes) => Object.freeze(outcomes.filter((outcome) => outcome.status === "answered")
  .map((outcome) => outcome.receipt?.provider_route_receipt?.received_at).filter((value) => typeof value === "string").sort());

// Tags `batches` and checks what comes back: the tagger for every batch at once, with one retry for an invalid answer,
// each answer checked by code, and then the event check for every kept event tag and quote it is anchored in, 50 pairs
// to a call, with one retry for an answer that doesn't judge each of its pairs once. With `pages`, only the tags
// anchored on those pages are kept before the event check. `pass` names the pass in the ledger.
async function tagBatches({ input, batches, pages = null, pass, stepId, deadline, port, grant, now }) {
  const call = (role, key, assigned, fields) => ({ key, role, tier: "standard", grant, outputSchema: JOURNAL_ROLE_DEFINITIONS[role].outputSchema,
    packet: rolePacket(role, { generation: input.generation, grantPurpose: grant.purpose, assigned, tag: `pointer:${role}:${stepId}`, fields }) });
  const taggerCalls = batches.map((batch) => call("pointer_tagger", `${stepId}:tagger:${batch.batch_id}`, [...batch.unit_ids],
    { quote_units: pointerTaggerPacket({ batch, unitsById: input.unitsById }).quote_units }));
  const taggerOutcomes = await runDeadlineCalls({ calls: taggerCalls, port, deadline, now, retries: 1 });
  const outcomes = new Map(batches.map((batch, index) => {
    const outcome = taggerOutcomes[index];
    return [batch.batch_id, outcome.status === "answered" ? { status: "answered", answer: outcome.output } : { status: outcome.status }];
  }));
  const tagged = checkPointerBatches({ batches, unitsById: input.unitsById, outcomes });
  const checked = pages ? keepPointerPages({ checked: tagged, unitsById: input.unitsById, pages }) : tagged;

  const pairs = pointerEventPairs({ checked, unitsById: input.unitsById });
  const pairById = new Map(pairs.map((pair) => [pair.pair_id, pair]));
  const eventCalls = pointerEventCheckCalls(pairs).map((eventCall) => call("pair_judge", `${stepId}:${eventCall.call_id}`,
    [...new Set(eventCall.packet.pairs.map((pair) => pairById.get(pair.pair_id).unit_id))], { pairs: eventCall.packet.pairs }));
  const eventOutcomes = eventCalls.length > 0
    ? await runDeadlineCalls({ calls: eventCalls, port, deadline, now, retries: 1, check: pairAnswerCheck }) : [];
  const judgments = new Map();
  for (const outcome of eventOutcomes) {
    if (outcome.status === "answered") for (const judgment of outcome.output.judgments) judgments.set(judgment.pair_id, judgment);
  }
  const eventCheck = applyPointerEventCheck({ checked, pairs, judgments });
  const ledger = eventCheck.ledger.map((entry) => Object.freeze({ ...entry, pass, page: pageOf(input.unitsById.get(entry.unit_id)) }));
  return { checked: eventCheck.checked, ledger, dropped: eventCheck.dropped, taggerOutcomes, eventOutcomes };
}

/**
 * A pointer pass (plan Part 3, "Running it in hours", "Failures", "Event check", "Deadlines" and the coverage floor's
 * one new pass). It rebuilds the quote generation from `quoteGeneration` (buildQuoteGeneration's input, under the
 * generation ID the pass builds), sends every batch to the tagger at once, checks each answer by code, sends every kept
 * event tag and quote it is anchored in to the event check, and builds the pointer generation with its tag indexes,
 * its coverage and a counts-only report. With `pages` and `first` it is the coverage pass: it sends only the batches
 * with those untagged pages, keeps only its tags on them, checks their events, and lays its results over `first` (the
 * first pass's `checked`, `event_pairs` and `dropped_event_pairs`) on those pages alone; its event-check ledger, counts
 * and dropped pairs are then the generation's, the first pass's on the other pages and its own on the retried ones.
 * Every call is keyed under `stepId` and expires at `deadline`: a batch still unanswered then is untagged for the
 * deadline, and an event check still unanswered drops its pairs, which count against the event-check floor. `maxBytes`
 * is the batch size, left at the plan's except in tests.
 */
export async function runPointerPass({ quoteGeneration, stepId, deadline, port, grant, now = () => new Date(), pages = null, first = null,
  maxBytes } = {}) {
  invariant(typeof stepId === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(stepId), "POINTER_STEP_ID_INVALID");
  invariant(grant && typeof grant.purpose === "string" && quoteGeneration && typeof quoteGeneration.generation === "string", "POINTER_STEP_INPUT_INVALID");
  invariant((pages === null) === (first === null), "POINTER_STEP_INPUT_INVALID");
  invariant(pages === null || (Array.isArray(pages) && pages.length > 0 && first && Array.isArray(first.checked)
    && Array.isArray(first.event_pairs) && Array.isArray(first.dropped_event_pairs)), "POINTER_STEP_INPUT_INVALID");
  const input = pointerPassInput({ built: buildQuoteGeneration(quoteGeneration), ...(maxBytes === undefined ? {} : { maxBytes }) });
  const batches = pages ? pointerRepassBatches({ batches: input.batches, unitsById: input.unitsById, pages }) : input.batches;
  const own = await tagBatches({ input, batches, pages, pass: pages ? "coverage" : "first", stepId, deadline, port, grant, now });

  let { checked, ledger, dropped } = own;
  if (pages) {
    const retried = new Set(pages.map(String));
    const elsewhere = (page) => !retried.has(String(page));
    checked = overlayPointerRepass({ first: first.checked, second: own.checked, unitsById: input.unitsById, pages });
    ledger = [...first.event_pairs.filter((entry) => elsewhere(entry.page)), ...own.ledger];
    dropped = [...first.dropped_event_pairs.filter((pair) => {
      const unit = input.unitsById.get(pair.unit_id);
      invariant(unit, "POINTER_STEP_INPUT_INVALID");
      return elsewhere(pageOf(unit));
    }), ...own.dropped];
  }
  const eventCheck = eventCheckCounts(ledger);
  const { built, indexes } = buildPointerGeneration({ quoteGeneration, input, checked });
  const coverage = pointerCoverage({ input, checked, indexes });
  return Object.freeze({
    generation: input.generation,
    step_id: stepId,
    pages: pages ? Object.freeze([...pages]) : null,
    checked,
    event_pairs: Object.freeze(ledger),
    dropped_event_pairs: Object.freeze(dropped),
    event_check: eventCheck,
    built,
    indexes,
    coverage,
    report: pointerPassReport({ checked, eventCheck, indexes, coverage }),
    calls: Object.freeze({ tagger: pointerCallCounts(own.taggerOutcomes), event_check: pointerCallCounts(own.eventOutcomes) }),
    tagger_answered_at: answeredAt(own.taggerOutcomes)
  });
}

/**
 * Draws a pilot's pages (plan Part 3, "Steps"): `count` pages with quotes, none holding a quote in `excludeUnitIds`
 * (the reference sample's quotes), ordered by the SHA-256 of the seed and the page and returned in journal order. The
 * record holds the seed's digest, never the seed.
 */
export function pointerPilotPages({ quotes, excludeUnitIds, seed, count = POINTER_PILOT_PAGES } = {}) {
  invariant(Array.isArray(quotes) && Array.isArray(excludeUnitIds) && typeof seed === "string" && seed.length > 0
    && Number.isSafeInteger(count) && count > 0, "POINTER_PILOT_INPUT_INVALID");
  const excluded = new Set(excludeUnitIds);
  const closed = new Set(quotes.filter((quote) => excluded.has(quote.unit_id)).map((quote) => String(pageOf(quote))));
  const order = [];
  const seen = new Set();
  for (const quote of quotes) {
    const page = pageOf(quote);
    if (seen.has(String(page)) || closed.has(String(page))) continue;
    seen.add(String(page));
    order.push(page);
  }
  const rank = new Map(order.map((page, index) => [String(page), index]));
  const draw = new Map(order.map((page) => [String(page), sha256(`${seed}\0${String(page)}`)]));
  const drawn = [...order].sort((left, right) => {
    const [a, b] = [draw.get(String(left)), draw.get(String(right))];
    return a < b ? -1 : (a > b ? 1 : 0);
  }).slice(0, count).sort((left, right) => rank.get(String(left)) - rank.get(String(right)));
  return Object.freeze({ seed_sha256: sha256(seed), candidate_pages: order.length, pages: Object.freeze(drawn) });
}

/**
 * The pilot (plan Part 3, "Steps"): the tagger and the event check on the quotes of a few pages drawn outside the
 * reference sample, in batches of their own so no other page is sent, under the same rules and deadline as a pass.
 * It never looks at a reference and builds nothing to publish: it returns its pages and the counts-only report a pass
 * gives (pages by how their batch ended, tags kept and dropped, pairs by kind, the event check and the pilot pages left
 * untagged), its calls' counts, and when the answers came in, for the runtime's timings and the worker log's tokens.
 */
export async function runPointerPilot({ quoteGeneration, excludeUnitIds, seed, stepId, deadline, port, grant, now = () => new Date(),
  count = POINTER_PILOT_PAGES, maxBytes } = {}) {
  invariant(typeof stepId === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(stepId), "POINTER_STEP_ID_INVALID");
  invariant(grant && typeof grant.purpose === "string" && quoteGeneration && typeof quoteGeneration.generation === "string", "POINTER_STEP_INPUT_INVALID");
  const input = pointerPassInput({ built: buildQuoteGeneration(quoteGeneration) });
  const draw = pointerPilotPages({ quotes: input.quotes, excludeUnitIds, seed, count });
  const wanted = new Set(draw.pages.map(String));
  const quotes = input.quotes.filter((quote) => wanted.has(String(pageOf(quote))));
  const batches = batchPointerQuotes({ quotes, ...(maxBytes === undefined ? {} : { maxBytes }) });
  const own = await tagBatches({ input, batches, pass: "pilot", stepId, deadline, port, grant, now });
  const eventCheck = eventCheckCounts(own.ledger);
  const indexes = pointerTagIndexes({ batches: own.checked.map((result) => ({ units: result.unit_ids.map((unitId) => input.unitsById.get(unitId)),
    kept: result.kept, passageIdForUnit: input.passageIdForUnit })) });
  const coverage = pointerCoverage({ input: { quotes, unitsById: input.unitsById }, checked: own.checked, indexes });
  return Object.freeze({
    generation: input.generation,
    step_id: stepId,
    seed_sha256: draw.seed_sha256,
    candidate_pages: draw.candidate_pages,
    pages: draw.pages,
    event_check: eventCheck,
    report: pointerPassReport({ checked: own.checked, eventCheck, indexes, coverage }),
    calls: Object.freeze({ tagger: pointerCallCounts(own.taggerOutcomes), event_check: pointerCallCounts(own.eventOutcomes) }),
    tagger_answered_at: answeredAt(own.taggerOutcomes)
  });
}

/** A question is found when its quote is among the first this many results of one of its searches (plan Part 3). */
export const POINTER_RECALL_TOP = 12;
/** The measurement's samples: one for each kind's pairs, then the event pairs the event check dropped. */
export const POINTER_MEASURE_SAMPLE_NAMES = Object.freeze([...POINTER_PRECISION_SAMPLES.kinds, "dropped_events"]);
// Pairs to a judge's call, as for the event check.
const MEASURE_PAIRS_PER_CALL = 50;
// The judges: the Codex one on the standard tier and the Claude one on the hardest.
const JUDGE_TIERS = Object.freeze(["standard", "hardest"]);

const digest = (parts) => sha256(JSON.stringify(parts)).slice(0, 32);
const byRank = (left, right) => (left.rank < right.rank ? -1 : (left.rank > right.rank ? 1 : 0));

/**
 * Recall, critical recall, no loss, gain and event coverage on the reference sample (plan Part 3, "Retrieval recall"
 * and the floors), from which questions the searches found with tags (`foundWithTags`) and with words only
 * (`foundWordsOnly`), and which quotes have a kept event tag (`eventTaggedUnitIds`). Each is the design-based ratio
 * over every sampled unit, weighted by its inclusion probability: a unit with no critical question, or no question
 * word search misses, or no quote that reports an event, adds nothing to that ratio but stays in the design. A sample
 * with a nonresponse can't be measured: the run stopped before the pilot. Returns pointerFloors' recall inputs and
 * each unit's counts, content-free.
 */
export function measurePointerRecall({ reference, foundWithTags, foundWordsOnly, eventTaggedUnitIds } = {}) {
  invariant(reference && Array.isArray(reference.units) && reference.units.length > 0 && foundWithTags instanceof Set
    && foundWordsOnly instanceof Set && eventTaggedUnitIds instanceof Set, "POINTER_RECALL_INPUT_INVALID");
  invariant(reference.units.every((unit) => unit.status === "complete" && Array.isArray(unit.questions) && unit.questions.length > 0),
    "POINTER_REFERENCE_INCOMPLETE");
  const count = (questions, found) => questions.filter((question) => found.has(question.question_id)).length;
  const critical = (unit) => unit.questions.filter((question) => question.critical);
  const missed = (unit) => unit.questions.filter((question) => !foundWordsOnly.has(question.question_id));
  const eventQuotes = (unit) => [...new Set(unit.questions.filter((question) => question.event).map((question) => question.unit_id))];
  const rows = (pick) => reference.units.map((unit) => ({ unit_id: unit.unit_id, stratum: unit.stratum,
    inclusion_probability: unit.inclusion_probability, ...pick(unit) }));
  const bound = (pick) => designRatioBound({ units: rows(pick), confidence: POINTER_FLOORS.confidence });
  const recall = bound((unit) => ({ asked: unit.questions.length, found: count(unit.questions, foundWithTags) }));
  const wordsOnly = bound((unit) => ({ asked: unit.questions.length, found: count(unit.questions, foundWordsOnly) }));
  const criticalRecall = bound((unit) => ({ asked: critical(unit).length, found: count(critical(unit), foundWithTags) }));
  const criticalWordsOnly = bound((unit) => ({ asked: critical(unit).length, found: count(critical(unit), foundWordsOnly) }));
  const gain = bound((unit) => ({ asked: missed(unit).length, found: count(missed(unit), foundWithTags) }));
  const eventCoverage = bound((unit) => ({ asked: eventQuotes(unit).length,
    found: eventQuotes(unit).filter((unitId) => eventTaggedUnitIds.has(unitId)).length }));
  return deepFreeze({
    recall,
    recall_estimate: recall.estimate,
    recall_words_only_estimate: wordsOnly.estimate,
    critical_recall: criticalRecall.estimate === null ? null : criticalRecall,
    critical_recall_estimate: criticalRecall.estimate,
    critical_recall_words_only_estimate: criticalRecall.estimate === null ? null : criticalWordsOnly.estimate,
    gain: gain.estimate === null ? null : gain,
    event_coverage: eventCoverage.estimate === null ? null : eventCoverage,
    words_only: wordsOnly,
    units: reference.units.map((unit) => ({ unit_id: unit.unit_id, questions: unit.questions.length,
      found_with_tags: count(unit.questions, foundWithTags), found_words_only: count(unit.questions, foundWordsOnly),
      critical_questions: critical(unit).length, event_quotes: eventQuotes(unit).length }))
  });
}

/**
 * The measurement's fixed samples (plan Part 3, "Tag precision" and "event-check recall"): for each kind, 150 of the
 * generation's pairs of that kind, or all of them when there are no more, and 150 of the event pairs the event check
 * dropped, rejected or unanswered, or all of them; each drawn by the SHA-256 of the seed, the sample and the pair. Each
 * item is what a judge sees (a fresh content-free ID, the kind, the label and the exact quote) and its quote's unit.
 * The record holds the seed's digest, never the seed.
 */
export function pointerMeasureSamples({ pairs, dropped, unitsById, seed } = {}) {
  invariant(Array.isArray(pairs) && Array.isArray(dropped) && unitsById instanceof Map && typeof seed === "string" && seed.length > 0,
    "POINTER_MEASURE_SAMPLES_INVALID");
  const draw = (name, population, size) => {
    invariant(new Set(population.map((pair) => pair.pair_id)).size === population.length, "POINTER_MEASURE_PAIR_DUPLICATE");
    const chosen = population.map((pair) => ({ pair, rank: sha256(`${seed}\0${name}\0${pair.pair_id}`) })).sort(byRank).slice(0, size);
    return { name, pairs: population.length, items: chosen.map(({ pair }) => {
      const unit = unitsById.get(pair.unit_id);
      invariant(unit && typeof pair.label === "string", "POINTER_MEASURE_UNIT_MISSING");
      return { pair_id: `measure-pair:${digest([name, pair.pair_id])}`, kind: pair.kind, label: pair.label, quote: unit.text, unit_id: pair.unit_id };
    }) };
  };
  return deepFreeze({
    seed_sha256: sha256(seed),
    samples: [
      ...POINTER_PRECISION_SAMPLES.kinds.map((kind) => draw(kind, pairs.filter((pair) => pair.kind === kind), POINTER_PRECISION_SAMPLES.pairs_per_kind)),
      draw("dropped_events", dropped.map((pair) => ({ ...pair, kind: "event" })), POINTER_PRECISION_SAMPLES.dropped_event_pairs)
    ]
  });
}

/**
 * Anchors that don't hold: every kept tag checked again by code against its batch's quotes, as the tagger's answer
 * was, counting each anchor or tag the check would drop once (a tag left without anchors is their consequence, not
 * counted again). It holds by construction, so this counts zero unless something broke between the check and the build.
 */
export function pointerBrokenAnchors({ checked, unitsById } = {}) {
  invariant(Array.isArray(checked) && unitsById instanceof Map, "POINTER_ANCHORS_INPUT_INVALID");
  let broken = 0;
  for (const result of checked) {
    if (result.kept.length === 0) continue;
    const units = result.unit_ids.map((unitId) => unitsById.get(unitId));
    invariant(units.every(Boolean), "POINTER_ANCHORS_INPUT_INVALID");
    const { dropped } = checkPointerTags({ units, answer: { schema_version: "1.0", tags: result.kept } });
    broken += Object.entries(dropped).filter(([reason]) => reason !== "tag_without_anchor").reduce((total, [, value]) => total + value, 0);
  }
  return broken;
}

// Questions found by their searches: a question is found when its quote's passage is among the first POINTER_RECALL_TOP
// results of one of its searches. The same search runs once.
async function foundQuestions({ units, passageIdForUnit, search, matchTags }) {
  const results = new Map();
  const found = new Set();
  for (const unit of units) {
    for (const question of unit.questions) {
      const passageId = passageIdForUnit(question.unit_id);
      invariant(typeof passageId === "string", "POINTER_MEASURE_QUOTE_UNKNOWN");
      for (const query of question.queries) {
        if (!results.has(query)) {
          const ranked = await search({ query, matchTags });
          invariant(Array.isArray(ranked) && ranked.every((id) => typeof id === "string"), "POINTER_MEASURE_SEARCH_INVALID");
          results.set(query, ranked.slice(0, POINTER_RECALL_TOP));
        }
        if (results.get(query).includes(passageId)) { found.add(question.question_id); break; }
      }
    }
  }
  return found;
}

/**
 * The measurement (plan Part 3, "Measuring it" and step 5) of a pass's generation, as it would be published: recall
 * and its relatives on the reference sample, through `search({ query, matchTags })` (the first results of
 * find_journal_quotes on that generation, as passage IDs in rank order); both judges on every fixed sample, the Codex
 * one (standard tier) and the Claude one (hardest tier) each in calls of their own, 50 pairs to a call, with one retry,
 * all sent at once and expiring at `deadline`; and then every floor. A pair counts as correct only when both judges
 * accept it, and one either leaves unscored counts as wrong; a dropped event pair counts as real when either accepts it
 * or leaves it unscored. `pass` is the measured pass's result (its checked results, event-check ledger counts, dropped
 * event pairs and coverage), and `quoteGeneration` its generation's input, which gives each quote's passage and text.
 * Returns the floors, a content-free report, and each sample's items with both verdicts for the private store.
 */
export async function runPointerMeasure({ quoteGeneration, pass, reference, search, seed, stepId, deadline, port, grant,
  now = () => new Date(), beforeHardestSend = null } = {}) {
  invariant(typeof stepId === "string" && /^[A-Za-z0-9:_-]{1,120}$/.test(stepId), "POINTER_STEP_ID_INVALID");
  invariant(grant && typeof grant.purpose === "string" && quoteGeneration && typeof quoteGeneration.generation === "string"
    && typeof search === "function", "POINTER_STEP_INPUT_INVALID");
  invariant(pass && Array.isArray(pass.checked) && Array.isArray(pass.dropped_event_pairs) && pass.event_check && pass.coverage,
    "POINTER_STEP_INPUT_INVALID");
  const input = pointerPassInput({ built: buildQuoteGeneration(quoteGeneration) });
  // The generation's tag pairs, as its build indexed them.
  const indexes = pointerTagIndexes({ batches: pass.checked.map((result) => ({ units: result.unit_ids.map((unitId) => input.unitsById.get(unitId)),
    kept: result.kept, passageIdForUnit: input.passageIdForUnit })) });

  // Recall, words with tags and words only, on the generation itself.
  const eventTagged = new Set(indexes.pairs.filter((pair) => pair.kind === "event").map((pair) => pair.unit_id));
  const recall = measurePointerRecall({ reference,
    foundWithTags: await foundQuestions({ units: reference.units, passageIdForUnit: input.passageIdForUnit, search, matchTags: true }),
    foundWordsOnly: await foundQuestions({ units: reference.units, passageIdForUnit: input.passageIdForUnit, search, matchTags: false }),
    eventTaggedUnitIds: eventTagged });

  // Both judges on every sample.
  const { seed_sha256: seedSha256, samples } = pointerMeasureSamples({ pairs: indexes.pairs, dropped: pass.dropped_event_pairs,
    unitsById: input.unitsById, seed });
  const calls = [];
  for (const tier of JUDGE_TIERS) {
    for (const sample of samples) {
      for (let start = 0; start < sample.items.length; start += MEASURE_PAIRS_PER_CALL) {
        const items = sample.items.slice(start, start + MEASURE_PAIRS_PER_CALL);
        calls.push({ key: `${stepId}:judge:${tier}:${sample.name}:${start / MEASURE_PAIRS_PER_CALL}`, role: "pair_judge", tier, grant,
          outputSchema: JOURNAL_ROLE_DEFINITIONS.pair_judge.outputSchema,
          packet: rolePacket("pair_judge", { generation: input.generation, grantPurpose: grant.purpose, assigned: [...new Set(items.map((item) => item.unit_id))],
            tag: `pointer:pair_judge:${stepId}`, fields: { pairs: items.map((item) => ({ pair_id: item.pair_id, kind: item.kind, label: item.label, quote: item.quote })) } }) });
      }
    }
  }
  const outcomes = calls.length > 0 ? await runDeadlineCalls({ calls, port, deadline, now, retries: 1, check: pairAnswerCheck, beforeHardestSend }) : [];
  const verdicts = Object.fromEntries(JUDGE_TIERS.map((tier) => [tier, new Map()]));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "answered") for (const judgment of outcome.output.judgments) verdicts[calls[index].tier].set(judgment.pair_id, judgment);
  });
  const accepts = (judgment) => judgment.mentions === true && judgment.kind_right === true;
  const scored = samples.map((sample) => {
    const items = sample.items.map((item) => ({ ...item, codex: verdicts.standard.get(item.pair_id) ?? null, claude: verdicts.hardest.get(item.pair_id) ?? null }));
    const both = items.filter((item) => item.codex && item.claude);
    const counts = { name: sample.name, pairs: sample.pairs, sampled: items.length,
      correct: items.filter((item) => item.codex && item.claude && accepts(item.codex) && accepts(item.claude)).length,
      real: items.filter((item) => !item.codex || !item.claude || accepts(item.codex) || accepts(item.claude)).length,
      unscored_codex: items.filter((item) => !item.codex).length, unscored_claude: items.filter((item) => !item.claude).length,
      agreement: cohenKappa(both.map((item) => ({ first: accepts(item.codex), second: accepts(item.claude) }))) };
    return { items, counts, both };
  });
  const byName = new Map(scored.map((sample) => [sample.counts.name, sample.counts]));
  const precision = Object.fromEntries(POINTER_PRECISION_SAMPLES.kinds.map((kind) => {
    const { pairs, sampled, correct } = byName.get(kind);
    return [kind, { pairs, sampled, correct }];
  }));
  const dropped = byName.get("dropped_events");
  const floors = pointerFloors({
    recall: recall.recall,
    recall_estimate: recall.recall_estimate,
    recall_words_only_estimate: recall.recall_words_only_estimate,
    critical_recall: recall.critical_recall,
    critical_recall_estimate: recall.critical_recall_estimate,
    critical_recall_words_only_estimate: recall.critical_recall_words_only_estimate,
    gain: recall.gain,
    precision,
    event_check: { pairs: pass.event_check.pairs, unanswered: pass.event_check.unanswered },
    event_recall: { kept: { pairs: precision.event.pairs, sampled: precision.event.sampled, real: precision.event.correct },
      dropped: { pairs: dropped.pairs, sampled: dropped.sampled, real: dropped.real } },
    event_coverage: recall.event_coverage,
    coverage: { untagged_pages: pass.coverage.untagged.length, pages_with_quotes: pass.coverage.pages_with_quotes },
    anchors: { broken: pointerBrokenAnchors({ checked: pass.checked, unitsById: input.unitsById }) }
  });
  return deepFreeze({
    generation: input.generation,
    step_id: stepId,
    seed_sha256: seedSha256,
    publish: floors.publish,
    floors: floors.floors,
    report: {
      recall_units: recall.units,
      words_only: { estimate: recall.words_only.estimate, lower_bound: recall.words_only.lower_bound },
      samples: scored.map((sample) => sample.counts),
      agreement: cohenKappa(scored.flatMap((sample) => sample.both.map((item) => ({ first: accepts(item.codex), second: accepts(item.claude) })))),
      calls: pointerCallCounts(outcomes)
    },
    samples: scored.map((sample) => ({ name: sample.counts.name, items: sample.items }))
  });
}
