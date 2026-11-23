import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { createRunnerLogWriter, runnerLogFromRecord } from "../src/runner-trial/run-log.mjs";
import { loadRunnerRules } from "../src/runner-trial/released-rules.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { createPrivateRuntimeTurn, validatePrivateRuntimeTurn } from "../src/supervisor/private-runtime-turn-lifecycle.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { prepareReleasedRules, serverEnvironment } from "../scripts/runner-trial-start.mjs";

const exec = promisify(execFile);
const CASE = "case-00000000-0000-4000-8000-000000000000";
const MARKERS = ["Privatepersonmarker", "Privatereplymarker", "Privateprovisionalmarker", "Privatefindingmarker", "Privatequotemarker", "Privateplanmarker", "Privatejournalmarker"];
const at = Date.parse("2026-11-23T12:00:00.000Z");
async function directory(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-log-test-")); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
const configFor = (dir, extra = {}) => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialDir: dir, runnerTrialSettingsPath: null, runnerRulesRoot: null, runnerTrialCaseId: CASE, ...extra });
async function fixture(t, { failure = false, dir = null, keptPlan = false, checkerFailure = false, retryWriter = false, unchangedRepair = false, incompleteChecklist = false } = {}) {
  dir ??= await directory(t);
  let clock = at;
  const store = createEncryptedPrivateCaseStore({ rootDir: path.join(dir, "vault"), routineKek: Buffer.alloc(32, 35), recoverySecretBytes: Buffer.alloc(32, 36), developmentExternalCredentialAuthorized: true, now: () => new Date(clock).toISOString() });
  t.after(() => store.close());
  await store.loadOrCreate(CASE);
  let session = 0;
  let checkerCount = 0;
  let writerCount = 0;
  let writerAttempts = 0;
  const settings = validateRunnerTrialSettings({ writerMode: "whole", checkerMode: "whole" });
  const trial = createRunnerTrialController({ privateCaseSource: store, config: configFor(dir, { runnerKeptPlanEnabled: keptPlan }), settings, now: () => clock, workerFor: (role) => ({ provider: "stand-in", model: "stand-in-model", effort: "low", async call(request) {
    clock += 100;
    session++;
    let value;
    if (role === "R1") value = { level: "acted_or_about_to", wish_or_intent: "intent", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, asks_to_keep_plan: keptPlan && request.user.includes("Keepplanrequestmarker"), asks_to_delete_plan: false, reason: MARKERS[0], provisional_reply: `Call 112 now. ${MARKERS[2]}` };
    else if (role === "R3") value = { compatibility_assessment: null };
    else if (role === "W" || role === "W-repair") {
      if (role === "W" && retryWriter && ++writerAttempts === 1) throw Object.assign(new Error(MARKERS[1]), { code: "TIMEOUT" });
      if (failure) throw Object.assign(new Error(MARKERS[1]), { code: "PLAN_LIMIT" });
      if (role === "W" || !unchangedRepair) writerCount++;
      value = { reply: `${MARKERS[1]} ${writerCount}${keptPlan ? ` ${MARKERS[5]}.` : ""}`, answered_level: "acted_or_about_to", quotes: [], plan_reached: keptPlan, offered_to_keep_plan: false, kept_plan_lines: keptPlan ? [`${MARKERS[5]}.`] : [] };
    } else if (role === "CW" && checkerFailure) throw Object.assign(new Error(MARKERS[3]), { code: "REFUSED" });
    else if (role === "CW") value = { findings: checkerCount++ === 0 ? [{ code: "QUOTE_NOT_EXACT", severity: "high", summary: MARKERS[3], quote: MARKERS[4], evidence_turn_ids: [MARKERS[4]] }] : [], level: "acted_or_about_to", repair_induced_checks: checkerCount > 1 ? REPAIR_INDUCED_ERROR_CHECKS.slice(0, incompleteChecklist ? -1 : undefined) : [], missed_boxes: [] };
    else throw new Error(`unexpected ${role}`);
    return { value, receipt: { provider: "stand-in", model: "stand-in-model", effort: "low", session_id: `stand-in-${session}`, input_tokens: 10, cache_read_input_tokens: 4, cache_creation_input_tokens: 2, output_tokens: 3, reasoning_output_tokens: 1, unrelated_prose: MARKERS[4] } };
  } }) });
  const config = configFor(dir, { runnerKeptPlanEnabled: keptPlan });
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: trial.controller, runnerTrialEvents: trial.events, runnerTrialSettings: trial.settings });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dir, store, trial, base, run: async ({ exchangeId = "synthetic-exchange", userMessage = MARKERS[0] } = {}) => {
    const response = await fetch(`${base}/v1/therapy/respond`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: CASE, exchangeId, userMessage }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  } };
}
async function page(t) {
  const app = await fs.readFile(new URL("../apps/web/app.js", import.meta.url), "utf8");
  const html = await fs.readFile(new URL("../apps/web/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" }); t.after(() => dom.window.close());
  const { document } = dom.window;
  const context = vm.createContext({ TextDecoder, document, $: (id) => document.querySelector(id) });
  vm.runInContext(app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end")), context);
  return { app, document, context };
}

test("a stand-in repair run has exact totals, one receipt per call, fixed findings, and no words in API, JSONL or rendered panel", async (t) => {
  const f = await fixture(t);
  const answer = await f.run();
  assert.equal(answer.answer, `${MARKERS[1]} 2`);
  const record = await f.store.load(CASE);
  // These fields are also possible in the encrypted record and must never be copied out.
  record.runner_kept_plans = [{ lines: [MARKERS[5]] }];
  record.runtime_turns[0].journalEvidence = { excerpt: MARKERS[6] };
  const log = runnerLogFromRecord(record);
  const response = await fetch(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers: { origin: f.base } });
  assert.equal(response.status, 200);
  const api = await response.json();
  assert.deepEqual(api, log);
  const turn = log.turns[0];
  assert.equal(turn.duration_ms, 600);
  assert.equal(turn.first_words_ms, 200);
  assert.equal(turn.workers.length, 6);
  assert.deepEqual(turn.workers.map((call) => call.duration_ms), [200, 100, 100, 100, 100, 100]);
  assert.equal(turn.repair_rounds, 1);
  assert.deepEqual(turn.outcome, { status: "delivered", kind: null, reason_code: null });
  assert.equal(turn.crisis_level, "acted_or_about_to");
  assert.deepEqual(turn.tokens, { input_tokens: 60, cache_read_input_tokens: 24, cache_creation_input_tokens: 12, output_tokens: 18, reasoning_output_tokens: 6 });
  assert.deepEqual(turn.findings, [{ code: "QUOTE_NOT_EXACT", severity: "high" }]);
  assert.ok(turn.workers.every((call) => call.rule_parts.length && call.rule_parts.every((part) => part.bytes > 0)));
  assert.equal(log.summary.workers_per_turn, 6);
  assert.equal(log.summary.repairs_per_turn, 1);
  assert.equal(log.summary.total_time_ms.median, 600);
  assert.equal(log.summary.total_time_ms.p90, 600);
  assert.deepEqual(log.summary.tokens_by_provider_model[0].tokens, turn.tokens);
  await f.trial.logWriter.flush();
  const file = path.join(f.dir, "runner-log.jsonl");
  const jsonl = await fs.readFile(file, "utf8");
  const lines = jsonl.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, "header");
  assert.equal(lines[0].arrangement.writerMode, "whole");
  assert.deepEqual(record.runtime_turns[0].runner_config, { rules: lines[0].runnerRules, arrangement: lines[0].arrangement });
  assert.deepEqual(turn.rules, lines[0].runnerRules);
  assert.deepEqual(turn.arrangement, lines[0].arrangement);
  assert.deepEqual(lines[1], turn);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const p = await page(t);
  p.context.root = p.document.querySelector("#runner-log-panel"); p.context.log = api;
  vm.runInContext("renderRunnerLog(root, log)", p.context);
  assert.equal(p.context.root.querySelectorAll("details").length, 1);
  assert.equal(p.context.root.querySelectorAll("pre").length, 6);
  for (const marker of MARKERS) for (const output of [JSON.stringify(api), jsonl, p.context.root.outerHTML]) assert.equal(output.includes(marker), false, marker);
  // A startup rebuild is exactly the same projection, without duplicate lines on repeated syncs.
  await fs.unlink(file);
  f.trial.controller.startRunLog(null); await f.trial.logWriter.flush();
  assert.equal(await fs.readFile(file, "utf8"), jsonl);
  f.trial.controller.startRunLog(null); await f.trial.logWriter.flush();
  assert.equal(await fs.readFile(file, "utf8"), jsonl);
  const deleted = await fetch(`${f.base}/v1/case/delete`, { method: "POST", headers: { origin: f.base, "content-type": "application/json" }, body: JSON.stringify({ caseId: CASE, confirmation: "DELETE" }) });
  assert.equal(deleted.status, 200);
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
});

