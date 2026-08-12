import { loadConfig, projectRoot } from "../core/config.mjs";
import { processOneDevelopmentJob } from "../dev/worker.mjs";
import { processOneAutonomousRoadmapTask } from "../dev/roadmap-worker.mjs";
import { recordDevelopmentProgress, recordDevelopmentWorkerRuntime } from "../dev/supervisor-state.mjs";
import { runDevelopmentSupervisorCycle } from "../dev/supervisor.mjs";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const once = args.has("--once") || !watch;
const config = loadConfig({ mode: "cli" });
let stopping = false;
let stopRecorded = false;
const stop = () => { stopping = true; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const progress = (event) => {
  process.stderr.write(`[dev-worker] ${event.jobId ?? "-"} ${event.stage}: ${event.status}${event.detail ? ` — ${event.detail}` : ""}\n`);
  recordDevelopmentProgress(config, event).catch((error) => process.stderr.write(`[dev-worker] supervisor-state warning: ${error.message}\n`));
};

await recordDevelopmentWorkerRuntime(config, { running: true, pid: process.pid, startedAt: new Date().toISOString(), stoppedAt: null });
try {
  do {
    try {
      let result = await processOneDevelopmentJob({ config, sourceRoot: projectRoot, onProgress: progress });
      if (result.status === "idle") result = await processOneAutonomousRoadmapTask({ config, sourceRoot: projectRoot, onProgress: progress });
      if (result.status !== "idle") process.stderr.write(`[dev-worker] ${JSON.stringify({ status: result.status, jobId: result.jobId ?? null, taskId: result.taskId ?? null })}\n`);

      // The supervisor is executive, not merely observational: terminal routine-engineering blockers
      // are converted into a bounded fresh repair strategy automatically.
      const supervisor = await runDevelopmentSupervisorCycle({ config, sourceRoot: projectRoot, onProgress: progress });
      if (supervisor.result?.action === "AUTO_REPAIR" && supervisor.result?.applied) {
        process.stderr.write(`[dev-worker] supervisor auto-repair queued ${supervisor.result.taskId}.\n`);
      }
    } catch (error) {
      process.stderr.write(`[dev-worker] unexpected error: ${error.stack || error.message}\n`);
      recordDevelopmentProgress(config, { jobId: "dev-worker", stage: "worker-loop", status: "failed", detail: error.message }).catch(() => {});
    }
    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.devWorkerPollMs));
  } while (!stopping);
} finally {
  if (!stopRecorded) {
    stopRecorded = true;
    await recordDevelopmentWorkerRuntime(config, { running: false, pid: null, stoppedAt: new Date().toISOString() }).catch(() => {});
  }
}
