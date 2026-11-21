import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { applyCaseStatePatch, createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
import { projectCommunicationState, resolveCandidateAppDelivery, validateCommunicationProjection } from "../src/storage/private-case-communication.mjs";
import { assessContinuationSafety } from "../src/storage/private-case-continuity.mjs";
import { createEncryptedPrivateCaseStore, validatePrivateCaseRecord } from "../src/storage/private-case-store.mjs";
import { runPrivateCandidateAudit } from "../src/supervisor/private-candidate-audit.mjs";
import {
  MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES,
  REPAIR_INDUCED_ERROR_CHECKS,
  candidateDeliveryGate,
  createCandidateAuditEvidence,
  validateCandidateAuditEvidence
} from "../src/supervisor/private-candidate-lifecycle.mjs";

const CASE_ID = "synthetic-post-reconstruction-gate";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests/fixtures/post-reconstruction-audit-case.json");

async function makeStore(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-candidate-lifecycle-"));
  const store = createEncryptedPrivateCaseStore({
    rootDir,
    routineKek: Buffer.alloc(32, 41),
    recoverySecretBytes: Buffer.alloc(32, 42),
    developmentExternalCredentialAuthorized: true,
    now: () => "2026-09-10T12:00:00.000Z"
  });
  t.after(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  return store;
}

function finding(id, code = "CAUSAL_OVERCLAIM") {
  return { id, code, severity: "substantive", summary: `Synthetic substantive finding ${id}.` };
}

function evidence(candidate, id, findings = [], { kind = "independent", contextId = `${id}:context` } = {}) {
  return createCandidateAuditEvidence({
    auditId: id,
    candidate,
    auditVersion: "private-candidate-audit-v2",
    auditorContext: { kind, context_id: contextId },
    findings,
    repairInducedChecks: candidate.parent_candidate_id == null ? [] : REPAIR_INDUCED_ERROR_CHECKS,
    completedAt: "2026-09-10T12:00:00.000Z"
  });
}

function auditService(store, candidateId) {
  return {
    async loadCaseContext() {
      return {
        candidate_response: await store.getCandidateResponse(CASE_ID, candidateId),
        constitution_ref: { version: "synthetic-constitution" },
        case_state: { synthetic: true },
        last_state_diff: { synthetic: true },
        recent_verbatim: { turns: [] },
        targeted_older_evidence: [],
        current_episode: { id: "synthetic-episode" },
        continuation_safety: { continuation_safe: true, failures: [] }
      };
    },
    getCandidateResponse(caseId, id) { return store.getCandidateResponse(caseId, id); },
    recordCandidateAudit(caseId, id, auditEvidence) { return store.recordCandidateAudit(caseId, id, auditEvidence); }
  };
}

async function failedOriginal(store, { id = "candidate:original", text = "Original synthetic candidate." } = {}) {
  await store.saveCandidateResponse(CASE_ID, id, text, { producer_context_id: "producer:original" });
  const candidate = await store.getCandidateResponse(CASE_ID, id);
  const audit = evidence(candidate, "audit:original:failed", [finding("finding:original")]);
  await store.recordCandidateAudit(CASE_ID, id, audit);
  return { candidate: await store.getCandidateResponse(CASE_ID, id), audit };
}

async function firstReconstruction(store) {
  const { candidate: parent, audit } = await failedOriginal(store);
  await store.reconstructCandidateResponse(CASE_ID, parent.id, "candidate:repair-1", "First reconstructed synthetic candidate.", {
    producer_context_id: "producer:repair-1",
    based_on_audit_id: audit.id
  });
  return {
    parent: await store.getCandidateResponse(CASE_ID, parent.id),
    candidate: await store.getCandidateResponse(CASE_ID, "candidate:repair-1"),
    audit
  };
}

test("reconstruction_invalidates_prior_audit", async (t) => {
  const store = await makeStore(t);
  const { parent, candidate } = await firstReconstruction(store);
  assert.equal(parent.status, "superseded");
  assert.equal(candidate.status, "reconstructed_pending_audit");
  assert.equal(candidate.parent_candidate_id, parent.id);
  assert.equal(candidate.repair_cycle, 1);
  assert.deepEqual(candidate.audit_history, []);
  assert.equal(candidateDeliveryGate(candidate).delivery_allowed, false);
  await assert.rejects(() => store.markCandidateSent(CASE_ID, candidate.id), /delivery is blocked/i);
});

test("new_candidate_version_requires_fresh_audit", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  assert.equal(candidateDeliveryGate(candidate).action, "FRESH_INDEPENDENT_AUDIT");
  assert.throws(() => createCandidateAuditEvidence({
    auditId: "audit:repair-1:incomplete-checklist",
    candidate,
    auditVersion: "private-candidate-audit-v2",
    auditorContext: { kind: "independent", context_id: "fresh-but-incomplete-auditor" },
    findings: [],
    repairInducedChecks: []
  }), /every repair-induced error check/i);
  await assert.rejects(() => store.approveCandidateForDelivery(CASE_ID, candidate.id, "audit:original:failed"), /fresh independent audit/i);
});

test("old_candidate_audit_cannot_approve_new_candidate", async (t) => {
  const store = await makeStore(t);
  const { candidate, audit } = await firstReconstruction(store);
  const forged = { ...audit, candidate_id: candidate.id, candidate_version: candidate.version, verdict: "pass", unresolved_substantive_finding_ids: [], findings: [], sufficient_for_approval: true, repair_induced_checks: [...REPAIR_INDUCED_ERROR_CHECKS] };
  assert.throws(() => validateCandidateAuditEvidence(forged, candidate), /different (exact )?candidate|producer cannot certify|inconsistent/i);
  await assert.rejects(() => store.approveCandidateForDelivery(CASE_ID, candidate.id, audit.id), /fresh independent audit/i);
});

test("fresh_audit_catches_repair_induced_error", async (t) => {
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const store = await makeStore(t);
  await store.saveCandidateResponse(CASE_ID, fixture.original_candidate.id, fixture.original_candidate.text, { producer_context_id: "producer:original" });
  const original = await store.getCandidateResponse(CASE_ID, fixture.original_candidate.id);
  const originalAudit = evidence(original, "audit:fixture:original", fixture.original_audit_findings);
  await store.recordCandidateAudit(CASE_ID, original.id, originalAudit);
  await store.reconstructCandidateResponse(CASE_ID, original.id, fixture.first_reconstruction.id, fixture.first_reconstruction.text, {
    producer_context_id: "producer:fixture:repair-1",
    based_on_audit_id: originalAudit.id
  });
  const repair = await store.getCandidateResponse(CASE_ID, fixture.first_reconstruction.id);
  assert.equal(candidateDeliveryGate(repair).delivery_allowed, false, "audit(old) -> reconstruct -> deliver must fail");
  const auditResult = await runPrivateCandidateAudit({
    caseAccessService: auditService(store, repair.id),
    caseId: CASE_ID,
    candidateId: repair.id,
    auditId: "audit:fixture:repair-1",
    auditorContext: { kind: "independent", context_id: "fresh-auditor:repair-1" },
    completedAt: "2026-09-10T12:00:00.000Z",
    auditor: async (input) => ({
      findings: fixture.repair_induced_findings,
      repair_induced_checks: input.repair_induced_error_checks
    })
  });
  const freshAudit = auditResult.audit_evidence;
  const failedRepair = await store.getCandidateResponse(CASE_ID, repair.id);
  assert.equal(failedRepair.status, "audit_failed");
  assert.deepEqual(freshAudit.unresolved_substantive_finding_ids, fixture.repair_induced_findings.map((item) => item.id));

  await store.reconstructCandidateResponse(CASE_ID, failedRepair.id, fixture.final_candidate.id, fixture.final_candidate.text, {
    producer_context_id: "producer:fixture:repair-2",
    based_on_audit_id: freshAudit.id
  });
  const finalCandidate = await store.getCandidateResponse(CASE_ID, fixture.final_candidate.id);
  const finalAudit = evidence(finalCandidate, "audit:fixture:final", [], { contextId: "fresh-auditor:final" });
  await store.recordCandidateAudit(CASE_ID, finalCandidate.id, finalAudit);
  await store.approveCandidateForDelivery(CASE_ID, finalCandidate.id, finalAudit.id);
  await store.markCandidateSent(CASE_ID, finalCandidate.id);
  const delivered = await store.getCandidateResponse(CASE_ID, finalCandidate.id);
  assert.equal(delivered.status, "sent", "audit(old) -> reconstruct -> fresh_audit(new) -> deliver must pass");
  assert.equal(delivered.metadata.sent_with_audit_id, finalAudit.id);
});

test("self_critique_alone_not_sufficient_when_independent_auditor_available", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  const selfCritique = evidence(candidate, "audit:self:repair-1", [], { kind: "self_critique", contextId: "producer:repair-1" });
  await store.recordCandidateAudit(CASE_ID, candidate.id, selfCritique);
  const current = await store.getCandidateResponse(CASE_ID, candidate.id);
  assert.equal(current.status, "reconstructed_pending_audit");
  assert.equal(selfCritique.sufficient_for_approval, false);
  await assert.rejects(() => store.approveCandidateForDelivery(CASE_ID, candidate.id, selfCritique.id), /fresh independent audit/i);
});

