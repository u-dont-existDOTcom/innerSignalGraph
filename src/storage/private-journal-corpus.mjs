import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";
import { decryptJournalObject, encryptJournalObject } from "./journal-object-crypto.mjs";

export const JOURNAL_BINARY_CHUNK_BYTES = 4 * 1024 * 1024;
export const JOURNAL_OBJECT_PAYLOAD_MAX_BYTES = 4 * 1024 * 1024;
const ORPHAN_TEMPORARY = /^[a-f0-9]{64}\.journal-object\.json\.\d+\.[0-9a-f-]{36}\.tmp$/u;

const ID = /^[A-Za-z0-9:_-]{1,160}$/;
const digest = (value) => createHash("sha256").update(value).digest("hex");

function validId(value, name) {
  if (typeof value !== "string" || !ID.test(value)) throw new ValidationError(`${name} is invalid.`);
  return value;
}

function bytes(value, name) {
  if (!(value instanceof Uint8Array)) throw new ValidationError(`${name} must be bytes.`);
  return Buffer.from(value);
}

async function assertDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new ValidationError("Journal corpus storage root must be a real directory.");
  await fs.chmod(directory, 0o700);
}

async function durableWrite(file, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    body.fill(0);
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  }
}

async function readRegularJson(file) {
  const handle = await fs.open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ValidationError("Journal object storage entry is not a regular file.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}

export function createPrivateJournalCorpusStore({ rootDir, caseId, corpusId, corpusKey, resumeMatchingObjects = false }) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new ValidationError("rootDir must be an absolute private path.");
  const checkedCaseId = validId(caseId, "caseId");
  const checkedCorpusId = validId(corpusId, "corpusId");
  if (!(corpusKey instanceof Uint8Array) || corpusKey.byteLength !== 32) throw new ValidationError("corpusKey must be 32-byte key material.");
  const key = Buffer.from(corpusKey);
  const storageId = digest(Buffer.from(`${checkedCaseId}\0${checkedCorpusId}`, "utf8")).slice(0, 48);
  const corpusDirectory = path.join(path.resolve(rootDir), ".journal-corpora", storageId);
  let closed = false;
  const ensureOpen = () => { if (closed) throw new ValidationError("Journal corpus store is closed."); };
  const objectFile = ({ objectId, objectVersion, chunkIndex }) => path.join(
    corpusDirectory,
    `${digest(Buffer.from(`${validId(objectId, "objectId")}\0${objectVersion}\0${chunkIndex}`, "utf8"))}.journal-object.json`
  );
  const expected = ({ objectId, objectVersion = 1, chunkIndex = 0 }) => ({
    caseId: checkedCaseId,
    corpusId: checkedCorpusId,
    objectId: validId(objectId, "objectId"),
    objectVersion,
    chunkIndex
  });

  const writeObject = async ({ objectId, objectVersion = 1, chunkIndex = 0, plaintextBytes }) => {
    ensureOpen();
    const plaintext = bytes(plaintextBytes, "plaintextBytes");
    if (plaintext.byteLength > JOURNAL_OBJECT_PAYLOAD_MAX_BYTES) {
      plaintext.fill(0);
      throw new ValidationError("Journal object payload exceeds the hard bound.", { code: "JOURNAL_OBJECT_LIMIT" });
    }
    const identity = expected({ objectId, objectVersion, chunkIndex });
    const file = objectFile(identity);
    await assertDirectory(corpusDirectory);
    try {
      await fs.access(file);
      if (resumeMatchingObjects) {
        const opened = decryptJournalObject({ envelope: await readRegularJson(file), corpusKey: key, expected: identity });
        try {
          if (opened.length === plaintext.length && timingSafeEqual(createHash("sha256").update(opened).digest(), createHash("sha256").update(plaintext).digest())) {
            return Object.freeze({ object_id: objectId, object_version: objectVersion, chunk_index: chunkIndex, byte_length: plaintext.length, sha256: digest(plaintext), storage_id: path.basename(file) });
          }
        } finally { opened.fill(0); plaintext.fill(0); }
      }
      throw new ValidationError("Journal objects are immutable.", { code: "JOURNAL_OBJECT_EXISTS" });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const expectedDigest = digest(plaintext);
    const envelope = encryptJournalObject({ plaintextBytes: plaintext, corpusKey: key, ...identity });
    try {
      await durableWrite(file, envelope);
      const reopened = decryptJournalObject({ envelope: await readRegularJson(file), corpusKey: key, expected: identity });
      try {
        if (reopened.byteLength !== plaintext.byteLength || !timingSafeEqual(createHash("sha256").update(reopened).digest(), createHash("sha256").update(plaintext).digest())) {
          throw new ValidationError("Journal object encrypted round trip failed.");
        }
      } finally { reopened.fill(0); }
      return Object.freeze({
        object_id: identity.objectId,
        object_version: identity.objectVersion,
        chunk_index: identity.chunkIndex,
        byte_length: plaintext.byteLength,
        sha256: expectedDigest,
        storage_id: path.basename(file)
      });
    } finally { plaintext.fill(0); }
  };

  const readObject = async ({ objectId, objectVersion = 1, chunkIndex = 0 }) => {
    ensureOpen();
    const identity = expected({ objectId, objectVersion, chunkIndex });
    return decryptJournalObject({ envelope: await readRegularJson(objectFile(identity)), corpusKey: key, expected: identity });
  };

  const writeChunkedOriginalStream = async ({ objectId, objectVersion = 1, chunks }) => {
    ensureOpen();
    if (!chunks || (typeof chunks[Symbol.asyncIterator] !== "function" && typeof chunks[Symbol.iterator] !== "function")) {
      throw new ValidationError("chunks must be an iterable of bytes.");
    }
    const refs = [];
    const sourceDigest = createHash("sha256");
    let pending = Buffer.alloc(0);
    let byteLength = 0;
    let chunkIndex = 0;
    const flush = async (length) => {
      const plaintext = Buffer.from(pending.subarray(0, length));
      const remainder = Buffer.from(pending.subarray(length));
      pending.fill(0);
      pending = remainder;
      try {
        refs.push(await writeObject({ objectId, objectVersion, chunkIndex, plaintextBytes: plaintext }));
        chunkIndex += 1;
      } finally { plaintext.fill(0); }
    };
    try {
      for await (const value of chunks) {
        const piece = bytes(value, "chunk");
        try {
          sourceDigest.update(piece);
          byteLength += piece.byteLength;
          const joined = Buffer.concat([pending, piece]);
          pending.fill(0);
          pending = joined;
          while (pending.byteLength >= JOURNAL_BINARY_CHUNK_BYTES) await flush(JOURNAL_BINARY_CHUNK_BYTES);
        } finally { piece.fill(0); }
      }
      if (pending.byteLength || byteLength === 0) await flush(pending.byteLength);
      return Object.freeze({
        object_id: validId(objectId, "objectId"),
        object_version: objectVersion,
        byte_length: byteLength,
        sha256: sourceDigest.digest("hex"),
        chunk_bytes: JOURNAL_BINARY_CHUNK_BYTES,
        chunks: refs
      });
    } finally { pending.fill(0); }
  };

  async function* iterateOriginal(manifest) {
    ensureOpen();
    const sourceDigest = createHash("sha256");
    let byteLength = 0;
    for (const ref of manifest.chunks) {
      const chunk = await readObject({ objectId: manifest.object_id, objectVersion: manifest.object_version, chunkIndex: ref.chunk_index });
      try {
        if (chunk.byteLength !== ref.byte_length || digest(chunk) !== ref.sha256) throw new ValidationError("Journal original chunk integrity failed.");
        sourceDigest.update(chunk);
        byteLength += chunk.byteLength;
        yield chunk;
      } finally { chunk.fill(0); }
    }
    if (byteLength !== manifest.byte_length || sourceDigest.digest("hex") !== manifest.sha256) {
      throw new ValidationError("Journal original stream integrity failed.");
    }
  }

  return Object.freeze({
    rootDir: corpusDirectory,
    caseId: checkedCaseId,
    corpusId: checkedCorpusId,
    writeObject,
    readObject,
    async writeJsonObject({ objectId, objectVersion = 1, value }) {
      let plaintext;
      try {
        plaintext = Buffer.from(JSON.stringify(value), "utf8");
        return await writeObject({ objectId, objectVersion, plaintextBytes: plaintext });
      } finally { plaintext?.fill(0); }
    },
    async readJsonObject({ objectId, objectVersion = 1 }) {
      const plaintext = await readObject({ objectId, objectVersion });
      try { return JSON.parse(plaintext.toString("utf8")); }
      catch { throw new ValidationError("Journal JSON object is unreadable.", { code: "JOURNAL_JSON_INVALID" }); }
      finally { plaintext.fill(0); }
    },
    async writeChunkedOriginal({ objectId, objectVersion = 1, bytes: originalBytes }) {
      ensureOpen();
      const original = bytes(originalBytes, "bytes");
      try {
        return await writeChunkedOriginalStream({ objectId, objectVersion, chunks: [original] });
      } finally { original.fill(0); }
    },
    writeChunkedOriginalStream,
    iterateOriginal,
    async reassembleOriginal(manifest) {
      ensureOpen();
      const chunks = [];
      try {
        for await (const chunk of iterateOriginal(manifest)) chunks.push(Buffer.from(chunk));
        const joined = Buffer.concat(chunks);
        if (joined.byteLength !== manifest.byte_length || digest(joined) !== manifest.sha256) {
          joined.fill(0);
          throw new ValidationError("Journal original reassembly failed.");
        }
        return joined;
      } finally { chunks.forEach((chunk) => chunk.fill(0)); }
    },
    async recoverOrphanedTemporaryObjects() {
      ensureOpen();
      let names;
      try { names = await fs.readdir(corpusDirectory); }
      catch (error) {
        if (error?.code === "ENOENT") return Object.freeze({ removed: 0, ignored: 0 });
        throw error;
      }
      let removed = 0;
      let ignored = 0;
      for (const name of names) {
        if (!name.endsWith(".tmp")) continue;
        const file = path.join(corpusDirectory, name);
        const info = await fs.lstat(file);
        if (!ORPHAN_TEMPORARY.test(name) || !info.isFile() || info.isSymbolicLink()) {
          ignored += 1;
          continue;
        }
        await fs.unlink(file);
        removed += 1;
      }
      return Object.freeze({ removed, ignored });
    },
    close() { if (!closed) { key.fill(0); closed = true; } }
  });
}
