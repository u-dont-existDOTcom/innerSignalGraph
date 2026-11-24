import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { ValidationError } from "../core/errors.mjs";
import { persistGraphGeneration, readGenerationDirectory } from "./graph.mjs";
import { openPrivateJournalGraph } from "./retrieval.mjs";

// The copy step for a client's journal (docs/superpowers/specs/2026-11-23-runner-client-cases-design.md, point 4; the owner's answer
// 1a to question i73): the client's published session-use generation is exported where it lives (the server's vault, a server step
// run only on the owner's go for each copy), sealed for the runner trial alone, and imported on the laptop into the client's runner
// case, rebuilt under that case and a corpus of its own, published for session use and checked quote by quote. Nothing here
// contacts a server; the caller runs each half where its vault is.
//
// Sealing: the trial folder keeps an X25519 key pair (its private half mode 0600, beside the credentials). The export seals the
// bundle to the public half with an ephemeral key (X25519, HKDF-SHA-256, AES-256-GCM), so only that trial folder can open it, and
// the bundle on disk or in transit shows nothing of the journal. The export is the journal import's `export` command
// (src/cli/journal-import.mjs); the import is the runner trial's `--import` (scripts/runner-trial-journal.mjs).

export const JOURNAL_COPY_KIND = "runner_journal_copy";
const SEAL_INFO = Buffer.from("inner-signal runner journal copy v1", "utf8");
const invalid = (code, message = "The journal copy is invalid.") => { throw new ValidationError(message, { code }); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ID = /^[A-Za-z0-9:_-]{1,160}$/u;

export function createJournalCopyKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")
  };
}

const publicKeyOf = (base64) => createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
const privateKeyOf = (base64) => createPrivateKey({ key: Buffer.from(base64, "base64"), format: "der", type: "pkcs8" });

// A trial folder's public key as `--copy-key` prints it: an X25519 key, SPKI DER in base64.
export function validateJournalCopyRecipient(base64) {
  let key = null;
  try { key = typeof base64 === "string" && /^[A-Za-z0-9+/]+={0,2}$/u.test(base64) ? publicKeyOf(base64) : null; } catch { key = null; }
  if (key?.asymmetricKeyType !== "x25519") invalid("JOURNAL_COPY_RECIPIENT_INVALID", "The trial folder's public key isn't valid.");
  return base64;
}

export function sealJournalCopy(bundle, recipientPublicKey) {
  const recipient = publicKeyOf(validateJournalCopyRecipient(recipientPublicKey));
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const salt = randomBytes(32);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, SEAL_INFO, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const sealed = {
    schema_version: 1, kind: "runner_journal_copy_sealed", recipient_sha256: sha256(Buffer.from(recipientPublicKey, "base64")),
    ephemeral_public_key: ephemeral.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64")
  };
  key.fill(0); shared.fill(0); plaintext.fill(0);
  return sealed;
}

export function openJournalCopy(sealed, keyPair) {
  if (sealed?.schema_version !== 1 || sealed.kind !== "runner_journal_copy_sealed") invalid("JOURNAL_COPY_INVALID");
  if (sealed.recipient_sha256 !== sha256(Buffer.from(keyPair.publicKey, "base64"))) invalid("JOURNAL_COPY_OTHER_RECIPIENT", "The journal copy was sealed for another trial folder.");
  const shared = diffieHellman({ privateKey: privateKeyOf(keyPair.privateKey), publicKey: publicKeyOf(sealed.ephemeral_public_key) });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.from(sealed.salt, "base64"), SEAL_INFO, 32));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]);
    try { return validateJournalCopyBundle(JSON.parse(plaintext.toString("utf8"))); } finally { plaintext.fill(0); }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return invalid("JOURNAL_COPY_UNREADABLE", "The journal copy can't be opened with this trial folder's key.");
  } finally { key.fill(0); shared.fill(0); }
}

export function validateJournalCopyBundle(bundle) {
  if (bundle?.schema_version !== 1 || bundle.kind !== JOURNAL_COPY_KIND) invalid("JOURNAL_COPY_INVALID");
  const { source, graph, source_representations: representations } = bundle;
  if (!source || !ID.test(source.generation ?? "") || !ID.test(source.manifest_object_id ?? "") || !Number.isSafeInteger(source.visibility_epoch)) invalid("JOURNAL_COPY_INVALID");
  if (!Array.isArray(source.permitted_uses) || !source.permitted_uses.includes("session_use")) invalid("JOURNAL_COPY_NOT_SESSION_USE", "Only a generation published for session use is copied.");
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.generation !== source.generation) invalid("JOURNAL_COPY_INVALID");
  if (!representations || typeof representations !== "object" || Array.isArray(representations) || Object.values(representations).some((text) => typeof text !== "string")) invalid("JOURNAL_COPY_INVALID");
  if (bundle.graph_sha256 !== sha256(JSON.stringify(graph)) || bundle.representations_sha256 !== sha256(JSON.stringify(representations))) invalid("JOURNAL_COPY_DIGEST_MISMATCH");
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