test("a nominal PASS cannot approve when no independent auditor is actually available", async (t) => {
  const store = await makeStore(t);
  await store.saveCandidateResponse(CASE_ID, "candidate:no-independent-auditor", "Synthetic candidate requiring a real independent auditor.", { producer_context_id: "producer:no-independent-auditor" });
  const candidate = await store.getCandidateResponse(CASE_ID, "candidate:no-independent-auditor");
  const unavailable = createCandidateAuditEvidence({
    auditId: "audit:no-independent-auditor",
    candidate,
    auditVersion: "private-candidate-audit-v2",
    auditorContext: { kind: "independent", context_id: "context:nominal-auditor" },
    independentAuditorAvailable: false,
    findings: []
  });
  assert.equal(unavailable.verdict, "pass");
  assert.equal(unavailable.sufficient_for_approval, false);
  await store.recordCandidateAudit(CASE_ID, candidate.id, unavailable);
  assert.equal((await store.getCandidateResponse(CASE_ID, candidate.id)).status, "pending_audit");
  await assert.rejects(() => store.approveCandidateForDelivery(CASE_ID, candidate.id, unavailable.id), /fresh independent audit/i);
});

test("externally supplied failed audit preserves unavailable identity without becoming approval evidence", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  const recordedAt = "2026-09-10T13:00:00.000Z";
  const externalProvenance = {
    kind: "externally_supplied_fresh_independent_audit",
    supplied_by: "owner",
    received_at: recordedAt,
    reported_independence_from_producer_context_id: candidate.producer_context_id
  };
  const failedAudit = createCandidateAuditEvidence({
    auditId: "audit:external:repair-1:failed",
    candidate,
    auditVersion: "private-candidate-audit-v3",
    auditorContext: { kind: "independent", context_id: null, context_id_status: "unavailable" },
    completedAt: null,
    completedAtStatus: "unavailable",
    recordedAt,
    externalProvenance,
    findings: [finding("finding:external:repair-induced")],
    repairInducedChecks: REPAIR_INDUCED_ERROR_CHECKS
  });

  assert.equal(failedAudit.auditor_context_id, null);
  assert.equal(failedAudit.auditor_context_id_status, "unavailable");
  assert.equal(failedAudit.completed_at, null);
  assert.equal(failedAudit.completed_at_status, "unavailable");
  assert.equal(failedAudit.verdict, "fail");
  assert.equal(failedAudit.independent, true);
  assert.equal(failedAudit.sufficient_for_approval, false);
  assert.deepEqual(failedAudit.external_provenance, externalProvenance);

  assert.throws(() => createCandidateAuditEvidence({
    auditId: "audit:external:repair-1:passing-without-identity",
    candidate,
    auditVersion: "private-candidate-audit-v3",
    auditorContext: { kind: "independent", context_id: null, context_id_status: "unavailable" },
    completedAt: null,
    completedAtStatus: "unavailable",
    recordedAt,
    externalProvenance,
    findings: [],
    repairInducedChecks: REPAIR_INDUCED_ERROR_CHECKS
  }), /may preserve only a blocking independent FAIL/i);

  assert.throws(() => createCandidateAuditEvidence({
    auditId: "audit:external:repair-1:wrong-producer",
    candidate,
    auditVersion: "private-candidate-audit-v3",
    auditorContext: { kind: "independent", context_id: null, context_id_status: "unavailable" },
    completedAt: null,
    completedAtStatus: "unavailable",
    recordedAt,
    externalProvenance: { ...externalProvenance, reported_independence_from_producer_context_id: "producer:other" },
    findings: [finding("finding:external:wrong-producer")],
    repairInducedChecks: REPAIR_INDUCED_ERROR_CHECKS
  }), /exact candidate producer context/i);

  await store.recordCandidateAudit(CASE_ID, candidate.id, failedAudit);
  const failed = await store.getCandidateResponse(CASE_ID, candidate.id);
  assert.equal(failed.status, "audit_failed");
  await assert.rejects(() => store.approveCandidateForDelivery(CASE_ID, candidate.id, failedAudit.id), /fresh independent audit/i);
});

