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
import { REPAIR_INDUCED_ERROR_CHECKS, createCandidateAuditEvidence, validateCandidateAuditEvidence } from "../src/supervisor/private-candidate-lifecycle.mjs";
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

test("the box reader's placeholder gets no section, known by its stored shape alone; a real or failed result stays shown whatever the stored arrangement", () => {
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
  // GPT's review 6: a turn made with the whole writer, stopped before its first call and retried after a restart with the focused
  // one keeps `writerMode: "whole"` while its box reader ran and stored a result. That result is shown, also when it found no box.
  assert.deepEqual(readerLabels(turnWith({ boxes: ["box-1"], receipts: [{ role: "R2" }] }, whole)), ["Crisis reader", "Rule box reader", "Protection reader"]);
  assert.deepEqual(readerLabels(turnWith({ boxes: [], receipts: [{ role: "R2" }] }, whole)), ["Crisis reader", "Rule box reader", "Protection reader"]);
  // Anything but the placeholder's exact shape (its two keys, both empty) stays shown.
  assert.deepEqual(readerLabels(turnWith({ boxes: [], receipts: [], note: "stored" })), ["Crisis reader", "Rule box reader", "Protection reader"]);
  assert.deepEqual(readerLabels(turnWith({ boxes: [], receipts: [], extra: [] })), ["Crisis reader", "Rule box reader", "Protection reader"]);
  assert.deepEqual(readerLabels(turnWith({ boxes: [] })), ["Crisis reader", "Rule box reader", "Protection reader"]);
});

// Synthetic turns for the invariants: one turn ("t1") with two drafts' candidates, and readings as the store validates them
// (private-runtime-turn-lifecycle.mjs: attempts numbered in order, the level reader C1 or the whole checker CW, a time each).
const at = (second) => `2026-11-23T12:00:${String(second).padStart(2, "0")}.000Z`;
const reading = (attempt, checker, candidateId, second, extra = {}) => ({ attempt, candidate_id: candidateId, candidate_version: 1, checker, level: "none", recorded_at: at(second), ...extra });
// A writer's completed call, bound to its draft by the call's context as the store binds it (draft 1's "ctx-w1", draft 2's "ctx-w2").
const writerDone = (stage, second, contextId = stage === "candidate" ? "ctx-w1" : "ctx-w2") => ({ event_type: "INVOCATION_COMPLETED", stage, at: at(second),
  details: { actual_context_id: contextId, output: { exactText: stage === "candidate" ? M.draft1 : M.draft2, result: { receipts: [{ role: "W", provider: "openai" }] } } } });
const auditDone = (second, roles, findings = [], contextId = null) => ({ event_type: "INVOCATION_COMPLETED", stage: "audit", at: at(second), details: { ...(contextId ? { actual_context_id: contextId } : {}), output: { value: { findings, checker_level: "none" }, providerReceipt: { receipts: roles.map((role) => ({ role, provider: "anthropic" })) } } } });
const auditFailed = (second, eventType = "INVOCATION_FAILED") => ({ event_type: eventType, stage: "audit", at: at(second), details: { error_code: "TIMEOUT", raw_private_evidence: { receipts: [] } } });
const moved = (from, to, second, details = {}) => ({ event_type: "STATE_TRANSITION", from_state: from, to_state: to, at: at(second), details });
const TWO_DRAFTS = [
  { id: "cand-1", version: 1, status: "pending_audit", metadata: { runtime_turn_id: "t1" }, repair_cycle: 0, parent_candidate_id: null, producer_context_id: "ctx-w1", exact_text: M.draft1, created_at: at(1), audit_history: [] },
  { id: "cand-2", version: 1, status: "reconstructed_pending_audit", metadata: { runtime_turn_id: "t1" }, repair_cycle: 1, parent_candidate_id: "cand-1", producer_context_id: "ctx-w2", exact_text: M.draft2, created_at: at(6), audit_history: [] }
];
const readingsTurn = (state, levels, events, end, candidates = [TWO_DRAFTS[0]]) => ({ candidate_responses: candidates, runtime_turns: [{ id: "t1", state, inbound: { exact_text: M.person }, runner_reading: { checker_levels: levels }, events, ...end }] });
const deliveredEnd = { delivery: { exact_text: M.draft1, delivered_at: at(59) } };
const interruptedEnd = { closure: { kind: "runner_unavailable", reason_code: "interrupted", exact_text: "Fixed stored notice", closed_at: at(59) } };

