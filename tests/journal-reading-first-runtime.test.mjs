import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readingFirstAttestationPayload } from "../src/journal-import/reading-first-order.mjs";
import { journalImportOrder, readingFirstAttestationKey, verifiedReadingFirstSynthesis } from "../src/journal-import/reading-first-runtime-gate.mjs";
import { canonicalJson } from "../src/journal-import/reading-first-operator-review.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { JournalInferencePortError, createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
import { openPrivateJournalGraph } from "../src/journal-import/retrieval.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const CASE_ID = "synthetic-reading-first-integration";
const WRITER = "invented-reading-first-operator-key";
const READER = "invented-reading-first-viewer-key";
// A grant for the correct purpose only, which a rollback needs and the import's own grant does not have.
const CORRECTOR = "invented-reading-first-corrector-key";
const PAGE_TEXT = [
  "January 1 2025. A person chose to keep their promise to a neighbor.",
  "February 1 2025. That person revised an earlier opinion after new evidence.",
  "March 1 2025. They noticed kindness can coexist with a careful boundary."
];
const SOURCE = PAGE_TEXT.join("\n");
const DIGEST = hash(SOURCE);
// The digest the importer gives a page that has a picture: it binds the page's place in the source, not its text.
const pageDigest = (page, source = DIGEST) => hash(JSON.stringify({ original_source_sha256: source,
  source_page_number: page, representation_id: "synthetic:page:" + page }));

