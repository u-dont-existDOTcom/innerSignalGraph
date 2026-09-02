import test from "node:test";
import assert from "node:assert/strict";
import { compileGuideGraphs } from "../src/guide-graph/compiler.mjs";
import { runGraphRegressionSuite } from "../src/guide-graph/regressions.mjs";
import { planFromGraphs } from "../src/guide-graph/planner.mjs";

let bundle;

test("inner-child and somatic sources compile into a validated directed-graph bundle", async () => {
  bundle = await compileGuideGraphs({ write: false });
  assert.equal(bundle.contractVersion, "guide-graph-v1");
  assert.equal(bundle.version, "inner-child-somatic-pilot-2026-08-09-r5");
  assert.equal(bundle.stats.graphCount, 3);
  assert.equal(bundle.stats.nodeCount, 33);
  assert.equal(bundle.stats.edgeCount, 28);
  assert.equal(bundle.stats.ownerAmendmentCount, 14);
  assert.ok(bundle.sourceMaps.some((item) => item.guideId === "inner-child-guide"));
  assert.ok(bundle.sourceMaps.some((item) => item.guideId === "somatic-sequencing-guide"));
  assert.ok(bundle.sourceMaps.some((item) => item.guideId === "vagal-blitz-source"));
});

test("compiled guide-graph bundles contain no wall-clock build metadata", async () => {
  const compiled = await compileGuideGraphs({ write: false });
  assert.equal(Object.hasOwn(compiled, "compiledAt"), false);
});

test("all authored branch cases pass the deterministic graph planner", async () => {
  const result = await runGraphRegressionSuite();
  assert.equal(result.ok, true, JSON.stringify(result.results.filter((item) => !item.ok), null, 2));
  assert.equal(result.count, 12);
});

test("advanced release is blocked by physical risk and cannot outrank safety", async () => {
  bundle ??= await compileGuideGraphs({ write: false });
  const plan = planFromGraphs({
    graphs: bundle.graphs,
    variables: {
      present_safety: "safe",
      orientation: "oriented",
      ability_to_stop: "yes",
      ability_to_return: "yes",
      altered_state: "sober",
      advanced_release_interest: "present",
      advanced_release_physical_risk: "present",
      panic_instability: "absent"
    }
  });
  assert.equal(plan.primaryJob.id, "SOM.ADVANCED_RELEASE_BLOCK");
  assert.ok(plan.blockedNodes.some((item) => item.id === "SOM.ADVANCED_RELEASE_OPTIONAL"));
  assert.ok(plan.avoid.some((item) => /syncope/i.test(item)));
});

test("stable discrete EMDR and developmental EMDR use different prerequisites", async () => {
  bundle ??= await compileGuideGraphs({ write: false });
  const stable = {
    present_safety: "safe",
    orientation: "oriented",
    ability_to_stop: "yes",
    ability_to_return: "yes",
    activation: "moderate",
    dissociation: "none",
    altered_state: "sober",
    current_intent: "memory_processing",
    emdr_interest: "present"
  };
  const discrete = planFromGraphs({ graphs: bundle.graphs, variables: { ...stable, target_type: "discrete", inner_adult_access: "low", support_available: "absent" } });
  assert.ok(discrete.selectedNodes.some((item) => item.id === "SOM.EMDR_DISCRETE"));

  const developmental = planFromGraphs({ graphs: bundle.graphs, variables: { ...stable, target_type: "developmental", inner_adult_access: "low", support_available: "absent" } });
  assert.ok(developmental.deferredNodes.some((item) => item.id === "SOM.EMDR_DEVELOPMENTAL"));
  assert.ok(developmental.selectedNodes.some((item) => item.id === "SOM.EMDR_DEVELOPMENTAL_DEFER"));
});


test("borrowed adulthood explicitly supports the part attempting the adult role", async () => {
  bundle ??= await compileGuideGraphs({ write: false });
  const node = bundle.graphs.flatMap((graph) => graph.nodes).find((item) => item.id === "IC.BORROW_ONE_FUNCTION");
  assert.ok(node);
  assert.ok(node.tags.includes("adult-side-borrowing"));
  assert.ok(node.recommendations.some((item) => /part attempting the adult role/i.test(item)));
  assert.ok(node.effects.requiredNuance.some((item) => /not only the younger state/i.test(item)));
});


test("credibility planning keeps unrelated future goals out of Deferred and prefers graph-authored discriminating questions", async () => {
  bundle ??= await compileGuideGraphs({ write: false });
  const plan = planFromGraphs({
    graphs: bundle.graphs,
    variables: {
      present_safety: "safe", orientation: "oriented", ability_to_stop: "yes", ability_to_return: "yes",
      activation: "moderate", dissociation: "none", altered_state: "sober", inner_adult_access: "partial",
      love_access: "accessible", self_directed_love: "unsafe", protective_response: "present",
      witness_capacity: "present", credibility_conflict: "present", credibility_evidence_state: "adverse", internal_speaker_relation: "unresolved",
      age_agency_ambiguity: "present", resentment_toward_younger_self: "present",
      coherent_child_state: "present", self_criticism: "present", current_intent: "conversation",
      forgiveness_interest: "absent", support_available: "present", body_capacity: "adequate", target_type: "developmental"
    },
    unknowns: [{ variable: "love_safety_reason", question: "What makes the love feel unsafe?", importance: 5 }]
  });
  assert.equal(plan.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.equal(plan.nextQuestion, "Which age or version of you is the resentment actually directed toward, and what opportunity do you believe that version failed to use?");
  assert.deepEqual(plan.nextQuestionSource, { type: "graph-node", id: "IC.AGE_RESPONSIBILITY_CLARIFICATION" });
  assert.equal(plan.deferredNodes.some((item) => item.id === "IC.FORGIVENESS_LATER"), false);
  assert.ok(plan.displayTrace.secondaryJobs.some((item) => item.id === "IC.AGE_RESPONSIBILITY_CLARIFICATION"));
  assert.ok(!plan.selectedNodes.some((item) => item.id === "IC.NEUTRAL_WITNESS"));
  assert.ok(plan.requiredNuance.some((item) => /observable adult-life outcome as adverse evidence/i.test(item)));
  assert.ok(plan.requiredNuance.some((item) => /Chronological adulthood does not establish/i.test(item)));
  assert.ok(plan.forbiddenOverclaims.some((item) => /Do not merge the resentful voice/i.test(item)));
  assert.ok(plan.forbiddenOverclaims.some((item) => /independently established objective verdict/i.test(item)));
  assert.ok(plan.requiredNuance.some((item) => /regulation remains a supporting job/i.test(item)));
  assert.ok(plan.requiredNuance.some((item) => /Neither side automatically adjudicates/i.test(item)));
  assert.ok(!plan.displayTrace.deferredNodes.some((item) => /EMDR|BRAINSPOTTING/i.test(item.id)));
});
