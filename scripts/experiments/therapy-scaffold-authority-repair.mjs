#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { analysisRoot, repositoryRoot, runTherapyScaffoldBenchmark } from "./therapy-scaffold-benchmark.mjs";
import { atomicWriteJson, atomicWriteText, readJson, runCommand, sha256 } from "./therapy-scaffold-lib.mjs";

const downloadsRoot = path.dirname(repositoryRoot);
const args = new Set(process.argv.slice(2));
const benchmarkOnly = args.has("--benchmark-only");
const concurrencyArgument = process.argv.find((value) => value.startsWith("--concurrency="));
const concurrency = concurrencyArgument ? Number(concurrencyArgument.split("=")[1]) : 2;
const runtimeRoot = path.resolve(process.env.INNER_SIGNAL_INSTALLED_RUNTIME || path.join(downloadsRoot, "inner-signal-runtime"));
const privateRoot = path.resolve(process.env.THERAPY_SCAFFOLD_PRIVATE_ROOT || path.join(downloadsRoot, "innerSignalGraph-therapy-scaffold-authority-repair-private"));

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be an integer from 1 to 3.");

function announce(message) { process.stdout.write(`[${new Date().toISOString()}] ${message}\n`); }

const rateLimitCheckpointPath = path.join(analysisRoot, "provider-rate-limit-checkpoint.json");

function errorText(error, depth = 0) {
  if (!error || depth > 5) return "";
  let details = "";
  try { details = JSON.stringify(error.details ?? {}); } catch { details = ""; }
  return [error.name, error.code, error.message, details, errorText(error.cause, depth + 1)].filter(Boolean).join(" ");
}

export function classifyProviderRateLimit(error) {
  const text = errorText(error);
  if (!/(?:\b429\b|rate.?limit|usage.?limit|too many requests)/i.test(text)) return null;
  const calls = Object.values(error.benchmarkProviderTraces ?? {}).flat();
  const failed = [...calls].reverse().find((call) => call.status === "failed") ?? calls.at(-1) ?? null;
  const rawReset = text.match(/(?:reset(?:s|_at)?[^\d]{0,30})((?:20\d\d-[01]\d-[0-3]\d[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:Z|[+-][0-2]\d:?[0-5]\d)?)|(?:[0-2]?\d:[0-5]\d))/i)?.[1] ?? null;
  return {
    provider: failed?.response?.provider ?? failed?.request?.metadata?.provider ?? error.benchmarkContext?.providerKey ?? (failed?.error?.details?.model ? "anthropic" : null),
    requestedModel: failed?.response?.model ?? failed?.error?.details?.model ?? error.benchmarkContext?.requestedModel ?? null,
    stage: failed?.request?.metadata?.stage ?? error.benchmarkContext?.phase ?? null,
    context: error.benchmarkContext ?? null,
    apiStatus: 429,
    resetHint: rawReset,
    rawProviderMessageSha256: sha256(text)
  };
}

async function persistRateLimitCheckpoint(error, rateLimit) {
  let prior = null;
  try { prior = await readJson(rateLimitCheckpointPath); } catch (readError) { if (readError.code !== "ENOENT") throw readError; }
  const now = new Date().toISOString();
  await atomicWriteJson(rateLimitCheckpointPath, {
    schemaVersion: 2,
    status: "BLOCKED",
    firstObservedAt: prior?.firstObservedAt ?? now,
    confirmedAgainAt: now,
    provider: rateLimit.provider,
    requestedModel: rateLimit.requestedModel,
    stage: rateLimit.stage,
    ...rateLimit.context,
    classification: "provider usage rate limit",
    apiStatus: rateLimit.apiStatus,
    resetHint: rateLimit.resetHint,
    rawProviderMessageSha256: rateLimit.rawProviderMessageSha256,
    rawEvidence: "owner-private exact-fingerprint failure records outside Git",
    recovery: "Rerun the idempotent experiment command after the provider reset; completed exact-fingerprint stages resume and only failed stages rerun.",
    nonEffect: "No model substitution, prompt relaxation, production change, protected-ref movement, runtime installation, or Guide Packet change was used to bypass the limit."
  }, 0o644);
  await atomicWriteJson(path.join(privateRoot, "last-blocked-error.json"), {
    status: "BLOCKED",
    observedAt: now,
    classification: "provider usage rate limit",
    context: rateLimit.context,
    rawProviderMessageSha256: rateLimit.rawProviderMessageSha256,
    errorName: error.name ?? "Error",
    errorCode: error.code ?? null
  });
}

