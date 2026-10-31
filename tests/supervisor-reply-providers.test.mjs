import test from "node:test";
import assert from "node:assert/strict";
import { createProviders } from "../src/providers/factory.mjs";
import { buildSupervisorReviewRuntime, createSupervisorReplyConnector } from "../src/server/supervisor-reply-setup.mjs";
import { SUPERVISOR_REPLY_TOOL_DEFINITIONS } from "../src/server/supervisor-reply-tools.mjs";
import { CASE_ID, makeReplyEnvironment, scriptedProvider, serveReplyTools } from "./fixtures/supervisor-reply-environment.mjs";

// Which keys the reply-draft review needs. The reviewer and the repair are Anthropic's, so a draft someone else wrote is reviewed
// with an Anthropic key alone; a draft InnerSignal writes itself also needs the OpenAI key. These tests build the connector the way
// the hosted server does, from settings, with the real configuration and the real provider factory, over a real access service
// and store. The one thing scripted is the model: the two services' network addresses are answered here, so the providers, the
// choice of models and everything the review stores or approves are the product's own. Synthetic data only; the keys are made up.

const SETTING = "INNER_SIGNAL_MCP_SUPERVISOR_DRAFTS";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const ANTHROPIC_KEY = "synthetic-anthropic-key-not-real";
const OPENAI_KEY = "synthetic-openai-key-not-real";
const API = Object.freeze({ INNER_SIGNAL_MODE: "api", ACKNOWLEDGE_PROVIDER_RETENTION: "true" });
// Every setting that changes which models or how many attempts the review uses. A test sets the ones it means; the rest are cleared,
// whatever the developer's shell holds.
const CONTROLLED = ["INNER_SIGNAL_MODE", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ACKNOWLEDGE_PROVIDER_RETENTION", "OPENAI_MODEL", "ANTHROPIC_MODEL",
  "RESPONSE_RENDERER_MODEL", "PRIVATE_RUNTIME_INVOCATION_ATTEMPTS", "REQUEST_TIMEOUT_MS", "ALLOW_CLAUDE_FABLE_USAGE", SETTING];

