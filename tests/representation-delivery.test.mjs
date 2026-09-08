import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePathPerformance,
  pathPerformanceGuidance,
  validateRepresentationSelection
} from "../src/case-formulation/path-performance.mjs";
import { applyCaseAudit } from "../src/case-formulation/run.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { enforceResponseContract } from "../src/orchestrator/response-contract.mjs";

const bundle = await compileGuideGraphs({ write: false });
const variables = deriveCaseVariables({
  ...blankCaseVariables(),
  present_safety: "safe",
  orientation: "oriented",
  ability_to_stop: "yes",
  ability_to_return: "yes",
  suicidal_state: "absent",
  activation: "low",
  dissociation: "none",
  altered_state: "sober",
  body_capacity: "adequate",
  current_intent: "conversation",
  other_person_central: "no",
  influence_domain: "none",
  actionable_problem: "absent",
  unresolved_inner_material: "present",
  attention_loop: "absent",
  inward_attention_effect: "neutral"
});
const observations = Array.from({ length: 30 }, (_, index) => ({ id: `O${index + 1}`, statement: "Synthetic observation", evidence: "Synthetic test only" }));
const observationIds = new Set(observations.map(item => item.id));
const strategy = (process_id = "blocked-need", node_id = "ROUTE.GO_INWARD", patch = {}) => ({
  process_id,
  target: "reach useful information without forcing a form",
  formulation: "A fitting representation may make the live process more discriminating",
  family: "responsive_care",
  node_id,
  selection_reason: "The user asked to work with this process",
  observation_ids: ["O1"],
  predictions: [{ id: "P1", sign: "need_access", description: "A previously blocked need becomes nameable", horizon: "immediate" }],
  adverse_signs: ["dissociation", "fragmentation"],
  ...patch
});
const representation = (mode, channel, patch = {}) => ({
  process_id: "blocked-need",
  mode,
  channel,
  transition: "INITIAL",
  selection_reason: "The user selected this form for the current process",
  observation_ids: ["O2"],
  predicted_useful_signals: ["specificity", "new_information", "agency"],
  ...patch
});
const signal = (kind, observation_id, patch = {}) => ({ observation_id, kind, prediction_id: "", timing: "immediate", severity: "ordinary", ...patch });
const update = (signals = [], patch = {}) => ({ strategy: null, representation: null, response: "meaningful", signals, failure_hypotheses: [], probe: null, ...patch });
const evaluate = (prior, current, currentVariables = variables) => evaluatePathPerformance({ prior, update: current, variables: currentVariables, observationIds });
const start = (selected, chosenStrategy = strategy()) => {
  const state = evaluate(null, update([], { strategy: chosenStrategy, representation: selected, response: "not_observed" }));
  if (selected) state.active.delivery = { node_id: chosenStrategy.node_id, review: 0, representation: selected, evidence: "synthetic grounded realization" };
  return state;
};
const plan = state => planFromGraphs({ graphs: bundle.graphs, variables, unknowns: [], turnTask: null, pathPerformance: state });

test("analytical client stays CLEAR without a global art or learning-style assignment", () => {
  const clear = representation("CLEAR", "PROSE_ANALYSIS");
  const state = start(clear);
  assert.equal(state.latest.decision, "CONTINUE");
  assert.equal(state.active.representation_switches, 0, "initial selection is not a switch");
  assert.equal(state.latest.representation.selected.mode, "CLEAR");
  assert.equal(state.latest.representation.global_user_type, "NOT_INFERRED");
  assert.equal(plan(state).pathPerformanceContract.representation.selected.channel, "PROSE_ANALYSIS");
  assert.equal(classifyTherapyTier({ variables, path_update: update([], { strategy: strategy(), representation: clear }) }, "fast").tier, "fast");
});

