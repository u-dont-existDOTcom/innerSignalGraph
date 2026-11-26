import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { RUNNER_LAUNCHER_SETTING, readRunnerLauncherSwitch } from "../src/runner-trial/switch.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { RUNNER_WORK_KINDS, createRunnerWorkGate, isRunnerWorkGate } from "../src/runner-trial/work-gate.mjs";
import { LAUNCHER_MESSAGE_KIND, createRunnerLauncherLink, launcherMessage, readLauncherMessage } from "../src/runner-trial/launcher-link.mjs";
import { prepareTrialFolder, serverEnvironment } from "../scripts/runner-trial-start.mjs";

// The page's Restart and Stop (docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, sections 2, 4.1, 4.8, 8 and
// 10, pull request 2): the work gate they wait for, the channel to the launcher, the switch, the two routes and /health, the server's
// end of the channel, and the page's buttons. Every conversation is synthetic and every worker a stand-in; the launcher is a stand-in
// channel that records what it is asked (scripts/runner-launcher.mjs has its own tests).

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serveEntry = fileURLToPath(new URL("../src/cli/serve.mjs", import.meta.url));
const parts = cutRuleParts(loadTherapyProtocol({ boxGuidance: true }));
const CASE_ID = "synthetic-runner-restart-case";
const PLANTED_WORD = "Zantrophelia";

async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function withEnv(values, fn) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const trialConfig = (overrides = {}) => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, ...overrides });

async function makeStore(t) {
  const root = await tempDir(t, "runner-restart");
  const store = createEncryptedPrivateCaseStore({ rootDir: root, routineKek: Buffer.alloc(32, 91), recoverySecretBytes: Buffer.alloc(32, 92), developmentExternalCredentialAuthorized: true });
  await store.loadOrCreate(CASE_ID);
  return store;
}

// A server on loopback for one test; it closes after the test with every connection, a request still held by a stand-in included.
async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

async function until(condition, { timeoutMs = 10_000, what = "the condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

// Stand-in workers: `script[role]` is a function (call number, request) -> value, or throws.
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
const quietReader = () => ({ level: "none", wish_or_intent: "not_applicable", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: "nothing of the kind", provisional_reply: null });
const passing = () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] });
const baseScript = (overrides = {}) => ({
  R1: quietReader,
  R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION"] }),
  R3: () => ({ compatibility_assessment: null }),
  W: () => ({ reply: "A synthetic reply.", answered_level: "none", quotes: [] }),
  "W-repair": (count) => ({ reply: `A repaired synthetic reply ${count}.`, answered_level: "none", quotes: [] }),
  C1: passing, C2: passing, C3: passing, C4: passing,
  C5: () => ({ findings: [], level: "none", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS], missed_boxes: [] }),
  CW: passing,
  ...overrides
});

// A stand-in for the launcher's end of the IPC channel, behind the server's real end of it: it records each message, or fails to take it.
function launcherChannel({ fails = false } = {}) {
  const sent = [];
  const channel = {
    connected: true,
    send(message, callback) {
      if (fails) { callback(new Error("The channel is closed.")); return false; }
      sent.push(structuredClone(message));
      callback(null);
      return true;
    }
  };
  return { sent, channel, link: createRunnerLauncherLink(channel) };
}

async function trialServer(t, script = baseScript(), { launcher = null, store = null, config: overrides = {} } = {}) {
  const privateStore = store ?? await makeStore(t);
  const config = trialConfig(overrides);
  const workers = fakeWorkers(script);
  const trial = createRunnerTrialController({ privateCaseSource: privateStore, config, settings: validateRunnerTrialSettings({}), parts, workerFor: workers.workerFor });
  const make = () => createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: privateStore, privateTherapyController: trial.controller, runnerTrialEvents: trial.events, runnerTrialSettings: trial.settings, runnerLauncher: launcher });
  const base = await listen(t, make());
  return { base, trial, calls: workers.calls, make };
}

const health = async (base) => (await fetch(`${base}/health`)).json();
async function pagePost(base, route, body = { confirmed: true }, headers = {}, raw = null) {
  const sent = Object.fromEntries(Object.entries({ "content-type": "application/json", origin: base, ...headers }).filter(([, value]) => value != null));
  const response = await fetch(`${base}${route}`, { method: "POST", headers: sent, body: raw ?? JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => null) };
}
const respond = async (base, body) => {
  const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: CASE_ID, userMessage: "A synthetic message.", ...body }) });
  return { status: response.status, json: await response.json().catch(() => null) };
};
// A request with headers fetch won't send as given: a Host of another site, a body sent in chunks with no length, or one that declares
// more than it sends (`end: false`: it is never finished). No answer within five seconds is a null status.
function rawPost(base, route, { headers = {}, chunks = ["{\"confirmed\":true}"], end = true } = {}) {
  const url = new URL(route, base);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json", origin: base, ...headers } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        request.destroy();
        resolve({ status: response.statusCode, json: JSON.parse(text), connection: response.headers.connection ?? null });
      });
    });
    request.setTimeout(5_000, () => {
      request.destroy();
      resolve({ status: null, json: null, connection: null });
    });
    request.once("error", (error) => { if (!request.destroyed) reject(error); });
    for (const chunk of chunks) request.write(chunk);
    if (end) request.end();
  });
}

