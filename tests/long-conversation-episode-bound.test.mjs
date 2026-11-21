import test from "node:test";
import assert from "node:assert/strict";
import { CASE_STATE_LIMITS, createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState, validateCaseState } from "../src/case-state/longitudinal-state.mjs";
import { openScriptedRiskRuntime } from "./fixtures/scripted-risk-runtime.mjs";

// Six items a turn is a busy ordinary extraction (four observations and two hypotheses). Before this change the current episode's
// list of source item IDs grew with every turn on an unchanged route and passed its limit of 100 on the 17th turn, when the merge
// threw and the turn ended as THERAPY_RUNTIME_UNAVAILABLE. All wording below is a numbered placeholder.
const ROUTE = "IC.CREDIBILITY_REPAIR";
const OTHER_ROUTE = "IC.SOMETHING_ELSE";
const EPISODE_LISTS = ["source_item_ids", "constitutional_aim_ids", "adverse_signs", "stay_conditions", "switch_conditions", "stop_conditions"];
const at = (number) => new Date(Date.UTC(2026, 10, 1, 0, 0, number)).toISOString();
const contract = (route) => ({ primaryJob: { id: route, title: `Synthetic route ${route}` }, nextQuestion: "", selectedNodes: [], variables: {} });

function sixItemSnapshot(number) {
  return {
    variables: { suicidal_state: "absent" },
    direct_observations: Array.from({ length: 4 }, (_unused, index) => ({ id: `O${index + 1}`, statement: `Synthetic observation ${index + 1}.`, evidence: `Synthetic message ${number}.` })),
    hypotheses: Array.from({ length: 2 }, (_unused, index) => ({ id: `H${index + 1}`, claim: `Synthetic hypothesis ${index + 1}.`, evidence: "Synthetic placeholder evidence.", confidence: "low", alternatives: ["Synthetic alternative."] }))
  };
}

function mergeTurn(state, number, route = ROUTE) {
  return mergeRuntimeSnapshotIntoCaseState(state, sixItemSnapshot(number), { turnId: `t${number}-user`, recordedAt: at(number), interventionContract: contract(route) });
}

function mergeTurns(from, to, state = createEmptyCaseState({ caseId: "synthetic-long-case" })) {
  const states = [];
  let current = state;
  for (let number = from; number <= to; number += 1) {
    current = mergeTurn(current, number);
    states.push(current);
  }
  return states;
}

test("sixty turns of six items on one route merge without a throw, and every episode list stays within its limit", () => {
  const states = mergeTurns(1, 60);
  assert.equal(states.length, 60);
  for (const [index, state] of states.entries()) {
    const episode = state.current_episode;
    for (const field of EPISODE_LISTS) assert.ok(episode[field].length <= CASE_STATE_LIMITS.episode_list, `${field} at turn ${index + 1}`);
    assert.equal(episode.id, states[0].current_episode.id, "the route never changed, so the episode is the same one");
    assert.doesNotThrow(() => validateCaseState(structuredClone(state)), `turn ${index + 1}`);
  }
  assert.deepEqual(states.slice(14, 18).map((state) => state.current_episode.source_item_ids.length), [90, 96, 100, 100], "the 17th turn is the one that used to throw");
  const last = states.at(-1);
  assert.equal(last.items.length, 360, "the case-level items are untouched");
  assert.equal(last.current_episode.source_item_ids.length, CASE_STATE_LIMITS.episode_list);
});

test("the episode keeps the most recent item IDs and lets the oldest fall away, in order and without repeats", () => {
  const states = mergeTurns(1, 60);
  const last = states.at(-1);
  const allIds = last.items.map((item) => item.id);
  assert.deepEqual(last.current_episode.source_item_ids, allIds.slice(-CASE_STATE_LIMITS.episode_list));
  assert.equal(new Set(last.current_episode.source_item_ids).size, CASE_STATE_LIMITS.episode_list);
  assert.equal(last.current_episode.source_item_ids.includes(allIds[0]), false, "the very first item is no longer listed");
  assert.equal(last.items.some((item) => item.id === allIds[0]), true, "but it is still a case item");
  const beforeLast = states.at(-2).current_episode.source_item_ids;
  assert.deepEqual(last.current_episode.source_item_ids.slice(0, -6), beforeLast.slice(6), "each turn drops its oldest six and adds its own six");
  // Every id still listed belongs to the last 100 items of the case, so a reader of the list finds only items the case holds.
  const held = new Set(allIds);
  assert.ok(last.current_episode.source_item_ids.every((id) => held.has(id)));
});

