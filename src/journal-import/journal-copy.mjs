import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { ValidationError } from "../core/errors.mjs";
import { validateJournalGraph } from "./contracts.mjs";
import { buildGraphIndexes, persistGraphGeneration, readGenerationDirectory } from "./graph.mjs";
import { openPrivateJournalGraph } from "./retrieval.mjs";

// The copy step for a client's journal (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, point 4; the owner's answer
// 1a to question i73): the client's published session-use generation is exported where it lives (the server's vault, a server step
// run only on the owner's go for each copy), sealed for that client's key in the runner trial alone, and imported on the laptop into
// the client's runner case, rebuilt under that case and a corpus of its own, published for session use and checked against the
// export. Nothing here contacts a server; the caller runs each half where its vault is. The export is the journal import's `export`
// command (src/cli/journal-import.mjs); the import is the runner trial's `--import` (scripts/runner-trial-journal.mjs).
//
// Sealing: each client's journal folder in the trial folder keeps an X25519 key pair (its private half mode 0600; the client's Delete
// removes it, and with it the means to open any copy sealed for them). The export seals the bundle to the public half with an
// ephemeral key (X25519, HKDF-SHA-256, AES-256-GCM with a 16-byte tag), so only that key opens it, and the bundle on disk or in
// transit shows nothing of the journal. The seal keeps the copy confidential; it doesn't prove who made it (anyone holding the public
// half can seal a bundle), so only a file the owner carried from the export is imported.
//
// Faithful: the copy holds the generation's records, its source representations and the indexes its builder added (the quote
// index's `quote_meta`, `quote_terms` and the like), and lists the sources in the server's order, which the store's source order
// follows (graph.mjs, sourceOrderKeys); the records are stored by id, so that order is read back from the record lookup index.
// The original upload and other archive objects stay where the journal lives: the copy is for session use, so it permits no archive.

export const JOURNAL_COPY_KIND = "runner_journal_copy";
const SEAL_INFO = Buffer.from("inner-signal runner journal copy v1", "utf8");
const TAG_BYTES = 16;
const IV_BYTES = 12;
const invalid = (code, message = "The journal copy is invalid.") => { throw new ValidationError(message, { code }); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ID = /^[A-Za-z0-9:_-]{1,160}$/u;
const COPY_USES = Object.freeze(["organize_search", "session_use"]);
const EVIDENCE_BATCH = 200;
// Small shards keep a turn's search quick. A journal with a record too large for one gets the builder's own size, which every
// published generation fits.
const COPY_SHARD_BYTES = 64 * 1024;
const TOO_LARGE_FOR_A_SHARD = new Set(["GRAPH_RECORD_EXCEEDS_SHARD_TARGET", "GRAPH_INDEX_VALUE_TOO_LARGE"]);

export function createJournalCopyKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")
  };
}

const publicKeyOf = (base64) => createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
const privateKeyOf = (base64) => createPrivateKey({ key: Buffer.from(base64, "base64"), format: "der", type: "pkcs8" });
export const journalCopyRecipientDigest = (publicKey) => sha256(Buffer.from(publicKey, "base64"));

// A client's public key as `--copy-key` prints it: an X25519 key, SPKI DER in base64.
export function validateJournalCopyRecipient(base64) {
  let key = null;
  try { key = typeof base64 === "string" && /^[A-Za-z0-9+/]+={0,2}$/u.test(base64) ? publicKeyOf(base64) : null; } catch { key = null; }
  if (key?.asymmetricKeyType !== "x25519") invalid("JOURNAL_COPY_RECIPIENT_INVALID", "The client's public key isn't valid.");
  return base64;
}

export function sealJournalCopy(bundle, recipientPublicKey) {
  const recipient = publicKeyOf(validateJournalCopyRecipient(recipientPublicKey));
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const salt = randomBytes(32);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, SEAL_INFO, 32));
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const sealed = {
    schema_version: 1, kind: "runner_journal_copy_sealed", recipient_sha256: journalCopyRecipientDigest(recipientPublicKey),
    ephemeral_public_key: ephemeral.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64")
  };
  key.fill(0); shared.fill(0); plaintext.fill(0);
  return sealed;
}

