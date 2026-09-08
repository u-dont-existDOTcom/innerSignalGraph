#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const task = JSON.parse(fs.readFileSync(path.join(root, "tasks", "ACTIVE-TASK.json"), "utf8"));
const fail = (code, detail) => { process.stderr.write(`${code}: ${detail}\n`); process.exit(1); };

if (task.taskId !== "constitution-context-audit-20260908" || task.exclusive !== true || task.ownerAuthorized !== true) fail("ACTIVE_TASK_MISMATCH", "expected the owner-authorized exclusive constitution/context task");
const gitBranch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
const branch = String(gitBranch.stdout || "").trim();
if (gitBranch.status !== 0 || !branch) fail("ACTIVE_TASK_BRANCH_UNREADABLE", String(gitBranch.stderr || gitBranch.error?.message || "git branch failed"));
if (branch !== task.requiredBranch) fail("ACTIVE_TASK_BRANCH_MISMATCH", `expected ${task.requiredBranch}; received ${branch || "detached"}`);
for (const relative of [task.ownerOutcomePath, task.directivePath, task.statePath, task.activeLessonContractPath]) {
  if (!fs.existsSync(path.join(root, relative))) fail("TASK_AUTHORITY_MISSING", relative);
}
const directive = JSON.parse(fs.readFileSync(path.join(root, task.directivePath), "utf8"));
if (!directive.forbiddenActions.includes("provider API or OpenRouter spending") || !directive.allowedActions.includes("push the verified head to the existing PR 46 branch")) fail("TASK_BOUNDARY_MISMATCH", "spend or publication boundary is missing");
process.stdout.write(`${JSON.stringify({ ok: true, taskId: task.taskId, branch, pullRequest: task.pullRequest, ownerOutcome: task.ownerOutcomePath })}\n`);
