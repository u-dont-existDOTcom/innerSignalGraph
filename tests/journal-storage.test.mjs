import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { decryptJournalObject, encryptJournalObject } from "../src/storage/journal-object-crypto.mjs";
import { createPrivateJournalCorpusStore, JOURNAL_BINARY_CHUNK_BYTES } from "../src/storage/private-journal-corpus.mjs";
import { createEncryptedPrivateCaseStore, validatePrivateCaseRecord } from "../src/storage/private-case-store.mjs";
import { acquirePrivateRootWriterLock, withPrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";

const CASE_ID = "synthetic_case";
const CORPUS_ID = "corpus:synthetic";

async function temporaryRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.chmod(root, 0o700);
  return root;
}

function createStore(rootDir) {
  return createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 7),
    recoverySecretBytes: Buffer.alloc(32, 9),
    osBackedReauthenticated: true,
    now: (() => { let tick = 0; return () => new Date(1_800_000_000_000 + tick++).toISOString(); })()
  });
}

test("journal object encryption binds case, object, version and AAD purpose", () => {
  const corpusKey = randomBytes(32);
  const plaintext = Buffer.from("synthetic private bytes 🌿", "utf8");
  const input = { caseId: CASE_ID, corpusId: CORPUS_ID, objectId: "object:one", objectVersion: 1, chunkIndex: 0 };
  const envelope = encryptJournalObject({ plaintextBytes: plaintext, corpusKey, ...input });
  const opened = decryptJournalObject({ envelope, corpusKey, expected: input });
  assert.equal(opened.toString("utf8"), "synthetic private bytes 🌿");
  opened.fill(0);
  assert.throws(
    () => decryptJournalObject({ envelope, corpusKey, expected: { ...input, caseId: "foreign_case" } }),
    (error) => error.code === "JOURNAL_OBJECT_IDENTITY_MISMATCH"
  );
  assert.throws(() => decryptJournalObject({ envelope: { ...envelope, object_version: 2 }, corpusKey, expected: { ...input, objectVersion: 2 } }), /unreadable/i);
  const second = encryptJournalObject({ plaintextBytes: Buffer.from("other"), corpusKey, ...input, objectId: "object:two" });
  assert.throws(() => decryptJournalObject({ envelope: { ...envelope, wrapped_key: second.wrapped_key }, corpusKey, expected: input }), /unreadable/i);
  corpusKey.fill(0);
});

test("encrypted corpus chunks and exactly reassembles an original", async () => {
  const rootDir = await temporaryRoot("inner-signal-journal-corpus-");
  const corpusKey = randomBytes(32);
  const corpus = createPrivateJournalCorpusStore({ rootDir, caseId: CASE_ID, corpusId: CORPUS_ID, corpusKey });
  const original = Buffer.alloc(JOURNAL_BINARY_CHUNK_BYTES + 31, 0x5a);
  original.set(Buffer.from("start"), 0);
  original.set(Buffer.from("tail"), original.byteLength - 4);
  const manifest = await corpus.writeChunkedOriginal({ objectId: "original:one", bytes: original });
  assert.equal(manifest.chunks.length, 2);
  const reopened = await corpus.reassembleOriginal(manifest);
  assert.deepEqual(reopened, original);
  reopened.fill(0);
  original.fill(0);
  corpus.close();
  corpusKey.fill(0);
});

test("OS-held private-root lock rejects a second writer and releases cleanly", async () => {
  const rootDir = await temporaryRoot("inner-signal-journal-lock-");
  const first = await acquirePrivateRootWriterLock({ rootDir });
  assert.deepEqual((await fs.readdir(rootDir)).sort(), [".journal-writer.lock"]);
  await assert.rejects(() => acquirePrivateRootWriterLock({ rootDir }), /active writer/i);
  await first.release();
  const second = await acquirePrivateRootWriterLock({ rootDir });
  await second.release();
});

test("publication runs under the vault root's writer lock, or not at all while another writer holds it", async () => {
  const vaultRoot = await temporaryRoot("inner-signal-journal-vault-lock-");
  const executionRoot = await temporaryRoot("inner-signal-journal-execution-lock-");
  // Another writer (a one-shot operator) holds the vault: the operation doesn't run.
  const operator = await acquirePrivateRootWriterLock({ rootDir: vaultRoot });
  let ran = false;
  await assert.rejects(withPrivateRootWriterLock({ rootDir: vaultRoot, heldRootDir: executionRoot }, async () => { ran = true; }),
    { code: "PRIVATE_ROOT_WRITER_ACTIVE" });
  assert.equal(ran, false);
  await operator.release();
  // Free: the operation runs holding the lock, which is released afterwards.
  const value = await withPrivateRootWriterLock({ rootDir: vaultRoot, heldRootDir: executionRoot }, async () => {
    await assert.rejects(() => acquirePrivateRootWriterLock({ rootDir: vaultRoot }), /active writer/i);
    return "published";
  });
  assert.equal(value, "published");
  await (await acquirePrivateRootWriterLock({ rootDir: vaultRoot })).release();
  // When the vault is the execution root, this process already holds its lock.
  const own = await acquirePrivateRootWriterLock({ rootDir: executionRoot });
  assert.equal(await withPrivateRootWriterLock({ rootDir: executionRoot, heldRootDir: executionRoot }, async () => "same root"), "same root");
  await own.release();
});