test("a route change after a long run starts a fresh list, as it always did", () => {
  const long = mergeTurns(1, 40).at(-1);
  const changed = mergeTurn(long, 41, OTHER_ROUTE);
  assert.notEqual(changed.current_episode.id, long.current_episode.id);
  assert.equal(changed.current_episode.source_item_ids.length, 6);
  assert.equal(changed.current_episode.started_turn_id, "t41-user");
});

test("a conversation shorter than the bound is unchanged: nothing is dropped before the limit", () => {
  const sixteen = mergeTurns(1, 16).at(-1);
  assert.deepEqual(sixteen.current_episode.source_item_ids, sixteen.items.map((item) => item.id));
});

test("known limit, unchanged: the case-level item limit of 500 is the next ceiling, at the 84th turn of six items a turn", () => {
  // Owner decision pending: this change does not touch the case-level limits. When one is raised, update this test with it.
  assert.equal(CASE_STATE_LIMITS.items, 500);
  assert.equal(CASE_STATE_LIMITS.intervention_history, 500);
  const through83 = mergeTurns(1, 83).at(-1);
  assert.equal(through83.items.length, 498);
  assert.equal(through83.current_episode.source_item_ids.length, CASE_STATE_LIMITS.episode_list);
  assert.throws(() => mergeTurn(through83, 84), /caseState\.items exceeds the bounded item limit/u);
});

test("through the real runtime and encrypted store, the 17th turn is delivered and the episode list is capped", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { itemsPerTurn: 6, maximumTurns: 20 });
  const lengths = [];
  for (let number = 1; number <= 18; number += 1) {
    const result = await runtime.run(number);
    assert.equal(result.deliveryKind, "candidate", `turn ${number} was delivered`);
    lengths.push((await runtime.load()).case_state.current_episode.source_item_ids.length);
  }
  assert.deepEqual(lengths.slice(14), [90, 96, 100, 100]);
  const record = await runtime.load();
  assert.equal(record.case_state.items.length, 108);
  assert.equal(record.raw_transcript.length, 36);
  assert.deepEqual(new Set(record.runtime_turns.map((turn) => turn.state)), new Set(["DELIVERED"]));
});

test("through the real runtime, the 60th turn of a stored 59-turn conversation on one route is delivered", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { itemsPerTurn: 6, maximumTurns: 10 });
  // The first 59 turns are built with the real merge and stored as one committed block; running them one by one through the
  // encrypted store takes minutes, because the store rewrites the growing record at every step. The 60th runs the whole loop.
  const states = mergeTurns(1, 59, createEmptyCaseState({ caseId: runtime.caseId }));
  const entries = states.flatMap((state, index) => {
    const number = index + 1;
    const episode_id = state.current_episode.id;
    return [
      { id: `t${number}-user`, exchange_id: `x${number}`, role: "user", text: `Synthetic message ${number}.`, at: at(number), episode_id },
      { id: `t${number}-assistant`, exchange_id: `x${number}`, role: "assistant", text: `Synthetic reply ${number}.`, at: at(number), episode_id }
    ];
  });
  await runtime.store.commitTurn(runtime.caseId, { transcript_entries: entries, case_state: states.at(-1), state_diff: null });
  const stored = await runtime.load();
  assert.equal(stored.case_state.current_episode.source_item_ids.length, CASE_STATE_LIMITS.episode_list);

  const result = await runtime.run(60);
  assert.equal(result.deliveryKind, "candidate");
  const record = await runtime.load();
  const episode = record.case_state.current_episode;
  assert.equal(episode.id, states[0].current_episode.id, "the same episode, so the list really was carried forward");
  assert.equal(episode.source_item_ids.length, CASE_STATE_LIMITS.episode_list);
  assert.equal(record.case_state.items.length, 360);
  assert.deepEqual(episode.source_item_ids, record.case_state.items.map((item) => item.id).slice(-CASE_STATE_LIMITS.episode_list));
  assert.equal(record.raw_transcript.length, 120);
  assert.equal(record.runtime_turns.at(-1).state, "DELIVERED");
});
