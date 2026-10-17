import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CASE_ROADMAP_VERSION,
  applyRoadmapDecision,
  projectCasePlan,
  validateCaseRoadmap
} from "../src/case-formulation/case-roadmap.mjs";
import { rankKnownVersusNew } from "../src/case-formulation/known-vs-new.mjs";
import {
  applyCaseStatePatch,
  createEmptyCaseState,
  diffCaseStates,
  mergeRuntimeSnapshotIntoCaseState,
  projectCaseStateForInspection,
  validateCaseState
} from "../src/case-state/longitudinal-state.mjs";
import { PRIVATE_CASE_SCOPES, createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createPrivateCaseOrchestrator } from "../src/supervisor/private-case-orchestration.mjs";

// Issue #172, change B: the plan in the case record. Every case and every word here is synthetic.

const AT = (minute) => new Date(Date.UTC(2026, 9, 17, 12, minute)).toISOString();
const CLIENT_TURN = ["turn:synthetic-client-1"];

function decision(id, source, minute, changes, extra = {}) {
  return { decision_id: id, source, at: AT(minute), evidence_refs: source === "client" ? CLIENT_TURN : [], changes, ...extra };
}

function episode(id, target, route, startedTurnId = "T1-user") {
  return {
    id, target, route, prediction: "Synthetic prediction.", next_question: "", started_turn_id: startedTurnId,
    constitutional_aim_ids: ["CARE", "PROTECTION"], adverse_signs: ["less choice"], stay_conditions: ["more choice"],
    switch_conditions: ["the client declines this route"], stop_conditions: [], source_item_ids: []
  };
}

function item(id, statement, extra = {}) {
  return {
    id, domain: "synthetic", statement, status: "direct_report", confidence: "high",
    source: { kind: "synthetic_turn", ref: "T1-user", turn_id: "T1-user", recorded_at: AT(0) },
    still_current: true, supersedes: [], decision_relevance: "high", ...extra
  };
}

function caseState(caseId = "synthetic-case-a", patch = {}) {
  return applyCaseStatePatch(createEmptyCaseState({ caseId }), {
    current_episode: episode("episode:boundaries", "Practice small refusals", "IC.PROTECTOR_ACTION"),
    ...patch
  });
}

// Case A: the client's long-term aim with everyday protection inside it, and specialist pain care beside it.
const CASE_A_PLAN = decision("plan-a-1", "client", 1, [
  { op: "add", goal: { id: "goal:felt-safety", kind: "primary_aim", title: "Feel safe inside while keeping boundaries and saying what she needs", review_condition: "Revisit if she says a different aim matters more." } },
  { op: "add", goal: { id: "goal:everyday-protection", kind: "goal_within", parent_id: "goal:felt-safety", title: "Everyday protective acts for the younger self: leaving harm, resting, asking for company" } },
  { op: "add", goal: { id: "goal:weekly-refusal", kind: "actionable_step", parent_id: "goal:everyday-protection", title: "One small refusal a week", expected_progress: "She reports a refusal and how it felt.", next_step_tests: "Whether a small refusal is possible without freezing.", serves_episode_id: "episode:boundaries" } }
]);
const CASE_A_TRACK = decision("plan-a-2", "authorized_plan", 2, [
  { op: "add", goal: { id: "goal:back-pain-care", kind: "medical_track", title: "Specialist care for back pain", review_condition: "Revisit after the specialist appointment." } }
]);

function planA() {
  return applyRoadmapDecision(applyRoadmapDecision(null, CASE_A_PLAN), CASE_A_TRACK);
}

test("a record without a plan stays valid and unchanged; the plan is an optional, validated part of the case state", () => {
  const empty = createEmptyCaseState({ caseId: "synthetic-case-a" });
  assert.equal(Object.hasOwn(empty, "roadmap"), false);
  assert.deepEqual(validateCaseState(structuredClone(empty)), empty);
  const roadmap = planA();
  assert.equal(roadmap.version, CASE_ROADMAP_VERSION);
  const before = caseState();
  const after = applyCaseStatePatch(before, { roadmap });
  const diff = diffCaseStates(before, after);
  assert.equal(diff.roadmap_changed, true);
  for (const [key, value] of Object.entries(diff)) {
    if (key.endsWith("_changed") && key !== "roadmap_changed") assert.equal(value, false, key);
  }
  assert.deepEqual([diff.additions, diff.updates, diff.contradictions], [[], [], []]);
  assert.deepEqual(projectCaseStateForInspection(after).roadmap, roadmap);
  // A later patch that doesn't name the plan keeps it.
  const later = applyCaseStatePatch(after, { support_mode_preference: "mixed" });
  assert.deepEqual(later.roadmap, roadmap);
  assert.throws(() => applyCaseStatePatch(before, { roadmap: { ...roadmap, version: "case-roadmap-v0" } }), /roadmap\.version is invalid/u);
});

