import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(args, env = {}) {
  return spawnSync(process.execPath, ["src/cli/guide-packet.mjs", ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

test("guide packet CLI builds and verifies the exact candidate fixture", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-cli-"));
  const built = run(["build-fixture", "--output", root]);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const summary = JSON.parse(built.stdout);
  assert.equal(summary.ok, true);
  const verify = run(["verify", summary.zipPath]);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  const verified = JSON.parse(verify.stdout);
  assert.equal(verified.ok, true);
  assert.equal(verified.manifest.status, "candidate");
  assert.equal(verified.installable, false);
  assert.equal(verified.regressionStatus.ok, true);
  assert.equal(verified.regressionStatus.passed, 4);
});

test("guide packet CLI can deterministically stage the bundled candidate without installing it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "guide-packet-cli-stage-"));
  const result = run(["stage-fixture", "--no-review"], {
    INNER_SIGNAL_MODE: "mock",
    AUTOPILOT_STATE_DIR: root,
    GUIDE_PACKET_ROOT: path.join(root, "guide-packets")
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.staged, true);
  assert.equal(summary.reviewed, false);
  const status = JSON.parse((await fs.readFile(path.join(root, "guide-packets", "candidates", summary.candidate.packetId, "state.json"), "utf8")));
  assert.equal(status.status, "awaiting-owner");
  await assert.rejects(fs.access(path.join(root, "guide-packets", "installed", "current")));
});
