import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

// The byte-order mark is kept as text: every passage is a byte span of the source, so the text
// must be exactly the bytes. Stripping it shifted every span and broke the length check.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function parseUtf8File({ inputPath, inputBytes, byteLimit }) {
  const bytes = inputBytes ? Buffer.from(inputBytes) : await fs.readFile(inputPath);
  if (bytes.byteLength > byteLimit) throw Object.assign(new Error("SOURCE_BYTE_LIMIT_EXCEEDED"), { code: "SOURCE_BYTE_LIMIT_EXCEEDED" });
  let text;
  try { text = utf8.decode(bytes); }
  catch { throw Object.assign(new Error("SOURCE_NOT_VALID_UTF8"), { code: "SOURCE_NOT_VALID_UTF8" }); }
  return {
    protocol_version: "1.0",
    parser: { adapter: "node-utf8", version: process.versions.node, build: null },
    source: { format: "text", mime_type: "text/plain; charset=utf-8", byte_length: bytes.byteLength, sha256: digest(bytes) },
    pages: [],
    representations: [{
      representation_id: "representation:text:1",
      representation_version: 1,
      kind: "utf8_text",
      page_index: null,
      text,
      utf8_byte_length: bytes.byteLength,
      sha256: digest(bytes)
    }],
    attachments: [],
    visual_pending: [],
    warnings: []
  };
}
