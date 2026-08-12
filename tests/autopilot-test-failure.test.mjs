import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("autopilot persists a safe test summary beside local raw logs", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-test-summary-"));
  await fs.cp(sourceRoot, root, {
    recursive: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      return relative !== ".git" && !relative.startsWith(".git/") && !relative.startsWith(".inner-signal-autopilot");
    }
  });
  const stateDir = path.join(root, "state");
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(root, ".env"), "INNER_SIGNAL_MODE=cli\nALLOW_CLAUDE_FABLE_USAGE=true\n", { mode: 0o600 });
  await fs.writeFile(path.join(binDir, "npm"), `#!/usr/bin/env bash
printf '%s\n' 'ℹ tests 192' 'ℹ pass 191' 'ℹ fail 1' 'test at tests/guide-packet-r02.test.mjs:97:1' '✖ building r02 does not rewrite the preserved r01 candidate contract or bytes' 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:' 'actual: d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738' 'expected: 9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263' 'PRIVATE_CHAT_MARKER sk-secret-do-not-copy'
exit 1
`, { mode: 0o755 });

  await assert.rejects(
    () => execFileAsync(process.execPath, ["--env-file=.env", "src/cli/autopilot.mjs", "--no-launch", "--external-launch"], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        AUTOPILOT_STATE_DIR: stateDir,
        GUIDE_PACKET_ROOT: path.join(stateDir, "guide-packets")
      }
    }),
    (error) => error.code === 1
  );

  const runNames = (await fs.readdir(stateDir)).filter((name) => name.startsWith("run-")).sort();
  assert.equal(runNames.length, 1);
  const runDir = path.join(stateDir, runNames[0]);
  const summary = JSON.parse(await fs.readFile(path.join(runDir, "test-failure-summary.json"), "utf8"));
  const finalStatus = JSON.parse(await fs.readFile(path.join(runDir, "final-status.json"), "utf8"));
  assert.equal(summary.failures[0].name, "building r02 does not rewrite the preserved r01 candidate contract or bytes");
  assert.equal(finalStatus.details.testSummary.failures[0].actual, "d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738");
  assert.doesNotMatch(JSON.stringify(finalStatus), /PRIVATE_CHAT_MARKER|sk-secret-do-not-copy/);
  assert.match(await fs.readFile(path.join(runDir, "tests.stdout.log"), "utf8"), /PRIVATE_CHAT_MARKER/);
});