export async function readSealedJournalCopy(file) {
  let value;
  try { value = JSON.parse(await fs.readFile(file, "utf8")); } catch { return invalid("JOURNAL_COPY_UNREADABLE", "The sealed journal copy can't be read."); }
  if (value?.schema_version !== 1 || value.kind !== "runner_journal_copy_sealed") invalid("JOURNAL_COPY_INVALID");
  return value;
}

// The export half, where the client's journal lives: the active generation, published for session use, read whole and sealed.
// `requiredScope`: the scope the reader's grant holds (the import's operator may hold write only).
export async function exportJournalCopy({ caseAccessService, caseId, corpusId, authContext, recipientPublicKey, requiredScope = "case:read", exportedAt = new Date().toISOString() }) {
  validateJournalCopyRecipient(recipientPublicKey);
  const access = { requiredScope, requiredPurpose: "session_use" };
  const bundle = await caseAccessService.withJournalCorpus(caseId, corpusId, access, async ({ corpusStore, reference }) => {
    if (!reference?.active_generation) invalid("JOURNAL_COPY_NOT_PUBLISHED", "The journal has no published generation to copy.");
    const manifest = await corpusStore.readJsonObject({ objectId: reference.manifest_object_id });
    if (!Array.isArray(manifest.permitted_uses) || !manifest.permitted_uses.includes("session_use")) invalid("JOURNAL_COPY_NOT_SESSION_USE", "Only a generation published for session use is copied.");
    const records = [];
    for (const shard of manifest.record_shards) records.push(...(await corpusStore.readJsonObject({ objectId: shard.object_id })).records);
    const isEdge = (record) => typeof record.relation === "string" && "from" in record && "to" in record;
    const graph = { schema_version: "1.0", case_id: caseId, corpus_id: corpusId, generation: reference.active_generation,
      nodes: records.filter((record) => !isEdge(record)), edges: records.filter(isEdge) };
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
    return {
      schema_version: 1, kind: JOURNAL_COPY_KIND, exported_at: exportedAt,
      source: { generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch, permitted_uses: [...manifest.permitted_uses] },
      graph, graph_sha256: sha256(JSON.stringify(graph)), source_representations: representations, representations_sha256: sha256(JSON.stringify(representations))
    };
  }, authContext);
  return sealJournalCopy(bundle, recipientPublicKey);
}

// The import half, on the laptop, into the client's runner case: the graph rebuilt under that case and a corpus of its own,
// published for session use, then every passage's quotation checked against the stored bytes by the session-use reader, and the
// copy's passages compared with the export's, one by one. The caller holds the vault (the runner stopped) and a one-time grant
// with write and the archive, organize_search and session_use purposes for that case alone.
export async function importJournalCopy({ caseAccessService, caseId, corpusId, authContext, bundle, shardTargetBytes = 64 * 1024 }) {
  validateJournalCopyBundle(bundle);
  if (!ID.test(corpusId)) invalid("JOURNAL_COPY_INVALID");
  const rebind = (record) => ({ ...record, case_id: caseId, corpus_id: corpusId });
  const graph = { ...bundle.graph, case_id: caseId, corpus_id: corpusId, nodes: bundle.graph.nodes.map(rebind), edges: bundle.graph.edges.map(rebind) };
  await caseAccessService.createJournalCorpus(caseId, { corpusId, manifestObjectId: "manifest:staging" }, authContext);
  let persisted;
  await caseAccessService.withJournalCorpus(caseId, corpusId, { requiredScope: "case:write", requiredPurpose: "archive" }, async ({ corpusStore }) => {
    persisted = await persistGraphGeneration({ corpusStore, graph, sourceRepresentations: bundle.source_representations, permittedUses: ["archive", "organize_search", "session_use"], shardTargetBytes });
  }, authContext);
  await caseAccessService.publishJournalGeneration(caseId, { corpusId, generation: graph.generation, manifestObjectId: persisted.manifest_object_id }, authContext);
  const passages = graph.nodes.filter((node) => node.kind === "passage");
  const checked = await caseAccessService.withJournalCorpus(caseId, corpusId, { requiredScope: "case:read", requiredPurpose: "session_use" }, async ({ corpusStore, cursorSecret, reference }) => {
    const reader = await openPrivateJournalGraph({ corpusStore, cursorSecret, caseId, corpusId, generation: reference.active_generation,
      manifestObjectId: reference.manifest_object_id, visibilityEpoch: reference.visibility_epoch, purpose: "session_use" });
    try {
      if (passages.length) await reader.resolveEvidence(passages.map((node) => node.id));
      return { generation: reference.active_generation, manifest_object_id: reference.manifest_object_id, visibility_epoch: reference.visibility_epoch };
    } finally { reader.close(); }
  }, authContext);
  const exported = new Map(bundle.graph.nodes.filter((node) => node.kind === "passage").map((node) => [node.id, JSON.stringify(node.data)]));
  if (exported.size !== passages.length || passages.some((node) => exported.get(node.id) !== JSON.stringify(node.data))) invalid("JOURNAL_COPY_QUOTES_MISMATCH", "The copy's quotations differ from the export's.");
  return { ...checked, corpus_id: corpusId, passages_verified: passages.length };
}
