// A calibration round paused under the code before this change and resumed after it: a unit admitted before
// calibration recorded its counts passed the stricter per-unit audit, so the round goes on without counting it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { createPrivateJournalCorpusStore } from "../src/storage/private-journal-corpus.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");

async function fixture(t, pages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-convergence-resume-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const privateDir = path.join(root, "private");
  await fs.mkdir(privateDir, { mode: 0o700 });
  const source = "Synthetic journal source for calibration retry.\n";
  await fs.writeFile(path.join(privateDir, "source.txt"), source, { mode: 0o600 });
  const config = { schema_version: 1, max_external_spend_usd: 0, execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(source), sha256: sha(source) },
    target_profile: { case_id: "synthetic-case" }, existing_grant_ref: "synthetic:grant" };
  const configPath = path.join(privateDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const parser = async () => ({ source: { sha256: config.source.sha256, byte_length: config.source.bytes, mime_type: "text/plain" },
    parser: { version: "synthetic" },
    pages: Array.from({ length: pages }, (_, i) => ({ page_number: i + 1, representation_id: `synthetic:page:${i + 1}`, disposition: "readable", warnings: [], image_inventory: [], geometry: { width: 100, height: 100 } })),
    representations: Array.from({ length: pages }, (_, i) => { const text = `Synthetic page ${i + 1} has a blue cup.`; return { representation_id: `synthetic:page:${i + 1}`, text, utf8_byte_length: Buffer.byteLength(text) }; }) });
  return { config, open: (port, resumed) => openJournalExecutionRuntime({ config, configPath, service: { verifyCaseAccess: async () => ({}) }, environment: process.env,
    sourceParser: resumed ? () => assert.fail("reparse") : parser, renderVisualPage: async () => Buffer.alloc(0), inferencePort: port }) };
}
function port(failPage2Once) {
  let failed = false;
  const review = (role, p) => ({ schema_version: "1.0", target_generation: p.expected_generation, review_role: role, assessments: [], proposed_repairs: [], unassessed_ids: [], status: "sufficient_for_stated_scope" });
  return createMockJournalInferencePort({ handlers: {
    reference_reader: (p) => {
      if (failPage2Once && !failed && p.source_windows[0].text.startsWith("Synthetic page 2 ")) { failed = true; return {}; }
      return { schema_version: "1.0", source_only_first_pass: true, reference_items: [], questions: [], unassessed_unit_ids: [] };
    },
    extractor: (p) => ({ schema_version: "1.0", status: "complete", assertions: [], entities: [], episodes: [], requested_context: [],
      coverage: p.core_units.map((u) => ({ unit_id: u.unit_id, disposition: "no_assertion", assertion_local_ids: [], reason: null })) }),
    omission_checker: (p) => review("omission_checker", p), fidelity_auditor: (p) => review("fidelity_auditor", p),
    reconciler: (p) => ({ schema_version: "1.0", target_generation: p.expected_generation, proposals: [], unresolved_ids: [], status: "proposals_complete" }) } });
}
test("a calibration unit admitted before counts were recorded lets a resumed round finish", async (t) => {
  const f = await fixture(t, 2);
  let runtime = await f.open(port(true), false);
  const paused = await runtime.execute("run");
  assert.equal(paused.calibration, "not_run");
  assert.equal(paused.completed_units, 1);
  await runtime.close();
  const state = JSON.parse(await fs.readFile(path.join(f.config.execution_root, "state.json"), "utf8"));
  const key = await fs.readFile(path.join(f.config.execution_root, "staging.key"));
  const store = createPrivateJournalCorpusStore({ rootDir: f.config.execution_root, caseId: state.case_id, corpusId: state.corpus_id, corpusKey: key });
  const [done] = state.completed_units;
  const record = await store.readJsonObject({ objectId: `unit:graph:${done}` });
  assert.equal(record.calibration.outcome, "pass");
  delete record.calibration; // as the code before this change wrote it
  const corpora = path.join(f.config.execution_root, ".journal-corpora");
  const [storageId] = await fs.readdir(corpora);
  await fs.rm(path.join(corpora, storageId, `${sha(`unit:graph:${done}\0${1}\0${0}`)}.journal-object.json`));
  await store.writeJsonObject({ objectId: `unit:graph:${done}`, value: record });
  assert.equal(Object.hasOwn(await store.readJsonObject({ objectId: `unit:graph:${done}` }), "calibration"), false);
  store.close();
  runtime = await f.open(port(false), true);
  const resumed = await runtime.execute("run");
  assert.equal(resumed.calibration, "pass");
  assert.equal(resumed.calibration_failure, undefined);
  assert.equal(resumed.calibration_gate.legacy_passed_units, 1);
  await runtime.close();
});
