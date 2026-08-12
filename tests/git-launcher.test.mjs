import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function executable(file, body) {
  await fs.writeFile(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
}

test("Git bootstrap performs one official web login, configures Git, verifies the private repository, and invokes the updater", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-bootstrap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.log");
  await fs.mkdir(bin, { recursive: true });
  await executable(path.join(bin, "gh"), `
printf 'gh %s\\n' "$*" >> "$INNER_SIGNAL_TEST_LOG"
if [[ "$1 $2" == "auth status" ]]; then exit 1; fi
if [[ "$1 $2" == "auth login" ]]; then exit 0; fi
if [[ "$1 $2" == "auth setup-git" ]]; then exit 0; fi
if [[ "$1" == "api" && "$*" == *".full_name"* ]]; then printf '%s\\n' 'u-dont-existDOTcom/innerSignalGraph'; exit 0; fi
if [[ "$1" == "api" && "$*" == *".permissions.push"* ]]; then printf '%s\\n' 'true'; exit 0; fi
exit 0`);
  await executable(path.join(bin, "git"), `
printf 'git %s\\n' "$*" >> "$INNER_SIGNAL_TEST_LOG"
if [[ "$*" == *" fetch "* ]]; then exit 42; fi
if [[ "$1" == "clone" ]]; then
  target="\${!#}"
  mkdir -p "$target/.git"
fi
exit 0`);
  await executable(path.join(bin, "node"), `
printf 'node %s\\n' "$*" >> "$INNER_SIGNAL_TEST_LOG"
if [[ "$1" == "-p" && "$2" == "process.versions.node" ]]; then
  printf '%s\\n' "\${INNER_SIGNAL_TEST_NODE_VERSION:-24.0.0}"
  exit 0
fi
if [[ "$*" == *"src/cli/git-update.mjs"* ]]; then
  mkdir -p "$INNER_SIGNAL_GIT_INSTALL_ROOT"
  printf '%s\\n' '#!/usr/bin/env bash' 'exit 0' > "$INNER_SIGNAL_GIT_INSTALL_ROOT/run-autopilot.sh"
  chmod +x "$INNER_SIGNAL_GIT_INSTALL_ROOT/run-autopilot.sh"
  exit 10
fi
exit 0`);
  await executable(path.join(bin, "npm"), `printf 'npm %s\\n' "$*" >> "$INNER_SIGNAL_TEST_LOG"`);

  const { stdout, stderr } = await execFileAsync("bash", ["packaging/install-from-git.sh"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: root,
      PATH: `${bin}:${process.env.PATH}`,
      INNER_SIGNAL_TEST_LOG: log,
      INNER_SIGNAL_INSTALL_ONLY: "true"
    }
  });
  const calls = await fs.readFile(log, "utf8");
  assert.equal((calls.match(/gh auth login --hostname github\.com --git-protocol https --web/g) ?? []).length, 1);
  assert.match(calls, /gh auth setup-git/);
  assert.match(calls, /gh api repos\/u-dont-existDOTcom\/innerSignalGraph .*\.full_name/);
  assert.match(calls, /gh api repos\/u-dont-existDOTcom\/innerSignalGraph .*\.permissions\.push/);
  assert.match(calls, /git clone --branch stable/);
  assert.match(calls, /node -p process\.versions\.node/);
  assert.match(calls, /node .*src\/cli\/git-update\.mjs --bootstrap/);
  assert.doesNotMatch(`${stdout}\n${stderr}`, /upload.*(?:ZIP|log)|download.*ZIP/i);

  await assert.rejects(
    execFileAsync("bash", ["packaging/install-from-git.sh"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: root,
        PATH: `${bin}:${process.env.PATH}`,
        INNER_SIGNAL_TEST_LOG: log,
        INNER_SIGNAL_INSTALL_ONLY: "true",
        INNER_SIGNAL_TEST_NODE_VERSION: "18.20.0"
      }
    }),
    (error) => /Node\.js 20 or newer is required/.test(error.stderr)
  );
});

