import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../core/config.mjs";
import { RUNTIME_VERSION } from "../core/runtime-version.mjs";
import { runCliMain } from "../core/cli-main.mjs";
import { queueRemoteDiagnostic } from "../diagnostics/remote-diagnostic.mjs";
import { syncDiagnosticOutbox } from "../diagnostics/github-sync.mjs";
import { loadGitAutomationConfig } from "../git/automation-config.mjs";

const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safeMatch(value, expression) {
  return typeof value === "string" && expression.test(value) ? value : null;
}

async function referencedTestSummary(stateDir, latest) {
  if (typeof latest?.runDir !== "string") return null;
  const root = path.resolve(stateDir);
  const runDir = path.resolve(latest.runDir);
  const relative = path.relative(root, runDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) return null;
  if (!/^run-\d{8}T\d{6}Z$/.test(relative)) return null;
  try {
    const stat = await fs.lstat(runDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return await readJson(path.join(runDir, "test-failure-summary.json"));
}

function failureStage(value) {
  if (value === "tests") return "package-tests";
  return safeMatch(value, SLUG) ?? "runtime";
}

function diagnosticInput({ latest, testSummary, updateStatus }) {
  const testExitCode = Number.isSafeInteger(testSummary?.exitCode) ? testSummary.exitCode : null;
  return {
    runtime: {
      version: RUNTIME_VERSION,
      installedCommit: safeMatch(updateStatus?.installedCommit, GIT_SHA),
      nodeVersion: process.version
    },
    update: {
      status: safeMatch(updateStatus?.status, SLUG) ?? "not-checked",
      candidateCommit: safeMatch(updateStatus?.candidateCommit, GIT_SHA)
    },
    failure: {
      stage: failureStage(latest?.stage),
      classification: testSummary ? "TEST_FAILURE" : "RUNTIME_FAILURE",
      actionCode: "KEEP_CURRENT_RUNTIME",
      retryable: false,
      exitCode: testExitCode
    },
    tests: testSummary,
    integrity: {
      runtimeTreeSha256: safeMatch(updateStatus?.integrity?.runtimeTreeSha256, SHA256),
      graphBundleSha256: safeMatch(updateStatus?.integrity?.graphBundleSha256, SHA256)
    }
  };
}

function parseMode(args) {
  const modes = args.filter((value) => value === "--latest" || value === "--flush-only");
  if (modes.length !== 1 || args.length !== 1) {
    throw new TypeError("Use exactly one of --latest or --flush-only");
  }
  return modes[0];
}

await runCliMain(async () => {
  const mode = parseMode(process.argv.slice(2));
  const config = loadGitAutomationConfig({ env: process.env, installRoot: projectRoot });
  const stateDir = config.stateDir;
  let queued = null;

  if (mode === "--latest" && config.autoDiagnostics) {
    const latest = await readJson(path.join(stateDir, "latest.json"));
    if (!latest) throw new Error("No local autopilot status is available to queue");
    if (latest.status !== "PASS") {
      const testSummary = await referencedTestSummary(stateDir, latest);
      const updateStatus = await readJson(path.join(stateDir, "git-update-status.json"));
      queued = await queueRemoteDiagnostic({
        stateDir,
        input: diagnosticInput({ latest, testSummary, updateStatus })
      });
    }
  }

  const sync = await syncDiagnosticOutbox({
    stateDir,
    repository: config.repository,
    stableBranch: config.stableBranch,
    diagnosticsBranch: config.diagnosticsBranch,
    ghCommand: process.env.INNER_SIGNAL_GH_COMMAND ?? "gh",
    enabled: config.autoDiagnostics
  });

  return {
    ok: true,
    queued: queued ? 1 : 0,
    ...(queued ? { incidentId: queued.incidentId } : {}),
    ...sync
  };
});