test("a goal keeps the source of its priority, with agreement, ranks and history", () => {
  const roadmap = planA();
  const goal = (id) => roadmap.goals.find((candidate) => candidate.id === id);
  assert.deepEqual(roadmap.goals.map((candidate) => [candidate.id, candidate.priority_source, candidate.client_agreement, candidate.rank]), [
    ["goal:felt-safety", "client", "agreed", 1],
    ["goal:everyday-protection", "client", "agreed", 1],
    ["goal:weekly-refusal", "client", "agreed", 1],
    ["goal:back-pain-care", "authorized_plan", "not_asked", 1]
  ]);
  assert.deepEqual(goal("goal:felt-safety").evidence_refs, CLIENT_TURN);
  assert.deepEqual(goal("goal:back-pain-care").history, [{ at: AT(2), decision_id: "plan-a-2", source: "authorized_plan", field: "created", from: null, to: "active" }]);
  assert.deepEqual(roadmap.applied_decisions.map((entry) => entry.decision_id), ["plan-a-1", "plan-a-2"]);
});

test("a client decision needs references to where the client said it, and only the client agrees or declines", () => {
  const unsupported = { ...decision("plan-x", "client", 3, [{ op: "add", goal: { id: "goal:x", kind: "primary_aim", title: "Synthetic aim" } }]), evidence_refs: [] };
  assert.throws(() => applyRoadmapDecision(null, unsupported), { code: "ROADMAP_CLIENT_EVIDENCE_REQUIRED" });
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-x", "authorized_plan", 3, [{ op: "update", goal_id: "goal:back-pain-care", set: { client_agreement: "agreed" } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  assert.throws(() => applyRoadmapDecision(null, decision("plan-x", "provisional", 3, [{ op: "add", goal: { id: "goal:x", kind: "primary_aim", title: "Synthetic aim", client_agreement: "agreed" } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
});

