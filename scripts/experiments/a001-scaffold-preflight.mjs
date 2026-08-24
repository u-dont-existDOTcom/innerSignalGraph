import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCommand } from "./a001-scaffold-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, "../..");

export function verifyPreflightState({ task, currentBranch, originMain, originStable, installedCommit, ancestorOk }) {
  const findings = [];
  if (task.schemaVersion !== 1) findings.push("TASK_SCHEMA_UNSUPPORTED");
  if (task.taskId !== "a001-scaffold-ablation-v1") findings.push("TASK_ID_MISMATCH");
  if (task.status !== "active") findings.push("TASK_NOT_ACTIVE");
  if (task.exclusive !== true) findings.push("TASK_NOT_EXCLUSIVE");
  if (task.diagnosticOnly !== true || task.productionMutationAllowed !== false) findings.push("DIAGNOSTIC_SCOPE_MISMATCH");
  if (currentBranch !== task.requiredBranch) findings.push("TASK_BRANCH_MISMATCH");
  if (originMain !== task.source?.protectedMainSha) findings.push("PROTECTED_MAIN_BASELINE_MISMATCH");
  if (originStable !== task.source?.installedRuntimeSha) findings.push("PROTECTED_STABLE_BASELINE_MISMATCH");
  if (installedCommit !== task.source?.installedRuntimeSha) findings.push("INSTALLED_RUNTIME_BASELINE_MISMATCH");
  if (!ancestorOk) findings.push("TASK_BASE_NOT_ANCESTOR");
  return { ok: findings.length === 0, findings };
}

async function git(args) {
  const run = await runCommand("git", args, { cwd: repositoryRoot });
  if (run.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

export async function runPreflight({ productionRoot = process.env.INNER_SIGNAL_PRODUCTION_ROOT } = {}) {
  const task = JSON.parse(await fs.readFile(path.join(repositoryRoot, "tasks/ACTIVE-TASK.json"), "utf8"));
  const resolvedProductionRoot = path.resolve(productionRoot || path.join(path.dirname(repositoryRoot), "inner-signal-runtime"));
  const installed = JSON.parse(await fs.readFile(path.join(resolvedProductionRoot, ".inner-signal-autopilot/git-install.json"), "utf8"));
  const [currentBranch, originMain, originStable] = await Promise.all([
    git(["branch", "--show-current"]),
    git(["rev-parse", "origin/main"]),
    git(["rev-parse", "origin/stable"])
  ]);
  const ancestor = await runCommand("git", ["merge-base", "--is-ancestor", task.source.protectedMainSha, "HEAD"], { cwd: repositoryRoot });
  const result = verifyPreflightState({
    task,
    currentBranch,
    originMain,
    originStable,
    installedCommit: installed.commit ?? installed.installedCommit,
    ancestorOk: ancestor.code === 0
  });
  return {
    ...result,
    taskId: task.taskId,
    currentBranch,
    originMain,
    originStable,
    installedRuntime: { root: resolvedProductionRoot, commit: installed.commit ?? installed.installedCommit }
  };
}

const isCli = path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