test("max_two_repair_cycles_then_discriminator_or_block", async (t) => {
  const store = await makeStore(t);
  const { candidate: repairOne } = await firstReconstruction(store);
  const auditOne = evidence(repairOne, "audit:repair-1:failed", [finding("finding:repair-1")]);
  await store.recordCandidateAudit(CASE_ID, repairOne.id, auditOne);
  await store.reconstructCandidateResponse(CASE_ID, repairOne.id, "candidate:repair-2", "Second reconstructed synthetic candidate.", {
    producer_context_id: "producer:repair-2",
    based_on_audit_id: auditOne.id
  });
  const repairTwo = await store.getCandidateResponse(CASE_ID, "candidate:repair-2");
  assert.equal(repairTwo.repair_cycle, MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES);
  const auditTwo = evidence(repairTwo, "audit:repair-2:failed", [finding("finding:repair-2")]);
  await store.recordCandidateAudit(CASE_ID, repairTwo.id, auditTwo);
  const terminal = await store.getCandidateResponse(CASE_ID, repairTwo.id);
  assert.equal(candidateDeliveryGate(terminal).action, "DISCRIMINATE_OR_BLOCK");
  await assert.rejects(
    () => store.reconstructCandidateResponse(CASE_ID, terminal.id, "candidate:repair-3", "Forbidden third repair.", { producer_context_id: "producer:repair-3", based_on_audit_id: auditTwo.id }),
    (error) => error.code === "PRIVATE_CANDIDATE_REPAIR_LIMIT"
  );
  await assert.rejects(
    () => store.saveCandidateResponse(CASE_ID, "candidate:disguised-repair", "A repair cannot reset the cycle by posing as a new original.", {}),
    /lineage and repair cycle cannot be bypassed/i
  );
});

test("candidate_status_bound_to_version_id", async (t) => {
  const store = await makeStore(t);
  const { parent, candidate } = await firstReconstruction(store);
  const freshAudit = evidence(candidate, "audit:repair-1:pass", []);
  await store.recordCandidateAudit(CASE_ID, candidate.id, freshAudit);
  await assert.rejects(() => store.approveCandidateForDelivery(CASE_ID, parent.id, freshAudit.id), /exact current candidate/i);
  await store.approveCandidateForDelivery(CASE_ID, candidate.id, freshAudit.id);
  const approved = await store.getCandidateResponse(CASE_ID, candidate.id);
  assert.equal(approved.metadata.approval_audit_id, freshAudit.id);
  assert.equal(freshAudit.candidate_id, approved.id);
  assert.equal(freshAudit.candidate_version, approved.version);
});

