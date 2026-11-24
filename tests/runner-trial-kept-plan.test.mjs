import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { createRunnerTrialRuntime } from "../src/runner-trial/runtime.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { RUNNER_KEPT_PLAN_SETTING, readRunnerKeptPlanSwitch, validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { KEPT_PLAN_LIFETIME_MS, assertKeptPlansAppendOnly, validateKeptPlans } from "../src/runner-trial/kept-plan.mjs";
import { KEPT_PLAN_DELETE_NOTE, KEPT_PLAN_GONE_LINE, KEPT_PLAN_KEPT_LINE, KEPT_PLAN_RULE, RESUME_FRESH, RESUME_QUESTION, RESUME_YES } from "../src/runner-trial/notices.mjs";
import { crisisReaderNumberNowNote } from "../src/runner-trial/worker-prompts.mjs";
import { SYNTHETIC_PROTOCOL, packetDigest, runPacketScenario } from "./fixtures/runner-kept-plan-scenario.mjs";

// The plan kept for next time (docs/superpowers/specs/2026-11-21-runner-trial-design.md, section 9; the owner's 5b), behind
// INNER_SIGNAL_RUNNER_KEPT_PLAN, with stand-in workers through the real encrypted store, the real turn controller and the real
// server. The rules are a synthetic protocol and every conversation is synthetic. These tests show the program around the models;
// they say nothing about how real models read, write or check.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const parts = cutRuleParts(SYNTHETIC_PROTOCOL);
const CASE_ID = "synthetic-kept-plan-case";
const START = Date.parse("2026-11-21T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
// The owner's 30 days, written here rather than read from the module, so a change to the module's number is seen.
const THIRTY_DAYS = 30 * DAY;

// The packets with the switch off. First taken from the fixture's scenario run on `git archive aa9d03112 src` (the trial's head
// before the kept plan was built): 63d1a8108028bb0f8819562e8bea3290b466678e8946d49cd8bb9eada740afbc. Re-pinned on 22 Nov 2026 for
// one deliberate prompt change and nothing else: the writer's line about InnerSignal's storage and the checkers' STORAGE_DESCRIBED
// (worker-prompts.mjs, from the blind comparison's F9): 228d813743acce50af16eec30be3f448a1aad8c75d1f957e1209e07fd4860f41.
// Re-pinned again on 22 Nov 2026 for one deliberate prompt change and nothing else: the crisis reader's provisional_reply sentence
// (crisisReaderPrompt in worker-prompts.mjs) now states the provisional's exact checks in plain words (one question, and where they
// are when that isn't known; only 112, 911 and 999; no other number of two or more digits; 900 characters; the three links; no
// "detox"). Only the 7 R1 calls change: with the earlier sentence put back in them, the digest is the one above:
// 537cedf1dff4d0a6be6a5e5e7dd67c139156e321716eb0407845ff3ce5803b02.
// Re-pinned on 22 Nov 2026 for three deliberate prompt changes from Fable's recheck of that day and nothing else (worker-prompts.mjs):
// in crisisReaderPrompt, the provisional's question limit now reads "at most two questions in the whole reply (two question marks):
// where they are, when you don't know, and one about now;" (finding 4); in writerPrompt, STORAGE_LINE is reworded and STORAGE_FACTS
// (what InnerSignal keeps) follows it (finding 9); and STORAGE_FINDING, in the skill checker's and the whole checker's focus, is
// reworded to the same meaning. So the system prompts of the 7 R1 calls, the 7 W calls and the W-repair call change, and those of
// the 6 C2 and 2 CW calls; no packet or schema changes. With the earlier wording put back in those calls, the digest is the one
// just above. A deliberate change to a worker's prompt or packet changes it again.
const PACKETS_BEFORE_KEPT_PLAN = "095b140d166da6a6276e6c916411f61e5e40e0593335552e9d5f9533e2ae8939";

// The plan reply of the scenarios below, and its two lines.
const PLAN_LINES = Object.freeze([
  "Your plan for the next hours: text Sam \"rough night, can I call you?\" before ten.",
  "Then rest with the lamp on, and come back here tomorrow."
]);
const PLAN_REPLY = `You did well to stay with this. ${PLAN_LINES[0]}\n${PLAN_LINES[1]}`;
const OFFER = "Would you like me to keep this plan for next time?";

const packetOf = (request) => JSON.parse(request.user.slice(request.user.indexOf("{")));
const latest = (request) => packetOf(request).latest_message?.text ?? "";

async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function fakeWorkers(script) {
  const calls = [];
  let session = 0;
  return {
    calls,
    workerFor: (role) => ({
      async call(request) {
        const count = calls.filter((entry) => entry.role === role).length + 1;
        calls.push({ role, request });
        const value = await script[role](count, request);
        session += 1;
        return { value, receipt: { provider: "fake", model: "fake", session_id: `fake-${role}-${session}` } };
      }
    })
  };
}

// Stand-ins steered by markers in the person's message: [want] someone who wants to die, [plan] the reply that reaches the plan for
// the next hours, [keep] and [delete] what the crisis reader reads they ask, [under18] and [unsafe] its two flags, [no-reading] a
// crisis reader that gives no reading. `lines` is what the writer copies when asked; `confirm` the crisis checker's confirmation.
function keptPlanScript({ lines = PLAN_LINES, confirm = true } = {}) {
  const reading = (text) => ({
    level: text.includes("[want]") ? "wants_to_die" : "none",
    wish_or_intent: text.includes("[want]") ? "wish" : "not_applicable",
    pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false,
    may_be_under_18: text.includes("[under18]"), home_unsafe: text.includes("[unsafe]"),
    reason: "synthetic", provisional_reply: null,
    asks_to_keep_plan: text.includes("[keep]"), asks_to_delete_plan: text.includes("[delete]")
  });
  const writer = (count, request, prefix) => {
    const packet = packetOf(request);
    const text = packet.latest_message.text;
    const reply = text.includes("[plan]") ? PLAN_REPLY : `${prefix} ${count}.${packet.may_offer_to_keep_plan ? ` ${OFFER}` : ""}`;
    return { reply, answered_level: text.includes("[want]") ? "wants_to_die" : "none", quotes: [], plan_reached: text.includes("[plan]"), offered_to_keep_plan: packet.may_offer_to_keep_plan === true, kept_plan_lines: packet.keep_plan_asked ? lines : [] };
  };
  const passing = () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] });
  const levelReader = (count, request) => ({
    findings: [], level: latest(request).includes("[want]") ? "wants_to_die" : "none", repair_induced_checks: [], missed_boxes: [],
    plan_reached: false, confirms_keep_plan_yes: Boolean(packetOf(request).kept_plan_offer) && confirm
  });
  return {
    R1: (count, request) => {
      if (latest(request).includes("[no-reading]")) throw Object.assign(new Error("synthetic"), { code: "TIMEOUT" });
      return reading(latest(request));
    },
    R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION"] }),
    R3: () => ({ compatibility_assessment: null }),
    W: (count, request) => writer(count, request, "Synthetic reply"),
    "W-repair": (count, request) => writer(count, request, "Synthetic repaired reply"),
    C1: levelReader, CW: levelReader,
    C2: passing, C3: passing, C4: passing,
    C5: () => ({ findings: [], level: "none", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] })
  };
}

