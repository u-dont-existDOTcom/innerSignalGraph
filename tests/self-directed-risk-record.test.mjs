import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyCaseStatePatch,
  caseStateForClient,
  createEmptyCaseState,
  diffCaseStates,
  mergeRuntimeSnapshotIntoCaseState,
  projectCaseStateForInspection,
  validateCaseState
} from "../src/case-state/longitudinal-state.mjs";
import {
  SELF_DIRECTED_RISK_HISTORY_LIMIT,
  SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS,
  SELF_DIRECTED_RISK_LOWERING_READINGS,
  SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID,
  SELF_DIRECTED_RISK_RETRIEVAL_REASON,
  firstSelfDirectedRiskReading,
  highestSelfDirectedRiskReading,
  selfDirectedRiskRetrievalTurn,
  selfDirectedRiskRetrievalTurns,
  validateSelfDirectedRiskState
} from "../src/case-state/self-directed-risk.mjs";
import { buildDurableCaseContext, decisionRelevantProjection, targetedRetrievalRequests } from "../src/case-state/context-window.mjs";
import { SAFETY_ORIENTATION_ROUTE_ID, SUICIDE_FAMILY_ROUTE_IDS, buildTrajectoryDigest, routeOfHistoryItem } from "../src/case-state/trajectory-digest.mjs";
import { durableCaseContextBlock, promptCaseState } from "../src/prompts/common.mjs";
import { privateRuntimeAuditPrompt } from "../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeRepairPrompt } from "../src/prompts/private-runtime-repair.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { immediateProtectionNeeded } from "../src/case-formulation/turn-task.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";

// All wording here is abstract and synthetic. Nothing below is client, case or journal material; a reading is only the extractor's
// suicidal_state value for a turn, and the user messages are placeholders.
const CALM = "IC.CREDIBILITY_REPAIR";
const INQUIRY = "IC.SUICIDAL_SELF_DEATH_INQUIRY";
const ADULT_SEAT = "IC.SUICIDAL_ADULT_SEAT";
const SAFETY = "IC.SAFETY_ORIENTATION";
const at = (number) => `2026-11-01T${String(Math.floor(number / 60)).padStart(2, "0")}:${String(number % 60).padStart(2, "0")}:00.000Z`;
const contract = (route) => ({ primaryJob: { id: route, title: `Synthetic route ${route}` }, nextQuestion: "", selectedNodes: [], variables: {} });
const reading = (state, extra = {}) => ({ state, route: CALM, ...extra });

function snapshotFor({ state, context = "unknown", missing = false }) {
  return {
    ...(missing ? {} : { variables: { suicidal_state: state, suicidal_ideation_context: context } }),
    direct_observations: [{ id: "O1", statement: "Synthetic observation.", evidence: "Synthetic user message." }],
    hypotheses: []
  };
}

// Builds a case turn by turn through the real merge. `pending` leaves the last user turn without its reply, as it is while it is audited.
function runCase(turns, { pending = true } = {}) {
  let caseState = createEmptyCaseState({ caseId: "synthetic-risk-case" });
  const transcript = [];
  const states = [];
  turns.forEach((turn, index) => {
    const number = index + 1;
    const turnId = `T${number}-user`;
    caseState = mergeRuntimeSnapshotIntoCaseState(caseState, snapshotFor(turn), { turnId, recordedAt: at(number), interventionContract: contract(turn.route ?? CALM) });
    states.push(caseState);
    const episode_id = caseState.current_episode.id;
    transcript.push({ id: turnId, exchange_id: `X${number}`, role: "user", text: `Synthetic user message ${number}.`, at: at(number), episode_id });
    if (!(pending && number === turns.length)) transcript.push({ id: `T${number}-assistant`, exchange_id: `X${number}`, role: "assistant", text: `Synthetic reply ${number}.`, at: at(number), episode_id });
  });
  return { caseState, transcript, states };
}

// What the store's loadCaseContext hands the audit input builder (it asks for the reply-check evidence), built from the same pure functions.
function auditContext({ caseState, transcript }) {
  const durable = buildDurableCaseContext({ caseId: caseState.case_id, caseState, transcriptEntries: transcript, forReplyCheck: true });
  return {
    case_state: caseState,
    recent_verbatim: durable.recent_verbatim_window,
    targeted_older_evidence: durable.targeted_older_evidence,
    user_turn_count: transcript.filter((turn) => turn.role === "user").length,
    durable
  };
}

const levelsOf = (states) => states.map((state) => state.self_directed_risk?.current?.level ?? null);
const turnNumberOf = (entry) => Number(entry.id.match(/^T(\d+)-/u)[1]);
// The reply-check context as it stood while turn `number` was audited: its state after that turn's merge, its user turn still unanswered.
function replyCheckContextAt(built, number, { forReplyCheck = true } = {}) {
  const transcript = built.transcript.filter((entry) => turnNumberOf(entry) < number || (entry.role === "user" && turnNumberOf(entry) === number));
  return buildDurableCaseContext({ caseId: "synthetic-risk-case", caseState: built.states[number - 1], transcriptEntries: transcript, forReplyCheck });
}
const recordRequest = (context) => context.targeted_retrieval_requests.find((item) => item.item_id === SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID) ?? null;
// Every turn the record asks for, in request order: the highest reading's turn first, then the first reading's.
const riskTurns = (context) => context.targeted_retrieval_requests.filter((item) => item.item_id === SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID).map((item) => item.turn_id);
const calmFive = Array.from({ length: 5 }, () => reading("absent"));

test("a case with no reading above absent never carries the record, so such cases are unchanged", () => {
  const { caseState } = runCase([reading("absent"), reading("unknown"), reading("absent", { missing: true }), reading("absent")]);
  assert.equal(Object.hasOwn(caseState, "self_directed_risk"), false);
  assert.equal(validateCaseState(caseState).case_id, "synthetic-risk-case");
});

test("the first reading above absent creates a small record from the fields the extraction already returns", () => {
  const { caseState } = runCase([reading("absent"), reading("ideation", { context: "other_or_unclear" })], { pending: false });
  const record = caseState.self_directed_risk;
  assert.equal(record.version, 1);
  assert.deepEqual(
    { level: record.current.level, context: record.current.context, assessed: record.current.assessed_turn_id, at: record.current.assessed_at, latest: record.current.latest_turn_id, denied: record.current.denied, unknown: record.current.unknown, pending: record.current.lowering_readings },
    { level: "ideation", context: "other_or_unclear", assessed: "T2-user", at: at(2), latest: "T2-user", denied: false, unknown: false, pending: [] }
  );
  assert.deepEqual(record.current.observation_ids, ["obs:T2-user:O1"]);
  assert.deepEqual(record.history.map((entry) => [entry.change, entry.level, entry.reading, entry.assessed_turn_id]), [["raised", "ideation", "ideation", "T2-user"]]);
  assert.equal(validateSelfDirectedRiskState(record), record);
});

