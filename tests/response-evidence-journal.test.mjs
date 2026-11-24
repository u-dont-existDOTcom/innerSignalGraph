import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateCaseAccessService, PRIVATE_JOURNAL_PURPOSES } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { persistGraphGeneration } from "../src/journal-import/graph.mjs";
import { createJournalResultCache, openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";
import { createSessionUseJournalEvidenceProvider, SESSION_USE_READER_LIMITS, SESSION_USE_READER_VERSION } from "../src/journal-import/response-evidence-journal.mjs";
import { quoteCues } from "../src/journal-import/quote-index.mjs";
import { createCandidateAuditEvidence } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, assessResponseEvidenceAdmission, buildEvidenceModelView, responseEvidenceRefreshJournal,
  responseEvidenceSnapshotCurrent, responseEvidenceSnapshotSha256, sha256Json, sha256Text, validateResponseEvidenceSnapshot } from "../src/supervisor/response-evidence-contract.mjs";
import { inventedPages, inventedParagraphs, persistInventedJournal } from "./helpers/invented-journal.mjs";

const CASE = "synthetic-case", CORPUS = "synthetic-corpus", AUTH = { bearerToken: "session-use-grant" };
const fixture = async (name) => JSON.parse(await fs.readFile(new URL(`../schemas/journal-import/fixtures/${name}`, import.meta.url), "utf8"));
const review = () => ({ coverage: RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic coverage." })), items: [], missing_material_history: [] });

// `journal`, when given, is an invented journal's options (helpers/invented-journal.mjs) in place of the synthetic fixture.
async function environment(t, { permittedUses = ["archive", "organize_search", "session_use"], journal = null } = {}) {
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
  let persisted, invented = null;
  await service.withJournalCorpus(CASE, CORPUS, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    if (journal) {
      invented = await persistInventedJournal({ corpusStore, caseId: CASE, corpusId: CORPUS, permittedUses, ...journal });
      persisted = invented.persisted;
    } else persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: sources, permittedUses, shardTargetBytes: 4096 });
  }, AUTH);
  const generation = invented?.generation ?? graph.generation;
  await service.publishJournalGeneration(CASE, { corpusId: CORPUS, generation, manifestObjectId: persisted.manifest_object_id }, AUTH);
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
  return { store, service, sources, graph, counts, cachedValues, providerOptions, provider, retrieve, invented, generation };
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
  assert.equal(receipt.manifest_object_id, (await env.store.load(CASE)).journal_corpora[0].manifest_object_id);
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

test("freeze omits an older-generation no-match receipt when publication changes after retrieval", async (t) => {
  const env = await environment(t), journal = await env.retrieve({ query: "zxqnonexistent" });
  assert.equal(journal.retrieval_status, "no_match");
  await env.store.publishJournalGeneration(CASE, { corpusId: CORPUS, generation: "generation:replacement",
    manifestObjectId: "manifest:replacement", expectedGeneration: env.graph.generation });
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal));
  assert.deepEqual(snapshot.journal.receipts, []);
  assert.equal(snapshot.journal.availability, "unavailable");
  assert.equal(snapshot.journal.retrieval_status, "partial");
  assert.equal(snapshot.journal.more_available, true);
  assert.deepEqual(snapshot.journal.omissions, [{ reason: "journal_binding_changed", count: 1 }]);
  assert.equal(responseEvidenceSnapshotCurrent(await env.store.load(CASE), { snapshot }), true);
});

test("freeze omits quotations and their receipt after a same-generation manifest replacement", async (t) => {
  const env = await environment(t), journal = await env.retrieve();
  assert.ok(journal.source_items.length > 0);
  await env.store.publishJournalGeneration(CASE, { corpusId: CORPUS, generation: env.graph.generation,
    manifestObjectId: "manifest:replacement", expectedGeneration: env.graph.generation });
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal));
  assert.deepEqual(snapshot.journal.receipts, []);
  assert.equal(snapshot.source_items.some(item => item.kind === "journal_quotation"), false);
  assert.equal(snapshot.journal.retrieval_status, "partial");
  assert.equal(snapshot.journal.more_available, true);
  assert.deepEqual(snapshot.journal.omissions, [{ reason: "journal_binding_changed", count: 1 }]);
  assert.equal(snapshot.journal.budget.used_bytes, 0);
  assert.equal(snapshot.journal.budget.used_tokens, 0);
  assert.equal(responseEvidenceSnapshotCurrent(await env.store.load(CASE), { snapshot }), true);
});

