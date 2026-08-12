import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../core/config.mjs";
import { DEV_ENGINE_REVISION } from "./engine.mjs";

const ROADMAP_PATH = path.join(projectRoot, "roadmap", "autonomous-development.json");

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")); } catch { return fallback; }
}

export function roadmapStatePath(config) {
  return path.join(config.autopilotStateDir, "autonomous-roadmap-state.json");
}

export async function readAutonomousRoadmapState(config) {
  return await readJson(roadmapStatePath(config), {
    format: "inner-signal-autonomous-roadmap-state-v1",
    engineRevision: DEV_ENGINE_REVISION,
    tasks: {},
    updatedAt: null
  });
}

export async function writeAutonomousRoadmapState(config, patch) {
  const filePath = roadmapStatePath(config);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const prior = await readAutonomousRoadmapState(config);
  const next = {
    ...prior,
    ...patch,
    format: "inner-signal-autonomous-roadmap-state-v1",
    engineRevision: DEV_ENGINE_REVISION,
    updatedAt: new Date().toISOString(),
    tasks: { ...(prior.tasks ?? {}), ...(patch.tasks ?? {}) }
  };
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function loadAutonomousDevelopmentRoadmap() {
  const value = await readJson(ROADMAP_PATH);
  if (!value?.tasks || !Array.isArray(value.tasks)) throw new Error("Autonomous development roadmap is missing or malformed.");
  return value;
}

function eligibleTask(task, state) {
  if (!task.autoStart) return false;
  if (!["engineering", "safety-sensitive-engineering"].includes(task.automationClass)) return false;
  const taskState = state.tasks?.[task.id] ?? null;
  if (!taskState) return true;
  if (["complete", "awaiting-human", "promotion-ready", "running", "rejected"].includes(taskState.status)) return false;
  if (taskState.retryAfter && Date.parse(taskState.retryAfter) > Date.now()) return false;
  if (["audit-pending", "review-pending", "live-regression-pending", "tooling-pending", "supervisor-repair"].includes(taskState.status)) return true;
  if (taskState.status === "blocked" && taskState.engineRevision === DEV_ENGINE_REVISION) return false;
  return true;
}

export async function nextAutonomousRoadmapTask(config) {
  const roadmap = await loadAutonomousDevelopmentRoadmap();
  const state = await readAutonomousRoadmapState(config);
  const tasks = roadmap.tasks
    .filter((task) => eligibleTask(task, state))
    .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
  return { roadmap, state, task: tasks[0] ?? null };
}

export async function markRoadmapTask(config, taskId, patch) {
  const prior = await readAutonomousRoadmapState(config);
  const priorTask = prior.tasks?.[taskId] ?? {};
  const taskState = {
    ...priorTask,
    ...patch,
    taskId,
    engineRevision: DEV_ENGINE_REVISION,
    updatedAt: new Date().toISOString()
  };
  return await writeAutonomousRoadmapState(config, { tasks: { [taskId]: taskState } });
}

export async function writeRoadmapHumanDecision(config, taskId, decision) {
  if (!["approve", "reject"].includes(decision)) throw new Error("Roadmap decision must be approve or reject.");
  const prior = await readAutonomousRoadmapState(config);
  const priorTask = prior.tasks?.[taskId] ?? {};
  if (decision === "reject") {
    return await markRoadmapTask(config, taskId, {
      status: "rejected",
      humanDecision: { decision, at: new Date().toISOString() },
      completedAt: new Date().toISOString()
    });
  }
  return await markRoadmapTask(config, taskId, {
    status: "authorized",
    humanDecision: { decision, at: new Date().toISOString() },
    humanAuthorized: true,
    humanDecisionPacket: priorTask.humanDecisionPacket ?? null
  });
}
