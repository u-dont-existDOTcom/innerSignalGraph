import test from "node:test";
import assert from "node:assert/strict";
import { JournalInferencePortError, buildJournalRolePacket } from "../src/journal-import/provider-port.mjs";
import { validateJournalSchema } from "../src/journal-import/contracts.mjs";
import { pointerCallKey } from "../src/journal-import/pointer-calls.mjs";
import { applyPointerEventCheck, checkPointerBatches, pointerEventCheckCalls, pointerEventPairs, pointerPassInput,
  pointerTaggerPacket } from "../src/journal-import/pointer-pass.mjs";
import { pointerChallengeUnits, pointerReferenceSample } from "../src/journal-import/pointer-reference.mjs";
import { POINTER_MEASURE_SAMPLE_NAMES, POINTER_PILOT_PAGES, POINTER_RECALL_TOP, measurePointerChallenge, measurePointerRecall, pointerBrokenAnchors,
  pointerMeasureSamples, pointerPilotPages, pointerRecallReach, pointerReferenceCounts, runPointerMeasure, runPointerPass, runPointerPilot,
  runPointerReference, runPointerSearchCheck } from "../src/journal-import/pointer-steps.mjs";
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
    if (unit.text.includes("plu ")) tags.push({ kind: "topic", label: "pluie", anchors: [anchor("plu")] });
  }
  return { schema_version: "1.0", tags };
}

// A judge that knows a dream is no event.
const judgment = (pair) => ({ pair_id: pair.pair_id, mentions: true, kind_right: !(pair.kind === "event" && pair.quote.includes("rêvais")) });

// Answers each role from its packet, as the exchange would after its schema check, and keeps an invalid answer as
// invalid. `script` changes single answers: by the writer's call key, by "tier:quote" for a coverage judge ("once" for
// round 0 only, "always" for both, each holding the quote back as left out; "copied:once", "combined:always",
// "repeated:once" and the like flag its first question for that reason instead; a writer's "copy" asks each quote in its
// own words), by the search call key, and by the
// tagger's or pair judge's call key
// ("skip-last" leaves out a judgment, "foreign" adds one for a pair the call doesn't hold). "open" holds its call
// until the deadline, "invalid" answers with no valid output, and "closed" closes its item unanswered, a close that
// reads back later as a record from before the store said when it was seen.
function scriptedPort({ clock, script = {} }) {
  const sent = [];
  const answers = new Map();
  const answer = (request) => {
    const packet = buildJournalRolePacket(request.role, request.packet);
    const custom = script[request.operationKey];
    if (request.role === "pointer_tagger") return taggerAnswer(packet, request.operationKey);
    if (request.role === "pair_judge") {
      const judgments = packet.pairs.map(judgment);
      if (custom === "skip-last") judgments.pop();
      if (custom === "foreign") judgments.push({ pair_id: "event-pair:foreign", mentions: true, kind_right: true });
      return { schema_version: "1.0", judgments };
    }
    if (request.role === "question_writer") {
      const quotes = custom === "skip-last" ? packet.quote_units.slice(0, -1) : packet.quote_units;
      // "copy" asks each quote in its own words.
      return { schema_version: "1.0", questions: quotes.map((quote, index) => ({ unit_id: quote.unit_id,
        question: custom === "copy" ? quote.text : `What happened in the synthetic paragraph ${quote.unit_id}?`, critical: index === 0,
        event: index % 2 === 0 })) };
    }
    if (request.role === "coverage_judge") {
      const round = Number(request.operationKey.split(":coverage:")[1].split(":")[0]);
      return { schema_version: "1.0", judgments: packet.quotes.map((quote) => {
        const rule = script[`${request.tier}:${quote.unit_id}`] ?? "";
        const [reason, when] = rule.includes(":") ? rule.split(":") : ["left_out", rule];
        const unconfirmed = when === "always" || (when === "once" && round === 0);
        const flagged = (kind) => (unconfirmed && reason === kind ? [quote.questions[0].question_id] : []);
        return { unit_id: quote.unit_id, covered: !(unconfirmed && reason === "left_out"),
          missing: unconfirmed ? `${request.tier} judge: ${reason === "left_out" ? "something is missing" : `a question is ${reason}`}` : "",
          critical_question_ids: [], event_question_ids: request.tier === "hardest" ? quote.questions.map((question) => question.question_id) : [],
          repeated_question_ids: flagged("repeated"), combined_question_ids: flagged("combined"), copied_question_ids: flagged("copied") };
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
      // An open call's wait runs alongside the others' and ends at the deadline.
      if (script[request.operationKey] === "open") {
        await new Promise((resolve) => { setImmediate(resolve); });
        clock.now = Math.max(clock.now, Date.parse(request.expiresAt));
        throw new JournalInferencePortError("COMPLETION_UNKNOWN", { submissionStatus: "unknown" });
      }
      if (script[request.operationKey] === "closed") {
        answers.set(request.operationKey, { closed: true });
        throw new JournalInferencePortError("JOURNAL_WORK_EXPIRED", { submissionStatus: "not_submitted" });
      }
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
      if (stored.closed) return { status: "not_submitted", code: "JOURNAL_WORK_EXPIRED" };
      if (stored.invalid) return { status: "invalid_output" };
      return { status: "completed", output: stored.output, receipt: receipt(stored) };
    },
    async wasSent(operationKey) { return sent.some((item) => item.operationKey === operationKey); }
  };
}

const NONE_HELD_BACK = Object.freeze({ checks: 0, left_out: 0, repeated: 0, combined: 0, copied: 0 });
const NO_COPYING = Object.freeze({ checks: 0, codex_confirmed: 0, claude_confirmed: 0, both_confirmed: 0, copied_by_code: 0 });

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
  assert.deepEqual(pointerReferenceCounts(reference), { sampled_units: 30, complete_units: 30, unconfirmed_units: 0, nonresponse_units: 0,
    nonresponse_by_reason: { questions_incomplete: 0, coverage_unconfirmed: 0, coverage_check_failed: 0, searches_incomplete: 0, deadline: 0 },
    deadline_units_with_a_call_unanswered: 0, units_retried: 0, questions: 45, critical_questions: 30, event_questions: 45,
    unconfirmed_questions: 0, unconfirmed_critical_questions: 0,
    judges: { codex_confirmed: 45, claude_confirmed: 45,
      agreement: { items: 45, agreements: 45, disagreements: 0, raw_agreement: 1, kappa: null },
      held_back: { codex: NONE_HELD_BACK, claude: NONE_HELD_BACK, codex_only: NONE_HELD_BACK, claude_only: NONE_HELD_BACK },
      by_round: [{ ...NO_COPYING, checks: 45, codex_confirmed: 45, claude_confirmed: 45, both_confirmed: 45 }, NO_COPYING],
      copying_flagged: { codex: 0, claude: 0 } },
    // Each question shares two words in a row with its quote ("synthetic paragraph"), far below the run that copies.
    copy_check: { run_words: 8, questions: 45, copying: 0, longest_run: { 2: 45 } } });
  assert.equal(JSON.stringify(pointerReferenceCounts(reference)).includes("Synthetic"), false);
  // A reference stored before the judges' agreement was counted reports none, and one stored before the copy check none
  // of its counts.
  const { judges, copy_check: copyCheck, ...older } = reference;
  assert.deepEqual([pointerReferenceCounts(older).judges, pointerReferenceCounts(older).copy_check], [null, null]);
});

test("a unit either judge leaves unconfirmed gets its one retry with that judge's notes, and if it falls short again counts as missed", async () => {
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
  // Still unconfirmed after the retry (owner decision 30): the retry's questions are kept, with no searches, and count
  // in recall with every one missed.
  const fifth = byPage.get("page:5");
  assert.deepEqual([fifth.status, fifth.reason, fifth.writer_attempts], ["unconfirmed", null, 2]);
  assert.deepEqual(fifth.questions.map((question) => [question.unit_id, "queries" in question]), [["unit:p5q0", false], ["unit:p5q1", false]]);
  assert.match(fifth.questions[0].question_id, /^question:\d+:1:0$/u);
  assert.equal(port.sent.filter((item) => item.role === "search_writer" && item.operationKey === searchKey(5)).length, 0, "no searches for it");
  // An incomplete first answer (a quote without a question) uses the same one retry, without notes.
  const seventh = byPage.get("page:7");
  assert.deepEqual([seventh.status, seventh.writer_attempts], ["complete", 2]);
  assert.equal(port.sent.filter((item) => item.operationKey === writerKey(7, 1) && !item.packet.coverage_notes).length, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(pointerReferenceCounts(reference)).filter(([name]) => ["complete_units", "unconfirmed_units",
    "nonresponse_units", "units_retried", "unconfirmed_questions", "unconfirmed_critical_questions"].includes(name))),
  { complete_units: 29, unconfirmed_units: 1, nonresponse_units: 0, units_retried: 3, unconfirmed_questions: 2, unconfirmed_critical_questions: 1 });
  // The judges disagree on unit:p3q0 in the first round (Codex leaves it unconfirmed once) and on unit:p5q1 in both
  // rounds (Claude never confirms it); every other quote both judged, they both confirmed.
  const { judges } = pointerReferenceCounts(reference);
  assert.equal(judges.agreement.disagreements, 3);
  assert.deepEqual([judges.agreement.items - judges.codex_confirmed, judges.agreement.items - judges.claude_confirmed], [1, 2]);
  assert.equal(judges.agreement.agreements, judges.agreement.items - 3);
  const leftOut = (checks) => ({ ...NONE_HELD_BACK, checks, left_out: checks });
  assert.deepEqual(judges.held_back, { codex: leftOut(1), claude: leftOut(2), codex_only: leftOut(1), claude_only: leftOut(2) });
  assert.deepEqual(judges.by_round.map((round) => round.checks).reduce((sum, checks) => sum + checks), judges.agreement.items);
  assert.deepEqual(judges.by_round.map((round) => round.checks - round.both_confirmed), [2, 1]);
});

