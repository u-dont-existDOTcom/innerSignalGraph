import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { Readable } from "node:stream";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createRunnerTrialController } from "../src/runner-trial/trial-controller.mjs";
import { runnerTurnDetailsFromRecord } from "../src/runner-trial/turn-details.mjs";
import { validateRunnerTrialSettings } from "../src/runner-trial/settings.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";

const CASE = "case-00000000-0000-4000-8000-000000000000";
const M = {
  person: "Persondetailsmarker\nSecond line", crisis: "Crisisdetailsmarker", protection: "Protectiondetailsmarker",
  provisional: "Provisionaldetailsmarker", draft1: "Draftonedetailsmarker", draft2: "Drafttwodetailsmarker",
  finding: "Findingdetailsmarker", quote: "Quotedetailsmarker", repair: "Repairrequestdetailsmarker",
  html: "<img src=x onerror=alert(1)>", link: "https://example.invalid/details"
};
const configFor = (dir, extra = {}) => loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false, runnerTrialEnabled: true, runnerTrialDir: dir, runnerTrialCaseId: CASE, runnerTrialSettingsPath: null, runnerRulesRoot: null, ...extra });
// Exercise the real HTTP request listener without sockets, including in a network-disabled sandbox.
function transport(server) {
  const base = "http://127.0.0.1:19001";
  const request = (address, { method = "GET", headers = {} } = {}) => new Promise((resolve, reject) => {
    const url = new URL(address);
    const req = Readable.from([]);
    req.method = method;
    req.url = url.pathname + url.search;
    req.headers = { host: url.host, ...headers };
    const res = {
      headersSent: false, writableEnded: false,
      writeHead(status, fields) { this.status = status; this.fields = fields; this.headersSent = true; },
      end(body = "") { this.writableEnded = true; resolve(new Response(body, { status: this.status, headers: this.fields })); }
    };
    Promise.resolve(server.listeners("request")[0](req, res)).catch(reject);
  });
  return { base, request };
}
async function fixture(t, { closed = false, refusedProvisional = false, split = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-details-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let clock = Date.parse("2026-11-23T12:00:00.000Z");
  const store = createEncryptedPrivateCaseStore({ rootDir: path.join(dir, "vault"), routineKek: Buffer.alloc(32, 81), recoverySecretBytes: Buffer.alloc(32, 82), developmentExternalCredentialAuthorized: true, now: () => new Date(clock).toISOString() });
  t.after(() => store.close());
  await store.loadOrCreate(CASE);
  let session = 0;
  let checks = 0;
  const requests = [];
  const config = configFor(dir, { ownerFallbackEnabled: closed });
  const settings = validateRunnerTrialSettings({ writerMode: "whole", checkerMode: split ? "split" : "whole" });
  const trial = createRunnerTrialController({ privateCaseSource: store, config, settings, now: () => clock,
    workerFor: (role) => ({ async call(request) {
      requests.push({ role, ...request });
      clock += 100;
      let value;
      if (role === "R1") value = { level: "acted_or_about_to", wish_or_intent: "intent", pain_linked: false, danger_to_others: false, in_danger_from_someone: false, asking_about_someone_else: false, may_be_under_18: false, home_unsafe: false, reason: M.crisis, provisional_reply: refusedProvisional ? M.provisional : `Call 112 now. ${M.provisional}` };
      else if (role === "R3") value = { compatibility_assessment: {
        version: 1, issue: M.protection, assessment_basis: "CURRENT_TURN", subject_context: "current_client",
        harm_intent: "not_supported", harm_intent_observation_ids: [], help_goal: "unclear", help_goal_text: M.protection,
        help_goal_observation_ids: [], nonharm_choice: "unknown", nonharm_choice_observation_ids: [],
        identity_inquiry_consent: "unknown", identity_inquiry_observation_ids: [], agreed_next_job: "unknown", agreed_next_job_observation_ids: [],
        prior_restriction: "none", prior_restriction_observation_ids: [], correction_observation_ids: [], reentry_status: "not_required", reentry_observation_ids: [], human_review_required: false
      } };
      else if (["W", "W-repair"].includes(role)) {
        if (role === "W-repair") assert.ok(request.user.includes(M.repair), "repair receives the stored blocking finding");
        value = { reply: role === "W" ? `${M.draft1} ${M.html}\n${M.link} detox` : M.draft2, answered_level: "acted_or_about_to", quotes: [] };
      } else {
        const first = role === (split ? "C1" : "CW") && checks++ === 0;
        value = { findings: first || closed ? [{ code: "QUOTE_NOT_EXACT", severity: "high", summary: `${M.finding}: ${M.quote}. ${M.repair}`, quote: "Discardedquote-onlymarker", evidence_turn_ids: [M.quote] }] : [], level: "acted_or_about_to", missed_boxes: [], repair_induced_checks: request.user.includes(M.draft2) || closed ? [...REPAIR_INDUCED_ERROR_CHECKS] : [] };
      }
      return { value, receipt: { provider: role.startsWith("W") ? "openai" : "anthropic", model: "stand-in-model", effort: "low", session_id: `synthetic-${++session}`, unrelated_secret: "Nevercopyreceiptmarker" } };
    } })
  });
  const { base, request } = transport(createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: trial.controller, runnerTrialEvents: trial.events, runnerTrialSettings: trial.settings }));
  const run = () => trial.controller.run({ caseId: CASE, runtimeTurnId: "synthetic-details-turn", exchangeId: "synthetic-details-exchange", userTurnId: "synthetic-details-user", assistantTurnId: "synthetic-details-assistant", userMessage: M.person });
  const details = () => request(`${base}/v1/runner/turn-details?caseId=${CASE}&turn=1`, { headers: { origin: base } });
  return { dir, store, trial, config, base, request, run, details, requests };
}
async function page(t) {
  const app = await fs.readFile(new URL("../apps/web/app.js", import.meta.url), "utf8");
  const dom = new JSDOM(await fs.readFile(new URL("../apps/web/index.html", import.meta.url), "utf8"), { url: "http://127.0.0.1/" });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const context = vm.createContext({ document, $: (selector) => document.querySelector(selector) });
  vm.runInContext(app.slice(app.indexOf("// runner-trial-page:start"), app.indexOf("// runner-trial-page:end")), context);
  return { app, document, context, root: document.querySelector("#runner-details-panel"), log: document.querySelector("#runner-log-panel"), window: dom.window };
}
const step = (details, kind, draft) => details.steps.find((entry) => entry.kind === kind && (draft == null || entry.draft === draft));

