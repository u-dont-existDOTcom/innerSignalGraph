import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

export const PRIVATE_CANDIDATE_STATUSES = Object.freeze([
  "pending_audit",
  "audit_failed",
  "reconstructed_pending_audit",
  "audited",
  "approved_for_delivery",
  "superseded",
  "sent"
]);

export const MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES = 2;

export const REPAIR_INDUCED_ERROR_CHECKS = Object.freeze([
  "causal_overclaim",
  "presuppositions_or_leading_questions",
  "over_specific_homework_or_tracking",
  "verbosity_or_repetition",
  "reduced_information_gain",
  "safety_inflation_or_underreaction",
  "telos_or_steering_drift",
  "context_or_history_omission",
  "hypothesis_rigidification",
  "unjustified_treatment_or_behavior_recommendation",
  "problem_replacement"
]);

// Binding runtime rule: audit approval is candidate-version-specific. Any
// substantive repair/reconstruction creates a new immutable candidate whose
// delivery gate is closed until that exact version passes a fresh independent
// audit. The writer of the reconstruction cannot certify its own output.
export const POST_RECONSTRUCTION_AUDIT_RULE = Object.freeze({
  id: "post-reconstruction-audit-gate-v1",
  maximum_repair_cycles: MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES,
  substantive_change_creates_new_candidate: true,
  audit_evidence_is_version_bound: true,
  reconstructed_candidate_inherits_approval: false,
  reconstruction_writer_may_self_approve: false
});

const ACTIVE_STATUSES = new Set(PRIVATE_CANDIDATE_STATUSES.filter((status) => !["superseded", "sent"].includes(status)));
const AUDITABLE_STATUSES = new Set(["pending_audit", "reconstructed_pending_audit"]);
const BLOCKING_SEVERITIES = new Set(["substantive", "high"]);
const FINDING_SEVERITIES = new Set(["low", "medium", ...BLOCKING_SEVERITIES]);
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function bounded(value, name, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function optionalBounded(value, name, maximum = 500) {
  if (value == null) return null;
  return bounded(value, name, maximum);
}

export function isActivePrivateCandidate(candidate) {
  return Boolean(candidate && ACTIVE_STATUSES.has(candidate.status));
}

export function isSubstantiveAuditFinding(finding) {
  return finding?.unresolved !== false && BLOCKING_SEVERITIES.has(finding?.severity);
}

export function validateCandidateAuditFinding(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`audit findings[${index}] must be an object.`);
  bounded(value.id, `audit findings[${index}].id`, 160);
  bounded(value.code, `audit findings[${index}].code`, 160);
  bounded(value.summary, `audit findings[${index}].summary`, 2_000);
  if (!FINDING_SEVERITIES.has(value.severity)) throw new ValidationError(`audit findings[${index}].severity is invalid.`);
  if (value.unresolved != null && typeof value.unresolved !== "boolean") throw new ValidationError(`audit findings[${index}].unresolved is invalid.`);
  if (value.evidence_turn_ids != null && (!Array.isArray(value.evidence_turn_ids) || value.evidence_turn_ids.some((id) => typeof id !== "string" || !id.trim()))) {
    throw new ValidationError(`audit findings[${index}].evidence_turn_ids is invalid.`);
  }
  return value;
}

