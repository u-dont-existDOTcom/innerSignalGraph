import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

export const EXACT_SOURCE_LIMITS = Object.freeze({
  artifacts: 100,
  exact_text_bytes: 2_000_000,
  chunks: 20_000,
  chunk_bytes: 64_000,
  metadata_bytes: 40_000
});

const SOURCE_ID = /^[A-Za-z0-9:_-]{1,160}$/;
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");

function jsonByteLength(value, name) {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
  catch { throw new ValidationError(`${name} must be JSON serializable.`); }
}

function validateSourceId(value) {
  if (typeof value !== "string" || !SOURCE_ID.test(value)) throw new ValidationError("sourceArtifactId is invalid.");
  return value;
}

export function chunkExactSourceText(exactText, { maximumChunkBytes = 12_000 } = {}) {
  if (typeof exactText !== "string" || !exactText.length) throw new ValidationError("Exact source text must be non-empty text.");
  const totalBytes = Buffer.byteLength(exactText, "utf8");
  if (totalBytes > EXACT_SOURCE_LIMITS.exact_text_bytes) throw new ValidationError("Exact source text exceeds the private artifact limit.");
  if (!Number.isSafeInteger(maximumChunkBytes) || maximumChunkBytes < 4 || maximumChunkBytes > EXACT_SOURCE_LIMITS.chunk_bytes) {
    throw new ValidationError("maximumChunkBytes is outside the bounded source-ingest policy.");
  }

  const chunks = [];
  let text = "";
  let byteLength = 0;
  let startByte = 0;
  const flush = () => {
    if (!text) return;
    const bytes = Buffer.from(text, "utf8");
    chunks.push(Object.freeze({
      index: chunks.length,
      start_byte: startByte,
      end_byte: startByte + bytes.byteLength,
      utf8_bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      exact_text: text
    }));
    startByte += bytes.byteLength;
    text = "";
    byteLength = 0;
  };

  for (const symbol of exactText) {
    const symbolBytes = Buffer.byteLength(symbol, "utf8");
    if (text && byteLength + symbolBytes > maximumChunkBytes) flush();
    text += symbol;
    byteLength += symbolBytes;
  }
  flush();
  if (chunks.length > EXACT_SOURCE_LIMITS.chunks) throw new ValidationError("Exact source text requires too many chunks.");
  return Object.freeze(chunks);
}

export function reconstructExactSourceChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > EXACT_SOURCE_LIMITS.chunks) {
    throw new ValidationError("Exact source chunks must be a bounded non-empty array.");
  }
  const texts = [];
  const manifest = [];
  let expectedStart = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) throw new ValidationError(`sourceChunks[${index}] must be an object.`);
    if (chunk.index !== index) throw new ValidationError(`sourceChunks[${index}].index is not contiguous.`);
    if (typeof chunk.exact_text !== "string" || !chunk.exact_text.length) throw new ValidationError(`sourceChunks[${index}].exact_text is required.`);
    const bytes = Buffer.from(chunk.exact_text, "utf8");
    if (bytes.byteLength > EXACT_SOURCE_LIMITS.chunk_bytes) throw new ValidationError(`sourceChunks[${index}] exceeds the chunk limit.`);
    const expectedEnd = expectedStart + bytes.byteLength;
    if (chunk.start_byte !== expectedStart || chunk.end_byte !== expectedEnd || chunk.utf8_bytes !== bytes.byteLength) {
      throw new ValidationError(`sourceChunks[${index}] has a gap, overlap, or invalid byte length.`);
    }
    const digest = sha256Hex(bytes);
    if (chunk.sha256 !== digest) throw new ValidationError(`sourceChunks[${index}] failed its integrity check.`);
    texts.push(chunk.exact_text);
    manifest.push(Object.freeze({
      index,
      start_byte: expectedStart,
      end_byte: expectedEnd,
      utf8_bytes: bytes.byteLength,
      sha256: digest
    }));
    expectedStart = expectedEnd;
  }
  if (expectedStart > EXACT_SOURCE_LIMITS.exact_text_bytes) throw new ValidationError("Reconstructed exact source exceeds the private artifact limit.");
  const exactText = texts.join("");
  const reconstructedBytes = Buffer.from(exactText, "utf8");
  if (reconstructedBytes.byteLength !== expectedStart) throw new ValidationError("Exact source reconstruction changed byte length.");
  return Object.freeze({
    exact_text: exactText,
    utf8_bytes: reconstructedBytes.byteLength,
    sha256: sha256Hex(reconstructedBytes),
    chunks: Object.freeze(manifest)
  });
}