// One synthetic private root with a case, its grants and its access service, shared by the runs a test opens in it.
async function environment(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-reading-first-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  const cred = path.join(root, "credentials.json");
  await fs.writeFile(cred, JSON.stringify({
    schema_version: 1, root_dir: path.join(root, "vaults"),
    grants: [{ token_sha256: hash(WRITER), principal_id: "synthetic-operator", case_ids: [CASE_ID],
      scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] },
      {token_sha256:hash(READER),principal_id:"synthetic-reader",case_ids:[CASE_ID],
        scopes:["case:read"],purposes:["organize_search","session_use"]},
      {token_sha256:hash(CORRECTOR),principal_id:"synthetic-corrector",case_ids:[CASE_ID],
        scopes:["case:write"],purposes:["correct"]}],
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
  return { root, service };
}

// `overrides`: `visualPage` (a page number the parser says has a picture), `pages` (the source's page texts), `reviewDir`
// (an owner-only review directory, named in the run config), `config` (more run config), `routeEnvironment` (the inference
// route's environment variable), and `environment` (a fixture made earlier, so this run has its own source and execution root
// in the same private root and case).
async function fixture(t, importOrder = "reading_first", handlers = {}, overrides = {}) {
  const { root, service } = overrides.environment ?? await environment(t);
  const name = overrides.name ?? null;
  const pages = overrides.pages ?? PAGE_TEXT;
  const source = pages.join("\n");
  const digest = hash(source);
  const sourceName = name ? `source-${name}.txt` : "source.txt";
  await fs.writeFile(path.join(root, "private", sourceName), source, { mode: 0o600 });
  let reviewDir = null;
  if (overrides.reviewDir) {
    reviewDir = path.join(root, name ? `review-${name}` : "review");
    await fs.mkdir(reviewDir, { mode: 0o700 });
    await fs.chmod(reviewDir, 0o700);
  }
  const config = {
    schema_version: 1, max_external_spend_usd: 0,
    execution_root: path.join(root, name ? `execution-${name}` : "execution"), private_runtime_root: root,
    ...(importOrder === null ? {} : { import_order: importOrder }),
    source: { relative_path: `private/${sourceName}`, bytes: Buffer.byteLength(source), sha256: digest },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:consent",
    ...(reviewDir ? { operator_review_dir: reviewDir } : {}),
    ...(overrides.config ?? {})
  };
  const configPath = path.join(root, "private", name ? `config-${name}.json` : "config.json");
  const sourceParser = async () => ({
    source: { sha256: digest, byte_length: Buffer.byteLength(source), mime_type: "text/plain" },
    parser: { version: "synthetic-source-parser-v1" },
    pages: pages.map((text, n) => ({
      page_number: n + 1, representation_id: "synthetic:page:" + (n + 1),
      disposition: overrides.visualPage === n + 1 ? "review_required" : "readable",
      warnings: [], image_inventory: overrides.visualPage === n + 1 ? ["synthetic:image"] : []
    })),
    representations: pages.map((text, n) => ({
      representation_id: "synthetic:page:" + (n + 1),
      text, utf8_byte_length: Buffer.byteLength(text)
    }))
  });
  const open = (newConfig = config) => openJournalExecutionRuntime({
    config: newConfig, configPath, service,
    inferencePort: createMockJournalInferencePort({ handlers }),
    sourceParser, environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER, ...(overrides.routeEnvironment ?? {}) }
  });
  return { open, service, config, root, reviewDir, stateFile: path.join(config.execution_root, "state.json") };
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
      { code: "JOURNAL_READING_FIRST_GRAPH_PUBLICATION_REQUIRED" });
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
  // Simulate the real historical checkpoint: it predates the import_order
  // field, while its private config also has no explicit order.
  const historical = JSON.parse(await fs.readFile(old.stateFile, "utf8"));
  delete historical.import_order;
  await fs.writeFile(old.stateFile, JSON.stringify(historical), { mode: 0o600 });
  const resumed = await old.open({ ...old.config, import_order: undefined });
  try {
    const state = JSON.parse(await fs.readFile(old.stateFile, "utf8"));
    assert.equal(state.import_order, undefined, "old checkpoint was not silently rewritten");
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

// The authorized review route: a page the reader cannot read waits in the review directory's worklist for a review file.
const REVIEW_FILE = "reading-first-reviews.json";
const WORKLIST_FILE = "reading-first-review-worklist.json";
const readState = async f => JSON.parse(await fs.readFile(f.stateFile, "utf8"));
// The mode and the text of one file through one handle, so both are the same file's.
async function readFileAndMode(file) {
  const handle = await fs.open(file, "r");
  try { return { mode: (await handle.stat()).mode & 0o777, text: await handle.readFile("utf8") }; }
  finally { await handle.close(); }
}
const readWorklist = async f => {
  const { mode, text } = await readFileAndMode(path.join(f.reviewDir, WORKLIST_FILE));
  assert.equal(mode, 0o600, "the worklist holds journal text, so it is owner-only");
  return JSON.parse(text);
};
const worklistGone = f => fs.access(path.join(f.reviewDir, WORKLIST_FILE)).then(() => false, () => true);
// A review of a page the worklist names: the page's source read whole, its quotation taken from the worklist's own text.
const reviewOf = (entry, extra = {}) => {
  const hasText = entry.text.trim().length > 0;
  return { page: entry.page, source_page_sha256: entry.source_page_sha256, reviewed_modalities: entry.required_modalities,
    source_read_complete: true,
    ...(entry.required_modalities.includes("image") ? { image_content_reviewed: true } : {}),
    source_specific_understanding: "A reviewer read the page the model could not read and described what it says.",
    exact_source_anchors: hasText ? [{ exact_text: entry.text.slice(0, 30), occurrence: null }] : [],
    source_findings: hasText ? [{ statement: "The author reports a change of mind in a dated entry.",
      required_qualifiers: ["Reported by the synthetic author"], anchor_indices: [0] }] : [],
    ...extra };
};
// The review file, owner-only. `extra` replaces the bundle's own fields.
async function writeBundle(f, reviews, extra = {}) {
  const file = path.join(f.reviewDir, REVIEW_FILE);
  await fs.rm(file, { force: true });
  await fs.writeFile(file, JSON.stringify({ schema_version: 1, source_sha256: f.config.source.sha256,
    reviewer: "Synthetic Reviewer", authorization_ref: "synthetic:authorization:1", reviews, ...extra }), { mode: 0o600 });
  await fs.chmod(file, 0o600);
}
// A run's private store, to read back what it saved, with its staging key (the attestation key comes from it).
async function openStore(f, state) {
  const key = await fs.readFile(path.join(f.config.execution_root, "staging.key"));
  const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: CASE_ID,
    corpusId: state.corpus_id, corpusKey: key, resumeMatchingObjects: true });
  return { store, key, close() { store.close(); key.fill(0); } };
}
// One command in a runtime of its own, closed afterwards: a rerun is a new process.
const runOnce = async (f, command, config) => {
  const runtime = await f.open(config);
  try { return await runtime.execute(command); } finally { await runtime.close(); }
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
    // Index can be staged and privately searched, but reading-first must not
    // publish before an enriched semantic graph is built and verified.
    await assert.rejects(runtime.execute("publish-quotes"), {
      code: "JOURNAL_READING_FIRST_GRAPH_PUBLICATION_REQUIRED"
    });
    const stateContext=await f.service.loadPrivateRuntimeCase(CASE_ID,{bearerToken:READER});
    assert.equal((stateContext.journal_corpora??[]).filter(x=>x.corpus_id.endsWith(":quotes")).length,0,
      "no incomplete index was published");
    const indexedState=JSON.parse(await fs.readFile(f.stateFile,"utf8"));
    const stagingKey=await fs.readFile(path.join(f.config.execution_root,"staging.key"));
    const store=createPrivateJournalCorpusStore({
      rootDir:f.config.execution_root,caseId:CASE_ID,
      corpusId:indexedState.quote_index.corpus_id,corpusKey:stagingKey,
      resumeMatchingObjects:true
    });
    try {
      const reader=await openPrivateJournalGraph({
        corpusStore:store,manifestObjectId:indexedState.quote_index.manifest_object_id,
        caseId:CASE_ID,corpusId:indexedState.quote_index.corpus_id,
        generation:indexedState.quote_index.generation,visibilityEpoch:0,
        cursorSecret:stagingKey
      });
      try {
        const concept=await reader.findQuotes({query:"commitment",purpose:"session_use"});
        assert.ok(concept.quotes.length>0,"staged reading-derived search finds a source passage");
        assert.equal(concept.coverage.reading_facets,true);
        assert.ok(concept.quotes.some(q=>q.matched_by==="reading"),
          "provisional reading interpretations remain labeled");
        assert.ok(concept.quotes.every(q=>!q.text.includes("commitment")),
          "the source quote remains unchanged rather than copying model prose");
      } finally {reader.close();}
    } finally {store.close();stagingKey.fill(0);}
    const again=await runtime.execute("read-source");
    assert.equal(again.reading_first.read,3);
    assert.equal(calls.read,3,"replay resumes already attested generation without sending again");
  } finally { await runtime.close(); }
});