// The trial's runtime and controller over a real encrypted store, with one clock for both (it moves a second per message).
async function makeRunner(t, script, { keptPlanEnabled = true, settings = {} } = {}) {
  const root = await tempDir(t, "kept-plan");
  const clock = { now: START };
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62), developmentExternalCredentialAuthorized: true, now: () => new Date(clock.now).toISOString() });
  const workers = fakeWorkers(script);
  const runtime = createRunnerTrialRuntime({ privateCaseSource: store, parts, settings, workerFor: workers.workerFor, keptPlanEnabled, now: () => clock.now });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: runtime, maximumInvocationAttempts: 1 });
  let exchange = 0;
  const send = (text, userInput = {}) => {
    exchange += 1;
    clock.now += 1_000;
    return controller.run({ caseId: CASE_ID, runtimeTurnId: `runtime:exchange-${exchange}`, exchangeId: `exchange-${exchange}`, userTurnId: `exchange-${exchange}-user`, assistantTurnId: `exchange-${exchange}-assistant`, userMessage: text, userInput });
  };
  const requests = (role) => workers.calls.filter((call) => call.role === role).map((call) => call.request);
  return { root, clock, store, runtime, controller, calls: workers.calls, requests, send };
}

// A conversation that reaches the plan for the next hours: someone who wants to die, then the reply with the plan.
async function reachPlan(runner, userInput = {}) {
  await runner.send("[want] Synthetic: I keep thinking I want to die.", userInput);
  await runner.send("[want] [plan] Synthetic: a little safer now; I could text Sam.");
}

const KEPT_PLAN_PACKET_FIELDS = ["may_offer_to_keep_plan", "keep_plan_asked", "kept_plan_deleted_on_request", "kept_plan", "kept_plan_offer"];

// ---- The switch --------------------------------------------------------------------------------------------------------------

test("the kept plan's switch is off by default, read like the trial's, and any other value stops loadConfig naming the setting, never the value", async () => {
  assert.equal(RUNNER_KEPT_PLAN_SETTING, "INNER_SIGNAL_RUNNER_KEPT_PLAN");
  const original = process.env[RUNNER_KEPT_PLAN_SETTING];
  try {
    for (const [values, expected] of [[[undefined, "", " ", "off", "OFF", "false", "0", "no"], false], [["on", " ON ", "true", "1", "yes"], true]]) {
      for (const value of values) {
        assert.equal(readRunnerKeptPlanSwitch(value), expected, JSON.stringify(value));
        if (value === undefined) delete process.env[RUNNER_KEPT_PLAN_SETTING];
        else process.env[RUNNER_KEPT_PLAN_SETTING] = value;
        assert.equal(loadConfig({ mode: "mock" }).runnerKeptPlanEnabled, expected, `${JSON.stringify(value)} through loadConfig`);
      }
    }
    for (const value of ["maybe", "2", "synthetic-invalid-value"]) {
      process.env[RUNNER_KEPT_PLAN_SETTING] = value;
      const refused = (error) => error?.code === "BAD_CONFIG" && error.message === "INNER_SIGNAL_RUNNER_KEPT_PLAN must be on or off." && !error.message.includes(value);
      assert.throws(() => readRunnerKeptPlanSwitch(value), refused);
      assert.throws(() => loadConfig({ mode: "mock" }), refused);
    }
  } finally {
    if (original === undefined) delete process.env[RUNNER_KEPT_PLAN_SETTING];
    else process.env[RUNNER_KEPT_PLAN_SETTING] = original;
  }
});

// ---- The switch off ------------------------------------------------------------------------------------------------------------

test("with the switch off every worker's prompt, packet and schema is byte-identical to the packets before the kept plan", async (t) => {
  const modules = { createEncryptedPrivateCaseStore, createRunnerTrialRuntime, createPrivateTherapyTurnController, cutRuleParts, REPAIR_INDUCED_ERROR_CHECKS };
  for (const runtimeOptions of [{}, { keptPlanEnabled: false }]) {
    const calls = await runPacketScenario({ modules, root: await tempDir(t, "kept-plan-golden"), runtimeOptions });
    assert.equal(calls.length, 54, "both arms, every worker, a repair included");
    assert.equal(packetDigest(calls), PACKETS_BEFORE_KEPT_PLAN, `the same bytes as before (${JSON.stringify(runtimeOptions)})`);
    for (const call of calls) {
      const words = `${call.system}\n${call.user}\n${JSON.stringify(call.schema)}`;
      assert.equal(/keep_plan|kept_plan|plan_reached|Pick up where/u.test(words) || words.includes(KEPT_PLAN_RULE), false, `${call.arm} ${call.role}: nothing of the kept plan`);
    }
  }
  // The same scenario with the switch on gives other packets, so the digest above would see a change.
  const on = await runPacketScenario({ modules, root: await tempDir(t, "kept-plan-golden-on"), runtimeOptions: { keptPlanEnabled: true } });
  assert.notEqual(packetDigest(on), PACKETS_BEFORE_KEPT_PLAN);
});

// The number now (INNER_SIGNAL_RUNNER_NUMBER_NOW; design, section 9b) has its own switch, checked against the same digest: with it off,
// every worker gets the packets from before either switch was built.
test("with the number now's switch off every worker's prompt, packet and schema is byte-identical too; on, only the crisis reader's prompt and schema change", async (t) => {
  const modules = { createEncryptedPrivateCaseStore, createRunnerTrialRuntime, createPrivateTherapyTurnController, cutRuleParts, REPAIR_INDUCED_ERROR_CHECKS };
  let off = null;
  for (const runtimeOptions of [{ numberNowEnabled: false }, { keptPlanEnabled: false, numberNowEnabled: false }]) {
    const calls = await runPacketScenario({ modules, root: await tempDir(t, "number-now-golden"), runtimeOptions });
    assert.equal(calls.length, 54, "both arms, every worker, a repair included");
    assert.equal(packetDigest(calls), PACKETS_BEFORE_KEPT_PLAN, `the same bytes as before (${JSON.stringify(runtimeOptions)})`);
    for (const call of calls) assert.equal(/number_now/u.test(`${call.system}\n${call.user}\n${JSON.stringify(call.schema)}`), false, `${call.arm} ${call.role}: nothing of the number now`);
    off ??= calls;
  }
  // With the kept plan on, the number now's switch off leaves the kept plan's packets as they are.
  const keptOnly = await runPacketScenario({ modules, root: await tempDir(t, "number-now-kept"), runtimeOptions: { keptPlanEnabled: true } });
  const keptAndOff = await runPacketScenario({ modules, root: await tempDir(t, "number-now-kept-off"), runtimeOptions: { keptPlanEnabled: true, numberNowEnabled: false } });
  assert.equal(packetDigest(keptAndOff), packetDigest(keptOnly));
  // On, in a scenario where nothing is read number_now: the crisis reader's prompt gets the note and its schema the field; every
  // packet, and every other worker's prompt and schema, is unchanged.
  const on = await runPacketScenario({ modules, root: await tempDir(t, "number-now-golden-on"), runtimeOptions: { numberNowEnabled: true } });
  assert.notEqual(packetDigest(on), PACKETS_BEFORE_KEPT_PLAN);
  assert.equal(on.length, off.length);
  for (const [index, call] of on.entries()) {
    const before = off[index];
    assert.deepEqual([call.arm, call.role, call.user], [before.arm, before.role, before.user], `${call.arm} ${call.role}: the same packet`);
    if (call.role === "R1") {
      assert.ok(call.system.includes(crisisReaderNumberNowNote()), `${call.arm} R1: the note`);
      assert.deepEqual(Object.keys(call.schema.properties), [...Object.keys(before.schema.properties), "number_now"]);
    } else {
      assert.deepEqual([call.system, call.schema], [before.system, before.schema], `${call.arm} ${call.role}: the same prompt and schema`);
    }
  }
});