// ---- The work gate and the launcher's channel ---------------------------------------------------------------------------------

test("the work gate counts each piece of work until it ends, closes only while nothing runs, in the same step that looks, and refuses new work once closed", async () => {
  const gate = createRunnerWorkGate();
  assert.equal(isRunnerWorkGate(gate), true);
  assert.deepEqual([gate.state(), [...gate.running()]], ["open", []]);
  let release;
  const held = gate.run("reply", () => new Promise((resolve) => { release = resolve; }));
  // Admitted before its first await: a close in the same turn of the event loop already finds it.
  const busy = gate.close("restart");
  assert.deepEqual([busy.closed, busy.reason, [...busy.running]], [false, "busy", ["reply"]]);
  assert.equal(gate.state(), "open", "a refused close changes nothing");
  release("done");
  assert.equal(await held, "done");
  assert.deepEqual({ ...gate.close("restart") }, { closed: true });
  assert.equal(gate.state(), "restart");
  await assert.rejects(gate.run("deletion", async () => "never"), (error) => error.code === "RUNNER_CLOSING" && /restarting/u.test(error.message));
  assert.deepEqual({ ...gate.close("stop") }, { closed: false, reason: "closing", closing: "restart" }, "one close at a time");
  gate.reopen();
  assert.equal(await gate.run("deletion", async () => "after"), "after", "an open gate admits work again");
  // A close made first refuses the work that comes after it in the same turn.
  assert.equal(gate.close("stop").closed, true);
  await assert.rejects(gate.run("reply", async () => "never"), (error) => error.code === "RUNNER_CLOSING" && error.message === "The runner is stopping.");
  gate.reopen();
  // A piece of work that fails is counted out all the same.
  await assert.rejects(gate.run("reply", async () => { throw new Error("synthetic"); }), /synthetic/u);
  assert.deepEqual([...gate.running()], []);
  await assert.rejects(gate.run("copy", async () => {}), /isn't a kind of the runner's work/u);
  assert.throws(() => gate.close("delete"), /closes for a restart or a stop/u);
  assert.deepEqual([...RUNNER_WORK_KINDS], ["reply", "deletion"]);
});

test("the server asks the launcher with one fixed message, fails as unreachable when the channel can't take it, and has no link without a channel", async () => {
  const { sent, link } = launcherChannel();
  await link.ask("restart");
  await link.ask("stop");
  assert.deepEqual(sent, [{ kind: LAUNCHER_MESSAGE_KIND, action: "restart" }, { kind: LAUNCHER_MESSAGE_KIND, action: "stop" }]);
  await assert.rejects(launcherChannel({ fails: true }).link.ask("restart"), (error) => error.code === "RUNNER_LAUNCHER_UNREACHABLE");
  const closed = launcherChannel();
  closed.channel.connected = false;
  await assert.rejects(closed.link.ask("stop"), (error) => error.code === "RUNNER_LAUNCHER_UNREACHABLE");
  assert.deepEqual(closed.sent, []);
  const throwing = createRunnerLauncherLink({ connected: true, send: () => { throw new Error("The channel is closed."); } });
  await assert.rejects(throwing.ask("restart"), (error) => error.code === "RUNNER_LAUNCHER_UNREACHABLE");
  assert.throws(() => link.ask("delete"), /restart or to stop/u);
  // The launcher's going is listened for from the moment the link finds the channel open, and told once.
  const gone = [];
  const live = Object.assign(new EventEmitter(), { connected: true, send: (message, callback) => { callback(null); return true; } });
  createRunnerLauncherLink(live, { onGone: () => { gone.push("gone"); } });
  live.connected = false;
  live.emit("disconnect");
  live.emit("disconnect");
  assert.deepEqual(gone, ["gone"]);
  assert.throws(() => createRunnerLauncherLink(Object.assign(new EventEmitter(), { connected: true, send: () => true }), { onGone: "stop" }), /needs a function, and a channel that tells it/u);
  assert.throws(() => createRunnerLauncherLink({ connected: true, send: () => true }, { onGone: () => {} }), /needs a function, and a channel that tells it/u);
  for (const channel of [null, {}, { send: () => true, connected: false }]) {
    assert.throws(() => createRunnerLauncherLink(channel), (error) => error.code === "BAD_CONFIG" && error.message.startsWith(`${RUNNER_LAUNCHER_SETTING} is on, but this server has no channel to a launcher`));
  }
  assert.equal(readLauncherMessage(launcherMessage("restart")), "restart");
  assert.equal(readLauncherMessage({ kind: LAUNCHER_MESSAGE_KIND, action: "stop" }), "stop");
  for (const message of [null, "restart", ["restart"], { kind: LAUNCHER_MESSAGE_KIND }, { kind: "another", action: "stop" }, { kind: LAUNCHER_MESSAGE_KIND, action: "delete" }, { kind: LAUNCHER_MESSAGE_KIND, action: "stop", caseId: "case-x" }]) {
    assert.equal(readLauncherMessage(message), null, JSON.stringify(message));
  }
});

