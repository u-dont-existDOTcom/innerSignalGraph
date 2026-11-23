import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acquirePrivateRootWriterLock } from "../src/storage/shared-case-coordinator.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { loadConfig } from "../src/core/config.mjs";
import { readResponseEvidenceSetting, responseEvidenceReadback } from "../src/core/on-off-setting.mjs";
import { createPrivateCaseAccessService } from "../src/storage/private-case-access.mjs";
import { createEncryptedPrivateCaseStore, serializeVaultEnvelope, deserializeVaultEnvelope, validatePrivateCaseRecord } from "../src/storage/private-case-store.mjs";
import { createVaultEnvelope, decryptVaultEnvelopeWithRecoverySecret } from "../src/storage/vault-crypto.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS, createCandidateAuditEvidence, validateCandidateAuditEvidence } from "../src/supervisor/private-candidate-lifecycle.mjs";
import {
  RESPONSE_EVIDENCE_DIMENSIONS, buildEvidenceModelView, normalizeEvidenceReview, sha256Json, sha256Text,
  responseEvidenceSnapshotSha256, assessResponseEvidenceAdmission
} from "../src/supervisor/response-evidence-contract.mjs";

const CASE = "synthetic-evidence", NOW = "2026-11-23T12:00:00.000Z";
const inboundText = "Exact synthetic client words.";
const inbound = { turn_id: "turn:user", exact_text_sha256: sha256Text(inboundText), audience: "client", source_kind: "exact_client_turn" };
const freezeInput = (extra = {}) => ({ snapshotId: "snapshot:one", owner: { kind: "runtime_turn", runtime_turn_id: "runtime:one" }, revision: 1, parentSnapshotId: null, revisionReason: "initial", candidateOrigin: "backend_produced", inbound, ...extra });
const coverage = () => RESPONSE_EVIDENCE_DIMENSIONS.map((dimension) => ({ dimension, status: "assessed", reason: "Synthetic assessed coverage." }));
const review = () => ({ coverage: coverage(), items: [], missing_material_history: [] });
const errorCode = (code) => (error) => { assert.equal(error.code, code); assert.ok(!error.message.includes(inboundText)); return true; };
const turn = (id, text = "New synthetic client message.") => ({ id, exchange_id: id, role: "user", text, at: NOW, episode_id: null });

async function environment(t, policy = "advisory") {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-response-evidence-"));
  const options = { rootDir, routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), developmentExternalCredentialAuthorized: true, now: () => NOW };
  const store = createEncryptedPrivateCaseStore({ ...options, responseEvidencePolicy: policy });
  t.after(async () => { store.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
  // Synthetic fixture seeding only: no public mutation accepts snapshot/candidate metadata from a caller.
  const seed = async (record) => {
    const envelope = await createVaultEnvelope({ plaintextBytes: Buffer.from(JSON.stringify(record)), routineKek: options.routineKek, recoverySecretBytes: options.recoverySecretBytes });
    await fs.writeFile(path.join(rootDir, `${CASE}.vault.json`), JSON.stringify(serializeVaultEnvelope(envelope)), { mode: 0o600 });
  };
  await store.beginPrivateRuntimeTurn(CASE, { runtimeTurnId: "runtime:one", exchangeId: "exchange:one", userTurnId: inbound.turn_id, exactText: inboundText });
  return { store, rootDir, options, seed };
}
async function seal(store, { stage, contextId, output, key = stage, inputSha256 = sha256Text(key) }) {
  for (const [suffix, eventType] of [["start", "INVOCATION_STARTED"], ["complete", "INVOCATION_COMPLETED"]]) {
    await store.recordPrivateRuntimeInvocationEvent(CASE, "runtime:one", {
      eventId: `${key}:${suffix}`, eventType, stage, contextId: `attempt:${key}`, attempt: 1, inputSha256,
      details: suffix === "complete" ? { actual_context_id: contextId, output: { contextId, ...output } } : {}
    });
  }
}
async function governed(t, { policy = "advisory", beforeCommit = null } = {}) {
  const env = await environment(t, policy), { store } = env;
  const snapshot = await store.freezeResponseEvidence(CASE, freezeInput());
  const inclusion = { snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256, view_sha256: buildEvidenceModelView(await store.load(CASE), snapshot).view_sha256 };
  await seal(store, { stage: "candidate", contextId: "writer:one", output: { exactText: "Synthetic reply. What changed?", responseEvidenceInclusion: inclusion } });
  if (beforeCommit) await beforeCommit(store);
  const caseState = structuredClone((await store.load(CASE)).case_state);
  caseState.updated_at = "2026-11-23T13:00:00.000Z";
  await store.commitPrivateRuntimeCandidate(CASE, { runtimeTurnId: "runtime:one", candidateId: "candidate:one", exactText: "Synthetic reply. What changed?", producerContextId: "writer:one", caseState, responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: inclusion.view_sha256 }, eventId: "candidate:committed" });
  return { ...env, snapshot, inclusion, candidate: await store.getCandidateResponse(CASE, "candidate:one") };
}
function auditFor(candidate, snapshot = null, evidenceReview = review(), findings = [], id = "audit:one", inclusion = sha256Text("audit view")) {
  return createCandidateAuditEvidence({ auditId: id, candidate, auditVersion: "private-candidate-audit-v4", auditorContext: { kind: "independent", context_id: `${id}:context` }, findings,
    repairInducedChecks: candidate.parent_candidate_id == null ? [] : REPAIR_INDUCED_ERROR_CHECKS, completedAt: NOW,
    ...(snapshot ? { responseEvidence: { snapshotId: snapshot.id, snapshotSha256: snapshot.snapshot_sha256, auditorInclusionSha256: inclusion, review: evidenceReview, snapshot } } : {}) });
}
async function sealedAudit(env, evidenceReview = review(), findings = []) {
  const { store, candidate, snapshot } = env;
  const inclusion = { snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256, view_sha256: buildEvidenceModelView(await store.load(CASE), snapshot).view_sha256 };
  const audit = auditFor(candidate, snapshot, evidenceReview, findings, `audit:${candidate.id}`, inclusion.view_sha256);
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: `auditing:${candidate.id}`, toState: "AUDITING" });
  await seal(store, { stage: "audit", contextId: audit.auditor_context_id, key: audit.id, inputSha256: sha256Text(JSON.stringify({ candidate_id: candidate.id, candidate_version: candidate.version, candidate_sha256: sha256Text(candidate.exact_text), journal_evidence_sha256: null, response_evidence_snapshot_sha256: snapshot.snapshot_sha256 })), output: { value: { findings, repair_induced_checks: candidate.parent_candidate_id == null ? [] : REPAIR_INDUCED_ERROR_CHECKS, evidence_review: evidenceReview }, responseEvidenceInclusion: inclusion } });
  return audit;
}
const ordinaryFail = [{ id: "ordinary:failure", code: "SYNTHETIC_FAILURE", severity: "substantive", summary: "Synthetic failure." }];