test("interrupted private reading preserves partial evidence without resending unknown work", async t => {
  const invoked=[];
  let interruption=true;
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{
      invoked.push(packet.page);
      if(packet.page===2 && interruption){
        interruption=false;
        throw new Error("SYNTHETIC_UNCERTAIN_PROVIDER_COMPLETION");
      }
      return mockSourceReader(packet);
    },
    source_synthesizer:mockSynthesis
  });
  const first=await f.open();
  try {
    await assert.rejects(first.execute("read-source"),/SYNTHETIC_UNCERTAIN_PROVIDER_COMPLETION/);
    const state=JSON.parse(await fs.readFile(f.stateFile,"utf8"));
    assert.equal(state.reading_first_receipts_ref,undefined);
    assert.equal(state.quote_index,undefined);
  } finally {await first.close();}
  const resumed=await f.open();
  try {
    await assert.rejects(resumed.execute("read-source"),{code:"COMPLETION_UNKNOWN"});
    const state=JSON.parse(await fs.readFile(f.stateFile,"utf8"));
    assert.equal(state.reading_first_receipts_ref,undefined,
      "an uncertain provider call cannot certify full reading");
    assert.equal(state.quote_index,undefined);
  } finally {await resumed.close();}
  assert.deepEqual(invoked,[1,2],
    "the earlier completed page was replayed from durable evidence, not sent again");
});

test("real importer marks mixed-visual pages pending and forbids a complete new index", async t=>{
  const called=[];let synthesized=0;
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{called.push(packet.page);return mockSourceReader(packet);},
    source_synthesizer:packet=>{synthesized++;return mockSynthesis(packet);}
  },{visualPage:2});
  const runtime=await f.open();
  try {
    const report=await runtime.execute("read-source");
    assert.equal(report.reading_first.pending,1);
    assert.equal(report.reading_first.status,"REVIEW_PENDING");
    assert.deepEqual(report.reading_first.pending_pages,[{page:2,reason:"visual_pending"}]);
    assert.deepEqual(called,[1,3],"mixed-media page was not exposed to a text-only reader");
    assert.equal(synthesized,0,"nothing is synthesized while a page waits for its review");
    for(const word of ["promise","opinion","kindness","neighbor"])
      assert.equal(JSON.stringify(report).includes(word),false,"the summary holds no page text: "+word);
    await assert.rejects(runtime.execute("build-quotes"),{
      code:"JOURNAL_READING_FIRST_REVIEW_PENDING"
    });
    const state=await readState(f);
    assert.equal(state.quote_index,undefined);
    assert.equal(state.reading_first_receipts_ref,undefined,"no receipt is signed while a page is pending");
    assert.deepEqual(state.reading_first_counts,{source_pages:3,read:2,operator_reviewed:0,pending:1});
    assert.deepEqual(state.reading_first_pending,[{page:2,reason:"visual_pending",
      required_modalities:"text+image",source_page_sha256:pageDigest(2)}],"pages, reasons and digests only");
    assert.equal(JSON.stringify(state.reading_first_pending).includes("opinion"),false);
    // No review directory is named, so no worklist of journal text is written anywhere.
    assert.deepEqual((await fs.readdir(f.root)).filter(name=>name.includes("worklist")),[]);
  } finally {await runtime.close();}
});

