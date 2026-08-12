import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
