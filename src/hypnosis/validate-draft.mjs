import { ValidationError } from "../core/errors.mjs";
import { HYPNOSIS_CONTRACT_VERSION } from "./app-owned-copy.mjs";
import {
  HYPNOSIS_REVIEW_TARGET_IDS,
  isRepairableHypnosisComponentId
} from "./component-repair.mjs";

const REVIEW_CATEGORIES = new Set([
  "structural",
  "semantic",
  "consent",
  "hypnosis_craft",
  "target_scope",
  "return"
]);
const REVIEW_TARGETS = new Set(HYPNOSIS_REVIEW_TARGET_IDS);

function object(value, label, code = "VALIDATION_ERROR") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`, { code });
  }
}

function string(value, label, { allowEmpty = false, code = "VALIDATION_ERROR" } = {}) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new ValidationError(`${label} must be a ${allowEmpty ? "string" : "non-empty string"}.`, { code });
  }
}

function stringArray(value, label, code = "VALIDATION_ERROR") {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${label} must be an array of strings.`, { code });
  }
}

function exactKeys(value, expected, label, code = "VALIDATION_ERROR") {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new ValidationError(`${label} must contain exactly: ${expected.join(", ")}.`, { code });
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
  object(value, "hypnosis review", "REVIEW_SCOPE_INVALID");
  exactKeys(value, ["verdict", "strengths", "findings"], "hypnosis review", "REVIEW_SCOPE_INVALID");
  if (!["accept", "revise", "reject"].includes(value.verdict)) {
    throw new ValidationError("hypnosis review.verdict must be accept, revise, or reject.", {
      code: "REVIEW_SCOPE_INVALID"
    });
  }
  stringArray(value.strengths, "hypnosis review.strengths", "REVIEW_SCOPE_INVALID");
  if (!Array.isArray(value.findings)) {
    throw new ValidationError("hypnosis review.findings must be an array.", { code: "REVIEW_SCOPE_INVALID" });
  }

  for (const [index, finding] of value.findings.entries()) {
    const label = `hypnosis review.findings[${index}]`;
    object(finding, label, "REVIEW_SCOPE_INVALID");
    exactKeys(finding, ["category", "disposition", "target_ids", "summary"], label, "REVIEW_SCOPE_INVALID");
    if (!REVIEW_CATEGORIES.has(finding.category)) {
      throw new ValidationError(`${label}.category is not registered.`, { code: "REVIEW_SCOPE_INVALID" });
    }
    if (!["repair", "block"].includes(finding.disposition)) {
      throw new ValidationError(`${label}.disposition must be repair or block.`, { code: "REVIEW_SCOPE_INVALID" });
    }
    stringArray(finding.target_ids, `${label}.target_ids`, "REVIEW_SCOPE_INVALID");
    if (finding.target_ids.length === 0 || new Set(finding.target_ids).size !== finding.target_ids.length) {
      throw new ValidationError(`${label}.target_ids must be non-empty and unique.`, { code: "REVIEW_SCOPE_INVALID" });
    }
    if (finding.target_ids.some((id) => !REVIEW_TARGETS.has(id))) {
      throw new ValidationError(`${label}.target_ids contains an unregistered target.`, { code: "REVIEW_SCOPE_INVALID" });
    }
    if (finding.disposition === "repair" && finding.target_ids.some((id) => !isRepairableHypnosisComponentId(id))) {
      throw new ValidationError(`${label} cannot repair metadata or app-owned targets.`, { code: "REVIEW_SCOPE_INVALID" });
    }
    string(finding.summary, `${label}.summary`, { code: "REVIEW_SCOPE_INVALID" });
  }

  if (value.verdict === "accept" && value.findings.length !== 0) {
    throw new ValidationError("An accepted hypnosis review cannot contain findings.", { code: "REVIEW_SCOPE_INVALID" });
  }
  if (value.verdict === "revise" && (
    value.findings.length === 0 || value.findings.some((finding) => finding.disposition !== "repair")
  )) {
    throw new ValidationError("A revise hypnosis review requires only actionable repair findings.", {
      code: "REVIEW_SCOPE_INVALID"
    });
  }
  if (value.verdict === "reject" && (
    value.findings.length === 0 || !value.findings.some((finding) => finding.disposition === "block")
  )) {
    throw new ValidationError("A rejected hypnosis review requires a blocking finding.", {
      code: "REVIEW_SCOPE_INVALID"
    });
  }
  return value;
}

export function validateHypnosisRepairPatch(value) {
  object(value, "hypnosis repair patch", "PATCH_SCOPE_MISMATCH");
  exactKeys(value, ["patch_version", "replacements"], "hypnosis repair patch", "PATCH_SCOPE_MISMATCH");
  if (value.patch_version !== "hypnosis-component-patch-v1") {
    throw new ValidationError("hypnosis repair patch.patch_version is invalid.", { code: "PATCH_SCOPE_MISMATCH" });
  }
  if (!Array.isArray(value.replacements)) {
    throw new ValidationError("hypnosis repair patch.replacements must be an array.", { code: "PATCH_SCOPE_MISMATCH" });
  }
  const seen = new Set();
  for (const [index, item] of value.replacements.entries()) {
    const label = `hypnosis repair patch.replacements[${index}]`;
    object(item, label, "PATCH_SCOPE_MISMATCH");
    exactKeys(item, ["component_id", "replacement"], label, "PATCH_SCOPE_MISMATCH");
    if (!isRepairableHypnosisComponentId(item.component_id)) {
      throw new ValidationError(`${label}.component_id is unknown.`, { code: "UNKNOWN_PATCH_COMPONENT" });
    }
    if (seen.has(item.component_id)) {
      throw new ValidationError(`${label}.component_id is duplicated.`, { code: "PATCH_SCOPE_MISMATCH" });
    }
    seen.add(item.component_id);
    string(item.replacement, `${label}.replacement`, { code: "PATCH_SCOPE_MISMATCH" });
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
