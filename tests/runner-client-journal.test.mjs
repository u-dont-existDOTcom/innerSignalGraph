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
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { RUNNER_UNAVAILABLE_NOTICE } from "../src/runner-trial/notices.mjs";
import { CHECKER_EVIDENCE_NOTE, WRITER_EVIDENCE_NOTE } from "../src/runner-trial/worker-prompts.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS } from "../src/supervisor/response-evidence-contract.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";

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
async function journalTrial(t, { evidence = true, consent = true, receipt = "match", workers = script(), checkerMode = "whole" } = {}) {
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
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialCaseId: prepared.caseId, runnerTrialDir: home, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, runnerRulesRoot: null, responseEvidenceEnforced: evidence });
  const fake = fakeWorkers(workers);
  const makeTrial = (source = service) => createRunnerTrialController({ privateCaseSource: source, config, clientCaseIds: [...caseAuthContexts.keys()], settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode }), parts, workerFor: fake.workerFor });
  return {
    home, prepared, service, copier, copyAuth, ownAuth, caseAuthContexts, clientA, clientB, ownCase: prepared.caseId, calls: fake.calls, reference, sources, plantReceipt, makeTrial,
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
  const duringReaders = await journalTrial(t, { workers: script({ R1: async () => { await setJournalConsent({ home, number: 1, action: "withdraw" }); return quietReader(); } }) });
  home = duringReaders.home;
  const first = await duringReaders.serve();
  const closed = await respond(first.base, duringReaders.clientA, "exchange-readers-1");
  assert.deepEqual([closed.status, closed.json.closing], [200, { kind: "runner_unavailable", reason_code: "checks_failed" }]);
  assert.equal(duringReaders.calls.some((call) => ["W", "CW"].includes(call.role)), false, "no writer or checker got the journal");

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
