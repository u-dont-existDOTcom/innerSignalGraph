import test from "node:test";
import assert from "node:assert/strict";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { validateTurnTask, reconcileIssueScope } from "../src/case-formulation/turn-task.mjs";
import { strategyPerformanceDecision } from "../src/case-formulation/strategy-performance.mjs";
import { applyCaseAudit, planCaseSnapshot } from "../src/case-formulation/run.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { requiredRealizationNodeIds, enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { realizeAdjudication } from "../src/orchestrator/run-pipeline.mjs";

// Entirely synthetic current-session fixtures, not client history or efficacy data.
const bundle = await compileGuideGraphs({ write: false });
const currentNode = "IC.DEEP_CHILD_DIALOGUE";
const alternativeNode = "IC.BEST_FRIEND_PERSPECTIVE";
const steady = {
  present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes",
  suicidal_state: "absent", activation: "low", dissociation: "none", altered_state: "sober",
  inner_adult_access: "available", witness_capacity: "present", coherent_child_state: "present",
  body_capacity: "adequate", current_intent: "deep_dialogue", other_person_central: "no",
  influence_domain: "none", actionable_problem: "absent", unresolved_inner_material: "present",
  attention_loop: "absent", inward_attention_effect: "neutral", protective_response: "absent",
  self_criticism: "present"
};
const review = (overrides = {}) => ({
  target: "Find a less condemning response to a small mistake",
  expected_change: "A response the person can use during an ordinary setback",
  fit: "fitting", fit_observation_ids: ["O1"], outcome: "no_yield", outcome_observation_ids: ["O2"],
  review_due: true, alternative_angle: "Consider a concrete fair response to a friend making the same mistake",
  alternative_node_id: alternativeNode, ...overrides
});
const task = (overrides = {}) => ({
  version: 1, issue: "Handling a minor mistake", node_id: currentNode, kind: "emotion", phase: "review",
  agreement: "accepted", observation_ids: ["O1", "O2"], marker: "Condemnation after a small setback",
  last_response: "I tried the agreed dialogue during the setback and returned to the same condemnation.",
  capacity: "adequate", question_focus: "none", action: null,
  emotion: { process: "self_treatment", response: "The condemnation returned unchanged", change_point: "" },
  strategy_review: review(), ...overrides
});
const plan = (t = task(), variables = {}) => planFromGraphs({ graphs: bundle.graphs, variables: { ...steady, ...variables }, turnTask: t });
const snapshot = (t = task()) => ({
  user_goal: "Respond fairly to mistakes", current_issue: t.issue, variables: steady,
  direct_observations: [
    { id: "O1", statement: "Chose the dialogue", evidence: "I want to try this dialogue." },
    { id: "O2", statement: "Attempt brought no usable change", evidence: t.last_response }
  ], hypotheses: [], unknowns: [], turn_task: t
});
const audit = (overrides = {}) => ({
  remove_observation_ids: [], remove_hypothesis_ids: [], variable_corrections: [], add_unknowns: [],
  verdict: "accept", summary: "Synthetic evidence retained", safety_flags: [], ...overrides
});
const context = (overrides = {}) => ({
  userMessage: task().last_response, recentTranscript: "Synthetic task agreement and one reported attempt.",
  userFacts: [], guideManifest: { version: "synthetic-test" }, guideExcerpts: "",
  priorCaseSnapshot: snapshot(task({ strategy_review: null })), priorInterventionContract: plan(task({ strategy_review: null })),
  ...overrides
});

test("reported lack of usable change triggers comparison without an explicit complaint", () => {
  const t = validateTurnTask(task(), { issue: task().issue, observationIds: new Set(["O1", "O2"]) });
  assert.doesNotMatch(t.last_response, /not working|unhelpful|switch/i);
  const p = plan(t);
  assert.equal(p.executionContract.strategyReview.status, "REASSESS_NO_YIELD");
  assert.equal(p.executionContract.strategyReview.mode, "review_before_exercise");
  assert.equal(p.executionContract.strategyReview.pauseCurrent, true);
  assert.equal(p.primaryJob.id, alternativeNode);
  assert.deepEqual(requiredRealizationNodeIds(p), []);
  assert.match(p.executionContract.taskGuidance.join(" "), /Pause the current exercise/);
  assert.match(p.executionContract.taskGuidance.join(" "), /not consent/);
});

