import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { loadPrivateRuntimeAccessFromEnvironment, scrubPrivateCaseTokens } from "../src/storage/private-runtime-environment.mjs";
import { detectCodexCapabilities } from "../src/core/cli-capabilities.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { RUNNER_TRIAL_CLIENT_TOKENS_SETTING, readRunnerTrialClientTokens } from "../src/runner-trial/switch.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients, runnerCasesView, validateClientLabel, validateRunnerClients } from "../src/runner-trial/clients.mjs";
import { acquireTrialFolderLock, addClient, parseArguments, prepareTrialFolder, setJournalConsent, withTrialFolderLock } from "../scripts/runner-trial-start.mjs";

// The runner trial's clients (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md; the owner's answer 1a to question
// i73, 24 Nov 2026): a case per client in the trial's own vault, each client's own grant, the case chosen per conversation, and
// each client's run log. Every client, label, message and reply here is invented, and every worker is a stand-in: no model is
// called and no real record or journal is read.

const parts = cutRuleParts(loadTherapyProtocol({ boxGuidance: true }));
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const quietReader = () => ({ level: "none", wish_or_intent: "not_applicable", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: "nothing of the kind", provisional_reply: null });
const passing = () => ({ findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] });
const baseScript = (overrides = {}) => ({
  R1: quietReader,
  R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION"] }),
  R3: () => ({ compatibility_assessment: null }),
  W: () => ({ reply: "A synthetic reply.", answered_level: "none", quotes: [] }),
  CW: passing,
  ...overrides
});

// The trials a test started, whose run log writes its folder's removal waits for.
const trialsOf = new WeakMap();
async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  trialsOf.set(t, trialsOf.get(t) ?? []);
  t.after(async () => { await Promise.all(trialsOf.get(t).map((trial) => trial.flushLogs())); await fs.rm(dir, { recursive: true, force: true }); });
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

async function listen(t, server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
const mode = async (file) => (await fs.stat(file)).mode & 0o777;

// A trial folder made the start script's way, with `labels` as its clients: the owner's own case and one case per client, each
// with its own grant and token, as a start makes them.
async function clientFolder(t, labels = ["Synthetic client one"]) {
  const home = await tempDir(t, "runner-clients");
  await prepareTrialFolder({ home, provider: "codex" });
  for (const label of labels) await addClient({ home, label, now: () => new Date("2026-11-24T08:00:00.000Z") });
  const prepared = await prepareTrialFolder({ home, provider: "codex" });
  return { home, prepared, clients: (await readRunnerClients(home)).clients };
}

// The trial's server on that folder's real development credentials and vault, with stand-in workers.
async function clientServer(t, { labels = ["Synthetic client one", "Synthetic client two"], script = baseScript(), folder = null } = {}) {
  const made = folder ?? await clientFolder(t, labels);
  const { home, prepared } = made;
  const providers = await loadDevelopmentPrivateCaseProviders(prepared.credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const caseAuthContexts = new Map(Object.entries(prepared.clientTokens).map(([caseId, token]) => [caseId, Object.freeze({ bearerToken: token })]));
  const ownAuth = Object.freeze({ bearerToken: prepared.token });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialCaseId: prepared.caseId, runnerTrialDir: home, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, runnerRulesRoot: null, responseEvidenceEnforced: false });
  const workers = fakeWorkers(script);
  const trial = createRunnerTrialController({ privateCaseSource: service, config, clientCaseIds: [...caseAuthContexts.keys()], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode: "whole" }), parts, workerFor: workers.workerFor });
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseAccessService: service, privateAuthContext: ownAuth, privateCaseAuthContexts: caseAuthContexts, privateTherapyController: trial.controller, runnerTrialEvents: trial.events });
  const base = await listen(t, server);
  trialsOf.set(t, [...(trialsOf.get(t) ?? []), trial]);
  return { ...made, service, base, trial, calls: workers.calls, ownAuth, caseAuthContexts, ownCase: prepared.caseId, clientCases: Object.keys(prepared.clientTokens) };
}

