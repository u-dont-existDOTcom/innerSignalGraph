#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAblationCampaign, runDeterministicCampaign } from "../src/therapy-protocol/campaign.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

function writeJson(rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function deterministic() {
  const artifact = runDeterministicCampaign(root);
  writeJson("analysis/therapy-protocol/deterministic-results.json", artifact);
  if (artifact.passCount !== artifact.caseCount) process.exitCode = 1;
  return { caseCount: artifact.caseCount, passCount: artifact.passCount };
}

function ablation() {
  const artifacts = runAblationCampaign(root);
  writeJson("analysis/therapy-protocol/ablation/map15-per-case.json", artifacts.map15);
  writeJson("analysis/therapy-protocol/ablation/map16-per-case.json", artifacts.map16);
  writeJson("analysis/therapy-protocol/ablation/summary.json", artifacts.summary);
  return {
    caseCount: artifacts.map15.caseCount,
    map15Decision: artifacts.map15.decision,
    map16Decision: artifacts.map16.decision
  };
}

const runAll = args.size === 0 || args.has("--all-hermetic");
const result = {};
if (runAll || args.has("--deterministic")) result.deterministic = deterministic();
if (runAll || args.has("--ablation")) result.ablation = ablation();
if (!runAll && !args.has("--deterministic") && !args.has("--ablation")) {
  throw new Error("Usage: node scripts/run-therapy-protocol-campaign.mjs [--all-hermetic|--deterministic|--ablation]");
}
process.stdout.write(`${JSON.stringify({ ok: process.exitCode !== 1, ...result }, null, 2)}\n`);
