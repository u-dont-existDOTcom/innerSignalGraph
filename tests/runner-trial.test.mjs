import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { listPrivateArtifactLocatorsForCase } from "../src/storage/private-artifact-locator.mjs";
import { listPrivateCaseAliasLocatorsForCase, writePrivateCaseAliasLocator } from "../src/storage/private-case-alias-locator.mjs";
import { privateJournalCorpusDirectory } from "../src/storage/private-journal-corpus.mjs";
import { createCaseMutationCoordinator } from "../src/storage/shared-case-coordinator.mjs";
import { childContactPatternHits } from "../src/case-formulation/protective-compatibility.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS, isSubstantiveAuditFinding } from "../src/supervisor/private-candidate-lifecycle.mjs";
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
  assert.deepEqual(provisionalProblems("Call 112 now, or call the poison service at 12345."), ["unknown_number"], "a five-digit number off the list is caught");
  assert.deepEqual(provisionalProblems("Call 112 now, or the line at ١٢٣٤٥."), ["unknown_number"], "in any script");
  // Every run of two or more digits must be an emergency number: an invented two-digit number is caught too.
  assert.deepEqual(provisionalProblems("Call 112 now, or the poison service at 42."), ["unknown_number"], "a two-digit number off the list is caught");
  assert.deepEqual(provisionalProblems("Call 112 now, or the poison service at ٤٢."), ["unknown_number"], "a two-digit number in another script too");
  assert.deepEqual(provisionalProblems("Call 112 now. I'll stay here with you for the next 10 minutes."), ["unknown_number"], "a two-digit count is read as a number: the provisional isn't shown");
  assert.deepEqual(provisionalProblems("Call 112 now. I'll stay here with you for the next 5 minutes."), [], "a single digit isn't read as a number");
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
  // The child-contact patterns can't tell a refusal from an invitation: a hit is recorded, never blocking by itself.
  const refusal = "Do not contact your inner child.";
  const hits = childContactPatternHits(refusal);
  assert.deepEqual(hits, [{ pattern: "CHILD_CONTACT_PATTERN_1", text: "contact your inner child" }]);
  const pattern = runProgramChecks({ reply: refusal, childContactPatternHits: hits });
  assert.deepEqual(pattern.map((finding) => [finding.code, finding.severity]), [["PROGRAM_CHILD_CONTACT_PATTERN", "medium"]]);
  assert.equal(pattern.some(isSubstantiveAuditFinding), false, "it never blocks by itself");
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
  const runtime = createRunnerTrialRuntime({ privateCaseSource: store, parts, settings, workerFor: workers.workerFor, ownerFallbackEnabled, onEvent: (caseId, turnId, event) => events.push({ caseId, turnId, ...event }) });
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

