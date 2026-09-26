import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { deriveCaseVariables, planFromGraphs } from "../src/guide-graph/planner.mjs";
import { immediateProtectionNeeded } from "../src/case-formulation/turn-task.mjs";
import { classifyTherapyTier } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { realizationPrompt } from "../src/prompts/realize.mjs";

// OWNER DECISION 2026-09-26 (tasks/focus-discipline-20260926/OWNER-DECISIONS.json, D1):
// "no this was the point, it was detecting them wrong so i switched that nonsense off".
// suicidal_state deliberately does not escalate the processing tier or add the
// generic realization safety trigger. Suicidal material is handled by the
// suicidal graph nodes and, for imminent risk, the immediate-protection check.
// If this test fails because someone re-added that escalation, do not update the
// test: the owner has to reverse the decision first.
const calm = deriveCaseVariables({ ...blankCaseVariables(), present_safety: "safe", orientation: "oriented", ability_to_stop: "yes",
  ability_to_return: "yes", suicidal_state: "absent", activation: "low", dissociation: "none", altered_state: "sober",
  inner_adult_access: "partial", witness_capacity: "present", coherent_child_state: "present", body_capacity: "adequate",
  current_intent: "conversation" });

test("owner decision: suicidal_state alone does not change the processing tier", () => {
  for (const requested of ["fast", "auto"]) {
    const baseline = classifyTherapyTier({ variables: calm }, requested);
    for (const suicidal_state of ["ideation", "intent", "imminent"]) {
      const routed = classifyTherapyTier({ variables: { ...calm, suicidal_state } }, requested);
      assert.equal(routed.tier, baseline.tier, `${requested}/${suicidal_state}`);
      assert.notEqual(routed.reason, "safety-sensitive formulation");
    }
  }
});

test("owner decision: suicidal ideation or intent alone adds no generic realization safety trigger", () => {
  for (const suicidal_state of ["ideation", "intent"]) {
    const prompt = realizationPrompt({ userMessage: "synthetic", recentTranscript: "", interventionContract: { variables: { ...calm, suicidal_state } } }, {}, "synthetic");
    assert.match(prompt.system, /No deterministic safety trigger is present\./);
  }
});

test("the retained paths still handle suicidal material: graph nodes and the imminent-danger check", async () => {
  const bundle = await compileGuideGraphs({ write: false });
  assert.equal(immediateProtectionNeeded({ ...calm, suicidal_state: "imminent" }), true);
  assert.equal(immediateProtectionNeeded({ ...calm, suicidal_state: "ideation" }), false);
  const imminent = planFromGraphs({ variables: { ...calm, suicidal_state: "imminent" }, graphs: bundle.graphs });
  assert.equal(imminent.primaryJob.id, "IC.SAFETY_ORIENTATION");
  const ideation = planFromGraphs({ variables: { ...calm, suicidal_state: "ideation" }, graphs: bundle.graphs });
  const matched = ideation.trace.map((item) => item.id);
  assert.ok(["IC.SUICIDAL_ADULT_SEAT", "IC.SUICIDAL_SELF_DEATH_INQUIRY", "IC.PRECIOUS_HUMAN_OPPORTUNITY"].some((id) => matched.includes(id)));
  const decision = JSON.parse(await fs.readFile(new URL("../tasks/focus-discipline-20260926/OWNER-DECISIONS.json", import.meta.url), "utf8"))
    .decisions.find((item) => item.id === "OWNER-2026-09-26-D1");
  assert.equal(decision.ownerQuote, "no this was the point, it was detecting them wrong so i switched that nonsense off");
  assert.equal(decision.behaviorChange, false);
});
