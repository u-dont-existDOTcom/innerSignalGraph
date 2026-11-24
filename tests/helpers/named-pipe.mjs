import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

// A named pipe nothing ever writes to: an open that waits for a writer waits for ever.
export function makeNamedPipe(file) {
  execFileSync("mkfifo", [file]);
}

// Runs an ES module's code in a process of its own, with `args` as its arguments, and returns what it printed. A process that waits on a
// pipe is killed after a minute, so the test that started it fails instead of waiting; nothing depends on how fast it runs otherwise.
export function printedApart(code, args) {
  const { status, signal, stdout, stderr } = spawnSync(process.execPath, ["--input-type=module", "--eval", code, ...args], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  assert.deepEqual({ status, signal }, { status: 0, signal: null }, stderr);
  return stdout;
}
