#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const fail = (code, detail) => {
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(1);
};

const task = readJson("tasks/ACTIVE-TASK.json");
if (task.taskId !== "pr46-completion-audit-20260909" || task.status !== "active" || task.exclusive !== true || task.ownerAuthorized !== true) {
  fail("ACTIVE_TASK_MISMATCH", "expected the active owner-authorized PR 46 completion audit");
}

const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
const branch = String(branchResult.stdout || "").trim();
if (branchResult.status !== 0 || !branch) fail("ACTIVE_TASK_BRANCH_UNREADABLE", String(branchResult.stderr || "git branch failed"));
if (branch !== task.requiredBranch) fail("ACTIVE_TASK_BRANCH_MISMATCH", `expected ${task.requiredBranch}; received ${branch}`);

for (const relative of [task.ownerOutcomePath, task.directivePath, task.statePath, task.activeLessonContractPath]) {
  if (!fs.existsSync(path.join(root, relative))) fail("TASK_AUTHORITY_MISSING", relative);
}

const outcome = readJson(task.ownerOutcomePath);
const directive = readJson(task.directivePath);
const lessons = readJson(task.activeLessonContractPath);
if (outcome.ownerOutcomeId !== directive.ownerOutcomeId || directive.taskId !== task.taskId || lessons.taskId !== task.taskId) {
  fail("TASK_AUTHORITY_IDENTITY_MISMATCH", "task, outcome, directive, and lesson identities must agree");
}
if (outcome.privacy?.storeVerbatimOwnerRequest !== false || outcome.privacy?.storePrivateConversationIdentifier !== false || outcome.privacy?.storePrivateDerivedHash !== false) {
  fail("PRIVATE_SOURCE_BOUNDARY_MISSING", "public task authority must explicitly forbid private source retention");
}
for (const prohibited of ["make provider, API, OpenRouter, or paid model calls", "merge PR 46 or any other pull request", "deploy, install, publish a release, or promote stable"]) {
  if (!directive.forbiddenActions.includes(prohibited)) fail("TASK_BOUNDARY_MISSING", prohibited);
}

process.stdout.write(`${JSON.stringify({ ok: true, taskId: task.taskId, branch, pullRequest: task.pullRequest, ownerOutcome: outcome.ownerOutcomeId })}\n`);
