import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/core/config.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { createEmptyCaseState, mergeRuntimeSnapshotIntoCaseState } from "../src/case-state/longitudinal-state.mjs";
import { SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID } from "../src/case-state/self-directed-risk.mjs";
import { createInnerSignalServer } from "../src/server/create-server.mjs";
import { createPrivateCaseAccessService, PRIVATE_CASE_SCOPES } from "../src/storage/private-case-access.mjs";
import { assessContinuationSafety } from "../src/storage/private-case-continuity.mjs";
import { OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";
import { BLOCKING_FINDING, openScriptedRiskRuntime } from "./fixtures/scripted-risk-runtime.mjs";

// Everything here is synthetic: numbered placeholder messages, scripted providers, no model call.
const OLDER_EVIDENCE_FAILURE = "targeted older raw evidence has no retrievable private provenance source";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

// ---- The continuation gate -------------------------------------------------------------------------------------------------

const turnEvidence = (itemIds, text = "Synthetic older turn.") => ({ turn_id: "T1-user", reasons: ["synthetic"], item_ids: itemIds, turn: { id: "T1-user", text } });
const safeContext = (overrides) => ({
  case_state: { synthetic: true },
  last_state_diff: { synthetic: true },
  current_episode: { id: "synthetic-episode" },
  constitution_ref: { version: "synthetic-constitution" },
  candidate_response: { exact_text: "Synthetic candidate.", status: "pending_audit" },
  recent_verbatim: { episode_completeness: { required: true, complete: true } },
  targeted_older_evidence: [],
  source_artifact_refs: [],
  ...overrides
});

test("evidence that exists only for the risk record is not older raw evidence for the continuation gate", () => {
  const failures = (overrides) => assessContinuationSafety(safeContext(overrides)).failures;
  assert.deepEqual(failures({}), [OLDER_EVIDENCE_FAILURE], "no older evidence at all fails, as it always did");
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence([SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID])] }), [OLDER_EVIDENCE_FAILURE], "the record's turn alone does not clear it");
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence([SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID, SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID])] }), [OLDER_EVIDENCE_FAILURE]);
  // Anything else still counts, alone or beside the record, so cases that rely on it are unchanged.
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence(["item:synthetic"])] }), []);
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence([SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID, "item:synthetic"])] }), [], "a turn also requested for another reason still counts");
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence([SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID]), turnEvidence(["item:synthetic"])] }), []);
  assert.deepEqual(failures({ targeted_older_evidence: [{ turn: { text: "Synthetic older turn." } }] }), [], "an entry that names no item keeps counting");
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence(["item:synthetic"], "")] }), [OLDER_EVIDENCE_FAILURE], "an entry with no text never counted");
  // A source artifact still stands in for the older evidence, with or without the record.
  assert.deepEqual(failures({ targeted_older_evidence: [turnEvidence([SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID])], source_artifact_refs: [{ id: "artifact:synthetic" }] }), []);
});

