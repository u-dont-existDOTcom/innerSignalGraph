import { ValidationError } from "../core/errors.mjs";
import { REPAIR_INDUCED_ERROR_CHECKS, validateCandidateAuditFinding } from "../supervisor/private-candidate-lifecycle.mjs";

const stringArray = { type: "array", items: { type: "string" } };

export const privateRuntimeAuditResultSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "substantive", "high"] },
          summary: { type: "string" },
          evidence_turn_ids: stringArray
        },
        required: ["id", "code", "severity", "summary"]
      }
    },
    repair_induced_checks: stringArray
  },
  required: ["findings", "repair_induced_checks"]
});

export const privateRuntimeRepairResultSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: { exact_text: { type: "string" } },
  required: ["exact_text"]
});

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new ValidationError(`${label} contains forbidden fields: ${unexpected.join(", ")}.`);
}

export function validatePrivateRuntimeAuditResult(value, { reconstructed = false } = {}) {
  exactKeys(value, ["findings", "repair_induced_checks"], "Private runtime audit result");
  if (!Array.isArray(value.findings)) throw new ValidationError("Private runtime audit findings must be an array.");
  for (const [index, finding] of value.findings.entries()) {
    exactKeys(finding, ["id", "code", "severity", "summary", "evidence_turn_ids"], `Private runtime audit findings[${index}]`);
    validateCandidateAuditFinding(finding, index);
  }
  if (!Array.isArray(value.repair_induced_checks) || value.repair_induced_checks.some((entry) => typeof entry !== "string")) {
    throw new ValidationError("Private runtime audit repair_induced_checks must be an array of strings.");
  }
  const expected = reconstructed ? REPAIR_INDUCED_ERROR_CHECKS : [];
  if (JSON.stringify(value.repair_induced_checks) !== JSON.stringify(expected)) {
    throw new ValidationError("Private runtime audit did not return the exact required repair-induced checklist.");
  }
  return value;
}

export function validatePrivateRuntimeRepairResult(value) {
  exactKeys(value, ["exact_text"], "Private runtime repair result");
  if (typeof value.exact_text !== "string" || !value.exact_text.trim() || value.exact_text.length > 100_000) {
    throw new ValidationError("Private runtime repair exact_text is invalid.");
  }
  return value;
}
