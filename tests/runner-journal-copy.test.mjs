import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createJournalCopyKeyPair, exportJournalCopy, importJournalCopy, journalCopyCorpusId, openJournalCopy, sealJournalCopy, writeSealedJournalCopy } from "../src/journal-import/journal-copy.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { runJournalColdTest } from "../src/runner-trial/journal-cold-test.mjs";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";
import { CLIENT_COPY_KEY_FILE, IMPORT_PURPOSES, ensureJournalCopyKey, importClientJournal, oneTimeGrant, parseJournalArguments, runClientColdTest } from "../scripts/runner-trial-journal.mjs";

// The copy step for a client's journal (design for clients, point 4) and its cold test (point 5c): exported where the journal lives,
// sealed for one client's key alone, imported into that client's runner case and checked. The "server" here is a synthetic local
// vault with the journal import's synthetic fixture or a generated synthetic journal: no server is contacted and no real journal is
// read.

// A case id of the runner form, since the cold test below runs on it as on a client's runner case.
const SERVER_CASE = "case-12121212-1212-4121-8121-121212121212", SERVER_CORPUS = "synthetic-server-corpus";
const allPurposes = Object.values(PRIVATE_JOURNAL_PURPOSES);
const allowAll = (caseIds, purposes = allPurposes) => ({ async authorize({ caseId, requiredScope }) {
  return { allowed: caseIds.includes(caseId), principalId: "synthetic-operator", scopes: [requiredScope], purposes };
} });
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const modeOf = async (file) => {
  const handle = await fs.open(file, "r");
  try { return (await handle.stat()).mode & 0o777; } finally { await handle.close(); }
};
const absent = (file, message) => assert.rejects(fs.readFile(file), { code: "ENOENT" }, message);
const fixture = async (name) => JSON.parse(await fs.readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));

// A synthetic journal of plain-text pages, one passage per line, the pages' sources listed in the order given.
function generatedJournal(pages) {
  const base = { case_id: SERVER_CASE, corpus_id: SERVER_CORPUS, version: 1, lifecycle: "active" };
  const nodes = [], representations = {};
  for (const page of pages) {
    const text = page.lines.map((line) => `${line}\n`).join("");
    representations[page.representationId] = text;
    nodes.push({ ...base, id: page.sourceId, kind: "source", data: { representation_id: page.representationId, original_object_id: "original", media_type: "text/plain", byte_length: Buffer.byteLength(text), parse_status: "readable" } });
  }
  for (const page of pages) {
    let offset = 0;
    page.lines.forEach((line, index) => {
      const quote = `${line}\n`;
      nodes.push({ ...base, id: `${page.representationId}-p${String(index).padStart(3, "0")}`, kind: "passage", data: { representation_id: page.representationId, unit_id: `u-${page.representationId}`,
        start_byte: offset, end_byte: offset + Buffer.byteLength(quote), quote, quote_sha256: sha256(quote),
        locator: { kind: "native_text", page: null, bbox: null, original_object_id: "original", interpretation_status: "native" } } });
      offset += Buffer.byteLength(quote);
    });
  }
  return { graph: { schema_version: "1.0", case_id: SERVER_CASE, corpus_id: SERVER_CORPUS, generation: "generation-synthetic", nodes, edges: [] }, sources: representations };
}

