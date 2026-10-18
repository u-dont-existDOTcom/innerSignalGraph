import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readingFirstAttestationPayload } from "../src/journal-import/reading-first-order.mjs";
import { journalImportOrder, readingFirstAttestationKey, verifiedReadingFirstSynthesis } from "../src/journal-import/reading-first-runtime-gate.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const CASE_ID = "synthetic-reading-first-integration";
const WRITER = "invented-reading-first-operator-key";
const READER = "invented-reading-first-viewer-key";
const PAGE_TEXT = [
  "January 1 2025. A person chose to keep their promise to a neighbor.",
  "February 1 2025. That person revised an earlier opinion after new evidence.",
  "March 1 2025. They noticed kindness can coexist with a careful boundary."
];
const SOURCE = PAGE_TEXT.join("\n");
const DIGEST = hash(SOURCE);

async function fixture(t, importOrder = "reading_first", handlers = {}, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-reading-first-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  await fs.writeFile(path.join(root, "private", "source.txt"), SOURCE, { mode: 0o600 });
  const cred = path.join(root, "credentials.json");
  await fs.writeFile(cred, JSON.stringify({
    schema_version: 1, root_dir: path.join(root, "vaults"),
    grants: [{ token_sha256: hash(WRITER), principal_id: "synthetic-operator", case_ids: [CASE_ID],
      scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] },
      {token_sha256:hash(READER),principal_id:"synthetic-reader",case_ids:[CASE_ID],
        scopes:["case:read"],purposes:["organize_search","session_use"]}],
    case_keys: { [CASE_ID]: { routine_kek_base64: Buffer.alloc(32, 7).toString("base64"),
      recovery_secret_base64: Buffer.alloc(32, 9).toString("base64") } }
  }), { mode: 0o600 });
  const providers = await loadDevelopmentPrivateCaseProviders(cred);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({
    rootDir: providers.rootDir,
    authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider,
    allowDevelopmentFileProvider: true
  });
  await service.appendJournal(CASE_ID, { id: "synthetic-older-entry", kind: "journal",
    observed_at: "2024-01-01T00:00:00.000Z", text: "Invented prior example." }, { bearerToken: WRITER });
  const config = {
    schema_version: 1, max_external_spend_usd: 0,
    execution_root: path.join(root, "execution"), private_runtime_root: root,
    ...(importOrder === null ? {} : { import_order: importOrder }),
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(SOURCE), sha256: DIGEST },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:consent"
  };
  const configPath = path.join(root, "private", "config.json");
  const sourceParser = async () => ({
    source: { sha256: DIGEST, byte_length: Buffer.byteLength(SOURCE), mime_type: "text/plain" },
    parser: { version: "synthetic-source-parser-v1" },
    pages: PAGE_TEXT.map((text, n) => ({
      page_number: n + 1, representation_id: "synthetic:page:" + (n + 1),
      disposition: overrides.visualPage === n + 1 ? "review_required" : "readable",
      warnings: [], image_inventory: overrides.visualPage === n + 1 ? ["synthetic:image"] : []
    })),
    representations: PAGE_TEXT.map((text, n) => ({
      representation_id: "synthetic:page:" + (n + 1),
      text, utf8_byte_length: Buffer.byteLength(text)
    }))
  });
  const open = (newConfig = config) => openJournalExecutionRuntime({
    config: newConfig, configPath, service,
    inferencePort: createMockJournalInferencePort({ handlers }),
    sourceParser, environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER }
  });
  return { open, service, config, stateFile: path.join(config.execution_root, "state.json") };
}

function attestedJournal({ pending = false, alteredPage = false } = {}) {
  const original = Buffer.alloc(32, 23);
  const key = readingFirstAttestationKey(original);
  const generation = "synthetic:generation";
  const pages = PAGE_TEXT.map((s, i) => ({
    page: i + 1, source_page_sha256: hash(s), required_modalities: "text"
  }));
  const sign = (stage, data) => {
    const receipt = {
      source_sha256: DIGEST, generation, receipt_ref: "synthetic:" + stage, ...data
    };
    receipt.attestation_hmac_sha256 = createHmac("sha256", key)
      .update(readingFirstAttestationPayload(stage, receipt)).digest("hex");
    return { stage, receipt };
  };
  const p = pages.map(({ page, source_page_sha256 }, i) =>
    pending && i === 1
      ? { page, source_page_sha256, status: "REVIEW_PENDING", reason: "visual_pending" }
      : { page, source_page_sha256: alteredPage && i === 2 ? "f".repeat(64) : source_page_sha256,
        status: "REVIEWED_ALL_SOURCE_MODALITIES",
        reviewed_modalities: "text", source_read_receipt_ref: "synthetic:read:" + page,
        read_result_sha256: hash("Source reviewed at original page " + page) });
  const journal = {
    schema_version: 1, source_sha256: DIGEST, generation, page_count: PAGE_TEXT.length,
    archive_receipt_ref: "synthetic:archive:1",
    transitions: [
      sign("SOURCE_INVENTORIED", { page_count: PAGE_TEXT.length, source_inventory_complete: true, source_pages: pages }),
      sign("READING_DISPOSITIONED", { private_coverage_ref: "synthetic:coverage:1", page_dispositions: p }),
      sign("LONGITUDINAL_SYNTHESIZED", {
        reading_receipt_ref: "synthetic:READING_DISPOSITIONED",
        synthesis_evidence_ref: "synthetic:meaning:1", known_vs_new_reconciled: true,
        longitudinal_counterexamples_checked: true
      })
    ]
  };
  return { journal, key, generation };
}

