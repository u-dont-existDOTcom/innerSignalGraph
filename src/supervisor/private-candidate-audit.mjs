import { randomUUID } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import {
  POST_RECONSTRUCTION_AUDIT_RULE,
  REPAIR_INDUCED_ERROR_CHECKS,
  createCandidateAuditEvidence
} from "./private-candidate-lifecycle.mjs";

export const PRIVATE_CANDIDATE_AUDIT_VERSION = "private-candidate-audit-v2";

export async function buildPrivateCandidateAuditInput({ caseAccessService, caseId, candidateId = "current_pending", authContext } = {}) {
  if (!caseAccessService || typeof caseAccessService.loadCaseContext !== "function") throw new ValidationError("caseAccessService is required.");
  const context = await caseAccessService.loadCaseContext(caseId, authContext, {
    candidateId,
    requireContinuationSafe: true,
    requireAuditScope: true,
    episodePolicy: { requireCompleteEpisode: true }
  });
  const candidate = context.candidate_response;
  if (!candidate?.exact_text) throw new ValidationError("Exact private candidate response is required for audit.", { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
  if (!["pending_audit", "reconstructed_pending_audit"].includes(candidate.status)) throw new ValidationError("Private candidate response is not pending audit.", { code: "PRIVATE_CANDIDATE_NOT_PENDING" });
  return Object.freeze({
    schema_version: 1,
    role: "AUTHORIZED_PRIVATE_CANDIDATE_AUDIT",
    case_id: caseId,
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    candidate_status: candidate.status,
    candidate_parent_candidate_id: candidate.parent_candidate_id ?? null,
    candidate_producer_context_id: candidate.producer_context_id ?? null,
    candidate_response: candidate.exact_text,
    constitution_ref: context.constitution_ref,
    case_state: context.case_state,
    last_state_diff: context.last_state_diff,
    recent_verbatim: context.recent_verbatim,
    targeted_older_evidence: context.targeted_older_evidence,
    current_episode: context.current_episode,
    continuation_safety: context.continuation_safety,
    binding_rule: POST_RECONSTRUCTION_AUDIT_RULE,
    reconstruction_audit_required: candidate.parent_candidate_id != null,
    repair_induced_error_checks: candidate.parent_candidate_id == null ? [] : REPAIR_INDUCED_ERROR_CHECKS,
    instructions: [
      "Audit the exact candidate_response before choosing a new therapeutic direction.",
      "Use the current structured state, exact recent episode, contradictions, targeted older raw evidence, and constitution reference.",
      "Handoff fidelity, candidate-audit fidelity, and reconstruction-audit fidelity are distinct gates; a correct handoff does not certify later reasoning.",
      "Audit evidence applies only to this exact candidate_id and candidate_version.",
      "If this is reconstructed, explicitly inspect every repair_induced_error_check and do not rely on the parent candidate's audit.",
      "Do not convert hypotheses into facts, repeat answered questions, expose hidden reasoning, or substitute a summary/hash for candidate_response."
    ],
    hidden_reasoning_included: false
  });
}

export async function runPrivateCandidateAudit({
  auditor,
  auditId = `audit:${randomUUID()}`,
  auditorContext,
  independentAuditorAvailable = true,
  completedAt,
  ...input
} = {}) {
  if (typeof auditor !== "function") throw new ValidationError("auditor must be a function.");
  if (!input.caseAccessService || typeof input.caseAccessService.recordCandidateAudit !== "function") throw new ValidationError("caseAccessService must persist version-bound candidate audits.");
  const auditInput = await buildPrivateCandidateAuditInput(input);
  const result = await auditor(auditInput);
  if (!result || typeof result !== "object" || Array.isArray(result) || !Array.isArray(result.findings)) {
    throw new ValidationError("Private candidate auditor must return a structured findings array.");
  }
  const candidate = {
    id: auditInput.candidate_id,
    version: auditInput.candidate_version,
    status: auditInput.candidate_status,
    exact_text: auditInput.candidate_response,
    parent_candidate_id: auditInput.candidate_parent_candidate_id,
    producer_context_id: auditInput.candidate_producer_context_id
  };
  const evidence = createCandidateAuditEvidence({
    auditId,
    candidate,
    auditVersion: PRIVATE_CANDIDATE_AUDIT_VERSION,
    auditorContext,
    findings: result.findings,
    repairInducedChecks: result.repair_induced_checks ?? [],
    independentAuditorAvailable,
    ...(completedAt ? { completedAt } : {})
  });
  const updatedRecord = await input.caseAccessService.recordCandidateAudit(input.caseId, auditInput.candidate_id, evidence, input.authContext);
  const updatedCandidate = updatedRecord.candidate_responses.find((entry) => entry.id === auditInput.candidate_id);
  return Object.freeze({
    case_id: auditInput.case_id,
    candidate_id: auditInput.candidate_id,
    candidate_version: auditInput.candidate_version,
    candidate_status: updatedCandidate.status,
    exact_candidate_resolved: true,
    audit_evidence: evidence,
    audit_result: result,
    delivery_blocked: updatedCandidate.status !== "approved_for_delivery"
  });
}

export async function reconstructPrivateCandidate({ caseAccessService, caseId, parentCandidateId, candidateId, exactText, producerContextId, basedOnAuditId, metadata = {}, authContext } = {}) {
  if (!caseAccessService || typeof caseAccessService.reconstructCandidateResponse !== "function") throw new ValidationError("caseAccessService must support candidate reconstruction.");
  return caseAccessService.reconstructCandidateResponse(caseId, parentCandidateId, candidateId, exactText, {
    ...metadata,
    producer_context_id: producerContextId,
    ...(basedOnAuditId ? { based_on_audit_id: basedOnAuditId } : {})
  }, authContext);
}

export async function approvePrivateCandidateForDelivery({ caseAccessService, caseId, candidateId, auditId, authContext } = {}) {
  if (!caseAccessService || typeof caseAccessService.approveCandidateForDelivery !== "function") throw new ValidationError("caseAccessService must enforce delivery approval.");
  return caseAccessService.approveCandidateForDelivery(caseId, candidateId, auditId, authContext);
}

export async function deliverPrivateCandidate({ caseAccessService, caseId, candidateId, authContext } = {}) {
  if (!caseAccessService || typeof caseAccessService.markCandidateSent !== "function") throw new ValidationError("caseAccessService must enforce exact-version delivery.");
  return caseAccessService.markCandidateSent(caseId, candidateId, authContext);
}
