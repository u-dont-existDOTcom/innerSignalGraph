import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { createPrivateSupervisorDraftService } from "../src/supervisor/private-supervisor-draft.mjs";
import { callSupervisor, copyApprovedText, describeArtifact } from "../apps/web/supervisor-panel.js";

// Synthetic data only. These tests drive the real loopback server's supervisor routes and the real owner panel against it, with a
// scripted model runtime in place of a provider and synthetic encrypted stores.

const CASE_ID = "synthetic-route-case";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = Date.parse("2026-10-01T12:00:00.000Z");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const turn = (exchange, role, text, day) => ({ id: `${exchange}-${role}`, exchange_id: exchange, role, text, at: `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`, episode_id: "episode:synthetic" });

function scriptedRuntime() {
  return {
    async produceCandidate() { return { exactText: "Synthetic backend reply.\n\nWhich signal changed first?", contextId: "context:producer:backend" }; },
    async auditCandidate({ candidate }) {
      return {
        contextId: `context:auditor:${candidate.id}`,
        value: { findings: [], repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...REPAIR_INDUCED_ERROR_CHECKS] },
        disclosureManifest: { exact_candidate_included: true, producer_hidden_reasoning_included: false }
      };
    },
    async repairCandidate() { throw new Error("unused"); }
  };
}

async function makeStore(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-supervisor-route-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(START + (tick += 1) * 1000).toISOString();
  const store = createEncryptedPrivateCaseStore({ rootDir, routineKek: Buffer.alloc(32, 51), recoverySecretBytes: Buffer.alloc(32, 52), developmentExternalCredentialAuthorized: true, now });
  t.after(() => store.close());
  await store.appendTranscriptTurn(CASE_ID, turn("E1", "user", "Synthetic earlier client message.", 1));
  await store.appendTranscriptTurn(CASE_ID, turn("E1", "assistant", "Synthetic earlier reply.", 1));
  await store.appendTranscriptTurn(CASE_ID, turn("E2", "user", "Synthetic newest client message waiting for a reply.", 2));
  return { store, rootDir, now };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function startOwnerServer(t) {
  const { store } = await makeStore(t);
  const service = createPrivateSupervisorDraftService({ privateCaseSource: store, modelRuntime: scriptedRuntime() });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateSupervisorService: service });
  const base = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, base, service };
}

// The same server over the real access service, with holders of two tokens and a provider the test can switch.
async function startGovernedServer(t) {
  const { store, rootDir, now } = await makeStore(t);
  const revoked = new Set();
  const authorizationProvider = {
    async authorize({ authContext }) {
      const token = authContext?.bearerToken;
      if (!["owner-token", "agent-token"].includes(token) || revoked.has(token)) return { allowed: false };
      return { allowed: true, principalId: `principal:${token}`, scopes: ["case:read", "case:write", "case:audit"], purposes: [] };
    }
  };
  const keyProvider = {
    async getCaseKeyMaterial() {
      return { routineKek: Buffer.alloc(32, 51), recoverySecretBytes: Buffer.alloc(32, 52), accessAssurance: "development_external_file", provider: "development-file-provider" };
    }
  };
  const privateCaseAccessService = createPrivateCaseAccessService({ rootDir, authorizationProvider, keyProvider, allowDevelopmentFileProvider: true, now });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const service = createPrivateSupervisorDraftService({ privateCaseSource: privateCaseAccessService, modelRuntime: scriptedRuntime() });
  const server = createInnerSignalServer({
    config,
    providers: createProviders(config),
    privateCaseAccessService,
    privateAuthContext: { bearerToken: "owner-token" },
    privateSupervisorService: service
  });
  const base = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { store, base, revoked };
}

