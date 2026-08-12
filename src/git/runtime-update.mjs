import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { runSubprocess } from "../core/subprocess.mjs";
import { summarizeTestFailure } from "../diagnostics/test-failure-summary.mjs";
import { validateGitAutomationRoots } from "./automation-config.mjs";

const GIT_SHA = /^[a-f0-9]{40}$/i;
const BRANCH = /^[A-Za-z0-9._/-]+$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PRESERVED = [".env", ".inner-signal-autopilot", ".inner-signal-dev", "ledgers", "data"];

function validateBranch(value) {
  if (typeof value !== "string"
      || !BRANCH.test(value)
      || value.includes("..")
      || value.includes("//")
      || value.startsWith("/")
      || value.endsWith("/")) {
    throw new TypeError("Invalid Git branch");
  }
}

function validateRepository(value) {
  if (value != null && (typeof value !== "string" || !REPOSITORY.test(value))) {
    throw new TypeError("Invalid GitHub repository");
  }
}

function originMatchesRepository(origin, repository) {
  if (!repository) return true;
  const accepted = new Set([
    `https://github.com/${repository}`,
    `https://github.com/${repository}.git`,
    `git@github.com:${repository}`,
    `git@github.com:${repository}.git`,
    `ssh://git@github.com/${repository}`,
    `ssh://git@github.com/${repository}.git`
  ]);
  if (accepted.has(origin)) return true;
  let local = origin;
  if (origin.startsWith("file://")) {
    try {
      local = new URL(origin).pathname;
    } catch {
      return false;
    }
  }
  const normalized = local.replaceAll("\\", "/").replace(/\/+$/, "");
  return (path.isAbsolute(local) || origin.startsWith("file://"))
    && (normalized.endsWith(`/${repository}`) || normalized.endsWith(`/${repository}.git`));
}

function validateRoot(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} is required`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new TypeError(`${label} cannot be a filesystem root`);
  return resolved;
}

function instant(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("Invalid update timestamp");
  return date;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function execute(run, { command, args, cwd, env, label, timeoutMs = 120_000 }) {
  try {
    return await run({ command, args, cwd, env, label, timeoutMs });
  } catch {
    return { code: 1, signal: null, stdout: "", stderr: "" };
  }
}

async function git(run, sourceRoot, args, label, { timeoutMs = 300_000, env } = {}) {
  return await execute(run, {
    command: "git",
    args: ["-C", sourceRoot, ...args],
    label,
    timeoutMs,
    env
  });
}

async function defaultValidateCandidate({ candidateRoot, env, run }) {
  const tests = await execute(run, {
    command: "npm",
    args: ["test"],
    cwd: candidateRoot,
    env,
    label: "candidate package tests",
    timeoutMs: 900_000
  });
  if (tests.code !== 0) {
    return {
      ok: false,
      stage: "package-tests",
      testSummary: summarizeTestFailure({
        command: "npm test",
        exitCode: tests.code,
        stdout: tests.stdout,
        stderr: tests.stderr,
        projectRoot: candidateRoot
      })
    };
  }

  const graph = await execute(run, {
    command: "npm",
    args: ["run", "graph:test"],
    cwd: candidateRoot,
    env,
    label: "candidate graph regressions",
    timeoutMs: 300_000
  });
  if (graph.code !== 0) {
    return {
      ok: false,
      stage: "graph-regressions",
      testSummary: summarizeTestFailure({
        command: "package tests",
        exitCode: graph.code,
        stdout: graph.stdout,
        stderr: graph.stderr,
        projectRoot: candidateRoot
      })
    };
  }
  return { ok: true };
}

async function copyManagedSource(sourceRoot, targetRoot) {
  await fs.cp(sourceRoot, targetRoot, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter(source) {
      const relative = path.relative(sourceRoot, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return first !== ".git" && !PRESERVED.includes(first);
    }
  });
}

async function restorePreservedState(fromRoot, toRoot, names) {
  for (const name of [...names].reverse()) {
    const source = path.join(fromRoot, name);
    try {
      await fs.lstat(source);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    await fs.rename(source, path.join(toRoot, name));
  }
}

async function movePreservedState(fromRoot, toRoot) {
  const moved = [];
  for (const name of PRESERVED) {
    const source = path.join(fromRoot, name);
    try {
      await fs.lstat(source);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    try {
      await fs.rename(source, path.join(toRoot, name));
      moved.push(name);
    } catch (error) {
      await restorePreservedState(toRoot, fromRoot, moved);
      throw error;
    }
  }
  return moved;
}

async function hashEntry(hash, root, current, relative) {
  const stat = await fs.lstat(current);
  if (stat.isSymbolicLink()) {
    hash.update(`l:${relative}:${stat.mode & 0o777}\0${await fs.readlink(current)}\0`);
    return;
  }
  if (stat.isDirectory()) {
    hash.update(`d:${relative}\0`);
    const entries = (await fs.readdir(current)).sort();
    for (const name of entries) {
      const childRelative = relative ? `${relative}/${name}` : name;
      await hashEntry(hash, root, path.join(current, name), childRelative);
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Unsupported preserved state entry: ${relative}`);
  hash.update(`f:${relative}:${stat.mode & 0o777}:${stat.size}\0`);
  hash.update(await fs.readFile(current));
  hash.update("\0");
}