test("a page the reader cannot read is reviewed through the worklist and the review file, and reading then completes and opens the index", async t=>{
  const asked=[];let synthesized=0;
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{asked.push(packet.page);return mockSourceReader(packet);},
    source_synthesizer:packet=>{synthesized++;return mockSynthesis(packet);}
  },{visualPage:2,reviewDir:true});
  let entry;
  const first=await f.open();
  try {
    const pending=await first.execute("read-source");
    assert.equal(pending.reading_first.status,"REVIEW_PENDING");
    const worklist=await readWorklist(f);
    assert.deepEqual(worklist,{schema_version:1,source_sha256:DIGEST,generation:(await readState(f)).generation,
      pages:[{page:2,source_page_sha256:pageDigest(2),required_modalities:"text+image",reason:"visual_pending",text:PAGE_TEXT[1]}]},
    "the worklist carries the exact page text a quotation is checked against");
    [entry]=worklist.pages;
    await assert.rejects(first.execute("build-quotes"),{code:"JOURNAL_READING_FIRST_REVIEW_PENDING"},
      "the index does not open over a page nobody has read");
    assert.deepEqual((await first.execute("status")).reading_first.pending_pages,[{page:2,reason:"visual_pending"}]);
  } finally {await first.close();}

  const review=reviewOf(entry);
  await writeBundle(f,[review]);
  const second=await f.open();
  try {
    const done=await second.execute("read-source");
    assert.deepEqual(done.reading_first,{source_pages:3,read:2,operator_reviewed:1,pending:0,status:"SOURCE_SYNTHESIZED"});
    assert.deepEqual(asked,[1,3],"the reader's stored answers were replayed, and no page was asked again");
    assert.equal(synthesized,1);
    assert.equal(await worklistGone(f),true,"a finished reading leaves no worklist of journal text behind");
    const state=await readState(f);
    assert.ok(state.reading_first_receipts_ref);
    assert.equal(state.reading_first_pending,undefined);
    const indexed=await second.execute("build-quotes");
    assert.ok(indexed.quote_index.quotes>0,"the index builds once every page is read or reviewed");
    assert.ok(indexed.quote_index.reading_facets.facets>0);
  } finally {await second.close();}

  const state=await readState(f);
  const saved=await openStore(f,state);
  try {
    const readerPage=await saved.store.readJsonObject({objectId:"reading-first:page:1"});
    const reviewedPage=await saved.store.readJsonObject({objectId:"reading-first:page:2"});
    assert.equal(readerPage.observation.provenance,"source_bound_model_proposal");
    assert.equal(readerPage.observation.review,undefined);
    assert.equal(reviewedPage.observation.provenance,"authorized_operator_review");
    assert.deepEqual(reviewedPage.observation.review,{route:"authorized_operator_review",reviewer:"Synthetic Reviewer",
      authorization_ref:"synthetic:authorization:1",review_sha256:hash(canonicalJson(review))});
    assert.equal(reviewedPage.observation.exact_source_anchors[0].exact_text,PAGE_TEXT[1].slice(0,30));
    const journal=JSON.parse((await saved.store.reassembleOriginal(state.reading_first_receipts_ref)).toString("utf8"));
    assert.deepEqual(journal.transitions[1].receipt.page_dispositions.map(row=>[row.page,row.status,row.reviewed_modalities,row.review_route]),[
      [1,"REVIEWED_ALL_SOURCE_MODALITIES","text","source_reader"],
      [2,"REVIEWED_ALL_SOURCE_MODALITIES","text+image","authorized_operator_review"],
      [3,"REVIEWED_ALL_SOURCE_MODALITIES","text","source_reader"]]);
    const attestationKey=readingFirstAttestationKey(saved.key);
    const check=receiptJournal=>verifiedReadingFirstSynthesis({sourceSha256:DIGEST,generation:state.generation,
      pageCount:3,receiptJournal,attestationKey});
    assert.equal(check(journal).reviewed_pages,3,"the receipts the runtime signed verify");
    // The route is part of what the runtime's own key signed: no one can relabel a page afterwards.
    const relabelled=structuredClone(journal);
    relabelled.transitions[1].receipt.page_dispositions[0].review_route="authorized_operator_review";
    assert.throws(()=>check(relabelled),{code:"JOURNAL_READING_FIRST_RECEIPT_NOT_TRUSTED"});
  } finally {saved.close();}
});

test("reviews arrive a page at a time, the worklist follows them, and a review already applied cannot change", async t=>{
  const f=await fixture(t,"reading_first",{source_reader:mockSourceReader,source_synthesizer:mockSynthesis},
    {visualPage:2,reviewDir:true,config:{operator_read_pages:[3]}});
  const first=await runOnce(f,"read-source");
  assert.deepEqual(first.reading_first.pending_pages,[{page:2,reason:"visual_pending"},{page:3,reason:"operator_review_requested"}]);
  const [two,three]=(await readWorklist(f)).pages;
  assert.deepEqual([two.page,two.required_modalities,three.page,three.required_modalities],[2,"text+image",3,"text"]);
  await writeBundle(f,[reviewOf(two)]);
  const partial=await runOnce(f,"read-source");
  assert.deepEqual(partial.reading_first,{source_pages:3,read:1,operator_reviewed:1,pending:1,status:"REVIEW_PENDING",
    pending_pages:[{page:3,reason:"operator_review_requested"}]});
  assert.deepEqual((await readWorklist(f)).pages.map(item=>item.page),[3],"the worklist names only what still waits");
  // An applied review is kept as it was applied: changing the review, or who made it, is refused.
  await writeBundle(f,[reviewOf(two,{source_specific_understanding:"A different account of the same page."})]);
  await assert.rejects(runOnce(f,"read-source"),{code:"JOURNAL_IMMUTABLE_RESULT_CONFLICT"});
  await writeBundle(f,[reviewOf(two)],{reviewer:"Another Reviewer"});
  await assert.rejects(runOnce(f,"read-source"),{code:"JOURNAL_IMMUTABLE_RESULT_CONFLICT"});
  assert.equal((await readState(f)).reading_first_receipts_ref,undefined,"a refused change signs nothing");
  // The review as it was, with the other page's, completes the reading.
  await writeBundle(f,[reviewOf(two),reviewOf(three)]);
  const done=await runOnce(f,"read-source");
  assert.deepEqual(done.reading_first,{source_pages:3,read:1,operator_reviewed:2,pending:0,status:"SOURCE_SYNTHESIZED"});
});

