import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { FOCUS_LIMITS } from "../src/case-formulation/focus-discipline.mjs";
import { runRuntimeTrajectory } from "../tasks/role-belief-integrity-20260917/trajectory-runner.mjs";
import { makeFocusScriptedProviders, MENTION_SENTENCE, REDIRECT_SENTENCE } from "../tasks/focus-discipline-20260926/scripted-providers.mjs";

// Scripted trajectories through the real private runtime, encrypted storage, and
// deterministic focus controller (owner decision 2026-09-26). The providers are
// scripted, so these runs show the runtime's behavior given a classification;
// they are not evidence that a live model classifies questions well.
const config = () => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });

async function storage(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-focus-trajectory-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  return () => createEncryptedPrivateCaseStore({ rootDir,
    routineKek: Buffer.alloc(32, 71), recoverySecretBytes: Buffer.alloc(32, 72), developmentExternalCredentialAuthorized: true });
}

const focus = (strength, extra = {}) => ({ target: "keep one small caring promise to the younger self", strength,
  natural_pause: false, client_diversion: "none", diversion_topic: "", ...extra });
const unknown = (variable, question, importance, focus_relation, why_it_matters = "") => ({ variable, question, importance, focus_relation, why_it_matters });

const PROMISE_Q = "Which small caring promise felt doable this week, and what got in the way?";
const SISTER_Q = "What is happening between you and your sister right now?";
const MANAGER_Q = "How is the new manager affecting your energy?";
const EXERCISE_Q = "What did you notice in your body when you made the promise out loud?";

async function run(t, id, turns, { processingMode = "fast", restartBeforeTurns = [] } = {}) {
  const openStore = await storage(t);
  const plans = [];
  const { providers, counts } = await makeFocusScriptedProviders({ turns, onPlan: ({ turn, plan }) => { plans[turn - 1] = plan; } });
  const states = [];
  const answers = [];
  const scenario = { id, synthetic: true, processing_mode: processingMode, restart_before_turns: restartBeforeTurns,
    phases: [{ messages: turns.map((item) => item.message) }] };
  const { summary, evidence } = await runRuntimeTrajectory({ scenario, providers, config: config(), openStore,
    onExchange({ exchange, result, record }) {
      states[exchange - 1] = structuredClone(record.case_state.focus_discipline ?? null);
      answers[exchange - 1] = result.answer;
    } });
  assert.equal(summary.status, "COMPLETED");
  assert.equal(summary.execution_class, "SCRIPTED_RUNTIME_ONLY");
  assert.equal(counts.case_extraction, turns.length);
  return { plans, states, answers, evidence, counts };
}

const parked = (state) => state.threads.filter((thread) => thread.status === "parked");
const byVariable = (state, variable) => state.threads.filter((thread) => thread.variable === variable).at(-1);