async function serverJournal(t, { journal = null, extraIndexes = {}, indexRepresentations = false, shardTargetBytes = 4096 } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-server-"));
  const keys = { routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62) };
  const store = createEncryptedPrivateCaseStore({ rootDir, ...keys, developmentExternalCredentialAuthorized: true });
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const keyProvider = { async getCaseKeyMaterial() {
    return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true };
  } };
  const service = createPrivateCaseAccessService({ rootDir, authorizationProvider: allowAll([SERVER_CASE]), keyProvider });
  const auth = { bearerToken: "synthetic-operator" };
  const { graph, sources } = journal ?? {
    graph: JSON.parse(JSON.stringify(await fixture("synthetic-graph.json")).replaceAll('"synthetic-case"', JSON.stringify(SERVER_CASE)).replaceAll('"synthetic-corpus"', JSON.stringify(SERVER_CORPUS))),
    sources: await fixture("synthetic-sources.json")
  };
  await service.appendTranscriptTurn(SERVER_CASE, { id: "turn:1", exchange_id: "exchange:1", role: "user", text: "A synthetic message.", at: "2026-11-24T08:00:00.000Z", episode_id: null }, auth);
  await service.createJournalCorpus(SERVER_CASE, { corpusId: SERVER_CORPUS, manifestObjectId: "manifest:staging" }, auth);
  let persisted;
  await service.withJournalCorpus(SERVER_CASE, SERVER_CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes, extraIndexes, indexRepresentations });
  }, auth);
  await service.publishJournalGeneration(SERVER_CASE, { corpusId: SERVER_CORPUS, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, auth);
  // The same vault, as an operator whose grant holds only the given purposes opens it.
  const withPurposes = (purposes) => createPrivateCaseAccessService({ rootDir, authorizationProvider: allowAll([SERVER_CASE], purposes), keyProvider });
  return { service, withPurposes, auth, graph, sources, rootDir, keyProvider, manifestObjectId: persisted.manifest_object_id };
}

// A trial folder with clients, as the start script makes them (the first one's consent confirmed before the start, when asked); the
// copier is the copy step's own one-time grant for one case.
async function trialWith(t, clients = 1, { consent = false } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-trial-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await prepareTrialFolder({ home, provider: "codex" });
  for (let index = 0; index < clients; index += 1) await addClient({ home, label: `Synthetic client ${index + 1}` });
  if (consent) await setJournalConsent({ home, number: 1, action: "confirm" });
  const prepared = await prepareTrialFolder({ home, provider: "codex" });
  const providers = await loadDevelopmentPrivateCaseProviders(prepared.credentialsPath);
  t.after(() => providers.close());
  const cases = (await readRunnerClients(home)).clients.map((client) => client.case_id);
  const copier = (caseId) => createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: allowAll([caseId], ["archive", "organize_search", "session_use"]), keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  return { home, prepared, providers, cases, copier };
}

const searchIds = async (service, auth, caseId, corpusId, query) => service.withJournalCorpus(caseId, corpusId, { requiredScope: "case:read", requiredPurpose: "session_use" }, async ({ corpusStore, cursorSecret, reference }) => {
  const reader = await openPrivateJournalGraph({ corpusStore, cursorSecret, caseId, corpusId, generation: reference.active_generation, manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch, purpose: "session_use" });
  try { return (await reader.search({ query, pageSize: 50, sort: "source_order" })).records.map((record) => record.id); } finally { reader.close(); }
}, auth);

const storedManifest = async (service, auth, caseId, corpusId) => service.withJournalCorpus(caseId, corpusId, { requiredScope: "case:read", requiredPurpose: "session_use" }, async ({ corpusStore, reference }) => {
  const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
  const index = async (name) => {
    const entries = [];
    for (const descriptor of manifest.indexes[name] ?? []) entries.push(...(await corpusStore.readJsonObject({ objectId: descriptor.object_id })).entries);
    return entries;
  };
  return { manifest, synthetic_extra: await index("synthetic_extra") };
}, auth);