test("the judges' reasons for holding a quote back are counted by kind, for each judge and where only one held back", async () => {
  const clock = { now: START };
  // In the first round Codex flags a combined question on page 9's first quote and a copied one on page 3's, while Claude
  // finds something left out on page 9's and a repeated question on page 11's second quote. A copied flag holds nothing
  // back now (owner decision 30: code checks copying), so page 3 is confirmed at once. The rewrites pass both judges.
  const port = scriptedPort({ clock, script: { "standard:unit:p3q0": "copied:once", "standard:unit:p9q0": "combined:once",
    "hardest:unit:p9q0": "once", "hardest:unit:p11q1": "repeated:once" } });
  const reference = await run(port, clock);
  assert.ok(reference.units.every((unit) => unit.status === "complete"));
  assert.equal(reference.units.find((unit) => unit.unit_id === "page:3").writer_attempts, 1);
  const { judges } = pointerReferenceCounts(reference);
  assert.deepEqual(judges.held_back, {
    codex: { checks: 1, left_out: 0, repeated: 0, combined: 1, copied: 0 },
    claude: { checks: 2, left_out: 1, repeated: 1, combined: 0, copied: 0 },
    codex_only: NONE_HELD_BACK,
    claude_only: { checks: 1, left_out: 0, repeated: 1, combined: 0, copied: 0 } });
  // 45 quotes in the first round; pages 9 and 11, two quotes each, again in the second.
  assert.deepEqual(judges.by_round, [{ ...NO_COPYING, checks: 45, codex_confirmed: 44, claude_confirmed: 43, both_confirmed: 43 },
    { ...NO_COPYING, checks: 4, codex_confirmed: 4, claude_confirmed: 4, both_confirmed: 4 }]);
  assert.deepEqual([judges.codex_confirmed, judges.claude_confirmed, judges.agreement.items], [48, 47, 49]);
  // Codex's copying flag, which held nothing back, is still counted.
  assert.deepEqual(judges.copying_flagged, { codex: 1, claude: 0 });
  assert.equal(JSON.stringify(judges).includes("Synthetic"), false);
});

