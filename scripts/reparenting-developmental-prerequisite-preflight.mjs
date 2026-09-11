#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const task = JSON.parse(fs.readFileSync(path.join(root, "tasks", "ACTIVE-TASK.json"), "utf8"));
const fail = (code, detail) => {
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(1);
};
const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: "utf8" });

if (task.taskId !== "reparenting-developmental-prerequisite-20260911"
    || task.exclusive !== true || task.ownerAuthorized !== true || task.pullRequest !== 52) {
  fail("ACTIVE_TASK_MISMATCH", "expected the owner-authorized exclusive PR 52 developmental-prerequisite task");
}

const branchResult = run("git", ["branch", "--show-current"]);
const branch = String(branchResult.stdout || "").trim();
if (branchResult.status !== 0 || !branch) fail("ACTIVE_TASK_BRANCH_UNREADABLE", String(branchResult.stderr || "git branch failed"));
if (branch !== task.requiredBranch) fail("ACTIVE_TASK_BRANCH_MISMATCH", `expected ${task.requiredBranch}; received ${branch}`);

for (const relative of [task.ownerOutcomePath, task.directivePath, task.statePath, task.activeLessonContractPath]) {
  if (!fs.existsSync(path.join(root, relative))) fail("TASK_AUTHORITY_MISSING", relative);
}

if (process.version !== "v24.18.0") fail("NODE_VERSION_MISMATCH", `expected v24.18.0; received ${process.version}`);
const npmResult = run("npm", ["--version"]);
const npmVersion = String(npmResult.stdout || "").trim();
if (npmResult.status !== 0 || npmVersion !== "11.16.0") fail("NPM_VERSION_MISMATCH", `expected 11.16.0; received ${npmVersion || "unreadable"}`);

const ancestor = run("git", ["merge-base", "--is-ancestor", task.startingTaskHead, "HEAD"]);
if (ancestor.status !== 0) fail("STARTING_HEAD_NOT_REACHABLE", task.startingTaskHead);

process.stdout.write(`${JSON.stringify({
  status: "PREFLIGHT_PASS",
  taskId: task.taskId,
  branch,
  pullRequest: task.pullRequest,
  node: process.version,
  npm: npmVersion
})}\n`);
