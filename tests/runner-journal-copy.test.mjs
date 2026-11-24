import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { createJournalCopyKeyPair, exportJournalCopy, importJournalCopy, openJournalCopy, sealJournalCopy, writeSealedJournalCopy } from "../src/journal-import/journal-copy.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients } from "../src/runner-trial/clients.mjs";
import { runJournalColdTest } from "../src/runner-trial/journal-cold-test.mjs";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";
import { COPY_KEY_FILE, STAGED_COPY_FILE, ensureJournalCopyKey, importClientJournal, parseJournalArguments, runClientColdTest } from "../scripts/runner-trial-journal.mjs";

// The copy step for a client's journal (design for clients, point 4): exported where the journal lives, sealed for the trial
// alone, imported into the client's runner case and checked. The "server" here is a synthetic local vault with the journal
// import's synthetic fixture: no server is contacted and no real journal is read.

// A case id of the runner form, since the cold test below runs on it as on a client's runner case.
const SERVER_CASE = "case-12121212-1212-4121-8121-121212121212", SERVER_CORPUS = "synthetic-server-corpus";
const allowAll = (caseIds) => ({ async authorize({ caseId, requiredScope }) {
  return { allowed: caseIds.includes(caseId), principalId: "synthetic-operator", scopes: [requiredScope], purposes: Object.values(PRIVATE_JOURNAL_PURPOSES) };
} });

async function serverJournal(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-server-"));
  const keys = { routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62) };
  const store = createEncryptedPrivateCaseStore({ rootDir, ...keys, developmentExternalCredentialAuthorized: true });
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const service = createPrivateCaseAccessService({ rootDir, authorizationProvider: allowAll([SERVER_CASE]), keyProvider: { async getCaseKeyMaterial() {
    return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true };
  } } });
  const auth = { bearerToken: "synthetic-operator" };
  const read = async (name) => JSON.parse(await fs.readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
  const graph = JSON.parse(JSON.stringify(await read("synthetic-graph.json")).replaceAll('"synthetic-case"', JSON.stringify(SERVER_CASE)).replaceAll('"synthetic-corpus"', JSON.stringify(SERVER_CORPUS)));
  const sources = await read("synthetic-sources.json");
  await service.appendTranscriptTurn(SERVER_CASE, { id: "turn:1", exchange_id: "exchange:1", role: "user", text: "A synthetic message.", at: "2026-11-24T08:00:00.000Z", episode_id: null }, auth);
  await service.createJournalCorpus(SERVER_CASE, { corpusId: SERVER_CORPUS, manifestObjectId: "manifest:staging" }, auth);
  let persisted;
  await service.withJournalCorpus(SERVER_CASE, SERVER_CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096 });
  }, auth);
  await service.publishJournalGeneration(SERVER_CASE, { corpusId: SERVER_CORPUS, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, auth);
  return { service, auth, sources, rootDir, keys };
}

const modeOf = async (file) => (await fs.stat(file)).mode & 0o777;