test("repeated I-don't-know responses switch this process to drawing and measure new self-generated meaning", () => {
  const clear = representation("CLEAR", "PROSE_ANALYSIS");
  let state = start(clear);
  state = evaluate(state, update([signal("low_information", "O3"), signal("repetition", "O3")]));
  assert.equal(state.latest.decision, "PROBE");
  assert.equal(state.latest.route, "continue");
  assert.match(plan(state).nextQuestion, /plain and direct|experiential form/);

  const drawing = representation("EXPERIENTIAL", "IMAGE_DRAWING", { transition: "SWITCH", observation_ids: ["O4"] });
  state = evaluate(state, update([signal("low_information", "O4"), signal("repetition", "O4")], { representation: drawing }));
  assert.equal(state.active.id, "strategy-1");
  assert.equal(state.latest.status, "STALLED");
  assert.equal(state.latest.decision, "SWITCH_REPRESENTATION");
  assert.equal(state.latest.route, "continue");
  assert.equal(state.active.switch_pending, false);
  assert.equal(state.latest.representation.observed.channel, "PROSE_ANALYSIS");
  assert.equal(state.latest.representation.selected.channel, "IMAGE_DRAWING");
  assert.deepEqual(state.latest.representation.predicted_useful_signals, clear.predicted_useful_signals);
  assert.deepEqual(state.latest.representation.next_predicted_useful_signals, drawing.predicted_useful_signals);

  state.active.delivery = { node_id: state.active.strategy.node_id, review: state.active.review_count, representation: drawing, evidence: "synthetic grounded drawing offer" };
  state = evaluate(state, update([signal("specificity", "O5"), signal("new_information", "O5")]));
  assert.equal(state.latest.representation.channel_performance_status, "YIELDED_USEFUL_SIGNAL");
  assert.equal(state.latest.representation.observed.channel, "IMAGE_DRAWING");
  assert.equal(state.latest.human_evaluation, "NOT_ESTABLISHED_BY_DETERMINISTIC_TRACE");
});

test("beautiful poetic output without new information is STALLED, not progress", () => {
  const poem = representation("EXPERIENTIAL", "METAPHOR_STORY_POEM");
  const felt = representation("EXPERIENTIAL", "FELT_SENSE_BODY", { transition: "SWITCH", observation_ids: ["O4"] });
  const state = evaluate(start(poem), update([
    signal("expressiveness_without_information", "O3"),
    signal("vivid_imagery", "O3"),
    signal("felt_intensity", "O3")
  ], { representation: felt }));
  assert.equal(state.latest.status, "STALLED");
  assert.notEqual(state.latest.status, "MOVING");
  assert.equal(state.latest.decision, "SWITCH_REPRESENTATION");
  assert.equal(state.latest.representation.channel_performance_status, "STALLED");
  assert.match(pathPerformanceGuidance(state).join(" "), /expressive or intense but yielded no independent movement signal/);
});

test("symbolic trauma-fact decoding is blocked while a safe phenomenological disclaimer passes", () => {
  const image = representation("EXPERIENTIAL", "IMAGE_DRAWING");
  const state = start(image);
  const interventionPlan = plan(state);
  const nodeId = interventionPlan.primaryJob.id;
  const marker = "POLICY.REPRESENTATION.EXPERIENTIAL.IMAGE_DRAWING";
  const unsafe = "Your drawing proves that you were abused.";
  const unsafeResult = enforceResponseContract({ answer: unsafe, next_question: interventionPlan.nextQuestion, realized_nodes: [
    { id: nodeId, evidence_quote: unsafe }, { id: marker, evidence_quote: unsafe }
  ] }, { plan: interventionPlan });
  assert.equal(unsafeResult.responseContract.pathPerformanceAdherencePassed, false);
  assert.deepEqual(unsafeResult.responseContract.symbolicOverclaimViolations, ["SYMBOL_AS_TRAUMA_FACT"]);

  const safe = "We can treat your drawing as your description of experience; it does not prove trauma or external facts.";
  const safeResult = enforceResponseContract({ answer: safe, next_question: interventionPlan.nextQuestion, realized_nodes: [
    { id: nodeId, evidence_quote: safe }, { id: marker, evidence_quote: safe }
  ] }, { plan: interventionPlan });
  assert.equal(safeResult.responseContract.pathPerformanceAdherencePassed, true);

  const extra = enforceResponseContract({ answer: safe, next_question: interventionPlan.nextQuestion, realized_nodes: [
    { id: nodeId, evidence_quote: safe }, { id: marker, evidence_quote: safe },
    { id: "POLICY.REPRESENTATION.CLEAR.PROSE_ANALYSIS", evidence_quote: safe }
  ] }, { plan: interventionPlan });
  assert.equal(extra.responseContract.pathPerformanceAdherencePassed, false);
  assert.deepEqual(extra.responseContract.unexpectedRepresentationPolicyMarkers, ["POLICY.REPRESENTATION.CLEAR.PROSE_ANALYSIS"]);
});