test("words in an actually kept plan and journal stay out of the API, file and rendered panel", async (t) => {
  const f = await fixture(t, { keptPlan: true });
  await f.run();
  await f.run({ exchangeId: "synthetic-plan-request", userMessage: "Keepplanrequestmarker" });
  await f.store.appendJournal(CASE, { id: "synthetic-journal", observed_at: new Date(at).toISOString(), text: MARKERS[6] });
  const record = await f.store.load(CASE);
  assert.equal(record.runner_kept_plans[0].lines[0], `${MARKERS[5]}.`);
  await f.trial.logWriter.flush();
  const response = await fetch(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers: { origin: f.base } });
  const log = await response.json();
  const jsonl = await fs.readFile(path.join(f.dir, "runner-log.jsonl"), "utf8");
  const p = await page(t); p.context.root = p.document.querySelector("#runner-log-panel"); p.context.log = log;
  vm.runInContext("renderRunnerLog(root, log)", p.context);
  for (const marker of [...MARKERS, "Keepplanrequestmarker"]) for (const output of [JSON.stringify(log), jsonl, p.context.root.outerHTML]) assert.equal(output.includes(marker), false, marker);
});

test("a failed writer retains its receipt and closes with fixed codes; logging errors are dropped", async (t) => {
  const f = await fixture(t, { failure: true });
  await f.run();
  const log = runnerLogFromRecord(await f.store.load(CASE));
  assert.equal(log.turns[0].workers.length, 3);
  assert.equal(log.turns[0].duration_ms, 300);
  assert.deepEqual(log.turns[0].outcome, { status: "closed", kind: "runner_unavailable", reason_code: "plan_limit" });
  assert.deepEqual(log.summary.failures_by_code, [{ code: "PLAN_LIMIT", count: 1 }]);
  assert.equal(log.turns[0].workers.at(-1).failure_code, "PLAN_LIMIT");
  assert.deepEqual(log.turns[0].failures, ["PLAN_LIMIT"]);
  assert.equal(log.turns[0].tokens.input_tokens, 20);
  const writer = createRunnerLogWriter({ directory: path.join(f.dir, "missing"), runnerRules: loadRunnerRules().runnerRules, arrangement: {}, loadRecord: async () => { throw new Error(MARKERS[0]); } });
  writer.schedule(CASE); await writer.flush(); // Does not reject or leak an error.
});

