import { ValidationError } from "../core/errors.mjs";

export const COMMUNITY_FORMAT = "inner-signal-community-state-v1";
export const CONSENT_TEXT_VERSION = "innersignal-community-consent-2026-08-30-v1";
export const SESSION_COOKIE = "inner_signal_commons";

export const ROOMS = Object.freeze([
  "using-innersignal",
  "inner-child-parts",
  "meditation-awareness",
  "somatic-practices",
  "self-hypnosis",
  "sleep",
  "relationships-daily-life",
  "governance-learning"
]);

export const RESPONSE_CONTRACTS = Object.freeze([
  "listen-only",
  "similar-experiences",
  "questions-welcome",
  "practical-ideas",
  "challenge-interpretation",
  "help-field-note"
]);

export const REPLY_TYPES = Object.freeze([
  "witness",
  "similar-experience",
  "question",
  "practical-idea",
  "challenge"
]);

export const SOCIAL_REACTIONS = Object.freeze(["relate", "thanks", "less-alone"]);
export const EVIDENCE_REACTIONS = Object.freeze([
  "similar-result",
  "different-result",
  "no-noticeable-effect",
  "made-things-worse",
  "context-important",
  "confounded"
]);

export const CONSENT_SCOPES = Object.freeze([
  "ai-redaction",
  "community-aggregate",
  "product-improvement",
  "experiment-contact",
  "research-protocol",
  "external-researcher-sharing"
]);

export const OUTCOMES = Object.freeze(["benefit", "no-change", "mixed", "worsening", "unclear"]);
export const WOULD_REPEAT = Object.freeze(["yes", "no", "unsure"]);
export const POTENTIAL_LESSON_CATEGORIES = Object.freeze([
  "did-not-work",
  "did-not-make-sense",
  "disagreement",
  "correction",
  "other"
]);

const RESPONSE_REPLY_POLICY = Object.freeze({
  "listen-only": new Set(["witness"]),
  "similar-experiences": new Set(["witness", "similar-experience"]),
  "questions-welcome": new Set(["witness", "similar-experience", "question"]),
  "practical-ideas": new Set(["witness", "similar-experience", "question", "practical-idea"]),
  "challenge-interpretation": new Set(REPLY_TYPES),
  "help-field-note": new Set(["witness", "question", "practical-idea"])
});

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, label, allowed) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new ValidationError(`${label} contains unsupported fields.`);
}

function string(value, label, { min = 1, max = 10_000, allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new ValidationError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!allowEmpty && normalized.length < min) throw new ValidationError(`${label} is required.`);
  if (normalized.length > max) throw new ValidationError(`${label} must be at most ${max} characters.`);
  return normalized;
}

function optionalString(value, label, options = {}) {
  if (value == null || value === "") return "";
  return string(value, label, { allowEmpty: true, ...options });
}

function enumValue(value, label, allowed) {
  if (!allowed.includes(value)) throw new ValidationError(`${label} is invalid.`);
  return value;
}

function stringArray(value, label, allowed = null, { max = 20 } = {}) {
  if (!Array.isArray(value)) throw new ValidationError(`${label} must be an array.`);
  if (value.length > max) throw new ValidationError(`${label} has too many values.`);
  const normalized = [...new Set(value.map((item, index) => string(item, `${label}[${index}]`, { max: 120 })) )];
  if (allowed && normalized.some((item) => !allowed.includes(item))) throw new ValidationError(`${label} contains an invalid value.`);
  return normalized;
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ValidationError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function normalizePseudonym(value) {
  const pseudonym = string(value, "pseudonym", { min: 2, max: 40 });
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u.test(pseudonym)) {
    throw new ValidationError("pseudonym contains unsupported characters.");
  }
  return pseudonym.replace(/\s+/g, " ");
}

export function validateSessionRequest(value) {
  object(value, "session request");
  if (value.adultConfirmed !== true) throw new ValidationError("You must confirm that you are at least 18 years old.");
  if (value.communityAgreementAccepted !== true) throw new ValidationError("You must accept the Commons participation boundary.");
  return {
    pseudonym: normalizePseudonym(value.pseudonym),
    inviteCode: optionalString(value.inviteCode, "inviteCode", { max: 200 }),
    recoveryCode: optionalString(value.recoveryCode, "recoveryCode", { max: 200 }),
    adultConfirmed: true,
    communityAgreementAccepted: true
  };
}

