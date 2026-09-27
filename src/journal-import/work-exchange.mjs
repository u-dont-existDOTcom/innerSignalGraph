import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withOpenedRegularFile } from "../core/opened-regular-file.mjs";

// Private journal work exchange between the single-writer import runtime and the private MCP
// connector. The runtime publishes one encrypted work item per role call to outbox/; ChatGPT fetches
// it through the connector, and the connector publishes the validated answer to inbox/ with a
// connector-signed receipt. Neither side ever shares the corpus key, and nothing here logs content.
//
// Files are named by a hash of the work ID, so a watcher can tell whether an answer arrived without
// holding any key. Publication is atomic and first-write-wins (link, never rename over), which makes
// a re-sent work item idempotent: a late answer from an earlier chat can never replace the first.

export const JOURNAL_WORK_EXCHANGE_VERSION = 1;
export const JOURNAL_WORK_TRANSPORT = "chatgpt_connector_tool";
export const JOURNAL_WORK_ID_PATTERN = /^[A-Za-z0-9:_.-]{8,256}$/u;
const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const ROLE_PATTERN = /^[a-z_]{3,40}$/u;
const MAX_WORK_BYTES = 4 * 1024 * 1024;
export const MAX_JOURNAL_RESULT_BYTES = 900_000;
const MAX_INSTRUCTION_BYTES = 256 * 1024;
const TEMPORARY_PREFIX = ".tmp-";
export const STALE_JOURNAL_WORK_TEMPORARY_MS = 60 * 60 * 1000;

export class JournalWorkExchangeError extends Error {
  constructor(code, details = undefined) {
    super(code);
    this.name = "JournalWorkExchangeError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, details) => { throw new JournalWorkExchangeError(code, details); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isoTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function assertJournalWorkId(workId) {
  if (typeof workId !== "string" || !JOURNAL_WORK_ID_PATTERN.test(workId)) fail("JOURNAL_WORK_ID_INVALID");
  return workId;
}

// The real path of p, following symbolic links through its deepest existing ancestor; components
// that do not exist yet are appended unchanged.
async function canonicalPath(p) {
  const missing = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

// Canonicalizes a configured exchange root and refuses one that resolves into `outside` (the public
// checkout), including through a symbolic link. Returns the canonical root to use from then on.
export async function resolveJournalWorkExchangeRoot(root, { outside }) {
  if (typeof root !== "string" || !path.isAbsolute(root)) fail("JOURNAL_WORK_EXCHANGE_ROOT_INVALID");
  const canonical = await canonicalPath(root);
  const relative = path.relative(await canonicalPath(outside), canonical);
  const escapes = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!escapes) fail("JOURNAL_WORK_EXCHANGE_ROOT_INSIDE_REPOSITORY");
  return canonical;
}

const currentUser = () => (typeof process.getuid === "function" ? process.getuid() : null);

// The root must already exist (deployment creates it), be a real directory, be owned by the user
// both processes run as (`owner`; null skips the check where the platform has no user IDs) and grant
// no group or other access. Another local user can then neither read, remove nor block entries.
export async function assertJournalWorkExchangeRoot(root, { owner = currentUser() } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) fail("JOURNAL_WORK_EXCHANGE_ROOT_INVALID");
  let info;
  try {
    info = await fs.lstat(root);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") fail("JOURNAL_WORK_EXCHANGE_ROOT_MISSING");
    throw error;
  }
  if (!info.isDirectory()) fail("JOURNAL_WORK_EXCHANGE_ROOT_INVALID");
  if ((owner !== null && info.uid !== owner) || (info.mode & 0o077) !== 0) fail("JOURNAL_WORK_EXCHANGE_ROOT_INSECURE");
}

// One secret, two independent keys: payload encryption and receipt authentication.
export function deriveJournalWorkExchangeKeys(secret) {
  const raw = Buffer.isBuffer(secret) || secret instanceof Uint8Array
    ? Buffer.from(secret)
    : Buffer.from(typeof secret === "string" ? secret : "", "base64");
  try {
    if (raw.byteLength < 32) fail("JOURNAL_WORK_EXCHANGE_SECRET_INVALID");
    const salt = Buffer.from("inner-signal:journal-work-exchange");
    const derive = (info) => Buffer.from(hkdfSync("sha256", raw, salt, Buffer.from(info), 32));
    return Object.freeze({ encryption: derive("encryption:v1"), receipt: derive("receipt:v1") });
  } finally {
    raw.fill(0);
  }
}

