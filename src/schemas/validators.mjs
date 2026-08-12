import { ValidationError } from "../core/errors.mjs";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
}

function string(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be an array of strings.`);
  }
}

export function validateCandidate(value) {
  object(value, "candidate");
  stringArray(value.direct_observations, "candidate.direct_observations");
  if (!Array.isArray(value.interpretive_hypotheses)) {
    throw new ValidationError("candidate.interpretive_hypotheses must be an array.");
  }
  for (const [index, item] of value.interpretive_hypotheses.entries()) {
    object(item, `candidate.interpretive_hypotheses[${index}]`);
    string(item.claim, `candidate.interpretive_hypotheses[${index}].claim`);
    string(item.support, `candidate.interpretive_hypotheses[${index}].support`);
    if (!["low", "medium", "high"].includes(item.confidence)) {
      throw new ValidationError(`candidate.interpretive_hypotheses[${index}].confidence is invalid.`);
    }
    stringArray(item.alternatives, `candidate.interpretive_hypotheses[${index}].alternatives`);
  }
  stringArray(value.guide_basis, "candidate.guide_basis");
  stringArray(value.unresolved_questions, "candidate.unresolved_questions");
  string(value.proposed_intervention, "candidate.proposed_intervention");
  string(value.response_draft, "candidate.response_draft");
  stringArray(value.risk_flags, "candidate.risk_flags");
  return value;
}

export function validateCritique(value) {
  object(value, "critique");
  for (const key of [
    "strongest_insights",
    "unsupported_assignments",
    "generic_therapy_scripts",
    "missed_user_language",
    "premature_siding",
    "age_or_agency_conflations",
    "guide_misapplications",
    "safety_or_memory_risks",
    "required_corrections"
  ]) {
    stringArray(value[key], `critique.${key}`);
  }
  if (!["accept", "revise", "reject"].includes(value.verdict)) {
    throw new ValidationError("critique.verdict must be accept, revise, or reject.");
  }
  return value;
}

export function validateAdjudication(value) {
  object(value, "adjudication");
  string(value.answer, "adjudication.answer");
  stringArray(value.what_is_clear, "adjudication.what_is_clear");
  stringArray(value.uncertainties, "adjudication.uncertainties");
  string(value.next_question, "adjudication.next_question", { allowEmpty: true });
  stringArray(value.accepted_insights, "adjudication.accepted_insights");
  stringArray(value.rejected_claims, "adjudication.rejected_claims");
  stringArray(value.safety_flags, "adjudication.safety_flags");
  string(value.decision_summary, "adjudication.decision_summary");
  return value;
}


export function validateRealization(value) {
  object(value, "realization");
  string(value.answer, "realization.answer");
  string(value.next_question, "realization.next_question", { allowEmpty: true });
  if (!Array.isArray(value.realized_nodes)) throw new ValidationError("realization.realized_nodes must be an array.");
  for (const [index, item] of value.realized_nodes.entries()) {
    object(item, `realization.realized_nodes[${index}]`);
    string(item.id, `realization.realized_nodes[${index}].id`);
    string(item.evidence_quote, `realization.realized_nodes[${index}].evidence_quote`);
  }
  return value;
}


export function validateOperationalDiagnosis(value) {
  object(value, "operationalDiagnosis");
  if (!["environment", "authentication", "cli_compatibility", "model_selector", "package_defect", "model_contract", "user_decision", "unknown"].includes(value.category)) {
    throw new ValidationError("operationalDiagnosis.category is invalid.");
  }
  for (const key of ["retryable", "automatic_fix_available", "human_action_required"]) {
    if (typeof value[key] !== "boolean") throw new ValidationError(`operationalDiagnosis.${key} must be boolean.`);
  }
  string(value.summary, "operationalDiagnosis.summary");
  string(value.next_action, "operationalDiagnosis.next_action", { allowEmpty: true });
  stringArray(value.do_not_do, "operationalDiagnosis.do_not_do");
  string(value.internal_note, "operationalDiagnosis.internal_note", { allowEmpty: true });
  return value;
}
