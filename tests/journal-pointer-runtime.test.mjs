import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJournalPrivateApi } from "../src/journal-import/http.mjs";
import { openJournalExecutionRuntime } from "../src/journal-import/private-runtime.mjs";
import { createMockJournalInferencePort } from "../src/journal-import/provider-port.mjs";
import { POINTER_DEADLINE_DEFAULTS, journalPointerCopyRunWords, journalPointerDeadlines, journalPointerRules } from "../src/journal-import/run-config.mjs";
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
// question of each quote whose word `copied` picks. On the quotes whose word `copyText` picks, the first question is the
// quote's first sentence, word for word, which the copy check of owner decision 30 catches.
function handlers({ refuse = () => false, copied = () => false, pairs = () => true, copyText = () => false, events = false } = {}) {
  const rainTerm = (text) => `pluie${text.match(/vemmet(\d+)/u)[1]}`;
  return {
    question_writer: (packet) => ({ schema_version: "1.0", questions: packet.quote_units.flatMap((quote) => [
      { unit_id: quote.unit_id, question: copyText(distinct(quote.text)) ? quote.text.split("\n")[0] : `What was seen, ask about ${distinct(quote.text)}`,
        critical: false, event: false },
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
      // With `events`, the rain is also an event the quote reports as happening.
      if (events && quote.text.includes("rained")) tags.push({ kind: "event", label: "rain", anchors: anchor("rained") });
      return tags;
    }) }),
    pair_judge: (packet) => ({ schema_version: "1.0", judgments: packet.pairs.map((pair) => ({ pair_id: pair.pair_id, mentions: pairs(pair), kind_right: true })) })
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
  const config = { schema_version: 1, import_order: "legacy_quote_first", max_external_spend_usd: 0, execution_root: path.join(root, "execution"), private_runtime_root: root,
    source: { relative_path: "private/source.txt", bytes: Buffer.byteLength(text), sha256: sha256(text) },
    target_profile: { case_id: CASE_ID }, existing_grant_ref: "synthetic:grant",
    // These tests were written for owner decision 30's rules; owner decision 32's (the default for a new run) pass
    // `rules: 3`.
    pointer_rules: options.rules ?? 2 };
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

  // A date setting changed after the measurement holds publication back, as it does every step, and so does a changed
  // copy-run setting.
  f.config.quote_numeric_date_order = "day_first";
  await assert.rejects(f.run("pointer-publish"), { code: "POINTER_RUN_SETTING_CHANGED" });
  await assert.rejects(f.run("pointer-rebase"), { code: "POINTER_RUN_SETTING_CHANGED" });
  delete f.config.quote_numeric_date_order;
  f.config.pointer_copy_run_words = 7;
  await assert.rejects(f.run("pointer-publish"), { code: "POINTER_RUN_SETTING_CHANGED" });
  delete f.config.pointer_copy_run_words;

  // The run was built and measured on version 2 of the quote index, and the current version is the one published (issue #168):
  // its own generation would take the published quotes back a version, so its tags go out only built again on the current one.
  assert.match(published.active_generation, /:quotes:quote-index-v4-month-first$/u);
  await assert.rejects(f.run("pointer-publish"), { code: "POINTER_REBASE_NEEDED" });
  const stateBefore = await fs.readFile(f.stateFile, "utf8");
  const rebased = await f.run("pointer-rebase");
  const { rebased: carried } = rebased.pointer;
  assert.equal(carried.generation, `${published.active_generation}:pointer-${rebased.pointer.run_id}`);
  // The carried generation's dates, in counts: every quote has a date, a range, a range open at one end, or none.
  const { dates } = carried;
  const order = dates.time_order;
  assert.equal(order.dated_quotes + order.ranged_quotes + order.open_start_quotes + order.open_end_quotes + order.undated_quotes, dates.quotes);
  assert.equal(order.dated_quotes, dates.dated_quotes);
  assert.equal(carried.step_id, measure.measured_step_id);
  // The same questions, the same tags: with tags every question is found, with words only the half that asks in the
  // quotes' own words, as the measurement found on version 2.
  assert.deepEqual([carried.measure.recall.estimate, carried.measure.recall_words_only.estimate, carried.measure.gain.estimate],
    [1, 0.5, 1]);
  assert.equal(carried.measure.questions, measure.report.recall_units.reduce((total, unit) => total + unit.questions, 0));
  assert.equal("manifest_object_id" in carried || "manifest_reference" in carried, false, "status shows no private reference");
  assert.notEqual(await fs.readFile(f.stateFile, "utf8"), stateBefore);
  // Readers still see no change, and building it again changes nothing.
  assert.equal((await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER })).journal_corpora
    .find((item) => item.corpus_id === published.corpus_id).active_generation, published.active_generation);
  assert.equal((await f.run("pointer-rebase")).pointer.rebased.built_at, carried.built_at);
  const shownRebase = JSON.stringify(rebased.pointer);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained"]) assert.equal(shownRebase.includes(word), false, word);

  const deployed = await f.run("pointer-publish");
  assert.equal(deployed.pointer.published.supersedes, published.active_generation);
  assert.equal(deployed.pointer.published.generation, carried.generation);
  const after = (await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER })).journal_corpora.find((item) => item.corpus_id === published.corpus_id);
  assert.equal(after.active_generation, carried.generation);
  // A reader now finds the rain on page 17 by its tag, in words its quote doesn't use, on version 3's ranking.
  const api = createJournalPrivateApi({ caseAccessService: f.service });
  const reader = { bearerToken: READER };
  const found = await api.findQuotes({ caseId: CASE_ID, corpusId: published.corpus_id, query: "pluie17", purpose: "session_use" }, reader);
  assert.deepEqual(found.quotes.map((quote) => [quote.text, quote.matched_by]), [[PAGES[16].trimEnd(), "tag"]]);
  assert.equal(found.coverage.ranking, "word_forms");
  assert.equal(found.snapshot.generation, carried.generation);
  // The graph tools answer from the published generation: a person tag is a node search finds, its subgraph reaches the
  // quote it is anchored in, and that quote resolves to its exact words. (This tagger tags no event: the timeline is
  // tested below with one that does.)
  const graph = await api.search({ caseId: CASE_ID, corpusId: published.corpus_id, query: "Jean", purpose: "session_use" }, reader);
  const person = graph.items.find((item) => item.kind === "entity");
  assert.ok(person, "a person tag is a node the graph search finds");
  const group = await api.getSubgraph({ caseId: CASE_ID, corpusId: published.corpus_id, seedIds: [person.id], purpose: "session_use" }, reader);
  const passages = group.nodes.filter((node) => node.kind === "passage");
  assert.ok(passages.length > 0, "the subgraph reaches the quote the tag is anchored in");
  const resolved = await api.resolveEvidence({ caseId: CASE_ID, corpusId: published.corpus_id, evidenceIds: [passages[0].id], purpose: "session_use" }, reader);
  assert.equal(JSON.stringify(resolved).includes(passages[0].data.quote.slice(0, 20)), true, "the quote resolves to its exact words");
  // A reader of another case sees nothing of it.
  await assert.rejects(api.search({ caseId: "another-case", corpusId: published.corpus_id, query: "Jean", purpose: "session_use" }, reader));
  // Publishing again changes nothing, and the quote index alone can't be published over the tags.
  assert.equal((await f.run("pointer-publish")).pointer.published.at, deployed.pointer.published.at);
  await assert.rejects(f.run("publish-quotes"), { code: "QUOTE_PUBLISH_WOULD_DROP_TAGS" });
});

