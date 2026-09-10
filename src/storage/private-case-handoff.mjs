import { createHash, randomUUID } from "node:crypto";
import { validateCaseState } from "../case-state/longitudinal-state.mjs";
import { validateTrackerEntry } from "../case-state/tracker.mjs";
import { validateTranscriptEntries } from "../case-state/context-window.mjs";
import { ValidationError } from "../core/errors.mjs";
import { candidateDeliveryGate, isActivePrivateCandidate, projectCandidateLifecycle, validateCandidateLifecycleFields } from "../supervisor/private-candidate-lifecycle.mjs";
import { chunkExactSourceText, createExactSourceArtifact, validateExactSourceArtifact } from "./exact-source-artifact.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const CANDIDATE_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const HANDOFF_ID = /^handoff:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HANDOFF_STATUS = Object.freeze({
  BLOCKED: "BLOCKED_CONTINUATION_UNSAFE",
  READY: "READY_FOR_FRESH_SESSION_TEST"
});
export const PRIVATE_HANDOFF_PACKET_VERSION = 1;
export const PRIVATE_HANDOFF_CHUNK_BYTES = 20_000;

function bounded(value, name, pattern = null, maximumLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength || (pattern && !pattern.test(value))) {
    throw new ValidationError(`${name} is invalid.`);
  }
  return value;
}

const clone = (value) => structuredClone(value);
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function canonicalJson(value) {
  if (value === undefined) throw new ValidationError("Private handoff contains an undefined value.");
  if (typeof value === "number" && !Number.isFinite(value)) throw new ValidationError("Private handoff contains a non-finite number.");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function validateJournalEntry(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`journal_entries[${index}] must be an object.`);
  bounded(value.id, `journal_entries[${index}].id`, null, 160);
  bounded(value.observed_at, `journal_entries[${index}].observed_at`, null, 80);
  bounded(value.text, `journal_entries[${index}].text`, null, 40_000);
  if (value.kind != null && !["journal", "dream"].includes(value.kind)) throw new ValidationError(`journal_entries[${index}].kind is invalid.`);
  return value;
}

function validateCandidate(candidate, index) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ValidationError(`pending_artifacts[${index}] must be an object.`);
  bounded(candidate.id, `pending_artifacts[${index}].id`, CANDIDATE_ID);
  bounded(candidate.exact_text, `pending_artifacts[${index}].exact_text`, null, 100_000);
  if (!isActivePrivateCandidate(candidate)) throw new ValidationError(`pending_artifacts[${index}] must be the active unsent candidate.`);
  if (!Number.isSafeInteger(candidate.version) || candidate.version < 1) throw new ValidationError(`pending_artifacts[${index}].version is invalid.`);
  const legacyCandidate = candidate.status === "pending_audit"
    && candidate.parent_candidate_id === undefined
    && candidate.audit_history === undefined;
  if (!legacyCandidate) validateCandidateLifecycleFields(candidate);
  return candidate;
}

function validateCandidateLifecycleProjection(value, candidate) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1) throw new ValidationError("Private handoff candidate_lifecycle is invalid.");
  if (!candidate) {
    const gate = candidateDeliveryGate(null);
    if (value.current_candidate_id !== null || value.current_candidate_version !== null || JSON.stringify(value.delivery_gate) !== JSON.stringify(gate)) {
      throw new ValidationError("Private handoff empty candidate lifecycle is inconsistent.");
    }
    return value;
  }
  if (value.current_candidate_id !== candidate.id || value.current_candidate_version !== candidate.version || value.parent_candidate_id !== candidate.parent_candidate_id || value.candidate_status !== candidate.status) {
    throw new ValidationError("Private handoff candidate lifecycle does not identify the exact current candidate version.");
  }
  const latestAudit = candidate.audit_history.at(-1) ?? null;
  if (value.current_audit_id !== (latestAudit?.id ?? null) || value.current_audit_candidate_id !== (latestAudit?.candidate_id ?? null) || value.current_audit_candidate_version !== (latestAudit?.candidate_version ?? null)) {
    throw new ValidationError("Private handoff audit status is not tied to the exact current candidate version.");
  }
  const gate = candidateDeliveryGate(candidate);
  if (JSON.stringify(value.delivery_gate) !== JSON.stringify(gate)) throw new ValidationError("Private handoff candidate delivery gate is inconsistent.");
  const expectedReconstructionStatus = candidate.parent_candidate_id == null
    ? "not_applicable"
    : (latestAudit?.sufficient_for_approval ? "fresh_independent_pass" : "pending_fresh_independent_audit");
  if (value.reconstruction_audit_fidelity_status !== expectedReconstructionStatus) throw new ValidationError("Private handoff reconstruction audit status is inconsistent.");
  if (value.delivery_blocked_pending_fresh_audit !== (gate.action === "FRESH_INDEPENDENT_AUDIT")) throw new ValidationError("Private handoff fresh-audit delivery block is inconsistent.");
  return value;
}