// The owner's fixed message after the plan's limit, a lapsed sign-in or the time (INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_FAILURE; design,
// section 7) changes only which closing a turn gets: no prompt, schema or packet field. In this scenario, which closes no turn, every
// worker gets the packets from before, off or on (with the fixed message on). After a closing that showed his message, a later
// turn's packet holds it where the notice would have stood, as it holds whatever the person was shown.
test("the fixed message's switch for failures, off or on, leaves every worker's prompt, packet and schema byte-identical", async (t) => {
  const modules = { createEncryptedPrivateCaseStore, createRunnerTrialRuntime, createPrivateTherapyTurnController, cutRuleParts, REPAIR_INDUCED_ERROR_CHECKS };
  for (const runtimeOptions of [{ fixedMessageOnFailureEnabled: false }, { ownerFallbackEnabled: true, fixedMessageOnFailureEnabled: true }]) {
    const calls = await runPacketScenario({ modules, root: await tempDir(t, "fixed-message-golden"), runtimeOptions });
    assert.equal(calls.length, 54, "both arms, every worker, a repair included");
    assert.equal(packetDigest(calls), PACKETS_BEFORE_KEPT_PLAN, `the same bytes as before (${JSON.stringify(runtimeOptions)})`);
  }
});

// The owner's fixed message after every failure (INNER_SIGNAL_RUNNER_FIXED_MESSAGE_ON_ANY_FAILURE; design, section 7) changes, like the
// 3b switch, only which closing a turn gets: off, or on with the 3b switch and the fixed message on, every worker gets the packets from
// before in this scenario, which closes no turn.
test("the fixed message's switch for every failure, off or on, leaves every worker's prompt, packet and schema byte-identical", async (t) => {
  const modules = { createEncryptedPrivateCaseStore, createRunnerTrialRuntime, createPrivateTherapyTurnController, cutRuleParts, REPAIR_INDUCED_ERROR_CHECKS };
  for (const runtimeOptions of [{ fixedMessageOnAnyFailureEnabled: false }, { ownerFallbackEnabled: true, fixedMessageOnFailureEnabled: true, fixedMessageOnAnyFailureEnabled: true }]) {
    const calls = await runPacketScenario({ modules, root: await tempDir(t, "any-failure-golden"), runtimeOptions });
    assert.equal(calls.length, 54, "both arms, every worker, a repair included");
    assert.equal(packetDigest(calls), PACKETS_BEFORE_KEPT_PLAN, `the same bytes as before (${JSON.stringify(runtimeOptions)})`);
  }
});

test("with the switch off, a reader that says the person asks to keep or delete a plan keeps and deletes nothing, and the record gains nothing", async (t) => {
  const runner = await makeRunner(t, keptPlanScript(), { keptPlanEnabled: false });
  await reachPlan(runner);
  await runner.send("[want] [keep] Synthetic: yes, keep the plan for next time.");
  await runner.send("[delete] Synthetic: delete the plan.", { newConversation: true, resumeConfirmed: true });
  const record = await runner.store.load(CASE_ID);
  assert.equal(Object.hasOwn(record, "runner_kept_plans"), false, "no kept-plan field in the case record");
  for (const turn of record.runtime_turns) {
    assert.deepEqual(Object.keys(turn).filter((key) => key.startsWith("kept_plan")), []);
    assert.deepEqual(Object.keys(turn.runner_reading.readers).filter((name) => ["resume", "kept_plan_offer"].includes(name)), []);
  }
  for (const call of runner.calls) assert.deepEqual(KEPT_PLAN_PACKET_FIELDS.filter((field) => Object.hasOwn(packetOf(call.request), field)), [], call.role);
  assert.equal(typeof runner.runtime.resumeStatus, "undefined", "the page's kept-plan methods exist only with the switch on");
  assert.equal(typeof runner.controller.deleteKeptPlan, "undefined");
});

// ---- Asking, offering and keeping --------------------------------------------------------------------------------------------

test("asked and kept: only the lines found word for word (whitespace folded) in an earlier reply of this conversation, with the date, encrypted, never in the transcript", async (t) => {
  const spaced = `  ${PLAN_LINES[1].replaceAll(" ", "\n ")}  `;
  const runner = await makeRunner(t, keptPlanScript({ lines: [PLAN_LINES[0], spaced, "Text Sam right now and call 112.", PLAN_LINES[0]] }));
  await reachPlan(runner);
  const kept = await runner.send("[keep] Synthetic: please keep that plan for next time.");
  const writer = runner.requests("W").at(-1);
  assert.equal(packetOf(writer).keep_plan_asked, true, "the writer is asked for the plan's lines");
  assert.equal(writer.system.includes(KEPT_PLAN_RULE), false, "the rule goes only with a kept plan in the packet");
  assert.ok(kept.runtimeTurn.kept_plan_kept_at, "the turn says it kept a plan");
  const record = await runner.store.load(CASE_ID);
  assert.equal(record.runner_kept_plans.length, 1);
  const [plan] = record.runner_kept_plans;
  assert.deepEqual(plan.lines, PLAN_LINES, "the two lines found, once each; the line not in any reply is dropped");
  assert.deepEqual([plan.kept_at, plan.deleted_at, plan.deletion_reason], [kept.runtimeTurn.kept_plan_kept_at, null, null]);
  assert.equal(plan.conversation_id, record.runtime_turns[1].runner_reading.conversation_id, "kept for the conversation that made it");
  assert.equal(record.raw_transcript.length, 6, "the transcript holds the three exchanges and nothing else");
  assert.equal(record.raw_transcript.filter((entry) => entry.text.includes("lamp on")).length, 1, "the lines are in the transcript only where the person saw them");
  // Encrypted, not just encoded: neither the file's text nor its decoded payload holds the plan's words.
  const file = await fs.readFile(path.join(runner.root, `${CASE_ID}.vault.json`), "utf8");
  const payload = Buffer.from(JSON.parse(file).payload.ciphertext, "base64");
  assert.ok(payload.length > 1_000, "the payload holds the whole record");
  for (const words of ["lamp on", "rough night", "runner_kept_plans"]) {
    assert.equal(file.includes(words) || payload.includes(Buffer.from(words, "utf8")), false, `the case file holds "${words}" only encrypted`);
  }
});

test("offered once at the end of a crisis plan, then kept only on a yes the crisis checker confirms", async (t) => {
  for (const confirm of [true, false]) {
    const runner = await makeRunner(t, keptPlanScript({ confirm }));
    await reachPlan(runner);
    await runner.send("[want] Synthetic: okay, I'll do that.");
    const offers = runner.requests("W").map((request) => packetOf(request).may_offer_to_keep_plan === true);
    assert.deepEqual(offers, [false, false, true], "leave to offer after the reply that reached the plan, not before");
    let record = await runner.store.load(CASE_ID);
    assert.deepEqual(record.runtime_turns[2].runner_reading.readers.kept_plan_offer, { may_offer: true }, "the offer is recorded");
    assert.ok(record.raw_transcript.at(-1).text.endsWith(OFFER));

    const answer = await runner.send("[keep] Synthetic: yes, keep it.");
    const writer = packetOf(runner.requests("W").at(-1));
    assert.deepEqual([writer.may_offer_to_keep_plan, writer.keep_plan_asked], [undefined, true], "no second offer; the writer is asked for the lines");
    const checker = packetOf(runner.requests("C1").at(-1));
    assert.deepEqual(checker.kept_plan_offer, { offered_in_previous_reply: true }, "the crisis checker is told of the offer to confirm the yes");
    record = await runner.store.load(CASE_ID);
    assert.equal(record.runtime_turns[3].runner_reading.checker_levels.at(-1).confirms_keep_plan_yes, confirm, "its confirmation is stored with its level");
    if (confirm) {
      assert.deepEqual(record.runner_kept_plans.map((plan) => plan.lines), [PLAN_LINES]);
      assert.ok(answer.runtimeTurn.kept_plan_kept_at);
    } else {
      assert.equal(Object.hasOwn(record, "runner_kept_plans"), false, "a yes the crisis checker doesn't confirm keeps nothing");
      assert.equal(answer.runtimeTurn.kept_plan_kept_at, undefined);
    }
    await runner.send("[want] Synthetic: still here.");
    assert.equal(packetOf(runner.requests("W").at(-1)).may_offer_to_keep_plan, undefined, "the offer is made once per conversation");
  }
});

