import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  discoverBrowserLauncher,
  launchBrowser,
  validateBrowserExecutable,
  validateLoopbackBrowserUrl
} from "../src/release/browser-launcher.mjs";
import { evaluateNodeRuntime, parseNodeVersion } from "../src/release/runtime-requirements.mjs";

async function fakeExecutable(root, name) {
  const file = path.join(root, name);
  await fs.writeFile(file, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  return file;
}

function recordingSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.pid = 4242;
    child.unref = () => { child.unrefCalled = true; };
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
}

test("central runtime requirements accept Node 24 patches and reject adjacent majors", () => {
  assert.deepEqual(parseNodeVersion("v24.18.1"), { major: 24, minor: 18, patch: 1, normalized: "24.18.1" });
  assert.equal(evaluateNodeRuntime("24.0.0").ok, true);
  assert.equal(evaluateNodeRuntime("24.18.1").recommendedMatch, false);
  assert.equal(evaluateNodeRuntime("23.99.0").ok, false);
  assert.equal(evaluateNodeRuntime("25.0.0").ok, false);
  assert.equal(evaluateNodeRuntime("24.18").code, "INVALID_NODE_VERSION");
});

test("configured browser executable receives the exact loopback URL as one argument without a shell", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-browser-launcher-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = await fakeExecutable(root, "fake-browser");
  const calls = [];
  const url = "http://localhost:43871";
  const result = await launchBrowser({
    url,
    env: { PATH: root, INNER_SIGNAL_BROWSER_EXECUTABLE: executable },
    spawnImpl: recordingSpawn(calls)
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, url);
  assert.equal(result.discovery.source, "environment");
  assert.deepEqual(result.discovery.attempts, [{ candidate: executable, source: "environment", status: "selected" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, executable);
  assert.deepEqual(calls[0].args, [url]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.detached, true);
});

test("PATH discovery is deterministic and preserves opener-specific arguments", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-browser-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gio = await fakeExecutable(root, "gio");
  const discovery = await discoverBrowserLauncher({
    env: { PATH: root },
    candidates: [{ name: "missing-browser", kind: "browser" }, { name: "gio", kind: "gio-opener" }]
  });
  assert.equal(discovery.ok, true);
  assert.equal(discovery.executable, gio);
  assert.deepEqual(discovery.attempts, [
    { candidate: "missing-browser", source: "path", status: "not-found" },
    { candidate: "gio", source: "path", status: "selected" }
  ]);

  const calls = [];
  const url = "http://127.0.0.1:43872";
  const launched = await launchBrowser({
    url,
    env: { PATH: root },
    candidates: [{ name: "gio", kind: "gio-opener" }],
    spawnImpl: recordingSpawn(calls)
  });
  assert.equal(launched.ok, true);
  assert.deepEqual(calls[0].args, ["open", url]);
});

test("browser configuration rejects command strings and never falls back after an invalid override", async () => {
  for (const value of ["brave --new-window", "sh -c brave", "brave;touch-marker", "$(brave)"]) {
    assert.throws(() => validateBrowserExecutable(value), /one executable name or path/);
  }
  const discovery = await discoverBrowserLauncher({
    env: { PATH: "/unavailable", INNER_SIGNAL_BROWSER_EXECUTABLE: "brave --incognito" }
  });
  assert.equal(discovery.ok, false);
  assert.equal(discovery.code, "INVALID_BROWSER_EXECUTABLE");
  assert.deepEqual(discovery.attempts, []);
});

test("only explicit HTTP loopback origins are accepted", () => {
  for (const value of ["http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"]) {
    assert.equal(validateLoopbackBrowserUrl(value), value);
  }
  for (const value of [
    "https://localhost:8787",
    "http://example.com:8787",
    "http://localhost:8787/path",
    "http://localhost",
    "http://user@localhost:8787"
  ]) {
    assert.throws(() => validateLoopbackBrowserUrl(value), /loopback|port/);
  }
});
