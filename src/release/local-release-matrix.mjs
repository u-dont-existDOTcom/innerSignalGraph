import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runGitUpdate } from "../git/runtime-update.mjs";
import { loadConfig } from "../core/config.mjs";
import { createProviders } from "../providers/factory.mjs";
import { listenInnerSignalLoopback } from "../server/listen-loopback.mjs";
import { launchBrowser } from "./browser-launcher.mjs";
import {
  RECOMMENDED_NODE_VERSION,
  SUPPORTED_NODE_RANGE,
  evaluateNodeRuntime
} from "./runtime-requirements.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY = "u-dont-existDOTcom/innerSignalGraph";
const SENTINELS = Object.freeze({
  ".env": "PRIVATE_ENV_SENTINEL=byte-exact\n",
  ".inner-signal-autopilot/private-state.bin": "autopilot-private-byte-sentinel\u0000\n",
  ".inner-signal-dev/job.json": "{\"private\":\"development-sentinel\"}\n",
  "ledgers/local.json": "{\"private\":\"ledger-sentinel\"}\n",
  "data/user.db": "data-byte-sentinel\u0000\n"
});

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Inner Signal Release Matrix",
  GIT_AUTHOR_EMAIL: "release-matrix@example.invalid",
  GIT_COMMITTER_NAME: "Inner Signal Release Matrix",
  GIT_COMMITTER_EMAIL: "release-matrix@example.invalid"
};

async function git(cwd, args, date = null) {
  const env = date ? { ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : gitEnv;
  const { stdout } = await execFileAsync("git", args, { cwd, env });
  return stdout.trim();
}

async function writeManagedTree(root, { version, marker }) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "inner-signal-release-matrix-fixture",
    version,
    private: true,
    type: "module"
  }, null, 2)}\n`);
  await fs.writeFile(path.join(root, "src", "managed.txt"), `${marker}\n`);
  await fs.writeFile(path.join(root, "run-autopilot.sh"), `#!/usr/bin/env bash\nprintf '%s\\n' '${marker}'\n`, { mode: 0o755 });
}

async function createLocalGitFixture(root) {
  const remoteRoot = path.join(root, "u-dont-existDOTcom", "innerSignalGraph.git");
  const authorRoot = path.join(root, "author");
  const sourceRoot = path.join(root, "source");
  const installedRoot = path.join(root, "installed-runtime");
  const stateDir = path.join(installedRoot, ".inner-signal-autopilot");
  await fs.mkdir(path.dirname(remoteRoot), { recursive: true });
  await git(root, ["init", "--bare", remoteRoot]);
  await git(root, ["init", "-b", "stable", authorRoot]);

  async function commitVersion({ version, marker, date }) {
    await writeManagedTree(authorRoot, { version, marker });
    await git(authorRoot, ["add", "."]);
    await git(authorRoot, ["commit", "-m", `fixture ${version}`], date);
    await git(authorRoot, ["push", "origin", "stable"]);
    return await git(authorRoot, ["rev-parse", "HEAD"]);
  }

  await git(authorRoot, ["remote", "add", "origin", remoteRoot]);
  const firstCommit = await commitVersion({
    version: "1.0.0",
    marker: "managed-v1",
    date: "2026-08-31T01:00:00Z"
  });
  await git(remoteRoot, ["symbolic-ref", "HEAD", "refs/heads/stable"]);
  await git(root, ["clone", remoteRoot, sourceRoot]);

  return {
    sourceRoot,
    installedRoot,
    stateDir,
    firstCommit,
    async advance(version, marker, date) {
      return await commitVersion({ version, marker, date });
    }
  };
}

