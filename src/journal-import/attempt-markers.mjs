import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { assertJournalWorkExchangeRoot, journalWorkFileKey } from "./work-exchange.mjs";

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const HARDEST_ATTEMPT_EXHAUSTED = "JOURNAL_HARDEST_ATTEMPT_EXHAUSTED";

export function journalAttemptIdentity(record) {
  if (!/^[0-9a-f]{48}$/u.test(record?.attempt_identity ?? "")) fail("JOURNAL_WORK_ATTEMPT_IDENTITY_REQUIRED");
  return record.attempt_identity;
}

// Preserve marker filenames from before explicit dispatch identities were added.
export const journalAttemptMarkerKey = identity => journalWorkFileKey(`journal-work:${identity}`);

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function writeAttemptMarker(marker, value, exclusive = false) {
  const target = `${marker}.${randomUUID()}.tmp`;
  const handle = await fs.open(target, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  catch (error) { await handle.close(); await fs.unlink(target).catch(() => {}); throw error; }
  await handle.close();
  try {
    if (exclusive) await fs.link(target, marker);
    else await fs.rename(target, marker);
  } finally { await fs.unlink(target).catch(error => { if (error?.code !== "ENOENT") throw error; }); }
  await syncDirectory(path.dirname(marker));
}

export async function releaseAttemptMarker(marker, claim) {
  const temporary = `${marker}.${randomUUID()}.tmp`;
  try { await fs.rename(marker, temporary); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  try {
    const value = JSON.parse(await fs.readFile(temporary, "utf8"));
    if (value.claim !== claim || value.status !== "reserved" || value.model_reached === true || value.packet_fetched === true) {
      fail("JOURNAL_WORK_ATTEMPT_INVALID");
    }
  } catch (error) {
    try { await fs.link(temporary, marker); }
    catch (restoreError) { if (restoreError?.code !== "EEXIST") throw restoreError; }
    throw error;
  } finally {
    await fs.unlink(temporary);
    await syncDirectory(path.dirname(marker));
  }
}

export async function attemptDirectory(root) {
  await assertJournalWorkExchangeRoot(root);
  const directory = path.join(root, "claude-attempts");
  await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error?.code !== "EEXIST") throw error; });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700
    || (process.getuid && info.uid !== process.getuid()) || await fs.realpath(directory) !== directory) {
    fail("JOURNAL_WORK_ATTEMPT_DIR_INSECURE");
  }
  for (const name of await fs.readdir(directory)) {
    if (!/^[0-9a-f]{64}\.json\.[0-9a-f-]{36}\.tmp$/u.test(name)) continue;
    const target = path.join(directory, name);
    try {
      const entry = await fs.lstat(target);
      if (entry.isFile() && entry.mtimeMs < Date.now() - 3_600_000) await fs.unlink(target);
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return directory;
}

export async function readJournalAttemptMarker(root, identity) {
  journalAttemptIdentity({ attempt_identity: identity });
  const directory = await attemptDirectory(root);
  const marker = path.join(directory, `${journalAttemptMarkerKey(identity)}.json`);
  let status = null, ageSeconds = null;
  try {
    // Age and bytes come from the same no-follow handle.
    const handle = await fs.open(marker, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) fail("JOURNAL_WORK_ATTEMPT_INVALID");
      ageSeconds = Math.max(0, (Date.now() - info.mtimeMs) / 1000);
      try { status = info.size <= 4096 ? JSON.parse(await handle.readFile("utf8")) : null; } catch { /* held below */ }
    } finally { await handle.close(); }
    const legacy = /^journal-work:([0-9a-f]{48})(?::r[1-8])?$/u.exec(status?.work_id ?? "")?.[1];
    if (!status || (status.attempt_identity ?? legacy) !== identity
      || !["reserved", "attempted", "isolation_refused"].includes(status.status)
      || !/^[0-9a-f-]{36}$/u.test(status.claim ?? "")
      || ["packet_fetched", "model_reached"].some(field => status[field] !== undefined && typeof status[field] !== "boolean")
      || (status.timeout_ms !== undefined && (!Number.isSafeInteger(status.timeout_ms)
        || status.timeout_ms < 1 || status.timeout_ms > 3_600_000))) status = { status: "attempted" };
    else status.attempt_identity = identity;
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return { directory, marker, status, ageSeconds };
}

export const journalAttemptConsumed = status => status?.status === "attempted" || status?.status === "isolation_refused"
  || status?.packet_fetched === true || status?.model_reached === true;

// Serialize host read/modify/write operations across the worker CLI and stdio
// server. flock releases on a crash; atomic rewrites keep unlocked readers safe.
export async function withJournalAttemptLock(root, action) {
  await assertJournalWorkExchangeRoot(root);
  const lock = path.join(root, ".claude-attempt.lock");
  const handle = await fs.open(lock, fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
  await handle.close();
  const child = spawn("flock", ["-x", lock, "sh", "-c", "printf 'ready\\n'; cat >/dev/null"],
    { stdio: ["pipe", "pipe", "ignore"] });
  try {
    await new Promise((resolve, reject) => {
      let ready = false;
      child.stdout.once("data", () => { ready = true; resolve(); });
      child.once("error", reject);
      child.once("close", () => { if (!ready) reject(Object.assign(new Error("JOURNAL_WORK_ATTEMPT_LOCK_FAILED"), { code: "JOURNAL_WORK_ATTEMPT_LOCK_FAILED" })); });
    });
    return await action();
  } finally {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once("close", resolve));
  }
}

export async function markJournalAttemptPacketFetched(root, record) {
  const identity = journalAttemptIdentity(record);
  await withJournalAttemptLock(root, async () => {
    const { marker, status } = await readJournalAttemptMarker(root, identity);
    // A served packet must remain held even if a caller did not reserve first.
    const value = status ?? { work_id: record.work_id, attempt_identity: identity,
      status: "reserved", claim: randomUUID(), timeout_ms: 1_800_000 };
    await writeAttemptMarker(marker, { ...value, packet_fetched: true });
  });
}
