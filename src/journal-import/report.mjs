import { ValidationError } from "../core/errors.mjs";

export function createContentFreeAuditReport({ generation, sample, score, certification, patternReview }) {
  if (!generation || !sample || !score || !certification) throw new ValidationError("AUDIT_REPORT_INPUT_INVALID", { code: "AUDIT_REPORT_INPUT_INVALID" });
  return Object.freeze({
    schema_version: "1.0",
    generation,
    probability_sample: {
      selected_units: sample.inclusion_ledger.length,
      strata: sample.strata,
      seed_sha256: sample.seed_sha256,
      targeted_challenge_units: sample.targeted_challenge.length,
      targeted_is_population_estimate: false
    },
    reference_review: {
      total: score.reference_total,
      preserved: score.reference_counts.preserved,
      omitted: score.reference_counts.omitted,
      distorted: score.reference_counts.distorted,
      unassessed: score.reference_counts.unassessed,
      recall_for_stated_reference_set: score.reference_recall,
      qualifier_errors: score.qualifier_error_count,
      critical_misses: score.critical_miss_count,
      provisional_target_met: score.provisional_target_met,
      global_recall_claim: false
    },
    semantic_audit: certification.semantically_audited,
    semantic_audit_reasons: [...certification.reasons],
    patterns_reviewed: patternReview?.patterns_reviewed ?? "not_run"
  });
}
