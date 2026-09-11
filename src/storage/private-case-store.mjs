import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { createEmptyCaseState, validateCaseState } from "../case-state/longitudinal-state.mjs";
import { appendTrackerEntry, summarizeTrackerWindow, validateTrackerEntry } from "../case-state/tracker.mjs";
import { buildDurableCaseContext, CONTEXT_WINDOW_LIMITS, selectRecentVerbatimWindow, validateTranscriptEntries } from "../case-state/context-window.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "../supervisor/private-candidate-audit.mjs";
import {
  MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES,
  PRIVATE_CANDIDATE_STATUSES,
  candidateDeliveryGate,
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
  sha256ExactText,
  validatePrivateRuntimeTurn
} from "../supervisor/private-runtime-turn-lifecycle.mjs";
import { createVaultEnvelope, replaceVaultPayloadWithRoutineKek } from "./vault-crypto.mjs";
import { openVaultWithDevelopmentAuthorization, openVaultWithManagedSecretAuthorization, openVaultWithRoutineAuthorization } from "./vault-routine-access.mjs";
import { chunkExactSourceText, createExactSourceArtifact, EXACT_SOURCE_LIMITS, validateExactSourceArtifact } from "./exact-source-artifact.mjs";
import { assessContinuationSafety } from "./private-case-continuity.mjs";
import { compilePrivateHandoffArtifact, createHandoffId, openPrivateHandoffArtifact, validateHandoffId } from "./private-case-handoff.mjs";
import { writePrivateArtifactLocator } from "./private-artifact-locator.mjs";
import {
  TRANSCRIPT_AMENDMENT_LIMITS,
  applyTranscriptAmendments,
  createTranscriptCompletionAmendment,
  validateTranscriptAmendments
} from "./transcript-amendments.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ENVELOPE_FORMAT = "inner-signal-private-case-envelope-v1";
const RECORD_VERSION = 6;
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
    migrated.schema_version = RECORD_VERSION;
    migrated.runtime_turns = [];
  }
  return migrated;
}

export function validatePrivateCaseRecord(value) {
  value = normalizePrivateCaseRecord(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Private case record must be an object.");
  if (value.schema_version !== RECORD_VERSION) throw new ValidationError("Private case record version is invalid.");
  safeCaseId(value.case_id);
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
      }
    }
  }
  return value;
}

