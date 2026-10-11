import test from "node:test";
import assert from "node:assert/strict";
import { JournalInferencePortError, buildJournalRolePacket } from "../src/journal-import/provider-port.mjs";
import { validateJournalSchema } from "../src/journal-import/contracts.mjs";
import { pointerCallKey } from "../src/journal-import/pointer-calls.mjs";
import { applyPointerEventCheck, checkPointerBatches, pointerEventCheckCalls, pointerEventPairs, pointerPassInput,
  pointerTaggerPacket } from "../src/journal-import/pointer-pass.mjs";
import { pointerReferenceSample } from "../src/journal-import/pointer-reference.mjs";
import { POINTER_PILOT_PAGES, pointerPilotPages, pointerReferenceCounts, runPointerPass, runPointerPilot,
  runPointerReference } from "../src/journal-import/pointer-steps.mjs";
import { buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";

// The reference step, the pass, the coverage pass and the pilot in rounds of deadline-bound calls (plan
// 2026-10-09-journal-quote-first.md, Part 3). A scripted port stands in for the models; all text is invented.

const START = Date.parse("2026-10-11T06:00:00Z");
const DEADLINE = "2026-10-11T09:00:00.000Z";
const grant = Object.freeze({ grant_id: "grant:synthetic", principal_id: "authorized-private-operator", purpose: "organize_search",
  allowed_roles: ["question_writer", "coverage_judge", "search_writer"], revoked: false, expires_at: null });

// 30 pages, page n holding (n % 2) + 1 quotes: a short journal, so every page is sampled.
function quoteUnits(pages = 30) {
  const units = [];
  for (let page = 1; page <= pages; page += 1) {
    for (let quote = 0; quote <= page % 2; quote += 1) {
      units.push({ unit_id: `unit:p${page}q${quote}`, page, representation_id: "representation:pdf",
        text: `Synthetic paragraph ${quote} of page ${page}.`, source_order: units.length });
    }
  }
  return units;
}

// Each page's place in the sample, for keying a scripted answer to its unit.
const SAMPLE_INDEX = new Map(pointerReferenceSample({ units: quoteUnits(), seed: "synthetic-seed" }).units.map((unit, index) => [unit.unit_id, index]));
const writerKey = (page, attempt = 0) => `reference:synthetic:writer:${SAMPLE_INDEX.get(`page:${page}`)}:${attempt}`;
const searchKey = (page) => `reference:synthetic:search:${SAMPLE_INDEX.get(`page:${page}`)}`;

// What a careful tagger would answer for a batch, by rule. The coverage pass's tagger tags a dream as a topic, where
// the first pass's tags it as an event.
function taggerAnswer(packet, operationKey) {
  const coverage = operationKey.startsWith("pass:coverage:");
  const tags = [];
  for (const unit of packet.quote_units) {
    const anchor = (quote) => ({ unit_id: unit.unit_id, quote, occurrence: null });
    if (unit.text.includes("Jean")) tags.push({ kind: "person", label: "Jean", anchors: [anchor("Jean")] });
    if (unit.text.includes("marché")) tags.push({ kind: "topic", label: "marché", anchors: [anchor("marché")] });
    if (unit.text.includes("concert")) {
      tags.push({ kind: coverage && unit.text.includes("rêvais") ? "topic" : "event", label: "concert", anchors: [anchor("concert")] });
    }
  }
  return { schema_version: "1.0", tags };
}

// A judge that knows a dream is no event.
const judgment = (pair) => ({ pair_id: pair.pair_id, mentions: true, kind_right: !pair.quote.includes("rêvais") });

// Answers each role from its packet, as the exchange would after its schema check, and keeps an invalid answer as
// invalid. `script` changes single answers: by the writer's call key, by "tier:quote" for a coverage judge (round 0
// only, unless the entry says "always"), by the search call key, and by the tagger's or pair judge's call key
// ("skip-last" leaves out a judgment, "foreign" adds one for a pair the call doesn't hold). "open" holds its call
// until the deadline, and "invalid" answers with no valid output.
function scriptedPort({ clock, script = {} }) {
  const sent = [];
  const answers = new Map();
  const answer = (request) => {
    const packet = buildJournalRolePacket(request.role, request.packet);
    const custom = script[request.operationKey];
    if (custom === "open") {
      clock.now = Date.parse(request.expiresAt);
      throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
    }
    if (request.role === "pointer_tagger") return taggerAnswer(packet, request.operationKey);
    if (request.role === "pair_judge") {
      const judgments = packet.pairs.map(judgment);
      if (custom === "skip-last") judgments.pop();
      if (custom === "foreign") judgments.push({ pair_id: "event-pair:foreign", mentions: true, kind_right: true });
      return { schema_version: "1.0", judgments };
    }
    if (request.role === "question_writer") {
      const quotes = custom === "skip-last" ? packet.quote_units.slice(0, -1) : packet.quote_units;
      return { schema_version: "1.0", questions: quotes.map((quote, index) => ({ unit_id: quote.unit_id,
        question: `What happened in the synthetic paragraph ${quote.unit_id}?`, critical: index === 0, event: index % 2 === 0 })) };
    }
    if (request.role === "coverage_judge") {
      const round = Number(request.operationKey.split(":coverage:")[1].split(":")[0]);
      return { schema_version: "1.0", judgments: packet.quotes.map((quote) => {
        const rule = script[`${request.tier}:${quote.unit_id}`];
        const unconfirmed = rule === "always" || (rule === "once" && round === 0);
        return { unit_id: quote.unit_id, covered: !unconfirmed, missing: unconfirmed ? `${request.tier} judge: something is missing` : "",
          critical_question_ids: [], event_question_ids: request.tier === "hardest" ? quote.questions.map((question) => question.question_id) : [],
          repeated_question_ids: [], combined_question_ids: [], copied_question_ids: [] };
      }) };
    }
    const questions = custom === "skip-first" ? packet.questions.slice(1) : packet.questions;
    return { schema_version: "1.0", searches: questions.map((question) => ({ question_id: question.question_id, queries: ["synthetic search"] })) };
  };
  const receipt = (stored) => ({ provider_route_receipt: { received_at: stored.at } });
  return {
    sent,
    async invoke(request) {
      sent.push({ operationKey: request.operationKey, role: request.role, tier: request.tier, packet: request.packet, expiresAt: request.expiresAt });
      if (!answers.has(request.operationKey)) {
        const at = new Date(clock.now).toISOString();
        let stored = { invalid: true, at };
        if (script[request.operationKey] !== "invalid") {
          const output = answer(request);
          try { stored = { output: validateJournalSchema(request.outputSchema, output), at }; } catch { /* kept as invalid */ }
        }
        answers.set(request.operationKey, stored);
      }
      const stored = answers.get(request.operationKey);
      if (stored.invalid) throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" });
      return { output: stored.output, receipt: receipt(stored) };
    },
    async getCompletion(operationKey) {
      if (!answers.has(operationKey)) return { status: sent.some((item) => item.operationKey === operationKey) ? "unknown" : "not_submitted" };
      const stored = answers.get(operationKey);
      if (stored.invalid) return { status: "invalid_output" };
      return { status: "completed", output: stored.output, receipt: receipt(stored) };
    },
    async wasSent(operationKey) { return sent.some((item) => item.operationKey === operationKey); }
  };
}

const run = (port, clock, extra = {}) => runPointerReference({ units: quoteUnits(), seed: "synthetic-seed", stepId: "reference:synthetic",
  deadline: DEADLINE, port, grant, generation: "generation:synthetic:quotes", now: () => new Date(clock.now), ...extra });

test("every sampled unit gets its questions, both judges' confirmation and its searches, each round sent at once", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const slots = [];
  const reference = await run(port, clock, { beforeHardestSend: async ({ operationKey }) => { slots.push(operationKey); } });
  assert.equal(reference.units.length, 30);
  assert.ok(reference.units.every((unit) => unit.status === "complete" && unit.writer_attempts === 1));
  const first = reference.units.find((unit) => unit.unit_id === "page:1");
  assert.deepEqual(first.quote_ids, ["unit:p1q0", "unit:p1q1"]);
  // Marks are the writer's and both judges' together: the Claude judge here marks every question as an event.
  assert.deepEqual(first.questions.map((question) => [question.unit_id, question.critical, question.event, question.queries]),
    [["unit:p1q0", true, true, ["synthetic search"]], ["unit:p1q1", false, true, ["synthetic search"]]]);
  assert.match(first.questions[0].question_id, /^question:\d+:0:0$/);
  // 30 writer calls, 45 quotes in 2 coverage calls for each judge, then 30 search calls; every item expires at the deadline.
  const roles = port.sent.map((item) => `${item.role}:${item.tier}`);
  assert.deepEqual([roles.filter((role) => role === "question_writer:standard").length, roles.filter((role) => role === "coverage_judge:standard").length,
    roles.filter((role) => role === "coverage_judge:hardest").length, roles.filter((role) => role === "search_writer:standard").length], [30, 2, 2, 30]);
  assert.ok(port.sent.every((item) => item.expiresAt === DEADLINE));
  assert.equal(slots.length, 2, "each Claude call counts one daily slot");
  // The writer sees the unit's quotes and no tag; the judge the quotes with their questions and marks; the search writer
  // only questions.
  const writer = port.sent.find((item) => item.role === "question_writer");
  assert.deepEqual(Object.keys(writer.packet.quote_units[0]), ["unit_id", "text"]);
  const judge = port.sent.find((item) => item.role === "coverage_judge");
  assert.deepEqual(Object.keys(judge.packet.quotes[0].questions[0]), ["question_id", "question", "critical", "event"]);
  const searcher = port.sent.find((item) => item.role === "search_writer");
  assert.deepEqual(Object.keys(searcher.packet.questions[0]), ["question_id", "question"]);
  assert.deepEqual(pointerReferenceCounts(reference), { sampled_units: 30, complete_units: 30, nonresponse_units: 0,
    nonresponse_by_reason: { questions_incomplete: 0, coverage_unconfirmed: 0, coverage_check_failed: 0, searches_incomplete: 0, deadline: 0 },
    deadline_units_with_a_call_unanswered: 0, units_retried: 0, questions: 45, critical_questions: 30, event_questions: 45 });
  assert.equal(JSON.stringify(pointerReferenceCounts(reference)).includes("Synthetic"), false);
});

