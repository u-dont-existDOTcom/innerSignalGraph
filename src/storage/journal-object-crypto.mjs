import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

export const JOURNAL_OBJECT_CRYPTO_SUITE = Object.freeze({
  version: 1,
  suite_id: "inner-signal-journal-object-v1",
  algorithm: "aes-256-gcm",
  key_bytes: 32,
  nonce_bytes: 12,
  auth_tag_bytes: 16
});

const ID = /^[A-Za-z0-9:_-]{1,160}$/;

function exactId(value) {
  if (typeof value !== "string" || !ID.test(value)) throw new ValidationError("Journal object identity is invalid.");
  return value;
}

function keyBytes(value, name) {
  if (!(value instanceof Uint8Array) || value.byteLength !== JOURNAL_OBJECT_CRYPTO_SUITE.key_bytes) {
    throw new ValidationError(`${name} must be 32-byte key material.`);
  }
  return Buffer.from(value);
}

function inputBytes(value, name) {
  if (!(value instanceof Uint8Array)) throw new ValidationError(`${name} must be bytes.`);
  return Buffer.from(value);
}

function base64(value) { return Buffer.from(value).toString("base64"); }
function fromBase64(value, length, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new ValidationError("Journal object envelope is unreadable.");
  const bytes = Buffer.from(value, "base64");
  if (length != null && bytes.byteLength !== length) {
    bytes.fill(0);
    throw new ValidationError(`Journal object ${name} is invalid.`);
  }
  return bytes;
}

function identity({ caseId, corpusId, objectId, objectVersion, chunkIndex }) {
  if (!Number.isSafeInteger(objectVersion) || objectVersion < 1 || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new ValidationError("Journal object version or chunk index is invalid.");
  }
  return {
    case_id: exactId(caseId),
    corpus_id: exactId(corpusId),
    object_id: exactId(objectId),
    object_version: objectVersion,
    chunk_index: chunkIndex
  };
}

function aad(purpose, fields) {
  return Buffer.from(JSON.stringify([
    JOURNAL_OBJECT_CRYPTO_SUITE.suite_id,
    purpose,
    fields.case_id,
    fields.corpus_id,
    fields.object_id,
    fields.object_version,
    fields.chunk_index
  ]), "utf8");
}

function encrypt(key, plaintext, additionalData) {
  const nonce = randomBytes(JOURNAL_OBJECT_CRYPTO_SUITE.nonce_bytes);
  const cipher = createCipheriv(JOURNAL_OBJECT_CRYPTO_SUITE.algorithm, key, nonce, {
    authTagLength: JOURNAL_OBJECT_CRYPTO_SUITE.auth_tag_bytes
  });
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, auth_tag: cipher.getAuthTag() };
}

