import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { RUNNER_UNAVAILABLE_NOTICE } from "../src/runner-trial/notices.mjs";
import { CHECKER_EVIDENCE_NOTE, CHECKER_EVIDENCE_NOTE_NO_QUOTATION, WRITER_EVIDENCE_NOTE, WRITER_EVIDENCE_NOTE_NO_QUOTATION } from "../src/runner-trial/worker-prompts.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS } from "../src/supervisor/response-evidence-contract.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";

// A client's journal in the runner trial (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, points 4 to 7): the
// journal gate (consent, a published session_use copy in the client's runner case, a cold-test receipt for exactly that copy) and
// pull request 241's response evidence wired into the trial's writer, checker, repair and delivery. Every journal here is the
// journal import's synthetic fixture, every client and message is invented, the cold-test receipt is planted by the test (the cold
// test isn't built), and every worker is a stand-in: no model is called and no real record or journal is read.

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
    await fs.writeFile(path.join(folder, COLD_TEST_RECEIPT_FILE), JSON.stringify({ schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: clientA, corpus_id: CORPUS,
      generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch, tested_at: "2026-11-24T08:00:00.000Z", ...overrides }), { mode: 0o600 });
  };
  if (receipt === "match") await plantReceipt();
  if (receipt === "other-generation") await plantReceipt({ generation: "generation-0" });
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true, responseEvidencePolicy: evidence ? "enforced" : "advisory" });
  const caseAuthContexts = new Map(Object.entries(prepared.clientTokens).map(([caseId, token]) => [caseId, Object.freeze({ bearerToken: token })]));
  const ownAuth = Object.freeze({ bearerToken: prepared.token });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialCaseId: prepared.caseId, runnerTrialDir: home, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, runnerRulesRoot: null, responseEvidenceEnforced: evidence, ...configured });
  const fake = fakeWorkers(workers);
  const makeTrial = (source = service) => createRunnerTrialController({ privateCaseSource: source, config, clientCaseIds: [...caseAuthContexts.keys()], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode }), parts, workerFor: fake.workerFor });
  return {
    home, prepared, service, copier, copyAuth, ownAuth, caseAuthContexts, clientA, clientB, ownCase: prepared.caseId, calls: fake.calls, reference, sources, plantReceipt, makeTrial,
    // Turns on the trial's controller itself, client one's unless told otherwise, with everything that happens kept in one order: each
    // event the turn's page would get, each journal search as it starts (`search`; the one place the copy is opened), each evidence
    // snapshot as it is frozen (`freeze`) and each worker's call as it starts (its role). `onSearch`, when given, is awaited as a search
    // starts; `stopAt` names a store call at which the process stops for good (`stopped` resolves then); `withClients: false` is a
    // trial without clients, which has no journal reader.
    turns({ onSearch = null, stopAt = null, withClients = true } = {}) {
      const happened = [];
      let reached;
      const stopped = new Promise((resolve) => { reached = resolve; });
      const source = {
        ...service,
        async withJournalCorpus(...args) {
          happened.push("search");
          if (onSearch) await onSearch(happened);
          return service.withJournalCorpus(...args);
        },
        async freezeResponseEvidence(...args) { happened.push("freeze"); return service.freezeResponseEvidence(...args); }
      };
      if (stopAt) source[stopAt] = () => { reached(); return new Promise(() => {}); };
      const trial = createRunnerTrialController({ privateCaseSource: source, config, clientCaseIds: withClients ? [...caseAuthContexts.keys()] : [], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode }), parts,
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
    record: (caseId) => service.loadPrivateRuntimeCase(caseId, caseId === prepared.caseId ? ownAuth : caseAuthContexts.get(caseId))
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
const WITHHELD = ["unavailable", "not_attempted", [{ reason: "crisis_turn", count: 1 }]];
const partSummary = (part) => [part.availability, part.retrieval_status, part.omissions];

test("the readers read, and the first words are shown, before any journal search starts", async (t) => {
  // The journal is held until the turn's provisional reply is out: searched first, as before, the search would run out of its time.
  const bodySign = () => ({ ...quietReader(), reason: "a body sign after stopping daily drinking", number_now: true, provisional_reply: ACTED_PROVISIONAL });
  const j = await journalTrial(t, { configured: { runnerNumberNowEnabled: true }, workers: script({ R1: bodySign,
    W: (count, request) => ({ ...writer(count, request), reply: "Please call 112 now. What makes asking hard for you?", quotes: [] }) }) });
  let release;
  const shown = new Promise((resolve) => { release = resolve; });
  const { happened, run, trial } = j.turns({ onSearch: () => shown });
  trial.events.subscribe(j.clientA, "runtime:exchange-first-words", (event) => { if (event.type === "provisional") release(); });
  const result = await run("exchange-first-words", MESSAGE);
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(happened.filter((step) => step === "search").length, 1);
  for (const earlier of ["reading", "R1", "R3", "provisional"]) assert.ok(happened.indexOf(earlier) >= 0 && happened.indexOf(earlier) < happened.indexOf("search"), `${earlier} comes before the search: ${happened}`);
  assert.deepEqual(happened.slice(happened.indexOf("search"), happened.indexOf("W") + 1), ["search", "freeze", "writing", "W"], "then the evidence is frozen and the writer writes");
  assert.equal(journalPartOf(await j.record(j.clientA)).availability, "available");
  assert.ok(journalItems(packetOf(lastRequest(j.calls, "W"))).length >= 1);
});

test("a message read as wanting to die or having acted, or not read at all, gets no journal and no search is made", async (t) => {
  const failing = () => { throw Object.assign(new Error("A synthetic reader failure."), { code: "PROVIDER_FAILED" }); };
  for (const [name, R1] of [["wants to die", wantsToDieReading], ["acted", actedReading], ["unread", failing]]) {
    const j = await journalTrial(t, { workers: script({ R1, W: () => ({ reply: "Please call 112 now. I'm here.", answered_level: "unclear", quotes: [] }) }) });
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
    assert.equal(record.runtime_turns[0].provisional?.exact_text ?? null, name === "acted" ? ACTED_PROVISIONAL : null, `${name}: the first words are what they were`);
  }
  // Only those: a message read at any other level gets the journal, one that could mean either included.
  for (const level of ["thoughts_no_intent", "unclear"]) {
    const j = await journalTrial(t, { workers: script({ R1: () => ({ ...quietReader(), level }) }) });
    const { happened, run } = j.turns();
    await run("exchange-other-level", MESSAGE);
    assert.equal(happened.filter((step) => step === "search").length, 1, level);
    assert.equal(journalPartOf(await j.record(j.clientA)).availability, "available");
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
      /"superseded" means a later entry corrected it/u, /never a reason for crisis text/u, /never raises or lowers the level/u]) assert.match(note, said);
  }
  const without = await journalTrial(t, { workers: repairs });
  await without.turns().run("exchange-notes-2", "A synthetic message for client two.", { caseId: without.clientB });
  for (const [role, note] of [["W", WRITER_EVIDENCE_NOTE_NO_QUOTATION], ["CW", CHECKER_EVIDENCE_NOTE_NO_QUOTATION], ["W-repair", WRITER_EVIDENCE_NOTE_NO_QUOTATION]]) {
    const request = lastRequest(without.calls, role);
    assert.ok(request.system.includes(note) && !request.system.includes("shared words"), role);
  }
});