test("never offered or kept when any stored reading of the case says the person may be under 18 or home isn't safe, or when the crisis reader gives no reading", async (t) => {
  for (const flag of ["[under18]", "[unsafe]"]) {
    const runner = await makeRunner(t, keptPlanScript());
    await runner.send(`${flag} Synthetic: an earlier conversation.`);
    await reachPlan(runner, { newConversation: true });
    await runner.send("[want] Synthetic: okay.");
    await runner.send("[keep] Synthetic: please keep the plan for next time.");
    for (const request of runner.requests("W")) {
      assert.deepEqual([packetOf(request).may_offer_to_keep_plan, packetOf(request).keep_plan_asked], [undefined, undefined], `${flag}: no offer, no lines asked`);
    }
    const record = await runner.store.load(CASE_ID);
    assert.equal(Object.hasOwn(record, "runner_kept_plans"), false, `${flag}: nothing kept`);
    assert.notEqual(record.runtime_turns[0].runner_reading.conversation_id, record.runtime_turns[1].runner_reading.conversation_id, "the flag is in an earlier conversation");
    // A turn the store is asked to keep a plan for directly is refused for the same reading.
    await runner.store.beginPrivateRuntimeTurn(CASE_ID, { runtimeTurnId: "runtime:direct", exchangeId: "exchange-direct", userTurnId: "exchange-direct-user", exactText: "Synthetic: keep it." });
    await runner.store.recordRunnerReading(CASE_ID, "runtime:direct", { conversationId: record.runtime_turns[1].runner_reading.conversation_id, readers: { crisis: { level: "none", asks_to_keep_plan: true, may_be_under_18: false, home_unsafe: false } } });
    await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:direct", { lines: PLAN_LINES }), (error) => error.code === "RUNNER_KEPT_PLAN_REFUSED" && error.details.reason === "never");
  }
  const runner = await makeRunner(t, keptPlanScript());
  await reachPlan(runner);
  await runner.send("[want] [no-reading] Synthetic: okay.");
  await runner.send("[keep] [no-reading] Synthetic: keep the plan please.");
  assert.deepEqual(runner.requests("W").slice(2).map((request) => [packetOf(request).may_offer_to_keep_plan, packetOf(request).keep_plan_asked]), [[undefined, undefined], [undefined, undefined]], "no offer and no lines without this turn's reading");
  assert.equal(Object.hasOwn(await runner.store.load(CASE_ID), "runner_kept_plans"), false);
});

