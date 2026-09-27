import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalContinuityProjection } from "../src/case-state/journal-continuity.mjs";
import { affectedJournalDependents } from "../src/journal-import/contracts.mjs";
import { buildGraphIndexes, persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { buildEpisodeThemeMatrix } from "../src/journal-import/pattern.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders, PRIVATE_CASE_SCOPES, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { createSyntheticCalendarGraph, runCapacityEnvelope } from "../scripts/journal-capacity.mjs";

const CASE_ID = "capacity-case";
const CORPUS_ID = "capacity-corpus";
const TOKEN = "synthetic-capacity-delete-token";
const SEARCH_TOKEN = "synthetic-capacity-search-token";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function temporaryRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.chmod(root, 0o700);
  return root;
}

async function accessEnvironment(t) {
  const privateRoot = await temporaryRoot("inner-signal-journal-delete-");
  const credentialsPath = path.join(privateRoot, "credentials.json");
  const credentials = {
    schema_version: 1,
    root_dir: path.join(privateRoot, "vaults"),
    grants: [
      {
        token_sha256: sha256(TOKEN), principal_id: "deletion-authority", case_ids: [CASE_ID],
        scopes: Object.values(PRIVATE_CASE_SCOPES), purposes: Object.values(PRIVATE_JOURNAL_PURPOSES)
      },
      {
        token_sha256: sha256(SEARCH_TOKEN), principal_id: "search-only", case_ids: [CASE_ID],
        scopes: [PRIVATE_CASE_SCOPES.READ], purposes: [PRIVATE_JOURNAL_PURPOSES.ORGANIZE_SEARCH]
      }
    ],
    case_keys: {
      [CASE_ID]: {
        routine_kek_base64: Buffer.alloc(32, 91).toString("base64"),
        recovery_secret_base64: Buffer.alloc(32, 92).toString("base64")
      }
    }
  };
  await fs.writeFile(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  const service = createPrivateCaseAccessService({
    rootDir: providers.rootDir,
    authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider,
    allowDevelopmentFileProvider: true,
    now: (() => { let tick = 0; return () => new Date(1_810_000_000_000 + tick++).toISOString(); })()
  });
  t.after(() => providers.close());
  t.after(async () => fs.rm(privateRoot, { recursive: true, force: true }));
  return { providers, service };
}

test("measured synthetic envelope crosses calendar, volume and existing guard boundaries without model calls", { timeout: 180_000 }, async () => {
  const report = await runCapacityEnvelope();
  assert.equal(report.claim, "measured_local_synthetic_envelope_not_universal");
  assert.deepEqual(report.calendar_cases.map(({ years }) => years), [2, 10, 20]);
  assert.deepEqual(report.volume_cases.map(({ mebibytes }) => mebibytes), [1, 10, 50]);
  assert.ok(report.calendar_cases.every((entry, index, values) => index === 0 || entry.entries > values[index - 1].entries));
  assert.ok(report.volume_cases.every(({ source_bytes, streamed_bytes, digest_verified }) => source_bytes === streamed_bytes && digest_verified));
  assert.equal(report.guards.matches_over_200, true);
  assert.equal(report.guards.matches_over_1000, true);
  assert.equal(report.guards.files_over_100, true);
  assert.equal(report.guards.source_over_2mib, true);
  assert.equal(report.guards.js_entry_over_40k, true);
  assert.ok(report.calendar_cases.at(-1).total_matches > 200);
  assert.ok(report.calendar_cases.at(-1).total_matches > 1_000);
  assert.ok(report.calendar_cases.at(-1).result_pages > 5);
  assert.ok(report.calendar_cases.at(-1).persisted_objects > 100);
  assert.ok(report.guards.source_bytes > 2 * 1024 * 1024);
  assert.ok(report.guards.long_entry_js_units > 40_000);
  assert.ok(report.process.elapsed_ms > 0 && report.process.max_rss_bytes >= report.process.rss_before_bytes);
});

test("authorized corpus tombstone revokes cached reads and removes all live handoff continuity pointers", async (t) => {
  const { service } = await accessEnvironment(t);
  const auth = { bearerToken: TOKEN };
  await service.createJournalCorpus(CASE_ID, { corpusId: CORPUS_ID, manifestObjectId: "manifest:staging" }, auth);
  const synthetic = createSyntheticCalendarGraph({ years: 2, corpusId: CORPUS_ID, generation: "delete-v1" });
  let persisted;
  let staleReader;
  let snapshotCurrent = true;
  await service.withJournalCorpus(CASE_ID, CORPUS_ID, {
    requiredScope: PRIVATE_CASE_SCOPES.WRITE,
    requiredPurpose: PRIVATE_JOURNAL_PURPOSES.ARCHIVE
  }, async ({ corpusStore, cursorSecret }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph: synthetic.graph, sourceRepresentations: synthetic.representations });
    staleReader = await openPrivateJournalGraph({
      corpusStore,
      manifestObjectId: persisted.manifest_object_id,
      caseId: CASE_ID,
      corpusId: CORPUS_ID,
      generation: "delete-v1",
      visibilityEpoch: 0,
      cursorSecret,
      assertSnapshotCurrent: async () => snapshotCurrent
    });
    assert.equal((await staleReader.search({ query: "capacitymarker", pageSize: 1 })).records.length, 1);
  }, auth);
  const beforeCommit = await service.loadPrivateRuntimeCase(CASE_ID, auth);
  const api = createJournalPrivateApi({ caseAccessService: service });
  await api.commit({
    caseId: CASE_ID,
    corpusId: CORPUS_ID,
    generation: "delete-v1",
    manifestObjectId: persisted.manifest_object_id,
    expectedGeneration: null,
    expectedCaseRevision: beforeCommit.revision,
    permittedUses: ["archive", "organize_search"]
  }, auth);
  assert.equal((await api.search({ caseId: CASE_ID, corpusId: CORPUS_ID, query: "capacitymarker" }, auth)).items.length > 0, true);
  await assert.rejects(
    () => api.delete({ caseId: CASE_ID, corpusId: CORPUS_ID }, auth),
    (error) => error.code === "JOURNAL_DELETE_REQUIRES_SEPARATE_AUTHORITY"
  );
  await assert.rejects(
    () => service.tombstoneJournalCorpus(CASE_ID, {
      corpusId: CORPUS_ID, expectedGeneration: "delete-v1", expectedEpoch: 0, tombstoneId: "tombstone:delete-v1"
    }, { bearerToken: SEARCH_TOKEN }),
    (error) => error.code === "PRIVATE_CASE_ACCESS_DENIED"
  );
  const deleted = await service.tombstoneJournalCorpus(CASE_ID, {
    corpusId: CORPUS_ID,
    expectedGeneration: "delete-v1",
    expectedEpoch: 0,
    tombstoneId: "tombstone:delete-v1"
  }, auth);
  assert.deepEqual({ generation: deleted.active_generation, epoch: deleted.visibility_epoch }, { generation: null, epoch: 1 });
  snapshotCurrent = false;
  await assert.rejects(() => staleReader.search({ query: "capacitymarker", pageSize: 1 }), /CURSOR_STALE/);
  staleReader.close();
  await assert.rejects(
    () => api.search({ caseId: CASE_ID, corpusId: CORPUS_ID, query: "capacitymarker" }, auth),
    /SOURCE_UNAVAILABLE/
  );
  const after = await service.loadPrivateRuntimeCase(CASE_ID, auth);
  assert.equal(after.journal_corpora[0].previous_generations.length, 0);
  assert.deepEqual(createJournalContinuityProjection(after.journal_corpora).corpora, []);
});

