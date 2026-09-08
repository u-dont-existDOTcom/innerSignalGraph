import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { evaluatePathPerformance, validatePathUpdate, pathUpdateSchema, pathPerformanceGuidance, performanceQuestion, FAILURE_SOURCES } from "../src/case-formulation/path-performance.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs, deriveCaseVariables } from "../src/guide-graph/planner.mjs";
import { runCaseExtraction, applyCaseAudit, planCaseSnapshot } from "../src/case-formulation/run.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";
import { requiredRealizationNodeIds } from "../src/orchestrator/response-contract.mjs";
import { caseSnapshotSchema } from "../src/case-formulation/schemas.mjs";
import { validateGraph } from "../src/guide-graph/validate.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";

const bundle = await compileGuideGraphs({ write: false });
const steady = deriveCaseVariables({ ...blankCaseVariables(), present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent", activation: "low", dissociation: "none", altered_state: "sober", inner_adult_access: "available", witness_capacity: "present", coherent_child_state: "present", body_capacity: "adequate", current_intent: "conversation", other_person_central: "no", influence_domain: "none", actionable_problem: "absent", unresolved_inner_material: "present", attention_loop: "absent", inward_attention_effect: "neutral" });
const observations = Array.from({ length: 40 }, (_, i) => `O${i + 1}`).map(id => ({ id, statement: "Synthetic reported response", evidence: "Synthetic example only" }));
const observationIds = new Set(observations.map(o => o.id));
const strategy = (patch = {}) => ({ process_id: "self-attack", target: "access the blocked need", formulation: "Care may soften self-attack enough to identify a need", family: "responsive_care", node_id: "ROUTE.GO_INWARD", selection_reason: "The person reports self-attack and asks for care", observation_ids: ["O1"], predictions: [{ id: "P1", sign: "need_access", description: "Identify a previously blocked need", horizon: "immediate" }], adverse_signs: ["dissociation", "shame"], ...patch });
const update = (signals = [], patch = {}) => ({ strategy: null, response: "meaningful", signals, failure_hypotheses: [], probe: null, ...patch });
const signal = (kind, patch = {}) => ({ observation_id: "O2", kind, prediction_id: "", timing: "immediate", severity: "ordinary", ...patch });
const review = (prior, u, variables = steady, extra = {}) => {
 const fresh = u ? structuredClone(u) : null;
 if (fresh && prior?.active) for (const s of fresh.signals) if (s.observation_id === "O2") s.observation_id = `O${prior.active.review_count + 2}`;
 return evaluatePathPerformance({ prior, update: fresh, variables, observationIds, ...extra });
};
const start = (s = strategy()) => {
 const state = review(null, update([], { strategy: s, response: "not_observed" }));
 state.active.delivery = { node_id: s.node_id, review: 0, evidence: "synthetic_delivered_intervention" };
 return state;
};
const plan = (control, variables = steady, turnTask = null) => planFromGraphs({ graphs: bundle.graphs, variables, pathPerformance: control, turnTask, unknowns: [{ variable: "hidden_process", question: "Go deeper into that image?", importance: 5 }] });
const miss = () => [signal("prediction_failed", { prediction_id: "P1" }), signal("low_information"), signal("praise")];

// These deterministic cases exercise policy against supplied observations, not LLM understanding or clinical benefit.
test("prospective strategy episode contains target, hypothesis, path, reasons, signs and bound trace", () => {
 const s = start(); assert.equal(s.active.id, "strategy-1"); assert.equal(s.latest.status, "UNCLEAR"); assert.equal(s.latest.decision, "CONTINUE");
 const next = review(s, update([signal("need_access", { prediction_id: "P1" })]));
 assert.equal(next.latest.status, "MOVING"); assert.equal(next.latest.decision, "CONTINUE");
 assert.equal(next.latest.predictions[0].episode_id, s.active.id); assert.deepEqual(next.latest.predictions[0].observation_ids, ["O2"]);
 assert.equal(next.latest.predictions[0].result, "SUPPORTED"); assert.equal(next.latest.human_evaluation, "NOT_ESTABLISHED_BY_DETERMINISTIC_TRACE");
 assert.equal(s.active.review_count, 0, "pure evaluator must preserve input for rollback/replay");
});

test("cooperation, praise and cosmetic changes cannot erase two failed opportunities", () => {
 let s = start();
 for (let i = 0; i < 2; i++) s = review(s, update(miss(), { strategy: strategy({ formulation: `A more elegant wording ${i}`, node_id: "IC.BORROW_ONE_FUNCTION" }) }));
 assert.equal(s.active.id, "strategy-1"); assert.equal(s.active.strategy.formulation, strategy().formulation);
 assert.equal(s.active.misses, 2); assert.equal(s.latest.status, "STALLED"); assert.equal(s.latest.decision, "SWITCH");
 assert.ok(s.latest.failure_sources.some(f => f.kind === "FORMULATION_MISMATCH"));
 assert.deepEqual(plan(s).executionContract.requiredNodeIds, ["ROUTE.THREE_WAY_GATE"]);
 assert.equal(plan(s).executionContract.contextNodeIds.length, 0);
});

test("apparent relief conflicts with mechanism prediction and is never success", () => {
 const s = review(start(), update([signal("relief"), signal("praise"), signal("prediction_failed", { prediction_id: "P1" })]));
 assert.notEqual(s.latest.status, "MOVING"); assert.equal(s.latest.predictions[0].result, "CONTRADICTED");
 assert.equal(s.active.misses, 1);
});

test("durable outcome cannot be inferred or falsified from immediate response", () => {
 const initial = start(strategy({ predictions: [{ id: "P1", sign: "agency", description: "Chooses independently later", horizon: "durable" }] }));
 const immediate = review(initial, update([signal("agency", { prediction_id: "P1" }), signal("prediction_failed", { prediction_id: "P1" })]));
 assert.equal(immediate.latest.predictions[0].result, "UNOBSERVED"); assert.equal(immediate.active.misses, 0);
 const later = review(initial, update([signal("agency", { prediction_id: "P1", timing: "durable" })]));
 assert.equal(later.latest.status, "MOVING");
});

test("repeated low-information I don't know responses force reformulation without a complaint", () => {
 let s = start();
 for (let i = 0; i < 2; i++) s = review(s, update([signal("low_information"), signal("repetition")]));
 assert.equal(s.latest.status, "STALLED"); assert.equal(s.latest.route, "reconsider");
 assert.ok(s.latest.reconsider.includes("formulation")); assert.ok(s.latest.reconsider.includes("external_stabilization"));
});

test("complexity rises while client information falls: switch even with one matching signal", () => {
 const s = review(start(), update([signal("complexity_without_information"), signal("need_access", { prediction_id: "P1" }), signal("praise")]));
 assert.equal(s.latest.decision, "SWITCH"); assert.equal(s.latest.status, "STALLED");
});

test("significant dissociation/fragmentation overrides praise, movement, old task, and inward question", () => {
 const s = review(start(), update([signal("dissociation", { severity: "significant" }), signal("fragmentation", { severity: "significant" }), signal("need_access", { prediction_id: "P1" }), signal("praise")]));
 assert.equal(s.latest.status, "ADVERSE"); assert.equal(s.latest.decision, "STOP_DEESCALATE");
 const p = plan(s); assert.equal(p.primaryJob.id, "IC.SAFETY_ORIENTATION");
 assert.equal(p.nextQuestion, ""); assert.equal(p.executionContract.task, null);
 assert.deepEqual(requiredRealizationNodeIds(p), ["IC.SAFETY_ORIENTATION"]);
 assert.match(p.executionContract.taskGuidance.join(" "), /No deeper imagery/);
});

test("external stabilization replaces deeper inner work and actionable safety retains precedence", () => {
 const s = review(start(), update([signal("external_stabilization_needed")]));
 assert.equal(plan(s).primaryJob.id, "ROUTE.EXTERNAL_EMBODIMENT");
 const outward = review(start(), update([signal("external_stabilization_needed")]), { ...steady, actionable_problem: "present" });
 assert.equal(plan(outward, { ...steady, actionable_problem: "present" }).primaryJob.id, "ROUTE.ACT_OUTWARD");
 const unsafe = review(start(), update([signal("external_stabilization_needed")]), { ...steady, present_safety: "unsafe" });
 assert.equal(plan(unsafe, { ...steady, present_safety: "unsafe" }).primaryJob.id, "IC.SAFETY_ORIENTATION");
});

const romanceSignals = ["significant_instability", "external_regulation_dependency", "loneliness", "relapse_or_dissociation_risk", "romance_as_regulator", "instrumental_partner_seeking"].map(k => signal(k));
test("synthetic full instability pattern pauses romance seeking and preserves supervised non-romantic community", () => {
 const s = review(start(), update([...romanceSignals, signal("functional_change"), signal("relief"), signal("praise")]));
 assert.equal(s.latest.goal_substitution.romance_pause, true); assert.equal(s.latest.goal_substitution.instrumental_socializing, true);
 assert.equal(s.latest.decision, "SWITCH"); assert.notEqual(s.latest.status, "MOVING");
 const p = plan(s); assert.equal(p.primaryJob.id, "ROUTE.ACT_OUTWARD");
 const g = p.executionContract.taskGuidance.join(" "); assert.match(g, /pausing active romance-seeking/); assert.match(g, /Do not advise isolation/);
 assert.match(g, /supervised,? non-romantic/); assert.match(g, /verify local suitability and availability/);
 const prompt = realizationPrompt({ userMessage: "Synthetic request", interventionContract: p }, {}, "test");
 assert.match(prompt.user, /goal substitution/); assert.match(prompt.user, /humanUsefulnessEstablished/);
});

test("loneliness, desire for romance or support alone cannot activate the case prohibition", () => {
 for (const missing of romanceSignals.slice(0, 5)) {
  const s = review(start(), update(romanceSignals.filter(s => s.kind !== missing.kind)));
  assert.equal(s.latest.goal_substitution.romance_pause, false, missing.kind);
  assert.doesNotMatch(pathPerformanceGuidance(s).join(" "), /recommend pausing active romance-seeking/);
 }
});

test("delivery or pacing adjustment requires separate mechanism support, cannot evade accumulated failure", () => {
 const delivery = update([signal("mechanism_supported"), signal("delivery_problem")]);
 assert.equal(review(start(), delivery).latest.decision, "ADJUST_DELIVERY");
 assert.equal(review(start(), update([signal("delivery_problem")])).latest.decision, "PROBE");
 let s = review(start(), update(miss())); s = review(s, update(miss()));
 assert.equal(review(s, delivery).latest.decision, "SWITCH");
 assert.equal(review(start(), update([signal("mechanism_supported"), signal("dose_problem")])).latest.failure_sources[0].kind, "PACING_MISMATCH");
});

test("a cheap discriminating probe must map alternative outcomes to different actions", () => {
 const probe = { question: "Would space or practical help change what feels possible?", alternatives: [
  { hypothesis: "care is intrusive", if_observed: "space restores contact", next_strategy: "distant care" },
  { hypothesis: "external load dominates", if_observed: "practical help restores choice", next_strategy: "practical support" }
 ] };
 const s = review(start(), update([], { probe })); assert.equal(performanceQuestion(s), probe.question);
 const duplicate = structuredClone(s); duplicate.latest.probe.alternatives[1].next_strategy = "distant care";
 assert.notEqual(performanceQuestion(duplicate), probe.question);
});

test("after a switch, evidence can admit a materially different strategy and cannot re-admit known failed identity", () => {
 let s = review(start(), update(miss())); s = review(s, update(miss()));
 const next = strategy({ target: "practical support", formulation: "external load blocks attention", family: "stabilization", node_id: "ROUTE.ACT_OUTWARD" });
 const replacement = review(s, update([signal("alternative_supported")], { strategy: next }));
 assert.equal(replacement.active.id, "strategy-2"); assert.equal(replacement.closed[0].episode_id, "strategy-1");
 assert.equal(replacement.latest.predictions.length, 0, "no retrospective confirmation");
 replacement.active.delivery = { node_id: next.node_id, review: 0, evidence: "synthetic_delivered_intervention" };
 let stalledAgain = review(replacement, update(miss())); stalledAgain = review(stalledAgain, update(miss()));
 const old = review(stalledAgain, update([signal("alternative_supported")], { strategy: strategy() }));
 assert.equal(old.active.id, "strategy-2"); assert.equal(old.latest.decision, "SWITCH");
});

test("missing observation starts uncertain and bounded repeated unmeasured response stops exercise", () => {
 const first = review(start(), null); assert.equal(first.latest.status, "UNCLEAR"); assert.equal(first.active.misses, 0);
 const second = review(first, null); assert.equal(second.latest.status, "STALLED"); assert.equal(second.active.misses, 0);
 assert.equal(second.latest.predictions[0].result, "UNOBSERVED");
});

test("completed checking closes only the process and respects external/safety facts", () => {
 const vars = deriveCaseVariables({ ...steady, attention_loop: "present", thinking_yield: "repetitive_no_new_output", loop_target_relation: "distinct_repetitive_process", relational_check_status: "completed" });
 const s = review(start(), update([signal("process_complete")]), vars);
 assert.equal(s.latest.decision, "CLOSE"); assert.equal(plan(s, vars).primaryJob.id, "ROUTE.LEAVE_ALONE");
 assert.equal(plan(s, vars).variables.unresolved_inner_material, "present"); assert.equal(plan(s, vars).nextQuestion, "");
 assert.notEqual(review(start(), update([signal("process_complete")])).latest.decision, "CLOSE");
});

test("strict schema/validator reject fabricated references and invented counters", () => {
 const valid = update([], { strategy: strategy() }); const schemaValidate = new Ajv().compile(pathUpdateSchema);
 assert.equal(schemaValidate(valid), true); assert.deepEqual(validatePathUpdate(valid, observationIds), valid);
 for (const bad of [{ ...valid, misses: 0 }, { ...valid, signals: [signal("invented")] }, { ...valid, strategy: strategy({ predictions: [] }) }]) {
  assert.equal(schemaValidate(bad), false); assert.throws(() => validatePathUpdate(bad, observationIds));
 }
 assert.throws(() => validatePathUpdate(update([signal("praise", { observation_id: "missing" })]), observationIds), /unavailable/);
 assert.equal(caseSnapshotSchema.required.includes("path_update"), true);
 assert.deepEqual(FAILURE_SOURCES, ["FORMULATION_MISMATCH", "TARGET_MISMATCH", "METHOD_MISMATCH", "PACING_MISMATCH", "DELIVERY_MISMATCH", "REPRESENTATION_MISMATCH", "STATE_CONSTRAINT", "PROCESS_COMPLETE"]);
});

const snapshot = u => ({ user_goal: "understand the current process", current_issue: "self-attack", direct_observations: observations, variables: steady, hypotheses: [], unknowns: [], turn_task: null, path_update: u });
const audit = patch => ({ remove_observation_ids: [], remove_hypothesis_ids: [], variable_corrections: [], add_unknowns: [], verdict: "accept", summary: "Synthetic evidence review", safety_flags: [], ...patch });
test("incremental extraction preserves episode despite renamed issue; audited removal invalidates dependent evidence", async () => {
 const prior = start();
 const provider = { id: "test", model: "synthetic", generate: async () => ({ text: JSON.stringify({ ...snapshot(update(miss())), current_issue: "cosmetic new label" }) }) };
 const context = { priorCaseSnapshot: { ...snapshot(null), path_performance: prior }, guideManifest: { version: "test" }, guideExcerpts: "", userFacts: [], userMessage: "Synthetic low-information reply" };
 const extracted = await runCaseExtraction({ context, provider });
 assert.equal(extracted.value._path_prior.active.id, prior.active.id);
 const corrected = applyCaseAudit(extracted.value, audit({ remove_observation_ids: ["O2"] }));
 const result = await planCaseSnapshot(corrected, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(result.plan.pathPerformance.status, "STALLED");
 assert.equal(corrected.path_performance.active.invalidated, true);
 assert.equal(corrected._path_prior, undefined);
 assert.equal(result.plan.pathPerformance.predictions[0].result, "UNOBSERVED");
 assert.ok(!result.plan.pathPerformance.observed_signals.some(s => s.observation_id === "O2"));
});

test("existing case pipeline attaches state and trace; legacy graph cannot activate candidate policy", async () => {
 const s = snapshot(update([], { strategy: strategy(), response: "not_observed" }));
 const result = await planCaseSnapshot(s, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(s.path_performance.active.id, "strategy-1"); assert.equal(result.plan.pathPerformance.episode_id, "strategy-1");
 const legacy = { ...bundle, graphs: bundle.graphs.map(({ pathPerformancePolicyVersion, ...g }) => g) };
 const old = snapshot(update([], { strategy: strategy() }));
 const legacyResult = await planCaseSnapshot(old, { loadPlanningGraphBundle: async () => legacy });
 assert.equal(legacyResult.plan.pathPerformance, undefined); assert.equal(old.path_performance, undefined);
 const graph = structuredClone(bundle.graphs[0]); graph.pathPerformancePolicyVersion = 2;
 assert.throws(() => validateGraph(graph), /Unsupported path-performance/);
});

import { realizeAdjudication } from "../src/orchestrator/run-pipeline.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";

test("one failed key prediction is not washed out by an unrelated success between failures", () => {
 const initial = start(strategy({ predictions: [...strategy().predictions, { id: "P2", sign: "specificity", description: "Describe the situation", horizon: "immediate" }] }));
 let s = review(initial, update([signal("prediction_failed", { prediction_id: "P1" })]));
 s.active.delivery.review = s.active.review_count;
 s = review(s, update([signal("specificity", { prediction_id: "P2" })]));
 s.active.delivery.review = s.active.review_count;
 s = review(s, update([signal("prediction_failed", { prediction_id: "P1" })]));
 assert.equal(s.latest.status, "STALLED"); assert.equal(s.active.prediction_failures.P1, 2);
});

test("signal support cannot count on a not-observed turn; unknown prediction references fail", () => {
 const s = review(start(), update([signal("need_access", { prediction_id: "P1" })], { response: "not_observed" }));
 assert.notEqual(s.latest.status, "MOVING"); assert.equal(s.latest.predictions[0].result, "UNOBSERVED");
 assert.throws(() => review(start(), update([signal("need_access", { prediction_id: "invented" })])), /unknown prior prediction/);
});

test("significant path destabilization cannot be forced into fast processing", () => {
 assert.equal(classifyTherapyTier(snapshot(update([signal("dissociation", { severity: "significant" })])), "fast").tier, "forensic");
});

test("hostile renderer cannot return an explicitly repeated old intervention after a stop", async () => {
 const control = review(start(), update([signal("fragmentation", { severity: "significant" })]));
 const p = plan(control);
 const answer = "Stop the exercise and orient to the room. Then return to the same inner image and intensify it.";
 const realization = { answer, next_question: "Deeper?", realized_nodes: [
  { id: "IC.SAFETY_ORIENTATION", evidence_quote: "Stop the exercise and orient to the room." },
  { id: "IC.DEEP_CHILD_DIALOGUE", evidence_quote: "Then return to the same inner image and intensify it." }
 ] };
 assert.equal(enforceResponseContract(realization, { plan: p }).responseContract.pathPerformanceAdherencePassed, false);
 let calls = 0;
 const provider = { id: "test", model: "synthetic-hostile-renderer", generate: async () => { calls++; return { text: JSON.stringify(realization) }; } };
 await assert.rejects(() => realizeAdjudication({ context: { userMessage: "Synthetic", interventionContract: p }, adjudication: {}, provider }), e => e.code === "PATH_PERFORMANCE_REALIZATION_BLOCKED");
 assert.equal(calls, 2, "one bounded repair attempt then block");
});

test("case pipeline cannot admit a strategy for a nonexistent graph node", async () => {
 const s = snapshot(update([], { strategy: strategy({ node_id: "MADE_UP" }) }));
 await assert.rejects(() => planCaseSnapshot(s, { loadPlanningGraphBundle: async () => bundle }), /outside the current graph/);
});

test("R1: high-priority love horizon cannot preempt safety or external stabilization", () => {
 const v = { ...steady, spiritual_curiosity: "present", deep_love_access: "none_known" };
 const stop = review(start(), update([signal("dissociation", { severity: "significant" })]), v);
 assert.equal(plan(stop, v).primaryJob.id, "IC.SAFETY_ORIENTATION");
 const external = review(start(), update([signal("external_stabilization_needed")]), v);
 assert.equal(plan(external, v).primaryJob.id, "ROUTE.EXTERNAL_EMBODIMENT");
});

test("R2: proposal cannot receive outcome credit before verified execution, or for another node", async () => {
 const s = review(null, update([], { strategy: strategy(), response: "not_observed" }));
 assert.notEqual(review(s, update([signal("need_access", { prediction_id: "P1" })])).latest.status, "MOVING");
 const snap = snapshot(update([], { strategy: strategy() }));
 const { plan: p } = await planCaseSnapshot(snap, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(p.primaryJob.id, snap.path_performance.active.strategy.node_id);
 const body = "Stay with the current supported process at the agreed pace.";
 const provider = { id: "test", model: "synthetic", generate: async () => ({ text: JSON.stringify({ answer: body, next_question: "", realized_nodes: [{ id: p.primaryJob.id, evidence_quote: body }] }) }) };
 await realizeAdjudication({ context: { userMessage: "Synthetic", caseFormulation: snap, interventionContract: p }, adjudication: {}, provider });
 assert.equal(snap.path_performance.active.delivery.node_id, p.primaryJob.id);
 assert.equal(review(snap.path_performance, update([signal("need_access", { prediction_id: "P1" })])).latest.status, "MOVING");
 const mismatch = snapshot(update([], { strategy: strategy({ node_id: "IC.DEEP_CHILD_DIALOGUE" }) }));
 const replanned = await planCaseSnapshot(mismatch, { loadPlanningGraphBundle: async () => bundle });
 assert.notEqual(replanned.plan.pathPerformance.decision, "CONTINUE");
 assert.equal(mismatch.path_performance.active.delivery, null);
});

test("R3: withdrawing prior-only support invalidates episode even if current signals use another observation", async () => {
 const snap = { ...snapshot(update([signal("need_access", { prediction_id: "P1" })])), _path_prior: start() };
 const corrected = applyCaseAudit(snap, audit({ remove_observation_ids: ["O1"] }));
 const { plan: p } = await planCaseSnapshot(corrected, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(p.pathPerformance.status, "STALLED"); assert.notEqual(p.pathPerformance.decision, "CONTINUE");
 assert.equal(corrected.path_performance.active.invalidated, true);
});

test("R4: scoped romance-regulation risk persists across silence and only explicit durable reassessment clears it", () => {
 const initial = review(start(), update(romanceSignals));
 const later = review(initial, update([signal("praise")]));
 assert.equal(later.latest.goal_substitution.romance_pause, true);
 assert.equal(later.latest.goal_substitution.instrumental_socializing, true);
 assert.match(pathPerformanceGuidance(later).join(" "), /pausing active romance-seeking/);
 const shallow = review(later, update([signal("romance_regulation_risk_cleared"), signal("relief")]));
 assert.equal(shallow.latest.goal_substitution.romance_pause, true);
 const reassessed = review(later, update([signal("romance_regulation_risk_cleared"), signal("durable_movement", { timing: "durable" }), signal("agency", { timing: "durable" })]));
 assert.equal(reassessed.latest.goal_substitution.romance_pause, false);
});

test("R5: explicit different process has fresh predictions; returning restores old failed evidence", () => {
 let old = review(start(), update(miss())); old = review(old, update(miss()));
 const different = strategy({ process_id: "planning-rest", target: "rest", formulation: "Feasible rest may support recovery", family: "practical_planning", node_id: "ROUTE.ACT_OUTWARD" });
 const next = review(old, update([signal("new_process")], { strategy: different }));
 assert.equal(next.active.strategy.process_id, "planning-rest"); assert.equal(next.active.misses, 0);
 assert.equal(next.latest.predictions.length, 0); assert.equal(next.closed[0].episode_id, old.active.id);
 const back = review(next, update([signal("new_process")], { strategy: strategy() }));
 assert.equal(back.active.id, old.active.id); assert.equal(back.active.misses, 2);
 assert.equal(back.latest.status, "STALLED"); assert.equal(back.latest.decision, "SWITCH");
});

test("R6: failed external action is reformulated instead of issuing the same action route", () => {
 const v = { ...steady, actionable_problem: "present" };
 let s = start(strategy({ family: "action_planning", node_id: "ROUTE.ACT_OUTWARD" }));
 s = review(s, update(miss()), v); s = review(s, update(miss()), v);
 assert.equal(s.latest.route, "reconsider"); assert.equal(plan(s, v).primaryJob.id, "ROUTE.THREE_WAY_GATE");
});

test("candidate live extraction cannot silently omit tracking; explicit missing proposal allows assessment only", async () => {
 const value = snapshot(null); delete value.path_update;
 const provider = { id: "test", model: "synthetic", generate: async () => ({ text: JSON.stringify(value) }) };
 await assert.rejects(() => runCaseExtraction({ context: { pathPerformanceEnabled: true, guideManifest: { version: "test" }, userFacts: [] }, provider }), e => /must declare path_update/.test(e.cause?.message ?? e.message));
 const assessment = snapshot(null);
 const { plan: p } = await planCaseSnapshot(assessment, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(p.primaryJob.id, "ROUTE.THREE_WAY_GATE"); assert.equal(p.pathPerformance.status, "UNCLEAR");
 assert.equal(p.pathPerformanceContract.prohibit_prior_exercise, true);
});

test("a formulation/target/family paraphrase cannot reset a stalled episode on the same path", () => {
 let s = review(start(), update(miss())); s = review(s, update(miss()));
 const paraphrase = strategy({ formulation: "More elaborate care explanation", target: "A renamed version of the same need", family: "new label" });
 const next = review(s, update([signal("alternative_supported")], { strategy: paraphrase }));
 assert.equal(next.active.id, s.active.id); assert.equal(next.active.misses, 2); assert.equal(next.latest.decision, "SWITCH");
});

test("replayed observation does not count twice or improve trajectory", () => {
 const u = update([signal("prediction_failed", { prediction_id: "P1" }), signal("low_information")]);
 const one = evaluatePathPerformance({ prior: start(), update: u, variables: steady, observationIds });
 const two = evaluatePathPerformance({ prior: one, update: u, variables: steady, observationIds });
 assert.equal(two.active.misses, one.active.misses); assert.equal(two.active.prediction_failures.P1, 1);
 assert.equal(two.active.review_count, one.active.review_count); assert.ok(two.latest.replayed_observation_ids.includes("O2"));
});

test("case-level romance restriction survives switching the active process", () => {
 const old = review(start(), update(romanceSignals));
 const different = strategy({ process_id: "rest", node_id: "ROUTE.ACT_OUTWARD", target: "sleep routine" });
 const next = review(old, update([signal("new_process")], { strategy: different }));
 assert.equal(next.active.strategy.process_id, "rest"); assert.equal(next.latest.goal_substitution.romance_pause, true);
});

test("withdrawn closed-process evidence cannot be restored with valid delivery or conclusions", async () => {
 const old = start(); const different = strategy({ process_id: "rest", node_id: "ROUTE.ACT_OUTWARD", observation_ids: ["O3"] });
 const next = review(old, update([signal("new_process")], { strategy: different }));
 const corrected = applyCaseAudit({ ...snapshot(update([])), _path_prior: next }, audit({ remove_observation_ids: ["O1"] }));
 const retained = corrected._path_prior.closed.find(e => e.episode_id === old.active.id).retained_episode;
 assert.equal(retained.invalidated, true); assert.equal(retained.delivery, null); assert.deepEqual(retained.reviews, []);
});

test("cumulative failure classification retains its original observation references on empty follow-up", () => {
 let s = review(start(), update(miss())); s = review(s, update(miss()));
 const empty = review(s, null);
 assert.ok(empty.latest.failure_sources.find(f => f.kind === "FORMULATION_MISMATCH").observation_ids.includes("O2"));
});

test("ordinary shame/confusion stops and reconsiders the exercise without inventing residential need", () => {
 const s = review(start(), update([signal("shame"), signal("confusion")]));
 assert.equal(s.latest.status, "ADVERSE"); assert.equal(s.latest.route, "reconsider");
 assert.doesNotMatch(pathPerformanceGuidance(s).join(" "), /residential|Soteria|care-farm/);
});

test("new candidate cannot preempt the existing advanced-release block", () => {
 const v = { ...steady, advanced_release_interest: "present", advanced_release_physical_risk: "present" };
 const s = start(); const p = plan(s, v);
 assert.equal(p.primaryJob.id, "SOM.ADVANCED_RELEASE_BLOCK");
 assert.ok(!requiredRealizationNodeIds(p).includes("SOM.ADVANCED_RELEASE_OPTIONAL"));
});

test("delivery opportunity is review-bound and another route clears it", async () => {
 const initial = start(); const one = review(initial, update([signal("praise")]));
 const stale = review(one, update([signal("need_access", { prediction_id: "P1" })]));
 assert.notEqual(stale.latest.status, "MOVING"); assert.equal(stale.latest.predictions[0].result, "UNOBSERVED");
 const snap = { ...snapshot(update([])), path_performance: one };
 const p = plan(one); const answer = "Reconsider the present target and what help would be useful.";
 const provider = { id: "test", model: "synthetic", generate: async () => ({ text: JSON.stringify({ answer, next_question: p.nextQuestion, realized_nodes: [{ id: p.primaryJob.id, evidence_quote: answer }] }) }) };
 await realizeAdjudication({ context: { userMessage: "Synthetic", caseFormulation: snap, interventionContract: p }, adjudication: {}, provider });
 assert.equal(snap.path_performance.active.delivery, null);
});

test("stalled relational check and exhausted probe cannot continue the same exercise node", () => {
 const v = { ...steady, other_person_central: "yes", relational_check_status: "pending" };
 let s = start(strategy({ node_id: "ROUTE.RELATIONAL_REALITY_CHECK" }));
 s = review(s, update(miss()), v); s = review(s, update(miss()), v);
 assert.notEqual(plan(s, v).primaryJob.id, "ROUTE.RELATIONAL_REALITY_CHECK");
 let probe = start(strategy({ node_id: "ROUTE.THREE_WAY_GATE" }));
 probe = review(probe, update(miss())); probe = review(probe, update(miss()));
 assert.notEqual(plan(probe).primaryJob.id, "ROUTE.THREE_WAY_GATE");
});

import { buildCompleteSemanticDiff, buildCompleteDecisionCards } from "../src/guide-graph/semantic-diff.mjs";
test("controller activation remains a substantive owner decision in Guide Packet semantics", () => {
 const before = structuredClone(bundle);
 for (const graph of before.graphs) delete graph.pathPerformancePolicyVersion;
 const diff = buildCompleteSemanticDiff(before, bundle);
 const changes = diff.changes.filter(c => c.fieldPath === "pathPerformancePolicyVersion");
 assert.equal(changes.length, 3); assert.ok(changes.every(c => c.substantive && c.classification === "substantive-routing-safety"));
 assert.ok(buildCompleteDecisionCards(diff).every(c => c.requiresHumanDecision && c.status === "pending"));
});

test("cleared case risk cannot be restored by replay, and replayed clearance cannot erase new risk", () => {
 const evaluate = (prior, signals) => evaluatePathPerformance({ prior, update: update(signals), variables: steady, observationIds });
 const risk = romanceSignals.map((s, i) => ({ ...s, observation_id: `O${i + 2}` }));
 const clearance = [signal("romance_regulation_risk_cleared", { observation_id: "O10" }), signal("durable_movement", { observation_id: "O11", timing: "durable" }), signal("agency", { observation_id: "O12", timing: "durable" })];
 const established = evaluate(start(), risk);
 const cleared = evaluate(established, clearance);
 assert.equal(cleared.latest.goal_substitution.romance_pause, false);
 const replay = evaluate(cleared, risk);
 assert.equal(replay.latest.goal_substitution.romance_pause, false);
 const renewed = evaluate(replay, risk.map((s, i) => ({ ...s, observation_id: `O${i + 20}` })));
 assert.equal(renewed.latest.goal_substitution.romance_pause, true);
 const staleClearance = evaluate(renewed, clearance);
 assert.equal(staleClearance.latest.goal_substitution.romance_pause, true);
 assert.equal(staleClearance.latest.goal_substitution.cleared_by_reassessment, false);
});

test("withdrawing case-only risk recomputes the constraint without invalidating unrelated strategy evidence", async () => {
 const risk = romanceSignals.map((s, i) => ({ ...s, observation_id: `O${i + 2}` }));
 const prior = evaluatePathPerformance({ prior: start(), update: update(risk), variables: steady, observationIds });
 const corrected = applyCaseAudit({ ...snapshot(update(risk)), _path_prior: prior }, audit({ remove_observation_ids: ["O2"] }));
 assert.equal(corrected._path_invalidated, false);
 assert.equal(corrected._path_prior.active.invalidated, false);
 assert.ok(corrected._path_prior.active.delivery);
 await planCaseSnapshot(corrected, { loadPlanningGraphBundle: async () => bundle });
 assert.equal(corrected.path_performance.latest.goal_substitution.romance_pause, false);
 assert.equal(corrected.path_performance.active.invalidated, false);
 assert.doesNotMatch(corrected.path_performance.latest.reason, /withdrawn/);
 const replay = evaluatePathPerformance({ prior: corrected.path_performance, update: update(risk), variables: steady, observationIds });
 assert.equal(replay.latest.goal_substitution.romance_pause, false);
});
