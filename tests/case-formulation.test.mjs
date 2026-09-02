import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import {
  runCaseFormulation,
  runUnauditedCaseSnapshot,
  runUnauditedCaseFormulation,
  applyCaseAudit
} from "../src/case-formulation/run.mjs";
import { runFormulatedPipeline } from "../src/orchestrator/run-formulated-pipeline.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";

async function a001Setup() {
  const definition = JSON.parse(await fs.readFile(path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"), "utf8"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const context = await buildContext(definition.input, config);
  const providers = createProviders(config, { fixturePath: path.join(projectRoot, definition.mockFixture) });
  return { definition, config, context, providers };
}

test("audited A001 case formulation routes credibility repair before generic relaxation", async () => {
  const { context, providers } = await a001Setup();
  const result = await runCaseFormulation({ context, providers });
  assert.equal(result.graphBundleVersion, "inner-child-somatic-pilot-2026-08-09-r5");
  assert.equal(result.plan.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.ok(result.plan.selectedNodes.some((item) => item.id === "IC.AGE_RESPONSIBILITY_CLARIFICATION"));
  assert.ok(result.plan.requiredNuance.some((item) => /relaxation/i.test(item)));
  assert.ok(result.plan.graphTrace.activeEdges.length > 0);
});

test("snapshot-only extraction preserves unaudited formulation behavior without planning early", async () => {
  const snapshotSetup = await a001Setup();
  const snapshotOnly = await runUnauditedCaseSnapshot({
    context: snapshotSetup.context,
    provider: snapshotSetup.providers.renderer
  });
  assert.equal(Object.hasOwn(snapshotOnly, "plan"), false);
  assert.equal(Object.hasOwn(snapshotOnly, "graphBundleVersion"), false);

  const formulationSetup = await a001Setup();
  let planningPasses = 0;
  const formulation = await runUnauditedCaseFormulation({
    context: formulationSetup.context,
    provider: formulationSetup.providers.renderer,
    onPlanningPass: () => { planningPasses += 1; }
  });
  assert.deepEqual(snapshotOnly.snapshot, formulation.snapshot);
  assert.equal(snapshotOnly.providerMetadata.extractor.provider, formulation.providerMetadata.extractor.provider);
  assert.equal(snapshotOnly.providerMetadata.extractor.model, formulation.providerMetadata.extractor.model);
  assert.equal(snapshotOnly.providerMetadata.extractor.requestId, formulation.providerMetadata.extractor.requestId);
  assert.equal(planningPasses, 1);
  assert.ok(formulation.plan);
  assert.equal(formulation.graphBundleVersion, "inner-child-somatic-pilot-2026-08-09-r5");
});

test("case audit corrections are applied without converting hypotheses into observations", () => {
  const snapshot = {
    user_goal: "Understand the conflict",
    current_issue: "Anger at a younger self",
    direct_observations: [
      { id: "o1", statement: "Love is available", evidence: "I can access love" },
      { id: "o2", statement: "The critic is inherited", evidence: "I feel angry" }
    ],
    variables: { ...blankCaseVariables(), love_access: "accessible", self_directed_love: "unknown" },
    hypotheses: [
      { id: "h1", claim: "The angry voice is definitely inherited", evidence: "anger", confidence: "high", alternatives: [] }
    ],
    unknowns: []
  };
  const audited = applyCaseAudit(snapshot, {
    remove_observation_ids: ["o2"],
    remove_hypothesis_ids: ["h1"],
    variable_corrections: [{ field: "self_directed_love", value: "unsafe", reason: "The user says the love feels unsafe when directed inward." }],
    add_unknowns: [{ variable: "age_agency_ambiguity", question: "Which age or version is being blamed?", importance: 5 }],
    safety_flags: [],
    verdict: "revise",
    summary: "Keep the direct observation and preserve age ambiguity."
  });
  assert.deepEqual(audited.direct_observations.map((item) => item.id), ["o1"]);
  assert.deepEqual(audited.hypotheses, []);
  assert.equal(audited.variables.self_directed_love, "unsafe");
  assert.equal(audited.unknowns[0].importance, 5);
});

test("full formulated pipeline preserves the deterministic plan in the final result", async () => {
  const { definition, config, context, providers } = await a001Setup();
  const result = await runFormulatedPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.mode, "adversarial");
  assert.equal(result.interventionContract.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.equal(result.graphBundleVersion, "inner-child-somatic-pilot-2026-08-09-r5");
  assert.match(result.answer, /credibility/i);
});
