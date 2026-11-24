import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { ProviderError } from "../src/core/errors.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES, PrivateCaseAccessDeniedError } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";
import { buildQuoteTermsFromGraph } from "../src/journal-import/quote-terms.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { SESSION_USE_READER_VERSION } from "../src/journal-import/response-evidence-journal.mjs";
import { createJournalCopyKeyPair, exportJournalCopy, importJournalCopy, journalCopyCorpusId, openJournalCopy, sealJournalCopy, writeSealedJournalCopy } from "../src/journal-import/journal-copy.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { COLD_TEST_ATTEMPT_FILE, COLD_TEST_RECEIPT_FILE, RUNNER_CLIENTS_FILE, clientJournalFolder, readColdTestAttempt, readColdTestReceipt, readRunnerClients, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { acquireTrialFolderLock as acquireFolderLock, withTrialFolderLock as withFolderLock } from "../src/runner-trial/folder-lock.mjs";
import { COLD_TEST_RULE } from "../src/runner-trial/cold-test-rule.mjs";
import { createSealedColdTestPort, runJournalColdTest } from "../src/runner-trial/journal-cold-test.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { StartError, acquireTrialFolderLock, addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";
import { CLIENT_COPY_KEY_FILE, IMPORT_PURPOSES, USAGE, ensureJournalCopyKey, importClientJournal, oneTimeGrant, parseJournalArguments, runClientColdTest, runMain } from "../scripts/runner-trial-journal.mjs";
import { ANSWER, JUDGE_REASON, PLANTED, RECEIPTS, coldWorkers, plantOn, questionsFile } from "./helpers/cold-workers.mjs";
import { makeNamedPipe, printedApart } from "./helpers/named-pipe.mjs";

// The copy step for a client's journal (design for clients, point 4) and the command of its cold test (point 5c): exported where the journal
// lives, sealed for one client's key alone, imported into that client's runner case and checked; then tested, under the folder's lock and the
// client's consent (what the test itself asks, scores and passes by is in tests/runner-cold-test.test.mjs). The "server" here is a synthetic
// local vault with the journal import's synthetic fixture or a generated synthetic journal, and every worker is a stand-in: no server is
// contacted, no model is called and no real journal is read.

// A case id of the runner form, since the cold test below runs on it as on a client's runner case, and another person's.
const SERVER_CASE = "case-12121212-1212-4121-8121-121212121212", SERVER_CORPUS = "synthetic-server-corpus";
const OTHER_SERVER_CASE = "case-34343434-3434-4343-8343-343434343434";
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
const temporaryFolder = async (t, name) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `inner-signal-copy-${name}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};
// Every file under a folder with a digest of its bytes, to show that nothing changed.
async function tree(dir) {
  const found = {};
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found[path.relative(dir, path.join(entry.parentPath, entry.name))] = createHash("sha256").update(await fs.readFile(path.join(entry.parentPath, entry.name))).digest("hex");
  }
  return found;
}

// A synthetic journal of plain-text pages, one passage per line (a line may be `{ text, lifecycle }`), then any `filler` with no passage,
// the pages' sources listed in the order given.
function generatedJournal(pages, corpusId = SERVER_CORPUS, caseId = SERVER_CASE) {
  const base = { case_id: caseId, corpus_id: corpusId, version: 1, lifecycle: "active" };
  const nodes = [], representations = {};
  const lines = (page) => page.lines.map((line) => (typeof line === "string" ? { text: line, lifecycle: "active" } : line));
  for (const page of pages) {
    const text = `${lines(page).map((line) => `${line.text}\n`).join("")}${page.filler ?? ""}`;
    representations[page.representationId] = text;
    nodes.push({ ...base, id: page.sourceId, kind: "source", data: { representation_id: page.representationId, original_object_id: "original", media_type: "text/plain", byte_length: Buffer.byteLength(text), parse_status: "readable" } });
  }
  for (const page of pages) {
    let offset = 0;
    lines(page).forEach((line, index) => {
      const quote = `${line.text}\n`;
      nodes.push({ ...base, lifecycle: line.lifecycle, id: `${page.representationId}-p${String(index).padStart(3, "0")}`, kind: "passage", data: { representation_id: page.representationId, unit_id: `u-${page.representationId}`,
        start_byte: offset, end_byte: offset + Buffer.byteLength(quote), quote, quote_sha256: sha256(quote),
        locator: { kind: "native_text", page: null, bbox: null, original_object_id: "original", interpretation_status: "native" } } });
      offset += Buffer.byteLength(quote);
    });
  }
  return { graph: { schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation: "generation-synthetic", nodes, edges: [] }, sources: representations };
}

async function serverJournal(t, { journal = null, extraIndexes = {}, indexRepresentations = false, shardTargetBytes = 4096, caseId = SERVER_CASE } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-copy-server-"));
  const keys = { routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62) };
  const store = createEncryptedPrivateCaseStore({ rootDir, ...keys, developmentExternalCredentialAuthorized: true });
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const keyProvider = { async getCaseKeyMaterial() {
    return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true };
  } };
  const service = createPrivateCaseAccessService({ rootDir, authorizationProvider: allowAll([caseId]), keyProvider });
  const auth = { bearerToken: "synthetic-operator" };
  const { graph, sources } = journal ?? {
    graph: JSON.parse(JSON.stringify(await fixture("synthetic-graph.json")).replaceAll('"synthetic-case"', JSON.stringify(caseId)).replaceAll('"synthetic-corpus"', JSON.stringify(SERVER_CORPUS))),
    sources: await fixture("synthetic-sources.json")
  };
  await service.appendTranscriptTurn(caseId, { id: "turn:1", exchange_id: "exchange:1", role: "user", text: "A synthetic message.", at: "2026-11-24T08:00:00.000Z", episode_id: null }, auth);
  await service.createJournalCorpus(caseId, { corpusId: SERVER_CORPUS, manifestObjectId: "manifest:staging" }, auth);
  let persisted;
  await service.withJournalCorpus(caseId, SERVER_CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes, extraIndexes, indexRepresentations });
  }, auth);
  await service.publishJournalGeneration(caseId, { corpusId: SERVER_CORPUS, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, auth);
  // The same vault, as an operator whose grant holds only the given purposes opens it.
  const withPurposes = (purposes) => createPrivateCaseAccessService({ rootDir, authorizationProvider: allowAll([caseId], purposes), keyProvider });
  const exportFor = (recipientPublicKey, exportedAt = "2026-11-24T08:00:00.000Z", corpusId = SERVER_CORPUS) => exportJournalCopy({ caseAccessService: service, caseId, corpusId, authContext: auth, recipientPublicKey, exportedAt });
  return { service, withPurposes, auth, graph, sources, rootDir, keyProvider, exportFor, manifestObjectId: persisted.manifest_object_id };
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
  await fs.writeFile(path.join(folder, COLD_TEST_RECEIPT_FILE), JSON.stringify({ schema_version: 2, kind: "journal_cold_test", result: "pass", case_id: clientCase, corpus_id: corpusId,
    generation: result.generation, manifest_object_id: result.manifest_object_id, visibility_epoch: result.visibility_epoch, tested_at: "2026-11-24T08:00:00.000Z",
    reader_version: SESSION_USE_READER_VERSION, rule: COLD_TEST_RULE.version, questions: { answerable: 40, unanswerable: 20, planted: 20 }, author: "person", consumer: RECEIPTS.W, judge: RECEIPTS.CW, run: 1 }), { mode: 0o600 });
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

test("a generation with revoked and deleted passages is copied whole: they are stored as the export has them, and never resolved as evidence", async (t) => {
  // The second page holds only passages that may no longer be used.
  const journal = generatedJournal([
    { sourceId: "source:a", representationId: "repr-1", lines: ["One line about the garden.", { text: "A line the writer took back.", lifecycle: "revoked" }, "Another line about the garden."] },
    { sourceId: "source:b", representationId: "repr-2", lines: [{ text: "A deleted line about the garden.", lifecycle: "deleted" }, { text: "One more line taken back.", lifecycle: "revoked" }] }
  ]);
  const server = await serverJournal(t, { journal });
  const trial = await trialWith(t);
  const [clientCase] = trial.cases;
  const copier = trial.copier(clientCase);
  const authContext = { bearerToken: "synthetic-copy-step" };
  const keyPair = createJournalCopyKeyPair();
  const bundle = openJournalCopy(await server.exportFor(keyPair.publicKey), keyPair);
  const corpusId = journalCopyCorpusId(bundle);
  const importing = (caseAccessService) => importJournalCopy({ caseAccessService, caseId: clientCase, corpusId, authContext, bundle });
  const result = await importing(copier);
  assert.deepEqual([result.passages_verified, result.records_verified], [2, 7], "two usable quotations; every record compared, the unusable ones too");
  // Again, checked again: each record as the export has it, under the client's case and the copy's corpus.
  assert.deepEqual(await importing(copier), result);
  const rebound = (record) => JSON.stringify({ ...record, case_id: clientCase, corpus_id: corpusId });
  const stored = await copier.withJournalCorpus(clientCase, corpusId, { requiredScope: "case:read", requiredPurpose: "session_use" }, async ({ corpusStore, reference }) => {
    const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
    const records = [];
    for (const shard of manifest.record_shards) records.push(...(await corpusStore.readJsonObject({ objectId: shard.object_id })).records);
    return records;
  }, authContext);
  for (const node of server.graph.nodes) assert.equal(JSON.stringify(stored.find((record) => record.id === node.id)), rebound(node), node.id);
  // A store that gives back a changed record or source text of a page whose passages may not be used is refused, as for the others.
  const changed = (change) => ({ ...copier, withJournalCorpus: (caseId, corpus, asked, operation, auth) => copier.withJournalCorpus(caseId, corpus, asked,
    (context) => operation({ ...context, corpusStore: { ...context.corpusStore, async readJsonObject(input) {
      const value = await context.corpusStore.readJsonObject(input);
      change(value);
      return value;
    } } }), auth) });
  await assert.rejects(importing(changed((value) => { for (const record of value.records ?? []) if (record.id === "repr-2-p001") record.lifecycle = "active"; })), { code: "JOURNAL_COPY_RECORDS_MISMATCH" });
  await assert.rejects(importing(changed((value) => { if (value.representation_id === "repr-2") value.text = value.text.replace("deleted", "removed"); })), { code: "JOURNAL_COPY_SOURCE_MISMATCH" });
  // The session-use reader finds the usable ones only, and the cold test's key can't rest on the others.
  assert.deepEqual(await searchIds(copier, authContext, clientCase, corpusId, "line"), ["repr-1-p000", "repr-1-p002"]);
  const asking = (quote) => runJournalColdTest({ service: copier, auth: authContext, caseId: clientCase, corpusId, port: createSealedColdTestPort({ consumer: standIns().workerFor("W"), judge: standIns().workerFor("CW") }),
    questions: questionsFile([{ id: "q-garden", question: "What about the garden?", answerable: true, evidence_quotes: ["One line about the garden.", quote] }, { id: "q-absent", question: "And the zebra?", answerable: false }]) });
  assert.deepEqual((await asking("Another line about the garden.")).report.by_question.map(({ found, result: scored }) => [found, scored]), [[true, "right"], [null, "right"]]);
  for (const unusable of ["A line the writer took back.", "A deleted line about the garden."]) {
    await assert.rejects(asking(unusable), (error) => error.code === "COLD_KEY_QUOTE_NOT_IN_JOURNAL" && error.details?.question_number === 1);
  }
});

test("a source text larger than one stored object is copied in chunks and checked whole", async (t) => {
  // Just over 4 MiB, one stored object's limit, all but two lines of it words no passage quotes.
  const journal = generatedJournal([{ sourceId: "source:a", representationId: "repr-1", lines: ["One line about the garden.", "Another line about the garden."], filler: "synthetic words ".repeat(270_000) }]);
  assert.ok(Buffer.byteLength(journal.sources["repr-1"]) > 4 * 1024 * 1024);
  const server = await serverJournal(t, { journal, indexRepresentations: true });
  const trial = await trialWith(t);
  const [clientCase] = trial.cases;
  const copier = trial.copier(clientCase);
  const authContext = { bearerToken: "synthetic-copy-step" };
  const keyPair = createJournalCopyKeyPair();
  const bundle = openJournalCopy(await server.exportFor(keyPair.publicKey), keyPair);
  assert.equal(bundle.source_representations["repr-1"] === journal.sources["repr-1"], true);
  const corpusId = journalCopyCorpusId(bundle);
  assert.equal((await importJournalCopy({ caseAccessService: copier, caseId: clientCase, corpusId, authContext, bundle })).passages_verified, 2);
  const { manifest } = await storedManifest(copier, authContext, clientCase, corpusId);
  assert.ok(manifest.source_representation_objects["repr-1"].chunks.length >= 2, "stored in chunks");
});

test("a quote generation, as the journal import builds and publishes it, finds the same quotes with the same dates in the copy", async (t) => {
  const pages = [
    "Some undated opening words about the garden.\n\nMarch 3, 2019\n\nI dreamt that the garden gate was open. It was only a dream.\n\nToday I didn't go to work. Maybe tomorrow.\n",
    "The bakery on Elm street smelled of cardamom.\n\nApril 10, 2019\n\nI asked about the garden again. Une promenade au jardin — très belle. 🌿\n"
  ].map((text, index) => ({ representation_id: `synthetic:page:${index}`, text, page_number: index + 1, parse_status: "readable" }));
  const built = buildQuoteGeneration({ caseId: SERVER_CASE, corpusId: SERVER_CORPUS, generation: "quotes-synthetic", originalObjectId: "original:synthetic", mediaType: "application/pdf", representations: pages, version: 4 });
  const server = await serverJournal(t, {
    journal: { graph: built.graph, sources: Object.fromEntries(pages.map((page) => [page.representation_id, page.text])) },
    extraIndexes: { quote_meta: built.quoteMeta, quote_months: built.quoteMonths, quote_terms: buildQuoteTermsFromGraph(built.graph) }, indexRepresentations: true
  });
  const trial = await trialWith(t);
  const [clientCase] = trial.cases;
  const copier = trial.copier(clientCase);
  const authContext = { bearerToken: "synthetic-copy-step" };
  const keyPair = createJournalCopyKeyPair();
  const bundle = openJournalCopy(await server.exportFor(keyPair.publicKey), keyPair);
  assert.deepEqual(Object.keys(bundle.extra_indexes).sort(), ["quote_meta", "quote_months", "quote_terms"]);
  const corpusId = journalCopyCorpusId(bundle);
  const result = await importJournalCopy({ caseAccessService: copier, caseId: clientCase, corpusId, authContext, bundle });
  assert.equal(result.passages_verified, built.stats.quotes);
  const found = (service, auth, caseId, corpus, search) => service.withJournalCorpus(caseId, corpus, { requiredScope: "case:read", requiredPurpose: "session_use" }, async ({ corpusStore, cursorSecret, reference }) => {
    const reader = await openPrivateJournalGraph({ corpusStore, cursorSecret, caseId, corpusId: corpus, generation: reference.active_generation, manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch, purpose: "session_use" });
    try { return (await reader.findQuotes(search)).quotes; } finally { reader.close(); }
  }, auth);
  for (const search of [{ query: "garden" }, { query: "jardin" }, { query: "garden", from: "2019-04", to: "2019-05", includeUndated: false }]) {
    const quotes = await found(server.service, server.auth, SERVER_CASE, SERVER_CORPUS, search);
    assert.ok(quotes.length >= 1, JSON.stringify(search));
    assert.deepEqual(await found(copier, authContext, clientCase, corpusId, search), quotes, JSON.stringify(search));
  }
});

// ---- The cold test's stand-ins and questions -----------------------------------------------------------------------------------

// A generated journal of twenty lines, each about a thing of its own, and questions on it, as many as the rule asks for: forty it answers (two
// a line, with the key naming its evidence by exact words of the journal), the first twenty with a planted wrong answer; twenty that take a
// false premise about a line, so that the search returns it; and one about an absent thing. One test makes 162 calls when the judge finds
// nothing wrong but the planted answers: the consumer's and the judge's for each question in turn, and two more of the judge's for a planted
// answer, so the first twenty questions' are the calls 4n - 3 to 4n.
const THINGS = Object.freeze("abacus anvil bassoon beehive bellows birdcage bobbin brazier cello chisel cogwheel crowbar dulcimer easel gargoyle goblet hammock hourglass jigsaw kiln".split(" "));
const coldJournal = (caseId = SERVER_CASE) => generatedJournal([{ sourceId: "source:repr", representationId: "repr", lines: THINGS.map((thing) => `That day I asked a colleague for help with the ${thing}.`) }], SERVER_CORPUS, caseId);
const coldServer = (t, options = {}) => serverJournal(t, { journal: coldJournal(options.caseId), ...options });
const PREMISE = "refuse to help";
const QUESTIONS = Object.freeze(questionsFile([
  ...Array.from({ length: 40 }, (_, place) => ({ id: `q-colleague-${place}`, question: `Synthetic question ${place}: what did I do about my colleague and the ${THINGS[place % 20]}?`, answerable: true,
    evidence_quotes: [`help with  the\n${THINGS[place % 20]}`], ...(place < 20 ? { planted: plantOn(place) } : {}) })),
  ...Array.from({ length: 20 }, (_, place) => ({ id: `q-premise-${place}`, question: `Synthetic question ${40 + place}: when did the colleague ${PREMISE} with the ${THINGS[place]}?`, answerable: false })),
  { id: "q-absent", question: "Synthetic question 60: and the zebra?", answerable: false }
]));
const CALLS = 162;
const withQuestions = (questions) => ({ ...QUESTIONS, questions });
const snapshotOf = (reference) => sha256(`${reference.active_generation}|${reference.manifest_object_id}|${reference.visibility_epoch}`).slice(0, 16);
const SCRIPT = Object.freeze(Object.fromEntries(QUESTIONS.questions.filter(({ question }) => question.includes(PREMISE)).map(({ question }) => [question, "false_premise"])));
const standIns = (options = {}) => coldWorkers({ script: SCRIPT, ...options });
// What a cold test run with these stand-ins takes.
const using = (workers = standIns()) => ({ workerFor: workers.workerFor });
const isJudge = (request) => request.stage === "cold_judge";
const judged = (verdict) => async (count, request, usual) => (isJudge(request) ? { ...(await usual()), verdict } : usual());
const timedOut = () => new ProviderError("A synthetic call that timed out.", { code: "TIMEOUT" });

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
  // Where hard links can't be made, nothing is published or left behind, and the code says so.
  await fs.unlink(output);
  const beside = (await fs.readdir(dir)).sort();
  const links = t.mock.method(fs, "link", async () => { throw Object.assign(new Error("Synthetic words."), { code: "EPERM" }); });
  const unsupported = await cli(["export"]);
  links.mock.restore();
  assert.deepEqual([unsupported.code, unsupported.stdout, JSON.parse(unsupported.stderr)], [1, "", { error: "JOURNAL_COPY_PUBLISH_UNSUPPORTED" }]);
  assert.deepEqual((await fs.readdir(dir)).sort(), beside);
  // Without its settings, it stops before any env file is read (this one doesn't exist).
  const bare = path.join(dir, "bare.json");
  await fs.writeFile(bare, JSON.stringify({ ...config, runner_trial_export: undefined }), { mode: 0o600 });
  assert.deepEqual(JSON.parse((await cli(["export", "--env-file", path.join(dir, "missing.env")], bare)).stderr), { error: "JOURNAL_EXPORT_CONFIG_INVALID" });
  const badKey = path.join(dir, "bad-key.json");
  await fs.writeFile(badKey, JSON.stringify({ ...config, runner_trial_export: { ...config.runner_trial_export, recipient_public_key: "bm90IGEga2V5" } }), { mode: 0o600 });
  assert.deepEqual(JSON.parse((await cli(["export"], badKey)).stderr), { error: "JOURNAL_EXPORT_RECIPIENT_INVALID" });
});

test("the sealed copy is written whole or not at all, never over another file, and a write that stopped part-way can be run again", async (t) => {
  const server = await serverJournal(t);
  const keyPair = createJournalCopyKeyPair();
  const sealed = await server.exportFor(keyPair.publicKey);
  const dir = await temporaryFolder(t, "write");
  const file = path.join(dir, "copy.sealed.json");
  const failing = (code) => async () => { throw Object.assign(new Error("synthetic"), { code }); };
  const opening = (change) => async (...args) => {
    const handle = await fs.open(...args);
    return change(handle);
  };
  // Stopped while the temporary file is written, while it is synced, and while it is given the final name: nothing is left.
  for (const [fileSystem, code] of [
    [{ ...fs, open: opening((handle) => Object.assign(Object.create(handle), { writeFile: failing("ENOSPC"), close: () => handle.close() })) }, "ENOSPC"],
    [{ ...fs, open: opening((handle) => Object.assign(Object.create(handle), { writeFile: (...args) => handle.writeFile(...args), sync: failing("EIO"), close: () => handle.close() })) }, "EIO"],
    [{ ...fs, link: failing("EIO") }, "EIO"]
  ]) {
    await assert.rejects(writeSealedJournalCopy(file, sealed, { fileSystem }), { code });
    assert.deepEqual(await fs.readdir(dir), [], code);
  }
  // Killed while the temporary file is half written, and just before it gets the final name: nothing is at the final name.
  const bundlePath = path.join(await temporaryFolder(t, "sealed"), "sealed.json");
  await fs.writeFile(bundlePath, JSON.stringify(sealed), { mode: 0o600 });
  for (const stop of [
    "open: async (...args) => { const handle = await fs.open(...args); return Object.assign(Object.create(handle), { writeFile: async (text) => { await handle.write(text.slice(0, 200)); process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); } }); }",
    "link: async () => { process.kill(process.pid, 'SIGKILL'); await new Promise(() => {}); }"
  ]) {
    const { signal, stderr } = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import fs from "node:fs/promises";
      import { writeSealedJournalCopy } from ${JSON.stringify(new URL("../src/journal-import/journal-copy.mjs", import.meta.url).href)};
      const sealed = JSON.parse(await fs.readFile(process.argv[1], "utf8"));
      await writeSealedJournalCopy(process.argv[2], sealed, { fileSystem: { ...fs, ${stop} } });`, bundlePath, file], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
    assert.equal(signal, "SIGKILL", stderr);
    await absent(file, "nothing at the final name");
    const left = await fs.readdir(dir);
    assert.ok(left.length === 1 && left[0].startsWith("copy.sealed.json.") && left[0].endsWith(".tmp"), "at most the temporary file");
    assert.equal(await modeOf(path.join(dir, left[0])), 0o600);
    await fs.unlink(path.join(dir, left[0]));
  }
  // Run again after any of these: the whole copy, mode 0600, alone in its folder.
  const whole = async () => {
    assert.deepEqual(await fs.readdir(dir), ["copy.sealed.json"]);
    assert.equal(await modeOf(file), 0o600);
    assert.ok(openJournalCopy(JSON.parse(await fs.readFile(file, "utf8")), keyPair).graph.nodes.length > 0);
  };
  await writeSealedJournalCopy(file, sealed);
  await whole();
  // The temporary file is whole and synced before it gets the final name, and the folder is synced last.
  await fs.unlink(file);
  const steps = [];
  const named = (where) => (where === file ? "file" : where === dir ? "folder" : "temporary");
  await writeSealedJournalCopy(file, sealed, { fileSystem: {
    async open(where, ...args) {
      const handle = await fs.open(where, ...args);
      const step = (name) => (...values) => { steps.push(`${name} ${named(where)}`); return handle[name](...values); };
      return { writeFile: step("writeFile"), sync: step("sync"), close: step("close") };
    },
    async link(from, to) { steps.push(`link ${named(from)} ${named(to)}`); return fs.link(from, to); },
    async rm(where, options) { steps.push(`rm ${named(where)}`); return fs.rm(where, options); }
  } });
  assert.deepEqual(steps, ["writeFile temporary", "sync temporary", "close temporary", "link temporary file", "rm temporary", "sync folder", "close folder"]);
  await whole();
  // Never over another file, and nothing left beside it.
  await fs.writeFile(file, "another file", { mode: 0o600 });
  await assert.rejects(writeSealedJournalCopy(file, sealed), { code: "JOURNAL_COPY_FILE_EXISTS" });
  assert.equal(await fs.readFile(file, "utf8"), "another file");
  assert.deepEqual(await fs.readdir(dir), ["copy.sealed.json"]);
  // A filesystem without hard links: nothing is published (nothing is ever opened at the final name), and nothing is left beside it, whether
  // or not another file is there. On one that has them, the same export then publishes.
  for (const code of ["EPERM", "ENOTSUP", "EOPNOTSUPP"]) {
    const opened = [];
    const fileSystem = { ...fs, link: failing(code), open: async (where, ...args) => { opened.push(named(where)); return fs.open(where, ...args); } };
    await assert.rejects(writeSealedJournalCopy(file, sealed, { fileSystem }), { code: "JOURNAL_COPY_PUBLISH_UNSUPPORTED" });
    assert.equal(await fs.readFile(file, "utf8"), "another file");
    assert.deepEqual(await fs.readdir(dir), ["copy.sealed.json"], code);
    await fs.unlink(file);
    await assert.rejects(writeSealedJournalCopy(file, sealed, { fileSystem }), { code: "JOURNAL_COPY_PUBLISH_UNSUPPORTED" });
    assert.deepEqual(await fs.readdir(dir), [], code);
    assert.deepEqual(opened, ["temporary", "temporary"], code);
    await writeSealedJournalCopy(file, sealed);
    await whole();
    await fs.writeFile(file, "another file");
  }
});

