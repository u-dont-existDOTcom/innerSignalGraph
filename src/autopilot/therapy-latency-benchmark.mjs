import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { compileGuideGraphs } from "../guide-graph/compiler.mjs";
import { buildContext } from "../orchestrator/context-builder.mjs";
import { runTieredTherapyPipeline } from "../orchestrator/run-tiered-pipeline.mjs";
import { createProviders } from "../providers/factory.mjs";

export const THERAPY_LATENCY_BASELINE = Object.freeze({
  commit: "f0ce1e5062c1a34c57d630cbd158491816ac5292",
  fast: Object.freeze({
    providerStages: Object.freeze(["case_extraction", "realization"]),
    providerCallCount: 2,
    planningPassCount: 1
  }),
  reviewed: Object.freeze({
    providerStages: Object.freeze(["case_extraction", "case_audit", "realization"]),
    providerCallCount: 3,
    planningPassCount: 2
  })
});

export const THERAPY_POLICY_FINGERPRINT = Object.freeze({
  revision: "three-way-routing-2026-09-04",
  fast: Object.freeze({
    semanticHash: "e5c4df0bd3f9a15c93efa1c5f77c4605ea7f7c4256ed165731b76146ba5baa1d"
  }),
  reviewed: Object.freeze({
    semanticHash: "141acf5b4fa50e20c89fb30391fe28a5691ba59051c1e1cabb5380670d419ce5"
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

const OPTIONAL_UNKNOWN_ROUTING_KEYS = new Set([
  "actionable_problem",
  "unresolved_inner_material",
  "attention_loop",
  "thinking_yield",
  "inward_attention_effect"
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
          .filter(([key, nested]) => !OMITTED_SEMANTIC_KEYS.has(key)
            && !(OPTIONAL_UNKNOWN_ROUTING_KEYS.has(key) && nested === "unknown"))
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

async function installFrozenGraphBundle(packetRoot, graphBundle) {
  const graphDirectory = path.join(packetRoot, "installed", "current", "contents", "graphs");
  await fs.mkdir(graphDirectory, { recursive: true });
  await fs.writeFile(path.join(graphDirectory, "bundle.json"), `${JSON.stringify(graphBundle, null, 2)}\n`);
}

async function runBenchmarkIteration(specification, graphBundle) {
  const benchmarkStateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-therapy-latency-"));
  const guidePacketRoot = path.join(benchmarkStateRoot, "guide-packets");
  try {
    await installFrozenGraphBundle(guidePacketRoot, graphBundle);
    const config = loadConfig({
      mode: "mock",
      ledgerMode: "off",
      therapyProcessingMode: "auto",
      autopilotStateDir: benchmarkStateRoot,
      guidePacketRoot
    });
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
      instrumentation: {
        onPlanningPass: () => { planningPassCount += 1; },
        loadPreflightGraphBundle: async () => graphBundle,
        loadPlanningGraphBundle: async () => graphBundle
      }
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
      matchesCurrentPolicyFingerprint: semanticHash === specification.policyFingerprint.semanticHash
    };
  } finally {
    await fs.rm(benchmarkStateRoot, { recursive: true, force: true });
  }
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
    performanceBaseline: specification.performanceBaseline,
    therapyPolicyFingerprint: specification.policyFingerprint,
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
      currentPolicyFingerprintEveryIteration: runs.every(
        ({ matchesCurrentPolicyFingerprint }) => matchesCurrentPolicyFingerprint
      ),
      providerStagesPreserved: runs.every(
        ({ providerStages }) => JSON.stringify(providerStages) === JSON.stringify(specification.performanceBaseline.providerStages)
      ),
      providerCallCountPreserved: runs.every(
        ({ providerCallCount }) => providerCallCount === specification.performanceBaseline.providerCallCount
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
  const [a001, graphBundle] = await Promise.all([
    fs.readFile(path.join(projectRoot, "corpus/difficult-cases/A001-inner-child-credibility/case.json"), "utf8").then(JSON.parse),
    compileGuideGraphs({ root: projectRoot, write: false })
  ]);
  const specifications = [
    {
      id: "fast",
      expectedTier: "fast",
      fixture: "tests/fixtures/fast-therapy.json",
      fixturePath: path.join(projectRoot, "tests/fixtures/fast-therapy.json"),
      input: { userMessage: "Give me one simple suggestion.", recentTranscript: "", userFacts: [] },
      performanceBaseline: THERAPY_LATENCY_BASELINE.fast,
      policyFingerprint: THERAPY_POLICY_FINGERPRINT.fast
    },
    {
      id: "reviewed",
      expectedTier: "reviewed",
      fixture: a001.mockFixture,
      fixturePath: path.join(projectRoot, a001.mockFixture),
      input: a001.input,
      performanceBaseline: THERAPY_LATENCY_BASELINE.reviewed,
      policyFingerprint: THERAPY_POLICY_FINGERPRINT.reviewed
    }
  ];
  const cases = [];
  for (const specification of specifications) {
    const runs = [];
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      runs.push(await runBenchmarkIteration(specification, graphBundle));
    }
    cases.push(summarizeCase(specification, runs));
  }
  const acceptance = {
    mockOnly: true,
    currentTherapyPolicy: cases.every(({ acceptance: value }) => value.currentPolicyFingerprintEveryIteration),
    historicalProviderCallsPreserved: cases.every(
      ({ acceptance: value }) => value.providerStagesPreserved && value.providerCallCountPreserved
    ),
    onePlanningPassPerTier: cases.every(({ acceptance: value }) => value.onePlanningPassEveryIteration),
    timingsRetained: cases.every(({ acceptance: value }) => value.requiredTimingsRetained)
  };
  return {
    schemaVersion: 2,
    benchmark: "therapy-latency-fast-reviewed-v2",
    mode: "mock-only",
    performanceBaselineCommit: THERAPY_LATENCY_BASELINE.commit,
    therapyPolicyRevision: THERAPY_POLICY_FINGERPRINT.revision,
    iterations,
    cases,
    acceptance,
    ok: Object.values(acceptance).every(Boolean)
  };
}