test("a unit either judge leaves unconfirmed gets its one retry with that judge's notes, and is a nonresponse if it falls short again", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock, script: { "standard:unit:p3q0": "once", "hardest:unit:p5q1": "always",
    [writerKey(7)]: "skip-last" } });
  const reference = await run(port, clock);
  const byPage = new Map(reference.units.map((unit) => [unit.unit_id, unit]));
  const third = byPage.get("page:3");
  assert.deepEqual([third.status, third.writer_attempts], ["complete", 2]);
  assert.match(third.questions[0].question_id, /^question:\d+:1:0$/, "the retry's questions");
  const retry = port.sent.find((item) => item.role === "question_writer" && item.packet.coverage_notes);
  assert.deepEqual(retry.packet.coverage_notes, [{ unit_id: "unit:p3q0", missing: "standard judge: something is missing" }]);
  const fifth = byPage.get("page:5");
  assert.deepEqual([fifth.status, fifth.reason, fifth.questions], ["nonresponse", "coverage_unconfirmed", []]);
  // An incomplete first answer (a quote without a question) uses the same one retry, without notes.
  const seventh = byPage.get("page:7");
  assert.deepEqual([seventh.status, seventh.writer_attempts], ["complete", 2]);
  assert.equal(port.sent.filter((item) => item.operationKey === writerKey(7, 1) && !item.packet.coverage_notes).length, 1);
  assert.equal(pointerReferenceCounts(reference).units_retried, 3);
});

