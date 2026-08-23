import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";
import { parseModelJson } from "../../src/core/json.mjs";
import { CodexCliProvider } from "../../src/providers/codex-cli.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");
const outputRoot = path.join(privateRoot, "trajectory-outputs/codex");

const continuationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    nextQuestion: { type: "string" }
  },
  required: ["answer", "nextQuestion"]
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function originalQuestion() {
  const source = await fs.readFile(path.join(projectRoot, "analysis/a001/independent-conception.md"), "utf8");
  const match = source.match(/## Original question — verbatim\n\n> (.*?)\n\n## Problem/s);
  if (!match) throw new Error("Could not locate the verbatim A001 question.");
  return match[1].replace(/^> ?/gm, "").trim().slice(1, -1);
}

async function main() {
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);
  const originalUserMessage = await originalQuestion();
  const trajectoryFile = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/trajectory-cases.json"), "utf8"));
  const provider = new CodexCliProvider({
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    timeoutMs: 900000,
    cwd: projectRoot,
    isolateConfig: true
  });
  await fs.mkdir(outputRoot, { recursive: true });
  const receipts = [];

  for (const candidateId of ["B", "C", "D"]) {
    const candidate = JSON.parse(await fs.readFile(path.join(privateRoot, `candidates/${candidateId}.json`), "utf8"));
    const candidateRoot = path.join(outputRoot, candidateId);
    await fs.mkdir(candidateRoot, { recursive: true });
    for (const trajectory of trajectoryFile.trajectories) {
      const outputPath = path.join(candidateRoot, `${trajectory.id}.json`);
      try {
        await fs.stat(outputPath);
        throw new Error(`Refusing to overwrite trajectory receipt ${candidateId}/${trajectory.id}.`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const generationInput = {
        originalUserMessage,
        priorAssistantResponse: candidate.response,
        nextUserMessage: trajectory.followUp
      };
      const startedAt = new Date().toISOString();
      const started = Date.now();
      process.stderr.write(`[a001-trajectory] ${candidateId}/${trajectory.id} started\n`);
      try {
        const response = await provider.generate({
          system: "Continue exactly one branch of the A001 conversation. Reply directly to the new user message while preserving the original concern and the prior response's intervention structure. Use natural conversational prose, one main next move, and one precise next question. Do not mention testing, models, rubrics, architecture, therapy outcomes, or unseen branches. Do not diagnose, make a grand vow, demand trust or gratitude, or append generic safety boilerplate without a present trigger. Return only the required JSON object.",
          user: JSON.stringify(generationInput, null, 2),
          outputSchema: continuationSchema,
          metadata: { stage: "a001_trajectory_probe" }
        });
        const continuation = parseModelJson(response.text, `${candidateId}/${trajectory.id} trajectory response`);
        const receipt = {
          schemaVersion: 1,
          candidateId,
          trajectoryId: trajectory.id,
          inputIdentity: {
            originalMessageSha256: sha256(originalUserMessage),
            priorResponseSha256: sha256(candidate.response),
            followUpSha256: sha256(trajectory.followUp)
          },
          evaluatorVisibility: "generation only; requiredBehavior was not supplied",
          generator: {
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
          continuation
        };
        await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        receipts.push({ candidateId, trajectoryId: trajectory.id, status: "captured", responseId: receipt.generator.responseId });
        process.stderr.write(`[a001-trajectory] ${candidateId}/${trajectory.id} completed in ${receipt.elapsedMs}ms\n`);
      } catch (error) {
        const failure = {
          schemaVersion: 1,
          candidateId,
          trajectoryId: trajectory.id,
          startedAt,
          completedAt: new Date().toISOString(),
          elapsedMs: Date.now() - started,
          failure: { name: error.name, code: error.code ?? null, message: error.message }
        };
        await fs.writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        receipts.push({ candidateId, trajectoryId: trajectory.id, status: "failed" });
        process.stderr.write(`[a001-trajectory] ${candidateId}/${trajectory.id} failed: ${error.message}\n`);
      }
    }
  }

  process.stdout.write(`${JSON.stringify({ model: provider.model, captured: receipts.filter((item) => item.status === "captured").length, failed: receipts.filter((item) => item.status === "failed").length })}\n`);
  if (receipts.some((item) => item.status !== "captured")) process.exitCode = 1;
}

await main();
