import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceFile } from "../src/journal-import/parsers/index.mjs";

// Exercise the real isolated child parser, not a synthetic sourceParser stub.
// All bytes are invented; no private journal source or external provider is used.
function inventedPdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (Synthetic PDF parser check) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "endstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += String(i + 1) + " 0 obj\n" + body + "\nendobj\n";
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += "xref\n0 " + String(objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets) pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + String(objects.length + 1) + " /Root 1 0 R >>\n";
  pdf += "startxref\n" + String(xrefStart) + "\n%%EOF\n";
  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

test("isolated production parser accepts in-memory text bytes", async () => {
  const result = await parseSourceFile({
    inputBytes: new Uint8Array(Buffer.from("January. Invented journal entry.")),
    format: "text", timeoutMs: 8000
  });
  assert.equal(result.parser.adapter, "node-utf8");
  assert.equal(result.representations.length, 1);
  assert.match(result.representations[0].text, /Invented journal entry/);
});

test("isolated production PDF parser extracts invented source text", async () => {
  const result = await parseSourceFile({ inputBytes: inventedPdf(), format: "pdf", timeoutMs: 12000 });
  assert.equal(result.parser.adapter, "pdfjs-dist");
  assert.equal(result.pages.length, 1);
  assert.match(result.representations.map(x => x.text).join(" "), /Synthetic PDF parser check/);
});