test("code holds back a quote whose question copies a run of its words, and a unit copying again after its retry counts as missed", async () => {
  const clock = { now: START };
  // Page 5's writer asks each quote in the quote's own words, both times; page 7's only the first time. A quote here is
  // six words, so this run copies at five.
  const port = scriptedPort({ clock, script: { [writerKey(5)]: "copy", [writerKey(5, 1)]: "copy", [writerKey(7)]: "copy" } });
  const reference = await run(port, clock, { copyRunWords: 5 });
  const byPage = new Map(reference.units.map((unit) => [unit.unit_id, unit]));
  assert.deepEqual([byPage.get("page:5").status, byPage.get("page:5").writer_attempts], ["unconfirmed", 2]);
  assert.deepEqual([byPage.get("page:7").status, byPage.get("page:7").writer_attempts], ["complete", 2]);
  // The retry's note names the run, and goes only into the writer's packet.
  const retry = port.sent.find((item) => item.operationKey === writerKey(7, 1));
  assert.deepEqual(retry.packet.coverage_notes, [{ unit_id: "unit:p7q0", missing: "Code check: a question repeats 6 of this quote's words in a row "
    + "(\"synthetic paragraph 0 of page 7\"). Ask about the same thing in other words, the way a person might later ask." },
  { unit_id: "unit:p7q1", missing: "Code check: a question repeats 6 of this quote's words in a row (\"synthetic paragraph 1 of page 7\"). Ask "
    + "about the same thing in other words, the way a person might later ask." }]);
  const counts = pointerReferenceCounts(reference);
  // Pages 5 and 7 copy in the first round (two quotes each), page 5 again in the second; the judges confirmed them all.
  assert.deepEqual(counts.judges.by_round.map((round) => round.copied_by_code), [4, 2]);
  assert.deepEqual(counts.copy_check, { run_words: 5, questions: 49, copying: 6, longest_run: { 2: 43, 6: 6 } });
  assert.deepEqual(counts.judges.held_back.codex, NONE_HELD_BACK, "the judges held nothing back: the code did");
  assert.equal(JSON.stringify(counts).includes("ynthetic"), false);
  // Without the check (a run from before it), nothing copies.
  const earlier = { now: START };
  const before = await run(scriptedPort({ clock: earlier, script: { [writerKey(5)]: "copy" } }), earlier, { copyRunWords: null });
  assert.equal(before.units.find((unit) => unit.unit_id === "page:5").status, "complete");
  assert.deepEqual(pointerReferenceCounts(before).copy_check, { run_words: null, questions: 45, copying: 0, longest_run: { 2: 43, 6: 2 } });
});

test("a run from before owner decision 30 keeps its rules: a judge's copying flag holds a quote back, and a unit unconfirmed after its retry is a nonresponse", async () => {
  // Codex flags a copied question on page 3's first quote in the first round only; Claude on page 5's second quote in
  // both rounds.
  const script = { "standard:unit:p3q0": "copied:once", "hardest:unit:p5q1": "copied:always" };
  const clock = { now: START };
  const reference = await run(scriptedPort({ clock, script }), clock, { copyRunWords: null });
  const byPage = new Map(reference.units.map((unit) => [unit.unit_id, unit]));
  assert.deepEqual([byPage.get("page:3").status, byPage.get("page:3").writer_attempts], ["complete", 2]);
  const fifth = byPage.get("page:5");
  assert.deepEqual([fifth.status, fifth.reason, fifth.writer_attempts, fifth.questions], ["nonresponse", "coverage_unconfirmed", 2, []]);
  const counts = pointerReferenceCounts(reference);
  assert.deepEqual([counts.complete_units, counts.unconfirmed_units, counts.nonresponse_by_reason.coverage_unconfirmed], [29, 0, 1]);
  const copied = (checks) => ({ ...NONE_HELD_BACK, checks, copied: checks });
  assert.deepEqual(counts.judges.held_back, { codex: copied(1), claude: copied(2), codex_only: copied(1), claude_only: copied(2) });
  assert.deepEqual(counts.judges.copying_flagged, { codex: 1, claude: 2 });
  assert.deepEqual([counts.copy_check.run_words, counts.copy_check.copying], [null, 0]);
  // Under the rules since then, the same flags hold nothing back.
  const later = { now: START };
  const since = await run(scriptedPort({ clock: later, script }), later);
  assert.ok(since.units.every((unit) => unit.status === "complete" && unit.writer_attempts === 1));
});

test("under owner decision 32's rules Codex judges alone: a piece still not covered after its retry is marked and searched, any split is fine, and a copying question is flagged", async () => {
  const clock = { now: START };
  // Codex finds something left out of page 3's first quote in the first round only, and of page 5's second quote in both;
  // it lists a repeated question on page 9's first quote both times, which any way of splitting allows. Page 7's writer
  // asks each quote in the quote's own words.
  const port = scriptedPort({ clock, script: { "standard:unit:p3q0": "once", "standard:unit:p5q1": "always",
    "standard:unit:p9q0": "repeated:always", [writerKey(7)]: "copy" } });
  const slots = [];
  const reference = await run(port, clock, { rules: 3, copyRunWords: 5, beforeHardestSend: async ({ operationKey }) => { slots.push(operationKey); } });
  assert.deepEqual([...new Set(port.sent.filter((item) => item.role === "coverage_judge").map((item) => item.tier))], ["standard"]);
  assert.equal(slots.length, 0, "no Claude call");
  const byPage = new Map(reference.units.map((unit) => [unit.unit_id, unit]));
  assert.deepEqual([byPage.get("page:3").status, byPage.get("page:3").writer_attempts], ["complete", 2]);
  // Still not covered after the retry: marked, with the retry's questions, and searched like a complete unit.
  const fifth = byPage.get("page:5");
  assert.deepEqual([fifth.status, fifth.reason, fifth.writer_attempts], ["marked", "coverage_unconfirmed", 2]);
  assert.match(fifth.questions[0].question_id, /^question:\d+:1:0$/u);
  assert.ok(fifth.questions.every((question) => question.queries.length > 0));
  assert.equal(port.sent.filter((item) => item.operationKey === searchKey(5)).length, 1);
  assert.deepEqual([byPage.get("page:9").status, byPage.get("page:9").writer_attempts], ["complete", 1]);
  // The copying questions are kept, flagged, and send nothing back to the writer.
  const seventh = byPage.get("page:7");
  assert.deepEqual([seventh.status, seventh.writer_attempts, seventh.questions.map((question) => question.copied)], ["complete", 1, [true, true]]);
  assert.ok(reference.units.filter((unit) => unit.unit_id !== "page:7").every((unit) => unit.questions.every((question) => !("copied" in question))));
  const counts = pointerReferenceCounts(reference);
  assert.deepEqual([counts.complete_units, counts.marked_units, counts.unconfirmed_units, counts.nonresponse_units], [29, 1, 0, 0]);
  assert.deepEqual([counts.marked_questions, counts.copying_questions_flagged, counts.marked_by_reason], [2, 2, { coverage_unconfirmed: 1 }]);
  // One judge: Claude's counts are null; 45 quotes in the first round, pages 3 and 5 (two quotes each) in the second.
  assert.deepEqual(counts.judges, { codex_confirmed: 46, claude_confirmed: null, agreement: null,
    held_back: { codex: { checks: 3, left_out: 3, repeated: 0, combined: 0, copied: 0 }, claude: null, codex_only: null, claude_only: null },
    by_round: [{ checks: 45, codex_confirmed: 43, claude_confirmed: null, both_confirmed: null, copied_by_code: 2 },
      { checks: 4, codex_confirmed: 3, claude_confirmed: null, both_confirmed: null, copied_by_code: 0 }],
    copying_flagged: { codex: 0, claude: null } });
  assert.equal(JSON.stringify(counts).includes("ynthetic"), false);
  // Run again with the stored answers: the same reference, and nothing new sent.
  const sent = port.sent.length;
  clock.now = Date.parse(DEADLINE) + 60_000;
  assert.deepEqual(await run(port, clock, { rules: 3, copyRunWords: 5 }), reference);
  assert.equal(port.sent.length, sent);
  // Rules a run can't have, or owner decision 32's without the copy check, are refused before anything is sent.
  await assert.rejects(run(port, clock, { rules: 4 }), { code: "POINTER_STEP_INPUT_INVALID" });
  await assert.rejects(run(port, clock, { rules: 3, copyRunWords: null }), { code: "POINTER_STEP_INPUT_INVALID" });
});

