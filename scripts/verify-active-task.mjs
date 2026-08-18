#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TERMINAL_LIVE_STATUSES = new Set(["pass", "documented_failure", "safely_blocked"]);
const ALLOWED_ABLATION_DECISIONS = new Set(["RETAIN_FULL", "SIMPLIFY", "HYBRID"]);
const REQUIRED_VERIFICATION_COMMANDS = [
  "npm ci --ignore-scripts",
  "npm test",
  "npm run graph:test",
  "npm run therapy-lessons:verify",
  "npm run audit:repository",
  "npm run audit:publication",
  "npm run verify"
];
const QUERY_ALLOWED_KEYS = new Set(["id", "query", "source", "sourceUrl", "sourceDate", "batch"]);
const QUERY_FORBIDDEN_KEYS = new Set([
  "expectedRoute",
  "expectedFirstOperation",
  "assertions",
  "prohibitedBehaviors",
  "grader",
  "targetFramework",
  "mapDisposition",
  "failureClass"
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function exists(root, rel) {
  return typeof rel === "string" && rel.length > 0 && fs.existsSync(path.join(root, rel));
}

function finding(code, message, relPath = null, severity = "error") {
  return { code, severity, path: relPath, message };
}

function unique(values) {
  return [...new Set(values)];
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function currentBranch(root, env = process.env) {
  if (env.GITHUB_HEAD_REF) return env.GITHUB_HEAD_REF;
  if (env.GITHUB_REF_TYPE === "branch" && env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  try {
    const value = execFileSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function loadTask(root) {
  const taskPath = path.join(root, "tasks", "ACTIVE-TASK.json");
  if (!fs.existsSync(taskPath)) {
    return { task: null, taskPath, error: finding("ACTIVE_TASK_MISSING", "tasks/ACTIVE-TASK.json does not exist.", "tasks/ACTIVE-TASK.json") };
  }
  try {
    return { task: readJson(taskPath), taskPath, error: null };
  } catch (error) {
    return { task: null, taskPath, error: finding("ACTIVE_TASK_INVALID_JSON", String(error.message ?? error), "tasks/ACTIVE-TASK.json") };
  }
}

export function verifyPreflight({ root = process.cwd(), env = process.env, branch = undefined } = {}) {
  const findings = [];
  const loaded = loadTask(root);
  if (loaded.error) findings.push(loaded.error);
  const task = loaded.task;
  if (!task) return { ok: false, mode: "preflight", branch: branch ?? currentBranch(root, env), task: null, findings };

  if (task.schemaVersion !== 1) findings.push(finding("ACTIVE_TASK_SCHEMA", "Active task schemaVersion must be 1.", "tasks/ACTIVE-TASK.json"));
  if (!task.taskId || typeof task.taskId !== "string") findings.push(finding("ACTIVE_TASK_ID", "Active task requires a string taskId.", "tasks/ACTIVE-TASK.json"));
  if (task.exclusive !== true) findings.push(finding("ACTIVE_TASK_NOT_EXCLUSIVE", "Active task must declare exclusive=true.", "tasks/ACTIVE-TASK.json"));
  if (!new Set(["active", "ready_for_merge", "blocked"]).has(task.status)) {
    findings.push(finding("ACTIVE_TASK_STATUS", "Active task status must be active, ready_for_merge, or blocked.", "tasks/ACTIVE-TASK.json"));
  }
  const detectedBranch = branch ?? currentBranch(root, env);
  if (!detectedBranch) {
    findings.push(finding("BRANCH_UNKNOWN", "Cannot determine the active branch. Run in the exact task worktree or provide GitHub head-ref context."));
  } else if (detectedBranch !== task.requiredBranch) {
    findings.push(finding(
      "WRONG_TASK_BRANCH",
      `Active task ${task.taskId} requires branch ${task.requiredBranch}; current branch is ${detectedBranch}.`,
      "tasks/ACTIVE-TASK.json"
    ));
  }
  const statePath = "state/CODEX-CURRENT-STATE.md";
  if (!exists(root, statePath)) {
    findings.push(finding("CURRENT_STATE_MISSING", "Canonical current-state checkpoint is missing.", statePath));
  } else {
    const state = fs.readFileSync(path.join(root, statePath), "utf8");
    if (!state.includes(task.taskId)) {
      findings.push(finding("CURRENT_STATE_TASK_MISMATCH", `Current-state checkpoint does not name active task ${task.taskId}.`, statePath));
    }
    if (!state.includes(task.requiredBranch)) {
      findings.push(finding("CURRENT_STATE_BRANCH_MISMATCH", `Current-state checkpoint does not name required branch ${task.requiredBranch}.`, statePath));
    }
    if (!state.includes(task.completionCommand)) {
      findings.push(finding("CURRENT_STATE_GATE_MISSING", `Current-state checkpoint does not name completion command ${task.completionCommand}.`, statePath));
    }
  }
  if (!Array.isArray(task.suspendedTaskSources) || task.suspendedTaskSources.length === 0) {
    findings.push(finding("SUSPENDED_TASKS_UNDECLARED", "Exclusive task must explicitly name suspended competing task sources.", "tasks/ACTIVE-TASK.json"));
  }

  return {
    ok: findings.length === 0,
    mode: "preflight",
    branch: detectedBranch,
    task: {
      taskId: task.taskId,
      status: task.status,
      exclusive: task.exclusive,
      requiredBranch: task.requiredBranch,
      pullRequest: task.pullRequest,
      completionCommand: task.completionCommand
    },
    findings
  };
}

function validateCorpus(root, task, findings) {
  const rel = task.acceptance?.paths?.corpusManifest;
  if (!exists(root, rel)) {
    findings.push(finding("CORPUS_MANIFEST_MISSING", "The 49-case corpus manifest is missing.", rel));
    return;
  }
  let manifest;
  try { manifest = readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding("CORPUS_MANIFEST_INVALID", String(error.message ?? error), rel));
    return;
  }
  const required = task.acceptance.requiredCaseCount;
  if (manifest.caseCount !== required) findings.push(finding("CORPUS_COUNT", `Corpus caseCount must equal ${required}; got ${manifest.caseCount}.`, rel));
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  if (cases.length !== required) findings.push(finding("CORPUS_CASE_LIST_COUNT", `Corpus cases array must contain ${required} entries; got ${cases.length}.`, rel));
  const ids = cases.map((item) => item?.id).filter(Boolean);
  if (ids.length !== cases.length || unique(ids).length !== cases.length) findings.push(finding("CORPUS_CASE_IDS", "Corpus IDs must be present and unique.", rel));
  const expectedBatches = task.acceptance.requiredBatchCounts ?? {};
  for (const [batch, count] of Object.entries(expectedBatches)) {
    if (manifest.batchCounts?.[batch] !== count) {
      findings.push(finding("CORPUS_BATCH_COUNT", `Batch ${batch} must contain ${count} cases; got ${manifest.batchCounts?.[batch]}.`, rel));
    }
  }
  for (const item of cases) {
    if (!item?.queryPath || !item?.graderPath) {
      findings.push(finding("CORPUS_SEPARATION_PATHS", `Case ${item?.id ?? "<unknown>"} must name separate queryPath and graderPath.`, rel));
      continue;
    }
    if (item.queryPath === item.graderPath) {
      findings.push(finding("CORPUS_SEPARATION_COLLISION", `Case ${item.id} uses the same query and grader path.`, rel));
      continue;
    }
    for (const [kind, itemPath] of [["query", item.queryPath], ["grader", item.graderPath]]) {
      if (!exists(root, itemPath)) findings.push(finding("CORPUS_MEMBER_MISSING", `Case ${item.id} ${kind} file is missing.`, itemPath));
    }
    if (exists(root, item.queryPath)) {
      try {
        const query = readJson(path.join(root, item.queryPath));
        const keys = Object.keys(query);
        for (const key of keys) {
          if (!QUERY_ALLOWED_KEYS.has(key)) findings.push(finding("QUERY_INPUT_EXTRA_FIELD", `Case ${item.id} model-input file contains non-allowlisted field ${key}.`, item.queryPath));
          if (QUERY_FORBIDDEN_KEYS.has(key)) findings.push(finding("QUERY_INPUT_GRADER_LEAK", `Case ${item.id} model-input file leaks grader field ${key}.`, item.queryPath));
        }
        if (query.id !== item.id || typeof query.query !== "string" || !query.query.trim()) {
          findings.push(finding("QUERY_INPUT_INVALID", `Case ${item.id} query file must contain matching id and non-empty query.`, item.queryPath));
        }
      } catch (error) {
        findings.push(finding("QUERY_INPUT_INVALID_JSON", String(error.message ?? error), item.queryPath));
      }
    }
  }
}

function validateResultsFile(root, rel, { requiredCaseCount, deterministic = false, live = false }, findings) {
  if (!exists(root, rel)) {
    findings.push(finding(deterministic ? "DETERMINISTIC_RESULTS_MISSING" : "LIVE_RESULTS_MISSING", "Required campaign results are missing.", rel));
    return;
  }
  let data;
  try { data = readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding("RESULTS_INVALID_JSON", String(error.message ?? error), rel));
    return;
  }
  const results = Array.isArray(data.results) ? data.results : [];
  if (data.caseCount !== requiredCaseCount || results.length !== requiredCaseCount) {
    findings.push(finding("RESULTS_COUNT", `Expected ${requiredCaseCount} results; got caseCount=${data.caseCount}, results=${results.length}.`, rel));
  }
  const ids = results.map((item) => item?.id).filter(Boolean);
  if (ids.length !== results.length || unique(ids).length !== results.length) findings.push(finding("RESULT_IDS", "Result IDs must be present and unique.", rel));
  if (deterministic) {
    const failures = results.filter((item) => item.status !== "pass" || item.pass !== true);
    if (failures.length) findings.push(finding("DETERMINISTIC_FAILURES", `${failures.length} deterministic fixture(s) are not passing.`, rel));
  }
  if (live) {
    if (["mock", "fake", "deterministic_only"].includes(data.providerMode)) {
      findings.push(finding("LIVE_PROVIDER_NOT_LIVE", `Live campaign providerMode cannot be ${data.providerMode}.`, rel));
    }
    const nonterminal = results.filter((item) => !TERMINAL_LIVE_STATUSES.has(item.status));
    if (nonterminal.length) findings.push(finding("LIVE_NONTERMINAL", `${nonterminal.length} live fixture(s) are not terminal.`, rel));
    if ((data.unresolvedSevereCount ?? 0) !== 0) findings.push(finding("LIVE_SEVERE_UNRESOLVED", "Live campaign contains unresolved severe failures.", rel));
    if (data.overallStatus === "blocked") findings.push(finding("LIVE_CAMPAIGN_BLOCKED", "Actual-model campaign is blocked; task status may be BLOCKED but cannot be COMPLETE.", rel));
  }
}

function validateAblation(root, rel, mapName, findings) {
  if (!exists(root, rel)) {
    findings.push(finding("ABLATION_MISSING", `${mapName} per-case ablation is missing.`, rel));
    return;
  }
  let data;
  try { data = readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding("ABLATION_INVALID_JSON", String(error.message ?? error), rel));
    return;
  }
  const results = Array.isArray(data.results) ? data.results : [];
  if (!numeric(data.caseCount) || data.caseCount <= 0 || results.length !== data.caseCount) {
    findings.push(finding("ABLATION_COUNT", `${mapName} needs a non-empty per-case result set with matching caseCount.`, rel));
  }
  for (const item of results) {
    for (const key of ["id", "expectedOperation", "fullOperation", "simpleOperation", "decisionRelevantDifference"]) {
      if (!(key in (item ?? {}))) findings.push(finding("ABLATION_FIELD", `${mapName} result is missing ${key}.`, rel));
    }
  }
  for (const key of ["severeRoutingErrorsFull", "severeRoutingErrorsSimple", "falseEscalationsFull", "falseEscalationsSimple", "meanRequiredFieldsFull", "meanRequiredFieldsSimple"]) {
    if (!numeric(data.metrics?.[key])) findings.push(finding("ABLATION_METRIC", `${mapName} metrics are missing numeric ${key}.`, rel));
  }
}

function validateAblationSummary(root, task, findings) {
  const rel = task.acceptance.paths.ablationSummary;
  if (!exists(root, rel)) {
    findings.push(finding("ABLATION_SUMMARY_MISSING", "Map 15/16 comparison summary is missing.", rel));
    return;
  }
  let data;
  try { data = readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding("ABLATION_SUMMARY_INVALID", String(error.message ?? error), rel));
    return;
  }
  for (const key of ["map15Decision", "map16Decision"]) {
    if (!ALLOWED_ABLATION_DECISIONS.has(data[key])) {
      findings.push(finding("ABLATION_DECISION", `${key} must be RETAIN_FULL, SIMPLIFY, or HYBRID; got ${data[key]}.`, rel));
    }
  }
  if (data.executed !== true) findings.push(finding("ABLATION_NOT_EXECUTED", "Ablation summary must state executed=true.", rel));
}

function validateMultiTurn(root, task, findings) {
  const rel = task.acceptance.paths.multiTurnResults;
  if (!exists(root, rel)) {
    findings.push(finding("MULTITURN_RESULTS_MISSING", "Adversarial multi-turn results are missing.", rel));
    return;
  }
  let data;
  try { data = readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding("MULTITURN_RESULTS_INVALID", String(error.message ?? error), rel));
    return;
  }
  const expected = task.acceptance.requiredTrajectoryIds ?? [];
  const results = Array.isArray(data.results) ? data.results : [];
  const ids = new Set(results.map((item) => item?.id));
  for (const id of expected) if (!ids.has(id)) findings.push(finding("MULTITURN_TRAJECTORY_MISSING", `Required trajectory ${id} is missing.`, rel));
  const nonterminal = results.filter((item) => !new Set(["pass", "documented_failure", "safely_blocked"]).has(item.status));
  if (nonterminal.length) findings.push(finding("MULTITURN_NONTERMINAL", `${nonterminal.length} trajectory result(s) are not terminal.`, rel));
  if ((data.unresolvedSevereCount ?? 0) !== 0) findings.push(finding("MULTITURN_SEVERE_UNRESOLVED", "Multi-turn campaign contains unresolved severe failures.", rel));
}

function validateVerification(root, task, findings) {
  const rel = task.acceptance.paths.verificationReceipt;
  if (!exists(root, rel)) {
    findings.push(finding("VERIFICATION_RECEIPT_MISSING", "Exact-head verification receipt is missing.", rel));
    return;
  }
  let data;
  try { data = readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding("VERIFICATION_RECEIPT_INVALID", String(error.message ?? error), rel));
    return;
  }
  for (const command of REQUIRED_VERIFICATION_COMMANDS) {
    if (data.commands?.[command]?.status !== "pass") findings.push(finding("VERIFICATION_COMMAND", `Verification receipt does not record pass for ${command}.`, rel));
  }
  if (data.stableUnchanged !== true) findings.push(finding("STABLE_BOUNDARY", "Verification receipt must prove stableUnchanged=true.", rel));
  if (data.articleProseUnchanged !== true) findings.push(finding("ARTICLE_BOUNDARY", "Verification receipt must prove articleProseUnchanged=true.", rel));
  if (!data.exactHeadSha || typeof data.exactHeadSha !== "string") findings.push(finding("EXACT_HEAD_MISSING", "Verification receipt must record exactHeadSha.", rel));
}