test("a client's journal is exported sealed for one key, imported into the client's runner case, checked quote by quote and record by record, and read there under the client's own grant", async (t) => {
  const server = await serverJournal(t);
  const trial = await trialWith(t, 1, { consent: true });
  const [clientCase] = trial.cases;
  const keyPair = createJournalCopyKeyPair();
  const sealed = await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: keyPair.publicKey });
  for (const line of server.sources.repr.split("\n").filter((entry) => entry.length > 8)) assert.equal(JSON.stringify(sealed).includes(line), false, "the sealed copy shows nothing of the journal");
  assert.throws(() => openJournalCopy(sealed, createJournalCopyKeyPair()), { code: "JOURNAL_COPY_OTHER_RECIPIENT" });
  assert.throws(() => openJournalCopy({ ...sealed, tag: Buffer.from(sealed.tag, "base64").subarray(0, 8).toString("base64") }, keyPair), { code: "JOURNAL_COPY_UNREADABLE" });
  const bundle = openJournalCopy(sealed, keyPair);
  const tampered = structuredClone(bundle);
  tampered.source_representations.repr = tampered.source_representations.repr.replace("help", "hope");
  assert.throws(() => openJournalCopy(sealJournalCopy(tampered, keyPair.publicKey), keyPair), { code: "JOURNAL_COPY_DIGEST_MISMATCH" });
  // Only a grant with the vault's export purpose exports: every other purpose together is refused, that one alone is enough.
  const exportWith = (purposes) => exportJournalCopy({ caseAccessService: server.withPurposes(purposes), caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: keyPair.publicKey });
  await assert.rejects(exportWith(allPurposes.filter((purpose) => purpose !== "export")), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  assert.equal((await exportWith(["export"])).kind, "runner_journal_copy_sealed");

  const corpusId = journalCopyCorpusId(bundle);
  const result = await importJournalCopy({ caseAccessService: trial.copier(clientCase), caseId: clientCase, corpusId, authContext: { bearerToken: "synthetic-copy-step" }, bundle });
  assert.ok(result.passages_verified >= 3);
  assert.equal(result.records_verified, bundle.graph.nodes.length + bundle.graph.edges.length);
  // The same copy again is checked again, not written twice.
  assert.deepEqual(await importJournalCopy({ caseAccessService: trial.copier(clientCase), caseId: clientCase, corpusId, authContext: { bearerToken: "synthetic-copy-step" }, bundle }), result);

  const service = createPrivateCaseAccessService({ rootDir: trial.providers.rootDir, authorizationProvider: trial.providers.authorizationProvider, keyProvider: trial.providers.keyProvider, allowDevelopmentFileProvider: true });
  const list = await readRunnerClients(trial.home);
  list.clients[0].journal.corpus_id = corpusId;
  await writeRunnerClients(trial.home, list);
  const folder = clientJournalFolder(trial.home, clientCase);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, COLD_TEST_RECEIPT_FILE), JSON.stringify({ schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: clientCase, corpus_id: corpusId,
    generation: result.generation, manifest_object_id: result.manifest_object_id, visibility_epoch: result.visibility_epoch, tested_at: "2026-11-24T08:00:00.000Z" }), { mode: 0o600 });
  const gate = createRunnerJournalGate({ trialDir: trial.home, caseAccessService: service });
  const part = await gate.freezeResponseEvidenceJournal({ caseId: clientCase, query: "help", authContext: { bearerToken: trial.prepared.clientTokens[clientCase] } });
  assert.equal(part.availability, "available");
  assert.ok(part.source_items.length >= 1 && part.source_items.every((item) => server.sources.repr.includes(item.exact_excerpt) && item.locator.corpus_id === corpusId));
});

test("the copy keeps the server's source order and its builder's own indexes, checks more than 200 quotations, and permits no archive", async (t) => {
  // Two pages whose sources are listed in the opposite order of their ids, 210 passages in all.
  const journal = generatedJournal([
    { sourceId: "source:b", representationId: "repr-1", lines: Array.from({ length: 110 }, (_, index) => `First page line ${index} about the garden.`) },
    { sourceId: "source:a", representationId: "repr-2", lines: Array.from({ length: 100 }, (_, index) => `Second page line ${index} about the garden.`) }
  ]);
  const extra = new Map([["repr-1-p000", [{ synthetic: "first" }]], ["repr-2-p000", [{ synthetic: "second" }, { synthetic: "more" }]]]);
  const server = await serverJournal(t, { journal, extraIndexes: { synthetic_extra: extra }, indexRepresentations: true });
  const trial = await trialWith(t);
  const [clientCase] = trial.cases;
  const keyPair = createJournalCopyKeyPair();
  const bundle = openJournalCopy(await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: keyPair.publicKey }), keyPair);
  const corpusId = journalCopyCorpusId(bundle);
  const result = await importJournalCopy({ caseAccessService: trial.copier(clientCase), caseId: clientCase, corpusId, authContext: { bearerToken: "synthetic-copy-step" }, bundle });
  assert.equal(result.passages_verified, 210);
  const copier = trial.copier(clientCase);
  const serverOrder = await searchIds(server.service, server.auth, SERVER_CASE, SERVER_CORPUS, "garden");
  assert.equal(serverOrder[0], "repr-1-p000");
  assert.deepEqual(await searchIds(copier, { bearerToken: "synthetic-copy-step" }, clientCase, corpusId, "garden"), serverOrder);
  const copied = await storedManifest(copier, { bearerToken: "synthetic-copy-step" }, clientCase, corpusId);
  assert.deepEqual(copied.synthetic_extra, [...extra]);
  assert.ok(Array.isArray(copied.manifest.indexes.representation_objects));
  assert.deepEqual(copied.manifest.permitted_uses, ["organize_search", "session_use"]);
  assert.deepEqual(copied.manifest.archive_references, []);
});