export function openJournalCopy(sealed, keyPair) {
  if (sealed?.schema_version !== 1 || sealed.kind !== "runner_journal_copy_sealed") invalid("JOURNAL_COPY_INVALID");
  if (sealed.recipient_sha256 !== journalCopyRecipientDigest(keyPair.publicKey)) invalid("JOURNAL_COPY_OTHER_RECIPIENT", "The journal copy was sealed for another key.");
  const iv = Buffer.from(String(sealed.iv), "base64");
  const tag = Buffer.from(String(sealed.tag), "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) invalid("JOURNAL_COPY_UNREADABLE", "The journal copy can't be opened with this key.");
  let shared;
  try { shared = diffieHellman({ privateKey: privateKeyOf(keyPair.privateKey), publicKey: publicKeyOf(String(sealed.ephemeral_public_key)) }); }
  catch { return invalid("JOURNAL_COPY_UNREADABLE", "The journal copy can't be opened with this key."); }
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.from(String(sealed.salt), "base64"), SEAL_INFO, 32));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(String(sealed.ciphertext), "base64")), decipher.final()]);
    try { return validateJournalCopyBundle(JSON.parse(plaintext.toString("utf8"))); } finally { plaintext.fill(0); }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return invalid("JOURNAL_COPY_UNREADABLE", "The journal copy can't be opened with this key.");
  } finally { key.fill(0); shared.fill(0); }
}

const contentDigest = (bundle) => sha256(JSON.stringify({ graph: bundle.graph, source_representations: bundle.source_representations,
  extra_indexes: bundle.extra_indexes, index_representations: bundle.index_representations }));

export function validateJournalCopyBundle(bundle) {
  if (bundle?.schema_version !== 1 || bundle.kind !== JOURNAL_COPY_KIND) invalid("JOURNAL_COPY_INVALID");
  const { source, graph, source_representations: representations, extra_indexes: extras } = bundle;
  if (!source || !ID.test(source.case_id ?? "") || !ID.test(source.corpus_id ?? "") || !ID.test(source.generation ?? "") || !ID.test(source.manifest_object_id ?? "")
    || !Number.isSafeInteger(source.visibility_epoch)) invalid("JOURNAL_COPY_INVALID");
  if (!Array.isArray(source.permitted_uses) || !source.permitted_uses.includes("session_use")) invalid("JOURNAL_COPY_NOT_SESSION_USE", "Only a generation published for session use is copied.");
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.generation !== source.generation) invalid("JOURNAL_COPY_INVALID");
  if (!representations || typeof representations !== "object" || Array.isArray(representations) || Object.values(representations).some((text) => typeof text !== "string")) invalid("JOURNAL_COPY_INVALID");
  if (!extras || typeof extras !== "object" || Array.isArray(extras) || typeof bundle.index_representations !== "boolean"
    || Object.entries(extras).some(([name, entries]) => !/^[a-z][a-z0-9_]{0,39}$/u.test(name) || !Array.isArray(entries)
      || entries.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1])))) invalid("JOURNAL_COPY_INVALID");
  if (bundle.content_sha256 !== contentDigest(bundle)) invalid("JOURNAL_COPY_DIGEST_MISMATCH");
  return bundle;
}

// The sealed copy on disk: written whole to a new file only its owner can read (mode 0600), never over another file.
export async function writeSealedJournalCopy(file, sealed) {
  let handle;
  try { handle = await fs.open(file, "wx", 0o600); } catch (error) {
    if (error?.code === "EEXIST") invalid("JOURNAL_COPY_FILE_EXISTS", "A file is already there; nothing was written over it.");
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(sealed)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(file, { force: true });
    throw error;
  }
  await handle.close();
}

// `file`: a path, or a handle the caller opened and checked.
export async function readSealedJournalCopy(file) {
  let value;
  try { value = JSON.parse(await fs.readFile(file, "utf8")); } catch { return invalid("JOURNAL_COPY_UNREADABLE", "The sealed journal copy can't be read."); }
  if (value?.schema_version !== 1 || value.kind !== "runner_journal_copy_sealed") invalid("JOURNAL_COPY_INVALID");
  return value;
}

// A whole index, its pieces joined in stored order (graph.mjs, postingPieces and packIndex).
async function readWholeIndex(corpusStore, descriptors) {
  const index = new Map();
  for (const descriptor of descriptors ?? []) {
    const shard = await corpusStore.readJsonObject({ objectId: descriptor.object_id });
    for (const [key, values] of shard.entries) index.set(key, [...(index.get(key) ?? []), ...values]);
  }
  return index;
}

async function readRecords(corpusStore, manifest) {
  const records = [];
  for (const shard of manifest.record_shards) records.push(...(await corpusStore.readJsonObject({ objectId: shard.object_id })).records);
  return records;
}

const isEdge = (record) => typeof record.relation === "string" && "from" in record && "to" in record;