test("an authorized plan cannot reorder, park or retitle a goal the client chose, but can add working notes to it", () => {
  const roadmap = applyRoadmapDecision(planA(), decision("plan-a-3", "authorized_plan", 3, [
    { op: "add", goal: { id: "goal:assertive-script", kind: "actionable_step", parent_id: "goal:everyday-protection", title: "A short script for saying no" } }
  ]));
  assert.equal(roadmap.goals.find((goal) => goal.id === "goal:assertive-script").rank, 2, "a new goal goes after its siblings");
  const reorder = decision("plan-a-4", "authorized_plan", 4, [{ op: "order", parent_id: "goal:everyday-protection", goal_ids: ["goal:assertive-script", "goal:weekly-refusal"] }]);
  assert.throws(() => applyRoadmapDecision(roadmap, reorder), { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /cannot move goal:weekly-refusal, which the client chose/u });
  for (const set of [{ status: "parked", status_reason: "Synthetic supervisor reason." }, { title: "Another title" }]) {
    assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-a-4", "authorized_plan", 4, [{ op: "update", goal_id: "goal:weekly-refusal", set }])),
      { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  }
  const noted = applyRoadmapDecision(roadmap, decision("plan-a-4", "authorized_plan", 4, [
    { op: "update", goal_id: "goal:weekly-refusal", set: { uncertainty: "Whether the freeze also happens at work.", counterevidence: ["One week she refused easily."] } }
  ]));
  const step = noted.goals.find((goal) => goal.id === "goal:weekly-refusal");
  assert.equal(step.priority_source, "client", "notes don't change whose priority it is");
  assert.deepEqual(step.history.at(-1), { at: AT(4), decision_id: "plan-a-4", source: "authorized_plan", field: "notes", from: null, to: "counterevidence,uncertainty" });
  // The client can make the order theirs.
  const clientOrder = applyRoadmapDecision(roadmap, decision("plan-a-5", "client", 5, [{ op: "order", parent_id: "goal:everyday-protection", goal_ids: ["goal:assertive-script", "goal:weekly-refusal"] }]));
  const script = clientOrder.goals.find((goal) => goal.id === "goal:assertive-script");
  assert.deepEqual([script.rank, script.priority_source], [1, "client"]);
  assert.deepEqual(script.history.slice(-2).map((entry) => [entry.field, entry.from, entry.to]), [["rank", 2, 1], ["priority_source", "authorized_plan", "client"]]);
});

test("a model's proposal can add and change only proposals", () => {
  const proposed = applyRoadmapDecision(planA(), decision("plan-a-6", "provisional", 6, [
    { op: "add", goal: { id: "goal:sleep-routine", kind: "goal_within", parent_id: "goal:felt-safety", title: "A steadier evening routine" } }
  ]));
  const sleep = proposed.goals.find((goal) => goal.id === "goal:sleep-routine");
  assert.deepEqual([sleep.priority_source, sleep.client_agreement, sleep.rank], ["provisional", "not_asked", 2]);
  assert.throws(() => applyRoadmapDecision(proposed, decision("plan-a-7", "provisional", 7, [{ op: "update", goal_id: "goal:everyday-protection", set: { status: "parked", status_reason: "Synthetic." } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /model's proposal cannot change goal:everyday-protection/u });
  assert.throws(() => applyRoadmapDecision(proposed, decision("plan-a-7", "provisional", 7, [{ op: "order", parent_id: "goal:felt-safety", goal_ids: ["goal:sleep-routine", "goal:everyday-protection"] }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  assert.throws(() => applyRoadmapDecision(proposed, decision("plan-a-7", "provisional", 7, [{ op: "safety_override", reason: "Synthetic." }])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  const revised = applyRoadmapDecision(proposed, decision("plan-a-7", "provisional", 7, [{ op: "update", goal_id: "goal:sleep-routine", set: { title: "A calmer evening routine" } }]));
  assert.equal(revised.goals.find((goal) => goal.id === "goal:sleep-routine").title, "A calmer evening routine");
});

test("withdrawn consent parks a goal; it is active again only with the client's agreement", () => {
  const declined = applyRoadmapDecision(planA(), decision("plan-a-8", "client", 8, [{ op: "update", goal_id: "goal:weekly-refusal", set: { client_agreement: "declined" } }]));
  const step = declined.goals.find((goal) => goal.id === "goal:weekly-refusal");
  assert.deepEqual([step.status, step.rank, step.status_reason], ["parked", null, "The client declined this goal."]);
  assert.deepEqual(step.history.slice(-3).map((entry) => entry.field), ["status", "rank", "client_agreement"]);
  assert.throws(() => applyRoadmapDecision(declined, decision("plan-a-9", "client", 9, [{ op: "update", goal_id: "goal:weekly-refusal", set: { status: "active" } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /only with the client's agreement/u });
  assert.throws(() => applyRoadmapDecision(declined, decision("plan-a-9", "authorized_plan", 9, [{ op: "update", goal_id: "goal:weekly-refusal", set: { status: "active" } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  const again = applyRoadmapDecision(declined, decision("plan-a-9", "client", 9, [{ op: "update", goal_id: "goal:weekly-refusal", set: { status: "active", client_agreement: "agreed" } }]));
  const back = again.goals.find((goal) => goal.id === "goal:weekly-refusal");
  assert.deepEqual([back.status, back.rank, back.status_reason, back.client_agreement], ["active", 1, null, "agreed"]);
  // A goal waits only with a reason.
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-a-10", "client", 10, [{ op: "update", goal_id: "goal:weekly-refusal", set: { status: "blocked" } }])), /needs a reason/u);
});

test("tracks stay beside the aim: medical or crisis help can't be filed as a step within reparenting", () => {
  for (const kind of ["medical_track", "safety_track", "independent_track"]) {
    assert.throws(() => applyRoadmapDecision(planA(), decision("plan-a-11", "authorized_plan", 11, [
      { op: "add", goal: { id: "goal:nested-track", kind, parent_id: "goal:felt-safety", title: "Synthetic track" } }
    ])), new RegExp(`a ${kind} has no parent goal`, "u"));
  }
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-a-11", "authorized_plan", 11, [
    { op: "add", goal: { id: "goal:under-track", kind: "actionable_step", parent_id: "goal:back-pain-care", title: "Synthetic step" } }
  ])), /sits under a medical_track/u);
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-a-11", "client", 11, [
    { op: "add", goal: { id: "goal:orphan", kind: "goal_within", title: "Synthetic goal" } }
  ])), /must sit under a primary aim/u);
});

test("a decision applies whole or not at all, and a replay changes nothing", () => {
  const roadmap = planA();
  const frozen = structuredClone(roadmap);
  const mixed = decision("plan-a-12", "authorized_plan", 12, [
    { op: "add", goal: { id: "goal:valid-addition", kind: "independent_track", title: "Peer support group" } },
    { op: "update", goal_id: "goal:weekly-refusal", set: { status: "parked", status_reason: "Synthetic." } }
  ]);
  assert.throws(() => applyRoadmapDecision(roadmap, mixed), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  assert.deepEqual(roadmap, frozen, "the input is never changed");
  assert.deepEqual(applyRoadmapDecision(roadmap, CASE_A_TRACK), roadmap, "the same decision again is a replay");
  assert.throws(() => applyRoadmapDecision(roadmap, { ...CASE_A_TRACK, at: AT(13) }), { code: "ROADMAP_DECISION_CONFLICT" });
  assert.throws(() => validateCaseRoadmap({ ...roadmap, goals: [...roadmap.goals, { ...roadmap.goals[0] }] }), /holds goal goal:felt-safety twice/u);
});

test("the plan view says what is primary, what is being worked on now, what waits and why, and when priorities change", () => {
  const roadmap = applyRoadmapDecision(planA(), decision("plan-a-13", "client", 13, [
    { op: "add", goal: { id: "goal:family-visit", kind: "goal_within", parent_id: "goal:felt-safety", title: "Plan the family visit", status: "parked", status_reason: "She wants to wait until after the holidays." } }
  ]));
  const plan = projectCasePlan(applyCaseStatePatch(caseState(), { roadmap }));
  assert.equal(plan.status, "recorded");
  assert.deepEqual(plan.primary.map((goal) => [goal.id, goal.priority_source, goal.source_means]), [["goal:felt-safety", "client", "the client's choice"]]);
  assert.equal(plan.now.step.id, "goal:weekly-refusal");
  assert.equal(plan.now.episode_link, "linked");
  assert.deepEqual(plan.within.map((goal) => [goal.id, goal.depth]), [["goal:everyday-protection", 1], ["goal:weekly-refusal", 2]]);
  assert.deepEqual(plan.tracks.map((goal) => [goal.id, goal.kind, goal.priority_source]), [["goal:back-pain-care", "medical_track", "authorized_plan"]]);
  assert.match(plan.tracks[0].note, /not an exercise, and reparenting does not replace it/u);
  assert.deepEqual(plan.waiting.map((goal) => [goal.id, goal.why]), [["goal:family-visit", "She wants to wait until after the holidays."]]);
  assert.deepEqual(plan.priorities_change_when.map((entry) => entry.goal_id), ["goal:felt-safety", "goal:back-pain-care"]);
  assert.deepEqual(plan.sources, { client: 4, authorized_plan: 1, provisional: 0 });
  assert.deepEqual(plan.safety, { ordinary_order_suspended: false, reasons: [] });
});

test("the current step is what the client or an authorized plan set; goals under a waiting goal are held, not current", () => {
  const proposalFirst = [
    decision("plan-c-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-c-2", "provisional", 2, [{ op: "add", goal: { id: "goal:proposed-step", kind: "actionable_step", parent_id: "goal:aim", title: "A proposed step" } }]),
    decision("plan-c-3", "client", 3, [{ op: "add", goal: { id: "goal:chosen-step", kind: "actionable_step", parent_id: "goal:aim", title: "The step she chose" } }])
  ].reduce((roadmap, next) => applyRoadmapDecision(roadmap, next), null);
  assert.equal(proposalFirst.goals.find((goal) => goal.id === "goal:proposed-step").rank, 1);
  assert.equal(projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: proposalFirst })).now.step.id, "goal:chosen-step");
  const parkedParent = applyRoadmapDecision(planA(), decision("plan-a-16", "client", 16, [
    { op: "update", goal_id: "goal:everyday-protection", set: { status: "parked", status_reason: "She wants a pause from this for a few weeks." } }
  ]));
  const plan = projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: parkedParent }));
  assert.equal(plan.now.step, null);
  assert.equal(plan.now.episode_link, "held_by_parent", "the episode serves a step its waiting parent holds");
  assert.deepEqual(plan.held_by_parent.map((goal) => [goal.id, goal.parent_id]), [["goal:weekly-refusal", "goal:everyday-protection"]]);
  assert.deepEqual(plan.waiting.map((goal) => goal.id), ["goal:everyday-protection"]);
});

test("once the replay list is full, a decision dated before the oldest kept one is refused, not applied twice", () => {
  let roadmap = planA();
  for (let index = 0; index < 100; index += 1) {
    roadmap = applyRoadmapDecision(roadmap, { decision_id: `safety-${index}`, source: "authorized_plan", at: new Date(Date.UTC(2026, 9, 18, 0, index)).toISOString(), evidence_refs: [],
      changes: [{ op: "safety_override", reason: index % 2 ? null : "Synthetic safety reason." }] });
  }
  assert.equal(roadmap.applied_decisions.length, 100);
  assert.equal(roadmap.applied_decisions[0].decision_id, "safety-0");
  assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-a-old", "authorized_plan", 30, [{ op: "safety_override", reason: null }])), { code: "ROADMAP_DECISION_TOO_OLD" });
  const kept = roadmap.applied_decisions.at(-1);
  assert.deepEqual(applyRoadmapDecision(roadmap, { decision_id: kept.decision_id, source: "authorized_plan", at: kept.at, evidence_refs: [], changes: [{ op: "safety_override", reason: null }] }), roadmap);
});

test("an acute event takes the operational episode without replacing the long-term aim", () => {
  const state = applyCaseStatePatch(caseState(), { roadmap: planA() });
  const next = mergeRuntimeSnapshotIntoCaseState(state, {
    user_goal: "Get through tonight's argument with the landlord",
    current_issue: "An acute housing conflict",
    direct_observations: [],
    hypotheses: [],
    variables: {}
  }, { turnId: "T9-user", recordedAt: AT(20), interventionContract: { primaryJob: { id: "IC.ACUTE_SETTLING", title: "Acute settling" }, selectedNodes: [], nextQuestion: "" } });
  assert.notEqual(next.current_episode.id, state.current_episode.id, "the runtime opened a new operational episode");
  assert.deepEqual(next.roadmap, state.roadmap, "the plan is unchanged by the runtime turn");
  const plan = projectCasePlan(next);
  assert.equal(plan.primary[0].id, "goal:felt-safety");
  assert.equal(plan.now.current_episode.id, next.current_episode.id);
  assert.equal(plan.now.episode_link, "stale", "the step's episode is no longer the current one");
  assert.equal(plan.now.step.id, "goal:weekly-refusal", "the plan's next step is still the aim's first step");
});

test("a safety need or imminent danger suspends the ordinary order without rewriting anyone's ranks", () => {
  const overridden = applyRoadmapDecision(planA(), decision("plan-a-14", "authorized_plan", 14, [{ op: "safety_override", reason: "Tonight's housing safety comes first." }]));
  assert.deepEqual(overridden.goals, planA().goals);
  const plan = projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: overridden }));
  assert.deepEqual(plan.safety, { ordinary_order_suspended: true, reasons: ["Tonight's housing safety comes first."] });
  const cleared = applyRoadmapDecision(overridden, decision("plan-a-15", "client", 15, [{ op: "safety_override", reason: null }]));
  assert.equal(projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: cleared })).safety.ordinary_order_suspended, false);
  const danger = { ...applyCaseStatePatch(caseState(), { roadmap: planA() }), threat_pathway: { current: { level: "IMMINENT_OPERATIONAL_DANGER" } } };
  assert.match(projectCasePlan(danger).safety.reasons[0], /imminent operational danger/u);
});

test("without a recorded plan, a session gets a reconstruction labeled a proposal, and nothing is stored", () => {
  const state = applyCaseStatePatch(caseState(), {
    items: [item("evidence:freeze", "She freezes before saying no to her older brother."), item("evidence:minor", "A passing remark.", { decision_relevance: "low" })],
    intervention_history: [
      { ...item("intervention:1", "Selected IC.PROTECTOR_ACTION: Protector action."), domain: "intervention_route", status: "observed_pattern" },
      { ...item("intervention:2", "Selected IC.PROTECTOR_ACTION: Protector action."), domain: "intervention_route", status: "observed_pattern" }
    ]
  });
  const before = structuredClone(state);
  const plan = projectCasePlan(state);
  assert.deepEqual(state, before);
  assert.equal(plan.status, "proposed_reconstruction");
  assert.equal(plan.priority_source, "provisional");
  assert.match(plan.note, /a proposal, not a decision, and not stored\. It names no primary aim/u);
  assert.equal(Object.hasOwn(plan, "primary"), false);
  assert.equal(plan.now.current_episode.id, "episode:boundaries");
  assert.deepEqual(plan.routes_tried.map((route) => [route.statement, route.times]), [["Selected IC.PROTECTOR_ACTION: Protector action.", 2]]);
  assert.deepEqual(plan.high_relevance_items.map((entry) => entry.id), ["evidence:freeze"]);
});

test("two cases keep their own plans and client priorities", () => {
  const caseB = applyRoadmapDecision(null, decision("plan-b-1", "client", 1, [
    { op: "add", goal: { id: "goal:grieve-at-own-pace", kind: "primary_aim", title: "Grieve her father at her own pace" } },
    { op: "add", goal: { id: "goal:felt-safety", kind: "primary_aim", title: "Feel safe saying no" } }
  ]));
  const stateA = applyCaseStatePatch(caseState("synthetic-case-a"), { roadmap: planA() });
  const stateB = applyCaseStatePatch(caseState("synthetic-case-b"), { roadmap: caseB });
  assert.deepEqual(projectCasePlan(stateA).primary.map((goal) => goal.id), ["goal:felt-safety"]);
  assert.deepEqual(projectCasePlan(stateB).primary.map((goal) => goal.id), ["goal:grieve-at-own-pace", "goal:felt-safety"]);
  const reordered = applyRoadmapDecision(caseB, decision("plan-b-2", "client", 2, [{ op: "order", parent_id: null, goal_ids: ["goal:felt-safety", "goal:grieve-at-own-pace"] }]));
  assert.deepEqual(projectCasePlan(applyCaseStatePatch(stateB, { roadmap: reordered })).primary.map((goal) => goal.id), ["goal:felt-safety", "goal:grieve-at-own-pace"]);
  assert.deepEqual(stateA.roadmap, planA(), "case A is untouched");
});

test("known versus new: a repeated theme matches the record closely; a new lever does not", () => {
  const state = applyCaseStatePatch(caseState(), {
    items: [
      item("evidence:freeze", "She freezes before saying no to her older brother."),
      item("evidence:fr-freeze", "Elle se fige avant de refuser quoi que ce soit à son frère aîné."),
      item("evidence:dinner", "Leaving the dinner early protected her.")
    ],
    answered_questions: [{ id: "answer:friends", question: "Does the freeze happen with friends too?", answer: "No, only with family.", source_item_ids: ["evidence:freeze"], still_current: true }],
    roadmap: planA()
  });
  const [repeated, lever, french, goal] = rankKnownVersusNew(state, [
    "She freezes before refusing her older brother.",
    "Every refusal she managed happened with a neighbour beside her.",
    "Elle se figeait devant son frère aîné quand il fallait refuser.",
    "A small refusal each week"
  ], { limit: 3 });
  assert.equal(repeated.matches[0].id, "evidence:freeze");
  assert.equal(repeated.record_holds_close_match, true);
  assert.equal(lever.record_holds_close_match, false);
  assert.ok(lever.closest_overlap < repeated.closest_overlap);
  assert.equal(french.matches[0].id, "evidence:fr-freeze", "accents and French forms are read");
  assert.equal(goal.matches[0].kind, "roadmap_goal");
  assert.equal(goal.matches[0].id, "goal:weekly-refusal");
  assert.equal(goal.matches[0].priority_source, "client");
  assert.throws(() => rankKnownVersusNew(state, []), { code: "KNOWN_VS_NEW_INPUT_INVALID" });
  assert.throws(() => rankKnownVersusNew(state, ["x".repeat(601)]), { code: "KNOWN_VS_NEW_INPUT_INVALID" });
});

// The encrypted store: a decision through the access service and the operator operation, read back after a restart.
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const TOKEN_A = "synthetic-roadmap-token-a";
const TOKEN_READ = "synthetic-roadmap-token-read";

async function environment(t) {
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-roadmap-"));
  await fs.chmod(privateRoot, 0o700);
  const credentialsPath = path.join(privateRoot, "credentials.json");
  const keys = (seed) => ({ routine_kek_base64: Buffer.alloc(32, seed).toString("base64"), recovery_secret_base64: Buffer.alloc(32, seed + 1).toString("base64") });
  await fs.writeFile(credentialsPath, `${JSON.stringify({
    schema_version: 1,
    root_dir: path.join(privateRoot, "vaults"),
    grants: [
      { token_sha256: sha256(TOKEN_A), principal_id: "synthetic-supervisor-a", case_ids: ["synthetic-case-a", "synthetic-case-missing"], scopes: Object.values(PRIVATE_CASE_SCOPES) },
      { token_sha256: sha256(TOKEN_READ), principal_id: "synthetic-reader-b", case_ids: ["synthetic-case-b"], scopes: [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.WRITE] }
    ],
    case_keys: { "synthetic-case-a": keys(31), "synthetic-case-b": keys(41), "synthetic-case-missing": keys(51) }
  })}\n`, { mode: 0o600 });
  const open = async () => {
    const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
    t.after(() => providers.close());
    return createPrivateCaseAccessService({
      rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true
    });
  };
  t.after(async () => { await fs.rm(privateRoot, { recursive: true, force: true }); });
  return { privateRoot, open };
}

test("the plan lives in the encrypted record: decisions, replay, refusal across cases, and readback after a restart", async (t) => {
  const { privateRoot, open } = await environment(t);
  const authA = { bearerToken: TOKEN_A };
  const authB = { bearerToken: TOKEN_READ };
  const service = await open();
  await service.saveCaseState("synthetic-case-a", caseState("synthetic-case-a"), authA);
  await service.saveCaseState("synthetic-case-b", caseState("synthetic-case-b"), authB);

  const first = await service.recordRoadmapDecision("synthetic-case-a", CASE_A_PLAN, authA);
  assert.equal(first.applied, true);
  assert.equal(first.case_plan.primary[0].id, "goal:felt-safety");
  const replay = await service.recordRoadmapDecision("synthetic-case-a", CASE_A_PLAN, authA);
  assert.deepEqual([replay.applied, replay.case_revision], [false, first.case_revision]);
  const diff = await service.getCaseDiff("synthetic-case-a", { diffId: "roadmap:plan-a-1" }, authA);
  assert.equal(diff.diff.roadmap_changed, true);
  assert.equal(diff.diff.current_episode_changed, false);

  // A token for another case, or without the audit scope, changes nothing.
  await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-b", CASE_A_PLAN, authA), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-b", CASE_A_PLAN, authB), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  await assert.rejects(() => service.checkCaseKnownVersusNew("synthetic-case-a", { points: ["anything"], limit: 3 }, authB), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  assert.equal(Object.hasOwn(await service.getCaseState("synthetic-case-b", authB), "roadmap"), false);
  // A decision never creates a case.
  await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-missing", CASE_A_PLAN, authA), { code: "PRIVATE_CASE_NOT_FOUND" });
  assert.equal((await fs.readdir(path.join(privateRoot, "vaults"))).some((name) => name.includes("synthetic-case-missing")), false);

  // The operator operation; its receipt holds no plan content.
  const receipt = await createPrivateCaseOrchestrator({ caseAccessService: service }).execute({
    schema_version: 1, operation: "record_roadmap_decision", case_id: "synthetic-case-a", decision: CASE_A_TRACK
  }, authA);
  assert.deepEqual(Object.keys(receipt).sort(), ["applied", "case_id", "case_revision", "decision_id", "operation_succeeded", "schema_version"]);
  assert.equal(receipt.applied, true);
  assert.equal(JSON.stringify(receipt).includes("back pain"), false);

  // A new process reads the same plan.
  const restarted = await open();
  const state = await restarted.getCaseState("synthetic-case-a", authA);
  assert.deepEqual(state.roadmap, planA());
  assert.deepEqual(projectCasePlan(state).tracks.map((goal) => goal.id), ["goal:back-pain-care"]);
  const checked = await restarted.checkCaseKnownVersusNew("synthetic-case-a", { points: ["one small refusal each week"], limit: 2 }, authA);
  assert.equal(checked.points[0].matches[0].id, "goal:weekly-refusal");
});
