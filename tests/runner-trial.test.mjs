import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";
import { cutRuleParts, focusedRules, wholeRules } from "../src/runner-trial/rule-parts.mjs";
import { CRISIS_LINKS, NAMED_EMERGENCY_NUMBERS, emergencyNumbersIn, phoneLikeRuns, provisionalProblems, runProgramChecks, shapeProblems } from "../src/runner-trial/program-checks.mjs";
import { createRunnerTrialRuntime, riskVariablesFrom } from "../src/runner-trial/runtime.mjs";
import { EMERGENCY_LINE, RUNNER_UNAVAILABLE_NOTICE } from "../src/runner-trial/notices.mjs";

// The runner trial (docs/superpowers/specs/2026-11-21-runner-trial-design.md) with stand-in workers, through the real encrypted
// store and the real turn controller. Every conversation is synthetic. These tests show the program around the models; they say
// nothing about how real models read or write.

const protocol = loadTherapyProtocol({ boxGuidance: true });
const parts = cutRuleParts(protocol);
const CASE_ID = "synthetic-runner-case";

test("the rule parts are cut from the served protocol, and the focused set leaves out only the boxes not in play", () => {
  assert.match(parts.crisis.text, /^## When someone may want to die\n/u);
  assert.match(parts.crisis.text, /## Chronic pain care navigation and prior medical harm/u);
  assert.match(parts.crisis.text, /When someone says they are about to take something,/u);
  assert.ok(!parts.crisis.text.includes("## A parent asking about a real child"), "the crisis part stops at the next section");
  assert.equal(Object.keys(parts.boxes).length, 70, "46 inner-child boxes and 24 cross-guide routes");
  for (const link of CRISIS_LINKS) assert.ok(parts.crisis.text.includes(link), `${link} is still in the served crisis section`);
  for (const number of NAMED_EMERGENCY_NUMBERS) assert.ok(parts.crisis.text.includes(number), `${number} is still named by the served crisis section`);
  const focused = focusedRules(parts, ["IC.SAFETY_ORIENTATION", "ROUTE.MEDICAL_RED_FLAG"]);
  assert.ok(focused.text.includes("### IC.SAFETY_ORIENTATION:"));
  assert.ok(focused.text.includes("### ROUTE.MEDICAL_RED_FLAG:"));
  assert.ok(!focused.text.includes("### IC.SOLAR_PLEXUS_RELAXATION:"), "an unpicked box's advice is left out");
  assert.ok(focused.text.includes(parts.skill.text) && focused.text.includes(parts.map.text), "SKILL.md and the map always");
  for (const reference of Object.values(parts.references)) assert.ok(focused.text.includes(reference.text), `${reference.label} always`);
  assert.match(focused.text, /^RUNNER NOTE\./u);
  assert.ok(wholeRules(parts).text.includes(parts.whole.text));
  assert.ok(focused.text.length < wholeRules(parts).text.length / 2, "the focused set is well under half the whole protocol");
});

test("the exact checks read numbers in any script and decide only exact things", () => {
  assert.deepEqual(emergencyNumbersIn("Call 112 now."), ["112"]);
  assert.deepEqual(emergencyNumbersIn("اتصل ب١١٢ الآن"), ["112"], "Arabic-Indic digits");
  assert.deepEqual(emergencyNumbersIn("call १११"), ["111"], "Devanagari digits");
  assert.deepEqual(emergencyNumbersIn("I took 1120 mg"), [], "a number inside a longer one is not an emergency number");
  assert.deepEqual(emergencyNumbersIn("appelle le 15"), [], "two-digit numbers are left out");
  assert.ok(phoneLikeRuns("ring 0800 123 456").includes("0800123456"));
  assert.deepEqual(provisionalProblems("I'm here. Please call 112 now, and unlock the door if you can."), []);
  assert.ok(provisionalProblems("I'm here with you. Please get help now.").includes("no_emergency_number"));
  assert.ok(provisionalProblems("Call 112 or the poison line 0800 555 0100 now.").includes("unknown_number"), "an invented number is caught");
  assert.ok(provisionalProblems("Call 112. Are you alone? Is the door open?").includes("more_than_one_question"));
  assert.ok(provisionalProblems("- Call 112\n- Unlock the door").includes("list"));
  assert.ok(provisionalProblems("Call 112 now. https://detox.u-dont-exist.com").includes("link_not_allowed"));
  assert.deepEqual(shapeProblems(`See ${CRISIS_LINKS[1]} or ${CRISIS_LINKS[0]}`), [], "the allowed links don't read as emphasis");
  const findings = runProgramChecks({ reply: "Read https://detox.u-dont-exist.com and do a detox.", crisisConversation: true, checkerLevel: "wants_to_die" });
  assert.deepEqual(findings.map((finding) => finding.code).sort(), ["PROGRAM_DETOX_WORD", "PROGRAM_OWNER_LINK_NOT_ALLOWED"]);
  assert.deepEqual(runProgramChecks({ reply: "A health service: https://www.has-sante.fr", crisisConversation: true, checkerLevel: "wants_to_die" }), [], "other sites are the crisis checker's");
  const overreaction = runProgramChecks({ reply: "If it gets worse, call 988.", checkerLevel: "thoughts_no_intent" });
  assert.equal(overreaction[0].code, "PROGRAM_NUMBER_WITHOUT_CRISIS");
  assert.equal(overreaction[0].severity, "medium", "over-reaction is recorded, never blocking");
  const firstActed = runProgramChecks({ reply: "Stay with me; is anyone near you?", checkerLevel: "acted_or_about_to", firstActedTurn: true, provisional: "Please call 112 now." });
  assert.deepEqual(firstActed, [], "the provisional's number counts on the first acted turn");
  const noNumber = runProgramChecks({ reply: "Stay with me; is anyone near you?", checkerLevel: "acted_or_about_to", firstActedTurn: true });
  assert.equal(noNumber[0].code, "PROGRAM_NO_EMERGENCY_NUMBER");
});

test("the risk record's words are derived from the crisis reading by program", () => {
  assert.deepEqual(riskVariablesFrom({ level: "acted_or_about_to" }), { suicidal_state: "imminent", suicidal_ideation_context: "other_or_unclear" });
  assert.deepEqual(riskVariablesFrom({ level: "wants_to_die", wish_or_intent: "wish" }), { suicidal_state: "ideation", suicidal_ideation_context: "other_or_unclear" });
  assert.deepEqual(riskVariablesFrom({ level: "wants_to_die", wish_or_intent: "intent" }), { suicidal_state: "intent", suicidal_ideation_context: "other_or_unclear" });
  assert.deepEqual(riskVariablesFrom({ level: "thoughts_no_intent", pain_linked: true }), { suicidal_state: "ideation", suicidal_ideation_context: "pain_episode" });
  assert.deepEqual(riskVariablesFrom({ level: "none" }), { suicidal_state: "absent", suicidal_ideation_context: "not_in_play" });
  assert.deepEqual(riskVariablesFrom(null), { suicidal_state: "unknown", suicidal_ideation_context: "unknown" });
});

// A scripted stand-in for every worker. `script[role]` is a function (call number, request) -> value, or throws.
function fakeWorkers(script) {
  const calls = [];
  let session = 0;
  const workerFor = (role) => ({
    async call(request) {
      const count = calls.filter((entry) => entry.role === role).length + 1;
      calls.push({ role, request });
      const value = await script[role](count, request);
      session += 1;
      return { value, receipt: { provider: "fake", model: "fake", session_id: `fake-${role}-${session}` } };
    }
  });
  return { workerFor, calls };
}

const quietReader = () => ({ level: "none", wish_or_intent: "not_applicable", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: "nothing of the kind", provisional_reply: null });
const passing = () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] });
const baseScript = (overrides = {}) => ({
  R1: quietReader,
  R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION", "NOT.A.BOX"] }),
  R3: () => ({ compatibility_assessment: null }),
  W: () => ({ reply: "A synthetic reply.", answered_level: "none", quotes: [] }),
  "W-repair": (count) => ({ reply: `A repaired synthetic reply ${count}.`, answered_level: "none", quotes: [] }),
  C1: passing, C2: passing, C3: passing, C4: passing,
  C5: () => ({ findings: [], level: "none", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] }),
  CW: passing,
  ...overrides
});

