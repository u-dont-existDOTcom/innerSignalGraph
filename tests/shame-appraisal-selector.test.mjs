import test from "node:test";
import assert from "node:assert/strict";
import { CASE_VARIABLE_ENUMS } from "../src/guide-graph/contract.mjs";
import { caseSnapshotSchema, caseSnapshotGenerationSchema } from "../src/case-formulation/schemas.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";

const available = {
  present_safety: "safe", orientation: "oriented",
  ability_to_stop: "yes", ability_to_return: "yes",
  suicidal_state: "absent", altered_state: "sober", dissociation: "none",
  inner_adult_access: "available"
};

test("shame context is a source-grounded, three-state selector, not a generic criticism proxy", () => {
  assert.deepEqual(CASE_VARIABLE_ENUMS.shame_context, ["present", "absent", "unknown"]);
  assert.ok("shame_context" in caseSnapshotSchema.properties.variables.properties);
  assert.ok(!caseSnapshotSchema.properties.variables.required.includes("shame_context"), "old case snapshots stay valid");
  assert.ok("shame_context" in caseSnapshotGenerationSchema.properties.variables.properties);
  assert.ok(caseSnapshotGenerationSchema.properties.variables.required.includes("shame_context"), "new strict generations must provide a value");
  const p = caseExtractionPrompt({
    guideManifest: { version: "synthetic" }, guideExcerpts: "", userMessage: "synthetic example",
    userFacts: [], recentTranscript: ""
  });
  assert.match(p.system, /shame_context tracks shame\/humiliation as a currently relevant experience/);
  assert.match(p.system, /A generic disagreement, guilt about an action, ordinary criticism, or longing for belonging alone does not establish present shame/);
});

test("dedicated shame node activates from explicit shame without global self-criticism or belonging pressure", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  const plan = (overrides) => planFromGraphs({
    graphs: bundle.graphs,
    variables: { ...available, self_criticism: "absent", belonging_pressure: "absent", ...overrides }
  });
  const realShame = plan({ shame_context: "present" });
  assert.ok(realShame.trace.some(n => n.id === "IC.SHAME_APPRAISAL" && n.matched));
  const genericStress = plan({ shame_context: "absent", self_criticism: "present", belonging_pressure: "present" });
  assert.ok(!genericStress.trace.some(n => n.id === "IC.SHAME_APPRAISAL" && n.matched));
  const uncertain = plan({ shame_context: "unknown", self_criticism: "present" });
  assert.ok(!uncertain.trace.some(n => n.id === "IC.SHAME_APPRAISAL" && n.matched));
});