test("a failed audit with less than one round left starts no repair: the turn closes as a failed check", async (t) => {
  const runner = await makeRunner(t, baseScript());
  // The runtime's clock moves with the writer, which leaves 50 s of the 300 s turn: enough for the checkers, less than the
  // 100 s a writer-and-checker round needs. The store's clock stays real.
  let clock = Date.now();
  const workers = fakeWorkers(baseScript({
    W: () => { clock += 250_000; return { reply: "A synthetic reply that the checks stop.", answered_level: "none", quotes: [] }; },
    C2: () => ({ findings: [{ code: "VERBOSITY", severity: "substantive", summary: "too long", evidence_turn_ids: [] }], level: "none", repair_induced_checks: [], missed_boxes: [] })
  }));
  const late = createRunnerTrialRuntime({ privateCaseSource: runner.store, parts, settings: { deadlineMs: 300_000, roundMs: 100_000 }, workerFor: workers.workerFor, now: () => clock });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: runner.store, modelRuntime: late, maximumInvocationAttempts: 1 });
  const result = await controller.run({ caseId: CASE_ID, runtimeTurnId: "runtime:late", exchangeId: "exchange-late", userTurnId: "exchange-late-user", assistantTurnId: "exchange-late-assistant", userMessage: "Something synthetic.", userInput: {} });
  assert.deepEqual(["C1", "C2", "C3", "C4"].map((role) => workers.calls.filter((call) => call.role === role).length), [1, 1, 1, 1], "the audit ran and failed");
  assert.equal(workers.calls.filter((call) => call.role === "W-repair").length, 0, "no repair was started");
  assert.equal(result.answer, RUNNER_UNAVAILABLE_NOTICE);
  assert.equal(result.closing.reason_code, "checks_failed");
  const turn = (await runner.store.load(CASE_ID)).runtime_turns.find((entry) => entry.id === "runtime:late");
  assert.equal(turn.state, "UNANSWERED");
  assert.equal(turn.events.some((event) => event.stage === "repair"), false);

  // A writer that overruns the whole deadline ends the turn as a timeout instead.
  let slowClock = Date.now();
  const slow = createRunnerTrialRuntime({ privateCaseSource: runner.store, parts, settings: { deadlineMs: 60_000 }, workerFor: fakeWorkers(baseScript({ W: () => { slowClock += 10 * 60 * 1000; return { reply: "A late synthetic reply.", answered_level: "none", quotes: [] }; } })).workerFor, now: () => slowClock });
  const slowController = createPrivateTherapyTurnController({ privateCaseSource: runner.store, modelRuntime: slow, maximumInvocationAttempts: 1 });
  const timedOut = await slowController.run({ caseId: CASE_ID, runtimeTurnId: "runtime:slow", exchangeId: "exchange-slow", userTurnId: "exchange-slow-user", assistantTurnId: "exchange-slow-assistant", userMessage: "Something synthetic.", userInput: {} });
  assert.equal(timedOut.closing.reason_code, "timeout");
});

test("a checker that gives no reading can't take away the crisis checker's: the emergency line shows, and the level is kept for the closing and later turns", async (t) => {
  const runner = await makeRunner(t, baseScript({
    C1: (count) => ({ findings: [], level: count === 1 ? "acted_or_about_to" : "none", repair_induced_checks: [], missed_boxes: [] }),
    C2: (count) => { if (count === 1) throw Object.assign(new Error("synthetic"), { code: "PROVIDER_FAILED" }); return passing(); }
  }));
  const closed = await runner.send("Something synthetic the crisis reader read as nothing.");
  assert.equal(closed.answer, RUNNER_UNAVAILABLE_NOTICE, "no reading from one checker is never a pass");
  assert.equal(closed.closing.reason_code, "provider_failed");
  const lines = runner.events.filter((event) => event.type === "emergency_line");
  assert.deepEqual(lines.map((event) => event.reason), ["checker_read_acted"], "shown once, as soon as the crisis checker read it");
  assert.ok(runner.events.every((event) => event.caseId === CASE_ID), "every event names its case");
  const record = await runner.store.load(CASE_ID);
  const turn = record.runtime_turns[0];
  assert.ok(turn.emergency_line_shown_at);
  assert.deepEqual(turn.runner_reading.checker_levels.map((entry) => [entry.attempt, entry.checker, entry.level]), [[1, "C1", "acted_or_about_to"]]);
  // The next turn of the conversation is a crisis conversation: the box checker gets the crisis section.
  await runner.send("Still here.");
  const nextBoxChecker = runner.calls.filter((call) => call.role === "C3").at(-1).request;
  assert.ok(nextBoxChecker.system.includes("## When someone may want to die"), "the stored reading made it a crisis conversation");
});

