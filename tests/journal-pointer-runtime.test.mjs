import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { POINTER_DEADLINE_DEFAULTS, journalPointerCopyRunWords, journalPointerDeadlines } from "../src/journal-import/run-config.mjs";
import { createPrivateCaseAccessService, loadDevelopmentPrivateCaseProviders } from "../src/storage/private-case-access.mjs";

// The pointer pass's commands in the private runtime (plan 2026-10-09-journal-quote-first.md, Part 3): the reference
// step, the pilot, the pass, the measurement and publishing, each with its saved deadline, over a mock port. All text
// here is invented.

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const CASE_ID = "pointer-case";
const WRITER = "pointer-operator-token";
const READER = "pointer-reader-token";
// 110 pages, so the reference sample (12 stretches of 8) leaves pages for the pilot. Each page's two short paragraphs make
// one quote, with words of its own, and it tells of rain, which only its tag names, in the word "pluie" and its page.
const PAGE_COUNT = 110;
const PAGES = Array.from({ length: PAGE_COUNT }, (_, index) => `Jean walked to the market and saw a quolp${index + 1}.\n\n`
  + `Later it rained over the vemmet${index + 1} by the river.\n`);
const distinct = (text) => text.match(/(?:quolp|vemmet)\d+/u)[0];

// Answers by rule: each quote's question asks about its own word, or for the rain, about "pluie" and its page, and
// the search writer searches the question's last word; the tagger tags Jean, each quote's word, and the rain; the
// judges confirm and accept everything except the quotes whose word `refuse` picks, and list as copied the first
// question of each quote whose word `copied` picks.
function handlers({ refuse = () => false, copied = () => false } = {}) {
  const rainTerm = (text) => `pluie${text.match(/vemmet(\d+)/u)[1]}`;
  return {
    question_writer: (packet) => ({ schema_version: "1.0", questions: packet.quote_units.flatMap((quote) => [
      { unit_id: quote.unit_id, question: `What was seen, ask about ${distinct(quote.text)}`, critical: false, event: false },
      { unit_id: quote.unit_id, question: `What was the weather, ask about ${rainTerm(quote.text)}`, critical: false, event: false }]) }),
    coverage_judge: (packet) => ({ schema_version: "1.0", judgments: packet.quotes.map((quote) => {
      const refused = refuse(distinct(quote.text));
      const copying = copied(distinct(quote.text));
      return { unit_id: quote.unit_id, covered: !refused,
        missing: refused ? "something is left out" : (copying ? "a question copies the quote's words" : ""), critical_question_ids: [],
        event_question_ids: [], repeated_question_ids: [], combined_question_ids: [],
        copied_question_ids: copying ? [quote.questions[0].question_id] : [] };
    }) }),
    search_writer: (packet) => ({ schema_version: "1.0", searches: packet.questions.map((question) => ({ question_id: question.question_id,
      queries: [question.question.split(" ").at(-1)] })) }),
    pointer_tagger: (packet) => ({ schema_version: "1.0", tags: packet.quote_units.flatMap((quote) => {
      const anchor = (text) => [{ unit_id: quote.unit_id, quote: text, occurrence: null }];
      const tags = [{ kind: "topic", label: distinct(quote.text), anchors: anchor(distinct(quote.text)) }];
      if (quote.text.includes("Jean")) tags.push({ kind: "person", label: "Jean", anchors: anchor("Jean") });
      if (quote.text.includes("rained")) tags.push({ kind: "topic", label: rainTerm(quote.text), anchors: anchor("rained") });
      return tags;
    }) }),
    pair_judge: (packet) => ({ schema_version: "1.0", judgments: packet.pairs.map((pair) => ({ pair_id: pair.pair_id, mentions: true, kind_right: true })) })
  };
}

// A port whose capabilities add the hardest tier's attestations, as the work exchange's do.
function attestedPort(port) {
  const wrapped = Object.fromEntries(Object.entries(port).map(([name, value]) => [name, typeof value === "function" ? value.bind(port) : value]));
  wrapped.capabilities = () => Object.freeze({ ...port.capabilities(), hardest_fresh_context_per_generate: true,
    hardest_authenticated_execution_profile_per_generate: true });
  return Object.freeze(wrapped);
}