test("on-target question is pursued, a tangent is redirected and parked, and parked questions return when focus loosens", async (t) => {
  const turns = [
    { message: "I keep breaking small promises to the younger me. Also my sister and I are fighting again.",
      focus: focus("moderate"),
      unknowns: [unknown("promise_context", PROMISE_Q, 4, "advances_focus"),
        unknown("sister_conflict", SISTER_Q, 3, "side", "family conflict may be feeding the self-criticism")] },
    { message: "Anyway, did I tell you my new manager is really weird?",
      focus: focus("moderate", { client_diversion: "tangent", diversion_topic: "new manager" }),
      unknowns: [unknown("promise_context", PROMISE_Q, 4, "advances_focus"),
        unknown("work_manager", MANAGER_Q, 2, "side", "work stress may lower capacity for follow-through")] },
    { message: "Okay, I am saying the promise out loud now and I feel shaky.",
      focus: focus("high"),
      unknowns: [unknown("exercise_response", EXERCISE_Q, 4, "advances_focus")] },
    { message: "That felt good. I think I kept it this time.",
      focus: focus("moderate", { natural_pause: true }), unknowns: [] },
    { message: "I feel settled about the promise now. Not sure what else to look at.",
      focus: focus("light"), unknowns: [] },
    { message: "Actually the thing with my sister keeps coming back to me.",
      focus: focus("moderate"),
      unknowns: [unknown("sister_conflict", SISTER_Q, 4, "advances_focus")] }
  ];
  const { plans, states, answers } = await run(t, "focus-tangent-and-return", turns, { restartBeforeTurns: [4] });

  // Turn 1: the question that moves the focus forward is asked; the side question is parked, not dropped.
  assert.equal(plans[0].nextQuestion, PROMISE_Q);
  assert.equal(plans[0].focusContract.surface, null);
  assert.equal(byVariable(states[0], "sister_conflict").status, "parked");
  assert.equal(byVariable(states[0], "sister_conflict").why_it_matters, "family conflict may be feeding the self-criticism");

  // Turn 2: the tangent is acknowledged, saved, and the session returns to the focus.
  assert.equal(plans[1].focusContract.redirect.kind, "tangent");
  assert.deepEqual(plans[1].focusContract.redirect.parked_thread_ids, [byVariable(states[1], "work_manager").id]);
  assert.equal(plans[1].focusContract.hold, "client_diversion");
  assert.equal(plans[1].nextQuestion, PROMISE_Q);
  assert.notEqual(plans[1].nextQuestion, MANAGER_Q);
  assert.ok(answers[1].startsWith(REDIRECT_SENTENCE));
  assert.equal(parked(states[1]).length, 2);

  // Turn 3: strong focus mid-exercise holds every side question.
  assert.equal(plans[2].focusContract.hold, "strong_focus");
  assert.equal(plans[2].focusContract.surface, null);
  assert.equal(plans[2].nextQuestion, EXERCISE_Q);

  // Turn 4 (after an encrypted store reopen): a natural pause briefly mentions the most important parked question.
  assert.equal(plans[3].focusContract.surface.mode, "mention");
  assert.equal(plans[3].focusContract.surface.question, SISTER_Q);
  assert.equal(plans[3].focusContract.surface.reason, "natural_pause");
  assert.ok(answers[3].includes(MENTION_SENTENCE));
  assert.equal(byVariable(states[3], "sister_conflict").offer_count, 1);

  // Turn 5: with the focus light and no main question, a parked side question becomes the frontal question.
  assert.equal(plans[4].focusContract.surface.mode, "question");
  assert.equal(plans[4].nextQuestion, MANAGER_Q);
  assert.deepEqual(plans[4].questionContract.source, { type: "parked-thread", id: byVariable(states[4], "work_manager").id });
  assert.equal(byVariable(states[4], "work_manager").status, "promoted");
  assert.ok(answers[4].endsWith(MANAGER_Q));

  // Turn 6: when the client returns to a parked thread it becomes the frontal question.
  assert.equal(plans[5].nextQuestion, SISTER_Q);
  assert.equal(byVariable(states[5], "sister_conflict").status, "promoted");
  assert.equal(byVariable(states[5], "sister_conflict").close_reason, "became_frontal");
  assert.equal(parked(states[5]).length, 0);
});

test("an apparently side question that bears on the current target is pursued ahead of a more important true side question", async (t) => {
  const SLEEP_Q = "How many hours have you been sleeping since you started the practice?";
  const HOLIDAY_Q = "What are your plans for the holidays?";
  const turns = [{
    message: "The practice keeps falling apart by Wednesday. I have also been sleeping badly, and the holidays are coming up.",
    focus: focus("moderate"),
    unknowns: [unknown("holiday_plans", HOLIDAY_Q, 5, "side", "may become a support or stress topic later"),
      unknown("sleep_hours", SLEEP_Q, 4, "load_bearing", "sleep loss may explain why the practice collapses midweek")]
  }];
  const { plans, states } = await run(t, "focus-load-bearing", turns);
  assert.equal(plans[0].nextQuestion, SLEEP_Q);
  assert.deepEqual(plans[0].nextQuestionSource, { type: "case-unknown", variable: "sleep_hours" });
  assert.deepEqual(parked(states[0]).map((thread) => thread.variable), ["holiday_plans"]);
});

