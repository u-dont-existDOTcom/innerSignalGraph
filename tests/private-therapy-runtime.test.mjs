import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";

const CASE_ID = "synthetic-runtime-case";
const NOW = "2026-09-10T18:00:00.000Z";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listenServer(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function stateFor(userTurnId) {
  return applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    current_episode: {
      id: "episode:runtime:synthetic",
      target: "Distinguish two synthetic possibilities.",
      route: "SYNTHETIC.RUNTIME",
      prediction: "The next exact observation will discriminate.",
      next_question: "Which synthetic signal changed first?",
      started_turn_id: userTurnId,
      constitutional_aim_ids: ["CARE"],
      adverse_signs: ["less choice"],
      stay_conditions: ["new information"],
      switch_conditions: ["no information"],
      stop_conditions: ["decline"],
      source_item_ids: []
    }
  });
}

async function makeStore(t, { rootDir = null } = {}) {
  const privateRoot = rootDir ?? await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-private-runtime-"));
  const create = () => createEncryptedPrivateCaseStore({
    rootDir: privateRoot,
    routineKek: Buffer.alloc(32, 71),
    recoverySecretBytes: Buffer.alloc(32, 72),
    developmentExternalCredentialAuthorized: true,
    now: () => NOW
  });
  const store = create();
  if (!rootDir) t.after(async () => { await fs.rm(privateRoot, { recursive: true, force: true }); });
  return { store, create, rootDir: privateRoot };
}

function input(suffix = "one") {
  return {
    caseId: CASE_ID,
    runtimeTurnId: `runtime:synthetic:${suffix}`,
    exchangeId: `exchange:synthetic:${suffix}`,
    userTurnId: `turn:synthetic:${suffix}:user`,
    assistantTurnId: `turn:synthetic:${suffix}:assistant`,
    userMessage: `  Exact synthetic inbound ${suffix}.  `,
    userInput: { processingMode: "fast" }
  };
}

function scriptedRuntime({ verdicts = ["pass"], auditFailure = null, reuseContext = false } = {}) {
  const calls = [];
  let auditIndex = 0;
  let repairIndex = 0;
  const runtime = {
    calls,
    async produceCandidate({ runtimeTurn, attemptContextId }) {
      calls.push({ role: "candidate", attemptContextId });
      return {
        exactText: "Synthetic candidate v1.\n\nWhich part is most observable?",
        contextId: "context:producer:v1",
        caseState: stateFor(runtimeTurn.user_turn_id),
        stateDiff: { schema_version: 1, additions: [], current_episode_changed: true },
        result: { producerAttemptContextId: attemptContextId }
      };
    },
    async auditCandidate({ candidate, attemptContextId }) {
      calls.push({ role: "audit", candidateId: candidate.id, attemptContextId });
      if (auditFailure) throw auditFailure;
      const verdict = verdicts[auditIndex++] ?? verdicts.at(-1);
      return {
        contextId: reuseContext ? candidate.producer_context_id : `context:auditor:v${candidate.repair_cycle + 1}`,
        value: {
          findings: verdict === "pass" ? [] : [{ id: `finding:v${candidate.repair_cycle + 1}`, code: "SYNTHETIC_UNCERTAINTY", severity: "substantive", summary: "Synthetic repair is required." }],
          repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...REPAIR_INDUCED_ERROR_CHECKS]
        },
        disclosureManifest: { producer_hidden_reasoning_included: false, producer_trace_included: false }
      };
    },
    async repairCandidate({ candidate, attemptContextId }) {
      repairIndex += 1;
      calls.push({ role: "repair", parentId: candidate.id, attemptContextId });
      return { exactText: `Synthetic repaired candidate v${repairIndex + 1}.`, contextId: `context:repair:v${repairIndex + 1}` };
    },
    async produceDiscriminator({ attemptContextId }) {
      calls.push({ role: "discriminator", attemptContextId });
      return { exactText: "Which synthetic signal changed first?", contextId: "context:discriminator:final" };
    }
  };
  return runtime;
}