test("an audit the process stopped in still shows the reading its finished checker stored (GPT's review 6)", () => {
  // C1 stored wants_to_die, the process stopped while C2 ran, and the reload closed the turn as interrupted: no failure event.
  const record = readingsTurn("UNANSWERED", [reading(1, "C1", "cand-1", 2, { level: "wants_to_die" })],
    [{ event_type: "INVOCATION_STARTED", stage: "candidate", context_id: "attempt-w1", attempt: 1, at: at(0), details: {} }, { ...writerDone("candidate", 1), context_id: "attempt-w1" },
      moved("CANDIDATE_PENDING_AUDIT", "AUDITING", 1), { event_type: "INVOCATION_STARTED", stage: "audit", context_id: "attempt-a1", attempt: 1, at: at(1), details: {} },
      moved("AUDITING", "UNANSWERED", 59)], interruptedEnd);
  const details = runnerTurnDetailsFromRecord(record, 1);
  // The check that started and never ended is shown as such; the writer's call, which ended, is not.
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "started").map((entry) => [entry.label, entry.draft ?? null]), [["audit call started and not ended", 1]]);
  const withReadings = details.steps.filter((entry) => entry.content?.readings);
  assert.equal(withReadings.length, 1);
  assert.deepEqual(withReadings[0].content.readings, record.runtime_turns[0].runner_reading.checker_levels);
  assert.equal(withReadings[0].draft, 1);
  assert.equal(withReadings[0].content.result, "not stored");
  const kinds = details.steps.map((entry) => entry.kind);
  assert.ok(kinds.indexOf("draft") < kinds.indexOf("readings") && kinds.indexOf("readings") < kinds.indexOf("closure"));
});

// Each step that shows readings, as [kind, draft, the readings' attempts].
const readingSteps = (details) => details.steps.filter((entry) => entry.content?.readings).map((entry) => [entry.kind, entry.draft ?? null, entry.content.readings.map((item) => item.attempt)]);

test("every stored checker reading is shown exactly once, with its candidate's draft, in completed, failed, interrupted and repaired turns", () => {
  const finding = { id: "C2:1", checker: "C2", code: "SYNTHETIC", severity: "high", summary: M.finding };
  const scenarios = {
    split: [readingsTurn("DELIVERED", [reading(1, "C1", "cand-1", 2)], [writerDone("candidate", 1), auditDone(4, ["C1", "C2", "C3", "C4"])], deliveredEnd),
      [["checker", 1, [1]]]],
    whole: [readingsTurn("DELIVERED", [reading(1, "CW", "cand-1", 2)], [writerDone("candidate", 1), auditDone(4, ["CW"])], deliveredEnd),
      [["checker", 1, [1]]]],
    // A check whose stored result names no receipt for the reader: the reading gets the step after the events.
    no_receipt: [readingsTurn("DELIVERED", [reading(1, "CW", "cand-1", 2)], [writerDone("candidate", 1), auditDone(4, [])], deliveredEnd),
      [["readings", 1, [1]]]],
    // A failed attempt, then the same draft's check again: each reading with the attempt it was stored in.
    failed_then_passed: [readingsTurn("DELIVERED", [reading(1, "C1", "cand-1", 2), reading(2, "C1", "cand-1", 5)],
      [writerDone("candidate", 1), auditFailed(3), auditDone(6, ["C1", "C2"])], deliveredEnd),
      [["failure", 1, [1]], ["checker", 1, [2]]]],
    abandoned: [readingsTurn("UNANSWERED", [reading(1, "C1", "cand-1", 2)], [writerDone("candidate", 1), auditFailed(3, "INVOCATION_ABANDONED")], interruptedEnd),
      [["failure", 1, [1]]]],
    interrupted: [readingsTurn("UNANSWERED", [reading(1, "C1", "cand-1", 2, { level: "wants_to_die" })],
      [writerDone("candidate", 1), moved("CANDIDATE_PENDING_AUDIT", "AUDITING", 1), moved("AUDITING", "UNANSWERED", 59)], interruptedEnd),
      [["readings", 1, [1]]]],
    // Draft 1 checked and repaired, draft 2 interrupted in its check, and a reading for a candidate the record doesn't hold.
    repaired: [readingsTurn("UNANSWERED", [reading(1, "C1", "cand-1", 2), reading(2, "C1", "cand-2", 8), reading(3, "C1", "cand-x", 9)],
      [writerDone("candidate", 1), auditDone(3, ["C1", "C2"], [finding]), moved("AUDITING", "REPAIR_REQUIRED", 3), moved("REPAIR_REQUIRED", "RECONSTRUCTING", 4, { parent_candidate_id: "cand-1" }),
        writerDone("repair", 6), moved("CANDIDATE_PENDING_AUDIT", "AUDITING", 7), moved("AUDITING", "UNANSWERED", 59)], interruptedEnd, TWO_DRAFTS),
      [["checker", 1, [1]], ["readings", 2, [2]], ["readings", null, [3]]]]
  };
  for (const [name, [record, expected]] of Object.entries(scenarios)) {
    const stored = record.runtime_turns[0].runner_reading.checker_levels;
    const details = runnerTurnDetailsFromRecord(record, 1);
    assert.deepEqual(readingSteps(details), expected, `${name}: each reading in its own place`);
    const shown = details.steps.flatMap((entry) => (entry.content?.readings ?? []).map((item) => ({ item, draft: entry.draft ?? null })));
    assert.equal(shown.length, stored.length, `${name}: every reading, no more`);
    for (const entry of stored) {
      const matches = shown.filter(({ item }) => JSON.stringify(item) === JSON.stringify(entry));
      assert.equal(matches.length, 1, `${name}: reading ${entry.attempt} once`);
      const candidate = TWO_DRAFTS.find((item) => item.id === entry.candidate_id);
      assert.equal(matches[0].draft, candidate ? candidate.repair_cycle + 1 : null, `${name}: reading ${entry.attempt} with its draft`);
    }
  }
});