test("a current no-match receipt retains the exact searched publication and remains valid", async (t) => {
  const env = await environment(t), journal = await env.retrieve({ query: "zxqnonexistent" });
  const record = await env.store.load(CASE), publication = record.journal_corpora[0], receipt = journal.receipts[0];
  assert.equal(receipt.corpus_id, publication.corpus_id);
  assert.equal(receipt.generation, publication.active_generation);
  assert.equal(receipt.visibility_epoch, publication.visibility_epoch);
  assert.equal(receipt.manifest_object_id, publication.manifest_object_id);
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal));
  assert.deepEqual(snapshot.journal.receipts, journal.receipts);
  assert.equal(snapshot.journal.retrieval_status, "no_match");
  assert.equal(snapshot.journal.more_available, false);
  assert.deepEqual(snapshot.journal.omissions, []);
  assert.equal(responseEvidenceSnapshotCurrent(await env.store.load(CASE), { snapshot }), true);
  const missingIdentity = structuredClone(snapshot);
  delete missingIdentity.journal.receipts[0].manifest_object_id;
  missingIdentity.snapshot_sha256 = responseEvidenceSnapshotSha256(missingIdentity);
  assert.throws(() => validateResponseEvidenceSnapshot(missingIdentity), { code: "RESPONSE_EVIDENCE_INVALID" });
  const wrongIdentity = structuredClone(snapshot);
  wrongIdentity.journal.receipts[0].manifest_object_id = "manifest:foreign";
  wrongIdentity.snapshot_sha256 = responseEvidenceSnapshotSha256(wrongIdentity);
  assert.throws(() => validateResponseEvidenceSnapshot(wrongIdentity), { code: "RESPONSE_EVIDENCE_INVALID" });
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