export function validateCandidateAuditEvidence(value, candidate) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Candidate audit evidence must be an object.");
  if (value.schema_version !== 1) throw new ValidationError("Candidate audit evidence version is invalid.");
  bounded(value.id, "candidate audit id", 160);
  bounded(value.candidate_id, "candidate audit candidate_id", 160);
  if (typeof value.candidate_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.candidate_sha256)) throw new ValidationError("Candidate audit candidate_sha256 is invalid.");
  bounded(value.audit_version, "candidate audit version", 160);
  bounded(value.completed_at, "candidate audit completed_at", 80);
  bounded(value.auditor_context_id, "candidate audit auditor_context_id", 160);
  if (!Number.isSafeInteger(value.candidate_version) || value.candidate_version < 1) throw new ValidationError("Candidate audit candidate_version is invalid.");
  if (!["independent", "self_critique"].includes(value.auditor_kind)) throw new ValidationError("Candidate audit auditor_kind is invalid.");
  if (typeof value.independent_auditor_available !== "boolean" || typeof value.independent !== "boolean" || typeof value.sufficient_for_approval !== "boolean") {
    throw new ValidationError("Candidate audit independence evidence is invalid.");
  }
  if (!Array.isArray(value.findings)) throw new ValidationError("Candidate audit findings must be an array.");
  value.findings.forEach(validateCandidateAuditFinding);
  const findingIds = value.findings.map((finding) => finding.id);
  if (new Set(findingIds).size !== findingIds.length) throw new ValidationError("Candidate audit finding IDs must be unique.");
  const blockingIds = value.findings.filter(isSubstantiveAuditFinding).map((finding) => finding.id);
  if (!Array.isArray(value.unresolved_substantive_finding_ids) || JSON.stringify(value.unresolved_substantive_finding_ids) !== JSON.stringify(blockingIds)) {
    throw new ValidationError("Candidate audit unresolved substantive findings are inconsistent.");
  }
  const expectedVerdict = blockingIds.length ? "fail" : "pass";
  if (value.verdict !== expectedVerdict) throw new ValidationError("Candidate audit verdict is inconsistent with its findings.");
  if (value.independent !== (value.auditor_kind === "independent")) throw new ValidationError("Candidate audit independence classification is inconsistent.");
  if (value.sufficient_for_approval !== (value.independent && value.verdict === "pass")) throw new ValidationError("Candidate audit approval sufficiency is inconsistent.");

  if (candidate) {
    if (value.candidate_id !== candidate.id || value.candidate_version !== candidate.version) throw new ValidationError("Audit evidence belongs to a different candidate ID/version.");
    if (value.candidate_sha256 !== sha256Hex(candidate.exact_text)) throw new ValidationError("Audit evidence belongs to different exact candidate bytes.");
    if (value.independent && candidate.producer_context_id && value.auditor_context_id === candidate.producer_context_id) {
      throw new ValidationError("The candidate producer cannot certify its own reconstruction as an independent auditor.");
    }
    if (candidate.parent_candidate_id != null) {
      if (!Array.isArray(value.repair_induced_checks) || JSON.stringify(value.repair_induced_checks) !== JSON.stringify(REPAIR_INDUCED_ERROR_CHECKS)) {
        throw new ValidationError("A reconstructed candidate audit must explicitly cover every repair-induced error check.");
      }
    }
  }
  return value;
}

export function createCandidateAuditEvidence({
  auditId,
  candidate,
  auditVersion,
  auditorContext,
  findings = [],
  repairInducedChecks = [],
  independentAuditorAvailable = true,
  completedAt = new Date().toISOString()
} = {}) {
  if (!candidate || !AUDITABLE_STATUSES.has(candidate.status)) throw new ValidationError("Only the current pending candidate version can be audited.");
  if (!auditorContext || typeof auditorContext !== "object" || Array.isArray(auditorContext)) throw new ValidationError("auditorContext is required.");
  const normalizedFindings = structuredClone(findings).map((finding) => ({ unresolved: true, ...finding }));
  const independent = auditorContext.kind === "independent";
  const evidence = {
    schema_version: 1,
    id: auditId,
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    candidate_sha256: sha256Hex(candidate.exact_text),
    audit_version: auditVersion,
    completed_at: completedAt,
    auditor_kind: auditorContext.kind,
    auditor_context_id: auditorContext.context_id,
    independent_auditor_available: independentAuditorAvailable === true,
    independent,
    findings: normalizedFindings,
    unresolved_substantive_finding_ids: normalizedFindings.filter(isSubstantiveAuditFinding).map((finding) => finding.id),
    verdict: normalizedFindings.some(isSubstantiveAuditFinding) ? "fail" : "pass",
    sufficient_for_approval: independent && !normalizedFindings.some(isSubstantiveAuditFinding),
    repair_induced_checks: candidate.parent_candidate_id == null ? [] : [...repairInducedChecks]
  };
  return Object.freeze(validateCandidateAuditEvidence(evidence, candidate));
}

export function validateCandidateLifecycleFields(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ValidationError("Candidate lifecycle must be an object.");
  if (!PRIVATE_CANDIDATE_STATUSES.includes(candidate.status)) throw new ValidationError("Candidate lifecycle status is invalid.");
  optionalBounded(candidate.parent_candidate_id, "candidate parent_candidate_id", 160);
  bounded(candidate.root_candidate_id, "candidate root_candidate_id", 160);
  optionalBounded(candidate.producer_context_id, "candidate producer_context_id", 160);
  if (!Number.isSafeInteger(candidate.repair_cycle) || candidate.repair_cycle < 0 || candidate.repair_cycle > MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) {
    throw new ValidationError("Candidate repair_cycle is invalid.");
  }
  if ((candidate.parent_candidate_id == null) !== (candidate.repair_cycle === 0)) throw new ValidationError("Candidate parent and repair cycle are inconsistent.");
  if (!Array.isArray(candidate.audit_history)) throw new ValidationError("Candidate audit_history must be an array.");
  candidate.audit_history.forEach((audit) => validateCandidateAuditEvidence(audit, candidate));
  const auditIds = candidate.audit_history.map((audit) => audit.id);
  if (new Set(auditIds).size !== auditIds.length) throw new ValidationError("Candidate audit IDs must be unique per candidate.");
  if (["audited", "approved_for_delivery"].includes(candidate.status) && !candidate.audit_history.some((audit) => audit.sufficient_for_approval)) {
    throw new ValidationError("Candidate audit approval is not tied to this exact candidate version.");
  }
  return candidate;
}

