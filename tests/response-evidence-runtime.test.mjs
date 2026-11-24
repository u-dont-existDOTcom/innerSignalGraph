import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, responseEvidenceDependenciesCurrent, responseEvidenceSnapshotCurrent, sha256Json, sha256Text, validateResponseEvidenceSnapshot } from "../src/supervisor/response-evidence-contract.mjs";
import { responseEvidenceFailures } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";
import { compatibilityStateBinding, protectiveCompatibilityDecision, updateProtectiveCompatibilityState } from "../src/case-formulation/protective-compatibility.mjs";
import { validatePrivateRuntimeDiscriminatorReview } from "../src/supervisor/private-runtime-turn-lifecycle.mjs";

const CASE = "synthetic-evidence-runtime", NOW = "2026-11-23T12:00:00.000Z";
const request = () => ({ caseId: CASE, runtimeTurnId: "runtime:one", exchangeId: "exchange:one", userTurnId: "turn:user", assistantTurnId: "turn:assistant", userMessage: "What is happening for me now?" });
const emptyReview = () => ({ coverage: RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic coverage." })), items: [], missing_material_history: [] });
const unsupported = (quote) => ({ ...emptyReview(), items: [{ id: "unsupported", dimension: "personal_history", kind: "question_presupposition", candidate_quote: quote, quote_occurrence: 1, source_ids: [], assessment: "unsupported", reason: "No supplied source supports this premise." }] });
const missing = (quote) => ({ ...emptyReview(), missing_material_history: [{ id: "missing", question: "What was already tried?", why_material: "The answer changes the advice.", candidate_quote: quote, quote_occurrence: 1 }] });
const inclusion = (e) => ({ snapshot_id: e.snapshot.id, snapshot_sha256: e.snapshot.snapshot_sha256, view_sha256: e.viewSha256 });
const stateFor = (turn) => applyCaseStatePatch(createEmptyCaseState({ caseId: CASE }), { current_episode: {
  id: "episode:synthetic", target: "Find the present signal.", route: "SYNTHETIC.RUNTIME", prediction: "A question helps distinguish.", next_question: "What do you notice now?", started_turn_id: turn.user_turn_id,
  constitutional_aim_ids: ["CARE"], adverse_signs: ["less choice"], stay_conditions: ["new information"], switch_conditions: ["no information"], stop_conditions: ["decline"], source_item_ids: []
} });

async function setup(t, options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-evidence-runtime-"));
  const storeOptions = { rootDir, routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), developmentExternalCredentialAuthorized: true, responseEvidencePolicy: options.policy ?? "enforced", now: () => NOW };
  const store = createEncryptedPrivateCaseStore(storeOptions);
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const calls = [], counts = { candidate: 0, audit: 0, repair: 0, review: 0, discriminator: 0 };
  const runtime = {
    async produceCandidate({ runtimeTurn, responseEvidence }) {
      counts.candidate++; calls.push({ stage: "candidate", responseEvidence });
      return { exactText: "A synthetic current-message reply.", contextId: "context:writer", caseState: stateFor(runtimeTurn), ...(responseEvidence ? { responseEvidenceInclusion: inclusion(responseEvidence) } : {}) };
    },
    async auditCandidate({ candidate, responseEvidence }) {
      const n = counts.audit++; calls.push({ stage: "audit", responseEvidence });
      if (options.onAudit) await options.onAudit({ store, candidate, responseEvidence, n });
      const review = options.auditReview?.(candidate.exact_text, n) ?? emptyReview();
      return { contextId: `context:audit:${n}`, ...(responseEvidence ? { responseEvidenceInclusion: inclusion(responseEvidence) } : {}), value: { findings: options.alwaysFail ? [{ id: "ordinary", code: "SYNTHETIC", severity: "substantive", summary: "Synthetic repair." }] : [], repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...REPAIR_INDUCED_ERROR_CHECKS], evidence_review: review } };
    },
    async repairCandidate({ candidate, responseEvidence }) {
      const n = ++counts.repair;
      calls.push({ stage: "repair", responseEvidence, response_evidence_failures: responseEvidenceFailures(candidate.audit_history.at(-1)) });
      return { exactText: `Repaired current-message reply ${n}.`, contextId: `context:repair:${n}`, ...(responseEvidence ? { responseEvidenceInclusion: inclusion(responseEvidence) } : {}) };
    },
    async produceDiscriminator({ evidenceReviewFailed }) {
      const n = ++counts.discriminator;
      if (evidenceReviewFailed && options.ownerFallback) return { kind: OWNER_FALLBACK_KIND, exactText: OWNER_FALLBACK_MESSAGE, contextId: `context:discriminator:${n}` };
      return { exactText: options.question ?? "What do you notice now?", contextId: `context:discriminator:${n}` };
    },
    async reviewFallbackQuestion({ exactText, responseEvidence }) {
      counts.review++;
      return { contextId: "context:question-review", ...(responseEvidence ? { responseEvidenceInclusion: inclusion(responseEvidence) } : {}), value: { findings: options.questionFindings ?? [], repair_induced_checks: [], evidence_review: options.badQuestion ? unsupported(exactText) : emptyReview() } };
    }
  };
  const controller = (extra = {}) => createPrivateTherapyTurnController({ privateCaseSource: store, modelRuntime: runtime, responseEvidence: { enforced: true, journalTimeoutMs: 10 }, ...extra });
  return { store, rootDir, storeOptions, runtime, calls, counts, controller };
}

async function assertDelivered(store) {
  const record = await store.load(CASE);
  assert.equal(record.schema_version, 7);
  const turn = record.runtime_turns[0]; assert.equal(turn.state, "DELIVERED");
  assert.equal(record.raw_transcript.at(-1).text, turn.delivery.exact_text);
  const candidate = record.candidate_responses.at(-1);
  if (turn.delivery.kind === "candidate") {
    const snapshot = record.response_evidence_snapshots.find((s) => s.id === candidate.metadata.response_evidence.snapshot_id);
    // Delivery itself adds a transcript item; assess freshness at the pre-delivery boundary.
    const before = structuredClone(record); before.raw_transcript.pop();
    assert.equal(responseEvidenceDependenciesCurrent(before, candidate, snapshot), true);
  }
  return record;
}

test("governed controller delivers through the real enforced store", async (t) => {
  const env = await setup(t); const result = await env.controller().run(request());
  assert.equal(result.deliveryKind, "candidate");
  const record = await assertDelivered(env.store);
  assert.equal(record.response_evidence_snapshots.length, 1);
  assert.equal(record.response_evidence_snapshots[0].journal.availability, "not_configured");
  assert.equal(env.counts.candidate, 1);
});

