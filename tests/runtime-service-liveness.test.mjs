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

async function installFailingNodeWrapper(root, { targetScript, markerName }) {
  const bin = path.join(root, "test-bin");
  const marker = path.join(root, markerName);
  await fs.mkdir(bin, { recursive: true });
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

function startWrapper(root, bin, args = []) {
  const child = spawn("bash", ["./run-autopilot.sh", ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function stopWrapper(child) {
  if (child.exitCode != null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode == null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }
}

async function assertRecoverySurface({ port, child, output }) {
  const base = `http://127.0.0.1:${port}`;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(child.exitCode, null, `launcher exited and took down recovery service:\n${output()}`);
  const health = await fetch(`${base}/health`);
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

test("validation failure leaves health, status, and recovery ZIP available", { timeout: 30000 }, async () => {
  const { root, port } = await copyRuntime();
  const { bin, marker } = await installFailingNodeWrapper(root, {
    targetScript: "src/cli/autopilot.mjs",
    markerName: "validation-attempted.txt"
  });
  const running = startWrapper(root, bin, ["--force-validation"]);
  try {
    await waitFor(async () => fs.access(marker).then(() => true, () => false), "validation attempt");
    await assertRecoverySurface({ port, ...running });
  } finally {
    await stopWrapper(running.child);
  }
});

test("promotion failure restarts health, status, and recovery ZIP instead of abandoning the browser", { timeout: 30000 }, async () => {
  const { root, port } = await copyRuntime();
  const stateRoot = path.join(root, ".inner-signal-autopilot");
  await fs.mkdir(stateRoot, { recursive: true });
  const fingerprint = (await execFileAsync(process.execPath, ["src/cli/runtime-fingerprint.mjs"], { cwd: root })).stdout.trim();
  await fs.writeFile(path.join(stateRoot, "validated-runtime-fingerprint.txt"), `${fingerprint}\n`);
  await fs.writeFile(path.join(stateRoot, "promotion-ready.json"), `${JSON.stringify({ format: "inner-signal-promotion-ready-v1", jobId: "test-promotion", candidateRoot: root })}\n`);
  const { bin, marker } = await installFailingNodeWrapper(root, {
    targetScript: "src/cli/promote-candidate.mjs",
    markerName: "promotion-attempted.txt"
  });
  const running = startWrapper(root, bin);
  try {
    await waitFor(async () => fs.access(marker).then(() => true, () => false), "promotion attempt");
    await assertRecoverySurface({ port, ...running });
  } finally {
    await stopWrapper(running.child);
  }
});
