import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("community schemas, synthetic examples, and authority boundaries verify", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-community-learning.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /runtime non-activation gates are intact|non-activation gates are intact/);
});
