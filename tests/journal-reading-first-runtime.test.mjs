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

const hash = (text) => createHash("sha256").update(text).digest("hex");
const CASE_ID = "synthetic-reading-first-integration";
const WRITER = "invented-reading-first-operator-key";
const PAGE_TEXT = [
  "January 1 2025. A person chose to keep their promise to a neighbor.",
  "February 1 2025. That person revised an earlier opinion after new evidence.",
  "March 1 2025. They noticed kindness can coexist with a careful boundary."
];
const SOURCE = PAGE_TEXT.join("\n");
const DIGEST = hash(SOURCE);

async function fixture(t, importOrder = "reading_first") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-reading-first-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  await fs.writeFile(path.join(root, "private", "source.txt"), SOURCE, { mode: 0o600 });
  const cred = path.join(root, "credentials.json");
  await fs.writeFile(cred, JSON.stringify({
    schema_version: 1, root_dir: path.join(root, "vaults"),
    grants: [{ token_sha256: hash(WRITER), principal_id: "synthetic-operator", case_ids: [CASE_ID],
      scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] }],
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
    import_order: importOrder,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(SOURCE), sha256: DIGEST },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:consent"
  };
  const configPath = path.join(root, "private", "config.json");
  const sourceParser = async () => ({
    source: { sha256: DIGEST, byte_length: Buffer.byteLength(SOURCE), mime_type: "text/plain" },
    parser: { version: "synthetic-source-parser-v1" },
    pages: PAGE_TEXT.map((text, n) => ({
      page_number: n + 1, representation_id: "synthetic:page:" + (n + 1),
      disposition: "readable", warnings: [], image_inventory: []
    })),
    representations: PAGE_TEXT.map((text, n) => ({
      representation_id: "synthetic:page:" + (n + 1),
      text, utf8_byte_length: Buffer.byteLength(text)
    }))
  });
  const open = (newConfig = config) => openJournalExecutionRuntime({
    config: newConfig, configPath, service,
    inferencePort: createMockJournalInferencePort({ handlers: {} }),
    sourceParser, environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER }
  });
  return { open, config, stateFile: path.join(config.execution_root, "state.json") };
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