// A committed audit as the store builds it (createCandidateAuditEvidence), for one of TWO_DRAFTS, by an independent checker whose
// sealed call had `contextId`; `amend` changes it the way the store's commit can (it then checks it again, as the store does).
const committedAudit = (candidate, id, contextId, findings, second, amend = null) => {
  const audit = structuredClone(createCandidateAuditEvidence({ auditId: id, candidate, auditVersion: "synthetic-audit-v1", auditorContext: { kind: "independent", context_id: contextId }, findings,
    repairInducedChecks: candidate.parent_candidate_id == null ? [] : REPAIR_INDUCED_ERROR_CHECKS, completedAt: at(second), recordedAt: at(second) }));
  if (amend) { amend(audit); validateCandidateAuditEvidence(audit, candidate); }
  return audit;
};
const withAudits = (audits) => TWO_DRAFTS.map((candidate) => ({ ...candidate, audit_history: audits[candidate.id] ?? [] }));
const draftSteps = (details) => details.steps.filter((entry) => ["draft", "stored_draft", "committed_check", "repair_request"].includes(entry.kind)).map((entry) => [entry.kind, entry.draft ?? null]);

test("a committed audit is shown as committed, with its draft, also when no repair started and when the commit changed a finding (GPT's reviews of the fix)", () => {
  // The check passed; the store's commit found the response evidence changed and failed it, and the turn closed with no time left to
  // repair. Its check had also reported a self-directed-risk finding at high, which the commit keeps as record-only at medium.
  const risk = { id: "CW:risk", checker: "CW", code: "SELF_DIRECTED_RISK_OVERREACTION", severity: "high", summary: M.finding };
  const stale = { id: "evidence:dependencies", code: "RESPONSE_EVIDENCE_STALE", severity: "substantive", summary: "Response evidence dependencies changed.", unresolved: true, derived_in_code: true };
  const failed = committedAudit(TWO_DRAFTS[0], "audit-1", "ctx-a1", [risk], 4, (audit) => {
    audit.findings.push(stale);
    audit.unresolved_substantive_finding_ids = audit.findings.filter((finding) => finding.unresolved !== false && ["substantive", "high"].includes(finding.severity)).map((finding) => finding.id);
    audit.verdict = "fail";
    audit.sufficient_for_approval = false;
  });
  assert.deepEqual(failed.findings[0], { unresolved: true, ...risk, severity: "medium", record_only: true, reported_severity: "high" });
  // A committed audit whose call's record isn't among the turn's events.
  const unbound = committedAudit(TWO_DRAFTS[0], "audit-2", "ctx-elsewhere", [], 5);
  const record = readingsTurn("UNANSWERED", [reading(1, "CW", "cand-1", 2)], [writerDone("candidate", 1), auditDone(4, ["CW"], [risk], "ctx-a1"), moved("AUDITING", "UNANSWERED", 5)],
    { closure: { kind: "runner_unavailable", reason_code: "repair_time", exact_text: "Fixed stored notice", closed_at: at(59) } }, [withAudits({ "cand-1": [failed, unbound] })[0]]);
  const details = runnerTurnDetailsFromRecord(record, 1);
  const committed = details.steps.filter((entry) => entry.kind === "committed_check");
  assert.deepEqual(committed.map((entry) => [entry.draft, entry.content.verdict, entry.content.findings]), [[1, "fail", failed.findings], [1, "pass", []]]);
  assert.deepEqual(committed[0].content.unresolved_substantive_finding_ids, ["evidence:dependencies"]);
  const kinds = details.steps.map((entry) => entry.kind);
  assert.equal(kinds.indexOf("committed_check"), kinds.indexOf("program_checks") + 1, "the bound one follows its check");
  assert.match(committed[1].label, /no stored record of its call/u);
  assert.equal(JSON.stringify(details).includes("ctx-"), false, "no call identifier");
});

