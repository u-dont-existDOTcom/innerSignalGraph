import { ValidationError } from "../core/errors.mjs";
import { journalSchema } from "./contracts.mjs";

const extractionSchema = journalSchema("extraction-result");
const reviewSchema = journalSchema("review-result");
const coverageDispositions = extractionSchema.properties.coverage.items.properties.disposition.enum;
const outcomes = reviewSchema.properties.assessments.items.properties.outcome.enum;
const findingTypes = reviewSchema.properties.assessments.items.properties.finding_type.enum;

function schemaEnums(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) schemaEnums(item, found);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.enum)) for (const item of value.enum) found.add(item);
    for (const child of Object.values(value)) schemaEnums(child, found);
  }
  return found;
}

// These codes originate in mechanical binding, never in model output. An unknown future code
// gets a fixed placeholder instead of changing a recoverable failure into a runtime exception.
const bindingCodes = new Set([
  "BINDING_FAILURE_CODE_UNRECOGNIZED",
  "JOURNAL_SCHEMA_INVALID", "JOURNAL_SCHEMA_UNKNOWN", "DUPLICATE_LOCAL_ASSERTION_ID", "MISSING_LOCAL_SPEAKER",
  "MISSING_LOCAL_SUBJECT", "MISSING_LOCAL_EPISODE", "ANCHOR_OUTSIDE_ASSIGNED_UNITS",
  "DUPLICATE_UNIT_COVERAGE", "COVERAGE_UNKNOWN_ASSERTION", "UNIT_COVERAGE_INCOMPLETE",
  "BATCH_EXTRACTION_CROSS_UNIT_PROPOSAL", "BATCH_EXTRACTION_UNIT_IDS_INVALID",
  "BATCH_EXTRACTION_ENTITY_ID_DUPLICATE", "BATCH_EXTRACTION_EPISODE_ID_DUPLICATE",
  "BATCH_EXTRACTION_ANCHOR_OUTSIDE_BATCH", "BATCH_EXTRACTION_CONTEXT_OUTSIDE_BATCH",
  "BATCH_EXTRACTION_UNIT_COVERAGE_INVALID", "ANCHOR_UNIT_NOT_FOUND",
  "VISUAL_ANCHOR_REQUIRES_VERIFIED_TRANSCRIPTION", "TIME_EVIDENCE_REFERENCE_UNRESOLVED",
  "INVALID_QUOTE", "MALFORMED_UNICODE", "QUOTE_NOT_FOUND", "QUOTE_AMBIGUOUS",
  "QUOTE_OCCURRENCE_INVALID", "GRAPH_SOURCE_INVALID", "FALSE_TIME_PRECISION",
  "INVALID_TIME_BOUND", "INVALID_TIME_INTERVAL", "TIME_WITHOUT_EVIDENCE",
  "ASSERTION_WITHOUT_SOURCE", "IMPORT_PROMOTED_TO_CURRENT", "DREAM_SCOPE_LOST",
  "IMAGINAL_SCOPE_LOST", "EVIDENCE_EDGE_MISMATCH", "SPAN_INTEGRITY_FAILED",
  "CROSS_CASE_OR_CORPUS", "DUPLICATE_GRAPH_ID", "UNKNOWN_NODE_KIND",
  "DANGLING_OR_WRONG_KIND", "INVALID_EVIDENCE", "ACTIVE_DEPENDS_ON_REVOKED",
  "REPRESENTATION_MISSING", "REPRESENTATION_LENGTH_MISMATCH", "SPAN_RANGE_INVALID",
  "RESTRICTED_QUOTE_EXPOSED", "PASSAGE_SOURCE_BINDING_MISSING", "PATTERN_WITHOUT_SUPPORT",
  "PATTERN_REVOKED_SUPPORT", "RECURRENCE_FROM_ONE_EPISODE", "ACTIVE_EDGE_TO_REVOKED",
  "EDGE_WITHOUT_EVIDENCE", "DERIVATION_MISSING", "UNAUTHORIZED_EDGE_TYPE",
  "CORRECTION_WITHOUT_CORRECTION_ASSERTION", "CAUSAL_PROMOTION",
  "INTENTION_CONFUSED_WITH_EFFECTIVE_ACTION", "TIME_MISSING", "REPRESENTATIONS_INVALID",
  "UNITS_INVALID", "RESTRICTED_UNIT_INVALID", "RESTRICTED_STATEMENT_INVALID",
  "RESTRICTED_REVIEW_STATE_INVALID", "JOURNAL_REPRESENTATION_MISSING", "VALIDATION_ERROR",
  "PATTERN_REVIEW_EVIDENCE_MISSING", "PASS_STRUCTURAL_GRAPH_ONLY"
]);
const blockerCodes = new Set(["INVALID_STRUCTURED_OUTPUT", "OUTPUT_INCOMPLETE",
  "REFERENCE_RESEND_EXHAUSTED", "COMPLETION_UNKNOWN", "HARDEST_DAILY_LIMIT"]);
