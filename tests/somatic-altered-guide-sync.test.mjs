import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { PUBLIC_GUIDE_REFERENCES, publicGuideReferencePromptBlock } from "../src/core/guide-references.mjs";

const bundle = await compileGuideGraphs({ write: false });
const safe = {
  ...blankCaseVariables(),
  present_safety: "safe",
  orientation: "oriented",
  ability_to_stop: "yes",
  ability_to_return: "yes",
  activation: "moderate",
  dissociation: "none",
  altered_state: "sober",
  suicidal_state: "absent",
  inner_adult_access: "available",
  support_available: "present",
  body_capacity: "adequate",
  current_intent: "conversation",
  actionable_problem: "absent",
  unresolved_inner_material: "present",
  attention_loop: "absent",
  inward_attention_effect: "neutral",
  other_person_central: "no",
  influence_domain: "none",
  memory_source_risk: "absent"
};

function plan(overrides) {
  return planFromGraphs({ graphs: bundle.graphs, variables: { ...safe, ...overrides } });
}

test("latest somatic and altered-state source sections compile into the graph bundle", () => {
  const sourceIds = new Set(bundle.sourceMaps.flatMap((m) => m.sections.map((s) => s.id)));
  for (const id of ["SOM.SIBAM", "SOM.TOUCH", "SOM.AQUATIC", "ALT.TRIAGE", "ALT.CAPACITY", "ALT.ACTION_LOCK", "ALT.AFTERMATH", "ALT.NO_RESCUE_IMPORT"]) {
    assert.ok(sourceIds.has(id), `missing ${id}`);
  }
  const nodeIds = new Set(bundle.graphs.flatMap((g) => g.nodes.map((n) => n.id)));
  for (const id of ["SOM.SIBAM_TRACKING", "SOM.CONSENSUAL_TOUCH", "SOM.AQUATIC_BODYWORK", "ROUTE.ALTERED_MEDICAL_SAFETY", "ROUTE.ALTERED_ACUTE_STABILIZATION", "ROUTE.ALTERED_ACTION_LOCK", "ROUTE.ALTERED_PREPARATION", "ROUTE.ALTERED_STABLE_THERAPY", "ROUTE.ALTERED_AFTERMATH"]) {
    assert.ok(nodeIds.has(id), `missing ${id}`);
  }
});

test("altered-state disclosure alone no longer makes deep work categorically unsafe", () => {
  const coherent = deriveCaseVariables({
    ...safe,
    activation: "low",
    altered_state: "altered",
    altered_capacity: "coherent",
    altered_medical_status: "stable"
  });
  assert.equal(coherent.deep_work_readiness, "yes");

  const unknownMedical = deriveCaseVariables({
    ...safe,
    activation: "low",
    altered_state: "altered",
    altered_capacity: "coherent",
    altered_medical_status: "unknown"
  });
  assert.equal(unknownMedical.deep_work_readiness, "unknown");

  const impaired = deriveCaseVariables({
    ...safe,
    altered_state: "altered",
    altered_capacity: "impaired",
    altered_medical_status: "concerning"
  });
  assert.equal(impaired.deep_work_readiness, "no");
});

test("capacity-led altered-state routes distinguish emergency, stabilization, stable therapy, action lock, preparation, and aftermath", () => {
  const medical = plan({ altered_state: "altered", altered_capacity: "impaired", altered_medical_status: "concerning" });
  assert.equal(medical.primaryJob.id, "ROUTE.ALTERED_MEDICAL_SAFETY");
  assert.ok(!medical.selectedNodes.some((n) => ["ROUTE.GO_INWARD", "ROUTE.ALTERED_STABLE_THERAPY"].includes(n.id)));

  const acute = plan({ altered_state: "altered", altered_capacity: "limited", altered_medical_status: "stable", activation: "high" });
  assert.equal(acute.primaryJob.id, "ROUTE.ALTERED_ACUTE_STABILIZATION");
  assert.ok(!acute.selectedNodes.some((n) => ["ROUTE.GO_INWARD", "ROUTE.ALTERED_STABLE_THERAPY"].includes(n.id)));

  assert.ok(plan({ altered_state: "altered", altered_capacity: "coherent", altered_medical_status: "stable", activation: "low" }).selectedNodes.some((n) => n.id === "ROUTE.ALTERED_STABLE_THERAPY"));
  assert.equal(plan({ altered_state: "altered", altered_capacity: "coherent", altered_medical_status: "stable", altered_action_pressure: "present", activation: "low" }).primaryJob.id, "ROUTE.ALTERED_ACTION_LOCK");
  assert.equal(plan({ altered_phase: "planned", unresolved_inner_material: "absent" }).primaryJob.id, "ROUTE.ALTERED_PREPARATION");
  assert.equal(plan({ altered_phase: "aftermath", unresolved_inner_material: "absent" }).primaryJob.id, "ROUTE.ALTERED_AFTERMATH");
});

