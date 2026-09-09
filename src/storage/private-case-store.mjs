import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { createEmptyCaseState, validateCaseState } from "../case-state/longitudinal-state.mjs";
import { appendTrackerEntry, summarizeTrackerWindow, validateTrackerEntry } from "../case-state/tracker.mjs";
import { buildDurableCaseContext, CONTEXT_WINDOW_LIMITS, selectRecentVerbatimWindow, validateTranscriptEntries } from "../case-state/context-window.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { PRIVATE_CANDIDATE_AUDIT_VERSION } from "../supervisor/private-candidate-audit.mjs";
import { createVaultEnvelope, replaceVaultPayloadWithRoutineKek } from "./vault-crypto.mjs";
import { openVaultWithDevelopmentAuthorization, openVaultWithRoutineAuthorization } from "./vault-routine-access.mjs";
import { createExactSourceArtifact, EXACT_SOURCE_LIMITS, validateExactSourceArtifact } from "./exact-source-artifact.mjs";
import { assessContinuationSafety } from "./private-case-continuity.mjs";
import { compilePrivateHandoffArtifact, createHandoffId, openPrivateHandoffArtifact, validateHandoffId } from "./private-case-handoff.mjs";
import { writePrivateArtifactLocator } from "./private-artifact-locator.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ENVELOPE_FORMAT = "inner-signal-private-case-envelope-v1";
const RECORD_VERSION = 3;
const CANDIDATE_STATUSES = Object.freeze(["pending_audit", "audited", "superseded", "sent"]);
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
  candidates: 2_000,
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
  if (!CANDIDATE_STATUSES.includes(value.status)) throw new ValidationError(`candidate_responses[${index}].status is invalid.`);
  if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata)) throw new ValidationError(`candidate_responses[${index}].metadata must be an object.`);
  let metadataBytes;
  try { metadataBytes = Buffer.byteLength(JSON.stringify(value.metadata), "utf8"); }
  catch { throw new ValidationError(`candidate_responses[${index}].metadata must be JSON serializable.`); }
  if (metadataBytes > PRIVATE_RECORD_LIMITS.candidate_metadata_bytes) throw new ValidationError(`candidate_responses[${index}].metadata exceeds the bounded limit.`);
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
    migrated.schema_version = RECORD_VERSION;
    migrated.source_artifacts = [];
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
  });
  if (value.candidate_responses.filter((candidate) => candidate.status === "pending_audit").length > 1) {
    throw new ValidationError("Private case record may contain only one pending candidate response.");
  }
  if (!Array.isArray(value.source_artifacts) || value.source_artifacts.length > PRIVATE_RECORD_LIMITS.source_artifacts) throw new ValidationError("source_artifacts exceeds the private-record limit or is invalid.");
  const sourceArtifactIds = new Set();
  value.source_artifacts.forEach((artifact, index) => {
    validateExactSourceArtifact(artifact, index);
    if (sourceArtifactIds.has(artifact.id)) throw new ValidationError(`Duplicate source artifact ${artifact.id}.`);
    sourceArtifactIds.add(artifact.id);
  });
  return value;
}

function newRecord(caseId, now) {
  return {
    schema_version: RECORD_VERSION,
    case_id: caseId,
    created_at: now,
    updated_at: now,
    raw_transcript: [],
    case_state: createEmptyCaseState({ caseId }),
    tracker_entries: [],
    journal_entries: [],
    last_state_diff: null,
    state_diff_history: [],
    candidate_responses: [],
    source_artifacts: []
  };
}

