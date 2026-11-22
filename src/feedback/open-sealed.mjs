import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync } from "node:crypto";
import { FEEDBACK_SEAL_SUITE, FeedbackSealError, canonicalJson, deriveMessageKey, rawPublicKey } from "./sealed-box.mjs";

// Opening a sealed feedback message: only the owner's laptop does this (scripts/feedback-inbox.mjs). No server module imports this
// file; tests/feedback-sealed-box.test.mjs keeps it that way.

const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL = /^[A-Za-z0-9_-]*$/u;

// A new owner key pair, as the two base64url strings the owner file keeps (`x` is the public key the server is given).
export function generateOwnerKeyPair() {
  const { privateKey } = generateKeyPairSync("x25519");
  const jwk = privateKey.export({ format: "jwk" });
  return { privateKey: jwk.d, publicKey: jwk.x };
}

export function readOwnerPrivateKey({ privateKey, publicKey }) {
  if (typeof privateKey !== "string" || !BASE64URL_KEY.test(privateKey) || typeof publicKey !== "string" || !BASE64URL_KEY.test(publicKey)) {
    throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  }
  let key;
  try {
    key = createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: privateKey, x: publicKey }, format: "jwk" });
  } catch {
    throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  }
  // The public half must be the one this private key makes, or every message would fail to open.
  if (createPublicKey(key).export({ format: "jwk" }).x !== publicKey) throw new FeedbackSealError("FEEDBACK_OWNER_KEY_INVALID");
  return key;
}

export function openSealedForOwner({ ownerPrivateKey, id, record, sealed }) {
  if (!sealed || sealed.suite !== FEEDBACK_SEAL_SUITE) throw new FeedbackSealError("FEEDBACK_SEAL_UNREADABLE");
  for (const field of ["epk", "iv", "tag", "ciphertext"]) {
    if (typeof sealed[field] !== "string" || !BASE64URL.test(sealed[field])) throw new FeedbackSealError("FEEDBACK_SEAL_UNREADABLE");
  }
  if (!BASE64URL_KEY.test(sealed.epk)) throw new FeedbackSealError("FEEDBACK_SEAL_UNREADABLE");
  const iv = Buffer.from(sealed.iv, "base64url");
  const tag = Buffer.from(sealed.tag, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new FeedbackSealError("FEEDBACK_SEAL_UNREADABLE");
  let key;
  try {
    const ephemeralPublic = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: sealed.epk }, format: "jwk" });
    const sharedSecret = diffieHellman({ privateKey: ownerPrivateKey, publicKey: ephemeralPublic });
    key = deriveMessageKey({
      sharedSecret,
      ephemeralPublicRaw: Buffer.from(sealed.epk, "base64url"),
      ownerPublicRaw: rawPublicKey(createPublicKey(ownerPrivateKey)),
      id
    });
    sharedSecret.fill(0);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(canonicalJson(record), "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new FeedbackSealError("FEEDBACK_SEAL_UNREADABLE");
  } finally {
    key?.fill(0);
  }
}