test("handoff_preserves_current_candidate_and_audit_status", async (t) => {
  const store = await makeStore(t);
  const { candidate, audit } = await firstReconstruction(store);
  const handoffId = "handoff:00000000-0000-4000-8000-000000000099";
  await store.createHandoff(CASE_ID, { handoffId, runtimeVersion: "synthetic-runtime", auditVersion: "private-candidate-audit-v2" });
  const packet = await store.loadHandoff(CASE_ID, handoffId);
  assert.equal(packet.candidate_lifecycle.current_candidate_id, candidate.id);
  assert.equal(packet.candidate_lifecycle.current_candidate_version, candidate.version);
  assert.equal(packet.candidate_lifecycle.parent_candidate_id, candidate.parent_candidate_id);
  assert.equal(packet.candidate_lifecycle.candidate_status, "reconstructed_pending_audit");
  assert.equal(packet.candidate_lifecycle.audit_status, "not_audited");
  assert.equal(packet.candidate_lifecycle.delivery_blocked_pending_fresh_audit, true);
  assert.equal(packet.candidate_lifecycle.reconstruction_audit_fidelity_status, "pending_fresh_independent_audit");
  assert.ok(packet.candidate_lifecycle.previous_findings.some((item) => item.audit_id === audit.id));
});

test("pre-binding audited records migrate without inheriting unbound approval", () => {
  const migrated = validatePrivateCaseRecord({
    schema_version: 3,
    case_id: CASE_ID,
    created_at: "2026-09-09T12:00:00.000Z",
    updated_at: "2026-09-09T12:00:00.000Z",
    raw_transcript: [],
    case_state: createEmptyCaseState({ caseId: CASE_ID }),
    tracker_entries: [],
    journal_entries: [],
    last_state_diff: null,
    state_diff_history: [],
    candidate_responses: [
      {
        id: "candidate:legacy:pending",
        version: 1,
        exact_text: "Synthetic older legacy candidate.",
        status: "pending_audit",
        created_at: "2026-09-09T12:00:00.000Z",
        updated_at: "2026-09-09T12:00:00.000Z",
        metadata: {}
      },
      {
        id: "candidate:legacy:audited",
        version: 2,
        exact_text: "Synthetic legacy candidate.",
        status: "audited",
        created_at: "2026-09-09T12:00:00.000Z",
        updated_at: "2026-09-09T12:00:00.000Z",
        metadata: {}
      }
    ],
    source_artifacts: []
  });
  assert.equal(migrated.schema_version, 7);
  assert.deepEqual(migrated.transcript_amendments, []);
  assert.deepEqual(migrated.runtime_turns, []);
  assert.deepEqual(migrated.journal_corpora, []);
  assert.deepEqual(migrated.journal_corpus_keys, []);
  assert.equal(migrated.candidate_responses[0].status, "superseded");
  assert.equal(migrated.candidate_responses[0].metadata.superseded_during_lifecycle_migration, true);
  assert.equal(migrated.candidate_responses[1].status, "pending_audit");
  assert.equal(migrated.candidate_responses[1].metadata.legacy_unbound_audit_invalidated, true);
  assert.deepEqual(migrated.candidate_responses[1].audit_history, []);
});

test("schema v5 migrates through v6 to v7 without changing exact Unicode candidate lineage or audits", async (t) => {
  const store = await makeStore(t);
  await store.saveCandidateResponse(CASE_ID, "candidate:unicode:v1", "Exact Unicode candidate — café 🧭\nline two", { producer_context_id: "producer:unicode:v1" });
  const candidate = await store.getCandidateResponse(CASE_ID, "candidate:unicode:v1");
  const audit = evidence(candidate, "audit:unicode:v1", []);
  await store.recordCandidateAudit(CASE_ID, candidate.id, audit);
  const before = await store.load(CASE_ID);
  const legacy = structuredClone(before);
  legacy.schema_version = 5;
  delete legacy.runtime_turns;
  const migrated = validatePrivateCaseRecord(legacy);
  assert.equal(migrated.schema_version, 7);
  assert.deepEqual(migrated.runtime_turns, []);
  assert.deepEqual(migrated.journal_corpora, []);
  assert.deepEqual(migrated.journal_corpus_keys, []);
  assert.equal(migrated.candidate_responses[0].exact_text, before.candidate_responses[0].exact_text);
  assert.deepEqual(migrated.candidate_responses[0].audit_history, before.candidate_responses[0].audit_history);
  assert.equal(migrated.candidate_responses[0].root_candidate_id, before.candidate_responses[0].root_candidate_id);
});

const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const OWNER_REPORT = { origin: "agent_relayed", sourceRef: "message:synthetic:owner-report", quote: "Synthetic quote: I sent that reply." };

async function appendUserTurn(store, suffix) {
  const turn = { id: `turn:synthetic:user:${suffix}`, exchange_id: `exchange:synthetic:${suffix}`, role: "user", text: `Synthetic user message ${suffix}.`, at: "2026-09-10T11:00:00.000Z", episode_id: null };
  await store.appendTranscriptTurn(CASE_ID, turn);
  return turn;
}

async function approvedOriginal(store, id = "candidate:comm:original") {
  await store.saveCandidateResponse(CASE_ID, id, "Synthetic approved original candidate.", { producer_context_id: "producer:comm:original" });
  const candidate = await store.getCandidateResponse(CASE_ID, id);
  const audit = evidence(candidate, `audit:comm:${id}`, [], { contextId: `fresh-auditor:comm:${id}` });
  await store.recordCandidateAudit(CASE_ID, id, audit);
  await store.approveCandidateForDelivery(CASE_ID, id, audit.id);
  return { candidate: await store.getCandidateResponse(CASE_ID, id), audit };
}

