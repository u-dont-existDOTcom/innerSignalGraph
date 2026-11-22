import { createHash, randomBytes } from "node:crypto";

// Deletion codes and message ids (design section 6). A code is 80 random bits shown as four groups of four characters from
// Crockford's base-32 alphabet. The message's id is derived from the code one way, so the code finds its message directly and the
// server keeps nothing from which the code can be recovered.

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;
const ID_LENGTH = 20;
const DELETE_LABEL = "inner-signal:feedback:delete:v1:";
export const FEEDBACK_ID_PATTERN = /^fb_[0-9A-HJKMNP-TV-Z]{20}$/u;

function base32(bytes, length) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += CODE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= length) break;
  }
  return out;
}

export function newDeletionCode(random = randomBytes) {
  const raw = base32(random(10), CODE_LENGTH);
  return raw.match(/.{4}/gu).join("-");
}

// What a person types back: lower case, spaces and hyphens anywhere, and the letters Crockford reads as digits (O as 0, I and L
// as 1). Anything else, or the wrong length, is not a code.
export function normalizeDeletionCode(input) {
  if (typeof input !== "string" || input.length > 64) return null;
  const cleaned = input.toUpperCase().replace(/[\s-]+/gu, "").replace(/O/gu, "0").replace(/[IL]/gu, "1");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const character of cleaned) if (!CODE_ALPHABET.includes(character)) return null;
  return cleaned;
}

export function feedbackIdForCode(code) {
  const normalized = normalizeDeletionCode(code);
  if (!normalized) return null;
  const digest = createHash("sha256").update(`${DELETE_LABEL}${normalized}`, "utf8").digest();
  return `fb_${base32(digest, ID_LENGTH)}`;
}
