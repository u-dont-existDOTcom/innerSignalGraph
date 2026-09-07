import test from "node:test";
import assert from "node:assert/strict";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";
import { validateTurnTask, reconcileIssueScope, turnTaskSchema } from "../src/case-formulation/turn-task.mjs";
import { relationalReadinessDecision } from "../src/case-formulation/relational-readiness.mjs";
import { applyCaseAudit, planCaseSnapshot, runCaseExtraction } from "../src/case-formulation/run.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { enforceResponseContract, requiredRealizationNodeIds } from "../src/orchestrator/response-contract.mjs";
import { realizeAdjudication, runAdversarialPipeline, runCompactAdversarialPipeline } from "../src/orchestrator/run-pipeline.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

// Independently fictional situations: no client transcript, identity or private facts.
const bundle = await compileGuideGraphs({ write: false });
const steady = { present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent", activation: "low", dissociation: "none", altered_state: "sober", current_intent: "conversation", actionable_problem: "present", other_person_central: "no", influence_domain: "none", inward_attention_effect: "neutral" };
const readiness = (changes = {}) => ({
  scope: "romantic_sexual_pursuit", current_stability: "sufficient", stability_observation_ids: ["O1"],
  foreseeable_harm: "not_substantial", harm_observation_ids: ["O1"], harm_to: [], risk_signals: [],
  trajectory: "stable", trajectory_observation_ids: ["O1"], support_purpose: "nonromantic", support_observation_ids: ["O2"],
  supports: "A trusted friend and reliable self-care routines", supports_observation_ids: ["O2"],
  reasons: "Social isolation is present, while current self-care, boundaries and reality testing are intact; no substantial relational harm is supported by the current assessment.",
  readiness_markers: ["Maintain self-care and boundaries", "Keep support beyond a romantic partner"],
  review_when: "Reassess if functioning, boundaries, substance risk or dependency changes", ...changes
});
const risk = (kind, timeframe = "current") => ({ kind, timeframe, observation_ids: ["O1"] });
const unstable = (changes = {}) => readiness({
  current_stability: "insufficient", foreseeable_harm: "substantial", harm_to: ["self", "partner"],
  risk_signals: [risk("hospitalization"), risk("substance_dependence_relapse"), risk("dissociation")],
  trajectory: "worsening", reasons: "Current severe instability and relapse risk make a partner-dependent coping plan foreseeably harmful; earlier hospital care alone does not determine this.",
  readiness_markers: ["Current reality testing and self-care remain reliable", "Relapse support and non-romantic regulation work in ordinary life"], ...changes
});
const task = (r = readiness(), changes = {}) => ({
  version: 1, issue: "Considering dating", node_id: "ROUTE.ACT_OUTWARD", kind: "action", phase: "practice", agreement: "accepted", observation_ids: ["O1", "O2"], marker: "Choose a manageable social step", last_response: "Considering the next step", capacity: "adequate", question_focus: "cue",
  action: { step: "Arrange a date", cue: "", size: "One meeting", barriers: "", purpose: "Connection", outcome: "not_reported", result: "", adjustment: "" }, emotion: null, strategy_review: null, relational_readiness: r, ...changes
});
const plan = (r = readiness(), variables = {}, changes = {}) => planFromGraphs({ graphs: bundle.graphs, variables: { ...steady, ...variables }, turnTask: task(r, changes) });
const snapshot = t => ({ user_goal: "Connection", current_issue: t.issue, direct_observations: [{ id: "O1", statement: "Fictional current functioning and harm assessment" }, { id: "O2", statement: "Fictional support and purpose evidence" }], hypotheses: [], unknowns: [], variables: steady, turn_task: t });
const audit = changes => ({ verdict: "pass", summary: "Synthetic audit", safety_flags: [], variable_corrections: [], remove_observation_ids: [], remove_hypothesis_ids: [], add_unknowns: [], corrected_turn_task: null, invalidate_turn_task: false, ...changes });
const advice = (romance, support = "not_addressed", quote = "") => ({ romance, support, evidence_quote: quote });
const response = (p, a, answer = "Pause active romance-seeking while you build reliable non-romantic support.") => ({ answer, next_question: "", realized_nodes: requiredRealizationNodeIds(p).map(id => ({ id, evidence_quote: answer })), relational_advice: { ...a, evidence_quote: answer } });

test("isolated but currently stable client is not blocked from dating", () => {
  const p = plan(); const d = p.executionContract.relationalReadiness;
  assert.equal(d.status, "NOT_BLOCKED"); assert.equal(d.allowRomanceRecommendation, true); assert.equal(d.pauseRomance, false);
  assert.equal(d.nonRomanticSupportAllowed, true);
  const answer = "You can explore dating at a manageable pace while maintaining your friendships and boundaries.";
  assert.equal(enforceResponseContract(response(p, advice("normalize_or_recommend"), answer), { plan: p }).responseContract.realizationCoveragePassed, true);
});

test("current hospitalization/substance/dissociation instability pauses romance but preserves support", () => {
  const p = plan(unstable()); const d = p.executionContract.relationalReadiness;
  assert.equal(d.status, "PAUSE_ROMANCE"); assert.equal(d.allowRomanceRecommendation, false); assert.equal(d.nonRomanticSupportAllowed, true);
  assert.ok(d.reasonCodes.includes("CURRENT_FORESEEABLE_HARM")); assert.deepEqual(d.assessment.harm_to, ["self", "partner"]);
  assert.ok(d.assessment.readiness_markers.length); assert.equal(p.nextQuestion, "");
  assert.doesNotMatch(p.executionContract.taskGuidance.join(" "), /chosen action concrete/);
});

test("partner keeps me sane: evidenced extreme dependency cannot authorize romance as regulation", () => {
  const r = unstable({ risk_signals: [risk("partner_as_regulator")], reasons: "The fictional client relies on a partner as the sole reality anchor and cannot stay safe when unavailable; friendship and skilled support remain available." });
  const p = plan(r);
  assert.equal(p.executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
  assert.equal(p.executionContract.strategyReview.status, "REASSESS_RELATIONAL_DEPENDENCY");
  const ok = enforceResponseContract(response(p, advice("pause", "offer_nonromantic")), { plan: p });
  assert.equal(ok.responseContract.realizationCoveragePassed, true);
  assert.match(p.executionContract.relationalGuidance.join(" "), /analgesic, reality anchor, rescuer or proof of worth/);
});

test("instrumental and mixed socializing override an improving support-building proxy", () => {
  for (const purpose of ["partner_seeking", "mixed"]) {
    const p = plan(readiness({ scope: "support_building", support_purpose: purpose }), {}, { strategy_review: {
      target: "Build non-romantic support", expected_change: "Reliable friendship outside romance", fit: "fitting", fit_observation_ids: ["O1"], outcome: "improving", outcome_observation_ids: ["O2"], review_due: true, alternative_angle: "Mentoring", alternative_node_id: ""
    } });
    assert.equal(p.executionContract.strategyReview.status, "REASSESS_SUPPORT_SUBSTITUTION");
    assert.equal(p.executionContract.relationalReadiness.status, "NOT_BLOCKED");
    assert.equal(p.executionContract.relationalReadiness.supportProgress, "NOT_EQUIVALENT_TO_NONROMANTIC_SUPPORT");
    assert.ok(enforceResponseContract(response(p, advice("not_addressed", "claim_support_progress")), { plan: p }).responseContract.relationalAdviceViolations.includes("SUPPORT_SUBSTITUTION_NOT_PROGRESS"));
    assert.match(p.executionContract.relationalGuidance.join(" "), /separately evidenced friendship gains/);
  }
});

test("new current improvement reopens readiness despite retained historical risk", () => {
  const earlier = snapshot(task(unstable()));
  const laterTask = task(readiness({ trajectory: "improving", risk_signals: [risk("hospitalization", "historical"), risk("substance_dependence_relapse", "historical")], reasons: "Reliable current self-care, reality testing and supports have improved; prior crises remain historical context." }));
  const later = reconcileIssueScope(snapshot(laterTask), earlier);
  assert.equal(plan(earlier.turn_task.relational_readiness).executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
  assert.equal(plan(later.turn_task.relational_readiness).executionContract.relationalReadiness.status, "NOT_BLOCKED");
  assert.equal(plan(later.turn_task.relational_readiness).executionContract.relationalReadiness.pauseCurrent, false);
});

test("all specified current dependency trajectories override claimed relief or improving strategy", () => {
  for (const kind of ["dependency", "relational_preoccupation", "escalating_pursuit", "partner_as_regulator"]) {
    const d = relationalReadinessDecision(readiness({ trajectory: "worsening", risk_signals: [risk(kind)] }));
    assert.equal(d.status, "PAUSE_ROMANCE"); assert.equal(d.adverseTrajectory, true);
    assert.equal(relationalReadinessDecision(readiness({ trajectory: "worsening", risk_signals: [risk(kind, "historical")] })).adverseTrajectory, false);
  }
});

test("unknown stability or harm asks for assessment, without implicit approval or a permanent ban", () => {
  for (const change of [{ current_stability: "unknown", stability_observation_ids: [] }, { foreseeable_harm: "unknown", harm_observation_ids: [] }, { current_stability: "insufficient" }]) {
    const p = plan(readiness(change));
    const d = p.executionContract.relationalReadiness;
    assert.equal(p.nextQuestionSource.type, "relational-readiness");
    assert.match(p.nextQuestion, /daily life and distress/);
    assert.doesNotMatch(p.nextQuestion, /arrange the date|try that step/);
    assert.equal(d.status, "ASSESS_BEFORE_ROMANCE"); assert.equal(d.allowRomanceRecommendation, false); assert.equal(d.pauseRomance, false);
  }
});

test("all affected parties can be traced without automatically inventing children", () => {
  const d = relationalReadinessDecision(unstable({ harm_to: ["self", "partner", "dependent_children", "future_children"] }));
  assert.equal(d.assessment.harm_to.length, 4); assert.equal(readiness().harm_to.length, 0);
});

test("readiness evidence, reasons and reopening markers are structurally required", () => {
  for (const change of [{ stability_observation_ids: [] }, { harm_observation_ids: ["missing"] }, { trajectory_observation_ids: ["O1", "O1"] }, { support_observation_ids: [] }, { supports_observation_ids: [] }, { readiness_markers: [] }, { readiness_markers: [""] }, { review_when: " " }, { reasons: "" }, { harm_to: ["self", "self"] }, { foreseeable_harm: "substantial", harm_to: [] }, { risk_signals: [{ ...risk("hospitalization"), observation_ids: [] }] }, { risk_signals: [risk("diagnosis_permanent_ban")] }, { risk_signals: [risk("hospitalization", "permanent")] }]) {
    assert.throws(() => validateTurnTask(task(readiness(change))), undefined, JSON.stringify(change));
  }
  assert.ok(turnTaskSchema.anyOf[1].required.includes("relational_readiness"));
});

test("audit removes evidence or corrects stale readiness and new issue resets assessment", () => {
  const s = snapshot(task(unstable()));
  assert.equal(applyCaseAudit(s, audit({ remove_observation_ids: ["O1"] })).turn_task, null);
  assert.equal(applyCaseAudit(s, audit({ invalidate_turn_task: true })).turn_task, null);
  const corrected = applyCaseAudit(s, audit({ corrected_turn_task: task(readiness()) }));
  assert.equal(plan(corrected.turn_task.relational_readiness).executionContract.relationalReadiness.status, "NOT_BLOCKED");
  assert.equal(reconcileIssueScope(snapshot(task(readiness(), { issue: "A different issue" })), s).turn_task.relational_readiness, null);
});

test("readiness is audited with no strategy review even on requested fast mode", () => {
  const s = snapshot(task());
  assert.equal(classifyTherapyTier(s, "fast").tier, "reviewed");
  assert.equal(classifyTherapyTier(s, "auto").tier, "reviewed");
  assert.equal(classifyTherapyTier({ ...s, variables: { ...steady, dissociation: "high" } }, "fast").tier, "forensic");
});

test("outward, relational and emergency routes retain independent readiness constraints", () => {
  for (const variables of [{}, { other_person_central: "yes", relational_check_status: "pending" }, { present_safety: "unsafe" }, { suicidal_state: "imminent" }, { dissociation: "high" }]) {
    const p = plan(unstable(), variables, { node_id: "IC.BEST_FRIEND_PERSPECTIVE" });
    assert.equal(p.executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
    assert.ok(p.executionContract.relationalGuidance.length);
    assert.deepEqual(requiredRealizationNodeIds(p), [p.primaryJob.id]);
  }
  assert.equal(plan(readiness(), { present_safety: "unsafe" }).executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
  assert.equal(plan(readiness(), { suicidal_state: "intent" }).executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
});

test("refusal/closure cannot restore a dating cue or bypass readiness", () => {
  for (const change of [{ agreement: "declined" }, { phase: "close" }]) {
    const p = plan(unstable(), {}, change);
    assert.equal(p.nextQuestion, ""); assert.equal(p.executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
    assert.ok(enforceResponseContract(response(p, advice("normalize_or_recommend")), { plan: p }).responseContract.relationalAdviceViolations.includes("ROMANCE_NOT_READY"));
  }
});

test("relational review without an external route does not force an inward exercise", () => {
  const p = plan(unstable(), { actionable_problem: "absent", self_criticism: "present", inner_adult_access: "available" }, { node_id: "IC.BEST_FRIEND_PERSPECTIVE" });
  assert.equal(p.executionContract.strategyReview.mode, "review_before_exercise");
  assert.deepEqual(requiredRealizationNodeIds(p), []);
});

test("legacy task records and installed packet graphs keep their bounded prior contract", () => {
  const t = task(); delete t.relational_readiness;
  assert.deepEqual(validateTurnTask(t), t);
  assert.equal(planFromGraphs({ graphs: bundle.graphs, variables: steady, turnTask: t }).executionContract.relationalReadiness, undefined);
  const legacy = bundle.graphs.map(({ taskPolicyVersion, ...g }) => g);
  assert.deepEqual(planFromGraphs({ graphs: legacy, variables: steady, turnTask: task(unstable()) }), planFromGraphs({ graphs: legacy, variables: steady }));
});

test("actual plan/prompt seams carry evidence, correction and separate support constraints", async () => {
  const s = snapshot(task(unstable()));
  const { plan: p } = await planCaseSnapshot(s, { loadPlanningGraphBundle: async () => bundle });
  const c = { guideManifest: { version: "fictional-test" }, guideExcerpts: "", userFacts: [], userMessage: "Fictional dating question", priorCaseSnapshot: s, interventionContract: p, priorInterventionContract: p };
  assert.match(caseExtractionPrompt(c).system, /collapsed both into one variable/);
  assert.match(caseAuditPrompt(c, s).system, /Generic connection benefits do not override case-specific harm/);
  const prompt = realizationPrompt(c, {}, "fixture");
  assert.match(prompt.user, /PAUSE_ROMANCE/); assert.match(prompt.user, /review_when/);
  assert.match(prompt.system, /not an action to schedule/); assert.match(prompt.system, /relational_advice/);
  assert.match(p.executionContract.relationalGuidance.join(" "), /Do not advise isolation/);
});

test("response enforcement rejects risky endorsement, unsupported bans and proxy progress", () => {
  const p = plan(unstable());
  assert.ok(enforceResponseContract(response(p, advice("normalize_or_recommend")), { plan: p }).responseContract.relationalAdviceViolations.includes("ROMANCE_NOT_READY"));
  const ready = plan();
  assert.ok(enforceResponseContract(response(ready, advice("pause")), { plan: ready }).responseContract.relationalAdviceViolations.includes("UNSUPPORTED_ROMANCE_PAUSE"));
  for (const a of [undefined, {}, { ...advice("pause"), evidence_quote: "not in answer" }, { ...advice("pause"), invalid: true }, advice("approved")]) {
    const r = response(p, advice("pause")); r.relational_advice = a;
    assert.equal(enforceResponseContract(r, { plan: p }).responseContract.realizationCoveragePassed, false);
  }
});

function renderer(outputs) {
  const calls = [];
  return { calls, provider: { id: "openai", model: "fixture-readiness-renderer", async generate(request) {
    calls.push(request); assert.ok(calls.length <= outputs.length); return { text: JSON.stringify(outputs[calls.length - 1]), requestId: `fictional-${calls.length}` };
  } } };
}
test("valid support/pause reaches delivery on first call with required advice schema", async () => {
  const p = plan(unstable()); const { calls, provider } = renderer([response(p, advice("pause", "offer_nonromantic"))]);
  const r = await realizeAdjudication({ context: { interventionContract: p }, adjudication: {}, provider });
  assert.equal(calls.length, 1); assert.ok(calls[0].outputSchema.required.includes("relational_advice"));
  assert.equal(r.value.responseContract.relationalReadinessStatus, "PAUSE_ROMANCE");
});
test("unsafe recommendation receives one corrective retry and corrected advice can release", async () => {
  const p = plan(unstable()); const { calls, provider } = renderer([response(p, advice("normalize_or_recommend")), response(p, advice("pause", "offer_nonromantic"))]);
  const r = await realizeAdjudication({ context: { interventionContract: p }, adjudication: {}, provider });
  assert.equal(calls.length, 2); assert.match(calls[1].user, /relational-readiness-retry/); assert.match(calls[1].user, /Correct the advice itself/);
  assert.equal(r.value.responseContract.realizationCoveragePassed, true);
});
test("repeated unsafe or missing declarations block delivery after two calls", async () => {
  const p = plan(unstable());
  for (const a of [advice("normalize_or_recommend"), undefined]) {
    const r = response(p, advice("pause")); r.relational_advice = a;
    const { calls, provider } = renderer([r, r]);
    await assert.rejects(realizeAdjudication({ context: { interventionContract: p }, adjudication: {}, provider }), error => error.code === "RELATIONAL_READINESS_ADVICE_BLOCKED");
    assert.equal(calls.length, 2);
  }
});

test("new dating issue retains fresh assessed evidence through actual extraction and audit routing", async () => {
  const prior = snapshot(task(null, { issue: "A work decision" }));
  const next = snapshot(task(unstable()));
  prior.direct_observations = prior.direct_observations.map(item => ({ ...item, evidence: "Fictional earlier work discussion" }));
  next.direct_observations = next.direct_observations.map(item => ({ ...item, evidence: "Fictional newly reported instability and dating plan" }));
  const provider = { id: "openai", model: "fixture-extractor", async generate() { return { text: JSON.stringify(next), requestId: "synthetic-extraction" }; } };
  const context = { guideManifest: { version: "test" }, guideExcerpts: "", userFacts: [], userMessage: "Fictional new dating question", priorCaseSnapshot: prior };
  const result = await runCaseExtraction({ context, provider });
  assert.equal(result.value.turn_task.relational_readiness.foreseeable_harm, "substantial");
  assert.equal(classifyTherapyTier(result.value, "fast").tier, "reviewed");
  const planned = await planCaseSnapshot(result.value, { loadPlanningGraphBundle: async () => bundle });
  assert.equal(planned.plan.executionContract.relationalReadiness.status, "PAUSE_ROMANCE");
  const inherited = { ...next, direct_observations: prior.direct_observations };
  assert.equal(reconcileIssueScope(inherited, prior).turn_task.relational_readiness, null);
});

test("actual separately evidenced friendship gains survive a mixed support-goal reassessment", async () => {
  const p = plan(readiness({ scope: "support_building", support_purpose: "mixed" }));
  const answer = "You did develop a reliable friendship. Pursuing a partner still has not met the non-romantic support goal.";
  const r = response(p, advice("not_addressed", "acknowledge_partial_friendship_gain"), answer);
  assert.equal(enforceResponseContract(r, { plan: p }).responseContract.realizationCoveragePassed, true);
  const { provider } = renderer([r]);
  assert.equal((await realizeAdjudication({ context: { interventionContract: p }, adjudication: {}, provider })).value.answer, answer);
});

test("deep and forensic result fields cannot resurrect the suppressed dating cue", async () => {
  const p = plan(unstable());
  const staleQuestion = "When will you arrange the date?";
  const candidate = { direct_observations: [], interpretive_hypotheses: [], guide_basis: [], unresolved_questions: [staleQuestion], proposed_intervention: "Synthetic stale dating advice", response_draft: "Synthetic stale proposal", risk_flags: [] };
  const critique = { strongest_insights: [], unsupported_assignments: [], generic_therapy_scripts: [], missed_user_language: [], premature_siding: [], age_or_agency_conflations: [], guide_misapplications: [], safety_or_memory_risks: [], required_corrections: [], verdict: "revise" };
  const adjudication = { answer: "Synthetic stale draft", what_is_clear: [], uncertainties: [], next_question: staleQuestion, accepted_insights: [], rejected_claims: [], safety_flags: [], decision_summary: "Synthetic test adjudication" };
  for (const run of [runCompactAdversarialPipeline, runAdversarialPipeline]) {
    const calls = [];
    const provider = { id: "openai", model: "fixture-pipeline", async generate(request) {
      calls.push(request);
      const stage = request.metadata.stage;
      const value = stage === "realization" ? response(p, advice("pause", "offer_nonromantic"))
        : stage === "adjudication" ? adjudication : stage.includes("critique") ? critique : candidate;
      return { text: JSON.stringify(value), requestId: `fictional-${calls.length}` };
    } };
    const result = await run({ context: { guideManifest: { version: "fictional-test" }, guideExcerpts: "", recentTranscript: "", userFacts: [], userMessage: "Fictional dating task", interventionContract: p }, providers: { openai: provider, anthropic: provider, renderer: provider }, config: { ledgerMode: "off", adjudicatorProvider: "openai" } });
    assert.equal(result.next_question, ""); assert.doesNotMatch(result.answer, /arrange the date/);
    if (run === runCompactAdversarialPipeline) assert.equal(result.adjudicationPacket.next_question, "");
    assert.equal(result.responseContract.relationalReadinessStatus, "PAUSE_ROMANCE");
  }
});


test("new dating question with no stability evidence retains assessment-needed gate", async () => {
  const prior = snapshot(task(null, { issue: "A work decision" }));
  const r = readiness({ current_stability: "unknown", stability_observation_ids: [], foreseeable_harm: "unknown", harm_observation_ids: [], trajectory: "unknown", trajectory_observation_ids: [], support_purpose: "unknown", support_observation_ids: [], supports: "", supports_observation_ids: [], reasons: "The new question establishes interest in dating; current readiness has not been assessed." });
  const next = snapshot(task(r));
  next.direct_observations = next.direct_observations.map(item => ({ ...item, evidence: "Fictional first dating question", statement: "New dating request without functioning evidence" }));
  const provider = { id: "openai", model: "fixture-extractor", async generate() { return { text: JSON.stringify(next), requestId: "synthetic-unknown" }; } };
  const context = { guideManifest: { version: "test" }, guideExcerpts: "", userFacts: [], userMessage: "Fictional initial dating request", priorCaseSnapshot: prior };
  const extracted = (await runCaseExtraction({ context, provider })).value;
  assert.equal(classifyTherapyTier(extracted, "fast").tier, "reviewed");
  const { plan: p } = await planCaseSnapshot(extracted, { loadPlanningGraphBundle: async () => bundle });
  assert.equal(p.executionContract.relationalReadiness.status, "ASSESS_BEFORE_ROMANCE");
  assert.equal(p.nextQuestionSource.type, "relational-readiness");
  for (const change of [{ phase: "close" }, { agreement: "declined" }, { question_focus: "none" }]) {
    assert.equal(plan(r, {}, change).nextQuestion, "");
  }
});