test("under owner decision 32's rules a judge's call with no usable answer marks its pieces, which are still searched", async () => {
  const clock = { now: START };
  const key = "reference:synthetic:coverage:0:standard:0";
  const port = scriptedPort({ clock, script: { [key]: "invalid", [pointerCallKey(key, 1)]: "invalid" } });
  const reference = await run(port, clock, { rules: 3 });
  const failedQuotes = new Set(port.sent.find((item) => item.operationKey === key).packet.quotes.map((quote) => quote.unit_id));
  const failedUnits = reference.units.filter((unit) => unit.quote_ids.some((id) => failedQuotes.has(id)));
  assert.ok(failedUnits.length > 0 && failedUnits.length < reference.units.length);
  for (const unit of failedUnits) {
    assert.deepEqual([unit.status, unit.reason, unit.writer_attempts], ["marked", "coverage_check_failed", 1]);
    // Its questions as the writer marked them, each with its searches.
    assert.ok(unit.questions.every((question) => question.queries.length > 0 && question.event === (Number(question.question_id.split(":").at(-1)) % 2 === 0)));
  }
  assert.ok(reference.units.filter((unit) => !failedUnits.includes(unit)).every((unit) => unit.status === "complete"));
  const counts = pointerReferenceCounts(reference);
  assert.deepEqual([counts.marked_units, counts.nonresponse_units, counts.marked_by_reason], [failedUnits.length, 0,
    { coverage_check_failed: failedUnits.length }]);
  // Under owner decision 30's rules the same failure is a nonresponse.
  const before = { now: START };
  const older = await run(scriptedPort({ clock: before, script: { [key]: "invalid", [pointerCallKey(key, 1)]: "invalid" } }), before);
  assert.ok(older.units.filter((unit) => unit.quote_ids.some((id) => failedQuotes.has(id)))
    .every((unit) => unit.status === "nonresponse" && unit.reason === "coverage_check_failed"));
});

