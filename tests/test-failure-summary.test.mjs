import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTestFailure } from "../src/diagnostics/test-failure-summary.mjs";

test("observed Zorin test failure keeps the failed contract and safe hashes without private output", () => {
  const summary = summarizeTestFailure({
    command: "npm test",
    exitCode: 1,
    projectRoot: "/home/joel/Téléchargements/inner-signal-runtime",
    stdout: `
ℹ tests 192
ℹ suites 0
ℹ pass 191
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
✖ failing tests:

test at tests/guide-packet-r02.test.mjs:97:1
✖ building r02 does not rewrite the preserved r01 candidate contract or bytes (165.260361ms)
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
actual: d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738
expected: 9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263
PRIVATE_CHAT_MARKER sk-secret-do-not-copy
`,
    stderr: "/home/joel/private/therapy.json PRIVATE_REASONING_MARKER"
  });

  assert.deepEqual(summary.counts, {
    tests: 192,
    suites: 0,
    pass: 191,
    fail: 1,
    cancelled: 0,
    skipped: 0
  });
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0].name, "building r02 does not rewrite the preserved r01 candidate contract or bytes");
  assert.deepEqual(summary.failures[0].location, {
    file: "tests/guide-packet-r02.test.mjs",
    line: 97,
    column: 1
  });
  assert.equal(summary.failures[0].errorCode, "ERR_ASSERTION");
  assert.equal(summary.failures[0].actual, "d93fda96d9a2fcc7fd81d371055fe00aa64efa7afd223704c959dbdbd4388738");
  assert.equal(summary.failures[0].expected, "9395cf2382ce14647d7f14c97268c53094ba822486be72a104e0e24fb0295263");
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_CHAT_MARKER|PRIVATE_REASONING_MARKER|sk-secret|\/home\/joel|therapy\.json/);
});