test("through the access service, a held record whose turn lies outside the window does not clear CASE_NOT_CONTINUATION_SAFE", async (t) => {
  // Two turns: a reading on the inquiry route, then a route change that puts turn 1 outside the verbatim window. The case has no source artifact.
  const withRecord = await openScriptedRiskRuntime(t, { caseId: "synthetic-gate-with-record", readings: ["ideation", "absent"] });
  const withoutRecord = await openScriptedRiskRuntime(t, { caseId: "synthetic-gate-without-record", readings: ["absent", "absent"] });
  for (const runtime of [withRecord, withoutRecord]) for (const number of [1, 2]) await runtime.run(number);
  assert.equal((await withRecord.load()).case_state.self_directed_risk.current.level, "ideation");
  assert.equal(Object.hasOwn((await withoutRecord.load()).case_state, "self_directed_risk"), false);

  const serviceFor = (runtime) => createPrivateCaseAccessService({
    rootDir: runtime.rootDir,
    allowDevelopmentFileProvider: true,
    authorizationProvider: { async authorize() { return { allowed: true, principalId: "synthetic-principal", scopes: [PRIVATE_CASE_SCOPES.READ, PRIVATE_CASE_SCOPES.AUDIT], purposes: [] }; } },
    keyProvider: { async getCaseKeyMaterial() { return { accessAssurance: "development_external_file", provider: "development-file-provider", routineKek: Buffer.alloc(32, 61), recoverySecretBytes: Buffer.alloc(32, 62) }; } }
  });
  const options = { requireAuditScope: true, forReplyCheck: true, episodePolicy: { requireCompleteEpisode: true } };

  // The record does put the older turn in the packet the reply check receives ...
  const lenient = await serviceFor(withRecord).loadCaseContext(withRecord.caseId, {}, { ...options, requireContinuationSafe: false });
  assert.deepEqual(lenient.targeted_older_evidence.map((entry) => [entry.turn_id, entry.item_ids]), [["risk-1-user", [SELF_DIRECTED_RISK_RETRIEVAL_ITEM_ID]]]);
  // ... and still the gate fails exactly as it does for a case without a record.
  assert.deepEqual(lenient.continuation_safety.failures, [OLDER_EVIDENCE_FAILURE]);
  const control = await serviceFor(withoutRecord).loadCaseContext(withoutRecord.caseId, {}, { ...options, requireContinuationSafe: false });
  assert.deepEqual(control.targeted_older_evidence, []);
  assert.deepEqual(control.continuation_safety.failures, lenient.continuation_safety.failures);
  for (const runtime of [withRecord, withoutRecord]) {
    await assert.rejects(
      () => serviceFor(runtime).loadCaseContext(runtime.caseId, {}, { ...options, requireContinuationSafe: true }),
      (error) => error.code === "CASE_NOT_CONTINUATION_SAFE" && error.details.failures.includes(OLDER_EVIDENCE_FAILURE),
      runtime.caseId
    );
  }
  // Without the reply-check option the record adds no evidence at all.
  const plain = await serviceFor(withRecord).loadCaseContext(withRecord.caseId, {}, { ...options, forReplyCheck: false, requireContinuationSafe: false });
  assert.deepEqual(plain.targeted_older_evidence, []);
});

// ---- The three responses that hand a case state back to the client -----------------------------------------------------------

