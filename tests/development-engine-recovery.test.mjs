import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderError } from "../src/core/errors.mjs";
import {
  DEV_FAILURE,
  classifyDevelopmentFailure,
  consumesImplementationCycle,
  normalizeImplementerResult
} from "../src/dev/failure-classification.mjs";
import { runReviewWithRecovery } from "../src/dev/review.mjs";
import { runDeterministicDevelopmentGates } from "../src/dev/verification.mjs";
import { selectLiveRegressionCases } from "../src/dev/live-regression.mjs";
import { sourceManifest, manifestHash } from "../src/dev/workspace.mjs";

async function tempRoot(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("failure taxonomy keeps infrastructure retries separate from implementation cycles", () => {
  assert.equal(classifyDevelopmentFailure(new ProviderError("review timed out after 180000 ms."), { phase: "independent-review" }), DEV_FAILURE.REVIEW_TIMEOUT);
  assert.equal(classifyDevelopmentFailure({ blocker: "Bash tool needs approval to run npm test" }, { phase: "implementer" }), DEV_FAILURE.WORKER_TOOLING_LIMITATION);
  assert.equal(classifyDevelopmentFailure({ verdict: "reject" }, { phase: "independent-review" }), DEV_FAILURE.REVIEW_REJECTION);
  assert.equal(classifyDevelopmentFailure({ ok: false }, { phase: "deterministic-verification" }), DEV_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE);
  assert.equal(consumesImplementationCycle(DEV_FAILURE.REVIEW_TIMEOUT), false);
  assert.equal(consumesImplementationCycle(DEV_FAILURE.WORKER_TOOLING_LIMITATION), false);
  assert.equal(consumesImplementationCycle(DEV_FAILURE.REVIEW_REJECTION), true);
  assert.equal(consumesImplementationCycle(DEV_FAILURE.DETERMINISTIC_VERIFICATION_FAILURE), true);
});

test("worker tooling limitation with completed edits is normalized to implemented for parent verification", () => {
  const normalized = normalizeImplementerResult({
    status: "blocked",
    summary: "Implemented the patch but could not run npm test inside the tool sandbox.",
    regression_added: true,
    changed_files: ["src/dev/example.mjs", "tests/example.test.mjs"],
    tests_run: [],
    policy_change_claim: "none",
    blocker: "Sandbox approval prevented running npm test."
  });
  assert.equal(normalized.status, "implemented");
  assert.equal(normalized.controller_verification_required, true);
});

test("review timeout retries the same candidate with extended timeout without reimplementation", async () => {
  const seen = [];
  const result = await runReviewWithRecovery({
    normalTimeoutMs: 100,
    extendedTimeoutMs: 200,
    attempt: async (timeoutMs, attemptNumber) => {
      seen.push([timeoutMs, attemptNumber]);
      if (attemptNumber === 1) throw new ProviderError(`review timed out after ${timeoutMs} ms.`);
      return { verdict: "approve", promotion_safe: true };
    }
  });
  assert.equal(result.status, "completed");
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(seen, [[100, 1], [200, 2]]);
  assert.equal(result.failureClass, null);
});

test("repeated review timeout preserves a review-pending result instead of becoming implementation failure", async () => {
  const result = await runReviewWithRecovery({
    normalTimeoutMs: 100,
    extendedTimeoutMs: 200,
    attempt: async (timeoutMs) => { throw new ProviderError(`review timed out after ${timeoutMs} ms.`); }
  });
  assert.equal(result.status, "review-pending");
  assert.equal(result.failureClass, DEV_FAILURE.REVIEW_TIMEOUT);
  assert.equal(result.attempts.length, 2);
});

test("parent deterministic gates own verification and explicitly force package verify mock mode", async () => {
  const calls = [];
  const runner = async (input) => {
    calls.push(input);
    return { code: 0, stdout: "ok", stderr: "" };
  };
  const result = await runDeterministicDevelopmentGates("/candidate", {
    runner,
    env: { ...process.env, INNER_SIGNAL_MODE: "cli" }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  const packageCall = calls.find((item) => item.args?.join(" ") === "run verify");
  assert.equal(packageCall.env.INNER_SIGNAL_MODE, "mock");
  assert.equal(packageCall.env.LEDGER_MODE, "off");
});

test("live regression selection is separate and skips packaging-only changes", () => {
  assert.deepEqual(selectLiveRegressionCases({ task: { layer: "unknown" }, changes: [{ file: "scripts/verify-package.sh" }] }), []);
  assert.deepEqual(selectLiveRegressionCases({ task: { layer: "hypnosis-compiler" }, changes: [{ file: "src/hypnosis/compiler.mjs" }] }), ["H001"]);
  assert.deepEqual(selectLiveRegressionCases({ task: { layer: "performance" }, changes: [{ file: "src/orchestrator/run-tiered-pipeline.mjs" }] }), ["A001"]);
});

test("candidate manifest hash is stable and changes when managed source changes", async () => {
  const root = await tempRoot("inner-signal-manifest-hash-");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.mjs"), "export const a = 1;\n");
  const first = manifestHash(await sourceManifest(root));
  const same = manifestHash(await sourceManifest(root));
  assert.equal(first, same);
  await fs.writeFile(path.join(root, "src", "a.mjs"), "export const a = 2;\n");
  const changed = manifestHash(await sourceManifest(root));
  assert.notEqual(first, changed);
});

import { loadResumableRoadmapCandidate } from "../src/dev/resume.mjs";
import { DEV_ENGINE_REVISION } from "../src/dev/engine.mjs";
import { createCandidateWorkspace, candidateChanges } from "../src/dev/workspace.mjs";
import { runRelevantLiveRegressions } from "../src/dev/live-regression.mjs";

test("v0.12.1 review-timeout candidate is safely rebased onto the current engine before review resumes", async () => {
  const root = await tempRoot("inner-signal-resume-old-");
  const oldSource = path.join(root, "old-source");
  const currentSource = path.join(root, "current-source");
  const oldCandidate = path.join(root, "old-candidate");
  const candidateRoot = path.join(root, "candidates");
  const jobRoot = path.join(root, "jobs");
  await fs.mkdir(path.join(oldSource, "src"), { recursive: true });
  await fs.writeFile(path.join(oldSource, "src", "feature.mjs"), "export const value = 1;\n");
  await fs.cp(oldSource, currentSource, { recursive: true });
  const workspace = await createCandidateWorkspace({ sourceRoot: oldSource, candidateRoot: oldCandidate, jobId: "roadmap-DEV-R001" });
  await fs.writeFile(path.join(oldCandidate, "src", "feature.mjs"), "export const value = 2;\n");
  await candidateChanges(oldCandidate, workspace.baseline);
  await fs.writeFile(path.join(currentSource, "src", "engine-v3.mjs"), "export const engine = 3;\n");
  const jobDir = path.join(jobRoot, "roadmap-DEV-R001");
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "cycle-2-gates.json"), JSON.stringify({ ok: true, gates: [{ id: "tests", ok: true }] }));
  await fs.writeFile(path.join(jobDir, "cycle-2-implementer.json"), JSON.stringify({ status: "implemented", changed_files: ["src/feature.mjs"] }));
  const config = { devJobRoot: jobRoot, devCandidateRoot: candidateRoot };
  const resumed = await loadResumableRoadmapCandidate({
    config,
    sourceRoot: currentSource,
    taskId: "DEV-R001",
    priorTaskState: {
      status: "blocked",
      engineRevision: "continuous-dev-v2-2026-08-10",
      jobId: "roadmap-DEV-R001",
      cycle: 2,
      candidateRoot: oldCandidate,
      lastFailure: { message: "Codex CLI roadmap_patch_review timed out after 180000 ms." }
    }
  });
  assert.equal(resumed.phase, "DETERMINISTIC_VERIFY");
  assert.equal(resumed.rebasedFrom, oldCandidate);
  assert.equal(await fs.readFile(path.join(resumed.candidateRoot, "src", "feature.mjs"), "utf8"), "export const value = 2;\n");
  assert.equal(await fs.readFile(path.join(resumed.candidateRoot, "src", "engine-v3.mjs"), "utf8"), "export const engine = 3;\n");
});

test("current-engine review-pending candidate resumes at review when source and candidate hashes still match", async () => {
  const root = await tempRoot("inner-signal-resume-current-");
  const source = path.join(root, "source");
  const candidate = path.join(root, "candidate");
  const jobRoot = path.join(root, "jobs");
  await fs.mkdir(path.join(source, "src"), { recursive: true });
  await fs.writeFile(path.join(source, "src", "a.mjs"), "export const a = 1;\n");
  const workspace = await createCandidateWorkspace({ sourceRoot: source, candidateRoot: candidate, jobId: "roadmap-DEV-R001" });
  await fs.writeFile(path.join(candidate, "src", "a.mjs"), "export const a = 2;\n");
  const changes = await candidateChanges(candidate, workspace.baseline);
  const jobDir = path.join(jobRoot, "roadmap-DEV-R001");
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "cycle-1-gates.json"), JSON.stringify({ ok: true, gates: [] }));
  const config = { devJobRoot: jobRoot, devCandidateRoot: path.join(root, "candidates") };
  const resumed = await loadResumableRoadmapCandidate({
    config,
    sourceRoot: source,
    taskId: "DEV-R001",
    priorTaskState: {
      status: "review-pending",
      engineRevision: DEV_ENGINE_REVISION,
      jobId: "roadmap-DEV-R001",
      cycle: 1,
      candidateRoot: candidate,
      baselineHash: manifestHash(workspace.baseline),
      candidateHash: manifestHash(changes.after)
    }
  });
  assert.equal(resumed.phase, "INDEPENDENT_REVIEW");
  assert.equal(resumed.candidateRoot, candidate);
});