for (const changed of [false, true]) test(`repair snapshot revision stays current after root commit (state changed: ${changed})`, async (t) => {
  const env = await governed(t), { store } = env;
  const audit = await sealedAudit(env, review(), ordinaryFail);
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "root:failed" });
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: "repair:started", toState: "RECONSTRUCTING" });
  let snapshot = env.snapshot;
  if (changed) {
    const state = await store.getCaseState(CASE); state.updated_at = "2026-11-23T14:00:00.000Z";
    await store.saveCaseState(CASE, state);
    snapshot = await store.freezeResponseEvidence(CASE, freezeInput({ snapshotId: "snapshot:refresh", revision: 2, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" }));
  }
  const inclusion = { snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256, view_sha256: buildEvidenceModelView(await store.load(CASE), snapshot).view_sha256 };
  await seal(store, { stage: "repair", contextId: "writer:repair", output: { exactText: "Repaired synthetic reply.", responseEvidenceInclusion: inclusion } });
  await store.commitPrivateRuntimeCandidate(CASE, { runtimeTurnId: "runtime:one", candidateId: "candidate:repair", parentCandidateId: env.candidate.id, basedOnAuditId: audit.id, exactText: "Repaired synthetic reply.", producerContextId: "writer:repair", responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: inclusion.view_sha256 }, eventId: "repair:committed" });
  const candidate = await store.getCandidateResponse(CASE, "candidate:repair");
  assert.equal(candidate.metadata.response_evidence.dependency_status, "current_at_commit");
  assert.equal(candidate.metadata.response_evidence.established_context_after_commit_sha256, sha256Json((await store.load(CASE)).case_state));
  const passing = await sealedAudit({ ...env, candidate, snapshot });
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", passing, { eventId: "repair:passed" });
  await store.deliverPrivateRuntimeCandidate(CASE, "runtime:one", { candidateId: candidate.id, assistantTurnId: "turn:repair", eventId: "repair:delivered" });
});

test("ordinary audit recording preserves a valid snapshot PASS after dependencies change", async (t) => {
  const env = await governed(t);
  const audit = await sealedAudit(env);
  const state = await env.store.getCaseState(CASE); state.updated_at = "2026-11-23T15:00:00.000Z";
  await env.store.saveCaseState(CASE, state);
  await env.store.recordCandidateAudit(CASE, env.candidate.id, audit);
  assert.equal((await env.store.getCandidateResponse(CASE, env.candidate.id)).audit_history.at(-1).verdict, "pass");
  await assert.rejects(env.store.approveCandidateForDelivery(CASE, env.candidate.id), errorCode("RESPONSE_EVIDENCE_STALE"));
});
const unsupportedReview = () => ({ ...review(), items: [{ id: "unsupported", dimension: "personal_history", kind: "claim", candidate_quote: "Synthetic reply.", source_ids: [], assessment: "unsupported", reason: "No source." }] });

function journalItem(id, exactExcerpt) {
  return { id: `src:journal:${id}`, kind: "journal_quotation", actor: "client", audience: "private_journal", time: { at: null, status: "unavailable" }, epistemic_status: "client_written_account", excerpt_sha256: sha256Text(exactExcerpt), excerpt_bytes: Buffer.byteLength(exactExcerpt), exact_excerpt: exactExcerpt,
    locator: { kind: "journal", corpus_id: "corpus:one", generation: "generation:one", visibility_epoch: 0, record_id: `record:${id}`, start_byte: 0, end_byte: Buffer.byteLength(exactExcerpt) } };
}
function journal(items) {
  return { availability: "available", retrieval_status: "returned", source_items: items, receipts: [{ operation_id: "retrieval:one", corpus_id: "corpus:one", generation: "generation:one", visibility_epoch: 0, purpose: "session_use", query_sha256: sha256Text("query"), filters_sha256: sha256Text("filters"), returned_source_ids: items.map((item) => item.id), packet_sha256: sha256Json(items), more_available: false, omitted_count: 0, budget_used_tokens: 0, budget_used_bytes: 0 }] };
}
async function corpus(store) {
  await store.createJournalCorpus(CASE, { corpusId: "corpus:one", manifestObjectId: "manifest:one" });
  await store.publishJournalGeneration(CASE, { corpusId: "corpus:one", generation: "generation:one", manifestObjectId: "manifest:one" });
}

test("freeze is persisted, replayed without a revision and conflicting input is refused", async (t) => {
  const { store } = await environment(t);
  const first = await store.freezeResponseEvidence(CASE, freezeInput()), revision = (await store.load(CASE)).revision;
  assert.deepEqual(await store.freezeResponseEvidence(CASE, freezeInput()), first);
  assert.equal((await store.load(CASE)).revision, revision);
  await assert.rejects(store.freezeResponseEvidence(CASE, freezeInput({ candidateOrigin: "external_draft" })), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await assert.rejects(store.freezeResponseEvidence(CASE, freezeInput({ historyRequirements: [{ id: "history", topic: "topic", why_material: "reason", source_ids: [], disposition: "open" }] })), errorCode("RESPONSE_EVIDENCE_INVALID"));
  assert.equal((await store.load(CASE)).response_evidence_snapshots.length, 1);
});

test("journal budgets count actual serialized excerpts, omit whole items and never cut a single oversized quotation", async (t) => {
  const { store } = await environment(t); await corpus(store);
  const items = [journalItem("1", "a".repeat(12000)), journalItem("2", "b".repeat(12000)), journalItem("3", "c".repeat(65000)), journalItem("4", "short exact quotation")];
  const snapshot = await store.freezeResponseEvidence(CASE, freezeInput({ journal: journal(items) }));
  const kept = snapshot.source_items.filter((item) => item.kind === "journal_quotation");
  assert.deepEqual(kept.map((item) => item.exact_excerpt), [items[0].exact_excerpt, items[3].exact_excerpt]);
  assert.equal(snapshot.journal.omissions[0].count, 2);
  assert.equal(snapshot.journal.budget.used_tokens, kept.reduce((sum, item) => sum + Math.ceil(Buffer.byteLength(JSON.stringify(item.exact_excerpt)) / 3), 0));
  assert.ok(snapshot.journal.budget.used_tokens <= 8000);
  assert.ok(snapshot.journal.budget.used_bytes <= 64000);
  await assert.rejects(store.freezeResponseEvidence(CASE, freezeInput({ snapshotId: "bad", revision: 2, parentSnapshotId: snapshot.id, revisionReason: "evidence_expansion", journal: { availability: "invented" } })), errorCode("RESPONSE_EVIDENCE_INVALID"));
});

test("governed first commit binds the sealed writer, normalizes inbound insertion, and exact current review admits runtime delivery", async (t) => {
  const env = await governed(t), { store, candidate, snapshot } = env;
  assert.equal(candidate.metadata.response_evidence.dependency_status, "current_at_commit");
  assert.equal(candidate.metadata.response_evidence.established_context_after_commit_sha256, sha256Json((await store.load(CASE)).case_state));
  const audit = await sealedAudit(env);
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "audit:committed" });
  assert.equal((await store.getPrivateRuntimeTurn(CASE, "runtime:one")).state, "APPROVED");
  assert.equal(assessResponseEvidenceAdmission(await store.load(CASE), await store.getCandidateResponse(CASE, candidate.id), { policy: "advisory" }).admissible, true);
  await assert.rejects(store.markCandidateSent(CASE, candidate.id), errorCode("RESPONSE_EVIDENCE_LEGACY_EXIT_REFUSED"));
  await store.deliverPrivateRuntimeCandidate(CASE, "runtime:one", { candidateId: candidate.id, assistantTurnId: "turn:assistant", eventId: "delivered" });
  const record = await store.load(CASE);
  assert.equal(record.raw_transcript.at(-1).text, candidate.exact_text);
  assert.equal(record.response_evidence_snapshots[0].snapshot_sha256, snapshot.snapshot_sha256);
});