test("the record persists across a route change and keeps the turn that established the level", () => {
  const turns = [...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("unknown")];
  const { caseState, states } = runCase(turns);
  assert.equal(caseState.current_episode.route, CALM);
  assert.equal(caseState.current_episode.started_turn_id, "T8-user", "the route changed at turn 8, which started a new episode");
  assert.deepEqual(levelsOf(states), [null, null, null, null, null, "ideation", "ideation", "ideation", "ideation"]);
  const current = caseState.self_directed_risk.current;
  assert.equal(current.assessed_turn_id, "T6-user", "a repeat of the same level does not move the turn to retrieve");
  assert.equal(current.latest_turn_id, "T9-user");
  assert.deepEqual([current.denied, current.unknown, current.lowering_readings], [false, true, []], "the unknown reading restarts the run of lower readings");
  assert.deepEqual(caseState.self_directed_risk.history.map((entry) => [entry.change, entry.assessed_turn_id]), [["raised", "T6-user"], ["held", "T7-user"]]);
});

test("for the reply check, the turns of the record's highest and first readings enter targeted_older_evidence when the window no longer holds them, and only then", () => {
  const turns = [...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("unknown")];
  const built = runCase(turns);
  const outside = buildDurableCaseContext({ caseState: built.caseState, transcriptEntries: built.transcript, forReplyCheck: true });
  assert.deepEqual(outside.recent_verbatim_window.turns.map((turn) => turn.id), ["T8-user", "T8-assistant", "T9-user"]);
  assert.deepEqual(recordRequest(outside), { reason: SELF_DIRECTED_RISK_RETRIEVAL_REASON, turn_id: "T7-user", item_id: SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID }, "the latest turn at the highest reading; the record's own anchor stays on turn 6");
  assert.equal(SELF_DIRECTED_RISK_RETRIEVAL_REASON, "current-self-directed-risk-record");
  assert.equal(built.caseState.self_directed_risk.current.assessed_turn_id, "T6-user");
  const evidence = outside.targeted_older_evidence.find((item) => item.turn_id === "T7-user");
  assert.deepEqual(evidence.item_ids, [SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID]);
  assert.deepEqual(evidence.reasons, [SELF_DIRECTED_RISK_RETRIEVAL_REASON]);
  assert.equal(evidence.turn.text, "Synthetic user message 7.");
  assert.equal(JSON.stringify(outside.targeted_retrieval_requests).includes("ideation"), false, "the label names no level");
  // The first statement (turn 6) is no longer lost to the later, equal reading (turn 7): both turns reach the reply check, under one label.
  assert.deepEqual(riskTurns(outside), ["T7-user", "T6-user"]);
  const first = outside.targeted_older_evidence.find((item) => item.turn_id === "T6-user");
  assert.deepEqual([first.reasons, first.item_ids, first.turn.text], [[SELF_DIRECTED_RISK_RETRIEVAL_REASON], [SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID], "Synthetic user message 6."]);
  assert.deepEqual(outside.targeted_older_evidence.map((item) => item.turn_id), ["T7-user", "T6-user"], "two turns, each once");

  const inside = runCase([...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY })]);
  const insideContext = buildDurableCaseContext({ caseState: inside.caseState, transcriptEntries: inside.transcript, forReplyCheck: true });
  assert.equal(recordRequest(insideContext), null, "both turns are already in the window");
  assert.deepEqual(insideContext.targeted_older_evidence, []);
});

test("only the reply check gets that request: a context built the way the producers' is carries neither the request nor the turn", () => {
  const built = runCase([...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("unknown")]);
  const args = { caseState: built.caseState, transcriptEntries: built.transcript };
  for (const producers of [buildDurableCaseContext(args), buildDurableCaseContext({ ...args, forReplyCheck: false })]) {
    assert.equal(recordRequest(producers), null);
    assert.deepEqual(producers.targeted_older_evidence, []);
    assert.equal(JSON.stringify(producers).includes(SELF_DIRECTED_RISK_RETRIEVAL_REASON), false);
  }
  assert.equal(targetedRetrievalRequests(built.caseState, []).some((item) => item.item_id === SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID), false);
  assert.equal(targetedRetrievalRequests(built.caseState, [], { forReplyCheck: true }).some((item) => item.item_id === SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID), true);
  assert.equal(recordRequest(buildDurableCaseContext({ ...args, forReplyCheck: true })).turn_id, "T7-user");
  // Neither the first statement's turn nor the stored first reading reaches the producers' context.
  for (const producers of [buildDurableCaseContext(args), buildDurableCaseContext({ ...args, forReplyCheck: false })]) {
    assert.deepEqual(riskTurns(producers), []);
    assert.equal(JSON.stringify(producers.targeted_older_evidence).includes("Synthetic user message 6."), false);
  }
});