const page = (base) => ({ origin: base });
async function ownerPost(base, route, body) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => null) };
}
async function respond(base, caseId, exchangeId, userMessage) {
  const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId, exchangeId, userMessage }) });
  return { status: response.status, json: await response.json().catch(() => null) };
}

test("--add-client and --journal-consent are commands of their own: only --dir goes with them, and the consent is confirm or withdraw", () => {
  const refusedWith = (code, pattern) => (error) => error.exitCode === code && pattern.test(error.message);
  assert.equal(parseArguments(["--add-client"]).addClient, true);
  assert.equal(parseArguments(["--add-client", "--dir", "/synthetic/trial"]).dir, "/synthetic/trial");
  assert.equal(parseArguments(["--journal-consent", "withdraw"]).journalConsent, "withdraw");
  assert.equal(parseArguments(["--journal-consent=confirm", "--dir=/synthetic/trial"]).journalConsent, "confirm");
  assert.throws(() => parseArguments(["--add-client", "--provider", "codex"]), refusedWith(2, /--add-client changes the client list and stops: give only --dir with it\./u));
  assert.throws(() => parseArguments(["--journal-consent", "confirm", "--response-evidence"]), refusedWith(2, /give only --dir with it/u));
  assert.throws(() => parseArguments(["--add-client", "--journal-consent", "confirm"]), refusedWith(2, /separate commands/u));
  assert.throws(() => parseArguments(["--journal-consent", "maybe"]), refusedWith(2, /--journal-consent must be confirm or withdraw\./u));
  assert.throws(() => parseArguments(["--add-client=yes"]), refusedWith(2, /takes no value/u));
  assert.equal(parseArguments(["--provider", "codex", "--response-evidence"]).responseEvidence, true);
  assert.equal(parseArguments(["--provider", "codex"]).responseEvidence, false, "off unless given");
});

test("labels are one line of 1 to 80 characters, compared without regard to case; a client list of another shape is refused without repeating it", () => {
  assert.equal(validateClientLabel("  Synthetic A  "), "Synthetic A");
  for (const label of ["", "   ", "Synthetic\nlabel", "Synthetic\u0007label", "x".repeat(81), 42, null]) {
    assert.throws(() => validateClientLabel(label), (error) => error.code === "RUNNER_CLIENTS_INVALID" && !String(error.message).includes("Synthetic"), String(label));
  }
  const client = (caseId, label) => ({ case_id: caseId, label, added_at: "2026-11-24T08:00:00.000Z", journal: { corpus_id: null, consent: null } });
  const A = "case-66666666-6666-4666-8666-666666666666";
  const B = "case-77777777-7777-4777-8777-777777777777";
  assert.doesNotThrow(() => validateRunnerClients({ schema_version: 1, clients: [client(A, "Synthetic A"), client(B, "Synthetic B")] }));
  for (const bad of [
    { schema_version: 1, clients: [client(A, "Synthetic A"), client(B, "synthetic a")] },
    { schema_version: 1, clients: [client(A, "Synthetic A"), client(A, "Synthetic B")] },
    { schema_version: 1, clients: [client("case-1", "Synthetic A")] },
    { schema_version: 1, clients: [{ ...client(A, "Synthetic A"), extra: true }] },
    { schema_version: 1, clients: [{ ...client(A, "Synthetic A"), journal: { corpus_id: null, consent: { confirmed_at: "2026-11-24T08:00:00.000Z", withdrawn_at: "2026-11-23T08:00:00.000Z" } } }] },
    { schema_version: 2, clients: [] },
    { schema_version: 1, clients: [], extra: 1 }
  ]) assert.throws(() => validateRunnerClients(bad), { code: "RUNNER_CLIENTS_INVALID" }, JSON.stringify(bad));
});