test("the laptop commands: each client's key, an import that leaves every file where it was, and a cold test whose receipt opens the gate", async (t) => {
  const server = await coldServer(t);
  const trial = await trialWith(t, 2);
  const { home } = trial;
  const [clientOne, clientTwo] = trial.cases;
  for (const provider of ["mixed", "claude", "codex"]) assert.deepEqual(parseJournalArguments(["--cold-test", path.join(home, "q.json"), "--provider", provider]), { command: "cold-test", file: path.join(home, "q.json"), provider, dir: null });
  for (const provider of [[], ["--provider", "gpt"]]) assert.throws(() => parseJournalArguments(["--cold-test", path.join(home, "q.json"), ...provider]), /--cold-test needs --provider mixed, claude or codex/u);
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
  const exportFor = async (publicKey, name, exportedAt, corpusId = SERVER_CORPUS) => {
    const file = path.join(outside, name);
    await writeSealedJournalCopy(file, await exportJournalCopy({ caseAccessService: server.service, caseId: SERVER_CASE, corpusId, authContext: server.auth, recipientPublicKey: publicKey, exportedAt }));
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
  // While the trial holds the vault: refused, nothing imported.
  const running = await acquirePrivateRootWriterLock({ rootDir: trial.providers.rootDir });
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: sealedOne }), /The trial is running/u);
  await running.release();
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText);
  const imported = await importClientJournal({ home, number: 1, sealedPath: sealedOne });
  assert.ok(imported.passages_verified >= 3);
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText, "the file stays where the owner put it");
  let clients = (await readRunnerClients(home)).clients;
  assert.equal(clients[0].journal.corpus_id, imported.corpus_id);
  assert.match(clients[0].journal.source_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(clients[1].journal.corpus_id, null);
  await assert.rejects(writeRunnerClients(home, { schema_version: 1, clients: [{ ...clients[0], journal: { ...clients[0].journal, source_sha256: "not a digest" } }] }), { code: "RUNNER_CLIENTS_INVALID" });
  // The same journal for the second client: refused.
  const sealedForTwo = await exportFor(keyTwo.publicKey, "two.sealed.json", "2026-11-24T08:01:00.000Z");
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: sealedForTwo }), /already copied for client 1/u);
  assert.equal(JSON.parse(await fs.readFile(sealedForTwo, "utf8")).kind, "runner_journal_copy_sealed");
  // Another corpus of the same server case is the same person's: refused too.
  const other = generatedJournal([{ sourceId: "source:c", representationId: "repr-9", lines: ["Another line about the garden."] }], "synthetic-second-corpus");
  await server.service.createJournalCorpus(SERVER_CASE, { corpusId: "synthetic-second-corpus", manifestObjectId: "manifest:staging" }, server.auth);
  let secondPersisted;
  await server.service.withJournalCorpus(SERVER_CASE, "synthetic-second-corpus", { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    secondPersisted = await persistGraphGeneration({ corpusStore, graph: other.graph, sourceRepresentations: other.sources, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes: 4096 });
  }, server.auth);
  await server.service.publishJournalGeneration(SERVER_CASE, { corpusId: "synthetic-second-corpus", generation: other.graph.generation, manifestObjectId: secondPersisted.manifest_object_id }, server.auth);
  const sealedSecond = await exportFor(keyTwo.publicKey, "two-second.sealed.json", "2026-11-24T08:01:30.000Z", "synthetic-second-corpus");
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: sealedSecond }), /already copied for client 1/u);

  // The cold test: refused without consent, naming the companies that would get excerpts with that provider; with it, a test that starts
  // removes the copy's receipt and only a pass gives a new one.
  const coldTest = (workers = standIns(), options = {}) => runClientColdTest({ home, number: 1, questionsPath, provider: "mixed", ...using(workers), ...options });
  const unasked = standIns();
  for (const [provider, companies] of [["mixed", "Anthropic and OpenAI"], ["claude", "Anthropic"], ["codex", "OpenAI"]]) {
    await assert.rejects(coldTest(unasked, { provider }), { message: `Client 1 has no confirmed journal consent. The cold test sends excerpts of their journal to ${companies}, so it runs only with their consent (runner-trial-start.mjs --journal-consent confirm).` });
  }
  await setJournalConsent({ home, number: 1, action: "confirm" });
  for (const provider of [null, "gpt"]) await assert.rejects(coldTest(unasked, { provider }), /Choose the cold test's workers: --provider mixed, claude or codex/u);
  assert.equal(unasked.sent.length, 0);
  const receiptPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_RECEIPT_FILE);
  const misses = standIns({ script: Object.fromEntries(QUESTIONS.questions.map(({ question }) => [question, "not_found"])), verdict: (packet) => (packet.answerable ? "incomplete" : "right") });
  const missed = await coldTest(misses);
  assert.deepEqual([missed.passed, missed.report.not_met, missed.report.found.same_words], [false, ["too_few_right"], { found: 40, of: 40 }], "found, and answered as if it weren't");
  await absent(receiptPath);
  // One answer in thirty may be wrong, so two of these sixty-one: an answer that cites what it wasn't given is one.
  const inventing = (questions) => standIns({ reply: async (count, request, usual) => { const value = await usual(); return !isJudge(request) && questions.includes(value.question_id) ? { ...value, evidence_ids: [...value.evidence_ids, "src:journal:9"] } : value; } });
  for (const [questions, passes] of [[["question-1", "question-2"], true], [["question-1", "question-2", "question-3"], false]]) {
    const result = await coldTest(inventing(questions));
    assert.deepEqual([result.passed, result.report.wrong, result.report.not_met], [passes, questions.length, passes ? [] : ["wrong_answers"]]);
  }
  const overclaims = standIns({ script: {}, verdict: (packet) => (packet.question.includes(PREMISE) ? "wrong" : "right") });
  for (const failing of [overclaims, standIns({ reply: judged("wrong") }), standIns({ planted: () => "right" })]) {
    assert.equal((await coldTest()).passed, true);
    assert.equal(await modeOf(receiptPath), 0o600);
    assert.equal((await coldTest(failing)).passed, false);
    await absent(receiptPath, "a failed re-test leaves no receipt");
  }
  // A consent withdrawn during the test's last call: no receipt, though every answer was right.
  const withdrawing = standIns({ reply: async (count, request, usual) => {
    if (count === CALLS) await setJournalConsent({ home, number: 1, action: "withdraw" });
    return usual();
  } });
  await assert.rejects(coldTest(withdrawing), /consent or copy changed during the cold test: it stopped, and gave no receipt/u);
  assert.equal(withdrawing.sent.length, CALLS);
  await absent(receiptPath);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  // Every import, the same sealed file again included, drops the copy's receipt and its test's marker, so the cold test is run again; a test
  // that's refused before it starts changes nothing.
  assert.equal((await coldTest()).passed, true);
  assert.match(await fs.readFile(receiptPath, "utf8"), /"result": "pass"/u);
  assert.deepEqual(await importClientJournal({ home, number: 1, sealedPath: sealedOne }), imported);
  await absent(receiptPath);
  assert.equal(await readColdTestAttempt(home, clientOne), null);
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText);
  assert.equal((await coldTest()).passed, true);
  const receiptText = await fs.readFile(receiptPath, "utf8");
  // The receipt names what was tested and who answered and judged.
  const receipt = JSON.parse(receiptText);
  assert.deepEqual([receipt.case_id, receipt.corpus_id, receipt.reader_version, receipt.rule, receipt.questions, receipt.consumer, receipt.judge],
    [clientOne, imported.corpus_id, SESSION_USE_READER_VERSION, COLD_TEST_RULE.version, { answerable: 40, unanswerable: 20, planted: 20 }, RECEIPTS.W, RECEIPTS.CW]);
  // It also says who wrote the questions, and which of the tests started on this copy it was: the count begins anew with an import.
  assert.deepEqual([receipt.author, receipt.run], ["person", 1]);
  const attempt = await readColdTestAttempt(home, clientOne);
  assert.match(attempt, /^[0-9a-f-]{36}$/u);
  await fs.chmod(questionsPath, 0o644);
  await assert.rejects(coldTest(unasked), /readable by you alone/u);
  await assert.rejects(coldTest(unasked, { provider: "gpt" }), /Choose the cold test's workers/u);
  assert.deepEqual([await fs.readFile(receiptPath, "utf8"), await readColdTestAttempt(home, clientOne), unasked.sent.length], [receiptText, attempt, 0]);

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
  await absent(path.join(clientJournalFolder(home, clientOne), COLD_TEST_ATTEMPT_FILE));
  assert.notEqual((await read()).availability, "available");
  clients = (await readRunnerClients(home)).clients;
  assert.equal(clients[0].journal.corpus_id, again.corpus_id);
  assert.equal(clientTwo, clients[1].case_id);
});

