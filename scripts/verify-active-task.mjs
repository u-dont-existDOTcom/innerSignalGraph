#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORPUS_CASE_COUNT,
  CORPUS_SOURCE_SHA,
  expectedCorpusIds,
  loadCompleteCorpus,
  sha256
} from "../src/therapy-protocol/corpus.mjs";
import { ABLATION_CAMPAIGN_VERSION, DETERMINISTIC_CAMPAIGN_VERSION } from "../src/therapy-protocol/campaign.mjs";
import {
  LIVE_CAMPAIGN_VERSION,
  MULTITURN_CAMPAIGN_VERSION,
  PIPELINE_IDENTITY,
  REQUIRED_LIVE_MODELS
} from "../src/therapy-protocol/live-campaign.mjs";
import { THERAPY_PROTOCOL_ROUTER_VERSION } from "../src/therapy-protocol/router.mjs";
import { REQUIRED_TRAJECTORY_IDS, loadTrajectoryGraders, loadTrajectoryInputs } from "../src/therapy-protocol/trajectory-corpus.mjs";

const REQUIRED_TASK = Object.freeze({
  taskId: "inner-child-protocol-comparison-v1",
  branch: "agent/merge-inner-child-protocol-20260818",
  repository: "u-dont-existDOTcom/innerSignalGraph",
  pullRequest: 11,
  sourceSha: CORPUS_SOURCE_SHA
});
const ALLOWED_ABLATION_DECISIONS = new Set(["RETAIN_FULL", "SIMPLIFY", "HYBRID"]);
const TERMINAL_STATUSES = new Set(["pass", "documented_failure"]);
const REQUIRED_VERIFICATION_COMMANDS = [
  "npm ci --ignore-scripts",
  "npm test",
  "npm run graph:test",
  "npm run therapy-lessons:verify",
  "npm run audit:repository",
  "npm run audit:publication",
  "npm run verify",
  "npm run task:preflight"
];
const ARTICLE_SOURCE_SHA256 = "2d81a6d01fc5b31f96ca9ca3a54a3109d4b80d56114089d1acb4471110631fe4";
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function exists(root, rel) {
  return typeof rel === "string" && rel.length > 0 && fs.existsSync(path.join(root, rel));
}

