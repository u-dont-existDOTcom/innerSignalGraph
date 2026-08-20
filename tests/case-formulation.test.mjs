import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runCaseFormulation, applyCaseAudit } from "../src/case-formulation/run.mjs";
import { caseAuditSchema } from "../src/case-formulation/schemas.mjs";
import { runFormulatedPipeline } from "../src/orchestrator/run-formulated-pipeline.mjs";
import { blankCaseVariables } from "../src/guide-graph/contract.mjs";
import { caseExtractionPrompt } from "../src/prompts/case-extract.mjs";
import { caseAuditPrompt } from "../src/prompts/case-audit.mjs";

async function a001Setup() {
  const definition = JSON.parse(await fs.readFile(path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"), "utf8"));
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const context = await buildContext(definition.input, config);
  const providers = createProviders(config, { fixturePath: path.join(projectRoot, definition.mockFixture) });
  return { definition, config, context, providers };
}

test("case audit output schema is strict-provider compatible", () => {
  assert.deepEqual(
    new Set(caseAuditSchema.required),
    new Set(Object.keys(caseAuditSchema.properties))
  );
});

test("formulation prompts preserve the approved decisive-outer evidence contract", () => {
  const context = {
    guideManifest: { version: "test" },
    guideExcerpts: "none",
    priorCaseSnapshot: null,
    priorInterventionContract: null,
    recentTranscript: "",
    userMessage: "test",
    userFacts: []
  };
  const extraction = caseExtractionPrompt(context).system;
  const audit = caseAuditPrompt(context, { variables: {}, unknowns: [] }).system;
  for (const prompt of [extraction, audit]) {
    assert.match(prompt, /explicit suicide or harm evidence/i);
    assert.match(prompt, /bodily, dependent, financial, or legal/i);
    assert.match(prompt, /professional support/i);
    assert.match(prompt, /absent beneficiary/i);
    assert.match(prompt, /urgent medical reassessment/i);
  }
  assert.match(audit, /direct safety unknowns before less consequential unknowns/i);
  assert.match(extraction, /non-bodily privacy, recording, evidence-handling.*remains O3/i);
  assert.match(audit, /non-bodily privacy, recording, evidence-handling.*remains O3/i);
  assert.match(extraction, /financial dependence or possible basic-needs exposure keeps the decision consequential/i);
  assert.match(audit, /financial dependence or possible basic-needs exposure keeps the decision consequential/i);
});

test("audited A001 case formulation routes credibility repair before generic relaxation", async () => {
  const { context, providers } = await a001Setup();
  const result = await runCaseFormulation({ context, providers });
  assert.equal(result.graphBundleVersion, "inner-child-somatic-pilot-2026-08-09-r5");
  assert.equal(result.plan.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.ok(result.plan.selectedNodes.some((item) => item.id === "IC.AGE_RESPONSIBILITY_CLARIFICATION"));
  assert.ok(result.plan.requiredNuance.some((item) => /relaxation/i.test(item)));
  assert.ok(result.plan.graphTrace.activeEdges.length > 0);
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

test("case audit removes an unsupported suicide unknown before deterministic routing", () => {
  const snapshot = {
    user_goal: "Contain a non-bodily third-party rights violation",
    current_issue: "Privacy harm and retained material",
    direct_observations: [],
    variables: blankCaseVariables(),
    hypotheses: [],
    unknowns: [
      { variable: "recording_exposure", question: "Could anyone else still be recorded?", importance: 5 },
      { variable: "presence_of_suicidal_ideation_or_self_harm", question: "Are there thoughts of suicide or self-harm?", importance: 5 }
    ]
  };
  const audited = applyCaseAudit(snapshot, {
    remove_observation_ids: [],
    remove_hypothesis_ids: [],
    variable_corrections: [],
    add_unknowns: [],
    safety_flags: ["No explicit suicide or self-harm evidence; do not use that unknown to select O1."],
    verdict: "revise",
    summary: "Keep the direct third-party containment question first."
  });
  assert.deepEqual(audited.unknowns.map((item) => item.variable), ["recording_exposure"]);
  assert.deepEqual(audited.audit.removed_unsupported_unknowns, ["presence_of_suicidal_ideation_or_self_harm"]);
});

test("full formulated pipeline preserves the deterministic plan in the final result", async () => {
  const { definition, config, context, providers } = await a001Setup();
  const result = await runFormulatedPipeline({ context, providers, config, caseId: definition.id });
  assert.equal(result.mode, "adversarial");
  assert.equal(result.interventionContract.primaryJob.id, "IC.CREDIBILITY_REPAIR");
  assert.equal(result.graphBundleVersion, "inner-child-somatic-pilot-2026-08-09-r5");
  assert.match(result.answer, /credibility/i);
});