test("the launcher's switch is off when absent, blank or off, on when on, and any other value stops loadConfig naming the setting, never the value", async () => {
  for (const raw of [undefined, "", "   ", "off", "OFF", "false", "0", "no"]) assert.equal(readRunnerLauncherSwitch(raw), false, String(raw));
  for (const raw of ["on", "ON", " on ", "true", "1", "yes"]) assert.equal(readRunnerLauncherSwitch(raw), true, raw);
  for (const raw of ["maybe", "synthetic-invalid-launcher"]) {
    await withEnv({ [RUNNER_LAUNCHER_SETTING]: raw }, async () => {
      assert.throws(() => loadConfig({ mode: "mock" }), (error) => error.code === "BAD_CONFIG" && error.message === `${RUNNER_LAUNCHER_SETTING} must be on or off.` && !error.message.includes(raw));
    });
  }
  await withEnv({ [RUNNER_LAUNCHER_SETTING]: "on" }, async () => { assert.equal(loadConfig({ mode: "mock" }).runnerLauncherEnabled, true); });
  await withEnv({ [RUNNER_LAUNCHER_SETTING]: null }, async () => { assert.equal(loadConfig({ mode: "mock" }).runnerLauncherEnabled, false); });
});

// ---- The routes and /health ---------------------------------------------------------------------------------------------------

test("/health says runnerLauncher off with the trial off and for a runner started from a terminal, on with a launcher, and stopping once a stop is taken", async (t) => {
  const offConfig = trialConfig({ runnerTrialEnabled: false });
  const offBase = await listen(t, createInnerSignalServer({ config: offConfig, providers: createProviders(offConfig), privateCaseStore: await makeStore(t), runnerLauncher: launcherChannel().link }));
  assert.equal((await health(offBase)).runnerLauncher, "off", "with the trial off a launcher's link changes nothing");
  assert.equal((await health((await trialServer(t)).base)).runnerLauncher, "off", "started from a terminal");
  const launcher = launcherChannel();
  const { base } = await trialServer(t, baseScript(), { launcher: launcher.link });
  assert.equal((await health(base)).runnerLauncher, "on");
  assert.equal((await pagePost(base, "/v1/runner/stop")).status, 202);
  assert.equal((await health(base)).runnerLauncher, "stopping");
  // A launcher's link needs the trial controller's gate, and a link that can ask.
  const config = trialConfig();
  const store = await makeStore(t);
  const trial = createRunnerTrialController({ privateCaseSource: store, config, settings: validateRunnerTrialSettings({}), parts, workerFor: fakeWorkers(baseScript()).workerFor });
  const build = (controller, runnerLauncher) => createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: controller, runnerTrialEvents: trial.events, runnerLauncher });
  assert.throws(() => build({ ...trial.controller, workGate: undefined }, launcher.link), (error) => error.code === "BAD_CONFIG" && /work gate/u.test(error.message));
  assert.throws(() => build(trial.controller, {}), (error) => error.code === "BAD_CONFIG" && /must be able to ask it/u.test(error.message));
  assert.doesNotThrow(() => build({ ...trial.controller, workGate: undefined }, null), "without a launcher no gate is needed");
});