function componentManifest(components) {
  return Object.entries(components).map(([name, value]) => {
    const exactText = canonicalJson(value);
    const serialized = Buffer.from(exactText, "utf8");
    return Object.freeze({
      name,
      utf8_bytes: serialized.byteLength,
      sha256: sha256Hex(serialized),
      chunks: chunkExactSourceText(exactText, { maximumChunkBytes: PRIVATE_HANDOFF_CHUNK_BYTES })
    });
  });
}

function validateComponentManifest(packet) {
  if (!packet.manifest || packet.manifest.schema_version !== 1 || packet.manifest.serialization !== "canonical-json-utf8-v1") {
    throw new ValidationError("Private handoff manifest is invalid.");
  }
  if (packet.manifest.maximum_chunk_bytes !== PRIVATE_HANDOFF_CHUNK_BYTES) throw new ValidationError("Private handoff chunk policy is invalid.");
  const components = {
    canonical_state: packet.canonical_state,
    state_diff: packet.state_diff,
    recent_verbatim: packet.recent_verbatim,
    pending_artifacts: packet.pending_artifacts,
    transcript_archive: packet.transcript_archive,
    tracker_entries: packet.tracker_entries,
    journal_entries: packet.journal_entries,
    retrieval_index: packet.retrieval_index
  };
  if (Object.hasOwn(packet, "candidate_lifecycle")) components.candidate_lifecycle = packet.candidate_lifecycle;
  const expected = componentManifest(components);
  if (canonicalJson(packet.manifest.components) !== canonicalJson(expected)) throw new ValidationError("Private handoff component manifest failed its integrity check.");
}

export function createHandoffId(uuid = randomUUID()) {
  const value = `handoff:${uuid}`;
  bounded(value, "handoff_id", HANDOFF_ID);
  return value;
}

export function validateHandoffId(value) {
  return bounded(value, "handoff_id", HANDOFF_ID);
}