test("a lowering from intent to ideation keeps the turn of the intent reading in the packet, not the later ideation turn", () => {
  // Turns 2 to 4 stay on one route, so turn 2 is still in the verbatim window then; the route changes at turn 5.
  const built = runCase([reading("absent"), reading("intent", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("absent")]);
  const record = built.states[3].self_directed_risk;
  assert.deepEqual([record.current.level, record.current.assessed_turn_id], ["ideation", "T4-user"], "the level-lowering rule is unchanged: two fresh ideation readings lowered intent to ideation");
  assert.deepEqual(highestSelfDirectedRiskReading(record), record.history[0]);
  assert.equal(highestSelfDirectedRiskReading(record).assessed_turn_id, "T2-user");
  assert.equal(recordRequest(replyCheckContextAt(built, 4)), null, "turn 2 is still in the window while the route is unchanged");
  assert.equal(levelsOf(built.states)[4], "ideation", "turn 5: one quiet reading does not lower it");
  for (const number of [5, 6]) {
    const context = replyCheckContextAt(built, number);
    assert.deepEqual(context.recent_verbatim_window.turns.map((turn) => turn.id).includes("T2-user"), false);
    assert.equal(recordRequest(context)?.turn_id, "T2-user", `turn ${number}: the exact intent statement, not the ideation turn 3 or 4`);
    assert.equal(context.targeted_older_evidence.find((item) => item.turn_id === "T2-user").turn.text, "Synthetic user message 2.");
  }
  assert.equal(built.states[5].self_directed_risk.current.level, "absent", "turn 6 is the second quiet reading, which lowers it to absent");
});

test("an equal highest reading goes to the latest turn, and a re-raise after a lowering to absent moves the turn to the new reading", () => {
  const built = runCase([reading("ideation", { route: INQUIRY }), reading("absent"), reading("absent"), reading("absent"), reading("ideation", { route: INQUIRY }), reading("absent")]);
  assert.deepEqual(levelsOf(built.states), ["ideation", "ideation", "absent", "absent", "ideation", "ideation"]);
  assert.equal(selfDirectedRiskRetrievalTurn(built.states[1]), "T1-user");
  assert.equal(selfDirectedRiskRetrievalTurn(built.states[4]), "T5-user", "the earlier ideation turn is no longer the one to retrieve once the person says it again");
  assert.equal(highestSelfDirectedRiskReading(built.states[4].self_directed_risk).assessed_turn_id, "T5-user");
});

test("after a lowering to absent the highest reading's turn is kept for ten planned turns, the lowering turn included, then stops; the first reading's turn stays", () => {
  assert.equal(SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS, 10);
  // Turn 2 is the reading; turns 3 and 4 are two quiet turns, so the level goes to absent while turn 4 is merged.
  const built = runCase([reading("absent"), reading("ideation", { route: INQUIRY }), ...Array.from({ length: 16 }, () => reading("absent"))]);
  const loweredAt = levelsOf(built.states).indexOf("absent") + 1;
  assert.equal(loweredAt, 4);
  assert.equal(built.states[loweredAt - 1].self_directed_risk.current.lowered_at_planned_turn, 4, "the record notes how many planned turns the case had when it went to absent");
  // The highest reading's own window is what it was: its turn is held to the tenth planned turn after the lowering turn and then dropped.
  const highest = built.states.map((state) => selfDirectedRiskRetrievalTurn(state));
  assert.deepEqual(highest.slice(0, 3), [null, null, "T2-user"], "turn 1 has no record; turn 3 holds the reading at ideation");
  for (let number = 3; number <= loweredAt + SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS; number += 1) assert.equal(highest[number - 1], "T2-user", `turn ${number}`);
  assert.equal(loweredAt + SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS, 14);
  for (let number = loweredAt + SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS + 1; number <= 18; number += 1) assert.equal(highest[number - 1], null, `turn ${number} is past the window`);
  // Here the one reading is also the first reading above absent, so its turn is still asked for after that window, once, for the rest of the case.
  const holds = built.states.map((_state, index) => riskTurns(replyCheckContextAt(built, index + 1)));
  assert.deepEqual(holds.slice(0, 3), [[], [], ["T2-user"]], "turn 1 has no record; turn 3 holds the reading at ideation");
  for (let number = 3; number <= 18; number += 1) assert.deepEqual(holds[number - 1], ["T2-user"], `turn ${number}`);
  // The producers' context never carries it, inside the window or out.
  for (let number = 1; number <= 18; number += 1) assert.equal(recordRequest(replyCheckContextAt(built, number, { forReplyCheck: false })), null);
});

test("the retrieval turn is null without a record, without the lowering marker at absent, and past the window", () => {
  assert.equal(selfDirectedRiskRetrievalTurn(null), null);
  assert.equal(selfDirectedRiskRetrievalTurn({}), null);
  const built = runCase([reading("ideation"), reading("absent"), reading("absent")], { pending: false });
  const lowered = built.caseState;
  assert.equal(selfDirectedRiskRetrievalTurn(lowered), "T1-user");
  const withoutMarker = structuredClone(lowered);
  delete withoutMarker.self_directed_risk.current.lowered_at_planned_turn;
  assert.equal(selfDirectedRiskRetrievalTurn(withoutMarker), null, "a record at absent with no marker retrieves nothing");
  const later = structuredClone(lowered);
  later.intervention_history = [...later.intervention_history, ...Array.from({ length: SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS }, (_unused, index) => ({ ...lowered.intervention_history[0], id: `extra-${index}` }))];
  assert.equal(selfDirectedRiskRetrievalTurn(later), "T1-user", "ten planned turns after the lowering is still inside the window");
  later.intervention_history.push({ ...lowered.intervention_history[0], id: "extra-last" });
  assert.equal(selfDirectedRiskRetrievalTurn(later), null, "the eleventh is past it");
});

// ---- The first reading above absent: kept apart from the history, and retrieved for the reply check for the rest of the case -----------

// The record as the build before this one left it: the same, without the field this change added.
function asOlderBuildWrote(caseState) {
  const copy = structuredClone(caseState);
  delete copy.self_directed_risk.first_reading;
  return copy;
}
// More turns merged into an existing case state, the first of them numbered `from`.
function extendCase(caseState, turns, from) {
  let next = caseState;
  turns.forEach((turn, index) => {
    const number = from + index;
    next = mergeRuntimeSnapshotIntoCaseState(next, snapshotFor(turn), { turnId: `T${number}-user`, recordedAt: at(number), interventionContract: contract(turn.route ?? CALM) });
  });
  return next;
}
const quiet = (count) => Array.from({ length: count }, () => reading("absent"));

test("a later equal reading no longer takes the first statement out of the reply check's view (the shape of arcs A1 and A7)", () => {
  // The first statement is turn 6 and the person says it again on turn 7; the route changes after that, so both leave the window.
  const built = runCase([...calmFive, reading("intent", { route: INQUIRY }), reading("intent", { route: INQUIRY }), ...quiet(3)]);
  const record = built.caseState.self_directed_risk;
  assert.deepEqual(record.first_reading, { level: "intent", context: "unknown", assessed_turn_id: "T6-user", assessed_at: at(6) });
  assert.equal(highestSelfDirectedRiskReading(record).assessed_turn_id, "T7-user", "the highest reading is still the later of two equal ones");
  assert.equal(selfDirectedRiskRetrievalTurn(built.caseState), "T7-user", "and the highest reading's own retrieval is unchanged");
  assert.deepEqual(selfDirectedRiskRetrievalTurns(built.caseState), ["T7-user", "T6-user"]);
  for (const number of [8, 9, 10]) {
    const context = replyCheckContextAt(built, number);
    assert.equal(context.recent_verbatim_window.turns.some((turn) => ["T6-user", "T7-user"].includes(turn.id)), false, `turns 6 and 7 are outside the window on turn ${number}`);
    assert.deepEqual(riskTurns(context), ["T7-user", "T6-user"], `turn ${number}`);
    assert.deepEqual(context.targeted_older_evidence.map((item) => item.turn.text), ["Synthetic user message 7.", "Synthetic user message 6."], `turn ${number}: the exact words of both`);
    assert.deepEqual(decisionRelevantProjection(context).retrieval_item_ids, [SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID], "two turns share one item ID, which is listed once");
    assert.deepEqual(riskTurns(replyCheckContextAt(built, number, { forReplyCheck: false })), [], "the producers' context asks for neither");
  }
  // The other shape: the route changes between the two, so the later equal reading is inside the window and only the first statement is outside it.
  const split = runCase([...calmFive, reading("intent", { route: INQUIRY }), reading("intent", { route: ADULT_SEAT }), reading("intent", { route: ADULT_SEAT })]);
  const splitContext = replyCheckContextAt(split, 8);
  assert.deepEqual(splitContext.recent_verbatim_window.turns.map((turn) => turn.id), ["T7-user", "T7-assistant", "T8-user"]);
  assert.equal(selfDirectedRiskRetrievalTurn(split.states[7]), "T8-user", "the highest reading is the latest of three equal ones, and it is in the window");
  assert.deepEqual(riskTurns(splitContext), ["T6-user"], "the first statement is retrieved; before this change nothing was");
  assert.equal(splitContext.targeted_older_evidence[0].turn.text, "Synthetic user message 6.");
});

test("when the first reading is also the highest one, its turn is retrieved once, not twice", () => {
  // Intent on turn 2, then ideation twice lowers the held level to ideation, but the intent statement stays the highest reading.
  const built = runCase([reading("absent"), reading("intent", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), ...quiet(2)]);
  const state = built.states[4];
  assert.equal(state.self_directed_risk.current.level, "ideation");
  assert.equal(firstSelfDirectedRiskReading(state.self_directed_risk).assessed_turn_id, "T2-user");
  assert.equal(highestSelfDirectedRiskReading(state.self_directed_risk).assessed_turn_id, "T2-user");
  assert.deepEqual(selfDirectedRiskRetrievalTurns(state), ["T2-user"]);
  const context = replyCheckContextAt(built, 5);
  assert.equal(context.recent_verbatim_window.turns.some((turn) => turn.id === "T2-user"), false);
  assert.deepEqual(riskTurns(context), ["T2-user"]);
  assert.deepEqual(context.targeted_older_evidence.map((item) => [item.turn_id, item.reasons, item.item_ids]), [["T2-user", [SELF_DIRECTED_RISK_RETRIEVAL_REASON], [SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID]]], "one entry, with the same label it has always had");
  // A record of one reading is the same case, and never asks for more than two turns whatever its history holds.
  const single = runCase([reading("ideation", { route: INQUIRY }), ...quiet(2)]);
  assert.deepEqual(selfDirectedRiskRetrievalTurns(single.states[2]), ["T1-user"]);
  for (const state of [...built.states, ...single.states]) assert.ok(selfDirectedRiskRetrievalTurns(state).length <= 2);
});

test("25 and 55 planned turns after a lowering to absent the first statement's turn is still retrieved, while the highest reading's window ends after ten (the shape of arc A8)", () => {
  // A8: the statement on turn 3, two quiet turns lower the level to absent, and the person refers back at turns 30 and 60.
  const shapes = {
    "one reading": { turns: [...quiet(2), reading("ideation", { route: INQUIRY }), ...quiet(57)], highest: "T3-user", lowered: 5 },
    "a later equal reading": { turns: [...quiet(2), reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), ...quiet(56)], highest: "T4-user", lowered: 6 }
  };
  for (const [name, { turns, highest, lowered }] of Object.entries(shapes)) {
    const first = "T3-user";
    const built = runCase(turns);
    assert.equal(turns.length, 60, name);
    assert.equal(built.states[lowered - 1].self_directed_risk.current.level, "absent", `${name}: lowered to absent on turn ${lowered}`);
    assert.notEqual(built.states[lowered - 2].self_directed_risk.current.level, "absent", name);
    assert.equal(built.states[lowered - 1].self_directed_risk.current.lowered_at_planned_turn, lowered, name);
    // The highest reading's window is what it was: held through the tenth planned turn after the lowering, gone from the eleventh.
    const windowEnd = lowered + SELF_DIRECTED_RISK_KEEP_AFTER_LOWERING_TURNS;
    for (const number of [lowered, windowEnd]) assert.equal(selfDirectedRiskRetrievalTurn(built.states[number - 1]), highest, `${name}: turn ${number}`);
    for (const number of [windowEnd + 1, 30, 60]) assert.equal(selfDirectedRiskRetrievalTurn(built.states[number - 1]), null, `${name}: turn ${number}`);
    // What the reply check receives: both turns while that window lasts (one turn when they are the same), the first statement alone after it.
    assert.deepEqual(riskTurns(replyCheckContextAt(built, windowEnd)), [...new Set([highest, first])], name);
    assert.deepEqual(riskTurns(replyCheckContextAt(built, windowEnd + 1)), [first], name);
    for (const number of [30, 60]) {
      const context = replyCheckContextAt(built, number);
      assert.equal(context.recent_verbatim_window.turns.some((turn) => turn.id === first), false, `${name}: turn 3 is outside the window on turn ${number}`);
      assert.deepEqual(riskTurns(context), [first], `${name}: turn ${number}, ${number - lowered} planned turns after the lowering`);
      assert.equal(context.targeted_older_evidence.find((item) => item.turn_id === first).turn.text, "Synthetic user message 3.", `${name}: turn ${number}`);
      assert.deepEqual(riskTurns(replyCheckContextAt(built, number, { forReplyCheck: false })), [], `${name}: the producers' context asks for nothing`);
    }
    // A case in flight when this change is deployed: its record has no first_reading, but its history still holds the first reading.
    assert.deepEqual(selfDirectedRiskRetrievalTurns(asOlderBuildWrote(built.caseState)), [first], name);
  }
});