for (const change of ["visibility epoch", "manifest at the same generation"]) test(`a journal ${change} change invalidates the earlier governed snapshot at the shared admission check`, async (t) => {
  const env = await environment(t), journal = await env.retrieve(), snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal));
  const submitted = await env.store.submitSupervisorDraft(CASE, { operationKey: snapshot.owner.operation_key, source: "external_draft", exactText: "A cautious current-message reply.", producerContextId: "external:writer", channel: "owner_ui",
    responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: null } });
  let record = await env.store.load(CASE), candidate = record.candidate_responses.at(-1);
  const viewSha = buildEvidenceModelView(record, snapshot).view_sha256;
  const audit = createCandidateAuditEvidence({ auditId: "audit:journal", candidate, auditVersion: "private-candidate-audit-v4", auditorContext: { kind: "independent", context_id: "context:journal:auditor" }, findings: [],
    responseEvidence: { snapshotId: snapshot.id, snapshotSha256: snapshot.snapshot_sha256, auditorInclusionSha256: viewSha, review: review(), snapshot } });
  const started = await env.store.startSupervisorInvocation(CASE, { operationKey: snapshot.owner.operation_key, stage: "audit", candidateId: candidate.id,
    snapshotId: snapshot.id, attemptContextId: "attempt:journal:audit" });
  await env.store.completeSupervisorInvocation(CASE, { startedId: started.id, output: { contextId: audit.auditor_context_id,
    providerReceipt: { provider: "synthetic", model: "synthetic-reviewer", response_id: "response:journal" },
    responseEvidenceInclusion: { snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256, view_sha256: viewSha },
    value: { findings: [], repair_induced_checks: [], evidence_review: review() } } });
  await env.store.recordSupervisorAudit(CASE, candidate.id, audit, { disclosureManifest: { response_evidence_view_included: true }, providerReceipt: { provider: "synthetic", model: "synthetic-reviewer", response_id: "response:journal" } });
  await env.store.approveSupervisorDraft(CASE, candidate.id, audit.id);
  record = await env.store.load(CASE); candidate = record.candidate_responses.at(-1);
  assert.equal(assessResponseEvidenceAdmission(record, candidate).admissible, true);
  if (change === "visibility epoch") await env.service.incrementJournalVisibilityEpoch(CASE, { corpusId: CORPUS, expectedEpoch: snapshot.journal.receipts[0].visibility_epoch }, AUTH);
  else await env.store.publishJournalGeneration(CASE, { corpusId: CORPUS, generation: snapshot.journal.receipts[0].generation,
    manifestObjectId: "manifest:replacement", expectedGeneration: snapshot.journal.receipts[0].generation });
  record = await env.store.load(CASE); candidate = record.candidate_responses.at(-1);
  assert.equal(assessResponseEvidenceAdmission(record, candidate).code, "RESPONSE_EVIDENCE_STALE");
  await assert.rejects(env.store.exportSupervisorArtifact(CASE, { artifactId: submitted.artifact.artifact_id, channel: "owner_ui" }), (error) => error.code === "SUPERVISOR_ARTIFACT_STALE");
  if (change === "visibility epoch") {
    const oldHits = env.counts.cacheHits;
    assert.equal((await env.retrieve()).availability, "unavailable"); assert.equal(env.counts.cacheHits, oldHits);
  }
  const refreshed = await env.store.freezeResponseEvidence(CASE, { ...freezeInput(responseEvidenceRefreshJournal(record, snapshot)),
    snapshotId: "snapshot:journal:supervisor:r2", revision: 2, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" });
  assert.equal(refreshed.journal.availability, "unavailable");
  assert.equal(refreshed.source_items.some(item => item.kind === "journal_quotation"), false);
  assert.doesNotThrow(() => buildEvidenceModelView(record, refreshed));
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

test("legacy journal bindings remain loadable but cannot attest quotations during a refresh", async (t) => {
  const env = await environment(t), journal = await env.retrieve();
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(journal)), legacy = structuredClone(snapshot);
  for (const binding of legacy.dependency_binding.journal_bindings) delete binding.manifest_object_id;
  legacy.snapshot_sha256 = responseEvidenceSnapshotSha256(legacy);
  assert.doesNotThrow(() => validateResponseEvidenceSnapshot(legacy));
  const record = await env.store.load(CASE);
  assert.equal(responseEvidenceSnapshotCurrent(record, { snapshot: legacy }), false);
  assert.doesNotThrow(() => buildEvidenceModelView(record, legacy));
  const refreshed = responseEvidenceRefreshJournal(record, legacy);
  assert.equal(refreshed.availability, "unavailable");
  assert.deepEqual(refreshed.source_items, []);
  assert.ok(refreshed.omissions.some(entry => entry.reason === "journal_binding_changed"));
});

// The fault the search of 24 Nov 2026 fixes: the whole message was searched for passages holding every one of its words, so an
// ordinary message found nothing, and every test used one to three words the journal holds.
test("whole messages about what the journal tells find it, where a search for every word of the message found nothing", async (t) => {
  const env = await environment(t);
  const texts = async (query) => (await env.retrieve({ query })).source_items.map((item) => item.exact_excerpt.trim());
  for (const query of ["I find it hard to ask for help", "Last week I told you I hesitate to ask my colleague for help, what helped me before?", "Did I ever ask a colleague for help?"]) {
    assert.ok((await texts(query)).includes("Tomorrow I plan to ask a colleague for help."), query);
  }
  assert.deepEqual(await texts("I keep having that dream about the missed appointment"), ["I dreamed I had missed the appointment."]);
  assert.deepEqual(await texts("my arm still hurts"), ["I felt calmer afterward, but the discomfort in my arm continued."]);
});

const ENGLISH_QUOTE = "The workshop by the river smelled of sawdust and varnish. When Father shouted I hid under the bench, and my jaw stayed locked until the evening.";
const ENGLISH_MESSAGE = "I've been going back and forth all week about the letter from my father. He wants to sell the workshop by the river, and when I read that my jaw locked again and I couldn't breathe properly. I keep telling myself that it's only a building and that things change, but I can't sleep, and at work I stare at the screen and nothing gets done. My colleague says I should just call him and talk about it. I feel so tired today, I felt lost all morning, and I don't know what to do with all of this or what I actually want.";
const FRENCH_QUOTE = "La véranda sentait la confiture de mirabelles. Quand maman se taisait trois jours, je comptais les carreaux et j'avais la gorge nouée.";
const FRENCH_MESSAGE = "Depuis que ma sœur m'a dit qu'elle vendait la maison, je ne dors plus. Hier j'ai retrouvé une photo de la véranda et j'ai eu la gorge nouée toute la journée, comme quand maman se taisait. Au travail je ne sais plus quoi faire, je me sens fatiguée et lourde, je pense à tout cela la nuit et rien ne change. Ma collègue me dit d'en parler avec elle, mais je ne sais pas ce que je veux aujourd'hui, ni ce que je pourrais lui dire sans pleurer.";
const withQuotes = (...quotes) => {
  const paragraphs = inventedParagraphs();
  quotes.forEach((quote, index) => paragraphs.splice(137 + 61 * index, 0, quote));
  return paragraphs;
};

for (const index of ["quote-index-v4", "quote-index-v2", "none"]) test(`a whole message of real length finds the one quote that matters among a few hundred, in English and in French (${index})`, async (t) => {
  const env = await environment(t, { journal: { index, pages: inventedPages(withQuotes(ENGLISH_QUOTE, FRENCH_QUOTE)) } });
  for (const [query, quote] of [[ENGLISH_MESSAGE, ENGLISH_QUOTE], [FRENCH_MESSAGE, FRENCH_QUOTE]]) {
    const result = await env.retrieve({ query });
    assert.equal(result.availability, "available");
    assert.equal(result.source_items[0]?.exact_excerpt, quote, "first of all the quotations");
    assert.ok(result.source_items.length <= 6, "no more than six");
  }
});

test("a long message of everyday things finds the quote its last sentence is about", async (t) => {
  const everyday = inventedParagraphs({ size: 60, seed: 99 }).filter((_, index) => index % 3 !== 2).slice(0, 20).join(" ");
  const query = `${everyday} But what I really came to say is about the workshop: I went back to the river and my jaw locked.`;
  assert.ok(query.length > 3_000 && query.length < 4_000, String(query.length));
  for (const index of ["quote-index-v4", "none"]) {
    const env = await environment(t, { journal: { index, pages: inventedPages(withQuotes(ENGLISH_QUOTE, FRENCH_QUOTE)) } });
    const result = await env.retrieve({ query });
    assert.equal(result.source_items[0]?.exact_excerpt, ENGLISH_QUOTE, index);
  }
});

// Paragraphs whose words are their own (each with a digit, so they read the same exactly and through the forms reading), and the words
// given: `held` maps a word to the paragraphs that hold it.
const numbered = (size, held = {}) => Array.from({ length: size }, (_, index) => `${[`own${index}a`, `own${index}b`, `own${index}c`, ...Object.keys(held).filter((word) => held[word].includes(index))].join(" ")}.`);
const range = (from, to) => Array.from({ length: to - from }, (_, index) => from + index);

test("the reader's limits and its version, which names them and the search it makes", () => {
  assert.deepEqual(SESSION_USE_READER_LIMITS, { message: 6, expanded: 12, questions: 4 });
  assert.equal(SESSION_USE_READER_VERSION, "session-use-reader-v2:evidence-quotes-v1");
  for (const maximumResults of [0, 13, 40, 1.5]) assert.throws(() => createSessionUseJournalEvidenceProvider({ caseAccessService: { verifyCaseAccess() {}, inspectJournalCorpus() {}, withJournalCorpus() {} }, corpusId: CORPUS, maximumResults }), { code: "RESPONSE_EVIDENCE_INVALID" });
});

test("a message gets its six best quotations at most, in their ranked order in the snapshot and the models' view, and the coverage says how many matched", async (t) => {
  const env = await environment(t, { journal: { pages: inventedPages(numbered(40, { lantern1: range(3, 12), strong1: [5, 9], strong2: [9] })) } });
  const result = await env.retrieve({ query: "lantern1 strong1 strong2" });
  assert.equal(result.source_items.length, 6);
  assert.deepEqual(result.source_items.slice(0, 2).map((item) => /^own(\d+)a/u.exec(item.exact_excerpt)[1]), ["9", "5"], "the best first");
  assert.deepEqual([result.retrieval_status, result.more_available], ["partial", true]);
  assert.match(result.coverage, /^One ranked search for the message's less common words; 9 matching passages; 6 exact quotations returned\. Sharing words doesn't make a quotation relevant to the message, and wording cues are found for English wording only\./u);
  assert.match(result.coverage, /no review of the whole journal/u);
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(result));
  const quotations = (items) => items.filter((item) => item.kind === "journal_quotation").map((item) => item.exact_excerpt);
  assert.deepEqual(quotations(snapshot.source_items), result.source_items.map((item) => item.exact_excerpt));
  assert.deepEqual(quotations(buildEvidenceModelView(await env.store.load(CASE), snapshot).view.source_items), result.source_items.map((item) => item.exact_excerpt));
  assert.equal(result.receipts[0].filters_sha256, sha256Json({ reader: SESSION_USE_READER_VERSION, limit: 6 }), "what was asked for, the method with its numbers included");
  // The best one doesn't fit what is left of the budget: it is left out whole, and the next ones that do are numbered from the first.
  const [best, next] = result.source_items;
  const tight = await env.retrieve({ query: "lantern1 strong1 strong2", maximumBytes: Buffer.byteLength(JSON.stringify(next.exact_excerpt)) });
  assert.ok(Buffer.byteLength(best.exact_excerpt) > Buffer.byteLength(next.exact_excerpt));
  assert.deepEqual(tight.source_items.map((item) => [item.id, item.exact_excerpt]), [["src:journal:1", next.exact_excerpt]]);
  assert.deepEqual([tight.omissions, tight.retrieval_status], [[{ reason: "journal_budget", count: 5 }], "partial"]);
});