test("a failed checker is counted once with its failure code and tokens from the other calls", async (t) => {
  const f = await fixture(t, { checkerFailure: true });
  await f.run();
  const log = runnerLogFromRecord(await f.store.load(CASE));
  assert.equal(log.turns[0].workers.length, 4);
  assert.equal(log.turns[0].workers.at(-1).role, "CW");
  assert.equal(log.turns[0].workers.at(-1).failure_code, "REFUSED");
  assert.equal(log.turns[0].tokens.input_tokens, 30);
  assert.equal(log.turns[0].outcome.reason_code, "refused");
  assert.deepEqual(log.summary.failures_by_code, [{ code: "REFUSED", count: 1 }]);
  assert.deepEqual(log.turns[0].failures, ["REFUSED"]);
});

for (const [option, code, stage, role] of [["unchangedRepair", "REPAIR_UNCHANGED", "repair", "W-repair"], ["incompleteChecklist", "PROVIDER_MALFORMED", "audit", "CW"]]) {
  test(`${code} after a successful ${role} is retained and counted in API and JSONL`, async (t) => {
    const f = await fixture(t, { [option]: true });
    await f.run();
    const record = await f.store.load(CASE);
    const failed = record.runtime_turns[0].events.find((event) => event.event_type === "INVOCATION_FAILED");
    assert.equal(failed.stage, stage);
    assert.equal(failed.details.error_code, code);
    const response = await fetch(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers: { origin: f.base } });
    assert.equal(response.status, 200);
    const log = await response.json();
    assert.equal(log.turns[0].outcome.status, "closed");
    assert.equal(log.turns[0].workers.at(-1).role, role);
    assert.ok(log.turns[0].workers.every((worker) => worker.failure_code === null));
    assert.deepEqual(log.turns[0].failures, [code]);
    assert.deepEqual(log.summary.failures_by_code, [{ code, count: 1 }]);
    await f.trial.logWriter.flush();
    const rows = (await fs.readFile(path.join(f.dir, "runner-log.jsonl"), "utf8")).trimEnd().split("\n").map(JSON.parse);
    assert.deepEqual(rows[1], log.turns[0]);
    for (const marker of MARKERS) assert.equal(JSON.stringify([log, rows]).includes(marker), false);
  });
}

test("a retried worker keeps both attempts and counts the timeout once", async (t) => {
  const f = await fixture(t, { retryWriter: true });
  await f.run();
  const log = runnerLogFromRecord(await f.store.load(CASE));
  const calls = log.turns[0].workers.filter((call) => call.role === "W");
  assert.deepEqual(calls.map((call) => call.attempt), [1, 2]);
  assert.deepEqual(calls.map((call) => call.failure_code), ["TIMEOUT", null]);
  assert.ok(calls.every((call) => call.provider === "stand-in" && call.effort === "low"));
  assert.equal(log.turns[0].duration_ms, 700);
  assert.equal(log.turns[0].workers.length, 7);
  assert.equal(log.turns[0].tokens.input_tokens, 60);
  assert.deepEqual(log.summary.failures_by_code, [{ code: "TIMEOUT", count: 1 }]);
});