test("user can translate an image into plain language without turning it into proof", () => {
  const image = representation("EXPERIENTIAL", "IMAGE_DRAWING");
  const bridge = representation("BRIDGE", "PROSE_ANALYSIS", { transition: "TRANSLATE_TO_PLAIN", observation_ids: ["O3"] });
  const state = evaluate(start(image), update([signal("translation_requested", "O3")], { representation: bridge }));
  assert.equal(state.active.id, "strategy-1");
  assert.equal(state.latest.decision, "SWITCH_REPRESENTATION");
  assert.equal(state.latest.representation.selected.mode, "BRIDGE");
  assert.ok(!state.latest.failure_sources.some(item => item.kind === "REPRESENTATION_MISMATCH"), "voluntary translation is not a mismatch");
  assert.match(pathPerformanceGuidance(state).join(" "), /tentative ordinary language/);
});

test("reality-testing or dissociative instability forces concrete CLEAR stabilization", () => {
  const image = representation("EXPERIENTIAL", "IMAGE_DRAWING");
  const poem = representation("EXPERIENTIAL", "METAPHOR_STORY_POEM", { transition: "SWITCH", observation_ids: ["O3"] });
  const dangerSignal = signal("reality_testing_instability", "O3", { severity: "significant" });
  const state = evaluate(start(image), update([dangerSignal, signal("vivid_imagery", "O3")], { representation: poem }));
  assert.equal(state.latest.decision, "STOP_DEESCALATE");
  assert.equal(state.latest.route, "safety");
  assert.equal(state.latest.representation.selected.mode, "CLEAR");
  assert.equal(state.latest.representation.selected.channel, "PROSE_ANALYSIS");
  assert.equal(state.latest.representation.action, "STABILIZE_CLEAR");
  assert.equal(state.active.representation.mode, "CLEAR");
  assert.match(pathPerformanceGuidance(state).join(" "), /Do not amplify archetypes, synchronicities/);
  assert.equal(classifyTherapyTier({ variables, path_update: update([dangerSignal], { representation: poem }) }, "fast").tier, "forensic");

  const interventionPlan = plan(state);
  const answer = "Pause the image work and orient to the present room in plain language.";
  const result = enforceResponseContract({ answer, next_question: "", realized_nodes: [
    { id: interventionPlan.primaryJob.id, evidence_quote: answer },
    { id: "POLICY.REPRESENTATION.CLEAR.PROSE_ANALYSIS", evidence_quote: answer },
    { id: "POLICY.REPRESENTATION.EXPERIENTIAL.IMAGE_DRAWING", evidence_quote: answer }
  ] }, { plan: interventionPlan });
  assert.equal(result.responseContract.pathPerformanceAdherencePassed, false);
  assert.equal(result.responseContract.forbiddenPriorRepresentationPolicyMarker, true);
});

test("the same user can use experiential and analytical channels for different processes", () => {
  const firstRepresentation = representation("EXPERIENTIAL", "METAPHOR_STORY_POEM");
  let state = start(firstRepresentation);
  const secondStrategy = strategy("practical-planning", "ROUTE.ACT_OUTWARD", { observation_ids: ["O3"] });
  const secondRepresentation = representation("CLEAR", "PROSE_ANALYSIS", { process_id: "practical-planning", observation_ids: ["O3"] });
  state = evaluate(state, update([signal("new_process", "O3")], { strategy: secondStrategy, representation: secondRepresentation, response: "not_observed" }));
  assert.equal(state.active.strategy.process_id, "practical-planning");
  assert.equal(state.active.representation.mode, "CLEAR");

  const backStrategy = strategy("blocked-need", "ROUTE.GO_INWARD");
  const backRepresentation = representation("EXPERIENTIAL", "METAPHOR_STORY_POEM", { transition: "CONTINUE", observation_ids: ["O4"] });
  state = evaluate(state, update([signal("new_process", "O4")], { strategy: backStrategy, representation: backRepresentation, response: "not_observed" }));
  assert.equal(state.active.strategy.process_id, "blocked-need");
  assert.equal(state.active.representation.mode, "EXPERIENTIAL");
  assert.equal(state.latest.representation.global_user_type, "NOT_INFERRED");
});