test("the store keeps a plan only by its own rules: the person's ask, the crisis checker's yes after an offer, a turn still open, and a line word for word in an earlier reply", async (t) => {
  const runner = await makeRunner(t, keptPlanScript());
  await reachPlan(runner);
  await runner.send("[want] Synthetic: okay, I'll do that.");
  assert.ok((await runner.store.load(CASE_ID)).raw_transcript.at(-1).text.endsWith(OFFER), "the reply before offered to keep the plan");
  const conversationId = (await runner.store.load(CASE_ID)).runtime_turns[1].runner_reading.conversation_id;
  const open = async (id, crisis) => {
    await runner.store.beginPrivateRuntimeTurn(CASE_ID, { runtimeTurnId: `runtime:${id}`, exchangeId: id, userTurnId: `${id}-user`, exactText: `Synthetic ${id}.` });
    if (crisis) await runner.store.recordRunnerReading(CASE_ID, `runtime:${id}`, { conversationId, readers: { crisis } });
  };
  const close = (id) => runner.store.closeRuntimeTurnUnanswered(CASE_ID, `runtime:${id}`, { kind: "runner_unavailable", reasonCode: "interrupted", assistantTurnId: `${id}-assistant`, eventId: `event-${id}-closed` });
  const reason = (expected) => (error) => error.code === "RUNNER_KEPT_PLAN_REFUSED" && error.details.reason === expected;
  // After the offer, the yes counts only once the crisis checker's own reading confirms it.
  await open("exchange-z", { level: "none", asks_to_keep_plan: true });
  await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-z", { lines: PLAN_LINES }), reason("not_confirmed"));
  await runner.store.recordRunnerCheckerLevel(CASE_ID, "runtime:exchange-z", { candidateId: "candidate:synthetic-z", checker: "C1", level: "none", confirmsKeepPlanYes: false });
  await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-z", { lines: PLAN_LINES }), reason("not_confirmed"));
  assert.equal(Object.hasOwn(await runner.store.load(CASE_ID), "runner_kept_plans"), false, "nothing kept by a refused call");
  await runner.store.recordRunnerCheckerLevel(CASE_ID, "runtime:exchange-z", { candidateId: "candidate:synthetic-z", checker: "C1", level: "none", confirmsKeepPlanYes: true });
  assert.deepEqual((await runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-z", { lines: PLAN_LINES })).lines, PLAN_LINES, "kept once confirmed");
  await close("exchange-z");
  await open("exchange-a", { level: "unclear", unread: true });
  await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-a", { lines: PLAN_LINES }), reason("no_reading"));
  await close("exchange-a");
  await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-a", { lines: PLAN_LINES }), reason("finished_turn"));
  await open("exchange-b", { level: "none", asks_to_keep_plan: false });
  await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-b", { lines: PLAN_LINES }), reason("not_asked"));
  await close("exchange-b");
  // No offer just before: the person's ask alone keeps the plan, but only lines found word for word.
  await open("exchange-c", { level: "none", asks_to_keep_plan: true });
  await assert.rejects(() => runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-c", { lines: ["Text Sam right now.", "A line from nowhere."] }), reason("no_line_found"));
  const plan = await runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-c", { lines: [...PLAN_LINES, 42, ""] });
  assert.deepEqual(plan.lines, PLAN_LINES);
  assert.deepEqual(await runner.store.recordRunnerKeptPlan(CASE_ID, "runtime:exchange-c", { lines: ["Other lines."] }), plan, "kept once per turn");
  assert.deepEqual((await runner.store.load(CASE_ID)).runner_kept_plans.map((entry) => [entry.runtime_turn_id, entry.deletion_reason]), [["runtime:exchange-z", "replaced"], ["runtime:exchange-c", null]], "one plan at a time");

  // The record's rules: at most one plan kept at a time, a deleted plan holds no lines, and the list is append-only.
  const record = await runner.store.load(CASE_ID);
  const deleted = { ...plan, lines: [], deleted_at: "2026-11-22T00:00:00.000Z", deletion_reason: "deleted_on_page" };
  assert.throws(() => validateKeptPlans([plan, { ...plan, id: "kept-plan:other" }], record), /listed twice|at most one/iu);
  assert.throws(() => validateKeptPlans([{ ...deleted, lines: PLAN_LINES }], record), /keeps no lines/u);
  assert.throws(() => assertKeptPlansAppendOnly([plan], []), /append-only/u);
  assert.throws(() => assertKeptPlansAppendOnly([plan], [{ ...plan, lines: [PLAN_LINES[0]] }]), /only by its deletion/u);
  assert.throws(() => assertKeptPlansAppendOnly([deleted], [{ ...deleted, deletion_reason: "expired" }]), /immutable/u);
  assert.doesNotThrow(() => assertKeptPlansAppendOnly([plan], [deleted]));

  // Deleting the kept plan of a case that has no file leaves it without one.
  assert.deepEqual({ ...(await runner.store.deleteRunnerKeptPlans("synthetic-no-such-case", { reason: "deleted_on_page" })) }, { deleted: 0 });
  assert.equal(await runner.store.load("synthetic-no-such-case"), null);
});

// ---- Next time ---------------------------------------------------------------------------------------------------------------

test("next time: only Yes puts the kept plan in the writer's and the crisis checker's packets, with the rule's exact words, and in no other worker's", async (t) => {
  const runner = await makeRunner(t, keptPlanScript());
  await reachPlan(runner);
  await runner.send("[keep] Synthetic: please keep that plan.");
  const keptOn = (await runner.store.load(CASE_ID)).runner_kept_plans[0].kept_at.slice(0, 10);
  const mark = () => runner.calls.length;
  const since = (start) => runner.calls.slice(start);
  const planIn = (calls, role) => calls.filter((call) => call.role === role).map((call) => packetOf(call.request).kept_plan ?? null);

  // Start fresh, then no answer, then a "true" that isn't exactly true (the server passes only exactly true on): no plan.
  for (const userInput of [{ resumeConfirmed: false }, {}, { resumeConfirmed: "true" }]) {
    const start = mark();
    await runner.send("Synthetic: hello again.", { newConversation: true, ...userInput });
    assert.deepEqual([...planIn(since(start), "W"), ...planIn(since(start), "C1")], [null, null], JSON.stringify(userInput));
  }
  const record = await runner.store.load(CASE_ID);
  assert.deepEqual(record.runtime_turns.slice(-3).map((turn) => turn.runner_reading.readers.resume), [{ confirmed: false }, { confirmed: false }, { confirmed: false }]);

  // Yes: the writer and the crisis checker get the lines and the day, for the whole conversation, whatever later messages send.
  let start = mark();
  await runner.send("Synthetic: hi, it's me.", { newConversation: true, resumeConfirmed: true });
  await runner.send("Synthetic: a second message.", { resumeConfirmed: false });
  const expected = { lines: PLAN_LINES, kept_on: keptOn };
  assert.deepEqual(planIn(since(start), "W"), [expected, expected]);
  assert.deepEqual(planIn(since(start), "C1"), [expected, expected]);
  // The rule is in a worker's prompt exactly when its packet holds a kept plan, and only the writer and the crisis checker get either.
  for (const call of runner.calls) {
    const withPlan = Object.hasOwn(packetOf(call.request), "kept_plan");
    assert.equal(call.request.system.includes(KEPT_PLAN_RULE), withPlan, `${call.role}: the rule only with the plan`);
    if (withPlan) assert.ok(["W", "C1"].includes(call.role), `${call.role} never gets the kept plan`);
  }
  // The plan isn't shown again in the conversation that kept it: a plan made minutes ago isn't "next time".
  start = mark();
  await reachPlan(runner, { newConversation: true, resumeConfirmed: true });
  await runner.send("[keep] Synthetic: keep this new one.");
  await runner.send("Synthetic: one more message.");
  assert.deepEqual(planIn(since(start), "W").map(Boolean), [true, true, true, false], "the earlier plan until this conversation's own replaced it");

  // The whole checker gets it in its arm.
  const whole = await makeRunner(t, keptPlanScript(), { settings: { writerMode: "whole", checkerMode: "whole" } });
  await reachPlan(whole);
  await whole.send("[keep] Synthetic: keep it.");
  start = whole.calls.length;
  await whole.send("Synthetic: hello.", { newConversation: true, resumeConfirmed: true });
  const checker = whole.calls.slice(start).find((call) => call.role === "CW").request;
  assert.deepEqual(packetOf(checker).kept_plan?.lines, PLAN_LINES);
  assert.ok(checker.system.includes(KEPT_PLAN_RULE));
});

test("30 days after it was kept, the next load deletes the plan (lines removed, date kept); before then it is still given", async (t) => {
  const runner = await makeRunner(t, keptPlanScript());
  await reachPlan(runner);
  await runner.send("[keep] Synthetic: keep it.");
  const keptAt = Date.parse((await runner.store.load(CASE_ID)).runner_kept_plans[0].kept_at);
  assert.equal(KEPT_PLAN_LIFETIME_MS, THIRTY_DAYS);
  runner.clock.now = keptAt + THIRTY_DAYS - 60 * 60 * 1000;
  let start = runner.calls.length;
  await runner.send("Synthetic: back after a while.", { newConversation: true, resumeConfirmed: true });
  assert.deepEqual(packetOf(runner.calls.slice(start).find((call) => call.role === "W").request).kept_plan?.lines, PLAN_LINES, "an hour before its 30 days it is still given");

  runner.clock.now = keptAt + THIRTY_DAYS + 60 * 1000;
  // The page's load checks it too, before any message.
  assert.deepEqual({ ...(await runner.controller.resumeStatus({ caseId: CASE_ID })) }, { hasConversation: true, nextStartsNewConversation: false });
  const [plan] = (await runner.store.load(CASE_ID)).runner_kept_plans;
  assert.deepEqual([plan.lines, plan.deletion_reason, plan.deleted_at], [[], "expired", new Date(runner.clock.now).toISOString()]);
  assert.equal(plan.kept_at, new Date(keptAt).toISOString(), "when it was kept stays in the record");
  start = runner.calls.length;
  await runner.send("Synthetic: back again.", { newConversation: true, resumeConfirmed: true });
  assert.equal(packetOf(runner.calls.slice(start).find((call) => call.role === "W").request).kept_plan, undefined, "past 30 days nothing is given");

  // And a load during a turn deletes it too, without the page.
  const other = await makeRunner(t, keptPlanScript());
  await reachPlan(other);
  await other.send("[keep] Synthetic: keep it.");
  other.clock.now += 31 * DAY;
  await other.send("Synthetic: much later.");
  assert.equal((await other.store.load(CASE_ID)).runner_kept_plans[0].deletion_reason, "expired");
});

test("every call checks the 30 days again: a retry that starts after them gets neither the plan nor the rule (the writer, the repair writer, the crisis checker)", async (t) => {
  for (const role of ["W", "W-repair", "C1"]) {
    const base = keptPlanScript();
    let runner = null;
    let crossAt = null;
    // The first call of `role` that holds the plan takes so long that the plan's 30 days pass, then times out; the retry follows.
    const crossOnce = (answer) => (count, request) => {
      if (crossAt != null && packetOf(request).kept_plan) {
        runner.clock.now = crossAt;
        crossAt = null;
        throw Object.assign(new Error("synthetic"), { code: "TIMEOUT" });
      }
      return answer(count, request);
    };
    const failing = { findings: [{ code: "VERBOSITY", severity: "substantive", summary: "synthetic: too long", evidence_turn_ids: [] }], level: "none", repair_induced_checks: [], missed_boxes: [] };
    runner = await makeRunner(t, {
      ...base,
      [role]: crossOnce(base[role]),
      // A message marked [repair] has its first draft stopped, so the repair writer runs.
      C2: (count, request) => (latest(request).includes("[repair]") && !packetOf(request).candidate_reply.startsWith("Synthetic repaired") ? failing : base.C2(count, request))
    });
    await reachPlan(runner);
    await runner.send("[keep] Synthetic: keep it.");
    const keptAt = Date.parse((await runner.store.load(CASE_ID)).runner_kept_plans[0].kept_at);
    runner.clock.now = keptAt + THIRTY_DAYS - 2_000;
    crossAt = keptAt + THIRTY_DAYS + 1_000;
    const start = runner.calls.length;
    const answer = await runner.send(`Synthetic: back again${role === "W-repair" ? " [repair]" : ""}.`, { newConversation: true, resumeConfirmed: true });
    assert.equal(answer.deliveryKind, "candidate", `${role}: the turn is answered`);
    const attempts = runner.calls.slice(start).filter((call) => call.role === role).map((call) => [Boolean(packetOf(call.request).kept_plan), call.request.system.includes(KEPT_PLAN_RULE)]);
    assert.deepEqual(attempts, [[true, true], [false, false]], `${role}: the first attempt, a second before the 30 days, had both; the retry after them has neither`);
  }
});

test("a plan kept while the switch was on is still deleted at its 30 days after the switch is turned off: the page's load deletes it, and its reconcile answers as before", async (t) => {
  const runner = await makeRunner(t, keptPlanScript());
  await reachPlan(runner);
  await runner.send("[keep] Synthetic: keep it.");
  const keptAt = Date.parse((await runner.store.load(CASE_ID)).runner_kept_plans[0].kept_at);
  // The switch turned off: a runtime and controller without it, over the same encrypted store and clock.
  const off = createRunnerTrialRuntime({ privateCaseSource: runner.store, parts, workerFor: fakeWorkers(keptPlanScript()).workerFor, keptPlanEnabled: false, now: () => runner.clock.now });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: runner.store, modelRuntime: off, maximumInvocationAttempts: 1 });
  assert.equal(typeof controller.resumeStatus, "undefined", "nothing of the kept plan's page methods with the switch off");
  runner.clock.now = keptAt + THIRTY_DAYS - 60 * 60 * 1000;
  const before = await controller.reconcile({ caseId: CASE_ID, currentConversation: true });
  assert.equal((await runner.store.load(CASE_ID)).runner_kept_plans[0].deleted_at, null, "an hour before its 30 days, the page's load leaves it");
  runner.clock.now = keptAt + THIRTY_DAYS + 60 * 1000;
  const after = await controller.reconcile({ caseId: CASE_ID, currentConversation: true });
  const [plan] = (await runner.store.load(CASE_ID)).runner_kept_plans;
  assert.deepEqual([plan.lines, plan.deletion_reason, plan.deleted_at], [[], "expired", new Date(runner.clock.now).toISOString()], "the page's load deleted it, with no message sent");
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)), "the reconcile's answer is the same turns, as before");
  assert.deepEqual(after.map((turn) => Object.keys(turn)), before.map(() => ["exchangeId", "userMessage", "answer", "deliveryKind", "closing", "provisional", "emergencyLineShown"]));
});

