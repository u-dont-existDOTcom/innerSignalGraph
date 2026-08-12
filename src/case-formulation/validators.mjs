import { ValidationError } from "../core/errors.mjs";
import { CASE_VARIABLE_ENUMS, CASE_VARIABLE_FIELDS } from "../guide-graph/contract.mjs";
import { validateCaseVariables } from "../guide-graph/validate.mjs";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${label} must be an object.`);
}
function string(value, label, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new ValidationError(`${label} must be a string.`);
}
function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new ValidationError(`${label} must be an array of strings.`);
}

export function validateCaseSnapshot(value) {
  object(value, "caseSnapshot");
  string(value.user_goal, "caseSnapshot.user_goal");
  string(value.current_issue, "caseSnapshot.current_issue");
  if (!Array.isArray(value.direct_observations)) throw new ValidationError("caseSnapshot.direct_observations must be an array.");
  const observationIds = new Set();
  for (const [index, item] of value.direct_observations.entries()) {
    object(item, `caseSnapshot.direct_observations[${index}]`);
    for (const key of ["id", "statement", "evidence"]) string(item[key], `caseSnapshot.direct_observations[${index}].${key}`);
    if (observationIds.has(item.id)) throw new ValidationError(`Duplicate observation id ${item.id}.`);
    observationIds.add(item.id);
  }
  value.variables = validateCaseVariables(value.variables);
  if (!Array.isArray(value.hypotheses)) throw new ValidationError("caseSnapshot.hypotheses must be an array.");
  const hypothesisIds = new Set();
  for (const [index, item] of value.hypotheses.entries()) {
    object(item, `caseSnapshot.hypotheses[${index}]`);
    for (const key of ["id", "claim", "evidence"]) string(item[key], `caseSnapshot.hypotheses[${index}].${key}`);
    if (!['low','medium','high'].includes(item.confidence)) throw new ValidationError(`caseSnapshot.hypotheses[${index}].confidence is invalid.`);
    stringArray(item.alternatives, `caseSnapshot.hypotheses[${index}].alternatives`);
    if (hypothesisIds.has(item.id)) throw new ValidationError(`Duplicate hypothesis id ${item.id}.`);
    hypothesisIds.add(item.id);
  }
  if (!Array.isArray(value.unknowns)) throw new ValidationError("caseSnapshot.unknowns must be an array.");
  for (const [index, item] of value.unknowns.entries()) {
    object(item, `caseSnapshot.unknowns[${index}]`);
    string(item.variable, `caseSnapshot.unknowns[${index}].variable`);
    string(item.question, `caseSnapshot.unknowns[${index}].question`);
    if (!Number.isInteger(item.importance) || item.importance < 1 || item.importance > 5) throw new ValidationError(`caseSnapshot.unknowns[${index}].importance is invalid.`);
  }
  return value;
}

export function validateCaseAudit(value) {
  object(value, "caseAudit");
  stringArray(value.remove_observation_ids, "caseAudit.remove_observation_ids");
  stringArray(value.remove_hypothesis_ids, "caseAudit.remove_hypothesis_ids");
  if (!Array.isArray(value.variable_corrections)) throw new ValidationError("caseAudit.variable_corrections must be an array.");
  for (const [index, correction] of value.variable_corrections.entries()) {
    object(correction, `caseAudit.variable_corrections[${index}]`);
    if (!CASE_VARIABLE_FIELDS.includes(correction.field)) throw new ValidationError(`caseAudit.variable_corrections[${index}].field is invalid.`);
    if (!CASE_VARIABLE_ENUMS[correction.field].includes(correction.value)) throw new ValidationError(`caseAudit.variable_corrections[${index}].value is invalid for ${correction.field}.`);
    string(correction.reason, `caseAudit.variable_corrections[${index}].reason`);
  }
  if (!Array.isArray(value.add_unknowns)) throw new ValidationError("caseAudit.add_unknowns must be an array.");
  for (const [index, item] of value.add_unknowns.entries()) {
    object(item, `caseAudit.add_unknowns[${index}]`);
    string(item.variable, `caseAudit.add_unknowns[${index}].variable`);
    string(item.question, `caseAudit.add_unknowns[${index}].question`);
    if (!Number.isInteger(item.importance) || item.importance < 1 || item.importance > 5) throw new ValidationError(`caseAudit.add_unknowns[${index}].importance is invalid.`);
  }
  stringArray(value.safety_flags, "caseAudit.safety_flags");
  if (!["accept","revise","reject"].includes(value.verdict)) throw new ValidationError("caseAudit.verdict is invalid.");
  string(value.summary, "caseAudit.summary");
  return value;
}