function decrypt(key, encrypted, additionalData) {
  const decipher = createDecipheriv(JOURNAL_OBJECT_CRYPTO_SUITE.algorithm, key, encrypted.nonce, {
    authTagLength: JOURNAL_OBJECT_CRYPTO_SUITE.auth_tag_bytes
  });
  decipher.setAAD(additionalData);
  decipher.setAuthTag(encrypted.auth_tag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
}

export function encryptJournalObject({
  plaintextBytes,
  corpusKey,
  caseId,
  corpusId,
  objectId,
  objectVersion = 1,
  chunkIndex = 0
}) {
  const plaintext = inputBytes(plaintextBytes, "plaintextBytes");
  const wrappingKey = keyBytes(corpusKey, "corpusKey");
  const fields = identity({ caseId, corpusId, objectId, objectVersion, chunkIndex });
  const dataKey = randomBytes(JOURNAL_OBJECT_CRYPTO_SUITE.key_bytes);
  try {
    const wrapped = encrypt(wrappingKey, dataKey, aad("key-wrap", fields));
    const payload = encrypt(dataKey, plaintext, aad("payload", fields));
    return Object.freeze({
      version: JOURNAL_OBJECT_CRYPTO_SUITE.version,
      suite_id: JOURNAL_OBJECT_CRYPTO_SUITE.suite_id,
      ...fields,
      wrapped_key: Object.freeze({
        nonce: base64(wrapped.nonce),
        ciphertext: base64(wrapped.ciphertext),
        auth_tag: base64(wrapped.auth_tag)
      }),
      payload: Object.freeze({
        nonce: base64(payload.nonce),
        ciphertext: base64(payload.ciphertext),
        auth_tag: base64(payload.auth_tag),
        byte_length: plaintext.byteLength,
        sha256: createHash("sha256").update(plaintext).digest("hex")
      })
    });
  } finally {
    plaintext.fill(0);
    wrappingKey.fill(0);
    dataKey.fill(0);
  }
}

function parseEnvelope(envelope) {
  const topKeys = ["case_id", "chunk_index", "corpus_id", "object_id", "object_version", "payload", "suite_id", "version", "wrapped_key"];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
      || JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(topKeys)
      || envelope.version !== JOURNAL_OBJECT_CRYPTO_SUITE.version
      || envelope.suite_id !== JOURNAL_OBJECT_CRYPTO_SUITE.suite_id) {
    throw new ValidationError("Journal object envelope is unreadable.");
  }
  const fields = identity({
    caseId: envelope.case_id,
    corpusId: envelope.corpus_id,
    objectId: envelope.object_id,
    objectVersion: envelope.object_version,
    chunkIndex: envelope.chunk_index
  });
  const wrappedKeys = Object.keys(envelope.wrapped_key ?? {}).sort();
  const payloadKeys = Object.keys(envelope.payload ?? {}).sort();
  if (JSON.stringify(wrappedKeys) !== JSON.stringify(["auth_tag", "ciphertext", "nonce"])
      || JSON.stringify(payloadKeys) !== JSON.stringify(["auth_tag", "byte_length", "ciphertext", "nonce", "sha256"])) {
    throw new ValidationError("Journal object envelope is unreadable.");
  }
  if (!Number.isSafeInteger(envelope.payload.byte_length) || envelope.payload.byte_length < 0
      || typeof envelope.payload.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(envelope.payload.sha256)) {
    throw new ValidationError("Journal object envelope is unreadable.");
  }
  return {
    fields,
    wrapped: {
      nonce: fromBase64(envelope.wrapped_key.nonce, JOURNAL_OBJECT_CRYPTO_SUITE.nonce_bytes, "nonce"),
      ciphertext: fromBase64(envelope.wrapped_key.ciphertext, JOURNAL_OBJECT_CRYPTO_SUITE.key_bytes, "wrapped key"),
      auth_tag: fromBase64(envelope.wrapped_key.auth_tag, JOURNAL_OBJECT_CRYPTO_SUITE.auth_tag_bytes, "tag")
    },
    payload: {
      nonce: fromBase64(envelope.payload.nonce, JOURNAL_OBJECT_CRYPTO_SUITE.nonce_bytes, "nonce"),
      ciphertext: fromBase64(envelope.payload.ciphertext, null, "ciphertext"),
      auth_tag: fromBase64(envelope.payload.auth_tag, JOURNAL_OBJECT_CRYPTO_SUITE.auth_tag_bytes, "tag")
    },
    byteLength: envelope.payload.byte_length,
    digest: envelope.payload.sha256
  };
}

export function decryptJournalObject({ envelope, corpusKey, expected }) {
  const parsed = parseEnvelope(envelope);
  const expectedFields = identity(expected);
  if (JSON.stringify(parsed.fields) !== JSON.stringify(expectedFields)) {
    throw new ValidationError("Journal object envelope is unreadable.", { code: "JOURNAL_OBJECT_IDENTITY_MISMATCH" });
  }
  const wrappingKey = keyBytes(corpusKey, "corpusKey");
  let dataKey;
  let plaintext;
  try {
    dataKey = decrypt(wrappingKey, parsed.wrapped, aad("key-wrap", parsed.fields));
    plaintext = decrypt(dataKey, parsed.payload, aad("payload", parsed.fields));
    if (plaintext.byteLength !== parsed.byteLength || createHash("sha256").update(plaintext).digest("hex") !== parsed.digest) {
      throw new ValidationError("Journal object envelope is unreadable.");
    }
    return Buffer.from(plaintext);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Journal object envelope is unreadable.", { code: "JOURNAL_OBJECT_AUTHENTICATION_FAILED" });
  } finally {
    wrappingKey.fill(0);
    dataKey?.fill(0);
    plaintext?.fill(0);
  }
}