function setEnvironment(t, values) {
  const original = Object.fromEntries(CONTROLLED.map((key) => [key, process.env[key]]));
  for (const key of CONTROLLED) delete process.env[key];
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// The two model services at the network edge. An audit answers what `verdicts` say, in turn; a repair answers a synthetic repair;
// any other request to Anthropic (the step that writes a draft) fails as an outage would, which shows it was reached without a
// whole pipeline being scripted. Every request is recorded with the key it carried and the model it asked for. Addresses other
// than the two services go through untouched, which is how the test talks to its own connector.
function modelServices(t, { verdicts = ["pass"] } = {}) {
  const requests = [];
  const counts = { audit: 0, repair: 0, other: 0, openai: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== ANTHROPIC_URL && url !== OPENAI_URL) return realFetch(input, init);
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    if (url === OPENAI_URL) {
      counts.openai += 1;
      requests.push({ url, stage: "openai", key: headers.get("authorization"), model: body.model });
      return Response.json({ error: { type: "api_error", message: "synthetic outage" } }, { status: 500 });
    }
    const prompt = body.messages[0].content;
    const stage = prompt.startsWith("AUTHORIZED AUDIT PACKET\n") ? "audit" : prompt.startsWith("AUTHORIZED REPAIR PACKET\n") ? "repair" : "other";
    counts[stage] += 1;
    requests.push({ url, stage, key: headers.get("x-api-key"), model: body.model });
    if (stage === "other") return Response.json({ error: { type: "api_error", message: "synthetic outage" } }, { status: 500 });
    const id = `msg_synthetic_${requests.length}`;
    let text;
    if (stage === "audit") {
      const packet = JSON.parse(prompt.slice("AUTHORIZED AUDIT PACKET\n".length));
      const verdict = verdicts[counts.audit - 1] ?? verdicts.at(-1);
      text = JSON.stringify({
        findings: verdict === "pass" ? [] : [{ id: `finding:${counts.audit}`, code: "SYNTHETIC_UNCERTAINTY", severity: "substantive", summary: "Synthetic repair is required." }],
        repair_induced_checks: packet.repair_induced_error_checks
      });
    } else {
      text = JSON.stringify({ exact_text: `Synthetic repaired reply ${counts.repair}.` });
    }
    return Response.json(
      { id, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
      { headers: { "request-id": `req_${id}` } }
    );
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return { requests, counts, stages: () => requests.map((request) => request.stage) };
}

// The connector as the hosted server builds it: from settings, with the real configuration and provider factory. `built` records
// what the factory built, so a test can see which providers exist.
async function hostedConnector(t, settings, { verdicts } = {}) {
  setEnvironment(t, { [SETTING]: "true", ...settings });
  const env = await makeReplyEnvironment(t, { withTools: false });
  const services = modelServices(t, { verdicts });
  const events = [];
  const built = [];
  const tools = await createSupervisorReplyConnector({
    access: env.access,
    environment: process.env,
    runnerOptions: { budgetMs: 5_000, cooldownMs: 0 },
    log: (event) => events.push(event),
    createProvidersFn: (config, options) => {
      const providers = createProviders(config, options);
      built.push(providers);
      return providers;
    }
  });
  const served = await serveReplyTools(t, { access: env.access, tools });
  return { env, tools, services, events, built, ...served };
}

const REPAIRED_ONCE = ["audit", "repair", "audit"];

// A draft someone else wrote, found wanting once, repaired, and approved; then the exact approved words exported.
async function reviewAnExternalDraft(rig, key) {
  const submitted = await rig.submit({ text: "Synthetic outside reply.", idempotency_key: key });
  assert.equal(submitted.status, "approved");
  assert.equal(submitted.exportable, true);
  assert.equal(submitted.artifact.root_source, "external_draft");
  assert.equal(submitted.artifact.review.repair_cycle, 1);
  const exported = await rig.ok("export_approved_reply", { case_id: CASE_ID, artifact_id: submitted.artifact.artifact_id });
  assert.equal(exported.client_text, "Synthetic repaired reply 1.");
  return submitted;
}

test("with only an Anthropic key, a draft someone else wrote is reviewed, repaired and approved, and no OpenAI provider is built or called", async (t) => {
  const rig = await hostedConnector(t, { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY }, { verdicts: ["fail", "pass"] });
  assert.equal(rig.tools.reviewAvailable, true);
  assert.equal(rig.tools.backendDraftsAvailable, false);
  assert.deepEqual(rig.events, [{ event: "supervisor_review", available: true, reason: null, backend_drafts: false }]);
  assert.deepEqual(rig.built.map((providers) => Object.keys(providers)), [["anthropic", "renderer"]], "only the Anthropic providers were built");

  await reviewAnExternalDraft(rig, "key-anthropic-only");
  assert.deepEqual(rig.services.stages(), REPAIRED_ONCE, "the draft was audited, repaired and audited again, by the model service and nothing else");
  assert.ok(rig.services.requests.every((request) => request.url === ANTHROPIC_URL && request.key === ANTHROPIC_KEY), "every request went to Anthropic with the Anthropic key");
  assert.equal(rig.services.counts.openai, 0, "OpenAI was never called");
  const record = await rig.env.reload();
  assert.equal(record.candidate_responses.filter((candidate) => candidate.status === "approved_for_delivery").length, 1);
});

test("with only an Anthropic key, asking InnerSignal to write the draft is refused before anything is stored or any model is asked, and says why in plain words", async (t) => {
  const rig = await hostedConnector(t, { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY });
  const before = await rig.env.fingerprint();
  const answer = await rig.call("submit_reply_draft", { case_id: CASE_ID, source: "backend_produced", idempotency_key: "key-backend-only-anthropic" });
  assert.equal(answer.status, 200);
  assert.equal(answer.isError, true);
  assert.equal(answer.structured.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  assert.deepEqual(answer.structured.reasons, ["backend_drafts_need_openai_key"]);
  assert.match(answer.text, /only on a deployment that has an OpenAI key as well as an Anthropic one/u);
  assert.match(answer.text, /external_draft/u, "it says what can be done instead");
  assert.equal(rig.services.requests.length, 0, "no model was asked");
  assert.equal(await rig.env.fingerprint(), before, "nothing was stored: no draft, no candidate, no event");

  // A caller without the permission is turned away at sign-in and learns nothing about how the deployment is configured.
  const withoutPermission = await rig.call("submit_reply_draft", { case_id: CASE_ID, source: "backend_produced", idempotency_key: "key-no-permission" }, "token-read-audit");
  assert.equal(withoutPermission.status, 401);
  assert.doesNotMatch(JSON.stringify(withoutPermission.body), /OpenAI|backend_drafts_need_openai_key/u);

  // The tool's own description says the same, so a caller knows before it asks.
  const description = (await rig.list()).find((tool) => tool.name === "submit_reply_draft").description;
  assert.match(description, /only on a deployment that has an OpenAI key as well as an Anthropic one/u);
  assert.match(description, /only the Anthropic key backend_produced is refused with SUPERVISOR_REVIEW_UNAVAILABLE and nothing is stored/u);
  assert.equal(description, SUPERVISOR_REPLY_TOOL_DEFINITIONS.find((tool) => tool.name === "submit_reply_draft").description);

  // Nothing else is switched off: the case can be read, and a draft someone else wrote is still taken for review.
  assert.ok(await rig.ok("get_reply_draft_context", { case_id: CASE_ID }));
  const external = await rig.call("submit_reply_draft", { case_id: CASE_ID, source: "external_draft", text: "Synthetic outside reply.", idempotency_key: "key-external-after" });
  assert.notEqual(external.structured?.code, "SUPERVISOR_REVIEW_UNAVAILABLE", "an external draft is not refused for the missing OpenAI key");
});

test("in the Anthropic-only setup the models are the API-mode defaults, which is why a deploy should set ANTHROPIC_MODEL", async (t) => {
  const rig = await hostedConnector(t, { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY }, { verdicts: ["fail", "pass"] });
  await reviewAnExternalDraft(rig, "key-default-models");
  assert.deepEqual(rig.services.requests.map((request) => [request.stage, request.model]), [
    ["audit", "claude-fable-5"],
    ["repair", "claude-opus-5"],
    ["audit", "claude-fable-5"]
  ], "unset, the reviewer is claude-fable-5 and the repair is claude-opus-5");
});

test("in the Anthropic-only setup ANTHROPIC_MODEL, once set, is the model of the reviewer and of the repair", async (t) => {
  const rig = await hostedConnector(t, { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY, ANTHROPIC_MODEL: "claude-synthetic-explicit" }, { verdicts: ["fail", "pass"] });
  await reviewAnExternalDraft(rig, "key-explicit-model");
  assert.deepEqual(rig.services.requests.map((request) => [request.stage, request.model]), [
    ["audit", "claude-synthetic-explicit"],
    ["repair", "claude-synthetic-explicit"],
    ["audit", "claude-synthetic-explicit"]
  ]);
});

test("with only an OpenAI key the review stays unavailable, because the reviewer is Anthropic's: nothing is built, called or stored", async (t) => {
  const rig = await hostedConnector(t, { ...API, OPENAI_API_KEY: OPENAI_KEY });
  assert.equal(rig.tools.reviewAvailable, false);
  assert.equal(rig.tools.backendDraftsAvailable, false);
  assert.deepEqual(rig.events, [{ event: "supervisor_review", available: false, reason: "BAD_CONFIG", backend_drafts: false }]);
  assert.deepEqual(rig.built, [], "no provider was built, not even an OpenAI one");
  const before = await rig.env.fingerprint();
  for (const [source, extra] of [["external_draft", { text: "Synthetic outside reply." }], ["backend_produced", {}]]) {
    const answer = await rig.call("submit_reply_draft", { case_id: CASE_ID, source, idempotency_key: `key-openai-only-${source}`, ...extra });
    assert.equal(answer.isError, true, `${source} is refused`);
    assert.equal(answer.structured.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
    assert.equal(answer.structured.reasons, undefined, "the plain refusal, without the OpenAI-key reason");
    assert.doesNotMatch(answer.text, /OpenAI/u);
  }
  assert.equal(rig.services.requests.length, 0, "no model was asked");
  assert.equal(await rig.env.fingerprint(), before, "nothing was stored");
  assert.ok(await rig.ok("get_reply_draft_context", { case_id: CASE_ID }), "the case can still be read");
});

test("with both keys everything works as it did: Anthropic reviews, and InnerSignal's own drafting is attempted", async (t) => {
  const rig = await hostedConnector(t, { ...API, OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY, PRIVATE_RUNTIME_INVOCATION_ATTEMPTS: "1" }, { verdicts: ["fail", "pass"] });
  assert.equal(rig.tools.reviewAvailable, true);
  assert.equal(rig.tools.backendDraftsAvailable, true);
  assert.deepEqual(rig.events, [{ event: "supervisor_review", available: true, reason: null, backend_drafts: true }]);
  assert.deepEqual(rig.built.map((providers) => Object.keys(providers)), [["openai", "anthropic", "renderer"]]);
  assert.equal(rig.built[0].openai.apiKey, OPENAI_KEY);
  assert.equal(rig.built[0].anthropic.apiKey, ANTHROPIC_KEY);

  await reviewAnExternalDraft(rig, "key-both-keys");
  assert.deepEqual(rig.services.stages(), REPAIRED_ONCE);
  assert.ok(rig.services.requests.every((request) => request.url === ANTHROPIC_URL && request.key === ANTHROPIC_KEY), "reviewing a draft still uses Anthropic alone");
  assert.equal(rig.services.counts.openai, 0);

  // InnerSignal's own drafting is not refused up front. It starts (the model service sees the first step of the writing pipeline),
  // fails here because the model is only an outage, and then stores nothing and approves nothing.
  const before = await rig.env.fingerprint();
  const answer = await rig.call("submit_reply_draft", { case_id: CASE_ID, source: "backend_produced", idempotency_key: "key-both-backend" });
  assert.equal(answer.isError, true);
  assert.equal(answer.structured.code, "SUPERVISOR_REVIEW_UNAVAILABLE");
  assert.equal(answer.structured.reasons, undefined, "not the missing-key refusal");
  assert.ok(rig.services.counts.other >= 1, "the step that writes a draft was reached");
  assert.equal(await rig.env.fingerprint(), before, "a drafting step that failed stored nothing");
});

test("a key that is blank counts as no key: no OpenAI provider is built from it", async (t) => {
  for (const blank of ["", "   "]) {
    await t.test(`an OpenAI key of ${JSON.stringify(blank)}`, async (sub) => {
      const rig = await hostedConnector(sub, { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: blank });
      assert.equal(rig.tools.reviewAvailable, true);
      assert.equal(rig.tools.backendDraftsAvailable, false);
      assert.deepEqual(rig.built.map((providers) => Object.keys(providers)), [["anthropic", "renderer"]]);
    });
  }
});

test("the setup asks for the Anthropic providers alone only when it has an Anthropic key and no OpenAI key, in api mode", async () => {
  const provider = scriptedProvider();
  const source = {};
  const run = async (environment) => {
    const calls = [];
    const built = await buildSupervisorReviewRuntime({
      environment,
      source,
      loadConfigFn: (...args) => { calls.push(["loadConfig", ...args]); return { privateRuntimeInvocationAttempts: 2 }; },
      createProvidersFn: (...args) => { calls.push(["createProviders", ...args.slice(1)]); return { anthropic: provider, renderer: provider }; }
    });
    return { calls, built };
  };
  const anthropicOnly = [["loadConfig", {}, { providers: ["anthropic"] }], ["createProviders", { providers: ["anthropic"] }]];
  const defaults = [["loadConfig"], ["createProviders"]];
  const cases = [
    ["api, Anthropic key only", { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY }, anthropicOnly, false],
    ["api, Anthropic key and a blank OpenAI key", { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: "  " }, anthropicOnly, false],
    ["api, both keys", { ...API, ANTHROPIC_API_KEY: ANTHROPIC_KEY, OPENAI_API_KEY: OPENAI_KEY }, defaults, true],
    ["api, OpenAI key only", { ...API, OPENAI_API_KEY: OPENAI_KEY }, defaults, true],
    ["api, no key", { ...API }, defaults, true],
    ["cli, which holds no keys", { INNER_SIGNAL_MODE: "cli", ANTHROPIC_API_KEY: ANTHROPIC_KEY }, defaults, true]
  ];
  for (const [label, environment, expectedCalls, drafts] of cases) {
    const { calls, built } = await run(environment);
    assert.deepEqual(calls, expectedCalls, label);
    assert.equal(built.backendDrafts, drafts, label);
    assert.equal(typeof built.runtime.auditCandidate, "function", label);
    assert.equal(typeof built.runtime.repairCandidate, "function", label);
    assert.equal(typeof built.runtime.produceCandidate, drafts ? "function" : "undefined", `${label}: a runtime without the OpenAI providers cannot write a draft`);
  }
});

test("the provider factory builds the providers it is asked for, and by default all of them", () => {
  const config = { mode: "api", openaiApiKey: OPENAI_KEY, anthropicApiKey: ANTHROPIC_KEY, openaiModel: "m-openai", anthropicModel: "m-anthropic", responseRendererModel: "m-renderer", requestTimeoutMs: 1_000, maxOutputTokens: 100 };
  assert.deepEqual(Object.keys(createProviders(config)), ["openai", "anthropic", "renderer"], "by default, as before");
  assert.deepEqual(Object.keys(createProviders(config, { providers: ["openai", "anthropic"] })), ["openai", "anthropic", "renderer"]);
  const anthropic = createProviders({ ...config, openaiApiKey: "" }, { providers: ["anthropic"] });
  assert.deepEqual(Object.keys(anthropic), ["anthropic", "renderer"], "no OpenAI provider exists, and none was made from an empty key");
  assert.equal(anthropic.renderer.model, "m-renderer");
  assert.deepEqual(Object.keys(createProviders({ ...config, anthropicApiKey: "" }, { providers: ["openai"] })), ["openai"]);
  assert.deepEqual(Object.keys(createProviders(config, { providers: [] })), []);
  for (const mode of ["mock", "cli"]) {
    assert.deepEqual(Object.keys(createProviders({ ...config, mode }, { providers: ["anthropic"] })), ["openai", "anthropic", "renderer"], `${mode} holds no keys, so it builds both`);
  }
});