test("a page the model refuses, answers invalidly, answers with a quotation not in the page or cannot answer waits for a review instead of ending the import", async t=>{
  const asked=[];
  const FOURTH="April 1 2025. The author describes a quiet walk by the river and a decision to rest.";
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{
      asked.push(packet.page);
      if(packet.page===1) throw Object.assign(new Error("SYNTHETIC_REFUSAL"),{code:"JOURNAL_SOURCE_TOOL_REFUSED"});
      if(packet.page===2) return {schema_version:"1.0"};
      if(packet.page===3) return {...mockSourceReader(packet),exact_source_anchors:[{exact_text:"A sentence the page never says.",occurrence:null}]};
      throw new JournalInferencePortError("SYNTHETIC_RETRIES_EXHAUSTED",{submissionStatus:"exhausted"});
    },
    source_synthesizer:mockSynthesis
  },{reviewDir:true,pages:[...PAGE_TEXT,FOURTH]});
  const first=await runOnce(f,"read-source");
  assert.deepEqual(first.reading_first.pending_pages,[{page:1,reason:"tool_refused"},{page:2,reason:"reader_output_invalid"},
    {page:3,reason:"reader_evidence_invalid"},{page:4,reason:"reader_unavailable"}]);
  assert.deepEqual(first.reading_first,{source_pages:4,read:0,operator_reviewed:0,pending:4,status:"REVIEW_PENDING",
    pending_pages:first.reading_first.pending_pages});
  const state=await readState(f);
  assert.equal(state.reading_first_receipts_ref,undefined);
  const missing=await openStore(f,state);
  try {
    for(const page of [1,2,3,4])
      assert.equal(await missing.store.readJsonObject({objectId:"reading-first:page:"+page}).catch(error=>error.code),"ENOENT",
        "nothing is kept for a page that was not read: "+page);
  } finally {missing.close();}
  // The reviewer takes each page from the worklist; the reader is not asked about any of them again.
  const worklist=await readWorklist(f);
  assert.deepEqual(worklist.pages.map(item=>[item.page,item.reason]),[[1,"tool_refused"],[2,"reader_output_invalid"],
    [3,"reader_evidence_invalid"],[4,"reader_unavailable"]]);
  await writeBundle(f,worklist.pages.map(item=>reviewOf(item)));
  const done=await runOnce(f,"read-source");
  assert.deepEqual(done.reading_first,{source_pages:4,read:0,operator_reviewed:4,pending:0,status:"SOURCE_SYNTHESIZED"});
  assert.deepEqual(asked,[1,2,3,4],"the stored refusal, invalid answer, answer and exhausted call were replayed");
  assert.ok((await runOnce(f,"build-quotes")).quote_index.quotes>0);
});

test("pages given to the reviewer are never sent to the reader, and need the review directory and a real page", async t=>{
  const asked=[];
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{asked.push(packet.page);return mockSourceReader(packet);},
    source_synthesizer:mockSynthesis
  },{reviewDir:true,config:{operator_read_pages:[1]}});
  const first=await runOnce(f,"read-source");
  assert.deepEqual(first.reading_first.pending_pages,[{page:1,reason:"operator_review_requested"}]);
  assert.deepEqual(asked,[2,3]);
  const [entry]=(await readWorklist(f)).pages;
  assert.deepEqual([entry.page,entry.required_modalities,entry.text],[1,"text",PAGE_TEXT[0]]);
  await writeBundle(f,[reviewOf(entry)]);
  const done=await runOnce(f,"read-source");
  assert.deepEqual(done.reading_first,{source_pages:3,read:2,operator_reviewed:1,pending:0,status:"SOURCE_SYNTHESIZED"});
  assert.deepEqual(asked,[2,3],"page 1 never went to the reader");

  // The pages are named in the run config, so a mistake there stops the run before it sends anything.
  const sent=[];
  const g=await fixture(t,"reading_first",{source_reader:packet=>{sent.push(packet.page);return mockSourceReader(packet);}},
    {reviewDir:true});
  await assert.rejects(runOnce(g,"read-source",{...g.config,operator_read_pages:[4]}),{code:"JOURNAL_OPERATOR_READ_PAGES_INVALID"},
    "a page past the last one");
  await assert.rejects(g.open({...g.config,operator_read_pages:[1,1]}),{code:"JOURNAL_OPERATOR_READ_PAGES_INVALID"});
  await assert.rejects(g.open({...g.config,operator_read_pages:[0]}),{code:"JOURNAL_OPERATOR_READ_PAGES_INVALID"});
  await assert.rejects(g.open({...g.config,operator_read_pages:[1],operator_review_dir:undefined}),
    {code:"JOURNAL_OPERATOR_REVIEW_DIR_REQUIRED"});
  assert.deepEqual(sent,[],"nothing was sent for a run that could not start");
});

