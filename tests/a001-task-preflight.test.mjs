import assert from "node:assert/strict";
import test from "node:test";

import { verifyActiveTask } from "../scripts/verify-active-task.mjs";

const task = {
  schemaVersion: 1,
  taskId: "a001-outcome-first-v1",
  status: "active",
  exclusive: true,
  requiredBranch: "agent/a001-outcome-first-20260823",
  suspendedTaskSources: ["PR #11"],
};
const stateText = "a001-outcome-first-v1 agent/a001-outcome-first-20260823";

test("A001 preflight accepts only the required branch", () => {
  const result = verifyActiveTask({
    task,
    stateText,
    currentBranch: "agent/a001-outcome-first-20260823",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test("A001 preflight fails closed on every other branch identity", () => {
  for (const currentBranch of ["main", "stable", "agent/merge-inner-child-protocol-20260818", ""]) {
    const result = verifyActiveTask({ task, stateText, currentBranch });
    assert.equal(result.ok, false);
    assert.ok(result.findings.includes("TASK_BRANCH_MISMATCH"));
  }
});
