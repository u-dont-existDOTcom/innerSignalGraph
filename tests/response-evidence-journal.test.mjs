import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateCaseAccessService, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { createJournalResultCache, openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createSessionUseJournalEvidenceProvider } from "../src/journal-import/response-evidence-journal.mjs";
import { createCandidateAuditEvidence } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, assessResponseEvidenceAdmission, buildEvidenceModelView, sha256Json, sha256Text } from "../src/supervisor/response-evidence-contract.mjs";

const CASE = "synthetic-case", CORPUS = "synthetic-corpus", AUTH = { bearerToken: "session-use-grant" };
const fixture = async (name) => JSON.parse(await fs.readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
const review = () => ({ coverage: RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic coverage." })), items: [], missing_material_history: [] });

async function environment(t, { permittedUses = ["archive", "organize_search", "session_use"] } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-evidence-journal-"));
  const keys = { routineKek: Buffer.alloc(32, 51), recoverySecretBytes: Buffer.alloc(32, 52) };
  const store = createEncryptedPrivateCaseStore({ rootDir, ...keys, developmentExternalCredentialAuthorized: true });
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const service = createPrivateCaseAccessService({ rootDir, authorizationProvider: {
    async authorize({ caseId, requiredScope, authContext }) {
      return { allowed: [CASE, "synthetic-other"].includes(caseId), principalId: "synthetic-journal-reader", scopes: [requiredScope],
        purposes: authContext?.bearerToken === "search-only-grant" ? ["organize_search"] : Object.values(PRIVATE_JOURNAL_PURPOSES) };
    }
  }, keyProvider: { async getCaseKeyMaterial() { return { routineKek: Buffer.from(keys.routineKek), recoverySecretBytes: Buffer.from(keys.recoverySecretBytes), accessAssurance: "managed_secret_provider", managedSecretProvider: true }; } } });
  await service.appendTranscriptTurn(CASE, { id: "turn:inbound", exchange_id: "exchange:inbound", role: "user", text: "What helped before?", at: "2026-11-23T12:00:00.000Z", episode_id: null }, AUTH);
  await service.createJournalCorpus(CASE, { corpusId: CORPUS, manifestObjectId: "manifest:staging" }, AUTH);
  const graph = await fixture("synthetic-graph.json"), sources = await fixture("synthetic-sources.json");
  let persisted;
  await service.withJournalCorpus(CASE, CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses, shardTargetBytes: 4096 });
  }, AUTH);
  await service.publishJournalGeneration(CASE, { corpusId: CORPUS, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, AUTH);
  const counts = { inspect: 0, opened: 0, readObjects: 0, cacheHits: 0 }, cachedValues = [];
  const cache = createJournalResultCache();
  const providerOptions = { caseAccessService: {
    verifyCaseAccess: service.verifyCaseAccess,
    inspectJournalCorpus(...args) { counts.inspect++; return service.inspectJournalCorpus(...args); },
    withJournalCorpus: service.withJournalCorpus
  }, corpusId: CORPUS, resultCache: {
    get(key) { const value = cache.get(key); if (value) counts.cacheHits++; return value; },
    set(key, value) { cachedValues.push(value); cache.set(key, value); }
  }, async openReader(input) {
    counts.opened++;
    const original = input.corpusStore;
    return openPrivateJournalGraph({ ...input, corpusStore: { ...original,
      async readJsonObject(...args) { counts.readObjects++; return original.readJsonObject(...args); },
      async readObject(...args) { counts.readObjects++; return original.readObject(...args); }
    } });
  } };
  const provider = createSessionUseJournalEvidenceProvider(providerOptions);
  const retrieve = (extra = {}) => provider.freezeResponseEvidenceJournal({ caseId: CASE, query: "help", maximumTokens: 8000, maximumBytes: 64000, authContext: AUTH, ...extra });
  return { store, service, sources, graph, counts, cachedValues, providerOptions, provider, retrieve };
}

const freezeInput = (journal) => ({ snapshotId: "snapshot:journal:supervisor:r1", owner: { kind: "supervisor_draft", operation_key: "a".repeat(24) }, candidateOrigin: "external_draft",
  inbound: { turn_id: "turn:inbound", exact_text_sha256: sha256Text("What helped before?"), audience: "client", source_kind: "exact_client_turn" }, journal });

test("authorized session-use reading returns exact source spans and a bounded receipt the trusted snapshot store accepts", async (t) => {
  const env = await environment(t), result = await env.retrieve();
  assert.equal(result.availability, "available"); assert.equal(result.retrieval_status, "returned");
  assert.ok(result.source_items.length >= 3); assert.equal(result.receipts.length, 1);
  const sourceBytes = Buffer.from(env.sources.repr, "utf8");
  for (const item of result.source_items) {
    assert.equal(item.exact_excerpt, sourceBytes.subarray(item.locator.start_byte, item.locator.end_byte).toString("utf8"));
    assert.equal(item.locator.corpus_id, CORPUS); assert.equal(item.locator.generation, env.graph.generation);
    assert.equal(item.kind, "journal_quotation"); assert.equal(item.epistemic_status, "client_written_account");
    assert.equal(item.excerpt_sha256, sha256Text(item.exact_excerpt));
  }
  const receipt = result.receipts[0];
  assert.equal(receipt.purpose, "session_use"); assert.equal(receipt.query_sha256, sha256Text("help"));
  assert.equal(receipt.packet_sha256, sha256Json(result.source_items));
  assert.deepEqual(receipt.returned_source_ids, result.source_items.map((item) => item.id));
  assert.equal(receipt.budget_used_bytes, result.source_items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.exact_excerpt)), 0));
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(result));
  assert.deepEqual(snapshot.journal.receipts, result.receipts);
  assert.deepEqual(snapshot.source_items.filter((item) => item.kind === "journal_quotation"), result.source_items);
});

