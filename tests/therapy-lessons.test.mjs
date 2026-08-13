import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("therapy lesson log covers every substantive decision in the latest uploaded guide candidate", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/verify-therapy-lessons.mjs"], {
    cwd: root
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error?.code ?? 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? error?.message ?? "" })
  );
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^PASS 5\/5 substantive therapy prompt lessons tracked for /);
});
