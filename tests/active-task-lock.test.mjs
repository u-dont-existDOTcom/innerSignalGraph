import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAcceptance, verifyPreflight } from "../scripts/verify-active-task.mjs";
import { loadCompleteCorpus } from "../src/therapy-protocol/corpus.mjs";
import { REQUIRED_LIVE_MODELS } from "../src/therapy-protocol/live-campaign.mjs";
import { loadTrajectoryGraders, loadTrajectoryInputs } from "../src/therapy-protocol/trajectory-corpus.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timestamp = "2026-08-18T12:00:00.000Z";

function writeJson(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function copy(root, rel) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(repositoryRoot, rel), target, { recursive: true });
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function commit(root, message) {
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Acceptance Test", "-c", "user.email=acceptance@example.invalid", "commit", "-m", message]);
  return { headSha: git(root, ["rev-parse", "HEAD"]), treeSha: git(root, ["rev-parse", "HEAD^{tree}"]) };
}

function telemetry({ evaluator = false } = {}) {
  return [{
    role: evaluator ? "openai" : "renderer",
    stage: evaluator ? "therapy_protocol_independent_evaluation" : "case_extraction",
    provider: evaluator ? "openai" : "anthropic",
    model: evaluator ? REQUIRED_LIVE_MODELS.evaluator : REQUIRED_LIVE_MODELS.renderer,
    transport: "cli",
    requestId: `${evaluator ? "eval" : "run"}-request-id`,
    responseId: `${evaluator ? "eval" : "run"}-response-id`,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 1,
    usage: null,
    modelUsage: null
  }];
}

function evaluation(assertions, prohibited) {
  return {
    assertions: assertions.map((criterion) => ({ criterion, pass: true, evidence: "Explicitly present in the bounded fixture answer." })),
    prohibitedBehaviors: prohibited.map((criterion) => ({ criterion, triggered: false, evidence: "The bounded fixture answer does not exhibit this behavior." })),
    severeError: false,
    summary: "All bounded criteria pass.",
    telemetry: telemetry({ evaluator: true }),
    completedAt: timestamp
  };
}

function docsText() {
  return `# Acceptance fixture\n\nPinned source: af36a51e44a65067a3d7703a78a004fdb8ad7693.\n\nEvidence limitations: this is a deterministic verifier test, not clinical outcome evidence or independent validation. ${"The source boundary is explicit and limited. ".repeat(16)}\n`;
}

function baseFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "active-task-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  copy(root, "tasks/ACTIVE-TASK.json");
  const task = JSON.parse(fs.readFileSync(path.join(root, "tasks/ACTIVE-TASK.json"), "utf8"));
  writeText(root, "state/CODEX-CURRENT-STATE.md", `${task.taskId}\n${task.requiredBranch}\n${task.completionCommand}\n`);
  return { root, task };
}

