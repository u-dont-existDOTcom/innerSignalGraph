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
import { durableCaseContextBlock } from "../src/prompts/common.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { ValidationError } from "../src/core/errors.mjs";
import { chunkExactSourceText } from "../src/storage/exact-source-artifact.mjs";
import { PRIVATE_CASE_SCOPES, createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore, deserializeVaultEnvelope, serializeVaultEnvelope } from "../src/storage/private-case-store.mjs";
import { decryptVaultEnvelopeWithRoutineKek, replaceVaultPayloadWithRoutineKek } from "../src/storage/vault-crypto.mjs";
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

const planOf = (...decisions) => decisions.reduce((roadmap, next) => applyRoadmapDecision(roadmap, next), null);
// The view of a plan in case A's state, whose operational episode is "episode:boundaries".
const view = (roadmap) => projectCasePlan(applyCaseStatePatch(caseState(), { roadmap }));
const sourcesUnder = (roadmap, parentId) => roadmap.goals.filter((goal) => goal.parent_id === parentId).map((goal) => [goal.id, goal.priority_source]);
const rankOrder = (roadmap, parentId) => roadmap.goals.filter((goal) => goal.status === "active" && goal.parent_id === parentId).sort((left, right) => left.rank - right.rank).map((goal) => goal.id);

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
  // A plan this version can't read never makes the case unreadable: the state keeps it, the plan view says it is unavailable.
  const unreadable = applyCaseStatePatch(before, { roadmap: { ...roadmap, version: "case-roadmap-v9" } });
  assert.deepEqual(validateCaseState(structuredClone(unreadable)).roadmap.version, "case-roadmap-v9");
  assert.deepEqual([projectCasePlan(unreadable).status, projectCasePlan(unreadable).problem], ["unavailable", "ROADMAP_VERSION_UNKNOWN"]);
  assert.throws(() => applyRoadmapDecision(unreadable.roadmap, CASE_A_TRACK), { code: "ROADMAP_VERSION_UNKNOWN" });
  assert.throws(() => applyCaseStatePatch(before, { roadmap: { goals: [] } }), /roadmap\.version is invalid/u);
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
  assert.throws(() => applyRoadmapDecision(roadmap, reorder), { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /cannot change which goals come before goal:weekly-refusal: the client chose or answered it/u });
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
  // The client can reorder anything. The goal stays the authorized plan's, but its place is now the client's decision.
  const clientOrder = applyRoadmapDecision(roadmap, decision("plan-a-5", "client", 5, [{ op: "order", parent_id: "goal:everyday-protection", goal_ids: ["goal:assertive-script", "goal:weekly-refusal"] }]));
  const script = clientOrder.goals.find((goal) => goal.id === "goal:assertive-script");
  assert.deepEqual([script.rank, script.priority_source], [1, "authorized_plan"]);
  assert.deepEqual(script.history.at(-1), { at: AT(5), decision_id: "plan-a-5", source: "client", field: "rank", from: 2, to: 1, refs: CLIENT_TURN });
  assert.throws(() => applyRoadmapDecision(clientOrder, decision("plan-a-6", "authorized_plan", 6, [
    { op: "order", parent_id: "goal:everyday-protection", goal_ids: ["goal:weekly-refusal", "goal:assertive-script"] }
  ])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
});