test("each client gets a case with keys of its own, a grant of its own with a new token at every start, and session_use only while the owner's confirmation of their consent stands", async (t) => {
  const home = await tempDir(t, "runner-clients");
  const first = await prepareTrialFolder({ home, provider: "codex" });
  assert.deepEqual(first.clientTokens, {});
  assert.equal(first.clientCount, 0);
  await assert.rejects(addClient({ home: path.join(home, "not-made") , label: "Synthetic" }), /isn't ready/u);
  assert.deepEqual(await addClient({ home, label: "Synthetic client one", now: () => new Date("2026-11-24T08:00:00.000Z") }), { number: 1 });
  await assert.rejects(addClient({ home, label: "SYNTHETIC CLIENT ONE" }), /Another client already has that label/u);
  await assert.rejects(addClient({ home, label: "Synthetic\nsecond line" }), /one line/u);
  assert.equal(await mode(path.join(home, "clients.json")), 0o600);
  const { clients } = await readRunnerClients(home);
  assert.deepEqual(clients.map(({ label, added_at, journal }) => ({ label, added_at, journal })), [{ label: "Synthetic client one", added_at: "2026-11-24T08:00:00.000Z", journal: { corpus_id: null, consent: null } }]);
  const clientCase = clients[0].case_id;
  assert.notEqual(clientCase, first.caseId);
  const keysAfterAdd = (await readJson(path.join(home, "credentials.json"))).case_keys;
  assert.deepEqual(Object.keys(keysAfterAdd).sort(), [first.caseId, clientCase].sort(), "the client's case has keys of its own");

  const second = await prepareTrialFolder({ home, provider: "codex" });
  assert.equal(second.caseId, first.caseId, "the owner's own case stays");
  assert.deepEqual(Object.keys(second.clientTokens), [clientCase]);
  assert.notEqual(second.clientTokens[clientCase], second.token, "a token per grant");
  assert.notEqual(second.token, first.token, "new at every start");
  let credentials = await readJson(path.join(home, "credentials.json"));
  assert.deepEqual(credentials.case_keys, keysAfterAdd, "keys are never changed by a start");
  assert.deepEqual(credentials.grants.map((grant) => [grant.case_ids, grant.scopes, grant.purposes ?? null]), [
    [[first.caseId], ["case:read", "case:write", "case:audit"], null],
    [[clientCase], ["case:read", "case:write", "case:audit"], null]
  ], "one case per grant; no journal purpose without consent");
  assert.deepEqual(credentials.grants.map((grant) => grant.token_sha256), [sha256(second.token), sha256(second.clientTokens[clientCase])], "only the digests are kept");
  const text = await fs.readFile(path.join(home, "credentials.json"), "utf8");
  assert.equal(text.includes("Synthetic client one"), false, "no label in the credentials");
  assert.equal(text.includes(second.clientTokens[clientCase]), false, "no token in the credentials");

  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "withdraw" }), { changed: false, state: "none" }, "nothing to withdraw before a consent");
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "confirm", now: () => new Date("2026-11-24T09:00:00.000Z") }), { changed: true, state: "confirmed" });
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "confirm" }), { changed: false, state: "confirmed" });
  await assert.rejects(setJournalConsent({ home, number: 2, action: "confirm" }), /no client with that number/u);
  const third = await prepareTrialFolder({ home, provider: "codex" });
  credentials = await readJson(path.join(home, "credentials.json"));
  assert.deepEqual(credentials.grants[1].purposes, ["session_use"], "the journal purpose once the consent is confirmed");
  assert.equal(credentials.grants[0].purposes, undefined, "never for the owner's own case");
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "withdraw", now: () => new Date("2026-11-24T10:00:00.000Z") }), { changed: true, state: "withdrawn" });
  assert.deepEqual((await readRunnerClients(home)).clients[0].journal.consent, { confirmed_at: "2026-11-24T09:00:00.000Z", withdrawn_at: "2026-11-24T10:00:00.000Z" });
  await prepareTrialFolder({ home, provider: "codex" });
  assert.equal((await readJson(path.join(home, "credentials.json"))).grants[1].purposes, undefined, "dropped at the next start after a withdrawal");
  assert.ok(third.clientTokens[clientCase]);

  // A client list naming a case with no keys stops the start, and nothing is changed.
  const list = await readJson(path.join(home, "clients.json"));
  list.clients.push({ ...list.clients[0], case_id: "case-88888888-8888-4888-8888-888888888888", label: "Synthetic keyless" });
  await fs.writeFile(path.join(home, "clients.json"), `${JSON.stringify(list)}\n`, { mode: 0o600 });
  const before = await fs.readFile(path.join(home, "credentials.json"), "utf8");
  await assert.rejects(prepareTrialFolder({ home, provider: "codex" }), /Client 2 on the client list has no keys/u);
  assert.equal(await fs.readFile(path.join(home, "credentials.json"), "utf8"), before);
  await fs.chmod(path.join(home, "clients.json"), 0o644);
  await assert.rejects(prepareTrialFolder({ home, provider: "codex" }), /can be read by others/u);
});