test("under owner decision 32's rules Codex alone judges, a piece still not covered is marked and measured, nothing in the reference step stops the run, and the floors don't block publication", async (t) => {
  const tiers = [];
  // The judge never confirms a page's first quote on the even pages, about half the sample; the pair judge accepts no
  // pair, so the precision floors fail; and the route attests nothing for Claude, whom these rules never call.
  const f = await runtimeEnvironment(t, { rules: 3, attested: false, pairs: () => false,
    refuse: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0,
    wrapPort: (port) => Object.freeze({ ...port, invoke: async (input, options) => { tiers.push(input.tier ?? "standard"); return port.invoke(input, options); } }) });
  await f.run("stage", "publish-quotes");
  const referenced = await f.run("pointer-reference");
  const { reference } = referenced.pointer;
  assert.deepEqual([referenced.pointer.pointer_rules, referenced.pointer.blocker], [3, null]);
  assert.ok(reference.counts.marked_units > 30, "the even pages' units are marked");
  assert.deepEqual([reference.counts.complete_units + reference.counts.marked_units, reference.counts.nonresponse_units,
    reference.counts.unconfirmed_units], [96, 0, 0]);
  assert.deepEqual(reference.counts.marked_by_reason, { coverage_unconfirmed: reference.counts.marked_units });
  assert.equal(reference.recall_reach, null);
  assert.deepEqual(reference.unconfirmed_units, []);
  const { judges } = reference.counts;
  assert.deepEqual([judges.claude_confirmed, judges.agreement, judges.held_back.claude, judges.copying_flagged.claude], [null, null, null, null]);
  assert.ok(judges.held_back.codex.left_out > 0);
  // Nothing stops the run: the pilot, the pass and calibration's set go on.
  assert.equal((await f.run("pointer-pilot")).pointer.pilot.status, "done");
  await f.run("pointer-pass", "pointer-challenge");
  const measured = await f.run("pointer-measure");
  const { measure } = measured.pointer;
  assert.deepEqual([measure.publish, measure.floors_block, measured.pointer.blocker], [true, false, null]);
  assert.ok(measure.failed_floors.length > 0, "the precision floors fail, and are reported");
  // The marked units' questions were searched and measured like the complete ones': with tags, every one is found.
  assert.equal(measure.floors.recall.estimate, 1);
  assert.deepEqual([...new Set(tiers)], ["standard"], "no call went to Claude");
  // Built on version 2, the run's tags go out on version 3 (issue #168), and carrying them there sends nothing.
  const sent = tiers.length;
  await f.run("pointer-rebase");
  assert.equal(tiers.length, sent, "pointer-rebase sends nothing");
  const deployed = await f.run("pointer-publish");
  assert.ok(deployed.pointer.published);
  assert.match(deployed.pointer.published.generation, /:quotes:quote-index-v4-month-first:pointer-[0-9a-f]{8}$/u);
  // A run keeps the rules it started with: other rules call for a new run.
  f.config.pointer_rules = 2;
  await assert.rejects(f.run("pointer-publish"), { code: "POINTER_RUN_SETTING_CHANGED" });
});