const candidateSubject = (candidate) => ({ kind: "candidate", candidateId: candidate.id, candidateVersion: candidate.version });
const outbound = (context) => context.communication_projection.confirmed_or_reported_client_outbound;
const supervisorOnly = (context) => context.communication_projection.supervisor_only_artifacts;
const unresolved = (context) => context.communication_projection.unresolved_delivery;

test("delivery states tell an unsent failed draft from the exact version the application committed", async (t) => {
  const store = await makeStore(t);
  const { parent, candidate: v2 } = await firstReconstruction(store);
  const user = await appendUserTurn(store, "pair");
  const v2Audit = evidence(v2, "audit:comm:v2:pass", [], { contextId: "fresh-auditor:comm:v2" });
  await store.recordCandidateAudit(CASE_ID, v2.id, v2Audit);
  await store.approveCandidateForDelivery(CASE_ID, v2.id, v2Audit.id);

  const beforeDelivery = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(outbound(beforeDelivery), [], "an approved draft that was not delivered is not client history");
  assert.deepEqual(supervisorOnly(beforeDelivery).map((entry) => [entry.subject.candidate_id, entry.state, entry.delivery_evidence, entry.candidate_status]), [
    [parent.id, "draft", "none", "superseded"],
    [v2.id, "draft", "none", "approved_for_delivery"]
  ]);
  assert.equal(beforeDelivery.delivery_completion, null);

  await store.deliverCandidateResponse(CASE_ID, v2.id, { auditId: v2Audit.id, assistantTurnId: "turn:synthetic:assistant:pair", inReplyToTurnId: user.id });
  const context = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(context.delivery_completion, { candidate_id: v2.id, candidate_version: 2 });
  assert.equal(outbound(context).length, 1);
  const [committed] = outbound(context);
  assert.deepEqual(
    { subject: committed.subject, audience: committed.audience, state: committed.state, evidence: committed.delivery_evidence },
    { subject: { kind: "candidate", candidate_id: v2.id, candidate_version: 2, text_sha256: sha256Hex(v2.exact_text) }, audience: "client", state: "app_committed", evidence: "application_persisted" }
  );
  assert.equal(committed.assistant_turn_id, "turn:synthetic:assistant:pair");
  assert.equal(committed.in_reply_to_turn_id, user.id);
  assert.deepEqual(committed.event_time, { at: "2026-09-10T12:00:00.000Z", status: "known" });
  assert.equal(committed.source.kind, "application_transcript");
  assert.equal(committed.source.route, "transcript_bound");
  assert.equal(committed.source.audit_id, v2Audit.id);
  assert.deepEqual(supervisorOnly(context).map((entry) => [entry.subject.candidate_id, entry.state, entry.candidate_status]), [[parent.id, "draft", "superseded"]]);
  assert.notEqual(supervisorOnly(context)[0].subject.text_sha256, committed.subject.text_sha256, "the unsent version keeps its own exact bytes");
  assert.deepEqual(unresolved(context), [], "the only assistant turn is vouched for by the delivery");
  const record = await store.load(CASE_ID);
  validateCommunicationProjection(context.communication_projection, { rawTranscript: record.raw_transcript });
});

test("a status-only markCandidateSent never reads as delivered history and cannot later be upgraded", async (t) => {
  const store = await makeStore(t);
  const { candidate, audit } = await approvedOriginal(store);
  await store.markCandidateSent(CASE_ID, candidate.id);
  const sent = await store.getCandidateResponse(CASE_ID, candidate.id);
  assert.equal(sent.status, "sent");
  assert.equal(sent.metadata.sent_status_only, true);
  assert.equal(sent.metadata.sent_turn_id, undefined);

  const context = await store.loadCaseContext(CASE_ID);
  assert.equal(context.delivery_completion, null);
  assert.deepEqual(outbound(context), []);
  assert.equal(unresolved(context).length, 1);
  const [unknown] = unresolved(context);
  assert.deepEqual([unknown.state, unknown.audience, unknown.delivery_evidence], ["unknown", "unknown", "unknown"]);
  assert.deepEqual([unknown.source.kind, unknown.source.route, unknown.candidate_status], ["legacy_status_only", "mark_candidate_sent", "sent"]);
  assert.ok(assessContinuationSafety(context).failures.includes("sent candidate is missing exact transcript-bound delivery evidence"));

  const user = await appendUserTurn(store, "status-only");
  await assert.rejects(
    () => store.deliverCandidateResponse(CASE_ID, candidate.id, { auditId: audit.id, assistantTurnId: "turn:synthetic:assistant:late", inReplyToTurnId: user.id }),
    /replay conflicts with the immutable sent response/i
  );
  const handoffId = "handoff:00000000-0000-4000-8000-0000000000a1";
  await store.createHandoff(CASE_ID, { handoffId, runtimeVersion: "synthetic-runtime", auditVersion: "private-candidate-audit-v2" });
  const packet = await store.loadHandoff(CASE_ID, handoffId);
  assert.equal(packet.delivery_completion, null);
  assert.equal(packet.handoff_status, "BLOCKED_CONTINUATION_UNSAFE");
  assert.deepEqual(packet.communication_projection.confirmed_or_reported_client_outbound, []);
});