test("the runtime's own newest inbound stays current before and after its transcript commit", async (t) => {
  const env = await setup(t, { async onAudit({ store, responseEvidence }) {
    const record = await store.load(CASE);
    assert.equal(record.raw_transcript.at(-1).id, request().userTurnId);
    assert.equal(responseEvidenceSnapshotCurrent(record, { snapshot: responseEvidence.snapshot,
      rootCandidate: record.candidate_responses[0] }), true);
  } });
  await env.store.appendTranscriptTurn(CASE, { id: "turn:earlier", exchange_id: "exchange:earlier", role: "user",
    text: "Earlier synthetic client words.", at: NOW, episode_id: null });
  const produce = env.runtime.produceCandidate;
  env.runtime.produceCandidate = async args => {
    const record = await env.store.load(CASE);
    assert.equal(record.raw_transcript.some(turn => turn.id === request().userTurnId), false);
    assert.equal(responseEvidenceSnapshotCurrent(record, { snapshot: args.responseEvidence.snapshot }), true);
    return produce(args);
  };
  assert.equal((await env.controller().run(request())).deliveryKind, "candidate");
  const record = await assertDelivered(env.store);
  assert.equal(record.response_evidence_snapshots.length, 1);
  assert.equal(record.candidate_responses[0].metadata.response_evidence.dependency_status, "current_at_commit");
  assert.deepEqual(env.counts, { candidate: 1, audit: 1, repair: 0, review: 0, discriminator: 0 });
});

for (const changed of [[], ["a"], ["b"], ["a", "b"]]) test(`journal refresh keeps a valid subset and the turn proceeds (changed: ${changed.join(",") || "none"})`, async (t) => {
  const env = await setup(t, { async onAudit({ store, n }) {
    if (n !== 0) return;
    for (const id of changed) await store.publishJournalGeneration(CASE, { corpusId: `corpus:${id}`, generation: "generation:one", manifestObjectId: `manifest:${id}:changed`, expectedGeneration: "generation:one" });
    // Force a refresh even when neither journal corpus changed.
    const state = await store.getCaseState(CASE); state.updated_at = "2026-11-23T14:00:00.000Z";
    await store.saveCaseState(CASE, state);
  } });
  const source_items = [], receipts = [];
  for (const id of ["a", "b"]) {
    await env.store.createJournalCorpus(CASE, { corpusId: `corpus:${id}`, manifestObjectId: `manifest:${id}` });
    await env.store.publishJournalGeneration(CASE, { corpusId: `corpus:${id}`, generation: "generation:one", manifestObjectId: `manifest:${id}` });
    const exact_excerpt = `Exact synthetic journal quotation ${id}.`;
    const item = { id: `src:journal:${id}`, kind: "journal_quotation", actor: "client", audience: "private_journal",
      time: { at: null, status: "unavailable" }, epistemic_status: "client_written_account", exact_excerpt,
      excerpt_sha256: sha256Text(exact_excerpt), excerpt_bytes: Buffer.byteLength(exact_excerpt), locator: { kind: "journal", corpus_id: `corpus:${id}`,
        generation: "generation:one", visibility_epoch: 0, record_id: `record:${id}`, start_byte: 0, end_byte: Buffer.byteLength(exact_excerpt) } };
    source_items.push(item);
    receipts.push({ operation_id: `retrieval:${id}`, corpus_id: `corpus:${id}`, generation: "generation:one", visibility_epoch: 0, manifest_object_id: `manifest:${id}`,
      purpose: "session_use", query_sha256: sha256Text("query"), filters_sha256: sha256Json({}), returned_source_ids: [item.id], packet_sha256: sha256Json([item]),
      more_available: false, omitted_count: 0, budget_used_tokens: Math.ceil(Buffer.byteLength(JSON.stringify(exact_excerpt)) / 3), budget_used_bytes: Buffer.byteLength(JSON.stringify(exact_excerpt)) });
  }
  let retrievals = 0;
  const result = await env.controller({ journalEvidenceProvider: { async freezeResponseEvidenceJournal() {
    retrievals++; return { availability: "available", retrieval_status: "returned", source_items, receipts, coverage: "Two targeted synthetic searches." };
  } } }).run(request());
  assert.equal(result.deliveryKind, "candidate");
  const record = await assertDelivered(env.store), snapshot = record.response_evidence_snapshots.at(-1);
  assert.equal(record.response_evidence_snapshots.length, 2);
  assert.equal(retrievals, 1);
  for (const entry of record.response_evidence_snapshots) assert.equal(validateResponseEvidenceSnapshot(entry), entry);
  const kept = source_items.filter(item => !changed.includes(item.locator.corpus_id.slice("corpus:".length)));
  assert.deepEqual(snapshot.source_items.filter(item => item.kind === "journal_quotation"), kept);
  assert.deepEqual(snapshot.journal.receipts, receipts.filter(receipt => !changed.includes(receipt.corpus_id.slice("corpus:".length))));
  assert.equal(snapshot.journal.availability, kept.length ? "available" : "unavailable");
  assert.equal(snapshot.journal.retrieval_status, changed.length ? "partial" : "returned");
  assert.equal(snapshot.journal.more_available, changed.length > 0);
  assert.deepEqual(snapshot.journal.omissions, changed.length ? [{ reason: "journal_binding_changed", count: changed.length }] : []);
  assert.equal(snapshot.journal.budget.used_bytes, kept.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item.exact_excerpt)), 0));
  assert.equal(snapshot.journal.budget.used_tokens, kept.reduce((sum, item) => sum + Math.ceil(Buffer.byteLength(JSON.stringify(item.exact_excerpt)) / 3), 0));
  const { originMainPrivateCaseValidator } = await import("./helpers/origin-main-private-case-validator.mjs");
  const validateOld = await originMainPrivateCaseValidator(t);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
});

test("a publication race after a no-match search preserves the governed current-message delivery", async (t) => {
  const env = await setup(t);
  await env.store.createJournalCorpus(CASE, { corpusId: "corpus:race", manifestObjectId: "manifest:old" });
  await env.store.publishJournalGeneration(CASE, { corpusId: "corpus:race", generation: "generation:old", manifestObjectId: "manifest:old" });
  let retrieved = false;
  const result = await env.controller({ responseEvidence: { enforced: true, journalTimeoutMs: 5000 }, journalEvidenceProvider: {
    async freezeResponseEvidenceJournal() {
      retrieved = true;
      const journal = { availability: "available", retrieval_status: "no_match", receipts: [{ operation_id: "retrieval:race",
        corpus_id: "corpus:race", generation: "generation:old", visibility_epoch: 0, manifest_object_id: "manifest:old", purpose: "session_use",
        query_sha256: sha256Text("query"), filters_sha256: sha256Json({}), returned_source_ids: [], packet_sha256: sha256Json([]),
        more_available: false, omitted_count: 0, budget_used_tokens: 0, budget_used_bytes: 0 }] };
      await env.store.publishJournalGeneration(CASE, { corpusId: "corpus:race", generation: "generation:new",
        manifestObjectId: "manifest:new", expectedGeneration: "generation:old" });
      return journal;
    }
  } }).run(request());
  assert.equal(retrieved, true);
  assert.equal(result.deliveryKind, "candidate");
  const record = await assertDelivered(env.store), snapshot = record.response_evidence_snapshots[0];
  assert.equal(record.response_evidence_snapshots.length, 1);
  assert.deepEqual(snapshot.journal.receipts, []);
  assert.equal(snapshot.journal.retrieval_status, "partial");
  assert.deepEqual(snapshot.journal.omissions, [{ reason: "journal_binding_changed", count: 1 }]);
  assert.deepEqual(env.counts, { candidate: 1, audit: 1, repair: 0, review: 0, discriminator: 0 });
});

