import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  HYPNOSIS_REPAIR_DEPENDENCIES,
  HYPNOSIS_REVIEW_TARGET_IDS,
  NON_REPAIRABLE_HYPNOSIS_TARGET_IDS,
  REPAIRABLE_HYPNOSIS_COMPONENT_IDS,
  attributeHypnosisAuditIssues,
  buildHypnosisRepairScope,
  computeHypnosisRepairClosure,
  mergeHypnosisRepairPatch
} from "../src/hypnosis/component-repair.mjs";
import {
  validateHypnosisDraft,
  validateHypnosisRepairPatch,
  validateHypnosisReview
} from "../src/hypnosis/validate-draft.mjs";

const EXPECTED_COMPONENTS = [
  "orientation",
  "continue_inward.induction",
  "continue_inward.deepening",
  "continue_inward.target_work",
  "continue_inward.integration",
  "continue_inward.return_lead",
  "stay_external.grounding",
  "stay_external.ordinary_choice",
  "aftercare"
];
const EXPECTED_METADATA = [
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
];

async function initialDraft() {
  const fixture = JSON.parse(await fs.readFile("fixtures/mock-responses/H001.json", "utf8"));
  return fixture.anthropic.hypnosis_draft;
}

function scopeFor(...seedComponentIds) {
  return buildHypnosisRepairScope(
    { attributions: [], seedComponentIds, blockingIssues: [] },
    { attributions: [], seedComponentIds: [], blockingIssues: [] }
  );
}

function patchFor(draft, ids) {
  return {
    patch_version: "hypnosis-component-patch-v1",
    replacements: ids.map((component_id) => ({
      component_id,
      replacement: `${component_id.split(".").reduce((value, key) => value[key], draft)} [scoped repair]`
    }))
  };
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current[key], value);
}

test("component, metadata, review-target, dependency, and app-owned registries are exact", () => {
  assert.deepEqual(REPAIRABLE_HYPNOSIS_COMPONENT_IDS, EXPECTED_COMPONENTS);
  assert.deepEqual(NON_REPAIRABLE_HYPNOSIS_TARGET_IDS, EXPECTED_METADATA);
  assert.deepEqual(HYPNOSIS_REVIEW_TARGET_IDS, [...EXPECTED_COMPONENTS, ...EXPECTED_METADATA]);
  assert.equal(EXPECTED_COMPONENTS.some((id) => EXPECTED_METADATA.includes(id)), false);
  assert.deepEqual(Object.keys(HYPNOSIS_REPAIR_DEPENDENCIES), EXPECTED_COMPONENTS);

  for (const appOwnedId of [
    "gate.title",
    "gate.intro",
    "gate.note",
    "route.continue_inward",
    "route.stay_external",
    "route.end_session",
    "selection.continue_inward",
    "selection.stay_external",
    "selection.end_session",
    "end_session.body",
    "final_waking_return"
  ]) {
    assert.equal(HYPNOSIS_REVIEW_TARGET_IDS.includes(appOwnedId), false);
  }
});

test("every current deterministic audit code has exact repair or blocking attribution", () => {
  const fieldCodes = [
    "missing_component",
    "model_emitted_control_marker",
    "model_emitted_gate_copy",
    "model_emitted_waking_return",
    "memory_certainty_or_recovery",
    "coercive_authority"
  ];
  const audit = {
    issues: [
      { code: "contract_version_mismatch", field: "contract_version" },
      ...fieldCodes.map((code) => ({ code, field: "orientation" })),
      { code: "orientation_deepens_before_gate", field: "orientation" },
      { code: "stay_external_advances_inward", field: "stay_external" },
      { code: "continue_route_too_short", field: "continue_inward" },
      { code: "stay_external_too_short", field: "stay_external" },
      { code: "aftercare_too_long", field: "aftercare" },
      { code: "memory_scope_not_locked", field: "scope.memory" },
      { code: "identity_scope_not_locked", field: "scope.identity" },
      { code: "post_session_scope_not_locked", field: "scope.post_session" },
      { code: "substance_scope_not_locked", field: "scope.substances" }
    ]
  };
  const result = attributeHypnosisAuditIssues(audit);
  assert.deepEqual(result.seedComponentIds, EXPECTED_COMPONENTS);
  assert.equal(result.attributions.length, audit.issues.length);
  assert.equal(result.blockingIssues.length, 5);
  assert.equal(result.attributions[0].failureCode, "UNREPAIRABLE_DETERMINISTIC_ISSUE");
  assert.deepEqual(
    result.attributions.find((item) => item.code === "continue_route_too_short").targetIds,
    EXPECTED_COMPONENTS.slice(1, 6)
  );
  assert.deepEqual(
    result.attributions.find((item) => item.code === "stay_external_advances_inward").targetIds,
    EXPECTED_COMPONENTS.slice(6, 8)
  );
  assert.deepEqual(
    result.attributions.find((item) => item.code === "stay_external_too_short").targetIds,
    EXPECTED_COMPONENTS.slice(6, 8)
  );
});