test("incremental recompute excludes tombstones, survives orphan cleanup, and restores an encrypted backup", async (t) => {
  const root = await temporaryRoot("inner-signal-journal-recovery-");
  const restoredRoot = await temporaryRoot("inner-signal-journal-restored-");
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(restoredRoot, { recursive: true, force: true });
  });
  const routineKek = Buffer.alloc(32, 101);
  const recoverySecret = Buffer.alloc(32, 102);
  const caseStore = createEncryptedPrivateCaseStore({ rootDir: root, routineKek, recoverySecretBytes: recoverySecret, osBackedReauthenticated: true });
  const created = await caseStore.createJournalCorpus(CASE_ID, { corpusId: CORPUS_ID, manifestObjectId: "manifest:staging" });
  const corpusKey = await caseStore.getJournalCorpusKey(CASE_ID, CORPUS_ID);
  const corpusStore = createPrivateJournalCorpusStore({ rootDir: root, caseId: CASE_ID, corpusId: CORPUS_ID, corpusKey });

  const first = createSyntheticCalendarGraph({ years: 2, corpusId: CORPUS_ID, generation: "incremental-v1", reversedHistory: true });
  const persistedOne = await persistGraphGeneration({ corpusStore, graph: first.graph, sourceRepresentations: first.representations, shardTargetBytes: 4096 });
  await caseStore.publishJournalGeneration(CASE_ID, {
    corpusId: CORPUS_ID,
    generation: "incremental-v1",
    manifestObjectId: persistedOne.manifest_object_id,
    expectedGeneration: null,
    expectedCaseRevision: created.case_revision,
    expectedVisibilityEpoch: 0
  });
  const firstReader = await openPrivateJournalGraph({
    corpusStore, manifestObjectId: persistedOne.manifest_object_id, caseId: CASE_ID, corpusId: CORPUS_ID,
    generation: "incremental-v1", visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 11)
  });
  const reversed = await firstReader.timeline();
  assert.equal(reversed.records[0].id, "episode:incremental-v1:23");
  firstReader.close();

  const second = createSyntheticCalendarGraph({ years: 2, corpusId: CORPUS_ID, generation: "incremental-v2", tombstoneIndexes: [0] });
  const originalIndexes = buildGraphIndexes(first.graph);
  const recomputedIndexes = buildGraphIndexes(second.graph);
  assert.equal(originalIndexes.lexical.get("0000").length > 0, true);
  assert.equal(recomputedIndexes.lexical.has("0000"), false);
  assert.equal(affectedJournalDependents(second.graph, ["passage:incremental-v2:0"]).includes("episode:incremental-v2:0"), true);
  const persistedTwo = await persistGraphGeneration({ corpusStore, graph: second.graph, sourceRepresentations: second.representations, shardTargetBytes: 4096 });
  await caseStore.publishJournalGeneration(CASE_ID, {
    corpusId: CORPUS_ID,
    generation: "incremental-v2",
    manifestObjectId: persistedTwo.manifest_object_id,
    expectedGeneration: "incremental-v1",
    expectedVisibilityEpoch: 0
  });
  const secondReader = await openPrivateJournalGraph({
    corpusStore, manifestObjectId: persistedTwo.manifest_object_id, caseId: CASE_ID, corpusId: CORPUS_ID,
    generation: "incremental-v2", visibilityEpoch: 0, cursorSecret: Buffer.alloc(32, 12)
  });
  assert.equal((await secondReader.search({ query: "0000", pageSize: 10 })).records.length, 0);
  assert.equal((await secondReader.timeline()).records.length, second.entries - 1);
  await assert.rejects(() => secondReader.resolveEvidence(["passage:incremental-v2:0"]), /REVOKED/);
  secondReader.close();

  const correctionGraph = JSON.parse(await fs.readFile(new URL("../schemas/journal-import/fixtures/synthetic-graph.json", import.meta.url), "utf8"));
  const correctionSources = JSON.parse(await fs.readFile(new URL("../schemas/journal-import/fixtures/synthetic-sources.json", import.meta.url), "utf8"));
  const correctionCorpusId = "late-correction-corpus";
  correctionGraph.case_id = CASE_ID;
  correctionGraph.corpus_id = correctionCorpusId;
  correctionGraph.generation = "late-correction-v1";
  for (const record of [...correctionGraph.nodes, ...correctionGraph.edges]) {
    record.case_id = CASE_ID;
    record.corpus_id = correctionCorpusId;
  }
  const correctionKey = Buffer.alloc(32, 14);
  const correctionStore = createPrivateJournalCorpusStore({ rootDir: root, caseId: CASE_ID, corpusId: correctionCorpusId, corpusKey: correctionKey });
  const correctionPersisted = await persistGraphGeneration({
    corpusStore: correctionStore,
    graph: correctionGraph,
    sourceRepresentations: correctionSources,
    shardTargetBytes: 4096
  });
  const correctionReader = await openPrivateJournalGraph({
    corpusStore: correctionStore,
    manifestObjectId: correctionPersisted.manifest_object_id,
    caseId: CASE_ID,
    corpusId: correctionCorpusId,
    generation: "late-correction-v1",
    visibilityEpoch: 0,
    cursorSecret: Buffer.alloc(32, 15)
  });
  const lateCorrection = await correctionReader.evidenceGroup(["a5"]);
  assert.equal(lateCorrection.edges.some(({ relation, from, to }) => relation === "corrects" && from === "a5" && to === "a3"), true);
  assert.equal(lateCorrection.nodes.some(({ id }) => id === "p5"), true);
  const mixedProjectionGraph = structuredClone(correctionGraph);
  mixedProjectionGraph.nodes.find(({ id }) => id === "a3").lifecycle = "deleted";
  mixedProjectionGraph.edges.push(
    {
      id: "capacity-about-a3", case_id: CASE_ID, corpus_id: correctionCorpusId, version: 1, lifecycle: "deleted",
      relation: "about_theme", from: "a3", to: "theme", evidence_ids: ["p3"], basis: "direct_source", derivation_ref: null
    },
    {
      id: "capacity-about-a4", case_id: CASE_ID, corpus_id: correctionCorpusId, version: 1, lifecycle: "active",
      relation: "about_theme", from: "a4", to: "theme", evidence_ids: ["p4"], basis: "direct_source", derivation_ref: null
    }
  );
  const recomputedProjection = buildEpisodeThemeMatrix(mixedProjectionGraph);
  assert.deepEqual(recomputedProjection.cells.map(({ assertion_ids }) => assertion_ids), [["a4"]]);
  correctionReader.close();
  correctionStore.close();
  correctionKey.fill(0);

  const orphanName = `${"a".repeat(64)}.journal-object.json.${process.pid}.${randomUUID()}.tmp`;
  const ignoredName = `${"b".repeat(64)}.journal-object.json.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(path.join(corpusStore.rootDir, orphanName), "orphan", { mode: 0o600 });
  await fs.symlink(path.join(corpusStore.rootDir, "missing-target"), path.join(corpusStore.rootDir, ignoredName));
  const recovered = await corpusStore.recoverOrphanedTemporaryObjects();
  assert.deepEqual(recovered, { removed: 1, ignored: 1 });
  await assert.rejects(() => fs.access(path.join(corpusStore.rootDir, orphanName)), (error) => error.code === "ENOENT");

  corpusStore.close();
  corpusKey.fill(0);
  caseStore.close();
  await fs.rm(path.join(corpusStore.rootDir, ignoredName));
  await fs.cp(root, restoredRoot, { recursive: true, force: true });
  const restoredCaseStore = createEncryptedPrivateCaseStore({ rootDir: restoredRoot, routineKek, recoverySecretBytes: recoverySecret, osBackedReauthenticated: true });
  const restoredReference = (await restoredCaseStore.getJournalCorpus(CASE_ID, CORPUS_ID)).reference;
  assert.equal(restoredReference.active_generation, "incremental-v2");
  const restoredKey = await restoredCaseStore.getJournalCorpusKey(CASE_ID, CORPUS_ID);
  const restoredCorpusStore = createPrivateJournalCorpusStore({ rootDir: restoredRoot, caseId: CASE_ID, corpusId: CORPUS_ID, corpusKey: restoredKey });
  const restoredReader = await openPrivateJournalGraph({
    corpusStore: restoredCorpusStore,
    manifestObjectId: restoredReference.manifest_object_id,
    caseId: CASE_ID,
    corpusId: CORPUS_ID,
    generation: restoredReference.active_generation,
    visibilityEpoch: restoredReference.visibility_epoch,
    cursorSecret: Buffer.alloc(32, 13)
  });
  assert.equal((await restoredReader.search({ query: "capacitymarker", filters: { kinds: ["passage"] }, pageSize: 100 })).records.length, second.entries - 1);
  restoredReader.close();
  restoredCorpusStore.close();
  restoredKey.fill(0);
  restoredCaseStore.close();
  routineKek.fill(0);
  recoverySecret.fill(0);
});
