import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function copyRuntime() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-liveness-"));
  await fs.cp(sourceRoot, root, {
    recursive: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      return !relative.startsWith("node_modules")
        && !relative.startsWith(".inner-signal-autopilot")
        && !relative.startsWith("tmp");
    }
  });
  const port = await freePort();
  await fs.writeFile(path.join(root, ".env"), [
    "INNER_SIGNAL_MODE=mock",
    `PORT=${port}`,
    "LEDGER_MODE=off",
    "DEV_AUTOMATION_ENABLED=false",
    "GUIDE_PACKET_ROOT=./.inner-signal-autopilot/guide-packets"
  ].join("\n") + "\n");
  await execFileAsync(process.execPath, ["src/cli/prepare-environment.mjs", "--quiet"], { cwd: root });
  return { root, port };
}

function shellLiteral(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function installDesktopOpenStubs(bin) {
  const callLog = path.join(path.dirname(bin), "desktop-open-calls.log");
  const stub = `#!/usr/bin/env bash
printf '%s\\t%s\\n' "$(basename "$0")" "$*" >> ${shellLiteral(callLog)}
exit 0
`;
  await Promise.all([
    fs.writeFile(path.join(bin, "xdg-open"), stub, { mode: 0o755 }),
    fs.writeFile(path.join(bin, "gio"), stub, { mode: 0o755 })
  ]);
}

async function installFailingNodeWrapper(root, { targetScript, markerName }) {
  const bin = path.join(root, "test-bin");
  const marker = path.join(root, markerName);
  await fs.mkdir(bin, { recursive: true });
  await installDesktopOpenStubs(bin);
  const wrapper = `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == *${shellLiteral(targetScript)}* ]]; then
    printf '%s\n' attempted > ${shellLiteral(marker)}
    exit 17
  fi
done
exec ${shellLiteral(process.execPath)} "$@"
`;
  const file = path.join(bin, "node");
  await fs.writeFile(file, wrapper, { mode: 0o755 });
  return { bin, marker };
}

async function installFailingPromotionNodeWrapper(root) {
  const bin = path.join(root, "promotion-test-bin");
  const marker = path.join(root, "promotion-attempted.txt");
  const serveCount = path.join(root, "serve-count.txt");
  const recoveryWaiting = path.join(root, "recovery-server-waiting.txt");
  const releaseRecovery = path.join(root, "release-recovery-server.txt");
  await fs.mkdir(bin, { recursive: true });
  await installDesktopOpenStubs(bin);
  const wrapper = `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == *${shellLiteral("src/cli/promote-candidate.mjs")}* ]]; then
    printf '%s\n' attempted > ${shellLiteral(marker)}
    exit 17
  fi
  if [[ "$arg" == *${shellLiteral("src/cli/serve.mjs")}* ]]; then
    count="$(cat ${shellLiteral(serveCount)} 2>/dev/null || printf '0')"
    count=$((count + 1))
    printf '%s\n' "$count" > ${shellLiteral(serveCount)}
    if [[ "$count" -eq 2 ]]; then
      printf '%s\n' waiting > ${shellLiteral(recoveryWaiting)}
      while [[ ! -f ${shellLiteral(releaseRecovery)} ]]; do sleep 0.05; done
    fi
  fi
done
exec ${shellLiteral(process.execPath)} "$@"
`;
  await fs.writeFile(path.join(bin, "node"), wrapper, { mode: 0o755 });
  return { bin, marker, recoveryWaiting, releaseRecovery };
}

async function installProgressTrackingNodeWrapper(root) {
  const bin = path.join(root, "progress-test-bin");
  const started = path.join(root, "progress-watcher-started.txt");
  const stopped = path.join(root, "progress-watcher-stopped.txt");
  await fs.mkdir(bin, { recursive: true });
  await installDesktopOpenStubs(bin);
  const wrapper = `#!/usr/bin/env bash
if [[ "$*" == *"src/cli/sync-progress.mjs --watch"* ]]; then
  printf '%s\n' "$$" >> ${shellLiteral(started)}
  trap 'printf "%s\\n" stopped > ${shellLiteral(stopped)}; exit 0' INT TERM
  while true; do sleep 0.1; done
fi
exec ${shellLiteral(process.execPath)} "$@"
`;
  await fs.writeFile(path.join(bin, "node"), wrapper, { mode: 0o755 });
  return { bin, started, stopped };
}

async function waitFor(predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} did not become true within ${timeoutMs} ms${lastError ? `: ${lastError.message}` : ""}`);
}

function startWrapper(root, bin, args = [], extraEnv = {}) {
  const child = spawn("bash", ["./run-autopilot.sh", ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${bin}:${process.env.PATH}`,
      AUTOPILOT_STATE_DIR: path.join(root, ".inner-signal-autopilot"),
      INNER_SIGNAL_GIT_SOURCE: path.join(path.dirname(root), `${path.basename(root)}-source-unavailable`),
      INNER_SIGNAL_GIT_AUTO_UPDATE: "false",
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "false",
      INNER_SIGNAL_VALIDATION_SANDBOX: "0"
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function installPoisonGh(root) {
  const poisonBin = path.join(root, "poison-bin");
  const marker = path.join(root, "external-gh-called.txt");
  await fs.mkdir(poisonBin, { recursive: true });
  await fs.writeFile(path.join(poisonBin, "gh"), `#!/usr/bin/env bash\nprintf '%s\n' called > ${shellLiteral(marker)}\nexit 97\n`, { mode: 0o755 });
  return { command: path.join(poisonBin, "gh"), marker };
}

async function stopWrapper(child) {
  const exited = () => child.exitCode != null || child.signalCode != null;
  const processGroupExists = () => {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  };
  const waitForExit = async (timeoutMs) => {
    if (exited()) return true;
    return await Promise.race([
      once(child, "exit").then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
    ]);
  };
  const waitForProcessGroupExit = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!processGroupExists()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return !processGroupExists();
  };
  if (!processGroupExists()) {
    assert.equal(await waitForExit(3000), true, "temporary launcher leader did not exit");
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  const [leaderExited, groupExited] = await Promise.all([
    waitForExit(3000),
    waitForProcessGroupExit(3000)
  ]);
  if (!leaderExited || !groupExited) {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    assert.equal(await waitForExit(3000), true, "temporary launcher leader did not exit");
    assert.equal(await waitForProcessGroupExit(3000), true, "temporary launcher process group did not exit");
  }
}

async function assertRecoverySurface({ port, child, output }) {
  const base = `http://127.0.0.1:${port}`;
  const health = await waitFor(async () => {
    assert.equal(child.exitCode, null, `launcher exited and took down recovery service:\n${output()}`);
    assert.equal(child.signalCode, null, `launcher was signaled and took down recovery service:\n${output()}`);
    const response = await fetch(`${base}/health`).catch(() => null);
    return response?.status === 200 ? response : null;
  }, "recovery health");
  assert.equal(health.status, 200);
  const development = await fetch(`${base}/v1/dev/status`);
  assert.equal(development.status, 200);
  const guides = await fetch(`${base}/v1/guides/status`);
  assert.equal(guides.status, 200);
  const recovery = await fetch(`${base}/v1/debug/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: {} })
  });
  assert.equal(recovery.status, 200);
  assert.match(recovery.headers.get("content-type"), /application\/zip/);
  assert.ok((await recovery.arrayBuffer()).byteLength > 1000);
}

test("validation failure leaves health, status, and recovery ZIP available", { timeout: 30000 }, async (t) => {
  const { root, port } = await copyRuntime();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-external-state-"));
  t.after(() => fs.rm(externalRoot, { recursive: true, force: true }));
  const externalState = path.join(externalRoot, "autopilot");
  await fs.mkdir(path.join(externalState, "diagnostic-outbox"), { recursive: true });
  await fs.writeFile(path.join(externalState, "diagnostic-outbox", "decoy.json"), "{}\n");
  const poison = await installPoisonGh(root);
  const { bin, marker } = await installFailingNodeWrapper(root, {
    targetScript: "src/cli/autopilot.mjs",
    markerName: "validation-attempted.txt"
  });
  const running = startWrapper(root, bin, ["--force-validation"], {
    AUTOPILOT_STATE_DIR: externalState,
    INNER_SIGNAL_GH_COMMAND: poison.command
  });
  try {
    await waitFor(async () => fs.access(marker).then(() => true, () => false), "validation attempt");
    await assertRecoverySurface({ port, ...running });
  } finally {
    await stopWrapper(running.child);
  }
  await assert.rejects(fs.access(poison.marker));
  assert.deepEqual(await fs.readdir(externalState), ["diagnostic-outbox"]);
  assert.deepEqual(await fs.readdir(path.join(externalState, "diagnostic-outbox")), ["decoy.json"]);
});

test("promotion failure restarts health, status, and recovery ZIP instead of abandoning the browser", { timeout: 30000 }, async (t) => {
  const { root, port } = await copyRuntime();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const desktopOpenCalls = path.join(root, "desktop-open-calls.log");
  const stateRoot = path.join(root, ".inner-signal-autopilot");
  await fs.mkdir(stateRoot, { recursive: true });
  const fingerprint = (await execFileAsync(process.execPath, ["src/cli/runtime-fingerprint.mjs"], { cwd: root })).stdout.trim();
  await fs.writeFile(path.join(stateRoot, "validated-runtime-fingerprint.txt"), `${fingerprint}\n`);
  await fs.writeFile(path.join(stateRoot, "promotion-ready.json"), `${JSON.stringify({ format: "inner-signal-promotion-ready-v1", jobId: "test-promotion", candidateRoot: root })}\n`);
  const { bin, marker, recoveryWaiting, releaseRecovery } = await installFailingPromotionNodeWrapper(root);
  const running = startWrapper(root, bin);
  try {
    await waitFor(async () => fs.access(marker).then(() => true, () => false), "promotion attempt");
    await waitFor(async () => fs.access(recoveryWaiting).then(() => true, () => false), "delayed recovery server");
    assert.equal(running.child.exitCode, null);
    assert.equal(running.child.signalCode, null);
    const heldCalls = (await fs.readFile(desktopOpenCalls, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    assert.equal(heldCalls.length, 1, "recovery browser open ran before recovery health was ready");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
    await fs.writeFile(releaseRecovery, "release\n");
    await assertRecoverySurface({ port, ...running });
    const recoveredCalls = await waitFor(async () => {
      const calls = (await fs.readFile(desktopOpenCalls, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
      return calls.length === 2 ? calls : null;
    }, "recovery browser open after health");
    assert.deepEqual(recoveredCalls, [
      `xdg-open\thttp://localhost:${port}`,
      `xdg-open\thttp://localhost:${port}`
    ]);
  } finally {
    await stopWrapper(running.child);
  }
});