test("unknown audit codes and unregistered issue fields fail closed", () => {
  const unknown = attributeHypnosisAuditIssues({ issues: [{ code: "future_rule", field: "orientation" }] });
  assert.equal(unknown.blockingIssues[0].failureCode, "UNMAPPED_DETERMINISTIC_ISSUE");
  const badField = attributeHypnosisAuditIssues({ issues: [{ code: "coercive_authority", field: "scope.memory" }] });
  assert.equal(badField.blockingIssues[0].failureCode, "UNMAPPED_DETERMINISTIC_ISSUE");
});

test("dependency closure is the exact forward-only static graph", () => {
  const cases = new Map([
    ["orientation", ["orientation"]],
    ["continue_inward.induction", EXPECTED_COMPONENTS.slice(1, 6)],
    ["continue_inward.deepening", EXPECTED_COMPONENTS.slice(2, 6)],
    ["continue_inward.target_work", EXPECTED_COMPONENTS.slice(3, 6)],
    ["continue_inward.integration", EXPECTED_COMPONENTS.slice(4, 6)],
    ["continue_inward.return_lead", ["continue_inward.return_lead"]],
    ["stay_external.grounding", EXPECTED_COMPONENTS.slice(6, 8)],
    ["stay_external.ordinary_choice", ["stay_external.ordinary_choice"]],
    ["aftercare", ["aftercare"]]
  ]);
  for (const [seed, expected] of cases) assert.deepEqual(computeHypnosisRepairClosure([seed]), expected);
  assert.deepEqual(
    computeHypnosisRepairClosure(["aftercare", "continue_inward.target_work", "orientation"]),
    ["orientation", ...EXPECTED_COMPONENTS.slice(3, 6), "aftercare"]
  );
  assert.throws(
    () => computeHypnosisRepairClosure(["gate.intro"]),
    (error) => error.code === "DEPENDENCY_INVARIANT_FAILURE"
  );
});

test("patch validation and merge require an exact nonblank replacement set", async () => {
  const draft = await initialDraft();
  const repairScope = scopeFor("orientation");
  const valid = patchFor(draft, repairScope.componentIds);
  assert.equal(validateHypnosisRepairPatch(valid), valid);
  assert.equal(
    mergeHypnosisRepairPatch(draft, repairScope, valid, { validateDraft: validateHypnosisDraft }).mergedDraft.orientation,
    valid.replacements[0].replacement
  );

  assert.throws(
    () => mergeHypnosisRepairPatch(
      draft,
      repairScope,
      { ...valid, replacements: [] },
      { validateDraft: validateHypnosisDraft }
    ),
    (error) => error.code === "PATCH_SCOPE_MISMATCH"
  );
  assert.throws(
    () => mergeHypnosisRepairPatch(
      draft,
      repairScope,
      {
        ...valid,
        replacements: [...valid.replacements, { component_id: "aftercare", replacement: "Extra" }]
      },
      { validateDraft: validateHypnosisDraft }
    ),
    (error) => error.code === "PATCH_SCOPE_MISMATCH"
  );
  assert.throws(
    () => validateHypnosisRepairPatch({ ...valid, replacements: [...valid.replacements, ...valid.replacements] }),
    (error) => error.code === "PATCH_SCOPE_MISMATCH"
  );
  assert.throws(
    () => validateHypnosisRepairPatch({
      ...valid,
      replacements: [{ component_id: "gate.intro", replacement: "Unauthorized" }]
    }),
    (error) => error.code === "UNKNOWN_PATCH_COMPONENT"
  );
  assert.throws(
    () => validateHypnosisRepairPatch({
      ...valid,
      replacements: [{ component_id: "orientation", replacement: "  " }]
    }),
    (error) => error.code === "PATCH_SCOPE_MISMATCH"
  );
  assert.throws(
    () => mergeHypnosisRepairPatch(
      draft,
      repairScope,
      { ...valid, unauthorized: true },
      { validateDraft: validateHypnosisDraft }
    ),
    (error) => error.code === "PATCH_SCOPE_MISMATCH"
  );
  assert.throws(
    () => validateHypnosisRepairPatch({
      ...valid,
      replacements: [{ ...valid.replacements[0], unauthorized: true }]
    }),
    (error) => error.code === "PATCH_SCOPE_MISMATCH"
  );
});