test("coherent altered state receives review or depth, not automatic forensic routing", () => {
  const vars = deriveCaseVariables({ ...safe, altered_state: "altered", altered_capacity: "coherent", altered_medical_status: "stable", activation: "low" });
  assert.equal(classifyTherapyTier({ variables: vars, unknowns: [] }, "auto").tier, "reviewed");
  assert.equal(classifyTherapyTier({ variables: { ...vars, current_intent: "altered_state" }, unknowns: [] }, "auto").tier, "deep");
  assert.equal(classifyTherapyTier({ variables: { ...vars, altered_capacity: "impaired" }, unknowns: [] }, "fast").tier, "forensic");
});

test("somatic routes preserve analysis and require explicit consent for touch and aquatic bodywork", () => {
  const sibam = plan({ current_intent: "gentle_practice", unresolved_inner_material: "present" });
  const node = sibam.selectedNodes.find((n) => n.id === "SOM.SIBAM_TRACKING");
  assert.ok(node);
  assert.match(node.recommendations.join(" "), /analysis|appraisal/i);
  assert.match(sibam.requiredNuance.join(" "), /not a claim.*greater truth|not.*truer|not.*deeper/i);

  const touch = plan({ touch_interest: "present", unresolved_inner_material: "absent" });
  assert.ok(touch.selectedNodes.some((n) => n.id === "SOM.CONSENSUAL_TOUCH"));
  const noTouch = plan({ touch_interest: "unknown", unresolved_inner_material: "absent" });
  assert.ok(!noTouch.selectedNodes.some((n) => n.id === "SOM.CONSENSUAL_TOUCH"));

  const water = plan({ aquatic_bodywork_interest: "present", unresolved_inner_material: "absent" });
  assert.ok(water.selectedNodes.some((n) => n.id === "SOM.AQUATIC_BODYWORK"));
});

test("reader guide registry has the 13 owner-confirmed destinations and safety/humanization boundaries", async () => {
  assert.equal(PUBLIC_GUIDE_REFERENCES.length, 13);
  assert.equal(new Set(PUBLIC_GUIDE_REFERENCES.map((r) => r.url)).size, 13);
  assert.ok(PUBLIC_GUIDE_REFERENCES.some((r) => r.url === "https://badtrips.u-dont-exist.com"));
  assert.ok(PUBLIC_GUIDE_REFERENCES.some((r) => r.url === "https://somatic.u-dont-exist.com"));
  const block = publicGuideReferencePromptBlock();
  assert.match(block, /never bypasses safety/i);
  assert.match(block, /humanized wording may differ/i);

  const registry = JSON.parse(await fs.readFile(new URL("../guides/public-guide-registry.json", import.meta.url), "utf8"));
  assert.equal(registry.guides.length, 13);
  const sync = JSON.parse(await fs.readFile(new URL("../authoring/public-guide-sync.json", import.meta.url), "utf8"));
  assert.equal(sync.guides.find((g) => g.id === "somatic").status, "HUMANIZED_PUBLIC");
  assert.equal(sync.guides.find((g) => g.id === "inner-child").status, "PLANNED_SEPARATE_HUMANIZED");
  assert.equal(sync.guides.find((g) => g.id === "altered-states").status, "PLANNED_SEPARATE_HUMANIZED");
  assert.equal(sync.guides.find((g) => g.id === "hypnosis").status, "PLANNED_SEPARATE_HUMANIZED");
});

test("plugin carries direct-guide referrals but forbids using them as a safety bypass", async () => {
  const skill = await fs.readFile(new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/SKILL.md", import.meta.url), "utf8");
  const refs = await fs.readFile(new URL("../plugins/inner-signal-therapy/skills/inner-signal-therapy/references/GUIDE-REFERRALS.md", import.meta.url), "utf8");
  assert.match(skill, /GUIDE-REFERRALS\.md/);
  assert.match(skill, /altered state is a routing variable, not automatic incapacity/i);
  assert.match(refs, /https:\/\/badtrips\.u-dont-exist\.com/);
  assert.match(refs, /never bypass/i);
  assert.match(refs, /humanized/i);
});