test("a record written by the build before this one, without first_reading, validates and works", () => {
  const turns = [...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("unknown"), ...quiet(3)];
  const built = runCase(turns);
  const older = asOlderBuildWrote(built.caseState);
  assert.equal(Object.hasOwn(older.self_directed_risk, "first_reading"), false);
  assert.doesNotThrow(() => validateCaseState(older));
  assert.equal(older.self_directed_risk.version, 1, "no record version bump: the field is optional, as risk_readings_dropped_from_history is");
  assert.equal(selfDirectedRiskRetrievalTurn(older), selfDirectedRiskRetrievalTurn(built.caseState), "the highest reading's retrieval is as it was");
  // The history still holds the first reading, so it is taken from there ...
  assert.deepEqual(firstSelfDirectedRiskReading(older.self_directed_risk), built.caseState.self_directed_risk.first_reading);
  assert.deepEqual(selfDirectedRiskRetrievalTurns(older), selfDirectedRiskRetrievalTurns(built.caseState));
  // ... and the next turn this build merges stores it, so the record ends up exactly as if this build had written it from the start.
  const resumed = extendCase(asOlderBuildWrote(built.states[6]), turns.slice(7), 8);
  assert.deepEqual(resumed.self_directed_risk, built.caseState.self_directed_risk);
  assert.doesNotThrow(() => validateCaseState(resumed));

  // Where the history has already lost the first reading, it is unknown: nothing is invented, and retrieval is what it was.
  const rolled = runCase([...Array.from({ length: 25 }, () => reading("imminent", { route: SAFETY })), reading("absent")]);
  const olderRolled = asOlderBuildWrote(rolled.caseState);
  assert.ok(olderRolled.self_directed_risk.risk_readings_dropped_from_history > 0);
  assert.doesNotThrow(() => validateCaseState(olderRolled));
  assert.equal(firstSelfDirectedRiskReading(olderRolled.self_directed_risk), null);
  assert.equal(selfDirectedRiskRetrievalTurn(olderRolled), "T25-user");
  assert.deepEqual(selfDirectedRiskRetrievalTurns(olderRolled), ["T25-user"], "the highest reading's turn alone, as before");
  const resumedRolled = extendCase(olderRolled, quiet(2), 27);
  assert.equal(Object.hasOwn(resumedRolled.self_directed_risk, "first_reading"), false, "a first reading that cannot be recovered is never guessed");
  assert.equal(resumedRolled.self_directed_risk.current.level, "absent");
  assert.doesNotThrow(() => validateCaseState(resumedRolled));
  assert.deepEqual(selfDirectedRiskRetrievalTurns(resumedRolled), ["T25-user"], "inside the highest reading's ten-turn window after the lowering, and nothing more");
});