test("the crisis checker's level is stored and acted on the moment it arrives, while another checker is still reading", async (t) => {
  let releaseSkillChecker;
  const skillCheckerHeld = new Promise((resolve) => { releaseSkillChecker = resolve; });
  const runner = await makeRunner(t, baseScript({
    W: () => ({ reply: "Please call 112 now. Is anyone with you?", answered_level: "acted_or_about_to", quotes: [] }),
    C1: () => ({ findings: [], level: "acted_or_about_to", repair_induced_checks: [], missed_boxes: [] }),
    C2: async () => { await skillCheckerHeld; return passing(); }
  }));
  const sending = runner.send("Something synthetic the crisis reader read as nothing.");
  try {
    let line = null;
    for (let waited = 0; waited < 300 && !line; waited += 1) {
      line = runner.events.find((event) => event.type === "emergency_line") ?? null;
      if (!line) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(line, "the emergency line shows while the skill checker is still reading");
    assert.equal(line.reason, "checker_read_acted");
    assert.equal(runner.calls.filter((call) => call.role === "C2").length, 1, "the skill checker was called and hasn't answered");
    const turn = (await runner.store.load(CASE_ID)).runtime_turns[0];
    assert.deepEqual(turn.runner_reading.checker_levels.map((entry) => [entry.checker, entry.level]), [["C1", "acted_or_about_to"]], "the level is stored at once");
    assert.ok(turn.emergency_line_shown_at);
    assert.equal(turn.state, "AUDITING", "the draft is still being checked");
  } finally {
    releaseSkillChecker();
  }
  const result = await sending;
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(runner.events.filter((event) => event.type === "emergency_line").length, 1, "shown once");
  assert.equal((await runner.store.load(CASE_ID)).runtime_turns[0].runner_reading.checker_levels.length, 1, "stored once");
});

test("every audit attempt's crisis level is kept: a repaired draft read as none doesn't erase it, so the fixed-message rule still holds", async (t) => {
  const failing = { findings: [{ code: "VERBOSITY", severity: "substantive", summary: "too long", evidence_turn_ids: [] }], level: "none", repair_induced_checks: [], missed_boxes: [] };
  const runner = await makeRunner(t, baseScript({
    C1: (count) => ({ findings: [], level: count === 1 ? "wants_to_die" : "none", repair_induced_checks: [], missed_boxes: [] }),
    // Turn one: the first draft fails, the repair passes. Turn two: every version fails.
    C2: (count) => (count === 2 ? passing() : failing)
  }), { ownerFallbackEnabled: true });
  const first = await runner.send("Something synthetic.");
  assert.equal(first.answer, "A repaired synthetic reply 1.");
  const record = await runner.store.load(CASE_ID);
  assert.deepEqual(record.runtime_turns[0].runner_reading.checker_levels.map((entry) => entry.level), ["wants_to_die", "none"]);
  const second = await runner.send("Something else synthetic.");
  assert.equal(second.closing.reason_code, "checks_failed");
  assert.equal(second.answer, OWNER_FALLBACK_MESSAGE, "the conversation stays one where someone said they want to die");
});

test("the crisis reader gets one attempt only; the other workers keep their retry", async (t) => {
  const runner = await makeRunner(t, baseScript({
    R1: () => { throw Object.assign(new Error("synthetic"), { code: "TIMEOUT" }); },
    C2: (count) => { if (count === 1) throw Object.assign(new Error("synthetic"), { code: "TIMEOUT" }); return passing(); }
  }));
  const result = await runner.send("Something synthetic.");
  assert.equal(result.deliveryKind, "candidate", "the turn goes on without the crisis reading");
  assert.equal(runner.calls.filter((call) => call.role === "R1").length, 1, "no second crisis reader call");
  assert.equal(runner.calls.filter((call) => call.role === "C2").length, 2, "a checker that timed out is tried again");
  assert.equal((await runner.store.load(CASE_ID)).runtime_turns[0].runner_reading.readers.crisis.unread, true);
});

test("the box checker reads the box advice the writer had", async (t) => {
  const boxesOf = (runner) => {
    const request = runner.calls.find((call) => call.role === "C3").request;
    return { system: request.system, inPlay: JSON.parse(request.user.slice(request.user.indexOf("{"))).boxes_in_play };
  };
  const all = Object.keys(parts.boxes);
  const focused = await makeRunner(t, baseScript());
  await focused.send("Something synthetic.");
  assert.deepEqual(boxesOf(focused).inPlay, ["IC.SAFETY_ORIENTATION"], "the picked box (an unknown pick dropped)");
  assert.ok(!boxesOf(focused).system.includes("### IC.SOLAR_PLEXUS_RELAXATION:"));
  const whole = await makeRunner(t, baseScript(), { settings: { writerMode: "whole" } });
  await whole.send("Something synthetic.");
  assert.deepEqual(boxesOf(whole).inPlay, all, "a whole writer had every box");
  assert.ok(boxesOf(whole).system.includes("### IC.SOLAR_PLEXUS_RELAXATION:") && boxesOf(whole).system.includes("### ROUTE.MEDICAL_RED_FLAG:"));
  const noPicks = await makeRunner(t, baseScript({ R2: () => { throw Object.assign(new Error("synthetic"), { code: "PROVIDER_FAILED" }); } }));
  await noPicks.send("Something synthetic.");
  assert.ok(noPicks.calls.find((call) => call.role === "W").request.system.includes("### IC.SOLAR_PLEXUS_RELAXATION:"), "the writer got the whole box file");
  assert.deepEqual(boxesOf(noPicks).inPlay, all, "and so does the box checker");
});

// A synthetic assessment the protection reader might give: an aim the person's words leave unclear, which holds the gate.
const holdAssessment = (turnId) => ({
  version: 1, issue: "synthetic unclear aim", assessment_basis: "CURRENT_TURN", subject_context: "current_client",
  harm_intent: "materially_unclear", harm_intent_observation_ids: [turnId], help_goal: "unclear", help_goal_text: "unclear",
  help_goal_observation_ids: [], nonharm_choice: "unknown", nonharm_choice_observation_ids: [], identity_inquiry_consent: "unknown",
  identity_inquiry_observation_ids: [], agreed_next_job: "unknown", agreed_next_job_observation_ids: [], prior_restriction: "none",
  prior_restriction_observation_ids: [], correction_observation_ids: [], reentry_status: "not_required", reentry_observation_ids: [],
  human_review_required: false
});

test("while the gate is held, a pattern hit goes to the checkers to judge: a refusal is delivered, and the whole checker gets the gate too", async (t) => {
  const refusal = "Do not contact your inner child for now; let's stay with what you need today.";
  for (const checkerMode of ["split", "whole"]) {
    const runner = await makeRunner(t, baseScript({
      R3: () => ({ compatibility_assessment: holdAssessment("exchange-1-user") }),
      W: () => ({ reply: refusal, answered_level: "none", quotes: [] })
    }), { settings: { checkerMode } });
    const result = await runner.send("Something synthetic about an aim that isn't clear.");
    assert.equal(result.answer, refusal, `${checkerMode}: the checkers passed it, and the pattern alone doesn't block`);
    const role = checkerMode === "split" ? "C3" : "CW";
    const request = runner.calls.find((call) => call.role === role).request;
    const packet = JSON.parse(request.user.slice(request.user.indexOf("{")));
    assert.deepEqual(packet.child_contact_gate, { gate: "HOLD", route: "clarify_intent" }, `${role} gets the stored gate and route`);
    assert.deepEqual(packet.child_contact_pattern_hits, [{ pattern: "CHILD_CONTACT_PATTERN_1", text: "contact your inner child" }]);
    assert.match(request.system, /a hit is not an invitation by itself/u);
    const audit = (await runner.store.load(CASE_ID)).candidate_responses[0].audit_history.at(-1);
    const finding = audit.findings.find((entry) => entry.code === "PROGRAM_CHILD_CONTACT_PATTERN");
    assert.equal(finding.severity, "medium");
    assert.equal(audit.sufficient_for_approval, true);
  }
});

test("deleting a case removes its file, handoffs, journal folders and the files naming it, and nothing of another case", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runner-delete-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 83), recoverySecretBytes: Buffer.alloc(32, 84), developmentExternalCredentialAuthorized: true });
  const runtime = createRunnerTrialRuntime({ privateCaseSource: store, parts, workerFor: fakeWorkers(baseScript()).workerFor });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: runtime, maximumInvocationAttempts: 1 });
  const cases = ["synthetic-delete-a", "synthetic-delete-b"];
  const handoffIds = { "synthetic-delete-a": "handoff:00000000-0000-4000-8000-0000000000a1", "synthetic-delete-b": "handoff:00000000-0000-4000-8000-0000000000b1" };
  for (const caseId of cases) {
    await controller.run({ caseId, runtimeTurnId: "runtime:exchange-1", exchangeId: "exchange-1", userTurnId: "exchange-1-user", assistantTurnId: "exchange-1-assistant", userMessage: "Something synthetic.", userInput: {} });
    await store.createHandoff(caseId, { handoffId: handoffIds[caseId], runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" });
    await writePrivateCaseAliasLocator({ rootDir: root, alias: `${caseId} alias`, caseId });
    await store.createJournalCorpus(caseId, { corpusId: "corpus-1", manifestObjectId: "manifest-1" });
    const corpus = privateJournalCorpusDirectory({ rootDir: root, caseId, corpusId: "corpus-1" });
    await fs.mkdir(corpus, { recursive: true });
    await fs.writeFile(path.join(corpus, "synthetic.journal-object.json"), "{}\n");
  }
  const [a, b] = cases;
  const locatorsA = await listPrivateArtifactLocatorsForCase({ rootDir: root, caseId: a });
  assert.deepEqual(locatorsA.map((entry) => entry.kind).sort(), ["candidate", "handoff"], "a candidate and a handoff name case a");
  // A file that names case a but isn't at the path its own contents give is not proven to be a's locator, so it stays.
  const stray = path.join(root, ".artifact-locators", `candidate-${"0".repeat(64)}.json`);
  await fs.copyFile(locatorsA.find((entry) => entry.kind === "candidate").file, stray);
  const filesOf = async (directory) => (await fs.readdir(path.join(root, directory)).catch(() => [])).sort();
  const before = { handoffs: await filesOf(".handoffs"), corpora: await filesOf(".journal-corpora") };

  const removed = await store.deletePrivateCase(a);
  assert.deepEqual({ ...removed }, { case_id: a, case_file_removed: true, handoffs_removed: 1, journal_corpora_removed: 1, locator_files_removed: 2, alias_locator_files_removed: 1, handoffs_kept: [] });
  assert.equal(await store.load(a), null, "case a's file is gone");
  assert.equal((await filesOf(".handoffs")).length, before.handoffs.length - 1);
  assert.equal((await filesOf(".journal-corpora")).length, before.corpora.length - 1);
  assert.deepEqual(await listPrivateArtifactLocatorsForCase({ rootDir: root, caseId: a }), []);
  assert.deepEqual(await listPrivateCaseAliasLocatorsForCase({ rootDir: root, caseId: a }), []);
  assert.ok(await fs.stat(stray), "the unproven file is left alone");
  await assert.rejects(() => store.loadHandoff(a, handoffIds[a]), (error) => error.code === "PRIVATE_HANDOFF_NOT_FOUND");

  // Case b is whole: its record, its handoff, its locators, its alias and its journal folder.
  assert.equal((await store.load(b)).runtime_turns[0].state, "DELIVERED");
  assert.equal((await store.loadHandoff(b, handoffIds[b])).case_id, b);
  assert.deepEqual((await listPrivateArtifactLocatorsForCase({ rootDir: root, caseId: b })).map((entry) => entry.kind).sort(), ["candidate", "handoff"]);
  assert.equal((await listPrivateCaseAliasLocatorsForCase({ rootDir: root, caseId: b })).length, 1);
  assert.deepEqual(await fs.readdir(privateJournalCorpusDirectory({ rootDir: root, caseId: b, corpusId: "corpus-1" })), ["synthetic.journal-object.json"]);

  // Run again (as after an interruption), it finishes with nothing left to remove; the case's id can start an empty case.
  const again = await store.deletePrivateCase(a);
  assert.deepEqual([again.case_file_removed, again.handoffs_removed, again.locator_files_removed], [false, 0, 0]);
  assert.equal((await store.loadOrCreate(a)).runtime_turns.length, 0);
});

