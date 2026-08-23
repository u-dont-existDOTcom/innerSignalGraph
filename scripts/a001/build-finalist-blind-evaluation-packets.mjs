import { createHash, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPreflight } from "../verify-active-task.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const privateRoot = path.resolve(projectRoot, "../innerSignalGraph-a001-private");
const evaluationRoot = path.join(privateRoot, "finalist-evaluation-v1");
const inputRoot = path.join(evaluationRoot, "inputs");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function originalQuestion() {
  const source = await fs.readFile(path.join(projectRoot, "analysis/a001/independent-conception.md"), "utf8");
  const match = source.match(/## Original question — verbatim\n\n> (.*?)\n\n## Problem/s);
  if (!match) throw new Error("Could not locate the verbatim A001 question.");
  const quoted = match[1].replace(/^> ?/gm, "").trim();
  if (!quoted.startsWith("“") || !quoted.endsWith("”")) {
    throw new Error("The preserved A001 question lost its quotation boundary.");
  }
  return quoted.slice(1, -1);
}

function opaqueCode(used) {
  while (true) {
    const code = `answer-${randomBytes(5).toString("hex")}`;
    if (!used.has(code)) return code;
  }
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

async function loadSources() {
  const baseline = JSON.parse(await fs.readFile(path.join(privateRoot, "baseline-live-full-v2.json"), "utf8"));
  const trackedBaseline = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/baseline-live.json"), "utf8"));
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/candidates/manifest.json"), "utf8"));
  const sources = [{ sourceId: "A", response: baseline.actualProduction?.result?.answer }];

  for (const sourceId of ["B", "D"]) {
    const candidate = JSON.parse(await fs.readFile(path.join(privateRoot, `candidates/${sourceId}.json`), "utf8"));
    sources.push({ sourceId, response: candidate.response });
  }

  for (const source of sources) {
    if (typeof source.response !== "string" || !source.response.trim()) {
      throw new Error(`Finalist source ${source.sourceId} has no response text.`);
    }
    const expectedHash = source.sourceId === "A"
      ? trackedBaseline.actualProduction.result.answerSha256
      : manifest.candidates.find((item) => item.candidateId === source.sourceId)?.responseSha256;
    if (!expectedHash || sha256(source.response) !== expectedHash) {
      throw new Error(`Finalist source ${source.sourceId} does not match its tracked response hash.`);
    }
  }
  return shuffle(sources);
}

async function main() {
  const preflight = runPreflight({ cwd: projectRoot });
  if (!preflight.ok) throw new Error(`A001 task preflight failed: ${preflight.findings.join(", ")}`);
  if (await fs.stat(evaluationRoot).then(() => true, () => false)) {
    throw new Error("Finalist blind packets already exist. Preserve the randomized mapping; do not regenerate it implicitly.");
  }

  await fs.mkdir(inputRoot, { recursive: true, mode: 0o700 });
  const question = await originalQuestion();
  const rubric = JSON.parse(await fs.readFile(path.join(projectRoot, "analysis/a001/evaluation-rubric.json"), "utf8"));
  const used = new Set();
  const mapping = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    evaluatorVisibility: "never pass this mapping to an evaluator",
    originalMessageSha256: sha256(question),
    entries: []
  };

  for (const source of await loadSources()) {
    const candidateCode = opaqueCode(used);
    used.add(candidateCode);
    const packet = {
      schemaVersion: 1,
      candidateCode,
      originalUserMessage: question,
      candidateResponse: source.response,
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
    await fs.writeFile(path.join(inputRoot, `${candidateCode}.json`), serialized, { mode: 0o600, flag: "wx" });
    mapping.entries.push({
      candidateCode,
      sourceId: source.sourceId,
      responseSha256: sha256(source.response),
      packetSha256: sha256(serialized)
    });
  }

  const mappingText = `${JSON.stringify(mapping, null, 2)}\n`;
  await fs.writeFile(path.join(evaluationRoot, "mapping.json"), mappingText, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    packetCount: mapping.entries.length,
    createdAt: mapping.createdAt,
    mappingSha256: sha256(mappingText)
  })}\n`);
}

await main();