test("a search plan short twice makes its unit a nonresponse", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock, script: { [searchKey(4)]: "skip-first", [pointerCallKey(searchKey(4), 1)]: "skip-first",
    [searchKey(8)]: "skip-first" } });
  const reference = await run(port, clock);
  const byPage = new Map(reference.units.map((unit) => [unit.unit_id, unit]));
  assert.deepEqual([byPage.get("page:4").status, byPage.get("page:4").reason, byPage.get("page:4").questions], ["nonresponse", "searches_incomplete", []]);
  assert.equal(byPage.get("page:8").status, "complete", "one short plan uses the retry");
  assert.equal(pointerReferenceCounts(reference).nonresponse_by_reason.searches_incomplete, 1);
});

test("a call left open until the deadline ends the step: its unit ran out waiting, and the rest were never sent their next calls", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock, script: { [writerKey(6)]: "open" } });
  const reference = await run(port, clock);
  const byPage = new Map(reference.units.map((unit) => [unit.unit_id, unit]));
  assert.deepEqual([byPage.get("page:6").reason, byPage.get("page:6").deadline_cause], ["deadline", "unanswered"]);
  assert.ok(reference.units.every((unit) => unit.status === "nonresponse" && unit.reason === "deadline"));
  assert.ok(reference.units.filter((unit) => unit.unit_id !== "page:6").every((unit) => unit.deadline_cause === "unsent"));
  const counts = pointerReferenceCounts(reference);
  assert.deepEqual([counts.nonresponse_by_reason.deadline, counts.deadline_units_with_a_call_unanswered], [30, 1]);
  assert.equal(port.sent.filter((item) => item.role === "coverage_judge").length, 0, "nothing is sent after the deadline");
});