test("drafts and committed audits are bound by stored identity: a first draft with no writer's call, and its check, keep their own place (GPT's review of the fix)", () => {
  // Draft 1 was committed with no record of its writer's call (the advisory store allows it); its check and draft 2's writer and
  // check were recorded.
  const audit1 = committedAudit(TWO_DRAFTS[0], "audit-1", "ctx-a1", [{ id: "CW:1", checker: "CW", code: "SYNTHETIC", severity: "high", summary: M.finding }], 3);
  const audit2 = committedAudit(TWO_DRAFTS[1], "audit-2", "ctx-a2", [], 8);
  const candidates = withAudits({ "cand-1": [audit1], "cand-2": [audit2] });
  const committedAt = (audit, candidateId, from, to, second) => moved(from, to, second, { audit_id: audit.id, candidate_id: candidateId, verdict: audit.verdict });
  const record = readingsTurn("DELIVERED", [reading(1, "CW", "cand-1", 2), reading(2, "CW", "cand-2", 7)], [
    auditDone(3, ["CW"], audit1.findings, "ctx-a1"), committedAt(audit1, "cand-1", "AUDITING", "REPAIR_REQUIRED", 3), moved("REPAIR_REQUIRED", "RECONSTRUCTING", 4, { parent_candidate_id: "cand-1" }),
    writerDone("repair", 6), auditDone(8, ["CW"], [], "ctx-a2"), committedAt(audit2, "cand-2", "AUDITING", "APPROVED", 8)
  ], deliveredEnd, candidates);
  const details = runnerTurnDetailsFromRecord(record, 1);
  assert.deepEqual(draftSteps(details), [["stored_draft", 1], ["committed_check", 1], ["repair_request", 2], ["draft", 2], ["committed_check", 2]]);
  const words = (kind, draft) => details.steps.find((entry) => entry.kind === kind && entry.draft === draft).content.exact_text;
  assert.equal(words("stored_draft", 1), M.draft1);
  assert.equal(words("draft", 2), M.draft2);
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "checker").map((entry) => [entry.draft, entry.content.readings.map((item) => item.attempt)]), [[1, [1]], [2, [2]]]);
  assert.equal(details.steps.filter((entry) => /bound to no stored draft/u.test(entry.label)).length, 0);
  // Each draft and each committed audit exactly once, under its own identity.
  assert.deepEqual(details.steps.filter((entry) => ["draft", "stored_draft"].includes(entry.kind)).map((entry) => entry.content.exact_text), [M.draft1, M.draft2]);
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "committed_check").map((entry) => entry.content.recorded_at), [audit1.recorded_at, audit2.recorded_at]);
});

test("a draft's stored words stay the draft's, beside its call's differing words, and two drafts' audits sharing an auditor's context stay with their own checks (GPT's third review)", () => {
  // The advisory store keeps a draft whose words differ from its writer's call, and two audits may share an auditor's context.
  const storedWords = "Candidatestoreddetailsmarker";
  const drafts = [{ ...TWO_DRAFTS[0], exact_text: storedWords }, { ...TWO_DRAFTS[1] }];
  const audit1 = { ...committedAudit(drafts[0], "audit-1", "ctx-shared", [{ id: "CW:1", checker: "CW", code: "SYNTHETIC", severity: "high", summary: M.finding }], 3), candidate_id: "cand-1" };
  const audit2 = { ...committedAudit(drafts[1], "audit-2", "ctx-shared", [], 8), candidate_id: "cand-2" };
  const candidates = [{ ...drafts[0], audit_history: [audit1] }, { ...drafts[1], audit_history: [audit2] }];
  const commit = (audit, candidateId, to, second) => moved("AUDITING", to, second, { audit_id: audit.id, candidate_id: candidateId, verdict: audit.verdict });
  const record = readingsTurn("DELIVERED", [reading(1, "CW", "cand-1", 2), reading(2, "CW", "cand-2", 7)], [
    writerDone("candidate", 1), auditDone(3, ["CW"], audit1.findings, "ctx-shared"), commit(audit1, "cand-1", "REPAIR_REQUIRED", 3), moved("REPAIR_REQUIRED", "RECONSTRUCTING", 4, { parent_candidate_id: "cand-1" }),
    writerDone("repair", 6), auditDone(8, ["CW"], [], "ctx-shared"), commit(audit2, "cand-2", "APPROVED", 8)
  ], deliveredEnd, candidates);
  const details = runnerTurnDetailsFromRecord(record, 1);
  // The first draft's call words (M.draft1) differ from its stored words.
  const draft1 = details.steps.find((entry) => entry.kind === "draft" && entry.draft === 1);
  assert.equal(draft1.content.exact_text, storedWords);
  assert.equal(draft1.content.call_exact_text, M.draft1);
  assert.equal(Object.hasOwn(details.steps.find((entry) => entry.kind === "draft" && entry.draft === 2).content, "call_exact_text"), false);
  assert.deepEqual(draftSteps(details), [["draft", 1], ["committed_check", 1], ["repair_request", 2], ["draft", 2], ["committed_check", 2]]);
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "checker").map((entry) => [entry.draft, entry.content.readings.map((item) => item.attempt)]), [[1, [1]], [2, [2]]]);
  const committedSteps = details.steps.filter((entry) => entry.kind === "committed_check");
  assert.deepEqual(committedSteps.map((entry) => [entry.draft, entry.content.verdict]), [[1, "fail"], [2, "pass"]]);
});

test("a kept-plan action, a question asked instead of a reply and a call of another stage are shown as stored", () => {
  const record = readingsTurn("UNANSWERED", [], [writerDone("candidate", 1), { event_type: "INVOCATION_COMPLETED", stage: "discriminator_review", context_id: "attempt-d1", at: at(5), details: { actual_context_id: "ctx-d1", output: { exactText: "Callexactdetailsmarker", value: { synthetic: "reviewed" }, providerReceipt: { receipts: [] } } } }], interruptedEnd);
  record.runtime_turns[0].kept_plan_kept_at = at(10);
  record.runtime_turns[0].kept_plan_deleted_at = at(20);
  record.runtime_turns[0].discriminator = { exact_text: "Questiondetailsmarker", kind: "clarifying", sha256: "0".repeat(64), producer_context_id: "ctx-d0", created_at: at(4) };
  const details = runnerTurnDetailsFromRecord(record, 1);
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "kept_plan").map((entry) => [entry.label, entry.content]), [
    ["Kept plan deleted in this turn", { deleted_at: at(20) }], ["Kept plan saved in this turn", { saved_at: at(10) }]
  ]);
  assert.deepEqual(details.steps.find((entry) => entry.kind === "discriminator").content, { exact_text: "Questiondetailsmarker", kind: "clarifying" });
  assert.deepEqual(details.steps.find((entry) => entry.kind === "call").content, { exact_text: "Callexactdetailsmarker", result: { synthetic: "reviewed" } });
  assert.equal(JSON.stringify(details).includes("ctx-d0") || JSON.stringify(details).includes("ctx-d1"), false);
});