// A client whose journal copy the import made, with the questions file of its cold test; client one consented.
async function copiedClient(t, { clients = 1, server = null } = {}) {
  const from = server ?? await coldServer(t);
  const trial = await trialWith(t, clients, { consent: true });
  const { home } = trial;
  const outside = await temporaryFolder(t, "transfer");
  const sealedPath = path.join(outside, "one.sealed.json");
  await writeSealedJournalCopy(sealedPath, await from.exportFor((await ensureJournalCopyKey({ home, number: 1 })).publicKey));
  const imported = await importClientJournal({ home, number: 1, sealedPath });
  const questionsPath = path.join(outside, "questions.json");
  await fs.writeFile(questionsPath, JSON.stringify(QUESTIONS), { mode: 0o600 });
  const receiptPath = path.join(clientJournalFolder(home, trial.cases[0]), COLD_TEST_RECEIPT_FILE);
  const coldTest = (options) => runClientColdTest({ home, number: 1, questionsPath, provider: "mixed", ...options });
  return { ...trial, server: from, outside, sealedPath, imported, questionsPath, receiptPath, coldTest };
}

// The trial's controller on a trial folder, with stand-in workers that are never called: for "Delete this case" of a client, or of the
// owner's own case. `change` gives the vault another deletion.
function deleting(trial, change = (source) => source) {
  const { prepared } = trial;
  const privateCaseSource = change(createPrivateCaseAccessService({ rootDir: trial.providers.rootDir, authorizationProvider: trial.providers.authorizationProvider, keyProvider: trial.providers.keyProvider, allowDevelopmentFileProvider: true }));
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialCaseId: prepared.caseId, runnerTrialDir: trial.home, runnerTrialSettingsPath: null, runnerClaudeConfigDir: null, runnerRulesRoot: null, responseEvidenceEnforced: false });
  const { controller } = createRunnerTrialController({ privateCaseSource, config, clientCaseIds: Object.keys(prepared.clientTokens), settings: validateRunnerTrialSettings({ writerMode: "whole", checkerMode: "whole" }),
    parts: cutRuleParts(loadTherapyProtocol({ boxGuidance: true })), workerFor: () => ({ async call() { throw new Error("no worker is called"); } }) });
  return (caseId) => controller.deleteCase({ caseId, authContext: { bearerToken: prepared.clientTokens[caseId] ?? prepared.token } });
}

test("a client's copies come from one server case: named on the list before the vault is touched, kept when an import fails, and no other accepted until their Delete", async (t) => {
  const first = await serverJournal(t);
  const second = await serverJournal(t, { caseId: OTHER_SERVER_CASE });
  const trial = await trialWith(t, 4);
  const { home } = trial;
  const vault = path.join(home, "vault");
  const outside = await temporaryFolder(t, "transfer");
  let files = 0;
  const sealedFor = async (server, number, change = (bundle) => bundle) => {
    const { publicKey } = await ensureJournalCopyKey({ home, number });
    const key = createJournalCopyKeyPair();
    const bundle = change(openJournalCopy(await server.exportFor(key.publicKey, `2026-11-24T08:${String(files).padStart(2, "0")}:00.000Z`), key));
    const file = path.join(outside, `copy-${files += 1}.sealed.json`);
    await writeSealedJournalCopy(file, sealJournalCopy(bundle, publicKey));
    return file;
  };
  const importing = (number, sealedPath) => importClientJournal({ home, number, sealedPath });
  const journalOf = async (number) => (await readRunnerClients(home)).clients[number - 1].journal;

  // Client one's first copy, from the first server case; a copy from another one is refused for them, and nothing changes: not the
  // list, not the vault.
  const imported = await importing(1, await sealedFor(first, 1));
  const tied = await journalOf(1);
  assert.deepEqual(Object.keys(tied).sort(), ["consent", "corpus_id", "source_sha256"]);
  const other = await sealedFor(second, 1);
  const before = await tree(home);
  await assert.rejects(importing(1, other), { message: "Client 1's journal copy comes from another server case; to import a different one, delete their case first. Nothing was changed." });
  assert.deepEqual(await tree(home), before);
  // Another copy from the same server case is fine, and so the first server case stays client one's alone.
  const newer = await importing(1, await sealedFor(first, 1));
  assert.notEqual(newer.corpus_id, imported.corpus_id);
  assert.deepEqual(await journalOf(1), { ...tied, corpus_id: newer.corpus_id });
  await assert.rejects(importing(2, await sealedFor(first, 2)), /already copied for client 1/u);

  // An import that fails after the list names its server case (here the trial runs): nothing in the vault, the list keeps the server
  // case, no other client gets it meanwhile, and the same file then imports.
  const retried = await sealedFor(second, 2);
  const running = await acquirePrivateRootWriterLock({ rootDir: trial.providers.rootDir });
  const untouched = await tree(vault);
  await assert.rejects(importing(2, retried), { message: "The trial is running: stop it (Ctrl-C in its terminal), then import again. Nothing was imported. Until their Delete, client 2's copies can come only from that server case; the same file can be imported again." });
  await running.release();
  assert.deepEqual(await tree(vault), untouched);
  const begun = await journalOf(2);
  assert.deepEqual([begun.corpus_id, /^[0-9a-f]{64}$/u.test(begun.source_sha256), begun.source_sha256 === tied.source_sha256], [null, true, false]);
  await assert.rejects(importing(3, await sealedFor(second, 3)), /already copied for client 2 \(or a copy of it begun\); nothing was imported/u);
  assert.deepEqual(await journalOf(3), { corpus_id: null, consent: null });
  const two = await importing(2, retried);
  assert.deepEqual(await journalOf(2), { ...begun, corpus_id: two.corpus_id });

  // One that fails inside the import (a graph that doesn't hold, in a bundle whose digest is right) keeps it too; a good copy from that
  // server case then imports, one from another is refused.
  const third = await serverJournal(t, { caseId: "case-56565656-5656-4565-8565-565656565656" });
  const broken = await sealedFor(third, 3, (bundle) => {
    const bad = structuredClone(bundle);
    bad.graph.nodes.find((node) => node.kind === "passage").data.quote_sha256 = "0".repeat(64);
    bad.content_sha256 = sha256(JSON.stringify({ graph: bad.graph, source_representations: bad.source_representations, extra_indexes: bad.extra_indexes, index_representations: bad.index_representations }));
    return bad;
  });
  await assert.rejects(importing(3, broken), { message: "The import didn't finish (SPAN_INTEGRITY_FAILED). Until their Delete, client 3's copies can come only from that server case; the same file can be imported again." });
  assert.equal((await journalOf(3)).corpus_id, null);
  const fourth = await serverJournal(t, { caseId: "case-78787878-7878-4787-8787-787878787878" });
  await assert.rejects(importing(3, await sealedFor(fourth, 3)), /Client 3's journal copy comes from another server case/u);
  assert.equal((await journalOf(3)).corpus_id, null);
  assert.ok((await importing(3, await sealedFor(third, 3))).records_verified > 0);

  // The list can't be written: before the vault is touched, nothing is imported; after the copy is in the vault, the list still keeps its
  // server case, so it's nobody else's, and the same file can be imported again.
  const list = path.join(home, RUNNER_CLIENTS_FILE);
  const rename = fs.rename;
  let failAt = 1, writes = 0;
  const mocked = t.mock.method(fs, "rename", async (from, to) => {
    if (to === list && (writes += 1) === failAt) throw Object.assign(new Error("Synthetic words."), { code: "EIO" });
    return rename.call(fs, from, to);
  });
  const unlisted = await sealedFor(fourth, 4);
  const unchanged = await tree(home), vaultUnchanged = await tree(vault);
  await assert.rejects(importing(4, unlisted), { message: "The client list couldn't be written (EIO); nothing was imported." });
  assert.deepEqual(await tree(home), unchanged);
  [failAt, writes] = [2, 0];
  await assert.rejects(importing(4, unlisted), { message: "The client list couldn't be written (EIO); the copy is in the client's case, but nothing uses it. Until their Delete, client 4's copies can come only from that server case; the same file can be imported again." });
  mocked.mock.restore();
  const kept = await journalOf(4);
  assert.deepEqual([kept.corpus_id, typeof kept.source_sha256], [null, "string"]);
  assert.notDeepEqual(await tree(vault), vaultUnchanged, "the copy is in the vault");
  const listed = await importing(4, unlisted);
  assert.deepEqual(await journalOf(4), { ...kept, corpus_id: listed.corpus_id });
});

test("no receipt survives an import that starts: it goes with its test's marker, for good, before anything is written, so an import that fails or is killed leaves the journal closed; one that can't start leaves them", async (t) => {
  const trial = await copiedClient(t);
  const { home, cases: [clientOne], prepared, server, outside, sealedPath, imported, receiptPath, coldTest } = trial;
  const folder = clientJournalFolder(home, clientOne);
  const markerPath = path.join(folder, COLD_TEST_ATTEMPT_FILE);
  const vault = path.join(home, "vault"), caseFile = path.join(vault, `${clientOne}.vault.json`);
  const list = path.join(home, RUNNER_CLIENTS_FILE), lock = path.join(home, ".trial-folder.lock");
  const refuse = (code) => Object.assign(new Error("Synthetic words."), { code });
  const importing = (file = sealedPath) => importClientJournal({ home, number: 1, sealedPath: file });
  const ended = (words) => ({ message: `${words} Until their Delete, client 1's copies can come only from that server case; the same file can be imported again.` });
  // The gate, under the client's own grant from a start, and the receipt and marker of a test that passed.
  const authContext = { bearerToken: prepared.clientTokens[clientOne] };
  const gate = createRunnerJournalGate({ trialDir: home, caseAccessService: createPrivateCaseAccessService({ rootDir: trial.providers.rootDir, authorizationProvider: trial.providers.authorizationProvider,
    keyProvider: trial.providers.keyProvider, allowDevelopmentFileProvider: true }) });
  const open = () => gate.openNow({ caseId: clientOne, authContext });
  assert.equal((await coldTest(using())).passed, true);
  const receipt = await fs.readFile(receiptPath, "utf8"), marker = await fs.readFile(markerPath, "utf8");
  const there = async () => [await fs.readFile(receiptPath, "utf8"), await fs.readFile(markerPath, "utf8")];
  const putBack = async () => { for (const [file, text] of [[receiptPath, receipt], [markerPath, marker]]) await fs.writeFile(file, text, { mode: 0o600 }); };
  assert.equal(await open(), true);
  // `during`, with what the import does of these done as given: an unlink (`unlinking`, before it), a sync of the journal folder (`syncing`,
  // before it), a file given its name (`naming`, before it; `named`, after it).
  const meanwhile = async ({ unlinking = () => {}, syncing = () => {}, naming = () => {}, named = () => {} }, during) => {
    const { open: openFile, rename, unlink } = fs;
    const mocked = [
      t.mock.method(fs, "unlink", async (file) => { unlinking(file); return unlink.call(fs, file); }),
      t.mock.method(fs, "rename", async (from, to) => { naming(to); await rename.call(fs, from, to); named(to); }),
      t.mock.method(fs, "open", async (file, ...args) => {
        const handle = await openFile.call(fs, file, ...args);
        return file === folder ? Object.assign(Object.create(handle), { sync: async () => { syncing(); return handle.sync(); }, close: () => handle.close() }) : handle;
      })
    ];
    try { return await during(); } finally { for (const each of mocked) each.mock.restore(); }
  };

  // While the trial runs, the import doesn't start: the receipt and the marker stay as they are, and the journal open.
  const running = await acquirePrivateRootWriterLock({ rootDir: trial.providers.rootDir });
  await assert.rejects(importing(), /The trial is running/u);
  await running.release();
  assert.deepEqual([...(await there()), await open()], [receipt, marker, true]);

  // A Delete that couldn't clear the list and the journal folder: the case and its copy are gone, and the key, the receipt, the marker and
  // the list's naming of the copy are still there. Importing the same file again makes the very copy that receipt names.
  const deleteCase = deleting(trial);
  const leftBehind = async () => {
    await putBack();
    const { rm } = fs;
    const kept = t.mock.method(fs, "rm", async (where, options) => { if (where === folder) throw refuse("EACCES"); return rm.call(fs, where, options); });
    try {
      const deleted = await meanwhile({ naming: (to) => { if (to === list) throw refuse("EIO"); } }, () => deleteCase(clientOne));
      assert.deepEqual([deleted.case_file_removed, deleted.journal_corpora_removed, deleted.cleanup_left], [true, 1, ["JOURNAL_LIST", "JOURNAL_FOLDER"]]);
    } finally { kept.mock.restore(); }
    assert.deepEqual([...(await there()), await open()], [receipt, marker, false]);
  };
  // After an import of that copy: no receipt, no marker, the journal closed for that alone (with them back, it would be open).
  const closedOnThatCopy = async (what) => {
    await absent(receiptPath, what);
    await absent(markerPath, what);
    assert.equal(await open(), false, what);
    const part = await gate.freezeResponseEvidenceJournal({ caseId: clientOne, query: "colleague", authContext });
    assert.deepEqual([part.availability, part.omissions[0].reason, part.source_items.length], ["unavailable", "cold_test_receipt_missing", 0], what);
    await putBack();
    assert.equal(await open(), true, `${what}: the copy is there, published, as the receipt names it`);
    for (const file of [receiptPath, markerPath]) await fs.unlink(file);
  };
  // Stopped by an error right after the copy is published: the case's file has then been given its name three times (the new case, its
  // corpus, the publication).
  await leftBehind();
  let writes = 0;
  await meanwhile({ named: (to) => { if (to === caseFile && (writes += 1) === 3) throw refuse("EIO"); } }, () => assert.rejects(importing(), ended("The import didn't finish (EIO).")));
  await closedOnThatCopy("an error right after the publication");
  // Killed there.
  await leftBehind();
  const { signal, stdout, stderr } = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import fs from "node:fs/promises";
    import { importClientJournal } from ${JSON.stringify(new URL("../scripts/runner-trial-journal.mjs", import.meta.url).href)};
    const [home, sealedPath, caseFile] = process.argv.slice(1);
    const { rename } = fs;
    let writes = 0;
    fs.rename = async (from, to) => {
      await rename.call(fs, from, to);
      if (to !== caseFile || (writes += 1) !== 3) return;
      process.stdout.write("published");
      process.kill(process.pid, "SIGKILL");
      await new Promise(() => {});
    };
    await importClientJournal({ home, number: 1, sealedPath });`, home, sealedPath, caseFile], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  assert.deepEqual([signal, stdout], ["SIGKILL", "published"], stderr);
  await fs.unlink(lock);
  await closedOnThatCopy("killed right after the publication");
  // Stopped after the copy is checked, by a list that can't be written; and not stopped at all.
  await leftBehind();
  await meanwhile({ naming: (to) => { if (to === list) throw refuse("EIO"); } }, () => assert.rejects(importing(), ended("The client list couldn't be written (EIO); the copy is in the client's case, but nothing uses it.")));
  await closedOnThatCopy("a list that can't be written");
  await leftBehind();
  assert.deepEqual(await importing(), imported);
  await closedOnThatCopy("imported");

  // Each step of the removal fails in turn (the receipt's, its folder's sync, the marker's, that sync, and the last sync): the import
  // doesn't start, so nothing is written to the vault or the list. Made again, the folder is synced before the vault is written, also when
  // an earlier import had removed both.
  for (const [at, code] of [[1, "EACCES"], [2, "EIO"], [3, "EPERM"], [4, "EIO"], [5, "ENOSPC"]]) {
    await leftBehind();
    const listed = await fs.readFile(list, "utf8"), untouched = await tree(vault);
    const steps = [];
    let failAt = at;
    const step = (name) => { steps.push(name); if (steps.length === failAt) throw refuse(code); };
    const recorded = { unlinking: (file) => { if (file === receiptPath) step("unlink receipt"); if (file === markerPath) step("unlink marker"); }, syncing: () => step("sync folder"), named: (to) => { if (to === caseFile) step("write case"); } };
    await meanwhile(recorded, () => assert.rejects(importing(), ended(`Client 1's cold-test receipt couldn't be removed for good (${code}); nothing was imported.`)));
    assert.deepEqual(steps, ["unlink receipt", "sync folder", "unlink marker", "sync folder", "sync folder"].slice(0, at));
    assert.deepEqual([await fs.readFile(list, "utf8"), await tree(vault)], [listed, untouched], steps.join());
    await absent(lock);
    [failAt, steps.length] = [0, 0];
    assert.deepEqual(await meanwhile(recorded, () => importing()), imported);
    assert.deepEqual(steps.filter((name, index) => name !== steps[index - 1]).slice(-3), ["unlink marker", "sync folder", "write case"], steps.join());
    await closedOnThatCopy(`after the removal's step ${at} failed`);
  }

  // One that's refused before anything is written drops it too, whether it names the copy that import would have made or the one that's
  // there (which is then tested again), and a test that was running gives none.
  const key = createJournalCopyKeyPair();
  const broken = openJournalCopy(await server.exportFor(key.publicKey, "2026-11-24T08:40:00.000Z"), key);
  broken.graph.nodes.find((node) => node.kind === "passage").data.quote_sha256 = "0".repeat(64);
  broken.content_sha256 = sha256(JSON.stringify({ graph: broken.graph, source_representations: broken.source_representations, extra_indexes: broken.extra_indexes, index_representations: broken.index_representations }));
  const brokenPath = path.join(outside, "broken.sealed.json");
  await writeSealedJournalCopy(brokenPath, sealJournalCopy(broken, (await ensureJournalCopyKey({ home, number: 1 })).publicKey));
  const importingBroken = () => assert.rejects(importing(brokenPath), ended("The import didn't finish (SPAN_INTEGRITY_FAILED)."));
  const untouched = await tree(vault);
  for (const planted of [JSON.stringify({ ...JSON.parse(receipt), corpus_id: journalCopyCorpusId(broken) }), receipt]) {
    await fs.writeFile(markerPath, marker, { mode: 0o600 });
    await fs.writeFile(receiptPath, planted, { mode: 0o600 });
    assert.equal(await open(), planted === receipt);
    await importingBroken();
    await closedOnThatCopy("refused before anything is written");
  }
  const meanwhileRefused = standIns({ reply: async (count, request, usual) => {
    if (count === 3) await importingBroken();
    return usual();
  } });
  await assert.rejects(coldTest(using(meanwhileRefused)), { message: "The marker of this cold test's start is gone or can't be read: it gave no receipt. Run it again." });
  await absent(receiptPath);
  assert.deepEqual(await tree(vault), untouched);
  assert.equal((await coldTest(using())).passed, true);
  assert.equal(await open(), true);
});

