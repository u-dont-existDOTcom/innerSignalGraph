import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("merged Obsidian task is terminal and normal roadmap selection is restored", async () => {
  const lock = await readJson("tasks/ACTIVE-TASK.json");
  assert.equal(lock.taskId, "obsidian-authoring-architecture-v1");
  assert.equal(lock.status, "complete");
  assert.equal(lock.exclusive, false);
  assert.equal(lock.pullRequest, 13);
  assert.deepEqual(lock.suspendedTaskSources, []);

  const receiptPath = lock.terminal?.closeoutReceipt;
  assert.equal(
    receiptPath,
    "tasks/obsidian-authoring-architecture-v1/CLOSEOUT-RECEIPT.json",
  );
  const receipt = await readJson(receiptPath);
  assert.equal(receipt.taskId, lock.taskId);
  assert.equal(receipt.status, "COMPLETE");
  assert.equal(receipt.pullRequest, lock.pullRequest);
  assert.equal(receipt.reviewedHead, lock.terminal.mergedHead);
  assert.equal(receipt.squashMergeCommit, lock.terminal.mergeCommit);
  assert.equal(receipt.mergedTree, lock.terminal.mergedTree);
  assert.equal(receipt.sourceTree, receipt.mergedTree);
  assert.equal(receipt.treeMatch, true);
  assert.equal(receipt.roadmapSelectionRestored, true);
  assert.ok(receipt.requiredChecks.length > 0);
  assert.ok(receipt.requiredChecks.every(({ conclusion }) => conclusion === "SUCCESS"));

  const checkpoint = await readFile(
    path.join(root, "tasks/obsidian-authoring-architecture-v1/CURRENT-STATE.md"),
    "utf8",
  );
  assert.match(checkpoint, /Terminal checkpoint: `COMPLETE`/);
  assert.match(checkpoint, /No implementation, commit, push, pull-request, or review action remains/);
  assert.doesNotMatch(checkpoint, /ready to commit\/push/);
  assert.doesNotMatch(checkpoint, /Open the protected pull request/);

  const roadmap = await readJson("roadmap/autonomous-development.json");
  const eligibleEngineering = roadmap.tasks
    .filter(
      ({ autoStart, automationClass }) =>
        autoStart === true && automationClass.includes("engineering"),
    )
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  assert.equal(eligibleEngineering[0]?.id, "DEV-R001");
});
