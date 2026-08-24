import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  StageStore,
  aggregatePairwise,
  assertPrivateRoot,
  sha256
} from "../scripts/experiments/a001-scaffold-lib.mjs";
import {
  advisoryRealizationPrompt,
  modelFirstFormulationPrompt,
  pairwisePrompt
} from "../scripts/experiments/a001-scaffold-prompts.mjs";
import { verifyPreflightState } from "../scripts/experiments/a001-scaffold-preflight.mjs";
import { hardPipelineTraceArtifacts } from "../scripts/experiments/a001-scaffold-ablation.mjs";

const task = {
  schemaVersion: 1,
  taskId: "a001-scaffold-ablation-v1",
  status: "active",
  exclusive: true,
  diagnosticOnly: true,
  productionMutationAllowed: false,
  requiredBranch: "exp/a001-scaffold-ablation-20260824",
  source: {
    protectedMainSha: "main-sha",
    installedRuntimeSha: "stable-sha"
  }
};

test("experiment preflight fails closed outside the exclusive branch", () => {
  const accepted = verifyPreflightState({ task, currentBranch: task.requiredBranch, originMain: "main-sha", originStable: "stable-sha", installedCommit: "stable-sha", ancestorOk: true });
  assert.equal(accepted.ok, true);
  for (const currentBranch of ["main", "stable", "agent/a001-outcome-first-20260823", ""]) {
    const result = verifyPreflightState({ task, currentBranch, originMain: "main-sha", originStable: "stable-sha", installedCommit: "stable-sha", ancestorOk: true });
    assert.equal(result.ok, false);
    assert.ok(result.findings.includes("TASK_BRANCH_MISMATCH"));
  }
});

test("stage store resumes only a valid matching completion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a001-stage-store-"));
  try {
    const store = new StageStore(root, "run-1");
    await store.initialize();
    let calls = 0;
    const first = await store.run("condition-A-r1", { input: 1 }, async () => ({ value: ++calls }));
    const reused = await store.run("condition-A-r1", { input: 1 }, async () => ({ value: ++calls }));
    const changed = await store.run("condition-A-r1", { input: 2 }, async () => ({ value: ++calls }));
    assert.equal(first.reused, false);
    assert.equal(reused.reused, true);
    assert.equal(changed.reused, false);
    assert.equal(calls, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("private evidence must remain outside Git and use an explicit private suffix", () => {
  const repo = "/tmp/example-repo";
  assert.equal(assertPrivateRoot(repo, "/tmp/example-repo-private"), "/tmp/example-repo-private");
  assert.throws(() => assertPrivateRoot(repo, "/tmp/example-repo/analysis/private"), /outside/);
  assert.throws(() => assertPrivateRoot(repo, "/tmp/evidence"), /end with -private/);
});

test("condition C changes the hard-authority anchors without retaining them", () => {
  const productionPrompt = {
    system: `You are the Claude response realizer for Inner Signal. The hard reasoning is already complete: a case formulation, a deterministic intervention contract, and—when the routing tier required it—an adversarial reasoning packet are supplied below.\n\nYour job is NOT to redo the formulation. Your job is to turn the resolved reasoning into the strongest natural response to this particular user.\n\n22. Plan-realization fidelity is mandatory. Materially realize the primary job and every job listed in displayTrace.secondaryJobs. A job is realized only when the answer actually performs or explains that intervention, not merely when related vocabulary appears. For every claimed realization, return a short exact quote copied from the answer that demonstrates where the intervention was materially realized. Do not claim a node unless that evidence quote exists verbatim in the answer.`,
    user: "fixed"
  };
  const prompt = advisoryRealizationPrompt({ productionPrompt, rendererName: "Claude" });
  assert.doesNotMatch(prompt.system, /hard reasoning is already complete/i);
  assert.doesNotMatch(prompt.system, /Plan-realization fidelity is mandatory/i);
  assert.match(prompt.system, /advisory evidence/i);
  assert.equal(prompt.user, productionPrompt.user);
});

test("producer prompts do not contain the diagnostic benchmark phrasing", () => {
  const prompt = modelFirstFormulationPrompt({ userMessage: "u", recentTranscript: "r", userFacts: [], guideExcerpts: "g" }, "model");
  const text = `${prompt.system}\n${prompt.user}`;
  assert.doesNotMatch(text, /retaliation can itself supply more evidence/i);
  assert.doesNotMatch(text, /conditional care/i);
});

test("pairwise prompt contains no architecture or model provenance", () => {
  const prompt = pairwisePrompt({ originalMessage: "original", leftLabel: "response-111", leftResponse: "one", rightLabel: "response-222", rightResponse: "two" });
  const text = `${prompt.system}\n${prompt.user}`;
  assert.doesNotMatch(text, /condition [A-E]/i);
  assert.doesNotMatch(text, /sonnet|opus|codex|planner-first|model-first/i);
  assert.match(text, /response-111/);
  assert.match(text, /response-222/);
});

test("pairwise aggregation preserves order disagreement instead of averaging it away", () => {
  const records = [
    { contrast: "A-D", replicate: 1, judge: "codex", winnerCondition: "D" },
    { contrast: "A-D", replicate: 1, judge: "codex", winnerCondition: "A" },
    { contrast: "A-D", replicate: 1, judge: "opus", winnerCondition: "D" },
    { contrast: "A-D", replicate: 1, judge: "opus", winnerCondition: "D" }
  ];
  const result = aggregatePairwise(records)["A-D"];
  assert.equal(result.orderDisagreements, 1);
  assert.equal(result.orderConsistentPairs, 1);
  assert.equal(result.wins.D, 3);
  assert.equal(result.wins.A, 1);
  assert.equal(sha256(result).length, 64);
});

test("control trace projection separates every required A-stage artifact", () => {
  const snapshot = { direct_observations: [{ statement: "observed" }], hypotheses: [], unknowns: [], variables: { credibility_conflict: "present" }, audit: { safety_flags: [] } };
  const plan = { primaryJob: { id: "p", title: "Primary" }, secondaryJobs: [], selectedNodes: [{ id: "n" }], graphTrace: { matchedEdges: [] }, trace: [], requiredNuance: [], forbiddenOverclaims: [], avoid: [], nextQuestion: "What next?" };
  const call = (stage, text) => ({ request: { metadata: { stage } }, response: { text } });
  const artifacts = hardPipelineTraceArtifacts({
    result: { caseFormulation: snapshot, interventionContract: plan, answer: "Answer", next_question: "Question?" },
    providerTraces: { renderer: [call("case_extraction", "raw extraction"), call("realization", "raw realization")], openai: [call("case_audit", "raw audit")] }
  });
  assert.equal(artifacts.rawCaseExtraction.response.text, "raw extraction");
  assert.equal(artifacts.rawCaseAudit.response.text, "raw audit");
  assert.equal(artifacts.auditedCaseExtraction, snapshot);
  assert.equal(artifacts.variables, snapshot.variables);
  assert.equal(artifacts.matchedGraphNodes.selectedNodes, plan.selectedNodes);
  assert.equal(artifacts.interventionContract, plan);
  assert.match(artifacts.reasoningAdjudicationPacket.decision_summary, /Primary/);
  assert.equal(artifacts.finalRealization.response.text, "raw realization");
  assert.equal(artifacts.finalUserVisibleResponse.userVisibleText, "Answer");
});
