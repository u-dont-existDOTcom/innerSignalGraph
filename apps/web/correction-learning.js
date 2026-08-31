export const POTENTIAL_LESSON_FORMAT = "inner-signal-private-potential-lesson-v1";
export const CORRECTION_DETECTOR_VERSION = "private-correction-signal-v1";

export const POTENTIAL_LESSON_CATEGORIES = Object.freeze([
  "did-not-work",
  "did-not-make-sense",
  "disagreement",
  "correction",
  "other"
]);

const CAPTURE_SOURCES = Object.freeze([
  "automatic-local-correction-detector",
  "explicit-save-potential-lesson"
]);
const STATUSES = Object.freeze([
  "captured-private-stub",
  "reviewed-private-candidate",
  "governance-review-candidate",
  "dismissed"
]);
const DISPOSITIONS = Object.freeze([
  "pending-review",
  "keep-private-candidate",
  "queue-for-governance-review",
  "dismissed"
]);
const TRIGGER_CODES = Object.freeze([
  "DID_NOT_WORK_DIRECTED",
  "DID_NOT_MAKE_SENSE_DIRECTED",
  "EXPLICIT_CORRECTION_DIRECTED",
  "EXPLICIT_DISAGREEMENT_DIRECTED",
  "EXPLICIT_MANUAL_SAVE"
]);
const HISTORY_ACTIONS = Object.freeze([
  "captured-automatically",
  "captured-manually",
  "kept-private",
  "queued-for-governance-review",
  "dismissed"
]);
const REQUIRED_FIELDS = Object.freeze([
  "format",
  "potentialLessonId",
  "category",
  "captureSource",
  "triggerCode",
  "detectorVersion",
  "status",
  "summary",
  "summaryAuthorship",
  "privacyAcknowledged",
  "sourceContentRetained",
  "conversationImported",
  "automaticCategoryDetection",
  "automaticTextExtraction",
  "communitySharing",
  "productImprovement",
  "researchUse",
  "runtimeAuthority",
  "therapyPolicyAuthority",
  "createdAt",
  "updatedAt",
  "reviewedAt",
  "disposition",
  "history"
].sort());

