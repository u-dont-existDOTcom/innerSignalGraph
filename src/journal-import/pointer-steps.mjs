import { ValidationError } from "../core/errors.mjs";
import { JOURNAL_ROLE_DEFINITIONS } from "./provider-port.mjs";
import { runDeadlineCalls } from "./pointer-calls.mjs";
import { POINTER_REFERENCE_NONRESPONSE_REASONS, checkCoverageJudgments, checkQuestionSet, checkSearchPlan, coverageJudgeCalls,
  pointerReferenceSample, referenceUnitStep } from "./pointer-reference.mjs";

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