async function preservedHash(root) {
  const hash = createHash("sha256");
  for (const name of PRESERVED) {
    const target = path.join(root, name);
    try {
      await hashEntry(hash, root, target, name);
    } catch (error) {
      if (error?.code === "ENOENT") hash.update(`missing:${name}\0`);
      else throw error;
    }
  }
  return hash.digest("hex");
}

async function managedTreeHash(root) {
  const hash = createHash("sha256");
  async function visit(current, relative = "") {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const first = childRelative.split("/")[0];
      if (first === ".git" || PRESERVED.includes(first)) continue;
      const child = path.join(current, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${childRelative}\0`);
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isSymbolicLink()) hash.update(await fs.readlink(child));
      else hash.update(await fs.readFile(child));
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function fileSha256(file) {
  try {
    return createHash("sha256").update(await fs.readFile(file)).digest("hex");
  } catch {
    return null;
  }
}

function failedSafe({ checkedAt, stage, installedCommit, availableCommit = null, candidateCommit = null, testSummary = null }) {
  return {
    status: "FAILED_SAFE",
    checkedAt,
    stage,
    installedCommit,
    availableCommit,
    candidateCommit,
    actionCode: "KEEP_CURRENT_RUNTIME",
    testSummary,
    integrity: null
  };
}

export async function runGitUpdate({
  repository = null,
  sourceRoot: sourceRootInput,
  installedRoot: installedRootInput,
  stableBranch,
  stateDir: stateDirInput,
  run = runSubprocess,
  validateCandidate = defaultValidateCandidate,
  beforeStateTransfer = null,
  activateRuntime = fs.rename,
  fetchTimeoutMs = 15_000,
  now = () => new Date()
}) {
  validateBranch(stableBranch);
  validateRepository(repository);
  const sourceRoot = validateRoot(sourceRootInput, "sourceRoot");
  const installedRoot = validateRoot(installedRootInput, "installedRoot");
  const stateDir = validateRoot(stateDirInput, "stateDir");
  validateGitAutomationRoots({ sourceRoot, installedRoot, stateDir });
  if (beforeStateTransfer !== null && typeof beforeStateTransfer !== "function") {
    throw new TypeError("beforeStateTransfer must be a function");
  }
  if (typeof activateRuntime !== "function") throw new TypeError("activateRuntime must be a function");
  if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs < 1 || fetchTimeoutMs > 15_000) {
    throw new TypeError("fetchTimeoutMs must be an integer from 1 through 15000");
  }
  const checkedDate = instant(now);
  const checkedAt = checkedDate.toISOString();
  const priorInstall = await readJson(path.join(stateDir, "git-install.json"));
  const priorCommit = GIT_SHA.test(priorInstall?.commit ?? "") ? priorInstall.commit : null;

  try {
    await fs.access(sourceRoot);
  } catch {
    return {
      status: "DEFERRED",
      checkedAt,
      stage: "source-checkout",
      installedCommit: priorCommit,
      availableCommit: null,
      candidateCommit: null,
      actionCode: "KEEP_CURRENT_RUNTIME",
      testSummary: null,
      integrity: priorInstall?.integrity ?? null
    };
  }

  const origin = await git(run, sourceRoot, ["remote", "get-url", "origin"], "Git origin check");
  if (origin.code !== 0 || !origin.stdout.trim()) {
    return failedSafe({ checkedAt, stage: "fetch", installedCommit: priorCommit });
  }
  if (!originMatchesRepository(origin.stdout.trim(), repository)) {
    return failedSafe({ checkedAt, stage: "origin-identity", installedCommit: priorCommit });
  }
  const sourceStatus = await git(
    run,
    sourceRoot,
    ["status", "--porcelain=v1", "--untracked-files=no"],
    "Git source status"
  );
  if (sourceStatus.code !== 0 || sourceStatus.stdout.trim()) {
    return failedSafe({ checkedAt, stage: "source-dirty", installedCommit: priorCommit });
  }
  const fetched = await git(
    run,
    sourceRoot,
    ["fetch", "--prune", "origin", stableBranch],
    "Git stable fetch",
    {
      timeoutMs: fetchTimeoutMs,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      }
    }
  );
  if (fetched.code !== 0) return failedSafe({ checkedAt, stage: "fetch", installedCommit: priorCommit });
  const resolved = await git(run, sourceRoot, ["rev-parse", `refs/remotes/origin/${stableBranch}`], "Git stable resolve");
  const candidateCommit = resolved.stdout.trim();
  if (resolved.code !== 0 || !GIT_SHA.test(candidateCommit)) {
    return failedSafe({ checkedAt, stage: "fetch", installedCommit: priorCommit });
  }
  if (candidateCommit === priorCommit) {
    return {
      status: "CURRENT",
      checkedAt,
      stage: "current",
      installedCommit: priorCommit,
      availableCommit: candidateCommit,
      candidateCommit,
      actionCode: "NONE",
      testSummary: null,
      integrity: priorInstall?.integrity ?? null
    };
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-git-update-"));
  const candidateRoot = path.join(temporaryRoot, "candidate");
  const validationRoot = path.join(temporaryRoot, "empty-state");
  const validationState = path.join(validationRoot, "autopilot");
  const validationGuides = path.join(validationRoot, "guide-packets");
  const stagingRoot = path.join(
    path.dirname(installedRoot),
    `.${path.basename(installedRoot)}.stage-${process.pid}-${checkedDate.getTime()}`
  );
  let worktreeAdded = false;
  let stagingMoved = false;

  try {
    await fs.mkdir(validationState, { recursive: true, mode: 0o700 });
    await fs.mkdir(validationGuides, { recursive: true, mode: 0o700 });
    await fs.rm(stagingRoot, { recursive: true, force: true });
    const worktree = await git(
      run,
      sourceRoot,
      ["worktree", "add", "--detach", candidateRoot, candidateCommit],
      "Git candidate worktree"
    );
    if (worktree.code !== 0) {
      return failedSafe({ checkedAt, stage: "candidate-checkout", installedCommit: priorCommit, availableCommit: candidateCommit, candidateCommit });
    }
    worktreeAdded = true;
    await copyManagedSource(candidateRoot, stagingRoot);

    const validationEnv = {
      ...process.env,
      AUTOPILOT_STATE_DIR: validationState,
      GUIDE_PACKET_ROOT: validationGuides,
      LEDGER_DIR: path.join(validationRoot, "ledgers"),
      DEV_CANDIDATE_ROOT: path.join(validationRoot, "development-candidates"),
      DEV_JOB_ROOT: path.join(validationRoot, "development-jobs"),
      DEV_PROMOTION_MARKER: path.join(validationRoot, "promotion-ready.json")
    };
    let validation;
    try {
      validation = await validateCandidate({ candidateRoot: stagingRoot, env: validationEnv, run });
    } catch {
      validation = { ok: false, stage: "validation", testSummary: null };
    }
    if (validation?.ok !== true) {
      return failedSafe({
        checkedAt,
        stage: validation?.stage ?? "validation",
        installedCommit: priorCommit,
        availableCommit: candidateCommit,
        candidateCommit,
        testSummary: validation?.testSummary ?? null
      });
    }

    // Validation runs on a disposable copy. Rebuild staging from the exact
    // detached commit so test artifacts or generated timestamps cannot become
    // part of the installed runtime.
    await fs.rm(stagingRoot, { recursive: true, force: true });
    await copyManagedSource(candidateRoot, stagingRoot);

    const beforeStateHash = await preservedHash(installedRoot);
    if (beforeStateTransfer) await beforeStateTransfer({ installedRoot, stateDir });
    const integrity = {
      runtimeTreeSha256: await managedTreeHash(stagingRoot),
      graphBundleSha256: await fileSha256(path.join(stagingRoot, "guide-graphs/compiled/bundle.json"))
    };
    const installRecord = {
      format: "inner-signal-git-install-v1",
      branch: stableBranch,
      commit: candidateCommit,
      installedAt: checkedAt,
      integrity
    };

    const rollbackRoot = path.join(
      path.dirname(installedRoot),
      `.${path.basename(installedRoot)}.rollback-${process.pid}-${checkedDate.getTime()}`
    );
    let oldRuntimeMoved = false;
    let movedState = [];
    try {
      await fs.rm(rollbackRoot, { recursive: true, force: true });
      try {
        await fs.rename(installedRoot, rollbackRoot);
        oldRuntimeMoved = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (oldRuntimeMoved) movedState = await movePreservedState(rollbackRoot, stagingRoot);
      const stagedStateHash = await preservedHash(stagingRoot);
      if (stagedStateHash !== beforeStateHash) {
        if (oldRuntimeMoved) {
          await restorePreservedState(stagingRoot, rollbackRoot, movedState);
          movedState = [];
          await fs.rename(rollbackRoot, installedRoot);
          oldRuntimeMoved = false;
        }
        return failedSafe({
          checkedAt,
          stage: "state-overlay",
          installedCommit: priorCommit,
          availableCommit: candidateCommit,
          candidateCommit
        });
      }
      try {
        await activateRuntime(stagingRoot, installedRoot);
        stagingMoved = true;
      } catch (error) {
        throw error;
      }
    } catch {
      if (oldRuntimeMoved) {
        await restorePreservedState(stagingRoot, rollbackRoot, movedState).catch(() => {});
        await fs.rename(rollbackRoot, installedRoot).catch(() => {});
        oldRuntimeMoved = false;
      }
      return failedSafe({
        checkedAt,
        stage: "atomic-swap",
        installedCommit: priorCommit,
        availableCommit: candidateCommit,
        candidateCommit
      });
    }
    try {
      await atomicJson(path.join(stateDir, "git-install.json"), installRecord);
    } catch {
      if (oldRuntimeMoved) {
        const newRuntime = `${stagingRoot}.marker-failed`;
        let restored = false;
        try {
          await fs.rename(installedRoot, newRuntime);
          await movePreservedState(newRuntime, rollbackRoot);
          await fs.rename(rollbackRoot, installedRoot);
          restored = true;
        } catch {
          // Keep every remaining tree in place for deterministic local recovery.
        }
        if (restored) {
          await fs.rm(newRuntime, { recursive: true, force: true }).catch(() => {});
          stagingMoved = false;
        }
      } else {
        await fs.rm(installedRoot, { recursive: true, force: true }).catch(() => {});
        stagingMoved = false;
      }
      return failedSafe({
        checkedAt,
        stage: "install-record",
        installedCommit: priorCommit,
        availableCommit: candidateCommit,
        candidateCommit
      });
    }
    if (oldRuntimeMoved) await fs.rm(rollbackRoot, { recursive: true, force: true }).catch(() => {});

    return {
      status: "UPDATED",
      checkedAt,
      stage: "installed",
      installedCommit: candidateCommit,
      availableCommit: candidateCommit,
      candidateCommit,
      actionCode: "RESTART_RUNTIME",
      testSummary: null,
      integrity
    };
  } finally {
    if (!stagingMoved) await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    if (worktreeAdded) {
      await git(run, sourceRoot, ["worktree", "remove", "--force", candidateRoot], "Git candidate cleanup");
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}