test("a client's journal is exported sealed for the trial alone, imported into the client's runner case, checked quote by quote, and read there under the client's own grant", async (t) => {
  const server = await serverJournal(t);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-trial-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await prepareTrialFolder({ home, provider: "codex" });
  await addClient({ home, label: "Synthetic client one" });
  await setJournalConsent({ home, number: 1, action: "confirm" });
  const prepared = await prepareTrialFolder({ home, provider: "codex" });
  const clientCase = (await readRunnerClients(home)).clients[0].case_id;
  const keyPair = createJournalCopyKeyPair();

  const sealed = await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: keyPair.publicKey });
  const text = JSON.stringify(sealed);
  for (const line of server.sources.repr.split("\n").filter((entry) => entry.length > 8)) assert.equal(text.includes(line), false, "the sealed copy shows nothing of the journal");
  assert.throws(() => openJournalCopy(sealed, createJournalCopyKeyPair()), { code: "JOURNAL_COPY_OTHER_RECIPIENT" });
  const bundle = openJournalCopy(sealed, keyPair);
  const tampered = structuredClone(bundle);
  tampered.source_representations.repr = tampered.source_representations.repr.replace("help", "hope");
  assert.throws(() => openJournalCopy(sealJournalCopy(tampered, keyPair.publicKey), keyPair), { code: "JOURNAL_COPY_DIGEST_MISMATCH" });

  // The import, as the copy step's one-time grant runs it: write and every journal purpose, for the client's case alone.
  const providers = await loadDevelopmentPrivateCaseProviders(prepared.credentialsPath);
  t.after(() => providers.close());
  const copier = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: allowAll([clientCase]), keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const result = await importJournalCopy({ caseAccessService: copier, caseId: clientCase, corpusId: "corpus:synthetic-copy", authContext: { bearerToken: "synthetic-copy-step" }, bundle });
  assert.ok(result.passages_verified >= 3);
  assert.equal(result.corpus_id, "corpus:synthetic-copy");

  // Read in the client's runner case under the client's own grant, through the gate, once the copy is on the list and its receipt
  // planted (the cold test writes it).
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider, keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  const list = await readRunnerClients(home);
  list.clients[0].journal.corpus_id = result.corpus_id;
  await (await import("../src/runner-trial/clients.mjs")).writeRunnerClients(home, list);
  const folder = clientJournalFolder(home, clientCase);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, COLD_TEST_RECEIPT_FILE), JSON.stringify({ schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: clientCase, corpus_id: result.corpus_id,
    generation: result.generation, manifest_object_id: result.manifest_object_id, visibility_epoch: result.visibility_epoch, tested_at: "2026-11-24T08:00:00.000Z" }), { mode: 0o600 });
  const gate = createRunnerJournalGate({ trialDir: home, caseAccessService: service });
  const part = await gate.freezeResponseEvidenceJournal({ caseId: clientCase, query: "help", authContext: { bearerToken: prepared.clientTokens[clientCase] } });
  assert.equal(part.availability, "available");
  assert.ok(part.source_items.length >= 1 && part.source_items.every((item) => server.sources.repr.includes(item.exact_excerpt) && item.locator.corpus_id === result.corpus_id));
});

// ---- The cold test ------------------------------------------------------------------------------------------------------------

// A scripted stand-in for the fresh consumer: it sees only the packet (the frozen question and what the session-use reader
// retrieved). It answers "supported" citing the passages it retrieved, or "not found" when it retrieved none, except for the
// questions `script` answers otherwise (a model judges a false premise itself). `miss` makes it answer every question as not
// found; `overclaim` makes it ignore the script, so a false premise with retrieved passages is answered as supported.
const consumer = ({ miss = false, overclaim = false, script = { "q-premise": "false_premise" } } = {}) => ({
  async invoke({ packet }) {
    const passages = (packet.retrieved_evidence?.records ?? []).filter((record) => record.kind === "passage").map((record) => record.id);
    const scripted = overclaim ? undefined : script[packet.frozen_question.id];
    const answerability = miss ? "not_found" : scripted ?? (passages.length ? "supported" : "not_found");
    const output = { schema_version: "1.0", question_id: packet.frozen_question.id, answer: "A synthetic answer.",
      answerability, evidence_ids: answerability === "not_found" ? [] : passages,
      qualifier_ids: [], snapshot_generation: packet.expected_generation, coverage_note: "Synthetic.", more_available: false };
    return { output, receipt: { provider: "stand-in", model: "stand-in" } };
  }
});

// Questions on the synthetic fixture, with the key naming its evidence by exact words of the journal.
const QUESTIONS = Object.freeze({ schema_version: 1, kind: "journal_cold_questions", questions: [
  { id: "q-colleague", question: "colleague", answerable: true, evidence_quotes: ["ask a colleague for help", "asked a  colleague\nfor help"] },
  { id: "q-premise", question: "When did the colleague refuse to help?", answerable: false },
  { id: "q-absent", question: "zebra", answerable: false }
] });
const withQuestions = (questions) => ({ ...QUESTIONS, questions });

