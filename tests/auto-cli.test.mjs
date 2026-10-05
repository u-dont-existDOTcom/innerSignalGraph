import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legacy run-all wrapper delegates to autopilot", async () => {
  const { stdout } = await execFileAsync("bash", [path.join(root, "run-all-cli.sh"), "--dry-run"], { cwd: root });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.logsRequiredFromUser, false);
});

test("package fake-autopilot verification follows canonical graph stats instead of a hardcoded inventory", async () => {
  const script = await fs.readFile(path.join(root, "scripts/verify-package.sh"), "utf8");
  assert.match(script, /guide-graphs\/compiled\/bundle\.json/);
  assert.match(script, /Object\.entries\(compiled\.stats/);
  assert.doesNotMatch(script, /nodeCount\s*!==\s*\d+/);
});