test("a message of common words only, of no known word, of one word or of none is no match and no failure", async (t) => {
  const env = await environment(t, { journal: { pages: inventedPages(inventedParagraphs()) } });
  for (const query of ["I feel so tired today and I don't know what I want.", "zxqnonexistent", "yes", "why me", "…", "!!!"]) {
    const result = await env.retrieve({ query });
    assert.deepEqual([result.availability, result.retrieval_status, result.more_available, result.source_items, result.omissions], ["available", "no_match", false, [], []], query);
    assert.match(result.coverage, /; 0 matching passages; 0 exact quotations returned\./u);
    assert.deepEqual(result.receipts[0].returned_source_ids, []);
  }
  await env.store.freezeResponseEvidence(CASE, freezeInput(await env.retrieve({ query: "…" })));
});

// `addsTo`: the journal part of the snapshot the expansion adds to, with its quotations.
const expand = (env, questions, addsTo = null, extra = {}) => env.provider.freezeResponseEvidenceJournal({ caseId: CASE, query: questions.join("\n").slice(0, 4000), questions, addsTo, authContext: AUTH, ...extra });
const placeOf = (item) => Number(/^own(\d+)a/u.exec(item.exact_excerpt)[1]);

test("an expansion searches each question on its own and takes the best of each in turn, without repeats", async (t) => {
  const env = await environment(t, { journal: { pages: inventedPages(numbered(60, { first1: [1, 2, 3, 4], strong1: [1], second1: [4, 11, 12], strong2: [4], third1: [21], strong3: [21], noise1: range(30, 55) })) } });
  const questions = ["What about noise1 and first1 strong1?", "second1 strong2 noise1?", "And third1 strong3?"];
  const alone = [];
  for (const query of questions) alone.push((await env.retrieve({ query })).source_items.map(placeOf));
  assert.deepEqual([alone[0][0], alone[1][0], alone[2]], [1, 4, [21]]);
  const result = await expand(env, questions);
  const order = result.source_items.map(placeOf);
  assert.deepEqual(order.slice(0, 3), [1, 4, 21], "the best of each question");
  assert.deepEqual([...order].sort((left, right) => left - right), [1, 2, 3, 4, 11, 12, 21], "every match once, the one two questions share included");
  // In turn: the first question's second, then the second question's second, and so on.
  const turns = [];
  const taken = new Set();
  const queues = alone.map((list) => [...list]);
  while (queues.some((queue) => queue.length)) for (const queue of queues) {
    while (queue.length && taken.has(queue[0])) queue.shift();
    if (queue.length) { taken.add(queue[0]); turns.push(queue.shift()); }
  }
  assert.deepEqual(order, turns);
  assert.deepEqual([result.retrieval_status, result.more_available, result.omissions], ["returned", false, []]);
  assert.match(result.coverage, /^3 ranked searches, one for each missing-history question, for its less common words; 8 matching passages, counted for each question; 7 exact quotations added\./u);
  assert.equal(result.receipts[0].query_sha256, sha256Text(questions.join("\n")));
  // Joined into one search, as before, the three questions' words would compete for one ranking; each is searched for itself.
  assert.notDeepEqual((await env.retrieve({ query: questions.join("\n") })).source_items.map(placeOf), order);
});