test("v6 record migrates to v7 without changing legacy content", async () => {
  const rootDir = await temporaryRoot("inner-signal-journal-migrate-");
  const store = createStore(rootDir);
  await store.appendJournal(CASE_ID, { id: "legacy-entry", observed_at: "2026-01-01T00:00:00.000Z", kind: "journal", text: "invented legacy note" });
  const current = await store.load(CASE_ID);
  const legacy = structuredClone(current);
  legacy.schema_version = 6;
  delete legacy.revision;
  delete legacy.journal_corpora;
  delete legacy.journal_corpus_keys;
  const migrated = validatePrivateCaseRecord(legacy);
  assert.equal(migrated.schema_version, 7);
  assert.equal(migrated.revision, 0);
  assert.deepEqual(migrated.journal_entries, current.journal_entries);
  assert.deepEqual(migrated.journal_corpora, []);
  store.close();
});

test("shared coordinator preserves concurrent legacy and journal mutations", async () => {
  const rootDir = await temporaryRoot("inner-signal-journal-concurrent-");
  const first = createStore(rootDir);
  const second = createStore(rootDir);
  await first.loadOrCreate(CASE_ID);
  await Promise.all([
    first.appendJournal(CASE_ID, { id: "legacy-concurrent", observed_at: "2026-01-02T00:00:00.000Z", kind: "journal", text: "invented legacy mutation" }),
    second.createJournalCorpus(CASE_ID, { corpusId: CORPUS_ID, manifestObjectId: "manifest:staged" })
  ]);
  const record = await first.load(CASE_ID);
  assert.equal(record.journal_entries.some(({ id }) => id === "legacy-concurrent"), true);
  assert.equal(record.journal_corpora.some(({ corpus_id }) => corpus_id === CORPUS_ID), true);
  assert.equal(record.journal_corpus_keys.length, 1);
  first.close();
  second.close();
});

test("staged objects remain invisible until CAS pointer publication and rollback is pointer-only", async () => {
  const rootDir = await temporaryRoot("inner-signal-journal-publish-");
  const store = createStore(rootDir);
  await store.appendJournal(CASE_ID, { id: "preserved", observed_at: "2026-01-03T00:00:00.000Z", kind: "journal", text: "must survive pointer updates" });
  const created = await store.createJournalCorpus(CASE_ID, { corpusId: CORPUS_ID, manifestObjectId: "manifest:staging" });
  assert.equal(created.reference.active_generation, null);
  const corpusKey = await store.getJournalCorpusKey(CASE_ID, CORPUS_ID);
  const corpus = createPrivateJournalCorpusStore({ rootDir, caseId: CASE_ID, corpusId: CORPUS_ID, corpusKey });
  await corpus.writeObject({ objectId: "manifest:one", plaintextBytes: Buffer.from("{\"generation\":\"g1\"}") });
  assert.equal((await store.getJournalCorpus(CASE_ID, CORPUS_ID)).reference.active_generation, null);
  const publishedOne = await store.publishJournalGeneration(CASE_ID, {
    corpusId: CORPUS_ID,
    generation: "generation:g1",
    manifestObjectId: "manifest:one",
    expectedGeneration: null,
    expectedCaseRevision: created.case_revision,
    expectedVisibilityEpoch: 0
  });
  await corpus.writeObject({ objectId: "manifest:two", plaintextBytes: Buffer.from("{\"generation\":\"g2\"}") });
  await store.publishJournalGeneration(CASE_ID, {
    corpusId: CORPUS_ID,
    generation: "generation:g2",
    manifestObjectId: "manifest:two",
    expectedGeneration: "generation:g1",
    expectedVisibilityEpoch: 0
  });
  await store.rollbackJournalGeneration(CASE_ID, {
    corpusId: CORPUS_ID,
    targetGeneration: "generation:g1",
    expectedGeneration: "generation:g2"
  });
  const after = await store.load(CASE_ID);
  assert.equal(after.journal_corpora[0].active_generation, "generation:g1");
  assert.equal(after.journal_entries[0].text, "must survive pointer updates");
  assert.ok(after.revision > publishedOne.case_revision);
  corpus.close();
  corpusKey.fill(0);
  store.close();
});
