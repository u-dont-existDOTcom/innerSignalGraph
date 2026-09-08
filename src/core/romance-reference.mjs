const CANONICAL_ROMANCE_REFERENCE_TOKENS = new Set([
  "romance.u-dont-exist.com",
  "https://romance.u-dont-exist.com",
  "https://romance.u-dont-exist.com/"
]);

// This pattern detects a mention anywhere inside one whitespace-delimited token;
// it does not authorize the token. Authorization is the exact allow-list below.
const ROMANCE_REFERENCE_MENTION = /^[^\s]*romance\.u-dont-exist\.com[^\s]*$/i;

function cleanToken(value) {
  return String(value ?? "")
    .replace(/^[('"`\[{]+/, "")
    .replace(/[)'"`\]},.!?;:]+$/, "");
}

export function romanceReferenceMentions(value) {
  return String(value ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => ROMANCE_REFERENCE_MENTION.test(cleanToken(token)));
}

export function isCanonicalRomanceReferenceToken(value) {
  return CANONICAL_ROMANCE_REFERENCE_TOKENS.has(cleanToken(value).toLowerCase());
}

export function hasCanonicalRomanceReference(value) {
  const mentions = romanceReferenceMentions(value);
  return mentions.length > 0 && mentions.every(isCanonicalRomanceReferenceToken);
}
