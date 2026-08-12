import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadGitAutomationConfig } from "../src/git/automation-config.mjs";
import { runGitUpdate } from "../src/git/runtime-update.mjs";
import { runSubprocess } from "../src/core/subprocess.mjs";

const execFileAsync = promisify(execFile);
const repository = "u-dont-existDOTcom/innerSignalGraph";
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Inner Signal Tests",
  GIT_AUTHOR_EMAIL: "inner-signal-tests@example.invalid",
  GIT_COMMITTER_NAME: "Inner Signal Tests",
  GIT_COMMITTER_EMAIL: "inner-signal-tests@example.invalid"
};

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", args, { cwd, env: gitEnv });
  return stdout.trim();
}

async function writeManagedTree(root, {
  version,
  marker,
  testScript = "node -e \"process.exit(0)\"",
  graphScript = "node -e \"process.exit(0)\"",
  validationProbe = null
}) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "inner-signal-update-fixture",
    version,
    private: true,
    type: "module",
    scripts: { test: testScript, "graph:test": graphScript }
  }, null, 2)}\n`);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/managed.txt"), `${marker}\n`);
  await fs.writeFile(path.join(root, "run-autopilot.sh"), `#!/usr/bin/env bash\necho ${marker}\n`, { mode: 0o755 });
  const probePath = path.join(root, "validation-probe.mjs");
  if (validationProbe === null) await fs.rm(probePath, { force: true });
  else await fs.writeFile(probePath, validationProbe);
}

async function createRepository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-update-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remoteRoot = path.join(root, "u-dont-existDOTcom", "innerSignalGraph.git");
  const authorRoot = path.join(root, "author");
  const sourceRoot = path.join(root, "source");
  const installedRoot = path.join(root, "inner-signal-runtime");
  const stateDir = path.join(installedRoot, ".inner-signal-autopilot");

  await fs.mkdir(path.dirname(remoteRoot), { recursive: true });
  await git(root, "init", "--bare", remoteRoot);
  await git(root, "init", "-b", "stable", authorRoot);
  await writeManagedTree(authorRoot, { version: "1.0.0", marker: "managed-v1" });
  await git(authorRoot, "add", ".");
  await git(authorRoot, "commit", "-m", "fixture v1");
  await git(authorRoot, "remote", "add", "origin", remoteRoot);
  await git(authorRoot, "push", "-u", "origin", "stable");
  await git(remoteRoot, "symbolic-ref", "HEAD", "refs/heads/stable");
  const firstCommit = await git(authorRoot, "rev-parse", "HEAD");
  await git(root, "clone", remoteRoot, sourceRoot);

  await writeManagedTree(installedRoot, { version: "1.0.0", marker: "managed-v1" });
  const sentinels = {
    ".env": "PRIVATE_ENV_SENTINEL=unchanged\n",
    ".inner-signal-autopilot/private.json": "{\"private\":\"autopilot-sentinel\"}\n",
    ".inner-signal-autopilot/guide-packets/candidates/r01/original.zip": "candidate-byte-sentinel\n",
    ".inner-signal-autopilot/guide-packets/candidates/r01/owner-decisions.json": "owner-decision-sentinel\n",
    ".inner-signal-autopilot/guide-packets/installed/current/policy.json": "production-policy-sentinel\n",
    ".inner-signal-dev/job.json": "{\"job\":\"dev-sentinel\"}\n",
    "ledgers/one.json": "{\"ledger\":\"ledger-sentinel\"}\n",
    "data/user.db": "data-sentinel\n"
  };
  for (const [relative, contents] of Object.entries(sentinels)) {
    const target = path.join(installedRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, relative === ".env" ? { mode: 0o600 } : undefined);
  }
  await fs.writeFile(path.join(stateDir, "git-install.json"), `${JSON.stringify({
    format: "inner-signal-git-install-v1",
    branch: "stable",
    commit: firstCommit,
    installedAt: "2026-08-11T00:00:00.000Z"
  }, null, 2)}\n`, { mode: 0o600 });

  async function advance(options) {
    await writeManagedTree(authorRoot, options);
    await git(authorRoot, "add", ".");
    await git(authorRoot, "commit", "-m", `fixture ${options.version}`);
    await git(authorRoot, "push", "origin", "stable");
    return await git(authorRoot, "rev-parse", "HEAD");
  }

  return { root, remoteRoot, authorRoot, sourceRoot, installedRoot, stateDir, sentinels, firstCommit, advance };
}