test("live regression failure is reported separately and does not mutate deterministic gate state", async () => {
  const gates = { ok: true, gates: [{ id: "tests", ok: true }] };
  const result = await runRelevantLiveRegressions({
    config: { requestTimeoutMs: 1000 },
    candidateRoot: "/candidate",
    task: { layer: "hypnosis-compiler" },
    changes: [{ file: "src/hypnosis/compiler.mjs" }],
    runner: async () => ({ code: 1, stdout: "sample failed", stderr: "" })
  });
  assert.equal(result.ok, false);
  assert.equal(result.cases[0], "H001");
  assert.deepEqual(gates, { ok: true, gates: [{ id: "tests", ok: true }] });
});

test("live regression timeout is captured as recoverable infrastructure state instead of throwing", async () => {
  const result = await runRelevantLiveRegressions({
    config: { requestTimeoutMs: 180000, devLiveRegressionTimeoutMs: 900000 },
    candidateRoot: "/candidate",
    task: { layer: "performance" },
    changes: [{ file: "src/orchestrator/run-tiered-pipeline.mjs" }],
    runner: async ({ timeoutMs, env }) => {
      assert.equal(timeoutMs, 900000);
      assert.equal(env.REQUEST_TIMEOUT_MS, "900000");
      throw new ProviderError("development live regression A001 timed out after 900000 ms.");
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.failureClass, DEV_FAILURE.LIVE_REGRESSION_TIMEOUT);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].caseId, "A001");
  assert.equal(result.attempts[0].timedOut, true);
});