// A browser attaches the page's Origin to every POST it makes, same-origin ones included, so a request on the owner's channel carries
// the application's own origin unless a test removes it (`origin: null`). A request that carries its own bearer token is an agent, which
// is not a browser and sends none.
async function post(base, route, body, headers = {}) {
  const sent = { "content-type": "application/json", ...(headers.authorization === undefined ? { origin: base } : {}), ...headers };
  for (const name of Object.keys(sent)) if (sent[name] === null) delete sent[name];
  const response = await fetch(`${base}/v1/case/supervisor/${route}`, {
    method: "POST",
    headers: sent,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
}

const AGENT = { authorization: "Bearer agent-token" };

// The fetch a browser gives the owner's page: the page's Origin and Sec-Fetch-Site go on every request that is not a GET or HEAD, whatever
// the code asks for, as long as it keeps the default fetch mode. The log lets a test see the panel never asks for another mode.
function browserFetch(base) {
  const calls = [];
  const fetchImpl = (url, init = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    calls.push({ url, method, mode: init.mode, credentials: init.credentials });
    const browserHeaders = method === "GET" || method === "HEAD" ? {} : { origin: base, "sec-fetch-site": "same-origin" };
    return fetch(`${base}${url}`, { ...init, headers: { ...browserHeaders, ...init.headers } });
  };
  return { fetchImpl, calls };
}

test("the loopback server takes a draft through review, exact export and an owner report, and none of it is a send", async (t) => {
  const { store, base } = await startOwnerServer(t);
  const text = "  Hola — ¿qué cambió primero?\r\n\r\nSin prisa.  ";

  const prepared = await post(base, "prepare", { caseId: CASE_ID });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.headers.get("cache-control"), "no-store");
  assert.equal(prepared.body.latest_client_turn.text, "Synthetic newest client message waiting for a reply.");

  const submitted = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text, companion: { language: "en", text: "Hello, what changed first?" }, basisSha256: prepared.body.basis.sha256, idempotencyKey: "route-1" });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.status, "approved");
  assert.equal(submitted.text.includes("Sin prisa"), false, "the review result never carries the client text");
  const artifactId = submitted.body.artifact.artifact_id;

  const exported = await post(base, "export", { caseId: CASE_ID, artifactId });
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("cache-control"), "no-store");
  assert.equal(exported.body.client_text, text, "the exact approved bytes, with their spaces, line endings and characters");
  assert.equal(exported.body.client_text_sha256, sha256(text));
  assert.equal(exported.body.sent_status, "not_sent");
  assert.equal(exported.body.companion.audience, "supervisor");

  let record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => event.kind), ["exported", "exported"]);
  assert.equal(record.candidate_responses.at(-1).status, "approved_for_delivery");

  const reported = await post(base, "report-sent", { caseId: CASE_ID, idempotencyKey: "route-report-1" });
  assert.equal(reported.status, 200);
  assert.deepEqual([reported.body.event.provenance.origin, reported.body.event.provenance.actor_resolution], ["owner_action", "owner_verified"]);
  assert.deepEqual([reported.body.event.sent_at, reported.body.event.sent_at_status], [null, "unavailable"]);
  record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => event.kind), ["exported", "exported", "reported_sent"]);

  // A report whose answer never arrived is retried exactly as it was sent. The first call took the draft out of the waiting set,
  // so the retry names no draft and is still answered from the report already recorded rather than refused or recorded twice.
  assert.equal(reported.body.replayed, false);
  const retried = await post(base, "report-sent", { caseId: CASE_ID, idempotencyKey: "route-report-1" });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.replayed, true);
  assert.equal(retried.body.event.id, reported.body.event.id);
  assert.equal(retried.body.artifact.artifact_id, artifactId);
  assert.equal((await store.load(CASE_ID)).communication_events.length, 3, "the retry recorded nothing new");
  // The same key carrying another send time is a different report, not a retry, and is refused.
  const contradicted = await post(base, "report-sent", { caseId: CASE_ID, idempotencyKey: "route-report-1", sentAt: "2026-10-02T13:00:00.000Z" });
  assert.deepEqual([contradicted.status, contradicted.body.code], [409, "SUPERVISOR_IDEMPOTENCY_CONFLICT"]);
  assert.equal((await store.load(CASE_ID)).communication_events.length, 3);

  const health =await (await fetch(`${base}/health`)).json();
  for (const route of ["prepare", "submit", "export", "report-sent"]) assert.ok(health.endpoints.includes(`/v1/case/supervisor/${route}`));
});