test("stand-in repair details read the encrypted case without changing it; sections retain words and the log stays word-free", async (t) => {
  const f = await fixture(t);
  await f.run();
  await f.trial.logWriter.flush();
  const before = await f.store.load(CASE);
  const filesBefore = await fs.readdir(path.join(f.dir, "vault"), { recursive: true });
  const jsonl = await fs.readFile(path.join(f.dir, "runner-log.jsonl"), "utf8");
  const response = await f.details();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const details = await response.json();
  assert.equal(details.turn, 1);
  assert.equal(details.runtime_turn_id, before.runtime_turns[0].id);
  assert.deepEqual(details.runner_config, before.runtime_turns[0].runner_config);
  const expected = [["message", null, M.person], ["reader", null, M.crisis], ["provisional", null, M.provisional], ["draft", 1, M.draft1], ["checker", 1, M.finding], ["checker", 1, M.quote], ["repair_request", 2, M.repair], ["draft", 2, M.draft2], ["delivery", null, M.draft2]];
  for (const [kind, draft, marker] of expected) assert.ok(JSON.stringify(step(details, kind, draft)).includes(JSON.stringify(marker).slice(1, -1)), `${kind}: ${marker}`);
  assert.ok(JSON.stringify(details.steps.find((entry) => entry.label === "Protection reader")).includes(M.protection));
  assert.deepEqual(step(details, "draft", 1).workers.map((call) => [call.role, call.provider, call.model, call.attempt]), [["W", "openai", "stand-in-model", 1]]);
  for (const entry of details.steps.filter((entry) => ["draft", "checker"].includes(entry.kind))) for (const call of entry.workers) {
    assert.equal(typeof call.duration_ms, "number");
    assert.ok(call.rule_parts.length);
    assert.ok(call.rule_parts.every((part) => part.name && part.bytes > 0));
  }
  assert.equal(JSON.stringify(details).includes("Nevercopyreceiptmarker"), false);
  assert.equal(JSON.stringify(details).includes("Discardedquote-onlymarker"), false, "the runtime discarded this quote; the view must not invent it");
  assert.equal(step(details, "repair_request", 2).content.prompt, "not stored");
  assert.ok(step(details, "program_checks", 1).content.findings.some((finding) => finding.code === "PROGRAM_DETOX_WORD" && finding.summary.includes("detox")));
  assert.deepEqual(step(details, "program_checks", 2).content.findings, []);
  assert.ok(step(details, "checker", 1).missing.some((line) => line.includes("not stored")));
  assert.deepEqual(await f.store.load(CASE), before);
  assert.deepEqual(await fs.readdir(path.join(f.dir, "vault"), { recursive: true }), filesBefore);
  assert.equal(await fs.readFile(path.join(f.dir, "runner-log.jsonl"), "utf8"), jsonl);
  const log = await (await f.request(`${f.base}/v1/runner/log?caseId=${CASE}`, { headers: { origin: f.base } })).json();
  const p = await page(t);
  let opened = null;
  Object.assign(p.context, { root: p.root, logRoot: p.log, details, log, close: () => {}, openDetails: (button, turn) => { opened = { button, turn }; } });
  vm.runInContext("renderRunnerLog(logRoot, log, openDetails); renderRunnerTurnDetails(root, details, close)", p.context);
  p.log.querySelector("button").click();
  assert.equal(opened.turn, 1);
  assert.equal(opened.button.getAttribute("aria-controls"), "runner-details-panel");
  for (const [kind, draft, marker] of expected) {
    const section = p.root.querySelector(`section[data-kind="${kind}"]${draft ? `[data-draft="${draft}"]` : ""}`);
    assert.ok(section.textContent.includes(marker), `${kind}: ${marker}`);
  }
  assert.ok(p.root.textContent.includes(M.html));
  assert.ok(p.root.textContent.includes(M.link));
  assert.equal(p.root.querySelectorAll("img, a, script, iframe").length, 0);
  const css = await fs.readFile(new URL("../apps/web/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.runner-details-panel pre \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/u);
  for (const marker of Object.values(M)) for (const output of [JSON.stringify(log), jsonl, p.log.textContent]) assert.equal(output.includes(marker), false, marker);
  assert.deepEqual(details.steps.filter((entry) => ["draft", "checker", "program_checks", "repair_request", "delivery"].includes(entry.kind)).map((entry) => [entry.kind, entry.draft ?? null]), [["draft", 1], ["checker", 1], ["program_checks", 1], ["repair_request", 2], ["draft", 2], ["checker", 2], ["program_checks", 2], ["delivery", null]]);
});

test("a closed turn includes the exact fixed message, closing kind and reason", async (t) => {
  const f = await fixture(t, { closed: true });
  await f.run();
  const details = await (await f.details()).json();
  const closure = step(details, "closure");
  assert.equal(closure.content.kind, "owner_fallback");
  assert.equal(closure.content.reason_code, "checks_failed");
  assert.equal(closure.content.exact_text, OWNER_FALLBACK_MESSAGE);
  const p = await page(t);
  Object.assign(p.context, { root: p.root, details });
  vm.runInContext("renderRunnerTurnDetails(root, details, () => {})", p.context);
  assert.ok(p.root.textContent.includes(OWNER_FALLBACK_MESSAGE));
});

test("refused provisional problems, emergency reason and per-draft program problems are shown", async (t) => {
  const f = await fixture(t, { refusedProvisional: true });
  await f.run();
  const details = await (await f.details()).json();
  assert.ok(step(details, "provisional_refused").content.problems.length);
  assert.equal(step(details, "emergency_line").content.reason_code, "provisional_not_shown");
  assert.equal(step(details, "emergency_line").content.exact_text, "not stored");
  assert.equal(step(details, "provisional"), undefined);
});

test("split checker findings and metadata remain grouped by checker and draft", async (t) => {
  const f = await fixture(t, { split: true });
  await f.run();
  const details = await (await f.details()).json();
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "checker" && entry.draft === 1).map((entry) => entry.workers[0].role), ["C1", "C2", "C3", "C4"]);
  assert.ok(step(details, "checker", 1).content.findings[0].summary.includes(M.finding));
  assert.ok(details.steps.some((entry) => entry.kind === "checker" && entry.draft === 2 && entry.workers[0].role === "C5"));
});

