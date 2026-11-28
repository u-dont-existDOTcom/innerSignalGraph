import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { acquireTrialFolderLock } from "../src/runner-trial/folder-lock.mjs";
import {
  JOURNAL_CONSENT_WORDS, TAB_CONSENT_WORDS, forgetClientCopy, journalConsentCurrent, readRunnerClients, tabConsentCounts, upgradeRunnerClients, validateRunnerClients,
  writeRunnerClients
} from "../src/runner-trial/clients.mjs";
import { JOURNAL_STEP_WORDS, createRunnerJournalSteps, journalStepGrant } from "../src/runner-trial/journal-steps.mjs";
import { recordRunnerConsentLocked } from "../src/runner-trial/people.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";

// The journal steps' stage 1 (docs/superpowers/specs/2026-11-26-runner-journal-upload-and-tab-design.md, 4.1, 4.2, 4.3 and 4.10;
// docs/superpowers/plans/2026-11-28-runner-journal-steps.md): the service's lock order and Delete wins, its one-time grants, adding a
// client and recording consent from the page in version 2's words, and the People tab. Every label is invented, with planted words
// looked for where none may be; no journal is read and no model is called.

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const parts = cutRuleParts(loadTherapyProtocol({ boxGuidance: true }));
const PLANTED = "Quillabrandt";
const LABEL = `Synthetic ${PLANTED} one`;
const T0 = "2026-11-28T08:00:00.000Z";
const CASE_A = "case-11111111-1111-4111-8111-111111111111";
const CASE_B = "case-22222222-2222-4222-8222-222222222222";
const OWN = "case-33333333-3333-4333-8333-333333333333";