for (const exit of ["recordCandidateAudit", "commitPrivateRuntimeAudit"]) {
  test(`${exit} refuses generic PASS without review and preserves an ordinary valid FAIL`, async (t) => {
    const env = await governed(t), { store, candidate } = env;
    const pass = auditFor(candidate);
    if (exit === "commitPrivateRuntimeAudit") {
      await sealedAudit(env);
    }
    const invoke = (audit) => exit === "recordCandidateAudit" ? store.recordCandidateAudit(CASE, candidate.id, audit) : store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "audit:committed" });
    const generic = exit === "commitPrivateRuntimeAudit" ? auditFor(candidate, null, review(), [], `audit:${candidate.id}`) : pass;
    await assert.rejects(invoke(generic), errorCode("RESPONSE_EVIDENCE_INVALID"));
    const fail = auditFor(candidate, null, review(), ordinaryFail, exit === "commitPrivateRuntimeAudit" ? `audit:${candidate.id}` : "audit:fail");
    await invoke(fail);
    assert.equal((await store.getCandidateResponse(CASE, candidate.id)).audit_history.at(-1).verdict, "fail");
  });
}

test("forged, foreign and altered snapshots and writer receipts are refused before a candidate is stored", async (t) => {
  const { store } = await environment(t);
  const snapshot = await store.freezeResponseEvidence(CASE, freezeInput());
  await seal(store, { stage: "candidate", contextId: "writer:one", output: { exactText: "Exact draft.", responseEvidenceInclusion: { snapshot_id: snapshot.id, snapshot_sha256: sha256Text("forged"), view_sha256: sha256Text("view") } } });
  for (const snapshotId of ["foreign:snapshot", snapshot.id]) await assert.rejects(store.commitPrivateRuntimeCandidate(CASE, { runtimeTurnId: "runtime:one", candidateId: "candidate:one", exactText: "Exact draft.", producerContextId: "writer:one", caseState: createEmptyCaseState({ caseId: CASE }), responseEvidence: { snapshotId, writerInclusionSha256: sha256Text("view") }, eventId: "commit" }), errorCode("RESPONSE_EVIDENCE_INVALID"));
  assert.equal((await store.load(CASE)).candidate_responses.length, 0);
});

test("a supplied review cannot omit, alter or downgrade any derived finding", async (t) => {
  const env = await governed(t), { store, candidate, snapshot } = env;
  const audit = auditFor(candidate, snapshot, unsupportedReview());
  assert.equal(audit.verdict, "fail");
  const forged = structuredClone(audit); forged.findings = []; forged.unresolved_substantive_finding_ids = []; forged.verdict = "pass"; forged.sufficient_for_approval = true;
  await assert.rejects(store.recordCandidateAudit(CASE, candidate.id, forged), errorCode("RESPONSE_EVIDENCE_INVALID"));
  const altered = structuredClone(audit); altered.findings[0].summary = "Invented replacement.";
  await assert.rejects(store.recordCandidateAudit(CASE, candidate.id, altered), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await store.recordCandidateAudit(CASE, candidate.id, audit);
  assert.equal((await store.getCandidateResponse(CASE, candidate.id)).status, "audit_failed");
});

test("a governed PASS whose dependencies changed is stored as a consistent stale FAIL", async (t) => {
  const env = await governed(t), { store, candidate } = env;
  const audit = await sealedAudit(env);
  await store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "owner:one", inputType: "supervisor_revision", text: "A new instruction." }], channel: "owner_ui" });
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "audit:committed" });
  const stored = await store.getCandidateResponse(CASE, candidate.id), evidence = stored.audit_history.at(-1);
  assert.equal(evidence.verdict, "fail"); assert.equal(evidence.sufficient_for_approval, false);
  assert.equal(evidence.findings.at(-1).code, "RESPONSE_EVIDENCE_STALE");
  assert.equal(validateCandidateAuditEvidence(evidence, stored), evidence);
  assert.equal((await store.getPrivateRuntimeTurn(CASE, "runtime:one")).state, "REPAIR_REQUIRED");
});

const invalidate = {
  correction: (store) => store.appendTranscriptCompletionAmendment(CASE, { amendmentId: "amendment:one", targetTurnId: inbound.turn_id, completionText: " Completed synthetic words.", sourceArtifactId: "source:completion", producerContextId: "operator:one" }),
  owner_input: (store) => store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "owner:one", inputType: "supervisor_revision", text: "New synthetic owner instruction." }], channel: "owner_ui" }),
  client_turn: (store) => store.appendTranscriptTurn(CASE, turn("turn:newer"))
};
for (const [reason, change] of Object.entries(invalidate)) {
  test(`approval and both delivery exits refuse stale evidence after ${reason}`, async (t) => {
    const env = await governed(t), { store, candidate } = env;
    const audit = await sealedAudit(env);
    await store.recordCandidateAudit(CASE, candidate.id, audit);
    await change(store);
    await assert.rejects(store.approveCandidateForDelivery(CASE, candidate.id, audit.id), errorCode("RESPONSE_EVIDENCE_STALE"));
    // An approved synthetic checkpoint from before the change tests the two delivery exits directly.
    const current = await store.load(CASE), approved = current.candidate_responses.at(-1);
    approved.status = "approved_for_delivery"; approved.metadata.approval_audit_id = audit.id;
    const runtime = current.runtime_turns[0];
    runtime.state = "APPROVED"; runtime.events.push({ id: "fixture:approved", sequence: runtime.events.length + 1, event_type: "STATE_TRANSITION", from_state: "AUDITING", to_state: "APPROVED", at: NOW, details: {} });
    await env.seed(current);
    await assert.rejects(store.deliverCandidateResponse(CASE, candidate.id, { auditId: audit.id, assistantTurnId: "turn:assistant", inReplyToTurnId: inbound.turn_id }), errorCode("RESPONSE_EVIDENCE_STALE"));
    await assert.rejects(store.deliverPrivateRuntimeCandidate(CASE, "runtime:one", { candidateId: candidate.id, assistantTurnId: "turn:assistant", eventId: "delivered" }), errorCode("RESPONSE_EVIDENCE_STALE"));
  });
}

