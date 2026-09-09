import { ValidationError } from "../core/errors.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const CANDIDATE_ID = /^[A-Za-z0-9:_-]{1,160}$/;

function bounded(value, name, pattern = null) {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || (pattern && !pattern.test(value))) {
    throw new ValidationError(`${name} is invalid.`);
  }
  return value;
}

export function validatePrivateCaseHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Private case handoff must be an object.");
  if (value.schema_version !== 1 || value.kind !== "inner-signal-private-case-handoff") throw new ValidationError("Private case handoff version is invalid.");
  bounded(value.case_id, "case_id", CASE_ID);
  bounded(value.candidate_id, "candidate_id", CANDIDATE_ID);
  bounded(value.created_at, "created_at");
  bounded(value.continuation_evidence, "continuation_evidence");
  if (value.private_do_not_commit !== true || value.continuation_safe_verified !== true) throw new ValidationError("Private case handoff cannot claim availability without continuation-safe evidence.");
  if (value.retrieval?.tool !== "load_case_context") throw new ValidationError("Private case handoff retrieval tool is invalid.");
  if (value.retrieval.arguments?.case_id !== value.case_id || value.retrieval.arguments?.candidate_id !== value.candidate_id) {
    throw new ValidationError("Private case handoff retrieval arguments must use its stable identifiers.");
  }
  if (value.retrieval.authorization_source !== "configured_transport") throw new ValidationError("Private case handoff authorization source is invalid.");
  if (Object.hasOwn(value, "exact_text") || Object.hasOwn(value, "transcript")) throw new ValidationError("Private case handoff must reference private artifacts rather than embed them.");
  return value;
}

export function createPrivateCaseHandoff({ caseId, candidateId, continuationEvidence, createdAt = new Date().toISOString() } = {}) {
  return Object.freeze(validatePrivateCaseHandoff({
    schema_version: 1,
    kind: "inner-signal-private-case-handoff",
    private_do_not_commit: true,
    case_id: caseId,
    candidate_id: candidateId,
    created_at: createdAt,
    continuation_safe_verified: true,
    continuation_evidence: continuationEvidence,
    retrieval: {
      tool: "load_case_context",
      arguments: { case_id: caseId, candidate_id: candidateId },
      authorization_source: "configured_transport"
    }
  }));
}