async function makeRunner(t, script, { settings = {}, ownerFallbackEnabled = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runner-trial-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 81), recoverySecretBytes: Buffer.alloc(32, 82), developmentExternalCredentialAuthorized: true });
  await store.loadOrCreate(CASE_ID);
  const events = [];
  const workers = fakeWorkers(script);
  const runtime = createRunnerTrialRuntime({ privateCaseSource: store, parts, settings, workerFor: workers.workerFor, ownerFallbackEnabled, onEvent: (turnId, event) => events.push({ turnId, ...event }) });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: runtime, maximumInvocationAttempts: 1 });
  let exchange = 0;
  const send = (text, userInput = {}) => {
    exchange += 1;
    return controller.run({ caseId: CASE_ID, runtimeTurnId: `runtime:exchange-${exchange}`, exchangeId: `exchange-${exchange}`, userTurnId: `exchange-${exchange}-user`, assistantTurnId: `exchange-${exchange}-assistant`, userMessage: text, userInput });
  };
  return { store, controller, runtime, events, calls: workers.calls, send };
}

test("an ordinary turn: three readers at once, the focused writer with the picked box, four checkers, the exact reply delivered", async (t) => {
  const runner = await makeRunner(t, baseScript());
  const result = await runner.send("Something synthetic and ordinary.");
  assert.equal(result.answer, "A synthetic reply.");
  assert.equal(result.deliveryKind, "candidate");
  assert.deepEqual(runner.calls.map((call) => call.role).sort(), ["C1", "C2", "C3", "C4", "R1", "R2", "R3", "W"]);
  const writer = runner.calls.find((call) => call.role === "W").request;
  assert.ok(writer.system.includes("### IC.SAFETY_ORIENTATION:"), "the picked box is in the writer's rules");
  assert.ok(!writer.system.includes("### IC.SOLAR_PLEXUS_RELAXATION:"), "an unpicked box isn't");
  assert.ok(!writer.user.includes("NOT.A.BOX"), "an unknown pick is dropped by program");
  const reader = runner.calls.find((call) => call.role === "R1").request;
  assert.ok(!/self_directed_risk|stored_risk_record|trajectory/u.test(reader.user), "the crisis reader gets no stored record (D1)");
  assert.ok(runner.calls.find((call) => call.role === "C1").request.user.includes("stored_risk_record"), "the crisis checker does");
  const record = await runner.store.load(CASE_ID);
  const turn = record.runtime_turns[0];
  assert.equal(turn.state, "DELIVERED");
  assert.ok(turn.runner_reading.conversation_id.startsWith("conversation:"));
  assert.deepEqual(Object.keys(turn.runner_reading.readers).sort(), ["boxes", "crisis", "protection"]);
  assert.equal(record.case_state.intervention_history.length, 1, "one history item per turn");
  assert.match(record.case_state.intervention_history[0].statement, /RUNNER\.CONVERSATION/u);
  assert.equal(record.case_state.self_directed_risk ?? null, null, "a quiet turn makes no risk record");
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user", "assistant"]);
});