test("the private respond route, the legacy respond route and the case-state route return no self_directed_risk", async (t) => {
  // 1. The private respond route and 3. GET /v1/case/state, on a stored case that holds a record.
  const runtime = await openScriptedRiskRuntime(t, { caseId: "synthetic-server-case", readings: ["ideation", "absent"] });
  const privateServer = createInnerSignalServer({ config: runtime.config, providers: runtime.providers, privateCaseStore: runtime.store, privateTherapyController: runtime.controller });
  const privateBase = await listen(privateServer);
  t.after(() => new Promise((resolve) => privateServer.close(resolve)));
  const respond = async (number) => {
    const response = await fetch(`${privateBase}/v1/therapy/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: runtime.caseId, exchangeId: `http-${number}`, userMessage: `Synthetic message ${number}.`, processingMode: "fast" })
    });
    return { status: response.status, value: await response.json() };
  };
  for (const number of [1, 2]) {
    const { status, value } = await respond(number);
    assert.equal(status, 200);
    assert.equal(value.orchestration.deliveryKind, "candidate");
    assert.equal(Object.hasOwn(value.durableCaseState, "self_directed_risk"), false, `private respond, turn ${number}`);
    assert.equal(value.durableCaseState.case_id, runtime.caseId);
    assert.equal(JSON.stringify(value).includes("self_directed_risk"), false, "nowhere in the whole private respond body");
  }
  const stored = await runtime.load();
  assert.equal(stored.case_state.self_directed_risk.current.level, "ideation", "the stored case does hold the record, so the absence above is the server's doing");
  const stateResponse = await fetch(`${privateBase}/v1/case/state?caseId=${runtime.caseId}`);
  const state = await stateResponse.json();
  assert.equal(stateResponse.status, 200);
  assert.equal(Object.hasOwn(state.durableCaseState, "self_directed_risk"), false, "GET /v1/case/state");
  assert.equal(JSON.stringify(state).includes("self_directed_risk"), false);
  assert.equal(state.durableCaseState.case_id, runtime.caseId);

  // 2. The legacy mock route, which hands back the state it merged from the client's own copy.
  const config = loadConfig({ mode: "mock", ledgerMode: "off", devAutomationEnabled: false });
  const legacyServer = createInnerSignalServer({ config, providers: createProviders(config) });
  const legacyBase = await listen(legacyServer);
  t.after(() => new Promise((resolve) => legacyServer.close(resolve)));
  const prior = mergeRuntimeSnapshotIntoCaseState(createEmptyCaseState({ caseId: "synthetic-legacy-case" }),
    { variables: { suicidal_state: "ideation", suicidal_ideation_context: "unknown" }, direct_observations: [], hypotheses: [] },
    { turnId: "T1-user", recordedAt: "2026-11-01T00:00:00.000Z", interventionContract: { primaryJob: { id: "IC.SYNTHETIC", title: "Synthetic route" }, nextQuestion: "", selectedNodes: [], variables: {} } });
  assert.equal(prior.self_directed_risk.current.level, "ideation", "the state the client sends holds a record, which the merge keeps");
  const legacyResponse = await fetch(`${legacyBase}/v1/therapy/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId: "synthetic-legacy-case", userMessage: "Synthetic message 2.", durableCaseState: prior, processingMode: "fast" })
  });
  const legacy = await legacyResponse.json();
  assert.equal(legacyResponse.status, 200);
  assert.equal(Object.hasOwn(legacy.durableCaseState, "self_directed_risk"), false, "legacy respond");
  assert.equal(JSON.stringify(legacy).includes("self_directed_risk"), false);
  assert.equal(legacy.durableCaseState.case_id, "synthetic-legacy-case");
});

// ---- A replayed owner_fallback delivery ---------------------------------------------------------------------------------------

test("a replayed owner_fallback delivery succeeds and changes nothing, and a different assistant turn is refused", async (t) => {
  const runtime = await openScriptedRiskRuntime(t, { readings: ["imminent"], auditFindings: () => [BLOCKING_FINDING] });
  const first = await runtime.run(1);
  assert.equal(first.deliveryKind, OWNER_FALLBACK_KIND);
  const before = await runtime.load();
  const [turn] = before.runtime_turns;
  assert.deepEqual([turn.state, turn.delivery.kind, turn.assistant_turn_id], ["DELIVERED", OWNER_FALLBACK_KIND, "risk-1-assistant"]);

  // The store call a restarted controller makes for an already delivered turn.
  await runtime.store.deliverPrivateRuntimeDiscriminator(runtime.caseId, turn.id, { assistantTurnId: "risk-1-assistant", eventId: "event:synthetic-replay" });
  const after = await runtime.load();
  assert.deepEqual(after, before, "a replay appends nothing: no second transcript turn, no new event");
  assert.equal(after.raw_transcript.filter((entry) => entry.text === OWNER_FALLBACK_MESSAGE).length, 1);
  await assert.rejects(
    () => runtime.store.deliverPrivateRuntimeDiscriminator(runtime.caseId, turn.id, { assistantTurnId: "risk-1-assistant-other", eventId: "event:synthetic-other" }),
    /conflicts with an existing immutable delivery/u
  );

  // The same through the controller: a replay of the delivered runtime turn returns the persisted delivery without another model call.
  const calls = { ...runtime.counts };
  const replay = await runtime.run(1);
  assert.equal(replay.deliveryKind, OWNER_FALLBACK_KIND);
  assert.equal(replay.answer, OWNER_FALLBACK_MESSAGE);
  assert.deepEqual(runtime.counts, calls, "no model call");
  assert.deepEqual(await runtime.load(), before);
});