test("the first writer's fresh compatibility assessment survives approval and delivery without repair", async (t) => {
  const env = await setup(t);
  const assessment = { version: 1, issue: "Synthetic present concern.", assessment_basis: "CURRENT_TURN", subject_context: "current_client",
    harm_intent: "not_supported", harm_intent_observation_ids: [], help_goal: "safe", help_goal_text: "Understand the present concern.", help_goal_observation_ids: [],
    nonharm_choice: "unknown", nonharm_choice_observation_ids: [], identity_inquiry_consent: "unknown", identity_inquiry_observation_ids: [],
    agreed_next_job: "ordinary", agreed_next_job_observation_ids: [], prior_restriction: "none", prior_restriction_observation_ids: [],
    correction_observation_ids: [], reentry_status: "not_required", reentry_observation_ids: [], human_review_required: false };
  const assessed = (previous, turnId, recordedAt) => updateProtectiveCompatibilityState(previous, assessment,
    protectiveCompatibilityDecision(assessment, previous), { turnId, recordedAt });
  const before = createEmptyCaseState({ caseId: CASE });
  before.protective_compatibility = assessed(null, "turn:prior", "2026-11-22T12:00:00.000Z");
  await env.store.saveCaseState(CASE, before);
  const produce = env.runtime.produceCandidate;
  env.runtime.produceCandidate = async (input) => {
    const output = await produce(input);
    output.caseState.protective_compatibility = assessed(before.protective_compatibility, input.runtimeTurn.user_turn_id, NOW);
    output.result = { compatibilityBinding: compatibilityStateBinding(output.caseState.protective_compatibility) };
    return output;
  };
  await env.controller().run(request());
  const record = await assertDelivered(env.store), candidate = record.candidate_responses[0];
  assert.equal(env.counts.repair, 0);
  assert.equal(env.counts.audit, 1);
  assert.equal(record.response_evidence_snapshots.length, 1);
  assert.equal(candidate.audit_history[0].verdict, "pass");
  assert.equal(candidate.metadata.response_evidence.compatibility_state_after_commit_binding, compatibilityStateBinding(record.case_state.protective_compatibility));
  assert.notEqual(candidate.metadata.response_evidence.compatibility_state_after_commit_binding, record.response_evidence_snapshots[0].dependency_binding.compatibility_state_binding);
  const preDelivery = structuredClone(record); preDelivery.raw_transcript.pop();
  preDelivery.case_state.protective_compatibility = assessed(record.case_state.protective_compatibility, "turn:foreign", "2026-11-23T13:00:00.000Z");
  assert.equal(preDelivery.case_state.protective_compatibility.current.gate, record.case_state.protective_compatibility.current.gate);
  assert.equal(responseEvidenceDependenciesCurrent(preDelivery, candidate, record.response_evidence_snapshots[0]), false);
});

test("record-only fallback findings use ordinary audit normalization through store save and delivery", async (t) => {
  const findings = [{ id: "record", code: "LONGITUDINAL_CONTEXT_MISSING", severity: "high", summary: "Earlier exact words are outside this packet." }];
  const env = await setup(t, { alwaysFail: true, questionFindings: findings });
  const result = await env.controller({ privateCaseSource: { ...env.store, savePrivateRuntimeDiscriminator(caseId, turnId, input) {
    // Exercise the store's own boundary with raw provider severities, independently of the controller's normalization.
    return env.store.savePrivateRuntimeDiscriminator(caseId, turnId, { ...input, review: { ...input.review, findings } });
  } } }).run(request());
  assert.equal(result.deliveryKind, "discriminator");
  const record = await assertDelivered(env.store), stored = record.runtime_turns[0].discriminator_review;
  assert.deepEqual(stored.findings, [{ ...findings[0], severity: "medium", reported_severity: "high", record_only: true }]);
  const invocation = record.runtime_turns[0].events.find(e => e.stage === "discriminator_review" && e.event_type === "INVOCATION_COMPLETED");
  assert.deepEqual(invocation.details.output.value.findings, findings, "the raw provider output stays sealed unchanged");
});