test("a published pointer run answers the timeline: each kept event tag is an entry, tied to its quote, in the lane its quote's date puts it", async (t) => {
  const f = await runtimeEnvironment(t, { rules: 3, attested: false, events: true });
  await f.run("stage", "publish-quotes");
  await f.run("pointer-reference", "pointer-pilot", "pointer-pass", "pointer-challenge", "pointer-measure");
  const before = (await f.service.loadPrivateRuntimeCase(CASE_ID, { bearerToken: READER })).journal_corpora.find((item) => item.corpus_id.endsWith(":quotes"));
  const api = createJournalPrivateApi({ caseAccessService: f.service });
  const reader = { bearerToken: READER };
  const ask = { caseId: CASE_ID, corpusId: before.corpus_id, purpose: "session_use" };
  // Before publication the quote index has quotes and no tags: the timeline is empty, as it was live on 16 Oct 2026, and
  // the graph search finds quotes only.
  assert.deepEqual((await api.timeline(ask, reader)).items, []);
  const quotesOnly = await api.search({ ...ask, query: "rained" }, reader);
  assert.ok(quotesOnly.items.length > 0 && quotesOnly.items.every((item) => item.kind === "passage"), "the graph search finds the quotes");
  await f.run("pointer-rebase", "pointer-publish");
  const timeline = await api.timeline({ ...ask, pageSize: 200 }, reader);
  const events = timeline.items.filter((item) => item.kind === "episode");
  assert.equal(events.length, PAGE_COUNT, "every page tells of rain, and every rain tag was kept");
  // This journal has no date lines, so every event is in the unknown lane, with its quote as its evidence; its event time
  // is never claimed, only the time its quote was written, here unknown.
  assert.deepEqual([...new Set(events.map((event) => event.timeline_entry.lane))], ["unknown"]);
  assert.equal(timeline.unknown_count, PAGE_COUNT);
  for (const event of events.slice(0, 5)) {
    assert.deepEqual([event.data.event_time.precision, event.data.authored_time.precision], ["unknown", "unknown"]);
    const [evidence] = event.data.evidence_ids;
    const resolved = await api.resolveEvidence({ ...ask, evidenceIds: [evidence] }, reader);
    assert.match(JSON.stringify(resolved), /rained over the vemmet\d+/u, "the event resolves to the exact words that report it");
  }
  // The event label is a node the graph search finds, and its subgraph reaches its quote.
  const rain = await api.search({ ...ask, query: "rain", filters: { kinds: ["episode"] } }, reader);
  assert.ok(rain.items.length > 0 && rain.items.every((item) => item.kind === "episode"));
  const group = await api.getSubgraph({ ...ask, seedIds: [rain.items[0].id] }, reader);
  assert.ok(group.nodes.some((node) => node.kind === "passage" && /rained/u.test(node.data.quote)));

  // The operator's readback says the same in counts, through the reader the connector opens, and changes nothing.
  const stateBefore = await fs.readFile(f.stateFile, "utf8");
  const { published_readback: readback, pointer } = await f.run("published-readback");
  assert.equal(await fs.readFile(f.stateFile, "utf8"), stateBefore, "nothing is saved");
  assert.deepEqual(readback, { generation: pointer.published.generation, pointer_generation: true, node_count: readback.node_count, word_list: true,
    events: { known_lane: 0, unknown_lane: PAGE_COUNT }, events_checked: 20, events_found: 20, tags_checked: 20, tags_found: 20,
    subgraphs_reaching_quote: 20, quotes_resolved: 20, refused_without_grant: true });
  assert.ok(readback.node_count > PAGE_COUNT);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained", "rain"]) assert.equal(JSON.stringify(readback).includes(word), false, word);
});