test("the cold test: a fresh consumer answers frozen questions from the copy alone; a strict pass gives the receipt for exactly that snapshot, anything less gives none", async (t) => {
  const server = await serverJournal(t);
  const run = (port, questions = QUESTIONS) => runJournalColdTest({ service: server.service, auth: server.auth, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, questions, port, now: () => new Date("2026-11-24T09:00:00.000Z") });
  const passed = await run(consumer());
  assert.equal(passed.passed, true, JSON.stringify(passed.report));
  const reference = (await server.service.inspectJournalCorpus(SERVER_CASE, SERVER_CORPUS, { requiredScope: "case:read", requiredPurpose: "session_use" }, server.auth)).reference;
  assert.deepEqual(passed.receipt, { schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: SERVER_CASE, corpus_id: SERVER_CORPUS,
    generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch, tested_at: "2026-11-24T09:00:00.000Z" });
  assert.equal(JSON.stringify(passed.report).includes("colleague for help"), false, "the report holds ids and scores, no journal text");
  // A consumer that misses what the journal holds, or claims support for a false premise, doesn't pass: no receipt.
  for (const [failing, wrong] of [[consumer({ miss: true }), "q-colleague"], [consumer({ overclaim: true }), "q-premise"]]) {
    const failed = await run(failing);
    assert.equal(failed.passed, false);
    assert.equal(failed.receipt, null);
    assert.deepEqual(failed.report.by_question.filter((entry) => !entry.graph.right).map((entry) => entry.id), [wrong]);
  }
  await assert.rejects(run(consumer(), withQuestions(QUESTIONS.questions.slice(0, 1))), { code: "COLD_QUESTIONS_NEED_BOTH_KINDS" });
  // A key quote that no passage holds stops the test (the key is wrong), naming the question only.
  await assert.rejects(run(consumer(), withQuestions([{ ...QUESTIONS.questions[0], evidence_quotes: ["a sentence the journal never had"] }, QUESTIONS.questions[1]])),
    (error) => error.code === "COLD_KEY_QUOTE_NOT_IN_JOURNAL" && error.details?.question_id === "q-colleague");
  await assert.rejects(run(consumer(), withQuestions([{ ...QUESTIONS.questions[0], extra: "no" }, QUESTIONS.questions[1]])), { code: "COLD_QUESTIONS_INVALID" });
});

// ---- The commands ------------------------------------------------------------------------------------------------------------

test("the journal import's export writes the sealed copy whole to a new private file, its settings from the private configuration only", async (t) => {
  const server = await serverJournal(t);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-export-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const keyPair = createJournalCopyKeyPair();
  const output = path.join(dir, "copy.sealed.json");
  const config = { schema_version: 1, target_profile: { case_id: SERVER_CASE }, private_runtime_root: server.rootDir,
    runner_trial_export: { corpus_id: SERVER_CORPUS, recipient_public_key: keyPair.publicKey, output_path: output } };
  const configPath = path.join(dir, "run.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const loader = () => ({ rootDir: server.rootDir, authorizationProvider: allowAll([SERVER_CASE]), keyProvider: { async getCaseKeyMaterial() {
    return { routineKek: Buffer.from(server.keys.routineKek), recoverySecretBytes: Buffer.from(server.keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true };
  } }, close() {} });
  const cli = async (argv, file = configPath) => {
    let stdout = "", stderr = "";
    const code = await runJournalImportCli([...argv, "--config", file], { stdout: { write: (chunk) => { stdout += chunk; } }, stderr: { write: (chunk) => { stderr += chunk; } },
      environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: "synthetic-operator" }, exportProvidersLoader: loader });
    return { code, stdout, stderr };
  };
  const exported = await cli(["export"]);
  assert.equal(exported.code, 0, exported.stderr);
  assert.equal(JSON.parse(exported.stdout).exported, true);
  assert.equal(await modeOf(output), 0o600);
  assert.ok(openJournalCopy(JSON.parse(await fs.readFile(output, "utf8")), keyPair).graph.nodes.length > 0);
  // Never over another file.
  assert.deepEqual(JSON.parse((await cli(["export"])).stderr), { error: "JOURNAL_COPY_FILE_EXISTS" });
  // Without its settings, it stops before any env file is read (this one doesn't exist).
  const bare = path.join(dir, "bare.json");
  await fs.writeFile(bare, JSON.stringify({ ...config, runner_trial_export: undefined }), { mode: 0o600 });
  assert.deepEqual(JSON.parse((await cli(["export", "--env-file", path.join(dir, "missing.env")], bare)).stderr), { error: "JOURNAL_EXPORT_CONFIG_INVALID" });
  const badKey = path.join(dir, "bad-key.json");
  await fs.writeFile(badKey, JSON.stringify({ ...config, runner_trial_export: { ...config.runner_trial_export, recipient_public_key: "bm90IGEga2V5" } }), { mode: 0o600 });
  assert.deepEqual(JSON.parse((await cli(["export"], badKey)).stderr), { error: "JOURNAL_EXPORT_RECIPIENT_INVALID" });
});