// The store's per-case queue, watched: each run says whether its operation has started and finished.
function watchedCoordinator() {
  const inner = createCaseMutationCoordinator();
  const runs = [];
  const coordinator = Object.freeze({
    async run(caseId, operation) {
      const entry = { caseId, started: false, finished: false };
      runs.push(entry);
      return inner.run(caseId, async () => {
        entry.started = true;
        try { return await operation(); } finally { entry.finished = true; }
      });
    }
  });
  return { coordinator, runs };
}

// Holds the next creation of one folder (the store creates a file's folder just before writing the file) until released.
function holdFolderCreation(folder) {
  const original = fs.mkdir;
  let arrived;
  const reached = new Promise((resolve) => { arrived = resolve; });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let armed = true;
  fs.mkdir = async function heldMkdir(target, ...rest) {
    if (armed && path.resolve(String(target)) === folder) {
      armed = false;
      arrived();
      await held;
    }
    return original.call(this, target, ...rest);
  };
  return { reached, release, restore: () => { release(); fs.mkdir = original; } };
}

test("a handoff, a draft's locator or an alias being written when the case is deleted is never left behind: each write takes the case's queue", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runner-delete-race-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const watched = watchedCoordinator();
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 85), recoverySecretBytes: Buffer.alloc(32, 86), developmentExternalCredentialAuthorized: true, mutationCoordinator: watched.coordinator });
  const writers = [
    ["handoff", path.join(root, ".handoffs"), (caseId) => store.createHandoff(caseId, { handoffId: "handoff:00000000-0000-4000-8000-0000000000c1", runtimeVersion: "synthetic-runtime", auditVersion: "synthetic-audit" }), "handoffs_removed"],
    ["draft locator", path.join(root, ".artifact-locators"), (caseId) => store.saveCandidateResponse(caseId, "candidate:synthetic-race", "A synthetic draft.", { producer_context_id: "synthetic-producer" }), "locator_files_removed"],
    ["alias", path.join(root, ".case-alias-locators"), (caseId) => store.bindCaseAlias(caseId, `${caseId} alias`), "alias_locator_files_removed"]
  ];
  for (const [name, folder, write, removedCount] of writers) {
    const caseId = `synthetic-race-${name.replace(/\W+/gu, "-")}`;
    await store.loadOrCreate(caseId);
    const hold = holdFolderCreation(folder);
    let deleted;
    try {
      const writing = write(caseId);
      await Promise.race([hold.reached, writing.then(() => { throw new Error(`${name}: finished without writing its file`); })]);
      assert.ok(watched.runs.some((entry) => entry.caseId === caseId && entry.started && !entry.finished), `${name}: the write holds the case's queue while it writes the file that names the case`);
      const asked = watched.runs.length;
      const deleting = store.deletePrivateCase(caseId);
      const deletion = watched.runs[asked];
      assert.equal(deletion?.caseId, caseId, `${name}: the deletion asks for the same queue`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(deletion.started, false, `${name}: the deletion waits for the write`);
      hold.release();
      [, deleted] = await Promise.all([writing, deleting]);
    } finally {
      hold.restore();
    }
    assert.equal(deleted.case_file_removed, true, name);
    assert.ok(deleted[removedCount] >= 1, `${name}: the deletion found what the write left and removed it`);
    assert.equal(await store.load(caseId), null, `${name}: the case is gone`);
    assert.deepEqual(await listPrivateArtifactLocatorsForCase({ rootDir: root, caseId }), [], `${name}: no locator names the case`);
    assert.deepEqual(await listPrivateCaseAliasLocatorsForCase({ rootDir: root, caseId }), [], `${name}: no alias names the case`);
  }
  assert.deepEqual(await fs.readdir(path.join(root, ".handoffs")), [], "no handoff envelope is left");
  // A handoff asked for after the deletion finds no case and writes nothing.
  await assert.rejects(() => store.createHandoff("synthetic-race-handoff", { handoffId: "handoff:00000000-0000-4000-8000-0000000000c2" }), (error) => error.code === "PRIVATE_CASE_NOT_FOUND");
  assert.deepEqual(await fs.readdir(path.join(root, ".handoffs")), []);
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