function states(runtimeTurn) {
  return runtimeTurn.events.filter((event) => event.event_type === "STATE_TRANSITION").map((event) => event.to_state);
}

test("one inbound turn automatically reaches exact independently approved delivery", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime();
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime });
  const request = input("pass");
  const result = await controller.run(request);
  const record = await store.load(CASE_ID);
  const runtimeTurn = record.runtime_turns[0];
  const candidate = record.candidate_responses[0];

  assert.equal(result.answer, candidate.exact_text);
  assert.equal(result.deliveryKind, "candidate");
  assert.deepEqual(states(runtimeTurn), ["RECEIVED", "CANDIDATE_PENDING_AUDIT", "AUDITING", "APPROVED", "DELIVERED"]);
  assert.equal(candidate.status, "sent");
  assert.notEqual(candidate.producer_context_id, candidate.audit_history[0].auditor_context_id);
  assert.equal(candidate.metadata.approval_audit_id, candidate.audit_history[0].id);
  assert.equal(candidate.metadata.sent_with_audit_id, candidate.audit_history[0].id);
  assert.equal(record.raw_transcript[0].text, request.userMessage);
  assert.equal(record.raw_transcript[1].text, candidate.exact_text);
  assert.equal(runtimeTurn.delivery.exact_text, candidate.exact_text);
  assert.deepEqual(modelRuntime.calls.map((entry) => entry.role), ["candidate", "audit"]);

  const replay = await controller.run(request);
  assert.equal(replay.answer, result.answer);
  assert.equal((await store.load(CASE_ID)).raw_transcript.length, 2);
  assert.equal(modelRuntime.calls.length, 2, "durable replay must not invoke models again");
});

test("substantive failure automatically repairs in a separate context and freshly re-audits", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime({ verdicts: ["fail", "pass"] });
  const request = input("repair");
  const result = await createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime }).run(request);
  const record = await store.load(CASE_ID);
  const [v1, v2] = record.candidate_responses;

  assert.equal(result.answer, v2.exact_text);
  assert.equal(v1.status, "superseded");
  assert.equal(v1.audit_history[0].verdict, "fail");
  assert.equal(v2.repair_cycle, 1);
  assert.equal(v2.parent_candidate_id, v1.id);
  assert.equal(v2.audit_history[0].verdict, "pass");
  assert.deepEqual(v2.audit_history[0].repair_induced_checks, REPAIR_INDUCED_ERROR_CHECKS);
  assert.notEqual(v2.producer_context_id, v1.audit_history[0].auditor_context_id);
  assert.notEqual(v2.producer_context_id, v2.audit_history[0].auditor_context_id);
  assert.deepEqual(states(record.runtime_turns[0]), [
    "RECEIVED", "CANDIDATE_PENDING_AUDIT", "AUDITING", "REPAIR_REQUIRED", "RECONSTRUCTING",
    "CANDIDATE_PENDING_AUDIT", "AUDITING", "APPROVED", "DELIVERED"
  ]);
  assert.deepEqual(modelRuntime.calls.map((entry) => entry.role), ["candidate", "audit", "repair", "audit"]);
});

test("the second failed repair routes to one discriminator and never creates repair cycle three", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime({ verdicts: ["fail", "fail", "fail"] });
  const result = await createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime }).run(input("discriminator"));
  const record = await store.load(CASE_ID);
  const runtimeTurn = record.runtime_turns[0];

  assert.equal(result.deliveryKind, "discriminator");
  assert.equal(result.answer, "Which synthetic signal changed first?");
  assert.equal(record.candidate_responses.length, 3);
  assert.deepEqual(record.candidate_responses.map((candidate) => candidate.repair_cycle), [0, 1, 2]);
  assert.equal(modelRuntime.calls.filter((entry) => entry.role === "repair").length, 2);
  assert.equal(modelRuntime.calls.filter((entry) => entry.role === "audit").length, 3);
  assert.equal(modelRuntime.calls.filter((entry) => entry.role === "discriminator").length, 1);
  assert.ok(states(runtimeTurn).includes("DISCRIMINATING_QUESTION_REQUIRED"));
  assert.equal(record.raw_transcript.at(-1).text, result.answer);
  assert.equal(record.candidate_responses.at(-1).status, "superseded");
});

