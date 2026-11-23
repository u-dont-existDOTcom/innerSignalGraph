import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

// Sealing a feedback message to the owner's public key (design section 4). The server holds only the owner's X25519 public key, so
// it can seal but never open what it stores: opening needs the private key, which only the owner's laptop holds, and the code
// that opens lives in open-sealed.mjs, which no server module imports (tests/feedback-sealed-box.test.mjs checks that).
//
// Per message: a fresh X25519 key pair; HKDF-SHA256 over the shared secret (salt: the fresh public key then the owner's public
// key; info: a fixed label and the message's id) gives an AES-256-GCM key; the associated data is the message's clear record as
// canonical JSON, so the record and the sealed part can't be swapped or edited without the opening failing.

export const FEEDBACK_SEAL_SUITE = "inner-signal-feedback-seal-v1";
const INFO_PREFIX = "inner-signal:feedback:v1:";
const RAW_KEY_BYTES = 32;
const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/u;

export class FeedbackSealError extends Error {
  constructor(code = "FEEDBACK_SEAL_INVALID") {
    super("The sealed feedback could not be processed.");
    this.name = "FeedbackSealError";
    this.code = code;
  }
}

// The owner's public key as configured: 43 base64url characters, 32 bytes.
export function readOwnerPublicKey(text) {
  if (typeof text !== "string" || !BASE64URL_KEY.test(text) || Buffer.from(text, "base64url").length !== RAW_KEY_BYTES) {
    throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  }
  let key;
  try {
    key = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: text }, format: "jwk" });
  } catch {
    throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  }
  // A degenerate key (one of the few low-order points) gives no usable shared secret: refused at start, not per message.
  try {
    const trial = diffieHellman({ privateKey: generateKeyPairSync("x25519").privateKey, publicKey: key });
    if (trial.every((byte) => byte === 0)) throw new Error("degenerate");
  } catch {
    throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  }
  return key;
}

// A short id for a public key, kept in clear with each message, so the owner's laptop knows which of his keys opens it.
export function keyIdFor(keyObject) {
  return createHash("sha256").update(rawPublicKey(keyObject)).digest("hex").slice(0, 16);
}

// The sealed JSON is padded with spaces (which JSON ignores) to the next size step: 512 bytes, then doubling. A file's size then
// shows only the step, not the message's length.
export function paddedJson(value) {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  let step = 512;
  while (step < json.length) step *= 2;
  return Buffer.concat([json, Buffer.alloc(step - json.length, 0x20)]);
}

export function rawPublicKey(keyObject) {
  const x = keyObject?.export?.({ format: "jwk" })?.x;
  if (typeof x !== "string" || !BASE64URL_KEY.test(x)) throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  return Buffer.from(x, "base64url");
}

// JSON with object keys in sorted order at every level, so both sides build the same associated data from the same record.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Shared by sealing and opening: the message key from the shared secret and both public keys. A shared secret of all zeros means a
// degenerate public key and is refused.
export function deriveMessageKey({ sharedSecret, ephemeralPublicRaw, ownerPublicRaw, id }) {
  if (!Buffer.isBuffer(sharedSecret) || sharedSecret.length !== RAW_KEY_BYTES || sharedSecret.every((byte) => byte === 0)) {
    throw new FeedbackSealError("FEEDBACK_SEAL_INVALID");
  }
  const salt = Buffer.concat([ephemeralPublicRaw, ownerPublicRaw]);
  return Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${INFO_PREFIX}${id}`, "utf8"), RAW_KEY_BYTES));
}

// Seals `plaintext` (an object, stored as JSON) for the owner. `record` is the clear record the sealed part is bound to.
export function sealForOwner({ ownerPublicKey, id, record, plaintext, random = randomBytes }) {
  if (typeof id !== "string" || !id) throw new FeedbackSealError("FEEDBACK_SEAL_INVALID");
  const ownerPublicRaw = rawPublicKey(ownerPublicKey);
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublicRaw = rawPublicKey(ephemeral.publicKey);
  let sharedSecret;
  try {
    sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: ownerPublicKey });
  } catch {
    throw new FeedbackSealError("FEEDBACK_SEAL_INVALID");
  }
  const key = deriveMessageKey({ sharedSecret, ephemeralPublicRaw, ownerPublicRaw, id });
  sharedSecret.fill(0);
  const iv = random(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(canonicalJson(record), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(paddedJson(plaintext)), cipher.final()]);
  key.fill(0);
  return {
    suite: FEEDBACK_SEAL_SUITE,
    epk: ephemeralPublicRaw.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}
