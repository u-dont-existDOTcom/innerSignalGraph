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

test("the model auditor cannot reserve a derived evidence finding id", async () => {
  const provider = packetProvider({ findings: [{ id: "evidence:forged", code: "SYNTHETIC", severity: "low", summary: "Reserved namespace." }], repair_induced_checks: [] });
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(), providers: { anthropic: provider }, config: {} });
  await assert.rejects(runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id }), { name: "ValidationError" });
});

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
    filesystem_available: false,
    // Added with the trajectory digest: computed in code from the stored case, no model call, no record on this synthetic case.
    trajectory_digest_included: true,
    trajectory_digest_computed_in_code_without_model: true,
    self_directed_risk_record_included: false
  });
  assert.match(captured[0].user, /"trajectory_digest"/u);
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

async function syntheticResponseEvidence() {
  const { buildResponseEvidenceSnapshot, buildEvidenceModelView, sha256Text } = await import("../src/supervisor/response-evidence-contract.mjs");
  const record = { case_id: "synthetic", case_state: createEmptyCaseState({ caseId: "synthetic" }), raw_transcript: [], transcript_amendments: [], source_artifacts: [], candidate_responses: [], supervisor_artifacts: [], communication_events: [], journal_corpora: [], tracker_entries: [], runtime_turns: [{ id: "runtime:evidence", user_turn_id: "turn:evidence", inbound: { exact_text: "Synthetic current message.", received_at: "2026-11-23T12:00:00.000Z" } }] };
  const snapshot = buildResponseEvidenceSnapshot(record, { snapshotId: "snapshot:evidence", owner: { kind: "runtime_turn", runtime_turn_id: "runtime:evidence" }, inbound: { turn_id: "turn:evidence", exact_text_sha256: sha256Text("Synthetic current message."), audience: "client", source_kind: "exact_client_turn" } }, { createdAt: "2026-11-23T12:00:00.000Z" });
  const { view, view_sha256 } = buildEvidenceModelView(record, snapshot);
  return { record, responseEvidence: { snapshot, view, viewSha256: view_sha256 } };
}
const assessedReview = () => ({ coverage: ["prior_delivery", "personal_history", "history_dependent_advice", "source_consultation_claims", "coverage_scope_and_conflicts"].map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic coverage." })), items: [], missing_material_history: [] });

test("the actual final writer request carries the exact rendered evidence block", async () => {
  const { record, responseEvidence } = await syntheticResponseEvidence();
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const captured = [];
  const providers = Object.fromEntries(Object.entries(createProviders(config)).map(([name, provider]) => [name, provider && typeof provider.generate === "function" ? new Proxy(provider, { get(target, key) {
    if (key === "generate") return async (input) => { captured.push(structuredClone(input)); return target.generate(input); };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } }) : provider]));
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: { async loadPrivateRuntimeCase() { return record; } }, providers, config });
  const turn = record.runtime_turns[0];
  const result = await runtime.produceCandidate({ caseId: "synthetic", runtimeTurn: turn, userInput: { processingMode: "fast" }, responseEvidence });
  const block = `VERIFIED DELIVERY AND SOURCE EVIDENCE (what was actually delivered, reported, drafted, and which sources exist; drafts and supervisor instructions are not client history)\n${JSON.stringify(responseEvidence.view, null, 2)}`;
  // Fast processing's final text is written by the realize stage (not the earlier formulation/audit stages).
  const finalRequest = captured.findLast((input) => ["realization", "realization_retry"].includes(input.metadata?.stage));
  assert.ok(finalRequest, "final realization provider request captured");
  assert.ok(finalRequest.user.includes(block));
  assert.equal(result.responseEvidenceInclusion.view_sha256, responseEvidence.viewSha256);
});

