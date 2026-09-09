import { ValidationError } from "../core/errors.mjs";

export async function buildPrivateCandidateAuditInput({ caseAccessService, caseId, candidateId = "current_pending", authContext } = {}) {
  if (!caseAccessService || typeof caseAccessService.loadCaseContext !== "function") throw new ValidationError("caseAccessService is required.");
  const context = await caseAccessService.loadCaseContext(caseId, authContext, {
    candidateId,
    requireContinuationSafe: true,
    requireAuditScope: true,
    episodePolicy: { minimumCompleteExchanges: 3, requireCompleteEpisode: true }
  });
  const candidate = context.candidate_response;
  if (!candidate?.exact_text) throw new ValidationError("Exact private candidate response is required for audit.", { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
  if (candidate.status !== "pending_audit") throw new ValidationError("Private candidate response is not pending audit.", { code: "PRIVATE_CANDIDATE_NOT_PENDING" });
  return Object.freeze({
    schema_version: 1,
    role: "AUTHORIZED_PRIVATE_CANDIDATE_AUDIT",
    case_id: caseId,
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    candidate_status: candidate.status,
    candidate_response: candidate.exact_text,
    constitution_ref: context.constitution_ref,
    case_state: context.case_state,
    last_state_diff: context.last_state_diff,
    recent_verbatim: context.recent_verbatim,
    targeted_older_evidence: context.targeted_older_evidence,
    current_episode: context.current_episode,
    continuation_safety: context.continuation_safety,
    instructions: [
      "Audit the exact candidate_response before choosing a new therapeutic direction.",
      "Use the current structured state, exact recent episode, contradictions, targeted older raw evidence, and constitution reference.",
      "Do not convert hypotheses into facts, repeat answered questions, expose hidden reasoning, or substitute a summary/hash for candidate_response."
    ],
    hidden_reasoning_included: false
  });
}

export async function runPrivateCandidateAudit({ auditor, ...input } = {}) {
  if (typeof auditor !== "function") throw new ValidationError("auditor must be a function.");
  const auditInput = await buildPrivateCandidateAuditInput(input);
  const result = await auditor(auditInput);
  return Object.freeze({
    case_id: auditInput.case_id,
    candidate_id: auditInput.candidate_id,
    candidate_version: auditInput.candidate_version,
    exact_candidate_resolved: true,
    audit_result: result
  });
}