test("someone who has acted: the provisional reply shows first, then the full checked reply; the first acted turn's number check covers both", async (t) => {
  const acted = () => ({ ...quietReader(), level: "acted_or_about_to", reason: "says they took pills", provisional_reply: "I'm here with you. Please call your local emergency number now: 112 in the EU, 911 in the US, 999 in the UK." });
  const runner = await makeRunner(t, baseScript({
    R1: acted,
    W: () => ({ reply: "Is someone in the house who could sit with you while you call?", answered_level: "acted_or_about_to", quotes: [] }),
    C1: () => ({ findings: [], level: "acted_or_about_to", repair_induced_checks: [], missed_boxes: [] })
  }));
  const result = await runner.send("I took all my pills an hour ago.");
  assert.equal(result.deliveryKind, "candidate");
  const provisional = runner.events.find((event) => event.type === "provisional");
  assert.ok(provisional, "the provisional reply was sent to the page");
  assert.ok(runner.events.indexOf(provisional) < runner.events.findIndex((event) => event.step === "writing"), "before the writer started");
  const writer = runner.calls.find((call) => call.role === "W").request;
  assert.ok(writer.user.includes("provisional_reply_shown"), "the writer continues from it");
  const record = await runner.store.load(CASE_ID);
  assert.equal(record.runtime_turns[0].provisional.exact_text, provisional.text);
  assert.equal(record.case_state.self_directed_risk.current.level, "imminent");
  assert.match(record.case_state.intervention_history[0].statement, /RUNNER\.ACTED_OR_ABOUT_TO/u);
  // A later turn's packet shows the provisional reply in its place.
  await runner.send("Still here.");
  const nextWriter = runner.calls.filter((call) => call.role === "W")[1].request;
  assert.ok(nextWriter.user.includes("provisional reply"), "later packets show it");
});