test("the laptop commands: the trial folder's key, the import while the trial is stopped, and a cold test whose receipt opens the gate", async (t) => {
  const server = await serverJournal(t);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-commands-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await prepareTrialFolder({ home, provider: "codex" });
  await addClient({ home, label: "Synthetic client one" });
  await addClient({ home, label: "Synthetic client two" });
  assert.deepEqual(parseJournalArguments(["--cold-test", path.join(home, "q.json"), "--provider", "claude"]), { command: "cold-test", file: path.join(home, "q.json"), provider: "claude", dir: null });
  assert.throws(() => parseJournalArguments(["--import", "--provider", "claude"]), /--provider goes with --cold-test only/u);

  // The key: made once, its private half mode 0600 in the trial folder.
  const made = await ensureJournalCopyKey({ home });
  assert.equal(made.made, true);
  assert.equal(await modeOf(path.join(home, COPY_KEY_FILE)), 0o600);
  assert.deepEqual(await ensureJournalCopyKey({ home }), { publicKey: made.publicKey, made: false });

  // The export for that key (as the server's step would write it), then the import while the "trial" holds the vault.
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-transfer-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const sealedPath = path.join(outside, "copy.sealed.json");
  await writeSealedJournalCopy(sealedPath, await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: made.publicKey }));
  const prepared = await prepareTrialFolder({ home, provider: "codex" });
  const providers = await loadDevelopmentPrivateCaseProviders(prepared.credentialsPath);
  t.after(() => providers.close());
  const clientCase = (await readRunnerClients(home)).clients[0].case_id;
  const staged = path.join(clientJournalFolder(home, clientCase), STAGED_COPY_FILE);
  const running = await acquirePrivateRootWriterLock({ rootDir: providers.rootDir });
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath }), /The trial is running/u);
  await running.release();
  await assert.rejects(fs.access(sealedPath), "the sealed file was moved into the client's folder");
  assert.equal(await modeOf(staged), 0o600);
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: staged }), /already waits/u);
  const imported = await importClientJournal({ home, number: 1 });
  assert.ok(imported.passages_verified >= 3);
  await assert.rejects(fs.access(staged), "removed once the copy is published");
  const clients = (await readRunnerClients(home)).clients;
  assert.equal(clients[0].journal.corpus_id, imported.corpus_id);
  assert.equal(clients[1].journal.corpus_id, null);

  // The cold test: refused without consent; with it, a miss records nothing and a pass records the receipt the gate then accepts.
  const questionsPath = path.join(outside, "questions.json");
  await fs.writeFile(questionsPath, JSON.stringify(QUESTIONS), { mode: 0o600 });
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: consumer() }), /no confirmed journal consent/u);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  await assert.rejects(runClientColdTest({ home, number: 2, questionsPath, port: consumer() }), /no confirmed journal consent/u);
  const receiptPath = path.join(clientJournalFolder(home, clientCase), COLD_TEST_RECEIPT_FILE);
  assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer({ miss: true }) })).passed, false);
  await assert.rejects(fs.access(receiptPath));
  const passed = await runClientColdTest({ home, number: 1, questionsPath, port: consumer() });
  assert.equal(passed.passed, true, JSON.stringify(passed.report));
  assert.equal(await modeOf(receiptPath), 0o600);
  await fs.chmod(questionsPath, 0o644);
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: consumer() }), /readable by you alone/u);

  const started = await prepareTrialFolder({ home, provider: "codex" });
  const startedProviders = await loadDevelopmentPrivateCaseProviders(started.credentialsPath);
  t.after(() => startedProviders.close());
  const gate = createRunnerJournalGate({ trialDir: home, caseAccessService: createPrivateCaseAccessService({ rootDir: startedProviders.rootDir,
    authorizationProvider: startedProviders.authorizationProvider, keyProvider: startedProviders.keyProvider, allowDevelopmentFileProvider: true }) });
  const part = await gate.freezeResponseEvidenceJournal({ caseId: clientCase, query: "colleague", authContext: { bearerToken: started.clientTokens[clientCase] } });
  assert.equal(part.availability, "available");
  assert.ok(part.source_items.every((item) => item.locator.corpus_id === imported.corpus_id && server.sources.repr.includes(item.exact_excerpt)));

  // A new copy needs its own cold test: importing again drops the receipt, and the gate is closed until one passes.
  await writeSealedJournalCopy(sealedPath, await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: made.publicKey }));
  const again = await importClientJournal({ home, number: 1, sealedPath });
  assert.notEqual(again.corpus_id, imported.corpus_id);
  await assert.rejects(fs.access(receiptPath));
  const closed = await gate.freezeResponseEvidenceJournal({ caseId: clientCase, query: "colleague", authContext: { bearerToken: started.clientTokens[clientCase] } });
  assert.notEqual(closed.availability, "available");
});