test("run again with the stored answers, the step gives the same reference and sends nothing new", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock, script: { "standard:unit:p3q0": "once" } });
  const first = await run(port, clock);
  const sentFirst = port.sent.length;
  // After the deadline nothing goes out; the stored answers still make the same reference.
  clock.now = Date.parse(DEADLINE) + 60_000;
  const again = await run(port, clock);
  assert.deepEqual(again, first);
  assert.equal(port.sent.length, sentFirst);
  await assert.rejects(runPointerReference({ units: quoteUnits(), seed: "s", stepId: "bad id", deadline: DEADLINE, port, grant, generation: "g" }),
    { code: "POINTER_STEP_ID_INVALID" });
});

// A short journal for the pass: pages 1 to 4 report a concert, page 5 holds only a dream of one, and the rest talk of
// rain. Each paragraph is a quote, and batches hold about three pages.
const PASS_PAGES = 12;
const passText = (page) => (page === 5 ? "Je rêvais d'un concert sur la plage."
  : `Jean est passé au marché ${page}.\n\n${page <= 4 ? "Le concert a eu lieu hier soir." : `Il a plu toute la journée ${page}.`}`);
const QUOTE_GENERATION = Object.freeze({ caseId: "steps-case", corpusId: "steps-corpus:quotes", generation: "steps-generation",
  originalObjectId: "original:steps", mediaType: "application/pdf", unitOptions: { minimumBytes: 0 },
  representations: Array.from({ length: PASS_PAGES }, (_, index) => ({ representation_id: `steps:page:${index + 1}`, text: passText(index + 1),
    page_number: index + 1, parse_status: "readable" })) });
const BATCH_BYTES = 200;
const passGrant = Object.freeze({ ...grant, allowed_roles: ["pointer_tagger", "pair_judge"] });
const PASS_INPUT = pointerPassInput({ built: buildQuoteGeneration(QUOTE_GENERATION), maxBytes: BATCH_BYTES });
const batchOfPage = (page) => PASS_INPUT.batches.find((batch) => batch.pages.includes(page));
const taggerKey = (page, step = "pass:first") => `${step}:tagger:${batchOfPage(page).batch_id}`;

// What the pass should give for the tagger's answers by rule and the judge's: the pure steps, run by hand.
function expectedPass(step = "pass:first") {
  const outcomes = new Map(PASS_INPUT.batches.map((batch) => [batch.batch_id, { status: "answered",
    answer: taggerAnswer(pointerTaggerPacket({ batch, unitsById: PASS_INPUT.unitsById }), `${step}:tagger:${batch.batch_id}`) }]));
  const checked = checkPointerBatches({ batches: PASS_INPUT.batches, unitsById: PASS_INPUT.unitsById, outcomes });
  const pairs = pointerEventPairs({ checked, unitsById: PASS_INPUT.unitsById });
  const eventCheck = applyPointerEventCheck({ checked, pairs, judgments: new Map(pairs.map((pair) => [pair.pair_id, judgment(pair)])) });
  return { pairs, eventCheck, eventKeys: pointerEventCheckCalls(pairs).map((call) => `${step}:${call.call_id}`) };
}

