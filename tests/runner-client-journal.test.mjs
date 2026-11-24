import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { SESSION_USE_READER_VERSION } from "../src/journal-import/response-evidence-journal.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { RUNNER_UNAVAILABLE_NOTICE } from "../src/runner-trial/notices.mjs";
import { CHECKER_EVIDENCE_NOTE, CHECKER_EVIDENCE_NOTE_NO_QUOTATION, WRITER_EVIDENCE_NOTE, WRITER_EVIDENCE_NOTE_NO_QUOTATION } from "../src/runner-trial/worker-prompts.mjs";
import { runnerLogFromRecord } from "../src/runner-trial/run-log.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { COLD_TEST_RULE } from "../src/runner-trial/cold-test-rule.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, buildResponseEvidenceSnapshot } from "../src/supervisor/response-evidence-contract.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { serializeVaultEnvelope } from "../src/storage/private-case-store.mjs";
import { createVaultEnvelope } from "../src/storage/vault-crypto.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";
import { asIfNoJournalWasRead } from "./helpers/evidence-case.mjs";

// A client's journal in the runner trial (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, points 4 to 7): the
// journal gate (consent, a published session_use copy in the client's runner case, a cold-test receipt for exactly that copy) and
// pull request 241's response evidence wired into the trial's writer, checker, repair and delivery; and "Delete this case" of a case
// that has read its journal, through the server's route and the page's own code. Every journal here is the journal import's synthetic
// fixture, every client and message is invented, the cold-test receipt is planted by the test (the cold test has its own tests), and
// every worker is a stand-in: no model is called and no real record or journal is read.

const parts = cutRuleParts(loadTherapyProtocol({ boxGuidance: true }));
const CORPUS = "corpus:synthetic-copy";
// The session-use reader makes one lexical search of the latest message: words the synthetic journal holds.
const MESSAGE = "ask for help";
const quietReader = () => ({ level: "none", wish_or_intent: "not_applicable", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: "nothing of the kind", provisional_reply: null });
const packetOf = (request) => JSON.parse(request.user.slice(request.user.indexOf("\n") + 1));
const journalItems = (packet) => (packet.response_evidence?.source_items ?? []).filter((item) => item.kind === "journal_quotation");

// The writer quotes the first journal quotation it is given, declared with its source id; with none, it writes from the message.
function writer(_count, request) {
  const [item] = journalItems(packetOf(request));
  return item
    ? { reply: `You wrote: "${item.exact_excerpt}" What was different that day?`, answered_level: "none", quotes: [{ text: item.exact_excerpt, source_id: item.id }] }
    : { reply: "What makes asking hard for you?", answered_level: "none", quotes: [] };
}
// The whole checker passes the reply and, with response evidence, reviews it: a journal quotation it repeats is the person's own
// written account (supported by that source); nothing else in it rests on history.
function wholeChecker(_count, request) {
  const packet = packetOf(request);
  const base = { findings: [], level: "none", repair_induced_checks: [], missed_boxes: [] };
  if (!packet.response_evidence) return base;
  const quoted = journalItems(packet).find((item) => packet.candidate_reply.includes(item.exact_excerpt));
  return {
    ...base,
    evidence_review: {
      coverage: RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: quoted && dimension === "personal_history" ? "assessed" : "no_applicable_items", reason: "Synthetic review." })),
      items: quoted ? [{ id: "item-1", dimension: "personal_history", kind: "claim", candidate_quote: quoted.exact_excerpt, quote_occurrence: 1, source_ids: [quoted.id], assessment: "supported", reason: "The person's own journal says so." }] : [],
      missing_material_history: []
    }
  };
}
const script = (overrides = {}) => ({ R1: quietReader, R2: () => ({ boxes: ["IC.SAFETY_ORIENTATION"] }), R3: () => ({ compatibility_assessment: null }), W: writer, CW: wholeChecker, ...overrides });

function fakeWorkers(byRole) {
  const calls = [];
  let session = 0;
  return {
    calls,
    workerFor: (role) => ({
      async call(request) {
        const count = calls.filter((entry) => entry.role === role).length + 1;
        calls.push({ role, request });
        const value = await byRole[role](count, request);
        session += 1;
        return { value, receipt: { provider: "fake", model: "fake", session_id: `fake-${role}-${session}` } };
      }
    })
  };
}

async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function respond(base, caseId, exchangeId, userMessage = MESSAGE) {
  const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId, exchangeId, userMessage }) });
  return { status: response.status, json: await response.json().catch(() => null) };
}

// The journal import's synthetic graph and sources, named for this client's case and corpus.
async function syntheticJournal(caseId) {
  const read = async (name) => (await fs.readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
  const graph = JSON.parse((await read("synthetic-graph.json")).replaceAll('"synthetic-case"', JSON.stringify(caseId)).replaceAll('"synthetic-corpus"', JSON.stringify(CORPUS)));
  return { graph, sources: JSON.parse(await read("synthetic-sources.json")) };
}

// A trial folder with two invented clients; client one has a journal copy published in their runner case (made here the way the
// copy step will, which isn't built), and, unless told otherwise, the owner's confirmation of their consent and a planted cold-test
// receipt for exactly that copy. The server runs on the folder's real development credentials, with response evidence on unless
// told otherwise.
// `configured` adds to the trial's config (a switch of its own).
async function journalTrial(t, { evidence = true, consent = true, receipt = "match", workers = script(), checkerMode = "whole", configured = {} } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-runner-journal-"));
  // Each case's run log is written after its turn; the folder goes only once every trial's writes are done.
  const trials = [];
  t.after(async () => { await Promise.all(trials.map((trial) => trial.flushLogs())); await fs.rm(home, { recursive: true, force: true }); });
  await prepareTrialFolder({ home, provider: "codex" });
  await addClient({ home, label: "Synthetic client one" });
  await addClient({ home, label: "Synthetic client two" });
  if (consent) await setJournalConsent({ home, number: 1, action: "confirm" });
  const prepared = await prepareTrialFolder({ home, provider: "codex" });
  const { clients } = await readRunnerClients(home);
  const [clientA, clientB] = clients.map((client) => client.case_id);
  const providers = await loadDevelopmentPrivateCaseProviders(prepared.credentialsPath);
  t.after(() => providers.close());
  // The copy: written with every journal purpose, as the copy step's one-time grant will (design, point 4).
  const copier = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: { async authorize({ caseId, requiredScope }) {
    return { allowed: caseId === clientA, principalId: "synthetic-copy-step", scopes: [requiredScope], purposes: Object.values(PRIVATE_JOURNAL_PURPOSES) };
  } }, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const copyAuth = { bearerToken: "synthetic-copy-step" };
  const { graph, sources } = await syntheticJournal(clientA);
  await copier.createJournalCorpus(clientA, { corpusId: CORPUS, manifestObjectId: "manifest:staging" }, copyAuth);
  let persisted;
  await copier.withJournalCorpus(clientA, CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096 });
  }, copyAuth);
  await copier.publishJournalGeneration(clientA, { corpusId: CORPUS, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, copyAuth);
  const list = await readRunnerClients(home);
  list.clients[0].journal.corpus_id = CORPUS;
  await writeRunnerClients(home, list);
  const { reference } = await copier.inspectJournalCorpus(clientA, CORPUS, { requiredScope: "case:read", requiredPurpose: "session_use" }, copyAuth);
  const plantReceipt = async (overrides = {}) => {
    const folder = clientJournalFolder(home, clientA);
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(folder, COLD_TEST_RECEIPT_FILE), JSON.stringify({ schema_version: 2, kind: "journal_cold_test", result: "pass", case_id: clientA, corpus_id: CORPUS,
      generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch, tested_at: "2026-11-24T08:00:00.000Z",
      reader_version: SESSION_USE_READER_VERSION, rule: COLD_TEST_RULE.version, questions: { answerable: 40, unanswerable: 20, planted: 20 }, author: "person",
      consumer: { provider: "openai", model: "codex default" }, judge: { provider: "anthropic", model: "claude-opus-5-5" }, run: 1, ...overrides }), { mode: 0o600 });
  };
  // A receipt of the cold test's first design, which names no reader: with it, the journal is as if it weren't tested.
  const plantFirstReceipt = async () => {
    await plantReceipt();
    const file = path.join(clientJournalFolder(home, clientA), COLD_TEST_RECEIPT_FILE);
    const { reader_version: _reader, rule: _rule, questions: _questions, author: _author, consumer: _consumer, judge: _judge, run: _run, ...first } = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({ ...first, schema_version: 1 }), { mode: 0o600 });
  };
  if (receipt === "match") await plantReceipt();
  if (receipt === "other-generation") await plantReceipt({ generation: "generation-0" });
  const serviceWith = (on) => createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true, responseEvidencePolicy: on ? "enforced" : "advisory" });
  const service = serviceWith(evidence);
  const caseAuthContexts = new Map(Object.entries(prepared.clientTokens).map(([caseId, token]) => [caseId, Object.freeze({ bearerToken: token })]));
  const ownAuth = Object.freeze({ bearerToken: prepared.token });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialCaseId: prepared.caseId, runnerTrialDir: home, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, runnerRulesRoot: null, responseEvidenceEnforced: evidence, ...configured });
  const fake = fakeWorkers(workers);
  const makeTrial = (source = service) => createRunnerTrialController({ privateCaseSource: source, config, clientCaseIds: [...caseAuthContexts.keys()], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode }), parts, workerFor: fake.workerFor });
  return {
    home, prepared, service, copier, copyAuth, ownAuth, caseAuthContexts, clientA, clientB, ownCase: prepared.caseId, calls: fake.calls, reference, sources, plantReceipt, plantFirstReceipt, makeTrial,
    // Turns on the trial's controller itself, client one's unless told otherwise, with everything that happens kept in one order: each
    // event the turn's page would get, each journal search as it starts (`search`; the one place the copy is opened), each evidence
    // snapshot as it is frozen (`freeze`) and each worker's call as it starts (its role). `onSearch`, when given, is awaited as a search
    // starts; `stopAt` names a store call at which the process stops for good (`stopped` resolves then); `withClients: false` is a
    // trial without clients, which has no journal reader; `evidenceOff` one started again with response evidence off.
    turns({ onSearch = null, stopAt = null, withClients = true, evidenceOff = false } = {}) {
      const happened = [];
      let reached;
      const stopped = new Promise((resolve) => { reached = resolve; });
      const cases = evidenceOff ? serviceWith(false) : service;
      const source = {
        ...cases,
        async withJournalCorpus(...args) {
          happened.push("search");
          if (onSearch) await onSearch(happened);
          return cases.withJournalCorpus(...args);
        },
        async freezeResponseEvidence(...args) { happened.push("freeze"); return cases.freezeResponseEvidence(...args); }
      };
      if (stopAt) source[stopAt] = () => { reached(); return new Promise(() => {}); };
      const trial = createRunnerTrialController({ privateCaseSource: source, config: evidenceOff ? { ...config, responseEvidenceEnforced: false } : config, clientCaseIds: withClients ? [...caseAuthContexts.keys()] : [], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode }), parts,
        workerFor: (role) => ({ call: (request) => { happened.push(role); return fake.workerFor(role).call(request); } }) });
      trials.push(trial);
      return {
        trial, happened, stopped,
        async run(exchange, userMessage, { userInput = {}, caseId = clientA } = {}) {
          const unsubscribe = trial.events.subscribe(caseId, `runtime:${exchange}`, (event) => happened.push(event.type === "status" ? event.step : event.type));
          try {
            return await trial.controller.run({ caseId, runtimeTurnId: `runtime:${exchange}`, exchangeId: exchange, userTurnId: `${exchange}-user`, assistantTurnId: `${exchange}-assistant`, userMessage, userInput,
              authContext: caseId === prepared.caseId ? ownAuth : caseAuthContexts.get(caseId) });
          } finally { unsubscribe(); }
        }
      };
    },
    async serve(source = service) {
      const trial = makeTrial(source);
      trials.push(trial);
      return { trial, base: await listen(t, createInnerSignalServer({ config, providers: createProviders(config), privateCaseAccessService: service, privateAuthContext: ownAuth, privateCaseAuthContexts: caseAuthContexts, privateTherapyController: trial.controller, runnerTrialEvents: trial.events })) };
    },
    record: (caseId) => service.loadPrivateRuntimeCase(caseId, caseId === prepared.caseId ? ownAuth : caseAuthContexts.get(caseId)),
    // A synthetic fixture: the case's record written into the vault as given, as another build would have stored it.
    async seed(caseId, record) {
      const { routineKek, recoverySecretBytes } = await providers.keyProvider.getCaseKeyMaterial({ caseId });
      const envelope = await createVaultEnvelope({ plaintextBytes: Buffer.from(JSON.stringify(record)), routineKek, recoverySecretBytes });
      await fs.writeFile(path.join(providers.rootDir, `${caseId}.vault.json`), JSON.stringify(serializeVaultEnvelope(envelope)), { mode: 0o600 });
    }
  };
}