test("pointer-search-check reads the measured run back and says, in counts only, where the questions' quotes rank and what each way of matching words would find", async (t) => {
  let sends = 0;
  // On the even pages a question copies its quote's first sentence: flagged by the copy check, left out of every count.
  const f = await runtimeEnvironment(t, { rules: 3, attested: false,
    copyText: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0,
    wrapPort: (port) => Object.freeze({ ...port, invoke: async (...args) => { sends += 1; return port.invoke(...args); } }) });
  await f.run("stage", "publish-quotes");
  await assert.rejects(f.run("pointer-search-check"), { code: "POINTER_NOT_MEASURED" });
  await assert.rejects(f.run("quote-search-check"), { code: "POINTER_NOT_MEASURED" });
  await f.run("pointer-reference", "pointer-pilot", "pointer-pass", "pointer-challenge");
  await assert.rejects(f.run("pointer-search-check"), { code: "POINTER_NOT_MEASURED" });
  await assert.rejects(f.run("quote-search-check"), { code: "POINTER_NOT_MEASURED" });
  const measuredRun = (await f.run("pointer-measure")).pointer;
  const { measure } = measuredRun;
  assert.ok(measuredRun.reference.counts.copy_check.copying > 0, "some questions copy their quote");
  const sent = sends;
  const before = await fs.readFile(f.stateFile, "utf8");
  const result = await f.run("pointer-search-check");
  const check = result.search_check;
  assert.equal(sends, sent, "nothing is sent");
  assert.equal(await fs.readFile(f.stateFile, "utf8"), before, "nothing is saved");
  assert.equal(check.run_id, result.pointer.run_id);
  // The questions the measurement counted, and what its search found by words: the same estimate it reported.
  assert.equal(check.questions, measure.report.recall_units.reduce((total, unit) => total + unit.questions, 0));
  assert.equal(check.measured.recall_estimate, measure.floors.no_loss.recall_words_only_estimate);
  // The in-memory copy of the search agrees with it on every question (these quotes are short: the byte budget cuts nothing).
  // The pointer run's generation is named for version 2, which ranks as it always did.
  assert.equal(check.replica.variant, "current");
  assert.deepEqual([check.replica.found, check.replica.measured_only, check.replica.replica_only], [check.measured.found, 0, 0]);
  assert.deepEqual(Object.keys(check.variants), ["current", "accents", "french_stopwords", "english_forms", "french_forms", "all",
    "coordination", "bm25", "bm25_coordination", "forms", "forms_coordination", "forms_bm25", "forms_bm25_coordination"]);
  assert.deepEqual([check.variants.current.found[12], check.variants.current.recall_estimate[12]],
    [check.measured.found, check.measured.recall_estimate]);
  for (const variant of Object.values(check.variants)) {
    assert.ok(variant.found[12] <= variant.found[24] && variant.found[24] <= variant.found[40]);
    assert.equal(Object.values(variant.ranks).reduce((total, count) => total + count, 0), check.questions);
    assert.equal(variant.ranks.top_12, variant.found[12]);
  }
  const shown = JSON.stringify(result);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained"]) assert.equal(shown.includes(word), false, word);

  // The same questions on the quote index's own generation, version 3, built and published at the start: its live search finds
  // exactly what its replica, the check's forms_bm25_coordination, finds on the same quotes.
  const quoteResult = await f.run("quote-search-check");
  const quoteCheck = quoteResult.quote_search_check;
  assert.match(quoteResult.quote_index.generation, /:quotes:quote-index-v4-/u);
  assert.equal(sends, sent, "nothing is sent");
  assert.equal(await fs.readFile(f.stateFile, "utf8"), before, "nothing is saved");
  assert.equal(quoteCheck.run_id, result.pointer.run_id);
  assert.equal(quoteCheck.generation_version, 4);
  assert.equal(quoteCheck.questions, check.questions, "the same questions: they go by unit id, which both versions keep");
  assert.equal(quoteCheck.replica.variant, "forms_bm25_coordination");
  assert.deepEqual([quoteCheck.replica.found, quoteCheck.replica.measured_only, quoteCheck.replica.replica_only], [quoteCheck.measured.found, 0, 0]);
  assert.equal(quoteCheck.variants.forms_bm25_coordination.found[12], quoteCheck.measured.found);
  assert.ok(quoteCheck.measured.found > 0);
  const quoteShown = JSON.stringify(quoteResult);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained"]) assert.equal(quoteShown.includes(word), false, word);
  // A quote index built by an earlier version is not the one this version would publish: build it first.
  const state = JSON.parse(before);
  await fs.writeFile(f.stateFile, JSON.stringify({ ...state, quote_index: { ...state.quote_index,
    generation: state.quote_index.generation.replace("quote-index-v4", "quote-index-v2") } }), { mode: 0o600 });
  await assert.rejects(f.run("quote-search-check"), { code: "QUOTE_INDEX_NOT_BUILT" });
  await fs.writeFile(f.stateFile, before, { mode: 0o600 });
});

