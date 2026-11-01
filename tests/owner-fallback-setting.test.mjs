import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { loadConfig, OWNER_FALLBACK_SETTING } from "../src/core/config.mjs";
import { readOnOffSetting } from "../src/core/on-off-setting.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { listenInnerSignalLoopback } from "../src/server/listen-loopback.mjs";
import { SUPERVISOR_REPLY_SETTING, supervisorRepliesEnabled } from "../src/server/supervisor-reply-setup.mjs";
import { projectCommunicationState } from "../src/storage/private-case-communication.mjs";
import { OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";
import { validatePrivateRuntimeTurn } from "../src/supervisor/private-runtime-turn-lifecycle.mjs";
import { createPrivateTherapyModelRuntime } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { BLOCKING_FINDING, openScriptedRiskRuntime } from "./fixtures/scripted-risk-runtime.mjs";

// The switch for the fixed fallback message (INNER_SIGNAL_OWNER_FALLBACK): off by default, read the way the draft flag is read, reported
// by /health, and a gate on writing only. Everything here is synthetic: numbered placeholder messages, test-chosen findings and scripted
// providers. The wording of the fallback itself is tested in self-directed-risk-audit-and-fallback.test.mjs.
const CALM = "IC.CREDIBILITY_REPAIR";
const INQUIRY = "IC.SUICIDAL_SELF_DEATH_INQUIRY";
const SAFETY = "IC.SAFETY_ORIENTATION";
const QUESTION = "Which part of this stays unsettled for you?";
const serveEntry = fileURLToPath(new URL("../src/cli/serve.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const unavailable = (code) => (error) => error?.code === code;

async function withEnv(values, fn) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---- Reading the setting ---------------------------------------------------------------------------------------------------

const OFF_VALUES = [undefined, "", "   ", "false", "FALSE", "0", "no", "off", " Off "];
const ON_VALUES = ["true", "TRUE", " true ", "1", "yes", "on", "On"];
const INVALID_VALUES = ["maybe", "2", "enabled", "tru", "synthetic-invalid-value"];

test("the setting is read exactly as the draft flag is read: blank and the false words are off, the true words are on, anything else is an error", async () => {
  const configReading = (value) => withEnv({ [OWNER_FALLBACK_SETTING]: value }, () => loadConfig({ mode: "mock" }).ownerFallbackEnabled);
  const draftReading = (value) => supervisorRepliesEnabled({ [SUPERVISOR_REPLY_SETTING]: value });
  for (const [values, expected] of [[OFF_VALUES, false], [ON_VALUES, true]]) {
    for (const value of values) {
      const label = JSON.stringify(value);
      assert.equal(readOnOffSetting(value), expected, `${label} in the shared reading`);
      assert.equal(draftReading(value), expected, `${label} for the draft flag`);
      assert.equal(await configReading(value), expected, `${label} for ${OWNER_FALLBACK_SETTING}`);
    }
  }
  for (const value of INVALID_VALUES) {
    const label = JSON.stringify(value);
    assert.equal(readOnOffSetting(value), null, `${label} in the shared reading`);
    assert.throws(() => draftReading(value), /must be true or false/u, `${label} for the draft flag`);
    await assert.rejects(
      async () => configReading(value),
      (error) => error?.code === "BAD_CONFIG" && error.message === `${OWNER_FALLBACK_SETTING} must be true or false.`,
      `${label} stops loadConfig with one fixed message that names the setting and never the value`
    );
  }
  assert.equal(OWNER_FALLBACK_SETTING, "INNER_SIGNAL_OWNER_FALLBACK");
});

test("the setting is off by default, and a config that does not carry it is off", async () => {
  assert.equal(await withEnv({ [OWNER_FALLBACK_SETTING]: undefined }, () => loadConfig({ mode: "mock" }).ownerFallbackEnabled), false);
  assert.equal(await withEnv({ [OWNER_FALLBACK_SETTING]: undefined }, () => loadConfig({ mode: "mock", ownerFallbackEnabled: true }).ownerFallbackEnabled), true, "a caller can still choose it");
  // The model runtime acts only on exactly true, so a config built by hand without the field, or with a loose value, is off.
  for (const config of [{}, { ownerFallbackEnabled: false }, { ownerFallbackEnabled: "true" }, { ownerFallbackEnabled: 1 }, { ownerFallbackEnabled: null }]) {
    const produced = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion: QUESTION, config })();
    assert.equal(produced.exactText, QUESTION, JSON.stringify(config));
    assert.equal(Object.hasOwn(produced, "kind"), false, JSON.stringify(config));
  }
});

test("an invalid value stops the server's startup before it listens, and the message names the setting and not the value", async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); });
  });
  const child = spawn(process.execPath, [serveEntry], {
    cwd: repositoryRoot,
    env: { ...process.env, INNER_SIGNAL_MODE: "mock", PORT: String(port), [OWNER_FALLBACK_SETTING]: "synthetic-invalid-value" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 60_000);
  const code = await new Promise((resolve) => child.once("exit", (exitCode) => resolve(exitCode)));
  clearTimeout(watchdog);
  assert.notEqual(code, 0, `the server must not start; stdout=${stdout}`);
  assert.match(stderr, /INNER_SIGNAL_OWNER_FALLBACK must be true or false\./u);
  assert.equal(stderr.includes("synthetic-invalid-value"), false, "the value is never printed");
  assert.equal(stdout.includes("listening"), false);
});

