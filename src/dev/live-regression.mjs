import { runSubprocess } from "../core/subprocess.mjs";
import { DEV_FAILURE, classifyDevelopmentFailure } from "./failure-classification.mjs";

export function selectLiveRegressionCases({ task = {}, developmentCase = null, changes = [] } = {}) {
  const files = changes.map((item) => item.file || item).filter(Boolean);
  const joined = files.join("\n");
  const out = [];
  if (task.layer === "hypnosis-compiler" || /src\/hypnosis\/|hypnosis-/i.test(joined)) out.push("H001");
  if (
    developmentCase ||
    ["therapy-pipeline", "case-formulation", "planner", "performance"].includes(task.layer) && /run-tiered-pipeline|case-formulation|response-contract|guide-graph\/planner|prompts\/(?:realize|case-)/i.test(joined)
  ) out.push("A001");
  return [...new Set(out)];
}

export async function runRelevantLiveRegressions({ config, candidateRoot, task = {}, developmentCase = null, changes = [], runner = runSubprocess } = {}) {
  const cases = selectLiveRegressionCases({ task, developmentCase, changes });
  if (!cases.length) return { ok: true, skipped: true, cases: [], attempts: [] };
  const attempts = [];
  for (const caseId of cases) {
    const isHypnosis = caseId === "H001";
    const args = isHypnosis ? ["src/cli/hypnosis-replay.mjs", caseId] : ["src/cli/replay.mjs", caseId];
    const timeoutMs = config?.devLiveRegressionTimeoutMs ?? 900000;
    let run;
    try {
      run = await runner({
        command: process.execPath,
        args,
        cwd: candidateRoot,
        env: {
          ...process.env,
          INNER_SIGNAL_MODE: "cli",
          LEDGER_MODE: "off",
          AUTOPILOT_LAUNCH_APP: "false",
          REQUEST_TIMEOUT_MS: String(timeoutMs)
        },
        timeoutMs,
        label: `development live regression ${caseId}`
      });
    } catch (error) {
      const failureClass = classifyDevelopmentFailure(error, { phase: "live-regression" });
      const timedOut = failureClass === DEV_FAILURE.LIVE_REGRESSION_TIMEOUT;
      attempts.push({ caseId, ok: false, code: null, timedOut, failureClass, message: error.message, stdoutTail: "", stderrTail: "" });
      return { ok: false, skipped: false, cases, attempts, timedOut, failureClass };
    }
    const entry = { caseId, ok: run.code === 0, code: run.code, timedOut: false, failureClass: run.code === 0 ? null : DEV_FAILURE.LIVE_REGRESSION_FAILURE, stdoutTail: String(run.stdout || "").slice(-8000), stderrTail: String(run.stderr || "").slice(-8000) };
    attempts.push(entry);
    if (!entry.ok) return { ok: false, skipped: false, cases, attempts, timedOut: false, failureClass: entry.failureClass };
  }
  return { ok: true, skipped: false, cases, attempts };
}