async function markRateLimitResolved(runIdentity) {
  let prior = null;
  try { prior = await readJson(rateLimitCheckpointPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!prior) return;
  await atomicWriteJson(rateLimitCheckpointPath, { ...prior, schemaVersion: 2, status: "RESOLVED", resolvedAt: new Date().toISOString(), resolvedByRunIdentity: runIdentity }, 0o644);
}

async function runGate(id, command, commandArgs, timeoutMs = 1_200_000) {
  announce(`gate ${id}: running`);
  const result = await runCommand(command, commandArgs, { cwd: repositoryRoot, timeoutMs });
  const privateLog = path.join(privateRoot, "verification-logs", `${id}.log`);
  await atomicWriteText(privateLog, `COMMAND: ${command} ${commandArgs.join(" ")}\nEXIT: ${result.code}\nSIGNAL: ${result.signal ?? ""}\nDURATION_MS: ${result.durationMs}\n\nSTDOUT\n${result.stdout}\n\nSTDERR\n${result.stderr}\n`);
  const receipt = { id, command: [command, ...commandArgs], exitCode: result.code, signal: result.signal, durationMs: result.durationMs, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr), privateLog };
  announce(`gate ${id}: ${result.code === 0 ? "pass" : "fail"}`);
  if (result.code !== 0) {
    const error = new Error(`Verification gate ${id} failed with exit code ${result.code}. Private log: ${privateLog}`);
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}

async function main() {
  await fs.mkdir(privateRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(privateRoot, 0o700);
  await runGate("task-preflight", "npm", ["run", "task:preflight"], 120_000);
  announce(`benchmark: resolving and resuming evidence under ${privateRoot}`);
  const benchmark = await runTherapyScaffoldBenchmark({ runtimeRoot, privateRoot, concurrency });
  await markRateLimitResolved(benchmark.publicResult.runIdentity);
  announce(`benchmark: complete; selected ${benchmark.publicResult.selection.selected}`);
  if (benchmarkOnly) return;

  const gates = [];
  gates.push(await runGate("dependency-bootstrap", "npm", ["ci", "--ignore-scripts"], 600_000));
  const specifications = [
    ["task-preflight-after-bootstrap", "npm", ["run", "task:preflight"], 120_000],
    ["targeted-scaffold", "node", ["--test", "tests/therapy-scaffold-authority.test.mjs", "tests/therapy-scaffold-experiment.test.mjs", "tests/realization.test.mjs", "tests/tiered-pipeline.test.mjs", "tests/config.test.mjs"], 600_000],
    ["all-tests", "npm", ["test"], 1_200_000],
    ["graph-regressions", "npm", ["run", "graph:test"], 600_000],
    ["legacy-a001", "node", ["--test", "tests/pipeline.test.mjs", "tests/benchmark-acceptance.test.mjs"], 600_000],
    ["therapy-lessons", "npm", ["run", "therapy-lessons:verify"], 600_000],
    ["web-runtime-smoke", "npm", ["run", "web:smoke"], 600_000],
    ["publication-secret-scan", "npm", ["run", "audit:publication"], 600_000],
    ["repository-audit", "npm", ["run", "audit:repository"], 600_000],
    ["workflow-audit", "npm", ["run", "audit:workflows"], 600_000],
    ["interruption-resume", "node", ["--test", "--test-name-pattern", "interrupt|provider supervisor|resume|structured-output", "tests/therapy-scaffold-experiment.test.mjs"], 600_000],
    ["diff-check", "git", ["diff", "--check"], 120_000],
    ["complete-verify", "npm", ["run", "verify"], 1_200_000]
  ];
  for (const [id, command, commandArgs, timeoutMs] of specifications) gates.push(await runGate(id, command, commandArgs, timeoutMs));

  const processCheck = await runCommand("ps", ["-eo", "pid,ppid,stat,etime,cmd"], { cwd: repositoryRoot, timeoutMs: 30_000 });
  const survivors = processCheck.stdout.split(/\r?\n/).filter((line) => /inner-signal-(?:claude|codex)-|therapy-scaffold-(?:authority-repair|benchmark)/.test(line) && !line.includes(String(process.pid)));
  const survivorReceipt = { id: "process-survivors", exitCode: survivors.length ? 1 : 0, survivorCount: survivors.length, processListSha256: sha256(processCheck.stdout), checkedAt: new Date().toISOString() };
  if (survivors.length) throw new Error(`Process-survivor check found ${survivors.length} candidate process(es); details remain in private evidence.`);
  gates.push(survivorReceipt);

  const verification = { schemaVersion: 1, generatedAt: new Date().toISOString(), candidateRunIdentity: benchmark.publicResult.runIdentity, allPassed: gates.every((item) => item.exitCode === 0), gates: gates.map((item) => ({ ...item, privateLog: item.privateLog ? `<owner-private-root>/verification-logs/${path.basename(item.privateLog)}` : undefined })) };
  await atomicWriteJson(path.join(analysisRoot, "verification-results.json"), verification, 0o644);
  announce("all verification gates: pass");
}

main().catch(async (error) => {
  const rateLimit = classifyProviderRateLimit(error);
  if (rateLimit) {
    try {
      await persistRateLimitCheckpoint(error, rateLimit);
      process.stderr.write(`BLOCKED: provider usage rate limit at ${rateLimit.stage ?? "unknown stage"}; exact-fingerprint progress was preserved.\n`);
      process.exitCode = 75;
    } catch (checkpointError) {
      process.stderr.write(`Provider rate limit detected, but checkpoint persistence failed: ${checkpointError.message}\n`);
      process.exitCode = 1;
    }
    return;
  }
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