async function runtimeEnvironment(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-runtime-"));
  await fs.chmod(root, 0o700);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "private"), { mode: 0o700 });
  const text = PAGES.join("\n");
  await fs.writeFile(path.join(root, "private", "source.txt"), text, { mode: 0o600 });
  const credentialsPath = path.join(root, "credentials.json");
  await fs.writeFile(credentialsPath, `${JSON.stringify({ schema_version: 1, root_dir: path.join(root, "vaults"), grants: [
    { token_sha256: sha256(WRITER), principal_id: "journal-operator", case_ids: [CASE_ID], scopes: ["case:write"], purposes: ["archive", "organize_search", "session_use"] },
    { token_sha256: sha256(READER), principal_id: "test-reader", case_ids: [CASE_ID], scopes: ["case:read"], purposes: ["organize_search", "session_use"] }
  ], case_keys: { [CASE_ID]: { routine_kek_base64: Buffer.alloc(32, 7).toString("base64"), recovery_secret_base64: Buffer.alloc(32, 9).toString("base64") } } })}\n`, { mode: 0o600 });
  const providers = await loadDevelopmentPrivateCaseProviders(credentialsPath);
  t.after(() => providers.close());
  const service = createPrivateCaseAccessService({ rootDir: providers.rootDir, authorizationProvider: providers.authorizationProvider,
    keyProvider: providers.keyProvider, allowDevelopmentFileProvider: true });
  await service.appendJournal(CASE_ID, { id: "legacy-pointer", observed_at: "2026-01-01T00:00:00.000Z", kind: "journal", text: "Invented legacy entry" }, { bearerToken: WRITER });
  const config = { schema_version: 1, max_external_spend_usd: 0, execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(text), sha256: sha256(text) },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:grant" };
  const configPath = path.join(root, "private", "config.json");
  await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const sourceParser = async () => ({
    source: { sha256: config.source.sha256, byte_length: config.source.bytes, mime_type: "text/plain" }, parser: { version: "synthetic-pointer" },
    pages: PAGES.map((_, index) => ({ page_number: index + 1, representation_id: `synthetic:page:${index}`, disposition: "readable", warnings: [], image_inventory: [] })),
    representations: PAGES.map((page, index) => ({ representation_id: `synthetic:page:${index}`, text: page, utf8_byte_length: Buffer.byteLength(page) }))
  });
  const mock = createMockJournalInferencePort({ handlers: handlers(options) });
  // The mock stands in for the work exchange, whose hardest tier attests a fresh context and the model it ran.
  const exchangeLike = options.attested === false ? mock : attestedPort(mock);
  const port = options.wrapPort ? options.wrapPort(exchangeLike) : exchangeLike;
  const open = () => openJournalExecutionRuntime({ config, configPath, service, inferencePort: port, sourceParser,
    environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER, ...(options.environment ?? {}) },
    ...(options.now ? { now: options.now } : {}) });
  // Runs commands in one runtime and closes it.
  const run = async (...commands) => {
    const runtime = await open();
    try {
      let summary;
      for (const command of commands) summary = await runtime.execute(command);
      return summary;
    } finally { await runtime.close(); }
  };
  return { open, run, service, config, stateFile: path.join(config.execution_root, "state.json") };
}

