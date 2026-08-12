import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../core/config.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { loadGitAutomationConfig } from "../git/automation-config.mjs";
import { runGitUpdate } from "../git/runtime-update.mjs";
import { queueRemoteDiagnostic } from "../diagnostics/remote-diagnostic.mjs";

const STATUS = {
  CURRENT: "current",
  UPDATED: "updated",
  DEFERRED: "deferred",
  FAILED_SAFE: "failed-safe"
};

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function statusRecord(result) {
  return {
    format: "inner-signal-git-update-status-v1",
    status: STATUS[result.status] ?? "failed-safe",
    checkedAt: result.checkedAt,
    stage: result.stage,
    installedCommit: result.installedCommit,
    availableCommit: result.availableCommit,
    candidateCommit: result.candidateCommit,
    actionCode: result.actionCode,
    testSummary: result.testSummary,
    integrity: result.integrity
  };
}

function incidentInput(result) {
  const testExitCode = Number.isSafeInteger(result.testSummary?.exitCode) ? result.testSummary.exitCode : null;
  return {
    runtime: {
      version: RUNTIME_VERSION,
      installedCommit: result.installedCommit,
      nodeVersion: process.version
    },
    update: {
      status: result.stage === "fetch" ? "fetch-failed" : "validation-failed",
      candidateCommit: result.candidateCommit
    },
    failure: {
      stage: result.stage,
      classification: result.testSummary ? "UPDATE_TEST_FAILURE" : "UPDATE_FAILURE",
      actionCode: "KEEP_CURRENT_RUNTIME",
      retryable: result.stage === "fetch",
      exitCode: testExitCode
    },
    tests: result.testSummary,
    integrity: result.integrity
  };
}

await runCliMain(async () => {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--bootstrap")) {
    throw new TypeError("git-update accepts only the optional --bootstrap flag");
  }
  const bootstrap = args[0] === "--bootstrap";
  const installedRoot = process.env.INNER_SIGNAL_GIT_INSTALL_ROOT ?? projectRoot;
  const config = loadGitAutomationConfig({ env: process.env, installRoot: installedRoot });
  const result = config.autoUpdate
    ? await runGitUpdate({
        repository: config.repository,
        sourceRoot: config.sourceRoot,
        installedRoot: config.installedRoot,
        stableBranch: config.stableBranch,
        stateDir: config.stateDir
      })
    : {
        status: "DEFERRED",
        checkedAt: new Date().toISOString(),
        stage: "disabled",
        installedCommit: null,
        availableCommit: null,
        candidateCommit: null,
        actionCode: "KEEP_CURRENT_RUNTIME",
        testSummary: null,
        integrity: null
      };

  await atomicJson(path.join(config.stateDir, "git-update-status.json"), statusRecord(result));
  let incidentId = null;
  if (result.status === "FAILED_SAFE" && config.autoDiagnostics) {
    try {
      const queued = await queueRemoteDiagnostic({
        stateDir: config.stateDir,
        input: incidentInput(result)
      });
      incidentId = queued.incidentId;
    } catch {
      // A local queue problem never makes the previously installed runtime unavailable.
    }
  }

  if (result.status === "UPDATED") process.exitCode = 10;
  else if (bootstrap && result.status !== "CURRENT") process.exitCode = 12;
  return {
    ...result,
    diagnosticStatus: incidentId ? "queued" : result.status === "FAILED_SAFE" && config.autoDiagnostics ? "queue-unavailable" : "not-queued",
    ...(incidentId ? { incidentId } : {})
  };
});