// ---- /health ---------------------------------------------------------------------------------------------------------------

async function healthOf(config) {
  const server = createInnerSignalServer({ config, providers: createProviders(config) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/health`).then((response) => response.json());
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("/health reports the state as on or off and leaves its other fields alone", async () => {
  const off = await healthOf(loadConfig({ mode: "mock", ownerFallbackEnabled: false }));
  const on = await healthOf(loadConfig({ mode: "mock", ownerFallbackEnabled: true }));
  assert.equal(off.ownerFallback, "off");
  assert.equal(on.ownerFallback, "on");
  for (const health of [off, on]) {
    assert.equal(health.ok, true);
    assert.equal(health.mode, "mock");
    assert.equal(health.privateCaseStorage.plaintextFallback, false);
    assert.ok(Array.isArray(health.endpoints) && health.endpoints.includes("/v1/therapy/respond"));
    assert.deepEqual(Object.keys(health).filter((key) => key !== "ownerFallback"), Object.keys(off).filter((key) => key !== "ownerFallback"), "the other fields are the same in both states");
  }
  // From the environment, the way a deploy sets it; the field names the state and never the value it was given.
  assert.equal((await withEnv({ [OWNER_FALLBACK_SETTING]: undefined }, async () => healthOf(loadConfig({ mode: "mock" })))).ownerFallback, "off", "unset");
  assert.equal((await withEnv({ [OWNER_FALLBACK_SETTING]: "  " }, async () => healthOf(loadConfig({ mode: "mock" })))).ownerFallback, "off", "blank");
  assert.equal((await withEnv({ [OWNER_FALLBACK_SETTING]: "true" }, async () => healthOf(loadConfig({ mode: "mock" })))).ownerFallback, "on", "true");
  assert.equal(JSON.stringify(await withEnv({ [OWNER_FALLBACK_SETTING]: "YES" }, async () => healthOf(loadConfig({ mode: "mock" })))).includes("YES"), false);
});

test("the loopback launcher serves the same state on both of its addresses", async () => {
  for (const [ownerFallbackEnabled, expected] of [[false, "off"], [true, "on"]]) {
    const config = loadConfig({ mode: "mock", ownerFallbackEnabled });
    const listener = await listenInnerSignalLoopback({ config, providers: createProviders(config), port: 0 });
    try {
      for (const base of [listener.url, listener.ipv4Url]) assert.equal((await fetch(`${base}/health`).then((response) => response.json())).ownerFallback, expected, base);
    } finally {
      await listener.close();
    }
  }
});

// ---- The decision, row by row ----------------------------------------------------------------------------------------------

function discriminatorRuntime({ activeStep, nextQuestion, config }) {
  const source = {
    async loadPrivateRuntimeCase() {
      return {
        case_state: { current_episode: { active_step: activeStep, route: activeStep, next_question: nextQuestion } },
        candidate_responses: [{ id: "candidate-1", audit_history: [{ findings: [] }] }]
      };
    }
  };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: {}, config });
  return () => runtime.produceDiscriminator({ caseId: "synthetic-case", runtimeTurn: { id: "runtime-turn-1", current_candidate_id: "candidate-1" }, authContext: null, attemptContextId: "attempt-1" });
}

test("with the setting off, both routes take the ordinary path exactly: the stored question is sent, and no question is PRIVATE_DISCRIMINATOR_UNAVAILABLE", async () => {
  const off = { ownerFallbackEnabled: false };
  for (const activeStep of [INQUIRY, SAFETY]) {
    // The result is deep-equal to what a calm route gets for the same input, receipt and context identity included.
    const ordinary = await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, config: off })();
    assert.deepEqual(await discriminatorRuntime({ activeStep, nextQuestion: QUESTION, config: off })(), ordinary, activeStep);
    assert.equal(ordinary.providerReceipt.provider, "deterministic-current-episode");
    for (const nextQuestion of ["", undefined, "   "]) {
      await assert.rejects(discriminatorRuntime({ activeStep, nextQuestion, config: off }), unavailable("PRIVATE_DISCRIMINATOR_UNAVAILABLE"), `${activeStep} ${JSON.stringify(nextQuestion)}`);
    }
    // A text that cannot be sent as a question is passed on as it always was; saving it is what refuses it.
    for (const nextQuestion of ["Tell me more", "First part? Second part?"]) {
      const produced = await discriminatorRuntime({ activeStep, nextQuestion, config: off })();
      assert.deepEqual(produced, await discriminatorRuntime({ activeStep: CALM, nextQuestion, config: off })(), `${activeStep} ${nextQuestion}`);
      assert.equal(Object.hasOwn(produced, "kind"), false);
    }
  }
});

test("with the setting on, the same two routes get the fixed message, and the setting is the only difference", async () => {
  const on = { ownerFallbackEnabled: true };
  const off = { ownerFallbackEnabled: false };
  for (const nextQuestion of [QUESTION, "", undefined]) {
    const produced = await discriminatorRuntime({ activeStep: INQUIRY, nextQuestion, config: on })();
    assert.deepEqual([produced.kind, produced.exactText, produced.providerReceipt.provider], [OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE, "deterministic-owner-fallback"]);
  }
  const noQuestion = await discriminatorRuntime({ activeStep: SAFETY, nextQuestion: "", config: on })();
  assert.deepEqual([noQuestion.kind, noQuestion.exactText], [OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE]);
  assert.deepEqual(await discriminatorRuntime({ activeStep: SAFETY, nextQuestion: QUESTION, config: on })(), await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, config: on })(), "a sendable stored question on the safety route is still sent");
  assert.deepEqual(await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, config: on })(), await discriminatorRuntime({ activeStep: CALM, nextQuestion: QUESTION, config: off })(), "other routes do not depend on the setting");
});

// ---- Through the whole audit loop ------------------------------------------------------------------------------------------

const everyKindIn = (record) => JSON.stringify(record);

test("with the setting off, a self-death inquiry turn whose audits fail sends the stored question as before, and no fallback is written", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["ideation"], auditFindings: () => [BLOCKING_FINDING] });
  const result = await runtime.run(1);
  const record = await runtime.load();
  const episode = record.case_state.current_episode;
  assert.equal(episode.active_step, INQUIRY);
  assert.equal(result.deliveryKind, "discriminator");
  assert.equal(result.answer, episode.next_question);
  assert.deepEqual([runtime.counts.private_candidate_audit, runtime.counts.private_candidate_repair], [3, 2], "the audit loop is the same");
  const [turn] = record.runtime_turns;
  assert.equal(Object.hasOwn(turn.discriminator, "kind"), false);
  assert.equal(turn.delivery.kind, "discriminator");
  assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(turn)));
  assert.equal(everyKindIn(record).includes(OWNER_FALLBACK_KIND), false, "no owner_fallback anywhere in the saved case");
  assert.equal(everyKindIn(record).includes("runtime_owner_fallback"), false);
  assert.equal(record.raw_transcript.some((entry) => entry.text === OWNER_FALLBACK_MESSAGE), false);
});

test("with the setting off, a safety-orientation turn with no sendable question ends unavailable as before, and nothing is saved or delivered as a fallback", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [BLOCKING_FINDING] });
  await assert.rejects(() => runtime.run(1), (error) => error?.code === "THERAPY_RUNTIME_UNAVAILABLE" && error.details?.stage === "discriminator");
  const record = await runtime.load();
  assert.equal(record.case_state.current_episode.active_step, SAFETY);
  const [turn] = record.runtime_turns;
  assert.equal(turn.state, "DISCRIMINATING_QUESTION_REQUIRED");
  assert.equal(turn.discriminator, null);
  assert.equal(turn.delivery, null);
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user"], "nothing was delivered");
  assert.equal(everyKindIn(record).includes(OWNER_FALLBACK_KIND), false);
});

test("with the setting on, the same two turns deliver the fixed message as kind owner_fallback", async (t) => {
  for (const [reading, route] of [["ideation", INQUIRY], ["imminent", SAFETY]]) {
    const runtime = await openScriptedRiskRuntime(t, { caseId: `synthetic-on-${reading}`, readings: [reading], auditFindings: () => [BLOCKING_FINDING], ownerFallback: true });
    const result = await runtime.run(1);
    const record = await runtime.load();
    assert.equal(record.case_state.current_episode.active_step, route);
    assert.equal(result.deliveryKind, OWNER_FALLBACK_KIND, route);
    assert.equal(result.answer, OWNER_FALLBACK_MESSAGE, route);
    const [turn] = record.runtime_turns;
    assert.deepEqual([turn.discriminator.kind, turn.delivery.kind], [OWNER_FALLBACK_KIND, OWNER_FALLBACK_KIND], route);
  }
});

// ---- A case that already holds a fallback, opened with the setting off ------------------------------------------------------

test("with the setting off, a case that holds a delivered owner_fallback still loads, replays that turn unchanged and continues", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, {
    readings: ["imminent", "absent"],
    auditFindings: ({ turn }) => (turn === 1 ? [BLOCKING_FINDING] : []),
    ownerFallback: true
  });
  assert.equal((await runtime.run(1)).deliveryKind, OWNER_FALLBACK_KIND);
  const written = await runtime.load();
  const callsBefore = JSON.stringify(runtime.counts);

  const off = runtime.reopen({ ownerFallback: false });
  const loaded = await runtime.load();
  assert.deepEqual(loaded.runtime_turns, written.runtime_turns, "the store validates and returns the saved turn whatever the setting");
  assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(loaded.runtime_turns[0])));
  const outbound = projectCommunicationState(loaded).confirmed_or_reported_client_outbound.filter((entry) => entry.assistant_turn_id === "risk-1-assistant");
  assert.equal(outbound[0].source.route, "runtime_owner_fallback", "the delivery is still attributed");

  const replayed = await off.run(1);
  assert.equal(replayed.deliveryKind, OWNER_FALLBACK_KIND);
  assert.equal(replayed.answer, OWNER_FALLBACK_MESSAGE);
  assert.equal(JSON.stringify(runtime.counts), callsBefore, "the replay called no provider");
  assert.deepEqual((await runtime.load()).runtime_turns, written.runtime_turns, "and changed nothing");

  const next = await off.run(2);
  assert.equal(next.deliveryKind, "candidate", "the case continues with an ordinary reply");
  const record = await runtime.load();
  assert.deepEqual(record.raw_transcript.map((entry) => entry.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(record.raw_transcript[1].text, OWNER_FALLBACK_MESSAGE);
  assert.deepEqual(record.runtime_turns.map((turn) => turn.state), ["DELIVERED", "DELIVERED"]);
});

test("with the setting off, a fallback that was saved and not yet delivered is delivered when the turn resumes", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, {
    readings: ["imminent", "absent"],
    auditFindings: ({ turn }) => (turn === 1 ? [BLOCKING_FINDING] : []),
    ownerFallback: true
  });
  // The first run stops right after the fallback is saved: the store refuses its delivery once, as a crash at that moment would.
  let armed = true;
  const crashingSource = new Proxy(runtime.store, {
    get(target, property) {
      if (property === "deliverPrivateRuntimeDiscriminator" && armed) return async () => { armed = false; throw new Error("Synthetic stop before delivery."); };
      return target[property];
    }
  });
  const crashingController = createPrivateTherapyTurnController({ privateCaseSource: crashingSource, modelRuntime: runtime.modelRuntime, maximumInvocationAttempts: 1 });
  await assert.rejects(() => crashingController.run({
    caseId: runtime.caseId,
    runtimeTurnId: "runtime-risk-1",
    exchangeId: "risk-1",
    userTurnId: "risk-1-user",
    assistantTurnId: "risk-1-assistant",
    userMessage: "Synthetic message 1.",
    userInput: { processingMode: "fast" }
  }), /Synthetic stop before delivery/u);
  const saved = (await runtime.load()).runtime_turns[0];
  assert.equal(saved.discriminator.kind, OWNER_FALLBACK_KIND, "the fallback is saved");
  assert.equal(saved.delivery, null, "and was not delivered");
  assert.doesNotThrow(() => validatePrivateRuntimeTurn(structuredClone(saved)));

  const off = runtime.reopen({ ownerFallback: false });
  const resumed = await off.run(1);
  assert.equal(resumed.deliveryKind, OWNER_FALLBACK_KIND);
  assert.equal(resumed.answer, OWNER_FALLBACK_MESSAGE);
  assert.equal((await off.run(2)).deliveryKind, "candidate");
});
