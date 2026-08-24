#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { analysisRoot, repositoryRoot, runTherapyScaffoldBenchmark } from "./therapy-scaffold-benchmark.mjs";
import { atomicWriteJson, atomicWriteText, runCommand, sha256 } from "./therapy-scaffold-lib.mjs";

const downloadsRoot = path.dirname(repositoryRoot);
const args = new Set(process.argv.slice(2));
const benchmarkOnly = args.has("--benchmark-only");
const concurrencyArgument = process.argv.find((value) => value.startsWith("--concurrency="));
const concurrency = concurrencyArgument ? Number(concurrencyArgument.split("=")[1]) : 2;
const runtimeRoot = path.resolve(process.env.INNER_SIGNAL_INSTALLED_RUNTIME || path.join(downloadsRoot, "inner-signal-runtime"));
const privateRoot = path.resolve(process.env.THERAPY_SCAFFOLD_PRIVATE_ROOT || path.join(downloadsRoot, "innerSignalGraph-therapy-scaffold-authority-repair-private"));

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be an integer from 1 to 3.");

function announce(message) { process.stdout.write(`[${new Date().toISOString()}] ${message}\n`); }

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
  announce(`benchmark: resolving and resuming evidence under ${privateRoot}`);
  const benchmark = await runTherapyScaffoldBenchmark({ runtimeRoot, privateRoot, concurrency });
  announce(`benchmark: complete; selected ${benchmark.publicResult.selection.selected}`);
  if (benchmarkOnly) return;

  const gates = [];
  const specifications = [
    ["task-preflight", "npm", ["run", "task:preflight"], 120_000],
    ["targeted-scaffold", "node", ["--test", "tests/therapy-scaffold-authority.test.mjs", "tests/realization.test.mjs", "tests/tiered-pipeline.test.mjs", "tests/config.test.mjs"], 600_000],
    ["all-tests", "npm", ["test"], 1_200_000],
    ["graph-regressions", "npm", ["run", "graph:test"], 600_000],
    ["legacy-a001", "node", ["--test", "tests/pipeline.test.mjs", "tests/benchmark-acceptance.test.mjs"], 600_000],
    ["web-runtime-smoke", "npm", ["run", "web:smoke"], 600_000],
    ["publication-secret-scan", "npm", ["run", "audit:publication"], 600_000],
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

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