test("store discriminator validation normalizes record-only codes while retaining ordinary and evidence blockers", () => {
  const exactText = "What do you notice now?";
  const value = { schema_version: 1, exact_text_sha256: sha256Text(exactText), snapshot_id: "snapshot:one", snapshot_sha256: "a".repeat(64),
    auditor_context_id: "context:review", auditor_inclusion_sha256: "b".repeat(64), review: emptyReview(),
    findings: [{ id: "record", code: "LONGITUDINAL_CONTEXT_MISSING", severity: "high", summary: "Record only." }] };
  assert.doesNotThrow(() => validatePrivateRuntimeDiscriminatorReview(value, { exactText }));
  for (const finding of [
    { ...value.findings[0], code: "ORDINARY_BLOCKER" },
    { ...value.findings[0], id: "evidence:forged", severity: "medium" }
  ]) assert.throws(() => validatePrivateRuntimeDiscriminatorReview({ ...value, findings: [finding] }, { exactText }), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
});

for (const state of ["RECEIVED", "AUDITING", "RECONSTRUCTING", "DISCRIMINATING_QUESTION_REQUIRED"]) test(`restart preflight refreshes amended sources in ${state} before any model call`, async (t) => {
  const env = await setup(t, { alwaysFail: state === "DISCRIMINATING_QUESTION_REQUIRED", auditReview: (text, n) => state === "RECONSTRUCTING" && n === 0 ? unsupported(text) : emptyReview() });
  await env.store.appendTranscriptTurn(CASE, { id: "turn:older", exchange_id: "exchange:older", role: "user", text: "Earlier words.", at: NOW, episode_id: null });
  const method = state === "RECEIVED" ? "produceCandidate" : state === "RECONSTRUCTING" ? "repairCandidate" : state === "AUDITING" ? "auditCandidate" : "produceDiscriminator";
  const originalRuntime = { ...env.runtime };
  env.runtime[method] = async () => { throw new Error("unfinished model invocation"); };
  await assert.rejects(env.controller({ maximumInvocationAttempts: 1 }).run(request()));
  assert.equal((await env.store.load(CASE)).runtime_turns[0].state, state);
  await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:restart", targetTurnId: "turn:older", completionText: " Additional words.", sourceArtifactId: "source:restart", producerContextId: "operator:completion" });
  let calls = 0;
  for (const key of Object.keys(env.runtime)) env.runtime[key] = async () => { calls++; assert.fail("refresh must precede all model calls"); };
  const source = { ...env.store, async freezeResponseEvidence(...args) {
    const snapshot = await env.store.freezeResponseEvidence(...args);
    throw new Error(`refreshed:${snapshot.revision_reason}`);
  } };
  await assert.rejects(env.controller({ privateCaseSource: source }).run(request()), /refreshed:dependency_refresh/);
  assert.equal(calls, 0);
  assert.equal((await env.store.load(CASE)).response_evidence_snapshots.at(-1).revision, 2);
  Object.assign(env.runtime, originalRuntime);
  await env.controller().run(request());
  await assertDelivered(env.store);
});

for (const state of ["RECEIVED", "AUDITING", "RECONSTRUCTING", "DISCRIMINATING_QUESTION_REQUIRED"]) test(`exhausted stale ${state} performs no inference and delivers nothing`, async (t) => {
  const env = await setup(t, { alwaysFail: state === "DISCRIMINATING_QUESTION_REQUIRED", auditReview: (text, n) => state === "RECONSTRUCTING" && n === 0 ? unsupported(text) : emptyReview() });
  const method = state === "RECEIVED" ? "produceCandidate" : state === "RECONSTRUCTING" ? "repairCandidate" : state === "AUDITING" ? "auditCandidate" : "produceDiscriminator";
  env.runtime[method] = async () => { throw new Error("unfinished invocation"); };
  await assert.rejects(env.controller({ maximumInvocationAttempts: 1 }).run(request()));
  let snapshot = (await env.store.load(CASE)).response_evidence_snapshots.at(-1);
  for (const revision of [2, 3]) snapshot = await env.store.freezeResponseEvidence(CASE, { snapshotId: `snapshot:exhausted:${revision}`, owner: snapshot.owner,
    candidateOrigin: snapshot.candidate_origin, inbound: snapshot.inbound, revision, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" });
  await env.store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "input:exhausted", inputType: "client_message", text: "Changed after the final revision." }], channel: "owner_ui" });
  let calls = 0;
  for (const key of Object.keys(env.runtime)) env.runtime[key] = async () => { calls++; assert.fail("exhaustion needs no inference"); };
  const before = await env.store.load(CASE);
  await assert.rejects(env.controller().run(request()), { code: "THERAPY_RUNTIME_UNAVAILABLE" });
  const after = await env.store.load(CASE);
  assert.equal(calls, 0); assert.equal(after.response_evidence_snapshots.length, 3);
  assert.ok(after.raw_transcript.every(turn => turn.role !== "assistant"));
  if (state === "AUDITING") {
    const audit = after.candidate_responses[0].audit_history.at(-1);
    assert.equal(audit.findings[0].code, "RESPONSE_EVIDENCE_STALE");
    assert.equal(audit.independent, false);
    assert.equal(after.runtime_turns[0].state, "RECONSTRUCTING");
  } else assert.deepEqual(after, before);
});

test("unsupported evidence becomes a derived FAIL; repair receives the defect and stays current on revision one", async (t) => {
  const env = await setup(t, { auditReview: (text, n) => n === 0 ? unsupported(text) : emptyReview() });
  await env.controller().run(request());
  const record = await assertDelivered(env.store);
  assert.equal(record.candidate_responses[0].audit_history[0].findings[0].code, "RESPONSE_EVIDENCE_UNSUPPORTED");
  assert.match(record.candidate_responses[0].audit_history[0].findings[0].summary, /No supplied source/);
  assert.equal(record.response_evidence_snapshots.length, 1);
  assert.equal(env.calls.find((c) => c.stage === "repair").response_evidence_failures[0].assessment, "unsupported");
});

test("post-root case-state change produces stale FAIL, refresh, current repair and delivery", async (t) => {
  const env = await setup(t, { onAudit: async ({ store, n }) => {
    if (n) return;
    const state = await store.getCaseState(CASE); state.current_episode.target = "Owner changed the synthetic plan."; await store.saveCaseState(CASE, state);
  } });
  await env.controller().run(request()); const record = await assertDelivered(env.store);
  assert.equal(record.candidate_responses[0].audit_history[0].findings.at(-1).code, "RESPONSE_EVIDENCE_STALE");
  assert.deepEqual(record.response_evidence_snapshots.map((s) => s.revision_reason), ["initial", "dependency_refresh"]);
  assert.equal(record.candidate_responses.at(-1).metadata.response_evidence.established_context_after_commit_sha256, sha256Json(record.case_state));
  assert.ok(env.calls.find((c) => c.stage === "repair").responseEvidence.view.source_items.every((s) => s.kind !== "unsent_draft"));
});

for (const mode of ["timeout", "error", "legacy", "refusal"]) test(`journal ${mode} preserves a current-message delivery`, async (t) => {
  const env = await setup(t); let retrievals = 0;
  const provider = mode === "legacy" ? { async freezeForTurn() { retrievals++; throw new Error("must not call legacy"); } }
    : { async freezeResponseEvidenceJournal(input) {
      retrievals++; assert.equal(input.query, request().userMessage); assert.equal(input.maximumTokens, 8000); assert.equal(input.maximumBytes, 64000);
      if (mode === "timeout") return new Promise(() => {});
      throw Object.assign(new Error("Synthetic journal failure."), mode === "refusal" ? { code: "PRIVATE_CASE_ACCESS_DENIED" } : {});
    } };
  await env.controller({ journalEvidenceProvider: provider }).run(request());
  const snapshot = (await assertDelivered(env.store)).response_evidence_snapshots[0];
  assert.equal(retrievals, mode === "legacy" ? 0 : 1);
  assert.equal(snapshot.journal.retrieval_status, ["error", "timeout"].includes(mode) ? "failed" : "not_attempted");
  assert.equal(snapshot.journal.availability, mode === "refusal" ? "not_authorized" : "unavailable");
  if (mode === "legacy") assert.deepEqual(snapshot.journal.omissions, [{ reason: "legacy_provider_contract", count: 1 }]);
});

test("restart after sealed writer completion reuses the exact snapshot and does no second retrieval or writing", async (t) => {
  const env = await setup(t); let freezes = 0, retrievals = 0, interrupted = false;
  const source = { ...env.store,
    freezeResponseEvidence(...args) { freezes++; return env.store.freezeResponseEvidence(...args); },
    commitPrivateRuntimeCandidate(...args) { if (!interrupted) { interrupted = true; throw new Error("Synthetic restart boundary."); } return env.store.commitPrivateRuntimeCandidate(...args); }
  };
  const provider = { async freezeResponseEvidenceJournal() { retrievals++; return { availability: "available", retrieval_status: "no_match" }; } };
  await assert.rejects(env.controller({ privateCaseSource: source, journalEvidenceProvider: provider }).run(request()), /restart boundary/);
  const reopened = createEncryptedPrivateCaseStore(env.storeOptions); t.after(() => reopened.close());
  const resumedSource = { ...reopened, freezeResponseEvidence(...args) { freezes++; return reopened.freezeResponseEvidence(...args); } };
  await env.controller({ privateCaseSource: resumedSource, journalEvidenceProvider: provider }).run(request());
  await assertDelivered(reopened);
  assert.equal(freezes, 1); assert.equal(retrievals, 1); assert.equal(env.counts.candidate, 1);
});

