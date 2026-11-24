import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { ProviderError } from "../src/core/errors.mjs";
import { loadTherapyProtocol } from "../src/protocol/therapy-protocol.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { buildQuoteGeneration } from "../src/journal-import/quote-index.mjs";
import { buildQuoteTermsFromGraph } from "../src/journal-import/quote-terms.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { journalRoleInstruction } from "../src/journal-import/provider-port.mjs";
import { createJournalCopyKeyPair, exportJournalCopy, importJournalCopy, journalCopyCorpusId, openJournalCopy, sealJournalCopy, writeSealedJournalCopy } from "../src/journal-import/journal-copy.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { COLD_TEST_ATTEMPT_FILE, COLD_TEST_RECEIPT_FILE, RUNNER_CLIENTS_FILE, clientJournalFolder, readColdTestAttempt, readColdTestReceipt, readRunnerClients, writeRunnerClients } from "../src/runner-trial/clients.mjs";
import { COLD_JUDGE_INSTRUCTION, COLD_JUDGE_SCHEMA, createSealedColdConsumerPort, runJournalColdTest } from "../src/runner-trial/journal-cold-test.mjs";
import { cutRuleParts } from "../src/runner-trial/rule-parts.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import { runJournalImportCli } from "../src/cli/journal-import.mjs";
import { acquireTrialFolderLock, addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";
import { CLIENT_COPY_KEY_FILE, IMPORT_PURPOSES, USAGE, ensureJournalCopyKey, importClientJournal, oneTimeGrant, parseJournalArguments, runClientColdTest, runMain } from "../scripts/runner-trial-journal.mjs";
import { makeNamedPipe, printedApart } from "./helpers/named-pipe.mjs";

// The copy step for a client's journal (design for clients, point 4) and its cold test (point 5c): exported where the journal lives,
// sealed for one client's key alone, imported into that client's runner case and checked. The "server" here is a synthetic local
// vault with the journal import's synthetic fixture or a generated synthetic journal, and every worker is a stand-in: no server is
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
  const asking = (quote) => runJournalColdTest({ service: copier, auth: authContext, caseId: clientCase, corpusId, port: consumer(), questions: { schema_version: 1, kind: "journal_cold_questions",
    questions: [{ id: "q-garden", question: "garden", answerable: true, evidence_quotes: ["One line about the garden.", quote] }, { id: "q-absent", question: "zebra", answerable: false }] } });
  assert.equal((await asking("Another line about the garden.")).passed, true);
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

// ---- The cold test ------------------------------------------------------------------------------------------------------------

// A scripted stand-in for the fresh consumer and the judge. The consumer sees only the packet (the frozen question and what the session-use
// reader retrieved). It answers "supported" citing the passages it retrieved, or "not found" when it retrieved none, except for the
// questions `script` answers otherwise, by their words (a model judges a false premise itself); `words` gives the answer to a question, by
// its words. `miss` makes it answer every question as not found; `overclaim` makes it ignore the script; `citeFirst` makes it cite only the
// first passage it retrieved; `invent` makes it cite a passage it wasn't given; `blank` makes it answer with no words. The judge finds what
// `judge` says (of each question, when it's a function), and what it was asked is kept.
const PREMISE = "When did the colleague refuse to help?";
const consumer = ({ miss = false, overclaim = false, citeFirst = false, invent = false, blank = false, judge = true, script = { [PREMISE]: "false_premise" }, words = {} } = {}) => {
  const asked = [], judged = [];
  return {
    asked, judged,
    async invoke({ packet }) {
      asked.push(packet);
      const passages = (packet.retrieved_evidence?.records ?? []).filter((record) => record.kind === "passage").map((record) => record.id);
      const scripted = overclaim ? undefined : script[packet.frozen_question.question];
      const answerability = miss ? "not_found" : scripted ?? (passages.length ? "supported" : "not_found");
      const output = { schema_version: "1.0", question_id: packet.frozen_question.id, answer: blank ? "  \n" : words[packet.frozen_question.question] ?? "A synthetic answer.",
        answerability, evidence_ids: invent ? ["passage-never-given"] : answerability === "not_found" ? [] : citeFirst ? passages.slice(0, 1) : passages,
        qualifier_ids: [], snapshot_generation: packet.expected_generation, coverage_note: "Synthetic.", more_available: false };
      return { output, receipt: { provider: "stand-in", model: "stand-in" } };
    },
    async judge(question) {
      judged.push(question);
      return typeof judge === "function" ? judge(question) : judge;
    }
  };
};

// A stand-in for the trial's signed-in worker, called through the real port: like the sealed workers, it makes its preparation, asks
// `beforeSend`, and only then sends the packet (kept in `sent`). `prepare(count, request)` is the preparation; `reply(count, request, usual)`
// is the answer (`usual()` gives the stand-in consumer's, and for the judge a supported verdict with a reason).
const JUDGE_REASON = "A synthetic reason that stays with the judge.";
function fakeWorker({ answers = consumer(), prepare = null, reply = null } = {}) {
  const sent = [];
  let count = 0;
  return {
    sent,
    async call(request) {
      const index = count += 1;
      if (prepare) await prepare(index, request);
      if (request.beforeSend) await request.beforeSend();
      sent.push(request);
      const packet = JSON.parse(request.user);
      const usual = async () => (request.stage === "cold_judge" ? { question_id: packet.question_id, verdict: "supported", reason: JUDGE_REASON } : (await answers.invoke({ packet })).output);
      return { value: reply ? await reply(index, request, usual) : await usual(), receipt: { provider: "stand-in", model: "stand-in" } };
    }
  };
}
const timedOut = () => new ProviderError("A synthetic call that timed out.", { code: "TIMEOUT" });

// Questions on the synthetic fixture, with the key naming its evidence by exact words of the journal.
const QUESTIONS = Object.freeze({ schema_version: 1, kind: "journal_cold_questions", questions: [
  { id: "q-colleague", question: "colleague", answerable: true, evidence_quotes: ["ask a colleague for help", "asked a  colleague\nfor help"] },
  { id: "q-premise", question: PREMISE, answerable: false },
  { id: "q-absent", question: "zebra", answerable: false }
] });
const withQuestions = (questions) => ({ ...QUESTIONS, questions });
const snapshotOf = (reference) => sha256(`${reference.active_generation}|${reference.manifest_object_id}|${reference.visibility_epoch}`).slice(0, 16);

async function coldTestOn(t) {
  const server = await serverJournal(t);
  const run = (port, questions = QUESTIONS) => runJournalColdTest({ service: server.service, auth: server.auth, caseId: SERVER_CASE, corpusId: SERVER_CORPUS, questions, port, now: () => new Date("2026-11-24T09:00:00.000Z") });
  const { reference } = await server.service.inspectJournalCorpus(SERVER_CASE, SERVER_CORPUS, { requiredScope: "case:read", requiredPurpose: "session_use" }, server.auth);
  return { run, reference, sources: server.sources };
}

test("the cold test: a fresh consumer answers frozen questions from the copy alone; a strict pass gives the receipt for exactly that snapshot, anything less gives none", async (t) => {
  const { run, reference } = await coldTestOn(t);
  const passed = await run(consumer());
  assert.equal(passed.passed, true, JSON.stringify(passed.report));
  assert.deepEqual(passed.receipt, { schema_version: 1, kind: "journal_cold_test", result: "pass", case_id: SERVER_CASE, corpus_id: SERVER_CORPUS,
    generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch, tested_at: "2026-11-24T09:00:00.000Z" });
  // The report names questions by their place in the file and the snapshot by an opaque name: no id, question or journal text.
  const right = { retrieved_all: true, right: true }, rightNone = { retrieved_all: null, right: true };
  assert.deepEqual(passed.report, { snapshot: snapshotOf(reference), questions: 3, graph_right: 3, raw_right: 3, same_snapshot: true, by_question: [
    { n: 1, answerable: true, graph: right, raw: right, judged: true },
    { n: 2, answerable: false, graph: rightNone, raw: rightNone, judged: true },
    { n: 3, answerable: false, graph: rightNone, raw: rightNone, judged: true }
  ], passed: true });
  for (const hidden of ["colleague", "zebra", "q-colleague", "q-premise", "q-absent", reference.active_generation, reference.manifest_object_id]) {
    assert.equal(JSON.stringify(passed.report).includes(hidden), false, hidden);
  }
  // A consumer that misses what the journal holds, claims support for a false premise, cites the evidence for one key quote only, or
  // answers with no words, doesn't pass: no receipt.
  for (const [failing, wrong] of [[consumer({ miss: true }), 1], [consumer({ overclaim: true }), 2], [consumer({ citeFirst: true }), 1], [consumer({ blank: true }), 1]]) {
    const failed = await run(failing);
    assert.equal(failed.passed, false);
    assert.equal(failed.receipt, null);
    assert.deepEqual(failed.report.by_question.filter((entry) => !entry.graph.right).map((entry) => entry.n), [wrong]);
    // The judge is asked about every answer that passed the exact checks, and about no other.
    assert.deepEqual(failing.judged.map((question) => question.question_id), [1, 2, 3].filter((n) => n !== wrong).map((n) => `question-${n}`));
    assert.deepEqual(failed.report.by_question.map((entry) => entry.judged), [1, 2, 3].map((n) => (n === wrong ? null : true)));
  }
  // An answer outside the answer's rules (a passage it wasn't given) is a test not passed, never one that stopped on an error.
  const broken = await run(consumer({ invent: true }));
  assert.deepEqual(broken, { passed: false, report: { snapshot: snapshotOf(reference), questions: 3, broken_answer: "COLD_ANSWER_UNRETRIEVED_EVIDENCE", passed: false }, receipt: null });
  await assert.rejects(run(consumer(), withQuestions(QUESTIONS.questions.slice(0, 1))), { code: "COLD_QUESTIONS_NEED_BOTH_KINDS" });
  // A key quote must name its evidence: found in no passage, or in more than three, it stops the test, naming the question by its place
  // in the file only.
  const numbered = (code, number) => (error) => error.code === code && JSON.stringify(error.details) === JSON.stringify({ question_number: number }) && !String(error.message).includes("q-");
  await assert.rejects(run(consumer(), withQuestions([QUESTIONS.questions[1], { ...QUESTIONS.questions[0], evidence_quotes: ["a sentence the journal never had"] }])), numbered("COLD_KEY_QUOTE_NOT_IN_JOURNAL", 2));
  await assert.rejects(run(consumer(), withQuestions([{ ...QUESTIONS.questions[0], evidence_quotes: ["I"] }, QUESTIONS.questions[1]])), numbered("COLD_KEY_QUOTE_NOT_SPECIFIC", 1));
  await assert.rejects(run(consumer(), withQuestions([{ ...QUESTIONS.questions[0], extra: "no" }, QUESTIONS.questions[1]])), numbered("COLD_QUESTIONS_INVALID", 1));
  await assert.rejects(run(consumer(), withQuestions([QUESTIONS.questions[1], { ...QUESTIONS.questions[0], evidence_quotes: [] }])), numbered("COLD_QUESTIONS_INVALID", 2));
});

// What the judge is asked of the three questions: the first has key quotes, the others (a false premise, an absent thing) have none.
const JUDGED = Object.freeze([
  { question_id: "question-1", question: "colleague", answerable: true, key_quotes: ["ask a colleague for help", "asked a  colleague\nfor help"], answer: "A synthetic answer." },
  { question_id: "question-2", question: PREMISE, answerable: false, key_quotes: [], answer: "A synthetic answer." },
  { question_id: "question-3", question: "zebra", answerable: false, key_quotes: [], answer: "A synthetic answer." }
]);

test("the cold test's judge: an answer that passes the exact checks must also say what its key quotes say, or, to a question the journal doesn't answer, that it doesn't; without a judge there is no test", async (t) => {
  const { run } = await coldTestOn(t);
  // The judge sees the question, whether the journal answers it, its key quotes as the file has them and the answer, and nothing else.
  const passing = consumer();
  assert.equal((await run(passing)).passed, true);
  assert.deepEqual(passing.judged, JUDGED);
  const refusing = consumer({ judge: false });
  const failed = await run(refusing);
  assert.equal(failed.passed, false);
  assert.equal(failed.receipt, null);
  assert.equal(refusing.judged.length, 3);
  assert.deepEqual([failed.report.by_question[0].graph, failed.report.by_question[0].judged], [{ retrieved_all: true, right: true }, false]);
  assert.deepEqual(failed.report.by_question.map((entry) => entry.graph.right), [true, true, true], "only the judge held it back");
  // A no to any one of them holds it back, the questions the journal doesn't answer included: here an invented answer, declared as one the
  // journal doesn't give.
  for (const n of [1, 2, 3]) {
    const one = await run(consumer({ judge: (question) => question.question_id !== `question-${n}` }));
    assert.deepEqual([one.passed, one.receipt, one.report.graph_right], [false, null, 3], `question ${n}`);
    assert.deepEqual(one.report.by_question.map((entry) => entry.judged), [1, 2, 3].map((other) => other !== n), `question ${n}`);
  }
  for (const [question, answer, declared] of [
    [PREMISE, "The colleague refused on 3 March.", "false_premise"], ["zebra", "The zebra was seen on a Sunday, and it was a relief.", "not_found"], ["zebra", "It was a synthetic zebra.", "insufficient_context"]
  ]) {
    const inventing = consumer({ words: { [question]: answer }, script: { [PREMISE]: "false_premise", [question]: declared }, judge: (asked) => asked.answerable || asked.answer !== answer });
    const invented = await run(inventing);
    assert.deepEqual([invented.passed, invented.receipt, invented.report.graph_right], [false, null, 3], answer);
    assert.deepEqual(inventing.judged.find((asked) => asked.question === question), { ...JUDGED.find((asked) => asked.question === question), answer });
    assert.deepEqual(invented.report.by_question.filter((entry) => entry.judged !== true).map((entry) => [entry.n, entry.judged]), [[question === PREMISE ? 2 : 3, false]]);
    assert.equal(JSON.stringify(invented).includes(answer), false);
  }
  // Anything a judge returns but true holds it back, of either kind of question.
  for (const unclear of [null, "supported", 1, { verdict: "supported" }]) {
    for (const answerable of [true, false]) assert.equal((await run(consumer({ judge: (question) => (question.answerable === answerable ? unclear : true) }))).passed, false);
  }
  const unjudged = consumer();
  await assert.rejects(run({ invoke: unjudged.invoke }), { code: "COLD_JUDGE_UNAVAILABLE" });
  assert.equal(unjudged.asked.length, 0, "refused before anything is asked");
  // What the judge is told of each kind.
  for (const words of ["When answerable is true, judge by the key quotes alone.", "When answerable is false, verdict is \"supported\" only when the answer says that the journal doesn't answer the question",
    "or that the question's premise is wrong, and states nothing as if the journal said it", "an event, a date, a name, a feeling or any other detail", "When you can't tell, the verdict is \"not_supported\"."]) {
    assert.ok(COLD_JUDGE_INSTRUCTION.includes(words), words);
  }
});

test("the cold test through the real port: what leaves for the consumer and the judge, and what comes back", async (t) => {
  const { run, sources } = await coldTestOn(t);
  const through = (worker, beforeSend = null) => createSealedColdConsumerPort({ worker, beforeSend, timeoutMs: 1234 });
  const worker = fakeWorker();
  let checks = 0;
  const beforeSend = async () => { checks += 1; };
  assert.equal((await run(through(worker, beforeSend))).passed, true);
  // The graph on and off for each question, then one judge call for each; each asked right before it left.
  assert.deepEqual(worker.sent.map((request) => request.stage), [...Array(6).fill("cold_consumer"), ...Array(3).fill("cold_judge")]);
  assert.equal(checks, 9);
  assert.ok(worker.sent.every((request) => request.beforeSend === beforeSend && request.timeoutMs === 1234));
  for (const request of worker.sent.slice(0, 6)) {
    assert.equal(request.system, journalRoleInstruction("cold_consumer"));
    const packet = JSON.parse(request.user);
    assert.deepEqual(Object.keys(packet).sort(), ["assigned_core_ids", "controller_provenance_tag", "current_locator", "expected_generation", "frozen_question", "grant_purpose", "output_schema_id", "protocol_version", "retrieved_evidence", "source_locators"]);
    assert.deepEqual(Object.keys(packet.frozen_question).sort(), ["id", "question"]);
    assert.match(packet.frozen_question.id, /^question-[123]$/u);
  }
  // The key and the file's own question ids stay with the controller: the key goes to the judge alone, the ids to nobody.
  for (const request of worker.sent) for (const { id } of QUESTIONS.questions) assert.equal(request.user.includes(id), false, id);
  const judges = worker.sent.slice(6);
  assert.deepEqual(judges.map((request) => request.user), JUDGED.map((question) => JSON.stringify(question)));
  for (const judge of judges) {
    assert.equal(judge.system, COLD_JUDGE_INSTRUCTION);
    assert.deepEqual(judge.schema, { type: "object", additionalProperties: false, required: ["question_id", "verdict", "reason"],
      properties: { question_id: { type: "string" }, verdict: { type: "string", enum: ["supported", "not_supported"] }, reason: { type: "string", maxLength: 500 } } });
    assert.deepEqual(judge.schema, COLD_JUDGE_SCHEMA);
  }
  // Of the journal, the judge gets the key quotes alone: nothing of it for a question it doesn't answer.
  for (const { user } of judges) for (const line of sources.repr.split("\n").filter((text) => text.length > 8)) assert.equal(user.includes(line), false, line);
  assert.equal(judges.slice(1).some(({ user }) => user.includes("ask a colleague for help")), false);
  // Of the judge's answer only the verdict counts: its reason is in nothing that comes back.
  const judging = (value) => fakeWorker({ reply: async (count, request, usual) => (request.stage === "cold_judge" ? value(await usual()) : usual()) });
  const unsupported = await run(through(judging((usual) => ({ ...usual, verdict: "not_supported" }))));
  assert.deepEqual([unsupported.passed, unsupported.receipt, unsupported.report.by_question.map((entry) => entry.judged)], [false, null, [false, false, false]]);
  assert.equal(JSON.stringify(unsupported).includes(JUDGE_REASON), false);
  // Its no to a question the journal doesn't answer is enough.
  const invented = await run(through(judging((usual) => ({ ...usual, verdict: usual.question_id === "question-2" ? "not_supported" : "supported" }))));
  assert.deepEqual([invented.passed, invented.receipt, invented.report.by_question.map((entry) => entry.judged)], [false, null, [true, false, true]]);
  assert.equal(await through(judging((usual) => usual)).judge(JUDGED[2]), true);
  // An answer of the judge outside its schema stops the test, repeating nothing of it.
  for (const malformed of [
    (usual) => ({ ...usual, reason: "x".repeat(501) }), (usual) => ({ ...usual, verdict: "maybe" }), (usual) => ({ ...usual, extra: "more" }), (usual) => ({ ...usual, question_id: "question-2" }),
    ({ question_id, verdict }) => ({ question_id, verdict }), () => "supported", () => null
  ]) {
    await assert.rejects(run(through(judging(malformed))), (error) => error.code === "COLD_JUDGE_ANSWER_INVALID" && !JSON.stringify({ message: error.message, details: error.details ?? null }).includes("x".repeat(20)));
    // Of a question the journal doesn't answer too (the last one's here).
    const atLast = fakeWorker({ reply: async (count, request, usual) => (count === 9 ? malformed(await usual()) : usual()) });
    await assert.rejects(run(through(atLast)), { code: "COLD_JUDGE_ANSWER_INVALID" });
  }
  assert.equal((await run(through(judging((usual) => ({ ...usual, reason: "x".repeat(500) }))))).passed, true, "a reason of 500 characters is within it");
  // A consumer's answer outside the answer schema is a test not passed; a call that failed stops it.
  const shapeless = fakeWorker({ reply: async (count, request, usual) => (count === 2 ? { answer: "A synthetic answer." } : usual()) });
  assert.equal((await run(through(shapeless))).report.broken_answer, "JOURNAL_SCHEMA_INVALID");
  await assert.rejects(run(through(fakeWorker({ reply: async (count, request, usual) => { if (count === 2) throw timedOut(); return usual(); } }))), { code: "TIMEOUT" });
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

  // The cold test: refused without consent; with it, a test that starts removes the copy's receipt and only a pass gives a new one.
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: consumer() }), /no confirmed journal consent/u);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  const receiptPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_RECEIPT_FILE);
  assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer({ miss: true }) })).passed, false);
  await absent(receiptPath);
  for (const failing of [consumer({ overclaim: true }), consumer({ invent: true }), consumer({ judge: false })]) {
    assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer() })).passed, true);
    assert.equal(await modeOf(receiptPath), 0o600);
    assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: failing })).passed, false);
    await absent(receiptPath, "a failed re-test leaves no receipt");
  }
  // A consent withdrawn during the test: no receipt, though every answer was right.
  const withdrawing = { ...consumer(), async invoke(input) {
    await setJournalConsent({ home, number: 1, action: "withdraw" });
    return consumer().invoke(input);
  } };
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: withdrawing }), /consent or copy changed during the cold test: it stopped, and gave no receipt/u);
  await absent(receiptPath);
  await setJournalConsent({ home, number: 1, action: "confirm" });
  // Every import, the same sealed file again included, drops the copy's receipt and its test's marker, so the cold test is run again; a test
  // that's refused before it starts changes nothing.
  assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer() })).passed, true);
  assert.match(await fs.readFile(receiptPath, "utf8"), /"result": "pass"/u);
  assert.deepEqual(await importClientJournal({ home, number: 1, sealedPath: sealedOne }), imported);
  await absent(receiptPath);
  assert.equal(await readColdTestAttempt(home, clientOne), null);
  assert.equal(await fs.readFile(sealedOne, "utf8"), sealedOneText);
  assert.equal((await runClientColdTest({ home, number: 1, questionsPath, port: consumer() })).passed, true);
  const receiptText = await fs.readFile(receiptPath, "utf8");
  const attempt = await readColdTestAttempt(home, clientOne);
  assert.match(attempt, /^[0-9a-f-]{36}$/u);
  await fs.chmod(questionsPath, 0o644);
  await assert.rejects(runClientColdTest({ home, number: 1, questionsPath, port: consumer() }), /readable by you alone/u);
  assert.equal(await fs.readFile(receiptPath, "utf8"), receiptText);

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
  const from = server ?? await serverJournal(t);
  const trial = await trialWith(t, clients, { consent: true });
  const { home } = trial;
  const outside = await temporaryFolder(t, "transfer");
  const sealedPath = path.join(outside, "one.sealed.json");
  await writeSealedJournalCopy(sealedPath, await from.exportFor((await ensureJournalCopyKey({ home, number: 1 })).publicKey));
  const imported = await importClientJournal({ home, number: 1, sealedPath });
  const questionsPath = path.join(outside, "questions.json");
  await fs.writeFile(questionsPath, JSON.stringify(QUESTIONS), { mode: 0o600 });
  const receiptPath = path.join(clientJournalFolder(home, trial.cases[0]), COLD_TEST_RECEIPT_FILE);
  const coldTest = (options) => runClientColdTest({ home, number: 1, questionsPath, ...options });
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