test("the details route enforces page origin, host, bearer and fetch markers", async (t) => {
  const f = await fixture(t);
  for (const headers of [{}, { origin: "http://elsewhere.invalid" }, { origin: f.base, authorization: "Bearer unused" }, { origin: f.base, "sec-fetch-site": "cross-site" }, { origin: f.base, host: "elsewhere.invalid" }, { referer: `${f.base}/` }, { "sec-fetch-site": "same-origin" }, { referer: "http://elsewhere.invalid/", "sec-fetch-site": "same-origin" }]) {
    const status = (await f.request(`${f.base}/v1/runner/turn-details?caseId=${CASE}&turn=1`, { headers })).status;
    assert.equal(status, 403, JSON.stringify(headers));
  }
  await f.run();
  assert.equal((await f.request(`${f.base}/v1/runner/turn-details?caseId=${CASE}&turn=1`, { headers: { referer: `${f.base}/`, "sec-fetch-site": "same-origin" } })).status, 200);
  assert.equal((await f.request(`${f.base}/v1/runner/turn-details`, { method: "POST", headers: { origin: f.base } })).status, 404);
});

test("unknown and strictly malformed turn numbers return one fixed error with no case words or writes", async (t) => {
  const f = await fixture(t);
  await f.run();
  const before = await f.store.load(CASE);
  for (const query of ["", "&turn=", "&turn=0", "&turn=-1", "&turn=01", "&turn=1.0", "&turn=1e0", "&turn=+1", "&turn=9007199254740992", "&turn=2", "&turn=1&turn=2", "&turn=%3Cimg%3E"]) {
    const response = await f.request(`${f.base}/v1/runner/turn-details?caseId=${CASE}${query}`, { headers: { origin: f.base } });
    assert.equal(response.status, 404, query);
    assert.deepEqual(await response.json(), { error: "Turn details unavailable.", code: "RUNNER_TURN_NOT_FOUND" });
  }
  // A malformed, missing, empty or repeated case id gets the same fixed error (Codex's review 5).
  for (const query of ["?caseId=%3Cimg%3E&turn=1", "?turn=1", "?caseId=&turn=1", `?caseId=${CASE}&caseId=${CASE}&turn=1`, "?caseId=UPPER&turn=1"]) {
    const response = await f.request(`${f.base}/v1/runner/turn-details${query}`, { headers: { origin: f.base } });
    assert.equal(response.status, 404, query);
    assert.deepEqual(await response.json(), { error: "Turn details unavailable.", code: "RUNNER_TURN_NOT_FOUND" });
  }
  assert.deepEqual(await f.store.load(CASE), before);
});

