export const IDENTIFIABILITY_CATEGORIES = Object.freeze([
  "email",
  "phone",
  "exact-address-like",
  "account-id",
  "abs-local-path"
]);

const CATEGORY_PATTERNS = Object.freeze({
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  phone: /(?:\+?\d[\d .()-]{7,}\d)/u,
  "exact-address-like": /\b\d{1,6}\s+[\p{L}][\p{L} .'-]{1,80}\s(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd)\b/iu,
  "account-id": /\b(?:account|customer|member|patient)[\s_-]*(?:id|number|no)[\s:#-]*[A-Z0-9][A-Z0-9_-]{4,}\b/iu,
  "abs-local-path": /(?:^|\s)(?:\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|[A-Z]:\\[^\s]+\\[^\s]+)/u
});

export function scanIdentifiability(value) {
  if (typeof value !== "string") throw new TypeError("Identifiability input must be a string.");
  const categories = IDENTIFIABILITY_CATEGORIES.filter((category) => CATEGORY_PATTERNS[category].test(value));
  return Object.freeze({
    warningRequired: true,
    categories: Object.freeze(categories),
    containsPotentialIdentifiers: categories.length > 0,
    anonymous: false,
    nonIdentifying: false,
    anonymizer: false,
    limitation: "A clean pattern scan cannot establish anonymity; ordinary facts and combinations of facts may identify a person."
  });
}