function completeArtifacts(root, task) {
  copy(root, "corpus/real-therapy-queries");
  copy(root, "corpus/therapy-protocol-trajectories");
  copy(root, "analysis/therapy-protocol/deterministic-results.json");
  copy(root, "analysis/therapy-protocol/ablation");

  git(root, ["init", "-b", task.requiredBranch]);
  const executionIdentity = commit(root, "fixture execution head");
  const corpus = loadCompleteCorpus(root);
  const codeIdentity = { ...executionIdentity, branch: task.requiredBranch, dirty: false };
  const liveResults = corpus.cases.map(({ input, grader }) => ({
    id: input.id,
    querySha256: input.querySha256,
    executionStatus: "executed",
    executedAt: timestamp,
    telemetryComplete: true,
    telemetry: telemetry(),
    processingTier: "fast",
    mode: "fast-graph",
    routingReason: "fixture",
    actualOperation: grader.expected.operation,
    actualDisposition: grader.expected.disposition,
    materialUnknowns: grader.expected.requiredUnknowns,
    actualProfile: grader.protocolProfile,
    fieldBurden: 1,
    questionBurden: grader.expected.requiredUnknowns.length,
    answer: "A bounded fixture answer that explicitly satisfies the separately loaded criteria.",
    nextQuestion: "",
    safetyFlags: [],
    responseContract: {},
    caseFormulation: {},
    interventionContract: {},
    realizationContractVersion: "response-realization-v5",
    rendererModel: REQUIRED_LIVE_MODELS.renderer,
    expectedOperation: grader.expected.operation,
    acceptableOperations: grader.expected.acceptableOperations,
    expectedDisposition: grader.expected.disposition,
    operationPass: true,
    dispositionPass: true,
    falseEscalation: grader.expected.falseEscalationOperations.includes(grader.expected.operation),
    evaluation: evaluation(grader.expected.assertions, grader.expected.prohibitedBehaviors),
    severeError: false,
    status: "pass"
  }));
  writeJson(root, task.acceptance.paths.liveResults, {
    schemaVersion: 2,
    campaignVersion: "therapy-protocol-live-v2",
    pipelineIdentity: "auto-tiered-v3",
    providerMode: "cli",
    models: REQUIRED_LIVE_MODELS,
    codeIdentity,
    corpusManifestSha256: corpus.manifestSha256,
    sourceCommit: task.source.mainSha,
    startedAt: timestamp,
    completedAt: timestamp,
    phase: "graded",
    overallStatus: "complete",
    unresolvedSevereCount: 0,
    caseCount: liveResults.length,
    results: liveResults
  });

  const trajectoryInputs = loadTrajectoryInputs(root);
  const trajectoryGraders = loadTrajectoryGraders(root);
  const inputById = new Map(trajectoryInputs.inputs.map((item) => [item.id, item]));
  const multiResults = [...trajectoryGraders.graders.values()].map((grader) => ({
    id: grader.id,
    executionStatus: "executed",
    unresolvedSevereCount: 0,
    status: "pass",
    turns: grader.turns.map((expected) => {
      const sourceTurn = inputById.get(grader.id).turns.find((turn) => turn.index === expected.index);
      return {
        index: expected.index,
        message: sourceTurn.message,
        id: `${grader.id}/${expected.index}`,
        querySha256: crypto.createHash("sha256").update(sourceTurn.message).digest("hex"),
        inputSha256: crypto.createHash("sha256").update(sourceTurn.message).digest("hex"),
        carriedState: { priorCaseSnapshotSha256: expected.index === 1 ? null : "a".repeat(64), priorInterventionContractSha256: expected.index === 1 ? null : "b".repeat(64), priorProcessingTier: expected.index === 1 ? "" : "fast" },
        executionStatus: "executed",
        telemetryComplete: true,
        telemetry: telemetry(),
        processingTier: "fast",
        mode: "fast-graph",
        routingReason: "fixture",
        actualOperation: expected.expectedOperation,
        actualDisposition: expected.expectedDisposition,
        materialUnknowns: [],
        actualProfile: expected.profile,
        fieldBurden: 1,
        questionBurden: 0,
        answer: "A bounded fixture answer that explicitly satisfies the separately loaded longitudinal criteria.",
        nextQuestion: "",
        safetyFlags: [],
        responseContract: {},
        caseFormulation: {},
        interventionContract: {},
        realizationContractVersion: "response-realization-v5",
        rendererModel: REQUIRED_LIVE_MODELS.renderer,
        expectedOperation: expected.expectedOperation,
        acceptableOperations: expected.acceptableOperations,
        expectedDisposition: expected.expectedDisposition,
        operationPass: true,
        dispositionPass: true,
        evaluation: evaluation(expected.requiredInvariants, expected.prohibitedBehaviors),
        severeError: false,
        status: "pass"
      };
    })
  }));
  writeJson(root, task.acceptance.paths.multiTurnResults, {
    schemaVersion: 2,
    campaignVersion: "therapy-protocol-multiturn-v2",
    pipelineIdentity: "auto-tiered-v3",
    providerMode: "cli",
    models: REQUIRED_LIVE_MODELS,
    codeIdentity,
    corpusManifestSha256: trajectoryInputs.manifestSha256,
    startedAt: timestamp,
    completedAt: timestamp,
    phase: "graded",
    overallStatus: "complete",
    unresolvedSevereCount: 0,
    trajectoryCount: multiResults.length,
    turnCount: multiResults.reduce((sum, item) => sum + item.turns.length, 0),
    results: multiResults
  });
  for (const rel of task.acceptance.requiredDocumentation) writeText(root, rel, docsText());
  const exact = commit(root, "fixture verified evidence head");
  writeJson(root, task.acceptance.paths.verificationReceipt, {
    schemaVersion: 2,
    exactHeadSha: exact.headSha,
    exactTreeSha: exact.treeSha,
    liveExecutionHeadSha: executionIdentity.headSha,
    multiTurnExecutionHeadSha: executionIdentity.headSha,
    sourceCommit: task.source.mainSha,
    articleSourceSha256: "2d81a6d01fc5b31f96ca9ca3a54a3109d4b80d56114089d1acb4471110631fe4",
    stableBeforeSha: "b".repeat(40),
    stableAfterSha: "b".repeat(40),
    stableUnchanged: true,
    articleProseUnchanged: true,
    articleBoundary: "external-source-hash-only",
    commands: Object.fromEntries([
      "npm ci --ignore-scripts",
      "npm test",
      "npm run graph:test",
      "npm run therapy-lessons:verify",
      "npm run audit:repository",
      "npm run audit:publication",
      "npm run verify",
      "npm run task:preflight"
    ].map((command) => [command, { status: "pass", completedAt: timestamp }]))
  });
}

