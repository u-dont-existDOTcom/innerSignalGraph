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

// The root must already exist (deployment creates it), be a real directory owned by the user both
// processes run as (`owner`; null skips the ownership checks where the platform has no user IDs), and
// have mode 0700. Every directory above it must be owned by that user or by root and be writable by
// no one else, unless it has the sticky bit (like /tmp), which stops others renaming what they don't
// own. Another local user can then neither read, remove, block nor swap entries or the root itself.
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
  if ((owner !== null && info.uid !== owner) || (info.mode & 0o777) !== 0o700) fail("JOURNAL_WORK_EXCHANGE_ROOT_INSECURE");
  if (owner === null) return;
  for (let current = await fs.realpath(path.dirname(root)); ;) {
    const ancestor = await fs.lstat(current);
    const trustedOwner = ancestor.uid === 0 || ancestor.uid === owner;
    const writableByOthers = (ancestor.mode & 0o022) !== 0;
    const sticky = (ancestor.mode & 0o1000) !== 0;
    if (!trustedOwner || (writableByOthers && !sticky)) fail("JOURNAL_WORK_EXCHANGE_ROOT_INSECURE");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
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

export async function journalWorkExchangeSecret(environment) {
  const inline = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_BASE64;
  const file = environment.INNER_SIGNAL_JOURNAL_WORK_EXCHANGE_SECRET_FILE;
  if (inline !== undefined && file !== undefined) fail("JOURNAL_WORK_EXCHANGE_SECRET_CONFLICT");
  if (inline) return inline;
  if (typeof file !== "string" || !path.isAbsolute(file)) fail("JOURNAL_WORK_EXCHANGE_SECRET_FILE_INVALID");
  try {
    return await withOpenedRegularFile(file, async (handle, info) => {
      if ((info.mode & 0o077) !== 0 || (currentUser() !== null && info.uid !== currentUser())) {
        fail("JOURNAL_WORK_EXCHANGE_SECRET_FILE_INSECURE");
      }
      if (info.size > 4096) fail("JOURNAL_WORK_EXCHANGE_SECRET_FILE_INVALID");
      return (await handle.readFile("utf8")).trim();
    });
  } catch (error) {
    if (["ELOOP", "ERR_NOT_REGULAR_FILE"].includes(error?.code)) fail("JOURNAL_WORK_EXCHANGE_SECRET_FILE_INVALID");
    throw error;
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
  if (entry.tier !== undefined && !["standard", "hardest"].includes(entry.tier)) fail("JOURNAL_WORK_ENTRY_INVALID");
  if (entry.origin !== undefined && entry.origin !== "lookahead") fail("JOURNAL_WORK_ENTRY_INVALID");
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

const MAX_DISPATCH_BYTES = 4096;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:+-]{0,79}$/u;

function validateDispatchRecord(record) {
  if (!isPlainObject(record) || record.schema_version !== JOURNAL_WORK_EXCHANGE_VERSION) fail("JOURNAL_WORK_DISPATCH_INVALID");
  const allowed = new Set(["schema_version", "work_id", "role", "tier", "output_schema_name", "model", "effort", "route_ref", "issued_at", "expires_at"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) fail("JOURNAL_WORK_DISPATCH_INVALID");
  assertJournalWorkId(record.work_id);
  if (typeof record.role !== "string" || !ROLE_PATTERN.test(record.role)) fail("JOURNAL_WORK_DISPATCH_INVALID");
  if (record.tier !== undefined && !["standard", "hardest"].includes(record.tier)) fail("JOURNAL_WORK_DISPATCH_INVALID");
  record.tier ??= "standard";
  for (const field of ["output_schema_name", "model", "effort", "route_ref"]) {
    if (typeof record[field] !== "string" || !LABEL_PATTERN.test(record[field])) fail("JOURNAL_WORK_DISPATCH_INVALID");
  }
  if (!isoTime(record.issued_at) || !isoTime(record.expires_at) || Date.parse(record.expires_at) <= Date.parse(record.issued_at)) {
    fail("JOURNAL_WORK_DISPATCH_INVALID");
  }
  return record;
}

// Mission Control needs only the content-free dispatch queue, never the exchange secret. Keep that
// reader separate from the encrypted work/result API while applying the same root, queue and opened-
// file checks as the connector-facing exchange.
export function createJournalWorkDispatchReader({ root, owner = currentUser() } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) fail("JOURNAL_WORK_EXCHANGE_ROOT_INVALID");
  const dispatchDirectory = path.join(root, "dispatch");

  async function directoryExists() {
    let info;
    try {
      info = await fs.lstat(dispatchDirectory);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (!info.isDirectory()) fail("JOURNAL_WORK_EXCHANGE_QUEUE_INVALID");
    return true;
  }

  async function answered(workId) {
    try {
      await fs.lstat(path.join(root, "inbox", `${journalWorkFileKey(workId)}.json`));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
      throw error;
    }
  }

  return Object.freeze({
    async listDispatch() {
      await assertJournalWorkExchangeRoot(root, { owner });
      if (!(await directoryExists())) return [];
      const records = [];
      for (const name of await fs.readdir(dispatchDirectory)) {
        const match = /^([0-9a-f]{64})\.json$/u.exec(name);
        if (!match) continue;
        let bytes;
        try {
          bytes = await withOpenedRegularFile(path.join(dispatchDirectory, name), async (handle, info) => {
            if (info.size > MAX_DISPATCH_BYTES) fail("JOURNAL_WORK_DISPATCH_INVALID");
            return handle.readFile();
          });
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          if (error?.code === "ELOOP" || error?.code === "ERR_NOT_REGULAR_FILE") fail("JOURNAL_WORK_DISPATCH_INVALID");
          throw error;
        }
        let value;
        try { value = validateDispatchRecord(JSON.parse(bytes.toString("utf8"))); }
        catch { fail("JOURNAL_WORK_DISPATCH_INVALID"); }
        if (journalWorkFileKey(value.work_id) !== match[1]) fail("JOURNAL_WORK_DISPATCH_INVALID");
        records.push(Object.freeze({ ...value, answered: await answered(value.work_id) }));
      }
      return records.sort((left, right) => Date.parse(left.issued_at) - Date.parse(right.issued_at) || left.work_id.localeCompare(right.work_id));
    }
  });
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
  const QUEUES = Object.freeze({ work: "outbox", result: "inbox", dispatch: "dispatch", adopted: "adopted" });
  const dispatchReader = createJournalWorkDispatchReader({ root, owner });
  const directory = (kind) => path.join(root, QUEUES[kind]);
  const fileFor = (kind, fileKey) => path.join(directory(kind), `${fileKey}.json`);

  async function stagePath(stageDir, workId) {
    if (typeof stageDir !== "string" || !path.isAbsolute(stageDir)) fail("JOURNAL_WORK_STAGE_DIR_INVALID");
    let info;
    try { info = await fs.lstat(stageDir); }
    catch { fail("JOURNAL_WORK_STAGE_DIR_INVALID"); }
    if (!info.isDirectory() || (info.mode & 0o777) !== 0o700 || (owner !== null && info.uid !== owner)
      || await fs.realpath(stageDir) !== stageDir) fail("JOURNAL_WORK_STAGE_DIR_INSECURE");
    return path.join(stageDir, `${journalWorkFileKey(workId)}.json`);
  }

  async function fetchMarkerPath(stageDir, workId) {
    await stagePath(stageDir, workId);
    return path.join(stageDir, `${journalWorkFileKey(workId)}.fetched`);
  }

  async function requireFetchMarker(stageDir, workId) {
    const marker = await fetchMarkerPath(stageDir, workId);
    try {
      await withOpenedRegularFile(marker, async (_handle, info) => {
        if ((info.mode & 0o777) !== 0o600 || (owner !== null && info.uid !== owner)
          || info.size === 0 || info.size > 256) fail("JOURNAL_WORK_PACKET_NOT_FETCHED");
      });
    } catch (error) {
      if (error?.code === "JOURNAL_WORK_PACKET_NOT_FETCHED") throw error;
      fail("JOURNAL_WORK_PACKET_NOT_FETCHED");
    }
    return marker;
  }

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

  async function hasResult(workId) {
    try {
      await fs.lstat(fileFor("result", journalWorkFileKey(workId)));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function removeDispatch(workId) {
    const fileKey = journalWorkFileKey(workId);
    if (!(await queueExists("dispatch"))) return;
    try {
      await fs.unlink(fileFor("dispatch", fileKey));
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await syncDirectory("dispatch");
  }

  return Object.freeze({
    // A content-free durable marker distinguishes an adopted speculative item from one that the
    // sequential caller has never resumed. First-write-wins keeps adoption across restarts.
    async markAdopted(workId) {
      const fileKey = journalWorkFileKey(workId);
      await publish("adopted", fileKey, seal(derived.encryption, "adopted", fileKey, {
        schema_version: JOURNAL_WORK_EXCHANGE_VERSION, work_id: workId, adopted: true
      }));
    },
    async isAdopted(workId) {
      const fileKey = journalWorkFileKey(workId);
      const bytes = await readRegular("adopted", fileKey, MAX_DISPATCH_BYTES);
      if (!bytes) return false;
      const record = open(derived.encryption, "adopted", fileKey, bytes);
      if (record.schema_version !== JOURNAL_WORK_EXCHANGE_VERSION || record.work_id !== workId || record.adopted !== true)
        fail("JOURNAL_WORK_ENTRY_INVALID");
      return true;
    },
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

    hasResult,

    // Connector side: store a validated answer with a receipt the runtime can authenticate.
    // The subject is hashed; the output is never logged or returned.
    async submitResult({ workId, output, subject, execution }) {
      const fileKey = journalWorkFileKey(workId);
      if (!isPlainObject(output)) fail("JOURNAL_WORK_OUTPUT_INVALID");
      const serialized = JSON.stringify(output);
      if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_RESULT_BYTES) fail("JOURNAL_WORK_OUTPUT_TOO_LARGE");
      if (typeof subject !== "string" || subject.length === 0) fail("JOURNAL_WORK_SUBJECT_REQUIRED");
      if (execution !== undefined && (!isPlainObject(execution)
        || Object.keys(execution).length !== 4
        || ["profile_evidence", "effective_model_profile", "effective_effort", "request_context_id"].some((field) =>
          typeof execution[field] !== "string" || !/^[\x20-\x7e]{1,128}$/u.test(execution[field])))) {
        fail("JOURNAL_WORK_EXECUTION_INVALID");
      }
      const fields = {
        receipt_id: `journal-work-receipt:${randomUUID()}`,
        transport: JOURNAL_WORK_TRANSPORT,
        completion_status: "completed",
        work_file_key: fileKey,
        output_sha256: sha256(serialized),
        subject_sha256: sha256(`subject:${subject}`),
        received_at: now().toISOString(),
        ...(execution ?? {})
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

    async markPacketFetched({ stageDir, workId }) {
      const marker = await fetchMarkerPath(stageDir, workId);
      const temporary = path.join(stageDir, `${TEMPORARY_PREFIX}${randomUUID()}`);
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ nonce: randomUUID(), at: now().toISOString() })); await handle.sync(); }
      catch (error) { await handle.close(); await fs.unlink(temporary).catch(() => {}); throw error; }
      await handle.close();
      try { await fs.link(temporary, marker); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
      finally { await fs.unlink(temporary).catch(() => {}); await syncPath(stageDir); }
      await requireFetchMarker(stageDir, workId);
    },

    async stageResult({ stageDir, workId, output }) {
      const destination = await stagePath(stageDir, workId);
      await requireFetchMarker(stageDir, workId);
      if (!isPlainObject(output)) fail("JOURNAL_WORK_OUTPUT_INVALID");
      const serialized = JSON.stringify(output);
      if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_RESULT_BYTES) fail("JOURNAL_WORK_OUTPUT_TOO_LARGE");
      const fileKey = journalWorkFileKey(workId);
      const temporary = path.join(stageDir, `${TEMPORARY_PREFIX}${randomUUID()}`);
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(seal(derived.encryption, "stage", fileKey, { work_id: workId, output }));
        await handle.sync();
      } catch (error) {
        await handle.close();
        await fs.unlink(temporary).catch(() => {});
        throw error;
      }
      await handle.close();
      try {
        await fs.link(temporary, destination);
        return Object.freeze({ stored: true, already: false });
      } catch (error) {
        if (error?.code === "EEXIST") return Object.freeze({ stored: true, already: true });
        throw error;
      } finally {
        await fs.unlink(temporary).catch(() => {});
        await syncPath(stageDir);
      }
    },

    async promoteStaged({ stageDir, workId, subject, execution }) {
      const filename = await stagePath(stageDir, workId);
      const marker = await requireFetchMarker(stageDir, workId);
      const bytes = await withOpenedRegularFile(filename, async (handle, info) => {
        if (info.size > MAX_WORK_BYTES || (info.mode & 0o077) !== 0) fail("JOURNAL_WORK_STAGE_INVALID");
        return handle.readFile();
      });
      const staged = open(derived.encryption, "stage", journalWorkFileKey(workId), bytes);
      if (!isPlainObject(staged) || staged.work_id !== workId || !isPlainObject(staged.output)) fail("JOURNAL_WORK_STAGE_INVALID");
      const result = await this.submitResult({ workId, output: staged.output, subject, execution });
      await fs.unlink(filename);
      await fs.unlink(marker);
      await syncPath(stageDir);
      return result;
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
      if (record.retired === true) {
        return Object.freeze({ retired: true, retired_at: record.retired_at,
          unanswered: record.unanswered === true,
          ...(record.superseded === true ? { superseded: true } : {}) });
      }
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
    async retireWork(workId, { superseded = false } = {}) {
      const fileKey = journalWorkFileKey(workId);
      await ensureDirectory("result");
      await ensureDirectory("work");
      const tombstone = seal(derived.encryption, "result", fileKey, {
        schema_version: JOURNAL_WORK_EXCHANGE_VERSION,
        work_id: workId,
        retired: true,
        ...(superseded ? { superseded: true } : {}),
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
      await removeDispatch(workId);
    },

    // Runtime side, for an item that expired unanswered: closes it with an encrypted tombstone, but
    // only if no answer arrived first. The tombstone is linked into place like an answer, so an answer
    // and the closing can never both win. Returns { closed: false } when an answer (or an earlier
    // tombstone) already holds the name; the caller then reads it.
    async closeUnanswered(workId) {
      const fileKey = journalWorkFileKey(workId);
      await ensureDirectory("work");
      const closed = await publish("result", fileKey, seal(derived.encryption, "result", fileKey, {
        schema_version: JOURNAL_WORK_EXCHANGE_VERSION,
        work_id: workId,
        retired: true,
        unanswered: true,
        retired_at: now().toISOString()
      }));
      if (!closed) return Object.freeze({ closed: false });
      await fs.unlink(fileFor("work", fileKey)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await syncDirectory("work");
      await removeDispatch(workId);
      return Object.freeze({ closed: true });
    },

    // Dispatch records tell Mission Control which items to hand to ChatGPT. They are plain JSON and
    // content-free (an opaque work ID, the role and the route's model and effort), so a dispatcher can
    // read them without any key. Publication is first-write-wins like every other entry.
    async publishDispatch(record) {
      const value = validateDispatchRecord(structuredClone(record));
      await ensureDirectory("dispatch");
      const created = await publish("dispatch", journalWorkFileKey(value.work_id), Buffer.from(`${JSON.stringify(value)}\n`, "utf8"));
      return Object.freeze({ created });
    },

    // Outstanding dispatch records, oldest first, each with whether an answer (or a tombstone) is
    // already stored, so a dispatcher can tell what still needs a chat.
    async listDispatch() {
      return dispatchReader.listDispatch();
    },

    removeDispatch,

    // Removes temporary files that a process stopped mid-write (for example, killed) left behind.
    // Only files older than `olderThanMs` go, so a write still in progress elsewhere is never touched.
    // Both processes call this at startup. Returns how many files were removed.
    async removeStaleTemporaries({ olderThanMs = STALE_JOURNAL_WORK_TEMPORARY_MS } = {}) {
      if (!Number.isSafeInteger(olderThanMs) || olderThanMs < 0) fail("JOURNAL_WORK_EXCHANGE_AGE_INVALID");
      await assertJournalWorkExchangeRoot(root, { owner });
      const cutoff = Date.now() - olderThanMs;
      let removed = 0;
      for (const kind of ["work", "result", "dispatch", "adopted"]) {
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
