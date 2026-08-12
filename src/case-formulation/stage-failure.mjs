import { RuntimeError } from "../core/errors.mjs";

const AUTH_PATTERN = /(?:\b401\b|unauthori[sz]ed|authentication|not logged in|login required|sign[ -]?in required|token (?:has )?expired|expired (?:oauth|session|token)|refresh token)/i;
const MODEL_PATTERN = /(?:model[^\n]{0,80}(?:unavailable|not found|not supported|no access|not available|does not exist)|entitlement[^\n]{0,80}(?:fail|missing|denied)|access[^\n]{0,50}model[^\n]{0,50}denied)/i;
const CLI_PATTERN = /(?:CLI_INCOMPATIBLE|unknown (?:argument|option)|unexpected (?:argument|option)|unsupported (?:json )?schema|invalid (?:json )?schema|lacks required structured-output flags|output-schema[^\n]{0,80}(?:unsupported|invalid))/i;
const TRANSIENT_PATTERN = /(?:timed? out|timeout|\b429\b|rate.?limit|too many requests|overloaded|temporar(?:y|ily)|service unavailable|\b50[234]\b|ECONNRESET|EAI_AGAIN|connection (?:reset|closed|refused)|network error|stream[^\n]{0,40}(?:disconnect|closed)|transport error)/i;
const STRUCTURED_PATTERN = /(?:not valid JSON|invalid JSON|was empty|empty final message|must be (?:an? )?(?:array|object|string)|structured result|validation)/i;

function inspectableText(error) {
  const pieces = [error?.code, error?.message];
  const details = error?.details;
  if (details && typeof details === "object") {
    for (const key of ["code", "stage", "model", "stderr", "stdout", "error", "message", "reason"]) {
      const value = details[key];
      if (typeof value === "string" || typeof value === "number") pieces.push(String(value));
    }
  }
  if (error?.cause?.message) pieces.push(error.cause.message);
  return pieces.filter(Boolean).join("\n");
}

function exitStatus(error) {
  for (const value of [error?.details?.exitStatus, error?.details?.status, error?.details?.code]) {
    if (Number.isInteger(value)) return value;
  }
  const match = String(error?.message ?? "").match(/status\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function classificationFor(error) {
  const text = inspectableText(error);
  if (AUTH_PATTERN.test(text)) return { classification: "AUTH_REQUIRED", retryable: false };
  if (MODEL_PATTERN.test(text)) return { classification: "MODEL_UNAVAILABLE", retryable: false };
  if (error?.code === "CLI_INCOMPATIBLE" || CLI_PATTERN.test(text)) return { classification: "CLI_INCOMPATIBLE", retryable: false };
  if (TRANSIENT_PATTERN.test(text)) return { classification: "TRANSIENT", retryable: true };
  if (error?.code === "VALIDATION_ERROR" || STRUCTURED_PATTERN.test(text)) return { classification: "STRUCTURED_RESULT", retryable: true };
  return { classification: "PROVIDER_FAILURE", retryable: false };
}

function roleFor(stage) {
  if (stage === "case_extraction") return "extractor";
  if (stage === "case_audit") return "auditor";
  return "model-stage";
}

function actionCodeFor(classification, provider) {
  if (classification !== "AUTH_REQUIRED") return null;
  if (provider === "openai") return "CODEX_REAUTH";
  if (provider === "anthropic") return "CLAUDE_REAUTH";
  return null;
}

function messageFor({ classification, stage, provider, model, exitStatus: status }) {
  const target = `${provider}/${model} ${stage}`;
  switch (classification) {
    case "AUTH_REQUIRED":
      return `${target} requires renewed local CLI authentication.`;
    case "MODEL_UNAVAILABLE":
      return `${target} could not access the exact required model.`;
    case "CLI_INCOMPATIBLE":
      return `${target} encountered an incompatible CLI or structured-output schema contract.`;
    case "TRANSIENT":
      return `${target} encountered a transient provider or transport failure.`;
    case "STRUCTURED_RESULT":
      return `${target} returned a result that failed the required structured-output contract.`;
    default:
      return status == null
        ? `${target} failed for an unclassified provider reason.`
        : `${target} failed with provider exit status ${status}.`;
  }
}

export class CaseStageError extends RuntimeError {
  constructor(failure, { cause } = {}) {
    super(failure.message, { code: "CASE_STAGE_FAILED", cause, details: failure });
    this.name = "CaseStageError";
    Object.assign(this, failure);
  }
}

export function asCaseStageError(error, { stage, provider }) {
  if (error instanceof CaseStageError) return error;
  const providerId = provider?.id ?? "unknown";
  const model = provider?.model ?? "unknown";
  const { classification, retryable } = classificationFor(error);
  const status = exitStatus(error);
  const failure = {
    stage,
    role: roleFor(stage),
    provider: providerId,
    model,
    classification,
    retryable,
    actionCode: actionCodeFor(classification, providerId),
    message: messageFor({ classification, stage, provider: providerId, model, exitStatus: status }),
    code: error?.code ?? error?.name ?? "ERROR",
    exitStatus: status,
    occurredAt: new Date().toISOString()
  };
  return new CaseStageError(failure, { cause: error });
}

export function safeCaseStageFailure(error) {
  if (!(error instanceof CaseStageError)) return null;
  return {
    stage: error.stage,
    role: error.role,
    provider: error.provider,
    model: error.model,
    classification: error.classification,
    retryable: error.retryable,
    actionCode: error.actionCode ?? null,
    message: error.message,
    code: error.code,
    exitStatus: error.exitStatus ?? null,
    occurredAt: error.occurredAt
  };
}

export function isCaseAuditFailure(error) {
  return error instanceof CaseStageError && error.stage === "case_audit" && error.role === "auditor";
}
