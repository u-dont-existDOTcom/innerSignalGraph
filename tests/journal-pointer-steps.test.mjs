import test from "node:test";
import assert from "node:assert/strict";
import { JournalInferencePortError, buildJournalRolePacket } from "../src/journal-import/provider-port.mjs";
import { validateJournalSchema } from "../src/journal-import/contracts.mjs";
import { pointerCallKey } from "../src/journal-import/pointer-calls.mjs";
import { pointerReferenceSample } from "../src/journal-import/pointer-reference.mjs";
import { pointerReferenceCounts, runPointerReference } from "../src/journal-import/pointer-steps.mjs";

// The reference step in rounds of deadline-bound calls (plan 2026-10-09-journal-quote-first.md, Part 3). A scripted
// port stands in for the models; all text is invented.

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

// Answers each role from its packet, as the exchange would after its schema check. `script` changes single answers: by
// the writer's call key, by "tier:quote" for a coverage judge (round 0 only, unless the entry says "always"), and by the
// search call key. "open" holds its call until the deadline.
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
    if (custom === "invalid") throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" });
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
        const output = answer(request);
        let valid;
        try { valid = validateJournalSchema(request.outputSchema, output); }
        catch { throw new JournalInferencePortError("INVALID_STRUCTURED_OUTPUT", { submissionStatus: "completed_invalid" }); }
        answers.set(request.operationKey, { output: valid, at: new Date(clock.now).toISOString() });
      }
      const stored = answers.get(request.operationKey);
      return { output: stored.output, receipt: receipt(stored) };
    },
    async getCompletion(operationKey) {
      if (!answers.has(operationKey)) return { status: sent.some((item) => item.operationKey === operationKey) ? "unknown" : "not_submitted" };
      const stored = answers.get(operationKey);
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