test("at most four questions are searched, and the coverage, the omissions and more_available say what wasn't", async (t) => {
  const env = await environment(t, { journal: { pages: inventedPages(numbered(40, { one1: [1], two1: [2], three1: [3], four1: [4], five1: [5] })) } });
  const result = await expand(env, ["one1?", "two1?", "three1?", "four1?", "five1?"]);
  assert.deepEqual(result.source_items.map(placeOf), [1, 2, 3, 4]);
  assert.deepEqual([result.omissions, result.more_available, result.retrieval_status], [[{ reason: "question_limit", count: 1 }], true, "partial"]);
  assert.match(result.coverage, /^4 ranked searches/u);
  assert.equal(result.receipts[0].query_sha256, sha256Text("one1?\ntwo1?\nthree1?\nfour1?"), "the questions that were searched");
});

test("an expansion adds to the part the turn has: its quotations keep their ids and receipt, its coverage and limits stay, and the snapshot holds twelve at most", async (t) => {
  const env = await environment(t, { journal: { pages: inventedPages(numbered(60, { lantern1: range(0, 6), question1: [3, ...range(20, 29)], question2: range(40, 49) })) } });
  const first = await env.retrieve({ query: "lantern1" });
  assert.deepEqual([first.source_items.length, first.more_available], [6, false]);
  const initial = await env.store.freezeResponseEvidence(CASE, freezeInput(first));
  const result = await expand(env, ["question1?", "question2?"], first);
  assert.equal(result.source_items.length, 12);
  assert.deepEqual(result.source_items.slice(0, 6), first.source_items, "the same quotations under the same ids");
  assert.deepEqual(result.source_items.map((item) => item.id), range(1, 13).map((number) => `src:journal:${number}`));
  const added = result.source_items.slice(6).map(placeOf);
  assert.equal(added.includes(3), false, "the one it had already");
  assert.deepEqual([added.filter((place) => place < 30).length, added.filter((place) => place >= 40).length], [3, 3], "three of each question, in turn");
  assert.deepEqual([result.more_available, result.retrieval_status], [true, "partial"]);
  const bytes = (items) => items.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.exact_excerpt)), 0);
  assert.equal(result.budget.used_bytes, bytes(result.source_items));
  // Each receipt says what its own retrieval returned.
  assert.deepEqual(result.receipts.slice(1), first.receipts);
  assert.deepEqual([result.receipts[0].returned_source_ids, result.receipts[0].packet_sha256, result.receipts[0].budget_used_bytes],
    [result.source_items.slice(6).map((item) => item.id), sha256Json(result.source_items.slice(6)), bytes(result.source_items.slice(6))]);
  assert.equal(result.coverage.startsWith(`${first.coverage} 2 ranked searches, one for each missing-history question, for its less common words; 19 matching passages, counted for each question; 6 exact quotations added.`), true, result.coverage);
  const expanded = await env.store.freezeResponseEvidence(CASE, { ...freezeInput(result), snapshotId: "snapshot:journal:supervisor:r2", revision: 2, parentSnapshotId: initial.id, revisionReason: "evidence_expansion" });
  assert.deepEqual(expanded.source_items.filter((item) => item.kind === "journal_quotation"), result.source_items);
  assert.deepEqual(expanded.journal.receipts, result.receipts);
  // Nothing new found: what the turn had stays, and the coverage says nothing was added.
  const nothing = await expand(env, ["zxqnonexistent?"], first);
  assert.deepEqual([nothing.source_items, nothing.retrieval_status], [first.source_items, "returned"]);
  assert.match(nothing.coverage, /; 0 matching passages, counted for each question; 0 exact quotations added\./u);
  // What the message's own search left out is still left out.
  const limited = await expand(env, ["zxqnonexistent?"], { ...first, more_available: true, omissions: [{ reason: "restricted_quotation", count: 2 }] });
  assert.deepEqual([limited.more_available, limited.retrieval_status, limited.omissions, limited.receipts[0].omitted_count], [true, "partial", [{ reason: "restricted_quotation", count: 2 }], 0]);
  // Quotations of another publication, or without their receipt, aren't added to; a part that isn't a journal's, a refusal or an altered quotation leaves none.
  const foreign = { ...first, source_items: first.source_items.map((item, index) => (index ? item : { ...item, locator: { ...item.locator, generation: "generation:other" } })) };
  const partial = await expand(env, ["zxqnonexistent?"], foreign);
  assert.deepEqual([partial.source_items, partial.omissions, partial.more_available], [first.source_items.slice(1), [{ reason: "journal_binding_changed", count: 1 }], true]);
  assert.deepEqual((await expand(env, ["zxqnonexistent?"], { ...first, receipts: [] })).source_items, []);
  assert.deepEqual((await expand(env, ["zxqnonexistent?"], { ...first, receipts: first.receipts.map((receipt) => ({ ...receipt, manifest_object_id: "manifest:other" })) })).source_items, []);
  assert.deepEqual((await expand(env, ["zxqnonexistent?"], { ...first, availability: "not_authorized" })).source_items, []);
  assert.deepEqual((await expand(env, ["question1?"], first, { authContext: { bearerToken: "search-only-grant" } })).source_items, []);
  const altered = { ...first, source_items: first.source_items.map((item, index) => (index ? item : { ...item, exact_excerpt: "Other words." })) };
  assert.deepEqual([(await expand(env, ["question1?"], altered)).availability, (await expand(env, ["question1?"], altered)).source_items], ["unavailable", []]);
  // One budget for the whole snapshot.
  const tight = await expand(env, ["question1?"], first, { maximumBytes: first.budget.used_bytes });
  assert.deepEqual([tight.source_items, tight.omissions[0].reason], [first.source_items, "journal_budget"]);
});