const lastRequest = (calls, role) => calls.filter((call) => call.role === role).at(-1).request;
const snapshotsOf = (record) => record.response_evidence_snapshots ?? [];

test("the app's server starts without an installed package: the journal's reader comes in only when a client's journal is read", async () => {
  // run-autopilot.sh starts src/cli/serve.mjs from a folder without node_modules (tests/runtime-service-liveness.test.mjs starts it
  // whole, which takes far longer). Here every module the start loads is loaded with any package refused.
  const serve = new URL("../src/cli/serve.mjs", import.meta.url);
  const modules = Array.from((await fs.readFile(serve, "utf8")).matchAll(/^import .* from "(\.[^"]+)";$/gmu), ([, specifier]) => new URL(specifier, serve).href);
  assert.ok(modules.some((href) => href.endsWith("/src/server/listen-loopback.mjs")), "what the start loads");
  const refusePackages = `import { isBuiltin, registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (!isBuiltin(specifier) && !/^(?:[./]|file:)/u.test(specifier)) throw new Error("It needs an installed package: " + specifier);
      return next(specifier, context);
    } });`;
  const load = (hrefs) => promisify(execFile)(process.execPath, ["--input-type=module", "--eval", `${refusePackages}\nfor (const href of ${JSON.stringify(hrefs)}) await import(href);`]);
  await load(modules);
  // The reader itself does need one, which is why the gate loads it late.
  await assert.rejects(load([new URL("../src/journal-import/response-evidence-journal.mjs", import.meta.url).href]), /It needs an installed package: ajv/u);
});

test("the journal gate: no quotation without the owner's confirmation of consent, without a copy, without a matching cold-test receipt, or after a withdrawal; with all of them, the client's own journal only", async (t) => {
  const j = await journalTrial(t, { receipt: "none" });
  const gate = createRunnerJournalGate({ trialDir: j.home, caseAccessService: j.service });
  const ask = (caseId, auth = j.caseAuthContexts.get(caseId)) => gate.freezeResponseEvidenceJournal({ caseId, query: "help", authContext: auth });
  const reason = (part) => [part.availability, part.omissions?.[0]?.reason ?? null, part.source_items.length];
  assert.deepEqual(reason(await ask(j.clientA)), ["unavailable", "cold_test_receipt_missing", 0], "no cold test, no journal");
  await j.plantReceipt({ generation: "generation-0" });
  assert.deepEqual(reason(await ask(j.clientA)), ["unavailable", "cold_test_receipt_missing", 0].map((value, index) => (index === 1 ? "cold_test_receipt_mismatch" : value)), "a pass on another generation doesn't carry over");
  await j.plantReceipt({ visibility_epoch: j.reference.visibility_epoch + 1 });
  assert.equal((await ask(j.clientA)).omissions[0].reason, "cold_test_receipt_mismatch", "nor on another epoch");
  await j.plantReceipt({ result: "fail" });
  assert.equal((await ask(j.clientA)).omissions[0].reason, "cold_test_receipt_missing", "a failed test counts as none");
  await j.plantFirstReceipt();
  assert.deepEqual(reason(await ask(j.clientA)), ["unavailable", "cold_test_receipt_mismatch", 0], "a receipt that names no reader");
  await j.plantReceipt({ reader_version: "session-use-reader-v1:every-word" });
  assert.deepEqual(reason(await ask(j.clientA)), ["unavailable", "cold_test_receipt_mismatch", 0], "nor a pass of what another reader gives");
  await j.plantReceipt({ rule: "journal-cold-test-rule-v2" });
  assert.deepEqual(reason(await ask(j.clientA)), ["unavailable", "cold_test_receipt_mismatch", 0], "nor a pass by an earlier rule");
  await j.plantReceipt();
  const open = await ask(j.clientA);
  assert.equal(open.availability, "available");
  assert.ok(open.source_items.length >= 1);
  for (const item of open.source_items) {
    assert.equal(item.kind, "journal_quotation");
    assert.equal(item.locator.corpus_id, CORPUS);
    assert.ok(j.sources.repr.includes(item.exact_excerpt), "a verified quotation of the client's own journal");
  }
  assert.deepEqual(reason(await ask(j.clientB)), ["not_configured", "no_journal_copy", 0], "another client has no journal of their own");
  assert.deepEqual(reason(await ask(j.ownCase, j.ownAuth)), ["not_configured", "no_journal_copy", 0], "the owner's own case is no client");
  assert.equal((await ask(j.clientA, j.caseAuthContexts.get(j.clientB))).availability, "not_authorized", "another client's token reads nothing of client one's journal");
  // The gate open now, asked when a turn starts, before every call and before delivery in a case that has read its journal.
  const openNow = (auth = j.caseAuthContexts.get(j.clientA)) => gate.openNow({ caseId: j.clientA, authContext: auth });
  assert.equal(await openNow(), true);
  assert.equal(await openNow(j.caseAuthContexts.get(j.clientB)), false, "another client's grant");
  await fs.unlink(path.join(clientJournalFolder(j.home, j.clientA), COLD_TEST_RECEIPT_FILE));
  assert.equal(await openNow(), false, "a lost receipt counts like a withdrawal");
  await j.plantReceipt({ generation: "generation-0" });
  assert.equal(await openNow(), false, "a receipt for another publication");
  await j.plantFirstReceipt();
  assert.equal(await openNow(), false, "a receipt that names no reader");
  await j.plantReceipt({ reader_version: "session-use-reader-v1:every-word" });
  assert.equal(await openNow(), false, "a receipt for another reader");
  await j.plantReceipt({ rule: "journal-cold-test-rule-v2" });
  assert.equal(await openNow(), false, "a receipt by an earlier rule");
  await j.plantReceipt();
  assert.equal(await openNow(), true);
  await setJournalConsent({ home: j.home, number: 1, action: "withdraw" });
  assert.deepEqual(reason(await ask(j.clientA)), ["not_authorized", "journal_consent_missing", 0], "a withdrawal holds at once, before the next start");
  assert.equal(await openNow(), false);
  assert.equal(await gate.openNow({ caseId: j.clientB, authContext: j.caseAuthContexts.get(j.clientB) }), false, "a client without a copy");
});

test("a changed publication of the copy (its visibility revoked, a new epoch) closes the gate: a receipt for the earlier one doesn't carry over", async (t) => {
  const j = await journalTrial(t);
  const gate = createRunnerJournalGate({ trialDir: j.home, caseAccessService: j.service });
  const auth = j.caseAuthContexts.get(j.clientA);
  assert.equal(await gate.openNow({ caseId: j.clientA, authContext: auth }), true);
  await j.copier.incrementJournalVisibilityEpoch(j.clientA, { corpusId: CORPUS, expectedEpoch: j.reference.visibility_epoch }, j.copyAuth);
  assert.equal(await gate.openNow({ caseId: j.clientA, authContext: auth }), false);
  const part = await gate.freezeResponseEvidenceJournal({ caseId: j.clientA, query: "help", authContext: auth });
  assert.notEqual(part.availability, "available");
  assert.equal(part.source_items.length, 0, "no quotation of the changed publication");
});