test("Delete this case of a client takes their copies, their key and their place on the list: then another server case can be theirs, and theirs another client's", async (t) => {
  const first = await coldServer(t);
  const second = await coldServer(t, { caseId: OTHER_SERVER_CASE });
  const trial = await copiedClient(t, { clients: 2, server: first });
  const { home, outside } = trial;
  const [clientOne, clientTwo] = trial.cases;
  const deleteCase = deleting(trial);
  const sealedFor = async (server, number, name) => {
    const file = path.join(outside, name);
    await writeSealedJournalCopy(file, await server.exportFor((await ensureJournalCopyKey({ home, number })).publicKey));
    return file;
  };
  assert.equal((await trial.coldTest(using())).passed, true);
  const consent = (await readRunnerClients(home)).clients[0].journal.consent;
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: await sealedFor(second, 1, "second-for-one.sealed.json") }), /delete their case first/u);
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: await sealedFor(first, 2, "first-for-two.sealed.json") }), /already copied for client 1/u);

  // A cold test that's running when the case is deleted stops before its next packet, and leaves no receipt.
  const workers = standIns({ prepare: async (count) => { if (count === 3) await deleteCase(clientOne); } });
  await assert.rejects(trial.coldTest(using(workers)), /consent or copy changed during the cold test/u);
  assert.equal(workers.sent.length, 2);
  await absent(trial.receiptPath);
  await absent(path.join(clientJournalFolder(home, clientOne), CLIENT_COPY_KEY_FILE));
  assert.deepEqual((await readRunnerClients(home)).clients.map((client) => client.journal), [{ corpus_id: null, consent }, { corpus_id: null, consent: null }], "the consent stays as recorded");
  await assert.rejects(trial.copier(clientOne).inspectJournalCorpus(clientOne, trial.imported.corpus_id, { requiredScope: "case:read", requiredPurpose: "session_use" }, { bearerToken: "synthetic" }), { code: "PRIVATE_CASE_NOT_FOUND" });
  // A copy sealed for the old key can't be opened any more.
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: trial.sealedPath }), /has no key for journal copies yet/u);
  await ensureJournalCopyKey({ home, number: 1 });
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: trial.sealedPath }), /sealed for another key/u);

  await importClientJournal({ home, number: 1, sealedPath: await sealedFor(second, 1, "second-for-one-again.sealed.json") });
  await importClientJournal({ home, number: 2, sealedPath: path.join(outside, "first-for-two.sealed.json") });
  const [one, two] = (await readRunnerClients(home)).clients.map((client) => client.journal);
  assert.ok(one.corpus_id && two.corpus_id && one.source_sha256 !== two.source_sha256);

  // The deletion is made under the folder's lock: one it can't have (here left by a command that ended) leaves everything as it was, the
  // message says what to do, and it can be made again.
  const lock = path.join(home, ".trial-folder.lock");
  await fs.writeFile(lock, "999999999 synthetic-token\n", { mode: 0o600 });
  const before = await tree(home);
  await assert.rejects(deleteCase(clientTwo), (error) => error.code === "RUNNER_FOLDER_LOCK_LEFT" && error.message.includes(lock));
  assert.deepEqual(await tree(home), before);
  await fs.unlink(lock);
  assert.equal((await deleteCase(clientTwo)).cleanup_left, undefined);
  assert.deepEqual((await readRunnerClients(home)).clients[1].journal, { corpus_id: null, consent: null });
  await absent(path.join(clientJournalFolder(home, clientTwo), CLIENT_COPY_KEY_FILE));
  // A list that can't be written is told, and the case is deleted all the same: the key is gone, the list keeps the server case (nothing
  // else is imported against it), and deleting again finishes it.
  const list = path.join(home, RUNNER_CLIENTS_FILE);
  const rename = fs.rename;
  const mocked = t.mock.method(fs, "rename", async (from, to) => {
    if (to === list) throw Object.assign(new Error("Synthetic words."), { code: "EIO" });
    return rename.call(fs, from, to);
  });
  const deleted = await deleteCase(clientOne);
  mocked.mock.restore();
  assert.deepEqual([deleted.case_file_removed, deleted.journal_corpora_removed, deleted.cleanup_left], [true, 1, ["JOURNAL_LIST"]]);
  await absent(path.join(clientJournalFolder(home, clientOne), CLIENT_COPY_KEY_FILE));
  assert.equal((await readRunnerClients(home)).clients[0].journal.source_sha256, one.source_sha256);
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: await sealedFor(second, 2, "second-for-two.sealed.json") }), /already copied for client 1/u);
  const again = await deleteCase(clientOne);
  assert.deepEqual([again.case_file_removed, again.journal_corpora_removed, again.cleanup_left], [false, 0, undefined]);
  assert.deepEqual((await readRunnerClients(home)).clients[0].journal, { corpus_id: null, consent });
  await importClientJournal({ home, number: 2, sealedPath: path.join(outside, "second-for-two.sealed.json") });
});

test("once the vault has deleted a client's case, Delete is done: what can't be cleared besides is named, everything else goes, and deleting again clears it; until the vault has finished, their server case is no other client's", async (t) => {
  const trial = await copiedClient(t, { clients: 2 });
  const { home, cases: [clientOne, clientTwo], prepared } = trial;
  const deleteCase = deleting(trial);
  const folder = clientJournalFolder(home, clientOne);
  const list = path.join(home, RUNNER_CLIENTS_FILE);
  const lock = path.join(home, ".trial-folder.lock");
  const vault = path.join(home, "vault");
  const temporaryOf = (caseId) => path.join(vault, `${caseId}.vault.json.tmp`);
  const logOf = (caseId) => path.join(home, caseId === clientOne ? `runner-log-${clientOne}.jsonl` : "runner-log.jsonl");
  const { consent } = (await readRunnerClients(home)).clients[0].journal;
  const journalOf = async () => (await readRunnerClients(home)).clients[0].journal;
  const caseGone = (caseId = clientOne) => assert.rejects(trial.copier(caseId).loadPrivateRuntimeCase(caseId, { bearerToken: "synthetic" }), { code: "PRIVATE_CASE_NOT_FOUND" });
  // The same journal, exported again for a client.
  let copies = 0;
  const sealedFor = async (number) => {
    const sealedPath = path.join(trial.outside, `filled-${copies += 1}.sealed.json`);
    await writeSealedJournalCopy(sealedPath, await trial.server.exportFor((await ensureJournalCopyKey({ home, number })).publicKey, `2026-11-24T10:${String(copies).padStart(2, "0")}:00.000Z`));
    return sealedPath;
  };
  // A client's case with everything Delete takes: the copy in the vault, its place on the list, the journal folder (the key, the receipt and
  // the marker of the test that gave it) and the run log.
  const filled = async () => {
    await importClientJournal({ home, number: 1, sealedPath: await sealedFor(1) });
    assert.equal((await trial.coldTest(using())).passed, true);
    await fs.writeFile(logOf(clientOne), "{}\n", { mode: 0o600 });
    assert.deepEqual((await fs.readdir(folder)).sort(), [COLD_TEST_ATTEMPT_FILE, COLD_TEST_RECEIPT_FILE, CLIENT_COPY_KEY_FILE].sort());
    const listed = await journalOf();
    assert.deepEqual(Object.keys(listed).sort(), ["consent", "corpus_id", "source_sha256"]);
    return listed;
  };
  // Each step that fails, by its code: the vault's own first removal after the case's file (its temporary file), the list that can't be
  // written, the folder, the log and the lock that can't be removed, and what the runtime remembers.
  const refuse = (code) => Object.assign(new Error("Synthetic words."), { code });
  const failing = (codes) => {
    const { rename, rm, unlink } = fs;
    const forget = Set.prototype.delete;
    const places = [[folder, "JOURNAL_FOLDER"], [logOf(clientOne), "RUN_LOG"], [logOf(null), "RUN_LOG"], [lock, "FOLDER_LOCK"]];
    const mocked = [
      t.mock.method(fs, "unlink", async (file) => { if ([clientOne, prepared.caseId].some((caseId) => file === temporaryOf(caseId)) && codes.includes("VAULT_CLEANUP")) throw refuse("EIO"); return unlink.call(fs, file); }),
      t.mock.method(fs, "rename", async (from, to) => { if (to === list && codes.includes("JOURNAL_LIST")) throw refuse("EIO"); return rename.call(fs, from, to); }),
      t.mock.method(fs, "rm", async (where, options) => { if (places.some(([place, code]) => place === where && codes.includes(code))) throw refuse("EACCES"); return rm.call(fs, where, options); }),
      t.mock.method(Set.prototype, "delete", function forgetting(value) { if (value === clientOne && codes.includes("RUNTIME_STATE")) throw refuse("SYNTHETIC"); return forget.call(this, value); })
    ];
    return () => { for (const each of mocked) each.mock.restore(); };
  };
  const deletingWith = async (codes, caseId = clientOne, using = deleteCase) => {
    const restore = failing(codes);
    try { return await using(caseId); } finally { restore(); }
  };
  const ALL = ["VAULT_CLEANUP", "JOURNAL_LIST", "JOURNAL_FOLDER", "FOLDER_LOCK", "RUNTIME_STATE", "RUN_LOG"];
  // A vault that fails once the case is gone elsewhere too: when it syncs its folder, and at its very end.
  const syncing = async (caseId) => {
    const { open } = fs;
    const mocked = t.mock.method(fs, "open", async (where, ...args) => {
      const handle = await open.call(fs, where, ...args);
      return where === vault ? Object.assign(Object.create(handle), { sync: async () => { throw refuse("EIO"); }, close: () => handle.close() }) : handle;
    });
    try { return await deleteCase(caseId); } finally { mocked.mock.restore(); }
  };
  const ending = (source) => ({ ...source, deletePrivateCase: async (...args) => { await source.deletePrivateCase(...args); throw refuse("SYNTHETIC_VAULT_ERROR"); } });
  const ends = deleting(trial, ending);
  await deleteCase(clientOne);
  for (const [codes, using] of [...ALL.map((code) => [[code]]), [ALL], ...[syncing, ends].flatMap((vaultFails) => [[["VAULT_CLEANUP"], vaultFails], [ALL, vaultFails]])]) {
    const listed = await filled();
    const deleted = await deletingWith(codes, clientOne, using);
    // What a vault that failed had removed by then isn't known, but that the case is gone.
    assert.deepEqual([deleted.case_id, deleted.case_file_removed, deleted.journal_corpora_removed, deleted.cleanup_left], [clientOne, true, codes.includes("VAULT_CLEANUP") ? undefined : 1, codes]);
    // The case is gone, and everything but what's named. Until the vault has finished, the list also keeps the server case the copy came from.
    await caseGone();
    const unfinished = codes.includes("VAULT_CLEANUP");
    const cleared = { corpus_id: null, consent, ...(unfinished ? { source_sha256: listed.source_sha256 } : {}) };
    assert.deepEqual(await journalOf(), codes.includes("JOURNAL_LIST") ? listed : cleared, codes.join());
    const inFolder = [CLIENT_COPY_KEY_FILE, COLD_TEST_RECEIPT_FILE, COLD_TEST_ATTEMPT_FILE].map((name) => [path.join(folder, name), "JOURNAL_FOLDER"]);
    for (const [place, code] of [...inFolder, [logOf(clientOne), "RUN_LOG"], [lock, "FOLDER_LOCK"]]) {
      if (codes.includes(code)) assert.ok((await fs.readFile(place)).length > 0, `${code} remains`);
      else await absent(place, `${codes.join()}: ${place}`);
    }
    if (codes.includes("FOLDER_LOCK")) await fs.unlink(lock);
    // So it can't be copied for another client meanwhile, also when the vault, asked to delete again, can't finish again.
    const forTwo = unfinished ? await sealedFor(2) : null;
    const refusedForTwo = async () => {
      const before = await tree(home);
      await assert.rejects(importClientJournal({ home, number: 2, sealedPath: forTwo }), { message: "That journal was already copied for client 1 (or a copy of it begun); nothing was imported." });
      assert.deepEqual(await tree(home), before, codes.join());
    };
    if (unfinished) {
      await refusedForTwo();
      assert.deepEqual((await deletingWith(["VAULT_CLEANUP"], clientOne, using)).cleanup_left, ["VAULT_CLEANUP"]);
      assert.deepEqual(await journalOf(), cleared, codes.join());
      await refusedForTwo();
    }
    // Deleting again clears what remained (the lock only by hand), and again with nothing left is as good.
    for (let time = 0; time < 2; time += 1) {
      const again = await deleteCase(clientOne);
      assert.deepEqual([again.case_file_removed, again.journal_corpora_removed, Object.hasOwn(again, "cleanup_left")], [false, 0, false], codes.join());
      assert.deepEqual(await journalOf(), { corpus_id: null, consent });
      for (const place of [folder, logOf(clientOne), lock]) await absent(place);
    }
    // Then it's nobody's: the other client can import it, and once they are deleted (a Delete that finishes lets go of it at once) this client
    // can again, as the next round does.
    if (unfinished) {
      await importClientJournal({ home, number: 2, sealedPath: forTwo });
      assert.equal(Object.hasOwn(await deleteCase(clientTwo), "cleanup_left"), false);
      assert.deepEqual((await readRunnerClients(home)).clients[1].journal, { corpus_id: null, consent: null });
    }
  }
  // A cold test in its last call meanwhile, with a list that can't be written: it gives no receipt and makes no folder again.
  await filled();
  const workers = standIns({ reply: async (count, request, usual) => {
    if (count === CALLS) assert.deepEqual((await deletingWith(["JOURNAL_LIST"])).cleanup_left, ["JOURNAL_LIST"]);
    return usual();
  } });
  await assert.rejects(trial.coldTest(using(workers)), { code: "PRIVATE_CASE_NOT_FOUND" });
  assert.equal(workers.sent.length, CALLS);
  await absent(folder);
  assert.equal(Object.hasOwn(await deleteCase(clientOne), "cleanup_left"), false);
  // The owner's own case: the vault's part and its run log alone; in a trial without clients too.
  const ownRecord = (of) => of.copier(of.prepared.caseId).appendTranscriptTurn(of.prepared.caseId, { id: "turn:own", exchange_id: "exchange:own", role: "user", text: "A synthetic message.", at: "2026-11-24T08:00:00.000Z", episode_id: null }, { bearerToken: "synthetic" });
  for (const codes of [["RUN_LOG"], ["VAULT_CLEANUP"], ["VAULT_CLEANUP", "RUN_LOG"]]) {
    await ownRecord(trial);
    await fs.writeFile(logOf(null), "{}\n", { mode: 0o600 });
    const deleted = await deletingWith(codes, prepared.caseId);
    assert.deepEqual([deleted.case_file_removed, deleted.cleanup_left], [true, codes]);
    await caseGone(prepared.caseId);
    assert.equal(Object.hasOwn(await deleteCase(prepared.caseId), "cleanup_left"), false);
    await absent(logOf(null));
  }
  const alone = await trialWith(t, 0);
  await ownRecord(alone);
  assert.deepEqual((await deleting(alone, ending)(alone.prepared.caseId)).cleanup_left, ["VAULT_CLEANUP"]);
  await assert.rejects(alone.copier(alone.prepared.caseId).loadPrivateRuntimeCase(alone.prepared.caseId, { bearerToken: "synthetic" }), { code: "PRIVATE_CASE_NOT_FOUND" });
  assert.equal(Object.hasOwn(await deleting(alone)(alone.prepared.caseId), "cleanup_left"), false);

  // A vault that doesn't delete is told as it is: nothing else is touched, and the lock is let go (or, when it can't be, the vault's own
  // error is still what's told, and names the lock). Whether the case is gone is found by loading it, never by the error, and an unsure
  // answer is no.
  const refusing = (error, change = {}) => deleting(trial, (source) => ({ ...source, ...change, deletePrivateCase: async () => { throw error; } }));
  const untouchedBy = async (using, code, caseId = clientOne) => {
    const before = await tree(home);
    await assert.rejects(using(caseId), (error) => error.code === code && !Object.hasOwn(error, "folderLockLeft"));
    assert.deepEqual(await tree(home), before, code);
  };
  await filled();
  await ownRecord(trial);
  await fs.writeFile(logOf(null), "{}\n", { mode: 0o600 });
  for (const caseId of [clientOne, prepared.caseId]) {
    for (const code of ["SYNTHETIC_VAULT_ERROR", "PRIVATE_CASE_NOT_FOUND"]) await untouchedBy(refusing(refuse(code)), code, caseId);
  }
  const before = await tree(home);
  const vaultError = refuse("SYNTHETIC_VAULT_ERROR");
  const restoreLock = failing(["FOLDER_LOCK"]);
  await assert.rejects(refusing(vaultError)(clientOne), (error) => error === vaultError);
  restoreLock();
  assert.deepEqual([vaultError.message, vaultError.code, Object.keys(vaultError), vaultError.folderLockLeft], ["Synthetic words.", "SYNTHETIC_VAULT_ERROR", ["code"], lock]);
  await fs.unlink(lock);
  assert.deepEqual(await tree(home), before);
  // A case that can't be looked at isn't known to be gone, and for a caller the vault refused nothing is deleted: here with everything a
  // Delete left behind, and no case.
  await deletingWith(["JOURNAL_LIST", "JOURNAL_FOLDER", "RUN_LOG"]);
  await caseGone();
  await untouchedBy(refusing(refuse("SYNTHETIC_VAULT_ERROR"), { loadPrivateRuntimeCase: async () => { throw refuse("EIO"); } }), "SYNTHETIC_VAULT_ERROR");
  await untouchedBy(refusing(new PrivateCaseAccessDeniedError()), "PRIVATE_CASE_ACCESS_DENIED");
  assert.deepEqual((await refusing(refuse("SYNTHETIC_VAULT_ERROR"))(clientOne)).cleanup_left, ["VAULT_CLEANUP"]);
  for (const place of [folder, logOf(clientOne), lock]) await absent(place);
  assert.equal(Object.hasOwn(await deleteCase(clientOne), "cleanup_left"), false);
});

