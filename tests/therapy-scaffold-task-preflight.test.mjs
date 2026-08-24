import assert from "node:assert/strict";
import test from "node:test";

import { verifyActiveTask } from "../scripts/verify-active-task.mjs";

const task = {
  schemaVersion: 1,
  taskId: "therapy-scaffold-authority-repair-20260824",
  status: "active",
  exclusive: true,
  requiredBranch: "agent/therapy-scaffold-authority-repair-20260824",
  suspendedEffects: ["production activation"]
};
const stateText = "therapy-scaffold-authority-repair-20260824 agent/therapy-scaffold-authority-repair-20260824";

test("task preflight accepts only the isolated candidate branch", () => {
  const result = verifyActiveTask({ task, stateText, currentBranch: task.requiredBranch });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test("task preflight fails closed on every other branch identity", () => {
  for (const currentBranch of ["main", "stable", "exp/a001-scaffold-ablation-20260824", ""]) {
    const result = verifyActiveTask({ task, stateText, currentBranch });
    assert.equal(result.ok, false);
    assert.ok(result.findings.includes("TASK_BRANCH_MISMATCH"));
  }
});