test("a plan saved in an interrupted turn, audits with the same id in two drafts and a repeated writer completion keep their places (GPT's fourth review)", () => {
  // The runtime saves a kept plan before the writer's result is stored, and the process stops: the plan is all that is left of it.
  const interrupted = readingsTurn("UNANSWERED", [], [{ event_type: "INVOCATION_STARTED", stage: "candidate", context_id: "attempt-w1", attempt: 1, at: at(1), details: {} }], interruptedEnd, []);
  interrupted.runtime_turns[0].kept_plan_kept_at = at(2);
  interrupted.runner_kept_plans = [{ id: "kept-plan:1", conversation_id: "conv", runtime_turn_id: "t1", kept_at: at(2), lines: ["Planlinedetailsmarker"], deleted_at: null, deletion_reason: null }];
  const kept = runnerTurnDetailsFromRecord(interrupted, 1).steps.find((entry) => entry.kind === "kept_plan");
  assert.deepEqual(kept.content, { saved_at: at(2), lines: ["Planlinedetailsmarker"], deleted_at: null, deletion_reason: null });

  // Two drafts' audits with the same id, each committed by a transition naming its own draft.
  const audit1 = committedAudit(TWO_DRAFTS[0], "audit-same", "ctx-a1", [], 3);
  const audit2 = committedAudit(TWO_DRAFTS[1], "audit-same", "ctx-a2", [], 8);
  const commit = (candidateId, to, second) => moved("AUDITING", to, second, { audit_id: "audit-same", candidate_id: candidateId, verdict: "pass" });
  const record = readingsTurn("DELIVERED", [], [
    writerDone("candidate", 1), auditDone(3, ["CW"], [], "ctx-a1"), commit("cand-1", "REPAIR_REQUIRED", 3), moved("REPAIR_REQUIRED", "RECONSTRUCTING", 4, { parent_candidate_id: "cand-1" }),
    writerDone("repair", 6), auditDone(8, ["CW"], [], "ctx-a2"), commit("cand-2", "APPROVED", 8)
  ], deliveredEnd, withAudits({ "cand-1": [audit1], "cand-2": [audit2] }));
  const details = runnerTurnDetailsFromRecord(record, 1);
  assert.deepEqual(draftSteps(details), [["draft", 1], ["committed_check", 1], ["repair_request", 2], ["draft", 2], ["committed_check", 2]]);
  assert.equal(details.steps.filter((entry) => /no stored record of its call/u.test(entry.label)).length, 0);

  // A repeated completion of the same writer's call: the draft once, the second completion as a call.
  const repeated = readingsTurn("DELIVERED", [], [writerDone("candidate", 1), writerDone("candidate", 2)], deliveredEnd);
  const repeatedDetails = runnerTurnDetailsFromRecord(repeated, 1);
  assert.equal(repeatedDetails.steps.filter((entry) => entry.kind === "draft").length, 1);
  assert.deepEqual(repeatedDetails.steps.filter((entry) => entry.kind === "call").map((entry) => [entry.draft, entry.content.exact_text]), [[1, M.draft1]]);
});

