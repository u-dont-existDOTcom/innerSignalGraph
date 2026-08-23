import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { ClaudeCliProvider } from "../../src/providers/claude-cli.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const revision = argumentValue("--revision");
if (!/^v[1-9][0-9]*$/.test(revision ?? "")) throw new Error("--revision must be an explicit positive revision such as v3.");
const candidateCode = argumentValue("--candidate-code");
if (!/^candidate-[0-9a-f]{8}$/.test(candidateCode ?? "")) {
  throw new Error("--candidate-code must be one opaque trajectory candidate code.");
}
const inputRoot = path.join(privateRoot, `trajectory-evaluation-inputs-${revision}`);
const outputRoot = path.join(privateRoot, `trajectory-evaluation-outputs/opus-${revision}`);

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
  const inputPath = path.join(inputRoot, `${candidateCode}.json`);
  const outputPath = path.join(outputRoot, `${candidateCode}.json`);
  if (!await fs.stat(inputPath).then(() => true, () => false)) {
    throw new Error(`Opaque trajectory packet not found: ${candidateCode} at ${revision}.`);
  }
  if (await fs.stat(outputPath).then(() => true, () => false)) {
    throw new Error(`Refusing to overwrite existing Opus trajectory evaluation: ${candidateCode} at ${revision}.`);
  }
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const packetText = await fs.readFile(inputPath, "utf8");
  const packet = JSON.parse(packetText);
  if (packet.candidateCode !== candidateCode || packet.revision !== revision || packet.branches.length !== 10) {
    throw new Error("Trajectory packet identity or branch count mismatch.");
  }
  const provider = new ClaudeCliProvider({
    model: "claude-opus-5",
    effort: "high",
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  process.stderr.write(`[a001-opus-trajectory-eval] ${candidateCode} ${revision} started\n`);
  try {
    const response = await provider.generate({
      system: "You are an independent mapping-blind engineering evaluator for one A001 candidate's ten separate continuations. Follow only the supplied branch-specific and shared criteria. Evaluate every branch independently; never average away a hard failure. Do not infer provenance, compare unseen candidates, diagnose the user, or claim a therapeutic outcome. Return only the required JSON object.",
      user: packetText,
      outputSchema: evaluationSchema,
      metadata: { stage: "a001_opus_trajectory_evaluation" }
    });
    const evaluation = parseModelJson(response.text, `${candidateCode} Opus trajectory evaluation`);
    validateEvaluation(packet, evaluation);
    if (response.model !== provider.model) {
      throw new Error(`Evaluator model mismatch: requested ${provider.model}, returned ${response.model}.`);
    }
    const derived = evaluation.trajectoryResults.map((result) => ({
      trajectoryId: result.trajectoryId,
      engineeringPass: result.verdict === "pass" && result.hardFailureIds.length === 0 && result.continuityFailures.length === 0
    }));
    const receipt = {
      schemaVersion: 1,
      revision,
      candidateCode,
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
    process.stdout.write(`${JSON.stringify({
      revision,
      candidateCode,
      model: provider.model,
      responseId: receipt.evaluator.responseId,
      ...receipt.derived
    })}\n`);
    process.stderr.write(`[a001-opus-trajectory-eval] ${candidateCode} ${revision} completed in ${receipt.elapsedMs}ms\n`);
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      revision,
      candidateCode,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      failure: { name: error.name, code: error.code ?? null, message: error.message }
    };
    await fs.writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    throw error;
  }
}

await main();