test("stale work at candidate commit is preserved with no established digest", async (t) => {
  const env = await governed(t, { beforeCommit: (store) => store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "new-input", inputType: "supervisor_revision", text: "Changed context." }], channel: "owner_ui" }) });
  assert.equal(env.candidate.metadata.response_evidence.dependency_status, "stale_at_commit");
  assert.equal(env.candidate.metadata.response_evidence.established_context_after_commit_sha256, null);
});

for (const policy of ["advisory", "enforced"]) {
  test(`ungoverned candidates under ${policy} retain legacy audit behavior and enforce exit policy`, async (t) => {
    const { store } = await environment(t, policy);
    await store.saveCandidateResponse(CASE, "ordinary", "Ordinary synthetic reply.", { producer_context_id: "ordinary:writer" });
    const candidate = await store.getCandidateResponse(CASE, "ordinary"), audit = auditFor(candidate);
    await store.recordCandidateAudit(CASE, candidate.id, audit);
    if (policy === "advisory") {
      await store.approveCandidateForDelivery(CASE, candidate.id, audit.id); await store.markCandidateSent(CASE, candidate.id);
      assert.equal((await store.getCandidateResponse(CASE, candidate.id)).status, "sent");
    } else {
      await assert.rejects(store.approveCandidateForDelivery(CASE, candidate.id, audit.id), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
      await assert.rejects(store.markCandidateSent(CASE, candidate.id), errorCode("RESPONSE_EVIDENCE_LEGACY_EXIT_REFUSED"));
    }
  });
}

test("supervisor approval and export refuse ungoverned candidates under enforcement", async (t) => {
  const env = await environment(t);
  await env.store.appendTranscriptTurn(CASE, turn(inbound.turn_id, inboundText));
  const submitted = await env.store.submitSupervisorDraft(CASE, { operationKey: "a".repeat(24), source: "external_draft", exactText: "Supervisor exact reply.", producerContextId: "external:writer", channel: "owner_ui" });
  const candidate = await env.store.getCandidateResponse(CASE, submitted.artifact.candidate_id), audit = auditFor(candidate);
  await env.store.recordSupervisorAudit(CASE, candidate.id, audit);
  const store = createEncryptedPrivateCaseStore({ ...env.options, responseEvidencePolicy: "enforced" });
  t.after(() => store.close());
  await assert.rejects(store.approveSupervisorDraft(CASE, candidate.id, audit.id), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
  await assert.rejects(store.exportSupervisorArtifact(CASE, { artifactId: submitted.artifact.artifact_id, channel: "owner_ui" }), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
});

test("older encrypted records normalize the field, retain unknown additive fields, and refuse caller metadata", async (t) => {
  const { store, seed } = await environment(t), record = await store.load(CASE);
  delete record.response_evidence_snapshots; record.future_additive_field = { retained: true };
  await seed(record);
  assert.deepEqual((await store.load(CASE)).response_evidence_snapshots, []);
  await store.saveCaseState(CASE, record.case_state);
  assert.deepEqual((await store.load(CASE)).future_additive_field, { retained: true });
  await assert.rejects(store.saveCandidateResponse(CASE, "injected", "Draft.", { producer_context_id: "writer", response_evidence: {} }), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await store.saveCandidateResponse(CASE, "clean", "Draft.", { producer_context_id: "writer" });
  await assert.rejects(store.updateCandidateStatus(CASE, "clean", "superseded", { response_evidence: {} }), errorCode("RESPONSE_EVIDENCE_INVALID"));
});

test("the access wrapper keeps runtime write scope and propagates the policy to opened stores", async (t) => {
  const env = await environment(t), { rootDir } = env;
  let scope = null;
  const access = createPrivateCaseAccessService({ rootDir, responseEvidencePolicy: "enforced",
    authorizationProvider: { async authorize({ requiredScope }) { scope = requiredScope; return { allowed: true, principalId: "synthetic", scopes: [requiredScope] }; } },
    keyProvider: { async getCaseKeyMaterial() { return { routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), accessAssurance: "managed_secret_provider", managedSecretProvider: true }; } }
  });
  await access.freezeResponseEvidence(CASE, freezeInput(), {}); assert.equal(scope, "case:write");
  await assert.rejects(access.saveCandidateResponse(CASE, "candidate:bad", "Draft.", { producer_context_id: "writer", response_evidence: {} }, {}), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await access.saveCandidateResponse(CASE, "ordinary", "Ordinary reply.", { producer_context_id: "ordinary:writer" }, {});
  const candidate = await access.getCandidateResponse(CASE, "ordinary", {}), audit = auditFor(candidate);
  await access.recordCandidateAudit(CASE, candidate.id, audit, {});
  await assert.rejects(access.approveCandidateForDelivery(CASE, candidate.id, audit.id, {}), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
  assert.throws(() => createPrivateCaseAccessService({ rootDir, responseEvidencePolicy: "invalid" }), errorCode("RESPONSE_EVIDENCE_INVALID"));
});

test("the response evidence switch defaults off, rejects bad values without echoing them and has content-free readback", () => {
  assert.equal(readResponseEvidenceSetting({}), false);
  for (const word of ["on", " yes ", "TRUE", "1"]) assert.equal(readResponseEvidenceSetting({ INNER_SIGNAL_RESPONSE_EVIDENCE: word }), true);
  assert.throws(() => readResponseEvidenceSetting({ INNER_SIGNAL_RESPONSE_EVIDENCE: "secret-invalid-value" }), (error) => error.code === "BAD_CONFIG" && !error.message.includes("secret-invalid-value"));
  assert.equal(loadConfig({ mode: "mock", responseEvidenceEnforced: true }).responseEvidenceEnforced, true);
  assert.deepEqual(responseEvidenceReadback(true), { runtime: "internal_runtime_enforced", supervisorExport: "supervisor_export_enforced", journalProvider: "unconfigured" });
});

test("snapshot, v5 audit and candidate metadata agree with the public schemas", async (t) => {
  const env = await governed(t), audit = await sealedAudit(env);
  await env.store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "audit:committed" });
  const ajv = new Ajv2020({ strict: true, validateFormats: false });
  const readSchema = async (name) => JSON.parse(await fs.readFile(new URL(`../schemas/private-case/${name}.schema.json`, import.meta.url), "utf8"));
  const snapshotSchema = await readSchema("response-evidence-snapshot-v1");
  const auditSchema = await readSchema("candidate-audit-v1");
  ajv.addSchema(auditSchema);
  for (const [schema, data] of [[snapshotSchema, env.snapshot], [auditSchema, audit], [await readSchema("candidate-version-v1"), await env.store.getCandidateResponse(CASE, env.candidate.id)]]) {
    const validate = ajv.compile(schema); assert.equal(validate(data), true, JSON.stringify(validate.errors));
  }
});

// A2 will bind supervisor metadata in its trusted submission path. Seed only that additive binding in this synthetic encrypted
// fixture, then exercise A1's real supervisor audit, approval and export methods without adding a caller injection API.
async function supervisorGoverned(t) {
  const env = await environment(t), { store } = env;
  await store.appendTranscriptTurn(CASE, turn(inbound.turn_id, inboundText));
  const operationKey = "b".repeat(24);
  const snapshot = await store.freezeResponseEvidence(CASE, freezeInput({ snapshotId: "snapshot:supervisor", owner: { kind: "supervisor_draft", operation_key: operationKey }, candidateOrigin: "external_draft" }));
  const submitted = await store.submitSupervisorDraft(CASE, { operationKey, source: "external_draft", exactText: "Synthetic reply. What changed?", producerContextId: "external:writer", channel: "owner_ui" });
  const record = await store.load(CASE), candidate = record.candidate_responses.at(-1);
  candidate.metadata.response_evidence = { schema_version: 1, policy_version: "response-evidence-v1", snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256, candidate_origin: "external_draft", writer_inclusion: "not_attested", writer_inclusion_sha256: null, established_context_after_commit_sha256: snapshot.dependency_binding.established_context_digest, dependency_status: "current_at_commit" };
  await env.seed(record);
  return { ...env, snapshot, candidate, artifactId: submitted.artifact.artifact_id };
}
async function supervisorAudit(env, evidenceReview = review(), findings = []) {
  const viewSha = buildEvidenceModelView(await env.store.load(CASE), env.snapshot).view_sha256;
  const audit = auditFor(env.candidate, env.snapshot, evidenceReview, findings, "supervisor:audit", viewSha);
  const receipt = { disclosureManifest: { response_evidence_view_included: true }, providerReceipt: { provider: "synthetic", model: "synthetic-reviewer", response_id: "response:supervisor" } };
  return { audit, receipt };
}

test("recordSupervisorAudit refuses generic or mismatched PASS, preserves FAIL and admits a valid exact review", async (t) => {
  const env = await supervisorGoverned(t), { store, candidate } = env;
  await assert.rejects(store.recordSupervisorAudit(CASE, candidate.id, auditFor(candidate)), errorCode("RESPONSE_EVIDENCE_INVALID"));
  const { audit, receipt } = await supervisorAudit(env);
  const mismatched = structuredClone(audit); mismatched.response_evidence.auditor_inclusion_sha256 = "0".repeat(64);
  await assert.rejects(store.recordSupervisorAudit(CASE, candidate.id, mismatched, receipt), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await store.recordSupervisorAudit(CASE, candidate.id, audit, receipt);
  await store.approveSupervisorDraft(CASE, candidate.id, audit.id);
  const exported = await store.exportSupervisorArtifact(CASE, { artifactId: env.artifactId, channel: "owner_ui" });
  assert.equal(exported.client_text, candidate.exact_text);
  assert.equal((await store.exportSupervisorArtifact(CASE, { artifactId: env.artifactId, channel: "owner_ui" })).replayed, true);
  const failing = await supervisorGoverned(t);
  await failing.store.recordSupervisorAudit(CASE, failing.candidate.id, auditFor(failing.candidate, null, review(), ordinaryFail), receipt);
  assert.equal((await failing.store.getCandidateResponse(CASE, failing.candidate.id)).status, "audit_failed");
});

for (const [reason, change] of Object.entries(invalidate)) {
  test(`supervisor approval preserves a reviewed draft but export refuses stale evidence after ${reason}`, async (t) => {
    const env = await supervisorGoverned(t), { store, candidate } = env;
    const { audit, receipt } = await supervisorAudit(env);
    await store.recordSupervisorAudit(CASE, candidate.id, audit, receipt);
    await store.approveSupervisorDraft(CASE, candidate.id, audit.id);
    await change(store);
    await assert.rejects(store.exportSupervisorArtifact(CASE, { artifactId: env.artifactId, channel: "owner_ui" }), errorCode("SUPERVISOR_ARTIFACT_STALE"));
    const record = await store.load(CASE); record.candidate_responses.at(-1).status = "audited"; delete record.candidate_responses.at(-1).metadata.approval_audit_id;
    await env.seed(record);
    await assert.rejects(store.approveCandidateForDelivery(CASE, candidate.id, audit.id), errorCode("RESPONSE_EVIDENCE_STALE"));
    await store.approveSupervisorDraft(CASE, candidate.id, audit.id);
    await assert.rejects(store.exportSupervisorArtifact(CASE, { artifactId: env.artifactId, channel: "owner_ui" }), errorCode("SUPERVISOR_ARTIFACT_STALE"));
  });
}

test("a current governed review also admits the ordinary approval and transcript-bound delivery exits", async (t) => {
  const env = await governed(t), { store, candidate } = env;
  const audit = await sealedAudit(env);
  await store.recordCandidateAudit(CASE, candidate.id, audit);
  await store.approveCandidateForDelivery(CASE, candidate.id, audit.id);
  await store.deliverCandidateResponse(CASE, candidate.id, { auditId: audit.id, assistantTurnId: "turn:assistant", inReplyToTurnId: inbound.turn_id });
  assert.equal((await store.load(CASE)).raw_transcript.at(-1).text, candidate.exact_text);
});

test("a repaired runtime candidate must bind the newest snapshot revision and inherits the root established digest", async (t) => {
  const env = await governed(t), { store, candidate, snapshot } = env;
  const fail = await sealedAudit(env, review(), ordinaryFail);
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", fail, { eventId: "audit:failed" });
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: "reconstructing", toState: "RECONSTRUCTING" });
  const revised = await store.freezeResponseEvidence(CASE, freezeInput({ snapshotId: "snapshot:two", revision: 2, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" }));
  const inclusion = { snapshot_id: revised.id, snapshot_sha256: revised.snapshot_sha256, view_sha256: buildEvidenceModelView(await store.load(CASE), revised).view_sha256 };
  await seal(store, { stage: "repair", contextId: "repair:writer", output: { exactText: "Repaired synthetic reply.", responseEvidenceInclusion: inclusion } });
  const input = { runtimeTurnId: "runtime:one", candidateId: "candidate:repair", parentCandidateId: candidate.id, basedOnAuditId: fail.id, exactText: "Repaired synthetic reply.", producerContextId: "repair:writer", eventId: "repair:committed" };
  await assert.rejects(store.commitPrivateRuntimeCandidate(CASE, input), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
  await assert.rejects(store.commitPrivateRuntimeCandidate(CASE, { ...input, responseEvidence: { snapshotId: snapshot.id, writerInclusionSha256: inclusion.view_sha256 } }), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await store.commitPrivateRuntimeCandidate(CASE, { ...input, responseEvidence: { snapshotId: revised.id, writerInclusionSha256: inclusion.view_sha256 } });
  const repair = await store.getCandidateResponse(CASE, "candidate:repair");
  assert.equal(repair.metadata.response_evidence.snapshot_id, revised.id);
  assert.equal(repair.metadata.response_evidence.established_context_after_commit_sha256, candidate.metadata.response_evidence.established_context_after_commit_sha256);
  const pass = await sealedAudit({ ...env, candidate: repair, snapshot: revised });
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", pass, { eventId: "repair:audited" });
  await store.deliverPrivateRuntimeCandidate(CASE, "runtime:one", { candidateId: repair.id, assistantTurnId: "turn:assistant", eventId: "repair:delivered" });
});

for (const alteration of ["missing", "foreign", "altered", "wrong_candidate", "wrong_receipt"]) {
  test(`store exit refuses a ${alteration} snapshot or audit binding`, async (t) => {
    const env = await governed(t), { store, candidate } = env;
    const audit = await sealedAudit(env);
    await store.recordCandidateAudit(CASE, candidate.id, audit);
    const record = await store.load(CASE);
    if (alteration === "missing") record.response_evidence_snapshots = [];
    if (alteration === "foreign") { record.response_evidence_snapshots[0].case_id = "foreign-case"; record.response_evidence_snapshots[0].snapshot_sha256 = responseEvidenceSnapshotSha256(record.response_evidence_snapshots[0]); }
    if (alteration === "altered") record.response_evidence_snapshots[0].candidate_origin = "external_draft";
    if (alteration === "wrong_candidate") record.candidate_responses.at(-1).audit_history[0].candidate_sha256 = sha256Text("different bytes");
    if (alteration === "wrong_receipt") record.runtime_turns[0].events.find((entry) => entry.event_type === "INVOCATION_COMPLETED" && entry.stage === "audit").details.output.responseEvidenceInclusion.view_sha256 = sha256Text("forged receipt");
    await env.seed(record);
    await assert.rejects(store.approveCandidateForDelivery(CASE, candidate.id, audit.id), (error) => {
      assert.ok(["RESPONSE_EVIDENCE_INVALID", "VALIDATION_ERROR"].includes(error.code)); return true;
    });
  });
}

test("the enforced policy stops both delivery exits even for a pre-existing generic approved runtime candidate", async (t) => {
  const env = await environment(t), { store, seed } = env;
  await store.commitPrivateRuntimeCandidate(CASE, { runtimeTurnId: "runtime:one", candidateId: "ungoverned", exactText: "Legacy approved bytes.", producerContextId: "legacy:writer", caseState: createEmptyCaseState({ caseId: CASE }), eventId: "legacy:commit" });
  const candidate = await store.getCandidateResponse(CASE, "ungoverned"), audit = auditFor(candidate);
  await store.recordCandidateAudit(CASE, candidate.id, audit);
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: "legacy:auditing", toState: "AUDITING" });
  const record = await store.load(CASE), approved = record.candidate_responses.at(-1), runtime = record.runtime_turns[0];
  approved.status = "approved_for_delivery"; approved.metadata.approval_audit_id = audit.id;
  runtime.state = "APPROVED"; runtime.events.push({ id: "legacy:approved", sequence: runtime.events.length + 1, event_type: "STATE_TRANSITION", from_state: "AUDITING", to_state: "APPROVED", at: NOW, details: {} });
  await seed(record);
  const enforcedStore = createEncryptedPrivateCaseStore({ ...env.options, responseEvidencePolicy: "enforced" });
  t.after(() => enforcedStore.close());
  await assert.rejects(enforcedStore.deliverCandidateResponse(CASE, candidate.id, { auditId: audit.id, assistantTurnId: "assistant", inReplyToTurnId: inbound.turn_id }), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
  await assert.rejects(enforcedStore.deliverPrivateRuntimeCandidate(CASE, "runtime:one", { candidateId: candidate.id, assistantTurnId: "assistant", eventId: "delivery" }), errorCode("RESPONSE_EVIDENCE_REQUIRED"));
});

test("journal revision budgets are shared across the runtime turn and omitted inputs are never silently certified on replay", async (t) => {
  const { store } = await environment(t); await corpus(store);
  const first = await store.freezeResponseEvidence(CASE, freezeInput({ journal: journal([journalItem("1", "a".repeat(12000))]) }));
  const inclusion = { snapshot_id: first.id, snapshot_sha256: first.snapshot_sha256, view_sha256: buildEvidenceModelView(await store.load(CASE), first).view_sha256 };
  await seal(store, { stage: "candidate", contextId: "writer:one", output: { exactText: "Initial reply.", responseEvidenceInclusion: inclusion } });
  await store.commitPrivateRuntimeCandidate(CASE, { runtimeTurnId: "runtime:one", candidateId: "initial", exactText: "Initial reply.", producerContextId: "writer:one", caseState: createEmptyCaseState({ caseId: CASE }), responseEvidence: { snapshotId: first.id, writerInclusionSha256: inclusion.view_sha256 }, eventId: "initial:commit" });
  const candidate = await store.getCandidateResponse(CASE, "initial");
  await store.recordCandidateAudit(CASE, candidate.id, auditFor(candidate, null, review(), ordinaryFail));
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: "initial:auditing", toState: "AUDITING" });
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: "initial:failed", toState: "REPAIR_REQUIRED" });
  await store.transitionPrivateRuntimeTurn(CASE, "runtime:one", { eventId: "initial:repairing", toState: "RECONSTRUCTING" });
  const items = [journalItem("1", "a".repeat(12000)), journalItem("2", "b".repeat(12000))];
  const input = freezeInput({ snapshotId: "snapshot:two", revision: 2, parentSnapshotId: first.id, revisionReason: "evidence_expansion", journal: journal(items) });
  const second = await store.freezeResponseEvidence(CASE, input);
  assert.equal(second.source_items.filter((item) => item.kind === "journal_quotation").length, 1);
  await assert.rejects(store.freezeResponseEvidence(CASE, input), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await assert.rejects(store.freezeResponseEvidence(CASE, { ...input, snapshotId: "third", revision: 3, parentSnapshotId: second.id }), errorCode("RESPONSE_EVIDENCE_INVALID"));
  await assert.rejects(store.freezeResponseEvidence(CASE, { ...input, snapshotId: "four", revision: 4 }), errorCode("RESPONSE_EVIDENCE_INVALID"));
});


test("a review attached to a FAIL still validates source ids against the trusted snapshot", async (t) => {
  const env = await governed(t), { store, candidate, snapshot } = env;
  const fail = structuredClone(auditFor(candidate, snapshot, unsupportedReview()));
  fail.response_evidence.review.items[0].source_ids = ["unknown:source"];
  // This is structurally a FAIL with its derived finding intact; the store must also validate the source reference.
  assert.equal(validateCandidateAuditEvidence(fail, candidate), fail);
  await assert.rejects(store.recordCandidateAudit(CASE, candidate.id, fail), errorCode("RESPONSE_EVIDENCE_INVALID"));
  assert.equal((await store.getCandidateResponse(CASE, candidate.id)).audit_history.length, 0);
});

test("ordinary v7 payload bytes retain their pre-extension shape until a snapshot is frozen", async (t) => {
  const env = await environment(t);
  const readPayload = async () => {
    const serialized = JSON.parse(await fs.readFile(path.join(env.rootDir, `${CASE}.vault.json`), "utf8"));
    const bytes = await decryptVaultEnvelopeWithRecoverySecret({ envelope: deserializeVaultEnvelope(serialized), recoverySecretBytes: env.options.recoverySecretBytes });
    try { return JSON.parse(bytes.toString("utf8")); } finally { bytes.fill(0); }
  };
  assert.equal(Object.hasOwn(await readPayload(), "response_evidence_snapshots"), false);
  assert.deepEqual((await env.store.load(CASE)).response_evidence_snapshots, []);
  await env.store.freezeResponseEvidence(CASE, freezeInput());
  assert.equal((await readPayload()).response_evidence_snapshots.length, 1);
});

test("concurrent stores serialize identical freezes through the existing case coordinator", async (t) => {
  const env = await environment(t), other = createEncryptedPrivateCaseStore(env.options);
  t.after(() => other.close());
  const [one, two] = await Promise.all([env.store.freezeResponseEvidence(CASE, freezeInput()), other.freezeResponseEvidence(CASE, freezeInput())]);
  assert.deepEqual(one, two);
  assert.equal((await env.store.load(CASE)).response_evidence_snapshots.length, 1);
});


test("the existing root writer lock holds off a competing process before it can freeze evidence", async (t) => {
  const env = await environment(t);
  const lock = await acquirePrivateRootWriterLock({ rootDir: env.rootDir });
  const storeUrl = new URL("../src/storage/private-case-store.mjs", import.meta.url).href;
  const lockUrl = new URL("../src/storage/shared-case-coordinator.mjs", import.meta.url).href;
  const script = `
    import { createEncryptedPrivateCaseStore } from ${JSON.stringify(storeUrl)};
    import { withPrivateRootWriterLock } from ${JSON.stringify(lockUrl)};
    const rootDir = process.argv[1];
    try {
      await withPrivateRootWriterLock({ rootDir }, async () => {
        const store = createEncryptedPrivateCaseStore({ rootDir, routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), developmentExternalCredentialAuthorized: true });
        try { await store.freezeResponseEvidence(${JSON.stringify(CASE)}, ${JSON.stringify(freezeInput())}); }
        finally { store.close(); }
      });
      process.stdout.write("frozen");
    } catch (error) {
      process.stdout.write(error.code);
      if (error.code !== "PRIVATE_ROOT_WRITER_ACTIVE") process.exitCode = 1;
    }
  `;
  const run = () => promisify(execFile)(process.execPath, ["--input-type=module", "-e", script, env.rootDir], { timeout: 15000 });
  try {
    assert.equal((await run()).stdout, "PRIVATE_ROOT_WRITER_ACTIVE");
    assert.equal((await env.store.load(CASE)).response_evidence_snapshots.length, 0);
  } finally { await lock.release(); }
  assert.equal((await run()).stdout, "frozen");
  assert.equal((await env.store.load(CASE)).response_evidence_snapshots.length, 1);
});

test("supervisor snapshot revisions exclude their own lineage's export bookkeeping", async (t) => {
  const env = await supervisorGoverned(t), { store, candidate, snapshot } = env;
  const { audit, receipt } = await supervisorAudit(env);
  await store.recordSupervisorAudit(CASE, candidate.id, audit, receipt);
  await store.approveSupervisorDraft(CASE, candidate.id, audit.id);
  await store.exportSupervisorArtifact(CASE, { artifactId: env.artifactId, channel: "owner_ui" });
  const next = await store.freezeResponseEvidence(CASE, freezeInput({ snapshotId: "supervisor:revision", owner: snapshot.owner, candidateOrigin: "external_draft", revision: 2, parentSnapshotId: snapshot.id, revisionReason: "dependency_refresh" }));
  assert.equal(next.dependency_binding.communication_digest, snapshot.dependency_binding.communication_digest);
});


test("stale conversion retains ordinary findings even if an ordinary id already uses the stale finding stem", async (t) => {
  const env = await governed(t), { store, candidate } = env;
  const ordinary = [{ id: "evidence:dependencies", code: "RESPONSE_EVIDENCE_STALE", severity: "low", summary: "Synthetic ordinary finding." }];
  const audit = await sealedAudit(env, review(), ordinary);
  await invalidate.owner_input(store);
  await store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "stale:converted" });
  const current = await store.getCandidateResponse(CASE, candidate.id), stored = current.audit_history.at(-1);
  assert.equal(stored.findings[0].id, "evidence:dependencies");
  assert.deepEqual(stored.unresolved_substantive_finding_ids, ["evidence:dependencies:1"]);
  assert.equal(validateCandidateAuditEvidence(stored, current), stored);
});


test("journal replay uses the same chronological source order as the frozen inventory", async (t) => {
  const { store } = await environment(t); await corpus(store);
  const newer = journalItem("newer", "Newer exact account."), older = journalItem("older", "Older exact account.");
  newer.time = { at: NOW, status: "known" }; older.time = { at: "2020-01-01T00:00:00.000Z", status: "known" };
  const input = freezeInput({ journal: journal([newer, older]) });
  const snapshot = await store.freezeResponseEvidence(CASE, input);
  assert.deepEqual(snapshot.source_items.filter((item) => item.kind === "journal_quotation").map((item) => item.id), [older.id, newer.id]);
  assert.deepEqual(await store.freezeResponseEvidence(CASE, input), snapshot);
});


test("empty evidence extensions preserve existing non-journal publication digests", async (t) => {
  const env = await environment(t), record = await env.store.load(CASE);
  const legacy = structuredClone(record);
  for (const field of ["revision", "updated_at", "schema_version", "journal_corpora", "journal_corpus_keys", "response_evidence_snapshots"]) delete legacy[field];
  const access = createPrivateCaseAccessService({ rootDir: env.rootDir,
    authorizationProvider: { async authorize({ requiredScope, requiredPurpose }) { return { allowed: true, principalId: "synthetic", scopes: [requiredScope], purposes: [requiredPurpose] }; } },
    keyProvider: { async getCaseKeyMaterial() { return { routineKek: Buffer.alloc(32, 41), recoverySecretBytes: Buffer.alloc(32, 42), accessAssurance: "managed_secret_provider", managedSecretProvider: true }; } }
  });
  const inspect = () => access.inspectJournalCorpus(CASE, "corpus:one", { requiredScope: "case:read", requiredPurpose: "organize_search" }, {});
  assert.equal((await inspect()).non_journal_state_sha256, sha256Text(JSON.stringify(legacy)));
  await env.store.freezeResponseEvidence(CASE, freezeInput());
  assert.notEqual((await inspect()).non_journal_state_sha256, sha256Text(JSON.stringify(legacy)));
});

test("the encrypted store freezes a long case with full usable journal budget and bounded whole drafts and inputs", async (t) => {
  const env = await environment(t), { store } = env; await corpus(store);
  await store.saveCandidateResponse(CASE, "template:draft", "d".repeat(4000), { producer_context_id: "writer:template" });
  await store.recordSupervisorInputs(CASE, { inputs: [{ inputId: "template:input", inputType: "supervisor_revision", text: "s".repeat(2000) }], channel: "owner_ui" });
  const record = await store.load(CASE), template = record.candidate_responses[0], inputTemplate = record.supervisor_artifacts[0];
  record.raw_transcript = Array.from({ length: 400 }, (_, n) => turn(`older:${n}`, "x".repeat(400)));
  record.case_state.items = record.raw_transcript.map((entry, n) => ({ id: `observation:${n}`, domain: "runtime_observation", statement: "Synthetic direct account.", status: "direct_report", confidence: "high", source: { kind: "synthetic_turn", ref: entry.id, turn_id: entry.id, recorded_at: NOW }, still_current: true, supersedes: [], decision_relevance: "high" }));
  record.candidate_responses = Array.from({ length: 60 }, (_, n) => ({ ...structuredClone(template), id: `foreign:draft:${n}`, root_candidate_id: `foreign:draft:${n}`, version: n + 1, status: "superseded" }));
  record.supervisor_artifacts = Array.from({ length: 40 }, (_, n) => ({ ...structuredClone(inputTemplate), id: `owner:input:${n}` }));
  await env.seed(record);
  // 24,000 serialized bytes also fill the conservative 8,000-token allowance (bytes / 3).
  const snapshot = await store.freezeResponseEvidence(CASE, freezeInput({ journal: journal([journalItem("full", "j".repeat(23998))]) }));
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= 192000);
  assert.equal(snapshot.journal.budget.used_tokens, 8000);
  assert.equal(snapshot.journal.budget.used_bytes, 24000);
  assert.equal(snapshot.source_items.filter((item) => item.locator.kind === "transcript_turn").length, 120);
  assert.equal(snapshot.source_items.filter((item) => item.kind === "unsent_draft").length, 6);
  assert.equal(snapshot.source_items.filter((item) => item.kind === "supervisor_instruction").length, 8);
  assert.ok(snapshot.communication_projection.omitted.source_items.some((item) => item.reason === "draft_budget"));
});