test("stale verifying candidate after a live-regression crash is rebased and resumed instead of reimplemented", async () => {
  const root = await tempRoot("inner-signal-resume-crash-");
  const oldSource = path.join(root, "old-source");
  const currentSource = path.join(root, "current-source");
  const oldCandidate = path.join(root, "old-candidate");
  const candidateRoot = path.join(root, "candidates");
  const jobRoot = path.join(root, "jobs");
  await fs.mkdir(path.join(oldSource, "src"), { recursive: true });
  await fs.writeFile(path.join(oldSource, "src", "feature.mjs"), "export const value = 1;\n");
  await fs.cp(oldSource, currentSource, { recursive: true });
  const workspace = await createCandidateWorkspace({ sourceRoot: oldSource, candidateRoot: oldCandidate, jobId: "roadmap-DEV-R001" });
  await fs.writeFile(path.join(oldCandidate, "src", "feature.mjs"), "export const value = 2;\n");
  await candidateChanges(oldCandidate, workspace.baseline);
  await fs.writeFile(path.join(currentSource, "src", "engine-v4.mjs"), "export const engine = 4;\n");
  const jobDir = path.join(jobRoot, "roadmap-DEV-R001");
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, "cycle-1-gates.json"), JSON.stringify({ ok: true, gates: [{ id: "tests", ok: true }] }));
  await fs.writeFile(path.join(jobDir, "cycle-1-review.json"), JSON.stringify({ verdict: "approve", promotion_safe: true, policy_change: "restorative" }));
  await fs.writeFile(path.join(jobDir, "cycle-1-implementer.json"), JSON.stringify({ status: "implemented", changed_files: ["src/feature.mjs"] }));
  const config = { devJobRoot: jobRoot, devCandidateRoot: candidateRoot };
  const resumed = await loadResumableRoadmapCandidate({
    config,
    sourceRoot: currentSource,
    taskId: "DEV-R001",
    priorTaskState: {
      status: "verifying",
      engineRevision: "continuous-dev-v3-2026-08-10",
      jobId: "roadmap-DEV-R001",
      cycle: 1,
      candidateRoot: oldCandidate
    }
  });
  assert.ok(resumed);
  assert.equal(resumed.phase, "DETERMINISTIC_VERIFY");
  assert.equal(resumed.rebasedFrom, oldCandidate);
  assert.equal(await fs.readFile(path.join(resumed.candidateRoot, "src", "feature.mjs"), "utf8"), "export const value = 2;\n");
  assert.equal(await fs.readFile(path.join(resumed.candidateRoot, "src", "engine-v4.mjs"), "utf8"), "export const engine = 4;\n");
});