test("self-certification is rejected, retried only to the fixed ceiling, and fails closed", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime({ reuseContext: true });
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime, maximumInvocationAttempts: 2 });
  await assert.rejects(() => controller.run(input("self-cert")), (error) => error.code === "THERAPY_RUNTIME_UNAVAILABLE" && !/Synthetic candidate/u.test(error.message));
  const record = await store.load(CASE_ID);
  const candidate = record.candidate_responses[0];
  assert.equal(candidate.status, "pending_audit");
  assert.equal(candidate.audit_history.length, 0);
  assert.equal(record.runtime_turns[0].state, "AUDITING");
  assert.equal(record.raw_transcript.length, 1);
  assert.equal(modelRuntime.calls.filter((entry) => entry.role === "audit").length, 2);
});

test("a transient audit failure is durably recorded and automatically retried", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime();
  const stableAudit = modelRuntime.auditCandidate.bind(modelRuntime);
  let attempts = 0;
  modelRuntime.auditCandidate = async (args) => {
    attempts += 1;
    if (attempts === 1) {
      modelRuntime.calls.push({ role: "audit", candidateId: args.candidate.id, attemptContextId: args.attemptContextId });
      const error = new Error("synthetic transient transport failure");
      error.code = "PROVIDER_ERROR";
      throw error;
    }
    return stableAudit(args);
  };
  const result = await createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime, maximumInvocationAttempts: 2 }).run(input("transient-retry"));
  const runtimeTurn = (await store.load(CASE_ID)).runtime_turns[0];
  assert.equal(result.deliveryKind, "candidate");
  assert.equal(attempts, 2);
  assert.equal(runtimeTurn.events.filter((event) => event.stage === "audit" && event.event_type === "INVOCATION_FAILED").length, 1);
  assert.equal(runtimeTurn.events.filter((event) => event.stage === "audit" && event.event_type === "INVOCATION_COMPLETED").length, 1);
});

test("encrypted runtime intake and exact delivery survive a fresh store/controller", async (t) => {
  const { store, create, rootDir } = await makeStore(t);
  const request = input("restart");
  await store.beginPrivateRuntimeTurn(CASE_ID, {
    runtimeTurnId: request.runtimeTurnId,
    exchangeId: request.exchangeId,
    userTurnId: request.userTurnId,
    exactText: request.userMessage
  });
  const encrypted = await fs.readFile(path.join(rootDir, `${CASE_ID}.vault.json`), "utf8");
  assert.doesNotMatch(encrypted, /Exact synthetic inbound restart/u);
  store.close();

  const reopened = create();
  const modelRuntime = scriptedRuntime();
  const result = await createPrivateTherapyTurnController({ privateCaseSource: reopened, modelRuntime }).run(request);
  reopened.close();
  const finalStore = create();
  const record = await finalStore.load(CASE_ID);
  assert.equal(result.answer, record.runtime_turns[0].delivery.exact_text);
  assert.equal(record.raw_transcript[0].text, request.userMessage);
  assert.equal(record.raw_transcript[1].text, result.answer);
  assert.equal(record.candidate_responses[0].audit_history.length, 1);
  finalStore.close();
});

test("duplicate inbound IDs are idempotent only for identical exact bytes", async (t) => {
  const { store } = await makeStore(t);
  const request = input("idempotent");
  await store.beginPrivateRuntimeTurn(CASE_ID, {
    runtimeTurnId: request.runtimeTurnId,
    exchangeId: request.exchangeId,
    userTurnId: request.userTurnId,
    exactText: request.userMessage
  });
  await store.beginPrivateRuntimeTurn(CASE_ID, {
    runtimeTurnId: request.runtimeTurnId,
    exchangeId: request.exchangeId,
    userTurnId: request.userTurnId,
    exactText: request.userMessage
  });
  await assert.rejects(() => store.beginPrivateRuntimeTurn(CASE_ID, {
    runtimeTurnId: request.runtimeTurnId,
    exchangeId: request.exchangeId,
    userTurnId: request.userTurnId,
    exactText: `${request.userMessage}changed`
  }), /conflicts with an existing immutable inbound/u);
});