test("recordSupervisorAudit records a valid exact PASS despite later state changes; supervisor approval releases nothing", async (t) => {
  const env = await supervisorGoverned(t), { audit, receipt } = await supervisorAudit(env);
  const state = await env.store.getCaseState(CASE); state.updated_at = "2026-11-23T18:00:00.000Z"; await env.store.saveCaseState(CASE, state);
  await env.store.recordSupervisorAudit(CASE, env.candidate.id, audit, receipt);
  assert.equal((await env.store.getCandidateResponse(CASE, env.candidate.id)).audit_history.at(-1).verdict, "pass");
  await assert.rejects(env.store.approveCandidateForDelivery(CASE, env.candidate.id, audit.id), errorCode("RESPONSE_EVIDENCE_STALE"));
  await env.store.approveSupervisorDraft(CASE, env.candidate.id, audit.id);
  await assert.rejects(env.store.exportSupervisorArtifact(CASE, { artifactId: env.artifactId, channel: "owner_ui" }), errorCode("SUPERVISOR_ARTIFACT_STALE"));
});

for (const tamper of ["candidate_identity", "ordinary_findings", "repair_checks"]) test(`sealed runtime audit binds exact input and validated output (${tamper})`, async (t) => {
  const env = await governed(t), audit = await sealedAudit(env);
  const record = await env.store.load(CASE);
  const event = record.runtime_turns[0].events.find(e => e.stage === "audit" && e.event_type === "INVOCATION_COMPLETED");
  if (tamper === "candidate_identity") {
    for (const e of record.runtime_turns[0].events.filter(e => e.stage === "audit")) e.input_sha256 = sha256Text("other candidate");
  } else if (tamper === "ordinary_findings") event.details.output.value.findings = [{ id: "ordinary", code: "SYNTHETIC", severity: "substantive", summary: "Must preserve this defect." }];
  else event.details.output.value.repair_induced_checks = ["forged"];
  await env.seed(record);
  const before = await env.store.load(CASE);
  await assert.rejects(env.store.commitPrivateRuntimeAudit(CASE, "runtime:one", audit, { eventId: "forged:commit" }), errorCode("RESPONSE_EVIDENCE_INVALID"));
  assert.deepEqual(await env.store.load(CASE), before);
});