test("a turn that deleted an older plan and saved a new one, a reused producer context and an audit stored as a result keep to their facts (GPT's fifth review)", () => {
  // Both plan flags in one turn: the older plan deleted, the new one saved, and later deleted itself.
  const plans = [
    { id: "kept-plan:0", conversation_id: "conv", runtime_turn_id: "t0", kept_at: at(0), lines: ["Oldplandetailsmarker"], deleted_at: at(1), deletion_reason: "asked_in_conversation" },
    { id: "kept-plan:1", conversation_id: "conv", runtime_turn_id: "t1", kept_at: at(2), lines: ["Newplandetailsmarker"], deleted_at: null, deletion_reason: null }
  ];
  const both = readingsTurn("DELIVERED", [], [writerDone("candidate", 3)], deliveredEnd);
  Object.assign(both.runtime_turns[0], { kept_plan_deleted_at: at(1), kept_plan_kept_at: at(2) });
  both.runner_kept_plans = plans;
  const planSteps = (record) => runnerTurnDetailsFromRecord(record, 1).steps.filter((entry) => entry.kind === "kept_plan").map((entry) => [entry.label, entry.content]);
  assert.deepEqual(planSteps(both), [
    ["Kept plan deleted in this turn", { deleted_at: at(1) }],
    ["Kept plan saved in this turn", { saved_at: at(2), lines: ["Newplandetailsmarker"], deleted_at: null, deletion_reason: null }]
  ]);
  both.runner_kept_plans = [plans[0], { ...plans[1], deleted_at: at(30), deletion_reason: "expired", lines: [] }];
  assert.deepEqual(planSteps(both)[1][1], { saved_at: at(2), lines: [], deleted_at: at(30), deletion_reason: "expired" });

  // A third draft that reuses the first draft's producer context is still bound to its own repair.
  const threeDrafts = [
    { ...TWO_DRAFTS[0] }, { ...TWO_DRAFTS[1] },
    { ...TWO_DRAFTS[1], id: "cand-3", repair_cycle: 2, parent_candidate_id: "cand-2", producer_context_id: "ctx-w1", exact_text: "Draftthreedetailsmarker", audit_history: [] }
  ];
  const reused = readingsTurn("DELIVERED", [], [writerDone("candidate", 1), writerDone("repair", 6), writerDone("repair", 12, "ctx-w1")], deliveredEnd, threeDrafts);
  const reusedDetails = runnerTurnDetailsFromRecord(reused, 1);
  assert.deepEqual(reusedDetails.steps.filter((entry) => ["draft", "stored_draft"].includes(entry.kind)).map((entry) => [entry.kind, entry.draft]), [["draft", 1], ["draft", 2], ["draft", 3]]);

  // An audit whose result the store kept as `result`.
  const audit = auditDone(4, ["CW"], [], "ctx-a1");
  audit.details.output = { result: { findings: [{ id: "CW:1", checker: "CW", code: "SYNTHETIC", severity: "high", summary: M.finding }], checker_level: "none" }, providerReceipt: { receipts: [{ role: "CW", provider: "anthropic" }] } };
  const interruptedAudit = readingsTurn("UNANSWERED", [], [writerDone("candidate", 1), audit], interruptedEnd);
  assert.equal(JSON.stringify(step(runnerTurnDetailsFromRecord(interruptedAudit, 1), "checker").content).includes(M.finding), true);
});

test("a later transition that names an audit again (a delivery) doesn't take the audit's commit place (GPT's sixth review)", () => {
  // The repair draft was committed with no record of its writer's call (its check was recorded), its audit's context is reused by a
  // later completion after approval, and the delivery names the audit again.
  const audit1 = committedAudit(TWO_DRAFTS[0], "audit-1", "ctx-a1", [], 3);
  const audit2 = committedAudit(TWO_DRAFTS[1], "audit-2", "ctx-a2", [], 8);
  const commit = (id, candidateId, to, second) => moved("AUDITING", to, second, { audit_id: id, candidate_id: candidateId, verdict: "pass" });
  const record = readingsTurn("DELIVERED", [], [
    writerDone("candidate", 1), auditDone(3, ["CW"], [], "ctx-a1"), commit("audit-1", "cand-1", "REPAIR_REQUIRED", 3), moved("REPAIR_REQUIRED", "RECONSTRUCTING", 4, { parent_candidate_id: "cand-1" }),
    auditDone(8, ["CW"], [], "ctx-a2"), commit("audit-2", "cand-2", "APPROVED", 8), auditDone(9, ["CW"], [], "ctx-a2"),
    moved("APPROVED", "DELIVERED", 10, { audit_id: "audit-2", candidate_id: "cand-2" })
  ], deliveredEnd, withAudits({ "cand-1": [audit1], "cand-2": [audit2] }));
  const details = runnerTurnDetailsFromRecord(record, 1);
  assert.deepEqual(draftSteps(details), [["draft", 1], ["committed_check", 1], ["repair_request", 2], ["stored_draft", 2], ["committed_check", 2]]);
  // The check at t8 is draft 2's, at the moment its audit was committed (t8); the completion at t9 reusing its context stays draft
  // 2's too, and neither is labelled draft 1's.
  assert.deepEqual(details.steps.filter((entry) => entry.kind === "checker").map((entry) => entry.draft), [1, 2, 2]);
});