test("an owner's report of sending is recorded as reported delivery without auditing, approving or marking anything", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  const before = await store.getCandidateResponse(CASE_ID, candidate.id);
  const recorded = await store.recordCommunicationEvent(CASE_ID, {
    eventId: "comm:report:v2",
    kind: "reported_sent",
    audience: "client",
    subject: candidateSubject(candidate),
    sentAt: "2026-09-10T11:30:00.000Z",
    provenance: OWNER_REPORT
  });
  assert.equal(recorded.event.provenance.actor_resolution, "unresolved", "an agent's relay is not a verified owner event");
  assert.deepEqual(await store.getCandidateResponse(CASE_ID, candidate.id), before, "the candidate record is untouched");
  assert.deepEqual(before.audit_history, []);

  const context = await store.loadCaseContext(CASE_ID);
  assert.equal(context.delivery_completion, null);
  assert.equal(outbound(context).length, 1);
  const [reported] = outbound(context);
  assert.deepEqual([reported.state, reported.audience, reported.delivery_evidence, reported.candidate_status], ["reported_sent", "client", "owner_reported_sent", "reconstructed_pending_audit"]);
  assert.equal(reported.subject.text_sha256, sha256Hex(candidate.exact_text));
  assert.deepEqual(reported.event_time, { at: "2026-09-10T11:30:00.000Z", status: "known" });
  assert.deepEqual([reported.source.kind, reported.source.origin, reported.source.actor_resolution, reported.source.source_ref], ["owner_report", "agent_relayed", "unresolved", "message:synthetic:owner-report"]);
  assert.equal(JSON.stringify(context.communication_projection).includes("Synthetic quote"), false, "the quoted report stays in the encrypted record, not the projection");
  assert.equal((await store.load(CASE_ID)).communication_events[0].provenance.quote, OWNER_REPORT.quote);
  assert.deepEqual(supervisorOnly(context).map((entry) => entry.subject.candidate_id), [before.parent_candidate_id], "only the earlier superseded draft remains supervisor-only");
});

test("an unreported send time stays explicitly unavailable and is never invented", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  const { event } = await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:report:no-time", kind: "reported_sent", audience: "client", subject: candidateSubject(candidate), provenance: OWNER_REPORT });
  assert.deepEqual([event.sent_at, event.sent_at_status], [null, "unavailable"]);
  assert.deepEqual(outbound(await store.loadCaseContext(CASE_ID))[0].event_time, { at: null, status: "unavailable" });
});

test("an ambiguous report stays unresolved until a later report names one exact version, and the correction is appended", async (t) => {
  const store = await makeStore(t);
  const { parent, candidate: v2 } = await firstReconstruction(store);
  await store.recordCommunicationEvent(CASE_ID, {
    eventId: "comm:report:ambiguous",
    kind: "reported_sent",
    audience: "client",
    subject: { kind: "unresolved", candidateRefs: [{ candidateId: parent.id, candidateVersion: 1 }, { candidateId: v2.id, candidateVersion: 2 }] },
    provenance: OWNER_REPORT
  });
  let context = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(outbound(context), [], "no guessed binding");
  assert.equal(unresolved(context).length, 1);
  assert.equal(unresolved(context)[0].subject.kind, "unresolved");
  assert.deepEqual(unresolved(context)[0].subject.candidate_refs.map((entry) => entry.candidate_version), [1, 2]);
  assert.deepEqual(supervisorOnly(context).map((entry) => [entry.subject.candidate_version, entry.state]), [[1, "draft"], [2, "draft"]], "neither candidate was upgraded");

  await assert.rejects(() => store.recordCommunicationEvent(CASE_ID, { eventId: "comm:retract:missing", kind: "retraction", retractsEventId: "comm:report:never-recorded", provenance: OWNER_REPORT }), /does not precede it/);
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:retract:ambiguous", kind: "retraction", retractsEventId: "comm:report:ambiguous", reason: "The owner named the version.", provenance: OWNER_REPORT });
  await assert.rejects(() => store.recordCommunicationEvent(CASE_ID, { eventId: "comm:retract:again", kind: "retraction", retractsEventId: "comm:report:ambiguous", provenance: OWNER_REPORT }), /already retracted/);
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:report:v2", kind: "reported_sent", audience: "client", subject: candidateSubject(v2), provenance: OWNER_REPORT });
  context = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(unresolved(context), []);
  assert.deepEqual(outbound(context).map((entry) => [entry.subject.candidate_version, entry.state]), [[2, "reported_sent"]]);
  assert.deepEqual(supervisorOnly(context).map((entry) => [entry.subject.candidate_version, entry.state]), [[1, "draft"]]);
  assert.equal(context.communication_projection.retracted_event_count, 1);
  const record = await store.load(CASE_ID);
  assert.deepEqual(record.communication_events.map((event) => event.id), ["comm:report:ambiguous", "comm:retract:ambiguous", "comm:report:v2"], "history is appended, never rewritten");
});