test("Restart and Stop answer only the owner's page on this machine, as a small JSON object that confirms them, with the trial on", async (t) => {
  const launcher = launcherChannel();
  const { base } = await trialServer(t, baseScript(), { launcher: launcher.link });
  for (const route of ["/v1/runner/restart", "/v1/runner/stop"]) {
    assert.equal((await pagePost(base, route, { confirmed: true }, { origin: null })).status, 403, `${route}: no Origin`);
    assert.equal((await pagePost(base, route, { confirmed: true }, { origin: "http://evil.example" })).status, 403, `${route}: another Origin`);
    assert.equal((await pagePost(base, route, { confirmed: true }, { authorization: "Bearer synthetic-agent-token" })).status, 403, `${route}: an agent's token`);
    assert.equal((await pagePost(base, route, { confirmed: true }, { "sec-fetch-site": "cross-site" })).status, 403, `${route}: another site's fetch`);
    assert.equal((await rawPost(base, route, { headers: { host: "evil.example:80", origin: "http://evil.example:80" } })).status, 403, `${route}: another Host (DNS rebinding)`);
    assert.equal((await pagePost(base, route, null, { "content-type": "text/plain" }, "{\"confirmed\":true}")).status, 415, `${route}: not JSON`);
    const declared = await pagePost(base, route, null, {}, JSON.stringify({ confirmed: true, padding: "x".repeat(2_000) }));
    assert.deepEqual([declared.status, declared.json.code], [413, "RUNNER_BODY_TOO_LARGE"], `${route}: a body over the limit`);
    const chunked = await rawPost(base, route, { chunks: ["{\"confirmed\":true,\"padding\":\"", "x".repeat(700), "x".repeat(700), "\"}"] });
    assert.deepEqual([chunked.status, chunked.json.code], [413, "RUNNER_BODY_TOO_LARGE"], `${route}: a body over the limit sent in chunks, with no length`);
    const unread = await rawPost(base, route, { headers: { "content-length": "2000" }, chunks: ["{\"confirmed\":"], end: false });
    assert.deepEqual([unread.status, unread.json?.code, unread.connection], [413, "RUNNER_BODY_TOO_LARGE", "close"], `${route}: a body declared over the limit is refused before it is read`);
    // Sent in chunks past the limit and never finished: the request is left unread, not torn down, so its 413 still arrives.
    const unfinished = await rawPost(base, route, { chunks: ["{\"confirmed\":true,\"padding\":\"", "x".repeat(1_500)], end: false });
    assert.deepEqual([unfinished.status, unfinished.json?.code, unfinished.connection], [413, "RUNNER_BODY_TOO_LARGE", "close"], `${route}: a body past the limit, still being sent`);
    for (const body of [[], {}, { confirmed: "yes" }, { confirmed: 1 }]) assert.equal((await pagePost(base, route, body)).status, 400, `${route}: ${JSON.stringify(body)} doesn't confirm`);
    assert.equal((await pagePost(base, route, null, {}, "{\"confirmed\":")).status, 400, `${route}: not valid JSON`);
    assert.equal((await fetch(`${base}${route}`, { headers: { origin: base } })).status, 404, `${route}: GET`);
  }
  assert.deepEqual(launcher.sent, [], "nothing reached the launcher");
  assert.equal((await health(base)).runnerLauncher, "on");
  // Started from a terminal: no launcher to ask.
  const terminal = await trialServer(t);
  const refused = await pagePost(terminal.base, "/v1/runner/restart");
  assert.deepEqual([refused.status, refused.json], [409, { error: "This runner was started from a terminal: restart or stop it there.", code: "RUNNER_STARTED_FROM_TERMINAL" }]);
  // With the trial off, neither route exists.
  const offConfig = trialConfig({ runnerTrialEnabled: false });
  const offBase = await listen(t, createInnerSignalServer({ config: offConfig, providers: createProviders(offConfig), privateCaseStore: await makeStore(t) }));
  for (const route of ["/v1/runner/restart", "/v1/runner/stop"]) assert.equal((await pagePost(offBase, route)).status, 404, `${route} with the trial off`);
});

test("Restart and Stop wait while a reply is being written; taken once it is done, they ask the launcher once, and from then on no turn, reconcile or deletion starts", { timeout: 60_000 }, async (t) => {
  let releaseWriter;
  const writerHeld = new Promise((resolve) => { releaseWriter = resolve; });
  t.after(() => releaseWriter());
  const script = baseScript({ W: async () => { await writerHeld; return { reply: "A synthetic reply.", answered_level: "none", quotes: [] }; } });
  const launcher = launcherChannel();
  const { base, calls } = await trialServer(t, script, { launcher: launcher.link });
  const turn = respond(base, { exchangeId: "exchange-held" });
  turn.catch(() => {});
  await until(() => calls.some((entry) => entry.role === "W"), { what: "the writer" });
  for (const route of ["/v1/runner/restart", "/v1/runner/stop"]) {
    const refused = await pagePost(base, route);
    assert.deepEqual([refused.status, refused.json.code, refused.json.running], [409, "RUNNER_BUSY", ["reply"]], route);
    assert.equal(refused.json.error, "Restart and Stop wait while a reply is being written or a case is being deleted: try again when it has finished.");
  }
  assert.deepEqual(launcher.sent, [], "a refused Restart asks nothing");
  assert.equal((await health(base)).runnerLauncher, "on", "and changes nothing");
  releaseWriter();
  assert.equal((await turn).status, 200, "the reply is delivered");
  const taken = await pagePost(base, "/v1/runner/restart");
  assert.deepEqual([taken.status, taken.json], [202, { action: "restart", accepted: true }]);
  assert.deepEqual(launcher.sent, [{ kind: LAUNCHER_MESSAGE_KIND, action: "restart" }]);
  assert.equal((await health(base)).runnerLauncher, "restarting");
  const workersBefore = calls.length;
  const late = await respond(base, { exchangeId: "exchange-late" });
  assert.deepEqual([late.status, late.json.code, late.json.error], [503, "RUNNER_CLOSING", "The runner is restarting: send it again once the page is back."]);
  assert.equal(calls.length, workersBefore, "the turn refused called no worker");
  const reconcile = await pagePost(base, "/v1/runner/reconcile", { caseId: CASE_ID, conversation: "current" });
  assert.deepEqual([reconcile.status, reconcile.json.code], [503, "RUNNER_CLOSING"]);
  const deletion = await pagePost(base, "/v1/case/delete", { caseId: CASE_ID, confirmation: "DELETE" });
  assert.deepEqual([deletion.status, deletion.json.code], [503, "RUNNER_CLOSING"]);
  const again = await pagePost(base, "/v1/runner/stop");
  assert.deepEqual([again.status, again.json.code], [409, "RUNNER_CLOSING"], "one Restart or Stop at a time");
  assert.equal(launcher.sent.length, 1);
});