test("test teardown terminates descendants after the launcher leader has exited", { timeout: 10000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-process-group-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const descendantMarker = path.join(root, "descendant-pid.txt");
  const leaderScript = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(descendantMarker)}, String(child.pid));
child.unref();
`;
  const leader = spawn(process.execPath, ["-e", leaderScript], {
    detached: true,
    stdio: "ignore"
  });
  const processGroupExists = () => {
    try {
      process.kill(-leader.pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  };
  try {
    await waitFor(async () => fs.access(descendantMarker).then(() => true, () => false), "orphan descendant start");
    if (leader.exitCode == null && leader.signalCode == null) await once(leader, "exit");
    assert.equal(processGroupExists(), true);
    await stopWrapper(leader);
    assert.equal(processGroupExists(), false, "test-owned descendant survived launcher teardown");
  } finally {
    try { process.kill(-leader.pid, "SIGKILL"); } catch {}
  }
});

test("launcher owns one progress watcher and terminates it during cleanup", { timeout: 30000 }, async (t) => {
  const { root } = await copyRuntime();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateRoot = path.join(root, ".inner-signal-autopilot");
  await fs.mkdir(stateRoot, { recursive: true });
  const fingerprint = (await execFileAsync(process.execPath, ["src/cli/runtime-fingerprint.mjs"], { cwd: root })).stdout.trim();
  await fs.writeFile(path.join(stateRoot, "validated-runtime-fingerprint.txt"), `${fingerprint}\n`);
  const tracker = await installProgressTrackingNodeWrapper(root);
  const running = startWrapper(root, tracker.bin);
  let watcherPid = null;
  try {
    watcherPid = await waitFor(async () => {
      const raw = await fs.readFile(tracker.started, "utf8").catch(() => "");
      const first = raw.trim().split("\n")[0];
      return /^\d+$/.test(first) ? Number(first) : null;
    }, "progress watcher start");
    assert.doesNotThrow(() => process.kill(watcherPid, 0));
    assert.equal(running.child.exitCode, null);
    running.child.kill("SIGTERM");
    await Promise.race([once(running.child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    await waitFor(async () => fs.access(tracker.stopped).then(() => true, () => false), "progress watcher cleanup");
    assert.throws(() => process.kill(watcherPid, 0), /ESRCH/);
    assert.equal((await fs.readFile(tracker.started, "utf8")).trim().split("\n").length, 1);
  } finally {
    if (watcherPid) {
      try { process.kill(watcherPid, "SIGKILL"); } catch {}
    }
    await stopWrapper(running.child);
  }
});