test("an export or a translation shown to the supervisor never marks the client message as sent", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  const translation = "Synthetic English companion for the supervisor.";
  const common = { audience: "client", subject: candidateSubject(candidate), provenance: { origin: "application", sourceRef: null, quote: null } };
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:expose:v2", kind: "exposed", ...common });
  let context = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(supervisorOnly(context).filter((entry) => entry.subject.candidate_version === 2).map((entry) => [entry.state, entry.audience, entry.delivery_evidence]), [["exposed", "client", "none"]]);
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:export:v2", kind: "exported", ...common });
  const companion = { kind: "companion", companionOf: candidateSubject(candidate), artifactSha256: sha256Hex(translation) };
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:expose:translation", kind: "exposed", audience: "supervisor", subject: companion, provenance: common.provenance });
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:export:translation", kind: "exported", audience: "supervisor", subject: companion, provenance: common.provenance });
  context = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(outbound(context), [], "no export, exposure or translation is client history");
  assert.equal(context.delivery_completion, null);
  const exported = supervisorOnly(context).filter((entry) => entry.state === "exported");
  assert.deepEqual(exported.map((entry) => [entry.subject.kind, entry.audience, entry.delivery_evidence]), [["candidate", "client", "none"], ["companion", "supervisor", "none"]]);
  assert.equal(exported[1].subject.artifact_sha256, sha256Hex(translation));

  const refused = (input) => assert.rejects(() => store.recordCommunicationEvent(CASE_ID, input), /not valid for a/);
  await refused({ eventId: "comm:bad:1", kind: "reported_sent", audience: "supervisor", subject: candidateSubject(candidate), provenance: OWNER_REPORT });
  await refused({ eventId: "comm:bad:2", kind: "reported_sent", audience: "client", subject: companion, provenance: OWNER_REPORT });
  await refused({ eventId: "comm:bad:3", kind: "exported", audience: "supervisor", subject: candidateSubject(candidate), provenance: common.provenance });
  await assert.rejects(() => store.recordCommunicationEvent(CASE_ID, { eventId: "comm:bad:4", kind: "reported_sent", audience: "client", subject: candidateSubject(candidate), provenance: { origin: "application", sourceRef: null, quote: null } }), /application cannot report that the owner sent/);
});

test("an exact replay of a communication event changes nothing and a conflicting one is refused", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  const input = { eventId: "comm:report:replay", kind: "reported_sent", audience: "client", subject: candidateSubject(candidate), sentAt: "2026-09-10T11:30:00.000Z", provenance: OWNER_REPORT };
  const first = await store.recordCommunicationEvent(CASE_ID, input);
  const second = await store.recordCommunicationEvent(CASE_ID, input);
  assert.equal(second.revision, first.revision, "a replay is not a write");
  assert.deepEqual(second.event, first.event);
  assert.equal((await store.load(CASE_ID)).communication_events.length, 1);
  await assert.rejects(() => store.recordCommunicationEvent(CASE_ID, { ...input, sentAt: "2026-09-10T11:45:00.000Z" }), /conflicts with an existing immutable event/);
  await assert.rejects(() => store.recordCommunicationEvent(CASE_ID, { ...input, eventId: "comm:report:wrong-version", subject: { ...input.subject, candidateVersion: 9 } }), /exact candidate version/);
});

test("records from before communication evidence load, and nothing in them is promoted to delivered history", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await approvedOriginal(store);
  const user = await appendUserTurn(store, "legacy");
  await store.markCandidateSent(CASE_ID, candidate.id);
  await store.appendTranscriptTurn(CASE_ID, { id: "turn:synthetic:assistant:legacy", exchange_id: user.exchange_id, role: "assistant", text: "Synthetic older reply of unknown audience.", at: "2026-09-10T11:05:00.000Z", episode_id: null });
  const legacy = structuredClone(await store.load(CASE_ID));
  delete legacy.communication_events;
  delete legacy.candidate_responses[0].metadata.sent_status_only;
  const migrated = validatePrivateCaseRecord(legacy);
  assert.equal(migrated.schema_version, 7);
  assert.deepEqual(migrated.communication_events, []);
  const projection = projectCommunicationState(migrated);
  assert.deepEqual(projection.confirmed_or_reported_client_outbound, []);
  assert.deepEqual(projection.unresolved_delivery.map((entry) => [entry.subject.kind, entry.state, entry.delivery_evidence, entry.source.kind, entry.source.route]), [
    ["candidate", "unknown", "unknown", "legacy_status_only", null],
    ["unattributed_assistant_turns", "unknown", "unknown", "transcript_role_only", null]
  ]);
  assert.deepEqual(projection.unresolved_delivery[1].subject, { kind: "unattributed_assistant_turns", count: 1, turn_ids: ["turn:synthetic:assistant:legacy"] });
  validateCommunicationProjection(projection, { rawTranscript: migrated.raw_transcript });
});

test("the record validator refuses forged, mismatched or inconsistent communication evidence", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await firstReconstruction(store);
  await store.recordCommunicationEvent(CASE_ID, { eventId: "comm:report:v2", kind: "reported_sent", audience: "client", subject: candidateSubject(candidate), provenance: OWNER_REPORT });
  const base = await store.load(CASE_ID);
  const forge = (change) => {
    const record = structuredClone(base);
    change(record);
    return () => validatePrivateCaseRecord(record);
  };
  assert.doesNotThrow(() => validatePrivateCaseRecord(structuredClone(base)));
  assert.throws(forge((record) => { record.communication_events[0].subject.text_sha256 = sha256Hex("other bytes"); }), /exact candidate bytes/);
  assert.throws(forge((record) => { record.communication_events[0].audience = "supervisor"; }), /not valid for a reported_sent event/);
  assert.throws(forge((record) => { record.communication_events[0].extra = true; }), /unexpected or missing fields/);
  assert.throws(forge((record) => { record.communication_events[0].provenance.actor_resolution = "owner_verified"; }), /origin and actor resolution are inconsistent/);
  assert.throws(forge((record) => { record.communication_events[0].sent_at_status = "known"; }), /sent_at is invalid/);
  assert.throws(forge((record) => { record.communication_events.push(structuredClone(record.communication_events[0])); }), /Duplicate communication event/);
  assert.throws(forge((record) => { record.communication_events[0].subject.candidate_version = 7; }), /exact candidate version/);
  assert.throws(forge((record) => { record.candidate_responses[0].metadata.sent_status_only = true; }), /status-only delivery/);
});