test("a grant without session_use refuses before corpus inspection or any object read, including a cached request", async (t) => {
  const env = await environment(t);
  await env.retrieve();
  const before = { ...env.counts };
  const denied = await env.retrieve({ authContext: { bearerToken: "search-only-grant" } });
  assert.equal(denied.availability, "not_authorized"); assert.equal(denied.retrieval_status, "not_attempted");
  assert.deepEqual(denied.source_items, []); assert.deepEqual(env.counts, before);
});

test("a corpus belonging to another case is refused without opening it", async (t) => {
  const env = await environment(t);
  await env.service.appendTranscriptTurn("synthetic-other", { id: "turn:other", exchange_id: "exchange:other", role: "user", text: "Other case.", at: "2026-11-23T12:00:00.000Z", episode_id: null }, AUTH);
  const result = await env.retrieve({ caseId: "synthetic-other" });
  assert.equal(result.availability, "not_authorized"); assert.equal(env.counts.opened, 0); assert.equal(env.counts.readObjects, 0);
});

test("publication that does not permit session_use is refused without searching", async (t) => {
  const env = await environment(t, { permittedUses: ["archive", "organize_search"] });
  const result = await env.retrieve();
  assert.equal(result.availability, "not_authorized"); assert.equal(env.cachedValues.length, 0);
});

test("a query without matches records no_match, truthful coverage and an empty receipt", async (t) => {
  const env = await environment(t), result = await env.retrieve({ query: "zxqnonexistent" });
  assert.equal(result.retrieval_status, "no_match"); assert.equal(result.more_available, false);
  assert.deepEqual(result.source_items, []); assert.equal(result.receipts[0].returned_source_ids.length, 0);
  assert.match(result.coverage, /0 matching passages/);
  await env.store.freezeResponseEvidence(CASE, freezeInput(result));
});

test("one bounded capped search reports partial and more_available without paging or truncation", async (t) => {
  const env = await environment(t), provider = createSessionUseJournalEvidenceProvider({ ...env.providerOptions, maximumResults: 1 });
  const result = await provider.freezeResponseEvidenceJournal({ caseId: CASE, query: "help", authContext: AUTH });
  assert.equal(result.retrieval_status, "partial"); assert.equal(result.more_available, true); assert.equal(result.source_items.length, 1);
  assert.equal(result.receipts[0].more_available, true); assert.equal(env.counts.opened, 1);
  await env.store.freezeResponseEvidence(CASE, freezeInput(result));
});

test("a quotation larger than either budget is omitted whole with an omission and budget_exhausted", async (t) => {
  const env = await environment(t);
  for (const budget of [{ maximumTokens: 0 }, { maximumBytes: 1 }]) {
    const result = await env.retrieve({ query: "hesitate", ...budget });
    assert.equal(result.retrieval_status, "budget_exhausted"); assert.equal(result.more_available, true);
    assert.deepEqual(result.source_items, []); assert.deepEqual(result.omissions, [{ reason: "journal_budget", count: 1 }]);
    assert.equal(result.budget.used_tokens, 0); assert.equal(result.budget.used_bytes, 0);
    assert.equal(result.receipts[0].omitted_count, 1);
  }
});