test("partial useful change during difficult emotion preserves wanted work", () => {
  const t = task({
    last_response: "I still felt grief, but could answer the criticism more fairly and return to my day.",
    emotion: { process: "anguish", response: "Grief remains", change_point: "A fairer response became usable" },
    strategy_review: review({ outcome: "improving", alternative_node_id: "" })
  });
  const p = plan(t);
  assert.equal(p.primaryJob.id, currentNode);
  assert.equal(p.executionContract.strategyReview.status, "CONTINUE_WITH_REVIEW");
  assert.equal(p.executionContract.strategyReview.pauseCurrent, false);
  assert.ok(requiredRealizationNodeIds(p).includes(currentNode));
  assert.match(p.executionContract.taskGuidance.join(" "), /supported gain/);
});

test("mixed benefit and cost invites adjustment without automatically replacing the whole method", () => {
  const p = plan(task({ strategy_review: review({ outcome: "mixed" }) }));
  assert.equal(p.primaryJob.id, currentNode);
  assert.equal(p.executionContract.strategyReview.status, "ADAPT_AND_REVIEW");
  assert.equal(p.executionContract.strategyReview.compareAlternatives, true);
  assert.equal(p.executionContract.strategyReview.pauseCurrent, false);
  assert.match(p.executionContract.taskGuidance.join(" "), /Preserve the useful part/);
});

test("early and missing effects remain unknown instead of scoring failure or success", () => {
  for (const reviewDue of [false, true]) {
    const t = task({ strategy_review: review({ outcome: "unknown", outcome_observation_ids: [], review_due: reviewDue }) });
    validateTurnTask(t);
    const p = plan(t);
    assert.equal(p.primaryJob.id, currentNode);
    assert.equal(p.executionContract.strategyReview.status, "OUTCOME_UNKNOWN");
    assert.equal(p.executionContract.strategyReview.pauseCurrent, false);
    assert.match(p.executionContract.taskGuidance.join(" "), /uncertainty, not success or failure/);
  }
});

test("poor fit or an app rupture is addressed before delayed outcome evidence arrives", () => {
  for (const [fit, expected] of [["poor_fit", "REASSESS_FIT"], ["rupture", "REPAIR_RELATIONSHIP"]]) {
    const t = task({ strategy_review: review({ fit, outcome: "unknown", outcome_observation_ids: [], review_due: false }) });
    validateTurnTask(t);
    const p = plan(t);
    assert.equal(p.executionContract.strategyReview.status, expected);
    assert.equal(p.executionContract.strategyReview.mode, "review_before_exercise");
    assert.match(p.executionContract.taskGuidance.join(" "), /repair that first/);
  }
});

test("reported worsening pauses another automatic attempt", () => {
  const p = plan(task({ strategy_review: review({ outcome: "worsening" }) }));
  assert.equal(p.executionContract.strategyReview.status, "REASSESS_WORSENING");
  assert.deepEqual(requiredRealizationNodeIds(p), []);
});

test("malformed or unsupported strategy assessments fail validation", () => {
  for (const override of [
    { target: " " }, { expected_change: "" }, { review_due: "yes" }, { outcome: "healed" },
    { outcome_observation_ids: [] }, { outcome_observation_ids: ["O2", "O2"] },
    { outcome_observation_ids: ["outside-task"] }, { fit_observation_ids: [] },
    { fit_observation_ids: ["O1", "O1"] }, { fit_observation_ids: ["outside-task"] },
    { review_due: false }, { episode_count: 7 }, { alternative_node_id: "x".repeat(161) }
  ]) assert.throws(() => validateTurnTask(task({ strategy_review: review(override) })), undefined, JSON.stringify(override));
});

test("withdrawn outcome evidence invalidates the whole task and its strategy authority", () => {
  const corrected = applyCaseAudit(snapshot(), audit({ remove_observation_ids: ["O2"] }));
  assert.equal(corrected.turn_task, null);
  const p = plan(corrected.turn_task);
  assert.equal(p.executionContract.strategyReview, undefined);
  assert.notEqual(p.primaryJob.id, alternativeNode);
});