test("a case being deleted holds Restart too, and a kept plan's deletion is refused once the gate is closed", { timeout: 60_000 }, async (t) => {
  const store = await makeStore(t);
  let releaseDeletion;
  const deletionHeld = new Promise((resolve) => { releaseDeletion = resolve; });
  t.after(() => releaseDeletion());
  const slowStore = Object.create(store, { deletePrivateCase: { value: async (...args) => { await deletionHeld; return store.deletePrivateCase(...args); } } });
  const launcher = launcherChannel();
  const { base, trial } = await trialServer(t, baseScript(), { launcher: launcher.link, store: slowStore });
  const deleting = pagePost(base, "/v1/case/delete", { caseId: CASE_ID, confirmation: "DELETE" });
  deleting.catch(() => {});
  await until(() => trial.workGate.running().includes("deletion"), { what: "the deletion" });
  const refused = await pagePost(base, "/v1/runner/restart");
  assert.deepEqual([refused.status, refused.json.code, refused.json.running], [409, "RUNNER_BUSY", ["deletion"]]);
  releaseDeletion();
  assert.equal((await deleting).status, 200);
  assert.equal((await pagePost(base, "/v1/runner/restart")).status, 202);
  assert.deepEqual(launcher.sent, [{ kind: LAUNCHER_MESSAGE_KIND, action: "restart" }]);

  const keeping = await trialServer(t, baseScript(), { launcher: launcherChannel().link, config: { runnerKeptPlanEnabled: true } });
  assert.equal((await pagePost(keeping.base, "/v1/runner/kept-plan/delete", { caseId: CASE_ID, confirmed: true })).status, 200);
  assert.equal((await pagePost(keeping.base, "/v1/runner/stop")).status, 202);
  const late = await pagePost(keeping.base, "/v1/runner/kept-plan/delete", { caseId: CASE_ID, confirmed: true });
  assert.deepEqual([late.status, late.json.code], [503, "RUNNER_CLOSING"]);
});

test("a launcher that can't be reached restarts nothing, and the runner goes on taking work", async (t) => {
  // A channel that fails to take the message, and one that has closed since the server started.
  const failing = launcherChannel({ fails: true });
  const closed = launcherChannel();
  closed.channel.connected = false;
  for (const [launcher, exchangeId] of [[failing, "exchange-after-failing"], [closed, "exchange-after-closed"]]) {
    const { base } = await trialServer(t, baseScript(), { launcher: launcher.link });
    const refused = await pagePost(base, "/v1/runner/restart");
    assert.deepEqual([refused.status, refused.json], [503, { error: "The launcher couldn't be reached: nothing was restarted or stopped.", code: "RUNNER_LAUNCHER_UNREACHABLE" }]);
    assert.equal((await health(base)).runnerLauncher, "on", "the gate opened again");
    assert.equal((await respond(base, { exchangeId })).status, 200, "a turn is taken");
    assert.deepEqual(launcher.sent, []);
  }
});

test("both of the server's listeners count into one gate: a Restart taken on one stops work on the other", async (t) => {
  const launcher = launcherChannel();
  const { base, make } = await trialServer(t, baseScript(), { launcher: launcher.link });
  const other = await listen(t, make());
  assert.equal((await pagePost(base, "/v1/runner/restart")).status, 202);
  assert.equal((await health(other)).runnerLauncher, "restarting");
  const late = await respond(other, { exchangeId: "exchange-other-listener" });
  assert.deepEqual([late.status, late.json.code], [503, "RUNNER_CLOSING"]);
  assert.deepEqual([(await pagePost(other, "/v1/runner/stop")).json.code, launcher.sent.length], ["RUNNER_CLOSING", 1]);
});

// ---- The server's own start (src/cli/serve.mjs) ----------------------------------------------------------------------------------

async function startedServer(t, env, stdio) {
  const child = spawn(process.execPath, [serveEntry], { cwd: repositoryRoot, env, stdio });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exited, stderr: () => stderr };
}