test("over HTTP a retry that changes what defined a submission or an input is refused with the fields named, and the stored result is not returned for it", async (t) => {
  const { store, base } = await startGovernedServer(t);
  const text = "Synthetic external draft held under a key.";
  const companion = { language: "en", text: "Synthetic companion." };
  const submit = (body, headers) => post(base, "submit", { caseId: CASE_ID, idempotencyKey: "route-defined", ...body }, headers);
  const refused = (response, ...fields) => {
    assert.deepEqual([response.status, response.body.code], [409, "SUPERVISOR_IDEMPOTENCY_CONFLICT"]);
    for (const field of fields) assert.ok(response.body.reasons.includes(field), `${field} is named in ${JSON.stringify(response.body.reasons)}`);
    assert.equal(response.text.includes(text) || response.text.includes("Synthetic companion"), false, "the refusal carries no case content");
  };

  const first = await submit({ source: "external_draft", text, companion });
  assert.equal(first.status, 200);
  const revision = (await store.load(CASE_ID)).revision;
  // The reported case: the external draft's key cannot be reused to have the backend write a draft that takes over its approval.
  refused(await submit({ source: "backend_produced" }), "source");
  refused(await submit({ source: "external_draft", text: `${text}!`, companion }), "exact_text");
  refused(await submit({ source: "external_draft", text }), "companion");
  refused(await submit({ source: "external_draft", text, companion }, AGENT), "companion_supplier");
  assert.equal((await store.load(CASE_ID)).revision, revision, "nothing refused was written");
  const replay = await submit({ source: "external_draft", text, companion });
  assert.deepEqual([replay.status, replay.body.replayed, replay.body.artifact.artifact_id], [200, true, first.body.artifact.artifact_id]);

  const input = { type: "client_message", text: "Synthetic message the owner relayed.", idempotencyKey: "route-input" };
  assert.equal((await post(base, "prepare", { caseId: CASE_ID, inputs: [input] })).status, 200);
  refused(await post(base, "prepare", { caseId: CASE_ID, inputs: [input] }, AGENT), "supplied_by");
  refused(await post(base, "prepare", { caseId: CASE_ID, inputs: [{ ...input, text: "Other words." }] }), "text");
  assert.equal((await post(base, "prepare", { caseId: CASE_ID, inputs: [input] })).status, 200, "the owner's own retry is the same input");
});

test("refusals map to fixed statuses and codes that carry reasons but never case content", async (t) => {
  const { store, base } = await startOwnerServer(t);
  const secret = "Synthetic draft text that must stay out of every error.";
  const submitted = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: secret, idempotencyKey: "refusal-1" });
  const artifactId = submitted.body.artifact.artifact_id;
  await store.appendTranscriptTurn(CASE_ID, turn("E3", "user", "Synthetic newer client message.", 3));

  const stale = await post(base, "export", { caseId: CASE_ID, artifactId });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "SUPERVISOR_ARTIFACT_STALE");
  assert.deepEqual(stale.body.reasons, ["newer_client_message"]);
  assert.equal(stale.text.includes(secret), false);

  const missing = await post(base, "export", { caseId: CASE_ID, artifactId: `art_${"0".repeat(40)}` });
  assert.deepEqual([missing.status, missing.body.code], [404, "SUPERVISOR_ARTIFACT_NOT_FOUND"]);
  const unknownCase = await post(base, "export", { caseId: "synthetic-missing-case", artifactId });
  assert.deepEqual([unknownCase.status, unknownCase.body.code], [404, "PRIVATE_CASE_NOT_FOUND"]);
  const conflict = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: "Other bytes under a used key.", idempotencyKey: "refusal-1" });
  assert.deepEqual([conflict.status, conflict.body.code], [409, "SUPERVISOR_IDEMPOTENCY_CONFLICT"]);
  const none = await post(base, "report-sent", { caseId: CASE_ID, idempotencyKey: "refusal-none" });
  assert.deepEqual([none.status, none.body.code], [409, "SUPERVISOR_NO_REPORTABLE_DRAFT"]);
  const badCase = await post(base, "prepare", { caseId: "Not A Valid Id" });
  assert.equal(badCase.status, 400);
  const badBody = await fetch(`${base}/v1/case/supervisor/prepare`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: "[1]" });
  assert.equal(badBody.status, 400);
  const getRoute = await fetch(`${base}/v1/case/supervisor/prepare`);
  assert.equal(getRoute.status, 404, "the supervisor routes answer only POST");
  assert.equal((await store.load(CASE_ID)).communication_events.length, 0, "no refusal recorded an export or a report");
});