test("the pointer run goes from the reference sample to publication, each step with its saved deadline", async (t) => {
  const f = await runtimeEnvironment(t);
  await assert.rejects(f.run("pointer-reference"), { code: "JOURNAL_SOURCE_NOT_STAGED" });
  await f.run("stage", "publish-quotes");
  const published = (await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER })).journal_corpora
    .find((item) => item.corpus_id.endsWith(":quotes"));
  await assert.rejects(f.run("pointer-pilot"), { code: "POINTER_REFERENCE_NOT_DONE" });

  const referenced = await f.run("pointer-reference");
  const { reference } = referenced.pointer;
  assert.equal(reference.status, "done");
  assert.equal(Date.parse(reference.deadline) - Date.parse(reference.started_at), POINTER_DEADLINE_DEFAULTS.reference * 60_000);
  assert.deepEqual([reference.counts.sampled_units, reference.counts.complete_units, reference.counts.nonresponse_units], [96, 96, 0]);
  assert.deepEqual(reference.nonresponse_units, []);
  assert.match(reference.seed_sha256, /^[0-9a-f]{64}$/u);
  assert.equal("seed" in reference || "result_ref" in reference, false, "status shows the seed's digest and no private reference");
  assert.match(referenced.pointer.generation, /:quotes:quote-index-v2-month-first:pointer-[0-9a-f]{8}$/u);

  await assert.rejects(f.run("pointer-pass"), { code: "POINTER_PILOT_NOT_DONE" });
  const piloted = await f.run("pointer-pilot");
  const { pilot } = piloted.pointer;
  assert.equal(pilot.candidate_pages, PAGE_COUNT - 96);
  assert.equal(pilot.pages.length, PAGE_COUNT - 96);
  assert.equal(pilot.report.pages_with_quotes, PAGE_COUNT - 96);
  assert.equal(pilot.calls.tagger.answered, pilot.calls.tagger.calls);

  await assert.rejects(f.run("pointer-measure"), { code: "POINTER_PASS_NOT_DONE" });
  const passed = await f.run("pointer-pass");
  assert.equal(passed.pointer.pass.coverage_holds, true);
  assert.equal(passed.pointer.coverage_pass, null, "coverage held, so no new pass");
  assert.equal(passed.pointer.pass.report.pages_with_quotes, PAGE_COUNT);
  assert.deepEqual(passed.pointer.pass.report.untagged_pages, []);

  await assert.rejects(f.run("pointer-publish"), { code: "POINTER_NOT_READY_TO_PUBLISH" });
  // Calibration's set is measured alongside, so its questions come first.
  await assert.rejects(f.run("pointer-measure"), { code: "POINTER_CHALLENGE_NOT_DONE" });
  const challenged = (await f.run("pointer-challenge")).pointer.challenge;
  assert.deepEqual([challenged.status, challenged.calibration_units, challenged.units_without_quotes, challenged.counts.nonresponse_units],
    ["done", 12, 0, 0]);
  assert.ok(challenged.counts.sampled_units >= 1 && challenged.counts.sampled_units <= 12);
  const measured = await f.run("pointer-measure");
  const { measure } = measured.pointer;
  // Reported apart, never a floor: with tags every calibration question is found, with words only the half that
  // asks in the quotes' own words.
  assert.deepEqual([measure.report.challenge.all.recall_with_tags, measure.report.challenge.all.recall_words_only, measure.report.challenge.by_hazard],
    [1, 0.5, {}]);
  assert.equal(measure.report.challenge.units, challenged.counts.sampled_units);
  assert.equal(measure.publish, true);
  assert.deepEqual(measure.failed_floors, []);
  assert.equal(measure.floors.recall.estimate, 1);
  assert.equal(measure.floors.no_loss.recall_words_only_estimate, 0.5, "words alone miss every rain question");
  assert.equal(measure.floors.gain.estimate, 1);
  assert.equal(measured.pointer.persisted.generation, measured.pointer.generation);
  assert.equal(Date.parse(measure.deadline) - Date.parse(measure.started_at), POINTER_DEADLINE_DEFAULTS.measure * 60_000);
  // Readers see no change before publication.
  const before = (await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER })).journal_corpora.find((item) => item.corpus_id === published.corpus_id);
  assert.equal(before.active_generation, published.active_generation);
  // Nothing the run state shows holds journal text.
  const shown = JSON.stringify(measured.pointer);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained"]) assert.equal(shown.includes(word), false, word);
  const state = await fs.readFile(f.stateFile, "utf8");
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained"]) assert.equal(state.includes(word), false, word);

  // A date setting changed after the measurement holds publication back, as it does every step.
  f.config.quote_numeric_date_order = "day_first";
  await assert.rejects(f.run("pointer-publish"), { code: "POINTER_RUN_SETTING_CHANGED" });
  delete f.config.quote_numeric_date_order;
  const deployed = await f.run("pointer-publish");
  assert.equal(deployed.pointer.published.supersedes, published.active_generation);
  const after = (await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER })).journal_corpora.find((item) => item.corpus_id === published.corpus_id);
  assert.equal(after.active_generation, measured.pointer.generation);
  // A reader now finds the rain on page 17 by its tag, in words its quote doesn't use.
  const api = createJournalPrivateApi({ caseAccessService: f.service });
  const found = await api.findQuotes({ caseId: CASE_ID, corpusId: published.corpus_id, query: "pluie17", purpose: "session_use" }, { bearerToken: READER });
  assert.deepEqual(found.quotes.map((quote) => [quote.text, quote.matched_by]), [[PAGES[16].trimEnd(), "tag"]]);
  // Publishing again changes nothing.
  assert.equal((await f.run("pointer-publish")).pointer.published.at, deployed.pointer.published.at);
});

