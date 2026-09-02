import test from "node:test";
import assert from "node:assert/strict";
import { runLocalReleaseMatrix } from "../src/release/local-release-matrix.mjs";

test("local release matrix exercises install, rollback, loopback, and fake-browser acceptance without external effects", { timeout: 30000 }, async () => {
  const result = await runLocalReleaseMatrix();
  assert.equal(result.format, "inner-signal-local-release-matrix-v1");
  for (const section of ["node", "browser", "cleanInstall", "rollback", "loopback", "browserOpen", "acceptance"]) {
    assert.equal(typeof result[section], "object", section);
  }
  assert.equal(result.node.compatibility.node24Patch, true);
  assert.equal(result.node.compatibility.node23Rejected, true);
  assert.equal(result.node.compatibility.node25Rejected, true);
  assert.equal(result.browser.shell, false);
  assert.equal(result.browser.argumentCount, 1);
  assert.equal(result.cleanInstall.sourceKind, "isolated-local-bare-git");
  assert.equal(result.cleanInstall.dependencyNetworkUsed, false);
  assert.equal(result.rollback.activationFailure.priorRuntimeRestored, true);
  assert.equal(result.rollback.installRecordFailure.priorRuntimeRestored, true);
  assert.equal(result.rollback.privateStateByteHashesPreserved, true);
  assert.equal(result.loopback.binding, "ephemeral-loopback-only");
  assert.equal(result.loopback.closedDeterministically, true);
  assert.deepEqual(result.browserOpen.receivedArguments, [result.browserOpen.readyLoopbackUrl]);
  assert.equal(result.browserOpen.realBrowserLaunched, false);
  assert.equal(result.acceptance.externalNetworkUsed, false);
  assert.equal(result.acceptance.realInstallOrBrowserUsed, false);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
});