const permittedValues = new Set([...schemaEnums(extractionSchema), ...schemaEnums(reviewSchema), ...bindingCodes, ...blockerCodes]);
const permittedKeys = new Set([
  "cycles", "cycle", "hardest", "fidelity_cycles", "fidelity", "findings_per_cycle", "extraction", "omission", "invalid", "blocker_code",
  "binding_failure_code", "status", "assertions", "entities", "episodes",
  "requested_context", "coverage_by_disposition", "assessments_by_outcome_and_finding_type",
  "critical_assessments", "proposed_repairs", "unassessed", "findings",
  "critical_miss_count", "qualifier_error_count", "target_met",
  ...coverageDispositions, ...outcomes, ...findingTypes
]);

export function validateCalibrationDiagnostics(value) {
  const walk = (item) => {
    if (item === null) return;
    if (typeof item === "string") {
      if (!permittedValues.has(item)) throw new ValidationError("JOURNAL_DIAGNOSTICS_STRING_UNSAFE", { code: "JOURNAL_DIAGNOSTICS_STRING_UNSAFE" });
      return;
    }
    if (typeof item === "boolean" || (typeof item === "number" && Number.isSafeInteger(item) && item >= 0)) return;
    if (Array.isArray(item)) { for (const child of item) walk(child); return; }
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      for (const [key, child] of Object.entries(item)) {
        if (!permittedKeys.has(key)) throw new ValidationError("JOURNAL_DIAGNOSTICS_STRING_UNSAFE", { code: "JOURNAL_DIAGNOSTICS_STRING_UNSAFE" });
        walk(child);
      }
      return;
    }
    throw new ValidationError("JOURNAL_DIAGNOSTICS_VALUE_UNSAFE", { code: "JOURNAL_DIAGNOSTICS_VALUE_UNSAFE" });
  };
  walk(value);
  return value;
}

const countBy = (items, field, values) => Object.fromEntries(values.map((value) => [
  value, items.filter((item) => item[field] === value).length
]));

export function extractionCycleDiagnostics(results, bindingFailureCode = null) {
  const extraction = results?.[0]?.output ?? null;
  const review = results?.[1]?.output ?? null;
  return {
    extraction: extraction ? {
      status: extraction.status,
      assertions: extraction.assertions.length,
      entities: extraction.entities.length,
      episodes: extraction.episodes.length,
      requested_context: extraction.requested_context.length,
      coverage_by_disposition: countBy(extraction.coverage, "disposition", coverageDispositions)
    } : null,
    omission: review ? {
      status: review.status,
      assessments_by_outcome_and_finding_type: Object.fromEntries(outcomes.map((outcome) => [outcome,
        countBy(review.assessments.filter((item) => item.outcome === outcome), "finding_type", findingTypes)])),
      critical_assessments: review.assessments.filter((item) => item.critical === true).length,
      proposed_repairs: review.proposed_repairs.length,
      unassessed: review.unassessed_ids.length,
      findings: review.assessments.filter((item) => item.outcome !== "preserved" || item.finding_type !== "none").length
        + review.unassessed_ids.length
    } : null,
    binding_failure_code: bindingFailureCode === null ? null
      : bindingCodes.has(bindingFailureCode) ? bindingFailureCode : "BINDING_FAILURE_CODE_UNRECOGNIZED"
  };
}

export function fidelityCycleDiagnostics(status, score, targetMet) {
  return { status, critical_miss_count: score.critical_miss_count,
    qualifier_error_count: score.qualifier_error_count,
    unassessed: score.reference_counts.unassessed, target_met: targetMet };
}

export function unresolvedExtractionDiagnostics(cycles, hardest = null, fidelityCycles = []) {
  const value = {
    cycles,
    hardest,
    fidelity_cycles: fidelityCycles,
    findings_per_cycle: cycles.map(({ omission, binding_failure_code }) =>
      binding_failure_code || !omission ? null : omission.findings)
  };
  try { return validateCalibrationDiagnostics(value); }
  catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { invalid: true };
  }
}

export function diagnosticBlockerCode(code) {
  return blockerCodes.has(code) ? code : null;
}
