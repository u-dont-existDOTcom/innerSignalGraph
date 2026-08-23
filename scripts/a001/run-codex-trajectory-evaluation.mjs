import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { CodexCliProvider } from "../../src/providers/codex-cli.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const revision = argumentValue("--revision", "v1");
if (!/^v[1-9][0-9]*$/.test(revision)) throw new Error("--revision must look like v1, v2, or another positive revision.");
const inputRoot = path.join(privateRoot, `trajectory-evaluation-inputs${revision === "v1" ? "" : `-${revision}`}`);
const outputRoot = path.join(privateRoot, `trajectory-evaluation-outputs/${revision === "v1" ? "codex" : `codex-${revision}`}`);

const scoreIds = ["original_problem_continuity", "branch_fit", "epistemic_accuracy", "repair_quality", "naturalness"];
const scoreProperties = Object.fromEntries(scoreIds.map((id) => [id, { type: "integer", minimum: 0, maximum: 4 }]));

const trajectoryResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    trajectoryId: { type: "string" },
    hardFailureIds: { type: "array", items: { type: "string" } },
    continuityFailures: { type: "array", items: { type: "string" } },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: scoreProperties,
      required: scoreIds
    },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string", enum: ["pass", "revise", "filter_out"] },
    reason: { type: "string" }
  },
  required: ["trajectoryId", "hardFailureIds", "continuityFailures", "scores", "strengths", "concerns", "verdict", "reason"]
};

const evaluationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidateCode: { type: "string" },
    trajectoryResults: { type: "array", items: trajectoryResultSchema },
    overallVerdict: { type: "string", enum: ["advance", "revise", "filter_out"] },
    overallReason: { type: "string" },
    crossBranchConcerns: { type: "array", items: { type: "string" } },
    uncertainty: { type: "string" }
  },
  required: ["candidateCode", "trajectoryResults", "overallVerdict", "overallReason", "crossBranchConcerns", "uncertainty"]
};

function validateEvaluation(packet, evaluation) {
  if (evaluation.candidateCode !== packet.candidateCode) {
    throw new Error(`Evaluator returned the wrong candidate code for ${packet.candidateCode}.`);
  }
  const expected = packet.branches.map((branch) => branch.trajectoryId).sort();
  const actual = evaluation.trajectoryResults.map((result) => result.trajectoryId).sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error(`Evaluator returned an incomplete trajectory set for ${packet.candidateCode}.`);
  }
}

async function main() {
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);
  await fs.mkdir(outputRoot, { recursive: true });
  const provider = new CodexCliProvider({
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  const inputFiles = (await fs.readdir(inputRoot)).filter((name) => name.endsWith(".json")).sort();
  if (inputFiles.length < 1 || inputFiles.length > 3) {
    throw new Error(`Expected from 1 to 3 trajectory evaluation packets, found ${inputFiles.length}.`);
  }
  const receipts = [];

  for (const inputFile of inputFiles) {
    const packetText = await fs.readFile(path.join(inputRoot, inputFile), "utf8");
    const packet = JSON.parse(packetText);
    const outputPath = path.join(outputRoot, inputFile);
    try {
      await fs.stat(outputPath);
      throw new Error(`Refusing to overwrite existing trajectory evaluation: ${inputFile}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const startedAt = new Date().toISOString();
    const started = Date.now();
    process.stderr.write(`[a001-trajectory-eval] ${packet.candidateCode} started\n`);
    try {
      const response = await provider.generate({
        system: "You are an independent mapping-blind engineering evaluator for one A001 candidate's ten separate continuations. Follow only the supplied branch-specific and shared criteria. Evaluate every branch independently; never average away a hard failure. Do not infer provenance, compare unseen candidates, diagnose the user, or claim a therapeutic outcome. Return only the required JSON object.",
        user: packetText,
        outputSchema: evaluationSchema,
        metadata: { stage: "a001_trajectory_evaluation" }
      });
      const evaluation = parseModelJson(response.text, `${packet.candidateCode} trajectory evaluation`);
      validateEvaluation(packet, evaluation);
      const derived = evaluation.trajectoryResults.map((result) => ({
        trajectoryId: result.trajectoryId,
        engineeringPass: result.verdict === "pass" && result.hardFailureIds.length === 0 && result.continuityFailures.length === 0
      }));
      const receipt = {
        schemaVersion: 1,
        revision,
        candidateCode: packet.candidateCode,
        evaluator: {
          provider: response.provider,
          requestedModel: provider.model,
          returnedModel: response.model,
          transport: response.transport,
          requestId: response.requestId ?? null,
          responseId: response.responseId ?? response.requestId ?? null
        },
        startedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        derived: {
          passedTrajectoryIds: derived.filter((item) => item.engineeringPass).map((item) => item.trajectoryId),
          failedTrajectoryIds: derived.filter((item) => !item.engineeringPass).map((item) => item.trajectoryId),
          allTrajectoriesPass: derived.every((item) => item.engineeringPass)
        },
        evaluation
      };
      await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      receipts.push({ candidateCode: packet.candidateCode, status: "captured", responseId: receipt.evaluator.responseId, ...receipt.derived });
      process.stderr.write(`[a001-trajectory-eval] ${packet.candidateCode} completed in ${receipt.elapsedMs}ms\n`);
    } catch (error) {
      const failure = {
        schemaVersion: 1,
        candidateCode: packet.candidateCode,
        startedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        failure: { name: error.name, code: error.code ?? null, message: error.message }
      };
      await fs.writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      receipts.push({ candidateCode: packet.candidateCode, status: "failed" });
      process.stderr.write(`[a001-trajectory-eval] ${packet.candidateCode} failed: ${error.message}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({ revision, model: provider.model, receipts })}\n`);
  if (receipts.some((item) => item.status !== "captured")) process.exitCode = 1;
}

await main();