test("a provisional reply that fails its exact checks isn't shown, and the approved emergency line goes into the conversation", async (t) => {
  const runner = await makeRunner(t, baseScript({
    R1: () => ({ ...quietReader(), level: "acted_or_about_to", reason: "took something", provisional_reply: "Please get help now, call 0800 555 0100." }),
    W: () => ({ reply: "Please call 112 now. Is anyone near you?", answered_level: "acted_or_about_to", quotes: [] }),
    C1: () => ({ findings: [], level: "acted_or_about_to", repair_induced_checks: [], missed_boxes: [] })
  }));
  await runner.send("I swallowed a lot of tablets.");
  assert.equal(runner.events.filter((event) => event.type === "provisional").length, 0);
  assert.ok(runner.events.some((event) => event.type === "emergency_line"));
  const record = await runner.store.load(CASE_ID);
  assert.ok(record.runtime_turns[0].emergency_line_shown_at);
  assert.deepEqual(record.runtime_turns[0].runner_reading.readers.provisional_refused.problems, ["no_emergency_number", "unknown_number"]);
  assert.match(EMERGENCY_LINE, /^In danger right now\? Call your local emergency number: 112/u);
});

test("a blocking finding sends the draft to repair; the repaired version is checked again, the eleven repair checks included", async (t) => {
  const runner = await makeRunner(t, baseScript({
    C2: (count) => count === 1 ? { findings: [{ code: "VERBOSITY", severity: "substantive", summary: "too long", evidence_turn_ids: [] }], level: "none", repair_induced_checks: [], missed_boxes: [] } : passing()
  }));
  const result = await runner.send("Something synthetic.");
  assert.equal(result.answer, "A repaired synthetic reply 1.");
  assert.equal(runner.calls.filter((call) => call.role === "C5").length, 1, "the repair comparer read the repaired version");
  const repair = runner.calls.find((call) => call.role === "W-repair").request;
  assert.ok(repair.user.includes("VERBOSITY") && repair.user.includes("previous_candidate"));
});

test("checks that keep failing close the turn: the notice, or the owner's fixed message in a crisis conversation when it is switched on", async (t) => {
  const failing = () => ({ findings: [{ code: "CRISIS_FIRST_REPLY_SHAPE", severity: "high", summary: "missing", evidence_turn_ids: [] }], level: "wants_to_die", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] });
  const wants = () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "says they want to die" });
  const off = await makeRunner(t, baseScript({ R1: wants, C1: failing, C5: failing }));
  const closedOff = await off.send("I want to die.");
  assert.equal(closedOff.answer, RUNNER_UNAVAILABLE_NOTICE);
  assert.equal(closedOff.closing.reason_code, "checks_failed");
  const on = await makeRunner(t, baseScript({ R1: wants, C1: failing, C5: failing }), { ownerFallbackEnabled: true });
  const closedOn = await on.send("I want to die.");
  assert.equal(closedOn.answer, OWNER_FALLBACK_MESSAGE);
  const record = await on.store.load(CASE_ID);
  assert.equal(record.runtime_turns[0].state, "UNANSWERED");
  assert.equal(record.raw_transcript.at(-1).text, OWNER_FALLBACK_MESSAGE, "the record holds what the person saw");
  // Not a crisis conversation: the notice even with the switch on.
  const quiet = await makeRunner(t, baseScript({ C2: () => ({ findings: [{ code: "X_FAIL", severity: "high", summary: "x", evidence_turn_ids: [] }], level: "none", repair_induced_checks: [], missed_boxes: [] }), C5: () => ({ findings: [], level: "none", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] }) }), { ownerFallbackEnabled: true });
  assert.equal((await quiet.send("Something synthetic.")).answer, RUNNER_UNAVAILABLE_NOTICE);
});

