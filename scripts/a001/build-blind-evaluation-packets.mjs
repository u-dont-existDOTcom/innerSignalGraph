import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");
const inputRoot = path.join(privateRoot, "evaluation-inputs");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function originalQuestion() {
  const source = await fs.readFile(path.join(projectRoot, "analysis/a001/independent-conception.md"), "utf8");
  const match = source.match(/## Original question — verbatim\n\n> (.*?)\n\n## Problem/s);
  if (!match) throw new Error("Could not locate the verbatim A001 question.");
  const quoted = match[1].replace(/^> ?/gm, "").trim();
  return quoted.slice(1, -1);
}

async function loadCandidateSources() {
  const candidates = [];
  const staticMock = JSON.parse(await fs.readFile(path.join(privateRoot, "static-mock-full.json"), "utf8"));
  candidates.push({ sourceId: "S", response: staticMock.staticMock?.result?.answer });
  for (const sourceId of ["B", "C", "D"]) {
    const candidate = JSON.parse(await fs.readFile(path.join(privateRoot, `candidates/${sourceId}.json`), "utf8"));
    candidates.push({ sourceId, response: candidate.response });
  }
  for (const candidate of candidates) {
    if (typeof candidate.response !== "string" || !candidate.response.trim()) {
      throw new Error(`Candidate ${candidate.sourceId} has no response text.`);
    }
  }
  return candidates;
}

function opaqueCode(used) {
  while (true) {
    const code = `candidate-${randomBytes(4).toString("hex")}`;
    if (!used.has(code)) return code;
  }
}

async function main() {
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);
  const existing = await fs.readdir(inputRoot);
  if (existing.length > 0 || await fs.stat(path.join(privateRoot, "blind-mapping.json")).then(() => true, () => false)) {
    throw new Error("Blind packets already exist. Preserve the original randomized mapping; do not regenerate it implicitly.");
  }

  const question = await originalQuestion();
  const rubric = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/evaluation-rubric.json"), "utf8"));
  const used = new Set();
  const mapping = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    evaluatorVisibility: "never pass this mapping to an evaluator",
    entries: []
  };

  for (const candidate of await loadCandidateSources()) {
    const candidateCode = opaqueCode(used);
    used.add(candidateCode);
    const packet = {
      schemaVersion: 1,
      candidateCode,
      originalUserMessage: question,
      candidateResponse: candidate.response,
      evaluationCriteria: rubric,
      evaluatorInstructions: [
        "Evaluate only this response as the first turn of a continuing conversation.",
        "Do not infer or mention the intervention arm, author, model, architecture, preferred wording, or implementation.",
        "Do not compare it with any unseen candidate or another evaluator.",
        "Apply every hard failure independently; a hard failure cannot be averaged away.",
        "Use short exact response quotes only as evidence for your private evaluation output.",
        "Do not diagnose the user or claim a clinical outcome."
      ]
    };
    const serialized = `${JSON.stringify(packet, null, 2)}\n`;
    const packetPath = path.join(inputRoot, `${candidateCode}.json`);
    await fs.writeFile(packetPath, serialized, { mode: 0o600, flag: "wx" });
    mapping.entries.push({
      candidateCode,
      sourceId: candidate.sourceId,
      responseSha256: sha256(candidate.response),
      packetSha256: sha256(serialized)
    });
  }

  await fs.writeFile(
    path.join(privateRoot, "blind-mapping.json"),
    `${JSON.stringify(mapping, null, 2)}\n`,
    { mode: 0o600, flag: "wx" }
  );
  process.stdout.write(`${JSON.stringify({ packetCount: mapping.entries.length, createdAt: mapping.createdAt })}\n`);
}

await main();