test("audit can revoke a review or correct failure to supported partial improvement", () => {
  assert.equal(applyCaseAudit(snapshot(), audit({ invalidate_turn_task: true })).turn_task, null);
  const correction = task({ strategy_review: review({ outcome: "improving" }) });
  const corrected = applyCaseAudit(snapshot(), audit({ verdict: "revise", corrected_turn_task: correction }));
  assert.equal(plan(corrected.turn_task).executionContract.strategyReview.status, "CONTINUE_WITH_REVIEW");
});

test("a strategy review cannot survive a different issue or missing current evidence", () => {
  assert.equal(validateTurnTask(task(), { issue: "Another issue" }), null);
  assert.equal(validateTurnTask(task(), { observationIds: new Set(["O1"]) }), null);
  assert.equal(strategyPerformanceDecision(null).status, "NO_ACTIVE_REVIEW");
  const prior = snapshot();
  const next = snapshot(task({ issue: "A different current problem" }));
  assert.equal(reconcileIssueScope(next, prior).turn_task.strategy_review, null);
  assert.deepEqual(reconcileIssueScope(prior, prior).turn_task.strategy_review, prior.turn_task.strategy_review);
});

test("refusal and closure do not become invitations to try another exercise", () => {
  const declined = plan(task({ agreement: "declined" }));
  assert.equal(declined.executionContract.strategyReview.status, "RESPECT_REFUSAL");
  assert.notEqual(declined.executionContract.strategyReview.mode, "review_before_exercise");
  assert.ok(!requiredRealizationNodeIds(declined).includes(currentNode));
  assert.match(declined.executionContract.taskGuidance.join(" "), /Respect the refusal/);
  assert.doesNotMatch(declined.executionContract.taskGuidance.join(" "), /Compare the current formulation/);
  assert.equal(declined.nextQuestion, "");
  const closed = plan(task({ phase: "close" }));
  assert.equal(closed.executionContract.strategyReview.status, "NO_ACTIVE_REVIEW");
  assert.match(closed.executionContract.taskGuidance.join(" "), /definite ending/);
  assert.doesNotMatch(closed.executionContract.taskGuidance.join(" "), /Compare the current formulation/);
  assert.equal(closed.nextQuestion, "");
});

test("immediate protection outranks strategy comparison and retains realization requirements", () => {
  for (const danger of [{ present_safety: "unsafe" }, { ability_to_stop: "no" }, { suicidal_state: "imminent" }, { dissociation: "high" }]) {
    const p = plan(task(), danger);
    assert.equal(p.executionContract.strategyReview, undefined);
    assert.notEqual(p.primaryJob.id, alternativeNode);
    assert.ok(requiredRealizationNodeIds(p).includes(p.primaryJob.id));
    assert.deepEqual(p.executionContract.taskGuidance, []);
    assert.match(p.executionContract.reason, /Immediate protection/);
  }
});

test("live outward action and relational assessment retain priority over an inward method review", () => {
  for (const [variables, expected] of [
    [{ actionable_problem: "present" }, "ROUTE.ACT_OUTWARD"],
    [{ other_person_central: "yes", relational_check_status: "pending" }, "ROUTE.RELATIONAL_REALITY_CHECK"],
    [{ inward_attention_effect: "worsens" }, "ROUTE.EXTERNAL_EMBODIMENT"]
  ]) {
    const p = plan(task(), variables);
    assert.equal(p.primaryJob.id, expected);
    assert.equal(p.executionContract.strategyReview.mode, "within_current_route");
    assert.equal(p.executionContract.strategyReview.alternativeEligible, false);
    assert.deepEqual(requiredRealizationNodeIds(p), [expected]);
  }
});

test("an alternative must exist and be eligible, not merely be named by the extractor", () => {
  for (const alternative of ["INVENTED.UNGATED_EXERCISE", "SOM.ADVANCED_RELEASE_OPTIONAL", "SOM.EMDR_DISCRETE", currentNode]) {
    const p = plan(task({ strategy_review: review({ alternative_node_id: alternative }) }));
    assert.equal(p.executionContract.strategyReview.alternativeEligible, false);
    assert.notEqual(p.primaryJob.id, alternative);
    assert.equal(p.executionContract.strategyReview.mode, "review_before_exercise");
    assert.deepEqual(requiredRealizationNodeIds(p), []);
  }
});