test("evidence audit and exact fallback review use the same evidence contract and no parallel journal packet", async () => {
  const { responseEvidence } = await syntheticResponseEvidence(); const captured = [];
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(), providers: { anthropic: packetProvider({ findings: [], repair_induced_checks: [], evidence_review: assessedReview() }, captured) }, config: {} });
  const audited = await runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id, responseEvidence, journalEvidence: { packet: { forbidden_duplicate: true }, sha256: "ignored" } });
  const packet = JSON.parse(captured[0].user.slice("AUTHORIZED AUDIT PACKET\n".length));
  assert.deepEqual(packet.response_evidence, responseEvidence.view);
  assert.equal(packet.journal_evidence, undefined);
  assert.equal(packet.disclosure_manifest.response_evidence_view_sha256, responseEvidence.viewSha256);
  assert.ok(captured[0].outputSchema.required.includes("evidence_review"));
  for (const words of ["all five dimensions", "uncertain_but_worded_accurately", "An export is not a send", "not negative history", "Case state and proposed state updates are not sources"]) assert.ok(captured[0].system.includes(words));
  assert.equal(audited.responseEvidenceInclusion.snapshot_sha256, responseEvidence.snapshot.snapshot_sha256);
  const exactText = "What do you notice now?";
  await runtime.reviewFallbackQuestion({ caseId: "synthetic", runtimeTurn: { id: "runtime:evidence", current_candidate_id: candidate.id }, exactText, responseEvidence });
  const fallback = JSON.parse(captured[1].user.slice("AUTHORIZED AUDIT PACKET\n".length));
  const { sha256Text } = await import("../src/supervisor/response-evidence-contract.mjs");
  assert.deepEqual(fallback.candidate_binding, { kind: "fallback_question", runtime_turn_id: "runtime:evidence", sha256: sha256Text(exactText) });
  assert.equal(fallback.candidate_response, exactText);
  assert.equal(captured[1].system, captured[0].system);
});

test("malformed evidence reviews fail the model invocation before any audit can be recorded", async () => {
  const { responseEvidence } = await syntheticResponseEvidence();
  for (const review of [undefined, { ...assessedReview(), coverage: [] }, { ...assessedReview(), items: [{ id: "bad", dimension: "personal_history", kind: "claim", candidate_quote: "not in candidate", source_ids: [], assessment: "unsupported", reason: "Unlocatable." }] }]) {
    const provider = packetProvider({ findings: [], repair_induced_checks: [], evidence_review: review });
    const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(), providers: { anthropic: provider }, config: {} });
    await assert.rejects(runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id, responseEvidence }), { name: "ValidationError", code: "RESPONSE_EVIDENCE_INVALID", message: "Private runtime evidence audit result invalid." });
  }
});

test("repair packet carries each blocking evidence item and missing-history entry", async () => {
  const { responseEvidence } = await syntheticResponseEvidence(); const captured = [];
  const review = assessedReview();
  review.items = [{ id: "unsupported", dimension: "personal_history", kind: "claim", candidate_quote: "Exact synthetic", source_ids: [], assessment: "unsupported", reason: "No source." }, { id: "supported", dimension: "personal_history", kind: "claim", candidate_quote: "candidate", source_ids: [], assessment: "uncertain_but_worded_accurately", reason: "Qualified." }];
  review.missing_material_history = [{ id: "missing", question: "Was it tried?", why_material: "Changes advice.", candidate_quote: "Second line." }];
  const failed = { ...candidate, status: "audit_failed", audit_history: [{ id: "audit:failed", verdict: "fail", candidate_id: candidate.id, candidate_version: candidate.version, findings: [{ id: "evidence:unsupported", code: "RESPONSE_EVIDENCE_UNSUPPORTED", severity: "substantive", summary: "No source." }], response_evidence: { review } }] };
  const provider = packetProvider({ exact_text: "Repaired synthetic reply." }, captured);
  const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(failed), providers: { renderer: provider }, config: {} });
  const repaired = await runtime.repairCandidate({ caseId: "synthetic", candidate: failed, responseEvidence });
  const packet = JSON.parse(captured[0].user.slice("AUTHORIZED REPAIR PACKET\n".length));
  assert.deepEqual(packet.response_evidence, responseEvidence.view);
  assert.deepEqual(packet.response_evidence_failures, [{ dimension: "personal_history", candidate_quote: "Exact synthetic", assessment: "unsupported", reason: "No source.", source_ids: [] }, review.missing_material_history[0]]);
  assert.match(captured[0].system, /ask without presupposing unsupported history/);
  assert.equal(repaired.responseEvidenceInclusion.view_sha256, responseEvidence.viewSha256);
});

