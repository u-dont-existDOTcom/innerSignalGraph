import { ValidationError } from "../core/errors.mjs";
import { HYPNOSIS_CONTRACT_VERSION } from "./app-owned-copy.mjs";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
}

function string(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new ValidationError(`${label} must be a ${allowEmpty ? "string" : "non-empty string"}.`);
  }
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be an array of strings.`);
  }
}

export function validateHypnosisDraft(value) {
  object(value, "hypnosis draft");
  if (value.contract_version !== HYPNOSIS_CONTRACT_VERSION) {
    throw new ValidationError(`hypnosis draft.contract_version must be ${HYPNOSIS_CONTRACT_VERSION}.`);
  }
  if (value.language !== "en") throw new ValidationError("v0.7.2 hypnosis compiler currently accepts language=en only.");
  if (!["command", "communion"].includes(value.relationship)) {
    throw new ValidationError("hypnosis draft.relationship must be command or communion.");
  }
  for (const key of ["target", "premise", "orientation", "aftercare"]) {
    string(value[key], `hypnosis draft.${key}`);
  }
  object(value.continue_inward, "hypnosis draft.continue_inward");
  for (const key of ["induction", "deepening", "target_work", "integration", "return_lead"]) {
    string(value.continue_inward[key], `hypnosis draft.continue_inward.${key}`);
  }
  object(value.stay_external, "hypnosis draft.stay_external");
  for (const key of ["grounding", "ordinary_choice"]) {
    string(value.stay_external[key], `hypnosis draft.stay_external.${key}`);
  }
  object(value.scope, "hypnosis draft.scope");
  for (const key of ["memory", "identity", "post_session", "substances"]) {
    string(value.scope[key], `hypnosis draft.scope.${key}`);
  }
  stringArray(value.design_notes, "hypnosis draft.design_notes");
  return value;
}

export function validateHypnosisReview(value) {
  object(value, "hypnosis review");
  if (!["accept", "revise", "reject"].includes(value.verdict)) {
    throw new ValidationError("hypnosis review.verdict must be accept, revise, or reject.");
  }
  for (const key of [
    "strengths",
    "structural_issues",
    "semantic_issues",
    "consent_issues",
    "hypnosis_craft_issues",
    "target_scope_issues",
    "return_issues",
    "required_repairs"
  ]) {
    stringArray(value[key], `hypnosis review.${key}`);
  }
  return value;
}

export function validateHypnosisFinalReview(value) {
  object(value, "hypnosis final review");
  if (!["pass", "revise", "reject"].includes(value.verdict)) {
    throw new ValidationError("hypnosis final review.verdict must be pass, revise, or reject.");
  }
  stringArray(value.accepted_strengths, "hypnosis final review.accepted_strengths");
  stringArray(value.remaining_issues, "hypnosis final review.remaining_issues");
  string(value.release_summary, "hypnosis final review.release_summary");
  return value;
}
