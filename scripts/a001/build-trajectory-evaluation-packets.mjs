import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const revision = argumentValue("--revision", "v1");
if (!/^v[1-9][0-9]*$/.test(revision)) throw new Error("--revision must look like v1, v2, or another positive revision.");
const candidateIds = argumentValue("--candidate-ids", "B,C,D").split(",").map((item) => item.trim()).filter(Boolean);
if (candidateIds.length === 0 || candidateIds.some((item) => !["B", "C", "D"].includes(item)) || new Set(candidateIds).size !== candidateIds.length) {
  throw new Error("--candidate-ids must be a unique comma-separated subset of B,C,D.");
}
const inputRoot = path.join(privateRoot, `trajectory-evaluation-inputs${revision === "v1" ? "" : `-${revision}`}`);
const trajectoryOutputRoot = path.join(privateRoot, `trajectory-outputs/${revision === "v1" ? "codex" : `codex-${revision}`}`);

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
  await fs.mkdir(inputRoot, { recursive: true });
  if ((await fs.readdir(inputRoot)).length > 0) {
    throw new Error("Trajectory evaluation packets already exist; preserve them and do not regenerate implicitly.");
  }
  const mapping = JSON.parse(await fs.readFile(path.join(privateRoot, "blind-mapping.json"), "utf8"));
  const trajectoryFile = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/trajectory-cases.json"), "utf8"));
  const originalUserMessage = await originalQuestion();
  const receipts = [];

  for (const candidateId of candidateIds) {
    const candidateCode = mapping.entries.find((entry) => entry.sourceId === candidateId)?.candidateCode;
    if (!candidateCode) throw new Error(`Blind code is missing for candidate ${candidateId}.`);
    const candidate = JSON.parse(await fs.readFile(path.join(privateRoot, `candidates/${candidateId}.json`), "utf8"));
    const branches = [];
    for (const trajectory of trajectoryFile.trajectories) {
      const receipt = JSON.parse(await fs.readFile(
        path.join(trajectoryOutputRoot, candidateId, `${trajectory.id}.json`),
        "utf8"
      ));
      if (!receipt.continuation) throw new Error(`Missing continuation for ${candidateId}/${trajectory.id}.`);
      branches.push({
        trajectoryId: trajectory.id,
        followUp: trajectory.followUp,
        continuation: receipt.continuation,
        requiredBehavior: trajectory.requiredBehavior
      });
    }
    const packet = {
      schemaVersion: 1,
      revision,
      candidateCode,
      originalUserMessage,
      initialAssistantResponse: candidate.response,
      sharedContinuityRequirements: trajectoryFile.sharedContinuityRequirements,
      scoreScale: {
        minimum: 0,
        maximum: 4,
        anchors: {
          "0": "absent, badly mismatched, or harmful",
          "1": "weak; major repair needed",
          "2": "partial or mixed",
          "3": "strong with bounded shortcomings",
          "4": "exceptionally accurate and useful for this branch"
        }
      },
      branches,
      evaluatorInstructions: [
        "Evaluate each branch independently as a one-question continuation from the same initial exchange.",
        "Do not infer or mention the arm, source ID, author, model, architecture, or implementation.",
        "Do not compare with unseen candidates or use another evaluator's result.",
        "A hard failure or material continuity failure in one branch cannot be hidden by another branch's strength or by an average.",
        "Temporary calm, a kept agreement, fluent insight, or articulate language is not proof of trust or repair.",
        "This is engineering evaluation, not a clinical measure or therapy outcome."
      ]
    };
    const serialized = `${JSON.stringify(packet, null, 2)}\n`;
    await fs.writeFile(path.join(inputRoot, `${candidateCode}.json`), serialized, { mode: 0o600, flag: "wx" });
    receipts.push({ candidateCode, packetSha256: sha256(serialized), branchCount: branches.length });
  }
  process.stdout.write(`${JSON.stringify({ revision, candidateIds, packetCount: receipts.length, receipts })}\n`);
}

await main();
