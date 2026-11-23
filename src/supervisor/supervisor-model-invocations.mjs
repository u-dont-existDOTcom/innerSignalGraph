import { ValidationError } from "../core/errors.mjs";
import { validatePrivateRuntimeEvidenceAuditResult, validatePrivateRuntimeRepairResult } from "../schemas/private-runtime.mjs";
import { sha256Json, supervisorInvocationInput, validateEvidenceShape, matchingSupervisorInvocation,
  responseEvidenceSnapshotSchema, verifySealedEvidenceOutput } from "./response-evidence-contract.mjs";
import { supervisorCandidateId, validateOperationKey } from "../storage/private-case-supervisor.mjs";

export const SUPERVISOR_INVOCATION_LIMITS = Object.freeze({ records: 20000, bytes: 1000000 });
const invalid = () => { throw new ValidationError("Supervisor invocation evidence invalid.", { code: "RESPONSE_EVIDENCE_INVALID" }); };
const bounded = value => typeof value === "string" && value.trim().length > 0 && value.length <= 160;
const same = (a, b) => sha256Json(a) === sha256Json(b);

export function supervisorCallCandidate(record, { operationKey, stage, candidateId, snapshot }) {
  validateOperationKey(operationKey);
  if (stage === "candidate") {
    if (candidateId !== supervisorCandidateId(operationKey, 1)) invalid();
    // The writer's input is the frozen inbound, not its as-yet unknown output.
    return { id: candidateId, version: null };
  }
  if (!["audit", "repair"].includes(stage)) invalid();
  const candidate = record.candidate_responses.find(entry => entry.id === candidateId);
  if (!candidate || candidate.metadata.supervisor_draft?.operation_key !== operationKey) invalid();
  return candidate;
}

export function normalizeSupervisorInvocationOutput(started, output, candidate, snapshot) {
  if (!bounded(output?.contextId) || !["provider", "model", "response_id"].every(key => bounded(output?.providerReceipt?.[key]))) invalid();
  const normalized = { contextId: output.contextId, providerReceipt: structuredClone(output.providerReceipt),
    responseEvidenceInclusion: structuredClone(output.responseEvidenceInclusion) };
  const inclusion = normalized.responseEvidenceInclusion;
  if (!inclusion || inclusion.snapshot_id !== snapshot.id || inclusion.snapshot_sha256 !== snapshot.snapshot_sha256
    || inclusion.view_sha256 !== started.input.view_sha256) invalid();
  if (started.input.stage === "audit") {
    if (output.contextId === candidate.producer_context_id) invalid();
    normalized.value = validatePrivateRuntimeEvidenceAuditResult(output.value ?? output.result, {
      candidateText: candidate.exact_text, snapshot, reconstructed: candidate.parent_candidate_id !== null
    });
    if (output.disclosureManifest != null) {
      if (typeof output.disclosureManifest !== "object" || Array.isArray(output.disclosureManifest)
        || Object.values(output.disclosureManifest).some(value => typeof value !== "boolean")) invalid();
      normalized.disclosureManifest = structuredClone(output.disclosureManifest);
    }
  } else {
    validatePrivateRuntimeRepairResult({ exact_text: output.exactText });
    normalized.exactText = output.exactText;
  }
  return normalized;
}

