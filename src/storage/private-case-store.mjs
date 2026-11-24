import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RuntimeError, ValidationError } from "../core/errors.mjs";
import {
  RESPONSE_EVIDENCE_POLICY_VERSION, RESPONSE_EVIDENCE_BUDGETS, assessResponseEvidenceAdmission,
  buildEvidenceModelView, buildResponseEvidenceSnapshot, responseEvidenceSnapshotCurrent, responseEvidenceDependenciesCurrent, normalizeResponseEvidenceJournal,
  responseEvidenceCandidateSchema, responseEvidenceSnapshotSchema, validateEvidenceShape, validateResponseEvidenceAudit, validateResponseEvidenceSnapshot,
  supervisorInvocationInput, supervisorInvocationIdentity, normalizeRecordOnlyFinding, verifySealedEvidenceOutput, verifyRuntimeWriterInvocation
} from "../supervisor/response-evidence-contract.mjs";
import { normalizeSupervisorInvocationOutput, requireSupervisorInvocation, supervisorCallCandidate, validateSupervisorInvocations } from "../supervisor/supervisor-model-invocations.mjs";
import { applyCaseStatePatch, createEmptyCaseState, diffCaseStates, validateCaseState } from "../case-state/longitudinal-state.mjs";
import { projectEvidenceAuthority } from "../case-state/evidence-authority.mjs";
import { applyRoadmapDecision, projectCasePlan, readCaseRoadmap } from "../case-formulation/case-roadmap.mjs";
import { rankKnownVersusNew } from "../case-formulation/known-vs-new.mjs";
import { createJournalContinuityProjection } from "../case-state/journal-continuity.mjs";
import { appendTrackerEntry, summarizeTrackerWindow, validateTrackerEntry } from "../case-state/tracker.mjs";
import { buildDurableCaseContext, CONTEXT_WINDOW_LIMITS, selectRecentVerbatimWindow, validateTranscriptEntries } from "../case-state/context-window.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "../supervisor/private-candidate-audit.mjs";
import { OWNER_FALLBACK_KIND } from "../supervisor/owner-fallback-message.mjs";
import {
  MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES,
  PRIVATE_CANDIDATE_STATUSES,
  REPAIR_INDUCED_ERROR_CHECKS,
  candidateDeliveryGate,
  createCandidateAuditEvidence,
  isActivePrivateCandidate,
  projectCandidateLifecycle,
  validateCandidateAuditEvidence,
  validateCandidateLifecycleFields
} from "../supervisor/private-candidate-lifecycle.mjs";
import {
  appendPrivateRuntimeInvocationEvent,
  appendPrivateRuntimeTransition,
  createPrivateRuntimeDiscriminator,
  createPrivateRuntimeTurn,
  createRunnerClosure,
  isFinishedRuntimeTurn,
  sha256ExactText,
  validatePrivateRuntimeDiscriminatorReview,
  validatePrivateRuntimeTurn
} from "../supervisor/private-runtime-turn-lifecycle.mjs";
import { createVaultEnvelope, replaceVaultPayloadWithRoutineKek } from "./vault-crypto.mjs";
import { openVaultWithDevelopmentAuthorization, openVaultWithManagedSecretAuthorization, openVaultWithRoutineAuthorization } from "./vault-routine-access.mjs";
import { chunkExactSourceText, createExactSourceArtifact, EXACT_SOURCE_LIMITS, validateExactSourceArtifact } from "./exact-source-artifact.mjs";
import { assessContinuationSafety } from "./private-case-continuity.mjs";
import {
  createCommunicationEvent,
  projectCommunicationState,
  resolveCandidateAppDelivery,
  resolveHistoricalDeliveryCheckpoint,
  sameCommunicationEvent,
  validateCommunicationEvents
} from "./private-case-communication.mjs";
import {
  SUPERVISOR_DRAFT_VERSION,
  SUPERVISOR_LIMITS,
  assertSameSupervisorOperation,
  assessSupervisorArtifact,
  companionForCandidate,
  companionView,
  computeResponseBasis,
  createSupervisorCompanionEntry,
  createSupervisorInputEntry,
  createSupervisorReviewReceipt,
  findSupervisorArtifact,
  isSupervisorDraftCandidate,
  responseBasisDigest,
  sha256Json,
  sha256Text,
  supervisorArtifactId,
  supervisorArtifactView,
  supervisorArtifactViews,
  supervisorAuditId,
  supervisorCandidateId,
  supervisorEntries,
  supervisorInputIdentity,
  supervisorInputViews,
  supervisorReportIdentity,
  supervisorSubmissionIdentity,
  validateOperationKey,
  validateSupervisorArtifacts
} from "./private-case-supervisor.mjs";
import { compilePrivateHandoffArtifact, createHandoffId, openPrivateHandoffArtifact, validateHandoffId } from "./private-case-handoff.mjs";
import { listPrivateArtifactLocatorsForCase, writePrivateArtifactLocator } from "./private-artifact-locator.mjs";
import { listPrivateCaseAliasLocatorsForCase, writePrivateCaseAliasLocator } from "./private-case-alias-locator.mjs";
import { privateJournalCorpusDirectory } from "./private-journal-corpus.mjs";
import { compatibilityStateBinding } from "../case-formulation/protective-compatibility.mjs";
import {
  TRANSCRIPT_AMENDMENT_LIMITS,
  applyTranscriptAmendments,
  createTranscriptCompletionAmendment,
  validateTranscriptAmendments
} from "./transcript-amendments.mjs";
import { getSharedCaseMutationCoordinator } from "./shared-case-coordinator.mjs";
import {
  KEPT_PLAN_DELETION_REASONS,
  assertKeptPlansAppendOnly,
  crisisReadingOf,
  earlierRepliesInConversation,
  keepPlanBasis,
  keepPlanYesConfirmed,
  keptPlanExpired,
  keptPlanLinesFound,
  keptPlanRefusal,
  markKeptPlanDeleted,
  validateKeptPlans
} from "../runner-trial/kept-plan.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const JOURNAL_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const ENVELOPE_FORMAT = "inner-signal-private-case-envelope-v1";
const RECORD_VERSION = 7;
const TRACKER_QUERY_VARIABLES = Object.freeze([
  "sleep_duration_hours", "sleep_quality", "pain_intensity", "pain_location", "pain_function_interference",
  "anxiety", "depressed_mood", "stability", "unreality", "division", "social_contact_quality",
  "rejection_impact", "shaking_minutes", "shaking_intensity", "shaking_timing", "thc_used", "thc_timing",
  "substances_medications_supplements", "interventions", "food_exposures", "stressors_events", "activities",
  "functioning", "journal_note", "dream_note"
]);
const PRIVATE_RECORD_LIMITS = Object.freeze({
  tracker_entries: 20_000,
  journal_entries: 20_000,
  journal_text: 40_000,
  state_diffs: 20_000,
  transcript_amendments: TRANSCRIPT_AMENDMENT_LIMITS.amendments,
  candidates: 2_000,
  runtime_turns: 20_000,
  candidate_text: 100_000,
  candidate_metadata_bytes: 40_000,
  source_artifacts: EXACT_SOURCE_LIMITS.artifacts,
  evidence_results: 200,
  handoff_export_bytes: 12_000_000
});

const bytes = (value, name) => {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new ValidationError(`${name} must be non-empty bytes.`);
  return Buffer.from(value);
};
const safeCaseId = (value) => {
  if (typeof value !== "string" || !CASE_ID.test(value)) throw new ValidationError("caseId is invalid.");
  return value;
};
const safeJournalId = (value, name) => {
  if (typeof value !== "string" || !JOURNAL_ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
};
const base64 = (value) => Buffer.from(value).toString("base64");
const fromBase64 = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new ValidationError("Encrypted case envelope is invalid.");
  return Buffer.from(value, "base64");
};
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function selectedTimeRange(timeRange) {
  if (timeRange == null) return { from: null, to: null };
  if (!timeRange || typeof timeRange !== "object" || Array.isArray(timeRange)) throw new ValidationError("timeRange must be an object.");
  const from = timeRange.from == null ? null : Date.parse(timeRange.from);
  const to = timeRange.to == null ? null : Date.parse(timeRange.to);
  if ((timeRange.from != null && Number.isNaN(from)) || (timeRange.to != null && Number.isNaN(to)) || (from != null && to != null && from > to)) throw new ValidationError("timeRange is invalid.");
  return { from, to };
}

function withinTimeRange(observedAt, range) {
  const value = Date.parse(observedAt);
  return (range.from == null || value >= range.from) && (range.to == null || value <= range.to);
}

