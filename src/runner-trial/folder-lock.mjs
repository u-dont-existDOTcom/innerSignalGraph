import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RuntimeError } from "../core/errors.mjs";

// The runner trial folder's one lock (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, "As built"; Codex's reviews 1
// to 4). Held by a start (from making its tokens until its server answers), by --add-client, --journal-consent and the journal commands
// (scripts/runner-trial-journal.mjs) while they change the credentials, the client list or a client's journal folder, by the cold test
// for each reading of the consent before a packet, and by the trial's server for each output to the person (a provisional reply, a
// delivery) in a case that has read its client's journal, from its gate check to the output, and for a client's deletion. So no command
// writes over another's change, and a withdrawal of a journal consent lands wholly before such an output or reading (which then stops)
// or wholly after it.
//
// The lock is never taken over: one left by a process that ended without finishing is reported, for the owner to remove by hand once
// no runner-trial command runs, so two waiters can't both decide to take it over. Its holder removes only its own lock. A lock file
// that's gone when its holder lets go is let go; one that can't be looked at or removed is an error of the release, never a quiet
// success (GPT's third review of the copy step): Delete names the lock among what it left, and a command says the lock was left. A
// waiter tries again every few milliseconds, up to `waitMs`.

export const TRIAL_FOLDER_LOCK_FILE = ".trial-folder.lock";
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export class TrialFolderLockError extends RuntimeError {
  constructor(message, code, lockPath) {
    super(message, { code });
    this.lockPath = lockPath;
  }
}

const lockLeft = (lock) => new TrialFolderLockError(`A runner-trial command ended without finishing and left its lock. If no other runner-trial command is running, remove ${lock} and try again.`, "RUNNER_FOLDER_LOCK_LEFT", lock);

// What is at a path, or null when nothing is. Any other failure is the caller's to tell.
async function lstatOrNull(file) {
  try { return await fs.lstat(file); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function holderState(lock) {
  const [pidText] = (await fs.readFile(lock, "utf8").catch(() => "")).trim().split(/\s+/u);
  const holder = Number(pidText);
  if (!Number.isSafeInteger(holder) || holder <= 0) return "being_taken";
  try { process.kill(holder, 0); return "held"; }
  catch (probe) { return probe?.code === "ESRCH" ? "ended" : "held"; }
}

export async function acquireTrialFolderLock(home, { pid = process.pid, waitMs = 0, retryMs = 15 } = {}) {
  const lock = path.join(home, TRIAL_FOLDER_LOCK_FILE);
  const token = randomUUID();
  const deadline = Date.now() + Math.max(0, waitMs);
  let handle = null;
  for (;;) {
    try { handle = await fs.open(lock, "wx", 0o600); break; }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await holderState(lock) === "ended") throw lockLeft(lock);
      if (Date.now() >= deadline) {
        throw new TrialFolderLockError("Another runner-trial command is changing the trial folder (a start, --add-client or --journal-consent), or the trial is showing a reply. Try again when it has finished.", "RUNNER_FOLDER_LOCKED", lock);
      }
      await pause(retryMs);
    }
  }
  // Only the file this call created is removed, known by its identity (device and inode) while it's still open (so no other file can
  // have the same): a first write that failed (an empty file after a full disk) doesn't leave the lock behind, and another holder's
  // lock is never touched (Codex's review 5).
  const created = await handle.stat();
  const remove = async () => {
    try {
      const there = await lstatOrNull(lock);
      if (there && there.dev === created.dev && there.ino === created.ino) await fs.rm(lock, { force: true });
    } finally {
      await handle.close().catch(() => {});
    }
  };
  try {
    await handle.writeFile(`${pid} ${token}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    // What stopped it is what's told.
    await remove().catch(() => {});
    throw error;
  }
  let released = false;
  return Object.freeze({ async release() { if (released) return; released = true; await remove(); } });
}

// An operation under the lock. What stopped the operation is what's told, whether or not the lock could be let go; after one that
// finished, a lock that couldn't be is told as one left behind.
export async function withTrialFolderLock(home, operation, options = {}) {
  const held = await acquireTrialFolderLock(home, options);
  let result;
  try { result = await operation(); } catch (error) {
    await held.release().catch(() => {});
    throw error;
  }
  try { await held.release(); } catch { throw lockLeft(path.join(home, TRIAL_FOLDER_LOCK_FILE)); }
  return result;
}
