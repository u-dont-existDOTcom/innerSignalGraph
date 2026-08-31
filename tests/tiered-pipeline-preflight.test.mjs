import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { buildContext } from "../src/orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../src/orchestrator/run-tiered-pipeline.mjs";
import { createProviders } from "../src/providers/factory.mjs";

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

test("reviewed graph preflight failure stops before routing completion, audit, realization, or planning", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const providers = createProviders(config, { fixturePath: path.join(root, "fixtures/mock-responses/A001.json") });
  const providerStages = observeProviderStages(providers);
  const progress = [];
  const graphFailure = new Error("synthetic graph bundle unavailable");
  let planningPasses = 0;
  const context = await buildContext({
    userMessage: "I can access love but it feels unsafe. The younger me says big fuckity whoopty doo, what are you gonna do for me, and I resent a younger version for not growing up.",
    recentTranscript: "Relaxation has not fixed the credibility conflict.",
    userFacts: []
  }, config);

  await assert.rejects(
    runTieredTherapyPipeline({
      context,
      providers,
      config,
      processingMode: "auto",
      onProgress: (event) => { progress.push(event); },
      instrumentation: {
        loadGraphBundle: async () => { throw graphFailure; },
        onPlanningPass: () => { planningPasses += 1; }
      }
    }),
    (error) => error === graphFailure
  );

  assert.deepEqual(providerStages, ["case_extraction"]);
  assert.equal(planningPasses, 0);
  assert.equal(progress.some(({ stage, status }) => stage === "therapy-routing" && status === "completed"), false);
});

test("fast tier does not invoke the non-fast graph availability preflight", async () => {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const providers = createProviders(config, { fixturePath: path.join(root, "tests/fixtures/fast-therapy.json") });
  const providerStages = observeProviderStages(providers);
  let preflightCalls = 0;
  let planningPasses = 0;
  const context = await buildContext({
    userMessage: "Give me one simple suggestion.",
    recentTranscript: "",
    userFacts: []
  }, config);

  const result = await runTieredTherapyPipeline({
    context,
    providers,
    config,
    processingMode: "auto",
    instrumentation: {
      loadGraphBundle: async () => {
        preflightCalls += 1;
        throw new Error("fast must not invoke graph availability preflight");
      },
      onPlanningPass: () => { planningPasses += 1; }
    }
  });

  assert.equal(result.processingTier, "fast");
  assert.equal(preflightCalls, 0);
  assert.equal(planningPasses, 1);
  assert.deepEqual(providerStages, ["case_extraction", "realization"]);
});
