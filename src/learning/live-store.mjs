import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  LIVE_LEARNING_STORE_FORMAT,
  liveLearningFingerprint,
  liveLearningHash,
  screenLiveLearningEvidence,
  validateLiveLearningEvidence,
  validateLiveLearningRevocation,
  validateLiveLearningSubmission
} from "./live-contracts.mjs";

const REVIEW_DISPOSITIONS = Object.freeze([
  "reject",
  "insufficient-evidence",
  "duplicate",
  "personalization-process-only",
  "needs-external-evidence",
  "prepare-therapy-policy-decision"
]);
const STATUS_FOR_DISPOSITION = Object.freeze({
  reject: "rejected",
  "insufficient-evidence": "insufficient-evidence",
  duplicate: "duplicate",
  "personalization-process-only": "personalization-process-only",
  "needs-external-evidence": "needs-external-evidence",
  "prepare-therapy-policy-decision": "needs-owner-therapy-decision"
});
const REVIEW_STATUSES = new Set(["needs-review", ...Object.values(STATUS_FOR_DISPOSITION)]);
const mutations = new Map();
const stores = new Map();

function validation(message) {
  const error = new Error(message);
  error.code = "VALIDATION_ERROR";
  return error;
}

function nowIso(clock) {
  return clock().toISOString();
}

function initialState(at) {
  return { format: LIVE_LEARNING_STORE_FORMAT, revision: 0, createdAt: at, updatedAt: at, records: [] };
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validation(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw validation(`${label} has unsupported or missing fields.`);
}

function iso(value, label) {
  if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf()) || new Date(value).toISOString() !== value) throw validation(`${label} is invalid.`);
}

function validateStore(state) {
  exactKeys(state, ["format", "revision", "createdAt", "updatedAt", "records"], "learning store");
  if (state.format !== LIVE_LEARNING_STORE_FORMAT) throw validation("Learning store format is unsupported.");
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw validation("Learning store revision is invalid.");
  iso(state.createdAt, "createdAt");
  iso(state.updatedAt, "updatedAt");
  if (!Array.isArray(state.records)) throw validation("Learning store records must be an array.");
  const receipts = new Set();
  const fingerprints = new Set();
  const occurrenceHashes = new Set();
  const revocationHashes = new Set();
  for (const record of state.records) {
    exactKeys(record, ["candidateReceipt", "candidateFingerprint", "candidate", "status", "occurrenceCount", "occurrences", "createdAt", "updatedAt", "reviewedAt", "reviewDisposition", "history"], "learning record");
    if (!/^ISL-LOCAL-[A-F0-9]{24}$/.test(record.candidateReceipt)) throw validation("Learning receipt is invalid.");
    if (!/^[a-f0-9]{64}$/.test(record.candidateFingerprint)) throw validation("Learning fingerprint is invalid.");
    validateLiveLearningEvidence(record.candidate);
    if (record.candidateFingerprint !== liveLearningFingerprint(record.candidate)) throw validation("Learning fingerprint does not match candidate.");
    if (!REVIEW_STATUSES.has(record.status)) throw validation("Learning review status is invalid.");
    if (!Array.isArray(record.occurrences) || record.occurrences.length < 1) throw validation("Learning occurrences are invalid.");
    if (record.occurrenceCount !== record.occurrences.length) throw validation("Learning occurrence count is invalid.");
    for (const occurrence of record.occurrences) {
      exactKeys(occurrence, ["occurrenceHash", "revocationHash", "createdAt"], "learning occurrence");
      if (!/^[a-f0-9]{64}$/.test(occurrence.occurrenceHash) || !/^[a-f0-9]{64}$/.test(occurrence.revocationHash)) throw validation("Learning occurrence hash is invalid.");
      if (occurrenceHashes.has(occurrence.occurrenceHash)) throw validation("Learning occurrence token is duplicated across records.");
      if (revocationHashes.has(occurrence.revocationHash)) throw validation("Learning revocation token is duplicated across records.");
      occurrenceHashes.add(occurrence.occurrenceHash);
      revocationHashes.add(occurrence.revocationHash);
      iso(occurrence.createdAt, "occurrence.createdAt");
    }
    iso(record.createdAt, "record.createdAt");
    iso(record.updatedAt, "record.updatedAt");
    if (record.reviewedAt !== null) iso(record.reviewedAt, "record.reviewedAt");
    if (record.reviewDisposition !== null && !REVIEW_DISPOSITIONS.includes(record.reviewDisposition)) throw validation("Learning review disposition is invalid.");
    if (record.status === "needs-review" && (record.reviewedAt !== null || record.reviewDisposition !== null)) throw validation("Unreviewed learning record contains review metadata.");
    if (record.status !== "needs-review" && (record.reviewedAt === null || STATUS_FOR_DISPOSITION[record.reviewDisposition] !== record.status)) throw validation("Learning review status and disposition do not match.");
    if (!Array.isArray(record.history) || !record.history.length) throw validation("Learning history is invalid.");
    for (const entry of record.history) {
      exactKeys(entry, ["action", "at"], "learning history entry");
      if (typeof entry.action !== "string" || !/^[a-z][a-z-]{1,63}$/.test(entry.action)) throw validation("Learning history action is invalid.");
      iso(entry.at, "history.at");
    }
    if (receipts.has(record.candidateReceipt) || fingerprints.has(record.candidateFingerprint)) throw validation("Learning records contain duplicate identities.");
    receipts.add(record.candidateReceipt);
    fingerprints.add(record.candidateFingerprint);
  }
  return state;
}

