import { ValidationError } from "../core/errors.mjs";
import { PrivateCaseAccessDeniedError } from "../storage/private-case-access.mjs";
import { candidateDeliveryGate } from "./private-candidate-lifecycle.mjs";
import { persistPrivateCandidateAuditResult, reconstructPrivateCandidate } from "./private-candidate-audit.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const PRIVATE_ID = /^[A-Za-z0-9:_-]{1,200}$/;
const OPERATIONS = new Set([
  "append_transcript_completion",
  "record_candidate_audit",
  "reconstruct_candidate_and_create_handoff",
  "create_handoff",
  "approve_candidate_for_delivery",
  "deliver_candidate_and_create_handoff",
  "mark_candidate_sent"
]);

function requiredText(value, name, maximum = 100_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function requiredId(value, name, pattern = PRIVATE_ID) {
  if (typeof value !== "string" || !pattern.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function requiredObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${name} must be an object.`);
  return value;
}

function commonRequest(request) {
  requiredObject(request, "Private case operation request");
  if (request.schema_version !== 1 || !OPERATIONS.has(request.operation)) throw new ValidationError("Private case operation version or name is invalid.");
  requiredId(request.case_id, "case_id", CASE_ID);
  return request;
}

function publicCandidateReceipt(caseId, candidate, { reused = false, handoffId = null } = {}) {
  const gate = candidateDeliveryGate(candidate);
  return Object.freeze({
    schema_version: 1,
    operation_succeeded: true,
    case_id: caseId,
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    candidate_status: candidate.status,
    repair_cycle: candidate.repair_cycle,
    delivery_allowed: gate.delivery_allowed,
    next_action: gate.action,
    ...(handoffId ? { handoff_id: handoffId } : {}),
    reused
  });
}

function assertReplayEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ValidationError(`${label} conflicts with an existing immutable record.`);
}

async function currentCandidate(caseAccessService, caseId, candidateId, authContext) {
  const candidate = await caseAccessService.getCandidateResponse(caseId, candidateId, authContext);
  if (!candidate) throw new ValidationError(`Candidate ${candidateId} was not found.`);
  return candidate;
}

async function loadOptionalHandoff(caseAccessService, handoffId, authContext) {
  try {
    return await caseAccessService.loadHandoff(handoffId, authContext, { requireContinuationSafe: false });
  } catch (error) {
    if (error instanceof PrivateCaseAccessDeniedError) return null;
    throw error;
  }
}

export function createPrivateCaseOrchestrator({ caseAccessService } = {}) {
  if (!caseAccessService || typeof caseAccessService !== "object") throw new ValidationError("caseAccessService is required.");

  return Object.freeze({
    async execute(request, authContext) {
      commonRequest(request);
      const caseId = request.case_id;

      if (request.operation === "append_transcript_completion") {
        requiredId(request.amendment_id, "amendment_id");
        requiredId(request.target_turn_id, "target_turn_id");
        requiredText(request.completion_text, "completion_text", 80_000);
        requiredId(request.source_artifact_id, "source_artifact_id");
        requiredId(request.producer_context_id, "producer_context_id");
        const existing = (await caseAccessService.getTranscriptAmendments(caseId, authContext)).find((entry) => entry.id === request.amendment_id);
        if (existing) {
          assertReplayEqual(
            [existing.target_turn_id, existing.completion_text, existing.provenance.source_artifact_id, existing.producer_context_id],
            [request.target_turn_id, request.completion_text, request.source_artifact_id, request.producer_context_id],
            `Transcript amendment ${request.amendment_id}`
          );
          return Object.freeze({ schema_version: 1, operation_succeeded: true, case_id: caseId, amendment_id: existing.id, target_turn_id: existing.target_turn_id, reused: true });
        }
        await caseAccessService.appendTranscriptCompletionAmendment(caseId, {
          amendmentId: request.amendment_id,
          targetTurnId: request.target_turn_id,
          completionText: request.completion_text,
          sourceArtifactId: request.source_artifact_id,
          sourceMetadata: request.source_metadata ?? {},
          producerContextId: request.producer_context_id
        }, authContext);
        return Object.freeze({ schema_version: 1, operation_succeeded: true, case_id: caseId, amendment_id: request.amendment_id, target_turn_id: request.target_turn_id, reused: false });
      }

      if (request.operation === "record_candidate_audit") {
        requiredId(request.candidate_id, "candidate_id");
        requiredId(request.audit_id, "audit_id");
        requiredObject(request.auditor_context, "auditor_context");
        const auditorContextIdStatus = request.auditor_context.context_id_status ?? (request.auditor_context.context_id == null ? "unavailable" : "known");
        const completedAtStatus = request.completed_at_status ?? (request.completed_at == null ? "unavailable" : "known");
        if (!["known", "unavailable"].includes(auditorContextIdStatus)) throw new ValidationError("auditor_context.context_id_status is invalid.");
        if (!["known", "unavailable"].includes(completedAtStatus)) throw new ValidationError("completed_at_status is invalid.");
        if (auditorContextIdStatus === "known") requiredId(request.auditor_context.context_id, "auditor_context.context_id");
        else if (request.auditor_context.context_id !== null) throw new ValidationError("An unavailable auditor context identifier must be null.");
        if (completedAtStatus === "known") requiredText(request.completed_at, "completed_at", 80);
        else if (request.completed_at !== null) throw new ValidationError("An unavailable audit completion time must be null.");
        const recordedAt = request.recorded_at ?? request.completed_at;
        if (auditorContextIdStatus === "unavailable" || completedAtStatus === "unavailable") requiredText(recordedAt, "recorded_at", 80);
        requiredObject(request.result, "result");
        if (!Array.isArray(request.result.findings)) throw new ValidationError("result.findings must be an array.");
        const candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
        const existing = candidate.audit_history.find((entry) => entry.id === request.audit_id);
        if (existing) {
          assertReplayEqual(
            [existing.auditor_kind, existing.auditor_context_id, existing.auditor_context_id_status ?? "known", existing.completed_at, existing.completed_at_status ?? "known", existing.recorded_at ?? existing.completed_at, existing.independent_auditor_available, existing.external_provenance ?? null, existing.findings, existing.repair_induced_checks],
            [request.auditor_context.kind, auditorContextIdStatus === "known" ? request.auditor_context.context_id : null, auditorContextIdStatus, completedAtStatus === "known" ? request.completed_at : null, completedAtStatus, recordedAt, request.independent_auditor_available !== false, request.external_provenance ?? null, request.result.findings.map((finding) => ({ unresolved: true, ...finding })), request.result.repair_induced_checks ?? []],
            `Candidate audit ${request.audit_id}`
          );
          return publicCandidateReceipt(caseId, candidate, { reused: true });
        }
        const persisted = await persistPrivateCandidateAuditResult({
          caseAccessService,
          caseId,
          candidateId: request.candidate_id,
          authContext,
          auditId: request.audit_id,
          auditorContext: request.auditor_context,
          independentAuditorAvailable: request.independent_auditor_available !== false,
          completedAt: request.completed_at,
          completedAtStatus,
          recordedAt,
          externalProvenance: request.external_provenance,
          result: request.result
        });
        return publicCandidateReceipt(caseId, await currentCandidate(caseAccessService, caseId, persisted.candidate_id, authContext));
      }

      if (request.operation === "reconstruct_candidate_and_create_handoff") {
        for (const [name, value] of [["parent_candidate_id", request.parent_candidate_id], ["candidate_id", request.candidate_id], ["producer_context_id", request.producer_context_id], ["based_on_audit_id", request.based_on_audit_id], ["handoff_id", request.handoff_id]]) requiredId(value, name);
        requiredText(request.exact_text, "exact_text");
        let candidate = await caseAccessService.getCandidateResponse(caseId, request.candidate_id, authContext);
        let reused = Boolean(candidate);
        if (candidate) {
          assertReplayEqual(
            [candidate.parent_candidate_id, candidate.exact_text, candidate.producer_context_id, candidate.metadata.based_on_audit_id],
            [request.parent_candidate_id, request.exact_text, request.producer_context_id, request.based_on_audit_id],
            `Candidate ${request.candidate_id}`
          );
        } else {
          await reconstructPrivateCandidate({
            caseAccessService,
            caseId,
            parentCandidateId: request.parent_candidate_id,
            candidateId: request.candidate_id,
            exactText: request.exact_text,
            producerContextId: request.producer_context_id,
            basedOnAuditId: request.based_on_audit_id,
            metadata: request.metadata ?? {},
            authContext
          });
          candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
        }
        const existingHandoff = await loadOptionalHandoff(caseAccessService, request.handoff_id, authContext);
        if (existingHandoff) {
          if (existingHandoff.case_id !== caseId) throw new ValidationError(`Handoff ${request.handoff_id} belongs to a different case.`);
          const bound = existingHandoff.pending_artifacts.find((entry) => entry.id === candidate.id);
          if (!bound || bound.version !== candidate.version || bound.exact_text !== candidate.exact_text) throw new ValidationError(`Handoff ${request.handoff_id} conflicts with the exact candidate version.`);
          reused = true;
        } else {
          await caseAccessService.createHandoff(caseId, {
            handoffId: request.handoff_id,
            runtimeVersion: requiredText(request.runtime_version, "runtime_version", 160),
            auditVersion: requiredText(request.audit_version, "audit_version", 160)
          }, authContext);
        }
        return publicCandidateReceipt(caseId, candidate, { reused, handoffId: request.handoff_id });
      }

      if (request.operation === "create_handoff") {
        requiredId(request.handoff_id, "handoff_id");
        const existing = await loadOptionalHandoff(caseAccessService, request.handoff_id, authContext);
        if (existing && existing.case_id !== caseId) throw new ValidationError(`Handoff ${request.handoff_id} belongs to a different case.`);
        if (!existing) await caseAccessService.createHandoff(caseId, {
          handoffId: request.handoff_id,
          runtimeVersion: requiredText(request.runtime_version, "runtime_version", 160),
          auditVersion: requiredText(request.audit_version, "audit_version", 160)
        }, authContext);
        const candidate = await currentCandidate(caseAccessService, caseId, "current_pending", authContext);
        return publicCandidateReceipt(caseId, candidate, { reused: Boolean(existing), handoffId: request.handoff_id });
      }

      if (request.operation === "approve_candidate_for_delivery") {
        requiredId(request.candidate_id, "candidate_id");
        requiredId(request.audit_id, "audit_id");
        let candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
        const reused = ["approved_for_delivery", "sent"].includes(candidate.status) && candidate.metadata.approval_audit_id === request.audit_id;
        if (!reused) {
          await caseAccessService.approveCandidateForDelivery(caseId, request.candidate_id, request.audit_id, authContext);
          candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
        }
        return publicCandidateReceipt(caseId, candidate, { reused });
      }

      if (request.operation === "deliver_candidate_and_create_handoff") {
        for (const [name, value] of [["candidate_id", request.candidate_id], ["audit_id", request.audit_id], ["assistant_turn_id", request.assistant_turn_id], ["in_reply_to_turn_id", request.in_reply_to_turn_id], ["handoff_id", request.handoff_id]]) requiredId(value, name);
        let candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
        const reusedDelivery = candidate.status === "sent";
        if (typeof caseAccessService.deliverCandidateResponse !== "function") throw new ValidationError("caseAccessService must support transcript-bound candidate delivery.");
        await caseAccessService.deliverCandidateResponse(caseId, request.candidate_id, {
          auditId: request.audit_id,
          assistantTurnId: request.assistant_turn_id,
          inReplyToTurnId: request.in_reply_to_turn_id
        }, authContext);
        candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
        const existing = await loadOptionalHandoff(caseAccessService, request.handoff_id, authContext);
        if (!existing) await caseAccessService.createHandoff(caseId, {
          handoffId: request.handoff_id,
          runtimeVersion: requiredText(request.runtime_version, "runtime_version", 160),
          auditVersion: requiredText(request.audit_version, "audit_version", 160)
        }, authContext);
        const handoff = existing ?? await caseAccessService.loadHandoff(request.handoff_id, authContext, { requireContinuationSafe: true });
        if (handoff.case_id !== caseId || handoff.delivery_completion?.candidate_id !== candidate.id
            || handoff.delivery_completion?.candidate_version !== candidate.version || handoff.delivery_completion?.audit_id !== request.audit_id
            || handoff.delivery_completion?.assistant_turn_id !== request.assistant_turn_id) {
          throw new ValidationError(`Handoff ${request.handoff_id} conflicts with the exact persisted delivery.`);
        }
        return publicCandidateReceipt(caseId, candidate, { reused: reusedDelivery && Boolean(existing), handoffId: request.handoff_id });
      }

      requiredId(request.candidate_id, "candidate_id");
      let candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
      const reused = candidate.status === "sent";
      if (!reused) {
        await caseAccessService.markCandidateSent(caseId, request.candidate_id, authContext);
        candidate = await currentCandidate(caseAccessService, caseId, request.candidate_id, authContext);
      }
      return publicCandidateReceipt(caseId, candidate, { reused });
    }
  });
}