test("the purpose is checked before the arguments are looked at, and arguments out of bounds are refused then", async (t) => {
  const env = await environment(t);
  const bad = [{ query: "" }, { query: "  " }, { query: null }, { query: "x".repeat(4001) }, { questions: [] }, { questions: "help" }, { questions: ["help", ""] }, { questions: ["x".repeat(4001)] },
    { addsTo: { source_items: [], receipts: [], omissions: [] } }, { questions: ["help"], addsTo: "part" }, { questions: ["help"], addsTo: { source_items: [] } }, { maximumTokens: 8001 }, { maximumBytes: -1 }];
  for (const extra of bad) {
    const before = { ...env.counts };
    assert.equal((await env.retrieve({ ...extra, authContext: { bearerToken: "search-only-grant" } })).availability, "not_authorized", JSON.stringify(extra).slice(0, 80));
    await assert.rejects(env.retrieve(extra), { code: "RESPONSE_EVIDENCE_INVALID" });
    assert.deepEqual(env.counts, before, "nothing was opened or inspected");
  }
});

test("a quotation that may not be used is an omission with its reason; one a later entry corrected is a quotation that says so", async (t) => {
  const pages = inventedPages(numbered(30, { lantern1: range(0, 4) }));
  const at = (place) => (node) => node.data.quote?.startsWith(`own${place}a `);
  const env = await environment(t, { journal: { pages, change: (node) => {
    if (at(0)(node)) node.lifecycle = "revoked";
    else if (at(1)(node)) { node.data.quote = null; node.data.disclosure = "restricted"; }
    else if (at(2)(node)) node.lifecycle = "superseded";
  } } });
  const provider = createSessionUseJournalEvidenceProvider({ ...env.providerOptions, journalNotes: true });
  const result = await provider.freezeResponseEvidenceJournal({ caseId: CASE, query: "lantern1", authContext: AUTH });
  assert.deepEqual(result.source_items.map((item) => [placeOf(item), item.journal_note.lifecycle]).sort(), [[2, "superseded"], [3, "active"]]);
  assert.deepEqual([...result.omissions].sort((left, right) => left.reason.localeCompare(right.reason)), [{ reason: "deleted_or_revoked_quotation", count: 1 }, { reason: "restricted_quotation", count: 1 }]);
  assert.deepEqual([result.retrieval_status, result.more_available, result.receipts[0].omitted_count], ["partial", true, 2]);
  await env.store.freezeResponseEvidence(CASE, freezeInput(result));
});