const trialsOf = new WeakMap();
async function tempDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-${label}-`));
  trialsOf.set(t, trialsOf.get(t) ?? []);
  t.after(async () => { await Promise.all(trialsOf.get(t).map((trial) => trial.flushLogs())); await fs.rm(dir, { recursive: true, force: true }); });
  return dir;
}
const unwanted = () => { throw new Error("No worker may be called here."); };
const noWorkers = () => ({ call: unwanted });

// A trial folder made the start script's way, with its clients, and the trial's controller and server over its real vault.
async function trialServer(t, { labels = [LABEL, "Synthetic client two"], launcher = null } = {}) {
  const home = await tempDir(t, "runner-steps");
  await prepareTrialFolder({ home, provider: "codex" });
  for (const label of labels) await addClient({ home, label, now: () => new Date(T0) });
  const prepared = await prepareTrialFolder({ home, provider: "codex" });
  const providers = await loadDevelopmentPrivateCaseProviders(prepared.credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const caseAuthContexts = new Map(Object.entries(prepared.clientTokens).map(([caseId, token]) => [caseId, Object.freeze({ bearerToken: token })]));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialCaseId: prepared.caseId, runnerTrialDir: home, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, runnerRulesRoot: null, responseEvidenceEnforced: false });
  const order = [];
  const source = Object.create(service, { deletePrivateCase: { value: async (...args) => { order.push("vault"); return service.deletePrivateCase(...args); } } });
  const trial = createRunnerTrialController({ privateCaseSource: source, config, clientCaseIds: [...caseAuthContexts.keys()], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode: "whole" }), parts, workerFor: noWorkers });
  trialsOf.set(t, [...(trialsOf.get(t) ?? []), trial]);
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseAccessService: service, privateAuthContext: Object.freeze({ bearerToken: prepared.token }), privateCaseAuthContexts: caseAuthContexts,
    privateTherapyController: trial.controller, runnerTrialEvents: trial.events, ...(launcher ? { runnerLauncher: launcher } : {}) });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { home, prepared, trial, base, order, ownCase: prepared.caseId, clientCases: Object.keys(prepared.clientTokens), authFor: (caseId) => caseAuthContexts.get(caseId) ?? { bearerToken: prepared.token } };
}

async function post(base, route, body, headers = {}) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", origin: base, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => null), text: null };
}
async function people(base) {
  const response = await fetch(`${base}/v1/runner/people`, { headers: { origin: base } });
  return { status: response.status, cacheControl: response.headers.get("cache-control"), json: await response.json().catch(() => null) };
}
const listWith = (clients, ownJournal = null) => ({ schema_version: 2, own_journal: ownJournal, clients });
const client = (caseId, label, journal = {}) => ({ case_id: caseId, label, added_at: T0, journal: { corpus_id: null, consent: null, tab_consent: null, ...journal } });

test("the client list's version 2: a version 1 file is read as version 2 with its consents in version 1's words, every write is version 2, and a list of another shape is refused", async (t) => {
  const home = await tempDir(t, "runner-list");
  const v1 = { schema_version: 1, clients: [{ case_id: CASE_A, label: "Synthetic A", added_at: T0, journal: { corpus_id: null, consent: { confirmed_at: T0, withdrawn_at: null } } }] };
  await fs.writeFile(path.join(home, "clients.json"), `${JSON.stringify(v1)}\n`, { mode: 0o600 });
  const read = await readRunnerClients(home);
  assert.deepEqual(read, listWith([client(CASE_A, "Synthetic A", { consent: { confirmed_at: T0, withdrawn_at: null, words: 1 } })]));
  assert.equal(journalConsentCurrent(read.clients[0]), true, "a consent in version 1's words still holds for what it named");
  assert.equal(journalConsentCurrent(read.clients[0], { words: 2 }), false, "and not where version 2's words are needed");
  await writeRunnerClients(home, v1);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, "clients.json"), "utf8")).schema_version, 2, "written as version 2");
  const consent = { confirmed_at: T0, withdrawn_at: null, words: 2 };
  assert.doesNotThrow(() => validateRunnerClients(listWith([client(CASE_A, "Synthetic A", { consent, tab_consent: { confirmed_at: T0, withdrawn_at: null } })], { case_id: OWN, corpus_id: null, consent })));
  for (const bad of [
    listWith([client(CASE_A, "Synthetic A", { consent: { confirmed_at: T0, withdrawn_at: null } })]),
    listWith([client(CASE_A, "Synthetic A", { consent: { ...consent, words: 3 } })]),
    listWith([client(CASE_A, "Synthetic A", { tab_consent: { confirmed_at: T0, withdrawn_at: null, words: 2 } })]),
    listWith([{ ...client(CASE_A, "Synthetic A"), journal: { corpus_id: null, consent: null } }]),
    listWith([client(CASE_A, "Synthetic A")], { case_id: CASE_A, corpus_id: null, consent }),
    listWith([client(CASE_A, "Synthetic A")], { case_id: OWN, corpus_id: null, consent, tab_consent: null }),
    { schema_version: 2, clients: [] },
    { schema_version: 1, own_journal: null, clients: [] },
    { schema_version: 3, own_journal: null, clients: [] }
  ]) assert.throws(() => upgradeRunnerClients(bad), { code: "RUNNER_CLIENTS_INVALID" }, JSON.stringify(bad).slice(0, 120));
});

test("two consent parts, in every order of confirming and withdrawing: the Journal-tab consent is recorded only while the journal consent stands and counts only while both do; each withdrawal holds its own part", async (t) => {
  const home = await tempDir(t, "runner-consent-orders");
  const operations = [["confirm", "journal"], ["confirm", "tab"], ["withdraw", "journal"], ["withdraw", "tab"]];
  const sequences = operations.flatMap((a) => operations.flatMap((b) => operations.map((c) => [a, b, c])));
  let clock = Date.parse(T0);
  const now = () => new Date((clock += 1000));
  for (const sequence of sequences) {
    await writeRunnerClients(home, listWith([client(CASE_A, "Synthetic A")]));
    const model = { journal: false, tab: false };
    for (const [action, part] of sequence) {
      const call = recordRunnerConsentLocked({ trialDir: home, caseId: CASE_A, action, parts: [part], words: 2, now });
      if (action === "confirm" && part === "tab" && !model.journal) {
        await assert.rejects(call, { code: "RUNNER_TAB_CONSENT_NEEDS_JOURNAL" }, JSON.stringify(sequence));
        continue;
      }
      const { changed } = await call;
      assert.equal(changed, model[part] !== (action === "confirm"), JSON.stringify(sequence));
      model[part] = action === "confirm";
      const listed = (await readRunnerClients(home)).clients[0];
      assert.equal(journalConsentCurrent(listed), model.journal, JSON.stringify(sequence));
      assert.equal(tabConsentCounts(listed), model.journal && model.tab, JSON.stringify(sequence));
    }
  }
  // Both at once, in one write with one time; the owner's own case has no tab consent.
  await writeRunnerClients(home, listWith([client(CASE_A, "Synthetic A")]));
  await recordRunnerConsentLocked({ trialDir: home, caseId: CASE_A, action: "confirm", parts: ["tab", "journal"], words: 2, now: () => new Date(T0) });
  assert.deepEqual((await readRunnerClients(home)).clients[0].journal, { corpus_id: null, consent: { confirmed_at: T0, withdrawn_at: null, words: 2 }, tab_consent: { confirmed_at: T0, withdrawn_at: null } });
  await assert.rejects(recordRunnerConsentLocked({ trialDir: home, ownCaseId: OWN, caseId: OWN, action: "confirm", parts: ["tab"], words: 2 }), { code: "VALIDATION_ERROR" });
  await assert.rejects(recordRunnerConsentLocked({ trialDir: home, ownCaseId: OWN, caseId: CASE_B, action: "confirm", parts: ["journal"], words: 2 }), { code: "RUNNER_CASE_UNKNOWN" });
  for (const bad of [{ action: "maybe", parts: ["journal"] }, { action: "confirm", parts: [] }, { action: "confirm", parts: ["journal", "journal"] }, { action: "confirm", parts: ["other"] }]) {
    await assert.rejects(recordRunnerConsentLocked({ trialDir: home, caseId: CASE_A, words: 2, ...bad }), { code: "VALIDATION_ERROR" }, JSON.stringify(bad));
  }
});

test("consent versions: a confirmation records version 2's words over a standing version 1 consent and changes nothing over a version 2 one, refuses other words, and the command does the same; Delete keeps both parts", async (t) => {
  const home = await tempDir(t, "runner-consent-versions");
  await prepareTrialFolder({ home, provider: "codex" });
  await addClient({ home, label: "Synthetic A", now: () => new Date(T0) });
  const caseId = (await readRunnerClients(home)).clients[0].case_id;
  const asV1 = async () => {
    const list = await readRunnerClients(home);
    list.clients[0].journal = { ...list.clients[0].journal, consent: { confirmed_at: T0, withdrawn_at: null, words: 1 } };
    await writeRunnerClients(home, list);
  };
  await asV1();
  await assert.rejects(recordRunnerConsentLocked({ trialDir: home, caseId, action: "confirm", parts: ["journal"], words: 1 }), { code: "RUNNER_CONSENT_WORDS_OUTDATED" });
  await assert.rejects(recordRunnerConsentLocked({ trialDir: home, caseId, action: "confirm", parts: ["journal"] }), { code: "RUNNER_CONSENT_WORDS_OUTDATED" });
  const later = "2026-11-28T09:00:00.000Z";
  assert.equal((await recordRunnerConsentLocked({ trialDir: home, caseId, action: "confirm", parts: ["journal"], words: 2, now: () => new Date(later) })).changed, true, "Ask again in the new words");
  assert.deepEqual((await readRunnerClients(home)).clients[0].journal.consent, { confirmed_at: later, withdrawn_at: null, words: 2 });
  assert.equal((await recordRunnerConsentLocked({ trialDir: home, caseId, action: "confirm", parts: ["journal"], words: 2 })).changed, false, "a version 2 consent stays as it is");
  // The command, from pull request 3: version 2's words over version 1's, nothing over version 2's.
  await asV1();
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "confirm", now: () => new Date(later) }), { changed: true, state: "confirmed" });
  assert.equal((await readRunnerClients(home)).clients[0].journal.consent.words, 2);
  assert.deepEqual(await setJournalConsent({ home, number: 1, action: "confirm" }), { changed: false, state: "confirmed" });
  // Delete forgets the copy and keeps both consents as recorded.
  await recordRunnerConsentLocked({ trialDir: home, caseId, action: "confirm", parts: ["tab"], now: () => new Date(later) });
  const list = await readRunnerClients(home);
  list.clients[0].journal.corpus_id = "corpus-synthetic";
  await writeRunnerClients(home, list);
  await forgetClientCopy(home, caseId);
  assert.deepEqual((await readRunnerClients(home)).clients[0].journal, { corpus_id: null, consent: { confirmed_at: later, withdrawn_at: null, words: 2 }, tab_consent: { confirmed_at: later, withdrawn_at: null } });
  assert.match(JOURNAL_CONSENT_WORDS, /^InnerSignal may use my journal in these sessions\. When it is added, the whole journal goes to OpenAI, whose model \(GPT\) reads all of it before it is copied in; in the sessions and their tests, my words and excerpts of my journal go to Anthropic and OpenAI, whose models answer, check and write the test's questions\.$/u);
});

test("the owner's own journal: \"Use my journal\" records his consent in version 2's words without a tab consent, the next start gives his grant session_use while it stands and drops it after a withdrawal, and a list naming another case as his stops the start", async (t) => {
  const s = await trialServer(t, { labels: [LABEL] });
  const recorded = await post(s.base, "/v1/runner/consent", { caseId: s.ownCase, action: "confirm", parts: ["journal"], words: 2 });
  assert.deepEqual([recorded.status, recorded.json], [200, { caseId: s.ownCase, changed: true }]);
  assert.equal((await post(s.base, "/v1/runner/consent", { caseId: s.ownCase, action: "confirm", parts: ["tab"], words: 2 })).status, 400);
  const own = (await readRunnerClients(s.home)).own_journal;
  assert.deepEqual([own.case_id, own.corpus_id, own.consent.words, own.consent.withdrawn_at, Object.keys(own).sort()], [s.ownCase, null, 2, null, ["case_id", "consent", "corpus_id"]]);
  assert.deepEqual((await people(s.base)).json.people[0], { caseId: s.ownCase, kind: "own", number: null, label: null, ready: true, journal: { consent: "confirmed", words: 2 } });
  const grants = async () => JSON.parse(await fs.readFile(path.join(s.home, "credentials.json"), "utf8")).grants;
  await prepareTrialFolder({ home: s.home, provider: "codex" });
  assert.deepEqual((await grants())[0].purposes, ["session_use"]);
  await post(s.base, "/v1/runner/consent", { caseId: s.ownCase, action: "withdraw", parts: ["journal"] });
  await prepareTrialFolder({ home: s.home, provider: "codex" });
  assert.equal((await grants())[0].purposes, undefined);
  const list = await readRunnerClients(s.home);
  list.own_journal.case_id = CASE_B;
  await writeRunnerClients(s.home, list);
  await assert.rejects(prepareTrialFolder({ home: s.home, provider: "codex" }), /names another case than yours/u);
});

test("Add a client from the page shares the command's function: the keys first, then the list; the label goes into the list alone, and the client is ready after a restart", async (t) => {
  const s = await trialServer(t, { labels: [] });
  const added = await post(s.base, "/v1/runner/people/add", { label: `  ${LABEL}  ` });
  assert.deepEqual([added.status, added.json], [200, { added: true, number: 1, ready: false }]);
  const [listed] = (await readRunnerClients(s.home)).clients;
  assert.deepEqual([listed.label, listed.journal], [LABEL, { corpus_id: null, consent: null, tab_consent: null }]);
  assert.ok(JSON.parse(await fs.readFile(path.join(s.home, "credentials.json"), "utf8")).case_keys[listed.case_id], "the keys are there");
  const view = await people(s.base);
  assert.deepEqual([view.status, view.cacheControl, view.json.people.slice(1)], [200, "no-store",
    [{ caseId: listed.case_id, kind: "client", number: 1, label: LABEL, ready: false, journal: { consent: "none", words: null, tabConsent: "none" } }]]);
  assert.deepEqual(view.json.words, { journal: { version: 2, text: JOURNAL_CONSENT_WORDS }, tab: { text: TAB_CONSENT_WORDS } });
  const clients = await (await fetch(`${s.base}/v1/runner/clients`, { headers: { origin: s.base } })).json();
  assert.deepEqual([clients.clientsAwaitingRestart, clients.cases.map((entry) => entry.kind)], [1, ["own"]], "the conversations wait for the restart");
  // A consent may be recorded for them before the restart: it holds from the next start.
  assert.equal((await post(s.base, "/v1/runner/consent", { caseId: listed.case_id, action: "confirm", parts: ["journal", "tab"], words: 2 })).status, 200);
  const refusals = [
    [await post(s.base, "/v1/runner/people/add", { label: LABEL.toUpperCase() }), 409, "RUNNER_CLIENT_LABEL_TAKEN"],
    [await post(s.base, "/v1/runner/people/add", { label: `${PLANTED}\nsecond line` }), 400, "VALIDATION_ERROR"],
    [await post(s.base, "/v1/runner/people/add", { label: 42 }), 400, "VALIDATION_ERROR"]
  ];
  for (const [answer, status, code] of refusals) {
    assert.deepEqual([answer.status, answer.json.code], [status, code]);
    assert.equal(JSON.stringify(answer.json).includes(PLANTED), false, "an error never repeats the label");
  }
  assert.equal(JSON.stringify(added.json).includes(PLANTED), false);
  await s.trial.flushLogs();
  for (const name of await fs.readdir(s.home)) {
    if (name === "clients.json" || !(await fs.stat(path.join(s.home, name))).isFile()) continue;
    assert.equal((await fs.readFile(path.join(s.home, name), "utf8")).includes(PLANTED), false, name);
  }
});

// A request as given, Host and all, which fetch won't send: the status alone.
function rawPost(base, route, headers, text) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, path: route, method: "POST", headers: { "content-length": Buffer.byteLength(text), ...headers } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.once("error", reject);
    request.end(text);
  });
}

test("the people and consent routes answer only the owner's page on this machine, as a JSON object of at most 1 KiB naming a case on the trial's list; with the trial off they don't exist", async (t) => {
  const s = await trialServer(t, { labels: [LABEL] });
  const consent = JSON.stringify({ caseId: s.clientCases[0], action: "confirm", parts: ["journal"], words: 2 });
  const label = JSON.stringify({ label: "Synthetic client two" });
  const json = { "content-type": "application/json" };
  const host = new URL(s.base).host;
  for (const [route, valid] of [["/v1/runner/consent", consent], ["/v1/runner/people/add", label]]) {
    const refusals = [
      [{ ...json, origin: s.base, authorization: "Bearer synthetic" }, valid, 403, "an agent's bearer token"],
      [{ ...json, origin: "http://synthetic.invalid" }, valid, 403, "another Origin"],
      [{ ...json, host: "synthetic.invalid", origin: "http://synthetic.invalid" }, valid, 403, "another Host"],
      [{ ...json }, valid, 403, "no Origin"],
      [{ "content-type": "text/plain", origin: s.base }, valid, 415, "another content type"],
      [{ ...json, origin: s.base }, JSON.stringify({ ...JSON.parse(valid), padding: "x".repeat(1100) }), 413, "a body over the limit"],
      [{ ...json, origin: s.base }, "[]", 400, "not an object"],
      [{ ...json, origin: s.base }, "{", 400, "not JSON"]
    ];
    for (const [headers, text, status, what] of refusals) assert.equal(await rawPost(s.base, route, { host, ...headers }, text), status, `${route}: ${what}`);
  }
  assert.equal((await post(s.base, "/v1/runner/consent", { ...JSON.parse(consent), caseId: CASE_B })).json.code, "RUNNER_CASE_UNKNOWN", "a case that isn't on the trial's list");
  assert.equal((await post(s.base, "/v1/runner/consent", { ...JSON.parse(consent), caseId: "../synthetic" })).status, 400);
  const list = await readRunnerClients(s.home);
  assert.deepEqual([list.clients.length, list.clients[0].journal.consent], [1, null], "nothing refused was recorded or added");
  for (const headers of [{ origin: "http://synthetic.invalid" }, { origin: s.base, authorization: "Bearer synthetic" }]) {
    assert.notEqual((await fetch(`${s.base}/v1/runner/people`, { headers })).status, 200, JSON.stringify(headers));
  }
  assert.equal((await post(s.base, "/v1/runner/people", {})).status, 404, "the people view is read with GET only");
  const offConfig = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: false });
  const off = createInnerSignalServer({ config: offConfig, providers: createProviders(offConfig) });
  await new Promise((resolve) => { off.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => { off.close(resolve); }));
  const offBase = `http://127.0.0.1:${off.address().port}`;
  for (const route of ["/v1/runner/consent", "/v1/runner/people/add"]) assert.equal((await post(offBase, route, JSON.parse(consent))).status, 404, route);
  assert.equal((await people(offBase)).status, 404);
});