test("older tasks and installed packet graphs preserve their prior contract behavior", () => {
  const oldTask = task();
  delete oldTask.strategy_review;
  assert.deepEqual(validateTurnTask(oldTask), oldTask);
  assert.equal(plan(oldTask).primaryJob.id, currentNode);
  assert.equal(plan(oldTask).executionContract.strategyReview, undefined);
  const oldPlan = plan(oldTask);
  oldPlan.executionContract.task.strategy_review = null;
  assert.deepEqual(oldPlan, plan(task({ strategy_review: null })));
  const graphs = bundle.graphs.map(({ taskPolicyVersion, ...graph }) => graph);
  const legacy = planFromGraphs({ graphs, variables: steady, turnTask: task() });
  assert.equal(legacy.contractVersion, "case-plan-v4");
  assert.equal(legacy.executionContract, undefined);
  assert.deepEqual(legacy, planFromGraphs({ graphs, variables: steady }));
  assert.ok(requiredRealizationNodeIds(legacy).includes(legacy.primaryJob.id));
});

test("real planning delivers outcome evidence, alternative limits and review guidance to the realizer", async () => {
  const s = snapshot();
  const { plan: p } = await planCaseSnapshot(s, { loadPlanningGraphBundle: async () => bundle });
  const prompt = realizationPrompt({ ...context(), interventionContract: p }, {}, "synthetic-renderer");
  assert.match(prompt.user, /returned to the same condemnation/);
  assert.match(prompt.user, /review_before_exercise/);
  assert.match(prompt.user, /Pause the current exercise/);
  assert.match(prompt.system, /Consent to the old exercise does not transfer/);
  assert.match(prompt.system, /Do not enact or repeat the paused exercise/);
  const result = enforceResponseContract({
    answer: "That attempt gave you no usable change. We can pause the dialogue and consider a concrete fair response to the mistake.",
    next_question: "Repeat the dialogue?", realized_nodes: []
  }, { plan: p, adjudication: { next_question: "A stale question?" } });
  assert.deepEqual(result.responseContract.requiredRealizationNodeIds, []);
  assert.equal(result.responseContract.realizationCoveragePassed, true);
  assert.equal(result.next_question, "");
  assert.doesNotMatch(result.answer, /Repeat the dialogue|stale question/);
});

test("a malformed review contract cannot silently discard a required exercise", () => {
  const p = plan();
  assert.throws(() => requiredRealizationNodeIds({ ...p, executionContract: {
    ...p.executionContract, requiredNodeIds: [currentNode]
  } }), /Invalid strategy-review/);
  assert.throws(() => requiredRealizationNodeIds({ ...p, executionContract: {
    ...p.executionContract, strategyReview: { ...p.executionContract.strategyReview, pauseCurrent: false }
  } }), /Invalid strategy-review/);
});

test("a needed fit question survives realization without reviving the old exercise question", () => {
  const p = plan(task({ question_focus: "emotional_fit" }));
  assert.equal(p.nextQuestionSource.type, "strategy-review");
  assert.equal(p.questionContract.mode, "canonical");
  assert.match(p.nextQuestion, /next step more useful or manageable/);
  const result = enforceResponseContract({
    answer: "The effort did not produce the intended change. We can pause and reconsider what would help.",
    next_question: "Repeat the dialogue?", realized_nodes: []
  }, { plan: p });
  assert.equal(result.next_question, p.nextQuestion);
  assert.ok(result.answer.endsWith(p.nextQuestion));
  assert.doesNotMatch(result.answer, /Repeat the dialogue/);
});

test("claiming any exercise during review fails coverage even when the quote exists", () => {
  const p = plan();
  for (const id of [currentNode, alternativeNode]) {
    const answer = "Start the exercise again and continue through the same dialogue.";
    const result = enforceResponseContract({ answer, realized_nodes: [{ id, evidence_quote: answer }] }, { plan: p });
    assert.equal(result.responseContract.realizationCoveragePassed, false);
    assert.equal(result.responseContract.strategyReviewExerciseClaimed, true);
    assert.deepEqual(result.responseContract.realizedNodeIds, []);
    assert.equal(result.responseContract.rejectedRealizations.length, 1);
  }
});

