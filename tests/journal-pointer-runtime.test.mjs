import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { POINTER_DEADLINE_DEFAULTS, journalPointerDeadlines } from "../src/journal-import/run-config.mjs";
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
// judges confirm and accept everything except the quotes whose word `refuse` picks.
function handlers({ refuse = () => false } = {}) {
  const rainTerm = (text) => `pluie${text.match(/vemmet(\d+)/u)[1]}`;
  return {
    question_writer: (packet) => ({ schema_version: "1.0", questions: packet.quote_units.flatMap((quote) => [
      { unit_id: quote.unit_id, question: `What was seen, ask about ${distinct(quote.text)}`, critical: false, event: false },
      { unit_id: quote.unit_id, question: `What was the weather, ask about ${rainTerm(quote.text)}`, critical: false, event: false }]) }),
    coverage_judge: (packet) => ({ schema_version: "1.0", judgments: packet.quotes.map((quote) => {
      const refused = refuse(distinct(quote.text));
      return { unit_id: quote.unit_id, covered: !refused, missing: refused ? "something is left out" : "", critical_question_ids: [],
        event_question_ids: [], repeated_question_ids: [], combined_question_ids: [], copied_question_ids: [] };
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
  const port = options.wrapPort ? options.wrapPort(mock) : mock;
  const open = () => openJournalExecutionRuntime({ config, configPath, service, inferencePort: port, sourceParser,
    environment: { INNER_SIGNAL_PRIVATE_CASE_OPERATION_TOKEN: WRITER, ...(options.environment ?? {}) } });
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

test("reference units the coverage judges never confirm stop the run before the pilot, each listed by its page", async (t) => {
  // The judges never confirm a page's first quote on the even pages.
  const f = await runtimeEnvironment(t, { refuse: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0 });
  await f.run("stage", "build-quotes");
  const stopped = await f.run("pointer-reference");
  assert.equal(stopped.pointer.blocker, "POINTER_REFERENCE_NONRESPONSE");
  const { reference } = stopped.pointer;
  assert.ok(reference.nonresponse_units.length > 0);
  for (const unit of reference.nonresponse_units) {
    assert.match(unit.unit_id, /^page:\d+$/u);
    assert.equal(Number(unit.unit_id.slice("page:".length)) % 2, 0);
    assert.equal(unit.reason, "coverage_unconfirmed");
  }
  assert.equal(reference.counts.nonresponse_units, reference.nonresponse_units.length);
  assert.equal(reference.counts.complete_units + reference.counts.nonresponse_units, 96);
  await assert.rejects(f.run("pointer-pilot"), { code: "POINTER_REFERENCE_NONRESPONSE" });
  // Status still answers.
  assert.equal((await f.run("status")).pointer.blocker, "POINTER_REFERENCE_NONRESPONSE");
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

test("on a direct browser route every pointer step sends one call at a time; the exchange takes them at once", async (t) => {
  // A browser route with the hardest lane off: both tiers share the one page, through every step.
  let counted = null;
  const browser = await runtimeEnvironment(t, { environment: route("chatgpt_subscription_browser"),
    wrapPort: (port) => { counted = countingPort(port); return counted.port; } });
  await browser.run("stage", "publish-quotes", "pointer-reference", "pointer-challenge", "pointer-pilot", "pointer-pass");
  const measured = await browser.run("pointer-measure");
  assert.equal(measured.pointer.measure.status, "done");
  assert.ok(counted.most.standard >= 1 && counted.most.hardest >= 1, "both tiers were called");
  assert.equal(counted.most.all, 1);

  // With the hardest lane on, hardest calls go to the exchange at once, and the standard tier still takes turns.
  let lanes = null;
  const hybrid = await runtimeEnvironment(t, { environment: route("chatgpt_subscription_browser"),
    wrapPort: (port) => { lanes = countingPort(port); return lanes.port; } });
  hybrid.config.hardest_lane = { enabled: true, daily_limit: 40 };
  await hybrid.run("stage", "build-quotes", "pointer-reference");
  assert.equal(lanes.most.standard, 1);
  assert.ok(lanes.most.hardest > 1, "hardest calls went out together");

  // The Codex exchange queues every call at once.
  let exchange = null;
  const queued = await runtimeEnvironment(t, { environment: route("codex_exec_exchange"),
    wrapPort: (port) => { exchange = countingPort(port); return exchange.port; } });
  await queued.run("stage", "build-quotes", "pointer-reference");
  assert.ok(exchange.most.standard > 1, "standard calls went out together");
});

test("a pointer step that reaches the Claude daily limit stops and resumes, and the import's own blocker stays as it was", async (t) => {
  const f = await runtimeEnvironment(t);
  f.config.hardest_lane = { daily_limit: 2 };
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
  f.config.hardest_lane = { daily_limit: 40 };
  const resumed = await f.run("pointer-reference");
  assert.equal(resumed.pointer.reference.status, "done");
  assert.equal(resumed.pointer.reference.deadline, deadline);
  assert.equal(resumed.pointer.reference.counts.complete_units, 96);
  state = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  assert.equal(state.blocker, "CALIBRATION_REFERENCE_MISSED");
  assert.ok(state.hardest_lane.sent > 2);
});