test("a reply to a user turn outside any episode takes the current episode and the delivery still resolves in the context and the handoff", async (t) => {
  const store = await makeStore(t);
  const { candidate, audit } = await approvedOriginal(store);
  await store.saveCaseState(CASE_ID, applyCaseStatePatch(createEmptyCaseState({ caseId: CASE_ID }), {
    current_episode: {
      id: "episode:comm:current",
      target: "Distinguish two synthetic possibilities.",
      route: "SYNTHETIC.ROUTE",
      prediction: "The next exact observation will discriminate.",
      next_question: "Which synthetic signal changed first?",
      started_turn_id: "turn:synthetic:user:episode",
      constitutional_aim_ids: ["CARE"],
      adverse_signs: ["less choice"],
      stay_conditions: ["new information"],
      switch_conditions: ["no information"],
      stop_conditions: ["decline"],
      source_item_ids: []
    }
  }));
  const user = await appendUserTurn(store, "episode");
  await store.deliverCandidateResponse(CASE_ID, candidate.id, { auditId: audit.id, assistantTurnId: "turn:synthetic:assistant:episode", inReplyToTurnId: user.id });

  const record = await store.load(CASE_ID);
  const [storedUser, storedAssistant] = record.raw_transcript;
  assert.equal(storedUser.episode_id, null);
  assert.equal(storedAssistant.episode_id, "episode:comm:current", "the reply joins the episode the case is in");
  const context = await store.loadCaseContext(CASE_ID);
  assert.deepEqual(context.delivery_completion, { candidate_id: candidate.id, candidate_version: candidate.version });
  assert.equal(outbound(context)[0].state, "app_committed");
  const handoffId = "handoff:00000000-0000-4000-8000-0000000000a2";
  await store.createHandoff(CASE_ID, { handoffId, runtimeVersion: "synthetic-runtime", auditVersion: "private-candidate-audit-v2" });
  assert.equal((await store.loadHandoff(CASE_ID, handoffId)).delivery_completion.assistant_turn_id, storedAssistant.id);

  // Two different episodes are not the same delivery.
  const mismatched = structuredClone(record);
  mismatched.raw_transcript[0].episode_id = "episode:comm:other";
  assert.equal(resolveCandidateAppDelivery(mismatched, mismatched.candidate_responses[0]), null);
});

test("an owner's report of a reply the application already committed corroborates it and is not listed twice", async (t) => {
  const store = await makeStore(t);
  const { candidate, audit } = await approvedOriginal(store);
  const user = await appendUserTurn(store, "corroborate");
  await store.deliverCandidateResponse(CASE_ID, candidate.id, { auditId: audit.id, assistantTurnId: "turn:synthetic:assistant:corroborate", inReplyToTurnId: user.id });
  await store.recordCommunicationEvent(CASE_ID, {
    eventId: "comm:report:committed-pair",
    kind: "reported_sent",
    audience: "client",
    subject: { kind: "transcript_turn", assistantTurnId: "turn:synthetic:assistant:corroborate", inReplyToTurnId: user.id },
    sentAt: "2026-09-10T11:45:00.000Z",
    provenance: OWNER_REPORT
  });
  const context = await store.loadCaseContext(CASE_ID);
  assert.equal(outbound(context).length, 1, "one reply, one entry");
  assert.deepEqual([outbound(context)[0].state, outbound(context)[0].delivery_evidence], ["app_committed", "application_persisted"], "the application's own record stays the stronger evidence");
  assert.deepEqual(outbound(context)[0].corroborating_event_ids, ["comm:report:committed-pair"]);
  assert.deepEqual(unresolved(context), []);
});

test("a status-only marking stays unresolved even when its record also carries a runtime receipt shape", async (t) => {
  const store = await makeStore(t);
  const { candidate } = await approvedOriginal(store);
  await store.markCandidateSent(CASE_ID, candidate.id);
  const record = structuredClone(await store.load(CASE_ID));
  // A forged receipt for the same candidate and audit must not lend a status-only marking a delivery it never had.
  record.runtime_turns = [{ id: "runtime:forged", user_turn_id: "turn:forged:user", exchange_id: "exchange:forged", delivery: { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, audit_id: record.candidate_responses[0].metadata.sent_with_audit_id, assistant_turn_id: "turn:forged:assistant" } }];
  record.raw_transcript = [
    { id: "turn:forged:user", exchange_id: "exchange:forged", role: "user", text: "Synthetic forged user turn.", at: "2026-09-10T11:00:00.000Z", episode_id: null },
    { id: "turn:forged:assistant", exchange_id: "exchange:forged", role: "assistant", text: record.candidate_responses[0].exact_text, at: "2026-09-10T11:01:00.000Z", episode_id: null }
  ];
  assert.equal(resolveCandidateAppDelivery(record, record.candidate_responses[0]), null);
});