test("mixed whole quotations within the budget report partial and include only the bytes actually admitted", async (t) => {
  const env = await environment(t), full = await env.retrieve();
  const cap = Buffer.byteLength(JSON.stringify(full.source_items[0].exact_excerpt));
  const result = await env.retrieve({ maximumBytes: cap });
  assert.equal(result.retrieval_status, "partial"); assert.equal(result.source_items.length, 1);
  assert.deepEqual(result.source_items[0], full.source_items[0]);
  assert.equal(result.budget.used_bytes, cap); assert.ok(result.omissions[0].count >= 2);
  await env.store.freezeResponseEvidence(CASE, freezeInput(result));
});

test("a repeated search uses the existing ID-only cache while reauthorizing and verifying the exact bytes", async (t) => {
  const env = await environment(t), first = await env.retrieve(), firstReads = env.counts.readObjects;
  const second = await env.retrieve();
  assert.equal(env.counts.cacheHits, 1); assert.equal(env.counts.opened, 2);
  assert.ok(env.counts.readObjects - firstReads < firstReads);
  assert.ok(env.cachedValues.every((value) => value.every((id) => typeof id === "string")));
  assert.deepEqual(second.source_items, first.source_items); assert.notEqual(second.receipts[0].operation_id, first.receipts[0].operation_id);
});

test("a visibility epoch change invalidates the earlier governed snapshot at the shared admission check", async (t) => {
  const env = await environment(t), journal = await env.retrieve(), snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal));
  const submitted = await env.store.submitSupervisorDraft(CASE, { operationKey: snapshot.owner.operation_key, source: "external_draft", exactText: "A cautious current-message reply.", producerContextId: "external:writer", channel: "owner_ui",
    responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: null } });
  let record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1);
  const viewSha = buildEvidenceModelView(record, snapshot).view_sha256;
  const audit = createCandidateAuditEvidence({ auditId: "audit:journal", candidate, auditVersion: "private-candidate-audit-v4", auditorContext: { kind: "independent", context_id: "context:journal:auditor" }, findings: [],
    responseEvidence: { snapshotId: snapshot.id, snapshotSha256: snapshot.snapshot_sha256, auditorInclusionSha256: viewSha, review: review(), snapshot } });
  await env.store.recordSupervisorAudit(CASE, candidate.id, audit, { disclosureManifest: { response_evidence_view_included: true }, providerReceipt: { provider: "synthetic", model: "synthetic-reviewer", response_id: "response:journal" } });
  await env.store.approveSupervisorDraft(CASE, candidate.id, audit.id);
  record = await env.store.load(CASE); candidate = record.candidate_responses.at(-1);
  assert.equal(assessResponseEvidenceAdmission(record, candidate).admissible, true);
  await env.service.incrementJournalVisibilityEpoch(CASE, { corpusId: CORPUS, expectedEpoch: snapshot.journal.receipts[0].visibility_epoch }, AUTH);
  record = await env.store.load(CASE); candidate = record.candidate_responses.at(-1);
  assert.equal(assessResponseEvidenceAdmission(record, candidate).code, "RESPONSE_EVIDENCE_STALE");
  await assert.rejects(env.store.exportSupervisorArtifact(CASE, { artifactId: submitted.artifact.artifact_id, channel: "owner_ui" }), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE");
  const oldHits = env.counts.cacheHits;
  assert.equal((await env.retrieve()).availability, "unavailable"); assert.equal(env.counts.cacheHits, oldHits);
});

test("origin/main reads a governed snapshot containing journal quotations and retrieval record", async (t) => {
  const { originMainPrivateCaseValidator } = await import("./helpers/origin-main-private-case-validator.mjs");
  const validateOld = await originMainPrivateCaseValidator(t);
  const env = await environment(t), journal = await env.retrieve();
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal));
  assert.ok(snapshot.source_items.some(item => item.kind === "journal_quotation"));
  assert.ok(snapshot.source_items.some(item => item.kind === "journal_retrieval_record"));
  const record = await env.store.load(CASE);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
});
