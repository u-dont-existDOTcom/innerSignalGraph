import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { ClaudeCliProvider } from "../../src/providers/claude-cli.mjs";
import { CodexCliProvider } from "../../src/providers/codex-cli.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");
const evaluationRoot = path.join(privateRoot, "finalist-evaluation-v1");
const inputRoot = path.join(evaluationRoot, "inputs");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const evaluatorName = argumentValue("--evaluator");
if (!new Set(["codex", "opus", "fable"]).has(evaluatorName)) {
  throw new Error("--evaluator must be exactly codex, opus, or fable.");
}
const candidateCode = argumentValue("--candidate-code");
if (candidateCode && !/^answer-[0-9a-f]{10}$/.test(candidateCode)) {
  throw new Error("--candidate-code must be an opaque finalist answer code.");
}
if (evaluatorName === "fable" && !candidateCode) {
  throw new Error("Fable is adjudication-only and requires one explicit opaque --candidate-code.");
}
const outputRoot = path.join(evaluationRoot, "outputs", evaluatorName);

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

function createEvaluator() {
  if (evaluatorName === "codex") {
    return new CodexCliProvider({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 900000,
      cwd: projectRoot,
      isolateConfig: true
    });
  }
  return new ClaudeCliProvider({
    model: evaluatorName === "fable" ? "claude-fable-5" : "claude-opus-5",
    effort: "high",
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
}

async function main() {
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const provider = createEvaluator();
  const allInputFiles = (await fs.readdir(inputRoot)).filter((name) => name.endsWith(".json")).sort();
  if (allInputFiles.length !== 3) throw new Error(`Expected exactly three finalist packets; found ${allInputFiles.length}.`);
  const inputFiles = candidateCode ? allInputFiles.filter((name) => name === `${candidateCode}.json`) : allInputFiles;
  if (inputFiles.length !== (candidateCode ? 1 : 3)) {
    throw new Error(candidateCode ? `Opaque finalist packet not found: ${candidateCode}.` : "Finalist packet selection failed.");
  }
  const receipts = [];

  for (const inputFile of inputFiles) {
    const outputPath = path.join(outputRoot, inputFile);
    if (await fs.stat(outputPath).then(() => true, () => false)) {
      throw new Error(`Refusing to overwrite existing ${evaluatorName} evaluation: ${inputFile}`);
    }
    const packetText = await fs.readFile(path.join(inputRoot, inputFile), "utf8");
    const packet = JSON.parse(packetText);
    const startedAt = new Date().toISOString();
    const started = Date.now();
    process.stderr.write(`[a001-${evaluatorName}-finalist-eval] ${packet.candidateCode} started\n`);
    try {
      const response = await provider.generate({
        system: "You are an independent blind engineering evaluator for one therapy-response candidate. Follow only the supplied task-specific rubric. Do not infer provenance, diagnose the user, compare unseen candidates, or claim a therapeutic outcome. Return only the required JSON object.",
        user: packetText,
        outputSchema: evaluationSchema,
        metadata: { stage: `a001_${evaluatorName}_finalist_blind_evaluation` }
      });
      const evaluation = parseModelJson(response.text, `${packet.candidateCode} ${evaluatorName} finalist evaluation`);
      if (evaluation.candidateCode !== packet.candidateCode) {
        throw new Error(`Evaluator returned the wrong candidate code for ${packet.candidateCode}.`);
      }
      if (response.model !== provider.model) {
        throw new Error(`Evaluator model mismatch: requested ${provider.model}, returned ${response.model}.`);
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
      process.stderr.write(`[a001-${evaluatorName}-finalist-eval] ${packet.candidateCode} completed in ${receipt.elapsedMs}ms\n`);
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
      process.stderr.write(`[a001-${evaluatorName}-finalist-eval] ${packet.candidateCode} failed: ${error.message}\n`);
    }
  }

  process.stdout.write(`${JSON.stringify({ evaluator: evaluatorName, model: provider.model, receipts })}\n`);
  if (receipts.some((item) => item.status !== "captured")) process.exitCode = 1;
}

await main();