test("case-read authorization is retained and an unknown case is never created", async (t) => {
  const f = await fixture(t);
  const denied = createPrivateCaseAccessService({ rootDir: path.join(f.dir, "denied"), authorizationProvider: { async authorize() { return { allowed: false }; } }, keyProvider: { async getCaseKeyMaterial() { throw new Error("must not open"); } } });
  const trial = createRunnerTrialController({ privateCaseSource: denied, config: f.config });
  const { base, request } = transport(createInnerSignalServer({ config: f.config, providers: createProviders(f.config), privateCaseAccessService: denied, privateTherapyController: trial.controller, runnerTrialEvents: trial.events }));
  const response = await request(`${base}/v1/runner/turn-details?caseId=${CASE}&turn=1`, { headers: { origin: base } });
  assert.equal(response.status, 403);
  const other = "case-11111111-1111-4111-8111-111111111111";
  assert.equal((await f.request(`${f.base}/v1/runner/turn-details?caseId=${other}&turn=1`, { headers: { origin: f.base } })).status, 404);
  assert.equal(await f.store.load(other), null);
  // The servers' run logs are written after they start; the test's folder goes only once they are.
  await Promise.all([f.trial.logWriter.flush(), trial.logWriter.flush()]);
});

test("trial-off route and page have no Run log or Details view", async (t) => {
  const f = await fixture(t);
  const config = configFor(f.dir, { runnerTrialEnabled: false });
  const { base, request } = transport(createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: f.store }));
  assert.equal((await (await request(`${base}/health`)).json()).runnerTrial, "off");
  assert.equal((await request(`${base}/v1/runner/turn-details?caseId=${CASE}&turn=1`, { headers: { origin: base } })).status, 404);
  const p = await page(t);
  const start = p.app.indexOf("const runnerTrial = {");
  vm.runInContext(p.app.slice(start, p.app.indexOf("// The trial page's link to InnerSignal's feedback page", start)), p.context);
  p.root.hidden = false; p.root.textContent = M.finding;
  vm.runInContext("applyRunnerTrial(false)", p.context);
  assert.equal(p.root.hidden, true);
  assert.equal(p.root.textContent, "");
  assert.equal(p.log.hidden, true);
  assert.equal(p.document.querySelector("#runner-run-log").hidden, true);
});