test("read back after the deadline, a writer item that closed in time leads to its unit's next round, as it did", async () => {
  const clock = { now: START };
  // Page 9's first writer item closes unanswered: the call fails, and the unit's second round writes its questions.
  const port = scriptedPort({ clock, script: { [writerKey(9)]: "closed" } });
  const first = await run(port, clock);
  const ninth = first.units.find((unit) => unit.unit_id === "page:9");
  assert.deepEqual([ninth.status, ninth.writer_attempts], ["complete", 2]);
  // The record of that close doesn't say when it was seen, but the unit's next round was sent, so it was seen in time.
  clock.now = Date.parse(DEADLINE) + 60_000;
  const sent = port.sent.length;
  const again = await run(port, clock);
  assert.deepEqual(again, first);
  assert.equal(port.sent.length, sent);
  assert.equal("closes_inferred" in again, false);
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
  // Every batch went out at once; the others answered, and the open one kept the step waiting until the deadline.
  assert.deepEqual(result.coverage.untagged, second.pages.map((page) => ({ page, reason: "deadline" })));
  assert.deepEqual(result.calls.tagger, { calls: PASS_INPUT.batches.length, answered: PASS_INPUT.batches.length - 1, failed: 0, deadline: 1, retried: 0 });
  assert.equal(port.sent.filter((item) => item.role === "pointer_tagger").length, PASS_INPUT.batches.length);
  assert.equal(port.sent.filter((item) => item.role === "pair_judge").length, 0, "nothing is sent after the deadline");
  const events = PASS_INPUT.units.filter((unit) => unit.text.includes("concert") && !second.pages.includes(unit.page)).length;
  assert.ok(events > 0);
  assert.deepEqual(result.event_check, { pairs: events, accepted: 0, rejected: 0, unanswered: events, tags_dropped: events });
  assert.equal(result.report.page_outcomes.deadline, second.pages.length);
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

test("in a journal without pages, the sample, the pilot and the pass all count stretches, so the sample closes only its own", () => {
  // One plain-text representation of 60 paragraphs of about 280 bytes: stretches of about 14 paragraphs.
  const text = Array.from({ length: 60 }, (_, index) => `Paragraphe ${index} ${"sur la longue marche de Jean au bord du lac ".repeat(6)}`.trim())
    .join("\n\n");
  const generation = { ...QUOTE_GENERATION, mediaType: "text/plain",
    representations: [{ representation_id: "steps:text", text, page_number: null, parse_status: "readable" }] };
  const input = pointerPassInput({ built: buildQuoteGeneration(generation), maxBytes: BATCH_BYTES });
  assert.equal(input.quotes.length, 60);
  assert.ok(input.quotes.every((quote) => quote.page === null && Number.isSafeInteger(quote.pageless_stretch)));
  const stretches = [...new Set(input.quotes.map((quote) => quote.pageless_stretch))];
  assert.deepEqual(stretches, [...stretches.keys()], "stretches in order from 0");
  assert.ok(stretches.length >= 4);
  // The sample's units are the same stretches: excluding the quotes of two of them closes exactly those two.
  const sample = pointerReferenceSample({ units: input.units, seed: "synthetic-seed" });
  assert.equal(sample.candidate_units, stretches.length);
  const excluded = sample.units.slice(0, 2).flatMap((unit) => unit.quote_ids);
  const draw = pointerPilotPages({ quotes: input.quotes, excludeUnitIds: excluded, seed: "pilot-seed" });
  assert.equal(draw.candidate_pages, stretches.length - 2);
  assert.equal(draw.pages.length, stretches.length - 2);
  const closed = new Set(input.quotes.filter((quote) => excluded.includes(quote.unit_id)).map((quote) => quote.pageless_stretch));
  assert.ok(draw.pages.every((page) => /^steps:text#\d{6}$/u.test(page) && !closed.has(Number(page.slice(-6)))));
  // Batches hold whole stretches, as they hold whole pages.
  for (const batch of input.batches) assert.ok(batch.pages.every((page) => typeof page === "string" && page.startsWith("steps:text#")));
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

// A reference for the pass's journal, as the reference step leaves it: the sample drawn from its quotes in 3 stretches
// of 2 pages, and for each quote one question with one search. The market and concert questions search their quote's
// own words, the dream's too; the rain question searches "pluie", which only the rain quotes' tags hold.
const MEASURE_SAMPLE = pointerReferenceSample({ units: PASS_INPUT.units, seed: "measure-seed", strata: 3, unitsPerStratum: 2 });
function questionFor(unit, index) {
  const base = { question_id: `question:${index}`, unit_id: unit.unit_id };
  if (unit.text.includes("marché")) return { ...base, question: "Who went to the market?", critical: false, event: false, queries: ["marché"] };
  if (unit.text.includes("rêvais")) return { ...base, question: "What did they dream of?", critical: true, event: false, queries: ["plage"] };
  if (unit.text.includes("concert")) return { ...base, question: "What happened last night?", critical: true, event: true, queries: ["concert"] };
  return { ...base, question: "What was the weather like?", critical: false, event: false, queries: ["pluie"] };
}
const REFERENCE = Object.freeze({ units: MEASURE_SAMPLE.units.map((unit) => ({ unit_id: unit.unit_id, stratum: unit.stratum,
  inclusion_probability: unit.inclusion_probability, quote_ids: unit.quote_ids, status: "complete", reason: null,
  questions: unit.quote_ids.map((quoteId) => questionFor(PASS_INPUT.unitsById.get(quoteId), quoteId)) })) });

// Search as find_journal_quotes ranks it, simplified: quotes holding a query word, in journal order, then, with tags,
// quotes found only by a topic or event label.
function searchOn(result) {
  return async ({ query, matchTags }) => {
    const word = query.toLowerCase();
    const byWords = PASS_INPUT.units.filter((unit) => unit.text.toLowerCase().includes(word)).map((unit) => PASS_INPUT.passageIdForUnit(unit.unit_id));
    if (!matchTags) return byWords;
    const byTags = [...result.indexes.quote_tags].filter(([, tags]) => tags.some((tag) => ["topic", "event"].includes(tag.kind)
      && tag.label.toLowerCase().includes(word))).map(([passageId]) => passageId).filter((passageId) => !byWords.includes(passageId));
    return [...byWords, ...byTags];
  };
}

const measure = (port, clock, result, extra = {}) => runPointerMeasure({ quoteGeneration: QUOTE_GENERATION, pass: result, reference: REFERENCE,
  search: searchOn(result), seed: "precision-seed", stepId: "measure:synthetic", deadline: DEADLINE, port,
  grant: Object.freeze({ ...grant, allowed_roles: ["pair_judge"] }), now: () => new Date(clock.now), ...extra });

// The pass, then the coverage pass that tags page 5 again.
async function coveredPass(port, clock) {
  const first = await pass(port, clock);
  const second = await pass(port, clock, { stepId: "pass:coverage", pages: first.coverage.untagged.map((item) => item.page),
    first: { checked: first.checked, event_pairs: first.event_pairs, dropped_event_pairs: first.dropped_event_pairs } });
  return { first, second };
}

test("the measurement scores the generation against every floor: recall by its searches, both judges on each kind's sample", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const { second } = await coveredPass(port, clock);
  const sentBefore = port.sent.length;
  const slots = [];
  const result = await measure(port, clock, second, { beforeHardestSend: async ({ operationKey }) => { slots.push(operationKey); } });
  assert.equal(result.publish, true);
  assert.ok(Object.values(result.floors).every((floor) => floor.holds));
  // Every question is found with tags; the rain questions only through their tags, so words alone miss them.
  const rain = REFERENCE.units.flatMap((unit) => unit.questions).filter((question) => question.queries[0] === "pluie").length;
  assert.ok(rain > 0);
  assert.equal(result.floors.recall.estimate, 1);
  assert.ok(result.floors.no_loss.recall_words_only_estimate < 1);
  assert.deepEqual([result.floors.gain.applicable, result.floors.gain.estimate], [true, 1]);
  assert.deepEqual([result.floors.critical_recall.applicable, result.floors.critical_recall.estimate], [true, 1]);
  assert.deepEqual([result.floors.event_coverage.applicable, result.floors.event_coverage.estimate], [true, 1]);
  // Each kind's sample is judged in full here, both judges in calls of their own, and every pair is correct.
  const judged = port.sent.slice(sentBefore);
  assert.ok(judged.every((item) => item.role === "pair_judge" && item.expiresAt === DEADLINE));
  assert.deepEqual(judged.map((item) => item.operationKey), ["standard", "hardest"].flatMap((tier) => ["person", "topic", "event"]
    .map((name) => `measure:synthetic:judge:${tier}:${name}:0`)));
  assert.equal(slots.length, 3, "each Claude call counts one daily slot");
  assert.deepEqual(Object.keys(judged[0].packet.pairs[0]), ["pair_id", "kind", "label", "quote"]);
  assert.match(judged[0].packet.pairs[0].pair_id, /^measure-pair:[0-9a-f]{32}$/);
  const counts = Object.fromEntries(result.report.samples.map((sample) => [sample.name, [sample.pairs, sample.sampled, sample.correct]]));
  assert.deepEqual(counts, { person: [11, 11, 11], place: [0, 0, 0], organization: [0, 0, 0], topic: [19, 19, 19], event: [4, 4, 4],
    dropped_events: [0, 0, 0] });
  assert.deepEqual(result.floors.precision.topic.census, true);
  assert.deepEqual([result.report.agreement.items, result.report.agreement.disagreements], [34, 0]);
  assert.deepEqual(result.report.calls, { calls: 6, answered: 6, failed: 0, deadline: 0, retried: 0 });
  assert.equal(result.floors.anchors.broken, 0);
  // The report holds counts; the samples hold what the judges saw, for the private store only.
  const shown = JSON.stringify({ floors: result.floors, report: result.report });
  for (const word of ["Jean", "marché", "concert", "pluie", "plage"]) assert.equal(shown.includes(word), false);
  assert.equal(result.samples.find((sample) => sample.name === "person").items[0].label, "Jean");
  assert.deepEqual(POINTER_MEASURE_SAMPLE_NAMES, ["person", "place", "organization", "topic", "event", "dropped_events"]);
  assert.equal(POINTER_RECALL_TOP, 12);
});

test("the first pass's measurement judges the event pairs its check dropped, and its untagged page fails coverage", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const first = await pass(port, clock);
  const result = await measure(port, clock, first);
  const dropped = result.report.samples.find((sample) => sample.name === "dropped_events");
  assert.deepEqual([dropped.pairs, dropped.sampled, dropped.real], [1, 1, 0], "both judges reject the dream as an event");
  assert.deepEqual([result.floors.event_check_recall.applicable, result.floors.event_check_recall.estimate], [true, 1]);
  assert.equal(result.floors.coverage.holds, false);
  assert.equal(result.publish, false);
  assert.deepEqual(Object.entries(result.floors).filter(([, floor]) => !floor.holds).map(([name]) => name), ["coverage"]);
  assert.ok(port.sent.some((item) => item.operationKey === "measure:synthetic:judge:hardest:dropped_events:0"));
});

test("a pair a judge leaves unscored at the deadline counts as wrong, and as real among the dropped", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const { first, second } = await coveredPass(port, clock);
  const open = { now: START };
  const opened = scriptedPort({ clock: open, script: { "measure:synthetic:judge:hardest:topic:0": "open" } });
  const result = await measure(opened, open, second);
  const topic = result.report.samples.find((sample) => sample.name === "topic");
  assert.deepEqual([topic.correct, topic.unscored_claude, topic.unscored_codex], [0, 19, 0]);
  const event = result.report.samples.find((sample) => sample.name === "event");
  assert.deepEqual([event.correct, event.unscored_claude], [4, 0], "the other calls went out at once and were answered");
  assert.equal(result.floors.precision.holds, false);
  assert.equal(result.publish, false);
  assert.deepEqual([result.report.calls.deadline, result.report.calls.answered], [1, 5]);
  // Among the dropped, a pair one judge leaves unscored counts as real.
  const lateClock = { now: START };
  const late = scriptedPort({ clock: lateClock, script: { "measure:synthetic:judge:hardest:dropped_events:0": "open" } });
  const lateResult = await measure(late, lateClock, first);
  const dropped = lateResult.report.samples.find((sample) => sample.name === "dropped_events");
  assert.deepEqual([dropped.real, dropped.unscored_claude], [1, 1]);
  assert.equal(lateResult.floors.event_check_recall.estimate, 0.8);
});

test("run again with the stored answers, the measurement gives the same result and sends nothing new", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const { second } = await coveredPass(port, clock);
  const result = await measure(port, clock, second);
  const sent = port.sent.length;
  clock.now = Date.parse(DEADLINE) + 60_000;
  assert.deepEqual(await measure(port, clock, second), result);
  assert.equal(port.sent.length, sent);
});

test("recall is measured over every sampled unit, and a floor with nothing to measure says so", () => {
  const all = new Set(REFERENCE.units.flatMap((unit) => unit.questions.map((question) => question.question_id)));
  const none = new Set();
  const events = new Set(PASS_INPUT.units.map((unit) => unit.unit_id));
  const full = measurePointerRecall({ reference: REFERENCE, foundWithTags: all, foundWordsOnly: all, eventTaggedUnitIds: events });
  assert.deepEqual([full.recall_estimate, full.gain, full.critical_recall_estimate], [1, null, 1], "word search misses nothing: no gain to measure");
  const missed = measurePointerRecall({ reference: REFERENCE, foundWithTags: none, foundWordsOnly: none, eventTaggedUnitIds: new Set() });
  assert.deepEqual([missed.recall_estimate, missed.gain.estimate, missed.event_coverage.estimate], [0, 0, 0]);
  const plain = { units: REFERENCE.units.map((unit) => ({ ...unit, questions: unit.questions.map((question) => ({ ...question, critical: false, event: false })) })) };
  const flat = measurePointerRecall({ reference: plain, foundWithTags: all, foundWordsOnly: none, eventTaggedUnitIds: events });
  assert.deepEqual([flat.critical_recall, flat.critical_recall_estimate, flat.critical_recall_words_only_estimate, flat.event_coverage], [null, null, null, null]);
  assert.equal(full.units.length, REFERENCE.units.length);
  assert.deepEqual(Object.keys(full.units[0]), ["unit_id", "status", "questions", "found_with_tags", "found_words_only", "critical_questions",
    "event_quotes"]);
  // An unconfirmed unit (owner decision 30) counts with every question missed, and none of its event quotes covered,
  // whatever the found sets say; it is never searched.
  const [first, ...rest] = REFERENCE.units;
  const withUnconfirmed = { units: [{ ...first, status: "unconfirmed", questions: first.questions.map(({ queries, ...question }) => question) }, ...rest] };
  const counted = measurePointerRecall({ reference: withUnconfirmed, foundWithTags: all, foundWordsOnly: none, eventTaggedUnitIds: events });
  assert.deepEqual(counted.units[0], { unit_id: first.unit_id, status: "unconfirmed", questions: first.questions.length, found_with_tags: 0,
    found_words_only: 0, critical_questions: first.questions.filter((question) => question.critical).length,
    event_quotes: new Set(first.questions.filter((question) => question.event).map((question) => question.unit_id)).size });
  assert.ok(counted.recall_estimate < 1 && counted.gain.estimate === counted.recall_estimate);
  const asked = REFERENCE.units.reduce((sum, unit) => sum + unit.questions.length / unit.inclusion_probability, 0);
  assert.ok(Math.abs(counted.recall_estimate - (1 - first.questions.length / first.inclusion_probability / asked)) < 1e-12);
  const incomplete = { units: [{ ...REFERENCE.units[0], status: "nonresponse", questions: [] }, ...REFERENCE.units.slice(1)] };
  assert.throws(() => measurePointerRecall({ reference: incomplete, foundWithTags: all, foundWordsOnly: all, eventTaggedUnitIds: events }),
    { code: "POINTER_REFERENCE_INCOMPLETE" });
});

test("under owner decision 32's rules the measurement takes Codex's verdict alone, searches the marked units, leaves a unit without questions out, and reports the floors without blocking publication", async () => {
  const clock = { now: START };
  const port = scriptedPort({ clock });
  const first = await pass(port, clock);
  // The first unit is marked, the second got no questions, and the third's first question copies its quote.
  const [one, two, three, ...rest] = REFERENCE.units;
  const reference = { units: [{ ...one, status: "marked", reason: "coverage_unconfirmed" },
    { ...two, status: "nonresponse", reason: "questions_incomplete", questions: [] },
    { ...three, questions: three.questions.map((question, index) => (index === 0 ? { ...question, copied: true } : question)) }, ...rest] };
  const sentBefore = port.sent.length;
  const result = await measure(port, clock, first, { rules: 3, reference });
  const judged = port.sent.slice(sentBefore);
  assert.ok(judged.length > 0 && judged.every((item) => item.role === "pair_judge" && item.tier === "standard"));
  // The first pass leaves page 5 untagged, so its coverage floor fails, and still nothing blocks publication.
  assert.equal(result.floors.coverage.holds, false);
  assert.deepEqual([result.publish, result.floors_block], [true, false]);
  assert.equal(result.report.agreement, null);
  assert.ok(result.report.samples.every((sample) => sample.unscored_claude === null && sample.agreement === null));
  const dropped = result.report.samples.find((sample) => sample.name === "dropped_events");
  assert.deepEqual([dropped.pairs, dropped.real], [1, 0], "Codex rejects the dream as an event");
  assert.equal(result.report.unmeasured_units, 1);
  assert.deepEqual(result.report.recall_units.map((unit) => unit.unit_id), [one, three, ...rest].map((unit) => unit.unit_id));
  assert.equal(result.report.recall_units[0].status, "marked");
  assert.ok(result.report.recall_units[0].found_with_tags > 0, "the marked unit was searched");
  assert.equal(result.report.recall_units[1].questions, three.questions.length - 1, "the flagged copying question is left out");
  // Under owner decision 30's rules the same reference can't be measured, and the same failed floor blocks publication.
  const older = { now: START };
  await assert.rejects(measure(scriptedPort({ clock: older }), older, first, { reference }), { code: "POINTER_REFERENCE_INCOMPLETE" });
  const blocked = await measure(scriptedPort({ clock: older }), older, first);
  assert.deepEqual([blocked.publish, blocked.floors_block, "unmeasured_units" in blocked.report], [false, true, false]);
  // A sample with no unit to measure can't be measured under either rules.
  const empty = { units: REFERENCE.units.map((unit) => ({ ...unit, status: "nonresponse", reason: "deadline", questions: [] })) };
  assert.throws(() => measurePointerRecall({ reference: empty, foundWithTags: new Set(), foundWordsOnly: new Set(), eventTaggedUnitIds: new Set(),
    excludeUnmeasured: true }), { code: "POINTER_REFERENCE_INCOMPLETE" });
});

test("the recall floor's reach takes complete units as found and unconfirmed ones as missed, the best any generation could do", () => {
  assert.deepEqual(pointerRecallReach(REFERENCE), { unconfirmed_units: 0, best_estimate: 1, best_lower_bound: 1, floor: 0.85, reachable: true });
  const unconfirmed = (count) => ({ units: REFERENCE.units.map((unit, index) => (index < count ? { ...unit, status: "unconfirmed" } : unit)) });
  const one = pointerRecallReach(unconfirmed(1));
  assert.equal(one.unconfirmed_units, 1);
  assert.ok(one.best_estimate < 1 && one.best_lower_bound <= one.best_estimate);
  // Half the sample unconfirmed: no generation could reach the floor, so the run stops before the pilot.
  const half = pointerRecallReach(unconfirmed(Math.ceil(REFERENCE.units.length / 2)));
  assert.ok(half.best_lower_bound < 0.85);
  assert.equal(half.reachable, false);
  // A nonresponse is left out here: it stops the run anyway.
  const nonresponse = { units: [{ ...REFERENCE.units[0], status: "nonresponse", questions: [] }, ...REFERENCE.units.slice(1)] };
  assert.equal(pointerRecallReach(nonresponse).unconfirmed_units, 0);
  assert.throws(() => pointerRecallReach(null), { code: "POINTER_REFERENCE_INVALID" });
});

test("each sample is fixed by its seed, 150 pairs at most, and its items are what a judge sees", () => {
  const pairs = Array.from({ length: 400 }, (_, index) => ({ pair_id: `pair:${index}`, kind: index % 2 ? "topic" : "person", label: `label ${index}`,
    unit_id: PASS_INPUT.units[index % PASS_INPUT.units.length].unit_id }));
  const dropped = [{ pair_id: "event-pair:a", kind: "event", label: "concert", unit_id: PASS_INPUT.units[1].unit_id }];
  const drawn = pointerMeasureSamples({ pairs, dropped, unitsById: PASS_INPUT.unitsById, seed: "seed-one" });
  const sizes = Object.fromEntries(drawn.samples.map((sample) => [sample.name, [sample.pairs, sample.items.length]]));
  assert.deepEqual(sizes, { person: [200, 150], place: [0, 0], organization: [0, 0], topic: [200, 150], event: [0, 0], dropped_events: [1, 1] });
  assert.deepEqual(pointerMeasureSamples({ pairs, dropped, unitsById: PASS_INPUT.unitsById, seed: "seed-one" }), drawn);
  const other = pointerMeasureSamples({ pairs, dropped, unitsById: PASS_INPUT.unitsById, seed: "seed-two" });
  assert.notDeepEqual(other.samples[0].items.map((item) => item.label), drawn.samples[0].items.map((item) => item.label));
  const items = drawn.samples.flatMap((sample) => sample.items);
  assert.equal(new Set(items.map((item) => item.pair_id)).size, items.length);
  assert.equal(items[0].quote, PASS_INPUT.unitsById.get(items[0].unit_id).text);
  assert.equal(JSON.stringify(drawn).includes("seed-one"), false);
  assert.throws(() => pointerMeasureSamples({ pairs: [pairs[0], pairs[0]], dropped, unitsById: PASS_INPUT.unitsById, seed: "s" }), { code: "POINTER_MEASURE_PAIR_DUPLICATE" });
});

test("anchors are checked again by code, and one that no longer holds is counted", async () => {
  const clock = { now: START };
  const result = await pass(scriptedPort({ clock }), clock);
  assert.equal(pointerBrokenAnchors({ checked: result.checked, unitsById: PASS_INPUT.unitsById }), 0);
  const tampered = result.checked.map((item, index) => (index === 0 ? { ...item, kept: [{ ...item.kept[0],
    anchors: [{ ...item.kept[0].anchors[0], quote: "Marie" }] }, ...item.kept.slice(1)] } : item));
  assert.equal(pointerBrokenAnchors({ checked: tampered, unitsById: PASS_INPUT.unitsById }), 1);
});

test("calibration's units are a challenge set: the reference step runs on their pages, and the measurement reports them apart", async () => {
  const calibration = [
    { unit_id: "calibration:a", representation_id: "steps:page:2", page_number: 2, hazard_types: [] },
    { unit_id: "calibration:b", representation_id: "steps:page:5", page_number: 5, hazard_types: ["declared_source_hazard"] },
    { unit_id: "calibration:c", representation_id: "steps:page:5", page_number: 5, hazard_types: ["parser_warning"] },
    { unit_id: "calibration:d", representation_id: "visual:page:13", page_number: 13, hazard_types: ["visual_representation"] }
  ];
  const sample = pointerChallengeUnits({ units: PASS_INPUT.units, calibration });
  // Each page once, chosen with certainty, with every hazard of its calibration units; a page without quotes is counted.
  assert.deepEqual(sample.units.map((unit) => [unit.unit_id, unit.stratum, unit.inclusion_probability, unit.hazards, unit.quote_ids.length]),
    [["page:2", 0, 1, [], 2], ["page:5", 0, 1, ["declared_source_hazard", "parser_warning"], 1]]);
  assert.deepEqual([sample.calibration_units, sample.units_without_quotes, sample.candidate_units], [4, 1, 2]);
  assert.equal(JSON.stringify(sample).includes("Jean"), false);
  assert.throws(() => pointerChallengeUnits({ units: PASS_INPUT.units, calibration: [{ unit_id: "c", page_number: 2 }] }),
    { code: "POINTER_CHALLENGE_INPUT_INVALID" });

  const clock = { now: START };
  const port = scriptedPort({ clock });
  const challenge = await runPointerReference({ units: PASS_INPUT.units, sample, stepId: "challenge:synthetic", deadline: DEADLINE, port,
    grant, generation: "steps-generation", now: () => new Date(clock.now) });
  assert.equal(challenge.sample.kind, "calibration");
  assert.deepEqual(challenge.units.map((unit) => [unit.unit_id, unit.status, unit.hazards, unit.questions.length]),
    [["page:2", "complete", [], 2], ["page:5", "complete", ["declared_source_hazard", "parser_warning"], 1]]);
  assert.ok(port.sent.every((item) => item.operationKey.startsWith("challenge:synthetic:")));
  await assert.rejects(runPointerReference({ units: PASS_INPUT.units, seed: "s", sample, stepId: "challenge:synthetic", deadline: DEADLINE, port,
    grant, generation: "g" }), { code: "POINTER_STEP_INPUT_INVALID" });

  // The measurement searches the challenge's questions too and reports them apart: here their searches find nothing.
  const { second } = await coveredPass(port, clock);
  const measured = await measure(port, clock, second, { challenge });
  assert.equal(measured.publish, true, "the challenge set never decides");
  assert.deepEqual(measured.report.challenge.all, { units: 2, questions: 3, found_with_tags: 0, found_words_only: 0, recall_with_tags: 0,
    recall_words_only: 0, critical_questions: 2, critical_found_with_tags: 0, critical_found_words_only: 0 });
  assert.deepEqual([measured.report.challenge.by_place_only.units, measured.report.challenge.by_place_only.questions], [1, 2]);
  assert.deepEqual(Object.keys(measured.report.challenge.by_hazard), ["declared_source_hazard", "parser_warning"]);
  assert.equal(measured.report.challenge.by_hazard.parser_warning.questions, 1);
  assert.equal((await measure(port, clock, second)).report.challenge, null);

  // Counted plainly: found questions over asked, all and critical, with nonresponses counted and left out.
  const found = new Set([challenge.units[0].questions[0].question_id]);
  const report = measurePointerChallenge({ reference: { units: [...challenge.units, { unit_id: "page:9", status: "nonresponse", questions: [], hazards: [] }] },
    foundWithTags: found, foundWordsOnly: new Set() });
  assert.deepEqual([report.units, report.nonresponse_units, report.all.found_with_tags, report.all.recall_with_tags], [3, 1, 1, 1 / 3]);
  // A marked unit (owner decision 32) was searched and counts like a complete one; its flagged copying question is left out.
  const [page2] = challenge.units;
  const markedReport = measurePointerChallenge({ reference: { units: [{ ...page2, status: "marked", reason: "coverage_unconfirmed",
    questions: page2.questions.map((question, index) => (index === 0 ? { ...question, copied: true } : question)) }] },
  foundWithTags: new Set(page2.questions.map((question) => question.question_id)), foundWordsOnly: new Set() });
  assert.deepEqual([markedReport.marked_units, markedReport.nonresponse_units, markedReport.all.questions, markedReport.all.found_with_tags], [1, 0, 1, 1]);
  assert.equal("marked_units" in report, false);
});

test("the search check follows owner decision 32's rules: a run under earlier rules is refused before anything is read", async () => {
  // Under earlier rules an unconfirmed unit counts every question missed without a search, which the check can't show.
  const unread = { get units() { throw new Error("read"); } };
  await assert.rejects(runPointerSearchCheck({ quoteGeneration: unread, reference: unread, search: async () => [], population: 1, rules: 2 }),
    { code: "POINTER_SEARCH_CHECK_RULES" });
});