// Public on purpose: a watcher without keys can check for an answer by file name.
export function journalWorkFileKey(workId) {
  return sha256(`inner-signal:journal-work:${assertJournalWorkId(workId)}`);
}

function associatedData(kind, fileKey) {
  return Buffer.from(`inner-signal:journal-work-exchange:v${JOURNAL_WORK_EXCHANGE_VERSION}:${kind}:${fileKey}`, "utf8");
}

function seal(key, kind, fileKey, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData(kind, fileKey));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(`${JSON.stringify({
      v: JOURNAL_WORK_EXCHANGE_VERSION,
      alg: "A256GCM",
      kind,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64")
    })}\n`, "utf8");
  } finally {
    plaintext.fill(0);
  }
}

function open(key, kind, fileKey, bytes) {
  let envelope;
  try { envelope = JSON.parse(bytes.toString("utf8")); }
  catch { fail("JOURNAL_WORK_ENTRY_INVALID"); }
  if (!isPlainObject(envelope) || envelope.v !== JOURNAL_WORK_EXCHANGE_VERSION || envelope.alg !== "A256GCM" || envelope.kind !== kind) {
    fail("JOURNAL_WORK_ENTRY_INVALID");
  }
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
    decipher.setAAD(associatedData(kind, fileKey));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  } catch {
    fail("JOURNAL_WORK_ENTRY_INVALID");
  }
  try { return JSON.parse(plaintext.toString("utf8")); }
  catch { fail("JOURNAL_WORK_ENTRY_INVALID"); }
  finally { plaintext.fill(0); }
}

function canonical(value) {
  return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])));
}

function receiptTag(key, fields) {
  return createHmac("sha256", key).update(canonical(fields)).digest("hex");
}

function validateWorkEntry(entry) {
  if (!isPlainObject(entry) || entry.schema_version !== JOURNAL_WORK_EXCHANGE_VERSION) fail("JOURNAL_WORK_ENTRY_INVALID");
  assertJournalWorkId(entry.work_id);
  if (typeof entry.case_id !== "string" || !CASE_ID_PATTERN.test(entry.case_id)) fail("JOURNAL_WORK_ENTRY_INVALID");
  if (typeof entry.role !== "string" || !ROLE_PATTERN.test(entry.role)) fail("JOURNAL_WORK_ENTRY_INVALID");
  if (typeof entry.instruction !== "string" || entry.instruction.length === 0
    || Buffer.byteLength(entry.instruction, "utf8") > MAX_INSTRUCTION_BYTES) fail("JOURNAL_WORK_ENTRY_INVALID");
  if (!isPlainObject(entry.packet) || !isPlainObject(entry.output_schema)) fail("JOURNAL_WORK_ENTRY_INVALID");
  if (typeof entry.output_schema_name !== "string" || entry.output_schema_name.length === 0) fail("JOURNAL_WORK_ENTRY_INVALID");
  if (entry.expected_generation !== null && typeof entry.expected_generation !== "string") fail("JOURNAL_WORK_ENTRY_INVALID");
  if (!isoTime(entry.issued_at) || !isoTime(entry.expires_at) || Date.parse(entry.expires_at) <= Date.parse(entry.issued_at)) {
    fail("JOURNAL_WORK_ENTRY_INVALID");
  }
  return entry;
}