test("old writer rule-part names and the fixed Codex default model label are kept without guessing byte sizes", () => {
  const log = runnerLogFromRecord({ runtime_turns: [{ state: "DELIVERED", created_at: new Date(at).toISOString(), delivery: { delivered_at: new Date(at + 10).toISOString() }, events: [{ event_type: "INVOCATION_COMPLETED", stage: "candidate", details: { output: { result: { receipts: [{ role: "W", attempt: 1, provider: "openai", model: "codex default", input_tokens: 10 }], rules: { parts: [{ id: "whole", sha256: MARKERS[0], prose: MARKERS[1] }] } } } } }] }] });
  assert.equal(log.turns[0].workers[0].model, "codex default");
  assert.deepEqual(log.turns[0].workers[0].rule_parts, [{ name: "whole", bytes: null }]);
  assert.equal(log.turns[0].workers[0].duration_ms, null);
  for (const marker of MARKERS) assert.equal(JSON.stringify(log).includes(marker), false);
});

test("statistics use ordinary median and nearest-rank p90 and never export invented finding codes or prose", () => {
  const record = { runtime_turns: [100, 200, 300, 400].map((duration, i) => ({ state: "UNANSWERED", created_at: new Date(at).toISOString(), closure: { closed_at: new Date(at + duration).toISOString(), kind: MARKERS[1], reason_code: MARKERS[1], exact_text: MARKERS[1] }, events: [{ event_type: "INVOCATION_COMPLETED", stage: "audit", details: { output: { value: { findings: [{ code: "PRIVATEMARKER_PROSE", severity: "high", summary: MARKERS[3] }] } } } }], repair_cycle: i })) };
  const log = runnerLogFromRecord(record);
  assert.deepEqual(log.summary.total_time_ms, { count: 4, median: 250, p90: 400 });
  assert.equal(log.summary.repairs_per_turn, 1.5);
  assert.deepEqual(log.summary.finding_codes, [{ code: "UNSPECIFIED_FINDING", count: 4 }]);
  assert.equal(JSON.stringify(log).includes("PRIVATEMARKER"), false);
});

function logTurn(index) {
  return { state: "DELIVERED", created_at: new Date(at + index * 1000).toISOString(), delivery: { delivered_at: new Date(at + index * 1000 + 100).toISOString() }, events: [] };
}
function logOptions(directory, record) {
  return { directory, runnerRules: { version: "0.2.6", sha256: "a".repeat(64), source: "stable 123456789" }, arrangement: { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] }, loadRecord: async () => record };
}
async function syncLog(writer) { writer.schedule(CASE); await writer.flush(); }

test("rebuilding after a restart keeps each stored configuration and leaves legacy turns unknown", async (t) => {
  const f = await fixture(t);
  await f.run();
  const original = (await f.store.load(CASE)).runtime_turns[0];
  const originalHealth = await (await fetch(`${f.base}/health`)).json();
  assert.deepEqual(original.runner_config, { rules: originalHealth.runnerRules, arrangement: originalHealth.runnerArrangement });
  // A pre-change turn has no configuration field, even when reconciled by a configured runtime.
  await f.store.beginPrivateRuntimeTurn(CASE, { runtimeTurnId: "legacy-turn", exchangeId: "legacy-exchange", userTurnId: "legacy-user", exactText: MARKERS[0] });
  await f.trial.controller.reconcile({ caseId: CASE });
  await f.trial.logWriter.flush();
  const file = path.join(f.dir, "runner-log.jsonl");
  await fs.unlink(file);
  const released = await prepareReleasedRules(f.dir, { git: async (args, options) => {
    if (args[0] === "fetch") throw new Error("offline stand-in");
    return exec("git", args, options);
  } });
  const config = configFor(f.dir, { runnerRulesRoot: released.rulesRoot });
  const settings = validateRunnerTrialSettings({ writerMode: "focused", checkerMode: "split" });
  const restarted = createRunnerTrialController({ privateCaseSource: f.store, config, settings, workerFor: () => { throw new Error("recovery must not call workers"); } });
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: f.store, privateTherapyController: restarted.controller, runnerTrialEvents: restarted.events, runnerTrialSettings: restarted.settings });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(`${base}/health`)).json();
  assert.notDeepEqual(health.runnerRules, original.runner_config.rules);
  assert.notDeepEqual(health.runnerArrangement, original.runner_config.arrangement);
  restarted.controller.startRunLog(null);
  await restarted.logWriter.flush();
  const rows = (await fs.readFile(file, "utf8")).trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(rows[0].runnerRules, health.runnerRules);
  assert.deepEqual(rows[0].arrangement, health.runnerArrangement);
  assert.deepEqual(rows[1].rules, original.runner_config.rules);
  assert.deepEqual(rows[1].arrangement, original.runner_config.arrangement);
  assert.equal(rows[2].rules, null);
  assert.equal(rows[2].arrangement, null);
  const log = await (await fetch(`${base}/v1/runner/log?caseId=${CASE}`, { headers: { origin: base } })).json();
  assert.deepEqual(rows.slice(1), log.turns);
  // Retrying a stored turn under different settings never rewrites its original configuration.
  await f.store.beginPrivateRuntimeTurn(CASE, { runtimeTurnId: original.id, exchangeId: original.exchange_id, userTurnId: original.user_turn_id, exactText: original.inbound.exact_text, runnerConfig: { rules: health.runnerRules, arrangement: health.runnerArrangement } });
  assert.deepEqual((await f.store.load(CASE)).runtime_turns[0].runner_config, original.runner_config);
});