test("orientation-only merge preserves routes, aftercare, and metadata byte-for-byte", async () => {
  const draft = await initialDraft();
  const repairScope = scopeFor("orientation");
  const { mergedDraft, preservation } = mergeHypnosisRepairPatch(
    draft,
    repairScope,
    patchFor(draft, repairScope.componentIds),
    { validateDraft: validateHypnosisDraft }
  );
  assert.notEqual(mergedDraft.orientation, draft.orientation);
  assert.deepEqual(mergedDraft.continue_inward, draft.continue_inward);
  assert.deepEqual(mergedDraft.stay_external, draft.stay_external);
  assert.equal(mergedDraft.aftercare, draft.aftercare);
  for (const id of EXPECTED_METADATA) assert.deepEqual(getPath(mergedDraft, id), getPath(draft, id));
  assert.equal(preservation.allUnaffectedByteIdentical, true);
  assert.deepEqual(preservation.repairedComponentIds, ["orientation"]);
  for (const id of preservation.untouchedComponentIds) {
    assert.equal(preservation.componentHashesBefore[id], preservation.componentHashesAfter[id]);
  }
  assert.deepEqual(preservation.metadataHashesBefore, preservation.metadataHashesAfter);
});

test("target-work repair changes only its exact forward dependency closure", async () => {
  const draft = await initialDraft();
  const repairScope = scopeFor("continue_inward.target_work");
  assert.deepEqual(repairScope.componentIds, EXPECTED_COMPONENTS.slice(3, 6));
  const { mergedDraft } = mergeHypnosisRepairPatch(draft, repairScope, patchFor(draft, repairScope.componentIds), {
    validateDraft: validateHypnosisDraft
  });
  for (const id of EXPECTED_COMPONENTS) {
    if (repairScope.componentIds.includes(id)) assert.notEqual(getPath(mergedDraft, id), getPath(draft, id));
    else assert.equal(getPath(mergedDraft, id), getPath(draft, id));
  }
});

test("external grounding repair cannot change the inward route", async () => {
  const draft = await initialDraft();
  const repairScope = scopeFor("stay_external.grounding");
  const { mergedDraft } = mergeHypnosisRepairPatch(draft, repairScope, patchFor(draft, repairScope.componentIds), {
    validateDraft: validateHypnosisDraft
  });
  assert.deepEqual(mergedDraft.continue_inward, draft.continue_inward);
  assert.notEqual(mergedDraft.stay_external.grounding, draft.stay_external.grounding);
  assert.notEqual(mergedDraft.stay_external.ordinary_choice, draft.stay_external.ordinary_choice);
});

test("aftercare-only repair leaves every spoken-session component byte-identical", async () => {
  const draft = await initialDraft();
  const repairScope = scopeFor("aftercare");
  const { mergedDraft, preservation } = mergeHypnosisRepairPatch(
    draft,
    repairScope,
    patchFor(draft, repairScope.componentIds),
    { validateDraft: validateHypnosisDraft }
  );
  assert.notEqual(mergedDraft.aftercare, draft.aftercare);
  for (const id of EXPECTED_COMPONENTS.filter((id) => id !== "aftercare")) {
    assert.equal(getPath(mergedDraft, id), getPath(draft, id));
    assert.ok(Buffer.from(getPath(mergedDraft, id)).equals(Buffer.from(getPath(draft, id))));
  }
  assert.equal(preservation.allUnaffectedByteIdentical, true);
  assert.equal(validateHypnosisDraft(mergedDraft), mergedDraft);
});

test("structured review scope is explicit and app-owned targets cannot enter repair authority", () => {
  const valid = {
    verdict: "revise",
    strengths: [],
    findings: [{
      category: "consent",
      disposition: "repair",
      target_ids: ["orientation"],
      summary: "Orientation begins too early."
    }]
  };
  assert.equal(validateHypnosisReview(valid), valid);
  assert.throws(
    () => validateHypnosisReview({
      ...valid,
      findings: [{ ...valid.findings[0], target_ids: ["gate.intro"] }]
    }),
    (error) => error.code === "REVIEW_SCOPE_INVALID"
  );
  assert.throws(
    () => validateHypnosisReview({
      ...valid,
      findings: [{ ...valid.findings[0], target_ids: ["scope.memory"] }]
    }),
    (error) => error.code === "REVIEW_SCOPE_INVALID"
  );
  assert.equal(validateHypnosisReview({
    verdict: "reject",
    strengths: [],
    findings: [{
      category: "target_scope",
      disposition: "block",
      target_ids: ["scope.memory"],
      summary: "The locked memory scope would need to change."
    }]
  }).verdict, "reject");
});