test("a review for a page the reader read is refused, and a review that does not fit its page ends the run before any page is sent", async t=>{
  const asked=[];
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{asked.push(packet.page);return mockSourceReader(packet);},
    source_synthesizer:mockSynthesis
  },{reviewDir:true});
  const readable={page:1,source_page_sha256:hash(PAGE_TEXT[0]),required_modalities:"text",text:PAGE_TEXT[0]};
  // A reviewer's invented quotation, a wrong page digest and an image claim on a text page each stop the run at once.
  for(const bad of [reviewOf(readable,{exact_source_anchors:[{exact_text:"Words the page never says.",occurrence:null}]}),
    reviewOf(readable,{source_page_sha256:"0".repeat(64)}),
    reviewOf(readable,{image_content_reviewed:true})]) {
    await writeBundle(f,[bad]);
    await assert.rejects(runOnce(f,"read-source"),(error)=>{
      assert.equal(error.code,"JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID");
      assert.equal(error.message.includes("Words the page"),false,"the error names no review text");
      return true;
    });
  }
  assert.deepEqual(asked,[],"a bad review stops the run before the reader is asked about any page");
  // A fitting review of a page the reader then reads is not accepted either, and nothing is kept for the page.
  await writeBundle(f,[reviewOf(readable)]);
  await assert.rejects(runOnce(f,"read-source"),{code:"JOURNAL_READING_FIRST_OPERATOR_REVIEW_UNEXPECTED"});
  const state=await readState(f);
  assert.equal(state.reading_first_receipts_ref,undefined);
  assert.equal(state.reading_first_pending,undefined);
  const saved=await openStore(f,state);
  try {
    assert.equal(await saved.store.readJsonObject({objectId:"reading-first:page:1"}).catch(error=>error.code),"ENOENT");
  } finally {saved.close();}
});

test("an unsafe review directory or review file stops the run before any page is sent", async t=>{
  const asked=[];
  const f=await fixture(t,"reading_first",{
    source_reader:packet=>{asked.push(packet.page);return mockSourceReader(packet);},
    source_synthesizer:mockSynthesis
  },{reviewDir:true});
  const file=path.join(f.reviewDir,REVIEW_FILE);
  const bundle=JSON.stringify({schema_version:1,source_sha256:DIGEST,reviewer:"Synthetic Reviewer",
    authorization_ref:"synthetic:authorization:1",reviews:[]});
  const fails=async code=>{
    await assert.rejects(runOnce(f,"read-source"),{code});
    assert.deepEqual(asked,[],"nothing was sent");
  };
  // A link, even to a good file.
  const elsewhere=path.join(f.root,"private","elsewhere.json");
  await fs.writeFile(elsewhere,bundle,{mode:0o600});
  await fs.symlink(elsewhere,file);
  await fails("JOURNAL_READING_FIRST_OPERATOR_REVIEW_FILE_UNSAFE");
  await fs.unlink(file);
  // Readable by the group.
  await fs.writeFile(file,bundle,{mode:0o640});
  await fs.chmod(file,0o640);
  await fails("JOURNAL_READING_FIRST_OPERATOR_REVIEW_FILE_UNSAFE");
  await fs.rm(file);
  // Not a file.
  await fs.mkdir(file,{mode:0o700});
  await fails("JOURNAL_READING_FIRST_OPERATOR_REVIEW_FILE_UNSAFE");
  await fs.rmdir(file);
  // Another source's review, and not JSON.
  await writeBundle(f,[],{source_sha256:"0".repeat(64)});
  await fails("JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID");
  await fs.writeFile(file,"this is not json",{mode:0o600});
  await fails("JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID");
  // A key the bundle does not name, at the top and in a review.
  await writeBundle(f,[],{note:"anything"});
  await fails("JOURNAL_READING_FIRST_OPERATOR_REVIEW_INVALID");
  // The directory itself: open to others, past a link, missing, or inside the public repository.
  const open=path.join(f.root,"open-review");
  await fs.mkdir(open);
  await fs.chmod(open,0o755);
  const link=path.join(f.root,"review-link");
  await fs.symlink(f.reviewDir,link);
  for(const [dir,code] of [[open,"POINTER_EXAMPLES_DIR_UNSAFE"],[link,"POINTER_EXAMPLES_DIR_UNSAFE"],
    [path.join(f.root,"missing-review"),"POINTER_EXAMPLES_DIR_UNSAFE"],
    [path.resolve(new URL("../",import.meta.url).pathname,"review"),"JOURNAL_OPERATOR_REVIEW_DIR_PRIVATE_REQUIRED"]]) {
    await assert.rejects(runOnce(f,"read-source",{...f.config,operator_review_dir:dir}),{code},dir);
    assert.deepEqual(asked,[]);
  }
  // With the file as it should be, the run goes on: an empty review bundle needs nothing from it.
  await writeBundle(f,[]);
  assert.equal((await runOnce(f,"read-source")).reading_first.status,"SOURCE_SYNTHESIZED");
});

test("reading reports where it is in a content-free progress file that status shows", async t=>{
  const f=await fixture(t,"reading_first",{source_reader:mockSourceReader,source_synthesizer:mockSynthesis},{visualPage:2});
  const progressFile=path.join(f.config.execution_root,"reading-first-progress.json");
  const runtime=await f.open();
  try {
    assert.equal((await runtime.execute("status")).reading_first_progress,undefined,"before reading there is none");
    await runtime.execute("read-source");
    const { mode, text }=await readFileAndMode(progressFile);
    assert.equal(mode,0o600);
    const saved=JSON.parse(text);
    assert.deepEqual(Object.keys(saved).sort(),["operator_reviewed","pending","read","schema_version","through_page","updated_at"]);
    assert.deepEqual([saved.through_page,saved.read,saved.operator_reviewed,saved.pending],[3,2,0,1]);
    for(const word of ["promise","opinion","kindness","January"]) assert.equal(text.includes(word),false,word);
    const status=await runtime.execute("status");
    assert.deepEqual(status.reading_first_progress,{through_page:3,read:2,operator_reviewed:0,pending:1,updated_at:saved.updated_at});
    assert.equal(JSON.stringify(status.reading_first_progress).includes("opinion"),false);
    // A damaged progress file is not evidence and does not stop status.
    await fs.writeFile(progressFile,"{ not json",{mode:0o600});
    assert.equal((await runtime.execute("status")).reading_first_progress,undefined);
    await fs.writeFile(progressFile,JSON.stringify({through_page:"x",read:-1,extra:"journal text",pending:2}),{mode:0o600});
    assert.deepEqual((await runtime.execute("status")).reading_first_progress,{pending:2});
  } finally {await runtime.close();}
});