test("the auditor can park a protective-function probe that would not change the next step", async (t) => {
  const SHAME_Q = "What do you think the shame is protecting you from?";
  const turns = [{
    message: "I think the shame is protecting me from something, but I still want to keep one promise this week.",
    focus: focus("moderate"),
    unknowns: [unknown("shame_function", SHAME_Q, 5, "advances_focus"),
      unknown("promise_context", PROMISE_Q, 4, "advances_focus")],
    audit: { focus_reclassifications: [{ variable: "shame_function", focus_relation: "side",
      why_it_matters: "may matter later if shame keeps blocking the promise", reason: "every plausible answer leaves the same next step" }] }
  }];
  // Control: without the audit reclassification the probe would win on importance alone.
  const control = await run(t, "focus-unaudited-protective-probe", [{ ...turns[0], audit: undefined }], { processingMode: "reviewed" });
  assert.equal(control.plans[0].nextQuestion, SHAME_Q);
  const { plans, states, counts } = await run(t, "focus-audited-protective-probe", turns, { processingMode: "reviewed" });
  assert.equal(counts.case_audit, 1);
  assert.equal(plans[0].nextQuestion, PROMISE_Q);
  const thread = byVariable(states[0], "shame_function");
  assert.equal(thread.status, "parked");
  assert.equal(thread.why_it_matters, "may matter later if shame keeps blocking the promise");
});

test("safety outranks focus handling: no redirect, no surfaced side question", async (t) => {
  const turns = [
    { message: "I want to work on the promise. My sister is also on my mind.", focus: focus("moderate"),
      unknowns: [unknown("promise_context", PROMISE_Q, 4, "advances_focus"), unknown("sister_conflict", SISTER_Q, 4, "side", "may matter later")] },
    { message: "I do not think I can keep myself safe tonight.",
      focus: focus("light", { natural_pause: true, client_diversion: "tangent", diversion_topic: "not feeling safe" }),
      variables: { suicidal_state: "imminent" }, unknowns: [] }
  ];
  const { plans, states } = await run(t, "focus-safety-first", turns);
  assert.equal(plans[1].primaryJob.id, "IC.SAFETY_ORIENTATION");
  assert.equal(plans[1].focusContract.hold, "immediate_protection");
  assert.equal(plans[1].focusContract.redirect, null);
  assert.equal(plans[1].focusContract.surface, null);
  assert.equal(byVariable(states[1], "sister_conflict").status, "parked");
});

test("side questions cannot pile up without bound and are not re-offered forever", async (t) => {
  const turns = Array.from({ length: 12 }, (_, index) => ({
    message: `Session step ${index + 1}: back to the promise, and one more thing came up.`,
    focus: focus("moderate"),
    unknowns: [unknown("promise_context", PROMISE_Q, 4, "advances_focus"),
      unknown(`side_topic_${index + 1}`, `Side question ${index + 1}?`, index % 3 === 0 ? 5 : 2, "side", `side reason ${index + 1}`)]
  }));
  const { plans, states } = await run(t, "focus-bounded-pile-up", turns);
  for (const state of states) assert.ok(parked(state).length <= FOCUS_LIMITS.hardActive);
  // The main question stays the main question; side questions never take over under moderate focus.
  for (const plan of plans) assert.equal(plan.nextQuestion, PROMISE_Q);
  // Pile-up pressure surfaces an important side question as a brief mention even under ordinary focus.
  const mentions = plans.filter((plan) => plan.focusContract.surface?.mode === "mention");
  assert.ok(mentions.length >= 2);
  assert.ok(mentions.every((plan) => plan.focusContract.surface.question.startsWith("Side question ")));
  const final = states.at(-1);
  // The least important threads are retired first; important ones are offered and, if not taken up, retired rather than nagged.
  const retired = final.threads.filter((thread) => thread.status === "retired");
  assert.ok(retired.some((thread) => thread.close_reason === "capacity_lowest_value" && thread.importance === 2));
  assert.ok(final.threads.every((thread) => thread.offer_count <= FOCUS_LIMITS.maxOffers));
  assert.ok(retired.some((thread) => thread.close_reason === "offered_not_taken" && thread.offer_count === FOCUS_LIMITS.maxOffers));
  assert.ok(parked(final).every((thread) => thread.importance === 5 || thread.parked_turn > 6));
});
