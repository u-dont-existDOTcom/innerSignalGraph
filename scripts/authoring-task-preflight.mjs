#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const taskPath = path.join(root, "tasks", "ACTIVE-TASK.json");

function fail(code, detail) {
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(1);
}

let task;
try {
  task = JSON.parse(fs.readFileSync(taskPath, "utf8"));
} catch (error) {
  fail("ACTIVE_TASK_INVALID", error.message);
}

if (task.schemaVersion !== 1 || task.taskId !== "obsidian-authoring-architecture-v1" || task.exclusive !== true) {
  fail("ACTIVE_TASK_MISMATCH", "expected exclusive obsidian-authoring-architecture-v1 task");
}

const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
if (branch !== task.requiredBranch) {
  fail("ACTIVE_TASK_BRANCH_MISMATCH", `expected ${task.requiredBranch}; received ${branch || "detached"}`);
}

const statePath = path.join(root, task.statePath);
let state;
try {
  state = fs.readFileSync(statePath, "utf8");
} catch (error) {
  fail("ACTIVE_TASK_STATE_MISSING", error.message);
}
for (const required of [task.taskId, task.requiredBranch, task.completionCommand]) {
  if (!state.includes(required)) fail("ACTIVE_TASK_STATE_STALE", `missing ${required}`);
}

process.stdout.write(
  `${JSON.stringify({ ok: true, taskId: task.taskId, branch, statePath: task.statePath, completionCommand: task.completionCommand })}\n`
);