test("deleted when the person asks: in the conversation, before the writer starts, and with the page's button; the transcript keeps the words, and deleting the case deletes all", async (t) => {
  const runner = await makeRunner(t, keptPlanScript());
  await reachPlan(runner);
  await runner.send("[keep] Synthetic: keep it.");
  const answer = await runner.send("[delete] Synthetic: please delete the plan you kept.");
  assert.ok(answer.runtimeTurn.kept_plan_deleted_at, "the turn says it deleted the kept plan");
  assert.equal(packetOf(runner.requests("W").at(-1)).kept_plan_deleted_on_request, true, "the writer knows none remains");
  let record = await runner.store.load(CASE_ID);
  assert.deepEqual([record.runner_kept_plans[0].lines, record.runner_kept_plans[0].deletion_reason], [[], "asked_in_conversation"]);
  assert.equal(record.raw_transcript.some((entry) => entry.text.includes(PLAN_LINES[1])), true, "the conversation that holds the words stays, as the page says");

  // Kept again, then deleted with the page's button.
  await runner.send("[keep] Synthetic: actually, keep it again.");
  assert.equal((await runner.store.load(CASE_ID)).runner_kept_plans.filter((plan) => plan.deleted_at == null).length, 1);
  assert.deepEqual({ ...(await runner.controller.deleteKeptPlan({ caseId: CASE_ID })) }, { keptPlanRemains: false });
  record = await runner.store.load(CASE_ID);
  assert.deepEqual(record.runner_kept_plans.map((plan) => [plan.lines.length, plan.deletion_reason]), [[0, "asked_in_conversation"], [0, "deleted_on_page"]]);
  assert.deepEqual({ ...(await runner.controller.deleteKeptPlan({ caseId: CASE_ID })) }, { keptPlanRemains: false }, "the same answer when none is left");

  // A newer plan replaces the older one.
  await runner.send("[keep] Synthetic: keep it once more.");
  await runner.send("[keep] Synthetic: and keep it again.");
  record = await runner.store.load(CASE_ID);
  assert.deepEqual(record.runner_kept_plans.map((plan) => plan.deletion_reason), ["asked_in_conversation", "deleted_on_page", "replaced", null]);

  const removed = await runner.store.deletePrivateCase(CASE_ID);
  assert.equal(removed.case_file_removed, true);
  assert.equal(await runner.store.load(CASE_ID), null, "deleting the case deletes the plan with it");
});

// ---- The server --------------------------------------------------------------------------------------------------------------

const trialConfig = (overrides = {}) => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerKeptPlanEnabled: true, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, ...overrides });

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function keptPlanServer(t, { keptPlan = true } = {}) {
  const root = await tempDir(t, "kept-plan-server");
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 63), recoverySecretBytes: Buffer.alloc(32, 64), developmentExternalCredentialAuthorized: true });
  const config = trialConfig({ runnerKeptPlanEnabled: keptPlan });
  const workers = fakeWorkers(keptPlanScript());
  const clock = { offset: 0 };
  const trial = createRunnerTrialController({ privateCaseSource: store, config, settings: validateRunnerTrialSettings({}), parts, workerFor: workers.workerFor, now: () => Date.now() + clock.offset });
  const base = await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: trial.controller, runnerTrialEvents: trial.events }));
  const respond = async (exchangeId, userMessage, extra = {}, { stream = false } = {}) => {
    const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers: { "content-type": "application/json", ...(stream ? { accept: "application/x-ndjson" } : {}) }, body: JSON.stringify({ caseId: CASE_ID, exchangeId, userMessage, ...extra }) });
    const text = await response.text();
    return stream ? text.trim().split("\n").map((line) => JSON.parse(line)).at(-1) : JSON.parse(text);
  };
  const ownerPost = async (route, body, headers = {}) => {
    const sent = Object.fromEntries(Object.entries({ "content-type": "application/json", origin: base, ...headers }).filter(([, value]) => value != null));
    const response = await fetch(`${base}${route}`, { method: "POST", headers: sent, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  return { store, base, clock, respond, ownerPost, calls: workers.calls };
}

test("/health says runnerKeptPlan on only with the trial and the kept plan both on; a controller without the kept plan's methods stops startup", async (t) => {
  const health = async (config, extra = {}) => (await (await fetch(`${await listen(t, createInnerSignalServer({ config, providers: createProviders(config), ...extra }))}/health`)).json()).runnerKeptPlan;
  const root = await tempDir(t, "kept-plan-health");
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 65), recoverySecretBytes: Buffer.alloc(32, 66), developmentExternalCredentialAuthorized: true });
  assert.equal(await health(trialConfig({ runnerTrialEnabled: false })), "off", "the kept plan means nothing with the trial off");
  assert.equal(await health(trialConfig({ runnerKeptPlanEnabled: false }), { privateCaseStore: store }), "off");
  assert.equal(await health(trialConfig(), { privateCaseStore: store }), "on");
  const config = trialConfig();
  const { events } = createRunnerTrialController({ privateCaseSource: store, config, settings: validateRunnerTrialSettings({}), parts, workerFor: fakeWorkers(keptPlanScript()).workerFor });
  assert.throws(() => createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: { async run() {}, async authorizeTurn() {}, async reconcile() {}, async deleteCase() {} }, runnerTrialEvents: events }), (error) => error.code === "BAD_CONFIG" && /kept plan on needs/u.test(error.message));
  // And the switch has one state: a controller built with it on can't serve a server whose switch is off.
  const keeping = createRunnerTrialController({ privateCaseSource: store, config, settings: validateRunnerTrialSettings({}), parts, workerFor: fakeWorkers(keptPlanScript()).workerFor });
  const offConfig = trialConfig({ runnerKeptPlanEnabled: false });
  assert.throws(() => createInnerSignalServer({ config: offConfig, providers: createProviders(offConfig), privateCaseStore: store, privateTherapyController: keeping.controller, runnerTrialEvents: keeping.events }), (error) => error.code === "BAD_CONFIG" && /kept plan is off/u.test(error.message));
});

