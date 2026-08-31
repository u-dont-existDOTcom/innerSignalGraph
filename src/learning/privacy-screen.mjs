import { validateFeedbackEvidence, validateLessonCandidate } from "./contracts.mjs";

export const PRIVACY_RISK_CODES = Object.freeze([
  "SECRET_LIKE",
  "EMAIL",
  "PHONE",
  "UUID_OR_ACCOUNT_IDENTIFIER",
  "ABSOLUTE_LOCAL_PATH",
  "IDENTIFYING_URL_QUERY",
  "RAW_CONVERSATION_FORMAT",
  "LONG_QUOTED_SPAN",
  "ADDRESS_LIKE_TEXT"
]);

const CHECKS = Object.freeze([
  ["SECRET_LIKE", /(?:\b(?:api[_ -]?key|secret|bearer|password)\b\s*[:=]|\bsk-[A-Za-z0-9_-]{12,})/i],
  ["EMAIL", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["PHONE", /(?:\+?\d[\d ().-]{8,}\d)/],
  ["UUID_OR_ACCOUNT_IDENTIFIER", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i],
  ["ABSOLUTE_LOCAL_PATH", /(?:^|\s)(?:\/(?:home|Users|mnt|var|tmp)\/[^\s]+|[A-Z]:\\Users\\[^\s]+)/i],
  ["IDENTIFYING_URL_QUERY", /https?:\/\/[^\s?]+\?[^\s]*(?:user|account|email|token|session|id)=/i],
  ["RAW_CONVERSATION_FORMAT", /(?:^|\n)\s*(?:user|assistant|system)\s*:/i],
  ["LONG_QUOTED_SPAN", /["“][^"”\n]{81,}["”]/],
  ["ADDRESS_LIKE_TEXT", /\b\d{1,6}\s+[A-Za-z][A-Za-z .'-]{2,40}\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\b/i]
]);

function serializedStrings(value) {
  const strings = [];
  const visit = (item) => {
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return strings.join("\n");
}

export function detectDeterministicPrivacyRisks(value) {
  const content = serializedStrings(value);
  return CHECKS.filter(([, pattern]) => pattern.test(content)).map(([code]) => code);
}

function validateDerivedRecord(value) {
  if (value?.format === "inner-signal-feedback-evidence-v1") return validateFeedbackEvidence(value);
  if (value?.format === "inner-signal-generalized-lesson-candidate-v1") return validateLessonCandidate(value);
  throw new TypeError("Privacy screening accepts only strict derived feedback evidence or lesson candidates, never raw conversation objects.");
}

export function screenDerivedRecord(input, { syntheticTransform = (value) => value } = {}) {
  validateDerivedRecord(input);
  const before = structuredClone(input);
  const preRiskCodes = detectDeterministicPrivacyRisks(before);
  const transformed = syntheticTransform(structuredClone(before));
  validateDerivedRecord(transformed);
  const postRiskCodes = detectDeterministicPrivacyRisks(transformed);
  const riskCodes = [...new Set([...preRiskCodes, ...postRiskCodes])];
  return Object.freeze({
    offlineStructuralPass: riskCodes.length === 0,
    riskCodes,
    liveTransmissionApproved: false
  });
}
