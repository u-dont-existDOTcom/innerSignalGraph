import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { validateTranscriptEntries } from "../case-state/context-window.mjs";
import { validateExactSourceArtifact } from "./exact-source-artifact.mjs";

export const TRANSCRIPT_AMENDMENT_VERSION = 1;
export const TRANSCRIPT_AMENDMENT_LIMITS = Object.freeze({
  amendments: 20_000,
  completion_text_bytes: 80_000,
  context_id_length: 200
});

const SAFE_ID = /^[A-Za-z0-9:_-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function boundedId(value, name) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function safeTimestamp(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${name} is invalid.`);
  }
  return value;
}

function findTarget(rawTranscript, targetTurnId) {
  const target = rawTranscript.find((turn) => turn.id === targetTurnId);
  if (!target) throw new ValidationError(`Transcript amendment target ${targetTurnId} was not found.`);
  return target;
}

function findSource(sourceArtifacts, sourceArtifactId) {
  const source = sourceArtifacts.find((artifact) => artifact.id === sourceArtifactId);
  if (!source) throw new ValidationError(`Transcript amendment source ${sourceArtifactId} was not found.`);
  return validateExactSourceArtifact(source);
}

export function validateTranscriptCompletionAmendment(value, index = 0, {
  rawTranscript = null,
  sourceArtifacts = null
} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`transcript_amendments[${index}] must be an object.`);
  if (value.schema_version !== TRANSCRIPT_AMENDMENT_VERSION || value.kind !== "completion") {
    throw new ValidationError(`transcript_amendments[${index}] version or kind is invalid.`);
  }
  boundedId(value.id, `transcript_amendments[${index}].id`);
  boundedId(value.target_turn_id, `transcript_amendments[${index}].target_turn_id`);
  boundedId(value.producer_context_id, `transcript_amendments[${index}].producer_context_id`);
  safeTimestamp(value.created_at, `transcript_amendments[${index}].created_at`);
  if (typeof value.completion_text !== "string" || value.completion_text.length === 0
      || Buffer.byteLength(value.completion_text, "utf8") > TRANSCRIPT_AMENDMENT_LIMITS.completion_text_bytes) {
    throw new ValidationError(`transcript_amendments[${index}].completion_text is invalid.`);
  }
  for (const field of ["target_original_sha256", "completion_sha256", "effective_text_sha256"]) {
    if (typeof value[field] !== "string" || !SHA256.test(value[field])) throw new ValidationError(`transcript_amendments[${index}].${field} is invalid.`);
  }
  const provenance = value.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)
      || provenance.kind !== "exact_source_artifact_range") {
    throw new ValidationError(`transcript_amendments[${index}].provenance is invalid.`);
  }
  boundedId(provenance.source_artifact_id, `transcript_amendments[${index}].provenance.source_artifact_id`);
  if (!Number.isSafeInteger(provenance.start_byte) || provenance.start_byte < 0
      || !Number.isSafeInteger(provenance.end_byte) || provenance.end_byte <= provenance.start_byte) {
    throw new ValidationError(`transcript_amendments[${index}] source byte range is invalid.`);
  }
  if (rawTranscript) {
    validateTranscriptEntries(rawTranscript);
    const target = findTarget(rawTranscript, value.target_turn_id);
    if (value.target_original_sha256 !== sha256Hex(Buffer.from(target.text, "utf8"))) {
      throw new ValidationError(`transcript_amendments[${index}] does not bind the immutable raw target bytes.`);
    }
    if (value.completion_sha256 !== sha256Hex(Buffer.from(value.completion_text, "utf8"))) {
      throw new ValidationError(`transcript_amendments[${index}] completion integrity check failed.`);
    }
    if (value.effective_text_sha256 !== sha256Hex(Buffer.from(`${target.text}${value.completion_text}`, "utf8"))) {
      throw new ValidationError(`transcript_amendments[${index}] effective-text integrity check failed.`);
    }
  }
  if (sourceArtifacts) {
    const source = findSource(sourceArtifacts, provenance.source_artifact_id);
    const sourceBytes = Buffer.from(source.exact_text, "utf8");
    if (provenance.end_byte > sourceBytes.byteLength) throw new ValidationError(`transcript_amendments[${index}] source byte range exceeds its artifact.`);
    const completionBytes = Buffer.from(value.completion_text, "utf8");
    const sourceRange = sourceBytes.subarray(provenance.start_byte, provenance.end_byte);
    if (!sourceRange.equals(completionBytes)) throw new ValidationError(`transcript_amendments[${index}] completion does not match its exact source range.`);
  }
  return value;
}

export function validateTranscriptAmendments(values, options = {}) {
  if (!Array.isArray(values) || values.length > TRANSCRIPT_AMENDMENT_LIMITS.amendments) {
    throw new ValidationError("transcript_amendments exceeds the private-record limit or is invalid.");
  }
  const ids = new Set();
  const targets = new Set();
  values.forEach((value, index) => {
    validateTranscriptCompletionAmendment(value, index, options);
    if (ids.has(value.id)) throw new ValidationError(`Duplicate transcript amendment ${value.id}.`);
    if (targets.has(value.target_turn_id)) throw new ValidationError(`Transcript turn ${value.target_turn_id} already has a completion amendment.`);
    ids.add(value.id);
    targets.add(value.target_turn_id);
  });
  return values;
}

export function createTranscriptCompletionAmendment({
  id,
  targetTurn,
  completionText,
  sourceArtifact,
  sourceStartByte = 0,
  sourceEndByte = null,
  producerContextId,
  createdAt
} = {}) {
  const [target] = validateTranscriptEntries([structuredClone(targetTurn)]);
  const source = validateExactSourceArtifact(structuredClone(sourceArtifact));
  const endByte = sourceEndByte ?? Buffer.byteLength(source.exact_text, "utf8");
  const value = {
    schema_version: TRANSCRIPT_AMENDMENT_VERSION,
    id,
    kind: "completion",
    target_turn_id: target.id,
    target_original_sha256: sha256Hex(Buffer.from(target.text, "utf8")),
    completion_text: completionText,
    completion_sha256: sha256Hex(Buffer.from(completionText, "utf8")),
    effective_text_sha256: sha256Hex(Buffer.from(`${target.text}${completionText}`, "utf8")),
    producer_context_id: producerContextId,
    created_at: createdAt,
    provenance: {
      kind: "exact_source_artifact_range",
      source_artifact_id: source.id,
      start_byte: sourceStartByte,
      end_byte: endByte
    }
  };
  return Object.freeze(validateTranscriptCompletionAmendment(value, 0, {
    rawTranscript: [target],
    sourceArtifacts: [source]
  }));
}

export function applyTranscriptAmendments(rawTranscript, amendments, { sourceArtifacts = null } = {}) {
  const raw = structuredClone(validateTranscriptEntries(rawTranscript));
  validateTranscriptAmendments(amendments, { rawTranscript: raw, sourceArtifacts });
  const effective = raw.map((turn) => structuredClone(turn));
  const byId = new Map(effective.map((turn) => [turn.id, turn]));
  for (const amendment of amendments) byId.get(amendment.target_turn_id).text += amendment.completion_text;
  return Object.freeze(effective.map((turn) => Object.freeze(turn)));
}