test("Delete this case of a client takes their copies, their key and their place on the list: then another server case can be theirs, and theirs another client's", async (t) => {
  const first = await serverJournal(t);
  const second = await serverJournal(t, { caseId: OTHER_SERVER_CASE });
  const trial = await copiedClient(t, { clients: 2, server: first });
  const { home, outside } = trial;
  const [clientOne, clientTwo] = trial.cases;
  const deleteCase = deleting(trial);
  const sealedFor = async (server, number, name) => {
    const file = path.join(outside, name);
    await writeSealedJournalCopy(file, await server.exportFor((await ensureJournalCopyKey({ home, number })).publicKey));
    return file;
  };
  assert.equal((await trial.coldTest({ port: consumer() })).passed, true);
  const consent = (await readRunnerClients(home)).clients[0].journal.consent;
  await assert.rejects(importClientJournal({ home, number: 1, sealedPath: await sealedFor(second, 1, "second-for-one.sealed.json") }), /delete their case first/u);
  await assert.rejects(importClientJournal({ home, number: 2, sealedPath: await sealedFor(first, 2, "first-for-two.sealed.json") }), /already copied for client 1/u);

  // A cold test that's running when the case is deleted stops before its next packet, and leaves no receipt.
  const worker = fakeWorker({ prepare: async (count) => { if (count === 3) await deleteCase(clientOne); } });
  await assert.rejects(trial.coldTest({ worker }), /consent or copy changed during the cold test/u);
  assert.equal(worker.sent.length, 2);
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

test("once the vault has deleted a client's case, Delete is done: what can't be cleared besides is named, everything else goes, and deleting again clears it", async (t) => {
  const trial = await copiedClient(t);
  const { home, cases: [clientOne], prepared } = trial;
  const deleteCase = deleting(trial);
  const folder = clientJournalFolder(home, clientOne);
  const list = path.join(home, RUNNER_CLIENTS_FILE);
  const lock = path.join(home, ".trial-folder.lock");
  const logOf = (caseId) => path.join(home, caseId === clientOne ? `runner-log-${clientOne}.jsonl` : "runner-log.jsonl");
  const { consent } = (await readRunnerClients(home)).clients[0].journal;
  const journalOf = async () => (await readRunnerClients(home)).clients[0].journal;
  const caseGone = (caseId = clientOne) => assert.rejects(trial.copier(caseId).loadPrivateRuntimeCase(caseId, { bearerToken: "synthetic" }), { code: "PRIVATE_CASE_NOT_FOUND" });
  // A client's case with everything Delete takes: the copy in the vault, its place on the list, the journal folder (the key, the receipt and
  // the marker of the test that gave it) and the run log.
  let copies = 0;
  const filled = async () => {
    const sealedPath = path.join(trial.outside, `filled-${copies += 1}.sealed.json`);
    await writeSealedJournalCopy(sealedPath, await trial.server.exportFor((await ensureJournalCopyKey({ home, number: 1 })).publicKey, `2026-11-24T10:${String(copies).padStart(2, "0")}:00.000Z`));
    await importClientJournal({ home, number: 1, sealedPath });
    assert.equal((await trial.coldTest({ port: consumer() })).passed, true);
    await fs.writeFile(logOf(clientOne), "{}\n", { mode: 0o600 });
    assert.deepEqual((await fs.readdir(folder)).sort(), [COLD_TEST_ATTEMPT_FILE, COLD_TEST_RECEIPT_FILE, CLIENT_COPY_KEY_FILE].sort());
    const listed = await journalOf();
    assert.deepEqual(Object.keys(listed).sort(), ["consent", "corpus_id", "source_sha256"]);
    return listed;
  };
  // Each step that fails, by its code: the list that can't be written, the folder, the log and the lock that can't be removed, and what the
  // runtime remembers.
  const refuse = (code) => Object.assign(new Error("Synthetic words."), { code });
  const failing = (codes) => {
    const { rename, rm } = fs;
    const forget = Set.prototype.delete;
    const places = [[folder, "JOURNAL_FOLDER"], [logOf(clientOne), "RUN_LOG"], [logOf(null), "RUN_LOG"], [lock, "FOLDER_LOCK"]];
    const mocked = [
      t.mock.method(fs, "rename", async (from, to) => { if (to === list && codes.includes("JOURNAL_LIST")) throw refuse("EIO"); return rename.call(fs, from, to); }),
      t.mock.method(fs, "rm", async (where, options) => { if (places.some(([place, code]) => place === where && codes.includes(code))) throw refuse("EACCES"); return rm.call(fs, where, options); }),
      t.mock.method(Set.prototype, "delete", function forgetting(value) { if (value === clientOne && codes.includes("RUNTIME_STATE")) throw refuse("SYNTHETIC"); return forget.call(this, value); })
    ];
    return () => { for (const each of mocked) each.mock.restore(); };
  };
  const deletingWith = async (codes, caseId = clientOne) => {
    const restore = failing(codes);
    try { return await deleteCase(caseId); } finally { restore(); }
  };
  const ALL = ["JOURNAL_LIST", "JOURNAL_FOLDER", "FOLDER_LOCK", "RUNTIME_STATE", "RUN_LOG"];
  await deleteCase(clientOne);
  for (const codes of [...ALL.map((code) => [code]), ALL]) {
    const listed = await filled();
    const deleted = await deletingWith(codes);
    assert.deepEqual([deleted.case_file_removed, deleted.journal_corpora_removed, deleted.cleanup_left], [true, 1, codes]);
    // The case is gone, and everything but what's named.
    await caseGone();
    assert.deepEqual(await journalOf(), codes.includes("JOURNAL_LIST") ? listed : { corpus_id: null, consent }, codes.join());
    const inFolder = [CLIENT_COPY_KEY_FILE, COLD_TEST_RECEIPT_FILE, COLD_TEST_ATTEMPT_FILE].map((name) => [path.join(folder, name), "JOURNAL_FOLDER"]);
    for (const [place, code] of [...inFolder, [logOf(clientOne), "RUN_LOG"], [lock, "FOLDER_LOCK"]]) {
      if (codes.includes(code)) assert.ok((await fs.readFile(place)).length > 0, `${code} remains`);
      else await absent(place, `${codes.join()}: ${place}`);
    }
    // Deleting again clears what remained (the lock only by hand), and again with nothing left is as good.
    if (codes.includes("FOLDER_LOCK")) await fs.unlink(lock);
    for (let time = 0; time < 2; time += 1) {
      const again = await deleteCase(clientOne);
      assert.deepEqual([again.case_file_removed, again.journal_corpora_removed, Object.hasOwn(again, "cleanup_left")], [false, 0, false], codes.join());
      assert.deepEqual(await journalOf(), { corpus_id: null, consent });
      for (const place of [folder, logOf(clientOne), lock]) await absent(place);
    }
  }
  // A cold test in its last call meanwhile, with a list that can't be written: it gives no receipt and makes no folder again.
  await filled();
  const worker = fakeWorker({ reply: async (count, request, usual) => {
    if (count === 9) assert.deepEqual((await deletingWith(["JOURNAL_LIST"])).cleanup_left, ["JOURNAL_LIST"]);
    return usual();
  } });
  await assert.rejects(trial.coldTest({ worker }), { code: "PRIVATE_CASE_NOT_FOUND" });
  assert.equal(worker.sent.length, 9);
  await absent(folder);
  assert.equal(Object.hasOwn(await deleteCase(clientOne), "cleanup_left"), false);
  // The owner's own case: its run log alone.
  await fs.writeFile(logOf(null), "{}\n", { mode: 0o600 });
  assert.deepEqual((await deletingWith(["RUN_LOG"], prepared.caseId)).cleanup_left, ["RUN_LOG"]);
  assert.equal(Object.hasOwn(await deleteCase(prepared.caseId), "cleanup_left"), false);
  await absent(logOf(null));

  // A vault that doesn't delete is told as it is: nothing else is touched, and the lock is let go (or, when it can't be, the vault's own
  // error is still what's told).
  await filled();
  const before = await tree(home);
  const notDeleting = deleting(trial, (source) => ({ ...source, deletePrivateCase: async () => { throw refuse("SYNTHETIC_VAULT_ERROR"); } }));
  await assert.rejects(notDeleting(clientOne), { code: "SYNTHETIC_VAULT_ERROR" });
  assert.deepEqual(await tree(home), before);
  const restoreLock = failing(["FOLDER_LOCK"]);
  await assert.rejects(notDeleting(clientOne), { code: "SYNTHETIC_VAULT_ERROR" });
  restoreLock();
  await fs.unlink(lock);
  assert.deepEqual(await tree(home), before);
});

test("a cold test that starts removes the copy's receipt and only a pass gives a new one: an error, a wrong or malformed answer, a judge's no, a failed judge leave none", async (t) => {
  const { home, cases: [clientOne], imported, receiptPath, coldTest } = await copiedClient(t);
  const pass = async () => {
    assert.equal((await coldTest({ worker: fakeWorker() })).passed, true);
    assert.equal((await readColdTestReceipt(home, clientOne)).corpus_id, imported.corpus_id);
  };
  // Through the real port and a stand-in worker (six consumer calls, then the judge's three), or a stand-in consumer.
  const replying = (reply) => ({ worker: fakeWorker({ reply }) });
  const failingAt = (at, error) => replying(async (count, request, usual) => { if (count === at) throw error; return usual(); });
  const answeringAt = (at, change) => replying(async (count, request, usual) => (count === at ? change(await usual()) : usual()));
  const wrong = (usual) => ({ ...usual, answerability: "not_found", evidence_ids: [] });
  const portThat = (change) => { const usual = consumer(); return { port: { ...usual, ...change(usual) } }; };
  const stopped = (code) => (error) => error.code === code;
  for (const [what, options, code] of [
    ["a later call that timed out", failingAt(4, timedOut()), "TIMEOUT"],
    ["a wrong first answer, then a call that timed out", replying(async (count, request, usual) => { if (count > 1) throw timedOut(); return wrong(await usual()); }), "TIMEOUT"],
    ["a malformed answer, as the worker reports it", failingAt(2, new ProviderError("A synthetic malformed answer.", { code: "PROVIDER_MALFORMED" })), "PROVIDER_MALFORMED"],
    ["a judge's call that timed out", failingAt(7, timedOut()), "TIMEOUT"],
    ["a judge's call that timed out, of a question the journal doesn't answer", failingAt(9, timedOut()), "TIMEOUT"],
    ["a judge's answer outside its schema", answeringAt(7, (usual) => ({ ...usual, verdict: "maybe" })), "COLD_JUDGE_ANSWER_INVALID"],
    ["a stand-in consumer whose second call fails", portThat((usual) => { let count = 0; return { async invoke(input) { count += 1; if (count === 2) throw timedOut(); return usual.invoke(input); } }; }), "TIMEOUT"],
    ["a stand-in judge that fails", portThat(() => ({ async judge() { throw timedOut(); } })), "TIMEOUT"],
    ["no judge", { port: { invoke: consumer().invoke } }, "COLD_JUDGE_UNAVAILABLE"]
  ]) {
    await pass();
    await assert.rejects(coldTest(options), stopped(code), what);
    await absent(receiptPath, what);
  }
  for (const [what, options] of [
    ["a wrong answer", answeringAt(1, wrong)],
    ["an answer outside the answer schema", answeringAt(5, () => ({ answer: "A synthetic answer." }))],
    ["a judge that finds the answer unsupported", answeringAt(7, (usual) => ({ ...usual, verdict: "not_supported" }))],
    ["a judge that finds an answer invented, to a false premise", answeringAt(8, (usual) => ({ ...usual, verdict: "not_supported" }))],
    ["a judge that finds an answer invented, about an absent thing", answeringAt(9, (usual) => ({ ...usual, verdict: "not_supported" }))]
  ]) {
    await pass();
    assert.equal((await coldTest(options)).passed, false, what);
    await absent(receiptPath, what);
  }
  // Gone before the first packet leaves, whatever copy it names.
  await pass();
  let checked = 0;
  assert.equal((await coldTest({ worker: fakeWorker({ prepare: async () => { checked += 1; await absent(receiptPath, "before any packet leaves"); } }) })).passed, true);
  assert.equal(checked, 9);
  await fs.writeFile(receiptPath, JSON.stringify({ ...(await readColdTestReceipt(home, clientOne)), corpus_id: "another-copy" }), { mode: 0o600 });
  await assert.rejects(coldTest(failingAt(1, timedOut())), { code: "TIMEOUT" });
  await absent(receiptPath, "a receipt of another copy too");
  // One that's there all the same when the test started last doesn't pass (put there here) goes as well, whatever copy it names.
  await pass();
  const earlier = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  for (const planted of [earlier, { ...earlier, corpus_id: "another-copy" }]) {
    const plant = () => fs.writeFile(receiptPath, JSON.stringify(planted), { mode: 0o600 });
    for (const options of [
      { worker: fakeWorker({ reply: async (count, request, usual) => { if (count !== 3) return usual(); await plant(); throw timedOut(); } }) },
      { worker: fakeWorker({ reply: async (count, request, usual) => { if (count === 3) await plant(); return count === 1 ? wrong(await usual()) : usual(); } }) }
    ]) {
      await coldTest(options).then((result) => assert.deepEqual([result.passed, result.newerStarted], [false, false]), (error) => assert.equal(error.code, "TIMEOUT"));
      await absent(receiptPath, "a receipt put there meanwhile");
    }
  }
  // A test refused before it starts (no consent) leaves the receipt as it is: the gate is closed by the withdrawal itself.
  await pass();
  const receipt = await fs.readFile(receiptPath, "utf8");
  await setJournalConsent({ home, number: 1, action: "withdraw" });
  const unused = fakeWorker();
  await assert.rejects(coldTest({ worker: unused }), /no confirmed journal consent/u);
  assert.equal(await fs.readFile(receiptPath, "utf8"), receipt);
  assert.equal(unused.sent.length, 0);
  assert.equal(/decides nothing/u.test(USAGE), false);
  assert.match(USAGE, /A test that starts removes the copy's receipt; only a pass gives a new one/u);
});

test("of cold tests of one copy that overlap, the one started last decides: an earlier one gives no receipt and takes none away, also when the newer one never ends", async (t) => {
  const { home, cases: [clientOne], receiptPath, coldTest, questionsPath, outside, server, sealedPath } = await copiedClient(t);
  const markerPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_ATTEMPT_FILE);
  const attempt = () => readColdTestAttempt(home, clientOne);
  const receipt = () => fs.readFile(receiptPath, "utf8");
  const pass = async () => {
    assert.equal((await coldTest({ worker: fakeWorker() })).passed, true);
    return receipt();
  };
  const newer = { message: "A newer cold test of this copy has started, and that one decides: this one gave no receipt. If no other is running, run it again." };
  const changed = { message: "The client's consent or copy changed during the cold test: it stopped, and gave no receipt." };
  const unmarked = { message: "The marker of this cold test's start is gone or can't be read: it gave no receipt. Run it again." };
  // A test whose third call waits until `during` is done; it passes unless `answer` changes an answer of the worker's, by its count.
  const meanwhile = (during, answer = (usual) => usual) => ({ worker: fakeWorker({ reply: async (count, request, usual) => {
    if (count === 3) await during();
    return answer(await usual(), count, request);
  } }) });
  const wrong = (usual) => ({ ...usual, answerability: "not_found", evidence_ids: [] });

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
    b = coldTest({ worker: fakeWorker({ prepare: async (count) => { if (count === 1) { bStarted.resolve(); await bGoesOn.promise; } } }) });
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
    ["a call that timed out", (usual, count) => { if (count === 4) throw timedOut(); return usual; }, { code: "TIMEOUT" }],
    ["a judge's call that timed out", (usual, count) => { if (count === 9) throw timedOut(); return usual; }, { code: "TIMEOUT" }],
    ["a wrong answer", (usual, count) => (count === 1 ? wrong(usual) : usual), null],
    ["an answer outside the answer schema", (usual, count) => (count === 5 ? { answer: "A synthetic answer." } : usual), null],
    ["a judge's no", (usual, count, request) => (request.stage === "cold_judge" ? { ...usual, verdict: "not_supported" } : usual), null]
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
  await assert.rejects(coldTest(meanwhile(() => assert.rejects(coldTest({ worker: fakeWorker({ reply: async () => { throw timedOut(); } }) }), { code: "TIMEOUT" }))), newer);
  await absent(receiptPath);
  const killed = () => {
    const { signal, stdout, stderr } = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { runClientColdTest } from ${JSON.stringify(new URL("../scripts/runner-trial-journal.mjs", import.meta.url).href)};
      const [home, questionsPath] = process.argv.slice(1);
      await runClientColdTest({ home, number: 1, questionsPath, worker: { async call(request) {
        await request.beforeSend();
        process.stdout.write("started");
        process.kill(process.pid, "SIGKILL");
        await new Promise(() => {});
      } } });`, home, questionsPath], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
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
  assert.equal((await coldTest(meanwhile(() => assert.rejects(coldTest({ questionsPath: loose, worker: fakeWorker() }), /readable by you alone/u)))).passed, true);
  await receipt();
  // Nor has one whose start can't be marked: it sends nothing. The receipt is gone by then.
  const rename = fs.rename;
  const unwritable = t.mock.method(fs, "rename", async (from, to) => {
    if (to === markerPath) throw Object.assign(new Error("Synthetic words."), { code: "EIO" });
    return rename.call(fs, from, to);
  });
  const unsent = fakeWorker();
  await assert.rejects(coldTest({ worker: unsent }), { code: "EIO" });
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
      between = await coldTest({ worker: fakeWorker(), lockWaitMs: 0 }).then(() => "started", (error) => error.message);
    }
    return text;
  });
  assert.equal((await coldTest({ worker: fakeWorker({ reply: async (count, request, usual) => { armed = count === 9; return usual(); } }) })).passed, true);
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
  // Withdrawn while a packet is prepared, the first, a later one and the judge's (the first and the last): that packet doesn't leave.
  for (const at of [1, 4, 7, 9]) {
    const worker = fakeWorker({ prepare: async (count) => { if (count === at) await withdraw(); } });
    await assert.rejects(coldTest({ worker }), changed, `packet ${at}`);
    assert.equal(worker.sent.length, at - 1, `packet ${at}`);
    await absent(receiptPath);
    await confirm();
  }
  // The reading is made under the lock: while a command holds it, the packet doesn't leave.
  let held = null;
  const waiting = fakeWorker({ prepare: async (count) => { if (count === 2) held = await acquireTrialFolderLock(home); } });
  try { await assert.rejects(coldTest({ worker: waiting, lockWaitMs: 60 }), /Another runner-trial command is changing the trial folder/u); } finally { await held?.release(); }
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
  const between = fakeWorker({
    prepare: async (count) => { armed = count === 2; },
    reply: async (count, request, usual) => {
      if (count === 2) assert.deepEqual(await during.waiting, { changed: true, state: "withdrawn" });
      return usual();
    }
  });
  await assert.rejects(coldTest({ worker: between }), changed);
  mocked.mock.restore();
  assert.match(during.refused, /Another runner-trial command is changing the trial folder/u);
  assert.equal(between.sent.length, 2);
  await absent(receiptPath);
  await confirm();
  // The lock isn't held during a call: a withdrawal while one runs is recorded at once, and stops the test at the next packet, or, during
  // the last call (the judge's), before the receipt is written.
  for (const [at, sent] of [[2, 2], [9, 9]]) {
    const worker = fakeWorker({ reply: async (count, request, usual) => {
      if (count === at) assert.deepEqual(await withdraw({ lockWaitMs: 0 }), { changed: true, state: "withdrawn" });
      return usual();
    } });
    await assert.rejects(coldTest({ worker }), changed, `during call ${at}`);
    assert.equal(worker.sent.length, sent, `during call ${at}`);
    await absent(receiptPath);
    await confirm();
  }
  // So does a new copy.
  const newer = path.join(outside, "newer.sealed.json");
  await writeSealedJournalCopy(newer, await server.exportFor((await ensureJournalCopyKey({ home, number: 1 })).publicKey, "2026-11-24T08:09:00.000Z"));
  const worker = fakeWorker({ prepare: async (count) => { if (count === 3) await importClientJournal({ home, number: 1, sealedPath: newer }); } });
  await assert.rejects(coldTest({ worker }), changed);
  assert.equal(worker.sent.length, 2);
  await absent(receiptPath);
  assert.equal((await coldTest({ worker: fakeWorker() })).passed, true, "and the new copy has its own test");
});

test("the commands print numbers and fixed texts only: no label, question id or journal text, and nothing that a file or an error holds", async (t) => {
  const { home, questionsPath, sealedPath, server, imported, cases: [clientOne] } = await copiedClient(t, { clients: 2 });
  const printed = async (argv, options = {}) => {
    const lines = [];
    const add = (text) => { lines.push(String(text)); };
    const code = await runMain([...argv, "--dir", home], { log: add, logError: add, askQuestion: async (question) => { add(question); return "1"; }, ...options });
    return { code, text: lines.join("\n") };
  };
  const coldTest = (options) => printed(["--cold-test", questionsPath, "--provider", "claude"], options);
  const { reference } = await trialReference(home, clientOne, imported.corpus_id);

  // The cold test: ids that are somebody's names, and the report's numbers in their place.
  const named = withQuestions(QUESTIONS.questions.map((question, index) => ({ ...question, id: ["Synthetic-Alba", "Synthetic-Bruno", "Synthetic-Chloe"][index] })));
  await fs.writeFile(questionsPath, JSON.stringify(named), { mode: 0o600 });
  const hidden = ["Synthetic-", "Synthetic client", "colleague", "zebra", "A synthetic answer", JUDGE_REASON, "q-", clientOne, imported.corpus_id, reference.active_generation, reference.manifest_object_id,
    ...server.sources.repr.split("\n").filter((line) => line.length > 8)];
  const passed = await coldTest({ worker: fakeWorker() });
  assert.equal(passed.code, 0, passed.text);
  const report = JSON.parse(passed.text.slice(passed.text.indexOf("{"), passed.text.lastIndexOf("}") + 1));
  assert.equal(report.snapshot, snapshotOf(reference));
  assert.deepEqual(report.by_question.map(({ n, judged }) => [n, judged]), [[1, true], [2, true], [3, true]]);
  const failed = await coldTest({ worker: fakeWorker({ reply: async (count, request, usual) => (request.stage === "cold_judge" ? { ...(await usual()), verdict: "not_supported" } : usual()) }) });
  assert.equal(failed.code, 1);
  assert.match(failed.text, /Not passed: client 1's copy has no cold-test receipt/u);
  const broken = await coldTest({ worker: fakeWorker({ reply: async () => ({ answer: "A synthetic answer." }) }) });
  assert.equal(broken.code, 1);
  // A newer test started meanwhile, which passed here: the earlier one, passed or not, says that the newer one decides, and nothing more.
  const newerMeanwhile = (change) => fakeWorker({ reply: async (count, request, usual) => {
    if (count === 2) assert.equal((await coldTest({ worker: fakeWorker() })).code, 0);
    return change(await usual(), request);
  } });
  const outdone = await coldTest({ worker: newerMeanwhile((usual) => usual) });
  assert.deepEqual([outdone.code, outdone.text.split("\n").at(-1)], [1, "A newer cold test of this copy has started, and that one decides: this one gave no receipt. If no other is running, run it again."]);
  const outdoneFailing = await coldTest({ worker: newerMeanwhile((usual, request) => (request.stage === "cold_judge" ? { ...usual, verdict: "not_supported" } : usual)) });
  assert.deepEqual([outdoneFailing.code, outdoneFailing.text.split("\n").at(-1)], [1, "Not passed. A newer cold test of client 1's copy has started, and that one decides whether the copy has a receipt."]);
  // An unexpected error: its code when it has one of that form, never its own text.
  const throwing = (error) => coldTest({ worker: fakeWorker({ reply: async () => { throw error; } }) });
  const unexpected = await throwing(new Error("Synthetic words the colleague wrote."));
  assert.deepEqual([unexpected.code, unexpected.text.split("\n").at(-1)], [1, "The journal command failed."]);
  const coded = await throwing(Object.assign(new Error("Synthetic words the colleague wrote."), { code: "PLAN_LIMIT" }));
  assert.deepEqual([coded.code, coded.text.split("\n").at(-1)], [1, "The journal command failed: PLAN_LIMIT."]);
  const odd = await throwing(Object.assign(new Error("Synthetic words."), { code: "Synthetic words in a code" }));
  assert.equal(odd.text.split("\n").at(-1), "The journal command failed.");
  // A key quote that doesn't fit, a question that isn't valid: the code alone.
  await fs.writeFile(questionsPath, JSON.stringify(withQuestions([{ ...named.questions[0], evidence_quotes: ["Synthetic words the colleague never wrote"] }, named.questions[1]])), { mode: 0o600 });
  const unfit = await coldTest({ worker: fakeWorker() });
  assert.equal(unfit.text.split("\n").at(-1), "The journal command failed: COLD_KEY_QUOTE_NOT_IN_JOURNAL.");
  await fs.writeFile(questionsPath, JSON.stringify(withQuestions([{ ...named.questions[0], extra: "Synthetic-Alba" }, named.questions[1]])), { mode: 0o600 });
  const notValid = await coldTest({ worker: fakeWorker() });
  assert.equal(notValid.text.split("\n").at(-1), "The questions file isn't valid (COLD_QUESTIONS_INVALID).");
  for (const { text } of [passed, failed, broken, outdone, outdoneFailing, unexpected, coded, odd, unfit, notValid]) for (const words of hidden) assert.equal(text.includes(words), false, `${words} in ${text}`);

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
      const { code, text } = await printed(argv, { worker: fakeWorker() });
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
  assert.equal((await coldTest({ port: consumer(), now: () => new Date("2026-11-24T09:30:00.000Z") })).passed, true);
  const clients = path.join(home, RUNNER_CLIENTS_FILE);
  const list = await readRunnerClients(home);
  const receipt = await readColdTestReceipt(home, clientOne);
  assert.equal(receipt.result, "pass");
  const markerPath = path.join(clientJournalFolder(home, clientOne), COLD_TEST_ATTEMPT_FILE);
  const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
  const attempt = await readColdTestAttempt(home, clientOne);
  assert.deepEqual(marker, { schema_version: 1, attempt, started_at: "2026-11-24T09:30:00.000Z" });
  assert.match(attempt, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(await modeOf(markerPath), 0o600);
  // A marker of another form names no test.
  const changes = [{ schema_version: 2 }, { attempt: "synthetic" }, { attempt: null }, { attempt: `${attempt}0` }, { started_at: "yesterday" }, { extra: true }];
  for (const malformed of ["", "not JSON", "null", "[]", JSON.stringify(attempt), JSON.stringify({ schema_version: 1, attempt }), ...changes.map((change) => JSON.stringify({ ...marker, ...change }))]) {
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