test("the owner's channel refuses cross-site, form-encoded, rebound and origin-less requests, so a web page or a bare client cannot forge an owner report", async (t) => {
  const { store, base } = await startOwnerServer(t);
  const submitted = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: "Draft the page tries to report.", idempotencyKey: "csrf-1" });
  const artifactId = submitted.body.artifact.artifact_id;
  await post(base, "export", { caseId: CASE_ID, artifactId });
  const attempt = { caseId: CASE_ID, artifactId, idempotencyKey: "csrf-report" };

  // Past the origin checks, a request that is not JSON is still refused: a simple form post cannot be a supervisor request.
  const plain = await fetch(`${base}/v1/case/supervisor/report-sent`, { method: "POST", headers: { "content-type": "text/plain", origin: base }, body: JSON.stringify(attempt) });
  assert.deepEqual([plain.status, (await plain.json()).code], [415, "SUPERVISOR_UNSUPPORTED_MEDIA_TYPE"], "a simple form post is not JSON");
  const form = await fetch(`${base}/v1/case/supervisor/report-sent`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: "caseId=x" });
  assert.equal(form.status, 415);
  const otherLoopbackName = base.replace("127.0.0.1", "localhost");
  const otherPort = `http://127.0.0.1:${Number(new URL(base).port) + 1}`;
  for (const headers of [
    { origin: "http://evil.example" }, { origin: "null" }, { origin: "https://127.0.0.1" }, { origin: otherLoopbackName }, { origin: otherPort }, { origin: "" }, { origin: `${base}, ${base}` },
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
    // No Origin at all did not come from a page, whatever else it claims.
    { origin: null }, { origin: null, "sec-fetch-site": "same-origin" }, { origin: null, referer: `${base}/` }
  ]) {
    const refused = await post(base, "report-sent", attempt, headers);
    assert.deepEqual([refused.status, refused.body.code], [403, "SUPERVISOR_ORIGIN_REFUSED"], JSON.stringify(headers));
    assert.equal(refused.text.includes("Draft the page tries to report."), false);
  }
  // Every route of the owner's channel needs the Origin, and a refusal writes nothing.
  const eventsBefore = (await store.load(CASE_ID)).communication_events.length;
  const recordBefore = JSON.stringify((await store.load(CASE_ID)).supervisor_artifacts);
  for (const [route, body] of [["prepare", { caseId: CASE_ID, inputs: [{ type: "client_message", text: "Message from a bare client.", idempotencyKey: "bare-input" }] }], ["submit", { caseId: CASE_ID, source: "external_draft", text: "Draft from a bare client.", idempotencyKey: "bare-draft" }], ["export", { caseId: CASE_ID, artifactId }], ["report-sent", attempt]]) {
    const bare = await post(base, route, body, { origin: null });
    assert.deepEqual([bare.status, bare.body.code], [403, "SUPERVISOR_ORIGIN_REFUSED"], `${route} with no Origin`);
  }
  assert.equal((await store.load(CASE_ID)).communication_events.length, eventsBefore, "no refused request recorded an export or a report");
  assert.equal(JSON.stringify((await store.load(CASE_ID)).supervisor_artifacts), recordBefore, "no refused request stored an input or a draft");
  const host = new URL(base);
  const rebound = await new Promise((resolve, reject) => {
    // A rebound page names its own host in both headers, so only the loopback check on the Host can refuse it.
    const request = http.request({ host: host.hostname, port: host.port, path: "/v1/case/supervisor/report-sent", method: "POST", headers: { host: "attacker.example", origin: "http://attacker.example", "content-type": "application/json" } }, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(attempt));
  });
  assert.deepEqual([rebound.status, rebound.body.code], [403, "SUPERVISOR_ORIGIN_REFUSED"], "a rebound host name is not the owner's page");
  assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "reported_sent").length, 0);

  // The headers a browser attaches are all the owner channel can check, so a request that carries them is the owner's channel; a process
  // on this machine that sends them on purpose cannot be told apart from the page (the documented boundary of "owner_verified").
  const sameOrigin = await post(base, "report-sent", attempt, { origin: base, "sec-fetch-site": "same-origin" });
  assert.equal(sameOrigin.status, 200, "the application's own page is accepted");
  assert.equal(sameOrigin.body.event.provenance.actor_resolution, "owner_verified");
});