test("with the launcher's switch on, the server starts only with a channel to it: it says so on /health, asks over it, and stops when the launcher is gone", { timeout: 120_000 }, async (t) => {
  const bareEnv = (value) => ({ PATH: process.env.PATH, HOME: os.tmpdir(), INNER_SIGNAL_MODE: "mock", LEDGER_MODE: "off", INNER_SIGNAL_RUNNER_TRIAL: "on", [RUNNER_LAUNCHER_SETTING]: value, PORT: "1" });
  const bare = await startedServer(t, bareEnv("on"), ["ignore", "ignore", "pipe"]);
  assert.notEqual((await bare.exited).code, 0, "no channel, no start");
  assert.match(bare.stderr(), /INNER_SIGNAL_RUNNER_LAUNCHER is on, but this server has no channel to a launcher: scripts\/runner-launcher\.mjs starts it with one\./u);
  const invalid = await startedServer(t, bareEnv("synthetic-invalid-launcher"), ["ignore", "ignore", "pipe"]);
  assert.notEqual((await invalid.exited).code, 0);
  assert.match(invalid.stderr(), /INNER_SIGNAL_RUNNER_LAUNCHER must be on or off\./u);
  assert.equal(invalid.stderr().includes("synthetic-invalid-launcher"), false, "the value is never printed");

  // The trial's folder as a start makes it, and the server as the launcher starts it: with its IPC channel.
  const dir = await tempDir(t, "runner-restart-serve");
  const prepared = await prepareTrialFolder({ home: path.join(dir, "trial"), provider: "codex" });
  const port = await freePort();
  const env = serverEnvironment({ base: { PATH: process.env.PATH, HOME: dir }, provider: "codex", port, credentialsPath: prepared.credentialsPath, settingsPath: prepared.settingsPath, token: prepared.token, caseId: prepared.caseId, trialDir: prepared.home, launcher: true });
  const served = await startedServer(t, env, ["ignore", "ignore", "pipe", "ipc"]);
  const heard = [];
  served.child.on("message", (message) => { heard.push(message); });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => { try { return (await fetch(`${base}/health`)).ok; } catch { return false; } }, { timeoutMs: 60_000, what: "the server" });
  assert.equal((await health(base)).runnerLauncher, "on");
  const taken = await pagePost(base, "/v1/runner/restart");
  assert.equal(taken.status, 202);
  await until(() => heard.length > 0, { what: "the launcher's message" });
  assert.deepEqual(heard, [{ kind: LAUNCHER_MESSAGE_KIND, action: "restart" }], "one fixed message, and nothing else");
  served.child.disconnect();
  const ended = await Promise.race([served.exited, new Promise((resolve) => { setTimeout(() => resolve(null), 30_000).unref(); })]);
  assert.deepEqual(ended, { code: 0, signal: null }, "without its launcher the server stops, as on a stop signal");
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
});

test("a server whose launcher goes while it is still starting stops there, and never listens", { timeout: 60_000 }, async (t) => {
  const dir = await tempDir(t, "runner-restart-gone");
  const prepared = await prepareTrialFolder({ home: path.join(dir, "trial"), provider: "codex" });
  // The start waits for flock (the vault's writer lock) after the server has its channel to the launcher: a flock that takes its time holds
  // the start there, well within the five seconds the start gives it.
  const bin = path.join(dir, "bin");
  await fs.mkdir(bin);
  const flockPid = path.join(dir, "flock.pid");
  await fs.writeFile(path.join(bin, "flock"), `#!/bin/sh\necho $$ > '${flockPid}'\nexec sleep 30\n`, { mode: 0o755 });
  t.after(async () => {
    const pid = Number(await fs.readFile(flockPid, "utf8").catch(() => ""));
    if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, "SIGKILL"); } catch { /* gone already */ } }
  });
  const port = await freePort();
  const env = serverEnvironment({ base: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir }, provider: "codex", port, credentialsPath: prepared.credentialsPath, settingsPath: prepared.settingsPath, token: prepared.token, caseId: prepared.caseId, trialDir: prepared.home, launcher: true });
  const served = await startedServer(t, env, ["ignore", "ignore", "pipe", "ipc"]);
  await until(() => fs.access(flockPid).then(() => true, () => false), { timeoutMs: 30_000, what: "the start to wait for the lock" });
  served.child.disconnect();
  const ended = await Promise.race([served.exited, new Promise((resolve) => { setTimeout(() => resolve(null), 3_000).unref(); })]);
  assert.deepEqual(ended, { code: 0, signal: null }, `it stops at once, not after the lock's own five seconds: ${served.stderr()}`);
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
});

// ---- The page ----------------------------------------------------------------------------------------------------------------

async function pageSource() {
  const [html, app] = await Promise.all(["apps/web/index.html", "apps/web/app.js"].map((relative) => fs.readFile(path.join(repositoryRoot, relative), "utf8")));
  return { html, app };
}