test("strategy outcome labels receive audit even when fast mode is requested", () => {
  const s = { ...snapshot(), variables: { ...steady, current_intent: "conversation" } };
  assert.equal(classifyTherapyTier(s, "fast").tier, "reviewed");
  assert.equal(classifyTherapyTier(s, "auto").tier, "reviewed");
  assert.equal(classifyTherapyTier({ ...s, variables: { ...s.variables, present_safety: "unsafe" } }, "fast").tier, "forensic");
  assert.equal(classifyTherapyTier({ ...s, turn_task: task({ strategy_review: null }) }, "fast").tier, "fast");
});

test("extractor and auditor receive prior strategy context and prohibit proxy failure inference", () => {
  const c = context();
  const extract = caseExtractionPrompt(c);
  const auditPrompt = caseAuditPrompt(c, snapshot());
  assert.match(extract.user, /PRIOR INTERVENTION CONTRACT/);
  assert.match(extract.user, /successSignals/);
  assert.match(extract.system, /even when the user never says/);
  assert.match(extract.system, /silence, short replies, politeness/);
  assert.match(extract.system, /new strategy or changed target resets strategy_review/);
  assert.match(auditPrompt.user, /PRIOR TASK AND INTERVENTION CONTRACT/);
  assert.match(auditPrompt.user, /Handling a minor mistake/);
  assert.match(auditPrompt.system, /not-yet-due effect scored as failure/);
  assert.match(auditPrompt.system, /corrected_turn_task\/invalidate_turn_task/);
});

function fakeRenderer(outputs) {
  const calls = [];
  return {
    calls,
    provider: {
      id: "openai", model: "fixture-strategy-renderer",
      async generate(request) {
        calls.push(request);
        assert.ok(calls.length <= outputs.length, "The bounded renderer must not make an extra call.");
        return { text: JSON.stringify(outputs[calls.length - 1]), requestId: `synthetic-${calls.length}` };
      }
    }
  };
}
const validReviewResponse = {
  answer: "The attempt did not give you a useful change. We can pause it and consider a fairer response to the mistake.",
  next_question: "", realized_nodes: []
};
const exerciseClaimResponse = {
  answer: "Begin the same dialogue again and repeat the exercise.", next_question: "",
  realized_nodes: [{ id: currentNode, evidence_quote: "Begin the same dialogue again and repeat the exercise." }]
};

test("a valid strategy review is released after the first fake renderer call", async () => {
  const { provider, calls } = fakeRenderer([validReviewResponse]);
  const result = await realizeAdjudication({ context: { ...context(), interventionContract: plan() }, adjudication: {}, provider });
  assert.equal(calls.length, 1);
  assert.equal(result.timing.attempts.length, 1);
  assert.equal(result.value.answer, validReviewResponse.answer);
  assert.equal(result.value.responseContract.realizationCoveragePassed, true);
});

test("an exercise claim gets strategy-specific correction and a valid second response can release", async () => {
  const { provider, calls } = fakeRenderer([exerciseClaimResponse, validReviewResponse]);
  const result = await realizeAdjudication({ context: { ...context(), interventionContract: plan() }, adjudication: {}, provider });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].metadata.stage, "realization_retry");
  const feedback = JSON.parse(calls[1].user.split("RETRY FEEDBACK (if any):\n")[1]);
  assert.match(feedback.instruction, /review/i);
  assert.match(feedback.instruction, /exercise/i);
  assert.match(feedback.instruction, /remove|do not|without|no exercise/i);
  assert.doesNotMatch(feedback.instruction, /every missing selected intervention is materially realized/);
  assert.equal(result.value.answer, validReviewResponse.answer);
  assert.equal(result.value.responseContract.realizationCoveragePassed, true);
});

test("a repeated exercise claim is blocked after two fake renderer calls", async () => {
  const { provider, calls } = fakeRenderer([exerciseClaimResponse, exerciseClaimResponse]);
  await assert.rejects(
    realizeAdjudication({ context: { ...context(), interventionContract: plan() }, adjudication: {}, provider }),
    error => error.code === "STRATEGY_REVIEW_EXERCISE_BLOCKED"
  );
  assert.equal(calls.length, 2);
});
