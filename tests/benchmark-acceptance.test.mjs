import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTextBenchmark, evaluateStructuredBenchmark } from "../src/autopilot/benchmark-acceptance.mjs";

test("concept acceptance allows equivalent wording rather than requiring canonical labels", () => {
  const acceptance = {
    requiredConcepts: [
      {
        id: "question_as_evidence_request",
        description: "Treat the sarcasm as a request for evidence.",
        anyPatterns: ["literal question", "demand for evidence", "what are you going to do for me"]
      },
      {
        id: "age_distinction",
        description: "Separate age and agency.",
        anyPatterns: ["which age", "which younger version", "age and agency"]
      }
    ],
    forbiddenClaims: [
      {
        id: "inherited_parent_certainty",
        description: "Do not diagnose categorically.",
        anyPatterns: ["is the inherited parent"]
      }
    ]
  };

  const pass = evaluateTextBenchmark({
    answer: "The sarcasm is also a demand for evidence. First distinguish the age and agency of the younger version being blamed.",
    next_question: "Which younger version is the resentment actually aimed at?"
  }, acceptance);

  assert.equal(pass.ok, true);
  assert.deepEqual(pass.missingRequired, []);
  assert.deepEqual(pass.presentForbidden, []);
  assert.equal(pass.required[0].matchedPattern, "demand for evidence");
  assert.equal(pass.required[1].matchedPattern, "which younger version");

  const fail = evaluateTextBenchmark({
    answer: "This is the inherited parent."
  }, acceptance);
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.presentForbidden, ["inherited_parent_certainty"]);
});

test("legacy requiredPatterns and forbiddenPatterns remain supported", () => {
  const acceptance = {
    requiredPatterns: ["credibil", "which age"],
    forbiddenPatterns: ["is the inherited parent"]
  };
  const pass = evaluateTextBenchmark({
    answer: "This is a credibility conflict. Ask which age the resentment targets."
  }, acceptance);
  assert.equal(pass.ok, true);
});

test("structured acceptance keeps secondary planning obligations out of prose lexicon", () => {
  const acceptance = {
    response: {
      requiredConcepts: [
        { id: "credibility", anyPatterns: ["credibil"] },
        { id: "age", anyPatterns: ["which age", "which younger version"] }
      ],
      forbiddenClaims: [
        { id: "categorical", anyPatterns: ["is the inherited parent"] }
      ]
    },
    plan: {
      primary: "IC.CREDIBILITY_REPAIR",
      selectedIncludes: ["IC.BORROW_ONE_FUNCTION", "IC.AGE_RESPONSIBILITY_CLARIFICATION"],
      deferredIncludes: []
    }
  };
  const result = {
    answer: "This is fundamentally a credibility conflict. The next question is which younger version is being blamed.",
    next_question: "Which age is the resentment aimed at?",
    interventionContract: {
      primaryJob: { id: "IC.CREDIBILITY_REPAIR" },
      secondaryJobs: [{ id: "IC.BORROW_ONE_FUNCTION" }, { id: "IC.AGE_RESPONSIBILITY_CLARIFICATION" }],
      selectedNodes: [{ id: "IC.CREDIBILITY_REPAIR" }, { id: "IC.BORROW_ONE_FUNCTION" }, { id: "IC.AGE_RESPONSIBILITY_CLARIFICATION" }],
      deferredNodes: [],
      blockedNodes: []
    }
  };
  const pass = evaluateStructuredBenchmark(result, acceptance);
  assert.equal(pass.ok, true, JSON.stringify(pass));
  assert.deepEqual(pass.plan.missing, []);

  const missingPlan = evaluateStructuredBenchmark({
    ...result,
    interventionContract: {
      ...result.interventionContract,
      secondaryJobs: [{ id: "IC.AGE_RESPONSIBILITY_CLARIFICATION" }],
      selectedNodes: [{ id: "IC.CREDIBILITY_REPAIR" }, { id: "IC.AGE_RESPONSIBILITY_CLARIFICATION" }]
    }
  }, acceptance);
  assert.equal(missingPlan.ok, false);
  assert.ok(missingPlan.plan.missing.includes("selected:IC.BORROW_ONE_FUNCTION"));
});