// Seeded random stored turns in the runtime's own order: writers and checks that fail, are abandoned or never end, checks stored with
// no commit, repairs, closings at any point. `damaged` also loses or reuses identities: calls with no stored record, missing or shared
// contexts, an audit id reused by two drafts, words that differ from the draft's. Each stored thing carries a word of its own, so what
// the view hides or shows twice is seen whatever the turn's shape (the scenarios above were found one review at a time).
function randomTurn(next, damaged) {
  const chance = (p) => next() < p;
  const pick = (values) => values[Math.floor(next() * values.length)];
  let count = 0, second = 0, context = 0, attempt = 0, state = null;
  const words = [];
  const word = (name) => { const value = `${name}Word${(count += 1)}Z`; words.push(value); return value; };
  const forget = (value) => { words.splice(words.indexOf(value), 1); };
  const now = () => new Date(Date.parse("2026-11-24T00:00:00.000Z") + (second += 1) * 1_000).toISOString();
  const newContext = () => `ctx-${(context += 1)}`;
  const sharedContext = newContext();
  const events = [], candidates = [], levels = [], truth = { drafts: [], readings: [], audits: [], checks: [] };
  const move = (to, details = {}) => { events.push({ event_type: "STATE_TRANSITION", from_state: state, to_state: to, at: now(), details }); state = to; };
  const call = (type, stage, id, details = {}) => { events.push({ event_type: type, stage, context_id: id, attempt: 1, at: now(), details }); return events.at(-1); };
  const failed = (stage, id, name) => call(pick(["INVOCATION_FAILED", "INVOCATION_ABANDONED"]), stage, id, { error_code: word(name), raw_private_evidence: { receipts: [] } });
  const identity = () => (damaged && chance(0.15) ? pick([null, sharedContext]) : newContext());
  move("RECEIVED");
  const readers = { crisis: { reason: word("crisis"), receipts: [] }, protection: { compatibility_assessment: { issue: word("protection") }, receipts: [] } };
  const boxes = pick(["placeholder", "real", "failed", "empty"]);
  readers.boxes = boxes === "placeholder" ? { boxes: [], receipts: [] } : boxes === "real" ? { boxes: [word("box")], receipts: [] } : { boxes: boxes === "failed" ? null : [], receipts: [{ role: "R2", failed: word("boxFailed") }] };
  if (chance(0.2)) readers.other = { note: word("other") };
  let parent = null, reply = null;
  const drafts = pick([0, 1, 1, 2, 2, 3]);
  for (let cycle = 0; cycle < drafts; cycle += 1) {
    const stage = cycle === 0 ? "candidate" : "repair", last = cycle === drafts - 1;
    if (chance(0.2)) { const id = newContext(); call("INVOCATION_STARTED", stage, id); failed(stage, id, "writerFailed"); }
    if (chance(0.05)) { call("INVOCATION_STARTED", stage, newContext()); break; }
    const producer = identity(), lost = damaged && chance(0.15), text = word("draft"), said = !lost && damaged && chance(0.1) ? word("said") : text, id = newContext();
    call("INVOCATION_STARTED", stage, id);
    if (!lost) call("INVOCATION_COMPLETED", stage, id, { ...(producer ? { actual_context_id: producer } : {}), output: { exactText: said, result: { note: word("writerNote"), receipts: [{ role: "W", provider: "openai" }] } } });
    if (chance(0.03)) { if (lost || said !== text) forget(text); break; }
    const candidate = { id: `cand-${cycle + 1}`, metadata: { runtime_turn_id: "t1" }, repair_cycle: cycle, parent_candidate_id: parent, ...(producer ? { producer_context_id: producer } : {}), exact_text: text, created_at: now(), audit_history: [] };
    candidates.push(candidate); truth.drafts.push(candidate); reply = text;
    move("CANDIDATE_PENDING_AUDIT"); move("AUDITING");
    const checker = pick(["C1", "CW"]), roles = checker === "C1" ? ["C1", "C2", "C3", "C4", "C5"] : ["CW"];
    const read = () => { const entry = { attempt: (attempt += 1), candidate_id: candidate.id, checker, level: "none", recorded_at: now(), note: word("reading") }; levels.push(entry); truth.readings.push([entry, cycle + 1]); };
    if (chance(0.25)) { const failedId = newContext(); call("INVOCATION_STARTED", "audit", failedId); if (chance(0.6)) read(); failed("audit", failedId, "checkFailed"); }
    if (chance(0.08)) { call("INVOCATION_STARTED", "audit", newContext()); if (chance(0.7)) read(); break; }
    const auditor = identity(), checkId = newContext(), checkLost = damaged && chance(0.1), findings = [];
    call("INVOCATION_STARTED", "audit", checkId);
    if (chance(0.95)) read();
    if (chance(0.6)) findings.push({ id: `${roles.at(-1)}:1`, checker: roles.at(-1), severity: "high", summary: word("finding") });
    if (chance(0.3)) findings.push({ id: "P:1", checker: "program", severity: "high", summary: word("program") });
    if (chance(0.2)) findings.push({ id: "X:1", severity: "low", summary: word("unbound") });
    if (!checkLost) truth.checks.push([call("INVOCATION_COMPLETED", "audit", checkId, { ...(auditor ? { actual_context_id: auditor } : {}), output: { value: { findings, extra: word("checkExtra") }, providerReceipt: { receipts: (damaged && chance(0.1) ? [] : roles).map((role) => ({ role, provider: "anthropic" })) } } }), cycle + 1]);
    if (chance(0.04)) { if (checkLost) for (const finding of findings) forget(finding.summary); break; }
    const audit = { id: damaged && chance(0.1) ? "audit-same" : `audit-${cycle + 1}`, verdict: pick(["pass", "fail"]), sufficient_for_approval: chance(0.5), unresolved_substantive_finding_ids: findings.map((finding) => finding.id),
      findings: [...findings, ...(chance(0.3) ? [{ id: "evidence:1", severity: "substantive", summary: word("evidence") }] : [])], ...(auditor ? { auditor_context_id: auditor } : {}), completed_at: now(), recorded_at: now() };
    candidate.audit_history.push(audit); truth.audits.push([audit, cycle + 1]);
    const to = last ? pick(["APPROVED", "UNANSWERED"]) : "REPAIR_REQUIRED";
    move(to, damaged && chance(0.1) ? {} : { audit_id: audit.id, candidate_id: candidate.id });
    if (to === "APPROVED" && chance(0.95)) move("DELIVERED", { audit_id: audit.id, candidate_id: candidate.id });
    if (last || chance(0.05)) break;
    move("RECONSTRUCTING", { parent_candidate_id: candidate.id }); parent = candidate.id;
  }
  if (!["DELIVERED", "UNANSWERED"].includes(state)) move("UNANSWERED");
  truth.plan = chance(0.2) ? { runtime_turn_id: "t1", kept_at: now(), lines: [word("plan")], deleted_at: null, deletion_reason: null } : null;
  truth.deletedAt = chance(0.2) ? now() : null;
  const turn = { id: "t1", state, inbound: { exact_text: word("person") }, runner_reading: { readers, checker_levels: levels }, events,
    ...(truth.plan ? { kept_plan_kept_at: truth.plan.kept_at } : {}), ...(truth.deletedAt ? { kept_plan_deleted_at: truth.deletedAt } : {}),
    ...(state === "DELIVERED" ? { delivery: { exact_text: reply, delivered_at: now() } } : { closure: { reason_code: word("closing"), exact_text: word("notice"), closed_at: now() } }) };
  return { record: { candidate_responses: candidates, runner_kept_plans: truth.plan ? [truth.plan] : [], runtime_turns: [turn] }, words, truth };
}

