import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  runTherapyLatencyBenchmark,
  THERAPY_LATENCY_BASELINE
} from "../src/autopilot/therapy-latency-benchmark.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function byId(result, id) {
  return result.cases.find((item) => item.id === id);
}

test("mock benchmark preserves Fast and Reviewed semantics while removing the discarded planning pass", async () => {
  const result = await runTherapyLatencyBenchmark({ iterations: 2 });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.mode, "mock-only");
  assert.equal(result.baselineCommit, THERAPY_LATENCY_BASELINE.commit);

  const fast = byId(result, "fast");
  assert.deepEqual(fast.optimized.semanticHashes, [THERAPY_LATENCY_BASELINE.fast.semanticHash]);
  assert.deepEqual(fast.optimized.providerStages, [THERAPY_LATENCY_BASELINE.fast.providerStages]);
  assert.deepEqual(fast.optimized.providerCallCounts, [2]);
  assert.deepEqual(fast.optimized.planningPassCounts, [1]);
  assert.ok(fast.optimized.stageTimings.every(({ caseExtractionMs, planningMs, realizationMs, totalMs }) =>
    [caseExtractionMs, planningMs, realizationMs, totalMs].every(Number.isFinite)));

  const reviewed = byId(result, "reviewed");
  assert.equal(reviewed.baseline.planningPassCount, 2);
  assert.deepEqual(reviewed.optimized.semanticHashes, [THERAPY_LATENCY_BASELINE.reviewed.semanticHash]);
  assert.deepEqual(reviewed.optimized.providerStages, [THERAPY_LATENCY_BASELINE.reviewed.providerStages]);
  assert.deepEqual(reviewed.optimized.providerCallCounts, [3]);
  assert.deepEqual(reviewed.optimized.planningPassCounts, [1]);
  assert.ok(reviewed.optimized.stageTimings.every(
    ({ caseExtractionMs, caseAuditMs, planningMs, realizationMs, totalMs }) =>
      [caseExtractionMs, caseAuditMs, planningMs, realizationMs, totalMs].every(Number.isFinite)
  ));
});

test("retained benchmark evidence records the accepted structural result without private input", async () => {
  const evidence = JSON.parse(
    await fs.readFile(path.join(root, "tasks/dev-r001-latency-benchmark-20260831/BENCHMARK-RESULTS.json"), "utf8")
  );
  assert.equal(evidence.benchmark, "therapy-latency-fast-reviewed-v1");
  assert.equal(evidence.mode, "mock-only");
  assert.equal(evidence.baselineCommit, THERAPY_LATENCY_BASELINE.commit);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.acceptance.semanticEquivalent, true);
  assert.equal(evidence.acceptance.providerCallsPreserved, true);
  assert.equal(evidence.acceptance.onePlanningPassPerTier, true);
  assert.equal(evidence.acceptance.timingsRetained, true);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /userMessage|recentTranscript|direct_observations|hypotheses/);
});