const pass = (port, clock, extra = {}) => runPointerPass({ quoteGeneration: QUOTE_GENERATION, stepId: "pass:first", deadline: DEADLINE, port,
  grant: passGrant, now: () => new Date(clock.now), maxBytes: BATCH_BYTES, ...extra });

test("a pass sends every batch to the tagger at once, checks each answer and its events, and builds the generation", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const result = await pass(port, clock);
  const expected = expectedPass();
  assert.ok(PASS_INPUT.batches.length >= 4, "several batches");
  // Every batch goes out before any event check, every item expires at the deadline, and each packet holds only its
  // role's fields: the tagger its quotes, the judge its pairs.
  const taggers = port.sent.filter((item) => item.role === "pointer_tagger");
  assert.equal(taggers.length, PASS_INPUT.batches.length);
  assert.ok(port.sent.slice(0, taggers.length).every((item) => item.role === "pointer_tagger"));
  assert.ok(port.sent.every((item) => item.expiresAt === DEADLINE && item.tier === "standard"));
  const common = ["protocol_version", "output_schema_id", "assigned_core_ids", "source_locators", "expected_generation", "controller_provenance_tag", "grant_purpose"];
  assert.deepEqual(Object.keys(taggers[0].packet), [...common, "quote_units"]);
  assert.deepEqual(taggers[0].packet.quote_units, pointerTaggerPacket({ batch: PASS_INPUT.batches[0], unitsById: PASS_INPUT.unitsById }).quote_units);
  assert.equal(taggers[0].packet.expected_generation, "steps-generation");
  const judges = port.sent.filter((item) => item.role === "pair_judge");
  assert.deepEqual(judges.map((item) => item.operationKey), expected.eventKeys);
  assert.deepEqual(Object.keys(judges[0].packet), [...common, "pairs"]);
  assert.deepEqual(Object.keys(judges[0].packet.pairs[0]), ["pair_id", "kind", "label", "quote"]);
  assert.deepEqual(judges[0].packet.assigned_core_ids, [...new Set(expected.pairs.map((pair) => pair.unit_id))]);

  // The results are the pure steps' for the same answers: five event pairs, the dream's rejected and its tag dropped.
  assert.deepEqual(result.checked, expected.eventCheck.checked);
  assert.deepEqual(result.event_check, expected.eventCheck.counts);
  assert.deepEqual(result.event_check, { pairs: 5, accepted: 4, rejected: 1, unanswered: 0, tags_dropped: 1 });
  assert.deepEqual(result.dropped_event_pairs, expected.eventCheck.dropped);
  assert.deepEqual(result.event_pairs.map((entry) => [entry.page, entry.status, entry.pass]),
    [[1, "accepted", "first"], [2, "accepted", "first"], [3, "accepted", "first"], [4, "accepted", "first"], [5, "rejected", "first"]]);
  // Page 5's only tag was dropped, so it is untagged: one page in twelve fails the coverage floor.
  assert.deepEqual(result.coverage.untagged, [{ page: 5, reason: "tags_dropped" }]);
  assert.equal(result.coverage.holds, false);
  assert.equal(result.built.graph.generation, "steps-generation");
  assert.equal(result.indexes.pairs.filter((pair) => pair.kind === "event").length, 4);
  assert.deepEqual(result.calls, { tagger: { calls: PASS_INPUT.batches.length, answered: PASS_INPUT.batches.length, failed: 0, deadline: 0, retried: 0 },
    event_check: { calls: 1, answered: 1, failed: 0, deadline: 0, retried: 0 } });
  assert.equal(result.tagger_answered_at.length, PASS_INPUT.batches.length);
  // What a log or the owner page may show holds no journal text.
  const shown = JSON.stringify({ report: result.report, event_check: result.event_check, event_pairs: result.event_pairs, calls: result.calls,
    coverage: result.coverage });
  for (const word of ["Jean", "marché", "concert", "rêvais"]) assert.equal(shown.includes(word), false);
});