test("the one-time grants of the journal steps open one case alone, with the scopes and purposes the store asks: a copy's read and write with archive, organize_search and session_use; a tombstone's write with delete", async () => {
  const copy = journalStepGrant(CASE_A, "copy");
  const tombstone = journalStepGrant(CASE_A, "tombstone");
  const ask = (grant, requiredScope, { caseId = CASE_A, authContext = grant.authContext } = {}) => grant.authorizationProvider.authorize({ caseId, authContext, requiredScope });
  assert.deepEqual(await ask(copy, "case:read"), { allowed: true, principalId: "runner-trial-journal-step", scopes: ["case:read"], purposes: ["archive", "organize_search", "session_use"] });
  assert.equal((await ask(copy, "case:write")).allowed, true);
  assert.equal((await ask(copy, "case:audit")).allowed, false);
  assert.deepEqual(await ask(tombstone, "case:write"), { allowed: true, principalId: "runner-trial-journal-step", scopes: ["case:write"], purposes: ["delete"] });
  assert.equal((await ask(tombstone, "case:read")).allowed, false);
  assert.equal((await ask(copy, "case:read", { caseId: CASE_B })).allowed, false, "another case");
  assert.equal((await ask(copy, "case:read", { authContext: tombstone.authContext })).allowed, false, "another step's token");
  assert.throws(() => journalStepGrant(CASE_A, "export"), { code: "VALIDATION_ERROR" });
});