test("the server reads each client's token from its environment, for that case alone, and never from the app's config", async (t) => {
  const A = "case-66666666-6666-4666-8666-666666666666";
  const tokenA = "A".repeat(43);
  assert.deepEqual([...readRunnerTrialClientTokens(JSON.stringify({ [A]: tokenA })).entries()].map(([caseId, context]) => [caseId, context.bearerToken]), [[A, tokenA]]);
  assert.equal(readRunnerTrialClientTokens(undefined).size, 0);
  assert.equal(readRunnerTrialClientTokens("  ").size, 0);
  for (const raw of ["not json", "[]", JSON.stringify({ "case-1": tokenA }), JSON.stringify({ [A]: "short" }), JSON.stringify({ [A]: tokenA, "case-77777777-7777-4777-8777-777777777777": tokenA })]) {
    assert.throws(() => readRunnerTrialClientTokens(raw), (error) => error.code === "BAD_CONFIG" && error.message.includes(RUNNER_TRIAL_CLIENT_TOKENS_SETTING) && !error.message.includes(tokenA), raw);
  }
  assert.equal(Object.hasOwn(loadConfig({ mode: "mock" }), "runnerTrialClientTokens"), false);
  const { prepared, clients } = await clientFolder(t, ["Synthetic client one"]);
  const environment = { INNER_SIGNAL_PRIVATE_RUNTIME_MODE: "development", INNER_SIGNAL_PRIVATE_RUNTIME_CREDENTIALS: prepared.credentialsPath, INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: prepared.token, [RUNNER_TRIAL_CLIENT_TOKENS_SETTING]: JSON.stringify(prepared.clientTokens) };
  const runtime = await loadPrivateRuntimeAccessFromEnvironment(environment, { responseEvidenceEnforced: false });
  try {
    assert.deepEqual([...runtime.privateCaseAuthContexts.keys()], [clients[0].case_id]);
  } finally { await runtime.close(); }
  await assert.rejects(loadPrivateRuntimeAccessFromEnvironment({ ...environment, [RUNNER_TRIAL_CLIENT_TOKENS_SETTING]: JSON.stringify({ [clients[0].case_id]: prepared.token }) }), { code: "BAD_CONFIG" }, "a client's token is never the owner's");
});

