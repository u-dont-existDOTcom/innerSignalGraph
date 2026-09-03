import { isDeepStrictEqual } from "node:util";
import { RuntimeError } from "../core/errors.mjs";
import { sha256 } from "../core/hash.mjs";

export const REPAIRABLE_HYPNOSIS_COMPONENT_IDS = Object.freeze([
  "orientation",
  "continue_inward.induction",
  "continue_inward.deepening",
  "continue_inward.target_work",
  "continue_inward.integration",
  "continue_inward.return_lead",
  "stay_external.grounding",
  "stay_external.ordinary_choice",
  "aftercare"
]);

export const NON_REPAIRABLE_HYPNOSIS_TARGET_IDS = Object.freeze([
  "contract_version",
  "language",
  "relationship",
  "target",
  "premise",
  "scope.memory",
  "scope.identity",
  "scope.post_session",
  "scope.substances",
  "design_notes"
]);

export const HYPNOSIS_REVIEW_TARGET_IDS = Object.freeze([
  ...REPAIRABLE_HYPNOSIS_COMPONENT_IDS,
  ...NON_REPAIRABLE_HYPNOSIS_TARGET_IDS
]);

export const HYPNOSIS_REPAIR_DEPENDENCIES = Object.freeze({
  orientation: Object.freeze([]),
  "continue_inward.induction": Object.freeze(["continue_inward.deepening"]),
  "continue_inward.deepening": Object.freeze(["continue_inward.target_work"]),
  "continue_inward.target_work": Object.freeze(["continue_inward.integration"]),
  "continue_inward.integration": Object.freeze(["continue_inward.return_lead"]),
  "continue_inward.return_lead": Object.freeze([]),
  "stay_external.grounding": Object.freeze(["stay_external.ordinary_choice"]),
  "stay_external.ordinary_choice": Object.freeze([]),
  aftercare: Object.freeze([])
});

const REPAIRABLE_SET = new Set(REPAIRABLE_HYPNOSIS_COMPONENT_IDS);
const NON_REPAIRABLE_SET = new Set(NON_REPAIRABLE_HYPNOSIS_TARGET_IDS);
const FIELD_ATTRIBUTED_CODES = new Set([
  "missing_component",
  "model_emitted_control_marker",
  "model_emitted_gate_copy",
  "model_emitted_waking_return",
  "memory_certainty_or_recovery",
  "coercive_authority"
]);
const UNREPAIRABLE_AUDIT_CODES = new Set([
  "contract_version_mismatch",
  "memory_scope_not_locked",
  "identity_scope_not_locked",
  "post_session_scope_not_locked",
  "substance_scope_not_locked"
]);
const FIXED_AUDIT_TARGETS = Object.freeze({
  orientation_deepens_before_gate: Object.freeze(["orientation"]),
  stay_external_advances_inward: Object.freeze([
    "stay_external.grounding",
    "stay_external.ordinary_choice"
  ]),
  continue_route_too_short: Object.freeze([
    "continue_inward.induction",
    "continue_inward.deepening",
    "continue_inward.target_work",
    "continue_inward.integration",
    "continue_inward.return_lead"
  ]),
  stay_external_too_short: Object.freeze([
    "stay_external.grounding",
    "stay_external.ordinary_choice"
  ]),
  aftercare_too_long: Object.freeze(["aftercare"])
});

function runtimeFailure(message, code, details) {
  return new RuntimeError(message, { code, details });
}

