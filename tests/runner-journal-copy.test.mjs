import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { createJournalCopyKeyPair, exportJournalCopy, importJournalCopy, openJournalCopy, sealJournalCopy } from "../src/runner-trial/journal-copy.mjs";
import { createRunnerJournalGate } from "../src/runner-trial/journal-gate.mjs";
import { COLD_TEST_RECEIPT_FILE, clientJournalFolder, readRunnerClients } from "../src/runner-trial/clients.mjs";
import { addClient, prepareTrialFolder, setJournalConsent } from "../scripts/runner-trial-start.mjs";

// The copy step for a client's journal (design for clients, point 4): exported where the journal lives, sealed for the trial
// alone, imported into the client's runner case and checked. The "server" here is a synthetic local vault with the journal
// import's synthetic fixture: no server is contacted and no real journal is read.

const SERVER_CASE = "synthetic-server-case", SERVER_CORPUS = "synthetic-server-corpus";
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
  return { service, auth, sources };
}

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