test("the reader is asked about up to semantic_concurrency pages at once, and the result is the one-at-a-time result", async t=>{
  const ran=async concurrency=>{
    let inFlight=0,most=0,open=()=>{};
    const everyoneIn=new Promise(resolve=>{open=resolve;});
    const f=await fixture(t,"reading_first",{
      source_reader:async packet=>{
        inFlight+=1;most=Math.max(most,inFlight);
        if(inFlight===concurrency) open();
        // All the pages the window holds are with the reader together before any answers.
        await Promise.race([everyoneIn,new Promise(resolve=>setTimeout(resolve,1500))]);
        inFlight-=1;
        return mockSourceReader(packet);
      },
      source_synthesizer:mockSynthesis
    },{config:{semantic_concurrency:concurrency}});
    const done=await runOnce(f,"read-source");
    const state=await readState(f);
    const saved=await openStore(f,state);
    try {
      const pages=[];
      for(const page of [1,2,3]) pages.push((await saved.store.readJsonObject({objectId:"reading-first:page:"+page})).observation);
      return {most,done:done.reading_first,pages};
    } finally {saved.close();}
  };
  const one=await ran(1);
  const three=await ran(3);
  assert.equal(one.most,1);
  assert.equal(three.most,3,"three pages were with the reader at once");
  assert.deepEqual(three.done,one.done);
  assert.deepEqual(three.pages,one.pages,"the evidence is the same as when the pages are read one at a time");
});

test("on a direct browser route the reader takes one page at a time whatever semantic_concurrency says; an exchange takes the window", async t=>{
  const ran=async provider=>{
    let inFlight=0,most=0;
    const f=await fixture(t,"reading_first",{
      source_reader:async packet=>{
        inFlight+=1;most=Math.max(most,inFlight);
        // Long enough for every page the window holds to be with the reader together.
        await new Promise(resolve=>setTimeout(resolve,60));
        inFlight-=1;
        return mockSourceReader(packet);
      },
      source_synthesizer:mockSynthesis
    },{config:{semantic_concurrency:3},routeEnvironment:{INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON:JSON.stringify({provider})}});
    const done=await runOnce(f,"read-source");
    return {most,done:done.reading_first};
  };
  const browser=await ran("chatgpt_subscription_browser");
  const exchange=await ran("codex_exec_exchange");
  assert.equal(browser.most,1,"a direct browser route has one page");
  assert.equal(exchange.most,3,"an exchange queues the window");
  assert.deepEqual(browser.done,exchange.done);
});

const SECOND_PAGES = [
  "May 1 2025. The author wrote that a long walk by the lake cleared their head.",
  "June 1 2025. They described reading an old letter and feeling steadier afterward.",
  "July 1 2025. They planned a quiet week at the cabin with nothing scheduled."
];

