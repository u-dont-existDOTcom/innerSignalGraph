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
  const activeTask = await readJson("tasks/ACTIVE-TASK.json");
  assert.notEqual(activeTask.taskId, "obsidian-authoring-architecture-v1", "a completed historical task cannot retake the active lock");

  const receiptPath = "tasks/obsidian-authoring-architecture-v1/CLOSEOUT-RECEIPT.json";
  const receipt = await readJson(receiptPath);
  assert.equal(receipt.taskId, "obsidian-authoring-architecture-v1");
  assert.equal(receipt.status, "COMPLETE");
  assert.equal(receipt.pullRequest, 13);
  assert.match(receipt.reviewedHead, /^[0-9a-f]{40}$/);
  assert.match(receipt.squashMergeCommit, /^[0-9a-f]{40}$/);
  assert.match(receipt.mergedTree, /^[0-9a-f]{40}$/);
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