test("a request with its own bearer token is an agent, needs no Origin and is not held to the owner channel's browser checks", async (t) => {
  const { store, base } = await startGovernedServer(t);
  const submitted = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: "Draft an agent reports on.", idempotencyKey: "agent-origin-1" });
  const artifactId = submitted.body.artifact.artifact_id;
  await post(base, "export", { caseId: CASE_ID, artifactId });
  const bare = await post(base, "report-sent", { caseId: CASE_ID, artifactId, idempotencyKey: "agent-origin-report" }, AGENT);
  assert.equal(bare.status, 200, "an agent is not a browser and sends no Origin");
  assert.deepEqual([bare.body.event.provenance.origin, bare.body.event.provenance.actor_resolution], ["agent_relayed", "unresolved"]);
  const forged = await post(base, "report-sent", { caseId: CASE_ID, artifactId, idempotencyKey: "agent-origin-report" }, { ...AGENT, origin: "http://evil.example" });
  assert.equal(forged.status, 200, "and a page-like header on an agent's request is no reason to refuse it, or to trust it more");
  assert.equal(forged.body.event.provenance.actor_resolution, "unresolved");
  assert.equal((await store.load(CASE_ID)).communication_events.filter((event) => event.kind === "reported_sent").length, 1, "the second call replayed the first");
});