async function writeSentinels(installedRoot) {
  for (const [relative, contents] of Object.entries(SENTINELS)) {
    const target = path.join(installedRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
}

async function sentinelHashes(installedRoot) {
  const result = {};
  for (const relative of Object.keys(SENTINELS).sort()) {
    const bytes = await fs.readFile(path.join(installedRoot, relative));
    result[relative] = createHash("sha256").update(bytes).digest("hex");
  }
  return result;
}

async function readInstalledRecord(stateDir) {
  return JSON.parse(await fs.readFile(path.join(stateDir, "git-install.json"), "utf8"));
}

async function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The fake browser did not record its invocation.");
}

async function exerciseUpdater(root) {
  const fixture = await createLocalGitFixture(path.join(root, "git-matrix"));
  const common = {
    repository: REPOSITORY,
    sourceRoot: fixture.sourceRoot,
    installedRoot: fixture.installedRoot,
    stableBranch: "stable",
    stateDir: fixture.stateDir,
    validateCandidate: async () => ({ ok: true })
  };

  const clean = await runGitUpdate({
    ...common,
    now: () => new Date("2026-08-31T01:10:00.000Z")
  });
  const cleanRecord = await readInstalledRecord(fixture.stateDir);
  const cleanInstall = {
    ok: clean.status === "UPDATED"
      && clean.installedCommit === fixture.firstCommit
      && cleanRecord.commit === fixture.firstCommit
      && await fs.readFile(path.join(fixture.installedRoot, "src", "managed.txt"), "utf8") === "managed-v1\n",
    status: clean.status,
    stage: clean.stage,
    installedCommit: clean.installedCommit,
    sourceKind: "isolated-local-bare-git",
    dependencyNetworkUsed: false
  };

  await writeSentinels(fixture.installedRoot);
  const beforePrivate = await sentinelHashes(fixture.installedRoot);
  const secondCommit = await fixture.advance("1.1.0", "managed-v2", "2026-08-31T01:20:00Z");
  const updated = await runGitUpdate({
    ...common,
    now: () => new Date("2026-08-31T01:30:00.000Z")
  });
  const afterPrivate = await sentinelHashes(fixture.installedRoot);
  const preserved = JSON.stringify(beforePrivate) === JSON.stringify(afterPrivate);
  const secondRecord = await readInstalledRecord(fixture.stateDir);

  const thirdCommit = await fixture.advance("1.2.0", "managed-v3", "2026-08-31T01:40:00Z");
  const activationFailure = await runGitUpdate({
    ...common,
    activateRuntime: async () => { throw new Error("release-matrix activation failure"); },
    now: () => new Date("2026-08-31T01:50:00.000Z")
  });
  const activationRecord = await readInstalledRecord(fixture.stateDir);
  const activationPrivate = await sentinelHashes(fixture.installedRoot);
  const activationRestored = activationFailure.status === "FAILED_SAFE"
    && activationFailure.stage === "atomic-swap"
    && activationRecord.commit === secondCommit
    && await fs.readFile(path.join(fixture.installedRoot, "src", "managed.txt"), "utf8") === "managed-v2\n"
    && JSON.stringify(activationPrivate) === JSON.stringify(afterPrivate);

  const recordFailureMarker = path.join(fixture.stateDir, `git-install.json.${process.pid}.tmp`);
  await fs.mkdir(recordFailureMarker);
  const installRecordFailure = await runGitUpdate({
    ...common,
    now: () => new Date("2026-08-31T02:00:00.000Z")
  });
  const restoredRecord = await readInstalledRecord(fixture.stateDir);
  const restoredPrivate = await sentinelHashes(fixture.installedRoot);
  const installRecordRestored = installRecordFailure.status === "FAILED_SAFE"
    && installRecordFailure.stage === "install-record"
    && restoredRecord.commit === secondCommit
    && await fs.readFile(path.join(fixture.installedRoot, "src", "managed.txt"), "utf8") === "managed-v2\n"
    && JSON.stringify(restoredPrivate) === JSON.stringify(afterPrivate);

  return {
    cleanInstall,
    update: {
      ok: updated.status === "UPDATED" && updated.installedCommit === secondCommit && secondRecord.commit === secondCommit,
      privateStateByteHashesPreserved: preserved,
      sentinelHashes: afterPrivate
    },
    rollback: {
      ok: activationRestored && installRecordRestored,
      priorRuntimeCommit: secondCommit,
      rejectedCandidateCommit: thirdCommit,
      activationFailure: {
        status: activationFailure.status,
        stage: activationFailure.stage,
        priorRuntimeRestored: activationRestored
      },
      installRecordFailure: {
        status: installRecordFailure.status,
        stage: installRecordFailure.stage,
        priorRuntimeRestored: installRecordRestored
      },
      privateStateByteHashesPreserved: JSON.stringify(restoredPrivate) === JSON.stringify(afterPrivate)
    }
  };
}

async function exerciseLoopbackAndBrowser(root) {
  const stateRoot = path.join(root, "loopback-state");
  const config = loadConfig({
    mode: "mock",
    port: 0,
    ledgerMode: "off",
    devAutomationEnabled: false,
    autopilotStateDir: stateRoot,
    guidePacketRoot: path.join(stateRoot, "guide-packets")
  });
  const listener = await listenInnerSignalLoopback({ config, providers: createProviders(config), port: 0 });
  let healthStatus = null;
  let healthOk = false;
  let browserResult = null;
  let recordedArgs = null;
  try {
    const response = await fetch(`${listener.ipv4Url}/health`);
    healthStatus = response.status;
    healthOk = response.status === 200 && (await response.json()).ok === true;

    const browserBin = path.join(root, "fake-browser-bin");
    const callFile = path.join(root, "fake-browser-call.json");
    const fakeBrowser = path.join(browserBin, "fake-browser");
    await fs.mkdir(browserBin, { recursive: true });
    await fs.writeFile(fakeBrowser, `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(callFile)}, JSON.stringify(process.argv.slice(2)) + "\\n");
`, { mode: 0o755 });
    browserResult = await launchBrowser({
      url: listener.url,
      env: { PATH: browserBin, INNER_SIGNAL_BROWSER_EXECUTABLE: fakeBrowser }
    });
    recordedArgs = JSON.parse(await waitForFile(callFile));
  } finally {
    await listener.close();
  }

  const closed = listener.servers.every((server) => !server.listening);
  const exactReadyUrlReceived = JSON.stringify(recordedArgs) === JSON.stringify([listener.url]);
  const sanitizedReadyUrl = "http://localhost:<ephemeral-port>";
  return {
    loopback: {
      ok: healthOk && closed,
      binding: "ephemeral-loopback-only",
      healthStatus,
      ipv6Optional: true,
      closedDeterministically: closed
    },
    browser: {
      ok: browserResult?.ok === true,
      source: browserResult?.discovery?.source ?? null,
      candidate: browserResult?.discovery?.candidate ? "configured-fake-browser" : null,
      structuredDiscovery: Array.isArray(browserResult?.discovery?.attempts),
      shell: browserResult?.invocation?.shell ?? null,
      argumentCount: browserResult?.invocation?.arguments?.length ?? null
    },
    browserOpen: {
      ok: browserResult?.ok === true
        && exactReadyUrlReceived,
      readyLoopbackUrl: sanitizedReadyUrl,
      receivedArguments: exactReadyUrlReceived ? [sanitizedReadyUrl] : ["unexpected-argument"],
      exactReadyUrlReceived,
      realBrowserLaunched: false
    }
  };
}

export async function runLocalReleaseMatrix() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-local-release-matrix-"));
  try {
    const updater = await exerciseUpdater(root);
    const runtime = await exerciseLoopbackAndBrowser(root);
    const node = {
      ok: evaluateNodeRuntime(process.versions.node).ok,
      current: evaluateNodeRuntime(process.versions.node),
      recommendedVersion: RECOMMENDED_NODE_VERSION,
      supportedRange: SUPPORTED_NODE_RANGE,
      compatibility: {
        node24Patch: evaluateNodeRuntime("24.18.1").ok,
        node23Rejected: !evaluateNodeRuntime("23.99.0").ok,
        node25Rejected: !evaluateNodeRuntime("25.0.0").ok
      }
    };
    const acceptance = {
      nodeMajorCompatibility: node.ok && Object.values(node.compatibility).every(Boolean),
      browserArgumentSafety: runtime.browser.ok && runtime.browser.shell === false,
      cleanInstall: updater.cleanInstall.ok,
      privateStatePreservation: updater.update.ok && updater.update.privateStateByteHashesPreserved,
      rollbackRestoration: updater.rollback.ok,
      loopbackHealthAndClose: runtime.loopback.ok,
      exactReadyUrl: runtime.browserOpen.ok,
      externalNetworkUsed: false,
      realInstallOrBrowserUsed: false
    };
    const ok = Object.entries(acceptance).every(([key, value]) =>
      key === "externalNetworkUsed" || key === "realInstallOrBrowserUsed" ? value === false : value === true
    );
    return {
      format: "inner-signal-local-release-matrix-v1",
      node,
      browser: runtime.browser,
      cleanInstall: updater.cleanInstall,
      rollback: updater.rollback,
      loopback: runtime.loopback,
      browserOpen: runtime.browserOpen,
      acceptance,
      ok
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