export function validatePrivateHandoffPacket(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Private handoff packet must be an object.");
  if (value.schema_version !== PRIVATE_HANDOFF_PACKET_VERSION || value.kind !== "inner-signal-private-handoff-packet") throw new ValidationError("Private handoff packet version is invalid.");
  bounded(value.handoff_id, "handoff_id", HANDOFF_ID);
  bounded(value.case_id, "case_id", CASE_ID);
  bounded(value.created_at, "created_at");
  for (const field of ["constitution", "runtime", "audit"]) bounded(value.versions?.[field], `versions.${field}`);
  validateCaseState(value.canonical_state);
  if (value.canonical_state.case_id !== value.case_id) throw new ValidationError("Private handoff case identity mismatch.");
  if (value.state_diff != null && (typeof value.state_diff !== "object" || Array.isArray(value.state_diff))) throw new ValidationError("Private handoff state_diff is invalid.");
  if (!value.recent_verbatim || typeof value.recent_verbatim !== "object" || !Array.isArray(value.recent_verbatim.turns)) throw new ValidationError("Private handoff recent_verbatim is invalid.");
  validateTranscriptEntries(value.recent_verbatim.turns);
  if (!Array.isArray(value.pending_artifacts)) throw new ValidationError("Private handoff pending_artifacts is invalid.");
  value.pending_artifacts.forEach(validateCandidate);
  if (value.pending_artifacts.length > 1) throw new ValidationError("Private handoff may contain only one current candidate version.");
  if (Object.hasOwn(value, "candidate_lifecycle")) validateCandidateLifecycleProjection(value.candidate_lifecycle, value.pending_artifacts.at(-1) ?? null);
  if (!Array.isArray(value.transcript_archive)) throw new ValidationError("Private handoff transcript_archive is invalid.");
  validateTranscriptEntries(value.transcript_archive);
  if (!Array.isArray(value.tracker_entries)) throw new ValidationError("Private handoff tracker_entries is invalid.");
  value.tracker_entries.forEach(validateTrackerEntry);
  if (!Array.isArray(value.journal_entries)) throw new ValidationError("Private handoff journal_entries is invalid.");
  value.journal_entries.forEach(validateJournalEntry);
  if (!value.retrieval_index || typeof value.retrieval_index !== "object" || Array.isArray(value.retrieval_index)) throw new ValidationError("Private handoff retrieval_index is invalid.");
  for (const field of ["transcript_turn_ids", "tracker_entry_ids", "journal_entry_ids", "intervention_ids", "significant_adverse_event_ids", "historical_decision_ids", "source_artifact_ids"]) {
    if (!Array.isArray(value.retrieval_index[field]) || value.retrieval_index[field].some((id) => typeof id !== "string" || !id.trim())) throw new ValidationError(`Private handoff retrieval_index.${field} is invalid.`);
  }
  const expectedTranscriptIds = value.transcript_archive.map((entry) => entry.id);
  const expectedTrackerIds = value.tracker_entries.map((entry) => entry.id);
  const expectedJournalIds = value.journal_entries.map((entry) => entry.id);
  const expectedInterventionIds = value.canonical_state.intervention_history.map((entry) => entry.id);
  if (canonicalJson(value.retrieval_index.transcript_turn_ids) !== canonicalJson(expectedTranscriptIds)) throw new ValidationError("Private handoff transcript retrieval index is inconsistent.");
  if (canonicalJson(value.retrieval_index.tracker_entry_ids) !== canonicalJson(expectedTrackerIds)) throw new ValidationError("Private handoff tracker retrieval index is inconsistent.");
  if (canonicalJson(value.retrieval_index.journal_entry_ids) !== canonicalJson(expectedJournalIds)) throw new ValidationError("Private handoff journal retrieval index is inconsistent.");
  if (canonicalJson(value.retrieval_index.intervention_ids) !== canonicalJson(expectedInterventionIds)) throw new ValidationError("Private handoff intervention retrieval index is inconsistent.");
  const archivedTurns = new Map(value.transcript_archive.map((entry) => [entry.id, entry]));
  for (const turn of value.recent_verbatim.turns) {
    if (!archivedTurns.has(turn.id) || canonicalJson(archivedTurns.get(turn.id)) !== canonicalJson(turn)) throw new ValidationError("Private handoff recent verbatim is not an exact transcript subset.");
  }
  if (!value.continuation_safety || typeof value.continuation_safety.continuation_safe !== "boolean" || !Array.isArray(value.continuation_safety.failures)) throw new ValidationError("Private handoff continuation_safety is invalid.");
  const expectedStatus = value.continuation_safety.continuation_safe ? HANDOFF_STATUS.READY : HANDOFF_STATUS.BLOCKED;
  if (value.handoff_status !== expectedStatus) throw new ValidationError("Private handoff status does not match continuation evidence.");
  if (value.continuation_safety.continuation_safe && (value.state_diff == null || value.pending_artifacts.length === 0)) {
    throw new ValidationError("A continuation-safe private handoff requires a state diff and pending candidate artifact.");
  }
  if (value.hidden_reasoning_included !== false) throw new ValidationError("Private handoff must not include hidden reasoning.");
  validateComponentManifest(value);
  return value;
}