test("runner configuration is optional for old turns, cloned on creation and narrowly validated", () => {
  const input = { id: "test-turn", exchangeId: "test-exchange", userTurnId: "test-user", exactText: MARKERS[0], createdAt: new Date(at).toISOString() };
  assert.equal(Object.hasOwn(createPrivateRuntimeTurn(input), "runner_config"), false);
  const options = logOptions(null, null);
  const runnerConfig = { rules: options.runnerRules, arrangement: options.arrangement };
  const turn = createPrivateRuntimeTurn({ ...input, runnerConfig });
  runnerConfig.arrangement.writer.push("claude");
  assert.deepEqual(turn.runner_config.arrangement.writer, ["codex"]);
  for (const invalid of [null, { ...turn.runner_config, extra: MARKERS[0] }, { ...turn.runner_config, rules: { ...turn.runner_config.rules, sha256: MARKERS[0] } }, { ...turn.runner_config, arrangement: { ...turn.runner_config.arrangement, writer: "claude" } }]) {
    assert.throws(() => validatePrivateRuntimeTurn({ ...turn, runner_config: invalid }), { code: "VALIDATION_ERROR" });
  }
});

test("turn configuration uses the header's allow-list and failure deduplication stays within an invocation", async (t) => {
  const dir = await directory(t);
  const prose = `private words ${MARKERS[0]}`;
  const config = { rules: { version: prose, sha256: prose, source: prose, extra: MARKERS[0] }, arrangement: { writerMode: prose, checkerMode: prose, readers: ["claude", prose], writer: [prose], checkers: ["codex"], extra: MARKERS[0] } };
  const turn = { ...logTurn(0), runner_config: config, events: [
    { event_type: "INVOCATION_COMPLETED", stage: "candidate", details: { output: { result: { receipts: [{ role: "W", failed: "TIMEOUT" }] } } } },
    { event_type: "INVOCATION_FAILED", details: { error_code: "TIMEOUT" } },
    { event_type: "INVOCATION_FAILED", details: { error_code: prose, raw_private_evidence: { receipts: [{ role: "CW", failed: prose }] } } },
    { event_type: "INVOCATION_FAILED", details: {} }
  ] };
  const record = { runtime_turns: [turn] };
  const log = runnerLogFromRecord(record);
  assert.deepEqual(log.turns[0].failures, ["TIMEOUT", "PROVIDER_FAILED", "PROVIDER_FAILED"]);
  assert.deepEqual(log.summary.failures_by_code, [{ code: "PROVIDER_FAILED", count: 2 }, { code: "TIMEOUT", count: 2 }]);
  await syncLog(createRunnerLogWriter({ directory: dir, runnerRules: config.rules, arrangement: config.arrangement, loadRecord: async () => record }));
  const jsonl = await fs.readFile(path.join(dir, "runner-log.jsonl"), "utf8");
  const [header, row] = jsonl.trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(row.rules, header.runnerRules);
  assert.deepEqual(row.arrangement, header.arrangement);
  assert.deepEqual(row.rules, { version: null, sha256: null, source: "checkout" });
  assert.deepEqual(row.arrangement, { writerMode: null, checkerMode: null, readers: ["claude"], writer: [], checkers: ["codex"] });
  assert.equal(JSON.stringify(log).includes(MARKERS[0]), false);
  assert.equal(jsonl.includes(MARKERS[0]), false);
});

for (const changed of ["rules", "arrangement"]) test(`a restart with changed ${changed} appends a header before the next turn`, async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, "runner-log.jsonl");
  const record = { runtime_turns: [logTurn(0)] };
  const options = logOptions(dir, record);
  await syncLog(createRunnerLogWriter(options));
  const original = await fs.readFile(file, "utf8");
  const next = changed === "rules" ? { ...options, runnerRules: { version: "0.2.7", sha256: "b".repeat(64), source: "stable 987654321" } }
    : { ...options, arrangement: { ...options.arrangement, writer: ["claude"] } };
  const restarted = createRunnerLogWriter(next);
  await syncLog(restarted); // Startup may run before another turn closes.
  record.runtime_turns.push(logTurn(1));
  await syncLog(restarted);
  const updated = await fs.readFile(file, "utf8");
  assert.ok(updated.startsWith(original), "earlier lines remain byte-for-byte unchanged");
  const rows = updated.trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((row) => row.type ?? row.turn), ["header", 1, "header", 2]);
  assert.deepEqual(rows[2].runnerRules, next.runnerRules);
  assert.deepEqual(rows[2].arrangement, next.arrangement);
  await syncLog(createRunnerLogWriter(next));
  assert.equal(await fs.readFile(file, "utf8"), updated, "an unchanged restart duplicates neither headers nor turns");
  record.runtime_turns.push(logTurn(2));
  await syncLog(createRunnerLogWriter(options));
  const reverted = (await fs.readFile(file, "utf8")).trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(reverted.map((row) => row.type ?? row.turn), ["header", 1, "header", 2, "header", 3]);
  assert.deepEqual(reverted[4], rows[0], "compare the last header, even when an earlier one matches");
});