test("over the server: the answer says what the turn did with the kept plan, only exactly true is a Yes, and the page's reconcile says when to ask", async (t) => {
  const server = await keptPlanServer(t);
  assert.equal((await server.respond("exchange-1", "[want] Synthetic: I want to die.")).keptPlan, null);
  await server.respond("exchange-2", "[want] [plan] Synthetic: a little safer.");
  const kept = await server.respond("exchange-3", "[keep] Synthetic: keep the plan.", {}, { stream: true });
  assert.deepEqual([kept.type, kept.keptPlan], ["final", "kept"], "the stream's final line says the plan was kept");
  assert.equal(JSON.stringify(kept).includes("lamp on"), false, "never the plan's lines");

  let reconciled = await server.ownerPost("/v1/runner/reconcile", { caseId: CASE_ID, conversation: "current" });
  assert.deepEqual(reconciled.json.resume, { hasConversation: true, nextStartsNewConversation: false });
  server.clock.offset = 13 * 60 * 60 * 1000;
  reconciled = await server.ownerPost("/v1/runner/reconcile", { caseId: CASE_ID, conversation: "current" });
  assert.deepEqual(reconciled.json.resume, { hasConversation: true, nextStartsNewConversation: true }, "after the conversation gap the next message opens a new one");
  server.clock.offset = 0;
  assert.deepEqual((await server.ownerPost("/v1/runner/reconcile", { caseId: "synthetic-kept-plan-empty" })).json.resume, { hasConversation: false, nextStartsNewConversation: false });

  // A string "true" isn't a Yes; exactly true is.
  await server.respond("exchange-4", "Synthetic: hello again.", { newConversation: true, resumeConfirmed: "true" });
  await server.respond("exchange-5", "Synthetic: hello once more.", { newConversation: true, resumeConfirmed: true });
  const record = await server.store.load(CASE_ID);
  assert.deepEqual(record.runtime_turns.slice(-2).map((turn) => turn.runner_reading.readers.resume), [{ confirmed: false }, { confirmed: true }]);
  const writers = server.calls.filter((call) => call.role === "W").slice(-2).map((call) => packetOf(call.request).kept_plan?.lines ?? null);
  assert.deepEqual(writers, [null, PLAN_LINES]);
  assert.equal((await server.respond("exchange-6", "[delete] Synthetic: delete the plan.")).keptPlan, "deleted");
});

test("the page's Delete the kept plan: the owner's page only, confirmed, with the kept plan on; the same answer whether or not one was kept", async (t) => {
  const server = await keptPlanServer(t);
  await server.respond("exchange-1", "[want] Synthetic: I want to die.");
  await server.respond("exchange-2", "[want] [plan] Synthetic: a little safer.");
  await server.respond("exchange-3", "[keep] Synthetic: keep the plan.");
  const route = "/v1/runner/kept-plan/delete";
  assert.equal((await server.ownerPost(route, { caseId: CASE_ID, confirmed: true }, { origin: null })).status, 403, "no Origin");
  assert.equal((await server.ownerPost(route, { caseId: CASE_ID, confirmed: true }, { origin: "http://evil.example" })).status, 403, "another Origin");
  assert.equal((await server.ownerPost(route, { caseId: CASE_ID, confirmed: true }, { authorization: "Bearer synthetic-agent-token" })).status, 403, "an agent's token");
  assert.equal((await server.ownerPost(route, { caseId: CASE_ID })).status, 400, "not confirmed");
  assert.equal((await server.ownerPost(route, { caseId: CASE_ID, confirmed: "yes" })).status, 400);
  assert.equal((await server.store.load(CASE_ID)).runner_kept_plans[0].deleted_at, null, "nothing deleted by a refused request");
  const deleted = await server.ownerPost(route, { caseId: CASE_ID, confirmed: true });
  assert.deepEqual([deleted.status, deleted.json], [200, { caseId: CASE_ID, keptPlanRemains: false }]);
  assert.deepEqual((await server.store.load(CASE_ID)).runner_kept_plans.map((plan) => [plan.lines, plan.deletion_reason]), [[[], "deleted_on_page"]]);
  assert.deepEqual((await server.ownerPost(route, { caseId: CASE_ID, confirmed: true })).json, { caseId: CASE_ID, keptPlanRemains: false }, "the same answer with none left");
  assert.equal((await server.ownerPost(route, { caseId: "synthetic-kept-plan-none", confirmed: true })).status, 200);
  assert.equal(await server.store.load("synthetic-kept-plan-none"), null, "a case without a file stays without one");
});

test("with the trial on and the kept plan off, the server is as before: no keptPlan in answers, no resume in the reconcile, no deletion route", async (t) => {
  const server = await keptPlanServer(t, { keptPlan: false });
  const answer = await server.respond("exchange-1", "[keep] Synthetic: keep the plan.", { resumeConfirmed: true });
  assert.equal(Object.hasOwn(answer, "keptPlan"), false);
  assert.deepEqual(Object.keys(answer).slice(-2), ["provisional", "emergencyLineShown"]);
  const reconciled = await server.ownerPost("/v1/runner/reconcile", { caseId: CASE_ID, conversation: "current" });
  assert.deepEqual(Object.keys(reconciled.json), ["caseId", "turns"]);
  assert.equal((await server.ownerPost("/v1/runner/kept-plan/delete", { caseId: CASE_ID, confirmed: true })).status, 404);
  assert.equal((await (await fetch(`${server.base}/health`)).json()).runnerKeptPlan, "off");
});

// ---- The page ----------------------------------------------------------------------------------------------------------------

async function pageSource() {
  const [html, app] = await Promise.all(["apps/web/index.html", "apps/web/app.js"].map((relative) => fs.readFile(path.join(repositoryRoot, relative), "utf8")));
  return { html, app };
}
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `the page has ${start}`);
  return text.slice(from, to);
};