test("a client's journal folder is removed for good, as is their place on the list: each is synced after it's removed, also where an earlier Delete couldn't, and a sync that fails is told as what's left", async (t) => {
  const trial = await copiedClient(t);
  const { home, cases: [clientOne], imported } = trial;
  const deleteCase = deleting(trial);
  const folder = clientJournalFolder(home, clientOne), parent = path.join(home, "journal");
  const journalOf = async () => (await readRunnerClients(home)).clients[0].journal;
  const names = new Map([[home, "sync trial folder"], [parent, "sync journal folders"]]);
  const steps = [];
  // A Delete with the folder's removal and the syncs of the trial folder (the list's, and at the end the run log's) and of the folder it was
  // in, in order; `syncing` is what each sync answers.
  const recorded = async (syncing = () => {}, using = deleteCase) => {
    const { open, rm } = fs;
    steps.length = 0;
    const mocked = [
      t.mock.method(fs, "rm", async (where, options) => { if (where === folder) steps.push("rm folder"); return rm.call(fs, where, options); }),
      t.mock.method(fs, "open", async (where, ...args) => {
        const handle = await open.call(fs, where, ...args);
        return names.has(where) ? Object.assign(Object.create(handle), { sync: async () => { steps.push(names.get(where)); syncing(names.get(where)); return handle.sync(); }, close: () => handle.close() }) : handle;
      })
    ];
    try { return await using(clientOne); } finally { for (const each of mocked) each.mock.restore(); }
  };
  const ORDER = ["sync trial folder", "rm folder", "sync journal folders", "sync trial folder"];
  const failing = (code, name = "sync journal folders") => (at) => { if (at === name) throw Object.assign(new Error("Synthetic words."), { code }); };
  const made = async () => {
    await ensureJournalCopyKey({ home, number: 1 });
    assert.equal(await modeOf(path.join(folder, CLIENT_COPY_KEY_FILE)), 0o600);
  };
  // The list's place, whose sync fails: it names no copy any more, but not for certain, so it's told as left, and Delete again syncs it.
  const tied = await journalOf();
  assert.equal(tied.corpus_id, imported.corpus_id);
  assert.deepEqual((await recorded(failing("EIO", "sync trial folder"))).cleanup_left, ["JOURNAL_LIST"]);
  assert.deepEqual([steps, (await journalOf()).corpus_id], [ORDER, null]);
  assert.deepEqual((await recorded(failing("EIO", "sync trial folder"))).cleanup_left, ["JOURNAL_LIST"]);
  assert.equal(Object.hasOwn(await recorded(), "cleanup_left"), false);
  assert.deepEqual(steps, ORDER);
  await absent(folder);
  // The folder, whose sync fails: it's gone, but not for certain either.
  for (const code of ["EIO", "ENOSPC", "EACCES"]) {
    await made();
    const left = await recorded(failing(code));
    assert.deepEqual([left.cleanup_left, steps], [["JOURNAL_FOLDER"], ORDER], code);
    await absent(folder);
    assert.equal(Object.hasOwn(await recorded(), "cleanup_left"), false, code);
    assert.deepEqual(steps, ORDER, code);
  }
  // A filesystem that can't sync a folder at all is let through, as for the client list.
  for (const code of ["EINVAL", "ENOTSUP", "EOPNOTSUPP"]) {
    await made();
    assert.equal(Object.hasOwn(await recorded(failing(code)), "cleanup_left"), false, code);
    await absent(folder);
  }
  // While the vault can't finish, the list keeps the server case, and is synced all the same: when the copy is taken off it, and when an
  // earlier Delete that got no further had done that. One that finishes lets go of the server case too.
  const unfinished = deleting(trial, (source) => ({ ...source, deletePrivateCase: async (...args) => { await source.deletePrivateCase(...args); throw Object.assign(new Error("Synthetic words."), { code: "SYNTHETIC_VAULT_ERROR" }); } }));
  const list = await readRunnerClients(home);
  list.clients[0].journal = tied;
  await writeRunnerClients(home, list);
  for (const [syncing, codes] of [[failing("EIO", "sync trial folder"), ["VAULT_CLEANUP", "JOURNAL_LIST"]], [failing("EIO", "sync trial folder"), ["VAULT_CLEANUP", "JOURNAL_LIST"]], [undefined, ["VAULT_CLEANUP"]]]) {
    assert.deepEqual((await recorded(syncing, unfinished)).cleanup_left, codes);
    assert.deepEqual([steps, await journalOf()], [ORDER, { ...tied, corpus_id: null }]);
  }
  assert.equal(Object.hasOwn(await recorded(), "cleanup_left"), false);
  assert.deepEqual([steps, await journalOf()], [ORDER, { corpus_id: null, consent: tied.consent }]);
  // No client of the trial has had a journal folder: nothing to remove or sync, and nothing to tell.
  const fresh = await trialWith(t);
  await absent(path.join(fresh.home, "journal"));
  assert.equal(Object.hasOwn(await deleting(fresh)(fresh.cases[0]), "cleanup_left"), false);
});

test("the trial folder's lock on release: gone already is quiet, one that can't be looked at or removed is told (by Delete, by a command), another holder's stays, and what stopped the work is told with it, never hidden by it", async (t) => {
  const trial = await copiedClient(t, { clients: 2 });
  const { home, cases: [clientOne, clientTwo] } = trial;
  const lock = path.join(home, ".trial-folder.lock");
  const held = async () => (await fs.readFile(lock, "utf8")).startsWith(`${process.pid} `);
  const refuse = (code) => Object.assign(new Error("Synthetic words."), { code });
  const leftLock = `A runner-trial command ended without finishing and left its lock. If no other runner-trial command is running, remove ${lock} and try again.`;
  const leftToo = `The trial folder's lock was left; once no runner-trial command runs, remove ${lock} by hand.`;
  // `during`, with the module's own calls on the lock file made through these (the methods of node:fs/promises that it calls): the look at
  // it (`looking`, before it), its removal (`removing`, before it) and its handle's calls (`handled`, before each, by name).
  const meanwhile = async ({ looking = () => {}, removing = () => {}, handled = () => {} }, during) => {
    const { lstat, open, rm } = fs;
    const mocked = [
      t.mock.method(fs, "lstat", async (where, ...args) => { if (where === lock) await looking(); return lstat.call(fs, where, ...args); }),
      t.mock.method(fs, "rm", async (where, ...args) => { if (where === lock) await removing(); return rm.call(fs, where, ...args); }),
      t.mock.method(fs, "open", async (where, ...args) => {
        const handle = await open.call(fs, where, ...args);
        if (where !== lock) return handle;
        return Object.assign(Object.create(handle), Object.fromEntries(["writeFile", "sync", "close"].map((name) => [name, async (...values) => { await handled(name); return handle[name](...values); }])));
      })
    ];
    try { return await during(); } finally { for (const each of mocked) each.mock.restore(); }
  };
  const failingWith = (code) => () => { throw refuse(code); };

  // Looked at and removed while it's still open, so that its identity can't be another file's by then; then closed, also after a failure.
  const steps = [];
  const recorded = { looking: () => { steps.push("look"); }, removing: () => { steps.push("remove"); }, handled: (name) => { steps.push(name); } };
  await meanwhile(recorded, async () => (await acquireFolderLock(home)).release());
  assert.deepEqual(steps, ["writeFile", "sync", "look", "remove", "close"]);
  await absent(lock);
  for (const [failing, codes] of [["looking", ["EACCES", "EIO"]], ["removing", ["EACCES", "EPERM"]]]) {
    for (const code of codes) {
      steps.length = 0;
      await meanwhile({ ...recorded, [failing]: failingWith(code) }, async () => {
        const taken = await acquireFolderLock(home);
        await assert.rejects(taken.release(), { code }, `${failing} ${code}`);
      });
      assert.equal(steps.at(-1), "close");
      assert.equal(await held(), true, "the lock is still there");
      // Every command is refused meanwhile: this process, which left it, still runs.
      await assert.rejects(setJournalConsent({ home, number: 1, action: "confirm", lockWaitMs: 20 }), /Another runner-trial command is changing the trial folder/u);
      await fs.unlink(lock);
    }
  }
  // Removed by hand meanwhile: quiet, and it can be taken again.
  const byHand = await acquireFolderLock(home);
  await fs.unlink(lock);
  await byHand.release();
  // Another holder's by then: it stays.
  const lost = await acquireFolderLock(home);
  await fs.unlink(lock);
  const another = await acquireFolderLock(home);
  await lost.release();
  assert.equal(await held(), true);
  await another.release();
  await absent(lock);

  // A lock whose first write fails is removed again, and what failed is what's told, also when it can't be removed.
  for (const [failing, code] of [["writeFile", "ENOSPC"], ["sync", "EIO"]]) {
    const handled = (name) => { if (name === failing) throw refuse(code); };
    await meanwhile({ handled }, () => assert.rejects(acquireFolderLock(home), { code }));
    await absent(lock);
    for (const left of ["looking", "removing"]) {
      await meanwhile({ handled, [left]: failingWith("EACCES") }, () => assert.rejects(acquireFolderLock(home), { code }, left));
      await fs.unlink(lock);
    }
  }

  // Delete names a lock it can't look at, as one it can't remove; the rest is done. (It's removed by hand then, and Delete again is quiet.)
  const deleteCase = deleting(trial);
  for (const code of ["EACCES", "EIO"]) {
    await ensureJournalCopyKey({ home, number: 1 });
    const deleted = await meanwhile({ looking: failingWith(code) }, () => deleteCase(clientOne));
    assert.deepEqual(deleted.cleanup_left, ["FOLDER_LOCK"], code);
    assert.equal(await held(), true, code);
    await absent(clientJournalFolder(home, clientOne));
    assert.equal((await readRunnerClients(home)).clients[0].journal.corpus_id, null);
    await fs.unlink(lock);
    assert.equal(Object.hasOwn(await deleteCase(clientOne), "cleanup_left"), false);
    await absent(lock);
  }

  // A command that has done its work and can't look at its lock, or remove it, says that a lock was left, and which file; its work stands.
  for (const [failing, action, state] of [["looking", "withdraw", "withdrawn"], ["removing", "confirm", "confirmed"]]) {
    await meanwhile({ [failing]: failingWith("EACCES") }, () => assert.rejects(setJournalConsent({ home, number: 1, action }), { message: leftLock, exitCode: 1 }));
    assert.equal(await held(), true);
    await fs.unlink(lock);
    assert.deepEqual(await setJournalConsent({ home, number: 1, action }), { changed: false, state });
  }
  const printed = [];
  const add = (text) => { printed.push(String(text)); };
  assert.equal(await meanwhile({ looking: failingWith("EIO") }, () => runMain(["--copy-key", "--dir", home], { log: add, logError: add, askQuestion: async () => "1" })), 1);
  assert.equal(printed.at(-1), leftLock);
  await fs.unlink(lock);
  // One that was stopped is told by what stopped it, as it is; when it can't let go of its lock either, that error names the lock it left
  // (in one property, fixed and not enumerable), and only then.
  const adding = () => addClient({ home, label: "Synthetic client 1" });
  const stoppedWith = (left) => (error) => {
    assert.ok(error instanceof StartError);
    assert.deepEqual([error.message, error.exitCode, Object.getOwnPropertyDescriptor(error, "folderLockLeft")], ["Another client already has that label; choose another.", 1, left]);
    return true;
  };
  for (const failing of ["looking", "removing"]) {
    await meanwhile({ [failing]: failingWith("EACCES") }, () => assert.rejects(adding(), stoppedWith({ value: lock, writable: false, enumerable: false, configurable: false })));
    assert.equal(await held(), true);
    await fs.unlink(lock);
  }
  await assert.rejects(adding(), stoppedWith(undefined));
  await absent(lock);
  // Whatever stopped the operation is what's thrown, the very same: an Error of any class takes that property, and nothing else of it
  // changes; one that can't take it, and anything that isn't an Error, is thrown as it is.
  const thrownBy = (stop, during) => meanwhile(during, () => withFolderLock(home, async () => { throw stop; }).then(() => assert.fail("the operation was stopped"), (thrown) => thrown));
  for (const [stop, named] of [[new TypeError("Synthetic words."), true], [new ProviderError("Synthetic words.", { code: "TIMEOUT" }), true], [refuse("EIO"), true],
    [Object.freeze(refuse("EIO")), false], ["Synthetic words.", false], [{ message: "Synthetic words." }, false], [null, false], [undefined, false]]) {
    const asItIs = () => (stop instanceof Error ? [Object.getPrototypeOf(stop), stop.name, stop.message, stop.code, stop.stack, Object.keys(stop)] : structuredClone(stop));
    const before = asItIs();
    assert.equal(await thrownBy(stop, {}), stop);
    assert.equal(stop?.folderLockLeft, undefined);
    await absent(lock);
    assert.equal(await thrownBy(stop, { removing: failingWith("EACCES") }), stop);
    assert.equal(stop?.folderLockLeft, named ? lock : undefined);
    assert.deepEqual(asItIs(), before);
    assert.equal(await held(), true);
    await fs.unlink(lock);
  }
  // As the terminal prints it: the error's own message (a refusal's, or an unexpected error's code alone), then the lock left in one fixed
  // line; with the lock let go, the message alone.
  const told = async (number, during) => {
    const lines = [];
    assert.equal(await meanwhile(during, () => runMain(["--copy-key", "--dir", home], { log: () => {}, logError: (text) => { lines.push(String(text)); }, askQuestion: async () => number })), 1);
    return lines;
  };
  const { mkdir } = fs;
  const unmade = t.mock.method(fs, "mkdir", async (where, ...args) => { if (where === clientJournalFolder(home, clientTwo)) throw refuse("EIO"); return mkdir.call(fs, where, ...args); });
  for (const [number, message] of [["9", "There's no client with that number."], ["2", "The journal command failed: EIO."]]) {
    for (const failing of ["looking", "removing"]) {
      assert.deepEqual(await told(number, { [failing]: failingWith("EACCES") }), [message, leftToo]);
      assert.equal(await held(), true);
      await fs.unlink(lock);
    }
    assert.deepEqual(await told(number, {}), [message]);
    await absent(lock);
  }
  unmade.mock.restore();
});

