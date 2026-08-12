import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, projectRoot } from "../core/config.mjs";
import { copyManagedTree, sourceManifest } from "../dev/workspace.mjs";
import { markRoadmapTask } from "../dev/roadmap-queue.mjs";

const markerPath = process.argv[2];
if (!markerPath) throw new Error("Usage: node src/cli/promote-candidate.mjs <promotion-ready.json>");
const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
if (!marker?.candidateRoot || !marker?.jobId) throw new Error("Promotion marker is incomplete.");
const candidateRoot = path.resolve(marker.candidateRoot);
const config = loadConfig({ mode: process.env.INNER_SIGNAL_MODE ?? "cli" });
const backupRoot = path.join(config.autopilotStateDir, "source-backups", `${new Date().toISOString().replace(/[:.]/g, '-')}-${marker.jobId}`);
await fs.mkdir(backupRoot, { recursive: true });
await copyManagedTree(projectRoot, backupRoot);
try {
  await copyManagedTree(candidateRoot, projectRoot);
  const revision = {
    format: "inner-signal-local-repair-v1",
    jobId: marker.jobId,
    roadmapTaskId: marker.roadmapTaskId ?? null,
    promotedAt: new Date().toISOString(),
    candidateRoot,
    reviewer: marker.reviewer ?? null,
    replayReview: marker.replayReview ?? null
  };
  await fs.writeFile(path.join(config.autopilotStateDir, "local-repair-revision.json"), `${JSON.stringify(revision, null, 2)}\n`);
  if (marker.roadmapTaskId) {
    await markRoadmapTask(config, marker.roadmapTaskId, {
      status: "complete",
      jobId: marker.jobId,
      promotedAt: revision.promotedAt,
      outcome: "implemented-and-promoted",
      reviewer: marker.reviewer ?? null
    });
  }
  await fs.rm(markerPath, { force: true });
  process.stdout.write(`${JSON.stringify({ ok: true, jobId: marker.jobId, backupRoot, managedFiles: Object.keys(await sourceManifest(projectRoot)).length })}\n`);
} catch (error) {
  await copyManagedTree(backupRoot, projectRoot);
  throw error;
}