const SIGNALS = Object.freeze([
  {
    category: "did-not-work",
    triggerCode: "DID_NOT_WORK_DIRECTED",
    expression: /\b(?:that|this|it) (?:didn't|did not) work\b/
  },
  {
    category: "did-not-make-sense",
    triggerCode: "DID_NOT_MAKE_SENSE_DIRECTED",
    expression: /\b(?:(?:that|this) (?:doesn't|does not) make sense|(?:that|this) makes no sense)\b/
  },
  {
    category: "correction",
    triggerCode: "EXPLICIT_CORRECTION_DIRECTED",
    expression: /(?:\b(?:that's|that is|you're|you are) wrong\b|\byou misunderstood(?: me)?\b|\bi meant\b|\bcorrection\s*:)/
  },
  {
    category: "disagreement",
    triggerCode: "EXPLICIT_DISAGREEMENT_DIRECTED",
    expression: /\bi (?:disagree|don't agree|do not agree)\b/
  }
]);

function fail(message) {
  throw new Error(`Invalid private potential lesson: ${message}`);
}

function normalizeMessage(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()
    : "";
}

function isoTimestamp(value, label) {
  if (typeof value !== "string") fail(`${label} must be an ISO timestamp`);
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString() !== value) fail(`${label} must be an ISO timestamp`);
  return value;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains unsupported or missing fields`);
  }
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) return `pl-${globalThis.crypto.randomUUID()}`;
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function defaultNow() {
  return new Date().toISOString();
}

export function detectCorrectionSignal(userMessage) {
  const normalized = normalizeMessage(userMessage);
  if (!normalized) return null;
  for (const signal of SIGNALS) {
    if (signal.expression.test(normalized)) {
      return { category: signal.category, triggerCode: signal.triggerCode };
    }
  }
  return null;
}

export function validatePotentialLesson(candidate) {
  exactKeys(candidate, REQUIRED_FIELDS, "candidate");
  if (candidate.format !== POTENTIAL_LESSON_FORMAT) fail("format is unsupported");
  if (typeof candidate.potentialLessonId !== "string" || !/^pl-[A-Za-z0-9-]{8,100}$/.test(candidate.potentialLessonId)) fail("potentialLessonId is invalid");
  if (!POTENTIAL_LESSON_CATEGORIES.includes(candidate.category)) fail("category is unsupported");
  if (!CAPTURE_SOURCES.includes(candidate.captureSource)) fail("captureSource is unsupported");
  if (!TRIGGER_CODES.includes(candidate.triggerCode)) fail("triggerCode is unsupported");
  if (candidate.detectorVersion !== CORRECTION_DETECTOR_VERSION) fail("detectorVersion is unsupported");
  if (!STATUSES.includes(candidate.status)) fail("status is unsupported");
  if (typeof candidate.summary !== "string" || candidate.summary.length > 1_000) fail("summary must be at most 1000 characters");
  if (!['none', 'user'].includes(candidate.summaryAuthorship)) fail("summaryAuthorship is unsupported");
  if ((candidate.summary.length === 0) !== (candidate.summaryAuthorship === "none")) fail("summaryAuthorship must match summary presence");
  if (typeof candidate.privacyAcknowledged !== "boolean") fail("privacyAcknowledged must be boolean");
  if (candidate.summary && !candidate.privacyAcknowledged) fail("a summary requires privacy acknowledgement");
  for (const field of ["sourceContentRetained", "conversationImported", "automaticTextExtraction", "communitySharing", "productImprovement", "researchUse"]) {
    if (candidate[field] !== false) fail(`${field} must remain false`);
  }
  if (typeof candidate.automaticCategoryDetection !== "boolean") fail("automaticCategoryDetection must be boolean");
  if (candidate.automaticCategoryDetection !== (candidate.captureSource === "automatic-local-correction-detector")) fail("automaticCategoryDetection must match captureSource");
  if (candidate.runtimeAuthority !== "none") fail("runtimeAuthority must remain none");
  if (candidate.therapyPolicyAuthority !== "none") fail("therapyPolicyAuthority must remain none");
  isoTimestamp(candidate.createdAt, "createdAt");
  isoTimestamp(candidate.updatedAt, "updatedAt");
  if (candidate.reviewedAt !== null) isoTimestamp(candidate.reviewedAt, "reviewedAt");
  if (!DISPOSITIONS.includes(candidate.disposition)) fail("disposition is unsupported");
  if (candidate.disposition === "pending-review" && candidate.status !== "captured-private-stub") fail("pending candidates must remain captured stubs");
  if (candidate.disposition === "queue-for-governance-review" && (!candidate.summary || !candidate.privacyAcknowledged)) fail("governance review requires an acknowledged user summary");
  if (!Array.isArray(candidate.history) || candidate.history.length < 1 || candidate.history.length > 100) fail("history is invalid");
  for (const entry of candidate.history) {
    exactKeys(entry, ["action", "at"], "history entry");
    if (!HISTORY_ACTIONS.includes(entry.action)) fail("history action is unsupported");
    isoTimestamp(entry.at, "history timestamp");
  }
  return candidate;
}

function createCandidate({ category, captureSource, triggerCode, automaticCategoryDetection, id = defaultId(), now = defaultNow() }) {
  const candidate = {
    format: POTENTIAL_LESSON_FORMAT,
    potentialLessonId: id,
    category,
    captureSource,
    triggerCode,
    detectorVersion: CORRECTION_DETECTOR_VERSION,
    status: "captured-private-stub",
    summary: "",
    summaryAuthorship: "none",
    privacyAcknowledged: false,
    sourceContentRetained: false,
    conversationImported: false,
    automaticCategoryDetection,
    automaticTextExtraction: false,
    communitySharing: false,
    productImprovement: false,
    researchUse: false,
    runtimeAuthority: "none",
    therapyPolicyAuthority: "none",
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    disposition: "pending-review",
    history: [{ action: automaticCategoryDetection ? "captured-automatically" : "captured-manually", at: now }]
  };
  return validatePotentialLesson(candidate);
}

export function createAutomaticPotentialLesson(userMessage, options = {}) {
  const detection = detectCorrectionSignal(userMessage);
  if (!detection) return null;
  return createCandidate({
    ...options,
    ...detection,
    captureSource: "automatic-local-correction-detector",
    automaticCategoryDetection: true
  });
}

export function createManualPotentialLesson(options = {}) {
  return createCandidate({
    ...options,
    category: "other",
    captureSource: "explicit-save-potential-lesson",
    triggerCode: "EXPLICIT_MANUAL_SAVE",
    automaticCategoryDetection: false
  });
}

export function reviewPotentialLesson(candidate, { category, summary = "", privacyAcknowledged = false, disposition, now = defaultNow() }) {
  validatePotentialLesson(candidate);
  if (!POTENTIAL_LESSON_CATEGORIES.includes(category)) fail("review category is unsupported");
  if (!["keep-private-candidate", "queue-for-governance-review", "dismissed"].includes(disposition)) fail("review disposition is unsupported");
  const normalizedSummary = typeof summary === "string" ? summary.trim() : "";
  if (normalizedSummary.length > 1_000) fail("summary must be at most 1000 characters");
  if (normalizedSummary && privacyAcknowledged !== true) fail("a summary requires privacy acknowledgement");
  if (disposition === "queue-for-governance-review" && (!normalizedSummary || privacyAcknowledged !== true)) {
    fail("governance review requires an acknowledged user summary");
  }
  const status = {
    "keep-private-candidate": "reviewed-private-candidate",
    "queue-for-governance-review": "governance-review-candidate",
    dismissed: "dismissed"
  }[disposition];
  const action = {
    "keep-private-candidate": "kept-private",
    "queue-for-governance-review": "queued-for-governance-review",
    dismissed: "dismissed"
  }[disposition];
  return validatePotentialLesson({
    ...candidate,
    category,
    status,
    summary: normalizedSummary,
    summaryAuthorship: normalizedSummary ? "user" : "none",
    privacyAcknowledged: normalizedSummary ? true : false,
    updatedAt: now,
    reviewedAt: now,
    disposition,
    history: [...candidate.history, { action, at: now }]
  });
}

export function restorePotentialLessons(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("potentialLessons must be an array");
  const restored = value.map((candidate) => validatePotentialLesson(structuredClone(candidate)));
  const ids = new Set(restored.map((candidate) => candidate.potentialLessonId));
  if (ids.size !== restored.length) fail("potentialLessonId values must be unique");
  return restored;
}

export function deletePotentialLesson(value, potentialLessonId) {
  const candidates = restorePotentialLessons(value);
  if (typeof potentialLessonId !== "string") fail("delete id is invalid");
  return candidates.filter((candidate) => candidate.potentialLessonId !== potentialLessonId);
}
