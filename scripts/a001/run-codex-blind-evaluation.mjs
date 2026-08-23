import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { CodexCliProvider } from "../../src/providers/codex-cli.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");
const inputRoot = path.join(privateRoot, "evaluation-inputs");
const outputRoot = path.join(privateRoot, "evaluation-outputs/codex");

const scoreProperties = Object.fromEntries([
  "exact_problem_fit",
  "felt_understanding",
  "credibility_rupture",
  "age_agency",
  "resentment",
  "non_retaliation",
  "actionability",
  "missed_promise_repair",
  "external_reality",
  "naturalness",
  "want_to_continue"
].map((id) => [id, { type: "integer", minimum: 0, maximum: 4 }]));

const evaluationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidateCode: { type: "string" },
    hardFailures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          evidenceQuote: { type: "string" },
          reason: { type: "string" }
        },
        required: ["id", "evidenceQuote", "reason"]
      }
    },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: scoreProperties,
      required: Object.keys(scoreProperties)
    },
    strongestFeatures: { type: "array", items: { type: "string" } },
    materialConcerns: { type: "array", items: { type: "string" } },
    likelyUserReaction: { type: "string" },
    nextTurnQuality: { type: "string" },
    verdict: { type: "string", enum: ["advance", "revise", "filter_out"] },
    verdictReason: { type: "string" },
    uncertainty: { type: "string" }
  },
  required: [
    "candidateCode",
    "hardFailures",
    "scores",
    "strongestFeatures",
    "materialConcerns",
    "likelyUserReaction",
    "nextTurnQuality",
    "verdict",
    "verdictReason",
    "uncertainty"
  ]
};

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
  if (inputFiles.length === 0) throw new Error("No blind evaluation packets exist.");
  const receipts = [];

  for (const inputFile of inputFiles) {
    const packetPath = path.join(inputRoot, inputFile);
    const outputPath = path.join(outputRoot, inputFile);
    try {
      await fs.stat(outputPath);
      throw new Error(`Refusing to overwrite existing independent evaluation: ${inputFile}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const packetText = await fs.readFile(packetPath, "utf8");
    const packet = JSON.parse(packetText);
    const startedAt = new Date().toISOString();
    const started = Date.now();
    process.stderr.write(`[a001-codex-eval] ${packet.candidateCode} started\n`);
    try {
      const response = await provider.generate({
        system: "You are an independent blind engineering evaluator for one therapy-response candidate. Follow only the supplied task-specific rubric. Do not infer provenance, diagnose the user, compare unseen candidates, or claim a therapeutic outcome. Return only the required JSON object.",
        user: packetText,
        outputSchema: evaluationSchema,
        metadata: { stage: "a001_blind_evaluation" }
      });
      const evaluation = parseModelJson(response.text, `${packet.candidateCode} Codex evaluation`);
      if (evaluation.candidateCode !== packet.candidateCode) {
        throw new Error(`Evaluator returned the wrong candidate code for ${packet.candidateCode}.`);
      }
      const receipt = {
        schemaVersion: 1,
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
        evaluation
      };
      await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      receipts.push({ candidateCode: packet.candidateCode, status: "captured", responseId: receipt.evaluator.responseId });
      process.stderr.write(`[a001-codex-eval] ${packet.candidateCode} completed in ${receipt.elapsedMs}ms\n`);
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
      process.stderr.write(`[a001-codex-eval] ${packet.candidateCode} failed: ${error.message}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({ model: provider.model, receipts })}\n`);
  if (receipts.some((item) => item.status !== "captured")) process.exitCode = 1;
}

await main();