test("an invalid tagger answer gets one retry, a second leaves its batch untagged, and an event check short of a pair uses its retry", async () => {
  const clock = { now: START };
  const { eventKeys } = expectedPass();
  const port = scriptedPort({ clock, script: { [taggerKey(1)]: "invalid", [taggerKey(7)]: "invalid", [pointerCallKey(taggerKey(7), 1)]: "invalid",
    [eventKeys[0]]: "skip-last" } });
  const result = await pass(port, clock);
  const failedPages = batchOfPage(7).pages;
  assert.deepEqual(result.coverage.untagged, [{ page: 5, reason: "tags_dropped" }, ...failedPages.map((page) => ({ page, reason: "batch_failed" }))]);
  assert.deepEqual(result.calls.tagger, { calls: PASS_INPUT.batches.length, answered: PASS_INPUT.batches.length - 1, failed: 1, deadline: 0, retried: 2 });
  assert.deepEqual(result.calls.event_check, { calls: 1, answered: 1, failed: 0, deadline: 0, retried: 1 });
  assert.deepEqual(result.event_check, { pairs: 5, accepted: 4, rejected: 1, unanswered: 0, tags_dropped: 1 });
  // A judge that answers for a pair its call doesn't hold, twice, leaves all its pairs unanswered: they are dropped.
  const foreign = scriptedPort({ clock: { now: START }, script: { [eventKeys[0]]: "foreign", [pointerCallKey(eventKeys[0], 1)]: "foreign" } });
  const unanswered = await pass(foreign, { now: START });
  assert.deepEqual(unanswered.event_check, { pairs: 5, accepted: 0, rejected: 0, unanswered: 5, tags_dropped: 5 });
  assert.equal(unanswered.dropped_event_pairs.length, 5);
  assert.equal(unanswered.indexes.pairs.filter((pair) => pair.kind === "event").length, 0);
  assert.deepEqual(unanswered.calls.event_check, { calls: 1, answered: 0, failed: 1, deadline: 0, retried: 1 });
});

test("a batch still open at the deadline is untagged for it, and the event check is never sent: its pairs count as unanswered", async () => {
  const clock = { now: START };
  const second = PASS_INPUT.batches[1];
  const port = scriptedPort({ clock, script: { [`pass:first:tagger:${second.batch_id}`]: "open" } });
  const result = await pass(port, clock);
  const later = PASS_INPUT.batches.slice(1).flatMap((batch) => batch.pages);
  assert.deepEqual(result.coverage.untagged, later.map((page) => ({ page, reason: "deadline" })));
  assert.deepEqual(result.calls.tagger, { calls: PASS_INPUT.batches.length, answered: 1, failed: 0, deadline: PASS_INPUT.batches.length - 1, retried: 0 });
  assert.equal(port.sent.filter((item) => item.role === "pointer_tagger").length, 2, "nothing is sent after the deadline");
  assert.equal(port.sent.filter((item) => item.role === "pair_judge").length, 0);
  const firstEvents = PASS_INPUT.batches[0].pages.filter((page) => page <= 4).length;
  assert.deepEqual(result.event_check, { pairs: firstEvents, accepted: 0, rejected: 0, unanswered: firstEvents, tags_dropped: firstEvents });
  assert.equal(result.report.page_outcomes.deadline, later.length);
});