export function createExactSourceArtifact({ id, chunks, metadata = {}, createdAt }) {
  validateSourceId(id);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new ValidationError("Exact source artifact metadata must be an object.");
  if (jsonByteLength(metadata, "Exact source artifact metadata") > EXACT_SOURCE_LIMITS.metadata_bytes) {
    throw new ValidationError("Exact source artifact metadata exceeds the bounded limit.");
  }
  if (typeof createdAt !== "string" || !createdAt.trim() || createdAt.length > 80) throw new ValidationError("Exact source artifact createdAt is invalid.");
  const reconstructed = reconstructExactSourceChunks(chunks);
  return validateExactSourceArtifact({
    id,
    version: 1,
    exact_text: reconstructed.exact_text,
    utf8_bytes: reconstructed.utf8_bytes,
    sha256: reconstructed.sha256,
    chunks: reconstructed.chunks,
    metadata: structuredClone(metadata),
    created_at: createdAt
  });
}

export function validateExactSourceArtifact(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`source_artifacts[${index}] must be an object.`);
  validateSourceId(value.id);
  if (value.version !== 1) throw new ValidationError(`source_artifacts[${index}].version is invalid.`);
  if (typeof value.created_at !== "string" || !value.created_at.trim() || value.created_at.length > 80) throw new ValidationError(`source_artifacts[${index}].created_at is invalid.`);
  if (typeof value.exact_text !== "string" || !value.exact_text.length) throw new ValidationError(`source_artifacts[${index}].exact_text is required.`);
  const exactBytes = Buffer.from(value.exact_text, "utf8");
  if (exactBytes.byteLength > EXACT_SOURCE_LIMITS.exact_text_bytes || value.utf8_bytes !== exactBytes.byteLength || value.sha256 !== sha256Hex(exactBytes)) {
    throw new ValidationError(`source_artifacts[${index}] failed its exact-text integrity check.`);
  }
  if (!Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > EXACT_SOURCE_LIMITS.chunks) throw new ValidationError(`source_artifacts[${index}].chunks is invalid.`);
  let expectedStart = 0;
  for (let chunkIndex = 0; chunkIndex < value.chunks.length; chunkIndex += 1) {
    const chunk = value.chunks[chunkIndex];
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk) || chunk.index !== chunkIndex || chunk.start_byte !== expectedStart) {
      throw new ValidationError(`source_artifacts[${index}].chunks[${chunkIndex}] is not contiguous.`);
    }
    if (!Number.isSafeInteger(chunk.end_byte) || !Number.isSafeInteger(chunk.utf8_bytes) || chunk.end_byte <= chunk.start_byte || chunk.utf8_bytes !== chunk.end_byte - chunk.start_byte) {
      throw new ValidationError(`source_artifacts[${index}].chunks[${chunkIndex}] has an invalid byte range.`);
    }
    if (typeof chunk.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(chunk.sha256)) throw new ValidationError(`source_artifacts[${index}].chunks[${chunkIndex}].sha256 is invalid.`);
    const digest = sha256Hex(exactBytes.subarray(chunk.start_byte, chunk.end_byte));
    if (digest !== chunk.sha256) throw new ValidationError(`source_artifacts[${index}].chunks[${chunkIndex}] failed its integrity check.`);
    expectedStart = chunk.end_byte;
  }
  if (expectedStart !== exactBytes.byteLength) throw new ValidationError(`source_artifacts[${index}].chunks do not cover the exact source bytes.`);
  if (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata) || jsonByteLength(value.metadata, `source_artifacts[${index}].metadata`) > EXACT_SOURCE_LIMITS.metadata_bytes) {
    throw new ValidationError(`source_artifacts[${index}].metadata is invalid.`);
  }
  return value;
}
