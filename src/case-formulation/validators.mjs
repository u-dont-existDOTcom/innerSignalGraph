import { validatePathUpdate, validateRepresentationSelection } from "./path-performance.mjs";
import { validateTurnTask } from "./turn-task.mjs";
import { validateRelationalEvidence } from "./relational-readiness.mjs";
import { validateRomanceGuideContext } from "./romance-guide.mjs";
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
  if (Object.hasOwn(value, "turn_task")) value.turn_task = validateTurnTask(value.turn_task, { issue: value.current_issue, observationIds });
  if (Object.hasOwn(value, "path_update")) value.path_update = validatePathUpdate(value.path_update, observationIds);
  if (Object.hasOwn(value, "relational_readiness")) {
    value.relational_readiness = validateRelationalEvidence(value.relational_readiness, { issue: value.current_issue, observationIds }, message => { throw new ValidationError(message); });
  }
  if (Object.hasOwn(value, "romance_guide_context")) {
    value.romance_guide_context = validateRomanceGuideContext(value.romance_guide_context, { issue: value.current_issue, observationIds }, message => { throw new ValidationError(message); });
  }
  value.variables = validateCaseVariables(value.variables);
  if (!Array.isArray(value.hypotheses)) throw new ValidationError("caseSnapshot.hypotheses must be an array.");
  const hypothesisIds = new Set();
  for (const [index, item] of value.hypotheses.entries()) {
    object(item, `caseSnapshot.hypotheses[${index}]`);
    for (const key of ["id", "claim", "evidence"]) string(item[key], `caseSnapshot.hypotheses[${index}].${key}`);
    if (!["low","medium","high"].includes(item.confidence)) throw new ValidationError(`caseSnapshot.hypotheses[${index}].confidence is invalid.`);
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
  if (Object.hasOwn(value, "corrected_turn_task")) value.corrected_turn_task = validateTurnTask(value.corrected_turn_task);
  if (value.invalidate_turn_task != null && typeof value.invalidate_turn_task !== "boolean") throw new ValidationError("invalidate_turn_task must be boolean.");
  if (Object.hasOwn(value, "corrected_path_representation")) value.corrected_path_representation = validateRepresentationSelection(value.corrected_path_representation);
  if (value.invalidate_path_representation != null && typeof value.invalidate_path_representation !== "boolean") throw new ValidationError("invalidate_path_representation must be boolean.");
  if (Object.hasOwn(value, "corrected_relational_readiness") && value.corrected_relational_readiness !== null) object(value.corrected_relational_readiness, "caseAudit.corrected_relational_readiness");
  if (value.invalidate_relational_readiness != null && typeof value.invalidate_relational_readiness !== "boolean") throw new ValidationError("invalidate_relational_readiness must be boolean.");
  if (Object.hasOwn(value, "corrected_romance_guide_context") && value.corrected_romance_guide_context !== null) object(value.corrected_romance_guide_context, "caseAudit.corrected_romance_guide_context");
  if (value.invalidate_romance_guide_context != null && typeof value.invalidate_romance_guide_context !== "boolean") throw new ValidationError("invalidate_romance_guide_context must be boolean.");
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