// The export half, where the client's journal lives: the active generation, published for session use, read whole and sealed. It
// asks the vault's `export` purpose (the journal leaves the vault), with the scope the reader's grant holds (the import's operator may
// hold write only), and first opens the session-use reader, whose own checks of the manifest (its case, corpus, generation and epoch)
// a copy must pass too; the manifest must permit session use, as the reader's callers require.
export async function exportJournalCopy({ caseAccessService, caseId, corpusId, authContext, recipientPublicKey, requiredScope = "case:read", exportedAt = new Date().toISOString() }) {
  validateJournalCopyRecipient(recipientPublicKey);
  const access = { requiredScope, requiredPurpose: "export" };
  const bundle = await caseAccessService.withJournalCorpus(caseId, corpusId, access, async ({ corpusStore, cursorSecret, reference }) => {
    if (!reference?.active_generation) invalid("JOURNAL_COPY_NOT_PUBLISHED", "The journal has no published generation to copy.");
    const reader = await openPrivateJournalGraph({ corpusStore, cursorSecret, caseId, corpusId, generation: reference.active_generation,
      manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch, purpose: "session_use" });
    reader.close();
    const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
    if (manifest.case_id !== caseId || manifest.corpus_id !== corpusId || manifest.generation !== reference.active_generation
      || manifest.visibility_epoch !== reference.visibility_epoch) invalid("JOURNAL_COPY_SNAPSHOT_MISMATCH");
    if (!Array.isArray(manifest.permitted_uses) || !manifest.permitted_uses.includes("session_use")) invalid("JOURNAL_COPY_NOT_SESSION_USE", "Only a generation published for session use is copied.");
    const records = await readRecords(corpusStore, manifest);
    const nodes = records.filter((record) => !isEdge(record));
    const edges = records.filter(isEdge);
    // Each representation's place in the server's source order, from its passages' lookup facts ([place, byte offset]).
    const lookup = await readWholeIndex(corpusStore, manifest.indexes?.record_lookup);
    const places = new Map();
    for (const node of nodes) {
      const place = node.kind === "passage" ? lookup.get(node.id)?.[0]?.order?.[0] : undefined;
      if (Number.isSafeInteger(place) && !places.has(node.data.representation_id)) places.set(node.data.representation_id, place);
    }
    const placeOf = (node) => places.get(node.data?.representation_id) ?? Number.MAX_SAFE_INTEGER;
    const sources = nodes.filter((node) => node.kind === "source").sort((left, right) => placeOf(left) - placeOf(right) || left.id.localeCompare(right.id));
    const graph = { schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation: reference.active_generation,
      nodes: [...sources, ...nodes.filter((node) => node.kind !== "source")], edges };
    const directory = await readGenerationDirectory(manifest, corpusStore);
    const representations = {};
    for (const [id, descriptor] of Object.entries(directory.objects)) {
      if (Array.isArray(descriptor.chunks)) {
        const bytes = await corpusStore.reassembleOriginal(descriptor);
        try {
          const digest = directory.digests[id];
          if (!digest || bytes.length !== digest.utf8_byte_length || sha256(bytes) !== digest.sha256) invalid("JOURNAL_COPY_SOURCE_MISMATCH");
          representations[id] = bytes.toString("utf8");
        } finally { bytes.fill(0); }
      } else {
        const representation = await corpusStore.readJsonObject({ objectId: descriptor.object_id });
        if (representation.representation_id !== id) invalid("JOURNAL_COPY_SOURCE_MISMATCH");
        representations[id] = representation.text;
      }
    }
    // The indexes the generation's builder added beyond the ones every generation gets from its records.
    const builtIn = new Set([...Object.keys(buildGraphIndexes({ nodes: [], edges: [] })), "record_lookup", "representation_objects"]);
    const extraIndexes = {};
    for (const [name, descriptors] of Object.entries(manifest.indexes ?? {})) {
      if (!builtIn.has(name)) extraIndexes[name] = [...(await readWholeIndex(corpusStore, descriptors))];
    }
    const value = {
      schema_version: 1, kind: JOURNAL_COPY_KIND, exported_at: exportedAt,
      source: { case_id: caseId, corpus_id: corpusId, generation: reference.active_generation, manifest_object_id: reference.manifest_object_id,
        visibility_epoch: reference.visibility_epoch, permitted_uses: [...manifest.permitted_uses] },
      graph, source_representations: representations, extra_indexes: extraIndexes, index_representations: Array.isArray(manifest.indexes?.representation_objects)
    };
    return { ...value, content_sha256: contentDigest(value) };
  }, authContext);
  return sealJournalCopy(bundle, recipientPublicKey);
}

// The corpus a copy goes into, named by the copy itself, so importing the same file again finds the same corpus rather than
// making another.
export const journalCopyCorpusId = (bundle) => `journal-copy-${sha256(JSON.stringify([bundle.source, bundle.exported_at, bundle.content_sha256])).slice(0, 32)}`;

// What the client list keeps of a copy's source: a digest of the server's case and corpus, never the ids themselves (a hosted case
// id can be a readable name).
export const journalCopySourceDigest = (bundle) => sha256(`inner-signal journal copy source v1\0${bundle.source.case_id}\0${bundle.source.corpus_id}`);