test("reference units the coverage judges never confirm count as missed, and stop the run before the pilot when that puts recall out of reach", async (t) => {
  // The judges never confirm a page's first quote on the even pages: about half the sample.
  const f = await runtimeEnvironment(t, { refuse: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0 });
  await f.run("stage", "build-quotes");
  const stopped = await f.run("pointer-reference");
  assert.equal(stopped.pointer.blocker, "POINTER_RECALL_OUT_OF_REACH");
  const { reference } = stopped.pointer;
  assert.deepEqual(reference.nonresponse_units, []);
  assert.ok(reference.unconfirmed_units.length > 0);
  for (const unitId of reference.unconfirmed_units) {
    assert.match(unitId, /^page:\d+$/u);
    assert.equal(Number(unitId.slice("page:".length)) % 2, 0);
  }
  assert.deepEqual([reference.counts.unconfirmed_units, reference.counts.nonresponse_units], [reference.unconfirmed_units.length, 0]);
  assert.equal(reference.counts.complete_units + reference.counts.unconfirmed_units, 96);
  assert.equal(reference.recall_reach.unconfirmed_units, reference.unconfirmed_units.length);
  assert.ok(reference.recall_reach.best_lower_bound < reference.recall_reach.floor);
  assert.equal(reference.recall_reach.reachable, false);
  await assert.rejects(f.run("pointer-pilot"), { code: "POINTER_RECALL_OUT_OF_REACH" });
  // Status still answers.
  assert.equal((await f.run("status")).pointer.blocker, "POINTER_RECALL_OUT_OF_REACH");
});

test("a few units still unconfirmed after their retry count as missed and the run goes on, the floor still within reach", async (t) => {
  // The judges never confirm the first quote of page 50 or page 100: at most two sampled units.
  const f = await runtimeEnvironment(t, { refuse: (word) => ["quolp50", "quolp100"].includes(word) });
  await f.run("stage", "build-quotes");
  const referenced = await f.run("pointer-reference");
  const { reference } = referenced.pointer;
  assert.equal(referenced.pointer.blocker, null);
  assert.ok(reference.unconfirmed_units.length <= 2);
  assert.deepEqual([reference.counts.complete_units + reference.counts.unconfirmed_units, reference.counts.nonresponse_units], [96, 0]);
  assert.equal(reference.recall_reach.reachable, true);
  assert.equal(reference.counts.copy_check.run_words, journalPointerCopyRunWords({}));
  // The pilot runs.
  assert.equal((await f.run("pointer-pilot")).pointer.pilot.status, "done");
});