export function createJournalWorkExchange({
  root,
  secret,
  keys = null,
  dirMode = 0o700,
  fileMode = 0o600,
  owner = currentUser(),
  now = () => new Date()
} = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) fail("JOURNAL_WORK_EXCHANGE_ROOT_INVALID");
  const derived = keys ?? deriveJournalWorkExchangeKeys(secret);
  if (!Buffer.isBuffer(derived?.encryption) || !Buffer.isBuffer(derived?.receipt)) fail("JOURNAL_WORK_EXCHANGE_SECRET_INVALID");
  const directory = (kind) => path.join(root, kind === "work" ? "outbox" : "inbox");
  const fileFor = (kind, fileKey) => path.join(directory(kind), `${fileKey}.json`);

  async function syncPath(dir) {
    const handle = await fs.open(dir, "r");
    try { await handle.sync(); }
    finally { await handle.close(); }
  }

  // A queue is a direct child of the root and must be a real directory, never a symbolic link, so
  // nothing written or removed here can land outside the canonical root. (This guards configuration:
  // a process running as the exchange's user could swap a queue after the check, but it already holds
  // the secret.) Returns false when the queue does not exist yet.
  async function queueExists(kind) {
    let info;
    try {
      info = await fs.lstat(directory(kind));
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (!info.isDirectory()) fail("JOURNAL_WORK_EXCHANGE_QUEUE_INVALID");
    return true;
  }

  // Checks the root (see assertJournalWorkExchangeRoot) and creates the queue if needed. The root is
  // synced on every call, so a queue's own name is durable before anything is written in it,
  // whichever caller or process created the queue.
  async function ensureDirectory(kind) {
    await assertJournalWorkExchangeRoot(root, { owner });
    try {
      await fs.mkdir(directory(kind), { mode: dirMode });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") fail("JOURNAL_WORK_EXCHANGE_ROOT_MISSING");
      if (error?.code !== "EEXIST") throw error;
    }
    await queueExists(kind);
    await syncPath(root);
  }

  // A published or removed entry is durable only once its directory is synced.
  async function syncDirectory(kind) {
    await syncPath(directory(kind));
  }

  // A write that fails (a full disk, an I/O error) removes its partial temporary file before the error
  // propagates, so retries cannot pile them up.
  async function writeTemporary(kind, bytes) {
    const temporary = path.join(directory(kind), `${TEMPORARY_PREFIX}${randomUUID()}`);
    const handle = await fs.open(temporary, "wx", fileMode);
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
    return temporary;
  }

  // Atomic, first-write-wins publication: write a private temporary file, then hard-link it into
  // place. link() fails with EEXIST instead of replacing an existing entry.
  async function publish(kind, fileKey, bytes) {
    await ensureDirectory(kind);
    const temporary = await writeTemporary(kind, bytes);
    try {
      await fs.link(temporary, fileFor(kind, fileKey));
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw error;
    } finally {
      await fs.unlink(temporary).catch(() => {});
      await syncDirectory(kind);
    }
  }

  // Opens without following links and checks the opened file itself, so a path swapped between a
  // check and the read cannot redirect it.
  async function readRegular(kind, fileKey, limit) {
    try {
      return await withOpenedRegularFile(fileFor(kind, fileKey), async (handle, info) => {
        if (info.size > limit) fail("JOURNAL_WORK_ENTRY_INVALID");
        return handle.readFile();
      });
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.code === "ELOOP" || error?.code === "ERR_NOT_REGULAR_FILE") fail("JOURNAL_WORK_ENTRY_INVALID");
      throw error;
    }
  }

  return Object.freeze({
    root,

    // Runtime side: publish one role call. Re-publishing the same work ID keeps the first entry.
    async publishWork(entry) {
      const value = validateWorkEntry(structuredClone(entry));
      const fileKey = journalWorkFileKey(value.work_id);
      const bytes = seal(derived.encryption, "work", fileKey, value);
      if (bytes.byteLength > MAX_WORK_BYTES) fail("JOURNAL_WORK_ENTRY_TOO_LARGE");
      const created = await publish("work", fileKey, bytes);
      return Object.freeze({ fileKey, created });
    },

    // Connector side: read one outstanding work item, or null when there is none.
    async readWork(workId) {
      const fileKey = journalWorkFileKey(workId);
      const bytes = await readRegular("work", fileKey, MAX_WORK_BYTES);
      if (!bytes) return null;
      const entry = validateWorkEntry(open(derived.encryption, "work", fileKey, bytes));
      if (entry.work_id !== workId) fail("JOURNAL_WORK_ENTRY_INVALID");
      return entry;
    },

    isExpired(entry) {
      return Date.parse(entry.expires_at) <= now().getTime();
    },

    async hasResult(workId) {
      try {
        await fs.lstat(fileFor("result", journalWorkFileKey(workId)));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },

    // Connector side: store a validated answer with a receipt the runtime can authenticate.
    // The subject is hashed; the output is never logged or returned.
    async submitResult({ workId, output, subject }) {
      const fileKey = journalWorkFileKey(workId);
      if (!isPlainObject(output)) fail("JOURNAL_WORK_OUTPUT_INVALID");
      const serialized = JSON.stringify(output);
      if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_RESULT_BYTES) fail("JOURNAL_WORK_OUTPUT_TOO_LARGE");
      if (typeof subject !== "string" || subject.length === 0) fail("JOURNAL_WORK_SUBJECT_REQUIRED");
      const fields = {
        receipt_id: `journal-work-receipt:${randomUUID()}`,
        transport: JOURNAL_WORK_TRANSPORT,
        completion_status: "completed",
        work_file_key: fileKey,
        output_sha256: sha256(serialized),
        subject_sha256: sha256(`subject:${subject}`),
        received_at: now().toISOString()
      };
      const receipt = { ...fields, tag: receiptTag(derived.receipt, fields) };
      const stored = await publish("result", fileKey, seal(derived.encryption, "result", fileKey, {
        schema_version: JOURNAL_WORK_EXCHANGE_VERSION,
        work_id: workId,
        output,
        receipt
      }));
      return Object.freeze(stored
        ? { stored: true, already: false, receipt_id: receipt.receipt_id, received_at: receipt.received_at }
        : { stored: true, already: true });
    },

    // Runtime side: read an answer and authenticate its connector receipt. Null when none arrived;
    // { retired: true } once the runtime has consumed the answer and retired the item.
    async readResult(workId) {
      const fileKey = journalWorkFileKey(workId);
      const bytes = await readRegular("result", fileKey, MAX_WORK_BYTES);
      if (!bytes) return null;
      const record = open(derived.encryption, "result", fileKey, bytes);
      if (!isPlainObject(record) || record.schema_version !== JOURNAL_WORK_EXCHANGE_VERSION || record.work_id !== workId) {
        fail("JOURNAL_WORK_RESULT_INVALID");
      }
      if (record.retired === true) return Object.freeze({ retired: true, retired_at: record.retired_at });
      const { tag, ...fields } = record.receipt ?? {};
      if (typeof tag !== "string" || fields.work_file_key !== fileKey || fields.transport !== JOURNAL_WORK_TRANSPORT
        || fields.completion_status !== "completed") fail("JOURNAL_WORK_RESULT_INVALID");
      const expected = Buffer.from(receiptTag(derived.receipt, fields), "hex");
      const actual = Buffer.from(tag, "hex");
      if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) fail("JOURNAL_WORK_RECEIPT_INVALID");
      if (!isPlainObject(record.output) || sha256(JSON.stringify(record.output)) !== fields.output_sha256) fail("JOURNAL_WORK_RESULT_INVALID");
      return Object.freeze({ output: record.output, receipt: Object.freeze({ ...fields, tag }) });
    },

    // Runtime side, after the answer is safely in the encrypted corpus store. The answer is replaced
    // by an encrypted tombstone in one rename, so its name never goes missing: a duplicate submission
    // still in flight finds the name taken and cannot leave a late answer behind. The tombstone holds
    // no answer text. Then the work item is removed, so the connector stops serving it.
    async retireWork(workId) {
      const fileKey = journalWorkFileKey(workId);
      await ensureDirectory("result");
      await ensureDirectory("work");
      const tombstone = seal(derived.encryption, "result", fileKey, {
        schema_version: JOURNAL_WORK_EXCHANGE_VERSION,
        work_id: workId,
        retired: true,
        retired_at: now().toISOString()
      });
      const temporary = await writeTemporary("result", tombstone);
      try {
        await fs.rename(temporary, fileFor("result", fileKey));
      } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        throw error;
      }
      await syncDirectory("result");
      await fs.unlink(fileFor("work", fileKey)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await syncDirectory("work");
    },

    // Removes temporary files that a process stopped mid-write (for example, killed) left behind.
    // Only files older than `olderThanMs` go, so a write still in progress elsewhere is never touched.
    // Both processes call this at startup. Returns how many files were removed.
    async removeStaleTemporaries({ olderThanMs = STALE_JOURNAL_WORK_TEMPORARY_MS } = {}) {
      if (!Number.isSafeInteger(olderThanMs) || olderThanMs < 0) fail("JOURNAL_WORK_EXCHANGE_AGE_INVALID");
      await assertJournalWorkExchangeRoot(root, { owner });
      const cutoff = Date.now() - olderThanMs;
      let removed = 0;
      for (const kind of ["work", "result"]) {
        if (!(await queueExists(kind))) continue;
        let removedHere = 0;
        for (const name of await fs.readdir(directory(kind))) {
          if (!name.startsWith(TEMPORARY_PREFIX)) continue;
          const file = path.join(directory(kind), name);
          let info;
          try {
            info = await fs.lstat(file);
          } catch (error) {
            if (error?.code === "ENOENT") continue;
            throw error;
          }
          if (!info.isFile() || info.mtimeMs > cutoff) continue;
          try {
            await fs.unlink(file);
            removedHere += 1;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
        if (removedHere > 0) await syncDirectory(kind);
        removed += removedHere;
      }
      return removed;
    }
  });
}
