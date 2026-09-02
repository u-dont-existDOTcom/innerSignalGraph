import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { buildContext } from "../orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";
import { createProviders } from "../providers/factory.mjs";

export const THERAPY_LATENCY_BASELINE = Object.freeze({
  commit: "f0ce1e5062c1a34c57d630cbd158491816ac5292",
  fast: Object.freeze({
    semanticHash: "e5c4df0bd3f9a15c93efa1c5f77c4605ea7f7c4256ed165731b76146ba5baa1d",
    providerStages: Object.freeze(["case_extraction", "realization"]),
    providerCallCount: 2,
    planningPassCount: 1
  }),
  reviewed: Object.freeze({
    semanticHash: "9d347f9072e7d41903b944563663d61a021220dfbcd69806ad8d8ffacef9ef97",
    providerStages: Object.freeze(["case_extraction", "case_audit", "realization"]),
    providerCallCount: 3,
    planningPassCount: 2
  })
});

const OMITTED_SEMANTIC_KEYS = new Set([
  "performance",
  "processingMs",
  "decisionLedgerId",
  "decisionLedgerPath",
  "requestId",
  "requestIds"
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function normalizeTherapyBenchmarkResult(value) {
  function visit(item) {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([key]) => !OMITTED_SEMANTIC_KEYS.has(key))
          .map(([key, nested]) => [key, visit(nested)])
      );
    }
    return item;
  }
  return canonical(visit(value));
}

export function therapyBenchmarkSemanticHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeTherapyBenchmarkResult(value)))
    .digest("hex");
}

function instrumentProviders(providers, providerCalls) {
  for (const [role, provider] of Object.entries(providers)) {
    const generate = provider.generate.bind(provider);
    provider.generate = async (request) => {
      const response = await generate(request);
      providerCalls.push({
        role,
        provider: provider.id,
        model: provider.model,
        stage: request.metadata?.stage ?? null
      });
      return response;
    };
  }
}

function timingProjection(performanceRecord, tier) {
  const fields = tier === "reviewed"
    ? ["caseExtractionMs", "caseAuditMs", "planningMs", "realizationMs", "totalMs"]
    : ["caseExtractionMs", "planningMs", "realizationMs", "totalMs"];
  return Object.fromEntries(fields.map((field) => [field, performanceRecord?.[field] ?? null]));
}

async function runBenchmarkIteration(specification) {
  const config = loadConfig({ mode: "mock", ledgerMode: "off", therapyProcessingMode: "auto" });
  const providers = createProviders(config, { fixturePath: specification.fixturePath });
  const providerCalls = [];
  instrumentProviders(providers, providerCalls);
  const context = await buildContext(specification.input, config);
  let planningPassCount = 0;
  const started = performance.now();
  const result = await runTieredTherapyPipeline({
    context,
    providers,
    config,
    processingMode: "auto",
    instrumentation: { onPlanningPass: () => { planningPassCount += 1; } }
  });
  const observedWallMs = Number((performance.now() - started).toFixed(3));
  const semanticHash = therapyBenchmarkSemanticHash(result);
  return {
    processingTier: result.processingTier,
    providerCalls,
    providerStages: providerCalls.map(({ stage }) => stage),
    providerCallCount: providerCalls.length,
    planningPassCount,
    stageTimings: timingProjection(result.performance, specification.expectedTier),
    observedWallMs,
    semanticHash,
    semanticEquivalentToBaseline: semanticHash === specification.baseline.semanticHash
  };
}

function allNumeric(record, fields) {
  return fields.every((field) => Number.isFinite(record[field]) && record[field] >= 0);
}

function summarizeCase(specification, runs) {
  const timingFields = specification.expectedTier === "reviewed"
    ? ["caseExtractionMs", "caseAuditMs", "planningMs", "realizationMs", "totalMs"]
    : ["caseExtractionMs", "planningMs", "realizationMs", "totalMs"];
  return {
    id: specification.id,
    expectedTier: specification.expectedTier,
    fixture: specification.fixture,
    baseline: specification.baseline,
    optimized: {
      semanticHashes: [...new Set(runs.map(({ semanticHash }) => semanticHash))],
      providerStages: [...new Set(runs.map(({ providerStages }) => JSON.stringify(providerStages)))].map(JSON.parse),
      providerCallCounts: [...new Set(runs.map(({ providerCallCount }) => providerCallCount))],
      planningPassCounts: [...new Set(runs.map(({ planningPassCount }) => planningPassCount))],
      observedWallMs: runs.map(({ observedWallMs }) => observedWallMs),
      stageTimings: runs.map(({ stageTimings }) => stageTimings)
    },
    acceptance: {
      tierPreserved: runs.every(({ processingTier }) => processingTier === specification.expectedTier),
      semanticEquivalentEveryIteration: runs.every(({ semanticEquivalentToBaseline }) => semanticEquivalentToBaseline),
      providerStagesPreserved: runs.every(
        ({ providerStages }) => JSON.stringify(providerStages) === JSON.stringify(specification.baseline.providerStages)
      ),
      providerCallCountPreserved: runs.every(
        ({ providerCallCount }) => providerCallCount === specification.baseline.providerCallCount
      ),
      onePlanningPassEveryIteration: runs.every(({ planningPassCount }) => planningPassCount === 1),
      requiredTimingsRetained: runs.every(({ stageTimings }) => allNumeric(stageTimings, timingFields))
    }
  };
}

export async function runTherapyLatencyBenchmark({ iterations = 3 } = {}) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new Error("Therapy latency benchmark iterations must be an integer from 1 to 20.");
  }
  const a001 = JSON.parse(
    await fs.readFile(path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"), "utf8")
  );
  const specifications = [
    {
      id: "fast",
      expectedTier: "fast",
      fixture: "tests/fixtures/fast-therapy.json",
      fixturePath: path.join(projectRoot, "tests/fixtures/fast-therapy.json"),
      input: { userMessage: "Give me one simple suggestion.", recentTranscript: "", userFacts: [] },
      baseline: THERAPY_LATENCY_BASELINE.fast
    },
    {
      id: "reviewed",
      expectedTier: "reviewed",
      fixture: a001.mockFixture,
      fixturePath: path.join(projectRoot, a001.mockFixture),
      input: a001.input,
      baseline: THERAPY_LATENCY_BASELINE.reviewed
    }
  ];
  const cases = [];
  for (const specification of specifications) {
    const runs = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      runs.push(await runBenchmarkIteration(specification));
    }
    cases.push(summarizeCase(specification, runs));
  }
  const acceptance = {
    mockOnly: true,
    semanticEquivalent: cases.every(({ acceptance: value }) => value.semanticEquivalentEveryIteration),
    providerCallsPreserved: cases.every(
      ({ acceptance: value }) => value.providerStagesPreserved && value.providerCallCountPreserved
    ),
    onePlanningPassPerTier: cases.every(({ acceptance: value }) => value.onePlanningPassEveryIteration),
    timingsRetained: cases.every(({ acceptance: value }) => value.requiredTimingsRetained)
  };
  return {
    schemaVersion: 1,
    benchmark: "therapy-latency-fast-reviewed-v1",
    mode: "mock-only",
    baselineCommit: THERAPY_LATENCY_BASELINE.commit,
    iterations,
    cases,
    acceptance,
    ok: Object.values(acceptance).every(Boolean)
  };
}