test("a start that can't let go of the trial folder's lock once its server answers stops that server and says why, and what stops a start is told all the same, and then that the lock was left", async (t) => {
  const { home } = await trialWith(t, 0);
  const lock = path.join(home, ".trial-folder.lock");
  const script = new URL("../scripts/runner-trial-start.mjs", import.meta.url);
  // The start script whole, in a process of its own that reaches nothing outside the trial folder: no git is found, the port is asked of
  // nobody, the server is a stand-in that answers at once and ends when it's told to, and the lock can't be looked at (with `lockFails` off,
  // it can).
  const starting = (port, { lockFails = true } = {}) => {
    const standIns = `
      import childProcess from "node:child_process";
      import { EventEmitter } from "node:events";
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      import net from "node:net";
      const { lstat } = fs;
      fs.lstat = async (where, ...args) => {
        if (${JSON.stringify(lockFails)} && where === ${JSON.stringify(lock)}) throw Object.assign(new Error("Synthetic words about the lock."), { code: "EACCES" });
        return lstat.call(fs, where, ...args);
      };
      net.createServer = () => ({ once(event, then) { if (event === "error" && ${JSON.stringify(port)} === "taken") setImmediate(then); }, listen(...args) { if (${JSON.stringify(port)} === "free") setImmediate(args.at(-1)); }, close(then) { then(); } });
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ runnerTrial: "on" }) });
      childProcess.spawn = () => {
        const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill(signal) {
          process.stdout.write("stopped with " + signal + "\\n");
          child.signalCode = signal;
          setImmediate(() => child.emit("exit", null, signal));
        } });
        return child;
      };
      syncBuiltinESMExports();`;
    const { status, signal, stdout, stderr } = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(standIns)}`, fileURLToPath(script), "--provider", "codex", "--dir", home],
      { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", env: { PATH: path.join(home, "no-programs"), HOME: home, CODEX_COMMAND: process.execPath } });
    assert.equal(signal, null, stderr);
    return { status, stdout, stderr: stderr.trim() };
  };
  const stopped = starting("free");
  assert.deepEqual([stopped.status, stopped.stderr], [1, "The runner trial couldn't start: Synthetic words about the lock."], stopped.stdout);
  assert.ok(stopped.stdout.endsWith("stopped with SIGTERM\n"), stopped.stdout);
  assert.match(stopped.stdout, /No local origin\/stable ref: using rules from this checkout/u);
  assert.equal(/Runner trial ready/u.test(stopped.stdout), false);
  await fs.unlink(lock);
  const inUse = "Port 8797 on 127.0.0.1 is in use: is the trial already running? Stop it, or start with --port and another number (the page then starts with a new case).";
  for (const [lockFails, said] of [[true, [inUse, `The trial folder's lock was left; once no runner-trial command runs, remove ${lock} by hand.`]], [false, [inUse]]]) {
    const taken = starting("taken", { lockFails });
    assert.deepEqual([taken.status, taken.stderr.split("\n")], [1, said]);
    assert.equal(/stopped with/u.test(taken.stdout), false, "no server was started");
    if (lockFails) await fs.unlink(lock);
    await absent(lock);
  }
});

test("a cold test that starts removes the copy's receipt and only a pass gives a new one: an error, a wrong or malformed answer, a file too small to pass, a judge's no, a failed judge leave none", async (t) => {
  const { home, cases: [clientOne], imported, outside, receiptPath, coldTest, sealedPath } = await copiedClient(t);
  const pass = async () => {
    assert.equal((await coldTest(using())).passed, true);
    assert.equal((await readColdTestReceipt(home, clientOne)).corpus_id, imported.corpus_id);
  };
  // Through the real port and the stand-in workers: the consumer's call and the judge's for each question in turn.
  const replying = (reply, options = {}) => using(standIns({ reply, ...options }));
  // From a call on, so that making it again doesn't help.
  const failingFrom = (at, error) => replying(async (count, request, usual) => { if (count >= at) throw error; return usual(); });
  const answeringFrom = (at, change) => replying(async (count, request, usual) => (count >= at ? change(await usual()) : usual()));
  const miss = (usual) => ({ ...usual, answerability: "not_found", evidence_ids: [] });
  const stopped = (code) => (error) => error.code === code;
  for (const [what, options, code] of [
    ["a later call that timed out", failingFrom(5, timedOut()), "TIMEOUT"],
    ["a missed first answer, then a call that timed out", replying(async (count, request, usual) => { if (count > 1) throw timedOut(); return miss(await usual()); }), "TIMEOUT"],
    ["a malformed answer, as the worker reports it", failingFrom(3, new ProviderError("A synthetic malformed answer.", { code: "PROVIDER_MALFORMED" })), "PROVIDER_MALFORMED"],
    ["a plan limit, at once", failingFrom(5, new ProviderError("A synthetic plan limit.", { code: "PLAN_LIMIT" })), "PLAN_LIMIT"],
    ["an answer outside its schema", answeringFrom(5, () => ({ answer: ANSWER })), "COLD_CONSUMER_ANSWER_INVALID"],
    ["an answer to another question", answeringFrom(5, (usual) => ({ ...usual, question_id: "question-1" })), "COLD_CONSUMER_ANSWER_INVALID"],
    ["a judge's call that timed out", failingFrom(2, timedOut()), "TIMEOUT"],
    ["a judge's call that timed out, of a question the journal doesn't answer", failingFrom(CALLS, timedOut()), "TIMEOUT"],
    ["a judge's second call that timed out", replying(async (count, request, usual) => { if (count >= 3) throw timedOut(); return { ...(await usual()), ...(count === 2 ? { verdict: "wrong" } : {}) }; }), "TIMEOUT"],
    ["a judge's answer outside its schema", answeringFrom(2, (usual) => ({ ...usual, verdict: "maybe" })), "COLD_JUDGE_ANSWER_INVALID"],
    ["no judge", { workerFor: (role) => (role === "W" ? standIns().workerFor(role) : null) }, "COLD_PORT_INVALID"]
  ]) {
    await pass();
    await assert.rejects(coldTest(options), stopped(code), what);
    await absent(receiptPath, what);
  }
  const small = path.join(outside, "small-questions.json");
  await fs.writeFile(small, JSON.stringify(withQuestions(QUESTIONS.questions.slice(1))), { mode: 0o600 });
  // Three wrong answers are more than one in thirty of the sixty that count.
  const numbered = (packet) => Number(packet.question_id.slice("question-".length));
  const consuming = (change) => replying(async (count, request, usual) => { const value = await usual(); return !isJudge(request) && numbered(value) <= 3 ? change(value) : value; });
  const judging = (wrong) => using(standIns({ verdict: (packet) => (wrong(numbered(packet)) ? "wrong" : "right") }));
  for (const [what, options, notMet] of [
    ["answers that cite what they weren't given", consuming((usual) => ({ ...usual, evidence_ids: ["src:journal:9"] })), ["wrong_answers"]],
    ["answers declared supported that cite nothing", consuming((usual) => ({ ...usual, evidence_ids: [] })), ["wrong_answers"]],
    ["a judge that finds answers wrong", judging((n) => n <= 3), ["wrong_answers"]],
    ["a judge that finds answers invented, to false premises", judging((n) => n >= 41 && n <= 43), ["wrong_answers"]],
    ["a judge that finds an answer invented, about an absent thing too", judging((n) => n >= 59), ["wrong_answers"]],
    ["a judge that misses planted wrong answers", using(standIns({ planted: (packet) => (numbered(packet) <= 5 ? "right" : "wrong") })), ["judge_missed"]],
    ["too few right", using(standIns({ verdict: (packet) => (numbered(packet) <= 14 ? "incomplete" : "right") })), ["too_few_right"]],
    ["a file too small to pass, every answer right", { ...using(), questionsPath: small }, ["too_few_questions", "too_few_planted"]]
  ]) {
    await pass();
    const result = await coldTest(options);
    assert.deepEqual([result.passed, result.newerStarted, result.report.not_met], [false, false, notMet], what);
    await absent(receiptPath, what);
  }
  // Gone before the first packet leaves, whatever copy it names.
  await pass();
  let checked = 0;
  assert.equal((await coldTest(using(standIns({ prepare: async () => { checked += 1; await absent(receiptPath, "before any packet leaves"); } })))).passed, true);
  assert.equal(checked, CALLS);
  await fs.writeFile(receiptPath, JSON.stringify({ ...(await readColdTestReceipt(home, clientOne)), corpus_id: "another-copy" }), { mode: 0o600 });
  await assert.rejects(coldTest(failingFrom(1, timedOut())), { code: "TIMEOUT" });
  await absent(receiptPath, "a receipt of another copy too");
  // One that's there all the same when the test started last doesn't pass (put there here) goes as well, whatever copy it names.
  await pass();
  const earlier = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  for (const planted of [earlier, { ...earlier, corpus_id: "another-copy" }]) {
    const plant = () => fs.writeFile(receiptPath, JSON.stringify(planted), { mode: 0o600 });
    for (const options of [
      replying(async (count, request, usual) => { if (count < 3) return usual(); await plant(); throw timedOut(); }),
      replying(async (count, request, usual) => { if (count === 3) await plant(); return usual(); }, { planted: () => "right" })
    ]) {
      await coldTest(options).then((result) => assert.deepEqual([result.passed, result.newerStarted], [false, false]), (error) => assert.equal(error.code, "TIMEOUT"));
      await absent(receiptPath, "a receipt put there meanwhile");
    }
  }
  // A test refused before it starts (no consent) leaves the receipt as it is: the gate is closed by the withdrawal itself.
  await pass();
  const receipt = await fs.readFile(receiptPath, "utf8");
  await setJournalConsent({ home, number: 1, action: "withdraw" });
  const unused = standIns();
  await assert.rejects(coldTest(using(unused)), /no confirmed journal consent/u);
  assert.equal(await fs.readFile(receiptPath, "utf8"), receipt);
  assert.equal(unused.sent.length, 0);
  assert.equal(/decides nothing/u.test(USAGE), false);
  assert.match(USAGE, /A test that starts removes the copy's receipt; only a pass gives a new one/u);
  assert.match(USAGE, /--cold-test FILE --provider mixed\|claude\|codex/u);
  assert.match(USAGE, /excerpts of the client's journal to the companies running those workers \(with --provider mixed,\s+Anthropic and OpenAI; claude, Anthropic; codex, OpenAI\)/u);
  for (const said of [/at least 40 questions the journal answers \(in words of its passages\), 20 it doesn't \(and the\s+search returns something for\) and 20 planted wrong answers/u, /the judge catches at least 4 of every 5 of those,\s+and 1 of every 2 of each kind;/u,
    /at most 1 answer is wrong, to any question, for every 30 judged to questions of\s+those two sorts; at least 2 of every 3 of each sort are right; at most 1 question in 10 is left out \(a search\s+slower than a reply waits, a refusal by Claude; one by GPT would most likely come as a malformed answer, be\s+asked twice more and then stop the test\);/u,
    /The file says who wrote it \(anthropic, openai or person\): not the company whose model judges\./u]) assert.match(USAGE, said);
  // Questions by the company whose model judges are refused before anything: no call, and the receipt stays as it is.
  await setJournalConsent({ home, number: 1, action: "confirm" });
  const byOther = path.join(outside, "by-a-company.json");
  for (const [author, provider, company] of [["anthropic", "mixed", "Anthropic"], ["anthropic", "claude", "Anthropic"], ["openai", "codex", "OpenAI"]]) {
    await fs.writeFile(byOther, JSON.stringify({ ...QUESTIONS, author }), { mode: 0o600 });
    const asked = standIns();
    await assert.rejects(coldTest({ ...using(asked), provider, questionsPath: byOther }), { message: `The questions file says that a model of ${company}'s wrote it, and one of ${company}'s judges the answers with this --provider: choose another, or use questions another company's model or a person wrote. Nothing was changed.` });
    assert.deepEqual([asked.sent.length, await fs.readFile(receiptPath, "utf8")], [0, receipt]);
  }
  for (const [author, provider] of [["openai", "mixed"], ["openai", "claude"], ["anthropic", "codex"], ["person", "mixed"]]) {
    await fs.writeFile(byOther, JSON.stringify({ ...QUESTIONS, author }), { mode: 0o600 });
    assert.equal((await coldTest({ ...using(), provider, questionsPath: byOther })).report.author, author, `${author} ${provider}`);
  }
  // Which of the tests started on this copy it was, whatever became of them; the count begins anew with an import.
  await fs.writeFile(byOther, JSON.stringify(QUESTIONS), { mode: 0o600 });
  const runs = async () => (await coldTest({ ...using(), questionsPath: byOther })).report.run;
  const counted = await runs();
  await assert.rejects(coldTest(failingFrom(1, timedOut())), { code: "TIMEOUT" });
  assert.deepEqual([await runs(), JSON.parse(await fs.readFile(receiptPath, "utf8")).run], [counted + 2, counted + 2]);
  await importClientJournal({ home, number: 1, sealedPath });
  assert.equal(await runs(), 1);
});

test("the cold test's workers are the trial's writer's for the consumer and its checker's for the judge, with each provider choice: GPT's answers judged by Claude with mixed, both one company's otherwise", async (t) => {
  const { outside, coldTest } = await copiedClient(t);
  const small = path.join(outside, "two-questions.json");
  await fs.writeFile(small, JSON.stringify(withQuestions([QUESTIONS.questions[39], QUESTIONS.questions.at(-1)])), { mode: 0o600 });
  // Stand-ins for the two companies' command lines: each writes down how it was called and answers as a consumer or a judge, by its packet.
  const calls = path.join(outside, "calls.jsonl");
  const program = async (name, body) => {
    const file = path.join(outside, name);
    await fs.writeFile(file, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--help")) { process.stdout.write("--print --model --effort --output-format --json-schema --tools --max-turns --no-session-persistence --permission-mode --no-chrome --safe-mode --strict-mcp-config --system-prompt-file --ephemeral --json --sandbox --skip-git-repo-check --config --output-schema --ignore-user-config --ignore-rules\\n"); process.exit(0); }
const packet = JSON.parse(fs.readFileSync(0, "utf8"));
const after = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const judge = Object.hasOwn(packet, "answerable");
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name: ${JSON.stringify(name)}, judge, model: after("--model"), effort: after("--effort") ?? args.find((arg) => arg.startsWith("model_reasoning_effort=")) ?? null, config: process.env.CLAUDE_CONFIG_DIR ?? null }) + "\\n");
const answer = judge ? { question_id: packet.question_id, verdict: "right", reason: "Synthetic." } : { question_id: packet.question_id, answerability: packet.passages.length ? "supported" : "not_found", answer: "A synthetic answer.", evidence_ids: packet.passages.map(({ id }) => id) };
${body}
`, { mode: 0o700 });
    return file;
  };
  const environment = { PATH: process.env.PATH, HOME: outside, CODEX_HOME: path.join(outside, "codex-home"), INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR: path.join(outside, "claude-sign-in"),
    CLAUDE_COMMAND: await program("claude", `process.stdout.write(JSON.stringify({ result: "", structured_output: answer, session_id: "synthetic" }));`),
    CODEX_COMMAND: await program("codex", `for (const event of [{ type: "thread.started", thread_id: "synthetic" }, { type: "item.completed", item: { id: "item-1", type: "agent_message", text: JSON.stringify(answer) } }, { type: "turn.completed" }]) process.stdout.write(JSON.stringify(event) + "\\n");`) };
  const claude = { name: "claude", model: "claude-opus-5-5", config: environment.INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR }, codex = { name: "codex", model: null, config: null };
  const writer = { judge: false }, checker = { judge: true };
  for (const [provider, consumer, judge] of [["mixed", codex, claude], ["claude", claude, claude], ["codex", codex, codex]]) {
    await fs.rm(calls, { force: true });
    const { report } = await coldTest({ questionsPath: small, provider, environment });
    assert.deepEqual([report.not_met, report.by_question.map(({ result }) => result)], [["too_few_questions", "too_few_planted", "too_few_right"], ["right", "right"]], provider);
    // The writer's effort for the consumer, the checker's for the judge, as the trial's settings have them.
    const effort = ({ name }, level) => (name === "claude" ? level : `model_reasoning_effort="${level}"`);
    const call = [{ ...consumer, ...writer, effort: effort(consumer, "medium") }, { ...judge, ...checker, effort: effort(judge, "low") }];
    const made = (await fs.readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(made, [...call, ...call].map(({ name, judge: judging, model, effort: level, config }) => ({ name, judge: judging, model, effort: level, config })), provider);
  }
  // Claude's sign-in folder is asked for where Claude is one of the two.
  const relative = { ...environment, INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR: "claude-sign-in" };
  for (const provider of ["mixed", "claude"]) await assert.rejects(coldTest({ questionsPath: small, provider, environment: relative }), /INNER_SIGNAL_RUNNER_CLAUDE_CONFIG_DIR must be an absolute path/u);
  await coldTest({ questionsPath: small, provider: "codex", environment: relative });
});

test("of cold tests of one copy that overlap, the one started last decides: an earlier one gives no receipt and takes none away, also when the newer one never ends", async (t) => {
  const { home, cases: [clientOne], receiptPath, coldTest, questionsPath, outside, server, sealedPath } = await copiedClient(t);
  const markerPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_ATTEMPT_FILE);
  const attempt = () => readColdTestAttempt(home, clientOne);
  const receipt = () => fs.readFile(receiptPath, "utf8");
  const pass = async () => {
    assert.equal((await coldTest(using())).passed, true);
    return receipt();
  };
  const newer = { message: "A newer cold test of this copy has started, and that one decides: this one gave no receipt. If no other is running, run it again." };
  const changed = { message: "The client's consent or copy changed during the cold test: it stopped, and gave no receipt." };
  const unmarked = { message: "The marker of this cold test's start is gone or can't be read: it gave no receipt. Run it again." };
  // A test whose third call waits until `during` is done; it passes unless `answer` changes an answer of the worker's, by its count.
  const meanwhile = (during, answer = (usual) => usual) => using(standIns({ reply: async (count, request, usual) => {
    if (count === 3) await during();
    return answer(await usual(), count, request);
  } }));
  // Every answer cites what it wasn't given.
  const wrong = (usual, count, request) => (isJudge(request) ? usual : { ...usual, evidence_ids: ["src:journal:9"] });

  // One after the other: each marks its own start, and the second gives a receipt as the first did.
  await pass();
  const first = await attempt();
  await pass();
  assert.notEqual(await attempt(), first);
  assert.equal(await modeOf(markerPath), 0o600);

  // A starts (which removes the receipt), B starts while A runs, and A passes while B is still running: no receipt. B then passes, and has
  // its receipt.
  const bStarted = Promise.withResolvers(), bGoesOn = Promise.withResolvers();
  let b = null, marked = null;
  const a = coldTest(meanwhile(async () => {
    await absent(receiptPath, "A's start removed it");
    b = coldTest(using(standIns({ prepare: async (count) => { if (count === 1) { bStarted.resolve(); await bGoesOn.promise; } } })));
    await bStarted.promise;
    marked = await attempt();
  }));
  await assert.rejects(a, newer);
  await absent(receiptPath, "A passed, and gave none");
  assert.equal(await attempt(), marked, "the marker is B's still");
  bGoesOn.resolve();
  assert.equal((await b).passed, true);
  assert.equal((await readColdTestReceipt(home, clientOne)).result, "pass");
  assert.equal(await attempt(), marked);

  // B passes while A runs: however A then ends, B's receipt stays as it is.
  for (const [what, answer, ended] of [
    ["a pass", (usual) => usual, newer],
    ["a call that timed out", (usual, count) => { if (count >= 5) throw timedOut(); return usual; }, { code: "TIMEOUT" }],
    ["a judge's call that timed out", (usual, count) => { if (count >= CALLS) throw timedOut(); return usual; }, { code: "TIMEOUT" }],
    ["an answer outside its schema", (usual, count) => (count >= 5 ? { answer: ANSWER } : usual), { code: "COLD_CONSUMER_ANSWER_INVALID" }],
    ["a wrong answer", wrong, null],
    ["a judge's no", (usual, count, request) => (isJudge(request) ? { ...usual, verdict: "incomplete" } : usual), null]
  ]) {
    let given = null;
    const ending = coldTest(meanwhile(async () => { given = await pass(); }, answer));
    if (ended) await assert.rejects(ending, ended, what);
    else {
      const result = await ending;
      assert.deepEqual([result.passed, result.newerStarted], [false, true], what);
    }
    assert.equal(await receipt(), given, what);
  }
  // A withdrawal, which stops A at its next packet, too: the gate is closed by the withdrawal itself.
  let given = null;
  await assert.rejects(coldTest(meanwhile(async () => { given = await pass(); await setJournalConsent({ home, number: 1, action: "withdraw" }); })), changed);
  assert.equal(await receipt(), given);
  await setJournalConsent({ home, number: 1, action: "confirm" });

  // B starts and fails, or is killed, while A runs: A passes and gives none, though B never will.
  await assert.rejects(coldTest(meanwhile(() => assert.rejects(coldTest(using(standIns({ reply: async () => { throw timedOut(); } }))), { code: "TIMEOUT" }))), newer);
  await absent(receiptPath);
  const killed = () => {
    const { signal, stdout, stderr } = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { runClientColdTest } from ${JSON.stringify(new URL("../scripts/runner-trial-journal.mjs", import.meta.url).href)};
      const [home, questionsPath] = process.argv.slice(1);
      await runClientColdTest({ home, number: 1, questionsPath, provider: "mixed", workerFor: () => ({ async call(request) {
        await request.beforeSend();
        process.stdout.write("started");
        process.kill(process.pid, "SIGKILL");
        await new Promise(() => {});
      } }) });`, home, questionsPath], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
    assert.deepEqual([signal, stdout], ["SIGKILL", "started"], stderr);
  };
  await pass();
  const before = await attempt();
  killed();
  await absent(receiptPath, "killed after its start, with the receipt gone");
  assert.notEqual(await attempt(), before);
  await assert.rejects(coldTest(meanwhile(async () => { killed(); })), newer);
  await absent(receiptPath, "and it stays gone");
  await pass();

  // A test refused before it starts hasn't started: the running one's pass counts.
  const loose = path.join(outside, "loose-questions.json");
  await fs.writeFile(loose, JSON.stringify(QUESTIONS), { mode: 0o644 });
  assert.equal((await coldTest(meanwhile(() => assert.rejects(coldTest({ ...using(), questionsPath: loose }), /readable by you alone/u)))).passed, true);
  await receipt();
  // Nor has one whose start can't be marked: it sends nothing. The receipt is gone by then.
  const rename = fs.rename;
  const unwritable = t.mock.method(fs, "rename", async (from, to) => {
    if (to === markerPath) throw Object.assign(new Error("Synthetic words."), { code: "EIO" });
    return rename.call(fs, from, to);
  });
  const unsent = standIns();
  await assert.rejects(coldTest(using(unsent)), { code: "EIO" });
  unwritable.mock.restore();
  assert.equal(unsent.sent.length, 0);
  await absent(receiptPath);

  // The marker is read for a pass under the folder's lock, which a start takes too: none can come between that reading and the receipt.
  const probe = await fs.open(questionsPath, "r");
  const handles = Object.getPrototypeOf(probe);
  await probe.close();
  const readFile = handles.readFile;
  let armed = false, between = null;
  const reading = t.mock.method(handles, "readFile", async function read(...args) {
    const text = await readFile.apply(this, args);
    if (armed && typeof text === "string" && text.includes('"attempt"')) {
      armed = false;
      between = await coldTest({ ...using(), lockWaitMs: 0 }).then(() => "started", (error) => error.message);
    }
    return text;
  });
  assert.equal((await coldTest(using(standIns({ reply: async (count, request, usual) => { armed = count === CALLS; return usual(); } })))).passed, true);
  reading.mock.restore();
  assert.match(between, /Another runner-trial command is changing the trial folder/u);
  await receipt();

  // A marker that's gone or isn't a private file of its form when a test passes: no receipt.
  for (const change of [() => fs.unlink(markerPath), () => fs.chmod(markerPath, 0o644), () => fs.writeFile(markerPath, "not JSON")]) {
    await assert.rejects(coldTest(meanwhile(change)), unmarked);
    await absent(receiptPath);
  }
  // Another copy imported, and the first one again: a test that ran all along has lost its marker with them.
  const other = path.join(outside, "other.sealed.json");
  await writeSealedJournalCopy(other, await server.exportFor((await ensureJournalCopyKey({ home, number: 1 })).publicKey, "2026-11-24T08:30:00.000Z"));
  await assert.rejects(coldTest(meanwhile(async () => {
    await importClientJournal({ home, number: 1, sealedPath: other });
    await absent(markerPath);
    await importClientJournal({ home, number: 1, sealedPath });
  })), unmarked);
  await absent(receiptPath);
  await pass();
});