test("once a case has read its journal, a closed gate stops the whole case: the next turn makes no model call at all, so nothing of the journal in an earlier draft goes out; confirming the consent again lets it reply", async (t) => {
  let home = null;
  // The first turn's checker withdraws the consent: that reply is held back, and its draft, which quotes the journal, stays in
  // the case as an unsent draft.
  const j = await journalTrial(t, { workers: script({ CW: async (count, request) => { if (count === 1) await setJournalConsent({ home, number: 1, action: "withdraw" }); return wholeChecker(count, request); } }) });
  home = j.home;
  const { base } = await j.serve();
  assert.equal((await respond(base, j.clientA, "exchange-case-1")).json.closing.reason_code, "checks_failed");
  const before = j.calls.length;
  const next = await respond(base, j.clientA, "exchange-case-2", "A synthetic second message.");
  assert.deepEqual([next.status, next.json.answer, next.json.closing], [200, RUNNER_UNAVAILABLE_NOTICE, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(j.calls.length, before, "no reader, writer or checker was called");
  // Another client's case and the owner's own are untouched by it.
  assert.equal((await respond(base, j.clientB, "exchange-other-1", "A synthetic message for client two.")).json.answer, "What makes asking hard for you?");
  assert.equal((await respond(base, j.ownCase, "exchange-own-1", "A synthetic message of the owner's own.")).json.answer, "What makes asking hard for you?");
  await setJournalConsent({ home: j.home, number: 1, action: "confirm" });
  const again = await respond(base, j.clientA, "exchange-case-3");
  assert.equal(again.status, 200);
  assert.equal(again.json.closing ?? null, null, "with the consent confirmed again, the case replies");
});

test("a reader other than the one tested closes the gate of a case that has read its journal, as a lost receipt does: the next turn makes no model call; the page's list, which compares the copy and the rule alone, says no test passed when the receipt names another rule, or none", async (t) => {
  const j = await journalTrial(t);
  const { base } = await j.serve();
  const listed = async () => (await (await fetch(`${base}/v1/runner/clients`, { headers: { origin: base } })).json()).cases.find((entry) => entry.caseId === j.clientA).journal.coldTestPassed;
  assert.equal((await respond(base, j.clientA, "exchange-reader-1")).json.closing ?? null, null, "the first turn reads the journal and replies");
  assert.equal(await listed(), true);
  const closed = async (exchange) => {
    const before = j.calls.length;
    const next = await respond(base, j.clientA, exchange, "A synthetic later message.");
    assert.deepEqual([next.status, next.json.answer, next.json.closing], [200, RUNNER_UNAVAILABLE_NOTICE, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
    assert.equal(j.calls.length, before, "no reader, writer or checker was called");
  };
  await j.plantReceipt({ reader_version: "session-use-reader-v1:every-word" });
  await closed("exchange-reader-2");
  assert.equal(await listed(), true, "the list compares the copy and the rule alone");
  await j.plantFirstReceipt();
  await closed("exchange-reader-3");
  assert.equal(await listed(), false, "a receipt that names no reader is no passed test");
  await j.plantReceipt({ rule: "journal-cold-test-rule-v2" });
  await closed("exchange-rule");
  assert.equal(await listed(), false, "nor is one by an earlier rule");
  await j.plantReceipt();
  assert.equal((await respond(base, j.clientA, "exchange-reader-4")).json.closing ?? null, null, "with a test of this reader, the case replies");
});

test("a provisional reply in a case that has read its journal goes out only while the gate is open: withdrawn during the crisis reader's call, the emergency line shows instead", async (t) => {
  let home = null;
  const PROVISIONAL = "I'm here with you. Please call your local emergency number now: 112 in the EU, 911 in the US, 999 in the UK.";
  const crisis = async (count) => {
    if (count === 1) return quietReader();
    // The second turn's crisis reader reads someone who has acted, gives a provisional reply, and the consent is withdrawn meanwhile.
    await setJournalConsent({ home, number: 1, action: "withdraw" });
    return { ...quietReader(), level: "acted_or_about_to", reason: "says they took something", provisional_reply: PROVISIONAL };
  };
  const j = await journalTrial(t, { workers: script({ R1: crisis }) });
  home = j.home;
  const { base } = await j.serve();
  assert.equal((await respond(base, j.clientA, "exchange-prov-1")).json.closing ?? null, null, "the first turn reads the journal and replies");
  const second = await respond(base, j.clientA, "exchange-prov-2", "I took all my pills an hour ago.");
  assert.deepEqual([second.status, second.json.closing?.reason_code], [200, "checks_failed"]);
  const turn = (await j.record(j.clientA)).runtime_turns.at(-1);
  assert.equal(turn.provisional ?? null, null, "no provisional reply was recorded as shown");
  assert.ok(turn.emergency_line_shown_at, "the fixed emergency line was shown instead");
  assert.equal(JSON.stringify(second.json).includes(PROVISIONAL), false);
});

test("the gate reads the consent again last: a withdrawal that completes while it checks the copy and the receipt is seen", async (t) => {
  const j = await journalTrial(t);
  let reads = 0;
  // The client list as the gate reads it: the consent stands at the first read and is withdrawn by the last.
  const gate = createRunnerJournalGate({ trialDir: j.home, caseAccessService: j.service, clientsFor: async () => {
    reads += 1;
    const list = await readRunnerClients(j.home);
    if (reads > 1) list.clients[0].journal.consent = { ...list.clients[0].journal.consent, withdrawn_at: "2026-11-24T12:00:00.000Z" };
    return list;
  } });
  assert.equal(await gate.openNow({ caseId: j.clientA, authContext: j.caseAuthContexts.get(j.clientA) }), false);
  assert.equal(reads, 2, "read before the checks and again after them");
});

test("the worker asks the gate itself at its last moment, after its own preparation: a withdrawal meanwhile stops the packet from leaving", async (t) => {
  let home = null;
  const sent = [];
  // A stand-in worker as the sealed ones work: its preparation (where a withdrawal lands here), then the gate, then the send.
  const preparing = (role, answer) => async (count, request) => {
    if (role === "W" && count === 1) await setJournalConsent({ home, number: 1, action: "withdraw" });
    if (request.beforeSend) await request.beforeSend();
    sent.push(role);
    return answer(count, request);
  };
  const j = await journalTrial(t, { workers: script({ W: preparing("W", writer), CW: preparing("CW", wholeChecker) }) });
  home = j.home;
  const { base } = await j.serve();
  const closed = await respond(base, j.clientA, "exchange-last-1");
  assert.deepEqual([closed.status, closed.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.deepEqual(sent, [], "neither the writer's packet nor the checker's left");
  assert.equal(j.calls.filter((call) => call.role === "W").length, 1, "the writer was asked once, and stopped at its last moment");
});


test("without the owner's confirmation the grant has no session_use, so even a passing receipt opens nothing", async (t) => {
  const j = await journalTrial(t, { consent: false });
  const gate = createRunnerJournalGate({ trialDir: j.home, caseAccessService: j.service });
  const part = await gate.freezeResponseEvidenceJournal({ caseId: j.clientA, query: "help", authContext: j.caseAuthContexts.get(j.clientA) });
  assert.deepEqual([part.availability, part.omissions[0].reason], ["not_authorized", "journal_consent_missing"]);
  // A consent recorded while the server runs gives the grant its purpose only at the next start: the reader is refused until then.
  await setJournalConsent({ home: j.home, number: 1, action: "confirm" });
  const later = await gate.freezeResponseEvidenceJournal({ caseId: j.clientA, query: "help", authContext: j.caseAuthContexts.get(j.clientA) });
  assert.deepEqual([later.availability, later.source_items.length], ["not_authorized", 0]);
});

test("with response evidence on, a client who passes the gate gets their own journal's quotations in the writer's and the checker's evidence; a declared quote passes the exact-quote check and the evidence review, and the reply is delivered", async (t) => {
  const j = await journalTrial(t);
  const { base } = await j.serve();
  const answered = await respond(base, j.clientA, "exchange-journal-1");
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  const writerRequest = lastRequest(j.calls, "W");
  const writerPacket = packetOf(writerRequest);
  const quotations = journalItems(writerPacket);
  assert.ok(quotations.length >= 1, "the writer sees the client's journal quotations");
  assert.ok(quotations.every((item) => j.sources.repr.includes(item.exact_excerpt) && item.locator.corpus_id === CORPUS));
  assert.equal(writerPacket.response_evidence.journal.availability, "available");
  assert.equal(Object.hasOwn(writerPacket, "journal_evidence"), false, "the older journal slot is never used");
  assert.ok(writerRequest.system.includes(WRITER_EVIDENCE_NOTE));
  const checkerRequest = lastRequest(j.calls, "CW");
  assert.ok(checkerRequest.system.includes(CHECKER_EVIDENCE_NOTE));
  assert.ok(Object.hasOwn(checkerRequest.schema.properties, "evidence_review"), "the whole checker answers with the review");
  assert.deepEqual(journalItems(packetOf(checkerRequest)).map((item) => item.id), quotations.map((item) => item.id), "the checker sees what the writer saw");
  assert.match(answered.json.answer, new RegExp(quotations[0].exact_excerpt.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  const record = await j.record(j.clientA);
  const turn = record.runtime_turns.at(-1);
  assert.equal(turn.state, "DELIVERED");
  const candidate = record.candidate_responses.find((entry) => entry.id === turn.delivery.candidate_id);
  const audit = candidate.audit_history.at(-1);
  assert.equal(audit.verdict, "pass");
  assert.equal(audit.findings.some((finding) => finding.code === "PROGRAM_QUOTE_NOT_EXACT"), false, "the journal quote is word for word in its source");
  assert.deepEqual(audit.response_evidence.review.items.map((item) => [item.source_ids, item.assessment]), [[[quotations[0].id], "supported"]]);
  const [snapshot] = snapshotsOf(record);
  assert.ok(snapshot.source_items.some((item) => item.kind === "journal_quotation"));
  // Client two has no journal: their turn's evidence holds their conversation only, and nothing of client one's journal.
  assert.equal((await respond(base, j.clientB, "exchange-journal-b1", "A synthetic message for client two.")).status, 200);
  const other = packetOf(lastRequest(j.calls, "W"));
  assert.deepEqual([other.response_evidence.journal.availability, journalItems(other).length], ["not_configured", 0]);
  assert.equal(JSON.stringify(other).includes(quotations[0].exact_excerpt), false);
  assert.equal(snapshotsOf(await j.record(j.clientB)).every((entry) => entry.source_items.every((item) => item.kind !== "journal_quotation")), true);
});

test("a reply written with the journal in view isn't delivered once the consent is withdrawn: its turn closes, and the next turn gets no journal", async (t) => {
  let home = null;
  // The owner withdraws the consent while the checker reads the draft: after it passes, the delivery finds the consent gone.
  const j = await journalTrial(t, { workers: script({ CW: async (count, request) => { if (count === 1) await setJournalConsent({ home, number: 1, action: "withdraw" }); return wholeChecker(count, request); } }) });
  home = j.home;
  const { base } = await j.serve();
  const held = await respond(base, j.clientA, "exchange-held-1");
  assert.equal(held.status, 200, JSON.stringify(held.json));
  assert.equal(held.json.answer, RUNNER_UNAVAILABLE_NOTICE);
  assert.deepEqual(held.json.closing, { kind: "runner_unavailable", reason_code: "checks_failed" });
  const record = await j.record(j.clientA);
  assert.equal(record.runtime_turns.at(-1).state, "UNANSWERED");
  assert.equal(record.raw_transcript.some((entry) => entry.role === "assistant" && entry.text.includes("You wrote")), false, "the reply never reached the transcript");
  // The case has read its journal and the gate is closed: the next turn closes before any model call.
  const calls = j.calls.length;
  const next = await respond(base, j.clientA, "exchange-held-2");
  assert.deepEqual([next.status, next.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(j.calls.length, calls);
});

test("a withdrawal during the writer's call keeps the journal from every later call: the checker never gets it, and the turn closes", async (t) => {
  let home = null;
  const j = await journalTrial(t, { workers: script({ W: async (count, request) => { if (count === 1) await setJournalConsent({ home, number: 1, action: "withdraw" }); return writer(count, request); } }) });
  home = j.home;
  const { base } = await j.serve();
  const closed = await respond(base, j.clientA, "exchange-withdrawn-1");
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.deepEqual([closed.json.answer, closed.json.closing], [RUNNER_UNAVAILABLE_NOTICE, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(j.calls.some((call) => call.role === "CW"), false, "no checker received the journal after the withdrawal");
  assert.equal((await j.record(j.clientA)).runtime_turns.at(-1).state, "UNANSWERED");
});

test("the gate is asked again right before every call: a withdrawal while the readers read keeps the journal from the writer, and a retry is checked again", async (t) => {
  let home = null;
  // A case's first turn: its readers read before its journal is searched, so a withdrawal meanwhile means the journal is never read,
  // and the reply is made from the conversation alone.
  const duringReaders = await journalTrial(t, { workers: script({ R1: async () => { await setJournalConsent({ home, number: 1, action: "withdraw" }); return quietReader(); } }) });
  home = duringReaders.home;
  const first = await duringReaders.serve();
  const answered = await respond(first.base, duringReaders.clientA, "exchange-readers-1");
  assert.deepEqual([answered.status, answered.json.closing ?? null, answered.json.answer], [200, null, "What makes asking hard for you?"]);
  const packet = packetOf(lastRequest(duringReaders.calls, "W"));
  assert.deepEqual([packet.response_evidence.journal.availability, packet.response_evidence.journal.omissions[0].reason, journalItems(packet)], ["not_authorized", "journal_consent_missing", []], "no writer or checker got the journal");
  assert.deepEqual(journalItems(packetOf(lastRequest(duringReaders.calls, "CW"))), []);

  // A case that has read its journal: a withdrawal while a later turn's readers read stops that turn before its writer.
  let homeLater = null;
  const laterTurn = await journalTrial(t, { workers: script({ R1: async (count) => { if (count === 2) await setJournalConsent({ home: homeLater, number: 1, action: "withdraw" }); return quietReader(); } }) });
  homeLater = laterTurn.home;
  const served = await laterTurn.serve();
  assert.equal((await respond(served.base, laterTurn.clientA, "exchange-readers-2")).json.closing ?? null, null);
  const before = laterTurn.calls.filter((call) => ["W", "CW"].includes(call.role)).length;
  const closed = await respond(served.base, laterTurn.clientA, "exchange-readers-3");
  assert.deepEqual([closed.status, closed.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(laterTurn.calls.filter((call) => ["W", "CW"].includes(call.role)).length, before, "no writer or checker got the journal");

  // Withdrawn between the search, which read the journal, and the writer's call: the writer doesn't get it either.
  let homeFrozen = null;
  const afterFreeze = await journalTrial(t);
  homeFrozen = afterFreeze.home;
  const frozen = await afterFreeze.serve({ ...afterFreeze.service, async freezeResponseEvidence(...args) {
    const snapshot = await afterFreeze.service.freezeResponseEvidence(...args);
    assert.ok(snapshot.source_items.some((item) => item.kind === "journal_quotation"));
    await setJournalConsent({ home: homeFrozen, number: 1, action: "withdraw" });
    return snapshot;
  } });
  const held = await respond(frozen.base, afterFreeze.clientA, "exchange-readers-4");
  assert.deepEqual([held.status, held.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(afterFreeze.calls.some((call) => ["W", "CW"].includes(call.role)), false, "no writer or checker got the journal");

  let homeTwo = null;
  // The writer's first answer has the wrong shape, and the consent is withdrawn meanwhile: its retry would carry the journal again.
  const retried = await journalTrial(t, { workers: script({ W: async (count, request) => {
    if (count === 1) { await setJournalConsent({ home: homeTwo, number: 1, action: "withdraw" }); return { reply: "" }; }
    return writer(count, request);
  } }) });
  homeTwo = retried.home;
  const second = await retried.serve();
  const again = await respond(second.base, retried.clientA, "exchange-retry-1");
  assert.deepEqual([again.status, again.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(retried.calls.filter((call) => call.role === "W").length, 1, "the retry never went out");
});

test("once a turn has read the journal, a later call of that turn needs the gate even when its own evidence holds no quotation (an expansion after a withdrawal)", async (t) => {
  let home = null;
  const missingHistory = async (count, request) => {
    const value = wholeChecker(count, request);
    if (count !== 1) return value;
    // The first check asks for more history, and the consent is withdrawn before the repair: the expansion reads no journal, but
    // the draft the repair would get quotes it.
    await setJournalConsent({ home, number: 1, action: "withdraw" });
    return { ...value, evidence_review: { ...value.evidence_review, missing_material_history: [{ id: "missing-1", question: "When did asking start to feel hard?", why_material: "Synthetic.", candidate_quote: "What was different that day?", quote_occurrence: 1 }] } };
  };
  const j = await journalTrial(t, { workers: script({ CW: missingHistory, "W-repair": writer }) });
  home = j.home;
  const { base } = await j.serve();
  const answered = await respond(base, j.clientA, "exchange-lineage-1");
  assert.deepEqual([answered.status, answered.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(j.calls.some((call) => call.role === "W-repair"), false, "the repair never got the draft that quotes the journal");
  const record = await j.record(j.clientA);
  const owned = snapshotsOf(record);
  assert.ok(owned.length >= 2, "the expansion froze a second snapshot");
  assert.equal(journalItems({ response_evidence: owned.at(-1) }).length, 0, "which holds no quotation");
});

test("a cold-test receipt lost while the checker reads holds the reply back like a withdrawal", async (t) => {
  let home = null;
  let clientA = null;
  const j = await journalTrial(t, { workers: script({ CW: async (count, request) => {
    if (count === 1) await fs.rm(path.join(clientJournalFolder(home, clientA), COLD_TEST_RECEIPT_FILE));
    return wholeChecker(count, request);
  } }) });
  home = j.home;
  clientA = j.clientA;
  const { base } = await j.serve();
  const held = await respond(base, j.clientA, "exchange-receipt-1");
  assert.deepEqual([held.status, held.json.answer, held.json.closing], [200, RUNNER_UNAVAILABLE_NOTICE, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
});

test("the store closes an approved reply that read the journal only with the trial's journal hold; journal quotations alone never discard it", async (t) => {
  const j = await journalTrial(t);
  let failDelivery = true;
  const flaky = { ...j.service, async deliverPrivateRuntimeCandidate(...args) {
    if (failDelivery) { failDelivery = false; throw Object.assign(new Error("A synthetic delivery failure."), { code: "SYNTHETIC_DELIVERY_FAILURE" }); }
    return j.service.deliverPrivateRuntimeCandidate(...args);
  } };
  const { base } = await j.serve(flaky);
  assert.notEqual((await respond(base, j.clientA, "exchange-hold-1")).status, 200);
  const auth = j.caseAuthContexts.get(j.clientA);
  const turn = (await j.record(j.clientA)).runtime_turns.at(-1);
  assert.equal(turn.state, "APPROVED");
  const close = (extra = {}) => j.service.closeRuntimeTurnUnanswered(j.clientA, turn.id, { kind: "runner_unavailable", reasonCode: "checks_failed", assistantTurnId: `${turn.exchange_id}-assistant`, eventId: "runtime-event:synthetic:hold", ...extra }, auth);
  await assert.rejects(close(), /not closed without a reply/u, "an admissible journal reply stays to be delivered");
  await assert.rejects(close({ journalHold: true, reasonCode: "interrupted" }), /not closed without a reply/u, "the hold is a failed check only");
  await close({ journalHold: true });
  assert.equal((await j.record(j.clientA)).runtime_turns.at(-1).state, "UNANSWERED");
});

test("an approved reply is closed without a reply only when it may no longer be sent: the store refuses any other closing, and a restart's reconcile delivers it", async (t) => {
  const j = await journalTrial(t, { receipt: "none" });
  let failDelivery = true;
  const flaky = { ...j.service, async deliverPrivateRuntimeCandidate(...args) {
    if (failDelivery) { failDelivery = false; throw Object.assign(new Error("A synthetic delivery failure."), { code: "SYNTHETIC_DELIVERY_FAILURE" }); }
    return j.service.deliverPrivateRuntimeCandidate(...args);
  } };
  const { base } = await j.serve(flaky);
  const failed = await respond(base, j.clientB, "exchange-approved-1", "A synthetic message for client two.");
  assert.notEqual(failed.status, 200);
  const auth = j.caseAuthContexts.get(j.clientB);
  const turn = (await j.record(j.clientB)).runtime_turns.at(-1);
  assert.equal(turn.state, "APPROVED");
  for (const reasonCode of ["checks_failed", "interrupted", "provider_failed"]) {
    await assert.rejects(j.service.closeRuntimeTurnUnanswered(j.clientB, turn.id, { kind: "runner_unavailable", reasonCode, assistantTurnId: `${turn.exchange_id}-assistant`, eventId: `runtime-event:synthetic:${reasonCode}` }, auth),
      /not closed without a reply/u, `${reasonCode}: an admissible reply without a journal stays to be delivered`);
  }
  const reconciled = await fetch(`${base}/v1/runner/reconcile`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ caseId: j.clientB, conversation: "current" }) });
  assert.equal(reconciled.status, 200);
  assert.equal((await j.record(j.clientB)).runtime_turns.at(-1).state, "DELIVERED");
});

// The page's own "Delete this case" (its runner-trial block, its empty state, and what runs from clearDeletedCase to the button), in the
// page's markup, with the rest of the page stood in for and its requests going to the trial's server (`lost`: no answer ever comes): what it
// says, and what it still holds.
async function deletingPage(t, base, choice, { lost = false } = {}) {
  const [html, app] = await Promise.all(["index.html", "app.js"].map((name) => fs.readFile(new URL(`../apps/web/${name}`, import.meta.url), "utf8")));
  const dom = new JSDOM(html, { url: `${base}/` });
  t.after(() => dom.window.close());
  const between = (from, to) => {
    const start = app.indexOf(from);
    const end = app.indexOf(to, start);
    assert.ok(start > 0 && end > start, `the page has ${from}`);
    return app.slice(start, end);
  };
  const said = [], answers = [];
  let pressed = null;
  const nothing = () => {};
  const state = { therapy: [{ role: "user", exchangeId: "exchange-delete-1", content: "A synthetic message on the page." }], caseId: choice.caseId, settings: { synthetic: "kept" },
    trackerEntries: [{ id: "synthetic-tracker" }], runnerShownThrough: "exchange-delete-1" };
  const context = vm.createContext({
    TextDecoder, crypto: globalThis.crypto, state, document: dom.window.document, runnerTrial: { on: true, newConversation: false }, currentPlan: null, selectedRouteText: "",
    speechPlayback: { stop: nothing }, supervisorPanel: { clear: nothing }, runnerCases: { buckets: new Map(), epochs: new Map() }, runnerEpoch: () => 0, runnerChoiceFor: () => choice,
    $: (selector) => (selector === "#runner-delete-case" ? { addEventListener: (_type, listener) => { pressed = listener; } } : dom.window.document.querySelector(selector)),
    prompt: () => "DELETE", alert: (words) => { said.push(words); },
    fetch: async (url, init) => {
      if (lost) throw new TypeError("Failed to fetch");
      const response = await fetch(`${base}${url}`, { ...init, headers: { ...init.headers, origin: base } });
      answers.push([response.status, await response.clone().json()]);
      return response;
    },
    ...Object.fromEntries(["setBusy", "keepRunnerBucket", "syncRunnerNewConversation", "showRunnerResume", "setRunnerKeptPlanStatus", "syncSpeechPlaybackControls", "saveState", "renderTherapy",
      "renderCaseState", "renderHandoffStatus"].map((name) => [name, nothing]))
  });
  vm.runInContext([between("// runner-trial-page:start", "// runner-trial-page:end"), between("function emptyPageState()", "function loadState()"), between("function clearDeletedCase()", '$("#clear-therapy").addEventListener')].join("\n"), context);
  return { state, said, answers, press: () => pressed(), shown: () => JSON.parse(JSON.stringify(state.therapy)).map((entry) => entry.content) };
}

test("Delete with something it can't clear: the case is told as deleted, the runtime and the page forget it, the page names what's left and never says the case wasn't deleted, and Delete again clears it", async (t) => {
  const j = await journalTrial(t);
  const { trial, base } = await j.serve();
  // The case has read its journal, so the runtime asks the gate before every call of it.
  assert.equal((await respond(base, j.clientA, "exchange-delete-1")).json.closing ?? null, null);
  assert.ok(journalItems(packetOf(lastRequest(j.calls, "W"))).length >= 1);
  await trial.flushLogs();
  const folder = clientJournalFolder(j.home, j.clientA);
  const log = path.join(j.home, `runner-log-${j.clientA}.jsonl`);
  const lock = path.join(j.home, ".trial-folder.lock");
  const list = path.join(j.home, "clients.json");
  const gone = () => assert.rejects(j.record(j.clientA), { code: "PRIVATE_CASE_NOT_FOUND" });
  const journalOf = async () => (await readRunnerClients(j.home)).clients[0].journal;
  const page = await deletingPage(t, base, { caseId: j.clientA, kind: "client", number: 1, label: "Synthetic client one" });
  const held = async (during) => {
    await fs.writeFile(lock, "999999999 synthetic-token\n", { mode: 0o600 });
    try { await during(); } finally { await fs.unlink(lock); }
  };
  const refusal = `Delete didn't finish: A runner-trial command ended without finishing and left its lock. If no other runner-trial command is running, remove ${lock} and try again.`;

  // Refused before anything is deleted: the case, the list and the page stay as they are.
  await held(page.press);
  assert.deepEqual([page.answers.at(-1)[0], page.said.splice(0)], [500, [refusal]]);
  assert.equal((await j.record(j.clientA)).runtime_turns.length, 1);
  assert.equal((await journalOf()).corpus_id, CORPUS);
  assert.deepEqual(page.shown(), ["A synthetic message on the page."]);

  // Deleted, with the list, the folder and the log each failing.
  const { rename, rm } = fs;
  const refuse = () => { throw Object.assign(new Error("Synthetic words."), { code: "EACCES" }); };
  const mocked = [t.mock.method(fs, "rename", async (from, to) => (to === list ? refuse() : rename.call(fs, from, to))), t.mock.method(fs, "rm", async (where, options) => ([folder, log].includes(where) ? refuse() : rm.call(fs, where, options)))];
  await page.press();
  for (const each of mocked) each.mock.restore();
  const [status, { caseFileRemoved, journalCorporaRemoved, deleted, cleanupLeft }] = page.answers.at(-1);
  assert.deepEqual([status, deleted, caseFileRemoved, journalCorporaRemoved, cleanupLeft], [200, true, true, 1, ["JOURNAL_LIST", "JOURNAL_FOLDER", "RUN_LOG"]]);
  await gone();
  assert.deepEqual(page.said.splice(0), ["Conversation with 1. Synthetic client one. The case was deleted. Some leftovers on this computer remain: their journal copy's place on the client list, their journal folder (their key for journal copies and the cold-test receipt), the case's run log file; press Delete again to clear them."]);
  // Nothing of the case is left on the page.
  assert.deepEqual(page.shown(), ["This case was deleted"]);
  assert.deepEqual([JSON.parse(JSON.stringify(page.state.trackerEntries)), page.state.runnerShownThrough, page.state.caseId, page.state.settings.synthetic], [[], null, j.clientA, "kept"]);
  assert.equal((await journalOf()).corpus_id, CORPUS);
  await fs.readFile(path.join(folder, COLD_TEST_RECEIPT_FILE));
  await fs.readFile(log);

  // Delete again, refused: the case is gone already, and nothing says it wasn't deleted.
  await held(page.press);
  assert.deepEqual(page.said.splice(0), [refusal]);
  await gone();

  // The runtime remembers nothing of the case's journal: its gate is closed (the copy is gone), and a new message is answered all the same.
  const fresh = await respond(base, j.clientA, "exchange-delete-2", "A synthetic new message.");
  assert.deepEqual([fresh.status, fresh.json.answer, fresh.json.closing ?? null], [200, "What makes asking hard for you?", null]);
  assert.equal(journalItems(packetOf(lastRequest(j.calls, "W"))).length, 0);
  await trial.flushLogs();

  // Delete again clears what was left, and again, with nothing left, is as good: nothing more is said.
  for (const [removed, corpora] of [[true, 0], [false, 0]]) {
    await page.press();
    const [again, answer] = page.answers.at(-1);
    assert.deepEqual([again, answer.deleted, answer.caseFileRemoved, answer.journalCorporaRemoved, Object.hasOwn(answer, "cleanupLeft")], [200, true, removed, corpora, false]);
    await gone();
    assert.equal((await journalOf()).corpus_id, null);
    for (const place of [folder, log]) await assert.rejects(fs.readFile(place), { code: "ENOENT" });
  }
  assert.deepEqual(page.said, []);
});

test("Delete when the vault fails: with the case gone by then it's told as deleted, the runtime, the list, the folder, the log and the page forget it, the page names the vault's own files, and Delete again clears them; with the case still there, nothing is forgotten and the page says what it said before", async (t) => {
  const j = await journalTrial(t);
  let vaultFails = null;
  const { trial, base } = await j.serve({ ...j.service, deletePrivateCase: (...args) => (vaultFails ?? j.service.deletePrivateCase)(...args) });
  assert.equal((await respond(base, j.clientA, "exchange-vault-1")).json.closing ?? null, null);
  assert.ok(journalItems(packetOf(lastRequest(j.calls, "W"))).length >= 1);
  await trial.flushLogs();
  const folder = clientJournalFolder(j.home, j.clientA);
  const log = path.join(j.home, `runner-log-${j.clientA}.jsonl`);
  const locators = path.join(j.home, "vault", ".artifact-locators");
  const journalOf = async () => (await readRunnerClients(j.home)).clients[0].journal;
  const page = await deletingPage(t, base, { caseId: j.clientA, kind: "client", number: 1, label: "Synthetic client one" });

  // The case still there: the page says why Delete didn't finish, and everything is as it was.
  vaultFails = async () => { throw Object.assign(new Error("Synthetic words of the vault."), { code: "SYNTHETIC_VAULT_ERROR" }); };
  await page.press();
  vaultFails = null;
  assert.deepEqual([page.answers.at(-1)[0], page.said.splice(0)], [500, ["Delete didn't finish: Synthetic words of the vault."]]);
  assert.deepEqual(page.shown(), ["A synthetic message on the page."]);
  assert.equal((await j.record(j.clientA)).runtime_turns.length, 1);
  assert.equal((await journalOf()).corpus_id, CORPUS);
  for (const kept of [path.join(folder, COLD_TEST_RECEIPT_FILE), log]) await fs.readFile(kept);

  // The vault's own store fails at a file that names the case, with the case's file removed by then.
  const named = (await fs.readdir(locators)).length;
  assert.ok(named >= 1);
  const { unlink } = fs;
  const mocked = t.mock.method(fs, "unlink", async (file) => {
    if (path.dirname(file) === locators) throw Object.assign(new Error("Synthetic words."), { code: "EIO" });
    return unlink.call(fs, file);
  });
  await page.press();
  mocked.mock.restore();
  const [status, { deleted, caseFileRemoved, cleanupLeft }] = page.answers.at(-1);
  assert.deepEqual([status, deleted, caseFileRemoved, cleanupLeft], [200, true, true, ["VAULT_CLEANUP"]]);
  assert.deepEqual(page.said.splice(0), ["Conversation with 1. Synthetic client one. The case was deleted. Some leftovers on this computer remain: some of the vault's own files for the case; press Delete again to clear them."]);
  assert.deepEqual(page.shown(), ["This case was deleted"]);
  await assert.rejects(j.record(j.clientA), { code: "PRIVATE_CASE_NOT_FOUND" });
  assert.equal((await fs.readdir(locators)).length, named, "what the vault couldn't remove");
  assert.deepEqual(Object.keys(await journalOf()).sort(), ["consent", "corpus_id"]);
  assert.equal((await journalOf()).corpus_id, null);
  for (const gone of [folder, log]) await assert.rejects(fs.readFile(gone), { code: "ENOENT" });
  // The runtime remembers nothing of the case's journal: a new message is answered, though the gate is closed.
  const fresh = await respond(base, j.clientA, "exchange-vault-2", "A synthetic new message.");
  assert.deepEqual([fresh.status, fresh.json.answer, fresh.json.closing ?? null], [200, "What makes asking hard for you?", null]);
  await trial.flushLogs();

  // Delete again clears what the vault had left too, and again, with nothing left, is as good: nothing more is said.
  for (const removed of [true, false]) {
    await page.press();
    const [again, answer] = page.answers.at(-1);
    assert.deepEqual([again, answer.deleted, answer.caseFileRemoved, Object.hasOwn(answer, "cleanupLeft")], [200, true, removed, false]);
    assert.deepEqual(await fs.readdir(locators), []);
  }
  assert.deepEqual(page.said, []);
});

test("what the page says Delete left, from the server's codes alone, in fixed words", async (t) => {
  const j = await journalTrial(t, { receipt: "none" });
  const { base } = await j.serve();
  const app = await fs.readFile(new URL("../apps/web/app.js", import.meta.url), "utf8");
  const words = vm.runInNewContext(`${app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end"))}\n;runnerLeftoversText`, { TextDecoder });
  const saying = (left) => `The case was deleted. Some leftovers on this computer remain: ${left}; press Delete again to clear them.`;
  for (const [codes, left] of [
    [["VAULT_CLEANUP"], "some of the vault's own files for the case"],
    [["JOURNAL_LIST"], "their journal copy's place on the client list"],
    [["JOURNAL_FOLDER"], "their journal folder (their key for journal copies and the cold-test receipt)"],
    [["FOLDER_LOCK"], "the trial folder's lock (stop the trial and remove .trial-folder.lock by hand first)"],
    [["RUNTIME_STATE"], "what the running trial remembers of the case"],
    [["RUN_LOG"], "the case's run log file"],
    [["RUN_LOG", "A_CODE_ADDED_LATER"], "the case's run log file, something else"],
    [["constructor", "__proto__", "<b>Synthetic</b>", null, 42], Array(5).fill("something else").join(", ")]
  ]) assert.equal(words(codes), saying(left));
  for (const none of [undefined, null, [], {}, "RUN_LOG"]) assert.equal(words(none), "");
  // The owner's own case, with nothing left: nothing is said.
  const own = await deletingPage(t, base, { caseId: j.ownCase, kind: "own", number: null, label: null });
  await own.press();
  assert.deepEqual([own.answers.at(-1)[0], own.said, own.shown()], [200, [], ["This case was deleted"]]);
  // An answer that never comes: the page doesn't know, and doesn't say the case wasn't deleted.
  const lost = await deletingPage(t, base, { caseId: j.ownCase, kind: "own", number: null, label: null }, { lost: true });
  await lost.press();
  assert.deepEqual([lost.said, lost.shown()], [["Delete didn't finish: Failed to fetch"], ["A synthetic message on the page."]]);
});

test("a receipt for another generation keeps the journal out of the turn; with response evidence off no reader is attached and every packet is as before", async (t) => {
  const mismatched = await journalTrial(t, { receipt: "other-generation" });
  const served = await mismatched.serve();
  assert.equal((await respond(served.base, mismatched.clientA, "exchange-mismatch-1")).status, 200);
  const packet = packetOf(lastRequest(mismatched.calls, "W"));
  assert.deepEqual([packet.response_evidence.journal.availability, packet.response_evidence.journal.omissions[0].reason, journalItems(packet).length], ["unavailable", "cold_test_receipt_mismatch", 0]);

  const off = await journalTrial(t, { evidence: false });
  const { base } = await off.serve();
  assert.equal((await respond(base, off.clientA, "exchange-off-1")).status, 200);
  const writerRequest = lastRequest(off.calls, "W");
  const checkerRequest = lastRequest(off.calls, "CW");
  assert.equal(Object.hasOwn(packetOf(writerRequest), "response_evidence"), false);
  assert.equal(writerRequest.system.includes(WRITER_EVIDENCE_NOTE), false);
  assert.equal(Object.hasOwn(checkerRequest.schema.properties, "evidence_review"), false);
  assert.equal(checkerRequest.system.includes(CHECKER_EVIDENCE_NOTE), false);
  assert.equal(JSON.stringify(off.calls.map((call) => call.request)).includes("journal_quotation"), false, "no journal reaches any worker");
  assert.deepEqual(snapshotsOf(await off.record(off.clientA)), [], "no evidence snapshot is frozen");
  // Response evidence needs the whole checker: split checkers with it on stop the trial's start.
  const split = await journalTrial(t, { checkerMode: "split" });
  assert.throws(() => split.makeTrial(), { code: "BAD_CONFIG" });
});

// ---- A conversation about wanting to die gets no journal, and first words wait for no search (24 Nov 2026) ------------------------

const ACTED_PROVISIONAL = "I'm here with you. Please call your local emergency number now: 112 in the EU, 911 in the US, 999 in the UK.";
const wantsToDieReading = () => ({ ...quietReader(), level: "wants_to_die", wish_or_intent: "wish", reason: "says they want to die" });
const actedReading = () => ({ ...quietReader(), level: "acted_or_about_to", reason: "says they took something", provisional_reply: ACTED_PROVISIONAL });
const journalPartOf = (record) => snapshotsOf(record).at(-1).journal;
const WITHHELD = ["unavailable", "not_attempted", [{ reason: "journal_withheld", count: 1 }]];
const partSummary = (part) => [part.availability, part.retrieval_status, part.omissions];

test("the readers read before any journal search starts", async (t) => {
  // The journal is held until the crisis reader has answered: searched first, as before, the search would run out of its time.
  let release;
  const read = new Promise((resolve) => { release = resolve; });
  const j = await journalTrial(t, { workers: script({ R1: () => { release(); return quietReader(); } }) });
  const { happened, run } = j.turns({ onSearch: () => read });
  const result = await run("exchange-first-words", MESSAGE);
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(happened.filter((step) => step === "search").length, 1);
  for (const earlier of ["reading", "R1", "R3"]) assert.ok(happened.indexOf(earlier) >= 0 && happened.indexOf(earlier) < happened.indexOf("search"), `${earlier} comes before the search: ${happened}`);
  assert.deepEqual(happened.slice(happened.indexOf("search"), happened.indexOf("W") + 1), ["search", "freeze", "writing", "W"], "then the evidence is frozen and the writer writes");
  assert.equal(journalPartOf(await j.record(j.clientA)).availability, "available");
  assert.ok(journalItems(packetOf(lastRequest(j.calls, "W"))).length >= 1);
});

test("a message read as wanting to die, having acted or needing the emergency number now, or not read at all, gets no journal and no search is made", async (t) => {
  const failing = () => { throw Object.assign(new Error("A synthetic reader failure."), { code: "PROVIDER_FAILED" }); };
  const bodySign = () => ({ ...quietReader(), reason: "a body sign after stopping daily drinking", number_now: true, provisional_reply: ACTED_PROVISIONAL });
  const numberNow = { runnerNumberNowEnabled: true };
  for (const [name, R1, configured] of [["wants to die", wantsToDieReading, {}], ["acted", actedReading, {}], ["number now", bodySign, numberNow], ["unread", failing, {}]]) {
    const j = await journalTrial(t, { configured, workers: script({ R1, W: () => ({ reply: "Please call 112 now. I'm here.", answered_level: "unclear", quotes: [] }) }) });
    const { happened, run } = j.turns();
    const result = await run("exchange-crisis-1", MESSAGE);
    assert.equal(result.deliveryKind, "candidate", name);
    assert.equal(happened.includes("search"), false, `${name}: no search`);
    const record = await j.record(j.clientA);
    assert.deepEqual(partSummary(journalPartOf(record)), WITHHELD, name);
    assert.equal(snapshotsOf(record).length, 1);
    for (const role of ["W", "CW"]) {
      const packet = packetOf(lastRequest(j.calls, role));
      assert.deepEqual(journalItems(packet), [], `${name}: no quotation for ${role}`);
      assert.deepEqual(partSummary(packet.response_evidence.journal), WITHHELD);
    }
    assert.equal(record.runtime_turns[0].provisional?.exact_text ?? null, ["acted", "number now"].includes(name) ? ACTED_PROVISIONAL : null, `${name}: the first words are what they were`);
  }
  // With the number now off nobody reads it, so it withholds nothing.
  const off = await journalTrial(t, { workers: script({ R1: bodySign }) });
  const offTurns = off.turns();
  await offTurns.run("exchange-number-now-off", MESSAGE);
  assert.equal(offTurns.happened.filter((step) => step === "search").length, 1);
  // Nor does a message read as thoughts of death with no wish to act, or as one that could mean either: only one read as none does.
  for (const level of ["thoughts_no_intent", "unclear"]) {
    const j = await journalTrial(t, { workers: script({ R1: () => ({ ...quietReader(), level }) }) });
    const { happened, run } = j.turns();
    await run("exchange-other-level", MESSAGE);
    assert.equal(happened.includes("search"), false, level);
    assert.deepEqual(partSummary(journalPartOf(await j.record(j.clientA))), WITHHELD, level);
    // It doesn't make the conversation one about wanting to die: the next message, read as none, gets it again.
    const next = await journalTrial(t, { workers: script({ R1: (count) => (count === 1 ? { ...quietReader(), level } : quietReader()) }) });
    const turns = next.turns();
    await turns.run("exchange-level-1", MESSAGE);
    await turns.run("exchange-level-2", MESSAGE);
    assert.equal(turns.happened.filter((step) => step === "search").length, 1, level);
    assert.equal(journalPartOf(await next.record(next.clientA)).availability, "available", level);
  }
});

test("a later message of a conversation about wanting to die gets no journal either, whoever read it as one; a new conversation gets it again", async (t) => {
  const byReader = await journalTrial(t, { workers: script({ R1: (count) => (count === 1 ? wantsToDieReading() : quietReader()) }) });
  const first = byReader.turns();
  for (const [exchange, options] of [["exchange-later-1", {}], ["exchange-later-2", {}]]) {
    await first.run(exchange, MESSAGE, options);
    assert.deepEqual(partSummary(journalPartOf(await byReader.record(byReader.clientA))), WITHHELD, exchange);
  }
  assert.equal(first.happened.includes("search"), false);
  await first.run("exchange-later-3", MESSAGE, { userInput: { newConversation: true } });
  assert.equal(journalPartOf(await byReader.record(byReader.clientA)).availability, "available", "another conversation");
  assert.equal(first.happened.filter((step) => step === "search").length, 1);

  // The crisis checker's own reading of the first turn counts as the reader's does.
  const byChecker = await journalTrial(t, { workers: script({ CW: (count, request) => ({ ...wholeChecker(count, request), level: count === 1 ? "wants_to_die" : "none" }),
    W: () => ({ reply: "What makes asking hard for you?", answered_level: "none", quotes: [] }) }) });
  const second = byChecker.turns();
  await second.run("exchange-checker-1", MESSAGE);
  assert.equal(second.happened.filter((step) => step === "search").length, 1, "nobody had read the first message as one when it was searched for");
  await second.run("exchange-checker-2", MESSAGE);
  assert.equal(second.happened.filter((step) => step === "search").length, 1);
  assert.deepEqual(partSummary(journalPartOf(await byChecker.record(byChecker.clientA))), WITHHELD);
});

test("a reply written with the journal in view isn't sent once this turn's checker alone has read someone who wants to die: its repair gets none", async (t) => {
  for (const level of ["wants_to_die", "acted_or_about_to"]) {
    const draft = "You wrote about asking for help before. Please call 112 now. What makes asking hard for you?";
    const j = await journalTrial(t, { workers: script({ CW: (count, request) => ({ ...wholeChecker(count, request), level, repair_induced_checks: count > 1 ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] }),
      W: () => ({ reply: draft, answered_level: "none", quotes: [] }), "W-repair": () => ({ reply: "Please call 112 now. I'm here with you. What makes asking hard for you?", answered_level: level, quotes: [] }) }) });
    const { run } = j.turns();
    const result = await run("exchange-checker-alone", MESSAGE);
    assert.equal(result.deliveryKind, "candidate", level);
    assert.notEqual(result.answer, draft);
    const record = await j.record(j.clientA);
    const [first, second] = record.candidate_responses;
    assert.deepEqual(first.audit_history.at(-1).findings.filter((finding) => finding.code === "PROGRAM_JOURNAL_IN_CRISIS").map((finding) => finding.severity), ["high"], level);
    assert.equal(second.audit_history.at(-1).findings.some((finding) => finding.code === "PROGRAM_JOURNAL_IN_CRISIS"), false, "the repair was written without it");
    assert.deepEqual(snapshotsOf(record).map((snapshot) => [snapshot.revision_reason, snapshot.source_items.some((item) => item.kind === "journal_quotation")]), [["initial", true], ["dependency_refresh", false]]);
    const repair = packetOf(lastRequest(j.calls, "W-repair"));
    assert.deepEqual(journalItems(repair), []);
    assert.ok(repair.findings.some((finding) => finding.code === "PROGRAM_JOURNAL_IN_CRISIS"), "the repair is told why");
    assert.deepEqual(journalItems(packetOf(lastRequest(j.calls, "CW"))), [], "and is checked without it");
  }
  // A checker that reads thoughts of death with no wish to act, or can't tell, stops nothing.
  const other = await journalTrial(t, { workers: script({ CW: (count, request) => ({ ...wholeChecker(count, request), level: "thoughts_no_intent" }) }) });
  await other.turns().run("exchange-checker-other", MESSAGE);
  assert.deepEqual((await other.record(other.clientA)).candidate_responses.map((candidate) => candidate.status), ["sent"]);
});

// What a request holds of some words, wherever they stand in it.
const holdsWords = (request, words) => [request.system, packetOf(request)].some((part) => JSON.stringify(part).includes(JSON.stringify(words).slice(1, -1)));

test("once a turn may have no journal, its repair and the check of that get neither the draft written with one nor what was said of its words", async (t) => {
  const repaired = "Please call 112 now. I'm here with you. What makes asking hard for you?", link = "https://notes.u-dont-exist.com/the-lantern-entry";
  let quoted = null;
  const CW = (count, request) => {
    const value = wholeChecker(count, request);
    if (count > 1) return { ...value, level: "wants_to_die", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS] };
    quoted = journalItems(packetOf(request))[0].exact_excerpt;
    return { ...value, level: "wants_to_die", findings: [{ code: "CRISIS_FIRST_REPLY_SHAPE", severity: "high", summary: `synthetic: it opens with "${quoted}"`, evidence_turn_ids: [] }, { code: "QUOTES_THE_LANTERN_ENTRY", severity: "high", summary: "synthetic", evidence_turn_ids: [] }],
      evidence_review: { ...value.evidence_review, items: value.evidence_review.items.map((item) => ({ ...item, assessment: "unsupported" })),
        missing_material_history: [{ id: "the-lantern-entry", question: `When was that: ${quoted}`, why_material: `It says ${quoted}`, candidate_quote: quoted, quote_occurrence: 1 }] } };
  };
  // The draft also gives a link of the owner's, as an entry of the journal could hold one: the program's finding names it.
  const j = await journalTrial(t, { workers: script({ CW, W: (count, request) => ({ ...writer(count, request), reply: `${writer(count, request).reply} See ${link}` }), "W-repair": () => ({ reply: repaired, answered_level: "wants_to_die", quotes: [] }) }) });
  const result = await j.turns().run("exchange-draft-1", MESSAGE);
  assert.deepEqual([result.deliveryKind, result.answer], ["candidate", repaired]);
  assert.ok(quoted.length > 10 && holdsWords(j.calls.find((call) => call.role === "CW").request, quoted), "the first check got the draft and the quotation it was written with");
  const told = ["CRISIS_FIRST_REPLY_SHAPE", "PROGRAM_JOURNAL_IN_CRISIS", "PROGRAM_OWNER_LINK_NOT_ALLOWED", "RESPONSE_EVIDENCE_MISSING_HISTORY", "RESPONSE_EVIDENCE_UNSUPPORTED", "UNSPECIFIED_FINDING"];
  const after = j.calls.slice(j.calls.findIndex((call) => call.role === "CW") + 1);
  assert.deepEqual(after.map((call) => call.role), ["W-repair", "CW"], "every call after the check that read it");
  for (const { role, request } of after) {
    const packet = packetOf(request), findings = packet[role === "CW" ? "findings_that_caused_the_repair" : "findings"];
    assert.deepEqual(findings.map((finding) => finding.code).sort(), told, `${role} is told what was found`);
    for (const { code, ...rest } of findings) assert.deepEqual(Object.keys(rest), code.startsWith("PROGRAM_") ? ["severity", "summary"] : ["severity"], `${role}: ${code}`);
    assert.match(findings.find((finding) => finding.code === "PROGRAM_JOURNAL_IN_CRISIS").summary, /read the latest message as wants_to_die.*from the conversation alone/u);
    for (const words of [quoted, link, "lantern", "LANTERN"]) assert.equal(holdsWords(request, words), false, `${role} gets no words of the draft: ${words}`);
    assert.match(packet.previous_candidate, /^Not shown: /u);
  }
  // The draft stays stored as it was.
  assert.ok((await j.record(j.clientA)).candidate_responses[0].exact_text.includes(quoted));
});

test("a repair written from a draft that had the journal, while its own retrieval failed, is stopped too when its check reads someone who wants to die", async (t) => {
  // The first check asks for history and reads nothing of the kind; the repair's search fails, so its evidence holds no quotation, but
  // it is given the draft it corrects, which quotes one.
  const asksForHistory = (value) => ({ ...value, evidence_review: { ...value.evidence_review, missing_material_history: [{ id: "missing-1", question: "When did asking for help start to feel hard?", why_material: "Synthetic.", candidate_quote: "What was different that day?", quote_occurrence: 1 }] } });
  const CW = (count, request) => {
    const value = wholeChecker(count, request);
    if (count === 1) return asksForHistory(value);
    return { ...value, level: "wants_to_die", repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS] };
  };
  const drafts = [];
  const j = await journalTrial(t, { workers: script({ CW, "W-repair": (count, request) => {
    drafts.push(packetOf(request).previous_candidate);
    return { reply: count === 1 ? "You wrote about a colleague. What was different that day?" : "Please call 112 now. I'm here with you.", answered_level: count === 1 ? "none" : "wants_to_die", quotes: [] };
  } }) });
  const { happened, run } = j.turns({ onSearch: (steps) => { if (steps.filter((step) => step === "search").length > 1) throw new Error("A synthetic retrieval failure."); } });
  const result = await run("exchange-draft-2", MESSAGE);
  assert.equal(happened.filter((step) => step === "search").length, 2);
  assert.deepEqual([result.deliveryKind, result.answer], ["candidate", "Please call 112 now. I'm here with you."]);
  const record = await j.record(j.clientA);
  assert.deepEqual(snapshotsOf(record).map((snapshot) => [snapshot.revision_reason, snapshot.source_items.some((item) => item.kind === "journal_quotation")]), [["initial", true], ["evidence_expansion", false]]);
  assert.deepEqual(record.candidate_responses.map((candidate) => candidate.audit_history.at(-1).findings.some((finding) => finding.code === "PROGRAM_JOURNAL_IN_CRISIS")), [false, true, false]);
  assert.equal(drafts[0], record.candidate_responses[0].exact_text, "nobody had read it as one yet: the repair corrects the draft");
  assert.match(drafts[1], /^Not shown: /u);
});

test("a quote may name only a source its own call was given: a repair without the journal that names a quotation of the draft's is stopped", async (t) => {
  let named = null;
  const CW = (count, request) => ({ ...wholeChecker(count, request), level: "wants_to_die", repair_induced_checks: count > 1 ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] });
  const j = await journalTrial(t, { workers: script({ CW, W: (count, request) => { const value = writer(count, request); [named] = value.quotes; return value; },
    "W-repair": (count) => (count === 1 ? { reply: `You wrote: "${named.text}"`, answered_level: "wants_to_die", quotes: [named] } : { reply: "Please call 112 now. I'm here with you.", answered_level: "wants_to_die", quotes: [] }) }) });
  const result = await j.turns().run("exchange-quote-1", MESSAGE);
  assert.equal(result.answer, "Please call 112 now. I'm here with you.");
  const [first, second, third] = (await j.record(j.clientA)).candidate_responses.map((candidate) => candidate.audit_history.at(-1).findings.map((finding) => finding.code));
  assert.deepEqual([first, second, third], [["PROGRAM_JOURNAL_IN_CRISIS"], ["PROGRAM_QUOTE_NOT_EXACT"], []]);
});

test("no call of a later turn gets the journal's words from anything an earlier turn stored: only through that turn's own retrieval", async (t) => {
  // The first turn's two drafts quote the journal, and so does all its checks say of them; the third, which quotes nothing, is sent.
  const says = (count, request, value) => {
    const { exact_excerpt: words } = journalItems(packetOf(request))[0], quote = { candidate_quote: words, quote_occurrence: 1 };
    return { ...value, findings: [{ code: "VERBOSITY", severity: "substantive", summary: `synthetic: ${words}`, evidence_turn_ids: [] }],
      evidence_review: { ...value.evidence_review, missing_material_history: [{ id: `missing-${count}`, question: `And ${words}`, why_material: words, ...quote }] } };
  };
  // Then the person says they want to die, to the reader, or only to the checker, after a search that found nothing; or says nothing of the
  // kind. That turn's first draft is stopped too, so that it has a repair and a second check.
  for (const [name, second, level, message] of [["wants to die", wantsToDieReading, "wants_to_die", "I can't do this any more, I want to ask for help."], ["the checker alone reads it", quietReader, "wants_to_die", "I can't do this any more."], ["quiet", quietReader, "none", "I ask for help again."]]) {
    const later = (request) => packetOf(request).latest_message.text === message;
    const seen = new Map();
    const counted = (key) => { seen.set(key, (seen.get(key) ?? 0) + 1); return seen.get(key); };
    const CW = (count, request) => {
      const value = { ...wholeChecker(count, request), repair_induced_checks: request.user.includes("previous_candidate") ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] };
      if (!later(request)) return count < 3 ? says(count, request, value) : value;
      return { ...value, level, findings: counted("later check") === 1 ? [{ code: "VERBOSITY", severity: "substantive", summary: "synthetic: too long", evidence_turn_ids: [] }] : [] };
    };
    const j = await journalTrial(t, { workers: script({ CW, R1: (count) => (count === 1 ? quietReader() : second()),
      W: (count, request) => (later(request) ? { reply: "I'm here with you.", answered_level: "unclear", quotes: [] } : writer(count, request)),
      "W-repair": (count, request) => (later(request) ? { reply: "I'm here. Please call 112 now.", answered_level: "unclear", quotes: [] }
        : count === 1 ? { ...writer(count, request), reply: `${writer(count, request).reply} Again.` } : { reply: "What makes asking hard for you?", answered_level: "none", quotes: [] }) }) });
    const { run } = j.turns();
    assert.equal((await run("exchange-stored-1", MESSAGE)).answer, "What makes asking hard for you?", name);
    const quoted = journalItems(packetOf(j.calls.find((call) => call.role === "W").request))[0].exact_excerpt;
    const stopped = (await j.record(j.clientA)).candidate_responses.filter((candidate) => candidate.status !== "sent");
    assert.deepEqual(stopped.map((candidate) => [candidate.exact_text.includes(quoted), JSON.stringify(candidate.audit_history).includes(JSON.stringify(quoted).slice(1, -1))]), [[true, true], [true, true]]);
    const before = j.calls.length;
    assert.equal((await run("exchange-stored-2", message)).answer, "I'm here. Please call 112 now.", name);
    const calls = j.calls.slice(before);
    assert.deepEqual(calls.map((call) => call.role).sort(), ["CW", "CW", "R1", "R3", "W", "W-repair"], name);
    for (const { role, request } of calls) {
      const packet = packetOf(request);
      const given = journalItems(packet).some((item) => item.exact_excerpt === quoted);
      assert.equal(given && name !== "quiet", false, `${name}: no quotation for ${role}`);
      assert.equal(holdsWords(request, quoted), given, `${name}: ${role} gets its words from nothing else`);
      if (!packet.response_evidence) { assert.ok(["R1", "R3"].includes(role)); continue; }
      const { source_items: items, communication_projection: { omitted, ...lists } } = packet.response_evidence;
      const besides = items.filter((item) => !["exact_client_turn", "app_committed_client_outbound", "journal_retrieval_record", "journal_quotation"].includes(item.kind));
      assert.deepEqual([besides, Object.values(lists).flat(), omitted.source_items.find((entry) => entry.reason === "journal_case_conversation_alone"), omitted.confirmed_or_reported_client_outbound],
        [[], [], { reason: "journal_case_conversation_alone", count: 2 }, 1], `${name}: ${role}`);
    }
    // Nor does the word-free run log hold any.
    assert.equal(JSON.stringify(runnerLogFromRecord(await j.record(j.clientA))).includes(quoted), false);
  }
});

// A turn's first evidence as a build that left nothing out froze it, in the record as that build would have stored it.
function frozenWithAllOfIt(record, runtimeTurnId) {
  const at = record.response_evidence_snapshots.findIndex((snapshot) => snapshot.owner.runtime_turn_id === runtimeTurnId);
  const { id, owner, revision, parent_snapshot_id, revision_reason, candidate_origin, inbound, journal, created_at } = record.response_evidence_snapshots[at];
  record.response_evidence_snapshots[at] = buildResponseEvidenceSnapshot(asIfNoJournalWasRead(record), { snapshotId: id, owner, revision, parentSnapshotId: parent_snapshot_id, revisionReason: revision_reason, candidateOrigin: candidate_origin, inbound, journal }, { createdAt: created_at });
  return record.response_evidence_snapshots[at];
}
// The first turn's draft quotes the journal and is stopped; its repair, which quotes nothing, is sent. `later` answers for the turns after it.
function stoppedQuotation(later) {
  const ofLater = (request) => packetOf(request).latest_message.text !== MESSAGE;
  return script({
    R1: later.R1 ?? quietReader,
    W: (count, request) => (ofLater(request) ? later.W(packetOf(request)) : writer(count, request)),
    "W-repair": (count, request) => (ofLater(request) ? later.repair(packetOf(request)) : { reply: "What makes asking hard for you?", answered_level: "none", quotes: [] }),
    CW: (count, request) => {
      const value = { ...wholeChecker(count, request), repair_induced_checks: request.user.includes("previous_candidate") ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] };
      if (ofLater(request)) return { ...value, ...later.CW(packetOf(request)) };
      return count === 1 ? { ...value, findings: [{ code: "VERBOSITY", severity: "substantive", summary: "synthetic: too long", evidence_turn_ids: [] }] } : value;
    }
  });
}
const SAD = "I can't do this any more.";
// A turn whose process stops for good before its writer is called, its evidence frozen.
async function stoppedBeforeItsWriter(j, exchange) {
  const { run, stopped } = j.turns({ stopAt: "recordPrivateRuntimeInvocationEvent" });
  await Promise.race([stopped, run(exchange, SAD).then(({ answer }) => assert.fail(`The turn went on to its end: ${answer}`))]);
}

test("what an earlier build froze besides the conversation reaches no call of a turn that gets no journal: drafts, reports with their references, a supervisor's inputs, what was listed of them", async (t) => {
  // The person says they want to die, or their message can't be read.
  for (const [name, R1, level] of [["the reader reads it", (count) => (count === 1 ? quietReader() : wantsToDieReading()), "wants_to_die"], ["the message can't be read", (count) => { if (count > 1) throw Object.assign(new Error("A synthetic reader failure."), { code: "PROVIDER_FAILED" }); return quietReader(); }, "none"]]) {
    const j = await journalTrial(t, { workers: stoppedQuotation({ R1, W: () => ({ reply: "I'm here with you.", answered_level: "unclear", quotes: [] }), CW: () => ({ level }) }) });
    assert.equal((await j.turns().run("exchange-all-1", MESSAGE)).deliveryKind, "candidate", name);
    const quoted = journalItems(packetOf(j.calls.find((call) => call.role === "W").request))[0].exact_excerpt;
    await stoppedBeforeItsWriter(j, "exchange-all-2");
    const auth = j.caseAuthContexts.get(j.clientA);
    const [stopped] = (await j.record(j.clientA)).candidate_responses, draft = { kind: "candidate", candidateId: stopped.id, candidateVersion: stopped.version };
    assert.ok(stopped.exact_text.includes(quoted));
    for (const [eventId, subject] of [["event:agent", draft], ["event:ambiguous", { kind: "unresolved", candidateRefs: [{ candidateId: stopped.id, candidateVersion: stopped.version }] }]]) {
      await j.service.recordCommunicationEvent(j.clientA, { eventId, kind: "reported_sent", audience: "client", subject, provenance: { origin: "agent_relayed", sourceRef: "the-lantern-entry" } }, auth);
    }
    await j.service.recordSupervisorInputs(j.clientA, { inputs: [{ inputId: "input:one", inputType: "supervisor_revision", text: `Say more of the lantern: ${quoted}` }] }, auth);
    const record = await j.record(j.clientA), older = frozenWithAllOfIt(record, "runtime:exchange-all-2");
    assert.deepEqual(older.source_items.map((item) => item.kind).filter((kind) => ["agent_relayed_report", "supervisor_instruction"].includes(kind)), ["agent_relayed_report", "supervisor_instruction"]);
    assert.ok(JSON.stringify(older.communication_projection).match(/the-lantern-entry/gu).length === 2);
    await j.seed(j.clientA, record);
    const before = j.calls.length;
    assert.equal((await j.turns().run("exchange-all-2", SAD)).answer, "I'm here with you.", name);
    const calls = j.calls.slice(before);
    assert.deepEqual(calls.map((call) => call.role), ["W", "CW"], name);
    for (const { role, request } of calls) for (const words of [quoted, "lantern"]) assert.equal(holdsWords(request, words), false, `${name}: ${role} gets none of it: ${words}`);
    const frozen = snapshotsOf(await j.record(j.clientA)).filter((snapshot) => snapshot.owner.runtime_turn_id === "runtime:exchange-all-2");
    assert.deepEqual(frozen.map((snapshot) => [snapshot.revision_reason, snapshot.snapshot_sha256 === older.snapshot_sha256]), [["initial", true], ["dependency_refresh", false]], name);
  }
});

test("a draft written from an older snapshot that held a draft quoting the journal isn't sent, shown to its repair or made a source, once its turn gets no journal", async (t) => {
  // Turn two's search finds nothing, and its evidence, as an earlier build froze it, holds the first turn's stopped draft: its own draft takes the
  // journal's words from there, and only its check reads someone who wants to die. Turn three is a later one of that conversation.
  const THIRD = "It's the same as before.", taken = [];
  const later = {
    W: (packet) => {
      const source = packet.response_evidence.source_items.find((item) => item.kind === "unsent_draft");
      if (source) taken.push(source.exact_excerpt);
      return { reply: source ? `As before. ${source.exact_excerpt}` : "I'm here with you.", answered_level: "none", quotes: [] };
    },
    repair: () => ({ reply: "I'm here. Please call 112 now.", answered_level: "wants_to_die", quotes: [] }),
    CW: (packet) => ({ level: packet.latest_message.text === SAD ? "wants_to_die" : "none", findings: packet.latest_message.text === SAD && !Object.hasOwn(packet, "previous_candidate") ? [{ code: "VERBOSITY", severity: "substantive", summary: `synthetic: ${packet.candidate_reply}`, evidence_turn_ids: [] }] : [] })
  };
  const j = await journalTrial(t, { workers: stoppedQuotation(later) });
  assert.equal((await j.turns().run("exchange-older-1", MESSAGE)).deliveryKind, "candidate");
  const quoted = journalItems(packetOf(j.calls.find((call) => call.role === "W").request))[0].exact_excerpt;
  await stoppedBeforeItsWriter(j, "exchange-older-2");
  const record = await j.record(j.clientA), older = frozenWithAllOfIt(record, "runtime:exchange-older-2");
  assert.deepEqual(older.source_items.filter((item) => item.kind === "journal_quotation"), [], "its own search found nothing");
  await j.seed(j.clientA, record);
  const { run } = j.turns();
  const result = await run("exchange-older-2", SAD);
  assert.equal(result.answer, "I'm here. Please call 112 now.");
  assert.ok(taken.length === 1 && taken[0].includes(quoted), "its draft was written with those words in view, while it may have had the journal");
  const { candidate_responses: candidates } = await j.record(j.clientA);
  const [written, repaired] = candidates.slice(-2);
  assert.ok(written.exact_text.includes(quoted));
  assert.deepEqual([written, repaired].map((candidate) => candidate.audit_history.at(-1).findings.some((finding) => finding.code === "PROGRAM_JOURNAL_IN_CRISIS")), [true, false], "the repair was written without it");
  const before = j.calls.findIndex((call) => call.role === "W" && packetOf(call.request).latest_message.text === SAD);
  assert.equal((await run("exchange-older-3", THIRD)).answer, "I'm here with you.");
  const calls = j.calls.slice(before + 2);
  assert.deepEqual(calls.map((call) => call.role).sort(), ["CW", "CW", "R1", "R3", "W", "W-repair"], "after the check that read it: the repair, its check, and the third turn");
  for (const { role, request } of calls) assert.equal(holdsWords(request, quoted), false, `${role} gets none of its words`);
  assert.match(packetOf(calls.find((call) => call.role === "W-repair").request).previous_candidate, /^Not shown: /u);
  const snapshots = snapshotsOf(await j.record(j.clientA)).slice(-2);
  assert.deepEqual(snapshots.map((snapshot) => [snapshot.revision_reason, snapshot.source_items.some((item) => item.kind === "unsent_draft")]), [["dependency_refresh", false], ["initial", false]]);
});

test("in a case that has read no journal nothing is hidden and nothing is stopped, whatever its evidence holds", async (t) => {
  const j = await journalTrial(t, { receipt: "none", workers: stoppedQuotation({ R1: (count) => (count === 1 ? quietReader() : wantsToDieReading()), W: () => ({ reply: "I'm here with you, and I won't go away.", answered_level: "wants_to_die", quotes: [] }),
    repair: () => ({ reply: "I'm here. Please call 112 now.", answered_level: "wants_to_die", quotes: [] }),
    CW: (packet) => ({ level: "wants_to_die", findings: Object.hasOwn(packet, "previous_candidate") ? [] : [{ code: "VERBOSITY", severity: "substantive", summary: "synthetic: too long", evidence_turn_ids: [] }] }) }) });
  const { run } = j.turns();
  await run("exchange-none-1", MESSAGE);
  assert.equal((await run("exchange-none-2", SAD)).answer, "I'm here. Please call 112 now.");
  const record = await j.record(j.clientA);
  assert.deepEqual(record.candidate_responses.flatMap((candidate) => candidate.audit_history.at(-1).findings.map((finding) => finding.code)).filter((code) => code.startsWith("PROGRAM_JOURNAL")), []);
  const [repair, check] = ["W-repair", "CW"].map((role) => packetOf(lastRequest(j.calls, role)));
  for (const packet of [repair, check]) assert.equal(packet.previous_candidate, "I'm here with you, and I won't go away.");
  assert.deepEqual(repair.findings.map((finding) => finding.summary), ["synthetic: too long"]);
  assert.ok(check.response_evidence.source_items.some((item) => item.kind === "unsent_draft"), "the first turn's stopped draft is a source, as ever");
  assert.equal(snapshotsOf(record).every((snapshot) => snapshot.source_items.every((item) => item.kind !== "journal_quotation")), true);
});

test("with response evidence off a conversation about wanting to die gets its reply, also in a case that has read its journal: no call of it gets any source", async (t) => {
  const j = await journalTrial(t, { workers: script({ R1: (count) => (count === 1 ? quietReader() : wantsToDieReading()), CW: (count, request) => ({ ...wholeChecker(count, request), level: count === 1 ? "none" : "wants_to_die" }) }) });
  await j.turns().run("exchange-off-1", MESSAGE);
  assert.ok(snapshotsOf(await j.record(j.clientA)).some((snapshot) => snapshot.source_items.some((item) => item.kind === "journal_quotation")));
  const off = j.turns({ evidenceOff: true });
  const result = await off.run("exchange-off-2", SAD);
  assert.deepEqual([result.deliveryKind, result.answer], ["candidate", "What makes asking hard for you?"]);
  for (const role of ["W", "CW"]) assert.equal(Object.hasOwn(packetOf(lastRequest(j.calls, role)), "response_evidence"), false, role);
  assert.equal((await j.record(j.clientA)).candidate_responses.at(-1).audit_history.at(-1).findings.length, 0);
});

test("a reply that quoted the journal and was sent stays what it is, in the conversation and among what was sent, and is the one thing that holds its words later", async (t) => {
  const j = await journalTrial(t, { workers: script({ R1: (count) => (count === 1 ? quietReader() : wantsToDieReading()), W: (count, request) => (count === 1 ? writer(count, request) : { reply: "I'm here with you.", answered_level: "wants_to_die", quotes: [] }) }) });
  const { run } = j.turns();
  const { answer } = await run("exchange-sent-1", MESSAGE);
  const quoted = journalItems(packetOf(j.calls.find((call) => call.role === "W").request))[0].exact_excerpt;
  assert.ok(answer.includes(quoted));
  const before = j.calls.length;
  assert.equal((await run("exchange-sent-2", "I can't do this any more.")).answer, "I'm here with you.");
  for (const { role, request } of j.calls.slice(before)) {
    const packet = packetOf(request);
    assert.deepEqual(packet.conversation.filter((turn) => turn.role === "InnerSignal").map((turn) => turn.text), [answer], `${role}: the person saw it`);
    assert.deepEqual(journalItems(packet), []);
    packet.conversation = [];
    if (packet.response_evidence) packet.response_evidence.source_items = packet.response_evidence.source_items.filter((item) => item.kind !== "app_committed_client_outbound");
    assert.equal(JSON.stringify(packet).includes(JSON.stringify(quoted).slice(1, -1)), false, `${role}: nothing else holds it`);
  }
});

test("a repair gets no journal, and no search is made for it, once this turn's checker has read someone who wants to die", async (t) => {
  const asksForHistory = (count, request) => {
    const value = wholeChecker(count, request);
    if (count > 1) return { ...value, level: "wants_to_die" };
    return { ...value, level: "wants_to_die", evidence_review: { ...value.evidence_review, missing_material_history: [{ id: "missing-1", question: "When did asking for help start to feel hard?", why_material: "Synthetic.", candidate_quote: "What was different that day?", quote_occurrence: 1 }] } };
  };
  const j = await journalTrial(t, { workers: script({ CW: (count, request) => ({ ...asksForHistory(count, request), repair_induced_checks: count > 1 ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] }),
    "W-repair": () => ({ reply: "What makes asking hard for you?", answered_level: "wants_to_die", quotes: [] }) }) });
  const { happened, run } = j.turns();
  const result = await run("exchange-repair-1", MESSAGE);
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(happened.filter((step) => step === "search").length, 1, "the message's own, before anyone had read it as one");
  const snapshots = snapshotsOf(await j.record(j.clientA));
  assert.deepEqual(snapshots.map((snapshot) => [snapshot.revision_reason, snapshot.source_items.some((item) => item.kind === "journal_quotation")]), [["initial", true], ["evidence_expansion", false]]);
  assert.deepEqual(partSummary(snapshots[1].journal), WITHHELD);
  assert.deepEqual(journalItems(packetOf(lastRequest(j.calls, "W-repair"))), []);
});

test("without one, the repair's expansion searches each question and adds to the quotations the draft rests on, under the ids it quoted them by", async (t) => {
  const asksForHistory = (count, request) => {
    const value = wholeChecker(count, request);
    if (count > 1) return { ...value, repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS] };
    return { ...value, evidence_review: { ...value.evidence_review, missing_material_history: ["And the missed appointment?", "And the discomfort in the arm?"].map((question, index) => ({ id: `missing-${index}`, question, why_material: "Synthetic.", candidate_quote: "What was different that day?", quote_occurrence: 1 })) } };
  };
  const j = await journalTrial(t, { workers: script({ CW: asksForHistory, "W-repair": (count, request) => ({ ...writer(count, request), reply: `${writer(count, request).reply} And the appointment?` }) }) });
  const { happened, run } = j.turns();
  const result = await run("exchange-expansion-1", MESSAGE);
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(happened.filter((step) => step === "search").length, 2);
  const [initial, expanded] = snapshotsOf(await j.record(j.clientA)).map((snapshot) => snapshot.source_items.filter((item) => item.kind === "journal_quotation"));
  assert.ok(initial.length >= 1);
  assert.deepEqual(expanded.slice(0, initial.length), initial, "the same quotations under the same ids");
  assert.deepEqual(expanded.slice(initial.length).map((item) => item.exact_excerpt.trim()), ["I dreamed I had missed the appointment.", "I felt calmer afterward, but the discomfort in my arm continued."], "the best of each question");
  assert.deepEqual(journalItems(packetOf(lastRequest(j.calls, "W-repair"))).map((item) => item.id), expanded.map((item) => item.id));
});

test("a turn that goes on after a restart calls no reader whose reading it stored, shows its first words once, and goes by that reading", async (t) => {
  const quietAfter = () => ({ reply: "Please call 112 now. What makes asking hard for you?", answered_level: "acted_or_about_to", quotes: [] });
  // Stopped once the readings were stored and the first words shown, before the evidence was frozen.
  const read = await journalTrial(t, { workers: script({ R1: actedReading, W: quietAfter }) });
  const before = read.turns({ stopAt: "freezeResponseEvidence" });
  before.run("exchange-restart-1", MESSAGE);
  await before.stopped;
  assert.deepEqual(before.happened.filter((step) => ["R1", "R3", "provisional", "search"].includes(step)).sort(), ["R1", "R3", "provisional"]);
  const after = read.turns();
  assert.equal((await after.run("exchange-restart-1", MESSAGE)).deliveryKind, "candidate");
  assert.deepEqual(after.happened.filter((step) => ["reading", "R1", "R2", "R3", "provisional", "emergency_line", "search"].includes(step)), [], "nothing is read, shown or searched again");
  assert.deepEqual(partSummary(journalPartOf(await read.record(read.clientA))), WITHHELD);
  assert.equal((await read.record(read.clientA)).runtime_turns[0].provisional.exact_text, ACTED_PROVISIONAL);

  // Stopped between the stored reading and its first words: they go out now, from that reading, and only what isn't stored is read.
  const unsaid = await journalTrial(t, { workers: script({ R1: actedReading, W: quietAfter }) });
  const stopped = unsaid.turns({ stopAt: "recordRunnerProvisional" });
  stopped.run("exchange-restart-2", MESSAGE);
  await stopped.stopped;
  const resumed = unsaid.turns();
  assert.equal((await resumed.run("exchange-restart-2", MESSAGE)).deliveryKind, "candidate");
  assert.deepEqual(resumed.happened.filter((step) => ["R1", "provisional", "search"].includes(step)), ["provisional"]);
  assert.ok(resumed.happened.indexOf("provisional") < resumed.happened.indexOf("freeze"));
  assert.equal(unsaid.calls.filter((call) => call.role === "R1").length, 1);

  // A quiet message: its search is made once, after the restart, by the reading it stored.
  const quiet = await journalTrial(t);
  const first = quiet.turns({ stopAt: "freezeResponseEvidence" });
  first.run("exchange-restart-3", MESSAGE);
  await first.stopped;
  const second = quiet.turns();
  assert.equal((await second.run("exchange-restart-3", MESSAGE)).deliveryKind, "candidate");
  assert.deepEqual(second.happened.filter((step) => ["R1", "R3", "search", "freeze"].includes(step)), ["search", "freeze"]);
  assert.equal(journalPartOf(await quiet.record(quiet.clientA)).availability, "available");
});

test("a reader's failure, its time running out and the plan's limit end a turn as they always have", async (t) => {
  const failing = (code) => () => { throw Object.assign(new Error("A synthetic worker failure."), { code }); };
  // The crisis reader alone fails: the turn goes on as unread, and a conversation that was a crisis one before shows the line at once.
  const unread = await journalTrial(t, { workers: script({ R1: (count) => (count === 1 ? wantsToDieReading() : failing("TIMEOUT")()) }) });
  const alone = unread.turns();
  assert.equal((await alone.run("exchange-failed-1", MESSAGE)).deliveryKind, "candidate");
  assert.equal((await alone.run("exchange-failed-2", MESSAGE)).deliveryKind, "candidate");
  const [, second] = (await unread.record(unread.clientA)).runtime_turns;
  assert.deepEqual([second.runner_reading.readers.crisis.unread, second.emergency_line_reason], [true, "no_reading_in_crisis_conversation"]);
  assert.equal(unread.calls.filter((call) => call.role === "R1").length, 2, "one attempt each, as before");
  // The plan's limit, or the time, for every worker: the closing says so, with the emergency line, and the writer was asked as before.
  for (const [code, reason] of [["PLAN_LIMIT", "plan_limit"], ["TIMEOUT", "timeout"], ["SIGN_IN_NEEDED", "sign_in_needed"]]) {
    const down = await journalTrial(t, { workers: script({ R1: failing(code), R3: failing(code), W: failing(code) }) });
    const result = await down.turns().run("exchange-down-1", MESSAGE);
    assert.deepEqual(result.closing, { kind: "runner_unavailable", reason_code: reason });
    const [turn] = (await down.record(down.clientA)).runtime_turns;
    assert.equal(turn.emergency_line_reason, "turn_closed_without_reply");
    assert.equal(down.calls.some((call) => call.role === "W"), true, code);
    assert.deepEqual(turn.events.filter((event) => event.stage === "candidate").map((event) => event.event_type), ["INVOCATION_STARTED", "INVOCATION_FAILED"]);
  }
});

test("a turn of a case that has read its journal, while its gate is closed, is read by no one and closes as it always has", async (t) => {
  const j = await journalTrial(t);
  const { happened, run } = j.turns();
  await run("exchange-gate-1", MESSAGE);
  await setJournalConsent({ home: j.home, number: 1, action: "withdraw" });
  happened.splice(0);
  const result = await run("exchange-gate-2", MESSAGE);
  assert.deepEqual(result.closing, { kind: "runner_unavailable", reason_code: "checks_failed" });
  assert.deepEqual(happened.filter((step) => ["reading", "R1", "R3", "W", "search"].includes(step)), []);
  const record = await j.record(j.clientA);
  assert.deepEqual(partSummary(journalPartOf(record)), WITHHELD, "an unread message's journal isn't searched for");
  const turn = record.runtime_turns.at(-1);
  assert.deepEqual([turn.runner_reading ?? null, turn.emergency_line_reason], [null, "turn_closed_without_reply"]);
  assert.deepEqual(turn.events.filter((event) => event.stage === "candidate").map((event) => [event.event_type, event.details?.error_code ?? null]), [["INVOCATION_STARTED", null], ["INVOCATION_FAILED", "JOURNAL_GATE_CLOSED"]]);
});

test("a trial without clients has no journal reader: its turns' evidence is frozen before anyone reads, exactly as before", async (t) => {
  const j = await journalTrial(t);
  const { happened, run } = j.turns({ withClients: false });
  assert.equal((await run("exchange-own-order", "A synthetic message of the owner's own.", { caseId: j.ownCase })).deliveryKind, "candidate");
  assert.deepEqual(happened.filter((step) => ["freeze", "reading", "R1", "R3", "writing", "W", "search"].includes(step)), ["freeze", "reading", "R1", "R3", "writing", "W"]);
  assert.equal(journalPartOf(await j.record(j.ownCase)).availability, "not_configured");
});

test("each quotation comes to the writer, the checker and the repair with its note, and they are told what a quotation is and isn't; with none, they get what they always got", async (t) => {
  const failsOnce = (count, request) => ({ ...wholeChecker(count, request), findings: count === 1 ? [{ code: "VERBOSITY", severity: "substantive", summary: "synthetic: too long", evidence_turn_ids: [] }] : [],
    repair_induced_checks: count > 1 ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] });
  const repairs = script({ CW: failsOnce, "W-repair": (count, request) => ({ ...writer(count, request), reply: `${writer(count, request).reply} Shorter.` }) });
  const withJournal = await journalTrial(t, { workers: repairs });
  await withJournal.turns().run("exchange-notes-1", MESSAGE);
  for (const [role, note] of [["W", WRITER_EVIDENCE_NOTE], ["CW", CHECKER_EVIDENCE_NOTE], ["W-repair", WRITER_EVIDENCE_NOTE]]) {
    const request = lastRequest(withJournal.calls, role);
    const items = journalItems(packetOf(request));
    assert.ok(items.length >= 1, role);
    for (const item of items) assert.deepEqual(Object.keys(item.journal_note).sort(), ["cues", "lifecycle", "written"]);
    assert.ok(request.system.includes(note), role);
  }
  for (const note of [WRITER_EVIDENCE_NOTE, CHECKER_EVIDENCE_NOTE]) {
    for (const said of [/shared words/u, /nothing to do with this message/u, /only when it helps with what the person says now/u, /when the entry says it was written, never when something happened/u, /interval or (?:an )?inferred year is not a day/u, /dream, plan, wish or denial stays one/u,
      /never a reason for crisis text/u, /never raises or lowers the level/u]) assert.match(note, said);
  }
  const without = await journalTrial(t, { workers: repairs });
  await without.turns().run("exchange-notes-2", "A synthetic message for client two.", { caseId: without.clientB });
  for (const [role, note] of [["W", WRITER_EVIDENCE_NOTE_NO_QUOTATION], ["CW", CHECKER_EVIDENCE_NOTE_NO_QUOTATION], ["W-repair", WRITER_EVIDENCE_NOTE_NO_QUOTATION]]) {
    const request = lastRequest(without.calls, role);
    assert.ok(request.system.includes(note) && !request.system.includes("shared words"), role);
  }
});