test("with notes asked for, each quotation says when it was written, its cues and its lifecycle, in the snapshot and the models' view; without, none does", async (t) => {
  const quote = "I dreamt the lighthouse1 was empty. Maybe it was only a dream.";
  const env = await environment(t, { journal: { pages: inventedPages([quote, ...numbered(12)], { dates: new Map([[0, "3 mars 2019"]]) }) } });
  const ask = (options) => createSessionUseJournalEvidenceProvider({ ...env.providerOptions, ...options }).freezeResponseEvidenceJournal({ caseId: CASE, query: "lighthouse1", authContext: AUTH });
  const result = await ask({ journalNotes: true });
  const note = { written: { from: "2019-03-03", to: "2019-03-03", precision: "day", between: false, ambiguous: false, year_inferred: false }, cues: quoteCues(quote).map((cue) => ({ ...cue })), lifecycle: "active" };
  assert.deepEqual(result.source_items.map((item) => [item.exact_excerpt, item.journal_note, item.time]), [[quote, note, { at: null, status: "unavailable" }]]);
  assert.equal(result.receipts[0].packet_sha256, sha256Json(result.source_items), "the receipt covers the notes");
  const snapshot = await env.store.freezeResponseEvidence(CASE, freezeInput(result));
  const noted = (items) => items.filter((item) => item.journal_note !== undefined).map((item) => [item.kind, item.journal_note]);
  assert.deepEqual(noted(snapshot.source_items), [["journal_quotation", note]]);
  assert.deepEqual(noted(buildEvidenceModelView(await env.store.load(CASE), snapshot).view.source_items), [["journal_quotation", note]]);
  assert.equal(Object.hasOwn((await ask({})).source_items[0], "journal_note"), false);
  assert.throws(() => createSessionUseJournalEvidenceProvider({ ...env.providerOptions, journalNotes: "yes" }), { code: "RESPONSE_EVIDENCE_INVALID" });
});

test("a publication that changes while the journal is read gives nothing: before it opens, before the search, after it, and at the end", async (t) => {
  const env = await environment(t);
  const asked = { count: 0 };
  // The corpus is asked for once before it opens, then before and after the search, and once more at the end.
  for (const changesAt of [1, 2, 3, 4]) {
    asked.count = 0;
    const provider = createSessionUseJournalEvidenceProvider({ ...env.providerOptions, resultCache: createJournalResultCache(), caseAccessService: { ...env.providerOptions.caseAccessService,
      async inspectJournalCorpus(...args) {
        const inspected = await env.service.inspectJournalCorpus(...args);
        return (++asked.count) >= changesAt ? { ...inspected, reference: { ...inspected.reference, visibility_epoch: inspected.reference.visibility_epoch + 1 } } : inspected;
      } } });
    const result = await provider.freezeResponseEvidenceJournal({ caseId: CASE, query: "help", authContext: AUTH });
    assert.deepEqual([result.availability, result.retrieval_status, result.source_items, result.receipts], ["unavailable", "failed", [], []], `changed at ${changesAt}`);
    assert.equal(asked.count, changesAt, "no retry by another route");
  }
  assert.equal((await env.retrieve()).availability, "available");
});