test("a finished reference step is counted again from its stored answers after its deadline, sending nothing and saving nothing", async (t) => {
  const later = { ms: 0 };
  let sends = 0;
  let lookups = 0;
  // Both judges hold back a page's first quote on the even pages, as something left out.
  const f = await runtimeEnvironment(t, { refuse: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0,
    now: () => new Date(Date.now() + later.ms),
    // As the work exchange's receipts do, each says when its answer came, so it can be read back after the deadline.
    wrapPort: (port) => Object.freeze({ ...port, invoke: async (...args) => {
      sends += 1;
      const result = await port.invoke(...args);
      return { ...result, receipt: { ...result.receipt, provider_route_receipt: { received_at: new Date(Date.now() + later.ms).toISOString() } } };
    }, getCompletion: (...args) => { lookups += 1; return port.getCompletion(...args); } }) });
  await assert.rejects(f.run("stage", "pointer-recount"), { code: "POINTER_REFERENCE_NOT_DONE" });
  const { reference } = (await f.run("build-quotes", "pointer-reference")).pointer;
  // Before the deadline a call could still be sent, so nothing is counted again.
  await assert.rejects(f.run("pointer-recount"), { code: "POINTER_RECOUNT_BEFORE_DEADLINE" });
  later.ms = Date.parse(reference.deadline) - Date.now() + 60_000;
  const [sent, looked] = [sends, lookups];
  const before = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  const { recount, pointer } = await f.run("pointer-recount");
  assert.equal(sends, sent, "nothing is sent");
  assert.equal(lookups, looked, "only the store is read: the port isn't asked, so it can't hand over a late answer");
  assert.deepEqual(JSON.parse(await fs.readFile(f.stateFile, "utf8")).pointer, before.pointer, "nothing is saved");
  assert.deepEqual([recount.run_id, recount.step, recount.matches_stored_counts], [pointer.run_id, "reference", true]);
  assert.deepEqual(recount.counts, reference.counts);
  const { held_back: heldBack, by_round: byRound } = recount.counts.judges;
  assert.ok(heldBack.codex.checks > 0);
  assert.deepEqual(heldBack.codex, { checks: heldBack.codex.checks, left_out: heldBack.codex.checks, repeated: 0, combined: 0, copied: 0 });
  assert.deepEqual(heldBack.claude, heldBack.codex);
  assert.deepEqual([heldBack.codex_only.checks, heldBack.claude_only.checks], [0, 0], "the judges here always agree");
  assert.equal(byRound[0].checks + byRound[1].checks, recount.counts.judges.agreement.items);
  // Every count the stored step holds is compared, the copy check's and the judges' reasons and flags included: one that
  // no longer follows from the stored answers shows.
  for (const tamper of [(counts) => { counts.copy_check.copying += 1; }, (counts) => { counts.judges.held_back.codex.left_out += 1; },
    (counts) => { counts.judges.copying_flagged.claude += 1; }, (counts) => { counts.unconfirmed_questions += 1; }]) {
    const changed = structuredClone(before);
    tamper(changed.pointer.reference.counts);
    await fs.writeFile(f.stateFile, JSON.stringify(changed), { mode: 0o600 });
    assert.equal((await f.run("pointer-recount")).recount.matches_stored_counts, false);
  }
  await fs.writeFile(f.stateFile, JSON.stringify(before), { mode: 0o600 });
  // A reference stored before the reasons were counted gets them from the recount, and its other counts still match.
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  delete state.pointer.reference.counts.judges.held_back;
  delete state.pointer.reference.counts.judges.by_round;
  delete state.pointer.reference.counts.judges.copying_flagged;
  await fs.writeFile(f.stateFile, JSON.stringify(state), { mode: 0o600 });
  const older = (await f.run("pointer-recount")).recount;
  assert.equal(older.matches_stored_counts, true);
  assert.deepEqual(older.counts.judges.held_back, heldBack);
  // Stored counts without the copy check's and the unconfirmed units' counts still match: only the counts held are
  // compared.
  for (const name of ["copy_check", "unconfirmed_units", "unconfirmed_questions", "unconfirmed_critical_questions"]) delete state.pointer.reference.counts[name];
  await fs.writeFile(f.stateFile, JSON.stringify(state), { mode: 0o600 });
  const oldest = (await f.run("pointer-recount")).recount;
  assert.equal(oldest.matches_stored_counts, true);
  assert.deepEqual(oldest.counts.copy_check, reference.counts.copy_check);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained"]) assert.equal(JSON.stringify(older).includes(word), false, word);
});