export function validatePostInput(value) {
  object(value, "post");
  return {
    room: enumValue(value.room, "post.room", ROOMS),
    title: string(value.title, "post.title", { min: 4, max: 140 }),
    body: string(value.body, "post.body", { min: 10, max: 12_000 }),
    responseContract: enumValue(value.responseContract, "post.responseContract", RESPONSE_CONTRACTS),
    contentNote: optionalString(value.contentNote, "post.contentNote", { max: 180 })
  };
}

export function validateReplyInput(value, responseContract) {
  object(value, "reply");
  const replyType = enumValue(value.replyType, "reply.replyType", REPLY_TYPES);
  const allowed = RESPONSE_REPLY_POLICY[responseContract];
  if (!allowed?.has(replyType)) {
    throw new ValidationError(`reply.replyType is not allowed by the post's ${responseContract} response contract.`);
  }
  return {
    replyType,
    body: string(value.body, "reply.body", { min: 2, max: 5_000 })
  };
}

export function validateReactionInput(value) {
  object(value, "reaction");
  const channel = enumValue(value.channel, "reaction.channel", ["social", "evidence"]);
  const allowed = channel === "social" ? SOCIAL_REACTIONS : EVIDENCE_REACTIONS;
  return { channel, value: enumValue(value.value, "reaction.value", allowed) };
}

export function validateFieldNoteInput(value) {
  object(value, "field note");
  const outcomes = object(value.outcomes ?? {}, "fieldNote.outcomes");
  const consentScopes = stringArray(value.consentScopes ?? [], "fieldNote.consentScopes", CONSENT_SCOPES, { max: CONSENT_SCOPES.length });
  if (consentScopes.includes("external-researcher-sharing") && !consentScopes.includes("research-protocol")) {
    throw new ValidationError("External researcher sharing requires a defined research-protocol consent scope.");
  }
  return {
    sourcePostId: optionalString(value.sourcePostId, "fieldNote.sourcePostId", { max: 80 }),
    practiceOrFeature: string(value.practiceOrFeature, "fieldNote.practiceOrFeature", { min: 2, max: 160 }),
    goal: string(value.goal, "fieldNote.goal", { min: 2, max: 500 }),
    whatTried: string(value.whatTried, "fieldNote.whatTried", { min: 2, max: 4_000 }),
    context: optionalString(value.context, "fieldNote.context", { max: 2_000 }),
    priorExperience: optionalString(value.priorExperience, "fieldNote.priorExperience", { max: 1_000 }),
    outcomes: {
      immediate: optionalString(outcomes.immediate, "fieldNote.outcomes.immediate", { max: 2_000 }),
      laterSameDay: optionalString(outcomes.laterSameDay, "fieldNote.outcomes.laterSameDay", { max: 2_000 }),
      nextMorning: optionalString(outcomes.nextMorning, "fieldNote.outcomes.nextMorning", { max: 2_000 }),
      followingTwoToThreeDays: optionalString(outcomes.followingTwoToThreeDays, "fieldNote.outcomes.followingTwoToThreeDays", { max: 2_000 }),
      longerFollowUp: optionalString(outcomes.longerFollowUp, "fieldNote.outcomes.longerFollowUp", { max: 2_000 })
    },
    overallOutcome: enumValue(value.overallOutcome, "fieldNote.overallOutcome", OUTCOMES),
    downsides: optionalString(value.downsides, "fieldNote.downsides", { max: 2_000 }),
    confounders: optionalString(value.confounders, "fieldNote.confounders", { max: 2_000 }),
    wouldRepeat: enumValue(value.wouldRepeat, "fieldNote.wouldRepeat", WOULD_REPEAT),
    causalConfidence: integer(value.causalConfidence, "fieldNote.causalConfidence", { min: 0, max: 100 }),
    consentScopes
  };
}