// The page's Restart and Stop, in its own markup: the runner-trial block, the trial's page state and the controls, with the browser's
// fetch, confirm, alert, reload and timers stood in for. `answers[url]` are the answers to each address in turn (the last one again and
// again); an Error is a request that fails.
async function controlsPage(t, answers = {}) {
  const { html, app } = await pageSource();
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const between = (from, to) => {
    const at = app.indexOf(from);
    const end = app.indexOf(to, at);
    assert.ok(at > 0 && end > at, `the page has ${from}`);
    return app.slice(at, end);
  };
  const fetched = [];
  const asked = [];
  const page = { reloads: 0, confirm: true };
  const queues = Object.fromEntries(Object.entries(answers).map(([url, list]) => [url, [...list]]));
  const context = vm.createContext({
    TextDecoder,
    document,
    $: (selector) => document.querySelector(selector),
    fetch: async (url, init = {}) => {
      fetched.push({ url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null });
      const queue = queues[url] ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (!next || next instanceof Error) throw next ?? new TypeError("fetch failed");
      return { ok: next.status < 400, status: next.status, json: async () => structuredClone(next.body) };
    },
    confirm: (words) => { asked.push(["confirm", words]); return page.confirm; },
    alert: (words) => { asked.push(["alert", words]); },
    location: { reload: () => { page.reloads += 1; } },
    setTimeout: (callback) => { setImmediate(callback); return 0; }
  });
  vm.runInContext([
    between("// runner-trial-page:start", "// runner-trial-page:end"),
    between("// `keptPlanOn`: the plan kept for next time is on", "let healthChecked").replace("const runnerTrial", "var runnerTrial"),
    between("// runner-launcher-controls:start", "// runner-launcher-controls:end")
  ].join("\n"), context);
  vm.runInContext("initRunnerLauncherControls()", context);
  return {
    document,
    context,
    fetched,
    asked,
    page,
    region: between("// runner-launcher-controls:start", "// runner-launcher-controls:end"),
    apply: (healthValue) => vm.runInContext(`applyRunnerLauncher(runnerLauncherState(${JSON.stringify(healthValue)}))`, context),
    shown: (selector) => !document.querySelector(selector).hidden,
    text: (selector) => document.querySelector(selector).textContent,
    click: (selector) => document.querySelector(selector).click()
  };
}

const RESTART_CONFIRM = "Restart the runner? It stops and starts again in a few seconds, so that clients added and consents recorded since it started take effect. This page reloads when it's back.";
const STOP_CONFIRM = "Stop the runner? This page stops working until you start it again with the InnerSignal runner icon.";

test("the page shows Restart and Stop at the top only for a runner the launcher started, \"Restart from the terminal\" for one started from a terminal, and nothing with the trial off", async (t) => {
  const page = await controlsPage(t);
  const { html } = await pageSource();
  for (const id of ["runner-controls", "runner-restart", "runner-stop", "runner-from-terminal", "runner-controls-status"]) {
    assert.match(html, new RegExp(`<[a-z]+ id="${id}"[^>]*\\shidden[\\s>]`, "u"), `${id} is hidden until /health says`);
  }
  const header = html.slice(html.indexOf('<header class="topbar">'), html.indexOf("</header>"));
  assert.ok(header.includes('id="runner-restart"') && header.includes('id="runner-stop"'), "at the top of the page");
  const parts = ["#runner-controls", "#runner-restart", "#runner-stop", "#runner-from-terminal"];
  page.apply({ runnerTrial: "on", runnerLauncher: "on" });
  assert.deepEqual(parts.map(page.shown), [true, true, true, false]);
  assert.deepEqual([page.text("#runner-restart"), page.text("#runner-stop"), page.document.querySelector("#runner-restart").disabled, page.document.querySelector("#runner-stop").disabled], ["Restart", "Stop", false, false]);
  page.apply({ runnerTrial: "on", runnerLauncher: "off" });
  assert.deepEqual(parts.map(page.shown), [true, false, false, true]);
  assert.equal(page.text("#runner-from-terminal"), "Restart from the terminal");
  page.apply({ runnerTrial: "on", runnerLauncher: "restarting" });
  assert.deepEqual([...parts.map(page.shown), page.document.querySelector("#runner-restart").disabled, page.document.querySelector("#runner-stop").disabled], [true, true, true, false, true, true], "shown, but not to be pressed again");
  page.apply({ runnerTrial: "off", runnerLauncher: "on" });
  assert.equal(page.shown("#runner-controls"), false, "nothing with the trial off");
  const state = (value) => vm.runInContext(`runnerLauncherState(${JSON.stringify(value)})`, page.context);
  assert.deepEqual([state({ runnerTrial: "on" }), state({ runnerTrial: "on", runnerLauncher: "sideways" }), state({ runnerTrial: "on", runnerLauncher: "stopping" }), state(null)], ["off", "off", "stopping", "none"]);
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/u.test(page.region), false, "words go in with textContent");
});

test("Restart asks once in plain words, sends a JSON object that confirms it, and reloads the page once the restarted runner answers", async (t) => {
  const page = await controlsPage(t, {
    "/v1/runner/restart": [{ status: 202, body: { action: "restart", accepted: true } }],
    "/health": [{ status: 200, body: { ok: true, runnerTrial: "on", runnerLauncher: "restarting" } }, new TypeError("fetch failed"), { status: 200, body: { ok: true, runnerTrial: "on", runnerLauncher: "on" } }]
  });
  page.apply({ runnerTrial: "on", runnerLauncher: "on" });
  page.page.confirm = false;
  page.click("#runner-restart");
  await until(() => page.asked.length === 1);
  assert.deepEqual([page.asked, page.fetched], [[["confirm", RESTART_CONFIRM]], []], "declined: nothing is sent");
  page.page.confirm = true;
  page.click("#runner-restart");
  await until(() => page.page.reloads === 1, { what: "the reload" });
  assert.deepEqual(page.fetched.map((call) => [call.url, call.method]), [["/v1/runner/restart", "POST"], ["/health", "GET"], ["/health", "GET"], ["/health", "GET"]], "the runner being stopped says restarting, then nothing answers, then the new one: reloaded at the first \"on\"");
  assert.deepEqual([{ ...page.fetched[0].headers }, page.fetched[0].body], [{ "content-type": "application/json" }, "{\"confirmed\":true}"]);
  assert.equal(page.text("#runner-controls-status"), "Restarting… this page reloads when the runner is back.");
  assert.deepEqual([page.document.querySelector("#runner-restart").disabled, page.document.querySelector("#runner-stop").disabled, page.document.querySelector("#therapy-send").disabled], [true, true, true], "nothing is pressed or sent meanwhile");
  assert.equal(page.asked.filter(([kind]) => kind === "alert").length, 0);
});