test("a coverage pass sends the untagged pages' batches again, changes only their tags, and its ledger is the generation's", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const first = await pass(port, clock);
  const pages = first.coverage.untagged.map((item) => item.page);
  assert.deepEqual(pages, [5]);
  const sentFirst = port.sent.length;
  const coverage = await pass(port, clock, { stepId: "pass:coverage", pages, first: { checked: first.checked, event_pairs: first.event_pairs,
    dropped_event_pairs: first.dropped_event_pairs } });
  const again = port.sent.slice(sentFirst);
  // Only page 5's batch goes to the tagger again; its other pages' tags are the first pass's, exactly.
  assert.deepEqual(again.map((item) => item.operationKey), [taggerKey(5, "pass:coverage")]);
  const batch = batchOfPage(5);
  for (const [index, result] of coverage.checked.entries()) {
    if (result.batch_id !== batch.batch_id) assert.deepEqual(result, first.checked[index]);
  }
  const page5 = coverage.checked.find((result) => result.batch_id === batch.batch_id).kept
    .filter((tag) => tag.anchors.some((anchor) => PASS_INPUT.unitsById.get(anchor.unit_id).page === 5));
  assert.deepEqual(page5.map((tag) => [tag.kind, tag.label]), [["topic", "concert"]]);
  assert.deepEqual(coverage.coverage.untagged, []);
  assert.equal(coverage.coverage.holds, true);
  // The dream's rejected pair was on the retried page, so the generation's event check holds only the four kept.
  assert.deepEqual(coverage.event_check, { pairs: 4, accepted: 4, rejected: 0, unanswered: 0, tags_dropped: 0 });
  assert.deepEqual(coverage.event_pairs, first.event_pairs.filter((entry) => entry.page !== 5));
  assert.deepEqual(coverage.dropped_event_pairs, []);
  assert.deepEqual(coverage.pages, [5]);
  await assert.rejects(pass(port, clock, { stepId: "pass:coverage", pages }), { code: "POINTER_STEP_INPUT_INVALID" });
  await assert.rejects(pass(port, clock, { stepId: "pass:coverage", pages, first: { checked: first.checked } }), { code: "POINTER_STEP_INPUT_INVALID" });
});

test("run again with the stored answers, a pass gives the same result and sends nothing new", async () => {
  const clock = { now: START };
  const { eventKeys } = expectedPass();
  const port = scriptedPort({ clock, script: { [taggerKey(1)]: "invalid", [eventKeys[0]]: "skip-last" } });
  const first = await pass(port, clock);
  const sentFirst = port.sent.length;
  clock.now = Date.parse(DEADLINE) + 60_000;
  const again = await pass(port, clock);
  assert.deepEqual(again, first);
  assert.equal(port.sent.length, sentFirst);
});

test("the pilot tags only pages drawn outside the reference sample, in batches of their own, and builds nothing", async () => {
  const quotes = PASS_INPUT.quotes;
  const reference = quotes.filter((quote) => [2, 9].includes(quote.page)).map((quote) => quote.unit_id);
  const draw = pointerPilotPages({ quotes, excludeUnitIds: reference, seed: "pilot-seed", count: 4 });
  assert.equal(draw.candidate_pages, PASS_PAGES - 2);
  assert.equal(draw.pages.length, 4);
  assert.ok(draw.pages.every((page) => page !== 2 && page !== 9));
  assert.deepEqual(draw.pages, [...draw.pages].sort((a, b) => a - b), "journal order");
  assert.deepEqual(pointerPilotPages({ quotes, excludeUnitIds: reference, seed: "pilot-seed", count: 4 }), draw, "the same seed, the same pages");
  assert.equal(draw.seed_sha256.length, 64);
  assert.equal(JSON.stringify(draw).includes("pilot-seed"), false);
  assert.equal(pointerPilotPages({ quotes, excludeUnitIds: [], seed: "s" }).pages.length, PASS_PAGES, "fewer pages than a pilot: all of them");
  assert.equal(POINTER_PILOT_PAGES, 20);

  const clock = { now: START };
  const port = scriptedPort({ clock });
  const pilot = await runPointerPilot({ quoteGeneration: QUOTE_GENERATION, excludeUnitIds: reference, seed: "pilot-seed", count: 4, stepId: "pilot:synthetic",
    deadline: DEADLINE, port, grant: passGrant, now: () => new Date(clock.now), maxBytes: BATCH_BYTES });
  assert.deepEqual(pilot.pages, draw.pages);
  const sentUnits = port.sent.filter((item) => item.role === "pointer_tagger").flatMap((item) => item.packet.quote_units);
  assert.deepEqual([...new Set(sentUnits.map((unit) => unit.page))].sort((a, b) => a - b), draw.pages);
  assert.equal(pilot.report.pages_with_quotes, 4);
  assert.equal("built" in pilot || "checked" in pilot, false);
  assert.equal(pilot.calls.tagger.answered, pilot.calls.tagger.calls);
  const shown = JSON.stringify(pilot);
  for (const word of ["Jean", "marché", "concert"]) assert.equal(shown.includes(word), false);
});