test("declining an experiential channel never becomes refusal of care or a global type", () => {
  const enactment = representation("EXPERIENTIAL", "ENACTMENT_ROLE_DIALOGUE");
  const clear = representation("CLEAR", "PROSE_ANALYSIS", { transition: "SWITCH", observation_ids: ["O3"] });
  const switched = evaluate(start(enactment), update([signal("representation_declined", "O3")], { representation: clear }));
  assert.equal(switched.latest.decision, "SWITCH_REPRESENTATION");
  assert.equal(switched.latest.route, "continue");
  assert.equal(switched.active.switch_pending, false);
  assert.equal(switched.active.representation.mode, "CLEAR");

  const noAlternative = evaluate(start(enactment), update([signal("representation_declined", "O3")]));
  assert.equal(noAlternative.latest.decision, "PROBE");
  assert.equal(noAlternative.latest.route, "continue");
  assert.equal(noAlternative.active.representation, null);
  assert.match(plan(noAlternative).nextQuestion, /plain and direct|experiential form/);
});

test("schema, audit withdrawal, and correction keep representation evidence bounded", () => {
  assert.throws(() => validateRepresentationSelection(representation("CLEAR", "IMAGE_DRAWING"), observationIds), /CLEAR/);
  assert.throws(() => validateRepresentationSelection(representation("EXPERIENTIAL", "PROSE_ANALYSIS"), observationIds), /EXPERIENTIAL/);
  assert.throws(() => validateRepresentationSelection(representation("BRIDGE", "PROSE_ANALYSIS", { transition: "STAY_SYMBOLIC" }), observationIds), /non-prose/);
  assert.throws(() => validateRepresentationSelection(representation("EXPERIENTIAL", "IMAGE_DRAWING", { transition: "TRANSLATE_TO_PLAIN" }), observationIds), /BRIDGE/);
  assert.throws(() => validateRepresentationSelection(representation("CLEAR", "PROSE_ANALYSIS", { observation_ids: ["missing"] }), observationIds), /unavailable/);

  const selected = representation("EXPERIENTIAL", "IMAGE_DRAWING", { observation_ids: ["O3"] });
  const prior = start(selected);
  const snapshot = {
    user_goal: "Synthetic",
    current_issue: "blocked-need",
    direct_observations: observations,
    variables,
    hypotheses: [],
    unknowns: [],
    turn_task: null,
    path_update: update([], { representation: selected }),
    _path_prior: prior
  };
  const audit = {
    corrected_path_representation: null,
    invalidate_path_representation: false,
    corrected_turn_task: null,
    invalidate_turn_task: false,
    corrected_relational_readiness: null,
    invalidate_relational_readiness: false,
    corrected_romance_guide_context: null,
    invalidate_romance_guide_context: false,
    remove_observation_ids: ["O3"],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: [],
    verdict: "revise",
    summary: "Withdraw unsupported representation evidence"
  };
  const withdrawn = applyCaseAudit(snapshot, audit);
  assert.equal(withdrawn._path_prior.active.representation, null);
  assert.equal(withdrawn._path_prior.active.invalidated, false, "representation withdrawal does not invalidate the causal strategy");
  assert.equal(withdrawn._path_prior.latest.representation, undefined);

  const corrected = representation("CLEAR", "PROSE_ANALYSIS", { transition: "SWITCH", observation_ids: ["O4"] });
  const correctedSnapshot = applyCaseAudit({ ...snapshot, _path_prior: prior, path_update: update([], { representation: selected }) }, {
    ...audit,
    remove_observation_ids: [],
    corrected_path_representation: corrected,
    invalidate_path_representation: false,
    summary: "Use the evidence-bound clear selection"
  });
  assert.equal(correctedSnapshot.path_update.representation.mode, "CLEAR");
  assert.equal(correctedSnapshot._path_prior.active.representation.mode, "CLEAR");
  assert.equal(correctedSnapshot._path_prior.active.delivery, null);

  const nextProcessStrategy = strategy("practical-planning", "ROUTE.ACT_OUTWARD", { observation_ids: ["O4"] });
  const nextProcessRepresentation = representation("CLEAR", "PROSE_ANALYSIS", { process_id: "practical-planning", observation_ids: ["O4"] });
  const crossProcessSnapshot = applyCaseAudit({
    ...snapshot,
    _path_prior: prior,
    path_update: update([], { strategy: nextProcessStrategy, representation: nextProcessRepresentation })
  }, {
    ...audit,
    remove_observation_ids: [],
    invalidate_path_representation: true,
    summary: "Invalidate only the new process representation"
  });
  assert.equal(crossProcessSnapshot.path_update.representation, null);
  assert.equal(crossProcessSnapshot._path_prior.active.representation.mode, "EXPERIENTIAL", "auditing another process must not rewrite the prior process delivery state");
});
