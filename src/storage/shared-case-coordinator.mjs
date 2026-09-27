import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ValidationError } from "../core/errors.mjs";

const coordinatorRegistry = new Map();

function ensureAbsoluteRoot(rootDir) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    throw new ValidationError("Private root must be an absolute path.");
  }
  return path.resolve(rootDir);
}

export function createCaseMutationCoordinator() {
  const tails = new Map();
  let closed = false;
  return Object.freeze({
    async run(caseId, operation) {
      if (closed) throw new ValidationError("Case mutation coordinator is closed.");
      if (typeof caseId !== "string" || !caseId || typeof operation !== "function") {
        throw new ValidationError("Case mutation coordination input is invalid.");
      }
      const previousTail = tails.get(caseId) ?? Promise.resolve();
      let release;
      const currentTail = new Promise((resolve) => { release = resolve; });
      tails.set(caseId, currentTail);
      await previousTail;
      try { return await operation(); }
      finally {
        release();
        if (tails.get(caseId) === currentTail) tails.delete(caseId);
      }
    },
    get pendingCaseCount() { return tails.size; },
    close() { closed = true; }
  });
}

export function getSharedCaseMutationCoordinator(rootDir) {
  const root = ensureAbsoluteRoot(rootDir);
  let coordinator = coordinatorRegistry.get(root);
  if (!coordinator) {
    coordinator = createCaseMutationCoordinator();
    coordinatorRegistry.set(root, coordinator);
  }
  return coordinator;
}

async function assertPrivateRoot(rootDir) {
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(rootDir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new ValidationError("Private root must be a real directory.");
  await fs.chmod(rootDir, 0o700);
}

/**
 * Acquire a Linux flock on an inherited descriptor. Linux associates flock locks
 * with the shared open-file description, so the lock remains held by lockHandle
 * after the short-lived flock process exits and is released when lockHandle closes.
 * The file itself is only an inode anchor and is never interpreted as a PID/lease.
 */
export async function acquirePrivateRootWriterLock({ rootDir, flockCommand = "flock" } = {}) {
  const root = ensureAbsoluteRoot(rootDir);
  await assertPrivateRoot(root);
  const lockPath = path.join(root, ".journal-writer.lock");
  const lockHandle = await fs.open(lockPath, "a", 0o600);
  await lockHandle.chmod(0o600);
  const child = spawn(flockCommand, ["--exclusive", "--nonblock", "3"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe", lockHandle.fd]
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { if (stderr.length < 2_000) stderr += chunk; });
  try {
    const acquired = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ValidationError("Private root writer lock timed out.", { code: "PRIVATE_ROOT_LOCK_TIMEOUT" })), 5_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
    if (acquired !== true) {
      throw new ValidationError("Private root already has an active writer.", {
        code: "PRIVATE_ROOT_WRITER_ACTIVE",
        details: stderr ? "lock command rejected acquisition" : undefined
      });
    }
  } catch (error) {
    child.kill("SIGTERM");
    await lockHandle.close().catch(() => {});
    throw error;
  }
  let released = false;
  return Object.freeze({
    rootDir: root,
    lockPath,
    async release() {
      if (released) return;
      released = true;
      await lockHandle.close();
    }
  });
}