test("trusted stale recovery refuses a current snapshot and changes nothing", async (t) => {
  const env = await governed(t); await sealedAudit(env);
  const before = await env.store.load(CASE);
  await assert.rejects(env.store.commitPrivateRuntimeEvidenceStale(CASE, "runtime:one", { eventId: "not:stale" }), errorCode("RESPONSE_EVIDENCE_INVALID"));
  assert.deepEqual(await env.store.load(CASE), before);
});

test("trusted stale FAIL is schema-valid, code-derived and never claims independent review", async (t) => {
  const env = await governed(t); await sealedAudit(env);
  await invalidate.owner_input(env.store);
  await env.store.commitPrivateRuntimeEvidenceStale(CASE, "runtime:one", { eventId: "code:stale" });
  const record = await env.store.load(CASE), audit = record.candidate_responses.at(-1).audit_history.at(-1);
  assert.equal(audit.verdict, "fail"); assert.equal(audit.derived_in_code, true);
  assert.equal(audit.independent, false); assert.equal(audit.independent_auditor_available, false);
  const schema = JSON.parse(await fs.readFile(new URL("../schemas/private-case/candidate-audit-v1.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ strict: true, validateFormats: false }).compile(schema);
  assert.equal(validate(audit), true, JSON.stringify(validate.errors));
  const { originMainPrivateCaseValidator } = await import("./helpers/origin-main-private-case-validator.mjs");
  const old = await originMainPrivateCaseValidator(t);
  assert.doesNotThrow(() => old(structuredClone(record)));
});
