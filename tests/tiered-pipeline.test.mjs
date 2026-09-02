import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { createProviders } from "../src/providers/factory.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function observeProviderStages(providers) {
  const stages = [];
  for (const provider of Object.values(providers)) {
    const generate = provider.generate.bind(provider);
    provider.generate = async (request) => {
      const response = await generate(request);
      stages.push(request.metadata?.stage ?? null);
      return response;
    };
  }
  return stages;
}

test("fast tier uses one structured extraction and one realization without Codex/Opus adversarial stages", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const providers = createProviders(config, { fixturePath: path.join(root, "tests/fixtures/fast-therapy.json") });
  const providerStages = observeProviderStages(providers);
  const context = await buildContext({ userMessage: "Give me one simple suggestion.", recentTranscript: "", userFacts: [] }, config);
  let planningPasses = 0;
  const result = await runTieredTherapyPipeline({
    context,
    providers,
    config,
    processingMode: "auto",
    instrumentation: { onPlanningPass: () => { planningPasses += 1; } }
  });
  assert.equal(result.processingTier, "fast");
  assert.equal(result.mode, "fast-graph");
  assert.match(result.answer, /one small/i);
  assert.ok(result.interventionContract);
  assert.deepEqual(providerStages, ["case_extraction", "realization"]);
  assert.equal(planningPasses, 1);
  assert.equal(Number.isFinite(result.performance.caseExtractionMs), true);
  assert.equal(Number.isFinite(result.performance.planningMs), true);
  assert.equal(Number.isFinite(result.performance.realizationMs), true);
  assert.equal(Number.isFinite(result.performance.totalMs), true);
});


test("graph-structured credibility ambiguity uses reviewed mode and skips Opus deep analysis in Auto", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const providers = createProviders(config, { fixturePath: path.join(root, "fixtures/mock-responses/A001.json") });
  const providerStages = observeProviderStages(providers);
  const context = await buildContext({
    userMessage: "I can access love but it feels unsafe. The younger me says big fuckity whoopty doo, what are you gonna do for me, and I resent a younger version for not growing up.",
    recentTranscript: "Relaxation has not fixed the credibility conflict.",
    userFacts: []
  }, config);
  let planningPasses = 0;
  const result = await runTieredTherapyPipeline({
    context,
    providers,
    config,
    processingMode: "auto",
    instrumentation: { onPlanningPass: () => { planningPasses += 1; } }
  });
  assert.equal(result.processingTier, "reviewed");
  assert.equal(result.mode, "reviewed-graph");
  assert.match(result.routingReason, /graph-structured/i);
  assert.equal(result.next_question, result.interventionContract.nextQuestion);
  assert.ok(!result.interventionContract.selectedNodes.some((item) => item.id === "IC.NEUTRAL_WITNESS"));
  assert.match(result.answer, /adverse track record/i);
  assert.deepEqual(providerStages, ["case_extraction", "case_audit", "realization"]);
  assert.equal(planningPasses, 1);
  assert.equal(Number.isFinite(result.performance.caseExtractionMs), true);
  assert.equal(Number.isFinite(result.performance.caseAuditMs), true);
  assert.equal(Number.isFinite(result.performance.planningMs), true);
  assert.equal(Number.isFinite(result.performance.realizationMs), true);
  assert.equal(Number.isFinite(result.performance.totalMs), true);
});

test("deep tier uses one Opus analysis, one GPT critique, and one Sonnet realization instead of the eight-call forensic council", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const providers = createProviders(config, { fixturePath: path.join(root, "fixtures/mock-responses/A001.json") });
  const context = await buildContext({
    userMessage: "I can access love but it feels unsafe. The younger me says big fuckity whoopty doo, what are you gonna do for me, and I resent a younger version for not growing up.",
    recentTranscript: "Relaxation has not fixed the credibility conflict.",
    userFacts: []
  }, config);
  const result = await runTieredTherapyPipeline({ context, providers, config, processingMode: "deep" });
  assert.equal(result.processingTier, "deep");
  assert.equal(result.mode, "deep");
  assert.equal(result.adjudicatorProvider, "deterministic-compact");
  assert.match(result.answer, /show up again|one concrete/i);
  assert.match(result.interventionContract.nextQuestion, /Which age or version/i);
  assert.equal(result.realizationContractVersion, "response-realization-v5");
});

test("context accepts prior case state so follow-up turns can update rather than rebuild from scratch", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off" });
  const priorCaseSnapshot = { variables: { present_safety: "safe" }, user_goal: "clarify responsibility" };
  const priorInterventionContract = { primaryJob: { id: "IC.CREDIBILITY_REPAIR" } };
  const context = await buildContext({
    userMessage: "I mean the version of me at twenty-five.",
    recentTranscript: "",
    userFacts: [],
    priorCaseSnapshot,
    priorInterventionContract,
    priorProcessingTier: "deep"
  }, config);
  assert.equal(context.priorCaseSnapshot, priorCaseSnapshot);
  assert.equal(context.priorInterventionContract, priorInterventionContract);
  assert.equal(context.priorProcessingTier, "deep");
});
