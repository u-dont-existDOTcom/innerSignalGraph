import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { privateRuntimeAuditPrompt } from "../../src/prompts/private-runtime-audit.mjs";
import { privateRuntimeAuditResultSchema, privateRuntimeEvidenceAuditResultSchema } from "../../src/schemas/private-runtime.mjs";
import { validateResponseEvidenceSnapshot, responseEvidenceSnapshotSha256, sha256Json } from "../../src/supervisor/response-evidence-contract.mjs";
import { CORPUS_SHA256, MANIFEST_SCHEMA, HARD_CAP, outsideRepository, packetId, sha256 } from "./common.mjs";

export async function loadSealed(sealedDir) {
  sealedDir = await outsideRepository(sealedDir);
  const manifestBytes = await fs.readFile(path.join(sealedDir, "manifest.json"));
  const manifestSha256 = sha256(manifestBytes);
  if ((await fs.readFile(path.join(sealedDir, "manifest.sha256"), "utf8")).trim() !== manifestSha256) throw new Error("The sealed manifest hash changed.");
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.corpus_sha256 !== CORPUS_SHA256 || manifest.cases.length !== 36
      || manifest.packets.length !== 72 || manifest.design.hard_cap !== HARD_CAP || manifest.design.samples !== 2) throw new Error("Invalid response-evidence sealed manifest.");
  const files = new Set(["manifest.json", "manifest.sha256"]);
  const read = async (ref) => {
    if (!ref || typeof ref.file !== "string" || ref.file !== path.basename(ref.file) || files.has(ref.file)) throw new Error("Invalid or duplicate sealed filename.");
    files.add(ref.file);
    const file = path.join(sealedDir, ref.file), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid sealed file: ${ref.file}`);
    const bytes = await fs.readFile(file);
    if (sha256(bytes) !== ref.sha256 || bytes.length !== ref.bytes) throw new Error(`Sealed byte hash mismatch: ${ref.file}`);
    return bytes.toString("utf8");
  };
  const corpusText = await read(manifest.corpus_file);
  if (sha256(corpusText) !== CORPUS_SHA256) throw new Error("Sealed corpus differs from the frozen corpus.");
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
          || packet.disclosure_manifest.response_evidence_view_sha256 !== sha256Json(packet.response_evidence)) throw new Error("Invalid sealed response-evidence binding.");
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