test("the consent is read under the trial folder's lock right before each packet is handed over: a withdrawal before it stops the test before that packet, one after it at the next", async (t) => {
  const { home, receiptPath, coldTest, server, outside } = await copiedClient(t);
  const withdraw = (options = {}) => setJournalConsent({ home, number: 1, action: "withdraw", ...options });
  const confirm = () => setJournalConsent({ home, number: 1, action: "confirm" });
  const changed = /consent or copy changed during the cold test: it stopped, and gave no receipt/u;
  // Withdrawn while a packet is prepared, the consumer's (the first and a later one) and the judge's (the first, its second call for a wrong,
  // and the last): that packet doesn't leave.
  for (const [at, verdict] of [[1], [5], [2], [3, "wrong"], [CALLS]]) {
    const workers = standIns({ prepare: async (count) => { if (count === at) await withdraw(); }, ...(verdict ? { verdict: () => verdict } : {}) });
    await assert.rejects(coldTest(using(workers)), changed, `packet ${at}`);
    assert.equal(workers.sent.length, at - 1, `packet ${at}`);
    if (verdict) assert.deepEqual(workers.sent.map(({ role }) => role), ["W", "CW"], "the judge's second call is the third packet");
    await absent(receiptPath);
    await confirm();
  }
  // The reading is made under the lock: while a command holds it, the packet doesn't leave.
  let held = null;
  const waiting = standIns({ prepare: async (count) => { if (count === 2) held = await acquireTrialFolderLock(home); } });
  try { await assert.rejects(coldTest({ ...using(waiting), lockWaitMs: 60 }), /Another runner-trial command is changing the trial folder/u); } finally { await held?.release(); }
  assert.equal(waiting.sent.length, 1);
  await absent(receiptPath);
  // A withdrawal tried while the list is being read for a packet (its text read, not checked yet) can't come between: one that won't wait
  // is refused, and one that waits is recorded right after the reading. That packet leaves, and the next doesn't.
  const probe = await fs.open(path.join(home, RUNNER_CLIENTS_FILE), "r");
  const handles = Object.getPrototypeOf(probe);
  await probe.close();
  const readFile = handles.readFile;
  let armed = false, during = null;
  const mocked = t.mock.method(handles, "readFile", async function read(...args) {
    const text = await readFile.apply(this, args);
    if (armed && typeof text === "string" && text.includes('"clients"')) {
      armed = false;
      during = { refused: await withdraw({ lockWaitMs: 0 }).then(() => null, (error) => error.message), waiting: withdraw({ lockWaitMs: 5_000 }) };
    }
    return text;
  });
  const between = standIns({
    prepare: async (count) => { armed = count === 2; },
    reply: async (count, request, usual) => {
      if (count === 2) assert.deepEqual(await during.waiting, { changed: true, state: "withdrawn" });
      return usual();
    }
  });
  await assert.rejects(coldTest(using(between)), changed);
  mocked.mock.restore();
  assert.match(during.refused, /Another runner-trial command is changing the trial folder/u);
  assert.equal(between.sent.length, 2);
  await absent(receiptPath);
  await confirm();
  // The lock isn't held during a call: a withdrawal while one runs is recorded at once, and stops the test at the next packet (the judge's
  // after a consumer's call, its second after a wrong, the next consumer's after a judge's), or, during the last call, before the receipt
  // is written.
  for (const [at, verdict] of [[1], [2], [2, "wrong"], [3, "wrong"], [CALLS]]) {
    const workers = standIns({ reply: async (count, request, usual) => {
      if (count === at) assert.deepEqual(await withdraw({ lockWaitMs: 0 }), { changed: true, state: "withdrawn" });
      return usual();
    }, ...(verdict ? { verdict: () => verdict } : {}) });
    await assert.rejects(coldTest(using(workers)), changed, `during call ${at}`);
    assert.equal(workers.sent.length, at, `during call ${at}`);
    await absent(receiptPath);
    await confirm();
  }
  // So does a new copy.
  const newer = path.join(outside, "newer.sealed.json");
  await writeSealedJournalCopy(newer, await server.exportFor((await ensureJournalCopyKey({ home, number: 1 })).publicKey, "2026-11-24T08:09:00.000Z"));
  const workers = standIns({ prepare: async (count) => { if (count === 3) await importClientJournal({ home, number: 1, sealedPath: newer }); } });
  await assert.rejects(coldTest(using(workers)), changed);
  assert.equal(workers.sent.length, 2);
  await absent(receiptPath);
  assert.equal((await coldTest(using())).passed, true, "and the new copy has its own test");
});

test("a Delete, also one that can't change the client list, and another publication stop a running cold test before its next packet: the copy is looked for in the vault itself, as it was when the test started", async (t) => {
  const changed = /consent or copy changed during the cold test: it stopped, and gave no receipt/u;
  // Made during a call: the consumer's (the judge's packet is next), the judge's (its planted answer's is next, or its second for a wrong).
  const meanwhile = async (act, at, options = {}) => {
    const trial = await copiedClient(t);
    const workers = standIns({ ...options, reply: async (count, request, usual) => { if (count === at) await act(trial); return usual(); } });
    await assert.rejects(trial.coldTest(using(workers)), changed, `call ${at}`);
    assert.equal(workers.sent.length, at, `call ${at}: no packet after it`);
    await absent(trial.receiptPath);
  };
  const deleteLeaving = (left) => async (trial) => {
    const { home, cases: [clientOne], imported } = trial;
    const list = path.join(home, RUNNER_CLIENTS_FILE), rename = fs.rename;
    const failing = t.mock.method(fs, "rename", async (from, to) => { if (to === list && left.length) throw Object.assign(new Error("Synthetic words."), { code: "EIO" }); return rename.call(fs, from, to); });
    try { assert.deepEqual((await deleting(trial)(clientOne)).cleanup_left ?? [], left); } finally { failing.mock.restore(); }
    await assert.rejects(trial.copier(clientOne).loadPrivateRuntimeCase(clientOne, { bearerToken: "synthetic" }), { code: "PRIVATE_CASE_NOT_FOUND" });
    // The list as the Delete left it: naming the copy, its consent confirmed, where it couldn't be written.
    const { corpus_id: listed, consent } = (await readRunnerClients(home)).clients[0].journal;
    assert.deepEqual([listed, consent.withdrawn_at], [left.length ? imported.corpus_id : null, null]);
  };
  for (const left of [[], ["JOURNAL_LIST"]]) {
    await meanwhile(deleteLeaving(left), 1);
    await meanwhile(deleteLeaving(left), 2);
    await meanwhile(deleteLeaving(left), 2, { verdict: () => "wrong" });
  }
  // The copy published anew (here a raised epoch, as a revoked passage raises it), with the list and the consent as they were.
  const raise = async ({ copier, cases: [clientOne], imported }) => {
    const { reference } = await copier(clientOne).inspectJournalCorpus(clientOne, imported.corpus_id, { requiredScope: "case:read", requiredPurpose: "session_use" }, { bearerToken: "synthetic" });
    await copier(clientOne).incrementJournalVisibilityEpoch(clientOne, { corpusId: imported.corpus_id, expectedEpoch: reference.visibility_epoch }, { bearerToken: "synthetic" });
  };
  await meanwhile(raise, 1);
  await meanwhile(raise, 2);
  // A vault that can't be read then: the packet doesn't leave either.
  const trial = await copiedClient(t);
  const vaultFile = path.join(trial.home, "vault", `${trial.cases[0]}.vault.json`);
  const workers = standIns({ reply: async (count, request, usual) => { if (count === 1) await fs.writeFile(vaultFile, "not a vault", { mode: 0o600 }); return usual(); } });
  await assert.rejects(trial.coldTest(using(workers)));
  assert.equal(workers.sent.length, 1);
  await absent(trial.receiptPath);
});