test("the whole copy is checked before the client's case is touched and the stored records after, and an export of another snapshot than the published one is refused", async (t) => {
  const server = await serverJournal(t);
  const trial = await trialWith(t);
  const [clientCase] = trial.cases;
  const copier = trial.copier(clientCase);
  const authContext = { bearerToken: "synthetic-copy-step" };
  const access = { requiredScope: "case:read", requiredPurpose: "session_use" };
  const keyPair = createJournalCopyKeyPair();
  const exported = async (exportedAt, from = server) => openJournalCopy(await exportJournalCopy({ caseAccessService: from.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS,
    authContext: server.auth, recipientPublicKey: keyPair.publicKey, exportedAt }), keyPair);
  const importing = (bundle, caseAccessService = copier) => importJournalCopy({ caseAccessService, caseId: clientCase, corpusId: journalCopyCorpusId(bundle), authContext, bundle });
  const bundle = await exported("2026-11-24T08:00:00.000Z");
  // A graph that doesn't hold, and an index the store refuses, in bundles whose digest is right: refused with nothing written.
  for (const [change, code] of [
    [(copy) => { copy.graph.nodes.find((node) => node.kind === "passage").data.quote_sha256 = "0".repeat(64); }, "SPAN_INTEGRITY_FAILED"],
    [(copy) => { copy.extra_indexes = { lexical: [["word", ["p1"]]] }; }, "GRAPH_EXTRA_INDEX_INVALID"]
  ]) {
    const bad = structuredClone(bundle);
    change(bad);
    bad.content_sha256 = sha256(JSON.stringify({ graph: bad.graph, source_representations: bad.source_representations, extra_indexes: bad.extra_indexes, index_representations: bad.index_representations }));
    await assert.rejects(importing(bad), { code });
    await assert.rejects(copier.inspectJournalCorpus(clientCase, journalCopyCorpusId(bad), access, authContext), { code: "PRIVATE_CASE_NOT_FOUND" }, "the client's case has no record yet");
  }
  // A record larger than the copy's usual shards, as a server's larger ones hold it.
  const large = await serverJournal(t, { shardTargetBytes: 1024 * 1024,
    journal: generatedJournal([{ sourceId: "source:a", representationId: "repr-1", lines: ["One line about the garden.", `${"garden ".repeat(10_000)}end.`] }]) });
  assert.equal((await importing(await exported("2026-11-24T08:01:00.000Z", large))).passages_verified, 2);
  // A store that gives back a record other than the export's is refused: the stored records are read back and compared.
  const changedStore = { ...copier, withJournalCorpus: (caseId, corpusId, asked, operation, auth) => copier.withJournalCorpus(caseId, corpusId, asked,
    (context) => operation({ ...context, corpusStore: { ...context.corpusStore, async readJsonObject(input) {
      const value = await context.corpusStore.readJsonObject(input);
      for (const record of value.records ?? []) if (record.kind === "entity") record.data.label = "Another label";
      return value;
    } } }), auth) };
  await assert.rejects(importing(bundle, changedStore), { code: "JOURNAL_COPY_RECORDS_MISMATCH" });
  // A copy an earlier import left unpublished is refused.
  const unfinished = await exported("2026-11-24T08:02:00.000Z");
  await copier.createJournalCorpus(clientCase, { corpusId: journalCopyCorpusId(unfinished), manifestObjectId: "manifest:staging" }, authContext);
  await assert.rejects(importing(unfinished), { code: "JOURNAL_COPY_PARTLY_IMPORTED" });
  // A published reference that names another generation than its manifest's: the reader's own check refuses the export.
  await server.service.publishJournalGeneration(SERVER_CASE, { corpusId: SERVER_CORPUS, generation: "another-generation", manifestObjectId: server.manifestObjectId, expectedGeneration: server.graph.generation }, server.auth);
  await assert.rejects(exported("2026-11-24T08:03:00.000Z"), { code: "GRAPH_SNAPSHOT_MISMATCH" });
});

