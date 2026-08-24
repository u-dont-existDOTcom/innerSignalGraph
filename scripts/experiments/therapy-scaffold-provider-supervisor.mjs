#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TERM_WAIT_MS = 750;
const KILL_WAIT_MS = 2_000;
const POLL_MS = 25;
const selfPath = fileURLToPath(import.meta.url);

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

function groupExists(pgid) {
  if (process.platform === "win32") return processExists(pgid);
  try { process.kill(-pgid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

function signalGroup(pgid, signal) {
  try {
    if (process.platform === "win32") process.kill(pgid, signal);
    else process.kill(-pgid, signal);
  } catch (error) { if (error.code !== "ESRCH") throw error; }
}

async function waitForExtinction(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (groupExists(pgid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  return !groupExists(pgid);
}

async function watchdog(parentPid, supervisorPid) {
  for (;;) {
    if (!groupExists(supervisorPid)) return 0;
    if (!processExists(parentPid) || !processExists(supervisorPid)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  signalGroup(supervisorPid, "SIGTERM");
  if (!await waitForExtinction(supervisorPid, TERM_WAIT_MS)) {
    signalGroup(supervisorPid, "SIGKILL");
    if (!await waitForExtinction(supervisorPid, KILL_WAIT_MS)) return 70;
  }
  return 0;
}

if (process.argv[2] === "--watch") {
  const parentPid = Number(process.argv[3]);
  const supervisorPid = Number(process.argv[4]);
  if (!Number.isInteger(parentPid) || parentPid <= 1 || !Number.isInteger(supervisorPid) || supervisorPid <= 1) process.exit(64);
  process.exitCode = await watchdog(parentPid, supervisorPid);
} else {
  const [, , parentPidValue, command, ...args] = process.argv;
  const parentPid = Number(parentPidValue);
  if (!Number.isInteger(parentPid) || parentPid <= 1 || !command) {
    process.stderr.write("therapy scaffold provider supervisor requires <parent-pid> <command> [args...]\n");
    process.exit(64);
  }

  // The provider stays in the supervisor's process group. The detached watchdog
  // can therefore extinguish the complete tree even if this supervisor itself
  // is killed by timeout or capture-overflow handling before it can clean up.
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    detached: false
  });
  let closing = false;

  function removeHandlers() {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }

  function forwardAndFinish(signal, exitCode) {
    if (closing) return;
    closing = true;
    removeHandlers();
    try { child.kill(signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
    process.exitCode = exitCode;
  }

  const onSigint = () => forwardAndFinish("SIGINT", 130);
  const onSigterm = () => forwardAndFinish("SIGTERM", 143);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  child.once("spawn", () => {
    const watchdogProcess = spawn(process.execPath, [selfPath, "--watch", String(parentPid), String(process.pid)], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: "ignore",
      detached: true
    });
    watchdogProcess.once("error", () => {
      // A missing watchdog would make abrupt supervisor death unsafe. Fail the
      // complete supervisor/provider group closed; the caller observes failure.
      try { signalGroup(process.pid, "SIGKILL"); } catch { process.exit(69); }
    });
    watchdogProcess.unref();
  });

  child.once("error", (error) => {
    closing = true;
    removeHandlers();
    process.stderr.write(`could not start supervised provider command: ${error.message}\n`);
    process.exitCode = 69;
  });

  child.once("close", (code, signal) => {
    if (!closing) {
      closing = true;
      removeHandlers();
      process.exitCode = signal ? 128 : (code ?? 1);
    }
  });
}
