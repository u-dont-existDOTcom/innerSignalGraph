import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseSourceFile, sourceParserCapabilities } from "../src/journal-import/parsers/index.mjs";
import { partitionRepresentation, verifyRepresentationCoverage } from "../src/journal-import/partition.mjs";
import { resolveUnitQuote } from "../src/journal-import/anchors.mjs";
import { createSourceManifest, verifySourceManifest } from "../src/journal-import/source-manifest.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function streamObject(dictionary, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "binary");
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.byteLength} >>\nstream\n`, "ascii"),
    bytes,
    Buffer.from("\nendstream", "ascii")
  ]);
}

function syntheticMixedPdf({ longEntryCount = 320 } = {}) {
  const longEntry = Array.from({ length: longEntryCount }, (_, index) => `BT /F1 10 Tf 40 500 Td (long synthetic entry ${String(index).padStart(4, "0")} ${"x".repeat(64)}) Tj ET`).join("\n");
  const objects = new Map([
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii")],
    [2, Buffer.from("<< /Type /Pages /Kids [4 0 R 6 0 R 9 0 R] /Count 3 >>", "ascii")],
    [3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii")],
    [4, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>", "ascii")],
    [5, streamObject("", "BT /F1 12 Tf 72 100 Td (lower first) Tj ET\nBT /F1 12 Tf 72 700 Td (upper second) Tj ET")],
    [6, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 7 0 R >> >> /Contents 8 0 R >>", "ascii")],
    [7, streamObject("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Buffer.from([0xff, 0, 0]))],
    [8, streamObject("", "q 40 0 0 40 72 500 cm /Im1 Do Q")],
    [9, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 10 0 R >>", "ascii")],
    [10, streamObject("", longEntry)]
  ]);
  const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let offset = chunks[0].byteLength;
  for (let number = 1; number <= objects.size; number += 1) {
    const object = Buffer.concat([
      Buffer.from(`${number} 0 obj\n`, "ascii"),
      objects.get(number),
      Buffer.from("\nendobj\n", "ascii")
    ]);
    offsets[number] = offset;
    chunks.push(object);
    offset += object.byteLength;
  }
  const xrefOffset = offset;
  const xref = ["xref", `0 ${objects.size + 1}`, "0000000000 65535 f "];
  for (let number = 1; number <= objects.size; number += 1) xref.push(`${String(offsets[number]).padStart(10, "0")} 00000 n `);
  xref.push("trailer", `<< /Size ${objects.size + 1} /Root 1 0 R >>`, "startxref", String(xrefOffset), "%%EOF", "");
  chunks.push(Buffer.from(xref.join("\n"), "ascii"));
  return Buffer.concat(chunks);
}

async function temporaryFile(name, bytes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inner-signal-source-"));
  const filePath = path.join(root, name);
  await fs.writeFile(filePath, bytes, { mode: 0o600 });
  return filePath;
}

test("restricted PDF.js intake accounts for text, visual-only, ordering and long-entry pages", async () => {
  const original = syntheticMixedPdf();
  const inputPath = await temporaryFile("invented-mixed.pdf", original);
  const parsed = await parseSourceFile({ inputPath, format: "pdf", timeoutMs: 20_000 });
  assert.equal(sourceParserCapabilities().formats.pdf.adapter, "pdfjs-dist");
  assert.equal(parsed.parser.version, "6.3.289");
  assert.equal(parsed.parser.isolation.process_boundary, true);
  assert.equal(parsed.parser.isolation.network_modules_blocked, true);
  assert.equal(parsed.source.sha256, sha256(original));
  assert.equal(parsed.pages.length, 3);
  assert.equal(parsed.pages[0].disposition, "review_required");
  assert.ok(parsed.pages[0].reading_order.flags.includes("vertical_sequence_regression"));
  assert.equal(parsed.pages[1].disposition, "visual_pending");
  assert.ok(parsed.pages[1].image_inventory.length >= 1);
  assert.ok(parsed.visual_pending.some(({ page_index }) => page_index === 1));
  assert.ok(parsed.representations[2].utf8_byte_length > 20_000);

  const manifest = createSourceManifest({
    caseId: "synthetic_case",
    corpusId: "synthetic_corpus",
    sourceId: "synthetic_source",
    originalObject: { object_id: "original:synthetic", byte_length: original.byteLength, sha256: sha256(original), chunks: [] },
    parseResult: parsed
  });
  const texts = Object.fromEntries(parsed.representations.map(({ representation_id, text }) => [representation_id, text]));
  const receipt = verifySourceManifest({ manifest, originalBytes: original, representations: texts });
  assert.deepEqual({ pages: receipt.pages, visual_pending: receipt.visual_pending }, { pages: 3, visual_pending: 2 });
  for (const representation of parsed.representations) {
    const units = partitionRepresentation({ representationId: representation.representation_id, text: representation.text });
    assert.equal(verifyRepresentationCoverage(representation.text, units).complete, true);
  }
});

test("UTF-8 intake and partition preserve every multibyte byte with bounded context", async () => {
  const text = `${"Préface 🌿 — entrée inventée.\n\n".repeat(12)}fin.`;
  const inputPath = await temporaryFile("invented.txt", Buffer.from(text, "utf8"));
  const parsed = await parseSourceFile({ inputPath, format: "text" });
  assert.equal(parsed.representations[0].text, text);
  const units = partitionRepresentation({
    representationId: parsed.representations[0].representation_id,
    text,
    targetBytes: 80,
    maximumBytes: 120,
    contextEachSideBytes: 31
  });
  const receipt = verifyRepresentationCoverage(text, units);
  assert.equal(receipt.byte_length, Buffer.byteLength(text, "utf8"));
  assert.ok(units.length > 1);
  assert.ok(units.every((unit) => unit.utf8_byte_length <= 120 && unit.text.isWellFormed()));
  assert.ok(units.every((unit) => unit.context.before.isWellFormed() && unit.context.after.isWellFormed()));
});

test("isolated parser flushes a multi-megabyte result before its clean child exit", { timeout: 60_000 }, async () => {
  const inputPath = await temporaryFile("invented-large-ipc.pdf", syntheticMixedPdf({ longEntryCount: 6_000 }));
  const parsed = await parseSourceFile({ inputPath, format: "pdf", timeoutMs: 45_000, memoryLimitMb: 768 });
  assert.equal(parsed.pages.length, 3);
  assert.equal(parsed.pages[2].text_items.length, 6_000);
  assert.ok(parsed.representations[2].utf8_byte_length > 500_000);
});

test("exact quote resolution requires an occurrence and computes representation byte offsets", () => {
  const text = "début anchor 🌿 middle anchor 🌿 fin";
  const units = partitionRepresentation({ representationId: "representation:anchor", text, targetBytes: 100, maximumBytes: 120 });
  assert.throws(() => resolveUnitQuote(units, { unit_id: units[0].unit_id, quote: "anchor 🌿" }), /QUOTE_AMBIGUOUS/);
  const resolved = resolveUnitQuote(units, { unit_id: units[0].unit_id, quote: "anchor 🌿", occurrence: 1 });
  assert.equal(Buffer.from(text, "utf8").subarray(resolved.start_byte, resolved.end_byte).toString("utf8"), "anchor 🌿");
});

test("intake limits and invalid UTF-8 fail explicitly without partial admission", async () => {
  const pdf = syntheticMixedPdf();
  const pdfPath = await temporaryFile("limited.pdf", pdf);
  await assert.rejects(() => parseSourceFile({ inputPath: pdfPath, format: "pdf", byteLimit: pdf.byteLength - 1 }), /SOURCE_BYTE_LIMIT_EXCEEDED/);
  await assert.rejects(() => parseSourceFile({ inputPath: pdfPath, format: "pdf", pageLimit: 2 }), /SOURCE_PAGE_LIMIT_EXCEEDED/);
  const invalidPath = await temporaryFile("invalid.txt", Buffer.from([0xc3, 0x28]));
  await assert.rejects(() => parseSourceFile({ inputPath: invalidPath, format: "text" }), /SOURCE_NOT_VALID_UTF8/);
});