test("the new runtime refuses actual build-quotes and pointer entrypoints without reading receipts", async (t) => {
  const f = await fixture(t, "reading_first");
  const run = await f.open();
  try {
    await run.execute("stage");
    await assert.rejects(run.execute("build-quotes"),
      { code: "JOURNAL_READING_FIRST_STAGE_INCOMPLETE" });
    await assert.rejects(run.execute("publish-quotes"),
      { code: "JOURNAL_READING_FIRST_STAGE_INCOMPLETE" });
    await assert.rejects(run.execute("pointer-reference"),
      { code: "JOURNAL_READING_FIRST_STAGE_INCOMPLETE" });
    const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
    assert.equal(state.import_order, "reading_first");
    assert.equal(state.quote_index, undefined, "No generated index produced");
    assert.equal(state.pointer, undefined, "No pointer run started");
  } finally { await run.close(); }
});

test("new imports default to reading first without changing a legacy saved generation", async (t) => {
  const fresh = await fixture(t, null);
  const run = await fresh.open();
  try {
    await run.execute("stage");
    const state = JSON.parse(await fs.readFile(fresh.stateFile, "utf8"));
    assert.equal(state.import_order, "reading_first");
    await assert.rejects(run.execute("build-quotes"),
      { code: "JOURNAL_READING_FIRST_STAGE_INCOMPLETE" });
  } finally { await run.close(); }

  const old = await fixture(t, "legacy_quote_first");
  const original = await old.open();
  try { await original.execute("stage"); }
  finally { await original.close(); }
  const resumed = await old.open({ ...old.config, import_order: undefined });
  try {
    const state = JSON.parse(await fs.readFile(old.stateFile, "utf8"));
    assert.equal(state.import_order, "legacy_quote_first");
    const report = await resumed.execute("build-quotes");
    assert.ok(report.quote_index.quotes > 0);
  } finally { await resumed.close(); }

  assert.equal(journalImportOrder({}), "reading_first");
  assert.equal(journalImportOrder({}, { existingState: {} }), "legacy_quote_first");
  assert.equal(journalImportOrder({}, { existingState: { import_order: "reading_first" } }),
    "reading_first");
});

test("a legacy staged source still builds its existing exact quote index", async (t) => {
  const f = await fixture(t, "legacy_quote_first");
  const run = await f.open();
  try {
    await run.execute("stage");
    const report = await run.execute("build-quotes");
    assert.ok(report.quote_index.quotes > 0, "Existing lookup preserved");
  } finally { await run.close(); }
});

test("an import cannot flip pipeline order after its generation began", async (t) => {
  const f = await fixture(t, "legacy_quote_first");
  const a = await f.open();
  await a.close();
  await assert.rejects(f.open({ ...f.config, import_order: "reading_first" }),
    { code: "JOURNAL_IMPORT_ORDER_CHANGED" });
});

test("private original-source and modality-bound signed receipts verify before index admission", () => {
  const { journal, key, generation } = attestedJournal();
  const state = verifiedReadingFirstSynthesis({
    sourceSha256: DIGEST, generation, pageCount: PAGE_TEXT.length,
    receiptJournal: journal, attestationKey: key
  });
  assert.equal(state.reviewed_pages, PAGE_TEXT.length);
  assert.equal(state.phase, "LONGITUDINAL_SYNTHESIZED");
  assert.equal(journalImportOrder({ import_order: "reading_first" }), "reading_first");
});