async function sentinelHashes(installedRoot, sentinels) {
  const hashes = {};
  for (const relative of Object.keys(sentinels).sort()) {
    const bytes = await fs.readFile(path.join(installedRoot, relative));
    hashes[relative] = createHash("sha256").update(bytes).digest("hex");
  }
  return hashes;
}

async function treeHash(root) {
  const hash = createHash("sha256");
  async function visit(current, relative = "") {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : "f"}:${childRelative}\0`);
      if (entry.isDirectory()) await visit(child, childRelative);
      else hash.update(await fs.readFile(child));
    }
  }
  await visit(root);
  return hash.digest("hex");
}

test("Git automation configuration uses Downloads defaults, expands tilde, and rejects unsafe identifiers", () => {
  const defaults = loadGitAutomationConfig({
    env: {},
    homeDir: "/home/inner-signal",
    installRoot: "/home/inner-signal/Téléchargements/inner-signal-runtime"
  });
  assert.deepEqual(defaults, {
    repository: "u-dont-existDOTcom/innerSignalGraph",
    stableBranch: "stable",
    diagnosticsBranch: "runtime-diagnostics",
    sourceRoot: "/home/inner-signal/Téléchargements/innerSignalGraph",
    installedRoot: "/home/inner-signal/Téléchargements/inner-signal-runtime",
    stateDir: "/home/inner-signal/Téléchargements/inner-signal-runtime/.inner-signal-autopilot",
    autoUpdate: true,
    autoDiagnostics: true
  });

  const custom = loadGitAutomationConfig({
    env: {
      INNER_SIGNAL_GIT_SOURCE: "~/custom/source",
      AUTOPILOT_STATE_DIR: "~/.private-inner-signal",
      INNER_SIGNAL_GIT_AUTO_UPDATE: "false",
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "0"
    },
    homeDir: "/home/inner-signal",
    installRoot: "/opt/inner-signal"
  });
  assert.equal(custom.sourceRoot, "/home/inner-signal/custom/source");
  assert.equal(custom.stateDir, "/home/inner-signal/.private-inner-signal");
  assert.equal(custom.autoUpdate, false);
  assert.equal(custom.autoDiagnostics, false);

  assert.throws(() => loadGitAutomationConfig({ env: { INNER_SIGNAL_GITHUB_REPOSITORY: "owner/repo;env" } }), /Invalid GitHub repository/);
  assert.throws(() => loadGitAutomationConfig({ env: { INNER_SIGNAL_GIT_STABLE_BRANCH: "../stable" } }), /Invalid Git branch/);
  assert.throws(() => loadGitAutomationConfig({ env: { INNER_SIGNAL_GIT_AUTO_UPDATE: "sometimes" } }), /must be true or false/);
  assert.throws(() => loadGitAutomationConfig({
    env: { INNER_SIGNAL_GIT_SOURCE: "/opt/inner-signal/runtime/source" },
    installRoot: "/opt/inner-signal/runtime"
  }), /sourceRoot and installedRoot must not overlap/);
  assert.throws(() => loadGitAutomationConfig({
    env: {
      INNER_SIGNAL_GIT_SOURCE: "/opt/inner-signal/source",
      AUTOPILOT_STATE_DIR: "/opt/inner-signal/source/private-state"
    },
    installRoot: "/opt/inner-signal/runtime"
  }), /sourceRoot and stateDir must not overlap/);
});

test("source, installed runtime, and private state roots cannot overlap unsafely", async () => {
  const common = {
    repository,
    stableBranch: "stable",
    validateCandidate: async () => ({ ok: true })
  };
  await assert.rejects(
    runGitUpdate({
      ...common,
      sourceRoot: "/tmp/inner-signal-runtime/source",
      installedRoot: "/tmp/inner-signal-runtime",
      stateDir: "/tmp/inner-signal-runtime/.inner-signal-autopilot"
    }),
    /sourceRoot and installedRoot must not overlap/
  );
  await assert.rejects(
    runGitUpdate({
      ...common,
      sourceRoot: "/tmp/inner-signal-source",
      installedRoot: "/tmp/inner-signal-source/runtime",
      stateDir: "/tmp/inner-signal-source/runtime/.inner-signal-autopilot"
    }),
    /sourceRoot and installedRoot must not overlap/
  );
  await assert.rejects(
    runGitUpdate({
      ...common,
      sourceRoot: "/tmp/inner-signal-source",
      installedRoot: "/tmp/inner-signal-runtime",
      stateDir: "/tmp/inner-signal-source/private-state"
    }),
    /sourceRoot and stateDir must not overlap/
  );
  await assert.rejects(
    runGitUpdate({
      ...common,
      sourceRoot: "/tmp/inner-signal-source",
      installedRoot: "/tmp/inner-signal-runtime",
      stateDir: "/tmp/inner-signal-runtime"
    }),
    /stateDir must be inside .inner-signal-autopilot/
  );
});

test("candidate validation receives disposable state and no parent credentials", async (t) => {
  const context = await createRepository(t);
  const validationProbe = `
import assert from "node:assert/strict";
import path from "node:path";

assert.equal(process.env.INNER_SIGNAL_VALIDATION_SANDBOX, "1");
assert.equal(process.env.INNER_SIGNAL_GIT_AUTO_UPDATE, "false");
assert.equal(process.env.INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS, "false");
assert.equal(path.dirname(process.env.AUTOPILOT_STATE_DIR), path.dirname(process.env.HOME));
assert.equal(process.env.GH_CONFIG_DIR.startsWith(process.env.HOME), true);
assert.equal(process.env.HOME === process.env.VALIDATION_PARENT_HOME, false);
assert.equal(process.env.INNER_SIGNAL_GIT_SOURCE.startsWith(path.dirname(process.env.HOME)), true);
assert.equal(process.env.INNER_SIGNAL_GIT_INSTALL_ROOT.startsWith(path.dirname(process.env.HOME)), true);
for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
  assert.equal(process.env[name], undefined, name);
}
`;
  const candidateCommit = await context.advance({
    version: "1.1.0",
    marker: "managed-v2",
    testScript: "node validation-probe.mjs",
    validationProbe
  });
  let completed;
  try {
    const success = await execFileAsync(process.execPath, ["src/cli/git-update.mjs"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        AUTOPILOT_STATE_DIR: context.stateDir,
        INNER_SIGNAL_GIT_INSTALL_ROOT: context.installedRoot,
        INNER_SIGNAL_GIT_SOURCE: context.sourceRoot,
        INNER_SIGNAL_GIT_AUTO_UPDATE: "true",
        INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true",
        VALIDATION_PARENT_HOME: process.env.HOME ?? "",
        GH_TOKEN: "PRIVATE_GH_TOKEN",
        GITHUB_TOKEN: "PRIVATE_GITHUB_TOKEN",
        OPENAI_API_KEY: "PRIVATE_OPENAI_KEY",
        ANTHROPIC_API_KEY: "PRIVATE_ANTHROPIC_KEY"
      }
    });
    completed = { code: 0, stdout: success.stdout };
  } catch (error) {
    completed = { code: error.code, stdout: error.stdout };
  }

  const result = JSON.parse(completed.stdout);
  assert.equal(result.status, "UPDATED", JSON.stringify(result));
  assert.equal(completed.code, 10);
  assert.equal(result.installedCommit, candidateCommit);
});

test("stable update validates against empty state, preserves private bytes, swaps managed source, and is idempotent", async (t) => {
  const context = await createRepository(t);
  const secondCommit = await context.advance({ version: "1.1.0", marker: "managed-v2" });
  const before = await sentinelHashes(context.installedRoot, context.sentinels);
  let validations = 0;

  const validateCandidate = async ({ candidateRoot, env }) => {
    validations += 1;
    assert.equal(await fs.readFile(path.join(candidateRoot, "src/managed.txt"), "utf8"), "managed-v2\n");
    await assert.rejects(fs.access(path.join(candidateRoot, ".git")));
    assert.deepEqual(await fs.readdir(env.AUTOPILOT_STATE_DIR), []);
    assert.deepEqual(await fs.readdir(env.GUIDE_PACKET_ROOT), []);
    assert.notEqual(path.resolve(env.AUTOPILOT_STATE_DIR), path.resolve(context.stateDir));
    await fs.writeFile(path.join(candidateRoot, "src/managed.txt"), "validation-side-effect\n");
    await fs.writeFile(path.join(candidateRoot, "validation-artifact.txt"), "must-not-install\n");
    return { ok: true };
  };

  const updated = await runGitUpdate({
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    repository,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate,
    now: () => new Date("2026-08-12T06:00:00.000Z")
  });

  assert.equal(updated.status, "UPDATED");
  assert.equal(updated.installedCommit, secondCommit);
  assert.equal(updated.availableCommit, secondCommit);
  assert.equal(validations, 1);
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v2\n");
  await assert.rejects(fs.access(path.join(context.installedRoot, "validation-artifact.txt")));
  assert.equal(JSON.parse(await fs.readFile(path.join(context.installedRoot, "package.json"), "utf8")).version, "1.1.0");
  assert.deepEqual(await sentinelHashes(context.installedRoot, context.sentinels), before);
  await assert.rejects(fs.access(path.join(context.installedRoot, ".git")));
  assert.equal(JSON.parse(await fs.readFile(path.join(context.stateDir, "git-install.json"), "utf8")).commit, secondCommit);
  await fs.access(path.join(context.sourceRoot, ".git"));

  const beforeSecondRun = await sentinelHashes(context.installedRoot, context.sentinels);
  const current = await runGitUpdate({
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    repository,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate,
    now: () => new Date("2026-08-12T06:05:00.000Z")
  });
  assert.equal(current.status, "CURRENT");
  assert.equal(current.installedCommit, secondCommit);
  assert.equal(validations, 1);
  assert.deepEqual(await sentinelHashes(context.installedRoot, context.sentinels), beforeSecondRun);

  const thirdCommit = await context.advance({ version: "1.2.0", marker: "managed-v3" });
  const secondUpdate = await runGitUpdate({
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    repository,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async ({ candidateRoot, env }) => {
      validations += 1;
      assert.equal(await fs.readFile(path.join(candidateRoot, "src/managed.txt"), "utf8"), "managed-v3\n");
      assert.deepEqual(await fs.readdir(env.AUTOPILOT_STATE_DIR), []);
      assert.deepEqual(await fs.readdir(env.GUIDE_PACKET_ROOT), []);
      return { ok: true };
    },
    now: () => new Date("2026-08-12T06:07:00.000Z")
  });
  assert.equal(secondUpdate.status, "UPDATED");
  assert.equal(secondUpdate.installedCommit, thirdCommit);
  assert.equal(validations, 2);
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v3\n");
  assert.deepEqual(await sentinelHashes(context.installedRoot, context.sentinels), beforeSecondRun);
});

test("an empty install bootstraps the exact stable commit without embedding a Git checkout", async (t) => {
  const context = await createRepository(t);
  await fs.rm(context.installedRoot, { recursive: true, force: true });
  const installed = await runGitUpdate({
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    repository,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async ({ env }) => {
      assert.deepEqual(await fs.readdir(env.AUTOPILOT_STATE_DIR), []);
      assert.deepEqual(await fs.readdir(env.GUIDE_PACKET_ROOT), []);
      return { ok: true };
    },
    now: () => new Date("2026-08-12T06:08:00.000Z")
  });

  assert.equal(installed.status, "UPDATED");
  assert.equal(installed.installedCommit, context.firstCommit);
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
  await assert.rejects(fs.access(path.join(context.installedRoot, ".git")));
  assert.equal(JSON.parse(await fs.readFile(path.join(context.stateDir, "git-install.json"), "utf8")).commit, context.firstCommit);
});

test("validation and fetch failures leave the installed runtime byte-identical and source checkout intact", async (t) => {
  const context = await createRepository(t);
  const secondCommit = await context.advance({ version: "1.1.0", marker: "managed-v2" });
  const beforeValidation = await treeHash(context.installedRoot);
  const testSummary = {
    format: "inner-signal-test-failure-v1",
    command: "npm test",
    exitCode: 1,
    counts: { tests: 1, pass: 0, fail: 1 },
    failures: [{ name: "candidate contract fails", errorCode: "ERR_ASSERTION" }]
  };

  const failedValidation = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async ({ env }) => {
      assert.deepEqual(await fs.readdir(env.AUTOPILOT_STATE_DIR), []);
      assert.deepEqual(await fs.readdir(env.GUIDE_PACKET_ROOT), []);
      return { ok: false, stage: "package-tests", testSummary };
    },
    now: () => new Date("2026-08-12T06:10:00.000Z")
  });
  assert.equal(failedValidation.status, "FAILED_SAFE");
  assert.equal(failedValidation.candidateCommit, secondCommit);
  assert.deepEqual(failedValidation.testSummary, testSummary);
  assert.equal(await treeHash(context.installedRoot), beforeValidation);
  await fs.access(path.join(context.sourceRoot, ".git"));

  const offlineRemote = `${context.remoteRoot}.offline`;
  await fs.rename(context.remoteRoot, offlineRemote);
  const beforeFetch = await treeHash(context.installedRoot);
  const failedFetch = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async () => ({ ok: true }),
    now: () => new Date("2026-08-12T06:15:00.000Z")
  });
  assert.equal(failedFetch.status, "FAILED_SAFE");
  assert.equal(failedFetch.stage, "fetch");
  assert.equal(await treeHash(context.installedRoot), beforeFetch);
  await fs.access(path.join(context.installedRoot, "run-autopilot.sh"));
});

test("an origin that does not identify the configured private repository is rejected before fetch", async (t) => {
  const context = await createRepository(t);
  const unrelated = path.join(context.root, "unrelated", "other.git");
  await fs.mkdir(path.dirname(unrelated), { recursive: true });
  await git(context.root, "init", "--bare", unrelated);
  await git(context.sourceRoot, "remote", "set-url", "origin", unrelated);
  const result = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async () => ({ ok: true }),
    now: () => new Date("2026-08-12T06:20:00.000Z")
  });
  assert.equal(result.status, "FAILED_SAFE");
  assert.equal(result.stage, "origin-identity");
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
});

test("a source checkout whose managed files are dirty cannot supply a candidate", async (t) => {
  const context = await createRepository(t);
  await fs.writeFile(path.join(context.sourceRoot, "src/managed.txt"), "uncommitted-source-change\n");
  const result = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async () => ({ ok: true }),
    now: () => new Date("2026-08-12T06:21:00.000Z")
  });
  assert.equal(result.status, "FAILED_SAFE");
  assert.equal(result.stage, "source-dirty");
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
});

test("the startup fetch is short and cannot prompt for credentials", async (t) => {
  const context = await createRepository(t);
  let fetchCall = null;
  const result = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    run: async (options) => {
      if (options.args?.includes("fetch")) {
        fetchCall = options;
        return { code: 1, signal: null, stdout: "", stderr: "network unavailable" };
      }
      return await runSubprocess(options);
    },
    validateCandidate: async () => ({ ok: true }),
    now: () => new Date("2026-08-12T06:21:30.000Z")
  });

  assert.equal(result.status, "FAILED_SAFE");
  assert.equal(result.stage, "fetch");
  assert.ok(fetchCall);
  assert.ok(fetchCall.timeoutMs <= 15_000, fetchCall.timeoutMs);
  assert.equal(fetchCall.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(fetchCall.env.GCM_INTERACTIVE, "Never");
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
});

test("a private-state write during transfer aborts the swap without losing the write", async (t) => {
  const context = await createRepository(t);
  await context.advance({ version: "1.1.0", marker: "managed-v2" });
  const lateState = path.join(context.stateDir, "late-state.json");
  const result = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async () => ({ ok: true }),
    beforeStateTransfer: async () => {
      await fs.writeFile(lateState, "{\"late\":true}\n");
    },
    now: () => new Date("2026-08-12T06:22:00.000Z")
  });

  assert.equal(result.status, "FAILED_SAFE");
  assert.equal(result.stage, "state-overlay");
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
  assert.equal(await fs.readFile(lateState, "utf8"), "{\"late\":true}\n");
});

test("activation failure restores both the old runtime and its old installed-commit marker", async (t) => {
  const context = await createRepository(t);
  await context.advance({ version: "1.1.0", marker: "managed-v2" });
  const result = await runGitUpdate({
    repository,
    sourceRoot: context.sourceRoot,
    installedRoot: context.installedRoot,
    stableBranch: "stable",
    stateDir: context.stateDir,
    validateCandidate: async () => ({ ok: true }),
    activateRuntime: async () => {
      throw new Error("simulated activation failure");
    },
    now: () => new Date("2026-08-12T06:23:00.000Z")
  });

  assert.equal(result.status, "FAILED_SAFE");
  assert.equal(result.stage, "atomic-swap");
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
  const installRecord = JSON.parse(await fs.readFile(path.join(context.stateDir, "git-install.json"), "utf8"));
  assert.equal(installRecord.commit, context.firstCommit);
});

test("git-update CLI queues a strict incident for candidate test failure and exits zero with the current runtime intact", async (t) => {
  const context = await createRepository(t);
  const actual = "a".repeat(64);
  const expected = "b".repeat(64);
  const failingScript = `node -e "console.log('ℹ tests 1\\nℹ pass 0\\nℹ fail 1\\n✖ candidate contract fails\\nAssertionError [ERR_ASSERTION]\\nactual: ${actual}\\nexpected: ${expected}');process.exit(1)"`;
  const candidateCommit = await context.advance({
    version: "1.1.0",
    marker: "managed-v2",
    testScript: failingScript
  });
  const { stdout } = await execFileAsync(process.execPath, ["src/cli/git-update.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      AUTOPILOT_STATE_DIR: context.stateDir,
      INNER_SIGNAL_GIT_INSTALL_ROOT: context.installedRoot,
      INNER_SIGNAL_GIT_SOURCE: context.sourceRoot,
      INNER_SIGNAL_GIT_AUTO_UPDATE: "true",
      INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true"
    }
  });

  const result = JSON.parse(stdout);
  assert.equal(result.status, "FAILED_SAFE");
  assert.equal(result.candidateCommit, candidateCommit);
  assert.match(result.incidentId, /^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v1\n");
  const status = JSON.parse(await fs.readFile(path.join(context.stateDir, "git-update-status.json"), "utf8"));
  assert.equal(status.status, "failed-safe");
  assert.equal(status.candidateCommit, candidateCommit);
  const outbox = await fs.readdir(path.join(context.stateDir, "diagnostic-outbox"));
  assert.deepEqual(outbox, [`${result.incidentId}.json`]);
  const body = await fs.readFile(path.join(context.stateDir, "diagnostic-outbox", outbox[0]), "utf8");
  assert.match(body, /candidate contract fails|ERR_ASSERTION/);
  assert.doesNotMatch(body, /PRIVATE_|\/home\//);
});

test("git-update CLI exits 10 only after installing a verified stable commit", async (t) => {
  const context = await createRepository(t);
  const candidateCommit = await context.advance({ version: "1.1.0", marker: "managed-v2" });
  let failure;
  try {
    await execFileAsync(process.execPath, ["src/cli/git-update.mjs"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        AUTOPILOT_STATE_DIR: context.stateDir,
        INNER_SIGNAL_GIT_INSTALL_ROOT: context.installedRoot,
        INNER_SIGNAL_GIT_SOURCE: context.sourceRoot,
        INNER_SIGNAL_GIT_AUTO_UPDATE: "true",
        INNER_SIGNAL_GIT_AUTO_DIAGNOSTICS: "true"
      }
    });
  } catch (error) {
    failure = error;
  }

  assert.equal(failure?.code, 10);
  const result = JSON.parse(failure.stdout);
  assert.equal(result.status, "UPDATED");
  assert.equal(result.installedCommit, candidateCommit);
  assert.equal(await fs.readFile(path.join(context.installedRoot, "src/managed.txt"), "utf8"), "managed-v2\n");
  const status = JSON.parse(await fs.readFile(path.join(context.stateDir, "git-update-status.json"), "utf8"));
  assert.equal(status.status, "updated");
  assert.equal(status.installedCommit, candidateCommit);
});