test("concurrent duplicate requests share one per-case lifecycle execution", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime();
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime });
  const request = input("concurrent-duplicate");
  const [first, second] = await Promise.all([controller.run(request), controller.run(request)]);
  assert.equal(first.answer, second.answer);
  assert.deepEqual(modelRuntime.calls.map((entry) => entry.role), ["candidate", "audit"]);
  const record = await store.load(CASE_ID);
  assert.equal(record.runtime_turns.length, 1);
  assert.equal(record.raw_transcript.length, 2);
});

test("one HTTP user message completes the lifecycle without GitHub or owner handoff intervention", async (t) => {
  const { store } = await makeStore(t);
  const modelRuntime = scriptedRuntime();
  const controller = createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime });
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const server = createInnerSignalServer({ config, providers: createProviders(config), privateCaseStore: store, privateTherapyController: controller });
  const base = await listenServer(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = input("one-http-message");
  const response = await fetch(`${base}/v1/therapy/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      caseId: request.caseId,
      runtimeTurnId: request.runtimeTurnId,
      exchangeId: request.exchangeId,
      userTurnId: request.userTurnId,
      assistantTurnId: request.assistantTurnId,
      userMessage: request.userMessage,
      processingMode: "fast"
    })
  });
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.answer, "Synthetic candidate v1.\n\nWhich part is most observable?");
  assert.deepEqual(value.orchestration, { state: "DELIVERED", deliveryKind: "candidate", repairCycle: 0, lifecycleOwner: "server" });
  assert.deepEqual(modelRuntime.calls.map((entry) => entry.role), ["candidate", "audit"]);
  const record = await store.load(CASE_ID);
  assert.equal(record.raw_transcript.length, 2);
  assert.equal(record.candidate_responses[0].status, "sent");

  const runtimeSources = await Promise.all([
    "src/server/create-server.mjs",
    "src/supervisor/private-therapy-turn-controller.mjs",
    "src/supervisor/private-therapy-model-runtime.mjs",
    "src/storage/private-case-store.mjs"
  ].map((relative) => fs.readFile(path.join(repositoryRoot, relative), "utf8")));
  assert.doesNotMatch(runtimeSources.join("\n"), /from\s+["'][^"']*(?:\/git\/|github-sync)|\bgh\s+(?:api|pr|repo)|git\s+(?:commit|push)/u);
});

test("private runtime authorizes before key access or any model inference", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-auth-before-inference-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let authorizationChecks = 0;
  let keyRequests = 0;
  let inferenceCalls = 0;
  const privateCaseAccessService = createPrivateCaseAccessService({
    rootDir,
    authorizationProvider: {
      async authorize() { authorizationChecks += 1; return { allowed: false }; }
    },
    keyProvider: {
      async getCaseKeyMaterial() { keyRequests += 1; return {}; }
    }
  });
  const provider = {
    id: "synthetic",
    model: "synthetic",
    async generate() { inferenceCalls += 1; throw new Error("must not be reached"); }
  };
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const server = createInnerSignalServer({
    config,
    providers: { openai: provider, anthropic: provider, renderer: provider },
    privateCaseAccessService
  });
  const base = await listenServer(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${base}/v1/therapy/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId: CASE_ID, userMessage: "Synthetic denied intake." })
  });
  const value = await response.json();
  assert.equal(response.status, 403);
  assert.equal(value.code, "PRIVATE_CASE_ACCESS_DENIED");
  assert.equal(value.error, "InnerSignal could not safely complete this request.");
  assert.equal(authorizationChecks, 1);
  assert.equal(keyRequests, 0);
  assert.equal(inferenceCalls, 0);
});
