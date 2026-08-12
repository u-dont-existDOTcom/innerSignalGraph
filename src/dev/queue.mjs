import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DEV_ENGINE_REVISION, shouldRetryTerminalDevelopmentJob } from "./engine.mjs";

function jobIdFor(filePath) {
  return createHash("sha256").update(path.basename(filePath)).digest("hex").slice(0, 16);
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return null; }
}

export async function listPendingDevelopmentCases(config) {
  const feedbackDir = path.join(config.autopilotStateDir, "development-feedback");
  let names = [];
  try { names = await fs.readdir(feedbackDir); } catch { return []; }
  const out = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const sourceFile = path.join(feedbackDir, name);
    const developmentCase = await readJson(sourceFile);
    if (!developmentCase?.feedback) continue;
    if (!['needs-work', 'too-slow'].includes(developmentCase.feedback.rating)) continue;
    const jobId = jobIdFor(sourceFile);
    const jobFile = path.join(config.devJobRoot, jobId, "state.json");
    const existing = await readJson(jobFile);
    const terminal = existing && ["complete", "promotion-ready", "awaiting-human", "rejected", "blocked"].includes(existing.status);
    const retryTerminal = terminal && shouldRetryTerminalDevelopmentJob(existing);
    if (terminal && !retryTerminal) continue;
    out.push({
      jobId, sourceFile, developmentCase, existing, jobFile,
      requeuedFromTerminal: retryTerminal ? {
        status: existing.status,
        outcome: existing.outcome ?? null,
        engineRevision: existing.engineRevision ?? null,
        updatedAt: existing.updatedAt ?? null
      } : null
    });
  }
  return out;
}

export async function writeJobState(config, jobId, patch) {
  const dir = path.join(config.devJobRoot, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "state.json");
  const prior = await readJson(filePath) ?? {};
  const next = { ...prior, ...patch, jobId, engineRevision: DEV_ENGINE_REVISION, updatedAt: new Date().toISOString() };
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function readDevelopmentJobs(config) {
  let ids = [];
  try { ids = await fs.readdir(config.devJobRoot); } catch { return []; }
  const jobs = [];
  for (const id of ids) {
    const state = await readJson(path.join(config.devJobRoot, id, "state.json"));
    if (state) jobs.push(state);
  }
  return jobs.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function writeHumanDecision(config, jobId, decision) {
  if (!['approve', 'reject'].includes(decision)) throw new Error("Development decision must be approve or reject.");
  const dir = path.join(config.devJobRoot, jobId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "human-decision.json");
  const value = { jobId, decision, at: new Date().toISOString() };
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export async function readHumanDecision(config, jobId) {
  return await readJson(path.join(config.devJobRoot, jobId, "human-decision.json"));
}