test("preflight rejects a resumed worker in the wrong branch", (t) => {
  const { root } = baseFixture(t);
  const result = verifyPreflight({ root, branch: "guide-packet-r03" });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "WRONG_TASK_BRANCH"));
});

test("preflight rejects stale current state that does not carry the task identity", (t) => {
  const { root, task } = baseFixture(t);
  writeText(root, "state/CODEX-CURRENT-STATE.md", "S001 is complete. What is next?\n");
  const result = verifyPreflight({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "CURRENT_STATE_TASK_MISMATCH"));
});

test("acceptance cannot be satisfied by the preliminary router alone", (t) => {
  const { root, task } = baseFixture(t);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.equal(result.completionState, "INCOMPLETE");
  assert.ok(result.findings.some((item) => item.code === "CORPUS_INVALID"));
  assert.ok(result.findings.some((item) => item.code === "ABLATION_MISSING"));
});

test("acceptance requires exact corpus, all-case ablations, non-mock telemetry, all trajectories, docs, and exact-head receipt", (t) => {
  const { root, task } = baseFixture(t);
  completeArtifacts(root, task);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.completionState, "READY_FOR_PROTECTED_MERGE");
});

test("49 safely-blocked provider results cannot pass and a durable blocked task reports BLOCKED", (t) => {
  const { root, task } = baseFixture(t);
  completeArtifacts(root, task);
  const livePath = path.join(root, task.acceptance.paths.liveResults);
  const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
  live.overallStatus = "blocked";
  live.results = live.results.map((item) => ({ ...item, executionStatus: "safely_blocked", status: "safely_blocked", severeError: false }));
  writeJson(root, task.acceptance.paths.liveResults, live);
  const active = JSON.parse(fs.readFileSync(path.join(root, "tasks/ACTIVE-TASK.json"), "utf8"));
  active.status = "blocked";
  writeJson(root, "tasks/ACTIVE-TASK.json", active);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.equal(result.completionState, "BLOCKED");
  assert.ok(result.findings.some((item) => item.code === "LIVE_NOT_COMPLETE"));
  assert.ok(result.findings.some((item) => item.code === "LIVE_CASE_EVIDENCE"));
});

test("query/grader leakage fails closed even when all other receipts exist", (t) => {
  const { root, task } = baseFixture(t);
  completeArtifacts(root, task);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, task.acceptance.paths.corpusManifest), "utf8"));
  const queryPath = manifest.cases[0].queryPath;
  const query = JSON.parse(fs.readFileSync(path.join(root, queryPath), "utf8"));
  query.expectedRoute = "O3_CURRENT_REALITY";
  writeJson(root, queryPath, query);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "CORPUS_INVALID"));
});

test("a one-case ablation and fabricated live telemetry both fail closed", (t) => {
  const { root, task } = baseFixture(t);
  completeArtifacts(root, task);
  const mapPath = path.join(root, task.acceptance.paths.map15PerCase);
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  map.caseCount = 1;
  map.results = map.results.slice(0, 1);
  writeJson(root, task.acceptance.paths.map15PerCase, map);
  const livePath = path.join(root, task.acceptance.paths.liveResults);
  const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
  live.results[0].telemetry[0].responseId = null;
  writeJson(root, task.acceptance.paths.liveResults, live);
  const result = verifyAcceptance({ root, branch: task.requiredBranch });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((item) => item.code === "ABLATION_COUNT_IDS"));
  assert.ok(result.findings.some((item) => item.code === "LIVE_CASE_EVIDENCE"));
});