function currentCandidate(candidates) {
  return [...candidates].reverse().find(isActivePrivateCandidate) ?? null;
}

function lineageFor(candidates, current) {
  if (!current) return [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const lineage = [];
  const seen = new Set();
  let cursor = current;
  while (cursor) {
    if (seen.has(cursor.id)) throw new ValidationError("Candidate lineage contains a cycle.");
    seen.add(cursor.id);
    lineage.push(cursor);
    cursor = cursor.parent_candidate_id == null ? null : byId.get(cursor.parent_candidate_id);
    if (lineage.at(-1).parent_candidate_id != null && !cursor) throw new ValidationError("Candidate lineage parent is missing.");
  }
  return lineage.reverse();
}

export function candidateDeliveryGate(candidate) {
  if (!candidate) return Object.freeze({ action: "BLOCK", delivery_allowed: false, reason: "current candidate is missing" });
  const exactPassingAudit = [...candidate.audit_history].reverse().find((audit) => audit.sufficient_for_approval) ?? null;
  if (candidate.status === "approved_for_delivery" && exactPassingAudit) {
    return Object.freeze({ action: "DELIVER", delivery_allowed: true, audit_id: exactPassingAudit.id, reason: "exact current candidate version has independent approval" });
  }
  if (candidate.status === "audited" && exactPassingAudit) {
    return Object.freeze({ action: "APPROVE_FOR_DELIVERY", delivery_allowed: false, audit_id: exactPassingAudit.id, reason: "exact candidate audit passed; explicit delivery approval remains" });
  }
  if (["pending_audit", "reconstructed_pending_audit"].includes(candidate.status)) {
    return Object.freeze({ action: "FRESH_INDEPENDENT_AUDIT", delivery_allowed: false, reason: "current candidate version has no sufficient independent audit" });
  }
  if (candidate.status === "audit_failed" && candidate.repair_cycle < MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) {
    return Object.freeze({ action: "RECONSTRUCT", delivery_allowed: false, reason: "current candidate has unresolved substantive/high findings" });
  }
  if (candidate.status === "audit_failed") {
    return Object.freeze({ action: "DISCRIMINATE_OR_BLOCK", delivery_allowed: false, reason: "maximum two repair cycles reached with serious uncertainty remaining" });
  }
  return Object.freeze({ action: "BLOCK", delivery_allowed: false, reason: `candidate status ${candidate.status} is not deliverable` });
}

export function projectCandidateLifecycle(candidates) {
  if (!Array.isArray(candidates)) throw new ValidationError("Candidate lifecycle source must be an array.");
  candidates.forEach(validateCandidateLifecycleFields);
  const current = currentCandidate(candidates);
  const lineage = lineageFor(candidates, current);
  const gate = candidateDeliveryGate(current);
  const previousFindings = lineage.slice(0, -1).flatMap((candidate) => candidate.audit_history.flatMap((audit) => audit.findings.map((finding) => ({
    candidate_id: candidate.id,
    candidate_version: candidate.version,
    audit_id: audit.id,
    ...structuredClone(finding)
  }))));
  const latestAudit = current?.audit_history.at(-1) ?? null;
  return Object.freeze({
    schema_version: 1,
    binding_rule_id: POST_RECONSTRUCTION_AUDIT_RULE.id,
    current_candidate_id: current?.id ?? null,
    current_candidate_version: current?.version ?? null,
    parent_candidate_id: current?.parent_candidate_id ?? null,
    root_candidate_id: current?.root_candidate_id ?? null,
    candidate_status: current?.status ?? null,
    repair_cycle: current?.repair_cycle ?? null,
    lineage: lineage.map((candidate) => ({ id: candidate.id, version: candidate.version, parent_candidate_id: candidate.parent_candidate_id, status: candidate.status })),
    audit_status: latestAudit ? `${latestAudit.verdict}:${latestAudit.auditor_kind}` : "not_audited",
    current_audit_id: latestAudit?.id ?? null,
    current_audit_candidate_id: latestAudit?.candidate_id ?? null,
    current_audit_candidate_version: latestAudit?.candidate_version ?? null,
    previous_findings: previousFindings,
    handoff_fidelity_status: "separate_continuation_gate",
    candidate_audit_fidelity_status: latestAudit ? "version_bound" : "pending",
    reconstruction_audit_fidelity_status: current?.parent_candidate_id == null
      ? "not_applicable"
      : (latestAudit?.sufficient_for_approval ? "fresh_independent_pass" : "pending_fresh_independent_audit"),
    delivery_blocked_pending_fresh_audit: gate.action === "FRESH_INDEPENDENT_AUDIT",
    delivery_gate: structuredClone(gate)
  });
}