function finding(code, message, relPath = null, severity = "error") {
  return { code, severity, path: relPath, message };
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sameNumber(actual, expected) {
  return numeric(actual) && Math.abs(actual - expected) < 1e-10;
}

function exactIds(items, expected) {
  const ids = items.map((item) => item?.id);
  return ids.length === expected.length
    && new Set(ids).size === expected.length
    && JSON.stringify([...ids].sort()) === JSON.stringify([...expected].sort());
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function currentBranch(root, env = process.env) {
  if (env.GITHUB_HEAD_REF) return env.GITHUB_HEAD_REF;
  if (env.GITHUB_REF_TYPE === "branch" && env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  return git(root, ["branch", "--show-current"]);
}

function loadTask(root) {
  const rel = "tasks/ACTIVE-TASK.json";
  try {
    return { task: readJson(path.join(root, rel)), error: null };
  } catch (error) {
    return { task: null, error: finding(fs.existsSync(path.join(root, rel)) ? "ACTIVE_TASK_INVALID_JSON" : "ACTIVE_TASK_MISSING", String(error.message ?? error), rel) };
  }
}

export function verifyPreflight({ root = process.cwd(), env = process.env, branch = undefined } = {}) {
  const findings = [];
  const loaded = loadTask(root);
  if (loaded.error) findings.push(loaded.error);
  const task = loaded.task;
  const detectedBranch = branch ?? currentBranch(root, env);
  if (!task) return { ok: false, mode: "preflight", branch: detectedBranch, task: null, findings };
  const exact = {
    schemaVersion: task.schemaVersion === 1,
    taskId: task.taskId === REQUIRED_TASK.taskId,
    repository: task.repository === REQUIRED_TASK.repository,
    requiredBranch: task.requiredBranch === REQUIRED_TASK.branch,
    pullRequest: task.pullRequest === REQUIRED_TASK.pullRequest,
    source: task.source?.mainSha === REQUIRED_TASK.sourceSha && task.source?.fixtureCount === CORPUS_CASE_COUNT
  };
  for (const [field, ok] of Object.entries(exact)) if (!ok) findings.push(finding("ACTIVE_TASK_IDENTITY", `Active task has an invalid pinned ${field}.`, "tasks/ACTIVE-TASK.json"));
  if (task.exclusive !== true) findings.push(finding("ACTIVE_TASK_NOT_EXCLUSIVE", "Active task must declare exclusive=true.", "tasks/ACTIVE-TASK.json"));
  if (!new Set(["active", "ready_for_merge", "blocked"]).has(task.status)) findings.push(finding("ACTIVE_TASK_STATUS", "Active task status must be active, ready_for_merge, or blocked.", "tasks/ACTIVE-TASK.json"));
  if (!detectedBranch) findings.push(finding("BRANCH_UNKNOWN", "Cannot determine the active branch."));
  else if (detectedBranch !== REQUIRED_TASK.branch) findings.push(finding("WRONG_TASK_BRANCH", `Active task requires ${REQUIRED_TASK.branch}; current branch is ${detectedBranch}.`, "tasks/ACTIVE-TASK.json"));
  const stateRel = "state/CODEX-CURRENT-STATE.md";
  if (!exists(root, stateRel)) findings.push(finding("CURRENT_STATE_MISSING", "Canonical current-state checkpoint is missing.", stateRel));
  else {
    const state = fs.readFileSync(path.join(root, stateRel), "utf8");
    for (const required of [REQUIRED_TASK.taskId, REQUIRED_TASK.branch, task.completionCommand]) {
      if (!state.includes(required)) findings.push(finding("CURRENT_STATE_TASK_MISMATCH", `Current-state checkpoint does not name ${required}.`, stateRel));
    }
  }
  if (!Array.isArray(task.suspendedTaskSources) || task.suspendedTaskSources.length === 0) findings.push(finding("SUSPENDED_TASKS_UNDECLARED", "Exclusive task must name suspended competing task sources.", "tasks/ACTIVE-TASK.json"));
  return {
    ok: findings.length === 0,
    mode: "preflight",
    branch: detectedBranch,
    task: { taskId: task.taskId, status: task.status, exclusive: task.exclusive, requiredBranch: task.requiredBranch, pullRequest: task.pullRequest, completionCommand: task.completionCommand },
    findings
  };
}

function validateCorpus(root, task, findings) {
  const rel = task.acceptance.paths.corpusManifest;
  try {
    const corpus = loadCompleteCorpus(root);
    if (corpus.manifestPath && path.relative(root, corpus.manifestPath).replaceAll("\\", "/") !== rel) throw new Error("Acceptance corpus path differs from the strict loader path.");
    return corpus;
  } catch (error) {
    findings.push(finding("CORPUS_INVALID", String(error.message ?? error), rel));
    return null;
  }
}

function readArtifact(root, rel, code, findings) {
  if (!exists(root, rel)) {
    findings.push(finding(`${code}_MISSING`, "Required acceptance artifact is missing.", rel));
    return null;
  }
  try { return readJson(path.join(root, rel)); } catch (error) {
    findings.push(finding(`${code}_INVALID_JSON`, String(error.message ?? error), rel));
    return null;
  }
}

function validateDeterministic(root, rel, corpus, findings) {
  const data = readArtifact(root, rel, "DETERMINISTIC_RESULTS", findings);
  if (!data || !corpus) return;
  const results = Array.isArray(data.results) ? data.results : [];
  if (data.schemaVersion !== 2 || data.campaignVersion !== DETERMINISTIC_CAMPAIGN_VERSION || data.routerVersion !== THERAPY_PROTOCOL_ROUTER_VERSION) findings.push(finding("DETERMINISTIC_IDENTITY", "Deterministic artifact version/router identity is invalid.", rel));
  if (data.sourceCommit !== CORPUS_SOURCE_SHA || data.corpusManifestSha256 !== corpus.manifestSha256) findings.push(finding("DETERMINISTIC_PROVENANCE", "Deterministic artifact is not bound to the pinned source and corpus.", rel));
  if (data.caseCount !== CORPUS_CASE_COUNT || data.passCount !== CORPUS_CASE_COUNT || !exactIds(results, expectedCorpusIds())) findings.push(finding("DETERMINISTIC_COUNT_IDS", "Deterministic artifact must contain the exact 49-case set, all passing.", rel));
  const queryHashes = new Map(corpus.cases.map(({ input }) => [input.id, input.querySha256]));
  for (const item of results) {
    if (item.pass !== true || item.status !== "pass" || item.severeError !== false || item.querySha256 !== queryHashes.get(item.id)) findings.push(finding("DETERMINISTIC_CASE", `Deterministic case ${item.id ?? "<unknown>"} lacks passing hash-bound evidence.`, rel));
  }
}

function validTelemetry(calls, { evaluation = false } = {}) {
  if (!Array.isArray(calls) || calls.length === 0) return false;
  return calls.every((call) => call.transport === "cli"
    && ["openai", "anthropic"].includes(call.provider)
    && typeof call.model === "string" && call.model.length > 0
    && typeof call.requestId === "string" && call.requestId.length > 0
    && typeof call.responseId === "string" && call.responseId.length > 0
    && typeof call.startedAt === "string" && typeof call.completedAt === "string"
    && !call.error
    && (!evaluation || (call.provider === "openai" && call.model === REQUIRED_LIVE_MODELS.evaluator)));
}

function validateLiveHeader(data, version, manifestHash, rel, findings) {
  if (data.schemaVersion !== 2 || data.campaignVersion !== version || data.pipelineIdentity !== PIPELINE_IDENTITY || data.providerMode !== "cli") findings.push(finding("LIVE_IDENTITY", "Actual-model artifact lacks the exact campaign, pipeline, or CLI identity.", rel));
  if (JSON.stringify(data.models) !== JSON.stringify(REQUIRED_LIVE_MODELS)) findings.push(finding("LIVE_MODELS", "Actual-model artifact does not declare the exact production-candidate models.", rel));
  if (data.corpusManifestSha256 !== manifestHash) findings.push(finding("LIVE_CORPUS_HASH", "Actual-model artifact is not bound to the validated input manifest.", rel));
  if (!SHA40.test(data.codeIdentity?.headSha ?? "") || !SHA40.test(data.codeIdentity?.treeSha ?? "") || data.codeIdentity?.branch !== REQUIRED_TASK.branch || data.codeIdentity?.dirty !== false) findings.push(finding("LIVE_CODE_IDENTITY", "Actual-model artifact must identify a clean exact branch head/tree.", rel));
  if (data.phase !== "graded" || data.overallStatus !== "complete" || data.unresolvedSevereCount !== 0) findings.push(finding("LIVE_NOT_COMPLETE", "Actual-model artifact must be completely graded with zero unresolved severe failures.", rel));
}

function validateLive(root, rel, corpus, findings) {
  const data = readArtifact(root, rel, "LIVE_RESULTS", findings);
  if (!data || !corpus) return null;
  validateLiveHeader(data, LIVE_CAMPAIGN_VERSION, corpus.manifestSha256, rel, findings);
  if (data.sourceCommit !== CORPUS_SOURCE_SHA) findings.push(finding("LIVE_SOURCE", "Live result is not bound to the pinned Creative Tail source.", rel));
  const results = Array.isArray(data.results) ? data.results : [];
  if (data.caseCount !== CORPUS_CASE_COUNT || !exactIds(results, expectedCorpusIds())) findings.push(finding("LIVE_COUNT_IDS", "Live campaign must contain the exact 49-case ID set.", rel));
  const cases = new Map(corpus.cases.map((item) => [item.input.id, item]));
  for (const item of results) {
    const source = cases.get(item.id);
    const grader = source?.grader;
    const operationPass = Boolean(grader?.expected.acceptableOperations.includes(item.actualOperation));
    const dispositionPass = item.actualDisposition === grader?.expected.disposition;
    const falseEscalation = Boolean(grader?.expected.falseEscalationOperations.includes(item.actualOperation));
    const inner = new Set(["O4_BORROWED_CAPACITY", "O5_LIGHT_REPARENTING", "O6_TRUST_BEHAVIOR", "O7_IDENTITY_DIFFERENTIATION", "O8_DEPTH_ACCESS"]);
    const severe = !operationPass && (grader?.expected.wrongRouteSeverity === "severe" || (inner.has(item.actualOperation) && !inner.has(grader?.expected.operation)));
    const evaluationShape = JSON.stringify(item.evaluation?.assertions?.map((entry) => entry.criterion)) === JSON.stringify(grader?.expected.assertions)
      && JSON.stringify(item.evaluation?.prohibitedBehaviors?.map((entry) => entry.criterion)) === JSON.stringify(grader?.expected.prohibitedBehaviors);
    const invalid = !source
      || item.querySha256 !== source.input.querySha256
      || item.executionStatus !== "executed"
      || !TERMINAL_STATUSES.has(item.status)
      || item.telemetryComplete !== true
      || !validTelemetry(item.telemetry)
      || !validTelemetry(item.evaluation?.telemetry, { evaluation: true })
      || typeof item.answer !== "string" || !item.answer.trim()
      || typeof item.actualOperation !== "string" || typeof item.actualDisposition !== "string"
      || !numeric(item.fieldBurden) || !numeric(item.questionBurden)
      || item.expectedOperation !== grader?.expected.operation
      || JSON.stringify(item.acceptableOperations) !== JSON.stringify(grader?.expected.acceptableOperations)
      || item.expectedDisposition !== grader?.expected.disposition
      || item.operationPass !== operationPass || item.dispositionPass !== dispositionPass
      || item.falseEscalation !== falseEscalation || !evaluationShape
      || severe || item.evaluation?.severeError !== false || item.severeError !== false;
    if (invalid) findings.push(finding("LIVE_CASE_EVIDENCE", `Live case ${item.id ?? "<unknown>"} lacks complete non-mock execution and grading evidence.`, rel));
  }
  return data;
}

function recomputedAblationMetrics(results) {
  return {
    disagreements: results.filter((item) => item.disagreement).length,
    decisionRelevantDisagreements: results.filter((item) => item.decisionRelevantDifference).length,
    severeRoutingErrorsFull: results.filter((item) => item.severeErrorFull).length,
    severeRoutingErrorsSimple: results.filter((item) => item.severeErrorSimple).length,
    falseEscalationsFull: results.filter((item) => item.falseEscalationFull).length,
    falseEscalationsSimple: results.filter((item) => item.falseEscalationSimple).length,
    meanRequiredFieldsFull: mean(results.map((item) => item.requiredFieldCountFull)),
    meanRequiredFieldsSimple: mean(results.map((item) => item.requiredFieldCountSimple)),
    meanQuestionBurdenFull: mean(results.map((item) => item.questionCountFull)),
    meanQuestionBurdenSimple: mean(results.map((item) => item.questionCountSimple))
  };
}

function validateAblation(root, rel, map, corpus, findings) {
  const data = readArtifact(root, rel, "ABLATION", findings);
  if (!data || !corpus) return null;
  const results = Array.isArray(data.results) ? data.results : [];
  if (data.schemaVersion !== 2 || data.campaignVersion !== ABLATION_CAMPAIGN_VERSION || data.map !== map || data.executed !== true || data.fullVariant !== "full" || data.simpleVariant !== `${map}-simple`) findings.push(finding("ABLATION_IDENTITY", `${map} comparator identity is invalid.`, rel));
  if (data.sourceCommit !== CORPUS_SOURCE_SHA || data.corpusManifestSha256 !== corpus.manifestSha256 || data.routerVersion !== THERAPY_PROTOCOL_ROUTER_VERSION) findings.push(finding("ABLATION_PROVENANCE", `${map} comparison is not source/corpus/router bound.`, rel));
  if (data.caseCount !== CORPUS_CASE_COUNT || !exactIds(results, expectedCorpusIds())) findings.push(finding("ABLATION_COUNT_IDS", `${map} must compare full versus simple on the exact 49 cases.`, rel));
  if (typeof data.competitorProvenance !== "string" || data.competitorProvenance.length < 80 || !ALLOWED_ABLATION_DECISIONS.has(data.decision)) findings.push(finding("ABLATION_DECISION", `${map} lacks competitor provenance or a valid retain/simplify decision.`, rel));
  for (const item of results) {
    for (const key of ["id", "querySha256", "expectedOperation", "fullOperation", "simpleOperation", "disagreement", "decisionRelevantDifference", "severeErrorFull", "severeErrorSimple", "falseEscalationFull", "falseEscalationSimple", "requiredFieldsFull", "requiredFieldsSimple", "requiredFieldCountFull", "requiredFieldCountSimple", "questionsFull", "questionsSimple", "questionCountFull", "questionCountSimple", "fullTrace", "simpleTrace"]) {
      if (!Object.hasOwn(item ?? {}, key)) findings.push(finding("ABLATION_CASE_FIELD", `${map} case ${item?.id ?? "<unknown>"} is missing ${key}.`, rel));
    }
  }
  const recomputed = recomputedAblationMetrics(results);
  for (const [key, value] of Object.entries(recomputed)) if (!sameNumber(data.metrics?.[key], value)) findings.push(finding("ABLATION_METRIC", `${map} metric ${key} does not match per-case evidence.`, rel));
  return data;
}

function validateAblationSummary(root, rel, corpus, map15, map16, findings) {
  const data = readArtifact(root, rel, "ABLATION_SUMMARY", findings);
  if (!data || !corpus || !map15 || !map16) return;
  if (data.schemaVersion !== 2 || data.campaignVersion !== ABLATION_CAMPAIGN_VERSION || data.executed !== true || data.sourceCommit !== CORPUS_SOURCE_SHA || data.corpusManifestSha256 !== corpus.manifestSha256) findings.push(finding("ABLATION_SUMMARY_IDENTITY", "Ablation summary lacks exact execution provenance.", rel));
  if (data.map15Decision !== map15.decision || data.map16Decision !== map16.decision) findings.push(finding("ABLATION_SUMMARY_DECISION", "Ablation summary decisions disagree with per-map results.", rel));
  if (typeof data.decisionRule !== "string" || data.decisionRule.length < 80) findings.push(finding("ABLATION_SUMMARY_RULE", "Ablation summary lacks the aggregate retain/simplify rule.", rel));
}

function validateMultiTurn(root, rel, findings) {
  const data = readArtifact(root, rel, "MULTITURN_RESULTS", findings);
  if (!data) return null;
  let inputs;
  let graders;
  try {
    inputs = loadTrajectoryInputs(root);
    graders = loadTrajectoryGraders(root);
  } catch (error) {
    findings.push(finding("MULTITURN_CORPUS", String(error.message ?? error), "corpus/therapy-protocol-trajectories/manifest.json"));
    return null;
  }
  if (inputs.manifestSha256 !== graders.manifestSha256) findings.push(finding("MULTITURN_ISOLATION", "Trajectory input and grader phases observed different manifests.", rel));
  validateLiveHeader(data, MULTITURN_CAMPAIGN_VERSION, inputs.manifestSha256, rel, findings);
  const results = Array.isArray(data.results) ? data.results : [];
  const expectedTurnCount = inputs.inputs.reduce((sum, item) => sum + item.turns.length, 0);
  if (data.trajectoryCount !== REQUIRED_TRAJECTORY_IDS.length || data.turnCount !== expectedTurnCount || !exactIds(results, REQUIRED_TRAJECTORY_IDS)) findings.push(finding("MULTITURN_COUNT_IDS", "Multi-turn evidence must contain the exact 13 trajectories and every turn.", rel));
  const expectedInputs = new Map(inputs.inputs.map((item) => [item.id, item]));
  for (const trajectory of results) {
    const source = expectedInputs.get(trajectory.id);
    const grader = graders.graders.get(trajectory.id);
    if (!source || !TERMINAL_STATUSES.has(trajectory.status) || trajectory.executionStatus !== "executed" || trajectory.unresolvedSevereCount !== 0 || trajectory.turns?.length !== source.turns.length) {
      findings.push(finding("MULTITURN_TRAJECTORY", `Trajectory ${trajectory.id ?? "<unknown>"} is incomplete or severe.`, rel));
      continue;
    }
    for (const turn of trajectory.turns) {
      const sourceTurn = source.turns.find((item) => item.index === turn.index);
      const expected = grader?.turns.find((item) => item.index === turn.index);
      const operationPass = Boolean(expected?.acceptableOperations.includes(turn.actualOperation));
      const dispositionPass = turn.actualDisposition === expected?.expectedDisposition;
      const evaluationShape = JSON.stringify(turn.evaluation?.assertions?.map((entry) => entry.criterion)) === JSON.stringify(expected?.requiredInvariants)
        && JSON.stringify(turn.evaluation?.prohibitedBehaviors?.map((entry) => entry.criterion)) === JSON.stringify(expected?.prohibitedBehaviors);
      const invalid = !sourceTurn || turn.inputSha256 !== sha256(sourceTurn.message)
        || turn.executionStatus !== "executed" || !TERMINAL_STATUSES.has(turn.status) || turn.severeError !== false
        || !validTelemetry(turn.telemetry) || !validTelemetry(turn.evaluation?.telemetry, { evaluation: true })
        || typeof turn.answer !== "string" || !turn.answer.trim()
        || typeof turn.actualOperation !== "string" || typeof turn.actualDisposition !== "string"
        || !turn.carriedState || !numeric(turn.fieldBurden) || !numeric(turn.questionBurden)
        || turn.expectedOperation !== expected?.expectedOperation
        || JSON.stringify(turn.acceptableOperations) !== JSON.stringify(expected?.acceptableOperations)
        || turn.expectedDisposition !== expected?.expectedDisposition
        || turn.operationPass !== operationPass || turn.dispositionPass !== dispositionPass
        || !evaluationShape || turn.evaluation?.severeError !== false
        || (!operationPass && expected?.severity === "severe");
      if (invalid) findings.push(finding("MULTITURN_TURN_EVIDENCE", `Trajectory ${trajectory.id} turn ${turn.index} lacks complete execution/state/grading evidence.`, rel));
    }
  }
  return data;
}

function validateDocs(root, task, findings) {
  for (const rel of task.acceptance.requiredDocumentation ?? []) {
    if (!exists(root, rel)) {
      findings.push(finding("REQUIRED_DOCUMENT_MISSING", "Required durable documentation is missing.", rel));
      continue;
    }
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    if (text.length < 500 || !text.includes(CORPUS_SOURCE_SHA) || !/limitation/i.test(text)) findings.push(finding("REQUIRED_DOCUMENT_INCOMPLETE", "Required documentation must be substantive, source-bound, and state evidence limitations.", rel));
  }
}

function validateVerification(root, rel, live, multi, findings) {
  const data = readArtifact(root, rel, "VERIFICATION_RECEIPT", findings);
  if (!data) return;
  for (const command of REQUIRED_VERIFICATION_COMMANDS) {
    const record = data.commands?.[command];
    if (record?.status !== "pass" || typeof record.completedAt !== "string") findings.push(finding("VERIFICATION_COMMAND", `Verification receipt lacks a timestamped pass for ${command}.`, rel));
  }
  if (!SHA40.test(data.exactHeadSha ?? "") || !SHA40.test(data.exactTreeSha ?? "")) findings.push(finding("EXACT_HEAD_MISSING", "Verification receipt needs exact pre-receipt head and tree SHAs.", rel));
  if (data.liveExecutionHeadSha !== live?.codeIdentity?.headSha || data.multiTurnExecutionHeadSha !== multi?.codeIdentity?.headSha) findings.push(finding("EXECUTION_HEAD_CROSSWALK", "Verification receipt does not crosswalk both external campaigns to their execution heads.", rel));
  if (data.sourceCommit !== CORPUS_SOURCE_SHA || data.articleSourceSha256 !== ARTICLE_SOURCE_SHA256) findings.push(finding("SOURCE_RECEIPT", "Verification receipt lacks pinned Creative Tail/article source identities.", rel));
  if (data.stableUnchanged !== true || !SHA40.test(data.stableBeforeSha ?? "") || data.stableBeforeSha !== data.stableAfterSha) findings.push(finding("STABLE_BOUNDARY", "Verification receipt must prove stable remained at the same commit.", rel));
  if (data.articleProseUnchanged !== true || data.articleBoundary !== "external-source-hash-only") findings.push(finding("ARTICLE_BOUNDARY", "Verification receipt must accurately identify the external article boundary.", rel));

  const head = git(root, ["rev-parse", "HEAD"]);
  const exactTree = data.exactHeadSha ? git(root, ["rev-parse", `${data.exactHeadSha}^{tree}`]) : null;
  if (!head || !exactTree) findings.push(finding("EXACT_HEAD_UNVERIFIABLE", "Git exact-head verification cannot be reproduced in this checkout.", rel));
  else {
    if (exactTree !== data.exactTreeSha) findings.push(finding("EXACT_TREE_MISMATCH", "Receipt exactTreeSha does not match exactHeadSha.", rel));
    const ancestor = git(root, ["merge-base", "--is-ancestor", data.exactHeadSha, head]);
    if (ancestor === null) findings.push(finding("EXACT_HEAD_ANCESTRY", "Receipt exactHeadSha is not reachable from current HEAD.", rel));
    if (head !== data.exactHeadSha) {
      const changed = (git(root, ["diff", "--name-only", `${data.exactHeadSha}..${head}`]) ?? "").split("\n").filter(Boolean);
      if (changed.some((item) => item !== rel)) findings.push(finding("POST_VERIFICATION_CHANGE", `Files other than the immutable receipt changed after verification: ${changed.join(", ")}.`, rel));
    }
  }
}

export function verifyAcceptance({ root = process.cwd(), env = process.env, branch = undefined } = {}) {
  const preflight = verifyPreflight({ root, env, branch });
  const findings = [...preflight.findings];
  const task = loadTask(root).task;
  if (!task) return { ...preflight, mode: "acceptance" };
  if (!task.acceptance?.paths || task.acceptance.requiredCaseCount !== CORPUS_CASE_COUNT) findings.push(finding("ACCEPTANCE_CONTRACT_INVALID", "Active task acceptance contract is incomplete or altered.", "tasks/ACTIVE-TASK.json"));
  else {
    const corpus = validateCorpus(root, task, findings);
    validateDeterministic(root, task.acceptance.paths.deterministicResults, corpus, findings);
    const live = validateLive(root, task.acceptance.paths.liveResults, corpus, findings);
    const map15 = validateAblation(root, task.acceptance.paths.map15PerCase, "map15", corpus, findings);
    const map16 = validateAblation(root, task.acceptance.paths.map16PerCase, "map16", corpus, findings);
    validateAblationSummary(root, task.acceptance.paths.ablationSummary, corpus, map15, map16, findings);
    const multi = validateMultiTurn(root, task.acceptance.paths.multiTurnResults, findings);
    validateDocs(root, task, findings);
    validateVerification(root, task.acceptance.paths.verificationReceipt, live, multi, findings);
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
  const result = process.argv.includes("--acceptance") ? verifyAcceptance() : verifyPreflight();
  printResult(result);
  process.exitCode = result.ok ? 0 : 1;
}