test("a model's proposal can add and change only proposals", () => {
  const proposed = applyRoadmapDecision(planA(), decision("plan-a-6", "provisional", 6, [
    { op: "add", goal: { id: "goal:sleep-routine", kind: "goal_within", parent_id: "goal:felt-safety", title: "A steadier evening routine" } }
  ]));
  const sleep = proposed.goals.find((goal) => goal.id === "goal:sleep-routine");
  assert.deepEqual([sleep.priority_source, sleep.client_agreement, sleep.rank], ["provisional", "not_asked", 2]);
  assert.throws(() => applyRoadmapDecision(proposed, decision("plan-a-7", "provisional", 7, [{ op: "update", goal_id: "goal:everyday-protection", set: { status: "parked", status_reason: "Synthetic." } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /model's proposal cannot change the status of goal:everyday-protection/u });
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
  const withSafety = applyRoadmapDecision(planA(), decision("plan-a-17", "authorized_plan", 17, [
    { op: "add", goal: { id: "goal:shelter-contact", kind: "safety_track", title: "A shelter's number and a plan for leaving" } }
  ]));
  const safetyNote = projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: withSafety })).tracks.find((goal) => goal.id === "goal:shelter-contact").note;
  assert.match(safetyNote, /Everyday protective acts the person takes for themselves belong within the aim when that frame is welcome\./u);
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
  assert.match(plan.tracks[0].note, /^Medical or specialist care: separately available; not an exercise, and reparenting does not replace it\.$/u);
  assert.deepEqual(plan.waiting.map((goal) => [goal.id, goal.why]), [["goal:family-visit", "She wants to wait until after the holidays."]]);
  assert.deepEqual(plan.priorities_change_when.map((entry) => entry.goal_id), ["goal:felt-safety", "goal:back-pain-care"]);
  assert.deepEqual(plan.sources, { client: 4, authorized_plan: 1, provisional: 0 });
  assert.deepEqual([plan.safety.ordinary_order_suspended, plan.safety.reasons], [false, []]);
  assert.match(plan.safety.note, /comes before this order while it lasts, whether or not it is recorded here/u);
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

test("decisions come in time order with exact times; a replay list beyond its bound can't let an old decision in again", () => {
  let roadmap = planA();
  for (let index = 0; index < 101; index += 1) {
    roadmap = applyRoadmapDecision(roadmap, { decision_id: `safety-${index}`, source: "authorized_plan", at: new Date(Date.UTC(2026, 9, 18, 0, index)).toISOString(), evidence_refs: [],
      changes: [{ op: "safety_override", reason: index % 2 ? null : "Synthetic safety reason." }] });
  }
  assert.equal(roadmap.applied_decisions.length, 100);
  assert.equal(roadmap.applied_decisions[0].decision_id, "safety-1", "the oldest kept decision is dropped first");
  // safety-0 is no longer in the list, and it is dated before the plan's last change, so it is refused, not applied again.
  assert.throws(() => applyRoadmapDecision(roadmap, { decision_id: "safety-0", source: "authorized_plan", at: new Date(Date.UTC(2026, 9, 18, 0, 0)).toISOString(), evidence_refs: [],
    changes: [{ op: "safety_override", reason: "Synthetic safety reason." }] }), { code: "ROADMAP_DECISION_OUT_OF_ORDER" });
  const kept = roadmap.applied_decisions.at(-1);
  assert.equal(kept.decision_id, "safety-100");
  assert.deepEqual(applyRoadmapDecision(roadmap, { decision_id: kept.decision_id, source: "authorized_plan", at: kept.at, evidence_refs: [], changes: [{ op: "safety_override", reason: "Synthetic safety reason." }] }), roadmap);
  // Only exact UTC times that exist, written as JavaScript writes them; and with a clock, nothing dated more than five
  // minutes ahead of it.
  for (const at of ["0", "2026", "December 17, 1995 03:24:00", "2026-10-18T12:00:00+02:00", "2026-02-30T12:00:00.000Z", "2026-10-17T24:00:00.000Z",
    "2026-10-18T12:00:00Z", "2026-10-18T12:00:00.5Z", "+002026-10-18T12:00:00.000Z"]) {
    assert.throws(() => applyRoadmapDecision(planA(), { ...CASE_A_TRACK, decision_id: "plan-a-time", at }), /must be an ISO 8601 UTC time written as 2026-10-18T10:00:00\.000Z/u, at);
  }
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-a-future", "authorized_plan", 30, [{ op: "safety_override", reason: null }]), { now: AT(0).replace("12:00", "10:00").replace("2026-10-17", "2026-10-15") }),
    { code: "ROADMAP_DECISION_IN_FUTURE" });
  const clock = AT(10);
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-a-ahead-6", "authorized_plan", 16, [{ op: "safety_override", reason: null }]), { now: clock }), { code: "ROADMAP_DECISION_IN_FUTURE" });
  assert.equal(applyRoadmapDecision(planA(), decision("plan-a-ahead-4", "authorized_plan", 14, [{ op: "safety_override", reason: null }]), { now: clock }).updated_at, AT(14));
});

// The independent review's attacks on change B, each now refused (issue #172).
test("ranks stay 1 to n, so no source can slip a goal ahead of one it may not move through a gap", () => {
  const steps = applyRoadmapDecision(planA(), decision("plan-r-1", "client", 3, [
    { op: "add", goal: { id: "goal:second-step", kind: "actionable_step", parent_id: "goal:everyday-protection", title: "A second step she chose" } }
  ]));
  const completed = applyRoadmapDecision(steps, decision("plan-r-2", "client", 4, [{ op: "update", goal_id: "goal:weekly-refusal", set: { status: "completed" } }]));
  assert.equal(completed.goals.find((goal) => goal.id === "goal:second-step").rank, 1, "the gap closes");
  for (const source of ["provisional", "authorized_plan"]) {
    const added = applyRoadmapDecision(completed, decision(`plan-r-3-${source}`, source, 5, [
      { op: "add", goal: { id: "goal:slipped-in", kind: "actionable_step", parent_id: "goal:everyday-protection", title: "A step from elsewhere" } }
    ]));
    assert.equal(added.goals.find((goal) => goal.id === "goal:slipped-in").rank, 2);
    assert.throws(() => applyRoadmapDecision(added, decision(`plan-r-4-${source}`, source, 6, [
      { op: "order", parent_id: "goal:everyday-protection", goal_ids: ["goal:slipped-in", "goal:second-step"] }
    ])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  }
  // The same for primary aims: a model's aim can't go ahead of the client's once the client's first aim is finished.
  const aims = applyRoadmapDecision(planA(), decision("plan-r-5", "client", 3, [
    { op: "add", goal: { id: "goal:second-aim", kind: "primary_aim", title: "A second aim she chose" } },
    { op: "update", goal_id: "goal:felt-safety", set: { status: "completed" } }
  ]));
  assert.throws(() => applyRoadmapDecision(aims, decision("plan-r-6", "provisional", 4, [
    { op: "add", goal: { id: "goal:model-aim", kind: "primary_aim", title: "A model's aim" } },
    { op: "order", parent_id: null, goal_ids: ["goal:model-aim", "goal:second-aim"] }
  ])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
});

test("a goal the client agreed to or declined is the client's: no other source rewrites, parks or reopens it", () => {
  const proposed = applyRoadmapDecision(planA(), decision("plan-g-1", "provisional", 3, [
    { op: "add", goal: { id: "goal:evening-routine", kind: "goal_within", parent_id: "goal:felt-safety", title: "A steadier evening routine" } },
    { op: "add", goal: { id: "goal:family-call", kind: "goal_within", parent_id: "goal:felt-safety", title: "Call her sister weekly", status: "parked", status_reason: "Proposed for later." } }
  ]));
  const answered = applyRoadmapDecision(proposed, decision("plan-g-2", "client", 4, [
    { op: "update", goal_id: "goal:evening-routine", set: { client_agreement: "agreed" } },
    { op: "update", goal_id: "goal:family-call", set: { client_agreement: "declined" } }
  ]));
  const routine = answered.goals.find((goal) => goal.id === "goal:evening-routine");
  assert.deepEqual([routine.priority_source, routine.client_agreement], ["client", "agreed"]);
  assert.deepEqual(routine.history.slice(-2).map((entry) => [entry.field, entry.from, entry.to, entry.refs]),
    [["client_agreement", "not_asked", "agreed", CLIENT_TURN], ["priority_source", "provisional", "client", CLIENT_TURN]]);
  for (const [source, set] of [["provisional", { title: "A different routine" }], ["provisional", { status: "parked", status_reason: "Synthetic." }],
    ["provisional", { client_agreement: "unknown" }], ["authorized_plan", { title: "A different routine" }], ["authorized_plan", { review_condition: "Synthetic." }]]) {
    assert.throws(() => applyRoadmapDecision(answered, decision("plan-g-3", source, 5, [{ op: "update", goal_id: "goal:evening-routine", set }])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" }, JSON.stringify(set));
  }
  // A declined goal stays declined until the client agrees again, whoever first proposed it.
  for (const source of ["provisional", "authorized_plan"]) {
    assert.throws(() => applyRoadmapDecision(answered, decision("plan-g-4", source, 5, [
      { op: "update", goal_id: "goal:family-call", set: { client_agreement: "not_asked", status: "active" } }
    ])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
    // Nor is it offered again under another id.
    assert.throws(() => applyRoadmapDecision(answered, decision("plan-g-5", source, 5, [
      { op: "add", goal: { id: "goal:family-call-again", kind: "goal_within", parent_id: "goal:felt-safety", title: "Call her sister, weekly!" } }
    ])), { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /declined a goal with this title/u });
  }
});

test("histories keep the record of decisions: one update per goal per decision, unchanged notes write nothing, notes go first", () => {
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-h-1", "authorized_plan", 3, [
    { op: "update", goal_id: "goal:weekly-refusal", set: { uncertainty: "One." } },
    { op: "update", goal_id: "goal:weekly-refusal", set: { uncertainty: "Two." } }
  ])), /at most once/u);
  let roadmap = applyRoadmapDecision(planA(), decision("plan-h-2", "client", 3, [
    { op: "add", goal: { id: "goal:second-step", kind: "actionable_step", parent_id: "goal:everyday-protection", title: "A second step she chose" } },
    { op: "update", goal_id: "goal:weekly-refusal", set: { review_condition: "Revisit if refusing at work gets easier." } }
  ]));
  const unchanged = applyRoadmapDecision(roadmap, decision("plan-h-3", "authorized_plan", 4, [{ op: "update", goal_id: "goal:weekly-refusal", set: { expected_progress: "She reports a refusal and how it felt." } }]));
  assert.deepEqual(unchanged.goals.find((goal) => goal.id === "goal:weekly-refusal").history, roadmap.goals.find((goal) => goal.id === "goal:weekly-refusal").history);
  // Forty-five notes an authorized plan adds to the client's step, each in its own decision.
  for (let index = 0; index < 45; index += 1) {
    const step = roadmap.goals.find((goal) => goal.id === "goal:weekly-refusal");
    const set = index < 20 ? { blockers: [...step.blockers, `Synthetic blocker ${index}.`] }
      : index < 40 ? { counterevidence: [...step.counterevidence, `Synthetic counterevidence ${index}.`] }
        : { evidence_refs: [...step.evidence_refs, `turn:synthetic-supervisor-${index}`] };
    roadmap = applyRoadmapDecision(roadmap, { decision_id: `plan-h-note-${index}`, source: "authorized_plan", at: new Date(Date.UTC(2026, 9, 18, 0, index)).toISOString(), evidence_refs: [],
      changes: [{ op: "update", goal_id: "goal:weekly-refusal", set }] });
  }
  const step = roadmap.goals.find((goal) => goal.id === "goal:weekly-refusal");
  assert.equal(step.history.length, 40);
  assert.ok(step.history_dropped > 0);
  assert.deepEqual(step.history.filter((entry) => entry.field !== "notes").map((entry) => [entry.field, entry.source]), [["created", "client"], ["review_condition", "client"]],
    "the client's own decisions survive");
});

test("an authorized plan only adds references to a client's goal and can't make a step the current one", () => {
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-e-1", "authorized_plan", 3, [{ op: "update", goal_id: "goal:weekly-refusal", set: { evidence_refs: [] } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /can add to the evidence_refs of goal:weekly-refusal, not take any away/u });
  const added = applyRoadmapDecision(planA(), decision("plan-e-2", "authorized_plan", 3, [{ op: "update", goal_id: "goal:weekly-refusal", set: { evidence_refs: [...CLIENT_TURN, "turn:synthetic-supervisor-1"] } }]));
  assert.deepEqual(added.goals.find((goal) => goal.id === "goal:weekly-refusal").evidence_refs, [...CLIENT_TURN, "turn:synthetic-supervisor-1"]);
  assert.throws(() => applyRoadmapDecision(planA(), decision("plan-e-3", "authorized_plan", 3, [{ op: "update", goal_id: "goal:weekly-refusal", set: { serves_episode_id: "episode:other" } }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
});

test("the current step prefers what the client or an authorized plan set; a plan of proposals only says so", () => {
  // A model's step linked to the operational episode doesn't push out the client's first step.
  const linkedProposal = applyRoadmapDecision(planA(), decision("plan-n-1", "provisional", 3, [
    { op: "add", goal: { id: "goal:proposed-linked", kind: "actionable_step", parent_id: "goal:felt-safety", title: "A proposed step", serves_episode_id: "episode:acute" } },
    { op: "add", goal: { id: "goal:proposed-track", kind: "independent_track", title: "A proposed support group", serves_episode_id: "episode:acute" } }
  ]));
  const state = applyCaseStatePatch(caseState(), { roadmap: linkedProposal, current_episode: episode("episode:acute", "An acute evening", "IC.ACUTE_SETTLING") });
  const plan = projectCasePlan(state);
  assert.equal(plan.now.step.id, "goal:weekly-refusal");
  assert.equal(plan.now.episode_link, "linked_elsewhere");
  assert.deepEqual(plan.now.episode_serves, [{ goal_id: "goal:proposed-linked", priority_source: "provisional" }, { goal_id: "goal:proposed-track", priority_source: "provisional" }]);
  const onlyProposals = applyRoadmapDecision(null, decision("plan-n-2", "provisional", 1, [
    { op: "add", goal: { id: "goal:model-aim", kind: "primary_aim", title: "A model's aim" } },
    { op: "add", goal: { id: "goal:model-step", kind: "actionable_step", parent_id: "goal:model-aim", title: "A model's step" } }
  ]));
  const proposed = projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: onlyProposals }));
  assert.equal(proposed.status, "proposals_only");
  assert.match(proposed.note, /Every active goal in this plan is a model's proposal, not a decision; the primary aim is the client's to choose/u);
  const finished = applyRoadmapDecision(onlyProposals, decision("plan-n-3", "provisional", 2, [{ op: "update", goal_id: "goal:model-step", set: { status: "completed" } }]));
  assert.deepEqual(projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: finished })).finished.map((goal) => [goal.id, goal.priority_source]), [["goal:model-step", "provisional"]]);
});

test("a goal is replaced by superseding it and adding another; kind and parent never change", () => {
  const replaced = applyRoadmapDecision(planA(), decision("plan-s-1", "client", 3, [
    { op: "update", goal_id: "goal:weekly-refusal", set: { status: "superseded", status_reason: "Replaced by a smaller step she chose." } },
    { op: "add", goal: { id: "goal:smaller-refusal", kind: "actionable_step", parent_id: "goal:everyday-protection", title: "One small refusal every two weeks" } }
  ]));
  const plan = projectCasePlan(applyCaseStatePatch(caseState(), { roadmap: replaced }));
  assert.equal(plan.now.step.id, "goal:smaller-refusal");
  assert.deepEqual(plan.finished.map((goal) => [goal.id, goal.status, goal.why]), [["goal:weekly-refusal", "superseded", "Replaced by a smaller step she chose."]]);
  assert.throws(() => applyRoadmapDecision(replaced, decision("plan-s-2", "client", 4, [{ op: "update", goal_id: "goal:smaller-refusal", set: { kind: "goal_within" } }])), /cannot be changed; supersede the goal/u);
});

test("a stored plan beyond this version's limits is brought within them on read, and the case stays readable either way", () => {
  const roadmap = planA();
  const stretched = structuredClone(roadmap);
  stretched.applied_decisions = Array.from({ length: 151 }, (_, index) => ({ ...roadmap.applied_decisions[0], decision_id: `old-${index}` }));
  const state = applyCaseStatePatch(caseState(), { roadmap: stretched });
  assert.equal(validateCaseState(structuredClone(state)).roadmap.applied_decisions.length, 151, "the stored plan is kept as stored");
  const plan = projectCasePlan(state);
  assert.equal(plan.status, "recorded");
  const next = applyRoadmapDecision(stretched, decision("plan-m-1", "authorized_plan", 30, [{ op: "safety_override", reason: null }]));
  assert.equal(next.applied_decisions.length, 100);
  assert.equal(next.applied_decisions.at(-1).decision_id, "plan-m-1");
  const broken = applyCaseStatePatch(caseState(), { roadmap: { ...roadmap, goals: [{ ...roadmap.goals[0], kind: "unknown_kind" }] } });
  assert.deepEqual([projectCasePlan(broken).status, projectCasePlan(broken).problem], ["unavailable", "ROADMAP_UNREADABLE"]);
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
  assert.deepEqual([plan.safety.ordinary_order_suspended, plan.safety.reasons, plan.safety.set_by], [true, ["Tonight's housing safety comes first."], "authorized_plan"]);
  assert.equal(plan.now.waits_for_safety, true, "the current step says it waits while the order is suspended");
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

test("the app's prompts show a stored plan as its view, not its histories; a case without one shows as before", () => {
  const without = caseState();
  const plain = durableCaseContextBlock({ durableCaseState: without });
  assert.equal(plain.includes("case_plan"), false);
  const shown = durableCaseContextBlock({ durableCaseState: applyCaseStatePatch(without, { roadmap: planA() }) });
  assert.match(shown, /"case_plan": \{\n\s+"status": "recorded"/u);
  for (const stored of ["applied_decisions", "\"history\"", "digest"]) assert.equal(shown.includes(stored), false, stored);
  assert.ok(shown.includes("goal:weekly-refusal"));
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
  // Case A's own plan and its order are its own; nothing case B records reaches it.
  assert.deepEqual(projectCasePlan(stateA).within.map((goal) => goal.id), ["goal:everyday-protection", "goal:weekly-refusal"]);
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
  // What the record no longer holds as current is shown, never counted as holding the point; one shared word says too little.
  const retracted = applyCaseStatePatch(state, { items: [item("evidence:freeze", "She freezes before saying no to her older brother.", { still_current: false })] });
  const [stale] = rankKnownVersusNew(retracted, ["She freezes before refusing her older brother."]);
  assert.equal(stale.matches[0].id, "evidence:freeze");
  assert.equal(stale.matches[0].current, false);
  assert.equal(stale.record_holds_close_match, false);
  const [oneWord] = rankKnownVersusNew(state, ["brother"]);
  assert.equal(oneWord.matches[0].id, "evidence:freeze");
  assert.equal(oneWord.record_holds_close_match, false);
  // M3: nor is an item another item supersedes.
  const superseding = applyCaseStatePatch(state, { items: [item("evidence:visits", "She now sees her brother without freezing.", { supersedes: ["evidence:freeze"] })] });
  const [replaced] = rankKnownVersusNew(superseding, ["She freezes before refusing her older brother."]);
  assert.deepEqual([replaced.matches[0].id, replaced.matches[0].current, replaced.record_holds_close_match], ["evidence:freeze", false, false]);
  // R6: a stored plan this version can't read adds no goals, and the check still answers.
  for (const roadmap of [{ version: "case-roadmap-v1", goals: [null] }, { version: "case-roadmap-v9", goals: { "goal:a": {} } }]) {
    const [answered] = rankKnownVersusNew(applyCaseStatePatch(state, { roadmap }), ["A small refusal each week"]);
    assert.equal(answered.matches.some((match) => match.kind === "roadmap_goal"), false, roadmap.version);
  }
  assert.throws(() => rankKnownVersusNew(state, []), { code: "KNOWN_VS_NEW_INPUT_INVALID" });
  assert.throws(() => rankKnownVersusNew(state, ["x".repeat(601)]), { code: "KNOWN_VS_NEW_INPUT_INVALID" });
});

// The second independent review of change B (issue #172): whose a goal is, the order no other source slips past, the goals
// above a client's goal, her notes and her last decisions, dates, declined titles, prompts and the check tool.
test("a goal stays whose it is when the client moves, parks or declines it; only her agreement or an adoption changes that", () => {
  // X1: the client puts her own step first. The supervisor's steps and the model's idea keep their sources, so the supervisor
  // can still pause its step and the model withdraw its idea, and none of them reads as the client's choice.
  const group = planOf(
    decision("plan-e-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-e-2", "authorized_plan", 2, [
      { op: "add", goal: { id: "goal:a1", kind: "actionable_step", parent_id: "goal:aim", title: "A supervisor's first step" } },
      { op: "add", goal: { id: "goal:a2", kind: "actionable_step", parent_id: "goal:aim", title: "A supervisor's second step" } }
    ]),
    decision("plan-e-3", "provisional", 3, [{ op: "add", goal: { id: "goal:p1", kind: "actionable_step", parent_id: "goal:aim", title: "A model's idea" } }]),
    decision("plan-e-4", "client", 4, [{ op: "add", goal: { id: "goal:c", kind: "actionable_step", parent_id: "goal:aim", title: "The step she chose" } }])
  );
  const first = applyRoadmapDecision(group, decision("plan-e-5", "client", 5, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:c", "goal:a1", "goal:a2", "goal:p1"] }]));
  assert.deepEqual(sourcesUnder(first, "goal:aim"), [["goal:a1", "authorized_plan"], ["goal:a2", "authorized_plan"], ["goal:p1", "provisional"], ["goal:c", "client"]]);
  assert.deepEqual(first.goals.filter((goal) => goal.history.some((entry) => entry.field === "rank")).map((goal) => goal.id), ["goal:c"], "only the goal she moved; the rest were renumbered");
  applyRoadmapDecision(first, decision("plan-e-6", "authorized_plan", 6, [{ op: "update", goal_id: "goal:a2", set: { status: "parked", status_reason: "The supervisor pauses its own step." } }]));
  applyRoadmapDecision(first, decision("plan-e-6", "provisional", 6, [{ op: "update", goal_id: "goal:p1", set: { status: "superseded", status_reason: "The model withdraws its idea." } }]));
  const done = applyRoadmapDecision(first, decision("plan-e-7", "client", 7, ["goal:c", "goal:a1", "goal:a2"].map((id) => ({ op: "update", goal_id: id, set: { status: "completed" } }))));
  const step = view(done).now.step;
  assert.deepEqual([step.id, step.priority_source, step.source_means], ["goal:p1", "provisional", "a model's proposal, not yet confirmed"]);
  // A goal she moved is hers to place: its own source can't move it back.
  const reordered = applyRoadmapDecision(group, decision("plan-e-8", "client", 5, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:a2", "goal:a1", "goal:p1", "goal:c"] }]));
  assert.throws(() => applyRoadmapDecision(reordered, decision("plan-e-9", "authorized_plan", 6, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:a1", "goal:a2", "goal:p1", "goal:c"] }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /cannot change which goals come before goal:a2: the client decided its rank last/u });
  // X2: an authorized plan that puts its own step first adopts none of the proposals it passes.
  const shifted = applyRoadmapDecision(planOf(
    decision("plan-e-10", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-e-11", "provisional", 2, [
      { op: "add", goal: { id: "goal:p1", kind: "actionable_step", parent_id: "goal:aim", title: "A model's idea" } },
      { op: "add", goal: { id: "goal:p2", kind: "actionable_step", parent_id: "goal:aim", title: "Another model's idea" } }
    ]),
    decision("plan-e-12", "authorized_plan", 3, [{ op: "add", goal: { id: "goal:a", kind: "actionable_step", parent_id: "goal:aim", title: "A supervisor's step" } }])
  ), decision("plan-e-13", "authorized_plan", 4, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:a", "goal:p1", "goal:p2"] }]));
  assert.deepEqual(sourcesUnder(shifted, "goal:aim"), [["goal:p1", "provisional"], ["goal:p2", "provisional"], ["goal:a", "authorized_plan"]]);
  applyRoadmapDecision(shifted, decision("plan-e-14", "provisional", 5, [{ op: "update", goal_id: "goal:p2", set: { status: "superseded", status_reason: "The model withdraws it." } }]));
  // O3: the client puts a model's idea behind her own step; the idea stays a proposal, and is current only as one.
  const demoted = applyRoadmapDecision(planOf(
    decision("plan-e-15", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-e-16", "provisional", 2, [{ op: "add", goal: { id: "goal:p", kind: "actionable_step", parent_id: "goal:aim", title: "A model's idea" } }]),
    decision("plan-e-17", "client", 3, [{ op: "add", goal: { id: "goal:c", kind: "actionable_step", parent_id: "goal:aim", title: "The step she chose" } }])
  ), decision("plan-e-18", "client", 4, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:c", "goal:p"] }]));
  assert.equal(demoted.goals.find((goal) => goal.id === "goal:p").priority_source, "provisional");
  const after = view(applyRoadmapDecision(demoted, decision("plan-e-19", "client", 5, [{ op: "update", goal_id: "goal:c", set: { status: "completed" } }]))).now.step;
  assert.deepEqual([after.id, after.source_means], ["goal:p", "a model's proposal, not yet confirmed"]);
  // O6: declining a model's proposal leaves it the model's, shown as declined; a plan of proposals stays one.
  const proposals = planOf(decision("plan-e-20", "provisional", 1, [
    { op: "add", goal: { id: "goal:model-aim", kind: "primary_aim", title: "A model's aim" } },
    { op: "add", goal: { id: "goal:model-step", kind: "actionable_step", parent_id: "goal:model-aim", title: "A model's step" } },
    { op: "add", goal: { id: "goal:model-other", kind: "actionable_step", parent_id: "goal:model-aim", title: "Another model's step" } }
  ]));
  const declined = view(applyRoadmapDecision(proposals, decision("plan-e-21", "client", 2, [{ op: "update", goal_id: "goal:model-other", set: { client_agreement: "declined" } }])));
  assert.equal(declined.status, "proposals_only");
  assert.deepEqual(declined.waiting.map((goal) => [goal.id, goal.priority_source, goal.source_means]), [["goal:model-other", "provisional", "a model's proposal; the client declined it"]]);
  // Agreement makes a goal the client's. An authorized plan adopts only a proposal the client hasn't answered, and it moves nothing.
  const agreed = applyRoadmapDecision(proposals, decision("plan-e-22", "client", 2, [{ op: "update", goal_id: "goal:model-step", set: { client_agreement: "agreed" } }]));
  assert.equal(agreed.goals.find((goal) => goal.id === "goal:model-step").priority_source, "client");
  const adopted = applyRoadmapDecision(proposals, decision("plan-e-23", "authorized_plan", 2, [{ op: "update", goal_id: "goal:model-other", set: { adopt: true } }]));
  const other = adopted.goals.find((goal) => goal.id === "goal:model-other");
  assert.deepEqual([other.priority_source, other.rank], ["authorized_plan", 2]);
  assert.deepEqual(other.history.at(-1), { at: AT(2), decision_id: "plan-e-23", source: "authorized_plan", field: "priority_source", from: "provisional", to: "authorized_plan" });
  for (const [source, goalId, roadmap] of [["provisional", "goal:model-other", proposals], ["client", "goal:model-other", proposals],
    ["authorized_plan", "goal:model-step", agreed], ["authorized_plan", "goal:model-other", adopted]]) {
    assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-e-24", source, 3, [{ op: "update", goal_id: goalId, set: { adopt: true } }])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" }, `${source} ${goalId}`);
  }
  assert.throws(() => applyRoadmapDecision(proposals, decision("plan-e-25", "authorized_plan", 3, [{ op: "update", goal_id: "goal:model-other", set: { adopt: false } }])), { code: "ROADMAP_INVALID" });
  // Retitling or parking a proposal adopts nothing.
  const retitled = applyRoadmapDecision(proposals, decision("plan-e-26", "authorized_plan", 2, [{ op: "update", goal_id: "goal:model-other", set: { title: "A retitled step" } }]));
  assert.equal(retitled.goals.find((goal) => goal.id === "goal:model-other").priority_source, "provisional");
});

test("no other source slips a goal ahead of one it may not move, and the view lists the client's goals first", () => {
  // O1: an authorized plan swaps a model's step ahead of the client's step with its own step behind it.
  const swap = planOf(
    decision("plan-o-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-o-2", "provisional", 2, [{ op: "add", goal: { id: "goal:p", kind: "actionable_step", parent_id: "goal:aim", title: "A model's step" } }]),
    decision("plan-o-3", "client", 3, [{ op: "add", goal: { id: "goal:c", kind: "actionable_step", parent_id: "goal:aim", title: "The step she chose" } }]),
    decision("plan-o-4", "authorized_plan", 4, [{ op: "add", goal: { id: "goal:b", kind: "actionable_step", parent_id: "goal:aim", title: "A supervisor's step" } }])
  );
  assert.equal(view(swap).now.step.id, "goal:c");
  assert.throws(() => applyRoadmapDecision(swap, decision("plan-o-5", "authorized_plan", 5, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:b", "goal:c", "goal:p"] }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /cannot change which goals come before goal:c: the client chose or answered it/u });
  // Behind her step, its own goals and the proposals are its to order.
  const more = applyRoadmapDecision(swap, decision("plan-o-6", "authorized_plan", 5, [{ op: "add", goal: { id: "goal:b2", kind: "actionable_step", parent_id: "goal:aim", title: "Another supervisor's step" } }]));
  assert.deepEqual(rankOrder(applyRoadmapDecision(more, decision("plan-o-7", "authorized_plan", 6, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:p", "goal:c", "goal:b2", "goal:b"] }])), "goal:aim"),
    ["goal:p", "goal:c", "goal:b2", "goal:b"]);
  // O1b: nor can a model's proposal swap its own steps around hers.
  const around = planOf(
    decision("plan-o-8", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-o-9", "provisional", 2, [{ op: "add", goal: { id: "goal:p1", kind: "actionable_step", parent_id: "goal:aim", title: "A model's step" } }]),
    decision("plan-o-10", "client", 3, [{ op: "add", goal: { id: "goal:c", kind: "actionable_step", parent_id: "goal:aim", title: "The step she chose" } }]),
    decision("plan-o-11", "provisional", 4, [{ op: "add", goal: { id: "goal:p2", kind: "actionable_step", parent_id: "goal:aim", title: "Another model's step" } }])
  );
  assert.throws(() => applyRoadmapDecision(around, decision("plan-o-12", "provisional", 5, [{ op: "order", parent_id: "goal:aim", goal_ids: ["goal:p2", "goal:c", "goal:p1"] }])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  // O2: the same among primary aims.
  const aims = planOf(
    decision("plan-o-13", "provisional", 1, [{ op: "add", goal: { id: "goal:model-aim", kind: "primary_aim", title: "A model's aim" } }]),
    decision("plan-o-14", "client", 2, [
      { op: "add", goal: { id: "goal:client-aim", kind: "primary_aim", title: "Her aim" } },
      { op: "add", goal: { id: "goal:client-step", kind: "actionable_step", parent_id: "goal:client-aim", title: "Her step" } }
    ]),
    decision("plan-o-15", "authorized_plan", 3, [
      { op: "add", goal: { id: "goal:auth-aim", kind: "primary_aim", title: "A supervisor's aim" } },
      { op: "add", goal: { id: "goal:auth-step", kind: "actionable_step", parent_id: "goal:auth-aim", title: "A supervisor's step" } }
    ])
  );
  assert.throws(() => applyRoadmapDecision(aims, decision("plan-o-16", "authorized_plan", 4, [{ op: "order", parent_id: null, goal_ids: ["goal:auth-aim", "goal:client-aim", "goal:model-aim"] }])),
    { code: "ROADMAP_CHANGE_NOT_ALLOWED" });
  // O2b: adopting the model's aim ranked ahead of hers moves nothing, and the view lists her aim and her step first.
  const adopted = applyRoadmapDecision(aims, decision("plan-o-17", "authorized_plan", 4, [{ op: "update", goal_id: "goal:model-aim", set: { adopt: true } }]));
  assert.equal(adopted.goals.find((goal) => goal.id === "goal:model-aim").rank, 1);
  const plan = view(adopted);
  assert.deepEqual(plan.primary.map((goal) => [goal.id, goal.priority_source]), [["goal:client-aim", "client"], ["goal:model-aim", "authorized_plan"], ["goal:auth-aim", "authorized_plan"]]);
  assert.deepEqual(plan.within.map((goal) => goal.id), ["goal:client-step", "goal:auth-step"]);
  assert.equal(plan.now.step.id, "goal:client-step");
  assert.match(plan.note, /the client's first, then an authorized plan's, then a model's proposals, each in its recorded order/u);
  // An authorized step linked to the episode doesn't take the current step from hers: the episode serves a goal elsewhere.
  const linked = view(applyRoadmapDecision(adopted, decision("plan-o-18", "authorized_plan", 5, [{ op: "update", goal_id: "goal:auth-step", set: { serves_episode_id: "episode:boundaries" } }])));
  assert.deepEqual([linked.now.step.id, linked.now.episode_link, linked.now.episode_serves], ["goal:client-step", "linked_elsewhere", [{ goal_id: "goal:auth-step", priority_source: "authorized_plan" }]]);
  // Her own step linked to the episode is the current step, wherever it sits.
  const hers = view(applyRoadmapDecision(adopted, decision("plan-o-19", "client", 5, [
    { op: "add", goal: { id: "goal:client-step-2", kind: "actionable_step", parent_id: "goal:client-aim", title: "Her second step", serves_episode_id: "episode:boundaries" } }
  ])));
  assert.deepEqual([hers.now.step.id, hers.now.episode_link], ["goal:client-step-2", "linked"]);
});

test("no other source parks, supersedes or moves a goal that holds an active goal of the client's beneath it", () => {
  const held = planOf(
    decision("plan-p-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-p-2", "authorized_plan", 2, [
      { op: "add", goal: { id: "goal:w1", kind: "goal_within", parent_id: "goal:aim", title: "A supervisor's goal within" } },
      { op: "add", goal: { id: "goal:w2", kind: "goal_within", parent_id: "goal:aim", title: "Another supervisor's goal within" } },
      { op: "add", goal: { id: "goal:w2-step", kind: "actionable_step", parent_id: "goal:w2", title: "A supervisor's step" } }
    ]),
    decision("plan-p-3", "provisional", 3, [{ op: "add", goal: { id: "goal:pw", kind: "goal_within", parent_id: "goal:aim", title: "A model's goal within" } }]),
    decision("plan-p-4", "client", 4, [
      { op: "add", goal: { id: "goal:c", kind: "actionable_step", parent_id: "goal:w1", title: "The step she chose", serves_episode_id: "episode:boundaries" } },
      { op: "add", goal: { id: "goal:c2", kind: "actionable_step", parent_id: "goal:pw", title: "Another step she chose" } }
    ])
  );
  assert.deepEqual([view(held).now.step.id, view(held).now.episode_link], ["goal:c", "linked"]);
  for (const [source, change] of [
    ["authorized_plan", { op: "update", goal_id: "goal:w1", set: { status: "parked", status_reason: "Later." } }],
    ["authorized_plan", { op: "order", parent_id: "goal:aim", goal_ids: ["goal:w2", "goal:w1", "goal:pw"] }],
    ["provisional", { op: "update", goal_id: "goal:pw", set: { status: "superseded", status_reason: "Rethought." } }]
  ]) {
    assert.throws(() => applyRoadmapDecision(held, decision("plan-p-5", source, 5, [change])), { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /a goal of the client's sits beneath it/u }, JSON.stringify(change));
  }
  // A goal that holds none of hers stays its source's to change.
  assert.equal(applyRoadmapDecision(held, decision("plan-p-6", "authorized_plan", 5, [{ op: "update", goal_id: "goal:w2", set: { status: "parked", status_reason: "Later." } }]))
    .goals.find((goal) => goal.id === "goal:w2").status, "parked");
});

test("what the client decided last about a goal stays as she decided it, whoever the goal belongs to", () => {
  let roadmap = planOf(
    decision("plan-q-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-q-2", "provisional", 2, [{ op: "add", goal: { id: "goal:p", kind: "actionable_step", parent_id: "goal:aim", title: "A model's idea" } }]),
    decision("plan-q-3", "client", 3, [{ op: "update", goal_id: "goal:p", set: { review_condition: "Revisit after the move.", serves_episode_id: "episode:boundaries" } }])
  );
  const proposal = () => roadmap.goals.find((goal) => goal.id === "goal:p");
  // O5: her review condition and episode link go in the history under their own names, with where she said them.
  assert.deepEqual(proposal().history.slice(-2).map((entry) => [entry.field, entry.source, entry.refs]), [["review_condition", "client", CLIENT_TURN], ["serves_episode_id", "client", CLIENT_TURN]]);
  assert.equal(proposal().priority_source, "provisional");
  for (const set of [{ review_condition: "" }, { serves_episode_id: null }]) {
    assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-q-4", "provisional", 4, [{ op: "update", goal_id: "goal:p", set }])),
      { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /the client decided its (review condition|serves episode id) last/u }, JSON.stringify(set));
  }
  // A goal she parked stays parked, even after its source floods its history.
  roadmap = applyRoadmapDecision(roadmap, decision("plan-q-5", "client", 4, [{ op: "update", goal_id: "goal:p", set: { status: "parked", status_reason: "Not now." } }]));
  for (let index = 0; index < 45; index += 1) {
    roadmap = applyRoadmapDecision(roadmap, { decision_id: `plan-q-title-${index}`, source: "provisional", at: new Date(Date.UTC(2026, 9, 18, 0, index)).toISOString(), evidence_refs: [],
      changes: [{ op: "update", goal_id: "goal:p", set: { title: `A model's idea, version ${index}` } }] });
  }
  assert.equal(proposal().history.length, 40);
  assert.deepEqual(["review_condition", "serves_episode_id", "status"].map((field) => proposal().history.findLast((entry) => entry.field === field).source), ["client", "client", "client"]);
  for (const set of [{ status: "active" }, { status_reason: "The model's reason." }]) {
    assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-q-6", "provisional", 60 * 24, [{ op: "update", goal_id: "goal:p", set }])),
      { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /the client decided its status last/u }, JSON.stringify(set));
  }
});

test("on a goal the client chose, another source keeps her notes: it adds to lists and writes a note only while it is empty", () => {
  const roadmap = planOf(decision("plan-s-1", "client", 1, [
    { op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } },
    { op: "add", goal: { id: "goal:c", kind: "actionable_step", parent_id: "goal:aim", title: "The step she chose", blockers: ["Not while her mother is visiting."],
      counterevidence: ["Last time it made the nights worse."], expected_progress: "She sleeps through once a week.", uncertainty: "Whether she can." } }
  ]));
  // N1: nothing she wrote is erased or overwritten.
  for (const set of [{ blockers: [] }, { counterevidence: ["Something else."] }, { expected_progress: "Daily practice." }, { uncertainty: "" }]) {
    assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-s-2", "authorized_plan", 2, [{ op: "update", goal_id: "goal:c", set }])), { code: "ROADMAP_CHANGE_NOT_ALLOWED" }, JSON.stringify(set));
  }
  const added = applyRoadmapDecision(roadmap, decision("plan-s-3", "authorized_plan", 2, [{ op: "update", goal_id: "goal:c", set: {
    blockers: ["Not while her mother is visiting.", "A supervisor's note: the night shifts."], next_step_tests: "Whether a short version is possible."
  } }]));
  const step = view(added).now.step;
  assert.deepEqual([step.blockers, step.counterevidence, step.expected_progress, step.uncertainty, step.next_step_tests], [
    ["Not while her mother is visiting.", "A supervisor's note: the night shifts."], ["Last time it made the nights worse."], "She sleeps through once a week.", "Whether she can.",
    "Whether a short version is possible."]);
});

test("a goal the client declined isn't offered again under a title that reads the same, or as another goal's new title", () => {
  const roadmap = planOf(
    decision("plan-t-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim" } }]),
    decision("plan-t-2", "provisional", 2, [
      { op: "add", goal: { id: "goal:dialogue", kind: "actionable_step", parent_id: "goal:aim", title: "Daily inner-child dialogue" } },
      { op: "add", goal: { id: "goal:other", kind: "actionable_step", parent_id: "goal:aim", title: "Something else" } },
      { op: "add", goal: { id: "goal:breathing", kind: "actionable_step", parent_id: "goal:aim", title: "L'exercice de respiration" } }
    ]),
    decision("plan-t-3", "client", 3, [
      { op: "update", goal_id: "goal:dialogue", set: { client_agreement: "declined" } },
      { op: "update", goal_id: "goal:breathing", set: { client_agreement: "declined" } }
    ])
  );
  // M1: a retitle to a declined title, or a title that differs only by an article, spacing or punctuation.
  for (const [source, change] of [
    ["provisional", { op: "update", goal_id: "goal:other", set: { title: "Daily inner-child dialogue" } }],
    ["authorized_plan", { op: "update", goal_id: "goal:other", set: { title: "The daily  inner child dialogue." } }],
    ["provisional", { op: "add", goal: { id: "goal:again", kind: "actionable_step", parent_id: "goal:aim", title: "A daily inner-child dialogue" } }],
    ["authorized_plan", { op: "add", goal: { id: "goal:again", kind: "actionable_step", parent_id: "goal:aim", title: "Exercice de respiration" } }]
  ]) {
    assert.throws(() => applyRoadmapDecision(roadmap, decision("plan-t-4", source, 4, [change])), { code: "ROADMAP_CHANGE_NOT_ALLOWED", message: /declined a goal with this title/u }, JSON.stringify(change));
  }
  // She can bring it back herself.
  assert.ok(applyRoadmapDecision(roadmap, decision("plan-t-5", "client", 4, [{ op: "add", goal: { id: "goal:again", kind: "actionable_step", parent_id: "goal:aim", title: "A daily inner-child dialogue" } }])));
});

test("a plan reads as proposals only while some goal is active and none of the active goals is the client's or an authorized plan's", () => {
  const finishedAim = planOf(
    decision("plan-v-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Her aim" } }]),
    decision("plan-v-2", "client", 2, [{ op: "update", goal_id: "goal:aim", set: { status: "completed" } }]),
    decision("plan-v-3", "provisional", 3, [{ op: "add", goal: { id: "goal:model-aim", kind: "primary_aim", title: "A model's aim" } }])
  );
  assert.equal(view(finishedAim).status, "proposals_only");
  assert.deepEqual(view(finishedAim).finished.map((goal) => [goal.id, goal.source_means]), [["goal:aim", "the client's choice"]]);
  const nothingActive = applyRoadmapDecision(finishedAim, decision("plan-v-4", "provisional", 4, [{ op: "update", goal_id: "goal:model-aim", set: { status: "superseded", status_reason: "Withdrawn." } }]));
  assert.equal(view(nothingActive).status, "recorded");
});

test("the private audit and repair prompts show a stored plan as its view, never its histories or the decisions applied to it", () => {
  const state = applyCaseStatePatch(caseState(), { roadmap: planA() });
  // M2: the roles that check and repair a candidate see the plan as the roles that produce it do.
  for (const prompt of [privateRuntimeAuditPrompt({ schema_version: 1, candidate_response: "Synthetic.", case_state: state }),
    privateRuntimeRepairPrompt({ schema_version: 1, failed_candidate_response: "Synthetic.", case_state: state })]) {
    assert.match(prompt.user, /"case_plan": \{\n\s+"status": "recorded"/u);
    for (const stored of ["applied_decisions", "\"history\"", "digest"]) assert.equal(prompt.user.includes(stored), false, stored);
  }
  assert.equal(privateRuntimeAuditPrompt({ schema_version: 1, candidate_response: "Synthetic.", case_state: caseState() }).user.includes("case_plan"), false, "a case without a plan shows as before");
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
  const open = async ({ now = null } = {}) => {
    const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
    t.after(() => providers.close());
    return createPrivateCaseAccessService({
      rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true, ...(now ? { now } : {})
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
  // The client's own words the client decisions point to.
  await service.appendTranscriptTurn("synthetic-case-a", { id: CLIENT_TURN[0], exchange_id: "turn", role: "user", text: "Synthetic client words.", at: AT(0), episode_id: null }, authA);
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

test("the plan has one writer: a whole-state write from an earlier read or another scope keeps the stored plan", async (t) => {
  const { open } = await environment(t);
  const authA = { bearerToken: TOKEN_A };
  const service = await open();
  await service.saveCaseState("synthetic-case-a", caseState("synthetic-case-a"), authA);
  await service.appendTranscriptTurn("synthetic-case-a", { id: CLIENT_TURN[0], exchange_id: "turn", role: "user", text: "Synthetic client words.", at: AT(0), episode_id: null }, authA);
  await service.saveCaseDiff("synthetic-case-a", { schema_version: 1, additions: ["evidence:synthetic"], current_episode_changed: true }, { turnId: "T1-user", diffId: "diff:T1" }, authA);
  // A runtime reads the state, a decision is recorded, then the runtime writes the state it computed from its earlier read.
  const earlierRead = await service.getCaseState("synthetic-case-a", authA);
  await service.recordRoadmapDecision("synthetic-case-a", CASE_A_PLAN, authA);
  await service.saveCaseState("synthetic-case-a", earlierRead, authA);
  assert.deepEqual((await service.getCaseState("synthetic-case-a", authA)).roadmap, applyRoadmapDecision(null, CASE_A_PLAN), "the decision survives");
  // A write that carries its own plan can't replace the stored one.
  const forged = structuredClone(earlierRead);
  forged.roadmap = applyRoadmapDecision(null, { ...CASE_A_TRACK, decision_id: "forged-1", source: "client", evidence_refs: CLIENT_TURN });
  await service.saveCaseState("synthetic-case-a", forged, authA);
  assert.deepEqual((await service.getCaseState("synthetic-case-a", authA)).roadmap, applyRoadmapDecision(null, CASE_A_PLAN));
  // A plan decision joins the diff history without displacing the last turn's diff.
  assert.equal((await service.getCaseDiff("synthetic-case-a", {}, authA)).id, "diff:T1", "the last diff is the last turn's");
  assert.equal((await service.getCaseDiff("synthetic-case-a", { diffId: "roadmap:plan-a-1" }, authA)).diff.roadmap_changed, true, "the decision's diff is found by its id");
  const context = await service.loadCaseContext("synthetic-case-a", authA, { requireContinuationSafe: false, requireAuditScope: true });
  assert.deepEqual(context.last_state_diff.diff.additions, ["evidence:synthetic"], "the last turn's diff is still the case's last diff");
  // A client decision must point to the client's own words in this case.
  await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-a", decision("plan-w-1", "client", 3, [{ op: "update", goal_id: "goal:weekly-refusal", set: { status: "completed" } }], { evidence_refs: ["turn:not-in-this-case"] }), authA),
    { code: "ROADMAP_CLIENT_EVIDENCE_UNRESOLVED" });
});


// A plan this version can't read, as another version might store it: written into the encrypted record directly.
async function storeRoadmapAsIs(privateRoot, caseId, routineSeed, roadmap) {
  const file = path.join(privateRoot, "vaults", `${caseId}.vault.json`);
  const routineKek = Buffer.alloc(32, routineSeed);
  const envelope = deserializeVaultEnvelope(JSON.parse(await fs.readFile(file, "utf8")));
  const record = JSON.parse(Buffer.from(await decryptVaultEnvelopeWithRoutineKek({ envelope, routineKek })).toString("utf8"));
  record.case_state.roadmap = roadmap;
  const next = await replaceVaultPayloadWithRoutineKek({ envelope, plaintextBytes: Buffer.from(JSON.stringify(record), "utf8"), routineKek });
  await fs.writeFile(file, `${JSON.stringify(serializeVaultEnvelope(next))}\n`, { mode: 0o600 });
}

test("in the store: client references name her words in a session, plan diffs keep their own ids, and a plan another version wrote stays as it was", async (t) => {
  const { privateRoot, open } = await environment(t);
  const authA = { bearerToken: TOKEN_A };
  let clock = AT(0);
  const service = await open({ now: () => clock });
  await service.saveCaseState("synthetic-case-a", caseState("synthetic-case-a"), authA);
  for (const turn of [
    { id: CLIENT_TURN[0], exchange_id: "x1", role: "user", text: "Synthetic client words.", at: AT(0), episode_id: null },
    { id: "turn:synthetic-assistant-1", exchange_id: "x1", role: "assistant", text: "Synthetic reply.", at: AT(0), episode_id: null }
  ]) await service.appendTranscriptTurn("synthetic-case-a", turn, authA);
  await service.saveCaseDiff("synthetic-case-a", { schema_version: 1, additions: ["evidence:synthetic"] }, { turnId: CLIENT_TURN[0], diffId: "diff:T1" }, authA);
  await service.appendJournal("synthetic-case-a", { id: "journal:synthetic-1", observed_at: AT(0), text: "A synthetic journal entry." }, authA);
  await service.saveSourceArtifact("synthetic-case-a", "source:synthetic-document", chunkExactSourceText("A synthetic document."), {}, authA);
  for (const [amendmentId, targetTurnId, sourceArtifactId] of [["amend:user", CLIENT_TURN[0], "source:user-completion"], ["amend:assistant", "turn:synthetic-assistant-1", "source:assistant-completion"]]) {
    await service.appendTranscriptCompletionAmendment("synthetic-case-a", { amendmentId, targetTurnId, completionText: " More synthetic words.", sourceArtifactId, sourceMetadata: {}, producerContextId: "context:synthetic" }, authA);
  }

  // R1: her turn, or the artifact that completes it, in the decision's references and in those it gives a goal.
  clock = AT(1);
  const plan = decision("plan-w-1", "client", 1, [{ op: "add", goal: { id: "goal:aim", kind: "primary_aim", title: "Synthetic aim", evidence_refs: ["source:user-completion"] } }], { turn_id: CLIENT_TURN[0] });
  assert.equal((await service.recordRoadmapDecision("synthetic-case-a", plan, authA)).applied, true);
  for (const evidence_refs of [["turn:synthetic-assistant-1"], ["source:assistant-completion"], ["journal:synthetic-1"], ["source:synthetic-document"]]) {
    await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-a", decision("plan-w-2", "client", 2, [{ op: "update", goal_id: "goal:aim", set: { uncertainty: "Synthetic." } }], { evidence_refs }), authA),
      { code: "ROADMAP_CLIENT_EVIDENCE_UNRESOLVED" }, evidence_refs[0]);
  }
  for (const change of [
    { op: "add", goal: { id: "goal:step", kind: "actionable_step", parent_id: "goal:aim", title: "Synthetic step", evidence_refs: ["anything:at-all"] } },
    { op: "update", goal_id: "goal:aim", set: { evidence_refs: ["source:user-completion", "turn:synthetic-assistant-1"] } }
  ]) {
    await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-a", decision("plan-w-3", "client", 2, [change]), authA), { code: "ROADMAP_CLIENT_EVIDENCE_UNRESOLVED" }, change.op);
  }

  // R2: a plan decision recorded with her turn never stands in for that turn's own diff, and no other writer takes its prefix.
  assert.equal((await service.getCaseDiff("synthetic-case-a", { turnId: CLIENT_TURN[0] }, authA)).id, "diff:T1");
  assert.equal((await service.getCaseDiff("synthetic-case-a", { diffId: "roadmap:plan-w-1" }, authA)).turn_id, CLIENT_TURN[0]);
  await assert.rejects(() => service.saveCaseDiff("synthetic-case-a", { schema_version: 1 }, { turnId: "T2-user", diffId: "roadmap:plan-w-9" }, authA), /starts with roadmap: only for a plan decision/u);

  // R5: the store's clock bounds a decision's date to five minutes ahead, so one wrong date can't hold up the next decisions.
  await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-a", { ...decision("plan-w-4", "authorized_plan", 1, [{ op: "update", goal_id: "goal:aim", set: { next_step_tests: "Dated in the wrong zone." } }]),
    at: new Date(Date.parse(AT(1)) + 23 * 3_600_000).toISOString() }, authA), { code: "ROADMAP_DECISION_IN_FUTURE" });
  clock = AT(61);
  assert.equal((await service.recordRoadmapDecision("synthetic-case-a", decision("plan-w-5", "client", 61, [{ op: "update", goal_id: "goal:aim", set: { uncertainty: "An hour later." } }]), authA)).applied, true);

  // U2, U3: a plan another version wrote. No decision is recorded on it, a whole-state write ignores the plan it carries, and
  // the check tool still answers, saying the plan's goals were left out.
  await storeRoadmapAsIs(privateRoot, "synthetic-case-a", 31, { version: "case-roadmap-v9", goals: [] });
  await assert.rejects(() => service.recordRoadmapDecision("synthetic-case-a", decision("plan-w-6", "client", 62, [{ op: "add", goal: { id: "goal:other", kind: "primary_aim", title: "Another aim" } }]), authA),
    (error) => error.code === "ROADMAP_VERSION_UNKNOWN" && /written by another version of InnerSignal/u.test(error.message) && !/repair/u.test(error.message));
  const stored = await service.getCaseState("synthetic-case-a", authA);
  await service.saveCaseState("synthetic-case-a", { ...stored, roadmap: null }, authA);
  assert.equal((await service.getCaseState("synthetic-case-a", authA)).roadmap.version, "case-roadmap-v9");
  const checked = await service.checkCaseKnownVersusNew("synthetic-case-a", { points: ["Synthetic aim here"], limit: 3 }, authA);
  assert.deepEqual([checked.plan_problem, checked.points.length], ["ROADMAP_VERSION_UNKNOWN", 1]);
  // A whole-state write without a state is refused as a validation error, as before.
  await assert.rejects(() => service.saveCaseState("synthetic-case-a", null, authA), (error) => error instanceof ValidationError && /caseState must be an object/u.test(error.message));
  const store = createEncryptedPrivateCaseStore({ rootDir: path.join(privateRoot, "vaults"), routineKek: Buffer.alloc(32, 31), recoverySecretBytes: Buffer.alloc(32, 32), developmentExternalCredentialAuthorized: true });
  t.after(() => store.close());
  await assert.rejects(() => store.commitTurn("synthetic-case-a", { transcript_entries: [], state_diff: null }), (error) => error instanceof ValidationError && /caseState must be an object/u.test(error.message));
});