test("the pointer rules are a run setting, owner decision 32's by default, checked before anything runs", async (t) => {
  assert.equal(journalPointerRules({}), 3);
  assert.equal(journalPointerRules({ pointer_rules: 2 }), 2);
  for (const value of [1, 4, "3", false]) {
    assert.throws(() => journalPointerRules({ pointer_rules: value }), { code: "JOURNAL_POINTER_RULES_INVALID" });
  }
  const f = await runtimeEnvironment(t, { rules: 4 });
  await assert.rejects(f.open(), { code: "JOURNAL_POINTER_RULES_INVALID" });
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

test("pointer-examples writes the pieces the judges didn't confirm to a new owner-only file in the operator's review directory, and says only its name and counts", async (t) => {
  const later = { ms: 0 };
  let sends = 0;
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-review-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const reviewDir = path.join(parent, "review");
  await fs.mkdir(reviewDir, { mode: 0o700 });
  await fs.chmod(reviewDir, 0o700);
  // Both judges hold back a page's first quote on the even pages, as something left out.
  const f = await runtimeEnvironment(t, { refuse: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0,
    now: () => new Date(Date.now() + later.ms),
    wrapPort: (port) => Object.freeze({ ...port, invoke: async (...args) => {
      sends += 1;
      const result = await port.invoke(...args);
      return { ...result, receipt: { ...result.receipt, provider_route_receipt: { received_at: new Date(Date.now() + later.ms).toISOString() } } };
    } }) });
  const { reference } = (await f.run("stage", "build-quotes", "pointer-reference")).pointer;
  // Without a review directory in the run config, no command writes journal text.
  await assert.rejects(f.run("pointer-examples"), { code: "POINTER_EXAMPLES_NOT_GRANTED" });
  f.config.operator_review_dir = reviewDir;
  await assert.rejects(f.run("pointer-examples"), { code: "POINTER_RECOUNT_BEFORE_DEADLINE" });
  later.ms = Date.parse(reference.deadline) - Date.now() + 60_000;
  const open = path.join(parent, "open");
  await fs.mkdir(open);
  await fs.chmod(open, 0o755);
  for (const [dir, code] of [[open, "POINTER_EXAMPLES_DIR_UNSAFE"], [path.join(parent, "missing"), "POINTER_EXAMPLES_DIR_UNSAFE"],
    ["relative/review", "JOURNAL_OPERATOR_REVIEW_DIR_INVALID"],
    // Never inside the public repository, where a routine commit could publish the file.
    [path.resolve(new URL("../", import.meta.url).pathname, "review"), "JOURNAL_OPERATOR_REVIEW_DIR_PRIVATE_REQUIRED"]]) {
    f.config.operator_review_dir = dir;
    await assert.rejects(f.run("pointer-examples"), { code }, dir);
  }
  const link = path.join(parent, "link");
  await fs.symlink(reviewDir, link);
  f.config.operator_review_dir = link;
  await assert.rejects(f.run("pointer-examples"), { code: "POINTER_EXAMPLES_DIR_UNSAFE" }, "a link to the directory");
  f.config.operator_review_dir = reviewDir;
  const sent = sends;
  const before = JSON.parse(await fs.readFile(f.stateFile, "utf8"));
  const result = await f.run("pointer-examples");
  assert.equal(sends, sent, "nothing is sent");
  assert.deepEqual(JSON.parse(await fs.readFile(f.stateFile, "utf8")).pointer, before.pointer, "nothing is saved");
  const { examples } = result;
  assert.match(examples.file, /^pointer-examples-[A-Za-z0-9_-]+-\d{8}T\d{9}Z-[0-9a-f]{6}\.html$/u);
  assert.equal(examples.pieces, reference.counts.unconfirmed_units + reference.counts.nonresponse_units);
  assert.ok(examples.pieces > 0);
  assert.equal(examples.sampled, 96);
  for (const word of ["Jean", "quolp", "vemmet", "pluie", "rained", "left out"]) assert.equal(JSON.stringify(result).includes(word), false, word);
  // One handle for the mode and the text, so both are the same file's.
  const handle = await fs.open(path.join(reviewDir, examples.file), "r");
  let html;
  try {
    assert.equal((await handle.stat()).mode & 0o777, 0o600);
    html = await handle.readFile("utf8");
  } finally { await handle.close(); }
  for (const unitId of reference.unconfirmed_units) assert.ok(html.includes(`saw a quolp${unitId.slice("page:".length)}.`), unitId);
  assert.equal((html.match(/<section>/gu) ?? []).length, examples.pieces, "only the pieces not confirmed");
  assert.match(html, /<strong>Codex<\/strong>: held back \(something left out\)\.<div class="note">Its note: “something is left out”<\/div>/u);
  assert.match(html, /<strong>Claude<\/strong>: held back \(something left out\)/u);
  assert.match(html, /<h3>First try<\/h3>/u);
  assert.match(html, /<h3>Rewrite<\/h3><p class="small">Notes the judges gave the writer for this rewrite:/u);
  assert.doesNotMatch(html, /The question writer/u, "a writer that answered in full needs no line of its own");
  const pages = [...html.matchAll(/<figcaption>Page (\d+) /gu)].map((match) => Number(match[1]));
  assert.deepEqual(pages, [...pages].sort((a, b) => a - b), "in journal order");
  // Each run writes a file of its own; none is ever written over.
  const again = await f.run("pointer-examples");
  assert.notEqual(again.examples.file, examples.file);
  assert.deepEqual((await fs.readdir(reviewDir)).sort(), [examples.file, again.examples.file].sort());
});

test("under owner decision 32's rules pointer-examples shows the pieces marked as not understood, with Codex's verdicts alone", async (t) => {
  const later = { ms: 0 };
  let sends = 0;
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pointer-review-marked-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const reviewDir = path.join(parent, "review");
  await fs.mkdir(reviewDir, { mode: 0o700 });
  await fs.chmod(reviewDir, 0o700);
  // The judge never confirms a page's first quote on the even pages; the route attests nothing for Claude, whom these
  // rules never call, so the readback can't need it either.
  const f = await runtimeEnvironment(t, { rules: 3, attested: false,
    refuse: (word) => word.startsWith("quolp") && Number(word.slice("quolp".length)) % 2 === 0,
    now: () => new Date(Date.now() + later.ms),
    wrapPort: (port) => Object.freeze({ ...port, invoke: async (...args) => {
      sends += 1;
      const result = await port.invoke(...args);
      return { ...result, receipt: { ...result.receipt, provider_route_receipt: { received_at: new Date(Date.now() + later.ms).toISOString() } } };
    } }) });
  const { reference } = (await f.run("stage", "build-quotes", "pointer-reference")).pointer;
  assert.ok(reference.counts.marked_units > 0);
  later.ms = Date.parse(reference.deadline) - Date.now() + 60_000;
  f.config.operator_review_dir = reviewDir;
  const sent = sends;
  const { examples } = await f.run("pointer-examples");
  assert.equal(sends, sent, "nothing is sent");
  assert.equal(examples.pieces, reference.counts.marked_units + reference.counts.nonresponse_units);
  const html = await fs.readFile(path.join(reviewDir, examples.file), "utf8");
  assert.equal((html.match(/<section>/gu) ?? []).length, examples.pieces);
  assert.match(html, /<h1>Journal pieces marked as not understood<\/h1>/u);
  assert.match(html, /marked as not understood: not covered, even after the rewrite/u);
  assert.match(html, /<strong>Codex<\/strong>: held back \(something left out\)/u);
  assert.doesNotMatch(html, /<strong>Claude<\/strong>/u, "only the run's one judge");
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