// A store that keeps nothing: the copy's generation is built into it before the client's case is touched, so whatever the vault's
// store couldn't take (a record too large for its shards, an index it refuses) is found while nothing is written yet.
const keepsNothing = Object.freeze({
  async writeJsonObject({ objectId, objectVersion = 1, value }) {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    return { object_id: objectId, object_version: objectVersion, byte_length: bytes.length, sha256: sha256(bytes) };
  },
  async writeChunkedOriginal({ objectId, objectVersion = 1, bytes }) {
    return { object_id: objectId, object_version: objectVersion, byte_length: bytes.length, sha256: sha256(bytes), chunks: [] };
  }
});

// The import half, on the laptop, into the client's runner case: the bundle checked whole before anything is written (its graph, and
// its generation built once into a store that keeps nothing), the graph rebuilt under that case and the copy's own corpus with the
// generation's own indexes, published for session use, then every passage's quotation checked against the stored bytes by the
// session-use reader, and every stored record compared with the export's. The caller holds the vault (the runner stopped) and a
// one-time grant with write and the archive, organize_search and session_use purposes the store asks, for that case alone. A copy
// already imported (the same corpus, published with the same generation) is checked again rather than written twice; one an earlier
// import left unpublished is refused.
export async function importJournalCopy({ caseAccessService, caseId, corpusId, authContext, bundle }) {
  validateJournalCopyBundle(bundle);
  if (!ID.test(corpusId)) invalid("JOURNAL_COPY_INVALID");
  const rebind = (record) => ({ ...record, case_id: caseId, corpus_id: corpusId });
  const graph = { ...bundle.graph, case_id: caseId, corpus_id: corpusId, nodes: bundle.graph.nodes.map(rebind), edges: bundle.graph.edges.map(rebind) };
  validateJournalGraph(graph, bundle.source_representations);
  const readAccess = { requiredScope: "case:read", requiredPurpose: "session_use" };
  let existing = null;
  try { existing = (await caseAccessService.inspectJournalCorpus(caseId, corpusId, readAccess, authContext)).reference; }
  catch (error) { if (error?.code !== "PRIVATE_CASE_NOT_FOUND") throw error; }
  if (existing && existing.active_generation !== graph.generation) invalid("JOURNAL_COPY_PARTLY_IMPORTED", "An earlier import of this copy stopped before publishing it; export a new copy.");
  if (!existing) {
    const build = (corpusStore, shardTargetBytes) => persistGraphGeneration({ corpusStore, graph, sourceRepresentations: bundle.source_representations,
      permittedUses: bundle.source.permitted_uses.filter((use) => COPY_USES.includes(use)), shardTargetBytes,
      extraIndexes: Object.fromEntries(Object.entries(bundle.extra_indexes).map(([name, entries]) => [name, new Map(entries)])),
      indexRepresentations: bundle.index_representations });
    let shardTargetBytes = COPY_SHARD_BYTES;
    try { await build(keepsNothing, shardTargetBytes); } catch (error) {
      if (!TOO_LARGE_FOR_A_SHARD.has(error?.code)) throw error;
      shardTargetBytes = undefined;
      await build(keepsNothing, shardTargetBytes);
    }
    await caseAccessService.createJournalCorpus(caseId, { corpusId, manifestObjectId: "manifest:staging" }, authContext);
    let persisted;
    await caseAccessService.withJournalCorpus(caseId, corpusId, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
      persisted = await build(corpusStore, shardTargetBytes);
    }, authContext);
    await caseAccessService.publishJournalGeneration(caseId, { corpusId, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, authContext);
  }
  const passageIds = graph.nodes.filter((node) => node.kind === "passage").map((node) => node.id);
  const expected = new Map([...graph.nodes, ...graph.edges].map((record) => [record.id, JSON.stringify(record)]));
  return caseAccessService.withJournalCorpus(caseId, corpusId, readAccess, async ({ corpusStore, cursorSecret, reference }) => {
    const reader = await openPrivateJournalGraph({ corpusStore, cursorSecret, caseId, corpusId, generation: reference.active_generation,
      manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch, purpose: "session_use" });
    try {
      for (let start = 0; start < passageIds.length; start += EVIDENCE_BATCH) await reader.resolveEvidence(passageIds.slice(start, start + EVIDENCE_BATCH));
    } finally { reader.close(); }
    const stored = await readRecords(corpusStore, await corpusStore.readJsonObject({ objectId: reference.manifest_object_id }));
    if (stored.length !== expected.size || stored.some((record) => expected.get(record.id) !== JSON.stringify(record))) invalid("JOURNAL_COPY_RECORDS_MISMATCH", "The stored copy differs from the export.");
    return { generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch,
      corpus_id: corpusId, passages_verified: passageIds.length, records_verified: stored.length };
  }, authContext);
}
