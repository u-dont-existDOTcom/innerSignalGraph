import { createHash } from "node:crypto";
import { ValidationError } from "../core/errors.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function invariant(condition, code) {
  if (!condition) throw new ValidationError(code, { code });
}

export function createSourceManifest({ caseId, corpusId, sourceId, originalObject, parseResult, representationObjectIds = {} }) {
  invariant(typeof caseId === "string" && caseId.length > 0, "CASE_ID_INVALID");
  invariant(typeof corpusId === "string" && corpusId.length > 0, "CORPUS_ID_INVALID");
  invariant(typeof sourceId === "string" && sourceId.length > 0, "SOURCE_ID_INVALID");
  invariant(originalObject && typeof originalObject.object_id === "string", "ORIGINAL_OBJECT_INVALID");
  invariant(originalObject.byte_length === parseResult?.source?.byte_length && originalObject.sha256 === parseResult?.source?.sha256, "ORIGINAL_PARSE_BINDING_MISMATCH");
  const representations = parseResult.representations.map((representation) => ({
    representation_id: representation.representation_id,
    representation_version: representation.representation_version,
    object_id: representationObjectIds[representation.representation_id] ?? `object:${sha256(Buffer.from(`${sourceId}\0${representation.representation_id}\0${representation.sha256}`, "utf8")).slice(0, 40)}`,
    kind: representation.kind,
    page_index: representation.page_index,
    utf8_byte_length: representation.utf8_byte_length,
    sha256: representation.sha256
  }));
  return Object.freeze({
    schema_version: "1.0",
    case_id: caseId,
    corpus_id: corpusId,
    source_id: sourceId,
    source_format: parseResult.source.format,
    original: structuredClone(originalObject),
    parser_receipt: structuredClone(parseResult.parser),
    pages: structuredClone(parseResult.pages),
    representations,
    attachments: structuredClone(parseResult.attachments),
    visual_review: structuredClone(parseResult.visual_pending),
    warnings: structuredClone(parseResult.warnings)
  });
}

export function verifySourceManifest({ manifest, originalBytes, representations }) {
  invariant(manifest && typeof manifest === "object" && Buffer.isBuffer(originalBytes), "SOURCE_MANIFEST_INPUT_INVALID");
  invariant(originalBytes.byteLength === manifest.original.byte_length && sha256(originalBytes) === manifest.original.sha256, "ORIGINAL_REASSEMBLY_MISMATCH");
  const represented = new Set();
  for (const descriptor of manifest.representations) {
    invariant(Object.hasOwn(representations, descriptor.representation_id), "REPRESENTATION_MISSING");
    const text = representations[descriptor.representation_id];
    invariant(typeof text === "string" && text.isWellFormed(), "REPRESENTATION_INVALID");
    const bytes = Buffer.from(text, "utf8");
    invariant(bytes.byteLength === descriptor.utf8_byte_length && sha256(bytes) === descriptor.sha256, "REPRESENTATION_INTEGRITY_MISMATCH");
    represented.add(descriptor.representation_id);
  }
  for (const page of manifest.pages) invariant(represented.has(page.representation_id), "PAGE_REPRESENTATION_MISSING");
  for (const pending of manifest.visual_review) {
    invariant(manifest.pages.some((page) => page.page_index === pending.page_index && page.disposition !== "readable"), "VISUAL_REVIEW_PAGE_INVALID");
  }
  return Object.freeze({
    result: "PASS_SOURCE_MANIFEST",
    original_bytes: originalBytes.byteLength,
    representations: represented.size,
    pages: manifest.pages.length,
    visual_pending: manifest.visual_review.length
  });
}