export function compilePrivateHandoffArtifact({ handoffId, record, recentVerbatim, continuationSafety, runtimeVersion, auditVersion, createdAt } = {}) {
  bounded(handoffId, "handoff_id", HANDOFF_ID);
  bounded(record?.case_id, "case_id", CASE_ID);
  bounded(runtimeVersion, "runtimeVersion");
  bounded(auditVersion, "auditVersion");
  bounded(createdAt, "createdAt");
  const pendingArtifacts = record.candidate_responses.filter(isActivePrivateCandidate).map(clone);
  const candidateLifecycle = projectCandidateLifecycle(record.candidate_responses);
  const stateDiff = record.state_diff_history.at(-1) ?? null;
  const retrievalIndex = {
    transcript_turn_ids: record.raw_transcript.map((turn) => turn.id),
    tracker_entry_ids: record.tracker_entries.map((entry) => entry.id),
    journal_entry_ids: record.journal_entries.map((entry) => entry.id),
    intervention_ids: record.case_state.intervention_history.map((entry) => entry.id),
    significant_adverse_event_ids: [...record.case_state.items, ...record.case_state.intervention_history]
      .filter((entry) => entry.domain.includes("adverse") || entry.still_current === false)
      .map((entry) => entry.id),
    historical_decision_ids: [
      ...record.case_state.answered_questions.map((entry) => entry.id),
      ...record.case_state.contradiction_clusters.map((entry) => entry.id)
    ],
    source_artifact_ids: record.source_artifacts.map((entry) => entry.id)
  };
  const components = {
    canonical_state: clone(record.case_state),
    state_diff: clone(stateDiff),
    recent_verbatim: clone(recentVerbatim),
    pending_artifacts: pendingArtifacts,
    transcript_archive: clone(record.raw_transcript),
    tracker_entries: clone(record.tracker_entries),
    journal_entries: clone(record.journal_entries),
    retrieval_index: retrievalIndex,
    candidate_lifecycle: candidateLifecycle
  };
  const packet = validatePrivateHandoffPacket({
    schema_version: PRIVATE_HANDOFF_PACKET_VERSION,
    kind: "inner-signal-private-handoff-packet",
    handoff_id: handoffId,
    case_id: record.case_id,
    created_at: createdAt,
    versions: {
      constitution: record.case_state.constitution_ref.version,
      runtime: runtimeVersion,
      audit: auditVersion
    },
    ...components,
    continuation_safety: clone(continuationSafety),
    handoff_status: continuationSafety.continuation_safe ? HANDOFF_STATUS.READY : HANDOFF_STATUS.BLOCKED,
    manifest: {
      schema_version: 1,
      serialization: "canonical-json-utf8-v1",
      maximum_chunk_bytes: PRIVATE_HANDOFF_CHUNK_BYTES,
      components: componentManifest(components)
    },
    hidden_reasoning_included: false
  });
  const exactText = canonicalJson(packet);
  const artifact = createExactSourceArtifact({
    id: handoffId,
    chunks: chunkExactSourceText(exactText, { maximumChunkBytes: PRIVATE_HANDOFF_CHUNK_BYTES }),
    metadata: { kind: "private-handoff-packet", case_id: record.case_id },
    createdAt
  });
  return Object.freeze({ packet: clone(packet), artifact: clone(artifact) });
}

export function openPrivateHandoffArtifact(artifact) {
  validateExactSourceArtifact(artifact);
  let parsed;
  try { parsed = JSON.parse(artifact.exact_text); }
  catch { throw new ValidationError("Private handoff artifact JSON is invalid."); }
  const packet = validatePrivateHandoffPacket(parsed);
  if (canonicalJson(packet) !== artifact.exact_text) throw new ValidationError("Private handoff artifact is not canonical exact JSON.");
  if (packet.handoff_id !== artifact.id || packet.case_id !== artifact.metadata.case_id) throw new ValidationError("Private handoff artifact identity mismatch.");
  return Object.freeze(clone(packet));
}

export function projectHandoffTherapeuticContinuity(packet) {
  const value = validatePrivateHandoffPacket(clone(packet));
  const state = value.canonical_state;
  return Object.freeze({
    constitution_version: value.versions.constitution,
    current_target: state.current_episode?.target ?? null,
    current_path: state.current_episode?.route ?? null,
    current_prediction: state.current_episode?.prediction ?? null,
    stay_conditions: clone(state.current_episode?.stay_conditions ?? []),
    switch_conditions: clone(state.current_episode?.switch_conditions ?? []),
    stop_conditions: clone(state.current_episode?.stop_conditions ?? []),
    open_contradiction_ids: state.contradiction_clusters.filter((entry) => entry.status === "open").map((entry) => entry.id),
    trajectory_observability: clone(state.trajectory_observability),
    settled_answer_ids: state.answered_questions.filter((entry) => entry.still_current !== false).map((entry) => entry.id),
    current_hypothesis_ids: state.items.filter((entry) => entry.status === "hypothesis" && entry.still_current !== false).map((entry) => entry.id),
    failed_or_superseded_path_ids: state.intervention_history.filter((entry) => entry.still_current === false).map((entry) => entry.id),
    exact_pending_candidate_ids: value.pending_artifacts.map((entry) => entry.id),
    candidate_lifecycle: value.candidate_lifecycle ? clone(value.candidate_lifecycle) : null,
    hidden_reasoning_included: false
  });
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