test("a run from before owner decision 30 keeps its rules, so its recount follows it: a copying flag holds a quote back, and an unconfirmed unit is a nonresponse", async (t) => {
  const later = { ms: 0 };
  // Both judges list the question of every even page's quote that asks about its word as copying it, in both rounds.
  const f = await runtimeEnvironment(t, { copied: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0,
    now: () => new Date(Date.now() + later.ms),
    wrapPort: (port) => Object.freeze({ ...port, invoke: async (...args) => {
      const result = await port.invoke(...args);
      return { ...result, receipt: { ...result.receipt, provider_route_receipt: { received_at: new Date(Date.now() + later.ms).toISOString() } } };
    } }) });
  // The run opens (its pilot can't start before the reference step) and, as code from before the decision wrote it, has
  // no copy-run setting.
  await assert.rejects(f.run("stage", "build-quotes", "pointer-pilot"), { code: "POINTER_REFERENCE_NOT_DONE" });
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  delete state.pointer.copy_run_words;
  await fs.writeFile(f.stateFile, JSON.stringify(state), { mode: 0o600 });
  const stopped = (await f.run("pointer-reference")).pointer;
  assert.equal(stopped.blocker, "POINTER_REFERENCE_NONRESPONSE");
  const { reference } = stopped;
  assert.deepEqual(reference.unconfirmed_units, []);
  assert.ok(reference.nonresponse_units.length > 0);
  assert.ok(reference.nonresponse_units.every((unit) => unit.reason === "coverage_unconfirmed"));
  const { held_back: heldBack } = reference.counts.judges;
  assert.ok(heldBack.codex.checks > 0);
  assert.deepEqual(heldBack.codex, { checks: heldBack.codex.checks, left_out: 0, repeated: 0, combined: 0, copied: heldBack.codex.checks });
  assert.deepEqual(reference.counts.judges.copying_flagged, { codex: heldBack.codex.checks, claude: heldBack.claude.checks });
  assert.deepEqual([reference.counts.copy_check.run_words, reference.counts.copy_check.copying], [null, 0]);
  // After its deadline, the recount follows it exactly.
  later.ms = Date.parse(reference.deadline) - Date.now() + 60_000;
  const { recount } = await f.run("pointer-recount");
  assert.equal(recount.matches_stored_counts, true);
  assert.deepEqual(recount.counts, reference.counts);
});

test("the step deadlines are run settings, checked before anything runs", async (t) => {
  assert.deepEqual(journalPointerDeadlines({}), { reference: 180, pass: 180, measure: 300 });
  assert.deepEqual(journalPointerDeadlines({ pointer_reference_deadline_minutes: 60, pointer_deadline_minutes: 90, pointer_measure_deadline_minutes: 120 }),
    { reference: 60, pass: 90, measure: 120 });
  for (const value of [0, -5, 1.5, "180", 24 * 60 + 1]) {
    assert.throws(() => journalPointerDeadlines({ pointer_deadline_minutes: value }), { code: "JOURNAL_POINTER_DEADLINE_INVALID" });
  }
  const f = await runtimeEnvironment(t);
  f.config.pointer_measure_deadline_minutes = 0;
  await assert.rejects(f.open(), { code: "JOURNAL_POINTER_DEADLINE_INVALID" });
});

test("a run reads dates as the setting said when it started: a changed setting needs a new run, which starts over", async (t) => {
  const f = await runtimeEnvironment(t);
  const first = (await f.run("stage", "pointer-reference")).pointer;
  assert.equal(first.numeric_date_order, "month_first");
  f.config.quote_numeric_date_order = "day_first";
  await assert.rejects(f.run("pointer-pilot"), { code: "POINTER_RUN_SETTING_CHANGED" });
  const cleared = await f.run("pointer-new-run");
  assert.equal(cleared.pointer, undefined);
  assert.equal(cleared.pointer_runs_before, 1);
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  assert.equal(state.pointer_history[0].run_id, first.run_id);
  assert.equal(state.pointer_history[0].reference.status, "done");
  assert.equal(JSON.stringify(state.pointer_history).includes("\"seed\""), false, "history keeps the seed's digest only");
  const second = (await f.run("pointer-reference")).pointer;
  assert.notEqual(second.run_id, first.run_id);
  assert.match(second.generation, /:quotes:quote-index-v2-day-first:pointer-[0-9a-f]{8}$/u);
  assert.notEqual(second.reference.seed_sha256, first.reference.seed_sha256);
  assert.equal(second.reference.status, "done");
});

