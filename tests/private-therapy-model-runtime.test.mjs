import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createPrivateTherapyModelRuntime } from "../src/supervisor/private-therapy-model-runtime.mjs";

const candidate = Object.freeze({
  id: "candidate:synthetic:v1",
  version: 1,
  exact_text: "Exact synthetic candidate bytes.\nSecond line.",
  status: "pending_audit",
  parent_candidate_id: null,
  producer_context_id: "context:producer:must-not-cross-firewall",
  repair_cycle: 0,
  audit_history: []
});

function contextFor(candidateResponse = candidate) {
  return {
    candidate_response: structuredClone(candidateResponse),
    constitution_ref: { version: "synthetic-constitution" },
    case_state: { schema_version: 2, marker: "authorized-state-only" },
    last_state_diff: null,
    recent_verbatim: { turns: [{ id: "turn:synthetic", role: "user", text: "Authorized synthetic context." }] },
    targeted_older_evidence: [],
    current_episode: { id: "episode:synthetic", next_question: "Which signal changed?" },
    continuation_safety: { continuation_safe: true },
    producer_hidden_reasoning: "SECRET_PRODUCER_TRACE"
  };
}

function sourceFor(candidateResponse = candidate) {
  return {
    async loadPrivateRuntimeCase() {
      return { case_state: { current_episode: { next_question: "Which signal changed?" } } };
    },
    async loadCaseContext() { return contextFor(candidateResponse); }
  };
}

function packetProvider(result, capture = []) {
  let index = 0;
  return {
    id: "synthetic-auditor",
    model: "synthetic-independent-model",
    privateInferenceIsolation: { packetOnly: true, freshContextPerGenerate: true, tools: false, filesystem: false, sessionPersistence: false },
    async generate(input) {
      capture.push(structuredClone(input));
      index += 1;
      return { text: JSON.stringify(result), responseId: `response:synthetic:${index}` };
    }
  };
}

test("auditor receives only the authorized packet and no producer context or hidden trace", async () => {
  const captured = [];
  const auditProvider = packetProvider({ findings: [], repair_induced_checks: [] }, captured);
  const runtime = createPrivateTherapyModelRuntime({
    privateCaseSource: sourceFor(),
    providers: { anthropic: auditProvider, renderer: auditProvider },
    config: {}
  });
  const result = await runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id, authContext: {}, attemptContextId: "attempt:audit:1" });
  assert.equal(result.value.findings.length, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].sealed, true);
  assert.equal(captured[0].metadata.freshContext, true);
  assert.match(captured[0].user, /Exact synthetic candidate bytes/u);
  assert.doesNotMatch(captured[0].user, /must-not-cross-firewall/u);
  assert.doesNotMatch(captured[0].user, /SECRET_PRODUCER_TRACE/u);
  assert.deepEqual(result.disclosureManifest, {
    exact_candidate_included: true,
    authorized_case_context_included: true,
    producer_hidden_reasoning_included: false,
    producer_trace_included: false,
    repair_rationale_history_included: false,
    prior_verdicts_included: false,
    tools_available: false,
    filesystem_available: false
  });
});

test("audit output cannot smuggle replacement text through the strict result contract", async () => {
  const auditProvider = packetProvider({ findings: [], repair_induced_checks: [], replacement_text: "forbidden replacement" });
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(), providers: { anthropic: auditProvider }, config: {} });
  await assert.rejects(
    () => runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id, authContext: {}, attemptContextId: "attempt:audit:2" }),
    /forbidden fields: replacement_text/u
  );
});

test("a provider without mechanical packet-only isolation is rejected before invocation", async () => {
  let calls = 0;
  const unsafeProvider = {
    id: "unsafe",
    model: "unsafe",
    privateInferenceIsolation: { packetOnly: false, freshContextPerGenerate: true, tools: true, filesystem: true, sessionPersistence: false },
    async generate() { calls += 1; return { text: "{}", responseId: "unsafe" }; }
  };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(), providers: { anthropic: unsafeProvider }, config: {} });
  await assert.rejects(
    () => runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id, authContext: {}, attemptContextId: "attempt:audit:unsafe" }),
    (error) => error.code === "PRIVATE_INFERENCE_ISOLATION_UNAVAILABLE"
  );
  assert.equal(calls, 0);
});

// A supervisor asks for a draft after the client's message was stored, so that message is already the newest stored user turn. The
// runtime's own turns store it later; for them nothing changes.
test("a caller whose inbound message is already stored does not show the model that message twice, and the earlier turns stay", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const providers = createProviders(config);
  const newest = "Synthetic newest client message waiting for a reply.";
  const earlier = "Synthetic earlier client message.";
  const turns = [
    { id: "E1-user", exchange_id: "E1", role: "user", text: earlier, at: "2026-09-01T12:00:00.000Z" },
    { id: "E1-assistant", exchange_id: "E1", role: "assistant", text: "Synthetic earlier reply.", at: "2026-09-01T12:00:01.000Z" },
    { id: "E2-user", exchange_id: "E2", role: "user", text: newest, at: "2026-09-02T12:00:00.000Z" }
  ];
  const sent = [];
  const spied = Object.fromEntries(Object.entries(providers).map(([key, provider]) => [key, provider && typeof provider.generate === "function"
    ? new Proxy(provider, {
      get(target, property) {
        if (property === "generate") return async (input) => { sent.push(JSON.stringify(input)); return target.generate(input); };
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      }
    })
    : provider]));
  const source = { async loadPrivateRuntimeCase() { return { case_id: "synthetic", case_state: createEmptyCaseState({ caseId: "synthetic" }), raw_transcript: turns, tracker_entries: [] }; } };
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: spied, config });
  const runtimeTurn = { user_turn_id: "E2-user", inbound: { exact_text: newest, received_at: turns[2].at } };
  const count = (text) => sent.join("\n").split(text).length - 1;
  const produce = async (extra) => {
    sent.length = 0;
    const result = await runtime.produceCandidate({ caseId: "synthetic", runtimeTurn, userInput: { processingMode: "fast" }, authContext: {}, attemptContextId: "attempt:inbound", ...extra });
    assert.equal(typeof result.exactText, "string");
    return { newest: count(newest), earlier: count(earlier), calls: sent.length };
  };

  const own = await produce({});
  const explicitOwn = await produce({ inboundAlreadyRecorded: false });
  const supervisor = await produce({ inboundAlreadyRecorded: true });
  assert.deepEqual(explicitOwn, own, "the runtime's own turns are unchanged by the new option");
  assert.ok(own.calls > 0 && supervisor.calls === own.calls);
  assert.ok(supervisor.newest > 0, "the message is still shown to the model as the current message");
  assert.ok(supervisor.newest < own.newest, "but no longer a second time as part of the recent transcript");
  assert.equal(supervisor.earlier, own.earlier, "the earlier turns are all still shown");
});