test("a journal step takes the case's queue first and the folder's lock inside it: while it waits for the queue it holds no lock, and a lock held past the wait tells the page the runner is busy", async (t) => {
  const s = await trialServer(t, { labels: [LABEL] });
  const steps = s.trial.journalSteps;
  const caseId = s.clientCases[0];
  let letTurnEnd;
  const turn = s.trial.controller.inCaseQueue(caseId, () => new Promise((resolve) => { letTurnEnd = resolve; }));
  const insideLock = [];
  const step = steps.inQueue(steps.admit(caseId), async () => {
    await assert.rejects(acquireTrialFolderLock(s.home, { waitMs: 0 }), { code: "RUNNER_FOLDER_LOCKED" });
    insideLock.push("ran");
  }, { lock: true });
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  const free = await acquireTrialFolderLock(s.home, { waitMs: 0 });
  await free.release();
  assert.deepEqual(insideLock, [], "the step waits for the turn");
  letTurnEnd();
  await turn;
  await step;
  assert.deepEqual(insideLock, ["ran"]);
  const quick = createRunnerJournalSteps({ trialDir: s.home, inCaseQueue: (id, operation) => operation(), lockWaitMs: 40 });
  const held = await acquireTrialFolderLock(s.home, { waitMs: 0 });
  t.after(() => held.release());
  await assert.rejects(quick.recordConsent({ caseId, action: "confirm", parts: ["journal"], words: 2 }), (error) => error.code === "RUNNER_FOLDER_BUSY" && error.message === JOURNAL_STEP_WORDS.RUNNER_FOLDER_BUSY);
});