export function validatePotentialLessonInput(value) {
  object(value, "potential lesson");
  exactKeys(value, "potential lesson", ["category", "summary", "privacyAcknowledged"]);
  const summary = optionalString(value.summary, "potentialLesson.summary", { max: 1_000 });
  const privacyAcknowledged = value.privacyAcknowledged === true;
  if (value.privacyAcknowledged !== undefined && typeof value.privacyAcknowledged !== "boolean") {
    throw new ValidationError("potentialLesson.privacyAcknowledged must be a boolean.");
  }
  if (summary && !privacyAcknowledged) {
    throw new ValidationError("A privacy and redaction acknowledgement is required before saving a correction summary.");
  }
  return {
    category: enumValue(value.category, "potentialLesson.category", POTENTIAL_LESSON_CATEGORIES),
    summary,
    privacyAcknowledged
  };
}

export function validateWithdrawalInput(value) {
  object(value, "withdrawal");
  return {
    scopes: stringArray(value.scopes, "withdrawal.scopes", CONSENT_SCOPES, { max: CONSENT_SCOPES.length }),
    reason: optionalString(value.reason, "withdrawal.reason", { max: 500 })
  };
}

export function validateReportInput(value) {
  object(value, "report");
  return {
    category: enumValue(value.category, "report.category", [
      "immediate-danger",
      "dangerous-instructions",
      "coercive-hypnosis",
      "privacy-third-party",
      "predatory-solicitation",
      "harassment",
      "commercial-promotion",
      "other"
    ]),
    detail: optionalString(value.detail, "report.detail", { max: 1_000 })
  };
}

export function validateAccountDeletionInput(value) {
  object(value, "account deletion");
  if (value.confirmation !== "DELETE") throw new ValidationError("Account deletion requires the exact confirmation DELETE.");
  return { confirmation: "DELETE" };
}

export function validateModerationDecisionInput(value) {
  object(value, "moderation decision");
  return {
    targetType: enumValue(value.targetType, "moderation.targetType", ["post", "reply", "report"]),
    targetId: string(value.targetId, "moderation.targetId", { max: 80 }),
    decision: enumValue(value.decision, "moderation.decision", ["publish", "remove", "resolve", "escalate"]),
    note: optionalString(value.note, "moderation.note", { max: 1_000 })
  };
}

export function validateProposalExportInput(value) {
  object(value, "proposal export");
  return { cardId: string(value.cardId, "proposal.cardId", { max: 100 }) };
}

export function activeConsentScopes(grant) {
  const revoked = new Set(Array.isArray(grant?.revokedScopes) ? grant.revokedScopes : []);
  return (Array.isArray(grant?.scopes) ? grant.scopes : []).filter((scope) => !revoked.has(scope));
}

export function learningEligibility(scopes) {
  const set = new Set(scopes);
  if (set.has("product-improvement")) return "product-improvement";
  if (set.has("community-aggregate")) return "community-aggregate";
  return "private-draft";
}

export function moderationFlags(input) {
  const source = String(input ?? "");
  const rules = [
    ["immediate-danger", /\b(?:kill myself|end my life|suicide|hurt someone|kill someone)\b/i],
    ["dangerous-instructions", /\b(?:stop taking|double (?:the )?dose|take \d+\s?mg|medication dose|mix (?:these|drugs))\b/i],
    ["coercive-hypnosis", /\b(?:hypnoti[sz]e|influence|control)\b.{0,80}\b(?:without (?:their|his|her) consent|make (?:them|him|her) obey)\b/i],
    ["recovered-memory-certainty", /\b(?:hypnosis|regression)\b.{0,80}\b(?:proved|confirmed|recovered)\b.{0,50}\b(?:abuse|memory|trauma)\b/i],
    ["personal-contact-data", /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\+?\d[\d\s().-]{8,}\d)/i],
    ["commercial-solicitation", /\b(?:buy from me|discount code|book a session with me|send payment|crypto wallet)\b/i]
  ];
  return rules.filter(([, expression]) => expression.test(source)).map(([flag]) => flag);
}

export function publicReplyTypes(responseContract) {
  return [...(RESPONSE_REPLY_POLICY[responseContract] ?? [])];
}
