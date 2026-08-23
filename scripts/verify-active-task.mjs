import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function verifyActiveTask({ task, stateText, currentBranch }) {
  const findings = [];

  if (task.schemaVersion !== 1) findings.push("TASK_SCHEMA_UNSUPPORTED");
  if (task.taskId !== "a001-outcome-first-v1") findings.push("TASK_ID_MISMATCH");
  if (task.status !== "active") findings.push("TASK_NOT_ACTIVE");
  if (task.exclusive !== true) findings.push("TASK_NOT_EXCLUSIVE");
  if (currentBranch !== task.requiredBranch) findings.push("TASK_BRANCH_MISMATCH");
  if (!stateText.includes(task.taskId)) findings.push("CURRENT_STATE_TASK_MISMATCH");
  if (!stateText.includes(task.requiredBranch)) findings.push("CURRENT_STATE_BRANCH_MISMATCH");
  if (!Array.isArray(task.suspendedTaskSources) || task.suspendedTaskSources.length === 0) {
    findings.push("SUSPENDED_TASK_SOURCES_MISSING");
  }

  return {
    ok: findings.length === 0,
    taskId: task.taskId,
    requiredBranch: task.requiredBranch,
    currentBranch,
    findings,
  };
}

export function runPreflight({ cwd = process.cwd() } = {}) {
  const task = JSON.parse(readFileSync(resolve(cwd, "tasks/ACTIVE-TASK.json"), "utf8"));
  const stateText = readFileSync(resolve(cwd, "state/CODEX-CURRENT-STATE.md"), "utf8");
  const dotGitPath = resolve(cwd, ".git");
  const gitDirectory = statSync(dotGitPath).isDirectory()
    ? dotGitPath
    : resolve(dirname(dotGitPath), readFileSync(dotGitPath, "utf8").trim().replace(/^gitdir:\s*/, ""));
  const head = readFileSync(resolve(gitDirectory, "HEAD"), "utf8").trim();
  const currentBranch = head.startsWith("ref: refs/heads/")
    ? head.slice("ref: refs/heads/".length)
    : "";
  return verifyActiveTask({ task, stateText, currentBranch });
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = runPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