test("details buttons open only one view, close by keyboard and restore focus; stale requests cannot refill it", async (t) => {
  const p = await page(t);
  const pending = [];
  Object.assign(p.context, { panel: p.root, fetchDetails: (turn) => new Promise((resolve, reject) => pending.push({ turn, resolve, reject })), isCurrent: () => true });
  vm.runInContext("var view = createRunnerDetailsView({ panel, fetchDetails, isCurrent })", p.context);
  const button1 = p.document.createElement("button");
  const button2 = p.document.createElement("button");
  for (const button of [button1, button2]) { button.setAttribute("aria-controls", "runner-details-panel"); p.log.append(button); }
  p.log.hidden = false;
  Object.assign(p.context, { button1, button2 });
  const first = vm.runInContext("view.open(button1, 1)", p.context);
  assert.equal(p.document.activeElement, p.root);
  const second = vm.runInContext("view.open(button2, 2)", p.context);
  assert.equal(button1.getAttribute("aria-expanded"), "false");
  assert.equal(button2.getAttribute("aria-expanded"), "true");
  pending[0].resolve({ turn: 1, steps: [], runner_config: null }); await first;
  assert.equal(p.root.textContent.includes("Details for turn 1"), false);
  pending[1].resolve({ turn: 2, steps: [], runner_config: null }); await second;
  assert.ok(p.root.textContent.includes("Details for turn 2"));
  p.root.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(p.root.hidden, true);
  assert.equal(p.root.textContent, "");
  assert.equal(p.document.activeElement, button2);
  const third = vm.runInContext("view.open(button1, 1)", p.context);
  p.root.querySelector("button").click();
  pending[2].resolve({ turn: 1, steps: [], runner_config: null }); await third;
  assert.equal(p.root.hidden, true);
  const fourth = vm.runInContext("view.open(button1, 1)", p.context);
  pending[3].reject(new Error(M.person)); await fourth;
  assert.ok(p.root.textContent.includes("Details are unavailable right now."));
  assert.equal(p.root.textContent.includes(M.person), false);
  p.root.querySelector("button").click();
  assert.equal(p.root.hidden, true);
});

test("historical stored findings retain every field including quote; absent output and provenance say not stored", async (t) => {
  const finding = { id: "CW:1", code: "SYNTHETIC", severity: "high", summary: M.finding, quoted_span: M.html, description: M.quote, extra_stored_field: M.repair };
  const record = { runtime_turns: [{ id: "old", state: "UNANSWERED", inbound: { exact_text: M.person }, closure: { kind: "runner_unavailable", reason_code: "interrupted", exact_text: "Fixed stored notice" }, events: [{ event_type: "INVOCATION_COMPLETED", stage: "audit", details: { output: { value: { findings: [finding] }, providerReceipt: { receipts: [{ role: "CW" }] } } } }] }] };
  const before = JSON.stringify(record);
  const details = runnerTurnDetailsFromRecord(record, 1);
  assert.deepEqual(step(details, "checker").content.findings, [finding]);
  assert.equal(details.runner_config, null);
  assert.equal(step(details, "reader").content, null);
  assert.equal(step(details, "checker").workers[0].duration_ms, null);
  assert.equal(JSON.stringify(record), before);
  assert.equal(runnerTurnDetailsFromRecord(record, "1"), null);
  assert.equal(runnerTurnDetailsFromRecord({ runtime_turns: [{ state: "RECEIVED" }] }, 1), null);
  const p = await page(t);
  Object.assign(p.context, { root: p.root, details });
  vm.runInContext("renderRunnerTurnDetails(root, details, () => {})", p.context);
  assert.ok(p.root.textContent.includes(M.html));
  assert.ok(p.root.textContent.includes("not stored"));
  assert.equal(p.root.querySelectorAll("img").length, 0);
});

