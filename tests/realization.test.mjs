import test from "node:test";
import assert from "node:assert/strict";
import { realizationPrompt } from "../src/prompts/realize.mjs";

const context = {
  userMessage: "The younger me says big fuckity whoopty doo, what are you gonna do for me?",
  recentTranscript: "Relaxation has not changed the standoff.",
  interventionContract: {
    primaryJob: { id: "IC.CREDIBILITY_REPAIR", title: "Repair credibility" },
    nextQuestion: "Which age or version of you is the resentment directed toward?",
    requiredNuance: ["Relaxation does not repair a contradictory track record."],
    forbiddenOverclaims: ["Do not label the contempt definitively as a guard."]
  }
};
const adjudication = {
  answer: "The central issue is credibility.",
  what_is_clear: ["The sarcastic question is actionable."],
  uncertainties: ["Speaker identity remains unresolved."],
  next_question: "Which age or version of you is the resentment directed toward?",
  accepted_insights: ["credibility", "literal-question", "repeated-follow-through"],
  rejected_claims: ["categorical-guard"],
  safety_flags: [],
  decision_summary: "Preserve uncertainty while acting on the credibility problem."
};

test("realization contract separates conservative reasoning from natural prose", () => {
  const prompt = realizationPrompt(context, adjudication, "Claude");
  assert.match(prompt.system, /hard reasoning is already complete/i);
  assert.match(prompt.system, /answer that question explicitly/i);
  assert.match(prompt.system, /show up again/i);
  assert.match(prompt.system, /contract owns the substantive next question/i);
  assert.match(prompt.system, /adverse one/i);
  assert.match(prompt.system, /Do not append generic crisis, grounding, dissociation/i);
  assert.match(prompt.system, /Do not invent generic possibilities/i);
  assert.match(prompt.system, /Epistemic attribution matters/i);
  assert.match(prompt.system, /Primary versus supporting jobs are not mutually exclusive/i);
  assert.match(prompt.system, /Treat competing internal positions symmetrically/i);
  assert.match(prompt.system, /Plan-realization fidelity is mandatory/i);
  assert.match(prompt.system, /Every requiredNuance entry is mandatory/i);
  assert.match(prompt.system, /Every forbiddenOverclaims and rejected_claims entry is binding/i);
  assert.match(prompt.user, /big fuckity whoopty doo/i);
  assert.match(prompt.user, /Which age or version/i);
});

test("realization safety copy is controlled by deterministic case variables rather than generic model caution", () => {
  const flaggedContext = {
    ...context,
    interventionContract: { ...context.interventionContract, variables: { present_safety: "safe", orientation: "disoriented" } }
  };
  const flagged = realizationPrompt(flaggedContext, { ...adjudication, safety_flags: [] }, "Claude");
  assert.match(flagged.system, /concrete safety trigger is present/i);
  const ordinary = realizationPrompt(context, { ...adjudication, safety_flags: ["generic-caution"] }, "Claude");
  assert.match(ordinary.system, /No deterministic safety trigger is present/i);
});

import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";

test("response contract removes an unauthorized renderer question and appends the graph-owned question", () => {
  const realized = enforceResponseContract({
    answer: "The credibility problem needs evidence, not another vow.\n\nOne practical check before going further: can you stop the internal war and return to your day?",
    next_question: "Can you stop the internal war and return to your day?"
  }, {
    plan: context.interventionContract,
    adjudication
  });
  assert.doesNotMatch(realized.answer_body, /can you stop the internal war/i);
  assert.match(realized.answer, /Which age or version of you is the resentment directed toward\?$/);
  assert.equal(realized.next_question, context.interventionContract.nextQuestion);
  assert.match(realized.responseContract.strippedUnauthorizedFinalQuestion, /can you stop the internal war/i);
});

test("response contract does not duplicate a renderer that already used the canonical question", () => {
  const realized = enforceResponseContract({
    answer: `The track record needs counterevidence.\n\n${context.interventionContract.nextQuestion}`,
    next_question: context.interventionContract.nextQuestion
  }, {
    plan: context.interventionContract,
    adjudication
  });
  assert.equal((realized.answer.match(/Which age or version/g) ?? []).length, 1);
  assert.equal(realized.next_question, context.interventionContract.nextQuestion);
  assert.equal(realized.responseContract.rendererQuestionMatched, true);
});

test("response contract places a direct personal-safety question before reassurance", () => {
  const safetyQuestion = "Are you having thoughts of suicide or self-harm, and are there urgent physical warning signs right now?";
  const plan = {
    ...context.interventionContract,
    nextQuestion: safetyQuestion,
    nextQuestionSource: { type: "protocol-material-unknown", variable: "personal_safety_scope" },
    questionContract: {
      mode: "canonical",
      question: safetyQuestion,
      source: { type: "protocol-material-unknown", variable: "personal_safety_scope" }
    }
  };
  const realized = enforceResponseContract({
    answer: "Conflicting hunger and fullness signals can be deeply distressing.",
    next_question: safetyQuestion,
    realized_nodes: []
  }, { plan, adjudication });
  assert.match(realized.answer, /^Are you having thoughts of suicide or self-harm/);
  assert.equal(realized.responseContract.canonicalQuestionPlacement, "before-answer");
});


test("response contract records missing selected interventions for automatic realization repair", () => {
  const plan = {
    ...context.interventionContract,
    displayTrace: { secondaryJobs: [{ id: "IC.BORROW_ONE_FUNCTION", title: "Borrow one bounded adult function" }] }
  };
  const realized = enforceResponseContract({
    answer: "The credibility problem needs one visible act.",
    next_question: plan.nextQuestion,
    realized_nodes: [
      { id: "IC.CREDIBILITY_REPAIR", evidence_quote: "The credibility problem needs one visible act." }
    ]
  }, { plan, adjudication });
  assert.equal(realized.responseContract.realizationCoveragePassed, false);
  assert.deepEqual(realized.responseContract.missingRealizationNodeIds, ["IC.BORROW_ONE_FUNCTION"]);
});


test("response contract rejects a self-reported realization whose evidence quote is not in the answer", () => {
  const plan = {
    ...context.interventionContract,
    displayTrace: { secondaryJobs: [{ id: "IC.BORROW_ONE_FUNCTION", title: "Borrow one bounded adult function" }] }
  };
  const realized = enforceResponseContract({
    answer: "The credibility problem needs one visible act.",
    next_question: plan.nextQuestion,
    realized_nodes: [
      { id: "IC.CREDIBILITY_REPAIR", evidence_quote: "The credibility problem needs one visible act." },
      { id: "IC.BORROW_ONE_FUNCTION", evidence_quote: "Borrow a decent adult response here." }
    ]
  }, { plan, adjudication });
  assert.equal(realized.responseContract.realizationCoveragePassed, false);
  assert.deepEqual(realized.responseContract.missingRealizationNodeIds, ["IC.BORROW_ONE_FUNCTION"]);
  assert.equal(realized.responseContract.rejectedRealizations[0].id, "IC.BORROW_ONE_FUNCTION");
});