test("Stop asks once, and says the runner is stopped once nothing answers, with how to start it again", async (t) => {
  const page = await controlsPage(t, {
    "/v1/runner/stop": [{ status: 202, body: { action: "stop", accepted: true } }],
    "/health": [{ status: 200, body: { ok: true, runnerTrial: "on", runnerLauncher: "stopping" } }, new TypeError("fetch failed")]
  });
  page.apply({ runnerTrial: "on", runnerLauncher: "on" });
  page.click("#runner-stop");
  await until(() => page.text("#runner-controls-status") === "The runner is stopped. Start it again with the InnerSignal runner icon.", { what: "the stopped line" });
  assert.deepEqual(page.asked, [["confirm", STOP_CONFIRM]]);
  assert.deepEqual(page.fetched.map((call) => [call.url, call.method]), [["/v1/runner/stop", "POST"], ["/health", "GET"], ["/health", "GET"]]);
  assert.deepEqual([page.page.reloads, page.document.querySelector("#runner-stop").disabled, page.document.querySelector("#therapy-send").disabled], [0, true, true]);
});

test("a Restart or Stop the runner refuses says why in fixed words, and leaves the buttons working", async (t) => {
  const cases = [
    ["restart", { status: 409, body: { error: "Restart and Stop wait while a reply is being written or a case is being deleted: try again when it has finished.", code: "RUNNER_BUSY", running: ["reply"] } }, "Restart waits while a reply is being written: try again when it has finished."],
    ["stop", { status: 409, body: { code: "RUNNER_BUSY", running: ["reply", "deletion", PLANTED_WORD] } }, "Stop waits while a reply is being written and a case is being deleted: try again when it has finished."],
    ["restart", { status: 503, body: { error: "The launcher couldn't be reached: nothing was restarted or stopped.", code: "RUNNER_LAUNCHER_UNREACHABLE" } }, "The runner wasn't restarted. The launcher couldn't be reached: nothing was restarted or stopped."],
    ["stop", new TypeError("fetch failed"), "The runner wasn't stopped. The page can't reach it."]
  ];
  for (const [action, answer, words] of cases) {
    const page = await controlsPage(t, { [`/v1/runner/${action}`]: [answer] });
    page.apply({ runnerTrial: "on", runnerLauncher: "on" });
    page.click(`#runner-${action}`);
    await until(() => page.asked.some(([kind]) => kind === "alert"), { what: "the refusal" });
    assert.deepEqual(page.asked.at(-1), ["alert", words]);
    assert.deepEqual([page.document.querySelector("#runner-restart").disabled, page.document.querySelector("#runner-stop").disabled, page.shown("#runner-controls-status")], [false, false, false], "nothing changed: the buttons work again");
    assert.equal(page.fetched.some((call) => call.url === "/health"), false);
  }
  // A runner started from a terminal asks nothing.
  const terminal = await controlsPage(t);
  terminal.apply({ runnerTrial: "on", runnerLauncher: "off" });
  await vm.runInContext('askRunnerLauncher("restart")', terminal.context);
  assert.deepEqual([terminal.asked, terminal.fetched], [[], []]);
});

test("the line about clients added since the start says to press Restart when the launcher started the runner, and the busy words cover every kind of work", async (t) => {
  const page = await controlsPage(t);
  const waiting = (count, launcher) => vm.runInContext(`runnerWaitingText(${JSON.stringify(count)}, ${JSON.stringify(launcher)})`, page.context);
  assert.equal(waiting(1, "on"), "1 client(s) added since the trial started: press Restart at the top to see them here.");
  assert.equal(waiting(2, "off"), "2 client(s) added since the trial started: start it again to see them here.", "a runner started from a terminal: as before");
  assert.deepEqual([waiting(0, "on"), waiting(-1, "on"), waiting("1", "on")], ["", "", ""]);
  assert.deepEqual([...vm.runInContext("Object.keys(RUNNER_BUSY_WORDS)", page.context)], [...RUNNER_WORK_KINDS], "the page has words for each kind of work the gate counts");
  const { app } = await pageSource();
  assert.match(app, /runnerWaitingText\(runnerCases\.waiting, runnerTrial\.launcher\)/u, "the case line uses it");
  assert.match(app, /applyRunnerLauncher\(runnerLauncherState\(health\)\);/u, "the health check applies it");
  assert.match(app, /\["restarting", "stopping"\]\.includes\(runnerTrial\.launcher\)/u, "Send waits while the runner restarts or stops");
});