test("without evidence, audit and repair packet, schema and prompt bytes equal origin/main builders", async () => {
  const { createHash } = await import("node:crypto");
  const hash = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
  // Captured from the unmodified origin/main model runtime and audit/repair prompt builders at
  // 67443fc1f555bd3c687e6ec88bc7b10ae299a36f, using the identical synthetic inputs below.
  const expected = {
    audit: { system: "46326ceed86eed920a5b69f4bd32f6747ebe9b1a6cd307022e8269b614d730a7", user: "9a5dce61e86bde76da47f368f8ac6d62428ff21ea2c75f14695863c7b157cab3", outputSchema: "450c170c88c3018a00a67950e1981bda345c3a6f224759b51c007f1338ccab03" },
    repair: { system: "90ee6e0fff18aca1750ac3f6d9d4b3348ce77cb9a6d0147228ff5b45f21ff9e5", user: "f233da706bb388f1fba90ef78025aceda9b679ce1c21621ac0648c51bb15d6bf", outputSchema: "3d1c8960be5792ae7c90922794a29c654cc881b6f88f22a9599f01f2835a6708" }
  };
  for (const stage of ["audit", "repair"]) {
    const failed = { ...candidate, status: "audit_failed", audit_history: [{ id: "audit:failed", verdict: "fail", candidate_id: candidate.id, candidate_version: candidate.version, findings: [] }] };
    const capture = []; const provider = packetProvider(stage === "audit" ? { findings: [], repair_induced_checks: [] } : { exact_text: "Repaired synthetic reply." }, capture);
    const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: sourceFor(stage === "audit" ? candidate : failed), providers: { anthropic: provider, renderer: provider }, config: {} });
    if (stage === "audit") await runtime.auditCandidate({ caseId: "synthetic", candidateId: candidate.id });
    else await runtime.repairCandidate({ caseId: "synthetic", candidate: failed });
    for (const field of ["system", "user", "outputSchema"]) assert.equal(hash(capture[0][field]), expected[stage][field], `${stage} ${field} bytes`);
  }
});

test("evidence-blocked fallback uses fixed owner text only with the existing setting and an allowed route", async () => {
  const { OWNER_FALLBACK_ROUTE_IDS, OWNER_FALLBACK_MESSAGE, OWNER_FALLBACK_KIND } = await import("../src/supervisor/owner-fallback-message.mjs");
  for (const [enabled, route, allowed] of [[true, OWNER_FALLBACK_ROUTE_IDS[0], true], [false, OWNER_FALLBACK_ROUTE_IDS[0], false], [true, "SYNTHETIC.UNRELATED", false]]) {
    const source = { ...sourceFor(), async loadPrivateRuntimeCase() { return { case_state: { current_episode: { route } } }; } };
    const runtime = createPrivateTherapyModelRuntime({ privateCaseSource: source, providers: {}, config: { ownerFallbackEnabled: enabled } });
    const run = () => runtime.produceDiscriminator({ caseId: "synthetic", runtimeTurn: { id: "runtime:evidence" }, evidenceReviewFailed: true, attemptContextId: "attempt:fallback" });
    if (allowed) { const output = await run(); assert.equal(output.exactText, OWNER_FALLBACK_MESSAGE); assert.equal(output.kind, OWNER_FALLBACK_KIND); }
    else await assert.rejects(run(), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
  }
});