test("the copy check's run length is a run setting, checked before anything runs and kept by a run", async (t) => {
  assert.equal(journalPointerCopyRunWords({}), 8);
  assert.equal(journalPointerCopyRunWords({ pointer_copy_run_words: 5 }), 5);
  for (const value of [2, 21, 7.5, "8"]) {
    assert.throws(() => journalPointerCopyRunWords({ pointer_copy_run_words: value }), { code: "JOURNAL_POINTER_COPY_RUN_INVALID" });
  }
  const f = await runtimeEnvironment(t);
  f.config.pointer_copy_run_words = 2;
  await assert.rejects(f.open(), { code: "JOURNAL_POINTER_COPY_RUN_INVALID" });
  f.config.pointer_copy_run_words = 6;
  const first = (await f.run("stage", "pointer-reference")).pointer;
  assert.equal(first.copy_run_words, 6);
  assert.equal(first.reference.counts.copy_check.run_words, 6);
  // A changed setting needs a new run, as the date setting does.
  f.config.pointer_copy_run_words = 7;
  await assert.rejects(f.run("pointer-pilot"), { code: "POINTER_RUN_SETTING_CHANGED" });
  // A run from before the copy check has no setting of its own, and goes on under any.
  const state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  delete state.pointer.copy_run_words;
  await fs.writeFile(f.stateFile, JSON.stringify(state), { mode: 0o600 });
  assert.equal((await f.run("pointer-pilot")).pointer.pilot.status, "done");
});

// The mock port, counting the calls it holds at once, by tier and in all.
function countingPort(port) {
  const inFlight = { standard: 0, hardest: 0, all: 0 };
  const most = { standard: 0, hardest: 0, all: 0 };
  const wrapped = Object.fromEntries(Object.entries(port).map(([name, value]) => [name, typeof value === "function" ? value.bind(port) : value]));
  wrapped.invoke = async (input, options) => {
    const tier = input.tier ?? "standard";
    for (const key of [tier, "all"]) { inFlight[key] += 1; most[key] = Math.max(most[key], inFlight[key]); }
    try {
      await new Promise((resolve) => { setImmediate(resolve); });
      return await port.invoke(input, options);
    } finally { for (const key of [tier, "all"]) inFlight[key] -= 1; }
  };
  return { port: Object.freeze(wrapped), most };
}
const route = (provider) => ({ INNER_SIGNAL_JOURNAL_INFERENCE_ROUTE_JSON: JSON.stringify({ provider }) });

test("on a direct browser route every pointer step sends its standard calls one at a time; the exchange takes them at once", async (t) => {
  // A browser route, its hardest lane on the exchange: the standard tier takes turns on the one page through every
  // step, and hardest calls go out together.
  let counted = null;
  const browser = await runtimeEnvironment(t, { environment: route("chatgpt_subscription_browser"),
    wrapPort: (port) => { counted = countingPort(port); return counted.port; } });
  browser.config.hardest_lane = { enabled: true, daily_limit: 40 };
  await browser.run("stage", "publish-quotes", "pointer-reference", "pointer-challenge", "pointer-pilot", "pointer-pass");
  const measured = await browser.run("pointer-measure");
  assert.equal(measured.pointer.measure.status, "done");
  assert.equal(counted.most.standard, 1);
  assert.ok(counted.most.hardest > 1, "hardest calls went out together");

  // The Codex exchange queues every call at once.
  let exchange = null;
  const queued = await runtimeEnvironment(t, { environment: route("codex_exec_exchange"),
    wrapPort: (port) => { exchange = countingPort(port); return exchange.port; } });
  await queued.run("stage", "build-quotes", "pointer-reference");
  assert.ok(exchange.most.standard > 1, "standard calls went out together");
});