function newRecord(caseId, now) {
  return {
    schema_version: RECORD_VERSION,
    case_id: caseId,
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
    source_artifacts: []
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
    if (after.audit_history.length < before.audit_history.length
        || before.audit_history.some((audit, auditIndex) => JSON.stringify(audit) !== JSON.stringify(after.audit_history[auditIndex]))) {
      throw new ValidationError("Candidate audit records are append-only and immutable.");
    }
  }
  if (next.runtime_turns.length < previous.runtime_turns.length) throw new ValidationError("Private runtime turns are append-only.");
  for (let index = 0; index < previous.runtime_turns.length; index += 1) {
    const before = previous.runtime_turns[index];
    const after = next.runtime_turns[index];
    for (const field of ["id", "exchange_id", "user_turn_id", "inbound", "created_at"]) {
      if (!after || JSON.stringify(before[field]) !== JSON.stringify(after[field])) throw new ValidationError("Private runtime turn identities are immutable.");
    }
    if (after.events.length < before.events.length || before.events.some((event, eventIndex) => JSON.stringify(event) !== JSON.stringify(after.events[eventIndex]))) {
      throw new ValidationError("Private runtime turn events are append-only and immutable.");
    }
    if (before.discriminator != null && JSON.stringify(before.discriminator) !== JSON.stringify(after.discriminator)) throw new ValidationError("Private runtime discriminator is immutable.");
    if (before.delivery != null && JSON.stringify(before.delivery) !== JSON.stringify(after.delivery)) throw new ValidationError("Private runtime delivery is immutable.");
  }
  if (next.source_artifacts.length < previous.source_artifacts.length) throw new ValidationError("Exact source artifacts are append-only.");
  for (let index = 0; index < previous.source_artifacts.length; index += 1) {
    if (JSON.stringify(previous.source_artifacts[index]) !== JSON.stringify(next.source_artifacts[index])) throw new ValidationError("Exact source artifacts are immutable and cannot be rewritten.");
  }
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

export function createEncryptedPrivateCaseStore({
  rootDir,
  routineKek,
  recoverySecretBytes,
  osBackedReauthenticated = false,
  managedSecretAuthorized = false,
  developmentExternalCredentialAuthorized = false,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private storage path.");
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
  const caseMutationTails = new Map();

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
    const plaintext = Buffer.from(JSON.stringify(candidate), "utf8");
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
  const mutate = async (caseId, operation) => {
    const id = safeCaseId(caseId);
    const previousTail = caseMutationTails.get(id) ?? Promise.resolve();
    let release;
    const currentTail = new Promise((resolve) => { release = resolve; });
    caseMutationTails.set(id, currentTail);
    await previousTail;
    try {
      const existing = await readExistingWithEnvelope(id);
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
      if (next === null) return structuredClone(previous);
      next.updated_at = now();
      return write(id, next, previous, currentEnvelope);
    } finally {
      release();
      if (caseMutationTails.get(id) === currentTail) caseMutationTails.delete(id);
    }
  };
  const readRequired = async (caseId) => {
    const record = await readExisting(safeCaseId(caseId));
    if (!record) throw new ValidationError(`Private case ${caseId} was not found.`, { code: "PRIVATE_CASE_NOT_FOUND" });
    return record;
  };
  const appendDiff = (record, diff, { turnId = "unknown-turn", diffId = null, recordedAt = now() } = {}) => {
    if (!diff || typeof diff !== "object" || Array.isArray(diff)) throw new ValidationError("stateDiff must be an object.");
    const entry = {
      id: diffId ?? `diff-${record.state_diff_history.length + 1}`,
      turn_id: turnId,
      recorded_at: recordedAt,
      diff: structuredClone(diff)
    };
    validateStateDiffEntry(entry, record.state_diff_history.length);
    if (record.state_diff_history.some((candidate) => candidate.id === entry.id)) throw new ValidationError(`Duplicate state diff ${entry.id}.`);
    record.state_diff_history.push(entry);
    record.last_state_diff = structuredClone(diff);
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

  return Object.freeze({
    format: ENVELOPE_FORMAT,
    rootDir,
    async load(caseId) { const value = await readExisting(safeCaseId(caseId)); return value ? structuredClone(value) : null; },
    loadOrCreate,
    async beginPrivateRuntimeTurn(caseId, { runtimeTurnId, exchangeId, userTurnId, exactText }) {
      return mutate(caseId, (record) => {
        const existing = record.runtime_turns.find((entry) => entry.id === runtimeTurnId);
        if (existing) {
          if (!sameJson([existing.exchange_id, existing.user_turn_id, existing.inbound.exact_text], [exchangeId, userTurnId, exactText])) {
            throw new ValidationError(`Private runtime turn ${runtimeTurnId} conflicts with an existing immutable inbound record.`);
          }
          return null;
        }
        const unfinished = record.runtime_turns.find((entry) => entry.state !== "DELIVERED");
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
      eventId
    }) {
      const record = await mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        const existing = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (existing) {
          if (!sameJson(
            [existing.exact_text, existing.producer_context_id, existing.parent_candidate_id, existing.metadata.runtime_turn_id],
            [exactText, producerContextId, parentCandidateId, runtimeTurnId]
          )) throw new ValidationError(`Candidate response ${candidateId} conflicts with immutable bytes or provenance.`);
          if (runtimeTurn.current_candidate_id === candidateId && runtimeTurn.state === "CANDIDATE_PENDING_AUDIT") return null;
          throw new ValidationError(`Candidate response ${candidateId} exists outside the expected runtime frontier.`);
        }
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate runtime metadata must be an object.");
        const timestamp = now();
        let candidate;
        if (parentCandidateId == null) {
          if (runtimeTurn.state !== "RECEIVED" || runtimeTurn.repair_cycle !== 0) throw new ValidationError("Original runtime candidate requires RECEIVED state.");
          if (typeof producerContextId !== "string" || !producerContextId.trim()) throw new ValidationError("A runtime candidate producer context is required.");
          const state = validateCaseState(structuredClone(caseState));
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
      });
      await writePrivateArtifactLocator({ rootDir, kind: "candidate", artifactId: candidateId, caseId });
      return record;
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
        const audit = structuredClone(validateCandidateAuditEvidence(evidence, candidate));
        const sealedAttempt = [...runtimeTurn.events].reverse().find((entry) => entry.event_type === "INVOCATION_COMPLETED"
          && entry.stage === "audit" && entry.details?.actual_context_id === audit.auditor_context_id);
        if (!sealedAttempt) throw new ValidationError("Runtime audit context is not backed by a sealed controller invocation.");
        if (candidate.audit_history.some((entry) => entry.id === audit.id)) throw new ValidationError(`Candidate audit ${audit.id} already exists.`);
        candidate.audit_history.push(audit);
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
      });
    },
    async savePrivateRuntimeDiscriminator(caseId, runtimeTurnId, { exactText, producerContextId }) {
      return mutate(caseId, (record) => {
        const runtimeTurn = runtimeTurnIn(record, runtimeTurnId);
        if (runtimeTurn.state !== "DISCRIMINATING_QUESTION_REQUIRED") throw new ValidationError("Runtime discriminator requires its explicit terminal-uncertainty state.");
        const discriminator = createPrivateRuntimeDiscriminator({ exactText, producerContextId, createdAt: now() });
        if (runtimeTurn.discriminator) {
          if (!sameJson(runtimeTurn.discriminator, discriminator)) throw new ValidationError("Private runtime discriminator conflicts with immutable bytes.");
          return null;
        }
        const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
        const forbiddenContexts = new Set([candidate?.producer_context_id, ...(candidate?.audit_history ?? []).map((entry) => entry.auditor_context_id)]);
        const sealedAttempt = [...runtimeTurn.events].reverse().find((entry) => entry.event_type === "INVOCATION_COMPLETED"
          && entry.stage === "discriminator" && entry.details?.actual_context_id === producerContextId);
        if (!sealedAttempt || forbiddenContexts.has(producerContextId)) throw new ValidationError("Runtime discriminator requires a separate sealed producer context.");
        runtimeTurn.discriminator = structuredClone(discriminator);
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
        if (record.raw_transcript.some((entry) => entry.id === assistantTurnId)) throw new ValidationError("Runtime assistant turn identifier already exists.");
        const timestamp = now();
        record.raw_transcript.push({ id: assistantTurnId, exchange_id: runtimeTurn.exchange_id, role: "assistant", text: candidate.exact_text, at: timestamp, episode_id: record.case_state.current_episode?.id ?? null });
        candidate.status = "sent";
        candidate.updated_at = timestamp;
        candidate.metadata = { ...candidate.metadata, sent_with_audit_id: gate.audit_id };
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
          if (runtimeTurn.delivery?.kind === "discriminator" && runtimeTurn.assistant_turn_id === assistantTurnId) return null;
          throw new ValidationError("Private runtime delivery conflicts with an existing immutable delivery.");
        }
        if (runtimeTurn.state !== "DISCRIMINATING_QUESTION_REQUIRED" || !runtimeTurn.discriminator) throw new ValidationError("Runtime discriminator delivery is not ready.");
        if (record.raw_transcript.some((entry) => entry.id === assistantTurnId)) throw new ValidationError("Runtime assistant turn identifier already exists.");
        const candidate = record.candidate_responses.find((entry) => entry.id === runtimeTurn.current_candidate_id);
        if (!candidate || candidate.status !== "audit_failed" || candidate.repair_cycle !== MAX_PRIVATE_CANDIDATE_REPAIR_CYCLES) throw new ValidationError("Runtime discriminator requires the exact final failed candidate.");
        const timestamp = now();
        record.raw_transcript.push({ id: assistantTurnId, exchange_id: runtimeTurn.exchange_id, role: "assistant", text: runtimeTurn.discriminator.exact_text, at: timestamp, episode_id: record.case_state.current_episode?.id ?? null });
        candidate.metadata = { ...candidate.metadata, superseded_from_status: candidate.status, superseded_by_discriminator_runtime_turn_id: runtimeTurn.id };
        candidate.status = "superseded";
        candidate.updated_at = timestamp;
        const delivery = {
          kind: "discriminator",
          assistant_turn_id: assistantTurnId,
          exact_text: runtimeTurn.discriminator.exact_text,
          sha256: runtimeTurn.discriminator.sha256,
          delivered_at: timestamp
        };
        const updatedRuntime = appendPrivateRuntimeTransition(runtimeTurn, {
          eventId,
          toState: "DELIVERED",
          at: timestamp,
          details: { kind: "discriminator" },
          projectionPatch: { assistant_turn_id: assistantTurnId, delivery }
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
        record.case_state = validateCaseState(structuredClone(case_state));
        if (state_diff != null) appendDiff(record, state_diff, {
          turnId: diff_turn_id ?? additions.find((turn) => turn.role === "user")?.id ?? additions.at(-1)?.id ?? "unknown-turn",
          diffId: diff_id
        });
        return record;
      });
    },
    async saveCaseState(caseId, caseState) {
      return mutate(caseId, (record) => {
        const state = validateCaseState(structuredClone(caseState));
        if (state.case_id !== caseId) throw new ValidationError("Case state identity mismatch.");
        record.case_state = state;
        return record;
      });
    },
    async getCaseState(caseId) { return structuredClone((await readRequired(caseId)).case_state); },
    async saveCaseDiff(caseId, stateDiff, options = {}) {
      return mutate(caseId, (record) => {
        appendDiff(record, stateDiff, options);
        return record;
      });
    },
    async getCaseDiff(caseId, { turnId = null, diffId = null } = {}) {
      const record = await readRequired(caseId);
      if (!turnId && !diffId) return record.state_diff_history.length ? structuredClone(record.state_diff_history.at(-1)) : null;
      const found = [...record.state_diff_history].reverse().find((entry) => (diffId ? entry.id === diffId : entry.turn_id === turnId));
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
      const record = await mutate(caseId, (record) => {
        if (typeof candidateId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(candidateId)) throw new ValidationError("candidateId is invalid.");
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate response metadata must be an object.");
        if (record.candidate_responses.some((candidate) => candidate.id === candidateId)) throw new ValidationError(`Candidate response ${candidateId} already exists and exact bytes are immutable.`);
        if ((metadata.status ?? "pending_audit") !== "pending_audit") throw new ValidationError("A new original candidate must begin pending_audit.");
        const activeCandidate = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (activeCandidate?.status === "audit_failed") throw new ValidationError("An audit-failed candidate must be repaired through reconstruction so its lineage and repair cycle cannot be bypassed.");
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
        return record;
      });
      await writePrivateArtifactLocator({ rootDir, kind: "candidate", artifactId: candidateId, caseId });
      return record;
    },
    async updateCandidateStatus(caseId, candidateId, status, metadataPatch = {}) {
      return mutate(caseId, (record) => {
        if (status !== "superseded") throw new ValidationError("Candidate audit, approval, and delivery statuses are managed by the binding lifecycle gates.");
        if (!metadataPatch || typeof metadataPatch !== "object" || Array.isArray(metadataPatch)) throw new ValidationError("Candidate response metadata patch must be an object.");
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
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (!candidate) throw new ValidationError(`Candidate response ${candidateId} was not found.`, { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (current?.id !== candidateId || !["pending_audit", "reconstructed_pending_audit"].includes(candidate.status)) {
          throw new ValidationError("Only the exact current pending candidate version can receive new audit evidence.");
        }
        const audit = structuredClone(validateCandidateAuditEvidence(evidence, candidate));
        if (record.candidate_responses.some((entry) => entry.audit_history.some((prior) => prior.id === audit.id))) throw new ValidationError(`Candidate audit ${audit.id} already exists.`);
        candidate.audit_history.push(audit);
        if (audit.verdict === "fail") candidate.status = "audit_failed";
        else if (audit.sufficient_for_approval) candidate.status = "audited";
        candidate.updated_at = now();
        validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
        return record;
      });
    },
    async reconstructCandidateResponse(caseId, parentCandidateId, candidateId, exactText, metadata = {}) {
      const record = await mutate(caseId, (record) => {
        if (typeof candidateId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(candidateId)) throw new ValidationError("candidateId is invalid.");
        if (record.candidate_responses.some((candidate) => candidate.id === candidateId)) throw new ValidationError(`Candidate response ${candidateId} already exists and exact bytes are immutable.`);
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate reconstruction metadata must be an object.");
        const parent = record.candidate_responses.find((entry) => entry.id === parentCandidateId);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (!parent || current?.id !== parentCandidateId) throw new ValidationError("Reconstruction must name the exact current candidate as its parent.");
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
            based_on_audit_id: sourceAudit.id,
            substantive_reconstruction: true
          }
        };
        validateCandidateResponse(candidate, record.candidate_responses.length);
        parent.metadata = { ...parent.metadata, superseded_from_status: parent.status, superseded_by_candidate_id: candidateId };
        parent.status = "superseded";
        parent.updated_at = timestamp;
        record.candidate_responses.push(candidate);
        return record;
      });
      await writePrivateArtifactLocator({ rootDir, kind: "candidate", artifactId: candidateId, caseId });
      return record;
    },
    async approveCandidateForDelivery(caseId, candidateId, auditId) {
      return mutate(caseId, (record) => {
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (!candidate || current?.id !== candidateId) throw new ValidationError("Delivery approval must target the exact current candidate version.");
        if (candidate.status !== "audited") throw new ValidationError("Candidate must pass a fresh independent audit before delivery approval.");
        const audit = candidate.audit_history.find((entry) => entry.id === auditId);
        if (!audit?.sufficient_for_approval || audit.candidate_id !== candidate.id || audit.candidate_version !== candidate.version) {
          throw new ValidationError("Delivery approval audit does not certify the exact current candidate ID/version.");
        }
        candidate.status = "approved_for_delivery";
        candidate.updated_at = now();
        candidate.metadata = { ...candidate.metadata, approval_audit_id: audit.id };
        validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
        return record;
      });
    },
    async markCandidateSent(caseId, candidateId) {
      return mutate(caseId, (record) => {
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        const current = [...record.candidate_responses].reverse().find(isActivePrivateCandidate);
        if (!candidate || current?.id !== candidateId) throw new ValidationError("Delivery must target the exact current candidate version.");
        const gate = candidateDeliveryGate(candidate);
        if (!gate.delivery_allowed) throw new ValidationError(`Candidate delivery is blocked: ${gate.reason}`, { code: "PRIVATE_CANDIDATE_DELIVERY_BLOCKED" });
        candidate.status = "sent";
        candidate.updated_at = now();
        candidate.metadata = { ...candidate.metadata, sent_with_audit_id: gate.audit_id };
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
      return projectCandidateLifecycle(record.candidate_responses);
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
    async getCurrentEpisode(caseId) { return structuredClone((await readRequired(caseId)).case_state.current_episode); },
    async loadCaseContext(caseId, { candidateId = "current_pending", episodePolicy = {}, evidenceQuery = null } = {}) {
      const record = await readRequired(caseId);
      const transcript = effectiveTranscript(record);
      const context = buildDurableCaseContext({
        caseId,
        caseState: record.case_state,
        transcriptEntries: transcript,
        trackerEntries: record.tracker_entries
      });
      const candidate = candidateId === "current_pending"
        ? [...record.candidate_responses].reverse().find((entry) => ["pending_audit", "reconstructed_pending_audit"].includes(entry.status))
        : record.candidate_responses.find((entry) => entry.id === candidateId);
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
        last_state_diff: record.state_diff_history.length ? structuredClone(record.state_diff_history.at(-1)) : null,
        recent_verbatim: structuredClone(recent),
        transcript_amendments: structuredClone(record.transcript_amendments),
        candidate_response: candidate ? structuredClone(candidate) : null,
        source_artifact_refs: record.source_artifacts.map((artifact) => ({
          id: artifact.id,
          version: artifact.version,
          created_at: artifact.created_at,
          metadata: structuredClone(artifact.metadata)
        })),
        targeted_older_evidence: structuredClone(context.targeted_older_evidence),
        queried_evidence: queriedEvidence,
        current_episode: structuredClone(record.case_state.current_episode),
        tracker_window: structuredClone(context.tracker_window),
        hidden_reasoning_included: false
      });
    },
    async createHandoff(caseId, {
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
      const activeCandidate = [...record.candidate_responses].reverse().find(isActivePrivateCandidate) ?? null;
      const candidate = activeCandidate ?? (record.candidate_responses.at(-1)?.status === "sent" ? record.candidate_responses.at(-1) : null);
      const sentTurn = candidate?.status === "sent"
        ? record.raw_transcript.find((turn) => turn.id === candidate.metadata.sent_turn_id)
        : null;
      const deliveryCompletion = sentTurn?.role === "assistant" && sentTurn.text === candidate.exact_text
          && candidate.metadata.sent_with_audit_id && candidate.metadata.sent_in_reply_to_turn_id
        ? {
        candidate_id: candidate.id,
        candidate_version: candidate.version
        } : null;
      const context = {
        case_state: record.case_state,
        last_state_diff: record.state_diff_history.at(-1) ?? null,
        current_episode: record.case_state.current_episode,
        constitution_ref: durableContext.constitution_ref,
        candidate_response: candidate,
        delivery_completion: deliveryCompletion,
        recent_verbatim: recentVerbatim,
        source_artifact_refs: record.source_artifacts.map((artifact) => ({ id: artifact.id })),
        targeted_older_evidence: durableContext.targeted_older_evidence
      };
      const continuationSafety = assessContinuationSafety(context);
      const createdAt = now();
      const { artifact, packet } = compilePrivateHandoffArtifact({
        handoffId,
        record,
        recentVerbatim,
        continuationSafety,
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
}