function selectTrackerEntries(entries, { variables = [], timeRange = null, limit = 180 } = {}) {
  if (!Array.isArray(variables) || variables.length > TRACKER_QUERY_VARIABLES.length || variables.some((name) => !TRACKER_QUERY_VARIABLES.includes(name))) throw new ValidationError("Tracker variables are invalid.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 180) throw new ValidationError("Tracker retrieval limit is invalid.");
  const range = selectedTimeRange(timeRange);
  const eligible = entries.filter((entry) => withinTimeRange(entry.observed_at, range));
  const selected = eligible.slice(-limit);
  const projected = variables.length
    ? selected.map((entry) => Object.fromEntries([["id", entry.id], ["observed_at", entry.observed_at], ...variables.map((name) => [name, cloneValue(entry[name])])]))
    : structuredClone(selected);
  return Object.freeze({
    schema_version: 1,
    interpretation: "descriptive_only_no_causal_inference",
    variables: [...variables],
    time_range: timeRange ? structuredClone(timeRange) : null,
    entries: projected,
    summary: summarizeTrackerWindow(selected),
    truncated: eligible.length > selected.length
  });
}

function cloneValue(value) {
  return value == null || typeof value !== "object" ? value : structuredClone(value);
}

function selectJournalEntries(entries, { query = null, timeRange = null, limit = 200 } = {}) {
  if (query != null && (typeof query !== "string" || !query.trim() || query.length > 1_000)) throw new ValidationError("Journal query must be bounded non-empty text.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationError("Journal retrieval limit is invalid.");
  const range = selectedTimeRange(timeRange);
  const terms = query ? query.toLocaleLowerCase().split(/\s+/u).filter((term) => term.length > 1) : [];
  const eligible = entries.filter((entry) => {
    if (!withinTimeRange(entry.observed_at, range)) return false;
    if (!terms.length) return true;
    const searchable = `${entry.kind ?? "journal"} ${entry.text}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  const selected = eligible.slice(-limit);
  return Object.freeze({
    schema_version: 1,
    query,
    time_range: timeRange ? structuredClone(timeRange) : null,
    entries: structuredClone(selected),
    truncated: eligible.length > selected.length,
    promoted_to_case_fact: false
  });
}

export function serializeVaultEnvelope(envelope) {
  return {
    format: ENVELOPE_FORMAT,
    version: envelope.version,
    suiteId: envelope.suiteId,
    payload: {
      iv: base64(envelope.payload.iv),
      ciphertext: base64(envelope.payload.ciphertext),
      authTag: base64(envelope.payload.authTag)
    },
    keyWraps: {
      routine: {
        iv: base64(envelope.keyWraps.routine.iv),
        ciphertext: base64(envelope.keyWraps.routine.ciphertext),
        authTag: base64(envelope.keyWraps.routine.authTag)
      },
      recovery: {
        salt: base64(envelope.keyWraps.recovery.salt),
        iv: base64(envelope.keyWraps.recovery.iv),
        ciphertext: base64(envelope.keyWraps.recovery.ciphertext),
        authTag: base64(envelope.keyWraps.recovery.authTag)
      }
    }
  };
}

export function deserializeVaultEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.format !== ENVELOPE_FORMAT) throw new ValidationError("Encrypted case envelope is invalid.");
  return {
    version: value.version,
    suiteId: value.suiteId,
    payload: {
      iv: fromBase64(value.payload?.iv),
      ciphertext: fromBase64(value.payload?.ciphertext),
      authTag: fromBase64(value.payload?.authTag)
    },
    keyWraps: {
      routine: {
        iv: fromBase64(value.keyWraps?.routine?.iv),
        ciphertext: fromBase64(value.keyWraps?.routine?.ciphertext),
        authTag: fromBase64(value.keyWraps?.routine?.authTag)
      },
      recovery: {
        salt: fromBase64(value.keyWraps?.recovery?.salt),
        iv: fromBase64(value.keyWraps?.recovery?.iv),
        ciphertext: fromBase64(value.keyWraps?.recovery?.ciphertext),
        authTag: fromBase64(value.keyWraps?.recovery?.authTag)
      }
    }
  };
}

function validateJournalEntry(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`journal_entries[${index}] must be an object.`);
  for (const field of ["id", "observed_at", "text"]) if (typeof value[field] !== "string" || !value[field].trim()) throw new ValidationError(`journal_entries[${index}].${field} is required.`);
  if (value.id.length > 160 || value.observed_at.length > 80 || value.text.length > PRIVATE_RECORD_LIMITS.journal_text) throw new ValidationError(`journal_entries[${index}] exceeds a bounded field limit.`);
  if (value.kind != null && !["journal", "dream"].includes(value.kind)) throw new ValidationError(`journal_entries[${index}].kind is invalid.`);
  return value;
}

function validateStateDiffEntry(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`state_diff_history[${index}] must be an object.`);
  for (const field of ["id", "turn_id", "recorded_at"]) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].length > 160) throw new ValidationError(`state_diff_history[${index}].${field} is invalid.`);
  }
  if (!value.diff || typeof value.diff !== "object" || Array.isArray(value.diff)) throw new ValidationError(`state_diff_history[${index}].diff must be an object.`);
  return value;
}

function validateCandidateResponse(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`candidate_responses[${index}] must be an object.`);
  for (const field of ["id", "exact_text", "created_at", "updated_at"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) throw new ValidationError(`candidate_responses[${index}].${field} is required.`);
  }
  if (value.id.length > 160 || value.created_at.length > 80 || value.updated_at.length > 80 || value.exact_text.length > PRIVATE_RECORD_LIMITS.candidate_text) {
    throw new ValidationError(`candidate_responses[${index}] exceeds a bounded field limit.`);
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1) throw new ValidationError(`candidate_responses[${index}].version is invalid.`);
  if (!PRIVATE_CANDIDATE_STATUSES.includes(value.status)) throw new ValidationError(`candidate_responses[${index}].status is invalid.`);
  if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) throw new ValidationError(`candidate_responses[${index}].metadata must be an object.`);
  let metadataBytes;
  try { metadataBytes = Buffer.byteLength(JSON.stringify(value.metadata), "utf8"); }
  catch { throw new ValidationError(`candidate_responses[${index}].metadata must be JSON serializable.`); }
  if (metadataBytes > PRIVATE_RECORD_LIMITS.candidate_metadata_bytes) throw new ValidationError(`candidate_responses[${index}].metadata exceeds the bounded limit.`);
  validateCandidateLifecycleFields(value);
  if (value.metadata.response_evidence != null) validateEvidenceShape(value.metadata.response_evidence, responseEvidenceCandidateSchema);
  // A status-only `sent` is an operator's marking and must stay distinguishable from a transcript-bound delivery.
  if (value.metadata.sent_status_only === true && (value.status !== "sent" || value.metadata.sent_turn_id != null || value.metadata.sent_in_reply_to_turn_id != null)) {
    throw new ValidationError(`candidate_responses[${index}] status-only delivery cannot carry transcript delivery identifiers.`);
  }
  return value;
}

function normalizePrivateCaseRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  let migrated = structuredClone(value);
  if (value.schema_version === 1) {
    migrated.schema_version = 2;
    migrated.state_diff_history = migrated.last_state_diff
      ? [{ id: "legacy-diff-1", turn_id: "legacy-unknown-turn", recorded_at: migrated.updated_at, diff: structuredClone(migrated.last_state_diff) }]
      : [];
    migrated.candidate_responses = [];
  }
  if (migrated.schema_version === 2) {
    migrated.schema_version = 3;
    migrated.source_artifacts = [];
  }
  if (migrated.schema_version === 3) {
    migrated.schema_version = 4;
    const latestUnsentIndex = migrated.candidate_responses.findLastIndex((candidate) => !["superseded", "sent"].includes(candidate.status));
    migrated.candidate_responses = migrated.candidate_responses.map((candidate, index) => {
      const legacyAudited = candidate.status === "audited";
      const legacyActiveButNotCurrent = !["superseded", "sent"].includes(candidate.status) && index !== latestUnsentIndex;
      return {
        ...candidate,
        status: legacyActiveButNotCurrent ? "superseded" : (legacyAudited ? "pending_audit" : candidate.status),
        parent_candidate_id: candidate.parent_candidate_id ?? candidate.metadata?.parent_candidate_id ?? null,
        root_candidate_id: candidate.root_candidate_id ?? candidate.metadata?.root_candidate_id ?? candidate.id,
        repair_cycle: candidate.repair_cycle ?? candidate.metadata?.repair_cycle ?? 0,
        producer_context_id: candidate.producer_context_id ?? candidate.metadata?.producer_context_id ?? null,
        audit_history: candidate.audit_history ?? [],
        metadata: {
          ...candidate.metadata,
          ...(legacyAudited ? { legacy_unbound_audit_invalidated: true } : {}),
          ...(legacyActiveButNotCurrent ? { superseded_during_lifecycle_migration: true } : {})
        }
      };
    });
  }
  if (migrated.schema_version === 4) {
    migrated.schema_version = 5;
    migrated.transcript_amendments = [];
  }
  if (migrated.schema_version === 5) {
    migrated.schema_version = 6;
    migrated.runtime_turns = [];
  }
  if (migrated.schema_version === 6) {
    migrated.schema_version = RECORD_VERSION;
    migrated.revision = 0;
    migrated.journal_corpora = [];
    migrated.journal_corpus_keys = [];
  }
  // Additive within record version 7: a record from before communication evidence has no events, which says nothing
  // about whether anything was ever sent. Code from before this field keeps it through its own writes.
  if (!Object.hasOwn(migrated, "communication_events")) migrated.communication_events = [];
  // Additive within record version 7, like communication events: a record from before controlled supervisor drafts has no
  // supervisor inputs, companions or review receipts. Code from before this field keeps it through its own writes.
  if (!Object.hasOwn(migrated, "supervisor_artifacts")) migrated.supervisor_artifacts = [];
  if (!Object.hasOwn(migrated, "response_evidence_snapshots")) migrated.response_evidence_snapshots = [];
  if (!Object.hasOwn(migrated, "supervisor_invocations")) migrated.supervisor_invocations = [];
  return migrated;
}

export function validatePrivateCaseRecord(value) {
  value = normalizePrivateCaseRecord(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Private case record must be an object.");
  if (value.schema_version !== RECORD_VERSION) throw new ValidationError("Private case record version is invalid.");
  safeCaseId(value.case_id);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new ValidationError("Private case revision is invalid.");
  for (const field of ["created_at", "updated_at"]) if (typeof value[field] !== "string" || !value[field].trim()) throw new ValidationError(`Private case record ${field} is required.`);
  validateTranscriptEntries(value.raw_transcript);
  if (!Array.isArray(value.source_artifacts) || value.source_artifacts.length > PRIVATE_RECORD_LIMITS.source_artifacts) throw new ValidationError("source_artifacts exceeds the private-record limit or is invalid.");
  const sourceArtifactIds = new Set();
  value.source_artifacts.forEach((artifact, index) => {
    validateExactSourceArtifact(artifact, index);
    if (sourceArtifactIds.has(artifact.id)) throw new ValidationError(`Duplicate source artifact ${artifact.id}.`);
    sourceArtifactIds.add(artifact.id);
  });
  validateTranscriptAmendments(value.transcript_amendments, {
    rawTranscript: value.raw_transcript,
    sourceArtifacts: value.source_artifacts
  });
  validateCaseState(value.case_state);
  if (!Array.isArray(value.tracker_entries)) throw new ValidationError("tracker_entries must be an array.");
  if (value.tracker_entries.length > PRIVATE_RECORD_LIMITS.tracker_entries) throw new ValidationError("tracker_entries exceeds the private-record limit.");
  value.tracker_entries.forEach(validateTrackerEntry);
  if (!Array.isArray(value.journal_entries)) throw new ValidationError("journal_entries must be an array.");
  if (value.journal_entries.length > PRIVATE_RECORD_LIMITS.journal_entries) throw new ValidationError("journal_entries exceeds the private-record limit.");
  value.journal_entries.forEach(validateJournalEntry);
  if (value.last_state_diff != null && (typeof value.last_state_diff !== "object" || Array.isArray(value.last_state_diff))) throw new ValidationError("last_state_diff must be an object or null.");
  if (!Array.isArray(value.state_diff_history) || value.state_diff_history.length > PRIVATE_RECORD_LIMITS.state_diffs) throw new ValidationError("state_diff_history exceeds the private-record limit or is invalid.");
  value.state_diff_history.forEach(validateStateDiffEntry);
  if (!Array.isArray(value.candidate_responses) || value.candidate_responses.length > PRIVATE_RECORD_LIMITS.candidates) throw new ValidationError("candidate_responses exceeds the private-record limit or is invalid.");
  const candidateIds = new Set();
  value.candidate_responses.forEach((candidate, index) => {
    validateCandidateResponse(candidate, index);
    if (candidateIds.has(candidate.id)) throw new ValidationError(`Duplicate candidate response ${candidate.id}.`);
    candidateIds.add(candidate.id);
    if (candidate.version !== index + 1) throw new ValidationError("Candidate versions must be contiguous and immutable.");
    if (candidate.parent_candidate_id != null) {
      const parent = value.candidate_responses.slice(0, index).find((entry) => entry.id === candidate.parent_candidate_id);
      if (!parent) throw new ValidationError(`Candidate ${candidate.id} has a missing or forward parent.`);
      if (candidate.root_candidate_id !== parent.root_candidate_id || candidate.repair_cycle !== parent.repair_cycle + 1) {
        throw new ValidationError(`Candidate ${candidate.id} lineage is inconsistent with its parent.`);
      }
    } else if (candidate.root_candidate_id !== candidate.id) {
      throw new ValidationError(`Original candidate ${candidate.id} must be its own lineage root.`);
    }
  });
  if (value.candidate_responses.filter(isActivePrivateCandidate).length > 1) {
    throw new ValidationError("Private case record may contain only one active candidate version.");
  }
  if (!Array.isArray(value.runtime_turns) || value.runtime_turns.length > PRIVATE_RECORD_LIMITS.runtime_turns) {
    throw new ValidationError("runtime_turns exceeds the private-record limit or is invalid.");
  }
  const runtimeTurnIds = new Set();
  for (const runtimeTurn of value.runtime_turns) {
    validatePrivateRuntimeTurn(runtimeTurn);
    if (runtimeTurnIds.has(runtimeTurn.id)) throw new ValidationError(`Duplicate private runtime turn ${runtimeTurn.id}.`);
    runtimeTurnIds.add(runtimeTurn.id);
    const userTurn = value.raw_transcript.find((entry) => entry.id === runtimeTurn.user_turn_id);
    if (runtimeTurn.state !== "RECEIVED" && (!userTurn || userTurn.role !== "user" || userTurn.exchange_id !== runtimeTurn.exchange_id
        || userTurn.text !== runtimeTurn.inbound.exact_text)) {
      throw new ValidationError(`Private runtime turn ${runtimeTurn.id} has an invalid exact user transcript binding.`);
    }
    if (runtimeTurn.current_candidate_id != null && !value.candidate_responses.some((entry) => entry.id === runtimeTurn.current_candidate_id)) {
      throw new ValidationError(`Private runtime turn ${runtimeTurn.id} has a missing current candidate.`);
    }
    if (runtimeTurn.closure) {
      // A turn the runner trial closed without a reply: its fixed text is the exchange's assistant turn, byte for byte.
      const closingTurn = value.raw_transcript.find((entry) => entry.id === runtimeTurn.closure.assistant_turn_id);
      if (!closingTurn || closingTurn.role !== "assistant" || closingTurn.exchange_id !== runtimeTurn.exchange_id || closingTurn.text !== runtimeTurn.closure.exact_text) {
        throw new ValidationError(`Private runtime turn ${runtimeTurn.id} has an invalid exact closing transcript binding.`);
      }
    }
    if (runtimeTurn.delivery) {
      const assistantTurn = value.raw_transcript.find((entry) => entry.id === runtimeTurn.assistant_turn_id);
      if (!assistantTurn || assistantTurn.role !== "assistant" || assistantTurn.exchange_id !== runtimeTurn.exchange_id || assistantTurn.text !== runtimeTurn.delivery.exact_text) {
        throw new ValidationError(`Private runtime turn ${runtimeTurn.id} has an invalid exact delivery transcript binding.`);
      }
      if (runtimeTurn.delivery.kind === "candidate") {
        const candidate = value.candidate_responses.find((entry) => entry.id === runtimeTurn.delivery.candidate_id);
        const audit = candidate?.audit_history.find((entry) => entry.id === runtimeTurn.delivery.audit_id);
        if (!candidate || candidate.status !== "sent" || candidate.version !== runtimeTurn.delivery.candidate_version
            || candidate.exact_text !== runtimeTurn.delivery.exact_text || !audit?.sufficient_for_approval
            || audit.candidate_sha256 !== runtimeTurn.delivery.sha256) {
          throw new ValidationError(`Private runtime turn ${runtimeTurn.id} delivery is not bound to an exact independently approved candidate.`);
        }
        // Deliveries made before the candidate carried its transcript identifiers have neither; when present they must agree.
        if ((candidate.metadata.sent_turn_id != null && candidate.metadata.sent_turn_id !== runtimeTurn.delivery.assistant_turn_id)
            || (candidate.metadata.sent_in_reply_to_turn_id != null && candidate.metadata.sent_in_reply_to_turn_id !== runtimeTurn.user_turn_id)) {
          throw new ValidationError(`Private runtime turn ${runtimeTurn.id} delivery transcript identifiers disagree with its candidate.`);
        }
      }
    }
  }
  validateCommunicationEvents(value.communication_events, value);
  validateSupervisorArtifacts(value.supervisor_artifacts, value);
  validateSupervisorInvocations(value);
  if (!Array.isArray(value.response_evidence_snapshots) || value.response_evidence_snapshots.length > RESPONSE_EVIDENCE_BUDGETS.snapshots) {
    throw new ValidationError("Response evidence snapshot limit invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
  }
  const snapshotIds = new Set();
  const lastSnapshotByOwner = new Map();
  const expansionsByOwner = new Map();
  const runtimeById = new Map(value.runtime_turns.map((entry) => [entry.id, entry]));
  for (const snapshot of value.response_evidence_snapshots) {
    validateResponseEvidenceSnapshot(snapshot);
    if (snapshot.case_id !== value.case_id || snapshotIds.has(snapshot.id)) throw new ValidationError("Response evidence snapshot binding invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
    const ownerKey = sha256Json(snapshot.owner), prior = lastSnapshotByOwner.get(ownerKey);
    const runtime = snapshot.owner.kind === "runtime_turn" ? runtimeById.get(snapshot.owner.runtime_turn_id) : null;
    if (snapshot.revision !== (prior?.revision ?? 0) + 1 || snapshot.parent_snapshot_id !== (prior?.id ?? null)
        || (snapshot.owner.kind === "runtime_turn" && (!runtime || runtime.user_turn_id !== snapshot.inbound.turn_id || runtime.inbound.sha256 !== snapshot.inbound.exact_text_sha256))) {
      throw new ValidationError("Response evidence snapshot lineage invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
    }
    const expansions = (expansionsByOwner.get(ownerKey) ?? 0) + (snapshot.revision_reason === "evidence_expansion" ? 1 : 0);
    if (expansions > 1) throw new ValidationError("Response evidence expansion limit invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
    snapshotIds.add(snapshot.id);
    lastSnapshotByOwner.set(ownerKey, snapshot);
    expansionsByOwner.set(ownerKey, expansions);
  }
  if (!Array.isArray(value.journal_corpora) || !Array.isArray(value.journal_corpus_keys)) {
    throw new ValidationError("Journal corpus extensions are invalid.");
  }
  const corpusIds = new Set();
  for (const reference of value.journal_corpora) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new ValidationError("Journal corpus reference is invalid.");
    const keys = Object.keys(reference).sort();
    const expected = ["active_generation", "corpus_id", "manifest_object_id", "previous_generations", "visibility_epoch"].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected) || typeof reference.corpus_id !== "string" || !reference.corpus_id
        || (reference.active_generation != null && (typeof reference.active_generation !== "string" || !reference.active_generation))
        || typeof reference.manifest_object_id !== "string" || !reference.manifest_object_id
        || !Number.isSafeInteger(reference.visibility_epoch) || reference.visibility_epoch < 0
        || !Array.isArray(reference.previous_generations) || reference.previous_generations.some((item) => !item || typeof item.generation !== "string" || typeof item.manifest_object_id !== "string")) {
      throw new ValidationError("Journal corpus reference is invalid.");
    }
    if (corpusIds.has(reference.corpus_id)) throw new ValidationError("Duplicate journal corpus reference.");
    corpusIds.add(reference.corpus_id);
  }
  const keyCorpusIds = new Set();
  for (const entry of value.journal_corpus_keys) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["corpus_id", "key_base64", "key_version"])
        || typeof entry.corpus_id !== "string" || !entry.corpus_id
        || entry.key_version !== 1 || typeof entry.key_base64 !== "string") {
      throw new ValidationError("Journal corpus key entry is invalid.");
    }
    const key = Buffer.from(entry.key_base64, "base64");
    try { if (key.byteLength !== 32) throw new ValidationError("Journal corpus key entry is invalid."); }
    finally { key.fill(0); }
    if (keyCorpusIds.has(entry.corpus_id) || !corpusIds.has(entry.corpus_id)) throw new ValidationError("Journal corpus key binding is invalid.");
    keyCorpusIds.add(entry.corpus_id);
  }
  if (keyCorpusIds.size !== corpusIds.size) throw new ValidationError("Every journal corpus requires exactly one key entry.");
  // The runner trial's plans kept for next time (src/runner-trial/kept-plan.mjs). A case that never kept one has no such field.
  if (Object.hasOwn(value, "runner_kept_plans")) validateKeptPlans(value.runner_kept_plans, value);
  return value;
}

function newRecord(caseId, now) {
  return {
    schema_version: RECORD_VERSION,
    case_id: caseId,
    revision: 0,
    created_at: now,
    updated_at: now,
    raw_transcript: [],
    transcript_amendments: [],
    case_state: createEmptyCaseState({ caseId }),
    tracker_entries: [],
    journal_entries: [],
    last_state_diff: null,
    state_diff_history: [],
    candidate_responses: [],
    runtime_turns: [],
    source_artifacts: [],
    communication_events: [],
    supervisor_artifacts: [],
    response_evidence_snapshots: [],
    supervisor_invocations: [],
    journal_corpora: [],
    journal_corpus_keys: []
  };
}

function assertAppendOnly(previous, next) {
  if (next.raw_transcript.length < previous.raw_transcript.length) throw new ValidationError("Raw transcript is append-only.");
  for (let index = 0; index < previous.raw_transcript.length; index += 1) {
    if (JSON.stringify(previous.raw_transcript[index]) !== JSON.stringify(next.raw_transcript[index])) throw new ValidationError("Raw transcript is append-only and existing turns cannot be rewritten.");
  }
  if (next.transcript_amendments.length < previous.transcript_amendments.length) throw new ValidationError("Transcript amendments are append-only.");
  for (let index = 0; index < previous.transcript_amendments.length; index += 1) {
    if (JSON.stringify(previous.transcript_amendments[index]) !== JSON.stringify(next.transcript_amendments[index])) {
      throw new ValidationError("Transcript amendments are immutable and cannot be rewritten.");
    }
  }
  if (next.candidate_responses.length < previous.candidate_responses.length) throw new ValidationError("Candidate versions are append-only.");
  const immutableCandidateFields = ["id", "version", "exact_text", "created_at", "parent_candidate_id", "root_candidate_id", "repair_cycle", "producer_context_id"];
  for (let index = 0; index < previous.candidate_responses.length; index += 1) {
    const before = previous.candidate_responses[index];
    const after = next.candidate_responses[index];
    if (!after || immutableCandidateFields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))) {
      throw new ValidationError("Candidate versions are immutable and cannot be rewritten or reordered.");
    }
    if (JSON.stringify(before.metadata?.response_evidence) !== JSON.stringify(after.metadata?.response_evidence)) {
      throw new ValidationError("Response evidence candidate binding immutable.", { code: "RESPONSE_EVIDENCE_INVALID" });
    }
    if (after.audit_history.length < before.audit_history.length
        || before.audit_history.some((audit, auditIndex) => JSON.stringify(audit) !== JSON.stringify(after.audit_history[auditIndex]))) {
      throw new ValidationError("Candidate audit records are append-only and immutable.");
    }
  }
  if (next.runtime_turns.length < previous.runtime_turns.length) throw new ValidationError("Private runtime turns are append-only.");
  for (let index = 0; index < previous.runtime_turns.length; index += 1) {
    const before = previous.runtime_turns[index];
    const after = next.runtime_turns[index];
    for (const field of ["id", "exchange_id", "user_turn_id", "inbound", "created_at", "runner_config"]) {
      if (!after || JSON.stringify(before[field]) !== JSON.stringify(after[field])) throw new ValidationError("Private runtime turn identities are immutable.");
    }
    if (after.events.length < before.events.length || before.events.some((event, eventIndex) => JSON.stringify(event) !== JSON.stringify(after.events[eventIndex]))) {
      throw new ValidationError("Private runtime turn events are append-only and immutable.");
    }
    if (before.discriminator != null && JSON.stringify(before.discriminator) !== JSON.stringify(after.discriminator)) throw new ValidationError("Private runtime discriminator is immutable.");
    if (before.discriminator_review != null && JSON.stringify(before.discriminator_review) !== JSON.stringify(after.discriminator_review)) throw new ValidationError("Private runtime discriminator review is immutable.");
    if (before.delivery != null && JSON.stringify(before.delivery) !== JSON.stringify(after.delivery)) throw new ValidationError("Private runtime delivery is immutable.");
    // The runner trial's checker levels: every audit attempt's reading is kept, so a later one never erases an earlier one.
    const levelsBefore = before.runner_reading?.checker_levels ?? [];
    const levelsAfter = after.runner_reading?.checker_levels ?? [];
    if (levelsAfter.length < levelsBefore.length || levelsBefore.some((entry, levelIndex) => JSON.stringify(entry) !== JSON.stringify(levelsAfter[levelIndex]))) {
      throw new ValidationError("Runner checker levels are append-only and immutable.");
    }
    // When a turn kept a plan or deleted the kept plan, once stored, never changes.
    for (const field of ["kept_plan_kept_at", "kept_plan_deleted_at"]) {
      if (before[field] != null && before[field] !== after[field]) throw new ValidationError("A turn's kept-plan record is immutable.");
    }
  }
  if (next.source_artifacts.length < previous.source_artifacts.length) throw new ValidationError("Exact source artifacts are append-only.");
  for (let index = 0; index < previous.source_artifacts.length; index += 1) {
    if (JSON.stringify(previous.source_artifacts[index]) !== JSON.stringify(next.source_artifacts[index])) throw new ValidationError("Exact source artifacts are immutable and cannot be rewritten.");
  }
  const previousEvents = previous.communication_events ?? [];
  const nextEvents = next.communication_events ?? [];
  if (nextEvents.length < previousEvents.length) throw new ValidationError("Communication events are append-only.");
  for (let index = 0; index < previousEvents.length; index += 1) {
    if (JSON.stringify(previousEvents[index]) !== JSON.stringify(nextEvents[index])) throw new ValidationError("Communication events are immutable and cannot be rewritten.");
  }
  const previousSupervisor = previous.supervisor_artifacts ?? [];
  const nextSupervisor = next.supervisor_artifacts ?? [];
  if (nextSupervisor.length < previousSupervisor.length) throw new ValidationError("Supervisor artifacts are append-only.");
  for (let index = 0; index < previousSupervisor.length; index += 1) {
    if (JSON.stringify(previousSupervisor[index]) !== JSON.stringify(nextSupervisor[index])) throw new ValidationError("Supervisor artifacts are immutable and cannot be rewritten.");
  }
  const previousSnapshots = previous.response_evidence_snapshots ?? [];
  const nextSnapshots = next.response_evidence_snapshots ?? [];
  if (nextSnapshots.length < previousSnapshots.length || previousSnapshots.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(nextSnapshots[index]))) {
    throw new ValidationError("Response evidence snapshots immutable.", { code: "RESPONSE_EVIDENCE_INVALID" });
  }
  const beforeInvocations = previous.supervisor_invocations ?? [], afterInvocations = next.supervisor_invocations ?? [];
  if (afterInvocations.length < beforeInvocations.length || beforeInvocations.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(afterInvocations[index]))) {
    throw new ValidationError("Supervisor invocations are append-only and immutable.", { code: "RESPONSE_EVIDENCE_INVALID" });
  }
  if (next.journal_corpus_keys.length < previous.journal_corpus_keys.length) throw new ValidationError("Journal corpus keys are append-only.");
  for (let index = 0; index < previous.journal_corpus_keys.length; index += 1) {
    if (JSON.stringify(previous.journal_corpus_keys[index]) !== JSON.stringify(next.journal_corpus_keys[index])) {
      throw new ValidationError("Journal corpus keys are immutable.");
    }
  }
  const previousCorpora = new Map(previous.journal_corpora.map((reference) => [reference.corpus_id, reference]));
  for (const [corpusId] of previousCorpora) {
    if (!next.journal_corpora.some((reference) => reference.corpus_id === corpusId)) throw new ValidationError("Journal corpus references cannot be removed by ordinary mutation.");
  }
  assertKeptPlansAppendOnly(previous.runner_kept_plans ?? [], next.runner_kept_plans ?? []);
}

async function durableEncryptedWrite(file, envelope) {
  const temporary = `${file}.tmp`;
  const body = Buffer.from(`${JSON.stringify(serializeVaultEnvelope(envelope))}\n`, "utf8");
  let handle;
  try {
    handle = await fs.open(temporary, "w", 0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    body.fill(0);
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

// Removes one file; false when it was already gone.
async function removeFile(file) {
  try {
    await fs.unlink(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(directory) {
  let handle = null;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  } finally {
    await handle?.close();
  }
}

function selectContinuationCandidate(record, candidateId) {
  if (candidateId !== "current_pending") return record.candidate_responses.find((entry) => entry.id === candidateId) ?? null;
  const pending = [...record.candidate_responses].reverse().find((entry) => ["pending_audit", "reconstructed_pending_audit"].includes(entry.status));
  if (pending) return pending;
  const latest = record.candidate_responses.at(-1) ?? null;
  return latest?.status === "sent" ? latest : null;
}

// The sent candidate whose exact bytes the application committed as the answer to the user turn, however it was delivered.
// A candidate that was only marked `sent` has no such proof and resolves to null.
function candidateDeliveryCompletion(record, candidate) {
  const delivery = resolveCandidateAppDelivery(record, candidate);
  return delivery ? { candidate_id: delivery.candidate_id, candidate_version: delivery.candidate_version } : null;
}

export function createEncryptedPrivateCaseStore({
  rootDir,
  routineKek,
  recoverySecretBytes,
  osBackedReauthenticated = false,
  managedSecretAuthorized = false,
  developmentExternalCredentialAuthorized = false,
  mutationCoordinator = null,
  responseEvidencePolicy = "advisory",
  now = () => new Date().toISOString()
} = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private storage path.");
  if (!["advisory", "enforced"].includes(responseEvidencePolicy)) throw new ValidationError("Response evidence policy invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
  const assuranceModes = [osBackedReauthenticated, managedSecretAuthorized, developmentExternalCredentialAuthorized].filter((value) => value === true).length;
  if (assuranceModes === 0) {
    throw new ValidationError("OS-backed reauthentication, managed secret authorization, or an explicit development credential authorization is required before opening the private case store.");
  }
  if (assuranceModes !== 1) {
    throw new ValidationError("Private case access must use exactly one authorization assurance mode.");
  }
  const routineKey = bytes(routineKek, "routineKek");
  const recoverySecret = recoverySecretBytes == null ? null : bytes(recoverySecretBytes, "recoverySecretBytes");
  let closed = false;
  const coordinator = mutationCoordinator ?? getSharedCaseMutationCoordinator(rootDir);
  if (!coordinator || typeof coordinator.run !== "function") throw new ValidationError("mutationCoordinator must implement run().");

  const ensureOpen = () => {
    if (closed) throw new ValidationError("Private case store is closed.");
  };

  const fileFor = (caseId) => path.join(rootDir, `${safeCaseId(caseId)}.vault.json`);
  const handoffDirectory = path.join(rootDir, ".handoffs");
  const handoffFileFor = (handoffId) => path.join(handoffDirectory, `${sha256Hex(validateHandoffId(handoffId))}.vault.json`);
  const openEnvelopePlaintext = async (envelope) => {
    if (osBackedReauthenticated) return (await openVaultWithRoutineAuthorization({ osBackedReauthenticated: true, envelope, routineKek: routineKey })).plaintextBytes;
    if (managedSecretAuthorized) return (await openVaultWithManagedSecretAuthorization({ managedSecretAuthorized: true, envelope, routineKek: routineKey })).plaintextBytes;
    return (await openVaultWithDevelopmentAuthorization({ developmentExternalCredentialAuthorized: true, envelope, routineKek: routineKey })).plaintextBytes;
  };
  const readExistingWithEnvelope = async (caseId) => {
    ensureOpen();
    let serialized;
    try { serialized = JSON.parse(await fs.readFile(fileFor(caseId), "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    const envelope = deserializeVaultEnvelope(serialized);
    const plaintext = await openEnvelopePlaintext(envelope);
    try {
      const record = validatePrivateCaseRecord(JSON.parse(plaintext.toString("utf8")));
      if (record.case_id !== caseId) throw new ValidationError("Encrypted private case record identity mismatch.");
      return { record, envelope };
    }
    finally { plaintext.fill(0); }
  };
  const readHandoffArtifactWithEnvelope = async (handoffId, expectedCaseId = null) => {
    ensureOpen();
    let serialized;
    try { serialized = JSON.parse(await fs.readFile(handoffFileFor(handoffId), "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    const envelope = deserializeVaultEnvelope(serialized);
    const plaintext = await openEnvelopePlaintext(envelope);
    try {
      const artifact = validateExactSourceArtifact(JSON.parse(plaintext.toString("utf8")));
      const packet = openPrivateHandoffArtifact(artifact);
      if (packet.handoff_id !== handoffId || (expectedCaseId && packet.case_id !== expectedCaseId)) throw new ValidationError("Encrypted private handoff identity mismatch.");
      return { artifact, packet, envelope };
    } finally { plaintext.fill(0); }
  };
  const readExisting = async (caseId) => (await readExistingWithEnvelope(caseId))?.record ?? null;
  const write = async (caseId, record, previous = null, currentEnvelope = null) => {
    ensureOpen();
    safeCaseId(caseId);
    const candidate = validatePrivateCaseRecord(structuredClone(record));
    if (candidate.case_id !== caseId) throw new ValidationError("Private case record identity mismatch.");
    if (previous) assertAppendOnly(previous, candidate);
    // The empty optional extension is normalized in memory. Keeping it absent on disk preserves ordinary v7 payload bytes
    // when no snapshot has ever been frozen; once nonempty, append-only validation keeps it permanently.
    const payload = { ...candidate };
    if (candidate.response_evidence_snapshots.length === 0) delete payload.response_evidence_snapshots;
    if (candidate.supervisor_invocations.length === 0) delete payload.supervisor_invocations;
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    try {
      let envelope;
      if (currentEnvelope) {
        envelope = await replaceVaultPayloadWithRoutineKek({ envelope: currentEnvelope, plaintextBytes: plaintext, routineKek: routineKey });
      } else {
        if (!recoverySecret) throw new ValidationError("Recovery secret is required when creating a new private case envelope.");
        envelope = await createVaultEnvelope({ plaintextBytes: plaintext, routineKek: routineKey, recoverySecretBytes: recoverySecret });
      }
      await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
      await fs.chmod(rootDir, 0o700);
      await durableEncryptedWrite(fileFor(caseId), envelope);
    } finally { plaintext.fill(0); }
    return structuredClone(candidate);
  };
  const loadOrCreate = async (caseId) => mutate(safeCaseId(caseId), () => null);
  // `afterWrite` writes a file that names the case (a locator) in the same turn of the case's queue as the record, after it: a
  // deletion queued behind finds the file and removes it, so none can appear after a deletion returned. `requireExisting` leaves a
  // case that has no file as it is (the operation isn't run and the result is null), where every other write would create it.
  const mutate = async (caseId, operation, { afterWrite = null, requireExisting = false } = {}) => coordinator.run(safeCaseId(caseId), async () => {
    const id = safeCaseId(caseId);
    const existing = await readExistingWithEnvelope(id);
    if (!existing && requireExisting) return null;
    let previous;
    let currentEnvelope = null;
    if (existing) {
      previous = structuredClone(existing.record);
      currentEnvelope = existing.envelope;
    } else {
      const timestamp = now();
      previous = await write(id, newRecord(id, timestamp));
      const created = await readExistingWithEnvelope(id);
      currentEnvelope = created.envelope;
    }
    const next = await operation(structuredClone(previous));
    let result;
    if (next === null) result = structuredClone(previous);
    else {
      next.updated_at = now();
      next.revision = previous.revision + 1;
      result = await write(id, next, previous, currentEnvelope);
    }
    if (afterWrite) await afterWrite(result);
    return result;
  });
  const candidateLocator = (caseId, candidateId) => () => writePrivateArtifactLocator({ rootDir, kind: "candidate", artifactId: candidateId, caseId });
  const readRequired = async (caseId) => {
    const record = await readExisting(safeCaseId(caseId));
    if (!record) throw new ValidationError(`Private case ${caseId} was not found.`, { code: "PRIVATE_CASE_NOT_FOUND" });
    return record;
  };
  // An approved runner trial turn is closed without a reply only as a failed check, and only when its reply may no longer be sent
  // (the design for clients, point 6): response evidence no longer admits it at delivery, checked here again; or the trial holds it
  // back because the journal gate closed (`journalHold`), which is allowed only for a turn that read a client's journal (one of its
  // evidence snapshots holds journal quotations). The gate itself (consent, receipt, grant) is the trial's own record outside the
  // case, so the store can't check it; journal quotations alone, without the hold, never let an approved reply be closed (Codex's
  // review 1, finding 4). Otherwise the reply stays to be delivered.
  const approvedReplyMayNotBeSent = (record, runtimeTurn, reasonCode, journalHold) => {
    const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
    if (!candidate || reasonCode !== "checks_failed") return false;
    if (journalHold === true) {
      return (record.response_evidence_snapshots ?? []).some((entry) => entry.owner?.kind === "runtime_turn" && entry.owner.runtime_turn_id === runtimeTurn.id
        && entry.source_items.some((item) => item.kind === "journal_quotation"));
    }
    return !assessResponseEvidenceAdmission(record, candidate, { policy: responseEvidencePolicy, point: "deliverPrivateRuntimeCandidate" }).admissible;
  };
  const requireResponseEvidence = (record, candidate, point) => {
    const assessment = assessResponseEvidenceAdmission(record, candidate, { policy: responseEvidencePolicy, point });
    if (!assessment.admissible) throw new ValidationError("Response evidence admission refused.", { code: assessment.code, details: { reasons: assessment.reasons } });
    return assessment;
  };
  const finishRuntimeAudit = (record, runtimeTurn, candidate, audit, eventId) => {
    let nextState;
    if (audit.verdict === "fail") {
      candidate.status = "audit_failed";
      nextState = candidate.repair_cycle < MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES ? "REPAIR_REQUIRED" : "DISCRIMINATING_QUESTION_REQUIRED";
    } else {
      if (!audit.sufficient_for_approval) throw new ValidationError("Runtime PASS requires an available fresh independent auditor.");
      candidate.status = "approved_for_delivery";
      candidate.metadata = { ...candidate.metadata, approval_audit_id: audit.id };
      nextState = "APPROVED";
    }
    candidate.updated_at = now();
    validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
    const updatedRuntime = appendPrivateRuntimeTransition(runtimeTurn, {
      eventId,
      toState: nextState,
      at: now(),
      details: { audit_id: audit.id, candidate_id: candidate.id, candidate_version: candidate.version, candidate_sha256: audit.candidate_sha256, verdict: audit.verdict }
    });
    Object.assign(runtimeTurn, updatedRuntime);
    return record;
  };
  const requireDiscriminatorReview = (record, runtimeTurn, discriminator, review) => {
    const snapshot = record.response_evidence_snapshots.filter((entry) => entry.owner.kind === "runtime_turn" && entry.owner.runtime_turn_id === runtimeTurn.id).at(-1);
    if (discriminator.kind === OWNER_FALLBACK_KIND) return;
    if (!snapshot && responseEvidencePolicy !== "enforced") return;
    const blocked = () => { throw new ValidationError("Discriminating question evidence review required.", { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" }); };
    if (!snapshot || !review) blocked();
    validateResponseEvidenceSnapshot(snapshot);
    validatePrivateRuntimeDiscriminatorReview(review, { exactText: discriminator.exact_text, snapshot });
    const invocation = runtimeTurn.events.find((entry) => entry.event_type === "INVOCATION_COMPLETED" && entry.stage === "discriminator_review"
      && entry.details?.actual_context_id === review.auditor_context_id
      && entry.input_sha256 === sha256Text(JSON.stringify({ runtime_turn_id: runtimeTurn.id, sha256: discriminator.sha256, snapshot_sha256: snapshot.snapshot_sha256 })));
    if (discriminator.producer_context_id === review.auditor_context_id) blocked();
    try { verifySealedEvidenceOutput(invocation?.details?.output, { contextId: review.auditor_context_id, snapshot,
      viewSha256: review.auditor_inclusion_sha256, exactText: discriminator.exact_text, review }); } catch { blocked(); }
    const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
    const rootCandidate = record.candidate_responses.find((entry) => entry.id === candidate?.root_candidate_id);
    if (!responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate })) blocked();
  };
  // Delivery approval of the exact current candidate on a fresh independent audit that certifies that exact ID and version.
  const approveCandidateInRecord = (record, candidateId, auditId, point = "approveCandidateForDelivery") => {
    const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
    const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
    if (!candidate || current?.id !== candidateId) throw new ValidationError("Delivery approval must target the exact current candidate version.");
    requireResponseEvidence(record, candidate, point);
    if (candidate.status !== "audited") throw new ValidationError("Candidate must pass a fresh independent audit before delivery approval.");
    const audit = candidate.audit_history.find((entry) => entry.id === auditId);
    if (!audit?.sufficient_for_approval || audit.candidate_id !== candidate.id || audit.candidate_version !== candidate.version) {
      throw new ValidationError("Delivery approval audit does not certify the exact current candidate ID/version.");
    }
    candidate.status = "approved_for_delivery";
    candidate.updated_at = now();
    candidate.metadata = { ...candidate.metadata, approval_audit_id: audit.id };
    validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
  };
  // A plan decision's diff is `roadmap:<decision id>`; that prefix is kept for recordRoadmapDecision (`plan: true`).
  const isPlanDiff = (entry) => entry.id.startsWith("roadmap:");
  const appendDiff = (record, diff, { turnId = "unknown-turn", diffId = null, recordedAt = now(), last = true, plan = false } = {}) => {
    if (!diff || typeof diff !== "object" || Array.isArray(diff)) throw new ValidationError("stateDiff must be an object.");
    const entry = {
      id: diffId ?? `diff-${record.state_diff_history.length + 1}`,
      turn_id: turnId,
      recorded_at: recordedAt,
      diff: structuredClone(diff)
    };
    validateStateDiffEntry(entry, record.state_diff_history.length);
    if (isPlanDiff(entry) !== plan) throw new ValidationError("A state diff id starts with roadmap: only for a plan decision.");
    if (record.state_diff_history.some((candidate) => candidate.id === entry.id)) throw new ValidationError(`Duplicate state diff ${entry.id}.`);
    record.state_diff_history.push(entry);
    if (last) record.last_state_diff = structuredClone(diff);
  };
  // The case's last turn diff: a plan decision's diff is kept in the history and found by its id, but never stands in for the
  // last turn's change that continuity checks, handoffs and audits read.
  const lastTurnDiff = (record) => [...record.state_diff_history].reverse().find((entry) => !isPlanDiff(entry)) ?? null;
  // The case's plan has one writer, recordRoadmapDecision: every other write of the whole case state keeps the plan the
  // record holds and ignores any plan it carries, so a state computed from an earlier read can't drop a decision and no other
  // scope can rewrite the plan. A value that isn't a case state goes on to the case state check, which refuses it.
  const keepStoredRoadmap = (incoming, current) => {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
    const next = structuredClone(incoming);
    if (current?.roadmap != null) next.roadmap = structuredClone(current.roadmap);
    else delete next.roadmap;
    return next;
  };
  const effectiveTranscript = (record) => applyTranscriptAmendments(record.raw_transcript, record.transcript_amendments, {
    sourceArtifacts: record.source_artifacts
  });
  const runtimeTurnIn = (record, runtimeTurnId) => {
    const runtimeTurn = record.runtime_turns.find((entry) => entry.id === runtimeTurnId);
    if (!runtimeTurn) throw new ValidationError(`Private runtime turn ${runtimeTurnId} was not found.`, { code: "PRIVATE_RUNTIME_TURN_NOT_FOUND" });
    return runtimeTurn;
  };
  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const selectEvidence = (record, { query = null, provenanceIds = [], timeRange = null, limit = 24 } = {}) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > PRIVATE_RECORD_LIMITS.evidence_results) throw new ValidationError("Evidence retrieval limit is invalid.");
    if (query != null && (typeof query !== "string" || !query.trim() || query.length > 1_000)) throw new ValidationError("Evidence query must be bounded non-empty text.");
    if (!Array.isArray(provenanceIds) || provenanceIds.some((id) => typeof id !== "string" || !id.trim())) throw new ValidationError("provenanceIds must contain IDs.");
    const sourceTurnIds = new Set();
    const sourceArtifactIds = new Set();
    const wanted = new Set(provenanceIds);
    for (const item of [...record.case_state.items, ...record.case_state.intervention_history]) {
      if (wanted.has(item.id) || wanted.has(item.source.ref) || wanted.has(item.source.turn_id)) {
        if (item.source.turn_id) sourceTurnIds.add(item.source.turn_id);
        if (record.source_artifacts.some((artifact) => artifact.id === item.source.ref)) sourceArtifactIds.add(item.source.ref);
      }
    }
    for (const id of wanted) {
      sourceTurnIds.add(id);
      if (record.source_artifacts.some((artifact) => artifact.id === id)) sourceArtifactIds.add(id);
    }
    const terms = query ? query.toLocaleLowerCase().split(/\s+/u).filter((term) => term.length > 1) : [];
    const querySourceTurnIds = new Set();
    const querySourceArtifactIds = new Set();
    if (terms.length) {
      for (const item of [...record.case_state.items, ...record.case_state.intervention_history]) {
        const searchable = `${item.id} ${item.domain} ${item.statement}`.replaceAll("_", " ").toLocaleLowerCase();
        if (terms.every((term) => searchable.includes(term))) {
          if (item.source.turn_id) querySourceTurnIds.add(item.source.turn_id);
          if (record.source_artifacts.some((artifact) => artifact.id === item.source.ref)) querySourceArtifactIds.add(item.source.ref);
        }
      }
    }
    const from = timeRange?.from ? Date.parse(timeRange.from) : null;
    const to = timeRange?.to ? Date.parse(timeRange.to) : null;
    if ((timeRange?.from && Number.isNaN(from)) || (timeRange?.to && Number.isNaN(to)) || (from != null && to != null && from > to)) throw new ValidationError("Evidence timeRange is invalid.");
    const transcript = effectiveTranscript(record);
    const matches = transcript.filter((turn) => {
      const at = Date.parse(turn.at);
      if (from != null && at < from) return false;
      if (to != null && at > to) return false;
      const provenanceMatch = wanted.size > 0 && (sourceTurnIds.has(turn.id) || wanted.has(turn.exchange_id));
      const queryMatch = terms.length > 0 && (querySourceTurnIds.has(turn.id) || terms.every((term) => turn.text.toLocaleLowerCase().includes(term)));
      const timeOnly = wanted.size === 0 && terms.length === 0 && timeRange;
      return provenanceMatch || queryMatch || Boolean(timeOnly);
    });
    const turns = matches.slice(-limit);
    const artifactMatches = record.source_artifacts.filter((artifact) => {
      if (sourceArtifactIds.has(artifact.id) || querySourceArtifactIds.has(artifact.id)) return true;
      if (!terms.length) return false;
      const searchable = `${artifact.id} ${artifact.exact_text}`.replaceAll("_", " ").toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    });
    const sourceArtifacts = artifactMatches.slice(-limit);
    return Object.freeze({
      query,
      provenance_ids: [...wanted],
      time_range: timeRange ? structuredClone(timeRange) : null,
      turns: structuredClone(turns),
      transcript_amendments: structuredClone(record.transcript_amendments.filter((amendment) => turns.some((turn) => turn.id === amendment.target_turn_id))),
      source_artifacts: structuredClone(sourceArtifacts),
      truncated: matches.length > turns.length || artifactMatches.length > sourceArtifacts.length
    });
  };

  // The supervisor path owns this metadata key: it carries the basis a draft was written against, and a caller that could set it
  // on an ordinary candidate could make a stale draft look current.
  const rejectReservedCandidateMetadata = (metadata) => {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && Object.hasOwn(metadata, "response_evidence")) {
      throw new ValidationError("Response evidence metadata reserved.", { code: "RESPONSE_EVIDENCE_INVALID" });
    }
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && Object.hasOwn(metadata, "supervisor_draft")) {
      throw new ValidationError("Candidate metadata supervisor_draft is reserved for the controlled supervisor path.");
    }
  };
  const appendOriginalCandidate = (record, candidateId, exactText, metadata, { supersedeFailed = false } = {}) => {
    if (typeof candidateId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(candidateId)) throw new ValidationError("candidateId is invalid.");
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate response metadata must be an object.");
    if (record.candidate_responses.some((candidate) => candidate.id === candidateId)) throw new ValidationError(`Candidate response ${candidateId} already exists and exact bytes are immutable.`);
    if ((metadata.status ?? "pending_audit") !== "pending_audit") throw new ValidationError("A new original candidate must begin pending_audit.");
    const activeCandidate = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
    // A new submission from the supervisor is new bytes from a person, the way a new inbound turn is for the runtime: it may
    // replace a candidate that failed its audit. The runtime's own repair of a failed candidate still goes through reconstruction.
    if (activeCandidate?.status === "audit_failed" && !supersedeFailed) throw new ValidationError("An audit-failed candidate must be repaired through reconstruction so its lineage and repair cycle cannot be bypassed.");
    if (typeof metadata.producer_context_id !== "string" || !metadata.producer_context_id.trim()) throw new ValidationError("A new candidate producer_context_id is required.");
    const timestamp = now();
    const candidate = {
      id: candidateId,
      version: record.candidate_responses.length + 1,
      exact_text: exactText,
      status: "pending_audit",
      created_at: timestamp,
      updated_at: timestamp,
      parent_candidate_id: null,
      root_candidate_id: candidateId,
      repair_cycle: 0,
      producer_context_id: metadata.producer_context_id ?? null,
      audit_history: [],
      metadata: Object.fromEntries(Object.entries(structuredClone(metadata)).filter(([key]) => !["status", "producer_context_id"].includes(key)))
    };
    validateCandidateResponse(candidate, record.candidate_responses.length);
    for (const previousCandidate of record.candidate_responses.filter(isActivePrivateCandidate)) {
      previousCandidate.metadata = { ...previousCandidate.metadata, superseded_from_status: previousCandidate.status, superseded_by_candidate_id: candidateId };
      previousCandidate.status = "superseded";
      previousCandidate.updated_at = timestamp;
    }
    record.candidate_responses.push(candidate);
    return candidate;
  };
  const appendReconstruction = (record, parentCandidateId, candidateId, exactText, metadata, responseEvidenceBinding = null) => {
    if (typeof candidateId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(candidateId)) throw new ValidationError("candidateId is invalid.");
    if (record.candidate_responses.some((candidate) => candidate.id === candidateId)) throw new ValidationError(`Candidate response ${candidateId} already exists and exact bytes are immutable.`);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate reconstruction metadata must be an object.");
    const parent = record.candidate_responses.find((entry) => entry.id === parentCandidateId);
    const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
    if (!parent || current?.id !== parentCandidateId) throw new ValidationError("Reconstruction must name the exact current candidate as its parent.");
    if (parent.metadata.response_evidence && !responseEvidenceBinding) throw new ValidationError("Response evidence repair binding required.", { code: "RESPONSE_EVIDENCE_REQUIRED" });
    if (parent.status !== "audit_failed") throw new ValidationError("A substantive reconstruction requires unresolved substantive/high audit findings on its parent.");
    if (parent.repair_cycle >= MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) {
      throw new ValidationError("Maximum two repair cycles reached; use the smallest discriminating question, explicit uncertainty, or block delivery.", { code: "PRIVATE_CANDIDATE_REPAIR_LIMIT" });
    }
    if (exactText === parent.exact_text) throw new ValidationError("A substantive reconstruction must create different immutable candidate bytes.");
    if (typeof metadata.producer_context_id !== "string" || !metadata.producer_context_id.trim()) throw new ValidationError("A reconstruction producer_context_id is required.");
    const sourceAudit = [...parent.audit_history].reverse().find((audit) => audit.verdict === "fail");
    if (!sourceAudit) throw new ValidationError("A reconstruction requires version-bound failed audit evidence.");
    if (metadata.based_on_audit_id != null && metadata.based_on_audit_id !== sourceAudit.id) throw new ValidationError("Reconstruction based_on_audit_id must identify the current parent audit.");
    const forbiddenProducerContexts = new Set([parent.producer_context_id, ...parent.audit_history.map((audit) => audit.auditor_context_id)]);
    if (forbiddenProducerContexts.has(metadata.producer_context_id)) throw new ValidationError("A reconstruction must use a separate producer context from the parent producer and auditor.");
    const timestamp = now();
    const candidate = {
      id: candidateId,
      version: record.candidate_responses.length + 1,
      exact_text: exactText,
      status: "reconstructed_pending_audit",
      created_at: timestamp,
      updated_at: timestamp,
      parent_candidate_id: parent.id,
      root_candidate_id: parent.root_candidate_id,
      repair_cycle: parent.repair_cycle + 1,
      producer_context_id: metadata.producer_context_id,
      audit_history: [],
      metadata: {
        ...Object.fromEntries(Object.entries(structuredClone(metadata)).filter(([key]) => !["producer_context_id", "based_on_audit_id"].includes(key))),
        ...(responseEvidenceBinding ? { response_evidence: structuredClone(responseEvidenceBinding) } : {}),
        based_on_audit_id: sourceAudit.id,
        substantive_reconstruction: true
      }
    };
    validateCandidateResponse(candidate, record.candidate_responses.length);
    parent.metadata = { ...parent.metadata, superseded_from_status: parent.status, superseded_by_candidate_id: candidateId };
    parent.status = "superseded";
    parent.updated_at = timestamp;
    record.candidate_responses.push(candidate);
    return candidate;
  };
  const validateAuditInRecord = (record, candidate, evidence) => {
    const audit = structuredClone(validateCandidateAuditEvidence(evidence, candidate));
    // A valid FAIL may always be retained. A review attached to one must still be well formed against its trusted sources.
    if (audit.response_evidence != null) {
      const binding = candidate.metadata.response_evidence;
      const snapshot = record.response_evidence_snapshots.find((entry) => entry.id === binding?.snapshot_id);
      if (!binding || !snapshot || binding.snapshot_sha256 !== snapshot.snapshot_sha256 || snapshot.case_id !== record.case_id) {
        throw new ValidationError("Response evidence audit binding invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
      }
      validateResponseEvidenceSnapshot(snapshot);
      validateResponseEvidenceAudit(audit, candidate, snapshot);
    }
    return audit;
  };
  const applyCandidateAudit = (record, candidateId, evidence, point = "recordCandidateAudit") => {
    const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
    if (!candidate) throw new ValidationError(`Candidate response ${candidateId} was not found.`, { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
    const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
    if (current?.id !== candidateId || !["pending_audit", "reconstructed_pending_audit"].includes(candidate.status)) {
      throw new ValidationError("Only the exact current pending candidate version can receive new audit evidence.");
    }
    const audit = validateAuditInRecord(record, candidate, evidence);
    if (record.candidate_responses.some((entry) => entry.audit_history.some((prior) => prior.id === audit.id))) throw new ValidationError(`Candidate audit ${audit.id} already exists.`);
    candidate.audit_history.push(audit);
    requireResponseEvidence(record, candidate, point);
    if (audit.verdict === "fail") candidate.status = "audit_failed";
    else if (audit.sufficient_for_approval) candidate.status = "audited";
    candidate.updated_at = now();
    validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
    return { candidate, audit };
  };

  return Object.freeze({
    format: ENVELOPE_FORMAT,
    rootDir,
    responseEvidencePolicy,
    async load(caseId) { const value = await readExisting(safeCaseId(caseId)); return value ? structuredClone(value) : null; },
    loadOrCreate,
    async freezeResponseEvidence(caseId, input = {}) {
      let frozen;
      await mutate(caseId, (record) => {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Response evidence input invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        validateEvidenceShape(input.snapshotId, responseEvidenceSnapshotSchema.properties.id);
        validateEvidenceShape(input.owner, responseEvidenceSnapshotSchema.properties.owner);
        validateEvidenceShape(input.inbound, responseEvidenceSnapshotSchema.properties.inbound);
        const owner = input.owner;
        const existing = record.response_evidence_snapshots.find((entry) => entry.id === input.snapshotId);
        const owned = record.response_evidence_snapshots.filter((entry) => sha256Json(entry.owner) === sha256Json(owner));
        const runtime = owner?.kind === "runtime_turn" ? record.runtime_turns.find((entry) => entry.id === owner.runtime_turn_id) : null;
        if (owner?.kind === "runtime_turn" && !runtime) throw new ValidationError("Response evidence owner invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        const root = runtime?.current_candidate_id
          ? record.candidate_responses.find((entry) => entry.id === runtime.current_candidate_id)?.root_candidate_id
          : owner.kind === "supervisor_draft" ? supervisorCandidateId(owner.operation_key, 1) : null;
        const priorJournalItems = owned.filter((entry) => entry.id !== input.snapshotId).flatMap((entry) => entry.source_items.filter((item) => item.kind === "journal_quotation"));
        if (existing) {
          const journal = normalizeResponseEvidenceJournal(input.journal, priorJournalItems);
          // Omitted bytes have no persisted identity in SnapshotV1. An ambiguous replay must not certify changed input.
          if ((input.journal?.source_items?.length ?? 0) !== journal.source_items.length) {
            throw new ValidationError("Response evidence replay unverifiable.", { code: "RESPONSE_EVIDENCE_INVALID", details: { reasons: ["omitted_input_replay_unverifiable"] } });
          }
          const identity = (entry) => [entry.owner, entry.revision, entry.parent_snapshot_id, entry.revision_reason, entry.candidate_origin, entry.inbound, entry.history_requirements, entry.journal, entry.source_items.filter((item) => item.kind === "journal_quotation")];
          const requested = { owner, revision: input.revision ?? 1, parent_snapshot_id: input.parentSnapshotId ?? null, revision_reason: input.revisionReason ?? "initial", candidate_origin: input.candidateOrigin ?? "backend_produced", inbound: input.inbound, history_requirements: input.historyRequirements ?? [], journal: journal.journal, source_items: journal.source_items };
          if (sha256Json(identity(existing)) !== sha256Json(identity(requested))) throw new ValidationError("Response evidence replay conflict.", { code: "RESPONSE_EVIDENCE_INVALID", details: { reasons: ["snapshot_replay_conflict"] } });
          frozen = existing;
          return null;
        }
        const inboundText = runtime && runtime.user_turn_id === input.inbound?.turn_id ? runtime.inbound.exact_text
          : effectiveTranscript(record).find((entry) => entry.id === input.inbound?.turn_id && entry.role === "user")?.text;
        if (inboundText == null || sha256Text(inboundText) !== input.inbound?.exact_text_sha256 || (runtime && input.candidateOrigin === "external_draft")) {
          throw new ValidationError("Response evidence inbound binding invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        }
        const revision = input.revision ?? 1;
        const parent = owned.at(-1);
        const unusedReceived = runtime?.state === "RECEIVED" && input.revisionReason === "dependency_refresh"
          && !runtime.events.some(entry => entry.stage === "candidate" && entry.event_type === "INVOCATION_COMPLETED")
          && !record.candidate_responses.some(entry => owned.some(snapshot => entry.metadata.response_evidence?.snapshot_id === snapshot.id));
        if (revision !== owned.length + 1 || revision > 3 || (revision > 1 && input.parentSnapshotId !== parent?.id)
            || (input.revisionReason === "evidence_expansion" && owned.some((entry) => entry.revision_reason === "evidence_expansion"))
            || (["AUDITING", "DISCRIMINATING_QUESTION_REQUIRED"].includes(runtime?.state) && revision > 1 && input.revisionReason !== "dependency_refresh")
            || (runtime && !unusedReceived && !(revision === 1 ? ["RECEIVED", "RECONSTRUCTING", "DISCRIMINATING_QUESTION_REQUIRED"] : ["AUDITING", "RECONSTRUCTING", "DISCRIMINATING_QUESTION_REQUIRED"]).includes(runtime.state))) {
          throw new ValidationError("Response evidence revision invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        }
        frozen = buildResponseEvidenceSnapshot(record, { ...input, lineageRootId: root }, { createdAt: now(), priorJournalItems });
        record.response_evidence_snapshots.push(frozen);
        return record;
      });
      return structuredClone(frozen);
    },
    async startSupervisorInvocation(caseId, { operationKey, stage, candidateId, snapshotId, attemptContextId }) {
      let started;
      await mutate(caseId, record => {
        const snapshot = record.response_evidence_snapshots.find(entry => entry.id === snapshotId);
        if (!snapshot || snapshot.owner.kind !== "supervisor_draft" || snapshot.owner.operation_key !== operationKey) throw new ValidationError("Supervisor invocation snapshot invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        const candidate = supervisorCallCandidate(record, { operationKey, stage, candidateId, snapshot });
        const head = record.candidate_responses.filter(entry => entry.metadata.supervisor_draft?.operation_key === operationKey).at(-1);
        if (stage === "candidate" ? Boolean(head) : head?.id !== candidate.id || !(stage === "repair" ? ["audit_failed"] : ["pending_audit", "reconstructed_pending_audit"]).includes(candidate.status)) {
          throw new ValidationError("Supervisor invocation stage invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        }
        const rootCandidate = record.candidate_responses.find(entry => entry.id === candidate.root_candidate_id);
        if (!responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate })) throw new ValidationError("Supervisor invocation input changed.", { code: "RESPONSE_EVIDENCE_STALE" });
        const { view_sha256: viewSha256 } = buildEvidenceModelView(record, snapshot);
        const input = supervisorInvocationInput({ operationKey, stage, candidate, snapshot, viewSha256 });
        const existing = record.supervisor_invocations.find(entry => entry.event_type === "STARTED" && entry.attempt_context_id === attemptContextId);
        if (existing) {
          if (!sameJson(supervisorInvocationIdentity(existing.input), input)) throw new ValidationError("Supervisor invocation replay conflict.", { code: "RESPONSE_EVIDENCE_INVALID" });
          started = existing; return null;
        }
        started = { schema_version: 1, id: `supervisor-call:${sha256Json([input, attemptContextId]).slice(0, 40)}:started`, event_type: "STARTED",
          input, attempt_context_id: attemptContextId, created_at: now(), actual_context_id: null, provider_receipt: null, output: null };
        record.supervisor_invocations.push(started); return record;
      });
      return structuredClone(started);
    },
    async completeSupervisorInvocation(caseId, { startedId, output }) {
      let completed;
      await mutate(caseId, record => {
        const started = record.supervisor_invocations.find(entry => entry.id === startedId && entry.event_type === "STARTED");
        if (!started) throw new ValidationError("Supervisor invocation was not started.", { code: "RESPONSE_EVIDENCE_INVALID" });
        const snapshot = record.response_evidence_snapshots.find(entry => entry.id === started.input.snapshot_id);
        const candidate = started.input.stage === "candidate" ? { id: started.input.candidate_id, version: started.input.candidate_version }
          : record.candidate_responses.find(entry => entry.id === started.input.candidate_id);
        const normalized = normalizeSupervisorInvocationOutput(started, output, candidate, snapshot);
        const existing = record.supervisor_invocations.find(entry => entry.event_type === "COMPLETED" && entry.attempt_context_id === started.attempt_context_id);
        if (existing) {
          if (!sameJson(existing.output, normalized)) throw new ValidationError("Supervisor completion is immutable.", { code: "RESPONSE_EVIDENCE_INVALID" });
          completed = existing; return null;
        }
        completed = { ...started, id: started.id.replace(/:started$/u, ":completed"), event_type: "COMPLETED", created_at: now(),
          actual_context_id: normalized.contextId, provider_receipt: normalized.providerReceipt, output: normalized };
        record.supervisor_invocations.push(completed); return record;
      });
      return structuredClone(completed);
    },
    async beginPrivateRuntimeTurn(caseId, { runtimeTurnId, exchangeId, userTurnId, exactText, runnerConfig }) {
      return mutate(caseId, (record) => {
        const existing = record.runtime_turns.find((entry) => entry.id === runtimeTurnId);
        if (existing) {
          if (!sameJson([existing.exchange_id, existing.user_turn_id, existing.inbound.exact_text], [exchangeId, userTurnId, exactText])) {
            throw new ValidationError(`Private runtime turn ${runtimeTurnId} conflicts with an existing immutable inbound record.`);
          }
          return null;
        }
        const unfinished = record.runtime_turns.find((entry) => !isFinishedRuntimeTurn(entry));
        if (unfinished) throw new ValidationError(`Private case already has unfinished runtime turn ${unfinished.id}.`, { code: "PRIVATE_RUNTIME_CASE_BUSY" });
        if (record.runtime_turns.some((entry) => entry.exchange_id === exchangeId || entry.user_turn_id === userTurnId)
            || record.raw_transcript.some((entry) => entry.id === userTurnId)) {
          throw new ValidationError("Private runtime inbound identifiers must be unique.");
        }
        record.runtime_turns.push(createPrivateRuntimeTurn({
          id: runtimeTurnId,
          exchangeId,
          userTurnId,
          exactText,
          runnerConfig,
          createdAt: now()
        }));
        return record;
      });
    },
    async getPrivateRuntimeTurn(caseId, runtimeTurnId) {
      return structuredClone(runtimeTurnIn(await readRequired(caseId), runtimeTurnId));
    },
    async recordPrivateRuntimeInvocationEvent(caseId, runtimeTurnId, event) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const existing = runtimeTurn.events.find((entry) => entry.id === event.eventId);
        if (existing) {
          const expectedFields = {
            event_type: event.eventType,
            stage: event.stage,
            context_id: event.contextId,
            attempt: event.attempt,
            input_sha256: event.inputSha256,
            details: event.details ?? {}
          };
          if (!sameJson(
            Object.fromEntries(Object.keys(expectedFields).map((key) => [key, existing[key]])),
            expectedFields
          )) throw new ValidationError(`Private runtime event ${event.eventId} conflicts with immutable evidence.`);
          return null;
        }
        const updated = appendPrivateRuntimeInvocationEvent(runtimeTurn, { ...event, at: event.at ?? now() });
        Object.assign(runtimeTurn, updated);
        return record;
      });
    },
    async transitionPrivateRuntimeTurn(caseId, runtimeTurnId, transition) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const existing = runtimeTurn.events.find((entry) => entry.id === transition.eventId);
        if (existing) {
          if (existing.event_type !== "STATE_TRANSITION" || existing.to_state !== transition.toState) {
            throw new ValidationError(`Private runtime transition ${transition.eventId} conflicts with immutable evidence.`);
          }
          return null;
        }
        const updated = appendPrivateRuntimeTransition(runtimeTurn, { ...transition, at: transition.at ?? now() });
        Object.assign(runtimeTurn, updated);
        return record;
      });
    },
    async commitPrivateRuntimeCandidate(caseId, {
      runtimeTurnId,
      candidateId,
      exactText,
      producerContextId,
      parentCandidateId = null,
      basedOnAuditId = null,
      caseState = null,
      stateDiff = null,
      diffId = null,
      metadata = {},
      responseEvidence = null,
      eventId
    }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const existing = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (existing) {
          if (!sameJson(
            [existing.exact_text, existing.producer_context_id, existing.parent_candidate_id, existing.metadata.runtime_turn_id],
            [exactText, producerContextId, parentCandidateId, runtimeTurnId]
          )) throw new ValidationError(`Candidate response ${candidateId} conflicts with immutable bytes or provenance.`);
          const bound = existing.metadata.response_evidence;
          if ((bound != null) !== (responseEvidence != null) || (bound && (bound.snapshot_id !== responseEvidence.snapshotId || bound.writer_inclusion_sha256 !== responseEvidence.writerInclusionSha256))) {
            throw new ValidationError("Response evidence replay conflict.", { code: "RESPONSE_EVIDENCE_INVALID" });
          }
          if (runtimeTurn.current_candidate_id === candidateId && runtimeTurn.state === "CANDIDATE_PENDING_AUDIT") return null;
          throw new ValidationError(`Candidate response ${candidateId} exists outside the expected runtime frontier.`);
        }
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate runtime metadata must be an object.");
        rejectReservedCandidateMetadata(metadata);
        let evidenceBinding = null;
        if (responseEvidence != null) {
          const snapshot = record.response_evidence_snapshots.find((entry) => entry.id === responseEvidence.snapshotId);
          const stage = parentCandidateId == null ? "candidate" : "repair";
          const sealed = [...runtimeTurn.events].reverse().find((entry) => entry.event_type === "INVOCATION_COMPLETED" && entry.stage === stage && entry.details?.actual_context_id === producerContextId);
          const inclusion = sealed?.details?.output?.responseEvidenceInclusion;
          if (!snapshot || snapshot.case_id !== caseId || snapshot.owner.kind !== "runtime_turn" || snapshot.owner.runtime_turn_id !== runtimeTurnId
              || snapshot.candidate_origin !== "backend_produced" || snapshot.inbound.turn_id !== runtimeTurn.user_turn_id || snapshot.inbound.exact_text_sha256 !== runtimeTurn.inbound.sha256
              || !inclusion || inclusion.snapshot_id !== snapshot.id || inclusion.snapshot_sha256 !== snapshot.snapshot_sha256 || inclusion.view_sha256 !== responseEvidence.writerInclusionSha256
              || sealed.details.output.exactText !== exactText) {
            throw new ValidationError("Response evidence writer binding invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
          }
          validateResponseEvidenceSnapshot(snapshot);
          verifyRuntimeWriterInvocation(record, runtimeTurn, { parentCandidateId, contextId: producerContextId, exactText, snapshot, viewSha256: responseEvidence.writerInclusionSha256 });
          const parent = record.candidate_responses.find((entry) => entry.id === parentCandidateId);
          const root = parent ? record.candidate_responses.find((entry) => entry.id === parent.root_candidate_id) : null;
          const current = responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate: root });
          evidenceBinding = {
            schema_version: 1, policy_version: RESPONSE_EVIDENCE_POLICY_VERSION, snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256,
            candidate_origin: snapshot.candidate_origin, writer_inclusion: "verified", writer_inclusion_sha256: responseEvidence.writerInclusionSha256,
            established_context_after_commit_sha256: root ? (root.metadata.response_evidence?.snapshot_id === snapshot.id ? root.metadata.response_evidence.established_context_after_commit_sha256 : snapshot.dependency_binding.established_context_digest) : null,
            compatibility_state_after_commit_binding: root ? (root.metadata.response_evidence?.snapshot_id === snapshot.id
              ? root.metadata.response_evidence.compatibility_state_after_commit_binding ?? snapshot.dependency_binding.compatibility_state_binding : snapshot.dependency_binding.compatibility_state_binding) : null,
            dependency_status: current ? "current_at_commit" : "stale_at_commit"
          };
        } else if (responseEvidencePolicy === "enforced" || record.response_evidence_snapshots.some((entry) => entry.owner.kind === "runtime_turn" && entry.owner.runtime_turn_id === runtimeTurnId) || (parentCandidateId != null && record.candidate_responses.find((entry) => entry.id === parentCandidateId)?.metadata.response_evidence)) {
          throw new ValidationError("Response evidence repair binding required.", { code: "RESPONSE_EVIDENCE_REQUIRED" });
        }
        const timestamp = now();
        let candidate;
        if (parentCandidateId == null) {
          if (runtimeTurn.state !== "RECEIVED" || runtimeTurn.repair_cycle !== 0) throw new ValidationError("Original runtime candidate requires RECEIVED state.");
          if (typeof producerContextId !== "string" || !producerContextId.trim()) throw new ValidationError("A runtime candidate producer context is required.");
          const state = validateCaseState(keepStoredRoadmap(caseState, record.case_state));
          if (state.case_id !== caseId) throw new ValidationError("Case state identity mismatch.");
          if (record.raw_transcript.some((entry) => entry.id === runtimeTurn.user_turn_id)) throw new ValidationError("Runtime inbound transcript turn already exists outside its candidate commit.");
          record.raw_transcript.push({
            id: runtimeTurn.user_turn_id,
            exchange_id: runtimeTurn.exchange_id,
            role: "user",
            text: runtimeTurn.inbound.exact_text,
            at: runtimeTurn.inbound.received_at,
            episode_id: state.current_episode?.id ?? null
          });
          record.case_state = state;
          if (stateDiff != null) appendDiff(record, stateDiff, { turnId: runtimeTurn.user_turn_id, diffId });
          for (const previousCandidate of record.candidate_responses.filter(isActivePrivateCandidate)) {
            previousCandidate.metadata = { ...previousCandidate.metadata, superseded_from_status: previousCandidate.status, superseded_by_candidate_id: candidateId };
            previousCandidate.status = "superseded";
            previousCandidate.updated_at = timestamp;
          }
          candidate = {
            id: candidateId,
            version: record.candidate_responses.length + 1,
            exact_text: exactText,
            status: "pending_audit",
            created_at: timestamp,
            updated_at: timestamp,
            parent_candidate_id: null,
            root_candidate_id: candidateId,
            repair_cycle: 0,
            producer_context_id: producerContextId,
            audit_history: [],
            metadata: { ...structuredClone(metadata), runtime_turn_id: runtimeTurnId }
          };
        } else {
          if (runtimeTurn.state !== "RECONSTRUCTING") throw new ValidationError("Runtime repair candidate requires RECONSTRUCTING state.");
          const parent = record.candidate_responses.find((entry) => entry.id === parentCandidateId);
          const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
          if (!parent || current?.id !== parent.id || parent.status !== "audit_failed" || runtimeTurn.current_candidate_id !== parent.id) {
            throw new ValidationError("Runtime reconstruction must name the exact current failed candidate.");
          }
          if (parent.repair_cycle >= MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) throw new ValidationError("Maximum two repair cycles reached.", { code: "PRIVATE_CANDIDATE_REPAIR_LIMIT" });
          if (exactText === parent.exact_text) throw new ValidationError("Runtime reconstruction must create different exact bytes.");
          const sourceAudit = parent.audit_history.at(-1);
          if (!sourceAudit || sourceAudit.verdict !== "fail" || sourceAudit.id !== basedOnAuditId) throw new ValidationError("Runtime reconstruction requires the exact current failed audit.");
          const forbiddenContexts = new Set([parent.producer_context_id, ...parent.audit_history.map((entry) => entry.auditor_context_id)]);
          if (typeof producerContextId !== "string" || !producerContextId.trim() || forbiddenContexts.has(producerContextId)) {
            throw new ValidationError("Runtime repair must use a separate producer context.");
          }
          candidate = {
            id: candidateId,
            version: record.candidate_responses.length + 1,
            exact_text: exactText,
            status: "reconstructed_pending_audit",
            created_at: timestamp,
            updated_at: timestamp,
            parent_candidate_id: parent.id,
            root_candidate_id: parent.root_candidate_id,
            repair_cycle: parent.repair_cycle + 1,
            producer_context_id: producerContextId,
            audit_history: [],
            metadata: { ...structuredClone(metadata), runtime_turn_id: runtimeTurnId, based_on_audit_id: sourceAudit.id, substantive_reconstruction: true }
          };
          parent.metadata = { ...parent.metadata, superseded_from_status: parent.status, superseded_by_candidate_id: candidateId };
          parent.status = "superseded";
          parent.updated_at = timestamp;
        }
        if (evidenceBinding) {
          if (parentCandidateId == null && evidenceBinding.dependency_status === "current_at_commit") {
            evidenceBinding.established_context_after_commit_sha256 = sha256Json(record.case_state);
            evidenceBinding.compatibility_state_after_commit_binding = compatibilityStateBinding(record.case_state.protective_compatibility ?? null);
          }
          candidate.metadata.response_evidence = evidenceBinding;
        }
        validateCandidateResponse(candidate, record.candidate_responses.length);
        record.candidate_responses.push(candidate);
        const updatedRuntime = appendPrivateRuntimeTransition(runtimeTurn, {
          eventId,
          toState: "CANDIDATE_PENDING_AUDIT",
          at: timestamp,
          candidateId: candidate.id,
          repairCycle: candidate.repair_cycle,
          details: { candidate_id: candidate.id, candidate_version: candidate.version, candidate_sha256: sha256ExactText(candidate.exact_text) }
        });
        Object.assign(runtimeTurn, updatedRuntime);
        return record;
      }, { afterWrite: candidateLocator(caseId, candidateId) });
    },
    async commitPrivateRuntimeAudit(caseId, runtimeTurnId, evidence, { eventId }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.state !== "AUDITING") throw new ValidationError("Runtime audit result requires AUDITING state.");
        const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (!candidate || current?.id !== candidate.id || !["pending_audit", "reconstructed_pending_audit"].includes(candidate.status)) {
          throw new ValidationError("Runtime audit must target the exact current pending candidate.");
        }
        const audit = validateAuditInRecord(record, candidate, evidence);
        const sealedAttempt = [...runtimeTurn.events].reverse().find((entry) => entry.event_type === "INVOCATION_COMPLETED"
          && entry.stage === "audit" && entry.details?.actual_context_id === audit.auditor_context_id);
        if (!sealedAttempt) throw new ValidationError("Runtime audit context is not backed by a sealed controller invocation.");
        if (candidate.audit_history.some((entry) => entry.id === audit.id)) throw new ValidationError(`Candidate audit ${audit.id} already exists.`);
        candidate.audit_history.push(audit);
        const admission = assessResponseEvidenceAdmission(record, candidate, { policy: responseEvidencePolicy, point: "commitPrivateRuntimeAudit" });
        if (admission.admissible && audit.verdict === "pass" && candidate.metadata.response_evidence) {
          const snapshot = record.response_evidence_snapshots.find((entry) => entry.id === candidate.metadata.response_evidence.snapshot_id);
          if (!responseEvidenceDependenciesCurrent(record, candidate, snapshot)) Object.assign(admission, { admissible: false, code: "RESPONSE_EVIDENCE_STALE" });
        }
        if (!admission.admissible) {
          if (audit.verdict === "pass" && ["RESPONSE_EVIDENCE_STALE", "RESPONSE_EVIDENCE_REQUIRED"].includes(admission.code)) {
            let staleId = "evidence:dependencies";
            let suffix = 0;
            while (audit.findings.some((entry) => entry.id === staleId)) staleId = `evidence:dependencies:${++suffix}`;
            audit.findings.push({ id: staleId, code: admission.code, severity: "substantive", summary: admission.code === "RESPONSE_EVIDENCE_STALE" ? "Response evidence dependencies changed." : "Response evidence required.", unresolved: true, derived_in_code: true });
            audit.unresolved_substantive_finding_ids = audit.findings.filter((entry) => entry.unresolved !== false && ["substantive", "high"].includes(entry.severity)).map((entry) => entry.id);
            audit.verdict = "fail";
            audit.sufficient_for_approval = false;
            validateCandidateAuditEvidence(audit, candidate);
          } else requireResponseEvidence(record, candidate, "commitPrivateRuntimeAudit");
        }
        return finishRuntimeAudit(record, runtimeTurn, candidate, audit, eventId);
      });
    },
    // Trusted recovery: the store independently proves staleness and can write only a blocking code result.
    async commitPrivateRuntimeEvidenceStale(caseId, runtimeTurnId, { eventId }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const candidate = record.candidate_responses.find(entry => entry.id === runtimeTurn.current_candidate_id);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        const binding = candidate?.metadata.response_evidence;
        const snapshot = record.response_evidence_snapshots.find(entry => entry.id === binding?.snapshot_id);
        if (runtimeTurn.state !== "AUDITING" || !candidate || current?.id !== candidate.id
          || !["pending_audit", "reconstructed_pending_audit"].includes(candidate.status) || !binding || !snapshot
          || snapshot.owner.kind !== "runtime_turn" || snapshot.owner.runtime_turn_id !== runtimeTurn.id
          || snapshot.case_id !== record.case_id || snapshot.snapshot_sha256 !== binding.snapshot_sha256) {
          throw new ValidationError("Response evidence stale recovery invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        }
        validateResponseEvidenceSnapshot(snapshot);
        let currentEvidence = responseEvidenceDependenciesCurrent(record, candidate, snapshot);
        if (currentEvidence) { try { buildEvidenceModelView(record, snapshot); } catch { currentEvidence = false; } }
        if (currentEvidence) {
          throw new ValidationError("Response evidence is current.", { code: "RESPONSE_EVIDENCE_INVALID" });
        }
        const audit = structuredClone(createCandidateAuditEvidence({
          auditId: `audit:code-stale:${sha256Text(candidate.id).slice(0, 32)}`, candidate, auditVersion: "private-candidate-audit-v4",
          auditorContext: { kind: "self_critique", context_id: "code:response-evidence-stale" }, independentAuditorAvailable: false,
          completedAt: now(), repairInducedChecks: candidate.parent_candidate_id === null ? [] : REPAIR_INDUCED_ERROR_CHECKS,
          findings: [{ id: "evidence:dependencies", code: "RESPONSE_EVIDENCE_STALE", severity: "substantive",
            summary: "Response evidence dependencies changed.", derived_in_code: true }]
        }));
        audit.derived_in_code = true;
        candidate.audit_history.push(audit);
        return finishRuntimeAudit(record, runtimeTurn, candidate, audit, eventId);
      });
    },
    async savePrivateRuntimeDiscriminator(caseId, runtimeTurnId, { exactText, producerContextId, kind = null, review = null }) {
      if (Array.isArray(review?.findings)) review = { ...review, findings: review.findings.map(normalizeRecordOnlyFinding) };
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.state !== "DISCRIMINATING_QUESTION_REQUIRED") throw new ValidationError("Runtime discriminator requires its explicit terminal-uncertainty state.");
        const discriminator = createPrivateRuntimeDiscriminator({ exactText, producerContextId, createdAt: runtimeTurn.discriminator?.created_at ?? now(), kind });
        requireDiscriminatorReview(record, runtimeTurn, discriminator, review);
        if (runtimeTurn.discriminator) {
          if (!sameJson(runtimeTurn.discriminator, discriminator)) throw new ValidationError("Private runtime discriminator conflicts with immutable bytes.");
          if (review != null && runtimeTurn.discriminator_review == null) {
            runtimeTurn.discriminator_review = structuredClone(review);
            runtimeTurn.updated_at = now();
            return record;
          }
          if (review != null && !sameJson(runtimeTurn.discriminator_review, review)) throw new ValidationError("Discriminating question evidence review conflicts.", { code: "PRIVATE_DISCRIMINATOR_EVIDENCE_BLOCKED" });
          return null;
        }
        const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
        const forbiddenContexts = new Set([candidate?.producer_context_id, ...(candidate?.audit_history ?? []).map((entry) => entry.auditor_context_id)]);
        const sealedAttempt = [...runtimeTurn.events].reverse().find((entry) => entry.event_type === "INVOCATION_COMPLETED"
          && entry.stage === "discriminator" && entry.details?.actual_context_id === producerContextId);
        if (!sealedAttempt || forbiddenContexts.has(producerContextId)) throw new ValidationError("Runtime discriminator requires a separate sealed producer context.");
        runtimeTurn.discriminator = structuredClone(discriminator);
        if (review != null) runtimeTurn.discriminator_review = structuredClone(review);
        runtimeTurn.updated_at = now();
        return record;
      });
    },
    async deliverPrivateRuntimeCandidate(caseId, runtimeTurnId, { candidateId, assistantTurnId, eventId }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.state === "DELIVERED") {
          if (runtimeTurn.delivery?.kind === "candidate" && runtimeTurn.delivery.candidate_id === candidateId && runtimeTurn.assistant_turn_id === assistantTurnId) return null;
          throw new ValidationError("Private runtime delivery conflicts with an existing immutable delivery.");
        }
        if (runtimeTurn.state !== "APPROVED" || runtimeTurn.current_candidate_id !== candidateId) throw new ValidationError("Runtime candidate delivery requires exact APPROVED state.");
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        const gate = candidateDeliveryGate(candidate);
        if (!candidate || current?.id !== candidate.id || !gate.delivery_allowed) throw new ValidationError("Runtime candidate delivery is not exact-version approved.");
        requireResponseEvidence(record, candidate, "deliverPrivateRuntimeCandidate");
        const currentCompatibilityBinding = compatibilityStateBinding(record.case_state.protective_compatibility ?? null);
        if (record.case_state.protective_compatibility?.current
            && candidate.metadata.compatibility_state_binding !== currentCompatibilityBinding) {
          throw new ValidationError("Runtime candidate compatibility-state binding is stale; a new candidate and audit are required.", { code: "PROTECTIVE_COMPATIBILITY_BINDING_STALE" });
        }
        if (record.raw_transcript.some((entry) => entry.id === assistantTurnId)) throw new ValidationError("Runtime assistant turn identifier already exists.");
        // Bound to the exact inbound turn the way deliverCandidateResponse binds it, so both exits resolve to the same completion.
        const userTurn = record.raw_transcript.find((entry) => entry.id === runtimeTurn.user_turn_id);
        if (!userTurn || userTurn.role !== "user" || userTurn.exchange_id !== runtimeTurn.exchange_id || userTurn.text !== runtimeTurn.inbound.exact_text) {
          throw new ValidationError("Runtime candidate delivery requires its exact inbound user turn in the transcript.");
        }
        const timestamp = now();
        record.raw_transcript.push({
          id: assistantTurnId,
          exchange_id: userTurn.exchange_id,
          role: "assistant",
          text: candidate.exact_text,
          at: timestamp,
          episode_id: userTurn.episode_id ?? record.case_state.current_episode?.id ?? null
        });
        candidate.status = "sent";
        candidate.updated_at = timestamp;
        candidate.metadata = { ...candidate.metadata, sent_with_audit_id: gate.audit_id, sent_turn_id: assistantTurnId, sent_in_reply_to_turn_id: userTurn.id };
        const delivery = {
          kind: "candidate",
          assistant_turn_id: assistantTurnId,
          exact_text: candidate.exact_text,
          sha256: sha256ExactText(candidate.exact_text),
          candidate_id: candidate.id,
          candidate_version: candidate.version,
          audit_id: gate.audit_id,
          delivered_at: timestamp
        };
        const updatedRuntime = appendPrivateRuntimeTransition(runtimeTurn, {
          eventId,
          toState: "DELIVERED",
          at: timestamp,
          details: { kind: "candidate", candidate_id: candidate.id, candidate_version: candidate.version, audit_id: gate.audit_id },
          projectionPatch: { assistant_turn_id: assistantTurnId, delivery }
        });
        Object.assign(runtimeTurn, updatedRuntime);
        return record;
      });
    },
    async deliverPrivateRuntimeDiscriminator(caseId, runtimeTurnId, { assistantTurnId, eventId }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.state === "DELIVERED") {
          if (["discriminator", OWNER_FALLBACK_KIND].includes(runtimeTurn.delivery?.kind) && runtimeTurn.assistant_turn_id === assistantTurnId) return null;
          throw new ValidationError("Private runtime delivery conflicts with an existing immutable delivery.");
        }
        if (runtimeTurn.state !== "DISCRIMINATING_QUESTION_REQUIRED" || !runtimeTurn.discriminator) throw new ValidationError("Runtime discriminator delivery is not ready.");
        requireDiscriminatorReview(record, runtimeTurn, runtimeTurn.discriminator, runtimeTurn.discriminator_review);
        // The owner fallback is delivered through the same terminal state as a question but is recorded as its own kind.
        const deliveryKind = runtimeTurn.discriminator.kind === OWNER_FALLBACK_KIND ? OWNER_FALLBACK_KIND : "discriminator";
        if (record.raw_transcript.some((entry) => entry.id === assistantTurnId)) throw new ValidationError("Runtime assistant turn identifier already exists.");
        const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
        if (!candidate || candidate.status !== "audit_failed" || candidate.repair_cycle !== MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) throw new ValidationError("Runtime discriminator requires the exact final failed candidate.");
        const timestamp = now();
        record.raw_transcript.push({ id: assistantTurnId, exchange_id: runtimeTurn.exchange_id, role: "assistant", text: runtimeTurn.discriminator.exact_text, at: timestamp, episode_id: record.case_state.current_episode?.id ?? null });
        candidate.metadata = {
          ...candidate.metadata,
          superseded_from_status: candidate.status,
          ...(deliveryKind === OWNER_FALLBACK_KIND
            ? { superseded_by_owner_fallback_runtime_turn_id: runtimeTurn.id }
            : { superseded_by_discriminator_runtime_turn_id: runtimeTurn.id })
        };
        candidate.status = "superseded";
        candidate.updated_at = timestamp;
        const delivery = {
          kind: deliveryKind,
          assistant_turn_id: assistantTurnId,
          exact_text: runtimeTurn.discriminator.exact_text,
          sha256: runtimeTurn.discriminator.sha256,
          delivered_at: timestamp
        };
        const updatedRuntime = appendPrivateRuntimeTransition(runtimeTurn, {
          eventId,
          toState: "DELIVERED",
          at: timestamp,
          details: { kind: deliveryKind },
          projectionPatch: { assistant_turn_id: assistantTurnId, delivery }
        });
        Object.assign(runtimeTurn, updatedRuntime);
        return record;
      });
    },
    // The runner trial's readers' results for one turn, each reader's stored once, before anything that rests on it is shown.
    // A later call adds readers not yet stored and never changes one already there (a rerun reuses the first reading). The
    // conversation the turn belongs to is fixed by the first call.
    async recordRunnerReading(caseId, runtimeTurnId, { conversationId, readers = {} }) {
      let stored = null;
      await mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const existing = runtimeTurn.runner_reading ?? null;
        if (existing && existing.conversation_id !== conversationId) throw new ValidationError("A turn's conversation is fixed by its first reading.");
        const added = Object.entries(readers).filter(([name]) => !existing?.readers?.[name]);
        if (existing && added.length === 0) { stored = structuredClone(existing); return null; }
        if (isFinishedRuntimeTurn(runtimeTurn)) throw new ValidationError("A finished runtime turn takes no new reading.");
        runtimeTurn.runner_reading = {
          ...(existing ?? {}),
          schema_version: 1,
          conversation_id: conversationId,
          recorded_at: existing?.recorded_at ?? now(),
          readers: { ...(existing?.readers ?? {}), ...structuredClone(Object.fromEntries(added)) }
        };
        validatePrivateRuntimeTurn(runtimeTurn);
        stored = structuredClone(runtimeTurn.runner_reading);
        return record;
      });
      return stored;
    },
    // One audit attempt's crisis level, as the level reader (the crisis checker, or the whole checker) read it, appended as soon
    // as it answers, even when another checker gave no reading: the closing and later turns read every one of them.
    // With the kept plan on (src/runner-trial/kept-plan.mjs), the same entry also holds that checker's two kept-plan readings: whether
    // the conversation reached the plan for the next hours, and whether the person's yes is about keeping the plan.
    async recordRunnerCheckerLevel(caseId, runtimeTurnId, { candidateId, candidateVersion = null, checker, level, planReached = undefined, confirmsKeepPlanYes = undefined }) {
      let stored = null;
      await mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (!runtimeTurn.runner_reading) throw new ValidationError("A checker level belongs to a turn the runner trial read.");
        if (isFinishedRuntimeTurn(runtimeTurn)) throw new ValidationError("A finished runtime turn takes no new reading.");
        const levels = runtimeTurn.runner_reading.checker_levels ?? [];
        const keptPlanReadings = {
          ...(planReached === undefined ? {} : { plan_reached: planReached === true }),
          ...(confirmsKeepPlanYes === undefined ? {} : { confirms_keep_plan_yes: confirmsKeepPlanYes === true })
        };
        runtimeTurn.runner_reading = {
          ...runtimeTurn.runner_reading,
          checker_levels: [...levels, { attempt: levels.length + 1, candidate_id: candidateId, candidate_version: candidateVersion, checker, level, recorded_at: now(), ...keptPlanReadings }]
        };
        validatePrivateRuntimeTurn(runtimeTurn);
        stored = structuredClone(runtimeTurn.runner_reading.checker_levels);
        return record;
      });
      return stored;
    },
    // A provisional reply (the owner's 3, question i62), stored when it is shown; immutable once stored.
    async recordRunnerProvisional(caseId, runtimeTurnId, { exactText, checks = [] }) {
      let stored = null;
      await mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.provisional) {
          if (runtimeTurn.provisional.exact_text !== exactText) throw new ValidationError("A turn's provisional reply is immutable.");
          stored = structuredClone(runtimeTurn.provisional);
          return null;
        }
        if (isFinishedRuntimeTurn(runtimeTurn)) throw new ValidationError("A finished runtime turn takes no provisional reply.");
        runtimeTurn.provisional = { exact_text: exactText, sha256: sha256ExactText(exactText), checks: structuredClone(checks), shown_at: now() };
        validatePrivateRuntimeTurn(runtimeTurn);
        stored = structuredClone(runtimeTurn.provisional);
        return record;
      });
      return stored;
    },
    // When the page put the always-visible emergency line into the conversation for this turn (section 4 of the design). Once per
    // turn, and only while the turn is unfinished: the runner trial's timed line (no reply 30 s after the message) may come just
    // after the turn's reply or closing, which then wins. A case that has no file is left as it is (never created here).
    // Once per turn. It answers whether this call stored it, so a caller sends the page the line only once (Codex's review of
    // e17c949a2: a timer and a closing had each sent it).
    async recordRunnerEmergencyLine(caseId, runtimeTurnId, { reason }) {
      let inserted = false;
      await mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.emergency_line_shown_at) return null;
        if (isFinishedRuntimeTurn(runtimeTurn)) throw new ValidationError("A finished runtime turn takes no emergency line.");
        runtimeTurn.emergency_line_shown_at = now();
        runtimeTurn.emergency_line_reason = String(reason ?? "crisis").slice(0, 80);
        validatePrivateRuntimeTurn(runtimeTurn);
        inserted = true;
        return record;
      }, { requireExisting: true });
      return { inserted };
    },
    // The plan kept for next time (the runner trial's kept plan, design section 9; rules in src/runner-trial/kept-plan.mjs). Kept for
    // one turn, once: only when the case's stored readings and this turn's allow it (the crisis reader read that the person asks;
    // the crisis checker confirmed a yes to an offer made in the reply before; no reading anywhere in the case says they may be
    // under 18 or that home isn't safe), and only the lines found word for word in a reply InnerSignal delivered earlier in this
    // conversation, with the date. A plan kept before is deleted in its place. Never in the transcript; the record is append-only.
    async recordRunnerKeptPlan(caseId, runtimeTurnId, { lines = [] } = {}) {
      let stored = null;
      await mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const plans = record.runner_kept_plans ?? [];
        const existing = plans.find((plan) => plan.runtime_turn_id === runtimeTurnId);
        if (existing) { stored = structuredClone(existing); return null; }
        if (isFinishedRuntimeTurn(runtimeTurn)) throw keptPlanRefusal("finished_turn");
        const basis = keepPlanBasis(record, runtimeTurn);
        if (!basis.allowed) throw keptPlanRefusal(basis.reason);
        if (basis.needsConfirmation && !keepPlanYesConfirmed(runtimeTurn)) throw keptPlanRefusal("not_confirmed");
        const found = keptPlanLinesFound(lines, earlierRepliesInConversation(record, runtimeTurn));
        if (found.length === 0) throw keptPlanRefusal("no_line_found");
        const timestamp = now();
        for (const plan of plans) if (plan.deleted_at == null) markKeptPlanDeleted(plan, "replaced", timestamp);
        const plan = {
          schema_version: 1,
          id: `kept-plan:${sha256Hex(runtimeTurnId).slice(0, 24)}`,
          conversation_id: runtimeTurn.runner_reading.conversation_id,
          runtime_turn_id: runtimeTurnId,
          kept_at: timestamp,
          lines: found,
          deleted_at: null,
          deletion_reason: null
        };
        record.runner_kept_plans = [...plans, plan];
        runtimeTurn.kept_plan_kept_at = timestamp;
        validatePrivateRuntimeTurn(runtimeTurn);
        stored = structuredClone(plan);
        return record;
      });
      return stored;
    },
    // Deletes the case's kept plan (its lines removed, the date and the reason kept): `expired` deletes only plans 30 days old by
    // this store's clock; `asked_in_conversation` needs the turn whose crisis reading says the person asked (and marks that turn);
    // `deleted_on_page` is the page's button. A case without a file is left as it is.
    async deleteRunnerKeptPlans(caseId, { reason, runtimeTurnId = null } = {}) {
      if (!KEPT_PLAN_DELETION_REASONS.includes(reason) || reason === "replaced") throw new ValidationError("The kept plan's deletion reason is invalid.");
      let deleted = 0;
      await mutate(caseId, (record) => {
        let runtimeTurn = null;
        if (reason === "asked_in_conversation") {
          runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
          if (crisisReadingOf(runtimeTurn)?.asks_to_delete_plan !== true) throw keptPlanRefusal("not_asked");
          if (runtimeTurn.kept_plan_deleted_at) return null;
          if (isFinishedRuntimeTurn(runtimeTurn)) throw keptPlanRefusal("finished_turn");
        }
        const timestamp = now();
        const due = (record.runner_kept_plans ?? []).filter((plan) => plan.deleted_at == null && (reason !== "expired" || keptPlanExpired(plan, Date.parse(timestamp))));
        if (due.length === 0 && !runtimeTurn) return null;
        for (const plan of due) markKeptPlanDeleted(plan, reason, timestamp);
        if (runtimeTurn) {
          runtimeTurn.kept_plan_deleted_at = timestamp;
          validatePrivateRuntimeTurn(runtimeTurn);
        }
        deleted = due.length;
        return record;
      }, { requireExisting: true });
      return Object.freeze({ deleted });
    },
    // Close a turn the runner trial can't answer, in one write: the person's turn if the transcript doesn't hold it yet, the case
    // state computed from the stored readings, the active draft superseded, and the fixed text as the exchange's assistant turn.
    async closeRuntimeTurnUnanswered(caseId, runtimeTurnId, { kind, reasonCode, assistantTurnId, caseState = null, stateDiff = null, diffId = null, eventId, journalHold = false }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.state === "UNANSWERED") {
          if (runtimeTurn.closure.kind === kind && runtimeTurn.closure.assistant_turn_id === assistantTurnId) return null;
          throw new ValidationError("This turn is already closed differently.");
        }
        if (runtimeTurn.state === "DELIVERED" || (runtimeTurn.state === "APPROVED" && !approvedReplyMayNotBeSent(record, runtimeTurn, reasonCode, journalHold))) {
          throw new ValidationError("A delivered or approved turn is not closed without a reply.");
        }
        if (record.raw_transcript.some((entry) => entry.id === assistantTurnId)) throw new ValidationError("Runtime assistant turn identifier already exists.");
        const timestamp = now();
        if (caseState != null) {
          const state = validateCaseState(keepStoredRoadmap(caseState, record.case_state));
          if (state.case_id !== caseId) throw new ValidationError("Case state identity mismatch.");
          record.case_state = state;
        }
        let userTurn = record.raw_transcript.find((entry) => entry.id === runtimeTurn.user_turn_id);
        if (!userTurn) {
          userTurn = {
            id: runtimeTurn.user_turn_id,
            exchange_id: runtimeTurn.exchange_id,
            role: "user",
            text: runtimeTurn.inbound.exact_text,
            at: runtimeTurn.inbound.received_at,
            episode_id: record.case_state.current_episode?.id ?? null
          };
          record.raw_transcript.push(userTurn);
          if (stateDiff != null) appendDiff(record, stateDiff, { turnId: runtimeTurn.user_turn_id, diffId });
        }
        for (const candidate of record.candidate_responses.filter(isActivePrivateCandidate)) {
          candidate.metadata = { ...candidate.metadata, superseded_from_status: candidate.status, superseded_by_runner_closing_runtime_turn_id: runtimeTurn.id };
          candidate.status = "superseded";
          candidate.updated_at = timestamp;
        }
        const closure = createRunnerClosure({ kind, reasonCode, assistantTurnId, closedAt: timestamp });
        record.raw_transcript.push({ id: assistantTurnId, exchange_id: runtimeTurn.exchange_id, role: "assistant", text: closure.exact_text, at: timestamp, episode_id: userTurn.episode_id ?? record.case_state.current_episode?.id ?? null });
        const updatedRuntime = appendPrivateRuntimeTransition(runtimeTurn, {
          eventId,
          toState: "UNANSWERED",
          at: timestamp,
          details: { kind, reason_code: reasonCode },
          projectionPatch: { assistant_turn_id: assistantTurnId, closure }
        });
        Object.assign(runtimeTurn, updatedRuntime);
        return record;
      });
    },
    async commitTurn(caseId, { transcript_entries, case_state, state_diff, diff_id = null, diff_turn_id = null }) {
      return mutate(caseId, (record) => {
        const additions = validateTranscriptEntries(transcript_entries);
        const existingIds = new Set(record.raw_transcript.map((turn) => turn.id));
        if (additions.some((turn) => existingIds.has(turn.id))) throw new ValidationError("Transcript turn IDs must be append-only and unique.");
        record.raw_transcript.push(...structuredClone(additions));
        record.case_state = validateCaseState(keepStoredRoadmap(case_state, record.case_state));
        if (state_diff != null) appendDiff(record, state_diff, {
          turnId: diff_turn_id ?? additions.find((turn) => turn.role === "user")?.id ?? additions.at(-1)?.id ?? "unknown-turn",
          diffId: diff_id
        });
        return record;
      });
    },
    async saveCaseState(caseId, caseState) {
      return mutate(caseId, (record) => {
        const state = validateCaseState(keepStoredRoadmap(caseState, record.case_state));
        if (state.case_id !== caseId) throw new ValidationError("Case state identity mismatch.");
        record.case_state = state;
        return record;
      });
    },
    async getCaseState(caseId) { return structuredClone((await readRequired(caseId)).case_state); },
    // Applies one authorized decision to the case's plan, with its state diff; a replayed decision changes nothing.
    async recordRoadmapDecision(caseId, decision) {
      await readRequired(caseId);
      let applied = false;
      const record = await mutate(caseId, (candidate) => {
        const state = validateCaseState(structuredClone(candidate.case_state));
        const roadmap = applyRoadmapDecision(state.roadmap ?? null, decision, { now: now() });
        // A replay returns the plan as this version reads it, which can differ from the stored bytes (a longer replay list or
        // history, gaps in the ranks); compare with that reading, so a replay of a stored plan is still a replay.
        if (sameJson(roadmap, readCaseRoadmap(state.roadmap ?? null).roadmap)) return null;
        // A decision already applied but no longer in the plan's replay list is told by its recorded diff.
        if (candidate.state_diff_history.some((entry) => entry.id === `roadmap:${decision.decision_id}`)) {
          throw new ValidationError(`Decision ${decision.decision_id} was already applied.`, { code: "ROADMAP_DECISION_ALREADY_APPLIED" });
        }
        // A client decision must point to where the client said it in a session: a user turn of this case, or the source artifact
        // that completes one. Its own references and those it adds to goals are checked alike. A journal entry is the client's
        // material, not a decision the client stated, so it doesn't count.
        if (decision.source === "client") {
          const userTurns = new Set(effectiveTranscript(candidate).filter((turn) => turn.role === "user").map((turn) => turn.id));
          const known = new Set([
            ...userTurns,
            ...candidate.transcript_amendments.filter((amendment) => userTurns.has(amendment.target_turn_id)).map((amendment) => amendment.provenance.source_artifact_id)
          ]);
          const earlierRefs = new Map((state.roadmap?.goals ?? []).map((goal) => [goal.id, new Set(goal.evidence_refs)]));
          const added = roadmap.goals.flatMap((goal) => goal.evidence_refs.filter((ref) => !earlierRefs.get(goal.id)?.has(ref)));
          if ([...decision.evidence_refs, ...added].some((ref) => !known.has(ref))) {
            throw new ValidationError("A client decision's evidence references must name user turns of this case, or source artifacts that complete them.", { code: "ROADMAP_CLIENT_EVIDENCE_UNRESOLVED" });
          }
        }
        const next = applyCaseStatePatch(state, { roadmap });
        appendDiff(candidate, diffCaseStates(state, next), { turnId: decision.turn_id ?? decision.decision_id, diffId: `roadmap:${decision.decision_id}`, last: false, plan: true });
        candidate.case_state = next;
        applied = true;
        return candidate;
      });
      return Object.freeze({
        case_id: caseId,
        case_revision: record.revision,
        decision_id: decision.decision_id,
        applied,
        case_plan: projectCasePlan(validateCaseState(structuredClone(record.case_state)))
      });
    },
    async checkCaseKnownVersusNew(caseId, { points, limit } = {}) {
      const record = await readRequired(caseId);
      return Object.freeze({
        case_id: caseId,
        note: "Shared word forms, best first; not a judgment of meaning. close_word_match false means no entry shares most of a point's words, not that the record lacks the point: it may hold it in other words. Read the matches, and the record's own items for the same meaning, then say whether each point is already established (and where), a new example of it, a contradiction, a new actionable lever, or a change to what comes first. When plan_problem is set, the case's stored plan couldn't be read and its goals are left out.",
        points: rankKnownVersusNew(projectEvidenceAuthority(record.case_state), points, { limit }),
        plan_problem: readCaseRoadmap(record.case_state.roadmap ?? null).problem
      });
    },
    async saveCaseDiff(caseId, stateDiff, options = {}) {
      return mutate(caseId, (record) => {
        appendDiff(record, stateDiff, options);
        return record;
      });
    },
    async getCaseDiff(caseId, { turnId = null, diffId = null } = {}) {
      const record = await readRequired(caseId);
      if (!turnId && !diffId) return structuredClone(lastTurnDiff(record));
      // By id, any diff; by turn, only a turn's own diff, never a plan decision recorded with that turn.
      const found = [...record.state_diff_history].reverse().find((entry) => (diffId ? entry.id === diffId : entry.turn_id === turnId && !isPlanDiff(entry)));
      return found ? structuredClone(found) : null;
    },
    async appendTranscriptTurn(caseId, turn) {
      return mutate(caseId, (record) => {
        const [validated] = validateTranscriptEntries([structuredClone(turn)]);
        if (record.raw_transcript.some((entry) => entry.id === validated.id)) throw new ValidationError(`Duplicate transcript turn ${validated.id}.`);
        record.raw_transcript.push(validated);
        return record;
      });
    },
    async appendTranscriptCompletionAmendment(caseId, {
      amendmentId,
      targetTurnId,
      completionText,
      sourceArtifactId,
      sourceMetadata = {},
      producerContextId
    } = {}) {
      return mutate(caseId, (record) => {
        if (record.transcript_amendments.some((entry) => entry.id === amendmentId)) throw new ValidationError(`Transcript amendment ${amendmentId} already exists.`);
        if (record.source_artifacts.some((entry) => entry.id === sourceArtifactId)) throw new ValidationError(`Exact source artifact ${sourceArtifactId} already exists and exact bytes are immutable.`);
        const targetTurn = record.raw_transcript.find((entry) => entry.id === targetTurnId);
        if (!targetTurn) throw new ValidationError(`Transcript amendment target ${targetTurnId} was not found.`);
        if (!sourceMetadata || typeof sourceMetadata !== "object" || Array.isArray(sourceMetadata)) throw new ValidationError("Transcript amendment source metadata must be an object.");
        const timestamp = now();
        const sourceArtifact = createExactSourceArtifact({
          id: sourceArtifactId,
          chunks: chunkExactSourceText(completionText),
          metadata: {
            ...structuredClone(sourceMetadata),
            kind: "transcript-completion-source",
            target_turn_id: targetTurnId,
            amendment_id: amendmentId
          },
          createdAt: timestamp
        });
        const amendment = createTranscriptCompletionAmendment({
          id: amendmentId,
          targetTurn,
          completionText,
          sourceArtifact,
          producerContextId,
          createdAt: timestamp
        });
        record.source_artifacts.push(structuredClone(sourceArtifact));
        record.transcript_amendments.push(structuredClone(amendment));
        return record;
      });
    },
    async getTranscriptAmendments(caseId) {
      return structuredClone((await readRequired(caseId)).transcript_amendments);
    },
    async getRecentVerbatim(caseId, episodePolicy = {}) {
      const record = await readRequired(caseId);
      return selectRecentVerbatimWindow(effectiveTranscript(record), {
        currentEpisodeId: episodePolicy.currentEpisodeId ?? record.case_state.current_episode?.id ?? null,
        currentEpisodeStartTurnId: episodePolicy.currentEpisodeStartTurnId ?? record.case_state.current_episode?.started_turn_id ?? null,
        maximumSelectedTurns: episodePolicy.maximumSelectedTurns ?? CONTEXT_WINDOW_LIMITS.selected_turns,
        requireCompleteEpisode: episodePolicy.requireCompleteEpisode === true
      });
    },
    async saveCandidateResponse(caseId, candidateId, exactText, metadata = {}) {
      return mutate(caseId, (record) => {
        rejectReservedCandidateMetadata(metadata);
        appendOriginalCandidate(record, candidateId, exactText, metadata);
        return record;
      }, { afterWrite: candidateLocator(caseId, candidateId) });
    },
    async updateCandidateStatus(caseId, candidateId, status, metadataPatch = {}) {
      return mutate(caseId, (record) => {
        if (status !== "superseded") throw new ValidationError("Candidate audit, approval, and delivery statuses are managed by the binding lifecycle gates.");
        if (!metadataPatch || typeof metadataPatch !== "object" || Array.isArray(metadataPatch)) throw new ValidationError("Candidate response metadata patch must be an object.");
        rejectReservedCandidateMetadata(metadataPatch);
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (!candidate) throw new ValidationError(`Candidate response ${candidateId} was not found.`, { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
        if (!isActivePrivateCandidate(candidate)) throw new ValidationError("Only the current active candidate can be superseded.");
        candidate.status = status;
        candidate.updated_at = now();
        candidate.metadata = { ...candidate.metadata, ...structuredClone(metadataPatch) };
        validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
        return record;
      });
    },
    async recordCandidateAudit(caseId, candidateId, evidence) {
      return mutate(caseId, (record) => {
        const candidate = record.candidate_responses.find(entry => entry.id === candidateId);
        if (candidate?.metadata.supervisor_draft && candidate.metadata.response_evidence) {
          const audit = validateAuditInRecord(record, candidate, evidence);
          const snapshot = record.response_evidence_snapshots.find(entry => entry.id === candidate.metadata.response_evidence.snapshot_id);
          requireSupervisorInvocation(record, candidate, snapshot, { stage: "audit", contextId: audit.auditor_context_id,
            viewSha256: audit.response_evidence?.auditor_inclusion_sha256, exactText: candidate.exact_text, audit });
        }
        applyCandidateAudit(record, candidateId, evidence);
        return record;
      });
    },
    async reconstructCandidateResponse(caseId, parentCandidateId, candidateId, exactText, metadata = {}) {
      return mutate(caseId, (record) => {
        rejectReservedCandidateMetadata(metadata);
        appendReconstruction(record, parentCandidateId, candidateId, exactText, metadata);
        return record;
      }, { afterWrite: candidateLocator(caseId, candidateId) });
    },
    async approveCandidateForDelivery(caseId, candidateId, auditId) {
      return mutate(caseId, (record) => {
        approveCandidateInRecord(record, candidateId, auditId);
        return record;
      });
    },
    // The same approval, for a supervisor draft only, and only on the audit that the supervisor review itself recorded: that audit
    // has a review receipt, which only recordSupervisorAudit writes. It is the narrow approval the connector's review runs under
    // the backend's own authority (not the caller's), so it can never approve another kind of candidate, or one whose audit was
    // written some other way. Every other check is the generic approval's, run by the same function.
    async approveSupervisorDraft(caseId, candidateId, auditId) {
      return mutate(caseId, (record) => {
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (!candidate || !isSupervisorDraftCandidate(candidate)) {
          throw new ValidationError("Only a supervisor draft can be approved here.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
        }
        requireResponseEvidence(record, candidate, "approveSupervisorDraft");
        const recorded = supervisorEntries(record, "review_receipt")
          .some((entry) => entry.audit_id === auditId && entry.candidate_id === candidate.id && entry.candidate_version === candidate.version);
        if (!recorded) {
          throw new ValidationError("A supervisor draft is approved only on the audit its supervisor review recorded.", { code: "SUPERVISOR_ARTIFACT_NOT_APPROVED" });
        }
        approveCandidateInRecord(record, candidateId, auditId, "approveSupervisorDraft");
        return record;
      });
    },
    async markCandidateSent(caseId, candidateId) {
      return mutate(caseId, (record) => {
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (candidate && (candidate.metadata.response_evidence || responseEvidencePolicy === "enforced")) {
          throw new ValidationError("Response evidence legacy exit refused.", { code: "RESPONSE_EVIDENCE_LEGACY_EXIT_REFUSED" });
        }
        if (!candidate || current?.id !== candidateId) throw new ValidationError("Delivery must target the exact current candidate version.");
        const gate = candidateDeliveryGate(candidate);
        if (!gate.delivery_allowed) throw new ValidationError(`Candidate delivery is blocked: ${gate.reason}`, { code: "PRIVATE_CANDIDATE_DELIVERY_BLOCKED" });
        // Legacy recovery: a status transition with no transcript entry and no recipient proof. It is labeled so it can never
        // read as delivered history, and deliverCandidateResponse cannot later upgrade it.
        candidate.status = "sent";
        candidate.updated_at = now();
        candidate.metadata = { ...candidate.metadata, sent_with_audit_id: gate.audit_id, sent_status_only: true };
        validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
        return record;
      });
    },
    async deliverCandidateResponse(caseId, candidateId, { auditId, assistantTurnId, inReplyToTurnId } = {}) {
      return mutate(caseId, (record) => {
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (!candidate) throw new ValidationError(`Candidate response ${candidateId} was not found.`, { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
        if (candidate.status === "sent") {
          const assistantTurn = record.raw_transcript.find((entry) => entry.id === assistantTurnId);
          if (candidate.metadata.sent_with_audit_id !== auditId || candidate.metadata.sent_turn_id !== assistantTurnId
              || candidate.metadata.sent_in_reply_to_turn_id !== inReplyToTurnId || assistantTurn?.text !== candidate.exact_text) {
            throw new ValidationError("Candidate delivery replay conflicts with the immutable sent response.");
          }
          return null;
        }
        requireResponseEvidence(record, candidate, "deliverCandidateResponse");
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (current?.id !== candidateId || candidate.status !== "approved_for_delivery") {
          throw new ValidationError("Exact candidate must be current and approved before transcript-bound delivery.");
        }
        const gate = candidateDeliveryGate(candidate);
        if (!gate.delivery_allowed || gate.audit_id !== auditId || candidate.metadata.approval_audit_id !== auditId) {
          throw new ValidationError("Transcript-bound delivery audit does not approve the exact candidate.");
        }
        if (typeof assistantTurnId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(assistantTurnId)
            || typeof inReplyToTurnId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(inReplyToTurnId)) {
          throw new ValidationError("Transcript-bound delivery identifiers are invalid.");
        }
        const userTurnIndex = record.raw_transcript.findIndex((entry) => entry.id === inReplyToTurnId);
        const userTurn = record.raw_transcript[userTurnIndex];
        if (!userTurn || userTurn.role !== "user" || userTurnIndex !== record.raw_transcript.length - 1) {
          throw new ValidationError("Transcript-bound delivery must reply to the exact latest user turn.");
        }
        if (record.raw_transcript.some((entry) => entry.id === assistantTurnId)) throw new ValidationError(`Duplicate transcript turn ${assistantTurnId}.`);
        const timestamp = now();
        record.raw_transcript.push({
          id: assistantTurnId,
          exchange_id: userTurn.exchange_id,
          role: "assistant",
          text: candidate.exact_text,
          at: timestamp,
          episode_id: userTurn.episode_id ?? record.case_state.current_episode?.id ?? null
        });
        candidate.status = "sent";
        candidate.updated_at = timestamp;
        candidate.metadata = {
          ...candidate.metadata,
          sent_with_audit_id: auditId,
          sent_turn_id: assistantTurnId,
          sent_in_reply_to_turn_id: inReplyToTurnId
        };
        validateTranscriptEntries(record.raw_transcript);
        validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
        return record;
      });
    },
    // Appends one observation about who has seen a piece of text: shown to the supervisor, exported, or reported as sent to the
    // client. It never changes a candidate, never writes an audit, and never marks anything delivered; a report binds the exact
    // bytes it names and states how it reached the store. An exact replay is a no-op; a correction retracts and records anew.
    async recordCommunicationEvent(caseId, input) {
      const record = await mutate(caseId, (record) => {
        const event = createCommunicationEvent(record, input, { recordedAt: now() });
        const existing = record.communication_events.find((entry) => entry.id === event.id);
        if (existing) {
          if (!sameCommunicationEvent(existing, event)) throw new ValidationError(`Communication event ${event.id} conflicts with an existing immutable event.`);
          return null;
        }
        validateCommunicationEvents([...record.communication_events, event], record);
        record.communication_events.push(event);
        return record;
      });
      return Object.freeze({
        case_id: caseId,
        revision: record.revision,
        event: structuredClone(record.communication_events.find((entry) => entry.id === input.eventId)),
        communication_projection: projectCommunicationState(record)
      });
    },
    // --- Controlled supervisor drafts -----------------------------------------------------------------------------------------
    // The owner's current messages and revision instructions, recorded with the channel that supplied them. They are not
    // transcript turns: nothing here says the client wrote them, and a supervisor revision is never a client inbound message.
    async recordSupervisorInputs(caseId, { inputs, channel } = {}) {
      if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > SUPERVISOR_LIMITS.inputs_per_request) {
        throw new ValidationError(`Supervisor inputs must be a list of one to ${SUPERVISOR_LIMITS.inputs_per_request}.`);
      }
      await readRequired(caseId);
      const recorded = [];
      const record = await mutate(caseId, (record) => {
        recorded.length = 0;
        const recordedAt = now();
        let changed = false;
        for (const input of inputs) {
          const entry = createSupervisorInputEntry({ id: input?.inputId, inputType: input?.inputType, text: input?.text, channel, recordedAt });
          const existing = record.supervisor_artifacts.find((candidate) => candidate.id === entry.id);
          if (existing) {
            assertSameSupervisorOperation(supervisorInputIdentity(existing, entry));
            recorded.push(existing);
            continue;
          }
          record.supervisor_artifacts.push(entry);
          recorded.push(entry);
          changed = true;
        }
        return changed ? record : null;
      });
      return Object.freeze({
        case_id: caseId,
        revision: record.revision,
        inputs: supervisorInputViews({ supervisor_artifacts: recorded })
      });
    },
    // What a supervisor needs before drafting: the basis a draft will be written against, the newest client turn, the owner's
    // recorded inputs with who supplied them, every supervisor artifact and its state, and what the case can truthfully say
    // about who has seen what. It states its own review scope so no one reads more into an approval than it carries.
    async getSupervisorSnapshot(caseId) {
      const record = await readRequired(caseId);
      const transcript = effectiveTranscript(record);
      const latestClientTurn = [...transcript].reverse().find((turn) => turn.role === "user") ?? null;
      const basis = computeResponseBasis(record);
      const projection = projectCommunicationState(record);
      const active = [...record.candidate_responses].reverse().find(isActivePrivateCandidate) ?? null;
      const artifacts = supervisorArtifactViews(record, { responseEvidencePolicy });
      return Object.freeze({
        schema_version: 1,
        case_id: caseId,
        case_revision: record.revision,
        basis: { ...basis, sha256: responseBasisDigest(basis) },
        latest_client_turn: latestClientTurn ? { turn_id: latestClientTurn.id, at: latestClientTurn.at, text: latestClientTurn.text } : null,
        last_transcript_role: transcript.at(-1)?.role ?? null,
        owner_supplied_inputs: supervisorInputViews(record),
        active_candidate: active ? { candidate_id: active.id, candidate_version: active.version, status: active.status, supervisor_draft: isSupervisorDraftCandidate(active) } : null,
        artifacts: artifacts.slice(-25),
        artifacts_omitted: Math.max(0, artifacts.length - 25),
        communication: {
          confirmed_or_reported_client_outbound: projection.confirmed_or_reported_client_outbound,
          supervisor_only_artifacts: projection.supervisor_only_artifacts,
          unresolved_delivery: projection.unresolved_delivery,
          omitted: projection.omitted
        },
        review_scope: {
          audit: "existing_independent_audit",
          audit_evidence: "stored_case_record_only",
          owner_inputs_in_audit_packet: Boolean(active?.metadata.response_evidence && isSupervisorDraftCandidate(active)),
          translation_meaning: "unreviewed",
          source_support_coverage: active?.metadata.response_evidence && isSupervisorDraftCandidate(active) ? "enforced" : "not_enforced_in_this_version",
          claim_scope: "Approval and export cover only the exact bytes InnerSignal stored; text edited, retyped, translated or paraphrased elsewhere inherits none of it."
        }
      });
    },
    // Finds the draft a submission already made, or says there is none. A retried submission is answered from the stored draft only
    // if it repeats everything that defined that draft (where its bytes came from, the bytes, the companion and who supplied it,
    // and the case state it was prepared against when it states one); otherwise it is refused here, before the caller generates,
    // skips or returns anything. The service learns whether a draft exists only through this lookup, so a draft written by the
    // backend (which a retry does not write again) is checked by the same comparison as one the caller supplied. Read-only.
    async resolveSupervisorSubmission(caseId, { operationKey, source, exactText, producerContextId, companion, basisSha256, channel } = {}) {
      validateOperationKey(operationKey);
      if (!["external_draft", "backend_produced"].includes(source)) throw new ValidationError("Supervisor draft source is invalid.");
      const record = await readRequired(caseId);
      const stored = record.candidate_responses.find((entry) => entry.id === supervisorCandidateId(operationKey, 1));
      if (!stored) return Object.freeze({ case_id: caseId, found: false, artifact: null });
      assertSameSupervisorOperation(supervisorSubmissionIdentity(record, stored, { source, exactText, producerContextId, companion, basisSha256, channel }));
      return Object.freeze({ case_id: caseId, found: true, artifact: supervisorArtifactView(record, stored, { responseEvidencePolicy }) });
    },
    // Stores one supervisor draft as an immutable candidate that begins pending its independent audit, together with the basis it
    // was written against. `external_draft` bytes are stored exactly as received and the original writer is not attested;
    // `backend_produced` bytes come from the existing runtime with its own receipts. A replay of the same operation changes
    // nothing; the same operation with other bytes is refused.
    async submitSupervisorDraft(caseId, {
      operationKey,
      source,
      exactText,
      producerContextId,
      receipts = {},
      responseEvidence = null,
      expectedBasisSha256 = null,
      companion = null,
      channel
    } = {}) {
      validateOperationKey(operationKey);
      if (!["external_draft", "backend_produced"].includes(source)) throw new ValidationError("Supervisor draft source is invalid.");
      if (typeof exactText !== "string" || !exactText.trim()) throw new ValidationError("Draft text must be non-empty.");
      if (exactText.length > PRIVATE_RECORD_LIMITS.candidate_text) throw new ValidationError("Draft text exceeds the private candidate limit.");
      if (typeof producerContextId !== "string" || !producerContextId.trim() || producerContextId.length > 160) throw new ValidationError("A draft producer context is required.");
      if (expectedBasisSha256 != null && !/^[a-f0-9]{64}$/.test(expectedBasisSha256)) throw new ValidationError("basisSha256 is invalid.");
      if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)
          || Object.keys(receipts).some((key) => !["producer_attempt_context_id", "journal_evidence_sha256", "response_evidence_view_sha256"].includes(key))) {
        throw new ValidationError("Draft receipts may carry only the producer attempt context and the journal evidence digest.");
      }
      if (source === "external_draft" && Object.keys(receipts).length) throw new ValidationError("An external draft carries no producer receipts.");
      if (companion != null && (typeof companion !== "object" || Array.isArray(companion))) throw new ValidationError("companion must be an object.");
      const candidateId = supervisorCandidateId(operationKey, 1);
      await readRequired(caseId);
      let replayed = false;
      const record = await mutate(caseId, (record) => {
        replayed = false;
        const existing = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (existing) {
          // The same comparison the service's lookup makes (resolveSupervisorSubmission), repeated here inside the write.
          assertSameSupervisorOperation(supervisorSubmissionIdentity(record, existing, { source, exactText, producerContextId, companion: companion ?? null, channel }));
          const bound = existing.metadata.response_evidence;
          if ((bound != null) !== (responseEvidence != null) || (bound && (bound.snapshot_id !== responseEvidence.snapshotId
              || bound.writer_inclusion_sha256 !== responseEvidence.writerInclusionSha256))) {
            throw new ValidationError("Response evidence replay conflict.", { code: "RESPONSE_EVIDENCE_INVALID" });
          }
          replayed = true;
          return null;
        }
        const basis = computeResponseBasis(record, candidateId);
        const basisSha256 = responseBasisDigest(basis);
        if (expectedBasisSha256 != null && expectedBasisSha256 !== basisSha256) {
          throw new ValidationError("The case changed after this draft was prepared; prepare the case again before submitting.", { code: "SUPERVISOR_BASIS_CHANGED" });
        }
        let evidenceBinding = null;
        if (responseEvidence != null) {
          const snapshot = record.response_evidence_snapshots.find((entry) => entry.id === responseEvidence.snapshotId);
          const newest = record.response_evidence_snapshots.filter((entry) => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey).at(-1);
          if (!snapshot || (source === "external_draft" && snapshot !== newest) || snapshot.case_id !== caseId || snapshot.candidate_origin !== source) {
            throw new ValidationError("Response evidence binding invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
          }
          validateResponseEvidenceSnapshot(snapshot);
          const current = snapshot.inbound.turn_id === basis.latest_user_turn_id && responseEvidenceSnapshotCurrent(record, { snapshot });
          if (!current && source === "external_draft") throw new ValidationError("Response evidence stale.", { code: "RESPONSE_EVIDENCE_STALE" });
          const inclusion = responseEvidence.writerInclusionSha256;
          if (source === "external_draft" ? inclusion !== null
            : inclusion !== receipts.response_evidence_view_sha256) {
            throw new ValidationError("Response evidence writer inclusion invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
          }
          if (source === "backend_produced") requireSupervisorInvocation(record,
            supervisorCallCandidate(record, { operationKey, stage: "candidate", candidateId, snapshot }), snapshot,
            { stage: "candidate", contextId: producerContextId, viewSha256: inclusion, exactText });
          evidenceBinding = {
            schema_version: 1, policy_version: RESPONSE_EVIDENCE_POLICY_VERSION, snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256,
            candidate_origin: source, writer_inclusion: source === "external_draft" ? "not_attested" : "verified", writer_inclusion_sha256: inclusion,
            established_context_after_commit_sha256: snapshot.dependency_binding.established_context_digest,
            compatibility_state_after_commit_binding: snapshot.dependency_binding.compatibility_state_binding, dependency_status: current ? "current_at_commit" : "stale_at_commit"
          };
        } else if (responseEvidencePolicy === "enforced" || record.response_evidence_snapshots.some(entry => entry.owner.kind === "supervisor_draft" && entry.owner.operation_key === operationKey)) throw new ValidationError("Response evidence required.", { code: "RESPONSE_EVIDENCE_REQUIRED" });
        const candidate = appendOriginalCandidate(record, candidateId, exactText, {
          producer_context_id: producerContextId,
          compatibility_state_binding: basis.compatibility_state_binding,
          ...structuredClone(receipts),
          ...(evidenceBinding ? { response_evidence: evidenceBinding } : {}),
          supervisor_draft: {
            schema_version: SUPERVISOR_DRAFT_VERSION,
            source,
            root_source: source,
            operation_key: operationKey,
            text_sha256: sha256Text(exactText),
            basis,
            basis_sha256: basisSha256,
            exposure: {
              exact_bytes: source === "external_draft" ? "received_and_stored" : "produced_by_backend",
              original_writer: source === "external_draft" ? "not_attested" : "backend_inclusion_receipts",
              auditor_inputs: "case_record_only"
            }
          }
        }, { supersedeFailed: true });
        if (companion) {
          record.supervisor_artifacts.push(createSupervisorCompanionEntry({
            id: `companion:${operationKey}:v1`,
            candidate,
            language: companion.language,
            text: companion.text,
            channel,
            recordedAt: candidate.created_at
          }));
        }
        return record;
      }, { afterWrite: candidateLocator(caseId, candidateId) });
      const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
      return Object.freeze({ case_id: caseId, revision: record.revision, replayed, artifact: supervisorArtifactView(record, candidate, { responseEvidencePolicy }) });
    },
    // The same audit persistence as recordCandidateAudit, restricted to supervisor drafts, plus what that audit run reported
    // having been shown, written in the same step so a stored audit and its receipt cannot come apart.
    async recordSupervisorAudit(caseId, candidateId, evidence, { disclosureManifest = null, providerReceipt = null } = {}) {
      return mutate(caseId, (record) => {
        const target = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (!target || !isSupervisorDraftCandidate(target)) throw new ValidationError("Only a supervisor draft can receive supervisor review evidence.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
        const appendReceipt = (candidate, audit) => {
          const receipt = createSupervisorReviewReceipt({
            id: `receipt:${audit.id}`,
            candidate,
            auditId: audit.id,
            disclosureManifest,
            providerReceipt,
            recordedAt: now()
          });
          record.supervisor_artifacts.push(receipt);
        };
        if (target.metadata.response_evidence) {
          // Provenance comes from the immutable completion; this receipt is display bookkeeping.
          const audit = validateAuditInRecord(record, target, evidence);
          const snapshot = record.response_evidence_snapshots.find(entry => entry.id === target.metadata.response_evidence.snapshot_id);
          requireSupervisorInvocation(record, target, snapshot, { stage: "audit", contextId: audit.auditor_context_id,
            viewSha256: audit.response_evidence?.auditor_inclusion_sha256, exactText: target.exact_text, audit });
          appendReceipt(target, audit);
          applyCandidateAudit(record, candidateId, audit, "recordSupervisorAudit");
        } else {
          // Preserve the existing validation and timestamp order byte for byte on the advisory path.
          const { candidate, audit } = applyCandidateAudit(record, candidateId, evidence, "recordSupervisorAudit");
          appendReceipt(candidate, audit);
        }
        return record;
      });
    },
    async recordSupervisorEvidenceStale(caseId, candidateId) {
      return mutate(caseId, record => {
        const candidate = record.candidate_responses.find(entry => entry.id === candidateId);
        const snapshot = record.response_evidence_snapshots.find(entry => entry.id === candidate?.metadata.response_evidence?.snapshot_id);
        let currentEvidence = candidate && snapshot && responseEvidenceDependenciesCurrent(record, candidate, snapshot);
        if (currentEvidence) { try { buildEvidenceModelView(record, snapshot); } catch { currentEvidence = false; } }
        if (!candidate || !snapshot || !isSupervisorDraftCandidate(candidate) || currentEvidence) {
          throw new ValidationError("Supervisor stale recovery invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
        }
        const audit = structuredClone(createCandidateAuditEvidence({
          auditId: `audit:code-stale:${sha256Text(candidate.id).slice(0, 32)}`, candidate, auditVersion: "private-candidate-audit-v4",
          auditorContext: { kind: "self_critique", context_id: "code:response-evidence-stale" }, independentAuditorAvailable: false,
          completedAt: now(), repairInducedChecks: candidate.parent_candidate_id === null ? [] : REPAIR_INDUCED_ERROR_CHECKS,
          findings: [{ id: "evidence:dependencies", code: "RESPONSE_EVIDENCE_STALE", severity: "substantive", summary: "Response evidence dependencies changed.", derived_in_code: true }]
        }));
        audit.derived_in_code = true;
        applyCandidateAudit(record, candidateId, audit, "recordSupervisorAudit");
        return record;
      });
    },
    // One bounded repair of a supervisor draft that failed its audit. The repaired bytes are a new candidate that inherits the
    // basis of its parent and no approval, and the caller supplies neither the basis nor the source.
    async reconstructSupervisorDraft(caseId, parentCandidateId, { exactText, producerContextId, writerInclusionSha256 = null } = {}) {
      let childId = null;
      const record = await mutate(caseId, (record) => {
        const parent = record.candidate_responses.find((entry) => entry.id === parentCandidateId);
        if (!parent || !isSupervisorDraftCandidate(parent)) throw new ValidationError("Only a supervisor draft can be repaired here.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
        const draft = parent.metadata.supervisor_draft;
        childId = supervisorCandidateId(draft.operation_key, parent.repair_cycle + 2);
        const existing = record.candidate_responses.find((entry) => entry.id === childId);
        if (existing) {
          assertSameSupervisorOperation([
            ["parent", existing.parent_candidate_id, parent.id],
            ["exact_text", existing.exact_text, exactText],
            ["producer_context", existing.producer_context_id, producerContextId],
            ["writer_inclusion", existing.metadata.response_evidence?.writer_inclusion_sha256 ?? null, writerInclusionSha256]
          ]);
          return null;
        }
        let evidenceBinding = null;
        if (parent.metadata.response_evidence) {
          const completion = record.supervisor_invocations.find(entry => entry.event_type === "COMPLETED" && entry.input.stage === "repair"
            && entry.input.candidate_id === parent.id && entry.actual_context_id === producerContextId);
          const snapshot = record.response_evidence_snapshots.find(entry => entry.id === completion?.input.snapshot_id);
          if (!snapshot || snapshot.case_id !== caseId || snapshot.candidate_origin !== draft.root_source) throw new ValidationError("Response evidence binding invalid.", { code: "RESPONSE_EVIDENCE_INVALID" });
          const root = record.candidate_responses.find((entry) => entry.id === parent.root_candidate_id);
          requireSupervisorInvocation(record, parent, snapshot, { stage: "repair", contextId: producerContextId,
            viewSha256: writerInclusionSha256, exactText });
          evidenceBinding = {
            schema_version: 1, policy_version: RESPONSE_EVIDENCE_POLICY_VERSION, snapshot_id: snapshot.id, snapshot_sha256: snapshot.snapshot_sha256,
            candidate_origin: snapshot.candidate_origin, writer_inclusion: "verified", writer_inclusion_sha256: writerInclusionSha256,
            established_context_after_commit_sha256: snapshot.dependency_binding.established_context_digest,
            compatibility_state_after_commit_binding: snapshot.dependency_binding.compatibility_state_binding,
            dependency_status: responseEvidenceSnapshotCurrent(record, { snapshot, rootCandidate: root }) ? "current_at_commit" : "stale_at_commit"
          };
        }
        appendReconstruction(record, parent.id, childId, exactText, {
          producer_context_id: producerContextId,
          compatibility_state_binding: parent.metadata.compatibility_state_binding ?? null,
          repair_induced_error_checks_required: [...REPAIR_INDUCED_ERROR_CHECKS],
          ...(evidenceBinding ? { response_evidence_view_sha256: writerInclusionSha256 } : {}),
          supervisor_draft: {
            ...structuredClone(draft),
            source: "backend_repair",
            text_sha256: sha256Text(exactText),
            exposure: { exact_bytes: "produced_by_backend_repair", original_writer: "backend_inclusion_receipts", auditor_inputs: "case_record_only" }
          }
        }, evidenceBinding);
        return record;
      }, { afterWrite: () => candidateLocator(caseId, childId)() });
      return Object.freeze({ case_id: caseId, revision: record.revision, artifact: supervisorArtifactView(record, record.candidate_responses.find((entry) => entry.id === childId), { responseEvidencePolicy }) });
    },
    // The only function that returns the exact approved client text. It re-checks, inside the same write that records the export,
    // that the bytes are the audited bytes, the audit passed and the candidate is approved, and that nothing has made the draft
    // stale: a newer client message, a correction, a changed delivery state, a new owner input or a newer draft. An export is
    // recorded as `exported` and never as sent; a replay returns the same bytes and records nothing new.
    async exportSupervisorArtifact(caseId, { artifactId, channel } = {}) {
      await readRequired(caseId);
      let exported = null;
      const record = await mutate(caseId, (record) => {
        const candidate = findSupervisorArtifact(record, artifactId);
        if (!candidate) throw new ValidationError("No such supervisor artifact in this case.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
        const assessment = assessSupervisorArtifact(record, candidate, { responseEvidencePolicy });
        if (assessment.refusal) {
          throw new ValidationError(`Export refused: ${assessment.refusal.reasons.join(", ")}.`, { code: assessment.refusal.code, details: { reasons: [...assessment.refusal.reasons] } });
        }
        const events = record.communication_events;
        const retracted = new Set(events.filter((event) => event.kind === "retraction").map((event) => event.retracts_event_id));
        const base = `evt:export:${artifactId.slice(4)}`;
        const activeExport = (id) => events.find((event) => event.id === id && event.kind === "exported" && !retracted.has(event.id)) ?? null;
        const freshEventId = (stem) => {
          let attempt = 0;
          while (events.some((event) => event.id === (attempt ? `${stem}:r${attempt}` : stem))) attempt += 1;
          return attempt ? `${stem}:r${attempt}` : stem;
        };
        const sourceRef = `supervisor:export:${channel === "owner_ui" ? "owner_ui" : "authenticated_agent"}`;
        const recordedAt = now();
        let changed = false;
        const ensure = (stem, kindInput) => {
          const present = events.filter((event) => event.id === stem || event.id.startsWith(`${stem}:r`)).map((event) => activeExport(event.id)).find(Boolean);
          if (present) return present;
          const event = createCommunicationEvent(record, { eventId: freshEventId(stem), kind: "exported", provenance: { origin: "application", sourceRef, quote: null }, ...kindInput }, { recordedAt });
          validateCommunicationEvents([...record.communication_events, event], record);
          record.communication_events.push(event);
          changed = true;
          return event;
        };
        const clientEvent = ensure(base, { audience: "client", subject: { kind: "candidate", candidateId: candidate.id, candidateVersion: candidate.version } });
        const companion = companionForCandidate(record, candidate);
        const companionEvent = companion
          ? ensure(`${base}:companion`, { audience: "supervisor", subject: { kind: "companion", companionOf: { candidateId: candidate.id, candidateVersion: candidate.version }, artifactSha256: companion.text_sha256 } })
          : null;
        exported = {
          candidate_id: candidate.id,
          candidate_version: candidate.version,
          client_text: candidate.exact_text,
          client_text_sha256: sha256Text(candidate.exact_text),
          approval_audit_id: assessment.approval_audit_id,
          checks: { ...assessment.checks },
          event: { event_id: clientEvent.id, recorded_at: clientEvent.recorded_at },
          replayed: !changed,
          companion: companion ? { ...companionView(companion, { includeText: true }), event: { event_id: companionEvent.id, recorded_at: companionEvent.recorded_at } } : null
        };
        return changed ? record : null;
      });
      const candidate = findSupervisorArtifact(record, artifactId);
      return Object.freeze({
        case_id: caseId,
        revision: record.revision,
        artifact_id: artifactId,
        ...exported,
        artifact: supervisorArtifactView(record, candidate, { responseEvidencePolicy }),
        sent_status: "not_sent",
        notice: "Exported text has been released from InnerSignal; it has not been sent. InnerSignal records a send only when the owner reports it."
      });
    },
    // Records that the owner reported sending a supervisor draft to the client. The caller names the origin from its own trusted
    // channel; a bare assertion from an authenticated agent keeps the weaker `agent_relayed` origin. With no artifact named, a
    // single exported draft not yet reported is the unambiguous target; with several, the report is recorded as unresolved
    // rather than guessed. An unsupplied send time stays unknown.
    //
    // A retry with the same `idempotencyKey` is resolved from the report that key already made, before any currently reportable
    // draft is inferred: once a report is recorded its draft is no longer waiting, so inferring first would turn a caller's retry
    // of a lost answer into a refusal. The retry must repeat the original inputs, and naming a draft must name the same one.
    async recordSupervisorReport(caseId, { artifactId = null, origin, sentAt = null, quote = null, sourceRef = null, idempotencyKey = null } = {}) {
      if (!["owner_action", "agent_relayed"].includes(origin)) throw new ValidationError("A reported delivery needs an owner or relayed origin.");
      if (sentAt != null && (typeof sentAt !== "string" || Number.isNaN(Date.parse(sentAt)))) throw new ValidationError("sentAt must be a timestamp when supplied.");
      await readRequired(caseId);
      let targetCandidate = null;
      let reportEventId = null;
      let replayed = false;
      const record = await mutate(caseId, (record) => {
        replayed = false;
        targetCandidate = null;
        const events = record.communication_events;
        const retracted = new Set(events.filter((event) => event.kind === "retraction").map((event) => event.retracts_event_id));
        const activeFor = (candidate, kind) => events.filter((event) => event.kind === kind && !retracted.has(event.id) && event.subject.kind === "candidate"
          && event.subject.candidate_id === candidate.id && event.subject.candidate_version === candidate.version);
        const keyedEventId = idempotencyKey != null ? `evt:report:${sha256Json([caseId, ["key", idempotencyKey]]).slice(0, 40)}` : null;
        const keyed = keyedEventId ? events.find((entry) => entry.id === keyedEventId) : null;
        if (keyed) {
          const named = artifactId != null ? findSupervisorArtifact(record, artifactId) : null;
          if (artifactId != null && !named) throw new ValidationError("No such supervisor artifact in this case.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
          assertSameSupervisorOperation(supervisorReportIdentity(keyed, { origin, sourceRef, quote, sentAt }, named ?? undefined));
          replayed = true;
          reportEventId = keyed.id;
          targetCandidate = keyed.subject.kind === "candidate" ? keyed.subject.candidate_id : null;
          return null;
        }
        let subject;
        let subjectKey;
        if (artifactId != null) {
          const candidate = findSupervisorArtifact(record, artifactId);
          if (!candidate) throw new ValidationError("No such supervisor artifact in this case.", { code: "SUPERVISOR_ARTIFACT_NOT_FOUND" });
          targetCandidate = candidate.id;
          subject = { kind: "candidate", candidateId: candidate.id, candidateVersion: candidate.version };
          subjectKey = `${candidate.id}:${candidate.version}`;
        } else {
          const open = record.candidate_responses.filter((candidate) => isSupervisorDraftCandidate(candidate)
            && activeFor(candidate, "exported").length > 0 && activeFor(candidate, "reported_sent").length === 0);
          if (open.length === 0) throw new ValidationError("No exported supervisor draft is waiting to be reported; name the artifact.", { code: "SUPERVISOR_NO_REPORTABLE_DRAFT" });
          if (open.length === 1) {
            targetCandidate = open[0].id;
            subject = { kind: "candidate", candidateId: open[0].id, candidateVersion: open[0].version };
            subjectKey = `${open[0].id}:${open[0].version}`;
          } else {
            const refs = open.slice(-10);
            subject = { kind: "unresolved", candidateRefs: refs.map((candidate) => ({ candidateId: candidate.id, candidateVersion: candidate.version })) };
            subjectKey = `unresolved:${refs.map((candidate) => `${candidate.id}:${candidate.version}`).join(",")}`;
          }
        }
        const eventId = keyedEventId ?? `evt:report:${sha256Json([caseId, ["derived", subjectKey, origin, sentAt ?? null]]).slice(0, 40)}`;
        reportEventId = eventId;
        const event = createCommunicationEvent(record, {
          eventId,
          kind: "reported_sent",
          audience: "client",
          subject,
          sentAt,
          provenance: { origin, sourceRef, quote }
        }, { recordedAt: now() });
        const existing = events.find((entry) => entry.id === eventId);
        if (existing) {
          // The same comparison as a keyed retry, and the whole stored event besides: this identity was derived, not named.
          assertSameSupervisorOperation([
            ...supervisorReportIdentity(existing, { origin, sourceRef, quote, sentAt }, artifactId != null ? findSupervisorArtifact(record, artifactId) ?? undefined : undefined),
            ["event", true, sameCommunicationEvent(existing, event)]
          ]);
          replayed = true;
          return null;
        }
        validateCommunicationEvents([...record.communication_events, event], record);
        record.communication_events.push(event);
        return record;
      });
      return Object.freeze({
        case_id: caseId,
        revision: record.revision,
        replayed,
        event: structuredClone(record.communication_events.find((event) => event.id === reportEventId) ?? null),
        artifact: targetCandidate ? supervisorArtifactView(record, record.candidate_responses.find((entry) => entry.id === targetCandidate), { responseEvidencePolicy }) : null,
        communication_projection: projectCommunicationState(record)
      });
    },
    async getCandidateResponse(caseId, selector = "current_pending") {
      const record = await readRequired(caseId);
      const candidate = selector === "current_pending"
        ? [...record.candidate_responses].reverse().find((entry) => ["pending_audit", "reconstructed_pending_audit"].includes(entry.status))
        : selector === "current_candidate"
          ? [...record.candidate_responses].reverse().find(isActivePrivateCandidate)
        : record.candidate_responses.find((entry) => entry.id === selector);
      return candidate ? structuredClone(candidate) : null;
    },
    async getCandidateLifecycle(caseId) {
      const record = await readRequired(caseId);
      // Archived handoffs retain their audit-status gate. A live readback also applies today's store admission policy.
      const lifecycle = projectCandidateLifecycle(record.candidate_responses);
      if (!["DELIVER", "APPROVE_FOR_DELIVERY"].includes(lifecycle.delivery_gate.action)) return lifecycle;
      const candidate = record.candidate_responses.find(entry => entry.id === lifecycle.current_candidate_id);
      const admission = assessResponseEvidenceAdmission(record, candidate, { policy: responseEvidencePolicy,
        point: lifecycle.delivery_gate.action === "DELIVER" ? "deliverCandidateResponse" : "approveCandidateForDelivery" });
      return admission.admissible ? lifecycle : Object.freeze({ ...lifecycle,
        delivery_gate: { ...lifecycle.delivery_gate, action: "BLOCK", delivery_allowed: false, reason: admission.code } });
    },
    async saveSourceArtifact(caseId, sourceArtifactId, chunks, metadata = {}) {
      return mutate(caseId, (record) => {
        if (record.source_artifacts.some((artifact) => artifact.id === sourceArtifactId)) throw new ValidationError(`Exact source artifact ${sourceArtifactId} already exists and exact bytes are immutable.`);
        const artifact = createExactSourceArtifact({ id: sourceArtifactId, chunks, metadata, createdAt: now() });
        record.source_artifacts.push(structuredClone(artifact));
        return record;
      });
    },
    async getSourceArtifact(caseId, sourceArtifactId) {
      const record = await readRequired(caseId);
      const artifact = record.source_artifacts.find((entry) => entry.id === sourceArtifactId);
      return artifact ? structuredClone(artifact) : null;
    },
    async retrieveCaseEvidence(caseId, { query = null, provenanceIds = [], timeRange = null, limit = 24 } = {}) {
      const record = await readRequired(caseId);
      return selectEvidence(record, { query, provenanceIds, timeRange, limit });
    },
    async getTrackerWindow(caseId, options = {}) {
      const record = await readRequired(caseId);
      return selectTrackerEntries(record.tracker_entries, options);
    },
    async getJournalEntries(caseId, options = {}) {
      const record = await readRequired(caseId);
      return selectJournalEntries(record.journal_entries, options);
    },
    async createJournalCorpus(caseId, { corpusId, manifestObjectId }) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const checkedManifestObjectId = safeJournalId(manifestObjectId, "manifestObjectId");
      const record = await mutate(caseId, (candidate) => {
        const existing = candidate.journal_corpora.find((reference) => reference.corpus_id === checkedCorpusId);
        if (existing) {
          if (existing.manifest_object_id !== checkedManifestObjectId) throw new ValidationError("Journal corpus creation conflicts with an existing corpus.", { code: "REVISION_CONFLICT" });
          return null;
        }
        const corpusKey = randomBytes(32);
        try {
          candidate.journal_corpora.push({
            corpus_id: checkedCorpusId,
            active_generation: null,
            manifest_object_id: checkedManifestObjectId,
            visibility_epoch: 0,
            previous_generations: []
          });
          candidate.journal_corpus_keys.push({ corpus_id: checkedCorpusId, key_version: 1, key_base64: corpusKey.toString("base64") });
          return candidate;
        } finally { corpusKey.fill(0); }
      });
      return Object.freeze({
        case_id: record.case_id,
        case_revision: record.revision,
        reference: structuredClone(record.journal_corpora.find((item) => item.corpus_id === checkedCorpusId))
      });
    },
    async getJournalCorpus(caseId, corpusId) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const record = await readRequired(caseId);
      const reference = record.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
      if (!reference) throw new ValidationError("Journal corpus was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
      return Object.freeze({ case_id: record.case_id, case_revision: record.revision, reference: structuredClone(reference) });
    },
    async getJournalCorpusKey(caseId, corpusId) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const record = await readRequired(caseId);
      const entry = record.journal_corpus_keys.find((item) => item.corpus_id === checkedCorpusId);
      if (!entry) throw new ValidationError("Journal corpus was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
      return Buffer.from(entry.key_base64, "base64");
    },
    async publishJournalGeneration(caseId, {
      corpusId,
      generation,
      manifestObjectId,
      expectedGeneration = null,
      expectedCaseRevision = null,
      expectedVisibilityEpoch = null
    }) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const checkedGeneration = safeJournalId(generation, "generation");
      const checkedManifestObjectId = safeJournalId(manifestObjectId, "manifestObjectId");
      const record = await mutate(caseId, (candidate) => {
        if (expectedCaseRevision != null && candidate.revision !== expectedCaseRevision) throw new ValidationError("Private case revision changed.", { code: "REVISION_CONFLICT" });
        const reference = candidate.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
        if (!reference) throw new ValidationError("Journal corpus was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        if (expectedVisibilityEpoch != null && reference.visibility_epoch !== expectedVisibilityEpoch) throw new ValidationError("Journal visibility epoch changed.", { code: "GRANT_REVOKED" });
        if (reference.active_generation === checkedGeneration && reference.manifest_object_id === checkedManifestObjectId) return null;
        if (reference.active_generation !== expectedGeneration) throw new ValidationError("Journal generation changed.", { code: "REVISION_CONFLICT" });
        if (reference.active_generation !== null) {
          reference.previous_generations.push({ generation: reference.active_generation, manifest_object_id: reference.manifest_object_id });
        }
        reference.active_generation = checkedGeneration;
        reference.manifest_object_id = checkedManifestObjectId;
        return candidate;
      });
      const reference = record.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
      return Object.freeze({ case_revision: record.revision, active_generation: reference.active_generation, visibility_epoch: reference.visibility_epoch });
    },
    async rollbackJournalGeneration(caseId, { corpusId, targetGeneration, expectedGeneration, expectedVisibilityEpoch = null }) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const checkedTarget = safeJournalId(targetGeneration, "targetGeneration");
      const record = await mutate(caseId, (candidate) => {
        const reference = candidate.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
        if (!reference) throw new ValidationError("Journal corpus was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        if (expectedVisibilityEpoch != null && reference.visibility_epoch !== expectedVisibilityEpoch) throw new ValidationError("Journal visibility epoch changed.", { code: "GRANT_REVOKED" });
        if (reference.active_generation !== expectedGeneration) throw new ValidationError("Journal generation changed.", { code: "REVISION_CONFLICT" });
        const target = [...reference.previous_generations].reverse().find((item) => item.generation === checkedTarget);
        if (!target) throw new ValidationError("Rollback generation is unavailable.", { code: "SOURCE_UNAVAILABLE" });
        if (reference.active_generation !== null) reference.previous_generations.push({ generation: reference.active_generation, manifest_object_id: reference.manifest_object_id });
        reference.active_generation = target.generation;
        reference.manifest_object_id = target.manifest_object_id;
        return candidate;
      });
      const reference = record.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
      return Object.freeze({ case_revision: record.revision, active_generation: reference.active_generation });
    },
    async incrementJournalVisibilityEpoch(caseId, { corpusId, expectedEpoch }) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const record = await mutate(caseId, (candidate) => {
        const reference = candidate.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
        if (!reference) throw new ValidationError("Journal corpus was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        if (reference.visibility_epoch !== expectedEpoch) throw new ValidationError("Journal visibility epoch changed.", { code: "REVISION_CONFLICT" });
        reference.visibility_epoch += 1;
        // The active generation was published under the old epoch, which no reader accepts any more,
        // so it stops being active. It moves to the previous generations, where a rollback refuses it
        // for its epoch, and nothing (a handoff's continuity included) presents it as readable.
        if (reference.active_generation !== null) {
          reference.previous_generations.push({ generation: reference.active_generation, manifest_object_id: reference.manifest_object_id });
          reference.active_generation = null;
        }
        return candidate;
      });
      return record.journal_corpora.find((item) => item.corpus_id === checkedCorpusId).visibility_epoch;
    },
    async tombstoneJournalCorpus(caseId, { corpusId, expectedGeneration, expectedEpoch, tombstoneId }) {
      const checkedCorpusId = safeJournalId(corpusId, "corpusId");
      const checkedTombstoneId = safeJournalId(tombstoneId, "tombstoneId");
      const checkedExpectedGeneration = expectedGeneration == null ? null : safeJournalId(expectedGeneration, "expectedGeneration");
      if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0) throw new ValidationError("expectedEpoch is invalid.");
      const record = await mutate(caseId, (candidate) => {
        const reference = candidate.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
        if (!reference) throw new ValidationError("Journal corpus was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        if (reference.active_generation !== checkedExpectedGeneration || reference.visibility_epoch !== expectedEpoch) {
          throw new ValidationError("Journal corpus changed before deletion.", { code: "REVISION_CONFLICT" });
        }
        reference.active_generation = null;
        reference.manifest_object_id = checkedTombstoneId;
        reference.previous_generations = [];
        reference.visibility_epoch += 1;
        return candidate;
      });
      const reference = record.journal_corpora.find((item) => item.corpus_id === checkedCorpusId);
      return Object.freeze({
        case_revision: record.revision,
        active_generation: null,
        visibility_epoch: reference.visibility_epoch,
        tombstone_id: reference.manifest_object_id
      });
    },
    async getCurrentEpisode(caseId) { return structuredClone((await readRequired(caseId)).case_state.current_episode); },
    // `forReplyCheck` is set only by the audit input and the repair packet. It adds the older turns that hold the person's highest earlier
    // self-directed-risk reading, the first turn at that level and the first reading to targeted_older_evidence; every other caller gets
    // the context without them.
    async loadCaseContext(caseId, { candidateId = "current_pending", episodePolicy = {}, evidenceQuery = null, journalContinuitySupported = false, forReplyCheck = false } = {}) {
      const record = await readRequired(caseId);
      const transcript = effectiveTranscript(record);
      const context = buildDurableCaseContext({
        caseId,
        caseState: record.case_state,
        transcriptEntries: transcript,
        trackerEntries: record.tracker_entries,
        forReplyCheck: forReplyCheck === true
      });
      const candidate = selectContinuationCandidate(record, candidateId);
      const deliveryCompletion = candidateDeliveryCompletion(record, candidate);
      const historicalDelivery = candidate == null ? resolveHistoricalDeliveryCheckpoint(record) : null;
      const recent = Object.keys(episodePolicy).length
        ? selectRecentVerbatimWindow(transcript, {
            currentEpisodeId: episodePolicy.currentEpisodeId ?? record.case_state.current_episode?.id ?? null,
            currentEpisodeStartTurnId: episodePolicy.currentEpisodeStartTurnId ?? record.case_state.current_episode?.started_turn_id ?? null,
            maximumSelectedTurns: episodePolicy.maximumSelectedTurns ?? CONTEXT_WINDOW_LIMITS.selected_turns,
            requireCompleteEpisode: episodePolicy.requireCompleteEpisode !== false
          })
        : context.recent_verbatim_window;
      let queriedEvidence = null;
      if (evidenceQuery) {
        const { query = null, provenanceIds = [], timeRange = null, limit = 24 } = evidenceQuery;
        queriedEvidence = selectEvidence(record, { query, provenanceIds, timeRange, limit });
      }
      return Object.freeze({
        schema_version: 1,
        case_id: caseId,
        constitution_ref: structuredClone(context.constitution_ref),
        case_state: structuredClone(record.case_state),
        last_state_diff: structuredClone(lastTurnDiff(record)),
        recent_verbatim: structuredClone(recent),
        transcript_amendments: structuredClone(record.transcript_amendments),
        candidate_response: candidate ? structuredClone(candidate) : null,
        delivery_completion: deliveryCompletion ? structuredClone(deliveryCompletion) : null,
        historical_delivery_completion: historicalDelivery ? structuredClone(historicalDelivery) : null,
        communication_projection: projectCommunicationState(record),
        source_artifact_refs: record.source_artifacts.map((artifact) => ({
          id: artifact.id,
          version: artifact.version,
          created_at: artifact.created_at,
          metadata: structuredClone(artifact.metadata)
        })),
        targeted_older_evidence: structuredClone(context.targeted_older_evidence),
        queried_evidence: queriedEvidence,
        current_episode: structuredClone(record.case_state.current_episode),
        // Whole-case count for the trajectory digest; the window above holds only the current episode's turns.
        user_turn_count: transcript.filter((turn) => turn.role === "user").length,
        tracker_window: structuredClone(context.tracker_window),
        journal_continuity: createJournalContinuityProjection(record.journal_corpora, {
          consumerCapabilitySupported: journalContinuitySupported
        }),
        hidden_reasoning_included: false
      });
    },
    // A handoff of the case, from one reading of its record to the last file written (the envelope, its locator and the
    // locators of the drafts it carries), in one turn of the case's queue: a deletion either finds all of it and removes it,
    // or comes first, and then the case is gone and no handoff is made. None can be written after a deletion returned.
    async createHandoff(caseId, options = {}) {
      return coordinator.run(safeCaseId(caseId), () => createHandoffInQueue(caseId, options));
    },
    async loadHandoff(caseId, handoffId) {
      const value = await readHandoffArtifactWithEnvelope(handoffId, safeCaseId(caseId));
      if (!value) throw new ValidationError(`Private handoff ${handoffId} was not found.`, { code: "PRIVATE_HANDOFF_NOT_FOUND" });
      return Object.freeze({
        ...cloneValue(value.packet),
        artifact_manifest: {
          utf8_bytes: value.artifact.utf8_bytes,
          sha256: value.artifact.sha256,
          chunks: cloneValue(value.artifact.chunks)
        },
        encrypted_round_trip_verified: true
      });
    },
    async exportHandoff(caseId, handoffId) {
      const value = await readHandoffArtifactWithEnvelope(handoffId, safeCaseId(caseId));
      if (!value) throw new ValidationError(`Private handoff ${handoffId} was not found.`, { code: "PRIVATE_HANDOFF_NOT_FOUND" });
      const body = Buffer.from(`${JSON.stringify(serializeVaultEnvelope(value.envelope))}\n`, "utf8");
      if (body.byteLength > PRIVATE_RECORD_LIMITS.handoff_export_bytes) {
        body.fill(0);
        throw new ValidationError("Encrypted private handoff export exceeds the portable-export limit.");
      }
      return body;
    },
    // Bind an alias to the case. The alias file names the case, so it is written in the case's queue, like every file that does:
    // a deletion finds it, and none is written for a case after its deletion returned.
    async bindCaseAlias(caseId, caseAlias) {
      const id = safeCaseId(caseId);
      return coordinator.run(id, async () => {
        ensureOpen();
        if (!(await readExisting(id))) throw new RuntimeError("Private case was not found.", { code: "PRIVATE_CASE_NOT_FOUND" });
        await writePrivateCaseAliasLocator({ rootDir, alias: caseAlias, caseId: id });
        return Object.freeze({ case_id: id, alias_bound: true });
      });
    },
    // Delete one case from this vault (the runner trial page's "Delete this case"; docs/superpowers/specs/2026-11-21-runner-trial-
    // design.md, section 6): its encrypted case file, the handoff envelopes its locators name (each first opened with this case's
    // key and confirmed to be this case's), the folders of the journal corpora its record names, and the locator and alias files
    // that name it. Only paths proven to be this case's are touched: a handoff that can't be opened and confirmed is kept, with
    // its locator, and reported. Inside the case's mutation queue, which every write of the case and of a file naming it takes, so
    // nothing writes the case or such a file meanwhile; the caller also holds the turn controller's queue, so no turn of the case
    // is running. Run again after an interruption, it finishes the job.
    async deletePrivateCase(caseId) {
      return deleteCaseInQueue(caseId);
    },
    async getHandoffTrackerWindow(caseId, handoffId, options = {}) {
      const value = await readHandoffArtifactWithEnvelope(handoffId, safeCaseId(caseId));
      if (!value) throw new ValidationError(`Private handoff ${handoffId} was not found.`, { code: "PRIVATE_HANDOFF_NOT_FOUND" });
      return selectTrackerEntries(value.packet.tracker_entries, options);
    },
    async getHandoffJournalEntries(caseId, handoffId, options = {}) {
      const value = await readHandoffArtifactWithEnvelope(handoffId, safeCaseId(caseId));
      if (!value) throw new ValidationError(`Private handoff ${handoffId} was not found.`, { code: "PRIVATE_HANDOFF_NOT_FOUND" });
      return selectJournalEntries(value.packet.journal_entries, options);
    },
    async appendTracker(caseId, entry) {
      return mutate(caseId, (record) => {
        record.tracker_entries = appendTrackerEntry(record.tracker_entries, entry);
        return record;
      });
    },
    async appendJournal(caseId, entry) {
      return mutate(caseId, (record) => {
        const validated = validateJournalEntry(entry, record.journal_entries.length);
        if (record.journal_entries.some((item) => item.id === validated.id)) throw new ValidationError(`Duplicate journal entry ${validated.id}.`);
        record.journal_entries.push(structuredClone(validated));
        return record;
      });
    },
    close() {
      if (!closed) {
        routineKey.fill(0);
        recoverySecret?.fill(0);
        closed = true;
      }
    }
  });

  async function createHandoffInQueue(caseId, {
    handoffId = createHandoffId(),
    runtimeVersion = RUNTIME_VERSION,
    auditVersion = PRIVATE_CANDIDATE_AUDIT_VERSION
  } = {}) {
    const record = await readRequired(caseId);
    const transcript = effectiveTranscript(record);
    const durableContext = buildDurableCaseContext({
      caseId,
      caseState: record.case_state,
      transcriptEntries: transcript,
      trackerEntries: record.tracker_entries
    });
    const recentVerbatim = selectRecentVerbatimWindow(transcript, {
      currentEpisodeId: record.case_state.current_episode?.id ?? null,
      currentEpisodeStartTurnId: record.case_state.current_episode?.started_turn_id ?? null,
      maximumSelectedTurns: CONTEXT_WINDOW_LIMITS.transcript_entries,
      requireCompleteEpisode: true
    });
    const candidate = selectContinuationCandidate(record, "current_pending");
    const deliveryCompletion = candidateDeliveryCompletion(record, candidate);
    const historicalDelivery = candidate == null ? resolveHistoricalDeliveryCheckpoint(record) : null;
    const context = {
      case_state: record.case_state,
      last_state_diff: lastTurnDiff(record),
      current_episode: record.case_state.current_episode,
      constitution_ref: durableContext.constitution_ref,
      candidate_response: candidate,
      delivery_completion: deliveryCompletion,
      historical_delivery_completion: historicalDelivery,
      recent_verbatim: recentVerbatim,
      source_artifact_refs: record.source_artifacts.map((artifact) => ({ id: artifact.id })),
      targeted_older_evidence: durableContext.targeted_older_evidence,
      journal_continuity: createJournalContinuityProjection(record.journal_corpora, {
        consumerCapabilitySupported: true
      })
    };
    const continuationSafety = assessContinuationSafety(context);
    const createdAt = now();
    const { artifact, packet } = compilePrivateHandoffArtifact({
      handoffId,
      record,
      recentVerbatim,
      continuationSafety,
      historicalDelivery,
      runtimeVersion,
      auditVersion,
      createdAt
    });
    const file = handoffFileFor(handoffId);
    if (await fs.access(file).then(() => true).catch((error) => error?.code === "ENOENT" ? false : Promise.reject(error))) {
      throw new ValidationError(`Private handoff ${handoffId} already exists and is immutable.`);
    }
    if (!recoverySecret) throw new ValidationError("Recovery secret is required when creating a private handoff envelope.");
    const plaintext = Buffer.from(JSON.stringify(artifact), "utf8");
    try {
      const envelope = await createVaultEnvelope({ plaintextBytes: plaintext, routineKek: routineKey, recoverySecretBytes: recoverySecret });
      await fs.mkdir(handoffDirectory, { recursive: true, mode: 0o700 });
      await fs.chmod(handoffDirectory, 0o700);
      await durableEncryptedWrite(file, envelope);
    } finally { plaintext.fill(0); }
    await writePrivateArtifactLocator({ rootDir, kind: "handoff", artifactId: handoffId, caseId });
    for (const pending of packet.pending_artifacts) {
      await writePrivateArtifactLocator({ rootDir, kind: "candidate", artifactId: pending.id, caseId });
    }
    const reopened = await readHandoffArtifactWithEnvelope(handoffId, caseId);
    if (!reopened || reopened.artifact.exact_text !== artifact.exact_text) throw new ValidationError("Private handoff encrypted round-trip verification failed.");
    return Object.freeze({
      handoff_id: handoffId,
      case_id: caseId,
      candidate_ids: packet.pending_artifacts.map((entry) => entry.id),
      handoff_status: packet.handoff_status,
      local_round_trip_verified: true,
      fresh_session_status: "PENDING_FRESH_SESSION",
      encrypted_export_available: true,
      continuation_safety: cloneValue(packet.continuation_safety)
    });
  }

  // The deletion's steps, in the case's queue (deletePrivateCase above).
  async function deleteCaseInQueue(caseId) {
    const id = safeCaseId(caseId);
    return coordinator.run(id, async () => {
      ensureOpen();
      // A case file that is there but can't be opened with this case's key stops the deletion before anything is removed.
      const existing = await readExistingWithEnvelope(id);
      const locators = await listPrivateArtifactLocatorsForCase({ rootDir, caseId: id });
      const keptHandoffs = [];
      let handoffsRemoved = 0;
      for (const locator of locators.filter((entry) => entry.kind === "handoff")) {
        let opened;
        try { opened = await readHandoffArtifactWithEnvelope(locator.artifactId, id); }
        catch { keptHandoffs.push(locator.artifactId); continue; }
        if (opened && await removeFile(handoffFileFor(locator.artifactId))) handoffsRemoved += 1;
      }
      let journalCorporaRemoved = 0;
      for (const reference of existing?.record.journal_corpora ?? []) {
        const directory = privateJournalCorpusDirectory({ rootDir, caseId: id, corpusId: reference.corpus_id });
        const info = await fs.lstat(directory).catch((error) => (error?.code === "ENOENT" ? null : Promise.reject(error)));
        if (!info?.isDirectory()) continue;
        await fs.rm(directory, { recursive: true });
        journalCorporaRemoved += 1;
      }
      const caseFileRemoved = await removeFile(fileFor(id));
      await removeFile(`${fileFor(id)}.tmp`);
      let locatorFilesRemoved = 0;
      for (const locator of locators) {
        if (locator.kind === "handoff" && keptHandoffs.includes(locator.artifactId)) continue;
        if (await removeFile(locator.file)) locatorFilesRemoved += 1;
      }
      let aliasFilesRemoved = 0;
      for (const alias of await listPrivateCaseAliasLocatorsForCase({ rootDir, caseId: id })) {
        if (await removeFile(alias.file)) aliasFilesRemoved += 1;
      }
      for (const directory of [rootDir, handoffDirectory, path.join(rootDir, ".artifact-locators"), path.join(rootDir, ".case-alias-locators"), path.join(rootDir, ".journal-corpora")]) {
        await syncDirectory(directory);
      }
      return Object.freeze({
        case_id: id,
        case_file_removed: caseFileRemoved,
        handoffs_removed: handoffsRemoved,
        journal_corpora_removed: journalCorporaRemoved,
        locator_files_removed: locatorFilesRemoved,
        alias_locator_files_removed: aliasFilesRemoved,
        handoffs_kept: Object.freeze([...keptHandoffs])
      });
    });
  }
}
