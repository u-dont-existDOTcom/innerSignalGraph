import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyAcceptance, verifyPreflight } from "../scripts/verify-active-task.mjs";

function writeJson(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, rel, value = "ok\n") {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "active-task-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceTask = JSON.parse(fs.readFileSync(new URL("../tasks/ACTIVE-TASK.json", import.meta.url), "utf8"));
  writeJson(root, "tasks/ACTIVE-TASK.json", sourceTask);
  writeText(root, "state/CODEX-CURRENT-STATE.md", `${sourceTask.taskId}\n${sourceTask.requiredBranch}\n${sourceTask.completionCommand}\n`);
  return { root, task: sourceTask };
}

function completeArtifacts(root, task, { liveBlocked = false, leak = false } = {}) {
  const cases = [];
  for (const [batch, count] of Object.entries(task.acceptance.requiredBatchCounts)) {
    for (let i = 1; i <= count; i += 1) {
      const id = `RQ${batch}-${String(i).padStart(2, "0")}`;
      const queryPath = `corpus/real-therapy-queries/queries/${id}.json`;
      const graderPath = `corpus/real-therapy-queries/graders/${id}.json`;
      cases.push({ id, batch, queryPath, graderPath });
      writeJson(root, queryPath, leak && cases.length === 1
        ? { id, query: "Ordinary unprimed question", expectedRoute: "O3" }
        : { id, query: "Ordinary unprimed question", batch });
      writeJson(root, graderPath, { id, expectedFirstOperation: "O3_CURRENT_REALITY" });
    }
  }
  writeJson(root, task.acceptance.paths.corpusManifest, {
    schemaVersion: 1,
    caseCount: cases.length,
    batchCounts: task.acceptance.requiredBatchCounts,
    cases
  });
  const deterministic = cases.map(({ id }) => ({ id, status: "pass", pass: true }));
  writeJson(root, task.acceptance.paths.deterministicResults, { schemaVersion: 1, caseCount: cases.length, results: deterministic });
  const live = cases.map(({ id }) => ({ id, status: liveBlocked ? "safely_blocked" : "pass" }));
  writeJson(root, task.acceptance.paths.liveResults, {
    schemaVersion: 1,
    caseCount: cases.length,
    providerMode: "cli",
    overallStatus: liveBlocked ? "blocked" : "complete",
    unresolvedSevereCount: 0,
    results: live
  });
  const ablation = {
    schemaVersion: 1,
    caseCount: 1,
    metrics: {
      severeRoutingErrorsFull: 0,
      severeRoutingErrorsSimple: 0,
      falseEscalationsFull: 0,
      falseEscalationsSimple: 0,
      meanRequiredFieldsFull: 2,
      meanRequiredFieldsSimple: 1
    },
    results: [{
      id: cases[0].id,
      expectedOperation: "O3_CURRENT_REALITY",
      fullOperation: "O3_CURRENT_REALITY",
      simpleOperation: "O3_CURRENT_REALITY",
      decisionRelevantDifference: false
    }]
  };
  writeJson(root, task.acceptance.paths.map15PerCase, ablation);
  writeJson(root, task.acceptance.paths.map16PerCase, ablation);
  writeJson(root, task.acceptance.paths.ablationSummary, {
    schemaVersion: 1,
    executed: true,
    map15Decision: "SIMPLIFY",
    map16Decision: "HYBRID"
  });
  writeJson(root, task.acceptance.paths.multiTurnResults, {
    schemaVersion: 1,
    unresolvedSevereCount: 0,
    results: task.acceptance.requiredTrajectoryIds.map((id) => ({ id, status: "pass" }))
  });
  writeJson(root, task.acceptance.paths.verificationReceipt, {
    schemaVersion: 1,
    exactHeadSha: "a".repeat(40),
    stableUnchanged: true,
    articleProseUnchanged: true,
    commands: Object.fromEntries([
      "npm ci --ignore-scripts",
      "npm test",
      "npm run graph:test",
      "npm run therapy-lessons:verify",
      "npm run audit:repository",
      "npm run audit:publication",
      "npm run verify"
    ].map((command) => [command, { status: "pass" }]))
  });
  for (const rel of task.acceptance.requiredDocumentation) writeText(root, rel);
}

test("preflight rejects a resumed worker in the wrong branch", (t) => {
  const { root } = fixtureRoot(t);
  const result = verifyPreflight({ root, branch: "guide-packet-r03" });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "WRONG_TASK_BRANCH"));
});

test("preflight rejects stale current state that does not carry the task identity", (t) => {
  const { root, task } = fixtureRoot(t);
  writeText(root, "state/CODEX-CURRENT-STATE.md", "S001 is complete. What is next?\n");
  const result = verifyPreflight({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "CURRENT_STATE_TASK_MISMATCH"));
});

test("acceptance cannot be satisfied by the preliminary router alone", (t) => {
  const { root, task } = fixtureRoot(t);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.equal(result.completionState, "INCOMPLETE");
  assert.ok(result.findings.some((item) => item.code === "CORPUS_MANIFEST_MISSING"));
  assert.ok(result.findings.some((item) => item.code === "ABLATION_MISSING"));
});

test("acceptance passes only after the corpus, comparisons, live campaign, trajectories, docs, and exact-head receipt exist", (t) => {
  const { root, task } = fixtureRoot(t);
  completeArtifacts(root, task);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.completionState, "READY_FOR_PROTECTED_MERGE");
});

test("a blocked actual-model campaign is BLOCKED rather than complete", (t) => {
  const { root, task } = fixtureRoot(t);
  completeArtifacts(root, task, { liveBlocked: true });
  const taskPath = path.join(root, "tasks/ACTIVE-TASK.json");
  const updated = JSON.parse(fs.readFileSync(taskPath, "utf8"));
  updated.status = "blocked";
  writeJson(root, "tasks/ACTIVE-TASK.json", updated);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.equal(result.completionState, "BLOCKED");
  assert.ok(result.findings.some((item) => item.code === "LIVE_CAMPAIGN_BLOCKED"));
});

test("query/grader leakage fails closed even when all campaign receipts exist", (t) => {
  const { root, task } = fixtureRoot(t);
  completeArtifacts(root, task, { leak: true });
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "QUERY_INPUT_GRADER_LEAK"));
});