test("restart records a completed audit before resolving amended sources or spending a revision", async (t) => {
  const env = await setup(t);
  await env.store.appendTranscriptTurn(CASE, { id: "turn:older", exchange_id: "exchange:older", role: "user", text: "Earlier words.", at: NOW, episode_id: null });
  await assert.rejects(env.controller({ privateCaseSource: { ...env.store, async commitPrivateRuntimeAudit() { throw new Error("completed audit boundary"); } } }).run(request()), /completed audit boundary/);
  await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:completed-audit", targetTurnId: "turn:older", completionText: " More exact words.", sourceArtifactId: "source:completed-audit", producerContextId: "operator:completion" });
  let calls = 0;
  for (const method of Object.keys(env.runtime)) env.runtime[method] = async () => { calls++; assert.fail("record completion before inference"); };
  const source = { ...env.store, async commitPrivateRuntimeAudit(...args) {
    await env.store.commitPrivateRuntimeAudit(...args); throw new Error("completion recorded");
  } };
  await assert.rejects(env.controller({ privateCaseSource: source }).run(request()), /completion recorded/);
  const record = await env.store.load(CASE), audit = record.candidate_responses[0].audit_history[0];
  assert.equal(calls, 0); assert.equal(record.response_evidence_snapshots.length, 1);
  assert.equal(audit.verdict, "fail"); assert.equal(audit.independent, true);
  assert.equal(audit.findings.at(-1).code, "RESPONSE_EVIDENCE_STALE");
});

for (const stage of ["candidate", "repair"]) test(`restart commits the completed ${stage} before resolving amended source evidence`, async (t) => {
  const env = await setup(t, { auditReview: (text, n) => stage === "repair" && n === 0 ? unsupported(text) : emptyReview() });
  await env.store.appendTranscriptTurn(CASE, { id: "turn:older", exchange_id: "exchange:older", role: "user", text: "Earlier incomplete words.", at: NOW, episode_id: null });
  let interrupted = false;
  const source = { ...env.store, commitPrivateRuntimeCandidate(...args) {
    if (!interrupted && Boolean(args[1].parentCandidateId) === (stage === "repair")) {
      interrupted = true; throw new Error("completed writer boundary");
    }
    return env.store.commitPrivateRuntimeCandidate(...args);
  } };
  await assert.rejects(env.controller({ privateCaseSource: source }).run(request()), /completed writer boundary/);
  const before = await env.store.load(CASE), completed = before.runtime_turns[0].events.filter(e => e.stage === stage && e.event_type === "INVOCATION_COMPLETED").at(-1);
  assert.ok(completed);
  await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:writer-pending", targetTurnId: "turn:older", completionText: " More exact words.", sourceArtifactId: "source:writer-pending", producerContextId: "operator:completion" });
  const reopened = createEncryptedPrivateCaseStore(env.storeOptions); t.after(() => reopened.close());
  await env.controller({ privateCaseSource: reopened }).run(request());
  const record = await assertDelivered(reopened), stale = record.candidate_responses.find(c => c.producer_context_id === completed.details.output.contextId);
  assert.equal(stale.exact_text, completed.details.output.exactText);
  assert.equal(stale.metadata.response_evidence.dependency_status, "stale_at_commit");
  assert.equal(stale.audit_history[0].verdict, "fail"); assert.equal(stale.audit_history[0].independent, false);
  assert.equal(stale.audit_history[0].findings[0].code, "RESPONSE_EVIDENCE_STALE");
  assert.equal(env.counts.candidate, 1); assert.equal(env.counts.repair, stage === "repair" ? 2 : 1);
  assert.equal(record.runtime_turns[0].events.filter(e => e.stage === stage && e.event_type === "INVOCATION_COMPLETED" && e.input_sha256 === completed.input_sha256).length, 1);
  const { originMainPrivateCaseValidator } = await import("./helpers/origin-main-private-case-validator.mjs");
  const validateOld = await originMainPrivateCaseValidator(t);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
});

test("missing history expands only once and two repairs never create a fourth revision", async (t) => {
  let retrievals = 0;
  const env = await setup(t, { auditReview: (text) => missing(text), onAudit: async ({ store, n }) => {
    const state = await store.getCaseState(CASE); state.current_episode.target = `Synthetic changed target ${n}.`; await store.saveCaseState(CASE, state);
  } });
  await assert.rejects(env.controller({ journalEvidenceProvider: { async freezeResponseEvidenceJournal() { retrievals++; return { availability: "available", retrieval_status: "no_match" }; } } }).run(request()), { code: "THERAPY_RUNTIME_UNAVAILABLE" });
  const record = await env.store.load(CASE);
  assert.deepEqual(record.response_evidence_snapshots.map((s) => s.revision_reason), ["initial", "evidence_expansion", "dependency_refresh"]);
  assert.equal(retrievals, 2); assert.equal(env.counts.repair, 2); assert.equal(env.counts.review, 0);
  assert.equal(record.runtime_turns[0].state, "DISCRIMINATING_QUESTION_REQUIRED");
  assert.ok(record.raw_transcript.every((turn) => turn.role !== "assistant"));
});