test("a pointer step that reaches the Claude daily limit stops and resumes, and the import's own blocker stays as it was", async (t) => {
  const f = await runtimeEnvironment(t);
  f.config.hardest_lane = { enabled: true, daily_limit: 2 };
  await f.run("stage", "build-quotes");
  // The import stopped for its own reason.
  const stopped = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  stopped.blocker = "CALIBRATION_REFERENCE_MISSED";
  await fs.writeFile(f.stateFile, JSON.stringify(stopped), { mode: 0o600 });

  await assert.rejects(f.run("pointer-reference"), { code: "HARDEST_DAILY_LIMIT" });
  let state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  assert.equal(state.blocker, "CALIBRATION_REFERENCE_MISSED");
  assert.equal(state.hardest_lane.sent, 2);
  assert.equal(state.pointer.reference.status, "running");
  assert.equal(state.pointer.blocker, null);

  // With room again, the step resumes with its saved deadline and finishes; the import's blocker is still its own.
  const deadline = state.pointer.reference.deadline;
  f.config.hardest_lane = { enabled: true, daily_limit: 40 };
  const resumed = await f.run("pointer-reference");
  assert.equal(resumed.pointer.reference.status, "done");
  assert.equal(resumed.pointer.reference.deadline, deadline);
  assert.equal(resumed.pointer.reference.counts.complete_units, 96);
  state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  assert.equal(state.blocker, "CALIBRATION_REFERENCE_MISSED");
  assert.ok(state.hardest_lane.sent > 2);
});

test("the steps that use Claude's judge need an attested hardest route, and its calls count against the Claude limit, the lane on or off", async (t) => {
  // A route whose hardest tier attests nothing (a browser route without the hardest lane, or the connector exchange):
  // the reference step refuses before it starts, and so do the challenge set and the measurement.
  const unattested = await runtimeEnvironment(t, { environment: route("chatgpt_subscription_browser"), attested: false });
  await unattested.run("stage", "build-quotes");
  await assert.rejects(unattested.run("pointer-reference"), { code: "POINTER_HARDEST_ROUTE_UNATTESTED" });
  assert.equal(JSON.parse(await fs.readFile(unattested.stateFile, "utf8")).pointer.reference, undefined, "the step never started");
  await assert.rejects(unattested.run("pointer-challenge"), { code: "POINTER_HARDEST_ROUTE_UNATTESTED" });
  await assert.rejects(unattested.run("pointer-measure"), { code: "POINTER_HARDEST_ROUTE_UNATTESTED" });

  // The second judge must be Claude Opus at high or max effort, the lane on or off: the exchange would send hardest calls
  // with another configured model or effort and attest it.
  const other = await runtimeEnvironment(t, { environment: route("codex_exec_exchange") });
  await other.run("stage", "build-quotes");
  for (const setting of [{ model: "claude-sonnet-5-5" }, { effort: "medium" }, { effort: "xhigh" }]) {
    other.config.hardest_lane = { enabled: false, ...setting };
    await assert.rejects(other.run("pointer-reference"), { code: "POINTER_HARDEST_JUDGE_UNEXPECTED" });
  }

  // The Codex exchange with the lane off still sends hardest calls to its hardest model, Claude, so the limit holds. Its
  // judge here runs at high effort, which passes the check above.
  const exchange = await runtimeEnvironment(t, { environment: route("codex_exec_exchange") });
  exchange.config.hardest_lane = { enabled: false, effort: "high", daily_limit: 1 };
  await exchange.run("stage", "build-quotes");
  await assert.rejects(exchange.run("pointer-reference"), { code: "HARDEST_DAILY_LIMIT" });
  assert.equal(JSON.parse(await fs.readFile(exchange.stateFile, "utf8")).hardest_lane.sent, 1);
});