test("Delete wins: no journal work of a case is admitted while it is deleted; work admitted before stops at its next check; the work running is stopped and waited for before Delete takes the case's queue; afterwards the case starts afresh", async (t) => {
  const s = await trialServer(t, { labels: [LABEL] });
  const steps = s.trial.journalSteps;
  const caseId = s.clientCases[0];
  const before = steps.admit(caseId);
  const other = steps.admit(s.ownCase);
  let stopped;
  const stopSignal = new Promise((resolve) => { stopped = resolve; });
  const events = [];
  // A piece of work that, once stopped, still tries its last step in the case's queue, as a copy's does: Delete must not hold the queue.
  const work = steps.track(before, async () => {
    await stopSignal;
    events.push("stopped");
    await assert.rejects(steps.inQueue(before, async () => { events.push("last step ran"); }), { code: "RUNNER_JOURNAL_CASE_DELETED" });
    events.push("settled");
  }, { stop: () => stopped() });
  const deletion = s.trial.controller.deleteCase({ caseId, authContext: s.authFor(caseId) });
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.throws(() => steps.admit(caseId), (error) => error.code === "RUNNER_JOURNAL_CASE_DELETING" && error.message === JOURNAL_STEP_WORDS.RUNNER_JOURNAL_CASE_DELETING);
  await work;
  await deletion;
  assert.deepEqual([...events, ...s.order], ["stopped", "settled", "vault"], "the work ended before the vault was touched");
  assert.throws(() => steps.check(before), { code: "RUNNER_JOURNAL_CASE_DELETED" });
  await assert.rejects(steps.inQueue(before, async () => { events.push("late"); }, { lock: true }), { code: "RUNNER_JOURNAL_CASE_DELETED" });
  assert.equal(events.includes("late"), false);
  assert.doesNotThrow(() => steps.check(other), "another case's work goes on");
  const after = steps.admit(caseId);
  assert.equal(await steps.inQueue(after, async () => "ran", { lock: true }), "ran", "the case starts afresh once the deletion is over");
  // A deletion that fails lets the mark go all the same.
  const failing = createRunnerJournalSteps({ trialDir: s.home, inCaseQueue: (id, operation) => operation() });
  const release = await failing.stopForDeletion(CASE_A);
  assert.equal(failing.deleting(CASE_A), true);
  release();
  release();
  assert.equal(failing.deleting(CASE_A), false);
});