test("failed worker receipts show the failed attempt without inventing its output or completion time", () => {
  const record = { runtime_turns: [{
    id: "failed", state: "UNANSWERED", inbound: { exact_text: M.person },
    closure: { kind: "runner_unavailable", reason_code: "provider_failed", exact_text: "Fixed stored notice" },
    events: [{ event_type: "INVOCATION_FAILED", stage: "candidate", at: "2026-11-23T12:00:01.000Z", details: {
      error_code: "TIMEOUT", raw_private_evidence: { receipts: [{ role: "W", attempt: 1, provider: "openai", model: "stand-in-model", failed: "TIMEOUT", unrelated_secret: M.finding }] }
    } }]
  }] };
  const details = runnerTurnDetailsFromRecord(record, 1);
  assert.equal(step(details, "failure").content.result, "not stored");
  assert.deepEqual(step(details, "failure").workers[0], { role: "W", provider: "openai", model: "stand-in-model", attempt: 1, duration_ms: null, effort: null, failure_code: "TIMEOUT", rule_parts: [] });
  assert.equal(step(details, "draft"), undefined);
  assert.equal(step(details, "reader").at, null);
  assert.equal(JSON.stringify(details).includes(M.finding), false);
});

test("a check that fails part-way still shows the readings its finished checkers stored for that draft", () => {
  const record = {
    candidate_responses: [{ id: "cand-1", metadata: { runtime_turn_id: "t1" }, repair_cycle: 0, exact_text: M.draft1 }],
    runtime_turns: [{
      id: "t1", state: "UNANSWERED", inbound: { exact_text: M.person },
      runner_reading: { checker_levels: [
        { checker: "C1", candidate_id: "cand-1", level: "wants_to_die", recorded_at: "2026-11-23T12:00:02.000Z" },
        { checker: "C1", candidate_id: "other-candidate", level: "none", recorded_at: "2026-11-23T12:00:02.000Z" }
      ] },
      closure: { kind: "fixed_message", reason_code: "checker_refused", exact_text: "Fixed stored notice" },
      events: [
        { event_type: "INVOCATION_COMPLETED", stage: "candidate", at: "2026-11-23T12:00:01.000Z", details: { output: { exactText: M.draft1, result: { receipts: [{ role: "W", provider: "openai" }] } } } },
        { event_type: "INVOCATION_FAILED", stage: "audit", at: "2026-11-23T12:00:03.000Z", details: { error_code: "CHECKER_REFUSED", raw_private_evidence: { receipts: [{ role: "C1", provider: "anthropic" }, { role: "C2", provider: "anthropic", failed: "REFUSED" }] } } }
      ]
    }]
  };
  const details = runnerTurnDetailsFromRecord(record, 1);
  const failure = step(details, "failure");
  assert.equal(failure.content.result, "not stored");
  assert.deepEqual(failure.content.readings, [record.runtime_turns[0].runner_reading.checker_levels[0]]);
  assert.equal(failure.draft, 1);
  assert.deepEqual(failure.workers.map((call) => [call.role, call.failure_code]), [["C1", null], ["C2", "REFUSED"]]);
});

test("a reader that didn't run in the turn's arrangement gets no section; a failed one stays shown", () => {
  const turnWith = (boxes, runnerConfig) => ({ runtime_turns: [{ id: "w", state: "DELIVERED", inbound: { exact_text: M.person },
    ...(runnerConfig ? { runner_config: runnerConfig } : {}),
    runner_reading: { readers: { crisis: { level: "none", receipts: [{ role: "R1" }] }, ...(boxes === undefined ? {} : { boxes }), protection: { compatible: true, receipts: [{ role: "R3" }] } } },
    delivery: { exact_text: M.draft1, delivered_at: "2026-11-23T12:00:05.000Z" }, events: [] }] });
  const readerLabels = (record) => runnerTurnDetailsFromRecord(record, 1).steps.filter((entry) => entry.kind === "reader").map((entry) => entry.label);
  const whole = { rules: null, arrangement: { writerMode: "whole", checkerMode: "whole", readers: ["claude"], writer: ["codex"], checkers: ["claude"] } };
  // The runtime's own placeholder for the whole writer, with and without the stored arrangement (turns before runner_config).
  assert.deepEqual(readerLabels(turnWith({ boxes: [], receipts: [] }, whole)), ["Crisis reader", "Protection reader"]);
  assert.deepEqual(readerLabels(turnWith({ boxes: [], receipts: [] })), ["Crisis reader", "Protection reader"]);
  assert.deepEqual(readerLabels(turnWith(undefined)), ["Crisis reader", "Protection reader"]);
  // A focused writer's box reader that ran, or failed before any receipt, keeps its section.
  assert.deepEqual(readerLabels(turnWith({ boxes: ["box-1"], receipts: [{ role: "R2" }] })), ["Crisis reader", "Rule box reader", "Protection reader"]);
  assert.deepEqual(readerLabels(turnWith({ boxes: null, receipts: [] })), ["Crisis reader", "Rule box reader", "Protection reader"]);
});