test("through the server, an authenticated agent keeps the weaker origin and revoked access stops a new export", async (t) => {
  const { store, base, revoked } = await startGovernedServer(t);
  const submitted = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: "Draft handled by the owner and an agent.", idempotencyKey: "governed-1" });
  assert.equal(submitted.status, 200);
  const artifactId = submitted.body.artifact.artifact_id;

  const agentExport = await post(base, "export", { caseId: CASE_ID, artifactId }, AGENT);
  assert.equal(agentExport.status, 200);
  // Whatever an agent writes in its request about who it is, the server decides from how the request was authenticated.
  const claimsOwner = { channel: "owner_ui", ownerChannel: true, origin: "owner_action", actor_resolution: "owner_verified" };
  const claimed = await post(base, "report-sent", { caseId: CASE_ID, artifactId, ...claimsOwner, quote: "The owner said they sent it.", idempotencyKey: "governed-agent-report" }, AGENT);
  assert.equal(claimed.status, 200);
  assert.deepEqual([claimed.body.event.provenance.origin, claimed.body.event.provenance.actor_resolution], ["agent_relayed", "unresolved"], "an agent's own bearer does not make it the owner");
  const relayedInput = await post(base, "prepare", { caseId: CASE_ID, ...claimsOwner, inputs: [{ type: "client_message", text: "Message an agent relayed.", idempotencyKey: "governed-input", channel: "owner_ui" }] }, AGENT);
  assert.deepEqual([relayedInput.body.owner_supplied_inputs[0].supplied_by.channel, relayedInput.body.owner_supplied_inputs[0].supplied_by.actor_resolution], ["authenticated_agent", "unresolved"]);
  const agentDraft = await post(base, "submit", { caseId: CASE_ID, ...claimsOwner, source: "external_draft", text: "A draft with a companion from an agent.", companion: { language: "en", text: "Agent English companion." }, idempotencyKey: "governed-agent-draft" }, AGENT);
  assert.equal(agentDraft.status, 200);
  const stored = await store.load(CASE_ID);
  assert.deepEqual(stored.supervisor_artifacts.find((entry) => entry.kind === "companion").supplied_by, { channel: "authenticated_agent", actor_resolution: "unresolved" });
  const agentDraftExport = await post(base, "export", { caseId: CASE_ID, artifactId: agentDraft.body.artifact.artifact_id, ...claimsOwner }, AGENT);
  assert.equal(agentDraftExport.status, 200);
  const exportEvent = (await store.load(CASE_ID)).communication_events.find((event) => event.id === `evt:export:${agentDraft.body.artifact.artifact_id.slice(4)}`);
  assert.equal(exportEvent.provenance.source_ref, "supervisor:export:authenticated_agent", "the export records who asked for it from the authenticated channel");

  const ownerDraft = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: "A newer draft the owner exports.", idempotencyKey: "governed-2" });
  const ownerArtifact = ownerDraft.body.artifact.artifact_id;
  const ownerReport = await (async () => {
    await post(base, "export", { caseId: CASE_ID, artifactId: ownerArtifact });
    return post(base, "report-sent", { caseId: CASE_ID, artifactId: ownerArtifact, idempotencyKey: "governed-owner-report" });
  })();
  assert.deepEqual([ownerReport.body.event.provenance.origin, ownerReport.body.event.provenance.actor_resolution], ["owner_action", "owner_verified"], "the app's own request rides on the server's authorization");

  // Revoking the server's own authorization stops the owner's new exports; another principal is unaffected.
  const third = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: "A third draft, exported after a revocation.", idempotencyKey: "governed-3" });
  const thirdArtifact = third.body.artifact.artifact_id;
  revoked.add("owner-token");
  const denied = await post(base, "export", { caseId: CASE_ID, artifactId: thirdArtifact });
  assert.deepEqual([denied.status, denied.body.code], [403, "PRIVATE_CASE_ACCESS_DENIED"]);
  assert.equal(denied.text.includes("A third draft"), false);
  const before = (await store.load(CASE_ID)).communication_events.length;
  const unknownToken = await post(base, "export", { caseId: CASE_ID, artifactId: thirdArtifact }, { authorization: "Bearer someone-else" });
  assert.equal(unknownToken.status, 403);
  assert.equal((await store.load(CASE_ID)).communication_events.length, before, "a denied export records nothing");
  const stillAllowed = await post(base, "export", { caseId: CASE_ID, artifactId: thirdArtifact }, AGENT);
  assert.equal(stillAllowed.status, 200);
  revoked.add("agent-token");
  assert.equal((await post(base, "export", { caseId: CASE_ID, artifactId: thirdArtifact }, AGENT)).status, 403, "and revoking that principal stops it too, even for a replay");
});

test("the server without private storage answers the supervisor routes as unavailable instead of inventing a store", async (t) => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const server = createInnerSignalServer({ config, providers: createProviders(config) });
  const base = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await post(base, "prepare", { caseId: CASE_ID });
  assert.deepEqual([result.status, result.body.code], [503, "PRIVATE_CASE_STORAGE_UNAVAILABLE"]);
});

