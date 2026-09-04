import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  runTherapyLatencyBenchmark,
  THERAPY_LATENCY_BASELINE,
  THERAPY_POLICY_FINGERPRINT
} from "../src/autopilot/therapy-latency-benchmark.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function byId(result, id) {
  return result.cases.find((item) => item.id === id);
}

test("mock benchmark preserves historical pipeline shape and current therapy policy with one planning pass", async () => {
  const result = await runTherapyLatencyBenchmark({ iterations: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.benchmark, "therapy-latency-fast-reviewed-v2");
  assert.equal(result.mode, "mock-only");
  assert.equal(result.performanceBaselineCommit, THERAPY_LATENCY_BASELINE.commit);
  assert.equal(result.therapyPolicyRevision, THERAPY_POLICY_FINGERPRINT.revision);
  assert.equal(result.acceptance.currentTherapyPolicy, true);
  assert.equal(result.acceptance.historicalProviderCallsPreserved, true);

  const fast = byId(result, "fast");
  assert.deepEqual(fast.performanceBaseline, THERAPY_LATENCY_BASELINE.fast);
  assert.deepEqual(fast.therapyPolicyFingerprint, THERAPY_POLICY_FINGERPRINT.fast);
  assert.deepEqual(fast.optimized.semanticHashes, [THERAPY_POLICY_FINGERPRINT.fast.semanticHash]);
  assert.deepEqual(fast.optimized.providerStages, [THERAPY_LATENCY_BASELINE.fast.providerStages]);
  assert.deepEqual(fast.optimized.providerCallCounts, [2]);
  assert.deepEqual(fast.optimized.planningPassCounts, [1]);
  assert.ok(fast.optimized.stageTimings.every(({ caseExtractionMs, planningMs, realizationMs, totalMs }) =>
    [caseExtractionMs, planningMs, realizationMs, totalMs].every(Number.isFinite)));

  const reviewed = byId(result, "reviewed");
  assert.equal(reviewed.performanceBaseline.planningPassCount, 2);
  assert.deepEqual(reviewed.therapyPolicyFingerprint, THERAPY_POLICY_FINGERPRINT.reviewed);
  assert.deepEqual(reviewed.optimized.semanticHashes, [THERAPY_POLICY_FINGERPRINT.reviewed.semanticHash]);
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
  const historicalReviewed = evidence.cases.find(({ id }) => id === "reviewed");
  assert.equal(
    historicalReviewed.baseline.semanticHash,
    "9d347f9072e7d41903b944563663d61a021220dfbcd69806ad8d8ffacef9ef97"
  );
  assert.notEqual(historicalReviewed.baseline.semanticHash, THERAPY_POLICY_FINGERPRINT.reviewed.semanticHash);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /userMessage|recentTranscript|direct_observations|hypotheses/);
});