for (const bad of [false, true]) test(`fallback question evidence review (unsupported premise: ${bad})`, async (t) => {
  const env = await setup(t, { alwaysFail: true, badQuestion: bad, question: bad ? "Why did that earlier treatment fail?" : "What do you notice now?" });
  if (bad) {
    await assert.rejects(env.controller().run(request()), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
    const record = await env.store.load(CASE); assert.equal(record.runtime_turns[0].discriminator, null);
    assert.ok(record.raw_transcript.every((turn) => turn.role !== "assistant"));
  } else {
    assert.equal((await env.controller().run(request())).deliveryKind, "discriminator");
    const record = await assertDelivered(env.store); assert.ok(record.runtime_turns[0].discriminator_review);
    assert.equal(record.runtime_turns[0].discriminator.review, undefined);
  }
  assert.equal(env.counts.review, 1); assert.equal(env.counts.repair, 2);
});

test("a blocked question uses the already-authorized fixed owner fallback", async (t) => {
  const env = await setup(t, { alwaysFail: true, badQuestion: true, ownerFallback: true });
  const result = await env.controller().run(request()); assert.equal(result.deliveryKind, OWNER_FALLBACK_KIND); assert.equal(result.answer, OWNER_FALLBACK_MESSAGE);
  const record = await assertDelivered(env.store); assert.equal(record.runtime_turns[0].discriminator_review, undefined);
});

test("the store directly refuses a governed discriminator without a passing review", async (t) => {
  const env = await setup(t, { alwaysFail: true, badQuestion: true });
  await assert.rejects(env.controller().run(request()), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
  await assert.rejects(env.store.savePrivateRuntimeDiscriminator(CASE, "runtime:one", { exactText: "What do you notice now?", producerContextId: "context:discriminator:1" }), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
});

test("one missing-history expansion can repair and deliver within the original turn budget", async (t) => {
  const env = await setup(t, { auditReview: (text, n) => n === 0 ? missing(text) : emptyReview() }); let retrieved = 0;
  await env.controller({ journalEvidenceProvider: { async freezeResponseEvidenceJournal({ query }) {
    retrieved++; if (retrieved === 2) assert.equal(query, "What was already tried?");
    return { availability: "available", retrieval_status: "no_match" };
  } } }).run(request());
  const record = await assertDelivered(env.store);
  assert.deepEqual(record.response_evidence_snapshots.map((s) => s.revision_reason), ["initial", "evidence_expansion"]);
  assert.equal(retrieved, 2); assert.equal(env.counts.repair, 1);
});

test("a fallback refreshes changed dependencies before its one exact review", async (t) => {
  const env = await setup(t, { alwaysFail: true, onAudit: async ({ store, n }) => {
    if (n !== 2) return;
    const state = await store.getCaseState(CASE); state.current_episode.target = "Changed before fallback."; await store.saveCaseState(CASE, state);
  } });
  const result = await env.controller().run(request()); assert.equal(result.deliveryKind, "discriminator");
  const record = await assertDelivered(env.store);
  assert.deepEqual(record.response_evidence_snapshots.map((s) => s.revision_reason), ["initial", "dependency_refresh"]);
  assert.equal(record.runtime_turns[0].discriminator_review.snapshot_id, record.response_evidence_snapshots.at(-1).id);
});

test("an ordinary high fallback finding blocks even with a clean source-support review", async (t) => {
  const env = await setup(t, { alwaysFail: true, questionFindings: [{ id: "ordinary", code: "SYNTHETIC_HIGH", severity: "high", summary: "Synthetic blocking finding." }] });
  await assert.rejects(env.controller().run(request()), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
  assert.equal(env.counts.review, 1); assert.equal(env.counts.repair, 2);
});

test("direct discriminator delivery rechecks review bytes, sealed inclusion and current dependencies", async (t) => {
  const env = await setup(t, { alwaysFail: true });
  const source = { ...env.store, async deliverPrivateRuntimeDiscriminator() { throw new Error("Synthetic delivery boundary."); } };
  await assert.rejects(env.controller({ privateCaseSource: source }).run(request()), /delivery boundary/);
  const before = await env.store.load(CASE), turn = before.runtime_turns[0];
  assert.ok(turn.discriminator_review);
  for (const changed of [
    { ...turn.discriminator_review, exact_text_sha256: sha256Text("different bytes") },
    { ...turn.discriminator_review, auditor_inclusion_sha256: sha256Text("forged inclusion") },
    { ...turn.discriminator_review, auditor_context_id: "context:unsealed" },
    { ...turn.discriminator_review, snapshot_id: "snapshot:foreign" }
  ]) await assert.rejects(env.store.savePrivateRuntimeDiscriminator(CASE, turn.id, { exactText: turn.discriminator.exact_text, producerContextId: turn.discriminator.producer_context_id, review: changed }), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
  const state = await env.store.getCaseState(CASE); state.current_episode.target = "Changed after review."; await env.store.saveCaseState(CASE, state);
  await assert.rejects(env.store.deliverPrivateRuntimeDiscriminator(CASE, turn.id, { assistantTurnId: request().assistantTurnId, eventId: "stale:question" }), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
  assert.ok((await env.store.load(CASE)).raw_transcript.every((item) => item.role !== "assistant"));
});

for (const changed of [false, true]) test(`completed fallback review is replayed once across restart (later change: ${changed})`, async (t) => {
  const env = await setup(t, { alwaysFail: true });
  const source = { ...env.store, async savePrivateRuntimeDiscriminator() { throw new Error("Synthetic question-save boundary."); } };
  await assert.rejects(env.controller({ privateCaseSource: source }).run(request()), /question-save boundary/);
  if (changed) {
    const state = await env.store.getCaseState(CASE); state.current_episode.target = "Changed after the completed question review."; await env.store.saveCaseState(CASE, state);
    await assert.rejects(env.controller().run(request()), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
  } else {
    await env.controller().run(request()); await assertDelivered(env.store);
  }
  assert.equal(env.counts.review, 1);
});

for (const stage of ["original", "repair"]) test(`enforced commit refuses an ungoverned ${stage} candidate without mutation`, async (t) => {
  const env = await setup(t, { policy: "advisory", alwaysFail: true });
  let pending;
  const source = { ...env.store, async commitPrivateRuntimeCandidate(...args) {
    if ((stage === "repair") === Boolean(args[1].parentCandidateId)) { pending = args; throw new Error("commit boundary"); }
    return env.store.commitPrivateRuntimeCandidate(...args);
  } };
  await assert.rejects(env.controller({ privateCaseSource: source, responseEvidence: { enforced: false } }).run(request()), /commit boundary/);
  const enforced = createEncryptedPrivateCaseStore({ ...env.storeOptions, responseEvidencePolicy: "enforced" }); t.after(() => enforced.close());
  const before = await enforced.load(CASE);
  await assert.rejects(enforced.commitPrivateRuntimeCandidate(...pending), { code: "RESPONSE_EVIDENCE_REQUIRED" });
  assert.deepEqual(await enforced.load(CASE), before);
});

test("advisory PASS resumed under enforcement becomes a required FAIL and repairs on its first snapshot", async (t) => {
  const env = await setup(t, { policy: "advisory" });
  const source = { ...env.store, async commitPrivateRuntimeAudit() { throw new Error("audit boundary"); } };
  await assert.rejects(env.controller({ privateCaseSource: source, responseEvidence: { enforced: false } }).run(request()), /audit boundary/);
  const enforced = createEncryptedPrivateCaseStore({ ...env.storeOptions, responseEvidencePolicy: "enforced" }); t.after(() => enforced.close());
  await env.controller({ privateCaseSource: enforced }).run(request());
  const record = await assertDelivered(enforced), root = record.candidate_responses[0], repair = record.candidate_responses[1];
  assert.equal(root.audit_history[0].verdict, "fail");
  assert.equal(root.audit_history[0].findings.at(-1).code, "RESPONSE_EVIDENCE_REQUIRED");
  assert.equal(root.audit_history[0].findings.at(-1).derived_in_code, true);
  assert.equal(record.response_evidence_snapshots.length, 1);
  assert.equal(repair.metadata.response_evidence.dependency_status, "current_at_commit");
});

for (const saved of [false, true]) test(`enforcement resumes an advisory discriminator safely (saved: ${saved})`, async (t) => {
  const env = await setup(t, { policy: "advisory", alwaysFail: true });
  const source = { ...env.store, ...(saved
    ? { async deliverPrivateRuntimeDiscriminator() { throw new Error("question boundary"); } }
    : { async savePrivateRuntimeDiscriminator() { throw new Error("question boundary"); } }) };
  await assert.rejects(env.controller({ privateCaseSource: source, responseEvidence: { enforced: false } }).run(request()), /question boundary/);
  const enforced = createEncryptedPrivateCaseStore({ ...env.storeOptions, responseEvidencePolicy: "enforced" }); t.after(() => enforced.close());
  const before = await enforced.load(CASE), turn = before.runtime_turns[0];
  if (saved) {
    await assert.rejects(enforced.deliverPrivateRuntimeDiscriminator(CASE, turn.id, { assistantTurnId: request().assistantTurnId, eventId: "enforced:deliver" }), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
    assert.deepEqual(await enforced.load(CASE), before);
    await env.controller({ privateCaseSource: enforced }).run(request());
    const record = await assertDelivered(enforced);
    assert.equal(record.response_evidence_snapshots.length, 1);
    assert.ok(record.runtime_turns[0].discriminator_review);
    assert.equal(env.counts.review, 1);
  } else {
    await assert.rejects(enforced.savePrivateRuntimeDiscriminator(CASE, turn.id, { exactText: "What do you notice now?", producerContextId: "context:discriminator:1" }), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
    await env.controller({ privateCaseSource: enforced }).run(request());
    const record = await assertDelivered(enforced);
    assert.equal(record.response_evidence_snapshots.length, 1);
    assert.ok(record.runtime_turns[0].discriminator_review);
    assert.equal(env.counts.review, 1);
  }
});

test("source amendment before AUDITING records a trusted stale FAIL without an auditor and repairs after restart", async (t) => {
  const env = await setup(t);
  await env.store.appendTranscriptTurn(CASE, { id: "turn:older", exchange_id: "exchange:older", role: "user", text: "Earlier incomplete words.", at: NOW, episode_id: null });
  const source = { ...env.store, async transitionPrivateRuntimeTurn(...args) {
    const result = await env.store.transitionPrivateRuntimeTurn(...args);
    if (args[2].toState === "AUDITING") throw new Error("before audit boundary");
    return result;
  } };
  await assert.rejects(env.controller({ privateCaseSource: source }).run(request()), /before audit boundary/);
  const { chunkExactSourceText, createExactSourceArtifact } = await import("../src/storage/exact-source-artifact.mjs");
  const artifact = createExactSourceArtifact({ id: "source:amended", chunks: chunkExactSourceText("Earlier completed words."), createdAt: NOW });
  await env.store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:older", targetTurnId: "turn:older", completionText: artifact.exact_text, sourceArtifactId: artifact.id, producerContextId: "writer:completion" });
  await env.controller().run(request());
  const record = await assertDelivered(env.store), audit = record.candidate_responses[0].audit_history[0];
  assert.equal(audit.verdict, "fail"); assert.equal(audit.independent, false); assert.equal(audit.independent_auditor_available, false);
  assert.equal(audit.findings[0].code, "RESPONSE_EVIDENCE_STALE"); assert.equal(audit.findings[0].derived_in_code, true);
  assert.equal(env.counts.audit, 1); assert.equal(env.counts.repair, 1);
  assert.deepEqual(record.response_evidence_snapshots.map(s => s.revision_reason), ["initial", "dependency_refresh"]);
  const delivered = await env.store.load(CASE);
  await assert.rejects(env.store.commitPrivateRuntimeEvidenceStale(CASE, "runtime:one", { eventId: "illegal:stale" }));
  assert.deepEqual(await env.store.load(CASE), delivered);
});

test("origin/main reads a governed runtime delivery with a reviewed fallback", async (t) => {
  const { originMainPrivateCaseValidator } = await import("./helpers/origin-main-private-case-validator.mjs");
  const validateOld = await originMainPrivateCaseValidator(t);
  const env = await setup(t, { alwaysFail: true }); await env.controller().run(request());
  const record = await assertDelivered(env.store);
  assert.ok(record.runtime_turns[0].discriminator_review);
  assert.doesNotThrow(() => validateOld(structuredClone(record)));
});

// ---- The two optional hooks for a turn's journal (24 Nov 2026) ---------------------------------------------------------------------

// The runtime's hooks and calls, the freeze and the journal search, in the order they happen.
function hooked(env, { withheld = () => null, read = async () => {} } = {}) {
  const happened = [], inputs = [];
  env.runtime.readBeforeEvidence = async (input) => { happened.push("read"); inputs.push(input); return read(input); };
  env.runtime.journalWithheld = async (input) => { happened.push("withheld?"); return withheld(input); };
  for (const [method, name] of [["produceCandidate", "write"], ["repairCandidate", "repair"]]) {
    const original = env.runtime[method];
    env.runtime[method] = async (input) => { happened.push(Object.hasOwn(input, "turnRead") ? `${name}, read before` : name); return original(input); };
  }
  const source = { ...env.store, freezeResponseEvidence(...args) { happened.push("freeze"); return env.store.freezeResponseEvidence(...args); } };
  const searches = [];
  const journal = (part = { availability: "available", retrieval_status: "no_match" }) => ({ async freezeResponseEvidenceJournal(input) { happened.push("search"); searches.push(input); return typeof part === "function" ? part(input) : part; } });
  return { happened, inputs, searches, journal, source, controller: (extra) => env.controller({ privateCaseSource: source, ...extra }) };
}
const withheldPart = (snapshot) => [snapshot.journal.availability, snapshot.journal.retrieval_status, snapshot.journal.omissions, snapshot.journal.receipts];

test("a runtime that reads first is asked before anything is searched or frozen, and its writer is told", async (t) => {
  const env = await setup(t), h = hooked(env);
  await h.controller({ journalEvidenceProvider: h.journal() }).run({ ...request(), userInput: { newConversation: true } });
  await assertDelivered(env.store);
  assert.deepEqual(h.happened, ["read", "withheld?", "search", "freeze", "write, read before"]);
  assert.deepEqual([h.inputs[0].caseId, h.inputs[0].runtimeTurn.id, h.inputs[0].userInput], [CASE, "runtime:one", { newConversation: true }]);
  assert.deepEqual(Object.keys(h.searches[0]).sort(), ["authContext", "caseId", "maximumBytes", "maximumTokens", "query"], "the message's own search is asked for as before");
});

for (const [name, extra] of [
  ["no journal provider", {}],
  ["a provider of the older contract", { journalEvidenceProvider: { async freezeForTurn() { throw new Error("must not be called"); } } }]
]) test(`with ${name} nothing is read first and nothing else changes`, async (t) => {
  const env = await setup(t), h = hooked(env);
  await h.controller(extra).run(request());
  assert.deepEqual(h.happened, ["freeze", "write"]);
  assert.equal((await assertDelivered(env.store)).response_evidence_snapshots.length, 1);
});

test("with response evidence off nothing is read first", async (t) => {
  const env = await setup(t, { policy: "advisory" }), h = hooked(env);
  await h.controller({ responseEvidence: { enforced: false } }).run(request());
  assert.deepEqual(h.happened, ["write"]);
});

test("a turn that gets no journal makes no search, its own or the repair's, and each snapshot says why", async (t) => {
  const env = await setup(t, { auditReview: (text, n) => n === 0 ? missing(text) : emptyReview() }), h = hooked(env, { withheld: () => "crisis_turn" });
  await h.controller({ journalEvidenceProvider: h.journal() }).run(request());
  const record = await assertDelivered(env.store);
  assert.deepEqual(record.response_evidence_snapshots.map((snapshot) => [snapshot.revision_reason, ...withheldPart(snapshot)]), [
    ["initial", "unavailable", "not_attempted", [{ reason: "crisis_turn", count: 1 }], []], ["evidence_expansion", "unavailable", "not_attempted", [{ reason: "crisis_turn", count: 1 }], []]
  ]);
  assert.deepEqual(h.happened, ["read", "withheld?", "freeze", "write, read before", "withheld?", "freeze", "repair"]);
});

test("a decision that can't be made is a failed retrieval: no search, and the turn goes on without the journal", async (t) => {
  const env = await setup(t), h = hooked(env, { withheld: () => { throw new Error("Synthetic store failure."); } });
  await h.controller({ journalEvidenceProvider: h.journal() }).run(request());
  const [snapshot] = (await assertDelivered(env.store)).response_evidence_snapshots;
  assert.deepEqual([snapshot.journal.availability, snapshot.journal.retrieval_status], ["unavailable", "failed"]);
  assert.deepEqual(h.happened, ["read", "withheld?", "freeze", "write, read before"]);
});

test("a restart reads first again while there is no candidate, and not once a writer has finished; the frozen evidence is kept", async (t) => {
  const env = await setup(t), h = hooked(env);
  const provider = h.journal();
  const unfinished = { ...h.source, async recordPrivateRuntimeInvocationEvent() { throw new Error("Synthetic stop before the writer."); } };
  await assert.rejects(h.controller({ privateCaseSource: unfinished, journalEvidenceProvider: provider }).run(request()), /stop before the writer/u);
  assert.deepEqual(h.happened.splice(0), ["read", "withheld?", "search", "freeze"]);
  const uncommitted = { ...h.source, async commitPrivateRuntimeCandidate() { throw new Error("Synthetic stop after the writer."); } };
  await assert.rejects(h.controller({ privateCaseSource: uncommitted, journalEvidenceProvider: provider }).run(request()), /stop after the writer/u);
  assert.deepEqual(h.happened.splice(0), ["read", "write, read before"], "the snapshot it had, and no second search");
  await h.controller({ journalEvidenceProvider: provider }).run(request());
  assert.deepEqual(h.happened, [], "the finished writer's own evidence and words");
  assert.equal((await assertDelivered(env.store)).response_evidence_snapshots.length, 1);
});

test("a reading that fails stops the turn before anything is searched or frozen, as a failed step does", async (t) => {
  const env = await setup(t);
  let failing = true;
  const h = hooked(env, { read: async () => { if (failing) throw new Error("Synthetic reading failure."); } });
  await assert.rejects(h.controller({ journalEvidenceProvider: h.journal() }).run(request()), /reading failure/u);
  assert.deepEqual(h.happened.splice(0), ["read"]);
  assert.deepEqual((await env.store.load(CASE)).response_evidence_snapshots, []);
  failing = false;
  await h.controller({ journalEvidenceProvider: h.journal() }).run(request());
  await assertDelivered(env.store);
});

test("the expansion hands the reader each question and the part it adds to", async (t) => {
  const questions = ["What was already tried?", "And what helped?"];
  const review = (text) => ({ ...missing(text), missing_material_history: questions.map((question, index) => ({ ...missing(text).missing_material_history[0], id: `missing-${index}`, question })) });
  const env = await setup(t, { auditReview: (text, n) => n === 0 ? review(text) : emptyReview() }), h = hooked(env);
  await env.store.createJournalCorpus(CASE, { corpusId: "corpus:a", manifestObjectId: "manifest:a" });
  await env.store.publishJournalGeneration(CASE, { corpusId: "corpus:a", generation: "generation:one", manifestObjectId: "manifest:a" });
  const item = (number) => {
    const exact_excerpt = `Exact synthetic journal quotation ${number}.`;
    return { id: `src:journal:${number}`, kind: "journal_quotation", actor: "client", audience: "private_journal", time: { at: null, status: "unavailable" }, epistemic_status: "client_written_account",
      exact_excerpt, excerpt_sha256: sha256Text(exact_excerpt), excerpt_bytes: Buffer.byteLength(exact_excerpt),
      locator: { kind: "journal", corpus_id: "corpus:a", generation: "generation:one", visibility_epoch: 0, record_id: `record:${number}`, start_byte: 0, end_byte: Buffer.byteLength(exact_excerpt) } };
  };
  const found = (source_items) => ({ availability: "available", retrieval_status: "returned", source_items, coverage: "A synthetic search.", receipts: [{ operation_id: `retrieval:${source_items.length}`, corpus_id: "corpus:a",
    generation: "generation:one", visibility_epoch: 0, manifest_object_id: "manifest:a", purpose: "session_use", query_sha256: sha256Text("query"), filters_sha256: sha256Json({}), returned_source_ids: source_items.map((entry) => entry.id),
    packet_sha256: sha256Json(source_items), more_available: false, omitted_count: 0, budget_used_tokens: 0, budget_used_bytes: 0 }] });
  await h.controller({ journalEvidenceProvider: h.journal(({ addsTo }) => found(addsTo ? [...addsTo.source_items, item(3)] : [item(1), item(2)])) }).run(request());
  const record = await assertDelivered(env.store);
  assert.equal(h.searches.length, 2);
  assert.deepEqual([h.searches[1].query, h.searches[1].questions], [questions.join("\n"), questions]);
  const { source_items: added, ...part } = h.searches[1].addsTo;
  assert.deepEqual([added, part], [[item(1), item(2)], record.response_evidence_snapshots[0].journal]);
  assert.deepEqual(record.response_evidence_snapshots.map((snapshot) => snapshot.source_items.filter((entry) => entry.kind === "journal_quotation").map((entry) => entry.id)),
    [["src:journal:1", "src:journal:2"], ["src:journal:1", "src:journal:2", "src:journal:3"]]);
  assert.deepEqual(env.calls.find((entry) => entry.stage === "repair").responseEvidence.view.source_items.filter((entry) => entry.kind === "journal_quotation").map((entry) => entry.exact_excerpt),
    [1, 2, 3].map((number) => item(number).exact_excerpt), "the repair sees what the draft rested on, and what was added");
});
