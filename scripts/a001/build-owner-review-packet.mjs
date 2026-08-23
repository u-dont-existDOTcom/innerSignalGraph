import { createHash, randomInt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");
const reviewPath = path.join(privateRoot, "owner-review-v1.json");
const mappingPath = path.join(privateRoot, "owner-review-v1-mapping.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);
  if (await fs.stat(reviewPath).then(() => true, () => false) || await fs.stat(mappingPath).then(() => true, () => false)) {
    throw new Error("Owner review packet already exists; preserve its randomized order.");
  }
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/candidates/manifest.json"), "utf8"));
  const sources = [];
  for (const sourceId of ["B", "D"]) {
    const candidate = JSON.parse(await fs.readFile(path.join(privateRoot, `candidates/${sourceId}.json`), "utf8"));
    const response = candidate.response;
    const expectedHash = manifest.candidates.find((item) => item.candidateId === sourceId)?.responseSha256;
    if (typeof response !== "string" || sha256(response) !== expectedHash) {
      throw new Error(`Owner finalist ${sourceId} does not match its tracked response hash.`);
    }
    sources.push({ sourceId, response, responseSha256: expectedHash });
  }
  if (randomInt(2) === 1) sources.reverse();
  const createdAt = new Date().toISOString();
  const review = {
    schemaVersion: 1,
    createdAt,
    status: "awaiting-owner-experiential-judgment",
    anonymity: "Model, arm, architecture, and source identities withheld until after rating.",
    responses: sources.map((item, index) => ({
      label: `Response ${index + 1}`,
      response: item.response,
      responseSha256: item.responseSha256
    })),
    assessmentQuestions: [
      "Did this understand the actual problem?",
      "Did anything feel false, irritating, manipulative, generic, or overly therapeutic?",
      "Did it produce a genuinely useful next move?",
      "Would you continue the conversation with this response?",
      "What changed in your understanding or intended behavior, if anything?",
      "Overall usefulness from 0–10."
    ],
    interpretationBoundary: "This asks about demonstrated immediate usefulness, not a therapy outcome."
  };
  const mapping = {
    schemaVersion: 1,
    createdAt,
    ownerVisibility: "withhold until after owner rating",
    entries: sources.map((item, index) => ({
      label: `Response ${index + 1}`,
      sourceId: item.sourceId,
      responseSha256: item.responseSha256
    }))
  };
  const reviewText = `${JSON.stringify(review, null, 2)}\n`;
  const mappingText = `${JSON.stringify(mapping, null, 2)}\n`;
  await fs.writeFile(reviewPath, reviewText, { mode: 0o600, flag: "wx" });
  await fs.writeFile(mappingPath, mappingText, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    responseCount: review.responses.length,
    reviewSha256: sha256(reviewText),
    mappingSha256: sha256(mappingText)
  })}\n`);
}

await main();