test("more than 20 history events still keep the first reading, and it is retrieved after the history has lost it", () => {
  // Intent on turn 1, ideation on turns 2 to 31, then quiet turns from turn 32 on the calm route. The history keeps 20 events.
  const built = runCase([reading("intent", { route: INQUIRY }), ...Array.from({ length: 30 }, () => reading("ideation", { route: INQUIRY })), ...quiet(19)]);
  const record = built.states[30].self_directed_risk;
  assert.equal(record.history.length, SELF_DIRECTED_RISK_HISTORY_LIMIT);
  assert.notEqual(record.history[0].assessed_turn_id, "T1-user", "the first reading's own event has left the history");
  assert.ok(record.risk_readings_dropped_from_history > 0);
  assert.deepEqual(record.first_reading, { level: "intent", context: "unknown", assessed_turn_id: "T1-user", assessed_at: at(1) });
  assert.equal(highestSelfDirectedRiskReading(record).reading, "ideation", "the history's highest reading is lower than the first statement now");
  for (const state of built.states) assert.equal(state.self_directed_risk.first_reading.assessed_turn_id, "T1-user");
  assert.doesNotThrow(() => validateCaseState(built.caseState));
  assert.deepEqual(selfDirectedRiskRetrievalTurns(built.states[31]), ["T31-user", "T1-user"]);
  // Turn 50 is 17 planned turns after the lowering to absent (turn 33): the highest reading's window is over, the first statement is not.
  assert.equal(built.states[32].self_directed_risk.current.lowered_at_planned_turn, 33);
  assert.equal(selfDirectedRiskRetrievalTurn(built.states[49]), null);
  const context = replyCheckContextAt(built, 50);
  assert.deepEqual(riskTurns(context), ["T1-user"]);
  assert.equal(context.targeted_older_evidence.find((item) => item.turn_id === "T1-user").turn.text, "Synthetic user message 1.");
});

test("the first reading is set once: later raises, lowerings and re-raises never move it", () => {
  const sequence = ["ideation", "intent", "absent", "absent", "ideation", "imminent", "ideation", "ideation", "absent", "absent"];
  const built = runCase(sequence.map((value) => reading(value, value === "absent" ? {} : { context: "other_or_unclear" })));
  assert.deepEqual(levelsOf(built.states), ["ideation", "intent", "intent", "absent", "ideation", "imminent", "imminent", "ideation", "ideation", "absent"], "raised, lowered to absent, raised again, lowered again");
  const expected = { level: "ideation", context: "other_or_unclear", assessed_turn_id: "T1-user", assessed_at: at(1) };
  built.states.forEach((state, index) => assert.deepEqual(state.self_directed_risk.first_reading, expected, `after turn ${index + 1}`));
  assert.notEqual(built.caseState.self_directed_risk.current.assessed_turn_id, "T1-user", "the record's own anchor moved on; the first reading did not");
});

test("a malformed first reading is rejected, and a record with a good one or none is accepted", () => {
  const { caseState } = runCase([reading("ideation", { context: "pain_episode" })]);
  const mutate = (change) => { const copy = structuredClone(caseState); change(copy.self_directed_risk); return copy; };
  assert.deepEqual(caseState.self_directed_risk.first_reading, { level: "ideation", context: "pain_episode", assessed_turn_id: "T1-user", assessed_at: at(1) });
  for (const bad of [
    mutate((record) => { record.first_reading = null; }),
    mutate((record) => { record.first_reading = []; }),
    mutate((record) => { record.first_reading = "T1-user"; }),
    mutate((record) => { record.first_reading.level = "absent"; }),
    mutate((record) => { record.first_reading.level = "severe"; }),
    mutate((record) => { record.first_reading.context = "elsewhere"; }),
    mutate((record) => { delete record.first_reading.assessed_turn_id; }),
    mutate((record) => { record.first_reading.assessed_turn_id = " "; }),
    mutate((record) => { record.first_reading.assessed_turn_id = "x".repeat(161); }),
    mutate((record) => { record.first_reading.assessed_at = ""; })
  ]) assert.throws(() => validateCaseState(bad), /self_directed_risk\.first_reading/u);
  assert.doesNotThrow(() => validateCaseState(caseState));
  assert.doesNotThrow(() => validateCaseState(mutate((record) => { delete record.first_reading; })));
  assert.equal(caseState.self_directed_risk.version, 1);
});

test("the first-reading helpers never throw, whatever record they are given", () => {
  for (const value of [undefined, null, {}, [], "text", 5, { history: "x" }, { history: [null] }, { history: [{}] }, { history: [{ change: "raised" }] }, { first_reading: null }, { first_reading: {} }, { first_reading: { assessed_turn_id: " " } }, { current: null }]) {
    assert.doesNotThrow(() => firstSelfDirectedRiskReading(value));
    assert.doesNotThrow(() => selfDirectedRiskRetrievalTurns({ self_directed_risk: value }));
    assert.equal(firstSelfDirectedRiskReading(value), null);
    assert.deepEqual(selfDirectedRiskRetrievalTurns({ self_directed_risk: value }), []);
  }
  assert.deepEqual(selfDirectedRiskRetrievalTurns(null), []);
  assert.deepEqual(selfDirectedRiskRetrievalTurns({}), []);
  assert.deepEqual(selfDirectedRiskRetrievalTurns(undefined), []);
});

test("the decision-relevant projection carries the record", () => {
  const { caseState, transcript } = runCase([reading("absent"), reading("intent", { context: "other_or_unclear" })], { pending: false });
  const projected = decisionRelevantProjection(buildDurableCaseContext({ caseState, transcriptEntries: transcript })).self_directed_risk;
  assert.deepEqual(projected, { level: "intent", context: "other_or_unclear", assessed_turn_id: "T2-user", latest_turn_id: "T2-user", denied: false, unknown: false, observation_ids: ["obs:T2-user:O1"] });
  assert.equal(decisionRelevantProjection(buildDurableCaseContext({ caseState: runCase([reading("absent")]).caseState })).self_directed_risk, null);
});

// Each row is the sequence of extraction readings on one route and the held level after each turn.
const LOWERING_TABLE = [
  ["a single quiet turn does not lower it", ["ideation", "absent"], ["ideation", "ideation"]],
  ["two quiet turns in a row lower it", ["ideation", "absent", "absent"], ["ideation", "ideation", "absent"]],
  ["a repeat of the level cancels a run of quiet turns", ["ideation", "absent", "ideation", "absent"], ["ideation", "ideation", "ideation", "ideation"]],
  ["an unknown reading breaks the run", ["ideation", "absent", "unknown", "absent"], ["ideation", "ideation", "ideation", "ideation"]],
  ["after an unknown reading two more quiet turns lower it", ["ideation", "absent", "unknown", "absent", "absent"], ["ideation", "ideation", "ideation", "ideation", "absent"]],
  ["a missing extraction is treated as unknown", ["ideation", "absent", "missing", "absent"], ["ideation", "ideation", "ideation", "ideation"]],
  ["a higher reading raises it at once", ["ideation", "intent", "imminent"], ["ideation", "intent", "imminent"]],
  ["a lower reading below the held level only counts toward lowering", ["intent", "ideation"], ["intent", "intent"]],
  ["two lower readings lower it to the highest of them", ["intent", "ideation", "absent"], ["intent", "intent", "ideation"]],
  ["two lower non-absent readings lower it to the later highest", ["imminent", "ideation", "ideation"], ["imminent", "imminent", "ideation"]],
  ["a raise after a lowering starts a new record turn", ["ideation", "absent", "absent", "intent"], ["ideation", "ideation", "absent", "intent"]],
  ["quiet turns before any reading create nothing", ["absent", "absent", "absent"], [null, null, null]]
];

for (const [name, sequence, expected] of LOWERING_TABLE) {
  test(`lowering rule: ${name}`, () => {
    const { states } = runCase(sequence.map((value) => (value === "missing" ? reading("unknown", { missing: true }) : reading(value))));
    assert.deepEqual(levelsOf(states), expected);
  });
}