test("the page's kept-plan words are byte-identical to the server's, its parts are hidden until /health says on, and it never sets text as HTML", async () => {
  const { html, app } = await pageSource();
  const block = between(app, "// runner-trial-page:start", "// runner-trial-page:end");
  const page = vm.runInNewContext(`${block}\n;({ RESUME_QUESTION, RESUME_YES, RESUME_FRESH, KEPT_PLAN_DELETE_NOTE, KEPT_PLAN_KEPT_LINE, KEPT_PLAN_GONE_LINE, keptPlanStatusText, runnerAsksResumeOnLoad, runnerResumeField })`, { TextDecoder });
  const words = { RESUME_QUESTION, RESUME_YES, RESUME_FRESH, KEPT_PLAN_DELETE_NOTE, KEPT_PLAN_KEPT_LINE, KEPT_PLAN_GONE_LINE };
  for (const [name, value] of Object.entries(words)) assert.ok(Buffer.from(page[name], "utf8").equals(Buffer.from(value, "utf8")), name);
  assert.equal(KEPT_PLAN_DELETE_NOTE, "This removes the kept plan. Its words are still in the stored conversation, which can't be edited; deleting them too means deleting the case.");
  assert.deepEqual([page.keptPlanStatusText("kept"), page.keptPlanStatusText("deleted"), page.keptPlanStatusText(null), page.keptPlanStatusText("constructor")], [KEPT_PLAN_KEPT_LINE, KEPT_PLAN_GONE_LINE, "", ""]);
  assert.equal(page.runnerAsksResumeOnLoad({ hasConversation: true, nextStartsNewConversation: true }), true);
  for (const resume of [undefined, { hasConversation: true, nextStartsNewConversation: false }, { hasConversation: false, nextStartsNewConversation: true }, { hasConversation: "true", nextStartsNewConversation: true }]) {
    assert.equal(page.runnerAsksResumeOnLoad(resume), false, JSON.stringify(resume));
  }
  assert.deepEqual(JSON.parse(JSON.stringify([page.runnerResumeField(true, true), page.runnerResumeField(true, false), page.runnerResumeField(true, null), page.runnerResumeField(false, true)])), [{ resumeConfirmed: true }, { resumeConfirmed: false }, {}, {}]);
  for (const id of ["runner-resume", "runner-delete-kept-plan", "runner-kept-plan-status"]) assert.match(html, new RegExp(`<[a-z]+ id="${id}"[^>]*\\shidden[\\s>]`, "u"), `${id} is hidden by default`);
  const form = between(html, '<form id="therapy-form"', "</form>");
  assert.ok(form.indexOf('id="runner-resume"') < form.indexOf('id="therapy-message"'), "the question comes before the message box");
  assert.match(app, /applyRunnerKeptPlan\(health\.runnerKeptPlan === "on"\)/u);
  const trialCode = app.slice(app.indexOf("// ---- Runner trial"), app.indexOf("function loadState()"));
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/u.test(trialCode), false);
});

test("on the page: a new conversation asks Pick up where we left off? when an earlier one exists, sends the answer with the next message, and Delete the kept plan confirms first", async (t) => {
  const { html, app } = await pageSource();
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const state = { caseId: "case-synthetic-page", therapy: [] };
  const fetched = [];
  const confirmed = [];
  let answerConfirm = false;
  const context = vm.createContext({
    TextDecoder,
    Date,
    document,
    state,
    $: (selector) => document.querySelector(selector),
    renderTherapy: () => {},
    setBusy: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    confirm: (words) => { confirmed.push(words); return answerConfirm; },
    alert: (words) => { throw new Error(`unexpected alert: ${words}`); },
    fetch: async (url, init) => { fetched.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ caseId: state.caseId, keptPlanRemains: false }) }; }
  });
  const block = between(app, "// runner-trial-page:start", "// runner-trial-page:end");
  const runnerState = between(app, "// `keptPlanOn`: the plan kept for next time is on", "const RUNNER_RECONCILE_LABEL");
  const functions = between(app, "function syncRunnerNewConversation()", "// When the page loads with the trial on (design, section 8)");
  const turn = between(app, "// One trial turn on the page", "async function postRunnerTurn");
  const listeners = between(app, '$("#runner-new-conversation").addEventListener', "// After \"Delete this case\" succeeded");
  vm.runInContext(`${block}\n${runnerState.replace("const runnerTrial", "var runnerTrial")}\n${functions}\n${turn}\n${listeners}`, context);
  const hidden = (selector) => document.querySelector(selector).hidden;

  vm.runInContext("applyRunnerTrial(true); applyRunnerKeptPlan(false);", context);
  assert.deepEqual([hidden("#runner-delete-kept-plan"), hidden("#runner-resume")], [true, true], "the kept plan off: nothing of it shows");
  document.querySelector("#runner-new-conversation").click();
  assert.equal(hidden("#runner-resume"), true);
  vm.runInContext("runnerTrial.newConversation = false; applyRunnerKeptPlan(true); runnerTrial.hasConversation = true;", context);
  assert.equal(hidden("#runner-delete-kept-plan"), false);
  assert.deepEqual(["#runner-resume-question", "#runner-resume-yes", "#runner-resume-fresh"].map((selector) => document.querySelector(selector).textContent), [RESUME_QUESTION, RESUME_YES, RESUME_FRESH]);

  // New conversation with an earlier one: the question shows, unanswered; Yes goes with the next message, and the question goes.
  document.querySelector("#runner-new-conversation").click();
  assert.equal(hidden("#runner-resume"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("beginRunnerTurn('exchange-unanswered').resume", context))), {}, "an unanswered question sends nothing");
  assert.equal(hidden("#runner-resume"), true);
  vm.runInContext("runnerTrial.newConversation = false;", context);
  document.querySelector("#runner-new-conversation").click();
  document.querySelector("#runner-resume-yes").click();
  assert.equal(document.querySelector("#runner-resume-yes").getAttribute("aria-pressed"), "true");
  document.querySelector("#runner-resume-fresh").click();
  assert.deepEqual(["#runner-resume-yes", "#runner-resume-fresh"].map((selector) => document.querySelector(selector).getAttribute("aria-pressed")), ["false", "true"]);
  document.querySelector("#runner-resume-yes").click();
  vm.runInContext("showRunnerResume(true)", context);
  assert.equal(document.querySelector("#runner-resume-yes").getAttribute("aria-pressed"), "true", "asked again while shown, the answer given stays");
  const begun = vm.runInContext("beginRunnerTurn('exchange-yes')", context);
  assert.deepEqual(JSON.parse(JSON.stringify([begun.newConversation, begun.resume])), [true, { resumeConfirmed: true }]);
  assert.equal(hidden("#runner-resume"), true);

  // Delete the kept plan: the plain words first; cancelled, nothing is sent; confirmed, the page says none remains.
  document.querySelector("#runner-delete-kept-plan").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([confirmed, fetched], [[KEPT_PLAN_DELETE_NOTE], []]);
  answerConfirm = true;
  document.querySelector("#runner-delete-kept-plan").click();
  for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(fetched, [["/v1/runner/kept-plan/delete", { caseId: "case-synthetic-page", confirmed: true }]]);
  assert.deepEqual([document.querySelector("#runner-kept-plan-status").textContent, hidden("#runner-kept-plan-status")], [KEPT_PLAN_GONE_LINE, false]);
  assert.match(app, /setRunnerKeptPlanStatus\(keptPlanStatusText\(result\.keptPlan\)\)/u, "a turn's answer sets the line");
  assert.match(app, /\.\.\.\(runnerTurn\?\.resume \?\? \{\}\)/u, "the answer goes with the message");
});
