import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listPendingDevelopmentCases, writeJobState } from "../src/dev/queue.mjs";
import { DEV_ENGINE_REVISION } from "../src/dev/engine.mjs";
import { nextAutonomousRoadmapTask, markRoadmapTask, readAutonomousRoadmapState, writeRoadmapHumanDecision } from "../src/dev/roadmap-queue.mjs";

async function tempRoot(prefix) { return await fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function seedCase(config, name = "case.json") {
  const dir = path.join(config.autopilotStateDir, "development-feedback");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), JSON.stringify({ feedback: { ledgerId: name, rating: "too-slow", note: "slow" } }));
}

test("a blocked development case from an older engine revision is retried automatically", async () => {
  const root = await tempRoot("inner-signal-dev-requeue-");
  const config = { autopilotStateDir: root, devJobRoot: path.join(root, "development-jobs") };
  await seedCase(config);
  const first = await listPendingDevelopmentCases(config);
  assert.equal(first.length, 1);
  await writeJobState(config, first[0].jobId, { status: "blocked", engineRevision: "older-engine", blocker: "old limitation" });
  // writeJobState stamps the current revision, so reproduce a persisted old release explicitly.
  const statePath = path.join(config.devJobRoot, first[0].jobId, "state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  state.engineRevision = "older-engine";
  await fs.writeFile(statePath, JSON.stringify(state));
  const retried = await listPendingDevelopmentCases(config);
  assert.equal(retried.length, 1);
  assert.equal(retried[0].requeuedFromTerminal.status, "blocked");
  assert.equal(retried[0].requeuedFromTerminal.engineRevision, "older-engine");
});

test("a blocked case from the current development engine stays terminal", async () => {
  const root = await tempRoot("inner-signal-dev-terminal-");
  const config = { autopilotStateDir: root, devJobRoot: path.join(root, "development-jobs") };
  await seedCase(config);
  const first = await listPendingDevelopmentCases(config);
  await writeJobState(config, first[0].jobId, { status: "blocked", blocker: "current limitation" });
  const after = await listPendingDevelopmentCases(config);
  assert.equal(after.length, 0);
  const state = JSON.parse(await fs.readFile(path.join(config.devJobRoot, first[0].jobId, "state.json"), "utf8"));
  assert.equal(state.engineRevision, DEV_ENGINE_REVISION);
});

test("autonomous roadmap advances engineering tasks without a new therapy message", async () => {
  const root = await tempRoot("inner-signal-roadmap-");
  const config = { autopilotStateDir: root };
  const first = await nextAutonomousRoadmapTask(config);
  assert.equal(first.task.id, "DEV-R001");
  await markRoadmapTask(config, "DEV-R001", { status: "complete", outcome: "test" });
  const second = await nextAutonomousRoadmapTask(config);
  assert.equal(second.task.id, "DEV-R002");
  const state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R001"].status, "complete");
});

test("roadmap preflight human decisions can authorize or reject a task without log transport", async () => {
  const root = await tempRoot("inner-signal-roadmap-human-");
  const config = { autopilotStateDir: root };
  await markRoadmapTask(config, "DEV-R004", { status: "awaiting-human", humanDecisionPacket: { reason: "policy" } });
  await writeRoadmapHumanDecision(config, "DEV-R004", "approve");
  let state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R004"].status, "authorized");
  assert.equal(state.tasks["DEV-R004"].humanAuthorized, true);
  await markRoadmapTask(config, "DEV-R005", { status: "awaiting-human" });
  await writeRoadmapHumanDecision(config, "DEV-R005", "reject");
  state = await readAutonomousRoadmapState(config);
  assert.equal(state.tasks["DEV-R005"].status, "rejected");
});

test("current-engine review-pending roadmap task remains eligible without consuming another implementation cycle", async () => {
  const root = await tempRoot("inner-signal-roadmap-review-pending-");
  const config = { autopilotStateDir: root };
  await markRoadmapTask(config, "DEV-R001", { status: "review-pending", implementationCycleCount: 1, failureClass: "REVIEW_TIMEOUT" });
  const next = await nextAutonomousRoadmapTask(config);
  assert.equal(next.task.id, "DEV-R001");
  assert.equal(next.state.tasks["DEV-R001"].implementationCycleCount, 1);
});

test("current-engine true review rejection stays bounded while next roadmap task can advance", async () => {
  const root = await tempRoot("inner-signal-roadmap-review-reject-");
  const config = { autopilotStateDir: root };
  await markRoadmapTask(config, "DEV-R001", { status: "blocked", implementationCycleCount: 2, failureClass: "REVIEW_REJECTION", blocker: "substantive code defect" });
  const next = await nextAutonomousRoadmapTask(config);
  assert.equal(next.task.id, "DEV-R002");
});

test("live-regression retryAfter prevents a tight stochastic retry loop", async () => {
  const root = await tempRoot("inner-signal-roadmap-retry-after-");
  const config = { autopilotStateDir: root };
  await markRoadmapTask(config, "DEV-R001", { status: "live-regression-pending", retryAfter: new Date(Date.now() + 60000).toISOString() });
  const next = await nextAutonomousRoadmapTask(config);
  assert.equal(next.task.id, "DEV-R002");
});