test("the lowering rule moves the evidence turn only when the level is raised or lowered", () => {
  const { states } = runCase(["intent", "ideation", "absent", "ideation"].map((value) => reading(value)));
  const anchors = states.map((state) => state.self_directed_risk.current.assessed_turn_id);
  assert.deepEqual(anchors, ["T1-user", "T1-user", "T2-user", "T2-user"], "intent at 1, then lowered to the ideation reading made at turn 2");
  assert.equal(SELF_DIRECTED_RISK_LOWERING_READINGS, 2);
});

test("a reading at or above the held level cancels a run of lower readings", () => {
  const { states } = runCase(["intent", "ideation", "intent", "ideation", "absent"].map((value) => reading(value)));
  assert.deepEqual(levelsOf(states), ["intent", "intent", "intent", "intent", "ideation"], "ideation then absent are two lower readings in a row");
  assert.deepEqual(states[2].self_directed_risk.current.lowering_readings, [], "the repeat of intent restarted the run");
});

test("history stays bounded and the record validates after many readings", () => {
  const sequence = Array.from({ length: 40 }, (_, index) => reading(["ideation", "intent", "ideation", "absent", "absent"][index % 5]));
  const { caseState } = runCase(sequence);
  assert.ok(caseState.self_directed_risk.history.length <= SELF_DIRECTED_RISK_HISTORY_LIMIT);
  assert.equal(caseState.self_directed_risk.history.length, SELF_DIRECTED_RISK_HISTORY_LIMIT);
  validateCaseState(caseState);
});

test("a malformed record is rejected by case-state validation", () => {
  const { caseState } = runCase([reading("ideation")]);
  const mutate = (change) => { const copy = structuredClone(caseState); change(copy.self_directed_risk); return copy; };
  for (const bad of [
    mutate((record) => { record.current.level = "severe"; }),
    mutate((record) => { record.current.context = "elsewhere"; }),
    mutate((record) => { record.current.denied = true; record.current.unknown = true; }),
    mutate((record) => { record.current.observation_ids = Array.from({ length: 17 }, (_, index) => `obs:${index}`); }),
    mutate((record) => { record.current.lowering_readings = [1, 2, 3].map((number) => ({ turn_id: `T${number}`, at: at(number), state: "absent", context: "unknown", observation_ids: [] })); }),
    mutate((record) => { record.history = Array.from({ length: SELF_DIRECTED_RISK_HISTORY_LIMIT + 1 }, () => structuredClone(record.history[0])); }),
    mutate((record) => { record.history[0].change = "deleted"; }),
    mutate((record) => { record.version = 2; }),
    mutate((record) => { record.risk_readings_dropped_from_history = -1; }),
    mutate((record) => { record.risk_readings_dropped_from_history = 1.5; }),
    mutate((record) => { record.risk_readings_dropped_from_history = "5"; }),
    mutate((record) => { record.current.lowered_at_planned_turn = -1; }),
    mutate((record) => { record.current.lowered_at_planned_turn = "4"; })
  ]) assert.throws(() => validateCaseState(bad), /self_directed_risk/u);
  for (const good of [
    mutate((record) => { record.risk_readings_dropped_from_history = 0; }),
    mutate((record) => { record.risk_readings_dropped_from_history = 12; }),
    mutate((record) => { record.current.lowered_at_planned_turn = 0; })
  ]) assert.doesNotThrow(() => validateCaseState(good));
  assert.doesNotThrow(() => validateCaseState({ ...caseState, self_directed_risk: null }));
  assert.equal(caseState.schema_version, 1, "an optional section, so the case-state schema version is unchanged");
});

test("patches keep the record, and a state saved before the record existed stays valid and unchanged", () => {
  const withRecord = runCase([reading("ideation")], { pending: false }).caseState;
  assert.deepEqual(applyCaseStatePatch(withRecord, { retrieval_hints: ["synthetic hint"] }).self_directed_risk, withRecord.self_directed_risk);
  const older = createEmptyCaseState({ caseId: "synthetic-older-case" });
  assert.equal(Object.hasOwn(older, "self_directed_risk"), false);
  assert.equal(Object.hasOwn(applyCaseStatePatch(older, { retrieval_hints: ["synthetic hint"] }), "self_directed_risk"), false);
  assert.equal(diffCaseStates(older, applyCaseStatePatch(older, {})).current_episode_changed, false);
});

test("the record stays out of the inspection projection, producer prompts and client responses", () => {
  const { caseState } = runCase([reading("absent"), reading("ideation", { context: "pain_episode" })], { pending: false });
  assert.ok(caseState.self_directed_risk);
  const inspection = JSON.stringify(projectCaseStateForInspection(caseState));
  assert.equal(inspection.includes("self_directed_risk"), false);
  assert.equal(inspection.includes("selfDirectedRisk"), false);
  assert.equal(Object.hasOwn(projectCaseStateForInspection(caseState), "selfDirectedRisk"), false);

  assert.equal(Object.hasOwn(promptCaseState(caseState), "self_directed_risk"), false);
  assert.equal(Object.hasOwn(caseState, "self_directed_risk"), true, "promptCaseState does not mutate the stored state");
  const block = durableCaseContextBlock({ durableCaseState: caseState, targetedRetrievalRequests: [], targetedOlderEvidence: [] });
  assert.equal(block.includes("self_directed_risk"), false);
  assert.equal(block.includes("lowering_readings"), false);
  const repair = privateRuntimeRepairPrompt({ case_state: caseState, candidate_response: "Synthetic." });
  assert.equal(repair.user.includes("self_directed_risk"), false);
  const audit = privateRuntimeAuditPrompt({ case_state: caseState, candidate_response: "Synthetic." });
  assert.equal(audit.user.includes("self_directed_risk"), false, "the audit reads the record through its digest, not through a second copy in case_state");

  const forClient = caseStateForClient(caseState);
  assert.equal(Object.hasOwn(forClient, "self_directed_risk"), false);
  assert.equal(forClient.case_id, caseState.case_id);
  assert.equal(caseStateForClient(createEmptyCaseState({ caseId: "synthetic-plain" })).case_id, "synthetic-plain");
  assert.equal(caseStateForClient(null), null);
});

test("the producers' prompts are byte-identical with and without the record, in the window and after a route change", () => {
  // The second case is the one that matters: the record's turn is outside the window there, so a retrieval request would show.
  const cases = [
    runCase([reading("absent"), reading("ideation")], { pending: false }),
    runCase([...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("unknown")])
  ];
  for (const { caseState, transcript } of cases) {
    const withoutRecord = structuredClone(caseState);
    delete withoutRecord.self_directed_risk;
    const contextFor = (state) => {
      const durable = buildDurableCaseContext({ caseState: state, transcriptEntries: transcript });
      return { durableCaseState: durable.case_state, currentTherapeuticEpisode: durable.current_episode, targetedRetrievalRequests: durable.targeted_retrieval_requests, targetedOlderEvidence: durable.targeted_older_evidence };
    };
    const block = durableCaseContextBlock(contextFor(caseState));
    assert.equal(block, durableCaseContextBlock(contextFor(withoutRecord)));
    assert.equal(block.includes(SELF_DIRECTED_RISK_RETRIEVAL_REASON), false);
    assert.equal(block.includes(SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID), false);
  }
  // Built for the reply check, the same state does show the request, so the equality above is not vacuous.
  const { caseState, transcript } = cases[1];
  const durable = buildDurableCaseContext({ caseState, transcriptEntries: transcript, forReplyCheck: true });
  const shown = durableCaseContextBlock({ durableCaseState: durable.case_state, currentTherapeuticEpisode: durable.current_episode, targetedRetrievalRequests: durable.targeted_retrieval_requests, targetedOlderEvidence: durable.targeted_older_evidence });
  assert.equal(shown.includes(SELF_DIRECTED_RISK_RETRIEVAL_REASON), true);
});