test("a new run replaces the published quote generation inside the same corpus, and the replaced one can be rolled back to", async t=>{
  // Run one publishes its quotes (generation A) into a corpus of the case.
  const first=await fixture(t,"legacy_quote_first");
  await runOnce(first,"stage");
  await runOnce(first,"publish-quotes");
  const one=await readState(first);
  const corpusId=`${one.corpus_id}:quotes`;
  const generationA=one.quote_index.generation;
  const inspect=async()=>(await first.service.inspectJournalCorpus(CASE_ID,corpusId,
    {requiredScope:"case:write",requiredPurpose:"session_use"},{bearerToken:WRITER})).reference;
  assert.equal((await inspect()).active_generation,generationA);
  assert.equal(one.original.object_id,"original:source:"+DIGEST.slice(0,24),"the archived original is named for its source's digest");

  // Run two has another source, its own execution root, and is told which published generation it replaces.
  const replaces={corpus_id:one.corpus_id,generation:generationA};
  const second=await fixture(t,"legacy_quote_first",{},{environment:first,name:"second",pages:SECOND_PAGES,
    config:{replaces_published_quotes:replaces}});
  await runOnce(second,"stage");
  const published=await runOnce(second,"publish-quotes");
  assert.deepEqual(published.replaces_published,replaces);
  const two=await readState(second);
  assert.equal(two.corpus_id,one.corpus_id,"the new run takes the corpus it replaces");
  assert.notEqual(two.generation,one.generation);
  assert.deepEqual(two.replaces_published,replaces);
  assert.equal(two.original.object_id,"original:source:"+second.config.source.sha256.slice(0,24));
  assert.notEqual(two.original.object_id,one.original.object_id,"two sources never share an archive id in one corpus");
  const generationB=two.quote_index.generation;
  assert.notEqual(generationB,generationA);
  assert.equal(two.quote_index.supersedes,generationA);
  assert.equal(two.quote_published.generation,generationB);
  const reference=await inspect();
  assert.equal(reference.active_generation,generationB);
  assert.equal(reference.previous_generations.at(-1).generation,generationA,"the replaced generation is kept among the previous ones");
  const corpora=(await first.service.loadPrivateRuntimeCase(CASE_ID,{bearerToken:READER})).journal_corpora;
  assert.deepEqual(corpora.filter(item=>item.corpus_id.endsWith(":quotes")).map(item=>item.corpus_id),[corpusId],
    "one quote corpus, not a second one beside the first");
  const api=createJournalPrivateApi({caseAccessService:first.service});
  const search=async query=>(await api.findQuotes({caseId:CASE_ID,corpusId,query,purpose:"session_use"},
    {bearerToken:READER})).quotes.map(quote=>quote.text);
  assert.ok((await search("cabin")).some(text=>text.includes("cabin")),"the new generation is the one searched");
  assert.deepEqual(await search("neighbor"),[]);

  // The replaced generation is still there to go back to, through the service and a correct-purpose grant only.
  const rollback={corpusId,targetGeneration:generationA,expectedGeneration:generationB};
  await assert.rejects(first.service.rollbackJournalGeneration(CASE_ID,rollback,{bearerToken:WRITER}),
    {code:"PRIVATE_CASE_ACCESS_DENIED"},"the import's own grant cannot roll back");
  await first.service.rollbackJournalGeneration(CASE_ID,rollback,{bearerToken:CORRECTOR});
  assert.equal((await inspect()).active_generation,generationA);
  assert.ok((await search("neighbor")).some(text=>text.includes("neighbor")));
  assert.deepEqual(await search("cabin"),[]);

  // A run keeps the corpus it began for: a config that drops it, or names another, is refused, and so is adding one to a run
  // that began without.
  for(const changed of [undefined,{corpus_id:one.corpus_id,generation:"generation:another"},
    {corpus_id:`corpus:${randomUUID()}`,generation:generationA}])
    await assert.rejects(second.open({...second.config,replaces_published_quotes:changed}),
      {code:"JOURNAL_REPLACED_PUBLICATION_CHANGED"});
  await assert.rejects(first.open({...first.config,replaces_published_quotes:replaces}),{code:"JOURNAL_REPLACED_PUBLICATION_CHANGED"});
  assert.deepEqual((await runOnce(second,"status")).replaces_published,replaces,"the same config resumes");

  // A corpus that names nothing in the case is not created: the run is refused, not published as a second corpus.
  const stray=await fixture(t,"legacy_quote_first",{},{environment:first,name:"stray",pages:[...SECOND_PAGES].reverse(),
    config:{replaces_published_quotes:{corpus_id:`corpus:${randomUUID()}`,generation:"generation:never-published"}}});
  await runOnce(stray,"stage");
  await assert.rejects(runOnce(stray,"publish-quotes"),{code:"JOURNAL_PUBLICATION_REPLACED_CORPUS_MISSING"});
  const after=(await first.service.loadPrivateRuntimeCase(CASE_ID,{bearerToken:READER})).journal_corpora;
  assert.deepEqual(after.filter(item=>item.corpus_id.endsWith(":quotes")).map(item=>item.corpus_id),[corpusId]);
});

test("a run that began before archives were named for their source keeps the one archive id it has", async t=>{
  const f=await fixture(t,"legacy_quote_first");
  await (await f.open()).close();
  const state=await readState(f);
  assert.equal(state.original_object_id,"original:source:"+DIGEST.slice(0,24));
  delete state.original_object_id;
  await fs.writeFile(f.stateFile,JSON.stringify(state),{mode:0o600});
  await runOnce(f,"stage");
  assert.equal((await readState(f)).original.object_id,"original:source");
});

test("new reading-first imports cannot bypass into the historical semantic graph workflow", async t => {
  const f=await fixture(t,"reading_first",{
    source_reader:mockSourceReader,
    source_synthesizer:mockSynthesis
  });
  const runtime=await f.open();
  try {
    await runtime.execute("stage");
    for(const command of ["run","audit","patterns","commit"]){
      await assert.rejects(runtime.execute(command),{
        code:"JOURNAL_READING_FIRST_STAGE_INCOMPLETE"
      }, "Missing reading evidence blocks legacy "+command);
    }
    await runtime.execute("read-source");
    for(const command of ["run","audit","patterns","commit"]){
      await assert.rejects(runtime.execute(command),{
        code:"JOURNAL_READING_FIRST_LEGACY_SEMANTIC_PATH_DISABLED"
      }, "After successful reading, old semantic "+command+" still cannot overwrite the new index");
    }
    const state=JSON.parse(await fs.readFile(f.stateFile,"utf8"));
    assert.equal(state.graph_ref,undefined);
    assert.equal(state.quote_index,undefined);
  } finally { await runtime.close(); }
});