test("the owner panel is served with the page, under the page's content security policy, with no inline script, style or markup parsing", async (t) => {
  const { base } = await startOwnerServer(t);
  const page = await fetch(`${base}/`);
  const html = await page.text();
  assert.match(html, /data-tab="supervisor"/);
  assert.match(html, /id="supervisor"/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/iu, "no inline script");
  assert.doesNotMatch(html, /\sstyle=|\sonclick=|\sonsubmit=/iu, "no inline style or handler");
  const script = await fetch(`${base}/supervisor-panel.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /^text\/javascript/);
  assert.match(script.headers.get("content-security-policy"), /script-src 'self'/);
  const source = await script.text();
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|indexedDB/u);
  assert.match(await (await fetch(`${base}/app.js`)).text(), /initSupervisorPanel/);
});

test("the copy action asks the server for the approved bytes and puts exactly those on the clipboard", async (t) => {
  const { base } = await startOwnerServer(t);
  const approved = "Exact approved words.\n\n  Keep   these   spaces.\n";
  const submitted = await post(base, "submit", { caseId: CASE_ID, source: "external_draft", text: approved, idempotencyKey: "copy-1" });
  const artifactId = submitted.body.artifact.artifact_id;
  const { fetchImpl, calls } = browserFetch(base);
  const call = (kind, body) => callSupervisor(fetchImpl, kind, body);
  const written = [];
  const clipboard = { async writeText(value) { written.push(value); } };
  const { copied, exported } = await copyApprovedText({ call, clipboard, caseId: CASE_ID, artifactId, text: "Edited words that were never approved.", exactText: "Edited words that were never approved." });
  assert.equal(copied, true);
  assert.deepEqual(written, [approved]);
  assert.equal(exported.client_text, approved);

  const blocked = await copyApprovedText({ call, clipboard: { async writeText() { throw new Error("denied"); } }, caseId: CASE_ID, artifactId });
  assert.equal(blocked.copied, false);
  assert.equal(blocked.exported.client_text, approved, "when the browser blocks the clipboard the exact text is handed back for a manual copy");

  await assert.rejects(() => copyApprovedText({ call, clipboard, caseId: CASE_ID, artifactId: `art_${"1".repeat(40)}` }), (error) => error.code === "SUPERVISOR_ARTIFACT_NOT_FOUND" && error.status === 404);
  assert.deepEqual(written, [approved], "a refused export puts nothing on the clipboard");
  assert.ok(calls.length >= 3 && calls.every((entry) => entry.method === "POST" && entry.mode === undefined), "every call the panel makes is a POST in the default fetch mode, which is what carries the page's Origin");

  // Without the Origin a browser would have added, the same action is refused by the server and nothing reaches the clipboard.
  const bareCall = (kind, body) => callSupervisor((url, init) => fetch(`${base}${url}`, init), kind, body);
  await assert.rejects(() => copyApprovedText({ call: bareCall, clipboard, caseId: CASE_ID, artifactId }), (error) => error.code === "SUPERVISOR_ORIGIN_REFUSED" && error.status === 403);
  assert.deepEqual(written, [approved]);
});

test("the real panel in a browser DOM copies only the server's approved bytes, keeps the companion read-only and reports a send as the owner", async (t) => {
  const { base, store } = await startOwnerServer(t);
  const { fetchImpl, calls } = browserFetch(base);
  const html = await fs.readFile(path.join(repositoryRoot, "apps/web/index.html"), "utf8");
  const dom = new JSDOM(html, { url: `${base}/`, pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const { initSupervisorPanel } = await import("../apps/web/supervisor-panel.js");
  const written = [];
  let keyCounter = 0;
  dom.window.confirm = () => true;
  globalThis.confirm = () => true;
  t.after(() => { delete globalThis.confirm; });
  initSupervisorPanel({
    document,
    getCaseId: () => CASE_ID,
    fetchImpl,
    clipboard: { async writeText(value) { written.push(value); } },
    newKey: () => `key-${keyCounter += 1}`
  });
  const settle = async (predicate) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`The panel did not settle: ${document.getElementById("supervisor-status").textContent}`);
  };
  const submitForm = (id) => document.getElementById(id).dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  const click = (node) => node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  document.querySelector('[data-tab="supervisor"]').click();
  await settle(() => document.getElementById("supervisor-client-message").textContent.includes("newest client message"));

  document.getElementById("supervisor-input-type").value = "client_message";
  document.getElementById("supervisor-input-text").value = "Synthetic message relayed from another app.";
  submitForm("supervisor-input-form");
  await settle(() => document.getElementById("supervisor-inputs").textContent.includes("relayed from another app"));
  assert.match(document.getElementById("supervisor-inputs").textContent, /from you/);

  const approved = "Reviewed words, exactly as approved.";
  document.getElementById("supervisor-draft-text").value = approved;
  document.getElementById("supervisor-companion-text").value = "English meaning for the supervisor.";
  submitForm("supervisor-draft-form");
  await settle(() => document.querySelectorAll("#supervisor-artifacts .supervisor-artifact").length === 1);
  const item = document.querySelector("#supervisor-artifacts .supervisor-artifact");
  assert.match(item.textContent, /Approved and current/);
  assert.match(item.textContent, /not attested/);
  assert.equal(item.textContent.includes(approved), false, "the list shows no client text before a copy");
  assert.equal(item.textContent.includes("English meaning"), false);

  // Whatever is typed in the page afterwards, the copy is of what was approved.
  document.getElementById("supervisor-draft-text").value = "Words typed into the page after approval.";
  const copy = [...item.querySelectorAll("button")].find((button) => button.textContent === "Copy approved text");
  assert.equal(copy.disabled, false);
  click(copy);
  await settle(() => written.length === 1);
  assert.deepEqual(written, [approved]);
  await settle(() => document.querySelector("#supervisor-artifacts .supervisor-output")?.textContent.includes("English meaning"));
  const output = document.querySelector("#supervisor-artifacts .supervisor-output");
  assert.match(output.textContent, /never to be sent/);
  assert.equal(output.querySelector("button"), null, "the companion has no copy or send action");

  const sent = [...document.querySelectorAll("#supervisor-artifacts button")].find((button) => button.textContent === "I sent this");
  assert.ok(sent, "after a copy the owner can report a send");
  click(sent);
  await settle(() => /You reported sending it/.test(document.getElementById("supervisor-artifacts").textContent));
  const record = await store.load(CASE_ID);
  const report = record.communication_events.find((event) => event.kind === "reported_sent");
  assert.deepEqual([report.provenance.origin, report.provenance.actor_resolution, report.sent_at_status], ["owner_action", "owner_verified", "unavailable"]);
  assert.equal(record.supervisor_artifacts.filter((entry) => entry.kind === "input").length, 1);
  // The whole flow ran through what a browser sends: the panel only POSTs, in the default fetch mode, so each request carried the page's Origin.
  assert.ok(calls.length >= 6);
  assert.deepEqual([...new Set(calls.map((entry) => entry.method))], ["POST"]);
  assert.deepEqual([...new Set(calls.map((entry) => entry.mode))], [undefined], "the panel asks for no fetch mode, so it is never no-cors or same-origin");
});

test("a stale or unapproved draft is described in plain words and offers no copy", () => {
  const base = { artifact_id: `art_${"2".repeat(40)}`, status: "approved_for_delivery", source: "external_draft", approved: true, fresh: true, exportable: true, stale_reasons: [], not_approved_reasons: [], delivery: { exported: null, reported_sent: null }, companion: null };
  assert.equal(describeArtifact(base).tone, "ready");
  const stale = describeArtifact({ ...base, fresh: false, exportable: false, stale_reasons: ["newer_client_message"] });
  assert.equal(stale.tone, "stale");
  assert.deepEqual(stale.reasons, ["The client has written again since this draft."]);
  assert.equal(describeArtifact({ ...base, status: "audit_failed", approved: false, fresh: true, exportable: false, not_approved_reasons: ["audit_failed"] }).tone, "blocked");
  assert.equal(describeArtifact({ ...base, status: "pending_audit", approved: false, exportable: false, not_approved_reasons: ["audit_not_passed"] }).tone, "pending");
  assert.equal(describeArtifact({ ...base, status: "superseded", approved: false, fresh: false, exportable: false, stale_reasons: ["superseded_by_newer_draft"] }).tone, "replaced");
  const relayed = describeArtifact({ ...base, delivery: { exported: {}, reported_sent: { actor_resolution: "unresolved" } } });
  assert.match(relayed.delivery.join(" "), /not confirmed as yours/);
});