test("the commands print numbers and fixed texts only: no label, question id or journal text, and nothing that a file or an error holds", async (t) => {
  const { home, questionsPath, sealedPath, server, imported, cases: [clientOne] } = await copiedClient(t, { clients: 2 });
  const printed = async (argv, options = {}) => {
    const lines = [];
    const add = (text) => { lines.push(String(text)); };
    const code = await runMain([...argv, "--dir", home], { log: add, logError: add, askQuestion: async (question) => { add(question); return "1"; }, ...options });
    return { code, text: lines.join("\n") };
  };
  const coldTest = (options) => printed(["--cold-test", questionsPath, "--provider", "mixed"], options);
  const { reference } = await trialReference(home, clientOne, imported.corpus_id);

  // The cold test: ids that are somebody's names, and the report's numbers in their place.
  const named = withQuestions(QUESTIONS.questions.map((question, index) => ({ ...question, id: `Synthetic-${["Alba", "Bruno", "Chloe"][index % 3]}-${index}` })));
  await fs.writeFile(questionsPath, JSON.stringify(named), { mode: 0o600 });
  const hidden = ["Synthetic-", "Synthetic client", "Synthetic question", "colleague", "zebra", ANSWER, PLANTED, JUDGE_REASON, "q-", "question-", "src:journal", clientOne, imported.corpus_id, reference.active_generation, reference.manifest_object_id,
    ...server.sources.repr.split("\n").filter((line) => line.length > 8)];
  const passed = await coldTest(using());
  assert.equal(passed.code, 0, passed.text);
  const report = JSON.parse(passed.text.slice(passed.text.indexOf("{"), passed.text.lastIndexOf("}") + 1));
  assert.equal(report.snapshot, snapshotOf(reference));
  assert.deepEqual([report.passed, report.not_met, report.by_question.length], [true, [], 61]);
  assert.match(passed.text, /\nTests started on this copy so far: 1\.$/u);
  const failed = await coldTest(using(standIns({ reply: judged("wrong") })));
  assert.equal(failed.code, 1);
  assert.match(failed.text, /"wrong": 61,/u);
  assert.match(failed.text, /Not passed: client 1's copy has no cold-test receipt, so their journal stays out of their sessions\.\nTests started on this copy so far: 2\.$/u);
  const broken = await coldTest(using(standIns({ reply: async () => ({ answer: ANSWER }) })));
  assert.deepEqual([broken.code, broken.text.split("\n").at(-1)], [1, "The journal command failed: COLD_CONSUMER_ANSWER_INVALID."]);
  const malformedJudge = await coldTest(using(standIns({ reply: async (count, request, usual) => (isJudge(request) ? { ...(await usual()), reason: `${JUDGE_REASON}${"x".repeat(500)}` } : usual()) })));
  assert.deepEqual([malformedJudge.code, malformedJudge.text.split("\n").at(-1)], [1, "The journal command failed: COLD_JUDGE_ANSWER_INVALID."]);
  // A newer test started meanwhile, which passed here: the earlier one, passed or not, says that the newer one decides, and nothing more.
  const newerMeanwhile = (change) => standIns({ reply: async (count, request, usual) => {
    if (count === 2) assert.equal((await coldTest(using())).code, 0);
    return change(await usual(), request);
  } });
  const outdone = await coldTest(using(newerMeanwhile((usual) => usual)));
  assert.deepEqual([outdone.code, outdone.text.split("\n").at(-1)], [1, "A newer cold test of this copy has started, and that one decides: this one gave no receipt. If no other is running, run it again."]);
  const outdoneFailing = await coldTest(using(newerMeanwhile((usual, request) => (isJudge(request) ? { ...usual, verdict: "incomplete" } : usual))));
  assert.deepEqual([outdoneFailing.code, outdoneFailing.text.split("\n").at(-2)], [1, "Not passed. A newer cold test of client 1's copy has started, and that one decides whether the copy has a receipt."]);
  // An unexpected error: its code when it has one of that form, never its own text.
  const throwing = (error) => coldTest(using(standIns({ reply: async () => { throw error; } })));
  const unexpected = await throwing(new Error("Synthetic words the colleague wrote."));
  assert.deepEqual([unexpected.code, unexpected.text.split("\n").at(-1)], [1, "The journal command failed."]);
  const coded = await throwing(Object.assign(new Error("Synthetic words the colleague wrote."), { code: "PLAN_LIMIT" }));
  assert.deepEqual([coded.code, coded.text.split("\n").at(-1)], [1, "The journal command failed: PLAN_LIMIT."]);
  const odd = await throwing(Object.assign(new Error("Synthetic words."), { code: "Synthetic words in a code" }));
  assert.equal(odd.text.split("\n").at(-1), "The journal command failed.");
  // A key quote that doesn't fit, a question that isn't valid: the code alone.
  await fs.writeFile(questionsPath, JSON.stringify(withQuestions([{ ...named.questions[0], evidence_quotes: ["Synthetic words the colleague never wrote"] }, named.questions.at(-1)])), { mode: 0o600 });
  const unfit = await coldTest(using());
  assert.equal(unfit.text.split("\n").at(-1), "The journal command failed: COLD_KEY_QUOTE_NOT_IN_JOURNAL.");
  await fs.writeFile(questionsPath, JSON.stringify(withQuestions([{ ...named.questions[0], extra: "Synthetic-Alba" }, named.questions.at(-1)])), { mode: 0o600 });
  const notValid = await coldTest(using());
  assert.equal(notValid.text.split("\n").at(-1), "The questions file isn't valid (COLD_QUESTIONS_INVALID).");
  for (const { text } of [passed, failed, broken, malformedJudge, outdone, outdoneFailing, unexpected, coded, odd, unfit, notValid]) for (const words of hidden) assert.equal(text.includes(words), false, `${words} in ${text}`);

  // The import says what it checked and that the file may go, and leaves it.
  const sealedText = await fs.readFile(sealedPath, "utf8");
  const imports = await printed(["--import", sealedPath]);
  assert.equal(imports.code, 0);
  assert.match(imports.text, /The sealed file is no longer needed, and was left where it is: you may delete it\./u);
  assert.equal(await fs.readFile(sealedPath, "utf8"), sealedText);

  // Files that aren't what they should be: the parser's own message would quote them.
  const SECRET = "ZEBRASYNTHETIC";
  const malformed = `${SECRET}-KEY-LABEL-WORDS not JSON`;
  assert.throws(() => JSON.parse(malformed), (error) => error.message.includes(SECRET.slice(0, 5)), "the parser's message quotes the text");
  const credentials = path.join(home, "credentials.json"), clients = path.join(home, RUNNER_CLIENTS_FILE), copyKey = path.join(clientJournalFolder(home, clientOne), CLIENT_COPY_KEY_FILE);
  const refused = async (file, argv, message) => {
    const before = await fs.readFile(file, "utf8");
    await fs.writeFile(file, malformed, { mode: 0o600 });
    try {
      const { code, text } = await printed(argv, using());
      assert.equal(code, 1);
      assert.match(text, message);
      for (const part of [SECRET, SECRET.slice(0, 5), "KEY-LABEL", "not JSON\""]) assert.equal(text.includes(part), false, `${part} in ${text}`);
      assert.equal(await fs.readFile(file, "utf8"), malformed, "left as it is");
    } finally {
      await fs.writeFile(file, before, { mode: 0o600 });
    }
  };
  await fs.writeFile(questionsPath, JSON.stringify(named), { mode: 0o600 });
  await refused(questionsPath, ["--cold-test", questionsPath, "--provider", "claude"], /The questions file isn't valid \(not JSON\)\./u);
  await refused(credentials, ["--import", sealedPath], /The trial's credentials can't be read \(not valid\); credentials\.json was left as it is\./u);
  await refused(credentials, ["--cold-test", questionsPath, "--provider", "claude"], /The trial's credentials can't be read \(not valid\); credentials\.json was left as it is\./u);
  await refused(copyKey, ["--copy-key"], /isn't valid JSON; it was left as it is\./u);
  await refused(sealedPath, ["--import", sealedPath], /isn't a sealed journal copy that client 1's key opens \(JOURNAL_COPY_UNREADABLE\); nothing was changed\./u);
  for (const argv of [["--copy-key"], ["--import", sealedPath], ["--cold-test", questionsPath, "--provider", "codex"]]) {
    await refused(clients, argv, /^The client list can't be read; it was left as it is\.$/u);
  }
  // A list of the right form with a label it refuses: the same fixed text.
  const list = JSON.parse(await fs.readFile(clients, "utf8"));
  await fs.writeFile(clients, JSON.stringify({ ...list, clients: [{ ...list.clients[0], label: " Synthetic label with a space" }] }), { mode: 0o600 });
  assert.equal((await printed(["--copy-key"])).text, "The client list can't be read; it was left as it is.");
  await fs.writeFile(clients, JSON.stringify(list), { mode: 0o600 });
  // A list that can't be written: the error's code, not its text.
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (from, to) => {
    if (to === clients) throw Object.assign(new Error("Synthetic words."), { code: "EIO" });
    return rename.call(fs, from, to);
  });
  const unwritten = await printed(["--import", sealedPath]);
  assert.deepEqual([unwritten.code, unwritten.text.split("\n").at(-1)], [1, "The client list couldn't be written (EIO); the copy is in the client's case, but nothing uses it. Until their Delete, client 1's copies can come only from that server case; the same file can be imported again."]);
});

async function trialReference(home, caseId, corpusId) {
  const providers = await loadDevelopmentPrivateCaseProviders(path.join(home, "credentials.json"));
  try {
    const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: allowAll([caseId], ["session_use"]), keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
    return await service.inspectJournalCorpus(caseId, corpusId, { requiredScope: "case:read", requiredPurpose: "session_use" }, { bearerToken: "synthetic" });
  } finally { providers.close(); }
}

test("the client list, the cold-test receipt and its test's marker are each opened once and checked as opened: a link, loose mode, a folder, a pipe or a socket is refused, a missing one is none", async (t) => {
  const { home, cases: [clientOne], receiptPath, coldTest } = await copiedClient(t);
  assert.equal((await coldTest({ ...using(), now: () => new Date("2026-11-24T09:30:00.000Z") })).passed, true);
  const clients = path.join(home, RUNNER_CLIENTS_FILE);
  const list = await readRunnerClients(home);
  const receipt = await readColdTestReceipt(home, clientOne);
  assert.equal(receipt.result, "pass");
  const markerPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_ATTEMPT_FILE);
  const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
  const attempt = await readColdTestAttempt(home, clientOne);
  assert.deepEqual(marker, { schema_version: 1, attempt, started_at: "2026-11-24T09:30:00.000Z", corpus_id: receipt.corpus_id, run: 1 });
  assert.match(attempt, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(await modeOf(markerPath), 0o600);
  // A marker of another form names no test.
  const changes = [{ schema_version: 2 }, { attempt: "synthetic" }, { attempt: null }, { attempt: `${attempt}0` }, { started_at: "yesterday" }, { corpus_id: null }, { corpus_id: "a copy" }, { run: 0 }, { run: "1" }, { extra: true }];
  for (const malformed of ["", "not JSON", "null", "[]", JSON.stringify(attempt), JSON.stringify({ schema_version: 1, attempt, started_at: marker.started_at }), ...changes.map((change) => JSON.stringify({ ...marker, ...change }))]) {
    await fs.writeFile(markerPath, malformed);
    assert.equal(await readColdTestAttempt(home, clientOne), null, malformed);
  }
  await fs.writeFile(markerPath, JSON.stringify(marker));
  assert.equal(await readColdTestAttempt(home, clientOne), attempt);
  const refusedWith = (message) => ({ name: "ValidationError", code: "RUNNER_CLIENTS_INVALID", message });
  const notAFile = refusedWith("clients.json must be a file, not a link or a folder.");
  // Each in the place of the file, which is whole beside it (a link to it would be read if it were followed).
  const inPlaceOf = async (file, put, check) => {
    const kept = `${file}.kept`;
    await fs.rename(file, kept);
    try {
      await put(file, kept);
      try { await check(); } finally { await fs.rm(file, { force: true, recursive: true }); }
    } finally { await fs.rename(kept, file); }
  };
  // Bound by its short name in its folder (a socket's path has a length limit) by a process that's killed, which leaves it there.
  const socket = async (file) => {
    const { signal, stderr } = spawnSync(process.execPath, ["--eval", "require('node:net').createServer().listen(process.argv[1], () => process.kill(process.pid, 'SIGKILL'));", path.basename(file)],
      { cwd: path.dirname(file), encoding: "utf8", timeout: 60_000 });
    assert.equal(signal, "SIGKILL", stderr);
  };
  for (const [what, put] of [["a link", (file, kept) => fs.symlink(kept, file)], ["a folder", (file) => fs.mkdir(file, { mode: 0o700 })], ["a socket", socket]]) {
    await inPlaceOf(clients, put, () => assert.rejects(readRunnerClients(home), notAFile, what));
    await inPlaceOf(receiptPath, put, async () => assert.equal(await readColdTestReceipt(home, clientOne), null, what));
    await inPlaceOf(markerPath, put, async () => assert.equal(await readColdTestAttempt(home, clientOne), null, what));
  }
  // A mode others can read.
  for (const mode of [0o640, 0o604, 0o644]) {
    await fs.chmod(clients, mode);
    await assert.rejects(readRunnerClients(home), refusedWith("clients.json can be read by others (it must be mode 0600)."));
    await fs.chmod(clients, 0o600);
    await fs.chmod(receiptPath, mode);
    assert.equal(await readColdTestReceipt(home, clientOne), null);
    await fs.chmod(receiptPath, 0o600);
    await fs.chmod(markerPath, mode);
    assert.equal(await readColdTestAttempt(home, clientOne), null);
    await fs.chmod(markerPath, 0o600);
  }
  // What is checked is what is opened: a path that looked like a private file a moment before opens nothing that isn't one.
  const looks = async () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o100600, uid: process.getuid() });
  const looking = ["lstat", "stat", "access"].map((name) => t.mock.method(fs, name, name === "access" ? async () => {} : looks));
  await inPlaceOf(clients, (file, kept) => fs.symlink(kept, file), () => assert.rejects(readRunnerClients(home), notAFile));
  await fs.chmod(clients, 0o644);
  await assert.rejects(readRunnerClients(home), refusedWith("clients.json can be read by others (it must be mode 0600)."));
  await fs.chmod(clients, 0o600);
  for (const [file, read] of [[receiptPath, readColdTestReceipt], [markerPath, readColdTestAttempt]]) {
    await fs.chmod(file, 0o644);
    assert.equal(await read(home, clientOne), null);
    await fs.chmod(file, 0o600);
  }
  for (const mocked of looking) mocked.mock.restore();
  // Missing: no clients, no receipt, no marker.
  await inPlaceOf(clients, async () => {}, async () => assert.deepEqual(await readRunnerClients(home), { schema_version: 1, clients: [] }));
  await inPlaceOf(receiptPath, async () => {}, async () => assert.equal(await readColdTestReceipt(home, clientOne), null));
  await inPlaceOf(markerPath, async () => {}, async () => assert.equal(await readColdTestAttempt(home, clientOne), null));
  // A pipe nothing writes to: refused at once, never waited on (in a process of its own).
  const pipe = async (file) => makeNamedPipe(file);
  const apart = (code) => printedApart(`
    import { readColdTestAttempt, readColdTestReceipt, readRunnerClients } from ${JSON.stringify(new URL("../src/runner-trial/clients.mjs", import.meta.url).href)};
    const [home, caseId] = process.argv.slice(1);
    ${code}`, [home, clientOne]);
  await inPlaceOf(clients, pipe, async () => assert.equal(apart("try { await readRunnerClients(home); console.log('read'); } catch (error) { console.log(error.code, error.message); }"),
    "RUNNER_CLIENTS_INVALID clients.json must be a file, not a link or a folder.\n"));
  await inPlaceOf(receiptPath, pipe, async () => assert.equal(apart("console.log(await readColdTestReceipt(home, caseId));"), "null\n"));
  await inPlaceOf(markerPath, pipe, async () => assert.equal(apart("console.log(await readColdTestAttempt(home, caseId));"), "null\n"));
  // Back as they were, all are read.
  assert.deepEqual(await readRunnerClients(home), list);
  assert.deepEqual(await readColdTestReceipt(home, clientOne), receipt);
  assert.equal(await readColdTestAttempt(home, clientOne), attempt);
});