for (const [name, damaged] of [["the runtime's own order and identities", false], ["lost, missing or reused identities", true]]) {
  test(`in 3,000 seeded turns with ${name}, every stored word is shown, and each reading, draft and committed audit once, with its own draft`, () => {
    let seed = damaged ? 11 : 7;
    const next = () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed / 2 ** 32; };
    for (let index = 0; index < 3_000; index += 1) {
      const { record, words, truth } = randomTurn(next, damaged);
      const before = JSON.stringify(record);
      const details = runnerTurnDetailsFromRecord(record, 1);
      assert.equal(JSON.stringify(record), before, "the record is only read");
      const text = JSON.stringify(details.steps);
      for (const value of words) assert.ok(text.includes(value), `turn ${index}: ${value} is shown\n${before}`);
      // Each as stored, whole, and no more of them.
      const ofKind = (...kinds) => details.steps.filter((entry) => kinds.includes(entry.kind));
      const readings = details.steps.flatMap((entry) => (entry.content?.readings ?? []).map((item) => [item, entry.draft ?? null])).sort(([a], [b]) => a.attempt - b.attempt);
      assert.deepEqual(readings, truth.readings, `turn ${index}: readings\n${before}`);
      const drafts = ofKind("draft", "stored_draft").filter((entry) => entry.draft != null).map((entry) => [entry.draft, entry.content.exact_text]).sort(([a], [b]) => a - b);
      assert.deepEqual(drafts, truth.drafts.map((candidate) => [candidate.repair_cycle + 1, candidate.exact_text]), `turn ${index}: drafts\n${before}`);
      const audits = ofKind("committed_check").map((entry) => [entry.content, entry.draft ?? null]).sort(([a], [b]) => a.recorded_at.localeCompare(b.recorded_at));
      const committed = ({ verdict, sufficient_for_approval, unresolved_substantive_finding_ids, findings, completed_at, recorded_at }) => ({ verdict, sufficient_for_approval, unresolved_substantive_finding_ids, findings, completed_at, recorded_at });
      assert.deepEqual(audits, truth.audits.map(([audit, draft]) => [committed(audit), draft]), `turn ${index}: committed audits\n${before}`);
      for (const [event] of truth.checks) {
        const own = ofKind("checker", "findings", "program_checks").filter((entry) => entry.at === event.at).flatMap((entry) => entry.content.findings);
        assert.deepEqual(own.sort((a, b) => a.id.localeCompare(b.id)), [...event.details.output.value.findings].sort((a, b) => a.id.localeCompare(b.id)), `turn ${index}: a check's findings\n${before}`);
      }
      const plans = ofKind("kept_plan").map((entry) => entry.content);
      assert.deepEqual(plans, [...(truth.deletedAt ? [{ deleted_at: truth.deletedAt }] : []), ...(truth.plan ? [{ saved_at: truth.plan.kept_at, lines: truth.plan.lines, deleted_at: null, deletion_reason: null }] : [])], `turn ${index}: the kept plan\n${before}`);
      // A check with a stored identity of its own, or in the runtime's own order, is shown with its own draft. Any other can only be
      // placed by position.
      const contextOf = (event) => event.details.actual_context_id ?? null;
      const identified = (event) => contextOf(event) !== null && truth.checks.filter(([other]) => contextOf(other) === contextOf(event)).length === 1 && truth.audits.some(([audit]) => audit.auditor_context_id === contextOf(event));
      for (const [event, draft] of truth.checks) if (!damaged || identified(event)) assert.equal(details.steps.find((entry) => entry.kind === "program_checks" && entry.at === event.at)?.draft, draft, `turn ${index}: a check's draft\n${before}`);
    }
  });
}