export function validateSupervisorInvocations(record) {
  const records = record.supervisor_invocations;
  if (!Array.isArray(records) || records.length > SUPERVISOR_INVOCATION_LIMITS.records) invalid();
  if (records.length === 0) return;
  const starts = new Map(), completedIds = new Set(), responses = new Set(), ids = new Set(), contexts = new Set();
  for (const turn of record.runtime_turns ?? []) for (const event of turn.events ?? []) {
    if (event.event_type !== "INVOCATION_COMPLETED") continue;
    const response = event.details?.output?.providerReceipt?.response_id;
    if (response != null) {
      responses.add(response);
    }
  }
  for (const entry of records) {
    if (!entry || entry.schema_version !== 1 || !bounded(entry.id) || ids.has(entry.id)
      || !bounded(entry.attempt_context_id) || !["STARTED", "COMPLETED"].includes(entry.event_type)
      || typeof entry.created_at !== "string" || Number.isNaN(Date.parse(entry.created_at))
      || Buffer.byteLength(JSON.stringify(entry)) > SUPERVISOR_INVOCATION_LIMITS.bytes
      || !same(Object.keys(entry).sort(), ["schema_version", "id", "event_type", "input", "attempt_context_id", "created_at", "actual_context_id", "provider_receipt", "output"].sort())) invalid();
    ids.add(entry.id);
    const input = entry.input;
    if (!input || !same(Object.keys(input).sort(), ["operation_key", "stage", "candidate_id", "candidate_version", "candidate_sha256", "snapshot_id", "snapshot_sha256", "view_sha256"].sort())) invalid();
    validateOperationKey(input?.operation_key);
    if (!["candidate", "audit", "repair"].includes(input.stage) || !bounded(input.candidate_id)
      || (!(input.stage === "candidate" && input.candidate_version === null)
        && (!Number.isSafeInteger(input.candidate_version) || input.candidate_version < 1))) invalid();
    for (const key of ["candidate_sha256", "snapshot_sha256", "view_sha256"]) validateEvidenceShape(input[key], responseEvidenceSnapshotSchema.properties.snapshot_sha256);
    const snapshot = record.response_evidence_snapshots.find(s => s.id === input.snapshot_id);
    if (!snapshot || snapshot.owner.kind !== "supervisor_draft" || snapshot.owner.operation_key !== input.operation_key
      || snapshot.snapshot_sha256 !== input.snapshot_sha256) invalid();
    if (input.stage === "candidate" && (input.candidate_id !== supervisorCandidateId(input.operation_key, 1)
      || input.candidate_sha256 !== snapshot.inbound.exact_text_sha256)) invalid();
    if (entry.event_type === "STARTED") {
      if (starts.has(entry.attempt_context_id) || entry.output !== null || entry.actual_context_id !== null || entry.provider_receipt !== null) invalid();
      starts.set(entry.attempt_context_id, entry);
    } else {
      const start = starts.get(entry.attempt_context_id);
      if (!start || completedIds.has(start.id) || !same(start.input, input) || entry.actual_context_id !== entry.output?.contextId
        || !same(entry.provider_receipt, entry.output?.providerReceipt)) invalid();
      const receipt = entry.provider_receipt;
      if (!["provider", "model", "response_id"].every(key => bounded(receipt?.[key])) || responses.has(receipt.response_id) || contexts.has(entry.actual_context_id)) invalid();
      responses.add(receipt.response_id); completedIds.add(start.id); contexts.add(entry.actual_context_id);
      // A root may now exist; the reserved writer identity remains unchanged when submission assigns its final version.
      const candidate = input.stage === "candidate" ? { id: input.candidate_id, version: input.candidate_version,
        exact_text: "" } : record.candidate_responses.find(c => c.id === input.candidate_id);
      if (!candidate) invalid();
      if (input.stage !== "candidate" && !same(supervisorInvocationInput({ operationKey: input.operation_key, stage: input.stage, candidate, snapshot, viewSha256: input.view_sha256 }), input)) invalid();
      if (!same(normalizeSupervisorInvocationOutput(start, entry.output, candidate, snapshot), entry.output)) invalid();
    }
  }
}

export function requireSupervisorInvocation(record, candidate, snapshot, { stage, contextId, viewSha256, exactText, audit }) {
  const output = matchingSupervisorInvocation(record, { operationKey: snapshot.owner.operation_key, stage, candidate, snapshot, viewSha256, contextId });
  return verifySealedEvidenceOutput(output, { contextId, snapshot, viewSha256, exactText, audit });
}
