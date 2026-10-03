import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = value => createHash("sha256").update(value).digest("hex");

export async function verifyOct3SourceSync({ projectRoot = root, candidateText } = {}) {
  const read = file => fs.readFile(path.join(projectRoot, file));
  const receipt = JSON.parse(await read("tasks/inner-child-oct3-certainty-refinement-20261003/SOURCE-SYNC.json"));
  const baselineRaw = await read(receipt.ownerBaseline.rawCapture.path);
  const baselineText = await read(receipt.ownerBaseline.operationalText.path);
  const activeRaw = await read(receipt.activeRevision.rawCapture.path);
  const activeText = candidateText === undefined
    ? await read(receipt.activeRevision.operationalText.path)
    : Buffer.from(candidateText, "utf8");

  assert.equal(hash(baselineRaw), receipt.ownerBaseline.rawCapture.sha256, "Oct 3 owner raw capture hash mismatch");
  assert.equal(hash(baselineText), receipt.ownerBaseline.operationalText.sha256, "Oct 3 synchronized baseline text hash mismatch");
  assert.equal(hash(activeRaw), receipt.activeRevision.rawCapture.sha256, "Oct 3 r3 raw capture hash mismatch");
  assert.equal(hash(activeText), receipt.activeRevision.operationalText.sha256, "Oct 3 r3 operational guide text hash mismatch");
  assert.ok(baselineRaw.toString("utf8").startsWith('<div contenteditable="true"'), "Owner baseline no longer begins with the captured Substack editor root");
  assert.ok(activeRaw.toString("utf8").startsWith('<div contenteditable="true"'), "Active revision no longer begins with the Substack editor root");

  const manifest = JSON.parse(await read("guides/manifest.json"));
  const current = manifest.sources.find(source => source.id === "inner-child-guide");
  assert.equal(`guides/${current.file}`, receipt.activeRevision.operationalText.path);
  assert.equal(current.sha256, receipt.activeRevision.operationalText.sha256);
  assert.equal(current.version, receipt.activeRevision.version);
  assert.ok(manifest.sourceHistory.some(item =>
    item.id === "inner-child-guide"
    && item.version === "owner-supplied-2026-10-03-before-current-edit"
    && item.sha256 === receipt.ownerBaseline.operationalText.sha256
  ), "Exact Oct 3 baseline text must remain pinned in source history");
  assert.ok(manifest.sourceHistory.some(item =>
    item.id === "inner-child-guide"
    && item.version === "owner-latest-humanized-2026-09-25"
    && item.sha256 === "2a743d9ec9f45ba12ce78f29f64eef84dfe930589281992ad530b01f0f2969a1"
  ), "September 25 source history must remain pinned");

  return {status:"PASS",baselineRawSha256:hash(baselineRaw),baselineTextSha256:hash(baselineText),activeRawSha256:hash(activeRaw),activeTextSha256:hash(activeText),sourceHistoryPreserved:true,semanticStatus:receipt.semanticStatus};
}