// The People tab in the page's own markup, with the browser's fetch and confirm stood in for: `answers[url]` are the answers in turn.
async function peoplePage(t, { view, launcher = "on", answers = {} }) {
  const [html, app] = await Promise.all(["apps/web/index.html", "apps/web/app.js"].map((relative) => fs.readFile(path.join(repositoryRoot, relative), "utf8")));
  const dom = new JSDOM(html, { url: "http://127.0.0.1:8797/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
  const fetched = [];
  const asked = [];
  const page = { confirm: true, view };
  const queues = Object.fromEntries(Object.entries(answers).map(([url, list]) => [url, [...list]]));
  const context = vm.createContext({
    document,
    $: (selector) => document.querySelector(selector),
    runnerTrial: { launcher },
    fetch: async (url, init = {}) => {
      fetched.push({ url, method: init.method ?? "GET", body: init.body ?? null });
      if (url === "/v1/runner/people") return { ok: true, status: 200, json: async () => structuredClone(page.view) };
      const queue = queues[url] ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0] ?? { status: 200, body: {} };
      return { ok: next.status < 400, status: next.status, json: async () => structuredClone(next.body) };
    },
    confirm: (words) => { asked.push(words); return page.confirm; }
  });
  vm.runInContext(between("// runner-people:start", "// runner-people:end"), context);
  let changes = 0;
  context.afterChange = () => { changes += 1; };
  vm.runInContext("initRunnerPeople({ afterChange: () => afterChange() })", context);
  await vm.runInContext("loadRunnerPeople()", context);
  const rows = () => [...document.querySelectorAll("#runner-people li")].map((item) => [...item.querySelectorAll("h3, p, button")].map((node) => node.textContent));
  const button = (rowIndex, words) => [...document.querySelectorAll("#runner-people li")[rowIndex].querySelectorAll("button")].find((node) => node.textContent === words);
  const settle = () => new Promise((resolve) => { setTimeout(resolve, 10); });
  const stored = () => JSON.stringify({ local: { ...dom.window.localStorage }, session: { ...dom.window.sessionStorage }, href: dom.window.location.href });
  return { document, context, fetched, asked, page, rows, button, settle, stored, changes: () => changes };
}

const wordsView = { journal: { version: 2, text: JOURNAL_CONSENT_WORDS }, tab: { text: TAB_CONSENT_WORDS } };
const viewOf = (entries) => ({ people: entries, words: wordsView });
const ownEntry = (consent = "none") => ({ caseId: OWN, kind: "own", number: null, label: null, ready: true, journal: { consent, words: consent === "none" ? null : 2 } });
const clientEntry = (journal, { ready = true, label = LABEL, caseId = CASE_A, number = 1 } = {}) => ({ caseId, kind: "client", number, label, ready, journal: { consent: "none", words: null, tabConsent: "none", ...journal } });

test("the People tab lists You and each client by number and label as text, says who is ready only after a restart, and offers each consent in the words the server gives", async (t) => {
  const markup = `<b>${PLANTED}</b>`;
  const p = await peoplePage(t, { view: viewOf([ownEntry(), clientEntry({}, { ready: false, label: markup }), clientEntry({ consent: "confirmed", words: 1 }, { caseId: CASE_B, number: 2 })]) });
  assert.deepEqual(p.rows(), [
    ["You", "Your journal: no consent recorded.", "Use my journal"],
    [`1. ${markup}`, "Ready after a restart. Press Restart at the top.", "Journal: no consent recorded.", "Journal tab: not allowed.", "Record consent"],
    [`2. ${LABEL}`, "Journal: consent given in the earlier words, which don't name the reading of the whole journal by OpenAI's GPT: ask again in the new words before a journal file is added.", "Journal tab: not allowed.", "Ask again in the new words", "Withdraw journal consent"]
  ]);
  assert.equal(p.document.querySelector("#runner-people b"), null, "a label is text, never markup");
  // Ask again in the new words: both questions, in the server's words.
  p.button(2, "Ask again in the new words").click();
  const questions = [...p.document.querySelectorAll("#runner-consent-questions .runner-consent-words")].map((node) => node.textContent);
  assert.deepEqual(questions, [`"${JOURNAL_CONSENT_WORDS}"`, `"${TAB_CONSENT_WORDS}"`]);
  p.document.querySelector("#runner-consent-record").click();
  await p.settle();
  assert.equal(p.document.querySelector("#runner-people-status").textContent, "Tick what was agreed to, or press Cancel.");
  for (const tick of p.document.querySelectorAll("#runner-consent-questions input")) tick.checked = true;
  p.document.querySelector("#runner-consent-record").click();
  await p.settle();
  assert.equal(p.asked.at(-1), `Record that 2. ${LABEL} agreed to:\n\n"${JOURNAL_CONSENT_WORDS}"\n\n"${TAB_CONSENT_WORDS}"\n\nThe time is recorded with it.`);
  const sent = p.fetched.find((entry) => entry.url === "/v1/runner/consent");
  assert.deepEqual(JSON.parse(sent.body), { caseId: CASE_B, action: "confirm", parts: ["journal", "tab"], words: 2 });
  assert.equal(p.changes(), 1);
  // Record consent for a client with none: the tab alone is refused on the page too.
  p.button(1, "Record consent").click();
  const ticks = [...p.document.querySelectorAll("#runner-consent-questions input")];
  ticks.find((tick) => tick.dataset.part === "tab").checked = true;
  p.document.querySelector("#runner-consent-record").click();
  await p.settle();
  assert.equal(p.document.querySelector("#runner-people-status").textContent, "The Journal-tab consent can be recorded only with the journal consent.");
  assert.equal(p.fetched.filter((entry) => entry.url === "/v1/runner/consent").length, 1);
  p.document.querySelector("#runner-consent-cancel").click();
  assert.equal(p.document.querySelector("#runner-consent-form").hidden, true);
  // Use my journal: the journal's words alone.
  p.button(0, "Use my journal").click();
  assert.deepEqual([...p.document.querySelectorAll("#runner-consent-questions .runner-consent-words")].map((node) => node.textContent), [`"${JOURNAL_CONSENT_WORDS}"`]);
  assert.equal(p.document.querySelector("#runner-consent-questions label").textContent, " I agree to this");
});

test("each consent is withdrawn from the same place after the page asks once; a refusal says why in the server's fixed words", async (t) => {
  const p = await peoplePage(t, {
    view: viewOf([ownEntry("confirmed"), clientEntry({ consent: "withdrawn", words: 2, tabConsent: "confirmed" }), clientEntry({ consent: "confirmed", words: 2, tabConsent: "confirmed" }, { caseId: CASE_B, number: 2 })]),
    answers: { "/v1/runner/consent": [{ status: 503, body: { error: JOURNAL_STEP_WORDS.RUNNER_FOLDER_BUSY, code: "RUNNER_FOLDER_BUSY" } }, { status: 200, body: { changed: true } }] }
  });
  assert.deepEqual(p.rows()[1], [`1. ${LABEL}`, "Journal: consent withdrawn. Nothing uses their journal; a case that has used it gives no replies until the consent is recorded again or the case is deleted.",
    "Journal tab: allowed, but hidden while the journal consent doesn't stand.", "Record consent", "Withdraw Journal-tab consent"]);
  p.button(1, "Record consent").click();
  assert.equal(p.document.querySelector("#runner-consent-questions .small").textContent.startsWith("Their Journal-tab consent recorded earlier counts again"), true);
  p.document.querySelector("#runner-consent-cancel").click();
  p.button(2, "Withdraw Journal-tab consent").click();
  await p.settle();
  assert.equal(p.document.querySelector("#runner-people-status").textContent, `Not withdrawn: ${JOURNAL_STEP_WORDS.RUNNER_FOLDER_BUSY}`);
  p.button(2, "Withdraw journal consent").click();
  await p.settle();
  assert.equal(p.asked.at(-1), `Withdraw 2. ${LABEL}'s journal consent? From now on nothing uses their journal, also while the runner runs, and their Journal tab is hidden. A case that has used the journal gives no replies until the consent is recorded again or the case is deleted.`);
  assert.deepEqual(p.fetched.filter((entry) => entry.url === "/v1/runner/consent").map((entry) => JSON.parse(entry.body)), [
    { caseId: CASE_B, action: "withdraw", parts: ["tab"] }, { caseId: CASE_B, action: "withdraw", parts: ["journal"] }
  ]);
  p.page.confirm = false;
  p.button(0, "Withdraw my journal consent").click();
  await p.settle();
  assert.equal(p.asked.at(-1), "Withdraw your journal consent? From now on nothing uses your journal.");
  assert.equal(p.fetched.filter((entry) => entry.url === "/v1/runner/consent").length, 2, "nothing is sent without the yes");
});

test("Add a client sends the label in a JSON body alone and clears the field; the page keeps no label in its storage or its address", async (t) => {
  const p = await peoplePage(t, { view: viewOf([ownEntry()]), launcher: "off", answers: { "/v1/runner/people/add": [{ status: 409, body: { error: "Another client already has that label; choose another.", code: "RUNNER_CLIENT_LABEL_TAKEN" } }, { status: 200, body: { added: true, number: 1, ready: false } }] } });
  const field = p.document.querySelector("#runner-add-client-label");
  assert.equal(field.hasAttribute("name"), false, "a field without a name can't go into a form's address");
  p.document.querySelector("#runner-add-client-button").click();
  await p.settle();
  assert.equal(p.document.querySelector("#runner-people-status").textContent, "Type the label first.");
  field.value = LABEL;
  p.document.querySelector("#runner-add-client-button").click();
  await p.settle();
  assert.equal(p.document.querySelector("#runner-people-status").textContent, "Not added: Another client already has that label; choose another.");
  assert.equal(field.value, LABEL, "kept to be changed");
  p.page.view = viewOf([ownEntry(), clientEntry({}, { ready: false })]);
  p.document.querySelector("#runner-add-client-button").click();
  await p.settle();
  assert.equal(field.value, "");
  assert.equal(p.document.querySelector("#runner-people-status").textContent, "Added client 1. Ready after a restart. Start the runner again.");
  const adds = p.fetched.filter((entry) => entry.url === "/v1/runner/people/add");
  assert.deepEqual(adds.map((entry) => [entry.method, JSON.parse(entry.body)]), [["POST", { label: LABEL }], ["POST", { label: LABEL }]]);
  assert.equal(p.fetched.every((entry) => !entry.url.includes(PLANTED)), true, "no label in an address");
  assert.equal(p.stored().includes(PLANTED), false, "no label in the page's storage or address");
  assert.equal(p.changes(), 1);
});