test("a turn for a client runs in that client's case with that client's token: no other case is opened, a case not on the list is refused, and each token opens only its own case", async (t) => {
  const s = await clientServer(t);
  const [clientA, clientB] = s.clientCases;
  const answered = await respond(s.base, clientA, "exchange-client-a-1", "A synthetic message for client A.");
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  assert.equal(answered.json.answer, "A synthetic reply.");
  const recordA = await s.service.loadPrivateRuntimeCase(clientA, s.caseAuthContexts.get(clientA));
  assert.deepEqual(recordA.raw_transcript.map((turn) => turn.text), ["A synthetic message for client A.", "A synthetic reply."]);
  for (const other of [s.ownCase, clientB]) {
    await assert.rejects(s.service.loadPrivateRuntimeCase(other, s.ownCase === other ? s.ownAuth : s.caseAuthContexts.get(other)), { code: "PRIVATE_CASE_NOT_FOUND" }, "no other case was made");
  }
  // Each token opens its own case only.
  await assert.rejects(s.service.loadPrivateRuntimeCase(clientA, s.ownAuth), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  await assert.rejects(s.service.loadPrivateRuntimeCase(clientA, s.caseAuthContexts.get(clientB)), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  // A case that isn't on the list is refused on every runner route, before anything of it is read or made.
  const unlisted = "case-99999999-9999-4999-8999-999999999999";
  assert.deepEqual([(await respond(s.base, unlisted, "exchange-unlisted", "A synthetic message.")).status], [404]);
  for (const route of ["/v1/runner/reconcile", "/v1/case/delete"]) {
    const refused = await ownerPost(s.base, route, { caseId: unlisted, conversation: "current", confirmation: "DELETE" });
    assert.deepEqual([refused.status, refused.json.code], [404, "RUNNER_CASE_UNKNOWN"], route);
  }
  const state = await fetch(`${s.base}/v1/case/state?caseId=${unlisted}`);
  assert.equal(state.status, 404);
  // The client's reconcile shows the client's turn, and the owner's shows none.
  const reconcileA = await ownerPost(s.base, "/v1/runner/reconcile", { caseId: clientA, conversation: "current" });
  assert.deepEqual(reconcileA.json.turns.map((turn) => turn.userMessage), ["A synthetic message for client A."]);
  assert.deepEqual((await ownerPost(s.base, "/v1/runner/reconcile", { caseId: s.ownCase, conversation: "current" })).json.turns, []);
  assert.deepEqual((await ownerPost(s.base, "/v1/runner/reconcile", { caseId: clientB, conversation: "current" })).json.turns, []);
});

test("the page's case list: the owner's own case and each granted client's, with its number and label, only to the owner's page on this machine; a client added since the start is counted, not listed", async (t) => {
  const s = await clientServer(t);
  await addClient({ home: s.home, label: "Synthetic client three" });
  const response = await fetch(`${s.base}/v1/runner/clients`, { headers: page(s.base) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const view = await response.json();
  assert.deepEqual(view, {
    cases: [
      { caseId: s.ownCase, kind: "own", number: null, label: null, journal: null },
      { caseId: s.clientCases[0], kind: "client", number: 1, label: "Synthetic client one", journal: { consent: "none", copied: false, coldTestPassed: false } },
      { caseId: s.clientCases[1], kind: "client", number: 2, label: "Synthetic client two", journal: { consent: "none", copied: false, coldTestPassed: false } }
    ],
    clientsAwaitingRestart: 1
  });
  for (const headers of [{ origin: "http://synthetic.invalid" }, { origin: s.base, authorization: "Bearer synthetic" }]) {
    const refused = await fetch(`${s.base}/v1/runner/clients`, { headers });
    assert.notEqual(refused.status, 200, JSON.stringify(headers));
  }
  assert.equal((await fetch(`${s.base}/v1/runner/clients`, { method: "POST", headers: { ...page(s.base), "content-type": "application/json" }, body: "{}" })).status, 404);
  assert.deepEqual(runnerCasesView({ ownCaseId: null, clients: [], grantedCaseIds: [] }), { cases: [], clientsAwaitingRestart: 0 });
});

test("each client case has its own run log file, written and deleted with that case only; Delete removes a client's journal folder too", async (t) => {
  const s = await clientServer(t);
  const [clientA, clientB] = s.clientCases;
  assert.equal((await respond(s.base, s.ownCase, "exchange-own-1", "A synthetic message of the owner's own.")).status, 200);
  assert.equal((await respond(s.base, clientA, "exchange-a-1", "A synthetic message for client A.")).status, 200);
  assert.equal((await respond(s.base, clientB, "exchange-b-1", "A synthetic message for client B.")).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  await s.trial.logWriter.flush();
  for (let i = 0; i < 20 && (await fs.readdir(s.home)).filter((name) => name.startsWith("runner-log")).length < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  const logs = (await fs.readdir(s.home)).filter((name) => name.startsWith("runner-log")).sort();
  assert.deepEqual(logs, ["runner-log.jsonl", `runner-log-${clientA}.jsonl`, `runner-log-${clientB}.jsonl`].sort());
  for (const name of logs) {
    const text = await fs.readFile(path.join(s.home, name), "utf8");
    assert.equal(/Synthetic client|synthetic message|A synthetic reply/iu.test(text), false, `${name} holds no words and no label`);
    assert.equal(text.trim().split("\n").length, 2, `${name}: its header and its own one turn`);
  }
  const folder = clientJournalFolder(s.home, clientA);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, COLD_TEST_RECEIPT_FILE), "{}", { mode: 0o600 });
  const deleted = await ownerPost(s.base, "/v1/case/delete", { caseId: clientA, confirmation: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json.caseFileRemoved, true);
  const after = (await fs.readdir(s.home)).filter((name) => name.startsWith("runner-log")).sort();
  assert.deepEqual(after, ["runner-log.jsonl", `runner-log-${clientB}.jsonl`].sort(), "only client A's log goes");
  await assert.rejects(fs.stat(folder), { code: "ENOENT" }, "and client A's journal folder");
  await assert.rejects(s.service.loadPrivateRuntimeCase(clientA, s.caseAuthContexts.get(clientA)), { code: "PRIVATE_CASE_NOT_FOUND" });
  assert.equal((await s.service.loadPrivateRuntimeCase(clientB, s.caseAuthContexts.get(clientB))).raw_transcript.length, 2, "client B's case stays");
  assert.equal((await s.service.loadPrivateRuntimeCase(s.ownCase, s.ownAuth)).raw_transcript.length, 2, "and the owner's own");
});

test("one command at a time changes the trial folder: a start, an addition or a consent change refuses while another holds it, and a lock left by an ended command is named, never taken over", async (t) => {
  const { home } = await clientFolder(t, ["Synthetic client one"]);
  let release = null;
  const held = withTrialFolderLock(home, () => new Promise((resolve) => { release = resolve; }));
  for (let i = 0; i < 200 && release === null; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof release, "function", "the lock is taken");
  const busy = /Another runner-trial command is changing the trial folder/u;
  await assert.rejects(addClient({ home, label: "Synthetic client two", lockWaitMs: 40 }), busy);
  await assert.rejects(setJournalConsent({ home, number: 1, action: "confirm", lockWaitMs: 40 }), busy, "a consent change can't be written over by an addition, nor the other way round");
  await assert.rejects(prepareTrialFolder({ home, provider: "codex", lockWaitMs: 40 }), busy);
  release();
  await held;
  assert.equal((await readRunnerClients(home)).clients.length, 1, "nothing was written while the folder was held");
  // A lock being written (no process id yet) counts as held; one left by a command that ended is named for the owner to remove, so
  // two commands can never both take it over.
  const lock = path.join(home, ".trial-folder.lock");
  await fs.writeFile(lock, "", { mode: 0o600 });
  await assert.rejects(setJournalConsent({ home, number: 1, action: "confirm", lockWaitMs: 40 }), busy);
  await fs.writeFile(lock, "999999999 synthetic-token\n", { mode: 0o600 });
  await assert.rejects(setJournalConsent({ home, number: 1, action: "confirm" }), (error) => error.message.includes("ended without finishing") && error.message.includes(lock));
  assert.equal(await fs.readFile(lock, "utf8"), "999999999 synthetic-token\n", "left as it is");
  await fs.unlink(lock);
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "confirm" }), { changed: true, state: "confirmed" });
  await assert.rejects(fs.stat(lock), { code: "ENOENT" }, "and released after use");
  // A command removes only its own lock: one that someone else holds by then stays.
  await withTrialFolderLock(home, async () => { await fs.writeFile(lock, "1 another-command\n", { mode: 0o600 }); });
  assert.equal(await fs.readFile(lock, "utf8"), "1 another-command\n");
  await fs.unlink(lock);
});

test("no subprocess the server starts inherits a case token: the tokens leave its environment once read, a model CLI's capability check included", async () => {
  const environment = { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: "synthetic-own", [RUNNER_TRIAL_CLIENT_TOKENS_SETTING]: "{}", PATH: "/synthetic/bin" };
  assert.deepEqual(Object.keys(scrubPrivateCaseTokens(environment)), ["PATH"]);
  const saved = Object.fromEntries(["INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN", RUNNER_TRIAL_CLIENT_TOKENS_SETTING].map((name) => [name, process.env[name]]));
  process.env.INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN = "synthetic-own-token-value";
  process.env[RUNNER_TRIAL_CLIENT_TOKENS_SETTING] = JSON.stringify({ "case-66666666-6666-4666-8666-666666666666": "synthetic-client-token-value" });
  try {
    scrubPrivateCaseTokens(process.env);
    const probe = await detectCodexCapabilities(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"]);
    for (const secret of ["synthetic-own-token-value", "synthetic-client-token-value", RUNNER_TRIAL_CLIENT_TOKENS_SETTING]) assert.equal(probe.helpText.includes(secret), false, secret);
  } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
  const serve = await fs.readFile(new URL("../src/cli/serve.mjs", import.meta.url), "utf8");
  assert.ok(serve.indexOf("scrubPrivateCaseTokens(process.env);") > serve.indexOf("await loadPrivateRuntimeAccessFromEnvironment("), "the server scrubs them right after reading them");
  assert.ok(serve.indexOf("scrubPrivateCaseTokens(process.env);") < serve.indexOf("await listenInnerSignalLoopback("), "before anything that starts a worker is built");
});

test("a start holds the folder's lock from making its tokens until its server has read them, so nothing rotates the credentials in between", async (t) => {
  const { home } = await clientFolder(t, ["Synthetic client one"]);
  const held = await acquireTrialFolderLock(home);
  try {
    // While the start holds it, it makes its tokens under it, and every other command is refused.
    const prepared = await prepareTrialFolder({ home, provider: "codex", locked: true });
    assert.equal(Object.keys(prepared.clientTokens).length, 1);
    await assert.rejects(prepareTrialFolder({ home, provider: "codex", lockWaitMs: 40 }), /Another runner-trial command is changing the trial folder/u);
    await assert.rejects(setJournalConsent({ home, number: 1, action: "confirm", lockWaitMs: 40 }), /Another runner-trial command/u);
  } finally {
    await held.release();
  }
  await held.release();
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "confirm" }), { changed: true, state: "confirmed" }, "released once, idempotently");
  const script = await fs.readFile(new URL("../scripts/runner-trial-start.mjs", import.meta.url), "utf8");
  const main = script.slice(script.indexOf("async function main("), script.indexOf("if (process.argv[1] && import.meta.url"));
  const at = (text) => { const index = main.indexOf(text); assert.ok(index >= 0, text); return index; };
  assert.ok(at("await acquireTrialFolderLock(resolvedHome)") < at("prepareTrialFolder({ home, provider: options.provider, locked: true })"));
  assert.ok(at("prepareTrialFolder({ home, provider: options.provider, locked: true })") < at("const ready = await untilReady("));
  const ready = at("const ready = await untilReady(");
  assert.ok(main.indexOf("await startLock.release();", ready) > ready, "released once the server answers");
  assert.equal(main.slice(at("async function startServer("), ready).includes("startLock.release()"), false, "and not before");
});

test("a command waits a moment for the folder's lock: a withdrawal asked while the trial holds it for an output is recorded right after", async (t) => {
  const { home } = await clientFolder(t, ["Synthetic client one"]);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  const held = await acquireTrialFolderLock(home);
  const withdrawal = setJournalConsent({ home, number: 1, action: "withdraw", lockWaitMs: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal((await readRunnerClients(home)).clients[0].journal.consent.withdrawn_at, null, "not while the output holds the folder");
  await held.release();
  assert.deepEqual(await withdrawal, { changed: true, state: "withdrawn" });
});

