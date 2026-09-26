import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = value => createHash("sha256").update(value).digest("hex");

export async function verifyLatestSourceSync({ projectRoot = root, candidateText } = {}) {
  const read = file => fs.readFile(path.join(projectRoot, file));
  const receipt = JSON.parse(await read("tasks/reparenting-strategy-refinement-20260925/SOURCE-SYNC.json"));
  const raw = await read(receipt.rawCapture.path);
  const operational = candidateText === undefined
    ? await read(receipt.operationalText.path)
    : Buffer.from(candidateText, "utf8");

  assert.equal(hash(raw), receipt.rawCapture.sha256, "Raw Substack capture hash mismatch");
  assert.equal(hash(operational), receipt.operationalText.sha256, "Operational guide text hash mismatch");
  assert.ok(raw.toString("utf8").startsWith('<div contenteditable="true"'), "Raw source no longer begins with the captured Substack editor root");
  assert.ok(operational.toString("utf8").startsWith("Listen & Watch:"), "Operational guide text has an unexpected start");

  const manifest = JSON.parse(await read("guides/manifest.json"));
  const current = manifest.sources.find(source => source.id === "inner-child-guide");
  assert.equal(`guides/${current.file}`, receipt.operationalText.path);
  assert.equal(current.sha256, receipt.operationalText.sha256);
  assert.equal(current.version, "owner-latest-humanized-2026-09-25");
  assert.ok(manifest.sourceHistory.some(item =>
    item.id === "inner-child-guide"
    && item.version === "owner-current-2026-09-07-e01-e12"
    && item.sha256 === "00959a1ec71de79b90c2590637782f753185f4a803f3f81a36da8f9f7b13f74f"
  ), "September 7 source history must remain pinned");

  return {
    status: "PASS",
    rawSha256: hash(raw),
    operationalSha256: hash(operational),
    sourceHistoryPreserved: true,
    semanticStatus: receipt.semanticStatus
  };
}