async function launcherFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-launcher-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const log = path.join(root, "node-calls.log");
  const count = path.join(root, "update-count.txt");
  await fs.mkdir(bin, { recursive: true });
  await fs.copyFile(path.join(projectRoot, "run-autopilot.sh"), path.join(root, "run-autopilot.sh"));
  await fs.chmod(path.join(root, "run-autopilot.sh"), 0o755);
  await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=mock\nDEV_AUTOMATION_ENABLED=false\n");
  await executable(path.join(bin, "node"), `
printf '%s|%s\\n' "\${INNER_SIGNAL_UPDATE_APPLIED:-0}" "$*" >> "$INNER_SIGNAL_TEST_LOG"
if [[ "$*" == *"src/cli/sync-diagnostics.mjs"* ]]; then
  printf '%s\\n' '{"helper":"sync"}'
  if [[ "\${INNER_SIGNAL_TEST_MODE:-}" == "remote-failure" ]]; then exit 23; fi
  exit 0
fi
if [[ "$*" == *"src/cli/git-update.mjs"* ]]; then
  current=0
  [[ -f "$INNER_SIGNAL_UPDATE_COUNT" ]] && current="$(cat "$INNER_SIGNAL_UPDATE_COUNT")"
  current=$((current + 1))
  printf '%s\\n' "$current" > "$INNER_SIGNAL_UPDATE_COUNT"
  printf '%s\\n' '{"helper":"update"}'
  if [[ "\${INNER_SIGNAL_TEST_MODE:-}" == "restart" ]]; then exit 10; fi
  if [[ "\${INNER_SIGNAL_TEST_MODE:-}" == "remote-failure" ]]; then exit 24; fi
  exit 0
fi
if [[ "$*" == *"src/cli/autopilot.mjs"* ]]; then printf '%s\\n' '{"status":"PASS"}'; fi
exit 0`);
  return { root, bin, log, count };
}

async function runLauncher(context, mode = "ordinary") {
  return await execFileAsync("bash", ["./run-autopilot.sh", "--no-launch"], {
    cwd: context.root,
    env: {
      ...process.env,
      PATH: `${context.bin}:${process.env.PATH}`,
      INNER_SIGNAL_TEST_LOG: context.log,
      INNER_SIGNAL_UPDATE_COUNT: context.count,
      INNER_SIGNAL_TEST_MODE: mode
    }
  });
}

test("ordinary launcher flushes diagnostics and checks stable before model validation", async (t) => {
  const context = await launcherFixture(t);
  const { stdout } = await runLauncher(context);
  const calls = (await fs.readFile(context.log, "utf8")).trim().split("\n");
  const flush = calls.findIndex((line) => line.includes("src/cli/sync-diagnostics.mjs --flush-only"));
  const update = calls.findIndex((line) => line.includes("src/cli/git-update.mjs"));
  const validation = calls.findIndex((line) => line.includes("src/cli/autopilot.mjs"));
  assert.ok(flush >= 0 && update > flush && validation > update, calls.join("\n"));
  assert.deepEqual(JSON.parse(stdout), { status: "PASS" });
});

test("an installed update restarts exactly once with the loop guard", async (t) => {
  const context = await launcherFixture(t);
  await runLauncher(context, "restart");
  const calls = (await fs.readFile(context.log, "utf8")).trim().split("\n");
  assert.equal(calls.filter((line) => line.includes("src/cli/git-update.mjs")).length, 2);
  assert.equal(calls.filter((line) => line.includes("src/cli/autopilot.mjs")).length, 1);
  assert.ok(calls.some((line) => line.startsWith("1|") && line.includes("src/cli/autopilot.mjs")));
});

test("remote sync and fetch failures do not block the current runtime path or ask for manual files", async (t) => {
  const context = await launcherFixture(t);
  const { stdout, stderr } = await runLauncher(context, "remote-failure");
  const calls = await fs.readFile(context.log, "utf8");
  assert.match(calls, /src\/cli\/autopilot\.mjs/);
  assert.doesNotMatch(`${stdout}\n${stderr}`, /upload.*(?:ZIP|log)|download.*ZIP|send.*log/i);
});