function assertAppendOnly(previous, next) {
  if (next.raw_transcript.length < previous.raw_transcript.length) throw new ValidationError("Raw transcript is append-only.");
  for (let index = 0; index < previous.raw_transcript.length; index += 1) {
    if (JSON.stringify(previous.raw_transcript[index]) !== JSON.stringify(next.raw_transcript[index])) throw new ValidationError("Raw transcript is append-only and existing turns cannot be rewritten.");
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
  developmentExternalCredentialAuthorized = false,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private storage path.");
  if (osBackedReauthenticated !== true && developmentExternalCredentialAuthorized !== true) {
    throw new ValidationError("OS-backed reauthentication or an explicit development credential authorization is required before opening the private case store.");
  }
  if (osBackedReauthenticated === true && developmentExternalCredentialAuthorized === true) {
    throw new ValidationError("Private case access must use exactly one authorization assurance mode.");
  }
  const routineKey = bytes(routineKek, "routineKek");
  const recoverySecret = recoverySecretBytes == null ? null : bytes(recoverySecretBytes, "recoverySecretBytes");
  let closed = false;

  const ensureOpen = () => {
    if (closed) throw new ValidationError("Private case store is closed.");
  };

  const fileFor = (caseId) => path.join(rootDir, `${safeCaseId(caseId)}.vault.json`);
  const handoffDirectory = path.join(rootDir, ".handoffs");
  const handoffFileFor = (handoffId) => path.join(handoffDirectory, `${sha256Hex(validateHandoffId(handoffId))}.vault.json`);
  const openEnvelopePlaintext = async (envelope) => osBackedReauthenticated
    ? (await openVaultWithRoutineAuthorization({ osBackedReauthenticated: true, envelope, routineKek: routineKey })).plaintextBytes
    : (await openVaultWithDevelopmentAuthorization({ developmentExternalCredentialAuthorized: true, envelope, routineKek: routineKey })).plaintextBytes;
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
  const loadOrCreate = async (caseId) => {
    const id = safeCaseId(caseId);
    const existing = await readExisting(id);
    if (existing) return structuredClone(existing);
    const timestamp = now();
    return write(id, newRecord(id, timestamp));
  };
  const mutate = async (caseId, operation) => {
    const existing = await readExistingWithEnvelope(safeCaseId(caseId));
    let previous;
    let currentEnvelope = null;
    if (existing) {
      previous = structuredClone(existing.record);
      currentEnvelope = existing.envelope;
    } else {
      const timestamp = now();
      previous = await write(caseId, newRecord(caseId, timestamp));
      const created = await readExistingWithEnvelope(caseId);
      currentEnvelope = created.envelope;
    }
    const next = await operation(structuredClone(previous));
    next.updated_at = now();
    return write(caseId, next, previous, currentEnvelope);
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
    const matches = record.raw_transcript.filter((turn) => {
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
      source_artifacts: structuredClone(sourceArtifacts),
      truncated: matches.length > turns.length || artifactMatches.length > sourceArtifacts.length
    });
  };

  return Object.freeze({
    format: ENVELOPE_FORMAT,
    rootDir,
    async load(caseId) { const value = await readExisting(safeCaseId(caseId)); return value ? structuredClone(value) : null; },
    loadOrCreate,
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
    async getRecentVerbatim(caseId, episodePolicy = {}) {
      const record = await readRequired(caseId);
      return selectRecentVerbatimWindow(record.raw_transcript, {
        minimumCompleteExchanges: episodePolicy.minimumCompleteExchanges ?? 3,
        currentEpisodeId: episodePolicy.currentEpisodeId ?? record.case_state.current_episode?.id ?? null,
        maximumSelectedTurns: episodePolicy.maximumSelectedTurns ?? CONTEXT_WINDOW_LIMITS.selected_turns,
        requireCompleteEpisode: episodePolicy.requireCompleteEpisode === true
      });
    },
    async saveCandidateResponse(caseId, candidateId, exactText, metadata = {}) {
      const record = await mutate(caseId, (record) => {
        if (typeof candidateId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(candidateId)) throw new ValidationError("candidateId is invalid.");
        if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Candidate response metadata must be an object.");
        if (record.candidate_responses.some((candidate) => candidate.id === candidateId)) throw new ValidationError(`Candidate response ${candidateId} already exists and exact bytes are immutable.`);
        const timestamp = now();
        const candidate = {
          id: candidateId,
          version: record.candidate_responses.length + 1,
          exact_text: exactText,
          status: metadata.status ?? "pending_audit",
          created_at: timestamp,
          updated_at: timestamp,
          metadata: Object.fromEntries(Object.entries(structuredClone(metadata)).filter(([key]) => key !== "status"))
        };
        validateCandidateResponse(candidate, record.candidate_responses.length);
        if (candidate.status === "pending_audit") {
          for (const previousCandidate of record.candidate_responses.filter((entry) => entry.status === "pending_audit")) {
            previousCandidate.status = "superseded";
            previousCandidate.updated_at = timestamp;
            previousCandidate.metadata = { ...previousCandidate.metadata, superseded_by_candidate_id: candidateId };
          }
        }
        record.candidate_responses.push(candidate);
        return record;
      });
      await writePrivateArtifactLocator({ rootDir, kind: "candidate", artifactId: candidateId, caseId });
      return record;
    },
    async updateCandidateStatus(caseId, candidateId, status, metadataPatch = {}) {
      return mutate(caseId, (record) => {
        if (!CANDIDATE_STATUSES.includes(status)) throw new ValidationError("Candidate response status is invalid.");
        if (!metadataPatch || typeof metadataPatch !== "object" || Array.isArray(metadataPatch)) throw new ValidationError("Candidate response metadata patch must be an object.");
        const candidate = record.candidate_responses.find((entry) => entry.id === candidateId);
        if (!candidate) throw new ValidationError(`Candidate response ${candidateId} was not found.`, { code: "PRIVATE_CANDIDATE_NOT_FOUND" });
        if (status === "pending_audit" && candidate.status !== "pending_audit") throw new ValidationError("A completed candidate cannot be reactivated; save a new candidate version.");
        candidate.status = status;
        candidate.updated_at = now();
        candidate.metadata = { ...candidate.metadata, ...structuredClone(metadataPatch) };
        validateCandidateResponse(candidate, record.candidate_responses.indexOf(candidate));
        return record;
      });
    },
    async getCandidateResponse(caseId, selector = "current_pending") {
      const record = await readRequired(caseId);
      const candidate = selector === "current_pending"
        ? [...record.candidate_responses].reverse().find((entry) => entry.status === "pending_audit")
        : record.candidate_responses.find((entry) => entry.id === selector);
      return candidate ? structuredClone(candidate) : null;
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
      const context = buildDurableCaseContext({
        caseId,
        caseState: record.case_state,
        transcriptEntries: record.raw_transcript,
        trackerEntries: record.tracker_entries
      });
      const candidate = candidateId === "current_pending"
        ? [...record.candidate_responses].reverse().find((entry) => entry.status === "pending_audit")
        : record.candidate_responses.find((entry) => entry.id === candidateId);
      const recent = Object.keys(episodePolicy).length
        ? selectRecentVerbatimWindow(record.raw_transcript, {
            minimumCompleteExchanges: episodePolicy.minimumCompleteExchanges ?? 3,
            currentEpisodeId: episodePolicy.currentEpisodeId ?? record.case_state.current_episode?.id ?? null,
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
      auditVersion = PRIVATE_CANDIDATE_AUDIT_VERSION,
      minimumCompleteExchanges = 3
    } = {}) {
      const record = await readRequired(caseId);
      const durableContext = buildDurableCaseContext({
        caseId,
        caseState: record.case_state,
        transcriptEntries: record.raw_transcript,
        trackerEntries: record.tracker_entries
      });
      const recentVerbatim = selectRecentVerbatimWindow(record.raw_transcript, {
        minimumCompleteExchanges,
        currentEpisodeId: record.case_state.current_episode?.id ?? null,
        maximumSelectedTurns: CONTEXT_WINDOW_LIMITS.transcript_entries,
        requireCompleteEpisode: true
      });
      const candidate = [...record.candidate_responses].reverse().find((entry) => entry.status === "pending_audit") ?? null;
      const context = {
        case_state: record.case_state,
        last_state_diff: record.state_diff_history.at(-1) ?? null,
        current_episode: record.case_state.current_episode,
        constitution_ref: durableContext.constitution_ref,
        candidate_response: candidate,
        recent_verbatim: recentVerbatim,
        source_artifact_refs: record.source_artifacts.map((artifact) => ({ id: artifact.id })),
        targeted_older_evidence: durableContext.targeted_older_evidence
      };
      const continuationSafety = assessContinuationSafety(context, { minimumCompleteExchanges });
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