test("forged, misbound, incomplete and pending receipts cannot certify a new generation", () => {
  const { journal, key, generation } = attestedJournal();
  const req = (evidence, signedKey = key) => verifiedReadingFirstSynthesis({
    sourceSha256: DIGEST, generation, pageCount: PAGE_TEXT.length,
    receiptJournal: evidence, attestationKey: signedKey
  });
  assert.throws(() => req({ ...journal, generation: "another" }),
    { code: "JOURNAL_READING_FIRST_STAGE_INCOMPLETE" });
  assert.throws(() => req(journal, Buffer.alloc(32, 18)),
    { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
  const swapped = structuredClone(journal);
  swapped.transitions[1].receipt.page_dispositions[2].source_page_sha256 = "f".repeat(64);
  assert.throws(() => req(swapped),
    { code: "JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED" });
  const pending = attestedJournal({ pending: true });
  assert.throws(() => req(pending.journal, pending.key),
    { code: "JOURNAL_READING_FIRST_REVIEW_PENDING" });
  const altered = attestedJournal({ alteredPage: true });
  assert.throws(() => req(altered.journal, altered.key),
    { code: "JOURNAL_READING_FIRST_PAGE_BINDING_INVALID" });
  assert.throws(() => journalImportOrder({ import_order: "unknown" }),
    { code: "JOURNAL_IMPORT_ORDER_INVALID" });
});

const mockSourceReader = packet => ({
  schema_version:"1.0",page:packet.page,
  source_page_sha256:packet.source_page_sha256,source_read_complete:true,
  reviewed_modalities:"text",
  source_specific_understanding:"One dated source passage reviewed with context.",
  exact_source_anchors:[{exact_text:packet.text.slice(0,37),occurrence:null}],
  source_findings:[{
    statement:"Provisional source-grounded account of a changed commitment.",
    required_qualifiers:["Reported by the synthetic author"],
    anchor_indices:[0]
  }]
});
const mockSynthesis = packet => {
  assert.equal(packet.known_state?.source_scope, "journal_only");
  assert.equal(packet.known_state?.known_vs_new_scope, "imported_journal_only");
  assert.equal(packet.known_state?.case_history_comparison,
    "pending_separate_authorized_step",
    "importing original source does not certify comparison with previous case history");
  const refs=packet.observations.length
    ? packet.observations.map(x=>x.evidence_ref)
    : packet.prior_summaries.flatMap(x=>x.source_evidence_refs);
  return {
    schema_version:"1.0",
    provisional_longitudinal_summary:"Early promise, later revision, and a supportive boundary are distinct episodes.",
    source_evidence_refs:[...new Set(refs)],
    known_vs_new_reconciled:true,longitudinal_counterexamples_checked:true,
    meaningful_changes:refs.length ? [{
      statement:"The response evolves across separately dated entries.",
      evidence_refs:[refs[0]],
      source_kind:"reported_event",uncertainty:"Synthetic illustrative account"
    }] : []
  };
};

test("real importer read-source precedes index and leaves original legacy case data unchanged", async t => {
  const calls={read:0,synth:0};
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{calls.read++;return mockSourceReader(packet);},
    source_synthesizer:packet=>{calls.synth++;return mockSynthesis(packet);}
  });
  const runtime=await f.open();
  try {
    await runtime.execute("stage");
    await assert.rejects(runtime.execute("build-quotes"),{
      code:"JOURNAL_READING_FIRST_STAGE_INCOMPLETE"
    });
    const read=await runtime.execute("read-source");
    assert.equal(read.reading_first.read,3);
    assert.equal(read.reading_first.pending,0);
    assert.ok(calls.read===3 && calls.synth>=1);
    const record=JSON.parse(await fs.readFile(f.stateFile,"utf8"));
    assert.ok(record.reading_first_receipts_ref,"protected reading/synthesis receipts persisted");
    assert.equal(record.quote_index,undefined,"no index created before reading");
    const indexed=await runtime.execute("build-quotes");
    assert.ok(indexed.quote_index.quotes>0);
    assert.ok(indexed.quote_index.reading_facets.facets>0,
      "the index contains derived source-anchored facets from detailed reading");
    await runtime.execute("publish-quotes");
    const stateContext=await f.service.loadPrivateRuntimeCase(CASE_ID,{bearerToken:READER});
    const corpusId=stateContext.journal_corpora.find(x=>x.corpus_id.endsWith(":quotes")).corpus_id;
    const api=createJournalPrivateApi({caseAccessService:f.service});
    const concept=await api.findQuotes({
      caseId:CASE_ID,corpusId,query:"commitment",purpose:"session_use"
    },{bearerToken:READER});
    assert.ok(concept.quotes.length>0,"reading-derived search finds a source passage");
    assert.equal(concept.coverage.reading_facets,true);
    assert.ok(concept.quotes.some(q=>q.matched_by==="reading"),
      "provisional interpretation matches are labeled separately");
    assert.ok(concept.quotes.every(q=>!q.text.includes("commitment")),
      "the source quote remains unchanged rather than copying model prose");
    const again=await runtime.execute("read-source");
    assert.equal(again.reading_first.read,3);
    assert.equal(calls.read,3,"replay resumes already attested generation without sending again");
  } finally { await runtime.close(); }
});

test("real importer marks mixed-visual pages pending and forbids a complete new index", async t => {
  const called=[];
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{called.push(packet.page);return mockSourceReader(packet);},
    source_synthesizer:mockSynthesis
  },{visualPage:2});
  const runtime=await f.open();
  try {
    const report=await runtime.execute("read-source");
    assert.equal(report.reading_first.pending,1);
    assert.deepEqual(called,[1,3],"mixed-media page was not exposed to a text-only reader");
    await assert.rejects(runtime.execute("build-quotes"),{
      code:"JOURNAL_READING_FIRST_REVIEW_PENDING"
    });
    const state=JSON.parse(await fs.readFile(f.stateFile,"utf8"));
    assert.equal(state.quote_index,undefined);
    assert.ok(state.reading_first_receipts_ref);
  } finally {await runtime.close();}
});