function canonicalIds(ids) {
  const selected = new Set(ids);
  return REPAIRABLE_HYPNOSIS_COMPONENT_IDS.filter((id) => selected.has(id));
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

function setPath(value, dottedPath, replacement) {
  const keys = dottedPath.split(".");
  const leaf = keys.pop();
  const parent = keys.reduce((current, key) => current[key], value);
  parent[leaf] = replacement;
}

function serialized(value) {
  return JSON.stringify(value);
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function hashValues(value, ids) {
  return Object.fromEntries(ids.map((id) => [id, sha256(serialized(getPath(value, id)))]));
}

function assertDependencyGraphInvariant() {
  const keys = Object.keys(HYPNOSIS_REPAIR_DEPENDENCIES);
  if (!isDeepStrictEqual(keys, REPAIRABLE_HYPNOSIS_COMPONENT_IDS)) {
    throw runtimeFailure(
      "Hypnosis repair dependency registry does not match the component registry.",
      "DEPENDENCY_INVARIANT_FAILURE"
    );
  }
  for (const [source, targets] of Object.entries(HYPNOSIS_REPAIR_DEPENDENCIES)) {
    if (!REPAIRABLE_SET.has(source) || targets.some((target) => !REPAIRABLE_SET.has(target))) {
      throw runtimeFailure(
        "Hypnosis repair dependency graph contains an unregistered component.",
        "DEPENDENCY_INVARIANT_FAILURE",
        { source, targets }
      );
    }
  }
}

export function attributeHypnosisAuditIssues(audit) {
  if (!audit || !Array.isArray(audit.issues)) {
    throw runtimeFailure("Hypnosis audit issues are unavailable for attribution.", "UNMAPPED_DETERMINISTIC_ISSUE");
  }

  const attributions = [];
  const seeds = new Set();
  const blockingIssues = [];

  for (const issue of audit.issues) {
    const code = issue?.code;
    let targetIds = [];
    let failureCode = null;

    if (UNREPAIRABLE_AUDIT_CODES.has(code)) {
      failureCode = "UNREPAIRABLE_DETERMINISTIC_ISSUE";
    } else if (FIELD_ATTRIBUTED_CODES.has(code)) {
      if (REPAIRABLE_SET.has(issue?.field)) targetIds = [issue.field];
      else failureCode = "UNMAPPED_DETERMINISTIC_ISSUE";
    } else if (Object.hasOwn(FIXED_AUDIT_TARGETS, code)) {
      targetIds = [...FIXED_AUDIT_TARGETS[code]];
    } else {
      failureCode = "UNMAPPED_DETERMINISTIC_ISSUE";
    }

    targetIds.forEach((id) => seeds.add(id));
    const attribution = {
      code: code ?? null,
      field: issue?.field ?? null,
      disposition: failureCode ? "block" : "repair",
      targetIds,
      ...(failureCode ? { failureCode } : {})
    };
    attributions.push(attribution);
    if (failureCode) blockingIssues.push(attribution);
  }

  return {
    attributions,
    seedComponentIds: canonicalIds(seeds),
    blockingIssues
  };
}

export function attributeHypnosisReviewFindings(review) {
  const attributions = [];
  const seeds = new Set();
  const blockingIssues = [];

  for (const finding of review.findings) {
    const attribution = {
      category: finding.category,
      disposition: finding.disposition,
      targetIds: [...finding.target_ids]
    };
    attributions.push(attribution);
    if (finding.disposition === "repair") finding.target_ids.forEach((id) => seeds.add(id));
    else blockingIssues.push(attribution);
  }

  return {
    attributions,
    seedComponentIds: canonicalIds(seeds),
    blockingIssues
  };
}

export function computeHypnosisRepairClosure(seedIds) {
  assertDependencyGraphInvariant();
  if (!Array.isArray(seedIds) || seedIds.some((id) => !REPAIRABLE_SET.has(id))) {
    throw runtimeFailure(
      "Hypnosis repair seeds contain an unregistered component.",
      "DEPENDENCY_INVARIANT_FAILURE",
      { seedIds }
    );
  }

  const closure = new Set(seedIds);
  const queue = [...canonicalIds(seedIds)];
  while (queue.length > 0) {
    const source = queue.shift();
    for (const target of HYPNOSIS_REPAIR_DEPENDENCIES[source]) {
      if (!closure.has(target)) {
        closure.add(target);
        queue.push(target);
      }
    }
  }
  return canonicalIds(closure);
}

export function buildHypnosisRepairScope(deterministicAttribution, reviewAttribution) {
  const seedComponentIds = canonicalIds([
    ...deterministicAttribution.seedComponentIds,
    ...reviewAttribution.seedComponentIds
  ]);
  const componentIds = computeHypnosisRepairClosure(seedComponentIds);
  const dependencyEdgesApplied = dependencyEdgesFor(componentIds);
  return {
    deterministicAttributions: deterministicAttribution.attributions,
    reviewAttributions: reviewAttribution.attributions,
    seedComponentIds,
    dependencyEdgesApplied,
    componentIds
  };
}

function dependencyEdgesFor(componentIds) {
  const componentSet = new Set(componentIds);
  const edges = [];
  for (const source of componentIds) {
    for (const target of HYPNOSIS_REPAIR_DEPENDENCIES[source]) {
      if (componentSet.has(target)) edges.push([source, target]);
    }
  }
  return edges;
}

function validateRepairScope(repairScope) {
  if (!repairScope || !Array.isArray(repairScope.seedComponentIds) || !Array.isArray(repairScope.componentIds)) {
    throw runtimeFailure("Hypnosis repair scope is malformed.", "DEPENDENCY_INVARIANT_FAILURE");
  }
  const expected = computeHypnosisRepairClosure(repairScope.seedComponentIds);
  const expectedEdges = dependencyEdgesFor(expected);
  if (
    !isDeepStrictEqual(expected, repairScope.componentIds) ||
    !isDeepStrictEqual(expectedEdges, repairScope.dependencyEdgesApplied)
  ) {
    throw runtimeFailure(
      "Hypnosis repair scope differs from the static dependency closure.",
      "DEPENDENCY_INVARIANT_FAILURE",
      {
        expected,
        actual: repairScope.componentIds,
        expectedEdges,
        actualEdges: repairScope.dependencyEdgesApplied
      }
    );
  }
}

function patchReplacementMap(patch) {
  if (
    !hasExactKeys(patch, ["patch_version", "replacements"]) ||
    patch.patch_version !== "hypnosis-component-patch-v1" ||
    !Array.isArray(patch.replacements)
  ) {
    throw runtimeFailure("Hypnosis repair patch has an invalid shape.", "PATCH_SCOPE_MISMATCH");
  }
  const replacements = new Map();
  for (const item of patch.replacements) {
    if (!hasExactKeys(item, ["component_id", "replacement"])) {
      throw runtimeFailure("Hypnosis repair replacement has an invalid shape.", "PATCH_SCOPE_MISMATCH");
    }
    if (!REPAIRABLE_SET.has(item.component_id)) {
      throw runtimeFailure(
        "Hypnosis repair patch contains an unknown component.",
        "UNKNOWN_PATCH_COMPONENT",
        { componentId: item?.component_id ?? null }
      );
    }
    if (replacements.has(item.component_id)) {
      throw runtimeFailure(
        "Hypnosis repair patch contains a duplicate component.",
        "PATCH_SCOPE_MISMATCH",
        { componentId: item.component_id }
      );
    }
    if (typeof item.replacement !== "string" || !item.replacement.trim()) {
      throw runtimeFailure(
        "Hypnosis repair patch contains a blank replacement.",
        "PATCH_SCOPE_MISMATCH",
        { componentId: item.component_id }
      );
    }
    replacements.set(item.component_id, item.replacement);
  }
  return replacements;
}

export function mergeHypnosisRepairPatch(initialDraft, repairScope, patch, { validateDraft } = {}) {
  validateRepairScope(repairScope);
  if (typeof validateDraft !== "function") {
    throw runtimeFailure("Complete hypnosis draft validation is required before merge.", "DEPENDENCY_INVARIANT_FAILURE");
  }
  const replacements = patchReplacementMap(patch);
  const expectedIds = repairScope.componentIds;
  if (
    replacements.size !== expectedIds.length ||
    expectedIds.some((id) => !replacements.has(id)) ||
    [...replacements.keys()].some((id) => !expectedIds.includes(id))
  ) {
    throw runtimeFailure(
      "Hypnosis repair patch does not exactly match the computed repair scope.",
      "PATCH_SCOPE_MISMATCH",
      { expectedIds, actualIds: canonicalIds(replacements.keys()) }
    );
  }

  const mergedDraft = structuredClone(initialDraft);
  for (const id of REPAIRABLE_HYPNOSIS_COMPONENT_IDS) {
    if (replacements.has(id)) setPath(mergedDraft, id, replacements.get(id));
  }
  validateDraft(mergedDraft);

  const repairedSet = new Set(expectedIds);
  const untouchedComponentIds = REPAIRABLE_HYPNOSIS_COMPONENT_IDS.filter((id) => !repairedSet.has(id));
  const componentHashesBefore = hashValues(initialDraft, REPAIRABLE_HYPNOSIS_COMPONENT_IDS);
  const componentHashesAfter = hashValues(mergedDraft, REPAIRABLE_HYPNOSIS_COMPONENT_IDS);
  const metadataHashesBefore = {
    ...hashValues(initialDraft, NON_REPAIRABLE_HYPNOSIS_TARGET_IDS),
    scope: sha256(serialized(initialDraft.scope))
  };
  const metadataHashesAfter = {
    ...hashValues(mergedDraft, NON_REPAIRABLE_HYPNOSIS_TARGET_IDS),
    scope: sha256(serialized(mergedDraft.scope))
  };

  const componentsPreserved = untouchedComponentIds.every((id) =>
    getPath(initialDraft, id) === getPath(mergedDraft, id) &&
    Buffer.from(getPath(initialDraft, id), "utf8").equals(Buffer.from(getPath(mergedDraft, id), "utf8"))
  );
  const metadataPreserved = NON_REPAIRABLE_HYPNOSIS_TARGET_IDS.every((id) =>
    isDeepStrictEqual(getPath(initialDraft, id), getPath(mergedDraft, id)) &&
    serialized(getPath(initialDraft, id)) === serialized(getPath(mergedDraft, id))
  ) && serialized(initialDraft.scope) === serialized(mergedDraft.scope);
  const allUnaffectedByteIdentical = componentsPreserved && metadataPreserved;

  if (!allUnaffectedByteIdentical) {
    throw runtimeFailure(
      "Hypnosis repair changed content outside the computed repair scope.",
      "PRESERVATION_INVARIANT_FAILURE"
    );
  }

  return {
    mergedDraft,
    preservation: {
      repairedComponentIds: [...expectedIds],
      untouchedComponentIds,
      componentHashesBefore,
      componentHashesAfter,
      metadataHashesBefore,
      metadataHashesAfter,
      allUnaffectedByteIdentical
    }
  };
}

export function isRepairableHypnosisComponentId(value) {
  return REPAIRABLE_SET.has(value);
}

export function isNonRepairableHypnosisTargetId(value) {
  return NON_REPAIRABLE_SET.has(value);
}
