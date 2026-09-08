import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../core/errors.mjs";
import { createEmptyCaseState, validateCaseState } from "../case-state/longitudinal-state.mjs";
import { appendTrackerEntry, validateTrackerEntry } from "../case-state/tracker.mjs";
import { validateTranscriptEntries } from "../case-state/context-window.mjs";
import { createVaultEnvelope } from "./vault-crypto.mjs";
import { openVaultWithRoutineAuthorization } from "./vault-routine-access.mjs";

const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const ENVELOPE_FORMAT = "inner-signal-private-case-envelope-v1";
const RECORD_VERSION = 1;
const PRIVATE_RECORD_LIMITS = Object.freeze({ tracker_entries: 20_000, journal_entries: 20_000, journal_text: 40_000 });

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

export function validatePrivateCaseRecord(value) {
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
    last_state_diff: null
  };
}

function assertAppendOnly(previous, next) {
  if (next.raw_transcript.length < previous.raw_transcript.length) throw new ValidationError("Raw transcript is append-only.");
  for (let index = 0; index < previous.raw_transcript.length; index += 1) {
    if (JSON.stringify(previous.raw_transcript[index]) !== JSON.stringify(next.raw_transcript[index])) throw new ValidationError("Raw transcript is append-only and existing turns cannot be rewritten.");
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

export function createEncryptedPrivateCaseStore({ rootDir, routineKek, recoverySecretBytes, osBackedReauthenticated = false, now = () => new Date().toISOString() } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private storage path.");
  const routineKey = bytes(routineKek, "routineKek");
  const recoverySecret = bytes(recoverySecretBytes, "recoverySecretBytes");
  let closed = false;
  if (osBackedReauthenticated !== true) throw new ValidationError("OS-backed reauthentication evidence is required before opening the private case store.");

  const ensureOpen = () => {
    if (closed) throw new ValidationError("Private case store is closed.");
  };

  const fileFor = (caseId) => path.join(rootDir, `${safeCaseId(caseId)}.vault.json`);
  const readExisting = async (caseId) => {
    ensureOpen();
    let serialized;
    try { serialized = JSON.parse(await fs.readFile(fileFor(caseId), "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    const envelope = deserializeVaultEnvelope(serialized);
    const opened = await openVaultWithRoutineAuthorization({ osBackedReauthenticated: true, envelope, routineKek: routineKey });
    const plaintext = opened.plaintextBytes;
    try { return validatePrivateCaseRecord(JSON.parse(plaintext.toString("utf8"))); }
    finally { plaintext.fill(0); }
  };
  const write = async (caseId, record, previous = null) => {
    ensureOpen();
    safeCaseId(caseId);
    const candidate = validatePrivateCaseRecord(structuredClone(record));
    if (candidate.case_id !== caseId) throw new ValidationError("Private case record identity mismatch.");
    if (previous) assertAppendOnly(previous, candidate);
    const plaintext = Buffer.from(JSON.stringify(candidate), "utf8");
    try {
      const envelope = await createVaultEnvelope({ plaintextBytes: plaintext, routineKek: routineKey, recoverySecretBytes: recoverySecret });
      await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
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
    const previous = await loadOrCreate(caseId);
    const next = await operation(structuredClone(previous));
    next.updated_at = now();
    return write(caseId, next, previous);
  };

  return Object.freeze({
    format: ENVELOPE_FORMAT,
    rootDir,
    async load(caseId) { const value = await readExisting(safeCaseId(caseId)); return value ? structuredClone(value) : null; },
    loadOrCreate,
    async commitTurn(caseId, { transcript_entries, case_state, state_diff }) {
      return mutate(caseId, (record) => {
        const additions = validateTranscriptEntries(transcript_entries);
        const existingIds = new Set(record.raw_transcript.map((turn) => turn.id));
        if (additions.some((turn) => existingIds.has(turn.id))) throw new ValidationError("Transcript turn IDs must be append-only and unique.");
        record.raw_transcript.push(...structuredClone(additions));
        record.case_state = validateCaseState(structuredClone(case_state));
        record.last_state_diff = state_diff == null ? null : structuredClone(state_diff);
        return record;
      });
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
        recoverySecret.fill(0);
        closed = true;
      }
    }
  });
}
