import test from "node:test";
import assert from "node:assert/strict";
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
