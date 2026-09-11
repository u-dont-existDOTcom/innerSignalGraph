import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyCaseState } from "../src/case-state/longitudinal-state.mjs";
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
  assert.equal(migrated.schema_version, 6);
  assert.deepEqual(migrated.transcript_amendments, []);
  assert.deepEqual(migrated.runtime_turns, []);
  assert.equal(migrated.candidate_responses[0].status, "superseded");
  assert.equal(migrated.candidate_responses[0].metadata.superseded_during_lifecycle_migration, true);
  assert.equal(migrated.candidate_responses[1].status, "pending_audit");
  assert.equal(migrated.candidate_responses[1].metadata.legacy_unbound_audit_invalidated, true);
  assert.deepEqual(migrated.candidate_responses[1].audit_history, []);
});

test("schema v5 migrates to v6 without changing exact Unicode candidate lineage or audits", async (t) => {
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
  assert.equal(migrated.schema_version, 6);
  assert.deepEqual(migrated.runtime_turns, []);
  assert.equal(migrated.candidate_responses[0].exact_text, before.candidate_responses[0].exact_text);
  assert.deepEqual(migrated.candidate_responses[0].audit_history, before.candidate_responses[0].audit_history);
  assert.equal(migrated.candidate_responses[0].root_candidate_id, before.candidate_responses[0].root_candidate_id);
});