test("header equality compares parsed objects rather than JSON key order or whitespace", async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, "runner-log.jsonl");
  const record = { runtime_turns: [logTurn(0)] };
  const options = logOptions(dir, record);
  await syncLog(createRunnerLogWriter(options));
  const [header, turn] = (await fs.readFile(file, "utf8")).trimEnd().split("\n").map(JSON.parse);
  const reordered = { arrangement: { checkers: header.arrangement.checkers, writer: header.arrangement.writer, readers: header.arrangement.readers, checkerMode: header.arrangement.checkerMode, writerMode: header.arrangement.writerMode }, runnerRules: { source: header.runnerRules.source, sha256: header.runnerRules.sha256, version: header.runnerRules.version }, type: header.type, schema_version: header.schema_version };
  const prefix = ` ${JSON.stringify(reordered)} \n${JSON.stringify(turn)}\n`;
  await fs.writeFile(file, prefix);
  record.runtime_turns.push(logTurn(1));
  await syncLog(createRunnerLogWriter(options));
  const updated = await fs.readFile(file, "utf8");
  assert.ok(updated.startsWith(prefix));
  assert.deepEqual(updated.trimEnd().split("\n").map(JSON.parse).map((row) => row.type ?? row.turn), ["header", 1, 2]);
});

for (const interrupted of ["initial header", "later header", "turn"]) test(`an interrupted ${interrupted} is truncated before appending valid JSONL`, async (t) => {
  const dir = await directory(t);
  const file = path.join(dir, "runner-log.jsonl");
  const record = { runtime_turns: [logTurn(0)] };
  const options = logOptions(dir, record);
  await syncLog(createRunnerLogWriter(options));
  const original = await fs.readFile(file, "utf8");
  const header = JSON.parse(original.split("\n")[0]);
  record.runtime_turns.push(logTurn(1));
  const next = interrupted === "later header" ? { ...options, runnerRules: { ...options.runnerRules, version: "0.2.7" } } : options;
  const brokenRow = interrupted === "turn" ? runnerLogFromRecord(record).turns[1] : { ...header, runnerRules: next.runnerRules };
  const prefix = interrupted === "initial header" ? "" : original;
  const serialized = JSON.stringify(brokenRow);
  await fs.writeFile(file, prefix + serialized.slice(0, Math.floor(serialized.length / 2)));
  await syncLog(createRunnerLogWriter(next));
  const updated = await fs.readFile(file, "utf8");
  assert.ok(updated.startsWith(prefix), "complete lines must not be rewritten");
  assert.ok(updated.endsWith("\n"));
  const rows = updated.trimEnd().split("\n").map(JSON.parse);
  assert.deepEqual(rows.filter((row) => row.type !== "header").map((row) => row.turn), [1, 2]);
  assert.deepEqual(rows.filter((row) => row.type === "header").at(-1).runnerRules, next.runnerRules);
  assert.equal(rows.length, interrupted === "later header" ? 4 : 3);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test("log recovery refuses a symlink without reading, truncating or appending its target", async (t) => {
  const dir = await directory(t);
  const target = path.join(await directory(t), "target");
  const original = '{"incomplete":';
  await fs.writeFile(target, original, { mode: 0o640 });
  const mode = (await fs.stat(target)).mode;
  await fs.symlink(target, path.join(dir, "runner-log.jsonl"));
  await syncLog(createRunnerLogWriter(logOptions(dir, { runtime_turns: [logTurn(0)] })));
  assert.equal(await fs.readFile(target, "utf8"), original);
  assert.equal((await fs.stat(target)).mode, mode);
  assert.equal((await fs.lstat(path.join(dir, "runner-log.jsonl"))).isSymbolicLink(), true);
});

test("the log route has the runner page's origin, host, bearer, same-site and case authorization checks, and is absent with the trial off", async (t) => {
  const f = await fixture(t);
  for (const headers of [{}, { origin: "http://elsewhere.invalid" }, { origin: f.base, authorization: "Bearer unused" }, { origin: f.base, "sec-fetch-site": "cross-site" }, { origin: f.base, host: "elsewhere.invalid" }]) {
    const status = await new Promise((resolve, reject) => {
      const request = http.get(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers }, (response) => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  assert.equal((await fetch(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers: { referer: `${f.base}/`, "sec-fetch-site": "same-origin" } })).status, 200, "a browser GET proves its origin with Referer and Sec-Fetch-Site");
  assert.equal((await fetch(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers: { referer: "http://elsewhere.invalid/", "sec-fetch-site": "same-origin" } })).status, 403);
  const access = createPrivateCaseAccessService({ rootDir: path.join(f.dir, "denied-vault"), authorizationProvider: { async authorize() { return { allowed: false }; } }, keyProvider: { async getCaseKeyMaterial() { throw new Error("must not open"); } } });
  const config = configFor(f.dir);
  const trial = createRunnerTrialController({ privateCaseSource: access, config });
  await assert.rejects(trial.controller.runLog({ caseId: CASE }), { code: "PRIVATE_CASE_ACCESS_DENIED" });
  const off = configFor(f.dir, { runnerTrialEnabled: false, runnerRulesRoot: "/missing/invalid" });
  const server = createInnerSignalServer({ config: off, providers: createProviders(off), privateCaseStore: f.store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/v1/runner/log?caseId=${CASE}`, { headers: { origin: base } })).status, 404);
  assert.equal(Object.hasOwn(await (await fetch(`${base}/health`)).json(), "runnerRules"), false);
});

test("rules extraction uses one quiet fetch, a local stable snapshot after fetch failure, and checkout fallback only without a ref", async (t) => {
  const dir = await directory(t);
  const calls = [];
  const released = await prepareReleasedRules(dir, { git: async (args, options) => {
    calls.push(args);
    if (args[0] === "fetch") throw new Error("offline");
    return exec("git", args, options);
  } });
  assert.deepEqual(calls[0], ["fetch", "--quiet", "origin", "stable"]);
  assert.equal(calls.filter((args) => args[0] === "fetch").length, 1);
  const config = configFor(dir, { runnerRulesRoot: released.rulesRoot });
  const rules = loadRunnerRules(config).runnerRules;
  assert.equal(rules.version, "0.2.6");
  assert.equal(rules.sha256, "2126edaf1c4045939dd5b3fefa397dc81871debea2d7d6f30601f58e8053fd07");
  assert.match(rules.source, /^stable [a-f0-9]{9}$/u);
  assert.equal((await fs.stat(path.dirname(path.dirname(path.dirname(released.rulesRoot))))).mode & 0o777, 0o700);
  const offlineGit = async (args, options) => { if (args[0] === "fetch") throw new Error("offline"); return exec("git", args, options); };
  const before = await fs.realpath(released.rulesRoot);
  await prepareReleasedRules(dir, { git: offlineGit });
  assert.notEqual(await fs.realpath(released.rulesRoot), before);
  assert.deepEqual(loadRunnerRules(config).runnerRules, rules);
  await assert.rejects(prepareReleasedRules(dir, { git: async (args, options) => { if (args[0] === "archive") throw new Error("extract failed"); return offlineGit(args, options); } }));
  assert.deepEqual(loadRunnerRules(config).runnerRules, rules);
  const outside = await directory(t);
  for (const root of [outside, dir, "relative", path.join(dir, "missing")]) assert.throws(() => loadRunnerRules(configFor(dir, { runnerRulesRoot: root })), { code: "BAD_CONFIG" });
  await fs.symlink(outside, path.join(dir, "escape"));
  assert.throws(() => loadRunnerRules(configFor(dir, { runnerRulesRoot: path.join(dir, "escape") })), { code: "BAD_CONFIG" });
  assert.deepEqual(await prepareReleasedRules(dir, { git: async () => { throw new Error("no ref"); } }), { rulesRoot: null, source: "checkout" });
  const env = serverEnvironment({ provider: "codex", port: 1234, credentialsPath: "/tmp/credentials", settingsPath: path.join(dir, "settings.json"), token: "synthetic", caseId: CASE, rulesRoot: released.rulesRoot });
  assert.equal(env.INNER_SIGNAL_RUNNER_RULES_ROOT, released.rulesRoot);
  assert.equal(env.INNER_SIGNAL_RUNNER_TRIAL_DIR, dir);
  // Validate health through the server path, including a controller supplied by a caller.
  const f = await fixture(t, { dir });
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: f.store, privateTherapyController: f.trial.controller, runnerTrialEvents: f.trial.events });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const health = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
  assert.deepEqual(health.runnerRules, rules);
  assert.throws(() => createRunnerTrialController({ privateCaseSource: f.store, config: configFor(dir, { runnerRulesRoot: outside }) }), { code: "BAD_CONFIG" });
});

for (const kind of ["directory", "file"]) test(`rules loading refuses a nested ${kind} symlink`, async (t) => {
  const dir = await directory(t);
  const outside = await directory(t);
  const root = path.join(dir, "rules");
  await fs.cp(new URL("../plugins/inner-signal-therapy/", import.meta.url), root, { recursive: true });
  const config = configFor(dir, { runnerRulesRoot: root });
  assert.equal(loadRunnerRules(config).runnerRules.source, "checkout");
  const entry = kind === "directory" ? path.join(root, "skills") : path.join(root, "skills", "inner-signal-therapy", "SKILL.md");
  const target = path.join(outside, "external");
  await fs.rename(entry, target);
  await fs.symlink(target, entry);
  assert.throws(() => loadRunnerRules(config), { code: "BAD_CONFIG" });
  await fs.unlink(entry);
  await fs.rename(target, entry);
  // Even an unused nested link whose target stays inside the trial folder is refused.
  const internalTarget = kind === "directory" ? path.join(root, "skills") : path.join(root, ".codex-plugin", "plugin.json");
  await fs.symlink(internalTarget, path.join(root, ".codex-plugin", "unused-link"));
  assert.throws(() => loadRunnerRules(config), { code: "BAD_CONFIG" });
});

for (const kind of ["directory", "file"]) test(`released-rules extraction refuses a nested ${kind} symlink before publication`, async (t) => {
  const dir = await directory(t);
  const source = await directory(t);
  const root = path.join(source, "plugins", "inner-signal-therapy");
  await fs.mkdir(path.join(root, "nested"), { recursive: true });
  const outside = await directory(t);
  const target = kind === "directory" ? outside : path.join(outside, "external-file");
  if (kind === "file") await fs.writeFile(target, "outside rules");
  await fs.symlink(target, path.join(root, "nested", "link"));
  await assert.rejects(prepareReleasedRules(dir, { git: async (args) => {
    if (args[0] === "fetch") throw new Error("offline");
    if (args[0] === "rev-parse") return { stdout: "a".repeat(40) };
    assert.equal(args[0], "archive");
    const archive = args.find((arg) => arg.startsWith("--output=")).slice("--output=".length);
    return exec("tar", ["-cf", archive, "-C", source, "plugins/inner-signal-therapy"]);
  } }), /extracted released-rules tree must not contain symlinks/u);
  assert.deepEqual(await fs.readdir(path.join(dir, "released-rules")), [], "no snapshot or commit pointer was published");
  if (kind === "file") assert.equal(await fs.readFile(target, "utf8"), "outside rules");
});

test("the page's version, tabs, calm note and Run log are trial-only; State & tracker stays available", async (t) => {
  const p = await page(t);
  const start = p.app.indexOf("const runnerTrial = {");
  const end = p.app.indexOf("// The trial page's link to InnerSignal's feedback page", start);
  vm.runInContext(p.app.slice(start, end), p.context);
  const health = { version: "0.15.2", runnerTrial: "off", localRepair: { jobId: "123456789" } };
  p.context.health = health;
  assert.equal(vm.runInContext("runnerVersionText(health)", p.context), "Inner Signal runtime v0.15.2 · local repair 12345678");
  vm.runInContext("applyRunnerTrial(false)", p.context);
  assert.ok([...p.document.querySelectorAll(".tab")].every((tab) => !tab.hidden));
  for (const id of ["#runner-run-log", "#runner-emergency-line", "#runner-tabs-note"]) assert.equal(p.document.querySelector(id).hidden, true);
  p.context.health = { version: "0.15.2", runnerTrial: "on", runnerRules: { version: "0.2.6", sha256: "2126edaf1234", source: "stable 123456789" } };
  assert.equal(vm.runInContext("runnerVersionText(health)", p.context), "InnerSignal runner trial · rules 0.2.6 (2126edaf) · page v0.15.2");
  p.context.health.runnerRules.source = "checkout";
  assert.match(vm.runInContext("runnerVersionText(health)", p.context), / · rules from this checkout, not the release$/u);
  vm.runInContext("applyRunnerTrial(true)", p.context);
  for (const id of ["hypnosis", "guides", "supervisor", "data"]) assert.equal(p.document.querySelector(`[data-tab="${id}"]`).hidden, true);
  assert.equal(p.document.querySelector('[data-tab="case-state"]').hidden, false);
  const line = p.document.querySelector("#runner-emergency-line");
  assert.equal(line.hidden, false); assert.equal(line.getAttribute("role"), "note");
  assert.ok(p.document.querySelector("#therapy-send").compareDocumentPosition(line) & p.document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(p.document.querySelector("#runner-run-log").hidden, false);
  const css = await fs.readFile(new URL("../apps/web/styles.css", import.meta.url), "utf8");
  const style = /\.runner-emergency-line \{([^}]+)\}/u.exec(css)[1];
  for (const expected of ["color: var(--muted)", "font-weight: 400", "border: 0", "background: none"]) assert.ok(style.includes(expected));
});