// ---- The cold test ------------------------------------------------------------------------------------------------------------

// A scripted stand-in for the fresh consumer: it sees only the packet (the frozen question and what the session-use reader
// retrieved). It answers "supported" citing the passages it retrieved, or "not found" when it retrieved none, except for the
// questions `script` answers otherwise (a model judges a false premise itself). `miss` makes it answer every question as not
// found; `overclaim` makes it ignore the script; `citeFirst` makes it cite only the first passage it retrieved; `invent` makes it cite
// a passage it wasn't given.
const consumer = ({ miss = false, overclaim = false, citeFirst = false, invent = false, script = { "q-premise": "false_premise" } } = {}) => ({
  async invoke({ packet }) {
    const passages = (packet.retrieved_evidence?.records ?? []).filter((record) => record.kind === "passage").map((record) => record.id);
    const scripted = overclaim ? undefined : script[packet.frozen_question.id];
    const answerability = miss ? "not_found" : scripted ?? (passages.length ? "supported" : "not_found");
    const output = { schema_version: "1.0", question_id: packet.frozen_question.id, answer: "A synthetic answer.",
      answerability, evidence_ids: invent ? ["passage-never-given"] : answerability === "not_found" ? [] : citeFirst ? passages.slice(0, 1) : passages,
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
  // A consumer that misses what the journal holds, claims support for a false premise, or cites the evidence for one key quote
  // only, doesn't pass: no receipt.
  for (const [failing, wrong] of [[consumer({ miss: true }), "q-colleague"], [consumer({ overclaim: true }), "q-premise"], [consumer({ citeFirst: true }), "q-colleague"]]) {
    const failed = await run(failing);
    assert.equal(failed.passed, false);
    assert.equal(failed.receipt, null);
    assert.deepEqual(failed.report.by_question.filter((entry) => !entry.graph.right).map((entry) => entry.id), [wrong]);
  }
  // An answer outside the answer's rules (a passage it wasn't given) is a test not passed, never one that stopped on an error.
  const broken = await run(consumer({ invent: true }));
  assert.deepEqual(broken, { passed: false, report: { generation: reference.active_generation, questions: 3, broken_answer: "COLD_ANSWER_UNRETRIEVED_EVIDENCE", passed: false }, receipt: null });
  await assert.rejects(run(consumer(), withQuestions(QUESTIONS.questions.slice(0, 1))), { code: "COLD_QUESTIONS_NEED_BOTH_KINDS" });
  // A key quote must name its evidence: found in no passage, or in more than three, it stops the test, naming the question only.
  await assert.rejects(run(consumer(), withQuestions([{ ...QUESTIONS.questions[0], evidence_quotes: ["a sentence the journal never had"] }, QUESTIONS.questions[1]])),
    (error) => error.code === "COLD_KEY_QUOTE_NOT_IN_JOURNAL" && error.details?.question_id === "q-colleague");
  await assert.rejects(run(consumer(), withQuestions([{ ...QUESTIONS.questions[0], evidence_quotes: ["I"] }, QUESTIONS.questions[1]])),
    (error) => error.code === "COLD_KEY_QUOTE_NOT_SPECIFIC" && error.details?.question_id === "q-colleague");
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
  const loader = () => ({ rootDir: server.rootDir, authorizationProvider: allowAll([SERVER_CASE]), keyProvider: server.keyProvider, close() {} });
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

test("the laptop commands: each client's key, an import that leaves a wrong file as it was, and a cold test whose latest result decides the gate", async (t) => {
  const server = await serverJournal(t);
  const trial = await trialWith(t, 2);
  const { home } = trial;
  const [clientOne, clientTwo] = trial.cases;
  assert.deepEqual(parseJournalArguments(["--cold-test", path.join(home, "q.json"), "--provider", "claude"]), { command: "cold-test", file: path.join(home, "q.json"), provider: "claude", dir: null });
  assert.throws(() => parseJournalArguments(["--import", path.join(home, "f"), "--provider", "claude"]), /--provider goes with --cold-test only/u);
  assert.throws(() => parseJournalArguments(["--import"]), /--import needs its file/u);
  // The import's grant: that one case, its own token, and the three purposes the store asks.
  const grant = oneTimeGrant(clientOne, { scopes: ["case:read", "case:write"], purposes: IMPORT_PURPOSES });
  const authorize = (caseId, authContext, requiredScope) => grant.authorizationProvider.authorize({ caseId, authContext, requiredScope });
  assert.deepEqual((await authorize(clientOne, grant.authContext, "case:write")).purposes, ["archive", "organize_search", "session_use"]);
  for (const refused of [authorize(clientTwo, grant.authContext, "case:write"), authorize(clientOne, { bearerToken: "another" }, "case:write"), authorize(clientOne, grant.authContext, "case:audit")]) {
    assert.deepEqual(await refused, { allowed: false, principalId: "runner-trial-journal-step", scopes: [], purposes: [] });
  }

  // Each client's key: made once, its private half mode 0600 in their own folder. Without one, or with one others can read, nothing
  // is imported.
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: path.join(os.tmpdir(), "no-such-copy.json") }), /Client 1 has no key for journal copies yet/u);
  const keyOne = await ensureJournalCopyKey({ home, number: 1 });
  assert.equal(keyOne.made, true);
  assert.equal(await modeOf(path.join(clientJournalFolder(home, clientOne), CLIENT_COPY_KEY_FILE)), 0o600);
  assert.deepEqual(await ensureJournalCopyKey({ home, number: 1 }), { publicKey: keyOne.publicKey, made: false });
  const keyTwo = await ensureJournalCopyKey({ home, number: 2 });
  assert.notEqual(keyTwo.publicKey, keyOne.publicKey);
  const keyTwoPath = path.join(clientJournalFolder(home, clientTwo), CLIENT_COPY_KEY_FILE);
  await fs.chmod(keyTwoPath, 0o644);
  await assert.rejects(ensureJournalCopyKey({ home, number: 2 }), /must be readable by you alone \(mode 0600\); it was left as it is/u);
  await fs.chmod(keyTwoPath, 0o600);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-transfer-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const exportFor = async (publicKey, name, exportedAt) => {
    const file = path.join(outside, name);
    await writeSealedJournalCopy(file, await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, authContext: server.auth, recipientPublicKey: publicKey, exportedAt }));
    return file;
  };
  const sealedOne = await exportFor(keyOne.publicKey, "one.sealed.json", "2026-11-24T08:00:00.000Z");
  const sealedOneText = await fs.readFile(sealedOne, "utf8");
  const questionsPath = path.join(outside, "questions.json");
  await fs.writeFile(questionsPath, JSON.stringify(QUESTIONS), { mode: 0o600 });
  // Typed the wrong client: refused, the file left where it was.
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: sealedOne }), /sealed for another key/u);
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText);
  // A file that isn't a sealed copy, a link to one, a file that isn't there: refused, and left as they were.
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: questionsPath }), /isn't a sealed journal copy that client 1's key opens \(JOURNAL_COPY_INVALID\)/u);
  assert.equal(await fs.readFile(questionsPath, "utf8"), JSON.stringify(QUESTIONS));
  const link = path.join(outside, "link.json");
  await fs.symlink(sealedOne, link);
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: link }), /must be a file, not a link or a folder/u);
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: path.join(outside, "missing.json") }), /isn't there/u);
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText);
  // A file inside the trial folder is never taken.
  const credentials = path.join(home, "credentials.json");
  const credentialsBefore = await fs.readFile(credentials, "utf8");
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: credentials }), /outside the trial folder/u);
  assert.equal(await fs.readFile(credentials, "utf8"), credentialsBefore);
  // While the trial holds the vault: refused, nothing changed.
  const running = await acquirePrivateRootWriterLock({ rootDir: trial.providers.rootDir });
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: sealedOne }), /The trial is running/u);
  await running.release();
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText);
  const imported = await importClientJournal({ home, number: 1, sealedPath: sealedOne });
  assert.ok(imported.passages_verified >= 3);
  await absent(sealedOne, "removed once the copy is published");
  let clients = (await readRunnerClients(home)).clients;
  assert.equal(clients[0].journal.corpus_id, imported.corpus_id);
  assert.match(clients[0].journal.source_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(clients[1].journal.corpus_id, null);
  await assert.rejects(writeRunnerClients(home, { schema_version: 1, clients: [{ ...clients[0], journal: { ...clients[0].journal, source_sha256: "not a digest" } }] }), { code: "RUNNER_CLIENTS_INVALID" });
  // The same journal for the second client: refused.
  const sealedForTwo = await exportFor(keyTwo.publicKey, "two.sealed.json", "2026-11-24T08:01:00.000Z");
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: sealedForTwo }), /already copied for client 1/u);
  assert.equal(JSON.parse(await fs.readFile(sealedForTwo, "utf8")).kind, "runner_journal_copy_sealed");

  // The cold test: refused without consent; with it, the latest test that ends decides the receipt.
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: consumer() }), /no confirmed journal consent/u);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  const receiptPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_RECEIPT_FILE);
  assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer({ miss: true }) })).passed, false);
  await absent(receiptPath);
  for (const failing of [consumer({ overclaim: true }), consumer({ invent: true })]) {
    assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer() })).passed, true);
    assert.equal(await modeOf(receiptPath), 0o600);
    assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: failing })).passed, false);
    await absent(receiptPath, "a failed re-test removes the copy's receipt");
  }
  // A consent withdrawn during the test: no receipt, though every answer was right.
  const withdrawing = { async invoke(input) {
    await setJournalConsent({ home, number: 1, action: "withdraw" });
    return consumer().invoke(input);
  } };
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: withdrawing }), /consent or copy changed during the cold test; no receipt was recorded/u);
  await absent(receiptPath);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  // A pass, which neither a test stopped by an error nor the same sealed file imported again takes away: the copy is the same.
  assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer() })).passed, true);
  const receiptText = await fs.readFile(receiptPath, "utf8");
  const stopping = { async invoke() { throw Object.assign(new Error("synthetic"), { code: "PLAN_LIMIT" }); } };
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: stopping }), { code: "PLAN_LIMIT" });
  await fs.writeFile(sealedOne, sealedOneText, { mode: 0o600 });
  assert.deepEqual(await importClientJournal({ home, number: 1, sealedPath: sealedOne }), imported);
  await absent(sealedOne);
  assert.equal(await fs.readFile(receiptPath, "utf8"), receiptText);
  await fs.chmod(questionsPath, 0o644);
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: consumer() }), /readable by you alone/u);

  // The gate, under the client's own grant from a start: open with the receipt; a new copy closes it until its own test passes.
  const started = await prepareTrialFolder({ home, provider: "codex" });
  const startedProviders = await loadDevelopmentPrivateCaseProviders(started.credentialsPath);
  t.after(() => startedProviders.close());
  const gate = createRunnerJournalGate({ trialDir: home, caseAccessService: createPrivateCaseAccessService({ rootDir: startedProviders.rootDir,
    authorizationProvider: startedProviders.authorizationProvider, keyProvider: startedProviders.keyProvider, allowDevelopmentFileProvider: true }) });
  const read = () => gate.freezeResponseEvidenceJournal({ caseId: clientOne, query: "colleague", authContext: { bearerToken: started.clientTokens[clientOne] } });
  const part = await read();
  assert.equal(part.availability, "available");
  assert.ok(part.source_items.every((item) => item.locator.corpus_id === imported.corpus_id && server.sources.repr.includes(item.exact_excerpt)));
  const again = await importClientJournal({ home, number: 1, sealedPath: await exportFor(keyOne.publicKey, "one-again.sealed.json", "2026-11-24T08:02:00.000Z") });
  assert.notEqual(again.corpus_id, imported.corpus_id);
  await absent(receiptPath);
  assert.notEqual((await read()).availability, "available");
  clients = (await readRunnerClients(home)).clients;
  assert.equal(clients[0].journal.corpus_id, again.corpus_id);
  assert.equal(clientTwo, clients[1].case_id);
});
