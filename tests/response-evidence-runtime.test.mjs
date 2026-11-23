import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { createEncryptedPrivateCaseStore } from "../src/storage/private-case-store.mjs";
import { createPrivateTherapyTurnController } from "../src/supervisor/private-therapy-turn-controller.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS } from "../src/supervisor/private-candidate-lifecycle.mjs";
import { RESPONSE_EVIDENCE_DIMENSIONS, responseEvidenceDependenciesCurrent, sha256Json, sha256Text } from "../src/supervisor/response-evidence-contract.mjs";
import { responseEvidenceFailures } from "../src/supervisor/private-therapy-model-runtime.mjs";
import { OWNER_FALLBACK_KIND, OWNER_FALLBACK_MESSAGE } from "../src/supervisor/owner-fallback-message.mjs";

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
  const storeOptions = { rootDir, routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), developmentExternalCredentialAuthorized: true, responseEvidencePolicy: "enforced", now: () => NOW };
  const store = createEncryptedPrivateCaseStore(storeOptions);
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  const calls = [], counts = { candidate: 0, audit: 0, repair: 0, review: 0, discriminator: 0 };
  const runtime = {
    async produceCandidate({ runtimeTurn, responseEvidence }) {
      counts.candidate++; calls.push({ stage: "candidate", responseEvidence });
      return { exactText: "A synthetic current-message reply.", contextId: "context:writer", caseState: stateFor(runtimeTurn), responseEvidenceInclusion: inclusion(responseEvidence) };
    },
    async auditCandidate({ candidate, responseEvidence }) {
      const n = counts.audit++; calls.push({ stage: "audit", responseEvidence });
      if (options.onAudit) await options.onAudit({ store, candidate, responseEvidence, n });
      const review = options.auditReview?.(candidate.exact_text, n) ?? emptyReview();
      return { contextId: `context:audit:${n}`, responseEvidenceInclusion: inclusion(responseEvidence), value: { findings: options.alwaysFail ? [{ id: "ordinary", code: "SYNTHETIC", severity: "substantive", summary: "Synthetic repair." }] : [], repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...REPAIR_INDUCED_ERROR_CHECKS], evidence_review: review } };
    },
    async repairCandidate({ candidate, responseEvidence }) {
      const n = ++counts.repair;
      calls.push({ stage: "repair", responseEvidence, response_evidence_failures: responseEvidenceFailures(candidate.audit_history.at(-1)) });
      return { exactText: `Repaired current-message reply ${n}.`, contextId: `context:repair:${n}`, responseEvidenceInclusion: inclusion(responseEvidence) };
    },
    async produceDiscriminator({ evidenceReviewFailed }) {
      const n = ++counts.discriminator;
      if (evidenceReviewFailed && options.ownerFallback) return { kind: OWNER_FALLBACK_KIND, exactText: OWNER_FALLBACK_MESSAGE, contextId: `context:discriminator:${n}` };
      return { exactText: options.question ?? "What do you notice now?", contextId: `context:discriminator:${n}` };
    },
    async reviewFallbackQuestion({ exactText, responseEvidence }) {
      counts.review++;
      return { contextId: "context:question-review", responseEvidenceInclusion: inclusion(responseEvidence), value: { findings: options.questionFindings ?? [], repair_induced_checks: [], evidence_review: options.badQuestion ? unsupported(exactText) : emptyReview() } };
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

test("missing history expands only once and two repairs never create a fourth revision", async (t) => {
  let retrievals = 0;
  const env = await setup(t, { auditReview: (text) => missing(text), onAudit: async ({ store, n }) => {
    const state = await store.getCaseState(CASE); state.current_episode.target = `Synthetic changed target ${n}.`; await store.saveCaseState(CASE, state);
  } });
  await assert.rejects(env.controller({ journalEvidenceProvider: { async freezeResponseEvidenceJournal() { retrievals++; return { availability: "available", retrieval_status: "no_match" }; } } }).run(request()), { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
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