function publicRecord(record) {
  return Object.freeze({
    candidateReceipt: record.candidateReceipt,
    candidateFingerprint: record.candidateFingerprint,
    candidate: structuredClone(record.candidate),
    status: record.status,
    occurrenceCount: record.occurrenceCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    reviewedAt: record.reviewedAt,
    reviewDisposition: record.reviewDisposition,
    history: structuredClone(record.history),
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none",
    externalTransmissionAuthority: "none"
  });
}

function queueMutation(key, operation) {
  const previous = mutations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  let queued;
  queued = next.finally(() => {
    if (mutations.get(key) === queued) mutations.delete(key);
  });
  mutations.set(key, queued);
  return queued;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(file, value) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => {});
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(temporary, 0o600).catch(() => {});
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export class LiveLearningStore {
  constructor({ rootDir, clock = () => new Date(), previewTtlMs = 10 * 60 * 1_000 }) {
    if (typeof rootDir !== "string" || !rootDir) throw new TypeError("rootDir is required.");
    if (!Number.isInteger(previewTtlMs) || previewTtlMs < 1 || previewTtlMs > 10 * 60 * 1_000) throw new TypeError("previewTtlMs must be at most ten minutes.");
    this.rootDir = path.resolve(rootDir);
    this.stateFile = path.join(this.rootDir, "queue.json");
    this.clock = clock;
    this.previewTtlMs = previewTtlMs;
    this.previews = new Map();
  }

  async readState({ create = false } = {}) {
    const fallback = initialState(nowIso(this.clock));
    const state = validateStore(await readJson(this.stateFile, fallback));
    if (create) {
      try {
        await fs.access(this.stateFile);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await atomicWriteJson(this.stateFile, state);
      }
    }
    return state;
  }

  purgeExpiredPreviews() {
    const now = this.clock().valueOf();
    for (const [nonce, preview] of this.previews) if (preview.expiresAtMs <= now) this.previews.delete(nonce);
  }

  createPreview(candidate) {
    this.purgeExpiredPreviews();
    const screening = screenLiveLearningEvidence(candidate);
    if (!screening.structuralPass) {
      const error = validation("Candidate contains a deterministic privacy risk and was not previewed.");
      error.details = { riskCodes: screening.riskCodes };
      throw error;
    }
    const previewNonce = crypto.randomBytes(32).toString("base64url");
    const expiresAtMs = this.clock().valueOf() + this.previewTtlMs;
    this.previews.set(previewNonce, { candidateFingerprint: screening.candidateFingerprint, expiresAtMs });
    return Object.freeze({
      candidate: screening.candidate,
      candidateFingerprint: screening.candidateFingerprint,
      riskCodes: [],
      previewNonce,
      expiresAt: new Date(expiresAtMs).toISOString(),
      identifiabilityWarningRequired: true,
      anonymous: false,
      deIdentified: false,
      diskWrite: false,
      externalWrite: false
    });
  }

  async submit(input) {
    validateLiveLearningSubmission(input);
    this.purgeExpiredPreviews();
    const preview = this.previews.get(input.previewNonce);
    if (!preview) throw validation("Preview nonce is missing, expired, or already used.");
    this.previews.delete(input.previewNonce);
    const screening = screenLiveLearningEvidence(input.candidate);
    if (!screening.structuralPass) throw validation("Candidate contains a deterministic privacy risk and was not submitted.");
    if (preview.candidateFingerprint !== screening.candidateFingerprint) throw validation("Candidate changed after preview.");
    return queueMutation(this.stateFile, async () => {
      const state = await this.readState();
      const at = nowIso(this.clock);
      const occurrenceHash = liveLearningHash(input.occurrenceToken);
      const revocationHash = liveLearningHash(input.revocationToken);
      let record = state.records.find((item) => item.occurrences.some((occurrence) => occurrence.occurrenceHash === occurrenceHash));
      let submissionStatus = "submitted";
      if (record) {
        const occurrence = record.occurrences.find((item) => item.occurrenceHash === occurrenceHash);
        if (occurrence.revocationHash !== revocationHash) throw validation("Occurrence token conflicts with an existing revocation credential.");
        submissionStatus = "idempotent-retry";
      } else {
        record = state.records.find((item) => item.candidateFingerprint === screening.candidateFingerprint);
      }
      if (!record) {
        record = {
          candidateReceipt: `ISL-LOCAL-${crypto.randomBytes(12).toString("hex").toUpperCase()}`,
          candidateFingerprint: screening.candidateFingerprint,
          candidate: structuredClone(input.candidate),
          status: "needs-review",
          occurrenceCount: 1,
          occurrences: [{ occurrenceHash, revocationHash, createdAt: at }],
          createdAt: at,
          updatedAt: at,
          reviewedAt: null,
          reviewDisposition: null,
          history: [{ action: "submitted", at }]
        };
        state.records.push(record);
      } else if (submissionStatus !== "idempotent-retry") {
        submissionStatus = "existing-candidate";
        record.occurrences.push({ occurrenceHash, revocationHash, createdAt: at });
        record.occurrenceCount = record.occurrences.length;
        record.updatedAt = at;
        record.history.push({ action: "occurrence-added", at });
      }
      state.revision += 1;
      state.updatedAt = at;
      validateStore(state);
      await atomicWriteJson(this.stateFile, state);
      return Object.freeze({
        submissionStatus,
        candidateReceipt: record.candidateReceipt,
        candidateFingerprint: record.candidateFingerprint,
        occurrenceCount: record.occurrenceCount,
        status: record.status,
        queueStatus: this.statusFromState(state),
        runtimeAuthority: "none",
        therapyPolicyAuthority: "none",
        externalTransmissionAuthority: "none",
        externalWrite: false
      });
    });
  }

  statusFromState(state) {
    return Object.freeze({
      availability: "available",
      totalOpen: state.records.length,
      needsReview: state.records.filter((record) => record.status === "needs-review").length,
      acceptedNotIncorporated: 0,
      incorporatedClosed: 0,
      runtimeAuthority: "none",
      therapyPolicyAuthority: "none"
    });
  }

  async status() {
    return this.statusFromState(await this.readState());
  }

  async list() {
    const state = await this.readState();
    return state.records.map(publicRecord);
  }

  async show(receipt) {
    const state = await this.readState();
    const record = state.records.find((item) => item.candidateReceipt === receipt);
    return record ? publicRecord(record) : null;
  }

  async decide(receipt, disposition) {
    if (!REVIEW_DISPOSITIONS.includes(disposition)) throw validation("Review disposition is invalid.");
    return queueMutation(this.stateFile, async () => {
      const state = await this.readState();
      const record = state.records.find((item) => item.candidateReceipt === receipt);
      if (!record) throw validation("Learning receipt was not found.");
      const at = nowIso(this.clock);
      record.status = STATUS_FOR_DISPOSITION[disposition];
      record.reviewDisposition = disposition;
      record.reviewedAt = at;
      record.updatedAt = at;
      record.history.push({ action: `review-${disposition}`, at });
      state.revision += 1;
      state.updatedAt = at;
      validateStore(state);
      await atomicWriteJson(this.stateFile, state);
      return publicRecord(record);
    });
  }

  async revoke(input) {
    validateLiveLearningRevocation(input);
    return queueMutation(this.stateFile, async () => {
      const state = await this.readState();
      const recordIndex = state.records.findIndex((item) => item.candidateReceipt === input.candidateReceipt);
      if (recordIndex < 0) return Object.freeze({ revoked: false, deleted: false, occurrenceCount: 0, status: "not-found" });
      const record = state.records[recordIndex];
      const revocationHash = liveLearningHash(input.revocationToken);
      const occurrenceIndex = record.occurrences.findIndex((item) => item.revocationHash === revocationHash);
      if (occurrenceIndex < 0) return Object.freeze({ revoked: false, deleted: false, occurrenceCount: record.occurrenceCount, status: "token-not-found" });
      record.occurrences.splice(occurrenceIndex, 1);
      const at = nowIso(this.clock);
      let deleted = false;
      if (!record.occurrences.length) {
        state.records.splice(recordIndex, 1);
        deleted = true;
      } else {
        record.occurrenceCount = record.occurrences.length;
        record.updatedAt = at;
        record.history.push({ action: "occurrence-revoked", at });
      }
      state.revision += 1;
      state.updatedAt = at;
      validateStore(state);
      await atomicWriteJson(this.stateFile, state);
      return Object.freeze({ revoked: true, deleted, occurrenceCount: deleted ? 0 : record.occurrenceCount, status: deleted ? "deleted" : record.status });
    });
  }
}

export function getLiveLearningStore(config) {
  const rootDir = path.join(config.autopilotStateDir, "private-learning");
  const key = path.resolve(rootDir);
  if (!stores.has(key)) stores.set(key, new LiveLearningStore({ rootDir }));
  return stores.get(key);
}

export const LIVE_LEARNING_REVIEW_DISPOSITIONS = REVIEW_DISPOSITIONS;
