import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { privateRuntimeAuditPrompt } from "../../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeAuditResultSchema, privateRuntimeEvidenceAuditResultSchema } from "../../src/schemas/private-runtime.mjs";
import { validateResponseEvidenceSnapshot, responseEvidenceSnapshotSha256, sha256Json } from "../../src/supervisor/response-evidence-contract.mjs";
import { corpusEntry, MANIFEST_SCHEMA, HARD_CAP, outsideRepository, packetId, sha256 } from "./common.mjs";

export async function loadSealed(sealedDir) {
  sealedDir = await outsideRepository(sealedDir);
  const manifestBytes = await fs.readFile(path.join(sealedDir, "manifest.json"));
  const manifestSha256 = sha256(manifestBytes);
  if ((await fs.readFile(path.join(sealedDir, "manifest.sha256"), "utf8")).trim() !== manifestSha256) throw new Error("The sealed manifest hash changed.");
  const manifest = JSON.parse(manifestBytes);
  // Seals made before corpus selection was added are the original main corpus.
  const frozenCorpus = corpusEntry(manifest.corpus_name ?? "main");
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.corpus_sha256 !== frozenCorpus.sha256 || manifest.cases.length !== frozenCorpus.caseCount
      || manifest.packets.length !== frozenCorpus.caseCount * 2 || manifest.design.hard_cap !== HARD_CAP || manifest.design.samples !== 2) throw new Error("Invalid response-evidence sealed manifest.");
  const files = new Set(["manifest.json", "manifest.sha256"]);
  const read = async (ref) => {
    if (!ref || typeof ref.file !== "string" || ref.file !== path.basename(ref.file) || files.has(ref.file)) throw new Error("Invalid or duplicate sealed filename.");
    files.add(ref.file);
    // Open once without following links and check the open handle itself, so the file checked is the file read.
    const handle = await fs.open(path.join(sealedDir, ref.file), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => { throw new Error(`Invalid sealed file: ${ref.file}`); });
    let bytes;
    try {
      if (!(await handle.stat()).isFile()) throw new Error(`Invalid sealed file: ${ref.file}`);
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    if (sha256(bytes) !== ref.sha256 || bytes.length !== ref.bytes) throw new Error(`Sealed byte hash mismatch: ${ref.file}`);
    return bytes.toString("utf8");
  };
  const corpusText = await read(manifest.corpus_file);
  if (sha256(corpusText) !== frozenCorpus.sha256) throw new Error("Sealed corpus differs from the frozen corpus.");
  const corpus = JSON.parse(corpusText);
  const labels = corpus.cases.map(({ id, pair, language, role, dimension, expected, why }) => ({ id, pair, language, role, dimension, expected, why }));
  if (!isDeepStrictEqual(labels, manifest.cases)) throw new Error("Sealed labels differ from the frozen corpus.");
  const entries = [], ids = new Set();
  for (const entry of manifest.packets) {
    const spec = corpus.cases.find((c) => c.id === entry.case_id);
    if (!spec || !["G", "E"].includes(entry.arm) || entry.id !== packetId(spec.id, entry.arm) || ids.has(entry.id)) throw new Error("Invalid sealed packet identity.");
    ids.add(entry.id);
    const packet = JSON.parse(await read(entry.packet));
    const system = await read(entry.system), user = await read(entry.user), outputSchema = JSON.parse(await read(entry.output_schema));
    const prompt = privateRuntimeAuditPrompt(packet);
    if (system !== prompt.system || user !== prompt.user) throw new Error(`${entry.id}: this checkout builds a different prompt from the sealed packet.`);
    if (!isDeepStrictEqual(outputSchema, entry.arm === "E" ? privateRuntimeEvidenceAuditResultSchema : privateRuntimeAuditResultSchema)) throw new Error(`${entry.id}: this checkout builds a different output schema.`);
    if (packet.candidate_response !== spec.candidate) throw new Error("Sealed candidate differs from the frozen corpus.");
    let snapshot = null, candidateText = packet.candidate_response;
    if (entry.arm === "E") {
      snapshot = validateResponseEvidenceSnapshot(JSON.parse(await read(entry.snapshot)));
      candidateText = await read(entry.candidate);
      if (candidateText !== spec.candidate || snapshot.snapshot_sha256 !== responseEvidenceSnapshotSha256(snapshot)
          || packet.response_evidence?.snapshot_sha256 !== snapshot.snapshot_sha256 || packet.response_evidence?.snapshot_id !== snapshot.id
          // The packet's disclosure manifest holds booleans only (rollback-safe); the view digest is the runtime's inclusion receipt.
          || Object.values(packet.disclosure_manifest).some((flag) => typeof flag !== "boolean")) throw new Error("Invalid sealed response-evidence binding.");
    } else if (packet.response_evidence || entry.snapshot || entry.candidate) throw new Error("Advisory arm contains response evidence.");
    entries.push({ entry, packet, prompt: { system, user }, outputSchema, snapshot, candidateText });
  }
  const diskFiles = (await fs.readdir(sealedDir)).sort();
  if (!isDeepStrictEqual(diskFiles, [...files].sort())) throw new Error("Sealed folder contains unlisted bytes.");
  return { manifest, manifestBytes, manifestSha256, entries, byId: new Map(entries.map((item) => [item.entry.id, item])) };
}

export async function selfcheck({ sealedDir }) {
  const sealed = await loadSealed(sealedDir);
  return { packets: sealed.entries.length, manifest_sha256: sealed.manifestSha256, checked: true };
}