test("the trajectory digest after a route change reports the earlier turns the verbatim window no longer holds", () => {
  const turns = [...calmFive, reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY }), reading("absent"), reading("unknown")];
  const digest = buildTrajectoryDigest(auditContext(runCase(turns)));
  assert.equal(digest.computed_in_code, true);
  assert.equal(digest.model_calls, 0);
  assert.deepEqual(digest.whole_case, { user_turn_count: 9, planned_turn_count: 9, user_turns_in_verbatim_window: 2, user_turns_outside_verbatim_window: 7 });
  assert.equal(digest.current_episode.started_turn_number, 8);
  assert.equal(digest.current_episode.started_by, "route_change");
  assert.equal(digest.current_episode.previous_selected_route, INQUIRY);
  assert.deepEqual(digest.route_sequence, {
    runs: [{ route: CALM, from_turn: 1, to_turn: 5, turns: 5 }, { route: INQUIRY, from_turn: 6, to_turn: 7, turns: 2 }, { route: CALM, from_turn: 8, to_turn: 9, turns: 2 }],
    earlier_runs_omitted: 0
  });
  assert.equal(digest.suicide_family.earlier_user_turns_outside_verbatim_window, 2);
  assert.deepEqual(digest.suicide_family.turn_numbers, [6, 7]);
  assert.equal(digest.suicide_family.with_exact_text_in_targeted_older_evidence, 2, "the turns of the record's highest reading (7) and of its first reading (6) are both retrieved");
  assert.equal(digest.suicide_family.without_exact_text_in_this_packet, 0);
  assert.deepEqual([digest.suicide_family.risk_readings_dropped_from_record_history, digest.suicide_family.counts_are_a_lower_bound], [0, false], "nothing has left the record's history");
  assert.deepEqual(digest.self_directed_risk.highest_reading_in_history, { reading: "ideation", turn_id: "T7-user", turn_number: 7 });
  assert.equal(digest.self_directed_risk.level, "ideation");
  assert.equal(digest.self_directed_risk.assessed_turn_number, 6);
  assert.equal(digest.self_directed_risk.latest_reading_unknown, true);
  assert.deepEqual(digest.self_directed_risk.history.map((entry) => [entry.change, entry.turn_number]), [["raised", 6], ["held", 7]]);
});

test("the digest is also correct at the start of a case and when the family turns are still in the window", () => {
  const start = buildTrajectoryDigest(auditContext(runCase([reading("absent"), reading("absent")])));
  assert.equal(start.current_episode.started_by, "case_start");
  assert.equal(start.current_episode.previous_selected_route, null);
  assert.equal(start.suicide_family.earlier_user_turns_outside_verbatim_window, 0);
  assert.equal(start.self_directed_risk, null);

  const inWindow = buildTrajectoryDigest(auditContext(runCase([reading("absent"), reading("ideation", { route: INQUIRY }), reading("ideation", { route: INQUIRY })])));
  assert.equal(inWindow.suicide_family.earlier_user_turns_outside_verbatim_window, 0, "turns inside the window are in the packet already");
  assert.equal(inWindow.current_episode.started_turn_number, 2);
});

test("the safety-orientation route counts as self-directed risk only where the record shows a reading on that turn", () => {
  const turns = [reading("absent"), reading("imminent", { route: SAFETY }), reading("absent", { route: SAFETY }), reading("absent", { route: SAFETY }), reading("absent")];
  const digest = buildTrajectoryDigest(auditContext(runCase(turns)));
  assert.equal(digest.suicide_family.earlier_user_turns_outside_verbatim_window, 1);
  assert.deepEqual(digest.suicide_family.turn_numbers, [2]);
  assert.equal(digest.suicide_family.safety_orientation_turns_without_a_risk_reading_still_in_the_records_history, 2, "turns 3 and 4 chose the same route with no reading above absent in the record's history");
  assert.equal(Object.hasOwn(digest.suicide_family, "safety_orientation_turns_without_a_risk_reading"), false, "the old, unqualified name is gone");
  for (const route of SUICIDE_FAMILY_ROUTE_IDS) assert.ok(digest.suicide_family.counted.includes(route), route);
  assert.deepEqual([...SUICIDE_FAMILY_ROUTE_IDS], ["IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.PRECIOUS_HUMAN_OPPORTUNITY", "IC.SUICIDAL_ADULT_SEAT"]);
  assert.equal(SAFETY_ORIENTATION_ROUTE_ID, SAFETY);
});

test("the adult-seat route is counted as a suicide-family route from the route history, past the record's 20-entry history", () => {
  const turns = [reading("absent"), ...Array.from({ length: 25 }, () => reading("ideation", { route: ADULT_SEAT })), reading("absent")];
  const digest = buildTrajectoryDigest(auditContext(runCase(turns)));
  assert.ok(digest.suicide_family.counted.includes(ADULT_SEAT));
  assert.equal(digest.suicide_family.earlier_user_turns_outside_verbatim_window, 25, "all 25, not the 20 the record's history still holds");
  assert.deepEqual(digest.suicide_family.turn_numbers, Array.from({ length: 20 }, (_unused, index) => index + 7), "the listing is bounded to the latest 20");
  assert.equal(digest.suicide_family.risk_readings_dropped_from_record_history, 5);
  assert.equal(digest.suicide_family.counts_are_a_lower_bound, true, "flagged whenever any reading left the history, even where the route count is exact");
  assert.equal(digest.suicide_family.safety_orientation_turns_without_a_risk_reading_still_in_the_records_history, 0);
});