test("a plan limit closes the turn with its reason, the reading still feeds the records, and the next message is accepted", async (t) => {
  let limited = true;
  const runner = await makeRunner(t, baseScript({
    R1: () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "wants to die" }),
    W: () => { if (limited) throw Object.assign(new Error("limit"), { code: "PLAN_LIMIT" }); return { reply: "A synthetic reply.", answered_level: "wants_to_die", quotes: [] }; }
  }), { ownerFallbackEnabled: true });
  const closed = await runner.send("I want to die.");
  assert.equal(closed.answer, RUNNER_UNAVAILABLE_NOTICE, "an operational failure gives the notice, not the fixed message");
  assert.equal(closed.closing.reason_code, "plan_limit");
  const record = await runner.store.load(CASE_ID);
  assert.equal(record.case_state.self_directed_risk.current.level, "ideation", "the stored reading fed the risk record at the closing");
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user", "assistant"]);
  limited = false;
  const next = await runner.send("Still here.");
  assert.equal(next.deliveryKind, "candidate", "the case isn't left busy");
});

test("a turn left unfinished is closed before the next message, inside the case's queue", async (t) => {
  const runner = await makeRunner(t, baseScript());
  await runner.store.beginPrivateRuntimeTurn(CASE_ID, { runtimeTurnId: "runtime:stale", exchangeId: "exchange-stale", userTurnId: "exchange-stale-user", exactText: "A message whose turn was interrupted." });
  const result = await runner.send("A new message.");
  assert.equal(result.deliveryKind, "candidate");
  const record = await runner.store.load(CASE_ID);
  const stale = record.runtime_turns.find((turn) => turn.id === "runtime:stale");
  assert.equal(stale.state, "UNANSWERED");
  assert.equal(stale.closure.reason_code, "interrupted");
});

test("the turn's deadline ends a slow turn with the notice, and no repair starts when a round no longer fits", async (t) => {
  let clock = Date.now();
  const runner = await makeRunner(t, baseScript());
  // The runtime's clock moves with the slow writer; the store's stays real.
  const late = createRunnerTrialRuntime({ privateCaseSource: runner.store, parts, settings: { deadlineMs: 60_000 }, workerFor: fakeWorkers(baseScript({ W: () => { clock += 10 * 60 * 1000; return { reply: "A late synthetic reply.", answered_level: "none", quotes: [] }; } })).workerFor, now: () => clock });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: runner.store, modelRuntime: late, maximumInvocationAttempts: 1 });
  const result = await controller.run({ caseId: CASE_ID, runtimeTurnId: "runtime:slow", exchangeId: "exchange-slow", userTurnId: "exchange-slow-user", assistantTurnId: "exchange-slow-assistant", userMessage: "Something synthetic.", userInput: {} });
  assert.equal(result.answer, RUNNER_UNAVAILABLE_NOTICE);
  assert.equal(result.closing.reason_code, "timeout");
});

test("a repair that returns the same reply ends the turn as a failed check, so a crisis conversation gets the owner's fixed message when it is on", async (t) => {
  const failing = () => ({ findings: [{ code: "CRISIS_FIRST_REPLY_SHAPE", severity: "high", summary: "missing", evidence_turn_ids: [] }], level: "wants_to_die", repair_induced_checks: [], missed_boxes: [] });
  const runner = await makeRunner(t, baseScript({
    R1: () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "wants to die" }),
    W: () => ({ reply: "The same synthetic reply.", answered_level: "wants_to_die", quotes: [] }),
    "W-repair": () => ({ reply: "The same synthetic reply.", answered_level: "wants_to_die", quotes: [] }),
    C1: failing
  }), { ownerFallbackEnabled: true });
  const closed = await runner.send("I want to die.");
  assert.equal(closed.closing.reason_code, "checks_failed");
  assert.equal(closed.answer, OWNER_FALLBACK_MESSAGE);
});