export function verifyAcceptance({ root = process.cwd(), env = process.env, branch = undefined } = {}) {
  const preflight = verifyPreflight({ root, env, branch });
  const findings = [...preflight.findings];
  const task = loadTask(root).task;
  if (!task) return { ...preflight, mode: "acceptance" };
  const acceptance = task.acceptance;
  if (!acceptance?.paths || !numeric(acceptance.requiredCaseCount)) {
    findings.push(finding("ACCEPTANCE_CONTRACT_INVALID", "Active task acceptance contract is incomplete.", "tasks/ACTIVE-TASK.json"));
  } else {
    validateCorpus(root, task, findings);
    validateResultsFile(root, acceptance.paths.deterministicResults, { requiredCaseCount: acceptance.requiredCaseCount, deterministic: true }, findings);
    validateResultsFile(root, acceptance.paths.liveResults, { requiredCaseCount: acceptance.requiredCaseCount, live: true }, findings);
    validateAblation(root, acceptance.paths.map15PerCase, "Map 15", findings);
    validateAblation(root, acceptance.paths.map16PerCase, "Map 16", findings);
    validateAblationSummary(root, task, findings);
    validateMultiTurn(root, task, findings);
    validateVerification(root, task, findings);
    for (const rel of acceptance.requiredDocumentation ?? []) {
      if (!exists(root, rel)) findings.push(finding("REQUIRED_DOCUMENT_MISSING", "Required durable documentation is missing.", rel));
    }
  }
  const ok = findings.length === 0;
  return {
    ok,
    mode: "acceptance",
    completionState: ok ? "READY_FOR_PROTECTED_MERGE" : (task.status === "blocked" ? "BLOCKED" : "INCOMPLETE"),
    branch: preflight.branch,
    task: preflight.task,
    findingCount: findings.length,
    findings
  };
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const mode = process.argv.includes("--acceptance") ? "acceptance" : "preflight";
  const result = mode === "acceptance" ? verifyAcceptance() : verifyPreflight();
  printResult(result);
  process.exitCode = result.ok ? 0 : 1;
}