test("25 readings followed by a calm turn: the record counts what left its history and the digest says its counts are a lower bound", () => {
  const turns = [...Array.from({ length: 25 }, () => reading("imminent", { route: SAFETY })), reading("absent")];
  const built = runCase(turns);
  const record = built.caseState.self_directed_risk;
  assert.equal(record.history.length, SELF_DIRECTED_RISK_HISTORY_LIMIT);
  assert.equal(record.risk_readings_dropped_from_history, 5, "25 events, 20 kept: five readings above absent left the history");
  assert.equal(record.current.assessed_turn_id, "T1-user", "the record still points at the first reading, which is no longer in its history");
  validateCaseState(built.caseState);

  const digest = buildTrajectoryDigest(auditContext(built));
  assert.equal(digest.whole_case.user_turn_count, 26);
  assert.equal(digest.suicide_family.risk_readings_dropped_from_record_history, 5);
  assert.equal(digest.suicide_family.counts_are_a_lower_bound, true);
  assert.equal(digest.suicide_family.earlier_user_turns_outside_verbatim_window, 21, "the 20 turns in the history and the turn the record currently holds");
  assert.deepEqual(digest.suicide_family.turn_numbers, Array.from({ length: 20 }, (_unused, index) => index + 6), "the listing is the latest 20 of the 21, so turn 1 is counted but not listed");
  assert.equal(digest.suicide_family.safety_orientation_turns_without_a_risk_reading_still_in_the_records_history, 4, "turns 2 to 5 had a reading too, but it is no longer in the record's history; the name says so and the flag says the count is low");
  assert.equal(digest.self_directed_risk.history.length, SELF_DIRECTED_RISK_HISTORY_LIMIT);

  // Nothing dropped, nothing flagged; and a record that has not rolled over does not carry the field at all.
  const short = runCase([reading("imminent", { route: SAFETY }), reading("absent")]);
  assert.equal(Object.hasOwn(short.caseState.self_directed_risk, "risk_readings_dropped_from_history"), false);
  const shortDigest = buildTrajectoryDigest(auditContext(short));
  assert.deepEqual([shortDigest.suicide_family.risk_readings_dropped_from_record_history, shortDigest.suicide_family.counts_are_a_lower_bound], [0, false]);
});

test("only readings above absent are counted when they leave the history", () => {
  // Events: turn 1 raised (ideation), turn 3 lowered (reads absent), turn 4 raised again, turns 5 to 24 held. 23 events, 20 kept.
  const built = runCase([reading("ideation"), reading("absent"), reading("absent"), ...Array.from({ length: 21 }, () => reading("ideation"))]);
  const record = built.caseState.self_directed_risk;
  assert.equal(record.history.length, SELF_DIRECTED_RISK_HISTORY_LIMIT);
  assert.deepEqual(record.history.map((entry) => entry.change), Array.from({ length: 20 }, () => "held"), "the three oldest events, raised, lowered and raised, left the front");
  assert.equal(record.risk_readings_dropped_from_history, 2, "the two ideation readings count; the lowering event read absent and does not");
  validateCaseState(built.caseState);
  // The count carries across later turns that add no event.
  const later = runCase([reading("ideation"), reading("absent"), reading("absent"), ...Array.from({ length: 21 }, () => reading("ideation")), reading("unknown")]);
  assert.equal(later.caseState.self_directed_risk.risk_readings_dropped_from_history, 2);
});

test("the digest tolerates partial context, is deterministic and keeps the route sequence bounded", () => {
  for (const partial of [undefined, null, {}, { case_state: null }, { case_state: { schema_version: 2, marker: "partial" } }, { case_state: { intervention_history: [{}, null] } }]) {
    assert.doesNotThrow(() => buildTrajectoryDigest(partial));
  }
  assert.equal(buildTrajectoryDigest({ case_state: { schema_version: 2 } }).whole_case.user_turn_count, null);
  const alternating = Array.from({ length: 70 }, (_, index) => reading("absent", { route: index % 2 ? "IC.ROUTE_B" : "IC.ROUTE_A" }));
  const context = auditContext(runCase(alternating));
  const first = buildTrajectoryDigest(context);
  assert.deepEqual(first, buildTrajectoryDigest(structuredClone({ ...context, durable: undefined })));
  assert.equal(first.route_sequence.runs.length, 30);
  assert.equal(first.route_sequence.earlier_runs_omitted, 40);
  assert.ok(JSON.stringify(first).length < 12_000, "small and bounded");
  assert.equal(routeOfHistoryItem({ statement: "Selected IC.SOME_ROUTE: A title: with a colon." }), "IC.SOME_ROUTE");
  assert.equal(routeOfHistoryItem({ statement: "No route here." }), null);
});

// Owner decision D1 (2026-09-26) and routing: this change adds a record and a check, not a routing input. The rows below are the
// planner's route, execution contract, trace, tier and immediate-protection result for every suicidal_state and ideation context over
// three base variable sets. The same digest was computed on origin/main (cb2008ce6) before this change and matched, so the planner
// and tier selection are unchanged. A future owner-approved graph change that moves these routes has to update this digest with it.
test("planner and routing outputs for every suicidal_state are unchanged (digest of the compiled graph's route decisions)", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const calm = { ...blankCaseVariables(), present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes", suicidal_state: "absent",
    activation: "low", dissociation: "none", altered_state: "sober", inner_adult_access: "partial", witness_capacity: "present", coherent_child_state: "present",
    body_capacity: "adequate", current_intent: "conversation" };
  const bases = { calm, activated: { ...calm, activation: "high", dissociation: "mild" }, unsafe: { ...calm, present_safety: "unsafe" } };
  const rows = [];
  const routes = {};
  for (const [name, base] of Object.entries(bases)) {
    for (const suicidal_state of ["absent", "ideation", "intent", "imminent", "unknown"]) {
      for (const suicidal_ideation_context of ["unknown", "pain_episode", "other_or_unclear", "not_in_play"]) {
        const variables = deriveCaseVariables({ ...base, suicidal_state, suicidal_ideation_context });
        const plan = planFromGraphs({ variables, graphs: bundle.graphs });
        const tier = classifyTherapyTier({ variables }, "auto");
        rows.push({ name, suicidal_state, suicidal_ideation_context, primary: plan.primaryJob.id, required: plan.executionContract?.requiredNodeIds ?? null,
          trace: plan.trace.map((item) => item.id), hasQuestion: Boolean(plan.nextQuestion), tier: tier.tier, reason: tier.reason, immediate: immediateProtectionNeeded(variables) });
        routes[`${name}/${suicidal_state}`] = `${plan.primaryJob.id}|${tier.tier}|${immediateProtectionNeeded(variables)}`;
      }
    }
  }
  assert.equal(rows.length, 60);
  assert.deepEqual(routes, {
    "calm/absent": "IC.BORROW_ONE_FUNCTION|reviewed|false", "calm/ideation": "IC.SUICIDAL_SELF_DEATH_INQUIRY|reviewed|false",
    "calm/intent": "IC.SUICIDAL_SELF_DEATH_INQUIRY|reviewed|false", "calm/imminent": "IC.SAFETY_ORIENTATION|reviewed|true", "calm/unknown": "IC.BORROW_ONE_FUNCTION|reviewed|false",
    "activated/absent": "IC.BORROW_ONE_FUNCTION|reviewed|false", "activated/ideation": "IC.SUICIDAL_SELF_DEATH_INQUIRY|reviewed|false",
    "activated/intent": "IC.SUICIDAL_SELF_DEATH_INQUIRY|reviewed|false", "activated/imminent": "IC.SAFETY_ORIENTATION|reviewed|true", "activated/unknown": "IC.BORROW_ONE_FUNCTION|reviewed|false",
    "unsafe/absent": "IC.SAFETY_ORIENTATION|forensic|true", "unsafe/ideation": "IC.SAFETY_ORIENTATION|forensic|true", "unsafe/intent": "IC.SAFETY_ORIENTATION|forensic|true",
    "unsafe/imminent": "IC.SAFETY_ORIENTATION|forensic|true", "unsafe/unknown": "IC.SAFETY_ORIENTATION|forensic|true"
  });
  assert.equal(createHash("sha256").update(JSON.stringify(rows)).digest("hex"), "bcc1639d8e9e414776b2da99e63824c0ac03bf86b386cd058962907a8030d7f0");
});
